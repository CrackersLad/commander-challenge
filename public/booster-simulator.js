// Booster Pack & Booster Box Simulator Module
// Real-time market pricing (TCGplayer USD, Cardmarket EUR, MTGO TIX)
// Realistic pack collation, foils, showcase variants, and profit/loss analytics

let setCache = new Map(); // setCode -> { cards, rarities, info }
let currentSimulation = null;
let currentSortMode = 'price-desc'; // 'price-desc', 'price-asc', 'rarity', 'pack'
let currentFilter = 'all'; // 'all', 'hits', 'mythic', 'rare', 'foil'

export function initBoosterSimulatorModule(utils, state) {
    window.openBoosterSimulator = (defaultSet = 'dsk') => {
        if (utils.playSound) utils.playSound('sfx-click');
        utils.switchView('view-booster-simulator');
        setupSimulatorUI(defaultSet, utils);
    };

    // Global listener for hash-based navigation
    if (window.location.hash === '#view-booster-simulator' || window.location.hash === '#booster-simulator') {
        setTimeout(() => window.openBoosterSimulator(), 100);
    }
}

// Preset benchmark market prices for MTG sets
function getEstimatedMarketPrices(setObj, isBox, market = 'usd', packEdition = 'play') {
    const code = (setObj?.code || '').toLowerCase();
    const type = setObj?.set_type || 'expansion';
    const isCollector = packEdition === 'collector';
    
    // Check if modern horizons or masters
    const isHorizons = code.startsWith('mh') || code === 'ltr' || code === 'inr';
    const isMasters = type === 'masters' || code === '2x2' || code === '2xm' || code === 'cmm' || code === 'uma' || code === 'ema';
    
    let defaultPackUsd = 4.99;
    let defaultBoxUsd = 139.99;
    let packsPerBox = 36;

    if (isCollector) {
        packsPerBox = 12; // Collector boxes always contain 12 packs
        if (isHorizons || isMasters) {
            defaultPackUsd = 39.99;
            defaultBoxUsd = 399.99;
        } else {
            defaultPackUsd = 24.99;
            defaultBoxUsd = 269.99;
        }
    } else {
        if (isMasters) {
            defaultPackUsd = 11.99;
            defaultBoxUsd = 279.99;
            packsPerBox = 24;
        } else if (isHorizons) {
            defaultPackUsd = 8.99;
            defaultBoxUsd = 249.99;
            packsPerBox = 36;
        } else if (type === 'commander' || code === 'cmr' || code === 'clb') {
            defaultPackUsd = 5.99;
            defaultBoxUsd = 149.99;
            packsPerBox = 24;
        }
    }

    // Convert to target currency
    let packPrice = defaultPackUsd;
    let boxPrice = defaultBoxUsd;

    if (market === 'eur') {
        packPrice = +(defaultPackUsd * 0.92).toFixed(2);
        boxPrice = +(defaultBoxUsd * 0.92).toFixed(2);
    } else if (market === 'tix') {
        packPrice = +(defaultPackUsd * 0.85).toFixed(2);
        boxPrice = +(defaultBoxUsd * 0.82).toFixed(2);
    }

    return {
        packCost: packPrice,
        boxCost: boxPrice,
        packsPerBox: packsPerBox,
        currentCost: isBox ? boxPrice : packPrice
    };
}

function getCurrencySymbol(market) {
    if (market === 'eur') return '€';
    if (market === 'tix') return 'TIX ';
    return '$';
}

export function formatCurrency(amount, market) {
    const symbol = getCurrencySymbol(market);
    return `${symbol}${Number(amount || 0).toFixed(2)}`;
}

// Fetch all booster-eligible cards and variants from Scryfall
export async function fetchSetBoosterCards(setCode) {
    const code = setCode.toLowerCase();
    if (setCache.has(code)) {
        return setCache.get(code);
    }

    // First try: query is:booster with unique=prints for full variant coverage
    let cards = [];
    let queryUrl = `https://api.scryfall.com/cards/search?q=set%3A${code}+is%3Abooster&unique=prints`;

    try {
        let res = await fetch(queryUrl, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) {
            // Fallback to all prints of set if is:booster isn't indexed
            queryUrl = `https://api.scryfall.com/cards/search?q=set%3A${code}&unique=prints`;
            res = await fetch(queryUrl, { headers: { 'Accept': 'application/json' } });
        }

        if (res.ok) {
            let json = await res.json();
            cards.push(...(json.data || []));

            // Follow pagination if needed (usually 1-3 pages for a full set)
            let pagesFetched = 1;
            while (json.has_more && json.next_page && pagesFetched < 4) {
                const nextRes = await fetch(json.next_page, { headers: { 'Accept': 'application/json' } });
                if (!nextRes.ok) break;
                json = await nextRes.json();
                cards.push(...(json.data || []));
                pagesFetched++;
            }
        }
    } catch (err) {
        console.error("Failed to fetch booster cards for", setCode, err);
    }

    if (cards.length === 0) {
        throw new Error(`Could not load cards for set "${setCode.toUpperCase()}". Check your internet connection or try another set.`);
    }

    // Partition cards into realistic collation pools
    const commons = [];
    const uncommons = [];
    const rares = [];
    const mythics = [];
    const basics = [];
    const showcases = [];

    cards.forEach(card => {
        const typeLine = (card.type_line || '').toLowerCase();
        const isBasicLand = typeLine.includes('basic land');
        const isShowcase = (card.frame_effects && (card.frame_effects.includes('showcase') || card.frame_effects.includes('inverted'))) ||
                            (card.promo_types && card.promo_types.includes('boosterfun')) ||
                            (card.border_color === 'borderless');

        if (isShowcase) {
            showcases.push(card);
        } else if (isBasicLand) {
            basics.push(card);
        } else if (card.rarity === 'mythic') {
            mythics.push(card);
        } else if (card.rarity === 'rare') {
            rares.push(card);
        } else if (card.rarity === 'uncommon') {
            uncommons.push(card);
        } else {
            commons.push(card);
        }
    });

    const setPayload = {
        code,
        totalCards: cards.length,
        commons: commons.length > 0 ? commons : cards,
        uncommons: uncommons.length > 0 ? uncommons : cards,
        rares: rares.length > 0 ? rares : cards,
        mythics: mythics.length > 0 ? mythics : (rares.length > 0 ? rares : cards),
        basics: basics.length > 0 ? basics : commons,
        showcases: showcases
    };

    setCache.set(code, setPayload);
    return setPayload;
}

