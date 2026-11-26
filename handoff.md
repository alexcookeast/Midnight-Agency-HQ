# Midnight Agency HQ — Implementation Handoff (Wave 1 & Wave 2)

**Repo:** `alexcookeast/Midnight-Agency-HQ`  
**Baseline Commit:** `3e920ef` (`main` — clean, zero partial edits)  
**Target Audience & Architecture:** Kid-friendly (age 7+) real-time spy mystery web app (*Carmen Sandiego* × *Dispatch*) running 100% client-side on static HTML/CSS/JS + `localStorage` via GitHub Pages.

---

## Core Design Principles
1. **Real-Time Pacing:** The game runs on a real-world clock. One stolen good or incident equals **one self-contained case** with a complete win screen—never gate a single win screen behind a multi-case marathon.
2. **HQ Case Commander (Not Solo Traveler):** The player stays at HQ, analyzes clues, cross-references the Factbook, issues warrants, and dispatches **named field agents** across real-time flights.
3. **Humanized Field Agents:** Agents have stronger personalities, specialties, quirks, rapport meters, and leveling arcs (`Level 1 → 2 → 3`) than the criminals.
4. **Gamble-Friendly Warrants:** Players can issue a warrant as soon as 1+ suspects match their filtered traits, trading higher risk of a false arrest for beating the clock.

---

## Wave 1: Foundation & Plumbing Repairs (Execute First)

Before adding Wave 2 player mechanics, stabilize the underlying simulation, data schema, and config consistency:

### 1. Single Source of Truth for Config, Ranks & Storage Keys
* **Problem:** Rank thresholds, star defaults, and `localStorage` keys are duplicated across `player-dashboard.html`, `gm-suite/*`, and JS modules, causing external rank/star edits to get overwritten on load and leaving dead references (`applySeasonalSettings`).
* **Fix:**
  * Create `js/agency-config.js` exporting canonical `STORAGE_KEYS`, `RANKS` (`Rookie`, `Operative`, `Field Agent`, `Senior Handler`, `Director`), `getRankForStars(stars)`, and `TRUST_MAX = 5`.
  * Refactor `player-dashboard.html` and `gm-suite` pages to read/write via `agency-config.js` without clobbering existing state on page load, and remove/wire dead seasonal hooks cleanly.

### 2. Suspect & Syndicate Generator Alignment (`js/suspect-generator.js`)
* **Problem:** First-name pool key mismatches (`femaleFirstNames` / `maleFirstNames` / `neutralFirstNames`), inconsistent recurring suspect promotion hooks, and syndicate ring hub assignments drifting from valid place IDs.
* **Fix:**
  * Align gender/neutral name pool lookups in `createFreshSuspect()` so names never fall back to `undefined` or blank strings.
  * Ensure every generated syndicate ring anchors its `hubPlaceId` to a valid canonical place ID and populates tier hierarchies (`boss`, `lieutenant`, `underling`) cleanly.
  * Preserve and expose filterable suspect schema fields (`hairColor`, `hairStyle`, `facialHair`, `eyeColor`, `outfit`, `accoutrement`, `nickName`) for the Wave 2 Warrant Terminal.

### 3. Crime Lifecycle & Real-Time Timer Fixes (`js/crime-generator.js` & `js/suspect-ui.js`)
* **Problem:** Escalated crimes can reset status back to `"planning"`, fail to transition cleanly into `"cold"`, or linger unresolved after a suspect is captured or escapes.
* **Fix:**
  * Fix `advanceCrime()` state transitions (`planning → preparation → execution → escape → cold`) using real-world timestamps without resetting stage progress on refresh.
  * Add explicit terminal resolution states (`resolved: "caught" | "escaped" | "cold" | "false-alarm"`) so active boards stay clean and resolved cases archive into case history.

### 4. Canonical Place Schema Normalization
* **Problem:** Place/city references mix inconsistent IDs, country codes, and missing Factbook trait keys across `data/*`, `factboot-test.html`, and generators.
* **Fix:**
  * Standardize every place entry around a canonical schema:
    ```json
    {
      "id": "ca-ottawa",
      "city": "Ottawa",
      "country": "Canada",
      "region": "North America",
      "flag": "assets/flags/ca.svg",
      "coords": { "lat": 45.42, "lng": -75.69 },
      "factbook": {
        "currency": "Canadian Dollar (CAD)",
        "languages": ["English", "French"],
        "drivingSide": "right",
        "landmarks": ["Parliament Hill", "Rideau Canal"],
        "climate": "continental",
        "geographyNote": "Sits along the Ottawa River between Ontario and Quebec."
      }
    }
    ```

---

## Wave 2: Player Detective Loop & HQ Dispatch

Build on top of Wave 1's clean state to deliver the full player-facing *Carmen Sandiego* × *Dispatch* gameplay loop.

### 1. Named Field Agent Roster & Progression (`js/agent-roster.js`)
* **Handcrafted Pool (~6–8 Named Agents):** Fixed characters with consistent names, avatars/badges, voices, specialties, and quirks across playthroughs (creating shared recognition between players).
* **Randomized Starter Crew:** Each new campaign draws **3 starter agents** (biased to include at least 1 strong recon/clue agent and 1 solid intercept agent). The remaining **3–5 agents** unlock as HQ rank climbs (`Operative`, `Field Agent`, etc.) or syndicate milestones are cleared.
* **Agent State Shape:**
  ```json
  {
    "id": "agent-pip",
    "name": "Agent Pip",
    "unlocked": true,
    "level": 1,
    "xp": 0,
    "rapport": 3,
    "maxRapport": 5,
    "specialty": "transit-tailing",
    "quirk": "cautious-on-rushed-warrants",
    "status": "idle",
    "assignment": null
  }