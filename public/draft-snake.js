import { db } from './firebase-setup.js?v=18.26';
import { ref, get, update, runTransaction } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

export async function handleSnakePick(payload, currentRoom, currentPlayerId, utils) {
    const { playSound, showConfirm, showToast } = utils;
    playSound('sfx-click');
    showConfirm("Draft Commander?", "Are you sure you want to pick this commander?", async () => {
        playSound('sfx-choose');
        const { cardIdx } = payload;
        
        const cardEl = document.getElementById(`snake-card-${cardIdx}`);
        if (cardEl) {
            cardEl.classList.remove('revealed');
            cardEl.classList.add('card-pick-effect');
            const btn = cardEl.querySelector('.select-btn');
            if (btn) btn.disabled = true;
        }

        setTimeout(async () => {
            const draftRef = ref(db, `rooms/${currentRoom}/activeDraft`);
            try {
            await runTransaction(draftRef, (draft) => {
                if (!draft || !draft.pickOrder || !draft.pool) return draft;

                const currentTurnId = draft.pickOrder[draft.turn];
                if (currentTurnId !== currentPlayerId) return draft; // Not your turn

                let pool = draft.pool || [];
                if (!Array.isArray(pool)) pool = Object.values(pool);

                const card = pool[cardIdx];
                if (!card || card === "PICKED") return draft; // Already picked or invalid

                pool[cardIdx] = "PICKED"; // Securely mark as picked without destroying array length
                draft.pool = pool;

                if (!draft.drafted) draft.drafted = {};
                if (!draft.drafted[currentPlayerId]) draft.drafted[currentPlayerId] = [];
                let myDrafted = draft.drafted[currentPlayerId];
                if (!Array.isArray(myDrafted)) myDrafted = Object.values(myDrafted);
                myDrafted.push(card);
                draft.drafted[currentPlayerId] = myDrafted;

                draft.turn++;

                if (draft.turn >= draft.pickOrder.length) {
                    draft.isComplete = true;
                }

                return draft;
            });

            const snap = await get(draftRef);
            const finalDraft = snap.val();
            if (finalDraft && finalDraft.isComplete) {
                let finalUpdates = {};
                finalDraft.playerOrder.forEach(id => {
                    finalUpdates[`players/${id}/generated`] = finalDraft.drafted[id] || [];
                    finalUpdates[`players/${id}/rerollCount`] = 0;
                });
                finalUpdates['activeDraft'] = null;
                await update(ref(db, `rooms/${currentRoom}`), finalUpdates);
                showToast("Draft complete! Choose your final commander.", false, 3000, true);
            } else {
                showToast("Commander drafted!", false, 3000, true);
            }
        } catch (err) {
            console.error(err);
            showToast("Error recording pick. Try again.", true);
        }
        }, 600);
    });
}

