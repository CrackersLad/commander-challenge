const fs = require('fs');
const path = require('path');

const FORGE_ENGINE_DIR = path.join(__dirname, 'public', 'forge-engine');

function generateIndexLists(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const listing = entries
        .filter(e => e.name !== 'index.list')
        .map(e => e.isDirectory() ? `${e.name}/` : e.name)
        .join('\n') + '\n';

    const indexFilePath = path.join(dir, 'index.list');
    fs.writeFileSync(indexFilePath, listing, 'utf-8');
    console.log(`Generated index.list in: ${path.relative(__dirname, dir)} (${entries.length} items)`);

    for (const e of entries) {
        if (e.isDirectory()) {
            generateIndexLists(path.join(dir, e.name));
        }
    }
}

console.log('Generating index.list files for CheerpJ...');
generateIndexLists(path.join(FORGE_ENGINE_DIR, 'res'));
console.log('Done!');
