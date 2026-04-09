import { db, auth, functions } from './firebase-setup.js?v=19.8';
import { fetchDeckPriceLocal } from './deck-parser.js?v=19.8';
import { initAdminModule } from './admin.js?v=19.8';
import { initCalendarModule } from './calendar.js?v=19.8';
import { initAuthModule } from './auth.js?v=19.8';
import { initHubModule } from './hub.js?v=19.8';
import { initProfileModule } from './profile.js?v=19.8';
import { ref, set, get, onValue, update, remove, increment, runTransaction } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-functions.js";

// Optimize for mobile/WebView: Ensure viewport is set correctly
if (!document.querySelector('meta[name="viewport"]')) {
    const meta = document.createElement('meta');
    meta.name = "viewport";
    meta.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";
    document.head.appendChild(meta);
}

let currentRoom = localStorage.getItem('roomCode') || null;
let currentPlayerId = localStorage.getItem('playerId') || 'temp_' + Date.now().toString();
let currentPlayerName = localStorage.getItem('playerName') || "";
let currentPlayerAvatar = localStorage.getItem('playerAvatar') || null;
let isHost = localStorage.getItem('isHost') === 'true';

// --- GLOBAL EVENT LISTENERS ---
document.addEventListener('click', function(event) {
    // Dropdown toggle logic
    const moreActionsBtn = document.getElementById('moreActionsBtn');
    if (moreActionsBtn && moreActionsBtn.contains(event.target)) {
        document.getElementById('moreActionsDropdown').parentElement.classList.toggle('show');
        return;
    }

    // Close dropdown if clicking outside
    const dropdowns = document.getElementsByClassName("dropdown");
    for (let i = 0; i < dropdowns.length; i++) {
        const openDropdown = dropdowns[i];
        if (openDropdown.classList.contains('show') && !openDropdown.contains(event.target)) {
            openDropdown.classList.remove('show');
        }
    }

    // Modal background click
    if (event.target.classList.contains('modal-overlay')) {
        playSound('sfx-click');
        event.target.classList.remove('show');
        setTimeout(() => event.target.style.display = 'none', 300);
    }
});

const initialNameInput = document.getElementById('playerNameInput');
if (initialNameInput && currentPlayerName) initialNameInput.value = currentPlayerName;

let activeRoomListener = null;
let activePlayerListener = null;
let activeUserProfileListener = null;
let isSearchingManually = false;

function sanitizeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

function getRoomCreationTime(data) {
    if(!data) return null;
    if(data.settings && data.settings.createdAt) return data.settings.createdAt;
    if(data.players) {
        const hostEntry = Object.entries(data.players).find(([k, v]) => v.isHost);
            if(hostEntry) {
                const parsedTime = parseInt(hostEntry[0]);
                // Only use the Host ID if it is actually a valid timestamp (e.g. > Year 2020)
                if (!isNaN(parsedTime) && parsedTime > 1600000000000) return parsedTime;
            }
    }
    return null;
}

onValue(ref(db, 'stats'), (snap) => {
    const data = snap.val() || { totalPlayers: 0, activeRooms: 0, commandersRolled: 0 };
    const pEl = document.getElementById('stat-players');
    const rEl = document.getElementById('stat-rooms');
    const cEl = document.getElementById('stat-rolled');
    
    if (pEl) pEl.innerText = data.totalPlayers || 0;
    if (rEl) rEl.innerText = data.activeRooms || 0;
    if (cEl) cEl.innerText = data.commandersRolled || 0;

    // Mobile optimization: Find the fixed stats container and apply the mobile class
    if (pEl) {
        let parent = pEl.parentElement;
        for(let i=0; i<4; i++) {
            if(!parent || parent.tagName === 'BODY') break;
            const style = window.getComputedStyle(parent);
            if (style.position === 'fixed' || style.position === 'absolute') {
                parent.classList.add('mobile-stats-container');
                break;
            }
            parent = parent.parentElement;
        }
    }
});

const sfxToggle = document.getElementById('sfxToggle');

let isSfxMuted = localStorage.getItem('draft_sfx') === 'true';

function applyAudioUI() {
    if (isSfxMuted) {
        sfxToggle.innerText = "🔇 SFX"; sfxToggle.style.color = "#ff9999"; sfxToggle.style.borderColor = "#ff4444";
    } else {
        sfxToggle.innerText = "🔊 SFX"; sfxToggle.style.color = "var(--gold)"; sfxToggle.style.borderColor = "var(--gold)";
    }
}
applyAudioUI();

const mobileSettingsToggle = document.getElementById('mobileSettingsToggle');
if (mobileSettingsToggle) {
    mobileSettingsToggle.onclick = () => {
        const controls = document.getElementById('audioControls');
        if(controls) controls.classList.toggle('show');
        playSound('sfx-click');
    };
}

const draftFormatEl = document.getElementById('settingDraftFormat');
const selectionModeContainer = document.getElementById('selectionModeContainer');
const selectionModeEl = document.getElementById('settingSelectionMode');
const randomSettingsEl = document.getElementById('randomSettingsContainer');
const rerollsContainer = document.getElementById('rerollsContainer');
const numOptionsLabel = document.getElementById('numOptionsLabel');

function updateSettingsVisibility() {
    const isInteractive = draftFormatEl && draftFormatEl.value !== 'independent';
    const isManual = selectionModeEl && selectionModeEl.value === 'manual';

    if(selectionModeContainer) selectionModeContainer.style.display = isInteractive ? 'none' : 'block';
    if(rerollsContainer) rerollsContainer.style.display = isInteractive ? 'none' : 'flex';
    if(numOptionsLabel) numOptionsLabel.innerText = isInteractive ? "Pack Size (1-5):" : "Options (1-5):";
    
    if (randomSettingsEl) randomSettingsEl.style.display = (!isInteractive && isManual) ? 'none' : 'block';
}
if (draftFormatEl) draftFormatEl.addEventListener('change', updateSettingsVisibility);
if (selectionModeEl) selectionModeEl.addEventListener('change', updateSettingsVisibility);
updateSettingsVisibility();

export function playSound(soundId) {
    if (isSfxMuted) return; 
    const sound = document.getElementById(soundId);
    if (sound) { sound.currentTime = 0; sound.volume = soundId === 'sfx-choose' ? 0.35 : 0.2; sound.play().catch(()=>{}); }
}

sfxToggle.onclick = () => {
    isSfxMuted = !isSfxMuted; localStorage.setItem('draft_sfx', isSfxMuted); applyAudioUI(); playSound('sfx-click'); 
};

let toastTimeout;
function showToast(msg, isError = false, duration = 3000, isSuccess = false) {
    const toast = document.getElementById('toast-container');
    toast.innerText = msg;
    toast.className = 'toast show ' + (isError ? 'error' : (isSuccess ? 'success' : ''));
    clearTimeout(toastTimeout);
    if (duration > 0) {
        toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
    }
}

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    window.scrollTo(0, 0);
}

window.openAccountModal = () => {
    playSound('sfx-click');
    const modal = document.getElementById('accountModal');
    modal.style.display = 'flex'; setTimeout(() => modal.classList.add('show'), 10);
};

window.openRulesModal = async () => {
    playSound('sfx-click');
    const modal = document.getElementById('rulesModal');
    const listDiv = document.getElementById('rulesList');
    modal.style.display = 'flex'; setTimeout(() => modal.classList.add('show'), 10);

    try {
        const snap = await get(ref(db, `rooms/${currentRoom}/settings`));
        const s = snap.val();
        if (!s) { listDiv.innerHTML = '<p style="color:#aaa;">No rules found.</p>'; return; }

        let curr = s.currency === 'usd' ? '$' : '€';
        let formatName = 'Independent';
        if (s.draftFormat === 'async_draft') formatName = 'Asynchronous Booster Draft';
        if (s.draftFormat === 'snake_draft') formatName = 'Face-Up Snake Draft';
        if (s.draftFormat === 'burn_draft') formatName = 'Blind Elimination Draft';
        
        let html = `
            <p style="margin: 8px 0;"><strong style="color:var(--gold);">Format:</strong> ${formatName}</p>
            <p style="margin: 8px 0;"><strong style="color:var(--gold);">Selection:</strong> ${s.selectionMode === 'both' ? 'Random & Manual' : (s.selectionMode === 'random' ? 'Random Only' : 'Manual Only')}</p>
            <p style="margin: 8px 0;"><strong style="color:var(--gold);">Cmdr Budget:</strong> ${parseFloat(s.budget) === 0 ? 'Any' : curr + s.budget}</p>
            <p style="margin: 8px 0;"><strong style="color:var(--gold);">Deck Limit:</strong> ${parseFloat(s.deckBudget) === 0 ? 'Any' : curr + s.deckBudget} <span style="font-size:0.8rem; color:#aaa;">(${s.includeCmdr !== false ? 'Includes' : 'Excludes'} Cmdr)</span></p>
            <p style="margin: 8px 0;"><strong style="color:var(--gold);">Max Bracket:</strong> ${s.maxBracket || 5}</p>
            <p style="margin: 8px 0;"><strong style="color:var(--gold);">EDHREC Rank:</strong> ${
                (s.maxRank === 0 && s.minRank === 0) ? 'Any' :
                (s.maxRank === 0) ? `Up to #${s.minRank}` :
                (s.minRank === 0) ? `#${s.maxRank} or worse` :
                `#${s.maxRank} - #${s.minRank}`
            }</p>
            <p style="margin: 8px 0;"><strong style="color:var(--gold);">Partners:</strong> ${s.noPartner ? 'Banned ❌' : 'Allowed ✅'}</p>
        `;
        
        if (s.draftFormat === 'independent') {
            html += `<p style="margin: 8px 0;"><strong style="color:var(--gold);">Options Given:</strong> ${s.numOptions}</p>
                     <p style="margin: 8px 0;"><strong style="color:var(--gold);">Rerolls Allowed:</strong> ${s.maxRerolls}</p>`;
        } else {
            html += `<p style="margin: 8px 0;"><strong style="color:var(--gold);">Pack Size:</strong> ${s.numOptions}</p>`;
        }
        
        if (s.blindDraft) html += `<p style="margin: 8px 0;"><strong style="color:var(--gold);">Blind Draft:</strong> Yes 🙈</p>`;

        listDiv.innerHTML = html;
    } catch(e) { listDiv.innerHTML = '<p style="color:#ff4444;">Failed to load rules.</p>'; }
};

window.copyRoomCode = () => {
    if(currentRoom) {
        const url = new URL(window.location.href);
        url.searchParams.set('room', currentRoom);
        navigator.clipboard.writeText(url.toString()).then(() => { playSound('sfx-click'); showToast("Invite Link copied to clipboard!", false, 3000, true); });
    }
};

window.openWebhookModal = async () => {
    playSound('sfx-click');
    
    let currentWebhook = '';
    try {
        // This might fail if Firebase security rules restrict read access to webhooks
        const snap = await get(ref(db, `webhooks/${currentRoom}/url`));
        currentWebhook = snap.val() || '';
    } catch (e) {
        console.warn("Could not read existing webhook (likely due to security rules).", e);
    }

    // Create a custom modal overlay to replace the native browser prompt
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '9999';
    
    overlay.innerHTML = `
        <div class="modal-content" style="background: #1a1a1a; padding: 20px; border-radius: 8px; border: 1px solid var(--gold); text-align: center; max-width: 400px; width: 90%;">
            <h3 style="color: var(--gold); margin-top: 0; font-family: Cinzel;">Discord Webhook</h3>
            <p style="color: #ccc; font-size: 0.9rem; margin-bottom: 15px;">Enter your Discord Webhook URL below. Leave blank to remove.</p>
            <input type="text" id="customWebhookInput" value="${currentWebhook}" placeholder="https://discord.com/api/webhooks/..." style="width: 100%; padding: 10px; box-sizing: border-box; margin-bottom: 20px; background: #000; border: 1px solid #444; color: white; border-radius: 4px;">
            <div style="display: flex; gap: 10px; justify-content: center;">
                <button id="saveWebhookBtn" class="select-btn" style="flex: 1; padding: 10px;">Save</button>
                <button id="cancelWebhookBtn" class="select-btn" style="flex: 1; padding: 10px; background: transparent; border: 1px solid #ff4444; color: #ff9999;">Cancel</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    const input = document.getElementById('customWebhookInput');
    const saveBtn = document.getElementById('saveWebhookBtn');
    const cancelBtn = document.getElementById('cancelWebhookBtn');
    
    setTimeout(() => input.focus(), 50);

    const close = () => {
        playSound('sfx-click');
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 300);
    };

    cancelBtn.onclick = close;
    
    saveBtn.onclick = async () => {
        playSound('sfx-click');
        const urlToSave = input.value.trim();
        
        if (urlToSave && !urlToSave.startsWith("https://discord.com/api/webhooks/")) {
            return showToast("Invalid Discord Webhook URL.", true);
        }
        
        saveBtn.disabled = true;
        saveBtn.innerText = "Saving...";
        
        try {
            await set(ref(db, `webhooks/${currentRoom}/url`), urlToSave || null);
            showToast("Discord Webhook updated!", false, 3000, true);
            close();
        } catch(e) {
            showToast("Error saving webhook: " + e.message, true);
            saveBtn.disabled = false;
            saveBtn.innerText = "Save";
        }
    };
};

