// Standalone Multiplayer Booster Draft Module
// Supports 7 limited formats:
// 1. Commander Booster Draft (3 packs, Pick 2, Pass L/R/L, 60-card deck)
// 2. Traditional Limited Draft (3 packs, Pick 1, Pass L/R/L, 40-card deck)
// 3. Sealed Deck (6 packs per player opened immediately into pool)
// 4. Grid Draft (2 players, 18 packs, 3x3 grid, pick row or column)
// 5. Winston Draft (2 players, 6 packs stack, 3 face-down piles, bluff & pass)
// 6. Winchester Draft (2 players, 6 packs, 4 face-up piles, open draft)
// 7. Rochester / Face-Up Open Draft (1 pack face-up, snake pick order)

import { db, auth } from './firebase-setup.js?v=8.6';
import { ref, get, set, update, onValue, off, remove } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { 
    fetchSetBoosterCards, 
    generateBoosterPack, 
    generateCollectorBoosterPack, 
    generateDraftBoosterPack,
    generatePlayBoosterPack,
    getSetBoosterEra,
    getCardPrice,
    formatCurrency,
    getSetBasicLands 
} from './booster-simulator.js?v=8.6';

// Realtime Database Path for Booster Drafts
const getDraftDbPath = (suffix = '') => suffix ? `booster_drafts/${suffix}` : 'booster_drafts';

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
let mainDeckUids = new Set();
let deckSortMode = 'cmc'; // 'cmc', 'color', 'rarity', 'type', 'name'
let hoverPreviewEnabled = localStorage.getItem('draftHoverPreview') !== 'false';
let deckCardSize = localStorage.getItem('draftCardSize') || 'normal'; // 'small', 'normal', 'large'
let deckLayoutMode = localStorage.getItem('draftDeckLayout') || 'columns'; // 'columns' or 'grid'
let isBotPickInProgress = false;
let liveDraftTimerInterval = null;
let currentTimerSecondsLeft = 0;
let lastTimerPackHash = null;

const BOT_NAMES = [
    'Urza Bot', 'Chandra Bot', 'Teferi Bot', 'Liliana Bot', 
    'Jace Bot', 'Nissa Bot', 'Nicol Bolas Bot', 'Karn Bot', 
    'Ajani Bot', 'Elspeth Bot', 'Gideon Bot', 'Sorin Bot',
    'Tamiyo Bot', 'Vivien Bot', 'Kaito Bot', 'Tyvar Bot'
];

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
    window.autoPickActiveCards = autoPickActiveCards;
    window.forceAutoPickPlayer = forceAutoPickPlayer;
    window.toggleDraftCardSelection = toggleDraftCardSelection;
    window.pickGridLine = pickGridLine;
    window.takeWinstonPile = takeWinstonPile;
    window.passWinstonPile = passWinstonPile;
    window.takeWinchesterPile = takeWinchesterPile;
    window.pickRochesterCard = pickRochesterCard;
    window.addDraftBasicLand = addDraftBasicLand;
    window.removeDraftBasicLand = removeDraftBasicLand;
    window.addCardToMainDeck = addCardToMainDeck;
    window.removeCardFromMainDeck = removeCardFromMainDeck;
    window.addAllCardsToDeck = addAllCardsToDeck;
    window.clearMainDeck = clearMainDeck;
    window.setDeckSortMode = setDeckSortMode;
    window.setDeckCardSize = setDeckCardSize;
    window.setDeckLayoutMode = setDeckLayoutMode;
    window.toggleHoverPreview = toggleHoverPreview;
    window.autoAddBasicLands = autoAddBasicLands;
    window.addRecommendedLands = addRecommendedLands;
    window.highlightDeckDoctorCard = highlightDeckDoctorCard;
    window.addBotToDraft = addBotToDraft;
    window.fillDraftWithBots = fillDraftWithBots;
    window.removeBotFromDraft = removeBotFromDraft;
    window.clearAllBotsFromDraft = clearAllBotsFromDraft;
    window.copyDraftDecklist = copyDraftDecklist;
    window.compareDraftWithCollection = async () => {
        playSound('sfx-click');
        const deckText = await buildDecklistText();
        if (!deckText || !deckText.trim()) {
            return showToast("No drafted deck found to compare.", true);
        }
        if (window.openCollectionTab) {
            window.openCollectionTab('deck', { preloadDeck: deckText });
            showToast("Drafted deck transferred to Deck Comparator!", false, 3000, true);
        } else {
            showToast("Collection tool is loading, please try again in a second.", true);
        }
    };
    window.inspectDraftCard = (cardIdentifier) => {
        if (window.openCardInspector) {
            const foundCard = myDraftedPool.find(c => c.id === cardIdentifier || c.name === cardIdentifier || c.uid === cardIdentifier) || cardIdentifier;
            window.openCardInspector(foundCard);
        }
    };

    // Setup global floating card hover preview tooltip
    let previewEl = document.getElementById('floatingCardPreview');
    if (!previewEl) {
        previewEl = document.createElement('div');
        previewEl.id = 'floatingCardPreview';
        previewEl.innerHTML = '<img id="floatingCardPreviewImg" src="" alt="Card Preview" />';
        document.body.appendChild(previewEl);
    }

    let previewRafId = null;
    window.addEventListener('mousemove', (e) => {
        if (!hoverPreviewEnabled) {
            if (previewEl.style.display !== 'none') previewEl.style.display = 'none';
            return;
        }

        const cardItem = e.target.closest('.draft-card-item');
        if (!cardItem) {
            if (previewEl.style.display !== 'none') previewEl.style.display = 'none';
            return;
        }

        const clientX = e.clientX;
        const clientY = e.clientY;

        if (previewRafId) cancelAnimationFrame(previewRafId);
        previewRafId = requestAnimationFrame(() => {
            const img = cardItem.querySelector('.draft-card-img') || cardItem.querySelector('img');
            const imgSrc = cardItem.getAttribute('data-preview-img') || img?.src;
            if (!imgSrc || imgSrc.includes('card_back')) {
                if (previewEl.style.display !== 'none') previewEl.style.display = 'none';
                return;
            }

            const previewImg = document.getElementById('floatingCardPreviewImg');
            if (previewImg && previewImg.src !== imgSrc) {
                previewImg.src = imgSrc;
            }

            if (previewEl.style.display !== 'block') previewEl.style.display = 'block';

            const previewWidth = 320;
            const previewHeight = 448;
            let left = clientX - (previewWidth / 2);
            if (left < 10) left = 10;
            if (left + previewWidth > window.innerWidth - 10) left = window.innerWidth - previewWidth - 10;

            // Position above the cursor so user can still scroll/hover downwards freely
            let top = clientY - 15;
            if (clientY < previewHeight + 30) {
                // If cursor is near top of viewport, flip preview directly below cursor
                previewEl.style.transform = 'translateY(25px)';
            } else {
                // Normal position: directly above cursor
                previewEl.style.transform = 'translateY(-100%)';
            }

            previewEl.style.left = `${left}px`;
            previewEl.style.top = `${top}px`;
        });
    }, { passive: true });

    // Hash navigation listener (e.g. #draft-ABCD)
    const checkHash = () => {
        const hash = window.location.hash || '';
        if (hash.startsWith('#draft-')) {
            const code = hash.replace('#draft-', '').toUpperCase().trim();
            if (code && code !== currentDraftCode) {
                setTimeout(() => window.openBoosterDraftHub(code), 100);
            }
        } else if (hash === '#booster-draft' || hash === '#view-booster-draft') {
            if (!currentDraftCode) {
                setTimeout(() => window.openBoosterDraftHub(), 100);
            }
        }
    };

    window.addEventListener('hashchange', checkHash);
    checkHash();

    // Dynamically update draft set selection when Scryfall live sets are ready
    window.addEventListener('scryfallSetsLoaded', (e) => {
        const quickContainer = document.getElementById('draftQuickSets');
        const input = document.getElementById('draftSetInput');
        const datalist = document.getElementById('draftSetDatalist');
        const sets = e.detail?.boosterSets || (window.boosterSets || (window.scryfallSets || [])).filter(s => s.set_type !== 'commander');
        const released = e.detail?.releasedSets || sets.filter(s => new Date(s.released_at) <= new Date() && s.card_count > 40);
        const newest = e.detail?.newestSet || released[0];

        if (datalist && sets.length > 0) {
            datalist.innerHTML = sets.map(s => `<option value="${s.name} (${s.code.toUpperCase()})"></option>`).join('');
        }
        if (quickContainer && released.length > 0) {
            const top = released.slice(0, 6);
            quickContainer.innerHTML = top.map((s, idx) => `
                <button type="button" class="quick-set-chip ${idx === 0 ? 'active' : ''}" onclick="window.selectDraftQuickSet('${s.code}', this)">
                    ${s.name.split(':')[0]} (${s.code.toUpperCase()})
                </button>
            `).join('');
        }
        if (input && newest && (!input.value || input.value.includes('Duskmourn'))) {
            input.value = `${newest.name} (${newest.code.toUpperCase()})`;
        }
    });
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

// Get current player identity (with multi-tab testing support and session consistency)
function getPlayerIdentity() {
    const user = auth.currentUser;
    const cachedName = localStorage.getItem('playerName') || 'Challenger';

    // Support tab-level guest ID for local 2-player testing in different tabs
    let tabGuestId = null;
    try {
        tabGuestId = sessionStorage.getItem('draftTabPlayerId');
    } catch (e) {}

    let id = null;
    if (user && user.uid) {
        id = user.uid;
    } else if (tabGuestId) {
        id = tabGuestId;
    } else {
        const localGuestId = localStorage.getItem('guestPlayerId') || localStorage.getItem('playerId');
        if (localGuestId) {
            id = localGuestId;
        } else {
            id = 'guest_' + Math.random().toString(36).substr(2, 9);
            try { localStorage.setItem('guestPlayerId', id); } catch (e) {}
        }
    }

    try {
        if (!sessionStorage.getItem('draftTabPlayerId')) {
            sessionStorage.setItem('draftTabPlayerId', id);
        }
    } catch (e) {}

    return {
        id,
        name: cachedName
    };
}

// Resilient player data lookup in a draft room snapshot
function getDraftPlayerData(room, targetPlayer = null) {
    if (!room || !room.players) return { id: null, name: 'Challenger', pool: [], ready: true };
    const player = targetPlayer || getPlayerIdentity();
    const pid = player.id;
    const playersMap = room.players;

    // 1. Direct key match
    if (pid && playersMap[pid]) {
        return { ...playersMap[pid], id: pid };
    }

    const list = Object.entries(playersMap);

    // 2. Direct property match by id or uid
    const idMatch = list.find(([k, p]) => (p.id && p.id === pid) || (p.uid && p.uid === pid));
    if (idMatch) {
        return { ...idMatch[1], id: idMatch[0] };
    }

    // 3. Name match
    if (player.name && player.name !== 'Challenger') {
        const nameMatch = list.find(([k, p]) => p.name === player.name);
        if (nameMatch) {
            return { ...nameMatch[1], id: nameMatch[0] };
        }
    }

    // 4. Role match (if exactly 2 players or host flag)
    const isHostUser = room.hostId === pid;
    if (isHostUser) {
        const hostEntry = list.find(([k, p]) => p.isHost || k === room.hostId);
        if (hostEntry) return { ...hostEntry[1], id: hostEntry[0] };
    } else if (list.length === 2) {
        const nonHostEntry = list.find(([k, p]) => !p.isHost && k !== room.hostId);
        if (nonHostEntry) return { ...nonHostEntry[1], id: nonHostEntry[0] };
    }

    return { id: pid, name: player.name || 'Challenger', pool: [], ready: true };
}

// Deterministically ordered draft players list
function getDraftPlayersList(room) {
    if (!room || !room.players) return [];
    if (Array.isArray(room.playerOrder) && room.playerOrder.length > 0) {
        const list = room.playerOrder.map(pid => {
            const p = room.players[pid];
            return p ? { ...p, id: pid } : null;
        }).filter(Boolean);
        if (list.length > 0) return list;
    }
    return Object.entries(room.players).map(([key, val]) => ({
        ...val,
        id: val.id || key
    })).sort((a, b) => {
        if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
        return (a.joinedAt || 0) - (b.joinedAt || 0) || (a.id || '').localeCompare(b.id || '');
    });
}

// Normalize 3x3 grid slots (safely handles sparse Firebase objects, nulls, and picked markers)
function normalizeGrid(rawGrid) {
    if (!rawGrid) return Array(9).fill(null);
    const grid = [];
    for (let i = 0; i < 9; i++) {
        const card = rawGrid[i];
        if (!card || card === false || card.picked) {
            grid.push(null);
        } else {
            grid.push(card);
        }
    }
    return grid;
}

// Render Initial Draft Hub UI (Host vs Join)
function renderDraftHubUI() {
    const root = document.getElementById('boosterDraftRoot');
    if (!root) return;

    const sets = window.scryfallSets || [];
    const player = getPlayerIdentity();
    const today = new Date();
    const releasedSets = sets.filter(s => new Date(s.released_at) <= today && s.card_count > 40);
    const defaultSet = window.latestReleasedSet || releasedSets[0] || { code: 'dsk', name: 'Duskmourn: House of Horror' };
    const topDraftSets = releasedSets.length > 0 ? releasedSets.slice(0, 6) : [
        { code: 'dsk', name: 'Duskmourn' },
        { code: 'blb', name: 'Bloomburrow' },
        { code: 'mh3', name: 'MH3' },
        { code: 'cmm', name: 'Cmdr Masters' },
        { code: 'clb', name: "Baldur's Gate" },
        { code: 'ltr', name: 'LotR' }
    ];

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
                            <input type="text" id="draftSetInput" list="draftSetDatalist" placeholder="${defaultSet.name} (${defaultSet.code.toUpperCase()})" autocomplete="off" value="${defaultSet.name} (${defaultSet.code.toUpperCase()})">
                            <datalist id="draftSetDatalist">
                                ${sets.map(s => `<option value="${s.name} (${s.code.toUpperCase()})"></option>`).join('')}
                            </datalist>
                        </div>
                        <!-- Quick Set Chips -->
                        <div class="booster-quick-sets" id="draftQuickSets">
                            ${topDraftSets.map((s, idx) => `
                                <button type="button" class="quick-set-chip ${idx === 0 ? 'active' : ''}" onclick="window.selectDraftQuickSet('${s.code}', this)">
                                    ${s.name.split(':')[0]} (${s.code.toUpperCase()})
                                </button>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Booster Edition Switch -->
                    <div class="booster-field-group" style="margin-top: 15px;">
                        <label class="booster-field-label"><span>✨ Booster Type:</span></label>
                        <div class="booster-segmented-switch">
                            <label class="segmented-option">
                                <input type="radio" name="draftBoosterEdition" id="draftEditionPlay" value="play" checked>
                                <span class="segmented-pill" id="draftStandardPillLabel">Play / Draft Booster</span>
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

    window.updateDraftEditionPillLabel = (rawOrCode = null) => {
        const input = document.getElementById('draftSetInput');
        const pill = document.getElementById('draftStandardPillLabel');
        if (!pill) return;
        const raw = rawOrCode || input?.value || 'dsk';
        const match = raw.match(/\(([A-Za-z0-9]+)\)$/);
        const code = match ? match[1].toLowerCase() : raw.trim().toLowerCase().substring(0, 5);
        const era = getSetBoosterEra(code);
        if (era === 'play_era') {
            pill.textContent = '🎮 Play Booster (14 Cards)';
        } else {
            pill.textContent = '⚔️ Draft Booster (15 Cards)';
        }
    };

    window.selectDraftQuickSet = (code, btn) => {
        document.querySelectorAll('#draftQuickSets .quick-set-chip').forEach(c => c.classList.remove('active'));
        if (btn) btn.classList.add('active');
        else if (typeof event !== 'undefined' && event?.target) event.target.classList.add('active');
        const sets = window.scryfallSets || [];
        const s = sets.find(item => item.code.toLowerCase() === code.toLowerCase());
        const input = document.getElementById('draftSetInput');
        if (input) {
            input.value = s ? `${s.name} (${s.code.toUpperCase()})` : code.toUpperCase();
        }
        window.updateDraftEditionPillLabel(code);
    };

    const draftInputEl = document.getElementById('draftSetInput');
    if (draftInputEl && !draftInputEl.dataset.listenerBound) {
        draftInputEl.dataset.listenerBound = 'true';
        draftInputEl.addEventListener('input', () => window.updateDraftEditionPillLabel());
    }
    window.updateDraftEditionPillLabel();
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

    const era = getSetBoosterEra(setObj);
    const resolvedPackEdition = isCollector ? 'collector' : (era === 'play_era' ? 'play' : 'draft');

    const player = getPlayerIdentity();
    const roomCode = generateRoomCode();

    const roomPayload = {
        code: roomCode,
        format: formatId,
        setCode: setObj.code.toLowerCase(),
        setName: setObj.name,
        packEdition: resolvedPackEdition,
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
        currentDraftCode = roomCode;
        currentDraftData = roomPayload;
        await set(ref(db, getDraftDbPath(roomCode)), roomPayload);
        window.history.pushState({ viewId: 'view-booster-draft', draftCode: roomCode }, '', `#draft-${roomCode}`);
        attachDraftRoomListener(roomCode);
    } catch (err) {
        currentDraftCode = null;
        currentDraftData = null;
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

        currentDraftCode = code;
        window.history.pushState({ viewId: 'view-booster-draft', draftCode: code }, '', `#draft-${code}`);
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

    let initialTickPassed = false;
    const unsubscribe = onValue(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
            if (initialTickPassed) {
                if (draftUtils?.showToast) draftUtils.showToast("The draft room has been closed.", true);
                leaveDraftRoom();
            }
            return;
        }

        initialTickPassed = true;
        currentDraftData = snapshot.val();
        renderActiveDraftRoomView(currentDraftData);
    }, (error) => {
        console.error("Draft room listener error:", error);
    });

    roomListenerUnsub = unsubscribe;
}

