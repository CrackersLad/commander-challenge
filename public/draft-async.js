import { db } from './firebase-setup.js?v=18.25';
import { ref, get, update, runTransaction } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

export async function handleAsyncPick(payload, currentRoom, currentPlayerId, utils) {
    const { playSound, showConfirm, showToast } = utils;
    playSound('sfx-click');
    showConfirm("Draft Commander?", "Are you sure you want to draft this commander?", async () => {
        playSound('sfx-choose');
        const { packId, cardIdx } = payload;
        const draftRef = ref(db, `rooms/${currentRoom}/activeDraft`);
        try {
            await runTransaction(draftRef, (draft) => {
                if (!draft || !draft.queues) return draft;
                
                let myQueue = draft.queues[currentPlayerId] || [];
                if (!Array.isArray(myQueue)) myQueue = Object.values(myQueue);
                if (myQueue.length === 0 || myQueue[0].id !== packId) return draft; // Out of sync
                
                const pack = myQueue.shift(); // Pop the first pack
                draft.queues[currentPlayerId] = myQueue; // Ensure format holds
                
                if (!Array.isArray(pack.cards)) pack.cards = Object.values(pack.cards);
                const card = pack.cards[cardIdx];
                pack.cards.splice(cardIdx, 1); // Remove the picked card
                
                // Safeguard against Firebase deleting the drafted node
                if (!draft.drafted) draft.drafted = {};
                if (!draft.drafted[currentPlayerId]) draft.drafted[currentPlayerId] = [];
                let myDrafted = draft.drafted[currentPlayerId];
                if (!Array.isArray(myDrafted)) myDrafted = Object.values(myDrafted);
                myDrafted.push(card);
                draft.drafted[currentPlayerId] = myDrafted;
                
                // Pass the remaining pack to the next player
                if (pack.cards.length > 0) {
                    const pIdx = draft.playerOrder.indexOf(currentPlayerId);
                    const nextIdx = (pIdx + 1) % draft.playerOrder.length;
                    const nextId = draft.playerOrder[nextIdx];
                    let nextQueue = draft.queues[nextId] || [];
                    if (!Array.isArray(nextQueue)) nextQueue = Object.values(nextQueue);
                    nextQueue.push(pack);
                    draft.queues[nextId] = nextQueue;
                }
                
                // Check for global completion
                let complete = true;
                draft.playerOrder.forEach(id => {
                    let pDrafted = draft.drafted[id] || [];
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
                showToast("Commander drafted! Pack passed.", false, 3000, true);
            }
        } catch (err) {
            console.error(err);
            showToast("Error recording pick. Try again.", true);
        }
    });
}

export function renderAsyncDraft(activeDraft, container, s, currentPlayerId, utils) {
    const { sanitizeHTML, getColorBadges } = utils;
    
    let myQueue = activeDraft.queues ? activeDraft.queues[currentPlayerId] || [] : [];
    if (!Array.isArray(myQueue)) myQueue = Object.values(myQueue);
    
    let myDrafted = activeDraft.drafted ? activeDraft.drafted[currentPlayerId] || [] : [];
    if (!Array.isArray(myDrafted)) myDrafted = Object.values(myDrafted);
    
    let html = '';
    
    if (myQueue.length === 0) {
        if (myDrafted.length >= activeDraft.draftGoal) {
            html += `
                <div style="display:flex; flex-direction:column; align-items:center; margin-top:50px;">
                    <h2 style="color:var(--gold); font-family:Cinzel;">Drafting Complete</h2>
                    <p style="color:#aaa;">Waiting for other players to finish their picks...</p>
                </div>
            `;
        } else {
            html += `
                <div style="display:flex; flex-direction:column; align-items:center; margin-top:50px;">
                    <h2 style="color:var(--gold); font-family:Cinzel;">Waiting for Pass...</h2>
                    <p style="color:#aaa;">No packs are currently in your queue.</p>
                    <span class="mana-spinner"></span>
                </div>
            `;
        }
    } else {
        const currentPack = myQueue[0];
        html += `
            <div style="width:100%; text-align:center; margin-bottom: 20px;">
                <h2 style="color:var(--gold); font-family:Cinzel;">Asynchronous Booster Draft</h2>
                <p style="color:#aaa;">Packs in Queue: <span style="color:white; font-weight:bold;">${myQueue.length}</span> • Select 1 Commander to pass the pack.</p>
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
            
            let imageHtml = '';
            if (img2) {
                imageHtml = `
                <div class="scene">
                    <div class="card-3d" id="draft-card3d-${i}">
                        <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC" style="display:block;" class="card-face card-face-front">
                            <img src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy" style="margin-top:0;">
                        </a>
                        <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC" style="display:block;" class="card-face card-face-back">
                            <img src="${sanitizeHTML(img2)}" class="commander-img" loading="lazy" style="margin-top:0;">
                        </a>
                    </div>
                </div>
                <button class="flip-btn" onclick="window.flipCard3D('draft-card3d-${i}', event)">🔄 Flip Card</button>
                `;
            } else {
                imageHtml = `
                <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC">
                    <img id="draft-img-${i}" src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy">
                </a>`;
            }

            html += `
                <div class="option-card revealed" style="transition:none; transform:none; opacity:1;">
                    ${imageHtml}
                    <p class="price-tag" style="margin-top: 15px;">${priceString}</p>
                    <div class="mana-container">${colorBadges}</div>
                    <p class="rank-tag" style="color:var(--gold); font-weight:bold; font-size: 1rem; margin-bottom: 15px;">EDHREC Rank: #${card.display_rank}</p>
                    <button class="select-btn" onclick="window.interactiveDraftAction('async_pick', { packId: '${currentPack.id}', cardIdx: ${i} })">Draft ${safeCardName}</button>
                </div>
            `;
        });
        html += `</div>`;
    }

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