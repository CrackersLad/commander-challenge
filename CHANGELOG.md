# Changelog

All notable changes to the Commander Draft Challenge application are documented in this file.

---

## [v9.2] - Forge Playtester Turn Order, Mulligan Persistence, Phase Flow & Floating Mana Engine

### 🔄 Mulligan Hand Persistence
- Fixed match start resetting kept hands back to the initial pre-mulligan hand.
- Kept hands are now locked via `player.handLocked` and synchronized with Card-Forge engine state.

### 🎲 Customizable Turn Order & Starting Player
- Added Turn Order selector in Pod Setup with 5 options:
  - **Random (High Roll)**: Simulates a multiplayer d20 roll-off with tie-breakers and logs rolls.
  - **I Go First (Seat 1)**: Player takes Turn 1.
  - **Opponent 1 (Seat 2)** / **Opponent 2 (Seat 3)** / **Opponent 3 (Seat 4)**: Selected bot opponent takes Turn 1.
- Updated `ForgeWebBridge.java` with overloaded `startCommanderMatchWithDecks` accepting starting player index to initialize Forge's `startFirstTurn()`.

### ⏱️ Turn 1 Phase Sequencing & Single Land Drop Enforcement
- Starting player now advances through `UNTAP` -> `UPKEEP` -> `DRAW` directly into `MAIN_1` when keeping their hand.
- Eliminates turn 1 phase hopping that previously bounced from Main 1 to Draw and back to Main 1.
- Enforces strict MTG Rule 305.2 (1 land drop per turn) with automatic reset when a player's turn begins.

### 💎 Active Floating Mana Pool Requirement
- Cards can no longer be cast merely because untapped lands sit on the battlefield.
- Players must explicitly tap lands or mana rocks in the "Mana & Support Line" to float mana into their `player.manaPool` first.
- Spells and commander casts validate and deduct floating mana upon casting, with guidance tooltips indicating mana required.

### ⚡ Automatic ETB & Stack Trigger Resolution (e.g., Nazgûl & Ring Tempting)
- Resolved an issue where cards entering the battlefield (such as **Nazgûl**) did not immediately trigger and resolve their enters-the-battlefield (ETB) and chain abilities (Ring Tempting +1/+1 counter placement).
- Updated `ForgeWebBridge.java` to execute automated stack & trigger resolution loops (`resolveStackAndTriggers()`) upon playing lands, casting spells, and entering creatures.
- Serialized card counters (`Multiset<CounterType>`) and power/toughness in Forge game state.
- Enhanced Arena card frame with glowing `.buffed` power/toughness bubbles and `+X` counter badges.
- Implemented fallback Nazgûl / Ring Tempting ETB mechanics in `commander-engine.js`.

---

## [v9.1] - Opening Hand & London Mulligan Engine Fix

### 🃏 Full London Mulligan & Hand Refresh
- **Opening Hand Shuffling & Redraw**:
  - Fixed an issue where taking a mulligan in the Commander Arena failed to draw new cards and prompted discards from the original hand.
  - Connected opening hand mulligans directly to the Card-Forge JVM engine via `ForgeWebBridge.takeMulligan()` and a robust client-side Fisher-Yates deck shuffle fallback.
  - Taking a mulligan now shuffles the full 7-card hand back into the 99-card library and draws 7 brand new cards before prompting card bottoming.
- **Rule 103.4c Multiplayer Free Mulligan & London Bottoming**:
  - The 1st mulligan is 100% free with no cards returned to the bottom (Rule 103.4c).
  - Subsequent mulligans properly calculate `mulliganCount - 1` cards to put onto the bottom of the library from the *newly drawn* 7 cards.
  - Added interactive visual bottoming selection with confirmation, logging bottomed card names to the match log.

---

## [v9.0] - Major Release: Activated Abilities & Colored Mana Engine

