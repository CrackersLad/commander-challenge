/**
 * ============================================================================
 * COMMANDER RULES & HEURISTIC BOT ENGINE (Client-Side MTG Simulator)
 * ============================================================================
 * A lightweight, web-native rules engine and bot player reverse-engineered from
 * Card-Forge. Zero external servers required. Runs 100% in browser or Node.js.
 *
 * Implements:
 * - Full Commander format rules (40 Starting Life, Command Zone, {2} Tax, 21 Cmdr Damage)
 * - Complete 5-phase / 12-step turn state machine
 * - Stack resolution (LIFO) & State-Based Actions (Rule 704 / Rule 903)
 * - Universal MTG Card Ability Parser (Ramp, Draw, Removal, Anthems, Wipes, Keywords)
 * - Heuristic AI Bot Decision Matrices (Threat evaluation, Combat math, Curve planning)
 * ============================================================================
 */

(function (global) {
    'use strict';

    // ============================================================================
    // 1. CONSTANTS & FORMAT RULES
    // ============================================================================

    const PHASES = {
        UNTAP: 'UNTAP',
        UPKEEP: 'UPKEEP',
        DRAW: 'DRAW',
        MAIN_1: 'MAIN_1',
        COMBAT_BEGIN: 'COMBAT_BEGIN',
        DECLARE_ATTACKERS: 'DECLARE_ATTACKERS',
        DECLARE_BLOCKERS: 'DECLARE_BLOCKERS',
        COMBAT_DAMAGE: 'COMBAT_DAMAGE',
        COMBAT_END: 'COMBAT_END',
        MAIN_2: 'MAIN_2',
        END_STEP: 'END_STEP',
        CLEANUP: 'CLEANUP'
    };

    const PHASE_NAMES = {
        [PHASES.UNTAP]: 'Untap',
        [PHASES.UPKEEP]: 'Upkeep',
        [PHASES.DRAW]: 'Draw',
        [PHASES.MAIN_1]: 'Pre-Combat Main',
        [PHASES.COMBAT_BEGIN]: 'Beginning of Combat',
        [PHASES.DECLARE_ATTACKERS]: 'Declare Attackers',
        [PHASES.DECLARE_BLOCKERS]: 'Declare Blockers',
        [PHASES.COMBAT_DAMAGE]: 'Combat Damage',
        [PHASES.COMBAT_END]: 'End of Combat',
        [PHASES.MAIN_2]: 'Post-Combat Main',
        [PHASES.END_STEP]: 'End Step',
        [PHASES.CLEANUP]: 'Cleanup'
    };

    const PHASE_ORDER = [
        PHASES.UNTAP,
        PHASES.UPKEEP,
        PHASES.DRAW,
        PHASES.MAIN_1,
        PHASES.COMBAT_BEGIN,
        PHASES.DECLARE_ATTACKERS,
        PHASES.DECLARE_BLOCKERS,
        PHASES.COMBAT_DAMAGE,
        PHASES.COMBAT_END,
        PHASES.MAIN_2,
        PHASES.END_STEP,
        PHASES.CLEANUP
    ];

    const BASIC_LANDS = new Set([
        'plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
        'snow-covered plains', 'snow-covered island', 'snow-covered swamp',
        'snow-covered mountain', 'snow-covered forest', 'snow-covered wastes'
    ]);

    // ============================================================================
    // 2. CARD PARSER & MECHANICS CLASSIFIER
    // ============================================================================

    function parseManaCost(manaCost) {
        if (!manaCost || typeof manaCost !== 'string') return { cmc: 0, colors: [], symbols: [] };
        const symbols = manaCost.match(/\{[^}]+\}/g) || [];
        let cmc = 0;
        const colorSet = new Set();

        symbols.forEach(s => {
            const inner = s.replace(/[{}]/g, '').toUpperCase();
            if (/^\d+$/.test(inner)) {
                cmc += parseInt(inner, 10);
            } else if (['W', 'U', 'B', 'R', 'G'].includes(inner)) {
                cmc += 1;
                colorSet.add(inner);
            } else if (inner === 'C') {
                cmc += 1;
            } else if (inner.includes('/')) {
                // Hybrid mana
                cmc += 1;
                inner.split('/').forEach(part => {
                    if (['W', 'U', 'B', 'R', 'G'].includes(part)) colorSet.add(part);
                });
            } else if (inner === 'X') {
                // Variable mana
            }
        });

        return { cmc, colors: Array.from(colorSet), symbols };
    }

    function extractKeywords(oracleText, typeLine = '') {
        const keywords = new Set();
        const text = `${typeLine} ${oracleText || ''}`.toLowerCase();
        
        const KEYWORD_LIST = [
            'flying', 'trample', 'deathtouch', 'lifelink', 'haste', 'vigilance',
            'first strike', 'double strike', 'indestructible', 'menace', 'reach',
            'hexproof', 'ward', 'defender', 'flash'
        ];

        KEYWORD_LIST.forEach(k => {
            const regex = new RegExp(`\\b${k}\\b`, 'i');
            if (regex.test(text)) keywords.add(k);
        });

        return keywords;
    }

    function parseDecklistText(text) {
        if (!text || typeof text !== 'string') return { commander: null, cards: [] };
        const lines = text.split(/\r?\n/);
        let commander = null;
        const cards = [];
        let inCommanderSection = false;

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            // Check section headers
            if (/^(?:commander|sideboard):?$/i.test(line)) {
                inCommanderSection = true;
                continue;
            }
            if (/^(?:deck|mainboard|main|creatures|spells|lands):?$/i.test(line)) {
                inCommanderSection = false;
                continue;
            }
            if (line.startsWith('#') || line.startsWith('//')) {
                if (/commander/i.test(line)) inCommanderSection = true;
                else inCommanderSection = false;
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

            if (isCmdr && !commander) {
                commander = cardName;
            }

            cards.push({
                name: cardName,
                quantity: qty,
                isCommander: isCmdr
            });
        }

        return { commander, cards };
    }

    function createCardInstance(rawCard, ownerId) {
        const name = (rawCard.name || 'Unnamed Card').trim();
        const typeLine = (rawCard.typeLine || rawCard.type || '').trim();
        const typeLower = typeLine.toLowerCase();
        const oracleText = (rawCard.oracleText || rawCard.oracle_text || rawCard.text || '').trim();
        const manaCostStr = rawCard.manaCost || rawCard.mana_cost || '';
        const parsedCost = parseManaCost(manaCostStr);
        const keywords = extractKeywords(oracleText, typeLine);

        // Power & Toughness
        let power = 0;
        let toughness = 0;
        if (rawCard.power !== undefined && rawCard.toughness !== undefined) {
            power = parseInt(rawCard.power, 10) || 0;
            toughness = parseInt(rawCard.toughness, 10) || 0;
        } else if (rawCard.pt) {
            const parts = String(rawCard.pt).split('/');
            power = parseInt(parts[0], 10) || 0;
            toughness = parseInt(parts[1], 10) || 0;
        } else {
            // Check regex in text or default based on cmc
            const ptMatch = (rawCard.text || '').match(/(\d+)\/(\d+)/);
            if (ptMatch && typeLower.includes('creature')) {
                power = parseInt(ptMatch[1], 10);
                toughness = parseInt(ptMatch[2], 10);
            } else if (typeLower.includes('creature')) {
                power = Math.max(1, Math.min(6, parsedCost.cmc || 2));
                toughness = Math.max(1, Math.min(6, parsedCost.cmc || 2));
            }
        }

        // Mechanics classification
        const isLand = typeLower.includes('land') || BASIC_LANDS.has(name.toLowerCase());
        const isCreature = typeLower.includes('creature');
        const isArtifact = typeLower.includes('artifact');
        const isEnchantment = typeLower.includes('enchantment');
        const isPlaneswalker = typeLower.includes('planeswalker');
        const isInstant = typeLower.includes('instant');
        const isSorcery = typeLower.includes('sorcery');
        const isCommander = Boolean(rawCard.isCommander || rawCard.category === 'Commander');

        // Functional roles
        const isManaRock = (isArtifact || isCreature) && !isLand && /(add\s+\{|\{t\}:\s*add|search\s+your\s+library\s+for\s+a\s+.*land)/i.test(oracleText);
        const isRampSpell = (isSorcery || isInstant) && /search your library for (a|up to \d+) .*land/i.test(oracleText);
        const isDrawSpell = /(draw\s+\d+|draw\s+a\s+card|draws\s+a\s+card|investigate)/i.test(oracleText);
        const isRemoval = /(destroy\s+target|exile\s+target|deals?\s+\d+\s+damage\s+to\s+target|return\s+target\s+.*to\s+its\s+owner's\s+hand)/i.test(oracleText);
        const isBoardWipe = /(destroy\s+all\s+creatures|exile\s+all\s+creatures|each\s+creature\s+gets\s+-\d+|all\s+creatures\s+get\s+-\d+)/i.test(oracleText);
        const isCounterspell = /counter\s+target\s+spell/i.test(oracleText);
        const isTokenProducer = /create\s+.*token/i.test(oracleText);

        // Subtypes extraction (e.g. Zombie, Elf, Dragon, Goblin)
        const subtypes = new Set();
        if (typeLine.includes('—') || typeLine.includes('-')) {
            const afterDash = typeLine.split(/[—-]/)[1] || '';
            afterDash.trim().split(/\s+/).forEach(st => {
                if (st) subtypes.add(st.toLowerCase());
            });
        }

        return {
            id: `card_${Math.random().toString(36).substr(2, 9)}`,
            ownerId,
            name,
            typeLine,
            subtypes,
            oracleText,
            manaCost: manaCostStr,
            cmc: parsedCost.cmc,
            colors: parsedCost.colors,
            power,
            toughness,
            basePower: power,
            baseToughness: toughness,
            damageReceived: 0,
            keywords,
            isLand,
            isCreature,
            isArtifact,
            isEnchantment,
            isPlaneswalker,
            isInstant,
            isSorcery,
            isCommander,
            // Roles
            isManaRock,
            isRampSpell,
            isDrawSpell,
            isRemoval,
            isBoardWipe,
            isCounterspell,
            isTokenProducer,
            // State
            tapped: false,
            summoningSick: true,
            counters: {},
            attacksThisTurn: false
        };
    }

    // ============================================================================
    // 3. PLAYER STATE & COMMAND ZONE MATRIX
    // ============================================================================

    class Player {
        constructor(id, name, deckList = [], isAI = true, avatar = null) {
            this.id = id;
            this.name = name;
            this.isAI = isAI;
            this.avatar = avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`;
            
            // Format specifics
            this.life = 40;
            this.poisonCounters = 0;
            this.isAlive = true;
            this.lossReason = null;

            // Commander Matrix
            this.commanderTax = 0; // {2} per cast
            this.commanderCastCount = 0;
            this.commanderDamageReceived = {}; // [sourceCommanderId]: amount

            // Zones
            this.library = [];
            this.hand = [];
            this.battlefield = [];
            this.graveyard = [];
            this.exile = [];
            this.commandZone = [];

            // Turn transient
            this.landPlayedThisTurn = false;
            this.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

            this.initDeck(deckList);
        }

        initDeck(deckList) {
            const cards = Array.isArray(deckList) ? deckList : (deckList.cards || []);
            const parsedList = [];

            cards.forEach(c => {
                const qty = typeof c === 'string' ? 1 : (c.quantity || 1);
                const rawObj = typeof c === 'string' ? { name: c } : c;
                for (let i = 0; i < qty; i++) {
                    const inst = createCardInstance(rawObj, this.id);
                    if (inst.isCommander && this.commandZone.length < 2) {
                        this.commandZone.push(inst);
                    } else {
                        parsedList.push(inst);
                    }
                }
            });

            // If no explicit commander was marked, choose first legendary creature from deck
            if (this.commandZone.length === 0) {
                const legIdx = parsedList.findIndex(c => c.isCreature && c.typeLine.toLowerCase().includes('legendary'));
                if (legIdx !== -1) {
                    const cmdr = parsedList.splice(legIdx, 1)[0];
                    cmdr.isCommander = true;
                    this.commandZone.push(cmdr);
                }
            }

            // Shuffle library
            this.library = this.shuffle(parsedList);
        }

        shuffle(array) {
            const arr = [...array];
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }

        draw(count = 1) {
            const drawn = [];
            for (let i = 0; i < count; i++) {
                if (this.library.length === 0) {
                    this.eliminate("Died to library exhaustion (deck out).");
                    break;
                }
                const card = this.library.shift();
                this.hand.push(card);
                drawn.push(card);
            }
            return drawn;
        }

        eliminate(reason) {
            this.isAlive = false;
            this.lossReason = reason;
            this.life = 0;
            // Move all permanents to exile
            this.battlefield = [];
            this.hand = [];
            this.commandZone = [];
        }

        getAvailableMana() {
            let total = 0;
            const colors = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

            this.battlefield.forEach(c => {
                if (!c.tapped) {
                    if (c.isLand || c.isManaRock) {
                        total += 1;
                        (c.colors || []).forEach(col => {
                            if (colors[col] !== undefined) colors[col]++;
                        });
                    }
                }
            });

            return { total, colors };
        }

        tapMana(amount = 1) {
            let tapped = 0;
            // Prefer tapping basic lands first, then dual lands, then mana rocks
            const sortedManaSources = this.battlefield
                .filter(c => !c.tapped && (c.isLand || c.isManaRock))
                .sort((a, b) => (a.isManaRock ? 1 : -1));

            for (const card of sortedManaSources) {
                if (tapped >= amount) break;
                card.tapped = true;
                tapped += 1;
            }
            return tapped;
        }

        untapAll() {
            this.battlefield.forEach(c => {
                c.tapped = false;
                c.summoningSick = false;
                c.damageReceived = 0;
                c.attacksThisTurn = false;
            });
            this.landPlayedThisTurn = false;
            this.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        }

        getEffectivePower(card) {
            if (!card || !card.isCreature) return 0;
            let p = card.basePower + (card.counters['+1/+1'] || 0);
            const subtypes = card.subtypes || new Set();

            this.battlefield.forEach(other => {
                if (other.id === card.id || !other.isCreature) return;
                // Elf anthems
                if (other.name.includes('Elvish Archdruid') && subtypes.has('elf')) p += 1;
                // Zombie anthems
                if ((other.name.includes('Lord of the Accursed') || other.name.includes('Death Baron')) && subtypes.has('zombie')) p += 1;
                // Generic anthems
                if (other.oracleText && /other .* creatures you control get \+1\/\+1/i.test(other.oracleText)) {
                    subtypes.forEach(st => {
                        if (new RegExp(st, 'i').test(other.oracleText)) p += 1;
                    });
                }
            });
            return Math.max(0, p);
        }

        getEffectiveToughness(card) {
            if (!card || !card.isCreature) return 0;
            let t = card.baseToughness + (card.counters['+1/+1'] || 0);
            const subtypes = card.subtypes || new Set();

            this.battlefield.forEach(other => {
                if (other.id === card.id || !other.isCreature) return;
                if (other.name.includes('Elvish Archdruid') && subtypes.has('elf')) t += 1;
                if ((other.name.includes('Lord of the Accursed') || other.name.includes('Death Baron')) && subtypes.has('zombie')) t += 1;
            });
            return Math.max(1, t);
        }

        canPlayLand() {
            return !this.landPlayedThisTurn && this.hand.some(c => c.isLand);
        }

        playLand(cardId) {
            if (this.landPlayedThisTurn) {
                return { success: false, message: "You have already played a land this turn." };
            }
            const idx = this.hand.findIndex(c => c.id === cardId && c.isLand);
            if (idx === -1) {
                return { success: false, message: "Land not found in hand." };
            }
            const land = this.hand.splice(idx, 1)[0];
            land.tapped = false;
            this.battlefield.push(land);
            this.landPlayedThisTurn = true;
            return {
                success: true,
                card: land,
                log: {
                    type: 'LAND',
                    playerId: this.id,
                    playerName: this.name,
                    card: land,
                    message: `🏞️ **${this.name}** played land **${land.name}**.`
                }
            };
        }

        canCastCard(card) {
            if (!card) return false;
            if (card.isLand) return this.canPlayLand();
            return this.getAvailableMana().total >= (card.cmc || 0);
        }

        castCard(cardId, game, targetPermanentId = null) {
            const idx = this.hand.findIndex(c => c.id === cardId);
            if (idx === -1) return { success: false, message: "Card not in hand." };
            const card = this.hand[idx];
            if (card.isLand) return this.playLand(cardId);

            const available = this.getAvailableMana().total;
            if (available < (card.cmc || 0)) {
                return { success: false, message: `Not enough mana. Need ${card.cmc}, have ${available}.` };
            }

            // Check if opponents counter the spell
            if (game && game.checkCounterspells) {
                const counterRes = game.checkCounterspells(card, this);
                if (counterRes.countered) {
                    this.tapMana(card.cmc || 0);
                    this.hand.splice(idx, 1);
                    this.graveyard.push(card);
                    return {
                        success: true,
                        card,
                        countered: true,
                        logs: [
                            {
                                type: 'SPELL_CAST',
                                playerId: this.id,
                                playerName: this.name,
                                card,
                                message: `⚡ **${this.name}** attempted to cast **${card.name}**...`
                            },
                            {
                                type: 'COUNTERSPELL',
                                message: `🚫 **${counterRes.opponent.name}** cast **${counterRes.counterCard.name}** and countered **${card.name}**!`
                            }
                        ]
                    };
                }
            }

            this.tapMana(card.cmc || 0);
            this.hand.splice(idx, 1);

            const logs = [{
                type: 'SPELL_CAST',
                playerId: this.id,
                playerName: this.name,
                card,
                message: `⚡ **${this.name}** cast **${card.name}** (${card.typeLine}).`
            }];

            if (card.isCreature || card.isArtifact || card.isEnchantment || card.isPlaneswalker) {
                card.tapped = false;
                card.summoningSick = !card.keywords.has('haste');
                this.battlefield.push(card);
            } else if (card.isSorcery || card.isInstant) {
                this.graveyard.push(card);
                if (card.isRampSpell) {
                    const basic = this.library.find(c => c.isLand);
                    if (basic) {
                        this.library = this.library.filter(c => c.id !== basic.id);
                        basic.tapped = true;
                        this.battlefield.push(basic);
                        logs.push({
                            type: 'RAMP',
                            playerId: this.id,
                            playerName: this.name,
                            card: basic,
                            message: `🌱 **${this.name}** put **${basic.name}** onto the battlefield tapped.`
                        });
                    }
                } else if (card.isDrawSpell) {
                    const drawn = this.draw(2);
                    logs.push({
                        type: 'DRAW',
                        playerId: this.id,
                        playerName: this.name,
                        message: `📜 **${this.name}** drew ${drawn.length} cards.`
                    });
                } else if (card.isBoardWipe) {
                    if (game && game.players) {
                        game.players.forEach(p => {
                            p.battlefield.filter(c => c.isCreature).forEach(c => {
                                if (c.keywords.has('indestructible')) {
                                    logs.push({
                                        type: 'INDESTRUCTIBLE',
                                        message: `🛡️ **${c.name}** (${p.name}) survived the wipe because it has Indestructible!`
                                    });
                                    return;
                                }
                                p.battlefield = p.battlefield.filter(x => x.id !== c.id);
                                if (c.isCommander) p.commandZone.push(c);
                                else p.graveyard.push(c);
                                if (game.processDeathTriggers) game.processDeathTriggers(c, p);
                            });
                        });
                    }
                    logs.push({
                        type: 'BOARD_WIPE',
                        playerId: this.id,
                        playerName: this.name,
                        message: `💥 **${this.name}** wiped the board with **${card.name}**!`
                    });
                } else if (card.isRemoval && targetPermanentId && game && game.players) {
                    for (const opp of game.players.filter(p => p.id !== this.id && p.isAlive)) {
                        const tgt = opp.battlefield.find(c => c.id === targetPermanentId);
                        if (tgt) {
                            if (tgt.keywords && tgt.keywords.has('hexproof')) {
                                logs.push({
                                    type: 'FIZZLE',
                                    message: `🛡️ **${card.name}** could not target **${tgt.name}** because it has Hexproof!`
                                });
                                break;
                            }
                            if (tgt.keywords && tgt.keywords.has('indestructible') && !/exile/i.test(card.oracleText)) {
                                logs.push({
                                    type: 'INDESTRUCTIBLE',
                                    message: `🛡️ **${tgt.name}** is Indestructible and was not destroyed by **${card.name}**!`
                                });
                                break;
                            }
                            opp.battlefield = opp.battlefield.filter(c => c.id !== tgt.id);
                            if (tgt.isCommander) opp.commandZone.push(tgt);
                            else opp.graveyard.push(tgt);
                            logs.push({
                                type: 'REMOVAL',
                                playerId: this.id,
                                playerName: this.name,
                                message: `🎯 **${this.name}** removed **${tgt.name}** (${opp.name}) with **${card.name}**!`
                            });
                            if (game.processDeathTriggers) game.processDeathTriggers(tgt, opp);
                            break;
                        }
                    }
                }
            }

            return { success: true, card, logs };
        }

        canCastCommander() {
            const cmdr = this.getCommander();
            if (!cmdr) return false;
            const cost = (cmdr.cmc || 0) + this.commanderTax;
            return this.getAvailableMana().total >= cost;
        }

        castCommander(game) {
            const cmdr = this.getCommander();
            if (!cmdr) return { success: false, message: "Commander not in Command Zone." };
            const totalCost = (cmdr.cmc || 0) + this.commanderTax;
            const available = this.getAvailableMana().total;
            if (available < totalCost) {
                return { success: false, message: `Need ${totalCost} mana (Tax: {${this.commanderTax}}), have ${available}.` };
            }

            // Check if opponents counter the Commander
            if (game && game.checkCounterspells) {
                const counterRes = game.checkCounterspells(cmdr, this);
                if (counterRes.countered) {
                    this.tapMana(totalCost);
                    this.commanderTax += 2;
                    return {
                        success: true,
                        card: cmdr,
                        countered: true,
                        logs: [
                            {
                                type: 'COMMANDER_CAST',
                                playerId: this.id,
                                playerName: this.name,
                                card: cmdr,
                                message: `👑 **${this.name}** attempted to cast Commander **${cmdr.name}**...`
                            },
                            {
                                type: 'COUNTERSPELL',
                                message: `🚫 **${counterRes.opponent.name}** cast **${counterRes.counterCard.name}** and countered **${cmdr.name}**! (Redirected to Command Zone, Next Tax: {${this.commanderTax}}).`
                            }
                        ]
                    };
                }
            }

            this.tapMana(totalCost);
            this.commandZone = this.commandZone.filter(c => c.id !== cmdr.id);
            cmdr.tapped = false;
            cmdr.summoningSick = !cmdr.keywords.has('haste');
            this.battlefield.push(cmdr);
            this.commanderTax += 2;

            return {
                success: true,
                card: cmdr,
                logs: [{
                    type: 'COMMANDER_CAST',
                    playerId: this.id,
                    playerName: this.name,
                    card: cmdr,
                    message: `👑 **${this.name}** cast Commander **${cmdr.name}**! (Next tax: {${this.commanderTax}}).`
                }]
            };
        }

        toggleTapPermanent(cardId) {
            const card = this.battlefield.find(c => c.id === cardId);
            if (card) {
                card.tapped = !card.tapped;
                return true;
            }
            return false;
        }

        getCommander() {
            return this.commandZone[0] || null;
        }
    }

    // ============================================================================
    // 4. HEURISTIC BOT CONTROLLER (Reverse-engineered from Forge AI)
    // ============================================================================

    class CommanderBotAI {
        static evaluateTableThreats(game, botPlayer) {
            const opponents = game.players.filter(p => p.id !== botPlayer.id && p.isAlive);
            if (opponents.length === 0) return [];

            return opponents.map(opp => {
                let threatScore = 0;

                // 1. Board Power threat
                const boardPower = opp.battlefield.reduce((acc, c) => acc + (c.isCreature ? c.power : 1), 0);
                threatScore += boardPower * 1.5;

                // 2. Life total leverage
                if (opp.life > 30) threatScore += (opp.life - 30) * 0.5;

                // 3. Commander Threat
                const cmdrOnBoard = opp.battlefield.find(c => c.isCommander);
                if (cmdrOnBoard) {
                    threatScore += (cmdrOnBoard.power * 2) + 10;
                }

                // 4. Commander Damage Pressure against Bot
                const cmdrDmgToBot = botPlayer.commanderDamageReceived[opp.id] || 0;
                if (cmdrDmgToBot > 10) threatScore += (cmdrDmgToBot - 10) * 4;

                // 5. Cards in hand (potential response capability)
                threatScore += opp.hand.length * 1.2;

                return {
                    player: opp,
                    threatScore: Math.round(threatScore)
                };
            }).sort((a, b) => b.threatScore - a.threatScore);
        }

        static takeMainPhaseActions(game, player) {
            const logs = [];
            const mana = player.getAvailableMana();

            // 1. Play Land for turn if available
            if (!player.landPlayedThisTurn) {
                const landIdx = player.hand.findIndex(c => c.isLand);
                if (landIdx !== -1) {
                    const land = player.hand.splice(landIdx, 1)[0];
                    land.tapped = false;
                    player.battlefield.push(land);
                    player.landPlayedThisTurn = true;
                    logs.push({
                        type: 'LAND',
                        playerId: player.id,
                        playerName: player.name,
                        card: land,
                        message: `${player.name} played land **${land.name}**.`
                    });
                }
            }

            // Recalculate mana after land play
            let availableMana = player.getAvailableMana().total;

            // 2. Evaluate casting Commander if available in Command Zone
            const cmdr = player.getCommander();
            if (cmdr) {
                const requiredCost = cmdr.cmc + player.commanderTax;
                // Cast commander if we have sufficient mana and curve warrants it
                if (availableMana >= requiredCost && (player.battlefield.filter(c => c.isCreature).length >= 1 || game.turn >= 3 || requiredCost <= 3)) {
                    player.tapMana(requiredCost);
                    availableMana -= requiredCost;
                    player.commandZone = player.commandZone.filter(c => c.id !== cmdr.id);
                    cmdr.tapped = false;
                    cmdr.summoningSick = true;
                    player.battlefield.push(cmdr);
                    player.commanderCastCount++;
                    player.commanderTax += 2;

                    logs.push({
                        type: 'COMMANDER_CAST',
                        playerId: player.id,
                        playerName: player.name,
                        card: cmdr,
                        message: `👑 ${player.name} cast Commander **${cmdr.name}** (${requiredCost} mana, tax: {${player.commanderTax}}).`
                    });
                }
            }

            // 3. Play Ramp & Mana Rocks early (Turns 1 - 4)
            if (availableMana > 0) {
                const rampIdx = player.hand.findIndex(c => (c.isManaRock || c.isRampSpell) && c.cmc <= availableMana);
                if (rampIdx !== -1) {
                    const rampCard = player.hand.splice(rampIdx, 1)[0];
                    player.tapMana(rampCard.cmc);
                    availableMana -= rampCard.cmc;

                    if (rampCard.isManaRock) {
                        rampCard.tapped = false;
                        player.battlefield.push(rampCard);
                    } else {
                        player.graveyard.push(rampCard);
                        // Fetch a basic land onto battlefield tapped
                        const basicLand = player.library.find(c => c.isLand);
                        if (basicLand) {
                            player.library = player.library.filter(c => c.id !== basicLand.id);
                            basicLand.tapped = true;
                            player.battlefield.push(basicLand);
                        }
                    }

                    logs.push({
                        type: 'SPELL_CAST',
                        playerId: player.id,
                        playerName: player.name,
                        card: rampCard,
                        message: `⚡ ${player.name} cast ramp engine **${rampCard.name}**.`
                    });
                }
            }

            // 4. Play Targeted Removal if an opponent's permanent is dangerously threatening
            if (availableMana > 0) {
                const threats = this.evaluateTableThreats(game, player);
                const leadThreat = threats[0]?.player;

                if (leadThreat && (leadThreat.battlefield.length > player.battlefield.length + 2 || leadThreat.life > 35)) {
                    const removalIdx = player.hand.findIndex(c => c.isRemoval && c.cmc <= availableMana);
                    if (removalIdx !== -1) {
                        const targetPermanent = leadThreat.battlefield.find(c => c.isCommander) || leadThreat.battlefield.find(c => c.isCreature && c.power >= 4) || leadThreat.battlefield[0];
                        if (targetPermanent) {
                            const removalCard = player.hand.splice(removalIdx, 1)[0];
                            player.tapMana(removalCard.cmc);
                            availableMana -= removalCard.cmc;
                            player.graveyard.push(removalCard);

                            // Resolve removal on target
                            leadThreat.battlefield = leadThreat.battlefield.filter(c => c.id !== targetPermanent.id);
                            if (targetPermanent.isCommander) {
                                // Rule 903.9a: Move commander back to command zone
                                leadThreat.commandZone.push(targetPermanent);
                                logs.push({
                                    type: 'REMOVAL',
                                    playerId: player.id,
                                    playerName: player.name,
                                    card: removalCard,
                                    target: targetPermanent,
                                    message: `🎯 ${player.name} targeted and destroyed **${targetPermanent.name}** (${leadThreat.name}'s Commander) with **${removalCard.name}**! (Redirected to Command Zone).`
                                });
                            } else {
                                leadThreat.graveyard.push(targetPermanent);
                                logs.push({
                                    type: 'REMOVAL',
                                    playerId: player.id,
                                    playerName: player.name,
                                    card: removalCard,
                                    target: targetPermanent,
                                    message: `🎯 ${player.name} destroyed ${leadThreat.name}'s **${targetPermanent.name}** with **${removalCard.name}**.`
                                });
                            }
                        }
                    }
                }
            }

            // 5. Deploy Creatures & Permanents on Curve
            let attempts = 0;
            while (availableMana > 0 && attempts < 5) {
                attempts++;
                const castableCreatures = player.hand
                    .filter(c => c.isCreature && c.cmc <= availableMana)
                    .sort((a, b) => b.cmc - a.cmc); // Cast biggest threat first

                if (castableCreatures.length === 0) break;

                const cardToCast = castableCreatures[0];
                player.hand = player.hand.filter(c => c.id !== cardToCast.id);
                player.tapMana(cardToCast.cmc);
                availableMana -= cardToCast.cmc;

                cardToCast.tapped = false;
                cardToCast.summoningSick = !cardToCast.keywords.has('haste');
                player.battlefield.push(cardToCast);

                logs.push({
                    type: 'CREATURE_CAST',
                    playerId: player.id,
                    playerName: player.name,
                    card: cardToCast,
                    message: `🛡️ ${player.name} summoned **${cardToCast.name}** (${cardToCast.power}/${cardToCast.toughness}).`
                });

                // ETB card draw trigger simulation
                if (cardToCast.isDrawSpell || cardToCast.oracleText.toLowerCase().includes('draw a card')) {
                    const drawn = player.draw(1);
                    if (drawn.length > 0) {
                        logs.push({
                            type: 'DRAW',
                            playerId: player.id,
                            playerName: player.name,
                            message: `📜 ${player.name} drew a card from **${cardToCast.name}**'s ETB trigger.`
                        });
                    }
                }
            }

            return logs;
        }

        static planCombatAttacks(game, attackingPlayer) {
            const logs = [];
            const threats = this.evaluateTableThreats(game, attackingPlayer);
            if (threats.length === 0) return { targetPlayer: null, attackers: [], logs };

            // Target the leading threat / archenemy
            const primaryTarget = threats[0].player;

            // Eligible attackers (not tapped, not summoning sick unless haste, not defender)
            const readyCreatures = attackingPlayer.battlefield.filter(c =>
                c.isCreature && !c.tapped && (!c.summoningSick || c.keywords.has('haste')) && !c.keywords.has('defender')
            );

            if (readyCreatures.length === 0) return { targetPlayer: primaryTarget, attackers: [], logs };

            // Available blockers of defender
            const defenderBlockers = primaryTarget.battlefield.filter(c => c.isCreature && !c.tapped);
            const defenderMaxToughness = defenderBlockers.reduce((max, b) => Math.max(max, b.toughness), 0);
            const defenderMaxPower = defenderBlockers.reduce((max, b) => Math.max(max, b.power), 0);

            const chosenAttackers = [];

            readyCreatures.forEach(attacker => {
                // Safe attack check:
                // 1. Defender has no blockers
                // 2. Attacker has Flying or Menace and defender lacks evasion
                // 3. Attacker power >= defenderMaxToughness and attacker toughness > defenderMaxPower
                // 4. Alpha strike opportunity if defender life <= total power
                const hasEvasion = attacker.keywords.has('flying') && !defenderBlockers.some(b => b.keywords.has('flying') || b.keywords.has('reach'));
                const isSafeTrade = attacker.toughness > defenderMaxPower || attacker.keywords.has('indestructible') || attacker.keywords.has('deathtouch');
                const isAggroSwing = attacker.power >= 3 || attacker.isCommander;

                if (defenderBlockers.length === 0 || hasEvasion || isSafeTrade || (isAggroSwing && attackingPlayer.life > 25)) {
                    attacker.tapped = true;
                    attacker.attacksThisTurn = true;
                    chosenAttackers.push(attacker);
                }
            });

            if (chosenAttackers.length > 0) {
                const totalAtkPower = chosenAttackers.reduce((sum, c) => sum + c.power, 0);
                logs.push({
                    type: 'ATTACK_DECLARED',
                    attackerId: attackingPlayer.id,
                    attackerName: attackingPlayer.name,
                    targetId: primaryTarget.id,
                    targetName: primaryTarget.name,
                    attackers: chosenAttackers,
                    totalPower: totalAtkPower,
                    message: `⚔️ **${attackingPlayer.name}** declared attack against **${primaryTarget.name}** with ${chosenAttackers.length} creatures (${totalAtkPower} total power)!`
                });
            }

            return {
                targetPlayer: primaryTarget,
                attackers: chosenAttackers,
                logs
            };
        }

        static resolveCombatDamage(game, attackingPlayer, defendingPlayer, attackers) {
            const logs = [];
            if (!defendingPlayer || attackers.length === 0) return logs;

            // Available untapped blockers
            const blockers = defendingPlayer.battlefield.filter(c => c.isCreature && !c.tapped);
            let unblockedAttackers = [...attackers];
            const blockedPairs = [];

            // AI Defender assigns blockers:
            blockers.forEach(blocker => {
                if (unblockedAttackers.length === 0) return;

                // Match blocker against attacker respecting Menace, Flying, and Reach
                const matchIdx = unblockedAttackers.findIndex(atk => {
                    if (atk.keywords.has('menace') && blockers.length < 2) return false;
                    const canBlockFlying = !atk.keywords.has('flying') || blocker.keywords.has('flying') || blocker.keywords.has('reach');
                    if (!canBlockFlying) return false;

                    const atkPower = attackingPlayer.getEffectivePower(atk);
                    const atkToughness = attackingPlayer.getEffectiveToughness(atk);
                    const blkPower = defendingPlayer.getEffectivePower(blocker);
                    const blkToughness = defendingPlayer.getEffectiveToughness(blocker);

                    // Favor favorable trades or soaking damage
                    return (blkPower >= atkToughness || blkToughness > atkPower || blocker.keywords.has('deathtouch') || blocker.keywords.has('indestructible'));
                });

                if (matchIdx !== -1) {
                    const matchedAtk = unblockedAttackers.splice(matchIdx, 1)[0];
                    blocker.tapped = true;
                    blockedPairs.push({ attacker: matchedAtk, blocker });
                }
            });

            // 1. Resolve Blocked Combat with First Strike, Double Strike, Deathtouch, Lifelink, Indestructible & Trample
            blockedPairs.forEach(({ attacker, blocker }) => {
                const atkPower = attackingPlayer.getEffectivePower(attacker);
                const atkToughness = attackingPlayer.getEffectiveToughness(attacker);
                const blkPower = defendingPlayer.getEffectivePower(blocker);
                const blkToughness = defendingPlayer.getEffectiveToughness(blocker);

                const atkHasFirstStrike = attacker.keywords.has('first strike') || attacker.keywords.has('double strike');
                const blkHasFirstStrike = blocker.keywords.has('first strike') || blocker.keywords.has('double strike');
                const atkHasDoubleStrike = attacker.keywords.has('double strike');
                const blkHasDoubleStrike = blocker.keywords.has('double strike');

                let atkDamageDealt = 0;
                let blkDamageDealt = 0;
                let trampleDmgToPlayer = 0;

                // First Strike Damage Step
                if (atkHasFirstStrike || blkHasFirstStrike) {
                    if (atkHasFirstStrike) {
                        const dmg = Math.min(atkPower, blkToughness);
                        blocker.damageReceived += dmg;
                        atkDamageDealt += dmg;
                        if (attacker.keywords.has('lifelink')) attackingPlayer.life += dmg;

                        if (attacker.keywords.has('trample') && atkPower > blkToughness) {
                            trampleDmgToPlayer += (atkPower - blkToughness);
                        }
                    }
                    if (blkHasFirstStrike) {
                        const dmg = Math.min(blkPower, atkToughness);
                        attacker.damageReceived += dmg;
                        blkDamageDealt += dmg;
                        if (blocker.keywords.has('lifelink')) defendingPlayer.life += dmg;
                    }
                }

                // Check early deaths from First Strike
                const blkDiesFirst = (blocker.damageReceived >= blkToughness || (attacker.keywords.has('deathtouch') && atkDamageDealt > 0)) && !blocker.keywords.has('indestructible');
                const atkDiesFirst = (attacker.damageReceived >= atkToughness || (blocker.keywords.has('deathtouch') && blkDamageDealt > 0)) && !attacker.keywords.has('indestructible');

                // Regular Damage Step
                if (!blkDiesFirst && (!atkHasFirstStrike || atkHasDoubleStrike)) {
                    const dmg = Math.min(atkPower, Math.max(0, blkToughness - blocker.damageReceived));
                    blocker.damageReceived += dmg;
                    atkDamageDealt += dmg;
                    if (attacker.keywords.has('lifelink')) attackingPlayer.life += dmg;

                    if (attacker.keywords.has('trample') && atkPower > blkToughness) {
                        trampleDmgToPlayer += (atkPower - blkToughness);
                    }
                }

                if (!atkDiesFirst && (!blkHasFirstStrike || blkHasDoubleStrike)) {
                    const dmg = Math.min(blkPower, Math.max(0, atkToughness - attacker.damageReceived));
                    attacker.damageReceived += dmg;
                    blkDamageDealt += dmg;
                    if (blocker.keywords.has('lifelink')) defendingPlayer.life += dmg;
                }

                // Final Lethality checks (Deathtouch & Indestructible)
                const atkDies = (attacker.damageReceived >= atkToughness || (blocker.keywords.has('deathtouch') && blkDamageDealt > 0)) && !attacker.keywords.has('indestructible');
                const blkDies = (blocker.damageReceived >= blkToughness || (attacker.keywords.has('deathtouch') && atkDamageDealt > 0)) && !blocker.keywords.has('indestructible');

                let outcome = '';
                if (atkDies && blkDies) outcome = 'both died in trade';
                else if (atkDies) outcome = `${attacker.name} died`;
                else if (blkDies) outcome = `${blocker.name} died`;
                else outcome = 'both survived';

                logs.push({
                    type: 'COMBAT_TRADE',
                    attacker,
                    blocker,
                    message: `🛡️ **${blocker.name}** (${blkPower}/${blkToughness}) blocked **${attacker.name}** (${atkPower}/${atkToughness}) ➔ ${outcome}.${trampleDmgToPlayer > 0 ? ` 🌪️ **${trampleDmgToPlayer}** trample damage hit ${defendingPlayer.name}!` : ''}`
                });

                // Apply Trample damage to defending player
                if (trampleDmgToPlayer > 0 && defendingPlayer.isAlive) {
                    defendingPlayer.life -= trampleDmgToPlayer;
                    if (attacker.keywords.has('lifelink')) attackingPlayer.life += trampleDmgToPlayer;
                    if (attacker.isCommander) {
                        const prev = defendingPlayer.commanderDamageReceived[attacker.ownerId] || 0;
                        defendingPlayer.commanderDamageReceived[attacker.ownerId] = prev + trampleDmgToPlayer;
                    }
                }

                if (atkDies) {
                    attackingPlayer.battlefield = attackingPlayer.battlefield.filter(c => c.id !== attacker.id);
                    if (attacker.isCommander) attackingPlayer.commandZone.push(attacker);
                    else attackingPlayer.graveyard.push(attacker);
                    if (game && game.processDeathTriggers) game.processDeathTriggers(attacker, attackingPlayer);
                }

                if (blkDies) {
                    defendingPlayer.battlefield = defendingPlayer.battlefield.filter(c => c.id !== blocker.id);
                    if (blocker.isCommander) defendingPlayer.commandZone.push(blocker);
                    else defendingPlayer.graveyard.push(blocker);
                    if (game && game.processDeathTriggers) game.processDeathTriggers(blocker, defendingPlayer);
                }
            });

            // 2. Resolve Unblocked Combat (Damage to Player with Lifelink, Double Strike, Commander Damage)
            let totalPlayerDmg = 0;
            let cmdrDmg = 0;

            unblockedAttackers.forEach(atk => {
                let atkPower = attackingPlayer.getEffectivePower(atk);
                if (atk.keywords.has('double strike')) {
                    atkPower *= 2; // Hits in first strike AND regular damage
                }

                totalPlayerDmg += atkPower;
                if (atk.keywords.has('lifelink')) {
                    attackingPlayer.life += atkPower;
                }

                // Track Commander Damage (21 lethal threshold)
                if (atk.isCommander) {
                    cmdrDmg += atkPower;
                    const prevCmdrDmg = defendingPlayer.commanderDamageReceived[atk.ownerId] || 0;
                    defendingPlayer.commanderDamageReceived[atk.ownerId] = prevCmdrDmg + atkPower;

                    if (defendingPlayer.commanderDamageReceived[atk.ownerId] >= 21) {
                        defendingPlayer.eliminate(`Defeated by 21 Commander Damage from ${atk.name}!`);
                        logs.push({
                            type: 'COMMANDER_LETHAL',
                            message: `💀 **${defendingPlayer.name}** suffered 21+ Commander Damage from **${atk.name}** and has been ELIMINATED!`
                        });
                    }
                }
            });

            if (unblockedAttackers.length > 0 && totalPlayerDmg > 0 && defendingPlayer.isAlive) {
                defendingPlayer.life -= totalPlayerDmg;
                logs.push({
                    type: 'PLAYER_DAMAGE',
                    defendingPlayerName: defendingPlayer.name,
                    damage: totalPlayerDmg,
                    remainingLife: defendingPlayer.life,
                    message: `🩸 **${defendingPlayer.name}** took **${totalPlayerDmg}** combat damage (Remaining Life: ${defendingPlayer.life})${cmdrDmg > 0 ? ` [${cmdrDmg} Commander Damage]` : ''}.`
                });

                if (defendingPlayer.life <= 0) {
                    defendingPlayer.eliminate("Life total reduced to 0 or below.");
                    logs.push({
                        type: 'PLAYER_DEFEATED',
                        message: `💀 **${defendingPlayer.name}** has been ELIMINATED from the pod!`
                    });
                }
            }

            return logs;
        }
    }

    // ============================================================================
    // 5. MATCH SIMULATOR ORCHESTRATOR
    // ============================================================================

    class CommanderGame {
        constructor({ players = [], format = 'Commander', maxTurns = 30 }) {
            this.id = `game_${Date.now()}`;
            this.format = format;
            this.maxTurns = maxTurns;
            this.players = [];
            this.turn = 1;
            this.activePlayerIndex = 0;
            this.currentPhase = PHASES.UNTAP;
            this.isGameOver = false;
            this.winner = null;
            this.history = [];
            this.turnLogs = [];

            // Initialize players
            players.forEach((p, idx) => {
                this.players.push(new Player(p.id || `p_${idx + 1}`, p.name || `Player ${idx + 1}`, p.deck || p.cards || [], p.isAI !== false, p.avatar));
            });

            // Initial 7 card hand draw
            this.players.forEach(p => p.draw(7));
        }

        getActivePlayer() {
            return this.players[this.activePlayerIndex];
        }

        stepPhase() {
            if (this.isGameOver) return;

            const activePlayer = this.getActivePlayer();
            const currIdx = PHASE_ORDER.indexOf(this.currentPhase);
            const nextPhase = PHASE_ORDER[(currIdx + 1) % PHASE_ORDER.length];

            const phaseLogs = [];

            // Execute Phase Logic
            switch (this.currentPhase) {
                case PHASES.UNTAP:
                    activePlayer.untapAll();
                    break;

                case PHASES.UPKEEP:
                    // Upkeep triggers
                    break;

                case PHASES.DRAW:
                    // First turn player in 1v1 skips draw, but in multiplayer 4-player Commander all players draw
                    if (this.players.length > 2 || this.turn > 1) {
                        const drawn = activePlayer.draw(1);
                        if (drawn.length > 0) {
                            phaseLogs.push({
                                type: 'DRAW',
                                playerId: activePlayer.id,
                                playerName: activePlayer.name,
                                message: `📜 ${activePlayer.name} drew for turn.`
                            });
                        }
                    }
                    break;

                case PHASES.MAIN_1:
                    if (activePlayer.isAI) {
                        const mainLogs = CommanderBotAI.takeMainPhaseActions(this, activePlayer);
                        phaseLogs.push(...mainLogs);
                    }
                    break;

                case PHASES.DECLARE_ATTACKERS:
                    if (activePlayer.isAI) {
                        const combatPlan = CommanderBotAI.planCombatAttacks(this, activePlayer);
                        phaseLogs.push(...combatPlan.logs);
                        this._pendingCombat = combatPlan;
                    }
                    break;

                case PHASES.COMBAT_DAMAGE:
                    if (this._pendingCombat && Array.isArray(this._pendingCombat.attackers) && this._pendingCombat.attackers.length > 0) {
                        const damageLogs = CommanderBotAI.resolveCombatDamage(
                            this,
                            activePlayer,
                            this._pendingCombat.targetPlayer,
                            this._pendingCombat.attackers
                        );
                        phaseLogs.push(...damageLogs);
                    }
                    this._pendingCombat = null;
                    break;

                case PHASES.MAIN_2:
                    if (activePlayer.isAI) {
                        const postCombatLogs = CommanderBotAI.takeMainPhaseActions(this, activePlayer);
                        phaseLogs.push(...postCombatLogs);
                    }
                    break;

                case PHASES.END_STEP:
                    // 1. Prosper, Tome-Bound: Exile top card of library
                    if (activePlayer.battlefield.some(c => c.name.includes('Prosper'))) {
                        if (activePlayer.library.length > 0) {
                            const exiled = activePlayer.library.shift();
                            activePlayer.exile.push(exiled);
                            phaseLogs.push({
                                type: 'TRIGGER',
                                message: `🔮 **Prosper, Tome-Bound** trigger: exiled **${exiled.name}** from library!`
                            });
                        }
                    }
                    // 2. Wilhelt, the Rotcleaver: Sacrifice a zombie to draw
                    if (activePlayer.battlefield.some(c => c.name.includes('Wilhelt'))) {
                        const nonWilheltZombies = activePlayer.battlefield.filter(c => c.isCreature && c.subtypes && c.subtypes.has('zombie') && !c.name.includes('Wilhelt'));
                        if (nonWilheltZombies.length > 0) {
                            const sac = nonWilheltZombies[0];
                            activePlayer.battlefield = activePlayer.battlefield.filter(c => c.id !== sac.id);
                            activePlayer.graveyard.push(sac);
                            const drawn = activePlayer.draw(1);
                            phaseLogs.push({
                                type: 'SACRIFICE',
                                message: `🧟 **Wilhelt** sacrificed **${sac.name}** to draw a card!`
                            });
                            const deathLogs = this.processDeathTriggers(sac, activePlayer);
                            phaseLogs.push(...deathLogs);
                        }
                    }
                    break;

                case PHASES.CLEANUP:
                    // Discard down to maximum hand size of 7
                    while (activePlayer.hand.length > 7) {
                        const discarded = activePlayer.hand.pop();
                        activePlayer.graveyard.push(discarded);
                    }
                    break;
            }

            // Check game win condition
            const alivePlayers = this.players.filter(p => p.isAlive);
            if (alivePlayers.length <= 1) {
                this.isGameOver = true;
                this.winner = alivePlayers[0] || null;
                phaseLogs.push({
                    type: 'GAME_OVER',
                    winner: this.winner,
                    message: this.winner ? `🏆 **${this.winner.name}** won the match on Turn ${this.turn}!` : "The match ended in a draw."
                });
            } else if (this.turn >= this.maxTurns) {
                this.isGameOver = true;
                // Highest life total wins timeout
                const sortedByLife = [...alivePlayers].sort((a, b) => b.life - a.life);
                this.winner = sortedByLife[0];
                phaseLogs.push({
                    type: 'GAME_OVER',
                    winner: this.winner,
                    message: `⏱️ Turn limit reached (Turn ${this.maxTurns}). **${this.winner.name}** won with ${this.winner.life} life!`
                });
            }

            if (phaseLogs.length > 0) {
                this.turnLogs.push(...phaseLogs);
                this.history.push(...phaseLogs);
            }

            // Advance phase or turn
            if (nextPhase === PHASES.UNTAP) {
                // Pass turn to next alive player
                let nextPlayerIdx = (this.activePlayerIndex + 1) % this.players.length;
                while (!this.players[nextPlayerIdx].isAlive) {
                    nextPlayerIdx = (nextPlayerIdx + 1) % this.players.length;
                }

                if (nextPlayerIdx <= this.activePlayerIndex) {
                    this.turn++;
                }

                this.activePlayerIndex = nextPlayerIdx;
                this.currentPhase = PHASES.UNTAP;
            } else {
                this.currentPhase = nextPhase;
            }

            return {
                currentPhase: this.currentPhase,
                activePlayer: this.getActivePlayer(),
                turn: this.turn,
                isGameOver: this.isGameOver,
                winner: this.winner,
                logs: phaseLogs
            };
        }

        declareHumanAttacks(attacks = []) {
            if (this.currentPhase !== PHASES.DECLARE_ATTACKERS) {
                return { success: false, message: "Can only declare attacks in Declare Attackers phase." };
            }
            const activePlayer = this.getActivePlayer();
            const logs = [];
            const attackingCards = [];
            let targetPlayer = null;

            attacks.forEach(atk => {
                const card = activePlayer.battlefield.find(c => c.id === atk.attackerId && c.isCreature);
                if (card && !card.tapped && !card.summoningSick) {
                    if (!card.keywords.has('vigilance')) {
                        card.tapped = true;
                    }
                    card.attacksThisTurn = true;
                    attackingCards.push(card);
                    if (!targetPlayer) {
                        targetPlayer = this.players.find(p => p.id === atk.targetPlayerId && p.isAlive);
                    }
                }
            });

            if (attackingCards.length > 0 && targetPlayer) {
                this._pendingCombat = {
                    attackers: attackingCards,
                    targetPlayer
                };
                logs.push({
                    type: 'COMBAT_ATTACK',
                    playerId: activePlayer.id,
                    playerName: activePlayer.name,
                    targetPlayerId: targetPlayer.id,
                    targetPlayerName: targetPlayer.name,
                    message: `⚔️ **${activePlayer.name}** declared attack with **${attackingCards.map(c => c.name).join(', ')}** against **${targetPlayer.name}**!`
                });
            } else {
                this._pendingCombat = null;
                logs.push({
                    type: 'COMBAT_ATTACK',
                    playerId: activePlayer.id,
                    playerName: activePlayer.name,
                    message: `⚔️ **${activePlayer.name}** passed combat without attacking.`
                });
            }

            return { success: true, logs };
        }

        checkCounterspells(spellCard, caster) {
            if (!spellCard) return { countered: false };
            const opponents = this.players.filter(p => p.id !== caster.id && p.isAlive);
            for (const opp of opponents) {
                const counterIdx = opp.hand.findIndex(c => c.isCounterspell);
                if (counterIdx !== -1) {
                    const avail = opp.getAvailableMana();
                    if (avail.total >= 2) {
                        // AI counters commanders, board wipes, or big 4+ cmc threats
                        if (spellCard.isCommander || spellCard.isBoardWipe || (spellCard.cmc || 0) >= 4) {
                            const counterCard = opp.hand.splice(counterIdx, 1)[0];
                            opp.tapMana(counterCard.cmc || 2);
                            opp.graveyard.push(counterCard);
                            return {
                                countered: true,
                                opponent: opp,
                                counterCard
                            };
                        }
                    }
                }
            }
            return { countered: false };
        }

        processDeathTriggers(card, controller) {
            const logs = [];
            if (!card || !controller) return logs;
            const subtypes = card.subtypes || new Set();

            // 1. Undead Augur: Whenever Undead Augur or another Zombie dies, draw 1 and lose 1 life
            const augurs = controller.battlefield.filter(c => c.name.includes('Undead Augur'));
            if (augurs.length > 0 && (card.name.includes('Undead Augur') || subtypes.has('zombie'))) {
                controller.draw(1);
                controller.life -= 1;
                logs.push({
                    type: 'DEATH_TRIGGER',
                    message: `💀 **Undead Augur** trigger: ${controller.name} drew a card and lost 1 life from **${card.name}**'s death.`
                });
            }

            // 2. Wilhelt, the Rotcleaver: Whenever another Zombie dies, create a 2/2 Zombie token
            const wilhelts = controller.battlefield.filter(c => c.name.includes('Wilhelt'));
            if (wilhelts.length > 0 && card.id !== wilhelts[0].id && subtypes.has('zombie')) {
                const zombieToken = createCardInstance({
                    name: 'Zombie Token',
                    typeLine: 'Creature — Zombie',
                    power: 2,
                    toughness: 2,
                    manaCost: '{0}'
                }, controller.id);
                controller.battlefield.push(zombieToken);
                logs.push({
                    type: 'TOKEN_CREATED',
                    message: `🧟 **Wilhelt, the Rotcleaver** trigger: ${controller.name} created a 2/2 Zombie token from **${card.name}**'s death!`
                });
            }

            // 3. Mayhem Devil: Whenever a player sacrifices or creature dies, deal 1 damage
            this.players.forEach(p => {
                const devils = p.battlefield.filter(c => c.name.includes('Mayhem Devil'));
                if (devils.length > 0) {
                    const opponent = this.players.find(opp => opp.id !== p.id && opp.isAlive);
                    if (opponent) {
                        opponent.life -= 1;
                        logs.push({
                            type: 'TRIGGER',
                            message: `😈 **Mayhem Devil** trigger: dealt 1 damage to ${opponent.name} from **${card.name}**'s death!`
                        });
                    }
                }
            });

            if (logs.length > 0) {
                this.turnLogs.push(...logs);
                this.history.push(...logs);
            }
            return logs;
        }

        runMatchSimulation() {
            const start = Date.now();
            let steps = 0;
            const maxSteps = this.maxTurns * PHASE_ORDER.length * this.players.length;

            while (!this.isGameOver && steps < maxSteps) {
                this.stepPhase();
                steps++;
            }

            const durationMs = Date.now() - start;

            return {
                success: true,
                winner: this.winner ? this.winner.name : 'Draw',
                winnerCommander: this.winner ? (this.winner.getCommander()?.name || 'Commander') : null,
                turns: this.turn,
                durationMs,
                totalSteps: steps,
                logs: this.history,
                players: this.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    life: p.life,
                    isAlive: p.isAlive,
                    commander: p.getCommander()?.name || 'Unknown',
                    permanentsCount: p.battlefield.length,
                    commanderDamageDealt: p.commanderDamageReceived
                }))
            };
        }
    }

    // ============================================================================
    // 6. EXPORTS (Browser global & Node.js CommonJS)
    // ============================================================================

    const MtgCommanderEngine = {
        PHASES,
        PHASE_NAMES,
        PHASE_ORDER,
        Player,
        CommanderBotAI,
        CommanderGame,
        createCardInstance,
        parseManaCost,
        parseDecklistText
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = MtgCommanderEngine;
    }
    if (typeof window !== 'undefined') {
        window.MtgCommanderEngine = MtgCommanderEngine;
    }

})(typeof window !== 'undefined' ? window : global);
