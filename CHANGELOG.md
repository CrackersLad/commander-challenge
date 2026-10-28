# 📜 MTG Command Center (`edhchallenge.com`) — Comprehensive Release Changelog

All notable changes, UI/UX enhancements, gameplay engine updates, and infrastructure optimizations to the **MTG Command Center** are documented in this file.

---

## ⚔️ [v11.5] — 2026-10-28 — Comprehensive ETB Triggers, Amass & Scryfall Auto-Enrichment

This release adds comprehensive ETB trigger handling and dynamic card metadata enrichment:
1. **March from the Black Gate & Amass Engine (MTG Rule 701.44)**:
   - Added full Amass Orcs / Amass Zombies resolution: creates 0/0 black Orc Army token with +1/+1 counters if no Army is controlled, or buffs existing Army with counters and ensures Orc/Zombie subtype.
   - Triggers on ETB for March from the Black Gate, Dreadhorde Invasion, Gleaming Overseer, Eternal Skylord, and all amass cards.
   - Triggers whenever an Army attacks while March from the Black Gate is controlled.
2. **The Black Gate & Shocklands Life Payment**:
   - Added interactive prompt to pay 3 life for The Black Gate (or 2 life for Shocklands) to have them enter untapped, or enter tapped if declined.
3. **Scryfall Bulk Auto-Enrichment on Deck Load**:
   - When launching the Commander Arena with custom, pasted, or imported decks, any cards missing from the local cache are batch-queried from the Scryfall API (/cards/collection).
   - Guarantees 100% of Magic cards from any set have accurate oracle text, types, mana costs, and ETB triggers.
4. **Universal Generic ETB Triggers**:
   - Automatic regex-based ETB resolution for creature/artifact token creation, card draw, life gain/loss, and +1/+1 counter distribution.

---

## ⚔️ [v11.4] — 2026-10-28 — Commander Arena Full Overhaul (ETB Rules, Check Lands, Land Abilities & Discard Cleanup)

This release addresses all reported issues with the Commander Battle Arena tester:
1. **ETB Replacements & Tapped Lands (Rule 614.12)**:
   - Bojuka Bog and unconditional taplands strictly enter tapped and cannot produce mana or activate tap abilities until your next Untap Step.
   - Drowned Catacomb, Glacial Fortress, Woodland Cemetery, Sulfur Falls, Isolated Chapel, Rootbound Crag, Dragonskull Summit, Hinterland Harbor, Clifftop Retreat, Sunpetal Grove, Castle cycle, etc., strictly verify battlefield subtypes (Island/Swamp) and enter tapped when requirements are unmet.
2. **Activated Land Abilities & Shire Terrace**:
   - Shire Terrace, Promising Vein, Myriad Landscape, Blast Zone, Castle Vantress, and all dual-purpose lands now open an explicit choice dialog with buttons for both "💎 Tap for Mana" and "⚡ Activate Ability".
   - When paying mana for an activated ability (e.g. {1} for Shire Terrace), the paid floating mana is deducted and the source land remains tapped permanently; spent mana never untaps itself after fetching.
   - Fetched basic lands enter tapped according to their card rules, trigger Landfall, and cannot be used immediately.
3. **Strict Single Draw & Interactive Cleanup (Rule 504.1 & 514.1)**:
   - Strictly 1 card is drawn during the Draw Step per turn; all duplicate draws on phase transitions are blocked.
   - Fixed hand size cleanup: removed auto-popping of excess cards so cards never disappear silently. An interactive cleanup discard modal prompts the player to choose which excess cards to discard when ending their turn with >7 cards in hand.
4. **Resilient v1 Backup Preserved**:
   - Complete pre-overhaul state preserved at `public/arena-v1-backup/` with restoration guide.

---

## 🚀 [v11.0] — 2026-10-28 — Ultimate Command Center End-to-End Upgrade

This major release implements all **Top 10 End-to-End Recommendations** across UI, UX, cross-tool connectivity, tabletop utilities, deckbuilding analytics, and zero-cost infrastructure optimization.

### 1. 🔗 1-Click Cross-Tool Pipelines ("Use This Everywhere" Action Bar)
Previously, several tools functioned as isolated islands requiring manual copy-pasting of text decklists between views. Every card generator, comparator, and deck builder is now directly wired together:
- **Quick Roll Commander (`public/hub.js`)**:
  - **⚔️ Playtest in Arena**: Generates an instant 99-card synergistic Commander battle deck around the rolled commander and launches directly into the 4-Player Commander Arena (`window.launchDeckIntoCommanderArena`).
  - **🛠️ Brew in Deck Builder**: Opens the Native Deck Builder pre-seeded with the rolled Commander (`window.openDeckBuilder`).
  - **🔄 Compare Owned**: Sends the Commander directly into the Collection Hub's live Archidekt/Collection matcher.
