import { db, auth, functions } from './firebase-setup.js?v=19.31';
import { ref, get, remove, update, increment } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-functions.js";

export function initAdminModule(utils) {
    const { showToast, switchView, getRoomCreationTime, sanitizeHTML } = utils;

    window.enterAdminMode = async () => {
        const user = auth.currentUser;
        if(user) {
            try {
                const checkAdminFn = httpsCallable(functions, 'checkAdminStatus');
                const result = await checkAdminFn();
                const isAdmin = result.data.isAdmin;

                if (isAdmin) {
                    switchView('view-admin');
                    initAdmin();
                } else {
                    showToast("Access Denied: You do not have Admin privileges.", true);
                }
            } catch (e) {
                console.error("Admin check failed:", e);
                showToast("Error checking admin status.", true);
            }
        } else {
            showToast("Access Denied: You must be logged in to access Admin Mode.", true);
        }
    };

    async function initAdmin() {
        const listDiv = document.getElementById('adminRoomList');
        const statsDiv = document.getElementById('adminStats');
        listDiv.innerHTML = '<p style="color:var(--gold); animation: blink 1s infinite;">Fetching global archives...</p>';
        
        try {
            const getAdminDataFn = httpsCallable(functions, 'getAdminData');
            const result = await getAdminDataFn();
            const { rooms, stats, users } = result.data;
            
            if (statsDiv) {
                statsDiv.innerHTML = `
                    <div style="display: flex; justify-content: space-around; text-align: center;">
                        <div><strong>Total Players:</strong><br><span style="color:var(--gold); font-size:1.2rem;">${stats.totalPlayers || 0}</span></div>
                        <div><strong>Active Rooms:</strong><br><span style="color:var(--gold); font-size:1.2rem;">${stats.activeRooms || 0}</span></div>
                        <div><strong>Cmdrs Rolled:</strong><br><span style="color:var(--gold); font-size:1.2rem;">${stats.commandersRolled || 0}</span></div>
                        <div><strong>Linked Users:</strong><br><span style="color:var(--gold); font-size:1.2rem;">${Object.keys(users).length}</span></div>
                    </div>
                `;
            }

            let html = `
                <div style="display:flex; gap:10px; margin-bottom:20px; justify-content:center;">
                    <button id="btnTabRooms" onclick="window.switchAdminTab('rooms')" class="select-btn" style="flex:1; padding:10px; background:var(--gold); color:black; border:1px solid var(--gold); font-weight:bold;">Active Rooms</button>
                    <button id="btnTabUsers" onclick="window.switchAdminTab('users')" class="select-btn" style="flex:1; padding:10px; background:#222; color:white; border:1px solid var(--gold); font-weight:bold;">Linked Users</button>
                </div>
                <div id="contentRooms" style="display:block;">
            `;

            if (Object.keys(rooms).length === 0) {
                html += "<p>No active challenges found.</p>";
            } else {
                html += `<table style="width:100%; border-collapse: collapse; color: #ccc; font-size: 0.9rem;">
                    <thead><tr style="border-bottom: 1px solid #444; text-align:left; color:var(--gold); font-family:Cinzel;">
                        <th style="padding:10px;">Code</th><th style="padding:10px;">Created</th><th style="padding:10px;">Host</th>
                        <th style="padding:10px;">Players</th><th style="padding:10px;">Status</th><th style="padding:10px; text-align:center;">Action</th>
                    </tr></thead><tbody>`;

                const sortedRooms = Object.entries(rooms).sort(([, a], [, b]) => {
                    const timeA = getRoomCreationTime(a) || 0; const timeB = getRoomCreationTime(b) || 0; return timeB - timeA;
                });

                sortedRooms.forEach(([code, data]) => {
                    const cTime = getRoomCreationTime(data);
                    const dateStr = cTime ? new Date(cTime).toLocaleDateString() + ' ' + new Date(cTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "Unknown";
                    const players = data.players || {};
                    const pCount = Object.keys(players).length;
                    const host = Object.values(players).find(p => p.isHost)?.name || "Unknown";
                    const status = data.settings?.status || "waiting";
                    const playersList = Object.values(players).map(p => p.name).join(", ");

                    html += `<tr style="border-bottom: 1px solid #222;">
                        <td style="padding:10px; font-weight:bold; color:#fff;" title="Players: ${sanitizeHTML(playersList)}">${sanitizeHTML(code)}</td><td style="padding:10px; color:#888;">${dateStr}</td>
                        <td style="padding:10px;">${sanitizeHTML(host)}</td><td style="padding:10px;">${pCount}/6</td>
                        <td style="padding:10px; text-transform:capitalize;">${status}</td>
                        <td style="padding:10px; text-align:center;">
                            <button onclick="window.adminViewRoom('${code}')" style="padding:5px 10px; font-size:0.75rem; background:transparent; border:1px solid var(--gold); color:var(--gold); margin-right:5px;">Inspect</button>
                            <button onclick="window.adminDeleteRoom('${code}')" style="padding:5px 10px; font-size:0.75rem; background:transparent; border:1px solid #ff4444; color:#ff9999;">Delete</button>
                        </td>
                    </tr>`;
                });
                html += `</tbody></table>`;
            }
            html += `</div>`;

            html += `<div id="contentUsers" style="display:none;">`;
            if (Object.keys(users).length === 0) {
                html += "<p>No linked users found.</p>";
            } else {
                html += `<table style="width:100%; border-collapse: collapse; color: #ccc; font-size: 0.9rem;">
                    <thead><tr style="border-bottom: 1px solid #444; text-align:left; color:var(--gold); font-family:Cinzel;">
                        <th style="padding:10px;">User ID</th><th style="padding:10px;">Name</th><th style="padding:10px;">Linked Via</th><th style="padding:10px;">Total Wins</th><th style="padding:10px;">Push Alerts</th>
                    </tr></thead><tbody>`;
                
                Object.entries(users).forEach(([uid, uData]) => {
                    const name = uData.profile?.nickname || "Unknown";
                    const provider = uData.profile?.provider || "Unknown";
                    const wins = uData.stats?.wins || 0;
                    const push = uData.fcmTokens ? "Enabled ✅" : "None ❌";
                    html += `<tr style="border-bottom: 1px solid #222;">
                        <td style="padding:10px; font-family:monospace; font-size:0.8rem; color:#888;">${sanitizeHTML(uid)}</td><td style="padding:10px; color:#fff; font-weight:bold;">${sanitizeHTML(name)}</td><td style="padding:10px; color:#aaa;">${sanitizeHTML(provider)}</td><td style="padding:10px;">${wins}</td><td style="padding:10px;">${push}</td>
                    </tr>`;
                });
                html += `</tbody></table>`;
            }
            html += `</div>`;

            listDiv.innerHTML = html;
        } catch (e) { listDiv.innerHTML = `<p style="color:#ff4444;">Error loading rooms: ${e.message}</p>`; }
    }

    window.switchAdminTab = (tab) => {
        const btnRooms = document.getElementById('btnTabRooms');
        const btnUsers = document.getElementById('btnTabUsers');
        const contentRooms = document.getElementById('contentRooms');
        const contentUsers = document.getElementById('contentUsers');
        
        if (!btnRooms || !btnUsers || !contentRooms || !contentUsers) return;

        if (tab === 'rooms') {
            contentRooms.style.display = 'block';
            contentUsers.style.display = 'none';
            btnRooms.style.background = 'var(--gold)'; btnRooms.style.color = 'black';
            btnUsers.style.background = '#222'; btnUsers.style.color = 'white';
        } else {
            contentRooms.style.display = 'none';
            contentUsers.style.display = 'block';
            btnUsers.style.background = 'var(--gold)'; btnUsers.style.color = 'black';
            btnRooms.style.background = '#222'; btnRooms.style.color = 'white';
        }
    };

    window.adminDeleteRoom = async (code) => {
        if(confirm(`⚠️ WARNING ⚠️\n\nAre you sure you want to PERMANENTLY DELETE room "${code}"?\nThis cannot be undone.`)) {
            try {
                const deleteFn = httpsCallable(functions, 'adminDeleteRoom');
                await deleteFn({ roomId: code });
                showToast(`Room ${code} wiped from archives.`, false, 3000, true); initAdmin(); 
            } catch (e) {
                showToast("Delete failed: " + e.message, true);
            }
        }
    };

    window.adminSyncArchives = async () => {
        if(!confirm(`⚠️ WARNING ⚠️\n\nManually trigger the full EDHREC/Scryfall scrape?\nThis may take up to 5 minutes.`)) return;
        const btn = document.getElementById('syncArchivesBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="mana-spinner"></span> Syncing...'; }
        showToast("Manual archive sync started. Please wait...", false, 5000);
        try {
            const syncFn = httpsCallable(functions, 'manualArchiveSync');
            await syncFn();
            showToast("Archives synced successfully!", false, 3000, true);
            initAdmin();
        } catch(e) {
            showToast("Sync failed: " + e.message, true);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = "Sync Archives"; }
        }
    };

    window.adminPruneRooms = async () => {
        if(!confirm(`⚠️ WARNING ⚠️\n\nPrune all abandoned rooms (0 players) and stale rooms older than 30 days?`)) return;
        try {
            const pruneFn = httpsCallable(functions, 'adminPruneRooms');
            const result = await pruneFn();
            const deletedCount = result.data.deletedCount;
            if (deletedCount > 0) {
                showToast(`Pruned ${deletedCount} abandoned/old rooms.`, false, 3000, true);
                initAdmin();
            } else {
                showToast("No abandoned rooms found.", false, 3000, true);
            }
        } catch(e) { showToast("Prune failed: " + e.message, true); }
    };

    window.adminViewRoom = async (code) => {
        try {
            const viewFn = httpsCallable(functions, 'adminViewRoom');
            const result = await viewFn({ roomId: code });
            const data = result.data.room;
            if (!data) return showToast("Room not found.", true);
            
            let details = `Room: ${code}\nStatus: ${data.settings?.status}\nFormat: ${data.settings?.draftFormat}\n\nPlayers:\n`;
            if (data.players) {
                Object.values(data.players).forEach(p => {
                    details += `- ${p.name} ${p.isHost ? '(Host)' : ''}\n`;
                    if (p.selected) details += `  Cmdr: ${p.selected}\n`;
                    let priceStr = p.lockedDeckPrice !== undefined ? p.lockedDeckPrice : p.deckPrice;
                    if (p.deck) details += `  Deck: ${p.deck} (${data.settings?.currency === 'eur'?'€':'$'}${priceStr})\n`;
                });
            }
            alert(details);
        } catch(e) {
            showToast("Failed to fetch details.", true);
        }
    };
}