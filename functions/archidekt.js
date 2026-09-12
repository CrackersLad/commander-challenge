const { onRequest } = require("firebase-functions/v2/https");
const { GoogleGenAI } = require("@google/genai");
const admin = require("firebase-admin");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseCards, normalizeMoxfield, enrichCardsWithScryfall, parseDecklistText, parseDeckIdentifier } = require("./parsers.js");
const { fetchEdhrecRanks } = require("./edhrec.js");
const { fetchAllSets, fetchSetCards, compareCollectionToSet } = require("./sets.js");
const { computeCollectionInsights, normalizeColorCodes } = require("./insights.js");
const { DEFAULT_HEADERS, fetchWithRetry, runWithConcurrency } = require("./http.js");

// In-memory caching layers (per Cloud Function instance)
const deckCache = new Map(); // compositeKey -> { timestamp, rawDeck }
const DECK_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const deckNameCache = new Map(); // compositeKey -> { timestamp, name }
const DECK_NAME_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const collectionCache = new Map(); // collectionId -> { timestamp, cards }
const COLLECTION_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fast & rate-limit safe collection fetcher with multi-round retry to guarantee 100% complete card retrieval.
 */
async function fetchArchidektCollection(collectionId) {
    const cleanId = String(collectionId).trim();
    let staleFallbackCards = null;

    // 1. In-memory cache check
    const cached = collectionCache.get(cleanId);
    if (cached && Array.isArray(cached.cards) && cached.cards.length > 0) {
        if (Date.now() - cached.timestamp < COLLECTION_CACHE_TTL) {
            console.log(`[CACHE] Returning in-memory cached collection for ID ${cleanId} (${cached.cards.length} cards)`);
            return cached.cards;
        }
        staleFallbackCards = cached.cards;
    }

    // 2. /tmp disk cache check (persists across warm Cloud Run instances)
    const tmpFilePath = path.join("/tmp", `archidekt_coll_${cleanId}.json`);
    try {
        if (fs.existsSync(tmpFilePath)) {
            const stat = fs.statSync(tmpFilePath);
            const data = JSON.parse(fs.readFileSync(tmpFilePath, "utf8"));
            if (Array.isArray(data) && data.length > 0) {
                if (Date.now() - stat.mtimeMs < COLLECTION_CACHE_TTL) {
                    collectionCache.set(cleanId, { timestamp: Date.now(), cards: data });
                    console.log(`[DISK CACHE] Returning cached collection for ID ${cleanId} (${data.length} cards) from /tmp`);
                    return data;
                }
                if (!staleFallbackCards) staleFallbackCards = data;
            }
        }
    } catch (e) {
        console.warn("[WARN] Could not read /tmp cache:", e.message);
    }

    // 3. Firebase Realtime Database check (persists across cold starts and container recycles)
    try {
        if (admin.apps && admin.apps.length) {
            const dbRef = admin.database().ref(`cached_collections/${cleanId}`);
            const dbSnap = await dbRef.once('value');
            const dbVal = dbSnap.val();
            if (dbVal && Array.isArray(dbVal.cards) && dbVal.cards.length > 0) {
                const age = Date.now() - (dbVal.timestamp || 0);
                if (age < 12 * 60 * 60 * 1000) { // 12 hours
                    console.log(`[RTDB CACHE] Returning cloud-cached collection for ID ${cleanId} (${dbVal.cards.length} cards)`);
                    collectionCache.set(cleanId, { timestamp: Date.now(), cards: dbVal.cards });
                    return dbVal.cards;
                }
                if (!staleFallbackCards) staleFallbackCards = dbVal.cards;
            }
        }
    } catch (e) {
        console.warn("[WARN] Could not read RTDB cache:", e.message);
    }

    const firstPageUrl = `https://archidekt.com/api/collection/${cleanId}/?page=1`;
    let firstRes;
    try {
        firstRes = await fetchWithRetry(firstPageUrl, {
            headers: {
                ...DEFAULT_HEADERS,
                "Referer": "https://archidekt.com/"
            },
            timeoutMs: 10000
        }, 3);
    } catch (err) {
        if (staleFallbackCards && staleFallbackCards.length > 0) {
            console.warn(`[RECOVERY] Network error fetching collection ${cleanId}. Serving fallback cached collection (${staleFallbackCards.length} cards).`);
            return staleFallbackCards;
        }
        throw err;
    }

    if (!firstRes || !firstRes.ok) {
        const status = firstRes ? firstRes.status : "unknown";
        if (staleFallbackCards && staleFallbackCards.length > 0) {
            console.warn(`[RECOVERY] Archidekt returned HTTP ${status}. Serving fallback cached collection (${staleFallbackCards.length} cards) for ID ${cleanId}.`);
            return staleFallbackCards;
        }
        if (status === 429) {
            throw new Error(`Archidekt rate limit (HTTP 429) reached for collection ${cleanId}. Please wait a moment before trying again.`);
        }
        throw new Error(`Failed to fetch collection for ID ${cleanId} (HTTP ${status}). Ensure it is public.`);
    }

    const firstData = await firstRes.json();
    const allCardsMap = new Map();

    if (Array.isArray(firstData)) {
        firstData.forEach(c => allCardsMap.set(c.id || Math.random(), c));
    } else if (firstData.results) {
        (firstData.results || []).forEach(c => allCardsMap.set(c.id || Math.random(), c));
        const count = firstData.count || firstData.results.length;
        const totalPages = Math.min(100, Math.ceil(count / 25));

        if (totalPages > 1) {
            const pendingPages = [];
            for (let p = 2; p <= totalPages; p++) pendingPages.push(p);

            let round = 1;
            while (pendingPages.length > 0 && round <= 3) {
                console.log(`[COLLECTION] Round ${round}: Fetching ${pendingPages.length} pages in concurrent batches for ID ${cleanId}...`);
                const failedInRound = [];
                const taskFns = pendingPages.map(p => async () => {
                    const pageUrl = `https://archidekt.com/api/collection/${cleanId}/?page=${p}`;
                    try {
                        const r = await fetchWithRetry(pageUrl, {
                            headers: {
                                ...DEFAULT_HEADERS,
                                "Referer": "https://archidekt.com/"
                            },
                            timeoutMs: 9000
                        }, 2);
                        if (r.ok) {
                            const d = await r.json();
                            return { p, results: d.results || [] };
                        } else {
                            console.warn(`[COLLECTION] Page ${p} returned HTTP ${r.status}`);
                            return { p, failed: true };
                        }
                    } catch (e) {
                        console.warn(`[COLLECTION] Page ${p} error:`, e.message);
                        return { p, failed: true };
                    }
                });

                // Fetch 3 pages in parallel with polite 150ms spacing between batches
                const batchResults = await runWithConcurrency(taskFns, 3, 150);
                for (const res of batchResults) {
                    if (res && Array.isArray(res.results)) {
                        res.results.forEach(c => allCardsMap.set(c.id || Math.random(), c));
                    } else if (res && res.failed) {
                        failedInRound.push(res.p);
                    }
                }

                pendingPages.length = 0;
                pendingPages.push(...failedInRound);

                if (pendingPages.length > 0 && round < 3) {
                    console.log(`[COLLECTION] ${pendingPages.length} pages pending after round ${round}. Pausing 2.5s before retry...`);
                    await new Promise(r => setTimeout(r, 2500));
                }
                round++;
            }
        }
    }

    const allCards = Array.from(allCardsMap.values());
    const expectedCount = firstData.count || allCards.length;

    if (allCards.length >= expectedCount || allCards.length > 0) {
        collectionCache.set(cleanId, {
            timestamp: Date.now(),
            cards: allCards
        });
        try {
            fs.writeFileSync(tmpFilePath, JSON.stringify(allCards));
        } catch (e) {}

        // Persist to Firebase Realtime Database asynchronously for cross-instance permanence
        try {
            if (admin.apps && admin.apps.length) {
                admin.database().ref(`cached_collections/${cleanId}`).set({
                    timestamp: Date.now(),
                    count: allCards.length,
                    cards: allCards
                }).catch(e => console.warn("[WARN] Could not write RTDB cache:", e.message));
            }
        } catch (e) {}
        console.log(`[COLLECTION] Cached collection (${allCards.length} cards) for ID ${cleanId}`);
    }

    if (allCards.length < expectedCount && staleFallbackCards && staleFallbackCards.length > allCards.length) {
        console.warn(`[RECOVERY] Partial fetch (${allCards.length}/${expectedCount}). Serving fuller stale cache (${staleFallbackCards.length} cards).`);
        return staleFallbackCards;
    }

    return allCards;
}