// Render Master Screen depending on Room Status
function renderActiveDraftRoomView(room) {
    const root = document.getElementById('boosterDraftRoot');
    if (!root || !room) return;

    if (room.status === 'lobby') {
        renderDraftLobbyView(room, root);
    } else if (room.status === 'drafting') {
        renderDraftActiveSessionView(room, root);
        const player = getPlayerIdentity();
        if (room.hostId === player.id) {
            checkAndExecuteBotPicks(room);
        }
    } else if (room.status === 'complete') {
        renderDraftDeckbuildingView(room, root);
    }
}

// Render Draft Lobby (Waiting Room & Host Settings)
function renderDraftLobbyView(room, root) {
    const player = getPlayerIdentity();
    const isHost = room.hostId === player.id;
    const playersList = getDraftPlayersList(room);
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
                    Booster: <strong>${room.packEdition === 'collector' ? '✨ Collector Booster' : (room.packEdition === 'draft' ? '⚔️ Draft Booster' : '🎮 Play Booster')}</strong> • 
                    Packs/Player: <strong>${room.packsPerPlayer}</strong>
                </p>
            </div>

            <!-- Players Roster -->
            <div class="booster-control-card draft-roster-card">
                <div class="roster-header-row">
                    <h3 class="roster-title">👥 Challengers Assembled (${playersList.length}/${formatConfig.maxPlayers}):</h3>
                    <button class="copy-invite-btn" onclick="window.copyDraftInviteLink()">📋 Copy Invite Link</button>
                </div>

                ${isHost ? `
                    <div class="lobby-bot-actions-row">
                        <span class="bot-control-label">🤖 Practice / Solo Bots:</span>
                        <button type="button" class="secondary-btn btn-compact" onclick="window.addBotToDraft()">
                            + Add 1 Bot Drafter
                        </button>
                        <button type="button" class="secondary-btn btn-compact" onclick="window.fillDraftWithBots()">
                            Fill Pod (${formatConfig.maxPlayers || 8} Players)
                        </button>
                        ${playersList.some(p => p.isBot) ? `
                            <button type="button" class="secondary-btn btn-compact btn-danger-soft" onclick="window.clearAllBotsFromDraft()">
                                Remove All Bots
                            </button>
                        ` : ''}
                    </div>
                ` : ''}

                <div class="draft-player-roster-grid">
                    ${playersList.map(p => `
                        <div class="draft-player-card ${p.id === player.id ? 'is-me' : ''} ${p.isBot ? 'is-bot' : ''}">
                            <div class="player-avatar-circle ${p.isBot ? 'bot-avatar' : ''}">
                                ${p.isHost ? '👑' : (p.isBot ? '🤖' : '👤')}
                            </div>
                            <div class="player-details">
                                <span class="player-name">${p.name} ${p.id === player.id ? '(You)' : ''}</span>
                                <span class="player-role">${p.isHost ? 'Host' : (p.isBot ? 'Bot Drafter' : 'Challenger')}</span>
                            </div>
                            ${(isHost && p.isBot) ? `
                                <button type="button" class="remove-bot-chip-btn" onclick="window.removeBotFromDraft('${p.id}')" title="Remove Bot">✕</button>
                            ` : ''}
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

// Detect functional limited roles from card metadata and oracle text
export function detectCardRole(card) {
    if (!card) return { isBomb: false, isRemoval: false, isDraw: false, isFixing: false, isCreature: false, tags: [] };
    const type = (card.type_line || '').toLowerCase();
    const text = (card.oracle_text || '').toLowerCase();
    const isCreature = type.includes('creature');
    const isPlaneswalker = type.includes('planeswalker');
    const isLand = type.includes('land');

    const removalRegex = /\b(destroy\s+target|exile\s+target|deals?\s+\d+\s+damage\s+to\s+(any\s+target|target\s+creature|target\s+planeswalker|target\s+player)|counter\s+target|target\s+creature\s+gets\s+-[0-9Xx]\/|fights?\s+target|deals\s+damage\s+equal\s+to\s+its\s+power|return\s+target\s+(nonland\s+)?permanent\s+to\s+its\s+owner's\s+hand)\b/i;
    const isRemoval = removalRegex.test(text);

    const drawRegex = /\b(draw\s+(a|[0-9]+)\s+cards?|draws?\s+a\s+card|look\s+at\s+the\s+top\s+[0-9]+\s+cards|investigate)\b/i;
    const isDraw = drawRegex.test(text);

    const fixingRegex = /\b(search\s+your\s+library\s+for\s+a\s+(basic\s+land|land)|add\s+\{[WUBRGwubrg]\}|add\s+one\s+mana\s+of\s+any|creates?\s+(a\s+)?treasure)\b/i;
    const isFixing = isLand || fixingRegex.test(text);

    const isBomb = (card.rarity === 'mythic' || card.rarity === 'rare') && (isPlaneswalker || (card.cmc >= 4 && isCreature) || text.includes('win the game') || text.includes('extra turn') || text.includes('each opponent') || text.includes('all creatures'));

    const tags = [];
    if (isBomb) tags.push({ label: '💣 Bomb', type: 'bomb' });
    if (isRemoval) tags.push({ label: '⚡ Removal', type: 'removal' });
    if (isDraw) tags.push({ label: '🔄 Draw', type: 'draw' });
    if (isFixing) tags.push({ label: '💎 Fixing', type: 'fixing' });

    return { isBomb, isRemoval, isDraw, isFixing, isCreature, tags };
}

// Calculate player's drafted pool colors & pips for live lane tracking
export function calculateDraftPoolColors(pool) {
    const counts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };

    (pool || []).forEach(c => {
        const colors = c.colors && c.colors.length > 0 ? c.colors : (c.color_identity || []);
        if (colors.length === 0) {
            counts.C++;
        } else {
            colors.forEach(col => {
                if (counts[col] !== undefined) counts[col]++;
            });
        }

        const cost = c.mana_cost || '';
        ['W', 'U', 'B', 'R', 'G'].forEach(col => {
            const matches = cost.match(new RegExp(col, 'g'));
            if (matches) pips[col] += matches.length;
        });
    });

    const sorted = Object.entries(pips)
        .filter(([_, cnt]) => cnt > 0)
        .sort((a, b) => b[1] - a[1]);

    const topColors = sorted.slice(0, 2).map(([col]) => col);

    const pairNames = {
        'W,U': 'Azorius (W/U)', 'U,W': 'Azorius (W/U)',
        'U,B': 'Dimir (U/B)', 'B,U': 'Dimir (U/B)',
        'B,R': 'Rakdos (B/R)', 'R,B': 'Rakdos (B/R)',
        'R,G': 'Gruul (R/G)', 'G,R': 'Gruul (R/G)',
        'G,W': 'Selesnya (G/W)', 'W,G': 'Selesnya (G/W)',
        'W,B': 'Orzhov (W/B)', 'B,W': 'Orzhov (W/B)',
        'U,R': 'Izzet (U/R)', 'R,U': 'Izzet (U/R)',
        'B,G': 'Golgari (B/G)', 'G,B': 'Golgari (B/G)',
        'R,W': 'Boros (R/W)', 'W,R': 'Boros (R/W)',
        'G,U': 'Simic (G/U)', 'U,G': 'Simic (G/U)'
    };

    let laneDescription = 'Open Lane';
    if (topColors.length === 2 && sorted[0][1] >= 2) {
        const key = topColors.join(',');
        laneDescription = pairNames[key] || `${topColors.join('/')} Pair`;
    } else if (topColors.length === 1 && sorted[0][1] >= 2) {
        const colorNames = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
        laneDescription = `Mono-${colorNames[topColors[0]] || topColors[0]}`;
    }

    return { counts, pips, topColors, laneDescription, totalCards: (pool || []).length };
}

// Get signal indicator for a card in the pack given player's pool colors
export function getCardColorLaneStatus(card, userPoolColors) {
    const cardColors = card.colors && card.colors.length > 0 ? card.colors : (card.color_identity || []);
    if (cardColors.length === 0) {
        return { status: 'neutral', label: '⚙️ Colorless', class: 'lane-neutral' };
    }
    const topColors = userPoolColors.topColors || [];
    if (topColors.length === 0 || userPoolColors.totalCards < 3) {
        return { status: 'open', label: '🌟 Open', class: 'lane-open' };
    }
    const matchesAll = cardColors.every(c => topColors.includes(c));
    const matchesAny = cardColors.some(c => topColors.includes(c));

    if (matchesAll) {
        return { status: 'on_color', label: '🎯 On-Color', class: 'lane-on-color' };
    } else if (matchesAny) {
        return { status: 'splash', label: '💧 Partial Splash', class: 'lane-splash' };
    } else {
        return { status: 'off_color', label: '⚠️ Off-Color', class: 'lane-off-color' };
    }
}

// Helper to render stylized mana symbols
function formatManaCostSymbols(manaCost) {
    if (!manaCost) return '';
    const symbols = manaCost.match(/\{[^}]+\}/g) || [];
    if (symbols.length === 0) return draftUtils?.sanitizeHTML ? draftUtils.sanitizeHTML(manaCost) : manaCost;
    return symbols.map(s => {
        const inner = s.replace(/[{}]/g, '');
        return `<span class="mana-symbol-badge ms-${inner.toLowerCase()}">${inner}</span>`;
    }).join('');
}

// AI Bot Management Functions
async function addBotToDraft() {
    if (!currentDraftData || !currentDraftCode) return;
    const room = currentDraftData;
    const formatConfig = DRAFT_FORMATS[room.format] || DRAFT_FORMATS.commander_draft;
    const playersList = getDraftPlayersList(room);
    const maxPlayers = formatConfig.maxPlayers || 8;

    if (playersList.length >= maxPlayers) {
        if (draftUtils?.showToast) draftUtils.showToast(`Draft room is full (max ${maxPlayers} players).`, true);
        return;
    }

    const existingNames = new Set(playersList.map(p => p.name));
    const availableName = BOT_NAMES.find(n => !existingNames.has(n)) || `Bot Drafter ${playersList.length + 1}`;
    const botId = `bot_${Math.random().toString(36).substring(2, 9)}`;

    await update(ref(db, `${getDraftDbPath(currentDraftCode)}/players/${botId}`), {
        id: botId,
        name: availableName,
        isBot: true,
        isHost: false,
        joinedAt: Date.now()
    });

    if (draftUtils?.playSound) draftUtils.playSound('sfx-click');
    if (draftUtils?.showToast) draftUtils.showToast(`🤖 ${availableName} joined the draft!`, false, 2000);
}

async function fillDraftWithBots() {
    if (!currentDraftData || !currentDraftCode) return;
    const room = currentDraftData;
    const formatConfig = DRAFT_FORMATS[room.format] || DRAFT_FORMATS.commander_draft;
    const playersList = getDraftPlayersList(room);
    const targetCount = formatConfig.maxPlayers || 8;
    const needed = targetCount - playersList.length;

    if (needed <= 0) {
        if (draftUtils?.showToast) draftUtils.showToast(`Draft room is already full!`, true);
        return;
    }

    const existingNames = new Set(playersList.map(p => p.name));
    const updates = {};
    let addedCount = 0;

    for (const name of BOT_NAMES) {
        if (addedCount >= needed) break;
        if (!existingNames.has(name)) {
            const botId = `bot_${Math.random().toString(36).substring(2, 9)}`;
            updates[`players/${botId}`] = {
                id: botId,
                name: name,
                isBot: true,
                isHost: false,
                joinedAt: Date.now() + addedCount
            };
            existingNames.add(name);
            addedCount++;
        }
    }

    if (addedCount > 0) {
        await update(ref(db, getDraftDbPath(currentDraftCode)), updates);
        if (draftUtils?.playSound) draftUtils.playSound('sfx-choose');
        if (draftUtils?.showToast) draftUtils.showToast(`Added ${addedCount} bot drafter(s) to fill pod!`, false, 2500);
    }
}

async function removeBotFromDraft(botId) {
    if (!currentDraftCode) return;
    await remove(ref(db, `${getDraftDbPath(currentDraftCode)}/players/${botId}`));
    if (draftUtils?.playSound) draftUtils.playSound('sfx-click');
}

async function clearAllBotsFromDraft() {
    if (!currentDraftData || !currentDraftCode) return;
    const botIds = Object.values(currentDraftData.players || {})
        .filter(p => p.isBot)
        .map(p => p.id);
    
    if (botIds.length === 0) return;
    const updates = {};
    botIds.forEach(id => {
        updates[`players/${id}`] = null;
    });
    await update(ref(db, getDraftDbPath(currentDraftCode)), updates);
    if (draftUtils?.playSound) draftUtils.playSound('sfx-click');
    if (draftUtils?.showToast) draftUtils.showToast(`Cleared all bots.`, false, 2000);
}

function botChoosePicks(botPlayer, pack, picksNeeded, format) {
    if (!pack || pack.length === 0) return [];
    if (pack.length <= picksNeeded) return [...pack];

    const pool = botPlayer.pool || [];
    const poolColors = calculateDraftPoolColors(pool);
    const topColors = poolColors.topColors || [];

    const scoredCards = pack.map((card, idx) => {
        let score = 0;
        if (card.rarity === 'mythic') score += 4.5;
        else if (card.rarity === 'rare') score += 3.5;
        else if (card.rarity === 'uncommon') score += 2.0;
        else score += 1.0;

        const role = detectCardRole(card);
        if (role.isRemoval) score += 2.5;
        if (role.isBomb) score += 2.2;
        if (role.isDraw) score += 1.4;
        if (role.isFixing) score += 1.2;

        const cardColors = card.colors && card.colors.length > 0 ? card.colors : (card.color_identity || []);
        if (cardColors.length === 0) {
            score += 1.0;
        } else if (topColors.length > 0 && pool.length >= 3) {
            const hasPrimary = topColors[0] && cardColors.includes(topColors[0]);
            const hasSecondary = topColors[1] && cardColors.includes(topColors[1]);
            if (hasPrimary && hasSecondary) score += 4.0;
            else if (hasPrimary || hasSecondary) score += 2.5;
            else score -= 3.0; // Off-color penalty
        }

        const cmc = Math.floor(getCardCmc(card));
        if (cmc === 2 || cmc === 3) score += 0.8;

        return { card, idx, score };
    });

    scoredCards.sort((a, b) => b.score - a.score);
    return scoredCards.slice(0, picksNeeded).map(item => item.card);
}

async function checkAndExecuteBotPicks(room) {
    if (!room || room.status !== 'drafting' || isBotPickInProgress) return;
    const roomCode = room.code;
    const players = room.players || {};
    const botPlayers = Object.values(players).filter(p => p.isBot && !p.hasPickedInRound && p.currentPack && p.currentPack.length > 0);

    if (botPlayers.length === 0) return;

    isBotPickInProgress = true;
    try {
        const formatConfig = DRAFT_FORMATS[room.format] || DRAFT_FORMATS.commander_draft;
        const picksNeeded = formatConfig.picksPerTurn || 1;
        const updates = {};

        for (const bot of botPlayers) {
            const pack = bot.currentPack || [];
            const numToPick = Math.min(picksNeeded, pack.length);
            const chosenCards = botChoosePicks(bot, pack, numToPick, room.format);
            const chosenNames = chosenCards.map(c => c.name);

            const remainingPack = [];
            const pickedList = [];
            pack.forEach(card => {
                if (pickedList.length < numToPick && chosenNames.includes(card.name)) {
                    pickedList.push(card);
                } else {
                    remainingPack.push(card);
                }
            });

            const currentPool = bot.pool || [];
            const updatedPool = [...currentPool, ...pickedList];

            updates[`players/${bot.id}/pool`] = updatedPool;
            updates[`players/${bot.id}/hasPickedInRound`] = true;
            updates[`players/${bot.id}/remainingPassedPack`] = remainingPack;
        }

        if (Object.keys(updates).length > 0) {
            await update(ref(db, getDraftDbPath(roomCode)), updates);
            await checkAndPassPacksAroundTable(roomCode);
        }
    } catch (e) {
        console.error("Error executing bot picks:", e);
    } finally {
        isBotPickInProgress = false;
    }
}

// Helper to calculate or parse card converted mana cost (CMC)
function getCardCmc(card) {
    if (typeof card?.cmc === 'number') return card.cmc;
    if (!card?.mana_cost) return 0;
    const matches = card.mana_cost.match(/\{([^}]+)\}/g) || [];
    let total = 0;
    matches.forEach(m => {
        const inner = m.replace(/[{}]/g, '');
        const num = parseInt(inner, 10);
        if (!isNaN(num)) total += num;
        else if (['W', 'U', 'B', 'R', 'G', 'C'].includes(inner)) total += 1;
        else if (inner.includes('/')) total += 1;
        else if (inner === 'X') total += 0;
        else total += 1;
    });
    return total;
}

// Sanitize card object to strip undefineds and bulky metadata for Firebase Realtime Database
function sanitizeDraftCard(card) {
    if (!card) return null;
    const promoTypes = Array.isArray(card.promo_types) ? card.promo_types : [];
    const finishes = Array.isArray(card.finishes) ? card.finishes : [];
    const isSurgeFoil = Boolean(card.isSurgeFoil) || promoTypes.includes('surgefoil') || card.finish === 'surgefoil';
    const isFoilOnly = (finishes.length > 0 && !finishes.includes('nonfoil')) || isSurgeFoil;
    const isFoil = Boolean(card.isFoil) || isFoilOnly;

    return {
        id: String(card.id || Math.random().toString(36).substring(2, 9)),
        name: String(card.name || 'Unknown'),
        mana_cost: card.mana_cost || '',
        cmc: getCardCmc(card),
        type_line: card.type_line || '',
        oracle_text: card.oracle_text || '',
        rarity: card.rarity || 'common',
        isFoil: isFoil,
        isSurgeFoil: isSurgeFoil,
        specialTag: card.specialTag || (isSurgeFoil ? 'Surge Foil' : null),
        image: card.image || card.image_uris?.normal || 'card_back.webp',
        image_large: card.image_large || card.image_uris?.large || card.image || 'card_back.webp',
        prices: {
            usd: card.prices?.usd != null ? String(card.prices.usd) : (card.prices?.usd_foil != null ? String(card.prices.usd_foil) : '0'),
            usd_foil: card.prices?.usd_foil != null ? String(card.prices.usd_foil) : null,
            eur: card.prices?.eur != null ? String(card.prices.eur) : (card.prices?.eur_foil != null ? String(card.prices.eur_foil) : null),
            eur_foil: card.prices?.eur_foil != null ? String(card.prices.eur_foil) : null
        },
        color_identity: Array.isArray(card.color_identity) ? card.color_identity : [],
        colors: Array.isArray(card.colors) ? card.colors : [],
        set: card.set ? String(card.set).toLowerCase() : '',
        collector_number: card.collector_number != null ? String(card.collector_number) : ''
    };
}

// Start Draft Execution (Host Only)
async function startBoosterDraftHost() {
    if (!currentDraftData || !currentDraftCode) return;
    const btn = document.getElementById('startDraftBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>⏳ Preparing Scryfall Packs...</span>`;
    }

    try {
        // 1. Fetch authoritative room snapshot from Firebase to ensure all joined players are present
        const initialSnap = await get(ref(db, getDraftDbPath(currentDraftCode)));
        const room = initialSnap.exists() ? initialSnap.val() : currentDraftData;
        const formatConfig = DRAFT_FORMATS[room.format] || DRAFT_FORMATS.commander_draft;
        const currentPlayersList = getDraftPlayersList(room);

        if (formatConfig.minPlayers && currentPlayersList.length < formatConfig.minPlayers) {
            const minMsg = `${formatConfig.name} requires at least ${formatConfig.minPlayers} player(s). Currently joined: ${currentPlayersList.length}.`;
            if (draftUtils?.showToast) draftUtils.showToast(minMsg, true, 4000);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<span>⚡ START DRAFT ⚡</span>`;
            }
            return;
        }

        if (draftUtils?.showToast) draftUtils.showToast("Fetching cards & rolling packs...", false, 2000);

        // Fetch set cards
        const setData = await fetchSetBoosterCards(room.setCode);

        // 2. Re-read latest room state right after async Scryfall fetch so anyone joining during card load is included
        const finalSnap = await get(ref(db, getDraftDbPath(room.code)));
        const activeRoom = finalSnap.exists() ? finalSnap.val() : room;
        const playersList = getDraftPlayersList(activeRoom);
        const isCollector = activeRoom.packEdition === 'collector';
        const era = getSetBoosterEra(activeRoom.setCode || room.setCode);
        const isPlayBooster = activeRoom.packEdition === 'play' || era === 'play_era';
        const packsPerPlayer = activeRoom.packsPerPlayer || 3;

        // Contextual generator for draft functionality:
        // Strictly uses authentic 15-card Draft Boosters whenever Draft boosters existed!
        const generateDraftPackInstance = (packNum) => {
            if (isCollector) return generateCollectorBoosterPack(setData, packNum);
            if (isPlayBooster) return generatePlayBoosterPack(setData, packNum);
            return generateDraftBoosterPack(setData, packNum);
        };

        // Specialized handling per format
        if (activeRoom.format === 'sealed') {
            // Sealed: Open all packs for each player immediately into their pool
            const updatedPlayers = { ...(activeRoom.players || {}) };
            playersList.forEach(p => {
                let pool = [];
                for (let i = 1; i <= packsPerPlayer; i++) {
                    const pack = generateDraftPackInstance(i);
                    pool.push(...pack.map(sanitizeDraftCard));
                }
                const existingPlayer = updatedPlayers[p.id] || p;
                updatedPlayers[p.id] = {
                    ...existingPlayer,
                    pool: pool
                };
            });

            await update(ref(db, getDraftDbPath(activeRoom.code)), {
                status: 'complete',
                startedAt: Date.now(),
                players: updatedPlayers
            });

        } else if (activeRoom.format === 'grid_draft') {
            // Grid Draft: Prepare 18 packs dealt into 18 consecutive 3x3 grids
            let masterCards = [];
            for (let i = 1; i <= 18; i++) {
                const pack = generateDraftPackInstance(i);
                masterCards.push(...pack.slice(0, 9).map(sanitizeDraftCard));
            }

            const firstGrid = masterCards.splice(0, 9);
            const orderedPlayers = getDraftPlayersList(activeRoom);
            const playerOrder = orderedPlayers.map(p => p.id);
            const firstPickerId = playerOrder[0] || null;

            await update(ref(db, getDraftDbPath(activeRoom.code)), {
                status: 'drafting',
                startedAt: Date.now(),
                playerOrder,
                currentGridIndex: 1,
                totalGrids: 18,
                activePlayerIndex: 0,
                activePlayerId: firstPickerId,
                turnInGrid: 1,
                activeGrid: firstGrid,
                remainingCards: masterCards
            });

        } else if (activeRoom.format === 'winston_draft' || activeRoom.format === 'winchester_draft') {
            // Winston / Winchester: 6 packs shuffled into central stack
            let masterStack = [];
            for (let i = 1; i <= 6; i++) {
                const pack = generateDraftPackInstance(i);
                masterStack.push(...pack.map(sanitizeDraftCard));
            }

            // Shuffle stack
            for (let i = masterStack.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [masterStack[i], masterStack[j]] = [masterStack[j], masterStack[i]];
            }

            const orderedPlayers = getDraftPlayersList(activeRoom);
            const playerOrder = orderedPlayers.map(p => p.id);
            const firstPickerId = playerOrder[0] || null;

            if (activeRoom.format === 'winston_draft') {
                const pile1 = [masterStack.pop()];
                const pile2 = [masterStack.pop()];
                const pile3 = [masterStack.pop()];

                await update(ref(db, getDraftDbPath(activeRoom.code)), {
                    status: 'drafting',
                    startedAt: Date.now(),
                    playerOrder,
                    activePlayerIndex: 0,
                    activePlayerId: firstPickerId,
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

                await update(ref(db, getDraftDbPath(activeRoom.code)), {
                    status: 'drafting',
                    startedAt: Date.now(),
                    playerOrder,
                    activePlayerIndex: 0,
                    activePlayerId: firstPickerId,
                    pile1,
                    pile2,
                    pile3,
                    pile4,
                    drawStack: masterStack
                });
            }

        } else if (activeRoom.format === 'rochester_draft') {
            // Rochester Draft: Generate all packs face-up on table (total = players * packsPerPlayer)
            const totalPacks = playersList.length * packsPerPlayer;
            const allPacks = [];
            for (let i = 1; i <= totalPacks; i++) {
                const pack = generateDraftPackInstance(i);
                allPacks.push(pack.map(sanitizeDraftCard));
            }

            const firstPack = allPacks.shift() || [];
            await update(ref(db, getDraftDbPath(activeRoom.code)), {
                status: 'drafting',
                startedAt: Date.now(),
                packNumber: 1,
                totalPacks: totalPacks,
                packOpenedBy: 0,
                snakePickIndex: 0,
                activeRochesterPack: firstPack,
                rochesterPacks: allPacks
            });

        } else {
            // Standard / Commander Passing Drafts
            const roundPacks = {};
            for (let r = 1; r <= packsPerPlayer; r++) {
                roundPacks[`round_${r}`] = {};
                playersList.forEach(p => {
                    const pack = generateDraftPackInstance(r);
                    roundPacks[`round_${r}`][p.id] = pack.map(sanitizeDraftCard);
                });
            }

            // Set up initial round 1 state
            const updatedPlayers = { ...(activeRoom.players || {}) };
            playersList.forEach(p => {
                const existing = updatedPlayers[p.id] || p;
                updatedPlayers[p.id] = {
                    ...existing,
                    currentPack: roundPacks['round_1'][p.id] || [],
                    hasPickedInRound: false
                };
            });

            await update(ref(db, getDraftDbPath(activeRoom.code)), {
                status: 'drafting',
                startedAt: Date.now(),
                currentRound: 1,
                totalRounds: packsPerPlayer,
                roundPacks,
                players: updatedPlayers
            });
        }

        if (draftUtils?.playSound) draftUtils.playSound('sfx-reveal');
    } catch (err) {
        console.error("Failed to start draft:", err);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<span>⚡ START DRAFT ⚡</span>`;
        }
        const errMsg = err.message || "Failed to initialize draft packs";
        if (draftUtils?.showToast) draftUtils.showToast(`Failed to start draft: ${errMsg}`, true, 6000);
    }
}

// Render Active Drafting Session View
function renderDraftActiveSessionView(room, root) {
    const player = getPlayerIdentity();
    const playerData = getDraftPlayerData(room, player);
    const formatConfig = DRAFT_FORMATS[room.format] || DRAFT_FORMATS.commander_draft;
    myDraftedPool = (playerData.pool || []).map((c, idx) => {
        if (!c.uid) c.uid = `${c.id || 'card'}_${idx}_${c.name}`;
        return c;
    });

    const activePack = playerData.currentPack || [];
    let roundDisplay = `Round ${room.currentRound || 1} of ${room.totalRounds || room.packsPerPlayer}`;
    let tabPickLabel = `📦 Active Pick (${activePack.length} cards)`;

    if (room.format === 'grid_draft') {
        roundDisplay = `Grid ${room.currentGridIndex || 1} of ${room.totalGrids || 18}`;
        tabPickLabel = `▦ 3x3 Grid Draft`;
    } else if (room.format === 'winston_draft') {
        roundDisplay = `Stack: ${(room.drawStack || []).length} cards`;
        tabPickLabel = `🕵️ Winston Draft`;
    } else if (room.format === 'winchester_draft') {
        roundDisplay = `Stack: ${(room.drawStack || []).length} cards`;
        tabPickLabel = `🎯 Winchester Draft`;
    } else if (room.format === 'rochester_draft') {
        const totalP = room.totalPacks || (Object.keys(room.players || {}).length * 3);
        roundDisplay = `Pack ${room.packNumber || 1} of ${totalP}`;
        tabPickLabel = `👁️ Rochester Pack (${(room.activeRochesterPack || []).length})`;
    }

    root.innerHTML = `
        <div class="booster-draft-container">
            <!-- Draft Header & Tabs -->
            <div class="draft-active-header">
                <div class="draft-header-left">
                    <span class="draft-badge-pill">${formatConfig.icon} ${formatConfig.name}</span>
                    <span class="draft-round-tag">${roundDisplay}</span>
                </div>

                <!-- Tab Switcher (Active Pick vs. My Pool & Deck) -->
                <div class="draft-tab-switcher">
                    <button class="draft-tab-btn ${localDraftTab === 'pick' ? 'active' : ''}" onclick="window.switchDraftTab('pick')">
                        ${tabPickLabel}
                    </button>
                    <button class="draft-tab-btn ${localDraftTab === 'deck' ? 'active' : ''}" onclick="window.switchDraftTab('deck')">
                        🎴 My Pool (${myDraftedPool.length})
                    </button>
                </div>

                <div class="draft-header-right">
                    <button class="preview-toggle-btn ${hoverPreviewEnabled ? 'active' : ''}" onclick="window.toggleHoverPreview()" title="Turn floating card hover preview on or off">
                        ${hoverPreviewEnabled ? '👁️ Preview: ON' : '👁️ Preview: OFF'}
                    </button>
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

    initDraftPickTimer(room, playerData, activePack);
}

// Render Active Picking Arena
function renderDraftPickingArena(room, player, activePack, formatConfig) {
    if (room.format === 'grid_draft') {
        return renderGridDraftArena(room, player);
    }
    if (room.format === 'winston_draft') {
        return renderWinstonDraftArena(room, player);
    }
    if (room.format === 'winchester_draft') {
        return renderWinchesterDraftArena(room, player);
    }
    if (room.format === 'rochester_draft') {
        return renderRochesterDraftArena(room, player);
    }

    const picksNeeded = formatConfig.picksPerTurn || 1;
    const selectionsLeft = picksNeeded - activePickSelections.length;

    // Check if player already submitted pick and is waiting for pass
    const playerData = getDraftPlayerData(room, player);
    if (playerData.hasPickedInRound && activePack.length === 0) {
        return `
            <div class="draft-waiting-pass-card">
                <div class="waiting-icon">⏳</div>
                <h3>Picks Submitted!</h3>
                <p>Waiting for other players to complete their picks before passing packs...</p>
                <div class="waiting-player-status-row">
                    ${Object.values(room.players || {}).map(p => {
                        const isMeHost = playerData.isHost || player.isHost;
                        return `
                            <span class="player-pass-chip ${p.hasPickedInRound ? 'ready' : 'picking'}">
                                ${p.hasPickedInRound ? '✓' : '⏳'} ${p.name}
                                ${(!p.hasPickedInRound && isMeHost && !p.isBot) ? `<button type="button" class="mini-force-pick-btn" onclick="window.forceAutoPickPlayer('${p.id}')" title="Auto-pick for AFK player">⚡ Auto-pick</button>` : ''}
                            </span>
                        `;
                    }).join('')}
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

    // Calculate user's current draft pool colors and pips for live lane tracking
    const userPoolColors = calculateDraftPoolColors(playerData.pool || []);

    return `
        <div class="draft-arena-card">
            <!-- Live Color Lane & Signals Tracker (1.2) -->
            <div class="draft-lane-tracker-card">
                <div class="lane-header-row">
                    <div class="lane-title-group">
                        <span class="lane-title-icon">🎯</span>
                        <span class="lane-title-text">Draft Lane:</span>
                        <span class="lane-name-badge ${userPoolColors.topColors.length > 0 ? 'active' : ''}">${userPoolColors.laneDescription}</span>
                        <span class="lane-pool-count">(${userPoolColors.totalCards} cards drafted)</span>
                    </div>
                    <div class="lane-pips-row">
                        ${['W', 'U', 'B', 'R', 'G'].map(col => {
                            const count = userPoolColors.counts[col] || 0;
                            const pips = userPoolColors.pips[col] || 0;
                            const isPrimary = userPoolColors.topColors.includes(col);
                            const glyphs = { W: '☀️', U: '💧', B: '💀', R: '🔥', G: '🌲' };
                            return `
                                <span class="lane-pip-badge lane-pip-${col} ${isPrimary ? 'is-primary' : ''}" title="${col}: ${count} cards, ${pips} mana pips">
                                    <span class="glyph">${glyphs[col]}</span>
                                    <span class="count">${count}</span>
                                    <span class="pips">(${pips}p)</span>
                                </span>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>

            <div class="draft-arena-toolbar">
                <div class="pick-instruction">
                    ${picksNeeded > 1 
                        ? `Select <strong>${picksNeeded} cards</strong> to add to your pool (${selectionsLeft} remaining)` 
                        : `Select <strong>1 card</strong> to draft into your pool`}
                </div>
                ${(room.timerSeconds && room.timerSeconds > 0) ? `
                    <div class="pick-timer-badge ${currentTimerSecondsLeft <= 15 ? 'is-warning' : ''}" id="draftLiveTimerBadge">
                        ⏱️ <span id="draftTimerSecs">${currentTimerSecondsLeft || room.timerSeconds}</span>s
                    </div>
                ` : ''}
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
                    const laneStatus = getCardColorLaneStatus(card, userPoolColors);
                    const role = detectCardRole(card);
                    return `
                        <div class="draft-card-item ${isSelected ? 'is-selected-pick' : ''} ${card.isFoil ? 'is-foil' : ''}" 
                             data-preview-img="${card.image_large || card.image}"
                             onclick="window.toggleDraftCardSelection(${idx})">
                            <div class="draft-card-img-wrapper">
                                <img src="${card.image}" alt="${card.name}" loading="lazy" class="draft-card-img">
                                ${card.isFoil ? '<div class="booster-foil-overlay"></div><span class="booster-foil-tag">FOIL</span>' : ''}
                                <span class="booster-rarity-pill rarity-${card.rarity}">${card.rarity.toUpperCase()}</span>
                                <button type="button" class="inspect-mini-btn" onclick="event.stopPropagation(); window.inspectDraftCard('${card.id}')" title="Inspect 3D">🔍</button>
                            </div>
                            <div class="draft-card-signals">
                                <span class="signal-badge ${laneStatus.class}">${laneStatus.label}</span>
                                ${role.tags.map(t => `<span class="signal-badge badge-${t.type}">${t.label}</span>`).join('')}
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

// Render Grid Draft Arena (3x3 grid, row/col picks)
function renderGridDraftArena(room, player) {
    const playersList = getDraftPlayersList(room);
    const activePlayerIndex = room.activePlayerIndex || 0;
    const activePlayer = (room.activePlayerId && room.players?.[room.activePlayerId]) 
        ? { ...room.players[room.activePlayerId], id: room.activePlayerId }
        : (playersList[activePlayerIndex] || playersList[0]);
    const me = getDraftPlayerData(room, player);
    const isMyTurn = (room.activePlayerId && (room.activePlayerId === player.id || room.activePlayerId === me.id))
        || (activePlayer?.id === player.id || activePlayer?.id === me.id);
    const grid = normalizeGrid(room.activeGrid);
    const currentGridIndex = room.currentGridIndex || 1;
    const totalGrids = room.totalGrids || 18;
    const turnInGrid = room.turnInGrid || 1;

    const getCount = (indices) => indices.filter(i => {
        const card = grid[i];
        return card != null && !card.picked;
    }).length;
    const row0Count = getCount([0, 1, 2]);
    const row1Count = getCount([3, 4, 5]);
    const row2Count = getCount([6, 7, 8]);
    const col0Count = getCount([0, 3, 6]);
    const col1Count = getCount([1, 4, 7]);
    const col2Count = getCount([2, 5, 8]);

    return `
        <div class="draft-arena-card grid-draft-arena">
            <div class="draft-arena-toolbar">
                <div class="pick-instruction">
                    ${isMyTurn 
                        ? `<span class="turn-highlight">🎯 <strong>YOUR TURN!</strong> Pick any Row or Column (${turnInGrid === 1 ? 'Pick 1 of 2' : 'Pick 2 of 2'})</span>` 
                        : `<span>⏳ Waiting for <strong>${activePlayer?.name || 'opponent'}</strong> to pick a line...</span>`}
                </div>
                <div class="grid-status-badge">
                    Grid <strong>${currentGridIndex}</strong> of <strong>${totalGrids}</strong>
                </div>
            </div>

            <div class="grid-draft-board-layout">
                <!-- Column Select Buttons Header -->
                <div class="grid-col-buttons-row">
                    <div class="grid-corner-spacer"></div>
                    <button class="grid-pick-btn col-btn" ${isMyTurn && col0Count > 0 ? '' : 'disabled'} onclick="window.pickGridLine('col', 0)">
                        ⬇ Col 1 (${col0Count})
                    </button>
                    <button class="grid-pick-btn col-btn" ${isMyTurn && col1Count > 0 ? '' : 'disabled'} onclick="window.pickGridLine('col', 1)">
                        ⬇ Col 2 (${col1Count})
                    </button>
                    <button class="grid-pick-btn col-btn" ${isMyTurn && col2Count > 0 ? '' : 'disabled'} onclick="window.pickGridLine('col', 2)">
                        ⬇ Col 3 (${col2Count})
                    </button>
                </div>

                <!-- 3x3 Grid Rows with Side Pick Buttons -->
                ${[0, 1, 2].map(r => {
                    const rowCards = [grid[r * 3], grid[r * 3 + 1], grid[r * 3 + 2]];
                    const count = r === 0 ? row0Count : (r === 1 ? row1Count : row2Count);
                    return `
                        <div class="grid-board-row">
                            <button class="grid-pick-btn row-btn" ${isMyTurn && count > 0 ? '' : 'disabled'} onclick="window.pickGridLine('row', ${r})">
                                ➡ Row ${r + 1} (${count})
                            </button>
                            ${rowCards.map((card) => {
                                if (!card || card.picked) {
                                    return `
                                        <div class="grid-empty-slot">
                                            <span>Picked</span>
                                        </div>
                                    `;
                                }
                                const price = getCardPrice(card, 'usd');
                                return `
                                    <div class="draft-card-item grid-card ${card.isFoil ? 'is-foil' : ''}" data-preview-img="${card.image_large || card.image}">
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
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

// Handle Grid Draft Row/Col Pick
async function pickGridLine(type, index) {
    if (!currentDraftData || !currentDraftCode) return;
    const room = currentDraftData;
    const player = getPlayerIdentity();
    const playersList = getDraftPlayersList(room);
    const activePlayerIndex = room.activePlayerIndex || 0;
    const activePlayer = (room.activePlayerId && room.players?.[room.activePlayerId]) 
        ? { ...room.players[room.activePlayerId], id: room.activePlayerId }
        : (playersList[activePlayerIndex] || playersList[0]);
    const me = getDraftPlayerData(room, player);
    const effectivePlayerId = me.id || player.id;

    const isMyTurn = (room.activePlayerId && (room.activePlayerId === player.id || room.activePlayerId === me.id))
        || (activePlayer?.id === player.id || activePlayer?.id === me.id);

    if (!isMyTurn) return;

    const grid = normalizeGrid(room.activeGrid);
    const targetIndices = type === 'row' 
        ? [index * 3, index * 3 + 1, index * 3 + 2] 
        : [index, index + 3, index + 6];

    const pickedCards = [];
    targetIndices.forEach(idx => {
        const card = grid[idx];
        if (card != null && !card.picked) {
            pickedCards.push(card);
            grid[idx] = { picked: true };
        }
    });

    if (pickedCards.length === 0) return;

    if (draftUtils?.playSound) draftUtils.playSound('sfx-choose');

    const myPool = [...(me.pool || []), ...pickedCards];
    const turnInGrid = room.turnInGrid || 1;

    if (turnInGrid === 1) {
        const myIndex = playersList.findIndex(p => p.id === effectivePlayerId || p.id === player.id);
        const nextIndex = myIndex >= 0 ? (1 - myIndex) : (1 - activePlayerIndex);
        const nextPlayer = playersList[nextIndex] || playersList[1];
        const nextPlayerId = nextPlayer?.id || (room.playerOrder ? room.playerOrder[nextIndex] : null);

        await update(ref(db, getDraftDbPath(currentDraftCode)), {
            activeGrid: grid,
            turnInGrid: 2,
            activePlayerIndex: nextIndex,
            activePlayerId: nextPlayerId,
            [`players/${effectivePlayerId}/pool`]: myPool
        });
    } else {
        const currentGrid = room.currentGridIndex || 1;
        const totalGrids = room.totalGrids || 18;
        const rawRemaining = room.remainingCards;
        const remaining = Array.isArray(rawRemaining) 
            ? [...rawRemaining] 
            : Object.values(rawRemaining || {});

        if (currentGrid >= totalGrids || remaining.length < 9) {
            await update(ref(db, getDraftDbPath(currentDraftCode)), {
                status: 'complete',
                completedAt: Date.now(),
                [`players/${effectivePlayerId}/pool`]: myPool
            });
        } else {
            const nextGrid = remaining.splice(0, 9);
            const nextGridIndex = currentGrid + 1;
            const nextFirstPickerIndex = (nextGridIndex - 1) % Math.max(1, playersList.length);
            const nextFirstPicker = playersList[nextFirstPickerIndex];
            const nextFirstPickerId = nextFirstPicker?.id || (room.playerOrder ? room.playerOrder[nextFirstPickerIndex] : null);

            await update(ref(db, getDraftDbPath(currentDraftCode)), {
                currentGridIndex: nextGridIndex,
                turnInGrid: 1,
                activePlayerIndex: nextFirstPickerIndex,
                activePlayerId: nextFirstPickerId,
                activeGrid: nextGrid,
                remainingCards: remaining,
                [`players/${effectivePlayerId}/pool`]: myPool
            });
        }
    }
}

// Render Winston Draft Arena
function renderWinstonDraftArena(room, player) {
    const playersList = getDraftPlayersList(room);
    const activePlayerIndex = room.activePlayerIndex || 0;
    const activePlayer = (room.activePlayerId && room.players?.[room.activePlayerId]) 
        ? { ...room.players[room.activePlayerId], id: room.activePlayerId }
        : (playersList[activePlayerIndex] || playersList[0]);
    const me = getDraftPlayerData(room, player);
    const isMyTurn = (room.activePlayerId && (room.activePlayerId === player.id || room.activePlayerId === me.id))
        || (activePlayer?.id === player.id || activePlayer?.id === me.id);
    const currentPile = room.currentPileViewing || 1;
    const stack = room.drawStack || [];
    const p1 = room.pile1 || [];
    const p2 = room.pile2 || [];
    const p3 = room.pile3 || [];
    const piles = [p1, p2, p3];
    const viewingCards = piles[currentPile - 1] || [];

    return `
        <div class="draft-arena-card winston-draft-arena">
            <div class="draft-arena-toolbar">
                <div class="pick-instruction">
                    ${isMyTurn 
                        ? `<span class="turn-highlight">🕵️ <strong>YOUR TURN!</strong> Examining Pile ${currentPile} (${viewingCards.length} cards)</span>` 
                        : `<span>⏳ Waiting for <strong>${activePlayer?.name || 'opponent'}</strong> to choose...</span>`}
                </div>
                <div class="grid-status-badge">
                    Draw Stack: <strong>${stack.length}</strong> cards
                </div>
            </div>

            <div class="winston-piles-overview">
                ${[1, 2, 3].map(pNum => {
                    const count = piles[pNum - 1].length;
                    const isViewing = currentPile === pNum;
                    return `
                        <div class="winston-pile-card ${isViewing ? 'is-active-pile' : ''}">
                            <div class="pile-header">
                                <span class="pile-title">Pile ${pNum}</span>
                                <span class="pile-count">${count} cards</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>

            ${isMyTurn ? `
                <div class="winston-viewing-tray">
                    <div class="tray-header">
                        <h4>Cards inside Pile ${currentPile}:</h4>
                        <div class="tray-actions">
                            <button class="select-btn winston-take-btn" onclick="window.takeWinstonPile()">
                                ✓ Take Pile ${currentPile} (${viewingCards.length} cards)
                            </button>
                            <button class="secondary-btn winston-pass-btn" onclick="window.passWinstonPile()">
                                ✖ Pass Pile ${currentPile} ➔
                            </button>
                        </div>
                    </div>

                    <div class="draft-pack-grid winston-pack-grid">
                        ${viewingCards.map((card) => {
                            const price = getCardPrice(card, 'usd');
                            return `
                                <div class="draft-card-item ${card.isFoil ? 'is-foil' : ''}" data-preview-img="${card.image_large || card.image}">
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
            ` : `
                <div class="draft-waiting-pass-card">
                    <div class="waiting-icon">🕵️</div>
                    <h3>Opponent is Inspecting Pile ${currentPile}</h3>
                    <p>Opponent is deciding whether to draft Pile ${currentPile} or pass to the next pile.</p>
                </div>
            `}
        </div>
    `;
}

async function takeWinstonPile() {
    if (!currentDraftData || !currentDraftCode) return;
    const room = currentDraftData;
    const player = getPlayerIdentity();
    const playersList = getDraftPlayersList(room);
    const activePlayerIndex = room.activePlayerIndex || 0;
    const activePlayer = (room.activePlayerId && room.players?.[room.activePlayerId]) 
        ? { ...room.players[room.activePlayerId], id: room.activePlayerId }
        : (playersList[activePlayerIndex] || playersList[0]);
    const me = getDraftPlayerData(room, player);
    const effectivePlayerId = me.id || player.id;

    const isMyTurn = (room.activePlayerId && (room.activePlayerId === player.id || room.activePlayerId === me.id))
        || (activePlayer?.id === player.id || activePlayer?.id === me.id);

    if (!isMyTurn) return;

    const currentPile = room.currentPileViewing || 1;
    const piles = {
        pile1: [...(room.pile1 || [])],
        pile2: [...(room.pile2 || [])],
        pile3: [...(room.pile3 || [])]
    };
    const stack = [...(room.drawStack || [])];

    const takenCards = piles[`pile${currentPile}`];
    if (takenCards.length === 0) return;

    piles[`pile${currentPile}`] = stack.length > 0 ? [stack.pop()] : [];

    const myPool = [...(me.pool || []), ...takenCards];
    const totalRemaining = piles.pile1.length + piles.pile2.length + piles.pile3.length + stack.length;

    if (draftUtils?.playSound) draftUtils.playSound('sfx-choose');

    const myIndex = playersList.findIndex(p => p.id === effectivePlayerId || p.id === player.id);
    const nextIndex = myIndex >= 0 ? (1 - myIndex) : (1 - activePlayerIndex);
    const nextPlayer = playersList[nextIndex] || playersList[1];
    const nextPlayerId = nextPlayer?.id || (room.playerOrder ? room.playerOrder[nextIndex] : null);

    if (totalRemaining === 0) {
        await update(ref(db, getDraftDbPath(currentDraftCode)), {
            status: 'complete',
            completedAt: Date.now(),
            ...piles,
            drawStack: stack,
            [`players/${effectivePlayerId}/pool`]: myPool
        });
    } else {
        await update(ref(db, getDraftDbPath(currentDraftCode)), {
            ...piles,
            drawStack: stack,
            currentPileViewing: 1,
            activePlayerIndex: nextIndex,
            activePlayerId: nextPlayerId,
            [`players/${effectivePlayerId}/pool`]: myPool
        });
    }
}

async function passWinstonPile() {
    if (!currentDraftData || !currentDraftCode) return;
    const room = currentDraftData;
    const player = getPlayerIdentity();
    const playersList = getDraftPlayersList(room);
    const activePlayerIndex = room.activePlayerIndex || 0;
    const activePlayer = (room.activePlayerId && room.players?.[room.activePlayerId]) 
        ? { ...room.players[room.activePlayerId], id: room.activePlayerId }
        : (playersList[activePlayerIndex] || playersList[0]);
    const me = getDraftPlayerData(room, player);
    const effectivePlayerId = me.id || player.id;

    const isMyTurn = (room.activePlayerId && (room.activePlayerId === player.id || room.activePlayerId === me.id))
        || (activePlayer?.id === player.id || activePlayer?.id === me.id);

    if (!isMyTurn) return;

    const currentPile = room.currentPileViewing || 1;
    const piles = {
        pile1: [...(room.pile1 || [])],
        pile2: [...(room.pile2 || [])],
        pile3: [...(room.pile3 || [])]
    };
    const stack = [...(room.drawStack || [])];

    if (stack.length > 0) {
        piles[`pile${currentPile}`].push(stack.pop());
    }

    if (draftUtils?.playSound) draftUtils.playSound('sfx-click');

    const myIndex = playersList.findIndex(p => p.id === effectivePlayerId || p.id === player.id);
    const nextIndex = myIndex >= 0 ? (1 - myIndex) : (1 - activePlayerIndex);
    const nextPlayer = playersList[nextIndex] || playersList[1];
    const nextPlayerId = nextPlayer?.id || (room.playerOrder ? room.playerOrder[nextIndex] : null);

    if (currentPile < 3) {
        await update(ref(db, getDraftDbPath(currentDraftCode)), {
            ...piles,
            drawStack: stack,
            currentPileViewing: currentPile + 1
        });
    } else {
        let drawnCard = stack.length > 0 ? [stack.pop()] : [];
        const myPool = [...(me.pool || []), ...drawnCard];
        const totalRemaining = piles.pile1.length + piles.pile2.length + piles.pile3.length + stack.length;

        if (totalRemaining === 0) {
            await update(ref(db, getDraftDbPath(currentDraftCode)), {
                status: 'complete',
                completedAt: Date.now(),
                ...piles,
                drawStack: stack,
                [`players/${effectivePlayerId}/pool`]: myPool
            });
        } else {
            await update(ref(db, getDraftDbPath(currentDraftCode)), {
                ...piles,
                drawStack: stack,
                currentPileViewing: 1,
                activePlayerIndex: nextIndex,
                activePlayerId: nextPlayerId,
                [`players/${effectivePlayerId}/pool`]: myPool
            });
        }
    }
}

// Render Winchester Draft Arena (4 face-up piles)
function renderWinchesterDraftArena(room, player) {
    const playersList = getDraftPlayersList(room);
    const activePlayerIndex = room.activePlayerIndex || 0;
    const activePlayer = (room.activePlayerId && room.players?.[room.activePlayerId]) 
        ? { ...room.players[room.activePlayerId], id: room.activePlayerId }
        : (playersList[activePlayerIndex] || playersList[0]);
    const me = getDraftPlayerData(room, player);
    const isMyTurn = (room.activePlayerId && (room.activePlayerId === player.id || room.activePlayerId === me.id))
        || (activePlayer?.id === player.id || activePlayer?.id === me.id);
    const stack = room.drawStack || [];
    const p1 = room.pile1 || [];
    const p2 = room.pile2 || [];
    const p3 = room.pile3 || [];
    const p4 = room.pile4 || [];
    const piles = [p1, p2, p3, p4];

    return `
        <div class="draft-arena-card winchester-draft-arena">
            <div class="draft-arena-toolbar">
                <div class="pick-instruction">
                    ${isMyTurn 
                        ? `<span class="turn-highlight">🎯 <strong>YOUR TURN!</strong> Choose any pile to draft all of its face-up cards</span>` 
                        : `<span>⏳ Waiting for <strong>${activePlayer?.name || 'opponent'}</strong> to choose a pile...</span>`}
                </div>
                <div class="grid-status-badge">
                    Draw Stack: <strong>${stack.length}</strong> cards
                </div>
            </div>

            <div class="winchester-piles-grid">
                ${[1, 2, 3, 4].map(pNum => {
                    const cards = piles[pNum - 1] || [];
                    return `
                        <div class="winchester-pile-column ${cards.length === 0 ? 'is-empty-pile' : ''}">
                            <div class="pile-header-bar">
                                <span class="pile-title">Pile ${pNum} (${cards.length})</span>
                                <button class="select-btn take-winchester-btn" 
                                        ${isMyTurn && cards.length > 0 ? '' : 'disabled'}
                                        onclick="window.takeWinchesterPile(${pNum})">
                                    Take Pile ${pNum}
                                </button>
                            </div>
                            <div class="pile-cards-vertical-list">
                                ${cards.length === 0 ? `
                                    <div class="winchester-empty-slot">
                                        <span>Empty</span>
                                    </div>
                                ` : cards.map((card) => {
                                    const price = getCardPrice(card, 'usd');
                                    return `
                                        <div class="draft-card-item winchester-card-item ${card.isFoil ? 'is-foil' : ''}" data-preview-img="${card.image_large || card.image}">
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
                }).join('')}
            </div>
        </div>
    `;
}

async function takeWinchesterPile(pileNumber) {
    if (!currentDraftData || !currentDraftCode) return;
    const room = currentDraftData;
    const player = getPlayerIdentity();
    const playersList = getDraftPlayersList(room);
    const activePlayerIndex = room.activePlayerIndex || 0;
    const activePlayer = (room.activePlayerId && room.players?.[room.activePlayerId]) 
        ? { ...room.players[room.activePlayerId], id: room.activePlayerId }
        : (playersList[activePlayerIndex] || playersList[0]);
    const me = getDraftPlayerData(room, player);
    const effectivePlayerId = me.id || player.id;

    const isMyTurn = (room.activePlayerId && (room.activePlayerId === player.id || room.activePlayerId === me.id))
        || (activePlayer?.id === player.id || activePlayer?.id === me.id);

    if (!isMyTurn) return;

    const piles = {
        pile1: [...(room.pile1 || [])],
        pile2: [...(room.pile2 || [])],
        pile3: [...(room.pile3 || [])],
        pile4: [...(room.pile4 || [])]
    };
    const stack = [...(room.drawStack || [])];

    const takenCards = piles[`pile${pileNumber}`] || [];
    if (takenCards.length === 0) return;

    piles[`pile${pileNumber}`] = [];

    for (let p = 1; p <= 4; p++) {
        if (stack.length > 0) {
            piles[`pile${p}`].push(stack.pop());
        }
    }

    if (draftUtils?.playSound) draftUtils.playSound('sfx-choose');

    const myPool = [...(me.pool || []), ...takenCards];
    const totalRemaining = piles.pile1.length + piles.pile2.length + piles.pile3.length + piles.pile4.length + stack.length;

    const myIndex = playersList.findIndex(p => p.id === effectivePlayerId || p.id === player.id);
    const nextIndex = myIndex >= 0 ? (1 - myIndex) : (1 - activePlayerIndex);
    const nextPlayer = playersList[nextIndex] || playersList[1];
    const nextPlayerId = nextPlayer?.id || (room.playerOrder ? room.playerOrder[nextIndex] : null);

    if (totalRemaining === 0) {
        await update(ref(db, getDraftDbPath(currentDraftCode)), {
            status: 'complete',
            completedAt: Date.now(),
            ...piles,
            drawStack: stack,
            [`players/${effectivePlayerId}/pool`]: myPool
        });
    } else {
        await update(ref(db, getDraftDbPath(currentDraftCode)), {
            ...piles,
            drawStack: stack,
            activePlayerIndex: nextIndex,
            activePlayerId: nextPlayerId,
            [`players/${effectivePlayerId}/pool`]: myPool
        });
    }
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
    const me = getDraftPlayerData(currentDraftData, player);
    const effectivePlayerId = me.id || player.id;
    const playerData = currentDraftData.players?.[effectivePlayerId] || me;
    const activePack = playerData.currentPack || [];
    const formatConfig = DRAFT_FORMATS[currentDraftData.format] || DRAFT_FORMATS.commander_draft;
    const maxPicks = formatConfig.picksPerTurn || 1;

    if (activePickSelections.length !== maxPicks) return;

    const pickedCards = activePickSelections.map(idx => activePack[idx]).filter(Boolean);
    const remainingPack = activePack.filter((_, idx) => !activePickSelections.includes(idx));
    const currentPool = playerData.pool || [];
    const updatedPool = [...currentPool, ...pickedCards];

    activePickSelections = [];
    if (liveDraftTimerInterval) {
        clearInterval(liveDraftTimerInterval);
        liveDraftTimerInterval = null;
    }
    if (draftUtils?.playSound) draftUtils.playSound('sfx-choose');

    // Update player's picked status and pool
    await update(ref(db, `${getDraftDbPath(currentDraftCode)}/players/${effectivePlayerId}`), {
        pool: updatedPool,
        hasPickedInRound: true,
        remainingPassedPack: remainingPack
    });

    // Check if ALL players in room have completed their picks for this turn
    checkAndPassPacksAroundTable(currentDraftCode);
}

function initDraftPickTimer(room, playerData, activePack) {
    if (!room.timerSeconds || room.timerSeconds <= 0 || playerData.hasPickedInRound || !activePack || activePack.length === 0) {
        if (liveDraftTimerInterval) {
            clearInterval(liveDraftTimerInterval);
            liveDraftTimerInterval = null;
        }
        return;
    }

    const packHash = `${room.currentRound || 1}_${activePack.length}_${activePack[0]?.id || activePack[0]?.name || ''}`;
    if (packHash !== lastTimerPackHash) {
        lastTimerPackHash = packHash;
        currentTimerSecondsLeft = room.timerSeconds;
        if (liveDraftTimerInterval) {
            clearInterval(liveDraftTimerInterval);
        }

        const updateTimerDisplay = () => {
            const timerEl = document.getElementById('draftTimerSecs');
            const pillEl = document.getElementById('draftLiveTimerBadge');
            if (timerEl) {
                timerEl.textContent = currentTimerSecondsLeft;
            }
            if (pillEl) {
                pillEl.classList.remove('is-warning', 'is-urgent');
                if (currentTimerSecondsLeft <= 10) {
                    pillEl.classList.add('is-urgent');
                } else if (currentTimerSecondsLeft <= 20) {
                    pillEl.classList.add('is-warning');
                }
            }
        };

        liveDraftTimerInterval = setInterval(() => {
            currentTimerSecondsLeft--;
            updateTimerDisplay();

            if (currentTimerSecondsLeft <= 0) {
                clearInterval(liveDraftTimerInterval);
                liveDraftTimerInterval = null;
                if (window.autoPickActiveCards) {
                    window.autoPickActiveCards();
                }
            }
        }, 1000);
    }
}

async function autoPickActiveCards() {
    if (!currentDraftData || !currentDraftCode) return;
    const player = getPlayerIdentity();
    const me = getDraftPlayerData(currentDraftData, player);
    const effectivePlayerId = me.id || player.id;
    const playerData = currentDraftData.players?.[effectivePlayerId] || me;
    const activePack = playerData.currentPack || [];
    if (!activePack || activePack.length === 0 || playerData.hasPickedInRound) return;

    const formatConfig = DRAFT_FORMATS[currentDraftData.format] || DRAFT_FORMATS.commander_draft;
    const maxPicks = formatConfig.picksPerTurn || 1;

    if (activePickSelections.length < maxPicks) {
        const remainingNeeded = maxPicks - activePickSelections.length;
        const availableIndices = activePack.map((_, i) => i).filter(i => !activePickSelections.includes(i));
        const availablePack = availableIndices.map(i => activePack[i]);
        const recommended = botChoosePicks(playerData, availablePack, remainingNeeded, currentDraftData.format);
        recommended.forEach(rec => {
            const foundIdx = activePack.findIndex((c, i) => availableIndices.includes(i) && (c.id === rec.id || c.name === rec.name));
            if (foundIdx !== -1 && !activePickSelections.includes(foundIdx)) {
                activePickSelections.push(foundIdx);
            }
        });
        for (const idx of availableIndices) {
            if (activePickSelections.length >= maxPicks) break;
            if (!activePickSelections.includes(idx)) activePickSelections.push(idx);
        }
    }

    if (draftUtils?.showToast) {
        draftUtils.showToast("⏱️ Pick timer expired — cards auto-picked!", true, 3000);
    }
    await confirmActiveDraftPick();
}

async function forceAutoPickPlayer(targetPlayerId) {
    if (!currentDraftData || !currentDraftCode) return;
    const snap = await get(ref(db, `${getDraftDbPath(currentDraftCode)}/players/${targetPlayerId}`));
    if (!snap.exists()) return;
    const target = snap.val();
    if (target.hasPickedInRound || !target.currentPack || target.currentPack.length === 0) return;

    const formatConfig = DRAFT_FORMATS[currentDraftData.format] || DRAFT_FORMATS.commander_draft;
    const picksNeeded = formatConfig.picksPerTurn || 1;
    const chosenCards = botChoosePicks(target, target.currentPack, picksNeeded, currentDraftData.format);
    const chosenIds = new Set(chosenCards.map(c => c.id || c.name));

    const remainingPack = target.currentPack.filter(c => !chosenIds.has(c.id || c.name));
    const updatedPool = [...(target.pool || []), ...chosenCards];

    await update(ref(db, `${getDraftDbPath(currentDraftCode)}/players/${targetPlayerId}`), {
        pool: updatedPool,
        hasPickedInRound: true,
        remainingPassedPack: remainingPack
    });

    if (draftUtils?.showToast) {
        draftUtils.showToast(`⚡ Auto-picked card(s) for ${target.name}`, false, 2500);
    }
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
    const root = document.getElementById('boosterDraftRoot');
    if (root && currentDraftData) {
        renderActiveDraftRoomView(currentDraftData);
    }
}

// Helper to group cards by name & foil finish
function groupCardsForDeckDisplay(cards) {
    const groups = new Map();
    cards.forEach(c => {
        const key = `${c.name}___${c.isFoil ? 'foil' : 'normal'}`;
        if (!groups.has(key)) {
            groups.set(key, { card: c, count: 1, uids: [c.uid] });
        } else {
            const grp = groups.get(key);
            grp.count++;
            grp.uids.push(c.uid);
        }
    });
    return Array.from(groups.values());
}

// Helper to sort card groups
function sortCardGroups(groups, sortMode) {
    const rarityOrder = { mythic: 1, rare: 2, uncommon: 3, common: 4 };
    const colorOrder = { W: 1, U: 2, B: 3, R: 4, G: 5, MULTI: 6, C: 7, LAND: 8 };

    const getColorKey = (card) => {
        if ((card.type_line || '').toLowerCase().includes('land')) return 'LAND';
        const colors = card.colors || card.color_identity || [];
        if (colors.length === 0) return 'C';
        if (colors.length > 1) return 'MULTI';
        return colors[0];
    };

    const getTypeOrder = (card) => {
        const t = (card.type_line || '').toLowerCase();
        if (t.includes('creature')) return 1;
        if (t.includes('planeswalker')) return 2;
        if (t.includes('instant')) return 3;
        if (t.includes('sorcery')) return 4;
        if (t.includes('artifact')) return 5;
        if (t.includes('enchantment')) return 6;
        if (t.includes('land')) return 7;
        return 8;
    };

    return [...groups].sort((a, b) => {
        const cardA = a.card;
        const cardB = b.card;

        if (sortMode === 'cmc') {
            const cmcA = getCardCmc(cardA);
            const cmcB = getCardCmc(cardB);
            if (cmcA !== cmcB) return cmcA - cmcB;
            return cardA.name.localeCompare(cardB.name);
        }
        if (sortMode === 'color') {
            const cA = colorOrder[getColorKey(cardA)] || 9;
            const cB = colorOrder[getColorKey(cardB)] || 9;
            if (cA !== cB) return cA - cB;
            return getCardCmc(cardA) - getCardCmc(cardB);
        }
        if (sortMode === 'rarity') {
            const rA = rarityOrder[cardA.rarity] || 5;
            const rB = rarityOrder[cardB.rarity] || 5;
            if (rA !== rB) return rA - rB;
            return getCardCmc(cardA) - getCardCmc(cardB);
        }
        if (sortMode === 'type') {
            const tA = getTypeOrder(cardA);
            const tB = getTypeOrder(cardB);
            if (tA !== tB) return tA - tB;
            return getCardCmc(cardA) - getCardCmc(cardB);
        }
        if (sortMode === 'name') {
            return cardA.name.localeCompare(cardB.name);
        }
        return 0;
    });
}

// Helper to calculate card type distribution
function getCardTypeStats(cards, basicLands = null) {
    const counts = {
        creature: 0,
        instant: 0,
        sorcery: 0,
        artifact: 0,
        enchantment: 0,
        planeswalker: 0,
        land: 0,
        other: 0
    };

    cards.forEach(c => {
        const t = (c.type_line || '').toLowerCase();
        if (t.includes('creature')) {
            counts.creature++;
        } else if (t.includes('planeswalker')) {
            counts.planeswalker++;
        } else if (t.includes('instant')) {
            counts.instant++;
        } else if (t.includes('sorcery')) {
            counts.sorcery++;
        } else if (t.includes('artifact')) {
            counts.artifact++;
        } else if (t.includes('enchantment')) {
            counts.enchantment++;
        } else if (t.includes('land')) {
            counts.land++;
        } else {
            counts.other++;
        }
    });

    if (basicLands) {
        const totalBasics = Object.values(basicLands).reduce((sum, n) => sum + (Number(n) || 0), 0);
        counts.land += totalBasics;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { counts, total };
}

// Helper to calculate card color counts and mana pips
function getCardColorStats(cards) {
    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    const cardsByColor = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, Multi: 0 };

    cards.forEach(c => {
        const cost = c.mana_cost || '';
        ['W', 'U', 'B', 'R', 'G'].forEach(col => {
            const matches = cost.match(new RegExp(col, 'g'));
            if (matches) pips[col] += matches.length;
        });

        const typeLine = (c.type_line || '').toLowerCase();
        if (!typeLine.includes('land')) {
            const cols = c.colors && c.colors.length > 0 ? c.colors : [];
            if (cols.length === 0) {
                cardsByColor.C++;
            } else if (cols.length > 1) {
                cardsByColor.Multi++;
                cols.forEach(col => {
                    if (cardsByColor[col] !== undefined) cardsByColor[col]++;
                });
            } else {
                const col = cols[0];
                if (cardsByColor[col] !== undefined) cardsByColor[col]++;
            }
        }
    });

    return { pips, cardsByColor };
}

// Render visual card type progress bar and badges
function renderCardTypeVisual(typeStats) {
    const { counts, total } = typeStats;
    if (total === 0) {
        return `
            <div class="card-type-visual-container is-empty">
                <span class="type-visual-empty">0 cards</span>
            </div>
        `;
    }

    const typeConfigs = [
        { key: 'creature', label: 'Creatures', icon: '👾', color: '#10b981' },
        { key: 'instant', label: 'Instants', icon: '⚡', color: '#0ea5e9' },
        { key: 'sorcery', label: 'Sorceries', icon: '📜', color: '#f97316' },
        { key: 'artifact', label: 'Artifacts', icon: '🛡️', color: '#94a3b8' },
        { key: 'enchantment', label: 'Enchantments', icon: '🔮', color: '#a855f7' },
        { key: 'planeswalker', label: 'Walkers', icon: '👑', color: '#eab308' },
        { key: 'land', label: 'Lands', icon: '🏞️', color: '#84cc16' },
        { key: 'other', label: 'Other', icon: '⚔️', color: '#64748b' }
    ];

    const activeTypes = typeConfigs.filter(cfg => counts[cfg.key] > 0);

    const segments = activeTypes.map(cfg => {
        const pct = ((counts[cfg.key] / total) * 100).toFixed(1);
        return `<div class="type-segment" style="width: ${pct}%; background-color: ${cfg.color};" title="${cfg.label}: ${counts[cfg.key]} (${pct}%)"></div>`;
    }).join('');

    const chips = typeConfigs.map(cfg => {
        const count = counts[cfg.key];
        if (count === 0 && (cfg.key === 'other' || cfg.key === 'planeswalker')) return '';
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return `
            <span class="type-chip ${count > 0 ? 'has-cards' : 'is-zero'}" title="${cfg.label}: ${count} (${pct}%)">
                <span class="type-chip-dot" style="background-color: ${cfg.color};"></span>
                <span class="type-icon">${cfg.icon}</span>
                <span class="type-name">${cfg.label}</span>
                <strong class="type-count">${count}</strong>
            </span>
        `;
    }).join('');

    return `
        <div class="card-type-visual-container">
            <div class="type-visual-top-row">
                <span class="stats-mini-title">Card Types (${total}):</span>
            </div>
            <div class="type-segmented-bar">${segments}</div>
            <div class="type-chips-grid">${chips}</div>
        </div>
    `;
}

// Calculate optimal recommended basic lands based on mana pips in selected spells
export function calculateOptimalLands(mainDeckCards, formatId) {
    const isCommander = formatId === 'commander_draft';
    const targetDeckSize = isCommander ? 60 : 40;

    let landsNeeded = targetDeckSize - mainDeckCards.length;
    if (landsNeeded <= 0) {
        landsNeeded = isCommander ? 24 : 17;
    }

    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    mainDeckCards.forEach(c => {
        const cost = c.mana_cost || '';
        ['W', 'U', 'B', 'R', 'G'].forEach(col => {
            const matches = cost.match(new RegExp(col, 'g'));
            if (matches) pips[col] += matches.length;
        });
    });

    const totalPips = Object.values(pips).reduce((a, b) => a + b, 0);
    const newLands = { W: 0, U: 0, B: 0, R: 0, G: 0 };

    if (totalPips === 0) {
        const split = Math.floor(landsNeeded / 2);
        newLands.W = split;
        newLands.U = landsNeeded - split;
    } else {
        let assigned = 0;
        const colorsWithPips = Object.keys(pips).filter(c => pips[c] > 0);
        
        colorsWithPips.forEach(col => {
            const count = Math.round((pips[col] / totalPips) * landsNeeded);
            newLands[col] = count;
            assigned += count;
        });

        let diff = landsNeeded - assigned;
        if (diff !== 0) {
            const highestColor = Object.entries(pips).sort((a, b) => b[1] - a[1])[0][0];
            newLands[highestColor] = Math.max(0, newLands[highestColor] + diff);
        }
    }

    const landNames = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
    const summary = Object.entries(newLands)
        .filter(([_, cnt]) => cnt > 0)
        .map(([sym, cnt]) => `${cnt} ${landNames[sym]}`)
        .join(', ');

    return { landsNeeded, newLands, summary };
}

// Button action: Add recommended basic lands based on mana pips
export function addRecommendedLands(formatId) {
    const mainCards = myDraftedPool.filter(c => mainDeckUids.has(c.uid));
    const rec = calculateOptimalLands(mainCards, formatId);
    addedBasicLands = rec.newLands;

    if (draftUtils?.playSound) draftUtils.playSound('sfx-choose');
    if (draftUtils?.showToast) {
        draftUtils.showToast(`✨ Added ${rec.landsNeeded} recommended lands (${rec.summary}) based on your spells' mana pips!`, false, 3000);
    }
    refreshDeckBuilderView();
}

// Evaluate Deck Health (2.3 Deck Doctor - Guides player choices without deciding for them)
export function evaluateDeckHealth(mainDeckCards, basicLands, pool, formatId) {
    const isCommander = formatId === 'commander_draft';
    const targetDeckSize = isCommander ? 60 : 40;
    const targetSpells = isCommander ? 36 : 23;
    const targetLands = isCommander ? 24 : 17;

    const nonBasicLandsInMain = mainDeckCards.filter(c => (c.type_line || '').toLowerCase().includes('land')).length;
    const spellsCount = mainDeckCards.length - nonBasicLandsInMain;
    const basicLandsCount = Object.values(basicLands).reduce((a, b) => a + b, 0);
    const totalLands = nonBasicLandsInMain + basicLandsCount;
    const totalDeckCards = spellsCount + totalLands;

    const issues = [];

    // 1. Deck Size & Spell Count
    if (spellsCount > targetSpells) {
        issues.push({
            type: 'warning',
            icon: '✂️',
            title: `Deck Has ${spellsCount} Spells (+${spellsCount - targetSpells} over recommended)`,
            desc: `In Limited, playing ${targetSpells} non-land spells maximizes the consistency of drawing your best bombs and removal. Consider trimming ${spellsCount - targetSpells} card(s) to hit the 23-spell sweet spot.`
        });
    } else if (spellsCount < targetSpells) {
        issues.push({
            type: 'info',
            icon: '📥',
            title: `Need ${targetSpells - spellsCount} More Spell(s)`,
            desc: `You currently have ${spellsCount} non-land spells in your main deck. Add ${targetSpells - spellsCount} more playable card(s) from your sideboard pool below.`
        });
    } else {
        issues.push({
            type: 'success',
            icon: '✓',
            title: `Optimal Spell Count (${spellsCount}/${targetSpells})`,
            desc: `Your non-land spell count hits the standard ${targetSpells} sweet spot perfectly!`
        });
    }

    // Land Count
    if (totalLands < targetLands && spellsCount >= targetSpells - 3) {
        issues.push({
            type: 'warning',
            icon: '🏔️',
            title: `Land Count Light (${totalLands}/${targetLands})`,
            desc: `You have ${totalLands} lands. For a ${targetDeckSize}-card deck, ${targetLands} lands is standard. Click "⚡ Add Recommended Lands" above to auto-fill based on your pips.`
        });
    }

    // 2. Creature Count (Board Presence)
    const creatures = mainDeckCards.filter(c => (c.type_line || '').toLowerCase().includes('creature'));
    const creatureCount = creatures.length;
    const targetCreatures = isCommander ? 24 : 15;

    if (creatureCount < (isCommander ? 18 : 13)) {
        issues.push({
            type: 'warning',
            icon: '👾',
            title: `Light Creature Base (${creatureCount}/${targetCreatures} recommended)`,
            desc: `Limited games are predominantly decided by creature combat and board presence. With only ${creatureCount} creatures, you risk falling behind attackers. Consider swapping in creatures from your pool.`
        });
    } else if (creatureCount >= (isCommander ? 18 : 14) && creatureCount <= (isCommander ? 32 : 18)) {
        issues.push({
            type: 'success',
            icon: '✓',
            title: `Healthy Creature Count (${creatureCount} creatures)`,
            desc: `Solid creature baseline for attacking, blocking, and board presence.`
        });
    } else if (creatureCount > (isCommander ? 32 : 18)) {
        issues.push({
            type: 'info',
            icon: '💡',
            title: `High Creature Density (${creatureCount} creatures)`,
            desc: `You have plenty of threats! Ensure you have sufficient removal or combat tricks to interact with opponent threats.`
        });
    }

    // 3. Early Curve (2-Drops) & High CMC
    const twoDrops = mainDeckCards.filter(c => {
        const cmc = Math.floor(getCardCmc(c));
        return cmc === 2 && !(c.type_line || '').toLowerCase().includes('land');
    });
    const expensiveSpells = mainDeckCards.filter(c => {
        const cmc = Math.floor(getCardCmc(c));
        return cmc >= 5 && !(c.type_line || '').toLowerCase().includes('land');
    });

    if (twoDrops.length < 4) {
        issues.push({
            type: 'warning',
            icon: '⏳',
            title: `Light Early Game (Only ${twoDrops.length} 2-drop${twoDrops.length === 1 ? '' : 's'})`,
            desc: `In Limited, playing a creature on turn 2 prevents early life loss and contests early attacks. Look for 2-drops in your pool to bolster your early game.`
        });
    } else {
        issues.push({
            type: 'success',
            icon: '✓',
            title: `Solid Early Curve (${twoDrops.length} 2-drops)`,
            desc: `Good early tempo to contest the board from turn 2 onward.`
        });
    }

    if (expensiveSpells.length > (isCommander ? 8 : 5)) {
        issues.push({
            type: 'warning',
            icon: '⚠️',
            title: `Heavy Top-End (${expensiveSpells.length} spells at 5+ CMC)`,
            desc: `Having too many expensive cards risks clunky opening hands where you cannot cast spells before turn 5. Consider trimming down to your 3–4 highest-impact finishers.`
        });
    }

    // 4. Color Consistency & Double-Pip Strain
    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    const doublePipCards = { W: [], U: [], B: [], R: [], G: [] };

    mainDeckCards.forEach(c => {
        const cost = c.mana_cost || '';
        ['W', 'U', 'B', 'R', 'G'].forEach(col => {
            const matches = cost.match(new RegExp(col, 'g'));
            if (matches) {
                pips[col] += matches.length;
                if (matches.length >= 2) {
                    doublePipCards[col].push(c);
                }
            }
        });
    });

    const colorNames = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
    ['W', 'U', 'B', 'R', 'G'].forEach(col => {
        const sources = basicLands[col] || 0;
        if (doublePipCards[col].length > 0 && sources < 7) {
            const sample = doublePipCards[col][0].name;
            issues.push({
                type: 'warning',
                icon: '🎨',
                title: `Double-${col} Strain (${sources} sources)`,
                desc: `You have double-pipped ${colorNames[col]} cards (e.g. "${sample}") with only ${sources} ${colorNames[col]} basic lands. At least 7–8 sources are recommended to cast {${col}}{${col}} reliably on curve.`
            });
        }
    });

    // 5. Candidate Cuts to Consider (Non-destructive recommendations)
    const candidateCuts = [];
    if (spellsCount > targetSpells) {
        const scoredSpells = mainDeckCards
            .filter(c => !(c.type_line || '').toLowerCase().includes('land'))
            .map(c => {
                const role = detectCardRole(c);
                const cmc = getCardCmc(c);
                let cutDesirability = 0;
                if (cmc >= 5 && !role.isBomb && !role.isRemoval) cutDesirability += 4;
                if (role.tags.length === 0) cutDesirability += 2;
                if (c.rarity === 'common') cutDesirability += 1;
                return { card: c, score: cutDesirability };
            })
            .sort((a, b) => b.score - a.score);

        const seenNames = new Set();
        for (const item of scoredSpells) {
            if (!seenNames.has(item.card.name)) {
                seenNames.add(item.card.name);
                candidateCuts.push(item.card);
                if (candidateCuts.length >= 4) break;
            }
        }
    }

    // 6. Sideboard Gems to Consider (On-color unplayed playables)
    const sideboardCards = pool.filter(c => !mainDeckUids.has(c.uid));
    const activeColors = Object.keys(pips).filter(col => pips[col] >= 3);
    const candidateAdds = [];

    const scoredSideboard = sideboardCards
        .filter(c => !(c.type_line || '').toLowerCase().includes('land'))
        .map(c => {
            const role = detectCardRole(c);
            const cmc = getCardCmc(c);
            const cardCols = c.colors && c.colors.length > 0 ? c.colors : (c.color_identity || []);
            const onColor = cardCols.some(col => activeColors.includes(col));
            let addDesirability = 0;
            if (onColor) addDesirability += 3;
            if (role.isRemoval) addDesirability += 4;
            if (role.isBomb) addDesirability += 5;
            if (cmc === 2 && role.isCreature) addDesirability += 3;
            return { card: c, score: addDesirability, onColor };
        })
        .filter(item => item.onColor && item.score >= 4)
        .sort((a, b) => b.score - a.score);

    const seenAddNames = new Set();
    for (const item of scoredSideboard) {
        if (!seenAddNames.has(item.card.name)) {
            seenAddNames.add(item.card.name);
            candidateAdds.push(item.card);
            if (candidateAdds.length >= 4) break;
        }
    }

    return { issues, candidateCuts, candidateAdds };
}

// Highlight a card in the workspace for player review
export function highlightDeckDoctorCard(cardName) {
    const encoded = encodeURIComponent(cardName);
    const elements = document.querySelectorAll(`[data-card-name="${encoded}"]`);
    if (elements.length > 0) {
        elements[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        elements.forEach(el => {
            el.classList.add('doctor-highlight-pulse');
            setTimeout(() => el.classList.remove('doctor-highlight-pulse'), 2500);
        });
        if (draftUtils?.playSound) draftUtils.playSound('sfx-click');
    } else {
        if (draftUtils?.showToast) draftUtils.showToast(`Card "${cardName}" located in pool.`, false, 1500);
    }
}

// Render Deck Doctor advisor component
function renderDeckDoctorSection(mainDeckCards, addedBasicLands, pool, formatId) {
    const health = evaluateDeckHealth(mainDeckCards, addedBasicLands, pool, formatId);
    const { issues, candidateCuts, candidateAdds } = health;

    return `
        <div class="booster-control-card deck-doctor-card">
            <div class="doctor-header-row">
                <div class="doctor-title-box">
                    <span class="doctor-badge-icon">🩺</span>
                    <div>
                        <h3 class="doctor-title">Deck Doctor & Limited Advisor</h3>
                        <p class="doctor-subtitle">Real-time deck diagnostics to help you make the best build choices.</p>
                    </div>
                </div>
            </div>

            <!-- Health Diagnostic Alerts -->
            <div class="doctor-alerts-list">
                ${issues.map(iss => `
                    <div class="doctor-alert-row alert-${iss.type}">
                        <div class="alert-icon-col">${iss.icon}</div>
                        <div class="alert-content-col">
                            <strong class="alert-title">${iss.title}</strong>
                            <p class="alert-desc">${iss.desc}</p>
                        </div>
                    </div>
                `).join('')}
            </div>

            <!-- Guided Choice Trimmers: Candidate Cuts & Sideboard Gems -->
            <div class="doctor-suggestions-container">
                ${candidateCuts.length > 0 ? `
                    <div class="suggestion-group cuts-group">
                        <span class="suggestion-group-title">✂️ Candidate Cuts to Consider (Click to inspect in deck):</span>
                        <div class="suggestion-chips-row">
                            ${candidateCuts.map(card => `
                                <button type="button" class="doctor-candidate-chip cut-chip" 
                                        onclick="window.highlightDeckDoctorCard(decodeURIComponent('${encodeURIComponent(card.name)}'))"
                                        title="Click to locate ${card.name} in your deck">
                                    <span>🔍 ${card.name}</span>
                                    <span class="chip-cost">${card.mana_cost || '0'}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                ${candidateAdds.length > 0 ? `
                    <div class="suggestion-group adds-group">
                        <span class="suggestion-group-title">💎 Unplayed On-Color Gems in Sideboard:</span>
                        <div class="suggestion-chips-row">
                            ${candidateAdds.map(card => `
                                <button type="button" class="doctor-candidate-chip add-chip" 
                                        onclick="window.addCardToMainDeck(decodeURIComponent('${encodeURIComponent(card.name)}'))"
                                        title="Click to add ${card.name} from sideboard to deck">
                                    <span>+ Add ${card.name}</span>
                                    <span class="chip-cost">${card.mana_cost || '0'}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

// Render Arena-Style Column Main Deck (2.2)
function renderArenaColumnsMainDeck(mainDeckCards) {
    if (mainDeckCards.length === 0) {
        return `
            <div class="empty-deck-notice" onclick="window.addAllCardsToDeck()">
                <span class="notice-icon">📥</span>
                <h4>Main Deck is empty (0 cards)</h4>
                <p>Click on any card in your <strong>Sideboard / Pool</strong> below to add it, or click <strong>➕ Add All</strong> to start with your whole pool.</p>
            </div>
        `;
    }

    const columns = [
        { id: '0-1', label: '1 CMC', isLand: false, cards: [] },
        { id: '2', label: '2 CMC', isLand: false, cards: [] },
        { id: '3', label: '3 CMC', isLand: false, cards: [] },
        { id: '4', label: '4 CMC', isLand: false, cards: [] },
        { id: '5', label: '5 CMC', isLand: false, cards: [] },
        { id: '6+', label: '6+ CMC', isLand: false, cards: [] },
        { id: 'lands', label: 'Lands', isLand: true, cards: [] }
    ];

    mainDeckCards.forEach(c => {
        const isLand = (c.type_line || '').toLowerCase().includes('land');
        if (isLand) {
            columns[6].cards.push(c);
        } else {
            const cmc = Math.floor(getCardCmc(c));
            if (cmc <= 1) columns[0].cards.push(c);
            else if (cmc === 2) columns[1].cards.push(c);
            else if (cmc === 3) columns[2].cards.push(c);
            else if (cmc === 4) columns[3].cards.push(c);
            else if (cmc === 5) columns[4].cards.push(c);
            else columns[5].cards.push(c);
        }
    });

    return `
        <div class="arena-columns-container">
            ${columns.map(col => {
                if (col.isLand && col.cards.length === 0) return '';
                const groups = groupCardsForDeckDisplay(col.cards);
                groups.sort((a, b) => (a.card.name || '').localeCompare(b.card.name || ''));

                return `
                    <div class="arena-cmc-col">
                        <div class="arena-col-header">
                            <span class="arena-col-label">${col.label}</span>
                            <span class="arena-col-badge">${col.cards.length}</span>
                        </div>
                        <div class="arena-col-cards-list">
                            ${groups.length === 0 ? `
                                <div class="arena-col-empty">-</div>
                            ` : groups.map(({ card, count }) => `
                                <div class="arena-card-tile rarity-${card.rarity} ${card.isFoil ? 'is-foil' : ''}"
                                     data-card-name="${encodeURIComponent(card.name)}"
                                     data-preview-img="${card.image_large || card.image}"
                                     onclick="window.removeCardFromMainDeck(decodeURIComponent('${encodeURIComponent(card.name)}'))">
                                    <div class="tile-rarity-stripe"></div>
                                    <div class="tile-cost">${formatManaCostSymbols(card.mana_cost)}</div>
                                    <div class="tile-name" title="${card.name}">${card.name}</div>
                                    ${count > 1 ? `<span class="tile-copies">${count}x</span>` : ''}
                                    <button type="button" class="tile-remove-btn" title="Remove to Sideboard">-</button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// Render Deckbuilding Workspace
function renderDraftDeckWorkspace(pool, formatId) {
    const isCommander = formatId === 'commander_draft';
    const targetDeckSize = isCommander ? 60 : 40;

    // Ensure all pool items have uids
    pool.forEach((c, idx) => {
        if (!c.uid) c.uid = `${c.id || 'card'}_${idx}_${c.name}`;
    });

    const mainDeckCards = pool.filter(c => mainDeckUids.has(c.uid));
    const sideboardCards = pool.filter(c => !mainDeckUids.has(c.uid));

    // Groups with copy counts
    const mainGroups = groupCardsForDeckDisplay(mainDeckCards);
    const sideGroups = groupCardsForDeckDisplay(sideboardCards);

    const sortedMain = sortCardGroups(mainGroups, deckSortMode);
    const sortedSide = sortCardGroups(sideGroups, deckSortMode);

    // Calculate curve strictly for cards in Main Deck (excluding lands)
    const curve = [0, 0, 0, 0, 0, 0, 0]; // 0, 1, 2, 3, 4, 5, 6+
    mainDeckCards.forEach(c => {
        if (!(c.type_line || '').toLowerCase().includes('land')) {
            const cmc = Math.min(6, Math.floor(getCardCmc(c)));
            curve[cmc]++;
        }
    });

    const mainColorStats = getCardColorStats(mainDeckCards);
    const sideColorStats = getCardColorStats(sideboardCards);

    const totalLands = Object.values(addedBasicLands).reduce((a, b) => a + b, 0);
    const totalDeckCards = mainDeckCards.length + totalLands;

    const mainTypeStats = getCardTypeStats(mainDeckCards, addedBasicLands);
    const sideTypeStats = getCardTypeStats(sideboardCards, null);

    const recLands = calculateOptimalLands(mainDeckCards, formatId);

    return `
        <div class="draft-deck-workspace card-size-${deckCardSize}">
            <!-- Top Curve & Analytics Banner -->
            <div class="booster-control-card deck-analytics-banner">
                <div class="analytics-col">
                    <span class="analytics-title">Deck Composition</span>
                    <span class="deck-size-counter ${totalDeckCards >= targetDeckSize ? 'valid' : 'under'}">
                        ${totalDeckCards} / ${targetDeckSize} Cards
                    </span>
                    <span class="deck-subtext">(${mainDeckCards.length} Spells + ${totalLands} Basic Lands)</span>
                </div>

                <!-- Mana Curve Bars -->
                <div class="mana-curve-chart">
                    <span class="analytics-title">Mana Curve (Main Deck)</span>
                    <div class="curve-bars-row">
                        ${curve.map((count, cmc) => `
                            <div class="curve-bar-col">
                                <span class="curve-count">${count}</span>
                                <div class="curve-bar" style="height: ${Math.min(50, Math.max(2, count * 9))}px;"></div>
                                <span class="curve-label">${cmc === 6 ? '6+' : cmc}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Colored Mana Symbols Pip Breakdown -->
                <div class="mana-pips-box">
                    <span class="analytics-title">Colored Mana Pips</span>
                    <div class="pips-row">
                        <span class="pip-chip pip-W" title="White: ${mainColorStats.cardsByColor.W} cards, ${mainColorStats.pips.W} pips">☀️ ${mainColorStats.pips.W}</span>
                        <span class="pip-chip pip-U" title="Blue: ${mainColorStats.cardsByColor.U} cards, ${mainColorStats.pips.U} pips">💧 ${mainColorStats.pips.U}</span>
                        <span class="pip-chip pip-B" title="Black: ${mainColorStats.cardsByColor.B} cards, ${mainColorStats.pips.B} pips">💀 ${mainColorStats.pips.B}</span>
                        <span class="pip-chip pip-R" title="Red: ${mainColorStats.cardsByColor.R} cards, ${mainColorStats.pips.R} pips">🔥 ${mainColorStats.pips.R}</span>
                        <span class="pip-chip pip-G" title="Green: ${mainColorStats.cardsByColor.G} cards, ${mainColorStats.pips.G} pips">🌲 ${mainColorStats.pips.G}</span>
                    </div>
                </div>

                <!-- Land Adder Controls -->
                <div class="land-adder-box">
                    <div class="land-adder-header">
                        <span class="analytics-title">Basic Lands (${totalLands})</span>
                        <div class="land-adder-actions">
                            <button class="auto-land-link highlight-action" onclick="window.addRecommendedLands('${formatId}')" title="Auto-fill recommended lands: ${recLands.summary}">⚡ Add Recommended Lands (${recLands.summary || '17 Lands'})</button>
                            <button class="auto-land-link" onclick="window.autoAddBasicLands('${formatId}')">Equal Split</button>
                        </div>
                    </div>
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
                <div class="deck-export-col">
                    <button class="select-btn export-deck-cta" onclick="window.copyDraftDecklist()">
                        📋 Copy Decklist
                    </button>
                    <button class="select-btn export-deck-cta" style="background: linear-gradient(135deg, #0284c7, #0ea5e9); border-color: rgba(56, 189, 248, 0.4); margin-top: 8px;" onclick="window.compareDraftWithCollection()">
                        🔄 Compare with Collection
                    </button>
                </div>
            </div>

            <!-- SECTION: DECK DOCTOR & LIMITED ADVISOR (2.3) -->
            ${renderDeckDoctorSection(mainDeckCards, addedBasicLands, pool, formatId)}

            <!-- Sort & Quick Action Toolbar -->
            <div class="deck-sort-toolbar">
                <div class="deck-layout-group">
                    <span class="sort-label">Layout:</span>
                    <button class="deck-filter-pill ${deckLayoutMode === 'columns' ? 'active' : ''}" onclick="window.setDeckLayoutMode('columns')">📊 Mana Columns</button>
                    <button class="deck-filter-pill ${deckLayoutMode === 'grid' ? 'active' : ''}" onclick="window.setDeckLayoutMode('grid')">▦ Grid View</button>
                </div>

                <div class="deck-sort-group">
                    <span class="sort-label">Sort:</span>
                    <button class="deck-filter-pill ${deckSortMode === 'cmc' ? 'active' : ''}" onclick="window.setDeckSortMode('cmc')">🔢 Mana Cost</button>
                    <button class="deck-filter-pill ${deckSortMode === 'color' ? 'active' : ''}" onclick="window.setDeckSortMode('color')">🎨 Color</button>
                    <button class="deck-filter-pill ${deckSortMode === 'rarity' ? 'active' : ''}" onclick="window.setDeckSortMode('rarity')">💎 Rarity</button>
                    <button class="deck-filter-pill ${deckSortMode === 'type' ? 'active' : ''}" onclick="window.setDeckSortMode('type')">🃏 Card Type</button>
                    <button class="deck-filter-pill ${deckSortMode === 'name' ? 'active' : ''}" onclick="window.setDeckSortMode('name')">🔤 Name A-Z</button>
                </div>

                <div class="deck-size-group">
                    <span class="sort-label">Size:</span>
                    <button class="deck-size-btn ${deckCardSize === 'small' ? 'active' : ''}" onclick="window.setDeckCardSize('small')" title="Smaller cards">🔍 S</button>
                    <button class="deck-size-btn ${deckCardSize === 'normal' ? 'active' : ''}" onclick="window.setDeckCardSize('normal')" title="Normal card size">🔍 M</button>
                    <button class="deck-size-btn ${deckCardSize === 'large' ? 'active' : ''}" onclick="window.setDeckCardSize('large')" title="Larger cards">🔍 L</button>
                </div>

                <div class="deck-quick-actions">
                    <button class="preview-toggle-btn ${hoverPreviewEnabled ? 'active' : ''}" onclick="window.toggleHoverPreview()" title="Turn floating card hover preview on or off">
                        ${hoverPreviewEnabled ? '👁️ Preview: ON' : '👁️ Preview: OFF'}
                    </button>
                    <button class="secondary-btn btn-compact highlight-gold" onclick="window.addRecommendedLands('${formatId}')">⚡ Rec. Lands</button>
                    <button class="secondary-btn btn-compact" onclick="window.addAllCardsToDeck()">➕ Add All</button>
                    <button class="secondary-btn btn-compact" onclick="window.clearMainDeck()">🧹 Clear Deck</button>
                </div>
            </div>

            <!-- SECTION 1: MAIN DECK -->
            <div class="deck-section-container main-deck-section">
                <div class="section-header-row">
                    <div class="section-title-col">
                        <h3>🎴 Main Deck (${mainDeckCards.length} Spells + ${totalLands} Lands = ${totalDeckCards} / ${targetDeckSize})</h3>
                        <span class="section-hint">Click card to move to Sideboard</span>
                    </div>
                    <div class="section-color-box">
                        <span class="stats-mini-title">Colors:</span>
                        <div class="pips-row">
                            <span class="pip-chip pip-W" title="White: ${mainColorStats.cardsByColor.W} cards, ${mainColorStats.pips.W} mana pips">☀️ ${mainColorStats.pips.W}</span>
                            <span class="pip-chip pip-U" title="Blue: ${mainColorStats.cardsByColor.U} cards, ${mainColorStats.pips.U} mana pips">💧 ${mainColorStats.pips.U}</span>
                            <span class="pip-chip pip-B" title="Black: ${mainColorStats.cardsByColor.B} cards, ${mainColorStats.pips.B} mana pips">💀 ${mainColorStats.pips.B}</span>
                            <span class="pip-chip pip-R" title="Red: ${mainColorStats.cardsByColor.R} cards, ${mainColorStats.pips.R} mana pips">🔥 ${mainColorStats.pips.R}</span>
                            <span class="pip-chip pip-G" title="Green: ${mainColorStats.cardsByColor.G} cards, ${mainColorStats.pips.G} mana pips">🌲 ${mainColorStats.pips.G}</span>
                            ${mainColorStats.cardsByColor.C > 0 ? `<span class="pip-chip pip-C" title="Colorless: ${mainColorStats.cardsByColor.C} cards">⚪ ${mainColorStats.cardsByColor.C}</span>` : ''}
                            ${mainColorStats.cardsByColor.Multi > 0 ? `<span class="pip-chip pip-Multi" title="Multicolored: ${mainColorStats.cardsByColor.Multi} cards">🌈 ${mainColorStats.cardsByColor.Multi}</span>` : ''}
                        </div>
                    </div>
                </div>

                <!-- Visual on Card Types for Main Deck -->
                <div class="section-type-visual-bar">
                    ${renderCardTypeVisual(mainTypeStats)}
                </div>

                ${deckLayoutMode === 'columns' ? `
                    ${renderArenaColumnsMainDeck(mainDeckCards)}
                ` : `
                    ${sortedMain.length === 0 ? `
                        <div class="empty-deck-notice" onclick="window.addAllCardsToDeck()">
                            <span class="notice-icon">📥</span>
                            <h4>Main Deck is empty (0 cards)</h4>
                            <p>Click on any card in your <strong>Sideboard / Pool</strong> below to add it, or click <strong>➕ Add All</strong> to start with your whole pool.</p>
                        </div>
                    ` : `
                        <div class="draft-pool-grid">
                            ${sortedMain.map(({ card, count }) => `
                                <div class="draft-card-item in-main-deck ${card.isFoil ? 'is-foil' : ''}" 
                                     data-card-name="${encodeURIComponent(card.name)}"
                                     data-preview-img="${card.image_large || card.image}"
                                     onclick="window.removeCardFromMainDeck(decodeURIComponent('${encodeURIComponent(card.name)}'))">
                                     <div class="draft-card-img-wrapper">
                                        <img src="${card.image}" alt="${card.name}" loading="lazy" class="draft-card-img">
                                        ${count > 1 ? `<div class="card-copies-badge">${count}x</div>` : ''}
                                        ${card.isFoil ? '<div class="booster-foil-overlay"></div><span class="booster-foil-tag">FOIL</span>' : ''}
                                        <span class="booster-rarity-pill rarity-${card.rarity}">${card.rarity.toUpperCase()}</span>
                                        <button type="button" class="inspect-mini-btn" onclick="event.stopPropagation(); window.inspectDraftCard('${card.id}')" title="Inspect 3D">🔍</button>
                                    </div>
                                    <div class="draft-card-footer">
                                        <div class="draft-card-name" title="${card.name}">${card.name}</div>
                                        <button type="button" class="deck-card-action-btn remove-btn">Remove -</button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `}
                `}
            </div>

            <!-- SECTION 2: SIDEBOARD / UNUSED POOL -->
            <div class="deck-section-container sideboard-section">
                <div class="section-header-row">
                    <div class="section-title-col">
                        <h3>📦 Sideboard & Available Pool (${sideboardCards.length} cards)</h3>
                        <span class="section-hint">Click card or "+ Add" to put into Main Deck</span>
                    </div>
                    <div class="section-color-box">
                        <span class="stats-mini-title">Sideboard Colors:</span>
                        <div class="pips-row">
                            <span class="pip-chip pip-W" title="White: ${sideColorStats.cardsByColor.W} cards, ${sideColorStats.pips.W} mana pips">☀️ ${sideColorStats.pips.W}</span>
                            <span class="pip-chip pip-U" title="Blue: ${sideColorStats.cardsByColor.U} cards, ${sideColorStats.pips.U} mana pips">💧 ${sideColorStats.pips.U}</span>
                            <span class="pip-chip pip-B" title="Black: ${sideColorStats.cardsByColor.B} cards, ${sideColorStats.pips.B} mana pips">💀 ${sideColorStats.pips.B}</span>
                            <span class="pip-chip pip-R" title="Red: ${sideColorStats.cardsByColor.R} cards, ${sideColorStats.pips.R} mana pips">🔥 ${sideColorStats.pips.R}</span>
                            <span class="pip-chip pip-G" title="Green: ${sideColorStats.cardsByColor.G} cards, ${sideColorStats.pips.G} mana pips">🌲 ${sideColorStats.pips.G}</span>
                            ${sideColorStats.cardsByColor.C > 0 ? `<span class="pip-chip pip-C" title="Colorless: ${sideColorStats.cardsByColor.C} cards">⚪ ${sideColorStats.cardsByColor.C}</span>` : ''}
                            ${sideColorStats.cardsByColor.Multi > 0 ? `<span class="pip-chip pip-Multi" title="Multicolored: ${sideColorStats.cardsByColor.Multi} cards">🌈 ${sideColorStats.cardsByColor.Multi}</span>` : ''}
                        </div>
                    </div>
                </div>

                <!-- Visual on Card Types for Sideboard / Pool -->
                <div class="section-type-visual-bar">
                    ${renderCardTypeVisual(sideTypeStats)}
                </div>

                ${sortedSide.length === 0 ? `
                    <div class="empty-deck-notice">
                        <p>All drafted cards are currently in your Main Deck.</p>
                    </div>
                ` : `
                    <div class="draft-pool-grid">
                        ${sortedSide.map(({ card, count }) => {
                            const role = detectCardRole(card);
                            return `
                                <div class="draft-card-item in-sideboard ${card.isFoil ? 'is-foil' : ''}" 
                                     data-card-name="${encodeURIComponent(card.name)}"
                                     data-preview-img="${card.image_large || card.image}"
                                     onclick="window.addCardToMainDeck(decodeURIComponent('${encodeURIComponent(card.name)}'))">
                                    <div class="draft-card-img-wrapper">
                                        <img src="${card.image}" alt="${card.name}" loading="lazy" class="draft-card-img">
                                        ${count > 1 ? `<div class="card-copies-badge">${count}x</div>` : ''}
                                        ${card.isFoil ? '<div class="booster-foil-overlay"></div><span class="booster-foil-tag">FOIL</span>' : ''}
                                        <span class="booster-rarity-pill rarity-${card.rarity}">${card.rarity.toUpperCase()}</span>
                                        <button type="button" class="inspect-mini-btn" onclick="event.stopPropagation(); window.inspectDraftCard('${card.id}')" title="Inspect 3D">🔍</button>
                                    </div>
                                    <div class="draft-card-signals">
                                        ${role.tags.map(t => `<span class="signal-badge badge-${t.type}">${t.label}</span>`).join('')}
                                    </div>
                                    <div class="draft-card-footer">
                                        <div class="draft-card-name" title="${card.name}">${card.name}</div>
                                        <button type="button" class="deck-card-action-btn add-btn">+ Add (${count})</button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `}
            </div>
        </div>
    `;
}

// Mount Deck Builder directly into any container
export function mountDeckBuilder(cards, formatId = 'traditional_draft', container = null) {
    myDraftedPool = (cards || []).map((c, idx) => {
        if (!c.uid) c.uid = `${c.id || 'card'}_${idx}_${c.name}`;
        return c;
    });

    const targetContainer = container || document.getElementById('boosterDraftRoot') || document.getElementById('content');
    if (!targetContainer) return;

    targetContainer.innerHTML = `
        <div class="booster-draft-container">
            <div class="draft-active-header">
                <div class="draft-header-left">
                    <span class="draft-badge-pill">🎴 Deck Builder</span>
                    <span class="draft-round-tag draft-complete-tag" style="background: rgba(34, 197, 94, 0.2); border-color: #22c55e; color: #4ade80;">
                        ✓ Interactive Deck Construction
                    </span>
                </div>
                <div class="draft-header-right">
                    <button class="preview-toggle-btn ${hoverPreviewEnabled ? 'active' : ''}" onclick="window.toggleHoverPreview()" title="Turn floating card hover preview on or off">
                        ${hoverPreviewEnabled ? '👁️ Preview: ON' : '👁️ Preview: OFF'}
                    </button>
                </div>
            </div>
            ${renderDraftDeckWorkspace(myDraftedPool, formatId)}
        </div>
    `;
}

// Refresh deck view across modes
function refreshDeckBuilderView() {
    const root = document.getElementById('boosterDraftRoot');
    if (root && currentDraftData) {
        renderActiveDraftRoomView(currentDraftData);
    } else {
        const content = document.getElementById('content');
        if (content && content.querySelector('.draft-deck-workspace')) {
            mountDeckBuilder(myDraftedPool, 'traditional_draft', content);
        }
    }
}

// Add/Remove cards between Main Deck and Sideboard
function addCardToMainDeck(cardName) {
    const unselectedCard = myDraftedPool.find(c => c.name === cardName && !mainDeckUids.has(c.uid));
    if (unselectedCard) {
        mainDeckUids.add(unselectedCard.uid);
        if (draftUtils?.playSound) draftUtils.playSound('sfx-click');
        refreshDeckBuilderView();
    }
}

function removeCardFromMainDeck(cardName) {
    const selectedCard = myDraftedPool.find(c => c.name === cardName && mainDeckUids.has(c.uid));
    if (selectedCard) {
        mainDeckUids.delete(selectedCard.uid);
        if (draftUtils?.playSound) draftUtils.playSound('sfx-click');
        refreshDeckBuilderView();
    }
}

function addAllCardsToDeck() {
    myDraftedPool.forEach(c => mainDeckUids.add(c.uid));
    if (draftUtils?.playSound) draftUtils.playSound('sfx-choose');
    refreshDeckBuilderView();
}

function clearMainDeck() {
    mainDeckUids.clear();
    addedBasicLands = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    if (draftUtils?.playSound) draftUtils.playSound('sfx-click');
    if (draftUtils?.showToast) draftUtils.showToast("🧹 Main Deck and Basic Lands reset to 0", false, 1500);
    refreshDeckBuilderView();
}

function setDeckSortMode(mode) {
    deckSortMode = mode;
    refreshDeckBuilderView();
}

function setDeckCardSize(size) {
    deckCardSize = size;
    try { localStorage.setItem('draftCardSize', size); } catch (e) {}
    refreshDeckBuilderView();
}

function setDeckLayoutMode(mode) {
    deckLayoutMode = mode;
    try { localStorage.setItem('draftDeckLayout', mode); } catch (e) {}
    if (draftUtils?.playSound) draftUtils.playSound('sfx-click');
    refreshDeckBuilderView();
}

function toggleHoverPreview() {
    hoverPreviewEnabled = !hoverPreviewEnabled;
    try { localStorage.setItem('draftHoverPreview', String(hoverPreviewEnabled)); } catch (e) {}
    const previewEl = document.getElementById('floatingCardPreview');
    if (previewEl && !hoverPreviewEnabled) {
        previewEl.style.display = 'none';
    }
    if (draftUtils?.playSound) draftUtils.playSound('sfx-click');
    if (draftUtils?.showToast) {
        draftUtils.showToast(hoverPreviewEnabled ? "👁️ Card Hover Preview: ON" : "Card Hover Preview: OFF", false, 1500);
    }
    refreshDeckBuilderView();
}

// Auto-add basic lands matching deck color curve
function autoAddBasicLands(formatId) {
    const targetSize = formatId === 'commander_draft' ? 60 : 40;
    const mainCards = myDraftedPool.filter(c => mainDeckUids.has(c.uid));
    const spellCount = mainCards.length;
    const landsNeeded = Math.max(0, targetSize - spellCount);

    if (landsNeeded === 0) {
        addedBasicLands = { W: 0, U: 0, B: 0, R: 0, G: 0 };
        refreshDeckBuilderView();
        return;
    }

    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    mainCards.forEach(c => {
        const cost = c.mana_cost || '';
        ['W', 'U', 'B', 'R', 'G'].forEach(col => {
            const matches = cost.match(new RegExp(col, 'g'));
            if (matches) pips[col] += matches.length;
        });
    });

    const totalPips = Object.values(pips).reduce((a, b) => a + b, 0);

    if (totalPips === 0) {
        const split = Math.floor(landsNeeded / 2);
        addedBasicLands = { W: split, U: landsNeeded - split, B: 0, R: 0, G: 0 };
    } else {
        const newLands = { W: 0, U: 0, B: 0, R: 0, G: 0 };
        let assigned = 0;
        ['W', 'U', 'B', 'R', 'G'].forEach(col => {
            if (pips[col] > 0) {
                const count = Math.round((pips[col] / totalPips) * landsNeeded);
                newLands[col] = count;
                assigned += count;
            }
        });

        let diff = landsNeeded - assigned;
        if (diff !== 0) {
            const highestColor = Object.entries(pips).sort((a, b) => b[1] - a[1])[0][0];
            newLands[highestColor] = Math.max(0, newLands[highestColor] + diff);
        }
        addedBasicLands = newLands;
    }

    if (draftUtils?.playSound) draftUtils.playSound('sfx-choose');
    if (draftUtils?.showToast) draftUtils.showToast(`✨ Auto-added ${landsNeeded} basic lands matching your deck!`, false, 2500);
    refreshDeckBuilderView();
}

// Basic land controls
function addDraftBasicLand(color) {
    if (addedBasicLands[color] !== undefined) addedBasicLands[color]++;
    refreshDeckBuilderView();
}

function removeDraftBasicLand(color) {
    if (addedBasicLands[color] && addedBasicLands[color] > 0) addedBasicLands[color]--;
    refreshDeckBuilderView();
}

// Copy Decklist to Clipboard
async function copyDraftDecklist() {
    const landNames = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
    const lines = ['// Main Deck'];

    // Identify draft set code
    const setCode = (currentDraftData?.setCode || myDraftedPool[0]?.set || '').toLowerCase();
    let setBasics = null;
    if (setCode) {
        try {
            setBasics = await getSetBasicLands(setCode);
        } catch (e) {
            console.warn("Could not load set basic lands:", e);
        }
    }

    const mainDeckCards = myDraftedPool.filter(c => mainDeckUids.has(c.uid));
    const mainDeckGroups = new Map();
    mainDeckCards.forEach(c => {
        const cardSet = (c.set || setCode || '').toUpperCase();
        const cardNum = c.collector_number != null ? String(c.collector_number) : '';
        const foilTag = c.isFoil ? ' *F*' : '';
        const key = `${c.name}|${cardSet}|${cardNum}|${foilTag}`;
        if (!mainDeckGroups.has(key)) {
            mainDeckGroups.set(key, { name: c.name, set: cardSet, num: cardNum, foil: c.isFoil, count: 0 });
        }
        mainDeckGroups.get(key).count++;
    });

    for (const item of mainDeckGroups.values()) {
        const setPart = item.set ? ` (${item.set})` : '';
        const numPart = item.num ? ` ${item.num}` : '';
        const foilPart = item.foil ? ' *F*' : '';
        lines.push(`${item.count} ${item.name}${setPart}${numPart}${foilPart}`);
    }

    // Add set-specific basic lands
    Object.entries(addedBasicLands).forEach(([sym, count]) => {
        if (count > 0) {
            const landName = landNames[sym];
            const basicPrints = setBasics?.[landName];
            if (basicPrints && basicPrints.length > 0) {
                const print = basicPrints[0];
                const setPart = print.set ? ` (${print.set.toUpperCase()})` : (setCode ? ` (${setCode.toUpperCase()})` : '');
                const numPart = print.collector_number ? ` ${print.collector_number}` : '';
                lines.push(`${count} ${landName}${setPart}${numPart}`);
            } else if (setCode) {
                lines.push(`${count} ${landName} (${setCode.toUpperCase()})`);
            } else {
                lines.push(`${count} ${landName}`);
            }
        }
    });

    const sideboardCards = myDraftedPool.filter(c => !mainDeckUids.has(c.uid));
    if (sideboardCards.length > 0) {
        lines.push('');
        lines.push('// Sideboard');
        const sideDeckGroups = new Map();
        sideboardCards.forEach(c => {
            const cardSet = (c.set || setCode || '').toUpperCase();
            const cardNum = c.collector_number != null ? String(c.collector_number) : '';
            const foilTag = c.isFoil ? ' *F*' : '';
            const key = `${c.name}|${cardSet}|${cardNum}|${foilTag}`;
            if (!sideDeckGroups.has(key)) {
                sideDeckGroups.set(key, { name: c.name, set: cardSet, num: cardNum, foil: c.isFoil, count: 0 });
            }
            sideDeckGroups.get(key).count++;
        });

        for (const item of sideDeckGroups.values()) {
            const setPart = item.set ? ` (${item.set})` : '';
            const numPart = item.num ? ` ${item.num}` : '';
            const foilPart = item.foil ? ' *F*' : '';
            lines.push(`${item.count} ${item.name}${setPart}${numPart}${foilPart}`);
        }
    }

    const deckText = lines.join('\n');
    navigator.clipboard.writeText(deckText).then(() => {
        if (draftUtils?.showToast) draftUtils.showToast("📋 Decklist copied with exact card art (Moxfield/TTS format)!", false, 3000);
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
    if (window.location.hash.startsWith('#draft-')) {
        window.history.replaceState(null, '', window.location.pathname);
    }
    renderDraftHubUI();
}

// Render Draft Complete & Final Deckbuilding View
function renderDraftDeckbuildingView(room, root) {
    const player = getPlayerIdentity();
    const playerData = getDraftPlayerData(room, player);
    const formatConfig = DRAFT_FORMATS[room.format] || DRAFT_FORMATS.commander_draft;
    myDraftedPool = (playerData.pool || []).map((c, idx) => {
        if (!c.uid) c.uid = `${c.id || 'card'}_${idx}_${c.name}`;
        return c;
    });

    root.innerHTML = `
        <div class="booster-draft-container">
            <div class="draft-active-header">
                <div class="draft-header-left">
                    <span class="draft-badge-pill">${formatConfig.icon} ${formatConfig.name}</span>
                    <span class="draft-round-tag draft-complete-tag" style="background: rgba(34, 197, 94, 0.2); border-color: #22c55e; color: #4ade80;">
                        ✓ Draft Complete
                    </span>
                </div>
                <div class="draft-header-right">
                    <button class="preview-toggle-btn ${hoverPreviewEnabled ? 'active' : ''}" onclick="window.toggleHoverPreview()" title="Turn floating card hover preview on or off">
                        ${hoverPreviewEnabled ? '👁️ Preview: ON' : '👁️ Preview: OFF'}
                    </button>
                    <span class="draft-room-code-tag">Room: ${room.code}</span>
                    <button class="breadcrumb-btn" onclick="window.leaveDraftRoom()" style="margin-left: 10px;">
                        <span>🚪</span> Exit Room
                    </button>
                </div>
            </div>

            <div class="draft-complete-announcement">
                <h2>🎉 Draft Finished! Build Your Deck:</h2>
                <p>Review your drafted pool, customize basic lands, analyze your mana curve, and export your decklist directly to Moxfield, MTGO, or MTG Arena.</p>
            </div>

            ${renderDraftDeckWorkspace(myDraftedPool, room.format)}
        </div>
    `;
}

// Render Rochester Open Face Snake Draft Arena
function renderRochesterDraftArena(room, player) {
    const playersList = getDraftPlayersList(room);
    const n = Math.max(1, playersList.length);
    const pack = room.activeRochesterPack || [];
    const packOpenedBy = room.packOpenedBy || 0;
    const snakePickIndex = room.snakePickIndex || 0;
    const packNum = room.packNumber || 1;
    const totalPacks = room.totalPacks || (n * 3);

    // Snake pick sequence: 0..n-1, n-1..0
    const cycleLen = Math.max(1, 2 * n);
    const cycle = snakePickIndex % cycleLen;
    let relativePicker = cycle < n ? cycle : (2 * n - 1 - cycle);
    const activePlayerIndex = (packOpenedBy + relativePicker) % n;
    const activePlayer = playersList[activePlayerIndex];
    const me = getDraftPlayerData(room, player);
    const isMyTurn = (activePlayer?.id === player.id) || (activePlayer?.id === me.id);

    return `
        <div class="draft-arena-card rochester-draft-arena">
            <div class="draft-arena-toolbar">
                <div class="pick-instruction">
                    ${isMyTurn 
                        ? `<span class="turn-highlight">👁️ <strong>YOUR TURN!</strong> Choose any face-up card from the table</span>` 
                        : `<span>⏳ Waiting for <strong>${activePlayer?.name || 'opponent'}</strong> to pick a card...</span>`}
                </div>
                <div class="grid-status-badge">
                    Pack <strong>${packNum}</strong> of <strong>${totalPacks}</strong> (${pack.length} cards left in pack)
                </div>
            </div>

            <div class="rochester-turn-order-bar">
                <span class="order-label">Snake Turn Order:</span>
                ${playersList.map((p, idx) => `
                    <span class="player-pass-chip ${idx === activePlayerIndex ? 'picking' : ''}">
                        ${idx === activePlayerIndex ? '🎯' : ''} ${p.name}
                    </span>
                `).join('')}
            </div>

            <div class="draft-pack-grid rochester-pack-grid">
                ${pack.map((card, idx) => {
                    const price = getCardPrice(card, 'usd');
                    return `
                        <div class="draft-card-item ${card.isFoil ? 'is-foil' : ''} ${isMyTurn ? 'rochester-selectable' : ''}" 
                             data-preview-img="${card.image_large || card.image}"
                             onclick="${isMyTurn ? `window.pickRochesterCard(${idx})` : ''}">
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
                            ${isMyTurn ? `
                                <button class="select-btn rochester-pick-btn" onclick="event.stopPropagation(); window.pickRochesterCard(${idx})">
                                    ✓ Draft Card
                                </button>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

// Handle Rochester Open Pack Pick
async function pickRochesterCard(cardIdx) {
    if (!currentDraftData || !currentDraftCode) return;
    const room = currentDraftData;
    const player = getPlayerIdentity();
    const playersList = getDraftPlayersList(room);
    const n = Math.max(1, playersList.length);
    const packOpenedBy = room.packOpenedBy || 0;
    const snakePickIndex = room.snakePickIndex || 0;

    const cycleLen = Math.max(1, 2 * n);
    const cycle = snakePickIndex % cycleLen;
    let relativePicker = cycle < n ? cycle : (2 * n - 1 - cycle);
    const activePlayerIndex = (packOpenedBy + relativePicker) % n;
    const activePlayer = playersList[activePlayerIndex];
    const me = getDraftPlayerData(room, player);
    const effectivePlayerId = me.id || player.id;

    if (activePlayer?.id !== player.id && activePlayer?.id !== me.id) return;

    const pack = [...(room.activeRochesterPack || [])];
    const pickedCard = pack[cardIdx];
    if (!pickedCard) return;

    pack.splice(cardIdx, 1);

    if (draftUtils?.playSound) draftUtils.playSound('sfx-choose');

    const myPool = [...(me.pool || []), pickedCard];

    if (pack.length === 0) {
        // Current pack completely drafted
        const remainingPacks = [...(room.rochesterPacks || [])];
        if (remainingPacks.length === 0) {
            // All Rochester packs finished!
            await update(ref(db, getDraftDbPath(currentDraftCode)), {
                status: 'complete',
                completedAt: Date.now(),
                activeRochesterPack: [],
                [`players/${effectivePlayerId}/pool`]: myPool
            });
        } else {
            // Open next pack on table
            const nextPack = remainingPacks.shift();
            const nextPackNumber = (room.packNumber || 1) + 1;
            const nextOpenedBy = (packOpenedBy + 1) % n;

            await update(ref(db, getDraftDbPath(currentDraftCode)), {
                packNumber: nextPackNumber,
                packOpenedBy: nextOpenedBy,
                snakePickIndex: 0,
                activeRochesterPack: nextPack,
                rochesterPacks: remainingPacks,
                [`players/${effectivePlayerId}/pool`]: myPool
            });
        }
    } else {
        // Advance to next pick in snake sequence
        await update(ref(db, getDraftDbPath(currentDraftCode)), {
            snakePickIndex: snakePickIndex + 1,
            activeRochesterPack: pack,
            [`players/${player.id}/pool`]: myPool
        });
    }
}
