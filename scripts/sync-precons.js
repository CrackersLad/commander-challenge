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

            // Construct standardized decklist string
            const lines = ['// Commander'];
            for (const cmdr of (data.commander || [commanderCard])) {
                lines.push(`${cmdr.count || 1} ${cmdr.name}`);
            }

            lines.push('\n// Mainboard');
            let mainboardCount = 0;
            if (Array.isArray(data.mainBoard)) {
                for (const card of data.mainBoard) {
                    const count = card.count || 1;
                    lines.push(`${count} ${card.name}`);
                    mainboardCount += count;
                }
            }

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
