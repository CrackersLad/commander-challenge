const https = require('https');

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function run() {
    const code = await fetchUrl('https://cdn.archidekt.com/_next/static/chunks/pages/_app-c750fadf843a1de8.js');
    const idx = code.indexOf('15029:');
    if (idx !== -1) {
        const modCode = code.slice(idx, idx + 25000);
        const wIdx = modCode.indexOf('W=');
        console.log('wIdx:', wIdx);
        if (wIdx !== -1) {
            console.log(modCode.slice(wIdx, wIdx + 3000));
        }
    }
}
run();
