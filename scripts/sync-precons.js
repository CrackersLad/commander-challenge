const fs = require('fs');
const path = require('path');

const PRECONS_FILE = path.join(__dirname, '..', 'public', 'commander-precons.json');

async function fetchJSON(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'CommanderChallenge-PreconSync/1.0' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
}

function normalizeName(name) {
    return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatCardImage(scryfallId) {
    if (!scryfallId) return null;
    const f1 = scryfallId[0];
    const f2 = scryfallId[1];
    return `https://cards.scryfall.io/normal/front/${f1}/${f2}/${scryfallId}.jpg`;
}

function generateThemeAndStrategy(name, commander, colors, type) {
    const n = (name || '').toLowerCase();
    if (n.includes('dragon')) return { theme: "Dragon Tribal & High-Flying Burn", strategy: "Ramp into massive flying Dragons that dominate the skies and rain destructive breath weapon fire upon your enemies." };
    if (n.includes('vampire')) return { theme: "Vampire Tribal & Blood Drain", strategy: "Drain the life essence of your foes while bolstering your own, converting aristocrat sacrifices into battlefield superiority." };
    if (n.includes('zombie')) return { theme: "Zombie Horde & Graveyard Swarm", strategy: "Raise endless hordes of rotting undead from the graveyard, overwhelming defenses through sheer, unstoppable attrition." };
    if (n.includes('elf') || n.includes('elves')) return { theme: "Elf Tribal & Mana Acceleration", strategy: "Swarm the battlefield with cheap mana elves, tap them for enormous mana pools, and cast game-ending Overrun effects." };
    if (n.includes('artifact') || n.includes('forge') || n.includes('machine')) return { theme: "Artifact Synergy & Construct Ramp", strategy: "Assemble complex mechanical engines and an armada of powerful constructs to out-value and out-muscle the table." };
    if (n.includes('spell') || n.includes('arcane') || n.includes('storm')) return { theme: "Spellslinger & Instant-Speed Velocity", strategy: "Cast a rapid flurry of cheap spells each turn to draw cards, control threats, and trigger powerful spell-harmonizing payoffs." };
    if (n.includes('land') || n.includes('nature') || n.includes('wild')) return { theme: "Landfall & Explosive Ramp", strategy: "Drop extra lands every turn to trigger exponential Landfall abilities, ramping into titanic game-finishing threats." };

    let theme = "Commander Synergy & Strategy";
    let strategy = `Pilot ${commander} with focused deck synergies, leveraging color advantages to build an overwhelming board state.`;

    if (colors && colors.length >= 2) {
        if (colors.includes('U') && colors.includes('R')) { theme = "Spellslinger & Flashy Instants"; strategy = "Chain spells together to draw cards, burn targets, and generate token armies from your spell casts."; }
        else if (colors.includes('B') && colors.includes('G')) { theme = "Graveyard Scavenge & Morbid Rebirth"; strategy = "Turn death into your greatest weapon by filling the graveyard and returning titanic horrors directly to the battlefield."; }
        else if (colors.includes('G') && colors.includes('W')) { theme = "Go-Wide Tokens & +1/+1 Buffs"; strategy = "Fill your board with creature tokens, stack anthem buffs and +1/+1 counters, and overrun your opponents in a grand charge."; }
        else if (colors.includes('B') && colors.includes('W')) { theme = "Aristocrats, Sacrifice & Drain"; strategy = "Bleed your opponents for every death, extorting life totals and bringing back key pieces from beyond the grave."; }
        else if (colors.includes('U') && colors.includes('G')) { theme = "Ramp, Card Draw & Big Monsters"; strategy = "Combine unchecked land ramp with deep card draw to drown your opponents in an ocean of colossal threats."; }
        else if (colors.includes('R') && colors.includes('G')) { theme = "Aggressive Stompy & Trample"; strategy = "Accelerate your mana and slam ferocious, trampling monsters onto the board to smash through opposing blockers."; }
    }
    return { theme, strategy };
}

async function syncPrecons() {
    console.log('🔄 Checking for new MTG Commander Precons...');
    
    let existingPrecons = [];
    if (fs.existsSync(PRECONS_FILE)) {
        try {
            existingPrecons = JSON.parse(fs.readFileSync(PRECONS_FILE, 'utf8'));
        } catch (e) {
            console.warn('⚠️ Could not parse existing precons, starting fresh:', e.message);
        }
    }
    
    console.log(`📦 Currently tracking ${existingPrecons.length} precons.`);

    const existingMap = new Map();
    for (const p of existingPrecons) {
        existingMap.set(normalizeName(p.name), p);
    }

    console.log('🌐 Fetching DeckList from MTGJSON...');
    const deckListResp = await fetchJSON('https://mtgjson.com/api/v5/DeckList.json');
    const allDecks = deckListResp.data || [];

    // Filter for official Commander Decks (exclude Collector editions which are duplicates)
    const cmdrDecks = allDecks.filter(d => 
        d.type === 'Commander Deck' && 
        !d.name.includes("Collector's") &&
        !d.name.includes("Collector’s") &&
        !d.name.includes("Collector Edition")
    );

    console.log(`📋 Found ${cmdrDecks.length} Commander Decks on MTGJSON.`);

    let addedCount = 0;
    const newPrecons = [];

    for (const deck of cmdrDecks) {
        const key = normalizeName(deck.name);
        if (existingMap.has(key)) {
            continue;
        }

        console.log(`✨ Found new precon: "${deck.name}" (${deck.code}) [${deck.releaseDate}]`);
        try {
            const deckDetailResp = await fetchJSON(`https://mtgjson.com/api/v5/decks/${deck.fileName}.json`);
            const data = deckDetailResp.data;
            if (!data) continue;

            const commanderCard = (data.commander && data.commander[0]) || 
                                  (data.displayCommander && data.displayCommander[0]) || 
                                  null;

            if (!commanderCard) {
                console.warn(`  ⚠️ No commander found for "${deck.name}". Skipping.`);
                continue;
            }

            const scryfallId = commanderCard.identifiers?.scryfallId || null;
            const image = formatCardImage(scryfallId);

            // Construct standardized decklist string with exact printing and art
            const lines = ['// Commander'];
            const commanders = (data.commander && data.commander.length > 0)
                ? data.commander
                : (data.displayCommander || [commanderCard]);

            for (const cmdr of commanders) {
                const count = cmdr.count || 1;
                const setPart = cmdr.setCode ? ` (${cmdr.setCode.toUpperCase()})` : '';
                const numPart = cmdr.number ? ` ${cmdr.number}` : '';
                const foilPart = cmdr.isFoil ? ' *F*' : '';
                lines.push(`${count} ${cmdr.name}${setPart}${numPart}${foilPart}`);
            }

            lines.push('\n// Mainboard');
            let mainboardCount = 0;
            if (Array.isArray(data.mainBoard)) {
                for (const card of data.mainBoard) {
                    const count = card.count || 1;
                    const setPart = card.setCode ? ` (${card.setCode.toUpperCase()})` : '';
                    const numPart = card.number ? ` ${card.number}` : '';
                    const foilPart = card.isFoil ? ' *F*' : '';
                    lines.push(`${count} ${card.name}${setPart}${numPart}${foilPart}`);
                    mainboardCount += count;
                }
            }

            const { theme, strategy } = generateThemeAndStrategy(
                data.name || deck.name,
                commanderCard.name,
                commanderCard.colors || commanderCard.colorIdentity || [],
                commanderCard.type || commanderCard.originalType || ''
            );

            const preconEntry = {
                name: data.name || deck.name,
                code: data.code || deck.code,
                releaseDate: data.releaseDate || deck.releaseDate || '',
                commander: commanderCard.name,
                scryfallId: scryfallId,
                image: image,
                colors: commanderCard.colors || commanderCard.colorIdentity || [],
                manaCost: commanderCard.manaCost || '',
                type: commanderCard.type || commanderCard.originalType || '',
                theme: theme,
                strategy: strategy,
                source: data.source || deck.source || '',
                cardCount: (data.commander?.length || 1) + mainboardCount,
                decklist: lines.join('\n')
            };

            newPrecons.push(preconEntry);
            existingMap.set(key, preconEntry);
            addedCount++;
            console.log(`  ✅ Added "${deck.name}" (Commander: ${commanderCard.name})`);
            
            // Respectful delay for MTGJSON CDN
            await new Promise(r => setTimeout(r, 200));
        } catch (err) {
            console.error(`  ❌ Failed to fetch "${deck.name}":`, err.message);
        }
    }

    if (addedCount > 0) {
        const mergedList = [...existingPrecons, ...newPrecons];
        // Sort descending by releaseDate, then alphabetically by name
        mergedList.sort((a, b) => {
            const dateA = a.releaseDate || '0000-00-00';
            const dateB = b.releaseDate || '0000-00-00';
            if (dateA !== dateB) return dateB.localeCompare(dateA);
            return a.name.localeCompare(b.name);
        });

        fs.writeFileSync(PRECONS_FILE, JSON.stringify(mergedList, null, 2), 'utf8');
        console.log(`\n🎉 Successfully synced ${addedCount} new precons! Total: ${mergedList.length}`);
        return { changed: true, added: addedCount, total: mergedList.length };
    } else {
        console.log('\n👍 All precons are already up to date. No changes needed.');
        return { changed: false, added: 0, total: existingPrecons.length };
    }
}

if (require.main === module) {
    syncPrecons().catch(err => {
        console.error('Fatal error during precon sync:', err);
        process.exit(1);
    });
}

module.exports = { syncPrecons };
