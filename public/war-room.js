// Pod Meta & Deck Scouting Radar ("The War Room")

export function initWarRoom(db, state, utils) {
    const { playSound, sanitizeHTML } = utils;

    if (!document.getElementById('warRoomModal')) {
        const modal = document.createElement('div');
        modal.id = 'warRoomModal';
        modal.className = 'war-room-overlay';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="war-room-backdrop" onclick="window.closeWarRoom()"></div>
            <div class="war-room-container">
                <div class="war-room-header">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="font-size:1.6rem;">📊</span>
                        <div>
                            <h2 class="war-room-title">The War Room</h2>
                            <p class="war-room-subtitle">Pod Meta Radar & Head-to-Head Scouting</p>
                        </div>
                    </div>
                    <button class="inspect-close-btn" onclick="window.closeWarRoom()" title="Close War Room">✕</button>
                </div>
                
                <div class="war-room-body" id="warRoomContent">
                    <!-- Injected dynamically -->
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    window.openWarRoom = (roomData) => openWarRoom(roomData, state, utils);
    window.closeWarRoom = closeWarRoom;
}

export function openWarRoom(roomData, state, utils) {
    const { playSound, sanitizeHTML } = utils;
    playSound('sfx-click');

    const modal = document.getElementById('warRoomModal');
    if (!modal) return;

    if (!roomData || !roomData.players) {
        return;
    }

    const players = roomData.players || {};
    const settings = roomData.settings || {};
    const isBlind = settings.blindDraft === true;
    const allLocked = Object.values(players).every(p => p.selected);
    const hideSecret = isBlind && !allLocked;

    const currSym = settings.currency === 'usd' ? '$' : '€';
    const maxBudget = settings.deckBudget !== undefined ? parseFloat(settings.deckBudget) : 50;
    const maxBracket = settings.maxBracket !== undefined ? parseFloat(settings.maxBracket) : 0;

    // 1. Calculate Aggregate Pod Metrics
    let totalPodCost = 0;
    let pricedPlayersCount = 0;
    let totalSalt = 0;
    let saltedPlayersCount = 0;
    let bracketSum = 0;
    let bracketCount = 0;
    let readyCount = 0;
    let maxSaltVal = -1;
    let saltiestPlayer = null;

    const colorCounts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    let totalColorsCounted = 0;

    const pList = Object.entries(players);

    pList.forEach(([pId, p]) => {
        // Price
        if (p.deckPrice !== undefined && p.deckPrice !== null) {
            let effPrice = p.lockedDeckPrice !== undefined ? p.lockedDeckPrice : p.deckPrice;
            totalPodCost += effPrice;
            pricedPlayersCount++;
        }

        // Salt
        if (p.deckSalt !== undefined && p.deckSalt !== null && !isNaN(p.deckSalt)) {
            totalSalt += p.deckSalt;
            saltedPlayersCount++;
            if (p.deckSalt > maxSaltVal) {
                maxSaltVal = p.deckSalt;
                saltiestPlayer = p.name;
            }
        }

        // Bracket
        if (p.deckBracket !== undefined && p.deckBracket !== null && !isNaN(p.deckBracket)) {
            bracketSum += p.deckBracket;
            bracketCount++;
        }

        // Readiness
        let checkPrice = p.lockedDeckPrice !== undefined ? p.lockedDeckPrice : (p.deckPrice || 0);
        let isUnderBudget = maxBudget === 0 || checkPrice <= maxBudget;
        let isUnderBracket = maxBracket === 0 || !p.deckBracket || p.deckBracket <= maxBracket;
        if (p.deck && p.isLegal === true && isUnderBudget && isUnderBracket) {
            readyCount++;
        }

        // Color Identity (from commander colors if available)
        if (p.selectedColors && Array.isArray(p.selectedColors)) {
            if (p.selectedColors.length === 0) {
                colorCounts.C++;
                totalColorsCounted++;
            } else {
                p.selectedColors.forEach(c => {
                    const up = String(c).toUpperCase();
                    if (colorCounts[up] !== undefined) {
                        colorCounts[up]++;
                        totalColorsCounted++;
                    }
                });
            }
        }
    });

    const avgPrice = pricedPlayersCount > 0 ? (totalPodCost / pricedPlayersCount).toFixed(2) : '--';
    const avgSalt = saltedPlayersCount > 0 ? (totalSalt / saltedPlayersCount).toFixed(2) : '--';
    const avgBracket = bracketCount > 0 ? (bracketSum / bracketCount).toFixed(1) : '--';

    // 2. Build Color Pie Breakdown HTML
    let colorPieHtml = '';
    const colorMeta = [
        { key: 'W', label: 'White', color: '#f9faf4', bg: '#e0d8b0', text: '#000' },
        { key: 'U', label: 'Blue', color: '#0e68ab', bg: '#1d8fe1', text: '#fff' },
        { key: 'B', label: 'Black', color: '#150b00', bg: '#403b37', text: '#fff' },
        { key: 'R', label: 'Red', color: '#d3202a', bg: '#e74c3c', text: '#fff' },
        { key: 'G', label: 'Green', color: '#00733e', bg: '#2ecc71', text: '#fff' },
        { key: 'C', label: 'Colorless', color: '#a69f9d', bg: '#7f8c8d', text: '#fff' }
    ];

    colorPieHtml += `<div class="war-color-pie-bar">`;
    colorMeta.forEach(cm => {
        const cnt = colorCounts[cm.key];
        const pct = totalColorsCounted > 0 ? ((cnt / totalColorsCounted) * 100).toFixed(1) : 0;
        if (cnt > 0) {
            colorPieHtml += `<div class="war-color-segment" style="width: ${pct}%; background: ${cm.bg}; color: ${cm.text};" title="${cm.label}: ${cnt} (${pct}%)">
                <span class="war-color-code">${cm.key}</span>
            </div>`;
        }
    });
    colorPieHtml += `</div>`;

    let colorLegendHtml = `<div class="war-color-legend">`;
    colorMeta.forEach(cm => {
        const cnt = colorCounts[cm.key];
        colorLegendHtml += `
            <div class="war-legend-item">
                <span class="war-pip" style="background: ${cm.bg}; color: ${cm.text};">${cm.key}</span>
                <span class="war-legend-label">${cm.label}:</span>
                <strong>${cnt}</strong>
            </div>
        `;
    });
    colorLegendHtml += `</div>`;

    // 3. Build Matrix Table Rows
    let rowsHtml = '';
    pList.forEach(([pId, p]) => {
        const safeName = sanitizeHTML(p.name || 'Player');
        const showCmdr = !hideSecret && p.selected;
        const cmdrName = showCmdr ? sanitizeHTML(p.selected) : (p.selected ? '🔒 Hidden (Blind Draft)' : 'Drafting...');
        const cmdrArt = showCmdr ? (p.image || 'card_back.webp') : 'card_back.webp';
        
        let checkPrice = p.lockedDeckPrice !== undefined ? p.lockedDeckPrice : (p.deckPrice || 0);
        let isOverB = maxBudget !== 0 && checkPrice > maxBudget;
        let isOverBrk = maxBracket > 0 && p.deckBracket && p.deckBracket > maxBracket;
        let isReady = p.deck && p.isLegal === true && !isOverB && !isOverBrk;

        let statusTag = isReady ? `<span class="war-badge ready">⚔️ Ready</span>` : (p.deck ? `<span class="war-badge sealed">Sealed</span>` : `<span class="war-badge waiting">Waiting</span>`);

        let priceDisplay = p.deckPrice !== undefined ? `${currSym}${checkPrice.toFixed(2)}` : '--';
        if (isOverB) priceDisplay = `<span style="color:#ff4444; font-weight:bold;">${priceDisplay} ⚠️</span>`;

        let bracketDisplay = p.deckBracket !== undefined && p.deckBracket !== null ? `Bracket ${p.deckBracket}` : '--';
        if (isOverBrk) bracketDisplay = `<span style="color:#ff6666; font-weight:bold;">${bracketDisplay} ❌</span>`;

        let saltDisplay = p.deckSalt !== undefined && p.deckSalt !== null ? Number(p.deckSalt).toFixed(2) : '--';
        if (p.name === saltiestPlayer && maxSaltVal > 0) saltDisplay = `<span style="color:#39ff14; font-weight:bold;">☣️ ${saltDisplay}</span>`;

        // Color pips
        let pipsHtml = '';
        if (showCmdr && p.selectedColors && p.selectedColors.length > 0) {
            pipsHtml = p.selectedColors.map(c => `<span class="mana-symbol-pip sym-${String(c).toLowerCase()}">${c}</span>`).join(' ');
        } else if (showCmdr) {
            pipsHtml = `<span class="mana-symbol-pip sym-c">C</span>`;
        } else {
            pipsHtml = `<span style="color:#666;">?</span>`;
        }

        rowsHtml += `
            <div class="war-player-card">
                <div class="war-player-left">
                    <img src="${sanitizeHTML(cmdrArt)}" class="war-cmdr-thumb" alt="Commander" onclick="${showCmdr ? `window.openCardInspector('${sanitizeHTML(p.selected)}')` : ''}">
                    <div>
                        <div class="war-player-name">${safeName} ${p.isHost ? '👑' : ''}</div>
                        <div class="war-cmdr-name" onclick="${showCmdr ? `window.openCardInspector('${sanitizeHTML(p.selected)}')` : ''}">${cmdrName}</div>
                        <div class="war-pips-row">${pipsHtml}</div>
                    </div>
                </div>
                <div class="war-player-stats">
                    <div class="war-stat-cell">
                        <span class="war-stat-title">Deck Cost</span>
                        <span class="war-stat-val">${priceDisplay}</span>
                    </div>
                    <div class="war-stat-cell">
                        <span class="war-stat-title">Bracket</span>
                        <span class="war-stat-val">${bracketDisplay}</span>
                    </div>
                    <div class="war-stat-cell">
                        <span class="war-stat-title">Salt Score</span>
                        <span class="war-stat-val">${saltDisplay}</span>
                    </div>
                    <div class="war-stat-cell">
                        <span class="war-stat-title">Status</span>
                        <span class="war-stat-val">${statusTag}</span>
                    </div>
                </div>
            </div>
        `;
    });

    const contentEl = document.getElementById('warRoomContent');
    if (contentEl) {
        contentEl.innerHTML = `
            <!-- Top Metric Gauges -->
            <div class="war-metrics-grid">
                <div class="war-metric-tile">
                    <span class="war-metric-icon">💰</span>
                    <div>
                        <div class="war-metric-val">${currSym}${avgPrice}</div>
                        <div class="war-metric-lbl">Avg Deck Cost (Pod: ${currSym}${totalPodCost.toFixed(2)})</div>
                    </div>
                </div>
                <div class="war-metric-tile">
                    <span class="war-metric-icon">⚡</span>
                    <div>
                        <div class="war-metric-val">${avgBracket}</div>
                        <div class="war-metric-lbl">Avg Power Bracket ${maxBracket > 0 ? `(Max: ${maxBracket})` : ''}</div>
                    </div>
                </div>
                <div class="war-metric-tile">
                    <span class="war-metric-icon">🧂</span>
                    <div>
                        <div class="war-metric-val">${avgSalt}</div>
                        <div class="war-metric-lbl">Pod Salt Index ${saltiestPlayer ? `(Top: ${sanitizeHTML(saltiestPlayer)})` : ''}</div>
                    </div>
                </div>
                <div class="war-metric-tile">
                    <span class="war-metric-icon">⚔️</span>
                    <div>
                        <div class="war-metric-val">${readyCount}/${pList.length}</div>
                        <div class="war-metric-lbl">Challengers Battle Ready</div>
                    </div>
                </div>
            </div>

            <!-- Color Distribution Matrix -->
            <div class="war-section-box">
                <h3 class="war-box-title">🎨 Pod Color Distribution</h3>
                ${colorPieHtml}
                ${colorLegendHtml}
            </div>

            <!-- Challenger Matchup Table -->
            <div class="war-section-box">
                <h3 class="war-box-title">👥 Challenger Rosters & Stats</h3>
                <div class="war-roster-list">
                    ${rowsHtml}
                </div>
            </div>
        `;
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

export function closeWarRoom() {
    const modal = document.getElementById('warRoomModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}
