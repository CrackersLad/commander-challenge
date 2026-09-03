import { db, auth } from './firebase-setup.js?v=4.3';
import { ref, get } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

export function initHubModule(utils, state, coreUi) {
    const { playSound, switchView, sanitizeHTML, getRoomCreationTime, getArchives, showToast } = utils;
    const { initDashboard, initLobby } = coreUi;

    window.quickRollCommander = async () => {
        playSound('sfx-click');
        const archives = await getArchives();
        if (!archives || archives.length === 0) return showToast("Archives not loaded yet. Try again in a moment.", true);

        const existingOverlay = document.getElementById('quickRollOverlay');
        if (existingOverlay) existingOverlay.remove();

        const overlay = document.createElement('div');
        overlay.id = 'quickRollOverlay';
        overlay.className = 'modal-overlay show';
        overlay.style.display = 'flex';
        overlay.style.zIndex = '9999';
        overlay.innerHTML = `
            <div class="modal-content" id="quickRollModalContent" style="background: #1a1a1a; padding: 20px; border-radius: 8px; border: 1px solid var(--gold); text-align: center; max-width: 400px; width: 90%; transition: transform 0.2s ease-out, opacity 0.2s ease-out;">
                <h3 style="color: var(--gold); margin-top: 0; font-family: Cinzel;">Quick Roll</h3>
                <div id="quickRollCardContainer">
                    <h4 id="quickRollCardName" style="color: white; margin-bottom: 15px; height: 22px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">&nbsp;</h4>
                    <div id="quickRollCardImage" style="height: 50vh; display:flex; align-items:center; justify-content:center;">
                    <img src="" class="commander-img" loading="eager" style="max-height: 50vh; margin-bottom: 10px; transition: filter 0.05s ease, transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
                    </div>
                </div>
                <div id="quickRollButtons" style="display: none; flex-direction: column; gap: 10px; justify-content: center; margin-top: 15px;"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        const cardNameEl = document.getElementById('quickRollCardName');
        const cardImageContainer = document.getElementById('quickRollCardImage');
        const buttonsEl = document.getElementById('quickRollButtons');
        const modalContentEl = document.getElementById('quickRollModalContent');

        let animationDuration = 2500;
        let startTime = Date.now();
        let interval = 50;
        
        // 1. Pick the final card ahead of time
        const finalCard = archives[Math.floor(Math.random() * archives.length)];
        
        // 2. Preload the final card's images immediately so it's ready when the spin ends
        let preImg1 = finalCard.image_uris?.normal || (finalCard.card_faces && finalCard.card_faces[0].image_uris?.normal) || finalCard.image1;
        let preImg2 = (finalCard.card_faces && finalCard.card_faces[1] && finalCard.card_faces[1].image_uris?.normal) || finalCard.image2 || null;
        if (preImg1) new Image().src = preImg1;
        if (preImg2) new Image().src = preImg2;

        function animateRoll() {
            if (!document.body.contains(overlay) || !overlay.classList.contains('show')) return;

            const elapsedTime = Date.now() - startTime;
            if (elapsedTime < animationDuration) {
                // 3. Use preloaded pool for smooth spinning frames, fallback to full archives
                const pool = (window.preloadedRollCards && window.preloadedRollCards.length > 0) ? window.preloadedRollCards : archives;
                const randomCard = pool[Math.floor(Math.random() * pool.length)];

                cardNameEl.textContent = sanitizeHTML(randomCard.name);
                const imgEl = cardImageContainer.querySelector('img');
                const imgUrl = randomCard.image_uris?.normal || (randomCard.card_faces && randomCard.card_faces[0].image_uris?.normal) || randomCard.image1;
                if (imgEl) {
                    imgEl.src = sanitizeHTML(imgUrl);
                    imgEl.style.filter = 'blur(4px) brightness(1.2)';
                    setTimeout(() => { if(imgEl) imgEl.style.filter = 'none'; }, Math.max(20, interval - 20));
                }
                
                playSound('sfx-click');

                interval = 50 + (elapsedTime / animationDuration) * 250;
                setTimeout(animateRoll, interval);
            } else {
                showFinalCard(finalCard);
            }
        }

        function showFinalCard(card) {
            playSound('sfx-reveal');
            modalContentEl.style.transform = 'scale(1.05)';
            setTimeout(() => modalContentEl.style.transform = 'scale(1)', 200);

            const safeName = sanitizeHTML(card.name);
            let img1 = card.image_uris?.normal || (card.card_faces && card.card_faces[0].image_uris?.normal) || card.image1;
            let img2 = (card.card_faces && card.card_faces[1] && card.card_faces[1].image_uris?.normal) || card.image2 || null;
            const edhrecSlug = safeName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const edhrecLink = `https://edhrec.com/commanders/${edhrecSlug}`;

            cardNameEl.textContent = safeName;

            let imageHtml = img2 
                ? `<div class="scene" style="margin:0 auto;"><div class="card-3d" id="quickroll-card3d"><a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" style="display:block;" class="card-face card-face-front"><img src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy" style="max-height: 50vh;"></a><a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" style="display:block;" class="card-face card-face-back"><img src="${sanitizeHTML(img2)}" class="commander-img" loading="lazy" style="max-height: 50vh;"></a></div></div><button class="flip-btn" style="margin: 10px auto;" onclick="window.flipCard3D('quickroll-card3d', event)">🔄 Flip Card</button>` 
                : `<a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')"><img src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy" style="max-height: 50vh; margin-bottom: 10px;"></a>`;
            
            cardImageContainer.innerHTML = imageHtml;

            buttonsEl.innerHTML = `
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button id="quickRollAgainBtn" class="select-btn" style="flex: 1; padding: 10px;">Roll Again</button>
                    <button id="closeQuickRollBtn" class="select-btn" style="flex: 1; padding: 10px; background: transparent; border: 1px solid #ff4444; color: #ff9999;">Close</button>
                </div>
            `;
            buttonsEl.style.display = 'flex';

            const close = () => { playSound('sfx-click'); overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 300); };
            document.getElementById('closeQuickRollBtn').onclick = close;
            document.getElementById('quickRollAgainBtn').onclick = () => { close(); setTimeout(() => window.quickRollCommander(), 300); };
        }

        animateRoll();
    };

    const quickRollBtn = document.getElementById('quickRollBtn');
    if (quickRollBtn) {
        quickRollBtn.onclick = window.quickRollCommander;
    }

    window.goToMainMenu = () => {
        playSound('sfx-click');
        state.currentRoom = null;
        localStorage.removeItem('roomCode');
        if (state.activeRoomListener) { state.activeRoomListener(); state.activeRoomListener = null; }
        if (state.activePlayerListener) { state.activePlayerListener(); state.activePlayerListener = null; }
        switchView('view-landing');
        window.history.pushState({}, '', window.location.pathname);
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

            let joinedRoomsList = [];
            try {
                joinedRoomsList = JSON.parse(localStorage.getItem('joinedRooms') || '[]');
            } catch(e) {}
            const currentSavedRoom = localStorage.getItem('roomCode') || state.currentRoom;
            const currentName = (state.currentPlayerName || localStorage.getItem('playerName') || '').trim().toLowerCase();
            const currentUid = auth.currentUser ? auth.currentUser.uid : null;

            Object.entries(rooms).forEach(([code, data]) => {
                if (!data.settings || !data.players) return; // Skip ghost rooms
                let matched = false;

                // 1. Direct Player ID match
                if (data.players[state.currentPlayerId]) {
                    matched = true;
                }
                // 2. Logged in UID match
                else if (currentUid && Object.entries(data.players).some(([id, p]) => id === currentUid || p.uid === currentUid)) {
                    matched = true;
                }
                // 3. Saved room in local joined history or current room
                else if (joinedRoomsList.includes(code) || currentSavedRoom === code) {
                    matched = true;
                }
                // 4. Name match in active playgroup
                else if (currentName && currentName !== 'player' && Object.values(data.players).some(p => p.name && p.name.trim().toLowerCase() === currentName)) {
                    matched = true;
                }

                if (matched) activeRooms.push({ code, data });
            });

            if (activeRooms.length === 0) {
                listEl.innerHTML = `
                    <div style="text-align:center; padding: 25px 15px; background: rgba(0,0,0,0.4); border-radius: 12px; border: 1px dashed rgba(212, 175, 55, 0.3);">
                        <h3 style="color:var(--gold); margin: 0 0 10px 0; font-family:Cinzel;">No Active Challenges</h3>
                        <p style="color:#ccc; font-size: 0.95rem; margin: 0 0 20px 0; line-height: 1.4;">Gather your playgroup, roll random commanders, brew on a budget, and track your victories!</p>
                        <div style="display:flex; justify-content:center; gap: 20px; font-size: 2rem;">
                            <span title="1. Roll">🎲</span> <span style="color:#555;">➔</span> <span title="2. Brew">🛠️</span> <span style="color:#555;">➔</span> <span title="3. Battle">⚔️</span>
                        </div>
                    </div>
                `;
                container.style.display = 'block';
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
                const playerCount = Object.keys(room.data.players || {}).length;
                const status = room.data.settings?.status === 'rolling' ? 'Drafting' : 'Waiting';
                const statusColor = status === 'Drafting' ? 'var(--reroll)' : '#2ecc71';
                
                const btn = document.createElement('div');
                btn.className = 'playgroup-rejoin-card';
                
                btn.innerHTML = `
                    <div class="playgroup-card-left">
                        <span class="playgroup-card-code">${room.code}</span>
                        <span class="playgroup-card-players">👥 ${playerCount}/6 Players</span>
                    </div>
                    <div class="playgroup-card-right">
                        <div class="playgroup-card-host">Host: <span>${sanitizeHTML(hostName)}</span></div>
                        <div class="playgroup-card-status" style="color:${statusColor}; border-color:${statusColor};">${status}</div>
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