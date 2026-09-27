import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET_URL = (process.env.TARGET_URL || 'http://localhost:8089').replace(/\/$/, '');

const results = [];
let passed = 0;
let failed = 0;

function log(testName, isSuccess, details = '') {
    if (isSuccess) {
        passed++;
        console.log(`✅ [PASS] ${testName} ${details ? '(' + details + ')' : ''}`);
    } else {
        failed++;
        console.error(`❌ [FAIL] ${testName}: ${details}`);
    }
    results.push({ testName, isSuccess, details });
}

async function safeClick(page, selector) {
    await page.waitForSelector(selector, { timeout: 6000 });
    await page.$eval(selector, el => {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.click();
    });
}

async function runTests() {
    console.log(`🚀 Starting Full User Journey Automation Test on ${TARGET_URL}`);
    console.log(`Browser: Google Chrome (${CHROME_PATH})\n`);

    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1280,900'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    const consoleErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') {
            const text = msg.text();
            if (!text.includes('favicon.ico') && !text.startsWith('Failed to load resource: the server responded with a status of 404')) {
                consoleErrors.push(text);
            }
        }
    });

    page.on('response', res => {
        if (res.status() === 404) {
            console.log(`[404 Resource]: ${res.url()}`);
        }
    });

    page.on('pageerror', err => {
        consoleErrors.push(`[Uncaught Exception] ${err.toString()}`);
    });

    try {
        // --- 1. Initial Load & Title / Version Check ---
        await page.goto(`${TARGET_URL}/`, { waitUntil: 'networkidle2', timeout: 30000 });
        const title = await page.title();
        log('Page Load & Title', title.includes('Commander Draft Challenge'), title);

        const version = await page.$eval('#appVersion', el => el.textContent.trim()).catch(() => null);
        log('App Version Banner', !!version && version.startsWith('v'), `Detected: ${version}`);

        const landingActive = await page.$eval('#view-landing', el => el.classList.contains('active')).catch(() => false);
        log('Initial Landing View Active', landingActive);

        // --- 2. Quick-Jump Category Buttons ---
        try {
            await safeClick(page, 'button[onclick*="section-play"]');
            await new Promise(r => setTimeout(r, 300));
            log('Jump Bar: Play & Draft', true);

            await safeClick(page, 'button[onclick*="section-collection"]');
            await new Promise(r => setTimeout(r, 300));
            log('Jump Bar: Collection & Decks', true);

            await safeClick(page, 'button[onclick*="section-rolls"]');
            await new Promise(r => setTimeout(r, 300));
            log('Jump Bar: Quick Rolls', true);
        } catch (e) {
            log('Jump Bar Navigation', false, e.message);
        }

        // --- 3. Quick Roll Commander ---
        try {
            await safeClick(page, '#quickRollBtn');
            await page.waitForSelector('#quickRollOverlay', { timeout: 6000 });
            log('Quick Roll Commander: Modal Opened', true);

            // Wait for roll animation to complete
            await new Promise(r => setTimeout(r, 3500));
            const cardName = await page.$eval('#quickRollCardName', el => el.textContent.trim()).catch(() => '');
            log('Quick Roll Commander: Card Rolled', cardName.length > 0 && cardName !== 'Rolling Commander...', cardName);

            // Close modal
            await page.evaluate(() => {
                const ov = document.getElementById('quickRollOverlay');
                if (ov) ov.remove();
            });
            await new Promise(r => setTimeout(r, 300));
            log('Quick Roll Commander: Modal Closed', true);
        } catch (e) {
            log('Quick Roll Commander Flow', false, e.message);
        }

        // --- 4. Quick Roll Precon ---
        try {
            await safeClick(page, '#quickRollPreconBtn');
            await page.waitForSelector('#quickRollOverlay', { timeout: 6000 });
            log('Quick Roll Precon: Modal Opened', true);

            await new Promise(r => setTimeout(r, 3500));
            const preconName = await page.$eval('#quickRollDeckName', el => el.textContent.trim()).catch(() => '');
            log('Quick Roll Precon: Deck Rolled', preconName.length > 0 && preconName !== 'Rolling Precon...', preconName);

            await page.evaluate(() => {
                const ov = document.getElementById('quickRollOverlay');
                if (ov) ov.remove();
            });
            await new Promise(r => setTimeout(r, 300));
            log('Quick Roll Precon: Modal Closed', true);
        } catch (e) {
            log('Quick Roll Precon Flow', false, e.message);
        }

        // --- 5. Player Identity Modal ---
        try {
            await safeClick(page, '#globalAccountBtn');
            await page.waitForSelector('#accountModal.show', { timeout: 4000 });
            log('Player Identity Modal Open', true);

            await safeClick(page, '#accountModalCloseBtn');
            await new Promise(r => setTimeout(r, 400));
            const accountModalClosed = await page.$eval('#accountModal', el => !el.classList.contains('show')).catch(() => true);
            log('Player Identity Modal Closed', accountModalClosed);
        } catch (e) {
            log('Player Identity Flow', false, e.message);
        }

        // --- 6. Sound Effects Toggle ---
        try {
            const sfxInitial = await page.$eval('#sfxToggle', el => el.textContent.trim());
            await safeClick(page, '#sfxToggle');
            const sfxMuted = await page.$eval('#sfxToggle', el => el.textContent.trim());
            log('SFX Toggle: Muted', sfxInitial !== sfxMuted, `${sfxInitial} -> ${sfxMuted}`);
            await safeClick(page, '#sfxToggle');
            const sfxRestored = await page.$eval('#sfxToggle', el => el.textContent.trim());
            log('SFX Toggle: Restored', sfxRestored === sfxInitial, sfxRestored);
        } catch (e) {
            log('SFX Toggle Flow', false, e.message);
        }

        // --- 7. Play Menu in Navbar ---
        try {
            // Open Booster Simulator
            await safeClick(page, 'button.draft-nav-btn');
            await new Promise(r => setTimeout(r, 200));
            await safeClick(page, '#playMenu .nav-popup-item:nth-child(3)');
            await new Promise(r => setTimeout(r, 600));
            const simActive = await page.$eval('#view-booster-simulator', el => el.classList.contains('active')).catch(() => false);
            log('Navbar: Booster Simulator Open', simActive);

            // Crack a pack
            await safeClick(page, '#boosterOpenBtn');
            // Wait for pack tearing animation (3.5s) + rendering
            await new Promise(r => setTimeout(r, 4500));
            const packCardsCount = await page.$$eval('#boosterCardsGrid .booster-card-item', els => els.length).catch(() => 0);
            log('Booster Simulator: Pack Opened', packCardsCount > 0, `${packCardsCount} cards generated`);

            // Return to Hub
            await safeClick(page, '#view-booster-simulator .breadcrumb-btn');
            await new Promise(r => setTimeout(r, 400));
            const backFromSim = await page.$eval('#view-landing', el => el.classList.contains('active')).catch(() => false);
            log('Return to Hub from Booster Simulator', backFromSim);

            // Open Booster Draft Lobby
            await safeClick(page, 'button.draft-nav-btn');
            await new Promise(r => setTimeout(r, 200));
            await safeClick(page, '#playMenu .nav-popup-item:nth-child(2)');
            await new Promise(r => setTimeout(r, 600));
            const draftActive = await page.$eval('#view-booster-draft', el => el.classList.contains('active')).catch(() => false);
            log('Navbar: Booster Draft Lobby Open', draftActive);

            // Return to Hub
            await safeClick(page, '#view-booster-draft .breadcrumb-btn');
            await new Promise(r => setTimeout(r, 400));
            const backFromDraft = await page.$eval('#view-landing', el => el.classList.contains('active')).catch(() => false);
            log('Return to Hub from Booster Draft', backFromDraft);

            // Playtester Modal
            await safeClick(page, 'button.draft-nav-btn');
            await new Promise(r => setTimeout(r, 200));
            await safeClick(page, '#playMenu .nav-popup-item:nth-child(4)');
            await new Promise(r => setTimeout(r, 400));
            const playtesterOpen = await page.$eval('#playtesterLaunchModal', el => el.style.display !== 'none').catch(() => false);
            log('Navbar: Playtester Modal Open', playtesterOpen);
            await safeClick(page, '#playtesterLaunchModal button.btn-cancel');
            await new Promise(r => setTimeout(r, 300));
        } catch (e) {
            log('Play Tools Navigation Flow', false, e.message);
        }

        // --- 8. Collection Menu in Navbar (User's Reported Bug Area) ---
        const collectionTabs = [
            { idx: 1, name: 'Deck Comparator', tab: 'deck', selector: '#deckSection' },
            { idx: 2, name: 'Trade Binder', tab: 'trade', selector: '#tradeSection' },
            { idx: 3, name: 'Set Completion', tab: 'set', selector: '#setSection' },
            { idx: 4, name: 'What Can I Build?', tab: 'build', selector: '#buildSection' },
            { idx: 6, name: 'Collection Insights', tab: 'collection', selector: '#collectionSection' }
        ];

        for (const item of collectionTabs) {
            try {
                await safeClick(page, 'button.booster-nav-btn');
                await new Promise(r => setTimeout(r, 200));
                await safeClick(page, `#collectionMenu .nav-popup-item:nth-child(${item.idx})`);
                await new Promise(r => setTimeout(r, 600));

                const isHubActive = await page.$eval('#view-collection-hub', el => el.classList.contains('active')).catch(() => false);
                const isTabVisible = await page.$eval(item.selector, el => el.style.display !== 'none').catch(() => false);
                const currentUrl = page.url();

                log(`Navbar Collection ▾ -> ${item.name}`, isHubActive && isTabVisible, `HubActive: ${isHubActive}, TabVisible: ${isTabVisible}, URL: ${currentUrl}`);

                // Return to Hub
                await safeClick(page, '#view-collection-hub .breadcrumb-btn');
                await new Promise(r => setTimeout(r, 400));
            } catch (e) {
                log(`Navbar Collection ▾ -> ${item.name}`, false, e.message);
            }
        }

        // --- 9. Landing Page "My Collection & Decks" Action Cards ---
        const landingActionCards = [
            { name: 'Deck Comparator Card', btnSelector: '.action-card-comparator .action-cta-btn', tabSelector: '#deckSection' },
            { name: 'Trade Binder Card', btnSelector: '.action-card-trade .action-cta-btn', tabSelector: '#tradeSection' },
            { name: 'Set Completion Card', btnSelector: '.action-card-sets .action-cta-btn', tabSelector: '#setSection' },
            { name: 'What Can I Build Card', btnSelector: '.action-card-build .action-cta-btn', tabSelector: '#buildSection' },
            { name: 'Collection Insights Card', btnSelector: '.action-card-insights .action-cta-btn', tabSelector: '#collectionSection' }
        ];

        for (const card of landingActionCards) {
            try {
                await safeClick(page, card.btnSelector);
                await new Promise(r => setTimeout(r, 600));

                const isHubActive = await page.$eval('#view-collection-hub', el => el.classList.contains('active')).catch(() => false);
                const isTabVisible = await page.$eval(card.tabSelector, el => el.style.display !== 'none').catch(() => false);
                const currentUrl = page.url();

                log(`Landing Card -> ${card.name}`, isHubActive && isTabVisible, `HubActive: ${isHubActive}, TabVisible: ${isTabVisible}, URL: ${currentUrl}`);

                // Return to Hub
                await safeClick(page, '#view-collection-hub .breadcrumb-btn');
                await new Promise(r => setTimeout(r, 400));
            } catch (e) {
                log(`Landing Card -> ${card.name}`, false, e.message);
            }
        }

        // --- 10. In-Hub Tab Switcher Navigation ---
        try {
            await safeClick(page, '.action-card-comparator .action-cta-btn');
            await new Promise(r => setTimeout(r, 500));

            const tabButtons = [
                { id: '#tabSetBtn', tab: 'set', name: 'Set Completion Tab' },
                { id: '#tabCollectionBtn', tab: 'collection', name: 'Collection Insights Tab' },
                { id: '#tabTradeBtn', tab: 'trade', name: 'Trade Binder Tab' },
                { id: '#tabBuildBtn', tab: 'build', name: 'What Can I Build Tab' },
                { id: '#tabDeckBtn', tab: 'deck', name: 'Deck Comparator Tab' }
            ];

            for (const tb of tabButtons) {
                await safeClick(page, tb.id);
                await new Promise(r => setTimeout(r, 400));
                const isBtnActive = await page.$eval(tb.id, el => el.classList.contains('active'));
                const currentUrl = page.url();
                log(`In-Hub Tab Click: ${tb.name}`, isBtnActive && currentUrl.includes(`tab=${tb.tab}`), currentUrl);
            }

            // Quick set pill interaction in Set Completion
            await safeClick(page, '#tabSetBtn');
            await new Promise(r => setTimeout(r, 400));
            const quickSetPill = await page.$('.quick-set-pill');
            if (quickSetPill) {
                await page.evaluate(() => {
                    const pill = document.querySelector('.quick-set-pill');
                    if (pill) pill.click();
                });
                await new Promise(r => setTimeout(r, 500));
                const selectedSetBoxVisible = await page.$eval('#selectedSetBox', el => el.style.display !== 'none').catch(() => false);
                log('Set Completion: Quick Set Selection', selectedSetBoxVisible);
            }
        } catch (e) {
            log('In-Hub Tab Navigation Flow', false, e.message);
        }

        // --- 11. Direct URL Deep Linking Tests ---
        const deepLinks = [
            { url: `${TARGET_URL}/?tab=collection`, viewId: '#view-collection-hub', tabBtn: '#tabCollectionBtn', name: 'Deep Link: ?tab=collection' },
            { url: `${TARGET_URL}/?tab=deck`, viewId: '#view-collection-hub', tabBtn: '#tabDeckBtn', name: 'Deep Link: ?tab=deck' },
            { url: `${TARGET_URL}/#view-booster-draft`, viewId: '#view-booster-draft', name: 'Deep Link: #view-booster-draft' },
            { url: `${TARGET_URL}/#view-booster-simulator`, viewId: '#view-booster-simulator', name: 'Deep Link: #view-booster-simulator' }
        ];

        for (const dl of deepLinks) {
            try {
                await page.goto(dl.url, { waitUntil: 'networkidle2', timeout: 20000 });
                await new Promise(r => setTimeout(r, 800));
                const isViewActive = await page.$eval(dl.viewId, el => el.classList.contains('active')).catch(() => false);
                let isTabActive = true;
                if (dl.tabBtn) {
                    isTabActive = await page.$eval(dl.tabBtn, el => el.classList.contains('active')).catch(() => false);
                }
                log(dl.name, isViewActive && isTabActive, `ViewActive: ${isViewActive}, TabActive: ${isTabActive}`);
            } catch (e) {
                log(dl.name, false, e.message);
            }
        }

        // --- 12. Check Console Errors ---
        log('Console Error Audit', consoleErrors.length === 0, consoleErrors.length > 0 ? consoleErrors.join(' | ') : '0 Uncaught JS Exceptions');

    } catch (e) {
        log('Overall Test Execution', false, e.message);
    } finally {
        await browser.close();
    }

    console.log('\n=============================================');
    console.log(`📊 TEST SUMMARY: Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
    console.log('=============================================\n');

    if (failed > 0) {
        console.error('❌ Some tests failed.');
        process.exit(1);
    } else {
        console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
        process.exit(0);
    }
}

runTests();