export function renderSnakeDraft(activeDraft, container, s, currentPlayerId, players, utils) {
    const { sanitizeHTML, getColorBadges } = utils;

    const turnIdx = activeDraft.turn || 0;
    const currentTurnId = activeDraft.pickOrder ? activeDraft.pickOrder[turnIdx] : null;
    const isMyTurn = currentTurnId === currentPlayerId;
    const currentTurnPlayerName = players && players[currentTurnId] ? players[currentTurnId].name : "Unknown Player";

    let myDrafted = activeDraft.drafted ? activeDraft.drafted[currentPlayerId] || [] : [];
    if (!Array.isArray(myDrafted)) myDrafted = Object.values(myDrafted);

    let html = `
        <div style="width:100%; text-align:center; margin-bottom: 20px;">
            <h2 style="color:var(--gold); font-family:Cinzel;">Face-Up Snake Draft</h2>
            <p style="color:#aaa;">Pick ${turnIdx + 1} of ${activeDraft.pickOrder?.length || 0}</p>
    `;

    if (isMyTurn) {
        html += `<h3 style="color:#2ecc71; margin-top:10px; animation: pulseGold 2s infinite;">Your Turn to Pick!</h3>`;
    } else {
        html += `<h3 style="color:#ffcc00; margin-top:10px;">Waiting for ${sanitizeHTML(currentTurnPlayerName)} to pick... <span class="mana-spinner" style="width:12px;height:12px;"></span></h3>`;
    }

    // Generate the visible upcoming turn order queue
    let upcomingHtml = `<div style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap; margin: 20px auto 0 auto; padding: 12px; background: #111; border-radius: 8px; border: 1px solid #333; max-width: 600px;">`;
    upcomingHtml += `<div style="width:100%; color:#aaa; font-family:Cinzel; font-size:0.85rem; margin-bottom:8px;">Upcoming Turns:</div>`;
    
    const remainingOrder = activeDraft.pickOrder ? activeDraft.pickOrder.slice(turnIdx) : [];
    remainingOrder.forEach((pid, idx) => {
        const pName = players && players[pid] ? players[pid].name : "Unknown";
        const isCurrent = idx === 0;
        const bg = isCurrent ? 'var(--gold)' : '#222';
        const color = isCurrent ? '#000' : '#ccc';
        const border = isCurrent ? '1px solid var(--gold)' : '1px solid #444';
        const shadow = isCurrent ? 'box-shadow: 0 0 10px rgba(212, 175, 55, 0.5);' : '';
        
        upcomingHtml += `<div style="background:${bg}; color:${color}; border:${border}; border-radius:4px; padding:4px 8px; font-size:0.8rem; font-weight:bold; ${shadow}">${sanitizeHTML(pName)}</div>`;
        
        if (idx < remainingOrder.length - 1) {
            upcomingHtml += `<div style="color:#555; align-self:center; font-size:0.7rem;">▶</div>`;
        }
    });
    upcomingHtml += `</div>`;

    html += upcomingHtml;

    html += `</div><div style="display:flex; flex-wrap:wrap; justify-content:center; gap:30px; width:100%;">`;

    let pool = activeDraft.pool || [];
    if (!Array.isArray(pool)) pool = Object.values(pool);

    pool.forEach((card, i) => {
        if (!card || card === "PICKED") {
            // Render an empty greyed-out slot
            html += `
                <div class="option-card" style="opacity: 0.3; border: 1px dashed #555; display:flex; align-items:center; justify-content:center; min-height:350px;">
                    <h3 style="color:#555; font-family:Cinzel;">Drafted</h3>
                </div>
            `;
            return;
        }

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

        let imageHtml = '';
        if (img2) {
            imageHtml = `
            <div class="scene">
                <div class="card-3d" id="draft-card3d-${i}">
                    <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC" style="display:block;" class="card-face card-face-front"><img src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy" style="margin-top:0;"></a>
                    <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC" style="display:block;" class="card-face card-face-back"><img src="${sanitizeHTML(img2)}" class="commander-img" loading="lazy" style="margin-top:0;"></a>
                </div>
            </div>
            <button class="flip-btn" onclick="window.flipCard3D('draft-card3d-${i}', event)">🔄 Flip Card</button>
            `;
        } else {
            imageHtml = `<a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC"><img id="draft-img-${i}" src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy"></a>`;
        }

        html += `
            <div id="snake-card-${i}" class="option-card revealed" style="transition:none; transform:none; opacity:1; ${!isMyTurn ? 'pointer-events:none;' : ''}">
                ${imageHtml}
                <p class="price-tag" style="margin-top: 15px;">${priceString}</p>
                <div class="mana-container">${colorBadges}</div>
                <p class="rank-tag" style="color:var(--gold); font-weight:bold; font-size: 1rem; margin-bottom: 15px;">EDHREC Rank: #${card.display_rank}</p>
                ${isMyTurn ? `<button class="select-btn" onclick="window.interactiveDraftAction('snake_pick', { cardIdx: ${i} })">Draft ${safeCardName}</button>` : ''}
            </div>
        `;
    });
    html += `</div>`;

    if (myDrafted.length > 0) {
        html += `<div style="width:100%; margin-top:40px; border-top:1px solid #333; padding-top:20px;">
            <h3 style="color:#aaa; font-family:Cinzel;">Your Drafted Commanders</h3>
            <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:15px;">`;
        myDrafted.forEach(c => {
            let dImg = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || c.image1;
            html += `<img src="${dImg}" style="width:120px; border-radius:6px; border:1px solid #444; box-shadow:0 4px 10px rgba(0,0,0,0.8);" loading="lazy" title="${sanitizeHTML(c.name)}">`;
        });
        html += `</div></div>`;
    }
    container.innerHTML = html;
}