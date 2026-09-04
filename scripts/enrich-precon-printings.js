const fs = require('fs');
const path = require('path');

const PRECONS_FILE = path.join(__dirname, '..', 'public', 'commander-precons.json');

async function fetchJSON(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'CommanderChallenge-PreconEnricher/1.0' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
}

function normalizeName(name) {
    return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function run() {
    console.log('📖 Reading existing precons...');
    const precons = JSON.parse(fs.readFileSync(PRECONS_FILE, 'utf8'));
    console.log(`Found ${precons.length} precons in ${PRECONS_FILE}`);

    console.log('🌐 Fetching DeckList from MTGJSON...');
    const dlResp = await fetchJSON('https://mtgjson.com/api/v5/DeckList.json');
    const allDecks = dlResp.data || [];

    const deckMap = new Map();
    for (const d of allDecks) {
        deckMap.set(normalizeName(d.name), d);
    }

    let updatedCount = 0;
    let failedCount = 0;

    // Process in batches of 6 concurrent requests
    const BATCH_SIZE = 6;
    for (let i = 0; i < precons.length; i += BATCH_SIZE) {
        const batch = precons.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (precon) => {
            const norm = normalizeName(precon.name);
            const deckInfo = deckMap.get(norm);
            if (!deckInfo) {
                console.warn(`⚠️ No MTGJSON deck found for "${precon.name}"`);
                failedCount++;
                return;
            }

            try {
                const detail = await fetchJSON(`https://mtgjson.com/api/v5/decks/${deckInfo.fileName}.json`);
                const data = detail.data;
                if (!data) return;

                const lines = ['// Commander'];
                const commanders = (data.commander && data.commander.length > 0) 
                    ? data.commander 
                    : (data.displayCommander || []);

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

                precon.cardCount = commanders.length + mainboardCount;
                precon.decklist = lines.join('\n');
                updatedCount++;
                console.log(`[${updatedCount}/${precons.length}] ✅ Enriched "${precon.name}" (${precon.cardCount} cards)`);
            } catch (err) {
                console.error(`❌ Failed to enrich "${precon.name}":`, err.message);
                failedCount++;
            }
        }));

        // Small delay between batches to be respectful to MTGJSON
        await new Promise(r => setTimeout(r, 150));
    }

    console.log(`\n🎉 Finished! Successfully updated ${updatedCount}/${precons.length} precons. (Failed: ${failedCount})`);
    fs.writeFileSync(PRECONS_FILE, JSON.stringify(precons, null, 2), 'utf8');
    console.log(`💾 Saved enriched decklists to ${PRECONS_FILE}`);
}

run().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
