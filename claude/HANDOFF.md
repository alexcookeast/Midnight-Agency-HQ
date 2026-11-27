# Midnight Agency Handoff (updated Thu 2026-11-26, after Wave 2; deadline Dec 25, 2026)

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
       -> case-desk.html            (the game: cases, agents, warrants)
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
| `player-dashboard.html` | Player HQ: rank/stars/trust header, HQ world map (16 countries), phrasebook, news ticker. The mission card and Cases tab open the Case Desk. Requires the gate. |
| `case-desk.html` | **The game (Wave 2).** Landscape desk: HQ feed, Country board (Fact / Rule Out / Send), Agents, Warrant, case summary, Passport. System fonts, no external requests. Requires the gate. `?speed=N` speeds up real-time clocks for testing. |
| `gm-suite/midnight-agency-backend.html` | GM credentials, player rank/codename/passcode, holiday overlay settings. |
| `js/ma-config.js` | **Single source of truth** for config, rank rules and the gate check. Loaded by all four pages above and used by `world-factbook.js`. |
| `js/holiday-overlay.js` | Snow/sleigh overlay. Scoped to `index.html` (`#pizza`) only. |
| `js/world-factbook.js` | `PLACES` (21 cities), `TRAVEL_MODES`, `findPlace`, `pickPlace`, `planRoute`. |
| `js/factbook-loader.js`, `js/factbook-ui.js` | Country data loader (lite/standard modes) and UI; test page `factboot-test.html`. |
| `js/suspect-generator.js` | `SuspectEngine`, `createFreshSuspect`, tiers, escape/promotion, cooldowns. |
| `js/crime-generator.js` | `CrimeEngine`: crime creation, lifecycle, heist stages. |
| `js/agent-roster.js` | `AgentRoster`: 8 named agents (2 per continent), starter crew of 3 on different continents, XP/levels, rapport, travel-time tiers, lucky-break odds. |
| `js/case-engine.js` | `CaseEngine`: one incident = one case arc; real-timestamp travel; clock held while an agent waits on scene; soft escalation; on-scene focus (Transit / Locals / Records); clue parts, decoys, lineup; persistence. |
| `js/warrant-engine.js` | `WarrantEngine`: warrant terminal, bust outcomes, stars / trust / agent XP, passport stamps, ring leader exposure. |
| `tests/wave2-sim.js` | `node tests/wave2-sim.js`: 6,600+ assertion simulation of whole cases against the real data. |
| `js/suspect-ui.js` | Drives `suspect-test.html` (the engine test bench). |
| `data/*.json` | `suspects.json`, `crime-rings.json`, `recurring-suspects.json`, `world-factbook.min.json`, `factbook-index.json`, `countries/<iso2>.json` (194). |
| `scripts/build-factbook.mjs` + `factbook-overrides.json` | Generate the factbook data. |
| `docs/place-schema.md` | Proposed canonical place ID/join schema (needs sign-off). |
| `suspect-test.html`, `factboot-test.html`, `tablet-test.html`, `tablet-test2.html`, `sw.js` | Test pages. `sw.js` only caches `tablet-test.html`; it is **not** an offline cache for the game. |

## 3. Storage

| Key | Where | Owner / contents |
|---|---|---|
| `midnight_agency_config_v1` | localStorage | `js/ma-config.js`. `gm{userName,passCode,clearanceKey}`, `player{rank,userName,passCode,stars,trust}`, `passcodeToppings`, `secretPhrase`, `gateUrl`, `npcs`, `christmasEnabled`, `snowDensity`, `snowSpeed`. |
| `midnight_agency_settings_v1` | localStorage | `js/factbook-loader.js`. `performanceMode` = `lite` or `standard`. |
| `midnight_agency_gate_v1` | sessionStorage | "Passcode gate passed" marker. Set by the gate; read by the dashboard and Case Desk. |
| `midnight_agency_cases_v1` | localStorage | `js/case-engine.js`. Whole game state: cases, agents, rings, passport, stats. Resetting it (`CaseEngine.reset()`) starts a fresh run; stars and trust live in the config key and are not reset. |
| `ma_desk_sound` | localStorage | Case Desk sound on/off. |

Rules (all in `js/ma-config.js`; do not reimplement them in a page):
- **Rank comes from stars:** `>= 5` Field Agent (level 3), `>= 2` Operative (level 2), else Rookie (level 1). The stored `player.rank` is only a cached copy.
- `WorldFactbook.TRAVEL_MODES[*].minRank` uses those levels: transit/road/ferry/rail = 1, flight = 2, charter = 3.
- Always write through `MidnightAgencyConfig.write / writePlayer / addStars / addTrust`. They re-read storage first, so a stale tab cannot overwrite a GM edit. Never keep your own star counter.
- Codename is only available past Rookie.
- The old `dashboardUrl` key was really the gate URL. It is migrated to `gateUrl` on read and dropped on the next write.
- **Gate:** `player-dashboard.html` and `case-desk.html` redirect to the gate unless the gate was passed this session. Testing bypass: add `?dev=1` (or `?bypass=1`) to the URL.

## 4. Current state

