// Standalone Multiplayer Booster Draft Module
// Supports 7 limited formats:
// 1. Commander Booster Draft (3 packs, Pick 2, Pass L/R/L, 60-card deck)
// 2. Traditional Limited Draft (3 packs, Pick 1, Pass L/R/L, 40-card deck)
// 3. Sealed Deck (6 packs per player opened immediately into pool)
// 4. Grid Draft (2 players, 18 packs, 3x3 grid, pick row or column)
// 5. Winston Draft (2 players, 6 packs stack, 3 face-down piles, bluff & pass)
// 6. Winchester Draft (2 players, 6 packs, 4 face-up piles, open draft)
// 7. Rochester / Face-Up Open Draft (1 pack face-up, snake pick order)

import { db, auth } from './firebase-setup.js?v=4.3';
import { ref, get, set, update, onValue, off, remove } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
    fetchSetBoosterCards, 
    generateBoosterPack, 
    generateCollectorBoosterPack, 
    getCardPrice,
    formatCurrency 
} from './booster-simulator.js?v=4.3';

// Realtime Database Path for Booster Drafts
// Storing under 'rooms/bdf_' inherits active RTDB permissions immediately
const getDraftDbPath = (suffix = '') => suffix ? `rooms/bdf_${suffix}` : 'rooms/bdf_';

async function ensureUserAuth() {
    if (auth.currentUser) return auth.currentUser;
    return new Promise((resolve) => {
        const unsub = onAuthStateChanged(auth, (u) => {
            if (u) {
                unsub();
                resolve(u);
            }
        });
        setTimeout(async () => {
            if (!auth.currentUser) {
                try {
                    const cred = await signInAnonymously(auth);
                    resolve(cred.user);
                } catch (e) {
                    console.warn("Anonymous sign in error:", e);
                    resolve(null);
                }
            } else {
                resolve(auth.currentUser);
            }
        }, 350);
    });
}

// Draft Module State
let currentDraftCode = null;
let currentDraftData = null;
let roomListenerUnsub = null;
let draftUtils = null;
let activePickSelections = []; // Indices of cards selected in current pick
let localDraftTab = 'pick'; // 'pick' or 'deck'
let myDraftedPool = [];
let addedBasicLands = { W: 0, U: 0, B: 0, R: 0, G: 0 };
let myCommanderCard = null;

// Format Definitions & Rules
export const DRAFT_FORMATS = {
    commander_draft: {
        id: 'commander_draft',
        name: 'Commander Booster Draft',
        badge: 'Official EDH Limited',
        icon: '👑',
        packsPerPlayer: 3,
        picksPerTurn: 2,
        deckSize: 60,
        minPlayers: 2,
        maxPlayers: 8,
        recommendedPlayers: '4 - 8 Players',
        rules: 'Draft 3 packs. Pick TWO cards each pick, then pass the pack (Left ➔ Right ➔ Left). Build a 60-card Commander deck matching your commander\'s color identity.'
    },
    traditional_draft: {
        id: 'traditional_draft',
        name: 'Traditional Booster Draft',
        badge: 'Standard Limited',
        icon: '⚔️',
        packsPerPlayer: 3,
        picksPerTurn: 1,
        deckSize: 40,
        minPlayers: 2,
        maxPlayers: 8,
        recommendedPlayers: '6 - 8 Players',
        rules: 'Classic 3-pack draft. Pick ONE card per turn, then pass the pack (Left ➔ Right ➔ Left). Build a 40-card Limited deck with minimum 17 lands.'
    },
    sealed: {
        id: 'sealed',
        name: 'Sealed Deck Pool',
        badge: 'Solo or Group',
        icon: '🎁',
        packsPerPlayer: 6,
        picksPerTurn: 0,
        deckSize: 40,
        minPlayers: 1,
        maxPlayers: 16,
        recommendedPlayers: '1 - 8+ Players',
        rules: 'No waiting or passing! Every player opens 6 booster packs directly into their private pool. Build a 40-card deck (or 60-card Commander deck).'
    },
    grid_draft: {
        id: 'grid_draft',
        name: 'Grid Draft (2-Player)',
        badge: 'High Strategy 3x3',
        icon: '▦',
        packsPerPlayer: 9,
        picksPerTurn: 1,
        deckSize: 40,
        minPlayers: 2,
        maxPlayers: 2,
        recommendedPlayers: '2 Players',
        rules: '9 cards are dealt in a 3x3 grid face-up. Player 1 chooses any row or column (3 cards). Player 2 picks an intersecting row/column (2 or 3 cards). Discard remainder, alternate.'
    },
    winston_draft: {
        id: 'winston_draft',
        name: 'Winston Draft (2-Player)',
        badge: 'Bluff & Risk',
        icon: '🕵️',
        packsPerPlayer: 3,
        picksPerTurn: 1,
        deckSize: 40,
        minPlayers: 2,
        maxPlayers: 2,
        recommendedPlayers: '2 Players',
        rules: '6 packs form a 90-card stack. 3 face-down piles start with 1 card. Look at Pile 1: take it or pass (adds 1 card). If passed, look at Pile 2, then Pile 3. If pass all 3, draw blind top card.'
    },
    winchester_draft: {
        id: 'winchester_draft',
        name: 'Winchester Draft (2-Player)',
        badge: 'Fast Open Info',
        icon: '🎯',
        packsPerPlayer: 3,
        picksPerTurn: 1,
        deckSize: 40,
        minPlayers: 2,
        maxPlayers: 2,
        recommendedPlayers: '2 Players',
        rules: 'Four face-up piles start with 1 card each. At the start of each turn, 1 card is placed face-up on every pile. Active player takes one entire pile.'
    },
    rochester_draft: {
        id: 'rochester_draft',
        name: 'Rochester Open Draft',
        badge: 'Open Face Snake',
        icon: '👁️',
        packsPerPlayer: 3,
        picksPerTurn: 1,
        deckSize: 40,
        minPlayers: 2,
        maxPlayers: 8,
        recommendedPlayers: '4 - 8 Players',
        rules: 'One pack is laid out completely face-up. Players draft in Snake order (P1 ➔ P2 ➔ ... ➔ P4 ➔ P4 ➔ ... ➔ P1) until the pack is empty. Complete open information.'
    }
};