/**
 * Fetches a single remote deck (Archidekt or Moxfield) with caching and rate limit retry.
 */
async function fetchSingleDeck(idStr) {
    const parsed = parseDeckIdentifier(idStr);
    if (!parsed || !parsed.id) {
        return {
            id: idStr,
            name: `Invalid Deck (${idStr})`,
            platform: 'unknown',
            url: null,
            deckFormat: 'Commander',
            error: "Invalid deck ID or link",
            cards: []
        };
    }

    const { platform, id, compositeKey } = parsed;

    // Check in-memory cache first to avoid redundant API hits
    const cached = deckCache.get(compositeKey);
    if (cached && (Date.now() - cached.timestamp < DECK_CACHE_TTL)) {
        return cached.rawDeck;
    }

    let url = `https://archidekt.com/api/decks/${id}/`;
    let webUrl = `https://archidekt.com/decks/${id}`;
    if (platform === 'moxfield') {
        url = `https://api.moxfield.com/v2/decks/all/${id}`;
        webUrl = `https://www.moxfield.com/decks/${id}`;
    }

    try {
        const r = await fetchWithRetry(url, {
            headers: {
                ...DEFAULT_HEADERS,
                "Referer": platform === 'moxfield' ? 'https://www.moxfield.com/' : 'https://archidekt.com/'
            },
            timeoutMs: 8000
        }, 2);

        if (!r || !r.ok) {
            const status = r ? r.status : "unknown";
            let errorMsg = `HTTP ${status}`;
            if (status === 404) {
                errorMsg = "Deck not found (check ID/URL or deck may be private)";
            } else if (status === 403) {
                errorMsg = platform === 'moxfield'
                    ? "Moxfield blocked automated access (Cloudflare). Use 'Paste Decklist Text' to import."
                    : "Deck is private or access restricted";
            } else if (status === 429) {
                errorMsg = "Archidekt rate limit reached (HTTP 429). Please wait a moment or use 'Paste Decklist Text'.";
            }

            return {
                id: compositeKey,
                name: `Deck ${id} (Failed to Load)`,
                platform,
                url: webUrl,
                deckFormat: 'Commander',
                error: errorMsg,
                cards: []
            };
        }

        const data = await r.json();
        const normalized = platform === 'moxfield' ? normalizeMoxfield(data) : data;
        const deckName = normalized.name || data.name || `Deck ${id}`;

        const rawDeck = {
            id: compositeKey,
            name: deckName,
            platform,
            url: webUrl,
            deckFormat: data.deckFormat || data.format || 'Commander',
            cards: normalized.cards || []
        };

        // Cache deck data and name
        deckCache.set(compositeKey, {
            timestamp: Date.now(),
            rawDeck
        });
        deckNameCache.set(compositeKey, {
            timestamp: Date.now(),
            name: deckName
        });

        return rawDeck;
    } catch (err) {
        console.error(`Error fetching deck ${idStr}:`, err.message);
        return {
            id: compositeKey,
            name: `Deck ${id} (Error)`,
            platform,
            url: webUrl,
            deckFormat: 'Commander',
            error: err.name === 'AbortError' || err.name === 'TimeoutError'
                ? 'Fetch timed out'
                : `Connection error: ${err.message}`,
            cards: []
        };
    }
}

/**
 * Finds a card in the target map that could match a split card, adventure card, or vice-versa.
 */
function findSplitMatchKey(cardToFind, cardMap) {
    if (!cardToFind || !cardMap) return null;
    const cleanFind = String(cardToFind).trim().toLowerCase();
    if (cardMap[cleanFind]) return cleanFind;

    const findParts = cleanFind.split(' // ').map(s => s.trim());
    for (const mapCardName in cardMap) {
        const cleanMapKey = String(mapCardName).trim().toLowerCase();
        if (cleanFind === cleanMapKey) return mapCardName;

        const mapParts = cleanMapKey.split(' // ').map(s => s.trim());
        if (findParts.some(p => mapParts.includes(p)) || mapParts.some(p => findParts.includes(p))) {
            return mapCardName;
        }
        if (findParts[0] === mapParts[0] || (findParts.length > 1 && mapParts[0] === findParts[1])) {
            return mapCardName;
        }
    }
    return null;
}

/**
 * Generates an 8-character lowercase alphanumeric unique identifier (e.g. 3hg030hds).
 */
function generateShortCode(len = 8) {
    const chars = "23456789abcdefghijkmnopqrstuvwxyz";
    const bytes = crypto.randomBytes(len);
    let str = "";
    for (let i = 0; i < len; i++) {
        str += chars.charAt(bytes[i] % chars.length);
    }
    return str;
}

/**
 * Endpoint: Generates a short, clean first-party sharing URL for trade binders and deck links (e.g. edhchallenge.com/3hg030hds).
 * Also resolves short codes on GET requests.
 */
exports.shortenUrl = onRequest({ cors: true, timeoutSeconds: 15, memory: "256MiB" }, async (req, res) => {
    try {
        // --- 1. RESOLVE / EXPAND SHORT LINK ---
        let lookupCode = (req.query?.code || "").toString().trim();
        if (!lookupCode && req.path) {
            const cleanedPath = req.path.replace(/^\/(?:s\/)?/, '').split('/')[0].trim();
            if (cleanedPath && cleanedPath !== 'shortenUrl') {
                lookupCode = cleanedPath;
            }
        }

        if (req.method === "GET" && lookupCode) {
            let targetUrl = null;
            try {
                if (admin.apps && admin.apps.length) {
                    const snap = await admin.database().ref(`short_links/${lookupCode}`).once('value');
                    const val = snap.val();
                    if (val && val.url) {
                        targetUrl = val.url;
                        admin.database().ref(`short_links/${lookupCode}/hits`).transaction(c => (c || 0) + 1).catch(() => {});
                    }
                }
            } catch (dbErr) {
                console.warn("[WARN] Could not lookup short link from RTDB:", dbErr.message);
            }

            if (!targetUrl) {
                return res.status(404).json({ error: "Short link not found", code: lookupCode });
            }

            const wantsJson = req.query?.json === "true" || (req.headers.accept && req.headers.accept.includes("application/json"));
            if (wantsJson) {
                return res.json({ code: lookupCode, targetUrl, url: targetUrl });
            }
            return res.redirect(302, targetUrl);
        }

        // --- 2. CREATE / SHORTEN URL ---
        const targetUrl = (req.body?.url || req.query?.url || "").trim();
        if (!targetUrl) {
            return res.status(400).json({ error: "Missing 'url' parameter" });
        }

        const host = req.headers['x-forwarded-host'] || req.headers.host || 'edhchallenge.com';
        const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
        const primaryDomain = isLocal ? `http://${host}` : 'https://edhchallenge.com';

        // Check if already a short link
        if (targetUrl.startsWith(`${primaryDomain}/`) && targetUrl.length < 50 && !targetUrl.includes('?tab=')) {
            return res.json({ shortUrl: targetUrl, targetUrl });
        }

        // Generate unique code and persist to Firebase Realtime Database
        let code = generateShortCode(8);
        try {
            if (admin.apps && admin.apps.length) {
                const existing = await admin.database().ref(`short_links/${code}`).once('value');
                if (existing.exists()) {
                    code = generateShortCode(9);
                }
                await admin.database().ref(`short_links/${code}`).set({
                    url: targetUrl,
                    createdAt: Date.now(),
                    hits: 0
                });
                const shortUrl = `${primaryDomain}/${code}`;
                return res.json({
                    code,
                    shortUrl,
                    targetUrl
                });
            }
        } catch (rtdbErr) {
            console.error("[ERROR] Failed to save short link to RTDB:", rtdbErr.message);
        }

        // Fallback: Return original targetUrl if RTDB write failed
        return res.json({ shortUrl: targetUrl, targetUrl });
    } catch (e) {
        console.error("shortenUrl endpoint error:", e);
        return res.status(500).json({ error: e.message });
    }
});

/**
 * Endpoint: Fetches all available Magic: The Gathering sets from Scryfall.
 */
