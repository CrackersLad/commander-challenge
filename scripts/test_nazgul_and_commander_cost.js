import assert from 'assert';
import fs from 'fs';

// Mock window and document
global.window = {
    __MTG_CARD_CACHE__: JSON.parse(fs.readFileSync('public/commander-cards-cache.json', 'utf8')),
    __FORGE_SCRIPTS__: {},
    confirm: () => true
};
global.document = {
    getElementById: () => null,
    body: { appendChild: () => {} }
};

// Load forge-adapter
const adapterCode = fs.readFileSync('public/forge-adapter.js', 'utf8');
eval(adapterCode);

const ForgeArena = global.window.ForgeArena;

async function runTests() {
    console.log('🧪 Testing Nazgûl ETB, The Ring Tempts You, Call of the Ring, and Commander Mana Cost Enforcement...\n');

    const testDecks = [
        {
            name: 'Sauron LOTR Deck',
            commander: 'Sauron, the Dark Lord',
            manaCost: '{3}{U}{B}{R}',
            cmc: 6,
            cards: [
                { name: 'Sauron, the Dark Lord', manaCost: '{3}{U}{B}{R}', cmc: 6, isCommander: true },
                { name: 'Nazgûl', manaCost: '{2}{B}', cmc: 3, typeLine: 'Creature — Wraith Knight', power: 2, toughness: 3 },
                { name: 'Call of the Ring', manaCost: '{1}{B}', cmc: 2, typeLine: 'Enchantment' },
                { name: 'Swamp', isLand: true, quantity: 20 },
                { name: 'Island', isLand: true, quantity: 20 },
                { name: 'Mountain', isLand: true, quantity: 20 }
            ]
        },
        { name: 'Bot 1', commander: 'Wilhelt, the Rotcleaver', cards: [] },
        { name: 'Bot 2', commander: 'Wilhelt, the Rotcleaver', cards: [] },
        { name: 'Bot 3', commander: 'Wilhelt, the Rotcleaver', cards: [] }
    ];

    const game = await ForgeArena.startMatch(testDecks, 0);
    const p1 = game.players[0];
    const cmdr = p1.getCommander();

    // 1. Commander Mana Cost Enforcement (Must NOT cast for 0 mana)
    console.log('1. Checking Commander initial status:');
    assert.strictEqual(cmdr.name, 'Sauron, the Dark Lord', 'Commander should be Sauron, the Dark Lord');
    assert.strictEqual(cmdr.manaCost, '{3}{U}{B}{R}', 'Commander manaCost must be {3}{U}{B}{R}');
    assert.strictEqual(cmdr.cmc, 6, 'Commander CMC must be 6');
    console.log('   Commander:', cmdr.name, '| Cost:', cmdr.manaCost, '| CMC:', cmdr.cmc, '-> PASS');

    console.log('2. Attempting to cast Commander with 0 mana in pool (MUST FAIL):');
    p1.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    const payCheck0 = p1.canPayCardCost(cmdr, p1.commanderTax || 0);
    assert.strictEqual(payCheck0.canPay, false, 'canPayCardCost must be FALSE with 0 mana');
    const castRes0 = await game.castCommander();
    assert.strictEqual(castRes0.success, false, 'castCommander() must fail when player has 0 mana');
    assert.strictEqual(p1.battlefield.some(c => c.name === cmdr.name), false, 'Commander must NOT be placed on battlefield');
    console.log('   Blocked 0-mana commander cast:', castRes0.message, '-> PASS');

    console.log('3. Providing only generic mana {6} without colors (MUST FAIL):');
    p1.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 6 };
    const payCheckColorless = p1.canPayCardCost(cmdr, p1.commanderTax || 0);
    assert.strictEqual(payCheckColorless.canPay, false, 'canPayCardCost must be FALSE without U, B, R pips');
    console.log('   Blocked colorless-only mana for Sauron:', payCheckColorless.reason, '-> PASS');

    console.log('4. Providing exact required mana {3}{U}{B}{R} in pool (MUST SUCCEED):');
    p1.manaPool = { W: 0, U: 1, B: 1, R: 1, G: 0, C: 3 };
    const payCheckSucceed = p1.canPayCardCost(cmdr, p1.commanderTax || 0);
    assert.strictEqual(payCheckSucceed.canPay, true, 'canPayCardCost must be TRUE with {3}{U}{B}{R}');
    const castResSuccess = await game.castCommander();
    assert.strictEqual(castResSuccess.success, true, 'castCommander() must succeed with proper mana');
    assert.strictEqual(p1.battlefield.some(c => c.name === cmdr.name), true, 'Commander now on battlefield');
    assert.strictEqual(p1.manaPool.U, 0, 'Blue mana deducted');
    assert.strictEqual(p1.manaPool.B, 0, 'Black mana deducted');
    assert.strictEqual(p1.manaPool.R, 0, 'Red mana deducted');
    assert.strictEqual(p1.manaPool.C, 0, 'Colorless mana deducted');
    console.log('   Commander cast successfully and exact colored pips deducted -> PASS');

    // 5. Testing Nazgûl ETB, The Ring Tempts You, and Wraith Counter
    console.log('5. Playing Nazgûl to the battlefield:');
    const nazgulCard = {
        id: 'nazgul_1',
        name: 'Nazgûl',
        manaCost: '{2}{B}',
        cmc: 3,
        typeLine: 'Creature — Wraith Knight',
        power: 2,
        toughness: 3,
        oracleText: 'Deathtouch\nWhen Nazgûl enters the battlefield, the Ring tempts you.\nWhenever the Ring tempts you, put a +1/+1 counter on each Wraith you control.\nA deck can have up to nine cards named Nazgûl.'
    };
    p1.battlefield.push(nazgulCard);
    assert.strictEqual(p1.ringLevel || 0, 0, 'Initial Ring Level should be 0');

    // Trigger ETB
    game.triggerETB(nazgulCard, p1);

    assert.strictEqual(p1.ringLevel, 1, 'Ring Level must advance to 1 (Stage 1)');
    assert.strictEqual(nazgulCard.isRingBearer, true, 'Nazgûl should be designated as Ring-bearer');
    assert.strictEqual(nazgulCard.isLegendary, true, 'Ring-bearer becomes legendary');

    // Check +1/+1 counter
    const effP = p1.getEffectivePower(nazgulCard);
    const effT = p1.getEffectiveToughness(nazgulCard);
    assert.strictEqual(effP, 3, 'Nazgûl power must be 3 (2 base + 1 counter)');
    assert.strictEqual(effT, 4, 'Nazgûl toughness must be 4 (3 base + 1 counter)');
    console.log('   Nazgûl ETB triggered: Ring Level =', p1.ringLevel, '| Ring-bearer =', nazgulCard.name, '| Stats =', `${effP}/${effT}`, '-> PASS');

    // 6. Testing Call of the Ring Upkeep Trigger
    console.log('6. Adding Call of the Ring and simulating Upkeep trigger:');
    const callOfRing = {
        id: 'call_1',
        name: 'Call of the Ring',
        manaCost: '{1}{B}',
        cmc: 2,
        typeLine: 'Enchantment',
        oracleText: 'At the beginning of your upkeep, the Ring tempts you.\nWhenever you choose a creature as your Ring-bearer, you may pay 2 life. If you do, draw a card.'
    };
    p1.battlefield.push(callOfRing);
    const initialLife = p1.life;
    const initialHandCount = p1.hand.length;

    // Trigger UPKEEP
    game.triggerPhase('UPKEEP', p1);

    assert.strictEqual(p1.ringLevel, 2, 'Ring Level must advance to 2 (Stage 2)');
    assert.strictEqual(p1.life, initialLife - 2, 'Player paid 2 life for Call of the Ring');
    assert.strictEqual(p1.hand.length, initialHandCount + 1, 'Player drew 1 card for Call of the Ring');

    // Nazgûl should have received another +1/+1 counter because the Ring tempted you again!
    const effP2 = p1.getEffectivePower(nazgulCard);
    const effT2 = p1.getEffectiveToughness(nazgulCard);
    assert.strictEqual(effP2, 4, 'Nazgûl power must now be 4 (+2 total counters)');
    assert.strictEqual(effT2, 5, 'Nazgûl toughness must now be 5 (+2 total counters)');
    console.log('   Call of the Ring triggered: Ring Level =', p1.ringLevel, '| Life =', p1.life, '| Drew card, Nazgûl stats now =', `${effP2}/${effT2}`, '-> PASS');

    console.log('\n🎉 ALL NAZGÛL, RING TEMPTATION & COMMANDER COST TESTS PASSED 100%!');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});

