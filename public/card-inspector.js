// 3D Holographic Card Inspector Module
// Includes Official WotC Rulings, Format Legalities, Game Changers Badge, Printings Price Switcher & 1-Click Cross-Tool Actions

let activeInspectCard = null;
let isFlipped = false;
let currentInspectorTab = 'oracle'; // 'oracle' | 'rulings' | 'printings'
let cachedRulingsByCard = new Map();
let cachedPrintingsByCard = new Map();

// Official WotC Commander Bracket Game Changers List
export const OFFICIAL_GAME_CHANGERS = new Set([
    'drannith magistrate', 'enlightened tutor', 'humility', 'serra\'s sanctum', 'smothering tithe',
    'teferi\'s protection', 'trouble in pairs', 'consecrated sphinx', 'cyclonic rift', 'expropriate',
    'fierce guardianship', 'force of will', 'glacial chasm', 'jin-gitaxias, core augur', 'mana drain',
    'mystical tutor', 'narset, parter of veils', 'rhystic study', 'sway of the stars', 'thassa\'s oracle',
    'urza, lord high artificer', 'ad nauseam', 'bolas\'s citadel', 'braids, cabal minion', 'demonic tutor',
    'imperial seal', 'necropotence', 'opposition agent', 'tergrid, god of fright', 'vampiric tutor',
    'deflecting swat', 'gamble', 'jeska\'s will', 'underworld breach', 'crop rotation', 'food chain',
    'gaea\'s cradle', 'natural order', 'seedborn muse', 'survival of the fittest', 'vorinclex, voice of hunger',
    'worldly tutor', 'aura shards', 'coalition victory', 'grand arbiter augustin iv', 'kinnan, bonder prodigy',
    'oko, thief of crowns', 'winota, joiner of forces', 'yuriko, the tiger\'s shadow', 'ancient tomb',
    'chrome mox', 'grim monolith', 'lion\'s eye diamond', 'mana vault', 'mishra\'s workshop', 'mox diamond',
    'panoptic mirror', 'the one ring', 'the tabernacle at pendrell vale', 'trinisphere'
]);

export function isOfficialGameChanger(cardName) {
    if (!cardName) return false;
    const clean = String(cardName).toLowerCase().split('//')[0].trim();
    return OFFICIAL_GAME_CHANGERS.has(clean);
}
window.isOfficialGameChanger = isOfficialGameChanger;

