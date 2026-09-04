const fs = require('fs');
const path = require('path');

const PRECONS_FILE = path.join(__dirname, '..', 'public', 'commander-precons.json');
const precons = JSON.parse(fs.readFileSync(PRECONS_FILE, 'utf8'));

// Curated specific deck strategies and themes for known precons
const specificMeta = {
    // Marvel
    "Avengers Assemble": {
        theme: "Heroes & Go-Wide Combat",
        strategy: "Unite an unstoppable team of iconic Heroes. Buff your creatures through team combat synergy, draw cards, and overwhelm opponents with legendary power."
    },
    "Doom Prevails": {
        theme: "Villains, Schemes & Control",
        strategy: "Command legions of supervillains and destructive tech. Disrupt your opponents' game plans with ruthless removal and seize victory with tyrannical dominance."
    },
    "The Fantastic Four": {
        theme: "Family Synergy & Counters",
        strategy: "Coordinate the Fantastic Four with powerful +1/+1 counters, phasing, and forcefield defense. Build a fortified board and strike with cosmic strength."
    },
    "Wakanda Forever": {
        theme: "Vibranium Equipment & Counters",
        strategy: "Harness the advanced technology of Wakanda. Equip your warriors with legendary Vibranium armaments and conquer through agile, lethal combat."
    },

    // Secret Lair / SOC
    "Goblin Storm": {
        theme: "Goblin Swarm & Spellslinger",
        strategy: "Flood the board with cheap Goblins, string together multiple spells in a single turn, and burn your enemies down in an explosive storm."
    },
    "Lorehold Spirit": {
        theme: "Graveyard Artifacts & Spirits",
        strategy: "Excavate artifacts from your graveyard, trigger leave-the-graveyard synergies, and generate an ethereal army of vengeful Spirits."
    },
    "Prismari Artistry": {
        theme: "Big Mana Spellslinger",
        strategy: "Ramp into monumental, flashy instants and sorceries with huge mana costs, generating elemental tokens and devastating the board."
    },
    "Quandrix Unlimited": {
        theme: "+1/+1 Counters & Exponential Math",
        strategy: "Manipulate math and double your resources. Exponentially multiply +1/+1 counters and token copies until your board towers over opponents."
    },
    "Silverquill Influence": {
        theme: "Politics, +1/+1 Counters & Extortion",
        strategy: "Manipulate table politics and coerce combat among your foes. Distribute counters, incentivize opponents to attack each other, and finish off survivors."
    },
    "Witherbloom Pestilence": {
        theme: "Life Drain, Pests & Sacrifice",
        strategy: "Gain life to trigger lethal drain triggers across the table. Sacrifice swarms of 1/1 Pest tokens to fuel dark rituals and bleed your opponents dry."
    },

    // Duskmourn
    "Jump Scare!": {
        theme: "Manifest Dread & Face-Down Horror",
        strategy: "Keep opponents in sheer suspense with mysterious face-down cards. Flip devastating creatures face-up at instant speed to disrupt combat and crush defenses."
    },
    "Death Toll": {
        theme: "Delirium & Graveyard Reanimation",
        strategy: "Fill your graveyard with diverse card types to unlock lethal Delirium bonuses, then reanimate titanic nightmare horrors back onto the battlefield."
    },
    "Miracle Worker": {
        theme: "Enchantments & Miracle Timing",
        strategy: "Topdeck game-altering enchantments with Miracle discounts. Manipulate your library's top cards and manipulate destiny to cast epic spells for pennies."
    },
    "Endless Punishment": {
        theme: "Group Slug & Agonizing Tax",
        strategy: "Inflict continuous damage on opponents for every fundamental action they take—drawing cards, tapping lands, or casting spells—slowly bleeding them to death."
    },

    // Bloomburrow
    "Animated Army": {
        theme: "Artifacts, Enchantments & Living Weapons",
        strategy: "Bring inanimate noncreature artifacts and enchantments to life as monstrous 4/4 combatants, attacking aggressively while accruing massive value."
    },
    "Family Matters": {
        theme: "Offspring & Go-Wide Tokens",
        strategy: "Pay the Offspring cost to create 1/1 token copies of powerful creatures, doubling enter-the-battlefield triggers and assembling an insurmountable swarm."
    },
    "Peace Offering": {
        theme: "Group Hug & Counter Aggro",
        strategy: "Bribe everyone at the table with extra card draw and mana, then turn your commander into a hulking, trampling beatstick fueled by their greed."
    },
    "Squirreled Away": {
        theme: "Squirrel Swarm & Forage",
        strategy: "Stockpile Food tokens and squirrel away cards in your graveyard, then unleash a relentless avalanche of biting squirrels to overwhelm the table."
    },

    // Modern Horizons 3
    "Graveyard Overdrive": {
        theme: "Lhurgoyfs & Graveyard Scaling",
        strategy: "Stockpile all card types in graveyards to supercharge terrifying Lhurgoyf creatures whose power and toughness scale to massive heights."
    },
    "Tricky Terrain": {
        theme: "Lands Matter & Everything Counters",
        strategy: "Ramp lands relentlessly and place everything counters onto nonbasic utility lands, unlocking game-winning mana engines and titan threats."
    },
    "Creative Energy": {
        theme: "Energy Counters & Artifact Tokens",
        strategy: "Harness a rechargeable pool of Energy counters to fuel repeatable explosive abilities, create copiers, and cheat huge artifacts into play."
    },
    "Eldrazi Incursion": {
        theme: "Colorless Cosmic Horrors & Devoid",
        strategy: "Wield all five colors to cast eldritch Eldrazi titans, generate swarms of Eldrazi Scions for mana acceleration, and trigger devastating Annihilator effects."
    },

    // Outlaws of Thunder Junction
    "Quick Draw": {
        theme: "Spellslinger & Cantrip Velocity",
        strategy: "Chain multiple cheap spells per turn to supercharge your commander, dig deep through your deck, and blast opponents with spell-trigger damage."
    },
    "Desert Bloom": {
        theme: "Lands, Deserts & Graveyard Value",
        strategy: "Discard, sacrifice, and recur Deserts and utility lands from your graveyard, triggering landfall engines and turning barren sands into lethal threats."
    },
    "Grand Larceny": {
        theme: "Card Theft & Combat Damage",
        strategy: "Sneak evasive outlaws past blockers to exile cards directly from your opponents' libraries, using their own spells and win conditions against them."
    },
    "Most Wanted": {
        theme: "Outlaw Tribal & Treasure Hoard",
        strategy: "Assemble a rowdy crew of Assassins, Mercenaries, Pirates, Rogues, and Warlocks, amassing piles of Treasure to fuel explosive power turns."
    },

    // Fallout
    "Scrappy Survivors": {
        theme: "Auras, Equipment & Junk Tokens",
        strategy: "Scavenge the wasteland with Dogmeat! Equip and enchant your survivors, crack Junk tokens for extra cards, and build a massive Voltron champion."
    },
    "Mutant Menace": {
        theme: "Radiation, Mill & +1/+1 Counters",
        strategy: "Irradiate the entire table with Rad counters to mill opponents' cards and drain their life, while mutating your own creatures into colossal radioactive beasts."
    },
    "Science!": {
        theme: "Energy Counters & Artifact Synthesis",
        strategy: "Build high-tech synths and robots powered by Energy. Generate energy reserves to copy key artifacts, cheat mana costs, and out-value your foes."
    },
    "Hail, Caesar": {
        theme: "Go-Wide Soldier Tokens & Sacrifice",
        strategy: "March an army of loyal soldier tokens across the battlefield, sacrificing foot soldiers to Caesar to draw cards, burn targets, and conquer the board."
    },

    // Murders at Karlov Manor
    "Deadly Disguise": {
        theme: "Disguise, Cloak & Face-Down Combat",
        strategy: "Hide lethal creatures face-down with ward protection, flipping them at surprise moments in combat to turn the tides and catch opponents off-guard."
    },
    "Revenant Recon": {
        theme: "Surveil & Reanimation",
        strategy: "Sift through your library with Surveil, filling your graveyard with massive legendary monsters, then cheat them directly onto the battlefield."
    },
    "Deep Clue Sea": {
        theme: "Investigate, Clues & Card Draw",
        strategy: "Investigate crime scenes to generate a sea of Clue tokens. Crack clues for endless cards and turn card draw into overwhelming creature buffs."
    },
    "Blame Game": {
        theme: "Goad, Forced Combat & Deflection",
        strategy: "Force your opponents to battle one another using Goad, while using deflective political tools to ensure their attacks never point in your direction."
    },

    // Lost Caverns of Ixalan
    "Veloci-RAMP-tor": {
        theme: "Dinosaur Tribal & Discover",
        strategy: "Ramp into colossal prehistoric Dinosaurs that trigger free Discover cascades straight from your deck, putting giant threats directly onto the board."
    },
    "Blood Rites": {
        theme: "Vampire Aristocrats & Demon Rebirth",
        strategy: "Sacrifice Vampire tokens to drain opponent life totals, then transform your fallen bloodlines into massive flying Demons to deliver the killing blow."
    },
    "Ahoy Mateys": {
        theme: "Pirates & Graveyard Encore",
        strategy: "Plunder and pillage with an aggressive pirate fleet. Resurrect fallen scoundrels from the graveyard for surprise raid attacks and treasure generation."
    },
    "Explorers of the Deep": {
        theme: "Merfolk Tribal & Explore",
        strategy: "Dive into ancient ruins with Merfolk that Explore for lands and +1/+1 counters, crafting an evasive, heavily fortified islandwalk armada."
    },

    // Doctor Who
    "Blast From the Past": {
        theme: "Historic Cards & Classic Doctors",
        strategy: "Celebrate the classic Doctor Who eras using sagas, legendaries, and historic artifacts to weave complex, recursive time-travel engines."
    },
    "Timey-Wimey": {
        theme: "Time Travel, Suspend & Vanishing",
        strategy: "Manipulate the flow of time by adding or stripping time counters from Suspended spells, unleashing game-winning bombs turns before their time."
    },
    "Masters of Evil": {
        theme: "Villainous Choices & Dalek Aggro",
        strategy: "Force your opponents to make painful Villainous Choices that hurt them no matter what they pick, backed up by relentless Daleks and Cybermen."
    },
    "Paradox Power": {
        theme: "Cast From Exile & Paradox Value",
        strategy: "Cast spells from exile, libraries, and adventures to trigger colossal Paradox bonuses, growing your commander and dominating late-game turns."
    },

    // Wilds of Eldraine
    "Fae Dominion": {
        theme: "Faerie Tribal & Instant-Speed Control",
        strategy: "Flash in tricky Faerie fliers during opponents' turns, counter their key spells, and steal their resources while chipping away from the skies."
    },
    "Virtue and Valor": {
        theme: "Enchantress & Role Tokens",
        strategy: "Enchant your champions with Monster, Royal, and Sorcerer Roles, turning humble creatures into gigantic heroic threats that draw cards when hitting."
    },

    // Commander Masters
    "Eldrazi Unbound": {
        theme: "Colorless Ramp & Eldritch Titans",
        strategy: "Generate immense amounts of colorless mana using power stones and utility rocks to cast monstrous, world-shattering Eldrazi abominations."
    },
    "Enduring Enchantments": {
        theme: "Abzan Enchantress & Graveyard Return",
        strategy: "Weave an impenetrable web of defensive and taxing enchantments, bringing them repeatedly back from the graveyard to grind opponents into dust."
    },
    "Planeswalker Party": {
        theme: "Superfriends & Planeswalker Loyalty",
        strategy: "Assemble a council of Planeswalkers behind a defensive pillowfort, proliferating loyalty counters until their ultimate emblems end the game."
    },
    "Sliver Swarm": {
        theme: "Sliver Tribal & Shared Hivemind",
        strategy: "Every Sliver shares its abilities with all other Slivers. Grow a terrifying hivemind of flying, indestructible, double-striking horrors."
    },

    // March of the Machine
    "Divine Convocation": {
        theme: "Tokens & Convoke",
        strategy: "Amass a sprawling army of tokens and tap them with Convoke to cast colossal spells ahead of curve and overpower the board."
    },
    "Call for Backup": {
        theme: "+1/+1 Counters & Backup Triggers",
        strategy: "Buff your creatures with the Backup mechanic, temporarily transferring flying, trample, and double strike to launch explosive surprise attacks."
    },
    "Cavalry Charge": {
        theme: "Knight Tribal & Eminence Reanimation",
        strategy: "Charge into battle with an aggressive Knight squad, looting through your deck and resurrecting fallen knights directly to the combat step."
    },
    "Growing Threat": {
        theme: "Phyrexian Incubate & Artifact Aggro",
        strategy: "Incubate massive Phyrexian artifact eggs with +1/+1 counters, transforming them into lethal mechanical beasts at the ideal tactical moment."
    },
    "Tinker Time": {
        theme: "Artifact Token Variety & Gremlins",
        strategy: "Create an eclectic hoard of different artifact tokens—Treasures, Clues, Foods, and Blood—transforming variety into gigantic Gremlin beatsticks."
    },

    // Phyrexia: All Will Be One
    "Corrupting Influence": {
        theme: "Toxic, Poison & Corrupted",
        strategy: "Infect opponents with early poison counters to activate Corrupted bonuses, slowly proliferating their poison count until all ten counters eliminate them."
    },
    "Rebellion Rising": {
        theme: "Token Aggro & Extra Combat",
        strategy: "Equip and mobilize an army of Mirran rebel tokens, attacking relentlessly to trigger extra combat steps and overrun Phyrexian invaders."
    },

    // Warhammer 40,000
    "Forces of the Imperium": {
        theme: "Astartes Squad & Board Control",
        strategy: "Deploy heavily armed Space Marines with the Squad mechanic, duplicating your soldiers and grinding down foes under imperial artillery."
    },
    "Necron Dynasties": {
        theme: "Artifact Reanimation & Mill",
        strategy: "Awaken an immortal army of metal Necrons from your graveyard. Mill cards aggressively and reanimate metallic warmachines back to reality."
    },
    "The Ruinous Powers": {
        theme: "Chaos Cascade & Demon Mayhem",
        strategy: "Surrender to Chaos with high-variance cascade spells, unleashing demonic warpstorms and turning opponents' suffering into raw battlefield power."
    },
    "Tyranid Swarm": {
        theme: "X-Cost Spells & Ravenous Beasts",
        strategy: "Sink oceans of ramped mana into colossal X-cost Tyranid monsters with Ravenous, drawing whole hands of cards as massive bio-titans hit the board."
    }
};

