const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, 'package.json');
const packageJson = require(packageJsonPath);

const version = packageJson.version || '0.0';
const [major, minor] = version.split('.').map(Number);

let newVersion;
const args = process.argv.slice(2);
if (args.includes('major')) {
    newVersion = `${major + 1}.0`;
} else {
    newVersion = `${major}.${minor + 1}`;
}

packageJson.version = newVersion;

fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

console.log(`Version bumped to ${newVersion}`);

const indexPath = path.join(__dirname, '..', 'public', 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');
indexHtml = indexHtml.replace(/(styles\.css\?v=)[^"']+/g, `$1${newVersion}`);
indexHtml = indexHtml.replace(/(script\.js\?v=)[^"']+/g, `$1${newVersion}`);
indexHtml = indexHtml.replace(/(\.js\?v=)[^"']+/g, `$1${newVersion}`);
indexHtml = indexHtml.replace(/(<span id="appVersion">v?)[^<]+(<\/span>)/g, `$1${newVersion}$2`);
fs.writeFileSync(indexPath, indexHtml);

console.log(`Updated version in index.html to ${newVersion}`);

const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
    const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.js'));
    for (const file of files) {
        const filePath = path.join(publicDir, file);
        let fileContent = fs.readFileSync(filePath, 'utf8');
        if (fileContent.match(/(\.js\?v=)\d+\.\d+/)) {
            fileContent = fileContent.replace(/(\.js\?v=)\d+\.\d+/g, `$1${newVersion}`);
            fs.writeFileSync(filePath, fileContent);
            console.log(`Updated module imports in ${file} to ${newVersion}`);
        }
    }
}

const swPath = path.join(__dirname, '..', 'public', 'service-worker.js');
if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, 'utf8');
    swContent = swContent.replace(/(CACHE_NAME\s*=\s*['"]cmdr-draft-cache-v)[^'"]+(['"])/, `$1${newVersion}$2`);
    fs.writeFileSync(swPath, swContent);
    console.log(`Updated CACHE_NAME in service-worker.js to cmdr-draft-cache-v${newVersion}`);
}

console.log('✅ Web build and version bump complete.');
