import { db, auth } from './firebase-setup.js?v=19.34';
import { ref, get } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

export function initHubModule(utils, state, coreUi) {
    const { playSound, switchView, sanitizeHTML, getRoomCreationTime } = utils;
    const { initDashboard, initLobby } = coreUi;

    window.goToMainMenu = () => {
        playSound('sfx-click');
        state.currentRoom = null;
        localStorage.removeItem('roomCode');
        if (state.activeRoomListener) { state.activeRoomListener(); state.activeRoomListener = null; }
        if (state.activePlayerListener) { state.activePlayerListener(); state.activePlayerListener = null; }
        switchView('view-landing');
        window.history.pushState({}, '', '/');
        window.loadMyPlaygroups();
    };

    window.loadMyPlaygroups = async () => {
        const container = document.getElementById('myPlaygroupsContainer');
        const listEl = document.getElementById('myPlaygroupsList');
        if (!container || !listEl || !state.currentPlayerId) return;

        listEl.innerHTML = '<span style="color:#888; font-size:0.9rem;">Scanning archives for your playgroups...</span>';
        container.style.display = 'block';

        try {
            const snap = await get(ref(db, 'rooms'));
            const rooms = snap.val() || {};
            const activeRooms = [];

            Object.entries(rooms).forEach(([code, data]) => {
                let matched = false;
                if (data.players && data.players[state.currentPlayerId]) {
                    matched = true;
                } else if (auth.currentUser && !auth.currentUser.isAnonymous && data.players) {
                    // Check if any player in the room is linked to this user's UID, or if the ID itself is the UID (legacy sessions)
                    const isLinked = Object.keys(data.players).some(id => id === auth.currentUser.uid || data.players[id].uid === auth.currentUser.uid);
                    if (isLinked) matched = true;
                }
                if (matched) activeRooms.push({ code, data });
            });

            if (activeRooms.length === 0) {
                container.style.display = 'none';
                return;
            }

            activeRooms.sort((a, b) => {
                const tA = getRoomCreationTime(a.data) || 0;
                const tB = getRoomCreationTime(b.data) || 0;
                return tB - tA;
            });

            listEl.innerHTML = '';
            const renderedCodes = new Set();
            activeRooms.forEach(room => {
                if (renderedCodes.has(room.code)) return;
                renderedCodes.add(room.code);
                
                const hostName = Object.values(room.data.players).find(p => p.isHost)?.name || "Unknown";
                const status = room.data.settings?.status === 'rolling' ? 'Drafting' : 'Waiting';
                const color = status === 'Drafting' ? 'var(--reroll)' : '#aaa';
                
                const btn = document.createElement('button');
                btn.className = 'select-btn playgroup-rejoin-btn';
                btn.style.padding = '12px 15px';
                btn.style.fontSize = '0.95rem';
                
                btn.innerHTML = `
                    <span class="playgroup-rejoin-btn-code">${room.code}</span>
                    <div class="playgroup-rejoin-btn-details">
                        <div class="host">Host: <span>${sanitizeHTML(hostName)}</span></div>
                        <div class="status" style="color:${color};">${status}</div>
                    </div>
                `;
                
                btn.onclick = () => {
                    playSound('sfx-click');
                    
                    // Cross-device sync check
                    if (!room.data.players[state.currentPlayerId] && auth.currentUser && !auth.currentUser.isAnonymous) {
                        const linkedId = Object.keys(room.data.players).find(id => id === auth.currentUser.uid || room.data.players[id].uid === auth.currentUser.uid);
                        if (linkedId) {
                            const codeInput = document.getElementById('roomCodeInput');
                            const nameInput = document.getElementById('playerNameInput');
                            if (codeInput && nameInput) { codeInput.value = room.code; nameInput.value = room.data.players[linkedId].name; document.getElementById('joinBtn').click(); }
                            return;
                        }
                    }
                    // Fast transition using existing ID
                    state.currentRoom = room.code; localStorage.setItem('roomCode', room.code);
                    const me = room.data.players[state.currentPlayerId] || Object.values(room.data.players).find(p => p.uid === auth.currentUser?.uid);
                    if (me) { state.currentPlayerName = me.name; state.isHost = me.isHost === true; localStorage.setItem('playerName', me.name); localStorage.setItem('isHost', state.isHost ? 'true' : 'false'); }
                    room.data.settings?.status === 'rolling' ? initDashboard() : initLobby();
                };
                listEl.appendChild(btn);
            });
        } catch (err) { console.error(err); listEl.innerHTML = '<span style="color:#ff4444; font-size:0.9rem;">Failed to load playgroups.</span>'; }
    };
}