// Generic smart fallback generator based on commander text / colors / types
function generateFallbackThemeAndStrategy(p) {
    const name = p.name || '';
    const cmdr = p.commander || '';
    const colors = p.colors || [];
    const type = (p.type || '').toLowerCase();
    
    // Check keywords in deck name
    const n = name.toLowerCase();
    if (n.includes('dragon')) return { theme: "Dragon Tribal & High-Flying Burn", strategy: "Ramp into massive flying Dragons that dominate the skies and rain destructive breath weapon fire upon your enemies." };
    if (n.includes('vampire')) return { theme: "Vampire Tribal & Blood Drain", strategy: "Drain the life essence of your foes while bolstering your own, converting aristocrat sacrifices into battlefield superiority." };
    if (n.includes('zombie')) return { theme: "Zombie Horde & Graveyard Swarm", strategy: "Raise endless hordes of rotting undead from the graveyard, overwhelming defenses through sheer, unstoppable attrition." };
    if (n.includes('elf') || n.includes('elves')) return { theme: "Elf Tribal & Mana Acceleration", strategy: "Swarm the battlefield with cheap mana elves, tap them for enormous mana pools, and cast game-ending Overrun effects." };
    if (n.includes('artifact') || n.includes('forge') || n.includes('machine')) return { theme: "Artifact Synergy & Construct Ramp", strategy: "Assemble complex mechanical engines and assemble an armada of powerful constructs to out-value and out-muscle the table." };
    if (n.includes('spell') || n.includes('arcane') || n.includes('storm')) return { theme: "Spellslinger & Instant-Speed Velocity", strategy: "Cast a rapid flurry of cheap spells each turn to draw cards, control threats, and trigger powerful spell-harmonizing payoffs." };
    if (n.includes('land') || n.includes('nature') || n.includes('wild')) return { theme: "Landfall & Explosive Ramp", strategy: "Drop extra lands every turn to trigger exponential Landfall abilities, ramping into titanic game-finishing threats." };

    // Default based on colors
    const cStr = colors.slice().sort().join('');
    let theme = "Commander Synergy & Value";
    let strategy = `Pilot ${cmdr} with focused synergies, leveraging color advantages to build a dominating board state and secure victory.`;

    if (colors.length === 1) {
        if (colors[0] === 'W') { theme = "White Weenie & Protective Anthem"; strategy = "Deploy resilient creatures with anthem buffs, tax opponents' moves, and safeguard your army with indestructible protection."; }
        else if (colors[0] === 'U') { theme = "Control & Card Draw"; strategy = "Counter dangerous threats, draw through your deck, and outwit opponents with elusive sea beasts and card advantage."; }
        else if (colors[0] === 'B') { theme = "Graveyard Reanimation & Life Drain"; strategy = "Sacrifice your minions for power, dredge through your graveyard, and force opponents to pay in life and discarded cards."; }
        else if (colors[0] === 'R') { theme = "Aggro & Direct Burn"; strategy = "Strike fast and hard with hasty creatures, impulsive card draw, and explosive direct-damage spells to finish off damaged foes."; }
        else if (colors[0] === 'G') { theme = "Stompy & Big Mana Ramp"; strategy = "Ramp out massive forests and lands to cast gigantic trampling apex predators that simply stomp through enemy defenses."; }
    } else if (colors.length >= 2) {
        if (colors.includes('U') && colors.includes('R')) {
            theme = "Spellslinger & Flashy Instants";
            strategy = "Chain spells together to draw cards, burn targets, and generate token armies from your spell casts.";
        } else if (colors.includes('B') && colors.includes('G')) {
            theme = "Graveyard Scavenge & Morbid Rebirth";
            strategy = "Turn death into your greatest weapon by filling the graveyard and returning titanic horrors directly to the battlefield.";
        } else if (colors.includes('G') && colors.includes('W')) {
            theme = "Go-Wide Tokens & +1/+1 Buffs";
            strategy = "Fill your board with creature tokens, stack anthem buffs and +1/+1 counters, and overrun your opponents in a grand charge.";
        } else if (colors.includes('B') && colors.includes('W')) {
            theme = "Aristocrats, Sacrifice & Drain";
            strategy = "Bleed your opponents for every death, extorting life totals and bringing back key pieces from beyond the grave.";
        } else if (colors.includes('U') && colors.includes('G')) {
            theme = "Ramp, Card Draw & Big Monsters";
            strategy = "Combine unchecked land ramp with deep card draw to drown your opponents in an ocean of colossal threats.";
        } else if (colors.includes('R') && colors.includes('G')) {
            theme = "Aggressive Stompy & Trample";
            strategy = "Accelerate your mana and slam ferocious, trampling monsters onto the board to smash through opposing blockers.";
        }
    }

    return { theme, strategy };
}

let enrichedCount = 0;
for (const p of precons) {
    if (specificMeta[p.name]) {
        p.theme = specificMeta[p.name].theme;
        p.strategy = specificMeta[p.name].strategy;
        enrichedCount++;
    } else {
        const fallback = generateFallbackThemeAndStrategy(p);
        p.theme = fallback.theme;
        p.strategy = fallback.strategy;
        enrichedCount++;
    }
}

fs.writeFileSync(PRECONS_FILE, JSON.stringify(precons, null, 2), 'utf8');
console.log(`✅ Successfully enriched all ${enrichedCount} precons with theme and strategy in ${PRECONS_FILE}!`);