function showConfirm(title, text, confirmCallback) {
    const overlay = document.getElementById('confirmModal');
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalText').innerText = text;
    const btnConfirm = document.getElementById('modalConfirm');
    const btnCancel = document.getElementById('modalCancel');

    btnConfirm.onclick = () => {
        playSound('sfx-click'); overlay.classList.remove('show'); setTimeout(() => { overlay.style.display = 'none'; }, 300); confirmCallback(); 
    };
    btnCancel.onclick = () => {
        playSound('sfx-click'); overlay.classList.remove('show'); setTimeout(() => { overlay.style.display = 'none'; }, 300);
    };
    overlay.style.display = 'flex'; setTimeout(() => overlay.classList.add('show'), 10);
}

function clearSession() {
    localStorage.removeItem('roomCode');
    localStorage.removeItem('isHost');
}

window.leaveChallenge = () => {
    playSound('sfx-click');
    showConfirm(
        isHost ? "Disband Playgroup?" : "Leave Playgroup?", 
        isHost ? "As the Host, leaving will close the playgroup and kick everyone out. Are you sure?" : "Are you sure you want to leave this playgroup?", 
        async () => {
            playSound('sfx-click');
            if (isHost) {
                await remove(ref(db, `rooms/${currentRoom}`));
                await remove(ref(db, `webhooks/${currentRoom}`));
            } else {
                await remove(ref(db, `rooms/${currentRoom}/players/${currentPlayerId}`));
            }
            clearSession();
            currentRoom = null; isHost = false;
            if (activeRoomListener) { activeRoomListener(); activeRoomListener = null; }
            if (activePlayerListener) { activePlayerListener(); activePlayerListener = null; }
            switchView('view-landing'); showToast("You have left the playgroup.");
            window.loadMyPlaygroups();
        }
    );
};

window.resetToLobby = () => {
    playSound('sfx-click');
    showConfirm("Return to Lobby?", "This will wipe all current rolls and return everyone to the waiting room. Are you sure?", async () => {
        playSound('sfx-choose');
        try {
            const resetFn = httpsCallable(functions, 'hostResetLobby');
            await resetFn({ roomId: currentRoom });
            showToast("Challenge Reset.", false, 3000, true);
        } catch(e) {
            showToast("Failed to reset lobby: " + e.message, true);
        }
    });
};

window.kickPlayer = (id) => {
    playSound('sfx-click');
    showConfirm("Kick Player?", "Are you sure you want to remove this player from the challenge?", async () => {
        playSound('sfx-click'); 
        try {
            const kickFn = httpsCallable(functions, 'hostKickPlayer');
            await kickFn({ roomId: currentRoom, targetId: id });
            showToast("Player removed.", false, 3000, true);
        } catch(e) {
            showToast("Failed to kick player: " + e.message, true);
        }
    });
};

window.clearPlayer = (id) => {
    playSound('sfx-click');
    showConfirm("Clear Selection?", "Force this player to reroll their commander?", async () => {
        playSound('sfx-choose');
        try {
            const clearFn = httpsCallable(functions, 'hostClearPlayer');
            await clearFn({ roomId: currentRoom, targetId: id });
            showToast("Player selection wiped.", false, 3000, true);
        } catch(e) {
            showToast("Failed to clear player: " + e.message, true);
        }
    });
};

window.refreshMyDeckPrice = async () => {
    playSound('sfx-click');
    const roomSnap = await get(ref(db, `rooms/${currentRoom}`));
    const roomData = roomSnap.val();
    const myData = roomData?.players?.[currentPlayerId];
    const settings = roomData?.settings;

    if (!myData || !myData.deck || !settings) {
        return showToast("Could not find your deck to refresh.", true);
    }

    const isMoxfield = myData.deck && myData.deck.toLowerCase().includes("moxfield.com");
    showToast(isMoxfield ? "Recalculating deck price... (Moxfield APIs may take a few seconds)" : "Recalculating deck price...", false, 0);
    try {
        const res = await fetchDeckPriceLocal(myData.deck, settings.currency || 'eur', settings.includeCmdr !== false, myData.selected);
        if (res && !res.error) {
            let updates = {
                deckPrice: res.total,
                isLegal: res.isLegal,
                deckSize: res.deckSize,
                deckSalt: res.deckSalt
            };
            if (res.commanderArt) updates.image = res.commanderArt;

            const maxDeckBudget = settings.deckBudget !== undefined ? parseFloat(settings.deckBudget) : 50;
            const isNowReady = res.isLegal && (maxDeckBudget === 0 || res.total <= maxDeckBudget);
            if (isNowReady && myData.lockedDeckPrice === undefined) {
                updates.lockedDeckPrice = res.total;
            }

            await update(ref(db, `rooms/${currentRoom}/players/${currentPlayerId}`), updates);

            showToast("Deck price updated!", false, 3000, true);
        } else {
            showToast(res.error || "Failed to update price.", true);
        }
    } catch (err) {
        console.error("Refresh failed for", myData.name, err);
        showToast("An error occurred during refresh.", true);
    }
};

window.lockMyDeckPrice = async () => {
    playSound('sfx-click');
    const snap = await get(ref(db, `rooms/${currentRoom}/players/${currentPlayerId}`));
    const myData = snap.val();
    if (!myData || myData.deckPrice === undefined) return showToast("No deck price to lock.", true);

    showConfirm(
        "Lock In Deck Cost?", 
        `This will overwrite your currently locked price with the current price of ${myData.deckPrice.toFixed(2)}. Are you sure?`, 
        async () => {
            playSound('sfx-choose');
            await update(ref(db, `rooms/${currentRoom}/players/${currentPlayerId}`), { lockedDeckPrice: myData.deckPrice });
            showToast("Deck price locked!", false, 3000, true);
        }
    );
};

window.copyMatchSummary = async () => {
    playSound('sfx-click');
    const snap = await get(ref(db, `rooms/${currentRoom}`));
    const data = snap.val();
    if (!data || !data.players) return showToast("No data to copy.", true);

    let text = `⚔️ Commander Draft Challenge (Room: ${currentRoom}) ⚔️\n`;
    const cTime = getRoomCreationTime(data);
    if (cTime) {
        text += `Created: ${new Date(cTime).toLocaleString()}\n`;
    }
    text += `Generated on: ${new Date().toLocaleString()}\n\n`;
    
    const players = data.players;
    const history = data.history || {};
    const winCounts = {};
    Object.values(history).forEach(h => {
        if (h.winnerId) winCounts[h.winnerId] = (winCounts[h.winnerId] || 0) + 1;
    });

    const sortedIds = Object.keys(players).sort((a,b) => {
        if(players[a].isHost) return -1;
        if(players[b].isHost) return 1;
        return (players[a].name || "").localeCompare(players[b].name || "");
    });

    const isBlind = data.settings?.blindDraft === true;
    const allLocked = Object.values(players).every(p => p.selected);

    sortedIds.forEach(id => {
        const p = players[id];
        const hideInfo = isBlind && !allLocked && id !== currentPlayerId;
        let roleIcon = p.isHost ? '👑' : '👤';
        let trophyIcon = winCounts[id] ? ` ${'🏆'.repeat(winCounts[id])}` : '';
        let nameLabel = `${roleIcon}${trophyIcon} ${p.name}`;

        if (p.selected) {
            if (hideInfo) {
                text += `${nameLabel}: ??? (Mysterious Commander)\n   🔗 (Link hidden)\n\n`;
            } else {
                let curr = data.settings?.currency === 'usd' ? '$' : '€';
                let priceText = p.lockedDeckPrice !== undefined ? `(🔒 ${curr}${p.lockedDeckPrice.toFixed(2)})` : (p.deckPrice ? `(${curr}${p.deckPrice.toFixed(2)})` : '');
                let saltText = p.deckSalt !== undefined ? ` [☣️ Salt: ${Number(p.deckSalt).toFixed(1)}]` : '';
                text += `${nameLabel}: ${p.selected} ${priceText}${saltText}\n   🔗 ${p.deck || 'No Link'}\n\n`;
            }
        }
        else text += `${nameLabel}: Drafting...\n\n`;
    });

    navigator.clipboard.writeText(text).then(() => showToast("Match Summary copied!", false, 3000, true))
    .catch(() => showToast("Failed to copy.", true));
};

document.getElementById('createBtn').onclick = async () => {
    playSound('sfx-click');

    const name = document.getElementById('playerNameInput').value.trim();
    if(!name) return showToast("Enter a name first!", true);
    const safeName = sanitizeHTML(name);
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    const pId = currentPlayerId; 

    await set(ref(db, `rooms/${roomCode}/settings`), { budget: 10, currency: 'eur', deckBudget: 50, includeCmdr: true, maxRank: 1, minRank: 500, noPartner: true, numOptions: 3, maxRerolls: 1, selectionMode: 'both', draftFormat: 'independent', maxBracket: 5, status: 'waiting', createdAt: Date.now() });
    
    const hostPayload = { name: safeName, isHost: true, avatar: currentPlayerAvatar || null };
    if (auth.currentUser) hostPayload.uid = auth.currentUser.uid;
    await set(ref(db, `rooms/${roomCode}/players/${pId}`), hostPayload);

    localStorage.setItem('roomCode', roomCode); localStorage.setItem('playerId', pId); localStorage.setItem('playerName', safeName); localStorage.setItem('isHost', 'true');
    if (!auth.currentUser || auth.currentUser.isAnonymous) localStorage.setItem('guestName', safeName);
    currentRoom = roomCode; currentPlayerId = pId; currentPlayerName = safeName; isHost = true;
    initLobby();
};

