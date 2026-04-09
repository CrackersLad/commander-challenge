import { db } from './firebase-setup.js?v=19.9';
import { fetchDeckPriceLocal } from './deck-parser.js?v=19.9';
import { ref, get, update } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

export function initDeckActionsModule(utils, state) {
    const { playSound, showToast, showConfirm } = utils;

    window.refreshMyDeckPrice = async () => {
        playSound('sfx-click');
        const roomSnap = await get(ref(db, `rooms/${state.currentRoom}`));
        const roomData = roomSnap.val();
        const myData = roomData?.players?.[state.currentPlayerId];
        const settings = roomData?.settings;

        if (!myData || !myData.deck || !settings) {
            return showToast("Could not find your deck to refresh.", true);
        }

        const isMoxfield = myData.deck && myData.deck.toLowerCase().includes("moxfield.com");
        showToast(isMoxfield ? "Recalculating deck price... (Moxfield APIs may take a few seconds)" : "Recalculating deck price...", false, 0);
        try {
            const res = await fetchDeckPriceLocal(myData.deck, settings.currency || 'eur', settings.includeCmdr !== false, myData.selected);
            if (res && !res.error) {
                let updates = { deckPrice: res.total, isLegal: res.isLegal, deckSize: res.deckSize, deckSalt: res.deckSalt };
                if (res.commanderArt) updates.image = res.commanderArt;

                const maxDeckBudget = settings.deckBudget !== undefined ? parseFloat(settings.deckBudget) : 50;
                const isNowReady = res.isLegal && (maxDeckBudget === 0 || res.total <= maxDeckBudget);
                if (isNowReady && myData.lockedDeckPrice === undefined) updates.lockedDeckPrice = res.total;

                await update(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`), updates);
                showToast("Deck price updated!", false, 3000, true);
            } else {
                showToast(res.error || "Failed to update price.", true);
            }
        } catch (err) {
            console.error("Refresh failed for", myData.name, err);
            showToast("An error occurred during refresh.", true);
        }
    };

    window.lockMyDeckPrice = async () => {
        playSound('sfx-click');
        const snap = await get(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`));
        const myData = snap.val();
        if (!myData || myData.deckPrice === undefined) return showToast("No deck price to lock.", true);

        showConfirm("Lock In Deck Cost?", `This will overwrite your currently locked price with the current price of ${myData.deckPrice.toFixed(2)}. Are you sure?`, async () => {
            playSound('sfx-choose');
            await update(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`), { lockedDeckPrice: myData.deckPrice });
            showToast("Deck price locked!", false, 3000, true);
        });
    };
}