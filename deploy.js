const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// The root directory is the current directory where the script is located.
const rootDir = __dirname;

// --- 1. Parse Command Line Arguments ---
const args = process.argv.slice(2);
const isMajor = args.includes('--major');
const skipBump = args.includes('--skip-bump') || args.includes('--current-version');
// Filter out the flags to isolate the notes
const notes = args.filter(arg => !['--major', '--skip-bump', '--current-version'].includes(arg)).join(' ');

if (!notes) {
    console.error('\n❌ Error: Please provide release notes for the commit.');
    console.error('   Example: npm run deploy -- "Your release notes go here"');
    process.exit(1);
}

const versionType = isMajor ? 'major' : 'minor';

try {
    console.log('▶️  Starting deployment process...');

    // --- 2. Run Version Bump ---
    if (!skipBump) {
        console.log(`\n🔄 Bumping ${versionType} version...`);
        execSync(`npm run version${isMajor ? ':major' : ''}`, { stdio: 'inherit', cwd: rootDir });
    } else {
        console.log('\n⏩ Skipping version bump (keeping current version)...');
    }

    // --- 3. Read the new version number from the bumped package.json ---
    const packageJsonPath = path.join(rootDir, 'functions', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const newVersion = packageJson.version;
    console.log(`\nNew version is: v${newVersion}`);

    // --- 4. Construct Git Commit Command ---
    const commitSubject = `chore(release): v${newVersion}`;
    // Using multiple -m flags creates a multi-line commit message (subject + body)
    let commitCommand = `git commit -m "${commitSubject}"`;
    if (notes) {
        const escapedNotes = notes.replace(/"/g, '\\"');
        commitCommand += ` -m "${escapedNotes}"`;
    }

    // --- 5. Stage, Commit, and Push ---
    console.log('\n➕ Staging all changes...');
    execSync('git add .', { stdio: 'inherit', cwd: rootDir });

    console.log('\n📝 Committing changes...');
    execSync(commitCommand, { stdio: 'inherit', cwd: rootDir });

    console.log('\n⬆️  Pushing to GitHub...');
    execSync('git push', { stdio: 'inherit', cwd: rootDir });

    console.log(`\n\n✅ Success! Version ${newVersion} is pushed. The GitHub Action will now deploy.`);

} catch (error) {
    console.error('\n❌ Deployment script failed. Please review the error messages above.');
    process.exit(1); // Exit with an error code
}