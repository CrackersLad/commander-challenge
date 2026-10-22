# Changelog

All notable changes to the Commander Draft Challenge application are documented in this file.

---

## [v10.1] - Post-Combat Main Phase 2 Synchronization & Strict Land Limit Enforcement (MTG Rule 305.2 & 505.4)

### 🌿 Main Phase 2 Structure & Turn-Wide Land Play Limits (Rules 305.2 & 505.4)
- **Comp Rules Section 505.4 Alignment**: Post-combat Main Phase (Main 2) runs identically to Main Phase 1. The active player retains priority to cast permanent spells (creatures, artifacts, enchantments, planeswalkers), sorceries, commanders from the Command Zone, and activate abilities.
- **Strict Turn-Wide Land Limit (MTG Rule 305.2)**: A player can play only one land during their turn across all phases combined:
  - If a land was played during Main Phase 1, no land can be played during Main Phase 2. Hand land cards display `Land Played` and any click attempt is rejected with MTG Rule 305.2.
  - If no land was played in Main Phase 1, the player retains the right to play their single land of the turn during Main Phase 2. Once played, `landPlayedThisTurn` is set to `true` and prevents subsequent plays.
- **Card-Forge & Engine Synchronization**: Verified and tested `p.getLandsPlayedThisTurn() >= p.getMaxLandPlays()` in `ForgeWebBridge.java`, `forge-adapter.js`, and `commander-engine.js` across both human and bot player actions.
- **Keyword Safety**: Added safe type checks on `card.keywords` when verifying `haste` during spell casting in `commander-engine.js`.

---

## [v10.0] - Combat Phase Multi-Targeting (Rule 802.1) & Planeswalker Combat Damage (Rule 508.1b / 120.3c)

### ⚔️ Combat Phase Rules Alignment & Multi-Target Declaration
- **Multiplayer Attack Selection (MTG Rule 802.1 & 802.2)**: In multiplayer Commander games, all opponents are defending players simultaneously. Eliminated previous hardcoded `opps[0]` fallback so players can declare distinct attackers attacking any alive opponent.
- **Planeswalker Combat Targeting (MTG Rule 508.1b)**: The active player can declare individual attacking creatures to attack any defending planeswalker controlled by any opponent.
- **Interactive Combat Target Picker Modal**: Clicking an eligible creature in `DECLARE_ATTACKERS` now opens a target selection modal displaying all alive opponents (with life totals and hand sizes) and all opposing planeswalkers (with loyalty counters and controller tags).
- **Target Chip/Badge Display**: Each declared attacking creature on the battlefield now displays a red `🎯 [Target Name]` badge indicating exactly which player or planeswalker it is attacking.
- **Loyalty Damage & Death (Rule 120.3c & 704.5i)**: Unblocked combat damage and trample damage dealt to planeswalkers removes loyalty counters. If loyalty reaches 0, the planeswalker is destroyed and moved to its owner's graveyard via state-based action.
- **Vigilance & Attack Legality (Rule 508.1a & Keyword.VIGILANCE)**: Creatures without vigilance tap upon attack declaration; creatures with vigilance do not tap. Already-tapped creatures cannot be declared as attackers.
- **Card-Forge Engine Synchronization**: Recompiled `ForgeWebBridge.java` and `patches.jar` with overloaded `declareAttacks(cardId, targetPlayerIndex, targetPlaneswalkerId)` to execute multi-target and planeswalker combat damage inside Forge's native engine.

---

## [v9.6] - Official Pre-Game & London Mulligan Flow Alignment (Comp Rules 103)

### 🃏 Pre-Game & London Mulligan Synchronization (MTG Rule 103)
- **Comp Rules Section 103 Alignment**: Audited each step of pre-game procedures against the Magic Comprehensive Rules (Rule 103.1–103.7c).
- **Starting Player & Commander Zone (Rule 103.1 & 903.6)**: Verified commanders are loaded face-up into the Command Zone before starting hands are drawn, and the chosen turn order (Random, You, or Opponents 1–3) seeds Forge's `setupFirstTurn`.
- **Free Multiplayer Mulligan (Rule 103.4c)**: Enforces free first mulligan in multiplayer formats ($N=1$ keeps 7, 0 cards bottomed).
- **London Mulligan Timing (Rule 103.5)**: Bottom-decking only occurs upon deciding to *keep* the hand, never mid-mulligan. If a player mulligans again, all 7 cards are reshuffled into the library without bottoming.
- **Card-Forge Exact Bottom-Decking**: Refactored `bottomCards` in `ForgeWebBridge.java` to match cards sequentially without accidental duplicate bottoming, and updated `forge-adapter.js` to ingest raw JSON updates on `takeMulligan` and `bottomCards`.
- **Multiplayer Turn 1 Draw (Rule 103.7c)**: Ensured starting player draws on their first turn in multiplayer format as required.

