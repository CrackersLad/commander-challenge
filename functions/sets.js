const { normalizeCardName } = require("./parsers.js");
const { fetchWithRetry, DEFAULT_HEADERS } = require("./http.js");

// In-memory cache for Scryfall sets and set cards
let cachedSets = null;
let cachedSetsTimestamp = 0;
const SETS_CACHE_TTL = 1000 * 60 * 60 * 2; // 2 hours

const setCardsCache = new Map(); // setCode -> { timestamp, cards, setInfo }
const SET_CARDS_CACHE_TTL = 1000 * 60 * 60 * 4; // 4 hours

/**
 * Normalizes a set code for consistent matching.
 */
function normalizeSetCode(code) {
    if (!code) return "";
    return code.toString().trim().toLowerCase();
}

/**
 * Fetches all Magic: The Gathering sets from Scryfall.
 */
async function fetchAllSets() {
    const now = Date.now();
    if (cachedSets && (now - cachedSetsTimestamp < SETS_CACHE_TTL)) {
        return cachedSets;
    }

    try {
        const res = await fetchWithRetry("https://api.scryfall.com/sets", {
            headers: DEFAULT_HEADERS,
            timeoutMs: 15000
        }, 2);

        if (!res.ok) {
            throw new Error(`Scryfall API returned status ${res.status}`);
        }

        const data = await res.json();
        const rawSets = data.data || [];

        // Format sets cleanly for frontend search & display
        const formattedSets = rawSets.map(s => ({
            code: normalizeSetCode(s.code),
            name: s.name,
            released_at: s.released_at || "",
            set_type: s.set_type || "expansion",
            card_count: s.card_count || 0,
            icon_svg_uri: s.icon_svg_uri || "",
            digital: Boolean(s.digital),
            parent_set_code: s.parent_set_code ? normalizeSetCode(s.parent_set_code) : null,
            scryfall_uri: s.scryfall_uri || ""
        }));

        // Sort by release date descending (newest first)
        formattedSets.sort((a, b) => (b.released_at || "").localeCompare(a.released_at || ""));

        cachedSets = formattedSets;
        cachedSetsTimestamp = now;
        return formattedSets;
    } catch (err) {
        console.error("[ERROR] Failed to fetch sets from Scryfall:", err.message);
        if (cachedSets) return cachedSets; // Fallback to stale cache if available
        throw err;
    }
}

/**
 * Fetches all cards in a given set from Scryfall with pagination.
 */