export function initCardInspector() {
    if (!document.getElementById('cardInspectorModal')) {
        const modal = document.createElement('div');
        modal.id = 'cardInspectorModal';
        modal.className = 'inspect-modal-overlay';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="inspect-modal-backdrop" onclick="window.closeCardInspector()"></div>
            <div class="inspect-modal-container" style="max-width: 960px;">
                <button class="inspect-close-btn" onclick="window.closeCardInspector()" title="Close Inspector">✕</button>
                <div class="inspect-modal-content">
                    <div class="inspect-card-column">
                        <div class="inspect-3d-scene" id="inspect3dScene">
                            <div class="inspect-3d-card" id="inspect3dCard">
                                <img id="inspectCardImg" class="inspect-card-image" src="" alt="Card Art">
                                <div class="inspect-foil-sheen" id="inspectFoilSheen"></div>
                            </div>
                        </div>
                        <div class="inspect-card-controls">
                            <button id="inspectFlipBtn" class="inspect-action-btn" style="display:none;" onclick="window.flipInspectCard()">🔄 Flip Card</button>
                            <button id="inspectFoilToggle" class="inspect-action-btn foil-active" onclick="window.toggleInspectFoil()">✨ Foil Effect: ON</button>
                        </div>
                        <!-- Quick Cross-Tool Action Buttons -->
                        <div id="inspectQuickActions" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; width: 100%; margin-top: 8px;">
                            <button type="button" class="inspect-action-btn" style="font-size: 0.76rem; padding: 6px 8px; background: rgba(212,175,55,0.14); border-color: rgba(212,175,55,0.4); color: var(--gold);" onclick="window.inspectActionAddToBuilder()" title="Add this card to the Native Deck Builder">
                                🛠️ + Deck Builder
                            </button>
                            <button type="button" class="inspect-action-btn" style="font-size: 0.76rem; padding: 6px 8px; background: rgba(16,185,129,0.14); border-color: rgba(16,185,129,0.4); color: #34d399;" onclick="window.inspectActionTrade('have')" title="Add this card to your For Trade binder">
                                🟢 + Trade (Have)
                            </button>
                            <button type="button" class="inspect-action-btn" style="font-size: 0.76rem; padding: 6px 8px; background: rgba(56,189,248,0.14); border-color: rgba(56,189,248,0.4); color: #38bdf8;" onclick="window.inspectActionTrade('want')" title="Add this card to your Trade Wishlist">
                                🔵 + Wishlist (Want)
                            </button>
                            <button type="button" class="inspect-action-btn" style="font-size: 0.76rem; padding: 6px 8px; background: rgba(168,85,247,0.14); border-color: rgba(168,85,247,0.4); color: #c084fc;" onclick="window.inspectActionPrintProxy()" title="Open Printable PDF Proxy Sheet for this card">
                                🖨️ Print Proxy
                            </button>
                        </div>
                    </div>
                    <div class="inspect-info-column" style="min-width: 0;">
                        <div class="inspect-header">
                            <h2 id="inspectCardName" class="inspect-title">Card Name</h2>
                            <div id="inspectManaCost" class="inspect-mana-cost"></div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px;">
                            <div id="inspectFinishTag" class="inspect-finish-tag" style="margin-bottom: 0;"></div>
                            <div id="inspectGameChangerBadge" style="display: none; font-size: 0.73rem; font-weight: 800; padding: 3px 9px; border-radius: 999px; background: rgba(245, 158, 11, 0.18); border: 1px solid rgba(245, 158, 11, 0.5); color: #fbbf24;" title="Official WotC Commander Bracket Game Changer (Bracket 3+)">
                                ⚠️ Official Game Changer
                            </div>
                            <span id="inspectSetPrintingBadge" style="font-size: 0.75rem; color: #94a3b8; font-family: monospace;"></span>
                        </div>
                        <div id="inspectTypeLine" class="inspect-type-line">Type Line</div>

                        <!-- Inspector Sub-Tabs: Oracle & Legalities | Official Rulings | Printings & Prices -->
                        <div style="display: flex; gap: 6px; margin: 8px 0 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">
                            <button type="button" id="inspectTabOracleBtn" class="inspect-action-btn" style="flex: 1; padding: 6px 10px; font-size: 0.78rem; background: rgba(212,175,55,0.2); border-color: var(--gold); color: var(--gold); font-weight: 700;" onclick="window.switchInspectorTab('oracle')">
                                📜 Oracle & Formats
                            </button>
                            <button type="button" id="inspectTabRulingsBtn" class="inspect-action-btn" style="flex: 1; padding: 6px 10px; font-size: 0.78rem;" onclick="window.switchInspectorTab('rulings')">
                                ⚖️ Official Rulings
                            </button>
                            <button type="button" id="inspectTabPrintingsBtn" class="inspect-action-btn" style="flex: 1; padding: 6px 10px; font-size: 0.78rem;" onclick="window.switchInspectorTab('printings')">
                                🎨 Printings & Sets
                            </button>
                        </div>

                        <!-- TAB 1: ORACLE & FORMAT LEGALITIES -->
                        <div id="inspectTabPaneOracle">
                            <div class="inspect-oracle-box">
                                <div id="inspectOracleText" class="inspect-oracle-text">Oracle text loading...</div>
                                <div id="inspectPtLoyalty" class="inspect-pt-loyalty"></div>
                            </div>
                            <div id="inspectLegalitiesRow" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 10px 0;"></div>
                        </div>

                        <!-- TAB 2: OFFICIAL WOTC JUDGE RULINGS -->
                        <div id="inspectTabPaneRulings" style="display: none;">
                            <div id="inspectRulingsList" class="inspect-oracle-box" style="max-height: 220px; overflow-y: auto; font-size: 0.84rem; line-height: 1.45;">
                                <em style="color:#94a3b8;">Loading official rulings...</em>
                            </div>
                        </div>

                        <!-- TAB 3: PRINTINGS & SET SWITCHER -->
                        <div id="inspectTabPanePrintings" style="display: none;">
                            <div id="inspectPrintingsList" class="inspect-oracle-box" style="max-height: 220px; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px;">
                                <em style="color:#94a3b8;">Loading printings from Scryfall...</em>
                            </div>
                        </div>

                        <div class="inspect-stats-grid" style="margin-top: 10px;">
                            <div class="inspect-stat-pill">
                                <span class="stat-pill-label">EDHREC Rank</span>
                                <span id="inspectEdhrecRank" class="stat-pill-value">--</span>
                            </div>
                            <div class="inspect-stat-pill">
                                <span class="stat-pill-label">Cardmarket (EUR)</span>
                                <span id="inspectPriceEur" class="stat-pill-value">--</span>
                            </div>
                            <div class="inspect-stat-pill">
                                <span class="stat-pill-label">TCGPlayer (USD)</span>
                                <span id="inspectPriceUsd" class="stat-pill-value">--</span>
                            </div>
                        </div>
                        <div class="inspect-links-row">
                            <a id="inspectScryfallLink" href="#" target="_blank" rel="noopener noreferrer" class="inspect-link-btn scryfall-btn">🔍 View on Scryfall</a>
                            <a id="inspectEdhrecLink" href="#" target="_blank" rel="noopener noreferrer" class="inspect-link-btn edhrec-btn">📈 EDHREC Synergies</a>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        setup3dGyro();
    }

    window.openCardInspector = openCardInspector;
    window.closeCardInspector = closeCardInspector;
    window.flipInspectCard = flipInspectCard;
    window.toggleInspectFoil = toggleInspectFoil;
    window.switchInspectorTab = switchInspectorTab;
    window.selectInspectorPrinting = selectInspectorPrinting;
    window.inspectActionAddToBuilder = inspectActionAddToBuilder;
    window.inspectActionTrade = inspectActionTrade;
    window.inspectActionPrintProxy = inspectActionPrintProxy;
}

