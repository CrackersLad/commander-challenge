const fs = require('fs');

globalThis.window = globalThis;
require('../public/mtg-lands.js');

const decklist = `
1 Nicol Bolas, the Ravager
1 Command Tower
1 Choked Estuary
1 Sunken Hollow
1 Reliquary Tower
1 Temple of Deceit
1 Underground River
1 Island
1 Swamp
1 Mountain
1 Sol Ring
1 Demonic Tutor
1 Counterspell
`;

// Test parseDecklistText logic
const lines = decklist.trim().split('\n');
const parsedCards = lines.map(l => {
  const name = l.replace(/^\d+\s+/, '').trim();
  const isLand = window.isLandCard(name);
  return {
    name,
    isLand,
    typeLine: isLand ? 'Land' : 'Spell',
    cmc: isLand ? 0 : 2
  };
});

console.log('--- Parsed Cards ---');
parsedCards.forEach(c => {
  console.log(c.name.padEnd(25), 'isLand:', c.isLand, 'typeLine:', c.typeLine);
});

// Test player hand cockpit logic
const player = {
  landPlayedThisTurn: false,
  landsPlayedCount: 0,
  hand: parsedCards,
  getCardCost: (c) => c.cmc
};

const currentPhase = 'MAIN_1';
const isMyTurn = true;
const availableMana = 0;

console.log('\n--- Cockpit Card Tags (Before playing any land) ---');
player.hand.forEach(c => {
  const isLand = c.isLand;
  let tagText = '';
  let isPlayable = false;
  if (isLand) {
    const hasPlayedLand = Boolean(player.landPlayedThisTurn) || Boolean(player.landsPlayedCount && player.landsPlayedCount >= 1);
    isPlayable = isMyTurn && currentPhase.includes('MAIN') && !hasPlayedLand;
    tagText = isPlayable ? 'Play Land' : (hasPlayedLand ? 'Land Played' : 'Land');
  } else {
    const cost = player.getCardCost(c);
    isPlayable = isMyTurn && currentPhase.includes('MAIN') && availableMana >= cost;
    tagText = isPlayable ? `Cast {${cost}}` : (cost > 0 ? `Need {${cost}} in Pool` : 'Cast {0}');
  }
  console.log(c.name.padEnd(25), 'Tag:', tagText.padEnd(15), 'Playable:', isPlayable);
});

// Play nonbasic land: Choked Estuary
console.log('\n--- Playing "Choked Estuary" ---');
const landCard = player.hand.find(c => c.name === 'Choked Estuary');
if (landCard.isLand) {
  if (player.landPlayedThisTurn) {
    console.log('BLOCKED: Already played a land this turn!');
  } else {
    player.landPlayedThisTurn = true;
    player.landsPlayedCount = 1;
    console.log('SUCCESS: Played', landCard.name);
  }
}

console.log('\n--- Cockpit Card Tags (After playing Choked Estuary) ---');
player.hand.forEach(c => {
  const isLand = c.isLand;
  let tagText = '';
  let isPlayable = false;
  if (isLand) {
    const hasPlayedLand = Boolean(player.landPlayedThisTurn) || Boolean(player.landsPlayedCount && player.landsPlayedCount >= 1);
    isPlayable = isMyTurn && currentPhase.includes('MAIN') && !hasPlayedLand;
    tagText = isPlayable ? 'Play Land' : (hasPlayedLand ? 'Land Played' : 'Land');
  } else {
    const cost = player.getCardCost(c);
    isPlayable = isMyTurn && currentPhase.includes('MAIN') && availableMana >= cost;
    tagText = isPlayable ? `Cast {${cost}}` : (cost > 0 ? `Need {${cost}} in Pool` : 'Cast {0}');
  }
  console.log(c.name.padEnd(25), 'Tag:', tagText.padEnd(15), 'Playable:', isPlayable);
});

// Attempt to play second nonbasic land: Sunken Hollow
console.log('\n--- Attempting to play second land: "Sunken Hollow" ---');
const secondLand = player.hand.find(c => c.name === 'Sunken Hollow');
if (secondLand.isLand) {
  const hasPlayedLand = Boolean(player.landPlayedThisTurn) || Boolean(player.landsPlayedCount && player.landsPlayedCount >= 1);
  if (hasPlayedLand) {
    console.log('CORRECTLY REJECTED: You have already played a land this turn (MTG Rule 305.2)!');
  } else {
    console.log('ERROR: Allowed second land drop!');
  }
}
