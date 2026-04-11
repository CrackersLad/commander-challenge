import { db } from './firebase-setup.js?v=19.34';
import { ref, runTransaction, update, get } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

export function renderSnakeDraft(activeDraft, container, s, currentPlayerId, players, utils) {
    const { sanitizeHTML } = utils;
    const turnIndex = activeDraft.turn || 0;
    const pickOrder = activeDraft.pickOrder || [];
    const isMyTurn = pickOrder[turnIndex] === currentPlayerId;
    const currentPickerName = players[pickOrder[turnIndex]]?.name || "Someone";

    let html = `<div style="text-align:center; margin-bottom:20px; width: 100%;">
        <h2 style="color:var(--gold); font-family:Cinzel;">Face-Up Snake Draft</h2>
        <h3 style="color:${isMyTurn ? '#2ecc71' : '#aaa'};">Round ${Math.floor(turnIndex / activeDraft.playerOrder.length) + 1} - ${isMyTurn ? 'Your Turn to Pick!' : `Waiting on ${sanitizeHTML(currentPickerName)}...`}</h3>
    </div>`;

    html += `<div style="display:flex; flex-wrap:wrap; justify-content:center; gap:15px; width:100%;">`;
    (activeDraft.pool || []).forEach((card) => {
        let img = card.image_uris?.normal || card.image1;
        const safeName = sanitizeHTML(card.name);
        const edhrecSlug = safeName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const edhrecLink = `https://edhrec.com/commanders/${edhrecSlug}`;
        html += `
            <div class="option-card revealed" style="width:220px; padding:15px; ${!isMyTurn ? 'opacity:0.6;' : ''}">
                <a href="${edhrecLink}" target="_blank" title="View on EDHREC">
                    <img src="${sanitizeHTML(img)}" class="commander-img" style="margin-top:0;" loading="lazy">
                </a>
                <p class="rank-tag" style="color:var(--gold); font-weight:bold; font-size: 0.95rem; margin: 10px 0 5px 0;">EDHREC Rank: #${card.display_rank || 'Unranked'}</p>
                ${isMyTurn ? `<button class="select-btn" style="width:100%; margin-top:5px; font-size:0.8rem;" onclick="window.interactiveDraftAction('snake_pick', \`${safeName}\`, event)">Draft ${safeName}</button>` : ''}
            </div>
        `;
    });
    html += `</div>`;
    container.innerHTML = html;
}

export async function handleSnakePick(cardName, currentRoom, currentPlayerId, utils) {
    const draftRef = ref(db, `rooms/${currentRoom}/activeDraft`);
    await runTransaction(draftRef, (draft) => {
        if (!draft || !draft.pickOrder || draft.pickOrder[draft.turn] !== currentPlayerId) return draft;
        const cardIndex = (draft.pool || []).findIndex(c => c.name === cardName);
        if (cardIndex === -1) return draft;

        const draftedCard = draft.pool.splice(cardIndex, 1)[0];
        if (!draft.drafted) draft.drafted = {};
        if (!draft.drafted[currentPlayerId]) draft.drafted[currentPlayerId] = [];
        draft.drafted[currentPlayerId].push(draftedCard);
        draft.turn += 1;
        if (draft.turn >= draft.pickOrder.length) draft.isComplete = true;
        return draft;
    });

    const snap = await get(draftRef);
    if (snap.val()?.isComplete) {
        let updates = {};
        snap.val().playerOrder.forEach(pid => updates[`rooms/${currentRoom}/players/${pid}/generated`] = snap.val().drafted[pid]);
        updates[`rooms/${currentRoom}/activeDraft`] = null; // Clear the draft session
        await update(ref(db), updates);
    }
}