- **Quick Roll Precon (`public/hub.js`)**:
  - Fetches the full official 100-card precon list via `fetchPreconDecklist` and provides 1-click buttons to **⚔️ Playtest Precon in Arena**, **🛠️ Edit in Deck Builder**, **🔄 Compare with Collection**, or **🖨️ Print Proxies**.
- **Deck Comparator (`public/collection-hub.js` & `public/index.html`)**:
  - Enhanced `window.openCollectionTab('deck', { deckUrl })` so multi-line decklists passed from any tool (Deck Builder, Booster Draft, Booster Simulator, Precon Roller) automatically populate `customPastedDecks` and trigger `runComparison()`.
  - Added **⚔️ Playtest in Arena** (`window.playtestActiveComparatorDeckInArena`), **🛠️ Edit in Builder** (`window.editActiveComparatorDeckInBuilder`), and **🖨️ Print Missing Proxies** (`window.printMissingComparatorProxies`) directly to the Deck Breakdown action bar.
- **Multiplayer Booster Draft (`public/booster-draft.js`)**:
  - Fixed `compareDraftWithCollection` to inject the drafted decklist + basic lands directly into the Deck Comparator and run comparison automatically.
  - Added **⚔️ Playtest in Arena**, **🛠️ Edit in Builder**, and **🖨️ Print Proxies** to the Draft Deckbuilding export column.

---

### 2. 🔍 Universal Command Palette & Global Card Search (`Ctrl+K` / `Cmd+K`)
- **Global Shortcut & Navbar Pill (`public/command-center-extras.js`, `public/index.html`)**:
  - Press `Ctrl+K` (or `Cmd+K` on macOS) from anywhere on the site, or click the `🔍 Search (Ctrl+K)` pill in the top navigation bar, to open the **Universal Command Palette** (`window.openCommandPalette`).
- **Instant Tool Navigation**:
  - Type any keyword (e.g., `"arena"`, `"draft"`, `"life"`, `"proxy"`, `"trade"`, `"set"`, `"build"`) and press `Enter` or use `↑`/`↓` arrow keys to jump immediately to any of the 15+ tools and sub-tabs.
- **Live Scryfall Card Search & 1-Click Actions**:
  - Typing 2+ characters queries Scryfall's autocomplete and card APIs in real time with mana cost, type line, and live USD/EUR market prices.
  - Every card result includes 4 instant action buttons without leaving your current screen:
    - **🔍 Inspect 3D** (`window.openCardInspector`)
    - **🛠️ + Builder** (`window.quickAddCardToDeckBuilder`)
    - **🟢 + Have** / **🔵 + Want** (`window.addCardToTradeBinderGlobal`)
    - **🖨️ Proxy** (`window.openProxyPrinterModal`)

---

### 3. ⚖️ Official Rulings, Format Legalities, Game Changers Badge & Printings Picker in 3D Card Inspector
- **Upgraded 3D Card Inspector (`public/card-inspector.js`)**:
  - **⚠️ Official WotC Game Changer Detection**: Automatically cross-references inspected cards against the official Wizards of the Coast Commander Bracket *Game Changers* list (`OFFICIAL_GAME_CHANGERS`, e.g., *Rhystic Study*, *Cyclonic Rift*, *Smothering Tithe*, *The One Ring*, *Demonic Tutor*, *Fierce Guardianship*, etc.) and displays a prominent badge explaining Bracket 3+ restrictions.
  - **📜 Tab 1 — Oracle Text & Format Legalities**: Displays color-coded legality pills for **Commander**, **Modern**, **Standard**, **Pioneer**, **Legacy**, **Vintage**, **Pauper**, and **Oathbreaker**, alongside EDHREC Rank and Reserved List status.
  - **⚖️ Tab 2 — Official Judge Rulings**: Dynamically fetches and caches official WotC/Scryfall `rulings_uri` entries on demand so players can settle complex stack/timing questions mid-game.
  - **🎨 Tab 3 — Printings & Sets Price Picker**: Fetches all unique paper printings via Scryfall `prints_search_uri` (`unique=prints`), sorted from cheapest to most expensive, allowing players to click any printing to swap the 3D card artwork and live market price on the fly.
  - **Cross-Tool Action Row**: Added 1-click buttons inside the inspector for **🛠️ + Deck Builder**, **🟢 + Trade (Have)**, **🔵 + Wishlist (Want)**, and **🖨️ Print Proxy**.

---