async function fetchSetCards(setCode, options = {}) {
    const cleanCode = normalizeSetCode(setCode);
    if (!cleanCode) throw new Error("Invalid set code");

    const now = Date.now();
    const cached = setCardsCache.get(cleanCode);
    if (cached && (now - cached.timestamp < SET_CARDS_CACHE_TTL)) {
        return cached;
    }

    // First get set metadata
    let setInfo = null;
    try {
        const allSets = await fetchAllSets();
        setInfo = allSets.find(s => s.code === cleanCode);
    } catch (e) {
        console.warn("[WARN] Could not retrieve set metadata for", cleanCode);
    }

    if (!setInfo) {
        setInfo = { code: cleanCode, name: cleanCode.toUpperCase(), released_at: "", set_type: "expansion", card_count: 0 };
    }

    let url = `https://api.scryfall.com/cards/search?include_extras=true&include_variations=true&order=set&q=set%3A${encodeURIComponent(cleanCode)}&unique=prints`;
    const allRawCards = [];

    while (url) {
        const res = await fetchWithRetry(url, {
            headers: DEFAULT_HEADERS,
            timeoutMs: 15000
        }, 2);

        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            throw new Error(`Failed to fetch cards for set "${cleanCode}" (HTTP ${res.status}): ${errBody}`);
        }

        const data = await res.json();
        if (Array.isArray(data.data)) {
            allRawCards.push(...data.data);
        }

        url = data.has_more ? data.next_page : null;
        if (url) {
            // Respect Scryfall rate limit (50-100ms)
            await new Promise(r => setTimeout(r, 80));
        }
    }

    // Format card objects
    const formattedCards = allRawCards.map(c => {
        const typeLine = (c.type_line || "").toLowerCase();
        const cleanName = normalizeCardName(c.name);

        const basicLands = [
            "plains", "island", "swamp", "mountain", "forest",
            "snow-covered plains", "snow-covered island", "snow-covered swamp",
            "snow-covered mountain", "snow-covered forest", "wastes", "barrys land"
        ];
        const isBasicLand = typeLine.includes("basic land") || basicLands.includes(cleanName);

        // Get image uri (handles DFC / split / normal)
        let imageUrl = c.image_uris?.normal || c.image_uris?.small || "";
        if (!imageUrl && c.card_faces && c.card_faces[0]?.image_uris) {
            imageUrl = c.card_faces[0].image_uris.normal || c.card_faces[0].image_uris.small || "";
        }

        // Mana cost
        let manaCost = c.mana_cost || "";
        if (!manaCost && c.card_faces && c.card_faces[0]?.mana_cost) {
            manaCost = c.card_faces.map(f => f.mana_cost).filter(Boolean).join(" // ");
        }

        // Detect specific print finish (Surge Foil, Textured Foil, Etched, Foil, etc.)
        let finish = "Normal";
        const promoTypes = Array.isArray(c.promo_types) ? c.promo_types : [];
        const frameEffects = Array.isArray(c.frame_effects) ? c.frame_effects : [];
        const finishes = Array.isArray(c.finishes) ? c.finishes : [];

        if (promoTypes.includes("surgefoil") || frameEffects.includes("surgefoil")) {
            finish = "Surge Foil";
        } else if (promoTypes.includes("confettifoil")) {
            finish = "Confetti Foil";
        } else if (promoTypes.includes("halofoil")) {
            finish = "Halo Foil";
        } else if (promoTypes.includes("textured")) {
            finish = "Textured Foil";
        } else if (finishes.length === 1 && finishes[0] === "etched") {
            finish = "Etched";
        } else if (finishes.length === 1 && finishes[0] === "foil") {
            finish = "Foil";
        }

        const isFoil = finish !== "Normal" || (finishes.includes("foil") && !finishes.includes("nonfoil"));

        const usdPrice = isFoil
            ? (parseFloat(c.prices?.usd_foil || c.prices?.usd || "0") || 0)
            : (parseFloat(c.prices?.usd || c.prices?.usd_foil || "0") || 0);

        const eurPrice = isFoil
            ? (parseFloat(c.prices?.eur_foil || c.prices?.eur || "0") || 0)
            : (parseFloat(c.prices?.eur || c.prices?.eur_foil || "0") || 0);

        return {
            id: c.id,
            name: c.name,
            cleanName: cleanName,
            set: cleanCode,
            collector_number: c.collector_number || "",
            rarity: (c.rarity || "common").toLowerCase(),
            type_line: c.type_line || "",
            mana_cost: manaCost,
            colors: c.colors || (c.card_faces ? c.card_faces.flatMap(f => f.colors || []) : []),
            color_identity: c.color_identity || [],
            image_url: imageUrl,
            scryfall_uri: c.scryfall_uri || `https://scryfall.com/card/${cleanCode}/${c.collector_number}`,
            finish,
            is_foil: isFoil,
            possible_finishes: finishes,
            prices: {
                usd: c.prices?.usd || null,
                usd_foil: c.prices?.usd_foil || null,
                usd_etched: c.prices?.usd_etched || null,
                eur: c.prices?.eur || null,
                eur_foil: c.prices?.eur_foil || null,
                numericUsd: usdPrice,
                numericEur: eurPrice
            },
            is_basic_land: isBasicLand
        };
    });

    const result = {
        setInfo,
        cards: formattedCards,
        timestamp: now
    };

    setCardsCache.set(cleanCode, result);
    return result;
}

/**
 * Normalizes a finish string into standard MTG finish titles.
 */
function normalizeFinishString(rawModifier = "", isFoilBool = false) {
    const s = String(rawModifier || "").trim();
    const sLower = s.toLowerCase();
    if (sLower.includes("surge")) return "Surge Foil";
    if (sLower.includes("etched")) return "Etched";
    if (sLower.includes("confetti")) return "Confetti Foil";
    if (sLower.includes("textured")) return "Textured Foil";
    if (sLower.includes("halo")) return "Halo Foil";
    if (sLower.includes("rainbow")) return "Rainbow Foil";
    if (sLower.includes("galaxy")) return "Galaxy Foil";
    if (sLower.includes("foil") || isFoilBool) return "Foil";
    if (sLower === "non-foil" || sLower === "nonfoil" || sLower === "regular" || sLower === "normal") return "Normal";
    return s || (isFoilBool ? "Foil" : "Normal");
}