// Generate realistic booster pack
export function generateBoosterPack(setData, packNumber = 1) {
    const packCards = [];
    const isMasters = setData.code.startsWith('mh') || ['2x2', '2xm', 'cmm', 'uma', 'ema'].includes(setData.code);
    const hasDoubleRare = ['2x2', '2xm'].includes(setData.code);

    const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // 1. Commons (6 regular commons, unique)
    const usedIds = new Set();
    let commonAttempts = 0;
    while (packCards.length < 6 && commonAttempts < 50) {
        commonAttempts++;
        const c = pickRandom(setData.commons);
        if (c && !usedIds.has(c.id)) {
            usedIds.add(c.id);
            packCards.push(createPackCard(c, false, packNumber));
        }
    }

    // 2. Slot 7: 7th common or bonus sheet
    const bonusRoll = Math.random();
    if (bonusRoll < 0.05 && setData.showcases.length > 0) {
        const showcaseCard = pickRandom(setData.showcases);
        packCards.push(createPackCard(showcaseCard, false, packNumber, 'Showcase'));
    } else {
        const c = pickRandom(setData.commons);
        packCards.push(createPackCard(c, false, packNumber));
    }

    // 3. Uncommons (3 uncommons, unique)
    let uncCount = 0;
    let uncAttempts = 0;
    while (uncCount < 3 && uncAttempts < 50) {
        uncAttempts++;
        const u = pickRandom(setData.uncommons);
        if (u && !usedIds.has(u.id)) {
            usedIds.add(u.id);
            packCards.push(createPackCard(u, false, packNumber));
            uncCount++;
        }
    }

    // 4. Rare / Mythic Rare Slot (1 in 7 packs is Mythic: ~14.3%)
    const isMythic = Math.random() < 0.143;
    const rarePool = isMythic ? setData.mythics : setData.rares;
    let rareCard = pickRandom(rarePool);

    // Chance of showcase / borderless variant
    if (Math.random() < 0.18 && setData.showcases.length > 0) {
        const matchingShowcase = setData.showcases.find(s => s.name === rareCard.name);
        if (matchingShowcase) {
            rareCard = matchingShowcase;
        }
    }
    packCards.push(createPackCard(rareCard, false, packNumber, isMythic ? 'Mythic Hit' : 'Rare Hit'));

    // Double Masters has 2nd guaranteed Rare/Mythic
    if (hasDoubleRare) {
        const isMythic2 = Math.random() < 0.143;
        const rareCard2 = pickRandom(isMythic2 ? setData.mythics : setData.rares);
        packCards.push(createPackCard(rareCard2, false, packNumber, 'Bonus Rare Hit'));
    }

    // 5. Wildcard Slot (any rarity, realistic weighting)
    const wildcardRoll = Math.random();
    let wildcardCard;
    if (wildcardRoll < 0.40) {
        wildcardCard = pickRandom(setData.commons);
    } else if (wildcardRoll < 0.75) {
        wildcardCard = pickRandom(setData.uncommons);
    } else if (wildcardRoll < 0.95) {
        wildcardCard = pickRandom(setData.rares);
    } else {
        wildcardCard = pickRandom(setData.mythics);
    }
    packCards.push(createPackCard(wildcardCard, false, packNumber, 'Wildcard'));

    // 6. Traditional Foil Slot (guaranteed 1 foil in Play Boosters / modern packs)
    const foilRoll = Math.random();
    let foilCard;
    if (foilRoll < 0.65) {
        foilCard = pickRandom(setData.commons);
    } else if (foilRoll < 0.90) {
        foilCard = pickRandom(setData.uncommons);
    } else if (foilRoll < 0.98) {
        foilCard = pickRandom(setData.rares);
    } else {
        foilCard = pickRandom(setData.mythics);
    }
    packCards.push(createPackCard(foilCard, true, packNumber, 'Traditional Foil'));

    // 7. Basic Land Slot (with 20% foil chance)
    if (setData.basics.length > 0) {
        const landCard = pickRandom(setData.basics);
        const landFoil = Math.random() < 0.20;
        packCards.push(createPackCard(landCard, landFoil, packNumber, landFoil ? 'Foil Land' : 'Basic Land'));
    }

    return packCards;
}

// Generate authentic Collector Booster pack (15 cards, high foil & showcase density)
export function generateCollectorBoosterPack(setData, packNumber = 1) {
    const packCards = [];
    const pickRandom = (arr) => (arr && arr.length > 0) ? arr[Math.floor(Math.random() * arr.length)] : null;
    const usedIds = new Set();

    // 1. 5 Traditional Foil Commons (unique)
    let commonCount = 0;
    let commonAttempts = 0;
    while (commonCount < 5 && commonAttempts < 50) {
        commonAttempts++;
        const c = pickRandom(setData.commons);
        if (c && !usedIds.has(c.id)) {
            usedIds.add(c.id);
            packCards.push(createPackCard(c, true, packNumber, 'Foil Common'));
            commonCount++;
        }
    }

    // 2. 2 Traditional Foil Uncommons (unique)
    let uncCount = 0;
    let uncAttempts = 0;
    while (uncCount < 2 && uncAttempts < 50) {
        uncAttempts++;
        const u = pickRandom(setData.uncommons);
        if (u && !usedIds.has(u.id)) {
            usedIds.add(u.id);
            packCards.push(createPackCard(u, true, packNumber, 'Foil Uncommon'));
            uncCount++;
        }
    }

    // 3. 1 Traditional Foil Showcase or Borderless Common/Uncommon
    const showcaseCommonUnc = setData.showcases.filter(c => c.rarity === 'common' || c.rarity === 'uncommon');
    const showcaseAlt = showcaseCommonUnc.length > 0 ? pickRandom(showcaseCommonUnc) : pickRandom(setData.uncommons);
    if (showcaseAlt) {
        packCards.push(createPackCard(showcaseAlt, true, packNumber, 'Showcase Foil'));
    }

    // 4. 1 Rare or Mythic Rare with Alternate Art/Frame (Showcase/Borderless/Extended)
    const showcaseRareMythics = setData.showcases.filter(c => c.rarity === 'rare' || c.rarity === 'mythic');
    const isMythic1 = Math.random() < 0.16;
    let altRare = null;
    if (showcaseRareMythics.length > 0) {
        const pool = showcaseRareMythics.filter(c => isMythic1 ? c.rarity === 'mythic' : c.rarity === 'rare');
        altRare = pickRandom(pool.length > 0 ? pool : showcaseRareMythics);
    }
    if (!altRare) {
        altRare = pickRandom(isMythic1 ? setData.mythics : setData.rares);
    }
    if (altRare) {
        packCards.push(createPackCard(altRare, false, packNumber, isMythic1 ? 'Mythic Alternate Frame' : 'Rare Alternate Frame'));
    }

    // 5. 1 Traditional Foil Rare or Mythic (regular or showcase frame)
    const isMythic2 = Math.random() < 0.18;
    const foilRarePool = isMythic2 ? setData.mythics : setData.rares;
    let foilRare = pickRandom(foilRarePool);
    if (Math.random() < 0.35 && setData.showcases.length > 0) {
        const match = setData.showcases.find(s => s.name === foilRare?.name);
        if (match) foilRare = match;
    }
    if (foilRare) {
        packCards.push(createPackCard(foilRare, true, packNumber, isMythic2 ? 'Foil Mythic Hit' : 'Foil Rare Hit'));
    }

    // 6. 1 Extended Art / Commander / Special Rare or Mythic
    const isMythic3 = Math.random() < 0.15;
    const rarePool3 = isMythic3 ? setData.mythics : setData.rares;
    const specialRare = pickRandom(rarePool3);
    if (specialRare) {
        packCards.push(createPackCard(specialRare, Math.random() < 0.5, packNumber, 'Extended Art / Special'));
    }

    // 7. 2 Additional Wildcard Rares / Mythics (Foil or Alternate Treatment)
    for (let w = 1; w <= 2; w++) {
        const isMythicW = Math.random() < 0.20;
        const wildcardRare = pickRandom(isMythicW ? setData.mythics : setData.rares);
        if (wildcardRare) {
            packCards.push(createPackCard(wildcardRare, true, packNumber, isMythicW ? 'Foil Mythic Wildcard' : 'Foil Rare Wildcard'));
        }
    }

    // 8. 1 Traditional Foil Basic Land (Full-Art or Showcase)
    if (setData.basics.length > 0) {
        const landCard = pickRandom(setData.basics);
        packCards.push(createPackCard(landCard, true, packNumber, 'Foil Basic Land'));
    }

    // 9. 1 Foil Bonus Slot (15th card: high-variance foil hit)
    const isRareBonus = Math.random() < 0.40;
    const bonusPool = isRareBonus ? (Math.random() < 0.25 ? setData.mythics : setData.rares) : setData.uncommons;
    const bonusCard = pickRandom(bonusPool);
    if (bonusCard) {
        packCards.push(createPackCard(bonusCard, true, packNumber, isRareBonus ? 'Collector Foil Hit' : 'Foil Bonus'));
    }

    return packCards;
}

