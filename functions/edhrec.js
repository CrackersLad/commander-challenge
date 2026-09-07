const { normalizeCardName } = require("./parsers.js");
const { fetchWithRetry, DEFAULT_HEADERS } = require("./http.js");

const commanderRankCache = new Map();
let topCommandersLoaded = false;

/**
 * Converts a card name to an EDHREC URL slug.
 * Handles split cards (MDFC front face), accents, and special characters.
 * @param {string} name
 * @returns {string}
 */
function commanderNameToSlug(name) {
    if (!name) return "";
    const frontFace = name.split(' // ')[0];
    return frontFace
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
}

/**
 * Pre-populates cache with the top 100 commanders from EDHREC.
 */
async function populateTopCommanders() {
    if (topCommandersLoaded) return;
    try {
        const res = await fetchWithRetry("https://json.edhrec.com/pages/commanders/year.json", {
            headers: DEFAULT_HEADERS,
            timeoutMs: 3500
        }, 1);

        if (res && res.ok) {
            const data = await res.json();
            const cardviews = data.container?.json_dict?.cardlists?.[0]?.cardviews || [];
            for (const card of cardviews) {
                if (card.name && card.rank !== undefined && card.rank !== null) {
                    commanderRankCache.set(normalizeCardName(card.name), card.rank);
                }
            }
            topCommandersLoaded = true;
        }
    } catch (e) {
        console.warn("[WARN] Could not fetch top commanders from EDHREC:", e.message || e);
    }
}

/**
 * Fetches an individual commander's rank by slug from EDHREC.
 * @param {string} name
 * @returns {Promise<number|null>}
 */
async function fetchCommanderRank(name) {
    const cleanKey = normalizeCardName(name);
    if (commanderRankCache.has(cleanKey)) {
        return commanderRankCache.get(cleanKey);
    }

    const slug = commanderNameToSlug(name);
    if (!slug) return null;

    try {
        const res = await fetchWithRetry(`https://json.edhrec.com/pages/commanders/${slug}.json`, {
            headers: DEFAULT_HEADERS,
            timeoutMs: 2500
        }, 1);

        if (!res || !res.ok) {
            commanderRankCache.set(cleanKey, null);
            return null;
        }

        const data = await res.json();
        const card = data.container?.json_dict?.card;
        const rank = (card && card.rank !== undefined && card.rank !== null) ? card.rank : null;

        commanderRankCache.set(cleanKey, rank);
        return rank;
    } catch (err) {
        commanderRankCache.set(cleanKey, null);
        return null;
    }
}

/**
 * Fetches and processes commander popularity ranks from EDHREC.
 * Populates top commanders and fetches any uncached requested commanders by slug.
 * @param {Array<string>} [commanderNames=[]] List of commander card names to fetch ranks for.
 * @returns {Promise<object>} A map of normalized commander names to their rank.
 */
async function fetchEdhrecRanks(commanderNames = []) {
    try {
        await populateTopCommanders();

        const resultRanks = {};
        const uncachedNames = [];

        for (const name of commanderNames) {
            const key = normalizeCardName(name);
            if (commanderRankCache.has(key)) {
                const rank = commanderRankCache.get(key);
                if (rank !== null) resultRanks[key] = rank;
            } else {
                uncachedNames.push(name);
            }
        }

        // Limit uncached lookups to 12 to prevent long latency
        const toLookup = uncachedNames.slice(0, 12);
        if (toLookup.length > 0) {
            const batchSize = 4;
            for (let i = 0; i < toLookup.length; i += batchSize) {
                const batch = toLookup.slice(i, i + batchSize);
                await Promise.all(batch.map(async (name) => {
                    const rank = await fetchCommanderRank(name);
                    const key = normalizeCardName(name);
                    if (rank !== null) {
                        resultRanks[key] = rank;
                    }
                }));

                if (i + batchSize < toLookup.length) {
                    await new Promise(r => setTimeout(r, 50));
                }
            }
        }

        // Include any top commanders already in cache into the returned map
        for (const [key, rank] of commanderRankCache.entries()) {
            if (rank !== null && !(key in resultRanks)) {
                resultRanks[key] = rank;
            }
        }

        return resultRanks;
    } catch (e) {
        console.error("[ERROR] Error fetching EDHREC ranks:", e.message || e);
        return {};
    }
}

module.exports = { fetchEdhrecRanks, commanderNameToSlug };