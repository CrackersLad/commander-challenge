// 3D Holographic Card Inspector Module

let activeInspectCard = null;
let isFlipped = false;

export function initCardInspector() {
    if (!document.getElementById('cardInspectorModal')) {
        const modal = document.createElement('div');
        modal.id = 'cardInspectorModal';
        modal.className = 'inspect-modal-overlay';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="inspect-modal-backdrop" onclick="window.closeCardInspector()"></div>
            <div class="inspect-modal-container">
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
                    </div>
                    <div class="inspect-info-column">
                        <div class="inspect-header">
                            <h2 id="inspectCardName" class="inspect-title">Card Name</h2>
                            <div id="inspectManaCost" class="inspect-mana-cost"></div>
                        </div>
                        <div id="inspectFinishTag" class="inspect-finish-tag"></div>
                        <div id="inspectTypeLine" class="inspect-type-line">Type Line</div>
                        <div class="inspect-oracle-box">
                            <div id="inspectOracleText" class="inspect-oracle-text">Oracle text loading...</div>
                            <div id="inspectPtLoyalty" class="inspect-pt-loyalty"></div>
                        </div>
                        <div class="inspect-stats-grid">
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

export async function openCardInspector(cardInput) {
    initCardInspector();
    const modal = document.getElementById('cardInspectorModal');
    if (!modal) return;

    isFlipped = false;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // If cardInput is already a card object, render immediately so there is ZERO delay or flash!
    if (cardInput && typeof cardInput === 'object' && cardInput.name) {
        activeInspectCard = cardInput;
        renderCardInspectData(cardInput);
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

    document.getElementById('inspectEdhrecRank').textContent = card.edhrec_rank ? `#${card.edhrec_rank.toLocaleString()}` : 'Unranked';

    const isFoil = Boolean(card.isFoil);
    setFoilState(isFoil);

    // Update finish tag badge
    const finishTag = document.getElementById('inspectFinishTag');
    if (finishTag) {
        if (isFoil) {
            finishTag.className = 'inspect-finish-tag is-foil-tag';
            finishTag.innerHTML = `<span>✨ Traditional Foil Pull</span>`;
            finishTag.style.display = 'inline-block';
        } else {
            finishTag.className = 'inspect-finish-tag is-nonfoil-tag';
            finishTag.innerHTML = `<span>Standard Non-Foil</span>`;
            finishTag.style.display = 'inline-block';
        }
    }

    // Cardmarket (EUR) price display: prioritize foil price when card is foil!
    const eurFoil = card.prices?.eur_foil ? parseFloat(card.prices.eur_foil).toFixed(2) : null;
    const eurReg = card.prices?.eur ? parseFloat(card.prices.eur).toFixed(2) : null;
    let eurDisplay = '--';
    if (isFoil) {
        if (eurFoil) {
            eurDisplay = `€${eurFoil} (Foil)`;
        } else if (eurReg) {
            eurDisplay = `€${eurReg} (Foil unlisted)`;
        }
    } else {
        if (eurReg) {
            eurDisplay = `€${eurReg}`;
        } else if (eurFoil) {
            eurDisplay = `€${eurFoil} (Foil only)`;
        }
    }
    document.getElementById('inspectPriceEur').textContent = eurDisplay;

    // TCGplayer (USD) price display: prioritize foil price when card is foil!
    const usdFoil = card.prices?.usd_foil ? parseFloat(card.prices.usd_foil).toFixed(2) : null;
    const usdReg = card.prices?.usd ? parseFloat(card.prices.usd).toFixed(2) : null;
    let usdDisplay = '--';
    if (isFoil) {
        if (usdFoil) {
            usdDisplay = `$${usdFoil} (Foil)`;
        } else if (usdReg) {
            usdDisplay = `$${usdReg} (Foil unlisted)`;
        }
    } else {
        if (usdReg) {
            usdDisplay = `$${usdReg}`;
        } else if (usdFoil) {
            usdDisplay = `$${usdFoil} (Foil only)`;
        }
    }
    document.getElementById('inspectPriceUsd').textContent = usdDisplay;

    const scryfallLink = document.getElementById('inspectScryfallLink');
    if (scryfallLink) scryfallLink.href = card.scryfall_uri || `https://scryfall.com/search?q=${encodeURIComponent(name)}`;

    const edhrecLink = document.getElementById('inspectEdhrecLink');
    if (edhrecLink) {
        const edhSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        edhrecLink.href = `https://edhrec.com/commanders/${edhSlug}`;
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