/**
 * Parses user collection into fast lookup maps by name and by set, preserving finishes and specific print details.
 */
function buildCollectionLookup(collectionItems = []) {
    const byName = new Map(); // cleanName -> { quantity, originalName, editions: Map(setCode -> qty), printDetails: [] }
    const bySetAndName = new Map(); // `${setCode}:${cleanName}` -> { quantity, printDetails: [] }
    const bySetAndNumber = new Map(); // `${setCode}:${collectorNumber}` -> { quantity, printDetails: [] }

    for (const item of collectionItems) {
        const cardInfo = item.card || item || {};
        const oracleData = cardInfo.oracleCard || cardInfo;
        const rawName = oracleData.name || cardInfo.name || item.name || cardInfo.parts?.find(p => p.name)?.name;
        const quantity = Math.max(1, parseInt(item.quantity) || 1);

        if (!rawName) continue;

        const cleanName = normalizeCardName(rawName);
        const setCode = normalizeSetCode(
            cardInfo.edition?.editioncode ||
            cardInfo.edition?.code ||
            item.edition?.editioncode ||
            item.edition?.code ||
            cardInfo.edition?.editionName ||
            cardInfo.set ||
            item.set ||
            item.edition ||
            ""
        );
        const collectorNumber = (cardInfo.collectorNumber || cardInfo.collector_number || item.collectorNumber || item.collector_number || item.number || "").toString().trim();
        const inDecks = Math.max(0, parseInt(item.inDecks || item.in_decks || cardInfo.inDecks || cardInfo.in_decks || 0) || 0);

        // Extract finish / modifier
        const rawMod = item.modifier || item.finish || cardInfo.modifier || cardInfo.finish || "";
        const rawFoil = Boolean(item.foil || cardInfo.foil);
        const finish = normalizeFinishString(rawMod, rawFoil);
        const isFoil = finish !== "Normal";

        const imageUrl = cardInfo.images?.normal || cardInfo.scryfall_image || (setCode && collectorNumber ? `https://api.scryfall.com/cards/${setCode.toLowerCase()}/${collectorNumber}?format=image` : "");

        const printDetail = {
            setCode,
            collectorNumber,
            finish,
            isFoil,
            quantity,
            inDecks,
            imageUrl,
            prices: {
                usd: cardInfo.prices?.tcg || cardInfo.prices?.usd || null,
                usd_foil: cardInfo.prices?.tcgfoil || cardInfo.prices?.usd_foil || null,
                eur: cardInfo.prices?.cm || cardInfo.prices?.eur || null,
                eur_foil: cardInfo.prices?.cmfoil || cardInfo.prices?.eur_foil || null,
                ck: cardInfo.prices?.ck || null,
                ck_foil: cardInfo.prices?.ckfoil || null
            }
        };

        // 1. Name map
        if (!byName.has(cleanName)) {
            byName.set(cleanName, {
                cleanName,
                originalName: rawName,
                quantity: 0,
                inDecks: 0,
                editions: new Map(),
                printDetails: []
            });
        }
        const entry = byName.get(cleanName);
        entry.quantity += quantity;
        entry.inDecks += inDecks;
        entry.printDetails.push(printDetail);

        // 2. Set maps
        if (setCode) {
            const currentEdQty = entry.editions.get(setCode) || 0;
            entry.editions.set(setCode, currentEdQty + quantity);

            const setKey = `${setCode}:${cleanName}`;
            if (!bySetAndName.has(setKey)) {
                bySetAndName.set(setKey, { quantity: 0, printDetails: [] });
            }
            const snEntry = bySetAndName.get(setKey);
            snEntry.quantity += quantity;
            snEntry.printDetails.push(printDetail);

            if (collectorNumber) {
                const cleanNum = collectorNumber.toLowerCase();
                const strippedNum = cleanNum.replace(/^0+([1-9])/, '$1');
                const numKey = `${setCode}:${cleanNum}`;
                if (!bySetAndNumber.has(numKey)) {
                    bySetAndNumber.set(numKey, { quantity: 0, printDetails: [] });
                }
                const snumEntry = bySetAndNumber.get(numKey);
                snumEntry.quantity += quantity;
                snumEntry.printDetails.push(printDetail);

                if (strippedNum !== cleanNum) {
                    const stripKey = `${setCode}:${strippedNum}`;
                    if (!bySetAndNumber.has(stripKey)) {
                        bySetAndNumber.set(stripKey, { quantity: 0, printDetails: [] });
                    }
                    const stripEntry = bySetAndNumber.get(stripKey);
                    stripEntry.quantity += quantity;
                    stripEntry.printDetails.push(printDetail);
                }
            }
        }
    }

    return { byName, bySetAndName, bySetAndNumber };
}

