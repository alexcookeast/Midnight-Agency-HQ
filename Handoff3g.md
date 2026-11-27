# Wave 3 Implementation & Handoff Tracker (`handoffg3.md`)

**Baseline Branch / Engine:** Wave 2 baseline (`wave1-stabilize`)  
**Scope:** Wave 3 progression & intelligence features (7-tier rank ladder, 5-tier syndicate hierarchy & operational profiles, Spycraft & Ciphers Factbook, and unified Command Desk layout).

---

## Guardrails & Boundary Rules
- **Do NOT modify:**
  - `index.html`
  - `js/holiday-overlay.js`
  - Favicon or logo assets
  - Passcode screen polish / styling
  - Claude's Wave 2 files or existing Wave 2 Handoff documents (`HANDOFF (1).md`, etc.)
- **Stay in lane:** Keep Wave 3 engine/data work in `js/ma-config.js`, `js/crime-generator.js`, and `js/spycraft-factbook.js`, and document progress here (`handoffg3.md`).

---

## Key Architecture & Design Specs

### 1. 7-Tier Agent Rank Progression (`js/ma-config.js`)
- **Rank Ladder:**
  1. **Recruit** (`0★`)
  2. **Rookie** (`2★`)
  3. **Junior Analyst** (`5★`)
  4. **Operative** (`9★`)
  5. **Specialist** (`14★`)
  6. **Agent** (`20★`)
  7. **Spymaster** (`27★`)
- **Compatibility:** Includes derived rank caching and `legacyRankTier()` mapping (`1..3`) so Wave 2 rule tables and existing tests continue passing cleanly.

### 2. 5-Tier Syndicate Hierarchy & Operational Profiles (`js/crime-generator.js`)
- **Canonical Tiers (`1..5`):** `SYNDICATE_TIERS = [1, 2, 3, 4, 5]` mapped across archetypes (`cartel`, `mob`, `triad`, `yakuza`, `smugglers`, plus fallback defaults) and regions (`Americas`, `Europe`, `Asia`, `default`), with per-ring `tierTitles` overrides.
- **Helpers & Ring Creation:** `clampTier`, `inferArchetype`, `inferRegion`, `resolveRankTitle`, and `createSyndicateRing`.
- **Operational Profiles:** `ARCHETYPE_PROFILES` and `getRingOperationProfile(ring, archetype)` defining `preferredModes`, `thwartChance`, `clockMultiplier`, `bonusClueChance`, and `clueStyle` (`route-and-timing`, `front-and-favor`, `signal-and-cipher`, `strict-protocol`, `cargo-and-lanes`), with per-ring `operationProfile` overrides.
- **Crime Generation (`createCrime`):** Computes `resolvedArchetype`, `opProfile`, `mode`, `resolvedRegion`, `resolvedTier`, `suspectRankTitle`, `operationStyle`, and `clockMultiplier`-scaled `durationMs` / `remainingMs`, exporting new constants and helpers on `global.CrimeEngine`.

### 3. Spycraft & Ciphers Factbook (`js/spycraft-factbook.js`)
- **Categories:** `all`, `ciphers`, `tradecraft`, `syndicates`.
- **Core Field Notes & Drills:**
  - Ciphers: Caesar Shift Cipher, Atbash & Keyword Substitution, Pigpen (Masonic) Cipher, Vigenere Key Cipher, Rail Fence (Zig-Zag) Transposition, Codebooks & Steganography.
  - Tradecraft & Syndicates: Dead Drops / Brush Passes / Cover Fronts, Corroborating Clues & Reading Routes, How Syndicate Rings Are Structured (Tiers 1–5).
- **API (`global.SpycraftFactbook`):** `CATEGORIES`, `ENTRIES`, `getCategories`, `getEntries`, `findEntry`, `searchEntries`, `registerEntry`, `registerEntries`.

---

## Progress Log
- [x] **Step 1 (`js/ma-config.js`):** Added 7-tier rank progression, derived rank caching, and `legacyRankTier()` compatibility helper.
- [x] **Step 2 (`js/crime-generator.js`):** Added 5-tier syndicate rank resolution (`resolveRankTitle`, `createSyndicateRing`), operational profiles (`ARCHETYPE_PROFILES`, `getRingOperationProfile`), and `createCrime` metadata/clock integration.
- [x] **Step 3 (`js/spycraft-factbook.js`):** Created standalone Spycraft & Ciphers Factbook module with field notes, examples, drills, search, and dynamic entry registration.
- [ ] **Step 4 (Verification & UI Integration):** Run engine test suite (`node tests/wave2-engine.test.js` + sanity checks), then plan unified Command Desk, comms/inbox controls, and Factbook/dossier UI integration.