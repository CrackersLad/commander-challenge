import { db, auth, functions } from './firebase-setup.js?v=4.6';
import { fetchDeckPriceLocal } from './deck-parser.js?v=4.6';
import { getArchives } from './data-service.js?v=4.6';
import { initDeckActionsModule } from './deck-actions.js?v=4.6';
import { initRoomActionsModule } from './room-actions.js?v=4.6';
import { initPlayerViewModule } from './player-view.js?v=4.6';
import { initAdminModule } from './admin.js?v=4.6';
import { initCalendarModule } from './calendar.js?v=4.6';
import { initAuthModule } from './auth.js?v=4.6';
import { initHubModule } from './hub.js?v=4.6';
import { initProfileModule } from './profile.js?v=4.6';
import { initCardInspector, openCardInspector } from './card-inspector.js?v=4.6';
import { initWarRoom, openWarRoom } from './war-room.js?v=4.6';
import { initBoosterSimulatorModule, crackBoosterProduct, updateMarketAndCostDisplay, setSortMode, setFilterMode } from './booster-simulator.js?v=4.6';
import { initBoosterDraftModule } from './booster-draft.js?v=4.6';
import { buildGoogleCalendarUrl, downloadIcsFile, testDiscordWebhook } from './calendar-webhook-utils.js?v=4.6';
import { ref, set, get, onValue, update, remove, increment, runTransaction, onDisconnect } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-functions.js";

// Optimize for mobile/WebView: Ensure viewport is set correctly

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
        setTimeout(() => {
            event.target.style.display = 'none';
            if (event.target.id === 'quickRollOverlay') event.target.remove();
        }, 300);
    }
});

const initialNameInput = document.getElementById('playerNameInput');
if (initialNameInput && currentPlayerName) initialNameInput.value = currentPlayerName;

const initialGlobalName = document.getElementById('globalAccountName');
if (initialGlobalName && currentPlayerName) {
    initialGlobalName.innerText = currentPlayerName;
}
const initialGlobalAvatar = document.getElementById('globalAvatar');
if (initialGlobalAvatar && currentPlayerAvatar) {
    initialGlobalAvatar.src = currentPlayerAvatar;
    initialGlobalAvatar.style.display = 'block';
}

let activeRoomListener = null;
let activePlayerListener = null;
let activeUserProfileListener = null;
let isSearchingManually = false;

let scryfallSets = [];
let setNameToCodeMap = new Map();
let setsPromise = null;

function fetchAndPopulateSets() {
    if (!setsPromise) {
        setsPromise = new Promise(async (resolve) => {
            const setDatalist = document.getElementById('setList');
            try {
                const response = await fetch('https://api.scryfall.com/sets', {
                    headers: { 'Accept': 'application/json' }
                });
                if (!response.ok) throw new Error('Scryfall API for sets failed');
                const data = await response.json();
                scryfallSets = (data.data || [])
                    .filter(set => ['core', 'expansion', 'masters', 'draft_innovation', 'funny', 'commander'].includes(set.set_type) && set.card_count > 50)
                    .sort((a, b) => new Date(b.released_at) - new Date(a.released_at));

                let datalistHTML = '';
                let boosterDatalistHTML = '';
                setNameToCodeMap.clear();
                scryfallSets.forEach(set => {
                    datalistHTML += `<option value="${sanitizeHTML(set.name)}">${sanitizeHTML(set.code.toUpperCase())}</option>`;
                    boosterDatalistHTML += `<option value="${sanitizeHTML(set.name)} (${sanitizeHTML(set.code.toUpperCase())})"></option>`;
                    setNameToCodeMap.set(set.name.toLowerCase(), set.code.toLowerCase());
                    setNameToCodeMap.set(set.code.toLowerCase(), set.code.toLowerCase());
                });
                window.scryfallSets = scryfallSets;
                if (setDatalist) setDatalist.innerHTML = datalistHTML;
                const boosterDatalist = document.getElementById('boosterSetDatalist');
                if (boosterDatalist) boosterDatalist.innerHTML = boosterDatalistHTML;
                resolve();
            } catch (error) { console.error("Failed to fetch Scryfall sets:", error); resolve(); }
        });
    }
    return setsPromise;
}
fetchAndPopulateSets();

function resolveClientSet(rawInput) {
    if (!rawInput) return { code: 'dsk', name: 'Duskmourn: House of Horror' };
    const raw = String(rawInput).trim();
    const rawLower = raw.toLowerCase();

    if (setNameToCodeMap.has(rawLower)) {
        const code = setNameToCodeMap.get(rawLower);
        const setObj = scryfallSets.find(s => s.code.toLowerCase() === code);
        return { code: code, name: setObj ? setObj.name : raw };
    }

    const found = scryfallSets.find(s => s.name.toLowerCase() === rawLower || s.code.toLowerCase() === rawLower);
    if (found) return { code: found.code, name: found.name };

    const partial = scryfallSets.find(s => s.name.toLowerCase().includes(rawLower) || rawLower.includes(s.name.toLowerCase()));
    if (partial) return { code: partial.code, name: partial.name };

    if (/^[a-z0-9]{3,5}$/i.test(raw)) {
        return { code: rawLower, name: raw.toUpperCase() };
    }

    return { code: 'dsk', name: 'Duskmourn: House of Horror' };
}

function sanitizeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

function getColorBadges(colors) {
    if (!colors || colors.length === 0) return `<span class="mana-badge mana-C">C</span>`;
    return colors.map(c => {
        const safeC = sanitizeHTML(c);
        return `<span class="mana-badge mana-${safeC}">${safeC}</span>`;
    }).join('');
}

