# Wave 3 schema & data plan (Step 1, proposal)

Status: **proposal, no Wave 3 code written yet.** Branch `wave1-stabilize` @ `9bf5fb6` + this file.
Guardrails respected: `index.html`, `js/holiday-overlay.js`, favicon/logo assets and
`midnight-agency-passcode.html` are not touched by anything below.

Sections: 0 state of the branch, 1 rank ladder, 2 map and travel, 3 location intel, 4 visual clues,
5 comms, 6 minigame hooks, 7 dossier and manual deduction, 8 files and routing, 9 tests, 10 decisions.

---

## 0. State of the branch (findings that shape the plan)

`wave1-stabilize` already holds Wave 1, Wave 2, the favicon/speech polish, and a Wave 3 commit (`9bf5fb6`:
7-tier ladder in `ma-config.js`, 5-tier syndicate profiles in `crime-generator.js`, `spycraft-factbook.js`,
`Handoff3g.md`). I build on that, not around it. Findings:

1. **The 7-tier ladder breaks three consumers still written for levels 1-3** (all silent, no errors):
   - `world-factbook.js` uses `RL.FIELD_AGENT`, which no longer exists, so `minRank` is `undefined` and **charter travel is locked forever**. `RL.OPERATIVE` is now level 4, so flights moved from 2 stars to 9 stars.
   - `case-engine.js` `rankKey()` clamps `rankLevel` to 3: Recruit and Rookie, Junior Analyst and Operative now differ only by accident.
   - `agent-roster.js` unlocks compare `unlock.rank: 2 | 3` against the 1-7 level: Priya/Kofi now unlock at Rookie (2 stars) and Elsa at Junior Analyst (5 stars).
2. **Tests at the tip:** `wave2-sim.js` fails one assertion that still expects "Rookie is a promotion" (stale). `wave2-engine.test.js` fails
   "second orders after a miss always get the trail clue". That failure **already exists at `58e119a`**, before the ladder: a real gap in my
   `giveOrders` (a second `locals` order at a stuck stop can come back empty). Both fixes are in Step 2's first commit.
3. **The remote `player-dashboard.html` is older than my local one:** it still has the tap-for-a-star placeholders and no link to the Case Desk.
   Step 2 replaces that page, so I will not port the old edits.
4. **Hack Lab / Cipher Lab / Mystery Suspect are dead tiles** on the dashboard today. Step 2 turns them into the minigame slots in section 6.
5. **Map geometry:** the dashboard map is hand-drawn polygons (`GEO`). A "detailed" map needs real coastlines. This container has no data for it, but
   GitHub is reachable, and I fetched `johan/world.geo.json` (Unlicense, public domain): 180 countries, 10,702 points, 257 KB raw, about 90 KB as a compact path.
   Recognisable 110m-class coastlines; very small states (Singapore, Malta, Vatican) are not drawn but still get pins.

---

## 1. Rank ladder (7 tiers) and the engine contract

### 1.1 Table (single source: `MidnightAgencyConfig.RANKS`)

| Level | Rank | Stars | Solved cases | Legacy bucket | Unlocks |
|---|---|---|---|---|---|
| 1 | Recruit | 0 | 0 | 1 | starter crew (3 agents), road / rail / ferry / transit |
| 2 | Rookie | 2 | 1 | 1 | Priya (agent), Comms inbox, Dossier (read only) |
| 3 | Junior Analyst | 5 | 3 | 2 | codename, flights, Kofi, manual trait cycler, rumour reliability tags |
| 4 | Operative | 9 | 5 | 2 | Elsa, 2-clue cross-checks, first locked-file slots |
| 5 | Specialist | 14 | 8 | 3 | charter flights, Diego, fingerprint matching |
| 6 | Agent | 20 | 12 | 3 | 5-stop routes, ring-leader intel |
| 7 | Spymaster | 27 | 16 | 3 | everything |