// Initialize Booster Draft Module
export function initBoosterDraftModule(utils, state) {
    draftUtils = utils;

    // Global hooks
    window.openBoosterDraftHub = (targetCode = null) => {
        if (utils.playSound) utils.playSound('sfx-click');
        utils.switchView('view-booster-draft');
        if (targetCode) {
            joinDraftRoomByCode(targetCode);
        } else {
            renderDraftHubUI();
        }
    };

    window.createDraftRoomFromUI = createDraftRoomFromUI;
    window.joinDraftRoomFromUI = joinDraftRoomFromUI;
    window.copyDraftInviteLink = copyDraftInviteLink;
    window.startBoosterDraftHost = startBoosterDraftHost;
    window.leaveDraftRoom = leaveDraftRoom;
    window.switchDraftTab = switchDraftTab;
    window.confirmActiveDraftPick = confirmActiveDraftPick;
    window.toggleDraftCardSelection = toggleDraftCardSelection;
    window.addDraftBasicLand = addDraftBasicLand;
    window.removeDraftBasicLand = removeDraftBasicLand;
    window.copyDraftDecklist = copyDraftDecklist;
    window.inspectDraftCard = (cardIdentifier) => {
        if (window.openCardInspector) {
            const foundCard = myDraftedPool.find(c => c.id === cardIdentifier || c.name === cardIdentifier || c.uid === cardIdentifier) || cardIdentifier;
            window.openCardInspector(foundCard);
        }
    };

    // Hash navigation listener (e.g. #draft-ABCD)
    const checkHash = () => {
        const hash = window.location.hash || '';
        if (hash.startsWith('#draft-')) {
            const code = hash.replace('#draft-', '').toUpperCase().trim();
            if (code) setTimeout(() => window.openBoosterDraftHub(code), 150);
        } else if (hash === '#booster-draft' || hash === '#view-booster-draft') {
            setTimeout(() => window.openBoosterDraftHub(), 150);
        }
    };

    window.addEventListener('hashchange', checkHash);
    checkHash();
}

// Generate unique 4-letter room code (avoid confusing chars)
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Get current player identity
function getPlayerIdentity() {
    const user = auth.currentUser;
    const cachedName = localStorage.getItem('playerName') || 'Challenger';
    const id = user ? user.uid : (localStorage.getItem('guestPlayerId') || 'guest_' + Math.random().toString(36).substr(2, 9));
    if (!user && !localStorage.getItem('guestPlayerId')) {
        localStorage.setItem('guestPlayerId', id);
    }
    return {
        id,
        name: cachedName
    };
}