/**
 * Checks if a set card matches user's collection, preserving specific finishes (e.g. Surge Foil, Normal, Foil)
 * and accurately distinguishing prints in this exact set vs other variants vs other sets.
 */
function findCollectionMatch(setCard, collectionLookup, matchMode = "exact", setScope = "distinct") {
    const { byName, bySetAndName, bySetAndNumber } = collectionLookup;
    const cleanName = setCard.cleanName;
    const setCode = normalizeSetCode(setCard.set || setCard.scryfall_uri?.split("/")[4] || "");
    const collectorNumber = (setCard.collector_number || "").toString().trim();
    const cleanNum = collectorNumber.toLowerCase();
    const strippedNum = cleanNum.replace(/^0+([1-9])/, '$1');

    // Find all prints the user owns of this card by name (or split parts)
    let matchedEntry = null;
    if (byName.has(cleanName)) {
        matchedEntry = byName.get(cleanName);
    } else {
        const parts = cleanName.split(" // ");
        if (parts.length > 1) {
            for (const part of parts) {
                if (byName.has(part)) {
                    matchedEntry = byName.get(part);
                    break;
                }
            }
        } else {
            for (const [collKey, collVal] of byName.entries()) {
                const collParts = collKey.split(" // ");
                if (collParts.length > 1 && collParts.includes(cleanName)) {
                    matchedEntry = collVal;
                    break;
                }
            }
        }
    }

    const allRawPrintDetails = matchedEntry?.printDetails ? [...matchedEntry.printDetails] : [];

    // Also verify bySetAndNumber directly in case collectorNumber was recorded but name slightly differed
    if (setCode && collectorNumber) {
        const snumEntry = bySetAndNumber.get(`${setCode}:${cleanNum}`) || bySetAndNumber.get(`${setCode}:${strippedNum}`);
        if (snumEntry && Array.isArray(snumEntry.printDetails)) {
            for (const p of snumEntry.printDetails) {
                if (!allRawPrintDetails.some(x => x === p || (x.setCode === p.setCode && x.collectorNumber === p.collectorNumber && x.finish === p.finish))) {
                    allRawPrintDetails.push(p);
                }
            }
        }
    }

    // Separate prints into:
    // 1. exactCardPrints: same set AND same collector number
    // 2. sameSetOtherPrints: same set BUT different collector number (e.g. alt art #199 vs standard #3)
    // 3. otherSetPrints: different set code
    const exactCardPrints = [];
    const sameSetOtherPrints = [];
    const otherSetPrints = [];

    for (const p of allRawPrintDetails) {
        const pSet = normalizeSetCode(p.setCode || "");
        const pNum = (p.collectorNumber || "").toString().trim().toLowerCase();
        const pStrippedNum = pNum.replace(/^0+([1-9])/, '$1');

        if (pSet === setCode) {
            if (pNum === cleanNum || (strippedNum && pStrippedNum === strippedNum)) {
                exactCardPrints.push(p);
            } else {
                sameSetOtherPrints.push(p);
            }
        } else {
            otherSetPrints.push(p);
        }
    }

    // Aggregate prints by setCode, collectorNumber, and finish so quantities sum cleanly
    function aggregate(list) {
        const map = new Map();
        for (const p of list) {
            const pFinish = p.finish || "Normal";
            const pNum = (p.collectorNumber || collectorNumber || "").toString().trim();
            const pSet = (p.setCode || setCode).toUpperCase();
            const key = `${pSet}:${pNum}:${pFinish}`;
            if (!map.has(key)) {
                map.set(key, {
                    setCode: pSet,
                    collectorNumber: pNum,
                    finish: pFinish,
                    isFoil: Boolean(p.isFoil || pFinish.toLowerCase().includes("foil") || pFinish.toLowerCase().includes("etched")),
                    quantity: 0,
                    inDecks: 0,
                    availableQty: 0,
                    imageUrl: p.imageUrl || "",
                    prices: p.prices || null
                });
            }
            const agg = map.get(key);
            agg.quantity += (p.quantity || 1);
            agg.inDecks += (p.inDecks || 0);
            agg.availableQty = Math.max(0, agg.quantity - agg.inDecks);
            if (p.imageUrl && !agg.imageUrl) agg.imageUrl = p.imageUrl;
            if (p.prices && !agg.prices) agg.prices = p.prices;
        }
        return Array.from(map.values());
    }

    const aggExactCardPrints = aggregate(exactCardPrints);
    const aggSameSetOtherPrints = aggregate(sameSetOtherPrints);
    const aggOtherSetPrints = aggregate(otherSetPrints);
    const aggThisSetAllPrints = aggregate([...exactCardPrints, ...sameSetOtherPrints]);
    const aggAllPrints = aggregate(allRawPrintDetails);

    // Quantities
    const exactCardQty = aggExactCardPrints.reduce((sum, p) => sum + p.quantity, 0);
    const sameSetOtherQty = aggSameSetOtherPrints.reduce((sum, p) => sum + p.quantity, 0);
    const thisSetTotalQty = exactCardQty + sameSetOtherQty;
    const otherSetsQty = aggOtherSetPrints.reduce((sum, p) => sum + p.quantity, 0);
    const totalAcrossAllSets = thisSetTotalQty + otherSetsQty;
    const inDecksQty = matchedEntry?.inDecks || 0;

    // What prints represent ownership for this checklist card?
    // In "distinct" mode (1 row per card name), ALL copies in this set (e.g. both #3 and #199) count as collected in this set!
    // In "all" mode (each collector number has its own row), this row represents the exact collector number.
    let relevantOwnedPrints = [];
    let relevantQty = 0;

    if (matchMode === "name") {
        relevantOwnedPrints = aggAllPrints;
        relevantQty = totalAcrossAllSets;
    } else if (setScope === "distinct") {
        relevantOwnedPrints = aggThisSetAllPrints;
        relevantQty = thisSetTotalQty;
    } else {
        relevantOwnedPrints = aggExactCardPrints;
        relevantQty = exactCardQty;
    }

    const isCollected = relevantQty > 0;
    const availableQty = Math.max(0, relevantQty - inDecksQty);

    // Breakdown of finishes across relevant owned prints (e.g. 1x Normal, 1x Foil)
    const finishMap = new Map();
    for (const p of relevantOwnedPrints) {
        const fKey = p.finish || "Normal";
        if (!finishMap.has(fKey)) {
            finishMap.set(fKey, {
                finish: fKey,
                isFoil: p.isFoil,
                quantity: 0,
                collectorNumber: p.collectorNumber,
                imageUrl: p.imageUrl,
                prices: p.prices
            });
        }
        finishMap.get(fKey).quantity += p.quantity;
    }
    const finishesBreakdown = Array.from(finishMap.values());

    // Summaries of other variants in this same set (e.g. if looking at #3 in "all" mode, mention #199)
    const sameSetVariants = (setScope === "all") ? aggSameSetOtherPrints : [];
    const sameSetVariantsSummary = sameSetVariants.map(v => `${v.quantity}x #${v.collectorNumber}${v.finish !== 'Normal' ? ' (' + v.finish + ')' : ''}`).join(", ");

    // Summaries of prints in OTHER sets ONLY (never same-set variants!)
    const otherEditions = aggOtherSetPrints.map(p => ({
        set: p.setCode,
        qty: p.quantity,
        finish: p.finish,
        collectorNumber: p.collectorNumber,
        display: `${p.quantity}x ${p.setCode}${p.finish !== 'Normal' ? ' (' + p.finish + ')' : ''}${p.collectorNumber ? ' #' + p.collectorNumber : ''}`
    }));
    const otherEditionsSummary = otherEditions.map(e => e.display).join(", ");

    const primaryOwnedPrint = relevantOwnedPrints[0] || null;
    const ownedFinish = finishesBreakdown.length > 0
        ? finishesBreakdown.map(f => `${f.quantity > 1 ? f.quantity + 'x ' : ''}${f.finish}`).join(" + ")
        : "Normal";
    const isFoil = Boolean(primaryOwnedPrint?.isFoil || finishesBreakdown.some(f => f.isFoil));

    return {
        isCollected,
        ownedQty: relevantQty,
        inDecksQty,
        availableQty,
        totalOwnedAcrossAnySet: totalAcrossAllSets,
        exactSetQty: (setScope === "distinct") ? thisSetTotalQty : exactCardQty,
        thisSetTotalQty,
        otherSetsQty,
        ownedFinish,
        isFoil,
        primaryOwnedPrint,
        ownedPrints: relevantOwnedPrints,
        allOwnedPrints: aggAllPrints,
        finishesBreakdown,
        sameSetVariants,
        sameSetVariantsSummary,
        otherEditions,
        otherEditionsSummary
    };
}

