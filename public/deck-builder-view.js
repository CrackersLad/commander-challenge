// Native Standalone Deck Builder, "My Armory" Multi-Deck Manager,
// Official WotC Bracket 1-5 Analyzer, Auto-Role Tagging, and Hypergeometric Draw Calculator

import { isOfficialGameChanger } from './card-inspector.js?v=11.0';

const ARMORY_STORAGE_KEY = 'mtg_armory_decks_v1';

const MASS_LAND_DENIAL_CARDS = new Set([
    'armageddon', 'ravages of war', 'cataclysm', 'jokulhaups', 'obliterate', 'decree of annihilation',
    'sunder', 'ruination', 'wave of vitriol', 'from the ashes', 'winter orb', 'static orb', 'stasis',
    'hokori, dust drinker', 'rising waters', 'blood moon', 'magus of the moon', 'back to basics',
    'contamination', 'infernal darkness', 'hall of gemstone', 'vorinclex, voice of hunger'
]);

const EXTRA_TURN_CARDS = new Set([
    'time warp', 'temporal manipulation', 'capture of jingzhou', 'time stretch', 'expropriate',
    'nexus of fate', 'alrund\'s epiphany', 'part the waterveil', 'temporal mastery', 'temporal trespass',
    'walk the aeons', 'karn\'s temporal sundering', 'beacon of tomorrows', 'notorious throng',
    'lighthouse chronologist', 'sage of hours', 'time sieve'
]);

const TWO_CARD_COMBO_PIECES = new Set([
    'thassa\'s oracle', 'demonic consultation', 'tainted pact', 'kiki-jiki, mirror breaker',
    'zealous conscripts', 'splinter twin', 'pestermite', 'deceiver exarch', 'heliod, sun-crowned',
    'walking ballista', 'sanguine bond', 'exquisite blood', 'dramatic reversal', 'isochron scepter',
    'basalt monolith', 'rings of brighthearth', 'niv-mizzet, parun', 'curiosity', 'ophidian eye',
    'tandem lookout', 'dualcaster mage', 'twinflame', 'heat shimmer', 'protean hulk', 'hermit druid'
]);

