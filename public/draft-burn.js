import { db } from './firebase-setup.js?v=19.0';
import { ref, get, update, runTransaction } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

export async function handleBurnPick(payload, currentRoom, currentPlayerId, utils) {
    const { playSound, showConfirm, showToast } = utils;
    playSound('sfx-click');
    showConfirm("Burn Commander?", "Are you sure you want to eliminate this commander? It will be removed from the pack permanently.", async () => {
        playSound('sfx-choose');
        const { packId, cardIdx } = payload;
        
        const cardEl = document.getElementById(`burn-card-${cardIdx}`);
        if (cardEl) {
            cardEl.classList.remove('revealed');
            cardEl.classList.add('card-burn-effect');
            const btn = cardEl.querySelector('.select-btn');
            if (btn) btn.disabled = true;
        }
        
        setTimeout(async () => {
            const draftRef = ref(db, `rooms/${currentRoom}/activeDraft`);
            try {
            await runTransaction(draftRef, (draft) => {
                if (!draft || !draft.queues) return draft;
                
                let myQueue = draft.queues[currentPlayerId] || [];
                if (!Array.isArray(myQueue)) myQueue = Object.values(myQueue);
                if (myQueue.length === 0 || myQueue[0].id !== packId) return draft; 
                
                const pack = myQueue.shift(); 
                draft.queues[currentPlayerId] = myQueue; 
                
                if (!Array.isArray(pack.cards)) pack.cards = Object.values(pack.cards);
                pack.cards.splice(cardIdx, 1); // 🔥 BURN the card!
                
                const pIdx = draft.playerOrder.indexOf(currentPlayerId);
                const nextIdx = (pIdx + 1) % draft.playerOrder.length;
                const nextId = draft.playerOrder[nextIdx];

                if (pack.cards.length === 1) {
                    // Pack is down to 1 card, the next player automatically drafts it!
                    if (!draft.drafted) draft.drafted = {};
                    if (!draft.drafted[nextId]) draft.drafted[nextId] = [];
                    let nextDrafted = draft.drafted[nextId];
                    if (!Array.isArray(nextDrafted)) nextDrafted = Object.values(nextDrafted);
                    nextDrafted.push(pack.cards[0]);
                    draft.drafted[nextId] = nextDrafted;
                } else if (pack.cards.length > 1) {
                    // Pass the pack to the next player's queue
                    let nextQueue = draft.queues[nextId] || [];
                    if (!Array.isArray(nextQueue)) nextQueue = Object.values(nextQueue);
                    nextQueue.push(pack);
                    draft.queues[nextId] = nextQueue;
                }
                
                // Check for global completion
                let complete = true;
                draft.playerOrder.forEach(id => {
                    let pDrafted = draft.drafted ? draft.drafted[id] || [] : [];
                    if (!Array.isArray(pDrafted)) pDrafted = Object.values(pDrafted);
                    if (pDrafted.length < draft.draftGoal) complete = false;
                });
                if (complete) draft.isComplete = true;
                
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
                showToast("Commander burned! Pack passed.", false, 3000, true);
            }
        } catch (err) {
            console.error(err);
            showToast("Error recording burn. Try again.", true);
        }
        }, 600);
    });
}

export function renderBurnDraft(activeDraft, container, s, currentPlayerId, utils) {
    const { sanitizeHTML, getColorBadges } = utils;
    
    let myQueue = activeDraft.queues ? activeDraft.queues[currentPlayerId] || [] : [];
    if (!Array.isArray(myQueue)) myQueue = Object.values(myQueue);
    
    let myDrafted = activeDraft.drafted ? activeDraft.drafted[currentPlayerId] || [] : [];
    if (!Array.isArray(myDrafted)) myDrafted = Object.values(myDrafted);
    
    let html = '';
    
    if (myQueue.length === 0) {
        if (myDrafted.length >= activeDraft.draftGoal) {
            html += `<div style="display:flex; flex-direction:column; align-items:center; margin-top:50px;"><h2 style="color:var(--gold); font-family:Cinzel;">Drafting Complete</h2><p style="color:#aaa;">Waiting for other players to finish their picks...</p></div>`;
        } else {
            html += `<div style="display:flex; flex-direction:column; align-items:center; margin-top:50px;"><h2 style="color:var(--gold); font-family:Cinzel;">Waiting for Pass...</h2><p style="color:#aaa;">No packs are currently in your queue.</p><span class="mana-spinner"></span></div>`;
        }
    } else {
        const currentPack = myQueue[0];
        html += `
            <div style="width:100%; text-align:center; margin-bottom: 20px;">
                <h2 style="color:#ff4e50; font-family:Cinzel; text-shadow: 0 0 15px rgba(255, 78, 80, 0.6);">Blind Elimination Draft</h2>
                <p style="color:#aaa;">Packs in Queue: <span style="color:white; font-weight:bold;">${myQueue.length}</span> • Select 1 Commander to 🔥 BURN (eliminate).</p>
            </div>
            <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:30px; width:100%;">
        `;
        
        let currentCards = currentPack.cards || [];
        if (!Array.isArray(currentCards)) currentCards = Object.values(currentCards);
        currentCards.forEach((card, i) => {
            if (!card) return; 
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
            
            let imageHtml = img2 ? `
                <div class="scene">
                    <div class="card-3d" id="draft-card3d-${i}">
                        <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC" style="display:block;" class="card-face card-face-front"><img src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy" style="margin-top:0;"></a>
                        <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC" style="display:block;" class="card-face card-face-back"><img src="${sanitizeHTML(img2)}" class="commander-img" loading="lazy" style="margin-top:0;"></a>
                    </div>
                </div>
                <button class="flip-btn" onclick="window.flipCard3D('draft-card3d-${i}', event)">🔄 Flip Card</button>
            ` : `<a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC"><img id="draft-img-${i}" src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy"></a>`;

            html += `
                <div id="burn-card-${i}" class="option-card revealed" style="transition:none; transform:none; opacity:1;">
                    ${imageHtml}
                    <p class="price-tag" style="margin-top: 15px;">${priceString}</p>
                    <div class="mana-container">${colorBadges}</div>
                    <p class="rank-tag" style="color:var(--gold); font-weight:bold; font-size: 1rem; margin-bottom: 15px;">EDHREC Rank: #${card.display_rank}</p>
                    <button class="select-btn" style="background: linear-gradient(135deg, #ff4e50 0%, #f9d423 100%); color: black; box-shadow: 0 4px 0 #cc0000; text-shadow: none;" onclick="window.interactiveDraftAction('burn_pick', { packId: '${currentPack.id}', cardIdx: ${i} })">🔥 Burn ${safeCardName}</button>
                </div>
            `;
        });
        html += `</div>`;
    }

    if (myDrafted.length > 0) {
        html += `<div style="width:100%; margin-top:40px; border-top:1px solid #333; padding-top:20px;">
            <h3 style="color:#aaa; font-family:Cinzel;">Survived the Burn</h3>
            <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:15px;">`;
        myDrafted.forEach(c => {
            let dImg = c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || c.image1;
            html += `<img src="${dImg}" style="width:120px; border-radius:6px; border:1px solid #ff4e50; box-shadow:0 4px 10px rgba(255,78,80,0.4);" loading="lazy" title="${sanitizeHTML(c.name)}">`;
        });
        html += `</div></div>`;
    }

    container.innerHTML = html;
}