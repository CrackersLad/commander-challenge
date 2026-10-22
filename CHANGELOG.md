# Changelog

All notable changes to the Commander Draft Challenge application are documented in this file.

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