export function createPackCard(card, isFoil = false, packNumber = 1, specialTag = null) {
    const isShowcase = (card.frame_effects && (card.frame_effects.includes('showcase') || card.frame_effects.includes('inverted'))) ||
                       (card.promo_types && card.promo_types.includes('boosterfun')) ||
                       (card.border_color === 'borderless');

    const frontFace = card.card_faces?.[0];
    const normalImg = card.image_uris?.normal || frontFace?.image_uris?.normal || (card.id ? `https://api.scryfall.com/cards/${card.id}?format=image&version=normal` : 'card_back.webp');
    const largeImg = card.image_uris?.large || frontFace?.image_uris?.large || (card.id ? `https://api.scryfall.com/cards/${card.id}?format=image&version=large` : normalImg);

    return {
        ...card, // Preserve complete Scryfall card metadata
        id: card.id,
        name: card.name,
        mana_cost: card.mana_cost || frontFace?.mana_cost || '',
        type_line: card.type_line || frontFace?.type_line || '',
        oracle_text: card.oracle_text || frontFace?.oracle_text || '',
        rarity: card.rarity || 'common',
        isFoil: isFoil,
        finish: isFoil ? 'foil' : 'nonfoil',
        packNumber: packNumber,
        specialTag: specialTag || (isShowcase ? 'Showcase' : null),
        isShowcase: isShowcase,
        collector_number: card.collector_number,
        set: card.set,
        scryfall_uri: card.scryfall_uri,
        image_uris: card.image_uris || (frontFace?.image_uris ? { ...frontFace.image_uris } : { normal: normalImg, large: largeImg }),
        image: normalImg,
        image_large: largeImg,
        power: card.power ?? frontFace?.power,
        toughness: card.toughness ?? frontFace?.toughness,
        loyalty: card.loyalty ?? frontFace?.loyalty,
        prices: card.prices || {},
        card_faces: card.card_faces || null
    };
}

// Calculate card price according to current market and foil finish
export function getCardPrice(card, market = 'usd') {
    if (!card || !card.prices) return 0;
    let priceStr = null;

    if (market === 'eur') {
        priceStr = card.isFoil ? (card.prices.eur_foil || card.prices.eur) : card.prices.eur;
    } else if (market === 'tix') {
        priceStr = card.prices.tix;
    } else {
        // Default: USD
        priceStr = card.isFoil ? (card.prices.usd_foil || card.prices.usd) : card.prices.usd;
    }

    const val = parseFloat(priceStr);
    return isNaN(val) ? 0 : val;
}

