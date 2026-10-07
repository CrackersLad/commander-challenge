// Native Standalone Deck Builder, Opening Hand Simulator, and Mana Base Optimizer

export function initDeckBuilderModule(utils, state) {
    const { sanitizeHTML, playSound, showToast, showConfirm, switchView } = utils;

    // Local Deck State
    let currentDeck = {
        name: 'Untitled Commander Deck',
        commander: null,
        mainboard: [], // Array of { name, qty, type, cmc, colors, color_identity, image, scryfall_uri, mana_cost }
        sideboard: []
    };

    // Mulligan Simulator State
    let simLibrary = [];
    let simHand = [];
    let simBottomed = [];
    let mulliganCount = 0;
    let turnCount = 0;

    window.openDeckBuilder = (deckText = '', commanderName = '') => {
        playSound('sfx-click');
        switchView('view-deck-builder');
        const container = document.getElementById('view-deck-builder');
        if (!container) return;

        if (deckText) {
            importDeckFromText(deckText);
        }
        if (commanderName && !currentDeck.commander) {
            setCommander(commanderName);
        }

        renderDeckBuilderView(container);
    };

    window.openSampleHandModal = (customCards = null) => {
        playSound('sfx-choose');
        let cardsPool = [];
        if (customCards && Array.isArray(customCards)) {
            cardsPool = customCards;
        } else {
            // Expand mainboard by quantity
            currentDeck.mainboard.forEach(c => {
                const qty = c.qty || 1;
                for (let i = 0; i < qty; i++) {
                    cardsPool.push({ ...c });
                }
            });
            if (cardsPool.length === 0) {
                // Fallback to sample precon pool or warning
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
            // Adjust difference
            const diff = targetBasics - allocated;
            if (diff !== 0) {
                const dominantColor = Object.entries(pips).sort((a,b) => b[1] - a[1])[0][0];
                recommendations[dominantColor] = Math.max(0, recommendations[dominantColor] + diff);
            }
        } else {
            // Default split across commander identity
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
        // Shuffle cards
        simLibrary = [...cards].sort(() => Math.random() - 0.5);
        simHand = [];
        simBottomed = [];
        mulliganCount = 0;
        turnCount = 1;

        // Draw 7
        for (let i = 0; i < 7 && simLibrary.length > 0; i++) {
            simHand.push(simLibrary.pop());
        }
    }

    function doLondonMulligan() {
        playSound('sfx-click');
        mulliganCount++;
        // Shuffle hand and bottomed back into library
        const combined = [...simLibrary, ...simHand, ...simBottomed].sort(() => Math.random() - 0.5);
        simLibrary = combined;
        simHand = [];
        simBottomed = [];
        turnCount = 1;

        // In London Mulligan, you always draw 7
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
        simLibrary.unshift(card); // Put on bottom of library
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

        // Group Hand cards
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

        // CMC Curve
        const cmcDist = [0, 0, 0, 0, 0, 0, 0, 0]; // 0, 1, 2, 3, 4, 5, 6, 7+
        currentDeck.mainboard.forEach(c => {
            const isLand = (c.type || '').toLowerCase().includes('land');
            if (!isLand) {
                const cmc = Math.min(7, Math.max(0, Math.floor(c.cmc || 0)));
                cmcDist[cmc] += (c.qty || 1);
            }
        });
        const maxCmcCount = Math.max(1, ...cmcDist);

        let html = `
            <div class="view-top-breadcrumb">
                <button class="breadcrumb-btn" onclick="window.goToMainMenu()">
                    <span>🏠</span> Return to Hub
                </button>
            </div>

            <div class="deck-builder-container" style="max-width: 1200px; margin: 0 auto; padding: 20px;">
                <!-- Hero Header -->
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px; margin-bottom: 25px;">
                    <div>
                        <div class="hero-badge">✦ MTG Command Center ✦</div>
                        <h1 style="font-family: Cinzel; color: var(--gold); margin: 5px 0 0 0; font-size: 2rem;">Native Deck Builder</h1>
                        <p style="color: #aaa; margin: 4px 0 0 0; font-size: 0.95rem;">Brew, test opening hands, and optimize your Commander deck directly in the browser.</p>
                    </div>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button class="select-btn" onclick="window.openSampleHandModal()" style="width: auto; padding: 10px 20px; font-size: 0.9rem; background: #eab308; color: black; font-weight: bold;">
                            🃏 Test Opening Hand
                        </button>
                        <button class="secondary-btn" onclick="window._applyAutoLands()" style="padding: 10px 18px; font-size: 0.9rem; border: 1px solid #38bdf8; color: #38bdf8;">
                            ⚡ Auto-Balance Lands
                        </button>
                        <button class="secondary-btn" onclick="window._exportDecklist()" style="padding: 10px 18px; font-size: 0.9rem;">
                            📋 Export Decklist
                        </button>
                        <button class="secondary-btn" onclick="window._importDecklistPrompt()" style="padding: 10px 18px; font-size: 0.9rem;">
                            📥 Import Text
                        </button>
                    </div>
                </div>

                <!-- Stats Dashboard Row -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px;">
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 15px; text-align: center;">
                        <span style="font-size: 0.8rem; color: #888; text-transform: uppercase;">Deck Size</span>
                        <div style="font-size: 2rem; font-family: Cinzel; color: ${totalCards === 100 ? '#4ade80' : 'var(--gold)'}; font-weight: bold;">
                            ${totalCards} / 100
                        </div>
                        <span style="font-size: 0.75rem; color: ${totalCards === 100 ? '#4ade80' : '#888'};">${totalCards === 100 ? '✅ Format Legal' : `${100 - totalCards} cards needed`}</span>
                    </div>

                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 15px;">
                        <span style="font-size: 0.8rem; color: #888; text-transform: uppercase; display: block; margin-bottom: 8px;">Mana Devotion Pips</span>
                        <div style="display: flex; gap: 8px; justify-content: center;">
                            <span title="White" style="background:#fef08a; color:#854d0e; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:0.85rem;">W: ${manaData.pips.W}</span>
                            <span title="Blue" style="background:#bae6fd; color:#0369a1; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:0.85rem;">U: ${manaData.pips.U}</span>
                            <span title="Black" style="background:#cbd5e1; color:#0f172a; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:0.85rem;">B: ${manaData.pips.B}</span>
                            <span title="Red" style="background:#fecaca; color:#991b1b; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:0.85rem;">R: ${manaData.pips.R}</span>
                            <span title="Green" style="background:#bbf7d0; color:#166534; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:0.85rem;">G: ${manaData.pips.G}</span>
                        </div>
                    </div>

                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 15px;">
                        <span style="font-size: 0.8rem; color: #888; text-transform: uppercase; display: block; margin-bottom: 8px;">Recommended Basics (36)</span>
                        <div style="font-size: 0.85rem; color: #ddd; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                            <span>Plains: <strong>${manaData.recommendations.W}</strong></span>
                            <span>Island: <strong>${manaData.recommendations.U}</strong></span>
                            <span>Swamp: <strong>${manaData.recommendations.B}</strong></span>
                            <span>Mountain: <strong>${manaData.recommendations.R}</strong></span>
                            <span>Forest: <strong>${manaData.recommendations.G}</strong></span>
                        </div>
                    </div>
                </div>

                <!-- Mana Curve Bar Visualizer -->
                <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 15px 20px; margin-bottom: 25px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <span style="font-size: 0.85rem; color: var(--gold); font-family: Cinzel; font-weight: bold;">Mana Curve Distribution</span>
                        <span style="font-size: 0.8rem; color: #888;">Spells by CMC</span>
                    </div>
                    <div style="display: flex; align-items: flex-end; gap: 12px; height: 100px; padding-top: 10px;">
                        ${cmcDist.map((cnt, i) => `
                            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end;">
                                <span style="font-size: 0.75rem; color: #aaa; margin-bottom: 4px;">${cnt}</span>
                                <div style="width: 100%; background: linear-gradient(to top, var(--gold), #fef08a); height: ${(cnt / maxCmcCount) * 70}px; border-radius: 4px 4px 0 0; min-height: ${cnt > 0 ? '4px' : '0'};"></div>
                                <span style="font-size: 0.8rem; color: #888; margin-top: 4px;">${i === 7 ? '7+' : i}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Live Card Search / Add Bar -->
                <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 15px; margin-bottom: 25px; position: relative;">
                    <div style="display: flex; gap: 10px;">
                        <input type="text" id="deckSearchInput" placeholder="🔍 Search Scryfall to add cards (e.g. Sol Ring, Rhystic Study, Demonic Tutor)..." style="flex: 1; padding: 12px 16px; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: white; font-size: 1rem;">
                        <button class="select-btn" id="deckSearchAddBtn" style="width: auto; padding: 0 25px;">Add</button>
                    </div>
                    <div id="deckSearchResultsDropdown" style="display: none; position: absolute; left: 15px; right: 15px; top: 70px; background: #111; border: 1px solid var(--gold); border-radius: 6px; z-index: 100; max-height: 280px; overflow-y: auto;"></div>
                </div>

                <!-- Commander Section -->
                <div style="background: rgba(212,175,55,0.05); border: 1px solid rgba(212,175,55,0.3); border-radius: 8px; padding: 15px 20px; margin-bottom: 25px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 15px;">
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
                        ${items.map(item => `
                            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 6px 10px; border-radius: 4px;">
                                <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
                                    <span style="font-weight: bold; color: var(--gold); font-size: 0.85rem;">${item.card.qty || 1}x</span>
                                    <span style="color: #ddd; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;" onclick="window.openCardInspector('${sanitizeHTML(item.card.name)}')">
                                        ${sanitizeHTML(item.card.name)}
                                    </span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 4px;">
                                    <button onclick="window._modifyCardQty(${item.idx}, 1)" style="padding: 2px 6px; background: #333; border: none; color: white; border-radius: 2px; cursor: pointer;">+</button>
                                    <button onclick="window._modifyCardQty(${item.idx}, -1)" style="padding: 2px 6px; background: #333; border: none; color: white; border-radius: 2px; cursor: pointer;">-</button>
                                    <button onclick="window._removeCard(${item.idx})" style="padding: 2px 6px; background: rgba(239,68,68,0.2); border: 1px solid #ef4444; color: #ef4444; border-radius: 2px; cursor: pointer;">✕</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

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
                    currentDeck.mainboard.push({
                        name: c.name,
                        qty: 1,
                        type: c.type_line || '',
                        cmc: c.cmc || 0,
                        colors: c.colors || [],
                        color_identity: c.color_identity || [],
                        image: c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || 'card_back.webp',
                        scryfall_uri: c.scryfall_uri || '',
                        mana_cost: c.mana_cost || c.card_faces?.[0]?.mana_cost || ''
                    });
                }
                const container = document.getElementById('view-deck-builder');
                if (container) renderDeckBuilderView(container);
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
        const container = document.getElementById('view-deck-builder');
        if (container) renderDeckBuilderView(container);
    };

    window._removeCard = (idx) => {
        playSound('sfx-click');
        currentDeck.mainboard.splice(idx, 1);
        const container = document.getElementById('view-deck-builder');
        if (container) renderDeckBuilderView(container);
    };

    window._setCommanderPrompt = () => {
        const name = prompt("Enter Commander Name:", currentDeck.commander?.name || '');
        if (name && name.trim()) setCommander(name.trim());
    };

    async function setCommander(cardName) {
        try {
            const res = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`);
            if (res.ok) {
                const c = await res.json();
                currentDeck.commander = {
                    name: c.name,
                    color_identity: c.color_identity || [],
                    image: c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || 'card_back.webp'
                };
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

        // Remove existing basics
        currentDeck.mainboard = currentDeck.mainboard.filter(c => !['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'].includes(c.name));

        // Add recommended
        lands.forEach(l => {
            if (l.qty > 0) {
                currentDeck.mainboard.push({
                    name: l.name,
                    qty: l.qty,
                    type: l.type,
                    cmc: 0,
                    colors: [],
                    color_identity: [],
                    image: 'card_back.webp',
                    scryfall_uri: `https://scryfall.com/search?q=${l.name}`,
                    mana_cost: ''
                });
            }
        });

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
                const rawName = match[2].replace(/\*.*?\*/g, '').replace(/\(.*?\)/g, '').trim();
                if (line.includes('*CMDR*') || line.includes('# Commander')) {
                    cmdr = rawName;
                } else {
                    imported.push({
                        name: rawName,
                        qty: qty,
                        type: rawName.toLowerCase().includes('land') ? 'Land' : 'Spell',
                        cmc: 2,
                        colors: [],
                        color_identity: [],
                        image: 'card_back.webp',
                        scryfall_uri: `https://scryfall.com/search?q=${encodeURIComponent(rawName)}`,
                        mana_cost: ''
                    });
                }
            }
        });

        currentDeck.mainboard = imported;
        if (cmdr) setCommander(cmdr);
        const container = document.getElementById('view-deck-builder');
        if (container) renderDeckBuilderView(container);
        showToast(`Imported ${imported.length} unique card entries!`, false, 3000, true);
    }

    // Mount post-draft fallback compatibility
    window.renderDeckBuilder = async (cards, container) => {
        window.openDeckBuilder();
        if (cards && Array.isArray(cards)) {
            currentDeck.mainboard = cards.map(c => ({
                name: c.name,
                qty: 1,
                type: c.type_line || c.type || '',
                cmc: c.cmc || 0,
                colors: c.colors || [],
                color_identity: c.color_identity || [],
                image: c.image_uris?.normal || c.image || 'card_back.webp',
                scryfall_uri: c.scryfall_uri || '',
                mana_cost: c.mana_cost || ''
            }));
            const cEl = document.getElementById('view-deck-builder');
            if (cEl) renderDeckBuilderView(cEl);
        }
    };
}