function getRoomCreationTime(data) {
    if(!data) return null;
    if(data.settings && data.settings.createdAt) return data.settings.createdAt;
    if(data.players) {
        const hostEntry = Object.entries(data.players).find(([k, v]) => v.isHost);
            if(hostEntry) {
                return hostEntry[1].joinedAt || null;
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
});

window.establishPresence = () => {
    if (currentRoom && currentPlayerId) {
        // Prevent recreating deleted rooms by ensuring the room exists first
        get(ref(db, `rooms/${currentRoom}/settings`)).then(snap => {
            if (snap.exists() && currentRoom) {
                const myStatusRef = ref(db, `rooms/${currentRoom}/players/${currentPlayerId}/online`);
                onDisconnect(myStatusRef).set(false).then(() => { set(myStatusRef, true); });
            }
        });
    }
};

onValue(ref(db, '.info/connected'), (snap) => {
    if (snap.val() === true) window.establishPresence();
});

const sfxToggle = document.getElementById('sfxToggle');

let isSfxMuted = localStorage.getItem('draft_sfx') === 'true';

function applyAudioUI() {
    if (!sfxToggle) return;
    if (isSfxMuted) {
        sfxToggle.innerText = "🔇 SFX"; sfxToggle.style.color = "#ff9999"; sfxToggle.style.borderColor = "#ff4444";
    } else {
        sfxToggle.innerText = "🔊 SFX"; sfxToggle.style.color = "var(--gold)"; sfxToggle.style.borderColor = "var(--gold)";
    }
}
applyAudioUI();

if (sfxToggle) {
    sfxToggle.onclick = () => {
        isSfxMuted = !isSfxMuted;
        localStorage.setItem('draft_sfx', isSfxMuted ? 'true' : 'false');
        applyAudioUI();
        if (!isSfxMuted) playSound('sfx-click');
    };
}

const draftFormatEl = document.getElementById('settingDraftFormat');
const selectionModeContainer = document.getElementById('selectionModeContainer');
const selectionModeEl = document.getElementById('settingSelectionMode');
const randomSettingsEl = document.getElementById('randomSettingsContainer');
const rerollsContainer = document.getElementById('rerollsContainer');
const numOptionsLabel = document.getElementById('numOptionsLabel');

function updateSettingsVisibility() {
    const draftFormatEl = document.getElementById('settingDraftFormat');
    const draftFormat = draftFormatEl?.value || 'independent';
    const isInteractive = draftFormat !== 'independent';

    const selectionModeContainer = document.getElementById('selectionModeContainer');
    const rerollsContainer = document.getElementById('rerollsContainer');
    const randomSettingsEl = document.getElementById('randomSettingsContainer');
    const snakePoolContainer = document.getElementById('snakePoolContainer');
    const numOptsContainer = document.getElementById('settingNumOptions') ? document.getElementById('settingNumOptions').parentElement : null;
    const numOptsEl = document.getElementById('settingNumOptions');
    const numOptionsLabel = document.getElementById('numOptionsLabel');
    const selectionModeEl = document.getElementById('settingSelectionMode');
    const blindDraftToggle = document.getElementById('settingBlindDraft')?.closest('.toggle-label');

    if (selectionModeContainer) selectionModeContainer.style.display = isInteractive ? 'none' : 'block';
    if (rerollsContainer) rerollsContainer.style.display = isInteractive ? 'none' : 'flex';
    if (randomSettingsEl) randomSettingsEl.style.display = 'block';
    if (snakePoolContainer) snakePoolContainer.style.display = (draftFormat === 'snake_draft') ? 'flex' : 'none';
    if (numOptsContainer) numOptsContainer.style.display = 'flex';
    if (numOptionsLabel) numOptionsLabel.innerText = (draftFormat === 'snake_draft') ? "Picks per Player (1-5):" : (isInteractive ? "Pack Size (1-5):" : "# Cards to Select From (1-5):");
    if (selectionModeEl) selectionModeEl.disabled = false;
    if (numOptsEl) numOptsEl.disabled = false;
    if (blindDraftToggle) blindDraftToggle.style.display = 'flex';

    if (draftFormat === 'burn_draft' && numOptsEl) {
        numOptsEl.options[0].disabled = true;
        if (numOptsEl.value === '1') { numOptsEl.value = '2'; }
    } else if (numOptsEl && numOptsEl.options[0]) {
        numOptsEl.options[0].disabled = false;
    }
}

const draftFormatSelect = document.getElementById('settingDraftFormat');
if (draftFormatSelect) draftFormatSelect.addEventListener('change', updateSettingsVisibility);
const selModeSelect = document.getElementById('settingSelectionMode');
if (selModeSelect) selModeSelect.addEventListener('change', updateSettingsVisibility);
updateSettingsVisibility();

window.setupAdvancedSettings = () => {
    const hostUI = document.getElementById('hostSettingsUI');
    if (!hostUI || document.getElementById('advancedToggleBtn')) return;

    hostUI.classList.add('hide-advanced');

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'advancedToggleBtn';
    toggleBtn.className = 'secondary-btn';
    toggleBtn.style.cssText = 'margin: 15px 0; width: 100%; padding: 10px; font-size: 0.95rem; border-color: #666; color: #ccc; background: rgba(0,0,0,0.4);';
    toggleBtn.innerHTML = '⚙️ Show Advanced Options ▼';

    toggleBtn.onclick = (e) => {
        e.preventDefault();
        const isHidden = hostUI.classList.contains('hide-advanced');
        if (isHidden) {
            hostUI.classList.remove('hide-advanced');
            toggleBtn.innerHTML = '⚙️ Hide Advanced Options ▲';
        } else {
            hostUI.classList.add('hide-advanced');
            toggleBtn.innerHTML = '⚙️ Show Advanced Options ▼';
        }
        if (window.playSound) window.playSound('sfx-click');
    };

    const advancedInputIds = [ 'settingSelectionMode', 'settingMaxBracket', 'toggleRank', 'settingNoPartner', 'settingBlindDraft', 'settingMaxRerolls', 'settingSnakePoolSize' ];
    advancedInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            let wrapper = null;
            // Find the most appropriate container to hide for each setting
            switch(id) {
                case 'settingSelectionMode':
                    wrapper = document.getElementById('selectionModeContainer');
                    break;
                case 'settingMaxRerolls':
                    wrapper = document.getElementById('rerollsContainer');
                    break;
                case 'settingSnakePoolSize':
                    wrapper = document.getElementById('snakePoolContainer');
                    break;
                case 'toggleRank':
                case 'settingNoPartner':
                case 'settingBlindDraft':
                    wrapper = el.closest('.toggle-label');
                    break;
                case 'settingMaxBracket':
                    wrapper = el.closest('.settings-input-group');
                    break;
            }

            if (wrapper && wrapper !== hostUI) wrapper.classList.add('advanced-section');
        }
    });

    const startBtn = document.getElementById('startDraftBtn');
    if (startBtn && hostUI.contains(startBtn)) startBtn.parentNode.insertBefore(toggleBtn, startBtn);
    else hostUI.appendChild(toggleBtn);
};