document.getElementById('joinBtn').onclick = async () => {
    playSound('sfx-click');

    const name = document.getElementById('playerNameInput').value.trim();
    const code = sanitizeHTML(document.getElementById('roomCodeInput').value.trim().toUpperCase());
    if(!name || !code) return showToast("Name and Room Code required!", true);
    const safeName = sanitizeHTML(name);

    const roomSnap = await get(ref(db, `rooms/${code}`));
    if(!roomSnap.exists()) return showToast("Playgroup not found!", true);
    
    const roomData = roomSnap.val();
    
    // Check if this player already exists in the room (Rejoin Logic)
    let existingId = null;
    let existingData = null;

    if (roomData.players) {
        const foundEntry = Object.entries(roomData.players).find(([k, v]) => v.name.toLowerCase() === safeName.toLowerCase());
        if (foundEntry) {
            existingId = foundEntry[0];
            existingData = foundEntry[1];
        }
    }

    if (existingId) {
        showConfirm("Rejoin Playgroup?", `Player "${existingData.name}" is already in this playgroup. Is this you?`, async () => {
            playSound('sfx-click');
            
            if (existingId !== currentPlayerId) {
                // Adopt the existing ID on this device so both devices share the same session
                currentPlayerId = existingId;
                localStorage.setItem('playerId', existingId);
                
                // Update the avatar just in case it changed on this new device
                await update(ref(db, `rooms/${code}/players/${existingId}`), { avatar: currentPlayerAvatar || null });
            }

            localStorage.setItem('roomCode', code);
            localStorage.setItem('playerId', currentPlayerId);
            localStorage.setItem('playerName', existingData.name);
            localStorage.setItem('isHost', existingData.isHost ? 'true' : 'false');
            if (!auth.currentUser || auth.currentUser.isAnonymous) localStorage.setItem('guestName', existingData.name);
            
            currentRoom = code; currentPlayerName = existingData.name; isHost = existingData.isHost === true;
            showToast("Welcome back!", false, 3000, true);
            
            // Re-fetch updated data to determine where to go
            const latestSnap = await get(ref(db, `rooms/${code}`));
            if (latestSnap.exists()) {
                latestSnap.val().settings.status === 'rolling' ? initDashboard() : initLobby();
            }
        });
        return;
    }

    if (roomData.settings.status === 'rolling' && roomData.settings.draftFormat !== 'independent') {
        return showToast("An interactive draft is currently in progress. You cannot join mid-draft!", true);
    }

    if (roomData.players && Object.keys(roomData.players).length >= 6) return showToast("Playgroup is full! (Max 6 players)", true);

    const pId = currentPlayerId;
    const pPayload = { name: safeName, isHost: false, avatar: currentPlayerAvatar || null };
    if (auth.currentUser) pPayload.uid = auth.currentUser.uid;
    await set(ref(db, `rooms/${code}/players/${pId}`), pPayload);

    localStorage.setItem('roomCode', code); localStorage.setItem('playerId', pId); localStorage.setItem('playerName', safeName); localStorage.setItem('isHost', 'false');
    if (!auth.currentUser || auth.currentUser.isAnonymous) localStorage.setItem('guestName', safeName);
    currentRoom = code; currentPlayerId = pId; currentPlayerName = safeName; isHost = false;

    if(roomData.settings.status === 'rolling') initDashboard();
    else initLobby();
};

function initLobby() {
    switchView('view-lobby');
    document.getElementById('displayRoomCode').innerText = currentRoom;

    if(isHost) {
        document.getElementById('hostSettingsUI').style.display = 'block';
        document.getElementById('waitingMessage').style.display = 'none';
        
        const dropdown = document.getElementById('moreActionsDropdown');
        const existingBtn = document.getElementById('updateWebhookBtn');
        if (dropdown && !existingBtn) {
            const webhookBtn = document.createElement('a');
            webhookBtn.href = '#';
            webhookBtn.id = 'updateWebhookBtn';
            webhookBtn.innerText = '⚙️ Update Webhook';
            webhookBtn.onclick = (e) => {
                e.preventDefault();
                dropdown.parentElement.classList.remove('show');
                window.openWebhookModal();
            };
            dropdown.appendChild(webhookBtn);
        }
        
        getArchives().then(archives => {
            if (archives && archives.length > 0) {
                const rankInfoEl = document.getElementById('rankRangeInfo');
                if (rankInfoEl) {
                    rankInfoEl.innerText = `(Max: ${archives.length})`;
                }
            }
        });
    } else {
        document.getElementById('hostSettingsUI').style.display = 'none';
        document.getElementById('waitingMessage').style.display = 'block';
    }

    if(activeRoomListener) activeRoomListener(); 

    activeRoomListener = onValue(ref(db, `rooms/${currentRoom}`), (snap) => {
        const data = snap.val();
        
        if(!data || !data.players || !data.players[currentPlayerId]) {
            if(currentRoom) { 
                clearSession();
                currentRoom = null; isHost = false;
                switchView('view-landing'); showToast("You have been removed from the playgroup.", true);
                window.loadMyPlaygroups();
            }
            return;
        }

        const listEl = document.getElementById('lobbyPlayerList');
        const countEl = document.getElementById('playerCountDisplay');
        listEl.innerHTML = "";
        
        if(data.players) {
            const playerCount = Object.keys(data.players).length;
            const history = data.history || {};
            const winCounts = {};
            Object.values(history).forEach(h => {
                if (h.winnerId) winCounts[h.winnerId] = (winCounts[h.winnerId] || 0) + 1;
            });
            
            const cTime = getRoomCreationTime(data);
            const timeEl = document.getElementById('lobbyCreatedTime');
            if(timeEl) timeEl.innerText = cTime ? `Opened: ${new Date(cTime).toLocaleString()}` : "";

            if(countEl) countEl.innerText = `Players Assembled (${playerCount}/6):`;

            Object.entries(data.players).forEach(([id, p]) => {
                const safeName = sanitizeHTML(p.name);
                let avatarHtml = p.avatar ? `<img src="${sanitizeHTML(p.avatar)}" style="width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--gold); object-fit: cover;">` : (p.isHost ? '👑' : '👤');
                let hostIcon = (p.avatar && p.isHost) ? ' 👑' : '';
                let trophies = winCounts[id] ? ` <span title="${winCounts[id]} Wins" style="font-size:0.9rem;">${'🏆'.repeat(winCounts[id])}</span>` : '';
                let guestTag = p.uid ? '' : ' <span style="color:#888; font-size:0.8rem; font-family:\'Segoe UI\';">(Guest)</span>';
                listEl.innerHTML += `<li>${avatarHtml} ${safeName}${hostIcon}${trophies}${guestTag}</li>`;
            });
        }

        if(data.settings.status === 'rolling' && document.getElementById('view-lobby').classList.contains('active')) {
            initDashboard();
        }
    });
}

function setupLimitToggle(toggleId, inputIds) {
    const toggle = document.getElementById(toggleId);
    if (toggle) {
        const updateInputs = () => {
            inputIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.disabled = !toggle.checked;
                    el.style.opacity = toggle.checked ? '1' : '0.5';
                }
            });
        };
        toggle.addEventListener('change', updateInputs);
        updateInputs();
    }
}

setupLimitToggle('toggleCmdrBudget', ['settingBudget']);
setupLimitToggle('toggleDeckBudget', ['settingDeckBudget']);
setupLimitToggle('toggleRank', ['settingMin', 'settingMax']);

