// ============================================================================
// MTG COMMAND CENTER EXTRAS (v11.0)
// 1. Universal Command Palette (Ctrl+K / Cmd+K) — Instant Tool & Scryfall Search
// 2. 4-Player In-Person & Lobby Tabletop Companion (Life, 21 Cmdr Dmg, Tax, Poison)
// 3. Printable 3x3 PDF Proxy & Token Sheet Generator (Exact 63mm x 88mm)
// 4. Landing Hub Quick Category Filter
// ============================================================================

let utilsRef = null;
let stateRef = null;

// --- COMMAND PALETTE STATE ---
let cmdPaletteSearchTimeout = null;
let cmdPaletteSelectedIndex = 0;
let cmdPaletteItems = [];

// --- TABLETOP TRACKER STATE ---
const TABLETOP_STORAGE_KEY = 'mtg_tabletop_tracker_state_v1';
let tabletopState = null;

// --- PROXY PRINTER STATE ---
let proxyQueue = [];

export function initCommandCenterExtras(utils, state) {
    utilsRef = utils;
    stateRef = state;

    injectExtrasModalsAndStyles();
    setupGlobalKeyboardShortcuts();

    window.openCommandPalette = openCommandPalette;
    window.closeCommandPalette = closeCommandPalette;
    window.openTabletopTracker = openTabletopTracker;
    window.closeTabletopTracker = closeTabletopTracker;
    window.openProxyPrinterModal = openProxyPrinterModal;
    window.closeProxyPrinterModal = closeProxyPrinterModal;
    window.filterHubCategory = filterHubCategory;
}

function showMsg(msg, isError = false, duration = 3000, isSuccess = false) {
    if (utilsRef && utilsRef.showToast) {
        utilsRef.showToast(msg, isError, duration, isSuccess);
    } else if (window.boosterUtils && window.boosterUtils.showToast) {
        window.boosterUtils.showToast(msg, isError, duration, isSuccess);
    }
}

function playSfx(id = 'sfx-click') {
    if (utilsRef && utilsRef.playSound) utilsRef.playSound(id);
}

// ============================================================================
// 1. UNIVERSAL COMMAND PALETTE (Ctrl+K / Cmd+K)
// ============================================================================

const SITE_TOOLS = [
    {
        id: 'tool-arena',
        title: '⚔️ Commander Arena (4-Player Sandbox & AI Bots)',
        subtitle: 'Goldfish your deck or battle 3 AI bots on a full interactive battlefield',
        keywords: 'playtest arena simulator goldfish bot game table battlefield',
        action: () => { if (window.openCommanderArena) window.openCommanderArena(); }
    },
    {
        id: 'tool-builder',
        title: '🛠️ Native Deck Builder & My Armory',
        subtitle: 'Build Commander decks with Auto-Role Tags, WotC Bracket 1-5 & Draw Math',
        keywords: 'deck builder brew armory bracket hypergeometric mana curve',
        action: () => { if (window.openDeckBuilderView) window.openDeckBuilderView(); }
    },
    {
        id: 'tool-tabletop',
        title: '❤️ 4-Player Tabletop Life & Commander Damage Tracker',
        subtitle: 'In-person companion for 40 life, 21 commander damage matrix, tax & poison',
        keywords: 'life counter tracker commander damage poison monarch tabletop in person',
        action: () => { openTabletopTracker(); }
    },
    {
        id: 'tool-comparator',
        title: '🔄 Deck vs Collection Comparator',
        subtitle: 'Check how much of any Moxfield, Archidekt, or Precon deck you already own',
        keywords: 'compare collection missing cards buy own moxfield archidekt',
        action: () => { if (window.openCollectionTab) window.openCollectionTab('comparator'); }
    },
    {
        id: 'tool-whatcanibuild',
        title: '🧱 What Can I Build? (Archetype & Commander Matcher)',
        subtitle: 'Discover top EDH decks and commanders you already own 70%+ of',
        keywords: 'what can i build match collection commander recommendations',
        action: () => { if (window.openCollectionTab) window.openCollectionTab('build'); }
    },
    {
        id: 'tool-trade',
        title: '🤝 Digital Trade Binder & Fair-Trade Calculator',
        subtitle: 'Manage Have/Want lists, share QR codes, and balance multi-card trades',
        keywords: 'trade binder wishlist have want qr code value calculator',
        action: () => { if (window.openCollectionTab) window.openCollectionTab('trade'); }
    },
    {
        id: 'tool-sets',
        title: '🗺️ Visual Set Completion Tracker',
        subtitle: 'Track your completion percentage and missing cards across every MTG set',
        keywords: 'set completion tracker binder sets progress',
        action: () => { if (window.openCollectionTab) window.openCollectionTab('sets'); }
    },
    {
        id: 'tool-insights',
        title: '💎 Collection Value & Portfolio Insights',
        subtitle: 'Analyze your collection net worth, color pie, and highest-value staples',
        keywords: 'collection insights value price analytics staples',
        action: () => { if (window.openCollectionTab) window.openCollectionTab('insights'); }
    },
    {
        id: 'tool-booster-sim',
        title: '✨ Booster Box & Collector Pack Simulator',
        subtitle: 'Crack Play & Collector boosters with EV analytics and Sealed Arena export',
        keywords: 'booster pack box simulator crack open collector ev sealed',
        action: () => { if (window.openBoosterSimulator) window.openBoosterSimulator(); }
    },
    {
        id: 'tool-booster-draft',
        title: '🎴 8-Pod Booster Draft Simulator',
        subtitle: 'Draft 3 packs against 7 smart bots or live friends with deck building',
        keywords: 'booster draft pod bots limited',
        action: () => { if (window.openBoosterDraftLobby) window.openBoosterDraftLobby(); }
    },
    {
        id: 'tool-proxy',
        title: '🖨️ Printable 3×3 PDF Proxy & Token Sheet Maker',
        subtitle: 'Generate exact 63mm × 88mm printable playtest sheets for any cards',
        keywords: 'print proxy pdf sheet token paper playtest',
        action: () => { openProxyPrinterModal([], 'Custom Proxy Sheet'); }
    },
    {
        id: 'tool-roll-cmdr',
        title: '🎲 Quick Roll Random Commander',
        subtitle: 'Roll a random legal Commander with filters for Bracket, Budget, or Set',
        keywords: 'random roll commander mystery',
        action: () => { if (window.quickRollCommander) window.quickRollCommander(); }
    },
    {
        id: 'tool-roll-precon',
        title: '📦 Quick Roll Official Precon Deck',
        subtitle: 'Roll from 145+ official WotC Commander Preconstructed decks',
        keywords: 'random roll precon preconstructed deck',
        action: () => { if (window.quickRollPrecon) window.quickRollPrecon(); }
    },
    {
        id: 'tool-hof',
        title: '🏆 Global Hall of Fame',
        subtitle: 'View recent match champions and winning commanders across playgroups',
        keywords: 'hall of fame winners leaderboard history',
        action: () => { if (window.openHallOfFame) window.openHallOfFame(); }
    },
    {
        id: 'tool-demo-collection',
        title: '✨ Load Instant Demo Collection (1-Click Sample)',
        subtitle: 'Populate a 250-card sample collection to test all Collection Hub features',
        keywords: 'demo sample collection test try onboarding',
        action: () => { if (window.loadSampleDemoCollection) window.loadSampleDemoCollection(); }
    }
];

function setupGlobalKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            const modal = document.getElementById('universalCommandPaletteModal');
            if (modal && modal.style.display === 'flex') {
                closeCommandPalette();
            } else {
                openCommandPalette();
            }
            return;
        }

        const modal = document.getElementById('universalCommandPaletteModal');
        if (modal && modal.style.display === 'flex') {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeCommandPalette();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (cmdPaletteItems.length > 0) {
                    cmdPaletteSelectedIndex = (cmdPaletteSelectedIndex + 1) % cmdPaletteItems.length;
                    highlightCommandPaletteItem();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (cmdPaletteItems.length > 0) {
                    cmdPaletteSelectedIndex = (cmdPaletteSelectedIndex - 1 + cmdPaletteItems.length) % cmdPaletteItems.length;
                    highlightCommandPaletteItem();
                }
            } else if (e.key === 'Enter') {
                const activeEl = document.querySelector('.cmd-palette-item.active');
                if (activeEl) {
                    e.preventDefault();
                    activeEl.click();
                }
            }
        }
    });
}

export function openCommandPalette(initialQuery = '') {
    playSfx();
    const modal = document.getElementById('universalCommandPaletteModal');
    const input = document.getElementById('cmdPaletteInput');
    if (!modal) return;
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);
    if (input) {
        input.value = initialQuery;
        input.focus();
        renderCommandPaletteResults(initialQuery);
    }
}

export function closeCommandPalette() {
    const modal = document.getElementById('universalCommandPaletteModal');
    if (!modal) return;
    modal.classList.remove('show');
    setTimeout(() => { modal.style.display = 'none'; }, 200);
}

function highlightCommandPaletteItem() {
    const els = document.querySelectorAll('#cmdPaletteResults .cmd-palette-item');
    els.forEach((el, idx) => {
        if (idx === cmdPaletteSelectedIndex) {
            el.classList.add('active');
            el.scrollIntoView({ block: 'nearest' });
        } else {
            el.classList.remove('active');
        }
    });
}

async function renderCommandPaletteResults(rawQuery) {
    const container = document.getElementById('cmdPaletteResults');
    if (!container) return;

    const q = (rawQuery || '').trim().toLowerCase();
    cmdPaletteSelectedIndex = 0;

    const matchedTools = SITE_TOOLS.filter(t => {
        if (!q) return true;
        return t.title.toLowerCase().includes(q) ||
               t.subtitle.toLowerCase().includes(q) ||
               t.keywords.includes(q);
    });

    let html = '';
    cmdPaletteItems = [];

    if (matchedTools.length > 0) {
        html += `<div class="cmd-palette-section-label">⚡ Tools & Navigation</div>`;
        matchedTools.slice(0, q ? 6 : 10).forEach((tool) => {
            const idx = cmdPaletteItems.length;
            cmdPaletteItems.push({ type: 'tool', tool });
            html += `
                <div class="cmd-palette-item ${idx === 0 ? 'active' : ''}" data-cmd-idx="${idx}" onclick="window._triggerCmdPaletteItem(${idx})">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:700; color:#f8fafc; font-size:0.92rem;">${tool.title}</div>
                        <div style="font-size:0.76rem; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${tool.subtitle}</div>
                    </div>
                    <span style="font-size:0.72rem; color:var(--gold); background:rgba(212,175,55,0.12); border:1px solid rgba(212,175,55,0.3); padding:3px 8px; border-radius:6px; font-weight:700;">Open ↵</span>
                </div>
            `;
        });
    }

    if (q.length >= 2) {
        html += `<div id="cmdPaletteCardSection"><div class="cmd-palette-section-label">🔍 Searching Scryfall Cards for "${ rawQuery.replace(/[<>&"']/g, '') }"...</div></div>`;
    }

    if (!html) {
        html = `<div style="padding:28px; text-align:center; color:#94a3b8;">No matching tools. Keep typing to search 27,000+ MTG cards...</div>`;
    }

    container.innerHTML = html;

    if (cmdPaletteSearchTimeout) clearTimeout(cmdPaletteSearchTimeout);
    if (q.length >= 2) {
        cmdPaletteSearchTimeout = setTimeout(async () => {
            try {
                const res = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(rawQuery)}`);
                if (!res.ok) return;
                const data = await res.json();
                const cardNames = (data.data || []).slice(0, 7);
                const cardSec = document.getElementById('cmdPaletteCardSection');
                if (!cardSec) return;

                if (cardNames.length === 0) {
                    cardSec.innerHTML = `<div class="cmd-palette-section-label">🃏 Cards</div><div style="padding:12px 16px; color:#64748b; font-size:0.82rem;">No Scryfall cards found matching "${rawQuery.replace(/[<>&"']/g, '')}".</div>`;
                    return;
                }

                let cardHtml = `<div class="cmd-palette-section-label">🃏 Scryfall Cards — Click to Inspect 3D or Quick-Add</div>`;
                cardNames.forEach(name => {
                    const idx = cmdPaletteItems.length;
                    cmdPaletteItems.push({ type: 'card', name });
                    const safeName = name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    cardHtml += `
                        <div class="cmd-palette-item ${idx === 0 ? 'active' : ''}" data-cmd-idx="${idx}" onclick="window._triggerCmdPaletteItem(${idx})">
                            <div style="flex:1; min-width:0; display:flex; align-items:center; gap:10px;">
                                <span style="font-size:1.05rem;">🃏</span>
                                <div>
                                    <div style="font-weight:700; color:#e2e8f0; font-size:0.9rem;">${name}</div>
                                    <div style="font-size:0.72rem; color:#64748b;">Inspect 3D • Rulings • Printings • Legality</div>
                                </div>
                            </div>
                            <div style="display:flex; gap:6px; flex-wrap:wrap;" onclick="event.stopPropagation();">
                                <button class="cmd-quick-action-btn" style="background:rgba(56,189,248,0.15); color:#38bdf8; border-color:rgba(56,189,248,0.35);" onclick="window._cmdCardAction('${safeName}', 'inspect')" title="Open in 3D Card Inspector">🔍 3D Inspect</button>
                                <button class="cmd-quick-action-btn" style="background:rgba(212,175,55,0.15); color:var(--gold); border-color:rgba(212,175,55,0.4);" onclick="window._cmdCardAction('${safeName}', 'builder')" title="Add to Native Deck Builder">🛠️ + Builder</button>
                                <button class="cmd-quick-action-btn" style="background:rgba(16,185,129,0.15); color:#34d399; border-color:rgba(16,185,129,0.35);" onclick="window._cmdCardAction('${safeName}', 'have')" title="Add to Trade Binder (Have)">🟢 + Have</button>
                                <button class="cmd-quick-action-btn" style="background:rgba(168,85,247,0.15); color:#c084fc; border-color:rgba(168,85,247,0.35);" onclick="window._cmdCardAction('${safeName}', 'proxy')" title="Print Proxy">🖨️ Proxy</button>
                            </div>
                        </div>
                    `;
                });
                cardSec.innerHTML = cardHtml;
            } catch (e) {}
        }, 160);
    }
}

