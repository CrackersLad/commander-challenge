/**
 * ============================================================================
 * COMMANDER ARENA - CONTROLLER & TABLETOP PRESENTER
 * ============================================================================
 * Coordinates the browser-native Commander rules engine, live tabletop interactions,
 * real MTG card art via Scryfall, 4-player pod seating, and priority management.
 */

(function () {
    'use strict';

    let currentGame = null;
    let autoPlayTimer = null;
    let playSpeedMs = 700;
    let isPaused = true;
    let selectedAttackerIds = new Set();
    let attackerTargets = new Map(); // cardId -> { targetType: 'player'|'planeswalker', targetId, targetPlayerId, targetPlayerIndex, targetPlaneswalkerId, targetName }
    let currentTargetingAttackerId = null;
    let selectedOpponentTargetId = null;
    let selectedBottomCardIds = new Set();

    // Initialize Card Cache from commander-cards-cache.json
    try {
        fetch('commander-cards-cache.json')
            .then(r => r.json())
            .then(data => { window.__MTG_CARD_CACHE__ = data; })
            .catch(() => {});
    } catch (e) {}

    // Initialize Flagged Cards Database (non-blocking)
    try {
        fetch('forge-flagged-cards.json')
            .then(r => r.json())
            .then(data => { window.__FORGE_FLAGGED_CARDS__ = data; })
            .catch(() => {});
    } catch (e) {}

    function getCardEngineIssue(cardName) {
        if (!cardName || !window.__FORGE_FLAGGED_CARDS__) return null;
        const cleanName = String(cardName).toLowerCase().trim()
            .replace(/\s*\([A-Za-z0-9_-]+\).*$/, '')
            .replace(/\s*\[[A-Za-z0-9_-]+\].*$/, '');
        return window.__FORGE_FLAGGED_CARDS__[cleanName] || null;
    }
    window.getCardEngineIssue = getCardEngineIssue;

    function getPermanentManaAbilities(card) {
        if (!card) return null;
        const name = (card.name || '').trim();
        const oracle = (card.oracleText || '').trim();
        const typeLine = (card.typeLine || '').toLowerCase();

        // 0. Treasure Tokens (Tap & Sacrifice this artifact: Add one mana of any color)
        if (/treasure/i.test(name) || typeLine.includes('treasure')) {
            return {
                isMulti: true,
                options: ['W', 'U', 'B', 'R', 'G'].map(c => ({
                    colors: [c],
                    cost: { sacrificeSelf: true },
                    desc: `Sacrifice ${name}: Add {${c}}`
                }))
            };
        }

        // 1. Basic Lands
        if (name === 'Plains' || (typeLine.includes('plains') && !typeLine.includes('swamp') && !typeLine.includes('island') && !typeLine.includes('mountain') && !typeLine.includes('forest') && !oracle)) {
            return { isMulti: false, options: [{ colors: ['W'], cost: null, desc: 'Add {W}' }] };
        }
        if (name === 'Island' || (typeLine.includes('island') && !typeLine.includes('swamp') && !typeLine.includes('plains') && !typeLine.includes('mountain') && !typeLine.includes('forest') && !oracle)) {
            return { isMulti: false, options: [{ colors: ['U'], cost: null, desc: 'Add {U}' }] };
        }
        if (name === 'Swamp' || (typeLine.includes('swamp') && !typeLine.includes('island') && !typeLine.includes('plains') && !typeLine.includes('mountain') && !typeLine.includes('forest') && !oracle)) {
            return { isMulti: false, options: [{ colors: ['B'], cost: null, desc: 'Add {B}' }] };
        }
        if (name === 'Mountain' || (typeLine.includes('mountain') && !typeLine.includes('island') && !typeLine.includes('plains') && !typeLine.includes('swamp') && !typeLine.includes('forest') && !oracle)) {
            return { isMulti: false, options: [{ colors: ['R'], cost: null, desc: 'Add {R}' }] };
        }
        if (name === 'Forest' || (typeLine.includes('forest') && !typeLine.includes('island') && !typeLine.includes('plains') && !typeLine.includes('swamp') && !typeLine.includes('mountain') && !oracle)) {
            return { isMulti: false, options: [{ colors: ['G'], cost: null, desc: 'Add {G}' }] };
        }
        if (name === 'Wastes') {
            return { isMulti: false, options: [{ colors: ['C'], cost: null, desc: 'Add {C}' }] };
        }

        // 2. Sol Ring
        if (name === 'Sol Ring') {
            return { isMulti: false, options: [{ colors: ['C', 'C'], cost: null, desc: 'Add {C}{C}' }] };
        }

        // 3. Command Tower, Exotic Orchard, Reflecting Pool, Mana Confluence, City of Brass, Forbidden Orchard
        if (/Command Tower|Exotic Orchard|Reflecting Pool|Mana Confluence|Forbidden Orchard|Plaza of Heroes|Path of Ancestry/i.test(name)) {
            return {
                isMulti: true,
                options: ['W', 'U', 'B', 'R', 'G'].map(c => ({
                    colors: [c],
                    cost: null,
                    desc: `Add {${c}}`
                }))
            };
        }
        if (name === 'City of Brass') {
            return {
                isMulti: true,
                options: ['W', 'U', 'B', 'R', 'G'].map(c => ({
                    colors: [c],
                    cost: { life: 1 },
                    desc: `Add {${c}} (Costs 1 Life)`
                }))
            };
        }

        // 4. Arcane Signet / Commander's Sphere / Fellwar Stone
        if (/Arcane Signet|Commander's Sphere|Fellwar Stone/i.test(name)) {
            return {
                isMulti: true,
                options: ['W', 'U', 'B', 'R', 'G'].map(c => ({
                    colors: [c],
                    cost: null,
                    desc: `Add {${c}}`
                }))
            };
        }

        // 5. Pain Lands & Talismans
        const painMatch = oracle.match(/Add\s*\{C\}[\s\S]*?Add\s*\{([WUBRG])\}\s*or\s*\{([WUBRG])\}[\s\S]*?(?:deals 1 damage|pay 1 life)/i);
        if (painMatch || /Talisman of/i.test(name) || /Caves of Koilos|Underground River|Sulfurous Springs|Battlefield Forge|Brushland|Llanowar Wastes|Karplusan Forest|Shivan Reef|Yavimaya Coast|Adarkar Wastes/i.test(name)) {
            let c1 = 'U', c2 = 'B';
            if (painMatch) {
                c1 = painMatch[1].toUpperCase();
                c2 = painMatch[2].toUpperCase();
            } else {
                const m = oracle.match(/\{([WUBRG])\}\s*or\s*\{([WUBRG])\}/i);
                if (m) { c1 = m[1].toUpperCase(); c2 = m[2].toUpperCase(); }
            }
            return {
                isMulti: true,
                options: [
                    { colors: ['C'], cost: null, desc: 'Add {C} (Colorless, No Life Cost)' },
                    { colors: [c1], cost: { life: 1 }, desc: `Add {${c1}} (Costs 1 Life)` },
                    { colors: [c2], cost: { life: 1 }, desc: `Add {${c2}} (Costs 1 Life)` }
                ]
            };
        }

        // 6. Filter Lands
        const filterMatch = oracle.match(/\{1\},\s*\{T\}:\s*Add\s*\{([WUBRG])\}\{([WUBRG])\},\s*\{([WUBRG])\}\{([WUBRG])\},\s*or\s*\{([WUBRG])\}\{([WUBRG])\}/i);
        if (filterMatch) {
            return {
                isMulti: true,
                options: [
                    { colors: ['C'], cost: null, desc: 'Add {C}' },
                    { colors: [filterMatch[1], filterMatch[2]], cost: { mana: 1 }, desc: `Add {${filterMatch[1]}}{${filterMatch[2]}} (Pay {1})` },
                    { colors: [filterMatch[3], filterMatch[4]], cost: { mana: 1 }, desc: `Add {${filterMatch[3]}}{${filterMatch[4]}} (Pay {1})` },
                    { colors: [filterMatch[5], filterMatch[6]], cost: { mana: 1 }, desc: `Add {${filterMatch[5]}}{${filterMatch[6]}} (Pay {1})` }
                ]
            };
        }

        // 7. Signets (e.g. {1}, {T}: Add {U}{B})
        const signetMatch = oracle.match(/\{1\},\s*\{T\}:\s*Add\s*\{([WUBRG])\}\{([WUBRG])\}/i);
        if (signetMatch) {
            return {
                isMulti: false,
                options: [
                    { colors: [signetMatch[1], signetMatch[2]], cost: { mana: 1 }, desc: `Add {${signetMatch[1]}}{${signetMatch[2]}} (Pay {1})` }
                ]
            };
        }

        // 8. Dual Lands / Shock / Check / Fast / Bounce / Pathways
        const dualMatch = oracle.match(/\{T\}:\s*Add\s*\{([WUBRGC])\}\s*or\s*\{([WUBRGC])\}/i);
        if (dualMatch) {
            const c1 = dualMatch[1].toUpperCase();
            const c2 = dualMatch[2].toUpperCase();
            return {
                isMulti: true,
                options: [
                    { colors: [c1], cost: null, desc: `Add {${c1}}` },
                    { colors: [c2], cost: null, desc: `Add {${c2}}` }
                ]
            };
        }

        // 9. Generic "Add one mana of any color"
        if (/add one mana of any color/i.test(oracle) || /add one mana of any type/i.test(oracle)) {
            return {
                isMulti: true,
                options: ['W', 'U', 'B', 'R', 'G'].map(c => ({
                    colors: [c],
                    cost: null,
                    desc: `Add {${c}}`
                }))
            };
        }

        // 10. Fallback for Land / Mana Rock / Dork
        const isLand = card.isLand || (typeof window !== 'undefined' && typeof window.isLandCard === 'function' && window.isLandCard(card)) || typeLine.includes('land');
        if (isLand || card.isManaRock || typeLine.includes('artifact')) {
            // Check land basic subtypes in typeLine (e.g. "Land — Island Swamp")
            const basicSubtypes = [];
            if (/plains/i.test(typeLine)) basicSubtypes.push('W');
            if (/island/i.test(typeLine)) basicSubtypes.push('U');
            if (/swamp/i.test(typeLine)) basicSubtypes.push('B');
            if (/mountain/i.test(typeLine)) basicSubtypes.push('R');
            if (/forest/i.test(typeLine)) basicSubtypes.push('G');

            if (basicSubtypes.length > 1) {
                return {
                    isMulti: true,
                    options: basicSubtypes.map(c => ({ colors: [c], cost: null, desc: `Add {${c}}` }))
                };
            } else if (basicSubtypes.length === 1) {
                return {
                    isMulti: false,
                    options: [{ colors: [basicSubtypes[0]], cost: null, desc: `Add {${basicSubtypes[0]}}` }]
                };
            }

            // Check known color guilds in land name or popular lands
            const nLower = name.toLowerCase();
            // Dimir U/B
            if (/choked estuary|sunken hollow|drowned catacomb|darkwater catacombs|watery grave|fetid pools|temple of deceit|underground river|darkslick shores|shipwreck marsh|morphic pool|tainted isle|clearwater pathway/i.test(nLower)) {
                return { isMulti: true, options: [{ colors: ['U'], cost: null, desc: 'Add {U}' }, { colors: ['B'], cost: null, desc: 'Add {B}' }] };
            }
            // Azorius W/U
            if (/hallowed fountain|glacial fortress|port town|prairie stream|deserted beach|sea of clouds|temple of enlightenment|adarkar wastes|hengegate pathway|seachrome coast/i.test(nLower)) {
                return { isMulti: true, options: [{ colors: ['W'], cost: null, desc: 'Add {W}' }, { colors: ['U'], cost: null, desc: 'Add {U}' }] };
            }
            // Rakdos B/R
            if (/blood crypt|dragonskull summit|foreboding ruins|smoldering marsh|haunted ridge|luxury suite|temple of malice|sulfurous springs|blightstep pathway|blackcleave cliffs/i.test(nLower)) {
                return { isMulti: true, options: [{ colors: ['B'], cost: null, desc: 'Add {B}' }, { colors: ['R'], cost: null, desc: 'Add {R}' }] };
            }
            // Gruul R/G
            if (/stomping ground|rootbound crag|game trail|cinder glade|rockfall vale|spire garden|temple of abandon|karplusan forest|cragcrown pathway|copperline gorge/i.test(nLower)) {
                return { isMulti: true, options: [{ colors: ['R'], cost: null, desc: 'Add {R}' }, { colors: ['G'], cost: null, desc: 'Add {G}' }] };
            }
            // Selesnya G/W
            if (/temple garden|sunpetal grove|fortified village|canopy vista|overgrown farmland|bountiful promenade|temple of plenty|brushland|branchloft pathway/i.test(nLower)) {
                return { isMulti: true, options: [{ colors: ['G'], cost: null, desc: 'Add {G}' }, { colors: ['W'], cost: null, desc: 'Add {W}' }] };
            }
            // Orzhov W/B
            if (/godless shrine|isolated chapel|shineshadow snarl|concealed courtyard|shattered sanctuary|vault of champions|temple of silence|caves of koilos|brightclimb pathway/i.test(nLower)) {
                return { isMulti: true, options: [{ colors: ['W'], cost: null, desc: 'Add {W}' }, { colors: ['B'], cost: null, desc: 'Add {B}' }] };
            }
            // Izzet U/R
            if (/steam vents|sulfur falls|frostboil snarl|spirebluff canal|stormcarved coast|training center|temple of epiphany|shivan reef|riverglide pathway/i.test(nLower)) {
                return { isMulti: true, options: [{ colors: ['U'], cost: null, desc: 'Add {U}' }, { colors: ['R'], cost: null, desc: 'Add {R}' }] };
            }
            // Golgari B/G
            if (/overgrown tomb|woodland cemetery|necroblossom snarl|blooming marsh|deathcap glade|undergrowth stadium|temple of malady|llanowar wastes|darkbore pathway/i.test(nLower)) {
                return { isMulti: true, options: [{ colors: ['B'], cost: null, desc: 'Add {B}' }, { colors: ['G'], cost: null, desc: 'Add {G}' }] };
            }
            // Boros R/W
            if (/sacred foundry|clifftop retreat|furycalm snarl|inspiring vantage|sundown pass|spectator seating|temple of triumph|battlefield forge|needleverge pathway/i.test(nLower)) {
                return { isMulti: true, options: [{ colors: ['R'], cost: null, desc: 'Add {R}' }, { colors: ['W'], cost: null, desc: 'Add {W}' }] };
            }
            // Simic G/U
            if (/breeding pool|hinterland harbor|vineglimmer snarl|botanical sanctum|dreamroot cascade|rejuvenating springs|temple of mystery|yavimaya coast|barkchannel pathway/i.test(nLower)) {
                return { isMulti: true, options: [{ colors: ['G'], cost: null, desc: 'Add {G}' }, { colors: ['U'], cost: null, desc: 'Add {U}' }] };
            }
            // Triomes & Any-Color
            if (/triome|xander's lounge|ziatora's|raffine's tower|spara's|jetmir's|tower|orchard|haven|reflecting/i.test(nLower)) {
                return { isMulti: true, options: ['W', 'U', 'B', 'R', 'G'].map(c => ({ colors: [c], cost: null, desc: `Add {${c}}` })) };
            }

            // Pure Fetchlands (do NOT produce mana on their own)
            const isPureFetchLand = /evolving wilds|terramorphic expanse|fabled passage|prismatic vista|brokers hideout|cabaretti courtyard|maestros theater|obscura storefront|riveteers overlook|flooded strand|polluted delta|bloodstained mire|wooded foothills|windswept heath|marsh flats|scalding tarn|verdant catacombs|arid mesa|misty rainforest/i.test(nLower) ||
                (isLand && oracle && /search your library/i.test(oracle) && !/add\s+\{[WUBRGC0-9]+\}|add\s+one\s+mana|add\s+two\s+mana|add\s+three\s+mana/i.test(oracle));
            if (isPureFetchLand) {
                return null;
            }

            // Non-land artifacts that don't actually produce mana (e.g. Wayfarer's Bauble, Equipment)
            if (!isLand && !card.isManaRock) {
                const hasManaText = /add\s+\{[WUBRGC0-9]+\}|add\s+one\s+mana|add\s+two\s+mana|add\s+three\s+mana/i.test(oracle);
                if (!hasManaText) return null;
            }

            if (Array.isArray(card.colors) && card.colors.length > 1) {
                return {
                    isMulti: true,
                    options: card.colors.map(c => ({
                        colors: [c],
                        cost: null,
                        desc: `Add {${c}}`
                    }))
                };
            } else if (Array.isArray(card.colors) && card.colors.length === 1) {
                return {
                    isMulti: false,
                    options: [{ colors: [card.colors[0]], cost: null, desc: `Add {${card.colors[0]}}` }]
                };
            }
            return {
                isMulti: false,
                options: [{ colors: ['C'], cost: null, desc: 'Add {C}' }]
            };
        }

        return null;
    }
    window.getPermanentManaAbilities = getPermanentManaAbilities;

    function parseActivatedAbilities(card) {
        if (!card) return [];
        const abilities = [];
        const oracle = card.oracleText || '';
        const lines = oracle.replace(/\\n/g, '\n').split(/\r?\n/);

        for (let rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;

            // Planeswalker loyalty: "+1: ...", "-3: ...", "0: ..."
            const loyaltyMatch = line.match(/^([+−\-]?\d+)\s*:\s*(.+)$/);
            if (loyaltyMatch) {
                const deltaStr = loyaltyMatch[1].replace('−', '-');
                const delta = parseInt(deltaStr, 10);
                abilities.push({
                    type: 'LOYALTY',
                    costText: loyaltyMatch[1],
                    loyaltyDelta: delta,
                    effectText: loyaltyMatch[2].trim(),
                    requiresTap: false,
                    requiresSacrifice: false,
                    manaCostNum: 0,
                    raw: line
                });
                continue;
            }

            // Standard activated ability: "[Cost] : [Effect]"
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
                const costPart = line.substring(0, colonIdx).trim();
                const effectPart = line.substring(colonIdx + 1).trim();

                const hasTap = /\{T\}|tap/i.test(costPart);
                const hasMana = /\{[0-9WUBRGCX]+\}/i.test(costPart);
                const hasSac = /sacrifice/i.test(costPart);
                const hasPay = /pay/i.test(costPart);
                const hasCounter = /counter/i.test(costPart);
                const isEquip = /^equip/i.test(costPart);

                // Exclude pure single mana abilities like "{T}: Add {W}" so they don't clutter the non-mana ability popup
                const isPureMana = hasTap && /^add\s+\{[WUBRGC]\}/i.test(effectPart);

                if (!isPureMana && (hasTap || hasMana || hasSac || hasPay || hasCounter || isEquip || costPart.length < 50)) {
                    let manaCostNum = 0;
                    const manaMatches = costPart.match(/\{([0-9WUBRGC]+)\}/g);
                    if (manaMatches) {
                        manaMatches.forEach(m => {
                            const val = m.replace(/[\{\}]/g, '');
                            const n = parseInt(val, 10);
                            manaCostNum += isNaN(n) ? 1 : n;
                        });
                    }

                    abilities.push({
                        type: isEquip ? 'EQUIP' : (hasTap ? 'TAP_ABILITY' : 'ACTIVATED'),
                        costText: costPart,
                        effectText: effectPart,
                        requiresTap: hasTap,
                        requiresSacrifice: hasSac,
                        manaCostNum: manaCostNum,
                        raw: line
                    });
                }
            }
        }

        if (Array.isArray(card.abilities)) {
            card.abilities.forEach(ab => {
                if (ab && !abilities.some(x => x.costText === ab.cost && x.effectText === ab.effect)) {
                    abilities.push({
                        type: ab.type || 'ACTIVATED',
                        costText: ab.cost || 'Cost',
                        effectText: ab.effect || ab.text || '',
                        requiresTap: !!ab.requiresTap,
                        requiresSacrifice: !!ab.requiresSacrifice,
                        manaCostNum: ab.manaCost || 0,
                        raw: ab.text || `${ab.cost}: ${ab.effect}`
                    });
                }
            });
        }

        // Fallback recognition for famous fetch lands/baubles if oracleText was missing/generic
        if (abilities.length === 0 && card && card.name) {
            const nameLower = card.name.toLowerCase();
            if (nameLower.includes('fabled passage')) {
                abilities.push({
                    type: 'TAP_ABILITY',
                    costText: '{T}, Sacrifice Fabled Passage',
                    effectText: 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.',
                    requiresTap: true,
                    requiresSacrifice: true,
                    manaCostNum: 0,
                    raw: '{T}, Sacrifice Fabled Passage: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.'
                });
            } else if (nameLower.includes('evolving wilds') || nameLower.includes('terramorphic expanse')) {
                abilities.push({
                    type: 'TAP_ABILITY',
                    costText: `{T}, Sacrifice ${card.name}`,
                    effectText: 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
                    requiresTap: true,
                    requiresSacrifice: true,
                    manaCostNum: 0,
                    raw: `{T}, Sacrifice ${card.name}: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.`
                });
            } else if (nameLower.includes('prismatic vista')) {
                abilities.push({
                    type: 'TAP_ABILITY',
                    costText: '{T}, Pay 1 life, Sacrifice Prismatic Vista',
                    effectText: 'Search your library for a basic land card, put it onto the battlefield, then shuffle.',
                    requiresTap: true,
                    requiresSacrifice: true,
                    manaCostNum: 0,
                    raw: '{T}, Pay 1 life, Sacrifice Prismatic Vista: Search your library for a basic land card, put it onto the battlefield, then shuffle.'
                });
            } else if (nameLower.includes('shire terrace') || nameLower.includes('promising vein')) {
                abilities.push({
                    type: 'TAP_ABILITY',
                    costText: `{1}, {T}, Sacrifice ${card.name}`,
                    effectText: 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
                    requiresTap: true,
                    requiresSacrifice: true,
                    manaCostNum: 1,
                    raw: `{1}, {T}, Sacrifice ${card.name}: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.`
                });
            } else if (nameLower.includes('myriad landscape')) {
                abilities.push({
                    type: 'TAP_ABILITY',
                    costText: '{2}, {T}, Sacrifice Myriad Landscape',
                    effectText: 'Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.',
                    requiresTap: true,
                    requiresSacrifice: true,
                    manaCostNum: 2,
                    raw: '{2}, {T}, Sacrifice Myriad Landscape: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.'
                });
            } else if (nameLower.includes("wayfarer's bauble")) {
                abilities.push({
                    type: 'TAP_ABILITY',
                    costText: "{2}, {T}, Sacrifice Wayfarer's Bauble",
                    effectText: 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
                    requiresTap: true,
                    requiresSacrifice: true,
                    manaCostNum: 2,
                    raw: "{2}, {T}, Sacrifice Wayfarer's Bauble: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle."
                });
            } else if (nameLower.includes('blighted woodland')) {
                abilities.push({
                    type: 'TAP_ABILITY',
                    costText: '{3}{G}, {T}, Sacrifice Blighted Woodland',
                    effectText: 'Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.',
                    requiresTap: true,
                    requiresSacrifice: true,
                    manaCostNum: 4,
                    raw: '{3}{G}, {T}, Sacrifice Blighted Woodland: Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.'
                });
            } else if (nameLower.includes('krosan verge')) {
                abilities.push({
                    type: 'TAP_ABILITY',
                    costText: '{2}, {T}, Sacrifice Krosan Verge',
                    effectText: 'Search your library for a Forest card and a Plains card, put them onto the battlefield tapped, then shuffle.',
                    requiresTap: true,
                    requiresSacrifice: true,
                    manaCostNum: 2,
                    raw: '{2}, {T}, Sacrifice Krosan Verge: Search your library for a Forest card and a Plains card, put them onto the battlefield tapped, then shuffle.'
                });
            }
        }

        return abilities;
    }
    window.parseActivatedAbilities = parseActivatedAbilities;

    function parseDecklistText(text, explicitCommander = null) {
        if (!text || typeof text !== 'string') return { commander: explicitCommander || null, cards: [] };
        const lines = text.split(/\r?\n/);
        let commander = explicitCommander ? String(explicitCommander).trim() : null;
        const cards = [];
        let inCommanderSection = false;

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            if (/^\/\/\s*commander/i.test(line) || /^#\s*commander/i.test(line) || /^commander:?$/i.test(line)) {
                inCommanderSection = true;
                continue;
            }
            if (/^\/\/\s*(?:mainboard|deck|main|cards|creatures|spells|lands|maybeboard|sideboard)/i.test(line) || /^#\s*(?:mainboard|deck)/i.test(line) || /^(?:mainboard|deck|main):?$/i.test(line)) {
                inCommanderSection = false;
                continue;
            }
            if (line.startsWith('#') || line.startsWith('//')) {
                continue;
            }

            const match = line.match(/^(\d+)x?\s+(.+?)(?:\s+\[CMDR\]|\s+\*CMDR\*|\s+\(CMDR\))?$/i);
            let qty = 1;
            let cardName = line;
            let isCmdr = inCommanderSection || /\*CMDR\*|\[CMDR\]|\(CMDR\)/i.test(line);

            if (match) {
                qty = parseInt(match[1], 10);
                cardName = match[2].trim();
            }

            cardName = cardName.replace(/\s*\([A-Za-z0-9_-]+\).*$/, '').replace(/\s*\[[A-Za-z0-9_-]+\].*$/, '').trim();

            if (isCmdr && !commander) {
                commander = cardName;
            }

            const cached = (typeof window !== 'undefined' && window.__MTG_CARD_CACHE__) ? window.__MTG_CARD_CACHE__[cardName.toLowerCase()] : null;
            const isLand = cached
                ? Boolean(cached.typeLine && cached.typeLine.toLowerCase().includes('land') && (!cached.manaCost || cached.cmc === 0))
                : (typeof window !== 'undefined' && typeof window.isLandCard === 'function' ? window.isLandCard(cardName) : false);

            cards.push({
                name: cardName,
                quantity: qty,
                isCommander: isCmdr,
                isLand: isLand,
                typeLine: cached ? cached.typeLine : (isLand ? 'Land' : undefined),
                cmc: cached ? cached.cmc : (isLand ? 0 : undefined),
                manaCost: cached ? cached.manaCost : (isLand ? '' : undefined),
                power: cached ? cached.power : undefined,
                toughness: cached ? cached.toughness : undefined,
                oracleText: cached ? cached.oracleText : undefined
            });
        }

        if (!commander && cards.length > 0) {
            commander = cards[0].name;
            cards[0].isCommander = true;
        }

        return { commander, cards };
    }
    window.parseDecklistText = parseDecklistText;

    function checkDeckForEngineIssues(deck) {
        if (!deck) return [];
        if ((!deck.cards || deck.cards.length === 0) && deck.decklist) {
            const parsed = parseDecklistText(deck.decklist, deck.commander);
            deck.cards = parsed.cards;
            if (parsed.commander && !deck.commander) deck.commander = parsed.commander;
        }
        if (!deck.cards || !Array.isArray(deck.cards)) return [];
        if (!window.__FORGE_FLAGGED_CARDS__) return [];

        const flagged = [];
        const seen = new Set();
        deck.cards.forEach(c => {
            const name = (c && c.name) ? c.name : (typeof c === 'string' ? c : '');
            if (!name) return;
            const issue = getCardEngineIssue(name);
            const lowerKey = name.toLowerCase().trim();
            if (issue && !seen.has(lowerKey)) {
                seen.add(lowerKey);
                flagged.push({
                    name: issue.name || name,
                    category: issue.category,
                    reason: issue.reason
                });
            }
        });
        return flagged;
    }
    window.checkDeckForEngineIssues = checkDeckForEngineIssues;

    function parseRemoteDeckData(data, safeUrl) {
        if (!data) throw new Error("No data returned from deck source.");
        if (safeUrl.includes("archidekt.com")) {
            const deckName = data.name || "Archidekt Commander Deck";
            const rawCards = data.cards || [];
            let commanderName = null;
            const parsedCards = [];

            rawCards.forEach(item => {
                const c = item.card;
                if (!c) return;
                const name = c.oracleCard?.name || c.name;
                if (!name) return;
                const qty = parseInt(item.quantity || 1, 10);
                const isCmdr = Array.isArray(item.categories) && item.categories.some(cat => ['commander', 'commanders'].includes(String(cat).toLowerCase()));
                if (isCmdr && !commanderName) commanderName = name;
                parsedCards.push({
                    name: name,
                    quantity: qty,
                    manaCost: c.oracleCard?.manaCost || c.manaCost,
                    cmc: c.oracleCard?.cmc || c.cmc,
                    typeLine: c.oracleCard?.type || c.type,
                    power: c.oracleCard?.power || c.power,
                    toughness: c.oracleCard?.toughness || c.toughness,
                    oracleText: c.oracleCard?.text || c.oracleCard?.oracleText || c.text || '',
                    isCommander: isCmdr
                });
            });
            if (!commanderName && parsedCards.length > 0) {
                commanderName = parsedCards[0].name;
                parsedCards[0].isCommander = true;
            }
            return {
                id: 'custom_arch_' + Date.now(),
                name: `🌟 ${deckName}`,
                commander: commanderName,
                cards: parsedCards,
                group: 'custom'
            };
        } else if (safeUrl.includes("moxfield.com")) {
            const deckName = data.name || "Moxfield Commander Deck";
            let commanderName = null;
            const parsedCards = [];

            if (data.commanders) {
                Object.values(data.commanders).forEach(item => {
                    const c = item.card;
                    const name = c ? c.name : item.name;
                    if (!name) return;
                    if (!commanderName) commanderName = name;
                    parsedCards.push({
                        name: name,
                        quantity: parseInt(item.quantity || 1, 10),
                        manaCost: c?.mana_cost || item.mana_cost,
                        cmc: c?.cmc || item.cmc,
                        typeLine: c?.type_line || item.type_line,
                        power: c?.power,
                        toughness: c?.toughness,
                        oracleText: c?.oracle_text || '',
                        isCommander: true
                    });
                });
            }

            if (data.mainboard) {
                Object.values(data.mainboard).forEach(item => {
                    const c = item.card;
                    const name = c ? c.name : item.name;
                    if (!name) return;
                    parsedCards.push({
                        name: name,
                        quantity: parseInt(item.quantity || 1, 10),
                        manaCost: c?.mana_cost || item.mana_cost,
                        cmc: c?.cmc || item.cmc,
                        typeLine: c?.type_line || item.type_line,
                        power: c?.power,
                        toughness: c?.toughness,
                        oracleText: c?.oracle_text || '',
                        isCommander: false
                    });
                });
            }
            return {
                id: 'custom_mox_' + Date.now(),
                name: `🌟 ${deckName}`,
                commander: commanderName || (parsedCards[0] ? parsedCards[0].name : 'Commander'),
                cards: parsedCards,
                group: 'custom'
            };
        }
        throw new Error("Unrecognized deck source format.");
    }
    window.parseRemoteDeckData = parseRemoteDeckData;

    // High quality Commander precons with curated card lists
    const PRESET_DECKS = [
        {
                "id": "preset_wilhelt",
                "name": "Wilhelt, the Rotcleaver (Zombies)",
                "commander": "Wilhelt, the Rotcleaver",
                "cards": [
                        {
                                "name": "Wilhelt, the Rotcleaver",
                                "quantity": 1,
                                "manaCost": "{2}{U}{B}",
                                "cmc": 4,
                                "typeLine": "Legendary Creature — Zombie Warrior",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Whenever another Zombie you control dies, if it didn't have decayed, create a 2/2 black Zombie creature token with decayed. (It can't block. When it attacks, sacrifice it at end of combat.)\nAt the beginning of your end step, you may sacrifice a Zombie. If you do, draw a card.",
                                "isCommander": true
                        },
                        {
                                "name": "Liliana, Death's Majesty",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Legendary Planeswalker — Liliana",
                                "oracleText": "+1: Create a 2/2 black Zombie creature token. Mill two cards.\n−3: Return target creature card from your graveyard to the battlefield. That creature is a black Zombie in addition to its other colors and types.\n−7: Destroy all non-Zombie creatures.",
                                "isCommander": false
                        },
                        {
                                "name": "Forgotten Creation",
                                "quantity": 1,
                                "manaCost": "{3}{U}",
                                "cmc": 4,
                                "typeLine": "Creature — Zombie Horror",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Skulk (This creature can't be blocked by creatures with greater power.)\nAt the beginning of your upkeep, you may discard all the cards in your hand. If you do, draw that many cards.",
                                "isCommander": false
                        },
                        {
                                "name": "Havengul Runebinder",
                                "quantity": 1,
                                "manaCost": "{2}{U}{U}",
                                "cmc": 4,
                                "typeLine": "Creature — Human Wizard",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "{2}{U}, {T}, Exile a creature card from your graveyard: Create a 2/2 black Zombie creature token, then put a +1/+1 counter on each Zombie creature you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Stitcher Geralf",
                                "quantity": 1,
                                "manaCost": "{3}{U}{U}",
                                "cmc": 5,
                                "typeLine": "Legendary Creature — Human Wizard",
                                "power": "3",
                                "toughness": "4",
                                "oracleText": "{2}{U}, {T}: Each player mills three cards. Exile up to two creature cards put into graveyards this way. Create an X/X blue Zombie creature token, where X is the total power of the cards exiled this way.",
                                "isCommander": false
                        },
                        {
                                "name": "Undead Alchemist",
                                "quantity": 1,
                                "manaCost": "{3}{U}",
                                "cmc": 4,
                                "typeLine": "Creature — Zombie",
                                "power": "4",
                                "toughness": "2",
                                "oracleText": "If a Zombie you control would deal combat damage to a player, instead that player mills that many cards.\nWhenever a creature card is put into an opponent's graveyard from their library, exile that card and create a 2/2 black Zombie creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Butcher of Malakir",
                                "quantity": 1,
                                "manaCost": "{5}{B}{B}",
                                "cmc": 7,
                                "typeLine": "Creature — Vampire Warrior",
                                "power": "5",
                                "toughness": "4",
                                "oracleText": "Flying\nWhenever this creature or another creature you control dies, each opponent sacrifices a creature of their choice.",
                                "isCommander": false
                        },
                        {
                                "name": "Cemetery Reaper",
                                "quantity": 1,
                                "manaCost": "{1}{B}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Other Zombie creatures you control get +1/+1.\n{2}{B}, {T}: Exile target creature card from a graveyard. Create a 2/2 black Zombie creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Death Baron",
                                "quantity": 1,
                                "manaCost": "{1}{B}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie Wizard",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Skeletons you control and other Zombies you control get +1/+1 and have deathtouch. (Any amount of damage they deal to a creature is enough to destroy it.)",
                                "isCommander": false
                        },
                        {
                                "name": "Diregraf Colossus",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie Giant",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "This creature enters with a +1/+1 counter on it for each Zombie card in your graveyard.\nWhenever you cast a Zombie spell, create a tapped 2/2 black Zombie creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Eater of Hope",
                                "quantity": 1,
                                "manaCost": "{5}{B}{B}",
                                "cmc": 7,
                                "typeLine": "Creature — Demon",
                                "power": "6",
                                "toughness": "4",
                                "oracleText": "Flying\n{B}, Sacrifice another creature: Regenerate this creature.\n{2}{B}, Sacrifice two other creatures: Destroy target creature.",
                                "isCommander": false
                        },
                        {
                                "name": "Gravespawn Sovereign",
                                "quantity": 1,
                                "manaCost": "{4}{B}{B}",
                                "cmc": 6,
                                "typeLine": "Creature — Zombie",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Tap five untapped Zombies you control: Put target creature card from a graveyard onto the battlefield under your control.",
                                "isCommander": false
                        },
                        {
                                "name": "Midnight Reaper",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie Knight",
                                "power": "3",
                                "toughness": "2",
                                "oracleText": "Whenever a nontoken creature you control dies, this creature deals 1 damage to you and you draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Overseer of the Damned",
                                "quantity": 1,
                                "manaCost": "{5}{B}{B}",
                                "cmc": 7,
                                "typeLine": "Creature — Demon",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Flying\nWhen this creature enters, you may destroy target creature.\nWhenever a nontoken creature an opponent controls dies, create a tapped 2/2 black Zombie creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Gisa and Geralf",
                                "quantity": 1,
                                "manaCost": "{2}{U}{B}",
                                "cmc": 4,
                                "typeLine": "Legendary Creature — Human Wizard",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "When Gisa and Geralf enters, mill four cards.\nOnce during each of your turns, you may cast a Zombie creature spell from your graveyard.",
                                "isCommander": false
                        },
                        {
                                "name": "Eternal Skylord",
                                "quantity": 1,
                                "manaCost": "{4}{U}",
                                "cmc": 5,
                                "typeLine": "Creature — Zombie Wizard",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "When this creature enters, amass Zombies 2. (Put two +1/+1 counters on an Army you control. It's also a Zombie. If you don't control an Army, create a 0/0 black Zombie Army creature token first.)\nZombie tokens you control have flying.",
                                "isCommander": false
                        },
                        {
                                "name": "Corpse Augur",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Creature — Zombie Wizard",
                                "power": "4",
                                "toughness": "2",
                                "oracleText": "When this creature dies, you draw X cards and you lose X life, where X is the number of creature cards in target player's graveyard.",
                                "isCommander": false
                        },
                        {
                                "name": "Fleshbag Marauder",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie Warrior",
                                "power": "3",
                                "toughness": "1",
                                "oracleText": "When this creature enters, each player sacrifices a creature of their choice.",
                                "isCommander": false
                        },
                        {
                                "name": "Liliana's Devotee",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Human Warlock",
                                "power": "2",
                                "toughness": "3",
                                "oracleText": "Zombies you control get +1/+0.\nAt the beginning of your end step, if a creature died this turn, you may pay {1}{B}. If you do, create a 2/2 black Zombie creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Lord of the Accursed",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie",
                                "power": "2",
                                "toughness": "3",
                                "oracleText": "Other Zombies you control get +1/+1.\n{1}{B}, {T}: All Zombies gain menace until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Spark Reaper",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie",
                                "power": "2",
                                "toughness": "3",
                                "oracleText": "{3}, Sacrifice a creature or planeswalker: You gain 1 life and draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Undead Augur",
                                "quantity": 1,
                                "manaCost": "{B}{B}",
                                "cmc": 2,
                                "typeLine": "Creature — Zombie Wizard",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Whenever this creature or another Zombie you control dies, you draw a card and lose 1 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Diregraf Captain",
                                "quantity": 1,
                                "manaCost": "{1}{U}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie Soldier",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Deathtouch\nOther Zombie creatures you control get +1/+1.\nWhenever another Zombie you control dies, target opponent loses 1 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Gleaming Overseer",
                                "quantity": 1,
                                "manaCost": "{1}{U}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie Wizard",
                                "power": "1",
                                "toughness": "4",
                                "oracleText": "When this creature enters, amass Zombies 1. (Put a +1/+1 counter on an Army you control. It's also a Zombie. If you don't control an Army, create a 0/0 black Zombie Army creature token first.)\nZombie tokens you control have hexproof and menace.",
                                "isCommander": false
                        },
                        {
                                "name": "Ruthless Deathfang",
                                "quantity": 1,
                                "manaCost": "{4}{U}{B}",
                                "cmc": 6,
                                "typeLine": "Creature — Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhenever you sacrifice a creature, target opponent sacrifices a creature of their choice.",
                                "isCommander": false
                        },
                        {
                                "name": "Hour of Eternity",
                                "quantity": 1,
                                "manaCost": "{X}{X}{U}{U}{U}",
                                "cmc": 3,
                                "typeLine": "Sorcery",
                                "oracleText": "Exile X target creature cards from your graveyard. For each card exiled this way, create a token that's a copy of that card, except it's a 4/4 black Zombie.",
                                "isCommander": false
                        },
                        {
                                "name": "Army of the Damned",
                                "quantity": 1,
                                "manaCost": "{5}{B}{B}{B}",
                                "cmc": 8,
                                "typeLine": "Sorcery",
                                "oracleText": "Create thirteen tapped 2/2 black Zombie creature tokens.\nFlashback {7}{B}{B}{B} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
                                "isCommander": false
                        },
                        {
                                "name": "Dark Salvation",
                                "quantity": 1,
                                "manaCost": "{X}{X}{B}",
                                "cmc": 1,
                                "typeLine": "Sorcery",
                                "oracleText": "Target player creates X 2/2 black Zombie creature tokens, then up to one target creature gets -1/-1 until end of turn for each Zombie that player controls.",
                                "isCommander": false
                        },
                        {
                                "name": "Dread Summons",
                                "quantity": 1,
                                "manaCost": "{X}{B}{B}",
                                "cmc": 2,
                                "typeLine": "Sorcery",
                                "oracleText": "Each player mills X cards. For each creature card put into a graveyard this way, you create a tapped 2/2 black Zombie creature token. (To mill a card, a player puts the top card of their library into their graveyard.)",
                                "isCommander": false
                        },
                        {
                                "name": "Zombie Apocalypse",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}{B}",
                                "cmc": 6,
                                "typeLine": "Sorcery",
                                "oracleText": "Return all Zombie creature cards from your graveyard to the battlefield tapped, then destroy all Humans.",
                                "isCommander": false
                        },
                        {
                                "name": "Distant Melody",
                                "quantity": 1,
                                "manaCost": "{3}{U}",
                                "cmc": 4,
                                "typeLine": "Sorcery",
                                "oracleText": "Choose a creature type. Draw a card for each permanent you control of that type.",
                                "isCommander": false
                        },
                        {
                                "name": "Feed the Swarm",
                                "quantity": 1,
                                "manaCost": "{1}{B}",
                                "cmc": 2,
                                "typeLine": "Sorcery",
                                "oracleText": "Destroy target creature or enchantment an opponent controls. You lose life equal to that permanent's mana value.",
                                "isCommander": false
                        },
                        {
                                "name": "Syphon Flesh",
                                "quantity": 1,
                                "manaCost": "{4}{B}",
                                "cmc": 5,
                                "typeLine": "Sorcery",
                                "oracleText": "Each other player sacrifices a creature of their choice. You create a 2/2 black Zombie creature token for each creature sacrificed this way.",
                                "isCommander": false
                        },
                        {
                                "name": "Aetherspouts",
                                "quantity": 1,
                                "manaCost": "{3}{U}{U}",
                                "cmc": 5,
                                "typeLine": "Instant",
                                "oracleText": "For each attacking creature, its owner puts it on their choice of the top or bottom of their library.",
                                "isCommander": false
                        },
                        {
                                "name": "Go for the Throat",
                                "quantity": 1,
                                "manaCost": "{1}{B}",
                                "cmc": 2,
                                "typeLine": "Instant",
                                "oracleText": "Destroy target nonartifact creature.",
                                "isCommander": false
                        },
                        {
                                "name": "Arcane Signet",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.",
                                "isCommander": false
                        },
                        {
                                "name": "Charcoal Diamond",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "This artifact enters tapped.\n{T}: Add {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Commander's Sphere",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.\nSacrifice this artifact: Draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Sky Diamond",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "This artifact enters tapped.\n{T}: Add {U}.",
                                "isCommander": false
                        },
                        {
                                "name": "Sol Ring",
                                "quantity": 1,
                                "manaCost": "{1}",
                                "cmc": 1,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}{C}.",
                                "isCommander": false
                        },
                        {
                                "name": "Talisman of Dominance",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}.\n{T}: Add {U} or {B}. This artifact deals 1 damage to you.",
                                "isCommander": false
                        },
                        {
                                "name": "Rooftop Storm",
                                "quantity": 1,
                                "manaCost": "{5}{U}",
                                "cmc": 6,
                                "typeLine": "Enchantment",
                                "oracleText": "You may pay {0} rather than pay the mana cost for Zombie creature spells you cast.",
                                "isCommander": false
                        },
                        {
                                "name": "Dreadhorde Invasion",
                                "quantity": 1,
                                "manaCost": "{1}{B}",
                                "cmc": 2,
                                "typeLine": "Enchantment",
                                "oracleText": "At the beginning of your upkeep, you lose 1 life and amass Zombies 1. (Put a +1/+1 counter on an Army you control. It's also a Zombie. If you don't control an Army, create a 0/0 black Zombie Army creature token first.)\nWhenever a Zombie token you control with power 6 or greater attacks, it gains lifelink until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Endless Ranks of the Dead",
                                "quantity": 1,
                                "manaCost": "{2}{B}{B}",
                                "cmc": 4,
                                "typeLine": "Enchantment",
                                "oracleText": "At the beginning of your upkeep, create X 2/2 black Zombie creature tokens, where X is half the number of Zombies you control, rounded down.",
                                "isCommander": false
                        },
                        {
                                "name": "Liliana's Mastery",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Enchantment",
                                "oracleText": "Zombies you control get +1/+1.\nWhen this enchantment enters, create two 2/2 black Zombie creature tokens.",
                                "isCommander": false
                        },
                        {
                                "name": "Open the Graves",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Enchantment",
                                "oracleText": "Whenever a nontoken creature you control dies, create a 2/2 black Zombie creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Choked Estuary",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "As this land enters, you may reveal an Island or Swamp card from your hand. If you don't, this land enters tapped.\n{T}: Add {U} or {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Darkwater Catacombs",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{1}, {T}: Add {U}{B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Exotic Orchard",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add one mana of any color that a land an opponent controls could produce.",
                                "isCommander": false
                        },
                        {
                                "name": "Sunken Hollow",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land — Island Swamp",
                                "oracleText": "({T}: Add {U} or {B}.)\nThis land enters tapped unless you control two or more basic lands.",
                                "isCommander": false
                        },
                        {
                                "name": "Temple of Deceit",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, scry 1. (Look at the top card of your library. You may put that card on the bottom.)\n{T}: Add {U} or {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Bojuka Bog",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, exile target player's graveyard.\n{T}: Add {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Command Tower",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.",
                                "isCommander": false
                        },
                        {
                                "name": "Dimir Aqueduct",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, return a land you control to its owner's hand.\n{T}: Add {U}{B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Mortuary Mire",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, you may put target creature card from your graveyard on top of your library.\n{T}: Add {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Myriad Landscape",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {C}.\n{2}, {T}, Sacrifice this land: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Path of Ancestry",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1. (Look at the top card of your library. You may put that card on the bottom.)",
                                "isCommander": false
                        },
                        {
                                "name": "Tainted Isle",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add {C}.\n{T}: Add {U} or {B}. Activate only if you control a Swamp.",
                                "isCommander": false
                        },
                        {
                                "name": "Unclaimed Territory",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type.",
                                "isCommander": false
                        },
                        {
                                "name": "Island",
                                "quantity": 12,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Island",
                                "oracleText": "({T}: Add {U}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 15,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Eloise, Nephalia Sleuth",
                                "quantity": 1,
                                "manaCost": "{3}{U}{B}",
                                "cmc": 5,
                                "typeLine": "Legendary Creature — Human Rogue",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Whenever another creature you control dies, investigate. (Create a Clue token. It's an artifact with \"{2}, Sacrifice this token: Draw a card.\")\nWhenever you sacrifice a token, surveil 1. (Look at the top card of your library. You may put that card into your graveyard.)",
                                "isCommander": false
                        },
                        {
                                "name": "Cleaver Skaab",
                                "quantity": 1,
                                "manaCost": "{3}{U}",
                                "cmc": 4,
                                "typeLine": "Creature — Zombie Horror",
                                "power": "2",
                                "toughness": "4",
                                "oracleText": "{3}, {T}, Sacrifice another Zombie: Create two tokens that are copies of the sacrificed creature.",
                                "isCommander": false
                        },
                        {
                                "name": "Curse of Unbinding",
                                "quantity": 1,
                                "manaCost": "{6}{U}",
                                "cmc": 7,
                                "typeLine": "Enchantment — Aura Curse",
                                "oracleText": "Enchant player\nAt the beginning of enchanted player's upkeep, that player reveals cards from the top of their library until they reveal a creature card. Put that card onto the battlefield under your control. That player puts the rest of the revealed cards into their graveyard.",
                                "isCommander": false
                        },
                        {
                                "name": "Drown in Dreams",
                                "quantity": 1,
                                "manaCost": "{X}{2}{U}",
                                "cmc": 3,
                                "typeLine": "Instant",
                                "oracleText": "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Target player draws X cards.\n• Target player mills twice X cards.",
                                "isCommander": false
                        },
                        {
                                "name": "Empty the Laboratory",
                                "quantity": 1,
                                "manaCost": "{X}{U}{U}",
                                "cmc": 2,
                                "typeLine": "Sorcery",
                                "oracleText": "Sacrifice X Zombies, then reveal cards from the top of your library until you reveal a number of Zombie creature cards equal to the number of Zombies sacrificed this way. Put those cards onto the battlefield and the rest on the bottom of your library in a random order.",
                                "isCommander": false
                        },
                        {
                                "name": "Hordewing Skaab",
                                "quantity": 1,
                                "manaCost": "{4}{U}",
                                "cmc": 5,
                                "typeLine": "Creature — Zombie Horror",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Flying\nOther Zombies you control have flying.\nWhenever one or more Zombies you control deal combat damage to one or more of your opponents, you may draw cards equal to the number of opponents dealt damage this way. If you do, discard that many cards.",
                                "isCommander": false
                        },
                        {
                                "name": "Shadow Kin",
                                "quantity": 1,
                                "manaCost": "{3}{U}",
                                "cmc": 4,
                                "typeLine": "Creature — Shapeshifter",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Flash\nAt the beginning of your upkeep, each player mills three cards. You may exile a creature card from among the cards milled this way. If you do, this creature becomes a copy of that card, except it has this ability.",
                                "isCommander": false
                        },
                        {
                                "name": "Crowded Crypt",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {B}.\nWhenever a creature you control dies, put a corpse counter on this artifact.\n{4}{B}{B}, {T}, Sacrifice this artifact: Create a 2/2 black Zombie creature token with decayed for each corpse counter on this artifact. (A creature with decayed can't block. When it attacks, sacrifice it at end of combat.)",
                                "isCommander": false
                        },
                        {
                                "name": "Curse of the Restless Dead",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Enchantment — Aura Curse",
                                "oracleText": "Enchant player\nWhenever a land enchanted player controls enters, you create a 2/2 black Zombie creature token with decayed. (It can't block. When it attacks, sacrifice it at end of combat.)",
                                "isCommander": false
                        },
                        {
                                "name": "Ghouls' Night Out",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Sorcery",
                                "oracleText": "For each player, choose a creature card in that player's graveyard. Put those cards onto the battlefield under your control. They're black Zombies in addition to their other colors and types and they gain decayed. (A creature with decayed can't block. When it attacks, sacrifice it at end of combat.)",
                                "isCommander": false
                        },
                        {
                                "name": "Gorex, the Tombshell",
                                "quantity": 1,
                                "manaCost": "{6}{B}{B}",
                                "cmc": 8,
                                "typeLine": "Legendary Creature — Zombie Turtle",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "As an additional cost to cast this spell, you may exile any number of creature cards from your graveyard. This spell costs {2} less to cast for each card exiled this way.\nDeathtouch\nWhenever Gorex attacks or dies, choose a card at random exiled with Gorex and put that card into its owner's hand.",
                                "isCommander": false
                        },
                        {
                                "name": "Prowling Geistcatcher",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Creature — Human Rogue",
                                "power": "2",
                                "toughness": "4",
                                "oracleText": "Whenever you sacrifice another creature, exile it. If that creature was a token, put a +1/+1 counter on this creature.\nWhen this creature leaves the battlefield, return each card exiled with it to the battlefield under your control.",
                                "isCommander": false
                        },
                        {
                                "name": "Ravenous Rotbelly",
                                "quantity": 1,
                                "manaCost": "{4}{B}",
                                "cmc": 5,
                                "typeLine": "Creature — Zombie Horror",
                                "power": "4",
                                "toughness": "5",
                                "oracleText": "When this creature enters, you may sacrifice up to three Zombies. When you sacrifice one or more Zombies this way, each opponent sacrifices that many creatures of their choice.",
                                "isCommander": false
                        },
                        {
                                "name": "Tomb Tyrant",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Creature — Zombie Noble",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Other Zombies you control get +1/+1.\n{2}{B}, {T}, Sacrifice a creature: Return a Zombie creature card at random from your graveyard to the battlefield. Activate only during your turn and only if there are at least three Zombie creature cards in your graveyard.",
                                "isCommander": false
                        }
                ]
        },
        {
                "id": "preset_lathril",
                "name": "Lathril, Blade of the Elves (Elfball)",
                "commander": "Lathril, Blade of the Elves",
                "cards": [
                        {
                                "name": "Lathril, Blade of the Elves",
                                "quantity": 1,
                                "manaCost": "{2}{B}{G}",
                                "cmc": 4,
                                "typeLine": "Legendary Creature — Elf Noble",
                                "power": "2",
                                "toughness": "3",
                                "oracleText": "Menace (This creature can't be blocked except by two or more creatures.)\nWhenever Lathril deals combat damage to a player, create that many 1/1 green Elf Warrior creature tokens.\n{T}, Tap ten untapped Elves you control: Each opponent loses 10 life and you gain 10 life.",
                                "isCommander": true
                        },
                        {
                                "name": "Abomination of Llanowar",
                                "quantity": 1,
                                "manaCost": "{1}{B}{G}",
                                "cmc": 3,
                                "typeLine": "Legendary Creature — Elf Horror",
                                "power": "*",
                                "toughness": "*",
                                "oracleText": "Vigilance; menace (This creature can't be blocked except by two or more creatures.)\nAbomination of Llanowar's power and toughness are each equal to the number of Elves you control plus the number of Elf cards in your graveyard.",
                                "isCommander": false
                        },
                        {
                                "name": "Beast Whisperer",
                                "quantity": 1,
                                "manaCost": "{2}{G}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Druid",
                                "power": "2",
                                "toughness": "3",
                                "oracleText": "Whenever you cast a creature spell, draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Canopy Tactician",
                                "quantity": 1,
                                "manaCost": "{3}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Warrior",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Other Elves you control get +1/+1.\n{T}: Add {G}{G}{G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Cultivator of Blades",
                                "quantity": 1,
                                "manaCost": "{3}{G}{G}",
                                "cmc": 5,
                                "typeLine": "Creature — Elf Artificer",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "Fabricate 2 (When this creature enters, put two +1/+1 counters on it or create two 1/1 colorless Servo artifact creature tokens.)\nWhenever this creature attacks, you may have other attacking creatures get +X/+X until end of turn, where X is this creature's power.",
                                "isCommander": false
                        },
                        {
                                "name": "Dwynen, Gilt-Leaf Daen",
                                "quantity": 1,
                                "manaCost": "{2}{G}{G}",
                                "cmc": 4,
                                "typeLine": "Legendary Creature — Elf Warrior",
                                "power": "3",
                                "toughness": "4",
                                "oracleText": "Reach (This creature can block creatures with flying.)\nOther Elf creatures you control get +1/+1.\nWhenever Dwynen attacks, you gain 1 life for each attacking Elf you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Elderfang Ritualist",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Cleric",
                                "power": "3",
                                "toughness": "1",
                                "oracleText": "When this creature dies, return another target Elf card from your graveyard to your hand.",
                                "isCommander": false
                        },
                        {
                                "name": "Elvish Archdruid",
                                "quantity": 1,
                                "manaCost": "{1}{G}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Druid",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Other Elf creatures you control get +1/+1.\n{T}: Add {G} for each Elf you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Elvish Mystic",
                                "quantity": 1,
                                "manaCost": "{G}",
                                "cmc": 1,
                                "typeLine": "Creature — Elf Druid",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "{T}: Add {G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Elvish Rejuvenator",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Druid",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "When this creature enters, look at the top five cards of your library. You may put a land card from among them onto the battlefield tapped. Put the rest on the bottom of your library in a random order.",
                                "isCommander": false
                        },
                        {
                                "name": "End-Raze Forerunners",
                                "quantity": 1,
                                "manaCost": "{5}{G}{G}{G}",
                                "cmc": 8,
                                "typeLine": "Creature — Boar",
                                "power": "7",
                                "toughness": "7",
                                "oracleText": "Vigilance, trample, haste\nWhen this creature enters, other creatures you control get +2/+2 and gain vigilance and trample until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Eyeblight Cullers",
                                "quantity": 1,
                                "manaCost": "{4}{B}",
                                "cmc": 5,
                                "typeLine": "Creature — Elf Warrior",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "When this creature dies, create three 1/1 green Elf Warrior creature tokens, then mill three cards. (Put the top three cards of your library into your graveyard.)",
                                "isCommander": false
                        },
                        {
                                "name": "Farhaven Elf",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Druid",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "When this creature enters, you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Golgari Findbroker",
                                "quantity": 1,
                                "manaCost": "{B}{B}{G}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Shaman",
                                "power": "3",
                                "toughness": "4",
                                "oracleText": "When this creature enters, return target permanent card from your graveyard to your hand.",
                                "isCommander": false
                        },
                        {
                                "name": "Harald, King of Skemfar",
                                "quantity": 1,
                                "manaCost": "{1}{B}{G}",
                                "cmc": 3,
                                "typeLine": "Legendary Creature — Elf Warrior",
                                "power": "3",
                                "toughness": "2",
                                "oracleText": "Menace (This creature can't be blocked except by two or more creatures.)\nWhen Harald enters, look at the top five cards of your library. You may reveal an Elf, Warrior, or Tyvar card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
                                "isCommander": false
                        },
                        {
                                "name": "Imperious Perfect",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Warrior",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Other Elves you control get +1/+1.\n{G}, {T}: Create a 1/1 green Elf Warrior creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Jagged-Scar Archers",
                                "quantity": 1,
                                "manaCost": "{1}{G}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Archer",
                                "power": "*",
                                "toughness": "*",
                                "oracleText": "Jagged-Scar Archers's power and toughness are each equal to the number of Elves you control.\n{T}: This creature deals damage equal to its power to target creature with flying.",
                                "isCommander": false
                        },
                        {
                                "name": "Jaspera Sentinel",
                                "quantity": 1,
                                "manaCost": "{G}",
                                "cmc": 1,
                                "typeLine": "Creature — Elf Rogue",
                                "power": "1",
                                "toughness": "2",
                                "oracleText": "Reach\n{T}, Tap an untapped creature you control: Add one mana of any color.",
                                "isCommander": false
                        },
                        {
                                "name": "Llanowar Tribe",
                                "quantity": 1,
                                "manaCost": "{G}{G}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Druid",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "{T}: Add {G}{G}{G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Lys Alana Huntmaster",
                                "quantity": 1,
                                "manaCost": "{2}{G}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Warrior",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Whenever you cast an Elf spell, you may create a 1/1 green Elf Warrior creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Lys Alana Scarblade",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Assassin",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "{T}, Discard an Elf card: Target creature gets -X/-X until end of turn, where X is the number of Elves you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Marwyn, the Nurturer",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Legendary Creature — Elf Druid",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "Whenever another Elf you control enters, put a +1/+1 counter on Marwyn.\n{T}: Add an amount of {G} equal to Marwyn's power.",
                                "isCommander": false
                        },
                        {
                                "name": "Masked Admirers",
                                "quantity": 1,
                                "manaCost": "{2}{G}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Shaman",
                                "power": "3",
                                "toughness": "2",
                                "oracleText": "When this creature enters, draw a card.\nWhenever you cast a creature spell, you may pay {G}{G}. If you do, return this card from your graveyard to your hand.",
                                "isCommander": false
                        },
                        {
                                "name": "Miara, Thorn of the Glade",
                                "quantity": 1,
                                "manaCost": "{1}{B}",
                                "cmc": 2,
                                "typeLine": "Legendary Creature — Elf Scout",
                                "power": "1",
                                "toughness": "2",
                                "oracleText": "Whenever Miara or another Elf you control dies, you may pay {1} and 1 life. If you do, draw a card.\nPartner (You can have two commanders if both have partner.)",
                                "isCommander": false
                        },
                        {
                                "name": "Nullmage Shepherd",
                                "quantity": 1,
                                "manaCost": "{3}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Shaman",
                                "power": "2",
                                "toughness": "4",
                                "oracleText": "Tap four untapped creatures you control: Destroy target artifact or enchantment.",
                                "isCommander": false
                        },
                        {
                                "name": "Numa, Joraga Chieftain",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Legendary Creature — Elf Warrior",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "At the beginning of combat on your turn, you may pay {X}{X}. When you do, distribute X +1/+1 counters among any number of target Elves.\nPartner (You can have two commanders if both have partner.)",
                                "isCommander": false
                        },
                        {
                                "name": "Poison-Tip Archer",
                                "quantity": 1,
                                "manaCost": "{2}{B}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Archer",
                                "power": "2",
                                "toughness": "3",
                                "oracleText": "Reach (This creature can block creatures with flying.)\nDeathtouch (Any amount of damage this deals to a creature is enough to destroy it.)\nWhenever another creature dies, each opponent loses 1 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Reclamation Sage",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Shaman",
                                "power": "2",
                                "toughness": "1",
                                "oracleText": "When this creature enters, you may destroy target artifact or enchantment.",
                                "isCommander": false
                        },
                        {
                                "name": "Rhys the Exiled",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Legendary Creature — Elf Warrior",
                                "power": "3",
                                "toughness": "2",
                                "oracleText": "Whenever Rhys attacks, you gain 1 life for each Elf you control.\n{B}, Sacrifice an Elf: Regenerate Rhys.",
                                "isCommander": false
                        },
                        {
                                "name": "Ruthless Winnower",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Creature — Elf Rogue",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "At the beginning of each player's upkeep, that player sacrifices a non-Elf creature of their choice.",
                                "isCommander": false
                        },
                        {
                                "name": "Shaman of the Pack",
                                "quantity": 1,
                                "manaCost": "{1}{B}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Shaman",
                                "power": "3",
                                "toughness": "2",
                                "oracleText": "When this creature enters, target opponent loses life equal to the number of Elves you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Skemfar Shadowsage",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Cleric",
                                "power": "2",
                                "toughness": "5",
                                "oracleText": "When this creature enters, choose one —\n• Each opponent loses X life, where X is the greatest number of creatures you control that have a creature type in common.\n• You gain X life, where X is the greatest number of creatures you control that have a creature type in common.",
                                "isCommander": false
                        },
                        {
                                "name": "Springbloom Druid",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Druid",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "When this creature enters, you may sacrifice a land. If you do, search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Sylvan Messenger",
                                "quantity": 1,
                                "manaCost": "{3}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)\nWhen this creature enters, reveal the top four cards of your library. Put all Elf cards revealed this way into your hand and the rest on the bottom of your library in any order.",
                                "isCommander": false
                        },
                        {
                                "name": "Timberwatch Elf",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf",
                                "power": "1",
                                "toughness": "2",
                                "oracleText": "{T}: Target creature gets +X/+X until end of turn, where X is the number of Elves on the battlefield.",
                                "isCommander": false
                        },
                        {
                                "name": "Twinblade Assassins",
                                "quantity": 1,
                                "manaCost": "{3}{B}{G}",
                                "cmc": 5,
                                "typeLine": "Creature — Elf Assassin",
                                "power": "5",
                                "toughness": "4",
                                "oracleText": "At the beginning of your end step, if a creature died this turn, draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Voice of Many",
                                "quantity": 1,
                                "manaCost": "{2}{G}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Druid",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "When this creature enters, draw a card for each opponent who controls fewer creatures than you.",
                                "isCommander": false
                        },
                        {
                                "name": "Voice of the Woods",
                                "quantity": 1,
                                "manaCost": "{3}{G}{G}",
                                "cmc": 5,
                                "typeLine": "Creature — Elf",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Tap five untapped Elves you control: Create a 7/7 green Elemental creature token with trample. (It can deal excess combat damage to the player or planeswalker it's attacking.)",
                                "isCommander": false
                        },
                        {
                                "name": "Wirewood Channeler",
                                "quantity": 1,
                                "manaCost": "{3}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Druid",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "{T}: Add X mana of any one color, where X is the number of Elves on the battlefield.",
                                "isCommander": false
                        },
                        {
                                "name": "Wolverine Riders",
                                "quantity": 1,
                                "manaCost": "{4}{G}{G}",
                                "cmc": 6,
                                "typeLine": "Creature — Elf Warrior",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "At the beginning of each upkeep, create a 1/1 green Elf Warrior creature token.\nWhenever another Elf you control enters, you gain life equal to its toughness.",
                                "isCommander": false
                        },
                        {
                                "name": "Wood Elves",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Scout",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "When this creature enters, search your library for a Forest card, put that card onto the battlefield, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Elven Ambush",
                                "quantity": 1,
                                "manaCost": "{3}{G}",
                                "cmc": 4,
                                "typeLine": "Instant",
                                "oracleText": "Create a 1/1 green Elf Warrior creature token for each Elf you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Poison the Cup",
                                "quantity": 1,
                                "manaCost": "{1}{B}{B}",
                                "cmc": 3,
                                "typeLine": "Instant",
                                "oracleText": "Destroy target creature. If this spell was foretold, scry 2.\nForetell {1}{B} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)",
                                "isCommander": false
                        },
                        {
                                "name": "Putrefy",
                                "quantity": 1,
                                "manaCost": "{1}{B}{G}",
                                "cmc": 3,
                                "typeLine": "Instant",
                                "oracleText": "Destroy target artifact or creature. It can't be regenerated.",
                                "isCommander": false
                        },
                        {
                                "name": "Tergrid's Shadow",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Instant",
                                "oracleText": "Each player sacrifices two creatures.\nForetell {2}{B}{B} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)",
                                "isCommander": false
                        },
                        {
                                "name": "Ambition's Cost",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Sorcery",
                                "oracleText": "You draw three cards and lose 3 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Bounty of Skemfar",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Sorcery",
                                "oracleText": "Reveal the top six cards of your library. You may put up to one land card from among them onto the battlefield tapped and up to one Elf card from among them into your hand. Put the rest on the bottom of your library in a random order.",
                                "isCommander": false
                        },
                        {
                                "name": "Casualties of War",
                                "quantity": 1,
                                "manaCost": "{2}{B}{B}{G}{G}",
                                "cmc": 6,
                                "typeLine": "Sorcery",
                                "oracleText": "Choose one or more —\n• Destroy target artifact.\n• Destroy target creature.\n• Destroy target enchantment.\n• Destroy target land.\n• Destroy target planeswalker.",
                                "isCommander": false
                        },
                        {
                                "name": "Eyeblight Massacre",
                                "quantity": 1,
                                "manaCost": "{2}{B}{B}",
                                "cmc": 4,
                                "typeLine": "Sorcery",
                                "oracleText": "Non-Elf creatures get -2/-2 until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Elvish Promenade",
                                "quantity": 1,
                                "manaCost": "{3}{G}",
                                "cmc": 4,
                                "typeLine": "Kindred Sorcery — Elf",
                                "oracleText": "Create a 1/1 green Elf Warrior creature token for each Elf you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Harvest Season",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Sorcery",
                                "oracleText": "Search your library for up to X basic land cards, where X is the number of tapped creatures you control, put those cards onto the battlefield tapped, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Pact of the Serpent",
                                "quantity": 1,
                                "manaCost": "{1}{B}{B}",
                                "cmc": 3,
                                "typeLine": "Sorcery",
                                "oracleText": "Choose a creature type. Target player draws X cards and loses X life, where X is the number of creatures they control of the chosen type.",
                                "isCommander": false
                        },
                        {
                                "name": "Return Upon the Tide",
                                "quantity": 1,
                                "manaCost": "{4}{B}",
                                "cmc": 5,
                                "typeLine": "Sorcery",
                                "oracleText": "Return target creature card from your graveyard to the battlefield. If it's an Elf, create two 1/1 green Elf Warrior creature tokens.\nForetell {3}{B} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)",
                                "isCommander": false
                        },
                        {
                                "name": "Roots of Wisdom",
                                "quantity": 1,
                                "manaCost": "{1}{G}",
                                "cmc": 2,
                                "typeLine": "Sorcery",
                                "oracleText": "Mill three cards, then return a land card or Elf card from your graveyard to your hand. If you can't, draw a card. (To mill a card, put the top card of your library into your graveyard.)",
                                "isCommander": false
                        },
                        {
                                "name": "Arcane Signet",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.",
                                "isCommander": false
                        },
                        {
                                "name": "Serpent's Soul-Jar",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "Whenever an Elf you control dies, exile it.\n{T}, Pay 2 life: Until end of turn, you may cast a creature spell from among cards exiled with this artifact.",
                                "isCommander": false
                        },
                        {
                                "name": "Sol Ring",
                                "quantity": 1,
                                "manaCost": "{1}",
                                "cmc": 1,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}{C}.",
                                "isCommander": false
                        },
                        {
                                "name": "Binding the Old Gods",
                                "quantity": 1,
                                "manaCost": "{2}{B}{G}",
                                "cmc": 4,
                                "typeLine": "Enchantment — Saga",
                                "oracleText": "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — Destroy target nonland permanent an opponent controls.\nII — Search your library for a Forest card, put it onto the battlefield tapped, then shuffle.\nIII — Creatures you control gain deathtouch until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Crown of Skemfar",
                                "quantity": 1,
                                "manaCost": "{2}{G}{G}",
                                "cmc": 4,
                                "typeLine": "Enchantment — Aura",
                                "oracleText": "Enchant creature\nEnchanted creature gets +1/+1 for each Elf you control and has reach.\n{2}{G}: Return this card from your graveyard to your hand.",
                                "isCommander": false
                        },
                        {
                                "name": "Elderfang Venom",
                                "quantity": 1,
                                "manaCost": "{2}{B}{G}",
                                "cmc": 4,
                                "typeLine": "Enchantment",
                                "oracleText": "Attacking Elves you control have deathtouch.\nWhenever an Elf you control dies, each opponent loses 1 life and you gain 1 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Pride of the Perfect",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Enchantment",
                                "oracleText": "Elves you control get +2/+0.",
                                "isCommander": false
                        },
                        {
                                "name": "Prowess of the Fair",
                                "quantity": 1,
                                "manaCost": "{1}{B}",
                                "cmc": 2,
                                "typeLine": "Kindred Enchantment — Elf",
                                "oracleText": "Whenever another nontoken Elf is put into your graveyard from the battlefield, you may create a 1/1 green Elf Warrior creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Moldervine Reclamation",
                                "quantity": 1,
                                "manaCost": "{3}{B}{G}",
                                "cmc": 5,
                                "typeLine": "Enchantment",
                                "oracleText": "Whenever a creature you control dies, you gain 1 life and draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Command Tower",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.",
                                "isCommander": false
                        },
                        {
                                "name": "Forest",
                                "quantity": 16,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Forest",
                                "oracleText": "({T}: Add {G}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Foul Orchard",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {B} or {G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Golgari Guildgate",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land — Gate",
                                "oracleText": "This land enters tapped.\n{T}: Add {B} or {G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Golgari Rot Farm",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, return a land you control to its owner's hand.\n{T}: Add {B}{G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Jungle Hollow",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, you gain 1 life.\n{T}: Add {B} or {G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Myriad Landscape",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {C}.\n{2}, {T}, Sacrifice this land: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Path of Ancestry",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1. (Look at the top card of your library. You may put that card on the bottom.)",
                                "isCommander": false
                        },
                        {
                                "name": "Skemfar Elderhall",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {G}.\n{2}{B}{B}{G}, {T}, Sacrifice this land: Up to one target creature you don't control gets -2/-2 until end of turn. Create two 1/1 green Elf Warrior creature tokens. Activate only as a sorcery.",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 13,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        }
                ]
        },
        {
                "id": "preset_urdragon",
                "name": "The Ur-Dragon (Draconic Domination)",
                "commander": "The Ur-Dragon",
                "cards": [
                        {
                                "name": "The Ur-Dragon",
                                "quantity": 1,
                                "manaCost": "{4}{W}{U}{B}{R}{G}",
                                "cmc": 9,
                                "typeLine": "Legendary Creature — Dragon Avatar",
                                "power": "10",
                                "toughness": "10",
                                "oracleText": "Eminence — As long as The Ur-Dragon is in the command zone or on the battlefield, other Dragon spells you cast cost {1} less to cast.\nFlying\nWhenever one or more Dragons you control attack, draw that many cards, then you may put a permanent card from your hand onto the battlefield.",
                                "isCommander": true
                        },
                        {
                                "name": "O-Kagachi, Vengeful Kami",
                                "quantity": 1,
                                "manaCost": "{1}{W}{U}{B}{R}{G}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Dragon Spirit",
                                "power": "6",
                                "toughness": "6",
                                "oracleText": "Flying, trample\nWhenever O-Kagachi deals combat damage to a player, if that player attacked you during their last turn, exile target nonland permanent that player controls.",
                                "isCommander": false
                        },
                        {
                                "name": "Ramos, Dragon Engine",
                                "quantity": 1,
                                "manaCost": "{6}",
                                "cmc": 6,
                                "typeLine": "Legendary Artifact Creature — Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhenever you cast a spell, put a +1/+1 counter on Ramos for each of that spell's colors.\nRemove five +1/+1 counters from Ramos: Add {W}{W}{U}{U}{B}{B}{R}{R}{G}{G}. Activate only once each turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Scalelord Reckoner",
                                "quantity": 1,
                                "manaCost": "{3}{W}{W}",
                                "cmc": 5,
                                "typeLine": "Creature — Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhenever a Dragon you control becomes the target of a spell or ability an opponent controls, destroy target nonland permanent that player controls.",
                                "isCommander": false
                        },
                        {
                                "name": "Boneyard Scourge",
                                "quantity": 1,
                                "manaCost": "{2}{B}{B}",
                                "cmc": 4,
                                "typeLine": "Creature — Zombie Dragon",
                                "power": "4",
                                "toughness": "3",
                                "oracleText": "Flying\nWhenever a Dragon you control dies while this card is in your graveyard, you may pay {1}{B}. If you do, return this card from your graveyard to the battlefield.",
                                "isCommander": false
                        },
                        {
                                "name": "Territorial Hellkite",
                                "quantity": 1,
                                "manaCost": "{2}{R}{R}",
                                "cmc": 4,
                                "typeLine": "Creature — Dragon",
                                "power": "6",
                                "toughness": "5",
                                "oracleText": "Flying, haste\nAt the beginning of combat on your turn, choose an opponent at random that this creature didn't attack during your last combat. This creature attacks that player this combat if able. If you can't choose an opponent this way, tap this creature.",
                                "isCommander": false
                        },
                        {
                                "name": "Taigam, Ojutai Master",
                                "quantity": 1,
                                "manaCost": "{2}{W}{U}",
                                "cmc": 4,
                                "typeLine": "Legendary Creature — Human Monk",
                                "power": "3",
                                "toughness": "4",
                                "oracleText": "Instant, sorcery, and Dragon spells you control can't be countered.\nWhenever you cast an instant or sorcery spell from your hand, if Taigam attacked this turn, that spell gains rebound. (Exile the spell as it resolves. At the beginning of your next upkeep, you may cast that card from exile without paying its mana cost.)",
                                "isCommander": false
                        },
                        {
                                "name": "Wasitora, Nekoru Queen",
                                "quantity": 1,
                                "manaCost": "{2}{B}{R}{G}",
                                "cmc": 5,
                                "typeLine": "Legendary Creature — Cat Dragon",
                                "power": "5",
                                "toughness": "4",
                                "oracleText": "Flying, trample\nWhenever Wasitora deals combat damage to a player, that player sacrifices a creature of their choice. If the player can't, you create a 3/3 black, red, and green Cat Dragon creature token with flying.",
                                "isCommander": false
                        },
                        {
                                "name": "Ryusei, the Falling Star",
                                "quantity": 1,
                                "manaCost": "{5}{R}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Dragon Spirit",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Flying\nWhen Ryusei dies, it deals 5 damage to each creature without flying.",
                                "isCommander": false
                        },
                        {
                                "name": "Scourge of Valkas",
                                "quantity": 1,
                                "manaCost": "{2}{R}{R}{R}",
                                "cmc": 5,
                                "typeLine": "Creature — Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhenever this creature or another Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.\n{R}: This creature gets +1/+0 until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Utvara Hellkite",
                                "quantity": 1,
                                "manaCost": "{6}{R}{R}",
                                "cmc": 8,
                                "typeLine": "Creature — Dragon",
                                "power": "6",
                                "toughness": "6",
                                "oracleText": "Flying\nWhenever a Dragon you control attacks, create a 6/6 red Dragon creature token with flying.",
                                "isCommander": false
                        },
                        {
                                "name": "Sunscorch Regent",
                                "quantity": 1,
                                "manaCost": "{3}{W}{W}",
                                "cmc": 5,
                                "typeLine": "Creature — Dragon",
                                "power": "4",
                                "toughness": "3",
                                "oracleText": "Flying\nWhenever an opponent casts a spell, put a +1/+1 counter on this creature and you gain 1 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Deathbringer Regent",
                                "quantity": 1,
                                "manaCost": "{5}{B}{B}",
                                "cmc": 7,
                                "typeLine": "Creature — Dragon",
                                "power": "5",
                                "toughness": "6",
                                "oracleText": "Flying\nWhen this creature enters, if you cast it from your hand and there are five or more other creatures on the battlefield, destroy all other creatures.",
                                "isCommander": false
                        },
                        {
                                "name": "Hellkite Charger",
                                "quantity": 1,
                                "manaCost": "{4}{R}{R}",
                                "cmc": 6,
                                "typeLine": "Creature — Dragon",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Flying, haste\nWhenever this creature attacks, you may pay {5}{R}{R}. If you do, untap all attacking creatures and after this phase, there is an additional combat phase.",
                                "isCommander": false
                        },
                        {
                                "name": "Tyrant's Familiar",
                                "quantity": 1,
                                "manaCost": "{5}{R}{R}",
                                "cmc": 7,
                                "typeLine": "Creature — Dragon",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Flying, haste\nLieutenant — As long as you control your commander, this creature gets +2/+2 and has \"Whenever this creature attacks, it deals 7 damage to target creature defending player controls.\"",
                                "isCommander": false
                        },
                        {
                                "name": "Atarka, World Render",
                                "quantity": 1,
                                "manaCost": "{5}{R}{G}",
                                "cmc": 7,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "6",
                                "toughness": "4",
                                "oracleText": "Flying, trample\nWhenever a Dragon you control attacks, it gains double strike until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Bladewing the Risen",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}{R}{R}",
                                "cmc": 7,
                                "typeLine": "Legendary Creature — Zombie Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhen Bladewing enters, you may return target Dragon permanent card from your graveyard to the battlefield.\n{B}{R}: Dragon creatures get +1/+1 until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Broodmate Dragon",
                                "quantity": 1,
                                "manaCost": "{3}{B}{R}{G}",
                                "cmc": 6,
                                "typeLine": "Creature — Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhen this creature enters, create a 4/4 red Dragon creature token with flying.",
                                "isCommander": false
                        },
                        {
                                "name": "Crosis, the Purger",
                                "quantity": 1,
                                "manaCost": "{3}{U}{B}{R}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "6",
                                "toughness": "6",
                                "oracleText": "Flying\nWhenever Crosis deals combat damage to a player, you may pay {2}{B}. If you do, choose a color, then that player reveals their hand and discards all cards of that color.",
                                "isCommander": false
                        },
                        {
                                "name": "Dromoka, the Eternal",
                                "quantity": 1,
                                "manaCost": "{3}{G}{W}",
                                "cmc": 5,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Flying\nWhenever a Dragon you control attacks, bolster 2. (Choose a creature with the least toughness among creatures you control and put two +1/+1 counters on it.)",
                                "isCommander": false
                        },
                        {
                                "name": "Intet, the Dreamer",
                                "quantity": 1,
                                "manaCost": "{3}{G}{U}{R}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "6",
                                "toughness": "6",
                                "oracleText": "Flying\nWhenever Intet deals combat damage to a player, you may pay {2}{U}. If you do, exile the top card of your library face down. You may look at that card for as long as it remains exiled. You may play that card without paying its mana cost for as long as Intet remains on the battlefield.",
                                "isCommander": false
                        },
                        {
                                "name": "Kolaghan, the Storm's Fury",
                                "quantity": 1,
                                "manaCost": "{3}{B}{R}",
                                "cmc": 5,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "4",
                                "toughness": "5",
                                "oracleText": "Flying\nWhenever a Dragon you control attacks, creatures you control get +1/+0 until end of turn.\nDash {3}{B}{R} (You may cast this spell for its dash cost. If you do, it gains haste, and it's returned from the battlefield to its owner's hand at the beginning of the next end step.)",
                                "isCommander": false
                        },
                        {
                                "name": "Niv-Mizzet, Dracogenius",
                                "quantity": 1,
                                "manaCost": "{2}{U}{U}{R}{R}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Dragon Wizard",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Flying\nWhenever Niv-Mizzet deals damage to a player, you may draw a card.\n{U}{R}: Niv-Mizzet deals 1 damage to any target.",
                                "isCommander": false
                        },
                        {
                                "name": "Ojutai, Soul of Winter",
                                "quantity": 1,
                                "manaCost": "{5}{W}{U}",
                                "cmc": 7,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "5",
                                "toughness": "6",
                                "oracleText": "Flying, vigilance\nWhenever a Dragon you control attacks, tap target nonland permanent an opponent controls. That permanent doesn't untap during its controller's next untap step.",
                                "isCommander": false
                        },
                        {
                                "name": "Scion of the Ur-Dragon",
                                "quantity": 1,
                                "manaCost": "{W}{U}{B}{R}{G}",
                                "cmc": 5,
                                "typeLine": "Legendary Creature — Dragon Avatar",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\n{2}: Search your library for a Dragon permanent card and put it into your graveyard. If you do, Scion of the Ur-Dragon becomes a copy of that card until end of turn. Then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Silumgar, the Drifting Death",
                                "quantity": 1,
                                "manaCost": "{4}{U}{B}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "3",
                                "toughness": "7",
                                "oracleText": "Flying, hexproof\nWhenever a Dragon you control attacks, creatures defending player controls get -1/-1 until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Spellbound Dragon",
                                "quantity": 1,
                                "manaCost": "{3}{U}{R}",
                                "cmc": 5,
                                "typeLine": "Creature — Dragon",
                                "power": "3",
                                "toughness": "5",
                                "oracleText": "Flying\nWhenever this creature attacks, draw a card, then discard a card. This creature gets +X/+0 until end of turn, where X is the discarded card's mana value.",
                                "isCommander": false
                        },
                        {
                                "name": "Teneb, the Harvester",
                                "quantity": 1,
                                "manaCost": "{3}{W}{B}{G}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "6",
                                "toughness": "6",
                                "oracleText": "Flying\nWhenever Teneb deals combat damage to a player, you may pay {2}{B}. If you do, put target creature card from a graveyard onto the battlefield under your control.",
                                "isCommander": false
                        },
                        {
                                "name": "Steel Hellkite",
                                "quantity": 1,
                                "manaCost": "{6}",
                                "cmc": 6,
                                "typeLine": "Artifact Creature — Dragon",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Flying\n{2}: This creature gets +1/+0 until end of turn.\n{X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn. Activate only once each turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Orator of Ojutai",
                                "quantity": 1,
                                "manaCost": "{1}{W}",
                                "cmc": 2,
                                "typeLine": "Creature — Bird Monk",
                                "power": "0",
                                "toughness": "4",
                                "oracleText": "As an additional cost to cast this spell, you may reveal a Dragon card from your hand.\nDefender, flying\nWhen this creature enters, if you revealed a Dragon card or controlled a Dragon as you cast this spell, draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Dragonlord's Servant",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Creature — Goblin Shaman",
                                "power": "1",
                                "toughness": "3",
                                "oracleText": "Dragon spells you cast cost {1} less to cast.",
                                "isCommander": false
                        },
                        {
                                "name": "Dragonspeaker Shaman",
                                "quantity": 1,
                                "manaCost": "{1}{R}{R}",
                                "cmc": 3,
                                "typeLine": "Creature — Human Barbarian Shaman",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Dragon spells you cast cost {2} less to cast.",
                                "isCommander": false
                        },
                        {
                                "name": "Savage Ventmaw",
                                "quantity": 1,
                                "manaCost": "{4}{R}{G}",
                                "cmc": 6,
                                "typeLine": "Creature — Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhenever this creature attacks, add {R}{R}{R}{G}{G}{G}. Until end of turn, you don't lose this mana as steps and phases end.",
                                "isCommander": false
                        },
                        {
                                "name": "Fortunate Few",
                                "quantity": 1,
                                "manaCost": "{3}{W}{W}",
                                "cmc": 5,
                                "typeLine": "Sorcery",
                                "oracleText": "Choose a nonland permanent you don't control, then each other player chooses a nonland permanent they don't control that hasn't been chosen this way. Destroy all other nonland permanents.",
                                "isCommander": false
                        },
                        {
                                "name": "Fractured Identity",
                                "quantity": 1,
                                "manaCost": "{3}{W}{U}",
                                "cmc": 5,
                                "typeLine": "Sorcery",
                                "oracleText": "Exile target nonland permanent. Each player other than its controller creates a token that's a copy of it.",
                                "isCommander": false
                        },
                        {
                                "name": "Crux of Fate",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Sorcery",
                                "oracleText": "Choose one —\n• Destroy all Dragon creatures.\n• Destroy all non-Dragon creatures.",
                                "isCommander": false
                        },
                        {
                                "name": "Painful Truths",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Sorcery",
                                "oracleText": "Converge — You draw X cards and lose X life, where X is the number of colors of mana spent to cast this spell.",
                                "isCommander": false
                        },
                        {
                                "name": "Earthquake",
                                "quantity": 1,
                                "manaCost": "{X}{R}",
                                "cmc": 1,
                                "typeLine": "Sorcery",
                                "oracleText": "Earthquake deals X damage to each creature without flying and each player.",
                                "isCommander": false
                        },
                        {
                                "name": "Cultivate",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Sorcery",
                                "oracleText": "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Farseek",
                                "quantity": 1,
                                "manaCost": "{1}{G}",
                                "cmc": 2,
                                "typeLine": "Sorcery",
                                "oracleText": "Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Kodama's Reach",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Sorcery — Arcane",
                                "oracleText": "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Rain of Thorns",
                                "quantity": 1,
                                "manaCost": "{4}{G}{G}",
                                "cmc": 6,
                                "typeLine": "Sorcery",
                                "oracleText": "Choose one or more —\n• Destroy target artifact.\n• Destroy target enchantment.\n• Destroy target land.",
                                "isCommander": false
                        },
                        {
                                "name": "Fist of Suns",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "You may pay {W}{U}{B}{R}{G} rather than pay the mana cost for spells you cast.",
                                "isCommander": false
                        },
                        {
                                "name": "Herald's Horn",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "As this artifact enters, choose a creature type.\nCreature spells you cast of the chosen type cost {1} less to cast.\nAt the beginning of your upkeep, look at the top card of your library. If it's a creature card of the chosen type, you may reveal it and put it into your hand.",
                                "isCommander": false
                        },
                        {
                                "name": "Mirror of the Forebears",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "As this artifact enters, choose a creature type.\n{1}: Until end of turn, this artifact becomes a copy of target creature you control of the chosen type, except it's an artifact in addition to its other types.",
                                "isCommander": false
                        },
                        {
                                "name": "Armillary Sphere",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{2}, {T}, Sacrifice this artifact: Search your library for up to two basic land cards, reveal them, put them into your hand, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Commander's Sphere",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.\nSacrifice this artifact: Draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Darksteel Ingot",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "Indestructible (Effects that say \"destroy\" don't destroy this artifact.)\n{T}: Add one mana of any color.",
                                "isCommander": false
                        },
                        {
                                "name": "Dreamstone Hedron",
                                "quantity": 1,
                                "manaCost": "{6}",
                                "cmc": 6,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}{C}{C}.\n{3}, {T}, Sacrifice this artifact: Draw three cards.",
                                "isCommander": false
                        },
                        {
                                "name": "Lightning Greaves",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact — Equipment",
                                "oracleText": "Equipped creature has haste and shroud. (It can't be the target of spells or abilities.)\nEquip {0}",
                                "isCommander": false
                        },
                        {
                                "name": "Nihil Spellbomb",
                                "quantity": 1,
                                "manaCost": "{1}",
                                "cmc": 1,
                                "typeLine": "Artifact",
                                "oracleText": "{T}, Sacrifice this artifact: Exile target player's graveyard.\nWhen this artifact is put into a graveyard from the battlefield, you may pay {B}. If you do, draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Sol Ring",
                                "quantity": 1,
                                "manaCost": "{1}",
                                "cmc": 1,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}{C}.",
                                "isCommander": false
                        },
                        {
                                "name": "Wayfarer's Bauble",
                                "quantity": 1,
                                "manaCost": "{1}",
                                "cmc": 1,
                                "typeLine": "Artifact",
                                "oracleText": "{2}, {T}, Sacrifice this artifact: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Kindred Discovery",
                                "quantity": 1,
                                "manaCost": "{3}{U}{U}",
                                "cmc": 5,
                                "typeLine": "Enchantment",
                                "oracleText": "As this enchantment enters, choose a creature type.\nWhenever a creature you control of the chosen type enters or attacks, draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Monastery Siege",
                                "quantity": 1,
                                "manaCost": "{2}{U}",
                                "cmc": 3,
                                "typeLine": "Enchantment",
                                "oracleText": "As this enchantment enters, choose Khans or Dragons.\n• Khans — At the beginning of your draw step, draw an additional card, then discard a card.\n• Dragons — Spells your opponents cast that target you or a permanent you control cost {2} more to cast.",
                                "isCommander": false
                        },
                        {
                                "name": "Palace Siege",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Enchantment",
                                "oracleText": "As this enchantment enters, choose Khans or Dragons.\n• Khans — At the beginning of your upkeep, return target creature card from your graveyard to your hand.\n• Dragons — At the beginning of your upkeep, each opponent loses 2 life and you gain 2 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Crucible of Fire",
                                "quantity": 1,
                                "manaCost": "{3}{R}",
                                "cmc": 4,
                                "typeLine": "Enchantment",
                                "oracleText": "Dragon creatures you control get +3/+3.",
                                "isCommander": false
                        },
                        {
                                "name": "Dragon Tempest",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Enchantment",
                                "oracleText": "Whenever a creature you control with flying enters, it gains haste until end of turn.\nWhenever a Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Frontier Siege",
                                "quantity": 1,
                                "manaCost": "{3}{G}",
                                "cmc": 4,
                                "typeLine": "Enchantment",
                                "oracleText": "As this enchantment enters, choose Khans or Dragons.\n• Khans — At the beginning of each of your main phases, add {G}{G}.\n• Dragons — Whenever a creature you control with flying enters, you may have it fight target creature you don't control.",
                                "isCommander": false
                        },
                        {
                                "name": "Curse of Verbosity",
                                "quantity": 1,
                                "manaCost": "{2}{U}",
                                "cmc": 3,
                                "typeLine": "Enchantment — Aura Curse",
                                "oracleText": "Enchant player\nWhenever enchanted player is attacked, you draw a card. Each opponent attacking that player does the same.",
                                "isCommander": false
                        },
                        {
                                "name": "Curse of Opulence",
                                "quantity": 1,
                                "manaCost": "{R}",
                                "cmc": 1,
                                "typeLine": "Enchantment — Aura Curse",
                                "oracleText": "Enchant player\nWhenever enchanted player is attacked, create a Gold token. Each opponent attacking that player does the same. (A Gold token is an artifact with \"Sacrifice this token: Add one mana of any color.\")",
                                "isCommander": false
                        },
                        {
                                "name": "Curse of Bounty",
                                "quantity": 1,
                                "manaCost": "{1}{G}",
                                "cmc": 2,
                                "typeLine": "Enchantment — Aura Curse",
                                "oracleText": "Enchant player\nWhenever enchanted player is attacked, untap all nonland permanents you control. Each opponent attacking that player untaps all nonland permanents they control.",
                                "isCommander": false
                        },
                        {
                                "name": "Elemental Bond",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Enchantment",
                                "oracleText": "Whenever a creature you control with power 3 or greater enters, draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Crucible of the Spirit Dragon",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add {C}.\n{1}, {T}: Put a storage counter on this land.\n{T}, Remove X storage counters from this land: Add X mana in any combination of colors. Spend this mana only to cast Dragon spells or activate abilities of Dragons.",
                                "isCommander": false
                        },
                        {
                                "name": "Haven of the Spirit Dragon",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a Dragon creature spell.\n{2}, {T}, Sacrifice this land: Return target Dragon creature card or Ugin planeswalker card from your graveyard to your hand.",
                                "isCommander": false
                        },
                        {
                                "name": "Mountain",
                                "quantity": 2,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Mountain",
                                "oracleText": "({T}: Add {R}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Mountain",
                                "quantity": 2,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Mountain",
                                "oracleText": "({T}: Add {R}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Mountain",
                                "quantity": 2,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Mountain",
                                "oracleText": "({T}: Add {R}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Forest",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Forest",
                                "oracleText": "({T}: Add {G}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Forest",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Forest",
                                "oracleText": "({T}: Add {G}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Forest",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Forest",
                                "oracleText": "({T}: Add {G}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Plains",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Plains",
                                "oracleText": "({T}: Add {W}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Plains",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Plains",
                                "oracleText": "({T}: Add {W}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Plains",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Plains",
                                "oracleText": "({T}: Add {W}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Island",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Island",
                                "oracleText": "({T}: Add {U}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Island",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Island",
                                "oracleText": "({T}: Add {U}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Island",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Island",
                                "oracleText": "({T}: Add {U}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Path of Ancestry",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1. (Look at the top card of your library. You may put that card on the bottom.)",
                                "isCommander": false
                        },
                        {
                                "name": "Arcane Sanctum",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {W}, {U}, or {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Command Tower",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.",
                                "isCommander": false
                        },
                        {
                                "name": "Crumbling Necropolis",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {U}, {B}, or {R}.",
                                "isCommander": false
                        },
                        {
                                "name": "Frontier Bivouac",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {G}, {U}, or {R}.",
                                "isCommander": false
                        },
                        {
                                "name": "Jungle Shrine",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {R}, {G}, or {W}.",
                                "isCommander": false
                        },
                        {
                                "name": "Mystic Monastery",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {U}, {R}, or {W}.",
                                "isCommander": false
                        },
                        {
                                "name": "Nomad Outpost",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {R}, {W}, or {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Opulent Palace",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {B}, {G}, or {U}.",
                                "isCommander": false
                        },
                        {
                                "name": "Sandsteppe Citadel",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {W}, {B}, or {G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Savage Lands",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {B}, {R}, or {G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Seaside Citadel",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {G}, {W}, or {U}.",
                                "isCommander": false
                        },
                        {
                                "name": "Vivid Crag",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped with two charge counters on it.\n{T}: Add {R}.\n{T}, Remove a charge counter from this land: Add one mana of any color.",
                                "isCommander": false
                        },
                        {
                                "name": "Vivid Creek",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped with two charge counters on it.\n{T}: Add {U}.\n{T}, Remove a charge counter from this land: Add one mana of any color.",
                                "isCommander": false
                        },
                        {
                                "name": "Vivid Grove",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped with two charge counters on it.\n{T}: Add {G}.\n{T}, Remove a charge counter from this land: Add one mana of any color.",
                                "isCommander": false
                        },
                        {
                                "name": "Vivid Marsh",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped with two charge counters on it.\n{T}: Add {B}.\n{T}, Remove a charge counter from this land: Add one mana of any color.",
                                "isCommander": false
                        },
                        {
                                "name": "Vivid Meadow",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped with two charge counters on it.\n{T}: Add {W}.\n{T}, Remove a charge counter from this land: Add one mana of any color.",
                                "isCommander": false
                        }
                ]
        },
        {
                "id": "preset_prosper",
                "name": "Prosper, Tome-Bound (Treasures & Exile)",
                "commander": "Prosper, Tome-Bound",
                "cards": [
                        {
                                "name": "Prosper, Tome-Bound",
                                "quantity": 1,
                                "manaCost": "{2}{B}{R}",
                                "cmc": 4,
                                "typeLine": "Legendary Creature — Tiefling Warlock",
                                "power": "1",
                                "toughness": "4",
                                "oracleText": "Deathtouch\nMystic Arcanum — At the beginning of your end step, exile the top card of your library. Until the end of your next turn, you may play that card.\nPact Boon — Whenever you play a card from exile, create a Treasure token.",
                                "isCommander": true
                        },
                        {
                                "name": "Chittering Witch",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Creature — Human Warlock",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "When this creature enters, create a number of 1/1 black Rat creature tokens equal to the number of opponents you have.\n{1}{B}, Sacrifice a creature: Target creature gets -2/-2 until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Fiend of the Shadows",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Creature — Vampire Wizard",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Flying\nWhenever this creature deals combat damage to a player, that player exiles a card from their hand. You may play that card for as long as it remains exiled.\nSacrifice a Human: Regenerate this creature.",
                                "isCommander": false
                        },
                        {
                                "name": "Gonti, Lord of Luxury",
                                "quantity": 1,
                                "manaCost": "{2}{B}{B}",
                                "cmc": 4,
                                "typeLine": "Legendary Creature — Aetherborn Rogue",
                                "power": "2",
                                "toughness": "3",
                                "oracleText": "Deathtouch\nWhen Gonti enters, look at the top four cards of target opponent's library, exile one of them face down, then put the rest on the bottom of that library in a random order. You may cast that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.",
                                "isCommander": false
                        },
                        {
                                "name": "Marionette Master",
                                "quantity": 1,
                                "manaCost": "{4}{B}{B}",
                                "cmc": 6,
                                "typeLine": "Creature — Human Artificer",
                                "power": "1",
                                "toughness": "3",
                                "oracleText": "Fabricate 3 (When this creature enters, put three +1/+1 counters on it or create three 1/1 colorless Servo artifact creature tokens.)\nWhenever an artifact you control is put into a graveyard from the battlefield, target opponent loses life equal to this creature's power.",
                                "isCommander": false
                        },
                        {
                                "name": "Ogre Slumlord",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Creature — Ogre Rogue",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Whenever another nontoken creature dies, you may create a 1/1 black Rat creature token.\nRats you control have deathtouch.",
                                "isCommander": false
                        },
                        {
                                "name": "Piper of the Swarm",
                                "quantity": 1,
                                "manaCost": "{1}{B}",
                                "cmc": 2,
                                "typeLine": "Creature — Human Warlock",
                                "power": "1",
                                "toughness": "3",
                                "oracleText": "Rats you control have menace.\n{1}{B}, {T}: Create a 1/1 black Rat creature token.\n{2}{B}{B}, {T}, Sacrifice three Rats: Gain control of target creature.",
                                "isCommander": false
                        },
                        {
                                "name": "Pontiff of Blight",
                                "quantity": 1,
                                "manaCost": "{4}{B}{B}",
                                "cmc": 6,
                                "typeLine": "Creature — Zombie Cleric",
                                "power": "2",
                                "toughness": "7",
                                "oracleText": "Extort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.)\nOther creatures you control have extort. (If a creature has multiple instances of extort, each triggers separately.)",
                                "isCommander": false
                        },
                        {
                                "name": "Dark-Dweller Oracle",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Creature — Goblin Shaman",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "{1}, Sacrifice a creature: Exile the top card of your library. You may play that card this turn. (You still pay its costs. You can play a land this way only if you have an available land play remaining.)",
                                "isCommander": false
                        },
                        {
                                "name": "Dire Fleet Daredevil",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Creature — Human Pirate",
                                "power": "2",
                                "toughness": "1",
                                "oracleText": "First strike\nWhen this creature enters, exile target instant or sorcery card from an opponent's graveyard. You may cast it this turn, and mana of any type can be spent to cast that spell. If that spell would be put into a graveyard, exile it instead.",
                                "isCommander": false
                        },
                        {
                                "name": "Dream Pillager",
                                "quantity": 1,
                                "manaCost": "{5}{R}{R}",
                                "cmc": 7,
                                "typeLine": "Creature — Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhenever this creature deals combat damage to a player, exile that many cards from the top of your library. Until end of turn, you may cast spells from among those exiled cards.",
                                "isCommander": false
                        },
                        {
                                "name": "Etali, Primal Storm",
                                "quantity": 1,
                                "manaCost": "{4}{R}{R}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Elder Dinosaur",
                                "power": "6",
                                "toughness": "6",
                                "oracleText": "Whenever Etali attacks, exile the top card of each player's library, then you may cast any number of spells from among those cards without paying their mana costs.",
                                "isCommander": false
                        },
                        {
                                "name": "Izzet Chemister",
                                "quantity": 1,
                                "manaCost": "{2}{R}",
                                "cmc": 3,
                                "typeLine": "Creature — Goblin Wizard",
                                "power": "1",
                                "toughness": "3",
                                "oracleText": "Haste\n{R}, {T}: Exile target instant or sorcery card from your graveyard.\n{1}{R}, {T}, Sacrifice this creature: Cast any number of cards exiled with this creature without paying their mana costs.",
                                "isCommander": false
                        },
                        {
                                "name": "Tectonic Giant",
                                "quantity": 1,
                                "manaCost": "{2}{R}{R}",
                                "cmc": 4,
                                "typeLine": "Creature — Elemental Giant",
                                "power": "3",
                                "toughness": "4",
                                "oracleText": "Whenever this creature attacks or becomes the target of a spell an opponent controls, choose one —\n• This creature deals 3 damage to each opponent.\n• Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card.",
                                "isCommander": false
                        },
                        {
                                "name": "Loyal Apprentice",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Creature — Human Artificer",
                                "power": "2",
                                "toughness": "1",
                                "oracleText": "Haste\nLieutenant — At the beginning of combat on your turn, if you control your commander, create a 1/1 colorless Thopter artifact creature token with flying. That token gains haste until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Consuming Vapors",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Sorcery",
                                "oracleText": "Target player sacrifices a creature of their choice. You gain life equal to that creature's toughness.\nRebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)",
                                "isCommander": false
                        },
                        {
                                "name": "Hex",
                                "quantity": 1,
                                "manaCost": "{4}{B}{B}",
                                "cmc": 6,
                                "typeLine": "Sorcery",
                                "oracleText": "Destroy six target creatures.",
                                "isCommander": false
                        },
                        {
                                "name": "Apex of Power",
                                "quantity": 1,
                                "manaCost": "{7}{R}{R}{R}",
                                "cmc": 10,
                                "typeLine": "Sorcery",
                                "oracleText": "Exile the top seven cards of your library. Until end of turn, you may cast spells from among them.\nIf this spell was cast from your hand, add ten mana of any one color.",
                                "isCommander": false
                        },
                        {
                                "name": "Disrupt Decorum",
                                "quantity": 1,
                                "manaCost": "{2}{R}{R}",
                                "cmc": 4,
                                "typeLine": "Sorcery",
                                "oracleText": "Goad all creatures you don't control. (Until your next turn, those creatures attack each combat if able and attack a player other than you if able.)",
                                "isCommander": false
                        },
                        {
                                "name": "Ignite the Future",
                                "quantity": 1,
                                "manaCost": "{3}{R}",
                                "cmc": 4,
                                "typeLine": "Sorcery",
                                "oracleText": "Exile the top three cards of your library. Until the end of your next turn, you may play those cards. If this spell was cast from a graveyard, you may play cards this way without paying their mana costs.\nFlashback {7}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
                                "isCommander": false
                        },
                        {
                                "name": "Phthisis",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}{B}{B}",
                                "cmc": 7,
                                "typeLine": "Sorcery",
                                "oracleText": "Destroy target creature. Its controller loses life equal to its power plus its toughness.\nSuspend 5—{1}{B} (Rather than cast this card from your hand, you may pay {1}{B} and exile it with five time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)",
                                "isCommander": false
                        },
                        {
                                "name": "Light Up the Stage",
                                "quantity": 1,
                                "manaCost": "{2}{R}",
                                "cmc": 3,
                                "typeLine": "Sorcery",
                                "oracleText": "Spectacle {R} (You may cast this spell for its spectacle cost rather than its mana cost if an opponent lost life this turn.)\nExile the top two cards of your library. Until the end of your next turn, you may play those cards.",
                                "isCommander": false
                        },
                        {
                                "name": "Throes of Chaos",
                                "quantity": 1,
                                "manaCost": "{3}{R}",
                                "cmc": 4,
                                "typeLine": "Sorcery",
                                "oracleText": "Cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)\nRetrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)",
                                "isCommander": false
                        },
                        {
                                "name": "Vandalblast",
                                "quantity": 1,
                                "manaCost": "{R}",
                                "cmc": 1,
                                "typeLine": "Sorcery",
                                "oracleText": "Destroy target artifact you don't control.\nOverload {4}{R} (You may cast this spell for its overload cost. If you do, change \"target\" in its text to \"each.\")",
                                "isCommander": false
                        },
                        {
                                "name": "Chaos Warp",
                                "quantity": 1,
                                "manaCost": "{2}{R}",
                                "cmc": 3,
                                "typeLine": "Instant",
                                "oracleText": "The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield.",
                                "isCommander": false
                        },
                        {
                                "name": "Commune with Lava",
                                "quantity": 1,
                                "manaCost": "{X}{R}{R}",
                                "cmc": 2,
                                "typeLine": "Instant",
                                "oracleText": "Exile the top X cards of your library. Until the end of your next turn, you may play those cards.",
                                "isCommander": false
                        },
                        {
                                "name": "Bedevil",
                                "quantity": 1,
                                "manaCost": "{B}{B}{R}",
                                "cmc": 3,
                                "typeLine": "Instant",
                                "oracleText": "Destroy target artifact, creature, or planeswalker.",
                                "isCommander": false
                        },
                        {
                                "name": "Bituminous Blast",
                                "quantity": 1,
                                "manaCost": "{3}{B}{R}",
                                "cmc": 5,
                                "typeLine": "Instant",
                                "oracleText": "Cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)\nBituminous Blast deals 4 damage to target creature.",
                                "isCommander": false
                        },
                        {
                                "name": "Rakdos Charm",
                                "quantity": 1,
                                "manaCost": "{B}{R}",
                                "cmc": 2,
                                "typeLine": "Instant",
                                "oracleText": "Choose one —\n• Exile target player's graveyard.\n• Destroy target artifact.\n• Each creature deals 1 damage to its controller.",
                                "isCommander": false
                        },
                        {
                                "name": "Terminate",
                                "quantity": 1,
                                "manaCost": "{B}{R}",
                                "cmc": 2,
                                "typeLine": "Instant",
                                "oracleText": "Destroy target creature. It can't be regenerated.",
                                "isCommander": false
                        },
                        {
                                "name": "Chaos Wand",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "{4}, {T}: Target opponent exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost. Then put the exiled cards that weren't cast this way on the bottom of that library in a random order.",
                                "isCommander": false
                        },
                        {
                                "name": "Arcane Signet",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.",
                                "isCommander": false
                        },
                        {
                                "name": "Commander's Sphere",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.\nSacrifice this artifact: Draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Fellwar Stone",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add one mana of any color that a land an opponent controls could produce.",
                                "isCommander": false
                        },
                        {
                                "name": "Mind Stone",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Orazca Relic",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "Ascend (If you control ten or more permanents, you get the city's blessing for the rest of the game.)\n{T}: Add {C}.\n{T}, Sacrifice this artifact: You gain 3 life and draw a card. Activate only if you have the city's blessing.",
                                "isCommander": false
                        },
                        {
                                "name": "Rakdos Signet",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{1}, {T}: Add {B}{R}.",
                                "isCommander": false
                        },
                        {
                                "name": "Sol Ring",
                                "quantity": 1,
                                "manaCost": "{1}",
                                "cmc": 1,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}{C}.",
                                "isCommander": false
                        },
                        {
                                "name": "Talisman of Indulgence",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}.\n{T}: Add {B} or {R}. This artifact deals 1 damage to you.",
                                "isCommander": false
                        },
                        {
                                "name": "Unstable Obelisk",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}.\n{7}, {T}, Sacrifice this artifact: Destroy target permanent.",
                                "isCommander": false
                        },
                        {
                                "name": "Dead Man's Chest",
                                "quantity": 1,
                                "manaCost": "{1}{B}",
                                "cmc": 2,
                                "typeLine": "Enchantment — Aura",
                                "oracleText": "Enchant creature an opponent controls\nWhen enchanted creature dies, exile cards equal to its power from the top of its owner's library. You may cast spells from among those cards for as long as they remain exiled, and mana of any type can be spent to cast them.",
                                "isCommander": false
                        },
                        {
                                "name": "Theater of Horrors",
                                "quantity": 1,
                                "manaCost": "{1}{B}{R}",
                                "cmc": 3,
                                "typeLine": "Enchantment",
                                "oracleText": "At the beginning of your upkeep, exile the top card of your library.\nDuring your turn, if an opponent lost life this turn, you may play lands and cast spells from among cards exiled with this enchantment.\n{3}{R}: This enchantment deals 1 damage to target opponent or planeswalker.",
                                "isCommander": false
                        },
                        {
                                "name": "Shiny Impetus",
                                "quantity": 1,
                                "manaCost": "{2}{R}",
                                "cmc": 3,
                                "typeLine": "Enchantment — Aura",
                                "oracleText": "Enchant creature\nEnchanted creature gets +2/+2 and is goaded. (It attacks each combat if able and attacks a player other than you if able.)\nWhenever enchanted creature attacks, you create a Treasure token. (It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")",
                                "isCommander": false
                        },
                        {
                                "name": "Exotic Orchard",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add one mana of any color that a land an opponent controls could produce.",
                                "isCommander": false
                        },
                        {
                                "name": "Foreboding Ruins",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "As this land enters, you may reveal a Swamp or Mountain card from your hand. If you don't, this land enters tapped.\n{T}: Add {B} or {R}.",
                                "isCommander": false
                        },
                        {
                                "name": "Shadowblood Ridge",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{1}, {T}: Add {B}{R}.",
                                "isCommander": false
                        },
                        {
                                "name": "Smoldering Marsh",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land — Swamp Mountain",
                                "oracleText": "({T}: Add {B} or {R}.)\nThis land enters tapped unless you control two or more basic lands.",
                                "isCommander": false
                        },
                        {
                                "name": "Spinerock Knoll",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)\nThis land enters tapped.\n{T}: Add {R}.\n{R}, {T}: You may play the exiled card without paying its mana cost if an opponent was dealt 7 or more damage this turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Bojuka Bog",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, exile target player's graveyard.\n{T}: Add {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Command Tower",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.",
                                "isCommander": false
                        },
                        {
                                "name": "Mortuary Mire",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, you may put target creature card from your graveyard on top of your library.\n{T}: Add {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Rakdos Carnarium",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, return a land you control to its owner's hand.\n{T}: Add {B}{R}.",
                                "isCommander": false
                        },
                        {
                                "name": "Tainted Peak",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add {C}.\n{T}: Add {B} or {R}. Activate only if you control a Swamp.",
                                "isCommander": false
                        },
                        {
                                "name": "Zhalfirin Void",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "When this land enters, scry 1. (Look at the top card of your library. You may put that card on the bottom.)\n{T}: Add {C}.",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 4,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 4,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 3,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 3,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Mountain",
                                "quantity": 4,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Mountain",
                                "oracleText": "({T}: Add {R}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Mountain",
                                "quantity": 3,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Mountain",
                                "oracleText": "({T}: Add {R}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Mountain",
                                "quantity": 3,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Mountain",
                                "oracleText": "({T}: Add {R}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Mountain",
                                "quantity": 3,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Mountain",
                                "oracleText": "({T}: Add {R}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Karazikar, the Eye Tyrant",
                                "quantity": 1,
                                "manaCost": "{3}{B}{R}",
                                "cmc": 5,
                                "typeLine": "Legendary Creature — Beholder",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Whenever you attack a player, tap target creature that player controls and goad it. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)\nWhenever an opponent attacks another one of your opponents, you and the attacking player each draw a card and lose 1 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Bag of Devouring",
                                "quantity": 1,
                                "manaCost": "{B}",
                                "cmc": 1,
                                "typeLine": "Artifact",
                                "oracleText": "Whenever you sacrifice another nontoken artifact or creature, exile it.\n{2}, {T}, Sacrifice another artifact or creature: Draw a card.\n{3}, {T}, Sacrifice this artifact: Roll a d10. Return up to X cards from among cards exiled with this artifact to their owners' hands, where X is the result.",
                                "isCommander": false
                        },
                        {
                                "name": "Danse Macabre",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Sorcery",
                                "oracleText": "Each player sacrifices a nontoken creature of their choice. Roll a d20 and add the toughness of the creature you sacrificed this way.\n1—14 | Return a creature card put into a graveyard this way to the battlefield under your control.\n15+ | Return up to two creature cards put into graveyards this way to the battlefield under your control.",
                                "isCommander": false
                        },
                        {
                                "name": "Death Tyrant",
                                "quantity": 1,
                                "manaCost": "{4}{B}",
                                "cmc": 5,
                                "typeLine": "Creature — Beholder Skeleton",
                                "power": "4",
                                "toughness": "6",
                                "oracleText": "Menace\nNegative Energy Cone — Whenever an attacking creature you control or a blocking creature an opponent controls dies, create a 2/2 black Zombie creature token.\n{5}{B}: Return this card from your graveyard to the battlefield tapped.",
                                "isCommander": false
                        },
                        {
                                "name": "Grim Hireling",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Creature — Tiefling Rogue",
                                "power": "3",
                                "toughness": "2",
                                "oracleText": "Whenever one or more creatures you control deal combat damage to a player, create two Treasure tokens.\n{B}, Sacrifice X Treasures: Target creature gets -X/-X until end of turn. Activate only as a sorcery.",
                                "isCommander": false
                        },
                        {
                                "name": "Hellish Rebuke",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Instant",
                                "oracleText": "Until end of turn, permanents your opponents control gain \"When this permanent deals damage to the player who cast Hellish Rebuke, sacrifice this permanent. You lose 2 life.\"",
                                "isCommander": false
                        },
                        {
                                "name": "Lorcan, Warlock Collector",
                                "quantity": 1,
                                "manaCost": "{5}{B}{B}",
                                "cmc": 7,
                                "typeLine": "Legendary Creature — Devil",
                                "power": "6",
                                "toughness": "6",
                                "oracleText": "Flying\nWhenever a creature card is put into an opponent's graveyard from anywhere, you may pay life equal to its mana value. If you do, put it onto the battlefield under your control. It's a Warlock in addition to its other types.\nIf a Warlock you control would die, exile it instead.",
                                "isCommander": false
                        },
                        {
                                "name": "Fiendlash",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Artifact — Equipment",
                                "oracleText": "Equipped creature gets +2/+0 and has reach.\nWhenever equipped creature is dealt damage, it deals damage equal to its power to target player or planeswalker.\nEquip {2}{R}",
                                "isCommander": false
                        },
                        {
                                "name": "Reckless Endeavor",
                                "quantity": 1,
                                "manaCost": "{5}{R}{R}",
                                "cmc": 7,
                                "typeLine": "Sorcery",
                                "oracleText": "Roll two d12 and choose one result. Reckless Endeavor deals damage equal to that result to each creature. Then create a number of Treasure tokens equal to the other result.",
                                "isCommander": false
                        },
                        {
                                "name": "Share the Spoils",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Enchantment",
                                "oracleText": "When this enchantment enters and whenever an opponent loses the game, exile the top card of each player's library.\nDuring each player's turn, that player may play a land or cast a spell from among cards exiled with this enchantment, and they may spend mana as though it were mana of any color to cast that spell. When they do, exile the top card of their library.",
                                "isCommander": false
                        },
                        {
                                "name": "Wild-Magic Sorcerer",
                                "quantity": 1,
                                "manaCost": "{3}{R}",
                                "cmc": 4,
                                "typeLine": "Creature — Orc Shaman Sorcerer",
                                "power": "4",
                                "toughness": "3",
                                "oracleText": "The first spell you cast from exile each turn has cascade. (When you cast your first spell from exile, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)",
                                "isCommander": false
                        },
                        {
                                "name": "Fevered Suspicion",
                                "quantity": 1,
                                "manaCost": "{6}{B}{R}",
                                "cmc": 8,
                                "typeLine": "Sorcery",
                                "oracleText": "Each opponent exiles cards from the top of their library until they exile a nonland card. You may cast any number of spells from among those nonland cards without paying their mana costs.\nRebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)",
                                "isCommander": false
                        },
                        {
                                "name": "Hurl Through Hell",
                                "quantity": 1,
                                "manaCost": "{2}{B}{R}",
                                "cmc": 4,
                                "typeLine": "Instant",
                                "oracleText": "Exile target creature. Until the end of your next turn, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.",
                                "isCommander": false
                        },
                        {
                                "name": "Warlock Class",
                                "quantity": 1,
                                "manaCost": "{B}",
                                "cmc": 1,
                                "typeLine": "Enchantment — Class",
                                "oracleText": "(Gain the next level as a sorcery to add its ability.)\nAt the beginning of your end step, if a creature died this turn, each opponent loses 1 life.\n{1}{B}: Level 2\nWhen this Class becomes level 2, look at the top three cards of your library. Put one of them into your hand and the rest into your graveyard.\n{6}{B}: Level 3\nAt the beginning of your end step, each opponent loses life equal to the life they lost this turn. (Damage causes loss of life.)",
                                "isCommander": false
                        },
                        {
                                "name": "Chaos Channeler",
                                "quantity": 1,
                                "manaCost": "{2}{R}{R}",
                                "cmc": 4,
                                "typeLine": "Creature — Human Shaman",
                                "power": "4",
                                "toughness": "3",
                                "oracleText": "Wild Magic Surge — Whenever this creature attacks, roll a d20.\n1—9 | Exile the top card of your library. You may play it this turn.\n10—19 | Exile the top two cards of your library. You may play them this turn.\n20 | Exile the top three cards of your library. You may play them this turn.",
                                "isCommander": false
                        },
                        {
                                "name": "You Find Some Prisoners",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Instant",
                                "oracleText": "Choose one —\n• Break Their Chains — Destroy target artifact.\n• Interrogate Them — Exile the top three cards of target opponent's library. Choose one of them. Until the end of your next turn, you may play that card, and you may spend mana as though it were mana of any color to cast it.",
                                "isCommander": false
                        },
                        {
                                "name": "Bucknard's Everfull Purse",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{1}, {T}: Roll a d4 and create a number of Treasure tokens equal to the result. The player to your right gains control of this artifact.",
                                "isCommander": false
                        },
                        {
                                "name": "Ebony Fly",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "This artifact enters tapped.\n{T}: Add {C}.\n{4}: Roll a d6. Until end of turn, you may have this artifact become an X/X Insect artifact creature with flying, where X is the result.\nWhenever this artifact attacks, another target attacking creature gains flying until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Underdark Rift",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add {C}.\n{5}, {T}, Exile this land: Roll a d10. Put target artifact, creature, or planeswalker into its owner's library just beneath the top X cards of that library, where X is the result. Activate only as a sorcery.",
                                "isCommander": false
                        }
                ]
        }
];

    function getCardArtCropUrl(cardName) {
        if (!cardName) return 'https://cards.scryfall.io/back.png';
        return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}&format=image&version=art_crop`;
    }

    function getCardNormalUrl(cardName) {
        if (!cardName) return 'https://cards.scryfall.io/back.png';
        return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}&format=image&version=normal`;
    }

    let userActiveCustomDeck = null;
    let preconsLoaded = false;
    let cachedPrecons = [];
    let savedCustomDecks = [];

    try {
        const rawSaved = localStorage.getItem('arena_user_custom_decks');
        if (rawSaved) {
            const parsed = JSON.parse(rawSaved);
            if (Array.isArray(parsed)) {
                savedCustomDecks = parsed.map(d => ({ ...d, group: 'custom' }));
            }
        }
    } catch (e) {}

    function saveUserCustomDeck(deck) {
        deck.group = 'custom';
        savedCustomDecks = savedCustomDecks.filter(d => d.id !== deck.id && d.name !== deck.name);
        savedCustomDecks.unshift(deck);
        try {
            localStorage.setItem('arena_user_custom_decks', JSON.stringify(savedCustomDecks.slice(0, 30)));
        } catch (e) {}
        userActiveCustomDeck = deck;
        const searchInput = document.getElementById('arenaPreconSearchInput');
        populateDeckSelects(searchInput ? searchInput.value : '');
        const select0 = document.getElementById('seatSelect0');
        if (select0) select0.value = deck.id;
        window.updateSeat0Preview();
    }
    window.saveUserCustomDeck = saveUserCustomDeck;

    async function loadCommanderPreconsOnDemand(forceFull = false) {
        if (preconsLoaded && cachedPrecons.length > 0) return cachedPrecons;
        const btn = document.getElementById('btnLoadAllPrecons');
        if (btn) btn.textContent = '⏳ Loading Precons...';

        try {
            const resp = await fetch('commander-precons.json');
            if (resp.ok) {
                const data = await resp.json();
                if (Array.isArray(data)) {
                    cachedPrecons = data.map((p, idx) => ({
                        id: `precon_${(p.code || 'cmd').toLowerCase()}_${idx}`,
                        name: `📜 ${p.name} (${p.commander || 'Commander'})`,
                        commander: p.commander || p.name,
                        decklist: p.decklist,
                        colors: p.colors || [],
                        cards: null, // parsed on demand!
                        group: 'precon'
                    }));
                    preconsLoaded = true;
                    if (btn) btn.textContent = `✅ ${cachedPrecons.length} Precons Loaded`;
                    const searchInput = document.getElementById('arenaPreconSearchInput');
                    populateDeckSelects(searchInput ? searchInput.value : '');
                }
            }
        } catch (err) {
            console.warn("Could not load commander-precons.json:", err);
            if (btn) btn.textContent = '❌ Failed to Load';
        }
        return cachedPrecons;
    }
    window.loadCommanderPreconsOnDemand = loadCommanderPreconsOnDemand;

    function getAvailableDecks() {
        const list = [];
        if (userActiveCustomDeck) {
            list.push({ ...userActiveCustomDeck, group: 'custom' });
        }
        savedCustomDecks.forEach(sd => {
            if (!userActiveCustomDeck || userActiveCustomDeck.id !== sd.id) {
                list.push({ ...sd, group: 'custom' });
            }
        });
        if (typeof window.getSavedArmoryDecks === 'function') {
            try {
                const armoryDecks = window.getSavedArmoryDecks() || [];
                armoryDecks.forEach(ad => {
                    if (ad && ad.text) {
                        const armoryId = `armory_${ad.id}`;
                        if (!list.some(x => x.id === armoryId)) {
                            list.push({
                                id: armoryId,
                                name: `⚔️ [Armory] ${ad.name} (${ad.commander || 'Commander'})`,
                                commander: ad.commander || ad.name,
                                decklist: ad.text,
                                cards: null,
                                group: 'custom'
                            });
                        }
                    }
                });
            } catch (e) {}
        }
        if (window.currentDecksData && Array.isArray(window.currentDecksData)) {
            window.currentDecksData.forEach(d => {
                if (d && !d.error && d.cards && d.cards.length > 0) {
                    const id = `scanned_${d.id}`;
                    if (!list.some(x => x.id === id)) {
                        list.push({
                            id: id,
                            name: `⭐ ${d.name} (${d.commander || 'Commander'})`,
                            commander: d.commander || 'Commander',
                            cards: d.cards,
                            group: 'custom'
                        });
                    }
                }
            });
        }
        PRESET_DECKS.forEach(pd => list.push({ ...pd, group: 'preset' }));
        cachedPrecons.forEach(pc => list.push(pc));
        return list;
    }

    function populateDeckSelects(filterText = '') {
        const filter = (filterText || '').toLowerCase().trim();
        const decks = getAvailableDecks();
        const customDecks = decks.filter(d => d.group === 'custom');
        const presetDecks = decks.filter(d => d.group === 'preset');
        const preconDecks = decks.filter(d => d.group === 'precon');

        const matchesFilter = (d) => {
            if (!filter) return true;
            return (d.name && d.name.toLowerCase().includes(filter)) ||
                   (d.commander && d.commander.toLowerCase().includes(filter));
        };

        const filteredCustom = customDecks.filter(matchesFilter);
        const filteredPreset = presetDecks.filter(matchesFilter);
        const filteredPrecon = preconDecks.filter(matchesFilter);

        for (let i = 0; i < 4; i++) {
            const select = document.getElementById(`seatSelect${i}`);
            if (!select) continue;
            const prevVal = select.value;
            select.innerHTML = '';

            if (filteredCustom.length > 0) {
                const og = document.createElement('optgroup');
                og.label = `🌟 Custom & Imported Decks (${filteredCustom.length})`;
                filteredCustom.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = d.name;
                    og.appendChild(opt);
                });
                select.appendChild(og);
            }

            if (filteredPreset.length > 0) {
                const og = document.createElement('optgroup');
                og.label = `⚔️ Battle Presets (${filteredPreset.length})`;
                filteredPreset.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = d.name;
                    og.appendChild(opt);
                });
                select.appendChild(og);
            }

            if (filteredPrecon.length > 0) {
                const og = document.createElement('optgroup');
                og.label = `📜 Official Precons (${filteredPrecon.length})`;
                filteredPrecon.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = d.name;
                    og.appendChild(opt);
                });
                select.appendChild(og);
            }

            // Restore or default selection
            if (i === 0) {
                if (userActiveCustomDeck && select.querySelector(`option[value="${userActiveCustomDeck.id}"]`)) {
                    select.value = userActiveCustomDeck.id;
                } else if (prevVal && select.querySelector(`option[value="${prevVal}"]`)) {
                    select.value = prevVal;
                } else if (select.options.length > 0) {
                    select.selectedIndex = 0;
                }
            } else {
                const defaultBotIndex = i % PRESET_DECKS.length;
                const defaultBotId = PRESET_DECKS[defaultBotIndex].id;
                if (prevVal && prevVal !== (userActiveCustomDeck && userActiveCustomDeck.id) && select.querySelector(`option[value="${prevVal}"]`)) {
                    select.value = prevVal;
                } else if (select.querySelector(`option[value="${defaultBotId}"]`)) {
                    select.value = defaultBotId;
                } else if (select.options.length > 0) {
                    select.selectedIndex = Math.min(i, select.options.length - 1);
                }
            }
        }
        window.updateSeat0Preview();
    }
    window.populateDeckSelects = populateDeckSelects;

    window.filterDeckSelects = function (query) {
        populateDeckSelects(query);
    };

    window.importCustomDeckFromInput = async function () {
        const input = document.getElementById('arenaCustomDeckUrlInput');
        const statusEl = document.getElementById('arenaDeckImportStatus');
        const url = input ? input.value.trim() : '';
        if (!url) {
            if (statusEl) {
                statusEl.textContent = '⚠️ Enter a URL';
                statusEl.style.color = '#f87171';
            }
            return;
        }

        if (statusEl) {
            statusEl.textContent = '⏳ Loading deck...';
            statusEl.style.color = '#38bdf8';
        }

        try {
            let safeUrl = url.startsWith('http') ? url : 'https://' + url;
            let data = null;

            // Try Firebase Cloud Function proxy first
            if (typeof window.fetchDeckFromAPI === 'function') {
                try {
                    data = await window.fetchDeckFromAPI(safeUrl);
                } catch (proxyErr) {
                    console.warn("Proxy deck fetch failed, trying direct fallback:", proxyErr);
                }
            }

            // Direct API fallbacks
            if (!data) {
                if (safeUrl.includes('archidekt.com')) {
                    const m = safeUrl.match(/decks\/(\d+)/);
                    if (!m) throw new Error("Could not find deck ID in Archidekt URL.");
                    const res = await fetch(`https://archidekt.com/api/decks/${m[1]}/`);
                    if (!res.ok) throw new Error(`Archidekt API error: ${res.status}`);
                    data = await res.json();
                } else if (safeUrl.includes('moxfield.com')) {
                    const m = safeUrl.match(/decks\/([a-zA-Z0-9_-]+)/);
                    if (!m) throw new Error("Could not find deck ID in Moxfield URL.");
                    try {
                        const res = await fetch(`https://api.moxfield.com/v2/decks/all/${m[1]}`);
                        if (!res.ok) throw new Error(`Moxfield API error: ${res.status}`);
                        data = await res.json();
                    } catch (moxErr) {
                        throw new Error("Moxfield blocked direct browser access (Cloudflare). Click '📋 Paste Text' to paste directly!");
                    }
                } else {
                    throw new Error("Only Archidekt and Moxfield URLs are supported.");
                }
            }

            const deckObj = parseRemoteDeckData(data, safeUrl);
            saveUserCustomDeck(deckObj);
            if (input) input.value = '';
            if (statusEl) {
                statusEl.textContent = `✅ Imported "${deckObj.commander || deckObj.name}"!`;
                statusEl.style.color = '#4ade80';
            }
        } catch (err) {
            console.error("Custom deck import failed:", err);
            if (statusEl) {
                statusEl.textContent = `❌ ${err.message || 'Import failed'}`;
                statusEl.style.color = '#f87171';
            }
        }
    };

    window.openPasteDecklistModal = function () {
        const modal = document.getElementById('arenaPasteModal');
        if (modal) modal.style.display = 'flex';
    };

    window.closePasteDecklistModal = function () {
        const modal = document.getElementById('arenaPasteModal');
        if (modal) modal.style.display = 'none';
    };

    window.submitPastedDecklist = function () {
        const textarea = document.getElementById('arenaPasteTextarea');
        const text = textarea ? textarea.value.trim() : '';
        if (!text) return;

        const parsed = parseDecklistText(text);
        if (!parsed || !parsed.cards || parsed.cards.length === 0) {
            alert("No valid cards found in pasted text. Format like: 1 Sol Ring");
            return;
        }

        const deckName = parsed.commander || 'Custom Commander Deck';
        const deckObj = {
            id: 'custom_paste_' + Date.now(),
            name: `⭐ ${deckName}`,
            commander: parsed.commander,
            cards: parsed.cards
        };

        saveUserCustomDeck(deckObj);
        window.closePasteDecklistModal();
        if (textarea) textarea.value = '';
        const statusEl = document.getElementById('arenaDeckImportStatus');
        if (statusEl) {
            statusEl.textContent = `✅ Imported "${deckObj.commander}" (${deckObj.cards.length} cards)`;
            statusEl.style.color = '#4ade80';
        }
    };

    function initArenaModal() {
        if (document.getElementById('arenaModalBackdrop')) return;

        const backdrop = document.createElement('div');
        backdrop.id = 'arenaModalBackdrop';
        backdrop.className = 'arena-modal-backdrop';

        backdrop.innerHTML = `
            <div class="arena-container" id="arenaContainer">
                <!-- Arena Top Bar -->
                <header class="arena-header">
                    <div class="arena-brand">
                        <div class="arena-crown-badge">👑</div>
                        <div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <h2 class="arena-title" style="margin: 0;">Commander Battle Arena</h2>
                                <span class="arena-engine-badge" id="arenaEngineVersionBadge" style="background: linear-gradient(135deg, #10b981, #059669); color: #fff; font-size: 0.72rem; font-weight: 800; padding: 2px 10px; border-radius: 9999px; box-shadow: 0 0 10px rgba(16,185,129,0.4); letter-spacing: 0.05em; display: inline-flex; align-items: center; gap: 4px;">🕹️ Engine v11.5</span>
                            </div>
                            <span class="arena-subtitle">Client-Native Forge Rules Engine • Live 4-Player Tabletop</span>
                        </div>
                    </div>

                    <!-- Action Controls -->
                    <div class="arena-controls">
                        <button class="arena-btn" id="arenaBtnUndo" onclick="window.undoArenaAction()" title="Undo Last Action (Hotkey: Z)">
                            ↩️ Undo (Z)
                        </button>
                        <button class="arena-btn" id="arenaBtnUntap" onclick="window.untapAllMyLands()" title="Untap All Lands & Rocks (Hotkey: U)">
                            ⚡ Untap (U)
                        </button>
                        <button class="arena-btn" id="arenaBtnFullscreen" onclick="window.toggleFullscreenArena()" title="Toggle Fullscreen Arena">
                            <span id="arenaFullscreenIcon">⛶</span> Fullscreen
                        </button>
                        <button class="arena-btn arena-btn-gold" onclick="window.openArenaSetup()" title="Change Your Deck or AI Pod">
                            ⚔️ Select Deck
                        </button>
                        <button class="arena-btn" id="arenaBtnPlayPause" onclick="window.toggleArenaPlayPause()">
                            <span id="arenaPlayIcon">▶️</span> <span id="arenaPlayText">Auto-Bots</span>
                        </button>
                        <button class="arena-btn arena-btn-primary" id="arenaBtnStep" onclick="window.stepArenaPhase()" title="Advance Phase (Hotkey: Space)">
                            ⏭️ Next Action
                        </button>
                        <button class="arena-btn" onclick="window.simulateArenaInstant()">
                            ⚡ Instant Match
                        </button>
                        <button class="arena-btn" style="color: #ef4444;" onclick="window.closeCommanderArena()">
                            ✕ Close
                        </button>
                    </div>
                </header>

                <!-- Dedicated High-Visibility Turn Progression & Phase Ribbon -->
                <div class="arena-turn-bar" id="arenaTurnBar">
                    <div class="turn-status-cluster">
                        <div class="turn-badge-pill" id="arenaTurnNumberBadge">👑 Turn 1</div>
                        <div class="turn-active-player-box" id="arenaActivePlayerBadge">
                            <span class="active-dot"></span>
                            <span id="arenaActivePlayerName">Wilhelt, the Rotcleaver (You)</span>
                        </div>
                    </div>

                    <!-- Phase Tracker -->
                    <div class="arena-phase-bar" id="arenaPhaseBar">
                        <span class="arena-phase-step" data-phase="UNTAP">Untap</span>
                        <span class="arena-phase-sep">›</span>
                        <span class="arena-phase-step" data-phase="UPKEEP">Upkeep</span>
                        <span class="arena-phase-sep">›</span>
                        <span class="arena-phase-step" data-phase="DRAW">Draw</span>
                        <span class="arena-phase-sep">›</span>
                        <span class="arena-phase-step active" data-phase="MAIN_1">Main 1</span>
                        <span class="arena-phase-sep">›</span>
                        <span class="arena-phase-step" data-phase="COMBAT">Combat</span>
                        <span class="arena-phase-sep">›</span>
                        <span class="arena-phase-step" data-phase="MAIN_2">Main 2</span>
                        <span class="arena-phase-sep">›</span>
                        <span class="arena-phase-step" data-phase="END_STEP">End</span>
                    </div>

                    <div class="phase-detail-chip" id="arenaPhaseDetailChip">
                        Pre-Combat Main Phase
                    </div>
                </div>

                <!-- Arena Main Theater -->
                <div class="arena-theater">
                    <!-- Battlefield Canvas -->
                    <div class="arena-battlefield-canvas" id="arenaCanvas">
                        <!-- Top Zone: 3 Opponent Pod Bays -->
                        <div class="arena-opponents-row" id="arenaOpponentsRow"></div>

                        <!-- Center Stage: The Stack & Combat Announcement -->
                        <div class="arena-center-stage">
                            <div class="arena-stack-box" id="arenaStackBox">
                                <img id="stackCardThumb" class="stack-card-thumb" src="" alt="Spell" />
                                <div>
                                    <div style="font-size: 0.68rem; color: #c084fc; font-weight: 800; text-transform: uppercase;">Resolving Spell on Stack</div>
                                    <div class="stack-spell-name" id="stackSpellName">Casting Spell...</div>
                                </div>
                            </div>
                        </div>

                        <!-- Bottom Zone: Player Cockpit, Battlefield & Hand Tray -->
                        <div id="arenaPlayerBottomBay"></div>
                    </div>

                    <!-- Tactical Combat Log Stream -->
                    <aside class="arena-sidebar">
                        <div class="arena-sidebar-header">
                            <div class="arena-sidebar-title">
                                <span>📜</span> Match Tactical Log
                            </div>
                            <button class="arena-btn" style="padding: 0.2rem 0.5rem; font-size: 0.72rem;" onclick="window.clearArenaLog()">
                                Clear
                            </button>
                        </div>
                        <div class="arena-log-stream" id="arenaLogStream"></div>
                    </aside>
                </div>

                <!-- Floating High-Res Card Inspector -->
                <div class="card-hover-inspector" id="cardHoverInspector">
                    <img id="cardInspectorImg" src="" alt="Card Inspector" />
                    <div id="cardInspectorNotice" style="display: none;"></div>
                </div>

                <!-- Pod Setup Modal Overlay -->
                <div class="arena-setup-overlay" id="arenaSetupOverlay">
                    <div class="arena-setup-card">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <h3 style="margin: 0; font-size: 1.25rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.5rem;">
                                <span>⚔️</span> Select Your Deck & Pod Setup
                            </h3>
                            <button class="arena-btn" onclick="window.closeArenaSetup()">✕</button>
                        </div>
                        <p style="font-size: 0.86rem; color: var(--arena-text-muted); margin: 0; line-height: 1.45;">
                            Choose the deck you want to pilot in <strong>Seat 1</strong> before drawing your opening hand. You can also import custom decks from Archidekt/Moxfield or choose from 180+ precons.
                        </p>

                        <!-- Custom Deck Importer Bar -->
                        <div class="setup-import-box">
                            <div style="font-size: 0.82rem; font-weight: 700; color: #93c5fd; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                                <span style="display: flex; align-items: center; gap: 6px;">📥 Import Custom Deck (Moxfield / Archidekt / Text)</span>
                                <span id="arenaDeckImportStatus" style="font-size: 0.76rem; font-weight: 600;"></span>
                            </div>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" id="arenaCustomDeckUrlInput" placeholder="Paste Archidekt or Moxfield deck URL..." style="flex: 1; min-width: 0; background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 7px 12px; color: #fff; font-size: 0.82rem;" onkeydown="if(event.key==='Enter') window.importCustomDeckFromInput()" />
                                <button class="arena-btn arena-btn-gold" onclick="window.importCustomDeckFromInput()" style="white-space: nowrap; font-size: 0.8rem; padding: 6px 12px;">
                                    📥 Load URL
                                </button>
                                <button class="arena-btn" onclick="window.openPasteDecklistModal()" style="white-space: nowrap; font-size: 0.8rem; padding: 6px 12px;">
                                    📋 Paste Text
                                </button>
                            </div>
                        </div>

                        <!-- Precons & Decks Search Bar -->
                        <div class="setup-precon-bar">
                            <input type="text" class="setup-precon-input" id="arenaPreconSearchInput" placeholder="🔍 Filter decks & 180+ precons by name or commander..." oninput="window.filterDeckSelects(this.value)" />
                            <button class="arena-btn" id="btnLoadAllPrecons" onclick="window.loadCommanderPreconsOnDemand(true)" style="white-space: nowrap; font-size: 0.78rem; padding: 6px 10px;">
                                📜 Load All 182 Precons
                            </button>
                        </div>

                        <div class="setup-seats-grid">
                            <div class="setup-seat-box seat-1-featured">
                                <span class="setup-seat-label" style="color: #f59e0b; font-weight: 900; font-size: 0.84rem;">👑 Your Deck (Seat 1 - Player)</span>
                                <div style="display: flex; gap: 0.85rem; align-items: center; margin-top: 0.35rem;">
                                    <img id="seat0CmdrThumb" class="setup-seat-thumb" src="https://cards.scryfall.io/back.png" alt="Commander Art" />
                                    <div style="flex: 1; min-width: 0;">
                                        <select class="setup-seat-select" id="seatSelect0" onchange="window.updateSeat0Preview()"></select>
                                        <div id="seat0CmdrDetails" style="font-size: 0.78rem; color: #cbd5e1; margin-top: 0.3rem; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Loading Commander...</div>
                                        <div id="seat0FlaggedWarnings" style="display: none; margin-top: 6px;"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="setup-seat-box">
                                <span class="setup-seat-label">Seat 2 (Bot Opponent 1)</span>
                                <select class="setup-seat-select" id="seatSelect1"></select>
                            </div>
                            <div class="setup-seat-box">
                                <span class="setup-seat-label">Seat 3 (Bot Opponent 2)</span>
                                <select class="setup-seat-select" id="seatSelect2"></select>
                            </div>
                            <div class="setup-seat-box">
                                <span class="setup-seat-label">Seat 4 (Bot Opponent 3)</span>
                                <select class="setup-seat-select" id="seatSelect3"></select>
                            </div>
                        </div>

                        <!-- Turn Order / Starting Player Selector -->
                        <div class="setup-turn-order-box" style="margin-top: 0.85rem; padding: 0.85rem 1rem; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                <span style="font-weight: 800; font-size: 0.84rem; color: #f8fafc; display: flex; align-items: center; gap: 6px;">
                                    <span>🎲</span> Starting Player (Turn Order)
                                </span>
                                <span style="font-size: 0.76rem; color: #94a3b8;">Choose who goes first or roll randomly</span>
                            </div>
                            <div class="turn-order-pills-row" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                <button type="button" class="turn-order-pill active" id="turnOrder_random" onclick="window.setStartingPlayerChoice('random')">
                                    🎲 Random (High Roll)
                                </button>
                                <button type="button" class="turn-order-pill" id="turnOrder_0" onclick="window.setStartingPlayerChoice('0')">
                                    👑 I Go First (Seat 1)
                                </button>
                                <button type="button" class="turn-order-pill" id="turnOrder_1" onclick="window.setStartingPlayerChoice('1')">
                                    🤖 Opponent 1 (Seat 2)
                                </button>
                                <button type="button" class="turn-order-pill" id="turnOrder_2" onclick="window.setStartingPlayerChoice('2')">
                                    🤖 Opponent 2 (Seat 3)
                                </button>
                                <button type="button" class="turn-order-pill" id="turnOrder_3" onclick="window.setStartingPlayerChoice('3')">
                                    🤖 Opponent 3 (Seat 4)
                                </button>
                            </div>
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.75rem; align-items: center;">
                            <button class="arena-btn" onclick="window.closeArenaSetup()">Close</button>
                            <button class="arena-btn arena-btn-gold" id="btnLaunchPodMatch" onclick="window.applyArenaSetupAndStart()" style="font-weight: 900; font-size: 0.95rem; padding: 0.6rem 1.4rem;">
                                ⚔️ Select Deck & Draw Hand 🎴
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Paste Decklist Text Modal Overlay -->
                <div class="arena-paste-modal" id="arenaPasteModal" style="display: none;">
                    <div class="arena-paste-card">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <h3 style="margin: 0; color: #fff; font-size: 1.15rem; display: flex; align-items: center; gap: 8px;">
                                <span>📋</span> Paste Custom Commander Decklist
                            </h3>
                            <button class="arena-btn" onclick="window.closePasteDecklistModal()">✕</button>
                        </div>
                        <p style="font-size: 0.82rem; color: #94a3b8; line-height: 1.45; margin: 0 0 10px 0;">
                            Paste any MTG decklist from Moxfield, Archidekt, MTG Arena, or MTGO (e.g. <code>1 Sol Ring</code> or with <code>// Commander</code> header).
                        </p>
                        <textarea id="arenaPasteTextarea" rows="12" placeholder="// Commander&#10;1 Giada, Font of Hope&#10;&#10;// Mainboard&#10;1 Sol Ring&#10;1 Swords to Plowshares..." style="width: 100%; box-sizing: border-box; background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 10px; color: #f8fafc; font-family: monospace; font-size: 0.82rem; resize: vertical;"></textarea>
                        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px;">
                            <button class="arena-btn" onclick="window.closePasteDecklistModal()">Cancel</button>
                            <button class="arena-btn arena-btn-gold" onclick="window.submitPastedDecklist()">Import Deck</button>
                        </div>
                    </div>
                </div>

                <!-- Mana Color Choice Modal Overlay -->
                <div class="arena-mana-choice-modal" id="arenaManaChoiceModal" style="display: none;">
                    <div class="arena-mana-choice-card">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 1.25rem;">💎</span>
                                <div>
                                    <h3 id="manaChoiceCardName" style="margin: 0; color: #fff; font-size: 1.05rem; font-weight: 800;">Tap for Mana</h3>
                                    <div id="manaChoiceCardSub" style="font-size: 0.72rem; color: #94a3b8;">Choose which mana color to produce</div>
                                </div>
                            </div>
                            <button class="arena-btn" onclick="window.closeManaChoiceModal()">✕</button>
                        </div>
                        <div id="manaChoiceOptionsList" class="mana-choice-grid"></div>
                        <div style="display: flex; justify-content: flex-end; margin-top: 14px;">
                            <button class="arena-btn" onclick="window.closeManaChoiceModal()">Cancel</button>
                        </div>
                    </div>
                </div>

                <!-- Card Activated Ability Modal Overlay -->
                <div class="arena-ability-modal" id="arenaCardAbilityModal" style="display: none;">
                    <div class="arena-ability-card">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                            <div style="display: flex; gap: 12px; align-items: center;">
                                <img id="abilityCardThumb" class="setup-seat-thumb" src="" alt="Card Art" style="width: 52px; height: 52px; border-radius: 8px; border: 1px solid #475569;" />
                                <div>
                                    <h3 id="abilityCardName" style="margin: 0; color: #fff; font-size: 1.15rem; font-weight: 800;">Card Name</h3>
                                    <div id="abilityCardTypeLine" style="font-size: 0.76rem; color: #c084fc; font-weight: 700; margin-top: 2px;">Type Line</div>
                                    <div id="abilityCardStatus" style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">Untapped</div>
                                </div>
                            </div>
                            <button class="arena-btn" onclick="window.closeCardAbilityModal()">✕</button>
                        </div>

                        <div style="font-size: 0.8rem; font-weight: 700; color: #f59e0b; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                            <span>⚡</span> Available Activated Abilities:
                        </div>

                        <div id="abilityOptionsList" class="ability-options-container" style="display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto;">
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;">
                            <button class="arena-btn" onclick="window.closeCardAbilityModal()">Close</button>
                        </div>
                    </div>
                </div>

                <!-- Fetch Land / Search Library Modal Overlay -->
                <div class="arena-ability-modal" id="arenaFetchLandModal" style="display: none; z-index: 10005;">
                    <div class="arena-ability-card" style="max-width: 520px; border: 1px solid rgba(56, 189, 248, 0.4); box-shadow: 0 20px 45px rgba(0,0,0,0.8), 0 0 30px rgba(56,189,248,0.25);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                            <div style="display: flex; gap: 12px; align-items: center;">
                                <img id="fetchLandThumb" class="setup-seat-thumb" src="" alt="Card Art" style="width: 52px; height: 52px; border-radius: 8px; border: 1px solid #38bdf8;" />
                                <div>
                                    <h3 id="fetchLandName" style="margin: 0; color: #fff; font-size: 1.15rem; font-weight: 800;">Crack Fetchland</h3>
                                    <div style="font-size: 0.76rem; color: #38bdf8; font-weight: 700; margin-top: 2px;">Search Library for Basic Land</div>
                                    <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">Choose a basic land to put onto the battlefield tapped:</div>
                                </div>
                            </div>
                            <button class="arena-btn" onclick="window.closeFetchLandModal()">✕</button>
                        </div>

                        <div id="fetchLandOptionsList" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 12px;">
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                            <button class="arena-btn" onclick="window.closeFetchLandModal()">Cancel</button>
                        </div>
                    </div>
                </div>

                <!-- Declare Attacker Target Picker Modal Overlay (Rule 508.1b & 802.1) -->
                <div class="arena-attack-modal" id="arenaAttackTargetModal" style="display: none;">
                    <div class="arena-attack-card">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <div style="display: flex; gap: 12px; align-items: center;">
                                <img id="attackTargetCardThumb" class="setup-seat-thumb" src="" alt="Card Art" style="width: 52px; height: 52px; border-radius: 8px; border: 1px solid #ef4444;" />
                                <div>
                                    <h3 id="attackTargetCardName" style="margin: 0; color: #fff; font-size: 1.15rem; font-weight: 800;">Card Name</h3>
                                    <div id="attackTargetCardStats" style="font-size: 0.78rem; color: #ef4444; font-weight: 800; margin-top: 2px;">Power / Toughness</div>
                                    <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">MTG Rule 508.1b &amp; 802.1: Choose Defending Player or Planeswalker</div>
                                </div>
                            </div>
                            <button class="arena-btn" onclick="window.closeAttackTargetPicker()">✕</button>
                        </div>

                        <div id="attackTargetOptionsContainer" style="display: flex; flex-direction: column; gap: 10px; max-height: 320px; overflow-y: auto;">
                        </div>

                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                            <button class="arena-btn" id="attackRemoveTargetBtn" onclick="window.removeAttackerTarget()" style="background: rgba(239, 68, 68, 0.2); border-color: #ef4444; color: #fca5a5;">❌ Do Not Attack</button>
                            <button class="arena-btn" onclick="window.closeAttackTargetPicker()">Cancel</button>
                        </div>
                    </div>
                </div>

                <!-- Interactive Spell & Ability Target Picker Modal -->
                <div class="arena-ability-modal" id="arenaSpellTargetModal" style="display: none; z-index: 10007;">
                    <div class="arena-ability-card" style="max-width: 620px; border: 1px solid rgba(168, 85, 247, 0.5); box-shadow: 0 20px 50px rgba(0,0,0,0.85), 0 0 30px rgba(168, 85, 247, 0.25);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                            <div style="display: flex; gap: 12px; align-items: center;">
                                <img id="spellTargetThumb" class="setup-seat-thumb" src="" alt="Card Art" style="width: 52px; height: 52px; border-radius: 8px; border: 1px solid #a855f7;" />
                                <div>
                                    <h3 id="spellTargetTitle" style="margin: 0; color: #fff; font-size: 1.15rem; font-weight: 800;">Choose Target</h3>
                                    <div id="spellTargetSubtitle" style="font-size: 0.78rem; color: #c084fc; font-weight: 700; margin-top: 2px;">Select a legal target for this spell or ability</div>
                                    <div id="spellTargetEffectDesc" style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;"></div>
                                </div>
                            </div>
                            <button class="arena-btn" onclick="window.closeSpellTargetModal()">✕</button>
                        </div>

                        <div id="spellTargetOptionsList" style="display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow-y: auto; padding: 4px;">
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;">
                            <button class="arena-btn" onclick="window.closeSpellTargetModal()">Cancel</button>
                        </div>
                    </div>
                </div>

                <!-- Cleanup Step: Discard to Maximum Hand Size Modal (MTG Rule 514.1) -->
                <div class="arena-ability-modal" id="arenaCleanupDiscardModal" style="display: none; z-index: 10006;">
                    <div class="arena-ability-card" style="max-width: 680px; border: 1px solid rgba(245, 158, 11, 0.5); box-shadow: 0 20px 50px rgba(0,0,0,0.85), 0 0 30px rgba(245, 158, 11, 0.2);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                            <div>
                                <h3 style="margin: 0; color: #f59e0b; font-size: 1.15rem; font-weight: 800;">🧹 Cleanup Step — Discard to Hand Size (MTG Rule 514.1)</h3>
                                <div id="cleanupDiscardSubtext" style="font-size: 0.8rem; color: #cbd5e1; margin-top: 4px;">
                                    Your hand exceeds your maximum hand size of 7. Choose which card(s) to discard to your graveyard:
                                </div>
                            </div>
                            <span id="cleanupDiscardCounterBadge" style="background: rgba(245, 158, 11, 0.2); border: 1px solid rgba(245, 158, 11, 0.5); color: #fde047; font-size: 0.78rem; font-weight: 800; padding: 4px 10px; border-radius: 999px; white-space: nowrap;">
                                Selected: 0 / 1
                            </span>
                        </div>

                        <div id="cleanupDiscardCardsGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; max-height: 360px; overflow-y: auto; padding: 6px;">
                        </div>

                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px;">
                            <button class="arena-btn" onclick="window.closeCleanupDiscardModal()">Stay in End Step</button>
                            <button class="arena-btn arena-btn-gold" id="confirmCleanupDiscardBtn" onclick="window.confirmCleanupDiscardAndPass()" disabled style="opacity: 0.5; cursor: not-allowed;">
                                🗑️ Discard Selected &amp; End Turn
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Opening Hand & Mulligan Modal Overlay -->
                <div class="arena-mulligan-overlay" id="arenaMulliganOverlay"></div>
            </div>
        `;

        document.body.appendChild(backdrop);
    }

    // ============================================================================
    // HOVER CARD INSPECTOR
    // ============================================================================
    window.showCardInspector = function (cardName, evt) {
        if (!cardName) return;
        const inspector = document.getElementById('cardHoverInspector');
        const img = document.getElementById('cardInspectorImg');
        const notice = document.getElementById('cardInspectorNotice');
        if (inspector && img) {
            img.src = getCardNormalUrl(cardName);
            if (notice) {
                const issue = getCardEngineIssue(cardName);
                if (issue) {
                    notice.innerHTML = `
                        <div style="background: rgba(220, 38, 38, 0.95); backdrop-filter: blur(8px); border-top: 2px solid #ef4444; padding: 7px 9px; color: #fff; font-size: 0.75rem; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">
                            <div style="font-weight: 800; display: flex; align-items: center; gap: 4px; color: #fef08a;">
                                <span>⚠️</span> Engine Flag: ${escapeHtml(issue.category)}
                            </div>
                            <div style="margin-top: 2px; font-weight: 500; font-size: 0.72rem; line-height: 1.3; color: #f8fafc;">
                                ${escapeHtml(issue.reason)}
                            </div>
                        </div>
                    `;
                    notice.style.display = 'block';
                } else {
                    notice.style.display = 'none';
                    notice.innerHTML = '';
                }
            }

            // Dynamic Positioning relative to target or mouse cursor
            const target = (evt && (evt.currentTarget || evt.target));
            const width = 240;
            const height = 336;
            if (target && typeof target.getBoundingClientRect === 'function') {
                const rect = target.getBoundingClientRect();
                let top, left;
                if (rect.bottom > window.innerHeight - 240) {
                    top = Math.max(10, rect.top - height - 12);
                } else {
                    top = Math.min(window.innerHeight - height - 10, rect.bottom + 10);
                }
                left = rect.left + (rect.width / 2) - (width / 2);
                left = Math.max(10, Math.min(window.innerWidth - width - 15, left));

                inspector.style.top = `${Math.round(top)}px`;
                inspector.style.left = `${Math.round(left)}px`;
                inspector.style.bottom = 'auto';
                inspector.style.right = 'auto';
            } else if (evt && evt.clientX !== undefined) {
                let top = evt.clientY - 340;
                if (top < 10) top = evt.clientY + 20;
                let left = evt.clientX - 120;
                left = Math.max(10, Math.min(window.innerWidth - width - 15, left));
                inspector.style.top = `${Math.round(top)}px`;
                inspector.style.left = `${Math.round(left)}px`;
                inspector.style.bottom = 'auto';
                inspector.style.right = 'auto';
            }

            inspector.style.display = 'block';
        }
    };

    window.hideCardInspector = function () {
        const inspector = document.getElementById('cardHoverInspector');
        if (inspector) {
            inspector.style.display = 'none';
        }
    };

    // ============================================================================
    // RENDERING OPPONENTS (SEATS 2, 3, 4)
    // ============================================================================
    function renderOpponentsRow() {
        if (!currentGame || !currentGame.players || currentGame.players.length === 0) return '';
        const opponents = currentGame.players.slice(1); // Opponents 1, 2, 3
        const activePlayer = currentGame.getActivePlayer ? currentGame.getActivePlayer() : null;

        return opponents.map((opp, idx) => {
            if (!opp) return '';
            const isTurn = activePlayer && activePlayer.id === opp.id && opp.isAlive;
            const cmdr = opp.getCommander ? opp.getCommander() : null;
            const cmdrName = cmdr ? cmdr.name : 'Unknown Commander';
            const cmdrArt = getCardArtCropUrl(cmdrName);

            const creatures = opp.battlefield.filter(c => c.isCreature);
            const lands = opp.battlefield.filter(c => c.isLand);
            const supports = opp.battlefield.filter(c => !c.isCreature && !c.isLand);

            let creaturesHtml = '';
            if (creatures.length === 0) {
                creaturesHtml = `<div style="font-size: 0.7rem; color: var(--arena-text-muted); margin: auto;">Empty Battlefield</div>`;
            } else {
                creatures.forEach(c => {
                    const tappedClass = c.tapped ? 'tapped' : '';
                    const effP = opp.getEffectivePower ? opp.getEffectivePower(c) : c.power;
                    const effT = opp.getEffectiveToughness ? opp.getEffectiveToughness(c) : c.toughness;
                    const cIssue = getCardEngineIssue(c.name);
                    const cFlag = cIssue ? `<span class="card-engine-flag" title="⚠️ Engine Notice: [${escapeHtml(cIssue.category)}] ${escapeHtml(cIssue.reason)}">⚠️</span>` : '';
                    const ptCounters = Array.isArray(c.counters)
                        ? c.counters.filter(cnt => cnt.type === 'P1P1' || cnt.type === '+1/+1').reduce((s, cnt) => s + (cnt.count || 1), 0)
                        : (c.counters && c.counters['+1/+1'] ? c.counters['+1/+1'] : 0);
                    const hasBuff = ptCounters > 0 || (Array.isArray(c.counters) && c.counters.length > 0);
                    const ptBubbleClass = hasBuff ? 'mtg-card-pt-bubble buffed' : 'mtg-card-pt-bubble';
                    const counterBadge = ptCounters > 0
                        ? `<span class="mtg-card-counter-badge" title="${ptCounters}x +1/+1 Counter">+${ptCounters}</span>`
                        : '';

                    creaturesHtml += `
                        <div class="mtg-card-frame ${tappedClass}"
                             data-card-name="${escapeHtml(c.name)}"
                             onmouseenter="window.showCardInspector(this.getAttribute('data-card-name'), event)"
                             onmouseleave="window.hideCardInspector()"
                             title="${escapeHtml(c.name)} - ${c.typeLine}">
                            <div class="mtg-card-header">
                                <span class="mtg-card-name">${escapeHtml(c.name)}</span>
                            </div>
                            <img class="mtg-card-art" src="${getCardArtCropUrl(c.name)}" loading="lazy" alt="${escapeHtml(c.name)}" onerror="this.onerror=null; this.src='https://cards.scryfall.io/back.png';" />
                            <span class="${ptBubbleClass}">${effP}/${effT}</span>
                            ${counterBadge}
                            ${cFlag}
                            ${c.summoningSick ? '<span class="mtg-card-summoning-sick" title="Summoning Sick">🌀</span>' : ''}
                        </div>
                    `;
                });
            }

            let landsHtml = '';
            if (lands.length === 0) {
                landsHtml = `<span style="font-size: 0.65rem; color: var(--arena-text-muted);">No lands played</span>`;
            } else {
                landsHtml = lands.map(c => `
                    <div class="opp-land-chip ${c.tapped ? 'tapped' : ''}"
                         data-card-name="${escapeHtml(c.name)}"
                         onmouseenter="window.showCardInspector(this.getAttribute('data-card-name'), event)"
                         onmouseleave="window.hideCardInspector()"
                         title="${escapeHtml(c.name)} (${c.tapped ? 'Tapped' : 'Untapped'})">
                        <span>🏞️</span>
                        <span>${escapeHtml(c.name)}</span>
                    </div>
                `).join('');
            }

            let supportsHtml = '';
            if (supports.length > 0) {
                supportsHtml = supports.map(c => {
                    let icon = '💎';
                    if (c.isEnchantment) icon = '✨';
                    else if (c.isPlaneswalker) icon = '🛡️';
                    else if (c.isArtifact) icon = '⚙️';
                    return `
                        <div class="opp-support-chip ${c.tapped ? 'tapped' : ''}"
                             data-card-name="${escapeHtml(c.name)}"
                             onmouseenter="window.showCardInspector(this.getAttribute('data-card-name'), event)"
                             onmouseleave="window.hideCardInspector()"
                             title="${escapeHtml(c.name)} - ${escapeHtml(c.typeLine || 'Support')} (${c.tapped ? 'Tapped' : 'Untapped'})">
                            <span>${icon}</span>
                            <span>${escapeHtml(c.name)}</span>
                        </div>
                    `;
                }).join('');
            } else {
                supportsHtml = `<span style="font-size: 0.65rem; color: var(--arena-text-muted); padding: 0.15rem 0.3rem;">No artifacts/enchantments</span>`;
            }

            return `
                <div class="opponent-bay ${isTurn ? 'active-turn' : ''} ${!opp.isAlive ? 'eliminated' : ''}" id="oppBay_${opp.id}">
                    <div class="opponent-bay-header">
                        <div class="opponent-bay-profile">
                            <img src="${opp.avatar}" class="opponent-bay-avatar" alt="${escapeHtml(opp.name)}" />
                            <div>
                                <div class="opponent-bay-name">${escapeHtml(opp.name)}</div>
                                <div style="font-size: 0.65rem; color: var(--arena-text-muted);">Seat ${idx + 2} • Bot</div>
                            </div>
                        </div>
                        <div class="opponent-life-chip ${opp.life <= 10 ? 'danger' : ''}">
                            <span>❤️</span> <span>${opp.life}</span>
                        </div>
                    </div>

                    <!-- Opponent Commander & Hand status -->
                    <div class="opponent-meta-bar">
                        <div class="opponent-cmdr-chip"
                             data-card-name="${escapeHtml(cmdrName)}"
                             onmouseenter="window.showCardInspector(this.getAttribute('data-card-name'), event)"
                             onmouseleave="window.hideCardInspector()">
                            <img src="${cmdrArt}" class="opponent-cmdr-thumb" alt="Commander" />
                            <span>${escapeHtml(cmdrName)}</span>
                            ${getCardEngineIssue(cmdrName) ? `<span title="⚠️ Engine Notice: [${escapeHtml(getCardEngineIssue(cmdrName).category)}] ${escapeHtml(getCardEngineIssue(cmdrName).reason)}" style="color: #ef4444; font-size: 0.72rem; margin-left: 3px;">⚠️</span>` : ''}
                        </div>
                        <div>
                            <span>Tax: {${opp.commanderTax}}</span>
                            <span style="margin-left: 0.4rem;">🃏 ${opp.hand.length}</span>
                        </div>
                    </div>

                    <!-- Opponent Battlefield Shelves -->
                    <div class="opponent-battlefield">
                        <!-- Creatures Line -->
                        <div class="opponent-creatures-shelf">
                            ${creaturesHtml}
                        </div>
                        <!-- Lands Shelf -->
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.66rem; color: var(--arena-text-muted); font-weight: 700; padding: 0.1rem 0.2rem;">
                            <span>🏞️ Lands (${lands.length})</span>
                            <span>💎 Support (${supports.length}) • 📚 ${opp.library.length}</span>
                        </div>
                        <div class="opponent-lands-shelf">
                            ${landsHtml}
                        </div>
                        <!-- Support Permanents Line (Artifacts, Rocks, Enchantments) -->
                        <div class="opponent-support-shelf">
                            ${supportsHtml}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ============================================================================
    // RENDERING YOU (PLAYER 1 / SEAT 1 COCKPIT)
    // ============================================================================
    function renderPlayerCockpit() {
        if (!currentGame || !currentGame.players || !currentGame.players[0]) return '';
        const player = currentGame.players[0]; // Player 1
        const activePlayer = currentGame.getActivePlayer ? currentGame.getActivePlayer() : null;
        const isMyTurn = activePlayer && activePlayer.id === player.id && player.isAlive;
        const currentPhase = currentGame.currentPhase || 'MAIN_1';

        const cmdr = player.getCommander ? player.getCommander() : null;
        const cmdrName = cmdr ? cmdr.name : 'Unknown Commander';
        const cmdrArt = getCardArtCropUrl(cmdrName);
        const cmdrCastCost = cmdr ? (cmdr.cmc || 0) + player.commanderTax : 0;
        const availableMana = player.getAvailableMana().total;
        const isCmdrInZone = player.isCommanderInCommandZone();
        const isCmdrOnField = player.isCommanderOnBattlefield();
        const canCastCmdr = isMyTurn && currentPhase.includes('MAIN') && isCmdrInZone && (availableMana >= cmdrCastCost);

        const pool = player.manaPool || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        const totalFloating = (pool.W || 0) + (pool.U || 0) + (pool.B || 0) + (pool.R || 0) + (pool.G || 0) + (pool.C || 0);

        // 1. Creatures on your battlefield
        const creatures = player.battlefield.filter(c => c.isCreature);
        let creaturesHtml = '';
        if (creatures.length === 0) {
            creaturesHtml = `<div style="font-size: 0.78rem; color: var(--arena-text-muted); margin: auto;">No creatures summoned yet. Cast creatures from hand or command zone!</div>`;
        } else {
            creatures.forEach(c => {
                const tappedClass = c.tapped ? 'tapped' : '';
                const isSelectedAtk = selectedAttackerIds.has(c.id);
                const atkTarget = attackerTargets.get(c.id);
                const atkSelectedClass = isSelectedAtk ? 'attacker-selected' : '';
                const atkTargetBadge = isSelectedAtk && atkTarget
                    ? `<span class="mtg-card-target-badge" title="Attacking ${escapeHtml(atkTarget.targetName)}">🎯 ${escapeHtml(atkTarget.targetName)}</span>`
                    : (isSelectedAtk ? `<span class="mtg-card-target-badge" title="Attacking Opponent">🎯 Attacking</span>` : '');
                const canAttackThisTurn = isMyTurn && currentPhase === 'DECLARE_ATTACKERS' && !c.tapped && !c.summoningSick;
                const effP = player.getEffectivePower ? player.getEffectivePower(c) : c.power;
                const effT = player.getEffectiveToughness ? player.getEffectiveToughness(c) : c.toughness;
                const cIssue = getCardEngineIssue(c.name);
                const cFlag = cIssue ? `<span class="card-engine-flag" title="⚠️ Engine Notice: [${escapeHtml(cIssue.category)}] ${escapeHtml(cIssue.reason)}">⚠️</span>` : '';
                const abils = parseActivatedAbilities(c);
                const abilityBadge = abils.length > 0
                    ? `<button class="card-ability-badge" onclick="event.stopPropagation(); window.openCardAbilityModal('${c.id}')" title="⚡ Activate Ability (${abils.length})">⚡</button>`
                    : '';

                const ptCounters = Array.isArray(c.counters)
                    ? c.counters.filter(cnt => cnt.type === 'P1P1' || cnt.type === '+1/+1').reduce((s, cnt) => s + (cnt.count || 1), 0)
                    : (c.counters && c.counters['+1/+1'] ? c.counters['+1/+1'] : 0);
                const hasBuff = ptCounters > 0 || (Array.isArray(c.counters) && c.counters.length > 0);
                const ptBubbleClass = hasBuff ? 'mtg-card-pt-bubble buffed' : 'mtg-card-pt-bubble';
                const counterBadge = ptCounters > 0
                    ? `<span class="mtg-card-counter-badge" title="${ptCounters}x +1/+1 Counter">+${ptCounters}</span>`
                    : '';

                creaturesHtml += `
                    <div class="mtg-card-frame ${tappedClass} ${atkSelectedClass}"
                         onclick="window.handleCreatureClick('${c.id}')"
                         data-card-name="${escapeHtml(c.name)}"
                         onmouseenter="window.showCardInspector(this.getAttribute('data-card-name'), event)"
                         onmouseleave="window.hideCardInspector()"
                         title="${escapeHtml(c.name)} - ${c.typeLine}${abils.length > 0 ? ' (Click to activate ability)' : ''}">
                        <div class="mtg-card-header">
                            <span class="mtg-card-name">${c.isCommander ? '👑 ' : ''}${escapeHtml(c.name)}</span>
                            <span class="mtg-card-cost">${c.manaCost || ''}</span>
                        </div>
                        <img class="mtg-card-art" src="${getCardArtCropUrl(c.name)}" loading="lazy" alt="${escapeHtml(c.name)}" onerror="this.onerror=null; this.src='https://cards.scryfall.io/back.png';" />
                        <span class="${ptBubbleClass}">${effP}/${effT}</span>
                        ${counterBadge}
                        ${cFlag}
                        ${c.summoningSick ? '<span class="mtg-card-summoning-sick" title="Summoning Sickness">🌀</span>' : ''}
                        ${canAttackThisTurn && !isSelectedAtk ? '<span style="position: absolute; top: 16px; left: 3px; font-size: 0.65rem; background: #ef4444; border-radius: 4px; padding: 1px 3px; font-weight: 900;" title="Click to Declare Attack">⚔️</span>' : ''}
                        ${atkTargetBadge}
                        ${abilityBadge}
                    </div>
                `;
            });
        }

        // 2. Lands and Supports on your battlefield
        const landsAndSupports = player.battlefield.filter(c => !c.isCreature);
        let landsHtml = '';
        if (landsAndSupports.length === 0) {
            landsHtml = `<div style="font-size: 0.74rem; color: var(--arena-text-muted);">Play lands from your hand below</div>`;
        } else {
            landsAndSupports.forEach(c => {
                const tappedClass = c.tapped ? 'tapped' : '';
                const icon = c.isLand ? '🏞️' : (c.isPlaneswalker ? '🔮' : (c.isEnchantment ? '✨' : '💎'));
                const suppIssue = getCardEngineIssue(c.name);
                const suppFlag = suppIssue ? `<span title="⚠️ Engine Notice: [${escapeHtml(suppIssue.category)}] ${escapeHtml(suppIssue.reason)}" style="color: #ef4444; font-size: 0.72rem; margin-left: auto;">⚠️</span>` : '';
                const nonManaAbils = parseActivatedAbilities(c);
                const abilBadge = nonManaAbils.length > 0
                    ? `<button class="chip-ability-badge" onclick="event.stopPropagation(); window.openCardAbilityModal('${c.id}')" title="⚡ Activate Ability">⚡</button>`
                    : '';
                const manaBadge = (c.tapped && c.producedMana && c.producedMana.length > 0)
                    ? `<span class="chip-mana-preview">${c.producedMana.map(col => `<span class="mana-pip mana-pip-${col.toLowerCase()}" style="width:16px;height:16px;font-size:0.6rem;">${col}</span>`).join('')}</span>`
                    : '';

                landsHtml += `
                    <div class="mtg-land-chip ${tappedClass}"
                         onclick="window.handlePermanentClick('${c.id}')"
                         data-card-name="${escapeHtml(c.name)}"
                         onmouseenter="window.showCardInspector(this.getAttribute('data-card-name'), event)"
                         onmouseleave="window.hideCardInspector()"
                         title="${c.tapped ? `${escapeHtml(c.name)} (Tapped - Untaps during Untap Step)` : (nonManaAbils.length > 0 && !getPermanentManaAbilities(c) ? `Click to activate ${escapeHtml(c.name)} (${nonManaAbils[0].costText})` : (c.isLand || c.isManaRock ? 'Click to tap for mana' : escapeHtml(c.name)))}">
                        <span>${icon}</span>
                        <span>${escapeHtml(c.name)}</span>
                        ${manaBadge}
                        ${abilBadge}
                        ${suppFlag}
                    </div>
                `;
            });
        }

        // 3. Your Hand Cards (Fanned out bottom tray)
        let handHtml = '';
        if (player.hand.length === 0) {
            handHtml = `<div style="font-size: 0.8rem; color: var(--arena-text-muted); margin: auto;">Your hand is currently empty</div>`;
        } else {
            player.hand.forEach(c => {
                let isLand = false;
                if (c.manaCost || (c.cmc && c.cmc > 0)) {
                    isLand = false;
                    c.isLand = false;
                } else if (typeof window !== 'undefined' && typeof window.isLandCard === 'function') {
                    isLand = window.isLandCard(c);
                } else {
                    isLand = Boolean(c.isLand) || (c.typeLine || '').toLowerCase().includes('land');
                }
                if (isLand) {
                    c.isLand = true;
                    if (!c.typeLine || !c.typeLine.toLowerCase().includes('land')) c.typeLine = 'Land';
                    c.cmc = 0;
                    c.manaCost = '';
                }
                const isInstantOrFlash = !isLand && (c.isInstant || (c.keywords && c.keywords.has('flash')));
                const cost = isLand ? 0 : player.getCardCost(c, currentGame);
                let isPlayable = false;
                let tagText = '';

                if (isLand) {
                    const hasPlayedLand = Boolean(player.landPlayedThisTurn) || Boolean(player.landsPlayedCount && player.landsPlayedCount >= 1);
                    isPlayable = isMyTurn && currentPhase.includes('MAIN') && !hasPlayedLand;
                    tagText = isPlayable ? 'Play Land' : (hasPlayedLand ? 'Land Played' : 'Land');
                } else if (isInstantOrFlash) {
                    isPlayable = availableMana >= cost;
                    tagText = isPlayable ? (isMyTurn ? `Cast {${cost}}` : `⚡ Flash {${cost}}`) : (cost > 0 ? `Need {${cost}} in Pool` : 'Cast {0}');
                } else {
                    isPlayable = isMyTurn && currentPhase.includes('MAIN') && availableMana >= cost;
                    tagText = isPlayable ? `Cast {${cost}}` : (cost > 0 ? `Need {${cost}} in Pool` : 'Cast {0}');
                }

                const cardClasses = ['hand-card'];
                if (isPlayable) {
                    if (isInstantOrFlash && !isMyTurn) cardClasses.push('instant-playable');
                    else cardClasses.push('playable');
                } else {
                    cardClasses.push('need-mana');
                }

                const cardIssue = getCardEngineIssue(c.name);
                const cardFlag = cardIssue ? `<span class="card-engine-flag" title="⚠️ Engine Notice: [${escapeHtml(cardIssue.category)}] ${escapeHtml(cardIssue.reason)}">⚠️</span>` : '';

                handHtml += `
                    <div class="hand-card-wrapper" onclick="window.playCardFromHand('${c.id}')"
                         data-card-name="${escapeHtml(c.name)}"
                         onmouseenter="window.showCardInspector(this.getAttribute('data-card-name'), event)"
                         onmouseleave="window.hideCardInspector()">
                        <div class="${cardClasses.join(' ')}">
                            <img class="hand-card-art" src="${getCardNormalUrl(c.name)}" loading="lazy" alt="${escapeHtml(c.name)}" onerror="this.onerror=null; this.src='https://cards.scryfall.io/back.png';" />
                            ${cardFlag}
                            <div class="${isPlayable ? 'hand-card-play-tag' : 'hand-card-cost-tag'}">${tagText}</div>
                        </div>
                    </div>
                `;
            });
        }

        // 4. Action Trigger Button Label based on current Phase
        const maxHandSize = getPlayerMaxHandSize(player);
        const excessHandCount = maxHandSize === Infinity ? 0 : Math.max(0, player.hand.length - maxHandSize);
        let actionBtnText = 'Proceed ⏭️';
        let actionBtnClass = 'action-trigger-btn';
        if (isMyTurn) {
            if (currentPhase === 'MAIN_1' || currentPhase === 'MAIN1') {
                actionBtnText = 'Go to Combat ⚔️';
                actionBtnClass = 'action-trigger-btn arena-btn-gold';
            } else if (currentPhase === 'COMBAT_BEGIN') {
                actionBtnText = 'Declare Attackers ⚔️';
                actionBtnClass = 'action-trigger-btn arena-btn-gold';
            } else if (currentPhase === 'DECLARE_ATTACKERS' || currentPhase === 'COMBAT_DECLARE_ATTACKERS') {
                actionBtnText = selectedAttackerIds.size > 0 ? `Attack (${selectedAttackerIds.size} Selected) 💥` : 'Pass Combat (No Attacks) 🛡️';
                actionBtnClass = selectedAttackerIds.size > 0 ? 'action-trigger-btn arena-btn-danger' : 'action-trigger-btn';
            } else if (currentPhase.includes('COMBAT') || currentPhase.includes('BLOCK') || currentPhase.includes('DAMAGE')) {
                actionBtnText = 'Resolve Combat ⚔️';
                actionBtnClass = 'action-trigger-btn';
            } else if (currentPhase === 'MAIN_2' || currentPhase === 'MAIN2') {
                actionBtnText = 'Go to End Step ⏭️';
                actionBtnClass = 'action-trigger-btn arena-btn-gold';
            } else if (currentPhase === 'END_STEP' || currentPhase === 'END_OF_TURN' || currentPhase === 'CLEANUP') {
                if (excessHandCount > 0) {
                    actionBtnText = `🧹 Cleanup: Discard ${excessHandCount} & Pass`;
                    actionBtnClass = 'action-trigger-btn arena-btn-danger';
                } else {
                    actionBtnText = 'Pass to Next Player ⏳';
                    actionBtnClass = 'action-trigger-btn arena-btn-gold';
                }
            } else if (currentPhase === 'UNTAP' || currentPhase === 'UPKEEP' || currentPhase === 'DRAW') {
                actionBtnText = 'Proceed to Main 1 ⏭️';
                actionBtnClass = 'action-trigger-btn arena-btn-gold';
            }
        } else {
            actionBtnText = `Advance ${activePlayer ? activePlayer.name : 'Bot'} 🤖`;
            actionBtnClass = 'action-trigger-btn arena-btn-primary';
        }

        return `
            <div class="arena-player-cockpit ${isMyTurn ? 'active-turn' : ''}" id="playerCockpit">
                <div class="player-board-grid">
                    <!-- Left: Command Zone Pedestal -->
                    <div class="player-cmdr-pedestal">
                        <div style="font-size: 0.75rem; font-weight: 800; color: #f59e0b;">👑 COMMAND ZONE</div>
                        <img src="${cmdrArt}"
                             class="player-cmdr-card-img"
                             alt="Commander"
                             data-card-name="${escapeHtml(cmdrName)}"
                             onmouseenter="window.showCardInspector(this.getAttribute('data-card-name'), event)"
                             onmouseleave="window.hideCardInspector()" />
                        <div style="font-size: 0.75rem; font-weight: 700; color: #e2e8f0;">${escapeHtml(cmdrName)}</div>
                        ${isCmdrOnField ? '<span class="cmdr-status-badge on-field">👑 On Battlefield</span>' : '<span class="cmdr-status-badge in-zone">👑 In Command Zone</span>'}
                        <div style="font-size: 0.7rem; color: #c084fc; font-weight: 800;">Tax: {${player.commanderTax}} • Cost: {${cmdrCastCost}}</div>
                        ${isCmdrOnField ? `
                            <button class="cmdr-cast-cta" disabled style="opacity: 0.7; cursor: default;">👑 On Field</button>
                        ` : canCastCmdr ? `
                            <button class="cmdr-cast-cta ready" onclick="window.castPlayerCommander()">🚀 Cast Commander {${cmdrCastCost}}</button>
                        ` : (isCmdrInZone && availableMana < cmdrCastCost) ? `
                            <button class="cmdr-cast-cta need-mana" onclick="window.castPlayerCommander()">Need {${cmdrCastCost}} in Pool (Have {${availableMana}})</button>
                        ` : `
                            <button class="cmdr-cast-cta" onclick="window.castPlayerCommander()" ${!isMyTurn ? 'disabled' : ''}>Cast Commander {${cmdrCastCost}}</button>
                        `}
                    </div>

                    <!-- Right: Your Battlefield Shelves -->
                    <div class="player-field-rows">
                        <!-- Creatures Shelf -->
                        <div class="field-shelf-title">
                            <span>⚔️ Creatures Line</span>
                            <span style="font-weight: 400; font-size: 0.68rem; color: #94a3b8;">(${creatures.length} creatures)</span>
                        </div>
                        <div class="player-creatures-shelf">
                            ${creaturesHtml}
                        </div>

                        <!-- Lands & Artifacts Shelf -->
                        <div class="field-shelf-title">
                            <span>🏞️ Mana & Support Line</span>
                            <span style="font-weight: 400; font-size: 0.68rem; color: #94a3b8;">(Click to tap/untap for mana)</span>
                        </div>
                        <div class="player-lands-shelf">
                            ${landsHtml}
                        </div>
                    </div>
                </div>

                <!-- Hand Tray fanned out at bottom -->
                <div class="arena-hand-tray-container">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 0.5rem;">
                        <span style="font-size: 0.74rem; font-weight: 800; color: ${excessHandCount > 0 ? '#f59e0b' : 'var(--arena-text-muted)'}; text-transform: uppercase;">
                            🃏 Your Hand (${player.hand.length}/${maxHandSize === Infinity ? '∞' : maxHandSize} cards)${excessHandCount > 0 ? ` • Discard ${excessHandCount} at Cleanup` : ''}
                        </span>
                        <span style="font-size: 0.72rem; color: #a855f7;">Tap lands/rocks to float mana into pool, then click card to cast</span>
                    </div>
                    <div class="arena-hand-tray">
                        ${handHtml}
                    </div>
                </div>

                <!-- Tactical Action HUD -->
                <div class="arena-player-hud">
                    <!-- Life Dial with Manual Adjusters -->
                    <div class="player-life-dial">
                        <button class="player-life-dial-btn" onclick="window.adjustPlayerLife(-1)">−</button>
                        <span style="font-size: 0.85rem; color: #ef4444;">❤️</span>
                        <span class="player-life-dial-val">${player.life}</span>
                        <button class="player-life-dial-btn" onclick="window.adjustPlayerLife(1)">+</button>
                    </div>

                    <!-- Live Colored Mana Pool Display -->
                    <div class="player-mana-pool-bar" title="Live Colored Mana Pool & Available Floating Mana">
                        <div style="display: flex; align-items: center; gap: 4px; font-weight: 800; font-size: 0.78rem;">
                            <span>💎 Floating Pool:</span>
                        </div>
                        <div class="mana-pool-counter-group">
                            <span class="mana-counter-pill ${pool.W > 0 ? 'has-mana' : ''}" title="White Mana: ${pool.W || 0}">
                                <span class="mana-pip mana-pip-w" style="width:17px;height:17px;font-size:0.62rem;">W</span>
                                <span>${pool.W || 0}</span>
                            </span>
                            <span class="mana-counter-pill ${pool.U > 0 ? 'has-mana' : ''}" title="Blue Mana: ${pool.U || 0}">
                                <span class="mana-pip mana-pip-u" style="width:17px;height:17px;font-size:0.62rem;">U</span>
                                <span>${pool.U || 0}</span>
                            </span>
                            <span class="mana-counter-pill ${pool.B > 0 ? 'has-mana' : ''}" title="Black Mana: ${pool.B || 0}">
                                <span class="mana-pip mana-pip-b" style="width:17px;height:17px;font-size:0.62rem;">B</span>
                                <span>${pool.B || 0}</span>
                            </span>
                            <span class="mana-counter-pill ${pool.R > 0 ? 'has-mana' : ''}" title="Red Mana: ${pool.R || 0}">
                                <span class="mana-pip mana-pip-r" style="width:17px;height:17px;font-size:0.62rem;">R</span>
                                <span>${pool.R || 0}</span>
                            </span>
                            <span class="mana-counter-pill ${pool.G > 0 ? 'has-mana' : ''}" title="Green Mana: ${pool.G || 0}">
                                <span class="mana-pip mana-pip-g" style="width:17px;height:17px;font-size:0.62rem;">G</span>
                                <span>${pool.G || 0}</span>
                            </span>
                            <span class="mana-counter-pill ${pool.C > 0 ? 'has-mana' : ''}" title="Colorless Mana: ${pool.C || 0}">
                                <span class="mana-pip mana-pip-c" style="width:17px;height:17px;font-size:0.62rem;">C</span>
                                <span>${pool.C || 0}</span>
                            </span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px; margin-left: 6px; font-size: 0.76rem;">
                            <span style="color: #94a3b8;">Total:</span>
                            <span style="color: #38bdf8; font-weight: 900; font-size: 0.88rem;">${availableMana}</span>
                        </div>
                        ${totalFloating > 0 ? `
                            <button class="arena-btn" style="padding: 0.2rem 0.45rem; font-size: 0.68rem; margin-left: 0.35rem;" onclick="window.clearManaPool()" title="Empty floating mana pool">
                                🧹 Empty
                            </button>
                        ` : ''}
                    </div>

                    <!-- Tactical Turn & Phase Pill in Cockpit -->
                    <div class="hud-phase-chip" style="display: flex; align-items: center; gap: 0.45rem; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.14); padding: 0.35rem 0.75rem; border-radius: 8px; font-size: 0.78rem; font-weight: 800; white-space: nowrap;">
                        <span style="color: #f59e0b;">Turn ${currentGame.turn}</span>
                        <span style="color: rgba(255,255,255,0.25);">•</span>
                        <span style="color: #38bdf8;">${currentPhase.replace(/_/g, ' ')}</span>
                    </div>

                    <!-- Primary Phase Action Button -->
                    <button class="${actionBtnClass}" onclick="window.handleMainActionClick()">
                        ${actionBtnText}
                    </button>
                </div>
            </div>
        `;
    }

    function updateArenaDOM() {
        if (!currentGame) return;

        // Render Opponents
        const oppRow = document.getElementById('arenaOpponentsRow');
        if (oppRow) {
            oppRow.innerHTML = renderOpponentsRow();
        }

        // Render Player 1 Cockpit
        const bottomBay = document.getElementById('arenaPlayerBottomBay');
        if (bottomBay) {
            bottomBay.innerHTML = renderPlayerCockpit();
        }

        // Update Turn Number Badge
        const turnBadge = document.getElementById('arenaTurnNumberBadge');
        if (turnBadge) {
            turnBadge.textContent = `👑 Turn ${currentGame.turn}`;
        }

        // Update Active Player
        const activeP = currentGame.getActivePlayer();
        const activePlayerBox = document.getElementById('arenaActivePlayerName');
        if (activePlayerBox && activeP) {
            activePlayerBox.textContent = activeP.isAI ? `🤖 ${activeP.name}` : `👤 ${activeP.name}`;
        }

        // Backward compatibility for arenaTurnIndicator
        const turnInd = document.getElementById('arenaTurnIndicator');
        if (turnInd) {
            turnInd.innerHTML = `<strong>Turn ${currentGame.turn}</strong> • <span style="color: #a855f7;">${activeP ? activeP.name : ''}</span>`;
        }

        // Friendly phase display names
        const PHASE_DISPLAY_NAMES = {
            'UNTAP': 'Untap Step',
            'UPKEEP': 'Upkeep Step',
            'DRAW': 'Draw Step',
            'MAIN_1': 'Pre-Combat Main Phase',
            'MAIN1': 'Pre-Combat Main Phase',
            'COMBAT_BEGIN': 'Beginning of Combat',
            'DECLARE_ATTACKERS': 'Declare Attackers Step',
            'COMBAT_DECLARE_ATTACKERS': 'Declare Attackers Step',
            'DECLARE_BLOCKERS': 'Declare Blockers Step',
            'COMBAT_DECLARE_BLOCKERS': 'Declare Blockers Step',
            'COMBAT_DAMAGE': 'Combat Damage Step',
            'COMBAT_END': 'End of Combat',
            'MAIN_2': 'Post-Combat Main Phase',
            'MAIN2': 'Post-Combat Main Phase',
            'END_STEP': 'End Step',
            'END_OF_TURN': 'End Step',
            'CLEANUP': 'Cleanup Step'
        };

        const currentPhase = currentGame.currentPhase || 'MAIN_1';
        const phaseDetailChip = document.getElementById('arenaPhaseDetailChip');
        if (phaseDetailChip) {
            phaseDetailChip.textContent = `⚡ ${PHASE_DISPLAY_NAMES[currentPhase] || currentPhase}`;
        }

        // Map current engine phase into one of the ribbon categories:
        // UNTAP, UPKEEP, DRAW, MAIN_1, COMBAT, MAIN_2, END_STEP
        let activeRibbonCategory = 'MAIN_1';
        if (currentPhase === 'UNTAP') activeRibbonCategory = 'UNTAP';
        else if (currentPhase === 'UPKEEP') activeRibbonCategory = 'UPKEEP';
        else if (currentPhase === 'DRAW') activeRibbonCategory = 'DRAW';
        else if (currentPhase === 'MAIN_1' || currentPhase === 'MAIN1') activeRibbonCategory = 'MAIN_1';
        else if (currentPhase.includes('COMBAT') || currentPhase.includes('ATTACK') || currentPhase.includes('BLOCK')) activeRibbonCategory = 'COMBAT';
        else if (currentPhase === 'MAIN_2' || currentPhase === 'MAIN2') activeRibbonCategory = 'MAIN_2';
        else if (currentPhase === 'END_STEP' || currentPhase === 'END_OF_TURN' || currentPhase === 'CLEANUP') activeRibbonCategory = 'END_STEP';

        const phaseSequence = ['UNTAP', 'UPKEEP', 'DRAW', 'MAIN_1', 'COMBAT', 'MAIN_2', 'END_STEP'];
        const currentCatIdx = phaseSequence.indexOf(activeRibbonCategory);

        // Update Phase Step ribbons
        const phaseSteps = document.querySelectorAll('.arena-phase-step');
        phaseSteps.forEach(step => {
            const phaseAttr = step.getAttribute('data-phase');
            step.classList.remove('active', 'past');
            const stepIdx = phaseSequence.indexOf(phaseAttr);

            if (phaseAttr === activeRibbonCategory) {
                step.classList.add('active');
            } else if (stepIdx !== -1 && stepIdx < currentCatIdx) {
                step.classList.add('past');
            }
        });
    }

    function appendArenaLogs(newLogs = []) {
        const streamEl = document.getElementById('arenaLogStream');
        if (!streamEl || !newLogs || newLogs.length === 0) return;

        newLogs.forEach(entry => {
            const div = document.createElement('div');
            div.className = `log-entry ${entry.type || ''}`;
            div.innerHTML = formatMarkdown(entry.message || '');
            streamEl.appendChild(div);
        });

        streamEl.scrollTop = streamEl.scrollHeight;
    }

    function formatMarkdown(str) {
        return str
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getPlayerMaxHandSize(player) {
        if (!player) return 7;
        if (Array.isArray(player.battlefield)) {
            const hasUnlimitedHand = player.battlefield.some(c => {
                if (!c) return false;
                const n = (c.name || '').toLowerCase();
                const o = (c.oracleText || '').toLowerCase();
                return /no maximum hand size/i.test(o) ||
                    /reliquary tower|thought vessel|decanter of endless water|spellbook|venser's journal|kruphix, god of horizons|nezahal, primal tide|library of leng|ancient silver dragon/i.test(n);
            });
            if (hasUnlimitedHand) return Infinity;
        }
        return 7;
    }
    window.getPlayerMaxHandSize = getPlayerMaxHandSize;

    // ============================================================================
    // USER ACTIONS & INTERACTIVE CONTROLS
    // ============================================================================

    let pendingSpellTargetContext = null;

    function getCardTargetRequirement(card, abilityObj = null) {
        if (!card) return null;
        const nameLower = (card.name || '').toLowerCase();
        const textLower = abilityObj
            ? ((abilityObj.effectText || abilityObj.raw || '').toLowerCase())
            : ((card.oracleText || '').toLowerCase());

        if (abilityObj && abilityObj.type === 'EQUIP') {
            return {
                mode: 'FRIENDLY_CREATURE',
                title: `Equip ${card.name}`,
                subtitle: 'Choose a creature you control to attach this Equipment to:',
                effectDesc: card.oracleText || ''
            };
        }

        if (!abilityObj && (
            nameLower === 'reanimate' ||
            nameLower === 'zombify' ||
            nameLower === 'dread return' ||
            nameLower === 'victimize' ||
            nameLower === 'animate dead' ||
            nameLower === 'mortuary mire' ||
            /return target creature card from (?:your|a) graveyard/i.test(textLower)
        )) {
            const anyGy = nameLower === 'reanimate' || nameLower === 'animate dead' || /from a graveyard/i.test(textLower);
            return {
                mode: anyGy ? 'ANY_GRAVEYARD_CREATURE' : 'OWN_GRAVEYARD_CREATURE',
                title: `Target Graveyard Card — ${card.name}`,
                subtitle: anyGy ? 'Choose a creature card from any graveyard:' : 'Choose a creature card from your graveyard:',
                effectDesc: card.oracleText || ''
            };
        }

        if (abilityObj && /return target creature card from your graveyard/i.test(textLower)) {
            return {
                mode: 'OWN_GRAVEYARD_CREATURE',
                title: `Target Graveyard Creature — ${card.name}`,
                subtitle: 'Choose a creature card in your graveyard to return to the battlefield:',
                effectDesc: abilityObj.effectText || ''
            };
        }

        if (
            nameLower === 'swords to plowshares' ||
            nameLower === 'path to exile' ||
            nameLower === 'go for the throat' ||
            nameLower === 'infernal grasp' ||
            nameLower === 'murder' ||
            nameLower === 'terminate' ||
            nameLower === 'hurl through hell' ||
            nameLower === 'overseer of the damned' ||
            nameLower === 'ravenous chupacabra' ||
            nameLower === 'eater of hope' ||
            nameLower === 'dark salvation' ||
            (!abilityObj && /destroy target (?:non[a-z-]+ )?creature|exile target creature/i.test(textLower))
        ) {
            return {
                mode: 'OPPONENT_CREATURE',
                title: `Choose Target Creature — ${card.name}`,
                subtitle: 'Select an opponent\'s creature to target:',
                effectDesc: abilityObj ? abilityObj.effectText : (card.oracleText || '')
            };
        }

        if (nameLower === 'feed the swarm') {
            return {
                mode: 'OPPONENT_CREATURE_OR_ENCHANTMENT',
                title: `Choose Target — ${card.name}`,
                subtitle: 'Select target creature or enchantment an opponent controls:',
                effectDesc: card.oracleText || ''
            };
        }

        if (nameLower === 'reclamation sage' || /destroy target artifact or enchantment/i.test(textLower)) {
            return {
                mode: 'OPPONENT_ARTIFACT_OR_ENCHANTMENT',
                title: `Choose Target — ${card.name}`,
                subtitle: 'Select target artifact or enchantment an opponent controls:',
                effectDesc: card.oracleText || ''
            };
        }

        if (
            nameLower === 'beast within' ||
            nameLower === 'generous gift' ||
            nameLower === 'chaos warp' ||
            nameLower === 'meteor golem' ||
            nameLower === 'cyclonic rift' ||
            nameLower === 'putrefy' ||
            nameLower === 'mortify' ||
            nameLower === 'bedevil' ||
            nameLower === 'abrupt decay' ||
            nameLower === 'assassin\'s trophy' ||
            nameLower === 'hero\'s downfall' ||
            nameLower === 'dreadbore'
        ) {
            return {
                mode: 'OPPONENT_PERMANENT',
                title: `Choose Target Permanent — ${card.name}`,
                subtitle: 'Select an opponent\'s permanent to target:',
                effectDesc: card.oracleText || ''
            };
        }

        return null;
    }
    window.getCardTargetRequirement = getCardTargetRequirement;

    function getLegalTargetsForRequirement(req) {
        if (!currentGame || !req) return [];
        const p0 = currentGame.players[0];
        const targets = [];

        if (req.mode === 'FRIENDLY_CREATURE') {
            (p0.battlefield || []).filter(c => c.isCreature).forEach(c => {
                targets.push({
                    cardId: c.id,
                    playerIndex: 0,
                    label: `${c.name} (${p0.getEffectivePower ? p0.getEffectivePower(c) : c.power}/${p0.getEffectiveToughness ? p0.getEffectiveToughness(c) : c.toughness})`,
                    sublabel: `Your Creature • ${c.typeLine || 'Creature'}`,
                    cardName: c.name
                });
            });
            return targets;
        }

        if (req.mode === 'OWN_GRAVEYARD_CREATURE' || req.mode === 'ANY_GRAVEYARD_CREATURE') {
            const pools = req.mode === 'ANY_GRAVEYARD_CREATURE' ? currentGame.players : [p0];
            pools.forEach((pl, idx) => {
                (pl.graveyard || []).filter(c => c.isCreature).forEach(c => {
                    targets.push({
                        cardId: c.id,
                        playerIndex: idx,
                        label: `${c.name} (${c.power || 0}/${c.toughness || 0})`,
                        sublabel: `${pl.name}'s Graveyard • ${c.typeLine || 'Creature'}`,
                        cardName: c.name
                    });
                });
            });
            return targets;
        }

        currentGame.players.forEach((pl, idx) => {
            if (!pl || !pl.isAlive || idx === 0) return;
            (pl.battlefield || []).forEach(c => {
                let valid = false;
                if (req.mode === 'OPPONENT_CREATURE') valid = Boolean(c.isCreature);
                else if (req.mode === 'OPPONENT_CREATURE_OR_ENCHANTMENT') valid = Boolean(c.isCreature || c.isEnchantment);
                else if (req.mode === 'OPPONENT_ARTIFACT_OR_ENCHANTMENT') valid = Boolean(c.isArtifact || c.isEnchantment);
                else if (req.mode === 'OPPONENT_PERMANENT') valid = !c.isLand || /beast within|generous gift|chaos warp|assassin's trophy/i.test(req.title);
                if (valid) {
                    const stats = c.isCreature ? ` (${pl.getEffectivePower ? pl.getEffectivePower(c) : c.power}/${pl.getEffectiveToughness ? pl.getEffectiveToughness(c) : c.toughness})` : '';
                    targets.push({
                        cardId: c.id,
                        playerIndex: idx,
                        label: `${c.name}${stats}`,
                        sublabel: `Controlled by ${pl.name} • ${c.typeLine || 'Permanent'}`,
                        cardName: c.name
                    });
                }
            });
        });
        return targets;
    }

    window.openSpellTargetModal = function (card, req, onSelectCallback) {
        const targets = getLegalTargetsForRequirement(req);
        if (targets.length === 0) {
            // If no explicit targets on board (e.g. ETB creature cast onto empty opponent board), proceed without target
            onSelectCallback(null);
            return;
        }
        pendingSpellTargetContext = { card, req, targets, onSelectCallback };
        const modal = document.getElementById('arenaSpellTargetModal');
        const thumb = document.getElementById('spellTargetThumb');
        const titleEl = document.getElementById('spellTargetTitle');
        const subEl = document.getElementById('spellTargetSubtitle');
        const descEl = document.getElementById('spellTargetEffectDesc');
        const listEl = document.getElementById('spellTargetOptionsList');

        if (!modal || !listEl) {
            onSelectCallback(targets[0]);
            return;
        }

        if (thumb) thumb.src = getCardArtCropUrl(card.name);
        if (titleEl) titleEl.textContent = req.title || `Target for ${card.name}`;
        if (subEl) subEl.textContent = req.subtitle || 'Select a target:';
        if (descEl) descEl.textContent = req.effectDesc || '';

        listEl.innerHTML = targets.map((t, i) => `
            <div onclick="window.confirmSpellTargetSelection(${i})"
                 style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(168, 85, 247, 0.4); border-radius: 10px; cursor: pointer; transition: all 0.15s;"
                 onmouseenter="this.style.borderColor='#c084fc'; this.style.background='rgba(88, 28, 135, 0.35)';"
                 onmouseleave="this.style.borderColor='rgba(168, 85, 247, 0.4)'; this.style.background='rgba(30, 41, 59, 0.85)';">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <img src="${getCardArtCropUrl(t.cardName)}" style="width: 42px; height: 42px; border-radius: 6px; object-fit: cover; border: 1px solid #64748b;" onerror="this.onerror=null; this.src='https://cards.scryfall.io/back.png';" />
                    <div>
                        <div style="font-weight: 800; font-size: 0.92rem; color: #f8fafc;">🎯 ${escapeHtml(t.label)}</div>
                        <div style="font-size: 0.74rem; color: #cbd5e1;">${escapeHtml(t.sublabel)}</div>
                    </div>
                </div>
                <button class="arena-btn arena-btn-gold" style="font-size: 0.76rem; padding: 5px 12px;">Select Target</button>
            </div>
        `).join('');

        modal.style.display = 'flex';
    };

    window.closeSpellTargetModal = function () {
        const modal = document.getElementById('arenaSpellTargetModal');
        if (modal) modal.style.display = 'none';
        pendingSpellTargetContext = null;
    };

    window.confirmSpellTargetSelection = function (idx) {
        if (!pendingSpellTargetContext) return;
        const chosen = pendingSpellTargetContext.targets[idx] || null;
        const cb = pendingSpellTargetContext.onSelectCallback;
        window.closeSpellTargetModal();
        if (typeof cb === 'function') {
            cb(chosen);
        }
    };

    window.playCardFromHand = async function (cardId, preselectedTarget = undefined) {
        if (!currentGame) return;
        const player = currentGame.players[0];
        const activePlayer = currentGame.getActivePlayer();

        const card = player.hand.find(c => c.id === cardId || String(c.id) === String(cardId));
        if (!card) return;

        const isLand = card.isLand || (typeof window !== 'undefined' && typeof window.isLandCard === 'function' && window.isLandCard(card));
        if (isLand) {
            card.isLand = true;
            if (!card.typeLine || !card.typeLine.toLowerCase().includes('land')) card.typeLine = 'Land';
            card.cmc = 0;
            card.manaCost = '';
        }

        const isInstantOrFlash = !isLand && (card.isInstant || (card.keywords && card.keywords.has('flash')));
        const isMainPhase = currentGame.currentPhase === 'MAIN_1' || currentGame.currentPhase === 'MAIN_2' || currentGame.currentPhase === 'MAIN1' || currentGame.currentPhase === 'MAIN2';

        // Rule checks
        if (isLand) {
            const hasPlayedLand = Boolean(player.landPlayedThisTurn) || Boolean(player.landsPlayedCount && player.landsPlayedCount >= 1);
            if (activePlayer.id !== player.id) {
                alert("You can only play lands during your own turn!");
                return;
            }
            if (!isMainPhase) {
                alert("Lands can only be played during your Main phase (MTG Rule 305.1).");
                return;
            }
            if (hasPlayedLand) {
                alert("You have already played a land this turn (MTG Rule 305.2).");
                return;
            }
        } else if (!isInstantOrFlash) {
            if (activePlayer.id !== player.id) {
                alert(`You can only cast Instants or cards with Flash on an opponent's turn! (${card.name} is a ${card.typeLine}).`);
                return;
            }
            if (!isMainPhase) {
                alert("Sorceries and permanent spells can only be cast during your Main phase (MTG Rule 307.1).");
                return;
            }
        }

        if (!isLand) {
            const cost = player.getCardCost(card, currentGame);
            const available = player.getAvailableMana().total;
            if (available < cost) {
                alert(`Cannot cast ${card.name}: Need {${cost}} mana in floating pool, but you currently have only {${available}}!\n\n💡 Tap your lands or mana rocks in the "Mana & Support Line" to produce mana first.`);
                return;
            }
        }

        // Check if this spell or ETB permanent requires interactive target selection
        if (preselectedTarget === undefined) {
            const targetReq = getCardTargetRequirement(card);
            if (targetReq) {
                const legalTargets = getLegalTargetsForRequirement(targetReq);
                if (legalTargets.length > 0) {
                    window.openSpellTargetModal(card, targetReq, (chosenTarget) => {
                        window.playCardFromHand(cardId, chosenTarget);
                    });
                    return;
                } else if (card.isInstant || card.isSorcery) {
                    alert(`Cannot cast ${card.name}: No legal targets on the battlefield or in graveyards!`);
                    return;
                }
            }
        }

        // Auto-pause bot runner if playing an instant during bot turn so user can observe the resolution
        if (activePlayer.id !== player.id && !isPaused) {
            window.toggleArenaPlayPause();
        }

        // Visual stack popup animation
        const stackBox = document.getElementById('arenaStackBox');
        const stackThumb = document.getElementById('stackCardThumb');
        const stackName = document.getElementById('stackSpellName');
        if (stackBox && stackThumb && stackName) {
            stackThumb.src = getCardArtCropUrl(card.name);
            stackName.textContent = isInstantOrFlash && activePlayer.id !== player.id ? `⚡ Instant: ${card.name}` : card.name;
            stackBox.style.display = 'flex';
            setTimeout(() => {
                if (stackBox) stackBox.style.display = 'none';
            }, 650);
        }

        let payShockLife = undefined;
        const cNameLower = (card.name || '').toLowerCase();
        const cOracleLower = (card.oracleText || '').toLowerCase();
        const isShock = /watery grave|blood crypt|stomping ground|breeding pool|overgrown tomb|hallowed fountain|godless shrine|steam vents|sacred foundry|temple garden/i.test(cNameLower) ||
            /you may pay 2 life/i.test(cOracleLower);
        const isBlackGate = cNameLower.includes('black gate') || /you may pay 3 life/i.test(cOracleLower);
        if (isShock && player.life > 2) {
            payShockLife = window.confirm(`⚡ Pay 2 life to have ${card.name} enter the battlefield untapped?\n\n(Click Cancel for ${card.name} to enter tapped)`);
        } else if (isBlackGate && player.life > 3) {
            payShockLife = window.confirm(`⚡ Pay 3 life to have ${card.name} enter the battlefield untapped?\n\n(Click Cancel for ${card.name} to enter tapped)`);
        }

        const spellCost = !isLand ? player.getCardCost(card, currentGame) : 0;
        let res = null;
        if (currentGame.playCard) {
            res = await currentGame.playCard(cardId, { targetInfo: preselectedTarget || null, payShockLife });
        } else {
            res = player.castCard(cardId, currentGame, { targetInfo: preselectedTarget || null });
            if (spellCost > 0 && typeof player.deductMana === 'function') {
                player.deductMana(spellCost);
            }
        }
        if (res && !res.success) {
            alert(res.message);
            return;
        }

        if (isLand) {
            player.landPlayedThisTurn = true;
            player.landsPlayedCount = (player.landsPlayedCount || 0) + 1;
            if (currentGame && currentGame.players && currentGame.players[0]) {
                currentGame.players[0].landPlayedThisTurn = true;
                currentGame.players[0].landsPlayedCount = (currentGame.players[0].landsPlayedCount || 0) + 1;
            }
        }

        if (res && res.logs) appendArenaLogs(res.logs);

        // If this card is a ramp spell, ETB land-fetcher (Solemn Simulacrum, Farhaven Elf, Wood Elves, Springbloom Druid), or Tutor, open the interactive Library Search Modal!
        const isRampOrFetchETB = !isLand && (
            card.isRampSpell ||
            /cultivate|kodama's reach|rampant growth|farseek|nature's lore|three visits|migration path|skyshroud claim|solemn simulacrum|farhaven elf|springbloom druid|wood elves/i.test(cNameLower) ||
            (/search your library for a.*land card/i.test(cOracleLower) && !card.isArtifact)
        );
        const isTutor = !isLand && !isRampOrFetchETB && (
            card.isTutorSpell ||
            /demonic tutor|diabolic tutor|grim tutor|vampiric tutor|profane tutor/i.test(cNameLower)
        );

        if (isRampOrFetchETB) {
            const isCultivateLike = /cultivate|kodama's reach/i.test(cNameLower);
            const isTwoToField = /migration path|skyshroud claim/i.test(cNameLower);
            const isUntappedRamp = /nature's lore|three visits|skyshroud claim/i.test(cNameLower);
            window.openFetchLandModal(card.id, {
                manaCostNum: 0,
                lifeCostNum: 0,
                fetchCount: (isCultivateLike || isTwoToField) ? 2 : 1,
                toBattlefieldCount: isTwoToField ? 2 : 1,
                toHandCount: isCultivateLike ? 1 : 0,
                entersTapped: !isUntappedRamp,
                isSpellSearch: true,
                sourceName: card.name,
                costText: '',
                effectText: card.oracleText || ''
            });
        } else if (isTutor) {
            window.openFetchLandModal(card.id, {
                manaCostNum: 0,
                lifeCostNum: 0,
                fetchCount: 1,
                toBattlefieldCount: 0,
                toHandCount: 1,
                isTutorToHand: true,
                toTopOfLibrary: cNameLower.includes('vampiric tutor'),
                isSpellSearch: true,
                sourceName: card.name,
                costText: '',
                effectText: card.oracleText || ''
            });
        }

        updateArenaDOM();
    };

    window.castPlayerCommander = async function () {
        if (!currentGame) return;
        const player = currentGame.players[0];
        const activePlayer = currentGame.getActivePlayer();
        const cmdr = player.getCommander();

        if (!cmdr) {
            alert("No Commander assigned to your deck!");
            return;
        }

        if (player.isCommanderOnBattlefield()) {
            alert(`**${cmdr.name}** is already on the battlefield!`);
            return;
        }

        if (activePlayer.id !== player.id) {
            alert("You can only cast your Commander during your turn!");
            return;
        }

        const isMainPhase = currentGame.currentPhase === 'MAIN_1' || currentGame.currentPhase === 'MAIN_2' || currentGame.currentPhase === 'MAIN1' || currentGame.currentPhase === 'MAIN2';
        if (!isMainPhase) {
            alert("Commanders can only be cast during a Main phase (MTG Rule 305.1 / 903.8).");
            return;
        }

        const totalCost = (cmdr.cmc || 0) + player.commanderTax;
        const available = player.getAvailableMana().total;
        if (available < totalCost) {
            alert(`Need {${totalCost}} mana to cast ${cmdr.name} (Base: {${cmdr.cmc || 0}}, Tax: {${player.commanderTax}}), but you currently have only {${available}} floating mana in your pool!\n\n💡 Tap your lands or rocks first to add mana to your pool.`);
            return;
        }

        // Visual stack popup animation
        const stackBox = document.getElementById('arenaStackBox');
        const stackThumb = document.getElementById('stackCardThumb');
        const stackName = document.getElementById('stackSpellName');
        if (stackBox && stackThumb && stackName) {
            stackThumb.src = getCardArtCropUrl(cmdr.name);
            stackName.textContent = `👑 Casting Commander: ${cmdr.name}`;
            stackBox.style.display = 'flex';
            setTimeout(() => {
                if (stackBox) stackBox.style.display = 'none';
            }, 750);
        }

        let res = null;
        if (currentGame.castCommander) {
            res = await currentGame.castCommander();
        } else {
            res = player.castCommander(currentGame);
            if (totalCost > 0 && typeof player.deductMana === 'function') {
                player.deductMana(totalCost);
            }
        }
        if (res && !res.success) {
            alert(res.message);
            return;
        }

        if (res && res.logs) appendArenaLogs(res.logs);
        updateArenaDOM();
    };

    // ============================================================================
    // ACTIVATED ABILITIES & MANA SELECTION SYSTEM
    // ============================================================================
    let currentManaChoiceCard = null;
    let currentManaChoiceOptions = [];

    window.openManaChoiceModal = function (card, manaInfo) {
        currentManaChoiceCard = card;
        currentManaChoiceOptions = manaInfo.options;

        const modal = document.getElementById('arenaManaChoiceModal');
        const nameEl = document.getElementById('manaChoiceCardName');
        const subEl = document.getElementById('manaChoiceCardSub');
        const listEl = document.getElementById('manaChoiceOptionsList');

        if (!modal || !listEl) return;

        if (nameEl) nameEl.textContent = `Tap ${card.name} for Mana`;
        if (subEl) subEl.textContent = manaInfo.options.length > 1
            ? 'Choose which mana color or option you would like to produce:'
            : 'Confirm tapping this permanent:';

        listEl.innerHTML = currentManaChoiceOptions.map((opt, idx) => {
            const colorClass = opt.colors && opt.colors.length === 1 ? opt.colors[0].toLowerCase() : (opt.colors && opt.colors.length > 1 ? 'multi' : 'c');
            let costBadge = '';
            if (opt.cost) {
                if (opt.cost.life) costBadge = `<span class="mana-choice-cost-badge">Pay ${opt.cost.life} Life</span>`;
                if (opt.cost.mana) costBadge = `<span class="mana-choice-cost-badge">Pay {${opt.cost.mana}} Mana</span>`;
                if (opt.cost.sacrificeSelf) costBadge = `<span class="mana-choice-cost-badge">Sacrifice</span>`;
            }
            const pipsHtml = (opt.colors || []).map(col => `<span class="mana-pip mana-pip-${col.toLowerCase()}">${col}</span>`).join('');

            return `
                <button class="mana-choice-btn ${colorClass}" onclick="window.applyManaOption(${idx})">
                    <div class="mana-pip-row">
                        ${pipsHtml}
                    </div>
                    <div class="mana-choice-desc">${escapeHtml(opt.desc)}</div>
                    ${costBadge}
                </button>
            `;
        }).join('');

        modal.style.display = 'flex';
    };

    window.closeManaChoiceModal = function () {
        const modal = document.getElementById('arenaManaChoiceModal');
        if (modal) modal.style.display = 'none';
        currentManaChoiceCard = null;
        currentManaChoiceOptions = [];
    };

    window.applyManaOption = function (optionIndex) {
        if (!currentGame || !currentManaChoiceCard || !currentManaChoiceOptions[optionIndex]) {
            window.closeManaChoiceModal();
            return;
        }

        const player = currentGame.players[0];
        const card = currentManaChoiceCard;
        const option = currentManaChoiceOptions[optionIndex];

        // 1. Verify and deduct costs
        if (option.cost) {
            if (option.cost.life) {
                if (player.life <= option.cost.life) {
                    alert(`Cannot pay ${option.cost.life} life! You only have ${player.life} life.`);
                    return;
                }
                player.life -= option.cost.life;
                card.paidLifeCost = (card.paidLifeCost || 0) + option.cost.life;
                appendArenaLogs([{
                    type: 'LIFE_PAID',
                    message: `💔 **${player.name}** paid **${option.cost.life} life** to tap **${card.name}**.`
                }]);
            }
            if (option.cost.mana) {
                const avail = player.getAvailableMana().total;
                if (avail < option.cost.mana) {
                    alert(`Cannot pay {${option.cost.mana}} mana activation cost! You have ${avail} mana.`);
                    return;
                }
                player.tapMana(option.cost.mana);
                appendArenaLogs([{
                    type: 'MANA_PAID',
                    message: `💎 **${player.name}** paid **{${option.cost.mana}} mana** to filter with **${card.name}**.`
                }]);
            }
            if (option.cost.sacrificeSelf) {
                if (typeof player.sendToGraveyardOrCommandZone === 'function') {
                    player.sendToGraveyardOrCommandZone(card, currentGame, false);
                } else if (Array.isArray(player.battlefield)) {
                    player.battlefield = player.battlefield.filter(c => String(c.id) !== String(card.id));
                }
            }
        }

        // 2. Tap card and add mana
        card.tapped = true;
        if (!option.cost || !option.cost.sacrificeSelf) {
            card.producedMana = [...option.colors];
        }

        if (!player.manaPool) {
            player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        }
        option.colors.forEach(col => {
            player.manaPool[col] = (player.manaPool[col] || 0) + 1;
        });

        window.closeManaChoiceModal();

        const pipsStr = option.colors.map(c => `{${c}}`).join('');
        appendArenaLogs([{
            type: 'MANA_TAPPED',
            message: `💎 **${player.name}** ${option.cost && option.cost.sacrificeSelf ? 'sacrificed' : 'tapped'} **${card.name}** and added **${pipsStr}** to mana pool.`
        }]);

        updateArenaDOM();
    };

    let currentAbilityCard = null;
    let currentCardAbilities = [];

    window.openCardAbilityModal = function (cardId) {
        if (!currentGame) return;
        const player = currentGame.players[0];
        const card = player.battlefield.find(c => String(c.id) === String(cardId));
        if (!card) return;

        currentAbilityCard = card;
        const abilities = parseActivatedAbilities(card);
        currentCardAbilities = abilities;

        const modal = document.getElementById('arenaCardAbilityModal');
        const thumb = document.getElementById('abilityCardThumb');
        const nameEl = document.getElementById('abilityCardName');
        const typeEl = document.getElementById('abilityCardTypeLine');
        const statusEl = document.getElementById('abilityCardStatus');
        const listEl = document.getElementById('abilityOptionsList');

        if (!modal || !listEl) return;

        if (thumb) thumb.src = getCardArtCropUrl(card.name);
        if (nameEl) nameEl.textContent = card.name;
        if (typeEl) typeEl.textContent = card.typeLine || 'Permanent';
        if (statusEl) {
            let statusText = card.tapped ? '🔴 Tapped' : '🟢 Untapped';
            if (card.summoningSick && card.isCreature) statusText += ' • 🌀 Summoning Sick';
            if (card.loyalty !== undefined) statusText += ` • 🛡️ Loyalty: ${card.loyalty}`;
            statusEl.textContent = statusText;
        }

        const manaInfo = getPermanentManaAbilities(card);
        let manaRowHtml = '';
        if (manaInfo && !card.tapped) {
            const opt = manaInfo.options[0] || { colors: ['C'] };
            const pips = opt.colors.map(c => '{' + c + '}').join('');
            manaRowHtml = `
                <div class="ability-option-row" style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
                            <span class="ability-cost-tag tap" style="background: rgba(16, 185, 129, 0.2); color: #34d399; font-weight: 800; font-size: 0.72rem; padding: 2px 8px; border-radius: 4px;">{T} Mana Ability</span>
                        </div>
                        <div class="ability-effect-text" style="font-size: 0.82rem; color: #f1f5f9;">Add <strong>${pips}</strong> to your mana pool.</div>
                    </div>
                    <button class="arena-btn arena-btn-gold"
                            style="white-space: nowrap; font-size: 0.82rem; padding: 6px 14px; font-weight: 800;"
                            onclick="window.closeCardAbilityModal(); window.applyPermanentManaTap('${card.id}')">
                        💎 Tap for Mana
                    </button>
                </div>
            `;
        }

        if (abilities.length === 0) {
            listEl.innerHTML = manaRowHtml || `
                <div style="font-size: 0.85rem; color: #94a3b8; padding: 12px; text-align: center; background: rgba(0,0,0,0.25); border-radius: 8px;">
                    This permanent has no explicit activated abilities.
                </div>
            `;
        } else {
            const availMana = player.getAvailableMana().total;
            listEl.innerHTML = manaRowHtml + abilities.map((ab, idx) => {
                let badgeClass = 'activated';
                let typeLabel = 'Activated';
                if (ab.type === 'LOYALTY') {
                    badgeClass = 'loyalty';
                    typeLabel = `Loyalty ${ab.costText}`;
                } else if (ab.type === 'EQUIP') {
                    badgeClass = 'equip';
                    typeLabel = 'Equip';
                } else if (ab.requiresTap) {
                    badgeClass = 'tap';
                    typeLabel = '{T} Tap Ability';
                }

                // Check if currently payable / usable
                let canPay = true;
                let disabledReason = '';

                if (ab.requiresTap && card.tapped) {
                    canPay = false;
                    disabledReason = 'Card is tapped';
                }
                if (ab.requiresTap && card.isCreature && card.summoningSick && (!card.keywords || !card.keywords.has('haste'))) {
                    canPay = false;
                    disabledReason = 'Summoning sick';
                }
                if (ab.manaCostNum > 0 && availMana < ab.manaCostNum) {
                    canPay = false;
                    disabledReason = `Need {${ab.manaCostNum}} mana (Have {${availMana}})`;
                }
                if (ab.type === 'LOYALTY') {
                    if (card._loyaltyUsedThisTurn) {
                        canPay = false;
                        disabledReason = 'Loyalty ability already used this turn';
                    } else if (ab.loyaltyDelta < 0) {
                        const curLoyalty = card.loyalty !== undefined ? card.loyalty : 0;
                        if (curLoyalty + ab.loyaltyDelta < 0) {
                            canPay = false;
                            disabledReason = `Not enough loyalty counters`;
                        }
                    }
                }

                return `
                    <div class="ability-option-row">
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                <span class="ability-cost-tag ${badgeClass}">${typeLabel}: ${escapeHtml(ab.costText)}</span>
                                ${disabledReason ? `<span style="font-size: 0.68rem; color: #ef4444; font-weight: 700;">⚠️ ${disabledReason}</span>` : ''}
                            </div>
                            <div class="ability-effect-text">${escapeHtml(ab.effectText || ab.raw)}</div>
                        </div>
                        <button class="arena-btn ${canPay ? 'arena-btn-gold' : ''}"
                                style="white-space: nowrap; font-size: 0.78rem; padding: 6px 12px; align-self: center;"
                                ${canPay ? '' : 'disabled style="opacity: 0.5; cursor: not-allowed;"'}
                                onclick="window.executeCardAbility(${idx})">
                            ⚡ Activate
                        </button>
                    </div>
                `;
            }).join('');
        }

        modal.style.display = 'flex';
    };

    window.closeCardAbilityModal = function () {
        const modal = document.getElementById('arenaCardAbilityModal');
        if (modal) modal.style.display = 'none';
        currentAbilityCard = null;
        currentCardAbilities = [];
    };

    window.executeCardAbility = async function (abilityIndex, preselectedTarget = undefined, savedCardRef = null, savedAbRef = null) {
        const card = savedCardRef || currentAbilityCard;
        const ab = savedAbRef || (currentCardAbilities ? currentCardAbilities[abilityIndex] : null);
        if (!currentGame || !card || !ab) {
            window.closeCardAbilityModal();
            return;
        }

        const player = currentGame.players[0];

        // 1. Validate requirements
        if (ab.requiresTap && card.tapped) {
            alert(`**${card.name}** is already tapped!`);
            return;
        }
        if (ab.requiresTap && card.isCreature && card.summoningSick && (!card.keywords || !card.keywords.has('haste'))) {
            alert(`**${card.name}** has summoning sickness and cannot tap to activate abilities this turn!`);
            return;
        }
        if (ab.manaCostNum > 0) {
            const avail = player.getAvailableMana().total;
            if (avail < ab.manaCostNum) {
                alert(`Not enough mana to activate this ability. Need {${ab.manaCostNum}}, have {${avail}}.`);
                return;
            }
        }

        // Close modal immediately
        window.closeCardAbilityModal();

        // Check if this is a fetchland/search library ability (e.g. Terramorphic Expanse, Evolving Wilds, Shire Terrace, Myriad Landscape, Wayfarer's Bauble, etc.)
        const effectLower = (ab.effectText || '').toLowerCase();
        const costLower = (ab.costText || '').toLowerCase();
        const isFetchAbility = (ab.requiresSacrifice || costLower.includes('sacrifice')) &&
            effectLower.includes('search your library') &&
            (effectLower.includes('basic land') || effectLower.includes('land card') || effectLower.includes('forest') || effectLower.includes('plains') || effectLower.includes('island') || effectLower.includes('swamp') || effectLower.includes('mountain'));

        if (isFetchAbility) {
            const lifeCostMatch = costLower.match(/pay\s+(\d+)\s+life/i);
            const lifeCostNum = lifeCostMatch ? (parseInt(lifeCostMatch[1], 10) || 0) : 0;
            const fetchCount = /two\s+basic\s+land/i.test(effectLower) || /forest card and a basic plains/i.test(effectLower) ? 2 : 1;
            window.openFetchLandModal(card.id, {
                manaCostNum: ab.manaCostNum || 0,
                lifeCostNum,
                fetchCount,
                costText: ab.costText || '',
                effectText: ab.effectText || ''
            });
            return;
        }

        // Check if this ability requires interactive target selection (e.g. Equip, Liliana -3, Targeted removal)
        if (preselectedTarget === undefined) {
            const targetReq = getCardTargetRequirement(card, ab);
            if (targetReq) {
                const legalTargets = getLegalTargetsForRequirement(targetReq);
                if (legalTargets.length === 0) {
                    alert(`Cannot activate ${card.name}: No legal target available!`);
                    return;
                }
                window.openSpellTargetModal(card, targetReq, (chosenTarget) => {
                    window.executeCardAbility(abilityIndex, chosenTarget, card, ab);
                });
                return;
            }
        }

        // Visual stack popup animation (MTG Stack Resolution)
        const stackBox = document.getElementById('arenaStackBox');
        const stackThumb = document.getElementById('stackCardThumb');
        const stackName = document.getElementById('stackSpellName');
        if (stackBox && stackThumb && stackName) {
            stackThumb.src = getCardArtCropUrl(card.name);
            stackName.textContent = `⚡ Ability: ${card.name}`;
            stackBox.style.display = 'flex';
        }

        // Delegate to Forge Engine if active
        if (typeof currentGame.activateAbility === 'function') {
            if (ab.manaCostNum > 0) {
                if (typeof player.deductMana === 'function') player.deductMana(ab.manaCostNum);
                else if (typeof player.tapMana === 'function') player.tapMana(ab.manaCostNum);
            }
            if (ab.requiresTap) {
                card.tapped = true;
            }
            const res = await currentGame.activateAbility(card.id, abilityIndex, {
                isEquip: ab.type === 'EQUIP',
                targetInfo: preselectedTarget || null,
                abilityObj: ab
            });
            if (res && res.logs && res.logs.length > 0) {
                appendArenaLogs(res.logs);
            }
            const pAfter = currentGame.players[0];
            if (pAfter && ab.requiresTap) {
                const cAfter = pAfter.battlefield.find(c => String(c.id) === String(card.id));
                if (cAfter) cAfter.tapped = true;
            }
        } else {
            // Local fallback simulation
            if (ab.manaCostNum > 0) {
                player.tapMana(ab.manaCostNum);
            }
            if (ab.requiresTap) {
                card.tapped = true;
            }
            if (ab.type === 'LOYALTY' && ab.loyaltyDelta !== undefined) {
                card.loyalty = (card.loyalty !== undefined ? card.loyalty : 4) + ab.loyaltyDelta;
            }

            const logs = [{
                type: 'ABILITY_ACTIVATED',
                message: `⚡ **${player.name}** activated ability of **${card.name}** [${ab.costText}]: *${ab.effectText}*`
            }];
            appendArenaLogs(logs);
        }

        await new Promise(resolve => setTimeout(resolve, 650));
        if (stackBox) stackBox.style.display = 'none';

        updateArenaDOM();
    };

    window.handleCreatureClick = function (cardId) {
        if (!currentGame) return;
        const currentPhase = currentGame.currentPhase;
        const player = currentGame.players[0];
        const card = player.battlefield.find(c => c.id === cardId);
        if (!card) return;

        if (currentPhase === 'DECLARE_ATTACKERS' || currentPhase === 'COMBAT_DECLARE_ATTACKERS') {
            if (card.tapped && !selectedAttackerIds.has(cardId)) {
                alert(`Cannot declare ${card.name} as an attacker: It is already tapped! (MTG Rule 508.1a)`);
                return;
            }
            window.openAttackTargetPicker(cardId);
            return;
        }

        const abils = parseActivatedAbilities(card);
        if (abils.length > 0) {
            window.openCardAbilityModal(cardId);
        } else {
            if (card.tapped) {
                alert(`⚠️ ${card.name} is tapped. Permanents remain tapped until your next Untap Step (MTG Rule 502.2).`);
                return;
            }
            window.toggleAttackerSelection(cardId);
        }
    };

    window.handlePermanentClick = async function (cardId) {
        if (!currentGame) return;
        const player = currentGame.players[0];
        const card = player.battlefield.find(c => c.id === cardId);
        if (!card) return;

        // If already tapped, permanents CANNOT be arbitrarily untapped!
        if (card.tapped) {
            const hasUnspentFloatingMana = card.producedMana && card.producedMana.length > 0 &&
                player.manaPool && card.producedMana.every(col => (player.manaPool[col] || 0) > 0);

            if (hasUnspentFloatingMana) {
                card.tapped = false;
                card.producedMana.forEach(col => {
                    player.manaPool[col] = Math.max(0, (player.manaPool[col] || 0) - 1);
                });
                card.producedMana = null;
                card.paidLifeCost = null;

                appendArenaLogs([{
                    type: 'MANA_UNDO',
                    message: `↩️ **${player.name}** canceled unspent floating mana from **${card.name}**.`
                }]);
                updateArenaDOM();
                return;
            }

            alert(`⚠️ **${card.name}** is tapped!\n\nIn Magic: The Gathering (Rule 502.2), permanents remain tapped until your next Untap Step, unless untapped by a spell or card ability.`);
            return;
        }

        const abilities = parseActivatedAbilities(card);
        const nameLower = (card.name || '').toLowerCase();
        const isFetchLand = nameLower.includes('terramorphic') || nameLower.includes('evolving wilds') ||
            nameLower.includes('fabled passage') || nameLower.includes('prismatic vista') ||
            nameLower.includes('shire terrace') || nameLower.includes('promising vein') ||
            nameLower.includes('myriad landscape') ||
            abilities.some(ab => (ab.effectText || '').toLowerCase().includes('search your library') && (ab.requiresSacrifice || /sacrifice/i.test(ab.costText)));

        const manaInfo = getPermanentManaAbilities(card);

        // If card has activated abilities (e.g. Shire Terrace, Myriad Landscape, Planeswalker, Utility artifact/land):
        if (abilities.length > 0) {
            window.openCardAbilityModal(cardId);
            return;
        }

        if (isFetchLand) {
            window.openFetchLandModal(cardId);
            return;
        }

        // Tap for mana if pure mana producer
        if (manaInfo) {
            const hasCost = manaInfo.options.some(o => o.cost);
            if (manaInfo.isMulti || hasCost || manaInfo.options.length > 1) {
                window.openManaChoiceModal(card, manaInfo);
                return;
            }

            // Single option
            const option = manaInfo.options[0];
            card.tapped = true;
            card.producedMana = [...option.colors];

            if (!player.manaPool) {
                player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
            }
            option.colors.forEach(col => {
                player.manaPool[col] = (player.manaPool[col] || 0) + 1;
            });

            const pipsStr = option.colors.map(c => `{${c}}`).join('');
            appendArenaLogs([{
                type: 'MANA_TAPPED',
                message: `💎 **${player.name}** tapped **${card.name}** and added **${pipsStr}** to mana pool.`
            }]);
            updateArenaDOM();
            return;
        }

        alert(`**${card.name}** does not have a tap ability.`);
    };

        window.applyPermanentManaTap = function (cardId) {
        if (!currentGame) return;
        const player = currentGame.players[0];
        const card = player.battlefield.find(c => String(c.id) === String(cardId));
        if (!card || card.tapped) return;
        const manaInfo = getPermanentManaAbilities(card);
        if (!manaInfo) return;
        if (manaInfo.isMulti || manaInfo.options.length > 1) {
            window.openManaChoiceModal(card, manaInfo);
            return;
        }
        const option = manaInfo.options[0];
        card.tapped = true;
        card.producedMana = [...option.colors];
        if (!player.manaPool) {
            player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        }
        option.colors.forEach(col => {
            player.manaPool[col] = (player.manaPool[col] || 0) + 1;
        });
        const pipsStr = option.colors.map(c => '{' + c + '}').join('');
        appendArenaLogs([{
            type: 'MANA_TAPPED',
            message: '💎 **' + player.name + '** tapped **' + card.name + '** and added **' + pipsStr + '** to mana pool.'
        }]);
        updateArenaDOM();
    };

    window.toggleLandTap = window.handlePermanentClick;

    let currentFetchCardId = null;
    let currentFetchMeta = null;

    window.openFetchLandModal = function (cardId, fetchMeta = null) {
        if (!currentGame) return;
        const player = currentGame.players[0];
        const card = player.battlefield.find(c => c.id === cardId || String(c.id) === String(cardId))
            || player.graveyard.find(c => c.id === cardId || String(c.id) === String(cardId))
            || { id: cardId, name: (fetchMeta && fetchMeta.sourceName) || 'Library Search', oracleText: '' };

        if (!fetchMeta || !fetchMeta.isSpellSearch) {
            if (card.tapped) {
                alert(`⚠️ **${card.name}** is already tapped and cannot be sacrificed right now!`);
                return;
            }
        }

        // Resolve fetch ability metadata (mana cost, life cost, fetch count) if not explicitly provided
        let resolvedMeta = fetchMeta;
        if (!resolvedMeta) {
            const abilities = parseActivatedAbilities(card);
            const fetchAb = abilities.find(ab => {
                const eff = (ab.effectText || '').toLowerCase();
                const cst = (ab.costText || '').toLowerCase();
                return (ab.requiresSacrifice || cst.includes('sacrifice')) && eff.includes('search your library');
            });
            if (fetchAb) {
                const cstLower = (fetchAb.costText || '').toLowerCase();
                const effLower = (fetchAb.effectText || '').toLowerCase();
                const lifeMatch = cstLower.match(/pay\s+(\d+)\s+life/i);
                resolvedMeta = {
                    manaCostNum: fetchAb.manaCostNum || 0,
                    lifeCostNum: lifeMatch ? (parseInt(lifeMatch[1], 10) || 0) : 0,
                    fetchCount: /two\s+basic\s+land/i.test(effLower) ? 2 : 1,
                    costText: fetchAb.costText || '',
                    effectText: fetchAb.effectText || ''
                };
            } else {
                resolvedMeta = { manaCostNum: 0, lifeCostNum: 0, fetchCount: 1, costText: '', effectText: '' };
            }
        }

        // Validate mana and life costs before opening the modal
        if (resolvedMeta.manaCostNum > 0) {
            const avail = player.getAvailableMana().total;
            if (avail < resolvedMeta.manaCostNum) {
                alert(`Cannot activate ${card.name}: Need {${resolvedMeta.manaCostNum}} mana in floating pool, but you have {${avail}}!\n\n💡 Tap lands/mana rocks first to float mana.`);
                return;
            }
        }
        if (resolvedMeta.lifeCostNum > 0 && player.life <= resolvedMeta.lifeCostNum) {
            alert(`Cannot activate ${card.name}: Need to pay ${resolvedMeta.lifeCostNum} life, and you only have ${player.life} life!`);
            return;
        }

        currentFetchCardId = card.id;
        currentFetchMeta = resolvedMeta;

        const modal = document.getElementById('arenaFetchLandModal');
        const thumb = document.getElementById('fetchLandThumb');
        const nameEl = document.getElementById('fetchLandName');
        const list = document.getElementById('fetchLandOptionsList');
        if (!modal || !list) return;

        if (thumb) thumb.src = getCardArtCropUrl(card.name);
        if (nameEl) {
            const costSuffix = resolvedMeta.manaCostNum > 0
                ? ` (Cost: {${resolvedMeta.manaCostNum}}, {T}, Sacrifice)`
                : (resolvedMeta.lifeCostNum > 0 ? ` (Cost: Pay ${resolvedMeta.lifeCostNum} life, {T}, Sacrifice)` : '');
            nameEl.textContent = resolvedMeta.isTutorToHand
                ? `🔍 Tutor Library — ${card.name}`
                : (resolvedMeta.isSpellSearch ? `🌲 Search Library — ${card.name}` : `⚡ Crack ${card.name}${costSuffix}`);
        }

        const lib = player.libraryCards || [];

        // If this is a Tutor for any card in library (e.g. Demonic Tutor, Diabolic Tutor, Grim Tutor, Vampiric Tutor)
        if (resolvedMeta.isTutorToHand) {
            const uniqueCards = [];
            const seen = new Set();
            lib.forEach(c => {
                if (!c || !c.name) return;
                const key = c.name.toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueCards.push(c);
                }
            });
            list.style.gridTemplateColumns = 'repeat(2, 1fr)';
            list.style.maxHeight = '320px';
            list.style.overflowY = 'auto';
            list.innerHTML = uniqueCards.slice(0, 40).map(c => `
                <div onclick="window.confirmFetchLandChoice('${escapeHtml(card.id)}', '${escapeHtml(c.name)}')"
                     style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(168, 85, 247, 0.4); border-radius: 10px; cursor: pointer;"
                     onmouseenter="this.style.borderColor='#c084fc';"
                     onmouseleave="this.style.borderColor='rgba(168, 85, 247, 0.4)';">
                    <img src="${getCardArtCropUrl(c.name)}" style="width: 38px; height: 38px; border-radius: 6px; object-fit: cover;" onerror="this.onerror=null; this.src='https://cards.scryfall.io/back.png';" />
                    <div style="min-width: 0; flex: 1;">
                        <div style="font-weight: 800; font-size: 0.86rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(c.name)}</div>
                        <div style="font-size: 0.7rem; color: #cbd5e1;">${escapeHtml(c.typeLine || 'Spell')} ${c.manaCost || ''}</div>
                    </div>
                </div>
            `).join('');
            modal.style.display = 'flex';
            return;
        }

        // Count basic lands in player's library
        const counts = {
            'Plains': 0,
            'Island': 0,
            'Swamp': 0,
            'Mountain': 0,
            'Forest': 0,
            'Wastes': 0
        };

        lib.forEach(c => {
            const n = (c && c.name ? c.name : '').toLowerCase();
            if (n === 'plains') counts['Plains']++;
            else if (n === 'island') counts['Island']++;
            else if (n === 'swamp') counts['Swamp']++;
            else if (n === 'mountain') counts['Mountain']++;
            else if (n === 'forest') counts['Forest']++;
            else if (n === 'wastes') counts['Wastes']++;
        });

        const landDefs = [
            { name: 'Island', icon: '💧', color: '#0284c7', bg: 'rgba(2, 132, 199, 0.15)', border: 'rgba(56, 189, 248, 0.4)' },
            { name: 'Swamp', icon: '💀', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)', border: 'rgba(192, 132, 252, 0.4)' },
            { name: 'Plains', icon: '⚪', color: '#fef08a', bg: 'rgba(254, 240, 138, 0.12)', border: 'rgba(253, 224, 71, 0.4)' },
            { name: 'Mountain', icon: '🔥', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(248, 113, 113, 0.4)' },
            { name: 'Forest', icon: '🌲', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)', border: 'rgba(74, 222, 128, 0.4)' },
            { name: 'Wastes', icon: '⏳', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)', border: 'rgba(203, 213, 225, 0.4)' }
        ];

        landDefs.sort((a, b) => (counts[b.name] || 0) - (counts[a.name] || 0));

        list.innerHTML = landDefs.map(l => {
            const count = counts[l.name] || 0;
            const badgeStyle = count > 0 ? 'background: rgba(34, 197, 94, 0.25); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.4);' : 'background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2);';
            return `
                <div onclick="window.confirmFetchLandChoice('${escapeHtml(card.id)}', '${l.name}')"
                     style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: ${l.bg}; border: 1px solid ${l.border}; border-radius: 10px; cursor: pointer; transition: all 0.2s;"
                     onmouseenter="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 15px rgba(0,0,0,0.4)';"
                     onmouseleave="this.style.transform='translateY(0)'; this.style.boxShadow='none';">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.5rem;">${l.icon}</span>
                        <div>
                            <div style="font-weight: 800; font-size: 0.95rem; color: #fff;">${l.name}</div>
                            <div style="font-size: 0.72rem; color: ${l.color}; font-weight: 600;">Basic Land${resolvedMeta.fetchCount > 1 ? ` (Fetches ${resolvedMeta.fetchCount})` : ''}</div>
                        </div>
                    </div>
                    <span style="font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; ${badgeStyle}">
                        ${count} left
                    </span>
                </div>
            `;
        }).join('');

        modal.style.display = 'flex';
    };

    window.closeFetchLandModal = function () {
        const modal = document.getElementById('arenaFetchLandModal');
        if (modal) modal.style.display = 'none';
        currentFetchCardId = null;
        currentFetchMeta = null;
    };

    window.confirmFetchLandChoice = async function (cardId, chosenBasicName) {
        const fetchMeta = currentFetchMeta || { manaCostNum: 0, lifeCostNum: 0, fetchCount: 1 };
        window.closeFetchLandModal();
        if (!currentGame) return;
        const player = currentGame.players[0];
        const card = player.battlefield.find(c => c.id === cardId || String(c.id) === String(cardId));
        const fetchName = card ? card.name : (fetchMeta.sourceName || 'Fetchland');

        // 1. Deduct activation mana cost and life cost BEFORE calling executeFetchLand so updateFromRawJson preserves the paid state
        if (fetchMeta.manaCostNum > 0) {
            if (typeof player.deductMana === 'function') {
                player.deductMana(fetchMeta.manaCostNum);
            } else if (typeof player.tapMana === 'function') {
                player.tapMana(fetchMeta.manaCostNum);
            }
            appendArenaLogs([{
                type: 'MANA_PAID',
                message: `💎 **${player.name}** paid **{${fetchMeta.manaCostNum}} mana** to activate **${fetchName}**.`
            }]);
        }
        if (fetchMeta.lifeCostNum > 0) {
            player.life = Math.max(0, player.life - fetchMeta.lifeCostNum);
            appendArenaLogs([{
                type: 'LIFE_PAID',
                message: `💔 **${player.name}** paid **${fetchMeta.lifeCostNum} life** to activate **${fetchName}**.`
            }]);
        }

        // Stack animation
        const stackBox = document.getElementById('arenaStackBox');
        const stackThumb = document.getElementById('stackCardThumb');
        const stackName = document.getElementById('stackSpellName');
        if (stackBox && stackThumb && stackName) {
            stackThumb.src = getCardArtCropUrl(fetchName);
            stackName.textContent = `⚡ Search: ${fetchName} ➔ ${chosenBasicName}`;
            stackBox.style.display = 'flex';
            setTimeout(() => { if (stackBox) stackBox.style.display = 'none'; }, 650);
        }

        if (fetchMeta.isSpellSearch && typeof currentGame.executeLibrarySearch === 'function') {
            const chosenNames = (fetchMeta.fetchCount && fetchMeta.fetchCount > 1)
                ? [chosenBasicName, chosenBasicName]
                : [chosenBasicName];
            const res = await currentGame.executeLibrarySearch(fetchName, chosenNames, fetchMeta);
            if (res && res.logs && res.logs.length > 0) {
                appendArenaLogs(res.logs);
            }
            updateArenaDOM();
            return;
        }

        if (typeof currentGame.executeFetchLand === 'function') {
            const res = await currentGame.executeFetchLand(cardId, chosenBasicName, fetchMeta);
            if (res && res.logs && res.logs.length > 0) {
                appendArenaLogs(res.logs);
            }
        } else {
            // Local fallback
            if (card) {
                const bIdx = player.battlefield.findIndex(c => c.id === card.id);
                if (bIdx !== -1) {
                    player.battlefield.splice(bIdx, 1);
                    if (!player.graveyard) player.graveyard = [];
                    player.graveyard.push(card);
                }
            }
            const lib = player.libraryCards || [];
            const totalToFetch = Math.max(1, fetchMeta.fetchCount || 1);
            for (let i = 0; i < totalToFetch; i++) {
                const idx = lib.findIndex(c => (c.name || '').toLowerCase() === chosenBasicName.toLowerCase());
                let fetchedCard = null;
                if (idx !== -1) {
                    fetchedCard = lib.splice(idx, 1)[0];
                } else if (i === 0) {
                    fetchedCard = {
                        id: `c_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                        name: chosenBasicName,
                        isLand: true,
                        typeLine: `Basic Land — ${chosenBasicName}`
                    };
                }
                if (fetchedCard) {
                    fetchedCard.tapped = true;
                    player.battlefield.push(fetchedCard);
                }
            }
            appendArenaLogs([{
                type: 'FETCH_LAND',
                message: `⚡ **${player.name}** cracked **${fetchName}**, searched library for **${chosenBasicName}**, and put it onto the battlefield tapped.`
            }]);
        }

        updateArenaDOM();
    };

    window.clearManaPool = function () {
        if (!currentGame) return;
        const player = currentGame.players[0];
        player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        if (Array.isArray(player.battlefield)) {
            player.battlefield.forEach(c => {
                if (c) c.producedMana = null;
            });
        }
        appendArenaLogs([{
            type: 'MANA_EMPTIED',
            message: `🧹 **${player.name}** emptied their mana pool.`
        }]);
        updateArenaDOM();
    };

    window.untapAllMyLands = async function () {
        if (!currentGame) return;
        const player = currentGame.players[0];
        player.battlefield.forEach(c => {
            if (c.isLand || c.isManaRock || c.producedMana) {
                c.tapped = false;
                c.producedMana = null;
                c.paidLifeCost = null;
            }
        });
        player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

        appendArenaLogs([{
            type: 'UNTAP_ALL',
            message: `⚡ **${player.name}** untapped all lands and reset mana pool.`
        }]);
        updateArenaDOM();
    };

    window.adjustPlayerLife = async function (delta) {
        if (!currentGame) return;
        if (currentGame.adjustPlayerLife) {
            await currentGame.adjustPlayerLife(delta);
        } else {
            const player = currentGame.players[0];
            player.life += delta;
        }
        updateArenaDOM();
    };

    window.openAttackTargetPicker = function (cardId) {
        if (!currentGame) return;
        const player = currentGame.players[0];
        const card = player.battlefield.find(c => String(c.id) === String(cardId));
        if (!card) return;

        currentTargetingAttackerId = cardId;
        const modal = document.getElementById('arenaAttackTargetModal');
        const nameEl = document.getElementById('attackTargetCardName');
        const statsEl = document.getElementById('attackTargetCardStats');
        const thumbEl = document.getElementById('attackTargetCardThumb');
        const container = document.getElementById('attackTargetOptionsContainer');
        const removeBtn = document.getElementById('attackRemoveTargetBtn');

        if (!modal || !container) return;

        if (nameEl) nameEl.textContent = card.name;
        if (thumbEl) thumbEl.src = getCardArtCropUrl(card.name);
        const effP = player.getEffectivePower ? player.getEffectivePower(card) : card.power;
        const effT = player.getEffectiveToughness ? player.getEffectiveToughness(card) : card.toughness;
        const kwList = card.keywords ? Array.from(card.keywords).join(', ') : '';
        if (statsEl) statsEl.textContent = `⚔️ ${effP}/${effT}${kwList ? ' • ' + kwList : ''}`;

        const isCurrentlyAttacking = selectedAttackerIds.has(cardId);
        if (removeBtn) {
            removeBtn.style.display = isCurrentlyAttacking ? 'inline-block' : 'none';
        }

        const currentTarget = attackerTargets.get(cardId);

        let html = '';

        // Section 1: Defending Opponents (Rule 802.1)
        html += `<div class="arena-target-section-title"><span>👑</span> Defending Opponents (Rule 802.1):</div>`;
        const aliveOpponents = currentGame.players.slice(1).filter(p => p.isAlive);
        aliveOpponents.forEach(opp => {
            const oppIdx = currentGame.players.indexOf(opp);
            const isSelected = currentTarget && currentTarget.targetType === 'player' && String(currentTarget.targetPlayerId) === String(opp.id);
            html += `
                <button class="arena-target-btn ${isSelected ? 'active-target' : ''}" onclick="window.selectAttackerTarget('player', '${opp.id}', ${oppIdx}, 0, '${escapeHtml(opp.name)}')">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 1.1rem;">🎯</span>
                        <div style="text-align: left;">
                            <div style="font-weight: 800; color: #fff;">${escapeHtml(opp.name)}</div>
                            <div style="font-size: 0.72rem; color: #94a3b8;">Seat ${oppIdx + 1} • Hand: ${opp.hand ? opp.hand.length : 0} cards</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 0.85rem; font-weight: 900; color: #22c55e;">❤️ ${opp.life}</span>
                        ${isSelected ? '<span style="color: #ef4444; font-weight: 900;">✓ TARGETED</span>' : ''}
                    </div>
                </button>
            `;
        });

        // Section 2: Defending Planeswalkers (Rule 508.1b)
        const planeswalkers = [];
        aliveOpponents.forEach(opp => {
            const oppIdx = currentGame.players.indexOf(opp);
            (opp.battlefield || []).forEach(c => {
                if (c.isPlaneswalker || (c.typeLine && c.typeLine.toLowerCase().includes('planeswalker'))) {
                    planeswalkers.push({ card: c, controller: opp, controllerIndex: oppIdx });
                }
            });
        });

        if (planeswalkers.length > 0) {
            html += `<div class="arena-target-section-title" style="margin-top: 8px;"><span>🛡️</span> Defending Planeswalkers (Rule 508.1b):</div>`;
            planeswalkers.forEach(pwInfo => {
                const pw = pwInfo.card;
                const ctrl = pwInfo.controller;
                const ctrlIdx = pwInfo.controllerIndex;
                const loyalty = Array.isArray(pw.counters)
                    ? (pw.counters.find(cnt => cnt.type === 'LOYALTY' || cnt.type === 'loyalty')?.count || pw.loyalty || 0)
                    : (pw.counters && pw.counters.LOYALTY ? pw.counters.LOYALTY : (pw.loyalty || 0));

                const isSelected = currentTarget && currentTarget.targetType === 'planeswalker' && (String(currentTarget.targetPlaneswalkerId) === String(pw.id) || String(currentTarget.targetId) === String(pw.id));

                html += `
                    <button class="arena-target-btn ${isSelected ? 'active-target' : ''}" onclick="window.selectAttackerTarget('planeswalker', '${pw.id}', ${ctrlIdx}, '${pw.id}', '${escapeHtml(pw.name)}')">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 1.1rem;">🛡️</span>
                            <div style="text-align: left;">
                                <div style="font-weight: 800; color: #c084fc;">${escapeHtml(pw.name)}</div>
                                <div style="font-size: 0.72rem; color: #94a3b8;">Controlled by ${escapeHtml(ctrl.name)}</div>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 0.85rem; font-weight: 900; color: #f59e0b;">⚡ ${loyalty} Loyalty</span>
                            ${isSelected ? '<span style="color: #ef4444; font-weight: 900;">✓ TARGETED</span>' : ''}
                        </div>
                    </button>
                `;
            });
        }

        container.innerHTML = html;
        modal.style.display = 'flex';
    };

    window.closeAttackTargetPicker = function () {
        currentTargetingAttackerId = null;
        const modal = document.getElementById('arenaAttackTargetModal');
        if (modal) modal.style.display = 'none';
    };

    window.selectAttackerTarget = function (targetType, targetId, targetPlayerIndex, targetPlaneswalkerId, targetName) {
        if (!currentTargetingAttackerId) return;
        const cardId = currentTargetingAttackerId;
        const targetPlayer = currentGame.players[targetPlayerIndex] || currentGame.players.find(p => p.id === targetId);

        attackerTargets.set(cardId, {
            cardId,
            targetType,
            targetId,
            targetPlayerId: targetPlayer ? targetPlayer.id : null,
            targetPlayerIndex: targetPlayerIndex,
            targetPlaneswalkerId: targetType === 'planeswalker' ? targetPlaneswalkerId : 0,
            targetName: targetType === 'planeswalker' ? `${targetName} (PW)` : targetName
        });
        selectedAttackerIds.add(cardId);

        window.closeAttackTargetPicker();
        updateArenaDOM();
    };

    window.removeAttackerTarget = function () {
        if (!currentTargetingAttackerId) return;
        const cardId = currentTargetingAttackerId;
        attackerTargets.delete(cardId);
        selectedAttackerIds.delete(cardId);

        window.closeAttackTargetPicker();
        updateArenaDOM();
    };

    window.toggleAttackerSelection = function (cardId) {
        window.openAttackTargetPicker(cardId);
    };

    window.handleMainActionClick = async function () {
        if (!currentGame) return;
        const activePlayer = currentGame.getActivePlayer();
        const player = currentGame.players[0];

        if (activePlayer && activePlayer.id === player.id) {
            if (currentGame.currentPhase === 'DECLARE_ATTACKERS' || currentGame.currentPhase === 'COMBAT_DECLARE_ATTACKERS') {
                // Confirm attacks
                const opps = currentGame.players.slice(1).filter(p => p.isAlive);
                const defaultOpp = opps[0];
                const attacks = Array.from(selectedAttackerIds).map(id => {
                    const tgt = attackerTargets.get(id);
                    return {
                        attackerId: id,
                        targetType: tgt?.targetType || 'player',
                        targetId: tgt?.targetId || (defaultOpp ? defaultOpp.id : null),
                        targetPlayerId: tgt?.targetPlayerId || (defaultOpp ? defaultOpp.id : null),
                        targetPlayerIndex: (tgt && typeof tgt.targetPlayerIndex === 'number') ? tgt.targetPlayerIndex : (defaultOpp ? currentGame.players.indexOf(defaultOpp) : 1),
                        targetPlaneswalkerId: tgt?.targetPlaneswalkerId || 0,
                        targetName: tgt?.targetName || (defaultOpp ? defaultOpp.name : 'Opponent')
                    };
                });

                let res = null;
                if (currentGame.declareHumanAttacks) {
                    res = await currentGame.declareHumanAttacks(attacks);
                }
                selectedAttackerIds.clear();
                attackerTargets.clear();
                if (res && res.logs) appendArenaLogs(res.logs);
                await currentGame.stepPhase(); // Move to damage
                if (currentGame.bridge) {
                    let steps = 0;
                    while (currentGame.currentPhase !== 'MAIN_2' && currentGame.currentPhase !== 'MAIN2' && steps < 6) {
                        await currentGame.stepPhase();
                        steps++;
                    }
                }
                updateArenaDOM();
                return;
            } else if (currentGame.currentPhase === 'MAIN_1' || currentGame.currentPhase === 'MAIN1') {
                await currentGame.stepPhase();
                if (currentGame.bridge && currentGame.currentPhase === 'COMBAT_BEGIN') {
                    await currentGame.stepPhase();
                }
                updateArenaDOM();
                return;
            } else if (currentGame.currentPhase === 'MAIN_2' || currentGame.currentPhase === 'MAIN2') {
                // Step into End Step (MTG Rule 513) so the player can see their End Step before Cleanup
                currentGame.currentPhase = 'END_STEP';
                if (player) {
                    player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
                    if (Array.isArray(player.battlefield)) {
                        player.battlefield.forEach(c => { if (c) c.producedMana = null; });
                    }
                }
                appendArenaLogs([{
                    type: 'PHASE_CHANGE',
                    message: `⏳ **${player.name}** entered the **End Step** (MTG Rule 513).`
                }]);
                updateArenaDOM();
                return;
            } else if (currentGame.currentPhase === 'END_STEP' || currentGame.currentPhase === 'END_OF_TURN' || currentGame.currentPhase === 'CLEANUP') {
                // Check Maximum Hand Size during Cleanup Step (MTG Rule 514.1)
                const maxHandSize = getPlayerMaxHandSize(player);
                if (player && Array.isArray(player.hand) && player.hand.length > maxHandSize) {
                    currentGame.currentPhase = 'CLEANUP';
                    updateArenaDOM();
                    window.openCleanupDiscardModal();
                    return;
                }
                // Pass turn to the next player (Seat 1 / Opponent 1)
                const result = await currentGame.stepTurn();
                updateArenaDOM();
                if (result && result.logs && result.logs.length > 0) {
                    appendArenaLogs(result.logs);
                }
                return;
            }
        } else {
            // It is an opponent's turn: advance this bot's turn to the next player
            if (currentGame.stepTurn) {
                const result = await currentGame.stepTurn();
                updateArenaDOM();
                if (result && result.logs && result.logs.length > 0) {
                    appendArenaLogs(result.logs);
                }
                return;
            }
        }

        await window.stepArenaPhase();
    };

    // ============================================================================
    // CLEANUP STEP: DISCARD TO MAXIMUM HAND SIZE (MTG Rule 514.1)
    // ============================================================================
    const selectedCleanupDiscardIds = new Set();

    window.openCleanupDiscardModal = function () {
        if (!currentGame || !currentGame.players || !currentGame.players[0]) return;
        const player = currentGame.players[0];
        const maxHandSize = getPlayerMaxHandSize(player);
        const needDiscard = Math.max(0, (player.hand ? player.hand.length : 0) - maxHandSize);
        if (needDiscard <= 0) {
            window.closeCleanupDiscardModal();
            return;
        }
        selectedCleanupDiscardIds.clear();
        window.renderCleanupDiscardModal();
        const modal = document.getElementById('arenaCleanupDiscardModal');
        if (modal) modal.style.display = 'flex';
    };

    window.closeCleanupDiscardModal = function () {
        selectedCleanupDiscardIds.clear();
        const modal = document.getElementById('arenaCleanupDiscardModal');
        if (modal) modal.style.display = 'none';
    };

    window.renderCleanupDiscardModal = function () {
        if (!currentGame || !currentGame.players || !currentGame.players[0]) return;
        const player = currentGame.players[0];
        const maxHandSize = getPlayerMaxHandSize(player);
        const hand = player.hand || [];
        const needDiscard = Math.max(0, hand.length - maxHandSize);

        const subEl = document.getElementById('cleanupDiscardSubtext');
        const badgeEl = document.getElementById('cleanupDiscardCounterBadge');
        const gridEl = document.getElementById('cleanupDiscardCardsGrid');
        const confirmBtn = document.getElementById('confirmCleanupDiscardBtn');
        if (!gridEl) return;

        if (subEl) {
            subEl.innerHTML = `You have <strong>${hand.length}</strong> cards in hand (Maximum hand size: <strong>${maxHandSize}</strong>). Select <strong>${needDiscard}</strong> card${needDiscard > 1 ? 's' : ''} to discard to your graveyard:`;
        }
        if (badgeEl) {
            badgeEl.textContent = `Selected: ${selectedCleanupDiscardIds.size} / ${needDiscard}`;
        }

        gridEl.innerHTML = hand.map(c => {
            const isSelected = selectedCleanupDiscardIds.has(String(c.id));
            return `
                <div onclick="window.toggleCleanupDiscardCard('${escapeHtml(String(c.id))}')"
                     data-card-name="${escapeHtml(c.name)}"
                     onmouseenter="window.showCardInspector(this.getAttribute('data-card-name'), event)"
                     onmouseleave="window.hideCardInspector()"
                     style="position: relative; border-radius: 10px; overflow: hidden; cursor: pointer; border: 2px solid ${isSelected ? '#ef4444' : 'rgba(255,255,255,0.15)'}; box-shadow: ${isSelected ? '0 0 16px rgba(239, 68, 68, 0.6)' : 'none'}; transform: ${isSelected ? 'scale(0.96)' : 'scale(1)'}; transition: all 0.15s; background: #0f172a;">
                    <img src="${getCardNormalUrl(c.name)}" alt="${escapeHtml(c.name)}" style="width: 100%; display: block; opacity: ${isSelected ? '0.65' : '1'};" onerror="this.onerror=null; this.src='https://cards.scryfall.io/back.png';" />
                    <div style="padding: 5px 6px; font-size: 0.72rem; font-weight: 800; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; background: rgba(15, 23, 42, 0.95);">
                        ${escapeHtml(c.name)}
                    </div>
                    ${isSelected ? `<div style="position: absolute; top: 6px; right: 6px; background: #ef4444; color: #fff; font-size: 0.68rem; font-weight: 900; padding: 2px 7px; border-radius: 999px; box-shadow: 0 2px 6px rgba(0,0,0,0.6);">🗑️ DISCARD</div>` : ''}
                </div>
            `;
        }).join('');

        const ready = selectedCleanupDiscardIds.size === needDiscard;
        if (confirmBtn) {
            confirmBtn.disabled = !ready;
            confirmBtn.style.opacity = ready ? '1' : '0.5';
            confirmBtn.style.cursor = ready ? 'pointer' : 'not-allowed';
            confirmBtn.textContent = `🗑️ Discard ${selectedCleanupDiscardIds.size}/${needDiscard} & Pass Turn`;
        }
    };

    window.toggleCleanupDiscardCard = function (cardId) {
        if (!currentGame || !currentGame.players || !currentGame.players[0]) return;
        const player = currentGame.players[0];
        const maxHandSize = getPlayerMaxHandSize(player);
        const needDiscard = Math.max(0, (player.hand ? player.hand.length : 0) - maxHandSize);
        if (needDiscard <= 0) return;

        const key = String(cardId);
        if (selectedCleanupDiscardIds.has(key)) {
            selectedCleanupDiscardIds.delete(key);
        } else {
            if (selectedCleanupDiscardIds.size >= needDiscard) {
                const first = selectedCleanupDiscardIds.values().next().value;
                selectedCleanupDiscardIds.delete(first);
            }
            selectedCleanupDiscardIds.add(key);
        }
        window.renderCleanupDiscardModal();
    };

    window.confirmCleanupDiscardAndPass = async function () {
        if (!currentGame || !currentGame.players || !currentGame.players[0]) return;
        const player = currentGame.players[0];
        const maxHandSize = getPlayerMaxHandSize(player);
        const needDiscard = Math.max(0, (player.hand ? player.hand.length : 0) - maxHandSize);
        if (selectedCleanupDiscardIds.size !== needDiscard) {
            alert(`Please select ${needDiscard} card(s) to discard down to your maximum hand size of ${maxHandSize}.`);
            return;
        }

        const idsToDiscard = Array.from(selectedCleanupDiscardIds);
        window.closeCleanupDiscardModal();

        if (typeof currentGame.discardCardsFromHand === 'function') {
            const discarded = currentGame.discardCardsFromHand(idsToDiscard);
            if (discarded && discarded.length > 0) {
                appendArenaLogs([{
                    type: 'CLEANUP_DISCARD',
                    message: `🗑️ **${player.name}** discarded **${discarded.map(c => c.name).join(', ')}** during Cleanup Step (down to ${maxHandSize} cards - MTG Rule 514.1).`
                }]);
            }
        } else {
            const idSet = new Set(idsToDiscard.map(String));
            const discarded = [];
            player.hand = (player.hand || []).filter(c => {
                if (c && idSet.has(String(c.id))) {
                    discarded.push(c);
                    return false;
                }
                return true;
            });
            if (!Array.isArray(player.graveyard)) player.graveyard = [];
            player.graveyard.push(...discarded);
            appendArenaLogs([{
                type: 'CLEANUP_DISCARD',
                message: `🗑️ **${player.name}** discarded **${discarded.map(c => c.name).join(', ')}** during Cleanup Step (down to ${maxHandSize} cards - MTG Rule 514.1).`
            }]);
        }

        const result = await currentGame.stepTurn();
        updateArenaDOM();
        if (result && result.logs && result.logs.length > 0) {
            appendArenaLogs(result.logs);
        }
    };

    // ============================================================================
    // OPENING HAND & MULLIGAN CONTROLLER (MTG Rule 103.4c)
    // ============================================================================
    window.openMulliganModal = function () {
        if (!currentGame || !currentGame.players || !currentGame.players[0]) return;
        selectedBottomCardIds.clear();
        const overlay = document.getElementById('arenaMulliganOverlay');
        if (!overlay) return;
        window.renderMulliganModal();
        overlay.style.display = 'flex';
    };

    window.closeMulliganModal = function () {
        selectedBottomCardIds.clear();
        const overlay = document.getElementById('arenaMulliganOverlay');
        if (overlay) overlay.style.display = 'none';
    };

    window.renderMulliganModal = function () {
        if (!currentGame || !currentGame.players || !currentGame.players[0]) return;
        const overlay = document.getElementById('arenaMulliganOverlay');
        if (!overlay) return;

        const player = currentGame.players[0];
        const mullCount = player.mulliganCount || 0;
        // In multiplayer, 1st mulligan is FREE (Rule 103.4c)
        // Subsequent mulligans put (mulliganCount - 1) cards on bottom
        const cardsToBottomCount = Math.max(0, mullCount - 1);
        const hand = player.hand || [];

        const landsCount = hand.filter(c => c.isLand).length;
        const spellsCount = hand.length - landsCount;
        const totalCmc = hand.filter(c => !c.isLand).reduce((sum, c) => sum + (c.cmc || 0), 0);
        const avgCmc = spellsCount > 0 ? (totalCmc / spellsCount).toFixed(1) : '0.0';

        // Mulligan badge status
        let statusBadgeText = `Opening Hand (7 Cards)`;
        if (mullCount === 1) {
            statusBadgeText = `Mulligan 1 (FREE • 7 Cards)`;
        } else if (mullCount > 1) {
            statusBadgeText = `Mulligan #${mullCount} (Keep ${7 - cardsToBottomCount} • Bottom ${cardsToBottomCount})`;
        }

        // Instruction banner
        let bannerHtml = '';
        if (cardsToBottomCount > 0) {
            const needSelect = cardsToBottomCount;
            const currentSelected = selectedBottomCardIds.size;
            bannerHtml = `
                <div class="mulligan-instruction-banner require-bottom">
                    <div>
                        <strong>London Mulligan:</strong> Please select <strong>${needSelect}</strong> card${needSelect > 1 ? 's' : ''} from your hand to put on the bottom of your library.
                    </div>
                    <div style="font-weight: 800; font-size: 0.85rem;">
                        Selected: ${currentSelected} / ${needSelect}
                    </div>
                </div>
            `;
        } else {
            bannerHtml = `
                <div class="mulligan-instruction-banner">
                    <span>💡 <strong>Multiplayer Format:</strong> Your first mulligan is 100% free with no penalty (Rule 103.4c).</span>
                    <span style="color: #38bdf8; font-weight: 700;">Hand Size: 7</span>
                </div>
            `;
        }

        // Cards Grid
        let cardsHtml = '';
        hand.forEach(c => {
            const isBottomSelected = selectedBottomCardIds.has(c.id);
            const isSelectable = cardsToBottomCount > 0;
            const effP = player.getEffectivePower ? player.getEffectivePower(c) : c.power;
            const effT = player.getEffectiveToughness ? player.getEffectiveToughness(c) : c.toughness;

            cardsHtml += `
                <div class="mulligan-card ${isSelectable ? 'selectable' : ''} ${isBottomSelected ? 'selected-bottom' : ''}"
                     onclick="${isSelectable ? `window.toggleMulliganBottomCard('${c.id}')` : ''}"
                     data-card-name="${escapeHtml(c.name)}"
                     onmouseenter="window.showCardInspector(this.getAttribute('data-card-name'), event)"
                     onmouseleave="window.hideCardInspector()"
                     title="${escapeHtml(c.name)} - ${c.typeLine}">
                    <div class="mulligan-card-topbar">
                        <span class="mulligan-card-name">${escapeHtml(c.name)}</span>
                        <span class="mulligan-card-cost">${c.manaCost || ''}</span>
                    </div>
                    <img class="mulligan-card-art" src="${getCardArtCropUrl(c.name)}" loading="lazy" alt="${escapeHtml(c.name)}" onerror="this.onerror=null; this.src='https://cards.scryfall.io/back.png';" />
                    <div class="mulligan-card-footer">
                        <span class="mulligan-card-type">${escapeHtml(c.typeLine || 'Spell')}</span>
                        ${c.isCreature ? `<span class="mulligan-card-pt">${effP}/${effT}</span>` : ''}
                    </div>
                </div>
            `;
        });

        // Action Buttons
        const canConfirmKeep = cardsToBottomCount === 0 || selectedBottomCardIds.size === cardsToBottomCount;
        const keepBtnLabel = cardsToBottomCount === 0 
            ? `✅ Keep Hand (7 Cards)` 
            : `✅ Confirm & Keep Hand (${7 - cardsToBottomCount} Cards)`;

        let mullBtnLabel = '';
        let mullBtnClass = '';
        if (mullCount === 0) {
            mullBtnLabel = `🔄 Free Mulligan (Draw 7)`;
            mullBtnClass = 'arena-btn mulligan-btn-free';
        } else {
            const nextHandSize = Math.max(1, 7 - cardsToBottomCount - 1);
            mullBtnLabel = `🔄 Mulligan to ${nextHandSize} Cards`;
            mullBtnClass = 'arena-btn mulligan-btn-mull';
        }

        overlay.innerHTML = `
            <div class="arena-mulligan-dialog">
                <!-- Header -->
                <div class="mulligan-header">
                    <div class="mulligan-title-area">
                        <div class="mulligan-badge-icon">🃏</div>
                        <div>
                            <h3 class="mulligan-heading">Opening Hand & Mulligan</h3>
                            <div class="mulligan-rule-tag">
                                <span>⚖️ MTG Comprehensive Rules 103.4c</span>
                                <span>•</span>
                                <span>1st Mulligan is FREE in Multiplayer Commander</span>
                            </div>
                        </div>
                    </div>

                    <!-- Stats Bar -->
                    <div class="mulligan-stats-bar">
                        <span class="mulligan-stat-chip" style="background: rgba(168, 85, 247, 0.15); border-color: rgba(168, 85, 247, 0.4); color: #c084fc;">
                            ${statusBadgeText}
                        </span>
                        <span class="mulligan-stat-chip">🏞️ ${landsCount} Land${landsCount !== 1 ? 's' : ''}</span>
                        <span class="mulligan-stat-chip">⚔️ ${spellsCount} Spell${spellsCount !== 1 ? 's' : ''}</span>
                        <span class="mulligan-stat-chip">⚡ Avg CMC: ${avgCmc}</span>
                    </div>
                </div>

                <!-- Instruction Banner -->
                ${bannerHtml}

                <!-- Cards Grid -->
                <div class="mulligan-cards-grid">
                    ${cardsHtml}
                </div>

                <!-- Action Controls -->
                <div class="mulligan-actions-bar">
                    <div style="font-size: 0.78rem; color: var(--arena-text-muted);">
                        ${cardsToBottomCount > 0 
                            ? 'Tip: Put excess high-cost spells or extra lands onto the bottom of your library.' 
                            : 'Evaluate your curve and mana base before deciding to keep or take a free mulligan.'}
                    </div>
                    <div style="display: flex; gap: 0.75rem;">
                        <button class="${mullBtnClass}" onclick="window.takePlayerMulligan()">
                            ${mullBtnLabel}
                        </button>
                        <button class="arena-btn arena-btn-primary" 
                                onclick="window.keepPlayerOpeningHand()"
                                ${!canConfirmKeep ? 'disabled style="opacity: 0.45; cursor: not-allowed;"' : ''}>
                            ${keepBtnLabel}
                        </button>
                    </div>
                </div>
            </div>
        `;
    };

    window.toggleMulliganBottomCard = function (cardId) {
        if (!currentGame) return;
        const player = currentGame.players[0];
        const mullCount = player.mulliganCount || 0;
        const cardsToBottomCount = Math.max(0, mullCount - 1);
        if (cardsToBottomCount <= 0) return;

        if (selectedBottomCardIds.has(cardId)) {
            selectedBottomCardIds.delete(cardId);
        } else {
            if (selectedBottomCardIds.size >= cardsToBottomCount) {
                // Remove first selected to allow sliding selection
                const first = selectedBottomCardIds.values().next().value;
                selectedBottomCardIds.delete(first);
            }
            selectedBottomCardIds.add(cardId);
        }
        window.renderMulliganModal();
    };

    let isMulliganInProgress = false;
    window.takePlayerMulligan = async function () {
        if (!currentGame || isMulliganInProgress) return;
        isMulliganInProgress = true;
        try {
            const player = currentGame.players[0];
            const mullBtns = document.querySelectorAll('.mulligan-actions-bar button');
            mullBtns.forEach(b => { b.disabled = true; });

            let mullRes = null;
            if (player && typeof player.takeMulligan === 'function') {
                mullRes = await player.takeMulligan([], false);
            } else if (typeof currentGame.takeMulligan === 'function') {
                mullRes = await currentGame.takeMulligan();
            }
            selectedBottomCardIds.clear();

            if (mullRes && mullRes.log) {
                appendArenaLogs([mullRes.log]);
            }
            window.renderMulliganModal();
            updateArenaDOM();
        } catch (err) {
            console.error("takePlayerMulligan error:", err);
            window.renderMulliganModal();
        } finally {
            isMulliganInProgress = false;
        }
    };

    let isKeepingHand = false;
    window.keepPlayerOpeningHand = async function () {
        if (!currentGame || isKeepingHand) return;
        isKeepingHand = true;
        try {
            const player = currentGame.players[0];
            const mullCount = player.mulliganCount || 0;
            const cardsToBottomCount = Math.max(0, mullCount - 1);

            if (cardsToBottomCount > 0) {
                if (selectedBottomCardIds.size !== cardsToBottomCount) {
                    alert(`Please select exactly ${cardsToBottomCount} card(s) to place on the bottom of your library.`);
                    isKeepingHand = false;
                    return;
                }
                // Move chosen cards to bottom of library
                const bottomIds = Array.from(selectedBottomCardIds);
                let bottomed = [];
                if (player && typeof player.bottomCards === 'function') {
                    bottomed = await player.bottomCards(bottomIds);
                } else if (typeof currentGame.bottomCards === 'function') {
                    bottomed = await currentGame.bottomCards(bottomIds);
                }
                if (bottomed && bottomed.length > 0) {
                    appendArenaLogs([{
                        type: 'MULLIGAN_BOTTOM',
                        message: `⬇️ **${player.name}** placed **${bottomed.map(c => c.name || c).join(', ')}** onto the bottom of the library.`
                    }]);
                }
            }

            const keepRes = player && player.keepHand ? player.keepHand() : { log: { type: 'MULLIGAN_KEEP', message: `✅ **${player ? player.name : 'You'}** keeps opening hand!` } };
            if (keepRes && keepRes.log) appendArenaLogs([keepRes.log]);

            // Resolve AI bot opponents' mulligans according to Forge heuristics
            const botLogs = currentGame.resolveBotMulligans ? currentGame.resolveBotMulligans() : [];
            if (botLogs && botLogs.length > 0) {
                appendArenaLogs(botLogs);
            }

            appendArenaLogs([{
                type: 'MATCH_START',
                message: `⚔️ **All players have kept opening hands! Starting Turn 1.**`
            }]);

            // Lock the kept hand so it persists and doesn't get reverted by raw JSON
            if (player) {
                player.handLocked = true;
                player.keptHandCards = [...(player.hand || [])];
            }

            window.closeMulliganModal();

            // Set up starting player's Turn 1 cleanly in sync with engine
            const startIdx = typeof currentGame.startingPlayerIndex === 'number' ? currentGame.startingPlayerIndex : 0;
            currentGame.activePlayerIndex = startIdx;
            currentGame.turn = 1;

            if (currentGame.bridge && currentGame.activePlayerIndex === 0) {
                let prepSteps = 0;
                while (currentGame.currentPhase !== 'MAIN_1' && currentGame.currentPhase !== 'MAIN1' && prepSteps < 5) {
                    const res = await currentGame.stepPhase();
                    if (res && res.logs && res.logs.length > 0) {
                        appendArenaLogs(res.logs);
                    }
                    prepSteps++;
                }
            } else {
                currentGame.currentPhase = 'MAIN_1';
            }

            const activeP = currentGame.getActivePlayer();
            if (activeP) {
                activeP.landPlayedThisTurn = false;
                activeP.landsPlayedCount = 0;
                // Starting player draws for Turn 1 in multiplayer Commander (strictly once via drawForTurnPlayer0)
                if (activeP.id === player.id) {
                    if (typeof currentGame.drawForTurnPlayer0 === 'function') {
                        const logsBefore = currentGame.logs ? currentGame.logs.length : 0;
                        currentGame.drawForTurnPlayer0();
                        if (currentGame.logs && currentGame.logs.length > logsBefore) {
                            appendArenaLogs(currentGame.logs.slice(logsBefore));
                        }
                    } else if (typeof activeP.draw === 'function' && !currentGame._turnDrewPlayer0) {
                        currentGame._turnDrewPlayer0 = true;
                        const drawn = activeP.draw(1);
                        if (drawn && drawn.length > 0) {
                            appendArenaLogs([{
                                type: 'DRAW',
                                message: `📜 **${activeP.name}** drew **${drawn[0].name}** for Turn 1.`
                            }]);
                        }
                    }
                }
            }

            updateArenaDOM();
        } catch (err) {
            console.error("keepPlayerOpeningHand error:", err);
        } finally {
            isKeepingHand = false;
        }
    };

    // ============================================================================
    // SIMULATION & STEPPING LIFECYCLE
    // ============================================================================

    window.openCommanderArena = function (customDeck = null) {
        initArenaModal();
        const backdrop = document.getElementById('arenaModalBackdrop');
        if (backdrop) backdrop.style.display = 'flex';

        // Requirement: Allow selecting which deck to play FIRST before the opening hand is drawn
        window.openArenaSetup(customDeck);
    };

    window.closeCommanderArena = function () {
        if (autoPlayTimer) {
            clearInterval(autoPlayTimer);
            autoPlayTimer = null;
        }
        isPaused = true;
        const backdrop = document.getElementById('arenaModalBackdrop');
        if (backdrop) backdrop.style.display = 'none';
    };

    window.toggleArenaPlayPause = function () {
        const icon = document.getElementById('arenaPlayIcon');
        const txt = document.getElementById('arenaPlayText');

        if (isPaused) {
            isPaused = false;
            if (icon) icon.textContent = '⏸️';
            if (txt) txt.textContent = 'Pause';

            autoPlayTimer = setInterval(async () => {
                if (!currentGame || currentGame.isGameOver) {
                    window.toggleArenaPlayPause();
                    return;
                }
                const activeP = currentGame.getActivePlayer();
                // If it is human player's turn, pause auto-play to let them act!
                if (!activeP.isAI && (currentGame.currentPhase.includes('MAIN') || currentGame.currentPhase === 'DECLARE_ATTACKERS')) {
                    window.toggleArenaPlayPause();
                    return;
                }

                let result = null;
                if (activeP.isAI && currentGame.stepTurn) {
                    result = await currentGame.stepTurn();
                } else {
                    result = await currentGame.stepPhase();
                }
                updateArenaDOM();
                if (result && result.logs && result.logs.length > 0) {
                    appendArenaLogs(result.logs);
                }
            }, playSpeedMs);
        } else {
            isPaused = true;
            if (autoPlayTimer) {
                clearInterval(autoPlayTimer);
                autoPlayTimer = null;
            }
            if (icon) icon.textContent = '▶️';
            if (txt) txt.textContent = 'Auto-Bots';
        }
    };

    window.stepArenaPhase = async function () {
        if (!currentGame || currentGame.isGameOver) return;
        const activeP = currentGame.getActivePlayer();
        const player = currentGame.players ? currentGame.players[0] : null;
        if (activeP && player && activeP.id === player.id) {
            const ph = currentGame.currentPhase;
            if (ph === 'END_STEP' || ph === 'END_OF_TURN' || ph === 'CLEANUP') {
                const maxHandSize = getPlayerMaxHandSize(player);
                if (Array.isArray(player.hand) && player.hand.length > maxHandSize) {
                    currentGame.currentPhase = 'CLEANUP';
                    updateArenaDOM();
                    window.openCleanupDiscardModal();
                    return;
                }
            }
        }
        const result = await currentGame.stepPhase();
        updateArenaDOM();
        if (result && result.logs && result.logs.length > 0) {
            appendArenaLogs(result.logs);
        }
    };

    window.simulateArenaInstant = async function () {
        if (!currentGame || currentGame.isGameOver) return;
        if (autoPlayTimer) clearInterval(autoPlayTimer);
        isPaused = true;
        window.closeMulliganModal();

        const result = await currentGame.runMatchSimulation();
        updateArenaDOM();
        if (result && result.logs) appendArenaLogs(result.logs);
    };

    window.clearArenaLog = function () {
        const streamEl = document.getElementById('arenaLogStream');
        if (streamEl) streamEl.innerHTML = '';
    };

    window.updateSeat0Preview = function () {
        const select0 = document.getElementById('seatSelect0');
        const thumb = document.getElementById('seat0CmdrThumb');
        const details = document.getElementById('seat0CmdrDetails');
        const warningsEl = document.getElementById('seat0FlaggedWarnings');
        if (!select0) return;
        const decks = getAvailableDecks();
        const chosen = decks.find(d => d.id === select0.value) || decks[0];
        if (chosen) {
            // Parse cards on demand if needed
            if ((!chosen.cards || chosen.cards.length === 0) && chosen.decklist) {
                const parsed = parseDecklistText(chosen.decklist, chosen.commander);
                chosen.cards = parsed.cards;
                chosen.commander = parsed.commander || chosen.commander;
            }

            const cmdrName = chosen.commander || chosen.name;
            if (thumb) thumb.src = getCardArtCropUrl(cmdrName);
            const cardCount = chosen.cards ? chosen.cards.length : (chosen.cardCount || 100);
            if (details) details.textContent = `Commander: ${cmdrName} (${cardCount} cards)`;

            // Check for flagged cards in this deck
            const flagged = checkDeckForEngineIssues(chosen);
            if (warningsEl) {
                if (flagged && flagged.length > 0) {
                    warningsEl.style.display = 'block';
                    warningsEl.innerHTML = `
                        <div style="background: rgba(239, 68, 68, 0.16); border: 1px solid rgba(239, 68, 68, 0.45); border-radius: 8px; padding: 7px 10px; margin-top: 6px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="const l = document.getElementById('flaggedCardListSeat0'); if(l) l.style.display = l.style.display === 'none' ? 'block' : 'none';">
                                <span style="color: #fca5a5; font-weight: 800; font-size: 0.78rem; display: flex; align-items: center; gap: 5px;">
                                    <span>⚠️</span> ${flagged.length} card${flagged.length > 1 ? 's' : ''} with engine notices
                                </span>
                                <span style="color: #94a3b8; font-size: 0.72rem; text-decoration: underline;">toggle list ▾</span>
                            </div>
                            <div id="flaggedCardListSeat0" style="display: none; margin-top: 6px; max-height: 110px; overflow-y: auto; font-size: 0.73rem; color: #f1f5f9; scrollbar-width: thin;">
                                ${flagged.map(f => `<div style="padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.06);"><strong>${escapeHtml(f.name)}</strong>: <span style="color: #fde047; font-weight: 700;">[${escapeHtml(f.category)}]</span> <span style="color: #cbd5e1;">${escapeHtml(f.reason)}</span></div>`).join('')}
                            </div>
                        </div>
                    `;
                } else {
                    warningsEl.style.display = 'none';
                    warningsEl.innerHTML = '';
                }
            }
        }
    };

    window.openArenaSetup = function (customDeck = null) {
        initArenaModal();
        const backdrop = document.getElementById('arenaModalBackdrop');
        if (backdrop) backdrop.style.display = 'flex';

        if (customDeck) {
            let deckObj = customDeck;
            if (typeof customDeck === 'string') {
                const parsed = parseDecklistText(customDeck);
                deckObj = {
                    id: 'custom_deck_active',
                    name: `⭐ ${parsed.commander || 'Custom Deck'}`,
                    commander: parsed.commander || 'Custom Commander',
                    cards: parsed.cards
                };
            } else if (customDeck.content && (!customDeck.cards || customDeck.cards.length === 0)) {
                const parsed = parseDecklistText(customDeck.content);
                deckObj = {
                    id: customDeck.id ? `custom_${customDeck.id}` : 'custom_deck_active',
                    name: `⭐ ${customDeck.name || parsed.commander || 'Custom Deck'}`,
                    commander: parsed.commander || customDeck.commander || 'Custom Commander',
                    cards: parsed.cards
                };
            } else {
                deckObj = {
                    id: customDeck.id ? `custom_${customDeck.id}` : 'custom_deck_active',
                    name: `⭐ ${customDeck.name || customDeck.commander || 'Custom Deck'}`,
                    commander: customDeck.commander || customDeck.name || 'Custom Commander',
                    cards: customDeck.cards || []
                };
            }
            userActiveCustomDeck = deckObj;
        }

        const overlay = document.getElementById('arenaSetupOverlay');
        populateDeckSelects();

        // Load 180+ precons on demand in background without blocking
        loadCommanderPreconsOnDemand();

        if (overlay) overlay.style.display = 'flex';
    };

    window.selectedStartingPlayerChoice = 'random';
    window.setStartingPlayerChoice = function (choice) {
        window.selectedStartingPlayerChoice = choice;
        document.querySelectorAll('.turn-order-pill').forEach(btn => {
            btn.classList.remove('active');
        });
        const activeBtn = document.getElementById(`turnOrder_${choice}`);
        if (activeBtn) activeBtn.classList.add('active');
    };

    window.closeArenaSetup = function () {
        const overlay = document.getElementById('arenaSetupOverlay');
        if (overlay) overlay.style.display = 'none';
    };

    window.applyArenaSetupAndStart = async function (customDeck = null) {
        window.closeArenaSetup();
        if (autoPlayTimer) clearInterval(autoPlayTimer);
        isPaused = true;
        selectedAttackerIds.clear();
        attackerTargets.clear();

        const decks = getAvailableDecks();
        const selectedDecks = [];

        if (customDeck) {
            let deckObj = customDeck;
            if (typeof customDeck === 'string') {
                const parsed = parseDecklistText(customDeck);
                deckObj = {
                    id: 'custom_deck_user',
                    name: parsed.commander || 'Custom Deck',
                    commander: parsed.commander,
                    cards: parsed.cards
                };
            } else if (customDeck.content && (!customDeck.cards || customDeck.cards.length === 0)) {
                const parsed = parseDecklistText(customDeck.content);
                deckObj = {
                    id: 'custom_deck_user',
                    name: customDeck.name || parsed.commander || 'Custom Deck',
                    commander: parsed.commander || customDeck.commander,
                    cards: parsed.cards
                };
            }
            selectedDecks.push(deckObj);
            selectedDecks.push(PRESET_DECKS[1]);
            selectedDecks.push(PRESET_DECKS[2]);
            selectedDecks.push(PRESET_DECKS[3]);
        } else {
            for (let i = 0; i < 4; i++) {
                const select = document.getElementById(`seatSelect${i}`);
                const chosenId = select ? select.value : null;
                const d = decks.find(x => x.id === chosenId) || PRESET_DECKS[i % PRESET_DECKS.length];
                // Check if precon with decklist needs on-demand parsing
                if ((!d.cards || d.cards.length === 0) && d.decklist) {
                    const parsed = parseDecklistText(d.decklist, d.commander);
                    d.cards = parsed.cards;
                    d.commander = parsed.commander || d.commander;
                }
                selectedDecks.push(d);
            }
        }

        // Batch-fetch any cards missing from cache or lacking oracle text from Scryfall API
        const missingCardNames = [];
        const seenMissingNames = new Set();
        selectedDecks.forEach(d => {
            if (d && Array.isArray(d.cards)) {
                d.cards.forEach(c => {
                    if (!c || !c.name) return;
                    const clean = c.name.toLowerCase().trim();
                    const cached = window.__MTG_CARD_CACHE__ && window.__MTG_CARD_CACHE__[clean];
                    if ((!cached || !cached.oracleText) && !c.oracleText && !seenMissingNames.has(clean)) {
                        seenMissingNames.add(clean);
                        missingCardNames.push(c.name);
                    }
                });
            }
        });

        if (missingCardNames.length > 0 && typeof fetch === 'function') {
            try {
                const batch = missingCardNames.slice(0, 75).map(name => ({ name }));
                const sfRes = await fetch('https://api.scryfall.com/cards/collection', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifiers: batch })
                });
                if (sfRes.ok) {
                    const sfData = await sfRes.json();
                    if (sfData && Array.isArray(sfData.data)) {
                        if (!window.__MTG_CARD_CACHE__) window.__MTG_CARD_CACHE__ = {};
                        sfData.data.forEach(sc => {
                            if (!sc || !sc.name) return;
                            const key = sc.name.toLowerCase().trim();
                            window.__MTG_CARD_CACHE__[key] = {
                                name: sc.name,
                                manaCost: sc.mana_cost || '',
                                cmc: sc.cmc !== undefined ? sc.cmc : 0,
                                typeLine: sc.type_line || '',
                                oracleText: sc.oracle_text || '',
                                power: sc.power !== undefined ? sc.power : undefined,
                                toughness: sc.toughness !== undefined ? sc.toughness : undefined,
                                colors: sc.colors || []
                            };
                        });
                    }
                }
            } catch (eSf) {
                console.warn('Scryfall bulk metadata enrichment error:', eSf);
            }
        }

        // Enrich any custom or selected decks using window.isLandCard and window.__MTG_CARD_CACHE__
        selectedDecks.forEach(d => {
            if (d && Array.isArray(d.cards)) {
                d.cards.forEach(c => {
                    if (window.__MTG_CARD_CACHE__) {
                        const cached = window.__MTG_CARD_CACHE__[c.name.toLowerCase()];
                        if (cached) {
                            if (cached.manaCost !== undefined) c.manaCost = cached.manaCost;
                            if (cached.cmc !== undefined) c.cmc = cached.cmc;
                            if (cached.typeLine) c.typeLine = cached.typeLine;
                            if (cached.power !== undefined) c.power = cached.power;
                            if (cached.toughness !== undefined) c.toughness = cached.toughness;
                            if (cached.oracleText) c.oracleText = cached.oracleText;
                        }
                    }

                    let isLand = false;
                    if (c.manaCost || (c.cmc && c.cmc > 0)) {
                        isLand = false;
                        c.isLand = false;
                    } else if (typeof window !== 'undefined' && typeof window.isLandCard === 'function') {
                        isLand = window.isLandCard(c);
                    } else {
                        isLand = Boolean(c.isLand) || (c.typeLine || '').toLowerCase().includes('land');
                    }

                    if (isLand) {
                        c.isLand = true;
                        if (!c.typeLine || !c.typeLine.toLowerCase().includes('land')) c.typeLine = 'Land';
                        c.cmc = 0;
                        c.manaCost = '';
                    } else {
                        c.isLand = false;
                    }
                });
            }
        });

        window.clearArenaLog();
        appendArenaLogs([{
            type: 'GAME_INIT',
            message: `🚀 **Launching Official Card-Forge WebAssembly Engine...** Commanding **${selectedDecks[0].commander || selectedDecks[0].name}** against 3 bot opponents.`
        }]);

        // Determine starting player (Turn Order)
        let startingPlayerIndex = 0;
        const startingChoice = window.selectedStartingPlayerChoice || 'random';
        if (startingChoice === 'random') {
            const rolls = [
                { idx: 0, name: selectedDecks[0].commander || selectedDecks[0].name || 'You', roll: Math.floor(Math.random() * 20) + 1 },
                { idx: 1, name: selectedDecks[1].commander || selectedDecks[1].name || 'Opponent 1', roll: Math.floor(Math.random() * 20) + 1 },
                { idx: 2, name: selectedDecks[2].commander || selectedDecks[2].name || 'Opponent 2', roll: Math.floor(Math.random() * 20) + 1 },
                { idx: 3, name: selectedDecks[3].commander || selectedDecks[3].name || 'Opponent 3', roll: Math.floor(Math.random() * 20) + 1 },
            ];
            // Handle any tie for top roll
            let maxRoll = -1;
            rolls.forEach(r => { if (r.roll > maxRoll) maxRoll = r.roll; });
            const topTies = rolls.filter(r => r.roll === maxRoll);
            if (topTies.length > 1) {
                topTies[0].roll += 1;
            }
            rolls.sort((a, b) => b.roll - a.roll);
            startingPlayerIndex = rolls[0].idx;
            const rollsSummary = rolls.map(r => `${r.name}: **${r.roll}**`).join(' | ');
            appendArenaLogs([{
                type: 'DICE_ROLL',
                message: `🎲 **Turn Order Roll-Off (d20)**: ${rollsSummary} ➔ **${rolls[0].name}** won the roll and takes the first turn!`
            }]);
        } else {
            startingPlayerIndex = parseInt(startingChoice, 10) || 0;
            const chosenStarter = selectedDecks[startingPlayerIndex].commander || selectedDecks[startingPlayerIndex].name || (startingPlayerIndex === 0 ? 'You' : `Seat ${startingPlayerIndex + 1}`);
            appendArenaLogs([{
                type: 'TURN_ORDER',
                message: `👑 **Turn Order**: **${chosenStarter}** (Seat ${startingPlayerIndex + 1}) was selected to go first.`
            }]);
        }

        // Check player deck for engine issues and log if present
        const playerIssues = checkDeckForEngineIssues(selectedDecks[0]);
        if (playerIssues.length > 0) {
            appendArenaLogs([{
                type: 'WARNING',
                message: `⚠️ **Engine Notice**: Your deck contains **${playerIssues.length} card(s)** with engine notes: ${playerIssues.slice(0, 5).map(f => `\`${f.name}\` (${f.category})`).join(', ')}${playerIssues.length > 5 ? ` and ${playerIssues.length - 5} more` : ''}.`
            }]);
        }

        if (window.ForgeArena) {
            try {
                currentGame = await window.ForgeArena.startMatch(selectedDecks, startingPlayerIndex);
                window.currentGame = currentGame;
            } catch (err) {
                console.warn("Card-Forge Engine launch notice:", err);
            }
        }

        // Resilient fallback initialization:
        if (!currentGame || !currentGame.players || currentGame.players.length === 0) {
            console.warn("Starting Commander Battle Arena with resilient client engine state...");
            if (window.ForgeArena && window.ForgeArena.ForgeArenaGame) {
                currentGame = new window.ForgeArena.ForgeArenaGame(null, null, selectedDecks);
                currentGame.startingPlayerIndex = startingPlayerIndex;
                window.currentGame = currentGame;
            }
        }

        if (!currentGame || !currentGame.players || currentGame.players.length === 0) {
            console.error("Failed to initialize match seats.");
            appendArenaLogs([{
                type: 'ERROR',
                message: `❌ Failed to initialize arena match seats. Please select decks and retry.`
            }]);
            return;
        }

        if (currentGame.logs && currentGame.logs.length > 0) {
            appendArenaLogs(currentGame.logs);
        }

        appendArenaLogs([{
            type: 'MATCH_START',
            message: `✨ **Card-Forge Engine Active!** Comprehensive MTG Rules & 4-player Commander pod loaded.`
        }]);

        updateArenaDOM();
        window.openMulliganModal();
    };

    // ============================================================================
    // UNDO SNAPSHOT ENGINE & KEYBOARD HOTKEYS (Rec #8)
    // ============================================================================
    const arenaUndoStack = [];
    const MAX_ARENA_UNDO = 20;

    function cloneArenaCards(arr) {
        if (!Array.isArray(arr)) return [];
        return arr.map(c => ({
            ...c,
            colors: Array.isArray(c.colors) ? [...c.colors] : [],
            producedMana: Array.isArray(c.producedMana) ? [...c.producedMana] : null,
            keywords: c.keywords instanceof Set ? new Set(c.keywords) : c.keywords,
            counters: Array.isArray(c.counters) ? c.counters.map(x => ({ ...x })) : (c.counters ? { ...c.counters } : [])
        }));
    }

    function pushArenaUndoSnapshot(actionLabel = 'Action') {
        if (!currentGame || !Array.isArray(currentGame.players)) return;
        try {
            const snap = {
                label: actionLabel,
                turn: currentGame.turn,
                currentPhase: currentGame.currentPhase,
                activePlayerIndex: currentGame.activePlayerIndex,
                players: currentGame.players.map(p => ({
                    life: p.life,
                    isAlive: p.isAlive,
                    commanderTax: p.commanderTax,
                    landPlayedThisTurn: p.landPlayedThisTurn,
                    landsPlayedCount: p.landsPlayedCount,
                    manaPool: p.manaPool ? { ...p.manaPool } : { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                    hand: cloneArenaCards(p.hand),
                    battlefield: cloneArenaCards(p.battlefield),
                    graveyard: cloneArenaCards(p.graveyard),
                    exile: cloneArenaCards(p.exile),
                    commandZone: cloneArenaCards(p.commandZone),
                    library: cloneArenaCards(p.library)
                }))
            };
            arenaUndoStack.push(snap);
            if (arenaUndoStack.length > MAX_ARENA_UNDO) arenaUndoStack.shift();
        } catch (e) {}
    }

    window.undoArenaAction = function () {
        if (!currentGame || arenaUndoStack.length === 0) {
            appendArenaLogs([{
                type: 'INFO',
                message: `↩️ **Undo**: No previous action to undo.`
            }]);
            return;
        }
        const snap = arenaUndoStack.pop();
        currentGame.turn = snap.turn;
        currentGame.currentPhase = snap.currentPhase;
        currentGame.activePlayerIndex = snap.activePlayerIndex;
        currentGame.players.forEach((p, idx) => {
            const sp = snap.players[idx];
            if (!sp) return;
            p.life = sp.life;
            p.isAlive = sp.isAlive;
            p.commanderTax = sp.commanderTax;
            p.landPlayedThisTurn = sp.landPlayedThisTurn;
            p.landsPlayedCount = sp.landsPlayedCount;
            p.manaPool = { ...sp.manaPool };
            p.hand = cloneArenaCards(sp.hand);
            p.battlefield = cloneArenaCards(sp.battlefield);
            p.graveyard = cloneArenaCards(sp.graveyard);
            p.exile = cloneArenaCards(sp.exile);
            p.commandZone = cloneArenaCards(sp.commandZone);
            p.library = cloneArenaCards(sp.library);
        });
        selectedAttackerIds.clear();
        attackerTargets.clear();
        appendArenaLogs([{
            type: 'UNDO',
            message: `↩️ **Reverted**: Undid last action (${snap.label}).`
        }]);
        updateArenaDOM();
    };

    // Wrap primary actions to auto-snapshot before state mutation
    const _origPlayCardFromHand = window.playCardFromHand;
    if (typeof _origPlayCardFromHand === 'function') {
        window.playCardFromHand = async function (cardId) {
            pushArenaUndoSnapshot('Play Card');
            return _origPlayCardFromHand.apply(this, arguments);
        };
    }

    const _origCastPlayerCommander = window.castPlayerCommander;
    if (typeof _origCastPlayerCommander === 'function') {
        window.castPlayerCommander = async function () {
            pushArenaUndoSnapshot('Cast Commander');
            return _origCastPlayerCommander.apply(this, arguments);
        };
    }

    const _origApplyManaOption = window.applyManaOption;
    if (typeof _origApplyManaOption === 'function') {
        window.applyManaOption = function (optionIndex) {
            pushArenaUndoSnapshot('Tap for Mana');
            return _origApplyManaOption.apply(this, arguments);
        };
    }

    const _origStepArenaPhase = window.stepArenaPhase;
    if (typeof _origStepArenaPhase === 'function') {
        window.stepArenaPhase = async function () {
            pushArenaUndoSnapshot('Advance Phase');
            return _origStepArenaPhase.apply(this, arguments);
        };
    }

    const _origAdjustPlayerLife = window.adjustPlayerLife;
    if (typeof _origAdjustPlayerLife === 'function') {
        window.adjustPlayerLife = async function (delta) {
            pushArenaUndoSnapshot('Life Change');
            return _origAdjustPlayerLife.apply(this, arguments);
        };
    }

    // Keyboard Hotkeys when Arena is active
    document.addEventListener('keydown', (e) => {
        const backdrop = document.getElementById('arenaModalBackdrop');
        if (!backdrop || backdrop.style.display === 'none') return;
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;

        // Ignore hotkeys if setup modal or paste modal is open
        const setupOverlay = document.getElementById('arenaSetupOverlay');
        if (setupOverlay && setupOverlay.style.display === 'flex') return;

        const key = e.key.toLowerCase();
        if (e.code === 'Space') {
            e.preventDefault();
            if (window.handleMainActionClick) window.handleMainActionClick();
            else if (window.stepArenaPhase) window.stepArenaPhase();
        } else if (key === 'z') {
            e.preventDefault();
            window.undoArenaAction();
        } else if (key === 'u') {
            e.preventDefault();
            if (window.untapAllMyLands) window.untapAllMyLands();
        } else if (key === 'm') {
            e.preventDefault();
            if (window.clearManaPool) window.clearManaPool();
        } else if (key === 'l') {
            e.preventDefault();
            const sidebar = document.querySelector('#arenaContainer .arena-sidebar');
            if (sidebar) {
                sidebar.style.display = sidebar.style.display === 'none' ? 'flex' : 'none';
            }
        }
    });

    // Auto-mount listener on document ready
    document.addEventListener('DOMContentLoaded', () => {
        initArenaModal();
    });

})();
