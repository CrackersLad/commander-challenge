import { functions } from './firebase-setup.js?v=0.46';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-functions.js";

// Official Game Changers for Moxfield fallback (excluding casual staples like Sol Ring)
const MOXFIELD_GAME_CHANGERS_SET = new Set([
    "ad nauseam", "ancient tomb", "apocalypse chimera", "armageddon", "bolas's citadel",
    "brain freeze", "cataclysm", "channel", "chrome mox", "consecrated sphinx",
    "craterhoof behemoth", "cyclonic rift", "deflecting swat", "demonic consultation",
    "demonic tutor", "dockside extortionist", "doomsday", "drannith magistrate",
    "eladamri's call", "enlightened tutor", "esper sentinel", "expropriate",
    "fierce guardianship", "finale of devastation", "flusterstorm", "food chain",
    "force of despair", "force of negation", "force of vigor", "force of will", "gaea's cradle",
    "gamble", "gilded drake", "god-pharaoh's statue", "grand abolisher", "grim monolith",
    "hullbreacher", "imperial seal", "intuition", "isochron scepter", "jeska's will",
    "jeweled lotus", "jokulhaups", "karn, the great creator", "kinnan, bonder prodigy",
    "koll, the forgemaster", "koma, cosmos serpent", "korvold, fae-cursed king",
    "krark, the thumbless", "kroxa, titan of death's hunger", "leovold, emissary of trest",
    "lion's eye diamond", "lotus petal", "mana crypt", "mana drain", "mana vault",
    "mental misstep", "mindbreak trap", "mishra's workshop", "mox diamond", "mox opal",
    "mystical tutor", "narset, parter of veils", "nature's will", "necropotence",
    "notion thief", "najeela, the blade-blossom", "opposition agent", "orcish bowmasters",
    "pact of negation", "peer into the abyss", "phyrexian altar", "prossh, skyraider of kher",
    "protean hulk", "razaketh, the foulblooded", "rhystic study", "serra ascendant",
    "silence", "smothering tithe", "staff of domination", "stasis", "survival of the fittest",
    "swan song", "sword of feast and famine", "sylvan library", "tainted pact",
    "teferi, hero of dominaria", "teferi, time raveler", "teferi's protection",
    "thassa's oracle", "the great henge", "the one ring", "time sieve",
    "time stretch", "time warp", "timetwister", "tivit, seller of secrets",
    "tooth and nail", "torment of hailfire", "toxic deluge", "triumph of the hordes",
    "trouble in pairs", "underworld breach", "urza, lord high artificer",
    "vampiric tutor", "vorinclex, voice of hunger", "wheel of fortune",
    "windfall", "winter orb", "worldly tutor", "yuriko, the tiger's shadow"
]);

const MASS_LAND_DENIAL_SET = new Set([
    "armageddon", "cataclysm", "jokulhaups", "obliterate", "ravages of war",
    "ruination", "decree of annihilation", "fall of the thran", "impending disaster",
    "sunder", "wildfire", "devastating dreams", "worldfire"
]);

const EXTRA_TURNS_SET = new Set([
    "time warp", "time stretch", "expropriate", "temporal manipulation",
    "capture of jingzhou", "nexus of fate", "beacon of tomorrows",
    "karn's temporal sundering", "alrund's epiphany", "walk the aeons",
    "temporal trespass", "part the waterveil", "plea for power"
]);

export function isCardInMainboard(item, categoriesMap = {}) {
    const cardCategories = item.categories || [];
    if (cardCategories.length === 0) return true;

    // Strict Non-Deck Category Names that must ALWAYS be excluded from everything
    const strictExcludedNames = ['sideboard', 'maybeboard', 'side', 'maybe', 'considering', 'wishboard', 'binder', 'cuts'];

    for (let cat of cardCategories) {
        const catName = typeof cat === 'string' ? cat : (cat.name || '');
        const lower = catName.toLowerCase().trim();
        
        // Always exclude strictly non-deck named boards
        if (strictExcludedNames.includes(lower)) return false;

        // If defined in Archidekt category metadata, check includedInDeck flag
        const catObj = categoriesMap[catName] || categoriesMap[lower];
        if (catObj && catObj.includedInDeck === false) {
            return false;
        }
    }

    return true;
}