window._triggerCmdPaletteItem = async (idx) => {
    const item = cmdPaletteItems[idx];
    if (!item) return;
    if (item.type === 'tool') {
        closeCommandPalette();
        item.tool.action();
    } else if (item.type === 'card') {
        await window._cmdCardAction(item.name, 'inspect');
    }
};

window._cmdCardAction = async (cardName, actionType) => {
    try {
        showMsg(`Fetching ${cardName}...`, false, 1500);
        const res = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`);
        if (!res.ok) throw new Error('Card not found');
        const card = await res.json();
        closeCommandPalette();

        if (actionType === 'inspect') {
            if (window.openCardInspector) window.openCardInspector(card);
        } else if (actionType === 'builder') {
            if (window.openDeckBuilderView) window.openDeckBuilderView();
            setTimeout(() => {
                if (window.addExternalCardToBuilder) window.addExternalCardToBuilder(card);
            }, 250);
        } else if (actionType === 'have' || actionType === 'want') {
            if (window.addCardToTradeBinderGlobal) {
                window.addCardToTradeBinderGlobal(card, actionType);
            }
        } else if (actionType === 'proxy') {
            openProxyPrinterModal([card], `Proxy: ${card.name}`);
        }
    } catch (e) {
        showMsg(`Could not load ${cardName}.`, true);
    }
};

// ============================================================================
// 2. 4-PLAYER TABLETOP COMPANION (LIFE, 21 CMDR DMG, TAX, POISON, MONARCH)
// ============================================================================

function getDefaultTabletopState() {
    return {
        turn: 1,
        activeSeat: 0,
        monarchSeat: null,
        initiativeSeat: null,
        seatCount: 4,
        seats: [
            { id: 0, name: 'Player 1', commander: '', life: 40, tax: 0, poison: 0, energy: 0, rad: 0, cmdrDmg: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, playerId: null },
            { id: 1, name: 'Player 2', commander: '', life: 40, tax: 0, poison: 0, energy: 0, rad: 0, cmdrDmg: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, playerId: null },
            { id: 2, name: 'Player 3', commander: '', life: 40, tax: 0, poison: 0, energy: 0, rad: 0, cmdrDmg: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, playerId: null },
            { id: 3, name: 'Player 4', commander: '', life: 40, tax: 0, poison: 0, energy: 0, rad: 0, cmdrDmg: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, playerId: null },
            { id: 4, name: 'Player 5', commander: '', life: 40, tax: 0, poison: 0, energy: 0, rad: 0, cmdrDmg: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, playerId: null },
            { id: 5, name: 'Player 6', commander: '', life: 40, tax: 0, poison: 0, energy: 0, rad: 0, cmdrDmg: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, playerId: null }
        ]
    };
}

function loadTabletopState() {
    try {
        const raw = localStorage.getItem(TABLETOP_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.seats) && parsed.seats.length >= 4) {
                tabletopState = parsed;
                return;
            }
        }
    } catch (e) {}
    tabletopState = getDefaultTabletopState();
}

function saveTabletopState() {
    try {
        localStorage.setItem(TABLETOP_STORAGE_KEY, JSON.stringify(tabletopState));
    } catch (e) {}
}

export function openTabletopTracker(syncFromLobby = false) {
    playSfx();
    if (!tabletopState) loadTabletopState();

    // Auto-populate player names & commanders from active room if available
    const roomPlayers = window.latestRoomData?.players ? Object.entries(window.latestRoomData.players) : [];
    if (syncFromLobby || (roomPlayers.length > 0 && tabletopState.seats[0].name === 'Player 1' && !tabletopState.seats[0].commander)) {
        const count = Math.max(2, Math.min(6, roomPlayers.length));
        tabletopState.seatCount = count;
        roomPlayers.slice(0, 6).forEach(([pId, pData], idx) => {
            tabletopState.seats[idx].name = pData.name || `Player ${idx + 1}`;
            tabletopState.seats[idx].commander = pData.selected || '';
            tabletopState.seats[idx].playerId = pId;
        });
        saveTabletopState();
    }

    const modal = document.getElementById('tabletopCompanionModal');
    if (modal) {
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('show'), 10);
        renderTabletopTracker();
    }
}

export function closeTabletopTracker() {
    const modal = document.getElementById('tabletopCompanionModal');
    if (!modal) return;
    modal.classList.remove('show');
    setTimeout(() => { modal.style.display = 'none'; }, 200);
}

function renderTabletopTracker() {
    const grid = document.getElementById('tabletopSeatsGrid');
    const turnBadge = document.getElementById('tabletopTurnBadge');
    const podCountSelect = document.getElementById('tabletopPodCountSelect');
    if (!grid || !tabletopState) return;

    if (turnBadge) turnBadge.textContent = `Turn ${tabletopState.turn}`;
    if (podCountSelect) podCountSelect.value = String(tabletopState.seatCount || 4);

    const activeSeats = tabletopState.seats.slice(0, tabletopState.seatCount || 4);
    const cols = activeSeats.length <= 2 ? 'repeat(auto-fit, minmax(300px, 1fr))' : (activeSeats.length <= 4 ? 'repeat(auto-fit, minmax(280px, 1fr))' : 'repeat(auto-fit, minmax(240px, 1fr))');
    grid.style.gridTemplateColumns = cols;

    const seatColors = ['#38bdf8', '#f59e0b', '#10b981', '#ec4899', '#a855f7', '#ef4444'];
    const hasActiveRoom = !!(stateRef && stateRef.currentRoom && window.latestRoomData?.players);

    grid.innerHTML = activeSeats.map((seat, idx) => {
        const accent = seatColors[idx % seatColors.length];
        const isTurn = tabletopState.activeSeat === idx;
        const isMonarch = tabletopState.monarchSeat === idx;
        const isInitiative = tabletopState.initiativeSeat === idx;

        // Check lethal conditions
        const maxCmdrDmg = Math.max(...Object.values(seat.cmdrDmg || { 0: 0 }));
        const isDead = seat.life <= 0 || seat.poison >= 10 || maxCmdrDmg >= 21;

        return `
            <div class="tabletop-seat-card ${isTurn ? 'active-turn' : ''} ${isDead ? 'seat-eliminated' : ''}" style="--seat-accent: ${accent};">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
                    <div style="display:flex; align-items:center; gap:6px; flex:1; min-width:0;">
                        <span style="width:10px; height:10px; border-radius:50%; background:${accent}; display:inline-block; flex-shrink:0;"></span>
                        <input type="text" value="${(seat.name || '').replace(/"/g, '&quot;')}" onchange="window._ttUpdateName(${idx}, this.value)" style="background:transparent; border:none; border-bottom:1px dashed rgba(255,255,255,0.18); color:#fff; font-weight:800; font-size:1rem; width:100%; padding:2px 4px;" title="Click to edit player name">
                    </div>
                    <div style="display:flex; gap:4px; align-items:center;">
                        <button class="tt-badge-btn ${isMonarch ? 'active-gold' : ''}" onclick="window._ttToggleBadge('monarch', ${idx})" title="Toggle The Monarch">👑</button>
                        <button class="tt-badge-btn ${isInitiative ? 'active-cyan' : ''}" onclick="window._ttToggleBadge('initiative', ${idx})" title="Toggle The Initiative">🔦</button>
                        ${hasActiveRoom ? `<button class="tt-badge-btn" style="background:rgba(212,175,55,0.2); border-color:var(--gold); color:var(--gold); font-size:0.72rem; padding:3px 7px;" onclick="window._ttCrownLobbyWinner(${idx})" title="Crown Victor in Challenge Lobby">🏆 Win</button>` : ''}
                    </div>
                </div>

                <div style="margin-bottom:10px;">
                    <input type="text" placeholder="Commander Name (optional)..." value="${(seat.commander || '').replace(/"/g, '&quot;')}" onchange="window._ttUpdateCommander(${idx}, this.value)" style="background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.08); border-radius:6px; color:#94a3b8; font-size:0.76rem; width:100%; padding:4px 8px;">
                </div>

                <!-- Main Life Total Display & Controls -->
                <div class="tt-life-row">
                    <div class="tt-life-btn-col">
                        <button class="tt-life-btn minus" onclick="window._ttChangeLife(${idx}, -1)">-1</button>
                        <button class="tt-life-btn minus-big" onclick="window._ttChangeLife(${idx}, -5)">-5</button>
                    </div>
                    <div class="tt-life-number-wrap">
                        <div class="tt-life-number" style="color:${seat.life <= 10 ? '#f87171' : '#f8fafc'};">${seat.life}</div>
                        <div style="font-size:0.68rem; text-transform:uppercase; letter-spacing:1px; color:#94a3b8;">
                            ${isDead ? '<span style="color:#ef4444; font-weight:800;">💀 ELIMINATED</span>' : '❤️ Life Total'}
                        </div>
                    </div>
                    <div class="tt-life-btn-col">
                        <button class="tt-life-btn plus" onclick="window._ttChangeLife(${idx}, 1)">+1</button>
                        <button class="tt-life-btn plus-big" onclick="window._ttChangeLife(${idx}, 5)">+5</button>
                    </div>
                </div>

                <!-- Secondary Counters: Commander Tax, Poison, Energy -->
                <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin-top:10px;">
                    <div class="tt-mini-counter" onclick="window._ttChangeCounter(${idx}, 'tax', 2)" oncontextmenu="event.preventDefault(); window._ttChangeCounter(${idx}, 'tax', -2);" title="Left-click: +2 Mana Tax | Right-click: -2">
                        <span style="font-size:0.68rem; color:#94a3b8;">🏰 Cmdr Tax</span>
                        <strong style="color:#fbbf24; font-size:0.92rem;">+${seat.tax}</strong>
                    </div>
                    <div class="tt-mini-counter" onclick="window._ttChangeCounter(${idx}, 'poison', 1)" oncontextmenu="event.preventDefault(); window._ttChangeCounter(${idx}, 'poison', -1);" title="Left-click: +1 Poison | Right-click: -1 (10 = Lethal)">
                        <span style="font-size:0.68rem; color:#94a3b8;">☠️ Poison</span>
                        <strong style="color:${seat.poison >= 10 ? '#ef4444' : '#34d399'}; font-size:0.92rem;">${seat.poison}/10</strong>
                    </div>
                    <div class="tt-mini-counter" onclick="window._ttChangeCounter(${idx}, 'energy', 1)" oncontextmenu="event.preventDefault(); window._ttChangeCounter(${idx}, 'energy', -1);" title="Left-click: +1 Energy/Exp | Right-click: -1">
                        <span style="font-size:0.68rem; color:#94a3b8;">⚡ Energy</span>
                        <strong style="color:#38bdf8; font-size:0.92rem;">${seat.energy}</strong>
                    </div>
                </div>

                <!-- 21 Commander Damage Matrix from Each Seat -->
                <div style="margin-top:10px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.07); border-radius:8px; padding:7px 9px;">
                    <div style="font-size:0.68rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.6px; margin-bottom:5px; display:flex; justify-content:space-between;">
                        <span>⚔️ Commander Damage Taken (21 = KO)</span>
                        <span style="font-size:0.64rem; color:#64748b;">Tap +1 / Right-click -1</span>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(${activeSeats.length}, 1fr); gap:5px;">
                        ${activeSeats.map((opp, oppIdx) => {
                            const dmg = (seat.cmdrDmg && seat.cmdrDmg[oppIdx]) || 0;
                            const oppAccent = seatColors[oppIdx % seatColors.length];
                            const lethal = dmg >= 21;
                            return `
                                <button class="tt-cmdr-dmg-pill ${lethal ? 'lethal' : ''}"
                                        style="border-color:${lethal ? '#ef4444' : 'rgba(255,255,255,0.12)'};"
                                        onclick="window._ttChangeCmdrDmg(${idx}, ${oppIdx}, 1)"
                                        oncontextmenu="event.preventDefault(); window._ttChangeCmdrDmg(${idx}, ${oppIdx}, -1);"
                                        title="Commander damage from ${opp.name} (Auto-adjusts Life)">
                                    <span style="font-size:0.63rem; color:${oppAccent}; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;">${(opp.name || `P${oppIdx + 1}`).substring(0, 7)}</span>
                                    <strong style="font-size:0.88rem; color:${lethal ? '#ef4444' : '#f8fafc'};">${dmg}</strong>
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

window._ttChangeLife = (seatIdx, delta) => {
    if (!tabletopState || !tabletopState.seats[seatIdx]) return;
    playSfx();
    tabletopState.seats[seatIdx].life += delta;
    saveTabletopState();
    renderTabletopTracker();
};

window._ttChangeCounter = (seatIdx, key, delta) => {
    if (!tabletopState || !tabletopState.seats[seatIdx]) return;
    playSfx();
    tabletopState.seats[seatIdx][key] = Math.max(0, (tabletopState.seats[seatIdx][key] || 0) + delta);
    saveTabletopState();
    renderTabletopTracker();
};

window._ttChangeCmdrDmg = (targetSeatIdx, sourceSeatIdx, delta) => {
    if (!tabletopState || !tabletopState.seats[targetSeatIdx]) return;
    playSfx();
    const seat = tabletopState.seats[targetSeatIdx];
    if (!seat.cmdrDmg) seat.cmdrDmg = {};
    const prev = seat.cmdrDmg[sourceSeatIdx] || 0;
    const next = Math.max(0, prev + delta);
    const actualDelta = next - prev;
    seat.cmdrDmg[sourceSeatIdx] = next;
    // Automatically subtract commander damage from life total
    seat.life -= actualDelta;
    saveTabletopState();
    renderTabletopTracker();
};

window._ttUpdateName = (seatIdx, val) => {
    if (!tabletopState || !tabletopState.seats[seatIdx]) return;
    tabletopState.seats[seatIdx].name = val.trim() || `Player ${seatIdx + 1}`;
    saveTabletopState();
    renderTabletopTracker();
};

window._ttUpdateCommander = (seatIdx, val) => {
    if (!tabletopState || !tabletopState.seats[seatIdx]) return;
    tabletopState.seats[seatIdx].commander = val.trim();
    saveTabletopState();
};

window._ttToggleBadge = (badge, seatIdx) => {
    if (!tabletopState) return;
    playSfx('sfx-choose');
    if (badge === 'monarch') {
        tabletopState.monarchSeat = tabletopState.monarchSeat === seatIdx ? null : seatIdx;
    } else if (badge === 'initiative') {
        tabletopState.initiativeSeat = tabletopState.initiativeSeat === seatIdx ? null : seatIdx;
    }
    saveTabletopState();
    renderTabletopTracker();
};

window._ttNextTurn = () => {
    if (!tabletopState) return;
    playSfx();
    const count = tabletopState.seatCount || 4;
    tabletopState.activeSeat = (tabletopState.activeSeat + 1) % count;
    if (tabletopState.activeSeat === 0) {
        tabletopState.turn += 1;
    }
    saveTabletopState();
    renderTabletopTracker();
};

window._ttChangePodSize = (val) => {
    if (!tabletopState) return;
    tabletopState.seatCount = Math.max(2, Math.min(6, parseInt(val, 10) || 4));
    saveTabletopState();
    renderTabletopTracker();
};

window._ttRollFirstPlayer = () => {
    if (!tabletopState) return;
    playSfx('sfx-reveal');
    const count = tabletopState.seatCount || 4;
    const winnerIdx = Math.floor(Math.random() * count);
    tabletopState.activeSeat = winnerIdx;
    tabletopState.turn = 1;
    saveTabletopState();
    renderTabletopTracker();
    const winnerName = tabletopState.seats[winnerIdx]?.name || `Player ${winnerIdx + 1}`;
    showMsg(`🎲 High Roll Winner: ${winnerName} goes first!`, false, 3500, true);
};

window._ttResetMatch = () => {
    if (!tabletopState) return;
    playSfx();
    tabletopState.turn = 1;
    tabletopState.activeSeat = 0;
    tabletopState.monarchSeat = null;
    tabletopState.initiativeSeat = null;
    tabletopState.seats.forEach(s => {
        s.life = 40;
        s.tax = 0;
        s.poison = 0;
        s.energy = 0;
        s.rad = 0;
        s.cmdrDmg = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    });
    saveTabletopState();
    renderTabletopTracker();
    showMsg('🔄 All life totals reset to 40 for a fresh game!', false, 2500, true);
};

window._ttCrownLobbyWinner = (seatIdx) => {
    if (!tabletopState || !tabletopState.seats[seatIdx]) return;
    const seat = tabletopState.seats[seatIdx];
    closeTabletopTracker();
    if (window.openDeclareWinnerModal) {
        window.openDeclareWinnerModal();
        setTimeout(() => {
            const sel = document.getElementById('winnerPlayerSelect');
            if (sel && seat.playerId) {
                sel.value = seat.playerId;
            }
        }, 150);
    } else {
        showMsg(`🏆 ${seat.name} won the pod!`, false, 3000, true);
    }
};

// ============================================================================
// 3. PRINTABLE 3x3 PDF PROXY & TOKEN SHEET GENERATOR (Exact 63mm x 88mm)
// ============================================================================

export async function openProxyPrinterModal(initialCards = [], title = 'Printable 3×3 Proxy Sheet') {
    playSfx();
    const modal = document.getElementById('proxyPrinterModal');
    const titleEl = document.getElementById('proxyPrinterTitle');
    if (!modal) return;
    if (titleEl) titleEl.textContent = `🖨️ ${title}`;

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);

    if (Array.isArray(initialCards) && initialCards.length > 0) {
        await setProxyCardsFromList(initialCards);
    } else {
        renderProxySheetPreview();
    }
}

export function closeProxyPrinterModal() {
    const modal = document.getElementById('proxyPrinterModal');
    if (!modal) return;
    modal.classList.remove('show');
    setTimeout(() => { modal.style.display = 'none'; }, 200);
}

async function setProxyCardsFromList(rawCards) {
    proxyQueue = [];
    const needsFetch = [];

    for (const item of rawCards) {
        if (!item) continue;
        const qty = Math.max(1, Math.min(20, parseInt(item.quantity || item.qty || item.count || 1, 10)));
        const img = item.imageUrl || item.img || item.image_uris?.normal || item.image_uris?.large || item.card_faces?.[0]?.image_uris?.normal || item.image1 || '';
        const name = item.name || String(item).trim();
        if (img) {
            for (let i = 0; i < qty; i++) {
                proxyQueue.push({ name, imageUrl: img, type_line: item.type_line || '' });
            }
        } else if (name) {
            needsFetch.push({ name, qty });
        }
    }

    renderProxySheetPreview();

    if (needsFetch.length > 0) {
        showMsg(`⏳ Fetching high-res card art for ${needsFetch.length} cards...`, false, 2500);
        // Batch fetch via Scryfall /cards/collection in chunks of 75
        for (let i = 0; i < needsFetch.length; i += 75) {
            const batch = needsFetch.slice(i, i + 75);
            try {
                const identifiers = batch.map(b => ({ name: b.name.split('//')[0].trim() }));
                const res = await fetch('https://api.scryfall.com/cards/collection', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifiers })
                });
                if (res.ok) {
                    const data = await res.json();
                    const foundMap = new Map();
                    (data.data || []).forEach(c => {
                        const imgUrl = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || '';
                        foundMap.set(c.name.toLowerCase(), { name: c.name, imageUrl: imgUrl, type_line: c.type_line || '' });
                        if (c.name.includes('//')) {
                            foundMap.set(c.name.split('//')[0].trim().toLowerCase(), { name: c.name, imageUrl: imgUrl, type_line: c.type_line || '' });
                        }
                    });
                    batch.forEach(req => {
                        const key = req.name.split('//')[0].trim().toLowerCase();
                        const match = foundMap.get(key) || foundMap.get(req.name.toLowerCase());
                        if (match && match.imageUrl) {
                            for (let q = 0; q < req.qty; q++) {
                                proxyQueue.push({ ...match });
                            }
                        }
                    });
                }
            } catch (e) {}
        }
        renderProxySheetPreview();
    }
}

window._addCardToProxyQueueByName = async () => {
    const input = document.getElementById('proxyAddCardInput');
    const qtyInput = document.getElementById('proxyAddCardQty');
    if (!input || !input.value.trim()) return;
    const query = input.value.trim();
    const qty = Math.max(1, Math.min(36, parseInt(qtyInput?.value || '1', 10)));

    try {
        showMsg(`Searching Scryfall for "${query}"...`, false, 1500);
        const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('Not found');
        const card = await res.json();
        const imgUrl = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
        for (let i = 0; i < qty; i++) {
            proxyQueue.push({ name: card.name, imageUrl: imgUrl, type_line: card.type_line || '' });
        }
        input.value = '';
        renderProxySheetPreview();
        showMsg(`✅ Added ${qty}x ${card.name} to proxy sheet`, false, 2000, true);
    } catch (e) {
        showMsg(`Could not find card "${query}".`, true);
    }
};

window._removeProxyCardAt = (idx) => {
    proxyQueue.splice(idx, 1);
    renderProxySheetPreview();
};

window._clearProxyQueue = () => {
    proxyQueue = [];
    renderProxySheetPreview();
};

window._filterProxyExcludeLands = () => {
    const basicNames = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes', 'snow-covered plains', 'snow-covered island', 'snow-covered swamp', 'snow-covered mountain', 'snow-covered forest']);
    const before = proxyQueue.length;
    proxyQueue = proxyQueue.filter(c => !basicNames.has((c.name || '').toLowerCase()));
    renderProxySheetPreview();
    showMsg(`Removed ${before - proxyQueue.length} Basic Lands from proxy queue.`, false, 2500, true);
};

function renderProxySheetPreview() {
    const container = document.getElementById('proxyPagesContainer');
    const statsEl = document.getElementById('proxyStatsBadge');
    const showCutLines = document.getElementById('proxyCutLinesToggle')?.checked !== false;
    if (!container) return;

    const totalCards = proxyQueue.length;
    const totalPages = Math.max(1, Math.ceil(totalCards / 9));
    if (statsEl) {
        statsEl.textContent = `${totalCards} Cards • ${totalPages} Page${totalPages === 1 ? '' : 's'} (9 per sheet • 63mm × 88mm)`;
    }

    if (totalCards === 0) {
        container.innerHTML = `
            <div style="padding:45px 20px; text-align:center; color:#94a3b8; border:1px dashed rgba(255,255,255,0.15); border-radius:14px;">
                <div style="font-size:2.4rem; margin-bottom:10px;">🖨️</div>
                <div style="font-weight:700; color:#f8fafc; font-size:1.05rem; margin-bottom:6px;">Your Printable 3×3 Proxy Sheet is Empty</div>
                <div style="font-size:0.85rem; max-width:460px; margin:0 auto;">Add any card or token above, or click <strong>"🖨️ Print Proxies"</strong> from the Deck Builder, Deck Comparator, Quick Roll Precon, or 3D Card Inspector.</div>
            </div>
        `;
        return;
    }

    let pagesHtml = '';
    for (let p = 0; p < totalPages; p++) {
        const slice = proxyQueue.slice(p * 9, (p + 1) * 9);
        pagesHtml += `
            <div class="proxy-sheet-page ${showCutLines ? 'with-cut-lines' : ''}">
                <div class="proxy-sheet-page-header no-print">
                    <span>📄 Sheet ${p + 1} of ${totalPages} (Cards ${p * 9 + 1}–${p * 9 + slice.length})</span>
                    <span>Standard MTG 63mm × 88mm (2.48" × 3.46")</span>
                </div>
                <div class="proxy-3x3-grid">
                    ${slice.map((c, localIdx) => {
                        const globalIdx = p * 9 + localIdx;
                        return `
                            <div class="proxy-card-cell">
                                <img src="${c.imageUrl}" alt="${(c.name || '').replace(/"/g, '&quot;')}" loading="lazy">
                                <button class="proxy-remove-btn no-print" onclick="window._removeProxyCardAt(${globalIdx})" title="Remove this copy">✕</button>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }
    container.innerHTML = pagesHtml;
}

window.printProxySheetNow = () => {
    if (proxyQueue.length === 0) {
        showMsg('Add at least 1 card to print a proxy sheet.', true);
        return;
    }
    document.body.classList.add('printing-proxy-sheet');
    window.print();
    setTimeout(() => {
        document.body.classList.remove('printing-proxy-sheet');
    }, 500);
};

// ============================================================================
// 4. LANDING HUB FOCUS FILTER
// ============================================================================

export function filterHubCategory(category = 'all') {
    playSfx();
    document.querySelectorAll('.hub-filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.hubFilter === category);
    });

    const sections = document.querySelectorAll('#view-hub [data-hub-group]');
    sections.forEach(sec => {
        const groups = (sec.dataset.hubGroup || '').split(' ');
        if (category === 'all' || groups.includes(category)) {
            sec.style.display = '';
        } else {
            sec.style.display = 'none';
        }
    });
}

// ============================================================================
// 5. DOM & CSS INJECTION FOR COMMAND PALETTE, TABLETOP & PROXY PRINTER
// ============================================================================

function injectExtrasModalsAndStyles() {
    if (document.getElementById('mtgExtrasStyles')) return;

    const style = document.createElement('style');
    style.id = 'mtgExtrasStyles';
    style.textContent = `
        /* Command Palette */
        .cmd-palette-section-label {
            font-size: 0.72rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--gold, #d4af37);
            font-weight: 800;
            padding: 10px 14px 6px;
        }
        .cmd-palette-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 10px 14px;
            border-radius: 10px;
            cursor: pointer;
            transition: background 0.15s, border-color 0.15s;
            border: 1px solid transparent;
            margin: 2px 6px;
        }
        .cmd-palette-item:hover, .cmd-palette-item.active {
            background: rgba(56, 189, 248, 0.1);
            border-color: rgba(56, 189, 248, 0.3);
        }
        .cmd-quick-action-btn {
            font-size: 0.72rem;
            font-weight: 700;
            padding: 4px 8px;
            border-radius: 6px;
            border: 1px solid transparent;
            cursor: pointer;
            transition: transform 0.12s, filter 0.12s;
        }
        .cmd-quick-action-btn:hover {
            transform: translateY(-1px);
            filter: brightness(1.15);
        }

        /* Tabletop Companion */
        .tabletop-seat-card {
            background: linear-gradient(160deg, rgba(19, 23, 34, 0.96), rgba(11, 14, 22, 0.98));
            border: 1px solid rgba(255,255,255,0.1);
            border-top: 3px solid var(--seat-accent, #38bdf8);
            border-radius: 14px;
            padding: 14px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            box-shadow: 0 10px 28px rgba(0,0,0,0.45);
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .tabletop-seat-card.active-turn {
            border-color: var(--gold, #d4af37);
            box-shadow: 0 0 22px rgba(212, 175, 55, 0.22);
        }
        .tabletop-seat-card.seat-eliminated {
            opacity: 0.65;
            border-color: rgba(239, 68, 68, 0.5);
        }
        .tt-life-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(0,0,0,0.35);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 8px 12px;
        }
        .tt-life-btn-col {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .tt-life-btn {
            width: 48px;
            height: 34px;
            border-radius: 8px;
            font-weight: 800;
            font-size: 0.9rem;
            cursor: pointer;
            border: 1px solid rgba(255,255,255,0.12);
            transition: transform 0.1s, background 0.15s;
        }
        .tt-life-btn:active { transform: scale(0.94); }
        .tt-life-btn.minus, .tt-life-btn.minus-big {
            background: rgba(239, 68, 68, 0.14);
            color: #fca5a5;
            border-color: rgba(239, 68, 68, 0.3);
        }
        .tt-life-btn.plus, .tt-life-btn.plus-big {
            background: rgba(16, 185, 129, 0.14);
            color: #6ee7b7;
            border-color: rgba(16, 185, 129, 0.3);
        }
        .tt-life-number-wrap {
            text-align: center;
            flex: 1;
        }
        .tt-life-number {
            font-size: 2.7rem;
            font-weight: 900;
            line-height: 1.05;
            font-family: 'Cinzel', serif;
        }
        .tt-mini-counter {
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 8px;
            padding: 6px 8px;
            display: flex;
            flex-direction: column;
            align-items: center;
            cursor: pointer;
            user-select: none;
        }
        .tt-mini-counter:hover {
            background: rgba(255,255,255,0.08);
        }
        .tt-cmdr-dmg-pill {
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 6px;
            padding: 4px 4px;
            display: flex;
            flex-direction: column;
            align-items: center;
            cursor: pointer;
            user-select: none;
        }
        .tt-cmdr-dmg-pill.lethal {
            background: rgba(239, 68, 68, 0.22);
        }
        .tt-badge-btn {
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 6px;
            padding: 3px 6px;
            cursor: pointer;
            font-size: 0.85rem;
        }
        .tt-badge-btn.active-gold {
            background: rgba(212, 175, 55, 0.28);
            border-color: var(--gold, #d4af37);
            box-shadow: 0 0 10px rgba(212, 175, 55, 0.4);
        }
        .tt-badge-btn.active-cyan {
            background: rgba(56, 189, 248, 0.25);
            border-color: #38bdf8;
            box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
        }

        /* Hub Filter Bar */
        .hub-filter-bar {
            display: flex;
            justify-content: center;
            gap: 8px;
            flex-wrap: wrap;
            margin: 14px auto 4px;
        }
        .hub-filter-pill {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.12);
            color: #cbd5e1;
            padding: 6px 14px;
            border-radius: 999px;
            font-size: 0.8rem;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.15s;
        }
        .hub-filter-pill.active, .hub-filter-pill:hover {
            background: rgba(212, 175, 55, 0.18);
            border-color: var(--gold, #d4af37);
            color: var(--gold, #d4af37);
        }

        /* Proxy Printer Preview & Print Layout */
        .proxy-sheet-page {
            background: #141824;
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 20px;
        }
        .proxy-sheet-page-header {
            display: flex;
            justify-content: space-between;
            font-size: 0.78rem;
            color: #94a3b8;
            margin-bottom: 10px;
            font-weight: 700;
        }
        .proxy-3x3-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 4px;
            max-width: 580px;
            margin: 0 auto;
        }
        .proxy-sheet-page.with-cut-lines .proxy-card-cell {
            outline: 1px dashed rgba(255,255,255,0.35);
        }
        .proxy-card-cell {
            position: relative;
            aspect-ratio: 63 / 88;
            overflow: hidden;
            border-radius: 6px;
            background: #000;
        }
        .proxy-card-cell img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
        .proxy-remove-btn {
            position: absolute;
            top: 5px;
            right: 5px;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: rgba(239, 68, 68, 0.9);
            color: #fff;
            border: none;
            font-size: 0.75rem;
            font-weight: 800;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.15s;
        }
        .proxy-card-cell:hover .proxy-remove-btn {
            opacity: 1;
        }

        @media print {
            body.printing-proxy-sheet > *:not(#proxyPrinterModal) {
                display: none !important;
            }
            body.printing-proxy-sheet #proxyPrinterModal {
                position: static !important;
                display: block !important;
                background: #fff !important;
                padding: 0 !important;
                margin: 0 !important;
            }
            body.printing-proxy-sheet #proxyPrinterModal .modal-content {
                box-shadow: none !important;
                border: none !important;
                background: #fff !important;
                max-width: none !important;
                max-height: none !important;
                width: 100% !important;
                padding: 0 !important;
                margin: 0 !important;
                overflow: visible !important;
            }
            body.printing-proxy-sheet .no-print {
                display: none !important;
            }
            body.printing-proxy-sheet .proxy-sheet-page {
                background: #fff !important;
                border: none !important;
                padding: 4mm !important;
                margin: 0 !important;
                page-break-after: always;
                break-after: page;
            }
            body.printing-proxy-sheet .proxy-3x3-grid {
                display: grid !important;
                grid-template-columns: repeat(3, 63mm) !important;
                grid-auto-rows: 88mm !important;
                gap: 0.5mm !important;
                justify-content: center !important;
                max-width: none !important;
            }
            body.printing-proxy-sheet .proxy-card-cell {
                width: 63mm !important;
                height: 88mm !important;
                border-radius: 0 !important;
            }
        }
    `;
    document.head.appendChild(style);

    // 1. Command Palette Modal
    const cmdModal = document.createElement('div');
    cmdModal.id = 'universalCommandPaletteModal';
    cmdModal.className = 'modal-overlay';
    cmdModal.style.cssText = 'display:none; z-index:115000; align-items:flex-start; padding-top:8vh;';
    cmdModal.innerHTML = `
        <div class="modal-content glass-panel" style="max-width:680px; width:94%; padding:0; overflow:hidden; border:1px solid rgba(212,175,55,0.45); box-shadow:0 24px 60px rgba(0,0,0,0.85);">
            <div style="display:flex; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.35);">
                <span style="font-size:1.2rem;">🔍</span>
                <input type="text" id="cmdPaletteInput" placeholder="Jump to any tool or search 27,000+ MTG cards (Oracle, 3D Inspect, +Deck, +Trade)..." autocomplete="off" style="flex:1; background:transparent; border:none; color:#fff; font-size:1rem; outline:none;">
                <kbd style="background:rgba(255,255,255,0.08); color:#94a3b8; padding:3px 7px; border-radius:5px; font-size:0.72rem; border:1px solid rgba(255,255,255,0.15);">ESC</kbd>
                <button onclick="window.closeCommandPalette()" style="background:transparent; border:none; color:#94a3b8; font-size:1.2rem; cursor:pointer;">✕</button>
            </div>
            <div id="cmdPaletteResults" style="max-height:64vh; overflow-y:auto; padding:8px 4px;"></div>
            <div style="padding:8px 16px; border-top:1px solid rgba(255,255,255,0.08); background:rgba(0,0,0,0.4); display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; color:#64748b; flex-wrap:wrap; gap:8px;">
                <span>💡 Tip: Press <strong style="color:#cbd5e1;">Ctrl + K</strong> (or <strong style="color:#cbd5e1;">⌘K</strong>) anywhere to open Quick Search</span>
                <span>↑↓ to navigate • Enter to launch</span>
            </div>
        </div>
    `;
    document.body.appendChild(cmdModal);

    const cmdInput = document.getElementById('cmdPaletteInput');
    if (cmdInput) {
        cmdInput.addEventListener('input', (e) => {
            renderCommandPaletteResults(e.target.value);
        });
    }

    // 2. 4-Player Tabletop Companion Modal
    const ttModal = document.createElement('div');
    ttModal.id = 'tabletopCompanionModal';
    ttModal.className = 'modal-overlay';
    ttModal.style.cssText = 'display:none; z-index:112000;';
    ttModal.innerHTML = `
        <div class="modal-content glass-panel" style="max-width:1220px; width:96%; max-height:94vh; overflow-y:auto; padding:18px 20px; border:1px solid rgba(212,175,55,0.4);">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:14px;">
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <h2 style="margin:0; font-size:1.3rem; color:var(--gold);">❤️ Tabletop Pod Companion</h2>
                    <span id="tabletopTurnBadge" style="background:rgba(212,175,55,0.18); color:var(--gold); border:1px solid rgba(212,175,55,0.4); padding:4px 12px; border-radius:999px; font-weight:800; font-size:0.85rem;">Turn 1</span>
                </div>
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <select id="tabletopPodCountSelect" onchange="window._ttChangePodSize(this.value)" style="background:rgba(0,0,0,0.45); color:#e2e8f0; border:1px solid rgba(255,255,255,0.15); border-radius:8px; padding:6px 10px; font-size:0.82rem; font-weight:700;">
                        <option value="2">2 Players (1v1)</option>
                        <option value="3">3 Players</option>
                        <option value="4" selected>4 Players (Standard Pod)</option>
                        <option value="5">5 Players</option>
                        <option value="6">6 Players</option>
                    </select>
                    <button class="secondary-btn" style="margin:0; width:auto; padding:6px 12px; font-size:0.8rem; border-color:#38bdf8; color:#38bdf8;" onclick="window._ttNextTurn()">⏭️ Next Turn</button>
                    <button class="secondary-btn" style="margin:0; width:auto; padding:6px 12px; font-size:0.8rem; border-color:#a855f7; color:#c084fc;" onclick="window._ttRollFirstPlayer()">🎲 Roll First Player</button>
                    <button class="secondary-btn" style="margin:0; width:auto; padding:6px 12px; font-size:0.8rem; border-color:#f59e0b; color:#fbbf24;" onclick="window.openTabletopTracker(true)" title="Pull player names & commanders from current lobby">🔄 Sync Lobby Names</button>
                    <button class="secondary-btn" style="margin:0; width:auto; padding:6px 12px; font-size:0.8rem; border-color:#ef4444; color:#fca5a5;" onclick="window._ttResetMatch()">♻️ Reset to 40</button>
                    <button class="secondary-btn" style="margin:0; width:auto; padding:6px 12px; font-size:0.8rem;" onclick="window.closeTabletopTracker()">✕ Close</button>
                </div>
            </div>
            <div id="tabletopSeatsGrid" style="display:grid; gap:14px;"></div>
        </div>
    `;
    document.body.appendChild(ttModal);

    // 3. Printable 3x3 Proxy Sheet Modal
    const proxyModal = document.createElement('div');
    proxyModal.id = 'proxyPrinterModal';
    proxyModal.className = 'modal-overlay';
    proxyModal.style.cssText = 'display:none; z-index:114000;';
    proxyModal.innerHTML = `
        <div class="modal-content glass-panel" style="max-width:960px; width:96%; max-height:92vh; overflow-y:auto; padding:20px; border:1px solid rgba(168,85,247,0.45);">
            <div class="no-print" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; padding-bottom:14px; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:14px;">
                <div>
                    <h2 id="proxyPrinterTitle" style="margin:0; font-size:1.3rem; color:#e9d5ff;">🖨️ Printable 3×3 Proxy & Token Sheet Generator</h2>
                    <div id="proxyStatsBadge" style="font-size:0.8rem; color:#94a3b8; margin-top:3px;">0 Cards • 1 Page (9 per sheet • 63mm × 88mm)</div>
                </div>
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; color:#cbd5e1; cursor:pointer;">
                        <input type="checkbox" id="proxyCutLinesToggle" checked onchange="window._refreshProxyCutLines()"> Cut Guides
                    </label>
                    <button class="secondary-btn" style="margin:0; width:auto; padding:7px 12px; font-size:0.8rem; border-color:#94a3b8; color:#cbd5e1;" onclick="window._filterProxyExcludeLands()">🌲 Strip Basic Lands</button>
                    <button class="secondary-btn" style="margin:0; width:auto; padding:7px 12px; font-size:0.8rem; border-color:#ef4444; color:#fca5a5;" onclick="window._clearProxyQueue()">🗑️ Clear All</button>
                    <button class="primary-btn" style="margin:0; width:auto; padding:8px 18px; font-size:0.88rem; background:linear-gradient(135deg, #8b5cf6, #6d28d9);" onclick="window.printProxySheetNow()">🖨️ Print / Save PDF</button>
                    <button class="secondary-btn" style="margin:0; width:auto; padding:7px 12px; font-size:0.8rem;" onclick="window.closeProxyPrinterModal()">✕</button>
                </div>
            </div>

            <div class="no-print" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; background:rgba(0,0,0,0.3); padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.08);">
                <input type="text" id="proxyAddCardInput" placeholder="Add any card or token by name (e.g., Rhystic Study, Treasure, Sol Ring)..." onkeydown="if(event.key==='Enter') window._addCardToProxyQueueByName()" style="flex:1; min-width:220px; background:rgba(0,0,0,0.45); border:1px solid rgba(255,255,255,0.14); border-radius:8px; color:#fff; padding:8px 12px; font-size:0.88rem;">
                <input type="number" id="proxyAddCardQty" value="1" min="1" max="36" style="width:68px; background:rgba(0,0,0,0.45); border:1px solid rgba(255,255,255,0.14); border-radius:8px; color:#fff; padding:8px; font-size:0.88rem; text-align:center;" title="Copies">
                <button class="secondary-btn" style="margin:0; width:auto; padding:8px 16px; font-size:0.84rem; border-color:#a855f7; color:#e9d5ff;" onclick="window._addCardToProxyQueueByName()">➕ Add to Sheet</button>
            </div>

            <div id="proxyPagesContainer"></div>
        </div>
    `;
    document.body.appendChild(proxyModal);

    window._refreshProxyCutLines = () => {
        renderProxySheetPreview();
    };
}