Working (verified in Node and in a landscape browser):
- Cover to gate to dashboard to Case Desk flow, GM settings, holiday overlay, shared rank/config contract.
- Suspect, crime and place wiring from Wave 1 (name pools, recruiting roots, hubs, lifecycle: open / escalated / cold / resolved).
- **Cases:** every stolen good is its own case with its own win screen, stars, XP/rapport and summary. A case is a route of 3 / 4 / 5 cities by rank (+1 for ring-leader cases). A clue about the next city comes with a Guess Who? board (3 / 4 / 5 decoys), each decoy provably contradicting the clue.
- **Clocks:** all real timestamps, so cases keep moving while the tablet is off. When an agent arrives and checks in, the case clock is held until the player gives orders. If the 12 h clock runs out the suspect slips one stop further and HQ sends a fresh clue (soft escalation); a case never disappears and stays solvable.
- **Agents:** 8 named agents. Each new run deals 3 starters on 3 different continents; Priya and Kofi unlock at Operative, Elsa at Field Agent, Diego after 3 solved cases. Travel: same landmass 15-45 min, same continent across water 60-120 min, other continent 2-6 h.
- **On scene:** Transit & Ports (best for trails), Locals & Shops (best for suspect details), Scene & Records (both, never empty). 10-20% lucky break (named city or a decisive suspect trait), with a distinct callout and agent voice.
- **Warrant and bust:** prints only with 1+ matches (gamble allowed with several). Clean bust = 1 star, +1 for no wrong turns, +2 for a ring leader; also +1 trust for a clean case, XP, rapport and passport stamps. Warrantless bust, wrong city and wrong person each cost trust and rapport.
- **Ring leaders:** each ring tracks `capturedMemberIds`, `intelFragments`, `leaderExposed`. Odds 18% / 50% / 55% / 95% / 100% on the 1st / 2nd / 3rd / 4th / 5th+ capture; an exposed leader appears as a new high-stakes case.
- Stars come only from solving cases and GM edits. The old tap-for-a-star placeholders on the dashboard were removed.

Not built:
- GM editors (case creator, dossier/ring editor, synth/passcode bench), and nothing in the GM suite shows case or agent state yet.
- **Offline.** Everything in the Case Desk is local files, but `sw.js` caches only `tablet-test.html`. The game needs a service worker (or similar) listing the pages, `js/`, `data/` (including the 21 playable countries) and the 21 flag SVGs before it can be trusted offline. The Dashboard still loads Google Fonts and Open-Meteo.
- The Case Desk needs a web server (it `fetch`es JSON). It will not run from a `file://` path.
- Voices use `speechSynthesis` with per-agent pitch/rate only. The radio filter and squelch from the original spec are not built.
- Tuning not validated with the real player: one sharp case promotes Rookie to Operative (2 stars); 12 h thwart clock; lucky-break odds.
- Known Factbook data errors: `drivingSide` always "right", capitals are centroids, Zimbabwe currency is BWP, Vatican population "Unknown", diacritic-broken tag slugs. The country data's flag text is "Official national flag of X" for every country, so clues use the flag SVG instead.
- The GM unlock compares against plaintext defaults (`GM` / `MIDNIGHT-GM`). Fine for a family game; do not reuse real passwords.

## 5. Audience and standing constraints (unchanged)

- 7-year-old niece (grade 2 French immersion; Ghostbusters, K-pop Demon Hunters, cat Samhain, Guess Who?). The giver is a relative with near-zero electronics skill, in Canada (Atlantic time).
- Spy themed, NOT Christmas themed (the holiday overlay is a small cover-page extra only). Hidden-in-play education, geography emphasis, French only sprinkled, other languages fine.
- Carmen Sandiego '98 style; "World Police Bureau" (invented, not Interpol); no franchise characters.
- Never requires the giver to physically deliver things. Weekly printed coded messages (code word unlocks a special case).
- ESP32 motion detector is a stretch goal and must never sound an alarm.
- Keep user-facing messages plain; no internal tool names.

## 6. Owner decisions (signed off 2026-11-26)

1. Place IDs: kebab-case city slug, joined to country data by `iso2`. No migration.
2. Beirut stays `region: "Asia"` + `subregion: "Mediterranean"`. Matching uses the five main regions and `iso2` only.
3. `Factbook.json` is retired reference material. Dashboard `COUNTRIES` keep working via `iso2`; add a city to `PLACES` only when it belongs on the playable map/travel graph.
4. Gate: `sessionStorage` marker plus `?dev=1` / `?bypass=1`. No passcode on every cold start.
5. Escape: linked crimes close as `resolved` with `outcome: "escaped"`.
6. Recovery-mode crimes start at the Escape stage (done), not Planning.

Still open: tablet logistics (App Store vs Google Play, Amazon Kids profile, GitHub account for hosting, printer model, her codename).

## 7. Remaining checklist (before Dec 25)

1. Offline: service worker + asset list, then test with the tablet in airplane mode. Replace Google Fonts / Open-Meteo on the dashboard with local fallbacks.
2. Host (GitHub Pages) or otherwise install; test on the actual tablet: touch targets 44px+, landscape, `speechSynthesis` voices, sound.
3. Play-test one real case with the niece and tune: promotion speed, clock lengths, clue difficulty (currency names like "Chilean peso" and the flag picture make Rookie clues fairly direct).
4. GM suite: show/reset case state; optional case creator.
5. Printable weekly coded-message sheet.
6. Post-Christmas: Alexa integration; ESP32 motion detector (silent).

## 8. Testing

`node tests/wave2-sim.js` (from the repo root; no dependencies) loads the real scripts and data and checks: route length, lineup and decoy rules (every decoy contradicts the clue, no clue names its own destination), starter crew continents, travel tiers, full clean playthroughs at all ranks, no-match / warrantless / false-arrest / wrong-city outcomes, lucky-break odds range, clock hold, soft escalation, persistence, ring-leader odds, and rank-based agent unlocks.

Browser checks done with Playwright at 1280x800: every page loads without errors; the gate redirects `case-desk.html` and the dashboard; the dashboard card and Cases tab open the desk; a scripted player completed a whole case through the UI (send, orders, clues, warrant, arrest, summary, reload). Not done: a real Fire tablet.
