// Run from the repo root:  node tests/wave3-step2.test.js
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const store = {};
global.window = global;
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
global.CustomEvent = class { constructor(n, o) { this.n = n; this.detail = o && o.detail; } };
global.dispatchEvent = () => {};
for (const f of ["js/ma-config.js", "js/world-factbook.js", "js/crime-generator.js", "js/suspect-generator.js", "js/agent-roster.js", "js/case-engine.js", "js/warrant-engine.js", "js/spycraft-factbook.js", "js/reliability.js"])
  vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });
const MA = MidnightAgencyConfig, CE = CaseEngine, AR = AgentRoster, WF = WorldFactbook;
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
function seeded(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const suspects = JSON.parse(fs.readFileSync("data/suspects.json"));
const rings = JSON.parse(fs.readFileSync("data/crime-rings.json")).crimeRings;
const roster = Object.assign({}, suspects, { crimeRings: Object.assign({}, suspects.crimeRings, rings) });
const cc = {};
const facts = p => { const k = p.iso2.toLowerCase(); if (!(k in cc)) cc[k] = JSON.parse(fs.readFileSync("data/countries/" + k + ".json")); return CE.factsFromCountry(cc[k], p); };

// ---- rank contract: stars AND solved cases
ok(MA.rankFromProgress(30, 0) === "Recruit", "stars alone cannot skip the ladder");
ok(MA.rankFromProgress(5, 3) === "Junior Analyst" && MA.rankFromProgress(27, 16) === "Spymaster", "ladder floors");
MA.write({ player: { stars: 9, solved: 2 } }); ok(MA.read().player.rank === "Rookie", "solved floor holds rank back");
MA.recordCaseSolved(); MA.recordCaseSolved(); MA.recordCaseSolved(); ok(MA.read().player.rank === "Operative", "solved cases promote");
MA.gmSetRank("Spymaster"); ok(MA.read().player.rank === "Spymaster", "GM can set any tier");
MA.gmSetRank("Rookie"); ok(MA.read().player.rank === "Rookie", "GM can demote");
ok(MA.timeMode() === "mission", "default time mode is mission");
MA.write({ timeMode: "real" }); ok(MA.timeMode() === "real", "GM real-time toggle persists"); MA.write({ timeMode: "mission" });
ok(MA.RANKS.length === 7 && WF.TRAVEL_MODES.flight.minRank === 3 && WF.TRAVEL_MODES.charter.minRank === 5, "travel ladder");

// ---- places carry coordinates and time zones
for (const p of WF.PLACES) { ok(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && /\//.test(p.tz), p.id + " has lat/lon/tz"); }

// ---- trips: legs, mission vs real time
const tokyo = WF.findPlace("tokyo"), london = WF.findPlace("london"), osaka = WF.findPlace("osaka");
const mis = AR.planTrip(tokyo, london, "mission"), real = AR.planTrip(tokyo, london, "real");
ok(mis.legs.length >= 1 && real.legs.length === mis.legs.length, "same legs in both modes");
ok(real.totalMinutes > 8 * 60 && real.totalMinutes < 30 * 60, "real Tokyo-London is hours-long: " + real.totalMinutes);
ok(mis.totalMinutes >= 120 && mis.totalMinutes <= 360, "mission trip stays in the tuned window: " + mis.totalMinutes);
ok(AR.planTrip(tokyo, osaka, "real").totalMinutes < real.totalMinutes, "short hop is quicker");
ok(Math.abs(AR.distanceKm(tokyo, london) - 9560) < 150, "great-circle distance");

// ---- live positions along a multi-leg trip
const T0 = 1_800_000_000_000;
const ctx = { now: T0, rng: seeded(5), rankLevel: 3, roster, facts, timeMode: "mission" };
const st = CE.newState(ctx); const c = CE.createCase(st, ctx, {});
ok(st.pings.some(p => p.kind === "case"), "new case pings the map");
const ag = Object.values(st.agents)[0];
const dest = c.route[0] === ag.stationPlaceId ? c.route[1] : c.route[0];
const r = CE.dispatchAgent(st, ctx, { caseId: c.id, agentId: ag.id, toPlaceId: dest });
ok(r.ok && r.legs.length >= 1, "dispatch returns legs");
ok(ag.assignment.legs[0].departureTime === T0 && ag.assignment.legs.at(-1).arrivalTime === ag.assignment.arrivalTime, "legs chain to the arrival time");
const mid = ag.assignment.arrivalTime - (ag.assignment.arrivalTime - T0) / 2;
const pos = CE.agentPositions(st, mid).find(p => p.id === ag.id);
ok(pos.status === "traveling" && typeof pos.lat === "number" && pos.etaMs > 0, "mid-trip position + ETA");
const start = CE.agentPositions(st, T0).find(p => p.id === ag.id), from = WF.findPlace(ag.assignment.fromPlaceId);
ok(Math.abs(start.lat - from.lat) < 0.01, "starts at the departure city");
CE.tick(st, { ...ctx, now: ag.assignment.arrivalTime + 1 });
ok(st.pings.some(p => p.kind === "arrived"), "arrival pings the map");
const done = CE.agentPositions(st, ag.assignment ? ag.assignment.arrivalTime + 1 : T0).find(p => p.id === ag.id);
ok(done.placeId === dest || done.status !== "traveling", "stationed after arrival");
const sp = { ...ctx, timeMode: "real", travelScale: 10 }; // ?speed=10 divides real time
const st2 = CE.newState(sp); const c2 = CE.createCase(st2, sp, {}); const a2 = Object.values(st2.agents)[0];
const d2 = c2.route.find(id => id !== a2.stationPlaceId);
const r2 = CE.dispatchAgent(st2, sp, { caseId: c2.id, agentId: a2.id, toPlaceId: d2 });
ok(r2.timeMode === "real" && r2.ok, "real mode dispatch");

// ---- spoiler policy: image clues carry no country name
for (let s = 1; s <= 60; s++) {
  const x = { ...ctx, rng: seeded(900 + s) }; const sx = CE.newState(x); const cx = CE.createCase(sx, x, {});
  for (const stop of Object.values(cx.stops).slice(1)) for (const part of stop.parts) {
    if (part.key !== "flag") continue;
    const pl = WF.findPlace(stop.placeId);
    ok(/assets\/flags\/[a-z]{2}\.svg$/.test(part.flagSrc), "flag clue is an image");
    ok(!part.text.toLowerCase().includes(pl.country.toLowerCase()) && !part.text.toLowerCase().includes(pl.city.toLowerCase()), "flag clue text does not name the place");
  }
}

// ---- coastline data
const land = JSON.parse(fs.readFileSync("data/geo/land.json"));
ok(land.countries.length > 150 && fs.statSync("data/geo/land.json").size < 120000, "land.json is compact");
const known = new Set(fs.readdirSync("data/countries").map(f => f.slice(0, 2).toUpperCase()));
ok(land.countries.filter(c => c.iso2).every(c => known.has(c.iso2)), "every tagged country has a Factbook file");
for (const p of WF.PLACES) ok(land.countries.some(c => c.iso2 === p.iso2), p.iso2 + " has a shape on the map");
ok(land.countries.every(c => c.rings.every(r => r.length % 2 === 0 && r.length >= 6)), "rings are lon/lat pairs");

// ---- country lookup for the Factbook
const idx = JSON.parse(fs.readFileSync("data/factbook-index.json"));
ok(SpycraftFactbook.registerCountryIndex(idx) >= 190, "country index registered");
ok(SpycraftFactbook.findCountry("jp").title === "Japan" && SpycraftFactbook.findEntry("country-jp").iso2 === "JP", "country lookup by iso2");
ok(SpycraftFactbook.getEntries("all").every(e => e.category !== "countries"), "countries stay out of the field-notes list");
for (const c of land.countries.filter(c => c.iso2)) ok(SpycraftFactbook.findCountry(c.iso2), c.iso2 + " map shape opens a Factbook entry");
// ---- source reliability: rates, rank gate, subtle (imperfect) hints
const RL = Reliability, N = 20000; let rg = seeded(77);
const rate = (tag, lvl) => { let w = 0; for (let i = 0; i < N; i++) if (RL.roll(rg, lvl, tag).wrong) w++; return w / N; };
ok(rate("confirmed", 7) === 0, "confirmed is never wrong");
ok(Math.abs(rate("witness", 3) - 0.10) < 0.015, "witness ~10% wrong");
ok(Math.abs(rate("rumour", 5) - 0.30) < 0.02, "rumour ~30% wrong");
ok(rate("rumour", 1) === 0 && rate("witness", 2) === 0, "Recruit and Rookie are never wrong");
let hw = 0, hr = 0, W = 0, R = 0;
for (let i = 0; i < N; i++) { const x = RL.roll(rg, 4, "rumour"); if (x.wrong) { W++; if (x.hint && RL.HINTS.rumour.includes(x.hint)) hw++; } else { R++; if (x.hint && RL.HINTS.rumour.includes(x.hint)) hr++; } }
ok(hw / W > 0.7 && hr / R > 0.1 && hr / R < 0.4, "hints favour wrong reports but are not a perfect tell");
ok([1, 2].every(l => { for (let i = 0; i < 500; i++) if (RL.roll(rg, l, "rumour").hint) return false; return true; }), "no hints before there can be errors");
const srcs = new Set(); for (let i = 0; i < 300; i++) srcs.add(RL.sourceFor("locals", rg));
ok(srcs.size === 3 && !new Set(Array.from({length:200},()=>RL.sourceFor("records", rg))).has("rumour"), "records never rumour");
console.log("wave3 step2: " + n + " checks OK");