document.getElementById('startDraftBtn').onclick = async () => {
    playSound('sfx-choose');
    const btn = document.getElementById('startDraftBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="mana-spinner"></span> Initializing...';

    const limitCmdr = document.getElementById('toggleCmdrBudget') ? document.getElementById('toggleCmdrBudget').checked : true;
    const limitDeck = document.getElementById('toggleDeckBudget') ? document.getElementById('toggleDeckBudget').checked : true;
    const limitRank = document.getElementById('toggleRank') ? document.getElementById('toggleRank').checked : true;

    const bVal = document.getElementById('settingBudget').value;
    const b = !limitCmdr ? 0 : (bVal === '' || isNaN(parseFloat(bVal)) ? 10 : parseFloat(bVal));
    const c = document.getElementById('settingCurrency').value;
    const dbVal = document.getElementById('settingDeckBudget').value;
    const dbudget = !limitDeck ? 0 : (dbVal === '' || isNaN(parseFloat(dbVal)) ? 50 : parseFloat(dbVal));
    const incCmdr = document.getElementById('settingIncludeCmdr').checked;

    const minVal = document.getElementById('settingMin').value;
    const maxVal = document.getElementById('settingMax').value;
    const maxR = !limitRank ? 0 : (minVal === '' || isNaN(parseInt(minVal)) ? 1 : parseInt(minVal));
    const minR = !limitRank ? 0 : (maxVal === '' || isNaN(parseInt(maxVal)) ? 500 : parseInt(maxVal));
    const noPartner = document.getElementById('settingNoPartner').checked; 
    const numOpts = Math.min(5, Math.max(1, parseInt(document.getElementById('settingNumOptions').value) || 3));
    const maxRr = Math.max(0, parseInt(document.getElementById('settingMaxRerolls').value) || 1);
    const selMode = document.getElementById('settingSelectionMode') ? document.getElementById('settingSelectionMode').value : 'both';
    const blind = document.getElementById('settingBlindDraft').checked;
    const draftFormat = document.getElementById('settingDraftFormat') ? document.getElementById('settingDraftFormat').value : 'independent';
    const maxBracket = parseInt(document.getElementById('settingMaxBracket')?.value) || 5;
    const webhookUrl = document.getElementById('settingDiscordWebhook') ? document.getElementById('settingDiscordWebhook').value.trim() : '';

    const settingsPayload = {
        budget: b, currency: c, deckBudget: dbudget, includeCmdr: incCmdr, minRank: minR, maxRank: maxR, noPartner: noPartner, numOptions: numOpts, maxRerolls: maxRr, selectionMode: selMode, blindDraft: blind, draftFormat: draftFormat, maxBracket: maxBracket, status: 'rolling'
    };
    await set(ref(db, `webhooks/${currentRoom}/url`), webhookUrl || null);
    
    try {
        if (draftFormat !== 'independent') {
            const startDraftFn = httpsCallable(functions, 'hostStartInteractiveDraft');
            await startDraftFn({ roomId: currentRoom, settings: settingsPayload });
        } else {
            // For Independent format, we just need to set the settings.
            // The rolling logic is handled per-player when they enter the view.
            await update(ref(db, `rooms/${currentRoom}/settings`), settingsPayload);
        }
    } catch (e) {
        console.error("Draft Start Failed:", e);
        showToast("Failed to initialize draft: " + e.message, true);
        // On any failure, re-enable the button and stop.
        btn.disabled = false;
        btn.innerHTML = "Start Draft";
        return;
    }
    
    btn.disabled = false;
    btn.innerHTML = "Start Draft";
};

// --- SCROLL INDICATOR LOGIC ---
function updateScrollIndicators(container, leftEl, rightEl) {
    if (!container || !leftEl || !rightEl) return;
    
    // If content fits (not scrollable), hide both
    if (container.scrollWidth <= container.clientWidth + 1) {
        leftEl.style.opacity = '0';
        rightEl.style.opacity = '0';
        return;
    }

    const tolerance = 5; // px buffer
    const showLeft = container.scrollLeft > tolerance;
    const showRight = container.scrollLeft < (container.scrollWidth - container.clientWidth - tolerance);
    
    leftEl.style.opacity = showLeft ? '0.7' : '0';
    rightEl.style.opacity = showRight ? '0.7' : '0';
}

function attachScrollListener(containerId, leftId, rightId) {
    const container = document.getElementById(containerId);
    const leftEl = document.getElementById(leftId);
    const rightEl = document.getElementById(rightId);
    if (container && leftEl && rightEl) {
        const handler = () => updateScrollIndicators(container, leftEl, rightEl);
        container.onscroll = handler; // Simple override is sufficient here
        
        // Use ResizeObserver to handle orientation changes/resizes
        if ('ResizeObserver' in window) {
            const ro = new ResizeObserver(handler);
            ro.observe(container);
        }

        setTimeout(handler, 100); // Initial check after layout
        setTimeout(handler, 500); // Secondary check for image loads
    }
}

function initDashboard() {
    switchView('view-dashboard');
    
    const dashRoomHeader = document.getElementById('dashRoomHeader');
    if (dashRoomHeader) {
        dashRoomHeader.innerHTML = `Playgroup: <span id="dashRoomCode" style="color:var(--arcane);">${currentRoom}</span>`;
        dashRoomHeader.title = "Click to copy invite link";
        dashRoomHeader.onclick = () => window.copyRoomCode();
        dashRoomHeader.style.cursor = 'pointer';
    } else {
        const dashCodeEl = document.getElementById('dashRoomCode');
        if (dashCodeEl) dashCodeEl.innerText = currentRoom;
    }

    if(activeRoomListener) activeRoomListener();
    activeRoomListener = onValue(ref(db, `rooms/${currentRoom}`), (snap) => {
        const data = snap.val();
        
        if(!data || !data.players || !data.players[currentPlayerId]) {
            if(currentRoom) {
                clearSession(); currentRoom = null; isHost = false;
                switchView('view-landing'); showToast("You have been removed from the playgroup.", true);
                window.loadMyPlaygroups();
            }
            return;
        }

        if(data.settings.status === 'waiting' && document.getElementById('view-dashboard').classList.contains('active')) {
            initLobby(); return;
        }

        if (dashRoomHeader && data.settings.draftFormat !== 'independent') {
            const dashCodeEl = document.getElementById('dashRoomCode');
            if (dashCodeEl) dashCodeEl.innerHTML = `${currentRoom} <span style="font-size:1.2rem;" title="Lobby is locked during interactive drafts">🔒</span>`;
            dashRoomHeader.title = "Lobby locked during interactive draft";
            dashRoomHeader.onclick = () => showToast("Lobby locked. New players cannot join mid-draft.", true);
            dashRoomHeader.style.cursor = 'not-allowed';
        }

        const resetLobbyDropdownBtn = document.getElementById('resetLobbyDropdownBtn');
        if (resetLobbyDropdownBtn) resetLobbyDropdownBtn.style.display = isHost ? 'block' : 'none';

        const dropdown = document.getElementById('moreActionsDropdown');
        const existingBtn = document.getElementById('updateWebhookBtn');

        if (isHost && dropdown) {
            if (!existingBtn) {
                const webhookBtn = document.createElement('a');
                webhookBtn.href = '#';
                webhookBtn.id = 'updateWebhookBtn';
                webhookBtn.innerText = '⚙️ Update Webhook';
                webhookBtn.onclick = (e) => {
                    e.preventDefault();
                    dropdown.parentElement.classList.remove('show');
                    window.openWebhookModal();
                };
                dropdown.appendChild(webhookBtn);
            }
        } else if (existingBtn) { existingBtn.remove(); }

        const players = data.players || {};

        const cTime = getRoomCreationTime(data);
        const timeEl = document.getElementById('dashCreatedTime');
        if(timeEl) timeEl.innerText = cTime ? `Opened: ${new Date(cTime).toLocaleString()}` : "";

        // --- BATTLE INFO LOGIC ---
        const battleInfoEl = document.getElementById('battleInfoDisplay');
        const meetup = data.meetup;
        
        if (meetup) {
            const dateObj = new Date(meetup.date);
            const dateStr = dateObj.toLocaleDateString(undefined, {weekday:'long', month:'long', day:'numeric'});
            const timeStr = dateObj.toLocaleTimeString(undefined, {hour:'2-digit', minute:'2-digit'});

            const cantMakeIt = meetup.cantMakeIt || {};
            const isCantMakeIt = !!cantMakeIt[currentPlayerId];
            
            let cantMakeItHtml = '';
            const cantMakeItNames = Object.keys(cantMakeIt).filter(id => cantMakeIt[id]).map(id => players[id]?.name).filter(Boolean);
            if (cantMakeItNames.length > 0) {
                cantMakeItHtml = `<div style="margin-top: 10px; color: #ff9999; font-size: 0.9rem;"><strong>Can't make it:</strong> ${cantMakeItNames.map(sanitizeHTML).join(', ')}</div>`;
            }

            let hostControls = isHost ? `
                <div style="margin-top: 15px; display:flex; gap:10px; justify-content:center;">
                    <button id="declareWinnerBtn" class="select-btn" style="padding: 8px 15px; font-size: 0.9rem; flex:1;">🏆 Declare Winner</button>
                    <button id="cancelMeetupBtn" class="select-btn" style="padding: 8px 15px; font-size: 0.9rem; background-color: transparent; color: #ff4444; border: 1px solid #ff4444; flex:1;">Cancel Date</button>
                </div>
            ` : '';

            battleInfoEl.innerHTML = `
                <div class="battle-info">
                    <h3 style="color:var(--gold); font-family:Cinzel; margin:0 0 10px 0;">⚔️ BATTLE SCHEDULED ⚔️</h3>
                    <div style="font-size:1.1rem; color:white; margin-bottom:5px;"><strong>${dateStr} @ ${timeStr}</strong></div>
                    <div style="color:#ccc; margin-bottom:5px;">Format: <span style="color:var(--gold);">${sanitizeHTML(meetup.format)}</span></div>
                    <div style="color:#ccc;">Prize: <span style="color:#2ecc71;">${sanitizeHTML(meetup.prize)}</span></div>
                    ${cantMakeItHtml}
                    <button id="toggleCantMakeItBtn" class="select-btn" style="margin-top: 15px; padding: 8px 15px; font-size: 0.9rem; background-color: ${isCantMakeIt ? '#444' : '#ff4444'}; border-color: ${isCantMakeIt ? '#666' : '#ff4444'};">
                        ${isCantMakeIt ? "I can make it now" : "I can no longer make it"}
                    </button>
                    ${hostControls}
                </div>
            `;
            document.getElementById('toggleCantMakeItBtn').onclick = async () => {
                playSound('sfx-click');
                await update(ref(db, `rooms/${currentRoom}/meetup/cantMakeIt`), { [currentPlayerId]: isCantMakeIt ? null : true });
            };
            if (isHost) {
                document.getElementById('declareWinnerBtn').onclick = () => window.openDeclareWinner();
                document.getElementById('cancelMeetupBtn').onclick = () => {
                    playSound('sfx-click');
                    showConfirm("Cancel Battle?", "Are you sure you want to cancel this scheduled battle and go back to finding a date?", async () => {
                        playSound('sfx-click');
                        await remove(ref(db, `rooms/${currentRoom}/meetup`));
                        showToast("Battle cancelled.");
                    });
                };
            }
        } else {
            battleInfoEl.innerHTML = '';
        }

        // Calculate if everyone is ready
        let allReady = false;
        let maxSalt = -1;
        let maxPrice = -1;
        const pValues = Object.values(players);
        if (pValues.length > 0) {
            const maxBudget = data.settings.deckBudget !== undefined ? parseFloat(data.settings.deckBudget) : 50;
            allReady = pValues.every(p => {
                let checkPrice = p.lockedDeckPrice !== undefined ? p.lockedDeckPrice : (p.deckPrice || 0);
                return p.deck && p.isLegal === true && (maxBudget === 0 || checkPrice <= maxBudget);
            });
            
            pValues.forEach(p => {
                if (p.deckSalt !== undefined && p.deckSalt !== null && !isNaN(p.deckSalt)) {
                    if (p.deckSalt > maxSalt) maxSalt = p.deckSalt;
                }
                if (p.deckPrice !== undefined && p.deckPrice !== null && !isNaN(p.deckPrice)) {
                    if (p.deckPrice > maxPrice) maxPrice = p.deckPrice;
                }
            });
        }

        // Manage Host "Schedule" Button
        const actionsDiv = document.querySelector('.dashboard-actions');
        let battleBtn = document.getElementById('scheduleBattleBtn');
        
        if (isHost && allReady) {
            if (!battleBtn) {
                battleBtn = document.createElement('button');
                battleBtn.id = 'scheduleBattleBtn';
                battleBtn.className = 'select-btn';
                battleBtn.style.padding = '8px 15px';
                battleBtn.style.fontSize = '0.9rem';
                battleBtn.style.borderRadius = '4px';
                battleBtn.innerHTML = meetup ? 'Update Battle' : '📅 Schedule Battle';
                battleBtn.onclick = () => window.openBattleSetup(meetup);
                actionsDiv.insertBefore(battleBtn, actionsDiv.firstChild); // Put it first
            } else {
                battleBtn.innerHTML = meetup ? 'Update Battle' : '📅 Schedule Battle';
            }
        } else if (battleBtn) {
            battleBtn.remove();
        }
        // -------------------------

        const dash = document.getElementById('dynamicDashboard');
        let dashboardHtml = "";

        const isBlind = data.settings.blindDraft === true;
        const allLocked = Object.values(players).every(p => p.selected);
        const activeDraft = data.activeDraft;
        const history = data.history || {};
        const winCounts = {};
        Object.values(history).forEach(h => {
            if (h.winnerId) winCounts[h.winnerId] = (winCounts[h.winnerId] || 0) + 1;
        });

        // Sort: Host first, then Alphabetical
        const sortedIds = Object.keys(players).sort((a,b) => {
            if(players[a].isHost) return -1;
            if(players[b].isHost) return 1;
            return (players[a].name || "").localeCompare(players[b].name || "");
        });

        sortedIds.forEach(id => {
            const pData = players[id];
            const safeName = sanitizeHTML(pData.name);
            const safeSelected = pData.selected ? sanitizeHTML(pData.selected) : null;
            
            let statusHtml = `<span class="status-badge status-waiting">Waiting...</span>`;
            if (pData.deck) {
                let maxBudget = data.settings.deckBudget !== undefined ? parseFloat(data.settings.deckBudget) : 50;
                let isLegal = pData.isLegal === true;
                let checkPrice = pData.lockedDeckPrice !== undefined ? pData.lockedDeckPrice : (pData.deckPrice || 0);
                let isUnderBudget = maxBudget === 0 || checkPrice <= maxBudget;
                if (isLegal && isUnderBudget) {
                    statusHtml = `<span class="status-badge status-sealed" style="background:var(--gold); color:black; border-color:white; box-shadow:0 0 10px var(--gold);">Ready for Battle!</span>`;
                } else {
                    statusHtml = `<span class="status-badge status-sealed">Deck Sealed</span>`;
                }
            }
            else if (pData.selected) statusHtml = `<span class="status-badge status-chosen">Commander Chosen</span>`;
            else if (activeDraft) statusHtml = `<span class="status-badge status-drafting">Drafting...</span>`;
            else if (pData.generated) statusHtml = `<span class="status-badge status-drafting">Drafting...</span>`;

            let avatarImg = pData.avatar ? `<img src="${sanitizeHTML(pData.avatar)}" style="width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--gold); object-fit: cover;">` : '';
            let hostIcon = pData.isHost ? `<span title="Host" style="margin-left:6px; font-size:1.1rem;">👑</span>` : '';
            let trophies = winCounts[id] ? `<span title="${winCounts[id]} Wins" style="margin-left:4px; font-size:1rem;">${'🏆'.repeat(winCounts[id])}</span>` : '';
            let guestTag = pData.uid ? '' : `<span style="color:#888; font-size:0.75rem; font-family:'Segoe UI'; font-weight:normal; margin-left:6px;">(Guest)</span>`;
            
            let isSaltiest = pData.deckSalt !== undefined && pData.deckSalt !== null && !isNaN(pData.deckSalt) && pData.deckSalt === maxSalt && maxSalt > 0;
            let isMostExpensive = pData.deckPrice !== undefined && pData.deckPrice !== null && !isNaN(pData.deckPrice) && pData.deckPrice === maxPrice && maxPrice > 0;
            
            let highlightClass = '';
            if (isSaltiest && isMostExpensive) highlightClass = 'saltiest-and-expensive-deck';
            else if (isSaltiest) highlightClass = 'saltiest-deck';
            else if (isMostExpensive) highlightClass = 'most-expensive-deck';

            let html = `<div class="card ${highlightClass}"><div style="display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:10px;">${avatarImg}<h3 style="margin:0; display:flex; align-items:center;">${safeName}${hostIcon}${trophies}${guestTag}</h3></div>${statusHtml}`;

            if (id === currentPlayerId && !safeSelected) {
                let btnText = "Begin Rolling";
                if (activeDraft) btnText = "Enter Draft";
                else if (pData.generated) btnText = "Resume Rolling";
                html += `<br><button class="select-btn" style="margin-top: 10px; margin-bottom: 5px; width: 100%; font-size: 0.9rem;" onclick="window.openPlayerView()">${btnText}</button>`;
            }

            if (safeSelected) {
                const hideInfo = isBlind && !allLocked && id !== currentPlayerId;

                if (hideInfo) {
                    html += `<p style="margin: 15px 0 5px 0; font-family:'Cinzel'; color:#aaa;"><strong>???</strong></p>`;
                    html += `<img src="card_back.webp" class="commander-img" loading="lazy" style="filter: brightness(0.7);">`;
                } else {
                    html += `<p style="margin: 15px 0 5px 0; font-family:'Cinzel'; color:white;"><strong>${safeSelected}</strong></p>`;
                    if (pData.display_rank) html += `<p style="margin: 0 0 10px 0; font-size: 0.9rem; color: #d4af37; font-weight:bold;">EDHREC Rank: #${pData.display_rank}</p>`;
                    
                    const edhrecSlug = safeSelected.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    const edhrecLink = `https://edhrec.com/commanders/${edhrecSlug}`;
                    
                    html += `<a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC"><img src="${sanitizeHTML(pData.image)}" class="commander-img" loading="lazy"></a>`;
                }
            }

            if (pData.deck) {
                const hideInfo = isBlind && !allLocked && id !== currentPlayerId;
                
                if (hideInfo) {
                    html += `
                        <div style="background: #111; border: 1px dashed #444; border-radius: 6px; padding: 10px; margin-top: 15px;">
                            <p style="margin: 0; font-size: 0.85rem; color: #888; font-style: italic; text-align: center;">Deck details hidden until all commanders are revealed.</p>
                        </div>
                    `;
                } else {
                    if (pData.deckPrice !== undefined) {
                        let maxBudget = data.settings.deckBudget !== undefined ? parseFloat(data.settings.deckBudget) : 50;
                        let currSym = data.settings.currency === 'eur' ? '€' : '$';
                        let checkPrice = pData.lockedDeckPrice !== undefined ? pData.lockedDeckPrice : (pData.deckPrice || 0);
                        let isOver = maxBudget !== 0 && checkPrice > maxBudget;
                        let priceColor = isOver ? "#ff4444" : "#2ecc71";
                        let check = isOver ? "❌ Over Budget" : "✅ OK";

                        let cmdrLogic = data.settings.includeCmdr !== false ? "Includes Commander cost." : "Excludes Commander cost.";
                        let tooltipLogic = `Excludes Basic Lands and Side/Maybeboards. ${cmdrLogic}`;

                        let legalIcon = pData.isLegal ? "✅" : "⚠️";
                        let legalText = pData.isLegal ? "Legal (100 Cards)" : `Illegal (${pData.deckSize || '?'} Cards)`;
                        
                        let saltHtml = '';
                        if (pData.deckSalt !== undefined && pData.deckSalt !== null && !isNaN(pData.deckSalt)) {
                            if (isSaltiest) {
                                saltHtml = `<p style="margin: 5px 0 0 0; font-size: 0.9rem; color: #39ff14; font-weight:bold; text-shadow: 0 0 8px rgba(57,255,20,0.5);">☣️ Saltiest: ${Number(pData.deckSalt).toFixed(2)}</p>`;
                            } else {
                                saltHtml = `<p style="margin: 5px 0 0 0; font-size: 0.85rem; color: #ccc;">🧂 Salt Score: ${Number(pData.deckSalt).toFixed(2)}</p>`;
                            }
                        } else if (id === currentPlayerId) {
                            saltHtml = `<p style="margin: 5px 0 0 0; font-size: 0.85rem; color: #aaa;">🧂 Salt Score: <span style="cursor:pointer; color:#d4af37; text-decoration:underline;" onclick="window.refreshMyDeckPrice()">Refresh to calculate</span></p>`;
                        } else {
                            saltHtml = `<p style="margin: 5px 0 0 0; font-size: 0.85rem; color: #aaa;">🧂 Salt Score: N/A (Needs refresh)</p>`;
                        }

                        let lockedHtml = '';
                        if (pData.lockedDeckPrice !== undefined) {
                            lockedHtml = `<p style="margin: 5px 0 0 0; font-size: 0.95rem; color: #d4af37; font-weight:bold;">🔒 Locked Price: ${currSym}${pData.lockedDeckPrice.toFixed(2)}</p>`;
                        }

                        html += `
                            <div style="background: #000; border: 1px solid #333; border-radius: 6px; padding: 10px; margin-top: 15px;">
                                <div style="margin: 0; font-size: 0.9rem; color: #aaa; display: flex; align-items: center; justify-content: center; gap: 5px;">
                                    Deck Total
                                    <div class="tooltip" style="width: 14px; height: 14px; font-size: 10px; line-height: 12px; cursor: help;">?
                                        <span class="tooltiptext">${tooltipLogic}</span>
                                    </div>
                                </div>
                                <p style="margin: 5px 0 0 0; font-size: 1.1rem; color: ${(maxBudget !== 0 && pData.deckPrice > maxBudget) ? '#ff4444' : '#2ecc71'}; font-weight:bold;">${isMostExpensive ? '💎 Highest:' : 'Current:'} ${currSym}${pData.deckPrice.toFixed(2)}</p>
                                ${lockedHtml}
                                <p style="margin: 5px 0 0 0; font-size: 0.85rem; font-weight:bold; color: ${priceColor};">${check} ${maxBudget === 0 ? '(No Limit)' : `(Limit: ${currSym}${maxBudget})`}</p>
                                <p style="margin: 5px 0 0 0; font-size: 0.85rem; color: #ccc;">${legalIcon} ${legalText}</p>
                                ${saltHtml}
                            </div>
                        `;
                    } else {
                        html += `<p style="margin: 15px 0 5px 0; font-size: 0.9rem; color: #aaa;">Deck Price: Calculating...</p>`;
                    }
                    html += `<br><a href="${sanitizeHTML(pData.deck)}" target="_blank" style="font-size: 0.85rem; color:#d4af37;" onclick="playSound('sfx-click')">View Deck</a>`;
                }
            }
            
            if (id === currentPlayerId && safeSelected) {
                html += `<div style="margin-top: 15px; display: flex; flex-direction: column; gap: 8px;">`;
                html += `<button class="select-btn" style="width: 100%; font-size: 0.9rem;" onclick="window.openPlayerView()">Update Link</button>`;
                if (pData.deck) {
                    html += `<button class="select-btn" style="width: 100%; font-size: 0.9rem; background-color: #4a4a5e; border-color: #696982;" onclick="window.refreshMyDeckPrice()">Refresh Price</button>`;
                    html += `<button class="select-btn" style="width: 100%; font-size: 0.9rem; background-color: #6a4a4a; border-color: #826969;" onclick="window.lockMyDeckPrice()">Lock In Price</button>`;
                }
                html += `</div>`;
            }

            if (isHost) {
                html += `<div style="margin-top:15px; border-top:1px solid #333; padding-top:15px; display:flex; justify-content:center; gap:8px; flex-wrap:wrap;">`;
                html += `<button class="host-action-btn clear" onclick="window.clearPlayer('${id}')">Wipe</button>`;
                if (id !== currentPlayerId) {
                    html += `<button class="host-action-btn kick" onclick="window.kickPlayer('${id}')">Kick</button>`;
                }
                html += `</div>`;
            }

            html += `</div>`; dashboardHtml += html;
        });
        dash.innerHTML = dashboardHtml;
        attachScrollListener('dynamicDashboard', 'dash-scroll-left', 'dash-scroll-right');
    });
}

let localArchives = null;
async function getArchives() {
    if (localArchives) return localArchives;
    const snap = await get(ref(db, 'global_archives/cards'));
    if (snap.exists()) {
        let rawData = snap.val();
        localArchives = Array.isArray(rawData) ? rawData : Object.values(rawData);
        localArchives = localArchives.filter(card => card !== null && card !== undefined);
        return localArchives;
    }
    return null;
}

window.openPlayerView = async () => {
    playSound('sfx-click'); switchView('view-player');
    getArchives(); 
    isSearchingManually = false;

    if (activePlayerListener) { activePlayerListener(); activePlayerListener = null; }
    
    const settingsSnap = await get(ref(db, `rooms/${currentRoom}/settings`));
    const s = settingsSnap.val() || {};
    const maxRerollsAllowed = s.maxRerolls !== undefined ? s.maxRerolls : 1;

    get(ref(db, `rooms/${currentRoom}/players/${currentPlayerId}`)).then(snap => {
        document.getElementById('playerTitle').innerText = sanitizeHTML(snap.val().name) + "'s Challenge";
    });

    activePlayerListener = onValue(ref(db, `rooms/${currentRoom}`), (snap) => {
        const roomData = snap.val() || {};
        const currentS = roomData.settings || s;
        const currentMaxRerolls = currentS.maxRerolls !== undefined ? currentS.maxRerolls : maxRerollsAllowed;
        const data = roomData.players?.[currentPlayerId] || {};
        const activeDraft = roomData.activeDraft;

        if (!document.getElementById('view-player').classList.contains('active')) return;

        const container = document.getElementById('content');
        if (data.selected) {
            isSearchingManually = false;
            renderFinalForm(data);
        }
        else if (activeDraft && currentS.draftFormat !== 'independent') {
            isSearchingManually = false;
            renderInteractiveDraft(activeDraft, container, currentS, roomData.players);
        }
        else if (data.generated) {
            isSearchingManually = false;
            if (currentS.draftFormat !== 'independent') {
                renderFinalSelection(data.generated, currentS);
            } else {
                renderSelectionScreen(data.generated, data.rerollCount || 0, currentMaxRerolls, currentS);
            }
        }
        else {
            if (!isSearchingManually) {
                renderInitialChoice(container, currentS);
            }
        }
    });
};

async function renderInitialChoice(container, s) {
    const mode = s.selectionMode || 'both';
    let html = `<div style="display:flex; flex-direction:column; gap:20px; align-items:center; margin-top: 30px;">`;
    
    if (mode === 'both' || mode === 'random') {
        html += `<button id="rollBtn" class="select-btn" style="width:auto; padding:20px 40px; font-size:1.3rem;">Reveal Commanders</button>`;
    }
    if (mode === 'both') {
        html += `<p style="color:#aaa; margin:0; font-family:Cinzel;">- OR -</p>`;
    }
    if (mode === 'both' || mode === 'manual') {
        html += `<button id="manualBtn" class="select-btn" style="width:auto; padding:15px 30px; font-size:1rem; background:#444; border-color:#666;">Search Specific Commander</button>`;
    }

    // Pool Info Box
    html += `
        <div style="margin-top: 20px; background: #111; padding: 20px; border-radius: 8px; border: 1px solid #333; width: 90%; max-width: 600px; box-sizing: border-box;">
            <p id="poolCountText" style="color:var(--gold); font-family:Cinzel; margin:0 0 15px 0; font-size:1.1rem;"><span class="mana-spinner"></span> Sifting Archives...</p>
            <button id="showPoolBtn" class="secondary-btn" style="padding: 8px 15px; font-size: 0.9rem; display:none;">Show Eligible Commanders</button>
            <div id="poolGrid" style="display:none; flex-wrap:wrap; gap:6px; justify-content:center; margin-top: 20px;"></div>
        </div>
    `;

    html += `</div>`;
    container.innerHTML = html;

    if(document.getElementById('rollBtn')) document.getElementById('rollBtn').onclick = () => { rollCommanders(); };
    if(document.getElementById('manualBtn')) document.getElementById('manualBtn').onclick = () => { 
        isSearchingManually = true;
        renderManualSearch(container, s); 
    };

    // Calculate eligible pool dynamically
    const archives = await getArchives();
    let pool = archives ? archives.filter(c => {
        let price = s.currency === 'eur' ? c.prices.eur : c.prices.usd;
        if (parseFloat(s.budget) !== 0 && price >= parseFloat(s.budget)) return false;
        if (s.noPartner && c.isPartner) return false;
        if (s.maxRank !== 0 && c.rank_edhrec < s.maxRank) return false;
        if (s.minRank !== 0 && c.rank_edhrec > s.minRank) return false;
        return true;
    }) : [];

    const poolCountText = document.getElementById('poolCountText');
    const showBtn = document.getElementById('showPoolBtn');
    const grid = document.getElementById('poolGrid');

    if (poolCountText) poolCountText.innerHTML = `Eligible Commanders in Archives: <span style="color:white;">${pool.length}</span>`;
    
    if (showBtn && pool.length > 0) {
        showBtn.style.display = 'inline-block';
        showBtn.onclick = () => {
            playSound('sfx-click');
            if (grid.style.display === 'none') {
                grid.style.display = 'flex'; showBtn.innerText = "Hide Pool";
                if (grid.innerHTML.trim() === "") {
                    let gridHtml = '';
                    pool.forEach(c => { let img = c.image_uris?.normal || c.image1; gridHtml += `<div class="pool-card-wrapper" title="${sanitizeHTML(c.name)}"><img src="${sanitizeHTML(img)}" class="pool-card-img" loading="lazy"></div>`; });
                    grid.innerHTML = gridHtml;
                }
            } else { grid.style.display = 'none'; showBtn.innerText = "Show Eligible Commanders"; }
        };
    }
}

// Debounce utility to prevent lag on rapid input
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

async function renderManualSearch(container, s) {
    const archives = await getArchives();
    
    container.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; gap:15px; margin-top:20px;">
            <h3 style="color:var(--gold); font-family:Cinzel; margin:0;">Search Commander</h3>
            <p style="color:#aaa; font-size:0.9rem; text-align:center; max-width:400px;">
                Only commanders matching the current room settings (Budget: ${parseFloat(s.budget) === 0 ? 'Any' : (s.currency === 'eur' ? '€' : '$') + s.budget}, Rank: ${
                    (s.maxRank === 0 && s.minRank === 0) ? 'Any' :
                    (s.maxRank === 0) ? `Up to #${s.minRank}` :
                    (s.minRank === 0) ? `#${s.maxRank}+` :
                    `#${s.maxRank}-#${s.minRank}`
                }) will appear.
            </p>
            <input type="text" id="manualInput" placeholder="Type commander name..." autocomplete="off" 
                style="width:90%; max-width:350px; padding:12px; border-radius:5px; border:1px solid #555; background:#222; color:white; font-size:1.1rem;">
            
            <div id="searchResults" style="width:90%; max-width:350px; max-height:350px; overflow-y:auto; background:#151515; border:1px solid #333; border-radius:5px; display:none;"></div>
            
            <button id="backToRollBtn" class="select-btn" style="background:#444; border-color:#666; width:auto; padding:10px 30px; margin-top:10px;">Back</button>
        </div>
    `;

    document.getElementById('backToRollBtn').onclick = () => {
        isSearchingManually = false;
        renderInitialChoice(container, s);
    };

    const input = document.getElementById('manualInput');
    const resultsDiv = document.getElementById('searchResults');
    input.focus();

    input.oninput = debounce(() => {
        const val = input.value.trim().toLowerCase();
        if (val.length < 2) { resultsDiv.style.display = 'none'; return; }

        const filtered = archives.filter(c => {
            if (!c.name.toLowerCase().includes(val)) return false;
            
            let price = s.currency === 'eur' ? c.prices.eur : c.prices.usd;
            if (parseFloat(s.budget) !== 0 && price >= parseFloat(s.budget)) return false;
            if (s.noPartner && c.isPartner) return false;
            if (s.maxRank !== 0 && c.rank_edhrec < s.maxRank) return false;
            if (s.minRank !== 0 && c.rank_edhrec > s.minRank) return false;
            return true;
        }).sort((a, b) => a.rank_edhrec - b.rank_edhrec).slice(0, 20);

        resultsDiv.innerHTML = "";
        if (filtered.length === 0) {
            resultsDiv.innerHTML = `<div style="padding:15px; color:#888; text-align:center;">No eligible commanders found.<br><span style="font-size:0.8rem;">Check room settings.</span></div>`;
        } else {
            filtered.forEach(c => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                
                let priceStr = s.currency === 'eur' ? `€${c.prices.eur}` : `$${c.prices.usd}`;
                
                div.innerHTML = `
                    <img src="${sanitizeHTML(c.image1)}" style="width:50px; border-radius:4px;" loading="lazy">
                    <div style="text-align:left;">
                        <div style="color:white; font-weight:bold; font-size:0.95rem;">${sanitizeHTML(c.name)}</div>
                        <div style="font-size:0.8rem; color:#aaa;">Rank #${c.rank_edhrec} • <span style="color:#2ecc71;">${priceStr}</span></div>
                    </div>
                `;
                div.onclick = () => {
                    playSound('sfx-click');
                    showConfirm("Confirm Selection", `Select ${c.name} as your commander?`, () => {
                         playSound('sfx-choose');
                         update(ref(db, `rooms/${currentRoom}/players/${currentPlayerId}`), {
                            selected: c.name, 
                            image: c.image1, 
                            display_rank: c.rank_edhrec, 
                            scryfall_uri: c.scryfall_uri, 
                            color_identity: c.color_identity || [],
                            generated: null,
                            rerollCount: 0
                        });
                    });
                };
                resultsDiv.appendChild(div);
            });
        }
        resultsDiv.style.display = 'block';
    }, 300);
}

window.closePlayerView = () => { 
    playSound('sfx-click'); 
    if (activePlayerListener) { activePlayerListener(); activePlayerListener = null; }
    switchView('view-dashboard'); 
};

function getColorBadges(colors) {
    if (!colors || colors.length === 0) return `<span class="mana-badge mana-C">C</span>`;
    return colors.map(c => `<span class="mana-badge mana-${c}">${c}</span>`).join('');
}

window.flipCard3D = (cardId, event) => {
    if(event) { event.preventDefault(); event.stopPropagation(); }
    playSound('sfx-click');
    const card = document.getElementById(cardId);
    if (card) card.classList.toggle('is-flipped');
};

function formatCardData(card) {
    return {
        name: card.name,
        image_uris: { normal: card.image1 },
        card_faces: card.image2 ? [ {image_uris: {normal: card.image1}}, {image_uris: {normal: card.image2}} ] : null,
        prices: card.prices,
        display_rank: card.rank_edhrec,
        color_identity: card.color_identity,
        scryfall_uri: card.scryfall_uri
    };
}

async function fetchOneFromPool(s, existingNamesSet) {
    const archives = await getArchives();
    if(!archives) throw new Error("Could not download archives from database.");

    let pool = archives.filter(c => {
        let price = s.currency === 'eur' ? c.prices.eur : c.prices.usd;
        if (parseFloat(s.budget) !== 0 && price >= parseFloat(s.budget)) return false;
        if (s.noPartner && c.isPartner) return false;
        if (existingNamesSet.has(c.name)) return false;
        if (s.maxRank !== 0 && c.rank_edhrec < s.maxRank) return false;
        if (s.minRank !== 0 && c.rank_edhrec > s.minRank) return false;
        return true;
    });

    if(pool.length === 0) return { error: true };
    let randIdx = Math.floor(Math.random() * pool.length);
    let card = pool[randIdx];

    return formatCardData(card);
}

async function rollCommanders() {
    playSound('sfx-click');
    const btn = document.getElementById('rollBtn');
    if(btn) { btn.disabled = true; btn.innerHTML = '<span class="mana-spinner"></span> Sifting...'; }
    
    try {
        const settingsSnap = await get(ref(db, `rooms/${currentRoom}/settings`));
        const s = settingsSnap.val();
        const numOpts = s.numOptions || 3;

        const archives = await getArchives();
        if(!archives) throw new Error("Could not download archives.");

        // Filter the pool ONCE instead of inside a loop
        let pool = archives.filter(c => {
            let price = s.currency === 'eur' ? c.prices.eur : c.prices.usd;
            if (parseFloat(s.budget) !== 0 && price >= parseFloat(s.budget)) return false;
            if (s.noPartner && c.isPartner) return false;
            if (s.maxRank !== 0 && c.rank_edhrec < s.maxRank) return false;
            if (s.minRank !== 0 && c.rank_edhrec > s.minRank) return false;
            return true;
        });

        if (pool.length === 0) {
            showToast("The Archives are empty! Ask Host to relax settings.", true);
            if(btn) { btn.disabled = false; btn.innerHTML = "Reveal Commanders"; }
            return;
        }

        let list = []; 
        let existingNames = new Set();
        
        // Pick unique random cards
        for(let i=0; i < numOpts; i++) {
            let card;
            let attempts = 0;
            do {
                card = pool[Math.floor(Math.random() * pool.length)];
                attempts++;
            } while(existingNames.has(card.name) && attempts < 50);
            
            list.push(formatCardData(card));
            existingNames.add(card.name);
        }
        await update(ref(db, `rooms/${currentRoom}/players/${currentPlayerId}`), { generated: list, rerollCount: 0 });
        try { 
            const logRollFn = httpsCallable(functions, 'logCommandersRolled'); 
            logRollFn({ count: numOpts }); 
        } catch(e) {}
    } catch (err) {
        showToast("Error reading the archives. Check console.", true);
        if(btn) { btn.disabled = false; btn.innerHTML = "Reveal Commanders"; }
    }
}

function renderSelectionScreen(list, currentRerollCount, maxRerollsAllowed, s) {
    const container = document.getElementById('content');
    const isInitialRender = container.querySelectorAll('.option-card').length === 0;
    const canReroll = currentRerollCount < maxRerollsAllowed;
    const rerollsRemaining = maxRerollsAllowed - currentRerollCount;

    const createCardDiv = (card, i) => {
        let img1 = card.image_uris?.normal || (card.card_faces && card.card_faces[0].image_uris?.normal) || card.image1;
        let img2 = (card.card_faces && card.card_faces[1] && card.card_faces[1].image_uris?.normal) || card.image2 || null;
        let priceString = "Price N/A";
        if (card.prices) {
            if (s.currency === 'eur' && card.prices.eur !== 9999) priceString = `€${card.prices.eur}`;
            else if (s.currency === 'usd' && card.prices.usd !== 9999) priceString = `$${card.prices.usd}`;
        }
        
        const safeCardName = sanitizeHTML(card.name);
        const colorBadges = getColorBadges(card.color_identity);
        const edhrecSlug = safeCardName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const edhrecLink = `https://edhrec.com/commanders/${edhrecSlug}`;
        
        const cardDiv = document.createElement('div');
        cardDiv.className = 'option-card';
        cardDiv.setAttribute('data-name', safeCardName); 
        
        let imageHtml = '';
        if (img2) {
            imageHtml = `
            <div class="scene">
                <div class="card-3d" id="card3d-${i}">
                    <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC" style="display:block;" class="card-face card-face-front">
                        <img src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy" style="margin-top:0;">
                    </a>
                    <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC" style="display:block;" class="card-face card-face-back">
                        <img src="${sanitizeHTML(img2)}" class="commander-img" loading="lazy" style="margin-top:0;">
                    </a>
                </div>
            </div>
            <button class="flip-btn" onclick="window.flipCard3D('card3d-${i}', event)">🔄 Flip Card</button>
            `;
        } else {
            imageHtml = `
            <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC">
                <img id="img-${i}" src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy">
            </a>`;
        }

        cardDiv.innerHTML = `
            ${imageHtml}
            <p class="price-tag" style="margin-top: 15px;">${priceString}</p>
            <div class="mana-container">${colorBadges}</div>
            <p class="rank-tag" style="color:var(--gold); font-weight:bold; font-size: 1rem; margin-bottom: 15px;">EDHREC Rank: #${card.display_rank}</p>
            <button class="select-btn" data-idx="${i}">Select ${safeCardName}</button>
            ${canReroll ? `<br><button class="reroll-btn" data-idx="${i}" id="btn-reroll-${i}">Reroll Slot (${rerollsRemaining} left)</button>` : ''}
        `;

        cardDiv.querySelector('.select-btn').onclick = () => {
            playSound('sfx-click');
            showConfirm("Seal Your Champion?", `Are you sure you want to lock in ${card.name} as your commander?`, () => {
                playSound('sfx-choose');
                update(ref(db, `rooms/${currentRoom}/players/${currentPlayerId}`), {
                    selected: card.name, 
                    image: img1, 
                    display_rank: card.display_rank, 
                    scryfall_uri: card.scryfall_uri, 
                    color_identity: card.color_identity || [],
                    generated: null,
                    rerollCount: 0
                });
            });
        };

        const rerollBtn = cardDiv.querySelector(`#btn-reroll-${i}`);
        if (rerollBtn) {
            rerollBtn.onclick = async () => {
                playSound('sfx-click'); showConfirm("Risk the Archives?", `Are you sure you want to reroll this slot? You have ${rerollsRemaining} reroll(s) remaining!`, async () => {
                    playSound('sfx-click'); rerollBtn.disabled = true; rerollBtn.innerHTML = '<span class="mana-spinner"></span> Sifting...'; cardDiv.classList.remove('revealed'); cardDiv.classList.add('fading-out'); 
                    try {
                        const settingsSnap = await get(ref(db, `rooms/${currentRoom}/settings`));
                        const currentS = settingsSnap.val();
                        let existingNames = new Set(list.map(c => c.name));
                        const newCard = await fetchOneFromPool(currentS, existingNames);
                        if (newCard.error) {
                            showToast("The Archives are empty! Settings are too strict.", true); rerollBtn.disabled = false; rerollBtn.innerHTML = `Reroll Slot (${rerollsRemaining} left)`; cardDiv.classList.remove('fading-out'); cardDiv.classList.add('revealed'); return;
                        }
                        list[i] = newCard; 
                        await update(ref(db, `rooms/${currentRoom}/players/${currentPlayerId}`), { generated: list, rerollCount: currentRerollCount + 1 });
                    try { 
                        const logRollFn = httpsCallable(functions, 'logCommandersRolled'); 
                        logRollFn({ count: 1 }); 
                    } catch(e) {}
                    } catch (err) { showToast("Error rerolling.", true); }
                });
            };
        }

        return cardDiv;
    };

    if (isInitialRender) {
        container.innerHTML = ""; list.forEach((card, i) => {
            const cardDiv = createCardDiv(card, i); container.appendChild(cardDiv); setTimeout(() => { playSound('sfx-reveal'); cardDiv.classList.add('revealed'); }, i * 1200 + 100); 
        });
    } else {
        list.forEach((card, i) => {
            const existingCard = container.children[i]; const safeCardName = sanitizeHTML(card.name);
            if (!existingCard || existingCard.getAttribute('data-name') !== safeCardName) {
                const newCardDiv = createCardDiv(card, i); if (existingCard) container.replaceChild(newCardDiv, existingCard); else container.appendChild(newCardDiv);
                setTimeout(() => { playSound('sfx-reveal'); newCardDiv.classList.add('revealed'); }, 50);
            } else {
                const updatedCardDiv = createCardDiv(card, i); updatedCardDiv.classList.add('revealed'); updatedCardDiv.style.transition = 'none'; 
                container.replaceChild(updatedCardDiv, existingCard); setTimeout(() => { updatedCardDiv.style.transition = ''; }, 50);
            }
        });
    }
    attachScrollListener('content', 'player-scroll-left', 'player-scroll-right');
}