export function playSound(soundId) {
    // Web Vibration Haptics for mobile browsers
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        if (soundId === 'sfx-choose' || soundId === 'sfx-reveal') {
            try { navigator.vibrate(50); } catch(e) {}
        } else {
            try { navigator.vibrate(20); } catch(e) {}
        }
    }

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

function switchView(viewId, pushState = true) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    const viewEl = document.getElementById(viewId);
    if (viewEl) viewEl.classList.add('active');
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;

    // Update navbar room context
    const navRoomBadge = document.getElementById('navRoomBadge');
    const navRoomCode = document.getElementById('navRoomCode');
    if (navRoomBadge && navRoomCode) {
        if (currentRoom && (viewId === 'view-lobby' || viewId === 'view-dashboard' || viewId === 'view-player')) {
            navRoomCode.innerText = currentRoom;
            navRoomBadge.style.display = 'flex';
        } else {
            navRoomBadge.style.display = 'none';
        }
    }

    if (pushState) {
        window.history.pushState({ viewId }, '', `#${viewId}`);
    }
}

window.addEventListener('popstate', (event) => {
    if (event.state && event.state.viewId) {
        switchView(event.state.viewId, false);
    } else {
        const hash = window.location.hash || '';
        if (hash.startsWith('#draft-') || hash === '#view-booster-draft' || hash === '#booster-draft') {
            switchView('view-booster-draft', false);
        } else if (hash === '#view-booster-simulator' || hash === '#booster-simulator') {
            switchView('view-booster-simulator', false);
        } else {
            switchView('view-landing', false);
        }
    }
});

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
            ${s.draftSet ? `<p style="margin: 8px 0;"><strong style="color:var(--gold);">Set:</strong> ${s.draftSetName || s.draftSet.toUpperCase()}</p>` : ''}
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
        const inviteUrl = `https://edhchallenge.com/?room=${currentRoom}`;
        navigator.clipboard.writeText(inviteUrl).then(() => { playSound('sfx-click'); showToast("Invite Link copied to clipboard!", false, 3000, true); });
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
            
            const myStatusRef = ref(db, `rooms/${currentRoom}/players/${currentPlayerId}/online`);
            onDisconnect(myStatusRef).cancel().catch(() => {});

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

window.pingPlayer = async (targetId) => {
    playSound('sfx-click');
    const btn = document.querySelector(`button[onclick="window.pingPlayer('${targetId}')"]`);
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
    }
    try {
        const pingFn = httpsCallable(functions, 'pingPlayer');
        await pingFn({ roomId: currentRoom, targetId: targetId, pingerName: currentPlayerName });
        showToast("Player pinged!", false, 3000, true);
    } catch(e) {
        showToast(e.message, true);
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    }
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
        let nameLabel = `${roleIcon}${trophyIcon} **${p.name}**`;

        if (p.selected) {
            let curr = data.settings?.currency === 'usd' ? '$' : '€';
            let priceText = p.lockedDeckPrice !== undefined ? ` (🔒 ${curr}${p.lockedDeckPrice.toFixed(2)})` : (p.deckPrice ? ` (${curr}${p.deckPrice.toFixed(2)})` : '');
            let saltText = p.deckSalt !== undefined ? ` [☣️ Salt: ${Number(p.deckSalt).toFixed(1)}]` : '';
            let legalText = p.deck ? (p.isLegal ? ' [✅ Legal]' : ' [⚠️ Illegal]') : '';

            if (hideInfo) {
                text += `${nameLabel}: ??? (Mysterious Commander)${priceText}${saltText}${legalText}\n   🔗 (Link hidden in Blind Draft)\n\n`;
            } else {
                const deckLink = p.deck ? `<${p.deck}>` : 'No Link';
                text += `${nameLabel}: **${p.selected}**${priceText}${saltText}${legalText}\n   🔗 ${deckLink}\n\n`;
            }
        }
        else text += `${nameLabel}: Drafting...\n\n`;
    });

    const inviteUrl = `https://edhchallenge.com/?room=${currentRoom}`;
    text += `\n\nJoin the challenge: <${inviteUrl}>`;

    navigator.clipboard.writeText(text).then(() => showToast("Match Summary copied!", false, 3000, true))
    .catch(() => showToast("Failed to copy.", true));
};

function trackJoinedRoom(code) {
    if (!code) return;
    let joined = JSON.parse(localStorage.getItem('joinedRooms') || '[]');
    if (!joined.includes(code)) {
        joined.push(code);
        localStorage.setItem('joinedRooms', JSON.stringify(joined));
    }
}

const createBtn = document.getElementById('createBtn');
if (createBtn) {
    createBtn.onclick = () => window.startCommanderChallenge();
}

