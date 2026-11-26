# Midnight Agency Handoff (updated Thu 2026-11-26; deadline Dec 25, 2026)

Repo: `alexcookeast/midnight-agency-hq`. This file replaces the older Spy App project handoff
(dated 2026-11-23), which described a single-file v6 `index.html` and a separate "Track B" landscape
OSINT desk. Neither matches the repo.

## 1. Active track (decided)

The **modular multi-page app** is the active and only track:

```
index.html  (pizza parlour cover)
  -> secret order (pickles + olives + mushrooms, or the voice/phone order)
  -> midnight-agency-passcode.html  (agent passcode gate, codename claim)
  -> player-dashboard.html          (player HQ)
gm-suite/midnight-agency-backend.html  (GM settings; reached directly, not via the gate)
```

No build step. Plain `<script src>` files, no ES modules except `js/factbook-loader.js` / `js/factbook-ui.js`.
Works from a local server or a static host.

Retired and **not** in the repo: the v6 single-file game (save key `midnightAgency1`) and the Track B
"OSINT Analyst Desk" prototypes (`News.html`, `VoiceSynthesizer.html`, `Factbook.json`). They still sit in the
Spy App project for reference. Their ideas (radio voices, newspaper clipping, scene photos) are optional, not planned.

## 2. Files

| Path | Role |
|---|---|
| `index.html` | Pizza cover, cart, `AgencyVoice` voice/phone order, holiday overlay hook. Reads config only. |
| `midnight-agency-passcode.html` | Passcode gate + codename claim. Sets the gate-passed marker, then opens the dashboard. |
| `player-dashboard.html` | Player HQ: rank/stars header, HQ world map (16 countries), phrasebook, news ticker, patrol/training. Requires the gate. |
| `gm-suite/midnight-agency-backend.html` | GM credentials, player rank/codename/passcode, holiday overlay settings. |
| `js/ma-config.js` | **Single source of truth** for config, rank rules and the gate check. Loaded by all four pages above and used by `world-factbook.js`. |
| `js/holiday-overlay.js` | Snow/sleigh overlay. Scoped to `index.html` (`#pizza`) only. |
| `js/world-factbook.js` | `PLACES` (21 cities), `TRAVEL_MODES`, `findPlace`, `pickPlace`, `planRoute`. |
| `js/factbook-loader.js`, `js/factbook-ui.js` | Country data loader (lite/standard modes) and UI; test page `factboot-test.html`. |
| `js/suspect-generator.js` | `SuspectEngine`, `createFreshSuspect`, tiers, escape/promotion, cooldowns. |
| `js/crime-generator.js` | `CrimeEngine`: crime creation, lifecycle, heist stages. |
| `js/suspect-ui.js` | Drives `suspect-test.html` (the engine test bench). |
| `data/*.json` | `suspects.json`, `crime-rings.json`, `recurring-suspects.json`, `world-factbook.min.json`, `factbook-index.json`, `countries/<iso2>.json` (194). |
| `scripts/build-factbook.mjs` + `factbook-overrides.json` | Generate the factbook data. |
| `docs/place-schema.md` | Proposed canonical place ID/join schema (needs sign-off). |
| `suspect-test.html`, `factboot-test.html`, `tablet-test.html`, `tablet-test2.html`, `sw.js` | Test pages. `sw.js` only caches `tablet-test.html`; it is **not** an offline cache for the game. |

## 3. Storage

| Key | Where | Owner / contents |
|---|---|---|
| `midnight_agency_config_v1` | localStorage | `js/ma-config.js`. `gm{userName,passCode,clearanceKey}`, `player{rank,userName,passCode,stars}`, `passcodeToppings`, `secretPhrase`, `gateUrl`, `npcs`, `christmasEnabled`, `snowDensity`, `snowSpeed`. |
| `midnight_agency_settings_v1` | localStorage | `js/factbook-loader.js`. `performanceMode` = `lite` or `standard`. |
| `midnight_agency_gate_v1` | sessionStorage | "Passcode gate passed" marker. Set by the gate; read by the dashboard. |

