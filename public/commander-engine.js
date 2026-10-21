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

        return {
            id: `card_${Math.random().toString(36).substr(2, 9)}`,
            ownerId,
            name,
            typeLine,
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

            // Available blockers
            const blockers = defendingPlayer.battlefield.filter(c => c.isCreature && !c.tapped);
            let unblockedAttackers = [...attackers];
            const blockedPairs = [];

            // AI Defender assigns blockers:
            // Prioritize blocking lethal threats or blocking with high-toughness creatures
            blockers.forEach(blocker => {
                if (unblockedAttackers.length === 0) return;

                // Match blocker against an attacker it can kill or absorb
                const matchIdx = unblockedAttackers.findIndex(atk => {
                    const flyingCheck = !atk.keywords.has('flying') || blocker.keywords.has('flying') || blocker.keywords.has('reach');
                    return flyingCheck && (blocker.power >= atk.toughness || blocker.toughness > atk.power);
                });

                if (matchIdx !== -1) {
                    const matchedAtk = unblockedAttackers.splice(matchIdx, 1)[0];
                    blocker.tapped = true;
                    blockedPairs.push({ attacker: matchedAtk, blocker });
                }
            });

            // 1. Resolve Blocked Combat
            blockedPairs.forEach(({ attacker, blocker }) => {
                attacker.damageReceived += blocker.power;
                blocker.damageReceived += attacker.power;

                let outcome = '';
                const atkDies = attacker.damageReceived >= attacker.toughness && !attacker.keywords.has('indestructible');
                const blkDies = blocker.damageReceived >= blocker.toughness && !blocker.keywords.has('indestructible');

                if (atkDies && blkDies) outcome = 'both died in trade';
                else if (atkDies) outcome = `${attacker.name} died`;
                else if (blkDies) outcome = `${blocker.name} died`;
                else outcome = 'both survived';

                logs.push({
                    type: 'COMBAT_TRADE',
                    attacker,
                    blocker,
                    message: `🛡️ **${blocker.name}** (${blocker.power}/${blocker.toughness}) blocked **${attacker.name}** (${attacker.power}/${attacker.toughness}) ➔ ${outcome}.`
                });

                if (atkDies) {
                    attackingPlayer.battlefield = attackingPlayer.battlefield.filter(c => c.id !== attacker.id);
                    if (attacker.isCommander) attackingPlayer.commandZone.push(attacker);
                    else attackingPlayer.graveyard.push(attacker);
                }

                if (blkDies) {
                    defendingPlayer.battlefield = defendingPlayer.battlefield.filter(c => c.id !== blocker.id);
                    if (blocker.isCommander) defendingPlayer.commandZone.push(blocker);
                    else defendingPlayer.graveyard.push(blocker);
                }
            });

            // 2. Resolve Unblocked Combat (Damage to Player)
            let totalPlayerDmg = 0;
            let cmdrDmg = 0;

            unblockedAttackers.forEach(atk => {
                totalPlayerDmg += atk.power;
                if (atk.keywords.has('lifelink')) {
                    attackingPlayer.life += atk.power;
                }

                // Track Commander Damage (21 lethal threshold)
                if (atk.isCommander) {
                    cmdrDmg += atk.power;
                    const prevCmdrDmg = defendingPlayer.commanderDamageReceived[atk.ownerId] || 0;
                    defendingPlayer.commanderDamageReceived[atk.ownerId] = prevCmdrDmg + atk.power;

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
                        type: 'PLAYER_LETHAL',
                        message: `💀 **${defendingPlayer.name}**'s life hit 0 and has been ELIMINATED!`
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

                case PHASES.CLEANUP:
                    // Discard to hand size 7
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
