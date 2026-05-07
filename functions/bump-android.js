const fs = require('fs');
const path = require('path');

const gradlePath = path.join(__dirname, '../android/app/build.gradle');

if (fs.existsSync(gradlePath)) {
    let gradleContent = fs.readFileSync(gradlePath, 'utf8');
    
    // Find versionCode XX and increment it
    gradleContent = gradleContent.replace(/versionCode\s+(\d+)/, (match, currentVersion) => {
        const newVersion = parseInt(currentVersion, 10) + 1;
        console.log(`🚀 Bumped Android versionCode to ${newVersion}`);
        return `versionCode ${newVersion}`;
    });

    fs.writeFileSync(gradlePath, gradleContent, 'utf8');
} else {
    console.warn('⚠️ android/app/build.gradle not found. Skipping Android version bump.');
}