// Render Initial Draft Hub UI (Host vs Join)
function renderDraftHubUI() {
    const root = document.getElementById('boosterDraftRoot');
    if (!root) return;

    const sets = window.scryfallSets || [];
    const player = getPlayerIdentity();

    root.innerHTML = `
        <div class="booster-draft-container">
            <!-- Top Breadcrumb -->
            <div class="view-top-breadcrumb">
                <button class="breadcrumb-btn" onclick="window.goToMainMenu()">
                    <span>🏠</span> Return to Hub
                </button>
            </div>

            <!-- Hero Title -->
            <div class="booster-hero-header">
                <div class="hero-badge">✦ Multiplayer Limited Arena ✦</div>
                <h1 class="hero-title">BOOSTER DRAFT</h1>
                <p class="hero-subtitle">Host & join authentic Magic draft pods: Commander Limited, Traditional 8-Player, Sealed Deck, 2-Player Winston/Winchester, Grid Draft, and Rochester.</p>
            </div>

            <!-- Main Split Cards: Host vs Join -->
            <div class="draft-hub-grid">
                <!-- Host New Draft Card -->
                <div class="booster-control-card draft-host-card">
                    <div class="draft-card-header">
                        <span class="draft-mode-icon">👑</span>
                        <div>
                            <h2 class="draft-card-title">Host New Draft Pod</h2>
                            <p class="draft-card-subtitle">Configure format, choose any Magic set, and generate an invite room.</p>
                        </div>
                    </div>

                    <!-- Form Controls -->
                    <div class="booster-field-group">
                        <label class="booster-field-label"><span>🎮 Select Draft Format:</span></label>
                        <select id="draftFormatSelect" onchange="window.onDraftFormatSelectChange()">
                            ${Object.values(DRAFT_FORMATS).map(f => `
                                <option value="${f.id}" ${f.id === 'commander_draft' ? 'selected' : ''}>
                                    ${f.icon} ${f.name} (${f.recommendedPlayers})
                                </option>
                            `).join('')}
                        </select>
                        <div id="draftFormatDescBox" class="draft-format-desc">
                            ${DRAFT_FORMATS.commander_draft.rules}
                        </div>
                    </div>

                    <!-- Set Selection -->
                    <div class="booster-field-group" style="margin-top: 15px;">
                        <label class="booster-field-label"><span>📦 Expansion / Set:</span></label>
                        <div class="booster-input-with-datalist">
                            <input type="text" id="draftSetInput" list="draftSetDatalist" placeholder="Duskmourn: House of Horror (DSK)" autocomplete="off" value="Duskmourn: House of Horror (DSK)">
                            <datalist id="draftSetDatalist">
                                ${sets.map(s => `<option value="${s.name} (${s.code.toUpperCase()})"></option>`).join('')}
                            </datalist>
                        </div>
                        <!-- Quick Set Chips -->
                        <div class="booster-quick-sets" id="draftQuickSets">
                            <button type="button" class="quick-set-chip active" onclick="window.selectDraftQuickSet('dsk')">Duskmourn</button>
                            <button type="button" class="quick-set-chip" onclick="window.selectDraftQuickSet('blb')">Bloomburrow</button>
                            <button type="button" class="quick-set-chip" onclick="window.selectDraftQuickSet('mh3')">MH3</button>
                            <button type="button" class="quick-set-chip" onclick="window.selectDraftQuickSet('cmm')">Cmdr Masters</button>
                            <button type="button" class="quick-set-chip" onclick="window.selectDraftQuickSet('clb')">Baldur's Gate</button>
                            <button type="button" class="quick-set-chip" onclick="window.selectDraftQuickSet('ltr')">LotR</button>
                        </div>
                    </div>

                    <!-- Booster Edition Switch -->
                    <div class="booster-field-group" style="margin-top: 15px;">
                        <label class="booster-field-label"><span>✨ Booster Type:</span></label>
                        <div class="booster-segmented-switch">
                            <label class="segmented-option">
                                <input type="radio" name="draftBoosterEdition" id="draftEditionPlay" value="play" checked>
                                <span class="segmented-pill">Play / Draft Booster</span>
                            </label>
                            <label class="segmented-option">
                                <input type="radio" name="draftBoosterEdition" id="draftEditionCollector" value="collector">
                                <span class="segmented-pill">✨ Collector Booster</span>
                            </label>
                        </div>
                    </div>

                    <!-- Custom Options Row -->
                    <div class="draft-options-row" style="margin-top: 15px;">
                        <div class="booster-field-group" style="flex: 1;">
                            <label class="booster-field-label"><span>🎁 Packs / Player:</span></label>
                            <input type="number" id="draftPacksPerPlayer" min="1" max="12" value="3" class="draft-number-input">
                        </div>
                        <div class="booster-field-group" style="flex: 1;">
                            <label class="booster-field-label"><span>⏱️ Pick Timer:</span></label>
                            <select id="draftTimerSelect">
                                <option value="0" selected>Untimed (Casual)</option>
                                <option value="60">60 Seconds</option>
                                <option value="90">90 Seconds</option>
                                <option value="120">2 Minutes</option>
                            </select>
                        </div>
                    </div>

                    <!-- Host CTA -->
                    <button class="select-btn start-draft-cta" style="margin-top: 25px; width: 100%;" onclick="window.createDraftRoomFromUI()">
                        <span>👑 CREATE DRAFT ROOM ➔</span>
                    </button>
                </div>

                <!-- Join Existing Draft Room Card -->
                <div class="booster-control-card draft-join-card">
                    <div class="draft-card-header">
                        <span class="draft-mode-icon">🛡️</span>
                        <div>
                            <h2 class="draft-card-title">Join Existing Draft</h2>
                            <p class="draft-card-subtitle">Enter the 4-letter room code shared by your friend or tournament organizer.</p>
                        </div>
                    </div>

                    <div class="draft-join-inner">
                        <label class="booster-field-label"><span>🔑 Enter 4-Letter Room Code:</span></label>
                        <div class="draft-code-entry-box">
                            <input type="text" id="draftJoinCodeInput" placeholder="CODE" maxlength="4" class="draft-large-code-input" autocomplete="off" autocapitalize="characters">
                            <button class="select-btn draft-join-btn" onclick="window.joinDraftRoomFromUI()">
                                <span>Join Room</span>
                            </button>
                        </div>

                        <!-- Player Name Identity Box -->
                        <div class="draft-identity-preview">
                            <span class="identity-label">Joining as:</span>
                            <span class="identity-name" id="draftPlayerNameDisplay">${player.name}</span>
                            <button class="identity-edit-btn" onclick="window.openAccountModal()">Change</button>
                        </div>

                        <!-- Active Draft Format Highlights -->
                        <div class="draft-format-highlights">
                            <div class="highlight-title">✦ Supported Limited Formats ✦</div>
                            <div class="highlight-pills">
                                <span class="format-pill">👑 Commander Draft (Pick 2)</span>
                                <span class="format-pill">⚔️ Traditional Draft</span>
                                <span class="format-pill">🎁 6-Pack Sealed</span>
                                <span class="format-pill">▦ 3x3 Grid Draft</span>
                                <span class="format-pill">🕵️ Winston Draft</span>
                                <span class="format-pill">🎯 Winchester Draft</span>
                                <span class="format-pill">👁️ Rochester Draft</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Global helper for format change description
    window.onDraftFormatSelectChange = () => {
        const sel = document.getElementById('draftFormatSelect');
        const desc = document.getElementById('draftFormatDescBox');
        const packsInput = document.getElementById('draftPacksPerPlayer');
        if (sel && desc && DRAFT_FORMATS[sel.value]) {
            const f = DRAFT_FORMATS[sel.value];
            desc.innerHTML = `<strong>${f.badge}</strong>: ${f.rules}`;
            if (packsInput) packsInput.value = f.packsPerPlayer;
        }
    };

    window.selectDraftQuickSet = (code) => {
        document.querySelectorAll('#draftQuickSets .quick-set-chip').forEach(c => c.classList.remove('active'));
        if (event && event.target) event.target.classList.add('active');
        const sets = window.scryfallSets || [];
        const s = sets.find(item => item.code.toLowerCase() === code.toLowerCase());
        const input = document.getElementById('draftSetInput');
        if (input) {
            input.value = s ? `${s.name} (${s.code.toUpperCase()})` : code.toUpperCase();
        }
    };
}

// Create Draft Room (Host)
async function createDraftRoomFromUI() {
    const formatSelect = document.getElementById('draftFormatSelect');
    const setInput = document.getElementById('draftSetInput');
    const editionCollector = document.getElementById('draftEditionCollector');
    const packsInput = document.getElementById('draftPacksPerPlayer');
    const timerSelect = document.getElementById('draftTimerSelect');

    const formatId = formatSelect?.value || 'commander_draft';
    const formatConfig = DRAFT_FORMATS[formatId] || DRAFT_FORMATS.commander_draft;
    const rawSet = setInput?.value || 'dsk';
    const isCollector = editionCollector?.checked ?? false;
    const packsCount = parseInt(packsInput?.value, 10) || formatConfig.packsPerPlayer;
    const timerSecs = parseInt(timerSelect?.value, 10) || 0;

    // Resolve set code from input
    let setCode = 'dsk';
    const match = rawSet.match(/\(([A-Za-z0-9]+)\)$/);
    if (match) {
        setCode = match[1].toLowerCase();
    } else {
        const found = (window.scryfallSets || []).find(s => s.name.toLowerCase().includes(rawSet.toLowerCase()) || s.code.toLowerCase() === rawSet.toLowerCase());
        setCode = found ? found.code.toLowerCase() : rawSet.trim().toLowerCase().substring(0, 5);
    }

    const setObj = (window.scryfallSets || []).find(s => s.code.toLowerCase() === setCode) || {
        code: setCode,
        name: setCode.toUpperCase()
    };

    const player = getPlayerIdentity();
    const roomCode = generateRoomCode();

    const roomPayload = {
        code: roomCode,
        format: formatId,
        setCode: setObj.code.toLowerCase(),
        setName: setObj.name,
        packEdition: isCollector ? 'collector' : 'play',
        packsPerPlayer: packsCount,
        timerSeconds: timerSecs,
        status: 'lobby',
        hostId: player.id,
        createdAt: Date.now(),
        players: {
            [player.id]: {
                id: player.id,
                name: player.name,
                isHost: true,
                joinedAt: Date.now(),
                ready: true,
                pool: []
            }
        }
    };

    try {
        await ensureUserAuth();
        const player = getPlayerIdentity();
        roomPayload.hostId = player.id;
        roomPayload.players = {
            [player.id]: {
                id: player.id,
                name: player.name,
                isHost: true,
                joinedAt: Date.now(),
                ready: true,
                pool: []
            }
        };

        if (draftUtils?.showToast) draftUtils.showToast("Creating draft room...", false, 1500);
        await set(ref(db, getDraftDbPath(roomCode)), roomPayload);
        window.location.hash = `#draft-${roomCode}`;
        attachDraftRoomListener(roomCode);
    } catch (err) {
        console.error("Failed to create draft room:", err);
        const errMsg = err.message || "Permission or network error";
        if (draftUtils?.showToast) draftUtils.showToast(`Could not create room: ${errMsg}`, true, 5000);
    }
}

