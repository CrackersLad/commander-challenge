import { db } from './firebase-setup.js?v=19.30';
import { ref, runTransaction, update, get } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

export function renderAsyncDraft(activeDraft, container, s, currentPlayerId, players, utils) {
    const { sanitizeHTML } = utils;
    const myQueue = activeDraft.queues ? activeDraft.queues[currentPlayerId] : [];
    const myDrafted = activeDraft.drafted ? activeDraft.drafted[currentPlayerId] : [];

    if (!myQueue || myQueue.length === 0) {
        let html = `<div style="text-align:center; margin-bottom:20px; width: 100%;">
            <h2 style="color:var(--gold); font-family:Cinzel;">Asynchronous Booster Draft</h2>
            <p style="color:#ccc;">Drafted: ${myDrafted ? myDrafted.length : 0} / ${activeDraft.draftGoal}</p>
        </div>`;
        html += `<div style="text-align:center; color:#aaa; margin-top:40px; width:100%;"><span class="mana-spinner"></span> Waiting for the next pack...</div>`;
        container.innerHTML = html;
        return;
    }

    const currentPack = myQueue[0];
    
    let passingToHtml = '';
    if (activeDraft.playerOrder && activeDraft.playerOrder.length > 1) {
        if (currentPack.cards.length > 1) {
            const order = activeDraft.playerOrder;
            const nextPlayerId = order[(order.indexOf(currentPlayerId) + 1) % order.length];
            const nextPlayerName = players && players[nextPlayerId] ? players[nextPlayerId].name : "Next Player";
            passingToHtml = `<p style="color:#aaa; font-size: 0.95rem; margin-top: 5px;">Passes next to: <strong style="color:var(--gold);">${sanitizeHTML(nextPlayerName)}</strong></p>`;
        } else {
            passingToHtml = `<p style="color:#2ecc71; font-size: 0.95rem; margin-top: 5px;"><strong>Final pick of this pack!</strong></p>`;
        }
    }

    let html = `<div style="text-align:center; margin-bottom:20px; width: 100%;">
        <h2 style="color:var(--gold); font-family:Cinzel;">Asynchronous Booster Draft</h2>
        <p style="color:#ccc; margin-bottom: 5px;">Drafted: ${myDrafted ? myDrafted.length : 0} / ${activeDraft.draftGoal}</p>
        ${passingToHtml}
    </div>`;

    html += `<div style="display:flex; flex-wrap:wrap; justify-content:center; gap:20px; width:100%;">`;
    currentPack.cards.forEach((card) => {
        let img = card.image_uris?.normal || card.image1;
        const safeName = sanitizeHTML(card.name);
        const edhrecSlug = safeName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const edhrecLink = `https://edhrec.com/commanders/${edhrecSlug}`;
        html += `
            <div class="option-card revealed" style="width:220px; padding:15px;">
                <a href="${edhrecLink}" target="_blank" title="View on EDHREC">
                    <img src="${sanitizeHTML(img)}" class="commander-img" style="margin-top:0;" loading="lazy">
                </a>
                <p class="rank-tag" style="color:var(--gold); font-weight:bold; font-size: 0.95rem; margin: 10px 0 5px 0;">EDHREC Rank: #${card.display_rank || 'Unranked'}</p>
                <button class="select-btn" style="width:100%; margin-top:5px; font-size:0.8rem;" onclick="window.interactiveDraftAction('async_pick', { packId: '${currentPack.id}', cardName: \`${safeName}\` }, event)">Draft ${safeName}</button>
            </div>
        `;
    });
    html += `</div>`;
    container.innerHTML = html;
}

export async function handleAsyncPick(payload, currentRoom, currentPlayerId, utils) {
    const draftRef = ref(db, `rooms/${currentRoom}/activeDraft`);

    await runTransaction(draftRef, (draft) => {
        if (!draft || !draft.queues || !draft.queues[currentPlayerId]) return draft;
        const myQueue = draft.queues[currentPlayerId];
        if (myQueue.length === 0 || myQueue[0].id !== payload.packId) return draft; // Sync check

        const pack = myQueue.shift(); 
        const cardIndex = pack.cards.findIndex(c => c.name === payload.cardName);
        if (cardIndex === -1) return draft;

        const draftedCard = pack.cards.splice(cardIndex, 1)[0];
        if (!draft.drafted) draft.drafted = {};
        if (!draft.drafted[currentPlayerId]) draft.drafted[currentPlayerId] = [];
        draft.drafted[currentPlayerId].push(draftedCard);

        if (pack.cards.length > 0) {
            const order = draft.playerOrder;
            const nextPlayerId = order[(order.indexOf(currentPlayerId) + 1) % order.length];
            if (!draft.queues[nextPlayerId]) draft.queues[nextPlayerId] = [];
            draft.queues[nextPlayerId].push(pack);
        }

        let allDone = true;
        for (let pid of draft.playerOrder) {
            if (!draft.drafted[pid] || draft.drafted[pid].length < draft.draftGoal) { allDone = false; break; }
        }
        if (allDone) draft.isComplete = true;
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