import { db } from './firebase-setup.js?v=19.34';
import { ref, runTransaction, update, get } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

export function renderSnakeDraft(activeDraft, container, s, currentPlayerId, players, utils) {
    const { sanitizeHTML } = utils;
    const turnIndex = activeDraft.turn || 0;
    const pickOrder = activeDraft.pickOrder || [];
    const isMyTurn = pickOrder[turnIndex] === currentPlayerId;
    const currentPickerName = players[pickOrder[turnIndex]]?.name || "Someone";

    const myDrafted = activeDraft.drafted && activeDraft.drafted[currentPlayerId] ? activeDraft.drafted[currentPlayerId] : [];
    let draftedHtml = '';
    if (myDrafted.length > 0) {
        draftedHtml = `
            <details style="margin: 0 auto 20px auto; background: #151515; padding: 10px 15px; border-radius: 8px; border: 1px solid #333; text-align: left; max-width: 600px;">
                <summary style="color:var(--gold); cursor:pointer; font-family:'Segoe UI'; outline:none; font-weight:bold;">Your Drafted Commanders (${myDrafted.length}/${activeDraft.draftGoal})</summary>
                <div style="display:flex; gap:10px; overflow-x:auto; padding-top:15px; padding-bottom:5px;">
                    ${myDrafted.map(c => `
                        <div style="flex-shrink:0; text-align:center; width:90px;">
                            <img src="${sanitizeHTML(c.image_uris?.normal || c.image1)}" style="width:100%; border-radius:4px; border:1px solid #555;" title="${sanitizeHTML(c.name)}">
                            <div style="font-size:0.7rem; color:#ccc; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${sanitizeHTML(c.name)}</div>
                        </div>
                    `).join('')}
                </div>
            </details>
        `;
    }

    let html = `<div style="text-align:center; margin-bottom:20px; width: 100%;">
        <h2 style="color:var(--gold); font-family:Cinzel;">Face-Up Snake Draft</h2>
        <h3 style="color:${isMyTurn ? '#2ecc71' : '#aaa'}; margin-bottom:15px;">Round ${Math.floor(turnIndex / activeDraft.playerOrder.length) + 1} - ${isMyTurn ? 'Your Turn to Pick!' : `Waiting on ${sanitizeHTML(currentPickerName)}...`}</h3>
        ${draftedHtml}
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