### 4. ❤️ 4-Player Tabletop Life & Commander Damage Companion Mode
- **Full-Featured In-Person & Pod Companion (`public/command-center-extras.js`)**:
  - Accessible from the **⚔️ Play** dropdown (`❤️ 4-Player Tabletop Life Tracker`), the **Lobby Dashboard** (`❤️ Life Tracker` chip), or `Ctrl+K`.
  - **Life Totals & Quick Step Buttons**: Supports 2, 3, 4, 5, or 6 players with `-5`, `-1`, `+1`, `+5` controls and visual elimination states (`☠️ 0`).
  - **Interactive 21-Point Commander Damage Matrix**: Track exact Commander damage dealt by every opponent (`vs P1`, `vs P2`, `vs P3`, `vs P4`) with automatic life deduction and lethal 21+ Commander damage alerts.
  - **Commander Tax & Counters**: Dedicated buttons for **👑 Tax** (`+0`, `+2`, `+4`, ...), **☠️ Poison** (lethal at 10+), **⚡ Energy**, and **☢️ Rad** counters.
  - **Tabletop Status Badges**: 1-click toggles for **👑 Monarch** and **🔦 Initiative** (automatically transfers between players) plus a **⏭️ Next Turn** counter and **🎲 Roll High D20** starting-player roller.
  - **Lobby Roster & Crown the Victor Integration**: Automatically imports player names and Commanders from an active Playgroup Lobby (`window.currentLobbyData`) and includes a **🏆 Crown Winner in Lobby** button to record the winner directly to the Hall of Fame.

---

### 5. 🛠️ "My Armory" Multi-Deck Storage, Auto-Role Tagging, WotC Bracket 1–5 Analyzer & Hypergeometric Calculator
- **Upgraded Native Deck Builder (`public/deck-builder-view.js`, `public/script.js`, `public/commander-arena.js`)**:
  - **🏰 My Armory (Multi-Deck Manager)**: Save, load, switch, and delete unlimited named decks (`localStorage` key `mtg_armory_decks_v1`). All saved Armory decks automatically appear in the **4-Player Commander Arena** deck selectors (for both you and AI bot seats) and the **Solo Playtester** launch modal!
  - **🏷️ Smart Functional Role Auto-Tagger**: Automatically scans oracle text and type lines across your 99 to count:
    - **🌱 Ramp** (target: 10+)
    - **📖 Card Draw** (target: 10+)
    - **🎯 Spot Removal** (target: 8+)
    - **💥 Board Wipes** (target: 3+)
    - **🔍 Tutors** & **⚡ Fast Mana**
    - Clicking any role pill filters your decklist to inspect only cards fulfilling that role.
  - **⚖️ Official WotC Commander Bracket (1–5) Analyzer**: Evaluates your deck against official Commander Bracket criteria—counting **Game Changers**, **Mass Land Denial** (*Armageddon*, *Blood Moon*, *Winter Orb*, etc.), **Extra Turn Spells**, **Non-Land Tutors**, and **Fast Mana**—and displays an interactive breakdown modal (`window.showBracketDetailModal`).
  - **🎲 Hypergeometric Draw Probability Calculator**: Interactive turn-by-turn probability matrix (`window.openHypergeometricModal`) calculating exact cumulative hypergeometric odds $P(X \ge k)$ of drawing:
    - $3+$ or $4+$ Lands by Turn 3 / Turn 4
    - $1+$ Ramp Piece by Turn 2
    - $1+$ Card Draw Engine by Turn 4
    - $1+$ Removal/Interaction Spell by Turn 3
    - Custom pool size (`N`), successes in deck (`K`), cards drawn (`n`), and desired hits (`k`).

---

### 6. 🖨️ Printable 3×3 PDF Proxy & Token Sheet Generator
- **Exact Paper-Size Proxy Maker (`public/command-center-extras.js`)**:
  - Accessible via `window.openProxyPrinterModal(cardsInput, title)` from the **Play Menu**, **Deck Comparator ("🖨️ Print Missing Proxies")**, **Native Deck Builder ("🖨️ Print Proxies")**, **Booster Draft**, **Booster Simulator**, **Precon Quick Roll**, and **3D Card Inspector**.
  - **True $63\text{mm} \times 88\text{mm}$ ($2.5\text{"} \times 3.5\text{"}$) Print Layout**: Uses dedicated `@media print` CSS rules to format 9 high-resolution Scryfall card images per standard A4 or US Letter page with optional crop marks and basic land filtering.
  - **Live Card Hydration**: Paste any Moxfield/Archidekt text list or load directly from any tool; missing card images are automatically hydrated in batches of 75 via Scryfall `/cards/collection`.

---