### ⚡ Card Activated Abilities
- **Automatic Ability Detection & Parser**:
  - Automatically extracts and formats activated abilities from card oracle text.
  - Supports **Planeswalker Loyalty abilities** (`+1`, `-3`, `0`), **Tap abilities** (`{T}: ...`), **Equip costs**, **Sacrifice requirements**, and **Mana activation costs**.
  - Intelligently filters out basic mana abilities to prevent modal clutter.
- **Battlefield Ability Triggers**:
  - Interactive **⚡** ability badges directly rendered on creature card frames, planeswalkers, and support chips.
  - Clicking any creature during your Main phase (or clicking its `⚡` badge at any time) opens the dedicated **Card Activated Ability Modal**.
- **Interactive Ability Modal**:
  - Displays high-res card art, loyalty counters, summoning sickness, and tap status.
  - Validates requirements before activation (untapped check, summoning sickness prevention, loyalty counter limits, and mana availability).
  - Automatically resolves common activated effects:
    - Card draw (e.g. `Mind Stone`, `Phyrexian Arena`, etc.)
    - Token creation (Zombies, Goblins, Soldiers, Saprolings, Treasures)
    - Life gain and opponent life drain
    - `+1/+1` counter placement
    - Permanent sacrifice costs (e.g. `Sacrifice Mind Stone: Draw a card`)
  - Full action logging integrated directly into the Commander Arena combat stream.

---

### 💎 Interactive Land & Mana Rock Tapping & Colored Mana Pool
- **Full Color & Multi-Mana Detection**:
  - **Basic Lands & Sol Ring**: Single-click instant tapping directly generating `{W}`, `{U}`, `{B}`, `{R}`, `{G}`, or `{C}{C}`.
  - **Multi-Color Lands & Mana Rocks**:
    - Supports `Command Tower`, `Arcane Signet`, `City of Brass`, `Exotic Orchard`, dual lands, shock lands, bounce lands, and filter lands.
    - Prompts the glassmorphic **Mana Choice Modal** with color selection pips.
  - **Cost Accounting**:
    - **Pain Lands & Talismans**: Free `{C}` option, or colored mana deducting 1 life.
    - **City of Brass**: Deducts 1 life upon producing colored mana.
    - **Filter Lands & Signets**: Deducts `{1}` mana activation cost and adds the filtered colored mana pair.
- **Live Colored Mana Pool Bar in Player HUD**:
  - Displays live color counts with custom glowing MTG mana pips:
    - ⚪ **W** (White)
    - 🔵 **U** (Blue)
    - ⚫ **B** (Black)
    - 🔴 **R** (Red)
    - 🟢 **G** (Green)
    - ⚪ **C** (Colorless)
    - 💎 **Total Mana Available** (Floating pool + remaining untapped sources)
  - Features quick-action **⚡ Untap All** and **🧹 Empty Pool** buttons.
  - Shows an inline produced-mana preview on tapped chips (e.g. `+⚪ W`), and clicking a tapped land refunds the mana cleanly from the pool.
- **Spell & Commander Casting Integration**:
  - Casting spells from hand or your Commander consumes floating mana from `player.manaPool` first before auto-tapping remaining untapped lands.

---

### 📋 Custom Decklist Import & Engine Flags
- **Moxfield / Archidekt / Arena / MTGO Importer**:
  - Paste any decklist format with automatic Commander header detection.
- **Engine Notice Badges**:
  - Cards flagged for Card-Forge engine compatibility display a `⚠️` badge with full explanation on hover in the Card Inspector.

---

## [v8.25] - Forge WebAssembly Lazy Loading & Engine Flagging
- Introduced CheerpJ WebAssembly Card-Forge engine bridge.
- Fast-loading split editions archive architecture.
- Full 4-player Commander Arena tactical HUD.

---

## [v8.0] - Commander Multiplayer Arena Release
- 4-player AI Commander simulation.
- Real-time phase navigation, declare attackers combat phase, and commander damage tracking.
- Commander tax calculation and command zone management.
