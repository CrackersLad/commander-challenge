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
  for (let round = 1; round <= 2; round++) {
    console.log(`\n=== ROUND ${round} ===`);
    for (let playerIdx = 0; playerIdx < 4; playerIdx++) {
      console.log(`\n--- Player ${playerIdx}: ${game.players[playerIdx].name}'s Turn ---`);
      for (let p = 0; p < 7; p++) {
        const curPhase = game.currentPhase;
        const curActive = game.activePlayerIndex;
        const curTurn = game.turn;
        console.log(`  Phase: ${curPhase.padEnd(18)} | Turn: ${curTurn} | Active: ${game.getActivePlayer().name}`);
        await game.stepPhase();
      }
    }
  }
}
run();
