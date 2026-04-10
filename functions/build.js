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
