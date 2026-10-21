/**
 * ============================================================================
 * COMMANDER ARENA - CONTROLLER & TABLETOP PRESENTER
 * ============================================================================
 * Coordinates the browser-native Commander rules engine, live tabletop interactions,
 * real MTG card art via Scryfall, 4-player pod seating, and priority management.
 */

(function () {
    'use strict';

    let currentGame = null;
    let autoPlayTimer = null;
    let playSpeedMs = 700;
    let isPaused = true;
    let selectedAttackerIds = new Set();
    let selectedOpponentTargetId = null;
    let selectedBottomCardIds = new Set();

    // Initialize Card Cache from commander-cards-cache.json
    try {
        fetch('commander-cards-cache.json')
            .then(r => r.json())
            .then(data => { window.__MTG_CARD_CACHE__ = data; })
            .catch(() => {});
    } catch (e) {}

    // High quality Commander precons with curated card lists
    const PRESET_DECKS = [
        {
                "id": "preset_wilhelt",
                "name": "Wilhelt, the Rotcleaver (Zombies)",
                "commander": "Wilhelt, the Rotcleaver",
                "cards": [
                        {
                                "name": "Wilhelt, the Rotcleaver",
                                "quantity": 1,
                                "manaCost": "{2}{U}{B}",
                                "cmc": 4,
                                "typeLine": "Legendary Creature — Zombie Warrior",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Whenever another Zombie you control dies, if it didn't have decayed, create a 2/2 black Zombie creature token with decayed. (It can't block. When it attacks, sacrifice it at end of combat.)\nAt the beginning of your end step, you may sacrifice a Zombie. If you do, draw a card.",
                                "isCommander": true
                        },
                        {
                                "name": "Liliana, Death's Majesty",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Legendary Planeswalker — Liliana",
                                "oracleText": "+1: Create a 2/2 black Zombie creature token. Mill two cards.\n−3: Return target creature card from your graveyard to the battlefield. That creature is a black Zombie in addition to its other colors and types.\n−7: Destroy all non-Zombie creatures.",
                                "isCommander": false
                        },
                        {
                                "name": "Forgotten Creation",
                                "quantity": 1,
                                "manaCost": "{3}{U}",
                                "cmc": 4,
                                "typeLine": "Creature — Zombie Horror",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Skulk (This creature can't be blocked by creatures with greater power.)\nAt the beginning of your upkeep, you may discard all the cards in your hand. If you do, draw that many cards.",
                                "isCommander": false
                        },
                        {
                                "name": "Havengul Runebinder",
                                "quantity": 1,
                                "manaCost": "{2}{U}{U}",
                                "cmc": 4,
                                "typeLine": "Creature — Human Wizard",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "{2}{U}, {T}, Exile a creature card from your graveyard: Create a 2/2 black Zombie creature token, then put a +1/+1 counter on each Zombie creature you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Stitcher Geralf",
                                "quantity": 1,
                                "manaCost": "{3}{U}{U}",
                                "cmc": 5,
                                "typeLine": "Legendary Creature — Human Wizard",
                                "power": "3",
                                "toughness": "4",
                                "oracleText": "{2}{U}, {T}: Each player mills three cards. Exile up to two creature cards put into graveyards this way. Create an X/X blue Zombie creature token, where X is the total power of the cards exiled this way.",
                                "isCommander": false
                        },
                        {
                                "name": "Undead Alchemist",
                                "quantity": 1,
                                "manaCost": "{3}{U}",
                                "cmc": 4,
                                "typeLine": "Creature — Zombie",
                                "power": "4",
                                "toughness": "2",
                                "oracleText": "If a Zombie you control would deal combat damage to a player, instead that player mills that many cards.\nWhenever a creature card is put into an opponent's graveyard from their library, exile that card and create a 2/2 black Zombie creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Butcher of Malakir",
                                "quantity": 1,
                                "manaCost": "{5}{B}{B}",
                                "cmc": 7,
                                "typeLine": "Creature — Vampire Warrior",
                                "power": "5",
                                "toughness": "4",
                                "oracleText": "Flying\nWhenever this creature or another creature you control dies, each opponent sacrifices a creature of their choice.",
                                "isCommander": false
                        },
                        {
                                "name": "Cemetery Reaper",
                                "quantity": 1,
                                "manaCost": "{1}{B}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Other Zombie creatures you control get +1/+1.\n{2}{B}, {T}: Exile target creature card from a graveyard. Create a 2/2 black Zombie creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Death Baron",
                                "quantity": 1,
                                "manaCost": "{1}{B}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie Wizard",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Skeletons you control and other Zombies you control get +1/+1 and have deathtouch. (Any amount of damage they deal to a creature is enough to destroy it.)",
                                "isCommander": false
                        },
                        {
                                "name": "Diregraf Colossus",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie Giant",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "This creature enters with a +1/+1 counter on it for each Zombie card in your graveyard.\nWhenever you cast a Zombie spell, create a tapped 2/2 black Zombie creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Eater of Hope",
                                "quantity": 1,
                                "manaCost": "{5}{B}{B}",
                                "cmc": 7,
                                "typeLine": "Creature — Demon",
                                "power": "6",
                                "toughness": "4",
                                "oracleText": "Flying\n{B}, Sacrifice another creature: Regenerate this creature.\n{2}{B}, Sacrifice two other creatures: Destroy target creature.",
                                "isCommander": false
                        },
                        {
                                "name": "Gravespawn Sovereign",
                                "quantity": 1,
                                "manaCost": "{4}{B}{B}",
                                "cmc": 6,
                                "typeLine": "Creature — Zombie",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Tap five untapped Zombies you control: Put target creature card from a graveyard onto the battlefield under your control.",
                                "isCommander": false
                        },
                        {
                                "name": "Midnight Reaper",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie Knight",
                                "power": "3",
                                "toughness": "2",
                                "oracleText": "Whenever a nontoken creature you control dies, this creature deals 1 damage to you and you draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Overseer of the Damned",
                                "quantity": 1,
                                "manaCost": "{5}{B}{B}",
                                "cmc": 7,
                                "typeLine": "Creature — Demon",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Flying\nWhen this creature enters, you may destroy target creature.\nWhenever a nontoken creature an opponent controls dies, create a tapped 2/2 black Zombie creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Gisa and Geralf",
                                "quantity": 1,
                                "manaCost": "{2}{U}{B}",
                                "cmc": 4,
                                "typeLine": "Legendary Creature — Human Wizard",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "When Gisa and Geralf enters, mill four cards.\nOnce during each of your turns, you may cast a Zombie creature spell from your graveyard.",
                                "isCommander": false
                        },
                        {
                                "name": "Eternal Skylord",
                                "quantity": 1,
                                "manaCost": "{4}{U}",
                                "cmc": 5,
                                "typeLine": "Creature — Zombie Wizard",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "When this creature enters, amass Zombies 2. (Put two +1/+1 counters on an Army you control. It's also a Zombie. If you don't control an Army, create a 0/0 black Zombie Army creature token first.)\nZombie tokens you control have flying.",
                                "isCommander": false
                        },
                        {
                                "name": "Corpse Augur",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Creature — Zombie Wizard",
                                "power": "4",
                                "toughness": "2",
                                "oracleText": "When this creature dies, you draw X cards and you lose X life, where X is the number of creature cards in target player's graveyard.",
                                "isCommander": false
                        },
                        {
                                "name": "Fleshbag Marauder",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie Warrior",
                                "power": "3",
                                "toughness": "1",
                                "oracleText": "When this creature enters, each player sacrifices a creature of their choice.",
                                "isCommander": false
                        },
                        {
                                "name": "Liliana's Devotee",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Human Warlock",
                                "power": "2",
                                "toughness": "3",
                                "oracleText": "Zombies you control get +1/+0.\nAt the beginning of your end step, if a creature died this turn, you may pay {1}{B}. If you do, create a 2/2 black Zombie creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Lord of the Accursed",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie",
                                "power": "2",
                                "toughness": "3",
                                "oracleText": "Other Zombies you control get +1/+1.\n{1}{B}, {T}: All Zombies gain menace until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Spark Reaper",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie",
                                "power": "2",
                                "toughness": "3",
                                "oracleText": "{3}, Sacrifice a creature or planeswalker: You gain 1 life and draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Undead Augur",
                                "quantity": 1,
                                "manaCost": "{B}{B}",
                                "cmc": 2,
                                "typeLine": "Creature — Zombie Wizard",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Whenever this creature or another Zombie you control dies, you draw a card and lose 1 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Diregraf Captain",
                                "quantity": 1,
                                "manaCost": "{1}{U}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie Soldier",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Deathtouch\nOther Zombie creatures you control get +1/+1.\nWhenever another Zombie you control dies, target opponent loses 1 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Gleaming Overseer",
                                "quantity": 1,
                                "manaCost": "{1}{U}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Zombie Wizard",
                                "power": "1",
                                "toughness": "4",
                                "oracleText": "When this creature enters, amass Zombies 1. (Put a +1/+1 counter on an Army you control. It's also a Zombie. If you don't control an Army, create a 0/0 black Zombie Army creature token first.)\nZombie tokens you control have hexproof and menace.",
                                "isCommander": false
                        },
                        {
                                "name": "Ruthless Deathfang",
                                "quantity": 1,
                                "manaCost": "{4}{U}{B}",
                                "cmc": 6,
                                "typeLine": "Creature — Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhenever you sacrifice a creature, target opponent sacrifices a creature of their choice.",
                                "isCommander": false
                        },
                        {
                                "name": "Hour of Eternity",
                                "quantity": 1,
                                "manaCost": "{X}{X}{U}{U}{U}",
                                "cmc": 3,
                                "typeLine": "Sorcery",
                                "oracleText": "Exile X target creature cards from your graveyard. For each card exiled this way, create a token that's a copy of that card, except it's a 4/4 black Zombie.",
                                "isCommander": false
                        },
                        {
                                "name": "Army of the Damned",
                                "quantity": 1,
                                "manaCost": "{5}{B}{B}{B}",
                                "cmc": 8,
                                "typeLine": "Sorcery",
                                "oracleText": "Create thirteen tapped 2/2 black Zombie creature tokens.\nFlashback {7}{B}{B}{B} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
                                "isCommander": false
                        },
                        {
                                "name": "Dark Salvation",
                                "quantity": 1,
                                "manaCost": "{X}{X}{B}",
                                "cmc": 1,
                                "typeLine": "Sorcery",
                                "oracleText": "Target player creates X 2/2 black Zombie creature tokens, then up to one target creature gets -1/-1 until end of turn for each Zombie that player controls.",
                                "isCommander": false
                        },
                        {
                                "name": "Dread Summons",
                                "quantity": 1,
                                "manaCost": "{X}{B}{B}",
                                "cmc": 2,
                                "typeLine": "Sorcery",
                                "oracleText": "Each player mills X cards. For each creature card put into a graveyard this way, you create a tapped 2/2 black Zombie creature token. (To mill a card, a player puts the top card of their library into their graveyard.)",
                                "isCommander": false
                        },
                        {
                                "name": "Zombie Apocalypse",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}{B}",
                                "cmc": 6,
                                "typeLine": "Sorcery",
                                "oracleText": "Return all Zombie creature cards from your graveyard to the battlefield tapped, then destroy all Humans.",
                                "isCommander": false
                        },
                        {
                                "name": "Distant Melody",
                                "quantity": 1,
                                "manaCost": "{3}{U}",
                                "cmc": 4,
                                "typeLine": "Sorcery",
                                "oracleText": "Choose a creature type. Draw a card for each permanent you control of that type.",
                                "isCommander": false
                        },
                        {
                                "name": "Feed the Swarm",
                                "quantity": 1,
                                "manaCost": "{1}{B}",
                                "cmc": 2,
                                "typeLine": "Sorcery",
                                "oracleText": "Destroy target creature or enchantment an opponent controls. You lose life equal to that permanent's mana value.",
                                "isCommander": false
                        },
                        {
                                "name": "Syphon Flesh",
                                "quantity": 1,
                                "manaCost": "{4}{B}",
                                "cmc": 5,
                                "typeLine": "Sorcery",
                                "oracleText": "Each other player sacrifices a creature of their choice. You create a 2/2 black Zombie creature token for each creature sacrificed this way.",
                                "isCommander": false
                        },
                        {
                                "name": "Aetherspouts",
                                "quantity": 1,
                                "manaCost": "{3}{U}{U}",
                                "cmc": 5,
                                "typeLine": "Instant",
                                "oracleText": "For each attacking creature, its owner puts it on their choice of the top or bottom of their library.",
                                "isCommander": false
                        },
                        {
                                "name": "Go for the Throat",
                                "quantity": 1,
                                "manaCost": "{1}{B}",
                                "cmc": 2,
                                "typeLine": "Instant",
                                "oracleText": "Destroy target nonartifact creature.",
                                "isCommander": false
                        },
                        {
                                "name": "Arcane Signet",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.",
                                "isCommander": false
                        },
                        {
                                "name": "Charcoal Diamond",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "This artifact enters tapped.\n{T}: Add {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Commander's Sphere",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.\nSacrifice this artifact: Draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Sky Diamond",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "This artifact enters tapped.\n{T}: Add {U}.",
                                "isCommander": false
                        },
                        {
                                "name": "Sol Ring",
                                "quantity": 1,
                                "manaCost": "{1}",
                                "cmc": 1,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}{C}.",
                                "isCommander": false
                        },
                        {
                                "name": "Talisman of Dominance",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}.\n{T}: Add {U} or {B}. This artifact deals 1 damage to you.",
                                "isCommander": false
                        },
                        {
                                "name": "Rooftop Storm",
                                "quantity": 1,
                                "manaCost": "{5}{U}",
                                "cmc": 6,
                                "typeLine": "Enchantment",
                                "oracleText": "You may pay {0} rather than pay the mana cost for Zombie creature spells you cast.",
                                "isCommander": false
                        },
                        {
                                "name": "Dreadhorde Invasion",
                                "quantity": 1,
                                "manaCost": "{1}{B}",
                                "cmc": 2,
                                "typeLine": "Enchantment",
                                "oracleText": "At the beginning of your upkeep, you lose 1 life and amass Zombies 1. (Put a +1/+1 counter on an Army you control. It's also a Zombie. If you don't control an Army, create a 0/0 black Zombie Army creature token first.)\nWhenever a Zombie token you control with power 6 or greater attacks, it gains lifelink until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Endless Ranks of the Dead",
                                "quantity": 1,
                                "manaCost": "{2}{B}{B}",
                                "cmc": 4,
                                "typeLine": "Enchantment",
                                "oracleText": "At the beginning of your upkeep, create X 2/2 black Zombie creature tokens, where X is half the number of Zombies you control, rounded down.",
                                "isCommander": false
                        },
                        {
                                "name": "Liliana's Mastery",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Enchantment",
                                "oracleText": "Zombies you control get +1/+1.\nWhen this enchantment enters, create two 2/2 black Zombie creature tokens.",
                                "isCommander": false
                        },
                        {
                                "name": "Open the Graves",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Enchantment",
                                "oracleText": "Whenever a nontoken creature you control dies, create a 2/2 black Zombie creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Choked Estuary",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "As this land enters, you may reveal an Island or Swamp card from your hand. If you don't, this land enters tapped.\n{T}: Add {U} or {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Darkwater Catacombs",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{1}, {T}: Add {U}{B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Exotic Orchard",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add one mana of any color that a land an opponent controls could produce.",
                                "isCommander": false
                        },
                        {
                                "name": "Sunken Hollow",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land — Island Swamp",
                                "oracleText": "({T}: Add {U} or {B}.)\nThis land enters tapped unless you control two or more basic lands.",
                                "isCommander": false
                        },
                        {
                                "name": "Temple of Deceit",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, scry 1. (Look at the top card of your library. You may put that card on the bottom.)\n{T}: Add {U} or {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Bojuka Bog",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, exile target player's graveyard.\n{T}: Add {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Command Tower",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.",
                                "isCommander": false
                        },
                        {
                                "name": "Dimir Aqueduct",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, return a land you control to its owner's hand.\n{T}: Add {U}{B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Mortuary Mire",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, you may put target creature card from your graveyard on top of your library.\n{T}: Add {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Myriad Landscape",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {C}.\n{2}, {T}, Sacrifice this land: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Path of Ancestry",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1. (Look at the top card of your library. You may put that card on the bottom.)",
                                "isCommander": false
                        },
                        {
                                "name": "Tainted Isle",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add {C}.\n{T}: Add {U} or {B}. Activate only if you control a Swamp.",
                                "isCommander": false
                        },
                        {
                                "name": "Unclaimed Territory",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type.",
                                "isCommander": false
                        },
                        {
                                "name": "Island",
                                "quantity": 12,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Island",
                                "oracleText": "({T}: Add {U}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 15,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Eloise, Nephalia Sleuth",
                                "quantity": 1,
                                "manaCost": "{3}{U}{B}",
                                "cmc": 5,
                                "typeLine": "Legendary Creature — Human Rogue",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Whenever another creature you control dies, investigate. (Create a Clue token. It's an artifact with \"{2}, Sacrifice this token: Draw a card.\")\nWhenever you sacrifice a token, surveil 1. (Look at the top card of your library. You may put that card into your graveyard.)",
                                "isCommander": false
                        },
                        {
                                "name": "Cleaver Skaab",
                                "quantity": 1,
                                "manaCost": "{3}{U}",
                                "cmc": 4,
                                "typeLine": "Creature — Zombie Horror",
                                "power": "2",
                                "toughness": "4",
                                "oracleText": "{3}, {T}, Sacrifice another Zombie: Create two tokens that are copies of the sacrificed creature.",
                                "isCommander": false
                        },
                        {
                                "name": "Curse of Unbinding",
                                "quantity": 1,
                                "manaCost": "{6}{U}",
                                "cmc": 7,
                                "typeLine": "Enchantment — Aura Curse",
                                "oracleText": "Enchant player\nAt the beginning of enchanted player's upkeep, that player reveals cards from the top of their library until they reveal a creature card. Put that card onto the battlefield under your control. That player puts the rest of the revealed cards into their graveyard.",
                                "isCommander": false
                        },
                        {
                                "name": "Drown in Dreams",
                                "quantity": 1,
                                "manaCost": "{X}{2}{U}",
                                "cmc": 3,
                                "typeLine": "Instant",
                                "oracleText": "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Target player draws X cards.\n• Target player mills twice X cards.",
                                "isCommander": false
                        },
                        {
                                "name": "Empty the Laboratory",
                                "quantity": 1,
                                "manaCost": "{X}{U}{U}",
                                "cmc": 2,
                                "typeLine": "Sorcery",
                                "oracleText": "Sacrifice X Zombies, then reveal cards from the top of your library until you reveal a number of Zombie creature cards equal to the number of Zombies sacrificed this way. Put those cards onto the battlefield and the rest on the bottom of your library in a random order.",
                                "isCommander": false
                        },
                        {
                                "name": "Hordewing Skaab",
                                "quantity": 1,
                                "manaCost": "{4}{U}",
                                "cmc": 5,
                                "typeLine": "Creature — Zombie Horror",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Flying\nOther Zombies you control have flying.\nWhenever one or more Zombies you control deal combat damage to one or more of your opponents, you may draw cards equal to the number of opponents dealt damage this way. If you do, discard that many cards.",
                                "isCommander": false
                        },
                        {
                                "name": "Shadow Kin",
                                "quantity": 1,
                                "manaCost": "{3}{U}",
                                "cmc": 4,
                                "typeLine": "Creature — Shapeshifter",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Flash\nAt the beginning of your upkeep, each player mills three cards. You may exile a creature card from among the cards milled this way. If you do, this creature becomes a copy of that card, except it has this ability.",
                                "isCommander": false
                        },
                        {
                                "name": "Crowded Crypt",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {B}.\nWhenever a creature you control dies, put a corpse counter on this artifact.\n{4}{B}{B}, {T}, Sacrifice this artifact: Create a 2/2 black Zombie creature token with decayed for each corpse counter on this artifact. (A creature with decayed can't block. When it attacks, sacrifice it at end of combat.)",
                                "isCommander": false
                        },
                        {
                                "name": "Curse of the Restless Dead",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Enchantment — Aura Curse",
                                "oracleText": "Enchant player\nWhenever a land enchanted player controls enters, you create a 2/2 black Zombie creature token with decayed. (It can't block. When it attacks, sacrifice it at end of combat.)",
                                "isCommander": false
                        },
                        {
                                "name": "Ghouls' Night Out",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Sorcery",
                                "oracleText": "For each player, choose a creature card in that player's graveyard. Put those cards onto the battlefield under your control. They're black Zombies in addition to their other colors and types and they gain decayed. (A creature with decayed can't block. When it attacks, sacrifice it at end of combat.)",
                                "isCommander": false
                        },
                        {
                                "name": "Gorex, the Tombshell",
                                "quantity": 1,
                                "manaCost": "{6}{B}{B}",
                                "cmc": 8,
                                "typeLine": "Legendary Creature — Zombie Turtle",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "As an additional cost to cast this spell, you may exile any number of creature cards from your graveyard. This spell costs {2} less to cast for each card exiled this way.\nDeathtouch\nWhenever Gorex attacks or dies, choose a card at random exiled with Gorex and put that card into its owner's hand.",
                                "isCommander": false
                        },
                        {
                                "name": "Prowling Geistcatcher",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Creature — Human Rogue",
                                "power": "2",
                                "toughness": "4",
                                "oracleText": "Whenever you sacrifice another creature, exile it. If that creature was a token, put a +1/+1 counter on this creature.\nWhen this creature leaves the battlefield, return each card exiled with it to the battlefield under your control.",
                                "isCommander": false
                        },
                        {
                                "name": "Ravenous Rotbelly",
                                "quantity": 1,
                                "manaCost": "{4}{B}",
                                "cmc": 5,
                                "typeLine": "Creature — Zombie Horror",
                                "power": "4",
                                "toughness": "5",
                                "oracleText": "When this creature enters, you may sacrifice up to three Zombies. When you sacrifice one or more Zombies this way, each opponent sacrifices that many creatures of their choice.",
                                "isCommander": false
                        },
                        {
                                "name": "Tomb Tyrant",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Creature — Zombie Noble",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Other Zombies you control get +1/+1.\n{2}{B}, {T}, Sacrifice a creature: Return a Zombie creature card at random from your graveyard to the battlefield. Activate only during your turn and only if there are at least three Zombie creature cards in your graveyard.",
                                "isCommander": false
                        }
                ]
        },
        {
                "id": "preset_lathril",
                "name": "Lathril, Blade of the Elves (Elfball)",
                "commander": "Lathril, Blade of the Elves",
                "cards": [
                        {
                                "name": "Lathril, Blade of the Elves",
                                "quantity": 1,
                                "manaCost": "{2}{B}{G}",
                                "cmc": 4,
                                "typeLine": "Legendary Creature — Elf Noble",
                                "power": "2",
                                "toughness": "3",
                                "oracleText": "Menace (This creature can't be blocked except by two or more creatures.)\nWhenever Lathril deals combat damage to a player, create that many 1/1 green Elf Warrior creature tokens.\n{T}, Tap ten untapped Elves you control: Each opponent loses 10 life and you gain 10 life.",
                                "isCommander": true
                        },
                        {
                                "name": "Abomination of Llanowar",
                                "quantity": 1,
                                "manaCost": "{1}{B}{G}",
                                "cmc": 3,
                                "typeLine": "Legendary Creature — Elf Horror",
                                "power": "*",
                                "toughness": "*",
                                "oracleText": "Vigilance; menace (This creature can't be blocked except by two or more creatures.)\nAbomination of Llanowar's power and toughness are each equal to the number of Elves you control plus the number of Elf cards in your graveyard.",
                                "isCommander": false
                        },
                        {
                                "name": "Beast Whisperer",
                                "quantity": 1,
                                "manaCost": "{2}{G}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Druid",
                                "power": "2",
                                "toughness": "3",
                                "oracleText": "Whenever you cast a creature spell, draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Canopy Tactician",
                                "quantity": 1,
                                "manaCost": "{3}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Warrior",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Other Elves you control get +1/+1.\n{T}: Add {G}{G}{G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Cultivator of Blades",
                                "quantity": 1,
                                "manaCost": "{3}{G}{G}",
                                "cmc": 5,
                                "typeLine": "Creature — Elf Artificer",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "Fabricate 2 (When this creature enters, put two +1/+1 counters on it or create two 1/1 colorless Servo artifact creature tokens.)\nWhenever this creature attacks, you may have other attacking creatures get +X/+X until end of turn, where X is this creature's power.",
                                "isCommander": false
                        },
                        {
                                "name": "Dwynen, Gilt-Leaf Daen",
                                "quantity": 1,
                                "manaCost": "{2}{G}{G}",
                                "cmc": 4,
                                "typeLine": "Legendary Creature — Elf Warrior",
                                "power": "3",
                                "toughness": "4",
                                "oracleText": "Reach (This creature can block creatures with flying.)\nOther Elf creatures you control get +1/+1.\nWhenever Dwynen attacks, you gain 1 life for each attacking Elf you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Elderfang Ritualist",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Cleric",
                                "power": "3",
                                "toughness": "1",
                                "oracleText": "When this creature dies, return another target Elf card from your graveyard to your hand.",
                                "isCommander": false
                        },
                        {
                                "name": "Elvish Archdruid",
                                "quantity": 1,
                                "manaCost": "{1}{G}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Druid",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Other Elf creatures you control get +1/+1.\n{T}: Add {G} for each Elf you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Elvish Mystic",
                                "quantity": 1,
                                "manaCost": "{G}",
                                "cmc": 1,
                                "typeLine": "Creature — Elf Druid",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "{T}: Add {G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Elvish Rejuvenator",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Druid",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "When this creature enters, look at the top five cards of your library. You may put a land card from among them onto the battlefield tapped. Put the rest on the bottom of your library in a random order.",
                                "isCommander": false
                        },
                        {
                                "name": "End-Raze Forerunners",
                                "quantity": 1,
                                "manaCost": "{5}{G}{G}{G}",
                                "cmc": 8,
                                "typeLine": "Creature — Boar",
                                "power": "7",
                                "toughness": "7",
                                "oracleText": "Vigilance, trample, haste\nWhen this creature enters, other creatures you control get +2/+2 and gain vigilance and trample until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Eyeblight Cullers",
                                "quantity": 1,
                                "manaCost": "{4}{B}",
                                "cmc": 5,
                                "typeLine": "Creature — Elf Warrior",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "When this creature dies, create three 1/1 green Elf Warrior creature tokens, then mill three cards. (Put the top three cards of your library into your graveyard.)",
                                "isCommander": false
                        },
                        {
                                "name": "Farhaven Elf",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Druid",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "When this creature enters, you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Golgari Findbroker",
                                "quantity": 1,
                                "manaCost": "{B}{B}{G}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Shaman",
                                "power": "3",
                                "toughness": "4",
                                "oracleText": "When this creature enters, return target permanent card from your graveyard to your hand.",
                                "isCommander": false
                        },
                        {
                                "name": "Harald, King of Skemfar",
                                "quantity": 1,
                                "manaCost": "{1}{B}{G}",
                                "cmc": 3,
                                "typeLine": "Legendary Creature — Elf Warrior",
                                "power": "3",
                                "toughness": "2",
                                "oracleText": "Menace (This creature can't be blocked except by two or more creatures.)\nWhen Harald enters, look at the top five cards of your library. You may reveal an Elf, Warrior, or Tyvar card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
                                "isCommander": false
                        },
                        {
                                "name": "Imperious Perfect",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Warrior",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Other Elves you control get +1/+1.\n{G}, {T}: Create a 1/1 green Elf Warrior creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Jagged-Scar Archers",
                                "quantity": 1,
                                "manaCost": "{1}{G}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Archer",
                                "power": "*",
                                "toughness": "*",
                                "oracleText": "Jagged-Scar Archers's power and toughness are each equal to the number of Elves you control.\n{T}: This creature deals damage equal to its power to target creature with flying.",
                                "isCommander": false
                        },
                        {
                                "name": "Jaspera Sentinel",
                                "quantity": 1,
                                "manaCost": "{G}",
                                "cmc": 1,
                                "typeLine": "Creature — Elf Rogue",
                                "power": "1",
                                "toughness": "2",
                                "oracleText": "Reach\n{T}, Tap an untapped creature you control: Add one mana of any color.",
                                "isCommander": false
                        },
                        {
                                "name": "Llanowar Tribe",
                                "quantity": 1,
                                "manaCost": "{G}{G}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Druid",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "{T}: Add {G}{G}{G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Lys Alana Huntmaster",
                                "quantity": 1,
                                "manaCost": "{2}{G}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Warrior",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Whenever you cast an Elf spell, you may create a 1/1 green Elf Warrior creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Lys Alana Scarblade",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Assassin",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "{T}, Discard an Elf card: Target creature gets -X/-X until end of turn, where X is the number of Elves you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Marwyn, the Nurturer",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Legendary Creature — Elf Druid",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "Whenever another Elf you control enters, put a +1/+1 counter on Marwyn.\n{T}: Add an amount of {G} equal to Marwyn's power.",
                                "isCommander": false
                        },
                        {
                                "name": "Masked Admirers",
                                "quantity": 1,
                                "manaCost": "{2}{G}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Shaman",
                                "power": "3",
                                "toughness": "2",
                                "oracleText": "When this creature enters, draw a card.\nWhenever you cast a creature spell, you may pay {G}{G}. If you do, return this card from your graveyard to your hand.",
                                "isCommander": false
                        },
                        {
                                "name": "Miara, Thorn of the Glade",
                                "quantity": 1,
                                "manaCost": "{1}{B}",
                                "cmc": 2,
                                "typeLine": "Legendary Creature — Elf Scout",
                                "power": "1",
                                "toughness": "2",
                                "oracleText": "Whenever Miara or another Elf you control dies, you may pay {1} and 1 life. If you do, draw a card.\nPartner (You can have two commanders if both have partner.)",
                                "isCommander": false
                        },
                        {
                                "name": "Nullmage Shepherd",
                                "quantity": 1,
                                "manaCost": "{3}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Shaman",
                                "power": "2",
                                "toughness": "4",
                                "oracleText": "Tap four untapped creatures you control: Destroy target artifact or enchantment.",
                                "isCommander": false
                        },
                        {
                                "name": "Numa, Joraga Chieftain",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Legendary Creature — Elf Warrior",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "At the beginning of combat on your turn, you may pay {X}{X}. When you do, distribute X +1/+1 counters among any number of target Elves.\nPartner (You can have two commanders if both have partner.)",
                                "isCommander": false
                        },
                        {
                                "name": "Poison-Tip Archer",
                                "quantity": 1,
                                "manaCost": "{2}{B}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Archer",
                                "power": "2",
                                "toughness": "3",
                                "oracleText": "Reach (This creature can block creatures with flying.)\nDeathtouch (Any amount of damage this deals to a creature is enough to destroy it.)\nWhenever another creature dies, each opponent loses 1 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Reclamation Sage",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Shaman",
                                "power": "2",
                                "toughness": "1",
                                "oracleText": "When this creature enters, you may destroy target artifact or enchantment.",
                                "isCommander": false
                        },
                        {
                                "name": "Rhys the Exiled",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Legendary Creature — Elf Warrior",
                                "power": "3",
                                "toughness": "2",
                                "oracleText": "Whenever Rhys attacks, you gain 1 life for each Elf you control.\n{B}, Sacrifice an Elf: Regenerate Rhys.",
                                "isCommander": false
                        },
                        {
                                "name": "Ruthless Winnower",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Creature — Elf Rogue",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "At the beginning of each player's upkeep, that player sacrifices a non-Elf creature of their choice.",
                                "isCommander": false
                        },
                        {
                                "name": "Shaman of the Pack",
                                "quantity": 1,
                                "manaCost": "{1}{B}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Shaman",
                                "power": "3",
                                "toughness": "2",
                                "oracleText": "When this creature enters, target opponent loses life equal to the number of Elves you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Skemfar Shadowsage",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Cleric",
                                "power": "2",
                                "toughness": "5",
                                "oracleText": "When this creature enters, choose one —\n• Each opponent loses X life, where X is the greatest number of creatures you control that have a creature type in common.\n• You gain X life, where X is the greatest number of creatures you control that have a creature type in common.",
                                "isCommander": false
                        },
                        {
                                "name": "Springbloom Druid",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Druid",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "When this creature enters, you may sacrifice a land. If you do, search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Sylvan Messenger",
                                "quantity": 1,
                                "manaCost": "{3}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)\nWhen this creature enters, reveal the top four cards of your library. Put all Elf cards revealed this way into your hand and the rest on the bottom of your library in any order.",
                                "isCommander": false
                        },
                        {
                                "name": "Timberwatch Elf",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf",
                                "power": "1",
                                "toughness": "2",
                                "oracleText": "{T}: Target creature gets +X/+X until end of turn, where X is the number of Elves on the battlefield.",
                                "isCommander": false
                        },
                        {
                                "name": "Twinblade Assassins",
                                "quantity": 1,
                                "manaCost": "{3}{B}{G}",
                                "cmc": 5,
                                "typeLine": "Creature — Elf Assassin",
                                "power": "5",
                                "toughness": "4",
                                "oracleText": "At the beginning of your end step, if a creature died this turn, draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Voice of Many",
                                "quantity": 1,
                                "manaCost": "{2}{G}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Druid",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "When this creature enters, draw a card for each opponent who controls fewer creatures than you.",
                                "isCommander": false
                        },
                        {
                                "name": "Voice of the Woods",
                                "quantity": 1,
                                "manaCost": "{3}{G}{G}",
                                "cmc": 5,
                                "typeLine": "Creature — Elf",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Tap five untapped Elves you control: Create a 7/7 green Elemental creature token with trample. (It can deal excess combat damage to the player or planeswalker it's attacking.)",
                                "isCommander": false
                        },
                        {
                                "name": "Wirewood Channeler",
                                "quantity": 1,
                                "manaCost": "{3}{G}",
                                "cmc": 4,
                                "typeLine": "Creature — Elf Druid",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "{T}: Add X mana of any one color, where X is the number of Elves on the battlefield.",
                                "isCommander": false
                        },
                        {
                                "name": "Wolverine Riders",
                                "quantity": 1,
                                "manaCost": "{4}{G}{G}",
                                "cmc": 6,
                                "typeLine": "Creature — Elf Warrior",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "At the beginning of each upkeep, create a 1/1 green Elf Warrior creature token.\nWhenever another Elf you control enters, you gain life equal to its toughness.",
                                "isCommander": false
                        },
                        {
                                "name": "Wood Elves",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Creature — Elf Scout",
                                "power": "1",
                                "toughness": "1",
                                "oracleText": "When this creature enters, search your library for a Forest card, put that card onto the battlefield, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Elven Ambush",
                                "quantity": 1,
                                "manaCost": "{3}{G}",
                                "cmc": 4,
                                "typeLine": "Instant",
                                "oracleText": "Create a 1/1 green Elf Warrior creature token for each Elf you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Poison the Cup",
                                "quantity": 1,
                                "manaCost": "{1}{B}{B}",
                                "cmc": 3,
                                "typeLine": "Instant",
                                "oracleText": "Destroy target creature. If this spell was foretold, scry 2.\nForetell {1}{B} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)",
                                "isCommander": false
                        },
                        {
                                "name": "Putrefy",
                                "quantity": 1,
                                "manaCost": "{1}{B}{G}",
                                "cmc": 3,
                                "typeLine": "Instant",
                                "oracleText": "Destroy target artifact or creature. It can't be regenerated.",
                                "isCommander": false
                        },
                        {
                                "name": "Tergrid's Shadow",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Instant",
                                "oracleText": "Each player sacrifices two creatures.\nForetell {2}{B}{B} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)",
                                "isCommander": false
                        },
                        {
                                "name": "Ambition's Cost",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Sorcery",
                                "oracleText": "You draw three cards and lose 3 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Bounty of Skemfar",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Sorcery",
                                "oracleText": "Reveal the top six cards of your library. You may put up to one land card from among them onto the battlefield tapped and up to one Elf card from among them into your hand. Put the rest on the bottom of your library in a random order.",
                                "isCommander": false
                        },
                        {
                                "name": "Casualties of War",
                                "quantity": 1,
                                "manaCost": "{2}{B}{B}{G}{G}",
                                "cmc": 6,
                                "typeLine": "Sorcery",
                                "oracleText": "Choose one or more —\n• Destroy target artifact.\n• Destroy target creature.\n• Destroy target enchantment.\n• Destroy target land.\n• Destroy target planeswalker.",
                                "isCommander": false
                        },
                        {
                                "name": "Eyeblight Massacre",
                                "quantity": 1,
                                "manaCost": "{2}{B}{B}",
                                "cmc": 4,
                                "typeLine": "Sorcery",
                                "oracleText": "Non-Elf creatures get -2/-2 until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Elvish Promenade",
                                "quantity": 1,
                                "manaCost": "{3}{G}",
                                "cmc": 4,
                                "typeLine": "Kindred Sorcery — Elf",
                                "oracleText": "Create a 1/1 green Elf Warrior creature token for each Elf you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Harvest Season",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Sorcery",
                                "oracleText": "Search your library for up to X basic land cards, where X is the number of tapped creatures you control, put those cards onto the battlefield tapped, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Pact of the Serpent",
                                "quantity": 1,
                                "manaCost": "{1}{B}{B}",
                                "cmc": 3,
                                "typeLine": "Sorcery",
                                "oracleText": "Choose a creature type. Target player draws X cards and loses X life, where X is the number of creatures they control of the chosen type.",
                                "isCommander": false
                        },
                        {
                                "name": "Return Upon the Tide",
                                "quantity": 1,
                                "manaCost": "{4}{B}",
                                "cmc": 5,
                                "typeLine": "Sorcery",
                                "oracleText": "Return target creature card from your graveyard to the battlefield. If it's an Elf, create two 1/1 green Elf Warrior creature tokens.\nForetell {3}{B} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)",
                                "isCommander": false
                        },
                        {
                                "name": "Roots of Wisdom",
                                "quantity": 1,
                                "manaCost": "{1}{G}",
                                "cmc": 2,
                                "typeLine": "Sorcery",
                                "oracleText": "Mill three cards, then return a land card or Elf card from your graveyard to your hand. If you can't, draw a card. (To mill a card, put the top card of your library into your graveyard.)",
                                "isCommander": false
                        },
                        {
                                "name": "Arcane Signet",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.",
                                "isCommander": false
                        },
                        {
                                "name": "Serpent's Soul-Jar",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "Whenever an Elf you control dies, exile it.\n{T}, Pay 2 life: Until end of turn, you may cast a creature spell from among cards exiled with this artifact.",
                                "isCommander": false
                        },
                        {
                                "name": "Sol Ring",
                                "quantity": 1,
                                "manaCost": "{1}",
                                "cmc": 1,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}{C}.",
                                "isCommander": false
                        },
                        {
                                "name": "Binding the Old Gods",
                                "quantity": 1,
                                "manaCost": "{2}{B}{G}",
                                "cmc": 4,
                                "typeLine": "Enchantment — Saga",
                                "oracleText": "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — Destroy target nonland permanent an opponent controls.\nII — Search your library for a Forest card, put it onto the battlefield tapped, then shuffle.\nIII — Creatures you control gain deathtouch until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Crown of Skemfar",
                                "quantity": 1,
                                "manaCost": "{2}{G}{G}",
                                "cmc": 4,
                                "typeLine": "Enchantment — Aura",
                                "oracleText": "Enchant creature\nEnchanted creature gets +1/+1 for each Elf you control and has reach.\n{2}{G}: Return this card from your graveyard to your hand.",
                                "isCommander": false
                        },
                        {
                                "name": "Elderfang Venom",
                                "quantity": 1,
                                "manaCost": "{2}{B}{G}",
                                "cmc": 4,
                                "typeLine": "Enchantment",
                                "oracleText": "Attacking Elves you control have deathtouch.\nWhenever an Elf you control dies, each opponent loses 1 life and you gain 1 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Pride of the Perfect",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Enchantment",
                                "oracleText": "Elves you control get +2/+0.",
                                "isCommander": false
                        },
                        {
                                "name": "Prowess of the Fair",
                                "quantity": 1,
                                "manaCost": "{1}{B}",
                                "cmc": 2,
                                "typeLine": "Kindred Enchantment — Elf",
                                "oracleText": "Whenever another nontoken Elf is put into your graveyard from the battlefield, you may create a 1/1 green Elf Warrior creature token.",
                                "isCommander": false
                        },
                        {
                                "name": "Moldervine Reclamation",
                                "quantity": 1,
                                "manaCost": "{3}{B}{G}",
                                "cmc": 5,
                                "typeLine": "Enchantment",
                                "oracleText": "Whenever a creature you control dies, you gain 1 life and draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Command Tower",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.",
                                "isCommander": false
                        },
                        {
                                "name": "Forest",
                                "quantity": 16,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Forest",
                                "oracleText": "({T}: Add {G}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Foul Orchard",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {B} or {G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Golgari Guildgate",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land — Gate",
                                "oracleText": "This land enters tapped.\n{T}: Add {B} or {G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Golgari Rot Farm",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, return a land you control to its owner's hand.\n{T}: Add {B}{G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Jungle Hollow",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, you gain 1 life.\n{T}: Add {B} or {G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Myriad Landscape",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {C}.\n{2}, {T}, Sacrifice this land: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Path of Ancestry",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1. (Look at the top card of your library. You may put that card on the bottom.)",
                                "isCommander": false
                        },
                        {
                                "name": "Skemfar Elderhall",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {G}.\n{2}{B}{B}{G}, {T}, Sacrifice this land: Up to one target creature you don't control gets -2/-2 until end of turn. Create two 1/1 green Elf Warrior creature tokens. Activate only as a sorcery.",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 13,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        }
                ]
        },
        {
                "id": "preset_urdragon",
                "name": "The Ur-Dragon (Draconic Domination)",
                "commander": "The Ur-Dragon",
                "cards": [
                        {
                                "name": "The Ur-Dragon",
                                "quantity": 1,
                                "manaCost": "{4}{W}{U}{B}{R}{G}",
                                "cmc": 9,
                                "typeLine": "Legendary Creature — Dragon Avatar",
                                "power": "10",
                                "toughness": "10",
                                "oracleText": "Eminence — As long as The Ur-Dragon is in the command zone or on the battlefield, other Dragon spells you cast cost {1} less to cast.\nFlying\nWhenever one or more Dragons you control attack, draw that many cards, then you may put a permanent card from your hand onto the battlefield.",
                                "isCommander": true
                        },
                        {
                                "name": "O-Kagachi, Vengeful Kami",
                                "quantity": 1,
                                "manaCost": "{1}{W}{U}{B}{R}{G}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Dragon Spirit",
                                "power": "6",
                                "toughness": "6",
                                "oracleText": "Flying, trample\nWhenever O-Kagachi deals combat damage to a player, if that player attacked you during their last turn, exile target nonland permanent that player controls.",
                                "isCommander": false
                        },
                        {
                                "name": "Ramos, Dragon Engine",
                                "quantity": 1,
                                "manaCost": "{6}",
                                "cmc": 6,
                                "typeLine": "Legendary Artifact Creature — Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhenever you cast a spell, put a +1/+1 counter on Ramos for each of that spell's colors.\nRemove five +1/+1 counters from Ramos: Add {W}{W}{U}{U}{B}{B}{R}{R}{G}{G}. Activate only once each turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Scalelord Reckoner",
                                "quantity": 1,
                                "manaCost": "{3}{W}{W}",
                                "cmc": 5,
                                "typeLine": "Creature — Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhenever a Dragon you control becomes the target of a spell or ability an opponent controls, destroy target nonland permanent that player controls.",
                                "isCommander": false
                        },
                        {
                                "name": "Boneyard Scourge",
                                "quantity": 1,
                                "manaCost": "{2}{B}{B}",
                                "cmc": 4,
                                "typeLine": "Creature — Zombie Dragon",
                                "power": "4",
                                "toughness": "3",
                                "oracleText": "Flying\nWhenever a Dragon you control dies while this card is in your graveyard, you may pay {1}{B}. If you do, return this card from your graveyard to the battlefield.",
                                "isCommander": false
                        },
                        {
                                "name": "Territorial Hellkite",
                                "quantity": 1,
                                "manaCost": "{2}{R}{R}",
                                "cmc": 4,
                                "typeLine": "Creature — Dragon",
                                "power": "6",
                                "toughness": "5",
                                "oracleText": "Flying, haste\nAt the beginning of combat on your turn, choose an opponent at random that this creature didn't attack during your last combat. This creature attacks that player this combat if able. If you can't choose an opponent this way, tap this creature.",
                                "isCommander": false
                        },
                        {
                                "name": "Taigam, Ojutai Master",
                                "quantity": 1,
                                "manaCost": "{2}{W}{U}",
                                "cmc": 4,
                                "typeLine": "Legendary Creature — Human Monk",
                                "power": "3",
                                "toughness": "4",
                                "oracleText": "Instant, sorcery, and Dragon spells you control can't be countered.\nWhenever you cast an instant or sorcery spell from your hand, if Taigam attacked this turn, that spell gains rebound. (Exile the spell as it resolves. At the beginning of your next upkeep, you may cast that card from exile without paying its mana cost.)",
                                "isCommander": false
                        },
                        {
                                "name": "Wasitora, Nekoru Queen",
                                "quantity": 1,
                                "manaCost": "{2}{B}{R}{G}",
                                "cmc": 5,
                                "typeLine": "Legendary Creature — Cat Dragon",
                                "power": "5",
                                "toughness": "4",
                                "oracleText": "Flying, trample\nWhenever Wasitora deals combat damage to a player, that player sacrifices a creature of their choice. If the player can't, you create a 3/3 black, red, and green Cat Dragon creature token with flying.",
                                "isCommander": false
                        },
                        {
                                "name": "Ryusei, the Falling Star",
                                "quantity": 1,
                                "manaCost": "{5}{R}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Dragon Spirit",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Flying\nWhen Ryusei dies, it deals 5 damage to each creature without flying.",
                                "isCommander": false
                        },
                        {
                                "name": "Scourge of Valkas",
                                "quantity": 1,
                                "manaCost": "{2}{R}{R}{R}",
                                "cmc": 5,
                                "typeLine": "Creature — Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhenever this creature or another Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.\n{R}: This creature gets +1/+0 until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Utvara Hellkite",
                                "quantity": 1,
                                "manaCost": "{6}{R}{R}",
                                "cmc": 8,
                                "typeLine": "Creature — Dragon",
                                "power": "6",
                                "toughness": "6",
                                "oracleText": "Flying\nWhenever a Dragon you control attacks, create a 6/6 red Dragon creature token with flying.",
                                "isCommander": false
                        },
                        {
                                "name": "Sunscorch Regent",
                                "quantity": 1,
                                "manaCost": "{3}{W}{W}",
                                "cmc": 5,
                                "typeLine": "Creature — Dragon",
                                "power": "4",
                                "toughness": "3",
                                "oracleText": "Flying\nWhenever an opponent casts a spell, put a +1/+1 counter on this creature and you gain 1 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Deathbringer Regent",
                                "quantity": 1,
                                "manaCost": "{5}{B}{B}",
                                "cmc": 7,
                                "typeLine": "Creature — Dragon",
                                "power": "5",
                                "toughness": "6",
                                "oracleText": "Flying\nWhen this creature enters, if you cast it from your hand and there are five or more other creatures on the battlefield, destroy all other creatures.",
                                "isCommander": false
                        },
                        {
                                "name": "Hellkite Charger",
                                "quantity": 1,
                                "manaCost": "{4}{R}{R}",
                                "cmc": 6,
                                "typeLine": "Creature — Dragon",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Flying, haste\nWhenever this creature attacks, you may pay {5}{R}{R}. If you do, untap all attacking creatures and after this phase, there is an additional combat phase.",
                                "isCommander": false
                        },
                        {
                                "name": "Tyrant's Familiar",
                                "quantity": 1,
                                "manaCost": "{5}{R}{R}",
                                "cmc": 7,
                                "typeLine": "Creature — Dragon",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Flying, haste\nLieutenant — As long as you control your commander, this creature gets +2/+2 and has \"Whenever this creature attacks, it deals 7 damage to target creature defending player controls.\"",
                                "isCommander": false
                        },
                        {
                                "name": "Atarka, World Render",
                                "quantity": 1,
                                "manaCost": "{5}{R}{G}",
                                "cmc": 7,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "6",
                                "toughness": "4",
                                "oracleText": "Flying, trample\nWhenever a Dragon you control attacks, it gains double strike until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Bladewing the Risen",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}{R}{R}",
                                "cmc": 7,
                                "typeLine": "Legendary Creature — Zombie Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhen Bladewing enters, you may return target Dragon permanent card from your graveyard to the battlefield.\n{B}{R}: Dragon creatures get +1/+1 until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Broodmate Dragon",
                                "quantity": 1,
                                "manaCost": "{3}{B}{R}{G}",
                                "cmc": 6,
                                "typeLine": "Creature — Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhen this creature enters, create a 4/4 red Dragon creature token with flying.",
                                "isCommander": false
                        },
                        {
                                "name": "Crosis, the Purger",
                                "quantity": 1,
                                "manaCost": "{3}{U}{B}{R}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "6",
                                "toughness": "6",
                                "oracleText": "Flying\nWhenever Crosis deals combat damage to a player, you may pay {2}{B}. If you do, choose a color, then that player reveals their hand and discards all cards of that color.",
                                "isCommander": false
                        },
                        {
                                "name": "Dromoka, the Eternal",
                                "quantity": 1,
                                "manaCost": "{3}{G}{W}",
                                "cmc": 5,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Flying\nWhenever a Dragon you control attacks, bolster 2. (Choose a creature with the least toughness among creatures you control and put two +1/+1 counters on it.)",
                                "isCommander": false
                        },
                        {
                                "name": "Intet, the Dreamer",
                                "quantity": 1,
                                "manaCost": "{3}{G}{U}{R}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "6",
                                "toughness": "6",
                                "oracleText": "Flying\nWhenever Intet deals combat damage to a player, you may pay {2}{U}. If you do, exile the top card of your library face down. You may look at that card for as long as it remains exiled. You may play that card without paying its mana cost for as long as Intet remains on the battlefield.",
                                "isCommander": false
                        },
                        {
                                "name": "Kolaghan, the Storm's Fury",
                                "quantity": 1,
                                "manaCost": "{3}{B}{R}",
                                "cmc": 5,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "4",
                                "toughness": "5",
                                "oracleText": "Flying\nWhenever a Dragon you control attacks, creatures you control get +1/+0 until end of turn.\nDash {3}{B}{R} (You may cast this spell for its dash cost. If you do, it gains haste, and it's returned from the battlefield to its owner's hand at the beginning of the next end step.)",
                                "isCommander": false
                        },
                        {
                                "name": "Niv-Mizzet, Dracogenius",
                                "quantity": 1,
                                "manaCost": "{2}{U}{U}{R}{R}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Dragon Wizard",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Flying\nWhenever Niv-Mizzet deals damage to a player, you may draw a card.\n{U}{R}: Niv-Mizzet deals 1 damage to any target.",
                                "isCommander": false
                        },
                        {
                                "name": "Ojutai, Soul of Winter",
                                "quantity": 1,
                                "manaCost": "{5}{W}{U}",
                                "cmc": 7,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "5",
                                "toughness": "6",
                                "oracleText": "Flying, vigilance\nWhenever a Dragon you control attacks, tap target nonland permanent an opponent controls. That permanent doesn't untap during its controller's next untap step.",
                                "isCommander": false
                        },
                        {
                                "name": "Scion of the Ur-Dragon",
                                "quantity": 1,
                                "manaCost": "{W}{U}{B}{R}{G}",
                                "cmc": 5,
                                "typeLine": "Legendary Creature — Dragon Avatar",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\n{2}: Search your library for a Dragon permanent card and put it into your graveyard. If you do, Scion of the Ur-Dragon becomes a copy of that card until end of turn. Then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Silumgar, the Drifting Death",
                                "quantity": 1,
                                "manaCost": "{4}{U}{B}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "3",
                                "toughness": "7",
                                "oracleText": "Flying, hexproof\nWhenever a Dragon you control attacks, creatures defending player controls get -1/-1 until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Spellbound Dragon",
                                "quantity": 1,
                                "manaCost": "{3}{U}{R}",
                                "cmc": 5,
                                "typeLine": "Creature — Dragon",
                                "power": "3",
                                "toughness": "5",
                                "oracleText": "Flying\nWhenever this creature attacks, draw a card, then discard a card. This creature gets +X/+0 until end of turn, where X is the discarded card's mana value.",
                                "isCommander": false
                        },
                        {
                                "name": "Teneb, the Harvester",
                                "quantity": 1,
                                "manaCost": "{3}{W}{B}{G}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Dragon",
                                "power": "6",
                                "toughness": "6",
                                "oracleText": "Flying\nWhenever Teneb deals combat damage to a player, you may pay {2}{B}. If you do, put target creature card from a graveyard onto the battlefield under your control.",
                                "isCommander": false
                        },
                        {
                                "name": "Steel Hellkite",
                                "quantity": 1,
                                "manaCost": "{6}",
                                "cmc": 6,
                                "typeLine": "Artifact Creature — Dragon",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Flying\n{2}: This creature gets +1/+0 until end of turn.\n{X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn. Activate only once each turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Orator of Ojutai",
                                "quantity": 1,
                                "manaCost": "{1}{W}",
                                "cmc": 2,
                                "typeLine": "Creature — Bird Monk",
                                "power": "0",
                                "toughness": "4",
                                "oracleText": "As an additional cost to cast this spell, you may reveal a Dragon card from your hand.\nDefender, flying\nWhen this creature enters, if you revealed a Dragon card or controlled a Dragon as you cast this spell, draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Dragonlord's Servant",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Creature — Goblin Shaman",
                                "power": "1",
                                "toughness": "3",
                                "oracleText": "Dragon spells you cast cost {1} less to cast.",
                                "isCommander": false
                        },
                        {
                                "name": "Dragonspeaker Shaman",
                                "quantity": 1,
                                "manaCost": "{1}{R}{R}",
                                "cmc": 3,
                                "typeLine": "Creature — Human Barbarian Shaman",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "Dragon spells you cast cost {2} less to cast.",
                                "isCommander": false
                        },
                        {
                                "name": "Savage Ventmaw",
                                "quantity": 1,
                                "manaCost": "{4}{R}{G}",
                                "cmc": 6,
                                "typeLine": "Creature — Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhenever this creature attacks, add {R}{R}{R}{G}{G}{G}. Until end of turn, you don't lose this mana as steps and phases end.",
                                "isCommander": false
                        },
                        {
                                "name": "Fortunate Few",
                                "quantity": 1,
                                "manaCost": "{3}{W}{W}",
                                "cmc": 5,
                                "typeLine": "Sorcery",
                                "oracleText": "Choose a nonland permanent you don't control, then each other player chooses a nonland permanent they don't control that hasn't been chosen this way. Destroy all other nonland permanents.",
                                "isCommander": false
                        },
                        {
                                "name": "Fractured Identity",
                                "quantity": 1,
                                "manaCost": "{3}{W}{U}",
                                "cmc": 5,
                                "typeLine": "Sorcery",
                                "oracleText": "Exile target nonland permanent. Each player other than its controller creates a token that's a copy of it.",
                                "isCommander": false
                        },
                        {
                                "name": "Crux of Fate",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Sorcery",
                                "oracleText": "Choose one —\n• Destroy all Dragon creatures.\n• Destroy all non-Dragon creatures.",
                                "isCommander": false
                        },
                        {
                                "name": "Painful Truths",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Sorcery",
                                "oracleText": "Converge — You draw X cards and lose X life, where X is the number of colors of mana spent to cast this spell.",
                                "isCommander": false
                        },
                        {
                                "name": "Earthquake",
                                "quantity": 1,
                                "manaCost": "{X}{R}",
                                "cmc": 1,
                                "typeLine": "Sorcery",
                                "oracleText": "Earthquake deals X damage to each creature without flying and each player.",
                                "isCommander": false
                        },
                        {
                                "name": "Cultivate",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Sorcery",
                                "oracleText": "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Farseek",
                                "quantity": 1,
                                "manaCost": "{1}{G}",
                                "cmc": 2,
                                "typeLine": "Sorcery",
                                "oracleText": "Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Kodama's Reach",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Sorcery — Arcane",
                                "oracleText": "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Rain of Thorns",
                                "quantity": 1,
                                "manaCost": "{4}{G}{G}",
                                "cmc": 6,
                                "typeLine": "Sorcery",
                                "oracleText": "Choose one or more —\n• Destroy target artifact.\n• Destroy target enchantment.\n• Destroy target land.",
                                "isCommander": false
                        },
                        {
                                "name": "Fist of Suns",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "You may pay {W}{U}{B}{R}{G} rather than pay the mana cost for spells you cast.",
                                "isCommander": false
                        },
                        {
                                "name": "Herald's Horn",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "As this artifact enters, choose a creature type.\nCreature spells you cast of the chosen type cost {1} less to cast.\nAt the beginning of your upkeep, look at the top card of your library. If it's a creature card of the chosen type, you may reveal it and put it into your hand.",
                                "isCommander": false
                        },
                        {
                                "name": "Mirror of the Forebears",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "As this artifact enters, choose a creature type.\n{1}: Until end of turn, this artifact becomes a copy of target creature you control of the chosen type, except it's an artifact in addition to its other types.",
                                "isCommander": false
                        },
                        {
                                "name": "Armillary Sphere",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{2}, {T}, Sacrifice this artifact: Search your library for up to two basic land cards, reveal them, put them into your hand, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Commander's Sphere",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.\nSacrifice this artifact: Draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Darksteel Ingot",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "Indestructible (Effects that say \"destroy\" don't destroy this artifact.)\n{T}: Add one mana of any color.",
                                "isCommander": false
                        },
                        {
                                "name": "Dreamstone Hedron",
                                "quantity": 1,
                                "manaCost": "{6}",
                                "cmc": 6,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}{C}{C}.\n{3}, {T}, Sacrifice this artifact: Draw three cards.",
                                "isCommander": false
                        },
                        {
                                "name": "Lightning Greaves",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact — Equipment",
                                "oracleText": "Equipped creature has haste and shroud. (It can't be the target of spells or abilities.)\nEquip {0}",
                                "isCommander": false
                        },
                        {
                                "name": "Nihil Spellbomb",
                                "quantity": 1,
                                "manaCost": "{1}",
                                "cmc": 1,
                                "typeLine": "Artifact",
                                "oracleText": "{T}, Sacrifice this artifact: Exile target player's graveyard.\nWhen this artifact is put into a graveyard from the battlefield, you may pay {B}. If you do, draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Sol Ring",
                                "quantity": 1,
                                "manaCost": "{1}",
                                "cmc": 1,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}{C}.",
                                "isCommander": false
                        },
                        {
                                "name": "Wayfarer's Bauble",
                                "quantity": 1,
                                "manaCost": "{1}",
                                "cmc": 1,
                                "typeLine": "Artifact",
                                "oracleText": "{2}, {T}, Sacrifice this artifact: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
                                "isCommander": false
                        },
                        {
                                "name": "Kindred Discovery",
                                "quantity": 1,
                                "manaCost": "{3}{U}{U}",
                                "cmc": 5,
                                "typeLine": "Enchantment",
                                "oracleText": "As this enchantment enters, choose a creature type.\nWhenever a creature you control of the chosen type enters or attacks, draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Monastery Siege",
                                "quantity": 1,
                                "manaCost": "{2}{U}",
                                "cmc": 3,
                                "typeLine": "Enchantment",
                                "oracleText": "As this enchantment enters, choose Khans or Dragons.\n• Khans — At the beginning of your draw step, draw an additional card, then discard a card.\n• Dragons — Spells your opponents cast that target you or a permanent you control cost {2} more to cast.",
                                "isCommander": false
                        },
                        {
                                "name": "Palace Siege",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Enchantment",
                                "oracleText": "As this enchantment enters, choose Khans or Dragons.\n• Khans — At the beginning of your upkeep, return target creature card from your graveyard to your hand.\n• Dragons — At the beginning of your upkeep, each opponent loses 2 life and you gain 2 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Crucible of Fire",
                                "quantity": 1,
                                "manaCost": "{3}{R}",
                                "cmc": 4,
                                "typeLine": "Enchantment",
                                "oracleText": "Dragon creatures you control get +3/+3.",
                                "isCommander": false
                        },
                        {
                                "name": "Dragon Tempest",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Enchantment",
                                "oracleText": "Whenever a creature you control with flying enters, it gains haste until end of turn.\nWhenever a Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.",
                                "isCommander": false
                        },
                        {
                                "name": "Frontier Siege",
                                "quantity": 1,
                                "manaCost": "{3}{G}",
                                "cmc": 4,
                                "typeLine": "Enchantment",
                                "oracleText": "As this enchantment enters, choose Khans or Dragons.\n• Khans — At the beginning of each of your main phases, add {G}{G}.\n• Dragons — Whenever a creature you control with flying enters, you may have it fight target creature you don't control.",
                                "isCommander": false
                        },
                        {
                                "name": "Curse of Verbosity",
                                "quantity": 1,
                                "manaCost": "{2}{U}",
                                "cmc": 3,
                                "typeLine": "Enchantment — Aura Curse",
                                "oracleText": "Enchant player\nWhenever enchanted player is attacked, you draw a card. Each opponent attacking that player does the same.",
                                "isCommander": false
                        },
                        {
                                "name": "Curse of Opulence",
                                "quantity": 1,
                                "manaCost": "{R}",
                                "cmc": 1,
                                "typeLine": "Enchantment — Aura Curse",
                                "oracleText": "Enchant player\nWhenever enchanted player is attacked, create a Gold token. Each opponent attacking that player does the same. (A Gold token is an artifact with \"Sacrifice this token: Add one mana of any color.\")",
                                "isCommander": false
                        },
                        {
                                "name": "Curse of Bounty",
                                "quantity": 1,
                                "manaCost": "{1}{G}",
                                "cmc": 2,
                                "typeLine": "Enchantment — Aura Curse",
                                "oracleText": "Enchant player\nWhenever enchanted player is attacked, untap all nonland permanents you control. Each opponent attacking that player untaps all nonland permanents they control.",
                                "isCommander": false
                        },
                        {
                                "name": "Elemental Bond",
                                "quantity": 1,
                                "manaCost": "{2}{G}",
                                "cmc": 3,
                                "typeLine": "Enchantment",
                                "oracleText": "Whenever a creature you control with power 3 or greater enters, draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Crucible of the Spirit Dragon",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add {C}.\n{1}, {T}: Put a storage counter on this land.\n{T}, Remove X storage counters from this land: Add X mana in any combination of colors. Spend this mana only to cast Dragon spells or activate abilities of Dragons.",
                                "isCommander": false
                        },
                        {
                                "name": "Haven of the Spirit Dragon",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a Dragon creature spell.\n{2}, {T}, Sacrifice this land: Return target Dragon creature card or Ugin planeswalker card from your graveyard to your hand.",
                                "isCommander": false
                        },
                        {
                                "name": "Mountain",
                                "quantity": 2,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Mountain",
                                "oracleText": "({T}: Add {R}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Mountain",
                                "quantity": 2,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Mountain",
                                "oracleText": "({T}: Add {R}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Mountain",
                                "quantity": 2,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Mountain",
                                "oracleText": "({T}: Add {R}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Forest",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Forest",
                                "oracleText": "({T}: Add {G}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Forest",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Forest",
                                "oracleText": "({T}: Add {G}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Forest",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Forest",
                                "oracleText": "({T}: Add {G}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Plains",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Plains",
                                "oracleText": "({T}: Add {W}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Plains",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Plains",
                                "oracleText": "({T}: Add {W}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Plains",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Plains",
                                "oracleText": "({T}: Add {W}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Island",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Island",
                                "oracleText": "({T}: Add {U}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Island",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Island",
                                "oracleText": "({T}: Add {U}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Island",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Island",
                                "oracleText": "({T}: Add {U}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Path of Ancestry",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1. (Look at the top card of your library. You may put that card on the bottom.)",
                                "isCommander": false
                        },
                        {
                                "name": "Arcane Sanctum",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {W}, {U}, or {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Command Tower",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.",
                                "isCommander": false
                        },
                        {
                                "name": "Crumbling Necropolis",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {U}, {B}, or {R}.",
                                "isCommander": false
                        },
                        {
                                "name": "Frontier Bivouac",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {G}, {U}, or {R}.",
                                "isCommander": false
                        },
                        {
                                "name": "Jungle Shrine",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {R}, {G}, or {W}.",
                                "isCommander": false
                        },
                        {
                                "name": "Mystic Monastery",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {U}, {R}, or {W}.",
                                "isCommander": false
                        },
                        {
                                "name": "Nomad Outpost",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {R}, {W}, or {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Opulent Palace",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {B}, {G}, or {U}.",
                                "isCommander": false
                        },
                        {
                                "name": "Sandsteppe Citadel",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {W}, {B}, or {G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Savage Lands",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {B}, {R}, or {G}.",
                                "isCommander": false
                        },
                        {
                                "name": "Seaside Citadel",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\n{T}: Add {G}, {W}, or {U}.",
                                "isCommander": false
                        },
                        {
                                "name": "Vivid Crag",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped with two charge counters on it.\n{T}: Add {R}.\n{T}, Remove a charge counter from this land: Add one mana of any color.",
                                "isCommander": false
                        },
                        {
                                "name": "Vivid Creek",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped with two charge counters on it.\n{T}: Add {U}.\n{T}, Remove a charge counter from this land: Add one mana of any color.",
                                "isCommander": false
                        },
                        {
                                "name": "Vivid Grove",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped with two charge counters on it.\n{T}: Add {G}.\n{T}, Remove a charge counter from this land: Add one mana of any color.",
                                "isCommander": false
                        },
                        {
                                "name": "Vivid Marsh",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped with two charge counters on it.\n{T}: Add {B}.\n{T}, Remove a charge counter from this land: Add one mana of any color.",
                                "isCommander": false
                        },
                        {
                                "name": "Vivid Meadow",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped with two charge counters on it.\n{T}: Add {W}.\n{T}, Remove a charge counter from this land: Add one mana of any color.",
                                "isCommander": false
                        }
                ]
        },
        {
                "id": "preset_prosper",
                "name": "Prosper, Tome-Bound (Treasures & Exile)",
                "commander": "Prosper, Tome-Bound",
                "cards": [
                        {
                                "name": "Prosper, Tome-Bound",
                                "quantity": 1,
                                "manaCost": "{2}{B}{R}",
                                "cmc": 4,
                                "typeLine": "Legendary Creature — Tiefling Warlock",
                                "power": "1",
                                "toughness": "4",
                                "oracleText": "Deathtouch\nMystic Arcanum — At the beginning of your end step, exile the top card of your library. Until the end of your next turn, you may play that card.\nPact Boon — Whenever you play a card from exile, create a Treasure token.",
                                "isCommander": true
                        },
                        {
                                "name": "Chittering Witch",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Creature — Human Warlock",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "When this creature enters, create a number of 1/1 black Rat creature tokens equal to the number of opponents you have.\n{1}{B}, Sacrifice a creature: Target creature gets -2/-2 until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Fiend of the Shadows",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Creature — Vampire Wizard",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Flying\nWhenever this creature deals combat damage to a player, that player exiles a card from their hand. You may play that card for as long as it remains exiled.\nSacrifice a Human: Regenerate this creature.",
                                "isCommander": false
                        },
                        {
                                "name": "Gonti, Lord of Luxury",
                                "quantity": 1,
                                "manaCost": "{2}{B}{B}",
                                "cmc": 4,
                                "typeLine": "Legendary Creature — Aetherborn Rogue",
                                "power": "2",
                                "toughness": "3",
                                "oracleText": "Deathtouch\nWhen Gonti enters, look at the top four cards of target opponent's library, exile one of them face down, then put the rest on the bottom of that library in a random order. You may cast that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.",
                                "isCommander": false
                        },
                        {
                                "name": "Marionette Master",
                                "quantity": 1,
                                "manaCost": "{4}{B}{B}",
                                "cmc": 6,
                                "typeLine": "Creature — Human Artificer",
                                "power": "1",
                                "toughness": "3",
                                "oracleText": "Fabricate 3 (When this creature enters, put three +1/+1 counters on it or create three 1/1 colorless Servo artifact creature tokens.)\nWhenever an artifact you control is put into a graveyard from the battlefield, target opponent loses life equal to this creature's power.",
                                "isCommander": false
                        },
                        {
                                "name": "Ogre Slumlord",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Creature — Ogre Rogue",
                                "power": "3",
                                "toughness": "3",
                                "oracleText": "Whenever another nontoken creature dies, you may create a 1/1 black Rat creature token.\nRats you control have deathtouch.",
                                "isCommander": false
                        },
                        {
                                "name": "Piper of the Swarm",
                                "quantity": 1,
                                "manaCost": "{1}{B}",
                                "cmc": 2,
                                "typeLine": "Creature — Human Warlock",
                                "power": "1",
                                "toughness": "3",
                                "oracleText": "Rats you control have menace.\n{1}{B}, {T}: Create a 1/1 black Rat creature token.\n{2}{B}{B}, {T}, Sacrifice three Rats: Gain control of target creature.",
                                "isCommander": false
                        },
                        {
                                "name": "Pontiff of Blight",
                                "quantity": 1,
                                "manaCost": "{4}{B}{B}",
                                "cmc": 6,
                                "typeLine": "Creature — Zombie Cleric",
                                "power": "2",
                                "toughness": "7",
                                "oracleText": "Extort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.)\nOther creatures you control have extort. (If a creature has multiple instances of extort, each triggers separately.)",
                                "isCommander": false
                        },
                        {
                                "name": "Dark-Dweller Oracle",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Creature — Goblin Shaman",
                                "power": "2",
                                "toughness": "2",
                                "oracleText": "{1}, Sacrifice a creature: Exile the top card of your library. You may play that card this turn. (You still pay its costs. You can play a land this way only if you have an available land play remaining.)",
                                "isCommander": false
                        },
                        {
                                "name": "Dire Fleet Daredevil",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Creature — Human Pirate",
                                "power": "2",
                                "toughness": "1",
                                "oracleText": "First strike\nWhen this creature enters, exile target instant or sorcery card from an opponent's graveyard. You may cast it this turn, and mana of any type can be spent to cast that spell. If that spell would be put into a graveyard, exile it instead.",
                                "isCommander": false
                        },
                        {
                                "name": "Dream Pillager",
                                "quantity": 1,
                                "manaCost": "{5}{R}{R}",
                                "cmc": 7,
                                "typeLine": "Creature — Dragon",
                                "power": "4",
                                "toughness": "4",
                                "oracleText": "Flying\nWhenever this creature deals combat damage to a player, exile that many cards from the top of your library. Until end of turn, you may cast spells from among those exiled cards.",
                                "isCommander": false
                        },
                        {
                                "name": "Etali, Primal Storm",
                                "quantity": 1,
                                "manaCost": "{4}{R}{R}",
                                "cmc": 6,
                                "typeLine": "Legendary Creature — Elder Dinosaur",
                                "power": "6",
                                "toughness": "6",
                                "oracleText": "Whenever Etali attacks, exile the top card of each player's library, then you may cast any number of spells from among those cards without paying their mana costs.",
                                "isCommander": false
                        },
                        {
                                "name": "Izzet Chemister",
                                "quantity": 1,
                                "manaCost": "{2}{R}",
                                "cmc": 3,
                                "typeLine": "Creature — Goblin Wizard",
                                "power": "1",
                                "toughness": "3",
                                "oracleText": "Haste\n{R}, {T}: Exile target instant or sorcery card from your graveyard.\n{1}{R}, {T}, Sacrifice this creature: Cast any number of cards exiled with this creature without paying their mana costs.",
                                "isCommander": false
                        },
                        {
                                "name": "Tectonic Giant",
                                "quantity": 1,
                                "manaCost": "{2}{R}{R}",
                                "cmc": 4,
                                "typeLine": "Creature — Elemental Giant",
                                "power": "3",
                                "toughness": "4",
                                "oracleText": "Whenever this creature attacks or becomes the target of a spell an opponent controls, choose one —\n• This creature deals 3 damage to each opponent.\n• Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card.",
                                "isCommander": false
                        },
                        {
                                "name": "Loyal Apprentice",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Creature — Human Artificer",
                                "power": "2",
                                "toughness": "1",
                                "oracleText": "Haste\nLieutenant — At the beginning of combat on your turn, if you control your commander, create a 1/1 colorless Thopter artifact creature token with flying. That token gains haste until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Consuming Vapors",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Sorcery",
                                "oracleText": "Target player sacrifices a creature of their choice. You gain life equal to that creature's toughness.\nRebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)",
                                "isCommander": false
                        },
                        {
                                "name": "Hex",
                                "quantity": 1,
                                "manaCost": "{4}{B}{B}",
                                "cmc": 6,
                                "typeLine": "Sorcery",
                                "oracleText": "Destroy six target creatures.",
                                "isCommander": false
                        },
                        {
                                "name": "Apex of Power",
                                "quantity": 1,
                                "manaCost": "{7}{R}{R}{R}",
                                "cmc": 10,
                                "typeLine": "Sorcery",
                                "oracleText": "Exile the top seven cards of your library. Until end of turn, you may cast spells from among them.\nIf this spell was cast from your hand, add ten mana of any one color.",
                                "isCommander": false
                        },
                        {
                                "name": "Disrupt Decorum",
                                "quantity": 1,
                                "manaCost": "{2}{R}{R}",
                                "cmc": 4,
                                "typeLine": "Sorcery",
                                "oracleText": "Goad all creatures you don't control. (Until your next turn, those creatures attack each combat if able and attack a player other than you if able.)",
                                "isCommander": false
                        },
                        {
                                "name": "Ignite the Future",
                                "quantity": 1,
                                "manaCost": "{3}{R}",
                                "cmc": 4,
                                "typeLine": "Sorcery",
                                "oracleText": "Exile the top three cards of your library. Until the end of your next turn, you may play those cards. If this spell was cast from a graveyard, you may play cards this way without paying their mana costs.\nFlashback {7}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
                                "isCommander": false
                        },
                        {
                                "name": "Phthisis",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}{B}{B}",
                                "cmc": 7,
                                "typeLine": "Sorcery",
                                "oracleText": "Destroy target creature. Its controller loses life equal to its power plus its toughness.\nSuspend 5—{1}{B} (Rather than cast this card from your hand, you may pay {1}{B} and exile it with five time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)",
                                "isCommander": false
                        },
                        {
                                "name": "Light Up the Stage",
                                "quantity": 1,
                                "manaCost": "{2}{R}",
                                "cmc": 3,
                                "typeLine": "Sorcery",
                                "oracleText": "Spectacle {R} (You may cast this spell for its spectacle cost rather than its mana cost if an opponent lost life this turn.)\nExile the top two cards of your library. Until the end of your next turn, you may play those cards.",
                                "isCommander": false
                        },
                        {
                                "name": "Throes of Chaos",
                                "quantity": 1,
                                "manaCost": "{3}{R}",
                                "cmc": 4,
                                "typeLine": "Sorcery",
                                "oracleText": "Cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)\nRetrace (You may cast this card from your graveyard by discarding a land card in addition to paying its other costs.)",
                                "isCommander": false
                        },
                        {
                                "name": "Vandalblast",
                                "quantity": 1,
                                "manaCost": "{R}",
                                "cmc": 1,
                                "typeLine": "Sorcery",
                                "oracleText": "Destroy target artifact you don't control.\nOverload {4}{R} (You may cast this spell for its overload cost. If you do, change \"target\" in its text to \"each.\")",
                                "isCommander": false
                        },
                        {
                                "name": "Chaos Warp",
                                "quantity": 1,
                                "manaCost": "{2}{R}",
                                "cmc": 3,
                                "typeLine": "Instant",
                                "oracleText": "The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield.",
                                "isCommander": false
                        },
                        {
                                "name": "Commune with Lava",
                                "quantity": 1,
                                "manaCost": "{X}{R}{R}",
                                "cmc": 2,
                                "typeLine": "Instant",
                                "oracleText": "Exile the top X cards of your library. Until the end of your next turn, you may play those cards.",
                                "isCommander": false
                        },
                        {
                                "name": "Bedevil",
                                "quantity": 1,
                                "manaCost": "{B}{B}{R}",
                                "cmc": 3,
                                "typeLine": "Instant",
                                "oracleText": "Destroy target artifact, creature, or planeswalker.",
                                "isCommander": false
                        },
                        {
                                "name": "Bituminous Blast",
                                "quantity": 1,
                                "manaCost": "{3}{B}{R}",
                                "cmc": 5,
                                "typeLine": "Instant",
                                "oracleText": "Cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)\nBituminous Blast deals 4 damage to target creature.",
                                "isCommander": false
                        },
                        {
                                "name": "Rakdos Charm",
                                "quantity": 1,
                                "manaCost": "{B}{R}",
                                "cmc": 2,
                                "typeLine": "Instant",
                                "oracleText": "Choose one —\n• Exile target player's graveyard.\n• Destroy target artifact.\n• Each creature deals 1 damage to its controller.",
                                "isCommander": false
                        },
                        {
                                "name": "Terminate",
                                "quantity": 1,
                                "manaCost": "{B}{R}",
                                "cmc": 2,
                                "typeLine": "Instant",
                                "oracleText": "Destroy target creature. It can't be regenerated.",
                                "isCommander": false
                        },
                        {
                                "name": "Chaos Wand",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "{4}, {T}: Target opponent exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost. Then put the exiled cards that weren't cast this way on the bottom of that library in a random order.",
                                "isCommander": false
                        },
                        {
                                "name": "Arcane Signet",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.",
                                "isCommander": false
                        },
                        {
                                "name": "Commander's Sphere",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.\nSacrifice this artifact: Draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Fellwar Stone",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add one mana of any color that a land an opponent controls could produce.",
                                "isCommander": false
                        },
                        {
                                "name": "Mind Stone",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card.",
                                "isCommander": false
                        },
                        {
                                "name": "Orazca Relic",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "Ascend (If you control ten or more permanents, you get the city's blessing for the rest of the game.)\n{T}: Add {C}.\n{T}, Sacrifice this artifact: You gain 3 life and draw a card. Activate only if you have the city's blessing.",
                                "isCommander": false
                        },
                        {
                                "name": "Rakdos Signet",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{1}, {T}: Add {B}{R}.",
                                "isCommander": false
                        },
                        {
                                "name": "Sol Ring",
                                "quantity": 1,
                                "manaCost": "{1}",
                                "cmc": 1,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}{C}.",
                                "isCommander": false
                        },
                        {
                                "name": "Talisman of Indulgence",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}.\n{T}: Add {B} or {R}. This artifact deals 1 damage to you.",
                                "isCommander": false
                        },
                        {
                                "name": "Unstable Obelisk",
                                "quantity": 1,
                                "manaCost": "{3}",
                                "cmc": 3,
                                "typeLine": "Artifact",
                                "oracleText": "{T}: Add {C}.\n{7}, {T}, Sacrifice this artifact: Destroy target permanent.",
                                "isCommander": false
                        },
                        {
                                "name": "Dead Man's Chest",
                                "quantity": 1,
                                "manaCost": "{1}{B}",
                                "cmc": 2,
                                "typeLine": "Enchantment — Aura",
                                "oracleText": "Enchant creature an opponent controls\nWhen enchanted creature dies, exile cards equal to its power from the top of its owner's library. You may cast spells from among those cards for as long as they remain exiled, and mana of any type can be spent to cast them.",
                                "isCommander": false
                        },
                        {
                                "name": "Theater of Horrors",
                                "quantity": 1,
                                "manaCost": "{1}{B}{R}",
                                "cmc": 3,
                                "typeLine": "Enchantment",
                                "oracleText": "At the beginning of your upkeep, exile the top card of your library.\nDuring your turn, if an opponent lost life this turn, you may play lands and cast spells from among cards exiled with this enchantment.\n{3}{R}: This enchantment deals 1 damage to target opponent or planeswalker.",
                                "isCommander": false
                        },
                        {
                                "name": "Shiny Impetus",
                                "quantity": 1,
                                "manaCost": "{2}{R}",
                                "cmc": 3,
                                "typeLine": "Enchantment — Aura",
                                "oracleText": "Enchant creature\nEnchanted creature gets +2/+2 and is goaded. (It attacks each combat if able and attacks a player other than you if able.)\nWhenever enchanted creature attacks, you create a Treasure token. (It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")",
                                "isCommander": false
                        },
                        {
                                "name": "Exotic Orchard",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add one mana of any color that a land an opponent controls could produce.",
                                "isCommander": false
                        },
                        {
                                "name": "Foreboding Ruins",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "As this land enters, you may reveal a Swamp or Mountain card from your hand. If you don't, this land enters tapped.\n{T}: Add {B} or {R}.",
                                "isCommander": false
                        },
                        {
                                "name": "Shadowblood Ridge",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{1}, {T}: Add {B}{R}.",
                                "isCommander": false
                        },
                        {
                                "name": "Smoldering Marsh",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land — Swamp Mountain",
                                "oracleText": "({T}: Add {B} or {R}.)\nThis land enters tapped unless you control two or more basic lands.",
                                "isCommander": false
                        },
                        {
                                "name": "Spinerock Knoll",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)\nThis land enters tapped.\n{T}: Add {R}.\n{R}, {T}: You may play the exiled card without paying its mana cost if an opponent was dealt 7 or more damage this turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Bojuka Bog",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, exile target player's graveyard.\n{T}: Add {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Command Tower",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add one mana of any color in your commander's color identity.",
                                "isCommander": false
                        },
                        {
                                "name": "Mortuary Mire",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, you may put target creature card from your graveyard on top of your library.\n{T}: Add {B}.",
                                "isCommander": false
                        },
                        {
                                "name": "Rakdos Carnarium",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "This land enters tapped.\nWhen this land enters, return a land you control to its owner's hand.\n{T}: Add {B}{R}.",
                                "isCommander": false
                        },
                        {
                                "name": "Tainted Peak",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add {C}.\n{T}: Add {B} or {R}. Activate only if you control a Swamp.",
                                "isCommander": false
                        },
                        {
                                "name": "Zhalfirin Void",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "When this land enters, scry 1. (Look at the top card of your library. You may put that card on the bottom.)\n{T}: Add {C}.",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 4,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 4,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 3,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Swamp",
                                "quantity": 3,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Swamp",
                                "oracleText": "({T}: Add {B}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Mountain",
                                "quantity": 4,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Mountain",
                                "oracleText": "({T}: Add {R}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Mountain",
                                "quantity": 3,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Mountain",
                                "oracleText": "({T}: Add {R}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Mountain",
                                "quantity": 3,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Mountain",
                                "oracleText": "({T}: Add {R}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Mountain",
                                "quantity": 3,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Basic Land — Mountain",
                                "oracleText": "({T}: Add {R}.)",
                                "isCommander": false
                        },
                        {
                                "name": "Karazikar, the Eye Tyrant",
                                "quantity": 1,
                                "manaCost": "{3}{B}{R}",
                                "cmc": 5,
                                "typeLine": "Legendary Creature — Beholder",
                                "power": "5",
                                "toughness": "5",
                                "oracleText": "Whenever you attack a player, tap target creature that player controls and goad it. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)\nWhenever an opponent attacks another one of your opponents, you and the attacking player each draw a card and lose 1 life.",
                                "isCommander": false
                        },
                        {
                                "name": "Bag of Devouring",
                                "quantity": 1,
                                "manaCost": "{B}",
                                "cmc": 1,
                                "typeLine": "Artifact",
                                "oracleText": "Whenever you sacrifice another nontoken artifact or creature, exile it.\n{2}, {T}, Sacrifice another artifact or creature: Draw a card.\n{3}, {T}, Sacrifice this artifact: Roll a d10. Return up to X cards from among cards exiled with this artifact to their owners' hands, where X is the result.",
                                "isCommander": false
                        },
                        {
                                "name": "Danse Macabre",
                                "quantity": 1,
                                "manaCost": "{3}{B}{B}",
                                "cmc": 5,
                                "typeLine": "Sorcery",
                                "oracleText": "Each player sacrifices a nontoken creature of their choice. Roll a d20 and add the toughness of the creature you sacrificed this way.\n1—14 | Return a creature card put into a graveyard this way to the battlefield under your control.\n15+ | Return up to two creature cards put into graveyards this way to the battlefield under your control.",
                                "isCommander": false
                        },
                        {
                                "name": "Death Tyrant",
                                "quantity": 1,
                                "manaCost": "{4}{B}",
                                "cmc": 5,
                                "typeLine": "Creature — Beholder Skeleton",
                                "power": "4",
                                "toughness": "6",
                                "oracleText": "Menace\nNegative Energy Cone — Whenever an attacking creature you control or a blocking creature an opponent controls dies, create a 2/2 black Zombie creature token.\n{5}{B}: Return this card from your graveyard to the battlefield tapped.",
                                "isCommander": false
                        },
                        {
                                "name": "Grim Hireling",
                                "quantity": 1,
                                "manaCost": "{3}{B}",
                                "cmc": 4,
                                "typeLine": "Creature — Tiefling Rogue",
                                "power": "3",
                                "toughness": "2",
                                "oracleText": "Whenever one or more creatures you control deal combat damage to a player, create two Treasure tokens.\n{B}, Sacrifice X Treasures: Target creature gets -X/-X until end of turn. Activate only as a sorcery.",
                                "isCommander": false
                        },
                        {
                                "name": "Hellish Rebuke",
                                "quantity": 1,
                                "manaCost": "{2}{B}",
                                "cmc": 3,
                                "typeLine": "Instant",
                                "oracleText": "Until end of turn, permanents your opponents control gain \"When this permanent deals damage to the player who cast Hellish Rebuke, sacrifice this permanent. You lose 2 life.\"",
                                "isCommander": false
                        },
                        {
                                "name": "Lorcan, Warlock Collector",
                                "quantity": 1,
                                "manaCost": "{5}{B}{B}",
                                "cmc": 7,
                                "typeLine": "Legendary Creature — Devil",
                                "power": "6",
                                "toughness": "6",
                                "oracleText": "Flying\nWhenever a creature card is put into an opponent's graveyard from anywhere, you may pay life equal to its mana value. If you do, put it onto the battlefield under your control. It's a Warlock in addition to its other types.\nIf a Warlock you control would die, exile it instead.",
                                "isCommander": false
                        },
                        {
                                "name": "Fiendlash",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Artifact — Equipment",
                                "oracleText": "Equipped creature gets +2/+0 and has reach.\nWhenever equipped creature is dealt damage, it deals damage equal to its power to target player or planeswalker.\nEquip {2}{R}",
                                "isCommander": false
                        },
                        {
                                "name": "Reckless Endeavor",
                                "quantity": 1,
                                "manaCost": "{5}{R}{R}",
                                "cmc": 7,
                                "typeLine": "Sorcery",
                                "oracleText": "Roll two d12 and choose one result. Reckless Endeavor deals damage equal to that result to each creature. Then create a number of Treasure tokens equal to the other result.",
                                "isCommander": false
                        },
                        {
                                "name": "Share the Spoils",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Enchantment",
                                "oracleText": "When this enchantment enters and whenever an opponent loses the game, exile the top card of each player's library.\nDuring each player's turn, that player may play a land or cast a spell from among cards exiled with this enchantment, and they may spend mana as though it were mana of any color to cast that spell. When they do, exile the top card of their library.",
                                "isCommander": false
                        },
                        {
                                "name": "Wild-Magic Sorcerer",
                                "quantity": 1,
                                "manaCost": "{3}{R}",
                                "cmc": 4,
                                "typeLine": "Creature — Orc Shaman Sorcerer",
                                "power": "4",
                                "toughness": "3",
                                "oracleText": "The first spell you cast from exile each turn has cascade. (When you cast your first spell from exile, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)",
                                "isCommander": false
                        },
                        {
                                "name": "Fevered Suspicion",
                                "quantity": 1,
                                "manaCost": "{6}{B}{R}",
                                "cmc": 8,
                                "typeLine": "Sorcery",
                                "oracleText": "Each opponent exiles cards from the top of their library until they exile a nonland card. You may cast any number of spells from among those nonland cards without paying their mana costs.\nRebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)",
                                "isCommander": false
                        },
                        {
                                "name": "Hurl Through Hell",
                                "quantity": 1,
                                "manaCost": "{2}{B}{R}",
                                "cmc": 4,
                                "typeLine": "Instant",
                                "oracleText": "Exile target creature. Until the end of your next turn, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.",
                                "isCommander": false
                        },
                        {
                                "name": "Warlock Class",
                                "quantity": 1,
                                "manaCost": "{B}",
                                "cmc": 1,
                                "typeLine": "Enchantment — Class",
                                "oracleText": "(Gain the next level as a sorcery to add its ability.)\nAt the beginning of your end step, if a creature died this turn, each opponent loses 1 life.\n{1}{B}: Level 2\nWhen this Class becomes level 2, look at the top three cards of your library. Put one of them into your hand and the rest into your graveyard.\n{6}{B}: Level 3\nAt the beginning of your end step, each opponent loses life equal to the life they lost this turn. (Damage causes loss of life.)",
                                "isCommander": false
                        },
                        {
                                "name": "Chaos Channeler",
                                "quantity": 1,
                                "manaCost": "{2}{R}{R}",
                                "cmc": 4,
                                "typeLine": "Creature — Human Shaman",
                                "power": "4",
                                "toughness": "3",
                                "oracleText": "Wild Magic Surge — Whenever this creature attacks, roll a d20.\n1—9 | Exile the top card of your library. You may play it this turn.\n10—19 | Exile the top two cards of your library. You may play them this turn.\n20 | Exile the top three cards of your library. You may play them this turn.",
                                "isCommander": false
                        },
                        {
                                "name": "You Find Some Prisoners",
                                "quantity": 1,
                                "manaCost": "{1}{R}",
                                "cmc": 2,
                                "typeLine": "Instant",
                                "oracleText": "Choose one —\n• Break Their Chains — Destroy target artifact.\n• Interrogate Them — Exile the top three cards of target opponent's library. Choose one of them. Until the end of your next turn, you may play that card, and you may spend mana as though it were mana of any color to cast it.",
                                "isCommander": false
                        },
                        {
                                "name": "Bucknard's Everfull Purse",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "{1}, {T}: Roll a d4 and create a number of Treasure tokens equal to the result. The player to your right gains control of this artifact.",
                                "isCommander": false
                        },
                        {
                                "name": "Ebony Fly",
                                "quantity": 1,
                                "manaCost": "{2}",
                                "cmc": 2,
                                "typeLine": "Artifact",
                                "oracleText": "This artifact enters tapped.\n{T}: Add {C}.\n{4}: Roll a d6. Until end of turn, you may have this artifact become an X/X Insect artifact creature with flying, where X is the result.\nWhenever this artifact attacks, another target attacking creature gains flying until end of turn.",
                                "isCommander": false
                        },
                        {
                                "name": "Underdark Rift",
                                "quantity": 1,
                                "manaCost": "",
                                "cmc": 0,
                                "typeLine": "Land",
                                "oracleText": "{T}: Add {C}.\n{5}, {T}, Exile this land: Roll a d10. Put target artifact, creature, or planeswalker into its owner's library just beneath the top X cards of that library, where X is the result. Activate only as a sorcery.",
                                "isCommander": false
                        }
                ]
        }
];

    function getCardArtCropUrl(cardName) {
        if (!cardName) return 'https://cards.scryfall.io/back.png';
        return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}&format=image&version=art_crop`;
    }

    function getCardNormalUrl(cardName) {
        if (!cardName) return 'https://cards.scryfall.io/back.png';
        return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}&format=image&version=normal`;
    }

    let userActiveCustomDeck = null;

    function getAvailableDecks() {
        const list = [];
        if (userActiveCustomDeck) {
            list.push(userActiveCustomDeck);
        }
        if (window.currentDecksData && Array.isArray(window.currentDecksData)) {
            window.currentDecksData.forEach(d => {
                if (d && !d.error && d.cards && d.cards.length > 0) {
                    if (!userActiveCustomDeck || (userActiveCustomDeck.id !== `scanned_${d.id}` && userActiveCustomDeck.id !== d.id)) {
                        list.push({
                            id: `scanned_${d.id}`,
                            name: `⭐ ${d.name} (${d.commander || 'Commander'})`,
                            commander: d.commander || 'Commander',
                            cards: d.cards
                        });
                    }
                }
            });
        }
        PRESET_DECKS.forEach(pd => list.push(pd));
        return list;
    }

    function initArenaModal() {
        if (document.getElementById('arenaModalBackdrop')) return;

        const backdrop = document.createElement('div');
        backdrop.id = 'arenaModalBackdrop';
        backdrop.className = 'arena-modal-backdrop';

        backdrop.innerHTML = `
            <div class="arena-container" id="arenaContainer">
                <!-- Arena Top Bar -->
                <header class="arena-header">
                    <div class="arena-brand">
                        <div class="arena-crown-badge">👑</div>
                        <div>
                            <h2 class="arena-title">Commander Battle Arena</h2>
                            <span class="arena-subtitle">Client-Native Forge Rules Engine • Live 4-Player Tabletop</span>
                        </div>
                    </div>

                    <!-- Action Controls -->
                    <div class="arena-controls">
                        <button class="arena-btn" id="arenaBtnFullscreen" onclick="window.toggleFullscreenArena()" title="Toggle Fullscreen Arena">
                            <span id="arenaFullscreenIcon">⛶</span> Fullscreen
                        </button>
                        <button class="arena-btn arena-btn-gold" onclick="window.openArenaSetup()" title="Change Your Deck or AI Pod">
                            ⚔️ Select Deck
                        </button>
                        <button class="arena-btn" id="arenaBtnPlayPause" onclick="window.toggleArenaPlayPause()">
                            <span id="arenaPlayIcon">▶️</span> <span id="arenaPlayText">Auto-Bots</span>
                        </button>
                        <button class="arena-btn arena-btn-primary" id="arenaBtnStep" onclick="window.stepArenaPhase()">
                            ⏭️ Next Action
                        </button>
                        <button class="arena-btn" onclick="window.simulateArenaInstant()">
                            ⚡ Instant Match
                        </button>
                        <button class="arena-btn" style="color: #ef4444;" onclick="window.closeCommanderArena()">
                            ✕ Close
                        </button>
                    </div>
                </header>

                <!-- Dedicated High-Visibility Turn Progression & Phase Ribbon -->
                <div class="arena-turn-bar" id="arenaTurnBar">
                    <div class="turn-status-cluster">
                        <div class="turn-badge-pill" id="arenaTurnNumberBadge">👑 Turn 1</div>
                        <div class="turn-active-player-box" id="arenaActivePlayerBadge">
                            <span class="active-dot"></span>
                            <span id="arenaActivePlayerName">Wilhelt, the Rotcleaver (You)</span>
                        </div>
                    </div>

                    <!-- Phase Tracker -->
                    <div class="arena-phase-bar" id="arenaPhaseBar">
                        <span class="arena-phase-step" data-phase="UNTAP">Untap</span>
                        <span class="arena-phase-sep">›</span>
                        <span class="arena-phase-step" data-phase="UPKEEP">Upkeep</span>
                        <span class="arena-phase-sep">›</span>
                        <span class="arena-phase-step" data-phase="DRAW">Draw</span>
                        <span class="arena-phase-sep">›</span>
                        <span class="arena-phase-step active" data-phase="MAIN_1">Main 1</span>
                        <span class="arena-phase-sep">›</span>
                        <span class="arena-phase-step" data-phase="COMBAT">Combat</span>
                        <span class="arena-phase-sep">›</span>
                        <span class="arena-phase-step" data-phase="MAIN_2">Main 2</span>
                        <span class="arena-phase-sep">›</span>
                        <span class="arena-phase-step" data-phase="END_STEP">End</span>
                    </div>

                    <div class="phase-detail-chip" id="arenaPhaseDetailChip">
                        Pre-Combat Main Phase
                    </div>
                </div>

                <!-- Arena Main Theater -->
                <div class="arena-theater">
                    <!-- Battlefield Canvas -->
                    <div class="arena-battlefield-canvas" id="arenaCanvas">
                        <!-- Top Zone: 3 Opponent Pod Bays -->
                        <div class="arena-opponents-row" id="arenaOpponentsRow"></div>

                        <!-- Center Stage: The Stack & Combat Announcement -->
                        <div class="arena-center-stage">
                            <div class="arena-stack-box" id="arenaStackBox">
                                <img id="stackCardThumb" class="stack-card-thumb" src="" alt="Spell" />
                                <div>
                                    <div style="font-size: 0.68rem; color: #c084fc; font-weight: 800; text-transform: uppercase;">Resolving Spell on Stack</div>
                                    <div class="stack-spell-name" id="stackSpellName">Casting Spell...</div>
                                </div>
                            </div>
                        </div>

                        <!-- Bottom Zone: Player Cockpit, Battlefield & Hand Tray -->
                        <div id="arenaPlayerBottomBay"></div>
                    </div>

                    <!-- Tactical Combat Log Stream -->
                    <aside class="arena-sidebar">
                        <div class="arena-sidebar-header">
                            <div class="arena-sidebar-title">
                                <span>📜</span> Match Tactical Log
                            </div>
                            <button class="arena-btn" style="padding: 0.2rem 0.5rem; font-size: 0.72rem;" onclick="window.clearArenaLog()">
                                Clear
                            </button>
                        </div>
                        <div class="arena-log-stream" id="arenaLogStream"></div>
                    </aside>
                </div>

                <!-- Floating High-Res Card Inspector -->
                <div class="card-hover-inspector" id="cardHoverInspector">
                    <img id="cardInspectorImg" src="" alt="Card Inspector" />
                </div>

                <!-- Pod Setup Modal Overlay -->
                <div class="arena-setup-overlay" id="arenaSetupOverlay">
                    <div class="arena-setup-card">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <h3 style="margin: 0; font-size: 1.25rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.5rem;">
                                <span>⚔️</span> Select Your Deck & Pod Setup
                            </h3>
                            <button class="arena-btn" onclick="window.closeArenaSetup()">✕</button>
                        </div>
                        <p style="font-size: 0.86rem; color: var(--arena-text-muted); margin: 0; line-height: 1.45;">
                            Choose the deck you want to pilot in <strong>Seat 1</strong> before drawing your opening hand. You can also customize your AI opponents or leave them on presets.
                        </p>

                        <div class="setup-seats-grid">
                            <div class="setup-seat-box seat-1-featured">
                                <span class="setup-seat-label" style="color: #f59e0b; font-weight: 900; font-size: 0.84rem;">👑 Your Deck (Seat 1 - Player)</span>
                                <div style="display: flex; gap: 0.85rem; align-items: center; margin-top: 0.35rem;">
                                    <img id="seat0CmdrThumb" class="setup-seat-thumb" src="https://cards.scryfall.io/back.png" alt="Commander Art" />
                                    <div style="flex: 1; min-width: 0;">
                                        <select class="setup-seat-select" id="seatSelect0" onchange="window.updateSeat0Preview()"></select>
                                        <div id="seat0CmdrDetails" style="font-size: 0.78rem; color: #cbd5e1; margin-top: 0.3rem; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Loading Commander...</div>
                                    </div>
                                </div>
                            </div>
                            <div class="setup-seat-box">
                                <span class="setup-seat-label">Seat 2 (Bot Opponent 1)</span>
                                <select class="setup-seat-select" id="seatSelect1"></select>
                            </div>
                            <div class="setup-seat-box">
                                <span class="setup-seat-label">Seat 3 (Bot Opponent 2)</span>
                                <select class="setup-seat-select" id="seatSelect2"></select>
                            </div>
                            <div class="setup-seat-box">
                                <span class="setup-seat-label">Seat 4 (Bot Opponent 3)</span>
                                <select class="setup-seat-select" id="seatSelect3"></select>
                            </div>
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.5rem; align-items: center;">
                            <button class="arena-btn" onclick="window.closeArenaSetup()">Close</button>
                            <button class="arena-btn arena-btn-gold" id="btnLaunchPodMatch" onclick="window.applyArenaSetupAndStart()" style="font-weight: 900; font-size: 0.95rem; padding: 0.6rem 1.4rem;">
                                ⚔️ Select Deck & Draw Hand 🎴
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Opening Hand & Mulligan Modal Overlay -->
                <div class="arena-mulligan-overlay" id="arenaMulliganOverlay"></div>
            </div>
        `;

        document.body.appendChild(backdrop);
    }

    // ============================================================================
    // HOVER CARD INSPECTOR
    // ============================================================================
    window.showCardInspector = function (cardName) {
        if (!cardName) return;
        const inspector = document.getElementById('cardHoverInspector');
        const img = document.getElementById('cardInspectorImg');
        if (inspector && img) {
            img.src = getCardNormalUrl(cardName);
            inspector.style.display = 'block';
        }
    };

    window.hideCardInspector = function () {
        const inspector = document.getElementById('cardHoverInspector');
        if (inspector) {
            inspector.style.display = 'none';
        }
    };

    // ============================================================================
    // RENDERING OPPONENTS (SEATS 2, 3, 4)
    // ============================================================================
    function renderOpponentsRow() {
        if (!currentGame) return '';
        const opponents = currentGame.players.slice(1); // Opponents 1, 2, 3
        const activePlayer = currentGame.getActivePlayer();

        return opponents.map((opp, idx) => {
            const isTurn = activePlayer && activePlayer.id === opp.id && opp.isAlive;
            const cmdr = opp.getCommander();
            const cmdrName = cmdr ? cmdr.name : 'Unknown Commander';
            const cmdrArt = getCardArtCropUrl(cmdrName);

            const creatures = opp.battlefield.filter(c => c.isCreature);
            const lands = opp.battlefield.filter(c => c.isLand);
            const supports = opp.battlefield.filter(c => !c.isCreature && !c.isLand);

            let creaturesHtml = '';
            if (creatures.length === 0) {
                creaturesHtml = `<div style="font-size: 0.7rem; color: var(--arena-text-muted); margin: auto;">Empty Battlefield</div>`;
            } else {
                creatures.forEach(c => {
                    const tappedClass = c.tapped ? 'tapped' : '';
                    const effP = opp.getEffectivePower ? opp.getEffectivePower(c) : c.power;
                    const effT = opp.getEffectiveToughness ? opp.getEffectiveToughness(c) : c.toughness;
                    creaturesHtml += `
                        <div class="mtg-card-frame ${tappedClass}"
                             onmouseenter="window.showCardInspector('${escapeHtml(c.name)}')"
                             onmouseleave="window.hideCardInspector()"
                             title="${escapeHtml(c.name)} - ${c.typeLine}">
                            <div class="mtg-card-header">
                                <span class="mtg-card-name">${escapeHtml(c.name)}</span>
                            </div>
                            <img class="mtg-card-art" src="${getCardArtCropUrl(c.name)}" loading="lazy" alt="${escapeHtml(c.name)}" onerror="this.onerror=null; this.src='https://cards.scryfall.io/back.png';" />
                            <span class="mtg-card-pt-bubble">${effP}/${effT}</span>
                            ${c.summoningSick ? '<span class="mtg-card-summoning-sick" title="Summoning Sick">🌀</span>' : ''}
                        </div>
                    `;
                });
            }

            let landsHtml = '';
            if (lands.length === 0) {
                landsHtml = `<span style="font-size: 0.65rem; color: var(--arena-text-muted);">No lands played</span>`;
            } else {
                landsHtml = lands.map(c => `
                    <div class="opp-land-chip ${c.tapped ? 'tapped' : ''}"
                         onmouseenter="window.showCardInspector('${escapeHtml(c.name)}')"
                         onmouseleave="window.hideCardInspector()"
                         title="${escapeHtml(c.name)} (${c.tapped ? 'Tapped' : 'Untapped'})">
                        <span>🏞️</span>
                        <span>${escapeHtml(c.name)}</span>
                    </div>
                `).join('');
            }

            let supportsHtml = '';
            if (supports.length > 0) {
                supportsHtml = supports.map(c => {
                    let icon = '💎';
                    if (c.isEnchantment) icon = '✨';
                    else if (c.isPlaneswalker) icon = '🛡️';
                    else if (c.isArtifact) icon = '⚙️';
                    return `
                        <div class="opp-support-chip ${c.tapped ? 'tapped' : ''}"
                             onmouseenter="window.showCardInspector('${escapeHtml(c.name)}')"
                             onmouseleave="window.hideCardInspector()"
                             title="${escapeHtml(c.name)} - ${escapeHtml(c.typeLine || 'Support')} (${c.tapped ? 'Tapped' : 'Untapped'})">
                            <span>${icon}</span>
                            <span>${escapeHtml(c.name)}</span>
                        </div>
                    `;
                }).join('');
            } else {
                supportsHtml = `<span style="font-size: 0.65rem; color: var(--arena-text-muted); padding: 0.15rem 0.3rem;">No artifacts/enchantments</span>`;
            }

            return `
                <div class="opponent-bay ${isTurn ? 'active-turn' : ''} ${!opp.isAlive ? 'eliminated' : ''}" id="oppBay_${opp.id}">
                    <div class="opponent-bay-header">
                        <div class="opponent-bay-profile">
                            <img src="${opp.avatar}" class="opponent-bay-avatar" alt="${escapeHtml(opp.name)}" />
                            <div>
                                <div class="opponent-bay-name">${escapeHtml(opp.name)}</div>
                                <div style="font-size: 0.65rem; color: var(--arena-text-muted);">Seat ${idx + 2} • Bot</div>
                            </div>
                        </div>
                        <div class="opponent-life-chip ${opp.life <= 10 ? 'danger' : ''}">
                            <span>❤️</span> <span>${opp.life}</span>
                        </div>
                    </div>

                    <!-- Opponent Commander & Hand status -->
                    <div class="opponent-meta-bar">
                        <div class="opponent-cmdr-chip"
                             onmouseenter="window.showCardInspector('${escapeHtml(cmdrName)}')"
                             onmouseleave="window.hideCardInspector()">
                            <img src="${cmdrArt}" class="opponent-cmdr-thumb" alt="Commander" />
                            <span>${escapeHtml(cmdrName)}</span>
                        </div>
                        <div>
                            <span>Tax: {${opp.commanderTax}}</span>
                            <span style="margin-left: 0.4rem;">🃏 ${opp.hand.length}</span>
                        </div>
                    </div>

                    <!-- Opponent Battlefield Shelves -->
                    <div class="opponent-battlefield">
                        <!-- Creatures Line -->
                        <div class="opponent-creatures-shelf">
                            ${creaturesHtml}
                        </div>
                        <!-- Lands Shelf -->
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.66rem; color: var(--arena-text-muted); font-weight: 700; padding: 0.1rem 0.2rem;">
                            <span>🏞️ Lands (${lands.length})</span>
                            <span>💎 Support (${supports.length}) • 📚 ${opp.library.length}</span>
                        </div>
                        <div class="opponent-lands-shelf">
                            ${landsHtml}
                        </div>
                        <!-- Support Permanents Line (Artifacts, Rocks, Enchantments) -->
                        <div class="opponent-support-shelf">
                            ${supportsHtml}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ============================================================================
    // RENDERING YOU (PLAYER 1 / SEAT 1 COCKPIT)
    // ============================================================================
    function renderPlayerCockpit() {
        if (!currentGame) return '';
        const player = currentGame.players[0]; // Player 1
        const activePlayer = currentGame.getActivePlayer();
        const isMyTurn = activePlayer && activePlayer.id === player.id && player.isAlive;
        const currentPhase = currentGame.currentPhase;

        const cmdr = player.getCommander();
        const cmdrName = cmdr ? cmdr.name : 'Unknown Commander';
        const cmdrArt = getCardArtCropUrl(cmdrName);
        const cmdrCastCost = cmdr ? (cmdr.cmc || 0) + player.commanderTax : 0;
        const availableMana = player.getAvailableMana().total;
        const isCmdrInZone = player.isCommanderInCommandZone();
        const isCmdrOnField = player.isCommanderOnBattlefield();
        const canCastCmdr = isMyTurn && currentPhase.includes('MAIN') && isCmdrInZone && (availableMana >= cmdrCastCost);

        // 1. Creatures on your battlefield
        const creatures = player.battlefield.filter(c => c.isCreature);
        let creaturesHtml = '';
        if (creatures.length === 0) {
            creaturesHtml = `<div style="font-size: 0.78rem; color: var(--arena-text-muted); margin: auto;">No creatures summoned yet. Cast creatures from hand or command zone!</div>`;
        } else {
            creatures.forEach(c => {
                const tappedClass = c.tapped ? 'tapped' : '';
                const isSelectedAtk = selectedAttackerIds.has(c.id);
                const atkSelectedClass = isSelectedAtk ? 'attacker-selected' : '';
                const canAttackThisTurn = isMyTurn && currentPhase === 'DECLARE_ATTACKERS' && !c.tapped && !c.summoningSick;
                const effP = player.getEffectivePower ? player.getEffectivePower(c) : c.power;
                const effT = player.getEffectiveToughness ? player.getEffectiveToughness(c) : c.toughness;

                creaturesHtml += `
                    <div class="mtg-card-frame ${tappedClass} ${atkSelectedClass}"
                         onclick="window.toggleAttackerSelection('${c.id}')"
                         onmouseenter="window.showCardInspector('${escapeHtml(c.name)}')"
                         onmouseleave="window.hideCardInspector()"
                         title="${escapeHtml(c.name)} - ${c.typeLine}">
                        <div class="mtg-card-header">
                            <span class="mtg-card-name">${c.isCommander ? '👑 ' : ''}${escapeHtml(c.name)}</span>
                            <span class="mtg-card-cost">${c.manaCost || ''}</span>
                        </div>
                        <img class="mtg-card-art" src="${getCardArtCropUrl(c.name)}" loading="lazy" alt="${escapeHtml(c.name)}" onerror="this.onerror=null; this.src='https://cards.scryfall.io/back.png';" />
                        <span class="mtg-card-pt-bubble">${effP}/${effT}</span>
                        ${c.summoningSick ? '<span class="mtg-card-summoning-sick" title="Summoning Sickness">🌀</span>' : ''}
                        ${canAttackThisTurn ? '<span style="position: absolute; top: 16px; left: 3px; font-size: 0.65rem; background: #ef4444; border-radius: 4px; padding: 1px 3px; font-weight: 900;">⚔️</span>' : ''}
                    </div>
                `;
            });
        }

        // 2. Lands and Supports on your battlefield
        const landsAndSupports = player.battlefield.filter(c => !c.isCreature);
        let landsHtml = '';
        if (landsAndSupports.length === 0) {
            landsHtml = `<div style="font-size: 0.74rem; color: var(--arena-text-muted);">Play lands from your hand below</div>`;
        } else {
            landsAndSupports.forEach(c => {
                const tappedClass = c.tapped ? 'tapped' : '';
                const icon = c.isLand ? '🏞️' : (c.isPlaneswalker ? '🔮' : (c.isEnchantment ? '✨' : '💎'));
                landsHtml += `
                    <div class="mtg-land-chip ${tappedClass}"
                         onclick="window.toggleLandTap('${c.id}')"
                         onmouseenter="window.showCardInspector('${escapeHtml(c.name)}')"
                         onmouseleave="window.hideCardInspector()"
                         title="${c.isLand || c.isManaRock ? 'Click to tap/untap for mana' : escapeHtml(c.name)}">
                        <span>${icon}</span>
                        <span>${escapeHtml(c.name)}</span>
                    </div>
                `;
            });
        }

        // 3. Your Hand Cards (Fanned out bottom tray)
        let handHtml = '';
        if (player.hand.length === 0) {
            handHtml = `<div style="font-size: 0.8rem; color: var(--arena-text-muted); margin: auto;">Your hand is currently empty</div>`;
        } else {
            player.hand.forEach(c => {
                const isInstantOrFlash = c.isInstant || (c.keywords && c.keywords.has('flash'));
                const cost = player.getCardCost(c, currentGame);
                let isPlayable = false;
                let tagText = '';

                if (c.isLand) {
                    isPlayable = isMyTurn && currentPhase.includes('MAIN') && !player.landPlayedThisTurn;
                    tagText = isPlayable ? 'Play Land' : (player.landPlayedThisTurn ? 'Land Played' : 'Land');
                } else if (isInstantOrFlash) {
                    isPlayable = availableMana >= cost;
                    tagText = isPlayable ? (isMyTurn ? `Cast {${cost}}` : `⚡ Flash {${cost}}`) : `Need {${cost}} Mana`;
                } else {
                    isPlayable = isMyTurn && currentPhase.includes('MAIN') && availableMana >= cost;
                    tagText = isPlayable ? `Cast {${cost}}` : `Need {${cost}} Mana`;
                }

                const cardClasses = ['hand-card'];
                if (isPlayable) {
                    if (isInstantOrFlash && !isMyTurn) cardClasses.push('instant-playable');
                    else cardClasses.push('playable');
                } else {
                    cardClasses.push('need-mana');
                }

                handHtml += `
                    <div class="hand-card-wrapper" onclick="window.playCardFromHand('${c.id}')">
                        <div class="${cardClasses.join(' ')}"
                             onmouseenter="window.showCardInspector('${escapeHtml(c.name)}')"
                             onmouseleave="window.hideCardInspector()">
                            <img class="hand-card-art" src="${getCardNormalUrl(c.name)}" loading="lazy" alt="${escapeHtml(c.name)}" onerror="this.onerror=null; this.src='https://cards.scryfall.io/back.png';" />
                            <div class="${isPlayable ? 'hand-card-play-tag' : 'hand-card-cost-tag'}">${tagText}</div>
                        </div>
                    </div>
                `;
            });
        }

        // 4. Action Trigger Button Label based on current Phase
        let actionBtnText = 'Next Step ⏭️';
        let actionBtnClass = 'action-trigger-btn';
        if (isMyTurn) {
            if (currentPhase === 'MAIN_1') {
                actionBtnText = 'Go to Combat ⚔️';
                actionBtnClass = 'action-trigger-btn arena-btn-gold';
            } else if (currentPhase === 'DECLARE_ATTACKERS') {
                actionBtnText = selectedAttackerIds.size > 0 ? `Attack (${selectedAttackerIds.size} Selected) 💥` : 'Pass Combat (No Attacks)';
                actionBtnClass = 'action-trigger-btn';
            } else if (currentPhase === 'MAIN_2') {
                actionBtnText = 'End Turn ⏳';
                actionBtnClass = 'action-trigger-btn arena-btn-gold';
            }
        } else {
            actionBtnText = 'Advance Bot Action 🤖';
        }

        return `
            <div class="arena-player-cockpit ${isMyTurn ? 'active-turn' : ''}" id="playerCockpit">
                <div class="player-board-grid">
                    <!-- Left: Command Zone Pedestal -->
                    <div class="player-cmdr-pedestal">
                        <div style="font-size: 0.75rem; font-weight: 800; color: #f59e0b;">👑 COMMAND ZONE</div>
                        <img src="${cmdrArt}"
                             class="player-cmdr-card-img"
                             alt="Commander"
                             onmouseenter="window.showCardInspector('${escapeHtml(cmdrName)}')"
                             onmouseleave="window.hideCardInspector()" />
                        <div style="font-size: 0.75rem; font-weight: 700; color: #e2e8f0;">${escapeHtml(cmdrName)}</div>
                        ${isCmdrOnField ? '<span class="cmdr-status-badge on-field">👑 On Battlefield</span>' : '<span class="cmdr-status-badge in-zone">👑 In Command Zone</span>'}
                        <div style="font-size: 0.7rem; color: #c084fc; font-weight: 800;">Tax: {${player.commanderTax}} • Cost: {${cmdrCastCost}}</div>
                        ${isCmdrOnField ? `
                            <button class="cmdr-cast-cta" disabled style="opacity: 0.7; cursor: default;">👑 On Field</button>
                        ` : canCastCmdr ? `
                            <button class="cmdr-cast-cta ready" onclick="window.castPlayerCommander()">🚀 Cast Commander {${cmdrCastCost}}</button>
                        ` : (isCmdrInZone && availableMana < cmdrCastCost) ? `
                            <button class="cmdr-cast-cta need-mana" onclick="window.castPlayerCommander()">Need {${cmdrCastCost}} Mana (Have {${availableMana}})</button>
                        ` : `
                            <button class="cmdr-cast-cta" onclick="window.castPlayerCommander()" ${!isMyTurn ? 'disabled' : ''}>Cast Commander {${cmdrCastCost}}</button>
                        `}
                    </div>

                    <!-- Right: Your Battlefield Shelves -->
                    <div class="player-field-rows">
                        <!-- Creatures Shelf -->
                        <div class="field-shelf-title">
                            <span>⚔️ Creatures Line</span>
                            <span style="font-weight: 400; font-size: 0.68rem; color: #94a3b8;">(${creatures.length} creatures)</span>
                        </div>
                        <div class="player-creatures-shelf">
                            ${creaturesHtml}
                        </div>

                        <!-- Lands & Artifacts Shelf -->
                        <div class="field-shelf-title">
                            <span>🏞️ Mana & Support Line</span>
                            <span style="font-weight: 400; font-size: 0.68rem; color: #94a3b8;">(Click to tap/untap)</span>
                        </div>
                        <div class="player-lands-shelf">
                            ${landsHtml}
                        </div>
                    </div>
                </div>

                <!-- Hand Tray fanned out at bottom -->
                <div class="arena-hand-tray-container">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 0.5rem;">
                        <span style="font-size: 0.74rem; font-weight: 800; color: var(--arena-text-muted); text-transform: uppercase;">
                            🃏 Your Hand (${player.hand.length} cards)
                        </span>
                        <span style="font-size: 0.72rem; color: #a855f7;">Click any highlighted card to cast or play (Instants playable anytime)</span>
                    </div>
                    <div class="arena-hand-tray">
                        ${handHtml}
                    </div>
                </div>

                <!-- Tactical Action HUD -->
                <div class="arena-player-hud">
                    <!-- Life Dial with Manual Adjusters -->
                    <div class="player-life-dial">
                        <button class="player-life-dial-btn" onclick="window.adjustPlayerLife(-1)">−</button>
                        <span style="font-size: 0.85rem; color: #ef4444;">❤️</span>
                        <span class="player-life-dial-val">${player.life}</span>
                        <button class="player-life-dial-btn" onclick="window.adjustPlayerLife(1)">+</button>
                    </div>

                    <!-- Available Mana Display -->
                    <div class="player-mana-pool-bar">
                        <span>💎 Mana:</span>
                        <span style="color: #38bdf8; font-weight: 800;">${player.getAvailableMana().total}</span>
                        <button class="arena-btn" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; margin-left: 0.4rem;" onclick="window.untapAllMyLands()">
                            ⚡ Untap All
                        </button>
                    </div>

                    <!-- Tactical Turn & Phase Pill in Cockpit -->
                    <div class="hud-phase-chip" style="display: flex; align-items: center; gap: 0.45rem; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.14); padding: 0.35rem 0.75rem; border-radius: 8px; font-size: 0.78rem; font-weight: 800; white-space: nowrap;">
                        <span style="color: #f59e0b;">Turn ${currentGame.turn}</span>
                        <span style="color: rgba(255,255,255,0.25);">•</span>
                        <span style="color: #38bdf8;">${currentPhase.replace(/_/g, ' ')}</span>
                    </div>

                    <!-- Primary Phase Action Button -->
                    <button class="${actionBtnClass}" onclick="window.handleMainActionClick()">
                        ${actionBtnText}
                    </button>
                </div>
            </div>
        `;
    }

    function updateArenaDOM() {
        if (!currentGame) return;

        // Render Opponents
        const oppRow = document.getElementById('arenaOpponentsRow');
        if (oppRow) {
            oppRow.innerHTML = renderOpponentsRow();
        }

        // Render Player 1 Cockpit
        const bottomBay = document.getElementById('arenaPlayerBottomBay');
        if (bottomBay) {
            bottomBay.innerHTML = renderPlayerCockpit();
        }

        // Update Turn Number Badge
        const turnBadge = document.getElementById('arenaTurnNumberBadge');
        if (turnBadge) {
            turnBadge.textContent = `👑 Turn ${currentGame.turn}`;
        }

        // Update Active Player
        const activeP = currentGame.getActivePlayer();
        const activePlayerBox = document.getElementById('arenaActivePlayerName');
        if (activePlayerBox && activeP) {
            activePlayerBox.textContent = activeP.isAI ? `🤖 ${activeP.name}` : `👤 ${activeP.name}`;
        }

        // Backward compatibility for arenaTurnIndicator
        const turnInd = document.getElementById('arenaTurnIndicator');
        if (turnInd) {
            turnInd.innerHTML = `<strong>Turn ${currentGame.turn}</strong> • <span style="color: #a855f7;">${activeP ? activeP.name : ''}</span>`;
        }

        // Friendly phase display names
        const PHASE_DISPLAY_NAMES = {
            'UNTAP': 'Untap Step',
            'UPKEEP': 'Upkeep Step',
            'DRAW': 'Draw Step',
            'MAIN_1': 'Pre-Combat Main Phase',
            'COMBAT_BEGIN': 'Beginning of Combat',
            'DECLARE_ATTACKERS': 'Declare Attackers Step',
            'DECLARE_BLOCKERS': 'Declare Blockers Step',
            'COMBAT_DAMAGE': 'Combat Damage Step',
            'COMBAT_END': 'End of Combat',
            'MAIN_2': 'Post-Combat Main Phase',
            'END_STEP': 'End Step',
            'CLEANUP': 'Cleanup Step'
        };

        const currentPhase = currentGame.currentPhase || 'MAIN_1';
        const phaseDetailChip = document.getElementById('arenaPhaseDetailChip');
        if (phaseDetailChip) {
            phaseDetailChip.textContent = `⚡ ${PHASE_DISPLAY_NAMES[currentPhase] || currentPhase}`;
        }

        // Map current engine phase into one of the ribbon categories:
        // UNTAP, UPKEEP, DRAW, MAIN_1, COMBAT, MAIN_2, END_STEP
        let activeRibbonCategory = 'MAIN_1';
        if (currentPhase === 'UNTAP') activeRibbonCategory = 'UNTAP';
        else if (currentPhase === 'UPKEEP') activeRibbonCategory = 'UPKEEP';
        else if (currentPhase === 'DRAW') activeRibbonCategory = 'DRAW';
        else if (currentPhase === 'MAIN_1') activeRibbonCategory = 'MAIN_1';
        else if (currentPhase.includes('COMBAT') || currentPhase.includes('ATTACK') || currentPhase.includes('BLOCK')) activeRibbonCategory = 'COMBAT';
        else if (currentPhase === 'MAIN_2') activeRibbonCategory = 'MAIN_2';
        else if (currentPhase === 'END_STEP' || currentPhase === 'CLEANUP') activeRibbonCategory = 'END_STEP';

        const phaseSequence = ['UNTAP', 'UPKEEP', 'DRAW', 'MAIN_1', 'COMBAT', 'MAIN_2', 'END_STEP'];
        const currentCatIdx = phaseSequence.indexOf(activeRibbonCategory);

        // Update Phase Step ribbons
        const phaseSteps = document.querySelectorAll('.arena-phase-step');
        phaseSteps.forEach(step => {
            const phaseAttr = step.getAttribute('data-phase');
            step.classList.remove('active', 'past');
            const stepIdx = phaseSequence.indexOf(phaseAttr);

            if (phaseAttr === activeRibbonCategory) {
                step.classList.add('active');
            } else if (stepIdx !== -1 && stepIdx < currentCatIdx) {
                step.classList.add('past');
            }
        });
    }

    function appendArenaLogs(newLogs = []) {
        const streamEl = document.getElementById('arenaLogStream');
        if (!streamEl || !newLogs || newLogs.length === 0) return;

        newLogs.forEach(entry => {
            const div = document.createElement('div');
            div.className = `log-entry ${entry.type || ''}`;
            div.innerHTML = formatMarkdown(entry.message || '');
            streamEl.appendChild(div);
        });

        streamEl.scrollTop = streamEl.scrollHeight;
    }

    function formatMarkdown(str) {
        return str
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================================
    // USER ACTIONS & INTERACTIVE CONTROLS
    // ============================================================================

    window.playCardFromHand = function (cardId) {
        if (!currentGame) return;
        const player = currentGame.players[0];
        const activePlayer = currentGame.getActivePlayer();

        const card = player.hand.find(c => c.id === cardId);
        if (!card) return;

        const isInstantOrFlash = card.isInstant || (card.keywords && card.keywords.has('flash'));

        // Rule checks
        if (card.isLand) {
            if (activePlayer.id !== player.id) {
                alert("You can only play lands during your own turn!");
                return;
            }
            if (currentGame.currentPhase !== 'MAIN_1' && currentGame.currentPhase !== 'MAIN_2') {
                alert("Lands can only be played during your Main phase (MTG Rule 305.1).");
                return;
            }
            if (player.landPlayedThisTurn) {
                alert("You have already played a land this turn (MTG Rule 305.2).");
                return;
            }
        } else if (!isInstantOrFlash) {
            if (activePlayer.id !== player.id) {
                alert(`You can only cast Instants or cards with Flash on an opponent's turn! (${card.name} is a ${card.typeLine}).`);
                return;
            }
            if (currentGame.currentPhase !== 'MAIN_1' && currentGame.currentPhase !== 'MAIN_2') {
                alert("Sorceries and permanent spells can only be cast during your Main phase (MTG Rule 307.1).");
                return;
            }
        }

        if (!card.isLand) {
            const cost = player.getCardCost(card, currentGame);
            const available = player.getAvailableMana().total;
            if (available < cost) {
                alert(`Cannot cast **${card.name}**: Need ${cost} mana (${card.manaCost || `{${cost}}`}), but you currently have only ${available} untapped mana available!\n\n💡 Tap your lands or mana rocks in the "Mana & Support Line" to produce mana first.`);
                return;
            }
        }

        // Auto-pause bot runner if playing an instant during bot turn so user can observe the resolution
        if (activePlayer.id !== player.id && !isPaused) {
            window.toggleArenaPlayPause();
        }

        // Visual stack popup animation
        const stackBox = document.getElementById('arenaStackBox');
        const stackThumb = document.getElementById('stackCardThumb');
        const stackName = document.getElementById('stackSpellName');
        if (stackBox && stackThumb && stackName) {
            stackThumb.src = getCardArtCropUrl(card.name);
            stackName.textContent = isInstantOrFlash && activePlayer.id !== player.id ? `⚡ Instant: ${card.name}` : card.name;
            stackBox.style.display = 'flex';
            setTimeout(() => {
                if (stackBox) stackBox.style.display = 'none';
            }, 650);
        }

        const res = player.castCard(cardId, currentGame);
        if (!res.success) {
            alert(res.message);
            return;
        }

        appendArenaLogs(res.logs);
        updateArenaDOM();
    };

    window.castPlayerCommander = function () {
        if (!currentGame) return;
        const player = currentGame.players[0];
        const activePlayer = currentGame.getActivePlayer();
        const cmdr = player.getCommander();

        if (!cmdr) {
            alert("No Commander assigned to your deck!");
            return;
        }

        if (player.isCommanderOnBattlefield()) {
            alert(`**${cmdr.name}** is already on the battlefield!`);
            return;
        }

        if (activePlayer.id !== player.id) {
            alert("You can only cast your Commander during your turn!");
            return;
        }

        if (currentGame.currentPhase !== 'MAIN_1' && currentGame.currentPhase !== 'MAIN_2') {
            alert("Commanders can only be cast during a Main phase (MTG Rule 305.1 / 903.8).");
            return;
        }

        const totalCost = (cmdr.cmc || 0) + player.commanderTax;
        const available = player.getAvailableMana().total;
        if (available < totalCost) {
            alert(`Need ${totalCost} mana to cast ${cmdr.name} (Base: {${cmdr.cmc || 0}}, Tax: {${player.commanderTax}}), but only have ${available} untapped mana available!`);
            return;
        }

        // Visual stack popup animation
        const stackBox = document.getElementById('arenaStackBox');
        const stackThumb = document.getElementById('stackCardThumb');
        const stackName = document.getElementById('stackSpellName');
        if (stackBox && stackThumb && stackName) {
            stackThumb.src = getCardArtCropUrl(cmdr.name);
            stackName.textContent = `👑 Casting Commander: ${cmdr.name}`;
            stackBox.style.display = 'flex';
            setTimeout(() => {
                if (stackBox) stackBox.style.display = 'none';
            }, 750);
        }

        const res = player.castCommander(currentGame);
        if (!res.success) {
            alert(res.message);
            return;
        }

        appendArenaLogs(res.logs);
        updateArenaDOM();
    };

    window.toggleLandTap = function (cardId) {
        if (!currentGame) return;
        const player = currentGame.players[0];
        player.toggleTapPermanent(cardId);
        updateArenaDOM();
    };

    window.untapAllMyLands = function () {
        if (!currentGame) return;
        const player = currentGame.players[0];
        player.battlefield.forEach(c => {
            if (c.isLand || c.isManaRock) c.tapped = false;
        });
        updateArenaDOM();
    };

    window.adjustPlayerLife = function (delta) {
        if (!currentGame) return;
        const player = currentGame.players[0];
        player.life += delta;
        updateArenaDOM();
    };

    window.toggleAttackerSelection = function (cardId) {
        if (!currentGame) return;
        const activePlayer = currentGame.getActivePlayer();
        const player = currentGame.players[0];

        if (activePlayer.id !== player.id || currentGame.currentPhase !== 'DECLARE_ATTACKERS') {
            return;
        }

        if (selectedAttackerIds.has(cardId)) {
            selectedAttackerIds.delete(cardId);
        } else {
            selectedAttackerIds.add(cardId);
        }
        updateArenaDOM();
    };

    window.handleMainActionClick = function () {
        if (!currentGame) return;
        const activePlayer = currentGame.getActivePlayer();
        const player = currentGame.players[0];

        if (activePlayer.id === player.id) {
            if (currentGame.currentPhase === 'DECLARE_ATTACKERS') {
                // Confirm attacks
                const opps = currentGame.players.slice(1).filter(p => p.isAlive);
                const targetOpp = opps[0]; // Primary target
                const attacks = Array.from(selectedAttackerIds).map(id => ({
                    attackerId: id,
                    targetPlayerId: targetOpp ? targetOpp.id : null
                }));

                const res = currentGame.declareHumanAttacks(attacks);
                selectedAttackerIds.clear();
                appendArenaLogs(res.logs);
                currentGame.stepPhase(); // Move to damage
                updateArenaDOM();
                return;
            }
        }

        window.stepArenaPhase();
    };

    // ============================================================================
    // OPENING HAND & MULLIGAN CONTROLLER (MTG Rule 103.4c)
    // ============================================================================
    window.openMulliganModal = function () {
        if (!currentGame) return;
        selectedBottomCardIds.clear();
        const overlay = document.getElementById('arenaMulliganOverlay');
        if (!overlay) return;
        window.renderMulliganModal();
        overlay.style.display = 'flex';
    };

    window.closeMulliganModal = function () {
        selectedBottomCardIds.clear();
        const overlay = document.getElementById('arenaMulliganOverlay');
        if (overlay) overlay.style.display = 'none';
        if (currentGame && currentGame.currentPhase === 'UNTAP') {
            currentGame.currentPhase = 'MAIN_1';
            const p1 = currentGame.players[0];
            p1.untapAll();
            p1.landPlayedThisTurn = false;
            updateArenaDOM();
        }
    };

    window.renderMulliganModal = function () {
        if (!currentGame) return;
        const overlay = document.getElementById('arenaMulliganOverlay');
        if (!overlay) return;

        const player = currentGame.players[0];
        const mullCount = player.mulliganCount || 0;
        // In multiplayer, 1st mulligan is FREE (Rule 103.4c)
        // Subsequent mulligans put (mulliganCount - 1) cards on bottom
        const cardsToBottomCount = Math.max(0, mullCount - 1);
        const hand = player.hand || [];

        const landsCount = hand.filter(c => c.isLand).length;
        const spellsCount = hand.length - landsCount;
        const totalCmc = hand.filter(c => !c.isLand).reduce((sum, c) => sum + (c.cmc || 0), 0);
        const avgCmc = spellsCount > 0 ? (totalCmc / spellsCount).toFixed(1) : '0.0';

        // Mulligan badge status
        let statusBadgeText = `Opening Hand (7 Cards)`;
        if (mullCount === 1) {
            statusBadgeText = `Mulligan 1 (FREE • 7 Cards)`;
        } else if (mullCount > 1) {
            statusBadgeText = `Mulligan #${mullCount} (Keep ${7 - cardsToBottomCount} • Bottom ${cardsToBottomCount})`;
        }

        // Instruction banner
        let bannerHtml = '';
        if (cardsToBottomCount > 0) {
            const needSelect = cardsToBottomCount;
            const currentSelected = selectedBottomCardIds.size;
            bannerHtml = `
                <div class="mulligan-instruction-banner require-bottom">
                    <div>
                        <strong>London Mulligan:</strong> Please select <strong>${needSelect}</strong> card${needSelect > 1 ? 's' : ''} from your hand to put on the bottom of your library.
                    </div>
                    <div style="font-weight: 800; font-size: 0.85rem;">
                        Selected: ${currentSelected} / ${needSelect}
                    </div>
                </div>
            `;
        } else {
            bannerHtml = `
                <div class="mulligan-instruction-banner">
                    <span>💡 <strong>Multiplayer Format:</strong> Your first mulligan is 100% free with no penalty (Rule 103.4c).</span>
                    <span style="color: #38bdf8; font-weight: 700;">Hand Size: 7</span>
                </div>
            `;
        }

        // Cards Grid
        let cardsHtml = '';
        hand.forEach(c => {
            const isBottomSelected = selectedBottomCardIds.has(c.id);
            const isSelectable = cardsToBottomCount > 0;
            const effP = player.getEffectivePower ? player.getEffectivePower(c) : c.power;
            const effT = player.getEffectiveToughness ? player.getEffectiveToughness(c) : c.toughness;

            cardsHtml += `
                <div class="mulligan-card ${isSelectable ? 'selectable' : ''} ${isBottomSelected ? 'selected-bottom' : ''}"
                     onclick="${isSelectable ? `window.toggleMulliganBottomCard('${c.id}')` : ''}"
                     onmouseenter="window.showCardInspector('${escapeHtml(c.name)}')"
                     onmouseleave="window.hideCardInspector()"
                     title="${escapeHtml(c.name)} - ${c.typeLine}">
                    <div class="mulligan-card-topbar">
                        <span class="mulligan-card-name">${escapeHtml(c.name)}</span>
                        <span class="mulligan-card-cost">${c.manaCost || ''}</span>
                    </div>
                    <img class="mulligan-card-art" src="${getCardArtCropUrl(c.name)}" loading="lazy" alt="${escapeHtml(c.name)}" onerror="this.onerror=null; this.src='https://cards.scryfall.io/back.png';" />
                    <div class="mulligan-card-footer">
                        <span class="mulligan-card-type">${escapeHtml(c.typeLine || 'Spell')}</span>
                        ${c.isCreature ? `<span class="mulligan-card-pt">${effP}/${effT}</span>` : ''}
                    </div>
                </div>
            `;
        });

        // Action Buttons
        const canConfirmKeep = cardsToBottomCount === 0 || selectedBottomCardIds.size === cardsToBottomCount;
        const keepBtnLabel = cardsToBottomCount === 0 
            ? `✅ Keep Hand (7 Cards)` 
            : `✅ Confirm & Keep Hand (${7 - cardsToBottomCount} Cards)`;

        let mullBtnLabel = '';
        let mullBtnClass = '';
        if (mullCount === 0) {
            mullBtnLabel = `🔄 Free Mulligan (Draw 7)`;
            mullBtnClass = 'arena-btn mulligan-btn-free';
        } else {
            const nextHandSize = Math.max(1, 7 - cardsToBottomCount - 1);
            mullBtnLabel = `🔄 Mulligan to ${nextHandSize} Cards`;
            mullBtnClass = 'arena-btn mulligan-btn-mull';
        }

        overlay.innerHTML = `
            <div class="arena-mulligan-dialog">
                <!-- Header -->
                <div class="mulligan-header">
                    <div class="mulligan-title-area">
                        <div class="mulligan-badge-icon">🃏</div>
                        <div>
                            <h3 class="mulligan-heading">Opening Hand & Mulligan</h3>
                            <div class="mulligan-rule-tag">
                                <span>⚖️ MTG Comprehensive Rules 103.4c</span>
                                <span>•</span>
                                <span>1st Mulligan is FREE in Multiplayer Commander</span>
                            </div>
                        </div>
                    </div>

                    <!-- Stats Bar -->
                    <div class="mulligan-stats-bar">
                        <span class="mulligan-stat-chip" style="background: rgba(168, 85, 247, 0.15); border-color: rgba(168, 85, 247, 0.4); color: #c084fc;">
                            ${statusBadgeText}
                        </span>
                        <span class="mulligan-stat-chip">🏞️ ${landsCount} Land${landsCount !== 1 ? 's' : ''}</span>
                        <span class="mulligan-stat-chip">⚔️ ${spellsCount} Spell${spellsCount !== 1 ? 's' : ''}</span>
                        <span class="mulligan-stat-chip">⚡ Avg CMC: ${avgCmc}</span>
                    </div>
                </div>

                <!-- Instruction Banner -->
                ${bannerHtml}

                <!-- Cards Grid -->
                <div class="mulligan-cards-grid">
                    ${cardsHtml}
                </div>

                <!-- Action Controls -->
                <div class="mulligan-actions-bar">
                    <div style="font-size: 0.78rem; color: var(--arena-text-muted);">
                        ${cardsToBottomCount > 0 
                            ? 'Tip: Put excess high-cost spells or extra lands onto the bottom of your library.' 
                            : 'Evaluate your curve and mana base before deciding to keep or take a free mulligan.'}
                    </div>
                    <div style="display: flex; gap: 0.75rem;">
                        <button class="${mullBtnClass}" onclick="window.takePlayerMulligan()">
                            ${mullBtnLabel}
                        </button>
                        <button class="arena-btn arena-btn-primary" 
                                onclick="window.keepPlayerOpeningHand()"
                                ${!canConfirmKeep ? 'disabled style="opacity: 0.45; cursor: not-allowed;"' : ''}>
                            ${keepBtnLabel}
                        </button>
                    </div>
                </div>
            </div>
        `;
    };

    window.toggleMulliganBottomCard = function (cardId) {
        if (!currentGame) return;
        const player = currentGame.players[0];
        const mullCount = player.mulliganCount || 0;
        const cardsToBottomCount = Math.max(0, mullCount - 1);
        if (cardsToBottomCount <= 0) return;

        if (selectedBottomCardIds.has(cardId)) {
            selectedBottomCardIds.delete(cardId);
        } else {
            if (selectedBottomCardIds.size >= cardsToBottomCount) {
                // Remove first selected to allow sliding selection
                const first = selectedBottomCardIds.values().next().value;
                selectedBottomCardIds.delete(first);
            }
            selectedBottomCardIds.add(cardId);
        }
        window.renderMulliganModal();
    };

    window.takePlayerMulligan = function () {
        if (!currentGame) return;
        const player = currentGame.players[0];
        // Human player draws fresh 7 cards; autoBottom = false so human can inspect and choose cards to bottom
        const mullRes = player.takeMulligan([], false);
        selectedBottomCardIds.clear();

        appendArenaLogs([mullRes.log]);
        window.renderMulliganModal();
    };

    window.keepPlayerOpeningHand = function () {
        if (!currentGame) return;
        const player = currentGame.players[0];
        const mullCount = player.mulliganCount || 0;
        const cardsToBottomCount = Math.max(0, mullCount - 1);

        if (cardsToBottomCount > 0) {
            if (selectedBottomCardIds.size !== cardsToBottomCount) {
                alert(`Please select exactly ${cardsToBottomCount} card(s) to place on the bottom of your library.`);
                return;
            }
            // Move chosen cards to bottom of library
            const bottomed = player.bottomCards(Array.from(selectedBottomCardIds));
            if (bottomed.length > 0) {
                appendArenaLogs([{
                    type: 'MULLIGAN_BOTTOM',
                    message: `⬇️ **${player.name}** placed **${bottomed.map(c => c.name).join(', ')}** onto the bottom of the library.`
                }]);
            }
        }

        const keepRes = player.keepHand();
        appendArenaLogs([keepRes.log]);

        // Resolve AI bot opponents' mulligans according to Forge heuristics
        const botLogs = currentGame.resolveBotMulligans();
        if (botLogs && botLogs.length > 0) {
            appendArenaLogs(botLogs);
        }

        appendArenaLogs([{
            type: 'MATCH_START',
            message: `⚔️ **All players have kept opening hands! Starting Turn 1.**`
        }]);

        // Advance to Turn 1 Pre-Combat Main Phase (MAIN_1)
        currentGame.currentPhase = 'MAIN_1';
        const p1 = currentGame.players[0];
        p1.untapAll();
        p1.landPlayedThisTurn = false;

        window.closeMulliganModal();
        updateArenaDOM();
    };

    // ============================================================================
    // SIMULATION & STEPPING LIFECYCLE
    // ============================================================================

    window.openCommanderArena = function (customDeck = null) {
        initArenaModal();
        const backdrop = document.getElementById('arenaModalBackdrop');
        if (backdrop) backdrop.style.display = 'flex';

        // Requirement: Allow selecting which deck to play FIRST before the opening hand is drawn
        window.openArenaSetup(customDeck);
    };

    window.closeCommanderArena = function () {
        if (autoPlayTimer) {
            clearInterval(autoPlayTimer);
            autoPlayTimer = null;
        }
        isPaused = true;
        const backdrop = document.getElementById('arenaModalBackdrop');
        if (backdrop) backdrop.style.display = 'none';
    };

    window.toggleArenaPlayPause = function () {
        const icon = document.getElementById('arenaPlayIcon');
        const txt = document.getElementById('arenaPlayText');

        if (isPaused) {
            isPaused = false;
            if (icon) icon.textContent = '⏸️';
            if (txt) txt.textContent = 'Pause';

            autoPlayTimer = setInterval(() => {
                if (!currentGame || currentGame.isGameOver) {
                    window.toggleArenaPlayPause();
                    return;
                }
                const activeP = currentGame.getActivePlayer();
                // If it is human player's main phase or declare attackers, pause to let them act!
                if (!activeP.isAI && (currentGame.currentPhase.includes('MAIN') || currentGame.currentPhase === 'DECLARE_ATTACKERS')) {
                    window.toggleArenaPlayPause();
                    return;
                }

                const result = currentGame.stepPhase();
                updateArenaDOM();
                if (result.logs && result.logs.length > 0) {
                    appendArenaLogs(result.logs);
                }
            }, playSpeedMs);
        } else {
            isPaused = true;
            if (autoPlayTimer) {
                clearInterval(autoPlayTimer);
                autoPlayTimer = null;
            }
            if (icon) icon.textContent = '▶️';
            if (txt) txt.textContent = 'Auto-Bots';
        }
    };

    window.stepArenaPhase = function () {
        if (!currentGame || currentGame.isGameOver) return;
        const result = currentGame.stepPhase();
        updateArenaDOM();
        if (result.logs && result.logs.length > 0) {
            appendArenaLogs(result.logs);
        }
    };

    window.simulateArenaInstant = function () {
        if (!currentGame || currentGame.isGameOver) return;
        if (autoPlayTimer) clearInterval(autoPlayTimer);
        isPaused = true;
        window.closeMulliganModal();

        const result = currentGame.runMatchSimulation();
        updateArenaDOM();
        appendArenaLogs(result.logs);
    };

    window.clearArenaLog = function () {
        const streamEl = document.getElementById('arenaLogStream');
        if (streamEl) streamEl.innerHTML = '';
    };

    window.updateSeat0Preview = function () {
        const select0 = document.getElementById('seatSelect0');
        const thumb = document.getElementById('seat0CmdrThumb');
        const details = document.getElementById('seat0CmdrDetails');
        if (!select0) return;
        const decks = getAvailableDecks();
        const chosen = decks.find(d => d.id === select0.value) || decks[0];
        if (chosen) {
            const cmdrName = chosen.commander || chosen.name;
            if (thumb) thumb.src = getCardArtCropUrl(cmdrName);
            if (details) details.textContent = `Commander: ${cmdrName}`;
        }
    };

    window.openArenaSetup = function (customDeck = null) {
        initArenaModal();
        const backdrop = document.getElementById('arenaModalBackdrop');
        if (backdrop) backdrop.style.display = 'flex';

        if (customDeck) {
            let deckObj = customDeck;
            const engine = window.MtgCommanderEngine;
            if (typeof customDeck === 'string') {
                const parsed = engine ? engine.parseDecklistText(customDeck) : { commander: null, cards: [] };
                deckObj = {
                    id: 'custom_deck_active',
                    name: `⭐ ${parsed.commander || 'Custom Deck'}`,
                    commander: parsed.commander || 'Custom Commander',
                    cards: parsed.cards
                };
            } else if (customDeck.content && (!customDeck.cards || customDeck.cards.length === 0)) {
                const parsed = engine ? engine.parseDecklistText(customDeck.content) : { commander: null, cards: [] };
                deckObj = {
                    id: customDeck.id ? `custom_${customDeck.id}` : 'custom_deck_active',
                    name: `⭐ ${customDeck.name || parsed.commander || 'Custom Deck'}`,
                    commander: parsed.commander || customDeck.commander || 'Custom Commander',
                    cards: parsed.cards
                };
            } else {
                deckObj = {
                    id: customDeck.id ? `custom_${customDeck.id}` : 'custom_deck_active',
                    name: `⭐ ${customDeck.name || customDeck.commander || 'Custom Deck'}`,
                    commander: customDeck.commander || customDeck.name || 'Custom Commander',
                    cards: customDeck.cards || []
                };
            }
            userActiveCustomDeck = deckObj;
        }

        const overlay = document.getElementById('arenaSetupOverlay');
        const decks = getAvailableDecks();

        for (let i = 0; i < 4; i++) {
            const select = document.getElementById(`seatSelect${i}`);
            if (select) {
                const prevVal = select.value;
                select.innerHTML = '';
                decks.forEach((d, idx) => {
                    const opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = d.name;
                    if (i === 0) {
                        if (userActiveCustomDeck && d.id === userActiveCustomDeck.id) {
                            opt.selected = true;
                        } else if (!userActiveCustomDeck && (prevVal ? d.id === prevVal : idx === 0)) {
                            opt.selected = true;
                        }
                    } else {
                        const defaultBotIndex = i % PRESET_DECKS.length;
                        const defaultBotId = PRESET_DECKS[defaultBotIndex].id;
                        if (prevVal && prevVal !== (userActiveCustomDeck && userActiveCustomDeck.id)) {
                            opt.selected = (d.id === prevVal);
                        } else {
                            opt.selected = (d.id === defaultBotId);
                        }
                    }
                    select.appendChild(opt);
                });
            }
        }

        window.updateSeat0Preview();
        if (overlay) overlay.style.display = 'flex';
    };

    window.closeArenaSetup = function () {
        const overlay = document.getElementById('arenaSetupOverlay');
        if (overlay) overlay.style.display = 'none';
    };

    window.applyArenaSetupAndStart = function (customDeck = null) {
        window.closeArenaSetup();
        if (autoPlayTimer) clearInterval(autoPlayTimer);
        isPaused = true;
        selectedAttackerIds.clear();

        const decks = getAvailableDecks();
        const selectedDecks = [];

        if (customDeck) {
            let deckObj = customDeck;
            const engine = window.MtgCommanderEngine;
            if (typeof customDeck === 'string') {
                const parsed = engine ? engine.parseDecklistText(customDeck) : { commander: null, cards: [] };
                deckObj = {
                    id: 'custom_deck_user',
                    name: parsed.commander || 'Custom Deck',
                    commander: parsed.commander,
                    cards: parsed.cards
                };
            } else if (customDeck.content && (!customDeck.cards || customDeck.cards.length === 0)) {
                const parsed = engine ? engine.parseDecklistText(customDeck.content) : { commander: null, cards: [] };
                deckObj = {
                    id: 'custom_deck_user',
                    name: customDeck.name || parsed.commander || 'Custom Deck',
                    commander: parsed.commander || customDeck.commander,
                    cards: parsed.cards
                };
            }
            selectedDecks.push(deckObj);
            selectedDecks.push(PRESET_DECKS[1]);
            selectedDecks.push(PRESET_DECKS[2]);
            selectedDecks.push(PRESET_DECKS[3]);
        } else {
            for (let i = 0; i < 4; i++) {
                const select = document.getElementById(`seatSelect${i}`);
                const chosenId = select ? select.value : null;
                const d = decks.find(x => x.id === chosenId) || PRESET_DECKS[i % PRESET_DECKS.length];
                selectedDecks.push(d);
            }
        }

        // Enrich any custom or selected decks using window.__MTG_CARD_CACHE__
        if (window.__MTG_CARD_CACHE__) {
            selectedDecks.forEach(d => {
                if (d && Array.isArray(d.cards)) {
                    d.cards.forEach(c => {
                        const cached = window.__MTG_CARD_CACHE__[c.name.toLowerCase()];
                        if (cached) {
                            if (!c.manaCost) c.manaCost = cached.manaCost;
                            if (c.cmc === undefined) c.cmc = cached.cmc;
                            if (!c.typeLine) c.typeLine = cached.typeLine;
                            if (c.power === undefined) c.power = cached.power;
                            if (c.toughness === undefined) c.toughness = cached.toughness;
                            if (!c.oracleText) c.oracleText = cached.oracleText;
                        }
                    });
                }
            });
        }

        const engine = window.MtgCommanderEngine;
        if (!engine) {
            console.error("MtgCommanderEngine not loaded yet.");
            return;
        }

        currentGame = new engine.CommanderGame({
            players: selectedDecks.map((d, idx) => ({
                id: `p_${idx + 1}`,
                name: idx === 0 ? (d.commander ? `${d.commander} (You)` : 'You') : (d.commander ? `${d.commander}` : `Opponent ${idx}`),
                deck: (d && (d.cards || d.commander)) ? { commander: d.commander, cards: d.cards || [] } : d,
                isAI: idx !== 0,
                avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(d.commander || d.name)}`
            })),
            maxTurns: 35
        });

        window.clearArenaLog();
        appendArenaLogs([{
            type: 'GAME_INIT',
            message: `🚀 **Live 4-Player Tabletop Initialized!** You are commanding **${selectedDecks[0].commander || selectedDecks[0].name}** against 3 bot opponents.`
        }]);

        updateArenaDOM();
        window.openMulliganModal();
    };

    // Auto-mount listener on document ready
    document.addEventListener('DOMContentLoaded', () => {
        initArenaModal();
    });

})();
