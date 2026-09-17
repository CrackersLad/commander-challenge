import { db } from './firebase-setup.js?v=7.1';
import { fetchDeckPriceLocal, fetchDeckFromAPI } from './deck-parser.js?v=7.1';
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
                const maxDeckBudget = settings.deckBudget !== undefined ? parseFloat(settings.deckBudget) : 50;
                const maxBracket = settings.maxBracket !== undefined ? parseFloat(settings.maxBracket) : 0;
                const isSizeLegal = res.isLegal === true;
                const isBracketLegal = maxBracket === 0 || !res.deckBracket || res.deckBracket <= maxBracket;
                const overallLegal = isSizeLegal && isBracketLegal;

                let updates = { deckPrice: res.total, isLegal: overallLegal, deckSize: res.deckSize, deckSalt: res.deckSalt, deckBracket: res.deckBracket };
                if (res.commanderArt) updates.image = res.commanderArt;

                const isNowReady = overallLegal && (maxDeckBudget === 0 || res.total <= maxDeckBudget);
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

    window.refreshAllPrices = async () => {
        playSound('sfx-click');
        if (!state.isHost) return showToast("Only the Host can bulk refresh decks.", true);

        const roomSnap = await get(ref(db, `rooms/${state.currentRoom}`));
        const roomData = roomSnap.val();
        if (!roomData || !roomData.players) return showToast("No players found.", true);

        const settings = roomData.settings;
        const updates = {};
        
        showToast("Recalculating all decks... This may take a moment.", false, 0);
        let updatedCount = 0;

        for (const [pId, pData] of Object.entries(roomData.players)) {
            if (pData.deck && pData.selected) {
                try {
                    const res = await fetchDeckPriceLocal(pData.deck, settings.currency || 'eur', settings.includeCmdr !== false, pData.selected);
                    if (res && !res.error) {
                        const maxDeckBudget = settings.deckBudget !== undefined ? parseFloat(settings.deckBudget) : 50;
                        const maxBracket = settings.maxBracket !== undefined ? parseFloat(settings.maxBracket) : 0;
                        const isSizeLegal = res.isLegal === true;
                        const isBracketLegal = maxBracket === 0 || !res.deckBracket || res.deckBracket <= maxBracket;
                        const overallLegal = isSizeLegal && isBracketLegal;

                        updates[`rooms/${state.currentRoom}/players/${pId}/deckPrice`] = res.total || 0;
                        updates[`rooms/${state.currentRoom}/players/${pId}/isLegal`] = overallLegal;
                        updates[`rooms/${state.currentRoom}/players/${pId}/deckSize`] = res.deckSize;
                        updates[`rooms/${state.currentRoom}/players/${pId}/deckSalt`] = res.deckSalt;
                        updates[`rooms/${state.currentRoom}/players/${pId}/deckBracket`] = res.deckBracket;
                        if (res.commanderArt) updates[`rooms/${state.currentRoom}/players/${pId}/image`] = res.commanderArt;

                        const isNowReady = overallLegal && (maxDeckBudget === 0 || (res.total || 0) <= maxDeckBudget);
                        if (isNowReady && pData.lockedDeckPrice === undefined) updates[`rooms/${state.currentRoom}/players/${pId}/lockedDeckPrice`] = res.total || 0;
                        
                        updatedCount++;
                    }
                } catch (err) { console.error("Failed to refresh for", pData.name, err); }
            }
        }

        if (Object.keys(updates).length > 0) { await update(ref(db), updates); showToast(`Successfully refreshed ${updatedCount} deck(s)!`, false, 3000, true); } 
        else { showToast("No valid decks found to refresh.", true); }
    };

    window.compareMyDeckWithCollection = async () => {
        playSound('sfx-click');
        const snap = await get(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`));
        const myData = snap.val();
        if (!myData || !myData.deck) return showToast("Please submit your deck URL first.", true);
        if (window.openCollectionTab) {
            window.openCollectionTab('deck', { preloadDeck: myData.deck });
            showToast("Transferred deck to Deck Comparator!", false, 3000, true);
        } else {
            showToast("Collection tool is loading...", true);
        }
    };

    window.upgradeMyDeckWithCollection = async () => {
        playSound('sfx-click');
        const snap = await get(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`));
        const myData = snap.val();
        if (!myData || !myData.deck) return showToast("Please submit your deck URL first.", true);
        if (window.openCollectionTab) {
            window.openCollectionTab('deck', { preloadDeck: myData.deck, openUpgrader: true });
            showToast("Transferred deck to AI Deck Upgrader!", false, 3000, true);
        } else {
            showToast("Collection tool is loading...", true);
        }
    };

    window.testMyDeckInPlaytester = async () => {
        playSound('sfx-click');
        const snap = await get(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`));
        const myData = snap.val();
        if (!myData) return showToast("Could not find your player profile.", true);

        const deckUrl = (myData.deck || '').trim();
        const commanderName = (myData.selected || '').trim();
        const deckName = `${myData.name || 'My'}'s ${commanderName || 'Commander'} Deck`;

        if (!deckUrl && !commanderName) {
            return showToast("Please draft a commander or submit a deck link first.", true);
        }

        showToast("Preparing deck for AI Battle Arena...", false, 2500);

        try {
            let deckContent = '';

            // Handle Moxfield
            if (deckUrl.toLowerCase().includes('moxfield.com')) {
                showToast("Extracting cards from Moxfield...", false, 2000);
                const data = await fetchDeckFromAPI(deckUrl);
                if (data && (data.mainboard || data.commanders)) {
                    const cmdrs = data.commanders ? Object.values(data.commanders) : [];
                    const mains = data.mainboard ? Object.values(data.mainboard) : [];
                    const companions = data.companions ? Object.values(data.companions) : [];
                    const cmdrLines = cmdrs.map(c => `${c.quantity || 1} ${c.card?.name || ''} *CMDR*`);
                    const mainLines = [...mains, ...companions].map(c => `${c.quantity || 1} ${c.card?.name || ''}`);
                    deckContent = [...cmdrLines, ...mainLines].join('\n');
                }
            } 
            // Handle Archidekt or raw text
            else if (deckUrl.toLowerCase().includes('archidekt.com')) {
                deckContent = deckUrl;
            } else if (deckUrl.length > 20 && deckUrl.includes('\n')) {
                deckContent = deckUrl;
            } else if (commanderName) {
                deckContent = `1 ${commanderName} *CMDR*`;
            }

            if (window.openPlaytester) {
                window.openPlaytester(deckName, deckContent, true);
                showToast("⚔️ Launching AI Battle Arena...", false, 3500, true);
            }
        } catch (err) {
            console.error("Test deck error:", err);
            // Fallback: pass whatever we have
            if (window.openPlaytester) {
                window.openPlaytester(deckName, deckUrl || (commanderName ? `1 ${commanderName} *CMDR*` : ''), true);
            }
        }
    };

    window.testPlayerDeckInPlaytester = async (targetPlayerId) => {
        playSound('sfx-click');
        const snap = await get(ref(db, `rooms/${state.currentRoom}/players/${targetPlayerId}`));
        const pData = snap.val();
        if (!pData) return showToast("Could not find player deck data.", true);

        const deckUrl = (pData.deck || '').trim();
        const commanderName = (pData.selected || '').trim();
        const deckName = `${pData.name || 'Player'}'s ${commanderName || 'Commander'} Deck`;

        showToast(`Loading ${pData.name || 'Player'}'s deck into Arena...`, false, 2500);

        try {
            let deckContent = '';
            if (deckUrl.toLowerCase().includes('moxfield.com')) {
                const data = await fetchDeckFromAPI(deckUrl);
                if (data && (data.mainboard || data.commanders)) {
                    const cmdrs = data.commanders ? Object.values(data.commanders) : [];
                    const mains = data.mainboard ? Object.values(data.mainboard) : [];
                    const companions = data.companions ? Object.values(data.companions) : [];
                    const cmdrLines = cmdrs.map(c => `${c.quantity || 1} ${c.card?.name || ''} *CMDR*`);
                    const mainLines = [...mains, ...companions].map(c => `${c.quantity || 1} ${c.card?.name || ''}`);
                    deckContent = [...cmdrLines, ...mainLines].join('\n');
                }
            } else if (deckUrl.toLowerCase().includes('archidekt.com')) {
                deckContent = deckUrl;
            } else if (deckUrl.length > 20 && deckUrl.includes('\n')) {
                deckContent = deckUrl;
            } else if (commanderName) {
                deckContent = `1 ${commanderName} *CMDR*`;
            }

            if (window.openPlaytester) {
                window.openPlaytester(deckName, deckContent, true);
                showToast("⚔️ Launching AI Battle Arena...", false, 3000, true);
            }
        } catch (err) {
            console.error("Test player deck error:", err);
            if (window.openPlaytester) {
                window.openPlaytester(deckName, deckUrl || (commanderName ? `1 ${commanderName} *CMDR*` : ''), true);
            }
        }
    };
}