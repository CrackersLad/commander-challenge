const fs = require('fs');
const path = require('path');

const landsJsonPath = path.join(__dirname, '..', 'public', 'mtg-lands.json');
const outputPath = path.join(__dirname, '..', 'public', 'mtg-lands.js');

const lands = JSON.parse(fs.readFileSync(landsJsonPath, 'utf8'));
const allNames = new Set(lands.map(l => l.trim().toLowerCase()));

// Also add split land faces
lands.forEach(l => {
    if (l.includes(' // ')) {
        l.split(' // ').forEach(part => allNames.add(part.trim().toLowerCase()));
    }
});

const code = `/**
 * Official MTG Lands Knowledge Base - Extracted from Card-Forge Database
 * Total verified official lands: ${allNames.size}
 */
(function(root) {
    const LANDS_ARRAY = ${JSON.stringify(Array.from(allNames))};
    const LANDS_SET = new Set(LANDS_ARRAY);
    root.__MTG_ALL_LANDS__ = LANDS_SET;

    const LAND_NAME_REGEX = /\\b(Plains|Island|Swamp|Mountain|Forest|Wastes|Tower|Orchard|Catacombs|Hollow|Estuary|Aqueduct|Bog|Mire|Passage|Vista|Delta|Strand|Foothills|Heath|Flats|Tarn|Mesa|Rainforest|Palace|Sanctum|Monastery|Citadel|Bivouac|Outpost|Shrine|Grave|Foundry|Pool|Garden|Basin|Canyon|Coast|Peak|Falls|Canal|Spire|Heights|Quarter|Steppes|Territory|Gorge|Ridge|Valley|Creek|Crag|Grove|Meadow|Marsh|Fen|Wilds|Expanse|Rift|Sinkhole|Shoal|Lair|Moor|Plaza|Vault|Depths|Glade|Furnace|Haven|Crucible|Pathway|Fairgrounds|Courtyard|Cemetery|Barrens|Overpass|Watercourse|Landscape|Caves?|Springs|Gate|Bridge|Vents|Shores|Tomb|Sanctuary|Lounge|Acres|Blighted|Fountain|Forge|Retreat|Woodland|Summit|Lighthouse|Port|Camp|Ruins|Underground|Nexus|Harbor|River|Crest|Plateau|Savannah|Taiga|Tundra|Badlands|Bayou|Scrubland|Volcanic Island)\\b/i;

    /**
     * Determines if a card or card name is an MTG Land.
     * @param {Object|string} cardOrName
     * @returns {boolean}
     */
    function isLandCard(cardOrName) {
        if (!cardOrName) return false;
        if (typeof cardOrName === 'string') {
            const clean = cardOrName.trim().toLowerCase();
            if (LANDS_SET.has(clean)) return true;
            if (clean.includes(' // ')) {
                const parts = clean.split(' // ');
                if (parts.some(p => LANDS_SET.has(p.trim()))) return true;
            }
            return LAND_NAME_REGEX.test(clean);
        }

        const card = cardOrName;
        if (card.isLand === true) return true;

        const tl = (card.typeLine || '').toLowerCase();
        if (tl.includes('land')) return true;

        const name = (card.name || '').trim().toLowerCase();
        if (LANDS_SET.has(name)) return true;
        if (name.includes(' // ')) {
            const parts = name.split(' // ');
            if (parts.some(p => LANDS_SET.has(p.trim()))) return true;
        }

        if (LAND_NAME_REGEX.test(name)) return true;

        // If Scryfall oracle text has "{T}: Add" or enters tapped and no mana cost / 0 cmc
        const oracle = (card.oracleText || '').toLowerCase();
        if ((!card.manaCost || card.cmc === 0) && (oracle.includes('{t}: add') || oracle.includes('{t}, pay') || oracle.includes('enters tapped') || oracle.includes('enters the battlefield tapped'))) {
            return true;
        }

        return false;
    }

    root.isLandCard = isLandCard;
    root.isLandCardName = function(name) { return isLandCard(name); };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { isLandCard, LANDS_SET };
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
`;

fs.writeFileSync(outputPath, code, 'utf8');
console.log('Successfully generated public/mtg-lands.js, size:', fs.statSync(outputPath).size, 'bytes');
