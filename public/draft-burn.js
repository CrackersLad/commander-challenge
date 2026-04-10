import { db } from './firebase-setup.js?v=19.29';
import { ref, runTransaction, update, get } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

export function renderBurnDraft(activeDraft, container, s, currentPlayerId, players, utils) {
    const { sanitizeHTML } = utils;
    const myQueue = activeDraft.queues ? activeDraft.queues[currentPlayerId] : [];

    if (!myQueue || myQueue.length === 0) {
        let html = `<div style="text-align:center; margin-bottom:20px; width: 100%;">
            <h2 style="color:var(--gold); font-family:Cinzel;">Blind Elimination Draft</h2>
            <p style="color:#ff4444; font-weight:bold;">🔥 BURN a commander to eliminate it from the pack! 🔥</p>
        </div>`;
        html += `<div style="text-align:center; color:#aaa; margin-top:40px; width:100%;"><span class="mana-spinner"></span> Waiting for the next pack...</div>`;
        container.innerHTML = html;
        return;
    }

    const currentPack = myQueue[0];
    
    let passingToHtml = '';
    if (activeDraft.playerOrder && activeDraft.playerOrder.length > 1) {
        const order = activeDraft.playerOrder;
        const distance = currentPack.cards.length - 1;
        const finalPlayerId = order[(order.indexOf(currentPlayerId) + distance) % order.length];
        const finalPlayerName = players && players[finalPlayerId] ? players[finalPlayerId].name : "Unknown Player";
        
        if (currentPack.cards.length > 2) {
            passingToHtml = `<p style="color:#aaa; font-size: 0.95rem; margin-top: 5px;">These cards contain the commander for <strong style="color:var(--gold);">${sanitizeHTML(finalPlayerName)}</strong></p>`;
        } else {
            passingToHtml = `<p style="color:#2ecc71; font-size: 0.95rem; margin-top: 5px;"><strong>Final burn! These cards contain the commander for ${sanitizeHTML(finalPlayerName)}!</strong></p>`;
        }
    }

    let html = `<div style="text-align:center; margin-bottom:20px; width: 100%;">
        <h2 style="color:var(--gold); font-family:Cinzel;">Blind Elimination Draft</h2>
        <p style="color:#ff4444; font-weight:bold; margin-bottom: 5px;">🔥 BURN a commander to eliminate it from the pack! 🔥</p>
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
                <button class="select-btn" style="width:100%; margin-top:5px; font-size:0.8rem; background: transparent; border: 1px solid #ff4444; color: #ff9999;" onclick="window.interactiveDraftAction('burn_pick', { packId: '${currentPack.id}', cardName: \`${safeName}\` }, event)">🔥 Burn ${safeName}</button>
            </div>
        `;
    });
    html += `</div>`;
    container.innerHTML = html;
}

export async function handleBurnPick(payload, currentRoom, currentPlayerId, utils) {
    const draftRef = ref(db, `rooms/${currentRoom}/activeDraft`);
    await runTransaction(draftRef, (draft) => {
        if (!draft || !draft.queues || !draft.queues[currentPlayerId]) return draft;
        const myQueue = draft.queues[currentPlayerId];
        if (myQueue.length === 0 || myQueue[0].id !== payload.packId) return draft;

        const pack = myQueue.shift();
        const cardIndex = pack.cards.findIndex(c => c.name === payload.cardName);
        if (cardIndex === -1) return draft;

        const burnedCard = pack.cards.splice(cardIndex, 1)[0]; // Burn it

        if (!draft.burnLog) draft.burnLog = [];
        draft.burnLog.push({
            playerId: currentPlayerId,
            cardName: burnedCard.name
        });

        if (pack.cards.length === 1) {
            const order = draft.playerOrder;
            const nextPlayerId = order[(order.indexOf(currentPlayerId) + 1) % order.length];
            if (!draft.drafted) draft.drafted = {};
            if (!draft.drafted[nextPlayerId]) draft.drafted[nextPlayerId] = [];
            draft.drafted[nextPlayerId].push(pack.cards[0]);
        } else if (pack.cards.length > 1) {
            const order = draft.playerOrder;
            const nextPlayerId = order[(order.indexOf(currentPlayerId) + 1) % order.length];
            if (!draft.queues[nextPlayerId]) draft.queues[nextPlayerId] = [];
            draft.queues[nextPlayerId].push(pack);
        }

        let allDone = true;
        for (let pid of draft.playerOrder) {
            if (!draft.drafted || !draft.drafted[pid] || draft.drafted[pid].length < draft.draftGoal) { allDone = false; break; }
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