exports.getSets = onRequest({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async (req, res) => {
    try {
        const sets = await fetchAllSets();
        res.set("Cache-Control", "public, max-age=3600, s-maxage=7200");
        res.status(200).json({ sets });
    } catch (error) {
        console.error("[ERROR] getSets error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Endpoint: Checks a user collection against a specific set and calculates completion statistics.
 */
exports.checkSetProgress = onRequest({ cors: true, timeoutSeconds: 120, memory: "512MiB" }, async (req, res) => {
    const {
        collectionId,
        collectionData,
        setCode,
        matchMode = "exact",
        includeBasicLands = false,
        setScope = "distinct"
    } = req.body || {};

    if (!setCode) {
        return res.status(400).json({ error: "Missing required 'setCode' parameter." });
    }

    if ((!collectionId && !collectionData)) {
        return res.status(400).json({ error: "Missing collection source. Please provide a collectionId or collectionData." });
    }

    try {
        let rawCollectionItems = [];

        // Check if collectionData has valid cards with set info
        const hasRichCollectionData = collectionData && Array.isArray(collectionData) && collectionData.length > 0 &&
            collectionData.some(c => c.setCode || c.set || c.edition || c.card?.edition);

        // Fetch collection cards and set cards in parallel to prevent gateway timeouts!
        const collectionPromise = hasRichCollectionData
            ? Promise.resolve(collectionData)
            : (collectionId ? fetchArchidektCollection(collectionId) : Promise.resolve(collectionData || []));

        const setCardsPromise = fetchSetCards(setCode);
        const allSetsPromise = fetchAllSets().catch(() => []);

        const [collectionItems, setCardsData, allSetsData] = await Promise.all([
            collectionPromise,
            setCardsPromise,
            allSetsPromise
        ]);
        rawCollectionItems = collectionItems || [];

        const shouldIncludeBasicLands = Boolean(includeBasicLands === true || includeBasicLands === 'true');

        const result = await compareCollectionToSet({
            collectionItems: rawCollectionItems,
            setCode,
            matchMode,
            includeBasicLands: shouldIncludeBasicLands,
            setScope,
            prefetchedSetCards: setCardsData,
            prefetchedAllSets: allSetsData
        });

        const mappedCachedCollection = (rawCollectionItems && rawCollectionItems.length > 0) ? rawCollectionItems.map(c => {
            const cardInfo = c.card || c || {};
            const oracleData = cardInfo.oracleCard || cardInfo;
            const set = (cardInfo.edition?.editioncode || cardInfo.edition?.code || cardInfo.edition?.editionname || c.set || c.setCode || '').toLowerCase();
            const colNum = (cardInfo.collectorNumber || cardInfo.collector_number || c.collectorNumber || c.collector_number || c.number || '').toString().trim();
            const qty = Number(c.quantity || c.count || c.owned) || 1;
            return {
                id: c.id,
                name: oracleData?.name || cardInfo.name || c.name || '',
                set: set,
                setCode: set.toUpperCase(),
                collector_number: colNum,
                collectorNumber: colNum,
                modifier: c.modifier || cardInfo.modifier || '',
                finish: c.modifier || c.finish || cardInfo.finish || '',
                foil: Boolean(c.foil || cardInfo.foil),
                quantity: qty,
                owned: qty,
                inDecks: Number(c.inDecks || cardInfo.inDecks) || 0,
                prices: cardInfo.prices || c.prices || null
            };
        }) : undefined;

        res.status(200).json({
            ...result,
            cachedCollectionData: mappedCachedCollection
        });
    } catch (error) {
        console.error("[ERROR] checkSetProgress error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Endpoint: Computes deep collection analytics and insights (values, crown jewels, colors, staples).
 */
exports.getCollectionInsights = onRequest({ cors: true, timeoutSeconds: 120, memory: "512MiB" }, async (req, res) => {
    const {
        collectionId,
        collectionData
    } = req.body || {};

    if (!collectionId && !collectionData) {
        return res.status(400).json({ error: "Missing collection source. Please provide a collectionId or collectionData." });
    }

    try {
        let rawCollectionItems = [];
        if (collectionData && Array.isArray(collectionData)) {
            rawCollectionItems = collectionData;
        } else if (collectionId) {
            rawCollectionItems = await fetchArchidektCollection(collectionId);
        }

        const insights = await computeCollectionInsights(rawCollectionItems);

        const mappedCollection = rawCollectionItems.map(c => {
            const cardInfo = c.card || c || {};
            const oracleData = cardInfo.oracleCard || cardInfo;
            const name = oracleData.name || cardInfo.name || c.name || '';
            const owned = Math.max(1, parseInt(c.quantity || c.count || c.owned) || 1);
            const inDecks = Math.max(0, parseInt(c.inDecks || c.in_decks || cardInfo.inDecks || 0) || 0);
            const set = (cardInfo.edition?.editioncode || cardInfo.edition?.code || c.set || c.setCode || '').toLowerCase();
            const setCode = set.toUpperCase();
            const colNum = (cardInfo.collectorNumber || cardInfo.collector_number || c.collectorNumber || c.collector_number || c.number || '').toString().trim();
            return {
                id: c.id || Math.random(),
                name,
                owned,
                quantity: owned,
                inDecks,
                available: Math.max(0, owned - inDecks),
                set,
                setCode,
                collector_number: colNum,
                collectorNumber: colNum,
                colors: normalizeColorCodes(oracleData.colors || oracleData.colorIdentity || oracleData.color_identity || cardInfo.colors || cardInfo.color_identity || c.colors || c.color_identity || []),
                typeLine: oracleData.type_line || cardInfo.type_line || c.type_line || '',
                isCommander: Boolean(oracleData.isCommander || cardInfo.isCommander || c.isCommander),
                prices: cardInfo.prices || c.prices || null
            };
        });

        res.status(200).json({
            ...insights,
            collection: mappedCollection,
            cachedCollectionData: mappedCollection
        });
    } catch (error) {
        console.error("[ERROR] getCollectionInsights error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * The main Cloud Function. Fetches and compares a collection against decklists.
 * Returns both the reconciled collection inventory and detailed per-deck card breakdowns.
 */
exports.compareDecks = onRequest({ cors: true, timeoutSeconds: 300, memory: "512MiB" }, async (req, res) => {
    const {
        collectionId,
        deckIds,
        customDecks,
        includeSideboards,
        includeBasicLands,
        collectionData,
        sortCommanders
    } = req.body || {};

    if ((!collectionId && !collectionData) || (!deckIds && !customDecks)) {
        return res.status(400).json({ error: "Missing collection source or decks to compare." });
    }

    const shouldIncludeBasicLands = Boolean(includeBasicLands === true || includeBasicLands === 'true');
    const shouldIncludeSideboards = Boolean(includeSideboards !== false && includeSideboards !== 'false');

    try {
        let collection = {};

        // --- 1. Fetch and Parse Collection ---
        if (collectionData && Array.isArray(collectionData)) {
            const enrichedCollectionData = await enrichCardsWithScryfall(collectionData);
            collection = parseCards({ cards: enrichedCollectionData }, { includeBasicLands: shouldIncludeBasicLands });
        } else if (collectionId) {
            const allCollectionCards = await fetchArchidektCollection(collectionId);
            collection = parseCards({ cards: allCollectionCards }, { includeBasicLands: shouldIncludeBasicLands });
        }

        // --- 2. Fetch and Parse Decklists ---
        const idList = deckIds ? deckIds.split(',').map(id => id.trim()).filter(id => id.length > 0) : [];
        const rawDeckObjects = [];

        // Fetch remote decks with sequential throttling (concurrency: 1, delay: 350ms) to stay within Archidekt rate limits
        if (idList.length > 0) {
            const deckTaskFns = idList.map(idStr => () => fetchSingleDeck(idStr));
            const fetchedDecks = await runWithConcurrency(deckTaskFns, 1, 350);
            rawDeckObjects.push(...fetchedDecks);
        }

        // Add any custom / pasted decklists passed in the request
        if (Array.isArray(customDecks)) {
            for (const customDeck of customDecks) {
                if (customDeck.text) {
                    const parsedTextDeck = parseDecklistText(customDeck.text, customDeck.name || "Custom Deck");
                    rawDeckObjects.push({
                        id: customDeck.id || `custom:${Date.now()}`,
                        name: customDeck.name || "Custom Deck",
                        platform: "custom",
                        url: null,
                        deckFormat: customDeck.deckFormat || "Commander",
                        cards: parsedTextDeck.cards
                    });
                } else if (customDeck.cards) {
                    rawDeckObjects.push({
                        id: customDeck.id || `custom:${Date.now()}`,
                        name: customDeck.name || "Custom Deck",
                        platform: "custom",
                        url: null,
                        deckFormat: customDeck.deckFormat || "Commander",
                        cards: customDeck.cards
                    });
                }
            }
        }

        if (rawDeckObjects.length === 0) {
            throw new Error("No valid decks could be loaded.");
        }

        // --- 3. Parse Decks Individually & Aggregate Cards ---
        const allDeckCards = {};
        const parsedDecksList = [];

        for (const rawDeck of rawDeckObjects) {
            const parsedCardMap = parseCards(rawDeck, {
                isDeck: true,
                includeSideboards: shouldIncludeSideboards,
                includeBasicLands: shouldIncludeBasicLands
            });

            parsedDecksList.push({
                raw: rawDeck,
                parsedCards: parsedCardMap
            });

            const deckName = rawDeck.name || "Unknown Deck";

            for (const [cleanName, data] of Object.entries(parsedCardMap)) {
                if (!allDeckCards[cleanName]) {
                    allDeckCards[cleanName] = {
                        total: 0,
                        breakdown: {},
                        originalName: data.originalName,
                        colors: data.colors,
                        isCommander: data.isCommander,
                        edhrecRank: data.edhrecRank,
                        typeLine: data.typeLine,
                        manaCost: data.manaCost,
                        category: data.category
                    };
                }
                allDeckCards[cleanName].total += data.quantity;
                allDeckCards[cleanName].breakdown[deckName] = (allDeckCards[cleanName].breakdown[deckName] || 0) + data.quantity;
            }
        }

        // --- 4. Reconcile Split Cards between Collection and Decks ---
        for (const deckKey of Object.keys(allDeckCards)) {
            if (!collection[deckKey]) {
                const matchKey = findSplitMatchKey(deckKey, collection);
                if (matchKey) {
                    if (!allDeckCards[matchKey]) {
                        allDeckCards[matchKey] = allDeckCards[deckKey];
                    } else {
                        allDeckCards[matchKey].total += allDeckCards[deckKey].total;
                        for (const [dName, qty] of Object.entries(allDeckCards[deckKey].breakdown)) {
                            allDeckCards[matchKey].breakdown[dName] = (allDeckCards[matchKey].breakdown[dName] || 0) + qty;
                        }
                    }
                    delete allDeckCards[deckKey];
                }
            }
        }

        for (const collKey of Object.keys(collection)) {
            if (!allDeckCards[collKey]) {
                const matchKey = findSplitMatchKey(collKey, allDeckCards);
                if (matchKey) {
                    if (!collection[matchKey]) {
                        collection[matchKey] = collection[collKey];
                    } else {
                        collection[matchKey].quantity += collection[collKey].quantity;
                    }
                    delete collection[collKey];
                }
            }
        }

        // --- 5. Discover Commanders & Fetch EDHREC Popularity Ranks ---
        const potentialCommanderNames = new Set();
        for (const card of Object.values(collection)) {
            if (card.isCommander) potentialCommanderNames.add(card.originalName);
        }
        for (const card of Object.values(allDeckCards)) {
            if (card.isCommander) potentialCommanderNames.add(card.originalName);
        }

        const edhrecRanks = (sortCommanders !== false)
            ? await fetchEdhrecRanks(Array.from(potentialCommanderNames))
            : {};

        // --- 6. Build Detailed Per-Deck Breakdown ---
        const detailedDecks = [];
        let grandTotalCardsNeeded = 0;
        let grandTotalCardsOwned = 0;
        let grandTotalCardsMissing = 0;

        for (const deckEntry of parsedDecksList) {
            const rawDeck = deckEntry.raw;
            const parsedCards = deckEntry.parsedCards;

            const deckCards = [];
            let deckTotalCards = 0;
            let deckOwnedCards = 0;
            let deckMissingCards = 0;

            for (const [cleanName, cardData] of Object.entries(parsedCards)) {
                let collItem = collection[cleanName];
                if (!collItem) {
                    const matchKey = findSplitMatchKey(cleanName, collection);
                    if (matchKey) collItem = collection[matchKey];
                }

                const ownedInCollection = collItem ? collItem.quantity : 0;
                const neededInDeck = cardData.quantity;
                const missingForDeck = Math.max(0, neededInDeck - ownedInCollection);
                const status = ownedInCollection >= neededInDeck ? "owned" : (ownedInCollection > 0 ? "partial" : "missing");

                deckTotalCards += neededInDeck;
                deckOwnedCards += Math.min(ownedInCollection, neededInDeck);
                deckMissingCards += missingForDeck;

                deckCards.push({
                    name: cardData.originalName,
                    cleanName: cleanName,
                    quantity: neededInDeck,
                    owned: ownedInCollection,
                    missing: missingForDeck,
                    status: status,
                    category: cardData.category || "Other",
                    colors: cardData.colors || [],
                    typeLine: cardData.typeLine || "",
                    manaCost: cardData.manaCost || "",
                    isCommander: Boolean(cardData.isCommander || edhrecRanks[cleanName]),
                    edhrecRank: cardData.edhrecRank || null
                });
            }

            // Sort cards: Category and Name
            const categoryOrder = { 'Creatures': 1, 'Planeswalkers': 2, 'Instants': 3, 'Sorceries': 4, 'Artifacts': 5, 'Enchantments': 6, 'Battles': 7, 'Lands': 8, 'Sideboard': 9, 'Maybeboard': 10, 'Other': 11 };
            deckCards.sort((a, b) => {
                const catA = categoryOrder[a.category] || 99;
                const catB = categoryOrder[b.category] || 99;
                if (catA !== catB) return catA - catB;
                return a.name.localeCompare(b.name);
            });

            const pctComplete = deckTotalCards > 0 ? Number(((deckOwnedCards / deckTotalCards) * 100).toFixed(1)) : 0;

            detailedDecks.push({
                id: rawDeck.id,
                name: rawDeck.name,
                platform: rawDeck.platform,
                url: rawDeck.url,
                deckFormat: rawDeck.deckFormat || 'Commander',
                error: rawDeck.error || null,
                totalCards: deckTotalCards,
                ownedCards: deckOwnedCards,
                missingCards: deckMissingCards,
                percentComplete: pctComplete,
                cards: deckCards
            });

            grandTotalCardsNeeded += deckTotalCards;
            grandTotalCardsOwned += deckOwnedCards;
            grandTotalCardsMissing += deckMissingCards;
        }

        // --- 7. Compare and Generate Aggregate Collection Results ---
        const results = [];
        const allKeys = new Set([...Object.keys(collection), ...Object.keys(allDeckCards)]);

        for (const cleanName of allKeys) {
            const deckInfo = allDeckCards[cleanName] || { total: 0, breakdown: {}, colors: [], isCommander: false, edhrecRank: null, typeLine: '', manaCost: '', category: 'Other' };
            const collData = collection[cleanName];

            const ownedQty = collData ? collData.quantity : 0;
            const inDecksQty = deckInfo.total;

            if (ownedQty === 0 && inDecksQty === 0) {
                continue;
            }

            const originalName = collData?.originalName || deckInfo.originalName || cleanName;
            const colors = (collData?.colors && collData.colors.length > 0) ? collData.colors : (deckInfo.colors || []);
            const isCommander = Boolean(collData?.isCommander || deckInfo.isCommander || edhrecRanks[cleanName]);
            const edhrecRank = collData?.edhrecRank || deckInfo.edhrecRank || null;

            let commanderRank = null;
            if (isCommander && edhrecRanks[cleanName]) {
                commanderRank = edhrecRanks[cleanName];
            }

            results.push({
                name: originalName,
                owned: ownedQty,
                inDecks: inDecksQty,
                inDecksBreakdown: deckInfo.breakdown,
                set: collData?.set || '',
                setCode: collData?.setCode || '',
                collectorNumber: collData?.collectorNumber || '',
                collector_number: collData?.collectorNumber || '',
                finish: collData?.finish || 'Normal',
                modifier: collData?.modifier || '',
                isFoil: Boolean(collData?.isFoil),
                foil: Boolean(collData?.foil),
                colors: colors,
                typeLine: deckInfo.typeLine || collData?.typeLine || '',
                manaCost: deckInfo.manaCost || collData?.manaCost || '',
                category: deckInfo.category || collData?.category || 'Other',
                isCommander: isCommander,
                edhrecRank: edhrecRank,
                edhrecCommanderRank: commanderRank,
            });
        }

        results.sort((a, b) => a.name.localeCompare(b.name));

        // --- 8. Calculate Trivia ---
        let mostPopularUnusedCard = null;
        const unusedCardsWithRank = results.filter((c) =>
            c.owned > 0 &&
            c.inDecks === 0 &&
            c.edhrecRank !== null &&
            c.edhrecRank > 0
        );

        if (unusedCardsWithRank.length > 0) {
            unusedCardsWithRank.sort((a, b) => a.edhrecRank - b.edhrecRank);
            mostPopularUnusedCard = unusedCardsWithRank[0];
        }

        console.log(`[INFO] Comparison complete. Compared ${detailedDecks.length} decks with ${results.length} unique collection items.`);

        const deckSummary = {
            totalDecks: detailedDecks.length,
            totalCardsNeeded: grandTotalCardsNeeded,
            totalCardsOwned: grandTotalCardsOwned,
            totalCardsMissing: grandTotalCardsMissing,
            avgPercentComplete: detailedDecks.length > 0
                ? Number((detailedDecks.reduce((acc, d) => acc + d.percentComplete, 0) / detailedDecks.length).toFixed(1))
                : 0
        };

        res.status(200).json({
            collection: results,
            decks: detailedDecks,
            deckSummary,
            trivia: { mostPopularUnusedCard }
        });
    } catch (error) {
        console.error("[ERROR] Comparison error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Lightweight proxy to fetch a single deck's name (bypasses CORS) with caching & rate limit retry
exports.getDeckName = onRequest({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async (req, res) => {
    const rawId = req.query?.id || req.body?.id;
    const platformParam = req.query?.platform || req.body?.platform;
    if (!rawId) return res.status(400).json({ error: "Missing deck ID" });

    try {
        const parsed = parseDeckIdentifier(platformParam ? `${platformParam}:${rawId}` : rawId);
        if (!parsed || !parsed.id) return res.status(400).json({ error: "Invalid deck ID" });

        const { platform, id, compositeKey } = parsed;

        if (platform === 'custom') {
            return res.status(200).json({ name: id || 'Custom Deck' });
        }

        // Check memory cache
        const cached = deckNameCache.get(compositeKey);
        if (cached && (Date.now() - cached.timestamp < DECK_NAME_CACHE_TTL)) {
            res.set("Cache-Control", "public, max-age=3600");
            return res.status(200).json({ name: cached.name });
        }

        const deckInCache = deckCache.get(compositeKey);
        if (deckInCache && (Date.now() - deckInCache.timestamp < DECK_CACHE_TTL)) {
            res.set("Cache-Control", "public, max-age=3600");
            return res.status(200).json({ name: deckInCache.rawDeck.name });
        }

        let url = `https://archidekt.com/api/decks/${id}/`;
        if (platform === 'moxfield') {
            url = `https://api.moxfield.com/v2/decks/all/${id}`;
        }

        const fetchRes = await fetchWithRetry(url, {
            headers: {
                ...DEFAULT_HEADERS,
                "Referer": platform === 'moxfield' ? 'https://www.moxfield.com/' : 'https://archidekt.com/'
            },
            timeoutMs: 8000
        }, 2);

        if (!fetchRes || !fetchRes.ok) {
            const status = fetchRes ? fetchRes.status : "unknown";
            const fallbackName = platform === 'moxfield' ? `Moxfield (${id})` : `Deck #${id}`;
            return res.status(200).json({ name: fallbackName, warning: `Remote returned HTTP ${status}` });
        }

        const data = await fetchRes.json();
        const deckName = data.name || `Deck ${id}`;

        deckNameCache.set(compositeKey, {
            timestamp: Date.now(),
            name: deckName
        });

        res.set("Cache-Control", "public, max-age=3600");
        return res.status(200).json({ name: deckName });
    } catch (error) {
        console.error("getDeckName error:", error);
        const fallback = String(rawId).split('/')[0].split('?')[0];
        return res.status(200).json({ name: `Deck ${fallback}`, warning: error.message });
    }
});

/**
 * Endpoint: Real-time search of Archidekt community decks matching a specific commander or keyword.
 * Fetches the top-rated decks and returns their full cardlists for collection matching.
 */
exports.searchCommanderDecks = onRequest({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async (req, res) => {
    if (req.method === "OPTIONS") {
        return res.status(204).send("");
    }
    const { commander, count = 8, orderBy = "-viewCount" } = req.body || req.query || {};
    if (!commander) {
        return res.status(400).json({ error: "Missing commander name" });
    }

    try {
        // Strip epithet if comma separated (e.g. "Wilhelt, the Rotcleaver" -> "Wilhelt") for broader Archidekt search
        const cleanName = commander.includes(',') ? commander.split(',')[0].trim() : commander.trim();
        const searchUrl = `https://archidekt.com/api/decks/v3/?name=${encodeURIComponent(cleanName)}&orderBy=${encodeURIComponent(orderBy)}&pageSize=15&formats=3`;
        
        const searchRes = await fetchWithRetry(searchUrl, {
            headers: { ...DEFAULT_HEADERS, "Referer": "https://archidekt.com/" },
            timeoutMs: 9000
        }, 2);

        if (!searchRes || !searchRes.ok) {
            const status = searchRes ? searchRes.status : "unknown";
            return res.status(502).json({ error: `Archidekt search returned HTTP ${status}` });
        }

        const searchData = await searchRes.json();
        const results = searchData.results || [];

        // Exclude precon accounts so we get genuine player/community builds
        const candidateDecks = results.filter(d => {
            const owner = (d.owner?.username || '').toLowerCase();
            const name = (d.name || '').toLowerCase();
            if (owner.includes('precon') || owner === 'archidekt_precons') return false;
            if (name.includes('commander deck') && (name.includes('commander 20') || name.includes('precon'))) return false;
            return true;
        }).slice(0, Math.min(Number(count) || 8, 10));

        if (candidateDecks.length === 0) {
            return res.status(200).json({ decks: [], message: `No community decks found for "${cleanName}"` });
        }

        // Fetch candidate deck details with concurrency
        const fetchTasks = candidateDecks.map(meta => async () => {
            try {
                const dUrl = `https://archidekt.com/api/decks/${meta.id}/`;
                const dRes = await fetchWithRetry(dUrl, {
                    headers: { ...DEFAULT_HEADERS, "Referer": "https://archidekt.com/" },
                    timeoutMs: 9000
                }, 2);
                if (!dRes || !dRes.ok) return null;
                const d = await dRes.json();

                const commanderCards = (d.cards || []).filter(c => Array.isArray(c.categories) && c.categories.includes('Commander'));
                const actualCommanderName = commanderCards[0]?.card?.oracleCard?.name || commanderCards[0]?.card?.name || commander;
                const commanderColors = commanderCards[0]?.card?.oracleCard?.colors || commanderCards[0]?.card?.colors || [];

                const mainCards = (d.cards || []).filter(c => {
                    const cats = c.categories || [];
                    return !cats.includes('Maybeboard') && !cats.includes('Sideboard');
                });

                const cards = mainCards.map(c => {
                    const name = c.card?.oracleCard?.name || c.card?.name || '';
                    const qty = Number(c.quantity || 1);
                    const type = c.card?.oracleCard?.typeLine || c.card?.typeLine || 'Card';
                    const price = Number(c.card?.prices?.tcg?.normal || c.card?.prices?.ck?.normal || 0.75);
                    return { name, quantity: qty, type, price };
                }).filter(c => c.name.length > 0);

                const featuredImg = d.featured || `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(actualCommanderName)}&format=image&version=art_crop`;

                return {
                    id: `archidekt-${d.id}`,
                    name: d.name,
                    commander: actualCommanderName,
                    type: 'community',
                    platform: 'archidekt',
                    creator: d.owner?.username || 'Community Deckbuilder',
                    views: d.viewCount || meta.viewCount || 0,
                    colors: commanderColors,
                    imageUrl: featuredImg,
                    sourceUrl: `https://archidekt.com/decks/${d.id}`,
                    theme: `Archidekt Deck by ${d.owner?.username || 'Community'} (${(d.viewCount || 0).toLocaleString()} views)`,
                    strategy: d.description ? d.description.slice(0, 180) + '...' : `Top-rated ${actualCommanderName} Commander deck on Archidekt with ${(d.viewCount || 0).toLocaleString()} views.`,
                    cardCount: cards.reduce((acc, c) => acc + c.quantity, 0),
                    decklist: cards.map(c => `${c.quantity} ${c.name}`).join('\n'),
                    cards
                };
            } catch (err) {
                console.warn(`[WARN] Error fetching deck ${meta.id}:`, err.message);
                return null;
            }
        });

        const fetchedDecks = (await runWithConcurrency(fetchTasks, 3, 200)).filter(Boolean);
        return res.status(200).json({ decks: fetchedDecks });
    } catch (error) {
        console.error("[ERROR] searchCommanderDecks error:", error);
        return res.status(500).json({ error: error.message });
    }
});

// Gemini AI-Powered Deck Optimization Assistant
exports.suggestImprovements = onRequest({ cors: true, timeoutSeconds: 120, memory: "512MiB" }, async (req, res) => {
    if (req.method === "OPTIONS") {
        return res.status(204).send("");
    }

    try {
        const body = req.body || {};
        const { deck, collection, apiKey: clientApiKey, deckGoal } = body;

        if (!deck || !deck.cards || !Array.isArray(deck.cards) || deck.cards.length === 0) {
            return res.status(400).json({ error: "Missing deck cards data for AI analysis." });
        }

        if (!collection || !Array.isArray(collection) || collection.length === 0) {
            return res.status(400).json({ error: "Missing collection cards data for AI analysis." });
        }

        // Determine API key
        const apiKey = clientApiKey || process.env.GEMINI_API_KEY;

        // 1. Identify Deck Details & Color Identity
        const deckCards = deck.cards || [];
        const deckName = deck.name || "My Deck";
        const formatIdMap = {
            1: 'Standard', 2: 'Modern', 3: 'Commander / EDH', 4: 'Legacy', 5: 'Vintage',
            6: 'Pauper', 7: 'Custom', 8: 'Frontier', 9: 'Future Standard', 10: 'Penny Dreadful',
            11: '1v1 Commander', 12: 'Duel Commander', 13: 'Brawl', 14: 'Oathbreaker',
            15: 'Pioneer', 16: 'Historic', 17: 'Pauper EDH', 18: 'Alchemy', 19: 'Explorer',
            20: 'Premodern', 21: 'Predh', 22: 'Timeless'
        };
        const rawFormat = deck.deckFormat !== undefined ? deck.deckFormat : (deck.format !== undefined ? deck.format : 'Commander');
        const deckFormat = typeof rawFormat === 'number' ? (formatIdMap[rawFormat] || `Format #${rawFormat}`) : String(rawFormat || 'Commander');
        const formatLower = deckFormat.toLowerCase();
        const commanders = deck.commanders || deck.commander || [];

        const deckColorSet = new Set();
        (deck.colors || []).forEach(c => deckColorSet.add(c.toUpperCase()));
        deckCards.forEach(c => {
            (c.colors || []).forEach(col => deckColorSet.add(col.toUpperCase()));
        });
        const deckColors = Array.from(deckColorSet);

        // Deck cards set for quick lookup
        const deckCardMap = new Map();
        deckCards.forEach(c => {
            const clean = (c.cleanName || c.name || '').toLowerCase().trim();
            deckCardMap.set(clean, (deckCardMap.get(clean) || 0) + (c.quantity || 1));
        });

        // 2. Filter Candidate Cards from Collection
        const candidates = [];
        const basicLands = new Set(['island', 'plains', 'swamp', 'mountain', 'forest', 'wastes']);

        collection.forEach(c => {
            const clean = (c.cleanName || c.name || '').toLowerCase().trim();
            if (basicLands.has(clean)) return;
            const typeLower = (c.typeLine || '').toLowerCase();
            if (typeLower.includes('basic land')) return;

            const owned = c.owned !== undefined ? c.owned : 1;
            const totalInDecks = c.inDecks !== undefined ? c.inDecks : (c.in_decks !== undefined ? c.in_decks : (deckCardMap.get(clean) || 0));
            const inCurrentDeck = deckCardMap.get(clean) || 0;
            const availableUnused = Math.max(0, owned - totalInDecks);

            // Must have strictly unused available copies in the collection (not in this deck or other decks)
            if (availableUnused <= 0) return;

            const isSingleton = formatLower.includes('commander') || formatLower.includes('edh') || formatLower.includes('brawl') || formatLower.includes('oathbreaker');

            // If singleton format and already in this deck, cannot add another copy
            if (isSingleton && inCurrentDeck > 0) return;
            // If regular format and 4 copies already in this deck, cannot add more
            if (!isSingleton && inCurrentDeck >= 4) return;

            // Check color compatibility
            const cardColors = (c.colors || []).map(col => col.toUpperCase());
            // Colorless cards are always compatible
            let isColorCompatible = true;
            if (cardColors.length > 0 && deckColors.length > 0) {
                isColorCompatible = cardColors.every(col => deckColorSet.has(col));
            }
            if (!isColorCompatible) return;

            candidates.push({
                name: c.originalName || c.name,
                typeLine: c.typeLine || c.category || 'Spell',
                category: c.category || 'Other',
                manaCost: c.manaCost || '',
                colors: c.colors || [],
                owned: owned,
                available: availableUnused,
                edhrecRank: c.edhrecRank || c.edhrecCommanderRank || 999999
            });
        });

        // Sort candidates by popularity / power (EDHREC rank)
        candidates.sort((a, b) => a.edhrecRank - b.edhrecRank);
        // Top Candidates pool
        const topCandidates = candidates.slice(0, 150);

        console.log(`[AI] Analyzing deck "${deckName}" (${deckFormat}) with ${deckCards.length} cards against ${topCandidates.length} candidate collection cards. Stated Goal: "${deckGoal || 'General Optimization'}"`);

        let analysis = null;

        // If Gemini API Key is provided, try Gemini 3.6 Flash
        if (apiKey) {
            try {
                const ai = new GoogleGenAI({ apiKey });
                const prompt = `You are a world-class Magic: The Gathering deck building AI, format expert, and strategic coach.
Analyze the following deck and determine if any cards from the player's available collection can improve it.

DECK INFORMATION:
- Name: "${deckName}"
- Format: ${deckFormat}
- Commander(s): ${commanders.length > 0 ? (Array.isArray(commanders) ? commanders.join(', ') : commanders) : 'None / Standard Deck'}
- Colors: ${deckColors.join(', ') || 'Colorless'}
- Total Cards in Deck: ${deckCards.reduce((acc, c) => acc + (c.quantity || 1), 0)}

PLAYER'S CUSTOM DECK GOAL & STRATEGY FOCUS:
"${deckGoal ? deckGoal : 'Synergy maximization, curve lowering, gameplan consistency, and strategic upgrades.'}"

CURRENT DECK CARD LIST:
${deckCards.map(c => `- ${c.quantity || 1}x ${c.name} (${c.typeLine || c.category || 'Spell'}, Cost: ${c.manaCost || 'N/A'}, Category: ${c.category || 'Main'})`).join('\n')}

AVAILABLE COLLECTION CARDS (Candidates to consider adding):
${topCandidates.length > 0 ? topCandidates.map(c => `- ${c.name} (${c.typeLine}, Cost: ${c.manaCost || 'N/A'})`).join('\n') : 'No unused compatible cards in collection.'}

CRITICAL RULES & INSTRUCTIONS:
1. FOCUS ON TRUE DECK SYNERGY AND THE PLAYER'S STATED GOAL. DO NOT simply recommend generic EDHREC staples (like Sol Ring or Arcane Signet) unless they directly and uniquely advance this specific deck's theme, mechanic, or tribe.
2. Examine the deck's gameplan, creature types/tribes, synergies, curve, card advantage, interaction, and win conditions.
3. Select between 0 and 6 meaningful upgrade cards STRICTLY from the "AVAILABLE COLLECTION CARDS" list that make genuine sense in this deck.
4. For each recommended card to add:
   - Identify the BEST specific card currently in the deck to CUT/SWAP out (e.g. an off-tribe creature, an inefficient high-CMC spell, or a redundant piece).
   - In "whyAdd", explain specifically how the card's mechanics, keywords, and abilities synergize with the deck and fulfill the player's goal. AVOID generic filler phrases.
   - In "whySwap", provide a direct comparative analysis between [recommendedCut] and [addCardName] (comparing mana cost, speed, synergy, and game impact).
   - Provide 1-2 alternative cuts from the deck.
5. If the deck is already optimal for the stated goal and no collection cards improve it, set "hasImprovements" to false and write a detailed "noImprovementsReason".
6. Return ONLY a valid JSON object matching the schema below.

JSON SCHEMA:
{
  "overallAssessment": "2-3 sentence overview of the deck's archetype, core strength, how it relates to the player's stated goal, and identified areas for improvement.",
  "deckArchetype": "Short label (e.g. Wilhelt Aristocrats, Dimir Control, Spellslinger, Casual Bracket, etc.)",
  "hasImprovements": boolean,
  "noImprovementsReason": "Explanation if hasImprovements is false",
  "suggestions": [
    {
      "addCardName": "Exact name of card from available collection to add",
      "category": "Category name (e.g. Tribal Synergy, Card Advantage, Interaction & Removal, Mana Ramp, Synergy Engine, Win Condition, Mana Base)",
      "impactRating": "High" | "Medium" | "Synergy",
      "whyAdd": "Detailed, specific MTG mechanical explanation of why this card belongs in this deck.",
      "recommendedCut": "Exact name of a card currently in the deck to remove",
      "whySwap": "Detailed comparative analysis of why replacing [recommendedCut] with [addCardName] elevates the deck's performance.",
      "alternativeCuts": ["Alternative Card 1 in deck", "Alternative Card 2 in deck"]
    }
  ]
}`;

                const response = await ai.models.generateContent({
                    model: "gemini-3.6-flash",
                    contents: prompt,
                    config: {
                        responseMimeType: "application/json",
                        temperature: 0.2
                    }
                });

                const text = response.text;
                try {
                    analysis = JSON.parse(text);
                } catch (parseErr) {
                    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
                    analysis = JSON.parse(cleaned);
                }
                if (analysis) {
                    analysis.engine = 'gemini';
                }
            } catch (geminiErr) {
                console.warn("[AI] Gemini API returned error, activating Built-in MTG Synergy & Archetype Engine:", geminiErr.message);
            }
        }

        // If no Gemini key or Gemini fallback, run the Comprehensive MTG Synergy Engine
        if (!analysis) {
            analysis = generateBuiltInImprovements(deck, collection, deckColors, candidates, deckGoal);
            analysis.engine = 'synergy_analyzer';
        }

        res.status(200).json({
            success: true,
            analysis
        });
    } catch (err) {
        console.error("[AI] Deck optimization error:", err);
        res.status(500).json({ error: err.message || "Failed to analyze deck improvements." });
    }
});

// ==================== ROBUST MTG STRATEGY & UPGRADE ENGINE ====================

function extractSubtypes(typeLine) {
    if (!typeLine) return [];
    const parts = typeLine.toLowerCase().split(/[—\-]/);
    if (parts.length < 2) return [];
    return parts[1].trim().split(/\s+/).map(s => s.replace(/[^a-z0-9]/g, '')).filter(Boolean);
}

function parseCmc(manaCost) {
    if (!manaCost) return 0;
    let cmc = 0;
    const numMatch = manaCost.match(/\{(\d+)\}/);
    if (numMatch) cmc += parseInt(numMatch[1], 10);
    const colorMatches = manaCost.match(/\{[WUBRGCSX]\}/gi);
    if (colorMatches) cmc += colorMatches.length;
    return cmc;
}

function classifyCard(card) {
    const name = (card.name || '').toLowerCase();
    const type = (card.typeLine || card.category || '').toLowerCase();
    const cmc = card.cmc !== undefined ? card.cmc : parseCmc(card.manaCost);
    const subtypes = extractSubtypes(card.typeLine);

    if (type.includes('land')) {
        return { role: 'Lands', tier: 'base', cmc, subtypes };
    }

    if (name.includes('counterspell') || name.includes('mana drain') || name.includes('swan song') || name.includes('fierce guardianship') || name.includes('force of will') || name.includes('force of negation') || name.includes('pact of negation') || name.includes('an offer you can\'t refuse') || name.includes('flusterstorm') || name.includes('negate') || name.includes('dovin\'s veto') || name.includes('delay') || name.includes('arcane denial') || name.includes('spell pierce') || name.includes('misdirection') || name.includes('stubborn denial')) {
        return { role: 'Counterspells', tier: 'premium_interaction', cmc, subtypes, desc: 'Efficient counter protection' };
    }
    if (name.includes('cancel') || name.includes('dissolve') || name.includes('dissipate') || name.includes('sinister sabotage') || name.includes('neutralize') || name.includes('render silent') || name.includes('disdainful stroke') || name.includes('essence scatter') || name.includes('devious cover-up') || name.includes('did not finish') || name.includes('hornswoggle') || name.includes('spell snip')) {
        return { role: 'Counterspells', tier: 'clunky_interaction', cmc, subtypes, desc: 'Overcosted counterspell' };
    }

    if (name.includes('swords to plowshares') || name.includes('path to exile') || name.includes('deadly rollick') || name.includes('snuff out') || name.includes('infernal grasp') || name.includes('feed the swarm') || name.includes('bitter triumph') || name.includes('dismember') || name.includes('pongify') || name.includes('rapid hybridization') || name.includes('reality shift') || name.includes('nature\'s claim') || name.includes('abrupt decay') || name.includes('assassin\'s trophy') || name.includes('beast within') || name.includes('chaos warp') || name.includes('generous gift') || name.includes('anguished unmaking') || name.includes('lightning bolt') || name.includes('unholy heat') || name.includes('cut down') || name.includes('go for the throat') || name.includes('sheoldred\'s edict')) {
        return { role: 'Spot Removal', tier: 'premium_interaction', cmc, subtypes, desc: 'Efficient spot removal' };
    }
    if (name.includes('murder') || name.includes('hero\'s downfall') || name.includes('doom blade') || name.includes('cast down') || name.includes('walk the plank') || name.includes('bake into a pie') || name.includes('price of fame') || name.includes('vraska\'s contempt') || name.includes('eat to extinction') || name.includes('oblivion ring') || name.includes('banishing light') || name.includes('annihilating glare') || name.includes('blood curdle')) {
        return { role: 'Spot Removal', tier: 'clunky_interaction', cmc, subtypes, desc: 'Overcosted / narrow removal' };
    }

    if (name.includes('toxic deluge') || name.includes('blasphemous act') || name.includes('cyclonic rift') || name.includes('farewell') || name.includes('wrath of god') || name.includes('damnation') || name.includes('supreme verdict') || name.includes('vanquish the horde') || name.includes('meathook massacre') || name.includes('austere command')) {
        return { role: 'Board Wipes', tier: 'premium_wipe', cmc, subtypes, desc: 'High-efficiency board wipe' };
    }
    if (name.includes('plague wind') || name.includes('in garruk\'s wake') || name.includes('planar cleansing') || name.includes('cleansing nova') || name.includes('fumigate') || name.includes('day of judgment') || name.includes('rout') || name.includes('phyrexian rebirth')) {
        return { role: 'Board Wipes', tier: 'clunky_wipe', cmc, subtypes, desc: 'High-cost board wipe' };
    }

    if (name.includes('sol ring') || name.includes('mana crypt') || name.includes('arcane signet') || name.includes('talisman of') || name.includes('signet') || name.includes('fellwar stone') || name.includes('mind stone') || name.includes('thought vessel') || name.includes('nature\'s lore') || name.includes('three visits') || name.includes('farseek') || name.includes('wild growth') || name.includes('utopia sprawl') || name.includes('birds of paradise') || name.includes('llanowar elves') || name.includes('elvish mystic') || name.includes('fyndhorn elves') || name.includes('delighted halfling') || name.includes('rampant growth')) {
        return { role: 'Mana Ramp', tier: 'premium_ramp', cmc, subtypes, desc: 'Low-cost mana accelerator' };
    }
    if (name.includes('commander\'s sphere') || name.includes('manalith') || name.includes('darksteel ingot') || name.includes('cluestone') || name.includes('locket') || name.includes('keyrune') || name.includes('obelisk of') || name.includes('cultivate') || name.includes('kodama\'s reach') || name.includes('circuitous route') || name.includes('explosive vegetation') || name.includes('spinning wheel') || name.includes('letter of acceptance')) {
        return { role: 'Mana Ramp', tier: 'clunky_ramp', cmc, subtypes, desc: '3+ CMC slow ramp piece' };
    }

    if (name.includes('rhystic study') || name.includes('mystic remora') || name.includes('sylvan library') || name.includes('esper sentinel') || name.includes('necropotence') || name.includes('phyrexian arena') || name.includes('black market connections') || name.includes('trouble in pairs') || name.includes('skullclamp') || name.includes('night\'s whisper') || name.includes('sign in blood') || name.includes('ponder') || name.includes('preordain') || name.includes('brainstorm') || name.includes('consider') || name.includes('opt') || name.includes('jeska\'s will') || name.includes('windfall') || name.includes('wheel of fortune') || name.includes('undead augur') || name.includes('morbid opportunist')) {
        return { role: 'Card Advantage', tier: 'premium_draw', cmc, subtypes, desc: 'High-efficiency draw / engine' };
    }
    if (name.includes('divination') || name.includes('inspiration') || name.includes('weave fate') || name.includes('concentrate') || name.includes('tidings') || name.includes('read the bones') || name.includes('foresee') || name.includes('mind rot') || name.includes('counsel of the soratami') || name.includes('succumb to temptation')) {
        return { role: 'Card Advantage', tier: 'clunky_draw', cmc, subtypes, desc: 'Inefficient draw spell' };
    }

    if (type.includes('creature')) {
        if (name.includes('walking corpse') || name.includes('vampire opportunist') || name.includes('grizzly bears') || name.includes('glory seeker') || name.includes('hill giant') || name.includes('scathe zombies') || name.includes('serra angel') || name.includes('wind drake') || name.includes('barony vampire') || name.includes('coral eel')) {
            return { role: 'Creatures', tier: 'vanilla_chaff', cmc, subtypes, desc: 'Low-impact / vanilla creature' };
        }
        return { role: 'Creatures', tier: 'synergy_creature', cmc, subtypes, desc: 'Creature spell' };
    }

    return { role: 'Synergy Spells', tier: 'general', cmc, subtypes, desc: 'Utility spell' };
}

function detectDeckTribe(deckCards, commanders) {
    const subtypeCounts = {};
    let totalCreatures = 0;

    deckCards.forEach(c => {
        const type = (c.typeLine || c.category || '').toLowerCase();
        if (type.includes('creature')) {
            totalCreatures++;
            const subs = extractSubtypes(c.typeLine);
            subs.forEach(s => {
                subtypeCounts[s] = (subtypeCounts[s] || 0) + 1;
            });
        }
    });

    const ignoredSubtypes = new Set(['human', 'soldier', 'wizard', 'warrior', 'cleric', 'rogue', 'shaman', 'druid', 'knight', 'archer', 'berserker', 'scout', 'monk', 'noble', 'warlock']);

    let detectedTribe = null;
    let maxCount = 0;

    for (const [sub, count] of Object.entries(subtypeCounts)) {
        if (!ignoredSubtypes.has(sub)) {
            // Must have at least 8 creatures and >= 30% of creatures
            if (count >= 8 && (count / Math.max(1, totalCreatures)) >= 0.30 && count > maxCount) {
                detectedTribe = sub;
                maxCount = count;
            }
        }
    }

    return detectedTribe ? { tribe: detectedTribe.charAt(0).toUpperCase() + detectedTribe.slice(1), count: maxCount } : null;
}

function generateBuiltInImprovements(deck, collection, deckColors, candidates, deckGoal) {
    const deckCards = deck.cards || [];
    const deckName = deck.name || "My Deck";
    const commanders = Array.isArray(deck.commanders) ? deck.commanders : (deck.commander ? [deck.commander] : []);

    const tribeInfo = detectDeckTribe(deckCards, commanders);
    const primaryTribe = tribeInfo ? tribeInfo.tribe : null;

    // Classify all deck cards
    const classifiedDeck = deckCards.map(c => ({
        ...c,
        meta: classifyCard(c)
    }));

    // Filter available collection candidates
    const classifiedCollection = candidates.map(c => ({
        ...c,
        meta: classifyCard(c)
    }));

    const suggestions = [];
    const usedCuts = new Set();
    const usedAdds = new Set();

    // 1. Check for Direct 1-to-1 Functional Role Upgrades
    const upgradePairs = [
        { role: 'Counterspells', goodTier: 'premium_interaction', badTier: 'clunky_interaction' },
        { role: 'Spot Removal', goodTier: 'premium_interaction', badTier: 'clunky_interaction' },
        { role: 'Mana Ramp', goodTier: 'premium_ramp', badTier: 'clunky_ramp' },
        { role: 'Card Advantage', goodTier: 'premium_draw', badTier: 'clunky_draw' },
        { role: 'Board Wipes', goodTier: 'premium_wipe', badTier: 'clunky_wipe' }
    ];

    for (const pair of upgradePairs) {
        const potentialAdds = classifiedCollection.filter(c => c.meta.role === pair.role && c.meta.tier === pair.goodTier && !usedAdds.has(c.name));
        const potentialCuts = classifiedDeck.filter(c => c.meta.role === pair.role && c.meta.tier === pair.badTier && !usedCuts.has(c.name));

        for (const addCard of potentialAdds) {
            if (suggestions.length >= 5) break;
            const cutCard = potentialCuts.find(c => !usedCuts.has(c.name));
            if (cutCard) {
                usedAdds.add(addCard.name);
                usedCuts.add(cutCard.name);

                const cmcDiff = cutCard.meta.cmc - addCard.meta.cmc;
                let whySwap = "";
                if (cmcDiff > 0) {
                    whySwap = `Replacing ${cutCard.name} (${cutCard.manaCost || (cutCard.meta.cmc + ' CMC')}) with ${addCard.name} (${addCard.manaCost || (addCard.meta.cmc + ' CMC')}) saves ${cmcDiff} mana on casting cost for a superior, instant-speed effect.`;
                } else {
                    whySwap = `At the same mana cost, ${addCard.name} offers strictly better target flexibility and game impact than ${cutCard.name}.`;
                }

                let whyAdd = `Provides high-efficiency ${addCard.meta.role.toLowerCase()} (${addCard.manaCost || (addCard.meta.cmc + ' mana')}) to consistently answer threats without stalling your tempo.`;
                if (deckGoal) whyAdd += ` Directly advances your goal of "${deckGoal}".`;

                suggestions.push({
                    addCardName: addCard.name,
                    category: addCard.meta.role,
                    impactRating: "High",
                    whyAdd,
                    recommendedCut: cutCard.name,
                    whySwap,
                    alternativeCuts: classifiedDeck.filter(c => c.name !== cutCard.name && c.meta.tier && c.meta.tier.includes('clunky')).slice(0, 2).map(c => c.name)
                });
            }
        }
    }

    // 2. Check for Tribal & Synergistic Upgrades (only if deck is genuine tribal deck)
    if (primaryTribe && suggestions.length < 5) {
        const tribeLower = primaryTribe.toLowerCase();
        const tribalAdds = classifiedCollection.filter(c => c.meta.subtypes.includes(tribeLower) && !usedAdds.has(c.name));
        const nonTribalCuts = classifiedDeck.filter(c => c.meta.role === 'Creatures' && (c.meta.tier === 'vanilla_chaff' || !c.meta.subtypes.includes(tribeLower)) && !usedCuts.has(c.name));

        for (const addCard of tribalAdds) {
            if (suggestions.length >= 5) break;
            const cutCard = nonTribalCuts.find(c => !usedCuts.has(c.name));
            if (cutCard) {
                usedAdds.add(addCard.name);
                usedCuts.add(cutCard.name);

                suggestions.push({
                    addCardName: addCard.name,
                    category: "Tribal Synergy",
                    impactRating: "High",
                    whyAdd: `Adds dedicated ${primaryTribe} synergy and tribal mechanics to amplify your ${tribeInfo.count} ${primaryTribe} cards.`,
                    recommendedCut: cutCard.name,
                    whySwap: `Replaces ${cutCard.name} (${cutCard.meta.subtypes.join(' ') || 'Off-tribe'}) with ${addCard.name}, strengthening your ${primaryTribe} board synergy and payoffs.`,
                    alternativeCuts: nonTribalCuts.filter(c => c.name !== cutCard.name && !usedCuts.has(c.name)).slice(0, 2).map(c => c.name)
                });
            }
        }
    }

    // 3. Check for General Power & Card Quality Upgrades (cutting vanilla chaff)
    if (suggestions.length < 5) {
        const chaffCuts = classifiedDeck.filter(c => c.meta.tier === 'vanilla_chaff' && !usedCuts.has(c.name));
        const premiumAdds = classifiedCollection.filter(c => (c.meta.tier.startsWith('premium_') || (c.edhrecRank && c.edhrecRank < 300)) && !usedAdds.has(c.name));

        for (const addCard of premiumAdds) {
            if (suggestions.length >= 5) break;
            const cutCard = chaffCuts.find(c => !usedCuts.has(c.name));
            if (cutCard) {
                usedAdds.add(addCard.name);
                usedCuts.add(cutCard.name);

                suggestions.push({
                    addCardName: addCard.name,
                    category: addCard.meta.role || "Card Advantage",
                    impactRating: "High",
                    whyAdd: `Significantly improves card quality and board value with ${addCard.name} (${addCard.manaCost || 'Low CMC'}).`,
                    recommendedCut: cutCard.name,
                    whySwap: `Replaces ${cutCard.name} (low-impact vanilla creature with no abilities) with ${addCard.name} to generate continuous game advantage.`,
                    alternativeCuts: chaffCuts.filter(c => c.name !== cutCard.name && !usedCuts.has(c.name)).slice(0, 2).map(c => c.name)
                });
            }
        }
    }

    const hasImprovements = suggestions.length > 0;
    const archetype = primaryTribe ? `${primaryTribe} Tribal` : (commanders.length > 0 ? `${commanders[0]} Deck` : "Midrange / Synergy");
    const goalSummary = deckGoal ? ` Focused on your stated aim: "${deckGoal}".` : '';

    return {
        deckArchetype: archetype,
        hasImprovements,
        overallAssessment: `Analyzed ${deckCards.length} cards in "${deckName}". Detected ${archetype}. Found ${suggestions.length} clear, strategic card upgrades from your collection.${goalSummary}`,
        noImprovementsReason: hasImprovements ? '' : `All cards in your collection were evaluated, and your deck is already running an optimal configuration for your stated aim: "${deckGoal || 'balanced synergy'}".`,
        suggestions
    };
}