// Calculate Dynamic Statistical Expected Value (EV)
export function calculateSetEV(setData, market = 'usd', packEdition = 'play', isBox = false, numPacks = 36) {
    if (!setData) return { packEV: 0, boxEV: 0, currentEV: 0, avgMythic: 0, avgRare: 0, topChases: [] };

    const getRawVal = (card, foil = false) => {
        if (!card || !card.prices) return 0;
        let str = null;
        if (market === 'eur') {
            str = foil ? (card.prices.eur_foil || card.prices.eur) : card.prices.eur;
        } else if (market === 'tix') {
            str = card.prices.tix;
        } else {
            str = foil ? (card.prices.usd_foil || card.prices.usd) : card.prices.usd;
        }
        const v = parseFloat(str);
        return isNaN(v) ? 0 : v;
    };

    // Realistic Realized EV: bulk cards under $0.75 / 0.65€ have negligible cash liquidity (~$0.02 bulk rate)
    const getRealizedVal = (card, foil = false) => {
        const v = getRawVal(card, foil);
        if (v <= 0) return 0;
        const bulkThreshold = market === 'tix' ? 0.05 : (market === 'eur' ? 0.65 : 0.75);
        if (v < bulkThreshold) return 0.02;
        if (v < (bulkThreshold * 2)) return v * 0.75; // slight discount for low-liquidity singles
        return v;
    };

    const avgPrice = (arr, foil = false) => {
        if (!arr || arr.length === 0) return 0;
        const total = arr.reduce((sum, c) => sum + getRealizedVal(c, foil), 0);
        return total / arr.length;
    };

    const avgMythic = avgPrice(setData.mythics, false);
    const avgMythicFoil = avgPrice(setData.mythics, true);
    const avgRare = avgPrice(setData.rares, false);
    const avgRareFoil = avgPrice(setData.rares, true);
    const avgUnc = avgPrice(setData.uncommons, false);
    const avgUncFoil = avgPrice(setData.uncommons, true);
    const avgCommon = avgPrice(setData.commons, false);
    const avgCommonFoil = avgPrice(setData.commons, true);

    // Showcases: separate regular showcases from ultra-chase outliers (> $40)
    const showcases = setData.showcases || [];
    const stdShowcases = showcases.filter(c => getRealizedVal(c, true) < 40);
    const chaseShowcases = showcases.filter(c => getRealizedVal(c, true) >= 40);

    const avgStdShowcaseFoil = stdShowcases.length > 0 ? avgPrice(stdShowcases, true) : (avgRareFoil || avgRare);
    const avgChaseShowcaseFoil = chaseShowcases.length > 0 ? avgPrice(chaseShowcases, true) : (avgMythicFoil || avgMythic);

    let packEV = 0;

    if (packEdition === 'collector') {
        // Collector Booster EV (15 cards: 5 foil commons, 2 foil uncommons, 1 foil basic land, 
        // 1 traditional foil rare/mythic, 1 showcase/borderless rare/mythic, 1 extended-art rare/mythic, 
        // 2 wildcard rare/mythics, 1 bonus sheet slot)
        const colFoilBulk = (5 * avgCommonFoil) + (2 * avgUncFoil);
        const colLand = 0.25;
        const colFoilRare = (0.83 * avgRareFoil) + (0.17 * avgMythicFoil);
        // Alternate frame slot: ~97% regular showcase/borderless, ~3% ultra-rare chase (Fracture/Raised/Japan)
        const colShowcase = (0.97 * avgStdShowcaseFoil) + (0.03 * avgChaseShowcaseFoil);
        const colExtRare = (0.85 * avgRare) + (0.15 * avgMythic);
        const colWildcards = 2 * ((0.85 * avgRareFoil) + (0.15 * avgMythicFoil));
        const colBonus = (0.75 * avgUncFoil) + (0.25 * avgRareFoil);

        packEV = colFoilBulk + colLand + colFoilRare + colShowcase + colExtRare + colWildcards + colBonus;
    } else {
        // Play / Draft Booster EV (14 cards)
        // 1 Rare/Mythic slot (approx 1:7 mythic ratio)
        const rareSlotEV = (0.857 * avgRare) + (0.143 * avgMythic);
        // Wildcard slot (can be any rarity, rare/mythic approx 25%)
        const wildcardEV = (0.40 * avgCommon) + (0.35 * avgUnc) + (0.20 * avgRare) + (0.05 * avgMythic);
        // Dedicated foil slot (1 per pack on average in Play Boosters)
        const foilSlotEV = (0.65 * avgCommonFoil) + (0.25 * avgUncFoil) + (0.085 * avgRareFoil) + (0.015 * avgMythicFoil);
        const uncSlotEV = 3 * avgUnc;
        const commonSlotEV = 6.95 * avgCommon;
        const landEV = 0.05; // basic land slot

        packEV = rareSlotEV + wildcardEV + foilSlotEV + uncSlotEV + commonSlotEV + landEV;
    }

    const boxEV = packEV * numPacks;

    // Find top 3 chase cards in set (using raw prices for accurate display)
    const allSetCards = [...(setData.mythics || []), ...(setData.rares || []), ...(setData.showcases || [])];
    const uniqueChases = [];
    const seenNames = new Set();
    allSetCards.sort((a, b) => getRawVal(b, true) - getRawVal(a, true)).forEach(c => {
        if (!seenNames.has(c.name) && uniqueChases.length < 3) {
            seenNames.add(c.name);
            const highestPrice = Math.max(getRawVal(c, false), getRawVal(c, true));
            uniqueChases.push({ name: c.name, price: highestPrice, rarity: c.rarity });
        }
    });

    return {
        packEV,
        boxEV,
        currentEV: isBox ? boxEV : packEV,
        avgMythic,
        avgRare,
        topChases: uniqueChases
    };
}

let latestEvFetchId = 0;
let cachedEvData = null;

export function updateCostComparisonLive(customCost = null, customMarket = null) {
    const costInput = document.getElementById('boosterCostInput');
    const evComparisonEl = document.getElementById('boosterEvComparison');
    const evBadgeEl = document.getElementById('boosterEvBadge');
    const marketSelect = document.getElementById('boosterMarketSelect');
    
    const market = customMarket || marketSelect?.value || 'usd';
    const userCost = customCost !== null ? customCost : (parseFloat(costInput?.value) || 0);

    if (!evComparisonEl || !cachedEvData) return;

    if (userCost > 0) {
        const evDiff = cachedEvData.currentEV - userCost;
        const evRatio = ((evDiff / userCost) * 100).toFixed(1);
        if (evDiff >= 0) {
            evComparisonEl.innerHTML = `<span class="ev-positive">+${formatCurrency(evDiff, market)} (+${evRatio}%) Favorable Odds 🚀</span>`;
            if (evBadgeEl) {
                evBadgeEl.textContent = 'Positive EV';
                evBadgeEl.className = 'ev-badge-chip ev-positive-badge';
            }
        } else {
            evComparisonEl.innerHTML = `<span class="ev-negative">${formatCurrency(evDiff, market)} (${evRatio}%) Under Cost</span>`;
            if (evBadgeEl) {
                evBadgeEl.textContent = 'Negative EV';
                evBadgeEl.className = 'ev-badge-chip ev-negative-badge';
            }
        }
    } else {
        evComparisonEl.textContent = 'Enter item purchase cost to compare ROI';
        if (evBadgeEl) {
            evBadgeEl.textContent = 'Live EV';
            evBadgeEl.className = 'ev-badge-chip';
        }
    }
}

export async function updateEvDisplay(setCode, market, packEdition, isBox, userCost, numPacks) {
    const fetchId = ++latestEvFetchId;
    const evValueEl = document.getElementById('boosterEvValue');
    const evCurrencyEl = document.getElementById('boosterEvCurrency');
    const evBadgeEl = document.getElementById('boosterEvBadge');
    const evComparisonEl = document.getElementById('boosterEvComparison');
    const avgMythicEl = document.getElementById('boosterAvgMythicText');
    const avgRareEl = document.getElementById('boosterAvgRareText');
    const chaseContainer = document.getElementById('boosterChaseCards');

    if (!evValueEl) return;

    if (evCurrencyEl) evCurrencyEl.textContent = getCurrencySymbol(market);
    evValueEl.textContent = 'Calculating...';
    if (evComparisonEl) evComparisonEl.textContent = 'Analyzing live set card values...';

    try {
        const setData = await fetchSetBoosterCards(setCode);
        if (fetchId !== latestEvFetchId) return; // Stale request check

        const evData = calculateSetEV(setData, market, packEdition, isBox, numPacks);
        cachedEvData = evData;
        evValueEl.textContent = evData.currentEV.toFixed(2);
        
        if (avgMythicEl) avgMythicEl.textContent = `Avg Mythic: ${formatCurrency(evData.avgMythic, market)}`;
        if (avgRareEl) avgRareEl.textContent = `Avg Rare: ${formatCurrency(evData.avgRare, market)}`;

        // Update EV vs Cost Comparison live
        updateCostComparisonLive(userCost, market);

        // Top Chase Chips
        if (chaseContainer) {
            if (evData.topChases.length === 0) {
                chaseContainer.innerHTML = '<span class="chase-loading">No chase cards identified</span>';
            } else {
                chaseContainer.innerHTML = evData.topChases.map(chase => `
                    <div class="chase-chip rarity-${chase.rarity}" onclick="window.inspectBoosterCard('${chase.name}')" title="Inspect ${chase.name}">
                        <span class="chase-name">${chase.name}</span>
                        <span class="chase-price">${formatCurrency(chase.price, market)}</span>
                    </div>
                `).join('');
            }
        }

        return evData;
    } catch (err) {
        console.warn("Could not calculate EV:", err);
        if (fetchId === latestEvFetchId) {
            if (evValueEl) evValueEl.textContent = '--';
            if (evComparisonEl) evComparisonEl.textContent = 'Could not load Scryfall prices';
        }
    }
}