---

## [v9.5] - Strict Untap Rules Enforcement (MTG Rule 502.2) & Illegal Tap Toggle Elimination

### 🔒 Strict Untap Rules Enforcement (MTG Rule 502.2)
- Removed arbitrary click-to-untap behavior that previously allowed players to tap a permanent (or attack in combat) and freely untap it again by clicking it.
- **Untap Step Only**: Permanents now strictly remain tapped until your next Untap Step (MTG Rule 502.2), unless untapped by a spell or card ability.
- **Unspent Mana Undo**: Tapping a land or mana rock can only be undone if the generated mana is still currently unspent in `player.manaPool`. Once spent on a spell or ability, the permanent cannot be untapped.
- **Illegal Tap Toggle Removal**: Eliminated arbitrary fallback `card.tapped = !card.tapped` so permanents without mana or activated abilities cannot be toggled on/off at will.
- **Combat Attacker Validation (Rule 508.1a)**: Explicitly rejects declaring already-tapped creatures as attackers.

---

## [v9.4] - Strict Land Drop Enforcement (Rule 305.2) & Forge Activated Abilities on MTG Stack

### 🌲 Strict 1 Land Drop Per Turn Limit (MTG Rule 305.2)
- Fixed multiple land drops occurring in Main phases by tracking and synchronizing `landPlayedThisTurn` across the UI, the adapter, and the Java Card-Forge engine.
- `ForgeWebBridge.java` enforces `p.getLandsPlayedThisTurn() >= p.getMaxLandPlays()` and exports `landsPlayedThisTurn` in player state JSON.
- `forge-adapter.js` and `commander-arena.js` prevent redundant land plays with user alerts and preserve state across match turns.

### ⚡ Card-Forge Activated Abilities & Animated Visual Stack
- Activated abilities now push onto the visual MTG Stack (`#arenaStackBox`) with card art, ability label, and cost/effect details before resolving.
- Added `activateAbility(int cardId, int abilityIndex)` to `ForgeWebBridge.java` utilizing `forge.ai.ComputerUtil.playStack(chosen, p, currentGame)` and `currentGame.getStack().resolveStack()`.
- Official rules engine executes costs (tapping, mana, counters, sacrifice), checks targeting requirements, and handles triggered responses.
- Engine fallback mode now correctly updates power/toughness, counters array, tokens, life totals, and card draws.

---

## [v9.3] - Mulligan Bottom-Decking Flow, Persistent Kept Hands & High-Res Hover Inspector

### 🔍 High-Res Hover Card Inspector Fixes
- Fixed JavaScript syntax errors triggered by apostrophes in card names (e.g., `Commander's Sphere`, `Hero's Downfall`, `Alrund's Epiphany`) by refactoring inline attribute handlers to use `data-card-name` and standard DOM attribute retrieval.
- Newly drawn cards, hand tray cards, and battlefield permanents can now be smoothly hovered to display high-resolution Scryfall art and engine notices.
- Raised inspector layer to `z-index: 100005` with intelligent dynamic positioning relative to the card's viewport position so the preview never covers the hovered card or gets occluded by modals or the hand tray.

### 🃏 Multiplayer London Mulligan & Bottom-Decking Rules
- **Free First Mulligan (MTG Rule 103.4c)**: Hand is shuffled back into library, 7 fresh cards are drawn, and all 7 cards can be kept with 0 cards bottomed.
- **Subsequent London Mulligans**: On Mulligan #2, 7 fresh cards are drawn and player selects 1 card to place on the bottom of the library (keeping 6); on Mulligan #3, player selects 2 cards (keeping 5), and so on.
- **Fixed Hand Reversion Bug**: Eliminated raw JSON hand overwrites in `updateFromRawJson` so bottom-decked cards are strictly removed from hand and placed at the bottom of the library rather than reverting to the first drawn hand.
- **Turn 1 Draw Step Accounting**: When the starting player advances to Turn 1 Main 1, the turn 1 draw (MTG Rule 103.7c) is cleanly drawn and logged as a distinct action (e.g., 6 kept cards + 1 drawn card = 7 cards in hand).

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
