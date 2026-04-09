// Helper to try multiple proxies if one fails
export async function fetchWithFallback(targetUrl) {
    const encoded = encodeURIComponent(targetUrl);
    const proxies = [
        `https://api.allorigins.win/raw?url=${encoded}&timestamp=${Date.now()}`, // Fast and reliable for Moxfield/Archidekt
        `https://api.codetabs.com/v1/proxy?quest=${encoded}`, // Fallbacks
        `https://corsproxy.io/?${encoded}`
    ];

    let lastError = null;
    for (const proxyUrl of proxies) {
        try {
            const res = await fetch(proxyUrl);
            if (res.ok) return await res.json();
            lastError = `Status ${res.status}`;
        } catch (e) {
            console.warn(`Proxy failed: ${proxyUrl}`, e);
            lastError = e.message;
        }
    }
    throw new Error(lastError || "All proxies failed");
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
        
        if (safeUrl.includes("archidekt.com")) {
            const archMatch = safeUrl.match(/decks\/(\d+)/);
            const deckId = archMatch ? archMatch[1] : null;
            if (!deckId) return { error: "Invalid Archidekt URL." };

            const data = await fetchWithFallback(`https://archidekt.com/api/decks/${deckId}/?t=${Date.now()}`);

            const commanderNameParts = selectedCommanderName ? selectedCommanderName.split(' // ') : [];
            
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

            let validCats = new Set();
            if (data.categories) data.categories.forEach(cat => { if (cat.includedInDeck) validCats.add(cat.name); });

            if (data.cards) {
                data.cards.forEach(item => {
                    let cardName = item.card?.oracleCard?.name || item.card?.name || "Unknown";
                    const isCommander = item.categories?.some(cat => ["commander", "commanders"].includes(cat.toLowerCase()));
                    if (!item.categories?.some(cat => validCats.has(cat))) return;

                    deckSize += (item.quantity || 1);
                    let cardSalt = parseFloat(item.card?.salt ?? item.card?.oracleCard?.salt ?? item.oracleCard?.salt ?? 0) || 0;
                    deckSalt += (cardSalt * (item.quantity || 1));

                    if (isCommander && !includeCommander) return;
                    if (basicLands.includes(cardName)) return;

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
            return { total: total, site: "Archidekt", isLegal: deckSize === 100, deckSize: deckSize, commanderArt: commanderArt, deckSalt: deckSalt };
        } else if (safeUrl.includes("moxfield.com")) {
            const moxMatch = safeUrl.match(/decks\/([a-zA-Z0-9_-]+)/);
            const deckId = moxMatch ? moxMatch[1] : null;
            if (!deckId) return { error: "Invalid Moxfield URL." };

            const data = await fetchWithFallback(`https://api.moxfield.com/v2/decks/all/${deckId}?t=${Date.now()}`);
            const commanderNameParts = selectedCommanderName ? selectedCommanderName.split(' // ') : [];
            
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
                deckSize += (item.quantity || 1);
                deckSalt += ((parseFloat(item.card?.salt ?? 0) || 0) * (item.quantity || 1));
                if (item.board === 'commander' && !includeCommander) return;
                if (basicLands.includes(item.card?.name || "Unknown")) return;

                let isFoil = item.finish === "foil" || item.finish === "etched" || item.isFoil === true;
                let p = item.card?.prices;
                let price = 0;
                if (p) {
                    if (currency === 'eur') price = isFoil ? (parseFloat(p.eur_foil ?? p.eurFoil ?? 0) || parseFloat(p.eur ?? 0) || 0) : parseFloat(p.eur ?? 0) || 0;
                    else { let foil = parseFloat(p.usd_foil ?? p.usdFoil ?? 0) || 0; let etched = parseFloat(p.usd_etched ?? p.usdEtched ?? 0) || 0; if (item.finish === "etched" && etched > 0) foil = etched; price = isFoil ? (foil > 0 ? foil : parseFloat(p.usd ?? 0) || 0) : parseFloat(p.usd ?? 0) || 0; }
                }
                total += (price * (item.quantity || 1));
            });
            return { total: total, site: "Moxfield", isLegal: deckSize === 100, deckSize: deckSize, commanderArt: commanderArt, deckSalt: deckSalt };
        }
        return { error: "Unsupported site. Only Archidekt and Moxfield are supported for price calculation." };
    } catch (e) {
        return { error: "Client Error: " + e.message };
    }
}