// Join Draft Room by Code
async function joinDraftRoomFromUI() {
    const input = document.getElementById('draftJoinCodeInput');
    const code = (input?.value || '').trim().toUpperCase();
    if (!code || code.length !== 4) {
        if (draftUtils?.showToast) draftUtils.showToast("Please enter a valid 4-letter room code", true);
        return;
    }
    joinDraftRoomByCode(code);
}

async function joinDraftRoomByCode(roomCode) {
    const code = roomCode.toUpperCase().trim();

    try {
        await ensureUserAuth();
        const player = getPlayerIdentity();
        if (draftUtils?.showToast) draftUtils.showToast(`Connecting to room ${code}...`, false, 1500);
        const snap = await get(ref(db, getDraftDbPath(code)));
        if (!snap.exists()) {
            if (draftUtils?.showToast) draftUtils.showToast(`Draft room "${code}" does not exist.`, true);
            return;
        }

        const roomData = snap.val();
        if (roomData.status !== 'lobby' && !roomData.players?.[player.id]) {
            if (draftUtils?.showToast) draftUtils.showToast(`Draft in room "${code}" is already in progress.`, true);
            return;
        }

        // Add player to room
        if (!roomData.players?.[player.id]) {
            await set(ref(db, `${getDraftDbPath(code)}/players/${player.id}`), {
                id: player.id,
                name: player.name,
                isHost: false,
                joinedAt: Date.now(),
                ready: true,
                pool: []
            });
        }

        window.location.hash = `#draft-${code}`;
        attachDraftRoomListener(code);
    } catch (err) {
        console.error("Error joining draft room:", err);
        const errMsg = err.message || "Error joining room";
        if (draftUtils?.showToast) draftUtils.showToast(`Error joining room: ${errMsg}`, true, 5000);
    }
}

// Attach Realtime Listener to Active Room
function attachDraftRoomListener(roomCode) {
    if (roomListenerUnsub) {
        roomListenerUnsub();
        roomListenerUnsub = null;
    }

    currentDraftCode = roomCode;
    const roomRef = ref(db, getDraftDbPath(roomCode));

    const unsubscribe = onValue(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
            if (draftUtils?.showToast) draftUtils.showToast("The draft room has been closed.", true);
            leaveDraftRoom();
            return;
        }

        currentDraftData = snapshot.val();
        renderActiveDraftRoomView(currentDraftData);
    }, (error) => {
        console.error("Draft room listener error:", error);
    });

    roomListenerUnsub = () => off(roomRef);
}

// Render Master Screen depending on Room Status
function renderActiveDraftRoomView(room) {
    const root = document.getElementById('boosterDraftRoot');
    if (!root || !room) return;

    if (room.status === 'lobby') {
        renderDraftLobbyView(room, root);
    } else if (room.status === 'drafting') {
        renderDraftActiveSessionView(room, root);
    } else if (room.status === 'complete') {
        renderDraftDeckbuildingView(room, root);
    }
}

