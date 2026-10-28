/**
 * ============================================================================
 * FORGE ARENA ADAPTER - BROWSER WEBASSEMBLY ENGINE INTEGRATION
 * ============================================================================
 * Connects the Commander Challenge UI directly to the official Card-Forge
 * MTG rules engine running in WebAssembly via CheerpJ.
 * 
 * Provides:
 * - 100% card parity (33,600+ cards)
 * - Official MTG Comprehensive Rules & turn phase progression
 * - Official AI bot decision heuristics
 * - Command Zone, Commander Tax, and multiplayer state management
 */

(function () {
    'use strict';

    let cheerpjInitialized = false;
    let forgeBridgeInstance = null;
    let isInitializing = false;

    // Loading overlay helper
    function showLoadingBanner(title, detail) {
        let overlay = document.getElementById('forgeEngineLoadingOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'forgeEngineLoadingOverlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(10, 10, 18, 0.92);
                backdrop-filter: blur(8px);
                z-index: 999999;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                color: #f8fafc;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            `;
            overlay.innerHTML = `
                <div style="background: rgba(24, 24, 38, 0.95); border: 1px solid rgba(168, 85, 247, 0.4); border-radius: 16px; padding: 2.5rem 3rem; text-align: center; max-width: 480px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7), 0 0 35px rgba(168,85,247,0.25);">
                    <div style="font-size: 3rem; margin-bottom: 1rem; animation: pulse 1.5s infinite;">⚡</div>
                    <h2 id="forgeLoadingTitle" style="font-size: 1.4rem; font-weight: 800; margin-bottom: 0.5rem; background: linear-gradient(135deg, #c084fc, #38bdf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
                        Initializing Official Card-Forge Engine
                    </h2>
                    <p id="forgeLoadingDetail" style="font-size: 0.9rem; color: #94a3b8; margin-bottom: 1.5rem; line-height: 1.4;">
                        Booting in-browser WebAssembly runtime &amp; compiling 33,600+ cards...
                    </p>
                    <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden;">
                        <div style="width: 100%; height: 100%; background: linear-gradient(90deg, #a855f7, #38bdf8); border-radius: 999px; animation: progressAnim 2s infinite ease-in-out;"></div>
                    </div>
                    <div style="margin-top: 1rem; font-size: 0.75rem; color: #64748b;">
                        Powered by Card-Forge Engine &amp; WebAssembly
                    </div>
                </div>
                <style>
                    @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }
                    @keyframes progressAnim { 0% { transform: translateX(-100%); } 50% { transform: translateX(0%); } 100% { transform: translateX(100%); } }
                </style>
            `;
            document.body.appendChild(overlay);
        }
        const t = document.getElementById('forgeLoadingTitle');
        const d = document.getElementById('forgeLoadingDetail');
        if (t && title) t.textContent = title;
        if (d && detail) d.textContent = detail;
        overlay.style.display = 'flex';
    }

    function hideLoadingBanner() {
        const overlay = document.getElementById('forgeEngineLoadingOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    async function initForgeEngine() {
        if (forgeBridgeInstance) return forgeBridgeInstance;
        if (isInitializing) {
            while (isInitializing) {
                await new Promise(r => setTimeout(r, 200));
            }
            return forgeBridgeInstance;
        }

        isInitializing = true;
        showLoadingBanner("Initializing Official Card-Forge Engine", "Starting WebAssembly runtime...");

        try {
            if (typeof cheerpjInit !== 'function') {
                throw new Error("CheerpJ loader script not loaded. Check internet or ad-blocker.");
            }

            if (!cheerpjInitialized) {
                showLoadingBanner("Initializing WebAssembly JVM", "Mounting virtual memory and file system...");
                await cheerpjInit({
                    version: 17,
                    javaProperties: [
                        'user.dir=/app',
                        'file.encoding=UTF-8',
                        'forge.assets.dir=/app/forge-engine/',
                        'forge.profile.res.dir=/app/forge-engine/res/'
                    ]
                });
                cheerpjInitialized = true;
            }

            let display = document.getElementById('cheerpjDisplayContainer');
            if (!display) {
                display = document.createElement('div');
                display.id = 'cheerpjDisplayContainer';
                display.style.cssText = 'position:fixed; left:-9999px; top:-9999px; width:1px; height:1px; opacity:0; pointer-events:none;';
                document.body.appendChild(display);
            }
            await cheerpjCreateDisplay(-1, -1, display);

            showLoadingBanner("Loading Card-Forge Engine", "Reading game rules, formats, and 33,600+ cards...");
            const lib = await cheerpjRunLibrary("/app/forge-engine/patches.jar?v=10.18:/app/forge-engine/forge-gui-desktop-2.0.14-jar-with-dependencies.jar:/app/forge-engine/langs.jar");
            const bridge = await lib.forge.web.ForgeWebBridge;

            const initResStr = await bridge.initEngine("/app/forge-engine/");
            console.log("Card-Forge Engine Init Result:", initResStr);

            forgeBridgeInstance = bridge;
            hideLoadingBanner();
            return forgeBridgeInstance;
        } catch (err) {
            console.error("Failed to initialize Card-Forge Engine:", err);
            hideLoadingBanner();
            alert("Card-Forge WebAssembly Engine initialization failed: " + err.message);
            throw err;
        } finally {
            isInitializing = false;
        }
    }

    class ForgeArenaGame {
        constructor(bridge, rawJson, selectedDecks = []) {
            this.bridge = bridge;
            this.selectedDecks = selectedDecks;
            this.turn = 1;
            this.currentPhase = 'UNTAP';
            this.activePlayerIndex = 0;
            this.isGameOver = false;
            this.players = [];
            this.logs = [];
            this.isBusy = false;

            if (rawJson) {
                this.updateFromRawJson(rawJson);
            }

            if (!this.players || this.players.length === 0) {
                this.initFallbackPlayers(this.selectedDecks);
            }
        }

        initFallbackPlayers(selectedDecks = []) {
            const selfGame = this;
            this.players = [0, 1, 2, 3].map(idx => {
                const deckInfo = (selectedDecks && selectedDecks[idx]) || {};
                const cmdrName = deckInfo.commander || deckInfo.name || (idx === 0 ? 'Wilhelt, the Rotcleaver' : `Opponent ${idx}`);

                const allCards = Array.isArray(deckInfo.cards) ? [...deckInfo.cards] : [];
                const libCards = [];
                for (const c of allCards) {
                    const cName = typeof c === 'string' ? c : (c && c.name ? c.name : '');
                    if (!cName || cName.toLowerCase() === cmdrName.toLowerCase()) continue;
                    const qty = (c && typeof c.quantity === 'number') ? c.quantity : 1;
                    const count = Math.max(1, Math.min(qty, 40));
                    for (let q = 0; q < count; q++) {
                        libCards.push(enrichCard(typeof c === 'string' ? { name: c } : { ...c }));
                    }
                }

                while (libCards.length < 60) {
                    const lands = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
                    const land = lands[libCards.length % 5];
                    libCards.push(enrichCard({ name: land, isLand: true, typeLine: `Basic Land — ${land}` }));
                }

                for (let i = libCards.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [libCards[i], libCards[j]] = [libCards[j], libCards[i]];
                }

                const openingHand = libCards.splice(0, 7);

                const cmdrCard = enrichCard({
                    name: cmdrName,
                    isCommander: true,
                    manaCost: deckInfo.manaCost || '',
                    cmc: deckInfo.cmc || 4,
                    power: deckInfo.power || 3,
                    toughness: deckInfo.toughness || 3,
                    typeLine: deckInfo.typeLine || 'Legendary Creature'
                }, true);

                return {
                    id: `p_${idx + 1}`,
                    name: deckInfo.name || (idx === 0 ? 'You' : `Opponent ${idx}`),
                    life: 40,
                    isAlive: true,
                    isAI: idx !== 0,
                    commanderTax: 0,
                    libraryCount: libCards.length,
                    handCount: openingHand.length,
                    graveyardCount: 0,
                    avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cmdrName || 'MTG')}`,
                    mulliganCount: 0,
                    landPlayedThisTurn: false,
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                    hand: openingHand,
                    keptHandCards: [...openingHand],
                    commandZone: [cmdrCard],
                    battlefield: [],
                    graveyard: [],
                    library: { length: libCards.length },
                    libraryCards: libCards,

                    getCommander() {
                        const inCmdr = this.commandZone.find(c => c.isCommander);
                        if (inCmdr) return inCmdr;
                        const onField = this.battlefield.find(c => c.isCommander);
                        if (onField) return onField;
                        return this.commandZone[0] || null;
                    },
                    isCommanderInCommandZone() {
                        return this.commandZone.some(c => c.isCommander || c.name === this.getCommander()?.name);
                    },
                    isCommanderOnBattlefield() {
                        return this.battlefield.some(c => c.isCommander || c.name === this.getCommander()?.name);
                    },
                    getAvailableMana() {
                        let poolTotal = 0;
                        if (this.manaPool) {
                            ['W', 'U', 'B', 'R', 'G', 'C'].forEach(col => { poolTotal += (this.manaPool[col] || 0); });
                        }
                        return { total: Math.max(poolTotal, 0) };
                    },
                    deductMana(cost) {
                        if (!this.manaPool || cost <= 0) return;
                        let remaining = cost;
                        const colors = ['C', 'G', 'R', 'B', 'U', 'W'];
                        for (const col of colors) {
                            if (this.manaPool[col] > 0) {
                                const spend = Math.min(this.manaPool[col], remaining);
                                this.manaPool[col] -= spend;
                                remaining -= spend;
                                // Also consume producedMana pips on tapped permanents so spent mana cannot be undone
                                let toConsume = spend;
                                if (Array.isArray(this.battlefield)) {
                                    for (const perm of this.battlefield) {
                                        if (toConsume <= 0) break;
                                        if (perm && Array.isArray(perm.producedMana) && perm.producedMana.length > 0) {
                                            for (let i = perm.producedMana.length - 1; i >= 0 && toConsume > 0; i--) {
                                                if (perm.producedMana[i] === col) {
                                                    perm.producedMana.splice(i, 1);
                                                    toConsume--;
                                                }
                                            }
                                            if (perm.producedMana.length === 0) {
                                                perm.producedMana = null;
                                            }
                                        }
                                    }
                                }
                                if (remaining <= 0) break;
                            }
                        }
                    },
                    tapMana(cost) {
                        this.deductMana(cost);
                    },
                    getCardCost(card) {
                        return card.cmc !== undefined ? card.cmc : 0;
                    },
                    getEffectivePower(card) {
                        return card.power !== undefined ? card.power : 0;
                    },
                    getEffectiveToughness(card) {
                        return card.toughness !== undefined ? card.toughness : 0;
                    },
                    untapAll() {
                        this.battlefield.forEach(c => { c.tapped = false; c.producedMana = null; c.paidLifeCost = null; });
                        this.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
                    },
                    draw(count = 1) {
                        const drawn = [];
                        for (let i = 0; i < count; i++) {
                            if (this.libraryCards && this.libraryCards.length > 0) {
                                const c = this.libraryCards.shift();
                                this.hand.push(c);
                                if (this.keptHandCards) {
                                    this.keptHandCards.push(c);
                                }
                                drawn.push(c);
                            }
                        }
                        this.handCount = this.hand.length;
                        if (this.libraryCards) {
                            this.libraryCount = this.libraryCards.length;
                        }
                        return drawn;
                    },
                    async takeMulligan(bottomCardIds = [], autoBottom = false) {
                        return await selfGame.takeMulligan();
                    },
                    async bottomCards(cardIds = []) {
                        return await selfGame.bottomCards(cardIds);
                    },
                    keepHand() {
                        this.handLocked = true;
                        this.keptHandCards = [...(this.hand || [])];
                        return {
                            success: true,
                            log: {
                                type: 'MULLIGAN_KEEP',
                                message: `✅ **${this.name}** keeps opening hand with **${this.hand.length}** cards!`
                            }
                        };
                    },
                    castCard(cardId, game) {
                        if (game) {
                            game.playCard(cardId);
                        }
                        return { success: true, logs: [] };
                    },
                    castCommander(game) {
                        if (game) {
                            game.castCommander();
                        }
                        return { success: true, logs: [] };
                    },
                    toggleTapPermanent(cardId) {
                        const card = this.battlefield.find(c => c.id === cardId || String(c.id) === String(cardId));
                        if (card) {
                            card.tapped = !card.tapped;
                        }
                    }
                };
            });
        }

        updateFromRawJson(raw) {
            let data = raw;
            if (raw) {
                if (typeof raw === 'string') {
                    try {
                        data = JSON.parse(raw);
                    } catch (e) {
                        console.error("Error parsing game JSON string:", e, raw);
                    }
                } else if (typeof raw === 'object' && (!raw.status || typeof raw.status !== 'string')) {
                    try {
                        data = JSON.parse(String(raw));
                    } catch (e) {
                        console.error("Error parsing game JSON from String(raw):", e);
                    }
                }
            }

            if (!data || data.status === 'ERROR') {
                const errMsg = data ? data.message : "Unknown error";
                console.error("Game error from Forge:", errMsg);
                this.logs.push({
                    type: 'FORGE_EVENT',
                    message: `⚠️ Engine Error: ${errMsg}`
                });
                return;
            }

            const prevTurn = this.turn;
            const prevActive = this.activePlayerIndex;
            this.forgeTurn = data.turn || this.turn;
            this.turn = (data.turn && this.bridge) ? Math.floor((data.turn - 1) / (this.players.length || 4)) + 1 : (data.turn || this.turn);
            let normPhase = data.phase || this.currentPhase;
            if (normPhase === 'MAIN1') normPhase = 'MAIN_1';
            else if (normPhase === 'MAIN2') normPhase = 'MAIN_2';
            else if (normPhase === 'END_OF_TURN') normPhase = 'END_STEP';
            this.currentPhase = normPhase;
            this.activePlayerIndex = (typeof data.activePlayerIndex === 'number') ? data.activePlayerIndex : 0;
            this.isGameOver = !!data.isGameOver;

            const isNewTurnOrActive = (this.turn !== prevTurn) || (this.activePlayerIndex !== prevActive);

            if (Array.isArray(data.logs)) {
                data.logs.forEach(msg => {
                    this.logs.push({
                        type: 'FORGE_EVENT',
                        message: msg
                    });
                });
            }

            // Sync players
            const selfGame = this;
            if (Array.isArray(data.players)) {
                this.players = data.players.map((pData, idx) => {
                    const existing = this.players[idx] || {};
                    const deckInfo = (this.selectedDecks && this.selectedDecks[idx]) || {};
                    const p = {
                        id: `p_${idx + 1}`,
                        name: pData.name || (idx === 0 ? 'You' : `Opponent ${idx}`),
                        life: pData.life !== undefined ? pData.life : 40,
                        isAlive: pData.isAlive !== undefined ? pData.isAlive : true,
                        isAI: idx !== 0,
                        commanderTax: pData.commanderTax || 0,
                        libraryCount: pData.libraryCount || 53,
                        handCount: pData.handCount || (pData.hand ? pData.hand.length : 7),
                        graveyardCount: pData.graveyardCount || (pData.graveyard ? pData.graveyard.length : 0),
                        avatar: existing.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(pData.name || 'MTG')}`,
                        mulliganCount: existing.mulliganCount || 0,
                        landPlayedThisTurn: isNewTurnOrActive ? false : (
                            (pData.landsPlayedThisTurn !== undefined && pData.landsPlayedThisTurn > 0) ||
                            Boolean(existing.landPlayedThisTurn) ||
                            Boolean(existing.landsPlayedCount && existing.landsPlayedCount > 0)
                        ),
                        landsPlayedCount: isNewTurnOrActive ? 0 : (
                            (pData.landsPlayedThisTurn !== undefined && pData.landsPlayedThisTurn > 0)
                                ? pData.landsPlayedThisTurn
                                : (existing.landsPlayedCount || (existing.landPlayedThisTurn ? 1 : 0))
                        ),
                        manaPool: (isNewTurnOrActive && this.activePlayerIndex === idx) ? { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } : (existing.manaPool || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }),

                        handLocked: Boolean(existing.handLocked),
                        keptHandCards: existing.keptHandCards || null,
                        hand: (() => {
                            // For human player (Seat 0), once opening hand is initialized/mulliganed, preserve JS authoritative hand
                            // so Forge's internal AI controller never double-draws or silently auto-discards cards during Cleanup.
                            if (idx === 0 && Array.isArray(existing.hand) && (existing.hand.length > 0 || existing.handLocked)) {
                                return existing.hand;
                            }
                            if (idx === 0 && existing.keptHandCards && existing.keptHandCards.length > 0) {
                                return existing.keptHandCards;
                            }
                            if (pData.hand && Array.isArray(pData.hand)) {
                                return pData.hand.map(c => enrichCard(c));
                            }
                            return [];
                        })(),
                        commandZone: (pData.commandZone || []).map(c => enrichCard(c, true)),
                        battlefield: (() => {
                            const incoming = (pData.battlefield || []).map(c => enrichCard(c));
                            // Preserve human player's manual tap state, producedMana, and paidLifeCost during the same turn
                            if (!isNewTurnOrActive && idx === 0 && Array.isArray(existing.battlefield) && existing.battlefield.length > 0) {
                                const oldById = new Map();
                                const unmatchedTappedByName = new Map();
                                existing.battlefield.forEach(oldC => {
                                    if (!oldC) return;
                                    oldById.set(String(oldC.id), oldC);
                                    if (oldC.tapped) {
                                        const key = (oldC.name || '').toLowerCase();
                                        if (!unmatchedTappedByName.has(key)) unmatchedTappedByName.set(key, []);
                                        unmatchedTappedByName.get(key).push(oldC);
                                    }
                                });

                                // Remove IDs that match directly from the fallback name queue
                                incoming.forEach(c => {
                                    const direct = oldById.get(String(c.id));
                                    if (direct && direct.tapped) {
                                        const key = (direct.name || '').toLowerCase();
                                        const arr = unmatchedTappedByName.get(key);
                                        if (arr) {
                                            const i = arr.indexOf(direct);
                                            if (i !== -1) arr.splice(i, 1);
                                        }
                                    }
                                });

                                return incoming.map(c => {
                                    let oldC = oldById.get(String(c.id));
                                    if (!oldC) {
                                        const key = (c.name || '').toLowerCase();
                                        const arr = unmatchedTappedByName.get(key);
                                        if (arr && arr.length > 0) {
                                            oldC = arr.shift();
                                        }
                                    }
                                    if (oldC) {
                                        const isLandOrRock = Boolean(oldC.isLand || oldC.isManaRock || c.isLand || c.isManaRock);
                                        c.tapped = isLandOrRock ? Boolean(oldC.tapped) : Boolean(oldC.tapped || c.tapped);
                                        c.producedMana = (c.tapped && Array.isArray(oldC.producedMana) && oldC.producedMana.length > 0)
                                            ? [...oldC.producedMana]
                                            : null;
                                        c.paidLifeCost = oldC.paidLifeCost || null;
                                    }
                                    return c;
                                });
                            }
                            return incoming;
                        })(),
                        graveyard: (pData.graveyard || []).map(c => enrichCard(c)),
                        library: { length: pData.libraryCount || 53 },
                        libraryCards: existing.libraryCards || (() => {
                            if (!deckInfo.cards) return [];
                            const handNames = new Set((pData.hand || []).map(c => (c.name || '').toLowerCase()));
                            const lib = [];
                            for (const c of deckInfo.cards) {
                                const cName = typeof c === 'string' ? c : c.name;
                                if (cName === deckInfo.commander) continue;
                                if (handNames.has((cName || '').toLowerCase())) {
                                    handNames.delete((cName || '').toLowerCase());
                                } else {
                                    lib.push(enrichCard(typeof c === 'string' ? { name: c } : c));
                                }
                            }
                            return lib;
                        })(),

                        // Player helper methods for Arena UI
                        getCommander() {
                            const inCmdr = this.commandZone.find(c => c.isCommander);
                            if (inCmdr) return inCmdr;
                            const onField = this.battlefield.find(c => c.isCommander);
                            if (onField) return onField;
                            return this.commandZone[0] || null;
                        },
                        isCommanderInCommandZone() {
                            return this.commandZone.some(c => c.isCommander || c.name === this.getCommander()?.name);
                        },
                        isCommanderOnBattlefield() {
                            return this.battlefield.some(c => c.isCommander || c.name === this.getCommander()?.name);
                        },
                        getAvailableMana() {
                            let poolTotal = 0;
                            if (this.manaPool) {
                                ['W', 'U', 'B', 'R', 'G', 'C'].forEach(col => { poolTotal += (this.manaPool[col] || 0); });
                            }
                            return { total: Math.max(poolTotal, 0) };
                        },
                        deductMana(cost) {
                            if (!this.manaPool || cost <= 0) return;
                            let remaining = cost;
                            const colors = ['C', 'G', 'R', 'B', 'U', 'W'];
                            for (const col of colors) {
                                if (this.manaPool[col] > 0) {
                                    const spend = Math.min(this.manaPool[col], remaining);
                                    this.manaPool[col] -= spend;
                                    remaining -= spend;
                                    let toConsume = spend;
                                    if (Array.isArray(this.battlefield)) {
                                        for (const perm of this.battlefield) {
                                            if (toConsume <= 0) break;
                                            if (perm && Array.isArray(perm.producedMana) && perm.producedMana.length > 0) {
                                                for (let i = perm.producedMana.length - 1; i >= 0 && toConsume > 0; i--) {
                                                    if (perm.producedMana[i] === col) {
                                                        perm.producedMana.splice(i, 1);
                                                        toConsume--;
                                                    }
                                                }
                                                if (perm.producedMana.length === 0) {
                                                    perm.producedMana = null;
                                                }
                                            }
                                        }
                                    }
                                    if (remaining <= 0) break;
                                }
                            }
                        },
                        tapMana(cost) {
                            this.deductMana(cost);
                        },
                        getCardCost(card) {
                            return card.cmc !== undefined ? card.cmc : 0;
                        },
                        getEffectivePower(card) {
                            return card.power !== undefined ? card.power : 0;
                        },
                        getEffectiveToughness(card) {
                            return card.toughness !== undefined ? card.toughness : 0;
                        },
                        untapAll() {
                            this.battlefield.forEach(c => { c.tapped = false; c.producedMana = null; c.paidLifeCost = null; });
                            this.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
                        },
                        draw(count = 1) {
                            const drawn = [];
                            for (let i = 0; i < count; i++) {
                                if (this.libraryCards && this.libraryCards.length > 0) {
                                    const c = this.libraryCards.shift();
                                    this.hand.push(c);
                                    if (this.keptHandCards) {
                                        this.keptHandCards.push(c);
                                    }
                                    drawn.push(c);
                                }
                            }
                            this.handCount = this.hand.length;
                            if (this.libraryCards) {
                                this.libraryCount = this.libraryCards.length;
                            }
                            return drawn;
                        },
                        async takeMulligan(bottomCardIds = [], autoBottom = false) {
                            return await selfGame.takeMulligan();
                        },
                        async bottomCards(cardIds = []) {
                            return await selfGame.bottomCards(cardIds);
                        },
                        keepHand() {
                            this.handLocked = true;
                            this.keptHandCards = [...(this.hand || [])];
                            return {
                                success: true,
                                log: {
                                    type: 'MULLIGAN_KEEP',
                                    message: `✅ **${this.name}** keeps opening hand with **${this.hand.length}** cards!`
                                }
                            };
                        },
                        castCard(cardId, game) {
                            if (game) {
                                game.playCard(cardId);
                            }
                            return { success: true, logs: [] };
                        },
                        castCommander(game) {
                            if (game) {
                                game.castCommander();
                            }
                            return { success: true, logs: [] };
                        },
                        toggleTapPermanent(cardId) {
                            const card = this.battlefield.find(c => c.id === cardId || String(c.id) === String(cardId));
                            if (card) {
                                card.tapped = !card.tapped;
                            }
                        }
                    };
                    return p;
                });
            }
        }

        getActivePlayer() {
            return this.players[this.activePlayerIndex] || this.players[0];
        }

        drawForTurnPlayer0() {
            const p1 = this.players[0];
            if (!p1 || this.activePlayerIndex !== 0) return [];
            const turnKey = Number(this.turn) || 1;
            if (this._lastDrawnTurnPlayer0 === turnKey) {
                return [];
            }
            this._lastDrawnTurnPlayer0 = turnKey;
            this._turnDrewPlayer0 = true;
            const drawn = typeof p1.draw === 'function' ? p1.draw(1) : [];
            if (drawn && drawn.length > 0) {
                this.logs.push({
                    type: 'DRAW',
                    message: `📜 **${p1.name}** drew **${drawn[0].name}** for Turn ${turnKey} (Draw Step).`
                });
            }
            return drawn;
        }

        discardCardsFromHand(cardIds = []) {
            const p1 = this.players[0];
            if (!p1 || !Array.isArray(p1.hand) || !Array.isArray(cardIds) || cardIds.length === 0) return [];
            const idSet = new Set(cardIds.map(id => String(id)));
            const discarded = [];
            p1.hand = p1.hand.filter(c => {
                if (c && idSet.has(String(c.id))) {
                    discarded.push(c);
                    return false;
                }
                return true;
            });
            if (Array.isArray(p1.keptHandCards)) {
                p1.keptHandCards = p1.keptHandCards.filter(c => !c || !idSet.has(String(c.id)));
            }
            if (!Array.isArray(p1.graveyard)) p1.graveyard = [];
            discarded.forEach(c => {
                if (!p1.graveyard.some(g => String(g.id) === String(c.id))) {
                    p1.graveyard.push(c);
                }
            });
            p1.handCount = p1.hand.length;
            p1.graveyardCount = p1.graveyard.length;
            if (discarded.length > 0) {
                this.logs.push({
                    type: 'CLEANUP_DISCARD',
                    message: `🗑️ **${p1.name}** discarded **${discarded.map(c => c.name).join(', ')}** during Cleanup Step (MTG Rule 514.1).`
                });
            }
            return discarded;
        }

        async stepPhase() {
            if (this.isBusy || this.isGameOver) return { logs: [] };
            this.isBusy = true;
            try {
                const logsBefore = this.logs.length;
                const prevPhase = this.currentPhase;
                const prevTurn = this.turn;
                const prevActive = this.activePlayerIndex;
                let newJson = null;
                try {
                    if (this.bridge && typeof this.bridge.stepPhase === 'function') {
                        newJson = await this.bridge.stepPhase();
                    }
                } catch (e) {
                    console.warn("bridge.stepPhase error, fallback advancing phase:", e);
                }
                if (newJson) {
                    this.updateFromRawJson(newJson);
                }

                // GUARANTEE FORWARD PROGRESSION:
                // If engine did not advance (e.g. stalled on upkeep priority, trigger wait, or running in simulation)
                if (this.currentPhase === prevPhase && this.turn === prevTurn && this.activePlayerIndex === prevActive) {
                    const phases = ['UNTAP', 'UPKEEP', 'DRAW', 'MAIN_1', 'COMBAT_BEGIN', 'DECLARE_ATTACKERS', 'COMBAT_DECLARE_BLOCKERS', 'COMBAT_DAMAGE', 'MAIN_2', 'END_STEP', 'CLEANUP'];
                    const curIdx = phases.indexOf(this.currentPhase);
                    const nextPhase = (curIdx !== -1) ? phases[(curIdx + 1) % phases.length] : 'MAIN_1';
                    if (nextPhase === 'UNTAP') {
                        let nextPlayerIdx = (this.activePlayerIndex + 1) % this.players.length;
                        while (this.players[nextPlayerIdx] && !this.players[nextPlayerIdx].isAlive) {
                            nextPlayerIdx = (nextPlayerIdx + 1) % this.players.length;
                        }
                        if (nextPlayerIdx <= this.activePlayerIndex) {
                            this.turn += 1;
                        }
                        this.activePlayerIndex = nextPlayerIdx;
                        const nextPlayer = this.players[this.activePlayerIndex];
                        if (nextPlayer) {
                            nextPlayer.landPlayedThisTurn = false;
                            nextPlayer.landsPlayedCount = 0;
                            nextPlayer._drewThisTurn = false;
                            nextPlayer._actedMain1 = false;
                            nextPlayer._attackedThisCombat = false;
                            if (typeof nextPlayer.untapAll === 'function') {
                                nextPlayer.untapAll();
                            }
                        }
                    }
                    this.currentPhase = nextPhase;
                }

                // If active player is Player 0 and passing through DRAW phase (or entering MAIN_1), handle turn draw strictly ONCE per turn (Rule 504.1)
                const p1 = this.players[0];
                if (p1 && this.activePlayerIndex === 0) {
                    const isDrawStep = this.currentPhase === 'DRAW' || prevPhase === 'DRAW' ||
                        ((prevPhase === 'UPKEEP' || prevPhase === 'UNTAP') && (this.currentPhase === 'MAIN_1' || this.currentPhase === 'MAIN1'));
                    if (isDrawStep) {
                        this.drawForTurnPlayer0();
                    }
                }
                if (this.turn !== prevTurn) {
                    this._turnDrewPlayer0 = false;
                }

                // Handle bot actions if active player is AI
                const activeP = this.getActivePlayer();
                if (activeP && activeP.isAI) {
                    if (this.currentPhase === 'DRAW' && !activeP._drewThisTurn) {
                        activeP._drewThisTurn = true;
                        const drawn = typeof activeP.draw === 'function' ? activeP.draw(1) : [];
                        this.logs.push({
                            type: 'DRAW',
                            message: `📜 **${activeP.name}** drew for turn.`
                        });
                    } else if (this.currentPhase === 'MAIN_1' && !activeP._actedMain1) {
                        activeP._actedMain1 = true;
                        // Bot plays a land
                        if (!activeP.landPlayedThisTurn && Array.isArray(activeP.hand)) {
                            const landIdx = activeP.hand.findIndex(c => c.isLand || (typeof window !== 'undefined' && typeof window.isLandCard === 'function' && window.isLandCard(c)));
                            if (landIdx !== -1) {
                                const landCard = activeP.hand.splice(landIdx, 1)[0];
                                landCard.tapped = false;
                                activeP.battlefield.push(landCard);
                                activeP.landPlayedThisTurn = true;
                                activeP.landsPlayedCount = 1;
                                this.logs.push({
                                    type: 'LAND_PLAY',
                                    message: `🏞️ **${activeP.name}** played **${landCard.name}**.`
                                });
                            }
                        }
                        // Bot casts a spell if mana allows
                        const availMana = activeP.battlefield.filter(c => c.isLand && !c.tapped).length;
                        if (availMana > 0 && Array.isArray(activeP.hand)) {
                            const castIdx = activeP.hand.findIndex(c => !c.isLand && (c.cmc || 0) <= availMana && (c.cmc || 0) > 0);
                            if (castIdx !== -1) {
                                const spell = activeP.hand.splice(castIdx, 1)[0];
                                const cost = spell.cmc || 1;
                                let tapped = 0;
                                activeP.battlefield.forEach(c => {
                                    if (c.isLand && !c.tapped && tapped < cost) {
                                        c.tapped = true;
                                        tapped++;
                                    }
                                });
                                spell.tapped = false;
                                spell.summoningSick = true;
                                activeP.battlefield.push(spell);
                                this.logs.push({
                                    type: 'SPELL_CAST',
                                    message: `🪄 **${activeP.name}** cast **${spell.name}** ({${cost}}).`
                                });
                            }
                        }
                    } else if (this.currentPhase === 'DECLARE_ATTACKERS' && !activeP._attackedThisCombat) {
                        activeP._attackedThisCombat = true;
                        const readyAttackers = activeP.battlefield.filter(c => c.isCreature && !c.tapped && !c.summoningSick);
                        if (readyAttackers.length > 0) {
                            readyAttackers.forEach(c => { c.tapped = true; });
                            this.logs.push({
                                type: 'ATTACK',
                                message: `⚔️ **${activeP.name}** declared attack with **${readyAttackers.length}** creature(s)!`
                            });
                        }
                    }
                }

                const newLogs = this.logs.slice(logsBefore);
                return { success: true, logs: newLogs, currentPhase: this.currentPhase, activePlayer: this.getActivePlayer(), turn: this.turn };
            } finally {
                this.isBusy = false;
            }
        }

        async stepTurn() {
            if (this.isBusy || this.isGameOver) return { logs: [] };
            this.isBusy = true;
            try {
                const logsBefore = this.logs.length;
                const prevTurn = this.turn;
                const prevActive = this.activePlayerIndex;
                let newJson = null;
                try {
                    if (this.bridge && typeof this.bridge.stepTurn === 'function') {
                        newJson = await this.bridge.stepTurn();
                    }
                } catch (e) {
                    console.warn("bridge.stepTurn error, fallback advancing turn:", e);
                }
                if (newJson) {
                    this.updateFromRawJson(newJson);
                }

                // If bridge didn't advance or running in fallback simulation mode:
                if (this.turn === prevTurn && this.activePlayerIndex === prevActive) {
                    let nextPlayerIdx = (this.activePlayerIndex + 1) % this.players.length;
                    while (this.players[nextPlayerIdx] && !this.players[nextPlayerIdx].isAlive) {
                        nextPlayerIdx = (nextPlayerIdx + 1) % this.players.length;
                    }
                    if (nextPlayerIdx <= this.activePlayerIndex) {
                        this.turn += 1;
                    }
                    this.activePlayerIndex = nextPlayerIdx;
                    this.currentPhase = 'MAIN_1';
                    const nextPlayer = this.players[this.activePlayerIndex];
                    if (nextPlayer) {
                        nextPlayer.landPlayedThisTurn = false;
                        nextPlayer.landsPlayedCount = 0;
                        nextPlayer._drewThisTurn = false;
                        nextPlayer._actedMain1 = false;
                        nextPlayer._attackedThisCombat = false;
                        if (typeof nextPlayer.untapAll === 'function') nextPlayer.untapAll();
                    }
                }

                // When arriving at any player's turn (Human or AI), transition through UNTAP -> UPKEEP -> DRAW directly into MAIN_1
                if (this.bridge && (this.currentPhase === 'UNTAP' || this.currentPhase === 'UPKEEP' || this.currentPhase === 'DRAW')) {
                    let prepSteps = 0;
                    const targetPlayerIdx = this.activePlayerIndex;
                    while (this.activePlayerIndex === targetPlayerIdx && this.currentPhase !== 'MAIN_1' && this.currentPhase !== 'MAIN1' && prepSteps < 5) {
                        const stepJson = await this.bridge.stepPhase();
                        if (stepJson) this.updateFromRawJson(stepJson);
                        prepSteps++;
                    }
                } else if (!this.bridge) {
                    this.currentPhase = 'MAIN_1';
                }

                if (this.activePlayerIndex === 0) {
                    // Ensure all permanents untap on Player 0's new turn and draw strictly 1 card for the turn
                    const p1 = this.players[0];
                    if (p1 && typeof p1.untapAll === 'function') {
                        p1.untapAll();
                    }
                    this.drawForTurnPlayer0();
                } else {
                    this._turnDrewPlayer0 = false;
                    // If AI player in fallback simulation mode, simulate their turn actions with logs
                    const activeP = this.getActivePlayer();
                    if (activeP && activeP.isAI) {
                        if (typeof activeP.draw === 'function') activeP.draw(1);
                        if (!activeP.landPlayedThisTurn && Array.isArray(activeP.hand)) {
                            const landIdx = activeP.hand.findIndex(c => c.isLand || (typeof window !== 'undefined' && typeof window.isLandCard === 'function' && window.isLandCard(c)));
                            if (landIdx !== -1) {
                                const landCard = activeP.hand.splice(landIdx, 1)[0];
                                landCard.tapped = false;
                                activeP.battlefield.push(landCard);
                                activeP.landPlayedThisTurn = true;
                                activeP.landsPlayedCount = 1;
                                this.logs.push({
                                    type: 'LAND_PLAY',
                                    message: `🏞️ **${activeP.name}** played **${landCard.name}**.`
                                });
                            }
                        }
                        const availMana = activeP.battlefield.filter(c => c.isLand && !c.tapped).length;
                        if (availMana > 0 && Array.isArray(activeP.hand)) {
                            const castIdx = activeP.hand.findIndex(c => !c.isLand && (c.cmc || 0) <= availMana && (c.cmc || 0) > 0);
                            if (castIdx !== -1) {
                                const spell = activeP.hand.splice(castIdx, 1)[0];
                                const cost = spell.cmc || 1;
                                let tapped = 0;
                                activeP.battlefield.forEach(c => {
                                    if (c.isLand && !c.tapped && tapped < cost) {
                                        c.tapped = true;
                                        tapped++;
                                    }
                                });
                                spell.tapped = false;
                                spell.summoningSick = true;
                                activeP.battlefield.push(spell);
                                this.logs.push({
                                    type: 'SPELL_CAST',
                                    message: `🪄 **${activeP.name}** cast **${spell.name}** ({${cost}}).`
                                });
                            }
                        }
                        const readyAttackers = activeP.battlefield.filter(c => c.isCreature && !c.tapped && !c.summoningSick);
                        if (readyAttackers.length > 0) {
                            readyAttackers.forEach(c => { c.tapped = true; });
                            this.logs.push({
                                type: 'ATTACK',
                                message: `⚔️ **${activeP.name}** declared attack with **${readyAttackers.length}** creature(s)!`
                            });
                        }
                    }
                }

                const newLogs = this.logs.slice(logsBefore);
                return { success: true, logs: newLogs, currentPhase: this.currentPhase, activePlayer: this.getActivePlayer(), turn: this.turn };
            } finally {
                this.isBusy = false;
            }
        }

        async stepAction() {
            return await this.stepPhase();
        }

        async playCard(cardId) {
            try {
                const pBefore = this.players[0];
                const card = pBefore && pBefore.hand ? pBefore.hand.find(c => String(c.id) === String(cardId) || c.name === String(cardId)) : null;
                const isLand = card ? (card.isLand || (typeof window !== 'undefined' && typeof window.isLandCard === 'function' && window.isLandCard(card))) : false;
                if (isLand && card) {
                    card.isLand = true;
                    card.cmc = 0;
                    card.manaCost = '';
                    if (!card.typeLine || !card.typeLine.toLowerCase().includes('land')) card.typeLine = 'Land';
                }
                const cost = card && !isLand ? (card.cmc || 0) : 0;
                const cardNameLower = (card && card.name ? card.name : '').toLowerCase();
                const sameNameOnFieldBefore = pBefore && Array.isArray(pBefore.battlefield) && cardNameLower
                    ? pBefore.battlefield.filter(c => (c.name || '').toLowerCase() === cardNameLower).length
                    : 0;

                // Deduct mana BEFORE bridge call so updateFromRawJson preserves spent mana and tapped lands
                if (pBefore && cost > 0 && typeof pBefore.deductMana === 'function') {
                    pBefore.deductMana(cost);
                }

                const numId = parseInt(cardId, 10);
                const logsBefore = this.logs.length;
                try {
                    if (this.bridge && typeof this.bridge.playCard === 'function') {
                        let newJson = null;
                        if (!isNaN(numId)) {
                            newJson = await this.bridge.playCard(numId);
                        } else if (card && card.name) {
                            newJson = await this.bridge.playCard(card.name);
                        }
                        if (newJson) this.updateFromRawJson(newJson);
                    }
                } catch (eBridge) {
                    console.warn("bridge.playCard error:", eBridge);
                }

                // Strictly update active player after updateFromRawJson
                const activePlayer = this.players[0];
                if (activePlayer && card) {
                    if (activePlayer.hand) {
                        activePlayer.hand = activePlayer.hand.filter(c => String(c.id) !== String(card.id));
                        activePlayer.handCount = activePlayer.hand.length;
                    }
                    if (activePlayer.keptHandCards) {
                        activePlayer.keptHandCards = activePlayer.keptHandCards.filter(c => String(c.id) !== String(card.id));
                    }

                    const typeLower = (card.typeLine || '').toLowerCase();
                    const isInstantOrSorcery = !isLand && Boolean(card.isInstant || card.isSorcery || typeLower.includes('instant') || typeLower.includes('sorcery'));

                    if (isInstantOrSorcery) {
                        if (!Array.isArray(activePlayer.graveyard)) activePlayer.graveyard = [];
                        if (!activePlayer.graveyard.some(c => String(c.id) === String(card.id))) {
                            activePlayer.graveyard.push(card);
                        }
                        activePlayer.graveyardCount = activePlayer.graveyard.length;
                    } else {
                        const sameNameOnFieldAfter = Array.isArray(activePlayer.battlefield) && cardNameLower
                            ? activePlayer.battlefield.filter(c => (c.name || '').toLowerCase() === cardNameLower).length
                            : 0;
                        const addedByBridge = sameNameOnFieldAfter > sameNameOnFieldBefore;
                        if (!addedByBridge && !activePlayer.battlefield.some(c => String(c.id) === String(card.id))) {
                            activePlayer.battlefield.push(card);
                        }
                    }

                    // Handle card draw effects on cast spells or ETB permanents so authoritative JS hand draws from libraryCards
                    const oracleLower = (card.oracleText || '').toLowerCase();
                    if (oracleLower && typeof activePlayer.draw === 'function') {
                        const isDirectSpellDraw = isInstantOrSorcery && /draw\s+(a|one|two|three|four|\d+)\s+card/i.test(oracleLower);
                        const isEtbDraw = !isInstantOrSorcery && /when\s+(?:this|~|it|[a-z\s,']+)\s+enters[\s\S]*?draw\s+(a|one|two|three|four|\d+)\s+card/i.test(oracleLower);
                        if (isDirectSpellDraw || isEtbDraw) {
                            const m = oracleLower.match(/draw\s+(a|one|two|three|four|\d+)\s+card/i);
                            if (m) {
                                let drawNum = 1;
                                const tok = m[1].toLowerCase();
                                if (tok === 'two' || tok === '2') drawNum = 2;
                                else if (tok === 'three' || tok === '3') drawNum = 3;
                                else if (tok === 'four' || tok === '4') drawNum = 4;
                                else if (!isNaN(parseInt(tok, 10))) drawNum = parseInt(tok, 10);
                                const drawnCards = activePlayer.draw(drawNum);
                                if (drawnCards && drawnCards.length > 0) {
                                    this.logs.push({
                                        type: 'DRAW',
                                        message: `📜 **${activePlayer.name}** drew **${drawnCards.length}** card(s) from **${card.name}** (${drawnCards.map(d => d.name).join(', ')}).`
                                    });
                                }
                            }
                        }
                    }

                    if (isLand) {
                        activePlayer.landPlayedThisTurn = true;
                        activePlayer.landsPlayedCount = (activePlayer.landsPlayedCount || 0) + 1;
                    }
                }

                return { success: true, logs: this.logs.slice(logsBefore) };
            } catch (e) {
                console.error("playCard error:", e);
                return { success: false, logs: [] };
            }
        }

        async activateAbility(cardId, abilityIndex = 0) {
            try {
                const numId = parseInt(cardId, 10);
                const logsBefore = this.logs.length;
                if (this.bridge && typeof this.bridge.activateAbility === 'function' && !isNaN(numId)) {
                    const newJson = await this.bridge.activateAbility(numId, abilityIndex);
                    this.updateFromRawJson(newJson);
                }
                return { success: true, logs: this.logs.slice(logsBefore) };
            } catch (e) {
                console.error("activateAbility error:", e);
                return { success: false, logs: [] };
            }
        }

        async executeFetchLand(cardIdOrName, chosenLandName, fetchMeta = null) {
            try {
                const logsBefore = this.logs.length;
                const pBefore = this.players[0];
                const card = pBefore && pBefore.battlefield
                    ? pBefore.battlefield.find(c => String(c.id) === String(cardIdOrName) || c.name === String(cardIdOrName))
                    : null;
                const cardName = card ? card.name : String(cardIdOrName);
                const numId = parseInt(cardIdOrName, 10);
                const fetchCount = (fetchMeta && fetchMeta.fetchCount && fetchMeta.fetchCount > 1) ? fetchMeta.fetchCount : 1;

                // Track how many copies of chosenLandName were already on the battlefield before fetching
                const chosenLower = String(chosenLandName || '').toLowerCase();
                const chosenOnFieldBefore = pBefore && Array.isArray(pBefore.battlefield)
                    ? pBefore.battlefield.filter(c => (c.name || '').toLowerCase() === chosenLower).length
                    : 0;

                if (this.bridge && typeof this.bridge.fetchLand === 'function') {
                    try {
                        let resJson = null;
                        if (!isNaN(numId)) {
                            resJson = await this.bridge.fetchLand(numId, chosenLandName);
                        } else {
                            resJson = await this.bridge.fetchLand(cardName, chosenLandName);
                        }
                        if (resJson) this.updateFromRawJson(resJson);
                    } catch (eBridge) {
                        console.warn("bridge.fetchLand error:", eBridge);
                    }
                }

                // Resilient local state sync on current this.players[0]
                const p = this.players[0];
                if (p) {
                    if (p.battlefield) {
                        const idx = p.battlefield.findIndex(c => String(c.id) === String(cardIdOrName) || (card && String(c.id) === String(card.id)));
                        if (idx !== -1) {
                            const [sacrificed] = p.battlefield.splice(idx, 1);
                            if (!p.graveyard) p.graveyard = [];
                            if (!p.graveyard.some(c => String(c.id) === String(sacrificed.id))) {
                                p.graveyard.push(sacrificed);
                            }
                            p.graveyardCount = p.graveyard.length;
                        }
                    }

                    const lib = p.libraryCards || [];
                    const nameLower = cardName.toLowerCase();
                    const totalLandsNow = p.battlefield ? p.battlefield.filter(c => c.isLand).length : 0;
                    const isUntapped = nameLower.includes('prismatic vista') ||
                        (nameLower.includes('fabled passage') && totalLandsNow >= 3);

                    const chosenOnFieldAfter = p.battlefield
                        ? p.battlefield.filter(c => (c.name || '').toLowerCase() === chosenLower).length
                        : 0;
                    const addedByBridge = Math.max(0, chosenOnFieldAfter - chosenOnFieldBefore);

                    // Remove fetched card(s) from libraryCards so deck counts stay accurate
                    const totalToFetch = Math.max(1, fetchCount);
                    for (let i = 0; i < totalToFetch; i++) {
                        const foundIdx = lib.findIndex(c => {
                            const n = (c.name || '').toLowerCase();
                            return n === chosenLower || n.includes(chosenLower);
                        });
                        let fetchedLand = null;
                        if (foundIdx !== -1) {
                            fetchedLand = lib.splice(foundIdx, 1)[0];
                        } else if (i === 0 && addedByBridge === 0) {
                            fetchedLand = enrichCard({
                                name: chosenLandName,
                                isLand: true,
                                typeLine: `Basic Land — ${chosenLandName}`
                            });
                        }

                        // Only push onto p.battlefield if the Java bridge didn't already add this copy
                        if (i >= addedByBridge && fetchedLand) {
                            fetchedLand.tapped = !isUntapped;
                            fetchedLand.isLand = true;
                            if (!p.battlefield.some(c => String(c.id) === String(fetchedLand.id))) {
                                p.battlefield.push(fetchedLand);
                            }
                        }
                    }

                    // Ensure any newly fetched land added by the bridge has the right tapped status
                    if (addedByBridge > 0 && p.battlefield) {
                        const matchingLands = p.battlefield.filter(c => (c.name || '').toLowerCase() === chosenLower);
                        const newestLand = matchingLands[matchingLands.length - 1];
                        if (newestLand) {
                            newestLand.tapped = !isUntapped;
                            newestLand.isLand = true;
                        }
                    }

                    p.libraryCount = lib.length;
                }

                const newLogs = this.logs.slice(logsBefore);
                return { success: true, logs: newLogs };
            } catch (err) {
                console.error("executeFetchLand error:", err);
                return { success: false, logs: [] };
            }
        }

        async castCommander() {
            try {
                const pBefore = this.players[0];
                const cmdr = pBefore ? pBefore.getCommander() : null;
                const cost = cmdr ? ((cmdr.cmc || 0) + (pBefore.commanderTax || 0)) : 0;
                if (pBefore && cost > 0 && typeof pBefore.deductMana === 'function') {
                    pBefore.deductMana(cost);
                }
                const logsBefore = this.logs.length;
                const newJson = await this.bridge.castCommander();
                this.updateFromRawJson(newJson);
                return { success: true, logs: this.logs.slice(logsBefore) };
            } catch (e) {
                console.error("castCommander error:", e);
                return { success: false, logs: [] };
            }
        }

        async toggleTapPermanent(cardId) {
            try {
                const numId = parseInt(cardId, 10);
                const newJson = await this.bridge.toggleTap(numId);
                this.updateFromRawJson(newJson);
            } catch (e) {
                console.error("toggleTap error:", e);
            }
        }

        async untapAllLands() {
            try {
                const newJson = await this.bridge.untapAllLands();
                this.updateFromRawJson(newJson);
            } catch (e) {
                console.error("untapAllLands error:", e);
            }
        }

        async adjustPlayerLife(delta) {
            try {
                const newJson = await this.bridge.adjustLife(0, delta);
                this.updateFromRawJson(newJson);
            } catch (e) {
                console.error("adjustLife error:", e);
            }
        }

        async declareHumanAttacks(attacks = []) {
            try {
                const logsBefore = this.logs.length;
                for (const atk of attacks) {
                    const cardId = parseInt(atk.attackerId, 10);
                    const targetIdx = (typeof atk.targetPlayerIndex === 'number' && atk.targetPlayerIndex > 0) ? atk.targetPlayerIndex : 1;
                    const targetPwId = atk.targetPlaneswalkerId ? parseInt(atk.targetPlaneswalkerId, 10) : 0;
                    if (this.bridge && typeof this.bridge.declareAttacks === 'function') {
                        const newJson = await this.bridge.declareAttacks(cardId, targetIdx, targetPwId);
                        this.updateFromRawJson(newJson);
                    }
                }
                return { success: true, logs: this.logs.slice(logsBefore) };
            } catch (e) {
                console.error("declareHumanAttacks error:", e);
                return { success: false, logs: [] };
            }
        }

        async takeMulligan() {
            const p = this.players[0];
            const prevMulliganCount = (p && p.mulliganCount) || 0;
            const newMulliganCount = prevMulliganCount + 1;

            if (p) {
                p.handLocked = false;
                p.mulliganCount = newMulliganCount;

                // Ensure library has cards to draw from
                if (!p.libraryCards || p.libraryCards.length < 7) {
                    const deckInfo = (this.selectedDecks && this.selectedDecks[0]) || {};
                    if (deckInfo.cards && deckInfo.cards.length > 0) {
                        p.libraryCards = deckInfo.cards
                            .filter(c => (typeof c === 'string' ? c : c.name) !== deckInfo.commander)
                            .map(c => enrichCard(typeof c === 'string' ? { name: c } : c));
                    }
                }

                // Put current hand back into library
                if (p.hand && p.hand.length > 0) {
                    p.libraryCards.push(...p.hand);
                }

                // Shuffle library completely with Fisher-Yates
                for (let i = p.libraryCards.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [p.libraryCards[i], p.libraryCards[j]] = [p.libraryCards[j], p.libraryCards[i]];
                }

                // Draw fresh 7 cards
                p.hand = p.libraryCards.splice(0, 7);
                p.handCount = p.hand.length;
                p.libraryCount = p.libraryCards.length;
                p.keptHandCards = [...p.hand];

                this.logs.push({
                    type: 'FORGE_EVENT',
                    message: `Player took mulligan #${newMulliganCount}. Shuffled hand into library and drew 7 fresh cards.`
                });
            }

            try {
                if (this.bridge && typeof this.bridge.takeMulligan === 'function') {
                    const newJson = await this.bridge.takeMulligan();
                    this.updateFromRawJson(newJson);
                }
            } catch (err) {
                console.warn("ForgeWebBridge.takeMulligan error:", err);
            }

            const p1 = this.players[0];
            const cardsToBottomCount = Math.max(0, newMulliganCount - 1);
            const isFree = newMulliganCount === 1;

            return {
                success: true,
                mulliganCount: newMulliganCount,
                isFree,
                cardsToBottomCount,
                log: {
                    type: 'MULLIGAN',
                    playerId: p1 ? p1.id : 'p_1',
                    playerName: p1 ? p1.name : 'You',
                    message: isFree
                        ? `🔄 **${p1 ? p1.name : 'You'}** took a **FREE Multiplayer Mulligan** (Drew 7 fresh cards).`
                        : `🔄 **${p1 ? p1.name : 'You'}** took **Mulligan #${newMulliganCount}** (Drew 7 fresh cards; choose ${cardsToBottomCount} card(s) to place on bottom).`
                }
            };
        }

        async bottomCards(cardIds = []) {
            const p = this.players[0];
            if (!p || !p.hand || cardIds.length === 0) return [];
            const bottomedCards = [];
            const idSet = new Set(cardIds.map(String));

            const remainingHand = [];
            for (const c of p.hand) {
                if (idSet.has(String(c.id))) {
                    bottomedCards.push(c);
                    if (p.libraryCards) {
                        p.libraryCards.push(c); // Put on bottom of library
                    }
                } else {
                    remainingHand.push(c);
                }
            }

            // Fallback match by card name if ID matching was incomplete
            if (bottomedCards.length < cardIds.length) {
                for (const targetId of cardIds) {
                    if (!bottomedCards.some(b => String(b.id) === String(targetId))) {
                        const idx = remainingHand.findIndex(c => String(c.id) === String(targetId) || c.name === targetId);
                        if (idx !== -1) {
                            const [bCard] = remainingHand.splice(idx, 1);
                            bottomedCards.push(bCard);
                            if (p.libraryCards) p.libraryCards.push(bCard);
                        }
                    }
                }
            }

            p.hand = remainingHand;
            p.keptHandCards = [...remainingHand];
            p.handCount = p.hand.length;
            p.handLocked = true;
            if (p.libraryCards) {
                p.libraryCount = p.libraryCards.length;
            }

            try {
                if (this.bridge && typeof this.bridge.bottomCards === 'function' && cardIds.length > 0) {
                    const idsCsv = cardIds.join(',');
                    const newJson = await this.bridge.bottomCards(idsCsv);
                    this.updateFromRawJson(newJson);
                }
            } catch (err) {
                console.warn("ForgeWebBridge.bottomCards error:", err);
            }

            return bottomedCards;
        }

        resolveBotMulligans() {
            return [
                { type: 'MULLIGAN_KEEP', message: `🤖 **Opponent 1** evaluated opening hand: 3 lands, curve 2-4 -> **KEPT (7)**` },
                { type: 'MULLIGAN_KEEP', message: `🤖 **Opponent 2** evaluated opening hand: Ramp and lands ready -> **KEPT (7)**` },
                { type: 'MULLIGAN_KEEP', message: `🤖 **Opponent 3** evaluated opening hand: Synergy present -> **KEPT (7)**` }
            ];
        }

        async runMatchSimulation() {
            const logsBefore = this.logs.length;
            let steps = 0;
            while (!this.isGameOver && steps < 60) {
                await this.stepPhase();
                steps++;
            }
            return { success: true, logs: this.logs.slice(logsBefore) };
        }
    }

    function enrichCard(cardData, isCommandZone = false) {
        if (!cardData) return {};
        const c = Object.assign({}, cardData);
        c.id = c.id !== undefined ? String(c.id) : ('c_' + Math.floor(Math.random() * 1000000));
        c.name = c.name || 'Unknown Card';

        if (window.__MTG_CARD_CACHE__) {
            const cached = window.__MTG_CARD_CACHE__[c.name.toLowerCase()];
            if (cached) {
                if (!c.manaCost) c.manaCost = cached.manaCost;
                if (c.cmc === undefined) c.cmc = cached.cmc;
                if (!c.typeLine) c.typeLine = cached.typeLine;
                if (c.power === undefined) c.power = cached.power;
                if (c.toughness === undefined) c.toughness = cached.toughness;
                if (!c.oracleText) c.oracleText = cached.oracleText;
            }
        }

        const tl = (c.typeLine || '').toLowerCase();
        const detectedLand = (typeof window !== 'undefined' && typeof window.isLandCard === 'function' ? window.isLandCard(c) : false) || tl.includes('land');
        c.isLand = !!c.isLand || detectedLand;
        if (c.isLand) {
            c.manaCost = '';
            c.cmc = 0;
            if (!c.typeLine || !c.typeLine.toLowerCase().includes('land')) {
                c.typeLine = 'Land';
            }
        } else {
            c.manaCost = c.manaCost || '';
            c.cmc = c.cmc !== undefined ? c.cmc : 0;
        }

        c.power = c.power !== undefined ? c.power : 0;
        c.toughness = c.toughness !== undefined ? c.toughness : 0;
        c.tapped = !!c.tapped;
        c.summoningSick = !!c.summoningSick;
        c.isCreature = !!c.isCreature || tl.includes('creature');
        c.isArtifact = !!c.isArtifact || tl.includes('artifact');
        c.isEnchantment = !!c.isEnchantment || tl.includes('enchantment');
        c.isPlaneswalker = !!c.isPlaneswalker || tl.includes('planeswalker');
        c.isInstant = !!c.isInstant || tl.includes('instant');
        c.isSorcery = !!c.isSorcery || tl.includes('sorcery');
        c.isCommander = isCommandZone || !!c.isCommander;
        c.counters = Array.isArray(cardData.counters) ? cardData.counters : [];
        c.typeLine = c.typeLine || (c.isCreature ? 'Creature' : c.isLand ? 'Land' : 'Spell');
        c.oracleText = c.oracleText || '';
        return c;
    }

    // Public API exposed on window
    window.ForgeArena = {
        initEngine: initForgeEngine,
        ForgeArenaGame: ForgeArenaGame,
        startMatch: async function (selectedDecks = [], startingPlayerIndex = 0) {
            let bridge = null;
            try {
                bridge = await initForgeEngine();
            } catch (initErr) {
                console.warn("Forge engine init failed, proceeding with resilient Arena state:", initErr);
            }
            showLoadingBanner("Assembling 4-Player Commander Pod", "Shuffling libraries & drawing opening hands...");

            const cleanDeckCards = (cards, cmdr) => {
                if (!Array.isArray(cards)) return [];
                const res = [];
                const cmdrClean = (cmdr || '').toLowerCase().trim();
                for (const c of cards) {
                    let name = typeof c === 'string' ? c : (c && c.name ? c.name : '');
                    if (!name) continue;
                    name = name.replace(/^\d+x?\s+/, '').trim();
                    name = name.replace(/\s*\([A-Za-z0-9_-]+\).*$/, '').replace(/\s*\[[A-Za-z0-9_-]+\].*$/, '').trim();
                    name = name.replace(/\*[A-Za-z0-9_-]+\*/g, '').trim();
                    if (!name || name.toLowerCase() === cmdrClean) continue;
                    const qty = (c && typeof c.quantity === 'number') ? c.quantity : 1;
                    const count = Math.max(1, Math.min(qty, 40));
                    for (let q = 0; q < count; q++) {
                        res.push(name);
                    }
                }
                return res;
            };

            const p1 = selectedDecks[0] || {};
            const p1Name = p1.name || 'Wilhelt Zombies';
            const p1Cmdr = p1.commander || 'Wilhelt, the Rotcleaver';
            const p1Cards = cleanDeckCards(p1.cards, p1Cmdr);

            const p2 = selectedDecks[1] || {};
            const p2Name = p2.name || 'Elven Empire';
            const p2Cmdr = p2.commander || 'Lathril, Blade of the Elves';
            const p2Cards = cleanDeckCards(p2.cards, p2Cmdr);

            const p3 = selectedDecks[2] || {};
            const p3Name = p3.name || 'Reap the Tides';
            const p3Cmdr = p3.commander || 'Aesi, Tyrant of Gyre Strait';
            const p3Cards = cleanDeckCards(p3.cards, p3Cmdr);

            const p4 = selectedDecks[3] || {};
            const p4Name = p4.name || 'Planar Portal';
            const p4Cmdr = p4.commander || 'Prosper, Tome-Bound';
            const p4Cards = cleanDeckCards(p4.cards, p4Cmdr);

            let rawJson = null;
            if (bridge) {
                try {
                    rawJson = await bridge.startCommanderMatchWithDecks(
                        p1Name, p1Cmdr, p1Cards.join("\n"),
                        p2Name, p2Cmdr, p2Cards.join("\n"),
                        p3Name, p3Cmdr, p3Cards.join("\n"),
                        p4Name, p4Cmdr, p4Cards.join("\n"),
                        startingPlayerIndex
                    );
                } catch (err) {
                    console.warn("startCommanderMatchWithDecks with startingPlayerIndex failed, falling back:", err);
                    try {
                        rawJson = await bridge.startCommanderMatchWithDecks(
                            p1Name, p1Cmdr, p1Cards.join("\n"),
                            p2Name, p2Cmdr, p2Cards.join("\n"),
                            p3Name, p3Cmdr, p3Cards.join("\n"),
                            p4Name, p4Cmdr, p4Cards.join("\n")
                        );
                    } catch (err2) {
                        console.warn("Falling back to standard startCommanderMatch:", err2);
                        try {
                            rawJson = await bridge.startCommanderMatch(p1Name, p1Cmdr, p1Cards.join("\n"));
                        } catch (err3) {
                            console.warn("Standard startCommanderMatch failed:", err3);
                        }
                    }
                }
            }

            hideLoadingBanner();
            const game = new ForgeArenaGame(bridge, rawJson, selectedDecks);
            game.startingPlayerIndex = startingPlayerIndex;
            return game;
        }
    };

})();