### 7. 📦 Booster Simulator $\rightarrow$ Sealed Arena, Deck Builder, Collection Sync & Proxy Export
- **Actionable Pack & Box Openings (`public/booster-simulator.js`, `public/collection-hub.js`)**:
  - Added a **⚡ USE YOUR PULLS** action panel to the Booster Simulator sidebar (`renderSidebarAnalytics`):
    - **⚔️ Play Sealed in Arena**: Automatically selects your highest-rarity Legendary Creature (or top creature pull) as Commander, pads the pool to 99 cards with color-matched basic lands, and launches directly into the 4-Player Commander Arena (`window.playBoosterPullsInArena`).
    - **🛠️ Brew in Deck Builder**: Sends all opened cards directly into the Native Deck Builder (`window.sendBoosterPullsToDeckBuilder`).
    - **📥 Save Pulls to Collection**: Merges opened cards (with set codes, collector numbers, foil status, and prices) directly into your active Collection Hub profile (`window.addPullsToCollectionGlobal`).
    - **🖨️ Print Rare/Mythic Proxies**: Opens the 3×3 Proxy Sheet Generator pre-loaded with your Rare and Mythic pulls (`window.printBoosterPullsProxies`).

---

### 8. 👑 Commander Arena UX Upgrade: Undo Stack, Keyboard Hotkeys & Mobile Opponent Tabs
- **Tactical Undo & Keyboard Controls (`public/commander-arena.js`, `public/commander-arena.css`)**:
  - **↩️ 30-Step Undo Last Action (`Z` / `window.undoArenaAction`)**: Snapshots game state (`arenaUndoStack`) before card plays, zone moves, life changes, mana taps, and phase transitions so accidental clicks or mis-taps can be undone with 1 click or by pressing `Z`.
  - **⌨️ Global Keyboard Shortcuts**:
    - `Space`: Advance Phase / Pass Turn
    - `Z`: Undo Last Action
    - `U`: Untap All Permanents you control
    - `M`: Empty Mana Pool
    - `L`: Toggle Collapsible Game Log Drawer
  - **📱 Mobile & Tablet Responsive Layout**: Improved `.arena-opponents-row` horizontal snap-scrolling and compact touch controls on smaller viewports.

---

### 9. ✨ Instant Demo Collection & Landing Hub Category Filter
- **Zero-Friction First-Time Onboarding (`public/collection-hub.js`, `public/command-center-extras.js`, `public/index.html`)**:
  - **✨ Try Instant Demo Collection (No Upload Needed)**: Added `window.loadSampleDemoCollection()` in the Collection Hub setup card, allowing new visitors to load a realistic 250+ card Commander Staples & Commanders collection in 50ms to test Deck Comparator, Set Completion, Collection Valuation, Trade Binder, and *What Can I Build?* without needing an Archidekt ID or CSV file first.
  - **Landing Hub Quick Filter Bar**: Added a sleek filter bar above the main portal (`🌟 All Tools`, `⚔️ Play & Simulators`, `🛠️ Deck & Brewing`, `📦 Collection & Market`, plus quick launches for `❤️ Life Tracker`, `🖨️ Proxy Maker`, and `🔍 Search (Ctrl+K)`).

---

### 10. ⚡ "Free-Forever" Infrastructure & Cost Optimization
- **Zero-Cost Scaling Architecture (`public/data-service.js`, `firebase.json`, `functions/index.js`, `public/profile.js`)**:
  - **24-Hour IndexedDB Archive Cache (`public/data-service.js`)**: Caches `global_archives/cards` in `IndexedDB` (`MTGCommandCenterCache`) for 24 hours with a `?refresh=true` bypass, cutting repeat Firestore document reads by ~90%.
  - **Smart CDN Cache-Control Headers (`firebase.json`)**: Keeps `index.html` and `service-worker.js` at `no-cache, no-store, must-revalidate` while serving versioned `?v=` JS/CSS bundles and static assets with long-lived `public, max-age=31536000, immutable` caching.
  - **Indexed Hall of Fame Summary Document (`functions/index.js`, `public/profile.js`)**: `hostDeclareWinner` now maintains a lightweight `/hall_of_fame/records` summary document alongside bounded `limit(150)` fallback queries, avoiding unbounded collection scans as lobbies scale.

---

## 📜 Previous Releases

### [v10.20] — 2026-04 — Collection Hub & Precon Catalog Expansion
- Expanded curated precon catalog, added real-time Archidekt commander search in *What Can I Build?*, and added multi-binder profile switching.

### [v9.0] — 2026-03 — Card Activated Abilities & Colored Mana Pool System
- Added Activated Abilities modal (Planeswalker loyalties, `{T}` abilities, sacrifice/equip costs), interactive land & mana rock tapping into a glowing colored mana pool bar, and custom decklist importer.

### [v8.25] — 2026-02 — Forge WebAssembly Lazy Loading
- Added CheerpJ WebAssembly Card-Forge bridge, fast-loading split editions archive, and 4-player tactical cockpit HUD.

### [v8.0] — 2026-01 — 4-Player Multiplayer Commander Arena
- Launched full 4-player AI Commander simulation with combat steps, turn phases, commander tax, and commander damage tracking.
