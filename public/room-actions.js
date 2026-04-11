import { db, functions } from './firebase-setup.js?v=19.34';
import { ref, get, remove } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-functions.js";

export function initRoomActionsModule(utils, state) {
    const { playSound, showToast, showConfirm, sanitizeHTML, switchView, getRoomCreationTime, clearSession } = utils;

    window.leaveChallenge = () => {
        playSound('sfx-click');
        showConfirm(state.isHost ? "Disband Playgroup?" : "Leave Playgroup?", state.isHost ? "As the Host, leaving will close the playgroup and kick everyone out. Are you sure?" : "Are you sure you want to leave this playgroup?", async () => {
            playSound('sfx-click');
            if (state.isHost) {
                await remove(ref(db, `rooms/${state.currentRoom}`));
                await remove(ref(db, `webhooks/${state.currentRoom}`));
            } else {
                await remove(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`));
            }
            clearSession();
            state.currentRoom = null; state.isHost = false;
            if (state.activeRoomListener) { state.activeRoomListener(); state.activeRoomListener = null; }
            if (state.activePlayerListener) { state.activePlayerListener(); state.activePlayerListener = null; }
            switchView('view-landing'); showToast("You have left the playgroup.");
            window.loadMyPlaygroups();
        });
    };

    window.resetToLobby = () => {
        playSound('sfx-click');
        showConfirm("Return to Lobby?", "This will wipe all current rolls and return everyone to the waiting room. Are you sure?", async () => {
            playSound('sfx-choose');
            try {
                const resetFn = httpsCallable(functions, 'hostResetLobby');
                await resetFn({ roomId: state.currentRoom });
                showToast("Challenge Reset.", false, 3000, true);
            } catch(e) { showToast("Failed to reset lobby: " + e.message, true); }
        });
    };

    window.kickPlayer = (id) => {
        playSound('sfx-click');
        showConfirm("Kick Player?", "Are you sure you want to remove this player from the challenge?", async () => {
            playSound('sfx-click'); 
            try {
                const kickFn = httpsCallable(functions, 'hostKickPlayer');
                await kickFn({ roomId: state.currentRoom, targetId: id });
                showToast("Player removed.", false, 3000, true);
            } catch(e) { showToast("Failed to kick player: " + e.message, true); }
        });
    };

    window.clearPlayer = (id) => {
        playSound('sfx-click');
        showConfirm("Clear Selection?", "Force this player to reroll their commander?", async () => {
            playSound('sfx-choose');
            try {
                const clearFn = httpsCallable(functions, 'hostClearPlayer');
                await clearFn({ roomId: state.currentRoom, targetId: id });
                showToast("Player selection wiped.", false, 3000, true);
            } catch(e) { showToast("Failed to clear player: " + e.message, true); }
        });
    };

    window.copyMatchSummary = async () => {
        playSound('sfx-click');
        const snap = await get(ref(db, `rooms/${state.currentRoom}`));
        const data = snap.val();
        if (!data || !data.players) return showToast("No data to copy.", true);

        let text = `⚔️ Commander Draft Challenge (Room: ${state.currentRoom}) ⚔️\n`;
        const cTime = getRoomCreationTime(data);
        if (cTime) text += `Created: ${new Date(cTime).toLocaleString()}\n`;
        text += `Generated on: ${new Date().toLocaleString()}\n\n`;
        
        const players = data.players;
        const history = data.history || {};
        const winCounts = {};
        Object.values(history).forEach(h => { if (h.winnerId) winCounts[h.winnerId] = (winCounts[h.winnerId] || 0) + 1; });

        const sortedIds = Object.keys(players).sort((a,b) => { if(players[a].isHost) return -1; if(players[b].isHost) return 1; return (players[a].name || "").localeCompare(players[b].name || ""); });
        const isBlind = data.settings?.blindDraft === true;
        const allLocked = Object.values(players).every(p => p.selected);

        sortedIds.forEach(id => {
            const p = players[id];
            const hideInfo = isBlind && !allLocked && id !== state.currentPlayerId;
            let roleIcon = p.isHost ? '👑' : '👤';
            let trophyIcon = winCounts[id] ? ` ${'🏆'.repeat(winCounts[id])}` : '';
            let nameLabel = `${roleIcon}${trophyIcon} ${p.name}`;

            if (p.selected) {
                if (hideInfo) text += `${nameLabel}: ??? (Mysterious Commander)\n   🔗 (Link hidden)\n\n`;
                else {
                    let curr = data.settings?.currency === 'usd' ? '$' : '€';
                    let priceText = p.lockedDeckPrice !== undefined ? `(🔒 ${curr}${p.lockedDeckPrice.toFixed(2)})` : (p.deckPrice ? `(${curr}${p.deckPrice.toFixed(2)})` : '');
                    let saltText = p.deckSalt !== undefined ? ` [☣️ Salt: ${Number(p.deckSalt).toFixed(1)}]` : '';
                    text += `${nameLabel}: ${p.selected} ${priceText}${saltText}\n   🔗 ${p.deck || 'No Link'}\n\n`;
                }
            } else text += `${nameLabel}: Drafting...\n\n`;
        });

        navigator.clipboard.writeText(text).then(() => showToast("Match Summary copied!", false, 3000, true)).catch(() => showToast("Failed to copy.", true));
    };

    window.openDeclareWinner = async () => {
        playSound('sfx-click');
        const modal = document.getElementById('winnerModal'); const listDiv = document.getElementById('winnerList');
        modal.style.display = 'flex'; setTimeout(() => modal.classList.add('show'), 10);
        const snap = await get(ref(db, `rooms/${state.currentRoom}/players`)); const players = snap.val() || {};
        let html = '';
        Object.keys(players).forEach(id => { const p = players[id]; if (p.selected) html += `<button class="select-btn" style="background:#222; color:white; border:1px solid #555;" onclick="window.confirmWinner('${id}')">${sanitizeHTML(p.name)} (${sanitizeHTML(p.selected)})</button>`; });
        if (!html) html = '<p style="color:#aaa;">No players have selected commanders.</p>'; listDiv.innerHTML = html;
    };

    window.confirmWinner = (winnerId) => {
        playSound('sfx-click');
        showConfirm("Declare Winner?", "This will record the win and reset the drafting board so you can draft again. Proceed?", async () => {
            playSound('sfx-choose');
            try {
                const declareFn = httpsCallable(functions, 'hostDeclareWinner');
                const result = await declareFn({ roomId: state.currentRoom, winnerId: winnerId });
                document.getElementById('winnerModal').classList.remove('show');
                setTimeout(() => document.getElementById('winnerModal').style.display='none', 300);
                showToast(`👑 ${result.data.winnerName} takes the crown! Playgroup reset.`, false, 3000, true);
            } catch(e) {
                showToast("Failed to declare winner: " + e.message, true);
            }
        });
    };

    window.openLeaderboard = async () => {
        playSound('sfx-click');
        const modal = document.getElementById('leaderboardModal');
        const contentDiv = document.getElementById('leaderboardContent');
        modal.style.display = 'flex'; setTimeout(() => modal.classList.add('show'), 10);
        
        const snap = await get(ref(db, `rooms/${state.currentRoom}`));
        const roomData = snap.val() || {};
        const history = roomData.history || {};
        const currSym = roomData.settings?.currency === 'usd' ? '$' : '€';
        
        const matchCount = Object.keys(history).length;
        if (matchCount === 0) {
            contentDiv.innerHTML = '<p style="text-align:center; color:#aaa;">No matches recorded yet. Play some games!</p>';
            return;
        }

        const playerStats = {};
        let maxSalt = { score: -1, player: '', commander: '' };
        let maxPrice = { score: -1, player: '', commander: '' };

        Object.values(history).forEach(match => {
            if (match.winnerId) {
                if (!playerStats[match.winnerId]) playerStats[match.winnerId] = { name: match.winnerName, wins: 0, matches: 0 };
                playerStats[match.winnerId].wins += 1;
            }

            if (match.participants) {
                Object.entries(match.participants).forEach(([pid, pdata]) => {
                    if (!playerStats[pid]) playerStats[pid] = { name: pdata.name, wins: 0, matches: 0 };
                    playerStats[pid].matches += 1;

                    if (pdata.salt !== undefined && pdata.salt > maxSalt.score) maxSalt = { score: pdata.salt, player: pdata.name, commander: pdata.commander };
                    if (pdata.price !== undefined && pdata.price > maxPrice.score) maxPrice = { score: pdata.price, player: pdata.name, commander: pdata.commander };
                });
            }
        });

        const sortedPlayers = Object.values(playerStats).sort((a, b) => b.wins - a.wins || b.matches - a.matches);

        let html = `<div style="display:flex; justify-content:space-between; margin-bottom:15px; border-bottom:1px solid #333; padding-bottom:10px;">
            <span>Total Matches: <strong style="color:var(--gold);">${matchCount}</strong></span>
        </div>`;

        html += `<table style="width:100%; border-collapse: collapse; margin-bottom: 20px;">
            <thead><tr style="color:var(--gold); border-bottom:1px solid #444; text-align:left;">
                <th style="padding:5px;">Player</th><th style="padding:5px; text-align:center;">Wins</th>
                <th style="padding:5px; text-align:center;">Matches</th><th style="padding:5px; text-align:center;">Win Rate</th>
            </tr></thead><tbody>`;

        sortedPlayers.forEach(p => {
            const winRate = p.matches > 0 ? Math.round((p.wins / p.matches) * 100) + '%' : 'N/A';
            html += `<tr style="border-bottom:1px solid #222;">
                <td style="padding:8px 5px; color:#fff;">${sanitizeHTML(p.name)}</td><td style="padding:8px 5px; text-align:center; color:#2ecc71; font-weight:bold;">${p.wins}</td>
                <td style="padding:8px 5px; text-align:center; color:#aaa;">${p.matches || '?'}</td><td style="padding:8px 5px; text-align:center; color:#66b3ff;">${winRate}</td>
            </tr>`;
        });
        html += `</tbody></table>`;

        if (maxSalt.score > 0 || maxPrice.score > 0) {
            html += `<h3 style="color:var(--gold); font-size:1rem; margin-bottom:10px;">Playgroup Records</h3>`;
            if (maxSalt.score > 0) html += `<p style="margin:5px 0; font-size:0.9rem;">🧂 <strong>Highest Salt:</strong> ${maxSalt.score.toFixed(2)} <span style="color:#888;">(${sanitizeHTML(maxSalt.commander)} by ${sanitizeHTML(maxSalt.player)})</span></p>`;
            if (maxPrice.score > 0) html += `<p style="margin:5px 0; font-size:0.9rem;">💎 <strong>Most Expensive:</strong> ${currSym}${maxPrice.score.toFixed(2)} <span style="color:#888;">(${sanitizeHTML(maxPrice.commander)} by ${sanitizeHTML(maxPrice.player)})</span></p>`;
        }
        contentDiv.innerHTML = html;
    };

    window.openBurnLog = async () => {
        playSound('sfx-click');
        const modal = document.getElementById('burnLogModal');
        const contentDiv = document.getElementById('burnLogContent');
        modal.style.display = 'flex'; setTimeout(() => modal.classList.add('show'), 10);
        
        const snap = await get(ref(db, `rooms/${state.currentRoom}`));
        const roomData = snap.val() || {};
        const burnLog = roomData.activeDraft?.burnLog || [];
        const players = roomData.players || {};

        if (burnLog.length === 0) {
            contentDiv.innerHTML = '<p style="text-align:center; color:#aaa;">No commanders were burned.</p>';
            return;
        }

        let html = `<ul style="list-style:none; padding:0; margin:0; text-align:left;">`;
        burnLog.forEach(log => {
            const pName = players[log.playerId]?.name || "Unknown Player";
            html += `<li style="padding:8px; border-bottom:1px solid #333; color:#ccc;">🔥 <strong style="color:var(--gold);">${sanitizeHTML(pName)}</strong> burned <strong style="color:#ff9999;">${sanitizeHTML(log.cardName)}</strong></li>`;
        });
        html += `</ul>`;
        contentDiv.innerHTML = html;
    };
}