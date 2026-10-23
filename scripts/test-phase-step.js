const fs = require('fs');

globalThis.window = globalThis;
require('../public/mtg-lands.js');

const code = fs.readFileSync('./public/forge-adapter.js', 'utf8');
eval(code);

const game = new window.ForgeArena.ForgeArenaGame(null, null, [
  { name: 'You', commander: 'Wilhelt', cards: ['Island'] },
  { name: 'Opponent 1', commander: 'Lathril', cards: ['Forest'] },
  { name: 'Opponent 2', commander: 'Aesi', cards: ['Island'] },
  { name: 'Opponent 3', commander: 'Prosper', cards: ['Mountain'] }
]);

// Test starting player logic
console.log('--- Initial Game State ---');
console.log(`Turn ${game.turn}, Phase: ${game.currentPhase}, ActivePlayer: ${game.activePlayerIndex} (${game.getActivePlayer().name})`);

// Advance phases
async function run() {
  console.log('\n=== SIMULATING GAMEPLAY FLOW ===');
  for (let round = 1; round <= 3; round++) {
    console.log(`\n=================== TABLE ROUND ${round} (Turn ${game.turn}) ===================`);

    // Player 0 (Human) Turn
    console.log(`\n--- Player 0: ${game.getActivePlayer().name}'s Turn ---`);
    console.log(`  Start: Phase ${game.currentPhase} | Active: ${game.getActivePlayer().name}`);
    // Human plays Main 1
    await game.stepPhase(); // To combat / declare attackers
    console.log(`  Combat: Phase ${game.currentPhase} | Active: ${game.getActivePlayer().name}`);
    await game.stepPhase(); // To Main 2
    console.log(`  Main 2: Phase ${game.currentPhase} | Active: ${game.getActivePlayer().name}`);
    // Human clicks "End Turn" -> stepTurn()
    console.log(`  [Human clicks 'End Turn']`);
    await game.stepTurn();

    // Now Bot 1, Bot 2, Bot 3 take turns
    for (let botSeat = 1; botSeat <= 3; botSeat++) {
      const activeBot = game.getActivePlayer();
      console.log(`\n--- Seat ${botSeat}: ${activeBot.name}'s Turn ---`);
      console.log(`  Active: ${activeBot.name} (isAI: ${activeBot.isAI}) | Phase: ${game.currentPhase}`);
      console.log(`  [User clicks 'Advance ${activeBot.name}']`);
      await game.stepTurn();
    }

    console.log(`\nAfter round ${round}: Active is ${game.getActivePlayer().name} | Turn: ${game.turn} | Phase: ${game.currentPhase}`);
    if (game.activePlayerIndex !== 0) {
      throw new Error(`Expected active player to be 0 (You), got ${game.activePlayerIndex}`);
    }
  }
  console.log('\n✅ ALL 3 ROUNDS PASSED WITH PERFECT 4-PLAYER ROTATION!');
}
run();