window.startCommanderChallenge = async () => {
    playSound('sfx-click');

    const name = document.getElementById('playerNameInput')?.value.trim();
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
    trackJoinedRoom(roomCode);
    initLobby();
};

const joinBtn = document.getElementById('joinBtn');
if (joinBtn) {
    joinBtn.onclick = async () => {
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
            trackJoinedRoom(code);
            showToast("Welcome back!", false, 3000, true);
            
            // Re-fetch updated data to determine where to go
            const latestSnap = await get(ref(db, `rooms/${code}`));
            if (latestSnap.exists()) {
                latestSnap.val().settings.status === 'rolling' ? initDashboard() : initLobby();
            }
        });
        return;
    }

    if (roomData.settings && roomData.settings.status === 'rolling' && roomData.settings.draftFormat !== 'independent') {
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
    trackJoinedRoom(code);

    if(roomData.settings && roomData.settings.status === 'rolling') initDashboard();
    else initLobby();
    };
}

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
        
        if (typeof window.setupAdvancedSettings === 'function') window.setupAdvancedSettings();
        
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
    } else {
        document.getElementById('waitingMessage').style.display = 'block';
        if (document.getElementById('hostActionButtons')) document.getElementById('hostActionButtons').style.display = 'none';
        document.querySelectorAll('#hostSettingsUI input, #hostSettingsUI select').forEach(el => el.disabled = true);
    }

    if (activeRoomListener) { activeRoomListener(); activeRoomListener = null; }

    activeRoomListener = onValue(ref(db, `rooms/${currentRoom}`), (snap) => {
        const data = snap.val();
        if (!data) return;

        if (data.settings && data.settings.status === 'rolling') {
            if (activeRoomListener) { activeRoomListener(); activeRoomListener = null; }
            initDashboard();
            return;
        }

        const players = data.players || {};
        const playersList = document.getElementById('lobbyPlayerList');
        playersList.innerHTML = '';
        
        const playerEntries = Object.entries(players);
        document.getElementById('playerCountDisplay').innerText = `Players Assembled (${playerEntries.length}/6):`;
        updateSettingsVisibility();

        const currentUser = auth.currentUser;
        playerEntries.forEach(([id, p]) => {
            const li = document.createElement('li');
            li.className = 'lobby-player-card';
            const isMe = id === currentPlayerId;
            const canKick = isHost && !isMe;
            const safePlayerName = sanitizeHTML(p.name);
            const avatarImg = p.avatar ? `<img src="${sanitizeHTML(p.avatar)}" class="lobby-player-avatar">` : `<div class="lobby-player-avatar default-avatar">🧙</div>`;

            li.innerHTML = `
                <div class="lobby-player-info">
                    ${avatarImg}
                    <span class="lobby-player-name">${safePlayerName}</span>
                    ${p.isHost ? '<span class="host-tag">HOST</span>' : ''}
                    ${isMe ? '<span class="you-tag">(YOU)</span>' : ''}
                </div>
                ${canKick ? `<button class="kick-btn" data-id="${id}" title="Kick Player">✖</button>` : ''}
            `;

            if (canKick) {
                li.querySelector('.kick-btn').onclick = (e) => {
                    e.stopPropagation();
                    playSound('sfx-click');
                    showConfirm("Remove Challenger", `Are you sure you want to kick ${p.name} from the playgroup?`, async () => {
                        await remove(ref(db, `rooms/${currentRoom}/players/${id}`));
                        showToast(`${p.name} was removed.`, false);
                    });
                };
            }

            playersList.appendChild(li);
        });

        // Always fill open slots up to 6 so the 6-player horizontal carousel is visually obvious and interactive
        const maxSlots = 6;
        for (let i = playerEntries.length + 1; i <= maxSlots; i++) {
            const openLi = document.createElement('li');
            openLi.className = 'lobby-player-card lobby-slot-open';
            openLi.onclick = () => window.copyRoomCode();
            openLi.title = "Click to copy invite link";
            openLi.innerHTML = `
                <div class="lobby-player-info">
                    <div class="lobby-player-avatar open-avatar">➕</div>
                    <div class="open-slot-text">
                        <span class="lobby-player-name open-title">Slot ${i}</span>
                        <span class="open-subtitle">Waiting for player...</span>
                    </div>
                </div>
            `;
            playersList.appendChild(openLi);
        }

        if (data.settings) syncSettingsToUI(data.settings);
    });
}