// Build UI
function setupSimulatorUI(defaultSetCode, utils) {
    const container = document.getElementById('boosterSimRoot');
    if (!container) return;

    // Check Scryfall sets available
    const sets = window.scryfallSets || [];
    const currentCode = (defaultSetCode || 'dsk').toLowerCase();
    const setObj = sets.find(s => s.code.toLowerCase() === currentCode) || {
        code: currentCode,
        name: currentCode === 'dsk' ? 'Duskmourn: House of Horror' : currentCode.toUpperCase()
    };

    const market = document.getElementById('boosterMarketSelect')?.value || 'usd';
    const isBox = document.getElementById('boosterModeBox')?.checked ?? false;
    const benchmark = getEstimatedMarketPrices(setObj, isBox, market);

    // Populate set list datalist
    const datalist = document.getElementById('boosterSetDatalist');
    if (datalist && datalist.children.length === 0 && sets.length > 0) {
        let html = '';
        sets.forEach(s => {
            html += `<option value="${s.name} (${s.code.toUpperCase()})"></option>`;
        });
        datalist.innerHTML = html;
    }

    const setInput = document.getElementById('boosterSetInput');
    if (setInput && !setInput.value) {
        setInput.value = `${setObj.name} (${setObj.code.toUpperCase()})`;
    }

    // Update cost input & bind live typing listener
    const costInput = document.getElementById('boosterCostInput');
    if (costInput && !costInput.dataset.listenerBound) {
        costInput.dataset.listenerBound = 'true';
        costInput.addEventListener('input', () => updateCostComparisonLive());
    }

    updateMarketAndCostDisplay();
}

// Realistic physical foil pack tear sound generator using Web Audio API
export function playFoilTearSound() {
    try {
        if (typeof window === 'undefined') return;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') ctx.resume();

        const duration = 0.52; // ~520ms rip
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);

        // Generate authentic physical foil packet tearing friction noise
        for (let i = 0; i < bufferSize; i++) {
            const t = i / bufferSize;
            // Base noise
            const noise = (Math.random() * 2 - 1);
            // Sharp initial rip bite, sustaining tear friction, fast release
            let env = Math.sin(t * Math.PI);
            if (t < 0.08) env = (t / 0.08);
            // Texture fluctuations: teeth tearing through metallic foil plastic
            const serration = (Math.sin(i * 0.15) * Math.sin(i * 0.45) > 0.4) ? 1.5 : 0.75;
            data[i] = noise * env * serration * 0.55;
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        // Bandpass sweeps down simulating the rip pitch drop
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(3600, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + duration);
        filter.Q.setValueAtTime(2.8, ctx.currentTime);

        // High shelf adds the crisp plastic tear snap
        const highShelf = ctx.createBiquadFilter();
        highShelf.type = 'highshelf';
        highShelf.frequency.setValueAtTime(4500, ctx.currentTime);
        highShelf.gain.setValueAtTime(6, ctx.currentTime);

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0.85, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

        source.connect(filter);
        filter.connect(highShelf);
        highShelf.connect(gainNode);
        gainNode.connect(ctx.destination);

        source.start();
    } catch (e) {
        console.warn("Foil tear audio error:", e);
    }
}

function updateOpenButtonText() {
    const openBtn = document.getElementById('boosterOpenBtn');
    if (!openBtn) return;
    const isBox = document.getElementById('boosterModeBox')?.checked ?? false;
    const isCollector = document.getElementById('boosterEditionCollector')?.checked ?? false;
    
    if (isCollector) {
        openBtn.innerHTML = isBox ? '<span>⚡ CRACK COLLECTOR BOX (12) ⚡</span>' : '<span>⚡ OPEN COLLECTOR PACK ⚡</span>';
    } else {
        openBtn.innerHTML = isBox ? '<span>⚡ CRACK BOOSTER BOX ⚡</span>' : '<span>⚡ OPEN SINGLE PACK ⚡</span>';
    }
}

export function updateMarketAndCostDisplay() {
    const setInput = document.getElementById('boosterSetInput');
    const marketSelect = document.getElementById('boosterMarketSelect');
    const isBox = document.getElementById('boosterModeBox')?.checked ?? false;
    const isCollector = document.getElementById('boosterEditionCollector')?.checked ?? false;
    const packEdition = isCollector ? 'collector' : 'play';
    const costInput = document.getElementById('boosterCostInput');
    const costCurrencyLabel = document.getElementById('boosterCostCurrency');

    if (!marketSelect || !costInput) return;

    const market = marketSelect.value;
    const setCode = resolveInputSetCode(setInput?.value || 'dsk');
    const sets = window.scryfallSets || [];
    const setObj = sets.find(s => s.code.toLowerCase() === setCode) || { code: setCode };
    const pricing = getEstimatedMarketPrices(setObj, isBox, market, packEdition);

    if (costCurrencyLabel) {
        costCurrencyLabel.textContent = getCurrencySymbol(market);
    }

    // Only update cost if user hasn't typed a custom value or just changed market/box/edition
    costInput.value = pricing.currentCost.toFixed(2);
    costInput.dataset.defaultCost = pricing.currentCost.toFixed(2);

    // Update box quantity pill label
    const boxPillLabel = document.getElementById('boosterBoxPillLabel');
    if (boxPillLabel) {
        boxPillLabel.textContent = `Booster Box (${pricing.packsPerBox})`;
    }

    // Update item type label
    const itemTypeLabel = document.getElementById('boosterItemLabel');
    if (itemTypeLabel) {
        if (isCollector) {
            itemTypeLabel.textContent = isBox 
                ? `Collector Booster Box (12 Packs, ~60 Rares/Foils)` 
                : 'Collector Booster (15 Cards, 4-6 Rares/Foils)';
        } else {
            itemTypeLabel.textContent = isBox 
                ? `Booster Box (${pricing.packsPerBox} Packs)` 
                : 'Play / Draft Booster (14 Cards)';
        }
    }

    // Update live market search link
    const marketLinkEl = document.getElementById('boosterMarketLookupLink');
    const marketTextEl = document.getElementById('boosterMarketLookupText');
    if (marketLinkEl && marketTextEl) {
        const productTerm = `${setObj.name || setCode.toUpperCase()} ${isCollector ? 'Collector ' : ''}${isBox ? 'Booster Box' : 'Booster Pack'}`;
        if (market === 'usd') {
            marketLinkEl.href = `https://www.tcgplayer.com/search/magic/product?q=${encodeURIComponent(productTerm)}&view=grid`;
            marketTextEl.textContent = `Check TCGplayer Sealed Prices ↗`;
        } else if (market === 'eur') {
            marketLinkEl.href = `https://www.cardmarket.com/en/Magic/Products/Booster-Boxes?searchString=${encodeURIComponent(setObj.name || setCode.toUpperCase())}`;
            marketTextEl.textContent = `Check Cardmarket Sealed Prices ↗`;
        } else {
            marketLinkEl.href = `https://www.cardhoarder.com/cards?desc=${encodeURIComponent(setObj.name || setCode.toUpperCase())}`;
            marketTextEl.textContent = `Check MTGO Booster Prices ↗`;
        }
    }

    // Update open button
    updateOpenButtonText();

    // Update Set icon/badge if available
    const setBadge = document.getElementById('boosterSelectedSetBadge');
    if (setBadge) {
        setBadge.innerHTML = `
            <span class="set-icon-code">${setObj.code.toUpperCase()}</span>
            <span class="set-name-text">${setObj.name || setObj.code.toUpperCase()}</span>
        `;
    }

    // Trigger Dynamic Expected Value (EV) calculation
    updateEvDisplay(setCode, market, packEdition, isBox, pricing.currentCost, pricing.packsPerBox);
}

