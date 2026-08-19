export function initDeckBuilderModule(utils, state) {
    const { sanitizeHTML, playSound } = utils;

    window.renderDeckBuilder = (cards, container) => {
        let currentSort = 'color';
        let sortedCards = [...cards];

        const sortCards = () => {
            const colorOrder = { 'W': 1, 'U': 2, 'B': 3, 'R': 4, 'G': 5, 'C': 6 };
            const typeOrder = {
                'Creature': 1, 'Planeswalker': 2, 'Battle': 3, 'Instant': 4, 'Sorcery': 5,
                'Artifact': 6, 'Enchantment': 7, 'Land': 8
            };

            sortedCards.sort((a, b) => {
                if (currentSort === 'color') {
                    const aColor = a.color_identity.length === 0 ? 'C' : a.color_identity[0];
                    const bColor = b.color_identity.length === 0 ? 'C' : b.color_identity[0];
                    if (colorOrder[aColor] !== colorOrder[bColor]) {
                        return colorOrder[aColor] - colorOrder[bColor];
                    }
                    return a.cmc - b.cmc;
                }
                if (currentSort === 'cmc') {
                    if (a.cmc !== b.cmc) return a.cmc - b.cmc;
                    return a.name.localeCompare(b.name);
                }
                if (currentSort === 'type') {
                    const aType = a.type_line.split(' — ')[0];
                    const bType = b.type_line.split(' — ')[0];
                    const aOrder = Object.keys(typeOrder).find(t => aType.includes(t)) || 'Other';
                    const bOrder = Object.keys(typeOrder).find(t => bType.includes(t)) || 'Other';
                    if (typeOrder[aOrder] !== typeOrder[bOrder]) {
                        return (typeOrder[aOrder] || 99) - (typeOrder[bOrder] || 99);
                    }
                    return a.name.localeCompare(b.name);
                }
                return a.name.localeCompare(b.name); // Default to name
            });
        };

        const render = () => {
            sortCards();
            let html = `
                <div style="width:100%; text-align:center; margin-bottom: 20px;">
                    <h2 style="color:var(--gold); font-family:Cinzel;">Draft Complete!</h2>
                    <p style="color:#aaa;">Here is your drafted card pool. Build your deck!</p>
                    <div id="deckBuilderSortControls" style="display:flex; justify-content:center; gap:10px; margin-top:15px; flex-wrap:wrap;">
                        <button class="secondary-btn sort-btn ${currentSort === 'color' ? 'active' : ''}" data-sort="color">Sort by Color</button>
                        <button class="secondary-btn sort-btn ${currentSort === 'cmc' ? 'active' : ''}" data-sort="cmc">Sort by Cost</button>
                        <button class="secondary-btn sort-btn ${currentSort === 'type' ? 'active' : ''}" data-sort="type">Sort by Type</button>
                        <button class="secondary-btn sort-btn ${currentSort === 'name' ? 'active' : ''}" data-sort="name">Sort by Name</button>
                    </div>
                </div>
                <div id="deckBuilderGrid" style="display:flex; flex-wrap:wrap; justify-content:center; gap:10px; width:100%;">
            `;

            sortedCards.forEach(card => {
                let img = card.image_uris?.normal || (card.card_faces && card.card_faces[0].image_uris?.normal);
                const safeName = sanitizeHTML(card.name);

                html += `
                    <div class="option-card revealed" style="width:180px; padding:10px; transition:none; transform:none; opacity:1;">
                        <a href="${card.scryfall_uri}" target="_blank" title="View on Scryfall">
                            <img src="${sanitizeHTML(img)}" class="commander-img" style="margin-top:0;" loading="lazy">
                        </a>
                    </div>
                `;
            });

            html += `</div>`;
            container.innerHTML = html;

            document.querySelectorAll('.sort-btn').forEach(btn => {
                btn.onclick = (e) => {
                    playSound('sfx-click');
                    currentSort = e.target.dataset.sort;
                    render();
                };
            });
        };

        render();
    };
}