- **Stars and solved cases both required**: the rank is the highest row where `stars >= minStars` **and** `solved >= minSolved`. One sharp case (2 stars) promotes Recruit to Rookie at most; it can never skip a tier.
  (Pacing: about 2 stars per case, Spymaster is roughly 14-16 cases, which fits a month of play.)
- Thresholds for stars are **kept from `9bf5fb6`**; `minSolved` is new. Needs `player.solved` in the config: `MA.recordCaseSolved()` increments it, called by `WarrantEngine.completeCase`.
- **Contract for engines (one rule):** engine rule tables use `MA.legacyRankTier()` (1..3); feature unlocks use `MA.rankLevel()` (1..7). Nothing else reads a rank.
  - `case-engine.rankKey(ctx)`: `ctx.rankTier` (1..3, from `legacyRankTier`); `ctx.rankLevel` stays 1..7 for unlocks.
  - `TRAVEL_MODES.minRank` (levels): transit / road / rail / ferry = 1, **flight = 3 (Junior Analyst)**, **charter = 5 (Specialist)**; `RL.FIELD_AGENT` removed everywhere.
  - Agent unlocks (levels): Priya 2, Kofi 3, Elsa 4, Diego `solved: 8`.
- Stored `player.rank` is a cache. Old names (`Field Agent`) in storage are ignored: rank is always derived.
- GM suite rank `<select>` gets the 7 names (the gate and `index.html` are not affected: the gate only checks `effectiveRank`).

---

## 2. Map, agent tracks and multi-leg travel

### 2.1 Coordinates (one system)