// Render Draft Lobby (Waiting Room & Host Settings)
function renderDraftLobbyView(room, root) {
    const player = getPlayerIdentity();
    const isHost = room.hostId === player.id;
    const playersList = Object.values(room.players || {});
    const formatConfig = DRAFT_FORMATS[room.format] || DRAFT_FORMATS.commander_draft;

    root.innerHTML = `
        <div class="booster-draft-container">
            <!-- Top Navigation Breadcrumb -->
            <div class="view-top-breadcrumb">
                <button class="breadcrumb-btn" onclick="window.leaveDraftRoom()">
                    <span>🚪</span> Leave Room
                </button>
            </div>

            <!-- Room Code Hero -->
            <div class="draft-lobby-hero">
                <span class="draft-badge-pill">${formatConfig.icon} ${formatConfig.name}</span>
                <div class="draft-room-code-display" onclick="window.copyDraftInviteLink()" title="Click to copy invite link">
                    <span class="code-label">ROOM CODE:</span>
                    <span class="code-value">${room.code}</span>
                    <span class="copy-hint">📋 Click to Copy Invite Link</span>
                </div>
                <p class="draft-room-meta">
                    Set: <strong>${room.setName} (${room.setCode.toUpperCase()})</strong> • 
                    Booster: <strong>${room.packEdition === 'collector' ? '✨ Collector' : 'Play Booster'}</strong> • 
                    Packs/Player: <strong>${room.packsPerPlayer}</strong>
                </p>
            </div>

            <!-- Players Roster -->
            <div class="booster-control-card draft-roster-card">
                <div class="roster-header-row">
                    <h3 class="roster-title">👥 Challengers Assembled (${playersList.length}/${formatConfig.maxPlayers}):</h3>
                    <button class="copy-invite-btn" onclick="window.copyDraftInviteLink()">📋 Copy Invite Link</button>
                </div>

                <div class="draft-player-roster-grid">
                    ${playersList.map(p => `
                        <div class="draft-player-card ${p.id === player.id ? 'is-me' : ''}">
                            <div class="player-avatar-circle">
                                ${p.isHost ? '👑' : '👤'}
                            </div>
                            <div class="player-details">
                                <span class="player-name">${p.name} ${p.id === player.id ? '(You)' : ''}</span>
                                <span class="player-role">${p.isHost ? 'Host' : 'Challenger'}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <!-- Format Rule Explainer Box -->
                <div class="draft-rule-explainer">
                    <strong>📜 Format Rules (${formatConfig.name}):</strong>
                    <p>${formatConfig.rules}</p>
                </div>

                <!-- Host Action Bar -->
                <div class="draft-lobby-actions">
                    ${isHost ? `
                        <button id="startDraftBtn" class="select-btn start-draft-cta" onclick="window.startBoosterDraftHost()">
                            <span>⚡ START DRAFT ⚡</span>
                        </button>
                    ` : `
                        <div class="waiting-host-box">
                            <span class="mana-spinner"></span>
                            <span>Waiting for Host to start the draft...</span>
                        </div>
                    `}
                </div>
            </div>
        </div>
    `;
}

// Start Draft Execution (Host Only)
async function startBoosterDraftHost() {
    if (!currentDraftData || !currentDraftCode) return;
    const room = currentDraftData;
    const btn = document.getElementById('startDraftBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>⏳ Preparing Scryfall Packs...</span>`;
    }

    try {
        if (draftUtils?.showToast) draftUtils.showToast("Fetching cards & rolling packs...", false, 2000);

        // Fetch set cards
        const setData = await fetchSetBoosterCards(room.setCode);
        const playersList = Object.values(room.players || {});
        const isCollector = room.packEdition === 'collector';
        const packsPerPlayer = room.packsPerPlayer || 3;

        // Specialized handling per format
        if (room.format === 'sealed') {
            // Sealed: Open all 6 packs for each player immediately
            const playerUpdates = {};
            playersList.forEach(p => {
                let pool = [];
                for (let i = 1; i <= packsPerPlayer; i++) {
                    const pack = isCollector ? generateCollectorBoosterPack(setData, i) : generateBoosterPack(setData, i);
                    pool.push(...pack);
                }
                playerUpdates[`players/${p.id}/pool`] = pool;
            });

            await update(ref(db, getDraftDbPath(room.code)), {
                status: 'complete',
                startedAt: Date.now(),
                ...playerUpdates
            });

        } else if (room.format === 'grid_draft') {
            // Grid Draft: Prepare 18 packs (162 cards) dealt into 18 consecutive 3x3 grids
            let masterCards = [];
            for (let i = 1; i <= 18; i++) {
                const pack = isCollector ? generateCollectorBoosterPack(setData, i) : generateBoosterPack(setData, i);
                masterCards.push(...pack.slice(0, 9)); // 9 cards per grid
            }

            const firstGrid = masterCards.splice(0, 9);
            await update(ref(db, getDraftDbPath(room.code)), {
                status: 'drafting',
                startedAt: Date.now(),
                currentGridIndex: 1,
                totalGrids: 18,
                activePlayerIndex: 0,
                turnInGrid: 1, // 1: first pick, 2: second pick
                activeGrid: firstGrid,
                remainingCards: masterCards
            });

        } else if (room.format === 'winston_draft' || room.format === 'winchester_draft') {
            // Winston / Winchester: 6 packs shuffled into central stack
            let masterStack = [];
            for (let i = 1; i <= 6; i++) {
                const pack = isCollector ? generateCollectorBoosterPack(setData, i) : generateBoosterPack(setData, i);
                masterStack.push(...pack);
            }

            // Shuffle stack
            for (let i = masterStack.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [masterStack[i], masterStack[j]] = [masterStack[j], masterStack[i]];
            }

            if (room.format === 'winston_draft') {
                const pile1 = [masterStack.pop()];
                const pile2 = [masterStack.pop()];
                const pile3 = [masterStack.pop()];

                await update(ref(db, getDraftDbPath(room.code)), {
                    status: 'drafting',
                    startedAt: Date.now(),
                    activePlayerIndex: 0,
                    currentPileViewing: 1,
                    pile1,
                    pile2,
                    pile3,
                    drawStack: masterStack
                });
            } else {
                // Winchester: 4 face-up piles
                const pile1 = [masterStack.pop()];
                const pile2 = [masterStack.pop()];
                const pile3 = [masterStack.pop()];
                const pile4 = [masterStack.pop()];

                await update(ref(db, getDraftDbPath(room.code)), {
                    status: 'drafting',
                    startedAt: Date.now(),
                    activePlayerIndex: 0,
                    pile1,
                    pile2,
                    pile3,
                    pile4,
                    drawStack: masterStack
                });
            }

        } else {
            // Standard / Commander / Rochester Passing Drafts
            // Generate all packs for each player and store round queues
            const roundPacks = {};
            for (let r = 1; r <= packsPerPlayer; r++) {
                roundPacks[`round_${r}`] = {};
                playersList.forEach(p => {
                    const pack = isCollector ? generateCollectorBoosterPack(setData, r) : generateBoosterPack(setData, r);
                    roundPacks[`round_${r}`][p.id] = pack;
                });
            }

            // Set up initial round 1 state
            const initialPlayerPacks = {};
            playersList.forEach(p => {
                initialPlayerPacks[`players/${p.id}/currentPack`] = roundPacks['round_1'][p.id];
                initialPlayerPacks[`players/${p.id}/hasPickedInRound`] = false;
            });

            await update(ref(db, getDraftDbPath(room.code)), {
                status: 'drafting',
                startedAt: Date.now(),
                currentRound: 1,
                totalRounds: packsPerPlayer,
                roundPacks,
                ...initialPlayerPacks
            });
        }

        if (draftUtils?.playSound) draftUtils.playSound('sfx-reveal');
    } catch (err) {
        console.error("Failed to start draft:", err);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<span>⚡ START DRAFT ⚡</span>`;
        }
        if (draftUtils?.showToast) draftUtils.showToast("Failed to initialize draft packs. Check console.", true);
    }
}

// Render Active Drafting Session View
function renderDraftActiveSessionView(room, root) {
    const player = getPlayerIdentity();
    const playerData = room.players?.[player.id] || {};
    const formatConfig = DRAFT_FORMATS[room.format] || DRAFT_FORMATS.commander_draft;
    myDraftedPool = playerData.pool || [];

    // Check if player has an active pack (for passing drafts)
    const activePack = playerData.currentPack || [];
    const isPassingDraft = ['commander_draft', 'traditional_draft', 'rochester_draft'].includes(room.format);

    root.innerHTML = `
        <div class="booster-draft-container">
            <!-- Draft Header & Tabs -->
            <div class="draft-active-header">
                <div class="draft-header-left">
                    <span class="draft-badge-pill">${formatConfig.icon} ${formatConfig.name}</span>
                    <span class="draft-round-tag">Round ${room.currentRound || 1} of ${room.totalRounds || room.packsPerPlayer}</span>
                </div>

                <!-- Tab Switcher (Active Pick vs. My Pool & Deck) -->
                <div class="draft-tab-switcher">
                    <button class="draft-tab-btn ${localDraftTab === 'pick' ? 'active' : ''}" onclick="window.switchDraftTab('pick')">
                        📦 Active Pick (${activePack.length} cards)
                    </button>
                    <button class="draft-tab-btn ${localDraftTab === 'deck' ? 'active' : ''}" onclick="window.switchDraftTab('deck')">
                        🎴 My Pool (${myDraftedPool.length})
                    </button>
                </div>

                <div class="draft-header-right">
                    <span class="draft-room-code-tag">Room: ${room.code}</span>
                </div>
            </div>

            <!-- Tab 1: Pick Arena -->
            <div id="draftTabPick" style="${localDraftTab === 'pick' ? 'display:block;' : 'display:none;'}">
                ${renderDraftPickingArena(room, player, activePack, formatConfig)}
            </div>

            <!-- Tab 2: Deck Building Workspace -->
            <div id="draftTabDeck" style="${localDraftTab === 'deck' ? 'display:block;' : 'display:none;'}">
                ${renderDraftDeckWorkspace(myDraftedPool, room.format)}
            </div>
        </div>
    `;
}

// Render Active Picking Arena
function renderDraftPickingArena(room, player, activePack, formatConfig) {
    const picksNeeded = formatConfig.picksPerTurn || 1;
    const selectionsLeft = picksNeeded - activePickSelections.length;

    // Check if player already submitted pick and is waiting for pass
    const playerData = room.players?.[player.id] || {};
    if (playerData.hasPickedInRound && activePack.length === 0) {
        return `
            <div class="draft-waiting-pass-card">
                <div class="waiting-icon">⏳</div>
                <h3>Picks Submitted!</h3>
                <p>Waiting for other players to complete their picks before passing packs...</p>
                <div class="waiting-player-status-row">
                    ${Object.values(room.players || {}).map(p => `
                        <span class="player-pass-chip ${p.hasPickedInRound ? 'ready' : 'picking'}">
                            ${p.hasPickedInRound ? '✓' : '⏳'} ${p.name}
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
    }

    if (activePack.length === 0) {
        return `
            <div class="draft-waiting-pass-card">
                <div class="waiting-icon">📦</div>
                <h3>Waiting for Next Pack...</h3>
                <p>Packs are currently being passed around the table.</p>
            </div>
        `;
    }

    return `
        <div class="draft-arena-card">
            <div class="draft-arena-toolbar">
                <div class="pick-instruction">
                    ${picksNeeded > 1 
                        ? `Select <strong>${picksNeeded} cards</strong> to add to your pool (${selectionsLeft} remaining)` 
                        : `Select <strong>1 card</strong> to draft into your pool`}
                </div>
                <button id="confirmPickBtn" class="select-btn confirm-pick-btn" 
                        ${activePickSelections.length === picksNeeded ? '' : 'disabled'}
                        onclick="window.confirmActiveDraftPick()">
                    ✓ Confirm Pick (${activePickSelections.length}/${picksNeeded})
                </button>
            </div>

            <!-- Pack Cards Grid -->
            <div class="draft-pack-grid">
                ${activePack.map((card, idx) => {
                    const isSelected = activePickSelections.includes(idx);
                    const price = getCardPrice(card, 'usd');
                    return `
                        <div class="draft-card-item ${isSelected ? 'is-selected-pick' : ''} ${card.isFoil ? 'is-foil' : ''}" 
                             onclick="window.toggleDraftCardSelection(${idx})">
                            <div class="draft-card-img-wrapper">
                                <img src="${card.image}" alt="${card.name}" loading="lazy" class="draft-card-img">
                                ${card.isFoil ? '<div class="booster-foil-overlay"></div><span class="booster-foil-tag">FOIL</span>' : ''}
                                <span class="booster-rarity-pill rarity-${card.rarity}">${card.rarity.toUpperCase()}</span>
                                <button type="button" class="inspect-mini-btn" onclick="event.stopPropagation(); window.inspectDraftCard('${card.id}')" title="Inspect 3D">🔍</button>
                            </div>
                            <div class="draft-card-footer">
                                <div class="draft-card-name" title="${card.name}">${card.name}</div>
                                <div class="draft-card-price">${formatCurrency(price, 'usd')}</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

// Toggle selection of card in active pack
function toggleDraftCardSelection(cardIndex) {
    const formatConfig = DRAFT_FORMATS[currentDraftData?.format] || DRAFT_FORMATS.commander_draft;
    const maxPicks = formatConfig.picksPerTurn || 1;

    const existingPos = activePickSelections.indexOf(cardIndex);
    if (existingPos !== -1) {
        activePickSelections.splice(existingPos, 1);
    } else {
        if (activePickSelections.length < maxPicks) {
            activePickSelections.push(cardIndex);
        } else if (maxPicks === 1) {
            activePickSelections = [cardIndex];
        }
    }

    if (draftUtils?.playSound) draftUtils.playSound('sfx-click');

    // Update UI
    const root = document.getElementById('boosterDraftRoot');
    if (root && currentDraftData) {
        renderActiveDraftRoomView(currentDraftData);
    }
}

// Confirm Draft Pick and Pass Pack
async function confirmActiveDraftPick() {
    if (!currentDraftData || !currentDraftCode) return;
    const player = getPlayerIdentity();
    const playerData = currentDraftData.players?.[player.id] || {};
    const activePack = playerData.currentPack || [];
    const formatConfig = DRAFT_FORMATS[currentDraftData.format] || DRAFT_FORMATS.commander_draft;
    const maxPicks = formatConfig.picksPerTurn || 1;

    if (activePickSelections.length !== maxPicks) return;

    const pickedCards = activePickSelections.map(idx => activePack[idx]).filter(Boolean);
    const remainingPack = activePack.filter((_, idx) => !activePickSelections.includes(idx));
    const currentPool = playerData.pool || [];
    const updatedPool = [...currentPool, ...pickedCards];

    activePickSelections = [];
    if (draftUtils?.playSound) draftUtils.playSound('sfx-choose');

    // Update player's picked status and pool
    await update(ref(db, `${getDraftDbPath(currentDraftCode)}/players/${player.id}`), {
        pool: updatedPool,
        hasPickedInRound: true,
        remainingPassedPack: remainingPack
    });

    // Check if ALL players in room have completed their picks for this turn
    checkAndPassPacksAroundTable(currentDraftCode);
}

// Check and Pass Packs to next players
async function checkAndPassPacksAroundTable(roomCode) {
    const snap = await get(ref(db, getDraftDbPath(roomCode)));
    if (!snap.exists()) return;
    const room = snap.val();

    const playersList = Object.values(room.players || {});
    const allPicked = playersList.every(p => p.hasPickedInRound);

    if (!allPicked) return; // Still waiting for others

    // Check if current packs are empty (round complete)
    const packsEmpty = playersList.every(p => !p.remainingPassedPack || p.remainingPassedPack.length === 0);

    if (packsEmpty) {
        // Round Complete! Move to next round or finish draft
        const currentRound = room.currentRound || 1;
        const totalRounds = room.totalRounds || room.packsPerPlayer || 3;

        if (currentRound >= totalRounds) {
            // All rounds finished: Draft Complete!
            await update(ref(db, getDraftDbPath(roomCode)), {
                status: 'complete',
                completedAt: Date.now()
            });
        } else {
            // Advance to next round
            const nextRound = currentRound + 1;
            const nextRoundPacks = room.roundPacks?.[`round_${nextRound}`] || {};
            const playerUpdates = {};

            playersList.forEach(p => {
                playerUpdates[`players/${p.id}/currentPack`] = nextRoundPacks[p.id] || [];
                playerUpdates[`players/${p.id}/hasPickedInRound`] = false;
                playerUpdates[`players/${p.id}/remainingPassedPack`] = null;
            });

            await update(ref(db, getDraftDbPath(roomCode)), {
                currentRound: nextRound,
                ...playerUpdates
            });
        }
    } else {
        // Pass packs to adjacent players!
        // Round 1: Pass Left (index + 1)
        // Round 2: Pass Right (index - 1)
        // Round 3: Pass Left (index + 1)
        const round = room.currentRound || 1;
        const passDirection = (round % 2 === 1) ? 1 : -1;
        const n = playersList.length;

        const playerUpdates = {};
        playersList.forEach((p, idx) => {
            const nextIdx = (idx + passDirection + n) % n;
            const targetPlayer = playersList[nextIdx];
            playerUpdates[`players/${targetPlayer.id}/currentPack`] = p.remainingPassedPack || [];
            playerUpdates[`players/${p.id}/hasPickedInRound`] = false;
            playerUpdates[`players/${p.id}/remainingPassedPack`] = null;
        });

        await update(ref(db, getDraftDbPath(roomCode)), playerUpdates);
    }
}

// Switch between Active Pick and Deck Workspace tabs
function switchDraftTab(tab) {
    localDraftTab = tab;
    const pickEl = document.getElementById('draftTabPick');
    const deckEl = document.getElementById('draftTabDeck');
    document.querySelectorAll('.draft-tab-btn').forEach(btn => btn.classList.remove('active'));

    if (tab === 'pick') {
        if (pickEl) pickEl.style.display = 'block';
        if (deckEl) deckEl.style.display = 'none';
        document.querySelectorAll('.draft-tab-btn')[0]?.classList.add('active');
    } else {
        if (pickEl) pickEl.style.display = 'none';
        if (deckEl) deckEl.style.display = 'block';
        document.querySelectorAll('.draft-tab-btn')[1]?.classList.add('active');
    }
}

// Render Deckbuilding Workspace
function renderDraftDeckWorkspace(pool, formatId) {
    const isCommander = formatId === 'commander_draft';
    const targetDeckSize = isCommander ? 60 : 40;

    // Calculate curve & color counts
    const curve = [0, 0, 0, 0, 0, 0, 0]; // 0, 1, 2, 3, 4, 5, 6+
    const colors = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

    pool.forEach(c => {
        const cmc = Math.min(6, Math.floor(c.cmc || 0));
        curve[cmc]++;

        const id = c.color_identity || [];
        if (id.length === 0) colors.C++;
        else id.forEach(col => { if (colors[col] !== undefined) colors[col]++; });
    });

    const totalLands = Object.values(addedBasicLands).reduce((a, b) => a + b, 0);
    const totalDeckCards = pool.length + totalLands;

    return `
        <div class="draft-deck-workspace">
            <!-- Top Curve & Analytics Banner -->
            <div class="booster-control-card deck-analytics-banner">
                <div class="analytics-col">
                    <span class="analytics-title">Deck Composition</span>
                    <span class="deck-size-counter ${totalDeckCards >= targetDeckSize ? 'valid' : 'under'}">
                        ${totalDeckCards} / ${targetDeckSize} Cards
                    </span>
                    <span class="deck-subtext">(${pool.length} Spells + ${totalLands} Basic Lands)</span>
                </div>

                <!-- Mana Curve Bars -->
                <div class="mana-curve-chart">
                    ${curve.map((count, cmc) => `
                        <div class="curve-bar-col">
                            <span class="curve-count">${count}</span>
                            <div class="curve-bar" style="height: ${Math.min(100, count * 14)}px;"></div>
                            <span class="curve-label">${cmc === 6 ? '6+' : cmc}</span>
                        </div>
                    `).join('')}
                </div>

                <!-- Land Adder Controls -->
                <div class="land-adder-box">
                    <span class="land-adder-title">Basic Lands (+/-)</span>
                    <div class="land-pills-row">
                        ${['W', 'U', 'B', 'R', 'G'].map(land => `
                            <div class="land-pill land-${land}">
                                <span class="land-sym">${land}</span>
                                <span class="land-num">${addedBasicLands[land]}</span>
                                <div class="land-btn-group">
                                    <button class="land-adjust-btn" onclick="window.addDraftBasicLand('${land}')">+</button>
                                    <button class="land-adjust-btn" onclick="window.removeDraftBasicLand('${land}')">-</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Export CTA -->
                <button class="select-btn export-deck-cta" onclick="window.copyDraftDecklist()">
                    📋 Copy Decklist
                </button>
            </div>

            <!-- Pool Cards Grid -->
            <div class="draft-pool-grid">
                ${pool.map((card, idx) => `
                    <div class="draft-card-item ${card.isFoil ? 'is-foil' : ''}" onclick="window.inspectDraftCard('${card.id}')">
                        <div class="draft-card-img-wrapper">
                            <img src="${card.image}" alt="${card.name}" loading="lazy" class="draft-card-img">
                            ${card.isFoil ? '<div class="booster-foil-overlay"></div><span class="booster-foil-tag">FOIL</span>' : ''}
                            <span class="booster-rarity-pill rarity-${card.rarity}">${card.rarity.toUpperCase()}</span>
                        </div>
                        <div class="draft-card-footer">
                            <div class="draft-card-name" title="${card.name}">${card.name}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// Basic land controls
function addDraftBasicLand(color) {
    if (addedBasicLands[color] !== undefined) addedBasicLands[color]++;
    const root = document.getElementById('boosterDraftRoot');
    if (root && currentDraftData) renderActiveDraftRoomView(currentDraftData);
}

function removeDraftBasicLand(color) {
    if (addedBasicLands[color] && addedBasicLands[color] > 0) addedBasicLands[color]--;
    const root = document.getElementById('boosterDraftRoot');
    if (root && currentDraftData) renderActiveDraftRoomView(currentDraftData);
}

// Copy Decklist to Clipboard
function copyDraftDecklist() {
    const lines = [];
    const landNames = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

    // Group cards by name
    const counts = {};
    myDraftedPool.forEach(c => {
        counts[c.name] = (counts[c.name] || 0) + 1;
    });

    Object.entries(counts).forEach(([name, count]) => {
        lines.push(`${count} ${name}`);
    });

    Object.entries(addedBasicLands).forEach(([sym, count]) => {
        if (count > 0) lines.push(`${count} ${landNames[sym]}`);
    });

    const deckText = lines.join('\n');
    navigator.clipboard.writeText(deckText).then(() => {
        if (draftUtils?.showToast) draftUtils.showToast("📋 Decklist copied to clipboard (Moxfield/MTGA format)!", false, 3000);
        else alert("Decklist copied to clipboard!");
    });
}

// Copy Invite Link Helper
function copyDraftInviteLink() {
    if (!currentDraftCode) return;
    const url = `${window.location.origin}${window.location.pathname}#draft-${currentDraftCode}`;
    navigator.clipboard.writeText(url).then(() => {
        if (draftUtils?.showToast) draftUtils.showToast("📋 Invite link copied to clipboard!", false, 3000);
        else alert(`Invite Link: ${url}`);
    });
}

// Leave Draft Room
function leaveDraftRoom() {
    if (roomListenerUnsub) {
        roomListenerUnsub();
        roomListenerUnsub = null;
    }
    currentDraftCode = null;
    currentDraftData = null;
    activePickSelections = [];
    window.location.hash = '';
    renderDraftHubUI();
}