/**
 * Compares collection against a specific set and generates completion statistics.
 */
async function compareCollectionToSet({
    collectionItems = [],
    setCode,
    matchMode = "exact", // "exact" (this set only) or "name" (any print)
    includeBasicLands = false,
    setScope = "distinct" // "distinct" (1 per card name) or "all" (every collector number)
}) {
    const { setInfo, cards: rawSetCards } = await fetchSetCards(setCode);
    const lookup = buildCollectionLookup(collectionItems);

    // Filter basic lands if requested
    let targetCards = rawSetCards;
    if (!includeBasicLands) {
        targetCards = targetCards.filter(c => !c.is_basic_land);
    }

    // Handle distinct cards vs all printings
    if (setScope === "distinct") {
        const seenNames = new Set();
        const distinctList = [];
        for (const card of targetCards) {
            if (!seenNames.has(card.cleanName)) {
                seenNames.add(card.cleanName);
                distinctList.push(card);
            }
        }
        targetCards = distinctList;
    }

    // Process each card
    let totalCollected = 0;
    let totalMissing = 0;
    let totalCopiesOwned = 0;
    let estMissingUsd = 0;
    let estMissingEur = 0;
    let estOwnedUsd = 0;
    let estOwnedEur = 0;

    const rarityStats = {
        mythic: { total: 0, collected: 0, missing: 0, estMissingUsd: 0 },
        rare: { total: 0, collected: 0, missing: 0, estMissingUsd: 0 },
        uncommon: { total: 0, collected: 0, missing: 0, estMissingUsd: 0 },
        common: { total: 0, collected: 0, missing: 0, estMissingUsd: 0 },
        special: { total: 0, collected: 0, missing: 0, estMissingUsd: 0 }
    };

    const colorStats = {
        W: { total: 0, collected: 0, missing: 0 },
        U: { total: 0, collected: 0, missing: 0 },
        B: { total: 0, collected: 0, missing: 0 },
        R: { total: 0, collected: 0, missing: 0 },
        G: { total: 0, collected: 0, missing: 0 },
        multi: { total: 0, collected: 0, missing: 0 },
        colorless: { total: 0, collected: 0, missing: 0 },
        land: { total: 0, collected: 0, missing: 0 }
    };

    const resultCards = [];

    for (const card of targetCards) {
        const match = findCollectionMatch(card, lookup, matchMode, setScope);
        const cardUsd = card.prices.numericUsd;
        const cardEur = card.prices.numericEur;

        const rarityKey = rarityStats[card.rarity] ? card.rarity : "special";
        rarityStats[rarityKey].total++;

        // Determine primary color category
        let colorKey = "colorless";
        if (card.type_line.toLowerCase().includes("land")) {
            colorKey = "land";
        } else if (card.colors.length > 1) {
            colorKey = "multi";
        } else if (card.colors.length === 1) {
            colorKey = card.colors[0];
        }

        if (colorStats[colorKey]) {
            colorStats[colorKey].total++;
        }

        if (match.isCollected) {
            totalCollected++;
            totalCopiesOwned += match.ownedQty;
            estOwnedUsd += cardUsd;
            estOwnedEur += cardEur;
            rarityStats[rarityKey].collected++;
            if (colorStats[colorKey]) colorStats[colorKey].collected++;
        } else {
            totalMissing++;
            estMissingUsd += cardUsd;
            estMissingEur += cardEur;
            rarityStats[rarityKey].missing++;
            rarityStats[rarityKey].estMissingUsd += cardUsd;
            if (colorStats[colorKey]) colorStats[colorKey].missing++;
        }

        resultCards.push({
            id: card.id,
            name: card.name,
            cleanName: card.cleanName,
            set: card.set,
            collector_number: card.collector_number,
            rarity: card.rarity,
            type_line: card.type_line,
            mana_cost: card.mana_cost,
            colors: card.colors,
            color_identity: card.color_identity,
            image_url: (match.isCollected && match.primaryOwnedPrint?.imageUrl) ? match.primaryOwnedPrint.imageUrl : card.image_url,
            card_image_url: card.image_url,
            scryfall_uri: card.scryfall_uri,
            finish: match.isCollected ? (match.primaryOwnedPrint?.finish || card.finish || "Normal") : (card.finish || "Normal"),
            card_finish: card.finish || "Normal",
            owned_finish: match.ownedFinish || "Normal",
            is_foil: Boolean(match.isFoil || card.is_foil),
            owned_collector_number: match.primaryOwnedPrint?.collectorNumber || "",
            owned_set_code: match.primaryOwnedPrint?.setCode || "",
            prices: card.prices,
            is_collected: match.isCollected,
            owned_qty: match.ownedQty,
            in_decks: match.inDecksQty,
            available_qty: match.availableQty,
            total_owned_across_any_set: match.totalOwnedAcrossAnySet,
            exact_set_qty: match.exactSetQty,
            this_set_total_qty: match.thisSetTotalQty,
            other_sets_qty: match.otherSetsQty,
            owned_prints: match.ownedPrints || [],
            all_owned_prints: match.allOwnedPrints || [],
            finishes_breakdown: match.finishesBreakdown || [],
            same_set_variants_owned: match.sameSetVariants || [],
            same_set_variants_summary: match.sameSetVariantsSummary || "",
            other_editions: match.otherEditions || [],
            other_editions_summary: match.otherEditionsSummary || "",
            is_basic_land: card.is_basic_land
        });
    }

    const totalCards = targetCards.length;
    const percentCollected = totalCards > 0 ? parseFloat(((totalCollected / totalCards) * 100).toFixed(1)) : 0;

    // Calculate percentages for rarities
    for (const key of Object.keys(rarityStats)) {
        const r = rarityStats[key];
        r.pct = r.total > 0 ? parseFloat(((r.collected / r.total) * 100).toFixed(1)) : 0;
        r.estMissingUsd = parseFloat(r.estMissingUsd.toFixed(2));
    }

    // Calculate percentages for colors
    for (const key of Object.keys(colorStats)) {
        const c = colorStats[key];
        c.pct = c.total > 0 ? parseFloat(((c.collected / c.total) * 100).toFixed(1)) : 0;
    }

    return {
        setInfo,
        summary: {
            totalCards,
            collectedCards: totalCollected,
            missingCards: totalMissing,
            percentCollected,
            totalCopiesOwned,
            matchMode,
            includeBasicLands,
            setScope,
            estMissingValue: {
                usd: parseFloat(estMissingUsd.toFixed(2)),
                eur: parseFloat(estMissingEur.toFixed(2))
            },
            estOwnedValue: {
                usd: parseFloat(estOwnedUsd.toFixed(2)),
                eur: parseFloat(estOwnedEur.toFixed(2))
            }
        },
        rarityStats,
        colorStats,
        cards: resultCards
    };
}

module.exports = {
    fetchAllSets,
    fetchSetCards,
    buildCollectionLookup,
    compareCollectionToSet
};
