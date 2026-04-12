<<<<<<< HEAD
import { db, auth, functions } from './firebase-setup.js?v=19.35';
import { fetchDeckPriceLocal } from './deck-parser.js?v=19.35';
import { getArchives } from './data-service.js?v=19.35';
import { initDeckActionsModule } from './deck-actions.js?v=19.35';
import { initRoomActionsModule } from './room-actions.js?v=19.35';
import { initPlayerViewModule } from './player-view.js?v=19.35';
import { initAdminModule } from './admin.js?v=19.35';
import { initCalendarModule } from './calendar.js?v=19.35';
import { initAuthModule } from './auth.js?v=19.35';
import { initHubModule } from './hub.js?v=19.35';
import { initProfileModule } from './profile.js?v=19.35';
=======
import { db, auth, functions } from './firebase-setup.js?v=19.37';
import { fetchDeckPriceLocal } from './deck-parser.js?v=19.37';
import { getArchives } from './data-service.js?v=19.37';
import { initDeckActionsModule } from './deck-actions.js?v=19.37';
import { initRoomActionsModule } from './room-actions.js?v=19.37';
import { initPlayerViewModule } from './player-view.js?v=19.37';
import { initAdminModule } from './admin.js?v=19.37';
import { initCalendarModule } from './calendar.js?v=19.37';
import { initAuthModule } from './auth.js?v=19.37';
import { initHubModule } from './hub.js?v=19.37';
import { initProfileModule } from './profile.js?v=19.37';
>>>>>>> 841e8184f65ac7568c44310841867f522ab20667
import { ref, set, get, onValue, update, remove, increment, runTransaction, onDisconnect } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
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