window.interactiveDraftAction = async (actionType, payload) => {
    if (actionType === 'async_pick') {
        const { handleAsyncPick } = await import('./draft-async.js?v=19.8');
        await handleAsyncPick(payload, currentRoom, currentPlayerId, utils);
    } else if (actionType === 'snake_pick') {
        const { handleSnakePick } = await import('./draft-snake.js?v=19.8');
        await handleSnakePick(payload, currentRoom, currentPlayerId, utils);
    } else if (actionType === 'burn_pick') {
        const { handleBurnPick } = await import('./draft-burn.js?v=19.8');
        await handleBurnPick(payload, currentRoom, currentPlayerId, utils);
    }
};

async function renderInteractiveDraft(activeDraft, container, s, players) {
    if (activeDraft.isComplete) {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; margin-top:50px;">
                <h2 style="color:var(--gold); font-family:Cinzel;">Finalizing Draft...</h2>
                <p style="color:#aaa;">Please wait while the results are tallied.</p>
                <span class="mana-spinner"></span>
            </div>
        `;
        return;
    }

    if (activeDraft.format === 'async_draft') {
        const { renderAsyncDraft } = await import('./draft-async.js?v=19.8');
        renderAsyncDraft(activeDraft, container, s, currentPlayerId, utils);
    } else if (activeDraft.format === 'snake_draft') {
        const { renderSnakeDraft } = await import('./draft-snake.js?v=19.8');
        renderSnakeDraft(activeDraft, container, s, currentPlayerId, players, utils);
    } else if (activeDraft.format === 'burn_draft') {
        const { renderBurnDraft } = await import('./draft-burn.js?v=19.8');
        renderBurnDraft(activeDraft, container, s, currentPlayerId, utils);
    }
}

function renderFinalSelection(list, s) {
    const container = document.getElementById('content');
    container.innerHTML = `
        <div style="width:100%; text-align:center; margin-bottom: 20px;">
            <h2 style="color:var(--gold); font-family:Cinzel;">Draft Complete!</h2>
            <p style="color:#aaa;">Choose your champion from the commanders you drafted.</p>
        </div>
    `;

    const cardContainer = document.createElement('div');
    cardContainer.style.display = 'flex';
    cardContainer.style.flexWrap = 'wrap';
    cardContainer.style.justifyContent = 'center';
    cardContainer.style.gap = '30px';
    cardContainer.style.width = '100%';
    
    list.forEach((card, i) => {
        let img1 = card.image_uris?.normal || (card.card_faces && card.card_faces[0].image_uris?.normal) || card.image1;
        let img2 = (card.card_faces && card.card_faces[1] && card.card_faces[1].image_uris?.normal) || card.image2 || null;
        let priceString = "Price N/A";
        if (card.prices) {
            if (s.currency === 'eur' && card.prices.eur !== 9999) priceString = `€${card.prices.eur}`;
            else if (s.currency === 'usd' && card.prices.usd !== 9999) priceString = `$${card.prices.usd}`;
        }
        
        const safeCardName = sanitizeHTML(card.name);
        const colorBadges = getColorBadges(card.color_identity);
        const edhrecSlug = safeCardName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const edhrecLink = `https://edhrec.com/commanders/${edhrecSlug}`;
        
        const cardDiv = document.createElement('div');
        cardDiv.className = 'option-card revealed'; // Already revealed
        cardDiv.style.transition = 'none';
        cardDiv.style.transform = 'none';
        cardDiv.style.opacity = '1';
        
        let imageHtml = '';
        if (img2) {
            imageHtml = `
            <div class="scene">
                <div class="card-3d" id="final-card3d-${i}">
                    <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC" style="display:block;" class="card-face card-face-front">
                        <img src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy" style="margin-top:0;">
                    </a>
                    <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC" style="display:block;" class="card-face card-face-back">
                        <img src="${sanitizeHTML(img2)}" class="commander-img" loading="lazy" style="margin-top:0;">
                    </a>
                </div>
            </div>
            <button class="flip-btn" onclick="window.flipCard3D('final-card3d-${i}', event)">🔄 Flip Card</button>
            `;
        } else {
            imageHtml = `
            <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC">
                <img id="final-img-${i}" src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy">
            </a>`;
        }

        cardDiv.innerHTML = `
            ${imageHtml}
            <p class="price-tag" style="margin-top: 15px;">${priceString}</p>
            <div class="mana-container">${colorBadges}</div>
            <p class="rank-tag" style="color:var(--gold); font-weight:bold; font-size: 1rem; margin-bottom: 15px;">EDHREC Rank: #${card.display_rank}</p>
            <button class="select-btn" data-idx="${i}">Lock In ${safeCardName}</button>
        `;

        cardDiv.querySelector('.select-btn').onclick = () => {
            playSound('sfx-click');
            showConfirm("Seal Your Champion?", `Are you sure you want to lock in ${card.name} as your commander? This choice is final.`, () => {
                playSound('sfx-choose');
                update(ref(db, `rooms/${currentRoom}/players/${currentPlayerId}`), {
                    selected: card.name, 
                    image: img1, 
                    display_rank: card.display_rank, 
                    scryfall_uri: card.scryfall_uri, 
                    color_identity: card.color_identity || [],
                    generated: null, // Clear the generated pool after selection
                    rerollCount: 0
                });
            });
        };
        cardContainer.appendChild(cardDiv);
    });
    container.appendChild(cardContainer);
    attachScrollListener('content', 'player-scroll-left', 'player-scroll-right');
}

