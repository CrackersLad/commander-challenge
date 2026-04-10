import { db } from './firebase-setup.js?v=19.28';
import { ref, get, update, remove, onValue } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

export function initCalendarModule(utils, state) {
    const { playSound, showToast, sanitizeHTML } = utils;

    const formatSelect = document.getElementById('battleFormat');
    if(formatSelect) {
        formatSelect.onchange = () => {
            const customIn = document.getElementById('battleFormatCustom');
            customIn.style.display = formatSelect.value === 'Custom' ? 'block' : 'none';
        };
    }

    window.openBattleSetup = (existingData) => {
        playSound('sfx-click');
        const modal = document.getElementById('battleModal');
        const dateIn = document.getElementById('battleDate');
        const formatIn = document.getElementById('battleFormat');
        const customIn = document.getElementById('battleFormatCustom');
        const prizeIn = document.getElementById('battlePrize');
        const btnConfirm = document.getElementById('battleConfirm');
        const btnCancel = document.getElementById('battleCancel');

        if (existingData) {
            dateIn.value = existingData.date; prizeIn.value = existingData.prize;
            if (['Free-for-All', '1v1 Tournament', 'Best of 3', 'Two-Headed Giant'].includes(existingData.format)) {
                formatIn.value = existingData.format; customIn.style.display = 'none';
            } else { formatIn.value = 'Custom'; customIn.style.display = 'block'; customIn.value = existingData.format; }
        }

        btnConfirm.onclick = async () => {
            const dateVal = dateIn.value; const prizeVal = prizeIn.value.trim();
            let formatVal = formatIn.value; if (formatVal === 'Custom') formatVal = customIn.value.trim();
            if (!dateVal || !formatVal || !prizeVal) return showToast("All fields are required!", true);
            playSound('sfx-choose');
            let updates = { date: dateVal, format: formatVal, prize: prizeVal };
            if (!existingData || existingData.date !== dateVal) updates.cantMakeIt = null;
            await update(ref(db, `rooms/${state.currentRoom}/meetup`), updates);
            
            modal.classList.remove('show'); setTimeout(() => { modal.style.display = 'none'; }, 300);
            showToast("Battle Announced!", false, 3000, true);
        };
        btnCancel.onclick = () => { playSound('sfx-click'); modal.classList.remove('show'); setTimeout(() => { modal.style.display = 'none'; }, 300); };
        modal.style.display = 'flex'; setTimeout(() => modal.classList.add('show'), 10);
    };

    let availListener = null;
    const availCloseBtn = document.getElementById('availCloseBtn');
    if (availCloseBtn) {
        availCloseBtn.onclick = () => { playSound('sfx-click'); if (availListener) { availListener(); availListener = null; } document.getElementById('availabilityModal').classList.remove('show'); setTimeout(() => { document.getElementById('availabilityModal').style.display = 'none'; }, 300); };
    }

    window.openAvailability = async () => {
        playSound('sfx-click');
        const modal = document.getElementById('availabilityModal');
        const grid = document.getElementById('availGrid');
        modal.style.display = 'flex'; setTimeout(() => modal.classList.add('show'), 10);
        if (availListener) availListener(); 
        
        const dates = []; const today = new Date(); for(let i=0; i<30; i++) { const d = new Date(today); d.setDate(today.getDate() + i); dates.push(d); }

        availListener = onValue(ref(db, `rooms/${state.currentRoom}/players`), (snap) => {
            const players = snap.val() || {}; const playerIds = Object.keys(players); const totalPlayers = playerIds.length;
            const myAvail = players[state.currentPlayerId]?.availability || [];
            grid.innerHTML = ""; 
            dates.forEach(d => {
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                const dateKey = `${year}-${month}-${day}`;
                const dayCard = document.createElement('div'); dayCard.className = 'avail-day-card';
                dayCard.innerHTML = `<div class="avail-date-header"><span class="day-name">${d.toLocaleDateString(undefined, { weekday: 'short' })}</span>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>`;
                
                ['AM', 'PM'].forEach(time => {
                    const slotKey = `${dateKey}_${time}`; const isSelected = myAvail.includes(slotKey);
                    let count = 0; let availP = [];
                    playerIds.forEach(pid => { if(players[pid].availability && players[pid].availability.includes(slotKey)) { count++; availP.push(sanitizeHTML(players[pid].name)); } });
                    const btn = document.createElement('div'); btn.className = `avail-slot ${isSelected ? 'selected' : ''}`;
                    const tHtml = count > 0 ? `<div class="avail-tooltip"><strong style="color:var(--gold);">Available:</strong><br>${availP.join('<br>')}</div>` : '';

                    if (count === totalPlayers && totalPlayers > 1) {
                        btn.classList.add('consensus');
                        if (state.isHost) {
                            btn.style.border = "2px solid var(--gold)";
                            btn.innerHTML = `<strong>${time}</strong><br><button class="lock-in-btn" style="background:var(--gold); border:none; color:black; font-size:0.7rem; font-weight:bold; border-radius:3px; padding:2px 6px; margin-top:2px; cursor:pointer;">LOCK IN</button>${tHtml}`;
                            btn.onclick = () => { playSound('sfx-click'); update(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`), { availability: isSelected ? myAvail.filter(x => x !== slotKey) : [...myAvail, slotKey] }); };
                            btn.querySelector('.lock-in-btn').onclick = (e) => { e.stopPropagation(); playSound('sfx-choose'); const setDate = new Date(d); setDate.setHours(time === 'AM' ? 10 : 14, 0, 0, 0); const offset = setDate.getTimezoneOffset() * 60000; modal.classList.remove('show'); setTimeout(() => modal.style.display='none', 300); window.openBattleSetup({ date: (new Date(setDate - offset)).toISOString().slice(0, 16), format: 'Free-for-All', prize: '' }); };
                            dayCard.appendChild(btn); return;
                        }
                    }
                    btn.innerHTML = `<strong>${time}</strong><br><span class="avail-count">${count}/${totalPlayers}</span>${tHtml}`;
                    btn.onclick = () => { playSound('sfx-click'); update(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`), { availability: isSelected ? myAvail.filter(x => x !== slotKey) : [...myAvail, slotKey] }); };
                    dayCard.appendChild(btn);
                });
                grid.appendChild(dayCard);
            });
        });
    };
}