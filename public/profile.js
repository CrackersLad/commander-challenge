import { db, auth } from './firebase-setup.js?v=8.2';
import { ref, get, query, orderByChild, limitToLast } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

export function initProfileModule(utils, state) {
    const { playSound, switchView, sanitizeHTML } = utils;

    const profileBtn = document.getElementById('myProfileBtn');
    if (profileBtn) profileBtn.onclick = () => openMyProfile();

    window.openMyProfile = openMyProfile;
    window.openHallOfFame = openHallOfFame;

    async function openMyProfile() {
        playSound('sfx-click');
        const user = auth.currentUser;
        
        const modal = document.getElementById('accountModal');
        if (modal) { modal.classList.remove('show'); setTimeout(() => modal.style.display='none', 300); }

        switchView('view-profile');
        const container = document.getElementById('view-profile');
        container.innerHTML = `<div class="lobby-container" style="max-width: 850px;"><h2 style="color:var(--gold);"><span class="mana-spinner"></span> Loading Challenger Profile...</h2></div>`;

        try {
            let userData = {};
            let wins = 0;
            let matches = 0;
            let winHistory = [];
            let displayName = 'Guest Challenger';
            let photoUrl = 'icon.png';

            if (user && !user.isAnonymous) {
                const userStatsSnap = await get(ref(db, `users/${user.uid}`));
                userData = userStatsSnap.val() || {};
                const profile = userData.profile || {};
                const stats = userData.stats || {};
                wins = stats.wins || 0;
                matches = stats.matches_played || stats.matches || (stats.win_history ? Object.keys(stats.win_history).length : 0);
                winHistory = stats.win_history ? Object.values(stats.win_history) : [];
                displayName = profile.nickname || user.displayName || 'Challenger';
                photoUrl = user.photoURL || 'icon.png';
            } else {
                // Anonymous or guest: check local session stats
                const localHistory = JSON.parse(localStorage.getItem('cmdr_guest_history') || '[]');
                wins = localHistory.filter(h => h.isWinner).length;
                matches = localHistory.length;
                winHistory = localHistory;
                displayName = (user && user.displayName) || localStorage.getItem('cmdr_guest_name') || 'Guest Challenger';
            }

            // Calculate Win Rate
            if (matches < wins) matches = wins; // Ensure logical baseline
            const winRateStr = matches > 0 ? `${((wins / matches) * 100).toFixed(1)}%` : (wins > 0 ? '100%' : '0.0%');

            // Analyze Favorite Commander & Colors
            const cmdrCounts = {};
            winHistory.forEach(w => {
                if (w.commander) cmdrCounts[w.commander] = (cmdrCounts[w.commander] || 0) + 1;
            });
            const topCmdrEntry = Object.entries(cmdrCounts).sort((a,b) => b[1] - a[1])[0];
            const favoriteCommander = topCmdrEntry ? topCmdrEntry[0] : 'None Yet';

            let html = `
                <div style="text-align: left; width: 100%; max-width: 850px; margin: 0 auto -20px auto; position: relative; z-index: 10;">
                    <button class="secondary-btn" onclick="window.goToMainMenu()" style="padding: 5px 15px; font-size: 0.85rem; border-radius: 4px; border: none; text-decoration: underline; background: transparent;"><span style="font-size: 1.2rem; vertical-align: middle;">🏠</span> Return to Hub</button>
                </div>
                <div class="lobby-container" style="max-width: 850px; margin-top: 50px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 20px; margin-bottom: 25px;">
                        <div style="display: flex; align-items: center; gap: 20px;">
                            <img src="${sanitizeHTML(photoUrl)}" style="width: 84px; height: 84px; border-radius: 50%; border: 2px solid var(--gold); object-fit: cover; box-shadow: 0 0 15px rgba(212,175,55,0.25);">
                            <div>
                                <h2 style="margin: 0; text-align: left; font-family: Cinzel; color: white;">${sanitizeHTML(displayName)}</h2>
                                <p style="margin: 5px 0 0 0; color: #aaa; text-align: left; font-size: 0.95rem;">🏆 Commander Draft Challenger</p>
                            </div>
                        </div>
                        <div>
                            <button class="secondary-btn" onclick="window.openHallOfFame()" style="padding: 8px 18px; border: 1px solid var(--gold); color: var(--gold); font-size: 0.9rem;">🏛️ Hall of Fame</button>
                        </div>
                    </div>

                    <div class="settings-grid" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 15px; border-top: 1px solid #333; padding-top: 20px;">
                        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 15px; border-radius: 8px; text-align: center;">
                            <h3 style="margin: 0 0 5px 0; font-size: 0.85rem; color: #888; text-transform: uppercase; letter-spacing: 1px;">Lifetime Wins</h3>
                            <p style="margin: 0; font-size: 2.2rem; color: var(--gold); font-weight: bold; font-family: Cinzel;">${wins}</p>
                        </div>
                        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 15px; border-radius: 8px; text-align: center;">
                            <h3 style="margin: 0 0 5px 0; font-size: 0.85rem; color: #888; text-transform: uppercase; letter-spacing: 1px;">Pod Matches</h3>
                            <p style="margin: 0; font-size: 2.2rem; color: #38bdf8; font-weight: bold; font-family: Cinzel;">${matches}</p>
                        </div>
                        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 15px; border-radius: 8px; text-align: center;">
                            <h3 style="margin: 0 0 5px 0; font-size: 0.85rem; color: #888; text-transform: uppercase; letter-spacing: 1px;">Win Rate</h3>
                            <p style="margin: 0; font-size: 2.2rem; color: #4ade80; font-weight: bold; font-family: Cinzel;">${winRateStr}</p>
                        </div>
                        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 15px; border-radius: 8px; text-align: center;">
                            <h3 style="margin: 0 0 5px 0; font-size: 0.85rem; color: #888; text-transform: uppercase; letter-spacing: 1px;">Top Commander</h3>
                            <p style="margin: 0; font-size: 1.1rem; color: #f59e0b; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${sanitizeHTML(favoriteCommander)}">${sanitizeHTML(favoriteCommander)}</p>
                        </div>
                    </div>

                    <h3 style="margin-top: 30px; color: var(--gold); border-top: 1px solid #333; padding-top: 20px; font-family: Cinzel; display: flex; align-items: center; justify-content: space-between;">
                        <span>📜 Victory Log & Battle Records</span>
                        <span style="font-size: 0.85rem; color: #888; font-family: inherit;">${winHistory.length} recorded triumphs</span>
                    </h3>
                    <div id="winHistoryList" style="text-align: left; font-size: 0.9rem; color: #ccc; max-height: 380px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
                        ${winHistory.length === 0 ? '<p style="color:#888; text-align:center; padding: 25px 0;">No victories recorded yet. Draft your deck and claim the crown in a Challenge Room!</p>' : ''}
                    </div>
                </div>
            `;
            container.innerHTML = html;

            const historyListEl = document.getElementById('winHistoryList');
            winHistory.sort((a,b) => (b.date || 0) - (a.date || 0)).forEach(win => {
                const dateStr = win.date ? new Date(win.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown Date';
                historyListEl.innerHTML += `
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 12px 18px; border-radius: 8px; border-left: 4px solid var(--gold); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                        <div>
                            <div style="font-weight: 600; color: white; font-size: 1rem;">👑 ${sanitizeHTML(win.commander || 'Unknown Commander')}</div>
                            <span style="font-size: 0.8rem; color: #888;">in Room: ${sanitizeHTML(win.room || 'Challenge Lobby')}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span style="color: #888; font-size: 0.85rem;">${dateStr}</span>
                            ${win.commander ? `<button type="button" class="secondary-btn" style="padding: 4px 10px; font-size: 0.8rem;" onclick="window.openCardInspector('${sanitizeHTML(win.commander)}')">✨ Inspect</button>` : ''}
                        </div>
                    </div>
                `;
            });

        } catch (e) {
            console.error("Failed to load profile:", e);
            container.innerHTML = `<div class="lobby-container"><h2 style="color:#ff4444;">Error Loading Profile</h2><p>${e.message}</p></div>`;
        }
    }

    async function openHallOfFame() {
        playSound('sfx-click');
        switchView('view-hall-of-fame');
        const container = document.getElementById('view-hall-of-fame');
        container.innerHTML = `
            <div class="view-top-breadcrumb">
                <button class="breadcrumb-btn" onclick="window.goToMainMenu()">
                    <span>🏠</span> Return to Hub
                </button>
            </div>
            <div class="lobby-container" style="max-width: 950px; margin-top: 20px;">
                <h2 style="color:var(--gold); font-family: Cinzel;"><span class="mana-spinner"></span> Unsealing the Hall of Fame...</h2>
            </div>
        `;

        try {
            // Aggregate from database rooms/history or hall_of_fame node
            const [roomsSnap, hallSnap] = await Promise.all([
                get(ref(db, 'rooms')),
                get(ref(db, 'hall_of_fame')).catch(() => null)
            ]);

            const rooms = roomsSnap.val() || {};
            const hallData = hallSnap && hallSnap.val() ? hallSnap.val() : {};

            const playerStats = {};
            const commanderStats = {};
            const matchHistory = [];
            let maxSalt = { score: 0, player: 'None', commander: 'None' };
            let maxPrice = { price: 0, player: 'None', commander: 'None' };

            // Process all matches recorded across rooms
            Object.entries(rooms).forEach(([roomId, room]) => {
                const history = room.history || {};
                Object.values(history).forEach(match => {
                    if (!match) return;
                    matchHistory.push({ ...match, roomCode: roomId });

                    if (match.winnerName) {
                        const pName = match.winnerName;
                        if (!playerStats[pName]) playerStats[pName] = { name: pName, wins: 0, matches: 0 };
                        playerStats[pName].wins += 1;
                    }

                    if (match.commander) {
                        const cmdr = match.commander;
                        if (!commanderStats[cmdr]) commanderStats[cmdr] = { name: cmdr, wins: 0, highestSalt: 0 };
                        commanderStats[cmdr].wins += 1;
                    }

                    if (match.participants) {
                        Object.values(match.participants).forEach(p => {
                            if (!p || !p.name) return;
                            if (!playerStats[p.name]) playerStats[p.name] = { name: p.name, wins: 0, matches: 0 };
                            playerStats[p.name].matches += 1;

                            if (p.salt && p.salt > maxSalt.score) {
                                maxSalt = { score: p.salt, player: p.name, commander: p.commander || 'Unknown' };
                            }
                            if (p.price && p.price > maxPrice.price) {
                                maxPrice = { price: p.price, player: p.name, commander: p.commander || 'Unknown' };
                            }
                        });
                    }
                });
            });

            // Merge any standalone hallData
            if (hallData.records) {
                Object.values(hallData.records).forEach(rec => matchHistory.push(rec));
            }

            const topPlayers = Object.values(playerStats).sort((a,b) => b.wins - a.wins || (b.wins/b.matches || 0) - (a.wins/a.matches || 0)).slice(0, 8);
            const topCommanders = Object.values(commanderStats).sort((a,b) => b.wins - a.wins).slice(0, 8);
            matchHistory.sort((a,b) => (b.date || 0) - (a.date || 0));

            let html = `
                <div class="view-top-breadcrumb">
                    <button class="breadcrumb-btn" onclick="window.goToMainMenu()">
                        <span>🏠</span> Return to Hub
                    </button>
                </div>

                <div class="lobby-container" style="max-width: 1000px; margin-top: 10px;">
                    <!-- Hero Banner -->
                    <div style="text-align: center; margin-bottom: 35px;">
                        <span style="font-size: 2.8rem;">🏛️</span>
                        <h1 style="font-family: Cinzel; color: var(--gold); font-size: 2.4rem; margin: 5px 0; letter-spacing: 2px;">HALL OF FAME</h1>
                        <p style="color: #aaa; max-width: 650px; margin: 0 auto; font-size: 1rem;">
                            The eternal pantheon of victorious champions, conquering commanders, and legendary draft challenge triumphs.
                        </p>
                    </div>

                    <!-- Highlight Records Cards -->
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; margin-bottom: 35px;">
                        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(212,175,55,0.25); border-radius: 10px; padding: 18px; text-align: center;">
                            <span style="font-size: 1.8rem;">🏆</span>
                            <h4 style="margin: 8px 0 4px 0; color: #888; font-size: 0.8rem; text-transform: uppercase;">Total Challenge Wins</h4>
                            <div style="font-size: 2.2rem; font-family: Cinzel; color: var(--gold); font-weight: bold;">${matchHistory.length}</div>
                            <span style="font-size: 0.75rem; color: #666;">Matches Recorded</span>
                        </div>
                        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(56,189,248,0.25); border-radius: 10px; padding: 18px; text-align: center;">
                            <span style="font-size: 1.8rem;">👑</span>
                            <h4 style="margin: 8px 0 4px 0; color: #888; font-size: 0.8rem; text-transform: uppercase;">Premier Champion</h4>
                            <div style="font-size: 1.4rem; font-family: Cinzel; color: #38bdf8; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${topPlayers[0] ? sanitizeHTML(topPlayers[0].name) : 'Awaiting King'}</div>
                            <span style="font-size: 0.75rem; color: #666;">${topPlayers[0] ? `${topPlayers[0].wins} Victories` : '0 Wins'}</span>
                        </div>
                        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(239,68,68,0.25); border-radius: 10px; padding: 18px; text-align: center;">
                            <span style="font-size: 1.8rem;">☣️</span>
                            <h4 style="margin: 8px 0 4px 0; color: #888; font-size: 0.8rem; text-transform: uppercase;">Salt Altar Record</h4>
                            <div style="font-size: 1.4rem; font-family: Cinzel; color: #f87171; font-weight: bold;">${maxSalt.score ? maxSalt.score.toFixed(1) : '0.0'}</div>
                            <span style="font-size: 0.75rem; color: #888; overflow: hidden; text-overflow: ellipsis; display: block;" title="${sanitizeHTML(maxSalt.commander)}">${sanitizeHTML(maxSalt.commander)} (${sanitizeHTML(maxSalt.player)})</span>
                        </div>
                    </div>

                    <!-- Split Leaderboards: Champions vs Commanders -->
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 25px; margin-bottom: 35px;">
                        <!-- Champions Board -->
                        <div style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 20px;">
                            <h3 style="font-family: Cinzel; color: var(--gold); margin: 0 0 15px 0; display: flex; align-items: center; justify-content: space-between;">
                                <span>🥇 Top Challengers</span>
                                <span style="font-size: 0.8rem; color: #888;">By Total Wins</span>
                            </h3>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                ${topPlayers.length === 0 ? '<p style="color:#888; text-align:center;">No matches played yet.</p>' : ''}
                                ${topPlayers.map((p, idx) => `
                                    <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02); padding: 10px 14px; border-radius: 6px; border-left: 3px solid ${idx === 0 ? 'var(--gold)' : (idx === 1 ? '#cbd5e1' : (idx === 2 ? '#b45309' : '#444'))};">
                                        <div style="display: flex; align-items: center; gap: 10px;">
                                            <span style="font-family: Cinzel; font-weight: bold; color: ${idx === 0 ? 'var(--gold)' : '#aaa'}; width: 22px;">#${idx + 1}</span>
                                            <span style="color: white; font-weight: 500;">${sanitizeHTML(p.name)}</span>
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 15px;">
                                            <span style="color: #888; font-size: 0.85rem;">${p.matches} pods</span>
                                            <span style="font-family: Cinzel; color: var(--gold); font-weight: bold; font-size: 1.1rem;">${p.wins} 🏆</span>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <!-- Top Commanders Board -->
                        <div style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 20px;">
                            <h3 style="font-family: Cinzel; color: var(--gold); margin: 0 0 15px 0; display: flex; align-items: center; justify-content: space-between;">
                                <span>👑 Most Winning Commanders</span>
                                <span style="font-size: 0.8rem; color: #888;">By Wins</span>
                            </h3>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                ${topCommanders.length === 0 ? '<p style="color:#888; text-align:center;">No commanders recorded yet.</p>' : ''}
                                ${topCommanders.map((c, idx) => `
                                    <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02); padding: 10px 14px; border-radius: 6px; border-left: 3px solid ${idx === 0 ? 'var(--gold)' : '#444'};">
                                        <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
                                            <span style="font-family: Cinzel; font-weight: bold; color: ${idx === 0 ? 'var(--gold)' : '#aaa'}; width: 22px;">#${idx + 1}</span>
                                            <span style="color: white; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${sanitizeHTML(c.name)}">${sanitizeHTML(c.name)}</span>
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 10px;">
                                            <span style="font-family: Cinzel; color: var(--gold); font-weight: bold;">${c.wins} 🏆</span>
                                            <button type="button" class="secondary-btn" style="padding: 2px 8px; font-size: 0.75rem;" onclick="window.openCardInspector('${sanitizeHTML(c.name)}')">✨ Inspect</button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>

                    <!-- Recent Victory Feed -->
                    <div style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 20px;">
                        <h3 style="font-family: Cinzel; color: var(--gold); margin: 0 0 15px 0;">⚔️ Chronological Match Victories</h3>
                        <div style="display: flex; flex-direction: column; gap: 8px; max-height: 400px; overflow-y: auto;">
                            ${matchHistory.length === 0 ? '<p style="color:#888; text-align:center;">No match history logged yet.</p>' : ''}
                            ${matchHistory.map(m => `
                                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 12px 16px; border-radius: 6px; flex-wrap: wrap; gap: 10px; border-left: 3px solid var(--gold);">
                                    <div>
                                        <div style="font-weight: 600; color: white;">👑 ${sanitizeHTML(m.winnerName || 'Winner')} with <span style="color: var(--gold);">${sanitizeHTML(m.commander || 'Commander')}</span></div>
                                        <div style="font-size: 0.8rem; color: #888;">Room: ${sanitizeHTML(m.roomCode || 'Challenge')} • ${m.date ? new Date(m.date).toLocaleDateString() : 'Date N/A'}</div>
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        ${m.commander ? `<button type="button" class="secondary-btn" style="padding: 4px 10px; font-size: 0.8rem;" onclick="window.openCardInspector('${sanitizeHTML(m.commander)}')">✨ Inspect</button>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
            container.innerHTML = html;
        } catch (err) {
            console.error("Failed to render Hall of Fame:", err);
            container.innerHTML = `<div class="lobby-container"><h2 style="color:#ff4444;">Error Loading Hall of Fame</h2><p>${err.message}</p></div>`;
        }
    }
}