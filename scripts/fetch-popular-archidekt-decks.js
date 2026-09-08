const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'archidekt-popular-decks.json');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTopDeckMetadata() {
    console.log('[ARCHIDEKT] Fetching top viewed Commander decks list...');
    // Fetch top 60 to filter out precon accounts
    const url = 'https://archidekt.com/api/decks/v3/?orderBy=-viewCount&pageSize=60&formats=3';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (MTG Commander Draft Challenge)' } });
    if (!res.ok) throw new Error(`Archidekt list HTTP ${res.status}`);
    const data = await res.json();
    const results = data.results || [];

    // Filter out precon publishers to focus on community decks
    const communityDecks = results.filter(d => {
        const owner = (d.owner?.username || '').toLowerCase();
        const name = (d.name || '').toLowerCase();
        if (owner.includes('precon') || owner === 'archidekt_precons') return false;
        if (name.includes('commander deck') && (name.includes('commander 20') || name.includes('precon'))) return false;
        return true;
    });

    console.log(`[ARCHIDEKT] Found ${communityDecks.length} top community decks out of ${results.length}.`);
    return communityDecks.slice(0, 25); // Take top 25
}

async function fetchFullDeck(deckMeta) {
    const url = `https://archidekt.com/api/decks/${deckMeta.id}/`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (MTG Commander Draft Challenge)' } });
        if (!res.ok) {
            console.warn(`[WARN] Deck ${deckMeta.id} HTTP ${res.status}`);
            return null;
        }
        const data = await res.json();
        
        // Find commander
        const commanderCards = (data.cards || []).filter(c => Array.isArray(c.categories) && c.categories.includes('Commander'));
        const commanderName = commanderCards[0]?.card?.oracleCard?.name || commanderCards[0]?.card?.name || 'Commander';
        const commanderColors = commanderCards[0]?.card?.oracleCard?.colors || commanderCards[0]?.card?.colors || [];

        // Build card list (excluding maybeboard/sideboard)
        const mainCards = (data.cards || []).filter(c => {
            const cats = c.categories || [];
            return !cats.includes('Maybeboard') && !cats.includes('Sideboard');
        });

        const cards = mainCards.map(c => {
            const name = c.card?.oracleCard?.name || c.card?.name || '';
            const qty = Number(c.quantity || 1);
            const type = c.card?.oracleCard?.typeLine || c.card?.typeLine || 'Card';
            const price = Number(c.card?.prices?.tcg?.normal || c.card?.prices?.ck?.normal || 0.75);
            return {
                name,
                quantity: qty,
                type,
                price
            };
        }).filter(c => c.name.length > 0);

        // Decklist text
        const decklistLines = [`// Commander\n1 ${commanderName}\n\n// Mainboard`];
        cards.forEach(c => {
            if (c.name !== commanderName) {
                decklistLines.push(`${c.quantity} ${c.name}`);
            }
        });
        const decklistText = decklistLines.join('\n');

        const featuredImg = data.featured || `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(commanderName)}&format=image&version=art_crop`;

        return {
            id: `archidekt-${data.id}`,
            name: data.name,
            commander: commanderName,
            type: 'community',
            platform: 'archidekt',
            creator: data.owner?.username || 'Community Deckbuilder',
            views: data.viewCount || deckMeta.viewCount || 0,
            colors: commanderColors,
            imageUrl: featuredImg,
            sourceUrl: `https://archidekt.com/decks/${data.id}`,
            theme: `Top Rated by ${data.owner?.username || 'Community'} (${(data.viewCount || 0).toLocaleString()} views)`,
            strategy: data.description ? data.description.slice(0, 180) + '...' : `Highly popular ${commanderName} Commander deck on Archidekt with ${(data.viewCount || 0).toLocaleString()} views.`,
            cardCount: cards.reduce((acc, c) => acc + c.quantity, 0),
            decklist: decklistText,
            cards
        };
    } catch (e) {
        console.error(`[ERROR] Deck ${deckMeta.id}:`, e.message);
        return null;
    }
}

async function main() {
    const list = await fetchTopDeckMetadata();
    const finalDecks = [];

    for (let i = 0; i < list.length; i++) {
        const meta = list[i];
        console.log(`[${i + 1}/${list.length}] Fetching "${meta.name}" (ID: ${meta.id}, Views: ${meta.viewCount})...`);
        const deck = await fetchFullDeck(meta);
        if (deck && deck.cards && deck.cards.length >= 60) {
            finalDecks.push(deck);
            console.log(`  -> Added "${deck.name}" (${deck.cardCount} cards, Commander: ${deck.commander})`);
        }
        await sleep(350); // Polite rate limit
    }

    console.log(`[COMPLETE] Writing ${finalDecks.length} community decks to ${OUTPUT_FILE}...`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalDecks, null, 2));
    console.log('[DONE] Successfully generated archidekt-popular-decks.json');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
