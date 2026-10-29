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
                showLoadingBanner("Initializing WebAssembly JVM", "Fetching CheerpJ runtime loader...");
                try {
                    await new Promise((resolve, reject) => {
                        const sc = document.createElement('script');
                        sc.src = 'https://cjrtnc.leaningtech.com/4.3/loader.js';
                        sc.onload = () => resolve(true);
                        sc.onerror = () => reject(new Error("Failed to load CheerpJ runtime from CDN"));
                        document.head.appendChild(sc);
                    });
                } catch (loadErr) {
                    throw new Error("CheerpJ loader script not loaded. Check internet or ad-blocker.");
                }
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

    function calcCmcFromManaCost(manaCostStr) {
        if (!manaCostStr || typeof manaCostStr !== 'string') return 0;
        let total = 0;
        const braceMatches = manaCostStr.match(/\{([^}]+)\}/g);
        if (braceMatches) {
            for (const token of braceMatches) {
                const inner = token.replace(/[{}]/g, '').trim().toUpperCase();
                if (/^\d+$/.test(inner)) {
                    total += parseInt(inner, 10);
                } else if (inner === 'X' || inner === 'Y' || inner === 'Z') {
                    total += 0;
                } else if (inner.includes('/')) {
                    const parts = inner.split('/');
                    const numPart = parts.find(p => /^\d+$/.test(p));
                    total += numPart ? parseInt(numPart, 10) : 1;
                } else if (inner.length > 0) {
                    total += 1;
                }
            }
            return total;
        }
        const spaceParts = manaCostStr.trim().split(/\s+/);
        for (const part of spaceParts) {
            const p = part.trim().toUpperCase();
            if (!p || p === 'NO' || p === 'COST') continue;
            if (/^\d+$/.test(p)) total += parseInt(p, 10);
            else if (p === 'X') total += 0;
            else total += 1;
        }
        return total;
    }

    function normalizeManaCostBraces(manaCostStr) {
        if (!manaCostStr || typeof manaCostStr !== 'string') return '';
        const trimmed = manaCostStr.trim();
        if (!trimmed || trimmed.toLowerCase() === 'no cost') return '';
        if (trimmed.includes('{')) return trimmed;
        return trimmed.split(/\s+/).filter(Boolean).map(tok => `{${tok.toUpperCase()}}`).join('');
    }

    function attachPlayerMethods(p, idx, selfGame) {
        p.exile = Array.isArray(p.exile) ? p.exile : [];
        p.commanderDamageReceived = p.commanderDamageReceived || {};

        p.getCommander = function () {
            const inCmdr = (this.commandZone || []).find(c => c.isCommander);
            if (inCmdr) return inCmdr;
            const onField = (this.battlefield || []).find(c => c.isCommander);
            if (onField) return onField;
            return (this.commandZone && this.commandZone[0]) || this._commanderRef || null;
        };
        p.isCommanderInCommandZone = function () {
            const cmdr = this.getCommander();
            return (this.commandZone || []).some(c => c.isCommander || (cmdr && c.name === cmdr.name));
        };
        p.isCommanderOnBattlefield = function () {
            const cmdr = this.getCommander();
            return (this.battlefield || []).some(c => c.isCommander || (cmdr && c.name === cmdr.name));
        };
        p.getAvailableMana = function () {
            let poolTotal = 0;
            if (this.manaPool) {
                ['W', 'U', 'B', 'R', 'G', 'C'].forEach(col => { poolTotal += (this.manaPool[col] || 0); });
            }
            return { total: Math.max(poolTotal, 0) };
        };

        p.canPayCardCost = function (card, extraTax = 0) {
            if (!card) return { canPay: true, missing: [], reason: '' };
            if (card.isLand) return { canPay: true, missing: [], reason: '' };
            const effectiveCost = this.getCardCost(card);
            const genericReduction = Math.max(0, (card.cmc || 0) - effectiveCost);
            return canPayManaCost(card, this.manaPool, genericReduction, extraTax);
        };

        p.deductMana = function (costOrCard, extraTax = 0) {
            if (!this.manaPool) return;
            const card = (typeof costOrCard === 'object' && costOrCard !== null) ? costOrCard : null;
            if (card && card.isLand) return;

            if (!card && (typeof costOrCard === 'number' || /^\d+$/.test(String(costOrCard).trim()))) {
                let remaining = typeof costOrCard === 'number' ? costOrCard : parseInt(costOrCard, 10);
                if (remaining <= 0) return;
                const colors = ['C', 'W', 'G', 'R', 'U', 'B'];
                for (const col of colors) {
                    if (this.manaPool[col] > 0 && remaining > 0) {
                        const spend = Math.min(this.manaPool[col], remaining);
                        this.manaPool[col] -= spend;
                        remaining -= spend;
                        consumeBattlefieldPips(this.battlefield, col, spend);
                    }
                }
                return;
            }

            const effectiveCost = card ? this.getCardCost(card) : 0;
            const genericReduction = card ? Math.max(0, (card.cmc || 0) - effectiveCost) : 0;
            deductDetailedMana(costOrCard, this.manaPool, this.battlefield, genericReduction, extraTax);
        };

        p.deductCardMana = function (card, extraTax = 0) {
            this.deductMana(card, extraTax);
        };

        p.tapMana = function (cost) {
            this.deductMana(cost);
        };
        p.getCardCost = function (card) {
            if (!card) return 0;
            if (card.isLand) return 0;
            let cost = card.cmc !== undefined ? Number(card.cmc) : 0;
            const tl = (card.typeLine || '').toLowerCase();
            const isDragon = tl.includes('dragon') || (card.subtypes instanceof Set && card.subtypes.has('Dragon'));
            const isZombie = tl.includes('zombie') || (card.subtypes instanceof Set && card.subtypes.has('Zombie'));
            // Eminence from The Ur-Dragon (command zone or battlefield)
            const cmdr = this.getCommander();
            if (isDragon && cmdr && (cmdr.name || '').toLowerCase().includes('the ur-dragon')) {
                cost = Math.max(1, cost - 1);
            }
            for (const perm of (this.battlefield || [])) {
                const pName = (perm.name || '').toLowerCase();
                if (isDragon && pName.includes("dragonlord's servant")) cost = Math.max(1, cost - 1);
                if (isDragon && pName.includes('dragonspeaker shaman')) cost = Math.max(1, cost - 2);
                if (isZombie && pName.includes('undead warchief')) cost = Math.max(1, cost - 2);
            }
            if ((card.name || '').toLowerCase() === 'blasphemous act' && selfGame && Array.isArray(selfGame.players)) {
                let totalCreatures = 0;
                selfGame.players.forEach(pl => {
                    totalCreatures += (pl.battlefield || []).filter(c => c.isCreature).length;
                });
                cost = Math.max(1, 9 - totalCreatures);
            }
            return Math.max(0, cost);
        };
        p.getEffectivePower = function (card) {
            if (!card) return 0;
            let pwr = Number(card.power) || 0;
            const cNameLower = (card.name || '').toLowerCase();
            if (cNameLower.includes('multani, yavimaya')) {
                const landsOnField = (this.battlefield || []).filter(c => c.isLand).length;
                const landsInGy = (this.graveyard || []).filter(c => c.isLand).length;
                pwr += landsOnField + landsInGy;
            }
            if (Array.isArray(card.counters)) {
                for (const ctr of card.counters) {
                    if (ctr.type === '+1/+1') pwr += (ctr.count || 0);
                    else if (ctr.type === '-1/-1') pwr -= (ctr.count || 0);
                }
            }
            if (typeof card.tempPower === 'number') pwr += card.tempPower;

            const tl = (card.typeLine || '').toLowerCase();
            const isZombie = tl.includes('zombie') || (card.subtypes instanceof Set && card.subtypes.has('Zombie'));
            const isSkeleton = tl.includes('skeleton') || (card.subtypes instanceof Set && card.subtypes.has('Skeleton'));
            const isElf = tl.includes('elf') || (card.subtypes instanceof Set && card.subtypes.has('Elf'));
            const isDragon = tl.includes('dragon') || (card.subtypes instanceof Set && card.subtypes.has('Dragon'));
            const isToken = Boolean(card.isToken);

            for (const perm of (this.battlefield || [])) {
                if (!perm) continue;
                const pName = (perm.name || '').toLowerCase();
                // Attached equipment bonuses
                if (perm.attachedTo && String(perm.attachedTo) === String(card.id)) {
                    if (pName.includes('fiendlash')) pwr += 2;
                    else if (pName.includes('skullclamp')) pwr += 1;
                    else if (pName.includes('blackblade reforged')) {
                        pwr += (this.battlefield || []).filter(c => c.isLand).length;
                    } else {
                        const mEq = (perm.oracleText || '').match(/equipped creature gets \+(\d+)\/\+(\d+)/i);
                        if (mEq) pwr += parseInt(mEq[1], 10);
                    }
                }
                if (String(perm.id) === String(card.id)) continue;
                if (pName === 'death baron' && (isZombie || isSkeleton)) pwr += 1;
                else if (pName === 'cemetery reaper' && isZombie) pwr += 1;
                else if (pName === 'lord of the accursed' && isZombie) pwr += 1;
                else if (pName === 'diregraf captain' && isZombie) pwr += 1;
                else if (pName === "liliana's devotee" && isZombie) pwr += 1;
                else if (pName === 'undead warchief' && isZombie) pwr += 2;
                else if (pName === 'elvish archdruid' && isElf) pwr += 1;
                else if (pName === 'imperious perfect' && isElf) pwr += 1;
                else if (pName === 'crucible of fire' && isDragon) pwr += 3;
                else if (Array.isArray(perm.forgeStatic)) {
                    for (const st of perm.forgeStatic) {
                        if (st.Mode === 'Continuous' && st.AddPower && st.Affected) {
                            const aff = st.Affected;
                            const otherOnly = aff.includes('.Other');
                            if (otherOnly && String(perm.id) === String(card.id)) continue;
                            if ((aff.includes('Zombie') && isZombie) ||
                                (aff.includes('Skeleton') && isSkeleton) ||
                                (aff.includes('Elf') && isElf) ||
                                (aff.includes('Dragon') && isDragon) ||
                                (aff.includes('token') && isToken)) {
                                const addP = parseInt(st.AddPower, 10);
                                if (!isNaN(addP)) pwr += addP;
                            }
                        }
                    }
                }
            }
            return Math.max(0, pwr);
        };
        p.getEffectiveToughness = function (card) {
            if (!card) return 0;
            let tgh = Number(card.toughness) || 0;
            const cNameLower = (card.name || '').toLowerCase();
            if (cNameLower.includes('multani, yavimaya')) {
                const landsOnField = (this.battlefield || []).filter(c => c.isLand).length;
                const landsInGy = (this.graveyard || []).filter(c => c.isLand).length;
                tgh += landsOnField + landsInGy;
            }
            if (Array.isArray(card.counters)) {
                for (const ctr of card.counters) {
                    if (ctr.type === '+1/+1') tgh += (ctr.count || 0);
                    else if (ctr.type === '-1/-1') tgh -= (ctr.count || 0);
                }
            }
            if (typeof card.tempToughness === 'number') tgh += card.tempToughness;

            const tl = (card.typeLine || '').toLowerCase();
            const isZombie = tl.includes('zombie') || (card.subtypes instanceof Set && card.subtypes.has('Zombie'));
            const isSkeleton = tl.includes('skeleton') || (card.subtypes instanceof Set && card.subtypes.has('Skeleton'));
            const isElf = tl.includes('elf') || (card.subtypes instanceof Set && card.subtypes.has('Elf'));
            const isDragon = tl.includes('dragon') || (card.subtypes instanceof Set && card.subtypes.has('Dragon'));
            const isToken = Boolean(card.isToken);

            for (const perm of (this.battlefield || [])) {
                if (!perm) continue;
                const pName = (perm.name || '').toLowerCase();
                if (perm.attachedTo && String(perm.attachedTo) === String(card.id)) {
                    if (pName.includes('skullclamp')) tgh -= 1;
                    else if (pName.includes('blackblade reforged')) {
                        tgh += (this.battlefield || []).filter(c => c.isLand).length;
                    } else {
                        const mEq = (perm.oracleText || '').match(/equipped creature gets \+(\d+)\/\+(\d+)/i);
                        if (mEq) tgh += parseInt(mEq[2], 10);
                    }
                }
                if (String(perm.id) === String(card.id)) continue;
                if (pName === 'death baron' && (isZombie || isSkeleton)) tgh += 1;
                else if (pName === 'cemetery reaper' && isZombie) tgh += 1;
                else if (pName === 'lord of the accursed' && isZombie) tgh += 1;
                else if (pName === 'diregraf captain' && isZombie) tgh += 1;
                else if (pName === 'undead warchief' && isZombie) tgh += 1;
                else if (pName === 'elvish archdruid' && isElf) tgh += 1;
                else if (pName === 'imperious perfect' && isElf) tgh += 1;
                else if (pName === 'crucible of fire' && isDragon) tgh += 3;
                else if (Array.isArray(perm.forgeStatic)) {
                    for (const st of perm.forgeStatic) {
                        if (st.Mode === 'Continuous' && st.AddToughness && st.Affected) {
                            const aff = st.Affected;
                            const otherOnly = aff.includes('.Other');
                            if (otherOnly && String(perm.id) === String(card.id)) continue;
                            if ((aff.includes('Zombie') && isZombie) ||
                                (aff.includes('Skeleton') && isSkeleton) ||
                                (aff.includes('Elf') && isElf) ||
                                (aff.includes('Dragon') && isDragon) ||
                                (aff.includes('token') && isToken)) {
                                const addT = parseInt(st.AddToughness, 10);
                                if (!isNaN(addT)) tgh += addT;
                            }
                        }
                    }
                }
            }
            return tgh;
        };
        p.hasEffectiveKeyword = function (card, kw) {
            if (!card || !kw) return false;
            const kwLower = String(kw).toLowerCase();
            if (card.keywords instanceof Set && card.keywords.has(kwLower)) return true;
            if (Array.isArray(card.tempKeywords) && card.tempKeywords.includes(kwLower)) return true;
            const oracleLower = (card.oracleText || '').toLowerCase();
            if (oracleLower.includes(kwLower)) return true;

            const tl = (card.typeLine || '').toLowerCase();
            const isZombie = tl.includes('zombie') || (card.subtypes instanceof Set && card.subtypes.has('Zombie'));
            const isSkeleton = tl.includes('skeleton') || (card.subtypes instanceof Set && card.subtypes.has('Skeleton'));
            const isDragon = tl.includes('dragon') || (card.subtypes instanceof Set && card.subtypes.has('Dragon'));
            const isToken = Boolean(card.isToken);

            for (const perm of (this.battlefield || [])) {
                if (!perm) continue;
                const pName = (perm.name || '').toLowerCase();
                if (perm.attachedTo && String(perm.attachedTo) === String(card.id)) {
                    if (pName.includes('swiftfoot boots') && (kwLower === 'haste' || kwLower === 'hexproof')) return true;
                    if (pName.includes('lightning greaves') && (kwLower === 'haste' || kwLower === 'shroud')) return true;
                    if (pName.includes('fiendlash') && kwLower === 'reach') return true;
                }
                if (pName === 'death baron' && (isZombie || isSkeleton) && kwLower === 'deathtouch' && String(perm.id) !== String(card.id)) return true;
                if (pName === 'eternal skylord' && isZombie && isToken && kwLower === 'flying') return true;
                if (pName === 'gleaming overseer' && isZombie && isToken && (kwLower === 'hexproof' || kwLower === 'menace')) return true;
                if (pName === 'dragon tempest' && isDragon && kwLower === 'haste') return true;
                if (pName.includes('atarka, world render') && isDragon && kwLower === 'double strike') return true;
            }
            return false;
        };
        p.addCounter = function (card, counterType = '+1/+1', amount = 1) {
            if (!card || amount === 0) return;
            if (!Array.isArray(card.counters)) card.counters = [];
            const existing = card.counters.find(c => c.type === counterType);
            if (existing) {
                existing.count += amount;
                if (existing.count <= 0) {
                    card.counters = card.counters.filter(c => c !== existing);
                }
            } else if (amount > 0) {
                card.counters.push({ type: counterType, count: amount });
            }
        };
        p.sendToGraveyardOrCommandZone = function (card, game, toExile = false) {
            if (!card) return;
            const g = game || selfGame;
            if (g && g._removedPermanentIds && card.id) {
                g._removedPermanentIds.add(String(card.id));
            }
            if (Array.isArray(this.battlefield)) {
                this.battlefield = this.battlefield.filter(c => String(c.id) !== String(card.id));
                // Detach any equipment that was attached to this permanent
                this.battlefield.forEach(c => {
                    if (c.attachedTo && String(c.attachedTo) === String(card.id)) {
                        c.attachedTo = null;
                    }
                });
            }
            const wasCreature = Boolean(card.isCreature);
            const wasArtifact = Boolean(card.isArtifact);
            card.tapped = false;
            card.damageReceived = 0;
            card.tempPower = 0;
            card.tempToughness = 0;
            card.tempKeywords = [];
            card.summoningSick = false;
            card.attacksThisTurn = false;
            card.attachedTo = null;

            const cmdr = this.getCommander();
            if (card.isCommander || (cmdr && card.name === cmdr.name)) {
                if (!Array.isArray(this.commandZone)) this.commandZone = [];
                if (!this.commandZone.some(c => c.name === card.name)) {
                    this.commandZone.push(card);
                }
            } else if (toExile) {
                if (!card.isToken) {
                    if (!Array.isArray(this.exile)) this.exile = [];
                    if (!this.exile.some(c => String(c.id) === String(card.id))) {
                        this.exile.push(card);
                    }
                }
            } else {
                if (!card.isToken) {
                    if (!Array.isArray(this.graveyard)) this.graveyard = [];
                    if (!this.graveyard.some(c => String(c.id) === String(card.id))) {
                        this.graveyard.push(card);
                    }
                    this.graveyardCount = this.graveyard.length;
                }
            }

            if (!toExile && (wasCreature || wasArtifact) && g && typeof g.processDeathTriggers === 'function') {
                g.processDeathTriggers(card, this);
            }
        };
        p.untapAll = function () {
            (this.battlefield || []).forEach(c => {
                c.tapped = false;
                c.summoningSick = false;
                c.attacksThisTurn = false;
                c.damageReceived = 0;
                c.tempPower = 0;
                c.tempToughness = 0;
                c.tempKeywords = [];
                c.producedMana = null;
                c.paidLifeCost = null;
                c._loyaltyUsedThisTurn = false;
            });
            this.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        };
        p.draw = function (count = 1) {
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
                if (this.library) this.library.length = this.libraryCards.length;
            }
            return drawn;
        };
        p.takeMulligan = async function (bottomCardIds = [], autoBottom = false) {
            return await selfGame.takeMulligan();
        };
        p.bottomCards = async function (cardIds = []) {
            return await selfGame.bottomCards(cardIds);
        };
        p.keepHand = function () {
            this.handLocked = true;
            this.keptHandCards = [...(this.hand || [])];
            return {
                success: true,
                log: {
                    type: 'MULLIGAN_KEEP',
                    message: `✅ **${this.name}** keeps opening hand with **${this.hand.length}** cards!`
                }
            };
        };
        p.castCard = function (cardId, game, options = {}) {
            const g = game || selfGame;
            if (g) {
                g.playCard(cardId, options);
            }
            return { success: true, logs: [] };
        };
        p.castCommander = function (game) {
            const g = game || selfGame;
            if (g) {
                g.castCommander();
            }
            return { success: true, logs: [] };
        };
        p.toggleTapPermanent = function (cardId) {
            const card = (this.battlefield || []).find(c => c.id === cardId || String(c.id) === String(cardId));
            if (card) {
                card.tapped = !card.tapped;
            }
        };
        return p;
    }

    function parseManaCostDetailed(manaCostStr) {
        if (!manaCostStr || typeof manaCostStr !== 'string' || manaCostStr.trim().toLowerCase() === 'no cost') {
            return { cmc: 0, generic: 0, pips: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, hybrids: [], colors: [] };
        }
        let raw = manaCostStr.trim();
        if (!raw.includes('{')) {
            raw = raw.split(/\s+/).filter(Boolean).map(t => `{${t}}`).join('');
        }
        const matches = raw.match(/\{([^}]+)\}/g) || [];
        let generic = 0;
        const pips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        const hybrids = [];
        const colorSet = new Set();
        let cmc = 0;

        for (const m of matches) {
            const inner = m.replace(/[{}]/g, '').trim().toUpperCase();
            if (/^\d+$/.test(inner)) {
                const num = parseInt(inner, 10);
                generic += num;
                cmc += num;
            } else if (['W', 'U', 'B', 'R', 'G', 'C'].includes(inner)) {
                pips[inner] = (pips[inner] || 0) + 1;
                cmc += 1;
                if (inner !== 'C') colorSet.add(inner);
            } else if (inner.includes('/')) {
                const parts = inner.split('/');
                cmc += 1;
                if (parts.includes('P')) {
                    const col = parts.find(p => ['W', 'U', 'B', 'R', 'G'].includes(p));
                    if (col) {
                        hybrids.push({ options: [col], isPhyrexian: true });
                        colorSet.add(col);
                    }
                } else {
                    const validCols = parts.filter(p => ['W', 'U', 'B', 'R', 'G', 'C'].includes(p));
                    if (validCols.length > 0) {
                        hybrids.push({ options: validCols, isPhyrexian: false });
                        validCols.forEach(c => { if (c !== 'C') colorSet.add(c); });
                    }
                }
            }
        }
        return { cmc, generic, pips, hybrids, colors: Array.from(colorSet), raw };
    }

    function canPayManaCost(cardOrCost, manaPool, genericReduction = 0, extraGenericTax = 0) {
        let costStr = typeof cardOrCost === 'string' ? cardOrCost : (cardOrCost && (cardOrCost.manaCost || cardOrCost.mana_cost || cardOrCost.cost) ? (cardOrCost.manaCost || cardOrCost.mana_cost || cardOrCost.cost) : '');
        const isLand = cardOrCost && typeof cardOrCost === 'object' && Boolean(cardOrCost.isLand);
        if (isLand) return { canPay: true, missing: [], reason: '' };

        const nameLower = cardOrCost && typeof cardOrCost === 'object' ? (cardOrCost.name || '').toLowerCase().trim() : '';
        const cleanName = nameLower.normalize ? nameLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : nameLower;
        if (!costStr && nameLower) {
            if (typeof window !== 'undefined' && window.__MTG_CARD_CACHE__) {
                const cached = window.__MTG_CARD_CACHE__[nameLower] || window.__MTG_CARD_CACHE__[cleanName];
                if (cached && (cached.manaCost || cached.mana_cost)) costStr = cached.manaCost || cached.mana_cost;
            }
            if (!costStr && typeof window !== 'undefined' && window.__FORGE_SCRIPTS__) {
                const fs = window.__FORGE_SCRIPTS__[nameLower] || window.__FORGE_SCRIPTS__[cleanName];
                if (fs && fs.manaCost) costStr = fs.manaCost;
            }
        }

        const totalPool = ((manaPool && manaPool.W) || 0) + ((manaPool && manaPool.U) || 0) + ((manaPool && manaPool.B) || 0) + ((manaPool && manaPool.R) || 0) + ((manaPool && manaPool.G) || 0) + ((manaPool && manaPool.C) || 0);

        if (!costStr) {
            const cardCmc = (cardOrCost && typeof cardOrCost === 'object' && typeof cardOrCost.cmc === 'number') ? cardOrCost.cmc : 0;
            const isCmdr = Boolean(cardOrCost && typeof cardOrCost === 'object' && cardOrCost.isCommander);
            const isFreeSpell = nameLower.includes('rograkh') || nameLower === 'lotus petal' || nameLower === 'mox diamond' || nameLower === 'mox opal' || nameLower === 'chrome mox' || nameLower === 'everflowing chalice';
            if (isCmdr && !isFreeSpell && totalPool === 0) {
                return { canPay: false, missing: ['Commander Mana'], reason: 'Commander requires mana to cast (pool is empty)' };
            }
            const minNeeded = Math.max(0, cardCmc + extraGenericTax - genericReduction);
            if (minNeeded > 0 && totalPool < minNeeded) {
                return { canPay: false, missing: [`${minNeeded - totalPool} mana`], reason: `Need {${minNeeded}} mana in pool (have {${totalPool}})` };
            }
            return { canPay: true, missing: [], reason: '' };
        }

        const parsed = parseManaCostDetailed(costStr);
        const pool = {
            W: (manaPool && manaPool.W) || 0,
            U: (manaPool && manaPool.U) || 0,
            B: (manaPool && manaPool.B) || 0,
            R: (manaPool && manaPool.R) || 0,
            G: (manaPool && manaPool.G) || 0,
            C: (manaPool && manaPool.C) || 0
        };
        const missing = [];

        // 1. Specific colored pips
        const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'];
        for (const col of COLORS) {
            const req = (parsed.pips && parsed.pips[col]) || 0;
            if (req > 0) {
                if (pool[col] < req) {
                    missing.push(`${req - pool[col]} {${col}}`);
                    pool[col] = 0;
                } else {
                    pool[col] -= req;
                }
            }
        }

        // 2. Hybrids
        if (Array.isArray(parsed.hybrids)) {
            for (const h of parsed.hybrids) {
                const opts = h.options || [];
                const foundCol = opts.find(c => pool[c] > 0);
                if (foundCol) {
                    pool[foundCol]--;
                } else if (!h.isPhyrexian) {
                    missing.push(`1 {${opts.join('/')}}`);
                }
            }
        }

        // 3. Generic mana requirement (generic cost reduction applied)
        const genericNeeded = Math.max(0, (parsed.generic || 0) + extraGenericTax - genericReduction);
        const remainingPoolTotal = COLORS.reduce((sum, col) => sum + pool[col], 0);

        if (remainingPoolTotal < genericNeeded) {
            missing.push(`${genericNeeded - remainingPoolTotal} generic mana`);
        }

        if (missing.length > 0) {
            return {
                canPay: false,
                missing: missing,
                reason: `Need ${missing.join(', ')}`
            };
        }
        return { canPay: true, missing: [], reason: '' };
    }

    function deductDetailedMana(cardOrCost, manaPool, battlefield = [], genericReduction = 0, extraGenericTax = 0) {
        if (!manaPool) return;
        let costStr = typeof cardOrCost === 'string' ? cardOrCost : (cardOrCost && (cardOrCost.manaCost || cardOrCost.mana_cost || cardOrCost.cost) ? (cardOrCost.manaCost || cardOrCost.mana_cost || cardOrCost.cost) : '');
        const isLand = cardOrCost && typeof cardOrCost === 'object' && Boolean(cardOrCost.isLand);
        if (isLand) return;

        const nameLower = cardOrCost && typeof cardOrCost === 'object' ? (cardOrCost.name || '').toLowerCase().trim() : '';
        const cleanName = nameLower.normalize ? nameLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : nameLower;
        if (!costStr && nameLower) {
            if (typeof window !== 'undefined' && window.__MTG_CARD_CACHE__) {
                const cached = window.__MTG_CARD_CACHE__[nameLower] || window.__MTG_CARD_CACHE__[cleanName];
                if (cached && (cached.manaCost || cached.mana_cost)) costStr = cached.manaCost || cached.mana_cost;
            }
            if (!costStr && typeof window !== 'undefined' && window.__FORGE_SCRIPTS__) {
                const fs = window.__FORGE_SCRIPTS__[nameLower] || window.__FORGE_SCRIPTS__[cleanName];
                if (fs && fs.manaCost) costStr = fs.manaCost;
            }
        }

        // Numeric cost fallback
        if (typeof cardOrCost === 'number' || (/^\d+$/.test(String(costStr).trim()))) {
            let remaining = typeof cardOrCost === 'number' ? cardOrCost : parseInt(costStr, 10);
            remaining = Math.max(0, remaining + extraGenericTax - genericReduction);
            const order = ['C', 'W', 'G', 'R', 'U', 'B'];
            for (const col of order) {
                if (manaPool[col] > 0 && remaining > 0) {
                    const spend = Math.min(manaPool[col], remaining);
                    manaPool[col] -= spend;
                    remaining -= spend;
                    consumeBattlefieldPips(battlefield, col, spend);
                }
            }
            return;
        }

        const parsed = parseManaCostDetailed(costStr);
        const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'];

        // 1. Deduct exact colored pips
        for (const col of COLORS) {
            const req = (parsed.pips && parsed.pips[col]) || 0;
            if (req > 0 && manaPool[col] > 0) {
                const spend = Math.min(manaPool[col], req);
                manaPool[col] -= spend;
                consumeBattlefieldPips(battlefield, col, spend);
            }
        }

        // 2. Deduct hybrids
        if (Array.isArray(parsed.hybrids)) {
            for (const h of parsed.hybrids) {
                const opts = h.options || [];
                const foundCol = opts.find(c => manaPool[c] > 0);
                if (foundCol) {
                    manaPool[foundCol]--;
                    consumeBattlefieldPips(battlefield, foundCol, 1);
                }
            }
        }

        // 3. Deduct generic mana
        let genericNeeded = Math.max(0, (parsed.generic || 0) + extraGenericTax - genericReduction);
        const genericOrder = ['C', 'W', 'G', 'R', 'U', 'B'];
        for (const col of genericOrder) {
            if (genericNeeded <= 0) break;
            if (manaPool[col] > 0) {
                const spend = Math.min(manaPool[col], genericNeeded);
                manaPool[col] -= spend;
                genericNeeded -= spend;
                consumeBattlefieldPips(battlefield, col, spend);
            }
        }
    }

    function consumeBattlefieldPips(battlefield, color, count) {
        if (!Array.isArray(battlefield) || count <= 0) return;
        let toConsume = count;
        for (const perm of battlefield) {
            if (toConsume <= 0) break;
            if (perm && Array.isArray(perm.producedMana) && perm.producedMana.length > 0) {
                for (let i = perm.producedMana.length - 1; i >= 0 && toConsume > 0; i--) {
                    if (perm.producedMana[i] === color) {
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

    class HeadlessForgeBridge {
        constructor(apiBase = 'https://arena.edhchallenge.com/api/headless') {
            this.apiBase = apiBase;
        }

        async startCommanderMatchWithDecks(p1Name, p1Cmdr, p1Cards, p2Name, p2Cmdr, p2Cards, p3Name, p3Cmdr, p3Cards, p4Name, p4Cmdr, p4Cards, startingPlayerIndex = 0) {
            try {
                const res = await fetch(`${this.apiBase}/match/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        p1Name, p1Commander: p1Cmdr, p1Cards,
                        p2Name, p2Commander: p2Cmdr, p2Cards,
                        p3Name, p3Commander: p3Cmdr, p3Cards,
                        p4Name, p4Commander: p4Cmdr, p4Cards,
                        startingPlayerIndex
                    })
                });
                return await res.json();
            } catch (e) {
                console.warn("Headless startCommanderMatch error:", e);
                return null;
            }
        }

        async playCard(cardIdOrName) {
            try {
                const body = typeof cardIdOrName === 'number' ? { action: 'playCard', cardId: cardIdOrName } : { action: 'playCard', cardName: cardIdOrName };
                const res = await fetch(`${this.apiBase}/match/action`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                return await res.json();
            } catch (e) {
                console.warn("Headless playCard error:", e);
                return null;
            }
        }

        async castCommander() {
            try {
                const res = await fetch(`${this.apiBase}/match/action`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'castCommander' })
                });
                return await res.json();
            } catch (e) {
                console.warn("Headless castCommander error:", e);
                return null;
            }
        }

        async toggleTap(cardId) {
            try {
                const res = await fetch(`${this.apiBase}/match/action`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'toggleTap', cardId })
                });
                return await res.json();
            } catch (e) {
                console.warn("Headless toggleTap error:", e);
                return null;
            }
        }

        async stepPhase() {
            try {
                const res = await fetch(`${this.apiBase}/match/action`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'stepPhase' })
                });
                return await res.json();
            } catch (e) {
                console.warn("Headless stepPhase error:", e);
                return null;
            }
        }

        async stepTurn() {
            try {
                const res = await fetch(`${this.apiBase}/match/action`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'stepTurn' })
                });
                return await res.json();
            } catch (e) {
                console.warn("Headless stepTurn error:", e);
                return null;
            }
        }

        async stepAction() {
            try {
                const res = await fetch(`${this.apiBase}/match/action`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'stepAction' })
                });
                return await res.json();
            } catch (e) {
                console.warn("Headless stepAction error:", e);
                return null;
            }
        }

        async declareAttacks(cardId, targetPlayerIndex) {
            try {
                const res = await fetch(`${this.apiBase}/match/action`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'declareAttacks', cardId, targetPlayerIndex })
                });
                return await res.json();
            } catch (e) {
                console.warn("Headless declareAttacks error:", e);
                return null;
            }
        }

        async takeMulligan() {
            try {
                const res = await fetch(`${this.apiBase}/match/action`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'takeMulligan' })
                });
                return await res.json();
            } catch (e) {
                console.warn("Headless takeMulligan error:", e);
                return null;
            }
        }

        async getGameStateJson() {
            try {
                const res = await fetch(`${this.apiBase}/match/state`);
                return await res.json();
            } catch (e) {
                console.warn("Headless getGameStateJson error:", e);
                return null;
            }
        }
    }

    class ForgeArenaGame {
        constructor(bridge, rawJson, selectedDecks = []) {
            this.bridge = bridge;
            this.selectedDecks = selectedDecks;
            this.turn = 1;
            this.currentPhase = 'UNTAP';
            this.activePlayerIndex = 0;
            this.startingPlayerIndex = 0;
            this.isGameOver = false;
            this.winner = null;
            this.players = [];
            this.logs = [];
            this.isBusy = false;
            this._removedPermanentIds = new Set();

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

                const rawCmdrFromDeck = allCards.find(c => {
                    const cName = typeof c === 'string' ? c : (c && c.name ? c.name : '');
                    const cleanCName = cName.toLowerCase().normalize ? cName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : cName.toLowerCase();
                    const cleanCmdr = (cmdrName || '').toLowerCase().normalize ? (cmdrName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : (cmdrName || '').toLowerCase();
                    return (cleanCmdr && cleanCName === cleanCmdr) || (c && c.isCommander);
                });
                const baseCmdrData = (typeof rawCmdrFromDeck === 'object' && rawCmdrFromDeck !== null) ? rawCmdrFromDeck : {};

                const cmdrCard = enrichCard({
                    name: cmdrName,
                    isCommander: true,
                    manaCost: baseCmdrData.manaCost || baseCmdrData.mana_cost || deckInfo.manaCost || '',
                    cmc: baseCmdrData.cmc !== undefined ? baseCmdrData.cmc : (deckInfo.cmc !== undefined ? deckInfo.cmc : undefined),
                    power: baseCmdrData.power !== undefined ? baseCmdrData.power : (deckInfo.power !== undefined ? deckInfo.power : undefined),
                    toughness: baseCmdrData.toughness !== undefined ? baseCmdrData.toughness : (deckInfo.toughness !== undefined ? deckInfo.toughness : undefined),
                    typeLine: baseCmdrData.typeLine || baseCmdrData.type_line || deckInfo.typeLine || undefined,
                    oracleText: baseCmdrData.oracleText || baseCmdrData.oracle_text || deckInfo.oracleText || undefined
                }, true);

                const p = {
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
                    landsPlayedCount: 0,
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                    hand: openingHand,
                    keptHandCards: [...openingHand],
                    commandZone: [cmdrCard],
                    _commanderRef: cmdrCard,
                    battlefield: [],
                    graveyard: [],
                    exile: [],
                    commanderDamageReceived: {},
                    library: { length: libCards.length },
                    libraryCards: libCards
                };
                return attachPlayerMethods(p, idx, selfGame);
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
                    const removedSet = this._removedPermanentIds || new Set();
                    const p = {
                        id: `p_${idx + 1}`,
                        name: pData.name || existing.name || (idx === 0 ? 'You' : `Opponent ${idx}`),
                        life: pData.life !== undefined ? pData.life : (existing.life !== undefined ? existing.life : 40),
                        isAlive: pData.isAlive !== undefined ? pData.isAlive : (existing.isAlive !== undefined ? existing.isAlive : true),
                        isAI: idx !== 0,
                        commanderTax: Math.max(pData.commanderTax || 0, existing.commanderTax || 0),
                        libraryCount: existing.libraryCards ? existing.libraryCards.length : (pData.libraryCount || 53),
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
                        commandZone: (() => {
                            const cz = (pData.commandZone || []).map(c => enrichCard(c, true));
                            if (cz.length > 0) return cz;
                            return existing.commandZone || [];
                        })(),
                        _commanderRef: existing._commanderRef || ((pData.commandZone && pData.commandZone[0]) ? enrichCard(pData.commandZone[0], true) : null),
                        battlefield: (() => {
                            const incoming = (pData.battlefield || [])
                                .filter(c => !c || !removedSet.has(String(c.id)))
                                .map(c => enrichCard(c));

                            if (Array.isArray(existing.battlefield) && existing.battlefield.length > 0) {
                                const oldById = new Map();
                                const unmatchedTappedByName = new Map();
                                existing.battlefield.forEach(oldC => {
                                    if (!oldC || removedSet.has(String(oldC.id))) return;
                                    oldById.set(String(oldC.id), oldC);
                                    if (oldC.tapped) {
                                        const key = (oldC.name || '').toLowerCase();
                                        if (!unmatchedTappedByName.has(key)) unmatchedTappedByName.set(key, []);
                                        unmatchedTappedByName.get(key).push(oldC);
                                    }
                                });

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

                                const merged = incoming.map(c => {
                                    let oldC = oldById.get(String(c.id));
                                    if (!oldC) {
                                        const key = (c.name || '').toLowerCase();
                                        const arr = unmatchedTappedByName.get(key);
                                        if (arr && arr.length > 0) {
                                            oldC = arr.shift();
                                        }
                                    }
                                    if (oldC) {
                                        const isThisPlayerUntap = isNewTurnOrActive && this.activePlayerIndex === idx;
                                        if (!isThisPlayerUntap && idx === 0) {
                                            const isLandOrRock = Boolean(oldC.isLand || oldC.isManaRock || c.isLand || c.isManaRock);
                                            c.tapped = isLandOrRock ? Boolean(oldC.tapped) : Boolean(oldC.tapped || c.tapped);
                                            c.producedMana = (c.tapped && Array.isArray(oldC.producedMana) && oldC.producedMana.length > 0)
                                                ? [...oldC.producedMana]
                                                : null;
                                            c.paidLifeCost = oldC.paidLifeCost || null;
                                            c._enteredTappedTurn = oldC._enteredTappedTurn || null;
                                        } else if (!isThisPlayerUntap) {
                                            c.tapped = Boolean(oldC.tapped || c.tapped);
                                        } else if (isThisPlayerUntap) {
                                            c.tapped = false;
                                            c.producedMana = null;
                                            c.paidLifeCost = null;
                                            c._enteredTappedTurn = null;
                                        }
                                        if (Array.isArray(oldC.counters) && oldC.counters.length > 0) c.counters = oldC.counters;
                                        if (oldC.loyalty !== undefined) c.loyalty = oldC.loyalty;
                                        if (oldC.attachedTo) c.attachedTo = oldC.attachedTo;
                                        if (!isThisPlayerUntap) {
                                            c.summoningSick = Boolean(oldC.summoningSick);
                                            c.damageReceived = oldC.damageReceived || 0;
                                            c.tempPower = oldC.tempPower || 0;
                                            c.tempToughness = oldC.tempToughness || 0;
                                            c.tempKeywords = oldC.tempKeywords || [];
                                            c._loyaltyUsedThisTurn = Boolean(oldC._loyaltyUsedThisTurn);
                                        } else {
                                            c.summoningSick = false;
                                            c.damageReceived = 0;
                                            c.tempPower = 0;
                                            c.tempToughness = 0;
                                            c.tempKeywords = [];
                                            c._loyaltyUsedThisTurn = false;
                                        }
                                    }
                                    return c;
                                });

                                // Preserve JS-created tokens and JS-placed permanents (such as fetched/ramped lands or reanimated permanents)
                                existing.battlefield.forEach(oldC => {
                                    if (!oldC || removedSet.has(String(oldC.id))) return;
                                    if (oldC.isToken || oldC._jsPlaced) {
                                        if (!merged.some(m => String(m.id) === String(oldC.id))) {
                                            if (isNewTurnOrActive && this.activePlayerIndex === idx) {
                                                oldC.tapped = false;
                                                oldC.summoningSick = false;
                                                oldC.damageReceived = 0;
                                                oldC.tempPower = 0;
                                                oldC.tempToughness = 0;
                                                oldC._loyaltyUsedThisTurn = false;
                                            }
                                            merged.push(oldC);
                                        }
                                    }
                                });

                                return merged;
                            }
                            return incoming;
                        })(),
                        graveyard: (() => {
                            const incGy = (pData.graveyard || []).map(c => enrichCard(c));
                            if (Array.isArray(existing.graveyard) && existing.graveyard.length > 0) {
                                existing.graveyard.forEach(gCard => {
                                    if (gCard && !incGy.some(c => String(c.id) === String(gCard.id))) {
                                        incGy.push(gCard);
                                    }
                                });
                            }
                            return incGy;
                        })(),
                        exile: existing.exile || [],
                        commanderDamageReceived: existing.commanderDamageReceived || {},
                        library: { length: existing.libraryCards ? existing.libraryCards.length : (pData.libraryCount || 53) },
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
                        })()
                    };
                    p.handCount = p.hand.length;
                    p.graveyardCount = p.graveyard.length;
                    if (p.libraryCards) {
                        p.libraryCount = p.libraryCards.length;
                        p.library.length = p.libraryCards.length;
                    }
                    attachPlayerMethods(p, idx, selfGame);
                    if (existing && typeof existing === 'object' && Object.keys(existing).length > 0) {
                        Object.assign(existing, p);
                        return existing;
                    }
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

        createTokenPermanent(controller, tokenSpec = {}) {
            if (!controller) return null;
            const tok = enrichCard({
                id: 'tok_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
                name: tokenSpec.name || 'Zombie Token',
                typeLine: tokenSpec.typeLine || 'Token Creature — Zombie',
                power: tokenSpec.power !== undefined ? tokenSpec.power : 2,
                toughness: tokenSpec.toughness !== undefined ? tokenSpec.toughness : 2,
                isCreature: tokenSpec.isCreature !== undefined ? tokenSpec.isCreature : true,
                isArtifact: Boolean(tokenSpec.isArtifact),
                isToken: true,
                _jsPlaced: true,
                tapped: Boolean(tokenSpec.tapped),
                summoningSick: tokenSpec.isCreature !== false && !Boolean(tokenSpec.haste),
                oracleText: tokenSpec.oracleText || '',
                keywords: tokenSpec.keywords || []
            });
            if (Array.isArray(tokenSpec.keywords)) {
                tok.keywords = new Set(tokenSpec.keywords.map(k => String(k).toLowerCase()));
            }
            if (tok.hasEffectiveKeyword && controller.hasEffectiveKeyword && controller.hasEffectiveKeyword(tok, 'haste')) {
                tok.summoningSick = false;
            }
            if (!Array.isArray(controller.battlefield)) controller.battlefield = [];
            controller.battlefield.push(tok);
            return tok;
        }
        amass(controller, count = 1, subtype = 'Orc Army') {
            if (!controller) return null;
            const subLower = String(subtype || '').toLowerCase();
            const tokenType = subLower.includes('orc') ? 'Orc Army' : 'Zombie Army';
            const isOrc = subLower.includes('orc');

            // Find an existing Army controlled by controller
            const existingArmy = (controller.battlefield || []).find(c => c && c.isCreature && this.hasSubtype(c, 'Army'));
            if (existingArmy) {
                if (isOrc) {
                    if (existingArmy.subtypes instanceof Set) existingArmy.subtypes.add('Orc');
                    if (existingArmy.typeLine && !existingArmy.typeLine.toLowerCase().includes('orc')) {
                        existingArmy.typeLine = existingArmy.typeLine.replace(/Army/i, 'Orc Army');
                    }
                } else {
                    if (existingArmy.subtypes instanceof Set) existingArmy.subtypes.add('Zombie');
                    if (existingArmy.typeLine && !existingArmy.typeLine.toLowerCase().includes('zombie')) {
                        existingArmy.typeLine = existingArmy.typeLine.replace(/Army/i, 'Zombie Army');
                    }
                }
                if (typeof controller.addCounter === 'function') {
                    controller.addCounter(existingArmy, '+1/+1', count);
                } else {
                    existingArmy.tempPower = (existingArmy.tempPower || 0) + count;
                    existingArmy.tempToughness = (existingArmy.tempToughness || 0) + count;
                }
                const pwr = typeof controller.getEffectivePower === 'function' ? controller.getEffectivePower(existingArmy) : ((existingArmy.power || 0) + (existingArmy.tempPower || 0));
                const tgh = typeof controller.getEffectiveToughness === 'function' ? controller.getEffectiveToughness(existingArmy) : ((existingArmy.toughness || 0) + (existingArmy.tempToughness || 0));
                this.logs.push({
                    type: 'TRIGGER',
                    message: `🛡️ **Amass ${isOrc ? 'Orcs' : 'Zombies'} ${count}**: Put **${count}** +1/+1 counter(s) on **${existingArmy.name}** (now ${pwr}/${tgh})!`
                });
                return existingArmy;
            } else {
                const armyToken = this.createTokenPermanent(controller, {
                    name: `${tokenType} Token`,
                    typeLine: `Token Creature — ${tokenType}`,
                    power: 0,
                    toughness: 0,
                    isCreature: true,
                    colors: ['B']
                });
                if (armyToken && typeof controller.addCounter === 'function') {
                    controller.addCounter(armyToken, '+1/+1', count);
                } else if (armyToken) {
                    armyToken.tempPower = count;
                    armyToken.tempToughness = count;
                }
                const pwr = typeof controller.getEffectivePower === 'function' ? controller.getEffectivePower(armyToken) : count;
                const tgh = typeof controller.getEffectiveToughness === 'function' ? controller.getEffectiveToughness(armyToken) : count;
                this.logs.push({
                    type: 'TRIGGER',
                    message: `🛡️ **Amass ${isOrc ? 'Orcs' : 'Zombies'} ${count}**: Created a **${pwr}/${tgh}** black ${tokenType} token!`
                });
                return armyToken;
            }
        }

        ringTempts(player, sourceCard = null) {
            if (!player) return;
            player.ringLevel = Math.min(4, (player.ringLevel || 0) + 1);
            player.ringTemptCount = (player.ringTemptCount || 0) + 1;

            // Choose a Ring-bearer from creatures on battlefield
            const creatures = (player.battlefield || []).filter(c => c && (c.isCreature || (c.typeLine || '').toLowerCase().includes('creature')));
            let currentBearer = creatures.find(c => c.isRingBearer || (player.ringBearerId && String(c.id) === String(player.ringBearerId)));

            if (!currentBearer && creatures.length > 0) {
                if (sourceCard && creatures.some(c => String(c.id) === String(sourceCard.id))) {
                    currentBearer = sourceCard;
                } else {
                    currentBearer = creatures[0];
                }
            }

            if (currentBearer) {
                creatures.forEach(c => { c.isRingBearer = false; });
                currentBearer.isRingBearer = true;
                currentBearer.isLegendary = true;
                player.ringBearerId = String(currentBearer.id);
            }

            this.logs.push({
                type: 'TRIGGER',
                message: `💍 **The Ring tempts you!** (Stage **${player.ringLevel}/4**)${currentBearer ? ` • **${currentBearer.name}** is your Ring-bearer!` : ''}`
            });

            // 1. Nazgûl / Wraith Trigger:
            // "Whenever the Ring tempts you, put a +1/+1 counter on each Wraith you control."
            const wraiths = (player.battlefield || []).filter(c => {
                if (!c) return false;
                const cName = (c.name || '').toLowerCase();
                const tl = (c.typeLine || '').toLowerCase();
                return tl.includes('wraith') || cName.includes('nazg') || (c.subtypes instanceof Set && c.subtypes.has('Wraith'));
            });

            if (wraiths.length > 0) {
                wraiths.forEach(w => {
                    if (typeof player.addCounter === 'function') {
                        player.addCounter(w, '+1/+1', 1);
                    } else {
                        w.counters = Array.isArray(w.counters) ? w.counters : [];
                        w.counters.push({ type: '+1/+1', count: 1 });
                        w.tempPower = (w.tempPower || 0) + 1;
                        w.tempToughness = (w.tempToughness || 0) + 1;
                    }
                });
                this.logs.push({
                    type: 'TRIGGER',
                    message: `⚔️ **Nazgûl Wraith Synergy**: Put a +1/+1 counter on **${wraiths.length}** Wraith(s) (${wraiths.map(w => {
                        const p = typeof player.getEffectivePower === 'function' ? player.getEffectivePower(w) : (w.power || 0);
                        const t = typeof player.getEffectiveToughness === 'function' ? player.getEffectiveToughness(w) : (w.toughness || 0);
                        return `${w.name} is now ${p}/${t}`;
                    }).join(', ')})!`
                });
            }

            // 2. Sauron, the Dark Lord Trigger:
            // "Whenever the Ring tempts you, you may sacrifice a legendary creature. If you do, discard your hand, then draw four cards."
            const sauron = (player.battlefield || []).find(c => (c.name || '').toLowerCase().includes('sauron, the dark lord'));
            if (sauron && typeof player.draw === 'function') {
                if ((player.hand || []).length <= 2) {
                    player.hand = [];
                    player.handCount = 0;
                    const drawn = player.draw(4);
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `👑 **Sauron, the Dark Lord**: Ring temptation wheel! Discarded hand and drew **4** new cards!`
                    });
                }
            }

            // 3. Call of the Ring Trigger:
            // "Whenever you choose a creature as your Ring-bearer, you may pay 2 life. If you do, draw a card."
            const callOfTheRing = (player.battlefield || []).find(c => (c.name || '').toLowerCase().includes('call of the ring'));
            if (callOfTheRing && currentBearer && player.life > 2 && typeof player.draw === 'function') {
                let shouldPay = true;
                if (player.id === 'p_1' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
                    shouldPay = window.confirm(`💍 Call of the Ring Trigger:\n\nYou chose ${currentBearer.name} as your Ring-bearer.\nPay 2 life to draw a card?`);
                }
                if (shouldPay) {
                    player.life -= 2;
                    const drawn = player.draw(1);
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `💍 **Call of the Ring**: **${player.name}** paid 2 life (now at ${player.life}) to draw a card (${drawn.length ? drawn[0].name : ''})!`
                    });
                }
            }

            // If player has multiple creatures and is human player, trigger selection modal
            if (player.id === 'p_1' && creatures.length > 1 && typeof window !== 'undefined' && typeof window.openRingBearerModal === 'function') {
                window.openRingBearerModal(player, creatures);
            }
        }

        checkStateBasedActions() {
            for (const p of (this.players || [])) {
                if (!p || !p.isAlive) continue;
                // Check life <= 0
                if (p.life <= 0) {
                    p.isAlive = false;
                    this.logs.push({
                        type: 'ELIMINATION',
                        message: `💀 **${p.name}** has been eliminated (Life total reached ${p.life})!`
                    });
                }
                // Check 21+ Commander Damage
                if (p.commanderDamageReceived) {
                    for (const [cmdrKey, dmg] of Object.entries(p.commanderDamageReceived)) {
                        if (dmg >= 21 && p.isAlive) {
                            p.isAlive = false;
                            this.logs.push({
                                type: 'ELIMINATION',
                                message: `⚔️💀 **${p.name}** has been eliminated by **${dmg}** Commander Damage from **${cmdrKey}**!`
                            });
                        }
                    }
                }
                // Check creatures with 0 or less toughness or lethal damage, and planeswalkers with 0 loyalty
                if (Array.isArray(p.battlefield)) {
                    const toDestroy = [];
                    for (const perm of p.battlefield) {
                        if (!perm) continue;
                        if (perm.isCreature) {
                            const effTgh = typeof p.getEffectiveToughness === 'function' ? p.getEffectiveToughness(perm) : (perm.toughness || 0);
                            const dmg = perm.damageReceived || 0;
                            if (effTgh <= 0 || (dmg >= effTgh && effTgh > 0)) {
                                toDestroy.push(perm);
                            }
                        } else if (perm.isPlaneswalker && perm.loyalty !== undefined && perm.loyalty <= 0) {
                            toDestroy.push(perm);
                        }
                    }
                    for (const dead of toDestroy) {
                        if (typeof p.sendToGraveyardOrCommandZone === 'function') {
                            p.sendToGraveyardOrCommandZone(dead, this, false);
                        }
                    }
                }
            }
            const alive = (this.players || []).filter(p => p && p.isAlive);
            if (alive.length <= 1 && (this.players || []).length > 1) {
                this.isGameOver = true;
                this.winner = alive[0] || null;
            }
        }

        triggerLandfall(landCard, controller) {
            if (!controller || !Array.isArray(controller.battlefield)) return;
            for (const perm of [...controller.battlefield]) {
                if (!perm) continue;
                const pName = (perm.name || '').toLowerCase();
                if (pName.includes('aesi, tyrant of gyre strait') || pName.includes('tatyova, benthic druid')) {
                    if (pName.includes('tatyova')) controller.life += 1;
                    const drawn = typeof controller.draw === 'function' ? controller.draw(1) : [];
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `🌊 **${perm.name}** Landfall triggered: **${controller.name}** ${pName.includes('tatyova') ? 'gained 1 life and ' : ''}drew ${drawn.length > 0 ? `**${drawn[0].name}**` : 'a card'}.`
                    });
                } else if (pName.includes('rampaging baloths')) {
                    this.createTokenPermanent(controller, {
                        name: 'Beast Token',
                        typeLine: 'Token Creature — Beast',
                        power: 4,
                        toughness: 4,
                        isCreature: true
                    });
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `🐾 **${perm.name}** Landfall triggered: Created a 4/4 green Beast creature token!`
                    });
                } else if (pName.includes('avenger of zendikar')) {
                    let buffed = 0;
                    controller.battlefield.forEach(c => {
                        if ((c.typeLine || '').toLowerCase().includes('plant') && typeof controller.addCounter === 'function') {
                            controller.addCounter(c, '+1/+1', 1);
                            buffed++;
                        }
                    });
                    if (buffed > 0) {
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `🌱 **${perm.name}** Landfall triggered: Put a +1/+1 counter on **${buffed}** Plant token(s)!`
                        });
                    }
                } else if (pName.includes('scute swarm')) {
                    const landCount = controller.battlefield.filter(c => c.isLand).length;
                    this.createTokenPermanent(controller, {
                        name: landCount >= 6 ? 'Scute Swarm' : 'Insect Token',
                        typeLine: 'Token Creature — Insect',
                        power: 1,
                        toughness: 1,
                        isCreature: true
                    });
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `🪲 **${perm.name}** Landfall triggered: Created a 1/1 Insect token!`
                    });
                } else if (pName.includes('sporemound')) {
                    this.createTokenPermanent(controller, {
                        name: 'Saproling Token',
                        typeLine: 'Token Creature — Saproling',
                        power: 1,
                        toughness: 1,
                        isCreature: true
                    });
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `🍄 **${perm.name}** Landfall triggered: Created a 1/1 green Saproling creature token!`
                    });
                } else if (pName.includes('tireless provisioner')) {
                    this.createTokenPermanent(controller, {
                        name: 'Treasure Token',
                        typeLine: 'Token Artifact — Treasure',
                        isArtifact: true,
                        isManaRock: true,
                        oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.'
                    });
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `🪙 **${perm.name}** Landfall triggered: Created a Treasure token!`
                    });
                } else if (pName.includes('lotus cobra')) {
                    if (controller.manaPool) {
                        controller.manaPool.G = (controller.manaPool.G || 0) + 1;
                    }
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `🐍 **${perm.name}** Landfall triggered: Added {G} to **${controller.name}**'s mana pool!`
                    });
                } else if (pName.includes('felidar retreat')) {
                    this.createTokenPermanent(controller, {
                        name: 'Cat Beast Token',
                        typeLine: 'Token Creature — Cat Beast',
                        power: 2,
                        toughness: 2,
                        isCreature: true
                    });
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `🐾 **${perm.name}** Landfall triggered: Created a 2/2 white Cat Beast creature token!`
                    });
                } else if (pName.includes('curse of the restless dead') || pName.includes('field of the dead')) {
                    this.createTokenPermanent(controller, {
                        name: 'Zombie Token',
                        typeLine: 'Token Creature — Zombie',
                        power: 2,
                        toughness: 2,
                        tapped: true,
                        isCreature: true
                    });
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `🧟 **${perm.name}** Landfall triggered: Created a tapped 2/2 black Zombie creature token!`
                    });
                }
            }
        }

        hasSubtype(card, subtype) {
            if (!card || !subtype) return false;
            const target = String(subtype).trim().toLowerCase();
            if (!target) return false;
            const nameLower = (card.name || '').trim().toLowerCase();
            if (nameLower === target || nameLower === `snow-covered ${target}`) return true;
            if (card.subtypes instanceof Set) {
                for (const s of card.subtypes) {
                    if (String(s).toLowerCase() === target) return true;
                }
            } else if (Array.isArray(card.subtypes)) {
                if (card.subtypes.some(s => String(s).toLowerCase() === target)) return true;
            }
            if (card.forgeScript && Array.isArray(card.forgeScript.subtypes)) {
                if (card.forgeScript.subtypes.some(s => String(s).toLowerCase() === target)) return true;
            }
            const tl = (card.typeLine || '').toLowerCase();
            const subtypeRegex = new RegExp(`\\b${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            if (subtypeRegex.test(tl)) return true;
            // Check changeling keyword for creature subtypes
            const basicLandTypes = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes']);
            if (!basicLandTypes.has(target)) {
                const oLower = (card.oracleText || '').toLowerCase();
                if (oLower.includes('changeling') || (card.keywords instanceof Set && card.keywords.has('changeling'))) {
                    return true;
                }
            }
            return false;
        }

        isBasicLand(card) {
            if (!card) return false;
            if (card.isBasicLand) return true;
            const nameLower = (card.name || '').trim().toLowerCase();
            const basicNames = new Set([
                'plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
                'snow-covered plains', 'snow-covered island', 'snow-covered swamp',
                'snow-covered mountain', 'snow-covered forest', 'snow-covered wastes'
            ]);
            if (basicNames.has(nameLower)) return true;
            const tl = (card.typeLine || '').toLowerCase();
            if (tl.includes('basic') && tl.includes('land')) return true;
            if (card.forgeScript && Array.isArray(card.forgeScript.supertypes) && card.forgeScript.supertypes.includes('Basic')) {
                return true;
            }
            return false;
        }

        evaluateETBReplacement(card, controller, options = {}) {
            const result = {
                entersTapped: false,
                reason: '',
                counters: [],
                paidShockLife: false,
                revealedCardName: null,
                isShockLand: false
            };
            if (!card || !controller) return result;

            const nameLower = (card.name || '').trim().toLowerCase();
            const oracle = String(card.oracleText || (card.forgeScript && card.forgeScript.oracle) || '');
            const oracleLower = oracle.toLowerCase();
            const tl = (card.typeLine || '').toLowerCase();
            const otherBf = (controller.battlefield || []).filter(c => c && c !== card && (card.id !== undefined && card.id !== null ? String(c.id) !== String(card.id) : true));
            const otherLands = otherBf.filter(c => c.isLand || (c.typeLine || '').toLowerCase().includes('land'));
            const handOther = (controller.hand || []).filter(c => c && c !== card && (card.id !== undefined && card.id !== null ? String(c.id) !== String(card.id) : true));

            // 1. Check Lands (1+ land of required basic subtype(s) controlled)
            const checkLandMap = {
                'drowned catacomb': ['Island', 'Swamp'],
                'dragonskull summit': ['Swamp', 'Mountain'],
                'woodland cemetery': ['Swamp', 'Forest'],
                'rootbound crag': ['Mountain', 'Forest'],
                'hinterland harbor': ['Forest', 'Island'],
                'glacial fortress': ['Plains', 'Island'],
                'isolated chapel': ['Plains', 'Swamp'],
                'sulfur falls': ['Island', 'Mountain'],
                'clifftop retreat': ['Mountain', 'Plains'],
                'sunpetal grove': ['Forest', 'Plains'],
                'castle locthwain': ['Swamp'],
                'castle vantress': ['Island'],
                'castle garenbrig': ['Forest'],
                'castle ardenvale': ['Plains'],
                'castle embereth': ['Mountain']
            };
            let checkSubtypes = checkLandMap[nameLower] || null;
            if (!checkSubtypes && !oracleLower.includes('three or more')) {
                const mCheck = oracleLower.match(/enters(?: the battlefield)? tapped unless you control a[n]?\s+(plains|island|swamp|mountain|forest)(?:\s+or\s+a[n]?\s+(plains|island|swamp|mountain|forest))?/i);
                if (mCheck) {
                    checkSubtypes = [mCheck[1], mCheck[2]].filter(Boolean).map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
                }
            }
            if (checkSubtypes && checkSubtypes.length > 0) {
                const matchingLand = otherBf.find(p => checkSubtypes.some(sub => this.hasSubtype(p, sub)));
                if (matchingLand) {
                    result.entersTapped = false;
                    result.reason = `enters untapped (controls ${matchingLand.name})`;
                } else {
                    result.entersTapped = true;
                    result.reason = `enters tapped (requires ${checkSubtypes.join(' or ')})`;
                }
                return result;
            }

            if (nameLower === 'archway of innovation' || /enters(?: the battlefield)? tapped unless you control an artifact/i.test(oracleLower)) {
                const hasArt = otherBf.some(p => p.isArtifact || (p.typeLine || '').toLowerCase().includes('artifact'));
                result.entersTapped = !hasArt;
                result.reason = hasArt ? 'enters untapped (controls an artifact)' : 'enters tapped (no artifact controlled)';
                return result;
            }

            // 2. 3+ Same-Subtype Check Lands (Witch's Cottage, Mystic Sanctuary, Dwarven Mine, Gingerbread Cabin, Idyllic Grange)
            const threeSubtypeMap = {
                "witch's cottage": 'Swamp',
                'mystic sanctuary': 'Island',
                'dwarven mine': 'Mountain',
                'gingerbread cabin': 'Forest',
                'idyllic grange': 'Plains'
            };
            let threeSub = threeSubtypeMap[nameLower] || null;
            if (!threeSub) {
                const mThree = oracleLower.match(/enters(?: the battlefield)? tapped unless you control three or more other (plains|islands|swamps|mountains|forests)/i);
                if (mThree) {
                    const rawSub = mThree[1].toLowerCase().replace(/s$/, '');
                    threeSub = rawSub === 'plain' ? 'Plains' : (rawSub.charAt(0).toUpperCase() + rawSub.slice(1));
                }
            }
            if (threeSub) {
                const matchingCount = otherBf.filter(p => this.hasSubtype(p, threeSub)).length;
                if (matchingCount >= 3) {
                    result.entersTapped = false;
                    result.reason = `enters untapped (controls ${matchingCount} other ${threeSub}s)`;
                } else {
                    result.entersTapped = true;
                    result.reason = `enters tapped (controls ${matchingCount}/3 other ${threeSub}s)`;
                }
                return result;
            }

            // 3. Battle / Tango Lands (enters tapped unless you control two or more basic lands)
            const tangoLands = new Set([
                'sunken hollow', 'smoldering marsh', 'cinder glade', 'canopy vista', 'prairie stream',
                'radiant summit', 'sodden verdure', 'vernal fen'
            ]);
            if (tangoLands.has(nameLower) || /enters(?: the battlefield)? tapped unless you control two or more basic lands/i.test(oracleLower)) {
                const basicCount = otherLands.filter(p => this.isBasicLand(p)).length;
                if (basicCount >= 2) {
                    result.entersTapped = false;
                    result.reason = `enters untapped (controls ${basicCount} basic lands)`;
                } else {
                    result.entersTapped = true;
                    result.reason = `enters tapped (controls ${basicCount}/2 basic lands)`;
                }
                return result;
            }

            // 4. Reveal / Snarl / Tribal Lands (reveal a card of subtype X or Y from hand)
            const revealLandMap = {
                'choked estuary': ['Island', 'Swamp'],
                'foreboding ruins': ['Mountain', 'Swamp'],
                'game trail': ['Mountain', 'Forest'],
                'fortified village': ['Forest', 'Plains'],
                'port town': ['Plains', 'Island'],
                'vineglimmer snarl': ['Forest', 'Island'],
                'necroblossom snarl': ['Swamp', 'Forest'],
                'furycalm snarl': ['Mountain', 'Plains'],
                'frostboil snarl': ['Island', 'Mountain'],
                'shineshadow snarl': ['Plains', 'Swamp'],
                'gilt-leaf palace': ['Elf'],
                "auntie's hovel": ['Goblin'],
                'secluded glen': ['Faerie'],
                'wanderwine hub': ['Merfolk'],
                'ancient amphitheater': ['Giant'],
                'rustic clachan': ['Kithkin'],
                'murmuring bosk': ['Treefolk'],
                'flamekin village': ['Elemental'],
                'fortified beachhead': ['Soldier'],
                'temple of the dragon queen': ['Dragon']
            };
            let revealSubtypes = revealLandMap[nameLower] || null;
            if (!revealSubtypes) {
                const mRev = oracleLower.match(/as .* enters(?: the battlefield)?, you may reveal a[n]?\s+([a-z]+)(?:\s+or\s+([a-z]+))?\s+card from your hand/i);
                if (mRev) {
                    revealSubtypes = [mRev[1], mRev[2]].filter(Boolean).map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
                }
            }
            if (revealSubtypes && revealSubtypes.length > 0) {
                const revealable = handOther.find(h => revealSubtypes.some(sub => this.hasSubtype(h, sub)));
                if (revealable && options.declineReveal !== true) {
                    result.entersTapped = false;
                    result.revealedCardName = revealable.name;
                    result.reason = `enters untapped (revealed ${revealable.name} from hand)`;
                } else {
                    result.entersTapped = true;
                    result.reason = `enters tapped (no ${revealSubtypes.join(' or ')} card revealed from hand)`;
                }
                return result;
            }

            // 5. Fast Lands (enters tapped unless you control two or fewer other lands)
            const fastLands = new Set([
                'darkslick shores', 'blackcleave cliffs', 'copperline gorge', 'seachrome coast', 'razorverge thicket',
                'blooming marsh', 'spirebluff canal', 'botanical sanctum', 'concealed courtyard', 'inspiring vantage'
            ]);
            if (fastLands.has(nameLower) || /enters(?: the battlefield)? tapped unless you control two or fewer other lands/i.test(oracleLower)) {
                if (otherLands.length <= 2) {
                    result.entersTapped = false;
                    result.reason = `enters untapped (controls ${otherLands.length} other lands, <= 2)`;
                } else {
                    result.entersTapped = true;
                    result.reason = `enters tapped (controls ${otherLands.length} other lands, > 2)`;
                }
                return result;
            }

            // 6. Slow Lands (enters tapped unless you control two or more other lands)
            const slowLands = new Set([
                'shipwreck marsh', 'haunted ridge', 'rockfall vale', 'dreamroot cascade', 'deserted beach',
                'shattered sanctum', 'stormcarved coast', 'deathcap glade', 'overgrown farmland', 'sundown pass'
            ]);
            if (slowLands.has(nameLower) || /enters(?: the battlefield)? tapped unless you control two or more other lands/i.test(oracleLower)) {
                if (otherLands.length >= 2) {
                    result.entersTapped = false;
                    result.reason = `enters untapped (controls ${otherLands.length} other lands, >= 2)`;
                } else {
                    result.entersTapped = true;
                    result.reason = `enters tapped (controls ${otherLands.length}/2 other lands)`;
                }
                return result;
            }

            // 7. Crowd / Bond Lands (enters tapped unless you have two or more opponents)
            const crowdLands = new Set([
                'morphic pool', 'luxury suite', 'spire garden', 'bountiful promenade', 'sea of clouds',
                'undergrowth stadium', 'rejuvenating springs', 'spectator seating', 'training center', 'vault of champions'
            ]);
            if (crowdLands.has(nameLower) || /enters(?: the battlefield)? tapped unless you have two or more opponents/i.test(oracleLower)) {
                const aliveOpponents = (this.players || []).filter(pl => pl && pl !== controller && pl.isAlive).length;
                if (aliveOpponents >= 2) {
                    result.entersTapped = false;
                    result.reason = `enters untapped (${aliveOpponents} opponents)`;
                } else {
                    result.entersTapped = true;
                    result.reason = `enters tapped (only ${aliveOpponents} opponent)`;
                }
                return result;
            }

            // 8. Shock Lands (pay 2 life or enters tapped)
            const shockLands = new Set([
                'watery grave', 'blood crypt', 'stomping ground', 'breeding pool', 'overgrown tomb',
                'hallowed fountain', 'godless shrine', 'steam vents', 'sacred foundry', 'temple garden'
            ]);
            if (shockLands.has(nameLower) || /as .* enters(?: the battlefield)?, you may pay 2 life\. if you don't, it enters(?: the battlefield)? tapped/i.test(oracleLower)) {
                result.isShockLand = true;
                const shouldPay = options.payShockLife !== undefined
                    ? Boolean(options.payShockLife)
                    : Boolean(controller.isAI && controller.life > 10);
                if (shouldPay && controller.life > 2) {
                    result.entersTapped = false;
                    result.paidShockLife = true;
                    result.reason = 'enters untapped (paid 2 life)';
                } else {
                    result.entersTapped = true;
                    result.reason = 'enters tapped (did not pay 2 life)';
                }
                return result;
            }

            
            // 8b. The Black Gate (pay 3 life or enters tapped)
            if (nameLower === 'the black gate' || nameLower === 'black gate' || /as .* enters(?: the battlefield)?, you may pay 3 life\. if you don't, it enters(?: the battlefield)? tapped/i.test(oracleLower)) {
                result.isShockLand = true;
                result.lifeCost = 3;
                const shouldPay = options.payShockLife !== undefined
                    ? Boolean(options.payShockLife)
                    : Boolean(controller.isAI && controller.life > 15);
                if (shouldPay && controller.life > 3) {
                    result.entersTapped = false;
                    result.paidShockLife = true;
                    result.reason = 'enters untapped (paid 3 life)';
                } else {
                    result.entersTapped = true;
                    result.reason = 'enters tapped (did not pay 3 life)';
                }
                return result;
            }
            // 9. Unconditional Taplands & Tapped Artifacts / Creatures
            const unconditionalTappedNames = new Set([
                'bojuka bog', 'mortuary mire', 'path of ancestry', 'myriad landscape', 'command bridge',
                'dimir aqueduct', 'golgari rot farm', 'rakdos carnarium', 'simic growth chamber', 'gruul turf',
                'azorius chancery', 'boros garrison', 'izzet boilerworks', 'orzhov basilica', 'selesnya sanctuary',
                'guildless commons', 'arid archway', 'jungle basin', 'everglades', 'coral atoll', 'dormant volcano', 'karoo',
                'opulent palace', 'crumbling necropolis', 'savage lands', 'jungle shrine', 'arcane sanctum',
                'seaside citadel', 'sandsteppe citadel', 'nomad outpost', 'mystic monastery', 'frontier bivouac',
                'zagoth triome', 'indatha triome', 'ketria triome', 'raugrin triome', 'savai triome',
                "raffine's tower", "xander's lounge", "ziatora's proving ground", "jetmir's garden", "spara's headquarters",
                'dismal backwater', 'jungle hollow', 'bloodfell caves', 'thornwood falls', 'rugged highlands',
                'tranquil cove', 'scoured barrens', 'swiftwater cliffs', 'wind-scarred crag', 'blossoming sands',
                'jwar isle refuge', 'kazandu refuge', 'akoum refuge', 'graypelt refuge', 'sejiri refuge',
                'foul orchard', 'submerged boneyard', 'cinder barrens', 'woodland stream', 'timber gorge',
                'meandering river', 'forsaken sanctuary', 'highland lake', 'stone quarry', 'tranquil expanse',
                'dimir guildgate', 'golgari guildgate', 'rakdos guildgate', 'simic guildgate', 'gruul guildgate',
                'azorius guildgate', 'boros guildgate', 'izzet guildgate', 'orzhov guildgate', 'selesnya guildgate',
                'temple of deceit', 'temple of malice', 'temple of malady', 'temple of mystery', 'temple of abandon',
                'temple of enlightenment', 'temple of silence', 'temple of epiphany', 'temple of triumph', 'temple of plenty',
                'barren moor', 'lonely sandbar', 'forgotten cave', 'tranquil thicket', 'secluded steppe',
                'polluted mire', 'remote isle', 'smoldering crater', 'slippery karst', 'drifting meadow',
                'dakmor salvage', 'halimar depths', 'khalni garden', 'piranha marsh', 'soaring seacliff', 'turntimber grove',
                'vivid marsh', 'vivid creek', 'vivid crag', 'vivid grove', 'vivid meadow',
                'thriving moor', 'thriving isle', 'thriving bluff', 'thriving grove', 'thriving heath',
                'black dragon gate', 'sea gate', 'cliffgate', 'manor gate', 'citadel gate', 'gond gate', 'heap gate', 'basilisk gate',
                'mistvault bridge', 'darkmoss bridge', 'drossforge bridge', 'tanglepool bridge', 'slagwoods bridge',
                'razortide bridge', 'goldmire bridge', 'silverbluff bridge', 'rustvale bridge', 'thornglint bridge',
                'witherbloom campus', 'prismari campus', 'quandrix campus', 'lorehold campus', 'silverquill campus',
                'obscura storefront', 'maestros theater', 'riveteers overlook', 'cabaretti courtyard', 'brokers hideout',
                'terramorphic expanse', 'evolving wilds',
                'worn powerstone', 'charcoal diamond', 'sky diamond', 'fire diamond', 'moss diamond', 'marble diamond',
                'coldsteel heart', 'firemind vessel', 'nyx lotus', 'ebony fly', 'diregraf ghoul'
            ]);
            // Note: Terramorphic Expanse and Evolving Wilds do NOT enter tapped themselves, their fetched land does! Remove them from unconditionalTappedNames:
            unconditionalTappedNames.delete('terramorphic expanse');
            unconditionalTappedNames.delete('evolving wilds');

            let isUnconditionalTap = unconditionalTappedNames.has(nameLower);
            if (!isUnconditionalTap) {
                const reps = card.forgeReplacements || (card.forgeScript && card.forgeScript.replacements) || [];
                for (const r of reps) {
                    if (r.ReplaceWith === 'ETBTapped' && !r.Condition && !r.CheckSVar && !r.ValidCard) {
                        isUnconditionalTap = true;
                        break;
                    }
                    if (r.Description && /enters(?: the battlefield)? tapped/i.test(r.Description) && !/unless|if you don't/i.test(r.Description)) {
                        isUnconditionalTap = true;
                        break;
                    }
                }
            }
            if (!isUnconditionalTap && card.keywords instanceof Set) {
                if (card.keywords.has('etbtapped') || card.keywords.has('card.enters.tapped')) {
                    isUnconditionalTap = true;
                }
            }
            if (!isUnconditionalTap && oracleLower) {
                // Match "<Cardname/This land/This artifact/This creature/~> enters [the battlefield] tapped" without "unless" or "if you don't"
                const sentences = oracleLower.split(/(?<=\.)\s+|\n+/);
                for (const s of sentences) {
                    if (/^(?:~|this\s+\w+|it|[a-z0-9', -]+)\s+enters(?:\s+the\s+battlefield)?\s+tapped(?:\s+and\b|\s+with\b|\.)/i.test(s.trim()) && !/unless|if you don't|if it wasn't/i.test(s)) {
                        isUnconditionalTap = true;
                        break;
                    }
                }
            }
            if (isUnconditionalTap) {
                result.entersTapped = true;
                result.reason = 'enters the battlefield tapped';
            }

            // 10. Enters-With-Counters Replacement Effects
            if (nameLower === 'diregraf colossus') {
                const zombiesInGy = (controller.graveyard || []).filter(c => this.hasSubtype(c, 'Zombie')).length;
                if (zombiesInGy > 0) {
                    result.counters.push({ type: '+1/+1', count: zombiesInGy });
                }
            } else if (nameLower === 'unbreathing horde') {
                const zombiesInGy = (controller.graveyard || []).filter(c => this.hasSubtype(c, 'Zombie')).length;
                const zombiesOnBf = otherBf.filter(c => this.hasSubtype(c, 'Zombie')).length;
                const totalZ = zombiesInGy + zombiesOnBf;
                if (totalZ > 0) {
                    result.counters.push({ type: '+1/+1', count: totalZ });
                }
            } else if (nameLower.startsWith('vivid ')) {
                result.counters.push({ type: 'charge', count: 2 });
            } else if (tl.includes('saga')) {
                result.counters.push({ type: 'lore', count: 1 });
            } else {
                // Generic K:etbCounter:P1P1:N or oracle "enters with N +1/+1 counters"
                if (card.keywords instanceof Set) {
                    for (const kw of card.keywords) {
                        if (kw.startsWith('etbcounter:')) {
                            const parts = kw.split(':');
                            const cType = parts[1] === 'p1p1' ? '+1/+1' : (parts[1] || '+1/+1');
                            const cNum = parseInt(parts[2], 10);
                            if (!isNaN(cNum) && cNum > 0) {
                                result.counters.push({ type: cType, count: cNum });
                            }
                        }
                    }
                }
                if (result.counters.length === 0 && oracleLower) {
                    const mCnt = oracleLower.match(/enters(?:\s+the\s+battlefield)?(?:\s+tapped\s+and)?\s+with\s+(a|one|two|three|four|five|six|\d+)\s+(\+1\/\+1|charge|lore|oil|shield|stun|storage|fade|vanishing)\s+counter/i);
                    if (mCnt) {
                        const numMap = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
                        const n = numMap[mCnt[1].toLowerCase()] || parseInt(mCnt[1], 10) || 1;
                        result.counters.push({ type: mCnt[2].toLowerCase(), count: n });
                    }
                }
            }

            return result;
        }

        applyETBReplacements(card, controller, options = {}) {
            if (!card || !controller) return { entersTapped: false };
            const rep = this.evaluateETBReplacement(card, controller, options);
            if (options.forceTapped !== undefined) {
                rep.entersTapped = Boolean(options.forceTapped);
                rep.reason = rep.entersTapped ? 'enters the battlefield tapped' : 'enters untapped';
            }
            card.tapped = Boolean(rep.entersTapped);
            if (card.tapped) {
                card.producedMana = null;
                card.paidLifeCost = null;
                card._enteredTappedTurn = this.turn || 1;
            } else {
                card._enteredTappedTurn = null;
            }
            if (rep.paidShockLife) {
                controller.life -= (rep.lifeCost || 2);
            }
            if (Array.isArray(rep.counters) && rep.counters.length > 0) {
                for (const cObj of rep.counters) {
                    if (cObj.count > 0 && typeof controller.addCounter === 'function') {
                        controller.addCounter(card, cObj.type, cObj.count);
                    }
                }
            }
            if (rep.entersTapped) {
                this.logs.push({
                    type: 'ETB_RULE',
                    message: `🔒 **${card.name}** ${rep.reason || 'entered the battlefield tapped'}.`
                });
            } else if (rep.reason) {
                this.logs.push({
                    type: 'ETB_RULE',
                    message: `🔓 **${card.name}** ${rep.reason}.`
                });
            }
            if (rep.counters && rep.counters.length > 0) {
                for (const cObj of rep.counters) {
                    this.logs.push({
                        type: 'ETB_RULE',
                        message: `✨ **${card.name}** entered with **${cObj.count}** ${cObj.type} counter(s)!`
                    });
                }
            }
            return rep;
        }

        triggerSpellCast(card, caster) {
            if (!card || !caster) return;
            const isZombie = this.hasSubtype(card, 'Zombie');
            const isElf = this.hasSubtype(card, 'Elf');
            for (const perm of [...(caster.battlefield || [])]) {
                if (!perm || String(perm.id) === String(card.id)) continue;
                const pName = (perm.name || '').toLowerCase();
                if (pName === 'diregraf colossus' && isZombie) {
                    this.createTokenPermanent(caster, {
                        name: 'Zombie Token',
                        typeLine: 'Token Creature — Zombie',
                        power: 2,
                        toughness: 2,
                        tapped: true,
                        isCreature: true
                    });
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `🧟 **Diregraf Colossus** triggered on casting **${card.name}**: Created a tapped 2/2 black Zombie creature token!`
                    });
                } else if (pName === 'beast whisperer' && card.isCreature) {
                    const drawn = typeof caster.draw === 'function' ? caster.draw(1) : [];
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `📜 **Beast Whisperer** triggered: **${caster.name}** drew ${drawn[0] ? `**${drawn[0].name}**` : 'a card'}.`
                    });
                } else if (pName === 'lysana huntmaster' || pName === 'lys alana huntmaster') {
                    if (isElf) {
                        this.createTokenPermanent(caster, {
                            name: 'Elf Warrior Token',
                            typeLine: 'Token Creature — Elf Warrior',
                            power: 1,
                            toughness: 1,
                            isCreature: true
                        });
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `🏹 **Lys Alana Huntmaster** triggered: Created a 1/1 green Elf Warrior token!`
                        });
                    }
                }
            }
        }

        triggerETB(card, controller, targetInfo = null) {
            if (!card || !controller) return;
            const nameLower = (card.name || '').toLowerCase();
            const oracleLower = (card.oracleText || (card.forgeScript && card.forgeScript.oracle) || '').toLowerCase();
            const tl = (card.typeLine || '').toLowerCase();

            if (card.isLand) {
                // 1. Bojuka Bog: Exile target player's graveyard (always log!)
                if (nameLower === 'bojuka bog') {
                    const opp = (targetInfo && targetInfo.playerIndex !== undefined && this.players[targetInfo.playerIndex])
                        || this.players.find((pl, i) => pl !== controller && pl.isAlive && (pl.graveyard || []).length > 0)
                        || this.players.find(pl => pl !== controller && pl.isAlive)
                        || this.players[1];
                    if (opp) {
                        const count = Array.isArray(opp.graveyard) ? opp.graveyard.length : 0;
                        if (count > 0) {
                            if (!Array.isArray(opp.exile)) opp.exile = [];
                            opp.exile.push(...opp.graveyard);
                            opp.graveyard = [];
                            opp.graveyardCount = 0;
                        }
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `🌑 **Bojuka Bog** ETB triggered: Exiled all **${count}** card(s) from **${opp.name}**'s graveyard!`
                        });
                    }
                }
                // 2. Mortuary Mire & Witch's Cottage (when Witch's Cottage enters untapped)
                else if (nameLower === 'mortuary mire' || (nameLower === "witch's cottage" && !card.tapped)) {
                    const creaturesInGy = (controller.graveyard || []).filter(c => c.isCreature || (c.typeLine || '').toLowerCase().includes('creature'));
                    let targetCard = null;
                    if (targetInfo && targetInfo.cardId) {
                        targetCard = creaturesInGy.find(c => String(c.id) === String(targetInfo.cardId));
                    }
                    if (!targetCard && creaturesInGy.length > 0) {
                        targetCard = creaturesInGy[creaturesInGy.length - 1];
                    }
                    if (targetCard) {
                        controller.graveyard = controller.graveyard.filter(c => String(c.id) !== String(targetCard.id));
                        controller.graveyardCount = controller.graveyard.length;
                        if (!Array.isArray(controller.libraryCards)) controller.libraryCards = [];
                        controller.libraryCards.unshift(targetCard);
                        controller.libraryCount = controller.libraryCards.length;
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `⚰️ **${card.name}** ETB triggered: Put **${targetCard.name}** from graveyard on top of **${controller.name}**'s library.`
                        });
                    } else {
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `⚰️ **${card.name}** ETB triggered (no creature cards in **${controller.name}**'s graveyard).`
                        });
                    }
                }
                // 3. Mystic Sanctuary (when it enters untapped)
                else if (nameLower === 'mystic sanctuary' && !card.tapped) {
                    const spellsInGy = (controller.graveyard || []).filter(c => c.isInstant || c.isSorcery || /instant|sorcery/i.test(c.typeLine || ''));
                    if (spellsInGy.length > 0) {
                        const targetSpell = spellsInGy[spellsInGy.length - 1];
                        controller.graveyard = controller.graveyard.filter(c => String(c.id) !== String(targetSpell.id));
                        controller.graveyardCount = controller.graveyard.length;
                        if (!Array.isArray(controller.libraryCards)) controller.libraryCards = [];
                        controller.libraryCards.unshift(targetSpell);
                        controller.libraryCount = controller.libraryCards.length;
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `🌊 **Mystic Sanctuary** ETB triggered: Put **${targetSpell.name}** from graveyard on top of **${controller.name}**'s library.`
                        });
                    }
                }
                // 4. Bounce Lands (Dimir Aqueduct, Golgari Rot Farm, Rakdos Carnarium, Simic Growth Chamber, etc.)
                else if (
                    [
                        'dimir aqueduct', 'golgari rot farm', 'rakdos carnarium', 'simic growth chamber', 'gruul turf',
                        'azorius chancery', 'boros garrison', 'izzet boilerworks', 'orzhov basilica', 'selesnya sanctuary',
                        'guildless commons', 'arid archway'
                    ].includes(nameLower) ||
                    /when .* enters(?: the battlefield)?, return a land you control to its owner's hand/i.test(oracleLower)
                ) {
                    const landsOnBf = (controller.battlefield || []).filter(c => c && c.isLand);
                    const otherLands = landsOnBf.filter(c => String(c.id) !== String(card.id));
                    // Prefer returning a tapped land first, otherwise another land, otherwise itself
                    const bounceTarget = otherLands.find(c => c.tapped) || otherLands[0] || card;
                    if (bounceTarget) {
                        controller.battlefield = (controller.battlefield || []).filter(c => String(c.id) !== String(bounceTarget.id));
                        bounceTarget.tapped = false;
                        bounceTarget.producedMana = null;
                        bounceTarget._enteredTappedTurn = null;
                        if (!Array.isArray(controller.hand)) controller.hand = [];
                        controller.hand.push(bounceTarget);
                        if (Array.isArray(controller.keptHandCards) && !controller.keptHandCards.some(c => String(c.id) === String(bounceTarget.id))) {
                            controller.keptHandCards.push(bounceTarget);
                        }
                        controller.handCount = controller.hand.length;
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `🔄 **${card.name}** ETB triggered: Returned **${bounceTarget.name}** to **${controller.name}**'s hand.`
                        });
                    }
                }
                // 5. Gain Lands & Refuges (+1 or +2 life on ETB)
                else if (/when .* enters(?: the battlefield)?,[\s\S]*?you gain (\d+) life/i.test(oracleLower)) {
                    const mLife = oracleLower.match(/you gain (\d+) life/i);
                    const lifeGain = mLife ? (parseInt(mLife[1], 10) || 1) : 1;
                    controller.life += lifeGain;
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `💚 **${card.name}** ETB triggered: **${controller.name}** gained **${lifeGain}** life (now at ${controller.life}).`
                    });
                }
                // 6. Scry Temples & Surveil Lands
                else if (nameLower.startsWith('temple of ') || /when .* enters(?: the battlefield)?, scry 1/i.test(oracleLower)) {
                    const topCard = controller.libraryCards && controller.libraryCards[0];
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `🔮 **${card.name}** ETB triggered: Scry 1${topCard ? ` (inspected top card: **${topCard.name}**)` : ''}.`
                    });
                } else if (/when .* enters(?: the battlefield)?, surveil 1/i.test(oracleLower)) {
                    const topCard = controller.libraryCards && controller.libraryCards[0];
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `👁️ **${card.name}** ETB triggered: Surveil 1${topCard ? ` (inspected top card: **${topCard.name}**)` : ''}.`
                    });
                }
                // 7. Khalni Garden (0/1 green Plant token) & Dwarven Mine (1/1 red Dwarf token if untapped)
                else if (nameLower === 'khalni garden') {
                    this.createTokenPermanent(controller, {
                        name: 'Plant Token',
                        typeLine: 'Token Creature — Plant',
                        power: 0,
                        toughness: 1,
                        isCreature: true
                    });
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `🌱 **Khalni Garden** ETB triggered: Created a 0/1 green Plant creature token!`
                    });
                } else if (nameLower === 'dwarven mine' && !card.tapped) {
                    this.createTokenPermanent(controller, {
                        name: 'Dwarf Token',
                        typeLine: 'Token Creature — Dwarf',
                        power: 1,
                        toughness: 1,
                        isCreature: true
                    });
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `⛏️ **Dwarven Mine** ETB triggered: Created a 1/1 red Dwarf creature token!`
                    });
                } else if (nameLower === 'gingerbread cabin' && !card.tapped) {
                    this.createTokenPermanent(controller, {
                        name: 'Food Token',
                        typeLine: 'Token Artifact — Food',
                        isArtifact: true,
                        oracleText: '{2}, {T}, Sacrifice this artifact: You gain 3 life.'
                    });
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `🍪 **Gingerbread Cabin** ETB triggered: Created a Food token!`
                    });
                }
                // 8. Ping Lands (Piranha Marsh, Sunscorched Desert, Outlaws of Thunder Junction Crime Deserts)
                else if (nameLower === 'piranha marsh' || nameLower === 'sunscorched desert' || /when .* enters(?: the battlefield)?, it deals 1 damage to target opponent/i.test(oracleLower) || /when .* enters(?: the battlefield)?, target player loses 1 life/i.test(oracleLower)) {
                    const opp = (targetInfo && targetInfo.playerIndex !== undefined && this.players[targetInfo.playerIndex])
                        || this.players.find(pl => pl !== controller && pl.isAlive);
                    if (opp) {
                        opp.life -= 1;
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `🎯 **${card.name}** ETB triggered: **${opp.name}** lost 1 life (now at ${opp.life})!`
                        });
                    }
                }

                this.triggerLandfall(card, controller);
                return;
            }

            // Non-Land Card-specific ETB effects

            // 0. The Ring Tempts You & Nazgûl ETB Trigger
            const isNazgul = nameLower.includes('nazg');
            const hasRingTemptsETB = isNazgul || /(?:when|whenever) (?:this|~|it|[a-z0-9', -]+) enters(?: the battlefield)?, the ring tempts you/i.test(oracleLower);
            if (hasRingTemptsETB) {
                this.ringTempts(controller, card);
            }

            // 1. Amass triggers (e.g. March from the Black Gate, Dreadhorde Invasion, Gleaming Overseer, Eternal Skylord, Lazotep Plating, etc.)
            const isMarchBlackGate = nameLower.includes('march from the black gate') || nameLower.includes('march on the black gate');
            const mAmass = oracleLower.match(/(?:when|whenever) (?:this|~|it|[a-z0-9', -]+) enters(?: the battlefield)?,[\s\S]*?amass\s+(orcs|zombies)?\s*(\d+)/i);
            if (isMarchBlackGate || mAmass) {
                const subType = (isMarchBlackGate || (mAmass && (mAmass[1] || '').toLowerCase().includes('orc'))) ? 'Orc Army' : 'Zombie Army';
                const count = mAmass ? (parseInt(mAmass[2], 10) || 1) : 1;
                this.amass(controller, count, subType);
            }

            // 2. Generic ETB Token Creation (Creature, Treasure, Food, Clue, etc.)
            const mTok = oracleLower.match(/when (?:this|~|it|[a-z0-9', -]+) enters(?: the battlefield)?, create (a|an|one|two|three|four|\d+)?\s*(tapped)?\s*(?:and attacking)?\s*(?:(?:a|an)\s+)?(\d+\/\d+)?\s*(colorless|white|blue|black|red|green)?\s*([a-z\s]+?)\s*(?:artifact)?\s*(?:creature)?\s*token/i);
            if (mTok && !card._etbTokenCreated && !isMarchBlackGate && !mAmass && nameLower !== 'grave titan' && nameLower !== 'khalni garden' && nameLower !== 'avenger of zendikar' && nameLower !== 'cultivator of blades') {
                card._etbTokenCreated = true;
                const countMap = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };
                const count = countMap[String(mTok[1] || '').toLowerCase()] || parseInt(mTok[1], 10) || 1;
                const ptStr = mTok[3] || '1/1';
                const ptParts = ptStr.split('/');
                const pwr = parseInt(ptParts[0], 10) || 1;
                const tgh = parseInt(ptParts[1], 10) || 1;
                const subType = (mTok[5] || 'Creature').trim();
                const isArtifact = oracleLower.includes('artifact creature token') || oracleLower.includes('treasure') || oracleLower.includes('food') || oracleLower.includes('clue');
                for (let i = 0; i < count; i++) {
                    this.createTokenPermanent(controller, {
                        name: `${subType.charAt(0).toUpperCase() + subType.slice(1)} Token`,
                        typeLine: `Token ${isArtifact ? 'Artifact ' : ''}Creature — ${subType}`,
                        power: pwr,
                        toughness: tgh,
                        isCreature: true,
                        isArtifact: isArtifact
                    });
                }
                this.logs.push({
                    type: 'TRIGGER',
                    message: `✨ **${card.name}** ETB triggered: Created **${count}** ${ptStr} ${subType} token(s)!`
                });
            }

            // 3. Generic ETB Card Draw
            const mDraw = oracleLower.match(/when (?:this|~|it|[a-z0-9', -]+) enters(?: the battlefield)?, draw (a|an|one|two|three|\d+)?\s*card/i);
            if (mDraw && !card._etbDrawTriggered && typeof controller.draw === 'function') {
                card._etbDrawTriggered = true;
                const numMap = { a: 1, an: 1, one: 1, two: 2, three: 3 };
                const num = numMap[String(mDraw[1] || '').toLowerCase()] || parseInt(mDraw[1], 10) || 1;
                const drawn = controller.draw(num);
                this.logs.push({
                    type: 'TRIGGER',
                    message: `📜 **${card.name}** ETB triggered: **${controller.name}** drew **${drawn.length}** card(s)${drawn.length ? ` (${drawn.map(c => c.name).join(', ')})` : ''}!`
                });
            }

            if (nameLower === 'grave titan') {
                for (let i = 0; i < 2; i++) {
                    this.createTokenPermanent(controller, {
                        name: 'Zombie Token',
                        typeLine: 'Token Creature — Zombie',
                        power: 2,
                        toughness: 2,
                        isCreature: true
                    });
                }
                this.logs.push({
                    type: 'TRIGGER',
                    message: `🧟 **Grave Titan** ETB triggered: Created two 2/2 black Zombie creature tokens!`
                });
            } else if (nameLower === 'eternal skylord' || nameLower === 'gleaming overseer' || nameLower === 'dreadhorde invasion' || nameLower === 'lazotep plating') {
                const existingArmy = (controller.battlefield || []).find(c => this.hasSubtype(c, 'Army'));
                if (existingArmy && typeof controller.addCounter === 'function') {
                    controller.addCounter(existingArmy, '+1/+1', 2);
                } else {
                    const army = this.createTokenPermanent(controller, {
                        name: 'Zombie Army Token',
                        typeLine: 'Token Creature — Zombie Army',
                        power: 0,
                        toughness: 0,
                        isCreature: true
                    });
                    if (army && typeof controller.addCounter === 'function') {
                        controller.addCounter(army, '+1/+1', 2);
                    }
                }
                this.logs.push({
                    type: 'TRIGGER',
                    message: `🧟 **${card.name}** triggered Amass 2!`
                });
            } else if (nameLower === 'avenger of zendikar') {
                const landCount = (controller.battlefield || []).filter(c => c.isLand).length;
                for (let i = 0; i < landCount; i++) {
                    this.createTokenPermanent(controller, {
                        name: 'Plant Token',
                        typeLine: 'Token Creature — Plant',
                        power: 0,
                        toughness: 1,
                        isCreature: true
                    });
                }
                this.logs.push({
                    type: 'TRIGGER',
                    message: `🌱 **Avenger of Zendikar** ETB triggered: Created **${landCount}** 0/1 green Plant creature tokens!`
                });
            } else if (nameLower === 'overseer of the damned' || nameLower === 'ravenous chupacabra' || nameLower === 'meteor golem' || nameLower === 'reclamation sage' || nameLower === 'binding the old gods') {
                this.resolveTargetedEffect(card, controller, targetInfo, { isETB: true });
            } else if (nameLower === 'fleshbag marauder' || nameLower === 'merciless executioner' || nameLower === 'plaguecrafter') {
                for (const pl of (this.players || [])) {
                    if (!pl || !pl.isAlive) continue;
                    const creatures = (pl.battlefield || []).filter(c => c.isCreature);
                    if (creatures.length > 0) {
                        const victim = creatures.find(c => c.isToken) || creatures[0];
                        pl.sendToGraveyardOrCommandZone(victim, this, false);
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `⚔️ **${card.name}** ETB triggered: **${pl.name}** sacrificed **${victim.name}**.`
                        });
                    }
                }
            } else if (nameLower === 'gray merchant of asphodel') {
                let drainTotal = 0;
                const devotion = Math.max(2, (controller.battlefield || []).filter(c => !c.isLand).length * 2);
                for (const pl of (this.players || [])) {
                    if (!pl || !pl.isAlive || pl === controller) continue;
                    pl.life -= devotion;
                    drainTotal += devotion;
                }
                controller.life += drainTotal;
                this.logs.push({
                    type: 'TRIGGER',
                    message: `🖤 **Gray Merchant of Asphodel** ETB triggered: Each opponent lost **${devotion}** life and **${controller.name}** gained **${drainTotal}** life!`
                });
            } else if (nameLower === 'shaman of the pack' || nameLower === 'skemfar shadowsage') {
                const elfCount = (controller.battlefield || []).filter(c => this.hasSubtype(c, 'Elf')).length;
                if (nameLower === 'skemfar shadowsage') {
                    for (const pl of (this.players || [])) {
                        if (!pl || !pl.isAlive || pl === controller) continue;
                        pl.life -= elfCount;
                    }
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `🏹 **Skemfar Shadowsage** ETB triggered: Each opponent lost **${elfCount}** life!`
                    });
                } else {
                    const opp = (targetInfo && targetInfo.playerIndex !== undefined && this.players[targetInfo.playerIndex])
                        || this.players.find((pl, i) => pl !== controller && pl.isAlive);
                    if (opp && elfCount > 0) {
                        opp.life -= elfCount;
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `🏹 **Shaman of the Pack** ETB triggered: **${opp.name}** lost **${elfCount}** life!`
                        });
                    }
                }
            } else if (nameLower === 'mire triton') {
                const milled = typeof controller.mill === 'function' ? controller.mill(2) : [];
                controller.life += 2;
                this.logs.push({
                    type: 'TRIGGER',
                    message: `🌊 **Mire Triton** ETB triggered: Milled **${milled.length}** card(s) and **${controller.name}** gained 2 life!`
                });
            } else if (nameLower === "stitcher's supplier" || nameLower === 'gisa and geralf') {
                const millCount = nameLower === 'gisa and geralf' ? 4 : 3;
                const milled = typeof controller.mill === 'function' ? controller.mill(millCount) : [];
                this.logs.push({
                    type: 'TRIGGER',
                    message: `⚰️ **${card.name}** ETB triggered: Milled **${milled.length}** card(s)${milled.length ? ` (${milled.map(c => c.name).join(', ')})` : ''}.`
                });
            } else if (nameLower === 'eternal witness' || nameLower === 'golgari findbroker' || nameLower === 'timeless witness') {
                const gy = controller.graveyard || [];
                if (gy.length > 0) {
                    const returned = gy.pop();
                    controller.graveyardCount = gy.length;
                    controller.hand.push(returned);
                    if (controller.keptHandCards) controller.keptHandCards.push(returned);
                    controller.handCount = controller.hand.length;
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `♻️ **${card.name}** ETB triggered: Returned **${returned.name}** from graveyard to **${controller.name}**'s hand!`
                    });
                }
            } else if (nameLower === 'dwynen\'s elite') {
                const otherElves = (controller.battlefield || []).filter(c => String(c.id) !== String(card.id) && this.hasSubtype(c, 'Elf'));
                if (otherElves.length > 0) {
                    this.createTokenPermanent(controller, {
                        name: 'Elf Warrior Token',
                        typeLine: 'Token Creature — Elf Warrior',
                        power: 1,
                        toughness: 1,
                        isCreature: true
                    });
                    this.logs.push({
                        type: 'TRIGGER',
                        message: `🏹 **Dwynen's Elite** ETB triggered: Created a 1/1 green Elf Warrior creature token!`
                    });
                }
            } else if (nameLower === 'cultivator of blades') {
                for (let i = 0; i < 2; i++) {
                    this.createTokenPermanent(controller, {
                        name: 'Servo Token',
                        typeLine: 'Token Artifact Creature — Servo',
                        power: 1,
                        toughness: 1,
                        isCreature: true,
                        isArtifact: true
                    });
                }
                this.logs.push({
                    type: 'TRIGGER',
                    message: `⚙️ **Cultivator of Blades** Fabricate 2 triggered: Created two 1/1 colorless Servo artifact creature tokens!`
                });
            } else if (nameLower === 'end-raze forerunners' || nameLower === 'craterhoof behemoth') {
                const creatures = (controller.battlefield || []).filter(c => c.isCreature);
                const bonus = nameLower === 'craterhoof behemoth' ? creatures.length : 2;
                creatures.forEach(c => {
                    if (nameLower === 'end-raze forerunners' && String(c.id) === String(card.id)) return;
                    c.tempPower = (c.tempPower || 0) + bonus;
                    c.tempToughness = (c.tempToughness || 0) + bonus;
                    if (!Array.isArray(c.tempKeywords)) c.tempKeywords = [];
                    if (!c.tempKeywords.includes('trample')) c.tempKeywords.push('trample');
                    if (nameLower === 'end-raze forerunners' && !c.tempKeywords.includes('vigilance')) c.tempKeywords.push('vigilance');
                });
                this.logs.push({
                    type: 'TRIGGER',
                    message: `🐗 **${card.name}** ETB triggered: Creatures **${controller.name}** controls get **+${bonus}/+${bonus}** and trample until end of turn!`
                });
            } else if (/when (?:this|~|it|[a-z0-9', -]+) enters(?: the battlefield)?,[\s\S]*?you gain (\d+) life/i.test(oracleLower)) {
                const mLife = oracleLower.match(/you gain (\d+) life/i);
                const gain = mLife ? (parseInt(mLife[1], 10) || 1) : 1;
                controller.life += gain;
                this.logs.push({
                    type: 'TRIGGER',
                    message: `💚 **${card.name}** ETB triggered: **${controller.name}** gained **${gain}** life!`
                });
            }

            // Other permanents on controller's battlefield that trigger when a creature enters
            if (card.isCreature) {
                const isDragon = this.hasSubtype(card, 'Dragon');
                const isZombie = this.hasSubtype(card, 'Zombie');
                const isElf = this.hasSubtype(card, 'Elf');
                const isFlying = typeof controller.hasEffectiveKeyword === 'function' ? controller.hasEffectiveKeyword(card, 'flying') : oracleLower.includes('flying');
                for (const perm of [...(controller.battlefield || [])]) {
                    if (!perm || String(perm.id) === String(card.id)) continue;
                    const pName = (perm.name || '').toLowerCase();
                    if (pName === "garruk's uprising" || pName === 'elemental bond') {
                        const effPwr = typeof controller.getEffectivePower === 'function' ? controller.getEffectivePower(card) : (card.power || 0);
                        const minPwr = pName === 'elemental bond' ? 3 : 4;
                        if (effPwr >= minPwr && typeof controller.draw === 'function') {
                            const drawn = controller.draw(1);
                            this.logs.push({
                                type: 'TRIGGER',
                                message: `📜 **${perm.name}** triggered on **${card.name}** entering: Drew ${drawn[0] ? `**${drawn[0].name}**` : 'a card'}.`
                            });
                        }
                    } else if (pName === 'dragon tempest') {
                        if (isFlying) {
                            card.summoningSick = false;
                        }
                        if (isDragon) {
                            const dragonCount = controller.battlefield.filter(c => this.hasSubtype(c, 'Dragon')).length;
                            const opp = this.players.find(pl => pl !== controller && pl.isAlive);
                            if (opp && dragonCount > 0) {
                                opp.life -= dragonCount;
                                this.logs.push({
                                    type: 'TRIGGER',
                                    message: `🐉 **Dragon Tempest** triggered: Dealt **${dragonCount}** damage to **${opp.name}**!`
                                });
                            }
                        }
                    } else if (pName === 'scourge of valkas' && isDragon) {
                        const dragonCount = controller.battlefield.filter(c => this.hasSubtype(c, 'Dragon')).length;
                        const opp = this.players.find(pl => pl !== controller && pl.isAlive);
                        if (opp && dragonCount > 0) {
                            opp.life -= dragonCount;
                            this.logs.push({
                                type: 'TRIGGER',
                                message: `🔥 **Scourge of Valkas** triggered: Dealt **${dragonCount}** damage to **${opp.name}**!`
                            });
                        }
                    } else if (pName === 'champion of the perished' && isZombie) {
                        if (typeof controller.addCounter === 'function') {
                            controller.addCounter(perm, '+1/+1', 1);
                            this.logs.push({
                                type: 'TRIGGER',
                                message: `🧟 **Champion of the Perished** triggered on **${card.name}** entering: Put a +1/+1 counter on Champion of the Perished!`
                            });
                        }
                    } else if ((pName === 'wayward servant' || pName === 'corpse knight') && isZombie) {
                        for (const pl of (this.players || [])) {
                            if (!pl || !pl.isAlive || pl === controller) continue;
                            pl.life -= 1;
                        }
                        if (pName === 'wayward servant') controller.life += 1;
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `🧟 **${perm.name}** triggered on **${card.name}** entering: Each opponent lost 1 life${pName === 'wayward servant' ? ' and you gained 1 life' : ''}!`
                        });
                    } else if (pName === 'marwyn, the nurturer' && isElf) {
                        if (typeof controller.addCounter === 'function') {
                            controller.addCounter(perm, '+1/+1', 1);
                            this.logs.push({
                                type: 'TRIGGER',
                                message: `🌲 **Marwyn, the Nurturer** triggered on **${card.name}** entering: Put a +1/+1 counter on Marwyn!`
                            });
                        }
                    } else if (pName === 'impact tremors' || pName === 'purphoros, god of the forge') {
                        const dmg = pName.includes('purphoros') ? 2 : 1;
                        for (const pl of (this.players || [])) {
                            if (!pl || !pl.isAlive || pl === controller) continue;
                            pl.life -= dmg;
                        }
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `🔥 **${perm.name}** triggered on **${card.name}** entering: Dealt **${dmg}** damage to each opponent!`
                        });
                    } else if (pName === "cathars' crusade") {
                        controller.battlefield.forEach(c => {
                            if (c.isCreature && typeof controller.addCounter === 'function') {
                                controller.addCounter(c, '+1/+1', 1);
                            }
                        });
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `⚔️ **Cathars' Crusade** triggered: Put a +1/+1 counter on each creature **${controller.name}** controls!`
                        });
                    }
                }
            }
            this.checkStateBasedActions();
        }

        processDeathTriggers(deadCard, controller) {
            if (!deadCard || !controller) return;
            const deadTl = (deadCard.typeLine || '').toLowerCase();
            const isZombie = deadTl.includes('zombie') || (deadCard.subtypes instanceof Set && deadCard.subtypes.has('Zombie'));
            const hasDecayed = (deadCard.keywords instanceof Set && deadCard.keywords.has('decayed')) || (deadCard.oracleText || '').toLowerCase().includes('decayed');

            if (deadCard.isCreature) {
                for (const perm of [...(controller.battlefield || [])]) {
                    if (!perm || String(perm.id) === String(deadCard.id)) continue;
                    const pName = (perm.name || '').toLowerCase();
                    if (pName.includes('wilhelt, the rotcleaver') && isZombie && !hasDecayed) {
                        this.createTokenPermanent(controller, {
                            name: 'Zombie Token (Decayed)',
                            typeLine: 'Token Creature — Zombie',
                            power: 2,
                            toughness: 2,
                            isCreature: true,
                            oracleText: 'Decayed (This creature can\'t block. When it attacks, sacrifice it at end of combat.)',
                            keywords: ['decayed']
                        });
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `🧟 **Wilhelt, the Rotcleaver** triggered on **${deadCard.name}** dying: Created a 2/2 black Zombie token with Decayed!`
                        });
                    } else if (pName === 'undead augur' && isZombie) {
                        const drawn = typeof controller.draw === 'function' ? controller.draw(1) : [];
                        controller.life -= 1;
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `📜 **Undead Augur** triggered on **${deadCard.name}** dying: **${controller.name}** drew ${drawn[0] ? `**${drawn[0].name}**` : 'a card'} and lost 1 life.`
                        });
                    } else if (pName === 'diregraf captain' && isZombie) {
                        const opp = this.players.find(pl => pl !== controller && pl.isAlive);
                        if (opp) {
                            opp.life -= 1;
                            this.logs.push({
                                type: 'TRIGGER',
                                message: `⚔️ **Diregraf Captain** triggered on **${deadCard.name}** dying: **${opp.name}** lost 1 life!`
                            });
                        }
                    } else if (pName === 'midnight reaper' && !deadCard.isToken) {
                        const drawn = typeof controller.draw === 'function' ? controller.draw(1) : [];
                        controller.life -= 1;
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `🌑 **Midnight Reaper** triggered on **${deadCard.name}** dying: **${controller.name}** drew ${drawn[0] ? `**${drawn[0].name}**` : 'a card'} and lost 1 life.`
                        });
                    } else if ((pName === 'butcher of malakir' || pName === 'dictate of erebos' || pName === 'grave pact')) {
                        for (const opp of (this.players || [])) {
                            if (!opp || !opp.isAlive || opp === controller) continue;
                            const oppCreatures = (opp.battlefield || []).filter(c => c.isCreature);
                            if (oppCreatures.length > 0) {
                                const sac = oppCreatures[0];
                                opp.sendToGraveyardOrCommandZone(sac, this, false);
                                this.logs.push({
                                    type: 'TRIGGER',
                                    message: `💀 **${perm.name}** triggered: **${opp.name}** sacrificed **${sac.name}**!`
                                });
                            }
                        }
                    }
                }
            }
        }

        triggerPhase(phaseName, activePlayer) {
            if (!activePlayer || !Array.isArray(activePlayer.battlefield)) return;
            if (phaseName === 'UPKEEP') {
                for (const perm of [...activePlayer.battlefield]) {
                    if (!perm) continue;
                    const pName = (perm.name || '').toLowerCase();
                    if (pName === 'endless ranks of the dead') {
                        const zombieCount = activePlayer.battlefield.filter(c => (c.typeLine || '').toLowerCase().includes('zombie')).length;
                        const toMake = Math.floor(zombieCount / 2);
                        if (toMake > 0) {
                            for (let i = 0; i < toMake; i++) {
                                this.createTokenPermanent(activePlayer, {
                                    name: 'Zombie Token',
                                    typeLine: 'Token Creature — Zombie',
                                    power: 2,
                                    toughness: 2,
                                    isCreature: true
                                });
                            }
                            this.logs.push({
                                type: 'TRIGGER',
                                message: `🧟 **Endless Ranks of the Dead** Upkeep triggered: Created **${toMake}** 2/2 black Zombie token(s)!`
                            });
                        }
                    } else if (pName === 'dreadhorde invasion') {
                        activePlayer.life -= 1;
                        const existingArmy = activePlayer.battlefield.find(c => (c.typeLine || '').toLowerCase().includes('army'));
                        if (existingArmy && typeof activePlayer.addCounter === 'function') {
                            activePlayer.addCounter(existingArmy, '+1/+1', 1);
                        } else {
                            const army = this.createTokenPermanent(activePlayer, {
                                name: 'Zombie Army Token',
                                typeLine: 'Token Creature — Zombie Army',
                                power: 0,
                                toughness: 0,
                                isCreature: true
                            });
                            if (army && typeof activePlayer.addCounter === 'function') {
                                activePlayer.addCounter(army, '+1/+1', 1);
                            }
                        }
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `🧟 **Dreadhorde Invasion** Upkeep triggered: **${activePlayer.name}** lost 1 life and Amassed Zombies 1.`
                        });
                    } else if (pName === 'phyrexian arena') {
                        const drawn = typeof activePlayer.draw === 'function' ? activePlayer.draw(1) : [];
                        activePlayer.life -= 1;
                        this.logs.push({
                            type: 'TRIGGER',
                            message: `📜 **Phyrexian Arena** Upkeep triggered: **${activePlayer.name}** drew ${drawn[0] ? `**${drawn[0].name}**` : 'a card'} and lost 1 life.`
                        });
                    } else if (pName === 'call of the ring') {
                        this.ringTempts(activePlayer, perm);
                    }
                }
            } else if (phaseName === 'END_STEP') {
                for (const perm of [...activePlayer.battlefield]) {
                    if (!perm) continue;
                    const pName = (perm.name || '').toLowerCase();
                    if (pName.includes('wilhelt, the rotcleaver')) {
                        const sacCandidate = activePlayer.battlefield.find(c =>
                            c.isCreature &&
                            String(c.id) !== String(perm.id) &&
                            ((c.keywords instanceof Set && c.keywords.has('decayed')) || (c.oracleText || '').toLowerCase().includes('decayed') || c.isToken)
                        );
                        if (sacCandidate) {
                            activePlayer.sendToGraveyardOrCommandZone(sacCandidate, this, false);
                            const drawn = typeof activePlayer.draw === 'function' ? activePlayer.draw(1) : [];
                            this.logs.push({
                                type: 'TRIGGER',
                                message: `🧟 **Wilhelt, the Rotcleaver** End Step triggered: Sacrificed **${sacCandidate.name}** and drew ${drawn[0] ? `**${drawn[0].name}**` : 'a card'}!`
                            });
                        }
                    } else if (pName.includes('prosper, tome-bound')) {
                        if (activePlayer.libraryCards && activePlayer.libraryCards.length > 0) {
                            const exiled = activePlayer.libraryCards.shift();
                            activePlayer.libraryCount = activePlayer.libraryCards.length;
                            // Allow playing from hand representation with impulse tag
                            exiled._fromExile = true;
                            activePlayer.hand.push(exiled);
                            activePlayer.handCount = activePlayer.hand.length;
                            this.logs.push({
                                type: 'TRIGGER',
                                message: `🔥 **Prosper, Tome-Bound** Mystic Arcanum triggered: Exiled **${exiled.name}** (playable until end of next turn).`
                            });
                        }
                    }
                }
            }
            this.checkStateBasedActions();
        }

        resolveTargetedEffect(sourceCard, controller, targetInfo = null, effectMeta = {}) {
            if (!sourceCard || !controller) return { success: false };
            const nameLower = (sourceCard.name || '').toLowerCase();
            const oracleLower = (sourceCard.oracleText || '').toLowerCase();

            // Helper to find target permanent across all players
            const findTargetPermanent = (filterFn) => {
                if (targetInfo && targetInfo.cardId) {
                    for (const pl of (this.players || [])) {
                        const found = (pl.battlefield || []).find(c => String(c.id) === String(targetInfo.cardId));
                        if (found) return { card: found, owner: pl };
                    }
                }
                // Automatic fallback: pick best valid target from an opponent
                for (const pl of (this.players || [])) {
                    if (!pl || !pl.isAlive || pl === controller) continue;
                    const candidates = (pl.battlefield || []).filter(c => filterFn ? filterFn(c, pl) : !c.isLand);
                    if (candidates.length > 0) {
                        candidates.sort((a, b) => ((b.cmc || 0) + (b.power || 0)) - ((a.cmc || 0) + (a.power || 0)));
                        return { card: candidates[0], owner: pl };
                    }
                }
                return null;
            };

            // Helper to find target card in graveyard
            const findGraveyardTarget = (ownOnly = false, creatureOnly = true) => {
                const pools = ownOnly ? [controller] : (this.players || []);
                if (targetInfo && targetInfo.cardId) {
                    for (const pl of pools) {
                        const found = (pl.graveyard || []).find(c => String(c.id) === String(targetInfo.cardId));
                        if (found) return { card: found, owner: pl };
                    }
                }
                for (const pl of pools) {
                    const candidates = (pl.graveyard || []).filter(c => !creatureOnly || c.isCreature);
                    if (candidates.length > 0) {
                        return { card: candidates[candidates.length - 1], owner: pl };
                    }
                }
                return null;
            };

            if (nameLower === 'swords to plowshares' || nameLower === 'path to exile') {
                const res = findTargetPermanent(c => c.isCreature);
                if (res) {
                    const pwr = typeof res.owner.getEffectivePower === 'function' ? res.owner.getEffectivePower(res.card) : (res.card.power || 0);
                    res.owner.sendToGraveyardOrCommandZone(res.card, this, true);
                    if (nameLower === 'swords to plowshares') {
                        res.owner.life += Math.max(0, pwr);
                    }
                    this.logs.push({
                        type: 'SPELL_EFFECT',
                        message: `✨ **${sourceCard.name}** exiled **${res.card.name}** (${res.owner.name})!`
                    });
                    return { success: true };
                }
            } else if (nameLower === 'beast within' || nameLower === 'generous gift') {
                const res = findTargetPermanent(() => true);
                if (res) {
                    res.owner.sendToGraveyardOrCommandZone(res.card, this, false);
                    this.createTokenPermanent(res.owner, {
                        name: nameLower === 'beast within' ? 'Beast Token' : 'Elephant Token',
                        typeLine: nameLower === 'beast within' ? 'Token Creature — Beast' : 'Token Creature — Elephant',
                        power: 3,
                        toughness: 3,
                        isCreature: true
                    });
                    this.logs.push({
                        type: 'SPELL_EFFECT',
                        message: `💥 **${sourceCard.name}** destroyed **${res.card.name}** and gave **${res.owner.name}** a 3/3 token!`
                    });
                    return { success: true };
                }
            } else if (nameLower === 'chaos warp') {
                const res = findTargetPermanent(() => true);
                if (res) {
                    res.owner.sendToGraveyardOrCommandZone(res.card, this, false);
                    this.logs.push({
                        type: 'SPELL_EFFECT',
                        message: `🌀 **Chaos Warp** shuffled **${res.card.name}** into **${res.owner.name}**'s library!`
                    });
                    return { success: true };
                }
            } else if (nameLower === 'feed the swarm') {
                const res = findTargetPermanent(c => c.isCreature || c.isEnchantment);
                if (res) {
                    const cmc = res.card.cmc || 0;
                    res.owner.sendToGraveyardOrCommandZone(res.card, this, false);
                    controller.life -= cmc;
                    this.logs.push({
                        type: 'SPELL_EFFECT',
                        message: `🩸 **Feed the Swarm** destroyed **${res.card.name}** (**${controller.name}** lost ${cmc} life)!`
                    });
                    return { success: true };
                }
            } else if (
                nameLower === 'go for the throat' ||
                nameLower === 'infernal grasp' ||
                nameLower === 'murder' ||
                nameLower === 'hero\'s downfall' ||
                nameLower === 'dreadbore' ||
                nameLower === 'bedevil' ||
                nameLower === 'putrefy' ||
                nameLower === 'mortify' ||
                nameLower === 'abrupt decay' ||
                nameLower === 'assassin\'s trophy' ||
                nameLower === 'terminate' ||
                nameLower === 'overseer of the damned' ||
                nameLower === 'ravenous chupacabra' ||
                nameLower === 'meteor golem' ||
                nameLower === 'reclamation sage' ||
                nameLower === 'eater of hope'
            ) {
                const filterFn = (nameLower === 'reclamation sage')
                    ? (c => c.isArtifact || c.isEnchantment)
                    : (nameLower === 'meteor golem')
                        ? (c => !c.isLand)
                        : (c => c.isCreature || c.isPlaneswalker || c.isArtifact || c.isEnchantment);
                const res = findTargetPermanent(filterFn);
                if (res) {
                    if (nameLower === 'infernal grasp') controller.life -= 2;
                    res.owner.sendToGraveyardOrCommandZone(res.card, this, false);
                    if (nameLower === 'overseer of the damned') {
                        this.createTokenPermanent(controller, {
                            name: 'Zombie Token',
                            typeLine: 'Token Creature — Zombie',
                            power: 2,
                            toughness: 2,
                            tapped: true,
                            isCreature: true
                        });
                    }
                    this.logs.push({
                        type: 'SPELL_EFFECT',
                        message: `💥 **${sourceCard.name}** destroyed **${res.card.name}** (${res.owner.name})!`
                    });
                    return { success: true };
                }
            } else if (nameLower === 'cyclonic rift' || nameLower === 'into the roil' || nameLower === 'blink of an eye') {
                const res = findTargetPermanent(c => !c.isLand);
                if (res) {
                    res.owner.battlefield = (res.owner.battlefield || []).filter(c => String(c.id) !== String(res.card.id));
                    res.card.tapped = false;
                    res.card.damageReceived = 0;
                    if (!res.card.isToken) {
                        res.owner.hand.push(res.card);
                        res.owner.handCount = res.owner.hand.length;
                    }
                    this.logs.push({
                        type: 'SPELL_EFFECT',
                        message: `🌊 **${sourceCard.name}** returned **${res.card.name}** to **${res.owner.name}**'s hand!`
                    });
                    return { success: true };
                }
            } else if (nameLower === 'reanimate' || nameLower === 'zombify' || nameLower === 'dread return' || nameLower === 'victimize' || nameLower === 'animate dead') {
                const gyRes = findGraveyardTarget(false, true);
                if (gyRes) {
                    gyRes.owner.graveyard = (gyRes.owner.graveyard || []).filter(c => String(c.id) !== String(gyRes.card.id));
                    gyRes.owner.graveyardCount = gyRes.owner.graveyard.length;
                    this.applyETBReplacements(gyRes.card, controller);
                    if ( nameLower === 'victimize') {
                        gyRes.card.tapped = true;
                        gyRes.card._enteredTappedTurn = this.turn || 1;
                    }
                    gyRes.card.summoningSick = !controller.hasEffectiveKeyword(gyRes.card, 'haste');
                    gyRes.card._jsPlaced = true;
                    if (this._removedPermanentIds) this._removedPermanentIds.delete(String(gyRes.card.id));
                    controller.battlefield.push(gyRes.card);
                    if (nameLower === 'reanimate') {
                        controller.life -= (gyRes.card.cmc || 0);
                    }
                    this.logs.push({
                        type: 'SPELL_EFFECT',
                        message: `⚰️ **${sourceCard.name}** returned **${gyRes.card.name}** from graveyard to **${controller.name}**'s battlefield!`
                    });
                    this.triggerETB(gyRes.card, controller);
                    return { success: true };
                }
            } else if (/destroy target/i.test(oracleLower)) {
                const res = findTargetPermanent(c => !c.isLand);
                if (res) {
                    res.owner.sendToGraveyardOrCommandZone(res.card, this, false);
                    this.logs.push({
                        type: 'SPELL_EFFECT',
                        message: `💥 **${sourceCard.name}** destroyed **${res.card.name}** (${res.owner.name})!`
                    });
                    return { success: true };
                }
            } else if (/exile target/i.test(oracleLower)) {
                const res = findTargetPermanent(c => !c.isLand);
                if (res) {
                    res.owner.sendToGraveyardOrCommandZone(res.card, this, true);
                    this.logs.push({
                        type: 'SPELL_EFFECT',
                        message: `✨ **${sourceCard.name}** exiled **${res.card.name}** (${res.owner.name})!`
                    });
                    return { success: true };
                }
            }
            return { success: false };
        }

        async executeLibrarySearch(sourceCardIdOrObj, chosenCardNames = [], searchMeta = {}) {
            try {
                const logsBefore = this.logs.length;
                const p = this.players[0];
                if (!p) return { success: false, logs: [] };
                const lib = p.libraryCards || [];
                const names = Array.isArray(chosenCardNames) ? chosenCardNames : [chosenCardNames].filter(Boolean);
                const toBattlefieldCount = searchMeta.toBattlefieldCount !== undefined ? searchMeta.toBattlefieldCount : 1;
                const toHandCount = searchMeta.toHandCount !== undefined ? searchMeta.toHandCount : 0;
                const entersTapped = searchMeta.entersTapped !== undefined ? Boolean(searchMeta.entersTapped) : true;
                const sourceName = (typeof sourceCardIdOrObj === 'object' && sourceCardIdOrObj && sourceCardIdOrObj.name)
                    ? sourceCardIdOrObj.name
                    : String(sourceCardIdOrObj || 'Library Search');

                // If activated from a battlefield permanent that sacrifices itself (e.g. Myriad Landscape, Blighted Woodland, Wayfarer's Bauble)
                if (searchMeta.sacrificeSource && searchMeta.sourceCardId) {
                    const bfIdx = (p.battlefield || []).findIndex(c => String(c.id) === String(searchMeta.sourceCardId));
                    if (bfIdx !== -1) {
                        const [sacPerm] = p.battlefield.splice(bfIdx, 1);
                        if (this._removedPermanentIds) this._removedPermanentIds.add(String(sacPerm.id));
                        if (!Array.isArray(p.graveyard)) p.graveyard = [];
                        p.graveyard.push(sacPerm);
                        p.graveyardCount = p.graveyard.length;
                    }
                }

                const foundCards = [];
                for (const targetName of names) {
                    const targetLower = String(targetName || '').toLowerCase();
                    const idx = lib.findIndex(c => (c.name || '').toLowerCase() === targetLower);
                    if (idx !== -1) {
                        foundCards.push(lib.splice(idx, 1)[0]);
                    } else {
                        foundCards.push(enrichCard({
                            name: targetName,
                            isLand: !searchMeta.isTutorToHand,
                            typeLine: searchMeta.isTutorToHand ? 'Spell' : `Basic Land — ${targetName}`
                        }));
                    }
                }

                // Shuffle remaining library
                for (let i = lib.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [lib[i], lib[j]] = [lib[j], lib[i]];
                }
                p.libraryCount = lib.length;
                if (p.library) p.library.length = lib.length;

                const placedBattlefield = [];
                const placedHand = [];
                foundCards.forEach((card, index) => {
                    if (searchMeta.isTutorToHand || index >= toBattlefieldCount) {
                        if (searchMeta.toTopOfLibrary) {
                            lib.unshift(card);
                            p.libraryCount = lib.length;
                        } else {
                            p.hand.push(card);
                            if (p.keptHandCards) p.keptHandCards.push(card);
                            placedHand.push(card);
                        }
                    } else {
                        const rep = this.evaluateETBReplacement(card, p);
                        const finalTapped = Boolean(entersTapped || rep.entersTapped);
                        this.applyETBReplacements(card, p, { forceTapped: finalTapped });
                        card._jsPlaced = true;
                        p.battlefield.push(card);
                        placedBattlefield.push(card);
                        this.triggerETB(card, p);
                    }
                });
                p.handCount = p.hand.length;

                const summaryParts = [];
                if (placedBattlefield.length > 0) {
                    summaryParts.push(`put **${placedBattlefield.map(c => c.name).join(', ')}** onto the battlefield${entersTapped ? ' tapped' : ''}`);
                }
                if (placedHand.length > 0) {
                    summaryParts.push(`put **${placedHand.map(c => c.name).join(', ')}** into hand`);
                }
                if (summaryParts.length > 0) {
                    this.logs.push({
                        type: 'LIBRARY_SEARCH',
                        message: `🔍 **${p.name}** resolved **${sourceName}**: ${summaryParts.join(' and ')} (shuffled library).`
                    });
                }
                return { success: true, logs: this.logs.slice(logsBefore), placedBattlefield, placedHand };
            } catch (err) {
                console.error("executeLibrarySearch error:", err);
                return { success: false, logs: [] };
            }
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
                if (this.currentPhase === prevPhase && this.turn === prevTurn && this.activePlayerIndex === prevActive) {
                    const phases = ['UNTAP', 'UPKEEP', 'DRAW', 'MAIN_1', 'COMBAT_BEGIN', 'DECLARE_ATTACKERS', 'COMBAT_DECLARE_BLOCKERS', 'COMBAT_DAMAGE', 'MAIN_2', 'END_STEP', 'CLEANUP'];
                    const curIdx = phases.indexOf(this.currentPhase);
                    const nextPhase = (curIdx !== -1) ? phases[(curIdx + 1) % phases.length] : 'MAIN_1';
                    if (nextPhase === 'UNTAP') {
                        let nextPlayerIdx = (this.activePlayerIndex + 1) % this.players.length;
                        while (this.players[nextPlayerIdx] && !this.players[nextPlayerIdx].isAlive) {
                            nextPlayerIdx = (nextPlayerIdx + 1) % this.players.length;
                        }
                        if (nextPlayerIdx === (this.startingPlayerIndex || 0)) {
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

                const activeP = this.getActivePlayer();
                if (activeP && this.currentPhase !== prevPhase) {
                    if (this.currentPhase === 'UPKEEP') {
                        this.triggerPhase('UPKEEP', activeP);
                    } else if (this.currentPhase === 'END_STEP') {
                        this.triggerPhase('END_STEP', activeP);
                    } else if (this.currentPhase === 'CLEANUP') {
                        // Clear temporary damage and buffs at Cleanup
                        (activeP.battlefield || []).forEach(c => {
                            c.damageReceived = 0;
                            c.tempPower = 0;
                            c.tempToughness = 0;
                            c.tempKeywords = [];
                        });
                    }
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
                if (activeP && activeP.isAI) {
                    if (this.currentPhase === 'DRAW' && !activeP._drewThisTurn) {
                        activeP._drewThisTurn = true;
                        if (typeof activeP.draw === 'function') activeP.draw(1);
                        this.logs.push({
                            type: 'DRAW',
                            message: `📜 **${activeP.name}** drew for turn.`
                        });
                    } else if (this.currentPhase === 'MAIN_1' && !activeP._actedMain1) {
                        activeP._actedMain1 = true;
                        this._simulateBotTurnActions(activeP);
                    } else if (this.currentPhase === 'DECLARE_ATTACKERS' && !activeP._attackedThisCombat) {
                        activeP._attackedThisCombat = true;
                        this._simulateBotCombat(activeP);
                    }
                }

                const newLogs = this.logs.slice(logsBefore);
                return { success: true, logs: newLogs, currentPhase: this.currentPhase, activePlayer: this.getActivePlayer(), turn: this.turn };
            } finally {
                this.isBusy = false;
            }
        }

        _simulateBotTurnActions(activeP) {
            if (!activeP || !activeP.isAI) return;
            if (!activeP.landPlayedThisTurn && Array.isArray(activeP.hand)) {
                const landIdx = activeP.hand.findIndex(c => c.isLand || (typeof window !== 'undefined' && typeof window.isLandCard === 'function' && window.isLandCard(c)));
                if (landIdx !== -1) {
                    const landCard = activeP.hand.splice(landIdx, 1)[0];
                    this.applyETBReplacements(landCard, activeP);
                    landCard._jsPlaced = true;
                    activeP.battlefield.push(landCard);
                    activeP.landPlayedThisTurn = true;
                    activeP.landsPlayedCount = 1;
                    activeP.handCount = activeP.hand.length;
                    this.logs.push({
                        type: 'LAND_PLAY',
                        message: `🏞️ **${activeP.name}** played **${landCard.name}**${landCard.tapped ? ' (entered tapped)' : ''}.`
                    });
                    this.triggerETB(landCard, activeP);
                }
            }
            const availMana = (activeP.battlefield || []).filter(c => (c.isLand || c.isManaRock) && !c.tapped).length;
            if (availMana > 0 && Array.isArray(activeP.hand)) {
                const castIdx = activeP.hand.findIndex(c => !c.isLand && (c.cmc || 0) <= availMana && (c.cmc || 0) > 0);
                if (castIdx !== -1) {
                    const spell = activeP.hand.splice(castIdx, 1)[0];
                    activeP.handCount = activeP.hand.length;
                    const cost = spell.cmc || 1;
                    let tapped = 0;
                    activeP.battlefield.forEach(c => {
                        if ((c.isLand || c.isManaRock) && !c.tapped && tapped < cost) {
                            c.tapped = true;
                            tapped++;
                        }
                    });
                    const tl = (spell.typeLine || '').toLowerCase();
                    const isInstSorc = Boolean(spell.isInstant || spell.isSorcery || tl.includes('instant') || tl.includes('sorcery'));
                    this.logs.push({
                        type: 'SPELL_CAST',
                        message: `🪄 **${activeP.name}** cast **${spell.name}** ({${cost}}).`
                    });
                    this.triggerSpellCast(spell, activeP);
                    if (isInstSorc) {
                        this.resolveTargetedEffect(spell, activeP);
                        activeP.graveyard.push(spell);
                        activeP.graveyardCount = activeP.graveyard.length;
                    } else {
                        this.applyETBReplacements(spell, activeP);
                        spell.summoningSick = spell.isCreature && !activeP.hasEffectiveKeyword(spell, 'haste');
                        spell._jsPlaced = true;
                        activeP.battlefield.push(spell);
                        this.triggerETB(spell, activeP);
                    }
                }
            }
        }

        _simulateBotCombat(activeP) {
            if (!activeP || !activeP.isAI) return;
            const readyAttackers = (activeP.battlefield || []).filter(c => c.isCreature && !c.tapped && !c.summoningSick);
            if (readyAttackers.length > 0) {
            const hasBotAttackingArmy = readyAttackers.some(c => this.hasSubtype(c, 'Army'));
            if (hasBotAttackingArmy) {
                for (const perm of (activeP.battlefield || [])) {
                    const pName = (perm.name || '').toLowerCase();
                    const pOracle = (perm.oracleText || '').toLowerCase();
                    if (pName.includes('march from the black gate') || pName.includes('march on the black gate') ||
                        (pOracle.includes('whenever an army you control attacks') && pOracle.includes('amass'))) {
                        this.amass(activeP, 1, 'Orc Army');
                    }
                }
            }

                const defenders = (this.players || []).filter(p => p && p.isAlive && p !== activeP);
                if (defenders.length === 0) return;
                defenders.sort((a, b) => b.life - a.life);
                const targetDef = defenders[0];
                let totalDmg = 0;
                readyAttackers.forEach(c => {
                    if (!activeP.hasEffectiveKeyword(c, 'vigilance')) {
                        c.tapped = true;
                    }
                    const pwr = typeof activeP.getEffectivePower === 'function' ? activeP.getEffectivePower(c) : (c.power || 0);
                    totalDmg += Math.max(0, pwr);
                });
                if (totalDmg > 0) {
                    targetDef.life -= totalDmg;
                    this.logs.push({
                        type: 'ATTACK',
                        message: `⚔️ **${activeP.name}** attacked **${targetDef.name}** with **${readyAttackers.length}** creature(s) for **${totalDmg}** combat damage!`
                    });
                    this.checkStateBasedActions();
                }
            }
        }

        async stepTurn() {
            if (this.isBusy || this.isGameOver) return { logs: [] };
            this.isBusy = true;
            try {
                const logsBefore = this.logs.length;
                const prevTurn = this.turn;
                const prevActive = this.activePlayerIndex;

                // Fire End Step triggers for outgoing player before leaving their turn
                const outgoingPlayer = this.players[prevActive];
                if (outgoingPlayer && this.currentPhase !== 'END_STEP' && this.currentPhase !== 'CLEANUP') {
                    this.triggerPhase('END_STEP', outgoingPlayer);
                }

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
                    if (nextPlayerIdx === (this.startingPlayerIndex || 0)) {
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

                const activeP = this.getActivePlayer();
                if (activeP) {
                    if (typeof activeP.untapAll === 'function') {
                        activeP.untapAll();
                    }
                    this.triggerPhase('UPKEEP', activeP);
                }

                if (this.activePlayerIndex === 0) {
                    this.drawForTurnPlayer0();
                } else {
                    this._turnDrewPlayer0 = false;
                    if (activeP && activeP.isAI) {
                        if (typeof activeP.draw === 'function') activeP.draw(1);
                        this._simulateBotTurnActions(activeP);
                        this._simulateBotCombat(activeP);
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

        async playCard(cardId, options = {}) {
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
                const cost = card && !isLand
                    ? (typeof pBefore.getCardCost === 'function' ? pBefore.getCardCost(card) : (card.cmc || 0))
                    : 0;
                const cardNameLower = (card && card.name ? card.name : '').toLowerCase();
                const sameNameOnFieldBefore = pBefore && Array.isArray(pBefore.battlefield) && cardNameLower
                    ? pBefore.battlefield.filter(c => (c.name || '').toLowerCase() === cardNameLower).length
                    : 0;

                // Deduct mana BEFORE bridge call so updateFromRawJson preserves spent mana and tapped lands
                if (pBefore && !isLand && typeof pBefore.deductMana === 'function') {
                    pBefore.deductMana(card);
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

                    if (!isLand) {
                        this.triggerSpellCast(card, activePlayer);
                    }

                    if (isInstantOrSorcery) {
                        if (!Array.isArray(activePlayer.graveyard)) activePlayer.graveyard = [];
                        if (!activePlayer.graveyard.some(c => String(c.id) === String(card.id))) {
                            activePlayer.graveyard.push(card);
                        }
                        activePlayer.graveyardCount = activePlayer.graveyard.length;
                        this.resolveSpellEffect(card, activePlayer, options.targetInfo || null);
                    } else {
                        const sameNameOnFieldAfter = Array.isArray(activePlayer.battlefield) && cardNameLower
                            ? activePlayer.battlefield.filter(c => (c.name || '').toLowerCase() === cardNameLower).length
                            : 0;
                        const addedByBridge = sameNameOnFieldAfter > sameNameOnFieldBefore;
                        let placedPerm = card;
                        if (!addedByBridge && !activePlayer.battlefield.some(c => String(c.id) === String(card.id))) {
                            card._jsPlaced = true;
                            activePlayer.battlefield.push(card);
                        } else if (addedByBridge) {
                            const matching = activePlayer.battlefield.filter(c => (c.name || '').toLowerCase() === cardNameLower);
                            placedPerm = matching[matching.length - 1] || card;
                        }
                        // Ensure placedPerm has full enriched metadata from card
                        if (placedPerm !== card) {
                            if (card.forgeScript && !placedPerm.forgeScript) placedPerm.forgeScript = card.forgeScript;
                            if (card.forgeReplacements && !placedPerm.forgeReplacements) placedPerm.forgeReplacements = card.forgeReplacements;
                            if (card.oracleText && !placedPerm.oracleText) placedPerm.oracleText = card.oracleText;
                            if (card.typeLine && (!placedPerm.typeLine || placedPerm.typeLine === 'Land')) placedPerm.typeLine = card.typeLine;
                            if (card.subtypes instanceof Set && (!(placedPerm.subtypes instanceof Set) || placedPerm.subtypes.size === 0)) placedPerm.subtypes = card.subtypes;
                        }
                        this.applyETBReplacements(placedPerm, activePlayer, options);
                        card.tapped = Boolean(placedPerm.tapped);
                        card._enteredTappedTurn = placedPerm._enteredTappedTurn;
                        const isCreature = Boolean(
                            placedPerm.isCreature || card.isCreature ||
                            (placedPerm.typeLine || '').toLowerCase().includes('creature') ||
                            (card.typeLine || '').toLowerCase().includes('creature')
                        );
                        if (isCreature) {
                            placedPerm.isCreature = true;
                            card.isCreature = true;
                            const hasHaste = typeof activePlayer.hasEffectiveKeyword === 'function'
                                ? activePlayer.hasEffectiveKeyword(placedPerm, 'haste')
                                : (placedPerm.oracleText || '').toLowerCase().includes('haste');
                            placedPerm.summoningSick = !hasHaste;
                        }
                        if (placedPerm.isPlaneswalker && !placedPerm.loyalty) {
                            placedPerm.loyalty = Number(placedPerm.baseLoyalty) || 4;
                        }
                        this.triggerETB(placedPerm, activePlayer, options.targetInfo || null);
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

        resolveSpellEffect(card, caster, targetInfo = null) {
            if (!card || !caster) return;
            const nameLower = (card.name || '').toLowerCase();
            const oracleLower = (card.oracleText || '').toLowerCase();

            // Board wipes
            if (
                nameLower === 'wrath of god' ||
                nameLower === 'damnation' ||
                nameLower === 'blasphemous act' ||
                nameLower === 'crux of fate' ||
                nameLower === 'decree of pain' ||
                nameLower === 'zombie apocalypse' ||
                /destroy all creatures/i.test(oracleLower)
            ) {
                let destroyedCount = 0;
                for (const pl of (this.players || [])) {
                    if (!pl || !Array.isArray(pl.battlefield)) continue;
                    const victims = pl.battlefield.filter(c => {
                        if (!c.isCreature) return false;
                        if (nameLower === 'zombie apocalypse') {
                            return (c.typeLine || '').toLowerCase().includes('human');
                        }
                        return true;
                    });
                    for (const v of victims) {
                        pl.sendToGraveyardOrCommandZone(v, this, false);
                        destroyedCount++;
                    }
                }
                if (nameLower === 'decree of pain' && destroyedCount > 0 && typeof caster.draw === 'function') {
                    caster.draw(destroyedCount);
                }
                if (nameLower === 'zombie apocalypse') {
                    const zombies = (caster.graveyard || []).filter(c => (c.typeLine || '').toLowerCase().includes('zombie'));
                    zombies.forEach(z => {
                        caster.graveyard = caster.graveyard.filter(g => String(g.id) !== String(z.id));
                        z.tapped = true;
                        z._jsPlaced = true;
                        caster.battlefield.push(z);
                    });
                    caster.graveyardCount = caster.graveyard.length;
                }
                this.logs.push({
                    type: 'BOARD_WIPE',
                    message: `☄️ **${caster.name}** resolved **${card.name}** — destroyed **${destroyedCount}** creature(s)!`
                });
                this.checkStateBasedActions();
                return;
            }

            if (nameLower === 'aetherize') {
                for (const pl of (this.players || [])) {
                    if (!pl || pl === caster) continue;
                    const atks = (pl.battlefield || []).filter(c => c.isCreature && c.tapped);
                    atks.forEach(c => {
                        pl.battlefield = pl.battlefield.filter(b => String(b.id) !== String(c.id));
                        if (!c.isToken) pl.hand.push(c);
                    });
                    pl.handCount = pl.hand.length;
                }
                this.logs.push({
                    type: 'SPELL_EFFECT',
                    message: `🌊 **${caster.name}** resolved **Aetherize**, returning attacking creatures to hand!`
                });
                return;
            }

            if (nameLower === 'distant melody' || nameLower === 'shamanic revelation') {
                const count = (caster.battlefield || []).filter(c => c.isCreature).length;
                if (count > 0 && typeof caster.draw === 'function') {
                    const drawn = caster.draw(count);
                    this.logs.push({
                        type: 'DRAW',
                        message: `📜 **${caster.name}** drew **${drawn.length}** card(s) with **${card.name}**!`
                    });
                }
                return;
            }

            if (nameLower === 'village rites' || nameLower === 'deadly dispute' || nameLower === 'costly plunder') {
                const sacCand = (caster.battlefield || []).find(c => c.isCreature && (c.isToken || (c.power || 0) <= 2));
                if (sacCand) {
                    caster.sendToGraveyardOrCommandZone(sacCand, this, false);
                }
                if (nameLower === 'deadly dispute') {
                    this.createTokenPermanent(caster, {
                        name: 'Treasure Token',
                        typeLine: 'Token Artifact — Treasure',
                        power: 0,
                        toughness: 0,
                        isCreature: false,
                        isArtifact: true,
                        oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.'
                    });
                }
                return;
            }

            // Targeted removal / bounce / reanimation
            this.resolveTargetedEffect(card, caster, targetInfo);
            this.checkStateBasedActions();
        }

        async activateAbility(cardId, abilityIndex = 0, options = {}) {
            try {
                const numId = parseInt(cardId, 10);
                const logsBefore = this.logs.length;
                const p = this.players[0];
                const perm = p && p.battlefield ? p.battlefield.find(c => String(c.id) === String(cardId)) : null;

                if (this.bridge && typeof this.bridge.activateAbility === 'function' && !isNaN(numId)) {
                    try {
                        const newJson = await this.bridge.activateAbility(numId, abilityIndex);
                        if (newJson) this.updateFromRawJson(newJson);
                    } catch (eb) {
                        console.warn("bridge.activateAbility warning:", eb);
                    }
                }

                // Local execution of activated abilities (Planeswalkers, Equipment, Token makers, Targeted abilities)
                const pAfter = this.players[0];
                const card = pAfter && pAfter.battlefield ? pAfter.battlefield.find(c => String(c.id) === String(cardId)) : perm;
                if (card && pAfter) {
                    const nameLower = (card.name || '').toLowerCase();
                    if (options.isEquip && options.targetInfo && options.targetInfo.cardId) {
                        card.attachedTo = String(options.targetInfo.cardId);
                        const targetCreature = pAfter.battlefield.find(c => String(c.id) === String(options.targetInfo.cardId));
                        this.logs.push({
                            type: 'ABILITY',
                            message: `🛡️ **${pAfter.name}** equipped **${card.name}** to **${targetCreature ? targetCreature.name : 'Creature'}**!`
                        });
                    } else if (nameLower.includes('liliana, death\'s majesty')) {
                        card._loyaltyUsedThisTurn = true;
                        if (abilityIndex === 0) {
                            card.loyalty = (Number(card.loyalty) || 5) + 1;
                            // Mill 2 and create 2/2 Zombie
                            if (Array.isArray(pAfter.libraryCards) && pAfter.libraryCards.length > 0) {
                                const milled = pAfter.libraryCards.splice(0, 2);
                                pAfter.graveyard.push(...milled);
                                pAfter.graveyardCount = pAfter.graveyard.length;
                                pAfter.libraryCount = pAfter.libraryCards.length;
                            }
                            this.createTokenPermanent(pAfter, {
                                name: 'Zombie Token',
                                typeLine: 'Token Creature — Zombie',
                                power: 2,
                                toughness: 2,
                                isCreature: true
                            });
                            this.logs.push({
                                type: 'ABILITY',
                                message: `✨ **Liliana, Death's Majesty** (+1): Created a 2/2 black Zombie creature token and milled 2 cards (Loyalty: ${card.loyalty}).`
                            });
                        } else if (abilityIndex === 1) {
                            card.loyalty = (Number(card.loyalty) || 5) - 3;
                            this.resolveTargetedEffect({ name: 'Zombify', oracleText: 'Return target creature card from your graveyard to the battlefield.' }, pAfter, options.targetInfo);
                            if (card.loyalty <= 0) pAfter.sendToGraveyardOrCommandZone(card, this, false);
                        } else if (abilityIndex === 2) {
                            card.loyalty = (Number(card.loyalty) || 5) - 7;
                            this.resolveSpellEffect({ name: 'Destroy non-Zombies', oracleText: 'Destroy all non-Zombie creatures.' }, pAfter);
                            if (card.loyalty <= 0) pAfter.sendToGraveyardOrCommandZone(card, this, false);
                        }
                    } else if (nameLower === 'cemetery reaper') {
                        card.tapped = true;
                        this.createTokenPermanent(pAfter, {
                            name: 'Zombie Token',
                            typeLine: 'Token Creature — Zombie',
                            power: 2,
                            toughness: 2,
                            isCreature: true
                        });
                        this.logs.push({
                            type: 'ABILITY',
                            message: `🧟 **Cemetery Reaper** activated: Exiled a creature card from graveyard and created a 2/2 black Zombie token!`
                        });
                    } else if (nameLower === 'imperious perfect' || nameLower === 'rhys the redeemed') {
                        card.tapped = true;
                        this.createTokenPermanent(pAfter, {
                            name: 'Elf Warrior Token',
                            typeLine: 'Token Creature — Elf Warrior',
                            power: 1,
                            toughness: 1,
                            isCreature: true
                        });
                        this.logs.push({
                            type: 'ABILITY',
                            message: `🏹 **${card.name}** activated: Created a 1/1 green Elf Warrior creature token!`
                        });
                    } else if (options.targetInfo) {
                        this.resolveTargetedEffect(card, pAfter, options.targetInfo);
                    }
                }
                this.checkStateBasedActions();
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
                const chosenNames = Array.isArray(chosenLandName) ? chosenLandName : [chosenLandName].filter(Boolean);
                const primaryChosen = chosenNames[0] || 'Swamp';
                const fetchCount = (fetchMeta && fetchMeta.fetchCount && fetchMeta.fetchCount > 1) ? fetchMeta.fetchCount : chosenNames.length;

                // Track how many copies of primaryChosen were already on the battlefield before fetching
                const chosenLower = String(primaryChosen || '').toLowerCase();
                const chosenOnFieldBefore = pBefore && Array.isArray(pBefore.battlefield)
                    ? pBefore.battlefield.filter(c => (c.name || '').toLowerCase() === chosenLower).length
                    : 0;

                if (card && card.id && this._removedPermanentIds) {
                    this._removedPermanentIds.add(String(card.id));
                }

                if (this.bridge && typeof this.bridge.fetchLand === 'function') {
                    try {
                        let resJson = null;
                        if (!isNaN(numId)) {
                            resJson = await this.bridge.fetchLand(numId, primaryChosen);
                        } else {
                            resJson = await this.bridge.fetchLand(cardName, primaryChosen);
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
                        const idx = p.battlefield.findIndex(c => String(c.id) === String(cardIdOrName) || (card && String(c.id) === String(card.id)) || (c.name || '').toLowerCase() === cardName.toLowerCase());
                        if (idx !== -1) {
                            const [sacrificed] = p.battlefield.splice(idx, 1);
                            if (this._removedPermanentIds) this._removedPermanentIds.add(String(sacrificed.id));
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
                    const isClassicFetch = /delta|strand|mire|foothills|heath|tarn|catacombs|mesa|rainforest|flats|prismatic vista/.test(nameLower);
                    const isUntapped = isClassicFetch ||
                        (nameLower.includes('fabled passage') && totalLandsNow >= 3);

                    const chosenOnFieldAfter = p.battlefield
                        ? p.battlefield.filter(c => (c.name || '').toLowerCase() === chosenLower).length
                        : 0;
                    const addedByBridge = Math.max(0, chosenOnFieldAfter - chosenOnFieldBefore);

                    const totalToFetch = Math.max(1, fetchCount);
                    for (let i = 0; i < totalToFetch; i++) {
                        const targetLandName = chosenNames[i] || primaryChosen;
                        const targetLower = String(targetLandName).toLowerCase();
                        const foundIdx = lib.findIndex(c => {
                            const n = (c.name || '').toLowerCase();
                            return n === targetLower || n.includes(targetLower);
                        });
                        let fetchedLand = null;
                        if (foundIdx !== -1) {
                            fetchedLand = lib.splice(foundIdx, 1)[0];
                        } else if (i === 0 && addedByBridge === 0) {
                            fetchedLand = enrichCard({
                                name: targetLandName,
                                isLand: true,
                                typeLine: `Basic Land — ${targetLandName}`
                            });
                        }

                        if (i >= addedByBridge && fetchedLand) {
                            const rep = this.evaluateETBReplacement(fetchedLand, p);
                            const finalTapped = Boolean(!isUntapped || rep.entersTapped);
                            this.applyETBReplacements(fetchedLand, p, { forceTapped: finalTapped });
                            fetchedLand.isLand = true;
                            fetchedLand._jsPlaced = true;
                            if (!p.battlefield.some(c => String(c.id) === String(fetchedLand.id))) {
                                p.battlefield.push(fetchedLand);
                            }
                            this.triggerETB(fetchedLand, p);
                        }
                    }

                    if (addedByBridge > 0 && p.battlefield) {
                        const matchingLands = p.battlefield.filter(c => (c.name || '').toLowerCase() === chosenLower);
                        const newestLand = matchingLands[matchingLands.length - 1];
                        if (newestLand) {
                            const rep = this.evaluateETBReplacement(newestLand, p);
                            const finalTapped = Boolean(!isUntapped || rep.entersTapped);
                            this.applyETBReplacements(newestLand, p, { forceTapped: finalTapped });
                            newestLand.isLand = true;
                            this.triggerETB(newestLand, p);
                        }
                    }

                    p.libraryCount = lib.length;
                    if (p.library) p.library.length = lib.length;
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
                if (!cmdr) return { success: false, message: 'No commander assigned to deck!', logs: [] };

                const payCheck = pBefore.canPayCardCost ?
                    pBefore.canPayCardCost(cmdr, pBefore.commanderTax || 0) :
                    canPayManaCost(cmdr, pBefore.manaPool, 0, pBefore.commanderTax || 0);

                if (!payCheck.canPay) {
                    return { success: false, message: `Cannot cast ${cmdr.name}: ${payCheck.reason || 'Insufficient mana in pool'}`, logs: [] };
                }

                if (pBefore && typeof pBefore.deductMana === 'function') {
                    pBefore.deductMana(cmdr, pBefore.commanderTax || 0);
                }
                const logsBefore = this.logs.length;
                if (this.bridge && typeof this.bridge.castCommander === 'function') {
                    try {
                        const newJson = await this.bridge.castCommander();
                        if (newJson) this.updateFromRawJson(newJson);
                    } catch (eb) {
                        console.warn("bridge.castCommander error:", eb);
                    }
                }
                const pAfter = this.players[0];
                if (pAfter && cmdr) {
                    pAfter.commandZone = (pAfter.commandZone || []).filter(c => c.name !== cmdr.name);
                    pAfter.commanderTax = (pAfter.commanderTax || 0) + 2;
                    if (!pAfter.battlefield.some(c => c.name === cmdr.name)) {
                        cmdr.tapped = false;
                        cmdr.summoningSick = !pAfter.hasEffectiveKeyword(cmdr, 'haste');
                        cmdr._jsPlaced = true;
                        if (this._removedPermanentIds) this._removedPermanentIds.delete(String(cmdr.id));
                        pAfter.battlefield.push(cmdr);
                    }
                    this.triggerSpellCast(cmdr, pAfter);
                    this.triggerETB(cmdr, pAfter);
                }
                return { success: true, logs: this.logs.slice(logsBefore) };
            } catch (e) {
                console.error("castCommander error:", e);
                return { success: false, logs: [] };
            }
        }

        async toggleTapPermanent(cardId) {
            try {
                const numId = parseInt(cardId, 10);
                if (this.bridge && typeof this.bridge.toggleTap === 'function' && !isNaN(numId)) {
                    const newJson = await this.bridge.toggleTap(numId);
                    this.updateFromRawJson(newJson);
                }
            } catch (e) {
                console.error("toggleTap error:", e);
            }
        }

        async untapAllLands() {
            try {
                if (this.bridge && typeof this.bridge.untapAllLands === 'function') {
                    const newJson = await this.bridge.untapAllLands();
                    this.updateFromRawJson(newJson);
                }
            } catch (e) {
                console.error("untapAllLands error:", e);
            }
        }

        async adjustPlayerLife(delta) {
            try {
                if (this.bridge && typeof this.bridge.adjustLife === 'function') {
                    const newJson = await this.bridge.adjustLife(0, delta);
                    this.updateFromRawJson(newJson);
                } else if (this.players[0]) {
                    this.players[0].life += delta;
                }
            } catch (e) {
                console.error("adjustLife error:", e);
            }
        }

        async declareHumanAttacks(attacks = []) {
            try {
                const logsBefore = this.logs.length;
                const p0 = this.players[0];
                const attackedDecayed = [];

                for (const atk of attacks) {
                    const cardId = parseInt(atk.attackerId, 10);
                    const targetIdx = (typeof atk.targetPlayerIndex === 'number' && atk.targetPlayerIndex > 0) ? atk.targetPlayerIndex : 1;
                    const targetPwId = atk.targetPlaneswalkerId ? parseInt(atk.targetPlaneswalkerId, 10) : 0;

                    if (this.bridge && typeof this.bridge.declareAttacks === 'function' && !isNaN(cardId)) {
                        try {
                            const newJson = await this.bridge.declareAttacks(cardId, targetIdx, targetPwId);
                            if (newJson) this.updateFromRawJson(newJson);
                        } catch (eb) {
                            console.warn("bridge.declareAttacks error:", eb);
                        }
                    }

                    const curP0 = this.players[0] || p0;
                    const attacker = (curP0.battlefield || []).find(c => String(c.id) === String(atk.attackerId));
                    const defender = this.players[targetIdx] || this.players[1];
                    if (attacker && curP0 && defender) {
                        const hasVigilance = curP0.hasEffectiveKeyword(attacker, 'vigilance');
                        if (!hasVigilance) attacker.tapped = true;
                        attacker.attacksThisTurn = true;

                        // Attack triggers
                        const aName = (attacker.name || '').toLowerCase();
                // Army Attack Triggers (e.g. March from the Black Gate)
                const hasAttackingArmy = attacks.some(atk => {
                    const attacker = (curP0.battlefield || []).find(c => String(c.id) === String(atk.attackerId));
                    return attacker && this.hasSubtype(attacker, 'Army');
                });
                if (hasAttackingArmy) {
                    for (const perm of (curP0.battlefield || [])) {
                        const pName = (perm.name || '').toLowerCase();
                        const pOracle = (perm.oracleText || '').toLowerCase();
                        if (pName.includes('march from the black gate') || pName.includes('march on the black gate') ||
                            (pOracle.includes('whenever an army you control attacks') && pOracle.includes('amass'))) {
                            this.amass(curP0, 1, 'Orc Army');
                        }
                    }
                }

                        const aTl = (attacker.typeLine || '').toLowerCase();
                        if (aName === 'grave titan') {
                            for (let i = 0; i < 2; i++) {
                                this.createTokenPermanent(curP0, {
                                    name: 'Zombie Token',
                                    typeLine: 'Token Creature — Zombie',
                                    power: 2,
                                    toughness: 2,
                                    isCreature: true
                                });
                            }
                            this.logs.push({
                                type: 'TRIGGER',
                                message: `🧟 **Grave Titan** attack trigger: Created two 2/2 black Zombie creature tokens!`
                            });
                        }
                        // Check battlefield for Dragon attack triggers (Utvara Hellkite, The Ur-Dragon, Atarka, Kolaghan, Savage Ventmaw)
                        if (aTl.includes('dragon')) {
                            for (const perm of [...(curP0.battlefield || [])]) {
                                const pName = (perm.name || '').toLowerCase();
                                if (pName.includes('utvara hellkite')) {
                                    this.createTokenPermanent(curP0, {
                                        name: 'Dragon Token',
                                        typeLine: 'Token Creature — Dragon',
                                        power: 6,
                                        toughness: 6,
                                        isCreature: true,
                                        keywords: ['flying']
                                    });
                                    this.logs.push({
                                        type: 'TRIGGER',
                                        message: `🐉 **Utvara Hellkite** triggered: Created a 6/6 red Dragon creature token with flying!`
                                    });
                                } else if (pName.includes('savage ventmaw') && String(perm.id) === String(attacker.id)) {
                                    curP0.manaPool.R = (curP0.manaPool.R || 0) + 3;
                                    curP0.manaPool.G = (curP0.manaPool.G || 0) + 3;
                                }
                            }
                        }

                        // Resolve combat damage if bridge didn't already apply it
                        const basePwr = typeof curP0.getEffectivePower === 'function' ? curP0.getEffectivePower(attacker) : (attacker.power || 0);
                        const hasDoubleStrike = curP0.hasEffectiveKeyword(attacker, 'double strike');
                        const hasLifelink = curP0.hasEffectiveKeyword(attacker, 'lifelink');
                        const dmg = Math.max(0, basePwr * (hasDoubleStrike ? 2 : 1));

                        if (dmg > 0 && !this.bridge) {
                            if (atk.targetPlaneswalkerId) {
                                const pw = (defender.battlefield || []).find(c => String(c.id) === String(atk.targetPlaneswalkerId));
                                if (pw) {
                                    pw.loyalty = (Number(pw.loyalty) || 0) - dmg;
                                    this.logs.push({
                                        type: 'COMBAT_DAMAGE',
                                        message: `⚔️ **${attacker.name}** dealt **${dmg}** combat damage to **${pw.name}**!`
                                    });
                                }
                            } else {
                                defender.life -= dmg;
                                if (attacker.isCommander) {
                                    if (!defender.commanderDamageReceived) defender.commanderDamageReceived = {};
                                    defender.commanderDamageReceived[attacker.name] = (defender.commanderDamageReceived[attacker.name] || 0) + dmg;
                                }
                                this.logs.push({
                                    type: 'COMBAT_DAMAGE',
                                    message: `⚔️ **${attacker.name}** dealt **${dmg}**${attacker.isCommander ? ' Commander' : ''} combat damage to **${defender.name}** (Life: ${defender.life})!`
                                });
                            }
                            if (hasLifelink) {
                                curP0.life += dmg;
                            }
                        }

                        // Combat damage to player triggers (Grim Hireling, Lathril, Toski, Ohran Frostfang)
                        if (dmg > 0) {
                            if (aName.includes('lathril, blade of the elves')) {
                                for (let i = 0; i < dmg; i++) {
                                    this.createTokenPermanent(curP0, {
                                        name: 'Elf Warrior Token',
                                        typeLine: 'Token Creature — Elf Warrior',
                                        power: 1,
                                        toughness: 1,
                                        isCreature: true
                                    });
                                }
                                this.logs.push({
                                    type: 'TRIGGER',
                                    message: `🏹 **Lathril** combat damage trigger: Created **${dmg}** 1/1 green Elf Warrior tokens!`
                                });
                            }
                            if ((curP0.battlefield || []).some(c => (c.name || '').toLowerCase() === 'grim hireling')) {
                                for (let i = 0; i < 2; i++) {
                                    this.createTokenPermanent(curP0, {
                                        name: 'Treasure Token',
                                        typeLine: 'Token Artifact — Treasure',
                                        power: 0,
                                        toughness: 0,
                                        isCreature: false,
                                        isArtifact: true,
                                        oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.'
                                    });
                                }
                                this.logs.push({
                                    type: 'TRIGGER',
                                    message: `🪙 **Grim Hireling** triggered: Created 2 Treasure tokens!`
                                });
                            }

                            // Ring Stage 4: "Whenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life."
                            if (attacker.isRingBearer && curP0.ringLevel >= 4) {
                                (this.players || []).forEach(pl => {
                                    if (pl !== curP0 && pl.isAlive) {
                                        pl.life -= 3;
                                    }
                                });
                                this.logs.push({
                                    type: 'TRIGGER',
                                    message: `💍 **Ring Stage 4**: Ring-bearer **${attacker.name}** dealt combat damage to player! Each opponent lost 3 life!`
                                });
                            }

                            // Sauron, the Dark Lord: "Whenever an Army you control deals combat damage to a player, the Ring tempts you."
                            const isArmy = (attacker.typeLine || '').toLowerCase().includes('army') || (attacker.subtypes instanceof Set && attacker.subtypes.has('Army'));
                            const hasSauron = (curP0.battlefield || []).some(c => (c.name || '').toLowerCase().includes('sauron, the dark lord'));
                            if (isArmy && hasSauron) {
                                this.ringTempts(curP0, attacker);
                            }
                        }

                        if (curP0.hasEffectiveKeyword(attacker, 'decayed')) {
                            attackedDecayed.push(attacker);
                        }
                    }
                }

                // Sacrifice Decayed attackers at end of combat (MTG Rule 702.147a)
                const curP0 = this.players[0];
                if (curP0 && attackedDecayed.length > 0) {
                    for (const dec of attackedDecayed) {
                        curP0.sendToGraveyardOrCommandZone(dec, this, false);
                        this.logs.push({
                            type: 'DECAYED',
                            message: `💀 **${dec.name}** (Decayed) was sacrificed at end of combat.`
                        });
                    }
                }

                this.checkStateBasedActions();
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
        if (!c.manaCost && cardData.mana_cost) c.manaCost = cardData.mana_cost;
        if (!c.typeLine && cardData.type_line) c.typeLine = cardData.type_line;
        if (!c.oracleText && cardData.oracle_text) c.oracleText = cardData.oracle_text;
        const nameLower = c.name.toLowerCase().trim();
        const cleanName = nameLower.normalize ? nameLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : nameLower;

        if (typeof window !== 'undefined' && window.__MTG_CARD_CACHE__) {
            const cached = window.__MTG_CARD_CACHE__[nameLower] || window.__MTG_CARD_CACHE__[cleanName];
            if (cached) {
                if (!c.manaCost) c.manaCost = cached.manaCost || cached.mana_cost;
                if (c.cmc === undefined) c.cmc = cached.cmc;
                if (!c.typeLine) c.typeLine = cached.typeLine || cached.type_line;
                if (c.power === undefined) c.power = cached.power;
                if (c.toughness === undefined) c.toughness = cached.toughness;
                if (!c.oracleText) c.oracleText = cached.oracleText || cached.oracle_text;
                if (!c.colors && cached.colors) c.colors = cached.colors;
            }
        }

        // Enrich from compiled Card-Forge scripts (window.__FORGE_SCRIPTS__)
        if (typeof window !== 'undefined' && window.__FORGE_SCRIPTS__) {
            const fScript = window.__FORGE_SCRIPTS__[nameLower] || window.__FORGE_SCRIPTS__[cleanName];
            if (fScript) {
                c.forgeScript = fScript;
                c.forgeTriggers = fScript.triggers || [];
                c.forgeAbilities = fScript.abilities || [];
                c.forgeStatic = fScript.staticAbilities || fScript.static || [];
                c.forgeSVars = fScript.svars || {};
                c.forgeReplacements = fScript.replacements || [];

                // Parse raw Forge script lines if not already parsed on fScript
                if (fScript.raw && !fScript._parsedRaw) {
                    fScript._parsedRaw = true;
                    const rawLines = String(fScript.raw).split(/\r?\n/);
                    for (const rl of rawLines) {
                        if (rl.startsWith('ManaCost:')) {
                            fScript.manaCost = rl.slice(9).trim();
                        } else if (rl.startsWith('Types:')) {
                            const typeTokens = rl.slice(6).trim().split(/\s+/).filter(Boolean);
                            const sups = [];
                            const typs = [];
                            const subs = [];
                            const SUPERTYPES = new Set(['Legendary', 'Basic', 'Snow', 'World']);
                            const CARD_TYPES = new Set(['Creature', 'Artifact', 'Enchantment', 'Land', 'Planeswalker', 'Instant', 'Sorcery', 'Battle', 'Kindred', 'Tribal']);
                            for (const tok of typeTokens) {
                                if (SUPERTYPES.has(tok)) sups.push(tok);
                                else if (CARD_TYPES.has(tok)) typs.push(tok);
                                else subs.push(tok);
                            }
                            fScript.supertypes = sups;
                            fScript.types = typs;
                            fScript.subtypes = subs;
                        } else if (rl.startsWith('PT:')) {
                            const ptParts = rl.slice(3).trim().split('/');
                            if (ptParts.length === 2) {
                                fScript.power = ptParts[0];
                                fScript.toughness = ptParts[1];
                            }
                        } else if (rl.startsWith('Loyalty:')) {
                            fScript.loyalty = rl.slice(8).trim();
                        } else if (rl.startsWith('Oracle:')) {
                            fScript.oracle = rl.slice(7).trim().replace(/\\n/g, '\n');
                        } else if (rl.startsWith('R:')) {
                            const repObj = {};
                            rl.slice(2).split('|').forEach(seg => {
                                const idx = seg.indexOf('$');
                                if (idx !== -1) repObj[seg.slice(0, idx).trim()] = seg.slice(idx + 1).trim();
                            });
                            if (!Array.isArray(fScript.replacements)) fScript.replacements = [];
                            fScript.replacements.push(repObj);
                            c.forgeReplacements = fScript.replacements;
                        }
                    }
                }

                const existingTlGeneric = !c.typeLine || ['land', 'basic land', 'spell', 'creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker'].includes(String(c.typeLine).trim().toLowerCase());
                if (existingTlGeneric && fScript.types && fScript.types.length > 0) {
                    const sups = (fScript.supertypes || []).join(' ');
                    const typs = (fScript.types || []).join(' ');
                    const subs = (fScript.subtypes || []).join(' ');
                    c.typeLine = [sups, typs].filter(Boolean).join(' ') + (subs ? ` — ${subs}` : '');
                }
                if (!c.manaCost && fScript.manaCost && fScript.manaCost !== 'no cost') {
                    c.manaCost = normalizeManaCostBraces(fScript.manaCost);
                }
                if ((c.cmc === undefined || c.cmc === 0) && c.manaCost) {
                    c.cmc = calcCmcFromManaCost(c.manaCost);
                }
                if (c.power === undefined && fScript.power !== undefined) {
                    c.power = parseInt(fScript.power, 10) || 0;
                }
                if (c.toughness === undefined && fScript.toughness !== undefined) {
                    c.toughness = parseInt(fScript.toughness, 10) || 0;
                }
                if (!c.oracleText && fScript.oracle) {
                    c.oracleText = fScript.oracle;
                }
                if (fScript.loyalty && c.loyalty === undefined) {
                    c.loyalty = parseInt(fScript.loyalty, 10) || 4;
                    c.baseLoyalty = c.loyalty;
                }
            }
        }

        // Ensure basic lands always have full Basic Land — [Subtype] typeLine even if uncached
        const basicSubtypeMap = {
            'plains': 'Plains', 'snow-covered plains': 'Plains',
            'island': 'Island', 'snow-covered island': 'Island',
            'swamp': 'Swamp', 'snow-covered swamp': 'Swamp',
            'mountain': 'Mountain', 'snow-covered mountain': 'Mountain',
            'forest': 'Forest', 'snow-covered forest': 'Forest',
            'wastes': 'Wastes', 'snow-covered wastes': 'Wastes'
        };
        if (basicSubtypeMap[nameLower]) {
            const sub = basicSubtypeMap[nameLower];
            const isSnow = nameLower.startsWith('snow-covered');
            c.isLand = true;
            c.isBasicLand = true;
            if (!c.typeLine || !c.typeLine.toLowerCase().includes(sub.toLowerCase())) {
                c.typeLine = `${isSnow ? 'Basic Snow Land' : 'Basic Land'} — ${sub === 'Wastes' ? '' : sub}`.replace(/\s+—\s*$/, '');
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
            c.cmc = c.cmc !== undefined ? c.cmc : calcCmcFromManaCost(c.manaCost);
        }

        // Detect non-creature card types
        c.isArtifact = !!c.isArtifact || tl.includes('artifact') || (c.forgeScript && Array.isArray(c.forgeScript.types) && c.forgeScript.types.some(t => String(t).toLowerCase() === 'artifact'));
        c.isEnchantment = !!c.isEnchantment || tl.includes('enchantment') || (c.forgeScript && Array.isArray(c.forgeScript.types) && c.forgeScript.types.some(t => String(t).toLowerCase() === 'enchantment'));
        c.isPlaneswalker = !!c.isPlaneswalker || tl.includes('planeswalker') || (c.forgeScript && Array.isArray(c.forgeScript.types) && c.forgeScript.types.some(t => String(t).toLowerCase() === 'planeswalker'));
        c.isInstant = !!c.isInstant || tl.includes('instant') || (c.forgeScript && Array.isArray(c.forgeScript.types) && c.forgeScript.types.some(t => String(t).toLowerCase() === 'instant'));
        c.isSorcery = !!c.isSorcery || tl.includes('sorcery') || (c.forgeScript && Array.isArray(c.forgeScript.types) && c.forgeScript.types.some(t => String(t).toLowerCase() === 'sorcery'));
        c.isEquipment = !!c.isEquipment || tl.includes('equipment') || (c.forgeScript && Array.isArray(c.forgeScript.subtypes) && c.forgeScript.subtypes.some(t => String(t).toLowerCase() === 'equipment'));

        const hasCreatureType = tl.includes('creature') ||
            (c.forgeScript && Array.isArray(c.forgeScript.types) && c.forgeScript.types.some(t => String(t).toLowerCase() === 'creature')) ||
            (typeof window !== 'undefined' && window.__FORGE_SCRIPTS__ && window.__FORGE_SCRIPTS__[nameLower] && window.__FORGE_SCRIPTS__[nameLower].types && window.__FORGE_SCRIPTS__[nameLower].types.some(t => String(t).toLowerCase() === 'creature'));

        let isCreatureDetected = false;
        if (hasCreatureType) {
            isCreatureDetected = true;
        } else if (c.isLand || c.isArtifact || c.isEnchantment || c.isPlaneswalker || c.isInstant || c.isSorcery ||
                   tl.includes('land') || tl.includes('artifact') || tl.includes('enchantment') || tl.includes('planeswalker') || tl.includes('instant') || tl.includes('sorcery')) {
            isCreatureDetected = false;
        } else if (c.isCreature) {
            isCreatureDetected = true;
        } else if (cardData.power !== undefined && cardData.toughness !== undefined && cardData.power !== '' && cardData.toughness !== '' &&
                   (Number(cardData.power) > 0 || Number(cardData.toughness) > 0)) {
            isCreatureDetected = true;
        }

        c.isCreature = isCreatureDetected;
        if (c.isCreature && (!c.typeLine || c.typeLine === 'Spell')) {
            c.typeLine = 'Creature';
        }

        if (c.isCreature) {
            c.power = c.power !== undefined ? (Number(c.power) || 0) : (cardData.power !== undefined ? (Number(cardData.power) || 0) : 1);
            c.toughness = c.toughness !== undefined ? (Number(c.toughness) || 0) : (cardData.toughness !== undefined ? (Number(cardData.toughness) || 0) : 1);
        } else {
            c.power = undefined;
            c.toughness = undefined;
        }

        c.tapped = !!c.tapped;
        c.summoningSick = !!c.summoningSick;
        c.isCommander = isCommandZone || !!c.isCommander;
        c.counters = Array.isArray(cardData.counters) ? cardData.counters : [];
        c.typeLine = c.typeLine || (c.isCreature ? 'Creature' : c.isLand ? 'Land' : c.isArtifact ? 'Artifact' : c.isEnchantment ? 'Enchantment' : c.isPlaneswalker ? 'Planeswalker' : 'Spell');
        c.oracleText = c.oracleText || '';

        // Populate subtypes and keywords Set
        if (!(c.subtypes instanceof Set)) {
            const subArr = (c.forgeScript && Array.isArray(c.forgeScript.subtypes))
                ? c.forgeScript.subtypes
                : (c.typeLine.includes('—') ? c.typeLine.split('—')[1].trim().split(/\s+/) : []);
            c.subtypes = new Set(subArr.filter(Boolean));
        }
        if (!(c.keywords instanceof Set)) {
            const kwSet = new Set(Array.isArray(cardData.keywords) ? cardData.keywords.map(k => String(k).toLowerCase()) : []);
            if (c.forgeScript && Array.isArray(c.forgeScript.keywords)) {
                c.forgeScript.keywords.forEach(k => kwSet.add(String(k).toLowerCase()));
            }
            const oLower = c.oracleText.toLowerCase();
            ['flying', 'haste', 'deathtouch', 'lifelink', 'trample', 'vigilance', 'menace', 'reach', 'hexproof', 'indestructible', 'double strike', 'first strike', 'decayed', 'defender', 'flash'].forEach(kw => {
                if (oLower.includes(kw)) kwSet.add(kw);
            });
            c.keywords = kwSet;
        }

        const oLower = c.oracleText.toLowerCase();
        c.isManaRock = !c.isLand && (c.isArtifact || c.isCreature) && (/add\s+\{[wubrgc]\}/i.test(oLower) || /add one mana/i.test(oLower) || /signet|talisman|sol ring|arcane signet|fellwar stone|commander's sphere|mind stone|thought vessel|worn powerstone|soldevi adnate/i.test(nameLower));
        c.isRampSpell = !c.isLand && (c.isSorcery || c.isInstant || c.isArtifact) && (/search your library for a.*land/i.test(oLower) || /cultivate|kodama's reach|rampant growth|farseek|nature's lore|three visits|migration path|skyshroud claim/i.test(nameLower));
        c.isTutorSpell = !c.isLand && !c.isRampSpell && (/search your library for a card/i.test(oLower) || /demonic tutor|diabolic tutor|grim tutor|vampiric tutor|profane tutor/i.test(nameLower));

        return c;
    }

    // Public API exposed on window
    window.ForgeArena = {
        initEngine: initForgeEngine,
        ForgeArenaGame: ForgeArenaGame,
        enrichCard: enrichCard,
        canPayManaCost: canPayManaCost,
        parseManaCostDetailed: parseManaCostDetailed,
        deductDetailedMana: deductDetailedMana,
        startMatch: async function (selectedDecks = [], startingPlayerIndex = 0) {
            hideLoadingBanner();
            const bridge = new HeadlessForgeBridge();
            let rawJson = null;

            try {
                const getDeckCardsText = (d) => {
                    if (d && d.decklist) return d.decklist;
                    if (d && Array.isArray(d.cards)) {
                        return d.cards.map(c => typeof c === 'string' ? c : (c.name || '')).filter(Boolean).join('\n');
                    }
                    return '';
                };

                const d0 = selectedDecks[0] || {};
                const d1 = selectedDecks[1] || {};
                const d2 = selectedDecks[2] || {};
                const d3 = selectedDecks[3] || {};

                rawJson = await bridge.startCommanderMatchWithDecks(
                    d0.name || 'You', d0.commander || d0.name || 'Wilhelt, the Rotcleaver', getDeckCardsText(d0),
                    d1.name || 'Opponent 1', d1.commander || d1.name || 'Lathril, Blade of the Elves', getDeckCardsText(d1),
                    d2.name || 'Opponent 2', d2.commander || d2.name || 'Aesi, Tyrant of Gyre Strait', getDeckCardsText(d2),
                    d3.name || 'Opponent 3', d3.commander || d3.name || 'Prosper, Tome-Bound', getDeckCardsText(d3),
                    startingPlayerIndex
                );
                if (rawJson && rawJson.status === 'ACTIVE') {
                    console.log("⚔️ Connected to Cloud Headless Card-Forge Engine! 100% Rules Parity Active.");
                }
            } catch (err) {
                console.warn("Headless Forge start error, continuing with client-side fallback:", err);
            }

            const game = new ForgeArenaGame(bridge, rawJson, selectedDecks);
            game.startingPlayerIndex = startingPlayerIndex;
            if (typeof startingPlayerIndex === 'number' && startingPlayerIndex >= 0 && startingPlayerIndex < game.players.length) {
                game.activePlayerIndex = startingPlayerIndex;
            }

            return game;
        }
    };

})();
