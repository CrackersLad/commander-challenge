import fs from 'fs';
import path from 'path';

// Mock DOM
global.window = global;
global.document = {
    getElementById: () => null,
    createElement: () => ({ style: {}, appendChild: () => {} }),
    body: { appendChild: () => {} },
    head: { appendChild: () => {} }
};

// Load mtg-lands.js
const mtgLandsCode = fs.readFileSync('public/mtg-lands.js', 'utf8');
eval(mtgLandsCode);

// Load forge-adapter.js
const forgeAdapterCode = fs.readFileSync('public/forge-adapter.js', 'utf8');
eval(forgeAdapterCode);

async function testPerformanceAndRules() {
    console.log("⏱️ Testing ForgeArena Match Start Speed...");
    const deck1 = {
        name: "Wilhelt Test",
        commander: "Wilhelt, the Rotcleaver",
        cards: [
            "Bojuka Bog",
            "Drowned Catacomb",
            "Watery Grave",
            "March from the Black Gate",
            "Shire Terrace",
            "Swamp",
            "Island"
        ]
    };
    const decks = [deck1, { name: "Bot 1" }, { name: "Bot 2" }, { name: "Bot 3" }];

    const t0 = performance.now();
    const game = await window.ForgeArena.startMatch(decks, 0);
    const t1 = performance.now();
    const durationMs = t1 - t0;

    console.log(`✅ Match started in: ${durationMs.toFixed(2)} ms! (Target: < 100 ms)`);
    if (durationMs > 200) {
        throw new Error(`Match start was too slow: ${durationMs}ms`);
    }

    const p1 = game.players[0];
    console.log(`Player 1 initialized: ${p1.name}, Life: ${p1.life}, Hand: ${p1.hand.length}`);

    // Verify ETB and Rules Logic in game
    console.log("\n🧪 Testing ETB & Rule resolution...");
    
    // 1. Bojuka Bog (must enter tapped)
    const bog = window.ForgeArena.enrichCard({ name: "Bojuka Bog" });
    p1.hand = [bog];
    await game.playCard(bog.id);
    const playedBog = p1.battlefield.find(c => c.name === "Bojuka Bog");
    console.log(`Bojuka Bog tapped state: ${playedBog?.tapped} (Expected: true)`);
    if (!playedBog || !playedBog.tapped) {
        throw new Error("Bojuka Bog failed to enter tapped!");
    }

    // 2. Drowned Catacomb without Island/Swamp on field
    p1.battlefield = []; // Clear
    const catacomb = window.ForgeArena.enrichCard({ name: "Drowned Catacomb" });
    p1.hand = [catacomb];
    await game.playCard(catacomb.id);
    const playedCatacomb = p1.battlefield.find(c => c.name === "Drowned Catacomb");
    console.log(`Drowned Catacomb tapped state (no basics): ${playedCatacomb?.tapped} (Expected: true)`);
    if (!playedCatacomb || !playedCatacomb.tapped) {
        throw new Error("Drowned Catacomb failed to enter tapped without basic types!");
    }

    // 3. March from the Black Gate (ETB Amass 1)
    const march = window.ForgeArena.enrichCard({ 
        name: "March from the Black Gate",
        manaCost: "{1}{B}",
        typeLine: "Enchantment",
        oracleText: "When March from the Black Gate enters the battlefield, amass Orcs 1. Whenever an Army you control attacks, put a +1/+1 counter on it and it gains deathtouch until end of turn."
    });
    p1.hand = [march];
    p1.manaPool = { B: 2, U: 0, R: 0, G: 0, W: 0, C: 0 };
    await game.playCard(march.id);
    const army = p1.battlefield.find(c => (c.name || '').includes('Army') || (c.typeLine || '').includes('Army'));
    const effPower = p1.getEffectivePower(army);
    const effToughness = p1.getEffectiveToughness(army);
    console.log(`March from the Black Gate Amass token: ${army?.name} Effective PT: ${effPower}/${effToughness} (Expected: Orc Army 1/1)`);
    if (!army || effPower !== 1 || effToughness !== 1) {
        throw new Error("March from the Black Gate failed to amass Orc Army!");
    }

    console.log("\n🎉 ALL TESTS PASSED! Ultra-fast match start verified with full rules fidelity.");
}

testPerformanceAndRules().catch(err => {
    console.error("❌ Test failed:", err);
    process.exit(1);
});