- `PLACES[i]` gains `lat`, `lon`, `tz` (IANA). The current `map:{x,y}` (percent) stays for compatibility. The dashboard `COUNTRIES` already has lat/lon/tz (16 + HQ) and keeps working through `iso2`.
- `js/map-geo.js` (new): `project(lat, lon) -> {x, y}` on a **720 x 360 equirectangular** grid (the dashboard's existing viewBox, so zoom/drag code survives); `greatCircle(a, b, n)` for curved routes; land from `data/geo/land.json`.
- `data/geo/land.json` (new, built by `scripts/build-map.mjs` from the public-domain world.geo.json): `{ "v": 1, "w": 720, "h": 360, "rings": [ "M12.3 40.1L...Z", ... ] }`. If the file is missing, the map falls back to the existing hand-drawn `GEO`, so nothing breaks offline.

### 2.2 Trips with legs (replaces the single departure/arrival)

```
agent.assignment = {
  caseId, purpose: "investigate" | "arrest" | "reposition",
  fromPlaceId, toPlaceId,                // trip endpoints (kept: today's code reads these)
  departureTime, arrivalTime,            // kept: whole trip, so old code/tests still work
  legs: [ { fromPlaceId, toPlaceId, mode, realMinutes, gameMinutes, departTime, arriveTime, layoverMin } ],
  arrived, ...
}
```
- `AgentRoster.planTrip(from, to, rankLevel, opts)` wraps the existing `WorldFactbook.planRoute` (it already returns hub-to-hub legs and respects `minRank`), then stamps real timestamps. `AgentRoster.travelMs` remains and becomes the trip total.
- `CaseEngine.agentPositions(state, now)` returns `[{agentId, lat, lon, legIndex, legProgress 0..1, etaMs, mode, atHub}]` for the map. Position is interpolated along the active leg; during a layover the agent sits at the hub.
- Event pings: `state.pings[] = {id, placeId, caseId, kind: "crime"|"clue"|"comms"|"arrival"|"lucky", at, seen}`; pulsing on the map until the item is read.
- Map interactions (all from the pin): inline card with **Send / Route agent** (shows the legs and arrival time before confirming), **Local intel** (comms and clues tied to that city), **Open Factbook** (that country's page).

### 2.3 Realistic times (needs sign-off, 10.2)

Real durations are per mode: flight 800 km/h + 90 min airport/connection, rail 160 km/h, road 70 km/h, ferry 30 km/h, +15 min boarding. A **mission-time scale factor** (default **0.35**) converts real time to game minutes, so Dublin to Tokyo is a real 15h 40m and about 5h 30m on the clock. The map shows both ("real flight 11h, mission time 3h 50m"). `?speed=N` still divides game time for testing.

---

## 3. Location Intel & Forecast card

- Selected city: local time (`Intl` with `tz`), country flag, and a prominent **Open Factbook** button.
- Weather: Open-Meteo `current` + 3-day `daily` for `lat/lon`, cached in `localStorage` key `midnight_agency_wx_v1` (3 h TTL, per place).
- **Offline fallback** (no request, or the request fails): a labelled estimate "Typical for {month}" from latitude, month and the country file's `geography.climate`, never presented as live. No external fonts or requests are needed for the card to render.
- Factbook opens in an overlay inside the desk (existing `factbook-ui.js` module); `factboot-test.html` keeps working as the standalone test page.

---

## 4. Visual-first clues

### 4.1 Clue part (extends the current `{key, value, text, flagSrc}`)

```
part = {
  key: "currency" | "flag" | "language" | "geography" | "region" | "banknote" | "coin" | "note" | ...,
  value,                         // internal truth used for decoy logic; never shown
  kind: "text" | "visual",
  text,                          // neutral caption: "a banknote that was dropped (see the picture)"
  visual: { type: "flag"|"banknote"|"coin"|"note", id: "ev-7f3a91", gen: {...}, alt: "a banknote" },
  source: { channel, reliability: "confirmed"|"witness"|"rumour" }
}
```
- **Spoiler policy** (enforced by a test): no `text`, `alt`, element id or file name contains the city, country, currency name or ISO code. File names and ids are hashes (`ev-7f3a91.svg`); alt text is generic.
- The currency clue's text becomes a neutral caption. The currency **name** stays visible only in the Factbook "Money" row, which is the reference the player checks the picture against.

### 4.2 Banknote and coin art (needs sign-off, 10.3)

No real banknote images are available offline, and real notes carry reproduction restrictions. Proposal: **`js/visual-clues.js` draws stylised notes and coins as SVG**, deterministic per currency code:
- palette taken from the country's **flag SVG colours** (already in `assets/flags/`), a currency **symbol** glyph and a denomination numeral, guilloche/wave pattern, portrait-style oval, and a seed-based border.
- the **same art** appears in the Factbook "Money" row, so matching clue to Factbook is the puzzle. Shared symbols (`$` for CLP, MXN, USD, CAD...) are exactly the ambiguity that makes it a deduction.
- Real photos can replace any generated note later by setting `visual.src` (`assets/clues/*.webp`); nothing else changes.
- Flags use the existing `assets/flags/<iso2>.svg`.

### 4.3 Crumpled note generator (physical clues)

`visual = { type: "note", gen: { seed, paper: "lined"|"graph"|"napkin"|"receipt"|"torn", tilt: -6..6, creases: 2..5, ink: "blue"|"black"|"pencil" }, text }`
- **SVG, not canvas**: crisp on the tablet, accessible, and offline. Paper from a gradient plus `feTurbulence` grain; creases as dark/light line pairs with a soft `feDisplacementMap` crumple; tilt per seed.
- Handwriting: a cursive fallback stack (`"Segoe Print","Bradley Hand","Comic Sans MS",cursive`) with **per-word jitter** (baseline and rotation from the seed). No web font is loaded.
- A found note is reliability **confirmed**.

---

## 5. Comms inbox

### 5.1 Item

```
state.comms[] = {
  id, caseId, at,
  channel: "call" | "email" | "text" | "voicemail",
  from: { kind: "agent"|"hq"|"informant"|"lab"|"unknown", id?, name },
  subject?, body,                              // text/email body
  transcript?,                                 // call/voicemail: chunked for synced playback
  voice: { agentId?, pitch, rate, style },
  reliability: "confirmed" | "witness" | "rumour",
  clueRef: { type: "trail"|"suspect"|"flavor", stopIdx?, traitKey? },
  visual?: part.visual,                        // attached picture or crumpled note
  lock: null | { kind: "hack"|"cipher"|"dossier", level, payload, solved: false },   // section 6
  state: "new" | "read" | "archived"
}
```
- Source mapping: agent orders reports become **texts** (or **voicemails** after a long trip); a lucky break is a **call**; HQ summaries and lab results are **emails** (confirmed); informant tips are **texts/calls** (rumour).
- **One creation point:** `CaseEngine.addBoard` also calls `addComm`, so the existing `c.board` and all current tests keep working; the inbox is the new view of the same events. Unread counts are derived per channel (All / Calls / Emails / Texts / Voicemails).

### 5.2 Calls, voicemails and the live waveform (`js/comms-audio.js`, new)

- Speech: `speechSynthesis`, split into short clauses with brief pauses (project spec section 5), per-agent pitch/rate, best English voice with fallback.
- **Waveform is synthetic**, drawn live on a `<canvas>`: browsers do not expose `speechSynthesis` audio to Web Audio, so the envelope is generated from the transcript (chunk length, punctuation, seeded jitter) and synced with `onboundary`/`onend` where the browser provides them.
- Web Audio is used only for the radio **squelch/click bursts** and a faint noise bed (bandpass-filtered). The voice itself is not filtered; that limit is documented, not hidden.
- Separate module: nothing is imported from the passcode screen's speech code.

---

## 6. Minigame hooks (Hack Lab, Cipher Lab, Dossier Deduction)

- `js/minigame-slots.js` (new): `MinigameSlots.register(kind, { title, mount(el, lock, done), }, ...)`, `MinigameSlots.open(commsOrClue)`, `MinigameSlots.has(kind)`.
- A **locked** comms item or clue shows a padlock and a short prompt; tapping it calls `open`, the minigame calls `done({ ok })`, and only then is the clue revealed and the item marked `solved`.
- **No dead ends:** locks are generated only for kinds that have a registered minigame. Today that means none, so `lock` is always `null`, and the lock chance by rank is data (`LOCK_CHANCE[level]`), ready to turn on. With `?dev=1`, every slot shows a visible "skip" button.
- Kinds: `hack` (locked phone/file), `cipher` (encrypted intercept: reuses the Spycraft factbook cipher drills), `dossier` (lift a fingerprint and match it, section 7).
- The three dashboard tiles open the standalone labs' slot UI; for now they show "Lab setting up" with the registered-kind list, not a broken button.

---

## 7. Suspect Dossier and manual trait deduction

### 7.1 Profile (built from `data/suspects.json` pools, `data/recurring-suspects.json`, and play history)

```
state.dossier[suspectId] = {
  id, displayName, ringId, tier, rankTitle,
  status: "unknown" | "seen" | "wanted" | "at-large" | "arrested" | "retired",
  priorArrests: n, lastCaseId,
  mugshot: { seed, appearance },                    // from the suspect's appearance categories
  fingerprint: { pattern: "loop"|"whorl"|"arch", seed, unlocked: priorArrests > 0 },
  haunts: [ { placeId, note, confidence } ],        // origin city + ring hubs + visited stops
  associates: [ suspectId ],                        // same ring, tier +/- 1; recurring links
  habits: [ ... ]                                   // recurring `traits` and `callStyle.habit`
}
```
- `js/mugshot.js` (new): procedural SVG portrait from `appearance` categories (hair colour/style, skin, eyes, facial hair, build) so the mugshot always matches the data the warrant uses.
- **Fingerprints are visible only for people caught before** (`priorArrests > 0`); others show a locked print. Repeat offenders then work with the `dossier` minigame slot (match a lifted print). Existing data needs no change: recurring suspects get `priorArrests: 0` until caught.
- The Dossier section sits beside the Factbook (same pattern: list, search, detail), backed by the two JSON files plus `state.dossier`.

### 7.2 Manual deduction (no auto-fill)

- New per-case field `c.notebook = { traits: { hairColor: null, hairStyle: null, build: null, height: null, complexion: null, eyeColor: null, facialHair: null } }`: **only the player writes it**, by cycling each trait through that trait's category list (taken from `appearancePools` / `stylePools.facialHair`).
- `c.uncovered` stays the engine's truth but is **no longer applied to anything the player sees as a filter**. Each trait row shows its reports instead:
  `c.reports[traitKey] = [ { commsId, category, clueText, reliability } ]`, tagged **Confirmed / Witness / Rumour**.
- `WarrantEngine.matchingLineup(c)` now filters by `c.notebook.traits` (unset = wildcard); 0 matches blocks printing, 2+ is still a gamble. `printWarrant` and `attemptBust` are otherwise unchanged.
- **Reliability can be wrong (needs sign-off, 10.4):** Confirmed 0% wrong, Witness 10%, Rumour 30%, and only from Junior Analyst up; Recruit and Rookie never get a wrong report.

---

## 8. Files and routing

- **`player-dashboard.html` becomes the unified Command Desk** (same path, so the gate's redirect, the GM page and every existing link keep working without touching guarded files). `case-desk.html` becomes a thin redirect stub to it that preserves `?dev=1` / `?speed=`.
- Layout (below the top bar): map stage about 2/3 width (live agent markers, tracks, pings, inline pin card); right column about 1/3 (Location Intel & Forecast, with Open Factbook); comms inbox with channel tabs; Case, Dossier and Factbook as sections reachable from the bar.
- New files: `js/map-geo.js`, `js/command-map.js`, `js/intel-card.js`, `js/comms.js`, `js/comms-audio.js`, `js/visual-clues.js`, `js/minigame-slots.js`, `js/dossier.js`, `js/mugshot.js`, `data/geo/land.json`, `scripts/build-map.mjs`.
- Changed: `js/ma-config.js` (solved counter, rank reads), `js/world-factbook.js` (lat/lon/tz, ladder fix), `js/agent-roster.js` (legs, unlocks), `js/case-engine.js` (rank tier, comms, positions, stuck-orders fix, notebook), `js/warrant-engine.js` (notebook filter, solved counter), `gm-suite/midnight-agency-backend.html` (7 rank names only).
- Storage: `midnight_agency_cases_v1` gets `comms`, `pings`, `dossier` (older saves migrate on load); new `midnight_agency_wx_v1` (weather cache). Everything stays vanilla, offline-first, with `?dev=1` and `?speed=` honoured.

---

## 9. Tests

- Update `wave2-sim.js` and `wave2-engine.test.js` for the ladder and the stuck-orders guarantee; keep every Wave 2 check green.
- New: spoiler test (no clue text/alt/id contains currency, country or city), rank contract (tier vs level, travel and agent unlocks), trip legs (timestamps, positions, layovers), comms creation and unread counts, lock gating (no lock without a registered minigame), notebook filtering (no auto-fill, wildcard, 0-match block), dossier fingerprint gating.
- Browser: a landscape playthrough at 1280x800 through map pin, dispatch, comms, notebook, warrant and arrest.

---

## 10. Decisions needed before Step 2 (recommended default first)

1. **Rank pacing:** stars as on the branch, plus the solved-case requirement in the table (recommended), or stars only?
2. **Travel time scale:** realistic times times 0.35 for mission time, with both shown (recommended), or fully real time, or the current 15-45 / 60-120 / 120-360 tiers?
3. **Banknote and coin art:** stylised SVG tinted from the flag, with the same art in the Factbook (recommended), or you supply real images later in `assets/clues/`?
4. **Unreliable reports:** Witness 10% and Rumour 30% wrong from Junior Analyst up (recommended), or every report truthful?
5. **Routing:** keep the Command Desk at `player-dashboard.html` and make `case-desk.html` a redirect (recommended), or a new `command-desk.html` with both as redirects (needs a one-line change in the guarded passcode screen)?
6. **Map data:** commit `data/geo/land.json` built from the public-domain world.geo.json (recommended, about 90 KB).
