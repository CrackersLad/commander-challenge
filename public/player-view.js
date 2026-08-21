import { db, functions } from './firebase-setup.js?v=0.13';
import { fetchDeckPriceLocal } from './deck-parser.js?v=0.13';
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
        return colors.map(c => {
            const safeC = sanitizeHTML(c);
            return `<span class="mana-badge mana-${safeC}">${safeC}</span>`;
        }).join('');
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

    async function renderPrereleaseSealedPool(container, s, playerSealedPool) {
        container.innerHTML = `
            <div style="width:100%; text-align:center; margin-bottom: 20px;">
                <h2 style="color:var(--gold); font-family:Cinzel;">Prerelease Sealed Pool</h2>
                <p style="color:#aaa;">Select your commander from the cards you opened!</p>
            </div>
            <div id="sealedPoolGrid" style="display:flex; flex-wrap:wrap; justify-content:center; gap:15px; width:100%;"></div>
        `;
        const sealedPoolGrid = document.getElementById('sealedPoolGrid');

        playerSealedPool.forEach((card, i) => {
            let img1 = card.image_uris?.normal || (card.card_faces && card.card_faces[0].image_uris?.normal) || card.image1;
            let img2 = (card.card_faces && card.card_faces[1] && card.card_faces[1].image_uris?.normal) || card.image2 || null;
            let priceString = "Price N/A";
            if (card.prices) { if (s.currency === 'eur' && card.prices.eur !== 9999) priceString = `€${card.prices.eur}`; else if (s.currency === 'usd' && card.prices.usd !== 9999) priceString = `$${card.prices.usd}`; }
            
            const safeCardName = sanitizeHTML(card.name);
            const edhrecSlug = safeCardName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const edhrecLink = `https://edhrec.com/commanders/${edhrecSlug}`;
            
            const cardDiv = document.createElement('div');
            cardDiv.className = 'option-card revealed'; // Use 'revealed' class for styling
            cardDiv.style.transition = 'none'; // Disable animation for initial render
            cardDiv.style.transform = 'none';
            cardDiv.style.opacity = '1';
            
            let imageHtml = img2 ? `<div class="scene"><div class="card-3d" id="sealed-card3d-${i}"><a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" style="display:block;" class="card-face card-face-front"><img src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy"></a><a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')" style="display:block;" class="card-face card-face-back"><img src="${sanitizeHTML(img2)}" class="commander-img" loading="lazy"></a></div></div><button class="flip-btn" onclick="window.flipCard3D('sealed-card3d-${i}', event)">🔄 Flip Card</button>` : `<a href="${edhrecLink}" target="_blank" onclick="playSound('sfx-click')"><img id="sealed-img-${i}" src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy"></a>`;

            cardDiv.innerHTML = `
                ${imageHtml}
                <p class="price-tag" style="margin-top: 15px;">${priceString}</p>
                <div class="mana-container">${getColorBadges(card.color_identity)}</div>
                <p class="rank-tag" style="color:var(--gold); font-weight:bold; font-size: 1rem; margin-bottom: 15px;">EDHREC Rank: #${card.display_rank || 'Unranked'}</p>
                <button class="select-btn" data-idx="${i}">Select ${safeCardName}</button>
            `;
            cardDiv.querySelector('.select-btn').onclick = () => {
                playSound('sfx-click'); showConfirm("Seal Your Champion?", `Are you sure you want to lock in ${card.name} as your commander? This choice is final.`, () => {
                    playSound('sfx-choose'); update(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`), { selected: card.name, image: img1, display_rank: card.display_rank, scryfall_uri: card.scryfall_uri, color_identity: card.color_identity || [], generated: null, rerollCount: 0, sealedPool: null });
                });
            };
            sealedPoolGrid.appendChild(cardDiv);
        });
        attachScrollListener('content', 'player-scroll-left', 'player-scroll-right');
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
        if (activeDraft.format === 'async_draft') { const { renderAsyncDraft } = await import('./draft-async.js?v=0.13'); renderAsyncDraft(activeDraft, container, s, state.currentPlayerId, players, utils); } 
        else if (activeDraft.format === 'snake_draft') { const { renderSnakeDraft } = await import('./draft-snake.js?v=0.13'); renderSnakeDraft(activeDraft, container, s, state.currentPlayerId, players, utils); } 
        else if (activeDraft.format === 'burn_draft') { const { renderBurnDraft } = await import('./draft-burn.js?v=0.13'); renderBurnDraft(activeDraft, container, s, state.currentPlayerId, players, utils); }
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
            const decklist = `1 ${data.selected} *CMDR*`;
            const url = `https://www.moxfield.com/import?c=${encodeURIComponent(decklist)}`;
            window.open(url, '_blank');
            showToast("Opening Moxfield importer...", false, 3000, true);
        };

        document.getElementById('brewArchidekt').onclick = async () => {
            playSound('sfx-click');
            const btn = document.getElementById('brewArchidekt');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="mana-spinner"></span> Loading...';
            btn.disabled = true;
            
            try {
                const nameMatch = data.selected.includes(" // ") ? data.selected.split(" // ")[0] : data.selected;
                const res = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(nameMatch)}`);
                if (!res.ok) throw new Error("Card not found");
                const scryData = await res.json();
                
                const payload = [{ "c": "c", "f": 0, "q": 1, "u": scryData.id }];
                window.open(`https://archidekt.com/sandbox?deck=${encodeURIComponent(JSON.stringify(payload))}`, '_blank');
                showToast("Archidekt Sandbox created!", false, 3000, true);
            } catch(e) {
                navigator.clipboard.writeText(data.selected).then(() => {
                    showToast("Commander copied! Paste into Archidekt.", false, 4000, true);
                    window.open('https://www.archidekt.com/', '_blank');
                });
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        };

        document.getElementById('saveDeckBtn').onclick = async () => {
            playSound('sfx-click'); const link = document.getElementById('linkIn').value.trim(); const lowerLink = link.toLowerCase();
            if (link && !lowerLink.startsWith('http://') && !lowerLink.startsWith('https://')) {
                return showToast("Invalid URL. Must start with http:// or https://", true);
            }
            if (lowerLink.includes("archidekt.com") || lowerLink.includes("moxfield.com")) {
                const btn = document.getElementById('saveDeckBtn'); btn.innerHTML = '<span class="mana-spinner"></span> Calculating...'; btn.disabled = true;
                showToast(lowerLink.includes("moxfield.com") ? "Calculating deck price... (Moxfield APIs may take a few seconds)" : "Calculating deck price...", false, 0);
                try {
                    const s = (await get(ref(db, `rooms/${state.currentRoom}/settings`))).val();
                    const res = await fetchDeckPriceLocal(link, s.currency, s.includeCmdr, data.selected);
                    if (res.error) { showToast(res.error, true); } else {
                        let updates = { deck: link, deckPrice: res.total || 0, isLegal: res.isLegal, deckSize: res.deckSize, deckSalt: res.deckSalt, deckBracket: res.deckBracket };
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

    function renderPrereleaseSealedPool(container, s, sealedPool) {
        if (!sealedPool || !Array.isArray(sealedPool) || sealedPool.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:30px;"><h2 style="color:var(--gold); font-family:Cinzel;">Generating Sealed Pool...</h2><span class="mana-spinner"></span></div>`;
            return;
        }

        let currentSort = 'color';
        let currentFilter = 'all';
        let sortedCards = [...sealedPool];

        // Categorization & Counts
        const mythics = sealedPool.filter(c => c.rarity === 'mythic').length;
        const rares = sealedPool.filter(c => c.rarity === 'rare').length;
        const uncommons = sealedPool.filter(c => c.rarity === 'uncommon').length;
        const commons = sealedPool.filter(c => c.rarity === 'common').length;
        const legendaries = sealedPool.filter(c => {
            const tl = (c.type_line || '').toLowerCase();
            return tl.includes('legendary') && (tl.includes('creature') || tl.includes('planeswalker'));
        });

        // Function to export to clipboard in MTG text / Arena format
        const exportPoolToClipboard = () => {
            playSound('sfx-click');
            const counts = {};
            sealedPool.forEach(c => {
                const name = c.name || 'Unknown';
                counts[name] = (counts[name] || 0) + 1;
            });
            let exportText = `// Prerelease Sealed Pool (${sealedPool.length} Cards)\n`;
            if (s.draftSetName || s.draftSet) exportText += `// Set: ${s.draftSetName || s.draftSet.toUpperCase()}\n\n`;
            
            Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, count]) => {
                exportText += `${count} ${name}\n`;
            });

            navigator.clipboard.writeText(exportText).then(() => {
                showToast(`Sealed Pool (${sealedPool.length} cards) copied to clipboard!`, false, 3500, true);
            }).catch(() => {
                showToast("Could not copy to clipboard. Please copy manually.", true);
            });
        };

        // Interactive Hand Simulator (Test Draws)
        const openHandSimulator = () => {
            playSound('sfx-click');
            const existingModal = document.getElementById('handSimModal');
            if (existingModal) existingModal.remove();

            let currentHand = [];
            let remainingDeck = [...sealedPool];

            const drawInitialHand = () => {
                remainingDeck = [...sealedPool].sort(() => Math.random() - 0.5);
                currentHand = remainingDeck.splice(0, 7);
            };
            drawInitialHand();

            const simModal = document.createElement('div');
            simModal.id = 'handSimModal';
            simModal.className = 'modal-overlay show';
            simModal.style.display = 'flex';
            simModal.style.zIndex = '6000';

            const updateModalUI = () => {
                simModal.innerHTML = `
                    <div class="modal-content" style="max-width: 750px; width: 95%; max-height: 90vh;">
                        <h2 style="color:var(--gold); font-family:Cinzel; margin-top:0;">🧪 Starting Hand Simulator</h2>
                        <p style="color:#aaa; font-size:0.88rem; margin-bottom:10px;">
                            Drawn: <strong style="color:#fff;">${currentHand.length} cards</strong> • Remaining in Pool: <strong style="color:var(--gold);">${remainingDeck.length} cards</strong>
                        </p>
                        
                        <div class="hand-sim-cards-grid">
                            ${currentHand.map((c) => {
                                const img = c.image_uris?.normal || (c.card_faces && c.card_faces[0]?.image_uris?.normal) || c.image1;
                                return `
                                    <div style="text-align:center;">
                                        <img src="${sanitizeHTML(img)}" class="hand-card-img" title="${sanitizeHTML(c.name)}" loading="lazy">
                                    </div>
                                `;
                            }).join('')}
                        </div>

                        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:15px;">
                            <button id="simMulliganBtn" class="select-btn" style="padding:10px 18px; font-size:0.85rem;">🔄 Mulligan (New 7)</button>
                            <button id="simDrawCardBtn" class="secondary-btn" style="padding:10px 18px; font-size:0.85rem;" ${remainingDeck.length === 0 ? 'disabled' : ''}>🃏 Draw Card (+1)</button>
                            <button id="simCloseBtn" class="btn-cancel" style="padding:10px 18px; font-size:0.85rem;">Close</button>
                        </div>
                    </div>
                `;

                document.getElementById('simMulliganBtn').onclick = () => {
                    playSound('sfx-choose');
                    drawInitialHand();
                    updateModalUI();
                };
                document.getElementById('simDrawCardBtn').onclick = () => {
                    if (remainingDeck.length > 0) {
                        playSound('sfx-click');
                        currentHand.push(remainingDeck.shift());
                        updateModalUI();
                    }
                };
                document.getElementById('simCloseBtn').onclick = () => {
                    playSound('sfx-click');
                    simModal.classList.remove('show');
                    setTimeout(() => simModal.remove(), 300);
                };
            };

            document.body.appendChild(simModal);
            updateModalUI();
        };

        const sortCards = () => {
            const colorOrder = { 'W': 1, 'U': 2, 'B': 3, 'R': 4, 'G': 5, 'C': 6 };
            const rarityOrder = { 'mythic': 1, 'rare': 2, 'uncommon': 3, 'common': 4 };
            const typeOrder = {
                'Creature': 1, 'Planeswalker': 2, 'Battle': 3, 'Instant': 4, 'Sorcery': 5,
                'Artifact': 6, 'Enchantment': 7, 'Land': 8
            };

            sortedCards.sort((a, b) => {
                if (currentSort === 'color') {
                    const aCol = (a.color_identity && a.color_identity.length > 0) ? a.color_identity[0] : 'C';
                    const bCol = (b.color_identity && b.color_identity.length > 0) ? b.color_identity[0] : 'C';
                    if (colorOrder[aCol] !== colorOrder[bCol]) return (colorOrder[aCol] || 99) - (colorOrder[bCol] || 99);
                    return (a.cmc || 0) - (b.cmc || 0);
                }
                if (currentSort === 'cmc') {
                    if ((a.cmc || 0) !== (b.cmc || 0)) return (a.cmc || 0) - (b.cmc || 0);
                    return a.name.localeCompare(b.name);
                }
                if (currentSort === 'rarity') {
                    const aR = rarityOrder[a.rarity] || 99;
                    const bR = rarityOrder[b.rarity] || 99;
                    if (aR !== bR) return aR - bR;
                    return a.name.localeCompare(b.name);
                }
                if (currentSort === 'type') {
                    const aType = (a.type_line || '').split(' — ')[0];
                    const bType = (b.type_line || '').split(' — ')[0];
                    const aO = Object.keys(typeOrder).find(t => aType.includes(t)) || 'Other';
                    const bO = Object.keys(typeOrder).find(t => bType.includes(t)) || 'Other';
                    if (typeOrder[aO] !== typeOrder[bO]) return (typeOrder[aO] || 99) - (typeOrder[bO] || 99);
                    return a.name.localeCompare(b.name);
                }
                return a.name.localeCompare(b.name);
            });
        };

        const render = () => {
            sortCards();

            // Filter logic
            const filteredCards = sortedCards.filter(c => {
                const tl = (c.type_line || '').toLowerCase();
                if (currentFilter === 'commander') return tl.includes('legendary') && (tl.includes('creature') || tl.includes('planeswalker'));
                if (currentFilter === 'creature') return tl.includes('creature');
                if (currentFilter === 'spell') return tl.includes('instant') || tl.includes('sorcery');
                if (currentFilter === 'artifact_enchantment') return tl.includes('artifact') || tl.includes('enchantment');
                if (currentFilter === 'land') return tl.includes('land');
                return true;
            });

            const setName = s.draftSetName || (s.draftSet ? s.draftSet.toUpperCase() : 'MTG Set');

            let html = `
                <div class="sealed-header-wrapper">
                    <h2 class="sealed-title">📦 ${sanitizeHTML(setName)} Sealed Pool</h2>
                    <p style="color:#aaa; font-size:0.92rem; margin:0 auto; max-width:650px;">
                        You have opened a 6-booster sealed pool (${sealedPool.length} cards total). Sort and filter your pool, test opening hands, export to Moxfield/Arena, or pick your Commander!
                    </p>

                    <!-- Pool Stats Breakdown -->
                    <div class="sealed-stats-row">
                        <span class="sealed-stat-chip highlight-arcane">🌟 Rares / Mythics: ${rares + mythics}</span>
                        <span class="sealed-stat-chip">🔷 Uncommons: ${uncommons}</span>
                        <span class="sealed-stat-chip">⚪ Commons: ${commons}</span>
                        <span class="sealed-stat-chip highlight-gold">👑 Potential Commanders: ${legendaries.length}</span>
                    </div>

                    <!-- Action Toolbar -->
                    <div class="sealed-toolbar">
                        <button id="exportPoolBtn" class="secondary-btn toolbar-btn">📥 Export Card List</button>
                        <button id="handSimBtn" class="secondary-btn toolbar-btn" style="border-color:var(--arcane-bright); color:var(--arcane-bright);">🧪 Test Draw Hand</button>
                        <button id="moxfieldImportBtn" class="secondary-btn toolbar-btn" style="border-color:#dfb2f4; color:#dfb2f4;">☕ Open in Moxfield</button>
                    </div>

                    <!-- Sort Controls -->
                    <div style="display:flex; justify-content:center; gap:8px; margin-top:14px; flex-wrap:wrap;">
                        <button class="filter-chip-btn sort-chip-btn ${currentSort === 'color' ? 'active' : ''}" data-sort="color">Sort: Color</button>
                        <button class="filter-chip-btn sort-chip-btn ${currentSort === 'cmc' ? 'active' : ''}" data-sort="cmc">Sort: Cost (CMC)</button>
                        <button class="filter-chip-btn sort-chip-btn ${currentSort === 'rarity' ? 'active' : ''}" data-sort="rarity">Sort: Rarity</button>
                        <button class="filter-chip-btn sort-chip-btn ${currentSort === 'type' ? 'active' : ''}" data-sort="type">Sort: Type</button>
                        <button class="filter-chip-btn sort-chip-btn ${currentSort === 'name' ? 'active' : ''}" data-sort="name">Sort: Name</button>
                    </div>

                    <!-- Filter Chips -->
                    <div class="sealed-filter-bar">
                        <button class="filter-chip-btn filter-type-btn ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">All (${sealedPool.length})</button>
                        <button class="filter-chip-btn filter-type-btn ${currentFilter === 'commander' ? 'active' : ''}" data-filter="commander" style="color:var(--gold);">👑 Commanders (${legendaries.length})</button>
                        <button class="filter-chip-btn filter-type-btn ${currentFilter === 'creature' ? 'active' : ''}" data-filter="creature">Creatures</button>
                        <button class="filter-chip-btn filter-type-btn ${currentFilter === 'spell' ? 'active' : ''}" data-filter="spell">Instants & Sorceries</button>
                        <button class="filter-chip-btn filter-type-btn ${currentFilter === 'artifact_enchantment' ? 'active' : ''}" data-filter="artifact_enchantment">Artifacts & Enchantments</button>
                        <button class="filter-chip-btn filter-type-btn ${currentFilter === 'land' ? 'active' : ''}" data-filter="land">Lands</button>
                    </div>
                </div>

                <!-- Cards Grid -->
                <div id="sealedPoolCardsGrid" style="display:flex; flex-wrap:wrap; justify-content:center; gap:16px; width:100%;">
            `;

            if (filteredCards.length === 0) {
                html += `<div style="padding:40px; color:#888; text-align:center;">No cards match the selected filter.</div>`;
            } else {
                filteredCards.forEach((card, idx) => {
                    const img1 = card.image_uris?.normal || (card.card_faces && card.card_faces[0]?.image_uris?.normal) || card.image1;
                    const img2 = (card.card_faces && card.card_faces[1]?.image_uris?.normal) || card.image2 || null;
                    const safeName = sanitizeHTML(card.name);
                    const tl = (card.type_line || '').toLowerCase();
                    const isLegendary = tl.includes('legendary') && (tl.includes('creature') || tl.includes('planeswalker'));
                    const rarityColor = card.rarity === 'mythic' ? '#ff6600' : (card.rarity === 'rare' ? 'var(--gold)' : (card.rarity === 'uncommon' ? '#88ccff' : '#bbb'));

                    let imageHtml = img2 
                        ? `<div class="scene"><div class="card-3d" id="sealed-card3d-${idx}"><a href="${card.scryfall_uri}" target="_blank" onclick="playSound('sfx-click')" style="display:block;" class="card-face card-face-front"><img src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy"></a><a href="${card.scryfall_uri}" target="_blank" onclick="playSound('sfx-click')" style="display:block;" class="card-face card-face-back"><img src="${sanitizeHTML(img2)}" class="commander-img" loading="lazy"></a></div></div><button class="flip-btn" onclick="window.flipCard3D('sealed-card3d-${idx}', event)">🔄 Flip Card</button>`
                        : `<a href="${card.scryfall_uri}" target="_blank" onclick="playSound('sfx-click')" title="View on Scryfall"><img src="${sanitizeHTML(img1)}" class="commander-img" loading="lazy"></a>`;

                    html += `
                        <div class="option-card revealed" style="width:230px; padding:16px; transition:none; transform:none; opacity:1; border-color:${isLegendary ? 'var(--gold)' : 'rgba(255,255,255,0.12)'};">
                            ${imageHtml}
                            <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:0.75rem; text-transform:uppercase; font-weight:700; color:${rarityColor};">${card.rarity || 'common'}</span>
                                <div class="mana-container" style="margin-bottom:0;">${getColorBadges(card.color_identity)}</div>
                            </div>
                            <p style="color:#ddd; font-size:0.85rem; margin:6px 0; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${safeName}">${safeName}</p>
                            
                            ${(isLegendary || tl.includes('creature')) ? `
                                <button class="select-btn choose-sealed-cmdr-btn" data-card-name="${safeName}" data-card-img="${sanitizeHTML(img1)}" data-card-uri="${card.scryfall_uri || ''}" style="width:100%; padding:8px 10px; font-size:0.78rem; margin-top:8px; ${isLegendary ? '' : 'background:#333; color:#ccc; box-shadow:none;'}">
                                    ⭐ Choose as Commander
                                </button>
                            ` : ''}
                        </div>
                    `;
                });
            }

            html += `</div>`;
            container.innerHTML = html;

            // Bind Event Listeners
            const exportBtn = document.getElementById('exportPoolBtn');
            if (exportBtn) exportBtn.onclick = exportPoolToClipboard;

            const handBtn = document.getElementById('handSimBtn');
            if (handBtn) handBtn.onclick = openHandSimulator;

            const moxBtn = document.getElementById('moxfieldImportBtn');
            if (moxBtn) {
                moxBtn.onclick = () => {
                    playSound('sfx-click');
                    const counts = {};
                    sealedPool.forEach(c => { counts[c.name] = (counts[c.name] || 0) + 1; });
                    let poolText = '';
                    Object.entries(counts).forEach(([name, count]) => { poolText += `${count} ${name}\n`; });
                    window.open(`https://www.moxfield.com/import?c=${encodeURIComponent(poolText)}`, '_blank');
                    showToast("Opening Moxfield Importer with your sealed pool...", false, 3000, true);
                };
            }

            document.querySelectorAll('.sort-chip-btn').forEach(btn => {
                btn.onclick = () => {
                    playSound('sfx-click');
                    currentSort = btn.dataset.sort;
                    render();
                };
            });

            document.querySelectorAll('.filter-type-btn').forEach(btn => {
                btn.onclick = () => {
                    playSound('sfx-click');
                    currentFilter = btn.dataset.filter;
                    render();
                };
            });

            document.querySelectorAll('.choose-sealed-cmdr-btn').forEach(btn => {
                btn.onclick = () => {
                    playSound('sfx-click');
                    const cardName = btn.dataset.cardName;
                    const cardImg = btn.dataset.cardImg;
                    const scryUri = btn.dataset.cardUri;
                    const cardObj = sealedPool.find(c => c.name === cardName) || {};

                    showConfirm("Seal Your Champion?", `Lock in ${cardName} as your Commander for this challenge?`, async () => {
                        playSound('sfx-choose');
                        await update(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`), {
                            selected: cardName,
                            image: cardImg,
                            display_rank: cardObj.display_rank || null,
                            scryfall_uri: scryUri,
                            color_identity: cardObj.color_identity || [],
                            isLegal: true,
                            deckPrice: 0,
                            lockedDeckPrice: 0
                        });
                        showToast(`Commander ${cardName} locked in!`, false, 3000, true);
                    });
                };
            });
        };

        render();
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
        if (actionType === 'async_pick') { const { handleAsyncPick } = await import('./draft-async.js?v=0.13'); await handleAsyncPick(payload, state.currentRoom, state.currentPlayerId, utils); } 
        else if (actionType === 'snake_pick') { const { handleSnakePick } = await import('./draft-snake.js?v=0.13'); await handleSnakePick(payload, state.currentRoom, state.currentPlayerId, utils); } 
        else if (actionType === 'burn_pick') { const { handleBurnPick } = await import('./draft-burn.js?v=0.13'); await handleBurnPick(payload, state.currentRoom, state.currentPlayerId, utils); }
    };

    window.openPlayerView = async () => {
        playSound('sfx-click'); switchView('view-player'); getArchives(); isSearchingManually = false;
        if (state.activePlayerListener) { state.activePlayerListener(); state.activePlayerListener = null; }
        
        const settingsSnap = await get(ref(db, `rooms/${state.currentRoom}/settings`)); const s = settingsSnap.val() || {}; const maxRerollsAllowed = s.maxRerolls !== undefined ? s.maxRerolls : 1;
        get(ref(db, `rooms/${state.currentRoom}/players/${state.currentPlayerId}`)).then(snap => { document.getElementById('playerTitle').innerText = sanitizeHTML(snap.val().name) + "'s Challenge"; });

        // Listen for changes in the room data
        state.activePlayerListener = onValue(ref(db, `rooms/${state.currentRoom}`), (snap) => {
            const roomData = snap.val() || {}; const currentS = roomData.settings || s; const data = roomData.players?.[state.currentPlayerId] || {}; const activeDraft = roomData.activeDraft;
            if (!document.getElementById('view-player').classList.contains('active')) return;
            const container = document.getElementById('content');

            const sealedPool = data.sealedPool || activeDraft?.playerPools?.[state.currentPlayerId];
            if ((activeDraft?.draftMode === 'prerelease_sealed' || currentS.draftFormat === 'prerelease_sealed' || currentS.draftMode === 'prerelease_sealed') && sealedPool && !data.selected) {
                isSearchingManually = false;
                renderPrereleaseSealedPool(container, currentS, sealedPool);
                return;
            }

            if (data.selected) { isSearchingManually = false; renderFinalForm(data); }
            else if (activeDraft && currentS.draftFormat !== 'independent') { isSearchingManually = false; renderInteractiveDraft(activeDraft, container, currentS, roomData.players); }
            else if (data.generated) {
                isSearchingManually = false;
                if (activeDraft?.draftMode === 'set_draft' || currentS.draftMode === 'set_draft') { window.renderDeckBuilder(data.generated, container); }
                else if (currentS.draftFormat !== 'independent') { renderFinalSelection(data.generated, currentS); } 
                else { renderSelectionScreen(data.generated, data.rerollCount || 0, currentS.maxRerolls !== undefined ? currentS.maxRerolls : maxRerollsAllowed, currentS); }
            }
            else { if (!isSearchingManually) { renderInitialChoice(container, currentS); } }
        });
    };

    window.closePlayerView = () => { playSound('sfx-click'); if (state.activePlayerListener) { state.activePlayerListener(); state.activePlayerListener = null; } switchView('view-dashboard'); };
}