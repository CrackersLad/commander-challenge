import { db, functions } from './firebase-setup.js?v=19.30';
import { fetchDeckPriceLocal } from './deck-parser.js?v=19.30';
import { ref, get, update, onValue } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-functions.js";

export function initPlayerViewModule(utils, state) {
    const { playSound, showToast, showConfirm, sanitizeHTML, switchView, attachScrollListener, getArchives } = utils;
    let isSearchingManually = false;

    function debounce(func, wait) {
        let timeout;
        return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); };
    }

    function getColorBadges(colors) {
        if (!colors || colors.length === 0) return `<span class="mana-badge mana-C">C</span>`;
        return colors.map(c => `<span class="mana-badge mana-${c}">${c}</span>`).join('');
    }

    function formatCardData(card) {
        return {
            name: card.name, image_uris: { normal: card.image1 },
            card_faces: card.image2 ? [ {image_uris: {normal: card.image1}}, {image_uris: {normal: card.image2}} ] : null,
            prices: card.prices, display_rank: card.rank_edhrec, color_identity: card.color_identity, scryfall_uri: card.scryfall_uri
        };
    }

    async function fetchOneFromPool(s, existingNamesSet) {
        const archives = await getArchives();
        if(!archives) throw new Error("Could not download archives from database.");
        let pool = archives.filter(c => {
            let price = s.currency === 'eur' ? c.prices.eur : c.prices.usd;
            if (parseFloat(s.budget) !== 0 && price >= parseFloat(s.budget)) return false;
            if (s.noPartner && c.isPartner) return false;
            if (existingNamesSet.has(c.name)) return false;
            if (s.maxRank !== 0 && c.rank_edhrec < s.maxRank) return false;
            if (s.minRank !== 0 && c.rank_edhrec > s.minRank) return false;
            return true;
        });
        if(pool.length === 0) return { error: true };
        return formatCardData(pool[Math.floor(Math.random() * pool.length)]);
    }

    async function rollCommanders() {
        playSound('sfx-click'); const btn = document.getElementById('rollBtn');
        if(btn) { btn.disabled = true; btn.innerHTML = '<span class="mana-spinner"></span> Sifting...'; }
        try {
            const settingsSnap = await get(ref(db, `rooms/${state.currentRoom}/settings`));
            const s = settingsSnap.val(); const numOpts = s.numOptions || 3;
            const archives = await getArchives(); if(!archives) throw new Error("Could not download archives.");
            let pool = archives.filter(c => {
                let price = s.currency === 'eur' ? c.prices.eur : c.prices.usd;
                if (parseFloat(s.budget) !== 0 && price >= parseFloat(s.budget)) return false;
                if (s.noPartner && c.isPartner) return false;
                if (s.maxRank !== 0 && c.rank_edhrec < s.maxRank) return false;
                if (s.minRank !== 0 && c.rank_edhrec > s.minRank) return false;
                return true;
            });

            if (pool.length === 0) { showToast("The Archives are empty! Ask Host to relax settings.", true); if(btn) { btn.disabled = false; btn.innerHTML = "Reveal Commanders"; } return; }

            let list = []; let existingNames = new Set();
            for(let i=0; i < numOpts; i++) {
                let card; let attempts = 0;
                do { card = pool[Math.floor(Math.random() * pool.length)]; attempts++; } while(existingNames.has(card.name) && attempts < 50);
                list.push(formatCardData(card)); existingNames.add(card.name);
            }
            await update(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`), { generated: list, rerollCount: 0 });
            try { const logRollFn = httpsCallable(functions, 'logCommandersRolled'); logRollFn({ count: numOpts }); } catch(e) {}
        } catch (err) { showToast("Error reading the archives. Check console.", true); if(btn) { btn.disabled = false; btn.innerHTML = "Reveal Commanders"; } }
    }

    async function renderInitialChoice(container, s) {
        const mode = s.selectionMode || 'both';
        let html = `<div style="display:flex; flex-direction:column; gap:20px; align-items:center; margin-top: 30px;">`;
        if (mode === 'both' || mode === 'random') html += `<button id="rollBtn" class="select-btn" style="width:auto; padding:20px 40px; font-size:1.3rem;">Reveal Commanders</button>`;
        if (mode === 'both') html += `<p style="color:#aaa; margin:0; font-family:Cinzel;">- OR -</p>`;
        if (mode === 'both' || mode === 'manual') html += `<button id="manualBtn" class="select-btn" style="width:auto; padding:15px 30px; font-size:1rem; background:#444; border-color:#666;">Search Specific Commander</button>`;

        html += `<div style="margin-top: 20px; background: #111; padding: 20px; border-radius: 8px; border: 1px solid #333; width: 90%; max-width: 600px; box-sizing: border-box;">
            <p id="poolCountText" style="color:var(--gold); font-family:Cinzel; margin:0 0 15px 0; font-size:1.1rem;"><span class="mana-spinner"></span> Sifting Archives...</p>
            <button id="showPoolBtn" class="secondary-btn" style="padding: 8px 15px; font-size: 0.9rem; display:none;">Show Eligible Commanders</button>
            <div id="poolGrid" style="display:none; flex-wrap:wrap; gap:6px; justify-content:center; margin-top: 20px;"></div></div></div>`;
        
        container.innerHTML = html;
        if(document.getElementById('rollBtn')) document.getElementById('rollBtn').onclick = () => { rollCommanders(); };
        if(document.getElementById('manualBtn')) document.getElementById('manualBtn').onclick = () => { isSearchingManually = true; renderManualSearch(container, s); };

        const archives = await getArchives();
        let pool = archives ? archives.filter(c => {
            let price = s.currency === 'eur' ? c.prices.eur : c.prices.usd;
            if (parseFloat(s.budget) !== 0 && price >= parseFloat(s.budget)) return false;
            if (s.noPartner && c.isPartner) return false;
            if (s.maxRank !== 0 && c.rank_edhrec < s.maxRank) return false;
            if (s.minRank !== 0 && c.rank_edhrec > s.minRank) return false;
            return true;
        }) : [];

        const poolCountText = document.getElementById('poolCountText'); const showBtn = document.getElementById('showPoolBtn'); const grid = document.getElementById('poolGrid');
        if (poolCountText) poolCountText.innerHTML = `Eligible Commanders in Archives: <span style="color:white;">${pool.length}</span>`;
        if (showBtn && pool.length > 0) {
            showBtn.style.display = 'inline-block';
            showBtn.onclick = () => {
                playSound('sfx-click');
                if (grid.style.display === 'none') {
                    grid.style.display = 'flex'; showBtn.innerText = "Hide Pool";
                    if (grid.innerHTML.trim() === "") {
                        let gridHtml = ''; pool.forEach(c => { let img = c.image_uris?.normal || c.image1; gridHtml += `<div class="pool-card-wrapper" title="${sanitizeHTML(c.name)}"><img src="${sanitizeHTML(img)}" class="pool-card-img" loading="lazy"></div>`; });
                        grid.innerHTML = gridHtml;
                    }
                } else { grid.style.display = 'none'; showBtn.innerText = "Show Eligible Commanders"; }
            };
        }
    }

    async function renderManualSearch(container, s) {
        const archives = await getArchives();
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; gap:15px; margin-top:20px;">
                <h3 style="color:var(--gold); font-family:Cinzel; margin:0;">Search Commander</h3>
                <input type="text" id="manualInput" placeholder="Type commander name..." autocomplete="off" style="width:90%; max-width:350px; padding:12px; border-radius:5px; border:1px solid #555; background:#222; color:white; font-size:1.1rem;">
                <div id="searchResults" style="width:90%; max-width:350px; max-height:350px; overflow-y:auto; background:#151515; border:1px solid #333; border-radius:5px; display:none;"></div>
                <button id="backToRollBtn" class="select-btn" style="background:#444; border-color:#666; width:auto; padding:10px 30px; margin-top:10px;">Back</button>
            </div>`;

        document.getElementById('backToRollBtn').onclick = () => { isSearchingManually = false; renderInitialChoice(container, s); };
        const input = document.getElementById('manualInput'); const resultsDiv = document.getElementById('searchResults'); input.focus();

        input.oninput = debounce(() => {
            const val = input.value.trim().toLowerCase(); if (val.length < 2) { resultsDiv.style.display = 'none'; return; }
            const filtered = archives.filter(c => {
                if (!c.name.toLowerCase().includes(val)) return false;
                let price = s.currency === 'eur' ? c.prices.eur : c.prices.usd;
                if (parseFloat(s.budget) !== 0 && price >= parseFloat(s.budget)) return false;
                if (s.noPartner && c.isPartner) return false;
                if (s.maxRank !== 0 && c.rank_edhrec < s.maxRank) return false;
                if (s.minRank !== 0 && c.rank_edhrec > s.minRank) return false;
                return true;
            }).sort((a, b) => a.rank_edhrec - b.rank_edhrec).slice(0, 20);

            resultsDiv.innerHTML = "";
            if (filtered.length === 0) resultsDiv.innerHTML = `<div style="padding:15px; color:#888; text-align:center;">No eligible commanders found.</div>`;
            else {
                filtered.forEach(c => {
                    const div = document.createElement('div'); div.className = 'search-result-item';
                    let priceStr = s.currency === 'eur' ? `€${c.prices.eur}` : `$${c.prices.usd}`;
                    div.innerHTML = `<img src="${sanitizeHTML(c.image1)}" style="width:50px; border-radius:4px;" loading="lazy"><div style="text-align:left;"><div style="color:white; font-weight:bold; font-size:0.95rem;">${sanitizeHTML(c.name)}</div><div style="font-size:0.8rem; color:#aaa;">Rank #${c.rank_edhrec} • <span style="color:#2ecc71;">${priceStr}</span></div></div>`;
                    div.onclick = () => {
                        playSound('sfx-click'); showConfirm("Confirm Selection", `Select ${c.name} as your commander?`, () => {
                            playSound('sfx-choose'); update(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`), { selected: c.name, image: c.image1, display_rank: c.rank_edhrec, scryfall_uri: c.scryfall_uri, color_identity: c.color_identity || [], generated: null, rerollCount: 0 });
                        });
                    };
                    resultsDiv.appendChild(div);
                });
            }
            resultsDiv.style.display = 'block';
        }, 300);
    }

    function renderSelectionScreen(list, currentRerollCount, maxRerollsAllowed, s) {
        const container = document.getElementById('content'); const isInitialRender = container.querySelectorAll('.option-card').length === 0;
        const canReroll = currentRerollCount < maxRerollsAllowed; const rerollsRemaining = maxRerollsAllowed - currentRerollCount;

        const createCardDiv = (card, i) => {
            let img1 = card.image_uris?.normal || (card.card_faces && card.card_faces[0].image_uris?.normal) || card.image1;
            let img2 = (card.card_faces && card.card_faces[1] && card.card_faces[1].image_uris?.normal) || card.image2 || null;
            let priceString = "Price N/A";
            if (card.prices) { if (s.currency === 'eur' && card.prices.eur !== 9999) priceString = `€${card.prices.eur}`; else if (s.currency === 'usd' && card.prices.usd !== 9999) priceString = `$${card.prices.usd}`; }
            
            const safeCardName = sanitizeHTML(card.name); const edhrecSlug = safeCardName.toLowerCase().replace(/[^a-z0-9]+/g, '-'); const edhrecLink = `https://edhrec.com/commanders/${edhrecSlug}`;
            const cardDiv = document.createElement('div'); cardDiv.className = 'option-card'; cardDiv.setAttribute('data-name', safeCardName); 
            
            let imageHtml = img2 ? `<div class="scene"><div class="card-3d" id="card3d-${i}"><a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" style="display:block;" class="card-face card-face-front"><img src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy"></a><a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" style="display:block;" class="card-face card-face-back"><img src="${sanitizeHTML(img2)}" class="commander-img" loading="lazy"></a></div></div><button class="flip-btn" onclick="window.flipCard3D('card3d-${i}', event)">🔄 Flip Card</button>` : `<a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')"><img id="img-${i}" src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy"></a>`;

            cardDiv.innerHTML = `${imageHtml}<p class="price-tag" style="margin-top: 15px;">${priceString}</p><div class="mana-container">${getColorBadges(card.color_identity)}</div><p class="rank-tag" style="color:var(--gold); font-weight:bold; font-size: 1rem; margin-bottom: 15px;">EDHREC Rank: #${card.display_rank}</p><button class="select-btn" data-idx="${i}">Select ${safeCardName}</button>${canReroll ? `<br><button class="reroll-btn" data-idx="${i}" id="btn-reroll-${i}">Reroll Slot (${rerollsRemaining} left)</button>` : ''}`;

            cardDiv.querySelector('.select-btn').onclick = () => {
                playSound('sfx-click'); showConfirm("Seal Your Champion?", `Are you sure you want to lock in ${card.name} as your commander?`, () => {
                    playSound('sfx-choose'); update(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`), { selected: card.name, image: img1, display_rank: card.display_rank, scryfall_uri: card.scryfall_uri, color_identity: card.color_identity || [], generated: null, rerollCount: 0 });
                });
            };

            const rerollBtn = cardDiv.querySelector(`#btn-reroll-${i}`);
            if (rerollBtn) {
                rerollBtn.onclick = async () => {
                    playSound('sfx-click'); showConfirm("Risk the Archives?", `Are you sure you want to reroll this slot? You have ${rerollsRemaining} reroll(s) remaining!`, async () => {
                        playSound('sfx-click'); rerollBtn.disabled = true; rerollBtn.innerHTML = '<span class="mana-spinner"></span> Sifting...'; cardDiv.classList.remove('revealed'); cardDiv.classList.add('fading-out'); 
                        try {
                            const currentS = (await get(ref(db, `rooms/${state.currentRoom}/settings`))).val();
                            const newCard = await fetchOneFromPool(currentS, new Set(list.map(c => c.name)));
                            if (newCard.error) { showToast("The Archives are empty! Settings are too strict.", true); rerollBtn.disabled = false; rerollBtn.innerHTML = `Reroll Slot (${rerollsRemaining} left)`; cardDiv.classList.remove('fading-out'); cardDiv.classList.add('revealed'); return; }
                            list[i] = newCard; await update(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`), { generated: list, rerollCount: currentRerollCount + 1 });
                        } catch (err) { showToast("Error rerolling.", true); }
                    });
                };
            }
            return cardDiv;
        };

        if (isInitialRender) {
            container.innerHTML = ""; list.forEach((card, i) => { const cardDiv = createCardDiv(card, i); container.appendChild(cardDiv); setTimeout(() => { playSound('sfx-reveal'); cardDiv.classList.add('revealed'); }, i * 1200 + 100); });
        } else {
            list.forEach((card, i) => {
                const existingCard = container.children[i]; const safeCardName = sanitizeHTML(card.name);
                if (!existingCard || existingCard.getAttribute('data-name') !== safeCardName) {
                    const newCardDiv = createCardDiv(card, i); if (existingCard) container.replaceChild(newCardDiv, existingCard); else container.appendChild(newCardDiv);
                    setTimeout(() => { playSound('sfx-reveal'); newCardDiv.classList.add('revealed'); }, 50);
                } else {
                    const updatedCardDiv = createCardDiv(card, i); updatedCardDiv.classList.add('revealed'); updatedCardDiv.style.transition = 'none'; 
                    container.replaceChild(updatedCardDiv, existingCard); setTimeout(() => { updatedCardDiv.style.transition = ''; }, 50);
                }
            });
        }
        attachScrollListener('content', 'player-scroll-left', 'player-scroll-right');
    }

    async function renderInteractiveDraft(activeDraft, container, s, players) {
        if (activeDraft.isComplete) { container.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center; margin-top:50px;"><h2 style="color:var(--gold); font-family:Cinzel;">Finalizing Draft...</h2><span class="mana-spinner"></span></div>`; return; }
        if (activeDraft.format === 'async_draft') { const { renderAsyncDraft } = await import('./draft-async.js?v=19.30'); renderAsyncDraft(activeDraft, container, s, state.currentPlayerId, players, utils); } 
        else if (activeDraft.format === 'snake_draft') { const { renderSnakeDraft } = await import('./draft-snake.js?v=19.30'); renderSnakeDraft(activeDraft, container, s, state.currentPlayerId, players, utils); } 
        else if (activeDraft.format === 'burn_draft') { const { renderBurnDraft } = await import('./draft-burn.js?v=19.30'); renderBurnDraft(activeDraft, container, s, state.currentPlayerId, players, utils); }
    }

    function renderFinalSelection(list, s) {
        const container = document.getElementById('content'); container.innerHTML = `<div style="width:100%; text-align:center; margin-bottom: 20px;"><h2 style="color:var(--gold); font-family:Cinzel;">Draft Complete!</h2><p style="color:#aaa;">Choose your champion from the commanders you drafted.</p></div>`;
        const cardContainer = document.createElement('div'); cardContainer.style.display = 'flex'; cardContainer.style.flexWrap = 'wrap'; cardContainer.style.justifyContent = 'center'; cardContainer.style.gap = '30px'; cardContainer.style.width = '100%';
        
        list.forEach((card, i) => {
            let img1 = card.image_uris?.normal || (card.card_faces && card.card_faces[0].image_uris?.normal) || card.image1; let img2 = (card.card_faces && card.card_faces[1] && card.card_faces[1].image_uris?.normal) || card.image2 || null;
            let priceString = "Price N/A"; if (card.prices) { if (s.currency === 'eur' && card.prices.eur !== 9999) priceString = `€${card.prices.eur}`; else if (s.currency === 'usd' && card.prices.usd !== 9999) priceString = `$${card.prices.usd}`; }
            const safeCardName = sanitizeHTML(card.name); const edhrecSlug = safeCardName.toLowerCase().replace(/[^a-z0-9]+/g, '-'); const edhrecLink = `https://edhrec.com/commanders/${edhrecSlug}`;
            const cardDiv = document.createElement('div'); cardDiv.className = 'option-card revealed'; cardDiv.style.transition = 'none'; cardDiv.style.transform = 'none'; cardDiv.style.opacity = '1';
            
            let imageHtml = img2 ? `<div class="scene"><div class="card-3d" id="final-card3d-${i}"><a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" style="display:block;" class="card-face card-face-front"><img src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy"></a><a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" style="display:block;" class="card-face card-face-back"><img src="${sanitizeHTML(img2)}" class="commander-img" loading="lazy"></a></div></div><button class="flip-btn" onclick="window.flipCard3D('final-card3d-${i}', event)">🔄 Flip Card</button>` : `<a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')"><img id="final-img-${i}" src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy"></a>`;

            cardDiv.innerHTML = `${imageHtml}<p class="price-tag" style="margin-top: 15px;">${priceString}</p><div class="mana-container">${getColorBadges(card.color_identity)}</div><p class="rank-tag" style="color:var(--gold); font-weight:bold; font-size: 1rem; margin-bottom: 15px;">EDHREC Rank: #${card.display_rank}</p><button class="select-btn" data-idx="${i}">Lock In ${safeCardName}</button>`;
            cardDiv.querySelector('.select-btn').onclick = () => { playSound('sfx-click'); showConfirm("Seal Your Champion?", `Are you sure you want to lock in ${card.name} as your commander? This choice is final.`, () => { playSound('sfx-choose'); update(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`), { selected: card.name, image: img1, display_rank: card.display_rank, scryfall_uri: card.scryfall_uri, color_identity: card.color_identity || [], generated: null, rerollCount: 0 }); }); };
            cardContainer.appendChild(cardDiv);
        });
        container.appendChild(cardContainer); attachScrollListener('content', 'player-scroll-left', 'player-scroll-right');
    }

    function renderFinalForm(data) {
        const container = document.getElementById('content'); const safeSelected = sanitizeHTML(data.selected);
        const edhrecSlug = safeSelected.toLowerCase().replace(/[^a-z0-9]+/g, '-'); const edhrecLink = `https://edhrec.com/commanders/${edhrecSlug}`;

        container.innerHTML = `
            <div class="form-container">
                <h2 style="color:var(--gold); font-family:Cinzel; margin-bottom:10px;">Commander Selected</h2>
                <h3 style="font-family:Cinzel; color:white; font-size:1.6rem; margin-bottom:5px;">${safeSelected}</h3>
                <div class="mana-container">${getColorBadges(data.color_identity)}</div>
                <p style="margin: 0 0 15px 0; font-size: 1.1rem; color: #d4af37; font-weight:bold;">EDHREC Rank: ${data.display_rank ? `#${data.display_rank}` : "Unranked"}</p>
                <a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" title="View on EDHREC"><img src="${sanitizeHTML(data.image)}" class="final-commander-img" loading="lazy"></a><br><br>
                
                <div style="display: flex; gap: 10px; justify-content: center; margin-bottom: 25px; flex-wrap: wrap;">
                    <button id="brewMoxfield" class="secondary-btn" style="padding: 8px 12px; font-size: 0.85rem; border-color: #dfb2f4; color: #dfb2f4; box-shadow: 0 0 10px rgba(223, 178, 244, 0.2);">☕ Brew on Moxfield</button>
                    <button id="brewArchidekt" class="secondary-btn" style="padding: 8px 12px; font-size: 0.85rem; border-color: #00b0f0; color: #00b0f0; box-shadow: 0 0 10px rgba(0, 176, 240, 0.2);">📐 Brew on Archidekt</button>
                </div>

                <p style="font-family:Cinzel; color:var(--gold);">Submit Deck Link</p>
                <input type="text" id="linkIn" value="${data.deck ? sanitizeHTML(data.deck) : ''}" placeholder="Moxfield / Archidekt URL..." style="width:80%; max-width:300px; font-size: 16px;">
                <br><button id="saveDeckBtn" class="select-btn">Save & Calculate Price</button>
            </div>`;

        document.getElementById('brewMoxfield').onclick = () => {
            playSound('sfx-click');
            navigator.clipboard.writeText(data.selected).then(() => {
                showToast("Commander copied! Paste into Moxfield.", false, 4000, true);
                window.open('https://moxfield.com/decks/add', '_blank');
            }).catch(() => { window.open('https://moxfield.com/decks/add', '_blank'); });
        };

        document.getElementById('brewArchidekt').onclick = () => {
            playSound('sfx-click');
            navigator.clipboard.writeText(data.selected).then(() => {
                showToast("Commander copied! Paste into Archidekt.", false, 4000, true);
                window.open(`https://archidekt.com/decks/new?format=3&commander=${encodeURIComponent(data.selected)}`, '_blank');
            }).catch(() => { window.open(`https://archidekt.com/decks/new?format=3&commander=${encodeURIComponent(data.selected)}`, '_blank'); });
        };

        document.getElementById('saveDeckBtn').onclick = async () => {
            playSound('sfx-click'); const link = document.getElementById('linkIn').value.trim(); const lowerLink = link.toLowerCase();
            if (lowerLink.includes("archidekt.com") || lowerLink.includes("moxfield.com")) {
                const btn = document.getElementById('saveDeckBtn'); btn.innerHTML = '<span class="mana-spinner"></span> Calculating...'; btn.disabled = true;
                showToast(lowerLink.includes("moxfield.com") ? "Calculating deck price... (Moxfield APIs may take a few seconds)" : "Calculating deck price...", false, 0);
                try {
                    const s = (await get(ref(db, `rooms/${state.currentRoom}/settings`))).val();
                    const res = await fetchDeckPriceLocal(link, s.currency, s.includeCmdr, data.selected);
                    if (res.error) { showToast(res.error, true); } else {
                        let updates = { deck: link, deckPrice: res.total || 0, isLegal: res.isLegal, deckSize: res.deckSize, deckSalt: res.deckSalt };
                        if (res.commanderArt) updates.image = res.commanderArt;
                        if (res.isLegal && ((s.deckBudget !== undefined ? parseFloat(s.deckBudget) : 50) === 0 || (res.total || 0) <= (s.deckBudget !== undefined ? parseFloat(s.deckBudget) : 50)) && data.lockedDeckPrice === undefined) updates.lockedDeckPrice = res.total || 0;
                        await update(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`), updates);
                        showToast("Deck sealed and priced!", false, 3000, true); setTimeout(() => window.closePlayerView(), 1000); 
                    }
                } catch (e) { showToast("Calculation failed. Check URL.", true); } finally { btn.innerHTML = "Save & Calculate Price"; btn.disabled = false; }
            } else {
                if (!link) return showToast("Please enter a URL.", true);
                showConfirm("Price Calculation Unavailable", "You can add a link using other deck builders, but the deck pricing feature currently only works with Archidekt and Moxfield. Do you want to proceed?", async () => {
                    await update(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`), { deck: link, deckPrice: 0, lockedDeckPrice: 0, isLegal: true });
                    showToast("Deck saved.", false, 3000, true); setTimeout(() => window.closePlayerView(), 1000);
                });
            }
        };
    }

    window.flipCard3D = (cardId, event) => { if(event) { event.preventDefault(); event.stopPropagation(); } playSound('sfx-click'); const card = document.getElementById(cardId); if (card) card.classList.toggle('is-flipped'); };

    window.interactiveDraftAction = async (actionType, payload, event) => {
        if (event && event.target) {
            const cardEl = event.target.closest('.option-card');
            if (cardEl) {
                document.querySelectorAll('.option-card .select-btn').forEach(btn => btn.disabled = true);
                if (actionType === 'burn_pick') {
                    playSound('sfx-click');
                    cardEl.classList.add('card-burn-effect');
                } else {
                    playSound('sfx-choose');
                    cardEl.classList.add('card-pick-effect');
                }
                await new Promise(r => setTimeout(r, 550));
            }
        }
        if (actionType === 'async_pick') { const { handleAsyncPick } = await import('./draft-async.js?v=19.30'); await handleAsyncPick(payload, state.currentRoom, state.currentPlayerId, utils); } 
        else if (actionType === 'snake_pick') { const { handleSnakePick } = await import('./draft-snake.js?v=19.30'); await handleSnakePick(payload, state.currentRoom, state.currentPlayerId, utils); } 
        else if (actionType === 'burn_pick') { const { handleBurnPick } = await import('./draft-burn.js?v=19.30'); await handleBurnPick(payload, state.currentRoom, state.currentPlayerId, utils); }
    };

    window.openPlayerView = async () => {
        playSound('sfx-click'); switchView('view-player'); getArchives(); isSearchingManually = false;
        if (state.activePlayerListener) { state.activePlayerListener(); state.activePlayerListener = null; }
        
        const settingsSnap = await get(ref(db, `rooms/${state.currentRoom}/settings`)); const s = settingsSnap.val() || {}; const maxRerollsAllowed = s.maxRerolls !== undefined ? s.maxRerolls : 1;
        get(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`)).then(snap => { document.getElementById('playerTitle').innerText = sanitizeHTML(snap.val().name) + "'s Challenge"; });

        state.activePlayerListener = onValue(ref(db, `rooms/${state.currentRoom}`), (snap) => {
            const roomData = snap.val() || {}; const currentS = roomData.settings || s; const data = roomData.players?.[state.currentPlayerId] || {}; const activeDraft = roomData.activeDraft;
            if (!document.getElementById('view-player').classList.contains('active')) return;
            const container = document.getElementById('content');
            if (data.selected) { isSearchingManually = false; renderFinalForm(data); }
            else if (activeDraft && currentS.draftFormat !== 'independent') { isSearchingManually = false; renderInteractiveDraft(activeDraft, container, currentS, roomData.players); }
            else if (data.generated) { isSearchingManually = false; if (currentS.draftFormat !== 'independent') { renderFinalSelection(data.generated, currentS); } else { renderSelectionScreen(data.generated, data.rerollCount || 0, currentS.maxRerolls !== undefined ? currentS.maxRerolls : maxRerollsAllowed, currentS); } }
            else { if (!isSearchingManually) { renderInitialChoice(container, currentS); } }
        });
    };

    window.closePlayerView = () => { playSound('sfx-click'); if (state.activePlayerListener) { state.activePlayerListener(); state.activePlayerListener = null; } switchView('view-dashboard'); };
}