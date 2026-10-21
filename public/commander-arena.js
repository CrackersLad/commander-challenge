/**
 * ============================================================================
 * COMMANDER ARENA - CONTROLLER & UI PRESENTER
 * ============================================================================
 * Coordinates the browser-native Commander rules engine, AI bots,
 * battlefield animations, and real-time multiplayer pods.
 */

(function () {
    'use strict';

    let currentGame = null;
    let autoPlayTimer = null;
    let playSpeedMs = 600; // Normal speed
    let isPaused = true;

    // Preset Commander Decks for instant testing if user hasn't scanned decks yet
    const PRESET_DECKS = [
        {
            id: 'preset_wilhelt',
            name: 'Wilhelt, the Rotcleaver (Zombies)',
            commander: 'Wilhelt, the Rotcleaver',
            cards: [
                { name: 'Wilhelt, the Rotcleaver', isCommander: true, power: 3, toughness: 3, manaCost: '{2}{U}{B}', typeLine: 'Legendary Creature — Zombie Wizard' },
                { name: 'Sol Ring', manaCost: '{1}', typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.' },
                { name: 'Arcane Signet', manaCost: '{2}', typeLine: 'Artifact', oracleText: '{T}: Add one mana of any color.' },
                { name: 'Diregraf Colossus', manaCost: '{2}{B}', power: 2, toughness: 2, typeLine: 'Creature — Zombie Giant' },
                { name: 'Cleaver Skaab', manaCost: '{3}{U}', power: 2, toughness: 4, typeLine: 'Creature — Zombie Horror' },
                { name: 'Geralf, Visionary Stitcher', manaCost: '{2}{U}', power: 1, toughness: 4, typeLine: 'Legendary Creature — Human Wizard' },
                { name: 'Feed the Swarm', manaCost: '{1}{B}', typeLine: 'Sorcery', oracleText: 'Destroy target creature or enchantment.' },
                { name: 'Counterspell', manaCost: '{U}{U}', typeLine: 'Instant', oracleText: 'Counter target spell.' },
                { name: 'Talisman of Dominance', manaCost: '{2}', typeLine: 'Artifact', oracleText: '{T}: Add {U} or {B}.' },
                { name: 'Lord of the Accursed', manaCost: '{2}{B}', power: 2, toughness: 3, typeLine: 'Creature — Zombie' },
                { name: 'Undead Augur', manaCost: '{B}{B}', power: 2, toughness: 2, typeLine: 'Creature — Zombie Wizard' },
                ...Array(18).fill({ name: 'Swamp', typeLine: 'Basic Land — Swamp' }),
                ...Array(17).fill({ name: 'Island', typeLine: 'Basic Land — Island' })
            ]
        },
        {
            id: 'preset_lathril',
            name: 'Lathril, Blade of the Elves (Elfball)',
            commander: 'Lathril, Blade of the Elves',
            cards: [
                { name: 'Lathril, Blade of the Elves', isCommander: true, power: 2, toughness: 3, manaCost: '{2}{B}{G}', typeLine: 'Legendary Creature — Elf Noble', oracleText: 'Menace' },
                { name: 'Sol Ring', manaCost: '{1}', typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.' },
                { name: 'Arcane Signet', manaCost: '{2}', typeLine: 'Artifact', oracleText: '{T}: Add one mana of any color.' },
                { name: 'Llanowar Elves', manaCost: '{G}', power: 1, toughness: 1, typeLine: 'Creature — Elf Druid', oracleText: '{T}: Add {G}.' },
                { name: 'Elvish Archdruid', manaCost: '{1}{G}{G}', power: 2, toughness: 2, typeLine: 'Creature — Elf Druid', oracleText: 'Other Elf creatures you control get +1/+1.' },
                { name: 'Marwyn, the Nurturer', manaCost: '{2}{G}', power: 1, toughness: 1, typeLine: 'Legendary Creature — Elf Druid' },
                { name: 'Beast Within', manaCost: '{2}{G}', typeLine: 'Instant', oracleText: 'Destroy target permanent.' },
                { name: 'Cultivate', manaCost: '{2}{G}', typeLine: 'Sorcery', oracleText: 'Search for lands.' },
                { name: 'Reclamation Sage', manaCost: '{2}{G}', power: 2, toughness: 1, typeLine: 'Creature — Elf Shaman' },
                { name: 'Timberwatch Elf', manaCost: '{2}{G}', power: 1, toughness: 2, typeLine: 'Creature — Elf' },
                ...Array(18).fill({ name: 'Forest', typeLine: 'Basic Land — Forest' }),
                ...Array(17).fill({ name: 'Swamp', typeLine: 'Basic Land — Swamp' })
            ]
        },
        {
            id: 'preset_urdragon',
            name: 'The Ur-Dragon (Draconic Domination)',
            commander: 'The Ur-Dragon',
            cards: [
                { name: 'The Ur-Dragon', isCommander: true, power: 10, toughness: 10, manaCost: '{4}{W}{U}{B}{R}{G}', typeLine: 'Legendary Creature — Dragon Avatar', oracleText: 'Flying' },
                { name: 'Sol Ring', manaCost: '{1}', typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.' },
                { name: 'Arcane Signet', manaCost: '{2}', typeLine: 'Artifact', oracleText: '{T}: Add one mana of any color.' },
                { name: 'Dragonlord Atarka', manaCost: '{5}{R}{G}', power: 8, toughness: 8, typeLine: 'Legendary Creature — Dragon', oracleText: 'Flying, Trample' },
                { name: 'Scourge of Valkas', manaCost: '{2}{R}{R}{R}', power: 4, toughness: 4, typeLine: 'Creature — Dragon', oracleText: 'Flying' },
                { name: 'Farseek', manaCost: '{1}{G}', typeLine: 'Sorcery', oracleText: 'Search for a land.' },
                { name: 'Chaos Warp', manaCost: '{2}{R}', typeLine: 'Instant', oracleText: 'Shuffle target permanent.' },
                { name: 'Crucible of Fire', manaCost: '{3}{R}', typeLine: 'Enchantment', oracleText: 'Dragon creatures you control get +3/+3.' },
                ...Array(7).fill({ name: 'Mountain', typeLine: 'Basic Land — Mountain' }),
                ...Array(7).fill({ name: 'Forest', typeLine: 'Basic Land — Forest' }),
                ...Array(7).fill({ name: 'Island', typeLine: 'Basic Land — Island' }),
                ...Array(7).fill({ name: 'Plains', typeLine: 'Basic Land — Plains' }),
                ...Array(7).fill({ name: 'Swamp', typeLine: 'Basic Land — Swamp' })
            ]
        },
        {
            id: 'preset_prosper',
            name: 'Prosper, Tome-Bound (Treasures & Exile)',
            commander: 'Prosper, Tome-Bound',
            cards: [
                { name: 'Prosper, Tome-Bound', isCommander: true, power: 1, toughness: 4, manaCost: '{2}{B}{R}', typeLine: 'Legendary Creature — Tiefling Warlock', oracleText: 'Deathtouch' },
                { name: 'Sol Ring', manaCost: '{1}', typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.' },
                { name: 'Arcane Signet', manaCost: '{2}', typeLine: 'Artifact', oracleText: '{T}: Add one mana of any color.' },
                { name: 'Mayhem Devil', manaCost: '{1}{B}{R}', power: 3, toughness: 3, typeLine: 'Creature — Devil' },
                { name: 'Professional Face-Breaker', manaCost: '{2}{R}', power: 2, toughness: 3, typeLine: 'Creature — Human Warrior', oracleText: 'Menace' },
                { name: 'Terminate', manaCost: '{B}{R}', typeLine: 'Instant', oracleText: 'Destroy target creature.' },
                { name: 'Talisman of Indulgence', manaCost: '{2}', typeLine: 'Artifact', oracleText: '{T}: Add {B} or {R}.' },
                { name: 'Jeska\'s Will', manaCost: '{2}{R}', typeLine: 'Sorcery', oracleText: 'Add {R} and exile cards.' },
                ...Array(18).fill({ name: 'Mountain', typeLine: 'Basic Land — Mountain' }),
                ...Array(17).fill({ name: 'Swamp', typeLine: 'Basic Land — Swamp' })
            ]
        }
    ];

    function getAvailableDecks() {
        const list = [...PRESET_DECKS];
        if (window.currentDecksData && Array.isArray(window.currentDecksData)) {
            window.currentDecksData.forEach(d => {
                if (d && !d.error && d.cards && d.cards.length > 0) {
                    list.unshift({
                        id: `scanned_${d.id}`,
                        name: `⭐ ${d.name} (${d.commander || 'Commander'})`,
                        commander: d.commander || 'Commander',
                        cards: d.cards
                    });
                }
            });
        }
        return list;
    }

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
                            <h2 class="arena-title">Commander Battle Arena</h2>
                            <span style="font-size: 0.72rem; color: #a855f7; font-weight: 700;">Client-Native Forge Rules Engine • Zero Server Cost</span>
                        </div>
                    </div>

                    <!-- Phase Tracker -->
                    <div class="arena-phase-bar" id="arenaPhaseBar">
                        <span class="arena-phase-step" data-phase="UNTAP">Untap</span>
                        <span class="arena-phase-step" data-phase="UPKEEP">Upkeep</span>
                        <span class="arena-phase-step" data-phase="DRAW">Draw</span>
                        <span class="arena-phase-step" data-phase="MAIN_1">Main 1</span>
                        <span class="arena-phase-step" data-phase="DECLARE_ATTACKERS">Attack</span>
                        <span class="arena-phase-step" data-phase="COMBAT_DAMAGE">Damage</span>
                        <span class="arena-phase-step" data-phase="MAIN_2">Main 2</span>
                        <span class="arena-phase-step" data-phase="END_STEP">End</span>
                    </div>

                    <!-- Action Controls -->
                    <div class="arena-controls">
                        <div class="arena-turn-badge" id="arenaTurnIndicator">Turn 1</div>
                        <button class="arena-btn" id="arenaBtnPlayPause" onclick="window.toggleArenaPlayPause()">
                            <span id="arenaPlayIcon">▶️</span> <span id="arenaPlayText">Start</span>
                        </button>
                        <button class="arena-btn" id="arenaBtnStep" onclick="window.stepArenaPhase()">
                            ⏭️ Step
                        </button>
                        <button class="arena-btn" onclick="window.simulateArenaInstant()">
                            ⚡ Instant Match
                        </button>
                        <button class="arena-btn" onclick="window.openArenaSetup()">
                            ⚙️ Pod Setup
                        </button>
                        <button class="arena-btn" style="color: #ef4444;" onclick="window.closeCommanderArena()">
                            ✕ Close
                        </button>
                    </div>
                </header>

                <!-- Arena Main Theater -->
                <div class="arena-theater">
                    <!-- Battlefield Canvas -->
                    <div class="arena-battlefield-canvas" id="arenaCanvas">
                        <!-- Top Seats (Opponents 2 & 3) -->
                        <div class="arena-seats-top" id="seatsTop"></div>

                        <!-- Center Theater (The Stack & Combat Arena) -->
                        <div class="arena-seats-mid">
                            <div id="seatLeft"></div>
                            <div class="arena-center-stage">
                                <div class="arena-stack-box" id="arenaStackBox">
                                    <span style="font-size: 1.1rem;">⚡</span>
                                    <div>
                                        <div style="font-size: 0.72rem; color: #c084fc; font-weight: 700; text-transform: uppercase;">The Stack</div>
                                        <div class="stack-spell-name" id="stackSpellName">Casting Spell...</div>
                                    </div>
                                </div>
                            </div>
                            <div id="seatRight"></div>
                        </div>

                        <!-- Bottom Seat (Player 1 / Main View) -->
                        <div class="arena-seats-bottom" id="seatsBottom"></div>
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

                <!-- Pod Setup Modal Overlay -->
                <div class="arena-setup-overlay" id="arenaSetupOverlay">
                    <div class="arena-setup-card">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #fff;">
                                👑 Configure 4-Player Pod
                            </h3>
                            <button class="arena-btn" onclick="window.closeArenaSetup()">✕</button>
                        </div>
                        <p style="font-size: 0.84rem; color: var(--arena-text-muted); margin: 0; line-height: 1.45;">
                            Assign any of your scanned decks or curated Commander precons to each seat in the pod. All bots execute the reverse-engineered Forge combat & threat matrices.
                        </p>

                        <div class="setup-seats-grid">
                            <div class="setup-seat-box">
                                <span class="setup-seat-label">Seat 1 (Player / Main)</span>
                                <select class="setup-seat-select" id="seatSelect0"></select>
                            </div>
                            <div class="setup-seat-box">
                                <span class="setup-seat-label">Seat 2 (Opponent 1)</span>
                                <select class="setup-seat-select" id="seatSelect1"></select>
                            </div>
                            <div class="setup-seat-box">
                                <span class="setup-seat-label">Seat 3 (Opponent 2)</span>
                                <select class="setup-seat-select" id="seatSelect2"></select>
                            </div>
                            <div class="setup-seat-box">
                                <span class="setup-seat-label">Seat 4 (Opponent 3)</span>
                                <select class="setup-seat-select" id="seatSelect3"></select>
                            </div>
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 0.65rem; margin-top: 0.5rem;">
                            <button class="arena-btn" onclick="window.closeArenaSetup()">Cancel</button>
                            <button class="arena-btn arena-btn-primary" onclick="window.applyArenaSetupAndStart()">
                                🚀 Launch Pod Match
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);
    }

    function renderPlayerCockpit(player, isMainView = false) {
        const cmdr = player.getCommander();
        const cmdrName = cmdr ? cmdr.name : 'Unknown Commander';
        const isDead = !player.isAlive;
        const isTurn = currentGame && currentGame.getActivePlayer()?.id === player.id && !isDead;

        const creatures = player.battlefield.filter(c => c.isCreature);
        const lands = player.battlefield.filter(c => c.isLand).length;
        const rocks = player.battlefield.filter(c => c.isManaRock).length;

        let creaturesHtml = '';
        if (creatures.length === 0) {
            creaturesHtml = `<div style="font-size: 0.72rem; color: var(--arena-text-muted); margin: auto;">No creatures on battlefield</div>`;
        } else {
            creatures.forEach(c => {
                const isCmdr = c.isCommander;
                const tappedClass = c.tapped ? 'tapped' : '';
                const cmdrClass = isCmdr ? 'cmdr' : '';
                creaturesHtml += `
                    <div class="creature-mini-card ${tappedClass} ${cmdrClass}" title="${escapeHtml(c.name)} - ${c.typeLine}">
                        ${isCmdr ? '👑' : ''} <span>${escapeHtml(c.name.substring(0, 14))}</span>
                        <span class="creature-pt-bubble">${c.power}/${c.toughness}</span>
                    </div>
                `;
            });
        }

        return `
            <div class="player-cockpit ${isTurn ? 'active-turn' : ''} ${isDead ? 'eliminated' : ''}" id="cockpit_${player.id}">
                <div class="player-cockpit-header">
                    <div class="player-cockpit-info">
                        <img src="${player.avatar}" class="player-cockpit-avatar" alt="Avatar" />
                        <div>
                            <div class="player-cockpit-name">${escapeHtml(player.name)}</div>
                            <div style="font-size: 0.72rem; color: var(--arena-text-muted);">${player.isAI ? '🤖 Bot' : '👤 You'}</div>
                        </div>
                    </div>
                    <div class="player-life-box">
                        <span style="font-size: 0.75rem; color: #ef4444;">❤️</span>
                        <span class="player-life-val ${player.life <= 10 ? 'danger' : ''}">${player.life}</span>
                    </div>
                </div>

                <!-- Commander Pedestal -->
                <div class="commander-pedestal">
                    <div class="commander-pedestal-left">
                        <span class="commander-crown-icon">👑</span>
                        <div class="commander-pedestal-name" title="${escapeHtml(cmdrName)}">${escapeHtml(cmdrName)}</div>
                    </div>
                    <div class="commander-tax-chip">Tax: {${player.commanderTax}}</div>
                </div>

                <!-- Battlefield Shelf -->
                <div class="player-shelf">
                    <div class="player-creatures-shelf">
                        ${creaturesHtml}
                    </div>
                    <div class="player-resources-bar">
                        <span>🏞️ Lands: ${lands}</span>
                        <span>💎 Rocks: ${rocks}</span>
                        <span>🃏 Hand: ${player.hand.length}</span>
                        <span>📚 Library: ${player.library.length}</span>
                    </div>
                </div>
            </div>
        `;
    }

    function updateArenaDOM() {
        if (!currentGame) return;

        // Render seats
        const seatsTopEl = document.getElementById('seatsTop');
        const seatLeftEl = document.getElementById('seatLeft');
        const seatRightEl = document.getElementById('seatRight');
        const seatsBottomEl = document.getElementById('seatsBottom');

        const p = currentGame.players;

        if (p.length >= 1 && seatsBottomEl) {
            seatsBottomEl.innerHTML = renderPlayerCockpit(p[0], true);
        }
        if (p.length >= 2 && seatLeftEl) {
            seatLeftEl.innerHTML = renderPlayerCockpit(p[1]);
        }
        if (p.length >= 3 && seatsTopEl) {
            seatsTopEl.innerHTML = renderPlayerCockpit(p[2]);
        }
        if (p.length >= 4 && seatRightEl) {
            seatRightEl.innerHTML = renderPlayerCockpit(p[3]);
        }

        // Update Turn Indicator
        const turnInd = document.getElementById('arenaTurnIndicator');
        if (turnInd) {
            const activeP = currentGame.getActivePlayer();
            turnInd.textContent = `Turn ${currentGame.turn} • ${activeP ? activeP.name : 'Match'}`;
        }

        // Update Phase Steps
        const currentPhase = currentGame.currentPhase;
        const phaseSteps = document.querySelectorAll('.arena-phase-step');
        phaseSteps.forEach(step => {
            const phaseAttr = step.getAttribute('data-phase');
            step.classList.remove('active');
            if (phaseAttr === currentPhase || (phaseAttr === 'MAIN_1' && currentPhase === 'MAIN_1') || (phaseAttr === 'DECLARE_ATTACKERS' && currentPhase.includes('COMBAT'))) {
                step.classList.add('active');
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

    // ============================================================================
    // ARENA CONTROLS & LIFECYCLE
    // ============================================================================

    window.openCommanderArena = function (customDeck = null) {
        initArenaModal();
        const backdrop = document.getElementById('arenaModalBackdrop');
        if (backdrop) backdrop.style.display = 'flex';

        if (customDeck || !currentGame) {
            window.applyArenaSetupAndStart(customDeck);
        } else {
            updateArenaDOM();
        }
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

            autoPlayTimer = setInterval(() => {
                if (!currentGame || currentGame.isGameOver) {
                    window.toggleArenaPlayPause();
                    return;
                }
                const result = currentGame.stepPhase();
                updateArenaDOM();
                if (result.logs && result.logs.length > 0) {
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
            if (txt) txt.textContent = 'Play';
        }
    };

    window.stepArenaPhase = function () {
        if (!currentGame || currentGame.isGameOver) return;
        const result = currentGame.stepPhase();
        updateArenaDOM();
        if (result.logs && result.logs.length > 0) {
            appendArenaLogs(result.logs);
        }
    };

    window.simulateArenaInstant = function () {
        if (!currentGame || currentGame.isGameOver) return;
        if (autoPlayTimer) clearInterval(autoPlayTimer);
        isPaused = true;

        const result = currentGame.runMatchSimulation();
        updateArenaDOM();
        appendArenaLogs(result.logs);
    };

    window.clearArenaLog = function () {
        const streamEl = document.getElementById('arenaLogStream');
        if (streamEl) streamEl.innerHTML = '';
    };

    window.openArenaSetup = function () {
        initArenaModal();
        const overlay = document.getElementById('arenaSetupOverlay');
        const decks = getAvailableDecks();

        for (let i = 0; i < 4; i++) {
            const select = document.getElementById(`seatSelect${i}`);
            if (select) {
                select.innerHTML = '';
                decks.forEach((d, idx) => {
                    const opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = d.name;
                    if (idx === i) opt.selected = true;
                    select.appendChild(opt);
                });
            }
        }

        if (overlay) overlay.style.display = 'flex';
    };

    window.closeArenaSetup = function () {
        const overlay = document.getElementById('arenaSetupOverlay');
        if (overlay) overlay.style.display = 'none';
    };

    window.applyArenaSetupAndStart = function (customDeck = null) {
        window.closeArenaSetup();
        if (autoPlayTimer) clearInterval(autoPlayTimer);
        isPaused = true;

        const decks = getAvailableDecks();
        const selectedDecks = [];

        if (customDeck) {
            let deckObj = customDeck;
            const engine = window.MtgCommanderEngine;
            if (typeof customDeck === 'string') {
                const parsed = engine ? engine.parseDecklistText(customDeck) : { commander: null, cards: [] };
                deckObj = {
                    id: 'custom_deck_user',
                    name: parsed.commander || 'Custom Deck',
                    commander: parsed.commander,
                    cards: parsed.cards
                };
            } else if (customDeck.content && (!customDeck.cards || customDeck.cards.length === 0)) {
                const parsed = engine ? engine.parseDecklistText(customDeck.content) : { commander: null, cards: [] };
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
                selectedDecks.push(d);
            }
        }

        // Initialize MtgCommanderEngine Game
        const engine = window.MtgCommanderEngine;
        if (!engine) {
            console.error("MtgCommanderEngine not loaded yet.");
            return;
        }

        currentGame = new engine.CommanderGame({
            players: selectedDecks.map((d, idx) => ({
                id: `p_${idx + 1}`,
                name: idx === 0 ? (d.commander ? `${d.commander} (You)` : 'Seat 1') : (d.commander ? `${d.commander}` : `Opponent ${idx}`),
                deck: d.cards || d,
                isAI: idx !== 0,
                avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(d.commander || d.name)}`
            })),
            maxTurns: 30
        });

        window.clearArenaLog();
        appendArenaLogs([{
            type: 'GAME_INIT',
            message: `🚀 **4-Player Commander Match Initialized!** Pod: ${selectedDecks.map(d => d.commander || d.name).join(' vs ')}.`
        }]);

        updateArenaDOM();
    };

    // Auto-mount listener on document ready
    document.addEventListener('DOMContentLoaded', () => {
        initArenaModal();
    });

})();
