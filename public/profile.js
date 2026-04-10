import { db, auth } from './firebase-setup.js?v=19.25';
import { ref, get, query, orderByChild, limitToLast } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

export function initProfileModule(utils, state) {
    const { playSound, switchView, sanitizeHTML } = utils;

    const profileBtn = document.getElementById('myProfileBtn');
    if (profileBtn) profileBtn.onclick = () => openMyProfile();

    

    async function openMyProfile() {
        playSound('sfx-click');
        const user = auth.currentUser;
        if (!user || user.isAnonymous) {
            utils.showToast("You must be logged in to view your profile.", true);
            return;
        }
        
        const modal = document.getElementById('accountModal');
        if (modal) { modal.classList.remove('show'); setTimeout(() => modal.style.display='none', 300); }

        switchView('view-profile');
        const container = document.getElementById('view-profile');
        container.innerHTML = `<div class="lobby-container" style="max-width: 800px;"><h2 style="color:var(--gold);"><span class="mana-spinner"></span> Loading Profile...</h2></div>`;

        try {
            const userStatsSnap = await get(ref(db, `users/${user.uid}`));
            const userData = userStatsSnap.val() || {};
            const profile = userData.profile || {};
            const stats = userData.stats || {};
            const winHistory = stats.win_history ? Object.values(stats.win_history) : [];

            const wins = stats.wins || 0;

            let html = `
                <div style="text-align: left; width: 100%; max-width: 800px; margin: 0 auto -20px auto; position: relative; z-index: 10;">
                    <button class="secondary-btn" onclick="window.goToMainMenu()" style="padding: 5px 15px; font-size: 0.8rem; border-radius: 4px; border: none; text-decoration: underline; background: transparent;"><span style="font-size: 1.2rem; vertical-align: middle;">🏠</span> Return to Hub</button>
                </div>
                <div class="lobby-container" style="max-width: 800px; margin-top: 50px;">
                    <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 20px;">
                        <img src="${sanitizeHTML(user.photoURL || 'icon.svg')}" style="width: 80px; height: 80px; border-radius: 50%; border: 2px solid var(--gold); object-fit: cover;">
                        <div>
                            <h2 style="margin: 0; text-align: left;">${sanitizeHTML(profile.nickname || user.displayName)}</h2>
                            <p style="margin: 5px 0 0 0; color: #aaa; text-align: left;">Challenger Profile</p>
                        </div>
                    </div>

                    <div class="settings-grid" style="gap: 20px; border-top: 1px solid #333; padding-top: 20px;">
                        <div style="background: #111; padding: 15px; border-radius: 8px; text-align: center;">
                            <h3 style="margin: 0 0 5px 0; font-size: 1rem; color: #aaa;">Total Wins</h3>
                            <p style="margin: 0; font-size: 2.5rem; color: var(--gold); font-weight: bold;">${wins}</p>
                        </div>
                        <div style="background: #111; padding: 15px; border-radius: 8px; text-align: center;">
                            <h3 style="margin: 0 0 5px 0; font-size: 1rem; color: #aaa;">Win Rate</h3>
                            <p style="margin: 0; font-size: 2.5rem; color: #aaa; font-weight: bold;">N/A</p>
                        </div>
                    </div>

                    <h3 style="margin-top: 30px; color: var(--gold); border-top: 1px solid #333; padding-top: 20px;">Victory Log</h3>
                    <div id="winHistoryList" style="text-align: left; font-size: 0.9rem; color: #ccc; max-height: 300px; overflow-y: auto;">
                        ${winHistory.length === 0 ? '<p style="color:#888; text-align:center;">No victories recorded yet.</p>' : ''}
                    </div>
                </div>
            `;
            container.innerHTML = html;

            const historyListEl = document.getElementById('winHistoryList');
            winHistory.sort((a,b) => b.date - a.date).forEach(win => {
                historyListEl.innerHTML += `
                    <div style="background: #1a1a1a; padding: 10px 15px; border-radius: 6px; margin-bottom: 8px; border-left: 4px solid var(--gold);">
                        <strong>${sanitizeHTML(win.commander)}</strong>
                        <span style="float: right; color: #888;">${new Date(win.date).toLocaleDateString()}</span>
                        <br>
                        <span style="font-size: 0.8rem; color: #666;">in Room: ${sanitizeHTML(win.room)}</span>
                    </div>
                `;
            });

        } catch (e) {
            console.error("Failed to load profile:", e);
            container.innerHTML = `<div class="lobby-container"><h2 style="color:#ff4444;">Error Loading Profile</h2><p>${e.message}</p></div>`;
        }
    }

    
}