function getColorBadges(colors) {
    if (!colors || colors.length === 0) return `<span class="mana-badge mana-C">C</span>`;
    return colors.map(c => `<span class="mana-badge mana-${c}">${c}</span>`).join('');
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

window.establishPresence = () => {
    if (currentRoom && currentPlayerId) {
        const myStatusRef = ref(db, `rooms/${currentRoom}/players/${currentPlayerId}/online`);
        onDisconnect(myStatusRef).set(false).then(() => { set(myStatusRef, true); });
    }
};

onValue(ref(db, '.info/connected'), (snap) => {
    if (snap.val() === true) window.establishPresence();
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
    
    const numOptsContainer = document.getElementById('settingNumOptions') ? document.getElementById('settingNumOptions').parentElement : null;
    const snakePoolContainer = document.getElementById('snakePoolContainer');
    const isSnake = draftFormatEl && draftFormatEl.value === 'snake_draft';

    if (isSnake) {
        if (numOptsContainer) numOptsContainer.style.display = 'flex';
        if (snakePoolContainer) snakePoolContainer.style.display = 'flex';
        if(numOptionsLabel) numOptionsLabel.innerText = "Picks per Player (1-5):";
    } else {
        if (numOptsContainer) numOptsContainer.style.display = 'flex';
        if (snakePoolContainer) snakePoolContainer.style.display = 'none';
        if(numOptionsLabel) numOptionsLabel.innerText = isInteractive ? "Pack Size (1-5):" : "# Cards to Select From (1-5):";
    }

    if (randomSettingsEl) randomSettingsEl.style.display = (!isInteractive && isManual) ? 'none' : 'block';

    const isBurn = draftFormatEl && draftFormatEl.value === 'burn_draft';
    const numOptsEl = document.getElementById('settingNumOptions');
    if (numOptsEl) {
        numOptsEl.options[0].disabled = isBurn; // Disable '1' option
        if (isBurn && numOptsEl.value === '1') {
            numOptsEl.value = '2'; // Force to 2 if 1 is currently selected
            numOptsEl.dispatchEvent(new Event('change'));
        }
    }
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

    const savedSettingsStr = localStorage.getItem('hostDefaultSettings');
    const defaultSettings = savedSettingsStr ? JSON.parse(savedSettingsStr) : { budget: 10, currency: 'eur', deckBudget: 50, includeCmdr: true, maxRank: 1, minRank: 500, noPartner: true, numOptions: 3, maxRerolls: 1, selectionMode: 'both', draftFormat: 'independent', maxBracket: 5 };
    defaultSettings.status = 'waiting';
    defaultSettings.createdAt = Date.now();
    await set(ref(db, `rooms/${roomCode}/settings`), defaultSettings);
    
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

function syncSettingsToUI(s) {
    if (!s) return;
    if (document.getElementById('settingDraftFormat')) document.getElementById('settingDraftFormat').value = s.draftFormat || 'independent';
    if (document.getElementById('settingSelectionMode')) document.getElementById('settingSelectionMode').value = s.selectionMode || 'both';
    if (document.getElementById('settingCurrency')) document.getElementById('settingCurrency').value = s.currency || 'eur';
    if (document.getElementById('settingBudget')) document.getElementById('settingBudget').value = s.budget || 10;
    if (document.getElementById('settingDeckBudget')) document.getElementById('settingDeckBudget').value = s.deckBudget || 50;
    if (document.getElementById('settingIncludeCmdr')) document.getElementById('settingIncludeCmdr').checked = s.includeCmdr !== false;
    if (document.getElementById('settingMaxBracket')) document.getElementById('settingMaxBracket').value = s.maxBracket || 5;
    if (document.getElementById('settingMin')) document.getElementById('settingMin').value = s.maxRank || 1;
    if (document.getElementById('settingMax')) document.getElementById('settingMax').value = s.minRank || 500;
    if (document.getElementById('settingNumOptions')) document.getElementById('settingNumOptions').value = s.numOptions || 3;
    if (document.getElementById('settingSnakePoolSize')) document.getElementById('settingSnakePoolSize').value = s.snakePoolSize || 15;
    if (document.getElementById('settingMaxRerolls')) document.getElementById('settingMaxRerolls').value = s.maxRerolls || 1;
    if (document.getElementById('settingNoPartner')) document.getElementById('settingNoPartner').checked = s.noPartner || false;
    if (document.getElementById('settingBlindDraft')) document.getElementById('settingBlindDraft').checked = s.blindDraft || false;
    if (document.getElementById('toggleCmdrBudget')) document.getElementById('toggleCmdrBudget').checked = s.budget > 0;
    if (document.getElementById('toggleDeckBudget')) document.getElementById('toggleDeckBudget').checked = s.deckBudget > 0;
    if (document.getElementById('toggleRank')) document.getElementById('toggleRank').checked = (s.minRank > 0 || s.maxRank > 0);
    updateSettingsVisibility(); 
    ['toggleCmdrBudget', 'toggleDeckBudget', 'toggleRank'].forEach(id => { 
        const el = document.getElementById(id); 
        if (el) el.dispatchEvent(new Event('change')); 
    });

    if (!isHost) {
        getArchives().then(archives => {
            if (archives) {
                const pool = archives.filter(card => {
                    const price = s.currency === 'eur' ? card.prices.eur : card.prices.usd;
                    if (s.budget !== 0 && price >= s.budget) return false;
                    if (s.noPartner && card.isPartner) return false;
                    if (s.maxRank !== 0 && card.rank_edhrec < s.maxRank) return false;
                    if (s.minRank !== 0 && card.rank_edhrec > s.minRank) return false;
                    return true;
                });
                const counterEl = document.getElementById('livePoolCounter');
                if (counterEl) {
                    counterEl.innerHTML = `Valid Commanders in Archives: <strong style="color:var(--gold);">${pool.length}</strong>`;
                }
            }
        });
    }
}

function initLobby() {
    window.establishPresence();
    switchView('view-lobby');
    document.getElementById('displayRoomCode').innerText = currentRoom;

    document.getElementById('hostSettingsUI').style.display = 'block';
    const webhookPanel = document.getElementById('webhookPanel');
    if (webhookPanel) webhookPanel.style.display = isHost ? 'block' : 'none';

    if(isHost) {
        document.getElementById('waitingMessage').style.display = 'none';
        if (document.getElementById('hostActionButtons')) document.getElementById('hostActionButtons').style.display = 'flex';
        document.querySelectorAll('#hostSettingsUI input, #hostSettingsUI select').forEach(el => el.disabled = false);
        
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

        // Sync UI inputs with the actual database settings so they don't reset on page refresh
        get(ref(db, `rooms/${currentRoom}/settings`)).then(snap => {
            syncSettingsToUI(snap.val());
        });

        const resetSettingsBtn = document.getElementById('resetSettingsBtn');
        if (resetSettingsBtn) {
            resetSettingsBtn.style.display = 'block';
            resetSettingsBtn.onclick = () => {
                playSound('sfx-click');
                const defaultS = { budget: 10, currency: 'eur', deckBudget: 50, includeCmdr: true, maxRank: 1, minRank: 500, noPartner: true, numOptions: 3, snakePoolSize: 15, maxRerolls: 1, selectionMode: 'both', blindDraft: false, draftFormat: 'independent', maxBracket: 5 };
                syncSettingsToUI(defaultS);
                showToast("Settings reset to defaults.");
                setTimeout(autoSaveSettings, 100);
            };
        }
    } else {
        if (document.getElementById('hostActionButtons')) document.getElementById('hostActionButtons').style.display = 'none';
        document.getElementById('waitingMessage').style.display = 'block';
        const resetSettingsBtn = document.getElementById('resetSettingsBtn');
        if (resetSettingsBtn) resetSettingsBtn.style.display = 'none';
        document.querySelectorAll('#hostSettingsUI input, #hostSettingsUI select').forEach(el => el.disabled = true);
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

        if (!isHost && data.settings) {
            syncSettingsToUI(data.settings);
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
                let presenceDot = `<span class="presence-dot ${p.online ? 'presence-online' : 'presence-offline'}" title="${p.online ? 'Online' : 'Offline'}"></span>`;
                listEl.innerHTML += `<li>${avatarHtml} ${presenceDot}${safeName}${hostIcon}${trophies}${guestTag}</li>`;
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
                    el.disabled = !toggle.checked || !isHost;
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

let saveSettingsTimeout;
function autoSaveSettings() {
    if (!isHost || !currentRoom) return;
    clearTimeout(saveSettingsTimeout);
    saveSettingsTimeout = setTimeout(() => {
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
        const snakePoolSize = Math.min(30, Math.max(2, parseInt(document.getElementById('settingSnakePoolSize')?.value) || 15));

        const settingsPayload = {
            budget: b, currency: c, deckBudget: dbudget, includeCmdr: incCmdr, minRank: minR, maxRank: maxR, noPartner: noPartner, numOptions: numOpts, snakePoolSize: snakePoolSize, maxRerolls: maxRr, selectionMode: selMode, blindDraft: blind, draftFormat: draftFormat, maxBracket: maxBracket
        };
        localStorage.setItem('hostDefaultSettings', JSON.stringify(settingsPayload));
        update(ref(db, `rooms/${currentRoom}/settings`), settingsPayload);

        // QoL: Live Commander Pool Counter
        if (isHost) {
            getArchives().then(archives => {
                if (archives) {
                    const pool = archives.filter(card => {
                        const price = c === 'eur' ? card.prices.eur : card.prices.usd;
                        if (b !== 0 && price >= b) return false;
                        if (noPartner && card.isPartner) return false;
                        if (maxR !== 0 && card.rank_edhrec < maxR) return false;
                        if (minR !== 0 && card.rank_edhrec > minR) return false;
                        return true;
                    });
                    const counterEl = document.getElementById('livePoolCounter');
                    if (counterEl) {
                        counterEl.innerHTML = `Valid Commanders in Archives: <strong style="color:var(--gold);">${pool.length}</strong>`;
                        if (pool.length < 15) counterEl.innerHTML += `<br><span style="color:#ff4444;">Warning: Pool may be too small for drafts!</span>`;
                    }
                }
            });
        }
    }, 500);
}

document.querySelectorAll('#hostSettingsUI input, #hostSettingsUI select').forEach(el => {
    if (el.id === 'settingDiscordWebhook') return;
    el.addEventListener('change', autoSaveSettings);
    if (el.type === 'text' || el.type === 'number') {
        el.addEventListener('input', autoSaveSettings);
    }
});

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
    const snakePoolSize = Math.min(30, Math.max(2, parseInt(document.getElementById('settingSnakePoolSize')?.value) || 15));
    const webhookUrl = document.getElementById('settingDiscordWebhook') ? document.getElementById('settingDiscordWebhook').value.trim() : '';

    const settingsPayload = {
        budget: b, currency: c, deckBudget: dbudget, includeCmdr: incCmdr, minRank: minR, maxRank: maxR, noPartner: noPartner, numOptions: numOpts, snakePoolSize: snakePoolSize, maxRerolls: maxRr, selectionMode: selMode, blindDraft: blind, draftFormat: draftFormat, maxBracket: maxBracket, status: 'rolling'
    };
    localStorage.setItem('hostDefaultSettings', JSON.stringify(settingsPayload));
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
    window.establishPresence();
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

        const refreshAllDropdownBtn = document.getElementById('refreshAllDropdownBtn');
        if (refreshAllDropdownBtn) refreshAllDropdownBtn.style.display = isHost ? 'block' : 'none';

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

        const burnLogBtn = document.getElementById('burnLogBtn');
        if (burnLogBtn) {
            if (activeDraft && activeDraft.format === 'burn_draft' && activeDraft.burnLog) {
                burnLogBtn.style.display = 'inline-block';
            } else {
                burnLogBtn.style.display = 'none';
            }
        }

        // Smart Sort: Action Required First -> Host -> Alphabetical
        const getStatusWeight = (p) => {
            if (!p.selected) return 0; // Drafting / Waiting
            if (!p.deck) return 1; // Commander Chosen
            let maxBudget = data.settings.deckBudget !== undefined ? parseFloat(data.settings.deckBudget) : 50;
            let checkPrice = p.lockedDeckPrice !== undefined ? p.lockedDeckPrice : (p.deckPrice || 0);
            let isReady = p.isLegal === true && (maxBudget === 0 || checkPrice <= maxBudget);
            return isReady ? 3 : 2; // Ready (3) vs Deck Sealed (2)
        };

        const sortedIds = Object.keys(players).sort((a,b) => {
            const weightA = getStatusWeight(players[a]);
            const weightB = getStatusWeight(players[b]);
            if (weightA !== weightB) return weightA - weightB;
            if (players[a].isHost !== players[b].isHost) return players[a].isHost ? -1 : 1;
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

            let presenceDot = `<span class="presence-dot ${pData.online ? 'presence-online' : 'presence-offline'}" title="${pData.online ? 'Online' : 'Offline'}"></span>`;
            let html = `<div class="card ${highlightClass}"><div style="display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:10px;">${avatarImg}<h3 style="margin:0; display:flex; align-items:center;">${presenceDot}${safeName}${hostIcon}${trophies}${guestTag}</h3></div>${statusHtml}`;

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

// Make the dashboard draggable
makeDraggable(document.getElementById('dynamicDashboard'));

const utils = { playSound, showToast, showConfirm, sanitizeHTML, switchView, getRoomCreationTime, clearSession, attachScrollListener, getArchives, getColorBadges };
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
initDeckActionsModule(utils, state);
initRoomActionsModule(utils, state);
initPlayerViewModule(utils, state);

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