function renderFinalForm(data) {
    const container = document.getElementById('content');
    const safeSelected = sanitizeHTML(data.selected);
    const finalRank = data.display_rank ? `#${data.display_rank}` : "Unranked";
    let rankHtml = `<p style="margin: 0 0 15px 0; font-size: 1.1rem; color: #d4af37; font-weight:bold;">EDHREC Rank: ${finalRank}</p>`;
    const colorBadges = getColorBadges(data.color_identity);
    
    const edhrecSlug = safeSelected.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const edhrecLink = `https://edhrec.com/commanders/${edhrecSlug}`;

    container.innerHTML = `
        <div class="form-container">
            <h2 style="color:var(--gold); font-family:Cinzel; margin-bottom:10px;">Commander Selected</h2>
            <h3 style="font-family:Cinzel; color:white; font-size:1.6rem; margin-bottom:5px;">${safeSelected}</h3>
            <div class="mana-container">${colorBadges}</div>
            ${rankHtml}
            <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC">
                <img src="${sanitizeHTML(data.image)}" class="final-commander-img" loading="lazy">
            </a><br><br>
            <p style="font-family:Cinzel; color:var(--gold);">Submit Deck Link</p>
            <input type="text" id="linkIn" value="${data.deck ? sanitizeHTML(data.deck) : ''}" placeholder="Moxfield / Archidekt URL..." style="width:80%; max-width:300px; font-size: 16px;">
            <br><button id="saveDeckBtn" class="select-btn">Save & Calculate Price</button>
        </div>
    `;

    document.getElementById('saveDeckBtn').onclick = async () => {
        playSound('sfx-click');
        const link = document.getElementById('linkIn').value.trim();
        const lowerLink = link.toLowerCase();
        
        if (lowerLink.includes("archidekt.com") || lowerLink.includes("moxfield.com")) {
            const btn = document.getElementById('saveDeckBtn');
            btn.innerHTML = '<span class="mana-spinner"></span> Calculating...';
            btn.disabled = true;
            const isMoxfield = lowerLink.includes("moxfield.com");
            showToast(isMoxfield ? "Calculating deck price... (Moxfield APIs may take a few seconds)" : "Calculating deck price...", false, 0);

            try {
                const sSnap = await get(ref(db, `rooms/${currentRoom}/settings`));
                const s = sSnap.val();

                const res = await fetchDeckPriceLocal(link, s.currency, s.includeCmdr, data.selected);
                
                if (res.error) {
                    showToast(res.error, true);
                } else {
                    let price = res.total || 0;
                    let updates = { 
                        deck: link, 
                        deckPrice: price,
                        isLegal: res.isLegal,
                        deckSize: res.deckSize,
                        deckSalt: res.deckSalt
                    };
                    if (res.commanderArt) updates.image = res.commanderArt;

                    const maxDeckBudget = s.deckBudget !== undefined ? parseFloat(s.deckBudget) : 50;
                    if (res.isLegal && (maxDeckBudget === 0 || price <= maxDeckBudget) && data.lockedDeckPrice === undefined) {
                        updates.lockedDeckPrice = price;
                    }

                    await update(ref(db, `rooms/${currentRoom}/players/${currentPlayerId}`), updates);

                    showToast("Deck sealed and priced!", false, 3000, true); 
                    setTimeout(() => window.closePlayerView(), 1000); 
                }
            } catch (e) {
                console.error(e);
                showToast("Calculation failed. Check URL.", true);
            } finally {
                btn.innerHTML = "Save & Calculate Price";
                btn.disabled = false;
            }
        } else {
            if (!link) return showToast("Please enter a URL.", true);
            
            showConfirm(
                "Price Calculation Unavailable",
                "You can add a link using other deck builders, but the deck pricing feature currently only works with Archidekt and Moxfield. Do you want to proceed?",
                async () => {
                    await update(ref(db, `rooms/${currentRoom}/players/${currentPlayerId}`), { deck: link, deckPrice: 0, lockedDeckPrice: 0, isLegal: true });
                    

                    showToast("Deck saved.", false, 3000, true);
                    setTimeout(() => window.closePlayerView(), 1000);
                }
            );
        }
    };
}

