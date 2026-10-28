# Commander Arena v1 Backup

This directory contains the complete snapshot of the v1 Commander Battle Arena before the v2 Card-Forge Native Rules Engine rewrite:

- `commander-arena.v1.js` — Original v1 UI controller and interactions
- `commander-arena.v1.css` — Original v1 Arena stylesheet
- `forge-adapter.v1.js` — Original v1 CheerpJ / Forge bridge adapter
- `commander-engine.v1.js` — Original v1 fallback simulation engine

## How to Restore v1 (If Needed)
Copy these 4 files back into `public/`:
```powershell
Copy-Item "public/arena-v1-backup/commander-arena.v1.js" "public/commander-arena.js" -Force
Copy-Item "public/arena-v1-backup/commander-arena.v1.css" "public/commander-arena.css" -Force
Copy-Item "public/arena-v1-backup/forge-adapter.v1.js" "public/forge-adapter.js" -Force
Copy-Item "public/arena-v1-backup/commander-engine.v1.js" "public/commander-engine.js" -Force
```