function resolveInputSetCode(val) {
    if (!val) return 'dsk';
    const match = val.match(/\(([a-z0-9]{3,5})\)/i);
    if (match) return match[1].toLowerCase();
    
    // Check if code directly
    const trimmed = val.trim().toLowerCase();
    const sets = window.scryfallSets || [];
    const found = sets.find(s => s.code.toLowerCase() === trimmed || s.name.toLowerCase() === trimmed);
    if (found) return found.code.toLowerCase();

    const partial = sets.find(s => s.name.toLowerCase().includes(trimmed));
    if (partial) return partial.code.toLowerCase();

    return trimmed.replace(/[^a-z0-9]/gi, '').substring(0, 5) || 'dsk';
}

// Trigger Opening
export async function crackBoosterProduct(utils) {
    const setInput = document.getElementById('boosterSetInput');
    const marketSelect = document.getElementById('boosterMarketSelect');
    const isBox = document.getElementById('boosterModeBox')?.checked ?? false;
    const isCollector = document.getElementById('boosterEditionCollector')?.checked ?? false;
    const packEdition = isCollector ? 'collector' : 'play';
    const costInput = document.getElementById('boosterCostInput');
    const openBtn = document.getElementById('boosterOpenBtn');

    if (!openBtn) return;
    const market = marketSelect?.value || 'usd';
    const setCode = resolveInputSetCode(setInput?.value || 'dsk');
    const userCost = parseFloat(costInput?.value) || 0;

    openBtn.disabled = true;
    openBtn.innerHTML = `<span>⏳ Preparing Packs...</span>`;

    try {
        // Fetch cards while keeping page focused on controls
        const setData = await fetchSetBoosterCards(setCode);
        const sets = window.scryfallSets || [];
        const setObj = sets.find(s => s.code.toLowerCase() === setCode) || { code: setCode, name: setCode.toUpperCase() };
        const pricing = getEstimatedMarketPrices(setObj, isBox, market, packEdition);
        const numPacks = isBox ? pricing.packsPerBox : 1;

        // Perform smooth, paced opening animation
        await playBoosterOpenAnimation(setObj, isBox, numPacks, utils, packEdition);

        // Generate packs
        let allCards = [];
        for (let i = 1; i <= numPacks; i++) {
            const packCards = isCollector 
                ? generateCollectorBoosterPack(setData, i) 
                : generateBoosterPack(setData, i);
            allCards.push(...packCards);
        }

        // Assign explicit unique index and uid to every pulled card instance
        allCards.forEach((c, idx) => {
            c.simIndex = idx;
            c.uid = `sim_card_${idx}_${c.id}_${c.isFoil ? 'foil' : 'reg'}`;
        });

        // Calculate expected EV for this configuration
        const evData = calculateSetEV(setData, market, packEdition, isBox, numPacks);

        currentSimulation = {
            setObj,
            setData,
            isBox,
            isCollector,
            packEdition,
            numPacks,
            market,
            cost: userCost > 0 ? userCost : pricing.currentCost,
            expectedEV: evData.currentEV,
            cards: allCards,
            timestamp: Date.now()
        };

        // Reveal results smoothly after animation ends
        const stage = document.getElementById('boosterResultsStage');
        if (stage) {
            stage.style.display = 'block';
            renderSimulationResults(currentSimulation);
            stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

    } catch (err) {
        console.error("Simulation error:", err);
        if (utils.showToast) utils.showToast(err.message || "Failed to open pack", true);
        alert(err.message || "Failed to open booster pack.");
    } finally {
        if (openBtn) {
            openBtn.disabled = false;
            updateOpenButtonText();
        }
    }
}

// 3D Pack Opening Animation (Smooth Pacing & Clean Sound Synchronization)
function playBoosterOpenAnimation(setObj, isBox, numPacks, utils, packEdition = 'play') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('boosterAnimationOverlay');
        if (!overlay) {
            resolve();
            return;
        }

        const isCollector = packEdition === 'collector';
        const typeLabel = isCollector 
            ? (isBox ? `CRACKING ${numPacks} COLLECTOR PACKS` : 'CRACKING COLLECTOR BOOSTER')
            : (isBox ? `CRACKING ${numPacks} BOOSTER PACKS` : 'CRACKING PLAY BOOSTER');

        overlay.style.opacity = '0';
        overlay.style.display = 'flex';
        // Force reflow for smooth CSS fade-in
        overlay.offsetHeight;
        overlay.style.opacity = '1';

        overlay.innerHTML = `
            <div class="booster-sim-animation-card ${isBox ? 'box-opening-mode' : 'pack-opening-mode'} ${isCollector ? 'collector-opening-mode' : ''}">
                <div class="booster-sim-burst-glow"></div>
                <div class="booster-sim-foil-sheen"></div>
                <div class="booster-sim-pack-art">
                    <div class="booster-sim-icon-glow">${isCollector ? '✨' : '📦'}</div>
                    <div class="booster-sim-title">${utils.sanitizeHTML(setObj.name || setObj.code.toUpperCase())}</div>
                    <div class="booster-sim-type-badge">${typeLabel}</div>
                    <div class="booster-sim-progress" id="boosterAnimProgress">Preparing ${isBox ? 'Booster Box' : 'Pack'}...</div>
                </div>
                <div class="booster-sim-tear-strip"></div>
            </div>
        `;

        const cardEl = overlay.querySelector('.booster-sim-animation-card');
        const progressEl = document.getElementById('boosterAnimProgress');

        // Stage 1: Present product (0 - 800ms)
        // Stage 2: Tearing the metallic foil wrapper (800ms - 2200ms)
        setTimeout(() => {
            if (cardEl) cardEl.classList.add('is-tearing');
            playFoilTearSound(); // Crisp realistic procedural foil rip!
            if (progressEl) progressEl.textContent = isBox ? `Cracking Box (${numPacks} Packs)...` : 'Tearing Metallic Wrapper...';
        }, 800);

        // Stage 3: Radiant burst & hits reveal (2200ms - 3000ms)
        setTimeout(() => {
            if (cardEl) cardEl.classList.add('is-bursting');
            if (progressEl) progressEl.textContent = '✨ Revealing Mythics & Foils!';
            if (utils.playSound) utils.playSound('sfx-reveal');
        }, 2200);

        // Stage 4: Smooth fade out to results (3000ms - 3500ms)
        setTimeout(() => {
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.style.display = 'none';
                overlay.style.opacity = '1';
                resolve();
            }, 500);
        }, 3000);
    });
}