export function initDeckBuilderModule(utils, state) {
    const { sanitizeHTML, playSound, showToast, showConfirm, switchView } = utils;

    // Load saved Armory decks from localStorage
    let armoryDecks = loadArmoryFromStorage();

    // Active Deck State
    let currentDeck = armoryDecks[0] || createBlankDeck('Untitled Commander Deck');

    // Hypergeometric Calculator State
    let hyperPopSize = 99;
    let hyperSuccessesInDeck = 37;
    let hyperSampleDrawn = 10; // Turn 3 on the play/draw (7 + 3)
    let hyperTargetHits = 3;

    // Mulligan Simulator State
    let simLibrary = [];
    let simHand = [];
    let simBottomed = [];
    let mulliganCount = 0;
    let turnCount = 0;

    function createBlankDeck(name = 'Untitled Commander Deck') {
        return {
            id: 'armory_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            name,
            commander: null,
            mainboard: [],
            sideboard: [],
            updatedAt: Date.now()
        };
    }

    function loadArmoryFromStorage() {
        try {
            const raw = localStorage.getItem(ARMORY_STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function saveArmoryToStorage() {
        try {
            currentDeck.updatedAt = Date.now();
            const existingIdx = armoryDecks.findIndex(d => d.id === currentDeck.id);
            if (existingIdx >= 0) {
                armoryDecks[existingIdx] = currentDeck;
            } else {
                armoryDecks.unshift(currentDeck);
            }
            localStorage.setItem(ARMORY_STORAGE_KEY, JSON.stringify(armoryDecks));
            syncArmoryDropdowns();
        } catch (e) {
            console.warn("Could not save Armory decks:", e);
        }
    }

    function syncArmoryDropdowns() {
        const launchSelect = document.getElementById('launchArmorySelect');
        if (launchSelect) {
            launchSelect.innerHTML = `<option value="">-- Choose an Armory Deck (${armoryDecks.length} saved) --</option>` +
                armoryDecks.map(d => {
                    const count = (d.mainboard || []).reduce((s, c) => s + (c.qty || 1), 0) + (d.commander ? 1 : 0);
                    return `<option value="${sanitizeHTML(d.id)}">🛡️ ${sanitizeHTML(d.name)} (${sanitizeHTML(d.commander?.name || 'No Cmdr')} • ${count} cards)</option>`;
                }).join('');
        }
    }

    window.getSavedArmoryDecks = () => {
        armoryDecks = loadArmoryFromStorage();
        return armoryDecks;
    };

    window.exportCurrentBuilderDeckText = () => {
        let text = '';
        if (currentDeck.commander) {
            text += `1 ${currentDeck.commander.name} *CMDR*\n`;
        }
        currentDeck.mainboard.forEach(c => {
            text += `${c.qty || 1} ${c.name}\n`;
        });
        return text;
    };

    // Hypergeometric Math Helpers: P(X >= k)
    function choose(n, k) {
        if (k < 0 || k > n) return 0;
        if (k === 0 || k === n) return 1;
        k = Math.min(k, n - k);
        let result = 1;
        for (let i = 1; i <= k; i++) {
            result = (result * (n - k + i)) / i;
        }
        return result;
    }

    function hypergeometricAtLeast(N, K, n, kMin) {
        if (kMin <= 0) return 1;
        if (kMin > K || kMin > n) return 0;
        const totalWays = choose(N, n);
        if (totalWays === 0) return 0;
        let prob = 0;
        const maxPossible = Math.min(K, n);
        for (let x = kMin; x <= maxPossible; x++) {
            prob += (choose(K, x) * choose(N - K, n - x)) / totalWays;
        }
        return Math.min(1, Math.max(0, prob));
    }

    // Auto-Classify Card Role (Ramp, Draw, Removal, Wipe, Land, Protection, Synergy)
    function classifyCardRole(card) {
        const type = (card.type || card.type_line || '').toLowerCase();
        const name = (card.name || '').toLowerCase();
        const oracle = (card.oracle_text || card.oracle || '').toLowerCase();

        if (type.includes('land')) return 'Lands';

        // Board Wipes
        if (/destroy all|exile all|all creatures get -|each player sacrifices all|return all nonland|blasphemous act|cyclonic rift|toxic deluge|farewell|austere command|supreme verdict|wrath of god|damnation|vanquish the horde/i.test(name + ' ' + oracle)) {
            return 'Board Wipes';
        }

        // Ramp
        if (/search your library for a.*land|add \{|adds one mana|treasure token|sol ring|arcane signet|fellwar stone|cultivate|kodama's reach|farseek|nature's lore|three visits|smothering tithe|birds of paradise|llanowar elves|elvish mystic|talisman of|signet|mana vault|dark ritual|jeska's will/i.test(name + ' ' + oracle)) {
            return 'Ramp';
        }

        // Card Draw / Advantage
        if (/draw a card|draw two|draw three|draw cards|draws a card|rhystic study|mystic remora|esper sentinel|sylvan library|necropotence|phyrexian arena|the one ring|guardian project|beast whisperer|skullclamp|harmonize|night's whisper|sign in blood|ponder|preordain|brainstorm/i.test(name + ' ' + oracle)) {
            return 'Card Draw';
        }

        // Targeted Removal / Countermagic
        if (/destroy target|exile target|counter target|target creature gets -|deals \d+ damage to target|swords to plowshares|path to exile|beast within|generous gift|chaos warp|assassin's trophy|anguished unmaking|pongify|rapid hybridization|swan song|fierce guardianship|mana drain|force of will|negate|counterspell|deflecting swat/i.test(name + ' ' + oracle)) {
            return 'Removal';
        }

        return 'Synergy & Threats';
    }

    function analyzeDeckRolesAndBracket() {
        const roles = {
            'Ramp': { count: 0, target: 10, color: '#34d399', icon: '🌱' },
            'Card Draw': { count: 0, target: 10, color: '#38bdf8', icon: '📜' },
            'Removal': { count: 0, target: 8, color: '#f87171', icon: '🎯' },
            'Board Wipes': { count: 0, target: 3, color: '#fb923c', icon: '💥' },
            'Lands': { count: 0, target: 37, color: '#a3e635', icon: '🏔️' },
            'Synergy & Threats': { count: 0, target: 31, color: '#c084fc', icon: '⚔️' }
        };

        const gameChangers = [];
        const mldCards = [];
        const extraTurns = [];
        const comboPieces = [];

        const allCards = [...currentDeck.mainboard];
        if (currentDeck.commander) {
            allCards.push({ ...currentDeck.commander, qty: 1 });
        }

        allCards.forEach(c => {
            const qty = c.qty || 1;
            const cleanName = (c.name || '').toLowerCase().split('//')[0].trim();
            if (!c.commander && (!currentDeck.commander || c.name !== currentDeck.commander.name)) {
                const role = c.role || classifyCardRole(c);
                c.role = role;
                if (roles[role]) roles[role].count += qty;
            }

            if (isOfficialGameChanger(cleanName)) gameChangers.push(c.name);
            if (MASS_LAND_DENIAL_CARDS.has(cleanName)) mldCards.push(c.name);
            if (EXTRA_TURN_CARDS.has(cleanName)) extraTurns.push(c.name);
            if (TWO_CARD_COMBO_PIECES.has(cleanName)) comboPieces.push(c.name);
        });

        // Calculate Official WotC Commander Bracket (1 - 5)
        let bracket = 2; // Core / Precon baseline
        let bracketName = 'Core (Precon Level)';
        let bracketReasons = [];

        if (gameChangers.length > 3 || mldCards.length > 0 || extraTurns.length > 2 || comboPieces.length >= 2) {
            bracket = 4;
            bracketName = 'Optimized / High Power';
            if (gameChangers.length > 3) bracketReasons.push(`${gameChangers.length} Game Changers (>3)`);
            if (mldCards.length > 0) bracketReasons.push(`Mass Land Denial (${mldCards.slice(0, 2).join(', ')})`);
            if (extraTurns.length > 2) bracketReasons.push(`${extraTurns.length} Extra Turn spells`);
            if (comboPieces.length >= 2) bracketReasons.push(`Combo Pieces (${comboPieces.slice(0, 2).join(' + ')})`);
            if (gameChangers.length >= 6 && comboPieces.length >= 2) {
                bracket = 5;
                bracketName = 'cEDH (Competitive)';
            }
        } else if (gameChangers.length >= 1 || extraTurns.length >= 1 || comboPieces.length === 1) {
            bracket = 3;
            bracketName = 'Upgraded (1–3 Game Changers)';
            if (gameChangers.length > 0) bracketReasons.push(`${gameChangers.length}/3 Game Changers (${gameChangers.join(', ')})`);
            if (extraTurns.length > 0) bracketReasons.push(`Extra Turn (${extraTurns.join(', ')})`);
        } else if (allCards.length > 0 && roles['Removal'].count <= 4 && roles['Board Wipes'].count <= 1) {
            bracket = 1;
            bracketName = 'Exhibition / Ultra-Casual';
            bracketReasons.push('0 Game Changers, No MLD, Light Interaction');
        } else {
            bracketReasons.push('0 Game Changers, No Mass Land Denial, Fair Pacing');
        }

        return { roles, bracket, bracketName, bracketReasons, gameChangers, mldCards, extraTurns };
    }

    window.openDeckBuilder = (deckText = '', commanderName = '', deckTitle = '') => {
        playSound('sfx-click');
        switchView('view-deck-builder');
        const container = document.getElementById('view-deck-builder');
        if (!container) return;

        if (deckText && typeof deckText === 'string' && deckText.trim()) {
            currentDeck = createBlankDeck(deckTitle || (commanderName ? `${commanderName} Brew` : 'Imported Commander Deck'));
            importDeckFromText(deckText);
        }
        if (commanderName && (!currentDeck.commander || currentDeck.commander.name !== commanderName)) {
            setCommander(commanderName);
        }

        saveArmoryToStorage();
        renderDeckBuilderView(container);
    };

    window.openSampleHandModal = (customCards = null) => {
        playSound('sfx-choose');
        let cardsPool = [];
        if (customCards && Array.isArray(customCards)) {
            cardsPool = customCards;
        } else {
            currentDeck.mainboard.forEach(c => {
                const qty = c.qty || 1;
                for (let i = 0; i < qty; i++) {
                    cardsPool.push({ ...c });
                }
            });
            if (cardsPool.length === 0) {
                showToast("Please add cards to your deck before drawing sample hands.", true);
                return;
            }
        }

        initMulliganSession(cardsPool);
        renderMulliganModal();
    };

    window.closeSampleHandModal = () => {
        const modal = document.getElementById('sampleHandModal');
        if (modal) modal.style.display = 'none';
    };

    window.calculateOptimalManaBase = (deckCards = null) => {
        const cards = deckCards || currentDeck.mainboard;
        const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
        let nonLandCount = 0;

        cards.forEach(c => {
            const isLand = (c.type || '').toLowerCase().includes('land');
            if (isLand) return;
            nonLandCount++;
            const cost = c.mana_cost || '';
            const qty = c.qty || 1;
            for (const color of ['W', 'U', 'B', 'R', 'G']) {
                const regex = new RegExp(`\\{${color}\\}|${color}`, 'g');
                const matches = cost.match(regex);
                if (matches) pips[color] += matches.length * qty;
            }
        });

        const totalPips = Object.values(pips).reduce((a, b) => a + b, 0);
        const targetBasics = 36;
        const recommendations = { W: 0, U: 0, B: 0, R: 0, G: 0 };

        if (totalPips > 0) {
            let allocated = 0;
            for (const [color, count] of Object.entries(pips)) {
                if (count > 0) {
                    const share = Math.round((count / totalPips) * targetBasics);
                    recommendations[color] = share;
                    allocated += share;
                }
            }
            const diff = targetBasics - allocated;
            if (diff !== 0) {
                const dominantColor = Object.entries(pips).sort((a,b) => b[1] - a[1])[0][0];
                recommendations[dominantColor] = Math.max(0, recommendations[dominantColor] + diff);
            }
        } else {
            const cmdrColors = currentDeck.commander?.color_identity || ['C'];
            const activeColors = cmdrColors.filter(c => ['W','U','B','R','G'].includes(c));
            if (activeColors.length > 0) {
                const perColor = Math.floor(targetBasics / activeColors.length);
                activeColors.forEach(c => recommendations[c] = perColor);
            } else {
                recommendations['W'] = 7; recommendations['U'] = 7; recommendations['B'] = 7; recommendations['R'] = 7; recommendations['G'] = 8;
            }
        }

        return { pips, totalPips, recommendations, targetBasics };
    };

    function initMulliganSession(cards) {
        simLibrary = [...cards].sort(() => Math.random() - 0.5);
        simHand = [];
        simBottomed = [];
        mulliganCount = 0;
        turnCount = 1;

        for (let i = 0; i < 7 && simLibrary.length > 0; i++) {
            simHand.push(simLibrary.pop());
        }
    }

    function doLondonMulligan() {
        playSound('sfx-click');
        mulliganCount++;
        const combined = [...simLibrary, ...simHand, ...simBottomed].sort(() => Math.random() - 0.5);
        simLibrary = combined;
        simHand = [];
        simBottomed = [];
        turnCount = 1;

        for (let i = 0; i < 7 && simLibrary.length > 0; i++) {
            simHand.push(simLibrary.pop());
        }
        renderMulliganModal();
        if (mulliganCount === 1) {
            showToast("Free Commander Mulligan! No cards need to be bottomed.", false, 3500);
        } else {
            showToast(`Mulligan #${mulliganCount}: Choose ${mulliganCount - 1} card(s) to place on bottom of library.`, false, 4000);
        }
    }

    function bottomCard(index) {
        if (simHand.length <= 0) return;
        const requiredBottoms = Math.max(0, mulliganCount - 1);
        if (simBottomed.length >= requiredBottoms) {
            showToast(`You have already bottomed ${requiredBottoms} card(s). Ready to play!`, false, 2500);
            return;
        }
        playSound('sfx-click');
        const card = simHand.splice(index, 1)[0];
        simBottomed.push(card);
        simLibrary.unshift(card);
        renderMulliganModal();
    }

    function drawTurnCard() {
        playSound('sfx-click');
        if (simLibrary.length === 0) {
            showToast("Your library is empty!", true);
            return;
        }
        turnCount++;
        simHand.push(simLibrary.pop());
        renderMulliganModal();
        showToast(`Turn ${turnCount}: Drew a card for turn!`, false, 2000);
    }

    function renderMulliganModal() {
        let modal = document.getElementById('sampleHandModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'sampleHandModal';
            modal.className = 'inspect-modal-overlay';
            document.body.appendChild(modal);
        }

        modal.style.display = 'flex';
        const requiredBottoms = Math.max(0, mulliganCount - 1);
        const needsBottom = simBottomed.length < requiredBottoms;

        const landsInHand = simHand.filter(c => (c.type || '').toLowerCase().includes('land')).length;
        const spellsInHand = simHand.length - landsInHand;

        let handCardsHtml = '';
        simHand.forEach((c, idx) => {
            const img = c.image || (c.image_uris?.normal) || 'card_back.webp';
            const safeName = sanitizeHTML(c.name || 'Card');
            handCardsHtml += `
                <div class="mulligan-card-item" onclick="window._bottomCardIndex(${idx})" title="${needsBottom ? 'Click to put on bottom of library' : safeName}">
                    <img src="${sanitizeHTML(img)}" alt="${safeName}" class="mulligan-card-img">
                    <span class="mulligan-card-name">${safeName}</span>
                    ${needsBottom ? `<button class="mulligan-bottom-badge">⬇ Bottom</button>` : ''}
                </div>
            `;
        });

        window._bottomCardIndex = bottomCard;

        modal.innerHTML = `
            <div class="inspect-modal-backdrop" onclick="document.getElementById('sampleHandModal').style.display='none'"></div>
            <div class="inspect-modal-container" style="max-width: 950px; width: 95%;">
                <button class="inspect-close-btn" onclick="document.getElementById('sampleHandModal').style.display='none'">✕</button>
                <div style="padding: 25px; text-align: left; width: 100%; box-sizing: border-box;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 15px; margin-bottom: 20px;">
                        <div>
                            <h2 style="font-family: Cinzel; color: var(--gold); margin: 0;">🃏 London Mulligan & Sample Hand</h2>
                            <p style="color: #aaa; margin: 4px 0 0 0; font-size: 0.9rem;">
                                Hand: <strong>${simHand.length} cards</strong> (${landsInHand} Lands, ${spellsInHand} Spells) • Library: <strong>${simLibrary.length} cards</strong> • Turn: <strong>${turnCount}</strong>
                            </p>
                        </div>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            <button class="select-btn" onclick="window._doMulligan()" style="width: auto; padding: 8px 16px; font-size: 0.9rem; background: #eab308; color: black; font-weight: bold;">
                                🔄 London Mulligan ${mulliganCount === 0 ? '(Free #1)' : `(Mulligan #${mulliganCount + 1})`}
                            </button>
                            <button class="secondary-btn" onclick="window._drawTurnCard()" style="padding: 8px 16px; font-size: 0.9rem; background: rgba(56,189,248,0.2); border: 1px solid #38bdf8; color: #38bdf8;">
                                📜 Draw for Turn (${turnCount + 1})
                            </button>
                            <button class="secondary-btn" onclick="window.openSampleHandModal()" style="padding: 8px 16px; font-size: 0.9rem;">
                                🎲 Fresh 7
                            </button>
                        </div>
                    </div>

                    ${needsBottom ? `
                        <div style="background: rgba(234,179,8,0.15); border: 1px solid #eab308; border-radius: 8px; padding: 12px 18px; margin-bottom: 20px; color: #fef08a; font-size: 0.95rem;">
                            ⚠️ <strong>London Mulligan Rule:</strong> Please select <strong>${requiredBottoms - simBottomed.length}</strong> card(s) from your hand below to place on the bottom of your library.
                        </div>
                    ` : ''}

                    <div class="mulligan-cards-grid" style="display: flex; flex-wrap: wrap; gap: 15px; justify-content: center; min-height: 250px;">
                        ${handCardsHtml}
                    </div>

                    ${simBottomed.length > 0 ? `
                        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 0.85rem; color: #888;">
                            ⬇ Bottomed Cards (${simBottomed.length}): ${simBottomed.map(c => sanitizeHTML(c.name)).join(', ')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        window._doMulligan = doLondonMulligan;
        window._drawTurnCard = drawTurnCard;
    }

    function renderDeckBuilderView(container) {
        const totalCards = currentDeck.mainboard.reduce((sum, c) => sum + (c.qty || 1), 0) + (currentDeck.commander ? 1 : 0);
        const manaData = window.calculateOptimalManaBase();
        const analysis = analyzeDeckRolesAndBracket();

        // Update hypergeometric defaults from live deck if untouched
        const landCount = analysis.roles['Lands'].count || 36;
        const rampCount = analysis.roles['Ramp'].count || 10;
        const t3ThreeLandsProb = (hypergeometricAtLeast(99, landCount, 9, 3) * 100).toFixed(1);
        const t2RampProb = (hypergeometricAtLeast(99, rampCount, 8, 1) * 100).toFixed(1);
        const customProb = (hypergeometricAtLeast(hyperPopSize, hyperSuccessesInDeck, hyperSampleDrawn, hyperTargetHits) * 100).toFixed(1);

        // CMC Curve
        const cmcDist = [0, 0, 0, 0, 0, 0, 0, 0];
        currentDeck.mainboard.forEach(c => {
            const isLand = (c.type || '').toLowerCase().includes('land');
            if (!isLand) {
                const cmc = Math.min(7, Math.max(0, Math.floor(c.cmc || 0)));
                cmcDist[cmc] += (c.qty || 1);
            }
        });
        const maxCmcCount = Math.max(1, ...cmcDist);

        const bracketColors = {
            1: '#94a3b8',
            2: '#34d399',
            3: '#38bdf8',
            4: '#f59e0b',
            5: '#ef4444'
        };
        const bColor = bracketColors[analysis.bracket] || '#38bdf8';

        let html = `
            <div class="view-top-breadcrumb">
                <button class="breadcrumb-btn" onclick="window.goToMainMenu()">
                    <span>🏠</span> Return to Hub
                </button>
            </div>

            <div class="deck-builder-container" style="max-width: 1240px; margin: 0 auto; padding: 20px;">
                <!-- MY ARMORY MULTI-DECK BAR -->
                <div style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 10px; padding: 12px 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <span style="font-family: Cinzel; font-weight: 800; color: var(--gold); font-size: 0.92rem;">🛡️ MY ARMORY:</span>
                        <select id="armoryDeckSelect" onchange="window._switchArmoryDeck(this.value)" style="padding: 7px 12px; border-radius: 6px; background: #0f172a; color: #fff; border: 1px solid rgba(255,255,255,0.2); font-weight: 600; min-width: 230px;">
                            ${armoryDecks.map(d => {
                                const cnt = (d.mainboard || []).reduce((s, c) => s + (c.qty || 1), 0) + (d.commander ? 1 : 0);
                                return `<option value="${sanitizeHTML(d.id)}" ${d.id === currentDeck.id ? 'selected' : ''}>${sanitizeHTML(d.name)} (${cnt}/100)</option>`;
                            }).join('')}
                        </select>
                        <button type="button" class="secondary-btn" onclick="window._renameArmoryDeck()" style="padding: 6px 12px; font-size: 0.8rem;">✏️ Rename</button>
                        <button type="button" class="secondary-btn" onclick="window._createNewArmoryDeck()" style="padding: 6px 12px; font-size: 0.8rem; border-color: #34d399; color: #34d399;">+ New Deck</button>
                        <button type="button" class="secondary-btn" onclick="window._deleteArmoryDeck()" style="padding: 6px 10px; font-size: 0.8rem; color: #f87171;">🗑️</button>
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button type="button" class="select-btn" onclick="window._playtestBuilderDeckInArena()" style="width: auto; padding: 7px 14px; font-size: 0.82rem; background: linear-gradient(135deg, #9333ea, #7e22ce); border-color: #a855f7;">
                            ⚔️ Playtest in Arena
                        </button>
                        <button type="button" class="secondary-btn" onclick="window._compareBuilderWithCollection()" style="padding: 7px 12px; font-size: 0.82rem; border-color: #38bdf8; color: #38bdf8;">
                            🔄 Compare Owned
                        </button>
                        <button type="button" class="secondary-btn" onclick="window._printBuilderProxies()" style="padding: 7px 12px; font-size: 0.82rem; border-color: #c084fc; color: #c084fc;">
                            🖨️ Print Proxies
                        </button>
                    </div>
                </div>

                <!-- Hero Header -->
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px; margin-bottom: 22px;">
                    <div>
                        <div class="hero-badge">✦ MTG Command Center ✦</div>
                        <h1 style="font-family: Cinzel; color: var(--gold); margin: 5px 0 0 0; font-size: 1.9rem;">${sanitizeHTML(currentDeck.name)}</h1>
                        <p style="color: #aaa; margin: 4px 0 0 0; font-size: 0.92rem;">Brew, analyze WotC Power Brackets, check hypergeometric draw odds, and test opening hands.</p>
                    </div>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button class="select-btn" onclick="window.openSampleHandModal()" style="width: auto; padding: 10px 18px; font-size: 0.88rem; background: #eab308; color: black; font-weight: bold;">
                            🃏 Test Opening Hand
                        </button>
                        <button class="secondary-btn" onclick="window._applyAutoLands()" style="padding: 10px 16px; font-size: 0.88rem; border: 1px solid #38bdf8; color: #38bdf8;">
                            ⚡ Auto-Balance Lands
                        </button>
                        <button class="secondary-btn" onclick="window._exportDecklist()" style="padding: 10px 16px; font-size: 0.88rem;">
                            📋 Export Decklist
                        </button>
                        <button class="secondary-btn" onclick="window._importDecklistPrompt()" style="padding: 10px 16px; font-size: 0.88rem;">
                            📥 Import Text
                        </button>
                    </div>
                </div>

                <!-- Stats Dashboard Row (Deck Size, Official Bracket, Mana Devotion, Recommended Basics) -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 20px;">
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 14px; text-align: center;">
                        <span style="font-size: 0.76rem; color: #888; text-transform: uppercase; font-weight: 700;">Deck Size</span>
                        <div style="font-size: 1.9rem; font-family: Cinzel; color: ${totalCards === 100 ? '#4ade80' : 'var(--gold)'}; font-weight: bold;">
                            ${totalCards} / 100
                        </div>
                        <span style="font-size: 0.75rem; color: ${totalCards === 100 ? '#4ade80' : '#888'};">${totalCards === 100 ? '✅ Format Legal (100)' : `${100 - totalCards} cards remaining`}</span>
                    </div>

                    <!-- Official WotC Power Bracket Card -->
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid ${bColor}55; border-radius: 8px; padding: 14px; text-align: center;">
                        <span style="font-size: 0.76rem; color: #888; text-transform: uppercase; font-weight: 700;">Official Commander Bracket</span>
                        <div style="font-size: 1.45rem; font-family: Cinzel; color: ${bColor}; font-weight: 900; margin-top: 2px;">
                            Bracket ${analysis.bracket}: ${analysis.bracketName}
                        </div>
                        <div style="font-size: 0.73rem; color: #cbd5e1; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${sanitizeHTML(analysis.bracketReasons.join(' • '))}">
                            ${sanitizeHTML(analysis.bracketReasons.join(' • '))}
                        </div>
                    </div>

                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 14px;">
                        <span style="font-size: 0.76rem; color: #888; text-transform: uppercase; display: block; margin-bottom: 8px; font-weight: 700; text-align: center;">Mana Devotion Pips</span>
                        <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap;">
                            <span title="White" style="background:#fef08a; color:#854d0e; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:0.82rem;">W: ${manaData.pips.W}</span>
                            <span title="Blue" style="background:#bae6fd; color:#0369a1; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:0.82rem;">U: ${manaData.pips.U}</span>
                            <span title="Black" style="background:#cbd5e1; color:#0f172a; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:0.82rem;">B: ${manaData.pips.B}</span>
                            <span title="Red" style="background:#fecaca; color:#991b1b; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:0.82rem;">R: ${manaData.pips.R}</span>
                            <span title="Green" style="background:#bbf7d0; color:#166534; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:0.82rem;">G: ${manaData.pips.G}</span>
                        </div>
                    </div>

                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 14px;">
                        <span style="font-size: 0.76rem; color: #888; text-transform: uppercase; display: block; margin-bottom: 8px; font-weight: 700; text-align: center;">Recommended Basics (36)</span>
                        <div style="font-size: 0.82rem; color: #ddd; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
                            <span>W: <strong>${manaData.recommendations.W}</strong></span>
                            <span>U: <strong>${manaData.recommendations.U}</strong></span>
                            <span>B: <strong>${manaData.recommendations.B}</strong></span>
                            <span>R: <strong>${manaData.recommendations.R}</strong></span>
                            <span>G: <strong>${manaData.recommendations.G}</strong></span>
                        </div>
                    </div>
                </div>

                <!-- Deck Role Template Checklist & Hypergeometric Draw Odds Row -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; margin-bottom: 22px;">
                    <!-- Auto-Role Tagging Checklist -->
                    <div style="background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px 18px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <span style="font-size: 0.85rem; color: var(--gold); font-family: Cinzel; font-weight: bold;">🎯 Commander Deck Template Health</span>
                            <span style="font-size: 0.75rem; color: #94a3b8;">Auto-tagged by card function</span>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px;">
                            ${Object.entries(analysis.roles).map(([roleName, r]) => {
                                const pct = Math.min(100, Math.round((r.count / r.target) * 100));
                                return `
                                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 6px; padding: 8px 10px;">
                                        <div style="display: flex; justify-content: space-between; font-size: 0.78rem; margin-bottom: 4px;">
                                            <span style="color: #e2e8f0; font-weight: 600;">${r.icon} ${roleName}</span>
                                            <span style="color: ${r.color}; font-weight: 800; font-family: monospace;">${r.count}/${r.target}</span>
                                        </div>
                                        <div style="height: 5px; background: rgba(255,255,255,0.08); border-radius: 99px; overflow: hidden;">
                                            <div style="height: 100%; width: ${pct}%; background: ${r.color};"></div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>

                    <!-- Hypergeometric Draw Probability Calculator -->
                    <div style="background: rgba(0,0,0,0.35); border: 1px solid rgba(56,189,248,0.22); border-radius: 10px; padding: 14px 18px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 0.85rem; color: #38bdf8; font-family: Cinzel; font-weight: bold;">📐 Hypergeometric Draw Odds</span>
                            <div style="display: flex; gap: 8px; font-size: 0.74rem;">
                                <span style="background: rgba(163,230,53,0.15); color: #a3e635; padding: 2px 7px; border-radius: 4px; font-weight: 700;">3+ Lands by T3: ${t3ThreeLandsProb}%</span>
                                <span style="background: rgba(52,211,153,0.15); color: #34d399; padding: 2px 7px; border-radius: 4px; font-weight: 700;">1+ Ramp by T2: ${t2RampProb}%</span>
                            </div>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; align-items: end; margin-top: 8px;">
                            <div>
                                <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 3px;">Deck Size (N)</label>
                                <input type="number" id="hyperN" value="${hyperPopSize}" min="40" max="100" onchange="window._updateHyperCalc()" style="width: 100%; padding: 6px; font-size: 0.82rem; background: #0f172a; color: #fff; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; box-sizing: border-box;">
                            </div>
                            <div>
                                <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 3px;">Copies in Deck (K)</label>
                                <input type="number" id="hyperK" value="${hyperSuccessesInDeck}" min="1" max="99" onchange="window._updateHyperCalc()" style="width: 100%; padding: 6px; font-size: 0.82rem; background: #0f172a; color: #fff; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; box-sizing: border-box;">
                            </div>
                            <div>
                                <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 3px;">Cards Seen (n)</label>
                                <input type="number" id="hyperSample" value="${hyperSampleDrawn}" min="1" max="99" onchange="window._updateHyperCalc()" style="width: 100%; padding: 6px; font-size: 0.82rem; background: #0f172a; color: #fff; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; box-sizing: border-box;">
                            </div>
                            <div>
                                <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 3px;">Desired Hits (k+)</label>
                                <input type="number" id="hyperHits" value="${hyperTargetHits}" min="1" max="20" onchange="window._updateHyperCalc()" style="width: 100%; padding: 6px; font-size: 0.82rem; background: #0f172a; color: #fff; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; box-sizing: border-box;">
                            </div>
                        </div>
                        <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center; background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.3); border-radius: 6px; padding: 6px 12px;">
                            <span style="font-size: 0.8rem; color: #cbd5e1;">Odds of drawing <strong>${hyperTargetHits}+</strong> copies in <strong>${hyperSampleDrawn}</strong> cards:</span>
                            <span id="hyperResultVal" style="font-size: 1.05rem; font-weight: 900; color: #38bdf8; font-family: monospace;">${customProb}%</span>
                        </div>
                    </div>
                </div>

                <!-- Mana Curve Bar Visualizer -->
                <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 15px 20px; margin-bottom: 22px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <span style="font-size: 0.85rem; color: var(--gold); font-family: Cinzel; font-weight: bold;">Mana Curve Distribution</span>
                        <span style="font-size: 0.8rem; color: #888;">Non-Land Spells by Mana Value</span>
                    </div>
                    <div style="display: flex; align-items: flex-end; gap: 12px; height: 95px; padding-top: 10px;">
                        ${cmcDist.map((cnt, i) => `
                            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end;">
                                <span style="font-size: 0.75rem; color: #aaa; margin-bottom: 4px;">${cnt}</span>
                                <div style="width: 100%; background: linear-gradient(to top, var(--gold), #fef08a); height: ${(cnt / maxCmcCount) * 65}px; border-radius: 4px 4px 0 0; min-height: ${cnt > 0 ? '4px' : '0'};"></div>
                                <span style="font-size: 0.8rem; color: #888; margin-top: 4px;">${i === 7 ? '7+' : i}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Live Card Search / Add Bar -->
                <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 15px; margin-bottom: 22px; position: relative;">
                    <div style="display: flex; gap: 10px;">
                        <input type="text" id="deckSearchInput" placeholder="🔍 Search Scryfall to add cards (e.g. Sol Ring, Rhystic Study, Demonic Tutor)..." style="flex: 1; padding: 12px 16px; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: white; font-size: 1rem;">
                        <button class="select-btn" id="deckSearchAddBtn" style="width: auto; padding: 0 25px;">Add</button>
                    </div>
                    <div id="deckSearchResultsDropdown" style="display: none; position: absolute; left: 15px; right: 15px; top: 70px; background: #111; border: 1px solid var(--gold); border-radius: 6px; z-index: 100; max-height: 280px; overflow-y: auto;"></div>
                </div>

                <!-- Commander Section -->
                <div style="background: rgba(212,175,55,0.05); border: 1px solid rgba(212,175,55,0.3); border-radius: 8px; padding: 15px 20px; margin-bottom: 22px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 15px;">
                    <div>
                        <span style="font-size: 0.8rem; color: var(--gold); text-transform: uppercase; font-family: Cinzel; font-weight: bold;">👑 Commander</span>
                        <div style="font-size: 1.3rem; color: white; font-weight: bold; margin-top: 4px;">
                            ${currentDeck.commander ? sanitizeHTML(currentDeck.commander.name) : '<span style="color:#888; font-style:italic;">No Commander Assigned</span>'}
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button class="secondary-btn" onclick="window._setCommanderPrompt()" style="padding: 6px 14px; font-size: 0.85rem;">
                            ${currentDeck.commander ? 'Change Commander' : '+ Set Commander'}
                        </button>
                        ${currentDeck.commander ? `
                            <button class="secondary-btn" onclick="window.openCardInspector('${sanitizeHTML(currentDeck.commander.name)}')" style="padding: 6px 14px; font-size: 0.85rem;">
                                ✨ 3D Inspect
                            </button>
                        ` : ''}
                    </div>
                </div>

                <!-- Deck Card List Grid -->
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px;">
                    ${renderDeckCategoriesHtml()}
                </div>
            </div>
        `;

        container.innerHTML = html;
        attachSearchEvents();
    }

    function renderDeckCategoriesHtml() {
        const categories = {
            'Creatures': [],
            'Instants & Sorceries': [],
            'Artifacts & Enchantments': [],
            'Lands': [],
            'Other Spells': []
        };

        currentDeck.mainboard.forEach((c, idx) => {
            const t = (c.type || '').toLowerCase();
            if (t.includes('creature')) categories['Creatures'].push({ card: c, idx });
            else if (t.includes('instant') || t.includes('sorcery')) categories['Instants & Sorceries'].push({ card: c, idx });
            else if (t.includes('artifact') || t.includes('enchantment')) categories['Artifacts & Enchantments'].push({ card: c, idx });
            else if (t.includes('land')) categories['Lands'].push({ card: c, idx });
            else categories['Other Spells'].push({ card: c, idx });
        });

        return Object.entries(categories).map(([catName, items]) => {
            const catCount = items.reduce((sum, item) => sum + (item.card.qty || 1), 0);
            return `
                <div style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px; margin-bottom: 10px;">
                        <h4 style="font-family: Cinzel; color: var(--gold); margin: 0; font-size: 0.95rem;">${catName}</h4>
                        <span style="font-size: 0.8rem; color: #888;">${catCount}</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 6px; max-height: 380px; overflow-y: auto;">
                        ${items.length === 0 ? '<span style="color:#666; font-size:0.85rem; font-style:italic;">No cards in category</span>' : ''}
                        ${items.map(item => {
                            const isGC = isOfficialGameChanger(item.card.name);
                            return `
                                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 6px 10px; border-radius: 4px;">
                                    <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                                        <span style="font-weight: bold; color: var(--gold); font-size: 0.85rem;">${item.card.qty || 1}x</span>
                                        <span style="color: #ddd; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;" onclick="window.openCardInspector('${sanitizeHTML(item.card.name)}')">
                                            ${sanitizeHTML(item.card.name)}
                                        </span>
                                        ${isGC ? `<span title="Official WotC Game Changer" style="font-size:0.7rem;">⚠️</span>` : ''}
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 4px;">
                                        <button onclick="window._modifyCardQty(${item.idx}, 1)" style="padding: 2px 6px; background: #333; border: none; color: white; border-radius: 2px; cursor: pointer;">+</button>
                                        <button onclick="window._modifyCardQty(${item.idx}, -1)" style="padding: 2px 6px; background: #333; border: none; color: white; border-radius: 2px; cursor: pointer;">-</button>
                                        <button onclick="window._removeCard(${item.idx})" style="padding: 2px 6px; background: rgba(239,68,68,0.2); border: 1px solid #ef4444; color: #ef4444; border-radius: 2px; cursor: pointer;">✕</button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

    window._updateHyperCalc = () => {
        hyperPopSize = Math.max(1, parseInt(document.getElementById('hyperN')?.value || '99', 10));
        hyperSuccessesInDeck = Math.max(0, parseInt(document.getElementById('hyperK')?.value || '37', 10));
        hyperSampleDrawn = Math.max(1, parseInt(document.getElementById('hyperSample')?.value || '10', 10));
        hyperTargetHits = Math.max(1, parseInt(document.getElementById('hyperHits')?.value || '3', 10));
        const cEl = document.getElementById('view-deck-builder');
        if (cEl) renderDeckBuilderView(cEl);
    };

    window._switchArmoryDeck = (deckId) => {
        playSound('sfx-click');
        const found = armoryDecks.find(d => d.id === deckId);
        if (found) {
            currentDeck = found;
            const cEl = document.getElementById('view-deck-builder');
            if (cEl) renderDeckBuilderView(cEl);
        }
    };

    window._createNewArmoryDeck = () => {
        const name = prompt("Enter name for new Armory Deck:", `Commander Brew #${armoryDecks.length + 1}`);
        if (!name || !name.trim()) return;
        currentDeck = createBlankDeck(name.trim());
        saveArmoryToStorage();
        const cEl = document.getElementById('view-deck-builder');
        if (cEl) renderDeckBuilderView(cEl);
        showToast(`Created "${currentDeck.name}" in My Armory!`, false, 2500, true);
    };

    window._renameArmoryDeck = () => {
        const name = prompt("Rename Deck:", currentDeck.name || 'Untitled Commander Deck');
        if (!name || !name.trim()) return;
        currentDeck.name = name.trim();
        saveArmoryToStorage();
        const cEl = document.getElementById('view-deck-builder');
        if (cEl) renderDeckBuilderView(cEl);
    };

    window._deleteArmoryDeck = () => {
        if (armoryDecks.length <= 1) {
            currentDeck = createBlankDeck('Untitled Commander Deck');
            armoryDecks = [currentDeck];
            saveArmoryToStorage();
            const cEl = document.getElementById('view-deck-builder');
            if (cEl) renderDeckBuilderView(cEl);
            return;
        }
        armoryDecks = armoryDecks.filter(d => d.id !== currentDeck.id);
        currentDeck = armoryDecks[0];
        localStorage.setItem(ARMORY_STORAGE_KEY, JSON.stringify(armoryDecks));
        syncArmoryDropdowns();
        const cEl = document.getElementById('view-deck-builder');
        if (cEl) renderDeckBuilderView(cEl);
        showToast("Deleted deck from Armory.", false, 2000);
    };

    window._playtestBuilderDeckInArena = () => {
        playSound('sfx-choose');
        const text = window.exportCurrentBuilderDeckText();
        if (!text.trim()) {
            showToast("Add some cards to your deck first before launching Commander Arena!", true);
            return;
        }
        if (typeof window.openCommanderArena === 'function') {
            window.openCommanderArena({
                id: currentDeck.id,
                name: currentDeck.name,
                commander: currentDeck.commander?.name || currentDeck.name,
                content: text
            });
        }
    };

    window._compareBuilderWithCollection = () => {
        playSound('sfx-click');
        const text = window.exportCurrentBuilderDeckText();
        if (!text.trim()) {
            showToast("Add some cards to your deck first!", true);
            return;
        }
        if (typeof window.openCollectionTab === 'function') {
            window.openCollectionTab('deck', { preloadDeck: text, preloadDeckName: currentDeck.name });
        }
    };

    window._printBuilderProxies = () => {
        playSound('sfx-click');
        const allCards = [...currentDeck.mainboard];
        if (currentDeck.commander) {
            allCards.unshift({ ...currentDeck.commander, qty: 1 });
        }
        if (allCards.length === 0) {
            showToast("Add cards to your deck first to print proxies!", true);
            return;
        }
        if (typeof window.openProxyPrinterModal === 'function') {
            window.openProxyPrinterModal(allCards, currentDeck.name);
        }
    };

    function attachSearchEvents() {
        const searchInput = document.getElementById('deckSearchInput');
        const dropdown = document.getElementById('deckSearchResultsDropdown');
        if (!searchInput || !dropdown) return;

        let debounceTimer = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            const q = searchInput.value.trim();
            if (q.length < 2) {
                dropdown.style.display = 'none';
                return;
            }
            debounceTimer = setTimeout(async () => {
                try {
                    const res = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}`);
                    if (res.ok) {
                        const data = await res.json();
                        const names = data.data || [];
                        if (names.length > 0) {
                            dropdown.innerHTML = names.slice(0, 8).map(name => `
                                <div style="padding: 8px 14px; border-bottom: 1px solid #222; cursor: pointer; color: white;" onmouseover="this.style.background='#222'" onmouseout="this.style.background='transparent'" onclick="window._selectCardFromSearch('${sanitizeHTML(name)}')">
                                    ${sanitizeHTML(name)}
                                </div>
                            `).join('');
                            dropdown.style.display = 'block';
                        } else {
                            dropdown.style.display = 'none';
                        }
                    }
                } catch(e) { console.warn("Scryfall autocomplete failed:", e); }
            }, 250);
        });

        document.getElementById('deckSearchAddBtn').onclick = () => {
            const val = searchInput.value.trim();
            if (val) window._selectCardFromSearch(val);
        };
    }

    window._selectCardFromSearch = async (cardName) => {
        playSound('sfx-click');
        const dropdown = document.getElementById('deckSearchResultsDropdown');
        if (dropdown) dropdown.style.display = 'none';
        const searchInput = document.getElementById('deckSearchInput');
        if (searchInput) searchInput.value = '';

        showToast(`Adding ${cardName}...`, false, 1500);
        try {
            const res = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`);
            if (res.ok) {
                const c = await res.json();
                const existing = currentDeck.mainboard.find(x => x.name.toLowerCase() === c.name.toLowerCase());
                if (existing) {
                    existing.qty = (existing.qty || 1) + 1;
                } else {
                    const cardEntry = {
                        name: c.name,
                        qty: 1,
                        type: c.type_line || '',
                        oracle_text: c.oracle_text || c.card_faces?.[0]?.oracle_text || '',
                        cmc: c.cmc || 0,
                        colors: c.colors || [],
                        color_identity: c.color_identity || [],
                        image: c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || 'card_back.webp',
                        scryfall_uri: c.scryfall_uri || '',
                        mana_cost: c.mana_cost || c.card_faces?.[0]?.mana_cost || ''
                    };
                    cardEntry.role = classifyCardRole(cardEntry);
                    currentDeck.mainboard.push(cardEntry);
                }
                saveArmoryToStorage();
                const container = document.getElementById('view-deck-builder');
                if (container && container.classList.contains('active')) renderDeckBuilderView(container);
                showToast(`Added ${c.name}!`, false, 2000, true);
            }
        } catch(e) {
            showToast("Failed to fetch card from Scryfall.", true);
        }
    };

    window._modifyCardQty = (idx, delta) => {
        const item = currentDeck.mainboard[idx];
        if (!item) return;
        playSound('sfx-click');
        item.qty = Math.max(1, (item.qty || 1) + delta);
        saveArmoryToStorage();
        const container = document.getElementById('view-deck-builder');
        if (container) renderDeckBuilderView(container);
    };

    window._removeCard = (idx) => {
        playSound('sfx-click');
        currentDeck.mainboard.splice(idx, 1);
        saveArmoryToStorage();
        const container = document.getElementById('view-deck-builder');
        if (container) renderDeckBuilderView(container);
    };

    window._setCommanderPrompt = () => {
        const name = prompt("Enter Commander Name:", currentDeck.commander?.name || '');
        if (name && name.trim()) setCommander(name.trim());
    };

    async function setCommander(cardName) {
        try {
            const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`);
            if (res.ok) {
                const c = await res.json();
                currentDeck.commander = {
                    name: c.name,
                    color_identity: c.color_identity || [],
                    image: c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || 'card_back.webp'
                };
                if (currentDeck.name === 'Untitled Commander Deck') {
                    currentDeck.name = `${c.name} Deck`;
                }
                saveArmoryToStorage();
                const container = document.getElementById('view-deck-builder');
                if (container) renderDeckBuilderView(container);
                showToast(`Commander set to ${c.name}!`, false, 3000, true);
            }
        } catch(e) {
            showToast("Could not find commander.", true);
        }
    }

    window._applyAutoLands = () => {
        playSound('sfx-choose');
        const manaData = window.calculateOptimalManaBase();
        const lands = [
            { name: 'Plains', qty: manaData.recommendations.W, type: 'Basic Land — Plains', mana_cost: '{W}' },
            { name: 'Island', qty: manaData.recommendations.U, type: 'Basic Land — Island', mana_cost: '{U}' },
            { name: 'Swamp', qty: manaData.recommendations.B, type: 'Basic Land — Swamp', mana_cost: '{B}' },
            { name: 'Mountain', qty: manaData.recommendations.R, type: 'Basic Land — Mountain', mana_cost: '{R}' },
            { name: 'Forest', qty: manaData.recommendations.G, type: 'Basic Land — Forest', mana_cost: '{G}' }
        ];

        currentDeck.mainboard = currentDeck.mainboard.filter(c => !['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'].includes(c.name));

        lands.forEach(l => {
            if (l.qty > 0) {
                currentDeck.mainboard.push({
                    name: l.name,
                    qty: l.qty,
                    type: l.type,
                    role: 'Lands',
                    cmc: 0,
                    colors: [],
                    color_identity: [],
                    image: 'card_back.webp',
                    scryfall_uri: `https://scryfall.com/search?q=${l.name}`,
                    mana_cost: ''
                });
            }
        });

        saveArmoryToStorage();
        const container = document.getElementById('view-deck-builder');
        if (container) renderDeckBuilderView(container);
        showToast("Auto-balanced basic land distribution!", false, 3000, true);
    };

    window._exportDecklist = () => {
        playSound('sfx-click');
        let text = '';
        if (currentDeck.commander) {
            text += `// Commander\n1 ${currentDeck.commander.name}\n\n`;
        }
        text += '// Mainboard\n';
        currentDeck.mainboard.forEach(c => {
            text += `${c.qty || 1} ${c.name}\n`;
        });

        navigator.clipboard.writeText(text).then(() => {
            showToast("Decklist copied to clipboard (Moxfield / Archidekt format)!", false, 3500, true);
        }).catch(() => {
            alert(text);
        });
    };

    window._importDecklistPrompt = () => {
        const text = prompt("Paste decklist text (e.g. 1 Sol Ring, 1 Demonic Tutor):");
        if (text) importDeckFromText(text);
    };

    function importDeckFromText(text) {
        showToast("Parsing decklist...", false, 2000);
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const imported = [];
        let cmdr = null;

        lines.forEach(line => {
            if (line.startsWith('//') || line.startsWith('#')) return;
            const match = line.match(/^(\d+)?\s*x?\s*(.+)$/i);
            if (match) {
                const qty = parseInt(match[1] || '1', 10);
                const rawName = match[2].replace(/\*.*?\*/g, '').replace(/\(.*?\)/g, '').replace(/\s+\d+[a-z]*$/i, '').trim();
                if (!rawName) return;
                if (line.includes('*CMDR*') || line.includes('# Commander')) {
                    cmdr = rawName;
                } else {
                    const cached = window.__MTG_CARD_CACHE__ ? window.__MTG_CARD_CACHE__[rawName.toLowerCase()] : null;
                    const typeLine = cached?.typeLine || (rawName.toLowerCase().includes('land') || (typeof window.isLandCard === 'function' && window.isLandCard({ name: rawName })) ? 'Land' : 'Spell');
                    const cardObj = {
                        name: rawName,
                        qty: qty,
                        type: typeLine,
                        oracle_text: cached?.oracleText || '',
                        cmc: cached?.cmc !== undefined ? cached.cmc : (typeLine.toLowerCase().includes('land') ? 0 : 2),
                        colors: [],
                        color_identity: [],
                        image: 'card_back.webp',
                        scryfall_uri: `https://scryfall.com/search?q=${encodeURIComponent(rawName)}`,
                        mana_cost: cached?.manaCost || ''
                    };
                    cardObj.role = classifyCardRole(cardObj);
                    imported.push(cardObj);
                }
            }
        });

        currentDeck.mainboard = imported;
        if (cmdr) setCommander(cmdr);
        saveArmoryToStorage();
        const container = document.getElementById('view-deck-builder');
        if (container) renderDeckBuilderView(container);
        showToast(`Imported ${imported.length} unique card entries!`, false, 3000, true);
    }

    // Mount post-draft fallback compatibility
    window.renderDeckBuilder = async (cards, container) => {
        window.openDeckBuilder();
        if (cards && Array.isArray(cards)) {
            currentDeck.mainboard = cards.map(c => {
                const item = {
                    name: c.name,
                    qty: c.qty || 1,
                    type: c.type_line || c.type || '',
                    oracle_text: c.oracle_text || '',
                    cmc: c.cmc || 0,
                    colors: c.colors || [],
                    color_identity: c.color_identity || [],
                    image: c.image_uris?.normal || c.image || 'card_back.webp',
                    scryfall_uri: c.scryfall_uri || '',
                    mana_cost: c.mana_cost || ''
                };
                item.role = classifyCardRole(item);
                return item;
            });
            saveArmoryToStorage();
            const cEl = document.getElementById('view-deck-builder');
            if (cEl) renderDeckBuilderView(cEl);
        }
    };

    syncArmoryDropdowns();
}
