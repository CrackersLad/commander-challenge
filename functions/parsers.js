/**
 * Creates a standardized, lowercase, and accent-free version of a card name for reliable matching.
 * This is the single source of truth for name normalization across the application.
 * @param {string} name The raw card name.
 * @returns {string} The normalized card name.
 */
function normalizeCardName(name) {
    if (!name) return "";
    return name.trim().toLowerCase()
        .replace(/æ/g, 'ae')
        .replace(/œ/g, 'oe')
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Handle accents: é -> e
        .replace(/[\u2018\u2019']/g, '') // Remove standard and curly apostrophes
        .replace(/[\u201C\u201D"]/g, '') // Remove standard and curly double quotes
        .replace(/[.,:;!?]/g, '') // Remove common punctuation that affects matching
        .replace(/\s*\/\/\s*/g, ' // ') // Normalize split/adventure card separators
        .replace(/\s*[\u2014\u2013]\s*/g, ' - ') // Normalize em/en dashes
        .trim().replace(/\s+/g, ' '); // Consolidate multiple spaces
}

/**
 * Robustly parses a deck URL, prefix, or raw ID into its platform and clean ID.
 * @param {string} input String representing a deck ID, URL, or platform:id
 * @returns {{ platform: string, id: string, compositeKey: string } | null}
 */
function parseDeckIdentifier(input) {
    if (!input) return null;
    let s = String(input).trim();
    if (!s) return null;

    let platform = 'archidekt';
    let id = s;

    // Check for Moxfield URL (e.g. moxfield.com/decks/k8N_xyz-123 or with /primer)
    const moxfieldMatch = s.match(/(?:moxfield\.com\/decks\/)([a-zA-Z0-9_-]+)/i);
    // Check for Archidekt URL (e.g. archidekt.com/decks/12345/slug or api/decks/12345/)
    const archidektMatch = s.match(/(?:archidekt\.com\/(?:api\/)?decks\/)(\d+)/i);
    // Check for prefix syntax e.g. archidekt:123 or moxfield:abc
    const prefixMatch = s.match(/^(archidekt|moxfield):(.+)$/i);

    if (prefixMatch) {
        platform = prefixMatch[1].toLowerCase();
        id = prefixMatch[2].trim();
        if (platform === 'archidekt') {
            const num = id.match(/\d+/);
            id = num ? num[0] : id;
        } else {
            id = id.split('/')[0].split('?')[0].split('#')[0];
        }
    } else if (moxfieldMatch) {
        platform = 'moxfield';
        id = moxfieldMatch[1];
    } else if (archidektMatch) {
        platform = 'archidekt';
        id = archidektMatch[1];
    } else {
        // Fallback heuristics: strip path/hash
        id = s.split('/')[0].split('?')[0].split('#')[0].trim();
        if (/^\d+$/.test(id)) {
            platform = 'archidekt';
        } else {
            platform = 'moxfield';
        }
    }

    if (!id) return null;
    return { platform, id, compositeKey: `${platform}:${id}` };
}

/**
 * Infers a clean display category from card type line or existing categories.
 * @param {string} typeLine Lowercase card type line.
 * @param {Array<string>} existingCategories Existing category strings.
 * @returns {string} Display category (e.g. Creatures, Lands, Instants, etc.)
 */
function categorizeCard(typeLine = '', existingCategories = []) {
    const catsLower = existingCategories.map(c => (c || '').toString().toLowerCase());
    if (catsLower.includes('sideboard')) return 'Sideboard';
    if (catsLower.includes('maybeboard') || catsLower.includes('considering')) return 'Maybeboard';

    const t = typeLine.toLowerCase();
    if (t.includes('creature')) return 'Creatures';
    if (t.includes('planeswalker')) return 'Planeswalkers';
    if (t.includes('instant')) return 'Instants';
    if (t.includes('sorcery')) return 'Sorceries';
    if (t.includes('artifact')) return 'Artifacts';
    if (t.includes('enchantment')) return 'Enchantments';
    if (t.includes('land')) return 'Lands';
    if (t.includes('battle')) return 'Battles';

    if (existingCategories.length > 0 && !catsLower.includes('commander')) return existingCategories[0];
    return 'Other';
}

/**
 * Parses card data from various API formats into a standardized map.
 * @param {object} jsonData The raw JSON data from an API (Archidekt, Moxfield, etc.).
 * @param {object} options Configuration options.
 * @returns {object} A map of normalized card names to their data.
 */
function parseCards(jsonData, options = {}) {
    const counts = {};
    if (!jsonData) return counts;
    const cards = jsonData.cards || jsonData.results || (Array.isArray(jsonData) ? jsonData : []);

    for (const item of cards) {
        if (!item) continue;
        const rawCategories = (Array.isArray(item.categories) ? item.categories : (item.categories ? [item.categories] : []))
            .map(c => {
                if (!c) return '';
                if (typeof c === 'object') return (c.name || c.label || '').toString();
                return c.toString();
            })
            .filter(Boolean);
        const categoriesLower = rawCategories.map(c => c.toLowerCase());

        if (options.isDeck && options.includeSideboards === false) {
            if (categoriesLower.includes('sideboard') || categoriesLower.includes('maybeboard') || categoriesLower.includes('considering')) {
                continue;
            }
        }

        const cardInfo = item.card || item || {};
        // Resilient name extraction across different API response structures
        const name = cardInfo.oracleCard?.name || cardInfo.name || item.name || cardInfo.parts?.find(p => p && p.name)?.name;
        const quantity = parseInt(item.quantity, 10) || parseInt(item.count, 10) || 1;

        if (name) {
            const cleanName = normalizeCardName(name);

            // Centralize the source of detailed card data. Handles variations between collection, deck, and CSV formats.
            const oracleDataSource = cardInfo.oracleCard || cardInfo;

            // Get type_line directly if available, otherwise construct it from its components.
            let typeLine = (oracleDataSource.type_line || oracleDataSource.typeLine || '').toLowerCase();
            if (!typeLine && oracleDataSource.types) {
                const superTypes = oracleDataSource.superTypes || [];
                const types = oracleDataSource.types || [];
                const subTypes = oracleDataSource.subTypes || [];
                const typeParts = [...superTypes, ...types];
                let constructedTypeLine = typeParts.join(' ');
                if (subTypes.length > 0) {
                    constructedTypeLine += ` — ${subTypes.join(' ')}`;
                }
                typeLine = constructedTypeLine.toLowerCase();
            }

            const basicLands = [
                'plains', 'island', 'swamp', 'mountain', 'forest',
                'snow-covered plains', 'snow-covered island', 'snow-covered swamp',
                'snow-covered mountain', 'snow-covered forest', 'wastes', "barrys land"
            ];

            const frontName = cleanName.split(' // ')[0].trim();
            const isBasic = (typeLine.includes('basic') && typeLine.includes('land')) || basicLands.includes(cleanName) || basicLands.includes(frontName);

            if (!options.includeBasicLands && isBasic) {
                continue;
            }

            const category = categorizeCard(typeLine, rawCategories);

            if (!counts[cleanName]) {
                const rawColors = oracleDataSource.color_identity || oracleDataSource.colorIdentity || oracleDataSource.colors || [];
                const oracleText = (oracleDataSource.oracle_text || oracleDataSource.oracleText || oracleDataSource.text || '').toLowerCase();
                const isLegendary = typeLine.includes('legendary');
                const isCreature = typeLine.includes('creature');
                const canBeCommanderText = oracleText.includes('can be your commander');
                const isCommanderCategory = categoriesLower.includes('commander');

                // In MTG Commander rules, only legendary creatures and cards with explicit "can be your commander" text are commanders
                const isCommander = (isLegendary && isCreature) || canBeCommanderText || isCommanderCategory;

                counts[cleanName] = {
                    quantity: 0,
                    originalName: name,
                    colors: Array.isArray(rawColors) ? rawColors : [],
                    isCommander: isCommander,
                    edhrecRank: oracleDataSource.edhrecRank || oracleDataSource.edhrec_rank || null,
                    typeLine: oracleDataSource.type_line || oracleDataSource.typeLine || typeLine,
                    manaCost: oracleDataSource.mana_cost || oracleDataSource.manaCost || '',
                    category: category,
                    categories: rawCategories
                };
            }
            counts[cleanName].quantity += quantity;
        }
    }
    return counts;
}

/**
 * Converts Moxfield's API response structure to a format `parseCards` can understand.
 * Supports both classic board objects and modern v2/v3 board collections.
 * @param {object} deckData The raw JSON from the Moxfield API.
 * @returns {object} A standardized deck object.
 */
function normalizeMoxfield(deckData) {
    if (!deckData) return { cards: [], name: "Unknown Moxfield Deck" };
    const cards = [];
    const addBoard = (board, categories) => {
        if (!board) return;
        let cardEntries = [];
        if (board.cards && typeof board.cards === 'object') {
            cardEntries = Object.entries(board.cards);
        } else if (Array.isArray(board)) {
            cardEntries = board.map((item, idx) => [item.name || idx, item]);
        } else if (typeof board === 'object') {
            cardEntries = Object.entries(board);
        }

        for (const [name, entry] of cardEntries) {
            if (!entry) continue;
            const cObj = entry.card || entry;
            const cardName = cObj?.name || entry.name || name;
            cards.push({
                quantity: entry.quantity || entry.count || 1,
                categories: categories,
                card: {
                    name: cardName,
                    oracleCard: {
                        name: cardName,
                        type_line: cObj?.type_line || cObj?.typeLine,
                        oracle_text: cObj?.oracle_text || cObj?.oracleText,
                        color_identity: cObj?.color_identity || cObj?.colorIdentity || cObj?.colors || [],
                        mana_cost: cObj?.mana_cost || cObj?.manaCost || '',
                        edhrec_rank: cObj?.edhrecRank || cObj?.edhrec_rank || null,
                        prices: cObj?.prices
                    }
                }
            });
        }
    };

    const boards = deckData.boards || {};
    addBoard(deckData.commanders || boards.commanders, ['Commander']);
    addBoard(deckData.mainboard || boards.mainboard, ['Mainboard']);
    addBoard(deckData.sideboard || boards.sideboard, ['Sideboard']);
    addBoard(deckData.maybeboard || boards.maybeboard, ['Maybeboard']);
    addBoard(deckData.considering || boards.considering, ['Considering']);
    addBoard(deckData.companions || boards.companions, ['Commander']);
    addBoard(deckData.signatureSpells || boards.signatureSpells, ['Commander']);
    addBoard(deckData.attractions || boards.attractions, ['Mainboard']);
    addBoard(deckData.stickers || boards.stickers, ['Mainboard']);
    addBoard(deckData.contraptions || boards.contraptions, ['Mainboard']);
    addBoard(deckData.planes || boards.planes, ['Mainboard']);
    addBoard(deckData.schemes || boards.schemes, ['Mainboard']);

    for (const [boardName, boardObj] of Object.entries(boards)) {
        if (!['commanders', 'mainboard', 'sideboard', 'maybeboard', 'considering', 'companions', 'signatureSpells', 'attractions', 'stickers', 'contraptions', 'planes', 'schemes'].includes(boardName)) {
            addBoard(boardObj, [boardName.charAt(0).toUpperCase() + boardName.slice(1)]);
        }
    }

    return { cards, name: deckData.name || "Unknown Moxfield Deck" };
}

/**
 * Parses raw MTG decklist text (e.g. Arena/MTGO/Archidekt/Moxfield text exports).
 * @param {string} text Raw text decklist.
 * @param {string} deckName Optional name for the deck.
 * @returns {object} Standardized deck object with cards array.
 */
function parseDecklistText(text, deckName = "Pasted Deck") {
    if (!text || typeof text !== 'string') return { cards: [], name: deckName };

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const cards = [];
    let currentCategory = 'Mainboard';

    for (const line of lines) {
        // Check for category headers e.g. "// Commander", "Commander (1)", "Sideboard"
        if (line.startsWith('//') || line.startsWith('#')) {
            const header = line.replace(/^[/#]+\s*/, '').trim();
            if (header) currentCategory = header;
            continue;
        }

        const sectionMatch = line.match(/^([a-zA-Z\s]+)(?:\s*\(\d+\))?:$/);
        if (sectionMatch && ['commander', 'deck', 'mainboard', 'sideboard', 'maybeboard', 'considering', 'creatures', 'lands', 'spells', 'artifacts', 'enchantments', 'planeswalkers', 'instants', 'sorceries'].includes(sectionMatch[1].toLowerCase())) {
            currentCategory = sectionMatch[1];
            continue;
        }

        // Standard card lines: "1x Sol Ring", "1 Sol Ring", "1 Sol Ring (LEA) 123", "4 Lightning Bolt *F*"
        const cardMatch = line.match(/^(\d+)\s*x?\s+([^(#\n]+?)(?:\s+\[[A-Za-z0-9_]+\]|\s+\([A-Za-z0-9_]+\))?(?:\s+[A-Za-z0-9_#-]+)?(?:\s*\*F\*|\s*\*E\*|\s*#\w+)*$/);
        if (cardMatch) {
            const qty = parseInt(cardMatch[1], 10) || 1;
            const name = cardMatch[2].trim();
            if (name) {
                cards.push({
                    quantity: qty,
                    categories: [currentCategory],
                    card: {
                        name: name,
                        oracleCard: { name: name }
                    }
                });
            }
        } else {
            // Line without leading number (assume 1 copy if not a header)
            if (!line.includes(':') && line.length > 2 && !line.startsWith('//')) {
                cards.push({
                    quantity: 1,
                    categories: [currentCategory],
                    card: {
                        name: line.trim(),
                        oracleCard: { name: line.trim() }
                    }
                });
            }
        }
    }

    return { cards, name: deckName };
}

const { fetchWithRetry } = require("./http.js");

/**
 * Enriches basic card objects (e.g. from CSV uploads) with Scryfall metadata.
 * Uses Scryfall's collection batch API for fast bulk resolution (up to 75 per batch).
 * @param {Array<object>} cardItems List of items with { name, quantity }.
 * @returns {Promise<Array<object>>} Enriched card items.
 */
async function enrichCardsWithScryfall(cardItems) {
    if (!Array.isArray(cardItems) || cardItems.length === 0) return cardItems;

    const nameMap = new Map();
    const uncachedNames = [];

    for (const item of cardItems) {
        const rawName = item.name || item.card?.name || '';
        const clean = normalizeCardName(rawName);
        if (clean && !nameMap.has(clean)) {
            nameMap.set(clean, null);
            uncachedNames.push(rawName);
        }
    }

    const batchSize = 75;
    for (let i = 0; i < uncachedNames.length; i += batchSize) {
        const batch = uncachedNames.slice(i, i + batchSize);
        try {
            const res = await fetchWithRetry("https://api.scryfall.com/cards/collection", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "ArchidektComparator/2.0 (https://github.com/)"
                },
                body: JSON.stringify({
                    identifiers: batch.map(name => ({ name }))
                }),
                timeoutMs: 8000
            }, 2);

            if (res.ok) {
                const data = await res.json();
                const foundCards = data.data || [];
                for (const scryfallCard of foundCards) {
                    const normName = normalizeCardName(scryfallCard.name);
                    const typeLine = (scryfallCard.type_line || '').toLowerCase();
                    const oracleText = (scryfallCard.oracle_text || (scryfallCard.card_faces ? scryfallCard.card_faces.map(f => f.oracle_text).join(' ') : '')).toLowerCase();
                    const isLegendary = typeLine.includes('legendary');
                    const isCreature = typeLine.includes('creature');
                    const canBeCommander = oracleText.includes('can be your commander');

                    nameMap.set(normName, {
                        name: scryfallCard.name,
                        type_line: scryfallCard.type_line,
                        mana_cost: scryfallCard.mana_cost || '',
                        color_identity: scryfallCard.color_identity || [],
                        edhrec_rank: scryfallCard.edhrec_rank || null,
                        isCommander: (isLegendary && isCreature) || canBeCommander
                    });
                }
            }
        } catch (e) {
            console.warn("[WARN] Failed to enrich batch from Scryfall:", e.message || e);
        }

        // Respect Scryfall guidelines (100ms spacing between calls)
        if (i + batchSize < uncachedNames.length) {
            await new Promise(r => setTimeout(r, 100));
        }
    }

    const enriched = [];
    for (const item of cardItems) {
        const rawName = item.name || item.card?.name || '';
        const clean = normalizeCardName(rawName);
        const metadata = nameMap.get(clean);

        if (metadata) {
            enriched.push({
                quantity: item.quantity || 1,
                card: {
                    name: metadata.name || rawName,
                    oracleCard: {
                        name: metadata.name || rawName,
                        type_line: metadata.type_line,
                        mana_cost: metadata.mana_cost,
                        color_identity: metadata.color_identity,
                        edhrec_rank: metadata.edhrec_rank,
                        isCommander: metadata.isCommander
                    }
                }
            });
        } else {
            enriched.push(item);
        }
    }

    return enriched;
}

module.exports = { parseCards, normalizeMoxfield, normalizeCardName, parseDeckIdentifier, enrichCardsWithScryfall, parseDecklistText, categorizeCard };