Rules (all in `js/ma-config.js`; do not reimplement them in a page):
- **Rank comes from stars:** `>= 5` Field Agent (level 3), `>= 2` Operative (level 2), else Rookie (level 1). The stored `player.rank` is only a cached copy.
- `WorldFactbook.TRAVEL_MODES[*].minRank` uses those levels: transit/road/ferry/rail = 1, flight = 2, charter = 3.
- Always write through `MidnightAgencyConfig.write / writePlayer / addStars`. They re-read storage first, so a stale tab cannot overwrite a GM edit. Never keep your own star counter.
- Codename is only available past Rookie.
- The old `dashboardUrl` key was really the gate URL. It is migrated to `gateUrl` on read and dropped on the next write.
- **Dashboard gate:** `player-dashboard.html` redirects to the gate unless the gate was passed this session. Testing bypass: add `?dev=1` (or `?bypass=1`) to the URL.

## 4. Current state

Working:
- Cover to gate to dashboard flow, GM settings, holiday overlay, shared rank/config contract.
- Suspect engine: name pools (female/male/neutral), ring `recruitingRoots`, recurring suspects keep `origin` / `traits` / `callStyle`, every suspect has an `origin.placeId`.
- Crime lifecycle: `open` -> (thwart timeout) `escalated` -> `cold`; recovery crimes go `cold` at timeout; `cold` stops ticking; capture or escape resolves linked crimes (`outcome` = `caught` / `escaped`). Escalated crimes show Escape -> Cold, never Planning.
- All ring hubs and crime targets resolve through `findPlace`.

Not built (Wave 2 and later):
- Clue gathering loop, warrants and arrests, case summary, **real star awards**. Stars today come only from placeholder taps (patrol button, "today" card) and GM edits.
- GM editors (case creator, dossier/ring editor, synth/passcode bench).
- Offline caching for the real game and flag assets (flags exist in `assets/flags/` but are unused by the game).
- Recovery-mode crimes are *created* already past the heist, yet still start at "Planning". Only escalation was fixed in Wave 1.
- Known Factbook data errors: `drivingSide` always "right", capitals are centroids, Zimbabwe currency is BWP, Vatican population "Unknown", diacritic-broken tag slugs.
- The GM unlock compares against plaintext defaults (`GM` / `MIDNIGHT-GM`). Fine for a family game; do not reuse real passwords.

## 5. Audience and standing constraints (unchanged)

- 7-year-old niece (grade 2 French immersion; Ghostbusters, K-pop Demon Hunters, cat Samhain, Guess Who?). The giver is a relative with near-zero electronics skill, in Canada (Atlantic time).
- Spy themed, NOT Christmas themed (the holiday overlay is a small cover-page extra only). Hidden-in-play education, geography emphasis, French only sprinkled, other languages fine.
- Carmen Sandiego '98 style; "World Police Bureau" (invented, not Interpol); no franchise characters.
- Never requires the giver to physically deliver things. Weekly printed coded messages (code word unlocks a special case).
- ESP32 motion detector is a stretch goal and must never sound an alarm.
- Keep user-facing messages plain; no internal tool names.

## 6. Decisions waiting on the owner

1. Place ID format and the open questions in `docs/place-schema.md` section 4.
2. Gate: is a per-session marker (`sessionStorage` plus `?dev=1`) enough, or should the dashboard require the passcode on every cold start of the tablet?
3. Should escape close linked crimes as `resolved` (current) or leave them `cold`?
4. Tablet logistics: App Store vs Google Play, Amazon Kids profile or not, GitHub account for hosting, printer model, her codename.

## 7. Remaining checklist (before Dec 25)

1. Sign off section 6.
2. Wave 2: clue/investigation loop, warrants and arrests, case summary, real star awards.
3. Host (GitHub Pages) or otherwise install; test on the actual tablet: touch targets 44px+, landscape, sound, offline.
4. Printable weekly coded-message sheet.
5. Post-Christmas: Alexa integration; ESP32 motion detector (silent).

## 8. Testing

No test runner is checked in. Wave 1 was verified with throwaway Node scripts against `ma-config.js`,
`world-factbook.js`, `crime-generator.js` and `suspect-generator.js` (rank thresholds, stale-star
protection, legacy key migration, gate and bypass, lifecycle transitions, hub resolution, 300 generated
suspects against the name pools and recruiting roots). Not yet done: real tablet, browser click-through of
`suspect-test.html` and the dashboard.
