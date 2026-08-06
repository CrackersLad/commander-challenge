# Deployment Cheatsheet

This document outlines the commands for versioning and deploying the application. The primary workflow is designed to be run from the root of the project.

---

## 🚀 Automated Deployment (Recommended)

This workflow automatically bumps versions, commits the changes with your notes, and pushes to GitHub. The push to the `main` branch then triggers an automatic deployment to Firebase via a GitHub Action.

### Minor Version Bump & Deploy

Use this command for regular updates, bug fixes, and small features. It will increment the minor version number (e.g., `20.1` becomes `20.2`).

**Command:**
```bash
npm run deploy -- "Your release notes go here. This part is required."
```

**What it does:**
1.  **Bumps Versions**:
    *   Increments the minor version in `functions/package.json`.
    *   Increments the `versionCode` in `android/app/build.gradle`.
    *   Updates the version query string (`?v=...`) in all relevant `.js` and `.html` files.
2.  **Commits to Git**:
    *   Stages all changed files (`git add .`).
    *   Creates a commit with a message like `chore(release): v20.2` and includes your notes in the commit body.
3.  **Pushes to GitHub**:
    *   Pushes the commit to your repository's `main` branch.
4.  **Triggers CI/CD**:
    *   The push to `main` automatically starts the "Deploy to Firebase" GitHub Action, which deploys the `hosting` and `functions` services to production.

### Major Version Bump & Deploy

Use this for significant updates or breaking changes. It will increment the major version and reset the minor version to 0 (e.g., `20.61` becomes `21.0`).

**Command:**
```bash
npm run deploy:major -- "This is a major update with a new UI and features."
```

**What it does:**
*   The process is identical to the minor deploy, but it performs a major version bump instead.