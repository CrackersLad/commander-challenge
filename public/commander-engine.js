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
            // Mulligan Matrix (Rule 103.4c: First mulligan is free in multiplayer)
            this.mulliganCount = 0;
            this.hasKeptHand = false;

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
            this.commanderCard = this.commandZone[0] || null;
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

        takeMulligan(cardsToBottomIds = [], autoBottom = true) {
            this.mulliganCount += 1;
            // Shuffle hand back into library
            this.library.push(...this.hand);
            this.hand = [];
            this.library = this.shuffle(this.library);

            // Draw fresh 7 cards
            this.draw(7);

            // In multiplayer, 1st mulligan is FREE (Rule 103.4c)
            // Subsequent mulligans use London Mulligan: put (mulliganCount - 1) cards on bottom
            const cardsToBottomCount = Math.max(0, this.mulliganCount - 1);
            const returnedCards = [];

            if (autoBottom && cardsToBottomCount > 0) {
                if (Array.isArray(cardsToBottomIds) && cardsToBottomIds.length > 0) {
                    cardsToBottomIds.slice(0, cardsToBottomCount).forEach(cardId => {
                        const idx = this.hand.findIndex(c => c.id === cardId);
                        if (idx !== -1) {
                            const card = this.hand.splice(idx, 1)[0];
                            this.library.push(card);
                            returnedCards.push(card);
                        }
                    });
                }
                while (this.hand.length > (7 - cardsToBottomCount)) {
                    const excessLand = this.hand.filter(c => c.isLand).length > 3 ? this.hand.find(c => c.isLand) : null;
                    const cardToBottom = excessLand || [...this.hand].sort((a, b) => (b.cmc || 0) - (a.cmc || 0))[0];
                    if (cardToBottom) {
                        this.hand = this.hand.filter(c => c.id !== cardToBottom.id);
                        this.library.push(cardToBottom);
                        returnedCards.push(cardToBottom);
                    } else {
                        break;
                    }
                }
            }

            const isFree = this.mulliganCount === 1;
            return {
                success: true,
                mulliganCount: this.mulliganCount,
                isFree,
                cardsToBottomCount,
                returnedCards,
                log: {
                    type: 'MULLIGAN',
                    playerId: this.id,
                    playerName: this.name,
                    message: isFree 
                        ? `🔄 **${this.name}** took a **FREE Multiplayer Mulligan** (Hand size: 7).`
                        : `🔄 **${this.name}** took **Mulligan #${this.mulliganCount}** (Put ${cardsToBottomCount} card(s) to bottom, Hand size: ${this.hand.length}).`
                }
            };
        }

        bottomCards(cardsToBottomIds = []) {
            const cardsToBottomCount = Math.max(0, this.mulliganCount - 1);
            const returned = [];
            if (cardsToBottomCount > 0 && Array.isArray(cardsToBottomIds)) {
                cardsToBottomIds.slice(0, cardsToBottomCount).forEach(cardId => {
                    const idx = this.hand.findIndex(c => c.id === cardId);
                    if (idx !== -1) {
                        const card = this.hand.splice(idx, 1)[0];
                        this.library.push(card);
                        returned.push(card);
                    }
                });
            }
            return returned;
        }

        keepHand() {
            this.hasKeptHand = true;
            const isFree = this.mulliganCount === 1;
            return {
                success: true,
                playerId: this.id,
                playerName: this.name,
                handSize: this.hand.length,
                mulliganCount: this.mulliganCount,
                log: {
                    type: 'KEEP_HAND',
                    playerId: this.id,
                    playerName: this.name,
                    message: `✅ **${this.name}** kept an opening hand of **${this.hand.length}** cards${this.mulliganCount > 0 ? ` (after ${this.mulliganCount} mulligan${this.mulliganCount > 1 ? 's' : ''}${isFree ? ' - free mulligan used' : ''})` : ''}.`
                }
            };
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
                    if (c.isLand) {
                        total += 1;
                        (c.colors || []).forEach(col => {
                            if (colors[col] !== undefined) colors[col]++;
                        });
                    } else if (c.isManaRock || c.name.includes('Treasure')) {
                        if (c.name.includes('Sol Ring')) total += 2;
                        else total += 1;
                    } else if (c.name.includes('Elvish Archdruid')) {
                        const elfCount = this.battlefield.filter(x => x.subtypes && x.subtypes.has('elf')).length;
                        total += Math.max(1, elfCount);
                    } else if (c.name.includes('Marwyn')) {
                        total += Math.max(1, this.getEffectivePower(c));
                    } else if (c.name.includes('Llanowar Elves') || c.name.includes('Elvish Mystic')) {
                        total += 1;
                    }
                }
            });

            return { total, colors };
        }

        tapMana(amount = 1) {
            let tapped = 0;
            // Prefer basic lands, then mana rocks, then dorks
            const sortedManaSources = this.battlefield
                .filter(c => !c.tapped && (c.isLand || c.isManaRock || c.name.includes('Elves') || c.name.includes('Sol Ring') || c.name.includes('Signet') || c.name.includes('Talisman') || c.name.includes('Archdruid') || c.name.includes('Marwyn')))
                .sort((a, b) => (a.isLand ? -1 : 1));

            for (const card of sortedManaSources) {
                if (tapped >= amount) break;
                card.tapped = true;
                if (card.name.includes('Sol Ring')) tapped += 2;
                else if (card.name.includes('Elvish Archdruid')) {
                    const elfCount = this.battlefield.filter(x => x.subtypes && x.subtypes.has('elf')).length;
                    tapped += Math.max(1, elfCount);
                } else if (card.name.includes('Marwyn')) {
                    tapped += Math.max(1, this.getEffectivePower(card));
                } else {
                    tapped += 1;
                }
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

        getCommander() {
            // Rule 903.9a: If commander ever ended up in graveyard or exile, redirect to Command Zone
            if (this.commanderCard) {
                const inGraveIdx = this.graveyard.findIndex(c => c.id === this.commanderCard.id || c.name === this.commanderCard.name);
                if (inGraveIdx !== -1) {
                    const c = this.graveyard.splice(inGraveIdx, 1)[0];
                    c.tapped = false;
                    c.damageReceived = 0;
                    c.counters = {};
                    if (!this.commandZone.some(x => x.id === c.id || x.name === c.name)) {
                        this.commandZone.push(c);
                    }
                }
                const inExileIdx = this.exile.findIndex(c => c.id === this.commanderCard.id || c.name === this.commanderCard.name);
                if (inExileIdx !== -1) {
                    const c = this.exile.splice(inExileIdx, 1)[0];
                    c.tapped = false;
                    c.damageReceived = 0;
                    c.counters = {};
                    if (!this.commandZone.some(x => x.id === c.id || x.name === c.name)) {
                        this.commandZone.push(c);
                    }
                }
            }
            return this.commandZone.find(c => c.isCommander) || this.battlefield.find(c => c.isCommander) || this.commanderCard || null;
        }

        isCommanderInCommandZone() {
            const cmdr = this.getCommander();
            if (!cmdr) return false;
            return this.commandZone.some(c => c.id === cmdr.id || c.name === cmdr.name);
        }

        isCommanderOnBattlefield() {
            const cmdr = this.getCommander();
            if (!cmdr) return false;
            return this.battlefield.some(c => c.id === cmdr.id || c.name === cmdr.name);
        }

        canPlayLand(game = null) {
            if (this.landPlayedThisTurn) return false;
            if (game) {
                const active = game.getActivePlayer();
                if (!active || active.id !== this.id) return false;
                if (game.currentPhase !== PHASES.MAIN_1 && game.currentPhase !== PHASES.MAIN_2) return false;
            }
            return this.hand.some(c => c.isLand);
        }

        playLand(cardId, game = null) {
            if (game) {
                const active = game.getActivePlayer();
                if (!active || active.id !== this.id) {
                    return { success: false, message: "You can only play lands during your own turn!" };
                }
                if (game.currentPhase !== PHASES.MAIN_1 && game.currentPhase !== PHASES.MAIN_2) {
                    return { success: false, message: "Lands can only be played during your Main phase (MTG Rule 305.1)." };
                }
            }
            if (this.landPlayedThisTurn) {
                return { success: false, message: "You have already played a land this turn (MTG Rule 305.2)." };
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

        getCardCost(card, game = null) {
            if (!card) return 0;
            let cost = card.cmc || 0;
            const isDragon = (card.subtypes && card.subtypes.has('dragon')) || card.name.toLowerCase().includes('dragon');
            if (isDragon && !card.isLand) {
                // 1. The Ur-Dragon Eminence: reduces cost by 1 (even from command zone!)
                const hasUrDragon = this.commandZone.some(c => c.name.includes('Ur-Dragon')) || this.battlefield.some(c => c.name.includes('Ur-Dragon'));
                if (hasUrDragon) cost -= 1;

                // 2. Dragonlord's Servant: reduces cost by 1
                const servants = this.battlefield.filter(c => c.name.includes("Dragonlord's Servant")).length;
                cost -= servants;

                // 3. Dragonspeaker Shaman: reduces cost by 2
                const shamans = this.battlefield.filter(c => c.name.includes('Dragonspeaker Shaman')).length;
                cost -= (shamans * 2);
            }

            // Blasphemous Act: Costs {1} less for each creature on the battlefield
            if (card.name.includes('Blasphemous Act')) {
                let creatureCount = this.battlefield.filter(c => c.isCreature).length;
                if (game && game.players) {
                    creatureCount = game.players.reduce((sum, p) => sum + p.battlefield.filter(c => c.isCreature).length, 0);
                }
                cost = Math.max(1, cost - creatureCount); // At least {R} (1 mana)
            }

            return Math.max(0, cost);
        }

        canCastCard(card, game = null) {
            if (!card) return false;
            if (card.isLand) return this.canPlayLand(game);
            const cost = this.getCardCost(card, game);
            const available = this.getAvailableMana().total;
            if (available < cost) return false;

            // Instants & cards with Flash can be cast at any time
            if (card.isInstant || (card.keywords && card.keywords.has('flash'))) {
                return true;
            }

            // Other spells require player's Main phase
            if (game) {
                const active = game.getActivePlayer();
                if (!active || active.id !== this.id) return false;
                if (game.currentPhase !== PHASES.MAIN_1 && game.currentPhase !== PHASES.MAIN_2) return false;
            }
            return true;
        }

        findTarget(targetPermanentId, game) {
            if (!game || !game.players) return null;
            if (targetPermanentId) {
                for (const p of game.players.filter(x => x.id !== this.id && x.isAlive)) {
                    const t = p.battlefield.find(c => c.id === targetPermanentId);
                    if (t) return { target: t, owner: p };
                }
            }
            // Auto-target highest threat opponent permanent
            const opponents = game.players.filter(p => p.id !== this.id && p.isAlive);
            for (const opp of opponents) {
                const cmdr = opp.battlefield.find(c => c.isCommander && (!c.keywords || !c.keywords.has('hexproof')));
                if (cmdr) return { target: cmdr, owner: opp };

                const bigCreature = opp.battlefield
                    .filter(c => c.isCreature && (!c.keywords || !c.keywords.has('hexproof')))
                    .sort((a, b) => b.power - a.power)[0];
                if (bigCreature) return { target: bigCreature, owner: opp };

                const anyPerm = opp.battlefield.find(c => !c.keywords || !c.keywords.has('hexproof'));
                if (anyPerm) return { target: anyPerm, owner: opp };
            }
            return null;
        }

        castCard(cardId, game = null, targetPermanentId = null) {
            const idx = this.hand.findIndex(c => c.id === cardId);
            if (idx === -1) return { success: false, message: "Card not in hand." };
            const card = this.hand[idx];
            if (card.isLand) return this.playLand(cardId, game);

            const cost = this.getCardCost(card, game);
            const available = this.getAvailableMana().total;
            if (available < cost) {
                return { success: false, message: `Not enough mana. Need ${cost}, have ${available}. Tap lands/rocks first!` };
            }

            // Check if opponents counter the spell
            if (game && game.checkCounterspells) {
                const counterRes = game.checkCounterspells(card, this);
                if (counterRes.countered) {
                    this.tapMana(cost);
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

            this.tapMana(cost);
            this.hand.splice(idx, 1);

            const logs = [{
                type: 'SPELL_CAST',
                playerId: this.id,
                playerName: this.name,
                card,
                message: `⚡ **${this.name}** cast **${card.name}** (${card.typeLine}) for **${cost}** mana.`
            }];

            if (card.isCreature || card.isArtifact || card.isEnchantment || card.isPlaneswalker) {
                card.tapped = false;
                card.summoningSick = !card.keywords.has('haste');
                this.battlefield.push(card);

                // Run ETB triggers
                if (game && game.triggerETB) {
                    const etbLogs = game.triggerETB(card, this);
                    if (etbLogs && etbLogs.length > 0) logs.push(...etbLogs);
                }
            } else if (card.isSorcery || card.isInstant) {
                this.graveyard.push(card);

                // 1. Beast Within: Destroy target permanent, its controller gets 3/3 Beast token
                if (card.name.includes('Beast Within')) {
                    const targetInfo = this.findTarget(targetPermanentId, game);
                    if (targetInfo) {
                        const { target, owner } = targetInfo;
                        owner.sendToGraveyardOrCommandZone(target, game);
                        const beastToken = createCardInstance({
                            name: 'Beast Token',
                            typeLine: 'Creature — Beast',
                            power: 3,
                            toughness: 3,
                            manaCost: '{0}'
                        }, owner.id);
                        owner.battlefield.push(beastToken);
                        logs.push({
                            type: 'REMOVAL',
                            message: `🎯 **${this.name}** cast **Beast Within**, destroying ${owner.name}'s **${target.name}**! ${owner.name} created a 3/3 green Beast token.`
                        });
                    }
                }
                // 2. Swords to Plowshares: Exile target creature, controller gains life equal to power
                else if (card.name.includes('Swords to Plowshares')) {
                    const targetInfo = this.findTarget(targetPermanentId, game);
                    if (targetInfo) {
                        const { target, owner } = targetInfo;
                        const lifeGain = owner.getEffectivePower(target);
                        owner.sendToGraveyardOrCommandZone(target, game);
                        owner.life += lifeGain;
                        logs.push({
                            type: 'REMOVAL',
                            message: `🎯 **${this.name}** cast **Swords to Plowshares**, exiling ${owner.name}'s **${target.name}**! ${owner.name} gained **${lifeGain}** life.`
                        });
                    }
                }
                // 3. Chaos Warp: Shuffle target into library, owner reveals top card
                else if (card.name.includes('Chaos Warp')) {
                    const targetInfo = this.findTarget(targetPermanentId, game);
                    if (targetInfo) {
                        const { target, owner } = targetInfo;
                        owner.battlefield = owner.battlefield.filter(c => c.id !== target.id);
                        if (target.isCommander) {
                            owner.sendToGraveyardOrCommandZone(target, game);
                        } else {
                            owner.library.push(target);
                            owner.library = owner.shuffle(owner.library);
                        }
                        let revealedMsg = 'revealed a non-permanent card.';
                        if (owner.library.length > 0) {
                            const revealed = owner.library.shift();
                            if (revealed.isPermanent || revealed.isLand || revealed.isCreature || revealed.isArtifact || revealed.isEnchantment) {
                                revealed.tapped = false;
                                revealed.summoningSick = !revealed.keywords.has('haste');
                                owner.battlefield.push(revealed);
                                revealedMsg = `revealed **${revealed.name}** and put it onto the battlefield!`;
                            } else {
                                owner.graveyard.push(revealed);
                                revealedMsg = `revealed **${revealed.name}** (put into graveyard).`;
                            }
                        }
                        logs.push({
                            type: 'REMOVAL',
                            message: `🌀 **${this.name}** cast **Chaos Warp** on ${owner.name}'s **${target.name}**! ${owner.name} ${revealedMsg}`
                        });
                    }
                }
                // 4. Feed the Swarm: Destroy target creature or enchantment, lose life equal to CMC
                else if (card.name.includes('Feed the Swarm')) {
                    const targetInfo = this.findTarget(targetPermanentId, game);
                    if (targetInfo) {
                        const { target, owner } = targetInfo;
                        const lifeLoss = target.cmc || 0;
                        owner.sendToGraveyardOrCommandZone(target, game);
                        this.life -= lifeLoss;
                        logs.push({
                            type: 'REMOVAL',
                            message: `🎯 **${this.name}** cast **Feed the Swarm**, destroying ${owner.name}'s **${target.name}** and losing **${lifeLoss}** life.`
                        });
                    }
                }
                // 5. Bedevil: Destroy target artifact, creature, or planeswalker
                else if (card.name.includes('Bedevil')) {
                    const targetInfo = this.findTarget(targetPermanentId, game);
                    if (targetInfo) {
                        const { target, owner } = targetInfo;
                        owner.sendToGraveyardOrCommandZone(target, game);
                        logs.push({
                            type: 'REMOVAL',
                            message: `🎯 **${this.name}** cast **Bedevil**, destroying ${owner.name}'s **${target.name}**!`
                        });
                    }
                }
                // 6. Deadly Dispute: Sac artifact/creature, draw 2 cards and create a Treasure token
                else if (card.name.includes('Deadly Dispute')) {
                    const sac = this.battlefield.find(c => c.name.includes('Treasure') || (c.isCreature && !c.isCommander)) || this.battlefield.find(c => c.isCreature);
                    if (sac) {
                        this.sendToGraveyardOrCommandZone(sac, game);
                    }
                    const drawn = this.draw(2);
                    const treasure = createCardInstance({
                        name: 'Treasure Token',
                        typeLine: 'Artifact — Treasure',
                        manaCost: '{0}',
                        oracleText: '{T}, Sacrifice: Add one mana of any color.'
                    }, this.id);
                    treasure.isManaRock = true;
                    this.battlefield.push(treasure);
                    logs.push({
                        type: 'SPELL_CAST',
                        message: `💰 **${this.name}** cast **Deadly Dispute**${sac ? ` (sacrificed ${sac.name})` : ''}, drew **2** cards and created a **Treasure token**!`
                    });
                }
                // 7. Jeska's Will: Add red mana and exile cards to play
                else if (card.name.includes("Jeska's Will")) {
                    const opp = game ? game.players.find(p => p.id !== this.id && p.isAlive) : null;
                    const count = opp ? opp.hand.length : 4;
                    const drawn = [];
                    for (let i = 0; i < 3 && this.library.length > 0; i++) {
                        const ex = this.library.shift();
                        this.exile.push(ex);
                        drawn.push(ex.name);
                    }
                    logs.push({
                        type: 'SPELL_CAST',
                        message: `🔥 **${this.name}** cast **Jeska's Will**! Added **${count}** red mana and exiled **${drawn.join(', ')}** to play this turn.`
                    });
                }
                // 8. Board Wipe (e.g. Blasphemous Act)
                else if (card.isBoardWipe || card.name.includes('Blasphemous Act')) {
                    if (game && game.players) {
                        game.players.forEach(p => {
                            const toRemove = [];
                            p.battlefield.filter(c => c.isCreature).forEach(c => {
                                if (c.keywords.has('indestructible')) {
                                    logs.push({
                                        type: 'INDESTRUCTIBLE',
                                        message: `🛡️ **${c.name}** (${p.name}) survived with Indestructible!`
                                    });
                                } else {
                                    toRemove.push(c);
                                }
                            });
                            toRemove.forEach(c => p.sendToGraveyardOrCommandZone(c, game));
                        });
                    }
                    logs.push({
                        type: 'BOARD_WIPE',
                        message: `💥 **${this.name}** cast **${card.name}**, dealing 13 damage to all creatures!`
                    });
                }
                // 9. Ramp (Cultivate / Farseek)
                else if (card.isRampSpell) {
                    const basic = this.library.find(c => c.isLand);
                    if (basic) {
                        this.library = this.library.filter(c => c.id !== basic.id);
                        basic.tapped = true;
                        this.battlefield.push(basic);
                        logs.push({
                            type: 'RAMP',
                            message: `🌱 **${this.name}** put **${basic.name}** onto the battlefield tapped.`
                        });
                    }
                    if (card.name.includes('Cultivate')) {
                        const secondLand = this.library.find(c => c.isLand);
                        if (secondLand) {
                            this.library = this.library.filter(c => c.id !== secondLand.id);
                            this.hand.push(secondLand);
                            logs.push({
                                type: 'RAMP',
                                message: `🌱 **${this.name}** put **${secondLand.name}** into hand with Cultivate.`
                            });
                        }
                    }
                }
                // 10. Draw spells
                else if (card.isDrawSpell) {
                    const drawn = this.draw(2);
                    logs.push({
                        type: 'DRAW',
                        message: `📜 **${this.name}** drew **${drawn.length}** cards.`
                    });
                }
                // 11. Generic Removal fallback
                else if (card.isRemoval) {
                    const targetInfo = this.findTarget(targetPermanentId, game);
                    if (targetInfo) {
                        const { target, owner } = targetInfo;
                        owner.sendToGraveyardOrCommandZone(target, game);
                        logs.push({
                            type: 'REMOVAL',
                            message: `🎯 **${this.name}** destroyed ${owner.name}'s **${target.name}** with **${card.name}**!`
                        });
                    }
                }
            }

            return { success: true, card, logs };
        }

        canCastCommander(game = null) {
            const cmdr = this.getCommander();
            if (!cmdr) return false;
            if (!this.isCommanderInCommandZone()) return false;
            if (game) {
                const active = game.getActivePlayer();
                if (!active || active.id !== this.id) return false;
                if (game.currentPhase !== PHASES.MAIN_1 && game.currentPhase !== PHASES.MAIN_2) return false;
            }
            const cost = (cmdr.cmc || 0) + this.commanderTax;
            return this.getAvailableMana().total >= cost;
        }

        castCommander(game = null) {
            const cmdr = this.getCommander();
            if (!cmdr) return { success: false, message: "No Commander assigned to deck." };
            if (!this.isCommanderInCommandZone()) {
                return { success: false, message: `**${cmdr.name}** is already on the battlefield!` };
            }
            if (game) {
                const active = game.getActivePlayer();
                if (!active || active.id !== this.id) {
                    return { success: false, message: "You can only cast your Commander during your turn!" };
                }
                if (game.currentPhase !== PHASES.MAIN_1 && game.currentPhase !== PHASES.MAIN_2) {
                    return { success: false, message: "Commanders can only be cast during a Main phase (MTG Rule 305.1 / 903.8)." };
                }
            }

            const totalCost = (cmdr.cmc || 0) + this.commanderTax;
            const available = this.getAvailableMana().total;
            if (available < totalCost) {
                return { success: false, message: `Need ${totalCost} mana (Tax: {${this.commanderTax}}), have ${available}. Tap lands/rocks first!` };
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
            cmdr.damageReceived = 0;
            this.battlefield.push(cmdr);
            this.commanderTax += 2;
            this.commanderCastCount += 1;

            const logs = [{
                type: 'COMMANDER_CAST',
                playerId: this.id,
                playerName: this.name,
                card: cmdr,
                message: `👑 **${this.name}** cast Commander **${cmdr.name}** for **${totalCost}** mana (Tax was {${this.commanderTax - 2}}).`
            }];

            if (game && game.triggerETB) {
                const etbLogs = game.triggerETB(cmdr, this);
                if (etbLogs && etbLogs.length > 0) logs.push(...etbLogs);
            }

            return {
                success: true,
                card: cmdr,
                logs
            };
        }

        sendToGraveyardOrCommandZone(card, game = null) {
            if (!card) return;
            this.battlefield = this.battlefield.filter(c => c.id !== card.id);
            const isCmdr = card.isCommander || (this.commanderCard && (card.id === this.commanderCard.id || card.name === this.commanderCard.name));
            if (isCmdr) {
                // Rule 903.9a: Move commander back to command zone
                card.tapped = false;
                card.summoningSick = true;
                card.damageReceived = 0;
                card.counters = {};
                card.attacksThisTurn = false;
                if (!this.commandZone.some(c => c.id === card.id || c.name === card.name)) {
                    this.commandZone.push(card);
                }
            } else {
                this.graveyard.push(card);
            }
            if (game && game.processDeathTriggers) {
                game.processDeathTriggers(card, this);
            }
        }

        toggleTapPermanent(cardId) {
            const card = this.battlefield.find(c => c.id === cardId);
            if (card) {
                card.tapped = !card.tapped;
                return true;
            }
            return false;
        }
    }

    // ============================================================================
    // 4. HEURISTIC BOT CONTROLLER (Reverse-engineered from Forge AI)
    // ============================================================================

    class CommanderBotAI {
        static evaluateOpeningHand(botPlayer) {
            const hand = botPlayer.hand;
            const lands = hand.filter(c => c.isLand).length;
            const earlySpells = hand.filter(c => !c.isLand && (c.cmc || 0) <= 3).length;
            const rocksOrRamp = hand.filter(c => c.isManaRock || c.isRampSpell).length;
            const mullCount = botPlayer.mulliganCount;

            // Maximum mulligans safety stop (don't mulligan down to unplayable < 5 cards)
            if (mullCount >= 3) {
                return { shouldKeep: true, reason: 'Deep mulligan safety stop' };
            }

            // Severe mana screw (0 lands) or severe mana flood (6+ lands)
            if (lands === 0) {
                return { shouldKeep: false, reason: 'Zero lands in opening hand' };
            }
            if (lands >= 6) {
                return { shouldKeep: false, reason: 'Mana flood (6+ lands)' };
            }

            // 1 Land hand
            if (lands === 1) {
                const hasOneManaRamp = hand.some(c => (c.isManaRock || c.isRampSpell) && (c.cmc || 0) <= 1);
                if (hasOneManaRamp && earlySpells >= 2 && mullCount >= 1) {
                    return { shouldKeep: true, reason: '1 land with Sol Ring / cheap ramp' };
                }
                return { shouldKeep: false, reason: 'Mana screw (only 1 land)' };
            }

            // 5 Land hand
            if (lands === 5) {
                if (earlySpells === 0 && mullCount === 0) {
                    // Free mulligan available, take it to find early action!
                    return { shouldKeep: false, reason: 'Free mulligan on slow 5-land hand' };
                }
                return { shouldKeep: true, reason: '5 lands with playable spells' };
            }

            // 2 Lands
            if (lands === 2) {
                // If on mulligan 0 (FREE Mulligan!), be picky: mulligan if no plays <= 3 cmc and no ramp
                if (mullCount === 0 && earlySpells === 0 && rocksOrRamp === 0) {
                    return { shouldKeep: false, reason: 'Free mulligan on slow 2-land hand without early plays' };
                }
                return { shouldKeep: true, reason: 'Solid 2-land hand with curve' };
            }

            // 3 or 4 lands is almost always a keep in Commander
            return { shouldKeep: true, reason: `Ideal hand (${lands} lands, ${earlySpells} early plays)` };
        }

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
            if (cmdr && player.isCommanderInCommandZone()) {
                const requiredCost = (cmdr.cmc || 0) + player.commanderTax;
                // Cast commander if we have sufficient mana and curve warrants it
                if (availableMana >= requiredCost && (player.battlefield.filter(c => c.isCreature).length >= 1 || game.turn >= 3 || requiredCost <= 3)) {
                    const castRes = player.castCommander(game);
                    if (castRes && castRes.success) {
                        availableMana -= requiredCost;
                        logs.push(...(castRes.logs || []));
                    }
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

                            // Resolve removal on target using safe rule 903.9a redirection
                            const isCmdr = targetPermanent.isCommander || (leadThreat.commanderCard && (targetPermanent.id === leadThreat.commanderCard.id || targetPermanent.name === leadThreat.commanderCard.name));
                            leadThreat.sendToGraveyardOrCommandZone(targetPermanent, game);
                            logs.push({
                                type: 'REMOVAL',
                                playerId: player.id,
                                playerName: player.name,
                                card: removalCard,
                                target: targetPermanent,
                                message: isCmdr
                                    ? `🎯 ${player.name} targeted and destroyed **${targetPermanent.name}** (${leadThreat.name}'s Commander) with **${removalCard.name}**! (Redirected to Command Zone).`
                                    : `🎯 ${player.name} destroyed ${leadThreat.name}'s **${targetPermanent.name}** with **${removalCard.name}**.`
                            });
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
                    // MTG Rule 509.1: Blockers do NOT tap when blocking
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
                    attackingPlayer.sendToGraveyardOrCommandZone(attacker, game);
                }

                if (blkDies) {
                    defendingPlayer.sendToGraveyardOrCommandZone(blocker, game);
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

                if (game && game.triggerCombatDamage) {
                    const trigLogs = game.triggerCombatDamage(atk, attackingPlayer, defendingPlayer, atkPower);
                    if (trigLogs && trigLogs.length > 0) logs.push(...trigLogs);
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
        constructor(config = {}) {
            const isArray = Array.isArray(config);
            const players = isArray ? config : (config.players || []);
            const format = isArray ? 'Commander' : (config.format || 'Commander');
            const maxTurns = isArray ? 30 : (config.maxTurns || 30);

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
                if (p instanceof Player) {
                    this.players.push(p);
                } else {
                    this.players.push(new Player(p.id || `p_${idx + 1}`, p.name || `Player ${idx + 1}`, p.deck || p.cards || [], p.isAI !== false, p.avatar));
                }
            });

            // Initial 7 card hand draw if not already drawn
            this.players.forEach(p => {
                if (p.hand.length === 0) p.draw(7);
            });
        }

        resolveBotMulligans() {
            const logs = [];
            const botPlayers = this.players.filter(p => p.isAI && p.isAlive && !p.hasKeptHand);

            botPlayers.forEach(bot => {
                let attempts = 0;
                while (!bot.hasKeptHand && attempts < 5) {
                    attempts++;
                    const evalResult = CommanderBotAI.evaluateOpeningHand(bot);
                    if (evalResult.shouldKeep) {
                        const keepRes = bot.keepHand();
                        logs.push(keepRes.log);
                        break;
                    } else {
                        const mullRes = bot.takeMulligan([], true);
                        logs.push(mullRes.log);
                    }
                }
                if (!bot.hasKeptHand) {
                    const keepRes = bot.keepHand();
                    logs.push(keepRes.log);
                }
            });

            if (logs.length > 0) {
                this.turnLogs.push(...logs);
                this.history.push(...logs);
            }
            return logs;
        }

        resolveAllMulligans() {
            const logs = [];
            this.players.forEach(p => {
                if (!p.hasKeptHand) {
                    if (p.isAI) {
                        let attempts = 0;
                        while (!p.hasKeptHand && attempts < 5) {
                            attempts++;
                            const evalResult = CommanderBotAI.evaluateOpeningHand(p);
                            if (evalResult.shouldKeep) {
                                const keepRes = p.keepHand();
                                logs.push(keepRes.log);
                                break;
                            } else {
                                const mullRes = p.takeMulligan([], true);
                                logs.push(mullRes.log);
                            }
                        }
                        if (!p.hasKeptHand) {
                            const keepRes = p.keepHand();
                            logs.push(keepRes.log);
                        }
                    } else {
                        // Human player auto-keeps if running headless simulation
                        const keepRes = p.keepHand();
                        logs.push(keepRes.log);
                    }
                }
            });

            if (logs.length > 0) {
                this.turnLogs.push(...logs);
                this.history.push(...logs);
            }
            return logs;
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
                    activePlayer.landPlayedThisTurn = false;
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
                        if (combatPlan.attackers.length > 0) {
                            const atkTrigs = this.triggerAttacks(combatPlan.attackers, activePlayer, combatPlan.targetPlayer);
                            if (atkTrigs.length > 0) phaseLogs.push(...atkTrigs);
                        }
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
                const nextP = this.getActivePlayer();
                if (nextP) {
                    nextP.untapAll();
                    nextP.landPlayedThisTurn = false;
                }
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

            // 4. Marionette Master: When artifact dies, opponent loses life equal to Marionette Master's power
            if (card.isArtifact || (card.typeLine && card.typeLine.toLowerCase().includes('artifact'))) {
                const masters = controller.battlefield.filter(c => c.name.includes('Marionette Master'));
                masters.forEach(mm => {
                    const pwr = controller.getEffectivePower(mm) || 1;
                    const opponents = this.players.filter(opp => opp.id !== controller.id && opp.isAlive);
                    opponents.forEach(opp => {
                        opp.life -= pwr;
                        logs.push({
                            type: 'TRIGGER',
                            message: `⚙️ **Marionette Master** trigger: ${opp.name} lost **${pwr}** life from **${card.name}** dying!`
                        });
                    });
                });
            }

            if (logs.length > 0) {
                this.turnLogs.push(...logs);
                this.history.push(...logs);
            }
            return logs;
        }

        triggerETB(card, controller) {
            const logs = [];
            if (!card || !controller) return logs;

            // 1. Reclamation Sage: Destroy target artifact or enchantment
            if (card.name.includes('Reclamation Sage')) {
                const opponents = this.players.filter(p => p.id !== controller.id && p.isAlive);
                for (const opp of opponents) {
                    const target = opp.battlefield.find(c => (c.isArtifact || c.isEnchantment) && (!c.keywords || (!c.keywords.has('indestructible') && !c.keywords.has('hexproof'))));
                    if (target) {
                        opp.sendToGraveyardOrCommandZone(target, this);
                        logs.push({
                            type: 'ETB_TRIGGER',
                            message: `🌿 **Reclamation Sage** ETB: Destroyed ${opp.name}'s **${target.name}**!`
                        });
                        break;
                    }
                }
            }

            // 2. Scourge of Valkas: Deal X damage to target opponent (X = number of Dragons)
            if (card.name.includes('Scourge of Valkas') || (card.subtypes && card.subtypes.has('dragon'))) {
                const valkasCards = controller.battlefield.filter(c => c.name.includes('Scourge of Valkas'));
                if (valkasCards.length > 0) {
                    const dragonsCount = controller.battlefield.filter(c => c.name.includes('Dragon') || (c.subtypes && c.subtypes.has('dragon'))).length;
                    const opponents = this.players.filter(p => p.id !== controller.id && p.isAlive);
                    if (opponents.length > 0) {
                        const targetOpp = opponents[0];
                        targetOpp.life -= dragonsCount;
                        logs.push({
                            type: 'ETB_TRIGGER',
                            message: `🔥 **Scourge of Valkas** trigger: Dealt **${dragonsCount}** damage to ${targetOpp.name}!`
                        });
                        if (targetOpp.life <= 0) targetOpp.eliminate("Reduced to 0 life by dragon breath.");
                    }
                }
            }

            // 3. Diregraf Colossus: Enters with +1/+1 counters equal to number of Zombie cards in graveyard
            if (card.name.includes('Diregraf Colossus')) {
                const zombiesInGrave = controller.graveyard.filter(c => c.name.includes('Zombie') || (c.subtypes && c.subtypes.has('zombie'))).length;
                if (zombiesInGrave > 0) {
                    card.counters['+1/+1'] = (card.counters['+1/+1'] || 0) + zombiesInGrave;
                    logs.push({
                        type: 'ETB_TRIGGER',
                        message: `🧟 **Diregraf Colossus** entered with **${zombiesInGrave}** +1/+1 counters!`
                    });
                }
            }

            // 4. Marwyn, the Nurturer: Whenever another Elf enters, put a +1/+1 counter on Marwyn
            if (card.subtypes && card.subtypes.has('elf')) {
                const marwyns = controller.battlefield.filter(c => c.name.includes('Marwyn') && c.id !== card.id);
                marwyns.forEach(m => {
                    m.counters['+1/+1'] = (m.counters['+1/+1'] || 0) + 1;
                    logs.push({
                        type: 'TRIGGER',
                        message: `🌱 **Marwyn, the Nurturer** gained a +1/+1 counter from **${card.name}** entering!`
                    });
                });
            }

            // 5. Diregraf Colossus cast/ETB Zombie token:
            if (card.subtypes && card.subtypes.has('zombie')) {
                const colossi = controller.battlefield.filter(c => c.name.includes('Diregraf Colossus') && c.id !== card.id);
                if (colossi.length > 0) {
                    const token = createCardInstance({
                        name: 'Zombie Token',
                        typeLine: 'Creature — Zombie',
                        power: 2,
                        toughness: 2,
                        manaCost: '{0}'
                    }, controller.id);
                    token.tapped = true;
                    controller.battlefield.push(token);
                    logs.push({
                        type: 'TOKEN_CREATED',
                        message: `🧟 **Diregraf Colossus** trigger: Created a tapped 2/2 Zombie token!`
                    });
                }
            }

            if (logs.length > 0) {
                this.turnLogs.push(...logs);
                this.history.push(...logs);
            }
            return logs;
        }

        triggerAttacks(attackers, attackerPlayer, targetPlayer) {
            const logs = [];
            if (!attackers || attackers.length === 0 || !attackerPlayer) return logs;

            // 1. Atarka, World Render: Whenever a Dragon attacks, it gains double strike until end of combat
            const hasAtarka = attackerPlayer.battlefield.some(c => c.name.includes('Atarka, World Render'));
            if (hasAtarka) {
                attackers.forEach(atk => {
                    if (atk.name.includes('Dragon') || (atk.subtypes && atk.subtypes.has('dragon'))) {
                        atk.keywords.add('double strike');
                    }
                });
                logs.push({
                    type: 'TRIGGER',
                    message: `🐉 **Atarka, World Render** trigger: Attacking dragons gained **Double Strike**!`
                });
            }

            // 2. Utvara Hellkite: Whenever a Dragon attacks, create a 6/6 red Dragon creature token with flying
            const hasUtvara = attackerPlayer.battlefield.some(c => c.name.includes('Utvara Hellkite'));
            if (hasUtvara) {
                const attackingDragons = attackers.filter(atk => atk.name.includes('Dragon') || (atk.subtypes && atk.subtypes.has('dragon'))).length;
                for (let i = 0; i < attackingDragons; i++) {
                    const dragonToken = createCardInstance({
                        name: 'Dragon Token',
                        typeLine: 'Creature — Dragon',
                        power: 6,
                        toughness: 6,
                        manaCost: '{0}',
                        oracleText: 'Flying'
                    }, attackerPlayer.id);
                    dragonToken.tapped = false;
                    dragonToken.summoningSick = true;
                    attackerPlayer.battlefield.push(dragonToken);
                }
                logs.push({
                    type: 'TOKEN_CREATED',
                    message: `🐲 **Utvara Hellkite** trigger: Created **${attackingDragons}** 6/6 red Dragon token(s) with Flying!`
                });
            }

            // 3. The Ur-Dragon: Whenever one or more Dragons attack, draw that many cards, then put permanent from hand onto battlefield
            const hasUrDragon = attackerPlayer.battlefield.some(c => c.name.includes('The Ur-Dragon'));
            if (hasUrDragon) {
                const attackingDragons = attackers.filter(atk => atk.name.includes('Dragon') || (atk.subtypes && atk.subtypes.has('dragon'))).length;
                if (attackingDragons > 0) {
                    const drawn = attackerPlayer.draw(attackingDragons);
                    // Put a permanent card onto battlefield if in hand
                    const permIdx = attackerPlayer.hand.findIndex(c => c.isPermanent || c.isCreature || c.isLand || c.isArtifact || c.isEnchantment);
                    let droppedName = '';
                    if (permIdx !== -1) {
                        const dropped = attackerPlayer.hand.splice(permIdx, 1)[0];
                        dropped.tapped = false;
                        dropped.summoningSick = !dropped.keywords.has('haste');
                        attackerPlayer.battlefield.push(dropped);
                        droppedName = ` and put **${dropped.name}** onto the battlefield!`;
                    }
                    logs.push({
                        type: 'TRIGGER',
                        message: `👑 **The Ur-Dragon** attack trigger: Drew **${drawn.length}** card(s)${droppedName}`
                    });
                }
            }

            if (logs.length > 0) {
                this.turnLogs.push(...logs);
                this.history.push(...logs);
            }
            return logs;
        }

        triggerCombatDamage(attacker, attackerPlayer, defendingPlayer, damage) {
            const logs = [];
            if (!attacker || !attackerPlayer || damage <= 0) return logs;

            // 1. Lathril, Blade of the Elves: Whenever Lathril deals combat damage to a player, create that many 1/1 green Elf Warrior tokens
            if (attacker.name.includes('Lathril')) {
                for (let i = 0; i < damage; i++) {
                    const elfToken = createCardInstance({
                        name: 'Elf Warrior Token',
                        typeLine: 'Creature — Elf Warrior',
                        power: 1,
                        toughness: 1,
                        manaCost: '{0}'
                    }, attackerPlayer.id);
                    attackerPlayer.battlefield.push(elfToken);
                }
                logs.push({
                    type: 'TOKEN_CREATED',
                    message: `🧝 **Lathril, Blade of the Elves** trigger: Created **${damage}** 1/1 green Elf Warrior tokens!`
                });
            }

            // 2. Professional Face-Breaker: Whenever one or more creatures deal combat damage to player, create a Treasure token
            const hasFaceBreaker = attackerPlayer.battlefield.some(c => c.name.includes('Professional Face-Breaker'));
            if (hasFaceBreaker) {
                const treasure = createCardInstance({
                    name: 'Treasure Token',
                    typeLine: 'Artifact — Treasure',
                    manaCost: '{0}',
                    oracleText: '{T}, Sacrifice: Add one mana of any color.'
                }, attackerPlayer.id);
                treasure.isManaRock = true;
                attackerPlayer.battlefield.push(treasure);
                logs.push({
                    type: 'TOKEN_CREATED',
                    message: `💰 **Professional Face-Breaker** trigger: Created a Treasure token!`
                });
            }

            if (logs.length > 0) {
                this.turnLogs.push(...logs);
                this.history.push(...logs);
            }
            return logs;
        }

        runMatchSimulation() {
            // Ensure opening hand mulligans are resolved
            this.resolveAllMulligans();
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
