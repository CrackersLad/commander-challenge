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

(async () => {
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

        const commitHash = execSync('git rev-parse HEAD', { cwd: rootDir }).toString().trim();
        console.log(`\n✅ Successfully pushed commit ${commitHash.substring(0, 7)} (v${newVersion})`);
        console.log(`📡 Monitoring GitHub Action deployment to Firebase...`);

        // --- 6. Live Monitoring of GitHub Action ---
        let completed = false;
        let attempts = 0;
        const maxAttempts = 60; // 5 minutes max
        const repo = 'CrackersLad/commander-challenge';

        while (!completed && attempts < maxAttempts) {
            attempts++;
            await new Promise(r => setTimeout(r, 5000));
            try {
                const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=5`, {
                    headers: { 'User-Agent': 'commander-challenge-deploy' }
                });
                if (!res.ok) continue;
                const data = await res.json();
                const run = data.workflow_runs?.find(w => w.head_sha === commitHash);
                if (run) {
                    process.stdout.write(`\r⏳ Action Status: ${run.status} | Conclusion: ${run.conclusion || 'running'} (${attempts * 5}s elapsed)...`);
                    if (run.status === 'completed') {
                        completed = true;
                        if (run.conclusion === 'success') {
                            console.log(`\n\n🎉 GitHub Action #${run.id} SUCCEEDED! Version ${newVersion} is live on Firebase.`);
                        } else {
                            console.error(`\n\n❌ GitHub Action #${run.id} FAILED with conclusion: ${run.conclusion}`);
                            console.error(`   View details: ${run.html_url}`);
                            process.exit(1);
                        }
                    }
                } else {
                    process.stdout.write(`\r⏳ Waiting for GitHub Action workflow to start (${attempts * 5}s elapsed)...`);
                }
            } catch (e) {
                // Ignore transient network hiccups while polling
            }
        }

        if (!completed) {
            console.log(`\n⚠️ Polling timed out after 5 minutes, but the workflow is still running on GitHub.`);
        }

    } catch (error) {
        console.error('\n❌ Deployment script failed:', error.message || error);
        process.exit(1);
    }
})();