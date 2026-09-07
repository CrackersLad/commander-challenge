const { normalizeCardName } = require("./parsers.js");
const { fetchWithRetry, DEFAULT_HEADERS } = require("./http.js");

const TOP_COMMANDER_STAPLES = [
    "Sol Ring",
    "Arcane Signet",
    "Command Tower",
    "Swords to Plowshares",
    "Rhystic Study",
    "Demonic Tutor",
    "Cyclonic Rift",
    "Cultivate",
    "Lightning Greaves",
    "Smothering Tithe",
    "Heroic Intervention",
    "Counterspell",
    "Vampiric Tutor",
    "Teferi's Protection",
    "Fierce Guardianship",
    "Deflecting Swat",
    "Toxic Deluge",
    "Esper Sentinel",
    "The One Ring",
    "Fellwar Stone"
];

/**
 * Normalizes set codes.
 */
function cleanSet(code) {
    if (!code) return "";
    return code.toString().trim().toLowerCase();
}

/**
 * Computes deep collection analytics and insights.
 */
async function computeCollectionInsights(rawItems = [], options = {}) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return {
            summary: {
                uniqueCards: 0,
                totalCopies: 0,
                totalValueUsd: 0,
                totalValueEur: 0,
                inDecksCopies: 0,
                availableCopies: 0
            },
            crownJewels: [],
            colorDistribution: {},
            typeDistribution: {},
            rarityDistribution: {},
            priceBrackets: {},
            staples: []
        };
    }

    const cardMap = new Map(); // cleanName -> card data
    let totalCopies = 0;
    let inDecksCopies = 0;

    // Check if items are CSV items that need basic Scryfall price enrichment
    const needsBatchEnrichment = rawItems.some(item => {
        const cardInfo = item.card || item || {};
        const p = cardInfo.prices || item.prices;
        return !p || (typeof p.tcg === "undefined" && typeof p.usd === "undefined" && typeof p.ck === "undefined");
    });

    const enrichedPricesMap = new Map(); // cleanName -> { usd, eur, rarity, type_line, colors, image_url }
    if (needsBatchEnrichment) {
        // Collect distinct card names (limit to first 300 to keep it fast)
        const uniqueNames = [];
        const seen = new Set();
        for (const it of rawItems) {
            const rawName = it.name || it.card?.name || it.card?.oracleCard?.name;
            if (rawName && !seen.has(rawName)) {
                seen.add(rawName);
                uniqueNames.push(rawName);
            }
        }

        const batchSize = 75;
        const toFetch = uniqueNames.slice(0, 300);
        for (let i = 0; i < toFetch.length; i += batchSize) {
            const batch = toFetch.slice(i, i + batchSize);
            try {
                const res = await fetchWithRetry("https://api.scryfall.com/cards/collection", {
                    method: "POST",
                    headers: {
                        ...DEFAULT_HEADERS,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        identifiers: batch.map(name => ({ name }))
                    }),
                    timeoutMs: 8000
                }, 2);

                if (res.ok) {
                    const data = await res.json();
                    for (const sc of (data.data || [])) {
                        const cName = normalizeCardName(sc.name);
                        const usd = parseFloat(sc.prices?.usd || sc.prices?.usd_foil || "0") || 0;
                        const eur = parseFloat(sc.prices?.eur || sc.prices?.eur_foil || "0") || 0;
                        const img = sc.image_uris?.normal || sc.image_uris?.small || (sc.card_faces ? sc.card_faces[0]?.image_uris?.normal : "") || "";
                        enrichedPricesMap.set(cName, {
                            usd,
                            eur,
                            rarity: (sc.rarity || "common").toLowerCase(),
                            type_line: sc.type_line || "",
                            colors: sc.colors || (sc.card_faces ? sc.card_faces.flatMap(f => f.colors || []) : []),
                            image_url: img,
                            set: sc.set ? sc.set.toUpperCase() : ""
                        });
                    }
                }
            } catch (err) {
                console.warn("[WARN] Scryfall collection enrichment batch failed:", err.message);
            }
            if (i + batchSize < toFetch.length) {
                await new Promise(r => setTimeout(r, 80));
            }
        }
    }

    for (const item of rawItems) {
        const cardInfo = item.card || item || {};
        const oracleData = cardInfo.oracleCard || cardInfo;
        const rawName = oracleData.name || cardInfo.name || item.name || cardInfo.parts?.find(p => p.name)?.name;
        if (!rawName) continue;

        const cleanName = normalizeCardName(rawName);
        const quantity = Math.max(1, parseInt(item.quantity || item.count) || 1);
        const inDecks = Math.max(0, parseInt(item.inDecks || item.in_decks || cardInfo.inDecks || cardInfo.in_decks || 0) || 0);

        totalCopies += quantity;
        inDecksCopies += inDecks;

        const setCode = cleanSet(
            cardInfo.edition?.editioncode ||
            cardInfo.edition?.code ||
            item.edition?.editioncode ||
            item.edition?.code ||
            cardInfo.set ||
            cardInfo.setCode ||
            cardInfo.set_code ||
            item.set ||
            item.setCode ||
            item.set_code ||
            ""
        ).toUpperCase();

        const collectorNumber = (cardInfo.collectorNumber || cardInfo.collector_number || item.collectorNumber || item.collector_number || item.number || "").toString().trim();

        // Detect finish / modifier
        const rawMod = item.modifier || item.finish || cardInfo.modifier || cardInfo.finish || "";
        const rawFoil = Boolean(item.foil || cardInfo.foil);
        let finish = "Normal";
        const mLower = String(rawMod).toLowerCase();
        if (mLower.includes("surge")) finish = "Surge Foil";
        else if (mLower.includes("etched")) finish = "Etched";
        else if (mLower.includes("confetti")) finish = "Confetti Foil";
        else if (mLower.includes("textured")) finish = "Textured Foil";
        else if (mLower.includes("halo")) finish = "Halo Foil";
        else if (mLower.includes("rainbow")) finish = "Rainbow Foil";
        else if (mLower.includes("galaxy")) finish = "Galaxy Foil";
        else if (mLower.includes("foil") || rawFoil) finish = "Foil";

        const isFoil = finish !== "Normal";

        const rarity = (
            cardInfo.rarity ||
            oracleData.rarity ||
            item.rarity ||
            enrichedPricesMap.get(cleanName)?.rarity ||
            "common"
        ).toLowerCase();

        // Price extraction
        const prices = cardInfo.prices || item.prices || {};
        let usdPrice = 0;
        let usdFoilPrice = 0;
        let eurPrice = 0;
        let eurFoilPrice = 0;

        if (prices.tcg || prices.ck || prices.scg || prices.cardTrader) {
            usdPrice = parseFloat(prices.tcg || prices.ck || prices.scg || prices.cardTrader || 0) || 0;
            usdFoilPrice = parseFloat(prices.tcgfoil || prices.ckfoil || (usdPrice * 1.6) || 0) || usdPrice;
            eurPrice = parseFloat(prices.cm || (usdPrice * 0.92) || 0) || 0;
            eurFoilPrice = parseFloat(prices.cmfoil || (usdFoilPrice * 0.92) || 0) || eurPrice;
        } else if (prices.usd || prices.usd_foil) {
            usdPrice = parseFloat(prices.usd || 0) || 0;
            usdFoilPrice = parseFloat(prices.usd_foil || usdPrice || 0) || 0;
            eurPrice = parseFloat(prices.eur || (usdPrice * 0.92) || 0) || 0;
            eurFoilPrice = parseFloat(prices.eur_foil || (usdFoilPrice * 0.92) || 0) || eurPrice;
        } else if (enrichedPricesMap.has(cleanName)) {
            const enriched = enrichedPricesMap.get(cleanName);
            usdPrice = enriched.usd;
            usdFoilPrice = enriched.usd_foil || usdPrice;
            eurPrice = enriched.eur;
            eurFoilPrice = enriched.eur_foil || eurPrice;
        }

        // Use foil pricing if the card is a foil / surge foil
        const effectiveUsd = isFoil ? (usdFoilPrice || usdPrice) : usdPrice;
        const effectiveEur = isFoil ? (eurFoilPrice || eurPrice) : eurPrice;

        // Type line
        let typeLine = (
            oracleData.type_line ||
            cardInfo.type_line ||
            item.type_line ||
            enrichedPricesMap.get(cleanName)?.type_line ||
            ""
        ).toLowerCase();

        if (!typeLine && oracleData.types) {
            const allTypes = [...(oracleData.superTypes || []), ...(oracleData.types || [])];
            typeLine = allTypes.join(" ").toLowerCase();
        }

        // Colors
        let colors = oracleData.colors || oracleData.colorIdentity || cardInfo.colors || item.colors || enrichedPricesMap.get(cleanName)?.colors || [];
        if (!Array.isArray(colors)) colors = [];

        // Image URL for the specific print version
        let imageUrl = cardInfo.images?.normal || cardInfo.scryfall_image || item.image_url || "";
        if (!imageUrl && setCode && collectorNumber) {
            imageUrl = `https://api.scryfall.com/cards/${setCode.toLowerCase()}/${collectorNumber}?format=image`;
        }
        if (!imageUrl) {
            imageUrl = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(rawName)}&format=image`;
        }

        const distinctKey = `${cleanName}:${setCode}:${collectorNumber}:${finish}`;
        if (!cardMap.has(distinctKey)) {
            cardMap.set(distinctKey, {
                name: rawName,
                cleanName,
                quantity: 0,
                inDecks: 0,
                unitPriceUsd: effectiveUsd,
                unitPriceEur: effectiveEur,
                finish,
                isFoil,
                rarity,
                typeLine,
                colors,
                setCode: setCode || enrichedPricesMap.get(cleanName)?.set || "",
                imageUrl,
                collectorNumber,
                prices: {
                    usd: usdPrice,
                    usd_foil: usdFoilPrice,
                    eur: eurPrice,
                    eur_foil: eurFoilPrice,
                    ck: prices.ck || usdPrice,
                    ck_foil: prices.ckfoil || usdFoilPrice
                }
            });
        }

        const entry = cardMap.get(distinctKey);
        entry.quantity += quantity;
        entry.inDecks += inDecks;
    }

    const uniqueCards = new Set(Array.from(cardMap.values()).map(c => c.cleanName)).size;
    const availableCopies = Math.max(0, totalCopies - inDecksCopies);

    let totalValueUsd = 0;
    let totalValueEur = 0;

    const rarityDist = {
        mythic: { count: 0, copies: 0, valueUsd: 0 },
        rare: { count: 0, copies: 0, valueUsd: 0 },
        uncommon: { count: 0, copies: 0, valueUsd: 0 },
        common: { count: 0, copies: 0, valueUsd: 0 }
    };

    const colorDist = {
        W: { name: "White", count: 0, copies: 0 },
        U: { name: "Blue", count: 0, copies: 0 },
        B: { name: "Black", count: 0, copies: 0 },
        R: { name: "Red", count: 0, copies: 0 },
        G: { name: "Green", count: 0, copies: 0 },
        multi: { name: "Multicolor", count: 0, copies: 0 },
        colorless: { name: "Colorless", count: 0, copies: 0 },
        land: { name: "Lands", count: 0, copies: 0 }
    };

    const typeDist = {
        creatures: { name: "Creatures", count: 0, copies: 0 },
        instants: { name: "Instants", count: 0, copies: 0 },
        sorceries: { name: "Sorceries", count: 0, copies: 0 },
        artifacts: { name: "Artifacts", count: 0, copies: 0 },
        enchantments: { name: "Enchantments", count: 0, copies: 0 },
        planeswalkers: { name: "Planeswalkers", count: 0, copies: 0 },
        lands: { name: "Lands", count: 0, copies: 0 },
        battles: { name: "Battles", count: 0, copies: 0 }
    };

    const priceBrackets = {
        under1: { label: "< $1", count: 0, copies: 0 },
        oneToFive: { label: "$1 – $5", count: 0, copies: 0 },
        fiveToTwenty: { label: "$5 – $20", count: 0, copies: 0 },
        twentyToFifty: { label: "$20 – $50", count: 0, copies: 0 },
        fiftyPlus: { label: "$50+", count: 0, copies: 0 }
    };

    const allCardsArray = Array.from(cardMap.values());

    for (const card of allCardsArray) {
        const itemValUsd = card.unitPriceUsd * card.quantity;
        const itemValEur = card.unitPriceEur * card.quantity;
        totalValueUsd += itemValUsd;
        totalValueEur += itemValEur;

        // Rarity
        const rKey = rarityDist[card.rarity] ? card.rarity : "common";
        rarityDist[rKey].count++;
        rarityDist[rKey].copies += card.quantity;
        rarityDist[rKey].valueUsd += itemValUsd;

        // Type
        const t = card.typeLine;
        if (t.includes("creature")) {
            typeDist.creatures.count++;
            typeDist.creatures.copies += card.quantity;
        } else if (t.includes("instant")) {
            typeDist.instants.count++;
            typeDist.instants.copies += card.quantity;
        } else if (t.includes("sorcery")) {
            typeDist.sorceries.count++;
            typeDist.sorceries.copies += card.quantity;
        } else if (t.includes("artifact")) {
            typeDist.artifacts.count++;
            typeDist.artifacts.copies += card.quantity;
        } else if (t.includes("enchantment")) {
            typeDist.enchantments.count++;
            typeDist.enchantments.copies += card.quantity;
        } else if (t.includes("planeswalker")) {
            typeDist.planeswalkers.count++;
            typeDist.planeswalkers.copies += card.quantity;
        } else if (t.includes("land")) {
            typeDist.lands.count++;
            typeDist.lands.copies += card.quantity;
        } else if (t.includes("battle")) {
            typeDist.battles.count++;
            typeDist.battles.copies += card.quantity;
        }

        // Color
        if (t.includes("land")) {
            colorDist.land.count++;
            colorDist.land.copies += card.quantity;
        } else if (card.colors.length > 1) {
            colorDist.multi.count++;
            colorDist.multi.copies += card.quantity;
        } else if (card.colors.length === 1 && colorDist[card.colors[0]]) {
            colorDist[card.colors[0]].count++;
            colorDist[card.colors[0]].copies += card.quantity;
        } else {
            colorDist.colorless.count++;
            colorDist.colorless.copies += card.quantity;
        }

        // Price bracket
        const p = card.unitPriceUsd;
        if (p < 1) {
            priceBrackets.under1.count++;
            priceBrackets.under1.copies += card.quantity;
        } else if (p < 5) {
            priceBrackets.oneToFive.count++;
            priceBrackets.oneToFive.copies += card.quantity;
        } else if (p < 20) {
            priceBrackets.fiveToTwenty.count++;
            priceBrackets.fiveToTwenty.copies += card.quantity;
        } else if (p < 50) {
            priceBrackets.twentyToFifty.count++;
            priceBrackets.twentyToFifty.copies += card.quantity;
        } else {
            priceBrackets.fiftyPlus.count++;
            priceBrackets.fiftyPlus.copies += card.quantity;
        }
    }

    // Sort crown jewels by price descending
    allCardsArray.sort((a, b) => b.unitPriceUsd - a.unitPriceUsd);
    const crownJewels = allCardsArray.slice(0, 12).map(c => ({
        name: c.name,
        cleanName: c.cleanName,
        quantity: c.quantity,
        inDecks: c.inDecks,
        available: Math.max(0, c.quantity - c.inDecks),
        priceUsd: parseFloat(c.unitPriceUsd.toFixed(2)),
        priceEur: parseFloat(c.unitPriceEur.toFixed(2)),
        prices: c.prices,
        finish: c.finish,
        isFoil: c.isFoil,
        collectorNumber: c.collectorNumber,
        totalUsd: parseFloat((c.unitPriceUsd * c.quantity).toFixed(2)),
        rarity: c.rarity,
        setCode: c.setCode,
        typeLine: c.typeLine,
        imageUrl: c.imageUrl
    }));

    // Commander Staples Check
    const staplesCheck = TOP_COMMANDER_STAPLES.map(stapleName => {
        const clean = normalizeCardName(stapleName);
        const stapleCopies = allCardsArray.filter(c => c.cleanName === clean);
        const totalOwned = stapleCopies.reduce((sum, c) => sum + (c.quantity || 1), 0);
        const totalInDecks = stapleCopies.reduce((sum, c) => sum + (c.inDecks || 0), 0);
        const sample = stapleCopies[0];

        return {
            name: stapleName,
            owned: totalOwned,
            inDecks: totalInDecks,
            available: Math.max(0, totalOwned - totalInDecks),
            priceUsd: sample ? parseFloat(sample.unitPriceUsd.toFixed(2)) : 0,
            prices: sample ? sample.prices : null,
            finish: sample ? sample.finish : "Normal",
            isOwned: totalOwned > 0
        };
    });

    const ownedStaplesCount = staplesCheck.filter(s => s.isOwned).length;

    return {
        summary: {
            uniqueCards,
            totalCopies,
            totalValueUsd: parseFloat(totalValueUsd.toFixed(2)),
            totalValueEur: parseFloat(totalValueEur.toFixed(2)),
            inDecksCopies,
            availableCopies,
            ownedStaplesCount,
            totalStaplesTracked: TOP_COMMANDER_STAPLES.length
        },
        crownJewels,
        colorDistribution: colorDist,
        typeDistribution: typeDist,
        rarityDistribution: rarityDist,
        priceBrackets,
        staples: staplesCheck
    };
}

module.exports = {
    computeCollectionInsights,
    TOP_COMMANDER_STAPLES
};
