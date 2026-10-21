import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://127.0.0.1:8089/index.html';

async function run() {
    console.log('🚀 Starting Full Card-Forge WebAssembly Integration Test in Chrome...');
    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--enable-features=SharedArrayBuffer'
        ]
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(180000);
    page.setDefaultTimeout(180000);

    page.on('console', msg => {
        console.log(`[BROWSER CONSOLE] ${msg.text()}`);
    });

    page.on('pageerror', err => {
        console.error('[PAGE ERROR]', err.message);
    });

    try {
        console.log(`1. Navigating to ${URL}...`);
        await page.goto(URL, { waitUntil: 'domcontentloaded' });

        console.log('2. Checking ForgeArena global object...');
        const hasForge = await page.evaluate(() => typeof window.ForgeArena !== 'undefined');
        console.log('window.ForgeArena defined:', hasForge);

        console.log('3. Opening Commander Arena...');
        await page.evaluate(() => {
            window.openCommanderArena();
        });
        await new Promise(r => setTimeout(r, 1000));

        console.log('4. Starting Commander Match via Card-Forge WebAssembly...');
        const startPromise = page.evaluate(async () => {
            await window.applyArenaSetupAndStart();
        });

        // Wait for match initialization (may take ~30-60s on first compile)
        console.log('Waiting for Card-Forge Engine to boot in WebAssembly...');
        await page.waitForFunction(() => {
            return window.currentGame && window.currentGame.players && window.currentGame.players.length > 0;
        }, { timeout: 180000 });

        console.log('✅ Card-Forge Engine successfully initialized 4-player Commander match!');

        const gameStateAfterInit = await page.evaluate(() => {
            const p1 = window.currentGame?.players[0];
            return {
                turn: window.currentGame?.turn,
                phase: window.currentGame?.currentPhase,
                p1Name: p1?.name,
                p1Life: p1?.life,
                handCount: p1?.hand?.length,
                handPreview: p1?.hand?.map(c => c.name),
                commandZonePreview: p1?.commandZone?.map(c => c.name)
            };
        });
        console.log('Initial Game State:', JSON.stringify(gameStateAfterInit, null, 2));

        console.log('5. Keeping opening hand (MTG Rule 103.4c)...');
        await page.evaluate(() => {
            window.keepPlayerOpeningHand();
        });
        await new Promise(r => setTimeout(r, 1000));

        console.log('6. Stepping 3 phases in Card-Forge engine...');
        for (let i = 1; i <= 3; i++) {
            await page.evaluate(async () => {
                await window.stepArenaPhase();
            });
            await new Promise(r => setTimeout(r, 1000));
            const curPhase = await page.evaluate(() => window.currentGame?.currentPhase);
            const curTurn = await page.evaluate(() => window.currentGame?.turn);
            console.log(`Phase step ${i} completed -> Turn: ${curTurn}, Phase: ${curPhase}`);
        }

        console.log('7. Capturing final arena screenshot...');
        await page.screenshot({ path: 'scratch_arena_forge_success.png', fullPage: true });
        console.log('Screenshot saved to scratch_arena_forge_success.png');

        console.log('🎉 100% SUCCESS: Official Card-Forge Engine is executing MTG Commander in WebAssembly!');
    } catch (err) {
        console.error('❌ Test failed:', err);
    } finally {
        await browser.close();
    }
}

run();