// Render Results Grid and Summary Sidebar
function renderSimulationResults(sim) {
    const cardsGrid = document.getElementById('boosterCardsGrid');
    const summaryContainer = document.getElementById('boosterSummarySidebar');
    if (!cardsGrid || !sim) return;

    // Filter & Sort cards
    let displayCards = [...sim.cards];

    if (currentFilter === 'hits') {
        displayCards = displayCards.filter(c => c.rarity === 'mythic' || c.rarity === 'rare' || getCardPrice(c, sim.market) >= 2 || c.isFoil);
    } else if (currentFilter === 'mythic') {
        displayCards = displayCards.filter(c => c.rarity === 'mythic');
    } else if (currentFilter === 'rare') {
        displayCards = displayCards.filter(c => c.rarity === 'rare');
    } else if (currentFilter === 'foil') {
        displayCards = displayCards.filter(c => c.isFoil);
    }

    if (currentSortMode === 'price-desc') {
        displayCards.sort((a, b) => getCardPrice(b, sim.market) - getCardPrice(a, sim.market));
    } else if (currentSortMode === 'price-asc') {
        displayCards.sort((a, b) => getCardPrice(a, sim.market) - getCardPrice(b, sim.market));
    } else if (currentSortMode === 'rarity') {
        const rarityWeights = { mythic: 4, rare: 3, uncommon: 2, common: 1 };
        displayCards.sort((a, b) => (rarityWeights[b.rarity] || 0) - (rarityWeights[a.rarity] || 0) || getCardPrice(b, sim.market) - getCardPrice(a, sim.market));
    }

    // Render Cards
    if (displayCards.length === 0) {
        cardsGrid.innerHTML = `<div class="booster-empty-filter">No cards match the selected filter. Try selecting "All Cards".</div>`;
    } else {
        cardsGrid.innerHTML = displayCards.map(card => {
            const price = getCardPrice(card, sim.market);
            const isValuable = price >= (sim.isBox ? 5 : 2);
            return `
                <div class="booster-card-item ${card.isFoil ? 'is-foil-card' : ''} ${isValuable ? 'is-valuable-hit' : ''}" 
                     onclick="window.inspectBoosterCardByIndex(${card.simIndex !== undefined ? card.simIndex : `'${card.id}'`})"
                     title="Click to inspect ${card.name} in 3D">
                    <div class="booster-card-img-wrapper">
                        <img src="${card.image}" alt="${card.name}" loading="lazy" class="booster-card-img">
                        ${card.isFoil ? '<div class="booster-foil-overlay"></div>' : ''}
                        ${card.isFoil ? '<span class="booster-foil-tag">FOIL</span>' : ''}
                        ${card.specialTag ? `<span class="booster-version-tag">${card.specialTag}</span>` : ''}
                        <span class="booster-rarity-pill rarity-${card.rarity}">${card.rarity.toUpperCase()}</span>
                    </div>
                    <div class="booster-card-footer">
                        <div class="booster-card-name" title="${card.name}">${card.name}</div>
                        <div class="booster-card-price ${price > 5 ? 'high-value' : ''}">
                            ${formatCurrency(price, sim.market)}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Render Sidebar Analytics
    renderSidebarAnalytics(sim, summaryContainer);
}

function renderSidebarAnalytics(sim, container) {
    if (!container || !sim) return;

    let totalValue = 0;
    const rarityCounts = { mythic: 0, rare: 0, uncommon: 0, common: 0 };
    let foilCount = 0;

    sim.cards.forEach(card => {
        const price = getCardPrice(card, sim.market);
        totalValue += price;
        if (rarityCounts[card.rarity] !== undefined) {
            rarityCounts[card.rarity]++;
        }
        if (card.isFoil) foilCount++;
    });

    const cost = sim.cost || 0;
    const netProfit = totalValue - cost;
    const roi = cost > 0 ? ((netProfit / cost) * 100) : 0;
    const isProfit = netProfit >= 0;

    // Top 3 pulls
    const sortedByPrice = [...sim.cards].sort((a, b) => getCardPrice(b, sim.market) - getCardPrice(a, sim.market));
    const topHits = sortedByPrice.slice(0, 4);

    container.innerHTML = `
        <div class="booster-sidebar-box">
            <div class="sidebar-header">
                <div class="sidebar-title">📊 Pulls Analytics</div>
                <div class="sidebar-subtitle">${sim.setObj.name || sim.setObj.code.toUpperCase()}</div>
                <div class="sidebar-product-tag">${sim.isCollector ? '✨ Collector ' : 'Play '}${sim.isBox ? `Box (${sim.numPacks} Packs)` : 'Pack'}</div>
            </div>

            <!-- Financial Profit / Loss Summary Card -->
            <div class="sidebar-financial-card ${isProfit ? 'profit-card' : 'loss-card'}">
                <div class="fin-row">
                    <span class="fin-label">Total Pulled Value:</span>
                    <span class="fin-value total-val">${formatCurrency(totalValue, sim.market)}</span>
                </div>
                ${sim.expectedEV ? `
                <div class="fin-row">
                    <span class="fin-label">Statistical Expected EV:</span>
                    <span class="fin-value ev-stat-val">${formatCurrency(sim.expectedEV, sim.market)}</span>
                </div>
                ` : ''}
                <div class="fin-row">
                    <span class="fin-label">Item Purchase Cost:</span>
                    <span class="fin-value cost-val">${formatCurrency(cost, sim.market)}</span>
                </div>
                <div class="fin-divider"></div>
                <div class="fin-result-row">
                    <div class="fin-result-label">Net ${isProfit ? 'Profit' : 'Loss'}:</div>
                    <div class="fin-result-value ${isProfit ? 'text-profit' : 'text-loss'}">
                        ${isProfit ? '+' : ''}${formatCurrency(netProfit, sim.market)}
                        <span class="roi-percentage">(${isProfit ? '+' : ''}${roi.toFixed(1)}%)</span>
                    </div>
                </div>
                ${sim.expectedEV ? `
                <div class="ev-performance-pill ${totalValue >= sim.expectedEV ? 'beat-ev' : 'miss-ev'}">
                    ${totalValue >= sim.expectedEV 
                        ? `🎉 Beat Expected EV by +${formatCurrency(totalValue - sim.expectedEV, sim.market)}` 
                        : `📉 Under Expected EV by -${formatCurrency(sim.expectedEV - totalValue, sim.market)}`}
                </div>
                ` : ''}
            </div>

            <!-- Rarity Breakdown Breakdown Table -->
            <div class="sidebar-section-title">Rarity Breakdown (${sim.cards.length} cards)</div>
            <div class="rarity-summary-grid">
                <div class="rarity-stat-pill rarity-mythic">
                    <span class="rarity-dot">🟠</span>
                    <span class="rarity-name">Mythics:</span>
                    <span class="rarity-count">${rarityCounts.mythic}</span>
                </div>
                <div class="rarity-stat-pill rarity-rare">
                    <span class="rarity-dot">🟡</span>
                    <span class="rarity-name">Rares:</span>
                    <span class="rarity-count">${rarityCounts.rare}</span>
                </div>
                <div class="rarity-stat-pill rarity-uncommon">
                    <span class="rarity-dot">⚪</span>
                    <span class="rarity-name">Uncommons:</span>
                    <span class="rarity-count">${rarityCounts.uncommon}</span>
                </div>
                <div class="rarity-stat-pill rarity-common">
                    <span class="rarity-dot">⚫</span>
                    <span class="rarity-name">Commons:</span>
                    <span class="rarity-count">${rarityCounts.common}</span>
                </div>
                <div class="rarity-stat-pill rarity-foil">
                    <span class="rarity-dot">✨</span>
                    <span class="rarity-name">Foils:</span>
                    <span class="rarity-count">${foilCount}</span>
                </div>
            </div>

            <!-- Top Hits List -->
            <div class="sidebar-section-title">⭐ Top Pulls</div>
            <div class="sidebar-top-hits-list">
                ${topHits.map((h, i) => `
                    <div class="top-hit-row" onclick="window.inspectBoosterCardByIndex(${h.simIndex !== undefined ? h.simIndex : `'${h.id}'`})" title="Inspect ${h.name}">
                        <span class="top-hit-rank">#${i + 1}</span>
                        <div class="top-hit-info">
                            <div class="top-hit-name">${h.name} ${h.isFoil ? '<span class="foil-badge-mini">✨</span>' : ''}</div>
                            <div class="top-hit-sub">${h.rarity.toUpperCase()} ${h.specialTag ? `• ${h.specialTag}` : ''}</div>
                        </div>
                        <span class="top-hit-price">${formatCurrency(getCardPrice(h, sim.market), sim.market)}</span>
                    </div>
                `).join('')}
            </div>

            <!-- Quick Action Buttons -->
            <div class="sidebar-action-btns">
                <button class="select-btn open-another-btn" onclick="window.crackBoosterProductAgain()">
                    🔄 Open Another ${sim.isCollector ? 'Collector ' : ''}${sim.isBox ? 'Box' : 'Pack'}
                </button>
                <button class="secondary-btn copy-summary-btn" onclick="window.copyBoosterSummary()">
                    📋 Copy Summary
                </button>
            </div>
        </div>
    `;
}

// Global action helpers
if (typeof window !== 'undefined') {
    window.onBoosterCostChange = updateCostComparisonLive;

    window.inspectBoosterCardByIndex = (simIndex) => {
        if (window.openCardInspector && currentSimulation?.cards) {
            const cardObj = typeof simIndex === 'number' ? currentSimulation.cards[simIndex] : null;
            if (cardObj) {
                window.openCardInspector(cardObj);
                return;
            }
        }
        if (window.inspectBoosterCard) {
            window.inspectBoosterCard(simIndex);
        }
    };

    window.inspectBoosterCard = (cardIdentifier) => {
        if (window.openCardInspector) {
            if (typeof cardIdentifier === 'number' || (typeof cardIdentifier === 'string' && /^\d+$/.test(cardIdentifier))) {
                const idx = parseInt(cardIdentifier, 10);
                if (currentSimulation?.cards?.[idx]) {
                    window.openCardInspector(currentSimulation.cards[idx]);
                    return;
                }
            }
            // If multiple copies of a card exist in the box, prioritize the foil copy
            const cardObj = currentSimulation?.cards.find(c => c.uid === cardIdentifier) ||
                            currentSimulation?.cards.find(c => c.id === cardIdentifier && c.isFoil) ||
                            currentSimulation?.cards.find(c => c.id === cardIdentifier || c.name === cardIdentifier);
            window.openCardInspector(cardObj || cardIdentifier);
        }
    };

    window.crackBoosterProductAgain = () => {
        crackBoosterProduct(window.boosterUtils || {});
    };

    window.copyBoosterSummary = () => {
        if (!currentSimulation) return;
        const sim = currentSimulation;
        let totalValue = 0;
        sim.cards.forEach(c => totalValue += getCardPrice(c, sim.market));
        const profit = totalValue - sim.cost;
        const top3 = [...sim.cards].sort((a, b) => getCardPrice(b, sim.market) - getCardPrice(a, sim.market)).slice(0, 3);

        const text = `📦 MTG Booster Simulator Results:
Set: ${sim.setObj.name} (${sim.setObj.code.toUpperCase()})
Item: ${sim.isCollector ? 'Collector ' : 'Play '}${sim.isBox ? `Booster Box (${sim.numPacks} Packs)` : 'Booster Pack'}
Cost: ${formatCurrency(sim.cost, sim.market)}
Expected EV: ${formatCurrency(sim.expectedEV || 0, sim.market)}
Value: ${formatCurrency(totalValue, sim.market)}
Result: ${profit >= 0 ? '+' : ''}${formatCurrency(profit, sim.market)} (${((profit / sim.cost) * 100).toFixed(1)}%)
Top Pulls:
${top3.map((c, i) => `${i+1}. ${c.name} (${c.rarity.toUpperCase()}${c.isFoil ? ' Foil' : ''}) - ${formatCurrency(getCardPrice(c, sim.market), sim.market)}`).join('\n')}
Simulated at: Commander Draft Challenge`;

        navigator.clipboard.writeText(text).then(() => {
            if (window.boosterUtils?.showToast) {
                window.boosterUtils.showToast("📋 Pulls summary copied to clipboard!", false, 3000, true);
            } else {
                alert("Pulls summary copied to clipboard!");
            }
        });
    };
}

// Filtering & Sorting handlers
export function setSortMode(mode) {
    currentSortMode = mode;
    document.querySelectorAll('.booster-sort-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === mode);
    });
    if (currentSimulation) renderSimulationResults(currentSimulation);
}

export function setFilterMode(filter) {
    currentFilter = filter;
    document.querySelectorAll('.booster-filter-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.filter === filter);
    });
    if (currentSimulation) renderSimulationResults(currentSimulation);
}