let foilEnabled = true;

function setFoilState(active) {
    foilEnabled = Boolean(active);
    const btn = document.getElementById('inspectFoilToggle');
    const sheen = document.getElementById('inspectFoilSheen');
    if (btn) {
        btn.textContent = foilEnabled ? '✨ Foil Effect: ON' : '✨ Foil Effect: OFF';
        btn.classList.toggle('foil-active', foilEnabled);
    }
    if (sheen) {
        sheen.style.display = foilEnabled ? 'block' : 'none';
        sheen.style.opacity = foilEnabled ? '0.65' : '0';
    }
}

function toggleInspectFoil() {
    setFoilState(!foilEnabled);
}

function switchInspectorTab(tab) {
    currentInspectorTab = tab || 'oracle';
    const tabs = ['oracle', 'rulings', 'printings'];
    tabs.forEach(t => {
        const pane = document.getElementById(`inspectTabPane${t.charAt(0).toUpperCase() + t.slice(1)}`);
        const btn = document.getElementById(`inspectTab${t.charAt(0).toUpperCase() + t.slice(1)}Btn`);
        const isActive = t === currentInspectorTab;
        if (pane) pane.style.display = isActive ? 'block' : 'none';
        if (btn) {
            btn.style.background = isActive ? 'rgba(212,175,55,0.2)' : '';
            btn.style.borderColor = isActive ? 'var(--gold)' : '';
            btn.style.color = isActive ? 'var(--gold)' : '';
            btn.style.fontWeight = isActive ? '700' : '';
        }
    });

    if (currentInspectorTab === 'rulings' && activeInspectCard) {
        loadInspectorRulings(activeInspectCard);
    } else if (currentInspectorTab === 'printings' && activeInspectCard) {
        loadInspectorPrintings(activeInspectCard);
    }
}

async function ensureFullScryfallCard(card) {
    if (!card) return null;
    if (card.rulings_uri && card.legalities) return card;
    const nameOrId = card.id && /^[0-9a-f-]{36}$/i.test(card.id)
        ? `https://api.scryfall.com/cards/${card.id}`
        : `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(card.name || '')}`;
    try {
        const res = await fetch(nameOrId);
        if (res.ok) {
            const full = await res.json();
            activeInspectCard = { ...card, ...full };
            renderLegalitiesPills(activeInspectCard.legalities);
            return activeInspectCard;
        }
    } catch (e) {}
    return card;
}

async function loadInspectorRulings(card) {
    const listEl = document.getElementById('inspectRulingsList');
    if (!listEl) return;
    const key = (card.name || '').toLowerCase();
    if (cachedRulingsByCard.has(key)) {
        renderRulingsHtml(cachedRulingsByCard.get(key), listEl);
        return;
    }

    listEl.innerHTML = `<em style="color:#94a3b8;">Fetching official WotC Judge Rulings from Scryfall...</em>`;
    const fullCard = await ensureFullScryfallCard(card);
    if (!fullCard || !fullCard.rulings_uri) {
        listEl.innerHTML = `<span style="color:#94a3b8;">No official rulings URI found for this card.</span>`;
        return;
    }

    try {
        const res = await fetch(fullCard.rulings_uri);
        if (res.ok) {
            const data = await res.json();
            const rulings = data.data || [];
            cachedRulingsByCard.set(key, rulings);
            renderRulingsHtml(rulings, listEl);
        } else {
            listEl.innerHTML = `<span style="color:#94a3b8;">Could not load rulings at this time.</span>`;
        }
    } catch (e) {
        listEl.innerHTML = `<span style="color:#94a3b8;">Network error loading rulings.</span>`;
    }
}

