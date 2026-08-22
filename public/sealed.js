// ============================================================================
// STANDALONE SEALED DRAFT & PRERELEASE POOL ENGINE
// Completely isolated from Commander Challenge
// ============================================================================

import { db, auth } from './firebase-setup.js?v=0.15';
import { ref, set, get, update, onValue } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

let currentSealedPool = [];
let currentSealedSet = { code: 'dsk', name: 'Duskmourn: House of Horror' };
let scryfallSealedSets = [];
let sealedSetMap = new Map();
let currentSort = 'color';
let currentFilter = 'all';
let simulatedDeck = [];
let drawnHand = [];
let globalUtils = null;

// Helper: Sanitize HTML
function esc(str) {
    if (!str) return "";
    return String(str).replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// Sound effect helper
function playSfx(id) {
    if (globalUtils && globalUtils.playSound) {
        globalUtils.playSound(id);
    } else {
        try {
            const el = document.getElementById(id);
            if (el) { el.currentTime = 0; el.play().catch(() => {}); }
        } catch (e) {}
    }
}

// Toast helper
function sealedToast(msg, isError = false) {
    if (globalUtils && globalUtils.showToast) {
        globalUtils.showToast(msg, isError);
    } else {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.innerText = msg;
        toast.className = 'toast show ' + (isError ? 'error' : 'success');
        setTimeout(() => toast.classList.remove('show'), 3500);
    }
}

// 1. Initialize Sealed Module
export async function initSealedModule(utils, state) {
    globalUtils = utils;

    // Window bindings
    window.openSealedDraftHub = () => openSealedHub();
    window.startPrereleasePractice = () => openSealedHub();

    setupSealedEventListeners();

    try {
        const datalist = document.getElementById('sealedSetList');
        const res = await fetch('https://api.scryfall.com/sets', {
            headers: { 'Accept': 'application/json' }
        });
        if (res.ok) {
            const data = await res.json();
            scryfallSealedSets = (data.data || [])
                .filter(s => ['core', 'expansion', 'masters', 'draft_innovation', 'funny', 'commander'].includes(s.set_type) && s.card_count > 40)
                .sort((a, b) => new Date(b.released_at) - new Date(a.released_at));

            let optionsHtml = '';
            sealedSetMap.clear();
            scryfallSealedSets.forEach(s => {
                optionsHtml += `<option value="${esc(s.name)}">${esc(s.code.toUpperCase())}</option>`;
                sealedSetMap.set(s.name.toLowerCase(), { code: s.code.toLowerCase(), name: s.name });
                sealedSetMap.set(s.code.toLowerCase(), { code: s.code.toLowerCase(), name: s.name });
            });
            if (datalist) datalist.innerHTML = optionsHtml;
        }
    } catch (e) {
        console.warn("Could not load Scryfall sets list for sealed:", e);
    }
}

// Resolve Set Input to Code & Full Name
function resolveSealedSet(input) {
    if (!input) return { code: 'dsk', name: 'Duskmourn: House of Horror' };
    const raw = String(input).trim().toLowerCase();
    
    if (sealedSetMap.has(raw)) {
        return sealedSetMap.get(raw);
    }
    const found = scryfallSealedSets.find(s => s.name.toLowerCase() === raw || s.code.toLowerCase() === raw);
    if (found) return { code: found.code.toLowerCase(), name: found.name };

    const partial = scryfallSealedSets.find(s => s.name.toLowerCase().includes(raw) || raw.includes(s.name.toLowerCase()));
    if (partial) return { code: partial.code.toLowerCase(), name: partial.name };

    if (/^[a-z0-9]{3,5}$/i.test(raw)) {
        return { code: raw, name: raw.toUpperCase() };
    }

    return { code: 'dsk', name: 'Duskmourn: House of Horror' };
}

// 2. Setup Event Listeners
function setupSealedEventListeners() {
    // Quick Set Buttons
    document.querySelectorAll('.sealed-quick-btn').forEach(btn => {
        btn.onclick = () => {
            playSfx('sfx-click');
            const code = btn.dataset.code;
            const name = btn.dataset.name;
            const input = document.getElementById('sealedSetSearchInput');
            if (input) input.value = name;
            document.querySelectorAll('.sealed-quick-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSealedSet = { code, name };
        };
    });

    // Generate Solo Sealed Pool Button
    const soloBtn = document.getElementById('sealedSoloGenerateBtn');
    if (soloBtn) {
        soloBtn.onclick = () => {
            playSfx('sfx-choose');
            const input = document.getElementById('sealedSetSearchInput');
            const resolved = resolveSealedSet(input ? input.value : '');
            currentSealedSet = resolved;
            startSoloSealedPool(resolved);
        };
    }

    // Sort Dropdown
    const sortSelect = document.getElementById('sealedSortSelect');
    if (sortSelect) {
        sortSelect.onchange = () => {
            currentSort = sortSelect.value;
            renderSealedCards();
        };
    }

    // Filter Chips
    document.querySelectorAll('.sealed-filter-chip').forEach(chip => {
        chip.onclick = () => {
            playSfx('sfx-click');
            document.querySelectorAll('.sealed-filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentFilter = chip.dataset.filter || 'all';
            renderSealedCards();
        };
    });

    // Export Button
    const exportBtn = document.getElementById('sealedExportBtn');
    if (exportBtn) {
        exportBtn.onclick = exportSealedPoolToClipboard;
    }

    // Hand Simulator Button
    const simBtn = document.getElementById('sealedSimHandBtn');
    if (simBtn) {
        simBtn.onclick = openHandSimulator;
    }

    // Reopen / New Pool Button
    const newPoolBtn = document.getElementById('sealedNewPoolBtn');
    if (newPoolBtn) {
        newPoolBtn.onclick = () => {
            playSfx('sfx-click');
            const lobbyPanel = document.getElementById('sealedLobbyPanel');
            const viewerPanel = document.getElementById('sealedPoolViewerPanel');
            if (lobbyPanel) lobbyPanel.style.display = 'block';
            if (viewerPanel) viewerPanel.style.display = 'none';
        };
    }

    // Back to Main Landing Hub
    const backBtn = document.getElementById('sealedBackToHubBtn');
    if (backBtn) {
        backBtn.onclick = () => {
            playSfx('sfx-click');
            if (globalUtils && globalUtils.switchView) {
                globalUtils.switchView('view-landing');
            } else {
                document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
                const landing = document.getElementById('view-landing');
                if (landing) landing.classList.add('active');
            }
        };
    }
}

// 3. Open Standalone Sealed Hub View
export function openSealedHub() {
    playSfx('sfx-click');
    if (globalUtils && globalUtils.switchView) {
        globalUtils.switchView('view-sealed');
    } else {
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        const sealedView = document.getElementById('view-sealed');
        if (sealedView) sealedView.classList.add('active');
        window.history.pushState({ viewId: 'view-sealed' }, '', '#view-sealed');
        window.scrollTo(0, 0);
    }

    // Show setup panel, hide viewer initially until generated
    const lobbyPanel = document.getElementById('sealedLobbyPanel');
    const viewerPanel = document.getElementById('sealedPoolViewerPanel');
    if (lobbyPanel) lobbyPanel.style.display = 'block';
    if (viewerPanel) viewerPanel.style.display = 'none';

    // Set Duskmourn as default if empty
    const input = document.getElementById('sealedSetSearchInput');
    if (input && !input.value) {
        input.value = 'Duskmourn: House of Horror';
        const dskBtn = document.querySelector('.sealed-quick-btn[data-code="dsk"]');
        if (dskBtn) dskBtn.classList.add('active');
    }
}

// 4. Fetch Booster Cards and Generate 85-Card Pool
export async function startSoloSealedPool(setObj) {
    const soloBtn = document.getElementById('sealedSoloGenerateBtn');
    if (soloBtn) {
        soloBtn.disabled = true;
        soloBtn.innerHTML = `<span class="mana-spinner"></span> Opening 6 Booster Packs...`;
    }

    try {
        const pool = await generateAuthenticSealedPool(setObj.code);
        currentSealedPool = pool;
        currentSealedSet = setObj;

        // Transition from Setup to Pool Viewer
        const lobbyPanel = document.getElementById('sealedLobbyPanel');
        const viewerPanel = document.getElementById('sealedPoolViewerPanel');
        if (lobbyPanel) lobbyPanel.style.display = 'none';
        if (viewerPanel) viewerPanel.style.display = 'block';

        // Update Viewer Header
        const headerTitle = document.getElementById('sealedViewerSetTitle');
        if (headerTitle) headerTitle.innerText = `${setObj.name} (${setObj.code.toUpperCase()})`;
        
        renderSealedStats();
        renderSealedCards();
        sealedToast(`🎉 Opened 6 Booster Packs (${pool.length} Cards)!`);
        playSfx('sfx-reveal');
    } catch (e) {
        console.error("Sealed Generation Error:", e);
        sealedToast("Failed to open sealed pool: " + (e.message || e), true);
    } finally {
        if (soloBtn) {
            soloBtn.disabled = false;
            soloBtn.innerHTML = `📦 Open 6-Pack Sealed Pool (Instant)`;
        }
    }
}

// 5. Authentic MTG 6-Pack Booster Collation
async function generateAuthenticSealedPool(setCode) {
    const cleanSet = encodeURIComponent(setCode.toLowerCase());
    const fetchHeaders = { 'Accept': 'application/json' };

    let sUrl = `https://api.scryfall.com/cards/search?q=set%3A${cleanSet}+is%3Abooster+-is:basic`;
    const allCards = [];
    const rares = [];
    const mythics = [];
    const uncommons = [];
    const commons = [];

    let pagesFetched = 0;
    while (sUrl && pagesFetched < 8) {
        pagesFetched++;
        let res = await fetch(sUrl, { headers: fetchHeaders });
        
        if (!res.ok) {
            // Fallback: search set cards directly if is:booster tag is unavailable
            if (pagesFetched === 1) {
                sUrl = `https://api.scryfall.com/cards/search?q=set%3A${cleanSet}+-is:basic`;
                res = await fetch(sUrl, { headers: fetchHeaders });
                if (!res.ok) throw new Error(`Could not load cards for set "${setCode}" from Scryfall.`);
            } else {
                break;
            }
        }

        const data = await res.json();
        if (data.data) {
            data.data.forEach(c => {
                if (c.layout === 'token' || c.layout === 'art_series') return;
                
                const cardObj = {
                    id: c.id,
                    name: c.name,
                    rarity: c.rarity,
                    cmc: c.cmc || 0,
                    mana_cost: c.mana_cost || '',
                    type_line: c.type_line || '',
                    colors: c.colors || [],
                    color_identity: c.color_identity || [],
                    prices: {
                        eur: c.prices?.eur ? parseFloat(c.prices.eur) : null,
                        usd: c.prices?.usd ? parseFloat(c.prices.usd) : null
                    },
                    image_uris: c.image_uris || (c.card_faces && c.card_faces[0] ? c.card_faces[0].image_uris : null),
                    collector_number: c.collector_number,
                    set: c.set
                };

                allCards.push(cardObj);
                if (c.rarity === 'mythic') mythics.push(cardObj);
                else if (c.rarity === 'rare') rares.push(cardObj);
                else if (c.rarity === 'uncommon') uncommons.push(cardObj);
                else commons.push(cardObj);
            });
        }
        sUrl = data.has_more ? data.next_page : null;
        res = null;
        if (sUrl) await new Promise(r => setTimeout(r, 60));
    }

    if (allCards.length === 0) {
        throw new Error(`No playable cards found for set "${setCode}".`);
    }

    const effectiveCommons = commons.length > 0 ? commons : allCards;
    const effectiveUncommons = uncommons.length > 0 ? uncommons : allCards;
    const effectiveRares = rares.length > 0 ? rares : allCards;
    const effectiveMythics = mythics.length > 0 ? mythics : effectiveRares;
    const allRaresMythics = [...effectiveRares, ...effectiveMythics];

    const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const sealedCards = [];

    // 6 Booster Packs
    for (let pack = 0; pack < 6; pack++) {
        // 1 Rare/Mythic (1:8 ratio for mythic)
        const isMythic = effectiveMythics.length > 0 && Math.random() < 0.125;
        const rareCard = isMythic ? pickRandom(effectiveMythics) : pickRandom(effectiveRares);
        sealedCards.push(rareCard);

        // 3 Uncommons (unique within pack)
        const usedInPack = new Set([rareCard.name]);
        for (let u = 0; u < 3; u++) {
            let uncom;
            let attempts = 0;
            do {
                uncom = pickRandom(effectiveUncommons);
                attempts++;
            } while (usedInPack.has(uncom.name) && attempts < 30);
            usedInPack.add(uncom.name);
            sealedCards.push(uncom);
        }

        // 10 Commons (unique within pack)
        for (let c = 0; c < 10; c++) {
            let com;
            let attempts = 0;
            do {
                com = pickRandom(effectiveCommons);
                attempts++;
            } while (usedInPack.has(com.name) && attempts < 30);
            usedInPack.add(com.name);
            sealedCards.push(com);
        }
    }

    // 1 Foil-Stamped Promo Rare/Mythic
    const promoCard = { ...pickRandom(allRaresMythics), isPromo: true };
    sealedCards.push(promoCard);

    return sealedCards;
}

// 6. Render Pool Stats Bar
function renderSealedStats() {
    const statsContainer = document.getElementById('sealedPoolStatsBar');
    if (!statsContainer) return;

    const rares = currentSealedPool.filter(c => c.rarity === 'rare' || c.rarity === 'mythic' || c.isPromo).length;
    const uncommons = currentSealedPool.filter(c => c.rarity === 'uncommon').length;
    const commons = currentSealedPool.filter(c => c.rarity === 'common').length;
    const commanders = currentSealedPool.filter(c => c.type_line && (c.type_line.includes('Legendary Creature') || c.type_line.includes('Legendary Planeswalker'))).length;

    statsContainer.innerHTML = `
        <div class="sealed-stat-chip total"><strong>📦 Total:</strong> ${currentSealedPool.length} Cards (6 Boosters)</div>
        <div class="sealed-stat-chip rare"><strong>🌟 Rares/Mythics:</strong> ${rares}</div>
        <div class="sealed-stat-chip uncommon"><strong>🔷 Uncommons:</strong> ${uncommons}</div>
        <div class="sealed-stat-chip common"><strong>⚪ Commons:</strong> ${commons}</div>
        <div class="sealed-stat-chip cmdr"><strong>👑 Potential Commanders:</strong> ${commanders}</div>
    `;
}

// 7. Render Card Grid with Sorting & Filtering
function renderSealedCards() {
    const grid = document.getElementById('sealedCardsGrid');
    if (!grid) return;

    let filtered = [...currentSealedPool];

    // Filter
    if (currentFilter === 'commanders') {
        filtered = filtered.filter(c => c.type_line && (c.type_line.includes('Legendary Creature') || c.type_line.includes('Legendary Planeswalker')));
    } else if (currentFilter === 'creatures') {
        filtered = filtered.filter(c => c.type_line && c.type_line.includes('Creature'));
    } else if (currentFilter === 'spells') {
        filtered = filtered.filter(c => c.type_line && (c.type_line.includes('Instant') || c.type_line.includes('Sorcery')));
    } else if (currentFilter === 'artifacts_enchantments') {
        filtered = filtered.filter(c => c.type_line && (c.type_line.includes('Artifact') || c.type_line.includes('Enchantment')));
    } else if (currentFilter === 'lands') {
        filtered = filtered.filter(c => c.type_line && c.type_line.includes('Land'));
    }

    // Sort
    const colorOrder = { 'W': 1, 'U': 2, 'B': 3, 'R': 4, 'G': 5, 'MULTI': 6, 'COLORLESS': 7 };
    const getColorRank = (c) => {
        if (!c.color_identity || c.color_identity.length === 0) return 7;
        if (c.color_identity.length > 1) return 6;
        return colorOrder[c.color_identity[0]] || 7;
    };

    const rarityOrder = { 'mythic': 1, 'rare': 2, 'uncommon': 3, 'common': 4 };

    filtered.sort((a, b) => {
        if (currentSort === 'color') {
            const rA = getColorRank(a), rB = getColorRank(b);
            if (rA !== rB) return rA - rB;
            return (a.cmc || 0) - (b.cmc || 0);
        } else if (currentSort === 'cmc') {
            return (a.cmc || 0) - (b.cmc || 0);
        } else if (currentSort === 'rarity') {
            const rA = rarityOrder[a.rarity] || 5, rB = rarityOrder[b.rarity] || 5;
            if (rA !== rB) return rA - rB;
            return a.name.localeCompare(b.name);
        } else if (currentSort === 'type') {
            return (a.type_line || '').localeCompare(b.type_line || '');
        } else {
            return a.name.localeCompare(b.name);
        }
    });

    if (filtered.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #888;">No cards match this filter.</div>`;
        return;
    }

    grid.innerHTML = filtered.map((c, idx) => {
        const isLegendary = c.type_line && (c.type_line.includes('Legendary Creature') || c.type_line.includes('Legendary Planeswalker'));
        const rarityClass = c.rarity || 'common';
        const imgUrl = c.image_uris?.normal || 'card_back.webp';
        const priceStr = c.prices?.eur ? `€${c.prices.eur.toFixed(2)}` : (c.prices?.usd ? `$${c.prices.usd.toFixed(2)}` : '');

        return `
            <div class="sealed-card-tile ${rarityClass} ${c.isPromo ? 'promo-foil' : ''}" data-idx="${idx}">
                <div class="sealed-card-img-wrapper">
                    <img src="${esc(imgUrl)}" alt="${esc(c.name)}" loading="lazy" class="sealed-card-img">
                    ${c.isPromo ? `<div class="sealed-promo-badge">🌟 Foil Promo</div>` : ''}
                    <div class="sealed-rarity-pill ${rarityClass}">${rarityClass.toUpperCase()}</div>
                </div>
                <div class="sealed-card-details">
                    <div class="sealed-card-name" title="${esc(c.name)}">${esc(c.name)}</div>
                    <div class="sealed-card-meta">
                        <span class="sealed-card-type">${esc(c.type_line)}</span>
                        ${priceStr ? `<span class="sealed-card-price">${priceStr}</span>` : ''}
                    </div>
                    ${isLegendary ? `
                        <button class="sealed-select-cmdr-btn" onclick="window.selectSealedCommander('${esc(c.name)}')">
                            👑 Choose Commander
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// 8. 1-Click Clipboard Export
function exportSealedPoolToClipboard() {
    if (currentSealedPool.length === 0) return sealedToast("No cards in sealed pool to export!", true);

    const counts = {};
    currentSealedPool.forEach(c => {
        const key = `${c.name} (${c.set || currentSealedSet.code.toUpperCase()}) ${c.collector_number || ''}`.trim();
        counts[key] = (counts[key] || 0) + 1;
    });

    let exportText = `// MTG Sealed Pool: ${currentSealedSet.name} (6 Boosters / 85 Cards)\n`;
    for (const [cardLine, count] of Object.entries(counts)) {
        exportText += `${count} ${cardLine}\n`;
    }

    navigator.clipboard.writeText(exportText).then(() => {
        sealedToast("📋 Sealed Pool copied to clipboard! Ready to paste into Moxfield or MTG Arena.");
    }).catch(() => {
        sealedToast("Failed to copy. Please allow clipboard permissions.", true);
    });
}

// 9. Interactive 7-Card Starting Hand Simulator
function openHandSimulator() {
    if (currentSealedPool.length === 0) return sealedToast("No pool available.", true);
    playSfx('sfx-click');

    // Shuffle deck from sealed pool (Fisher-Yates)
    simulatedDeck = [...currentSealedPool];
    for (let i = simulatedDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [simulatedDeck[i], simulatedDeck[j]] = [simulatedDeck[j], simulatedDeck[i]];
    }

    drawnHand = simulatedDeck.splice(0, 7);
    renderHandSimulatorModal();

    const modal = document.getElementById('sealedHandModal');
    if (modal) {
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('show'), 10);
    }
}

function renderHandSimulatorModal() {
    const handContainer = document.getElementById('sealedDrawnHandCards');
    const deckCountEl = document.getElementById('sealedDeckCount');
    if (deckCountEl) deckCountEl.innerText = `${simulatedDeck.length} cards remaining in deck`;

    if (!handContainer) return;
    handContainer.innerHTML = drawnHand.map(c => `
        <div class="hand-sim-card">
            <img src="${esc(c.image_uris?.normal || 'card_back.webp')}" alt="${esc(c.name)}" class="hand-sim-img">
            <span class="hand-sim-name">${esc(c.name)}</span>
        </div>
    `).join('');
}

window.drawSimCard = () => {
    if (simulatedDeck.length === 0) return sealedToast("Deck is empty!", true);
    playSfx('sfx-choose');
    drawnHand.push(simulatedDeck.shift());
    renderHandSimulatorModal();
};

window.mulliganSimHand = () => {
    playSfx('sfx-reveal');
    openHandSimulator();
};

window.closeHandSimulator = () => {
    const modal = document.getElementById('sealedHandModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.style.display = 'none', 300);
    }
};

window.selectSealedCommander = (cardName) => {
    playSfx('sfx-choose');
    const card = currentSealedPool.find(c => c.name === cardName);
    if (card) {
        sealedToast(`👑 Selected ${card.name} as your Sealed Commander!`);
    }
};