const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');
if (roomParam && !currentRoom) {
    const codeInput = document.getElementById('roomCodeInput');
    if (codeInput) {
        codeInput.value = roomParam.toUpperCase();
    }
}

if(currentRoom && currentPlayerId) {
    get(ref(db, `rooms/${currentRoom}`)).then(snap => {
        if(snap.exists()) snap.val().settings.status === 'rolling' ? initDashboard() : initLobby();
        else { clearSession(); switchView('view-landing'); } 
    });
}

/**
 * Makes a horizontal element draggable for scrolling.
 * @param {HTMLElement} slider The element to make draggable.
 */
function makeDraggable(slider) {
    if (!slider) return;

    let isDown = false;
    let startX;
    let scrollLeft;
    let isDragging = false;

    slider.addEventListener('mousedown', (e) => {
        // Don't drag on interactive elements like buttons, links, etc.
        if (e.target.closest('button, a, input, select, .tooltip')) {
            return;
        }
        // Only allow dragging if the content is actually scrollable.
        if (slider.scrollWidth <= slider.clientWidth) {
            return;
        }
        isDown = true;
        slider.style.scrollSnapType = 'none'; // Disable snap to prevent fighting during drag
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
        isDragging = false;
    });

    slider.addEventListener('mousemove', (e) => {
        if (!isDown) return;

        // A small movement threshold to differentiate between a click and a drag.
        if (!isDragging && Math.abs(e.pageX - (startX + slider.offsetLeft)) > 5) {
            isDragging = true;
            slider.classList.add('active-drag');
        }

        if (isDragging) {
            e.preventDefault();
            const x = e.pageX - slider.offsetLeft;
            const walk = (x - startX) * 2; // Multiplier for faster scrolling
            slider.scrollLeft = scrollLeft - walk;
        }
    });

    const stopDragging = () => {
        isDown = false;
        slider.style.scrollSnapType = ''; // Restore snap
        slider.classList.remove('active-drag');
        setTimeout(() => { isDragging = false; }, 50); // Small delay to prevent subsequent click events
    };

    slider.addEventListener('mouseup', stopDragging);
    slider.addEventListener('mouseleave', stopDragging);

    // Prevent click events on children (like links) after a drag has occurred.
    slider.addEventListener('click', (e) => { if (isDragging) { e.preventDefault(); e.stopPropagation(); } }, true);
}