function renderRulingsHtml(rulings, container) {
    if (!rulings || rulings.length === 0) {
        container.innerHTML = `<div style="color:#94a3b8; text-align:center; padding: 16px 8px;">✅ No special judge rulings or errata notes exist for this card. Standard MTG comprehensive rules apply.</div>`;
        return;
    }
    container.innerHTML = rulings.map(r => `
        <div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.08);">
            <div style="font-size: 0.72rem; color: var(--gold); font-weight: 700; margin-bottom: 3px;">📅 ${r.published_at || 'Official Ruling'} (${(r.source || 'wotc').toUpperCase()})</div>
            <div style="color: #e2e8f0; font-size: 0.82rem;">${formatOracleText(r.comment || '')}</div>
        </div>
    `).join('');
}

async function loadInspectorPrintings(card) {
    const listEl = document.getElementById('inspectPrintingsList');
    if (!listEl) return;
    const key = (card.name || '').toLowerCase();
    if (cachedPrintingsByCard.has(key)) {
        renderPrintingsHtml(cachedPrintingsByCard.get(key), listEl);
        return;
    }

    listEl.innerHTML = `<em style="color:#94a3b8;">Searching all sets & art printings on Scryfall...</em>`;
    const fullCard = await ensureFullScryfallCard(card);
    const searchUri = fullCard?.prints_search_uri || `https://api.scryfall.com/cards/search?order=released&q=%21%22${encodeURIComponent(card.name || '')}%22+include%3Aextras&unique=prints`;

    try {
        const res = await fetch(searchUri);
        if (res.ok) {
            const data = await res.json();
            const prints = (data.data || []).slice(0, 40);
            cachedPrintingsByCard.set(key, prints);
            renderPrintingsHtml(prints, listEl);
        } else {
            listEl.innerHTML = `<span style="color:#94a3b8;">No alternate printings found.</span>`;
        }
    } catch (e) {
        listEl.innerHTML = `<span style="color:#94a3b8;">Failed to fetch printings list.</span>`;
    }
}

function renderPrintingsHtml(prints, container) {
    if (!prints || prints.length === 0) {
        container.innerHTML = `<div style="color:#94a3b8; text-align:center; padding: 12px;">No printings found.</div>`;
        return;
    }
    window.__ACTIVE_INSPECTOR_PRINTS__ = prints;
    container.innerHTML = prints.map((p, idx) => {
        const usd = p.prices?.usd ? `$${parseFloat(p.prices.usd).toFixed(2)}` : (p.prices?.usd_foil ? `$${parseFloat(p.prices.usd_foil).toFixed(2)} ✨` : '--');
        const eur = p.prices?.eur ? `€${parseFloat(p.prices.eur).toFixed(2)}` : (p.prices?.eur_foil ? `€${parseFloat(p.prices.eur_foil).toFixed(2)} ✨` : '--');
        const isCurrent = activeInspectCard && activeInspectCard.id === p.id;
        return `
            <div onclick="window.selectInspectorPrinting(${idx})" style="display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; border-radius: 6px; cursor: pointer; background: ${isCurrent ? 'rgba(212,175,55,0.18)' : 'rgba(255,255,255,0.03)'}; border: 1px solid ${isCurrent ? 'var(--gold)' : 'rgba(255,255,255,0.08)'}; transition: background 0.15s;">
                <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
                    <div style="font-size: 0.82rem; font-weight: 700; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${p.set_name || p.set?.toUpperCase()} <span style="color: var(--gold); font-family: monospace;">(${(p.set || '').toUpperCase()} #${p.collector_number || ''})</span>
                    </div>
                    <div style="font-size: 0.72rem; color: #94a3b8;">
                        ${(p.rarity || 'common').toUpperCase()} • ${p.released_at ? p.released_at.slice(0, 4) : ''} ${p.frame_effects ? `• ${p.frame_effects.join(', ')}` : ''}
                    </div>
                </div>
                <div style="display: flex; gap: 8px; align-items: center; font-family: monospace; font-size: 0.8rem; flex-shrink: 0;">
                    <span style="color: #34d399; font-weight: 700;">${usd}</span>
                    <span style="color: #38bdf8;">${eur}</span>
                </div>
            </div>
        `;
    }).join('');
}

