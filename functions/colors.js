/**
 * Normalizes color arrays or strings from diverse APIs/CSVs into standard MTG single-letter color codes: W, U, B, R, G.
 * @param {Array|string} rawColors
 * @returns {Array<string>} Array of standard uppercase color codes: ['W', 'U', 'B', 'R', 'G']
 */
function normalizeColorCodes(rawColors) {
    if (!rawColors) return [];
    if (typeof rawColors === "string") {
        rawColors = rawColors.replace(/[{}]/g, " ").split(/[,/| \s]+/).filter(Boolean);
    }
    if (!Array.isArray(rawColors)) return [];
    const colorMap = {
        w: "W", white: "W",
        u: "U", blue: "U",
        b: "B", black: "B",
        r: "R", red: "R",
        g: "G", green: "G"
    };
    const set = new Set();
    for (const c of rawColors) {
        if (!c) continue;
        const str = String(c).trim().toLowerCase();
        if (colorMap[str]) {
            set.add(colorMap[str]);
        } else if (/^[wubrg]+$/i.test(str)) {
            for (const ch of str.toUpperCase()) {
                if (['W','U','B','R','G'].includes(ch)) set.add(ch);
            }
        }
    }
    return Array.from(set);
}

/**
 * Resiliently resolves a card's colors from any available source (colors, colorIdentity, manaCost, Scryfall).
 * Works across Archidekt collection items, Moxfield decks, CSV rows, and flat card models.
 * @param {object} item
 * @returns {Array<string>} Array of standard uppercase color codes: ['W', 'U', 'B', 'R', 'G']
 */
function resolveCardColors(item) {
    if (!item) return [];
    const cardInfo = item.card || item || {};
    const oracleData = cardInfo.oracleCard || cardInfo;

    const candidates = [
        oracleData.colors,
        cardInfo.colors,
        item.colors,
        oracleData.colorIdentity,
        oracleData.color_identity,
        cardInfo.colorIdentity,
        cardInfo.color_identity,
        item.colorIdentity,
        item.color_identity
    ];

    for (const cand of candidates) {
        if (!cand) continue;
        const normalized = normalizeColorCodes(cand);
        if (normalized.length > 0) return normalized;
    }

    // Fallback: extract from mana cost for non-lands
    const typeLine = (
        oracleData.type_line ||
        oracleData.typeLine ||
        cardInfo.type_line ||
        cardInfo.typeLine ||
        item.type_line ||
        item.typeLine ||
        item.type ||
        (oracleData.types ? [...(oracleData.superTypes || []), ...(oracleData.types || [])].join(" ") : "") ||
        ""
    ).toLowerCase();

    if (!typeLine.includes("land")) {
        const manaCost = (
            oracleData.manaCost ||
            oracleData.mana_cost ||
            cardInfo.manaCost ||
            cardInfo.mana_cost ||
            item.manaCost ||
            item.mana_cost ||
            ""
        ).toString();
        if (manaCost) {
            const matches = manaCost.match(/[WUBRG]/gi);
            if (matches) {
                const set = new Set();
                for (const m of matches) {
                    const up = m.toUpperCase();
                    if (['W','U','B','R','G'].includes(up)) set.add(up);
                }
                if (set.size > 0) return Array.from(set);
            }
        }
    }

    return [];
}

module.exports = {
    normalizeColorCodes,
    resolveCardColors
};