// --- PLAYGROUP LOGIC ---

window.openDeclareWinner = async () => {
    playSound('sfx-click');
    const modal = document.getElementById('winnerModal');
    const listDiv = document.getElementById('winnerList');
    modal.style.display = 'flex'; setTimeout(() => modal.classList.add('show'), 10);

    const snap = await get(ref(db, `rooms/${currentRoom}/players`));
    const players = snap.val() || {};

    let html = '';
    Object.keys(players).forEach(id => {
        const p = players[id];
        if (p.selected) {
            html += `<button class="select-btn" style="background:#222; color:white; border:1px solid #555;" onclick="window.confirmWinner('${id}')">${sanitizeHTML(p.name)} (${sanitizeHTML(p.selected)})</button>`;
        }
    });
    if (!html) html = '<p style="color:#aaa;">No players have selected commanders.</p>';
    listDiv.innerHTML = html;
};

window.confirmWinner = (winnerId) => {
    playSound('sfx-click');
    showConfirm("Declare Winner?", "This will record the win and reset the drafting board so you can draft again. Proceed?", async () => {
        playSound('sfx-choose');
        try {
            const declareFn = httpsCallable(functions, 'hostDeclareWinner');
            const result = await declareFn({ roomId: currentRoom, winnerId: winnerId });
            document.getElementById('winnerModal').classList.remove('show');
            setTimeout(() => document.getElementById('winnerModal').style.display='none', 300);
            showToast(`👑 ${result.data.winnerName} takes the crown! Playgroup reset.`, false, 3000, true);
        } catch(e) {
            showToast("Failed to declare winner: " + e.message, true);
        }
    });
};

// Make the dashboard draggable
makeDraggable(document.getElementById('dynamicDashboard'));

const utils = { playSound, showToast, showConfirm, sanitizeHTML, switchView, getRoomCreationTime, getColorBadges };
const state = {
    get currentRoom() { return currentRoom; },
    set currentRoom(v) { currentRoom = v; },
    get currentPlayerId() { return currentPlayerId; },
    get currentPlayerName() { return currentPlayerName; },
    set currentPlayerName(v) { currentPlayerName = v; },
    get currentPlayerAvatar() { return currentPlayerAvatar; },
    set currentPlayerAvatar(v) { currentPlayerAvatar = v; },
    get isHost() { return isHost; },
    set isHost(v) { isHost = v; },
    get activeRoomListener() { return activeRoomListener; },
    set activeRoomListener(v) { activeRoomListener = v; },
    get activePlayerListener() { return activePlayerListener; },
    set activePlayerListener(v) { activePlayerListener = v; },
    get activeUserProfileListener() { return activeUserProfileListener; },
    set activeUserProfileListener(v) { activeUserProfileListener = v; }
};

window.isExplicitSignOut = false;
initAdminModule(utils);
initHubModule(utils, state, { initDashboard, initLobby });
initCalendarModule(utils, state);
initAuthModule(utils, state);
initProfileModule(utils, state);

// --- PWA SERVICE WORKER REGISTRATION ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            }, err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
}

// --- PWA INSTALL LOGIC ---
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile automatically
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Update UI to notify the user they can install the PWA
    const installBtn = document.getElementById('installPwaBtn');
    if (installBtn) installBtn.style.display = 'block';
});

const installBtn = document.getElementById('installPwaBtn');
if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                installBtn.style.display = 'none'; // Hide button once installed
            }
            deferredPrompt = null;
        }
    });
}

// Silently pre-fetch the heavy Archives JSON in the background to make rolling instant later
setTimeout(() => { getArchives().catch(() => {}); }, 3000);