function selectInspectorPrinting(idx) {
    const prints = window.__ACTIVE_INSPECTOR_PRINTS__;
    if (!prints || !prints[idx]) return;
    activeInspectCard = prints[idx];
    renderCardInspectData(activeInspectCard);
    const listEl = document.getElementById('inspectPrintingsList');
    if (listEl) renderPrintingsHtml(prints, listEl);
}

function renderLegalitiesPills(legalities) {
    const row = document.getElementById('inspectLegalitiesRow');
    if (!row) return;
    if (!legalities) {
        row.innerHTML = '';
        return;
    }
    const formats = [
        { key: 'commander', label: 'Commander' },
        { key: 'modern', label: 'Modern' },
        { key: 'standard', label: 'Standard' },
        { key: 'pioneer', label: 'Pioneer' },
        { key: 'legacy', label: 'Legacy' },
        { key: 'pauper', label: 'Pauper' }
    ];
    row.innerHTML = formats.map(f => {
        const status = legalities[f.key] || 'not_legal';
        const isLegal = status === 'legal';
        const isBanned = status === 'banned' || status === 'restricted';
        const bg = isLegal ? 'rgba(16,185,129,0.14)' : (isBanned ? 'rgba(239,68,68,0.16)' : 'rgba(255,255,255,0.04)');
        const border = isLegal ? 'rgba(16,185,129,0.35)' : (isBanned ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)');
        const color = isLegal ? '#34d399' : (isBanned ? '#f87171' : '#64748b');
        const labelStatus = isLegal ? 'LEGAL' : (status === 'banned' ? 'BANNED' : (status === 'restricted' ? 'RESTRICTED' : 'NOT LEGAL'));
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; border-radius: 6px; background: ${bg}; border: 1px solid ${border}; font-size: 0.7rem;">
                <span style="color: #cbd5e1; font-weight: 600;">${f.label}</span>
                <span style="color: ${color}; font-weight: 800; letter-spacing: 0.03em;">${labelStatus}</span>
            </div>
        `;
    }).join('');
}

function inspectActionAddToBuilder() {
    if (!activeInspectCard || !activeInspectCard.name) return;
    const cardName = activeInspectCard.name;
    if (typeof window._selectCardFromSearch === 'function') {
        window._selectCardFromSearch(cardName);
        if (typeof window.showToast === 'function') {
            window.showToast(`🛠️ Added "${cardName}" to Native Deck Builder!`, false, 2500, true);
        }
    } else if (typeof window.openDeckBuilder === 'function') {
        window.closeCardInspector();
        window.openDeckBuilder(`1 ${cardName}`);
    }
}

function inspectActionTrade(type = 'have') {
    if (!activeInspectCard || !activeInspectCard.name) return;
    if (typeof window.addCardToTradeBinderGlobal === 'function') {
        window.addCardToTradeBinderGlobal(activeInspectCard, type);
    } else if (typeof window.addToTradeBinder === 'function') {
        const usd = parseFloat(activeInspectCard.prices?.usd || activeInspectCard.prices?.usd_foil || 0);
        window.addToTradeBinder({
            name: activeInspectCard.name,
            setCode: (activeInspectCard.set || '').toUpperCase(),
            collectorNumber: activeInspectCard.collector_number || '',
            finish: activeInspectCard.isFoil ? 'Foil' : 'Normal',
            isFoil: Boolean(activeInspectCard.isFoil),
            priceUsd: usd,
            imageUrl: getBestCardImageUrl(activeInspectCard),
            prices: activeInspectCard.prices || null
        }, type, 1);
    }
}

function inspectActionPrintProxy() {
    if (!activeInspectCard || !activeInspectCard.name) return;
    if (typeof window.openProxyPrinterModal === 'function') {
        window.openProxyPrinterModal([
            {
                name: activeInspectCard.name,
                qty: 1,
                image: getBestCardImageUrl(activeInspectCard),
                type_line: activeInspectCard.type_line || ''
            }
        ], `Proxy Sheet - ${activeInspectCard.name}`);
    }
}

export async function openCardInspector(cardInput) {
    initCardInspector();
    const modal = document.getElementById('cardInspectorModal');
    if (!modal) return;

    isFlipped = false;
    switchInspectorTab('oracle');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // If cardInput is already a card object, render immediately so there is ZERO delay or flash!
    if (cardInput && typeof cardInput === 'object' && cardInput.name) {
        activeInspectCard = cardInput;
        renderCardInspectData(cardInput);
        // Backfill legalities/set info silently if missing
        if (!cardInput.legalities || !cardInput.rulings_uri) {
            ensureFullScryfallCard(cardInput);
        }
        return;
    }

    // Otherwise fetch by ID or Name
    let cardData = null;
    const cardIdentifier = typeof cardInput === 'string' ? cardInput : (cardInput?.name || cardInput?.id || '');
    
    document.getElementById('inspectCardName').textContent = cardIdentifier || 'Loading...';
    document.getElementById('inspectOracleText').innerHTML = '<em>Fetching Scryfall live data...</em>';

    // Set immediate image if it's a UUID so art loads instantly while data fetches
    const isId = /^[0-9a-f-]{36}$/i.test(cardIdentifier);
    const cardImg = document.getElementById('inspectCardImg');
    if (cardImg && isId) {
        cardImg.src = `https://api.scryfall.com/cards/${cardIdentifier}?format=image&version=large`;
    }

    try {
        const fetchUrl = isId 
            ? `https://api.scryfall.com/cards/${cardIdentifier}` 
            : `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardIdentifier)}`;
        const res = await fetch(fetchUrl);
        if (res.ok) {
            cardData = await res.json();
            activeInspectCard = cardData;
            renderCardInspectData(cardData, cardIdentifier);
        }
    } catch (e) {
        console.error("Inspector Scryfall fetch failed", e);
    }
}

function getBestCardImageUrl(card) {
    if (!card) return 'card_back.webp';

    if (card.image_large && !card.image_large.includes('card_back')) return card.image_large;
    if (card.image && !card.image.includes('card_back')) return card.image;

    if (card.image_uris) {
        if (card.image_uris.large) return card.image_uris.large;
        if (card.image_uris.normal) return card.image_uris.normal;
        if (card.image_uris.png) return card.image_uris.png;
    }

    if (card.card_faces && card.card_faces.length > 0) {
        const face = card.card_faces[0];
        if (face.image_uris?.large) return face.image_uris.large;
        if (face.image_uris?.normal) return face.image_uris.normal;
        if (face.image_large && !face.image_large.includes('card_back')) return face.image_large;
        if (face.image && !face.image.includes('card_back')) return face.image;
    }

    if (card.id && /^[0-9a-f-]{36}$/i.test(card.id)) {
        return `https://api.scryfall.com/cards/${card.id}?format=image&version=large`;
    }

    return 'card_back.webp';
}

function renderCardInspectData(card, fallbackInput) {
    if (!card) {
        document.getElementById('inspectCardName').textContent = typeof fallbackInput === 'string' ? fallbackInput : 'Card';
        document.getElementById('inspectOracleText').textContent = 'Could not load Scryfall data.';
        return;
    }

    const name = card.name || 'Unknown';
    document.getElementById('inspectCardName').textContent = name;

    const gcBadge = document.getElementById('inspectGameChangerBadge');
    if (gcBadge) {
        gcBadge.style.display = isOfficialGameChanger(name) ? 'inline-block' : 'none';
    }

    const setBadge = document.getElementById('inspectSetPrintingBadge');
    if (setBadge) {
        const setStr = card.set ? `${card.set.toUpperCase()}${card.collector_number ? ' #' + card.collector_number : ''}` : '';
        setBadge.textContent = setStr;
    }

    const flipBtn = document.getElementById('inspectFlipBtn');
    const hasFaces = card.card_faces && card.card_faces.length > 1 && (card.card_faces[0].image_uris || card.card_faces[0].image);
    if (flipBtn) flipBtn.style.display = hasFaces ? 'inline-block' : 'none';

    const imgUrl = getBestCardImageUrl(card);
    const cardImg = document.getElementById('inspectCardImg');
    if (cardImg) {
        cardImg.src = imgUrl;
        cardImg.alt = name;
        cardImg.onerror = () => {
            if (card && card.id && !cardImg.src.includes('format=image')) {
                cardImg.src = `https://api.scryfall.com/cards/${card.id}?format=image&version=large`;
            }
        };
    }

    const manaCost = card.mana_cost || card.card_faces?.[0]?.mana_cost || '';
    document.getElementById('inspectManaCost').innerHTML = formatManaSymbols(manaCost);
    document.getElementById('inspectTypeLine').textContent = card.type_line || card.card_faces?.[0]?.type_line || '';

    const oracleText = card.oracle_text || card.card_faces?.[0]?.oracle_text || 'No oracle text.';
    document.getElementById('inspectOracleText').innerHTML = formatOracleText(oracleText);

    renderLegalitiesPills(card.legalities);

    let ptLoyalty = '';
    if (card.power !== undefined && card.toughness !== undefined) {
        ptLoyalty = `${card.power}/${card.toughness}`;
    } else if (card.card_faces?.[0]?.power !== undefined) {
        ptLoyalty = `${card.card_faces[0].power}/${card.card_faces[0].toughness}`;
    } else if (card.loyalty) {
        ptLoyalty = `Loyalty: ${card.loyalty}`;
    }
    const ptEl = document.getElementById('inspectPtLoyalty');
    if (ptEl) {
        ptEl.textContent = ptLoyalty;
        ptEl.style.display = ptLoyalty ? 'block' : 'none';
    }

    const rankVal = card.edhrec_rank || card.display_rank || card.rank_edhrec;
    document.getElementById('inspectEdhrecRank').textContent = rankVal && rankVal < 99999 ? `#${Number(rankVal).toLocaleString()}` : 'Unranked';

    const promoTypes = Array.isArray(card.promo_types) ? card.promo_types : [];
    const finishes = Array.isArray(card.finishes) ? card.finishes : [];
    const isSurgeFoil = Boolean(card.isSurgeFoil) || promoTypes.includes('surgefoil') || card.finish === 'surgefoil';
    const isSerialized = Boolean(card.isSerialized) || promoTypes.includes('serialized') || promoTypes.includes('doublerainbow') || card.finish === 'serialized';
    const isEtched = Boolean(card.isEtched) || finishes.includes('etched') || promoTypes.includes('etched') || card.finish === 'etched';
    const isFoilOnly = (finishes.length > 0 && !finishes.includes('nonfoil')) || isSurgeFoil || isSerialized;
    const isFoil = Boolean(card.isFoil) || isSurgeFoil || isSerialized || isFoilOnly;

    setFoilState(isFoil);

    // Update finish tag badge
    const finishTag = document.getElementById('inspectFinishTag');
    if (finishTag) {
        if (isSurgeFoil) {
            finishTag.className = 'inspect-finish-tag is-surge-foil-tag';
            finishTag.innerHTML = `<span>🌊 Surge Foil Pull</span>`;
            finishTag.style.display = 'inline-block';
        } else if (isSerialized) {
            finishTag.className = 'inspect-finish-tag is-serialized-tag';
            finishTag.innerHTML = `<span>💎 Serialized Pull</span>`;
            finishTag.style.display = 'inline-block';
        } else if (isEtched) {
            finishTag.className = 'inspect-finish-tag is-etched-tag';
            finishTag.innerHTML = `<span>✨ Etched Foil Pull</span>`;
            finishTag.style.display = 'inline-block';
        } else if (isFoil) {
            finishTag.className = 'inspect-finish-tag is-foil-tag';
            finishTag.innerHTML = `<span>✨ Traditional Foil Pull</span>`;
            finishTag.style.display = 'inline-block';
        } else {
            finishTag.className = 'inspect-finish-tag is-nonfoil-tag';
            finishTag.innerHTML = `<span>Standard Non-Foil</span>`;
            finishTag.style.display = 'inline-block';
        }
    }

    // Cardmarket (EUR) price display: prioritize foil price when card is foil or surge foil!
    const eurFoil = card.prices?.eur_foil ? parseFloat(card.prices.eur_foil).toFixed(2) : null;
    const eurReg = card.prices?.eur && card.prices.eur < 9999 ? parseFloat(card.prices.eur).toFixed(2) : null;
    const finishLabel = isSurgeFoil ? 'Surge Foil' : (isSerialized ? 'Serialized' : (isEtched ? 'Etched' : 'Foil'));
    let eurDisplay = '--';
    if (isFoil) {
        if (eurFoil) {
            eurDisplay = `€${eurFoil} (${finishLabel})`;
        } else if (eurReg) {
            eurDisplay = `€${eurReg} (${finishLabel} unlisted)`;
        }
    } else {
        if (eurReg) {
            eurDisplay = `€${eurReg}`;
        } else if (eurFoil) {
            eurDisplay = `€${eurFoil} (${finishLabel} only)`;
        }
    }
    document.getElementById('inspectPriceEur').textContent = eurDisplay;

    // TCGplayer (USD) price display: prioritize foil price when card is foil or surge foil!
    const usdFoil = card.prices?.usd_foil ? parseFloat(card.prices.usd_foil).toFixed(2) : null;
    const usdEtched = card.prices?.usd_etched ? parseFloat(card.prices.usd_etched).toFixed(2) : null;
    const usdReg = card.prices?.usd && card.prices.usd < 9999 ? parseFloat(card.prices.usd).toFixed(2) : null;
    let usdDisplay = '--';
    if (isFoil) {
        if (usdFoil) {
            usdDisplay = `$${usdFoil} (${finishLabel})`;
        } else if (usdEtched) {
            usdDisplay = `$${usdEtched} (Etched Foil)`;
        } else if (usdReg) {
            usdDisplay = `$${usdReg} (${finishLabel} unlisted)`;
        }
    } else {
        if (usdReg) {
            usdDisplay = `$${usdReg}`;
        } else if (usdFoil) {
            usdDisplay = `$${usdFoil} (${finishLabel} only)`;
        } else if (usdEtched) {
            usdDisplay = `$${usdEtched} (Etched only)`;
        }
    }
    document.getElementById('inspectPriceUsd').textContent = usdDisplay;

    const scryfallLink = document.getElementById('inspectScryfallLink');
    if (scryfallLink) scryfallLink.href = card.scryfall_uri || `https://scryfall.com/search?q=${encodeURIComponent(name)}`;

    const edhrecLink = document.getElementById('inspectEdhrecLink');
    if (edhrecLink) {
        const edhSlug = name.split('//')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        edhrecLink.href = `https://edhrec.com/cards/${edhSlug}`;
    }
}

function flipInspectCard() {
    if (!activeInspectCard || !activeInspectCard.card_faces || activeInspectCard.card_faces.length < 2) return;
    isFlipped = !isFlipped;
    const face = activeInspectCard.card_faces[isFlipped ? 1 : 0];
    
    const cardImg = document.getElementById('inspectCardImg');
    if (cardImg && face.image_uris) {
        cardImg.src = face.image_uris.large || face.image_uris.normal;
    }
    document.getElementById('inspectCardName').textContent = face.name || activeInspectCard.name;
    document.getElementById('inspectManaCost').innerHTML = formatManaSymbols(face.mana_cost || '');
    document.getElementById('inspectTypeLine').textContent = face.type_line || '';
    document.getElementById('inspectOracleText').innerHTML = formatOracleText(face.oracle_text || '');
    
    const ptLoyalty = (face.power !== undefined) ? `${face.power}/${face.toughness}` : (face.loyalty ? `Loyalty: ${face.loyalty}` : '');
    const ptEl = document.getElementById('inspectPtLoyalty');
    if (ptEl) {
        ptEl.textContent = ptLoyalty;
        ptEl.style.display = ptLoyalty ? 'block' : 'none';
    }
}

export function closeCardInspector() {
    const modal = document.getElementById('cardInspectorModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

function formatManaSymbols(manaStr) {
    if (!manaStr) return '';
    return manaStr.replace(/\{([^}]+)\}/g, (match, sym) => {
        const clean = sym.toLowerCase().replace('/', '');
        return `<span class="mana-symbol-pip sym-${clean}">${sym}</span>`;
    });
}

function formatOracleText(text) {
    if (!text) return '';
    const safe = text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    return safe.replace(/\{([^}]+)\}/g, (match, sym) => {
        const clean = sym.toLowerCase().replace('/', '');
        return `<span class="mana-symbol-pip inline-sym sym-${clean}">${sym}</span>`;
    });
}

function setup3dGyro() {
    const scene = document.getElementById('inspect3dScene');
    const card = document.getElementById('inspect3dCard');
    const sheen = document.getElementById('inspectFoilSheen');
    if (!scene || !card) return;

    const handleMove = (e) => {
        const rect = scene.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const x = (clientX - rect.left) / rect.width;
        const y = (clientY - rect.top) / rect.height;

        const rotateY = (x - 0.5) * 36;
        const rotateX = (0.5 - y) * 36;

        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.03, 1.03, 1.03)`;
        
        if (sheen) {
            if (foilEnabled) {
                const sheenX = x * 100;
                const sheenY = y * 100;
                sheen.style.display = 'block';
                sheen.style.backgroundPosition = `${sheenX}% ${sheenY}%`;
                sheen.style.opacity = '0.85';
            } else {
                sheen.style.display = 'none';
                sheen.style.opacity = '0';
            }
        }
    };

    const handleLeave = () => {
        card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
        if (sheen) {
            sheen.style.opacity = foilEnabled ? '0.45' : '0';
            sheen.style.display = foilEnabled ? 'block' : 'none';
        }
    };

    scene.addEventListener('mousemove', handleMove);
    scene.addEventListener('mouseleave', handleLeave);
    scene.addEventListener('touchmove', handleMove, { passive: true });
    scene.addEventListener('touchend', handleLeave);
}
