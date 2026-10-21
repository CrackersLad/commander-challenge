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
                "isCommander": true
            },
            {
                "name": "Liliana, Death's Majesty",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Forgotten Creation",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Havengul Runebinder",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Stitcher Geralf",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Undead Alchemist",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Butcher of Malakir",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Cemetery Reaper",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Death Baron",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Diregraf Colossus",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Eater of Hope",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Gravespawn Sovereign",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Midnight Reaper",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Overseer of the Damned",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Gisa and Geralf",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Eternal Skylord",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Corpse Augur",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Fleshbag Marauder",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Liliana's Devotee",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Lord of the Accursed",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Spark Reaper",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Undead Augur",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Diregraf Captain",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Gleaming Overseer",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Ruthless Deathfang",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Hour of Eternity",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Army of the Damned",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Dark Salvation",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Dread Summons",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Zombie Apocalypse",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Distant Melody",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Feed the Swarm",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Syphon Flesh",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Aetherspouts",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Go for the Throat",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Arcane Signet",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Charcoal Diamond",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Commander's Sphere",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Sky Diamond",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Sol Ring",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Talisman of Dominance",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Rooftop Storm",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Dreadhorde Invasion",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Endless Ranks of the Dead",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Liliana's Mastery",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Open the Graves",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Choked Estuary",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Darkwater Catacombs",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Exotic Orchard",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Sunken Hollow",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Temple of Deceit",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Bojuka Bog",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Command Tower",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Dimir Aqueduct",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Mortuary Mire",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Myriad Landscape",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Path of Ancestry",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Tainted Isle",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Unclaimed Territory",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Island",
                "quantity": 12,
                "isCommander": false
            },
            {
                "name": "Swamp",
                "quantity": 15,
                "isCommander": false
            },
            {
                "name": "Eloise, Nephalia Sleuth",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Cleaver Skaab",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Curse of Unbinding",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Drown in Dreams",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Empty the Laboratory",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Hordewing Skaab",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Shadow Kin",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Crowded Crypt",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Curse of the Restless Dead",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Ghouls' Night Out",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Gorex, the Tombshell",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Prowling Geistcatcher",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Ravenous Rotbelly",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Tomb Tyrant",
                "quantity": 1,
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
                "isCommander": true
            },
            {
                "name": "Abomination of Llanowar",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Beast Whisperer",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Canopy Tactician",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Cultivator of Blades",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Dwynen, Gilt-Leaf Daen",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Elderfang Ritualist",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Elvish Archdruid",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Elvish Mystic",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Elvish Rejuvenator",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "End-Raze Forerunners",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Eyeblight Cullers",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Farhaven Elf",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Golgari Findbroker",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Harald, King of Skemfar",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Imperious Perfect",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Jagged-Scar Archers",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Jaspera Sentinel",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Llanowar Tribe",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Lys Alana Huntmaster",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Lys Alana Scarblade",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Marwyn, the Nurturer",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Masked Admirers",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Miara, Thorn of the Glade",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Nullmage Shepherd",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Numa, Joraga Chieftain",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Poison-Tip Archer",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Reclamation Sage",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Rhys the Exiled",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Ruthless Winnower",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Shaman of the Pack",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Skemfar Shadowsage",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Springbloom Druid",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Sylvan Messenger",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Timberwatch Elf",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Twinblade Assassins",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Voice of Many",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Voice of the Woods",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Wirewood Channeler",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Wolverine Riders",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Wood Elves",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Elven Ambush",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Poison the Cup",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Putrefy",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Tergrid's Shadow",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Ambition's Cost",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Bounty of Skemfar",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Casualties of War",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Eyeblight Massacre",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Elvish Promenade",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Harvest Season",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Pact of the Serpent",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Return Upon the Tide",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Roots of Wisdom",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Arcane Signet",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Serpent's Soul-Jar",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Sol Ring",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Binding the Old Gods",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Crown of Skemfar",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Elderfang Venom",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Pride of the Perfect",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Prowess of the Fair",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Moldervine Reclamation",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Command Tower",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Forest",
                "quantity": 16,
                "isCommander": false
            },
            {
                "name": "Foul Orchard",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Golgari Guildgate",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Golgari Rot Farm",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Jungle Hollow",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Myriad Landscape",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Path of Ancestry",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Skemfar Elderhall",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Swamp",
                "quantity": 13,
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
                "isCommander": true
            },
            {
                "name": "O-Kagachi, Vengeful Kami",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Ramos, Dragon Engine",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Scalelord Reckoner",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Boneyard Scourge",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Territorial Hellkite",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Taigam, Ojutai Master",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Wasitora, Nekoru Queen",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Ryusei, the Falling Star",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Scourge of Valkas",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Utvara Hellkite",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Sunscorch Regent",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Deathbringer Regent",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Hellkite Charger",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Tyrant's Familiar",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Atarka, World Render",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Bladewing the Risen",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Broodmate Dragon",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Crosis, the Purger",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Dromoka, the Eternal",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Intet, the Dreamer",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Kolaghan, the Storm's Fury",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Niv-Mizzet, Dracogenius",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Ojutai, Soul of Winter",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Scion of the Ur-Dragon",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Silumgar, the Drifting Death",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Spellbound Dragon",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Teneb, the Harvester",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Steel Hellkite",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Orator of Ojutai",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Dragonlord's Servant",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Dragonspeaker Shaman",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Savage Ventmaw",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Fortunate Few",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Fractured Identity",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Crux of Fate",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Painful Truths",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Earthquake",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Cultivate",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Farseek",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Kodama's Reach",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Rain of Thorns",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Fist of Suns",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Herald's Horn",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Mirror of the Forebears",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Armillary Sphere",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Commander's Sphere",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Darksteel Ingot",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Dreamstone Hedron",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Lightning Greaves",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Nihil Spellbomb",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Sol Ring",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Wayfarer's Bauble",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Kindred Discovery",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Monastery Siege",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Palace Siege",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Crucible of Fire",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Dragon Tempest",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Frontier Siege",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Curse of Verbosity",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Curse of Opulence",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Curse of Bounty",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Elemental Bond",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Crucible of the Spirit Dragon",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Haven of the Spirit Dragon",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Mountain",
                "quantity": 2,
                "isCommander": false
            },
            {
                "name": "Mountain",
                "quantity": 2,
                "isCommander": false
            },
            {
                "name": "Mountain",
                "quantity": 2,
                "isCommander": false
            },
            {
                "name": "Swamp",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Swamp",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Swamp",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Forest",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Forest",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Forest",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Plains",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Plains",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Plains",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Island",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Island",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Island",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Path of Ancestry",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Arcane Sanctum",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Command Tower",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Crumbling Necropolis",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Frontier Bivouac",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Jungle Shrine",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Mystic Monastery",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Nomad Outpost",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Opulent Palace",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Sandsteppe Citadel",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Savage Lands",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Seaside Citadel",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Vivid Crag",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Vivid Creek",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Vivid Grove",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Vivid Marsh",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Vivid Meadow",
                "quantity": 1,
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
                "isCommander": true
            },
            {
                "name": "Chittering Witch",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Fiend of the Shadows",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Gonti, Lord of Luxury",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Marionette Master",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Ogre Slumlord",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Piper of the Swarm",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Pontiff of Blight",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Dark-Dweller Oracle",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Dire Fleet Daredevil",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Dream Pillager",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Etali, Primal Storm",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Izzet Chemister",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Tectonic Giant",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Loyal Apprentice",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Consuming Vapors",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Hex",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Apex of Power",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Disrupt Decorum",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Ignite the Future",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Phthisis",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Light Up the Stage",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Throes of Chaos",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Vandalblast",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Chaos Warp",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Commune with Lava",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Bedevil",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Bituminous Blast",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Rakdos Charm",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Terminate",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Chaos Wand",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Arcane Signet",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Commander's Sphere",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Fellwar Stone",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Mind Stone",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Orazca Relic",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Rakdos Signet",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Sol Ring",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Talisman of Indulgence",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Unstable Obelisk",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Dead Man's Chest",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Theater of Horrors",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Shiny Impetus",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Exotic Orchard",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Foreboding Ruins",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Shadowblood Ridge",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Smoldering Marsh",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Spinerock Knoll",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Bojuka Bog",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Command Tower",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Mortuary Mire",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Rakdos Carnarium",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Tainted Peak",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Zhalfirin Void",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Swamp",
                "quantity": 4,
                "isCommander": false
            },
            {
                "name": "Swamp",
                "quantity": 4,
                "isCommander": false
            },
            {
                "name": "Swamp",
                "quantity": 3,
                "isCommander": false
            },
            {
                "name": "Swamp",
                "quantity": 3,
                "isCommander": false
            },
            {
                "name": "Mountain",
                "quantity": 4,
                "isCommander": false
            },
            {
                "name": "Mountain",
                "quantity": 3,
                "isCommander": false
            },
            {
                "name": "Mountain",
                "quantity": 3,
                "isCommander": false
            },
            {
                "name": "Mountain",
                "quantity": 3,
                "isCommander": false
            },
            {
                "name": "Karazikar, the Eye Tyrant",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Bag of Devouring",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Danse Macabre",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Death Tyrant",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Grim Hireling",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Hellish Rebuke",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Lorcan, Warlock Collector",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Fiendlash",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Reckless Endeavor",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Share the Spoils",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Wild-Magic Sorcerer",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Fevered Suspicion",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Hurl Through Hell",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Warlock Class",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Chaos Channeler",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "You Find Some Prisoners",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Bucknard's Everfull Purse",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Ebony Fly",
                "quantity": 1,
                "isCommander": false
            },
            {
                "name": "Underdark Rift",
                "quantity": 1,
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

    function getAvailableDecks() {
        const list = [...PRESET_DECKS];
        if (window.currentDecksData && Array.isArray(window.currentDecksData)) {
            window.currentDecksData.forEach(d => {
                if (d && !d.error && d.cards && d.cards.length > 0) {
                    list.unshift({
                        id: `scanned_${d.id}`,
                        name: `⭐ ${d.name} (${d.commander || 'Commander'})`,
                        commander: d.commander || 'Commander',
                        cards: d.cards
                    });
                }
            });
        }
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
                            <span style="font-size: 0.72rem; color: #a855f7; font-weight: 700;">Client-Native Forge Rules Engine • Live 4-Player Tabletop</span>
                        </div>
                    </div>

                    <!-- Phase Tracker -->
                    <div class="arena-phase-bar" id="arenaPhaseBar">
                        <span class="arena-phase-step" data-phase="UNTAP">Untap</span>
                        <span class="arena-phase-step" data-phase="UPKEEP">Upkeep</span>
                        <span class="arena-phase-step" data-phase="DRAW">Draw</span>
                        <span class="arena-phase-step" data-phase="MAIN_1">Main 1</span>
                        <span class="arena-phase-step" data-phase="DECLARE_ATTACKERS">Attack</span>
                        <span class="arena-phase-step" data-phase="COMBAT_DAMAGE">Damage</span>
                        <span class="arena-phase-step" data-phase="MAIN_2">Main 2</span>
                        <span class="arena-phase-step" data-phase="END_STEP">End</span>
                    </div>

                    <!-- Action Controls -->
                    <div class="arena-controls">
                        <div class="arena-turn-badge" id="arenaTurnIndicator">Turn 1</div>
                        <button class="arena-btn" id="arenaBtnPlayPause" onclick="window.toggleArenaPlayPause()">
                            <span id="arenaPlayIcon">▶️</span> <span id="arenaPlayText">Auto-Bots</span>
                        </button>
                        <button class="arena-btn" id="arenaBtnStep" onclick="window.stepArenaPhase()">
                            ⏭️ Next Action
                        </button>
                        <button class="arena-btn" onclick="window.simulateArenaInstant()">
                            ⚡ Instant Match
                        </button>
                        <button class="arena-btn" onclick="window.openArenaSetup()">
                            ⚙️ Pod Setup
                        </button>
                        <button class="arena-btn" style="color: #ef4444;" onclick="window.closeCommanderArena()">
                            ✕ Close
                        </button>
                    </div>
                </header>

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
                            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #fff;">
                                👑 Configure 4-Player Pod
                            </h3>
                            <button class="arena-btn" onclick="window.closeArenaSetup()">✕</button>
                        </div>
                        <p style="font-size: 0.84rem; color: var(--arena-text-muted); margin: 0; line-height: 1.45;">
                            Choose your deck for Seat 1 (interactive live play) and assign decks for the 3 practice AI bots.
                        </p>

                        <div class="setup-seats-grid">
                            <div class="setup-seat-box">
                                <span class="setup-seat-label">Seat 1 (You / Interactive)</span>
                                <select class="setup-seat-select" id="seatSelect0"></select>
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

                        <div style="display: flex; justify-content: flex-end; gap: 0.65rem; margin-top: 0.5rem;">
                            <button class="arena-btn" onclick="window.closeArenaSetup()">Cancel</button>
                            <button class="arena-btn arena-btn-primary" onclick="window.applyArenaSetupAndStart()">
                                🚀 Launch Pod Match
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
                            <span>🏞️ Opponent Lands (${lands.length})</span>
                            <span>💎 Support (${supports.length}) • 📚 ${opp.library.length}</span>
                        </div>
                        <div class="opponent-lands-shelf">
                            ${landsHtml}
                        </div>
                        <!-- Support Permanents Line (Artifacts, Rocks, Enchantments) -->
                        ${supports.length > 0 ? `
                        <div class="opponent-support-shelf">
                            ${supportsHtml}
                        </div>` : ''}
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

        // 2. Lands and Rocks on your battlefield
        const landsAndRocks = player.battlefield.filter(c => c.isLand || c.isManaRock);
        let landsHtml = '';
        if (landsAndRocks.length === 0) {
            landsHtml = `<div style="font-size: 0.74rem; color: var(--arena-text-muted);">Play lands from your hand below</div>`;
        } else {
            landsAndRocks.forEach(c => {
                const tappedClass = c.tapped ? 'tapped' : '';
                landsHtml += `
                    <div class="mtg-land-chip ${tappedClass}"
                         onclick="window.toggleLandTap('${c.id}')"
                         onmouseenter="window.showCardInspector('${escapeHtml(c.name)}')"
                         onmouseleave="window.hideCardInspector()"
                         title="Click to tap/untap for mana">
                        <span>${c.isLand ? '🏞️' : '💎'}</span>
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
                    tagText = 'Play Land';
                } else if (isInstantOrFlash) {
                    isPlayable = availableMana >= cost;
                    tagText = isMyTurn ? `Cast {${cost}}` : `⚡ Flash {${cost}}`;
                } else {
                    isPlayable = isMyTurn && currentPhase.includes('MAIN') && availableMana >= cost;
                    tagText = `Cast {${cost}}`;
                }

                const cardClasses = ['hand-card'];
                if (isPlayable) {
                    if (isInstantOrFlash && !isMyTurn) cardClasses.push('instant-playable');
                    else cardClasses.push('playable');
                }

                handHtml += `
                    <div class="hand-card-wrapper" onclick="window.playCardFromHand('${c.id}')">
                        <div class="${cardClasses.join(' ')}"
                             onmouseenter="window.showCardInspector('${escapeHtml(c.name)}')"
                             onmouseleave="window.hideCardInspector()">
                            <img class="hand-card-art" src="${getCardNormalUrl(c.name)}" loading="lazy" alt="${escapeHtml(c.name)}" onerror="this.onerror=null; this.src='https://cards.scryfall.io/back.png';" />
                            ${isPlayable ? `<div class="hand-card-play-tag">${tagText}</div>` : ''}
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
                        <span>💎 Mana Available:</span>
                        <span style="color: #38bdf8;">${player.getAvailableMana().total}</span>
                        <button class="arena-btn" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; margin-left: 0.4rem;" onclick="window.untapAllMyLands()">
                            ⚡ Untap All
                        </button>
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

        // Update Turn Indicator
        const turnInd = document.getElementById('arenaTurnIndicator');
        if (turnInd) {
            const activeP = currentGame.getActivePlayer();
            turnInd.innerHTML = `<strong>Turn ${currentGame.turn}</strong> • <span style="color: #a855f7;">${activeP ? activeP.name : ''}</span>`;
        }

        // Update Phase Steps
        const currentPhase = currentGame.currentPhase;
        const phaseSteps = document.querySelectorAll('.arena-phase-step');
        phaseSteps.forEach(step => {
            const phaseAttr = step.getAttribute('data-phase');
            step.classList.remove('active');
            if (phaseAttr === currentPhase || (phaseAttr === 'MAIN_1' && currentPhase === 'MAIN_1') || (phaseAttr === 'DECLARE_ATTACKERS' && currentPhase.includes('COMBAT'))) {
                step.classList.add('active');
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

        if (customDeck || !currentGame) {
            window.applyArenaSetupAndStart(customDeck);
        } else {
            updateArenaDOM();
            if (currentGame && currentGame.players[0] && !currentGame.players[0].hasKeptHand) {
                window.openMulliganModal();
            }
        }
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

    window.openArenaSetup = function () {
        initArenaModal();
        const overlay = document.getElementById('arenaSetupOverlay');
        const decks = getAvailableDecks();

        for (let i = 0; i < 4; i++) {
            const select = document.getElementById(`seatSelect${i}`);
            if (select) {
                select.innerHTML = '';
                decks.forEach((d, idx) => {
                    const opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = d.name;
                    if (idx === i) opt.selected = true;
                    select.appendChild(opt);
                });
            }
        }

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
