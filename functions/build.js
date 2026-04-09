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
indexHtml = indexHtml.replace(/(v)\d+\.\d+/g, `v${newVersion}`);
indexHtml = indexHtml.replace(/(script\.js\?v=)\d+\.\d+/g, `$1${newVersion}`);
fs.writeFileSync(indexPath, indexHtml);

console.log(`Updated version in index.html to ${newVersion}`);

const scriptPath = path.join(__dirname, '..', 'public', 'script.js');
if (fs.existsSync(scriptPath)) {
    let scriptJs = fs.readFileSync(scriptPath, 'utf8');
    scriptJs = scriptJs.replace(/(\.js\?v=)\d+\.\d+/g, `$1${newVersion}`);
    fs.writeFileSync(scriptPath, scriptJs);
    console.log(`Updated module imports in script.js to ${newVersion}`);
}
