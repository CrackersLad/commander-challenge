import { db, functions } from './firebase-setup.js?v=8.6';
import { ref, get, remove } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-functions.js";
import { fetchDeckFromAPI } from './deck-parser.js?v=8.6';

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
    function isDeckReadyForBattle(p, settings = {}) {
        if (!p || !p.deck) return false;
        const maxBudget = settings.deckBudget !== undefined ? parseFloat(settings.deckBudget) : 50;
        const maxBracket = settings.maxBracket !== undefined ? parseFloat(settings.maxBracket) : 0;
        const isLegal = p.isLegal === true;
        const checkPrice = p.lockedDeckPrice !== undefined ? p.lockedDeckPrice : (p.deckPrice || 0);
        const isUnderBudget = maxBudget === 0 || checkPrice <= maxBudget;
        const isUnderBracket = maxBracket === 0 || !p.deckBracket || p.deckBracket <= maxBracket;
        return isLegal && isUnderBudget && isUnderBracket;
    }

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
            const settings = roomData.settings || {};

            const playerEntries = [];
            Object.entries(players).forEach(([pid, p]) => {
                const cmdr = (p.selected || '').trim();
                const deck = (p.deck || '').trim();
                const isReady = isDeckReadyForBattle(p, settings);
                playerEntries.push({
                    id: pid,
                    name: p.name || 'Player',
                    commander: cmdr,
                    deckUrl: deck,
                    isReady,
                    playerData: p
                });
            });

            const validCount = playerEntries.filter(d => d.isReady).length;
            countSpan.textContent = `${validCount} / ${playerEntries.length} Ready for Battle`;
            countSpan.style.color = validCount >= 2 ? '#10b981' : '#f87171';

            if (playerEntries.length === 0) {
                listDiv.innerHTML = '<div style="color:#888; font-size:0.85rem; padding:4px;">No players in lobby yet.</div>';
                runBtn.disabled = true;
                return;
            }

            let html = '';
            playerEntries.forEach(d => {
                let badge = '';
                let statusReason = '';
                if (d.isReady) {
                    badge = '<span style="color:#10b981; font-weight:700; background:rgba(16,185,129,0.15); padding:2px 8px; border-radius:4px; border:1px solid #10b981;">⚔️ Ready for Battle</span>';
                } else if (!d.deckUrl) {
                    statusReason = 'Brewing in progress';
                    badge = '<span style="color:#f59e0b; font-size:0.8rem; background:rgba(245,158,11,0.12); padding:2px 7px; border-radius:4px;">⏳ Brewing (No Deck)</span>';
                } else if (d.playerData.isLegal !== true) {
                    statusReason = 'Deck not legal';
                    badge = '<span style="color:#ef4444; font-size:0.8rem; background:rgba(239,68,68,0.12); padding:2px 7px; border-radius:4px;">⚠️ Deck Not Legal</span>';
                } else {
                    statusReason = 'Over budget or bracket';
                    badge = '<span style="color:#ef4444; font-size:0.8rem; background:rgba(239,68,68,0.12); padding:2px 7px; border-radius:4px;">💰 Over Budget</span>';
                }

                const desc = d.commander ? sanitizeHTML(d.commander) : (d.deckUrl ? 'Custom Deck URL' : 'Awaiting commander...');
                const note = (!d.isReady && statusReason) ? ` <span style="font-size:0.75rem; color:#888;">— ${statusReason}</span>` : '';

                html += `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:${d.isReady ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.02)'}; padding:7px 10px; border-radius:6px; font-size:0.85rem; border:1px solid ${d.isReady ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.05)'};">
                        <span style="color:#fff;"><strong>${sanitizeHTML(d.name)}</strong>: <span style="color:var(--gold);">${desc}</span>${note}</span>
                        <span>${badge}</span>
                    </div>
                `;
            });
            html += `<div style="font-size:0.75rem; color:#888; text-align:center; margin-top:6px;">Only decks marked <strong style="color:var(--gold);">Ready for Battle</strong> will participate in the simulated matches.</div>`;
            listDiv.innerHTML = html;

            if (validCount < 2) {
                runBtn.disabled = true;
                runBtn.style.opacity = '0.5';
                runBtn.title = 'At least 2 players must have decks marked Ready for Battle (legal & under budget) to simulate.';
            } else {
                runBtn.disabled = false;
                runBtn.style.opacity = '1';
                runBtn.title = `Simulate between the ${validCount} Ready for Battle decks`;
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

    function cleanSimPlayerName(raw, decks = []) {
        if (!raw) return '';
        let name = String(raw).replace(/^Ai\(\d+\)-/, '').replace(/'s$/i, '').trim();
        const possMatch = name.match(/^(.+?)'s\s+(.+)$/i);
        if (possMatch) {
            const potentialPlayer = possMatch[1].trim();
            const matchedDeck = decks.find(d => d.name.toLowerCase() === potentialPlayer.toLowerCase() || (d.commander && possMatch[2].toLowerCase().includes(d.commander.toLowerCase())));
            if (matchedDeck) return matchedDeck.name;
            return potentialPlayer;
        }
        const matched = decks.find(d => d.name.toLowerCase() === name.toLowerCase() || name.toLowerCase().startsWith(d.name.toLowerCase()));
        if (matched) return matched.name;
        return name;
    }

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

        statusHeader.textContent = '🔍 Fetching & preparing Ready for Battle decks...';
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
            const settings = roomData.settings || {};

            const payloadDecks = [];

            for (const [pid, p] of Object.entries(players)) {
                // STRICT CHECK: Only include decks that are Ready for Battle
                if (!isDeckReadyForBattle(p, settings)) {
                    continue;
                }

                const cmdr = (p.selected || '').trim();
                const deckUrl = (p.deck || '').trim();
                if (!cmdr && !deckUrl) continue;

                const playerName = (p.name || 'Player').trim();
                let displayName = playerName;
                let counter = 2;
                while (payloadDecks.some(d => d.name.toLowerCase() === displayName.toLowerCase())) {
                    displayName = `${playerName} (${counter++})`;
                }
                let deckContent = '';

                if (deckUrl.toLowerCase().includes('moxfield.com')) {
                    try {
                        const moxData = await fetchDeckFromAPI(deckUrl);
                        if (moxData && (moxData.mainboard || moxData.commanders)) {
                            const cmdrs = moxData.commanders ? Object.values(moxData.commanders) : [];
                            const mains = moxData.mainboard ? Object.values(moxData.mainboard) : [];
                            const companions = moxData.companions ? Object.values(moxData.companions) : [];
                            const cmdrLines = cmdrs.map(c => {
                                let cName = c.card?.name || '';
                                if (cName.includes(' // ')) cName = cName.split(' // ')[0].trim();
                                return `${c.quantity || 1} ${cName} *CMDR*`;
                            });
                            const mainLines = [...mains, ...companions].map(c => {
                                let cName = c.card?.name || '';
                                if (cName.includes(' // ')) cName = cName.split(' // ')[0].trim();
                                return `${c.quantity || 1} ${cName}`;
                            });
                            deckContent = [...cmdrLines, ...mainLines].join('\n');
                        }
                    } catch (err) {
                        console.warn('Moxfield deck fetch warning, using fallback:', err);
                    }
                } else if (deckUrl.toLowerCase().includes('archidekt.com')) {
                    try {
                        const archData = await fetchDeckFromAPI(deckUrl);
                        if (archData && Array.isArray(archData.cards)) {
                            const cmdrLines = [];
                            const mainLines = [];
                            archData.cards.forEach(item => {
                                let cardName = item.card?.oracleCard?.name || item.card?.name;
                                if (!cardName) return;
                                if (cardName.includes(' // ')) cardName = cardName.split(' // ')[0].trim();
                                const qty = item.quantity || 1;
                                const isCmdr = item.categories?.some(cat => ['commander', 'commanders'].includes(cat.toLowerCase()));
                                if (isCmdr) {
                                    cmdrLines.push(`${qty} ${cardName} *CMDR*`);
                                } else {
                                    mainLines.push(`${qty} ${cardName}`);
                                }
                            });
                            deckContent = [...cmdrLines, ...mainLines].join('\n');
                        }
                    } catch (err) {
                        console.warn('Archidekt deck fetch warning, using fallback:', err);
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
                showToast('At least 2 players must have decks Ready for Battle to simulate.', true);
                window.resetLobbySimUI();
                return;
            }

            statusHeader.textContent = `⚡ Starting simulation of ${numGames} games with ${payloadDecks.length} Ready for Battle decks...`;
            progressBar.style.width = '10%';
            percentSpan.textContent = '10%';

            // Stream simulation execution via SSE:
            // Route directly to the HTTPS Cloud Function in production to avoid the Firebase Hosting 60-second rewrite gateway timeout
            const primaryUrl = window.location.protocol === 'https:'
                ? 'https://us-central1-commander-challenge.cloudfunctions.net/simulateStream'
                : 'https://arena.edhchallenge.com/api/simulate/stream';
            const fallbackUrl = window.location.protocol === 'https:' ? '/api/simulate/stream' : null;

            const postBody = JSON.stringify({
                format: 'Commander',
                games: numGames,
                decks: payloadDecks
            });

            let resp;
            try {
                resp = await fetch(primaryUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: postBody
                });
                if (!resp.ok && fallbackUrl && resp.status >= 500) {
                    console.warn(`Primary simulation endpoint returned ${resp.status}, trying fallback ${fallbackUrl}...`);
                    resp = await fetch(fallbackUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: postBody
                    });
                }
            } catch (networkErr) {
                if (fallbackUrl) {
                    console.warn('Primary simulation fetch threw network error, trying fallback:', networkErr);
                    resp = await fetch(fallbackUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: postBody
                    });
                } else {
                    throw networkErr;
                }
            }

            if (!resp || !resp.ok) {
                let errDetail = `HTTP ${resp ? resp.status : 'offline'}`;
                try {
                    const txt = await resp.text();
                    if (txt && txt.length < 150 && !txt.includes('<!DOCTYPE')) errDetail += ` (${txt})`;
                } catch (_) {}
                throw new Error(errDetail);
            }

            const reader = resp.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            window._currentSimSession = {
                decks: payloadDecks,
                games: [],
                summary: null,
                startTime: Date.now()
            };

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
                            } else if (eventData.type === 'turn_update') {
                                const cardStatusEl = document.getElementById(`sim-card-status-${eventData.game}`);
                                if (cardStatusEl) {
                                    cardStatusEl.innerHTML = `<span class="mana-spinner"></span> Simulating Turn ${eventData.turn}...`;
                                }
                                statusHeader.textContent = `⚔️ Simulating match ${eventData.game} of ${eventData.total} (Turn ${eventData.turn})...`;
                            } else if (eventData.type === 'game_result') {
                                const cleanWinner = cleanSimPlayerName(eventData.winner, payloadDecks);
                                const winnerCmdr = (payloadDecks.find(d => d.name === cleanWinner || (eventData.winner && eventData.winner.includes(d.name)))?.commander) || '';

                                let rawLog = eventData.log || '';
                                payloadDecks.forEach(d => {
                                    if (d.commander) {
                                        const fullPossessive = new RegExp(`${d.name}'s\\s+${d.commander.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
                                        rawLog = rawLog.replace(fullPossessive, d.name);
                                    }
                                });

                                const cleanedTurnEvents = (eventData.turnEvents || []).map(t => {
                                    const tPlayer = cleanSimPlayerName(t.player, payloadDecks);
                                    const events = (t.events || []).map(ev => {
                                        const p = cleanSimPlayerName(ev.player, payloadDecks);
                                        const tgt = ev.target ? cleanSimPlayerName(ev.target, payloadDecks) : ev.target;
                                        let text = ev.text || '';
                                        payloadDecks.forEach(d => {
                                            if (d.commander) {
                                                const fullPossessive = new RegExp(`${d.name}'s\\s+${d.commander.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
                                                text = text.replace(fullPossessive, d.name);
                                            }
                                        });
                                        return {
                                            ...ev,
                                            player: p,
                                            target: tgt,
                                            text
                                        };
                                    });
                                    return {
                                        ...t,
                                        player: tPlayer,
                                        events
                                    };
                                });

                                const matchRecord = {
                                    game: eventData.game,
                                    winner: cleanWinner,
                                    winnerCommander: winnerCmdr,
                                    turns: eventData.turns,
                                    durationMs: eventData.durationMs,
                                    log: rawLog,
                                    turnEvents: cleanedTurnEvents,
                                    aiSummary: null
                                };
                                window._currentSimSession.games.push(matchRecord);

                                const cardEl = document.getElementById(`sim-card-${eventData.game}`);
                                if (cardEl) {
                                    cardEl.className = 'sim-game-card finished';
                                    cardEl.innerHTML = `
                                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                                            <div>
                                                <div style="display:flex; align-items:center; gap:8px;">
                                                    <span style="color:#10b981; font-weight:700;">✅ Match #${eventData.game}</span>
                                                    <strong style="color:#fff;">${sanitizeHTML(cleanWinner)}</strong>
                                                </div>
                                                <div style="color:#34d399; font-weight:700; font-size:0.82rem; margin-top:2px;">
                                                    Won on Turn ${eventData.turns} (${(eventData.durationMs / 1000).toFixed(1)}s)${winnerCmdr ? ` • <span style="color:#aaa;">Cmdr: ${sanitizeHTML(winnerCmdr)}</span>` : ''}
                                                </div>
                                            </div>
                                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                                <button type="button" class="secondary-btn" onclick="window.viewTurnLog(${eventData.game})" style="font-size:0.75rem; padding:3px 8px; display:inline-flex; align-items:center; gap:4px; border-color:rgba(52,211,153,0.4); color:#34d399;" title="View cards played, targets, and combat">
                                                    <span>📜</span> View Log
                                                </button>
                                                <button type="button" class="secondary-btn" onclick="window.downloadMatchLog(${eventData.game})" style="font-size:0.75rem; padding:3px 8px; display:inline-flex; align-items:center; gap:4px;">
                                                    <span>📥</span> Log (.txt)
                                                </button>
                                                <button type="button" id="sim-ai-btn-${eventData.game}" class="secondary-btn" onclick="window.requestAiMatchSummary(${eventData.game})" style="font-size:0.75rem; padding:3px 8px; display:inline-flex; align-items:center; gap:4px; border-color:rgba(168,85,247,0.4); color:#c084fc;">
                                                    <span>📊</span> Match Breakdown
                                                </button>
                                            </div>
                                        </div>
                                        <div id="sim-log-box-${eventData.game}" style="display:none; width:100%;"></div>
                                        <div id="sim-ai-box-${eventData.game}" style="display:none; width:100%;"></div>
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

                                const summary = eventData.summary || {};
                                if (summary.bestDeck) {
                                    summary.bestDeck = cleanSimPlayerName(summary.bestDeck, payloadDecks);
                                }
                                if (Array.isArray(summary.results)) {
                                    summary.results.forEach(r => {
                                        r.name = cleanSimPlayerName(r.name, payloadDecks);
                                    });
                                }
                                window._currentSimSession.summary = summary;
                                const games = window._currentSimSession.games;

                                document.getElementById('simSummaryWinnerTitle').textContent = `🏆 ${summary.bestDeck}`;
                                document.getElementById('simSummaryWinnerSubtitle').textContent = `Highest Win Probability: ${summary.bestWinRate}% across ${summary.totalGames} simulated matches`;

                                // Calculate and populate key aggregate stats metrics
                                if (games && games.length > 0) {
                                    const totalTurns = games.reduce((acc, g) => acc + (g.turns || 0), 0);
                                    const avgTurn = (totalTurns / games.length).toFixed(1);
                                    const fastest = [...games].sort((a, b) => a.turns - b.turns)[0];
                                    const longest = [...games].sort((a, b) => b.turns - a.turns)[0];
                                    const totalDuration = games.reduce((acc, g) => acc + (g.durationMs || 0), 0);
                                    const avgDur = (totalDuration / games.length / 1000).toFixed(1);

                                    const statAvgTurnEl = document.getElementById('simStatAvgTurn');
                                    if (statAvgTurnEl) statAvgTurnEl.textContent = `Turn ${avgTurn}`;

                                    const statFastestEl = document.getElementById('simStatFastestWin');
                                    if (statFastestEl && fastest) statFastestEl.textContent = `Turn ${fastest.turns}`;

                                    const statLongestEl = document.getElementById('simStatLongestGame');
                                    if (statLongestEl && longest) statLongestEl.textContent = `Turn ${longest.turns}`;

                                    const statAvgDurEl = document.getElementById('simStatAvgDuration');
                                    if (statAvgDurEl) statAvgDurEl.textContent = `${avgDur}s`;
                                }

                                const tbody = document.getElementById('simSummaryTableBody');
                                let tableRows = '';
                                (summary.results || []).forEach(r => {
                                    const isBest = r.name === summary.bestDeck;
                                    const rowStyle = isBest ? 'background:rgba(212,175,55,0.15); font-weight:700;' : '';
                                    const cmdr = payloadDecks.find(d => d.name === r.name)?.commander || '';
                                    tableRows += `
                                        <tr style="border-bottom:1px solid rgba(255,255,255,0.06); ${rowStyle}">
                                            <td style="padding:8px; color:#fff;">
                                                ${isBest ? '👑 ' : ''}${sanitizeHTML(r.name)}
                                                ${cmdr ? `<div style="font-size:0.75rem; color:#aaa; font-weight:normal;">Cmdr: ${sanitizeHTML(cmdr)}</div>` : ''}
                                            </td>
                                            <td style="padding:8px; text-align:center; color:#10b981; font-weight:700;">${r.wins}</td>
                                            <td style="padding:8px; text-align:right;">
                                                <div style="color:var(--gold); font-weight:800; font-size:0.95rem;">${r.winRate}%</div>
                                                <div style="background:rgba(255,255,255,0.1); border-radius:4px; height:4px; width:70px; margin-left:auto; margin-top:3px; overflow:hidden;">
                                                    <div style="background:${isBest ? 'var(--gold)' : '#10b981'}; width:${r.winRate}%; height:100%;"></div>
                                                </div>
                                            </td>
                                        </tr>
                                    `;
                                });
                                tbody.innerHTML = tableRows;

                                // Populate Match-by-Match Logs & AI Breakdowns list in summary
                                const matchLogsContainer = document.getElementById('simMatchLogsList');
                                if (matchLogsContainer && games && games.length > 0) {
                                    let logsHtml = '';
                                    games.forEach(g => {
                                        logsHtml += `
                                            <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px 12px;">
                                                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                                                    <div>
                                                        <div style="font-weight:700; color:#fff; font-size:0.88rem; display:flex; align-items:center; gap:6px;">
                                                            <span style="color:#10b981;">Match #${g.game}:</span>
                                                            <span>${sanitizeHTML(g.winner)}</span>
                                                        </div>
                                                        <div style="color:#999; font-size:0.78rem; margin-top:2px;">
                                                            Victory on Turn ${g.turns} (${(g.durationMs / 1000).toFixed(1)}s)${g.winnerCommander ? ` • Commander: <strong style="color:#ccc;">${sanitizeHTML(g.winnerCommander)}</strong>` : ''}
                                                        </div>
                                                    </div>
                                                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                                        <button type="button" class="secondary-btn" onclick="window.viewTurnLog(${g.game})" style="font-size:0.75rem; padding:4px 9px; display:inline-flex; align-items:center; gap:4px; border-color:rgba(52,211,153,0.4); color:#34d399;" title="View cards played, targets, and combat">
                                                            <span>📜</span> View Log
                                                        </button>
                                                        <button type="button" class="secondary-btn" onclick="window.downloadMatchLog(${g.game})" style="font-size:0.75rem; padding:4px 9px; display:inline-flex; align-items:center; gap:4px;">
                                                            <span>📥</span> Log (.txt)
                                                        </button>
                                                        <button type="button" id="sim-summary-ai-btn-${g.game}" class="secondary-btn" onclick="window.requestAiMatchSummary(${g.game})" style="font-size:0.75rem; padding:4px 9px; display:inline-flex; align-items:center; gap:4px; border-color:rgba(168,85,247,0.4); color:#c084fc;">
                                                            <span>📊</span> Match Breakdown
                                                        </button>
                                                    </div>
                                                </div>
                                                <div id="sim-summary-log-box-${g.game}" style="display:none; width:100%;"></div>
                                                <div id="sim-summary-ai-box-${g.game}" style="display:none; width:100%;"></div>
                                            </div>
                                        `;
                                    });
                                    matchLogsContainer.innerHTML = logsHtml;
                                }

                                showToast(`🏆 Simulation complete! ${summary.bestDeck} has the highest projected win chance (${summary.bestWinRate}%).`, false, 4000, true);
                            } else if (eventData.type === 'error') {
                                showToast(`Simulation issue: ${eventData.message}`, true, 5000);
                                window.resetLobbySimUI();
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

    function downloadTextFile(filename, text) {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 150);
    }

    window.viewTurnLog = (gameNum) => {
        const match = (window._currentSimSession?.games || []).find(g => g.game === gameNum);
        if (!match) {
            showToast('Match record not found.', true);
            return;
        }

        // Locate container in summary list or active match card
        const box = document.getElementById(`sim-summary-log-box-${gameNum}`) || document.getElementById(`sim-log-box-${gameNum}`);
        if (!box) return;

        if (box.style.display !== 'none' && box.dataset.activeGame == String(gameNum)) {
            box.style.display = 'none';
            return;
        }

        box.style.display = 'block';
        box.dataset.activeGame = String(gameNum);

        const turnEvents = match.turnEvents || [];
        const fullLog = match.log || '';

        let totalPlays = 0;
        let spellCount = 0;
        let combatCount = 0;
        turnEvents.forEach(t => {
            (t.events || []).forEach(e => {
                totalPlays++;
                if (['cast', 'activated', 'triggered'].includes(e.type)) spellCount++;
                if (['attack', 'block', 'damage', 'life'].includes(e.type)) combatCount++;
            });
        });

        const boxId = `log-view-${gameNum}-${Math.random().toString(36).substring(2, 6)}`;

        box.innerHTML = `
            <div style="background: rgba(15, 23, 42, 0.96); border: 1px solid rgba(52, 211, 153, 0.4); border-radius: 10px; padding: 14px; text-align: left; margin-top: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);">
                <!-- Header -->
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                    <div>
                        <div style="font-weight: 800; color: #34d399; font-size: 0.95rem; display: flex; align-items: center; gap: 6px;">
                            <span>📜</span> Match #${match.game} Action & Targeting Log
                        </div>
                        <div style="font-size: 0.78rem; color: #aaa; margin-top: 2px;">
                            Winner: <strong style="color:#fff;">${sanitizeHTML(match.winner)}</strong> • Decided on Turn ${match.turns} (${(match.durationMs / 1000).toFixed(1)}s)
                        </div>
                    </div>
                    <div style="display: flex; gap: 6px; align-items: center;">
                        <button type="button" class="secondary-btn" id="${boxId}-copy-btn" style="font-size: 0.72rem; padding: 3px 8px; display: inline-flex; align-items: center; gap: 4px;">
                            <span>📋</span> Copy
                        </button>
                        <button type="button" class="secondary-btn" onclick="window.downloadMatchLog(${match.game})" style="font-size: 0.72rem; padding: 3px 8px; display: inline-flex; align-items: center; gap: 4px;">
                            <span>📥</span> .txt
                        </button>
                        <button type="button" class="btn-cancel" id="${boxId}-close-btn" style="font-size: 0.75rem; padding: 3px 8px;">
                            ✕
                        </button>
                    </div>
                </div>

                <!-- Filter Controls & Search -->
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
                    <div style="display: flex; gap: 5px; flex-wrap: wrap;" id="${boxId}-filters">
                        <button type="button" class="action-chip sim-filter-btn" data-filter="all" style="font-size: 0.72rem; padding: 3px 9px; background: rgba(52,211,153,0.2); border-color: #34d399; color: #34d399; border-radius: 12px; cursor: pointer;">
                            All Plays (${totalPlays})
                        </button>
                        <button type="button" class="action-chip sim-filter-btn" data-filter="spells" style="font-size: 0.72rem; padding: 3px 9px; background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.15); color: #ddd; border-radius: 12px; cursor: pointer;">
                            🎴 Spells & Targets (${spellCount})
                        </button>
                        <button type="button" class="action-chip sim-filter-btn" data-filter="combat" style="font-size: 0.72rem; padding: 3px 9px; background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.15); color: #ddd; border-radius: 12px; cursor: pointer;">
                            ⚔️ Combat & Life (${combatCount})
                        </button>
                        <button type="button" class="action-chip sim-filter-btn" data-filter="raw" style="font-size: 0.72rem; padding: 3px 9px; background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.15); color: #ddd; border-radius: 12px; cursor: pointer;">
                            📄 Raw Log
                        </button>
                    </div>
                    <div style="position: relative; flex: 1; min-width: 140px; max-width: 240px;">
                        <input type="text" id="${boxId}-search" placeholder="Search card / target..." style="width: 100%; font-size: 0.75rem; padding: 4px 8px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #fff;" />
                    </div>
                </div>

                <!-- Turns Action List Container -->
                <div id="${boxId}-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 350px; overflow-y: auto; padding-right: 4px;">
                    <!-- Dynamically populated -->
                </div>

                <!-- Raw Monospace View (hidden by default) -->
                <div id="${boxId}-raw" style="display: none; max-height: 350px; overflow-y: auto; background: rgba(0,0,0,0.6); padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); font-family: monospace; font-size: 0.75rem; color: #a7f3d0; white-space: pre-wrap; line-height: 1.4;">
                    ${sanitizeHTML(fullLog || 'No raw log recorded.')}
                </div>
            </div>
        `;

        const copyBtn = document.getElementById(`${boxId}-copy-btn`);
        if (copyBtn) {
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(fullLog || 'No log');
                showToast('📋 Copied full match log to clipboard!');
            };
        }

        const closeBtn = document.getElementById(`${boxId}-close-btn`);
        if (closeBtn) {
            closeBtn.onclick = () => {
                box.style.display = 'none';
            };
        }

        let activeFilter = 'all';
        let searchQuery = '';

        function renderEvents() {
            const listEl = document.getElementById(`${boxId}-list`);
            const rawEl = document.getElementById(`${boxId}-raw`);
            if (!listEl || !rawEl) return;

            if (activeFilter === 'raw') {
                listEl.style.display = 'none';
                rawEl.style.display = 'block';
                return;
            }

            listEl.style.display = 'flex';
            rawEl.style.display = 'none';

            if (!turnEvents || turnEvents.length === 0) {
                if (fullLog) {
                    listEl.style.display = 'none';
                    rawEl.style.display = 'block';
                } else {
                    listEl.innerHTML = `
                        <div style="font-size:0.82rem; color:#aaa; padding:12px; text-align:center;">
                            No detailed log events available for this match.
                        </div>
                    `;
                }
                return;
            }

            const query = searchQuery.trim().toLowerCase();
            let turnsHtml = '';
            let matchedCount = 0;

            turnEvents.forEach(t => {
                if (t.turn === 0 && (!t.events || t.events.length === 0)) return;

                let filteredEvents = (t.events || []).filter(e => {
                    if (activeFilter === 'spells') {
                        if (!['cast', 'activated', 'triggered'].includes(e.type)) return false;
                    } else if (activeFilter === 'combat') {
                        if (!['attack', 'block', 'noblock', 'damage', 'life', 'outcome'].includes(e.type)) return false;
                    }

                    if (query) {
                        const matchText = (e.text || '').toLowerCase();
                        const matchCard = (e.card || '').toLowerCase();
                        const matchTargets = (e.targets || []).join(' ').toLowerCase();
                        const matchPlayer = (e.player || '').toLowerCase();
                        return matchText.includes(query) || matchCard.includes(query) || matchTargets.includes(query) || matchPlayer.includes(query);
                    }
                    return true;
                });

                if (filteredEvents.length === 0) return;
                matchedCount += filteredEvents.length;

                turnsHtml += `
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 6px; padding: 8px 10px;">
                        <div style="font-weight: 700; font-size: 0.82rem; color: var(--gold); margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                            <span>Turn ${t.turn}${t.player ? ` <span style="color:#aaa; font-weight:normal;">(${sanitizeHTML(t.player)})</span>` : ''}</span>
                            <span style="font-size:0.7rem; color:#777;">${filteredEvents.length} action${filteredEvents.length === 1 ? '' : 's'}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; line-height: 1.4;">
                `;

                filteredEvents.forEach(ev => {
                    let badge = '';
                    let content = '';

                    if (ev.type === 'land') {
                        badge = `<span style="background:rgba(34,197,94,0.15); color:#86efac; border:1px solid rgba(34,197,94,0.3); padding:1px 5px; border-radius:4px; font-size:0.72rem;">🏞️ Land</span>`;
                        content = `<strong style="color:#eee;">${sanitizeHTML(ev.player)}</strong> played <span style="color:#86efac; font-weight:600;">${sanitizeHTML(ev.card)}</span>`;
                    } else if (ev.type === 'cast') {
                        badge = `<span style="background:rgba(212,175,55,0.15); color:var(--gold); border:1px solid rgba(212,175,55,0.3); padding:1px 5px; border-radius:4px; font-size:0.72rem;">🎴 Cast</span>`;
                        content = `<strong style="color:#eee;">${sanitizeHTML(ev.player)}</strong> cast <strong style="color:var(--gold);">${sanitizeHTML(ev.card)}</strong>`;
                        if (ev.targets && ev.targets.length > 0) {
                            content += ` <span style="background:rgba(239,68,68,0.2); border:1px solid rgba(239,68,68,0.5); color:#fca5a5; padding:1px 6px; border-radius:4px; font-size:0.72rem; font-weight:600;">🎯 Target: ${sanitizeHTML(ev.targets.join(', '))}</span>`;
                        }
                    } else if (ev.type === 'activated') {
                        badge = `<span style="background:rgba(59,130,246,0.15); color:#93c5fd; border:1px solid rgba(59,130,246,0.3); padding:1px 5px; border-radius:4px; font-size:0.72rem;">⚡ Ability</span>`;
                        content = `<strong style="color:#eee;">${sanitizeHTML(ev.player)}</strong> activated <strong style="color:#93c5fd;">${sanitizeHTML(ev.card)}</strong>`;
                        if (ev.targets && ev.targets.length > 0) {
                            content += ` <span style="background:rgba(239,68,68,0.2); border:1px solid rgba(239,68,68,0.5); color:#fca5a5; padding:1px 6px; border-radius:4px; font-size:0.72rem; font-weight:600;">🎯 Target: ${sanitizeHTML(ev.targets.join(', '))}</span>`;
                        }
                    } else if (ev.type === 'triggered') {
                        badge = `<span style="background:rgba(168,85,247,0.15); color:#d8b4fe; border:1px solid rgba(168,85,247,0.3); padding:1px 5px; border-radius:4px; font-size:0.72rem;">🔔 Trigger</span>`;
                        content = `<strong style="color:#eee;">${sanitizeHTML(ev.player)}</strong> triggered <strong style="color:#d8b4fe;">${sanitizeHTML(ev.card)}</strong>`;
                        if (ev.targets && ev.targets.length > 0) {
                            content += ` <span style="background:rgba(239,68,68,0.2); border:1px solid rgba(239,68,68,0.5); color:#fca5a5; padding:1px 6px; border-radius:4px; font-size:0.72rem; font-weight:600;">🎯 Target: ${sanitizeHTML(ev.targets.join(', '))}</span>`;
                        }
                    } else if (ev.type === 'attack') {
                        badge = `<span style="background:rgba(245,158,11,0.15); color:#fcd34d; border:1px solid rgba(245,158,11,0.3); padding:1px 5px; border-radius:4px; font-size:0.72rem;">⚔️ Combat</span>`;
                        content = `<strong style="color:#eee;">${sanitizeHTML(ev.player)}</strong> attacked <strong style="color:#fcd34d;">${sanitizeHTML(ev.target)}</strong> with ${sanitizeHTML((ev.attackers || []).join(', '))}`;
                    } else if (ev.type === 'block') {
                        badge = `<span style="background:rgba(14,165,233,0.15); color:#7dd3fc; border:1px solid rgba(14,165,233,0.3); padding:1px 5px; border-radius:4px; font-size:0.72rem;">🛡️ Block</span>`;
                        content = `<strong style="color:#eee;">${sanitizeHTML(ev.player)}</strong> blocked ${sanitizeHTML(ev.blocked)} with ${sanitizeHTML((ev.blockers || []).join(', '))}`;
                    } else if (ev.type === 'noblock') {
                        badge = `<span style="background:rgba(239,68,68,0.15); color:#fca5a5; border:1px solid rgba(239,68,68,0.3); padding:1px 5px; border-radius:4px; font-size:0.72rem;">💥 Unblocked</span>`;
                        content = `<strong style="color:#eee;">${sanitizeHTML(ev.player)}</strong> did not block ${sanitizeHTML(ev.unblocked)}`;
                    } else if (ev.type === 'damage') {
                        badge = `<span style="background:rgba(225,29,72,0.15); color:#fda4af; border:1px solid rgba(225,29,72,0.3); padding:1px 5px; border-radius:4px; font-size:0.72rem;">🩸 Damage</span>`;
                        content = `<strong style="color:#eee;">${sanitizeHTML(ev.source)}</strong> dealt <span style="color:#fda4af; font-weight:700;">${ev.amount} ${ev.isCombat ? 'combat ' : ''}damage</span> to <strong style="color:#fff;">${sanitizeHTML(ev.target)}</strong>`;
                    } else if (ev.type === 'life') {
                        badge = `<span style="background:rgba(16,185,129,0.15); color:#6ee7b7; border:1px solid rgba(16,185,129,0.3); padding:1px 5px; border-radius:4px; font-size:0.72rem;">❤️ Life</span>`;
                        const diff = ev.to - ev.from;
                        const diffStr = diff > 0 ? `(+${diff})` : `(${diff})`;
                        content = `<strong style="color:#eee;">${sanitizeHTML(ev.player)}</strong>: ${ev.from} ➔ <strong style="color:#6ee7b7;">${ev.to}</strong> <span style="font-size:0.75rem; color:${diff < 0 ? '#f87171' : '#34d399'};">${diffStr}</span>`;
                    } else if (ev.type === 'zone') {
                        badge = `<span style="background:rgba(100,116,139,0.15); color:#cbd5e1; border:1px solid rgba(100,116,139,0.3); padding:1px 5px; border-radius:4px; font-size:0.72rem;">⚰️ Zone</span>`;
                        content = `<strong style="color:#eee;">${sanitizeHTML(ev.card)}</strong>: ${sanitizeHTML(ev.fromZone)} ➔ ${sanitizeHTML(ev.toZone)}`;
                    } else if (ev.type === 'outcome') {
                        badge = `<span style="background:rgba(212,175,55,0.2); color:var(--gold); border:1px solid var(--gold); padding:1px 5px; border-radius:4px; font-size:0.72rem;">🏁 Result</span>`;
                        content = `<strong style="color:var(--gold);">${sanitizeHTML(ev.text)}</strong>`;
                    } else {
                        badge = `<span>•</span>`;
                        content = sanitizeHTML(ev.text || '');
                    }

                    turnsHtml += `
                        <div style="display:flex; align-items:flex-start; gap:8px;">
                            <div style="flex-shrink:0;">${badge}</div>
                            <div style="flex:1; color:#ccc;">${content}</div>
                        </div>
                    `;
                });

                turnsHtml += `
                        </div>
                    </div>
                `;
            });

            if (matchedCount === 0) {
                listEl.innerHTML = `
                    <div style="font-size:0.82rem; color:#aaa; padding:16px; text-align:center;">
                        No actions match current filter "${activeFilter}" ${query ? `and search "${query}"` : ''}.
                    </div>
                `;
            } else {
                listEl.innerHTML = turnsHtml;
            }
        }

        const filterBtns = box.querySelectorAll('.sim-filter-btn');
        filterBtns.forEach(btn => {
            btn.onclick = () => {
                filterBtns.forEach(b => {
                    b.style.background = 'rgba(255,255,255,0.06)';
                    b.style.borderColor = 'rgba(255,255,255,0.15)';
                    b.style.color = '#ddd';
                });
                btn.style.background = 'rgba(52,211,153,0.2)';
                btn.style.borderColor = '#34d399';
                btn.style.color = '#34d399';
                activeFilter = btn.dataset.filter;
                renderEvents();
            };
        });

        const searchInput = document.getElementById(`${boxId}-search`);
        if (searchInput) {
            searchInput.oninput = (e) => {
                searchQuery = e.target.value;
                renderEvents();
            };
        }

        renderEvents();
    };

    window.downloadMatchLog = (gameNum) => {
        const match = (window._currentSimSession?.games || []).find(g => g.game === gameNum);
        if (!match) {
            showToast('Match record not found.', true);
            return;
        }
        const session = window._currentSimSession;
        const decks = session?.decks || [];
        const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

        let content = `=========================================================\n`;
        content += `COMMANDER CHALLENGE - MATCH #${match.game} SIMULATION LOG\n`;
        content += `=========================================================\n`;
        content += `Timestamp: ${dateStr}\n`;
        content += `Format: Commander / EDH (Multiplayer Free-for-All)\n`;
        content += `Simulation Engine: Headless Forge MTG Rules Engine (v1.6.61)\n\n`;

        content += `PARTICIPATING DECKS (${decks.length} Decks):\n`;
        decks.forEach((d, idx) => {
            content += `${idx + 1}. ${d.name} ${d.commander ? `[Commander: ${d.commander}]` : ''}\n`;
        });
        content += `\n`;

        content += `MATCH OUTCOME:\n`;
        content += `Winner: ${match.winner}\n`;
        content += `Winning Commander: ${match.winnerCommander || 'Commander'}\n`;
        content += `Deciding Turn: Turn ${match.turns}\n`;
        content += `Duration: ${(match.durationMs / 1000).toFixed(1)} seconds\n\n`;

        if (match.log) {
            content += `ACTUAL MATCH ACTIONS & SPELLS PLAYED (HEADLESS FORGE LOG):\n`;
            content += `=========================================================\n`;
            content += match.log;
            content += `\n\n`;
        } else {
            content += `ESTIMATED TURN-BY-TURN MILESTONES:\n`;
            for (let t = 1; t <= match.turns; t++) {
                if (t === 1) content += `Turn 1: Opening hands drawn. Land drops & early mana setup.\n`;
                else if (t === 2) content += `Turn 2: Mana ramp artifacts deployed & creature dorks cast.\n`;
                else if (t === 3) content += `Turn 3: Commander casting window & board presence established.\n`;
                else if (t === match.turns) content += `Turn ${t}: DECISIVE TURN. ${match.winner} achieves lethal board state / eliminates opposing players.\n`;
                else content += `Turn ${t}: Combat trades, card advantage engines & threat removal.\n`;
            }
            content += `\n`;
        }

        if (match.aiSummary) {
            content += `AI TACTICAL ANALYSIS:\n`;
            content += `${match.aiSummary}\n\n`;
        }

        content += `=========================================================\n`;
        content += `Generated by Commander Challenge - Play with your actual paper collection\n`;
        content += `https://commander-challenge.web.app\n`;
        content += `=========================================================\n`;

        downloadTextFile(`match_${match.game}_simulation_log.txt`, content);
        showToast(`📥 Match #${match.game} log downloaded!`);
    };

    window.downloadFullSimulationReport = () => {
        const session = window._currentSimSession;
        if (!session || !session.games || session.games.length === 0) {
            showToast('No simulation records available to download.', true);
            return;
        }
        const decks = session.decks || [];
        const games = session.games;
        const summary = session.summary || {};
        const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

        let content = `=========================================================\n`;
        content += `COMMANDER CHALLENGE - FULL BATCH SIMULATION REPORT\n`;
        content += `=========================================================\n`;
        content += `Timestamp: ${dateStr}\n`;
        content += `Total Matches: ${games.length}\n`;
        content += `Format: Commander / EDH (Multiplayer Free-for-All)\n`;
        content += `Rules Engine: Headless Forge MTG Rules Engine (v1.6.61)\n\n`;

        content += `OVERALL STANDINGS & WIN PROBABILITIES:\n`;
        (summary.results || []).forEach((r, idx) => {
            content += `${idx + 1}. ${r.name}: ${r.wins} Wins (${r.winRate}%) ${r.name === summary.bestDeck ? '[PROJECTED BEST]' : ''}\n`;
        });
        content += `\n`;

        const totalTurns = games.reduce((acc, g) => acc + (g.turns || 0), 0);
        const avgTurn = (totalTurns / games.length).toFixed(1);
        const fastest = [...games].sort((a, b) => a.turns - b.turns)[0];
        const longest = [...games].sort((a, b) => b.turns - a.turns)[0];
        const totalDuration = games.reduce((acc, g) => acc + (g.durationMs || 0), 0);
        const avgDuration = (totalDuration / games.length / 1000).toFixed(1);

        content += `AGGREGATE METRICS:\n`;
        content += `- Average Winning Turn: Turn ${avgTurn}\n`;
        content += `- Fastest Victory: Turn ${fastest.turns} (${fastest.winner})\n`;
        content += `- Longest Game: Turn ${longest.turns} (${longest.winner})\n`;
        content += `- Average Match Duration: ${avgDuration}s\n`;
        content += `- Total Simulation Runtime: ${(totalDuration / 1000).toFixed(1)}s\n\n`;

        content += `=========================================================\n`;
        content += `INDIVIDUAL MATCH BREAKDOWN:\n`;
        content += `=========================================================\n\n`;

        games.forEach(g => {
            content += `--- MATCH #${g.game} ---\n`;
            content += `Winner: ${g.winner}\n`;
            content += `Commander: ${g.winnerCommander || 'Commander'}\n`;
            content += `Ended on: Turn ${g.turns} (${(g.durationMs / 1000).toFixed(1)}s)\n`;
            if (g.log) {
                content += `Turn-by-Turn Card Plays & Action Log:\n${g.log}\n`;
            }
            if (g.aiSummary) {
                content += `Tactical Breakdown:\n${g.aiSummary}\n`;
            }
            content += `\n`;
        });

        content += `=========================================================\n`;
        content += `Generated by Commander Challenge - Play with your actual paper collection\n`;
        content += `https://commander-challenge.web.app\n`;
        content += `=========================================================\n`;

        downloadTextFile(`commander_challenge_simulation_report.txt`, content);
        showToast('📥 Full simulation report downloaded!');
    };

    window.requestAiMatchSummary = async (gameNum) => {
        const match = (window._currentSimSession?.games || []).find(g => g.game === gameNum);
        if (!match) return;

        const isSummaryVisible = document.getElementById('lobbySimSummarySection')?.style.display !== 'none';
        const box = isSummaryVisible
            ? (document.getElementById(`sim-summary-ai-box-${gameNum}`) || document.getElementById(`sim-ai-box-${gameNum}`))
            : (document.getElementById(`sim-ai-box-${gameNum}`) || document.getElementById(`sim-summary-ai-box-${gameNum}`));
        if (!box) return;

        if (box.dataset.loaded === 'true') {
            box.style.display = box.style.display === 'none' ? 'block' : 'none';
            return;
        }

        function renderSummary(targetBox, summaryText, engine) {
            targetBox.dataset.loaded = 'true';
            targetBox.style.display = 'block';
            const formatted = summaryText
                .replace(/### (.*$)/gim, '<div style="font-weight:800; color:var(--gold); font-size:0.95rem; margin-bottom:6px;">$1</div>')
                .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#eee;">$1</strong>')
                .replace(/\n\n/g, '<div style="margin-bottom:8px;"></div>')
                .replace(/\n\* /g, '<div style="margin-left:8px; margin-bottom:4px;">• ')
                .replace(/\n/g, '<br>');

            const copyId = `sim-ai-copy-${gameNum}-${Math.random().toString(36).substring(2, 6)}`;
            targetBox.innerHTML = `
                <div style="background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 8px; padding: 12px 14px; text-align: left; margin-top: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 4px;">
                        <span style="font-size: 0.78rem; font-weight: 700; color: #c084fc; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 4px;">
                            <span>📊</span> ${engine === 'gemini' ? 'Tactical Match Analysis' : 'MTG Rules Engine Analysis'}
                        </span>
                        <button type="button" class="secondary-btn" id="${copyId}" style="font-size: 0.72rem; padding: 2px 8px;">
                            📋 Copy
                        </button>
                    </div>
                    <div style="font-size: 0.85rem; color: #ddd; line-height: 1.5;">${formatted}</div>
                </div>
            `;
            const copyBtn = document.getElementById(copyId);
            if (copyBtn) {
                copyBtn.onclick = () => {
                    navigator.clipboard.writeText(summaryText);
                    showToast('Copied match breakdown!');
                };
            }
        }

        if (match.aiSummary) {
            renderSummary(box, match.aiSummary, match.aiEngine || 'algorithmic');
            return;
        }

        const allBtns = [document.getElementById(`sim-ai-btn-${gameNum}`), document.getElementById(`sim-summary-ai-btn-${gameNum}`)].filter(Boolean);
        allBtns.forEach(b => {
            b.disabled = true;
            b.innerHTML = `<span class="mana-spinner" style="width:12px; height:12px;"></span> Thinking...`;
        });

        box.style.display = 'block';
        box.innerHTML = `
            <div style="padding: 10px; color: var(--gold); font-size: 0.85rem; display: flex; align-items: center; gap: 8px;">
                <span class="mana-spinner"></span> Analyzing match performance and combat log...
            </div>
        `;

        try {
            const primaryUrl = '/summarizeMatch';
            const fallbackUrl = 'https://us-central1-commander-challenge.cloudfunctions.net/summarizeMatch';
            const clientApiKey = localStorage.getItem('gemini_api_key') || undefined;

            const reqBody = JSON.stringify({
                game: match.game,
                winner: match.winner,
                winnerCommander: match.winnerCommander,
                turns: match.turns,
                durationMs: match.durationMs,
                decks: window._currentSimSession?.decks || [],
                apiKey: clientApiKey,
                matchLog: match.log || ''
            });

            let resp;
            try {
                resp = await fetch(primaryUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: reqBody
                });
                if (!resp.ok && resp.status >= 500) {
                    resp = await fetch(fallbackUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: reqBody
                    });
                }
            } catch (_) {
                resp = await fetch(fallbackUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: reqBody
                });
            }

            if (!resp || !resp.ok) {
                throw new Error(`Service returned HTTP ${resp ? resp.status : 'offline'}`);
            }

            const data = await resp.json();
            const summaryText = data.summary || "Summary generated.";
            match.aiSummary = summaryText;
            match.aiEngine = data.engine;

            renderSummary(box, summaryText, data.engine);
            const otherBox = isSummaryVisible ? document.getElementById(`sim-ai-box-${gameNum}`) : document.getElementById(`sim-summary-ai-box-${gameNum}`);
            if (otherBox) {
                renderSummary(otherBox, summaryText, data.engine);
                otherBox.style.display = 'none';
            }
        } catch (err) {
            box.innerHTML = `
                <div style="padding: 8px; color: #f87171; font-size: 0.82rem;">
                    ⚠️ Could not generate match analysis: ${err.message}
                </div>
            `;
        } finally {
            allBtns.forEach(b => {
                b.disabled = false;
                b.innerHTML = `<span>📊</span> Match Breakdown`;
            });
        }
    };
}