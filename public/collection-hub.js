
        // ==================== UNIFIED SITE AUTHENTICATION ====================
        let currentAuthUser = null;

        window.openCollectionTab = function(tab, options = {}) {
            // 1. Direct view switch to view-collection-hub
            if (typeof window.switchView === 'function') {
                window.switchView('view-collection-hub');
            } else {
                document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
                const el = document.getElementById('view-collection-hub');
                if (el) el.classList.add('active');
                window.scrollTo(0, 0);
                document.body.scrollTop = 0;
            }

            // 2. Switch the active collection sub-tab
            if (typeof switchTab === 'function') {
                switchTab(tab);
            } else if (typeof window.switchTab === 'function') {
                window.switchTab(tab);
            }

            // 3. Handle upgrader drawer
            if (options && options.openUpgrader) {
                setTimeout(() => {
                    const upgraderDrawer = document.getElementById('aiUpgradesDrawer') || document.getElementById('aiUpgradeContainer') || document.getElementById('suggestImprovementsBtn');
                    if (upgraderDrawer) {
                        upgraderDrawer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    const expandBtn = document.getElementById('openAiUpgradeBtn') || document.getElementById('toggleUpgradesBtn');
                    if (expandBtn) expandBtn.click();
                }, 200);
            }

            // 4. Handle preloaded deck
            if (options && options.preloadDeck && typeof addDeck === 'function') {
                const deckInput = document.getElementById('deckInput');
                if (deckInput) {
                    deckInput.value = options.preloadDeck;
                    addDeck();
                }
            }
        };

        function getUnifiedUser() {
            return window.currentUser || (window.auth && window.auth.currentUser) || null;
        }

        function updateAuthHeaderUI(user) {
            const loginBtn = document.getElementById('authLoginBtn');
            const userMenu = document.getElementById('userMenuWrapper');
            const userDisplayNameEl = document.getElementById('userDisplayName');
            const userAvatarEl = document.getElementById('userAvatar');
            const userDropdownName = document.getElementById('userDropdownName');
            const userDropdownEmail = document.getElementById('userDropdownEmail');

            currentAuthUser = (user && !user.isAnonymous) ? user : null;

            if (currentAuthUser) {
                if (loginBtn) loginBtn.style.display = 'none';
                if (userMenu) userMenu.style.display = 'inline-block';

                const name = currentAuthUser.displayName || localStorage.getItem('playerName') || currentAuthUser.email?.split('@')[0] || 'Player';
                if (userDisplayNameEl) userDisplayNameEl.textContent = name;
                if (userDropdownName) userDropdownName.textContent = name;
                if (userDropdownEmail) userDropdownEmail.textContent = currentAuthUser.email || '';

                if (userAvatarEl) {
                    const avatar = currentAuthUser.photoURL || localStorage.getItem('playerAvatar');
                    if (avatar) {
                        userAvatarEl.innerHTML = `<img src="${avatar}" alt="${name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                    } else {
                        userAvatarEl.textContent = name.charAt(0).toUpperCase();
                    }
                }
            } else {
                if (loginBtn) {
                    loginBtn.style.display = 'inline-flex';
                    loginBtn.onclick = () => {
                        if (typeof window.openAccountModal === 'function') {
                            window.openAccountModal();
                        }
                    };
                }
                if (userMenu) userMenu.style.display = 'none';
                closeUserDropdown();
            }
        }

        function toggleUserDropdown(event) {
            if (event) event.stopPropagation();
            const dropdown = document.getElementById('userDropdown');
            if (!dropdown) return;
            const isShown = dropdown.style.display === 'block';
            dropdown.style.display = isShown ? 'none' : 'block';
        }

        function closeUserDropdown() {
            const dropdown = document.getElementById('userDropdown');
            if (dropdown) dropdown.style.display = 'none';
        }

        window.addEventListener('click', (e) => {
            const userMenu = document.getElementById('userMenuWrapper');
            if (userMenu && !userMenu.contains(e.target)) {
                closeUserDropdown();
            }
        });

        function openAuthModal(defaultTab = 'signin') {
            closeUserDropdown();
            if (typeof window.openAccountModal === 'function') {
                window.openAccountModal();
            }
        }

        function closeAuthModal() {
            closeUserDropdown();
        }

        async function handleSignOut() {
            closeUserDropdown();
            if (typeof window.handleGlobalSignOut === 'function') {
                await window.handleGlobalSignOut();
            } else if (window.auth) {
                try {
                    await window.auth.signOut();
                    window.location.reload();
                } catch (e) {
                    console.error("Sign out failed:", e);
                }
            }
        }

        let isCloudSyncIncoming = false;
        let activeCollectionPrefsUnsubscribe = null;
        let activeTradeBinderUnsubscribe = null;
        let syncTradeTimeout = null;
        let syncPrefsTimeout = null;

        function syncCollectionPrefsToCloud() {
            const user = currentAuthUser || getUnifiedUser();
            if (!user || user.isAnonymous) return;
            if (isCloudSyncIncoming) return;

            clearTimeout(syncPrefsTimeout);
            syncPrefsTimeout = setTimeout(async () => {
                const collId = document.getElementById('collectionId')?.value.trim() || localStorage.getItem('archidekt_collectionId') || '';
                const remoteIds = Array.from(activeDeckIds).filter(id => !id.startsWith('custom:')).join(',');
                const payload = {
                    collectionId: collId,
                    deckIds: remoteIds,
                    deckNames: deckNames || {},
                    customDecks: customPastedDecks || [],
                    updatedAt: Date.now()
                };

                try {
                    localStorage.setItem(`archidekt_cloud_sync_${user.uid}`, JSON.stringify(payload));
                    if (window.db && window.firebaseSet && window.firebaseRef) {
                        await window.firebaseSet(window.firebaseRef(window.db, `users/${user.uid}/collectionPrefs`), payload);
                    }
                } catch (e) {
                    console.warn("Failed to auto-sync collectionPrefs to cloud:", e);
                }
            }, 600);
        }

        function syncTradeBinderToCloud(binder) {
            const user = currentAuthUser || getUnifiedUser();
            if (!user || user.isAnonymous) return;
            if (isCloudSyncIncoming) return;

            clearTimeout(syncTradeTimeout);
            syncTradeTimeout = setTimeout(async () => {
                const targetBinder = binder || tradeBinder;
                const payload = {
                    haves: (targetBinder && targetBinder.haves) || [],
                    wants: (targetBinder && targetBinder.wants) || [],
                    updatedAt: Date.now()
                };
                try {
                    if (window.db && window.firebaseSet && window.firebaseRef) {
                        await window.firebaseSet(window.firebaseRef(window.db, `users/${user.uid}/tradeBinder`), payload);
                    }
                } catch (e) {
                    console.warn("Failed to auto-sync tradeBinder to cloud:", e);
                }
            }, 600);
        }

        function saveTradeBinderToStorage() {
            if (typeof AppStorage !== 'undefined' && AppStorage.saveTradeBinder) {
                AppStorage.saveTradeBinder(tradeBinder);
            }
        }

        async function syncUserDataToCloud() {
            const user = currentAuthUser || getUnifiedUser();
            if (!user || user.isAnonymous) {
                if (typeof window.openAccountModal === 'function') {
                    window.openAccountModal();
                }
                showToast("Please sign in with Google or Discord to sync your collection & decks.");
                return;
            }
            const collId = document.getElementById('collectionId')?.value.trim() || localStorage.getItem('archidekt_collectionId') || '';
            const deckIds = Array.from(activeDeckIds).filter(id => !id.startsWith('custom:')).join(',');
            const syncPayload = {
                collectionId: collId,
                deckIds: deckIds,
                deckNames: deckNames || {},
                customDecks: customPastedDecks || [],
                updatedAt: Date.now()
            };
            const tradePayload = {
                haves: tradeBinder?.haves || [],
                wants: tradeBinder?.wants || [],
                updatedAt: Date.now()
            };

            try {
                localStorage.setItem(`archidekt_cloud_sync_${user.uid}`, JSON.stringify(syncPayload));
                if (user.displayName) {
                    localStorage.setItem('archidekt_playerName', user.displayName);
                }
                if (window.db && window.firebaseSet && window.firebaseRef) {
                    await window.firebaseSet(window.firebaseRef(window.db, `users/${user.uid}/collectionPrefs`), syncPayload);
                    await window.firebaseSet(window.firebaseRef(window.db, `users/${user.uid}/tradeBinder`), tradePayload);
                }
                closeUserDropdown();
                showToast("Collection, decks, and trade binder synced to your cloud account!");
            } catch (e) {
                console.warn("Cloud sync error:", e);
                closeUserDropdown();
                showToast("Data saved to your cloud account!");
            }
        }

        async function autoLoadUserPreferences(user) {
            if (!user || user.isAnonymous) return;

            // Unsubscribe existing listeners if user changed
            if (activeCollectionPrefsUnsubscribe) {
                try { activeCollectionPrefsUnsubscribe(); } catch (e) {}
                activeCollectionPrefsUnsubscribe = null;
            }
            if (activeTradeBinderUnsubscribe) {
                try { activeTradeBinderUnsubscribe(); } catch (e) {}
                activeTradeBinderUnsubscribe = null;
            }

            if (!window.db || !window.firebaseRef) return;

            // 1. Real-time sync for Collection Prefs & Decks
            if (window.firebaseOnValue) {
                const prefsRef = window.firebaseRef(window.db, `users/${user.uid}/collectionPrefs`);
                activeCollectionPrefsUnsubscribe = window.firebaseOnValue(prefsRef, (snap) => {
                    if (!snap.exists()) {
                        const localCollId = document.getElementById('collectionId')?.value.trim() || localStorage.getItem('archidekt_collectionId');
                        if (activeDeckIds.size > 0 || localCollId) {
                            syncCollectionPrefsToCloud();
                        }
                        return;
                    }

                    const cloudVal = snap.val();
                    if (!cloudVal) return;

                    isCloudSyncIncoming = true;
                    try {
                        let changedDecks = false;

                        // Restore Collection ID
                        if (cloudVal.collectionId) {
                            const collInput = document.getElementById('collectionId');
                            if (collInput && collInput.value.trim() !== cloudVal.collectionId) {
                                collInput.value = cloudVal.collectionId;
                                localStorage.setItem('archidekt_collectionId', cloudVal.collectionId);
                                if (typeof toggleCollectionInputs === 'function') toggleCollectionInputs();
                                if (typeof updateCollectionStatusBadge === 'function') updateCollectionStatusBadge();
                            }
                        }

                        // Restore Deck Names
                        if (cloudVal.deckNames && typeof cloudVal.deckNames === 'object') {
                            Object.assign(deckNames, cloudVal.deckNames);
                            localStorage.setItem('archidekt_deckNames', JSON.stringify(deckNames));
                        }

                        // Restore Custom Pasted Decks
                        if (Array.isArray(cloudVal.customDecks)) {
                            cloudVal.customDecks.forEach(cd => {
                                if (cd && cd.id && !customPastedDecks.some(d => d.id === cd.id)) {
                                    customPastedDecks.push(cd);
                                    activeDeckIds.add(cd.id);
                                    if (cd.name) deckNames[cd.id] = cd.name;
                                    changedDecks = true;
                                }
                            });
                        }

                        // Restore Remote Deck IDs
                        if (cloudVal.deckIds) {
                            const ids = cloudVal.deckIds.split(/[,\s\n]+/).map(s => s.trim()).filter(Boolean);
                            ids.forEach(id => {
                                const sanitized = sanitizeDeckInput(id);
                                if (sanitized && !activeDeckIds.has(sanitized)) {
                                    activeDeckIds.add(sanitized);
                                    fetchDeckName(sanitized);
                                    changedDecks = true;
                                }
                            });
                        }

                        if (changedDecks || (cloudVal.deckIds && (!activeDeckIds || activeDeckIds.size === 0))) {
                            renderDeckChips();
                            const remoteIds = Array.from(activeDeckIds).filter(id => !id.startsWith('custom:'));
                            localStorage.setItem('archidekt_deckIds', remoteIds.join(','));
                            localStorage.setItem('archidekt_customDecks', JSON.stringify(customPastedDecks));
                        }
                    } finally {
                        setTimeout(() => { isCloudSyncIncoming = false; }, 300);
                    }
                });

                // 2. Real-time sync for Trade Binder
                const tradeRef = window.firebaseRef(window.db, `users/${user.uid}/tradeBinder`);
                activeTradeBinderUnsubscribe = window.firebaseOnValue(tradeRef, (snap) => {
                    if (!snap.exists()) {
                        const localTotal = (tradeBinder.haves || []).length + (tradeBinder.wants || []).length;
                        if (localTotal > 0) {
                            syncTradeBinderToCloud(tradeBinder);
                        }
                        return;
                    }

                    const cloudBinder = snap.val();
                    if (!cloudBinder) return;

                    isCloudSyncIncoming = true;
                    try {
                        const cloudHaves = Array.isArray(cloudBinder.haves) ? cloudBinder.haves : [];
                        const cloudWants = Array.isArray(cloudBinder.wants) ? cloudBinder.wants : [];

                        function mergeList(targetList, sourceList) {
                            sourceList.forEach(item => {
                                if (!item || !item.name) return;
                                const existing = targetList.find(c =>
                                    c.name.toLowerCase() === item.name.toLowerCase() &&
                                    (!item.setCode || (c.setCode || '').toUpperCase() === (item.setCode || '').toUpperCase()) &&
                                    (!item.collectorNumber || String(c.collectorNumber || '').toLowerCase() === String(item.collectorNumber || '').toLowerCase()) &&
                                    (c.finish || 'Normal').toLowerCase() === (item.finish || 'Normal').toLowerCase()
                                );
                                if (existing) {
                                    existing.quantity = Math.max(existing.quantity || 1, item.quantity || 1);
                                    if (item.imageUrl && !existing.imageUrl) existing.imageUrl = item.imageUrl;
                                    if (item.prices) existing.prices = item.prices;
                                } else {
                                    targetList.push(item);
                                }
                            });
                        }

                        if (!tradeBinder.haves) tradeBinder.haves = [];
                        if (!tradeBinder.wants) tradeBinder.wants = [];

                        mergeList(tradeBinder.haves, cloudHaves);
                        mergeList(tradeBinder.wants, cloudWants);

                        try {
                            localStorage.setItem('archidekt_tradeBinder', JSON.stringify(tradeBinder));
                        } catch (e) {}

                        updateTradeBadge();
                        const activeTab = localStorage.getItem('archidekt_activeTab');
                        if (activeTab === 'trade' && typeof renderTradeBinder === 'function') {
                            renderTradeBinder();
                        }
                    } finally {
                        setTimeout(() => { isCloudSyncIncoming = false; }, 300);
                    }
                });
            }
        }

        window.onUnifiedAuthStateChanged = function(user) {
            updateAuthHeaderUI(user);
            if (user && !user.isAnonymous) {
                autoLoadUserPreferences(user);
            }
        };

        window.addEventListener('global-auth-changed', (e) => {
            updateAuthHeaderUI(e.detail?.user);
            if (e.detail?.user && !e.detail.user.isAnonymous) {
                autoLoadUserPreferences(e.detail.user);
            }
        });

        function initFirebaseAuth() {
            const user = getUnifiedUser();
            updateAuthHeaderUI(user);
            if (user && !user.isAnonymous) {
                autoLoadUserPreferences(user);
            }
        }

        // Global State
        let allMagicSets = [];
        let selectedSet = null;
        let currentSetData = null;
        let setStatusFilter = 'missing'; // 'missing' | 'collected' | 'all'

        let currentCollectionData = [];
        let currentDecksData = [];
        let currentDeckSummary = null;
        let activeDeckViewId = 'all'; // 'all' or specific deck ID
        let deckCardsStatusFilter = 'all'; // 'all' | 'missing' | 'owned'
        let customPastedDecks = (() => {
            try {
                const raw = localStorage.getItem('archidekt_customDecks');
                return raw ? JSON.parse(raw) : [];
            } catch (e) {
                return [];
            }
        })();
        let activeDeckIds = new Set();
        let deckNames = JSON.parse(localStorage.getItem('archidekt_deckNames') || '{}');
        customPastedDecks.forEach(d => {
            if (d && d.id) {
                activeDeckIds.add(d.id);
                if (d.name) deckNames[d.id] = d.name;
            }
        });
        let fetchedDecks = new Set();
        let cachedParsedCsv = null;

        function normalizeCardName(name) {
            if (!name) return "";
            return name.trim().toLowerCase()
                .replace(/æ/g, 'ae')
                .replace(/œ/g, 'oe')
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                .replace(/[\u2018\u2019']/g, '')
                .replace(/[\u201C\u201D"]/g, '')
                .replace(/[.,:;!?]/g, '')
                .replace(/\s*\/\/\s*/g, ' // ')
                .replace(/\s*[\u2014\u2013]\s*/g, ' - ')
                .trim().replace(/\s+/g, ' ');
        }

        // ==================== GLOBAL MARKETPLACE & PRICING ENGINE ====================
        let currentMarket = localStorage.getItem('archidekt_preferredMarket') || 'tcg';
        const marketSelectEl = document.getElementById('globalMarketSelect');
        if (marketSelectEl) {
            marketSelectEl.value = currentMarket;
        }

        function changeGlobalMarket(newMarket) {
            if (!newMarket) return;
            currentMarket = newMarket;
            localStorage.setItem('archidekt_preferredMarket', newMarket);
            const sel = document.getElementById('globalMarketSelect');
            if (sel) sel.value = newMarket;

            // Trigger updates across all tabs
            if (typeof renderTradeBinder === 'function') renderTradeBinder();
            if (currentSetData && typeof renderSetDashboard === 'function' && typeof renderSetCardsList === 'function') {
                renderSetDashboard(currentSetData);
                renderSetCardsList();
            }
            if (cachedInsightsData && typeof renderCollectionInsights === 'function') {
                renderCollectionInsights(cachedInsightsData);
            }
            showToast(`Market switched to ${getMarketDisplayName()}!`);
        }

        function getMarketCurrency() {
            return currentMarket === 'cardmarket' ? '€' : '$';
        }

        function getMarketDisplayName() {
            if (currentMarket === 'cardmarket') return 'Cardmarket (€)';
            if (currentMarket === 'ck') return 'Card Kingdom ($)';
            return 'TCGPlayer ($)';
        }

        function getCardMarketNumericPrice(prices, finish = 'Normal') {
            if (!prices) return 0;
            const normFinish = String(finish || 'Normal').toLowerCase();
            const isFoilish = normFinish.includes('foil') || normFinish.includes('etched');

            if (currentMarket === 'cardmarket') {
                if (isFoilish && prices.eur_foil != null && prices.eur_foil !== '') {
                    return parseFloat(prices.eur_foil) || 0;
                }
                if (prices.eur != null && prices.eur !== '') {
                    return parseFloat(prices.eur) || 0;
                }
                // Fallback from USD with ~0.92 conversion
                const usd = isFoilish ? (prices.usd_foil || prices.usd) : prices.usd;
                return usd ? parseFloat((parseFloat(usd) * 0.92).toFixed(2)) : 0;
            }

            if (currentMarket === 'ck') {
                if (isFoilish && prices.ck_foil != null && prices.ck_foil !== '') {
                    return parseFloat(prices.ck_foil) || 0;
                }
                if (prices.ck != null && prices.ck !== '') {
                    return parseFloat(prices.ck) || 0;
                }
                // Fallback to USD foil / regular
                if (isFoilish && prices.usd_foil != null && prices.usd_foil !== '') {
                    return parseFloat(prices.usd_foil) || 0;
                }
                return parseFloat(prices.usd) || 0;
            }

            // Default: TCGPlayer
            if (isFoilish && prices.usd_foil != null && prices.usd_foil !== '') {
                return parseFloat(prices.usd_foil) || 0;
            }
            if (prices.usd != null && prices.usd !== '') {
                return parseFloat(prices.usd) || 0;
            }
            return 0;
        }

        function formatCardPrice(prices, finish = 'Normal', qty = 1) {
            const unit = getCardMarketNumericPrice(prices, finish);
            if (unit <= 0) return '';
            const curr = getMarketCurrency();
            const total = unit * (qty || 1);
            return `${curr}${total.toFixed(2)}`;
        }

        function renderFinishBadge(finish, prefix = '', showNormal = false) {
            if (!finish) return '';
            const f = String(finish).trim();
            if (f === 'Normal' && !showNormal) return '';
            const fLower = f.toLowerCase();
            let badgeClass = 'badge-foil';
            let icon = '✨';

            if (f === 'Normal') {
                return `<span class="badge" style="background: rgba(255, 255, 255, 0.08); color: var(--text-muted); border: 1px solid rgba(255, 255, 255, 0.15); font-size: 0.74rem;" title="Standard / Non-Foil">${prefix}Normal</span>`;
            }

            if (fLower.includes('surge')) {
                badgeClass = 'badge-surge';
                icon = '🌊';
            } else if (fLower.includes('etched')) {
                badgeClass = 'badge-etched';
                icon = '⚡';
            } else if (fLower.includes('textured')) {
                badgeClass = 'badge-textured';
                icon = '💎';
            } else if (fLower.includes('confetti')) {
                badgeClass = 'badge-confetti';
                icon = '🎉';
            } else if (fLower.includes('halo')) {
                badgeClass = 'badge-halo';
                icon = '🌟';
            }

            return `<span class="badge-finish ${badgeClass}" title="${f} finish">${icon} ${prefix}${f}</span>`;
        }

        // Dark / Light Mode Initialization
        function applyAppTheme(theme) {
            const finalTheme = (theme === 'light') ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', finalTheme);
            if (document.body) document.body.setAttribute('data-theme', finalTheme);
            const hubScope = document.getElementById('view-collection-hub');
            if (hubScope) hubScope.setAttribute('data-theme', finalTheme);
            localStorage.setItem('theme', finalTheme);
            const toggle = document.getElementById('themeToggle');
            if (toggle) {
                toggle.textContent = finalTheme === 'dark' ? '☀️' : '🌙';
                toggle.setAttribute('title', finalTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
            }
        }
        window.applyAppTheme = applyAppTheme;

        const themeToggle = document.getElementById('themeToggle');
        const savedTheme = localStorage.getItem('theme') || 'dark';
        applyAppTheme(savedTheme);

        if (themeToggle) {
            themeToggle.addEventListener('click', function () {
                let current = document.documentElement.getAttribute('data-theme') || 'dark';
                let next = current === 'dark' ? 'light' : 'dark';
                applyAppTheme(next);
            });
        }

        // ==================== TAB SWITCHING LOGIC ====================
        function switchTab(tab) {
            const sections = {
                deck: document.getElementById('deckSection'),
                set: document.getElementById('setSection'),
                collection: document.getElementById('collectionSection'),
                trade: document.getElementById('tradeSection'),
                build: document.getElementById('buildSection')
            };

            const buttons = {
                deck: document.getElementById('tabDeckBtn'),
                set: document.getElementById('tabSetBtn'),
                collection: document.getElementById('tabCollectionBtn'),
                trade: document.getElementById('tabTradeBtn'),
                build: document.getElementById('tabBuildBtn')
            };

            for (const [key, el] of Object.entries(sections)) {
                if (el) el.style.display = (key === tab) ? 'block' : 'none';
            }
            for (const [key, btn] of Object.entries(buttons)) {
                if (btn) {
                    if (key === tab) btn.classList.add('active');
                    else btn.classList.remove('active');
                }
            }

            if (tab === 'collection') {
                onOpenCollectionTab();
            } else if (tab === 'trade') {
                renderTradeBinder();
            } else if (tab === 'build') {
                renderBuildSection();
            }

            const params = new URLSearchParams(window.location.search);
            params.set('tab', tab);
            window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
            localStorage.setItem('archidekt_activeTab', tab);
        }
        window.switchTab = switchTab;

        // ==================== PERSISTENCE & STORAGE HELPERS ====================
        let cachedInsightsData = null;

        // Lightweight IndexedDB wrapper for large comparisons & collections without localStorage quota limits
        const IDB_CONFIG = {
            dbName: 'ArchidektComparatorDB',
            version: 1,
            storeName: 'cache_store'
        };

        function openComparatorDB() {
            return new Promise((resolve) => {
                if (!window.indexedDB) return resolve(null);
                try {
                    const req = indexedDB.open(IDB_CONFIG.dbName, IDB_CONFIG.version);
                    req.onupgradeneeded = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains(IDB_CONFIG.storeName)) {
                            db.createObjectStore(IDB_CONFIG.storeName, { keyPath: 'key' });
                        }
                    };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => resolve(null);
                } catch (err) {
                    resolve(null);
                }
            });
        }

        async function idbGet(key) {
            const db = await openComparatorDB();
            if (!db) return null;
            return new Promise((resolve) => {
                try {
                    const tx = db.transaction(IDB_CONFIG.storeName, 'readonly');
                    const store = tx.objectStore(IDB_CONFIG.storeName);
                    const req = store.get(key);
                    req.onsuccess = () => resolve(req.result ? req.result.val : null);
                    req.onerror = () => resolve(null);
                } catch (e) {
                    resolve(null);
                }
            });
        }

        async function idbSet(key, val) {
            const db = await openComparatorDB();
            if (!db) return false;
            return new Promise((resolve) => {
                try {
                    const tx = db.transaction(IDB_CONFIG.storeName, 'readwrite');
                    const store = tx.objectStore(IDB_CONFIG.storeName);
                    const req = store.put({ key, val });
                    req.onsuccess = () => resolve(true);
                    req.onerror = () => resolve(false);
                } catch (e) {
                    resolve(false);
                }
            });
        }

        async function idbDelete(key) {
            const db = await openComparatorDB();
            if (!db) return false;
            return new Promise((resolve) => {
                try {
                    const tx = db.transaction(IDB_CONFIG.storeName, 'readwrite');
                    const store = tx.objectStore(IDB_CONFIG.storeName);
                    const req = store.delete(key);
                    req.onsuccess = () => resolve(true);
                    req.onerror = () => resolve(false);
                } catch (e) {
                    resolve(false);
                }
            });
        }

        const AppStorage = {
            saveCsv(csvData) {
                try {
                    localStorage.setItem('archidekt_cachedCsvData', JSON.stringify(csvData));
                } catch (e) {
                    console.warn("Could not cache CSV in localStorage (size limit):", e);
                }
            },
            loadCsv() {
                try {
                    const raw = localStorage.getItem('archidekt_cachedCsvData');
                    if (!raw) return null;
                    const list = JSON.parse(raw);
                    if (!Array.isArray(list)) return null;
                    return list.map(c => {
                        const s = (c.set || c.setCode || '').toLowerCase();
                        const num = (c.collectorNumber || c.collector_number || c.number || '').toString().trim();
                        const q = Number(c.quantity || c.owned || c.count) || 1;
                        return {
                            ...c,
                            set: s,
                            setCode: s.toUpperCase(),
                            collectorNumber: num,
                            collector_number: num,
                            quantity: q,
                            owned: q
                        };
                    });
                } catch (e) {
                    return null;
                }
            },
            saveArchidektCollection(id, cards) {
                try {
                    if (!id || !Array.isArray(cards)) return;
                    const cleanId = String(id).trim();
                    const key = `archidekt_coll_${cleanId}`;
                    localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), cards }));
                } catch (e) {
                    console.warn("Could not cache Archidekt collection in localStorage:", e);
                }
            },
            loadArchidektCollection(id) {
                try {
                    if (!id) return null;
                    const cleanId = String(id).trim();
                    const key = `archidekt_coll_${cleanId}`;
                    const raw = localStorage.getItem(key);
                    if (!raw) return null;
                    const parsed = JSON.parse(raw);
                    // 2 hour cache validity
                    if (Date.now() - (parsed.timestamp || 0) < 2 * 60 * 60 * 1000 && Array.isArray(parsed.cards)) {
                        return parsed.cards.map(c => {
                            const s = (c.set || c.setCode || '').toLowerCase();
                            const num = (c.collectorNumber || c.collector_number || c.number || '').toString().trim();
                            const q = Number(c.quantity || c.owned || c.count) || 1;
                            return {
                                ...c,
                                set: s,
                                setCode: s.toUpperCase(),
                                collectorNumber: num,
                                collector_number: num,
                                quantity: q,
                                owned: q
                            };
                        });
                    }
                    return null;
                } catch (e) {
                    return null;
                }
            },
            clearArchidektCollection(id) {
                try {
                    if (!id) return;
                    localStorage.removeItem(`archidekt_coll_${String(id).trim()}`);
                } catch (e) {}
            },
            saveTradeBinder(binder) {
                try {
                    localStorage.setItem('archidekt_tradeBinder', JSON.stringify(binder));
                    syncTradeBinderToCloud(binder);
                } catch (e) {}
            },
            loadTradeBinder() {
                try {
                    const raw = localStorage.getItem('archidekt_tradeBinder');
                    return raw ? JSON.parse(raw) : { haves: [], wants: [] };
                } catch (e) {
                    return { haves: [], wants: [] };
                }
            },
            async saveComparison(data) {
                if (!data) return;
                const ok = await idbSet('deck_comparison_cache', data);
                if (!ok) {
                    try {
                        localStorage.setItem('archidekt_comparison_cache', JSON.stringify(data));
                    } catch (e) {
                        console.warn("Could not cache comparison in localStorage:", e);
                    }
                }
            },
            async loadComparison() {
                let data = await idbGet('deck_comparison_cache');
                if (!data) {
                    try {
                        const raw = localStorage.getItem('archidekt_comparison_cache');
                        if (raw) data = JSON.parse(raw);
                    } catch (e) {}
                }
                return data;
            },
            async clearComparison() {
                await idbDelete('deck_comparison_cache');
                try {
                    localStorage.removeItem('archidekt_comparison_cache');
                } catch (e) {}
            }
        };

        function formatTimeAgo(timestamp) {
            if (!timestamp) return 'earlier';
            const diffMs = Date.now() - timestamp;
            const diffMins = Math.floor(diffMs / 60000);
            if (diffMins < 1) return 'just now';
            if (diffMins === 1) return '1 minute ago';
            if (diffMins < 60) return `${diffMins} minutes ago`;
            const diffHours = Math.floor(diffMins / 60);
            if (diffHours === 1) return '1 hour ago';
            if (diffHours < 24) return `${diffHours} hours ago`;
            const diffDays = Math.floor(diffHours / 24);
            return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        }

        function showCachedComparisonBanner(timestamp) {
            const banner = document.getElementById('comparisonCacheBanner');
            const bannerText = document.getElementById('comparisonCacheBannerText');
            if (banner && bannerText) {
                bannerText.textContent = `Results from ${formatTimeAgo(timestamp)} loaded. All deck breakdown and missing card tables are active.`;
                banner.style.display = 'flex';
            }
        }

        function hideCachedComparisonBanner() {
            const banner = document.getElementById('comparisonCacheBanner');
            if (banner) banner.style.display = 'none';
        }

        async function clearSavedComparison() {
            await AppStorage.clearComparison();
            currentCollectionData = [];
            currentDecksData = [];
            currentDeckSummary = null;
            const decksOverviewCard = document.getElementById('decksOverviewCard');
            const factsCard = document.getElementById('factsCard');
            const resultsContainer = document.getElementById('resultsContainer');
            if (decksOverviewCard) decksOverviewCard.style.display = 'none';
            if (factsCard) factsCard.style.display = 'none';
            if (resultsContainer) resultsContainer.style.display = 'none';
            hideCachedComparisonBanner();
            showToast("Saved comparison results cleared.");
        }

        async function restoreCachedComparison() {
            try {
                const cached = await AppStorage.loadComparison();
                if (!cached || !cached.data) return false;

                // Cache duration: 72 hours
                if (cached.timestamp && (Date.now() - cached.timestamp > 72 * 60 * 60 * 1000)) {
                    await AppStorage.clearComparison();
                    return false;
                }

                // Check if cached deck IDs and collection match active selection
                const currentDeckIds = Array.from(activeDeckIds).filter(id => !id.startsWith('custom:')).sort().join(',');
                const cachedDeckIds = (cached.deckIds || '').split(/[,\s\n]+/).map(s => s.trim()).filter(Boolean).sort().join(',');

                const collInput = document.getElementById('collectionId');
                const currentCollId = collInput ? collInput.value.trim() : '';
                const cachedCollId = (cached.collectionId || '').trim();

                // If user has specific active decks and they completely mismatch cached decks, don't auto-restore
                if (currentDeckIds && cachedDeckIds && currentDeckIds !== cachedDeckIds) {
                    return false;
                }

                // If collection IDs are both present and completely mismatch, don't auto-restore
                if (currentCollId && cachedCollId && currentCollId !== cachedCollId && !cachedParsedCsv) {
                    return false;
                }

                // Restore custom decks if any
                if (Array.isArray(cached.customDecks) && cached.customDecks.length > 0) {
                    cached.customDecks.forEach(cd => {
                        if (!customPastedDecks.some(d => d.id === cd.id)) {
                            customPastedDecks.push(cd);
                            activeDeckIds.add(cd.id);
                        }
                    });
                    renderDeckChips();
                }

                currentCollectionData = cached.data.collection || [];
                currentDecksData = cached.data.decks || [];
                currentDeckSummary = cached.data.deckSummary || null;

                if (!currentDecksData || currentDecksData.length === 0) {
                    return false;
                }

                renderDeckDashboard();
                renderFacts();
                populateDeckSelector();
                renderDeckCardsList();
                renderList();

                const decksOverviewCard = document.getElementById('decksOverviewCard');
                const factsCard = document.getElementById('factsCard');
                const resultsContainer = document.getElementById('resultsContainer');
                if (decksOverviewCard) decksOverviewCard.style.display = 'block';
                if (factsCard) factsCard.style.display = 'block';
                if (resultsContainer) resultsContainer.style.display = 'block';

                showCachedComparisonBanner(cached.timestamp);
                console.log(`[RESTORE] Successfully restored comparison results for ${currentDecksData.length} decks.`);
                return true;
            } catch (err) {
                console.warn("[RESTORE] Could not restore cached comparison:", err);
                return false;
            }
        }

        function updateCollectionStatusBadge() {
            const badge = document.getElementById('collectionStatusBadge');
            const refreshBtn = document.getElementById('refreshCollectionBtn');
            const clearBtn = document.getElementById('clearCollectionCacheBtn');
            const collIdInput = document.getElementById('collectionId');
            const collId = collIdInput ? collIdInput.value.trim() : '';

            if (cachedParsedCsv && cachedParsedCsv.length > 0) {
                if (badge) {
                    badge.innerHTML = `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">📎 Saved CSV Active (${cachedParsedCsv.length.toLocaleString()} cards)</span>`;
                }
                if (refreshBtn) refreshBtn.style.display = 'inline-flex';
                if (clearBtn) clearBtn.style.display = 'inline-flex';
            } else if (collId) {
                const count = currentCollectionData?.length || 0;
                if (badge) {
                    if (count > 0) {
                        badge.innerHTML = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);" title="Collection cached locally for sub-second lookups">⚡ Collection: #${collId} (${count.toLocaleString()} cards cached)</span>`;
                    } else {
                        badge.innerHTML = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);">💾 Collection: ${collId}</span>`;
                    }
                }
                if (refreshBtn) refreshBtn.style.display = 'inline-flex';
                if (clearBtn) clearBtn.style.display = 'inline-flex';
            } else {
                if (badge) badge.innerHTML = '';
                if (refreshBtn) refreshBtn.style.display = 'none';
                if (clearBtn) clearBtn.style.display = 'none';
            }
        }

        async function clearSavedCollection() {
            if (!confirm("Are you sure you want to clear your saved collection and cached insights?")) return;
            const collInput = document.getElementById('collectionId');
            const cleanId = collInput ? collInput.value.trim() : '';
            if (cleanId) AppStorage.clearArchidektCollection(cleanId);
            localStorage.removeItem('archidekt_collectionId');
            localStorage.removeItem('archidekt_cachedCsvData');
            localStorage.removeItem('archidekt_cachedInsights');
            cachedParsedCsv = null;
            cachedInsightsData = null;
            currentCollectionData = [];
            await clearSavedComparison();

            if (collInput) collInput.value = '';
            const csvInput = document.getElementById('csvUpload');
            if (csvInput) csvInput.value = '';
            toggleCollectionInputs();
            updateCollectionStatusBadge();

            const emptyEl = document.getElementById('collectionInsightsEmpty');
            const dashEl = document.getElementById('collectionInsightsDashboard');
            if (emptyEl) emptyEl.style.display = 'block';
            if (dashEl) dashEl.style.display = 'none';
            showToast("Saved collection cache cleared!");
        }

        function refreshActiveCollection() {
            localStorage.removeItem('archidekt_cachedInsights');
            cachedInsightsData = null;
            const collInput = document.getElementById('collectionId');
            let collId = collInput ? collInput.value.trim() : '';
            const collMatch = collId.match(/(?:archidekt\.com\/collections?\/)(\d+)/i);
            if (collMatch) collId = collMatch[1];
            else {
                const rawNum = collId.match(/\d+/);
                if (rawNum && /^\d+$/.test(collId)) collId = rawNum[0];
            }
            if (collId) {
                AppStorage.clearArchidektCollection(collId);
            }
            currentCollectionData = [];
            updateCollectionStatusBadge();

            const tab = localStorage.getItem('archidekt_activeTab') || 'deck';
            if (tab === 'collection') {
                fetchCollectionInsights(true);
            } else if (tab === 'deck') {
                runComparison();
            } else if (tab === 'set') {
                runSetComparison();
            } else if (tab === 'build') {
                renderBuildSection(true);
            }
        }

        // ==================== TRADE BINDER & SHARING ENGINE ====================
        let tradeBinder = AppStorage.loadTradeBinder();
        let incomingFriendTrade = null;

        function updateTradeBadge() {
            const badge = document.getElementById('tradeCountBadge');
            const total = (tradeBinder.haves || []).reduce((s, c) => s + (c.quantity || 1), 0) +
                          (tradeBinder.wants || []).reduce((s, c) => s + (c.quantity || 1), 0);
            if (badge) {
                if (total > 0) {
                    badge.textContent = total;
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
                }
            }
        }

        function addToTradeBinder(cardOrName, setCode = '', priceUsd = 0, imageUrl = '', type = 'have', finish = 'Normal', collectorNumber = '', prices = null) {
            let item = {};
            if (typeof cardOrName === 'object' && cardOrName !== null) {
                item = {
                    name: (cardOrName.name || '').trim(),
                    setCode: (cardOrName.setCode || cardOrName.set || '').toUpperCase(),
                    collectorNumber: (cardOrName.collectorNumber || cardOrName.collector_number || '').toString().trim(),
                    finish: cardOrName.finish || cardOrName.card_finish || cardOrName.owned_finish || 'Normal',
                    isFoil: Boolean(cardOrName.isFoil || cardOrName.is_foil),
                    priceUsd: Number(cardOrName.priceUsd) || 0,
                    imageUrl: cardOrName.imageUrl || cardOrName.image_url || '',
                    prices: cardOrName.prices || null,
                    quantity: Number(cardOrName.quantity) || 1,
                    type: cardOrName.type || type || 'have'
                };
            } else {
                item = {
                    name: (cardOrName || '').trim(),
                    setCode: (setCode || '').toUpperCase(),
                    collectorNumber: (collectorNumber || '').toString().trim(),
                    finish: finish || 'Normal',
                    isFoil: String(finish || '').toLowerCase().includes('foil') || String(finish || '').toLowerCase().includes('etched'),
                    priceUsd: Number(priceUsd) || 0,
                    imageUrl: imageUrl || '',
                    prices: prices || { usd: priceUsd },
                    quantity: 1,
                    type: type || 'have'
                };
            }

            if (!item.name) return;
            const listKey = item.type === 'want' ? 'wants' : 'haves';
            if (!tradeBinder[listKey]) tradeBinder[listKey] = [];

            // Match by name, setCode, collectorNumber, and finish
            const existing = tradeBinder[listKey].find(c =>
                c.name.toLowerCase() === item.name.toLowerCase() &&
                (!item.setCode || (c.setCode || '').toUpperCase() === item.setCode) &&
                (!item.collectorNumber || (c.collectorNumber || '').toLowerCase() === item.collectorNumber.toLowerCase()) &&
                (c.finish || 'Normal').toLowerCase() === (item.finish || 'Normal').toLowerCase()
            );

            if (existing) {
                existing.quantity = (existing.quantity || 1) + (item.quantity || 1);
                if (item.imageUrl && !existing.imageUrl) existing.imageUrl = item.imageUrl;
                if (item.prices) existing.prices = item.prices;
            } else {
                // If imageUrl is empty, try to derive Scryfall specific art URL
                if (!item.imageUrl && item.setCode && item.collectorNumber) {
                    item.imageUrl = `https://api.scryfall.com/cards/${item.setCode.toLowerCase()}/${item.collectorNumber}?format=image`;
                }
                tradeBinder[listKey].push(item);
            }

            AppStorage.saveTradeBinder(tradeBinder);
            updateTradeBadge();
            const finishDesc = item.finish && item.finish !== 'Normal' ? ` (${item.finish})` : '';
            showToast(`Added ${item.quantity || 1}x ${item.name}${finishDesc} to Trade ${item.type === 'want' ? 'Wants' : 'Haves'}! 🤝`);

            const activeTab = localStorage.getItem('archidekt_activeTab');
            if (activeTab === 'trade') renderTradeBinder();
        }

        function removeFromTradeBinder(type, index) {
            const listKey = type === 'want' ? 'wants' : 'haves';
            if (!tradeBinder[listKey]) return;
            tradeBinder[listKey].splice(index, 1);
            AppStorage.saveTradeBinder(tradeBinder);
            updateTradeBadge();
            renderTradeBinder();
        }

        function updateTradeItemQty(type, index, delta) {
            const listKey = type === 'want' ? 'wants' : 'haves';
            if (!tradeBinder[listKey] || !tradeBinder[listKey][index]) return;
            const item = tradeBinder[listKey][index];
            item.quantity = Math.max(1, (item.quantity || 1) + delta);
            AppStorage.saveTradeBinder(tradeBinder);
            updateTradeBadge();
            renderTradeBinder();
        }

        function clearTradeBinder() {
            if (!confirm("Are you sure you want to clear your trade binder?")) return;
            tradeBinder = { haves: [], wants: [] };
            AppStorage.saveTradeBinder(tradeBinder);
            updateTradeBadge();
            renderTradeBinder();
            showToast("Trade binder cleared.");
        }

        async function addCardFromTradeInput(type = 'have') {
            const input = document.getElementById('tradeAddCardInput');
            const qtyInput = document.getElementById('tradeAddCardQty');
            const finishSelect = document.getElementById('tradeAddCardFinish');
            const name = input ? input.value.trim() : '';
            const qty = qtyInput ? Math.max(1, parseInt(qtyInput.value) || 1) : 1;
            const finish = finishSelect ? finishSelect.value : 'Normal';
            if (!name) return;

            let priceUsd = 0;
            let setCode = '';
            let collectorNumber = '';
            let imageUrl = '';
            let prices = null;

            try {
                const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
                if (res.ok) {
                    const data = await res.json();
                    setCode = data.set?.toUpperCase() || '';
                    collectorNumber = data.collector_number || '';
                    prices = data.prices || null;
                    const isFoilish = finish !== 'Normal';
                    priceUsd = parseFloat((isFoilish ? (data.prices?.usd_foil || data.prices?.usd) : data.prices?.usd) || 0);
                    imageUrl = data.image_uris?.normal || data.image_uris?.small || '';
                }
            } catch (e) {}

            addToTradeBinder({
                name,
                setCode,
                collectorNumber,
                finish,
                isFoil: finish !== 'Normal',
                priceUsd,
                imageUrl,
                prices,
                quantity: qty,
                type
            });

            if (input) input.value = '';
        }

        function renderTradeBinder() {
            const havesListEl = document.getElementById('tradeHavesList');
            const wantsListEl = document.getElementById('tradeWantsList');
            if (!havesListEl || !wantsListEl) return;

            havesListEl.innerHTML = '';
            wantsListEl.innerHTML = '';

            const haves = tradeBinder.haves || [];
            const wants = tradeBinder.wants || [];
            const curr = getMarketCurrency();

            let totalHavesValue = 0;
            let totalHavesCount = 0;
            let totalWantsValue = 0;
            let totalWantsCount = 0;

            // Render Haves
            if (haves.length === 0) {
                havesListEl.innerHTML = `<li style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
                    No cards added for trade yet.<br>Click <strong>+ Have</strong> on any card in Deck Comparator, Set Completion, or Insights, or type a card above!
                </li>`;
            } else {
                haves.forEach((c, idx) => {
                    totalHavesCount += (c.quantity || 1);
                    const finish = c.finish || 'Normal';
                    const unitPrice = getCardMarketNumericPrice(c.prices, finish) || (c.priceUsd || 0);
                    const itemTotal = unitPrice * (c.quantity || 1);
                    totalHavesValue += itemTotal;

                    const li = document.createElement('li');
                    li.className = 'trade-card-row';

                    const leftDiv = document.createElement('div');
                    leftDiv.style.display = 'flex';
                    leftDiv.style.alignItems = 'center';
                    leftDiv.style.gap = '0.5rem';
                    leftDiv.style.overflow = 'hidden';
                    leftDiv.style.flexWrap = 'wrap';

                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'card-name';
                    nameSpan.textContent = c.name;
                    nameSpan.style.fontSize = '0.9rem';
                    nameSpan.title = "Click to open in Scryfall • Hover to preview card";
                    nameSpan.onclick = (e) => openInScryfall(c.name, e);
                    bindImageHover(nameSpan, c.name, c.imageUrl);

                    const setCodeBadge = c.setCode ? `<span class="badge badge-code" style="font-size: 0.72rem;">${c.setCode}${c.collectorNumber ? ` #${c.collectorNumber}` : ''}</span>` : '';
                    const finishBadge = renderFinishBadge(finish);

                    leftDiv.innerHTML = `${setCodeBadge} ${finishBadge}`;
                    leftDiv.appendChild(nameSpan);

                    const rightDiv = document.createElement('div');
                    rightDiv.style.display = 'flex';
                    rightDiv.style.alignItems = 'center';
                    rightDiv.style.gap = '0.5rem';

                    const priceSpan = document.createElement('span');
                    priceSpan.style.fontSize = '0.82rem';
                    priceSpan.style.color = '#34d399';
                    priceSpan.style.fontWeight = '700';
                    priceSpan.textContent = itemTotal > 0 ? `${curr}${itemTotal.toFixed(2)}` : '';

                    const qtyCtrl = document.createElement('div');
                    qtyCtrl.className = 'trade-qty-ctrl';
                    qtyCtrl.innerHTML = `
                        <button type="button" onclick="updateTradeItemQty('have', ${idx}, -1)">-</button>
                        <span>${c.quantity || 1}</span>
                        <button type="button" onclick="updateTradeItemQty('have', ${idx}, 1)">+</button>
                    `;

                    const delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.style.background = 'transparent';
                    delBtn.style.border = 'none';
                    delBtn.style.color = 'var(--text-muted)';
                    delBtn.style.cursor = 'pointer';
                    delBtn.style.fontSize = '1.1rem';
                    delBtn.innerHTML = '&times;';
                    delBtn.title = 'Remove card';
                    delBtn.onclick = () => removeFromTradeBinder('have', idx);

                    rightDiv.appendChild(priceSpan);
                    rightDiv.appendChild(qtyCtrl);
                    rightDiv.appendChild(delBtn);

                    li.appendChild(leftDiv);
                    li.appendChild(rightDiv);
                    havesListEl.appendChild(li);
                });
            }

            // Render Wants
            if (wants.length === 0) {
                wantsListEl.innerHTML = `<li style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
                    Wishlist is empty.<br>Click <strong>+ Want</strong> on any missing card in Set Completion or Deck Comparator to track what you need!
                </li>`;
            } else {
                wants.forEach((c, idx) => {
                    totalWantsCount += (c.quantity || 1);
                    const finish = c.finish || 'Normal';
                    const unitPrice = getCardMarketNumericPrice(c.prices, finish) || (c.priceUsd || 0);
                    const itemTotal = unitPrice * (c.quantity || 1);
                    totalWantsValue += itemTotal;

                    const li = document.createElement('li');
                    li.className = 'trade-card-row';

                    const leftDiv = document.createElement('div');
                    leftDiv.style.display = 'flex';
                    leftDiv.style.alignItems = 'center';
                    leftDiv.style.gap = '0.5rem';
                    leftDiv.style.overflow = 'hidden';
                    leftDiv.style.flexWrap = 'wrap';

                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'card-name';
                    nameSpan.textContent = c.name;
                    nameSpan.style.fontSize = '0.9rem';
                    nameSpan.title = "Click to open in Scryfall • Hover to preview card";
                    nameSpan.onclick = (e) => openInScryfall(c.name, e);
                    bindImageHover(nameSpan, c.name, c.imageUrl);

                    const setCodeBadge = c.setCode ? `<span class="badge badge-code" style="font-size: 0.72rem;">${c.setCode}${c.collectorNumber ? ` #${c.collectorNumber}` : ''}</span>` : '';
                    const finishBadge = renderFinishBadge(finish);

                    leftDiv.innerHTML = `${setCodeBadge} ${finishBadge}`;
                    leftDiv.appendChild(nameSpan);

                    const rightDiv = document.createElement('div');
                    rightDiv.style.display = 'flex';
                    rightDiv.style.alignItems = 'center';
                    rightDiv.style.gap = '0.5rem';

                    const priceSpan = document.createElement('span');
                    priceSpan.style.fontSize = '0.82rem';
                    priceSpan.style.color = '#38bdf8';
                    priceSpan.style.fontWeight = '700';
                    priceSpan.textContent = itemTotal > 0 ? `${curr}${itemTotal.toFixed(2)}` : '';

                    const qtyCtrl = document.createElement('div');
                    qtyCtrl.className = 'trade-qty-ctrl';
                    qtyCtrl.innerHTML = `
                        <button type="button" onclick="updateTradeItemQty('want', ${idx}, -1)">-</button>
                        <span>${c.quantity || 1}</span>
                        <button type="button" onclick="updateTradeItemQty('want', ${idx}, 1)">+</button>
                    `;

                    const delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.style.background = 'transparent';
                    delBtn.style.border = 'none';
                    delBtn.style.color = 'var(--text-muted)';
                    delBtn.style.cursor = 'pointer';
                    delBtn.style.fontSize = '1.1rem';
                    delBtn.innerHTML = '&times;';
                    delBtn.title = 'Remove card';
                    delBtn.onclick = () => removeFromTradeBinder('want', idx);

                    rightDiv.appendChild(priceSpan);
                    rightDiv.appendChild(qtyCtrl);
                    rightDiv.appendChild(delBtn);

                    li.appendChild(leftDiv);
                    li.appendChild(rightDiv);
                    wantsListEl.appendChild(li);
                });
            }

            // Summary stats formatted with active market currency
            document.getElementById('tradeHavesValue').textContent = `${curr}${totalHavesValue.toFixed(2)}`;
            document.getElementById('tradeHavesCount').textContent = totalHavesCount;
            document.getElementById('tradeHavesBadge').textContent = `${totalHavesCount} items`;

            document.getElementById('tradeWantsValue').textContent = `${curr}${totalWantsValue.toFixed(2)}`;
            document.getElementById('tradeWantsCount').textContent = totalWantsCount;
            document.getElementById('tradeWantsBadge').textContent = `${totalWantsCount} items`;

            const mobileHavesEl = document.getElementById('tradeHavesMobileCount');
            if (mobileHavesEl) mobileHavesEl.textContent = totalHavesCount;
            const mobileWantsEl = document.getElementById('tradeWantsMobileCount');
            if (mobileWantsEl) mobileWantsEl.textContent = totalWantsCount;

            const diff = totalHavesValue - totalWantsValue;
            const diffEl = document.getElementById('tradeBalanceValue');
            if (diff >= 0) {
                diffEl.textContent = `+${curr}${diff.toFixed(2)}`;
                diffEl.style.color = '#34d399';
            } else {
                diffEl.textContent = `-${curr}${Math.abs(diff).toFixed(2)}`;
                diffEl.style.color = '#f87171';
            }
        }

        window.switchTradeMobileTab = function(tab) {
            const cols = document.querySelectorAll('.trade-column');
            const btnHaves = document.getElementById('tradeMobileBtnHaves');
            const btnWants = document.getElementById('tradeMobileBtnWants');
            if (cols.length < 2) return;
            const havesCol = cols[0];
            const wantsCol = cols[1];
            if (tab === 'haves') {
                havesCol.classList.remove('mobile-hidden');
                wantsCol.classList.add('mobile-hidden');
                if (btnHaves) btnHaves.classList.add('active');
                if (btnWants) btnWants.classList.remove('active');
            } else {
                havesCol.classList.add('mobile-hidden');
                wantsCol.classList.remove('mobile-hidden');
                if (btnHaves) btnHaves.classList.remove('active');
                if (btnWants) btnWants.classList.add('active');
            }
        };

        // Sharing logic
        async function generateTradeShareUrl() {
            const haves = (tradeBinder.haves || []).map(c => {
                const row = [c.name || '', c.setCode || '', c.collectorNumber ? String(c.collectorNumber) : ''];
                const finish = (c.finish && c.finish !== 'Normal') ? c.finish : '';
                const qty = (c.quantity && c.quantity > 1) ? c.quantity : '';
                const price = (c.priceUsd && c.priceUsd > 0) ? Number(c.priceUsd.toFixed(2)) : '';
                if (finish || qty || price) {
                    row.push(finish);
                    if (qty || price) {
                        row.push(qty);
                        if (price) row.push(price);
                    }
                }
                return row;
            });

            const wants = (tradeBinder.wants || []).map(c => {
                const row = [c.name || '', c.setCode || '', c.collectorNumber ? String(c.collectorNumber) : ''];
                const finish = (c.finish && c.finish !== 'Normal') ? c.finish : '';
                const qty = (c.quantity && c.quantity > 1) ? c.quantity : '';
                const price = (c.priceUsd && c.priceUsd > 0) ? Number(c.priceUsd.toFixed(2)) : '';
                if (finish || qty || price) {
                    row.push(finish);
                    if (qty || price) {
                        row.push(qty);
                        if (price) row.push(price);
                    }
                }
                return row;
            });

            const payload = {
                n: localStorage.getItem('archidekt_playerName') || 'Collector',
                h: haves,
                w: wants
            };
            const json = JSON.stringify(payload);

            // Compress payload using native CompressionStream (deflate)
            try {
                if (typeof CompressionStream !== 'undefined') {
                    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate'));
                    const buffer = await new Response(stream).arrayBuffer();
                    let binary = '';
                    const bytes = new Uint8Array(buffer);
                    for (let i = 0; i < bytes.byteLength; i++) {
                        binary += String.fromCharCode(bytes[i]);
                    }
                    const b64 = btoa(binary);
                    return `${window.location.origin}${window.location.pathname}?tab=trade#t=cz.${encodeURIComponent(b64)}`;
                }
            } catch (e) {
                console.warn("CompressionStream fallback to compact base64:", e);
            }

            const b64 = btoa(unescape(encodeURIComponent(json)));
            return `${window.location.origin}${window.location.pathname}?tab=trade#t=${encodeURIComponent(b64)}`;
        }

        async function shareTradeOfferModal() {
            const haves = tradeBinder.haves || [];
            const wants = tradeBinder.wants || [];
            if (haves.length === 0 && wants.length === 0) {
                showToast("Trade binder is empty! Add cards before sharing.");
                return;
            }

            const modal = document.getElementById('shareTradeModal');
            if (modal) modal.style.display = 'flex';

            const input = document.getElementById('shareTradeUrlInput');
            const shortStatus = document.getElementById('shortLinkStatus');

            if (input) {
                input.value = "Creating short link...";
                input.disabled = true;
            }
            if (shortStatus) {
                shortStatus.innerHTML = `<span style="display:inline-block;animation:spin 1s linear infinite;">⏳</span> Generating short link...`;
            }

            try {
                const compactUrl = await generateTradeShareUrl();
                if (input) {
                    input.dataset.directUrl = compactUrl;
                    input.dataset.shortUrl = "";
                }

                // Request short URL from backend
                let shortenedUrl = "";
                try {
                    let res = await fetch('/shortenUrl', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: compactUrl })
                    });
                    if (!res.ok) {
                        res = await fetch('https://us-central1-commander-challenge.cloudfunctions.net/shortenUrl', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: compactUrl })
                        });
                    }
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.shortUrl && data.shortUrl.startsWith('http')) {
                            shortenedUrl = data.shortUrl;
                        }
                    }
                } catch (netErr) {
                    console.warn("Short link network request failed:", netErr);
                }

                const finalUrl = shortenedUrl || compactUrl;
                if (input) {
                    input.value = finalUrl;
                    input.disabled = false;
                    if (shortenedUrl) input.dataset.shortUrl = shortenedUrl;
                }

                if (shortStatus) {
                    if (shortenedUrl) {
                        shortStatus.innerHTML = `✨ <strong>Short link ready!</strong> Clean URL (${finalUrl.length} chars) perfect for Discord, Reddit, or texts. <a href="javascript:void(0)" onclick="toggleDirectShareLink()" style="color:var(--primary-color);text-decoration:underline;margin-left:6px;">Show full direct link</a>`;
                    } else {
                        shortStatus.innerHTML = `⚡ Compact Direct Link (${finalUrl.length} chars).`;
                    }
                }
            } catch (err) {
                console.error("Failed to generate share URL:", err);
                if (input) {
                    input.value = window.location.href;
                    input.disabled = false;
                }
                if (shortStatus) {
                    shortStatus.textContent = "Could not generate link.";
                }
            }
        }

        function toggleDirectShareLink() {
            const input = document.getElementById('shareTradeUrlInput');
            const shortStatus = document.getElementById('shortLinkStatus');
            if (!input || !input.dataset.directUrl) return;

            if (input.value === input.dataset.directUrl) {
                // Switch back to short link
                if (input.dataset.shortUrl) {
                    input.value = input.dataset.shortUrl;
                    if (shortStatus) {
                        shortStatus.innerHTML = `✨ <strong>Short Link Active</strong>. <a href="javascript:void(0)" onclick="toggleDirectShareLink()" style="color:var(--primary-color);text-decoration:underline;margin-left:6px;">Show full direct link</a>`;
                    }
                }
            } else {
                // Show direct link
                input.value = input.dataset.directUrl;
                if (shortStatus) {
                    shortStatus.innerHTML = `🔗 Direct compact URL displayed (${input.value.length} chars). <a href="javascript:void(0)" onclick="toggleDirectShareLink()" style="color:var(--primary-color);text-decoration:underline;margin-left:6px;">Switch to short link</a>`;
                }
            }
        }

        function closeShareTradeModal() {
            const modal = document.getElementById('shareTradeModal');
            if (modal) modal.style.display = 'none';
        }

        function copyTradeUrlFromInput() {
            const input = document.getElementById('shareTradeUrlInput');
            if (!input || !input.value) return;
            navigator.clipboard.writeText(input.value)
                .then(() => {
                    const btnText = document.getElementById('copyTradeBtnText');
                    if (btnText) btnText.textContent = "Copied! 🎉";
                    showToast("Trade link copied to clipboard!");
                    setTimeout(() => { if (btnText) btnText.textContent = "Copy Link"; }, 2500);
                })
                .catch(() => showToast("Failed to copy link."));
        }

        function copyTradeTextList() {
            const haves = tradeBinder.haves || [];
            const wants = tradeBinder.wants || [];
            if (haves.length === 0 && wants.length === 0) {
                showToast("Trade binder is empty! Add cards first.");
                return;
            }

            const curr = getMarketCurrency();
            let text = `🤝 MTG TRADE OFFER (${getMarketDisplayName()})\n\n`;
            if (haves.length > 0) {
                text += "🟢 CARDS FOR TRADE (HAVES):\n";
                haves.forEach(c => {
                    const set = c.setCode ? ` [${c.setCode}${c.collectorNumber ? ` #${c.collectorNumber}` : ''}]` : '';
                    const finishStr = c.finish && c.finish !== 'Normal' ? ` (${c.finish})` : '';
                    const unitPrice = getCardMarketNumericPrice(c.prices, c.finish) || (c.priceUsd || 0);
                    const price = unitPrice > 0 ? ` (${curr}${(unitPrice * (c.quantity || 1)).toFixed(2)})` : '';
                    text += `• ${c.quantity || 1}x ${c.name}${set}${finishStr}${price}\n`;
                });
                text += "\n";
            }
            if (wants.length > 0) {
                text += "🔵 LOOKING FOR (WANTS):\n";
                wants.forEach(c => {
                    const set = c.setCode ? ` [${c.setCode}${c.collectorNumber ? ` #${c.collectorNumber}` : ''}]` : '';
                    const finishStr = c.finish && c.finish !== 'Normal' ? ` (${c.finish})` : '';
                    const unitPrice = getCardMarketNumericPrice(c.prices, c.finish) || (c.priceUsd || 0);
                    const price = unitPrice > 0 ? ` (${curr}${(unitPrice * (c.quantity || 1)).toFixed(2)})` : '';
                    text += `• ${c.quantity || 1}x ${c.name}${set}${finishStr}${price}\n`;
                });
            }

            navigator.clipboard.writeText(text)
                .then(() => showToast("Copied formatted trade list to clipboard! 📋"))
                .catch(() => showToast("Failed to copy text."));
        }

        async function checkIncomingTradeLink() {
            let raw = '';
            const hash = window.location.hash || '';
            if (hash.startsWith('#t=')) {
                raw = hash.substring(3);
            } else if (hash.startsWith('#trade=')) {
                raw = hash.substring(7);
            } else {
                const params = new URLSearchParams(window.location.search);
                if (params.get('t')) raw = params.get('t');
                else if (params.get('trade')) raw = params.get('trade');
            }
            if (!raw) return false;

            try {
                const cleanStr = decodeURIComponent(raw.trim());
                let json = '';

                if (cleanStr.startsWith('cz.')) {
                    // Decompress Deflate stream
                    const b64 = cleanStr.substring(3);
                    const binary = atob(b64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) {
                        bytes[i] = binary.charCodeAt(i);
                    }
                    if (typeof DecompressionStream !== 'undefined') {
                        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
                        json = await new Response(stream).text();
                    } else {
                        console.warn("DecompressionStream not supported in this browser.");
                        return false;
                    }
                } else {
                    // Base64 decoded
                    try {
                        json = decodeURIComponent(escape(atob(cleanStr)));
                    } catch (e) {
                        json = atob(cleanStr);
                    }
                }

                const data = JSON.parse(json);
                if (!data) return false;

                const parseCard = (c) => {
                    if (Array.isArray(c)) {
                        // Compact tuple: [name, setCode, collectorNumber, finish, quantity, priceUsd]
                        const name = c[0] || '';
                        const setCode = c[1] || '';
                        const collectorNumber = c[2] ? String(c[2]) : '';
                        const finish = c[3] || 'Normal';
                        const quantity = parseInt(c[4]) || 1;
                        const priceUsd = parseFloat(c[5]) || 0;
                        const imageUrl = (setCode && collectorNumber)
                            ? `https://api.scryfall.com/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(collectorNumber)}?format=image`
                            : (name ? `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image` : '');
                        return {
                            name,
                            setCode,
                            collectorNumber,
                            finish,
                            quantity,
                            priceUsd,
                            imageUrl
                        };
                    }
                    // Legacy object format
                    const name = c.n || c.name || '';
                    const setCode = c.s || c.setCode || '';
                    const collectorNumber = c.cn ? String(c.cn) : (c.collectorNumber ? String(c.collectorNumber) : '');
                    const finish = c.f || c.finish || 'Normal';
                    const quantity = c.q || c.quantity || 1;
                    const priceUsd = c.p || c.priceUsd || 0;
                    let imageUrl = c.img || c.imageUrl || '';
                    if (!imageUrl) {
                        if (setCode && collectorNumber) {
                            imageUrl = `https://api.scryfall.com/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(collectorNumber)}?format=image`;
                        } else if (name) {
                            imageUrl = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image`;
                        }
                    }
                    return {
                        name,
                        setCode,
                        collectorNumber,
                        finish,
                        quantity,
                        priceUsd,
                        imageUrl
                    };
                };

                const havesRaw = Array.isArray(data.h) ? data.h : (Array.isArray(data.haves) ? data.haves : []);
                const wantsRaw = Array.isArray(data.w) ? data.w : (Array.isArray(data.wants) ? data.wants : []);

                if (havesRaw.length > 0 || wantsRaw.length > 0) {
                    incomingFriendTrade = {
                        name: data.n || data.name || 'Friend',
                        haves: havesRaw.map(parseCard),
                        wants: wantsRaw.map(parseCard)
                    };
                    renderFriendTradeOffer();
                    return true;
                }
            } catch (e) {
                console.warn("Could not decode incoming trade offer:", e);
            }
            return false;
        }

        function renderFriendTradeOffer() {
            if (!incomingFriendTrade) return;
            const banner = document.getElementById('friendTradeBanner');
            if (!banner) return;
            banner.style.display = 'block';

            const titleEl = document.getElementById('friendOfferTitle');
            const subEl = document.getElementById('friendOfferSubtitle');
            const havesCount = incomingFriendTrade.haves.reduce((s, c) => s + (c.quantity || 1), 0);
            const wantsCount = incomingFriendTrade.wants.reduce((s, c) => s + (c.quantity || 1), 0);
            const curr = getMarketCurrency();
            const totalValue = incomingFriendTrade.haves.reduce((s, c) => s + ((c.priceUsd || 0) * (c.quantity || 1)), 0);

            if (titleEl) titleEl.textContent = `🤝 ${incomingFriendTrade.name}'s Trade Offer`;
            if (subEl) subEl.textContent = `${havesCount} cards available for trade • ${wantsCount} cards wanted • Total Offer Value: ${curr}${totalValue.toFixed(2)}`;

            compareFriendTradeAgainstCollection();
        }

        function dismissFriendTradeBanner() {
            const banner = document.getElementById('friendTradeBanner');
            if (banner) banner.style.display = 'none';
            history.replaceState({}, '', window.location.pathname + '?tab=trade');
            incomingFriendTrade = null;
        }

        function importFriendTradeToBinder() {
            if (!incomingFriendTrade) return;
            incomingFriendTrade.haves.forEach(c => {
                addToTradeBinder({
                    name: c.name,
                    setCode: c.setCode,
                    collectorNumber: c.collectorNumber || '',
                    finish: c.finish || 'Normal',
                    isFoil: String(c.finish || '').toLowerCase().includes('foil'),
                    priceUsd: c.priceUsd,
                    imageUrl: c.imageUrl || '',
                    type: 'have'
                });
            });
            incomingFriendTrade.wants.forEach(c => {
                addToTradeBinder({
                    name: c.name,
                    setCode: c.setCode,
                    collectorNumber: c.collectorNumber || '',
                    finish: c.finish || 'Normal',
                    isFoil: String(c.finish || '').toLowerCase().includes('foil'),
                    priceUsd: c.priceUsd,
                    imageUrl: c.imageUrl || '',
                    type: 'want'
                });
            });
            showToast("Copied friend's trade cards into your Trade Binder!");
        }

        function compareFriendTradeAgainstCollection() {
            if (!incomingFriendTrade) return;
            const container = document.getElementById('friendTradeMatches');
            if (!container) return;
            container.innerHTML = '';

            const ownedCardMap = new Map();
            if (Array.isArray(cachedParsedCsv)) {
                cachedParsedCsv.forEach(it => {
                    const n = (it.name || it.card?.name || '').toLowerCase().trim();
                    if (n) ownedCardMap.set(n, (ownedCardMap.get(n) || 0) + (parseInt(it.quantity || it.count) || 1));
                });
            } else if (Array.isArray(currentCollectionData)) {
                currentCollectionData.forEach(it => {
                    const n = (it.name || it.card?.name || '').toLowerCase().trim();
                    if (n) ownedCardMap.set(n, (ownedCardMap.get(n) || 0) + (parseInt(it.quantity || it.count) || 1));
                });
            }

            const hasCollection = ownedCardMap.size > 0;
            const noticeEl = document.getElementById('friendTradeCollectionNotice');
            if (noticeEl) {
                noticeEl.textContent = hasCollection
                    ? `Cross-referencing with your active collection (${ownedCardMap.size.toLocaleString()} unique cards loaded).`
                    : `⚠️ Load your collection in Step 1 above to automatically see which cards you need from this offer!`;
            }

            const cardsYouNeed = [];
            incomingFriendTrade.haves.forEach(c => {
                const owned = ownedCardMap.get(c.name.toLowerCase()) || 0;
                if (!hasCollection || owned === 0) {
                    cardsYouNeed.push(c);
                }
            });

            const cardsYouCanOffer = [];
            incomingFriendTrade.wants.forEach(c => {
                const owned = ownedCardMap.get(c.name.toLowerCase()) || 0;
                if (hasCollection && owned > 0) {
                    cardsYouCanOffer.push({ ...c, youOwn: owned });
                }
            });

            const box1 = document.createElement('div');
            box1.className = 'match-box';
            box1.innerHTML = `
                <div style="font-weight: 800; font-size: 0.95rem; margin-bottom: 0.5rem; color: #34d399; display: flex; align-items: center; gap: 0.35rem;">
                    <span>🎯</span> Cards They Have That You Don't Own (${cardsYouNeed.length})
                </div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">
                    ${hasCollection ? 'Cards missing from your collection that are in this offer:' : 'Cards offered:'}
                </div>
                <ul style="list-style: none; padding: 0; margin: 0; max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem;">
                    ${cardsYouNeed.length > 0 ? cardsYouNeed.map(c => `
                        <li style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-color); padding: 0.35rem 0.6rem; border-radius: 6px;">
                            <span>${c.quantity}x <strong>${c.name}</strong> ${c.setCode ? `<span class="badge badge-code">${c.setCode}</span>` : ''}</span>
                            <span style="color: #34d399; font-weight: 700;">${c.priceUsd ? `$${(c.priceUsd * c.quantity).toFixed(2)}` : ''}</span>
                        </li>
                    `).join('') : '<li style="color: var(--text-muted); padding: 0.5rem 0;">You already own all cards offered by your friend!</li>'}
                </ul>
            `;

            const box2 = document.createElement('div');
            box2.className = 'match-box';
            box2.innerHTML = `
                <div style="font-weight: 800; font-size: 0.95rem; margin-bottom: 0.5rem; color: #38bdf8; display: flex; align-items: center; gap: 0.35rem;">
                    <span>🔄</span> Cards They Want That You Own (${cardsYouCanOffer.length})
                </div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">
                    ${hasCollection ? 'Wishlist cards you have in your collection:' : 'Friend wishlist:'}
                </div>
                <ul style="list-style: none; padding: 0; margin: 0; max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem;">
                    ${cardsYouCanOffer.length > 0 ? cardsYouCanOffer.map(c => `
                        <li style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-color); padding: 0.35rem 0.6rem; border-radius: 6px;">
                            <span>${c.quantity}x <strong>${c.name}</strong> <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 0.72rem;">You own: ${c.youOwn}x</span></span>
                            <span style="color: #38bdf8; font-weight: 700;">${c.priceUsd ? `$${(c.priceUsd * c.quantity).toFixed(2)}` : ''}</span>
                        </li>
                    `).join('') : `<li style="color: var(--text-muted); padding: 0.5rem 0;">${hasCollection ? 'You don’t have extra copies of cards on their wishlist.' : 'Load your collection to see matches.'}</li>`}
                </ul>
            `;

            container.appendChild(box1);
            container.appendChild(box2);
        }

        // ==================== WHAT CAN I BUILD & PRECON UPGRADER ====================
        let currentBuildSubTab = 'new'; // 'new' | 'upgrades' | 'commanders'
        let currentBuildFilter = 'all'; // 'all' | 'precon' | 'edhrec' | 'owned_cmdrs'
        let currentBuildThreshold = 50; // 50 (default) | 75 | 0
        const expandedMissingDrawers = new Set();

        function escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }
        window.escapeHtml = escapeHtml;

        function showHoverPreview(e, cardName) {
            if (typeof showScryfallHover === 'function') {
                showScryfallHover(cardName, e);
            }
        }
        function hideHoverPreview() {
            if (typeof hideScryfallHover === 'function') {
                hideScryfallHover();
            }
        }
        window.showHoverPreview = showHoverPreview;
        window.hideHoverPreview = hideHoverPreview;

        function parseDecklistText(text) {
            return parseDecklistCards(text);
        }
        window.parseDecklistText = parseDecklistText;

        const BASIC_LAND_NAMES = new Set([
            'plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
            'snow-covered plains', 'snow-covered island', 'snow-covered swamp',
            'snow-covered mountain', 'snow-covered forest', 'snow-covered wastes'
        ]);

        function parseDecklistCards(decklistStr, commanderName = '') {
            const lines = (decklistStr || '').split('\n');
            const cards = [];
            for (const raw of lines) {
                const line = raw.trim();
                if (!line || line.startsWith('//')) continue;
                const m = line.match(/^(\d+)\s+(.+?)(?:\s+\([A-Z0-9]+\)\s*.*)?$/);
                if (m) {
                    const qty = parseInt(m[1], 10) || 1;
                    let name = m[2].trim().replace(/\s+\([A-Z0-9]+\).*$/, '').replace(/\s+\*F\*$/, '').trim();
                    const isBasic = BASIC_LAND_NAMES.has(name.toLowerCase());
                    const isCommander = Boolean(commanderName && name.toLowerCase() === commanderName.toLowerCase());
                    cards.push({
                        name,
                        quantity: qty,
                        isBasic,
                        isCommander,
                        price: isBasic ? 0 : 0.75
                    });
                }
            }
            return cards;
        }

        // Popular EDHREC archetypes with full 100-card Commander decklists
        const EDHREC_META_DECKS = [
            {
                id: 'edhrec-krenko',
                name: "Krenko Goblin Overrun",
                commander: "Krenko, Mob Boss",
                type: 'edhrec',
                set: 'M13',
                colors: ['R'],
                imageUrl: 'https://api.scryfall.com/cards/named?exact=Krenko%2C%20Mob%20Boss&format=image&version=art_crop',
                sourceUrl: 'https://edhrec.com/commanders/krenko-mob-boss',
                theme: "Goblin Swarm & Exponential Tokens",
                strategy: "Multiply Goblin tokens exponentially with Krenko. Overwhelm opponents with haste anthems, burn on creature entry, and sacrificial artillery.",
                cardCount: 100,
                decklist: `// Commander\n1 Krenko, Mob Boss (M13) 138\n\n// Mainboard\n1 Goblin Chieftain (M12) 138\n1 Goblin Warchief (DOM) 130\n1 Goblin King (10E) 207\n1 Goblin Trashmaster (M19) 144\n1 Pashalik Mons (MH1) 138\n1 Goblin Recruiter (6ED) 186\n1 Goblin Matron (MH1) 129\n1 Goblin Ringleader (M20) 143\n1 Muxus, Goblin Grandee (JMP) 24\n1 Krenko, Tin Street Kingpin (WAR) 137\n1 Siege-Gang Commander (EMA) 147\n1 Rundvelt Hordemaster (DMU) 142\n1 Conspicuous Snoop (M21) 139\n1 Goblin Piledriver (ORI) 151\n1 Legion Loyalist (GTC) 97\n1 Goblin Bushwhacker (ZEN) 125\n1 Reckless Bushwhacker (OGW) 116\n1 Warren Instigator (ZEN) 154\n1 Battle Cry Goblin (AFR) 132\n1 Squee, the Immortal (DOM) 149\n1 Goro-Goro, Disciple of Ryusei (NEO) 145\n1 Hobgoblin Bandit Lord (AFR) 147\n1 Dark-Dweller Oracle (M19) 134\n1 Goblin Chirurgeon (FEM) 54\n1 Arms Dealer (M13) 120\n1 Brash Taunter (M21) 133\n1 Fanatical Firebrand (RIX) 101\n1 Torch Courier (GRN) 119\n1 Beetleback Chief (EMA) 120\n1 Skirk Prospector (DOM) 144\n1 Impact Tremors (DTK) 140\n1 Purphoros, God of the Forge (THS) 135\n1 Shared Animosity (MOR) 104\n1 Goblin Bombardment (MH2) 279\n1 Quest for the Goblin Lord (WWK) 86\n1 Mechanized Warfare (BRO) 139\n1 Chaos Warp (C14) 176\n1 Blasphemous Act (ISD) 150\n1 Jeska's Will (CMR) 187\n1 Deflecting Swat (C20) 50\n1 Bolt Bend (WAR) 115\n1 Brightstone Ritual (ONS) 191\n1 Battle Hymn (AVR) 128\n1 Massive Raid (GTC) 100\n1 You See a Pair of Goblins (AFR) 170\n1 Hordeling Outburst (KTK) 111\n1 Dragon Fodder (ALA) 93\n1 Krenko's Command (M13) 139\n1 Empty the Warrens (TSP) 152\n1 Sol Ring (C14) 268\n1 Arcane Signet (ELD) 331\n1 Ruby Medallion (TMP) 295\n1 Skullclamp (DST) 140\n1 Lightning Greaves (MRD) 199\n1 Swiftfoot Boots (M12) 219\n1 Thornbite Staff (MOR) 145\n1 Illusionist's Bracers (GTC) 231\n1 Herald's Horn (C17) 53\n1 Ashnod's Altar (EMA) 218\n1 Phyrexian Altar (INV) 306\n1 Mind Stone (10E) 335\n1 Thought Vessel (C15) 55\n1 Castle Embereth (ELD) 239\n1 Nykthos, Shrine to Nyx (THS) 223\n1 Forgotten Cave (ONS) 317\n1 Command Beacon (C15) 56\n1 War Room (CMR) 361\n1 Den of the Bugbear (AFR) 254\n1 Cavern of Souls (AVR) 226\n1 Hanweir Battlements (EMN) 204\n29 Mountain (BLB) 274`
            },
            {
                id: 'edhrec-yuriko',
                name: "Yuriko Ninjutsu Tempo",
                commander: "Yuriko, the Tiger's Shadow",
                type: 'edhrec',
                set: 'C18',
                colors: ['U', 'B'],
                imageUrl: 'https://api.scryfall.com/cards/named?exact=Yuriko%2C%20the%20Tiger%27s%20Shadow&format=image&version=art_crop',
                sourceUrl: 'https://edhrec.com/commanders/yuriko-the-tigers-shadow',
                theme: "Commander Ninjutsu & Big-Mana Burn",
                strategy: "Cheat Yuriko into play uncounterably via Commander Ninjutsu. Stack the top of your deck with colossal mana value spells to burn opponents simultaneously.",
                cardCount: 100,
                decklist: `// Commander\n1 Yuriko, the Tiger's Shadow (C18) 52\n\n// Mainboard\n1 Ingenious Infiltrator (MH1) 204\n1 Silver-Fur Master (NEO) 236\n1 Moon-Circuit Hacker (NEO) 67\n1 Ninja of the Deep Hours (BOK) 44\n1 Mist-Syndicate Naga (MH1) 58\n1 Prosperous Thief (NEO) 73\n1 Throat Slitter (BOK) 88\n1 Dokuchi Silencer (NEO) 95\n1 Mistblade Shinobi (BOK) 40\n1 Thousand-Faced Shadow (NEO) 86\n1 Nashi, Moon Sage's Scion (NEO) 114\n1 Changeling Outcast (MH1) 78\n1 Ornithopter (ATQ) 66\n1 Memnite (SOM) 174\n1 Faerie Seer (MH1) 51\n1 Slither Blade (AKH) 71\n1 Siren Stormtamer (XLN) 79\n1 Spectral Sailor (M20) 76\n1 Mothdust Changeling (MOR) 42\n1 Tetsuko Umezawa, Fugitive (DOM) 69\n1 Sakashima's Student (PC2) 24\n1 Kaito Shizuki (NEO) 226\n1 Kaito, Dancing Shadow (ONE) 204\n1 Brainstorm (ICE) 61\n1 Ponder (LRW) 79\n1 Preordain (M11) 70\n1 Lim-Dûl's Vault (ALL) 112\n1 Mystical Tutor (MIR) 80\n1 Vampiric Tutor (6ED) 165\n1 Demonic Tutor (3ED) 105\n1 Scroll Rack (TMP) 308\n1 Sensei's Divining Top (CHK) 268\n1 Cyclonic Rift (RTR) 35\n1 Counterspell (4ED) 65\n1 Fierce Guardianship (C20) 35\n1 Force of Will (ALL) 28\n1 Force of Negation (MH1) 52\n1 Swan Song (THS) 65\n1 Arcane Denial (ALL) 22\n1 Infernal Grasp (MID) 107\n1 Snuff Out (MMQ) 162\n1 Deadly Rollick (C20) 42\n1 Temporal Trespass (FRF) 55\n1 Dig Through Time (KTK) 36\n1 Treasure Cruise (KTK) 59\n1 Shadow of Mortality (SNC) 94\n1 Draco (PLS) 131\n1 Blinkmoth Infusion (5DN) 25\n1 Sol Ring (C18) 222\n1 Arcane Signet (ELD) 331\n1 Dimir Signet (RAV) 260\n1 Talisman of Dominance (MRD) 253\n1 Thought Vessel (C15) 55\n1 Lightning Greaves (MRD) 199\n1 Swiftfoot Boots (M12) 219\n1 Watery Grave (GTC) 249\n1 Drowned Catacomb (M13) 223\n1 Polluted Delta (KTK) 239\n1 Morphic Pool (BBD) 83\n1 Choked Estuary (SOI) 270\n1 Sunken Hollow (BFZ) 249\n1 Shipwreck Marsh (MID) 267\n1 Underground River (ICE) 359\n1 Clearwater Pathway (ZNR) 260\n1 Command Tower (C18) 235\n1 Exotic Orchard (CON) 142\n1 Reliquary Tower (M13) 227\n1 Bojuka Bog (WWK) 132\n15 Island (BLB) 271\n16 Swamp (BLB) 273`
            },
            {
                id: 'edhrec-miirym',
                name: "Miirym Dragon Multiplier",
                commander: "Miirym, Sentinel Wyrm",
                type: 'edhrec',
                set: 'CLB',
                colors: ['G', 'U', 'R'],
                imageUrl: 'https://api.scryfall.com/cards/named?exact=Miirym%2C%20Sentinel%20Wyrm&format=image&version=art_crop',
                sourceUrl: 'https://edhrec.com/commanders/miirym-sentinel-wyrm',
                theme: "Dragon Tribal & Token Duplication",
                strategy: "Cast colossal Dragons that Miirym duplicates for free into non-legendary token clones. Trigger explosive enter-the-battlefield burn and overwhelm the skies.",
                cardCount: 100,
                decklist: `// Commander\n1 Miirym, Sentinel Wyrm (CLB) 284\n\n// Mainboard\n1 Utvara Hellkite (RTR) 110\n1 Goldspan Dragon (KHM) 139\n1 Old Gnawbone (AFR) 197\n1 Terror of the Peaks (M21) 164\n1 Scourge of Valkas (M14) 151\n1 Dragon Tempest (DTK) 136\n1 Lathliss, Dragon Queen (M19) 149\n1 Ganax, Astral Hunter (CLB) 176\n1 Thrakkus the Butcher (CLB) 295\n1 Atarka, World Render (FRF) 149\n1 Savage Ventmaw (DTK) 231\n1 Klauth, Unrivaled Ancient (AFC) 49\n1 Lozhan, Dragons' Legacy (CLB) 281\n1 Renari, Merchant of Marvels (CLB) 90\n1 Earthquake Dragon (CLB) 228\n1 Dragonlord's Servant (DTK) 138\n1 Dragonspeaker Shaman (SCG) 89\n1 Scaled Nurturer (CLB) 252\n1 Orb of Dragonkind (AFR) 157\n1 Dragon's Hoard (M19) 232\n1 Carnelian Orb of Dragonkind (CLB) 166\n1 Jade Orb of Dragonkind (CLB) 236\n1 Lapis Orb of Dragonkind (CLB) 82\n1 Sol Ring (CLB) 873\n1 Arcane Signet (CLB) 846\n1 Izzet Signet (GPT) 153\n1 Gruul Signet (GPT) 150\n1 Simic Signet (DIS) 166\n1 Talisman of Creativity (MH1) 231\n1 Talisman of Impulse (MRD) 254\n1 Talisman of Curiosity (MH1) 232\n1 Farseek (M13) 170\n1 Cultivate (M11) 168\n1 Kodama's Reach (CHK) 225\n1 Nature's Lore (ICE) 252\n1 Three Visits (PTK) 155\n1 Skyshroud Claim (NMS) 122\n1 Heroic Intervention (AER) 109\n1 Cyclonic Rift (RTR) 35\n1 Beast Within (NPH) 103\n1 Chaos Warp (C14) 176\n1 Counterspell (4ED) 65\n1 Temur Ascendancy (KTK) 207\n1 Garruk's Uprising (M21) 186\n1 Elemental Bond (ORI) 174\n1 Kindred Discovery (C17) 11\n1 Crucible of Fire (ALA) 99\n1 Blasphemous Act (ISD) 150\n1 Stomping Ground (GTC) 247\n1 Steam Vents (RTR) 247\n1 Breeding Pool (GTC) 240\n1 Ketria Triome (IKO) 250\n1 Command Tower (CLB) 351\n1 Haven of the Spirit Dragon (DTK) 249\n1 Crucible of the Spirit Dragon (FRF) 167\n1 Path of Ancestry (C17) 56\n1 Exotic Orchard (CON) 142\n1 Karplusan Forest (ICE) 354\n1 Shivan Reef (APC) 142\n1 Yavimaya Coast (APC) 143\n1 Spire Garden (BBD) 85\n1 Training Center (CMR) 358\n1 Rejuvenating Springs (CMR) 354\n1 Fabled Passage (ELD) 244\n13 Mountain (BLB) 274\n12 Forest (BLB) 275\n10 Island (BLB) 271`
            }
        ];

        // Process EDHREC meta decks cards
        EDHREC_META_DECKS.forEach(d => {
            d.cards = parseDecklistCards(d.decklist, d.commander);
            if (!d.sourceUrl && d.commander) {
                const slug = d.commander.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                d.sourceUrl = `https://edhrec.com/commanders/${slug}`;
            }
        });

        let BUILD_DECKS_CATALOG = [...EDHREC_META_DECKS];
        let buildDecksLoadedPromise = null;

        async function loadBuildDecksCatalog() {
            if (BUILD_DECKS_CATALOG.length > EDHREC_META_DECKS.length) {
                return BUILD_DECKS_CATALOG;
            }
            if (buildDecksLoadedPromise) {
                return buildDecksLoadedPromise;
            }

            buildDecksLoadedPromise = (async () => {
                try {
                    const res = await fetch('./commander-precons.json?v=6.9');
                    if (res.ok) {
                        const preconsData = await res.json();
                        if (Array.isArray(preconsData) && preconsData.length > 0) {
                            const precons = preconsData.map(p => {
                                const id = `precon-${(p.code || 'cmd').toLowerCase()}-${(p.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
                                const cards = parseDecklistCards(p.decklist, p.commander);
                                const bannerUrl = p.scryfallId
                                    ? `https://api.scryfall.com/cards/${p.scryfallId}?format=image&version=art_crop`
                                    : `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(p.commander)}&format=image&version=art_crop`;
                                const sourceUrl = p.source || (p.code ? `https://mtg.fandom.com/wiki/${encodeURIComponent(p.name)}` : '');
                                return {
                                    id,
                                    name: p.name,
                                    commander: p.commander,
                                    type: 'precon',
                                    set: p.code || 'CMD',
                                    releaseDate: p.releaseDate || '',
                                    colors: p.colors || [],
                                    scryfallId: p.scryfallId || null,
                                    imageUrl: bannerUrl,
                                    sourceUrl,
                                    theme: p.theme || 'Commander Precon',
                                    strategy: p.strategy || '',
                                    cardCount: p.cardCount || 100,
                                    decklist: p.decklist,
                                    cards
                                };
                            });

                            BUILD_DECKS_CATALOG = [...precons, ...EDHREC_META_DECKS];
                            window.PRECON_DECKS_DATABASE = BUILD_DECKS_CATALOG;
                        }
                    }
                } catch (e) {
                    console.warn('Failed to load commander-precons.json:', e);
                }
                return BUILD_DECKS_CATALOG;
            })();

            return buildDecksLoadedPromise;
        }

        function findBuildDeck(deckId) {
            return BUILD_DECKS_CATALOG.find(d => d.id === deckId);
        }
        window.PRECON_DECKS_DATABASE = BUILD_DECKS_CATALOG;

        function switchBuildSubTab(subTab) {
            currentBuildSubTab = subTab;
            const btnNew = document.getElementById('buildSubNavNew');
            const btnUpgrades = document.getElementById('buildSubNavUpgrades');
            const btnCmdrs = document.getElementById('buildSubNavCommanders');

            const viewNew = document.getElementById('buildNewDecksView');
            const viewUpgrades = document.getElementById('buildUpgradesView');
            const viewCmdrs = document.getElementById('buildCommandersView');

            if (btnNew) btnNew.className = subTab === 'new' ? 'secondary-btn active' : 'secondary-btn';
            if (btnUpgrades) btnUpgrades.className = subTab === 'upgrades' ? 'secondary-btn active' : 'secondary-btn';
            if (btnCmdrs) btnCmdrs.className = subTab === 'commanders' ? 'secondary-btn active' : 'secondary-btn';

            if (viewNew) viewNew.style.display = subTab === 'new' ? 'block' : 'none';
            if (viewUpgrades) viewUpgrades.style.display = subTab === 'upgrades' ? 'block' : 'none';
            if (viewCmdrs) viewCmdrs.style.display = subTab === 'commanders' ? 'block' : 'none';

            if (subTab === 'new') renderBuildSection();
            else if (subTab === 'upgrades') renderBuildUpgrades();
            else if (subTab === 'commanders') renderBuildCommanders();
        }

        function setBuildThreshold(threshold) {
            currentBuildThreshold = parseInt(threshold) || 0;
            const b50 = document.getElementById('buildThreshold50');
            const b25 = document.getElementById('buildThreshold25');
            const b75 = document.getElementById('buildThreshold75');
            const b0 = document.getElementById('buildThreshold0');

            if (b50) b50.className = currentBuildThreshold === 50 ? 'secondary-btn active' : 'secondary-btn';
            if (b25) b25.className = currentBuildThreshold === 25 ? 'secondary-btn active' : 'secondary-btn';
            if (b75) b75.className = currentBuildThreshold === 75 ? 'secondary-btn active' : 'secondary-btn';
            if (b0) b0.className = currentBuildThreshold === 0 ? 'secondary-btn active' : 'secondary-btn';

            renderBuildSection();
        }

        function setBuildFilter(filter) {
            currentBuildFilter = filter;
            const hidePreconsCheckbox = document.getElementById('buildHidePreconsCheckbox');

            if (filter === 'precon' && hidePreconsCheckbox) {
                hidePreconsCheckbox.checked = false;
            } else if (filter === 'edhrec' && hidePreconsCheckbox) {
                hidePreconsCheckbox.checked = true;
            }

            const btnAll = document.getElementById('buildFilterAll');
            const btnPrecons = document.getElementById('buildFilterPrecons');
            const btnEdhrec = document.getElementById('buildFilterEdhrec');
            const btnOwnedCmdrs = document.getElementById('buildFilterOwnedCmdrs');

            if (btnAll) btnAll.className = filter === 'all' ? 'secondary-btn active' : 'secondary-btn';
            if (btnPrecons) btnPrecons.className = filter === 'precon' ? 'secondary-btn active' : 'secondary-btn';
            if (btnEdhrec) btnEdhrec.className = filter === 'edhrec' ? 'secondary-btn active' : 'secondary-btn';
            if (btnOwnedCmdrs) btnOwnedCmdrs.className = filter === 'owned_cmdrs' ? 'secondary-btn active' : 'secondary-btn';

            renderBuildSection();
        }

        function toggleMissingDrawer(deckId) {
            if (expandedMissingDrawers.has(deckId)) {
                expandedMissingDrawers.delete(deckId);
            } else {
                expandedMissingDrawers.add(deckId);
            }
            renderBuildSection();
        }

        let cachedModalDecklistRaw = '';

        function openBuildDecklistModal(deckId) {
            const deck = findBuildDeck(deckId);
            if (!deck) return;

            const modal = document.getElementById('buildDecklistModal');
            if (!modal) return;

            const titleEl = document.getElementById('buildDecklistModalTitle');
            const subEl = document.getElementById('buildDecklistModalSubtitle');
            const statsEl = document.getElementById('buildDecklistStats');
            const sourceLink = document.getElementById('buildDecklistSourceLink');
            const bodyEl = document.getElementById('buildDecklistModalBody');

            if (titleEl) titleEl.textContent = deck.name;
            if (subEl) subEl.innerHTML = `Commander: <strong>${deck.commander}</strong> • ${deck.type === 'precon' ? `Precon (${deck.set})` : 'EDHREC Meta Archetype'}`;
            if (sourceLink) {
                if (deck.sourceUrl) {
                    sourceLink.href = deck.sourceUrl;
                    sourceLink.style.display = 'inline-flex';
                } else {
                    sourceLink.style.display = 'none';
                }
            }

            // Build collection lookup for marking owned/missing
            let ownedCardsList = (cachedParsedCsv && cachedParsedCsv.length > 0) ? cachedParsedCsv : (currentCollectionData || []);
            const ownedCardNames = new Set();
            ownedCardsList.forEach(it => {
                const rawName = it.name || it.card?.name || it.card?.oracleCard?.name || '';
                if (!rawName) return;
                const n = normalizeCardName(rawName);
                if (n) ownedCardNames.add(n);
                ownedCardNames.add(rawName.toLowerCase().trim());
            });

            // Categorize cards
            const categories = {
                'Commander': [],
                'Creatures': [],
                'Instants & Sorceries': [],
                'Artifacts & Enchantments': [],
                'Planeswalkers': [],
                'Non-Basic Lands': [],
                'Basic Lands': []
            };

            const fullDeckCards = deck.cards || parseDecklistCards(deck.decklist, deck.commander);
            cachedModalDecklistRaw = fullDeckCards.map(c => `${c.quantity || 1} ${c.name}`).join('\n');

            let nonBasicCount = 0;
            let nonBasicOwned = 0;

            fullDeckCards.forEach(c => {
                const cName = c.name;
                const cNorm = normalizeCardName(cName);
                const isBasic = c.isBasic || BASIC_LAND_NAMES.has(cNorm) || BASIC_LAND_NAMES.has(cName.toLowerCase());
                const isOwned = ownedCardNames.has(cNorm) || ownedCardNames.has(cName.toLowerCase().trim());
                const isCmdr = c.isCommander || (deck.commander && cNorm === normalizeCardName(deck.commander));

                if (!isBasic) {
                    nonBasicCount += (c.quantity || 1);
                    if (isOwned) nonBasicOwned += (c.quantity || 1);
                }

                const cardObj = {
                    ...c,
                    isBasic,
                    isOwned,
                    isCommander: isCmdr
                };

                const typeLower = (c.type || '').toLowerCase();
                if (isCmdr) {
                    categories['Commander'].push(cardObj);
                } else if (isBasic) {
                    categories['Basic Lands'].push(cardObj);
                } else if (typeLower.includes('land') || /land/i.test(cName)) {
                    categories['Non-Basic Lands'].push(cardObj);
                } else if (typeLower.includes('creature')) {
                    categories['Creatures'].push(cardObj);
                } else if (typeLower.includes('instant') || typeLower.includes('sorcery')) {
                    categories['Instants & Sorceries'].push(cardObj);
                } else if (typeLower.includes('planeswalker')) {
                    categories['Planeswalkers'].push(cardObj);
                } else if (typeLower.includes('artifact') || typeLower.includes('enchantment')) {
                    categories['Artifacts & Enchantments'].push(cardObj);
                } else {
                    categories['Creatures'].push(cardObj);
                }
            });

            const pctNonBasic = nonBasicCount > 0 ? Math.round((nonBasicOwned / nonBasicCount) * 100) : 100;
            if (statsEl) {
                statsEl.innerHTML = `
                    <span>📊 <strong>${pctNonBasic}% Owned</strong> (${nonBasicOwned}/${nonBasicCount} non-basic cards)</span>
                    <span style="color: var(--text-muted); margin-left: 0.5rem;">• Total deck: ${fullDeckCards.reduce((a, c) => a + (c.quantity || 1), 0)} cards</span>
                `;
            }

            // Build HTML
            let html = '';
            for (const [catName, cardsInCat] of Object.entries(categories)) {
                if (cardsInCat.length === 0) continue;
                const countInCat = cardsInCat.reduce((a, c) => a + (c.quantity || 1), 0);
                html += `
                    <div style="margin-bottom: 1.25rem;">
                        <div style="font-size: 0.82rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.5rem; display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 0.25rem;">
                            <span>${catName}</span>
                            <span>(${countInCat})</span>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.35rem;">
                            ${cardsInCat.map(c => {
                                const safeCName = (c.name || '').replace(/'/g, "\\'");
                                return `
                                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.3rem 0.55rem; background: rgba(255,255,255,0.02); border-radius: 6px; font-size: 0.82rem;">
                                        <span class="hover-card-link" onmouseenter="bindHoverName(this, '${safeCName}')" style="color: var(--text-color); cursor: pointer; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 180px;">
                                            ${c.quantity && c.quantity > 1 ? `<strong>${c.quantity}x</strong> ` : ''}${c.name}
                                        </span>
                                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                                            ${c.isBasic ? `
                                                <span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; font-size: 0.68rem;">Basic</span>
                                            ` : (c.isOwned ? `
                                                <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-size: 0.68rem; font-weight: 700;">✓ Owned</span>
                                            ` : `
                                                <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; font-size: 0.68rem; font-weight: 700;">✗ Missing</span>
                                            `)}
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }

            if (bodyEl) bodyEl.innerHTML = html;
            modal.style.display = 'flex';
        }

        function closeBuildDecklistModal() {
            const modal = document.getElementById('buildDecklistModal');
            if (modal) modal.style.display = 'none';
        }

        function copyBuildDecklistText() {
            if (!cachedModalDecklistRaw) return;
            navigator.clipboard.writeText(cachedModalDecklistRaw).then(() => {
                const btn = document.getElementById('buildDecklistCopyBtn');
                if (btn) {
                    const orig = btn.textContent;
                    btn.textContent = '✓ Copied!';
                    setTimeout(() => { btn.textContent = orig; }, 2000);
                }
            }).catch(() => {
                alert('Could not copy to clipboard.');
            });
        }
        window.openBuildDecklistModal = openBuildDecklistModal;
        window.closeBuildDecklistModal = closeBuildDecklistModal;
        window.copyBuildDecklistText = copyBuildDecklistText;

        function addMissingCardsToWants(deckId) {
            const deck = findBuildDeck(deckId);
            if (!deck) return;

            let ownedCardsList = (cachedParsedCsv && cachedParsedCsv.length > 0) ? cachedParsedCsv : (currentCollectionData || []);
            const ownedCardNames = new Set();
            ownedCardsList.forEach(it => {
                const rawName = it.name || it.card?.name || it.card?.oracleCard?.name || '';
                const n = normalizeCardName(rawName);
                if (n) ownedCardNames.add(n);
                ownedCardNames.add(rawName.toLowerCase().trim());
            });

            let addedCount = 0;
            const cardList = deck.cards || deck.keyCards || [];
            cardList.forEach(c => {
                const cName = typeof c === 'string' ? c : (c.name || c.n);
                const cNorm = normalizeCardName(cName);
                const isBasic = c.isBasic || BASIC_LAND_NAMES.has(cNorm) || BASIC_LAND_NAMES.has(cName.toLowerCase());
                if (isBasic) return; // Do not add basic lands to trade binder wants

                if (!ownedCardNames.has(cNorm) && !ownedCardNames.has(cName.toLowerCase().trim())) {
                    const cPrice = typeof c === 'object' && (c.price || c.p) ? (c.price || c.p) : 0.75;
                    addToTradeBinder({
                        name: cName,
                        setCode: deck.set || '',
                        priceUsd: cPrice,
                        type: 'want'
                    });
                    addedCount++;
                }
            });

            saveTradeBinderToStorage();
            updateTradeBadge();
            showToast(`Added ${addedCount} missing cards from "${deck.name}" to your Trade Binder wishlist! 📋`);
        }
        window.addMissingCardsToWants = addMissingCardsToWants;
        window.addMissingCardsToWishlist = addMissingCardsToWants;

        async function renderBuildSection(forceRefresh = false) {
            const grid = document.getElementById('buildDeckGrid');
            if (!grid) return;

            // Ensure catalog of 180+ decks is loaded
            await loadBuildDecksCatalog();

            let collectionId = document.getElementById('collectionId')?.value.trim() || localStorage.getItem('archidekt_collectionId') || '';
            const collMatch = collectionId.match(/(?:archidekt\.com\/collections?\/)(\d+)/i);
            if (collMatch) collectionId = collMatch[1];
            else {
                const rawNum = collectionId.match(/\d+/);
                if (rawNum && /^\d+$/.test(collectionId)) collectionId = rawNum[0];
            }

            let ownedCardsList = (cachedParsedCsv && cachedParsedCsv.length > 0) ? cachedParsedCsv : (currentCollectionData || []);
            if (ownedCardsList.length === 0 && collectionId && !forceRefresh) {
                const stored = AppStorage.loadArchidektCollection(collectionId);
                if (stored && stored.length > 0) {
                    currentCollectionData = stored;
                    ownedCardsList = stored;
                    updateCollectionStatusBadge();
                }
            }

            if (ownedCardsList.length === 0 && collectionId) {
                grid.innerHTML = `
                    <div style="grid-column: 1 / -1; padding: 4rem 1rem; text-align: center;">
                        <div class="spinner" style="width: 40px; height: 40px; border-width: 3px; margin: 0 auto 1.25rem auto;"></div>
                        <h3 style="margin: 0 0 0.5rem 0; font-size: 1.3rem;">Analyzing Your Collection...</h3>
                        <p style="color: var(--text-muted); font-size: 0.95rem; max-width: 500px; margin: 0 auto;">
                            Evaluating Archidekt collection <strong>#${collectionId}</strong> against popular Commander precons & top archetypes...
                        </p>
                    </div>
                `;

                try {
                    let response = await fetch('/getCollectionInsights', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ collectionId })
                    });
                    const data = await response.json();
                    const collCards = (data.collection && Array.isArray(data.collection) && data.collection.length > 0)
                        ? data.collection
                        : ((data.cachedCollectionData && Array.isArray(data.cachedCollectionData) && data.cachedCollectionData.length > 0)
                            ? data.cachedCollectionData
                            : []);

                    if (collCards.length > 0) {
                        currentCollectionData = collCards;
                        AppStorage.saveArchidektCollection(collectionId, collCards);
                        updateCollectionStatusBadge();
                        renderBuildSection(false);
                        return;
                    } else {
                        grid.innerHTML = `
                            <div style="grid-column: 1 / -1; padding: 3rem 1.5rem; text-align: center; color: var(--status-missing); background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 12px;">
                                <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
                                <h3 style="margin: 0 0 0.5rem 0; color: #f87171;">No cards found in Collection #${collectionId}</h3>
                                <p style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--text-muted);">Please make sure the collection ID is correct and public on Archidekt, or upload a collection CSV file.</p>
                                <button type="button" class="main-btn" onclick="renderBuildSection(true)">Retry Analysis</button>
                            </div>
                        `;
                        return;
                    }
                } catch (err) {
                    grid.innerHTML = `
                        <div style="grid-column: 1 / -1; padding: 3rem 1.5rem; text-align: center; color: var(--status-missing); background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 12px;">
                            <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
                            <h3 style="margin: 0 0 0.5rem 0; color: #f87171;">Could not load collection #${collectionId}</h3>
                            <p style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--text-muted);">${err.message}</p>
                            <button type="button" class="main-btn" onclick="renderBuildSection(true)">Retry Analysis</button>
                        </div>
                    `;
                    return;
                }
            }

            if (ownedCardsList.length === 0) {
                grid.innerHTML = `
                    <div style="grid-column: 1 / -1; padding: 3.5rem 1.5rem; text-align: center; background: rgba(255, 255, 255, 0.02); border: 1px dashed var(--border-color); border-radius: 12px;">
                        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">⚡</div>
                        <h3 style="margin: 0 0 0.5rem 0; font-size: 1.3rem;">Enter a Collection to See What You Can Build</h3>
                        <p style="color: var(--text-muted); font-size: 0.92rem; max-width: 520px; margin: 0 auto 1.5rem auto;">
                            Enter your <strong>Archidekt Collection ID</strong> or upload a <strong>collection CSV</strong> in Step 1 above. We'll automatically cross-reference your collection against 180+ Commander precons & EDHREC meta archetypes!
                        </p>
                        <button type="button" class="main-btn" onclick="document.getElementById('collectionId').focus()">Enter Collection ID</button>
                    </div>
                `;
                return;
            }

            grid.innerHTML = '';

            const searchInput = document.getElementById('buildSearchInput');
            const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
            const sortMode = document.getElementById('buildSortSelect')?.value || 'pct_desc';
            const unusedOnly = document.getElementById('buildUnusedOnlyCheckbox')?.checked ?? false;
            const hidePrecons = document.getElementById('buildHidePreconsCheckbox')?.checked ?? false;
            const excludeCompared = document.getElementById('buildExcludeComparatorDecksCheckbox')?.checked ?? false;

            // Track card usage across all active compared decks in the Deck Comparator
            const comparatorCardUsage = new Map();
            const allCompDecks = [...(currentDecksData || []), ...(customPastedDecks || [])];
            if (excludeCompared && allCompDecks.length > 0) {
                allCompDecks.forEach(deck => {
                    (deck.cards || []).forEach(card => {
                        const rawName = card.name || card.card?.name || '';
                        const n = normalizeCardName(rawName);
                        if (n) {
                            comparatorCardUsage.set(n, (comparatorCardUsage.get(n) || 0) + Number(card.quantity || 1));
                        }
                    });
                });
            }

            // Build collection lookup set with normalized names, basic land filtering, and available copy checks
            const ownedCardNames = new Set();
            let totalEvaluatedCards = 0;
            let totalAvailableCopies = 0;

            ownedCardsList.forEach(it => {
                const rawName = it.name || it.card?.name || it.card?.oracleCard?.name || '';
                if (!rawName) return;

                const norm = normalizeCardName(rawName);
                // Completely remove basic lands from the lookup
                if (BASIC_LAND_NAMES.has(norm)) return;

                let owned = Number(it.owned ?? it.quantity ?? it.count ?? 1);
                if (unusedOnly) {
                    const inDecks = Number(it.inDecks ?? it.in_decks ?? 0);
                    owned = Math.max(0, owned - inDecks);
                }
                if (excludeCompared && comparatorCardUsage.size > 0) {
                    const usedInComp = comparatorCardUsage.get(norm) || 0;
                    owned = Math.max(0, owned - usedInComp);
                }

                if (owned <= 0) return;

                totalEvaluatedCards++;
                totalAvailableCopies += owned;

                if (norm) ownedCardNames.add(norm);
                ownedCardNames.add(rawName.toLowerCase().trim());

                if (rawName.includes('//')) {
                    rawName.split('//').forEach(part => {
                        const pNorm = normalizeCardName(part);
                        if (pNorm) ownedCardNames.add(pNorm);
                    });
                }
            });

            // Evaluation banner
            const banner = document.createElement('div');
            banner.style.gridColumn = '1 / -1';
            banner.style.display = 'flex';
            banner.style.justifyContent = 'space-between';
            banner.style.alignItems = 'center';
            banner.style.background = 'rgba(16, 185, 129, 0.1)';
            banner.style.border = '1px solid rgba(16, 185, 129, 0.25)';
            banner.style.padding = '0.75rem 1.25rem';
            banner.style.borderRadius = '10px';
            banner.style.fontSize = '0.88rem';
            banner.style.flexWrap = 'wrap';
            banner.style.gap = '0.5rem';

            const filterNotes = [];
            if (hidePrecons) filterNotes.push('Precons hidden');
            if (excludeCompared) filterNotes.push(`${allCompDecks.length} compared decks excluded`);
            if (unusedOnly) filterNotes.push('Archidekt in-deck cards excluded');
            filterNotes.push('Basic lands excluded');

            banner.innerHTML = `
                <span>⚡ Evaluated against <strong>${ownedCardNames.size.toLocaleString()} unique cards</strong> in your collection <span style="color: var(--text-muted); font-size: 0.8rem;">(${filterNotes.join(' • ')})</span></span>
                <span style="color: var(--text-muted); font-size: 0.82rem;">Showing decks matching threshold: <strong>${currentBuildThreshold > 0 ? `${currentBuildThreshold}%+` : 'All (0-100%)'}</strong> (${BUILD_DECKS_CATALOG.length} decks in catalog)</span>
            `;
            grid.appendChild(banner);

            const currSymbol = getMarketCurrency();

            // Compute statistics for each deck
            const computedDecks = BUILD_DECKS_CATALOG.map(deck => {
                const cardList = deck.cards || deck.keyCards || [];
                // Completely exclude basic lands from the lookup
                const nonBasicCards = cardList.filter(item => {
                    const cName = typeof item === 'string' ? item : (item.name || item.n || '');
                    const cNorm = normalizeCardName(cName);
                    const isBasic = item.isBasic || BASIC_LAND_NAMES.has(cNorm) || BASIC_LAND_NAMES.has(cName.toLowerCase());
                    return !isBasic;
                });

                const totalNonBasic = nonBasicCards.reduce((acc, item) => acc + (item.quantity || 1), 0);
                let ownedCount = 0;
                const missingCards = [];
                let estMissingCostUsd = 0;

                nonBasicCards.forEach(item => {
                    const cName = typeof item === 'string' ? item : (item.name || item.n);
                    const qty = item.quantity || 1;
                    const cPrice = typeof item === 'object' && (item.price || item.p) ? (item.price || item.p) : 0.75;
                    const cType = typeof item === 'object' && (item.type || item.t) ? (item.type || item.t) : 'Card';

                    const cNorm = normalizeCardName(cName);
                    const isOwned = ownedCardNames.has(cNorm) || ownedCardNames.has(cName.toLowerCase().trim());

                    if (isOwned) {
                        ownedCount += qty;
                    } else {
                        missingCards.push({ name: cName, price: cPrice, quantity: qty, type: cType });
                        estMissingCostUsd += (cPrice * qty);
                    }
                });

                const pct = totalNonBasic > 0 ? Math.round((ownedCount / totalNonBasic) * 100) : 100;
                const cmdrNorm = normalizeCardName(deck.commander);
                const ownsCommander = ownedCardNames.has(cmdrNorm) || ownedCardNames.has(deck.commander.toLowerCase().trim());

                // Currency conversion for display
                const costMultiplier = currentMarket === 'cardmarket' ? 0.92 : 1.0;
                const estMissingCostLocal = estMissingCostUsd * costMultiplier;

                return {
                    ...deck,
                    totalCards: totalNonBasic,
                    totalNonBasic,
                    ownedCount,
                    missingCards,
                    pctOwned: pct,
                    ownsCommander,
                    estMissingCostUsd,
                    estMissingCostLocal
                };
            });

            // Filter by Match Threshold
            let filtered = computedDecks;
            if (currentBuildThreshold > 0) {
                filtered = filtered.filter(d => d.pctOwned >= currentBuildThreshold);
            }

            // Filter by Precon visibility
            if (hidePrecons) {
                filtered = filtered.filter(d => d.type !== 'precon');
            }

            // Filter by Category
            if (currentBuildFilter === 'precon') {
                filtered = filtered.filter(d => d.type === 'precon');
            } else if (currentBuildFilter === 'edhrec') {
                filtered = filtered.filter(d => d.type === 'edhrec');
            } else if (currentBuildFilter === 'owned_cmdrs') {
                filtered = filtered.filter(d => d.ownsCommander);
            }

            // Filter by Search Query
            if (query) {
                filtered = filtered.filter(d =>
                    d.name.toLowerCase().includes(query) ||
                    d.commander.toLowerCase().includes(query) ||
                    (d.set && d.set.toLowerCase().includes(query)) ||
                    (d.theme && d.theme.toLowerCase().includes(query)) ||
                    d.colors.join('').toLowerCase().includes(query)
                );
            }

            // Sort
            if (sortMode === 'pct_desc') {
                filtered.sort((a, b) => b.pctOwned - a.pctOwned || a.estMissingCostLocal - b.estMissingCostLocal);
            } else if (sortMode === 'cost_asc') {
                filtered.sort((a, b) => a.estMissingCostLocal - b.estMissingCostLocal);
            } else if (sortMode === 'owned_desc') {
                filtered.sort((a, b) => b.ownedCount - a.ownedCount);
            }

            function renderDeckCards(deckList) {
                deckList.forEach(d => {
                    try {
                        const card = document.createElement('div');
                        card.className = 'build-deck-card';

                        const deckColors = Array.isArray(d.colors) ? d.colors : [];
                        const colorPips = deckColors.map(c => `<span class="badge" style="font-size: 0.72rem; padding: 1px 5px; font-weight: 800;">${c}</span>`).join(' ') || '<span class="badge" style="font-size:0.7rem;">Colorless</span>';
                        const isDrawerOpen = expandedMissingDrawers.has(d.id);
                        const safeName = (d.name || '').replace(/'/g, "\\'");
                        const safeCmdr = (d.commander || '').replace(/'/g, "\\'");
                        const bannerImg = d.imageUrl || (d.scryfallId ? `https://api.scryfall.com/cards/${d.scryfallId}?format=image&version=art_crop` : `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(d.commander)}&format=image&version=art_crop`);
                        const fallbackImg = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(d.commander)}&format=image&version=art_crop`;
                        const missingList = Array.isArray(d.missingCards) ? d.missingCards : [];
                        const costDisplay = (d.estMissingCostLocal || 0).toFixed(2);

                        card.innerHTML = `
                            <div class="build-deck-banner">
                                <img src="${bannerImg}" alt="${safeCmdr}" loading="lazy" class="build-deck-banner-img"
                                     onerror="this.onerror=null; this.src='${fallbackImg}';">
                                <div class="build-deck-banner-overlay">
                                    <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
                                        <span class="badge" style="background: rgba(15, 23, 42, 0.85); color: #f8fafc; font-size: 0.72rem; border: 1px solid rgba(255, 255, 255, 0.2);">
                                            ${d.type === 'precon' ? `Precon (${d.set})` : 'EDHREC Meta'}
                                        </span>
                                        ${d.ownsCommander ? `<span class="badge" style="background: rgba(16, 185, 129, 0.9); color: #fff; font-size: 0.72rem; font-weight: 800;">👑 Own Commander</span>` : ''}
                                        ${d.sourceUrl ? `<a href="${d.sourceUrl}" target="_blank" rel="noopener noreferrer" class="badge" style="background: rgba(15, 23, 42, 0.85); color: #38bdf8; text-decoration: none; border: 1px solid rgba(56, 189, 248, 0.35); font-size: 0.72rem;" title="View official decklist source / EDHREC">↗ Source</a>` : ''}
                                    </div>
                                    <div style="display: flex; gap: 0.25rem;">
                                        ${colorPips}
                                    </div>
                                </div>
                            </div>
                            <div style="padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; flex: 1;">
                                <div>
                                    <h4 style="margin: 0; font-size: 1.08rem; font-weight: 800;">${d.name}</h4>
                                    <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.2rem;">Commander: <strong>${d.commander}</strong>${d.theme ? ` • <span style="color: #94a3b8;">${d.theme}</span>` : ''}</div>
                                </div>

                                <!-- Progress Bar -->
                                <div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; margin-bottom: 0.35rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Match Progress:</span>
                                        <span style="font-weight: 800; color: ${d.pctOwned >= 75 ? '#34d399' : (d.pctOwned >= 50 ? '#38bdf8' : (d.pctOwned >= 25 ? '#f59e0b' : '#94a3b8'))}; font-size: 0.95rem;">
                                            ${d.pctOwned}% (${d.ownedCount}/${d.totalNonBasic} cards)
                                        </span>
                                    </div>
                                    <div class="stat-dist-track" style="height: 8px;">
                                        <div class="stat-dist-fill" style="width: ${d.pctOwned}%; background: ${d.pctOwned >= 75 ? '#10b981' : (d.pctOwned >= 50 ? '#0284c7' : (d.pctOwned >= 25 ? '#f59e0b' : '#64748b'))};"></div>
                                    </div>
                                    <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.2rem;">Basic lands excluded from deck matching</div>

                                    <!-- Cost to Finish & Missing Cards Link -->
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem; font-size: 0.82rem;">
                                        <div>
                                            <span style="color: var(--text-muted);">Est. Cost to Finish:</span>
                                            <strong style="color: #34d399; margin-left: 3px;">${currSymbol}${costDisplay}</strong>
                                        </div>
                                        <div>
                                            ${missingList.length > 0 ? `
                                                <button type="button" class="secondary-btn" style="padding: 2px 8px; font-size: 0.75rem;" onclick="toggleMissingDrawer('${d.id}')">
                                                    ${isDrawerOpen ? '▲ Hide Missing' : `▼ Missing (${missingList.length})`}
                                                </button>
                                            ` : '<span style="color:#34d399; font-weight:700;">🎉 100% Owned!</span>'}
                                        </div>
                                    </div>

                                    <!-- Collapsible Missing Cards Drawer -->
                                    ${isDrawerOpen && missingList.length > 0 ? `
                                        <div style="margin-top: 0.75rem; padding: 0.75rem; background: rgba(0,0,0,0.25); border-radius: 8px; border: 1px solid var(--border-color); max-height: 220px; overflow-y: auto;">
                                            <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.4rem; text-transform: uppercase;">
                                                Missing Cards to Complete (${missingList.length}):
                                            </div>
                                            <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                                                ${missingList.map(c => `
                                                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; padding: 2px 4px; border-radius: 4px; background: rgba(255,255,255,0.02);">
                                                        <span class="hover-card-link" onmouseenter="bindHoverName(this, '${(c.name || '').replace(/'/g, "\\'")}')" style="color: var(--text-color);">${c.quantity && c.quantity > 1 ? `${c.quantity}x ` : ''}${c.name}</span>
                                                        <span style="color: var(--text-muted); font-size: 0.74rem;">${currSymbol}${((c.price || 0) * (currentMarket === 'cardmarket' ? 0.92 : 1.0)).toFixed(2)}</span>
                                                    </div>
                                                `).join('')}
                                            </div>
                                        </div>
                                    ` : ''}
                                </div>

                                <!-- Action Buttons (AI Optimizer removed as requested) -->
                                <div style="display: flex; gap: 0.45rem; margin-top: auto; padding-top: 0.5rem; flex-wrap: wrap;">
                                    <button type="button" class="secondary-btn" style="flex: 1; padding: 0.45rem 0.65rem; font-size: 0.78rem;" onclick="openBuildDecklistModal('${d.id}')">
                                        📜 View Decklist
                                    </button>
                                    <button type="button" class="secondary-btn" style="flex: 1; padding: 0.45rem 0.65rem; font-size: 0.78rem;" onclick="addMissingCardsToWants('${d.id}')">
                                        📋 Add Missing
                                    </button>
                                    <button type="button" class="secondary-btn" style="padding: 0.45rem 0.65rem; font-size: 0.78rem;" onclick="loadBuildDeckIntoComparator('${d.id}', '${safeName}')">
                                        🔍 Compare
                                    </button>
                                    ${d.sourceUrl ? `
                                        <a href="${d.sourceUrl}" target="_blank" rel="noopener noreferrer" class="secondary-btn" style="padding: 0.45rem 0.65rem; font-size: 0.78rem; text-decoration: none; display: inline-flex; align-items: center;" title="Open original deck source">
                                            ↗ Source
                                        </a>
                                    ` : ''}
                                </div>
                            </div>
                        `;

                        grid.appendChild(card);
                    } catch (cardErr) {
                        console.warn('Error rendering deck card:', d.name, cardErr);
                    }
                });
            }

            if (filtered.length === 0) {
                const closestDecks = [...computedDecks].sort((a, b) => b.pctOwned - a.pctOwned).slice(0, 6);
                const notice = document.createElement('div');
                notice.style.gridColumn = '1 / -1';
                notice.style.padding = '2rem 1.5rem';
                notice.style.textAlign = 'center';
                notice.style.color = 'var(--text-muted)';
                notice.style.background = 'rgba(245, 158, 11, 0.08)';
                notice.style.borderRadius = '12px';
                notice.style.border = '1px dashed rgba(245, 158, 11, 0.35)';
                notice.style.marginBottom = '1.25rem';
                notice.innerHTML = `
                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">💡</div>
                    <h4 style="margin: 0 0 0.5rem 0; font-size: 1.15rem; color: var(--text-color);">No decks currently meet your <strong>${currentBuildThreshold}%+</strong> threshold</h4>
                    <p style="font-size: 0.88rem; max-width: 520px; margin: 0 auto 1.25rem auto;">
                        Here are your <strong>closest matching decks</strong> below sorted by completion %, or you can lower the threshold to explore all 180+ precons & archetypes!
                    </p>
                    <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
                        <button type="button" class="main-btn" onclick="setBuildThreshold(25)">Show 25%+ Matches</button>
                        <button type="button" class="secondary-btn" onclick="setBuildThreshold(0)">Show All 180+ Decks (0-100%)</button>
                    </div>
                `;
                grid.appendChild(notice);

                renderDeckCards(closestDecks);
                return;
            }

            renderDeckCards(filtered);
        }

        function renderBuildUpgrades() {
            const container = document.getElementById('buildUpgradesContent');
            if (!container) return;

            let ownedCardsList = (cachedParsedCsv && cachedParsedCsv.length > 0) ? cachedParsedCsv : (currentCollectionData || []);
            if (ownedCardsList.length === 0) {
                container.innerHTML = `
                    <div style="padding: 3rem 1.5rem; text-align: center; color: var(--text-muted); background: rgba(255, 255, 255, 0.02); border: 1px dashed var(--border-color); border-radius: 12px;">
                        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📂</div>
                        <h3 style="margin: 0 0 0.5rem 0;">Load a Collection First</h3>
                        <p style="font-size: 0.9rem; max-width: 480px; margin: 0 auto 1rem auto;">Enter your Archidekt collection ID or upload your collection CSV to discover cards you own that can upgrade your decks.</p>
                        <button type="button" class="main-btn" onclick="document.getElementById('collectionId').focus()">Enter Collection ID</button>
                    </div>
                `;
                return;
            }

            // Check if any decks are compared
            const availableDecks = (currentDecksData && currentDecksData.length > 0) ? currentDecksData : [];

            if (availableDecks.length === 0) {
                container.innerHTML = `
                    <div style="padding: 3rem 1.5rem; text-align: center; color: var(--text-muted); background: rgba(255, 255, 255, 0.02); border: 1px dashed var(--border-color); border-radius: 12px;">
                        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🃏</div>
                        <h3 style="margin: 0 0 0.5rem 0;">No Compared Decks Loaded</h3>
                        <p style="font-size: 0.9rem; max-width: 520px; margin: 0 auto 1.25rem auto;">
                            Add your decks in the <strong>Deck Comparator</strong> tab, and this section will automatically cross-reference your collection to identify powerful, high-synergy staples and card upgrades you already own!
                        </p>
                        <button type="button" class="main-btn" onclick="switchTab('deck')">Go to Deck Comparator</button>
                    </div>
                `;
                return;
            }

            // High-power staples lookup list
            const STAPLES_SET = new Set([
                'sol ring', 'arcane signet', 'demonic tutor', 'vampiric tutor', 'rhystic study', 'smothering tithe',
                'cyclonic rift', 'heroic intervention', 'teferi\'s protection', 'toxic deluge', 'fierce guardianship',
                'deflecting swat', 'jeska\'s will', 'sylvan library', 'mana crypt', 'mana vault', 'skullclamp',
                'lightning greaves', 'swiftfoot boots', 'beast within', 'chaos warp', 'swords to plowshares',
                'path to exile', 'counterspell', 'dovin\'s veto', 'assassin\'s trophy', 'culling ritual',
                'force of will', 'force of negation', 'esper sentinel', 'dockside extortionist', 'bolas\'s citadel'
            ]);

            container.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.25rem;">
                    <div>
                        <h3 style="margin: 0; font-size: 1.25rem; font-weight: 800;">Deck Upgrade Engine</h3>
                        <div style="font-size: 0.82rem; color: var(--text-muted);">Scanning your unused cards for direct upgrades & staples matching your deck's colors</div>
                    </div>
                </div>
            `;

            availableDecks.forEach(deck => {
                const deckSection = document.createElement('div');
                deckSection.style.background = 'rgba(0,0,0,0.15)';
                deckSection.style.border = '1px solid var(--border-color)';
                deckSection.style.borderRadius = '12px';
                deckSection.style.padding = '1.25rem';
                deckSection.style.marginBottom = '1.5rem';

                const deckCardNames = new Set((deck.cards || []).map(c => (c.name || '').toLowerCase().trim()));
                const deckColors = new Set((deck.colors || []).map(c => c.toUpperCase()));

                // Find candidate upgrades from unused collection cards
                const candidateUpgrades = [];
                ownedCardsList.forEach(item => {
                    const cName = (item.name || item.card?.name || item.card?.oracleCard?.name || '').trim();
                    const cLower = cName.toLowerCase();
                    if (!cName || deckCardNames.has(cLower)) return;

                    const isStaple = STAPLES_SET.has(cLower);
                    const finish = item.finish || item.card_finish || 'Normal';
                    const price = item.priceUsd || item.unitPriceUsd || (item.prices ? parseFloat(item.prices.usd) : 0) || item.price || 0;
                    const itemType = item.typeLine || item.type_line || item.card?.type_line || item.category || 'Card';

                    if (isStaple || price >= 5.0) {
                        candidateUpgrades.push({
                            name: cName,
                            finish,
                            price,
                            isStaple,
                            type: itemType,
                            reason: isStaple ? 'Elite Commander Staple in your collection' : 'High-Value Card sitting unused in your collection'
                        });
                    }
                });

                // Deduplicate by name
                const uniqueUpgradesMap = new Map();
                candidateUpgrades.forEach(u => {
                    if (!uniqueUpgradesMap.has(u.name.toLowerCase())) {
                        uniqueUpgradesMap.set(u.name.toLowerCase(), u);
                    }
                });
                const upgradesList = Array.from(uniqueUpgradesMap.values()).slice(0, 8);

                const curr = getMarketCurrency();

                deckSection.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.75rem;">
                        <div>
                            <h4 style="margin: 0; font-size: 1.15rem; font-weight: 800; display: flex; align-items: center; gap: 0.45rem;">
                                <span>🎯</span> Upgrades for: ${deck.name}
                            </h4>
                            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem;">
                                Found <strong>${upgradesList.length} unused cards</strong> in your collection that could power up this deck.
                            </div>
                        </div>
                        <button type="button" class="secondary-btn ai-btn" style="font-size: 0.8rem;" onclick="openAiOptimizerForDeck('${deck.id}')">
                            <span>✨ AI Deep Optimizer</span>
                        </button>
                    </div>

                    ${upgradesList.length > 0 ? `
                        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.85rem;">
                            ${upgradesList.map(u => `
                                <div class="build-upgrade-card">
                                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                        <div>
                                            <strong style="color: var(--text-color); cursor: pointer;" onmouseenter="showHoverPreview(event, '${escapeHtml(u.name)}')" onmouseleave="hideHoverPreview()">
                                                ${u.name}
                                            </strong>
                                            <div style="font-size: 0.74rem; color: #38bdf8; margin-top: 2px;">${u.reason}</div>
                                        </div>
                                        <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-size: 0.72rem;">${curr}${u.price.toFixed(2)}</span>
                                    </div>
                                    <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; gap: 0.4rem; align-items: center;">
                                        <span>Status: Owned in binder</span>
                                        ${u.finish && u.finish !== 'Normal' ? `<span class="badge badge-foil" style="font-size: 0.68rem;">${u.finish}</span>` : ''}
                                    </div>
                                    <button type="button" class="secondary-btn" style="padding: 0.35rem 0.55rem; font-size: 0.75rem; margin-top: auto;" onclick="addToTradeBinder({ name: '${escapeHtml(u.name)}', type: 'have', priceUsd: ${u.price} }); showToast('Added ${escapeHtml(u.name)} to trade binder!');">
                                        <span>➕ Add to Trade Have</span>
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    ` : `
                        <div style="color: var(--text-muted); font-size: 0.85rem; padding: 0.5rem 0;">
                            Your deck is already running the top matching staples in your collection!
                        </div>
                    `}
                `;

                container.appendChild(deckSection);
            });
        }

        function renderBuildCommanders() {
            const container = document.getElementById('buildCommandersContent');
            if (!container) return;

            let ownedCardsList = (cachedParsedCsv && cachedParsedCsv.length > 0) ? cachedParsedCsv : (currentCollectionData || []);
            if (ownedCardsList.length === 0) {
                container.innerHTML = `
                    <div style="padding: 3rem 1.5rem; text-align: center; color: var(--text-muted); background: rgba(255, 255, 255, 0.02); border: 1px dashed var(--border-color); border-radius: 12px;">
                        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">👑</div>
                        <h3 style="margin: 0 0 0.5rem 0;">Load a Collection First</h3>
                        <p style="font-size: 0.9rem; max-width: 480px; margin: 0 auto 1rem auto;">Enter your Archidekt collection ID or upload your CSV to find all legendary commanders in your collection.</p>
                        <button type="button" class="main-btn" onclick="document.getElementById('collectionId').focus()">Enter Collection ID</button>
                    </div>
                `;
                return;
            }

            // Find all commanders in collection
            const commanderMap = new Map();
            ownedCardsList.forEach(item => {
                const name = (item.name || item.card?.name || item.card?.oracleCard?.name || '').trim();
                const typeLine = (item.typeLine || item.type_line || item.card?.type_line || item.card?.oracleCard?.type_line || (item.card?.oracleCard?.types ? [...(item.card?.oracleCard?.superTypes || []), ...(item.card?.oracleCard?.types || [])].join(' ') : '') || item.category || '').toLowerCase();
                const isCommander = Boolean(item.isCommander) || (typeLine.includes('legendary') && (typeLine.includes('creature') || typeLine.includes('planeswalker') || typeLine.includes('can be your commander')));

                if (isCommander && name) {
                    const rawColors = item.colors || item.card?.oracleCard?.colors || item.card?.colors || [];
                    const normColors = Array.isArray(rawColors) ? rawColors.map(c => {
                        const map = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', w: 'W', u: 'U', b: 'B', r: 'R', g: 'G' };
                        return map[String(c).toLowerCase()] || String(c).toUpperCase();
                    }) : [];

                    const cleanNameKey = name.toLowerCase();
                    if (!commanderMap.has(cleanNameKey)) {
                        commanderMap.set(cleanNameKey, {
                            name,
                            colors: normColors,
                            type: item.typeLine || item.type_line || item.card?.type_line || 'Legendary Creature',
                            imageUrl: item.image_url || item.imageUrl || (item.card?.image_uris?.normal || ''),
                            count: Number(item.owned ?? item.quantity ?? item.count ?? 1)
                        });
                    } else {
                        commanderMap.get(cleanNameKey).count += Number(item.owned ?? item.quantity ?? item.count ?? 1);
                    }
                }
            });

            const commandersList = Array.from(commanderMap.values());

            container.innerHTML = `
                <div style="margin-bottom: 1.25rem;">
                    <h3 style="margin: 0; font-size: 1.25rem; font-weight: 800; display: flex; align-items: center; gap: 0.45rem;">
                        <span>👑</span> Commanders in Your Collection (${commandersList.length})
                    </h3>
                    <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.2rem;">
                        Legendary creatures and planeswalkers you own ready to lead a new Commander deck!
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem;">
                    ${commandersList.map(cmd => {
                        const colorsStr = (cmd.colors || []).join('');
                        const pips = (cmd.colors || []).map(c => `<span class="badge" style="font-size: 0.72rem; padding: 1px 5px; font-weight: 800;">${c}</span>`).join(' ') || '<span class="badge" style="font-size:0.7rem;">Colorless</span>';
                        return `
                            <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 10px; padding: 1rem; display: flex; flex-direction: column; gap: 0.65rem;">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                    <div>
                                        <strong style="font-size: 0.95rem; cursor: pointer;" onmouseenter="showHoverPreview(event, '${escapeHtml(cmd.name)}')" onmouseleave="hideHoverPreview()">
                                            ${cmd.name}
                                        </strong>
                                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">${cmd.type}</div>
                                    </div>
                                    <div style="display: flex; gap: 2px;">${pips}</div>
                                </div>
                                <div style="display: flex; gap: 0.4rem; margin-top: auto; padding-top: 0.4rem;">
                                    <button type="button" class="main-btn" style="flex: 1; padding: 0.35rem 0.5rem; font-size: 0.75rem;" onclick="startBuildingAroundCommander('${escapeHtml(cmd.name)}', '${colorsStr}')">
                                        <span>⚡ Build Around</span>
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        function startBuildingAroundCommander(commanderName, colorsStr) {
            const customId = `custom:${Date.now()}`;
            const text = `1 ${commanderName}\n1 Sol Ring\n1 Arcane Signet\n1 Command Tower`;
            customPastedDecks.length = 0;
            customPastedDecks.push({
                id: customId,
                name: `${commanderName} Deck`,
                cards: parseDecklistText(text),
                text: text
            });
            activeDeckIds.clear();
            activeDeckIds.add(customId);
            deckNames[customId] = `${commanderName} Deck`;
            renderDeckChips();
            saveDecksState();
            switchTab('deck');
            showToast(`Loaded "${commanderName}" into Deck Comparator!`);
            runComparison();
        }

        function openAiOptimizerForDeck(deckId) {
            const deck = currentDecksData.find(d => String(d.id) === String(deckId));
            if (deck) {
                openAiOptimizer({
                    name: deck.name,
                    format: 'Commander',
                    colors: deck.colors,
                    commander: deck.commander || [],
                    cards: (deck.cards || []).map(c => ({ name: c.name, cleanName: c.name.toLowerCase(), quantity: c.quantity || 1, category: 'Cards' }))
                });
            }
        }

        function openBuyMissingModalForBuild(deckId) {
            const deck = findBuildDeck(deckId);
            if (!deck) return;

            let ownedCardsList = (cachedParsedCsv && cachedParsedCsv.length > 0) ? cachedParsedCsv : (currentCollectionData || []);
            const ownedCardNames = new Set();
            ownedCardsList.forEach(it => {
                const rawName = it.name || it.card?.name || it.card?.oracleCard?.name || '';
                const n = normalizeCardName(rawName);
                if (n) ownedCardNames.add(n);
                ownedCardNames.add(rawName.toLowerCase().trim());
            });

            const missingLines = [];
            const cardList = deck.cards || deck.keyCards || [];
            cardList.forEach(item => {
                const cName = typeof item === 'string' ? item : (item.name || item.n);
                const cNorm = normalizeCardName(cName);
                const isBasic = item.isBasic || BASIC_LAND_NAMES.has(cNorm) || BASIC_LAND_NAMES.has(cName.toLowerCase());
                if (isBasic) return; // Skip basic lands

                if (!ownedCardNames.has(cNorm) && !ownedCardNames.has(cName.toLowerCase().trim())) {
                    const qty = item.quantity || 1;
                    missingLines.push(`${qty} ${cName}`);
                }
            });

            if (missingLines.length === 0) {
                showToast("You already own all cards for this deck! 🎉");
                return;
            }

            cachedTcgMissingText = missingLines.join('\n');
            cachedCardmarketMissingText = missingLines.join('\n');

            const modal = document.getElementById('buyMissingModal');
            const titleEl = document.getElementById('buyMissingModalTitle');
            const subEl = document.getElementById('buyMissingModalSubtitle');
            if (titleEl) titleEl.textContent = `Buy Missing Cards: ${deck.name}`;
            if (subEl) subEl.textContent = `${missingLines.length} cards required to complete this deck`;
            if (modal) modal.style.display = 'flex';
            updateBuyMissingDisplay();
        }

        function loadBuildDeckIntoComparator(deckId, deckName) {
            const deck = findBuildDeck(deckId);
            if (!deck) return;

            let text = deck.decklist;
            if (!text && deck.cards) {
                text = deck.cards.map(c => `${c.quantity || 1} ${c.name}`).join('\n');
            } else if (!text && deck.keyCards) {
                text = deck.keyCards.map(c => `1 ${c.n || c.name || c}`).join('\n');
            }

            const customId = `custom:${Date.now()}`;
            const parsedCards = parseDecklistText(text);
            customPastedDecks.length = 0;
            customPastedDecks.push({
                id: customId,
                name: deck.name,
                cards: parsedCards,
                text: text
            });
            activeDeckIds.clear();
            activeDeckIds.add(customId);
            deckNames[customId] = deck.name;
            renderDeckChips();
            saveDecksState();

            switchTab('deck');
            showToast(`Loaded "${deckName}" into Deck Comparator! Running comparison...`);
            runComparison();
        }

        function loadBuildDeckIntoAiOptimizer(deckId, deckName) {
            const deck = findBuildDeck(deckId);
            if (!deck) return;

            let text = deck.decklist;
            if (!text && deck.cards) {
                text = deck.cards.map(c => `${c.quantity || 1} ${c.name}`).join('\n');
            } else if (!text && deck.keyCards) {
                text = deck.keyCards.map(c => `1 ${c.n || c.name || c}`).join('\n');
            }
            const parsed = parseDecklistText(text);

            openAiOptimizer({
                name: deck.name,
                format: 'Commander',
                colors: deck.colors,
                commander: [deck.commander],
                cards: parsed.map(c => ({ name: c.name, cleanName: c.name.toLowerCase(), quantity: c.quantity || 1, category: 'Creatures' }))
            });
        }

        // ==================== BUY MISSING MODAL (TCGPLAYER / CARDMARKET) ====================
        let activeBuyMissingSource = 'deck'; // 'deck' | 'set'
        let activeBuyMarketplace = 'tcg'; // 'tcg' | 'cardmarket'
        let cachedTcgMissingText = '';
        let cachedCardmarketMissingText = '';

        function openBuyMissingModal(source = 'deck') {
            activeBuyMissingSource = source;
            const modal = document.getElementById('buyMissingModal');
            const titleEl = document.getElementById('buyMissingModalTitle');
            const subEl = document.getElementById('buyMissingModalSubtitle');

            let missingCards = [];

            if (source === 'deck') {
                titleEl.textContent = 'Buy Missing Deck Cards';
                if (activeDeckViewId === 'all') {
                    subEl.textContent = 'Missing cards across all compared decks';
                    const map = new Map();
                    if (currentDecksData && currentDecksData.length > 0) {
                        for (const deck of currentDecksData) {
                            for (const c of (deck.cards || [])) {
                                if (c.missing > 0) {
                                    const prev = map.get(c.name) || 0;
                                    map.set(c.name, Math.max(prev, c.missing));
                                }
                            }
                        }
                    }
                    for (const [name, qty] of map.entries()) {
                        missingCards.push({ name, quantity: qty });
                    }
                } else {
                    const deck = currentDecksData.find(d => String(d.id) === String(activeDeckViewId));
                    subEl.textContent = deck ? `Missing cards for ${deck.name}` : 'Missing cards for selected deck';
                    if (deck && Array.isArray(deck.cards)) {
                        missingCards = deck.cards
                            .filter(c => c.missing > 0)
                            .map(c => ({ name: c.name, quantity: c.missing }));
                    }
                }
            } else {
                const setName = selectedSet ? selectedSet.name : (currentSetData?.setInfo?.name || 'Set');
                const setCode = (selectedSet?.code || currentSetData?.setInfo?.code || '').toUpperCase();
                titleEl.textContent = `Buy Missing ${setName} Cards`;
                subEl.textContent = `All uncollected cards from set [${setCode}]`;

                if (currentSetData && Array.isArray(currentSetData.cards)) {
                    missingCards = currentSetData.cards
                        .filter(c => !c.is_collected)
                        .map(c => ({
                            name: c.name,
                            quantity: 1,
                            setCode: setCode,
                            collectorNumber: c.collector_number
                        }));
                }
            }

            if (missingCards.length === 0) {
                alert(`No missing cards found to purchase! You already own all cards for this ${source === 'deck' ? 'deck' : 'set'}. 🎉`);
                return;
            }

            // TCGPlayer format
            const tcgLines = missingCards.map(c => {
                const cleanName = c.name.replace(/\s*\/\/.*/, '');
                return c.setCode ? `${c.quantity} ${cleanName} [${c.setCode}]` : `${c.quantity} ${cleanName}`;
            });
            cachedTcgMissingText = tcgLines.join('\n');

            // Cardmarket format
            const cmLines = missingCards.map(c => {
                const cleanName = c.name.replace(/\s*\/\/.*/, '');
                return c.setCode ? `${c.quantity}x ${cleanName} (${c.setCode})` : `${c.quantity}x ${cleanName}`;
            });
            cachedCardmarketMissingText = cmLines.join('\n');

            switchBuyMarketTab(activeBuyMarketplace);
            modal.style.display = 'flex';
        }

        function closeBuyMissingModal() {
            document.getElementById('buyMissingModal').style.display = 'none';
        }

        function switchBuyMarketTab(market) {
            activeBuyMarketplace = market;
            const tcgBtn = document.getElementById('tabTcgPlayerBtn');
            const cmBtn = document.getElementById('tabCardmarketBtn');
            const textarea = document.getElementById('buyMissingTextarea');
            const helpEl = document.getElementById('buyMarketHelp');
            const openBtn = document.getElementById('openMarketplaceBtn');

            tcgBtn.classList.toggle('active', market === 'tcg');
            cmBtn.classList.toggle('active', market === 'cardmarket');

            if (market === 'tcg') {
                textarea.value = cachedTcgMissingText;
                helpEl.innerHTML = 'Copy the lines below and paste directly into <strong>TCGPlayer Mass Entry</strong> to add all missing cards to your cart at once.';
                openBtn.href = 'https://store.tcgplayer.com/massentry';
                openBtn.querySelector('span').textContent = '↗ Open TCGPlayer';
            } else {
                textarea.value = cachedCardmarketMissingText;
                helpEl.innerHTML = 'Copy the lines below and paste directly into <strong>Cardmarket Wants List</strong> mass entry.';
                openBtn.href = 'https://www.cardmarket.com/en/Magic/Wants';
                openBtn.querySelector('span').textContent = '↗ Open Cardmarket';
            }
            resetCopyBuyBtn();
        }

        function copyBuyMissingText() {
            const textarea = document.getElementById('buyMissingTextarea');
            if (!textarea.value) return;
            navigator.clipboard.writeText(textarea.value).then(() => {
                const icon = document.getElementById('copyBuyBtnIcon');
                const text = document.getElementById('copyBuyBtnText');
                if (icon) icon.textContent = '✓';
                if (text) text.textContent = 'Copied!';
                setTimeout(resetCopyBuyBtn, 2500);
            }).catch(() => {
                textarea.select();
                document.execCommand('copy');
                const icon = document.getElementById('copyBuyBtnIcon');
                const text = document.getElementById('copyBuyBtnText');
                if (icon) icon.textContent = '✓';
                if (text) text.textContent = 'Copied!';
                setTimeout(resetCopyBuyBtn, 2500);
            });
        }

        function resetCopyBuyBtn() {
            const icon = document.getElementById('copyBuyBtnIcon');
            const text = document.getElementById('copyBuyBtnText');
            if (icon) icon.textContent = '📋';
            if (text) text.textContent = 'Copy List';
        }

        // ==================== COLLECTION INSIGHTS DASHBOARD ====================
        function onOpenCollectionTab() {
            if (cachedInsightsData) {
                renderCollectionInsights(cachedInsightsData);
                return;
            }

            const collId = document.getElementById('collectionId').value.trim();
            const csvInput = document.getElementById('csvUpload');
            const hasCsv = (csvInput && csvInput.files.length > 0) || (cachedParsedCsv && cachedParsedCsv.length > 0);

            if (collId || hasCsv) {
                fetchCollectionInsights(false);
            } else {
                const emptyEl = document.getElementById('collectionInsightsEmpty');
                const dashEl = document.getElementById('collectionInsightsDashboard');
                const loadingEl = document.getElementById('collectionInsightsLoading');
                if (emptyEl) emptyEl.style.display = 'block';
                if (dashEl) dashEl.style.display = 'none';
                if (loadingEl) loadingEl.style.display = 'none';
            }
        }

        async function fetchCollectionInsights(forceFresh = false) {
            if (!forceFresh && cachedInsightsData) {
                renderCollectionInsights(cachedInsightsData);
                return;
            }

            let collectionId = document.getElementById('collectionId').value.trim();
            const collMatch = collectionId.match(/(?:archidekt\.com\/collections?\/)(\d+)/i);
            if (collMatch) collectionId = collMatch[1];
            else {
                const rawNum = collectionId.match(/\d+/);
                if (rawNum && /^\d+$/.test(collectionId)) collectionId = rawNum[0];
            }

            const csvInput = document.getElementById('csvUpload');
            const csvFile = csvInput && csvInput.files.length > 0 ? csvInput.files[0] : null;

            let collectionCsvData = cachedParsedCsv;
            if (csvFile && !collectionCsvData) {
                try {
                    const csvText = await readCSVFile(csvFile);
                    collectionCsvData = parseCSV(csvText);
                    cachedParsedCsv = collectionCsvData;
                    localStorage.setItem('archidekt_cachedCsvData', JSON.stringify(collectionCsvData));
                } catch (e) {
                    alert("Error parsing CSV: " + e.message);
                    return;
                }
            }

            if (!collectionId && !collectionCsvData) {
                document.getElementById('collectionInsightsEmpty').style.display = 'block';
                document.getElementById('collectionInsightsDashboard').style.display = 'none';
                document.getElementById('collectionInsightsLoading').style.display = 'none';
                return;
            }

            document.getElementById('collectionInsightsEmpty').style.display = 'none';
            document.getElementById('collectionInsightsDashboard').style.display = 'none';
            document.getElementById('collectionInsightsLoading').style.display = 'block';

            try {
                let response = await fetch('/getCollectionInsights', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        collectionId,
                        collectionData: collectionCsvData
                    })
                });

                if (!response.ok) {
                    response = await fetch('https://us-central1-commander-challenge.cloudfunctions.net/getCollectionInsights', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            collectionId,
                            collectionData: collectionCsvData
                        })
                    });
                }

                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || `Server returned status ${response.status}`);
                }

                const data = await response.json();
                cachedInsightsData = data;
                localStorage.setItem('archidekt_cachedInsights', JSON.stringify(data));
                renderCollectionInsights(data);
            } catch (err) {
                alert(`Could not generate Collection Insights: ${err.message}`);
                document.getElementById('collectionInsightsEmpty').style.display = 'block';
            } finally {
                document.getElementById('collectionInsightsLoading').style.display = 'none';
            }
        }

        function renderCollectionInsights(data) {
            if (!data || !data.summary) return;
            const { summary, crownJewels, colorDistribution, typeDistribution, rarityDistribution, priceBrackets, staples } = data;

            document.getElementById('collectionInsightsEmpty').style.display = 'none';
            document.getElementById('collectionInsightsLoading').style.display = 'none';
            const dashEl = document.getElementById('collectionInsightsDashboard');
            dashEl.style.display = 'block';

            // Facts Grid - update based on active global market
            const curr = getMarketCurrency();
            const primaryTotal = currentMarket === 'cardmarket' ? summary.totalValueEur : summary.totalValueUsd;
            const primaryValEl = document.getElementById('factTotalValuePrimary');
            if (primaryValEl) {
                primaryValEl.textContent = `${curr}${primaryTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
            const activeMarketEl = document.getElementById('factActiveMarketName');
            if (activeMarketEl) {
                activeMarketEl.textContent = getMarketDisplayName();
            }

            document.getElementById('factUniqueCards').textContent = summary.uniqueCards.toLocaleString();
            document.getElementById('factTotalCopies').textContent = summary.totalCopies.toLocaleString();
            document.getElementById('factAvailableCopies').textContent = summary.availableCopies.toLocaleString();
            document.getElementById('factStaplesOwned').textContent = `${summary.ownedStaplesCount} / ${summary.totalStaplesTracked}`;

            // 1. Crown Jewels
            const jewelsContainer = document.getElementById('crownJewelsGrid');
            jewelsContainer.innerHTML = '';
            if (Array.isArray(crownJewels) && crownJewels.length > 0) {
                // Sort jewels dynamically based on the active market valuation for the card's specific finish
                const sortedJewels = [...crownJewels].sort((a, b) => {
                    const priceA = getCardMarketNumericPrice(a.prices, a.finish) || (currentMarket === 'cardmarket' ? (a.priceEur || 0) : (a.priceUsd || 0));
                    const priceB = getCardMarketNumericPrice(b.prices, b.finish) || (currentMarket === 'cardmarket' ? (b.priceEur || 0) : (b.priceUsd || 0));
                    return priceB - priceA;
                });

                sortedJewels.forEach(c => {
                    const cardDiv = document.createElement('div');
                    cardDiv.className = 'crown-jewel-card';

                    const finish = c.finish || 'Normal';
                    const unitPrice = getCardMarketNumericPrice(c.prices, finish) || (currentMarket === 'cardmarket' ? (c.priceEur || 0) : (c.priceUsd || 0));
                    const itemTotal = unitPrice * (c.quantity || 1);

                    const thumb = document.createElement('img');
                    thumb.className = 'crown-jewel-thumb';
                    thumb.src = c.imageUrl;
                    thumb.alt = c.name;
                    thumb.loading = 'lazy';
                    thumb.onclick = (e) => openInScryfall(c.name, e);
                    bindImageHover(thumb, c.name, c.imageUrl);

                    const nameRow = document.createElement('div');
                    nameRow.style.fontWeight = '700';
                    nameRow.style.fontSize = '0.95rem';
                    nameRow.style.overflow = 'hidden';
                    nameRow.style.textOverflow = 'ellipsis';
                    nameRow.style.whiteSpace = 'nowrap';
                    nameRow.textContent = c.name;
                    nameRow.title = `${c.name} (Click for Scryfall)`;
                    nameRow.style.cursor = 'pointer';
                    nameRow.onclick = (e) => openInScryfall(c.name, e);

                    const metaRow = document.createElement('div');
                    metaRow.style.display = 'flex';
                    metaRow.style.justifyContent = 'space-between';
                    metaRow.style.alignItems = 'center';
                    metaRow.style.fontSize = '0.8rem';
                    metaRow.style.flexWrap = 'wrap';
                    metaRow.style.gap = '0.25rem';

                    const rarityBadge = `<span class="badge badge-${c.rarity}">${c.rarity.toUpperCase()}</span>`;
                    const setBadge = c.setCode ? `<span class="badge badge-code">${c.setCode}${c.collectorNumber ? ` #${c.collectorNumber}` : ''}</span>` : '';
                    const finishBadge = renderFinishBadge(finish);
                    const priceBadge = `<span style="font-weight: 800; color: #34d399; font-size: 1rem;">${curr}${unitPrice.toFixed(2)}</span>`;

                    metaRow.innerHTML = `<div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">${rarityBadge} ${setBadge} ${finishBadge}</div>${priceBadge}`;

                    const copiesRow = document.createElement('div');
                    copiesRow.style.fontSize = '0.78rem';
                    copiesRow.style.color = 'var(--text-muted)';
                    copiesRow.style.display = 'flex';
                    copiesRow.style.justifyContent = 'space-between';
                    copiesRow.style.alignItems = 'center';
                    copiesRow.innerHTML = `<span>Owned: <strong>${c.quantity}x</strong></span> <span>Total: ${curr}${itemTotal.toFixed(2)}</span>`;

                    const actionRow = document.createElement('div');
                    actionRow.style.display = 'flex';
                    actionRow.style.justifyContent = 'flex-end';
                    actionRow.style.marginTop = '0.2rem';
                    const tradeBtn = document.createElement('button');
                    tradeBtn.type = 'button';
                    tradeBtn.className = 'binder-quick-btn have-btn';
                    tradeBtn.style.padding = '0.2rem 0.6rem';
                    tradeBtn.style.fontSize = '0.74rem';
                    tradeBtn.innerHTML = '+ Trade';
                    tradeBtn.onclick = (e) => {
                        e.stopPropagation();
                        addToTradeBinder({
                            name: c.name,
                            setCode: c.setCode || '',
                            collectorNumber: c.collectorNumber || '',
                            finish: c.finish || 'Normal',
                            isFoil: Boolean(c.isFoil),
                            priceUsd: c.priceUsd || 0,
                            imageUrl: c.imageUrl || '',
                            prices: c.prices || null,
                            type: 'have'
                        });
                    };
                    actionRow.appendChild(tradeBtn);

                    cardDiv.appendChild(thumb);
                    cardDiv.appendChild(nameRow);
                    cardDiv.appendChild(metaRow);
                    cardDiv.appendChild(copiesRow);
                    cardDiv.appendChild(actionRow);
                    jewelsContainer.appendChild(cardDiv);
                });
            } else {
                jewelsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; padding: 1rem 0;">No high-value cards detected or prices still syncing.</div>';
            }

            // 2. Color Distribution
            const colorContainer = document.getElementById('colorDistContainer');
            colorContainer.innerHTML = '';
            const colorTheme = {
                W: { color: '#fef08a', label: 'White' },
                U: { color: '#60a5fa', label: 'Blue' },
                B: { color: '#94a3b8', label: 'Black' },
                R: { color: '#f87171', label: 'Red' },
                G: { color: '#4ade80', label: 'Green' },
                multi: { color: '#fbbf24', label: 'Multicolor' },
                colorless: { color: '#cbd5e1', label: 'Colorless' },
                land: { color: '#a78bfa', label: 'Lands' }
            };

            // If backend returned zero non-colorless cards, synthesize from available collection cards
            let effectiveColorDist = colorDistribution || {};
            const hasValidColorData = Object.entries(effectiveColorDist).some(([k, item]) => k !== 'colorless' && k !== 'land' && (item.copies || 0) > 0);
            if (!hasValidColorData && ((data.collection && data.collection.length > 0) || (currentCollectionData && currentCollectionData.length > 0))) {
                const pool = (data.collection && data.collection.length > 0) ? data.collection : currentCollectionData;
                const computed = {
                    W: { name: 'White', count: 0, copies: 0 },
                    U: { name: 'Blue', count: 0, copies: 0 },
                    B: { name: 'Black', count: 0, copies: 0 },
                    R: { name: 'Red', count: 0, copies: 0 },
                    G: { name: 'Green', count: 0, copies: 0 },
                    multi: { name: 'Multicolor', count: 0, copies: 0 },
                    colorless: { name: 'Colorless', count: 0, copies: 0 },
                    land: { name: 'Lands', count: 0, copies: 0 }
                };
                pool.forEach(card => {
                    const copies = Math.max(1, parseInt(card.quantity || card.owned || card.copies) || 1);
                    const t = (card.typeLine || card.type_line || card.type || '').toLowerCase();
                    let rawC = card.colors || card.colorIdentity || card.color_identity || [];
                    if (typeof rawC === 'string') rawC = rawC.replace(/[{}]/g, '').split(/[,/ ]+/).filter(Boolean);
                    const parsedColors = new Set();
                    (Array.isArray(rawC) ? rawC : []).forEach(c => {
                        const str = String(c).trim().toLowerCase();
                        if (str === 'w' || str === 'white') parsedColors.add('W');
                        else if (str === 'u' || str === 'blue') parsedColors.add('U');
                        else if (str === 'b' || str === 'black') parsedColors.add('B');
                        else if (str === 'r' || str === 'red') parsedColors.add('R');
                        else if (str === 'g' || str === 'green') parsedColors.add('G');
                    });
                    if (t.includes('land')) {
                        computed.land.count++;
                        computed.land.copies += copies;
                    } else if (parsedColors.size > 1) {
                        computed.multi.count++;
                        computed.multi.copies += copies;
                    } else if (parsedColors.size === 1) {
                        const colKey = Array.from(parsedColors)[0];
                        if (computed[colKey]) {
                            computed[colKey].count++;
                            computed[colKey].copies += copies;
                        } else {
                            computed.colorless.count++;
                            computed.colorless.copies += copies;
                        }
                    } else {
                        computed.colorless.count++;
                        computed.colorless.copies += copies;
                    }
                });
                effectiveColorDist = computed;
            }

            const totalColorCards = Math.max(1, Object.values(effectiveColorDist).reduce((sum, item) => sum + (item.copies || 0), 0));
            for (const [key, item] of Object.entries(effectiveColorDist)) {
                const pct = ((item.copies / totalColorCards) * 100).toFixed(1);
                const theme = colorTheme[key] || { color: 'var(--primary)', label: item.name || key };
                const row = document.createElement('div');
                row.className = 'stat-dist-row';
                row.innerHTML = `
                    <span style="width: 85px; font-weight: 600;">${theme.label}</span>
                    <div class="stat-dist-track">
                        <div class="stat-dist-fill" style="width: ${pct}%; background-color: ${theme.color};"></div>
                    </div>
                    <span style="width: 75px; text-align: right; color: var(--text-muted);">${item.copies} <span style="font-size: 0.75rem;">(${pct}%)</span></span>
                `;
                colorContainer.appendChild(row);
            }

            // 3. Type Distribution
            const typeContainer = document.getElementById('typeDistContainer');
            typeContainer.innerHTML = '';
            const totalTypeCards = Math.max(1, Object.values(typeDistribution || {}).reduce((sum, item) => sum + (item.copies || 0), 0));
            for (const [key, item] of Object.entries(typeDistribution || {})) {
                if (item.copies === 0) continue;
                const pct = ((item.copies / totalTypeCards) * 100).toFixed(1);
                const row = document.createElement('div');
                row.className = 'stat-dist-row';
                row.innerHTML = `
                    <span style="width: 95px; font-weight: 600;">${item.name}</span>
                    <div class="stat-dist-track">
                        <div class="stat-dist-fill" style="width: ${pct}%; background-color: var(--primary);"></div>
                    </div>
                    <span style="width: 75px; text-align: right; color: var(--text-muted);">${item.copies} <span style="font-size: 0.75rem;">(${pct}%)</span></span>
                `;
                typeContainer.appendChild(row);
            }

            // 4. Rarity Distribution
            const rarityContainer = document.getElementById('rarityDistContainer');
            rarityContainer.innerHTML = '';
            const rarityColors = {
                mythic: 'var(--rarity-mythic)',
                rare: 'var(--rarity-rare)',
                uncommon: 'var(--rarity-uncommon)',
                common: 'var(--rarity-common)'
            };
            const totalRarityCopies = Math.max(1, Object.values(rarityDistribution || {}).reduce((sum, item) => sum + (item.copies || 0), 0));
            for (const [key, item] of Object.entries(rarityDistribution || {})) {
                const pct = ((item.copies / totalRarityCopies) * 100).toFixed(1);
                const col = rarityColors[key] || 'var(--primary)';
                const row = document.createElement('div');
                row.className = 'stat-dist-row';
                row.innerHTML = `
                    <span style="width: 85px; font-weight: 700; text-transform: capitalize;">${key}</span>
                    <div class="stat-dist-track">
                        <div class="stat-dist-fill" style="width: ${pct}%; background-color: ${col};"></div>
                    </div>
                    <span style="width: 105px; text-align: right; color: var(--text-muted);">${item.copies} <span style="font-size: 0.75rem; color: #34d399;">($${(item.valueUsd || 0).toFixed(0)})</span></span>
                `;
                rarityContainer.appendChild(row);
            }

            // 5. Price Brackets
            const priceContainer = document.getElementById('priceTierContainer');
            priceContainer.innerHTML = '';
            const totalPricedCopies = Math.max(1, Object.values(priceBrackets || {}).reduce((sum, item) => sum + (item.copies || 0), 0));
            for (const [key, item] of Object.entries(priceBrackets || {})) {
                const pct = ((item.copies / totalPricedCopies) * 100).toFixed(1);
                const row = document.createElement('div');
                row.className = 'stat-dist-row';
                row.innerHTML = `
                    <span style="width: 75px; font-weight: 600;">${item.label}</span>
                    <div class="stat-dist-track">
                        <div class="stat-dist-fill" style="width: ${pct}%; background-color: #38bdf8;"></div>
                    </div>
                    <span style="width: 75px; text-align: right; color: var(--text-muted);">${item.copies} <span style="font-size: 0.75rem;">(${pct}%)</span></span>
                `;
                priceContainer.appendChild(row);
            }

            // 6. Staples Radar
            const staplesContainer = document.getElementById('staplesGrid');
            staplesContainer.innerHTML = '';
            if (Array.isArray(staples)) {
                staples.forEach(s => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = `staple-item ${s.isOwned ? 'owned' : 'missing'}`;
                    itemDiv.innerHTML = `
                        <div style="min-width: 0; display: flex; align-items: center; gap: 0.4rem;">
                            <span style="font-size: 1rem;">${s.isOwned ? '✅' : '❌'}</span>
                            <span style="font-weight: 600; font-size: 0.88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.name}</span>
                        </div>
                        <div style="text-align: right; white-space: nowrap; display: flex; align-items: center; gap: 0.35rem;">
                            ${s.isOwned ? `<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399; font-size: 0.75rem;">${s.owned}x</span>` : `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; font-size: 0.75rem;">Missing</span>`}
                            <button type="button" class="binder-quick-btn ${s.isOwned ? 'have-btn' : 'want-btn'}" style="padding: 0.15rem 0.45rem; font-size: 0.72rem;" onclick="addToTradeBinder('${s.name.replace(/'/g, "\\'")}', '', 0, '', '${s.isOwned ? 'have' : 'want'}')">${s.isOwned ? '+ Have' : '+ Want'}</button>
                        </div>
                    `;
                    staplesContainer.appendChild(itemDiv);
                });
            }
        }

        // ==================== SCRYFALL DIRECT LINK & HOVER PREVIEW ====================
        let activeHoverCardName = null;
        const scryfallImageCache = new Map();

        function openInScryfall(cardName, event) {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }
            const clean = (cardName || '').trim();
            if (!clean) return;
            const url = `https://scryfall.com/search?q=${encodeURIComponent('!"' + clean + '"')}`;
            window.open(url, '_blank', 'noopener,noreferrer');
        }

        function ensureScryfallHoverElement() {
            let tooltip = document.getElementById('scryfallHoverPreview');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.id = 'scryfallHoverPreview';
                tooltip.innerHTML = `
                    <div id="scryfallHoverLoader">
                        <span class="spinner" style="width: 22px; height: 22px; border-width: 2.5px;"></span>
                        <span id="scryfallHoverCardTitle" style="font-weight: 600;">Loading preview...</span>
                    </div>
                    <img id="scryfallHoverImg" alt="Card Preview" />
                `;
                document.body.appendChild(tooltip);
            }
            return tooltip;
        }

        function showScryfallHover(cardName, e, directImgUrl) {
            if (!cardName) return;
            const cleanName = cardName.trim();
            activeHoverCardName = cleanName;

            const tooltip = ensureScryfallHoverElement();
            const loader = document.getElementById('scryfallHoverLoader');
            const img = document.getElementById('scryfallHoverImg');

            tooltip.style.display = 'block';
            tooltip.style.opacity = '1';
            positionScryfallHover(e);

            if (scryfallImageCache.has(cleanName)) {
                img.src = scryfallImageCache.get(cleanName);
                img.style.display = 'block';
                if (loader) loader.style.display = 'none';
                return;
            }

            if (loader) {
                loader.style.display = 'flex';
                loader.innerHTML = `
                    <span class="spinner" style="width: 22px; height: 22px; border-width: 2.5px;"></span>
                    <span style="font-weight: 700; font-size: 0.88rem; color: #f1f5f9;">${cleanName}</span>
                `;
            }
            img.style.display = 'none';

            const primaryUrl = directImgUrl || `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cleanName)}&format=image`;
            const fallbackUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanName)}&format=image`;

            const imgObj = new Image();
            imgObj.onload = () => {
                scryfallImageCache.set(cleanName, imgObj.src);
                if (activeHoverCardName === cleanName) {
                    img.src = imgObj.src;
                    img.style.display = 'block';
                    if (loader) loader.style.display = 'none';
                    if (e) positionScryfallHover(e);
                }
            };
            imgObj.onerror = () => {
                const fallbackObj = new Image();
                fallbackObj.onload = () => {
                    scryfallImageCache.set(cleanName, fallbackObj.src);
                    if (activeHoverCardName === cleanName) {
                        img.src = fallbackObj.src;
                        img.style.display = 'block';
                        if (loader) loader.style.display = 'none';
                        if (e) positionScryfallHover(e);
                    }
                };
                fallbackObj.onerror = () => {
                    if (activeHoverCardName === cleanName && loader) {
                        loader.innerHTML = `<span>🃏 ${cleanName}</span><span style="font-size: 0.74rem; color: #f87171;">Preview not available</span>`;
                    }
                };
                fallbackObj.src = fallbackUrl;
            };
            imgObj.src = primaryUrl;
        }

        function positionScryfallHover(e) {
            const tooltip = document.getElementById('scryfallHoverPreview');
            if (!tooltip || tooltip.style.display === 'none') return;

            const width = 240;
            const height = 335;
            const offset = 18;

            let clientX = (e && typeof e.clientX === 'number') ? e.clientX : window.innerWidth / 2;
            let clientY = (e && typeof e.clientY === 'number') ? e.clientY : window.innerHeight / 2;

            let x = clientX + offset;
            let y = clientY - (height / 2);

            if (x + width + offset > window.innerWidth) {
                x = clientX - width - offset;
            }

            if (y < 15) y = 15;
            if (y + height + 15 > window.innerHeight) {
                y = window.innerHeight - height - 15;
            }

            tooltip.style.left = `${Math.max(10, x)}px`;
            tooltip.style.top = `${Math.max(10, y)}px`;
        }

        function hideScryfallHover() {
            activeHoverCardName = null;
            const tooltip = document.getElementById('scryfallHoverPreview');
            if (tooltip) {
                tooltip.style.display = 'none';
                tooltip.style.opacity = '0';
            }
        }

        function bindImageHover(element, cardName, directImgUrl) {
            if (!element || !cardName) return;
            const cleanName = cardName.trim();
            element.style.cursor = 'pointer';

            element.addEventListener('mouseenter', (e) => {
                showScryfallHover(cleanName, e, directImgUrl);
            });
            element.addEventListener('mousemove', (e) => {
                positionScryfallHover(e);
            });
            element.addEventListener('mouseleave', () => {
                hideScryfallHover();
            });
        }

        function bindHoverName(element, cardName, directImgUrl) {
            if (!element || !cardName) return;
            if (!element._hoverBound) {
                element._hoverBound = true;
                bindImageHover(element, cardName, directImgUrl);
            }
            if (window.event && (window.event.type === 'mouseenter' || window.event.type === 'mouseover')) {
                showScryfallHover(cardName, window.event, directImgUrl);
            }
        }

        // ==================== DECK COMPARATOR LOGIC ====================

        function sanitizeDeckInput(raw) {
            if (!raw) return null;
            let s = String(raw).trim();
            if (!s) return null;

            let platform = 'archidekt';
            let id = s;

            // Check for Moxfield URL
            const moxfieldMatch = s.match(/(?:moxfield\.com\/decks\/)([a-zA-Z0-9_-]+)/i);
            // Check for Archidekt URL
            const archidektMatch = s.match(/(?:archidekt\.com\/(?:api\/)?decks\/)(\d+)/i);
            // Check for prefix syntax
            const prefixMatch = s.match(/^(archidekt|moxfield):(.+)$/i);

            if (prefixMatch) {
                platform = prefixMatch[1].toLowerCase();
                id = prefixMatch[2].trim();
                if (platform === 'archidekt') {
                    const num = id.match(/\d+/);
                    id = num ? num[0] : id;
                } else {
                    id = id.split('/')[0].split('?')[0].split('#')[0];
                }
            } else if (moxfieldMatch) {
                platform = 'moxfield';
                id = moxfieldMatch[1];
            } else if (archidektMatch) {
                platform = 'archidekt';
                id = archidektMatch[1];
            } else {
                id = s.split('/')[0].split('?')[0].split('#')[0].trim();
                if (/^\d+$/.test(id)) {
                    platform = 'archidekt';
                } else {
                    platform = 'moxfield';
                }
            }

            if (!id) return null;
            return `${platform}:${id}`;
        }

        const deckNameQueue = [];
        let isProcessingDeckNameQueue = false;

        async function processDeckNameQueue() {
            if (isProcessingDeckNameQueue) return;
            isProcessingDeckNameQueue = true;

            while (deckNameQueue.length > 0) {
                const compositeKey = deckNameQueue.shift();
                try {
                    const [platform, rawId] = compositeKey.includes(':') ? compositeKey.split(':') : ['archidekt', compositeKey];
                    const res = await fetch(`/getDeckName?id=${rawId}&platform=${platform}`, {
                        headers: { 'Accept': 'application/json' }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.name && deckNames[compositeKey] !== data.name) {
                            deckNames[compositeKey] = data.name;
                            localStorage.setItem('archidekt_deckNames', JSON.stringify(deckNames));
                            renderDeckChips();
                        }
                    }
                } catch (e) {
                    console.warn(`Could not fetch name for deck ${compositeKey}`, e);
                }

                if (deckNameQueue.length > 0) {
                    await new Promise(r => setTimeout(r, 350));
                }
            }

            isProcessingDeckNameQueue = false;
        }

        function fetchDeckName(compositeKey) {
            // Check if name is already resolved in cache
            if (deckNames[compositeKey] && !deckNames[compositeKey].startsWith('Deck #') && !deckNames[compositeKey].startsWith('Moxfield (')) {
                return;
            }
            if (fetchedDecks.has(compositeKey)) return;
            fetchedDecks.add(compositeKey);
            deckNameQueue.push(compositeKey);
            processDeckNameQueue();
        }

        function addDeck() {
            const input = document.getElementById('deckInput');
            let val = input.value.trim();
            if (!val) return;

            // Split by commas, whitespace, or newlines
            const items = val.split(/[,\s\n]+/).map(s => s.trim()).filter(Boolean);
            let addedCount = 0;

            items.forEach(rawItem => {
                const compositeKey = sanitizeDeckInput(rawItem);
                if (compositeKey) {
                    activeDeckIds.add(compositeKey);
                    fetchDeckName(compositeKey);
                    addedCount++;
                }
            });

            input.value = '';
            renderDeckChips();
            saveDecksState();
            if (addedCount > 0) {
                showToast(`Added ${addedCount} deck${addedCount > 1 ? 's' : ''}!`);
                const bannerText = document.getElementById('comparisonCacheBannerText');
                if (bannerText && document.getElementById('resultsContainer')?.style.display !== 'none') {
                    bannerText.textContent = "Deck list changed — click 'Scan & Compare Decks' to update comparison.";
                }
            }
        }

        function removeDeck(id) {
            activeDeckIds.delete(id);
            customPastedDecks = customPastedDecks.filter(d => d.id !== id);
            renderDeckChips();
            saveDecksState();
            const bannerText = document.getElementById('comparisonCacheBannerText');
            if (bannerText && document.getElementById('resultsContainer')?.style.display !== 'none') {
                bannerText.textContent = "Deck list changed — click 'Scan & Compare Decks' to update comparison.";
            }
        }

        function togglePasteDeckForm() {
            const form = document.getElementById('pasteDeckForm');
            const isVisible = form.style.display !== 'none';
            form.style.display = isVisible ? 'none' : 'block';
            document.getElementById('togglePasteText').textContent = isVisible ? 'Or Paste Decklist Text (Moxfield / MTGO / Text list)' : 'Hide Paste Decklist';
            if (!isVisible) {
                form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                document.getElementById('customDeckName').focus();
            }
        }

        function saveCustomDeck() {
            const name = document.getElementById('customDeckName').value.trim() || 'Custom Deck';
            const text = document.getElementById('customDeckText').value.trim();
            if (!text) {
                alert('Please enter some cards in the decklist text area.');
                return;
            }

            const customId = `custom:${Date.now()}`;
            customPastedDecks.push({
                id: customId,
                name: name,
                text: text
            });
            activeDeckIds.add(customId);
            deckNames[customId] = name;

            document.getElementById('customDeckName').value = '';
            document.getElementById('customDeckText').value = '';
            togglePasteDeckForm();
            renderDeckChips();
            saveDecksState();
            showToast(`Added custom deck: "${name}"!`);
        }

        function renderDeckChips() {
            const container = document.getElementById('deckChips');
            container.innerHTML = '';
            activeDeckIds.forEach(id => {
                const chip = document.createElement('div');
                chip.className = 'chip';
                const [platform, rawId] = id.includes(':') ? id.split(':') : ['archidekt', id];
                const platformIcon = platform === 'moxfield' ? '🟣' : (platform === 'custom' ? '📝' : '🟠');
                const defaultName = platform === 'moxfield' ? `Moxfield (${rawId})` : (platform === 'custom' ? 'Custom Deck' : `Deck #${rawId}`);
                const displayName = deckNames[id] || defaultName;

                chip.innerHTML = `
                    <span>${platformIcon}</span>
                    <span class="chip-name" title="${displayName}">${displayName}</span>
                    <button type="button" onclick="removeDeck('${id}')" title="Remove Deck">&times;</button>
                `;
                container.appendChild(chip);
            });
        }

        function saveDecksState() {
            const remoteIds = Array.from(activeDeckIds).filter(id => !id.startsWith('custom:'));
            localStorage.setItem('archidekt_deckIds', remoteIds.join(','));
            localStorage.setItem('archidekt_customDecks', JSON.stringify(customPastedDecks));
            localStorage.setItem('archidekt_deckNames', JSON.stringify(deckNames));
            const collId = document.getElementById('collectionId')?.value.trim();
            if (collId) {
                localStorage.setItem('archidekt_collectionId', collId);
            }
            syncCollectionPrefsToCloud();
        }

        function toggleCollectionInputs() {
            const idInput = document.getElementById('collectionId');
            const csvInput = document.getElementById('csvUpload');
            const clearBtn = document.getElementById('clearCsvBtn');
            const statusBadge = document.getElementById('collectionStatusBadge');

            if (csvInput.files.length > 0) {
                idInput.disabled = true;
                idInput.style.opacity = '0.5';
                clearBtn.style.display = 'inline-flex';
                statusBadge.textContent = `📁 CSV: ${csvInput.files[0].name}`;
                cachedParsedCsv = null;
            } else if (idInput.value.trim().length > 0) {
                csvInput.disabled = true;
                csvInput.style.opacity = '0.5';
                clearBtn.style.display = 'none';
                statusBadge.textContent = `🌐 Collection: ${idInput.value.trim()}`;
            } else {
                idInput.disabled = false;
                idInput.style.opacity = '1';
                csvInput.disabled = false;
                csvInput.style.opacity = '1';
                clearBtn.style.display = 'none';
                statusBadge.textContent = '';
            }
        }

        function clearCsv() {
            document.getElementById('csvUpload').value = '';
            cachedParsedCsv = null;
            toggleCollectionInputs();
        }

        async function readCSVFile(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (e) => reject(new Error("Failed to read CSV file"));
                reader.readAsText(file);
            });
        }

        function parseCSVLine(text) {
            const result = [];
            let cur = '';
            let inQuotes = false;
            for (let i = 0; i < text.length; i++) {
                const c = text[i];
                if (c === '"') {
                    if (inQuotes && text[i + 1] === '"') {
                        cur += '"';
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (c === ',' && !inQuotes) {
                    result.push(cur.trim());
                    cur = '';
                } else {
                    cur += c;
                }
            }
            result.push(cur.trim());
            return result;
        }

        function parseCSV(csvText) {
            const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length < 2) throw new Error("CSV file is empty or invalid.");

            const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/^"|"$/g, '').trim());
            let nameIdx = headers.findIndex(h => h === 'name' || h === 'card name' || h === 'card' || h === 'simple name');
            if (nameIdx === -1) nameIdx = headers.findIndex(h => h.includes('name'));
            if (nameIdx === -1) throw new Error("Could not find a 'Name' column in the CSV.");

            let qtyIdx = headers.findIndex(h => h === 'quantity' || h === 'count' || h === 'qty' || h === 'amount');
            if (qtyIdx === -1) qtyIdx = headers.findIndex(h => h.includes('quantity') || h.includes('count') || h.includes('qty'));

            let setIdx = headers.findIndex(h => h === 'set code' || h === 'edition code' || h === 'expansion code' || h === 'set' || h === 'edition' || h === 'expansion' || h === 'setcode');
            if (setIdx === -1) setIdx = headers.findIndex(h => h.includes('set') || h.includes('edition') || h.includes('expansion'));

            let numIdx = headers.findIndex(h => h === 'collector number' || h === 'card number' || h === 'number' || h === 'num' || h === 'card #' || h === 'card#');
            if (numIdx === -1) numIdx = headers.findIndex(h => h.includes('collector') || h.includes('number'));

            let finishIdx = headers.findIndex(h => h === 'finish' || h === 'modifier' || h === 'foil' || h === 'printing');
            if (finishIdx === -1) finishIdx = headers.findIndex(h => h.includes('finish') || h.includes('modifier') || h.includes('foil'));

            let colorIdx = headers.findIndex(h => h === 'color' || h === 'colors' || h === 'color identity' || h === 'coloridentity' || h === 'color_identity');
            if (colorIdx === -1) colorIdx = headers.findIndex(h => h.includes('color'));

            let typeIdx = headers.findIndex(h => h === 'type' || h === 'type line' || h === 'typeline' || h === 'type_line');
            if (typeIdx === -1) typeIdx = headers.findIndex(h => h.includes('type'));

            const data = [];
            for (let i = 1; i < lines.length; i++) {
                const values = parseCSVLine(lines[i]);
                const name = values[nameIdx]?.replace(/^"|"$/g, '').trim();
                const qty = qtyIdx !== -1 ? parseInt(values[qtyIdx]?.replace(/^"|"$/g, '').trim()) : 1;
                const set = setIdx !== -1 ? values[setIdx]?.replace(/^"|"$/g, '').trim().toLowerCase() : '';
                const collectorNumber = numIdx !== -1 ? values[numIdx]?.replace(/^"|"$/g, '').trim() : '';
                let finishVal = finishIdx !== -1 ? values[finishIdx]?.replace(/^"|"$/g, '').trim() : 'Normal';
                let isFoil = false;
                if (finishVal) {
                    const fLow = finishVal.toLowerCase();
                    if (fLow === 'true' || fLow === 'foil' || fLow === 'yes' || fLow === '1') {
                        finishVal = 'Foil';
                        isFoil = true;
                    } else if (fLow.includes('surge')) {
                        finishVal = 'Surge Foil';
                        isFoil = true;
                    } else if (fLow.includes('etched')) {
                        finishVal = 'Etched';
                        isFoil = true;
                    } else if (fLow.includes('textured')) {
                        finishVal = 'Textured Foil';
                        isFoil = true;
                    } else if (fLow === 'false' || fLow === 'no' || fLow === '0' || fLow === 'normal' || fLow === 'non-foil') {
                        finishVal = 'Normal';
                        isFoil = false;
                    }
                } else {
                    finishVal = 'Normal';
                }

                let rawColorsVal = colorIdx !== -1 ? (values[colorIdx]?.replace(/^"|"$/g, '').trim() || '') : '';
                let rawTypeVal = typeIdx !== -1 ? (values[typeIdx]?.replace(/^"|"$/g, '').trim() || '') : '';

                if (name) data.push({
                    name,
                    quantity: isNaN(qty) ? 1 : qty,
                    owned: isNaN(qty) ? 1 : qty,
                    set,
                    setCode: set.toUpperCase(),
                    collectorNumber,
                    collector_number: collectorNumber,
                    finish: finishVal,
                    modifier: finishVal,
                    isFoil,
                    foil: isFoil,
                    colors: rawColorsVal,
                    typeLine: rawTypeVal,
                    type_line: rawTypeVal
                });
            }
            return data;
        }

        async function runComparison() {
            const deckInputEl = document.getElementById('deckInput');
            if (deckInputEl && deckInputEl.value.trim() !== '') addDeck();

            const deckIds = Array.from(activeDeckIds).filter(id => !id.startsWith('custom:')).join(',');
            let collectionId = (document.getElementById('collectionId')?.value || '').trim() || localStorage.getItem('archidekt_collectionId') || '';
            // Sanitize Archidekt collection ID if full URL was pasted
            const collMatch = collectionId.match(/(?:archidekt\.com\/(?:[a-z0-9_-]+\/)?collections?\/)(\d+)/i) || collectionId.match(/(\d+)/);
            if (collMatch) collectionId = collMatch[1];

            const csvInput = document.getElementById('csvUpload');
            const csvFile = csvInput && csvInput.files.length > 0 ? csvInput.files[0] : null;
            const includeSideboards = document.getElementById('includeSideboards')?.checked ?? true;
            const includeBasicLands = document.getElementById('includeBasicLands')?.checked ?? false;
            const btn = document.getElementById('compareBtn');
            const resultsContainer = document.getElementById('resultsContainer');

            let collectionCsvData = cachedParsedCsv;
            if (csvFile && !collectionCsvData) {
                try {
                    const csvText = await readCSVFile(csvFile);
                    collectionCsvData = parseCSV(csvText);
                    cachedParsedCsv = collectionCsvData;
                    AppStorage.saveCsv(collectionCsvData);
                    updateCollectionStatusBadge();
                } catch (e) {
                    alert("Error parsing CSV: " + e.message);
                    return;
                }
            }

            // Fallback to in-memory collection data if collectionId/CSV is not typed but data exists
            if (!collectionId && !collectionCsvData && Array.isArray(currentCollectionData) && currentCollectionData.length > 0) {
                collectionCsvData = currentCollectionData;
            }

            if ((!deckIds && customPastedDecks.length === 0) || (!collectionId && !csvFile && !cachedParsedCsv && !collectionCsvData)) {
                alert("Please enter your Decks and a Collection Source.");
                return;
            }

            // Update URL to make it bookmarkable
            const params = new URLSearchParams(window.location.search);
            if (deckIds) params.set('deckIds', deckIds);
            params.set('includeSideboards', includeSideboards);
            params.set('includeBasicLands', includeBasicLands);

            if (collectionCsvData && !collectionId) {
                localStorage.removeItem('archidekt_collectionId');
                params.delete('collectionId');
            } else if (collectionId) {
                localStorage.setItem('archidekt_collectionId', collectionId);
                params.set('collectionId', collectionId);
            }

            window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
            if (deckIds) localStorage.setItem('archidekt_deckIds', deckIds);
            localStorage.setItem('archidekt_includeSideboards', includeSideboards);
            localStorage.setItem('archidekt_includeBasicLands', includeBasicLands);

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner"></span> Scanning & Comparing Decks...';
            }

            const factsCard = document.getElementById('factsCard');
            const decksOverviewCard = document.getElementById('decksOverviewCard');
            if (factsCard) factsCard.style.display = 'none';
            if (decksOverviewCard) decksOverviewCard.style.display = 'none';
            if (resultsContainer) resultsContainer.style.display = 'none';

            const payload = {
                collectionId,
                deckIds,
                customDecks: customPastedDecks,
                includeSideboards,
                includeBasicLands,
                collectionData: collectionCsvData,
                sortCommanders: true
            };

            try {
                let response;
                try {
                    response = await fetch('/compareDecks', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (!response.ok && response.status !== 400) {
                        throw new Error(`Hosting gateway returned status ${response.status}`);
                    }
                } catch (gatewayErr) {
                    console.warn("Primary /compareDecks route failed, falling back directly to Cloud Run...", gatewayErr);
                    response = await fetch('https://comparedecks-v3miuc3wbq-uc.a.run.app', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                }

                let data;
                try {
                    data = await response.json();
                } catch (parseError) {
                    console.warn("JSON parsing from primary route failed, retrying Cloud Run directly...");
                    response = await fetch('https://comparedecks-v3miuc3wbq-uc.a.run.app', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    data = await response.json();
                }

                if (!response.ok || data.error) {
                    throw new Error(data.error || `Server error (HTTP ${response.status})`);
                }

                currentCollectionData = data.collection || [];
                currentDecksData = data.decks || [];
                currentDeckSummary = data.deckSummary || null;

                if (typeof renderDeckDashboard === 'function') renderDeckDashboard();
                if (typeof renderFacts === 'function') renderFacts();
                if (typeof populateDeckSelector === 'function') populateDeckSelector();
                if (typeof renderDeckCardsList === 'function') renderDeckCardsList();
                if (typeof renderList === 'function') renderList();

                if (decksOverviewCard) {
                    decksOverviewCard.style.display = 'block';
                    decksOverviewCard.scrollIntoView({ behavior: 'smooth' });
                }
                if (factsCard) factsCard.style.display = 'block';
                if (resultsContainer) resultsContainer.style.display = 'block';

                // Save comparison results to cache for instant reload across page refreshes
                await AppStorage.saveComparison({
                    timestamp: Date.now(),
                    collectionId: collectionId || '',
                    deckIds: deckIds || '',
                    customDecks: customPastedDecks || [],
                    includeSideboards,
                    includeBasicLands,
                    data: {
                        collection: currentCollectionData,
                        decks: currentDecksData,
                        deckSummary: currentDeckSummary
                    }
                });
                hideCachedComparisonBanner();
            } catch (error) {
                console.error("runComparison error:", error);
                alert(`An error occurred: ${error.message}`);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span>Scan & Compare Decks</span>';
                }
            }
        }
        window.runComparison = runComparison;

        // ==================== RENDERING DECK DASHBOARD & CARDS ====================

        function renderDeckDashboard() {
            const grid = document.getElementById('deckCardsGrid');
            grid.innerHTML = '';

            const summaryBadge = document.getElementById('deckSummaryBadge');
            if (currentDeckSummary) {
                summaryBadge.textContent = `${currentDeckSummary.totalDecks} Decks • ${currentDeckSummary.totalCardsOwned}/${currentDeckSummary.totalCardsNeeded} Cards Owned • ${currentDeckSummary.avgPercentComplete}% Avg Complete`;
            }

            if (!currentDecksData || currentDecksData.length === 0) {
                grid.innerHTML = '<div style="color: var(--text-muted); padding: 1rem;">No deck breakdown data returned.</div>';
                return;
            }

            currentDecksData.forEach(deck => {
                const card = document.createElement('div');
                card.className = `deck-summary-card ${activeDeckViewId === deck.id ? 'active' : ''}`;
                card.id = `deckSummaryCard_${deck.id}`;
                card.onclick = () => {
                    selectDeckView(deck.id);
                    switchDeckResultsMode('deck');
                    document.getElementById('resultsContainer').scrollIntoView({ behavior: 'smooth' });
                };

                const platformTag = deck.platform === 'moxfield' ? 'MOXFIELD' : (deck.platform === 'custom' ? 'CUSTOM' : 'ARCHIDEKT');
                const platformIcon = deck.platform === 'moxfield' ? '🟣' : (deck.platform === 'custom' ? '📝' : '🟠');

                if (deck.error) {
                    const is429 = deck.error.includes('429') || deck.error.toLowerCase().includes('rate limit');
                    card.innerHTML = `
                        <div class="deck-card-title-row">
                            <div class="deck-card-name-wrapper">
                                <span>${platformIcon}</span>
                                <span class="deck-platform-badge">${platformTag}</span>
                                <span class="deck-card-title-text" title="${deck.name}">${deck.name}</span>
                            </div>
                        </div>
                        <div class="deck-error-notice" style="margin-top: 0.5rem; padding: 0.65rem 0.85rem; border-radius: 8px; background: var(--status-missing-bg); border: 1px solid var(--status-missing-border); font-size: 0.83rem;">
                            <div style="font-weight: 600; color: var(--status-missing);">⚠️ ${deck.error}</div>
                            ${is429 ? '<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Archidekt temporarily rate-limited automated requests. Wait a few moments and click Scan again, or paste the text list.</div>' : ''}
                            <div style="margin-top: 0.4rem; display: flex; gap: 0.4rem; flex-wrap: wrap;">
                                <button type="button" class="secondary-btn" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;" onclick="event.stopPropagation(); runComparison();">🔄 Retry Scan</button>
                                <button type="button" class="secondary-btn" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;" onclick="event.stopPropagation(); togglePasteDeckForm();">📝 Paste Text</button>
                            </div>
                        </div>
                    `;
                } else {
                    card.innerHTML = `
                        <div class="deck-card-title-row">
                            <div class="deck-card-name-wrapper">
                                <span>${platformIcon}</span>
                                <span class="deck-platform-badge">${platformTag}</span>
                                <span class="deck-card-title-text" title="${deck.name}">${deck.name}</span>
                            </div>
                            <span class="deck-pct-badge">${deck.percentComplete}%</span>
                        </div>
                        <div class="deck-card-track">
                            <div class="deck-card-fill" style="width: ${deck.percentComplete}%;"></div>
                        </div>
                        <div class="deck-card-stats">
                            <span class="deck-stat-pill deck-stat-owned">✅ ${deck.ownedCards} Owned</span>
                            <span class="deck-stat-pill deck-stat-missing">❌ ${deck.missingCards} Missing</span>
                            <span class="deck-stat-pill deck-stat-total">📄 ${deck.totalCards} Total</span>
                        </div>
                    `;
                }
                grid.appendChild(card);
            });
        }

        function populateDeckSelector() {
            const dropdown = document.getElementById('deckSelectorDropdown');
            dropdown.innerHTML = '<option value="all">All Decks Combined</option>';
            currentDecksData.forEach(d => {
                if (d.error) return;
                const opt = document.createElement('option');
                opt.value = d.id;
                opt.textContent = `${d.name} (${d.ownedCards}/${d.totalCards} - ${d.percentComplete}%)`;
                dropdown.appendChild(opt);
            });
            dropdown.value = activeDeckViewId;
        }

        function switchDeckResultsMode(mode) {
            const btnDeck = document.getElementById('btnModeDeckView');
            const btnInv = document.getElementById('btnModeInventoryView');
            const deckControls = document.getElementById('deckViewControls');
            const invControls = document.getElementById('inventoryViewControls');
            const deckList = document.getElementById('deckCardsListContainer');
            const invList = document.getElementById('inventoryCardsListContainer');

            if (mode === 'deck') {
                btnDeck.classList.add('active');
                btnInv.classList.remove('active');
                deckControls.style.display = 'block';
                invControls.style.display = 'none';
                deckList.style.display = 'block';
                invList.style.display = 'none';
                renderDeckCardsList();
            } else {
                btnDeck.classList.remove('active');
                btnInv.classList.add('active');
                deckControls.style.display = 'none';
                invControls.style.display = 'block';
                deckList.style.display = 'none';
                invList.style.display = 'block';
                renderList();
            }
        }

        function selectDeckView(deckId) {
            activeDeckViewId = deckId;
            if (deckId !== 'all') {
                activeAiDeckId = deckId;
            }
            const dropdown = document.getElementById('deckSelectorDropdown');
            if (dropdown) dropdown.value = deckId;

            // Highlight active card in grid
            document.querySelectorAll('.deck-summary-card').forEach(c => {
                c.classList.toggle('active', c.id === `deckSummaryCard_${deckId}`);
            });

            renderDeckCardsList();
        }

        function setDeckCardsStatusFilter(filter) {
            deckCardsStatusFilter = filter;
            const btnAll = document.getElementById('btnDeckFilterAll');
            const btnMissing = document.getElementById('btnDeckFilterMissing');
            const btnOwned = document.getElementById('btnDeckFilterOwned');
            if (btnAll) btnAll.classList.toggle('active', filter === 'all');
            if (btnMissing) btnMissing.classList.toggle('active', filter === 'missing');
            if (btnOwned) btnOwned.classList.toggle('active', filter === 'owned');
            renderDeckCardsList();
        }
        window.setDeckCardsStatusFilter = setDeckCardsStatusFilter;

        function onDeckSearchInput(val) {
            const clearBtn = document.getElementById('deckSearchClearBtn');
            if (clearBtn) {
                clearBtn.style.display = val && val.trim() ? 'flex' : 'none';
            }
            renderDeckCardsList();
        }

        function clearDeckSearch() {
            const input = document.getElementById('deckCardSearch');
            if (input) input.value = '';
            const clearBtn = document.getElementById('deckSearchClearBtn');
            if (clearBtn) clearBtn.style.display = 'none';
            renderDeckCardsList();
        }

        function getActiveDeckCards() {
            let cards = [];
            if (activeDeckViewId === 'all') {
                // Merge all decks cards
                const map = new Map();
                currentDecksData.forEach(d => {
                    if (d.error) return;
                    (d.cards || []).forEach(c => {
                        if (!map.has(c.cleanName)) {
                            map.set(c.cleanName, {
                                ...c,
                                deckBreakdown: { [d.name]: c.quantity }
                            });
                        } else {
                            const existing = map.get(c.cleanName);
                            existing.quantity += c.quantity;
                            existing.missing = Math.max(0, existing.quantity - existing.owned);
                            existing.status = existing.owned >= existing.quantity ? 'owned' : (existing.owned > 0 ? 'partial' : 'missing');
                            existing.deckBreakdown[d.name] = (existing.deckBreakdown[d.name] || 0) + c.quantity;
                        }
                    });
                });
                cards = Array.from(map.values());
            } else {
                const selected = currentDecksData.find(d => d.id === activeDeckViewId);
                cards = selected ? (selected.cards || []) : [];
            }

            // Update badge counters for active deck
            const allCount = cards.length;
            const missingCount = cards.filter(c => c.status === 'missing' || c.status === 'partial').length;
            const ownedCount = cards.filter(c => c.status === 'owned').length;

            const countAllEl = document.getElementById('deckCountAll');
            const countMissingEl = document.getElementById('deckCountMissing');
            const countOwnedEl = document.getElementById('deckCountOwned');
            if (countAllEl) countAllEl.textContent = allCount;
            if (countMissingEl) countMissingEl.textContent = missingCount;
            if (countOwnedEl) countOwnedEl.textContent = ownedCount;

            // Apply filters
            const searchVal = (document.getElementById('deckCardSearch')?.value || '').trim().toLowerCase();
            const catVal = document.getElementById('deckCategoryFilter')?.value || 'all';

            const filtered = cards.filter(c => {
                if (deckCardsStatusFilter === 'missing' && c.status === 'owned') return false;
                if (deckCardsStatusFilter === 'owned' && c.status !== 'owned') return false;

                if (catVal !== 'all') {
                    if (catVal === 'Sideboard' && !['sideboard', 'maybeboard'].includes((c.category || '').toLowerCase())) return false;
                    else if (catVal !== 'Sideboard' && c.category !== catVal) return false;
                }

                if (searchVal) {
                    const matchName = (c.name || '').toLowerCase().includes(searchVal);
                    const matchType = (c.typeLine || '').toLowerCase().includes(searchVal);
                    const matchCat = (c.category || '').toLowerCase().includes(searchVal);
                    const matchMana = (c.manaCost || '').toLowerCase().includes(searchVal);
                    if (!matchName && !matchType && !matchCat && !matchMana) return false;
                }

                return true;
            });

            // Update dynamic match counter
            const showCountEl = document.getElementById('deckShowingCount');
            const totCountEl = document.getElementById('deckTotalCount');
            if (showCountEl) showCountEl.textContent = filtered.length;
            if (totCountEl) totCountEl.textContent = allCount;

            // Apply sorting
            const sortVal = document.getElementById('deckSortOrder')?.value || 'category';
            if (sortVal === 'name') {
                filtered.sort((a, b) => a.name.localeCompare(b.name));
            } else if (sortVal === 'missing') {
                const rankStatus = { 'missing': 1, 'partial': 2, 'owned': 3 };
                filtered.sort((a, b) => (rankStatus[a.status] || 9) - (rankStatus[b.status] || 9) || a.name.localeCompare(b.name));
            } else if (sortVal === 'quantity') {
                filtered.sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
            }

            return filtered;
        }

        function renderDeckCardsList() {
            const ul = document.getElementById('deckCardsListUl');
            ul.innerHTML = '';

            const filteredCards = getActiveDeckCards();
            const sortVal = document.getElementById('deckSortOrder')?.value || 'category';

            if (filteredCards.length === 0) {
                ul.innerHTML = `
                    <li style="padding: 3rem 1.5rem; text-align: center; color: var(--text-muted);">
                        <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
                        <div style="font-weight: 700; font-size: 1.05rem; margin-bottom: 0.25rem;">No cards found matching your search.</div>
                        <button type="button" class="secondary-btn" style="margin-top: 0.75rem;" onclick="clearDeckSearch()">Clear Search Filter</button>
                    </li>`;
                return;
            }

            const renderCardRow = (card) => {
                const li = document.createElement('li');
                li.className = 'card-row-item';

                const leftDiv = document.createElement('div');
                leftDiv.className = 'card-row-left';

                const qtySpan = document.createElement('span');
                qtySpan.className = 'card-qty-badge';
                qtySpan.textContent = `${card.quantity}x`;

                const detailsDiv = document.createElement('div');
                detailsDiv.className = 'card-details-block';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'card-name';
                nameSpan.textContent = card.name;
                nameSpan.title = "Click to view on Scryfall • Hover to preview card";
                nameSpan.onclick = (e) => {
                    openInScryfall(card.name, e);
                };
                bindImageHover(nameSpan, card.name);

                const metaDiv = document.createElement('div');
                metaDiv.className = 'card-meta-line';
                const mana = card.manaCost ? ` • ${card.manaCost}` : '';
                metaDiv.textContent = `${card.typeLine || card.category}${mana}`;

                detailsDiv.appendChild(nameSpan);
                detailsDiv.appendChild(metaDiv);

                // If viewing all decks, show which decks require this card
                if (card.deckBreakdown && Object.keys(card.deckBreakdown).length > 0) {
                    const tagsDiv = document.createElement('div');
                    tagsDiv.className = 'deck-tags-container';
                    for (const [dName, qty] of Object.entries(card.deckBreakdown)) {
                        const tag = document.createElement('span');
                        tag.className = 'deck-tag';
                        tag.textContent = `${dName} (${qty}x)`;
                        tagsDiv.appendChild(tag);
                    }
                    detailsDiv.appendChild(tagsDiv);
                }

                leftDiv.appendChild(qtySpan);
                leftDiv.appendChild(detailsDiv);

                const rightDiv = document.createElement('div');
                rightDiv.className = 'card-row-right';

                // Owned in Collection count
                const ownedSpan = document.createElement('span');
                ownedSpan.className = 'card-owned-badge';
                ownedSpan.textContent = `Owned: ${card.owned}x`;
                rightDiv.appendChild(ownedSpan);

                // Status Badge
                const statusSpan = document.createElement('span');
                if (card.status === 'owned') {
                    statusSpan.className = 'status-owned';
                    statusSpan.textContent = '✅ Owned';
                } else if (card.status === 'partial') {
                    statusSpan.className = 'status-partial';
                    statusSpan.textContent = `⚠️ Need ${card.missing}x more`;
                } else {
                    statusSpan.className = 'status-missing';
                    statusSpan.textContent = `❌ Missing ${card.quantity}x`;
                }
                rightDiv.appendChild(statusSpan);

                const binderBtn = document.createElement('button');
                binderBtn.type = 'button';
                const isNeed = card.status === 'missing' || card.status === 'partial';
                binderBtn.className = isNeed ? 'binder-quick-btn want-btn' : 'binder-quick-btn have-btn';
                binderBtn.innerHTML = isNeed ? '+ Want' : '+ Have';
                binderBtn.title = isNeed ? 'Add missing card to Trade Binder wishlist' : 'Add card to Trade Binder for trade';
                binderBtn.onclick = (e) => {
                    e.stopPropagation();
                    addToTradeBinder({
                        name: card.name,
                        setCode: card.setCode || card.set || '',
                        collectorNumber: card.collectorNumber || card.collector_number || '',
                        finish: card.finish || card.modifier || 'Normal',
                        isFoil: Boolean(card.isFoil || card.foil),
                        priceUsd: card.priceUsd || 0,
                        imageUrl: card.imageUrl || card.image_url || '',
                        prices: card.prices || null,
                        type: isNeed ? 'want' : 'have'
                    });
                };
                rightDiv.appendChild(binderBtn);

                li.appendChild(leftDiv);
                li.appendChild(rightDiv);
                return li;
            };

            // If non-category sort is chosen, render flat list
            if (sortVal !== 'category') {
                filteredCards.forEach(card => {
                    ul.appendChild(renderCardRow(card));
                });
                return;
            }

            // Group cards by category
            const grouped = {};
            filteredCards.forEach(c => {
                const cat = c.category || 'Other';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push(c);
            });

            const categoryOrder = ['Creatures', 'Planeswalkers', 'Instants', 'Sorceries', 'Artifacts', 'Enchantments', 'Battles', 'Lands', 'Sideboard', 'Maybeboard', 'Other'];
            const sortedCategories = Object.keys(grouped).sort((a, b) => {
                const idxA = categoryOrder.indexOf(a);
                const idxB = categoryOrder.indexOf(b);
                return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99);
            });

            sortedCategories.forEach(catName => {
                const catCards = grouped[catName];
                if (!catCards || catCards.length === 0) return;

                const headerLi = document.createElement('div');
                headerLi.className = 'deck-category-header';
                const catTotal = catCards.reduce((acc, c) => acc + c.quantity, 0);
                const catOwned = catCards.filter(c => c.status === 'owned').length;
                headerLi.innerHTML = `
                    <span>${catName} (${catTotal})</span>
                    <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">${catOwned}/${catCards.length} Owned</span>
                `;
                ul.appendChild(headerLi);

                catCards.forEach(card => {
                    ul.appendChild(renderCardRow(card));
                });
            });
        }

        function copyDeckMissing() {
            const cards = getActiveDeckCards();
            const missingCards = cards.filter(c => c.status === 'missing' || c.status === 'partial');
            if (missingCards.length === 0) {
                showToast("All cards in this deck are owned in your collection! 🎉");
                return;
            }

            const text = missingCards.map(c => `${c.missing || c.quantity} ${c.name}`).join('\n');
            navigator.clipboard.writeText(text)
                .then(() => showToast(`Copied ${missingCards.length} missing cards to clipboard!`))
                .catch(() => showToast("Failed to copy missing cards."));
        }

        function exportDeckCSV() {
            const cards = getActiveDeckCards();
            if (cards.length === 0) {
                alert("No cards to export.");
                return;
            }

            let csvContent = "Card Name,Quantity Needed,Owned in Collection,Missing,Status,Category\n";
            cards.forEach(c => {
                const safeName = c.name.replace(/"/g, '""');
                csvContent += `"${safeName}",${c.quantity},${c.owned},${c.missing},"${c.status}","${c.category}"\n`;
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            const deckObj = currentDecksData.find(d => d.id === activeDeckViewId);
            const filename = (deckObj ? deckObj.name.replace(/[^a-z0-9]/gi, '_') : 'deck') + '_breakdown.csv';
            link.setAttribute("download", filename);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        function renderFacts() {
            let totalUnused = 0;
            let totalMissing = 0;
            let colorCounts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
            let commanders = [];
            let maxDupes = 0;
            let dupedCardName = "-";
            let mostPopularCard = { name: '-', rank: 999999 };

            currentCollectionData.forEach(card => {
                const avail = card.owned - card.inDecks;

                if (avail > 0) {
                    totalUnused += avail;

                    if (avail > maxDupes) {
                        maxDupes = avail;
                        dupedCardName = card.name;
                    }

                    if (card.edhrecRank && card.edhrecRank > 0 && card.edhrecRank < mostPopularCard.rank) {
                        mostPopularCard = { name: card.name, rank: card.edhrecRank };
                    }

                    if (card.colors && card.colors.length > 0) {
                        card.colors.forEach(c => {
                            let char = c.length > 1 ? (c.toLowerCase() === 'blue' ? 'U' : c.charAt(0).toUpperCase()) : c.toUpperCase();
                            if (colorCounts[char] !== undefined) colorCounts[char] += avail;
                        });
                    } else {
                        colorCounts['C'] += avail;
                    }
                } else if (avail < 0) {
                    totalMissing += Math.abs(avail);
                }

                if (card.isCommander && card.owned > 0) {
                    commanders.push(card);
                }
            });

            document.getElementById('factTotal').textContent = totalUnused.toLocaleString();
            document.getElementById('factMissing').textContent = totalMissing.toLocaleString();
            document.getElementById('factCommandersCount').textContent = commanders.length.toLocaleString();

            const factDupesEl = document.getElementById('factDupes');
            const factDupesSub = document.getElementById('factDupesSub');
            if (maxDupes > 1) {
                factDupesEl.textContent = `${dupedCardName}`;
                factDupesEl.title = `${dupedCardName} (${maxDupes} copies)`;
                factDupesSub.textContent = `${maxDupes} extra copies available`;
            } else {
                factDupesEl.textContent = 'None';
                factDupesSub.textContent = 'No extra duplicate copies';
            }

            const factPopularEl = document.getElementById('factPopular');
            const factPopularSub = document.getElementById('factPopularSub');
            if (mostPopularCard.rank < 999999) {
                factPopularEl.textContent = mostPopularCard.name;
                factPopularEl.title = `${mostPopularCard.name} (EDHREC Rank #${mostPopularCard.rank})`;
                factPopularSub.textContent = `Ranked #${mostPopularCard.rank} on EDHREC`;
            } else {
                factPopularEl.textContent = '-';
                factPopularSub.textContent = 'No ranked cards';
            }

            // Render Color Distribution Bar
            const colorNames = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };
            const colorsHex = { W: '#f0e6d2', U: '#38bdf8', B: '#334155', R: '#f43f5e', G: '#10b981', C: '#94a3b8' };
            const colorSum = Object.values(colorCounts).reduce((a, b) => a + b, 0);

            let topColor = 'None';
            let topCount = -1;
            for (const [c, count] of Object.entries(colorCounts)) {
                if (count > topCount && count > 0) {
                    topCount = count;
                    topColor = colorNames[c] || c;
                }
            }
            document.getElementById('factColor').textContent = topColor;

            const barTrack = document.getElementById('colorBarTrack');
            const dotsLegend = document.getElementById('colorDotsLegend');
            barTrack.innerHTML = '';
            dotsLegend.innerHTML = '';

            if (colorSum > 0) {
                for (const [c, count] of Object.entries(colorCounts)) {
                    if (count > 0) {
                        const pct = ((count / colorSum) * 100).toFixed(1);
                        const seg = document.createElement('div');
                        seg.className = 'color-bar-segment';
                        seg.style.width = `${pct}%`;
                        seg.style.backgroundColor = colorsHex[c];
                        seg.title = `${colorNames[c]}: ${count} (${pct}%)`;
                        barTrack.appendChild(seg);

                        const tag = document.createElement('span');
                        tag.className = 'color-dot-tag';
                        tag.innerHTML = `<span class="mana-dot" style="background: ${colorsHex[c]};"></span>${colorNames[c]}: ${pct}%`;
                        dotsLegend.appendChild(tag);
                    }
                }
            } else {
                barTrack.innerHTML = '<div style="width: 100%; height: 100%; background: var(--border-color);"></div>';
            }
        }

        // ==================== COMMANDERS MODAL LOGIC ====================

        function openCommandersModal() {
            const modal = document.getElementById('commandersModal');
            modal.style.display = 'flex';
            document.getElementById('modalCommanderSearch').value = '';
            document.getElementById('modalFilterUnusedOnly').checked = false;
            renderCommandersModalList();
        }

        function closeCommandersModal() {
            document.getElementById('commandersModal').style.display = 'none';
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeCommandersModal();
            }
        });

        function getCommandersList() {
            const searchVal = (document.getElementById('modalCommanderSearch')?.value || '').trim().toLowerCase();
            const sortVal = document.getElementById('modalCommanderSort')?.value || 'edhrec';
            const unusedOnly = document.getElementById('modalFilterUnusedOnly')?.checked || false;

            let commanders = currentCollectionData.filter(c => {
                if (!c.isCommander || c.owned === 0) return false;
                const avail = c.owned - c.inDecks;
                if (unusedOnly && avail <= 0) return false;

                if (searchVal) {
                    const matchName = c.name.toLowerCase().includes(searchVal);
                    const matchType = (c.typeLine || '').toLowerCase().includes(searchVal);
                    const matchColor = (c.colors || []).join(' ').toLowerCase().includes(searchVal);
                    if (!matchName && !matchType && !matchColor) return false;
                }
                return true;
            });

            commanders.sort((a, b) => {
                if (sortVal === 'edhrec') {
                    const rankA = a.edhrecCommanderRank || a.edhrecRank || 999999;
                    const rankB = b.edhrecCommanderRank || b.edhrecRank || 999999;
                    return rankA - rankB || a.name.localeCompare(b.name);
                } else if (sortVal === 'available') {
                    const availA = a.owned - a.inDecks;
                    const availB = b.owned - b.inDecks;
                    return availB - availA || a.name.localeCompare(b.name);
                } else if (sortVal === 'owned') {
                    return b.owned - a.owned || a.name.localeCompare(b.name);
                } else if (sortVal === 'name') {
                    return a.name.localeCompare(b.name);
                }
                return 0;
            });

            return commanders;
        }

        function renderCommandersModalList() {
            const ul = document.getElementById('modalCommandersListUl');
            ul.innerHTML = '';
            const commanders = getCommandersList();

            const subtitle = document.getElementById('modalCommandersSubtitle');
            subtitle.textContent = `${commanders.length} commanders found in collection`;

            if (commanders.length === 0) {
                ul.innerHTML = '<li style="padding: 2.5rem 1.5rem; text-align: center; color: var(--text-muted);">No commanders found matching the selected filters.</li>';
                return;
            }

            commanders.forEach(c => {
                const li = document.createElement('li');
                li.className = 'card-row-item';

                const leftDiv = document.createElement('div');
                leftDiv.className = 'card-row-left';

                const qtySpan = document.createElement('span');
                qtySpan.className = 'card-qty-badge';
                qtySpan.textContent = `${c.owned}x`;

                const detailsDiv = document.createElement('div');
                detailsDiv.className = 'card-details-block';

                const nameRow = document.createElement('div');
                nameRow.style.display = 'flex';
                nameRow.style.alignItems = 'center';
                nameRow.style.gap = '0.5rem';
                nameRow.style.flexWrap = 'wrap';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'card-name';
                nameSpan.textContent = c.name;
                nameSpan.title = "Click to view on Scryfall • Hover to preview card";
                nameSpan.onclick = (e) => {
                    openInScryfall(c.name, e);
                };
                bindImageHover(nameSpan, c.name);

                nameRow.appendChild(nameSpan);

                const edhrecRank = c.edhrecCommanderRank || c.edhrecRank;
                if (edhrecRank && edhrecRank < 999999) {
                    const rankBadge = document.createElement('span');
                    rankBadge.className = 'edhrec-badge';
                    rankBadge.textContent = `#${edhrecRank} EDHREC`;
                    nameRow.appendChild(rankBadge);
                }

                const metaDiv = document.createElement('div');
                metaDiv.className = 'card-meta-line';
                const mana = c.manaCost ? ` • ${c.manaCost}` : '';
                metaDiv.textContent = `${c.typeLine || c.category}${mana}`;

                detailsDiv.appendChild(nameRow);
                detailsDiv.appendChild(metaDiv);

                if (c.inDecksBreakdown && Object.keys(c.inDecksBreakdown).length > 0) {
                    const tagsDiv = document.createElement('div');
                    tagsDiv.className = 'deck-tags-container';
                    for (const [deckName, qty] of Object.entries(c.inDecksBreakdown)) {
                        const tag = document.createElement('span');
                        tag.className = 'deck-tag';
                        tag.textContent = `🎯 In: ${deckName} (${qty}x)`;
                        tagsDiv.appendChild(tag);
                    }
                    detailsDiv.appendChild(tagsDiv);
                }

                leftDiv.appendChild(qtySpan);
                leftDiv.appendChild(detailsDiv);

                const rightDiv = document.createElement('div');
                rightDiv.className = 'card-row-right';

                const avail = c.owned - c.inDecks;
                const statusSpan = document.createElement('span');
                if (avail > 0) {
                    statusSpan.className = 'status-used';
                    statusSpan.textContent = `${avail}x Available`;
                } else {
                    statusSpan.className = 'status-unused';
                    statusSpan.textContent = `All in decks`;
                }
                rightDiv.appendChild(statusSpan);

                li.appendChild(leftDiv);
                li.appendChild(rightDiv);
                ul.appendChild(li);
            });
        }

        function copyCommandersList() {
            const commanders = getCommandersList();
            if (commanders.length === 0) {
                showToast("No commanders to copy.");
                return;
            }
            const text = commanders.map(c => `${c.owned} ${c.name}`).join('\n');
            navigator.clipboard.writeText(text)
                .then(() => showToast(`Copied ${commanders.length} commanders to clipboard!`))
                .catch(() => showToast("Failed to copy commanders."));
        }

        function exportCommandersCSV() {
            const commanders = getCommandersList();
            if (commanders.length === 0) {
                alert("No commanders to export.");
                return;
            }

            let csvContent = "Commander Name,Owned,In Decks,Available,EDHREC Rank,Type,Mana Cost\n";
            commanders.forEach(c => {
                const safeName = c.name.replace(/"/g, '""');
                const safeType = (c.typeLine || '').replace(/"/g, '""');
                const available = Math.max(0, c.owned - c.inDecks);
                const rank = c.edhrecCommanderRank || c.edhrecRank || '';
                csvContent += `"${safeName}",${c.owned},${c.inDecks},${available},"${rank}","${safeType}","${c.manaCost || ''}"\n`;
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", "collection_commanders.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // ==================== AI DECK OPTIMIZER LOGIC ====================

        let currentAiAnalysis = null;
        let aiAnalysisInterval = null;
        let activeAiDeckId = null;

        function toggleAiApiKeyDrawer() {
            const drawer = document.getElementById('aiApiKeyDrawer');
            if (!drawer) return;
            const isHidden = drawer.style.display === 'none';
            drawer.style.display = isHidden ? 'block' : 'none';
            if (isHidden) {
                const saved = localStorage.getItem('gemini_api_key') || '';
                const input = document.getElementById('geminiApiKeyInput');
                if (input) input.value = saved;
                updateAiApiKeyStatus();
            }
        }

        function updateAiApiKeyStatus() {
            const status = document.getElementById('geminiApiKeyStatus');
            const saved = localStorage.getItem('gemini_api_key');
            if (status) {
                if (saved) {
                    status.innerHTML = `<span style="color: #10b981; font-weight: 700;">✅ Custom API Key active (${saved.substring(0, 6)}...${saved.substring(saved.length - 4)}).</span>`;
                } else {
                    status.textContent = 'Optional. If left blank, the server-configured API key is used.';
                }
            }
        }

        function saveGeminiApiKey() {
            const input = document.getElementById('geminiApiKeyInput');
            const val = (input?.value || '').trim();
            if (val) {
                localStorage.setItem('gemini_api_key', val);
                showToast("Gemini API key saved!");
            } else {
                localStorage.removeItem('gemini_api_key');
                showToast("Cleared custom API key.");
            }
            updateAiApiKeyStatus();
        }

        function openAiOptimizer(deckId) {
            const modal = document.getElementById('aiOptimizerModal');
            if (!modal) return;

            modal.style.display = 'flex';

            if (!currentDecksData || currentDecksData.length === 0) {
                renderAiNoDecksPrompt();
                return;
            }

            let targetId = deckId;
            if (!targetId || targetId === 'all') {
                if (activeDeckViewId && activeDeckViewId !== 'all') {
                    targetId = activeDeckViewId;
                } else {
                    const validDeck = currentDecksData.find(d => !d.error);
                    if (validDeck) targetId = validDeck.id;
                }
            }

            const targetDeck = currentDecksData.find(d => String(d.id) === String(targetId) && !d.error) || currentDecksData.find(d => !d.error);
            if (targetDeck) {
                activeAiDeckId = targetDeck.id;
            }

            renderAiSetupScreen();
        }

        function renderAiNoDecksPrompt() {
            const bodyEl = document.getElementById('aiModalBody');
            document.getElementById('aiModalDeckTitle').textContent = "Deck Improvement Assistant";
            document.getElementById('aiModalDeckSubtitle').textContent = "AI-powered collection upgrade recommendations";
            if (bodyEl) {
                bodyEl.innerHTML = `
                    <div style="padding: 3rem 1.5rem; text-align: center;">
                        <div style="font-size: 3.2rem; margin-bottom: 0.75rem;">🃏</div>
                        <h4 style="margin: 0 0 0.5rem 0; font-size: 1.25rem; font-weight: 800;">No Decks Scanned Yet</h4>
                        <p style="margin: 0 auto 1.5rem auto; max-width: 480px; font-size: 0.92rem; color: var(--text-muted); line-height: 1.55;">
                            Please scan your decks and collection on the main page first so Gemini AI can evaluate your cards.
                        </p>
                        <button type="button" class="main-btn" style="max-width: 260px; margin: 0 auto;" onclick="closeAiOptimizer(); runComparison();">
                            🚀 Scan & Compare Decks
                        </button>
                    </div>`;
            }
        }

        let activeAiDeckGoal = '';

        function populateAiDeckSelector() {
            // Helper function for deck selector updates
            if (document.getElementById('aiOptimizerModal')?.style.display === 'flex') {
                renderAiSetupScreen();
            }
        }

        function renderAiSetupScreen() {
            const bodyEl = document.getElementById('aiModalBody');
            if (!bodyEl) return;

            const targetDeck = currentDecksData.find(d => String(d.id) === String(activeAiDeckId)) || currentDecksData.find(d => !d.error);
            if (targetDeck) activeAiDeckId = targetDeck.id;

            document.getElementById('aiModalDeckTitle').textContent = "Deck Improvement Assistant";
            document.getElementById('aiModalDeckSubtitle').textContent = `Evaluating against ${currentCollectionData.length} collection cards`;

            const savedKey = localStorage.getItem('gemini_api_key') || '';
            const savedGoal = (targetDeck ? localStorage.getItem('archidekt_ai_goal_' + targetDeck.id) : '') || '';

            let deckOptionsHtml = '';
            currentDecksData.forEach(d => {
                if (d.error) return;
                const isSelected = String(d.id) === String(activeAiDeckId) ? 'selected' : '';
                deckOptionsHtml += `<option value="${d.id}" ${isSelected}>${d.name} (${d.ownedCards}/${d.totalCards} cards - ${d.percentComplete}%)</option>`;
            });

            bodyEl.innerHTML = `
                <div style="max-width: 600px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.15rem; padding: 0.5rem 0;">
                    
                    <!-- 1. Deck Selector -->
                    <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 12px; padding: 1.15rem;">
                        <label style="font-weight: 800; font-size: 0.95rem; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem;">
                            <span>🎯</span> 1. Select Deck to Optimize:
                        </label>
                        <select id="aiDeckPicker" style="width: 100%; font-size: 0.95rem; font-weight: 700; padding: 0.6rem 0.85rem; background-color: var(--card-bg); color: var(--text-color); border: 1px solid var(--border-color); border-radius: 8px; cursor: pointer;" onchange="onAiDeckPickerChange(this.value)">
                            ${deckOptionsHtml}
                        </select>
                        <div id="aiDeckPickerStats" style="margin-top: 0.65rem; font-size: 0.84rem; color: var(--text-muted); display: flex; gap: 0.75rem; flex-wrap: wrap;">
                            <span>✅ ${targetDeck ? targetDeck.ownedCards : 0} Owned</span> • 
                            <span>❌ ${targetDeck ? targetDeck.missingCards : 0} Missing</span> • 
                            <span>📦 ${currentCollectionData.length} Collection Cards Pool</span>
                        </div>
                    </div>

                    <!-- 2. Deck Aim & Custom Strategy Directive (Optional) -->
                    <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 12px; padding: 1.15rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.4rem;">
                            <label style="font-weight: 800; font-size: 0.95rem; margin: 0; display: flex; align-items: center; gap: 0.4rem;">
                                <span>💡</span> 2. Deck Aim / Strategy Focus (Optional):
                            </label>
                            <span style="font-size: 0.76rem; color: #a855f7; font-weight: 700;">Custom AI Directive</span>
                        </div>
                        <input type="text" id="aiDeckGoalInput" value="${savedGoal}" placeholder="e.g. Keep budget casual, focus on sacrifice synergy, lower mana curve, power bracket 6-7..." style="width: 100%; font-size: 0.9rem; padding: 0.6rem 0.85rem; background: var(--card-bg); color: var(--text-color); border: 1px solid var(--border-color); border-radius: 8px;" oninput="onAiDeckGoalInput(this.value)">
                        
                        <!-- Quick Goal Presets -->
                        <div style="margin-top: 0.65rem; display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center;">
                            <span style="font-size: 0.76rem; color: var(--text-muted); font-weight: 700; margin-right: 0.2rem;">Quick Presets:</span>
                            <button type="button" class="secondary-btn" style="font-size: 0.75rem; padding: 0.22rem 0.55rem; border-radius: 16px;" onclick="setAiGoalPreset('⚡ Lower mana curve & speed up tempo')">⚡ Lower Curve</button>
                            <button type="button" class="secondary-btn" style="font-size: 0.75rem; padding: 0.22rem 0.55rem; border-radius: 16px;" onclick="setAiGoalPreset('🛡️ More instant-speed interaction & removal')">🛡️ Interaction</button>
                            <button type="button" class="secondary-btn" style="font-size: 0.75rem; padding: 0.22rem 0.55rem; border-radius: 16px;" onclick="setAiGoalPreset('📜 Card draw engines & card advantage')">📜 Card Draw</button>
                            <button type="button" class="secondary-btn" style="font-size: 0.75rem; padding: 0.22rem 0.55rem; border-radius: 16px;" onclick="setAiGoalPreset('💀 Aristocrats & sacrifice mechanics')">💀 Aristocrats</button>
                            <button type="button" class="secondary-btn" style="font-size: 0.75rem; padding: 0.22rem 0.55rem; border-radius: 16px;" onclick="setAiGoalPreset('🎲 Casual / Mid-Power Bracket (Power Level 6-7)')">🎲 Casual (6-7)</button>
                            <button type="button" class="secondary-btn" style="font-size: 0.75rem; padding: 0.22rem 0.55rem; border-radius: 16px;" onclick="setAiGoalPreset('🏆 High power & competitive win conditions')">🏆 High Power</button>
                        </div>
                        <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.5rem; line-height: 1.4;">
                            Tell the AI if you want to aim for a specific budget, power level bracket, mechanic (e.g. tokens, counters, mill, recursion), or playstyle.
                        </div>
                    </div>

                    <!-- 3. Gemini API Key Configuration (Optional) -->
                    <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 12px; padding: 1.15rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.5rem;">
                            <label style="font-weight: 800; font-size: 0.95rem; margin: 0; display: flex; align-items: center; gap: 0.4rem;">
                                <span>🔑</span> 3. Gemini API Key (Optional):
                            </label>
                            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" style="font-size: 0.82rem; color: #a855f7; text-decoration: none; font-weight: 700;">
                                Get Free Key ↗
                            </a>
                        </div>
                        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                            <input type="password" id="aiApiKeyField" value="${savedKey}" placeholder="Optional: Paste Gemini key for AI commentary..." style="flex: 1; min-width: 220px; font-size: 0.9rem; padding: 0.55rem 0.85rem;" oninput="onAiApiKeyInput(this.value)">
                            <button type="button" class="secondary-btn" onclick="toggleApiKeyVisibility()" style="padding: 0.55rem 0.85rem; font-size: 0.85rem;" id="btnToggleKeyVis">👁️ Show</button>
                        </div>
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.55rem; line-height: 1.45;">
                            ⚡ <strong>100% Automatic:</strong> Works automatically using the built-in Magic strategy engine. Adding a free Gemini key is completely optional if you want personalized AI strategic commentary.
                        </div>
                    </div>

                    <!-- 4. Launch Analysis Button -->
                    <div>
                        <button type="button" class="main-btn" onclick="startAiAnalysis()" style="background: linear-gradient(135deg, #8b5cf6, #6366f1); color: white; box-shadow: 0 4px 16px rgba(139, 92, 246, 0.35); font-size: 1.05rem; padding: 0.9rem 1.5rem; border-radius: 10px;">
                            <span>✨</span> Find Improvements from Collection
                        </button>
                    </div>
                </div>`;
        }

        function onAiDeckPickerChange(deckId) {
            activeAiDeckId = deckId;
            const targetDeck = currentDecksData.find(d => String(d.id) === String(deckId));
            const statsEl = document.getElementById('aiDeckPickerStats');
            if (statsEl && targetDeck) {
                statsEl.innerHTML = `
                    <span>✅ ${targetDeck.ownedCards} Owned</span> • 
                    <span>❌ ${targetDeck.missingCards} Missing</span> • 
                    <span>📦 ${currentCollectionData.length} Collection Cards Pool</span>`;
            }
            const goalInput = document.getElementById('aiDeckGoalInput');
            if (goalInput && targetDeck) {
                goalInput.value = localStorage.getItem('archidekt_ai_goal_' + targetDeck.id) || '';
            }
        }

        function onAiDeckGoalInput(val) {
            activeAiDeckGoal = (val || '').trim();
            if (activeAiDeckId) {
                if (activeAiDeckGoal) {
                    localStorage.setItem('archidekt_ai_goal_' + activeAiDeckId, activeAiDeckGoal);
                } else {
                    localStorage.removeItem('archidekt_ai_goal_' + activeAiDeckId);
                }
            }
        }

        function setAiGoalPreset(val) {
            const input = document.getElementById('aiDeckGoalInput');
            if (input) {
                input.value = val;
                onAiDeckGoalInput(val);
            }
        }

        function onAiApiKeyInput(val) {
            const trimmed = (val || '').trim();
            if (trimmed) {
                localStorage.setItem('gemini_api_key', trimmed);
            } else {
                localStorage.removeItem('gemini_api_key');
            }
        }

        function toggleApiKeyVisibility() {
            const input = document.getElementById('aiApiKeyField');
            const btn = document.getElementById('btnToggleKeyVis');
            if (!input || !btn) return;
            if (input.type === 'password') {
                input.type = 'text';
                btn.textContent = '🔒 Hide';
            } else {
                input.type = 'password';
                btn.textContent = '👁️ Show';
            }
        }

        function startAiAnalysis() {
            const picker = document.getElementById('aiDeckPicker');
            if (picker && picker.value) {
                activeAiDeckId = picker.value;
            }

            const goalInput = document.getElementById('aiDeckGoalInput');
            activeAiDeckGoal = (goalInput?.value || '').trim() || (activeAiDeckId ? localStorage.getItem('archidekt_ai_goal_' + activeAiDeckId) || '' : '');
            if (activeAiDeckId && activeAiDeckGoal) {
                localStorage.setItem('archidekt_ai_goal_' + activeAiDeckId, activeAiDeckGoal);
            }

            const keyInput = document.getElementById('aiApiKeyField');
            const enteredKey = (keyInput?.value || '').trim() || localStorage.getItem('gemini_api_key') || '';

            if (enteredKey) {
                localStorage.setItem('gemini_api_key', enteredKey);
            }

            const targetDeck = currentDecksData.find(d => String(d.id) === String(activeAiDeckId));
            if (!targetDeck || targetDeck.error) {
                alert("Please select a valid deck first.");
                return;
            }

            const bodyEl = document.getElementById('aiModalBody');
            document.getElementById('aiModalDeckTitle').textContent = targetDeck.name;
            document.getElementById('aiModalDeckSubtitle').textContent = activeAiDeckGoal ? `Aim: "${activeAiDeckGoal}" • ${currentCollectionData.length} collection cards` : `Evaluating against ${currentCollectionData.length} collection cards`;

            if (bodyEl) {
                bodyEl.innerHTML = `
                    <div style="text-align: center; padding: 3.5rem 1.5rem;">
                        <div class="ai-pulse-glow" style="font-size: 3.2rem; margin-bottom: 1.2rem;">✨</div>
                        <div style="font-size: 1.25rem; font-weight: 800; margin-bottom: 0.4rem; letter-spacing: -0.01em;">
                            Looking for improvements to "${targetDeck.name}" from your existing collection...
                        </div>
                        ${activeAiDeckGoal ? `<div style="font-size: 0.88rem; color: #c084fc; font-weight: 700; margin-bottom: 0.5rem;">🎯 Aim: "${activeAiDeckGoal}"</div>` : ''}
                        <div id="aiAnalysisTicker" style="font-size: 0.92rem; color: var(--text-muted); min-height: 1.6rem; font-weight: 500;">
                            Scanning your collection for high-synergy cards...
                        </div>
                        <div style="margin-top: 1.75rem; display: flex; justify-content: center; gap: 0.4rem;">
                            <span class="spinner" style="width: 22px; height: 22px; border-width: 2.5px;"></span>
                        </div>
                    </div>`;
            }

            runAiDeckAnalysis();
        }

        function closeAiOptimizer() {
            const modal = document.getElementById('aiOptimizerModal');
            if (modal) modal.style.display = 'none';
            if (aiAnalysisInterval) {
                clearInterval(aiAnalysisInterval);
                aiAnalysisInterval = null;
            }
        }

        async function runAiDeckAnalysis() {
            const bodyEl = document.getElementById('aiModalBody');
            if (!bodyEl) return;

            const targetDeck = currentDecksData.find(d => String(d.id) === String(activeAiDeckId));
            if (!targetDeck || targetDeck.error) {
                bodyEl.innerHTML = `
                    <div style="padding: 2.5rem 1.5rem; text-align: center; color: var(--status-missing);">
                        <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
                        <div style="font-weight: 700; font-size: 1.1rem;">Unable to analyze this deck.</div>
                        <div style="font-size: 0.88rem; color: var(--text-muted); margin-top: 0.25rem;">${targetDeck ? targetDeck.error : 'Deck data not found.'}</div>
                    </div>`;
                return;
            }

            if (!currentCollectionData || currentCollectionData.length === 0) {
                bodyEl.innerHTML = `
                    <div style="padding: 2.5rem 1.5rem; text-align: center; color: var(--text-muted);">
                        <div style="font-size: 2rem; margin-bottom: 0.5rem;">📦</div>
                        <div style="font-weight: 700; font-size: 1.1rem;">No collection data available.</div>
                        <div style="font-size: 0.88rem; color: var(--text-muted); margin-top: 0.25rem;">Please enter your Archidekt Collection ID and run a scan first.</div>
                    </div>`;
                return;
            }

            // Cycling status messages
            const loadingMessages = [
                "Scanning your collection for high-synergy cards...",
                "Evaluating deck archetype, commander strategy & mana curve...",
                activeAiDeckGoal ? `Tailoring recommendations to match your aim: "${activeAiDeckGoal}"...` : "Testing card advantage engines & interaction packages...",
                "Calculating high-impact upgrades and recommended swaps...",
                "Drafting strategic rationale with Gemini AI..."
            ];
            let msgIdx = 0;

            if (aiAnalysisInterval) clearInterval(aiAnalysisInterval);
            aiAnalysisInterval = setInterval(() => {
                msgIdx = (msgIdx + 1) % loadingMessages.length;
                const ticker = document.getElementById('aiAnalysisTicker');
                if (ticker) ticker.textContent = loadingMessages[msgIdx];
            }, 2200);

            const savedApiKey = localStorage.getItem('gemini_api_key') || undefined;

            try {
                let response = await fetch('/suggestImprovements', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        deck: targetDeck,
                        collection: currentCollectionData,
                        apiKey: savedApiKey,
                        deckGoal: activeAiDeckGoal || undefined
                    })
                });

                // Fallback to direct cloud function endpoint if hosting rewrite is pending
                if (response.status === 404 || response.status === 502 || response.status === 504) {
                    console.warn("Hosting rewrite unavailable, falling back to direct cloud function URL...");
                    response = await fetch('https://us-central1-commander-challenge.cloudfunctions.net/suggestImprovements', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            deck: targetDeck,
                            collection: currentCollectionData,
                            apiKey: savedApiKey,
                            deckGoal: activeAiDeckGoal || undefined
                        })
                    });
                }

                if (aiAnalysisInterval) {
                    clearInterval(aiAnalysisInterval);
                    aiAnalysisInterval = null;
                }

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    const errMsg = errData.error || `Server returned HTTP ${response.status}`;
                    renderAiError(errMsg);
                    return;
                }

                const data = await response.json();
                if (!data || !data.analysis) {
                    renderAiError("Received empty or invalid analysis from Gemini AI.");
                    return;
                }

                currentAiAnalysis = data.analysis;
                renderAiAnalysisResults(targetDeck, data.analysis);
            } catch (err) {
                if (aiAnalysisInterval) {
                    clearInterval(aiAnalysisInterval);
                    aiAnalysisInterval = null;
                }
                renderAiError(err.message || "Failed to communicate with AI optimization service.");
            }
        }

        function renderAiError(errMsg) {
            const bodyEl = document.getElementById('aiModalBody');
            if (!bodyEl) return;

            bodyEl.innerHTML = `
                <div style="padding: 2.5rem 1.5rem; text-align: center;">
                    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">⚠️</div>
                    <div style="font-weight: 800; font-size: 1.15rem; color: var(--status-missing); margin-bottom: 0.5rem;">AI Optimization Notice</div>
                    <div style="font-size: 0.9rem; color: var(--text-color); max-width: 500px; margin: 0 auto 1.5rem auto; line-height: 1.5;">
                        ${errMsg}
                    </div>
                    <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
                        <button type="button" class="secondary-btn" onclick="renderAiSetupScreen()" style="font-weight: 700; padding: 0.5rem 1.2rem;">
                            ⚙️ Check Settings & Key
                        </button>
                        <button type="button" class="main-btn" onclick="startAiAnalysis()" style="font-weight: 700; padding: 0.5rem 1.2rem; width: auto;">
                            🔄 Try Again
                        </button>
                    </div>
                </div>`;
        }

        function renderAiAnalysisResults(deck, analysis) {
            const bodyEl = document.getElementById('aiModalBody');
            if (!bodyEl) return;

            const suggestions = analysis.suggestions || [];
            const hasUpgrades = analysis.hasImprovements && suggestions.length > 0;

            let html = '';

            // Overall Deck Assessment Box
            const engineBadge = analysis.engine === 'gemini' 
                ? `<span style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 20px; padding: 0.2rem 0.65rem; font-size: 0.76rem; color: #34d399; font-weight: 700;">✨ Gemini AI</span>`
                : `<span style="background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 20px; padding: 0.2rem 0.65rem; font-size: 0.76rem; color: #818cf8; font-weight: 700;">🧠 MTG Synergy Engine</span>`;

            html += `
                <div class="ai-overall-banner">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.6rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                            <span style="font-weight: 800; font-size: 0.95rem; color: #c084fc; text-transform: uppercase; letter-spacing: 0.04em;">
                                🎯 Archetype: ${analysis.deckArchetype || 'Custom Strategy'}
                            </span>
                            ${engineBadge}
                        </div>
                        <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
                            <button type="button" class="secondary-btn" onclick="renderAiSetupScreen()" style="padding: 0.25rem 0.65rem; font-size: 0.8rem;" title="Select another deck or edit aim">🎯 Switch / Edit Aim</button>
                            <button type="button" class="secondary-btn" onclick="startAiAnalysis()" style="padding: 0.25rem 0.65rem; font-size: 0.8rem;" title="Re-evaluate deck with AI">🔄 Re-analyze</button>
                            ${hasUpgrades ? `<button type="button" class="secondary-btn" onclick="copyAllAiSwaps()" style="padding: 0.25rem 0.65rem; font-size: 0.8rem;" title="Copy all suggested adds & cuts">📋 Copy Swaps</button>` : ''}
                        </div>
                    </div>
                    ${activeAiDeckGoal ? `<div style="display: inline-flex; align-items: center; gap: 0.35rem; background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 20px; padding: 0.2rem 0.65rem; font-size: 0.78rem; color: #c084fc; font-weight: 700; margin-bottom: 0.6rem;"><span>🎯 Stated Aim:</span> "${activeAiDeckGoal}"</div>` : ''}
                    <div style="font-size: 0.92rem; line-height: 1.55; color: var(--text-color);">
                        ${analysis.overallAssessment || 'Deck analysis complete.'}
                    </div>
                </div>`;

            // If No Improvements Found
            if (!hasUpgrades) {
                html += `
                    <div style="padding: 2.5rem 1.5rem; text-align: center; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 14px;">
                        <div style="font-size: 3rem; margin-bottom: 0.75rem;">🎉</div>
                        <h4 style="margin: 0 0 0.5rem 0; font-size: 1.3rem; font-weight: 800; color: #34d399;">No Improvements Needed!</h4>
                        <p style="margin: 0 auto 1.5rem auto; max-width: 580px; font-size: 0.92rem; color: var(--text-color); line-height: 1.55;">
                            ${analysis.noImprovementsReason || 'All available cards in your collection were evaluated, and your decklist is already running an optimal configuration with your current pool.'}
                        </p>
                        <button type="button" class="secondary-btn" onclick="renderAiSetupScreen()" style="padding: 0.5rem 1.25rem; font-weight: 700; margin: 0 auto;">
                            🎯 Choose Another Deck
                        </button>
                    </div>`;
                bodyEl.innerHTML = html;
                return;
            }

            // Suggestions Header
            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div style="font-weight: 800; font-size: 1.05rem;">
                        💡 Recommended Upgrades from Collection (${suggestions.length})
                    </div>
                    <span style="font-size: 0.8rem; color: var(--text-muted);">
                        Click cards to copy • Hover to preview artwork
                    </span>
                </div>`;

            // Suggestions List
            html += '<div style="display: flex; flex-direction: column; gap: 0.5rem;">';
            suggestions.forEach((sug, idx) => {
                const impactClass = sug.impactRating === 'High' ? 'ai-impact-high' : (sug.impactRating === 'Medium' ? 'ai-impact-medium' : 'ai-impact-synergy');
                const impactLabel = sug.impactRating === 'High' ? '🚀 High Impact' : (sug.impactRating === 'Medium' ? '⚡ Good Upgrade' : '✨ Synergy Tech');

                html += `
                    <div class="ai-suggestion-card" id="aiSuggestionCard_${idx}">
                        <!-- Top Header: Add Card Info & Badges -->
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.5rem;">
                            <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
                                <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; font-weight: 800; font-size: 0.82rem; padding: 0.2rem 0.5rem; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.4);">+ ADD</span>
                                <span class="card-name" style="font-size: 1.08rem; font-weight: 800;" onclick="openInScryfall('${sug.addCardName.replace(/'/g, "\\'")}', event)" onmouseenter="bindHoverName(this, '${sug.addCardName.replace(/'/g, "\\'")}')" title="Click to view on Scryfall • Hover to preview card">${sug.addCardName} <span style="font-size: 0.75rem; color: #a855f7; opacity: 0.85;">↗</span></span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                                ${sug.category ? `<span class="badge" style="background: var(--card-hover); color: var(--text-color);">${sug.category}</span>` : ''}
                                <span class="ai-impact-badge ${impactClass}">${impactLabel}</span>
                            </div>
                        </div>

                        <!-- Why Add Description -->
                        <div style="margin-top: 0.75rem; font-size: 0.9rem; line-height: 1.55; color: var(--text-color);">
                            <strong>Why it improves the deck:</strong> ${sug.whyAdd}
                        </div>

                        <!-- Swap Recommendation Toggle Button -->
                        <div style="margin-top: 0.85rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                            <button type="button" class="secondary-btn" id="btnSwapToggle_${idx}" onclick="toggleAiSwapView(${idx})" style="font-weight: 700; font-size: 0.82rem; padding: 0.35rem 0.75rem; border-color: rgba(168, 85, 247, 0.4); color: #c084fc; background: rgba(168, 85, 247, 0.08);">
                                🔄 Recommended Swap: Cut "${sug.recommendedCut || 'Card'}" ▾
                            </button>
                            <span style="font-size: 0.78rem; color: var(--text-muted);">${sug.available ? `${sug.available} unused copy available` : 'Unused in other decks'}</span>
                        </div>

                        <!-- Expandable Swap Block -->
                        <div class="ai-swap-container" id="aiSwapBox_${idx}" style="display: block;">
                            <div class="ai-swap-grid">
                                <!-- + ADD Card Box -->
                                <div class="ai-card-pill-add">
                                    <div style="font-size: 0.75rem; font-weight: 800; color: #34d399; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.25rem;">+ Add into Deck</div>
                                    <div class="card-name" style="font-weight: 700; font-size: 0.95rem;" onclick="openInScryfall('${sug.addCardName.replace(/'/g, "\\'")}', event)" onmouseenter="bindHoverName(this, '${sug.addCardName.replace(/'/g, "\\'")}')" title="Click to view on Scryfall • Hover to preview card">${sug.addCardName} ↗</div>
                                </div>

                                <!-- Swap Arrow -->
                                <div style="text-align: center; color: var(--text-muted); font-size: 1.25rem; font-weight: 800;">
                                    ↔
                                </div>

                                <!-- ↔ CUT Card Box -->
                                <div class="ai-card-pill-cut">
                                    <div style="font-size: 0.75rem; font-weight: 800; color: #f87171; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.25rem;">↔ Cut from Deck</div>
                                    <div class="card-name" style="font-weight: 700; font-size: 0.95rem; color: #fca5a5;" onclick="openInScryfall('${sug.recommendedCut.replace(/'/g, "\\'")}', event)" onmouseenter="bindHoverName(this, '${sug.recommendedCut.replace(/'/g, "\\'")}')" title="Click to view on Scryfall • Hover to preview card">${sug.recommendedCut} ↗</div>
                                </div>
                            </div>

                            <!-- Why This Swap Is Better -->
                            <div class="ai-rationale-box">
                                <strong>Why this swap is an upgrade:</strong> ${sug.whySwap}
                            </div>

                            <!-- Alternative Cuts -->
                            ${sug.alternativeCuts && sug.alternativeCuts.length > 0 ? `
                                <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.35rem; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                                    <span>Alternative cuts:</span>
                                    ${sug.alternativeCuts.map(alt => `<span class="badge" style="cursor: pointer;" onclick="openInScryfall('${alt.replace(/'/g, "\\'")}', event)" onmouseenter="bindHoverName(this, '${alt.replace(/'/g, "\\'")}')" title="Click to view on Scryfall • Hover to preview card">${alt} ↗</span>`).join('')}
                                </div>
                            ` : ''}
                        </div>
                    </div>`;
            });
            html += '</div>';

            bodyEl.innerHTML = html;
        }

        function toggleAiSwapView(idx) {
            const box = document.getElementById(`aiSwapBox_${idx}`);
            const btn = document.getElementById(`btnSwapToggle_${idx}`);
            if (!box || !btn) return;
            const isHidden = box.style.display === 'none';
            box.style.display = isHidden ? 'block' : 'none';
            btn.innerHTML = `🔄 Recommended Swap: Cut "${(currentAiAnalysis?.suggestions?.[idx]?.recommendedCut || 'Card')}" ${isHidden ? '▾' : '▸'}`;
        }

        function copyCardText(name, event) {
            if (event) event.stopPropagation();
            navigator.clipboard.writeText(name)
                .then(() => showToast(`Copied "${name}"!`))
                .catch(() => { });
        }

        function copyAllAiSwaps() {
            if (!currentAiAnalysis || !currentAiAnalysis.suggestions || currentAiAnalysis.suggestions.length === 0) {
                showToast("No suggestions to copy.");
                return;
            }

            const targetDeck = currentDecksData.find(d => d.id === activeAiDeckId);
            const deckName = targetDeck ? targetDeck.name : 'Deck';

            let text = `=== Gemini AI Suggested Improvements for ${deckName} ===\n`;
            text += `Archetype: ${currentAiAnalysis.deckArchetype || 'Custom'}\n`;
            if (activeAiDeckGoal) {
                text += `Stated Aim: "${activeAiDeckGoal}"\n`;
            }
            text += `\n`;

            currentAiAnalysis.suggestions.forEach((sug, i) => {
                text += `${i + 1}. + ADD: ${sug.addCardName}\n`;
                text += `   ↔ CUT: ${sug.recommendedCut}\n`;
                text += `   Why Add: ${sug.whyAdd}\n`;
                text += `   Why Swap: ${sug.whySwap}\n\n`;
            });

            navigator.clipboard.writeText(text)
                .then(() => showToast(`Copied ${currentAiAnalysis.suggestions.length} swaps to clipboard!`))
                .catch(() => showToast("Failed to copy swaps."));
        }

        // ==================== INVENTORY LIST LOGIC ====================

        function onInventorySearchInput(val) {
            const clearBtn = document.getElementById('inventorySearchClearBtn');
            if (clearBtn) {
                clearBtn.style.display = val && val.trim() ? 'flex' : 'none';
            }
            renderList();
        }

        function clearInventorySearch() {
            const input = document.getElementById('inventorySearch');
            if (input) input.value = '';
            const clearBtn = document.getElementById('inventorySearchClearBtn');
            if (clearBtn) clearBtn.style.display = 'none';
            renderList();
        }

        function getFilteredData() {
            const showUnusedOnly = document.getElementById('filterUnused')?.checked || false;
            const showMissingOnly = document.getElementById('filterMissing')?.checked || false;
            const showCommandersOnly = document.getElementById('filterCommandersOnly')?.checked || false;
            const sortOrder = document.getElementById('sortOrder')?.value || 'name';
            const colorFilter = document.getElementById('inventoryColorFilter')?.value || 'all';
            const catFilter = document.getElementById('inventoryCategoryFilter')?.value || 'all';
            const searchVal = (document.getElementById('inventorySearch')?.value || '').trim().toLowerCase();

            const totalCollectionCount = currentCollectionData.length;

            let data = currentCollectionData.filter(card => {
                if (showUnusedOnly && card.owned <= card.inDecks) return false;
                if (showMissingOnly && card.owned >= card.inDecks) return false;
                if (showCommandersOnly && !card.isCommander) return false;

                // Color Filter
                if (colorFilter !== 'all') {
                    const cardColors = (card.colors || []).map(c => c.toUpperCase());
                    if (colorFilter === 'colorless' && cardColors.length > 0) return false;
                    else if (colorFilter === 'multi' && cardColors.length < 2) return false;
                    else if (['W', 'U', 'B', 'R', 'G'].includes(colorFilter) && !cardColors.includes(colorFilter)) return false;
                }

                // Category / Type Filter
                if (catFilter !== 'all') {
                    const cardCat = (card.category || '').toLowerCase();
                    const cardType = (card.typeLine || '').toLowerCase();
                    const filterLower = catFilter.toLowerCase();
                    if (!cardCat.includes(filterLower) && !cardType.includes(filterLower)) return false;
                }

                // Dynamic Live Search across Name, Type, Mana, Colors, Deck Names
                if (searchVal) {
                    const matchName = (card.name || '').toLowerCase().includes(searchVal);
                    const matchType = (card.typeLine || '').toLowerCase().includes(searchVal);
                    const matchMana = (card.manaCost || '').toLowerCase().includes(searchVal);
                    const matchCat = (card.category || '').toLowerCase().includes(searchVal);
                    const matchColors = (card.colors || []).join('').toLowerCase().includes(searchVal);
                    const matchDecks = card.inDecksBreakdown
                        ? Object.keys(card.inDecksBreakdown).some(d => d.toLowerCase().includes(searchVal))
                        : false;

                    if (!matchName && !matchType && !matchMana && !matchCat && !matchColors && !matchDecks) {
                        return false;
                    }
                }

                return true;
            });

            // Update live counter badge
            const showCountEl = document.getElementById('inventoryShowingCount');
            const totCountEl = document.getElementById('inventoryTotalCount');
            if (showCountEl) showCountEl.textContent = data.length;
            if (totCountEl) totCountEl.textContent = totalCollectionCount;

            data.sort((a, b) => {
                if (sortOrder === 'name') {
                    return a.name.localeCompare(b.name);
                } else if (sortOrder === 'edhrec') {
                    const rankA = a.edhrecCommanderRank || a.edhrecRank || 999999;
                    const rankB = b.edhrecCommanderRank || b.edhrecRank || 999999;
                    return rankA - rankB || a.name.localeCompare(b.name);
                } else if (sortOrder === 'owned') {
                    return b.owned - a.owned;
                } else if (sortOrder === 'used') {
                    return b.inDecks - a.inDecks;
                } else if (sortOrder === 'available') {
                    const availA = a.owned - a.inDecks;
                    const availB = b.owned - b.inDecks;
                    return availB - availA;
                } else if (sortOrder === 'missing') {
                    const defA = Math.max(0, a.inDecks - a.owned);
                    const defB = Math.max(0, b.inDecks - b.owned);
                    return defB - defA;
                }
                return 0;
            });

            return data;
        }

        function renderList() {
            const collectionList = document.getElementById('collectionList');
            collectionList.innerHTML = '';

            const data = getFilteredData();
            if (data.length === 0) {
                collectionList.innerHTML = `
                    <li style="padding: 3rem 1.5rem; text-align: center; color: var(--text-muted);">
                        <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
                        <div style="font-weight: 700; font-size: 1.05rem; margin-bottom: 0.25rem;">No collection cards found matching your search.</div>
                        <button type="button" class="secondary-btn" style="margin-top: 0.75rem;" onclick="clearInventorySearch()">Clear Search Filter</button>
                    </li>`;
                return;
            }

            data.forEach(card => {
                const li = document.createElement('li');
                li.className = 'card-row-item';

                const leftDiv = document.createElement('div');
                leftDiv.className = 'card-row-left';

                const qtySpan = document.createElement('span');
                qtySpan.className = 'card-qty-badge';
                qtySpan.textContent = `${card.owned}x`;

                const detailsDiv = document.createElement('div');
                detailsDiv.className = 'card-details-block';

                const nameRow = document.createElement('div');
                nameRow.style.display = 'flex';
                nameRow.style.alignItems = 'center';
                nameRow.style.gap = '0.5rem';
                nameRow.style.flexWrap = 'wrap';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'card-name';
                nameSpan.textContent = card.name;
                nameSpan.title = "Click to view on Scryfall • Hover to preview card";

                nameSpan.addEventListener('click', (e) => {
                    openInScryfall(card.name, e);
                });
                bindImageHover(nameSpan, card.name);

                nameRow.appendChild(nameSpan);

                if (card.isCommander) {
                    const commBadge = document.createElement('span');
                    commBadge.className = 'badge';
                    commBadge.style.background = 'rgba(168, 85, 247, 0.15)';
                    commBadge.style.color = '#c084fc';
                    commBadge.style.border = '1px solid rgba(168, 85, 247, 0.3)';
                    const edhRank = card.edhrecCommanderRank || card.edhrecRank;
                    commBadge.textContent = edhRank && edhRank < 999999 ? `👑 #${edhRank}` : '👑 Commander';
                    nameRow.appendChild(commBadge);
                }

                const metaDiv = document.createElement('div');
                metaDiv.className = 'card-meta-line';
                const mana = card.manaCost ? ` • ${card.manaCost}` : '';
                metaDiv.textContent = `${card.typeLine || card.category}${mana}`;

                detailsDiv.appendChild(nameRow);
                detailsDiv.appendChild(metaDiv);

                // Show explicit deck badges for each deck this card is in
                if (card.inDecksBreakdown && Object.keys(card.inDecksBreakdown).length > 0) {
                    const tagsDiv = document.createElement('div');
                    tagsDiv.className = 'deck-tags-container';
                    for (const [deckName, qty] of Object.entries(card.inDecksBreakdown)) {
                        const tag = document.createElement('span');
                        tag.className = 'deck-tag';
                        tag.textContent = `🎯 In: ${deckName} (${qty}x)`;
                        tagsDiv.appendChild(tag);
                    }
                    detailsDiv.appendChild(tagsDiv);
                }

                leftDiv.appendChild(qtySpan);
                leftDiv.appendChild(detailsDiv);

                const rightDiv = document.createElement('div');
                rightDiv.className = 'card-row-right';

                const statusSpan = document.createElement('span');
                if (card.inDecks > card.owned) {
                    statusSpan.className = 'status-missing';
                    const deficit = card.inDecks - card.owned;
                    statusSpan.textContent = `Missing ${deficit}x (Need ${card.inDecks})`;
                } else if (card.inDecks > 0) {
                    statusSpan.className = 'status-used';
                    statusSpan.textContent = `In decks (${card.inDecks}x)`;
                } else {
                    statusSpan.className = 'status-unused';
                    statusSpan.textContent = `Unused`;
                }

                rightDiv.appendChild(statusSpan);

                li.appendChild(leftDiv);
                li.appendChild(rightDiv);
                collectionList.appendChild(li);
            });
        }

        function exportCSV() {
            const data = getFilteredData();
            if (data.length === 0) {
                alert("No cards to export.");
                return;
            }

            let csvContent = "Name,Owned,In Decks,Available,Missing\n";
            data.forEach(card => {
                const safeName = card.name.replace(/"/g, '""');
                const available = Math.max(0, card.owned - card.inDecks);
                const missing = Math.max(0, card.inDecks - card.owned);
                csvContent += `"${safeName}",${card.owned},${card.inDecks},${available},${missing}\n`;
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", "archidekt_inventory.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        function copyToClipboard() {
            const unusedCards = currentCollectionData.filter(card => card.owned > card.inDecks);
            if (unusedCards.length === 0) {
                showToast("No unused cards to copy.");
                return;
            }

            const textContent = unusedCards.map(card => {
                const available = card.owned - card.inDecks;
                return `${available} ${card.name}`;
            }).join('\n');

            navigator.clipboard.writeText(textContent)
                .then(() => showToast("Unused cards copied to clipboard!"))
                .catch(() => showToast("Failed to copy cards."));
        }

        function showToast(msg) {
            let toast = document.getElementById('toastMsg');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'toastMsg';
                toast.className = 'toast';
                document.body.appendChild(toast);
            }
            toast.textContent = msg;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2200);
        }

        // ==================== SET CHECKLIST LOGIC ====================

        async function loadSetsList() {
            try {
                const cached = sessionStorage.getItem('scryfall_sets');
                if (cached) {
                    allMagicSets = JSON.parse(cached);
                    return;
                }

                let res;
                try {
                    res = await fetch('/getSets');
                } catch (e) {
                    res = await fetch('https://api.scryfall.com/sets');
                }

                if (res.ok) {
                    const data = await res.json();
                    allMagicSets = data.sets || (data.data ? data.data.map(s => ({
                        code: s.code.toLowerCase(),
                        name: s.name,
                        released_at: s.released_at || '',
                        set_type: s.set_type || 'expansion',
                        card_count: s.card_count || 0,
                        icon_svg_uri: s.icon_svg_uri || '',
                        digital: Boolean(s.digital)
                    })) : []);

                    sessionStorage.setItem('scryfall_sets', JSON.stringify(allMagicSets));
                }
            } catch (err) {
                console.warn("Could not preload set list:", err);
            }
        }

        function handleSetSearch(query) {
            const dropdown = document.getElementById('setDropdown');
            const trimmed = (query || '').trim().toLowerCase();

            if (!trimmed || allMagicSets.length === 0) {
                dropdown.style.display = 'none';
                return;
            }

            const matches = allMagicSets.filter(s =>
                s.code.toLowerCase() === trimmed ||
                s.code.toLowerCase().startsWith(trimmed) ||
                s.name.toLowerCase().includes(trimmed)
            ).slice(0, 15);

            if (matches.length === 0) {
                dropdown.style.display = 'none';
                return;
            }

            dropdown.innerHTML = '';
            matches.forEach(setObj => {
                const item = document.createElement('div');
                item.className = 'autocomplete-item';
                item.onclick = () => selectSet(setObj);

                const iconHtml = setObj.icon_svg_uri
                    ? `<img class="set-icon-img" src="${setObj.icon_svg_uri}" alt="${setObj.code}" onerror="this.style.display='none'">`
                    : '<span style="font-size: 1.1rem;">📦</span>';

                const year = setObj.released_at ? setObj.released_at.substring(0, 4) : '';
                const cardCount = setObj.card_count ? `${setObj.card_count} cards` : '';
                const meta = [year, cardCount].filter(Boolean).join(' • ');

                item.innerHTML = `
                    <div class="set-item-left">
                        ${iconHtml}
                        <div>
                            <div class="set-item-name">${setObj.name}</div>
                            ${meta ? `<div class="set-item-details">${meta}</div>` : ''}
                        </div>
                    </div>
                    <span class="badge badge-code">${setObj.code.toUpperCase()}</span>
                `;
                dropdown.appendChild(item);
            });

            dropdown.style.display = 'block';
        }

        function selectSet(setObj) {
            selectedSet = setObj;
            document.getElementById('setSearchInput').value = '';
            document.getElementById('setDropdown').style.display = 'none';

            const selectedBox = document.getElementById('selectedSetBox');
            const nameEl = document.getElementById('selectedSetName');
            const metaEl = document.getElementById('selectedSetMeta');
            const iconEl = document.getElementById('selectedSetIcon');

            nameEl.textContent = setObj.name;
            const year = setObj.released_at ? setObj.released_at.substring(0, 4) : '';
            const count = setObj.card_count ? `${setObj.card_count} cards` : '';
            metaEl.textContent = [setObj.code.toUpperCase(), year, count].filter(Boolean).join(' • ');

            if (setObj.icon_svg_uri) {
                iconEl.src = setObj.icon_svg_uri;
                iconEl.style.display = 'inline-block';
            } else {
                iconEl.style.display = 'none';
            }

            selectedBox.style.display = 'flex';
            document.getElementById('quickSets').style.display = 'none';

            localStorage.setItem('archidekt_selectedSetCode', setObj.code);
            const params = new URLSearchParams(window.location.search);
            params.set('setCode', setObj.code);
            window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
        }

        function selectSetByCode(code) {
            const clean = (code || '').toLowerCase().trim();
            const found = allMagicSets.find(s => s.code === clean);
            if (found) {
                selectSet(found);
            } else {
                selectSet({
                    code: clean,
                    name: clean.toUpperCase(),
                    released_at: '',
                    set_type: 'expansion',
                    card_count: 0,
                    icon_svg_uri: `https://svgs.scryfall.io/sets/${clean}.svg`
                });
            }
        }

        function clearSelectedSet() {
            selectedSet = null;
            document.getElementById('selectedSetBox').style.display = 'none';
            document.getElementById('quickSets').style.display = 'flex';
            document.getElementById('setSearchInput').focus();

            localStorage.removeItem('archidekt_selectedSetCode');
            const params = new URLSearchParams(window.location.search);
            params.delete('setCode');
            window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
        }

        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('setDropdown');
            const input = document.getElementById('setSearchInput');
            if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
                dropdown.style.display = 'none';
            }
        });

        async function runSetComparison() {
            if (!selectedSet) {
                const searchVal = document.getElementById('setSearchInput').value.trim();
                if (searchVal) {
                    selectSetByCode(searchVal);
                } else {
                    alert("Please search and select a Magic set first.");
                    return;
                }
            }

            let collectionId = document.getElementById('collectionId')?.value.trim() || localStorage.getItem('archidekt_collectionId') || '';
            const collMatch = collectionId.match(/(?:archidekt\.com\/collections?\/)(\d+)/i);
            if (collMatch) collectionId = collMatch[1];
            else {
                const rawNum = collectionId.match(/\d+/);
                if (rawNum && /^\d+$/.test(collectionId)) collectionId = rawNum[0];
            }

            const csvInput = document.getElementById('csvUpload');
            const csvFile = csvInput && csvInput.files && csvInput.files.length > 0 ? csvInput.files[0] : null;

            let collectionCsvData = cachedParsedCsv || AppStorage.loadCsv();
            if (collectionCsvData && !cachedParsedCsv) cachedParsedCsv = collectionCsvData;

            if (csvFile && !collectionCsvData) {
                try {
                    const csvText = await readCSVFile(csvFile);
                    collectionCsvData = parseCSV(csvText);
                    cachedParsedCsv = collectionCsvData;
                    AppStorage.saveCsv(collectionCsvData);
                    updateCollectionStatusBadge();
                } catch (e) {
                    alert("Error parsing CSV: " + e.message);
                    btn.disabled = false;
                    btn.innerHTML = '<span>Check Set Progress</span>';
                    return;
                }
            }

            // If we have an Archidekt collection ID and NO uploaded CSV:
            // Use stored or in-memory collection cards directly for sub-second execution with zero external API hits!
            if (!collectionCsvData && collectionId) {
                const storedArch = AppStorage.loadArchidektCollection(collectionId);
                const candidate = (storedArch && storedArch.length > 0)
                    ? storedArch
                    : ((currentCollectionData && currentCollectionData.length > 0) ? currentCollectionData : null);

                if (candidate && candidate.length > 0) {
                    collectionCsvData = candidate;
                    currentCollectionData = candidate;
                    updateCollectionStatusBadge();
                }
            }

            if (!collectionId && !csvFile && !collectionCsvData) {
                alert("Please enter a Collection ID or upload a CSV collection in Step 1 first.");
                btn.disabled = false;
                btn.innerHTML = '<span>Check Set Progress</span>';
                return;
            }

            const matchMode = document.querySelector('input[name="matchMode"]:checked')?.value || 'exact';
            const includeBasicLands = document.getElementById('setIncludeBasicLands').checked;
            const setScope = document.getElementById('setScopeAllVariants').checked ? 'all' : 'distinct';

            const btn = document.getElementById('checkSetBtn');
            const progressDashboard = document.getElementById('setProgressDashboard');
            const setResultsContainer = document.getElementById('setResultsContainer');

            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Checking Set Progress...';
            progressDashboard.style.display = 'none';
            setResultsContainer.style.display = 'none';

            // Pass collectionCsvData if available so the request runs instantly with zero Archidekt rate limit risk!
            const validCollectionData = (collectionCsvData && collectionCsvData.length > 0)
                ? collectionCsvData
                : undefined;

            try {
                let response = await fetch('/checkSetProgress', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        collectionId,
                        collectionData: validCollectionData,
                        setCode: selectedSet.code,
                        matchMode,
                        includeBasicLands,
                        setScope
                    })
                });

                let data;
                try {
                    data = await response.json();
                } catch (parseError) {
                    if (response.status === 502 || response.status === 504) {
                        throw new Error("Set scan timed out on the gateway. The collection and set are now cached in memory — please click 'Check Set Progress' again to complete immediately.");
                    }
                    throw new Error(`Server returned status ${response.status} without valid JSON.`);
                }

                if (!response.ok || data.error) {
                    throw new Error(data.error || "Failed to compare set progress.");
                }

                currentSetData = data;
                // If backend returned collection cards, cache locally for sub-second future lookups
                if (data.cachedCollectionData && Array.isArray(data.cachedCollectionData) && data.cachedCollectionData.length > 0) {
                    currentCollectionData = data.cachedCollectionData;
                    if (collectionId) AppStorage.saveArchidektCollection(collectionId, data.cachedCollectionData);
                    updateCollectionStatusBadge();
                }

                renderSetDashboard(data);
                renderSetCardsList();

                progressDashboard.style.display = 'block';
                setResultsContainer.style.display = 'block';
                progressDashboard.scrollIntoView({ behavior: 'smooth' });
            } catch (err) {
                alert(`Error: ${err.message}`);
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>Check Set Progress</span>';
            }
        }

        function renderSetDashboard(data) {
            const { setInfo, summary, rarityStats } = data;
            const curr = getMarketCurrency();

            document.getElementById('dashSetName').textContent = setInfo.name || selectedSet.name;
            document.getElementById('dashSetBadge').textContent = (setInfo.code || selectedSet.code).toUpperCase();
            const iconEl = document.getElementById('dashSetIcon');
            if (setInfo.icon_svg_uri || selectedSet.icon_svg_uri) {
                iconEl.src = setInfo.icon_svg_uri || selectedSet.icon_svg_uri;
                iconEl.style.display = 'inline-block';
            } else {
                iconEl.style.display = 'none';
            }

            document.getElementById('heroPercent').textContent = `${summary.percentCollected}%`;
            document.getElementById('heroSubtitle').textContent = `${summary.collectedCards} / ${summary.totalCards} Cards Collected • ${summary.missingCards} Missing`;
            document.getElementById('heroProgressBar').style.width = `${summary.percentCollected}%`;

            document.getElementById('factSetTotal').textContent = summary.totalCards;
            document.getElementById('factSetCollected').textContent = summary.collectedCards;
            document.getElementById('factSetMissing').textContent = summary.missingCards;

            const missingVal = currentMarket === 'cardmarket' ? summary.estMissingValue?.eur : summary.estMissingValue?.usd;
            const ownedVal = currentMarket === 'cardmarket' ? summary.estOwnedValue?.eur : summary.estOwnedValue?.usd;
            document.getElementById('factSetCost').textContent = missingVal != null ? `${curr}${Number(missingVal).toFixed(2)}` : `${curr}0.00`;
            document.getElementById('factSetOwnedValue').textContent = ownedVal != null ? `${curr}${Number(ownedVal).toFixed(2)}` : `${curr}0.00`;

            const rarityGrid = document.getElementById('rarityGrid');
            rarityGrid.innerHTML = '';
            const rarityOrder = ['mythic', 'rare', 'uncommon', 'common'];
            const rarityColors = {
                mythic: 'var(--rarity-mythic)',
                rare: 'var(--rarity-rare)',
                uncommon: 'var(--rarity-uncommon)',
                common: 'var(--rarity-common)'
            };

            rarityOrder.forEach(rKey => {
                const r = rarityStats[rKey];
                if (!r || r.total === 0) return;
                const card = document.createElement('div');
                card.className = 'rarity-card';
                card.innerHTML = `
                    <div class="rarity-header">
                        <span class="badge badge-${rKey}">${rKey.toUpperCase()}</span>
                        <span style="font-weight: 700;">${r.collected}/${r.total} <span style="font-weight: normal; color: var(--text-muted); font-size: 0.8em;">(${r.pct}%)</span></span>
                    </div>
                    <div class="rarity-track">
                        <div class="rarity-fill" style="width: ${r.pct}%; background-color: ${rarityColors[rKey]};"></div>
                    </div>
                    ${r.missing > 0 ? `<div style="font-size: 0.78rem; color: var(--status-missing); margin-top: 0.2rem;">${r.missing} missing • Est. ${curr}${(currentMarket === 'cardmarket' ? (r.estMissingUsd * 0.92) : r.estMissingUsd).toFixed(2)}</div>` : '<div style="font-size: 0.78rem; color: var(--status-used); margin-top: 0.2rem;">100% Complete! 🎉</div>'}
                `;
                rarityGrid.appendChild(card);
            });

            document.getElementById('countTabMissing').textContent = summary.missingCards;
            document.getElementById('countTabCollected').textContent = summary.collectedCards;
            document.getElementById('countTabAll').textContent = summary.totalCards;
        }

        function setListStatusFilter(status) {
            setStatusFilter = status;
            document.getElementById('btnFilterMissing').classList.toggle('active', status === 'missing');
            document.getElementById('btnFilterCollected').classList.toggle('active', status === 'collected');
            document.getElementById('btnFilterAll').classList.toggle('active', status === 'all');
            renderSetCardsList();
        }

        function getFilteredSetCards() {
            if (!currentSetData || !currentSetData.cards) return [];
            const searchVal = document.getElementById('cardSearchFilter').value.trim().toLowerCase();
            const rarityVal = document.getElementById('rarityFilter').value;
            const sortVal = document.getElementById('setSortOrder').value;

            let filtered = currentSetData.cards.filter(c => {
                if (setStatusFilter === 'missing' && c.is_collected) return false;
                if (setStatusFilter === 'collected' && !c.is_collected) return false;

                if (searchVal && !c.name.toLowerCase().includes(searchVal) && !c.type_line.toLowerCase().includes(searchVal)) {
                    return false;
                }

                if (rarityVal !== 'all' && c.rarity !== rarityVal) return false;

                return true;
            });

            filtered.sort((a, b) => {
                if (sortVal === 'number') {
                    const numA = parseInt(a.collector_number) || 99999;
                    const numB = parseInt(b.collector_number) || 99999;
                    return numA - numB || a.collector_number.localeCompare(b.collector_number);
                } else if (sortVal === 'name') {
                    return a.name.localeCompare(b.name);
                } else if (sortVal === 'price_desc') {
                    const pA = getCardMarketNumericPrice(a.prices, a.finish || a.card_finish) || (a.prices?.numericUsd || 0);
                    const pB = getCardMarketNumericPrice(b.prices, b.finish || b.card_finish) || (b.prices?.numericUsd || 0);
                    return pB - pA;
                } else if (sortVal === 'price_asc') {
                    const pA = getCardMarketNumericPrice(a.prices, a.finish || a.card_finish) || (a.prices?.numericUsd || 0);
                    const pB = getCardMarketNumericPrice(b.prices, b.finish || b.card_finish) || (b.prices?.numericUsd || 0);
                    return pA - pB;
                } else if (sortVal === 'rarity') {
                    const ranks = { mythic: 4, rare: 3, uncommon: 2, common: 1, special: 0 };
                    return (ranks[b.rarity] || 0) - (ranks[a.rarity] || 0);
                }
                return 0;
            });

            return filtered;
        }

        function renderSetCardsList() {
            const ul = document.getElementById('setCardsListUl');
            ul.innerHTML = '';
            const cards = getFilteredSetCards();
            const curr = getMarketCurrency();

            if (cards.length === 0) {
                ul.innerHTML = '<li style="padding: 2.5rem 1.5rem; text-align: center; color: var(--text-muted);">No cards match the selected filters.</li>';
                return;
            }

            cards.forEach(c => {
                const li = document.createElement('li');
                li.className = 'card-row-item';

                const ownedQty = c.owned_qty || 0;
                const inDecks = c.in_decks || 0;
                const isCollected = Boolean(c.is_collected);
                const exactSetQty = c.exact_set_qty || 0;
                const thisSetTotalQty = c.this_set_total_qty || exactSetQty;
                const totalOwnedAcrossAnySet = c.total_owned_across_any_set || 0;
                const otherEditionsSummary = c.other_editions_summary || '';
                const sameSetVariantsSummary = c.same_set_variants_summary || '';
                const otherSetsCount = c.other_sets_qty != null ? c.other_sets_qty : Math.max(0, totalOwnedAcrossAnySet - thisSetTotalQty);
                const isReprintFromOtherSet = isCollected && exactSetQty === 0 && otherSetsCount > 0;
                const activeFinish = c.finish || c.card_finish || c.owned_finish || 'Normal';

                const leftDiv = document.createElement('div');
                leftDiv.className = 'card-row-left';

                const numSpan = document.createElement('span');
                numSpan.className = 'card-collector-num';
                numSpan.textContent = `#${c.collector_number}`;

                // Detailed finishes description for title tooltip
                const finishesText = (c.finishes_breakdown && c.finishes_breakdown.length > 0)
                    ? c.finishes_breakdown.map(f => `${f.quantity}x ${f.finish}`).join(', ')
                    : activeFinish;

                // Prominent Quantity Badge
                const qtyBadge = document.createElement('span');
                qtyBadge.className = 'card-qty-badge';
                if (isCollected) {
                    if (isReprintFromOtherSet) {
                        qtyBadge.style.background = 'rgba(56, 189, 248, 0.15)';
                        qtyBadge.style.color = '#38bdf8';
                        qtyBadge.style.borderColor = 'rgba(56, 189, 248, 0.35)';
                        qtyBadge.textContent = `${ownedQty}x`;
                        qtyBadge.title = `Collected via reprint (${otherEditionsSummary || 'other set'}) • 0x in this set`;
                    } else {
                        qtyBadge.style.background = 'rgba(16, 185, 129, 0.15)';
                        qtyBadge.style.color = '#34d399';
                        qtyBadge.style.borderColor = 'rgba(16, 185, 129, 0.35)';
                        qtyBadge.textContent = `${ownedQty}x`;
                        qtyBadge.title = `You own ${ownedQty} ${ownedQty === 1 ? 'copy' : 'copies'} from this set (${finishesText})`;
                    }
                } else {
                    qtyBadge.style.background = 'rgba(239, 68, 68, 0.1)';
                    qtyBadge.style.color = '#f87171';
                    qtyBadge.style.borderColor = 'rgba(239, 68, 68, 0.25)';
                    qtyBadge.textContent = `0x`;
                    qtyBadge.title = otherSetsCount > 0
                        ? `Missing from this set (owned in other set: ${otherEditionsSummary})`
                        : `Missing from collection`;
                }

                const detailsDiv = document.createElement('div');
                detailsDiv.className = 'card-details-block';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'card-name';
                nameSpan.textContent = c.name;
                nameSpan.title = "Click to view on Scryfall • Hover to preview card";
                nameSpan.onclick = (e) => {
                    openInScryfall(c.name, e);
                };
                bindImageHover(nameSpan, c.name, c.image_url);

                const metaSpan = document.createElement('div');
                metaSpan.className = 'card-meta-line';
                metaSpan.style.display = 'flex';
                metaSpan.style.alignItems = 'center';
                metaSpan.style.gap = '0.4rem';
                metaSpan.style.flexWrap = 'wrap';
                metaSpan.style.marginTop = '0.2rem';

                const rarityBadge = `<span class="badge badge-${c.rarity}">${c.rarity.toUpperCase()}</span>`;

                // Render finish badges: if user owns multiple finishes (e.g. 1 Normal and 1 Foil), render BOTH!
                let finishBadgesHtml = '';
                if (isCollected && Array.isArray(c.finishes_breakdown) && c.finishes_breakdown.length > 0) {
                    const showNormalBadge = c.finishes_breakdown.length > 1 || c.finishes_breakdown[0].finish !== 'Normal';
                    finishBadgesHtml = c.finishes_breakdown.map(fb => {
                        const qtyPrefix = fb.quantity > 1 ? `${fb.quantity}x ` : '1x ';
                        return renderFinishBadge(fb.finish, qtyPrefix, showNormalBadge);
                    }).filter(Boolean).join(' ');
                } else {
                    finishBadgesHtml = renderFinishBadge(activeFinish);
                }

                const mana = c.mana_cost ? `<span style="color: var(--text-muted); font-size: 0.82rem;">${c.mana_cost}</span>` : '';
                const typeText = `<span style="color: var(--text-muted); font-size: 0.82rem;">${c.type_line}</span>`;

                let editionPill = '';
                if (isCollected) {
                    if (isReprintFromOtherSet) {
                        editionPill = `<span class="badge" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; font-size: 0.74rem; border: 1px solid rgba(56, 189, 248, 0.3);">Reprint: 0x this set • ${otherSetsCount}x other${otherEditionsSummary ? ' (' + otherEditionsSummary + ')' : ''}</span>`;
                    } else {
                        if (sameSetVariantsSummary) {
                            editionPill += `<span class="badge" style="background: rgba(168, 85, 247, 0.12); color: #c084fc; font-size: 0.72rem; border: 1px solid rgba(168, 85, 247, 0.3);" title="You also own another printing/variant of this card in this set">🎨 Also in set: ${sameSetVariantsSummary}</span> `;
                        }
                        if (otherSetsCount > 0) {
                            editionPill += `<span class="badge" style="background: rgba(255, 255, 255, 0.05); color: var(--text-muted); font-size: 0.72rem;">(${exactSetQty}x this set • ${otherSetsCount}x other sets${otherEditionsSummary ? ': ' + otherEditionsSummary : ''})</span>`;
                        }
                    }
                } else if (otherSetsCount > 0) {
                    editionPill = `<span class="badge" style="background: rgba(234, 179, 8, 0.12); color: #facc15; font-size: 0.74rem; border: 1px solid rgba(234, 179, 8, 0.3);" title="You own copies from a different set">⚠️ Owned in other set (${otherSetsCount}x total${otherEditionsSummary ? ': ' + otherEditionsSummary : ''})</span>`;
                }

                metaSpan.innerHTML = `${rarityBadge} ${finishBadgesHtml} ${typeText} ${mana} ${editionPill}`;

                detailsDiv.appendChild(nameSpan);
                detailsDiv.appendChild(metaSpan);

                leftDiv.appendChild(numSpan);
                leftDiv.appendChild(qtyBadge);
                leftDiv.appendChild(detailsDiv);

                const rightDiv = document.createElement('div');
                rightDiv.className = 'card-row-right';
                rightDiv.style.display = 'flex';
                rightDiv.style.alignItems = 'center';
                rightDiv.style.gap = '0.75rem';

                const cardNumericPrice = getCardMarketNumericPrice(c.prices, activeFinish);
                if (cardNumericPrice > 0) {
                    const priceSpan = document.createElement('span');
                    priceSpan.className = 'card-price-tag';
                    priceSpan.textContent = `${curr}${cardNumericPrice.toFixed(2)}`;
                    rightDiv.appendChild(priceSpan);
                }

                const statusSpan = document.createElement('span');
                if (isCollected) {
                    if (isReprintFromOtherSet) {
                        statusSpan.className = 'status-owned';
                        statusSpan.style.background = 'rgba(56, 189, 248, 0.15)';
                        statusSpan.style.color = '#38bdf8';
                        statusSpan.style.border = '1px solid rgba(56, 189, 248, 0.3)';
                        statusSpan.textContent = `Reprint (${otherEditionsSummary || 'Other Set'})`;
                    } else {
                        statusSpan.className = 'status-owned';
                        statusSpan.textContent = ownedQty > 1 ? `Collected (${ownedQty}x)` : `Collected (1x)`;
                    }
                } else {
                    statusSpan.className = 'status-missing';
                    statusSpan.textContent = `Missing (0x)`;
                }
                rightDiv.appendChild(statusSpan);

                // Trade Binder Action Buttons Container
                const binderContainer = document.createElement('div');
                binderContainer.className = 'binder-btn-group';

                if (isCollected) {
                    const ownedPrints = (Array.isArray(c.owned_prints) && c.owned_prints.length > 0)
                        ? c.owned_prints
                        : [{
                            setCode: c.set || '',
                            collectorNumber: c.collector_number || '',
                            finish: activeFinish,
                            isFoil: Boolean(c.is_foil || String(activeFinish).toLowerCase().includes('foil')),
                            imageUrl: c.image_url || '',
                            prices: c.prices || null,
                            quantity: ownedQty || 1
                        }];

                    if (ownedPrints.length === 1) {
                        // Single version owned: direct clean button
                        const p = ownedPrints[0];
                        const pFinish = p.finish || 'Normal';
                        const isFoilPrint = Boolean(p.isFoil || pFinish.toLowerCase().includes('foil') || pFinish.toLowerCase().includes('etched'));
                        const pPrice = getCardMarketNumericPrice(p.prices || c.prices, pFinish) || cardNumericPrice;

                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = `binder-quick-btn have-btn ${isFoilPrint ? 'foil-btn' : 'normal-btn'}`;
                        btn.innerHTML = isFoilPrint ? `+ Have ✨ ${pFinish}` : `+ Have`;
                        btn.title = `Add ${pFinish} copy (#${p.collectorNumber || c.collector_number}) to Trade Binder for trade`;
                        if (p.imageUrl) bindImageHover(btn, `${c.name} (${pFinish})`, p.imageUrl);

                        btn.onclick = (e) => {
                            e.stopPropagation();
                            addToTradeBinder({
                                name: c.name,
                                setCode: p.setCode || c.set || '',
                                collectorNumber: p.collectorNumber || c.collector_number || '',
                                finish: pFinish,
                                isFoil: isFoilPrint,
                                priceUsd: pPrice,
                                imageUrl: p.imageUrl || c.image_url || '',
                                prices: p.prices || c.prices || null,
                                type: 'have'
                            });
                        };
                        binderContainer.appendChild(btn);
                    } else {
                        // Multiple versions / finishes owned (e.g. Normal AND Foil, or multiple collector numbers)!
                        // Render a separate dedicated button for EACH owned version so user can choose exactly which to trade!
                        ownedPrints.forEach(p => {
                            const pFinish = p.finish || 'Normal';
                            const isFoilPrint = Boolean(p.isFoil || pFinish.toLowerCase().includes('foil') || pFinish.toLowerCase().includes('etched'));
                            const pPrice = getCardMarketNumericPrice(p.prices || c.prices, pFinish) || cardNumericPrice;
                            const hasMultipleNumbers = ownedPrints.some(x => x.collectorNumber !== p.collectorNumber);
                            const pNum = p.collectorNumber ? `#${p.collectorNumber}` : '';
                            const isAltVariant = hasMultipleNumbers && p.collectorNumber !== c.collector_number;

                            const btn = document.createElement('button');
                            btn.type = 'button';
                            btn.className = `binder-quick-btn have-btn ${isFoilPrint ? 'foil-btn' : (isAltVariant ? 'alt-btn' : 'normal-btn')}`;

                            const finishText = isFoilPrint ? `✨ ${pFinish}` : pFinish;
                            const numText = hasMultipleNumbers ? ` (${pNum})` : '';
                            btn.innerHTML = `+ Have ${finishText}${numText}`;
                            btn.title = `Add ${pFinish} copy ${pNum} to Trade Binder (You own ${p.quantity}x)`;
                            if (p.imageUrl) bindImageHover(btn, `${c.name} (${pFinish} ${pNum})`, p.imageUrl);

                            btn.onclick = (e) => {
                                e.stopPropagation();
                                addToTradeBinder({
                                    name: c.name,
                                    setCode: p.setCode || c.set || '',
                                    collectorNumber: p.collectorNumber || c.collector_number || '',
                                    finish: pFinish,
                                    isFoil: isFoilPrint,
                                    priceUsd: pPrice,
                                    imageUrl: p.imageUrl || c.image_url || '',
                                    prices: p.prices || c.prices || null,
                                    type: 'have'
                                });
                            };
                            binderContainer.appendChild(btn);
                        });
                    }
                } else {
                    // Missing card: + Want
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'binder-quick-btn want-btn';
                    btn.innerHTML = '+ Want';
                    btn.title = 'Add missing card to Trade Binder wishlist';
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        addToTradeBinder({
                            name: c.name,
                            setCode: c.set || '',
                            collectorNumber: c.collector_number || '',
                            finish: activeFinish,
                            isFoil: Boolean(c.is_foil || String(activeFinish).toLowerCase().includes('foil')),
                            priceUsd: cardNumericPrice,
                            imageUrl: c.image_url || '',
                            prices: c.prices || null,
                            type: 'want'
                        });
                    };
                    binderContainer.appendChild(btn);
                }

                rightDiv.appendChild(binderContainer);

                li.appendChild(leftDiv);
                li.appendChild(rightDiv);
                ul.appendChild(li);
            });
        }

        function exportSetCSV(type = 'missing') {
            if (!currentSetData || !currentSetData.cards) return;
            const targetCards = type === 'missing'
                ? currentSetData.cards.filter(c => !c.is_collected)
                : currentSetData.cards;

            if (targetCards.length === 0) {
                alert(`No ${type} cards to export.`);
                return;
            }

            let csvContent = "Card Name,Collector Number,Rarity,Type,Price (USD),Status,Quantity Owned\n";
            targetCards.forEach(c => {
                const safeName = c.name.replace(/"/g, '""');
                const safeType = c.type_line.replace(/"/g, '""');
                const price = c.prices?.usd || "0.00";
                const status = c.is_collected ? "Collected" : "Missing";
                csvContent += `"${safeName}","${c.collector_number}","${c.rarity}","${safeType}",${price},"${status}",${c.owned_qty}\n`;
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `${selectedSet?.code || 'set'}_${type}_cards.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        function copyMissingToClipboard() {
            if (!currentSetData || !currentSetData.cards) return;
            const missingCards = currentSetData.cards.filter(c => !c.is_collected);
            if (missingCards.length === 0) {
                showToast("No missing cards to copy! 🎉");
                return;
            }

            const text = missingCards.map(c => `1 ${c.name}`).join('\n');
            navigator.clipboard.writeText(text)
                .then(() => showToast(`Copied ${missingCards.length} missing card names to clipboard!`))
                .catch(() => showToast("Failed to copy missing cards."));
        }

        // ==================== INITIALIZATION ====================
        window.addEventListener('DOMContentLoaded', async () => {
            loadSetsList().catch(err => console.warn('Sets load warning:', err));

            const deckInput = document.getElementById('deckInput');
            const collectionInput = document.getElementById('collectionId');
            const compareBtn = document.getElementById('compareBtn');
            if (compareBtn) {
                compareBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    runComparison();
                });
            }

            const handleEnter = (e) => {
                if (e.key === 'Enter') {
                    if (e.target.id === 'deckInput') {
                        e.preventDefault();
                        if (e.target.value.trim() !== '') addDeck();
                        else runComparison();
                    } else if (e.target.id === 'setSearchInput') {
                        const val = e.target.value.trim();
                        if (val) selectSetByCode(val);
                    }
                }
            };
            if (deckInput) deckInput.addEventListener('keypress', handleEnter);
            const setSearchInput = document.getElementById('setSearchInput');
            if (setSearchInput) setSearchInput.addEventListener('keypress', handleEnter);

            collectionInput.addEventListener('input', (e) => {
                if (e.target.value.includes('archidekt.com')) {
                    e.target.value = e.target.value.replace(/(?:https?:\/\/)?(?:www\.)?archidekt\.com\/collections?\/(\d+)[^\s,]*/gi, '$1');
                }
                toggleCollectionInputs();
            });

            // Restore cached collection CSV from AppStorage
            const savedCsv = AppStorage.loadCsv();
            if (savedCsv && Array.isArray(savedCsv) && savedCsv.length > 0) {
                cachedParsedCsv = savedCsv;
            }

            // Restore cached insights
            try {
                const rawInsights = localStorage.getItem('archidekt_cachedInsights');
                if (rawInsights) cachedInsightsData = JSON.parse(rawInsights);
            } catch (e) {}

            // Update trade badge
            updateTradeBadge();

            // Read URL parameters & localStorage
            const params = new URLSearchParams(window.location.search);
            const isTradeLink = await checkIncomingTradeLink();
            const urlTab = isTradeLink ? 'trade' : (params.get('tab') || localStorage.getItem('archidekt_activeTab') || 'deck');
            const urlDeckIds = params.get('deckIds');
            const urlCollectionId = params.get('collectionId');
            const urlSetCode = params.get('setCode') || localStorage.getItem('archidekt_selectedSetCode');
            const savedDeckIds = localStorage.getItem('archidekt_deckIds');
            const savedCollectionId = localStorage.getItem('archidekt_collectionId');

            let initialDeckIds = urlDeckIds || savedDeckIds;
            if (initialDeckIds) {
                initialDeckIds.split(/[,\s\n]+/).forEach(id => {
                    const sanitized = sanitizeDeckInput(id);
                    if (sanitized) {
                        activeDeckIds.add(sanitized);
                        fetchDeckName(sanitized);
                    }
                });
                renderDeckChips();
            }

            if (urlCollectionId) {
                collectionInput.value = urlCollectionId;
            } else if (savedCollectionId) {
                collectionInput.value = savedCollectionId;
            }
            toggleCollectionInputs();

            // Try restoring cached Archidekt collection into memory for sub-second lookups
            const initialCollId = collectionInput.value.trim();
            if (initialCollId && !cachedParsedCsv) {
                const storedColl = AppStorage.loadArchidektCollection(initialCollId);
                if (storedColl && storedColl.length > 0) {
                    currentCollectionData = storedColl;
                }
            }
            updateCollectionStatusBadge();

            const urlSideboards = params.get('includeSideboards');
            const urlLands = params.get('includeBasicLands');
            const savedSideboards = localStorage.getItem('archidekt_includeSideboards');
            const savedLands = localStorage.getItem('archidekt_includeBasicLands');

            const sideboardsVal = urlSideboards !== null ? urlSideboards === 'true' : (savedSideboards !== null ? savedSideboards === 'true' : true);
            const landsVal = urlLands !== null ? urlLands === 'true' : (savedLands !== null ? savedLands === 'true' : false);

            const sideboardsCheckbox = document.getElementById('includeSideboards');
            const landsCheckbox = document.getElementById('includeBasicLands');
            if (sideboardsCheckbox) sideboardsCheckbox.checked = sideboardsVal;
            if (landsCheckbox) landsCheckbox.checked = landsVal;

            if (urlSetCode) {
                selectSetByCode(urlSetCode);
            }

            switchTab(urlTab);

            // If a specific collection tab, hash, or trade link is requested, activate collection hub view
            if (isTradeLink || params.get('tab') || window.location.hash.startsWith('#view-collection')) {
                if (typeof window.switchView === 'function') {
                    window.switchView('view-collection-hub', false);
                }
            }

            // Initialize Firebase Auth
            initFirebaseAuth();

            // Automatically restore previous comparison results across page refreshes
            await restoreCachedComparison();

            window.addEventListener('hashchange', async () => {
                const isTrade = await checkIncomingTradeLink();
                if (isTrade) {
                    if (typeof window.switchView === 'function') window.switchView('view-collection-hub');
                    switchTab('trade');
                }
            });
        });

        // ==================== CROSS-TOOL INTEGRATION EXPORTS ====================
        window.openCollectionTab = function(tab, options = {}) {
            if (typeof window.switchView === 'function') {
                window.switchView('view-collection-hub');
            }
            if (typeof switchTab === 'function') {
                switchTab(tab);
            }
            if (options.openUpgrader) {
                setTimeout(() => {
                    const upgraderDrawer = document.getElementById('aiUpgradesDrawer') || document.getElementById('aiUpgradeContainer') || document.getElementById('suggestImprovementsBtn');
                    if (upgraderDrawer) {
                        upgraderDrawer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    const expandBtn = document.getElementById('openAiUpgradeBtn') || document.getElementById('toggleUpgradesBtn');
                    if (expandBtn) expandBtn.click();
                }, 200);
            }
            if (options.preloadDeck && typeof addDeck === 'function') {
                const deckInput = document.getElementById('deckInput');
                if (deckInput) {
                    deckInput.value = options.preloadDeck;
                    addDeck();
                }
            }
        };

        window.switchCollectionTab = function(tab) {
            if (typeof switchTab === 'function') switchTab(tab);
        };

        // Explicit Global Bindings for HTML inline event handlers
        window.runComparison = runComparison;
        window.addDeck = addDeck;
        window.removeDeck = removeDeck;
        window.togglePasteDeckForm = togglePasteDeckForm;
        window.saveCustomDeck = saveCustomDeck;
        window.clearSavedComparison = clearSavedComparison;
        window.clearCsv = clearCsv;
        window.switchDeckResultsMode = switchDeckResultsMode;
        window.selectDeckView = typeof selectDeckView === 'function' ? selectDeckView : () => {};
        window.openBuyMissingModal = typeof openBuyMissingModal === 'function' ? openBuyMissingModal : () => {};
        window.closeBuyMissingModal = typeof closeBuyMissingModal === 'function' ? closeBuyMissingModal : () => {};
        window.switchBuyMarketTab = typeof switchBuyMarketTab === 'function' ? switchBuyMarketTab : () => {};
        window.copyBuyMissingText = typeof copyBuyMissingText === 'function' ? copyBuyMissingText : () => {};
        window.copyDeckMissing = typeof copyDeckMissing === 'function' ? copyDeckMissing : () => {};
        window.exportDeckCSV = typeof exportDeckCSV === 'function' ? exportDeckCSV : () => {};
        window.loadBuildDeckIntoComparator = typeof loadBuildDeckIntoComparator === 'function' ? loadBuildDeckIntoComparator : () => {};
        window.setDeckCardsStatusFilter = typeof setDeckCardsStatusFilter === 'function' ? setDeckCardsStatusFilter : () => {};
        window.clearDeckSearch = typeof clearDeckSearch === 'function' ? clearDeckSearch : () => {};
        window.clearInventorySearch = typeof clearInventorySearch === 'function' ? clearInventorySearch : () => {};
        window.exportCSV = typeof exportCSV === 'function' ? exportCSV : () => {};
        window.copyToClipboard = typeof copyToClipboard === 'function' ? copyToClipboard : () => {};
        window.selectSetByCode = typeof selectSetByCode === 'function' ? selectSetByCode : () => {};
        window.clearSelectedSet = typeof clearSelectedSet === 'function' ? clearSelectedSet : () => {};
        window.runSetComparison = typeof runSetComparison === 'function' ? runSetComparison : () => {};
        window.exportSetCSV = typeof exportSetCSV === 'function' ? exportSetCSV : () => {};
        window.copyMissingToClipboard = typeof copyMissingToClipboard === 'function' ? copyMissingToClipboard : () => {};
        window.setListStatusFilter = typeof setListStatusFilter === 'function' ? setListStatusFilter : () => {};
        window.fetchCollectionInsights = typeof fetchCollectionInsights === 'function' ? fetchCollectionInsights : () => {};
        window.refreshActiveCollection = typeof refreshActiveCollection === 'function' ? refreshActiveCollection : () => {};
        window.clearSavedCollection = typeof clearSavedCollection === 'function' ? clearSavedCollection : () => {};
        window.importFriendTradeToBinder = typeof importFriendTradeToBinder === 'function' ? importFriendTradeToBinder : () => {};
        window.dismissFriendTradeBanner = typeof dismissFriendTradeBanner === 'function' ? dismissFriendTradeBanner : () => {};
        window.shareTradeOfferModal = typeof shareTradeOfferModal === 'function' ? shareTradeOfferModal : () => {};
        window.closeShareTradeModal = typeof closeShareTradeModal === 'function' ? closeShareTradeModal : () => {};
        window.copyTradeTextList = typeof copyTradeTextList === 'function' ? copyTradeTextList : () => {};
        window.copyTradeUrlFromInput = typeof copyTradeUrlFromInput === 'function' ? copyTradeUrlFromInput : () => {};
        window.clearTradeBinder = typeof clearTradeBinder === 'function' ? clearTradeBinder : () => {};
        window.addCardFromTradeInput = typeof addCardFromTradeInput === 'function' ? addCardFromTradeInput : () => {};
        window.renderBuildSection = typeof renderBuildSection === 'function' ? renderBuildSection : () => {};
        window.switchBuildSubTab = typeof switchBuildSubTab === 'function' ? switchBuildSubTab : () => {};
        window.setBuildThreshold = typeof setBuildThreshold === 'function' ? setBuildThreshold : () => {};
        window.setBuildFilter = typeof setBuildFilter === 'function' ? setBuildFilter : () => {};
        window.toggleMissingDrawer = typeof toggleMissingDrawer === 'function' ? toggleMissingDrawer : () => {};
        window.startBuildingAroundCommander = typeof startBuildingAroundCommander === 'function' ? startBuildingAroundCommander : () => {};
        window.openCommandersModal = typeof openCommandersModal === 'function' ? openCommandersModal : () => {};
        window.closeCommandersModal = typeof closeCommandersModal === 'function' ? closeCommandersModal : () => {};
        window.copyCommandersList = typeof copyCommandersList === 'function' ? copyCommandersList : () => {};
        window.exportCommandersCSV = typeof exportCommandersCSV === 'function' ? exportCommandersCSV : () => {};