import { functions } from './firebase-setup.js?v=0.12';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-functions.js";

async function fetchDeckFromAPI(deckUrl) {
    try {
        const getDeckPriceFn = httpsCallable(functions, 'getDeckPrice');
        const result = await getDeckPriceFn({ deckUrl });
        return result.data;
    } catch (error) {
        throw new Error(error.message || "Failed to call pricing function.");
    }
}

export async function fetchDeckPriceLocal(deckUrl, currency, includeCommander, selectedCommanderName) {
    includeCommander = (includeCommander === true || includeCommander === "true");
    if (!deckUrl) return { error: "No URL provided." };
    let safeUrl = deckUrl.startsWith('http') ? deckUrl : 'https://' + deckUrl;
    const basicLands = ["Plains", "Island", "Swamp", "Mountain", "Forest", "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp", "Snow-Covered Mountain", "Snow-Covered Forest", "Wastes"];

    try {
        let total = 0;
        let deckSize = 0;
        let deckSalt = 0;
        let commanderArt = null;
        let deckBracket = null; // This will hold the 1-10 power level from the deck site
        
        if (safeUrl.includes("archidekt.com")) {
            const data = await fetchDeckFromAPI(safeUrl);

            const commanderNameParts = selectedCommanderName ? selectedCommanderName.split(' // ') : [];

            // Archidekt has a built-in 'powerLevel' property in their API response
            if (data.powerLevel && !isNaN(parseFloat(data.powerLevel))) {
                deckBracket = parseFloat(data.powerLevel);
            }
            
            if (selectedCommanderName) {
                const lowerSelected = selectedCommanderName.toLowerCase().trim();
                const partsLower = commanderNameParts.map(p => p.toLowerCase().trim());

                const commanderInDeck = data.cards.some(item => {
                    const cardName = item.card?.oracleCard?.name || item.card?.name;
                    if (!cardName) return false;
                    const lowerC = cardName.toLowerCase().trim();
                    return lowerC === lowerSelected || partsLower.includes(lowerC);
                });

                if (!commanderInDeck) return { error: `Validation Failed: Commander "${selectedCommanderName}" not found in deck.` };

                try {
                    let cmdrItem = data.cards.find(item => {
                        const cName = item.card?.oracleCard?.name || item.card?.name;
                        if (!cName) return false;
                        const lowerC = cName.toLowerCase().trim();
                        const isTagged = item.categories?.some(cat => ['commander', 'commanders'].includes(cat.toLowerCase()));
                        return isTagged && (lowerC === lowerSelected || partsLower.includes(lowerC));
                    });

                    if (!cmdrItem) {
                        cmdrItem = data.cards.find(item => {
                            const cName = item.card?.oracleCard?.name || item.card?.name;
                            if (!cName) return false;
                            const lowerC = cName.toLowerCase().trim();
                            return lowerC === lowerSelected || partsLower.includes(lowerC);
                        });
                    }

                    if (cmdrItem && cmdrItem.card) {
                        const setCode = cmdrItem.card.edition?.editioncode;
                        const cn = cmdrItem.card.collectorNumber;
                        if (setCode && cn) {
                            const scryRes = await fetch(`https://api.scryfall.com/cards/${setCode.trim()}/${String(cn).trim()}`);
                            if (scryRes.ok) {
                                const scryData = await scryRes.json();
                                commanderArt = scryData.image_uris?.normal || scryData.card_faces?.[0]?.image_uris?.normal;
                            }
                        }
                        if (!commanderArt) commanderArt = cmdrItem.card.images?.normal || cmdrItem.card.card_faces?.[0]?.images?.normal || cmdrItem.card.oracleCard?.images?.normal;
                    }
                } catch (e) { console.error("Art lookup failed:", e); }
            }

            // --- Category & Deck Size Logic ---
            // Determine which cards are part of the main deck.
            const mainboardCategoryNames = new Set();
            const hasDefinedCategories = data.categories && data.categories.length > 0;

            if (hasDefinedCategories) {
                data.categories.forEach(cat => {
                    // The `includedInDeck` property is the source of truth from Archidekt's API.
                    if (cat.includedInDeck) {
                        mainboardCategoryNames.add(cat.name);
                    }
                });
            }

            if (data.cards) {
                data.cards.forEach(item => {
                    const cardCategories = item.categories || [];
                    let isMainboard = false;

                    if (!hasDefinedCategories || cardCategories.length === 0) {
                        // If no categories are defined for the deck, OR if this specific card is uncategorized,
                        // Archidekt considers it part of the main deck.
                        isMainboard = true;
                    } else {
                        // If the card has categories, check if any of them are valid mainboard categories.
                        isMainboard = cardCategories.some(catName => mainboardCategoryNames.has(catName));
                    }

                    if (!isMainboard) return; // Skip card if it's not in the main deck (e.g., sideboard, maybeboard).

                    let cardName = item.card?.oracleCard?.name || item.card?.name || "Unknown";
                    const isCommander = item.categories?.some(cat => ["commander", "commanders"].includes(cat.toLowerCase()));

                    const qty = parseInt(item.quantity || 1, 10);
                    deckSize += qty;
                    let cardSalt = parseFloat(item.card?.salt ?? item.card?.oracleCard?.salt ?? item.oracleCard?.salt ?? 0) || 0;
                    deckSalt += (cardSalt * qty);

                    if (isCommander && !includeCommander) return;
                    if (basicLands.includes(cardName)) return; // Excludes basic lands from PRICE, but keeps them in deckSize

                    let isFoil = item.isFoil === true || String(item.modifier || "").toLowerCase().includes("foil");
                    let p = item.card?.prices;
                    let price = 0;
                    if (p) {
                        if (currency === 'eur') price = isFoil ? (parseFloat(p.cmfoil ?? p.cm_foil ?? p.cmFoil ?? 0) || parseFloat(p.cm ?? p.cardmarket ?? p.eur ?? 0) || 0) : parseFloat(p.cm ?? p.cardmarket ?? p.eur ?? 0) || 0;
                        else price = isFoil ? (parseFloat(p.tcgFoil ?? p.tcg_foil ?? 0) || parseFloat(p.tcg ?? p.ck ?? p.usd ?? 0) || 0) : parseFloat(p.tcg ?? p.ck ?? p.usd ?? 0) || 0;
                    }
                    total += (price * (item.quantity || 1));
                });
            }
            return { total: total, site: "Archidekt", isLegal: deckSize >= 98 && deckSize <= 101, deckSize: deckSize, commanderArt: commanderArt, deckSalt: deckSalt, deckBracket: deckBracket };
        } else if (safeUrl.includes("moxfield.com")) {
            const data = await fetchDeckFromAPI(safeUrl);
            const commanderNameParts = selectedCommanderName ? selectedCommanderName.split(' // ') : [];

            // Moxfield has a built-in 'powerLevel' property in their API response
            if (data.powerLevel && !isNaN(parseFloat(data.powerLevel))) {
                deckBracket = parseFloat(data.powerLevel);
            }
            
            let allCards = [];
            if (data.mainboard) allCards.push(...Object.values(data.mainboard).map(c => ({...c, board: 'mainboard'})));
            if (data.commanders) allCards.push(...Object.values(data.commanders).map(c => ({...c, board: 'commander'})));
            if (data.companions) allCards.push(...Object.values(data.companions).map(c => ({...c, board: 'companion'})));

            if (selectedCommanderName) {
                const lowerSelected = selectedCommanderName.toLowerCase().trim();
                const partsLower = commanderNameParts.map(p => p.toLowerCase().trim());
                const commanderInDeck = allCards.some(item => (item.card?.name?.toLowerCase().trim() === lowerSelected || partsLower.includes(item.card?.name?.toLowerCase().trim())));
                if (!commanderInDeck) return { error: `Validation Failed: Commander "${selectedCommanderName}" not found in deck.` };

                try {
                    let cmdrItem = allCards.find(item => item.board === 'commander' && (item.card?.name?.toLowerCase().trim() === lowerSelected || partsLower.includes(item.card?.name?.toLowerCase().trim()))) || allCards.find(item => item.card?.name?.toLowerCase().trim() === lowerSelected || partsLower.includes(item.card?.name?.toLowerCase().trim()));
                    if (cmdrItem && cmdrItem.card) {
                        if (cmdrItem.card.scryfall_id) { const scryRes = await fetch(`https://api.scryfall.com/cards/${cmdrItem.card.scryfall_id}`); if (scryRes.ok) { const scryData = await scryRes.json(); commanderArt = scryData.image_uris?.normal || scryData.card_faces?.[0]?.image_uris?.normal; } }
                        if (!commanderArt && cmdrItem.card.set && cmdrItem.card.cn) { const scryRes = await fetch(`https://api.scryfall.com/cards/${cmdrItem.card.set}/${cmdrItem.card.cn}`); if (scryRes.ok) { const scryData = await scryRes.json(); commanderArt = scryData.image_uris?.normal || scryData.card_faces?.[0]?.image_uris?.normal; } }
                    }
                } catch (e) { console.error("Art lookup failed:", e); }
            }

            allCards.forEach(item => {
                const qty = parseInt(item.quantity || 1, 10);
                deckSize += qty;
                deckSalt += ((parseFloat(item.card?.salt ?? 0) || 0) * qty);
                if (item.board === 'commander' && !includeCommander) return;
                if (basicLands.includes(item.card?.name || "Unknown")) return; // Excludes basic lands from PRICE

                let isFoil = item.finish === "foil" || item.finish === "etched" || item.isFoil === true;
                let p = item.card?.prices;
                let price = 0;
                if (p) {
                    if (currency === 'eur') price = isFoil ? (parseFloat(p.eur_foil ?? p.eurFoil ?? 0) || parseFloat(p.eur ?? 0) || 0) : parseFloat(p.eur ?? 0) || 0;
                    else { let foil = parseFloat(p.usd_foil ?? p.usdFoil ?? 0) || 0; let etched = parseFloat(p.usd_etched ?? p.usdEtched ?? 0) || 0; if (item.finish === "etched" && etched > 0) foil = etched; price = isFoil ? (foil > 0 ? foil : parseFloat(p.usd ?? 0) || 0) : parseFloat(p.usd ?? 0) || 0; }
                }
                total += (price * (item.quantity || 1));
            });
            return { total: total, site: "Moxfield", isLegal: deckSize >= 98 && deckSize <= 101, deckSize: deckSize, commanderArt: commanderArt, deckSalt: deckSalt, deckBracket: deckBracket };
        }
        return { error: "Unsupported site. Only Archidekt and Moxfield are supported for price calculation." };
    } catch (e) {
        return { error: "Client Error: " + e.message };
    }
}