window.scrollLobbyCarousel = (direction) => {
    const el = document.getElementById('lobbyPlayerList');
    if (el) {
        playSound('sfx-click');
        const scrollAmount = (el.clientWidth > 400 ? 240 : 190) * direction;
        el.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
};

window.scrollDashCarousel = (direction) => {
    const el = document.getElementById('dynamicDashboard');
    if (el) {
        playSound('sfx-click');
        const scrollAmount = 300 * direction;
        el.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
};

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

let autoSaveTimeout;
function autoSaveSettings() {
    if (!isHost || !currentRoom) return;
    updateSettingsVisibility();
    
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(async () => {
        const draftFormat = document.getElementById('settingDraftFormat')?.value || 'independent';
        const draftMode = document.getElementById('settingDraftMode')?.value || 'commander_draft';
        const isSetDraft = draftMode === 'set_draft';

        let draftSet = null;
        let draftSetName = null;

        if (isSetDraft) {
            const inputEl = document.getElementById('settingDraftSetInput');
            const resolved = resolveClientSet(inputEl ? inputEl.value : '');
            draftSet = resolved.code;
            draftSetName = resolved.name;
        }

        const limitCmdr = document.getElementById('toggleCmdrBudget') ? document.getElementById('toggleCmdrBudget').checked : true;
        const limitDeck = document.getElementById('toggleDeckBudget') ? document.getElementById('toggleDeckBudget').checked : true;
        const limitRank = document.getElementById('toggleRank') ? document.getElementById('toggleRank').checked : true;

        const bVal = document.getElementById('settingBudget')?.value;
        const b = !limitCmdr ? 0 : (bVal === '' || isNaN(parseFloat(bVal)) ? 10 : parseFloat(bVal));
        const c = document.getElementById('settingCurrency')?.value || 'eur';
        const dbVal = document.getElementById('settingDeckBudget')?.value;
        const dbudget = !limitDeck ? 0 : (dbVal === '' || isNaN(parseFloat(dbVal)) ? 50 : parseFloat(dbVal));
        const incCmdr = document.getElementById('settingIncludeCmdr')?.checked !== false;

        const minVal = document.getElementById('settingMin')?.value;
        const maxVal = document.getElementById('settingMax')?.value;
        const maxR = !limitRank ? 0 : (minVal === '' || isNaN(parseInt(minVal)) ? 1 : parseInt(minVal));
        const minR = !limitRank ? 0 : (maxVal === '' || isNaN(parseInt(maxVal)) ? 500 : parseInt(maxVal));
        const noPartner = document.getElementById('settingNoPartner')?.checked || false;
        const numOpts = Math.min(5, Math.max(1, parseInt(document.getElementById('settingNumOptions')?.value) || 3));
        const maxRr = Math.max(0, parseInt(document.getElementById('settingMaxRerolls')?.value) || 1);
        const selMode = document.getElementById('settingSelectionMode')?.value || 'both';
        const blind = document.getElementById('settingBlindDraft')?.checked || false;

        const maxBracket = parseInt(document.getElementById('settingMaxBracket')?.value) || 5;
        const snakePoolSize = Math.min(30, Math.max(2, parseInt(document.getElementById('settingSnakePoolSize')?.value) || 15));

        const updates = {
            draftMode: 'commander_draft',
            draftFormat: draftFormat,
            budget: b,
            currency: c,
            deckBudget: dbudget,
            includeCmdr: incCmdr,
            minRank: minR,
            maxRank: maxR,
            noPartner: noPartner,
            numOptions: numOpts,
            snakePoolSize: snakePoolSize,
            maxRerolls: maxRr,
            selectionMode: selMode,
            blindDraft: blind,
            maxBracket: maxBracket
        };

        await update(ref(db, `rooms/${currentRoom}/settings`), updates);
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

    const draftFormat = document.getElementById('settingDraftFormat')?.value || 'independent';
    const limitCmdr = document.getElementById('toggleCmdrBudget') ? document.getElementById('toggleCmdrBudget').checked : true;
    const limitDeck = document.getElementById('toggleDeckBudget') ? document.getElementById('toggleDeckBudget').checked : true;
    const limitRank = document.getElementById('toggleRank') ? document.getElementById('toggleRank').checked : true;

    const bVal = document.getElementById('settingBudget')?.value;
    const b = !limitCmdr ? 0 : (bVal === '' || isNaN(parseFloat(bVal)) ? 10 : parseFloat(bVal));
    const c = document.getElementById('settingCurrency')?.value || 'eur';
    const dbVal = document.getElementById('settingDeckBudget')?.value;
    const dbudget = !limitDeck ? 0 : (dbVal === '' || isNaN(parseFloat(dbVal)) ? 50 : parseFloat(dbVal));
    const incCmdr = document.getElementById('settingIncludeCmdr')?.checked !== false;

    const minVal = document.getElementById('settingMin')?.value;
    const maxVal = document.getElementById('settingMax')?.value;
    const maxR = !limitRank ? 0 : (minVal === '' || isNaN(parseInt(minVal)) ? 1 : parseInt(minVal));
    const minR = !limitRank ? 0 : (maxVal === '' || isNaN(parseInt(maxVal)) ? 500 : parseInt(maxVal));
    const noPartner = document.getElementById('settingNoPartner')?.checked || false; 
    const numOpts = Math.min(5, Math.max(1, parseInt(document.getElementById('settingNumOptions')?.value) || 3));
    const maxRr = Math.max(0, parseInt(document.getElementById('settingMaxRerolls')?.value) || 1);
    const selMode = document.getElementById('settingSelectionMode')?.value || 'both';
    const blind = document.getElementById('settingBlindDraft')?.checked || false;

    const maxBracket = parseInt(document.getElementById('settingMaxBracket')?.value) || 5;
    const snakePoolSize = Math.min(30, Math.max(2, parseInt(document.getElementById('settingSnakePoolSize')?.value) || 15));
    const webhookUrl = document.getElementById('settingDiscordWebhook') ? document.getElementById('settingDiscordWebhook').value.trim() : '';

    const settingsPayload = {
        draftMode: 'commander_draft',
        draftFormat: draftFormat,
        budget: b,
        currency: c,
        deckBudget: dbudget,
        includeCmdr: incCmdr,
        minRank: minR,
        maxRank: maxR,
        noPartner: noPartner,
        numOptions: numOpts,
        snakePoolSize: snakePoolSize,
        maxRerolls: maxRr,
        selectionMode: selMode,
        blindDraft: blind,
        maxBracket: maxBracket,
        status: 'rolling'
    };
    localStorage.setItem('hostDefaultSettings', JSON.stringify(settingsPayload));
    await set(ref(db, `webhooks/${currentRoom}/url`), webhookUrl || null);
    
    try {
        if (draftFormat !== 'independent') {
            const startDraftFn = httpsCallable(functions, 'hostStartInteractiveDraft');
            await startDraftFn({ roomId: currentRoom, settings: settingsPayload });
        } else {
            await update(ref(db, `rooms/${currentRoom}/settings`), settingsPayload);
        }
    } catch (e) {
        console.error("Draft Start Failed:", e);
        showToast("Failed to initialize draft: " + (e.message || e), true);
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
                onDisconnect(ref(db, `rooms/${currentRoom}/players/${currentPlayerId}/online`)).cancel().catch(() => {});
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

            let calSyncHtml = `
                <div class="calendar-sync-row">
                    <a href="${buildGoogleCalendarUrl(meetup, currentRoom)}" target="_blank" rel="noopener noreferrer" class="cal-sync-btn cal-google" onclick="playSound('sfx-click')">📅 Google Calendar</a>
                    <button type="button" class="cal-sync-btn cal-ics" id="downloadIcsBtn">📥 Apple / Outlook (.ics)</button>
                </div>
            `;

            battleInfoEl.innerHTML = `
                <div class="battle-info">
                    <h3 style="color:var(--gold); font-family:Cinzel; margin:0 0 10px 0;">⚔️ BATTLE SCHEDULED ⚔️</h3>
                    <div style="font-size:1.1rem; color:white; margin-bottom:5px;"><strong>${dateStr} @ ${timeStr}</strong></div>
                    <div style="color:#ccc; margin-bottom:5px;">Format: <span style="color:var(--gold);">${sanitizeHTML(meetup.format)}</span></div>
                    <div style="color:#ccc;">Prize: <span style="color:#2ecc71;">${sanitizeHTML(meetup.prize)}</span></div>
                    ${calSyncHtml}
                    ${cantMakeItHtml}
                    <button id="toggleCantMakeItBtn" class="select-btn" style="margin-top: 15px; padding: 8px 15px; font-size: 0.9rem; background-color: ${isCantMakeIt ? '#444' : '#ff4444'}; border-color: ${isCantMakeIt ? '#666' : '#ff4444'};">
                        ${isCantMakeIt ? "I can make it now" : "I can no longer make it"}
                    </button>
                    ${hostControls}
                </div>
            `;
            const icsBtn = document.getElementById('downloadIcsBtn');
            if (icsBtn) {
                icsBtn.onclick = () => {
                    playSound('sfx-click');
                    downloadIcsFile(meetup, currentRoom);
                    showToast("Downloaded .ics calendar invite!", false, 2500, true);
                };
            }
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
            const maxBracket = data.settings.maxBracket !== undefined ? parseFloat(data.settings.maxBracket) : 0;
            allReady = pValues.every(p => {
                let checkPrice = p.lockedDeckPrice !== undefined ? p.lockedDeckPrice : (p.deckPrice || 0);
                let isUnderBudget = maxBudget === 0 || checkPrice <= maxBudget;
                let isUnderBracket = maxBracket === 0 || !p.deckBracket || p.deckBracket <= maxBracket;
                return p.deck && p.isLegal === true && isUnderBudget && isUnderBracket;
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

        // Ensure main content areas are visible now that tabs are removed
        if (battleInfoEl) battleInfoEl.style.display = 'block';
        const dashEl = document.getElementById('dynamicDashboard');
        if (dashEl) dashEl.style.display = 'flex';
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
            let maxBracket = data.settings.maxBracket !== undefined ? parseFloat(data.settings.maxBracket) : 0;
            let checkPrice = p.lockedDeckPrice !== undefined ? p.lockedDeckPrice : (p.deckPrice || 0);
            let isUnderBudget = maxBudget === 0 || checkPrice <= maxBudget;
            let isUnderBracket = maxBracket === 0 || !p.deckBracket || p.deckBracket <= maxBracket;
            let isReady = p.isLegal === true && isUnderBudget && isUnderBracket;
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
                let maxBracket = data.settings.maxBracket !== undefined ? parseFloat(data.settings.maxBracket) : 0;
                let isLegal = pData.isLegal === true;
                let checkPrice = pData.lockedDeckPrice !== undefined ? pData.lockedDeckPrice : (pData.deckPrice || 0);
                let isUnderBudget = maxBudget === 0 || checkPrice <= maxBudget;
                let isUnderBracket = maxBracket === 0 || !pData.deckBracket || pData.deckBracket <= maxBracket;

                if (isLegal && isUnderBudget && isUnderBracket) {
                    statusHtml = `<span class="status-badge status-sealed" style="background:var(--gold); color:black; border-color:white; box-shadow:0 0 10px var(--gold);">Ready for Battle!</span>`;
                } else if (!isUnderBracket && pData.deckBracket) {
                    statusHtml = `<span class="status-badge" style="background:rgba(255, 68, 68, 0.2); color:#ff6666; border:1px solid #ff4444;">Over Power Bracket (${pData.deckBracket} > ${maxBracket})</span>`;
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

            // --- DRAFT TAB CONTENT ---
            let draftInfoHtml = `<div class="card-draft-info">`;

            if (id !== currentPlayerId) {
                let maxB = data.settings.deckBudget !== undefined ? parseFloat(data.settings.deckBudget) : 50;
                let cPrice = pData.lockedDeckPrice !== undefined ? pData.lockedDeckPrice : (pData.deckPrice || 0);
                let pReady = pData.deck && pData.isLegal === true && (maxB === 0 || cPrice <= maxB);
                
                if (!pReady) {
                    const today = new Date().toISOString().split('T')[0];
                    const hasBeenPingedToday = data.pings && data.pings[id] && data.pings[id][today];
                    
                    if (!hasBeenPingedToday) {
                        html += `<button class="auth-sm-btn ping-btn" style="position:absolute; top:12px; right:12px; color:var(--gold); border-color:var(--gold); padding: 2px 6px; font-size: 1rem; background: rgba(0,0,0,0.5); z-index:10;" onclick="window.pingPlayer('${id}')" title="Ping to hurry up!">🔔</button>`;
                    }
                }
            }

            if (id === currentPlayerId && !safeSelected) {
                let btnText = "Begin Rolling";
                if (activeDraft) btnText = "Enter Draft";
                else if (pData.generated) btnText = "Resume Rolling";
                draftInfoHtml += `<br><button class="select-btn" style="margin-top: 10px; margin-bottom: 5px; width: 100%; font-size: 0.9rem;" onclick="window.openPlayerView()">${btnText}</button>`;
            }

            if (safeSelected) {
                const hideInfo = isBlind && !allLocked && id !== currentPlayerId;

                if (hideInfo) {
                    draftInfoHtml += `<p style="margin: 15px 0 5px 0; font-family:'Cinzel'; color:#aaa;"><strong>???</strong></p>`;
                    draftInfoHtml += `<div class="skeleton-wrapper"><img src="card_back.webp" class="commander-img" loading="lazy" style="filter: brightness(0.7);" onload="this.parentElement.classList.add('loaded')"></div>`;
                } else {
                    draftInfoHtml += `<p style="margin: 15px 0 5px 0; font-family:'Cinzel'; color:white;"><strong>${safeSelected}</strong></p>`;
                    if (pData.display_rank) draftInfoHtml += `<p style="margin: 0 0 10px 0; font-size: 0.9rem; color: #d4af37; font-weight:bold;">EDHREC Rank: #${pData.display_rank}</p>`;
                    
                    const edhrecSlug = safeSelected.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    const edhrecLink = `https://edhrec.com/commanders/${edhrecSlug}`;
                    
                    draftInfoHtml += `<a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC"><div class="skeleton-wrapper"><img src="${sanitizeHTML(pData.image)}" class="commander-img" loading="lazy" onload="this.parentElement.classList.add('loaded')"></div></a>`;
                }
            }
            draftInfoHtml += `</div>`;
            html += draftInfoHtml;

            // --- ARMORY TAB CONTENT ---
            let armoryInfoHtml = `<div class="card-armory-info">`;
            
            if (safeSelected && !pData.deck) {
                armoryInfoHtml += `<div style="background: rgba(0,0,0,0.5); border: 1px dashed #444; border-radius: 6px; padding: 15px; margin-top: 15px;">
                    <p style="margin: 0; font-size: 0.9rem; color: #aaa; text-align: center;">Brewing in progress...</p>
                </div>`;
            }

            if (pData.deck) {
                const hideInfo = isBlind && !allLocked && id !== currentPlayerId;
                
                if (pData.deckPrice !== undefined) {
                    let maxBudget = data.settings.deckBudget !== undefined ? parseFloat(data.settings.deckBudget) : 50;
                    let maxBracket = data.settings.maxBracket !== undefined ? parseFloat(data.settings.maxBracket) : 0;
                    let currSym = data.settings.currency === 'eur' ? '€' : '$';
                    let checkPrice = pData.lockedDeckPrice !== undefined ? pData.lockedDeckPrice : (pData.deckPrice || 0);
                    let isOver = maxBudget !== 0 && checkPrice > maxBudget;
                    let priceColor = isOver ? "#ff4444" : "#2ecc71";
                    let check = isOver ? "❌ Over Budget" : "✅ OK";

                    let cmdrLogic = data.settings.includeCmdr !== false ? "Includes Commander cost." : "Excludes Commander cost.";
                    let tooltipLogic = `Excludes Basic Lands and Side/Maybeboards. ${cmdrLogic}`;

                    let isSizeLegal = (pData.deckSize >= 98 && pData.deckSize <= 101) || (pData.isLegal && !pData.deckSize);
                    let isOverBracket = maxBracket > 0 && pData.deckBracket && pData.deckBracket > maxBracket;
                    let isDeckLegal = isSizeLegal && !isOverBracket;
                    let legalIcon = isDeckLegal ? "✅" : "⚠️";
                    let legalText = !isSizeLegal ? `Illegal (${pData.deckSize || '?'} Cards)` : (isOverBracket ? `Illegal (Bracket ${pData.deckBracket} > Max ${maxBracket})` : `Legal (100 Cards)`);
                    
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

                    if (pData.deckBracket !== undefined && pData.deckBracket !== null) {
                        const isOverB = maxBracket > 0 && pData.deckBracket > maxBracket;
                        const bracketColor = isOverB ? "#ff4444" : "var(--gold)";
                        saltHtml += `<p style="margin: 2px 0 0 0; font-size: 0.85rem; color: ${bracketColor}; font-weight: 600;">Power Bracket: ${pData.deckBracket} ${maxBracket > 0 ? `(Limit: ${maxBracket})` : ''}</p>`;
                        if (isOverB) {
                            saltHtml += `<p style="margin: 2px 0 0 0; font-size: 0.82rem; font-weight:bold; color: #ff6666;">❌ Over Power Bracket Limit</p>`;
                        }
                    }

                    let lockedHtml = '';
                    if (pData.lockedDeckPrice !== undefined) {
                        lockedHtml = `<p style="margin: 5px 0 0 0; font-size: 0.95rem; color: #d4af37; font-weight:bold;">🔒 Locked Price: ${currSym}${pData.lockedDeckPrice.toFixed(2)}</p>`;
                    }

                    armoryInfoHtml += `
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
                    armoryInfoHtml += `<p style="margin: 15px 0 5px 0; font-size: 0.9rem; color: #aaa;">Deck Price: Calculating...</p>`;
                }

                if (hideInfo) {
                    armoryInfoHtml += `<p style="margin: 10px 0 0 0; font-size: 0.82rem; color: #888; font-style: italic;">🔒 Deck URL Hidden (Blind Draft)</p>`;
                } else {
                    armoryInfoHtml += `<br><a href="${sanitizeHTML(pData.deck)}" target="_blank" style="font-size: 0.85rem; color:#d4af37;" onclick="playSound('sfx-click')">View Deck</a>`;
                }
            }
            
            if (id === currentPlayerId && safeSelected) {
                armoryInfoHtml += `<div style="margin-top: 15px; display: flex; flex-direction: column; gap: 8px;">`;
                armoryInfoHtml += `<button class="select-btn" style="width: 100%; font-size: 0.9rem;" onclick="window.openPlayerView()">Update Link</button>`;
                if (pData.deck) {
                    armoryInfoHtml += `<button class="select-btn" style="width: 100%; font-size: 0.9rem; background-color: #4a4a5e; border-color: #696982;" onclick="window.refreshMyDeckPrice()">Refresh Price</button>`;
                    armoryInfoHtml += `<button class="select-btn" style="width: 100%; font-size: 0.9rem; background-color: #6a4a4a; border-color: #826969;" onclick="window.lockMyDeckPrice()">Lock In Price</button>`;
                }
                armoryInfoHtml += `</div>`;
            }
            armoryInfoHtml += `</div>`;
            html += armoryInfoHtml;

            if (isHost) {
                html += `<div style="margin-top:15px; border-top:1px solid rgba(212,175,55,0.2); padding-top:15px; display:flex; justify-content:center; gap:8px; flex-wrap:wrap;">`;
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

    // Disable custom mouse drag on touch devices to prevent interference with native vertical scrolling
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;

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
import('./deck-builder-view.js?v=4.6').then(module => module.initDeckBuilderModule(utils, state));
initAuthModule(utils, state);
initProfileModule(utils, state);
initDeckActionsModule(utils, state);
initRoomActionsModule(utils, state);
initPlayerViewModule(utils, state);
initCardInspector();
initWarRoom(db, state, utils);

window.boosterUtils = utils;
initBoosterSimulatorModule(utils, state);
initBoosterDraftModule(utils, state);

// Setup booster simulator interactive listeners
const boosterOpenBtn = document.getElementById('boosterOpenBtn');
if (boosterOpenBtn) {
    boosterOpenBtn.addEventListener('click', () => {
        crackBoosterProduct(utils);
    });
}

const boosterMarketSelect = document.getElementById('boosterMarketSelect');
if (boosterMarketSelect) {
    boosterMarketSelect.addEventListener('change', () => {
        updateMarketAndCostDisplay();
    });
}

const boosterSetInput = document.getElementById('boosterSetInput');
if (boosterSetInput) {
    boosterSetInput.addEventListener('change', () => updateMarketAndCostDisplay());
    boosterSetInput.addEventListener('input', () => updateMarketAndCostDisplay());
}

const modePack = document.getElementById('boosterModePack');
const modeBox = document.getElementById('boosterModeBox');
if (modePack && modeBox) {
    modePack.addEventListener('change', () => updateMarketAndCostDisplay());
    modeBox.addEventListener('change', () => updateMarketAndCostDisplay());
}

const editionPlay = document.getElementById('boosterEditionPlay');
const editionCollector = document.getElementById('boosterEditionCollector');
if (editionPlay && editionCollector) {
    editionPlay.addEventListener('change', () => updateMarketAndCostDisplay());
    editionCollector.addEventListener('change', () => updateMarketAndCostDisplay());
}

const boosterCostInput = document.getElementById('boosterCostInput');
if (boosterCostInput) {
    boosterCostInput.addEventListener('input', () => {
        if (window.onBoosterCostChange) window.onBoosterCostChange();
    });
}

// Quick set chips
document.querySelectorAll('.quick-set-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        document.querySelectorAll('.quick-set-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const setCode = chip.dataset.set;
        const setObj = (window.scryfallSets || []).find(s => s.code.toLowerCase() === setCode);
        if (boosterSetInput) {
            boosterSetInput.value = setObj ? `${setObj.name} (${setObj.code.toUpperCase()})` : setCode.toUpperCase();
        }
        updateMarketAndCostDisplay();
    });
});

// Sort buttons
document.querySelectorAll('.booster-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        setSortMode(btn.dataset.sort);
    });
});

// Filter chips
document.querySelectorAll('.booster-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        setFilterMode(chip.dataset.filter);
    });
});

window.triggerWarRoomModal = async () => {
    playSound('sfx-click');
    if (!currentRoom) return;
    try {
        const snap = await get(ref(db, `rooms/${currentRoom}`));
        const roomData = snap.val();
        if (roomData) {
            openWarRoom(roomData, state, utils);
        } else {
            showToast("Could not load playgroup details.", true);
        }
    } catch(e) {
        showToast("Error opening War Room: " + e.message, true);
    }
};

window.testLobbyDiscordWebhook = async () => {
    playSound('sfx-click');
    const input = document.getElementById('settingDiscordWebhook');
    const url = input ? input.value.trim() : '';
    if (!url) return showToast("Please enter a Discord Webhook URL first.", true);
    
    showToast("Sending test Discord webhook notification...", false, 0);
    try {
        await testDiscordWebhook(url, currentRoom);
        showToast("✅ Discord test message sent successfully!", false, 3000, true);
    } catch (e) {
        showToast("❌ Discord test failed: " + e.message, true);
    }
};

// --- PWA SERVICE WORKER REGISTRATION ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                registration.update();
                console.log('ServiceWorker registered & checked for update.');
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

// Silently pre-fetch the heavy Archives JSON and preload a pool of images for smooth Quick Rolls
setTimeout(async () => { 
    try {
        const archives = await getArchives();
        if (archives && archives.length > 0) {
            window.preloadedRollCards = [];
            for (let i = 0; i < 25; i++) {
                const c = archives[Math.floor(Math.random() * archives.length)];
                const imgUrl = c.image_uris?.normal || (c.card_faces && c.card_faces[0].image_uris?.normal) || c.image1;
                if (imgUrl) {
                    const img = new Image();
                    img.src = imgUrl;
                    window.preloadedRollCards.push(c);
                }
            }
        }
    } catch(e) {}
}, 3000);