export function calculateBracket(deckData, site, mainboardCards = [], cardNames = []) {
    // Tier 1: User-set bracket in Archidekt / Moxfield metadata
    if (deckData.edhBracket && !isNaN(parseInt(deckData.edhBracket, 10))) {
        return Math.min(5, Math.max(1, parseInt(deckData.edhBracket, 10)));
    }
    if (deckData.powerLevel && !isNaN(parseFloat(deckData.powerLevel))) {
        let p = parseFloat(deckData.powerLevel);
        return Math.min(5, Math.max(1, p <= 5 ? Math.round(p) : Math.ceil(p / 2)));
    }

    const userTags = [];
    if (Array.isArray(deckData.deckTags)) deckData.deckTags.forEach(t => userTags.push(t.name || t));
    if (Array.isArray(deckData.hubs)) deckData.hubs.forEach(h => userTags.push(h.name || h));
    if (Array.isArray(deckData.authorTags)) deckData.authorTags.forEach(t => userTags.push(t));

    for (let tag of userTags) {
        let str = String(tag).toLowerCase().trim();
        let match = str.match(/bracket\s*([1-5])/i) || str.match(/\bb([1-5])\b/i);
        if (match) return parseInt(match[1], 10);
        if (str === 'cedh') return 5;
        if (str === 'precon') return 2;
    }

    const deckTitle = deckData.name || '';
    let titleMatch = deckTitle.match(/bracket\s*([1-5])/i) || deckTitle.match(/\bb([1-5])\b/i);
    if (titleMatch) return parseInt(titleMatch[1], 10);
    if (/\bcedh\b/i.test(deckTitle)) return 5;

    // Tier 2: Automated Card Evaluation (ONLY on legal mainboard cards)
    let gcCount = 0;
    let mldCount = 0;
    let turnCount = 0;
    let atomicCombos = 0;

    if (site === 'Archidekt' && Array.isArray(mainboardCards)) {
        const mainboardOracleIdMap = {};
        mainboardCards.forEach(c => {
            const id = c.card?.oracleCard?.id || c.card?.oracleCardId;
            if (id) mainboardOracleIdMap[id] = true;
        });

        mainboardCards.forEach(item => {
            const c = item.card;
            const oracle = c?.oracleCard || {};
            const qty = parseInt(item.quantity || 1, 10);

            if (oracle.gameChanger || c?.gameChanger) gcCount += qty;
            if (oracle.massLandDenial || c?.massLandDenial) mldCount += qty;
            if (oracle.extraTurns || c?.extraTurns) turnCount += qty;

            const combos = item.atomicCombos || oracle.atomicCombos || [];
            // Combo only active if ALL combo pieces are in the mainboard!
            if (combos.length && combos.some(comboId => mainboardOracleIdMap[comboId])) atomicCombos += qty;
        });
    } else {
        // Moxfield or flat card name list
        for (let rawName of cardNames) {
            let name = String(rawName).toLowerCase().trim();
            if (MOXFIELD_GAME_CHANGERS_SET.has(name)) gcCount++;
            if (MASS_LAND_DENIAL_SET.has(name)) mldCount++;
            if (EXTRA_TURNS_SET.has(name)) turnCount++;
        }
    }

    if (gcCount >= 8) {
        return 5; // cEDH / Max Power
    }
    if (atomicCombos >= 1 || gcCount >= 4 || mldCount >= 1 || turnCount >= 2) {
        return 4; // High Power / 2-Card Infinite Combos / MLD / Heavy Game Changers
    }
    if (gcCount >= 1) {
        return 3; // Upgraded Casual (1-3 Game Changers)
    }
    return 2; // Core Casual (Lowest viable baseline)
}

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
        let deckBracket = 2; // Default integer baseline
        
        if (safeUrl.includes("archidekt.com")) {
            const data = await fetchDeckFromAPI(safeUrl);

            // Filter out Sideboards, Maybeboards, and non-deck categories strictly
            const categoriesMap = {};
            if (Array.isArray(data.categories)) {
                data.categories.forEach(cat => {
                    if (cat && cat.name) {
                        categoriesMap[cat.name] = cat;
                        categoriesMap[cat.name.toLowerCase().trim()] = cat;
                    }
                });
            }

            const mainboardCards = (data.cards || []).filter(item => isCardInMainboard(item, categoriesMap));

            // Compute Bracket strictly on mainboard cards
            deckBracket = calculateBracket(data, "Archidekt", mainboardCards);

            const commanderNameParts = selectedCommanderName ? selectedCommanderName.split(' // ') : [];
            
            if (selectedCommanderName) {
                const lowerSelected = selectedCommanderName.toLowerCase().trim();
                const partsLower = commanderNameParts.map(p => p.toLowerCase().trim());

                const commanderInDeck = mainboardCards.some(item => {
                    const cardName = item.card?.oracleCard?.name || item.card?.name;
                    if (!cardName) return false;
                    const lowerC = cardName.toLowerCase().trim();
                    return lowerC === lowerSelected || partsLower.includes(lowerC);
                }) || (data.cards || []).some(item => {
                    const isTagged = item.categories?.some(cat => ['commander', 'commanders'].includes(cat.toLowerCase()));
                    if (!isTagged) return false;
                    const cardName = item.card?.oracleCard?.name || item.card?.name;
                    if (!cardName) return false;
                    const lowerC = cardName.toLowerCase().trim();
                    return lowerC === lowerSelected || partsLower.includes(lowerC);
                });

                if (!commanderInDeck) return { error: `Validation Failed: Commander "${selectedCommanderName}" not found in deck.` };

                try {
                    let cmdrItem = (data.cards || []).find(item => {
                        const cName = item.card?.oracleCard?.name || item.card?.name;
                        if (!cName) return false;
                        const lowerC = cName.toLowerCase().trim();
                        const isTagged = item.categories?.some(cat => ['commander', 'commanders'].includes(cat.toLowerCase()));
                        return isTagged && (lowerC === lowerSelected || partsLower.includes(lowerC));
                    }) || mainboardCards.find(item => {
                        const cName = item.card?.oracleCard?.name || item.card?.name;
                        if (!cName) return false;
                        const lowerC = cName.toLowerCase().trim();
                        return lowerC === lowerSelected || partsLower.includes(lowerC);
                    });

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

            // Calculate price, salt, and size STRICTLY from mainboard cards
            mainboardCards.forEach(item => {
                let cardName = item.card?.oracleCard?.name || item.card?.name || "Unknown";
                const isCommander = item.categories?.some(cat => ["commander", "commanders"].includes(cat.toLowerCase()));

                const qty = parseInt(item.quantity || 1, 10);
                deckSize += qty;
                let cardSalt = parseFloat(item.card?.salt ?? item.card?.oracleCard?.salt ?? item.oracleCard?.salt ?? 0) || 0;
                deckSalt += (cardSalt * qty);

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

            return { total: total, site: "Archidekt", isLegal: deckSize >= 98 && deckSize <= 101, deckSize: deckSize, commanderArt: commanderArt, deckSalt: deckSalt, deckBracket: deckBracket };
        } else if (safeUrl.includes("moxfield.com")) {
            const data = await fetchDeckFromAPI(safeUrl);
            
            // STRICTLY Mainboard, Commanders, and Companions (EXCLUDES Sideboard & Maybeboard)
            let allCards = [];
            if (data.mainboard) allCards.push(...Object.values(data.mainboard).map(c => ({...c, board: 'mainboard'})));
            if (data.commanders) allCards.push(...Object.values(data.commanders).map(c => ({...c, board: 'commander'})));
            if (data.companions) allCards.push(...Object.values(data.companions).map(c => ({...c, board: 'companion'})));

            // Compute Bracket using 3-tier hierarchy on mainboard only
            const allCardNames = allCards.map(c => c.card?.name || '').filter(Boolean);
            deckBracket = calculateBracket(data, "Moxfield", [], allCardNames);

            const commanderNameParts = selectedCommanderName ? selectedCommanderName.split(' // ') : [];

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
            return { total: total, site: "Moxfield", isLegal: deckSize >= 98 && deckSize <= 101, deckSize: deckSize, commanderArt: commanderArt, deckSalt: deckSalt, deckBracket: deckBracket };
        }
        return { error: "Unsupported site. Only Archidekt and Moxfield are supported for price calculation." };
    } catch (e) {
        return { error: "Client Error: " + e.message };
    }
}