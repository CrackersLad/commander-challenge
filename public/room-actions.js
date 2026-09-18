import { db, functions } from './firebase-setup.js?v=7.5';
import { ref, get, remove } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-functions.js";
import { fetchDeckFromAPI } from './deck-parser.js?v=7.5';

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
            
            let joined = JSON.parse(localStorage.getItem('joinedRooms') || '[]');
            joined = joined.filter(c => c !== state.currentRoom);
            localStorage.setItem('joinedRooms', JSON.stringify(joined));

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

        let text = `⚔️ **Commander Draft Challenge** (Room: ${state.currentRoom}) ⚔️\n`;
        const cTime = getRoomCreationTime(data);
        if (cTime) text += `*Created: ${new Date(cTime).toLocaleString()}*\n`;
        text += `*Generated on: ${new Date().toLocaleString()}*\n\n`;
        
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
            let nameLabel = `${roleIcon}${trophyIcon} **${p.name}**`;

            if (p.selected) {
                let curr = data.settings?.currency === 'usd' ? '$' : '€';
                let priceText = p.lockedDeckPrice !== undefined ? ` (🔒 ${curr}${p.lockedDeckPrice.toFixed(2)})` : (p.deckPrice ? ` (${curr}${p.deckPrice.toFixed(2)})` : '');
                let saltText = p.deckSalt !== undefined ? ` [☣️ Salt: ${Number(p.deckSalt).toFixed(1)}]` : '';
                let legalText = p.deck ? (p.isLegal ? ' [✅ Legal]' : ' [⚠️ Illegal]') : '';

                if (hideInfo) text += `${nameLabel}: ??? (Mysterious Commander)${priceText}${saltText}${legalText}\n   🔗 (Link hidden in Blind Draft)\n\n`;
                else text += `${nameLabel}: ${p.selected}${priceText}${saltText}${legalText}\n   🔗 ${p.deck || 'No Link'}\n\n`;
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
                
                // Trigger Victory Celebration Overlay
                const confContainer = document.createElement('div');
                confContainer.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; pointer-events:none; z-index:99999; overflow:hidden;';
                document.body.appendChild(confContainer);
                for (let i = 0; i < 40; i++) {
                    const conf = document.createElement('div');
                    conf.innerText = ['🏆','👑','✨','🎉'][Math.floor(Math.random()*4)];
                    conf.style.cssText = `position:absolute; left:${Math.random()*100}vw; top:-10vh; font-size:${Math.random()*20+20}px; opacity:1; transition: transform ${Math.random()*2+2}s linear, top ${Math.random()*2+2}s ease-in, opacity 0.5s ease-out 2.5s;`;
                    confContainer.appendChild(conf);
                    
                    conf.getBoundingClientRect(); // Trigger reflow to ensure transitions apply smoothly
                    setTimeout(() => {
                        conf.style.top = '110vh';
                        conf.style.transform = `rotate(${Math.random()*720-360}deg) translateX(${Math.random()*100-50}px)`;
                        conf.style.opacity = '0';
                    }, 50);
                }
                setTimeout(() => confContainer.remove(), 4000);
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
                if (!playerStats[match.winnerId]) playerStats[match.winnerId] = { id: match.winnerId, name: match.winnerName, wins: 0, matches: 0 };
                playerStats[match.winnerId].wins += 1;
            }

            if (match.participants) {
                Object.entries(match.participants).forEach(([pid, pdata]) => {
                    if (!playerStats[pid]) playerStats[pid] = { id: pid, name: pdata.name, wins: 0, matches: 0 };
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
            const isMe = p.id === state.currentPlayerId;
            const rowBg = isMe ? 'background-color: rgba(255, 215, 0, 0.1);' : '';
            html += `<tr style="border-bottom:1px solid #222; ${rowBg}">
                <td style="padding:8px 5px; color:#fff;">${isMe ? '<strong>' : ''}${sanitizeHTML(p.name)}${isMe ? ' (You)</strong>' : ''}</td><td style="padding:8px 5px; text-align:center; color:#2ecc71; font-weight:bold;">${p.wins}</td>
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

    // ==========================================
    // Headless Forge Match Simulation for Lobbies
    // ==========================================
    window.openLobbySimulationModal = async () => {
        playSound('sfx-click');
        const modal = document.getElementById('lobbySimModal');
        const listDiv = document.getElementById('lobbySimDeckList');
        const countSpan = document.getElementById('lobbySimDeckCount');
        const runBtn = document.getElementById('runLobbySimBtn');
        if (!modal) return;

        window.resetLobbySimUI();
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('show'), 10);

        listDiv.innerHTML = '<div style="color:#aaa; font-size:0.85rem; padding:6px;"><span class="mana-spinner"></span> Scanning lobby decks...</div>';

        try {
            const snap = await get(ref(db, `rooms/${state.currentRoom}`));
            const roomData = snap.val() || {};
            const players = roomData.players || {};

            const readyDecks = [];
            Object.entries(players).forEach(([pid, p]) => {
                const cmdr = (p.selected || '').trim();
                const deck = (p.deck || '').trim();
                const isReady = !!(cmdr || deck);
                readyDecks.push({
                    id: pid,
                    name: p.name || 'Player',
                    commander: cmdr,
                    deckUrl: deck,
                    isReady
                });
            });

            const validCount = readyDecks.filter(d => d.isReady).length;
            countSpan.textContent = `${validCount} / ${readyDecks.length} ready`;
            countSpan.style.color = validCount >= 2 ? '#10b981' : '#f87171';

            if (readyDecks.length === 0) {
                listDiv.innerHTML = '<div style="color:#888; font-size:0.85rem; padding:4px;">No players in lobby yet.</div>';
                runBtn.disabled = true;
                return;
            }

            let html = '';
            readyDecks.forEach(d => {
                const badge = d.isReady ? '<span style="color:#10b981; font-weight:700;">[✅ Ready]</span>' : '<span style="color:#888;">[⏳ Drafting]</span>';
                const desc = d.commander ? sanitizeHTML(d.commander) : (d.deckUrl ? 'Custom Deck URL' : 'Awaiting commander...');
                html += `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.04); padding:6px 10px; border-radius:6px; font-size:0.85rem;">
                        <span style="color:#fff;"><strong>${sanitizeHTML(d.name)}</strong>: <span style="color:var(--gold);">${desc}</span></span>
                        <span>${badge}</span>
                    </div>
                `;
            });
            listDiv.innerHTML = html;

            if (validCount < 2) {
                runBtn.disabled = true;
                runBtn.style.opacity = '0.5';
                runBtn.title = 'At least 2 players must have selected a commander or submitted a deck.';
            } else {
                runBtn.disabled = false;
                runBtn.style.opacity = '1';
                runBtn.title = 'Run simulation';
            }
        } catch (e) {
            console.error('Error opening lobby simulation modal:', e);
            listDiv.innerHTML = '<div style="color:#ef4444; font-size:0.85rem;">Failed to read lobby decks.</div>';
        }
    };

    window.closeLobbySimulationModal = () => {
        const modal = document.getElementById('lobbySimModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => modal.style.display = 'none', 300);
        }
    };

    window.resetLobbySimUI = () => {
        const controls = document.getElementById('lobbySimControls');
        const progSec = document.getElementById('lobbySimProgressSection');
        const sumSec = document.getElementById('lobbySimSummarySection');
        if (controls) controls.style.display = 'block';
        if (progSec) progSec.style.display = 'none';
        if (sumSec) sumSec.style.display = 'none';
    };

    window.runLobbySimulation = async () => {
        playSound('sfx-choose');
        const numGames = parseInt(document.getElementById('simCountSlider')?.value || '5', 10);
        const controls = document.getElementById('lobbySimControls');
        const progSec = document.getElementById('lobbySimProgressSection');
        const sumSec = document.getElementById('lobbySimSummarySection');
        const statusHeader = document.getElementById('lobbySimStatusHeader');
        const progressBar = document.getElementById('lobbySimProgressBar');
        const percentSpan = document.getElementById('lobbySimPercent');
        const gamesList = document.getElementById('lobbySimGamesList');

        controls.style.display = 'none';
        progSec.style.display = 'block';
        sumSec.style.display = 'none';

        statusHeader.textContent = '🔍 Fetching & preparing lobby decks...';
        progressBar.style.width = '5%';
        percentSpan.textContent = '5%';

        // Pre-populate empty pending game cards
        let pendingHtml = '';
        for (let i = 1; i <= numGames; i++) {
            pendingHtml += `
                <div id="sim-card-${i}" class="sim-game-card running">
                    <div style="font-weight:600; color:#eee;">Match #${i}</div>
                    <div id="sim-card-status-${i}" style="color:var(--gold); font-size:0.82rem;"><span class="mana-spinner"></span> Simulating turns...</div>
                </div>
            `;
        }
        gamesList.innerHTML = pendingHtml;

        try {
            const snap = await get(ref(db, `rooms/${state.currentRoom}`));
            const roomData = snap.val() || {};
            const players = roomData.players || {};

            const payloadDecks = [];

            for (const [pid, p] of Object.entries(players)) {
                const cmdr = (p.selected || '').trim();
                const deckUrl = (p.deck || '').trim();
                if (!cmdr && !deckUrl) continue;

                const displayName = `${p.name || 'Player'}'s ${cmdr || 'Deck'}`;
                let deckContent = '';

                if (deckUrl.toLowerCase().includes('moxfield.com')) {
                    try {
                        const moxData = await fetchDeckFromAPI(deckUrl);
                        if (moxData && (moxData.mainboard || moxData.commanders)) {
                            const cmdrs = moxData.commanders ? Object.values(moxData.commanders) : [];
                            const mains = moxData.mainboard ? Object.values(moxData.mainboard) : [];
                            const companions = moxData.companions ? Object.values(moxData.companions) : [];
                            const cmdrLines = cmdrs.map(c => `${c.quantity || 1} ${c.card?.name || ''} *CMDR*`);
                            const mainLines = [...mains, ...companions].map(c => `${c.quantity || 1} ${c.card?.name || ''}`);
                            deckContent = [...cmdrLines, ...mainLines].join('\n');
                        }
                    } catch (err) {
                        console.warn('Moxfield deck fetch warning, using fallback:', err);
                    }
                } else if (deckUrl.length > 20 && deckUrl.includes('\n')) {
                    deckContent = deckUrl;
                }

                if (!deckContent) {
                    if (cmdr) {
                        // Playable baseline if full list isn't parsed
                        deckContent = `1 ${cmdr} *CMDR*\n1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n96 Forest`;
                    } else if (deckUrl) {
                        deckContent = deckUrl;
                    }
                }

                payloadDecks.push({
                    name: displayName,
                    commander: cmdr,
                    deckContent
                });
            }

            if (payloadDecks.length < 2) {
                showToast('At least 2 players must have selected a commander or submitted a deck.', true);
                window.resetLobbySimUI();
                return;
            }

            statusHeader.textContent = `⚡ Starting simulation of ${numGames} games with Forge Rules Engine...`;
            progressBar.style.width = '10%';
            percentSpan.textContent = '10%';

            // Stream simulation execution via SSE from cloud backend
            const simUrl = 'http://132.145.31.195:8080/api/simulate/stream';
            const resp = await fetch(simUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    format: 'Commander',
                    games: numGames,
                    decks: payloadDecks
                })
            });

            if (!resp.ok) {
                throw new Error(`Server returned ${resp.status}`);
            }

            const reader = resp.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop();

                for (const part of parts) {
                    const trimmed = part.trim();
                    if (trimmed.startsWith('data:')) {
                        try {
                            const eventData = JSON.parse(trimmed.replace(/^data:\s*/, ''));
                            
                            if (eventData.type === 'init') {
                                statusHeader.textContent = `⚔️ Simulating match 1 of ${eventData.games}...`;
                            } else if (eventData.type === 'game_result') {
                                const cardEl = document.getElementById(`sim-card-${eventData.game}`);
                                if (cardEl) {
                                    cardEl.className = 'sim-game-card finished';
                                    cardEl.innerHTML = `
                                        <div style="display:flex; align-items:center; gap:8px;">
                                            <span style="color:#10b981; font-weight:700;">✅ Match #${eventData.game}</span>
                                            <strong style="color:#fff;">${sanitizeHTML(eventData.winner)}</strong>
                                        </div>
                                        <div style="color:#34d399; font-weight:700; font-size:0.85rem;">
                                            Won on Turn ${eventData.turns} (${(eventData.durationMs / 1000).toFixed(1)}s)
                                        </div>
                                    `;
                                }

                                const pct = Math.round((eventData.game / eventData.total) * 100);
                                progressBar.style.width = `${pct}%`;
                                percentSpan.textContent = `${pct}%`;
                                statusHeader.textContent = `Completed match ${eventData.game} of ${eventData.total}...`;
                            } else if (eventData.type === 'finished') {
                                // Final Summary Screen
                                playSound('sfx-choose');
                                progSec.style.display = 'none';
                                sumSec.style.display = 'block';

                                const summary = eventData.summary;
                                document.getElementById('simSummaryWinnerTitle').textContent = `🏆 ${summary.bestDeck}`;
                                document.getElementById('simSummaryWinnerSubtitle').textContent = `Highest Win Probability: ${summary.bestWinRate}% across ${summary.totalGames} simulated matches`;

                                const tbody = document.getElementById('simSummaryTableBody');
                                let tableRows = '';
                                (summary.results || []).forEach(r => {
                                    const isBest = r.name === summary.bestDeck;
                                    const rowStyle = isBest ? 'background:rgba(212,175,55,0.15); font-weight:700;' : '';
                                    tableRows += `
                                        <tr style="border-bottom:1px solid rgba(255,255,255,0.06); ${rowStyle}">
                                            <td style="padding:8px; color:#fff;">${isBest ? '👑 ' : ''}${sanitizeHTML(r.name)}</td>
                                            <td style="padding:8px; text-align:center; color:#10b981; font-weight:700;">${r.wins}</td>
                                            <td style="padding:8px; text-align:right; color:var(--gold); font-weight:800;">${r.winRate}%</td>
                                        </tr>
                                    `;
                                });
                                tbody.innerHTML = tableRows;

                                showToast(`🏆 Simulation complete! ${summary.bestDeck} has the highest projected win chance (${summary.bestWinRate}%).`, false, 4000, true);
                            }
                        } catch (parseErr) {
                            console.error('SSE JSON parse error:', parseErr);
                        }
                    }
                }
            }

        } catch (simErr) {
            console.error('Simulation error:', simErr);
            showToast('Simulation failed: ' + simErr.message, true, 4000);
            window.resetLobbySimUI();
        }
    };
}