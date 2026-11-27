/*
 * Wave 2 engine simulation. Run from the repo root:  node tests/wave2-sim.js
 * Plain Node, no dependencies. Loads the real browser scripts and real data files, then plays
 * whole cases through the public API (CaseEngine / WarrantEngine / AgentRoster).
 */
"use strict";
const fs = require("fs"), vm = require("vm"), assert = require("assert");

const store = {};
global.window = global;
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
for (const f of ["ma-config", "world-factbook", "crime-generator", "suspect-generator", "agent-roster", "case-engine", "warrant-engine"]) {
  vm.runInThisContext(fs.readFileSync(`js/${f}.js`, "utf8"), { filename: f });
}
const CE = CaseEngine, WE = WarrantEngine, AR = AgentRoster, MA = MidnightAgencyConfig, WF = WorldFactbook;
const sus = JSON.parse(fs.readFileSync("data/suspects.json"));
const rings = JSON.parse(fs.readFileSync("data/crime-rings.json"));
const roster = Object.assign({}, sus, { crimeRings: Object.assign({}, sus.crimeRings, rings.crimeRings) });

const MIN = 60000, H = 3600000, DAY = 24 * H;
const T0 = Date.UTC(2026, 11, 1);
let seed = 1;
const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const facts = (place) => {
  try { return CE.factsFromCountry(JSON.parse(fs.readFileSync(`data/countries/${place.iso2.toLowerCase()}.json`)), place); }
  catch (e) { return null; }
};
function setup(s, rankLevel) {
  seed = s; for (const k of Object.keys(store)) delete store[k];
  const ctx = { now: T0, rng, rankLevel: rankLevel || 1, roster, facts };
  return { ctx, st: CE.newState(ctx) };
}
const place = (id) => WF.findPlace(id);
const travel = (a, pid) => AR.travelMs(place(a.stationPlaceId), place(pid));
function idleNearest(st, pid) {
  return Object.values(st.agents).filter((a) => a.status === "idle").sort((a, b) => travel(a, pid) - travel(b, pid))[0];
}
function fly(st, ctx, c, agent, pid) {
  const d = CE.dispatchAgent(st, ctx, { caseId: c.id, agentId: agent.id, toPlaceId: pid });
  assert(d.ok, "dispatch failed " + JSON.stringify(d));
  ctx.now = d.arrivalTime + 1000;
  CE.tick(st, ctx);
  return d;
}

let checks = 0;
const ok = (cond, msg) => { checks += 1; assert(cond, msg); };

// ---------- 1. static invariants over many generated cases
{
  let cases = 0;
  for (let s = 1; s <= 120; s += 1) {
    const rank = 1 + (s % 3);
    const { ctx, st } = setup(s, [0, 1, 3, 5][rank]); // tier 1..3 -> ladder levels
    const c = CE.createCase(st, ctx, {});
    cases += 1;
    ok(c.route.length === { 1: 3, 2: 4, 3: 5 }[rank], `route length for rank ${rank}`);
    ok(new Set(c.route).size === c.route.length, "route has no repeated city");
    ok(c.lineup.some((x) => x.id === c.suspect.id), "true suspect is in the lineup");
    ok(c.lineup.length === { 1: 5, 2: 6, 3: 8 }[rank], "lineup size by rank");
    for (let i = 1; i < c.route.length; i += 1) {
      const stop = c.stops[i];
      ok(stop.candidateIds.includes(c.route[i]), "truth city among candidates");
      ok(stop.candidateIds.length === 1 + { 1: 3, 2: 4, 3: 5 }[rank] || stop.candidateIds.length > 1, "has decoys");
      const tf = facts(place(c.route[i]));
      for (const cid of stop.candidateIds) {
        if (cid === c.route[i]) continue;
        const pf = facts(place(cid));
        ok(stop.parts.some((p) => {
          const v = { currency: pf && pf.currencyCode, language: pf && pf.language, geography: pf && pf.geography, region: pf && pf.region, flag: pf && pf.flagSrc }[p.key];
          return String(v) !== p.value;
        }), `decoy ${cid} must contradict clue for ${c.route[i]}`);
      }
    }
  }
  console.log(`1. static invariants OK (${cases} cases, ${checks} checks)`);
}

// ---------- 2. starter crew + travel times
{
  for (let s = 1; s <= 60; s += 1) {
    const { st } = setup(s);
    const ags = Object.values(st.agents);
    ok(ags.length === 3, "3 starter agents");
    ok(new Set(ags.map((a) => place(a.stationPlaceId).region)).size === 3, "starter crew on 3 different continents");
  }
  // three tiers: same landmass 15-45 min, same continent across water 60-120 min, other continent 2-6 h
  let tiers = { land: 0, sea: 0, far: 0 };
  for (const a of WF.PLACES) for (const b of WF.PLACES) {
    if (a.id >= b.id) continue;
    const m = AR.travelMinutes(a, b);
    if (a.landmass && a.landmass === b.landmass) { ok(m >= 15 && m <= 45, `same landmass ${a.id}-${b.id}: ${m}`); tiers.land += 1; }
    else if (a.region === b.region) { ok(m >= 60 && m <= 120, `same continent ${a.id}-${b.id}: ${m}`); tiers.sea += 1; }
    else { ok(m >= 120 && m <= 360, `other continent ${a.id}-${b.id}: ${m}`); tiers.far += 1; }
  }
  ok(tiers.land > 0 && tiers.sea > 0 && tiers.far > 0, "all three tiers exist");
  console.log("2. starter crew + travel times OK");
}

// ---------- 3. full playthroughs, bot plays like a player would (orders until it has what it needs)
function playFull(s, rank, mode) {
  const { ctx, st } = setup(s, rank);
  MA.write({ player: { stars: rank === 1 ? 0 : rank === 2 ? 2 : 5, trust: 5 } });
  const c = CE.createCase(st, ctx, {});
  const starsBefore = MA.read().player.stars;
  let lucky = 0;
  for (let i = 0; i < c.route.length; i += 1) {
    const pid = c.route[i];
    let tries = 0;
    while (tries < 8) {
      tries += 1;
      const ag = idleNearest(st, pid);
      ok(!!ag, "an idle agent exists");
      fly(st, ctx, c, ag, pid);
      ok(ag.status === "onScene", "agent is on scene after arrival");
      const o = CE.giveOrders(st, ctx, { caseId: c.id, agentId: ag.id, focus: ["transit", "locals", "records"][tries % 3] });
      ok(o.ok, "orders accepted");
      if (o.lucky) lucky += 1;
      const done = i === c.route.length - 1 ? (WE.matchingLineup(c).length <= 2 || tries >= 6) : c.stops[i + 1].delivered;
      if (done) break;
    }
    if (i < c.route.length - 1) ok(c.stops[i + 1].delivered, "trail clue eventually delivered at stop " + i);
  }
  const finalAgent = Object.values(st.agents).find((a) => a.stationPlaceId === c.route[c.route.length - 1] && a.status === "idle");
  ok(!!finalAgent, "an agent is waiting at the suspect's city");
  const matches = WE.matchingLineup(c);
  ok(matches.some((m) => m.id === c.suspect.id), "true suspect still matches uncovered traits");

  if (mode === "no-matches") {
    const fake = Object.keys(c.uncovered)[0];
    c.uncovered[fake] = { category: "__none__", clueText: "x" };
    ok(WE.printWarrant(st, ctx, c.id, c.suspect.id).reason === "no-match", "printing blocked on 0 matches");
    return { c, st, ctx };
  }
  if (mode === "no-warrant") {
    const r = WE.attemptBust(st, ctx, { caseId: c.id, agentId: finalAgent.id });
    ok(r.outcome === "no-warrant", "warrantless bust outcome");
    ok(MA.read().player.trust === 4, "warrantless bust costs trust");
    ok(c.status !== "solved", "case stays open");
    return { c, st, ctx };
  }
  if (mode === "false-arrest") {
    const wrong = matches.find((m) => m.id !== c.suspect.id) || null;
    if (!wrong) return { c, st, ctx, skipped: true };
    ok(WE.printWarrant(st, ctx, c.id, wrong.id).ok, "gamble warrant prints on 1+ matches");
    const r = WE.attemptBust(st, ctx, { caseId: c.id, agentId: finalAgent.id });
    ok(r.outcome === "false-arrest", "false arrest outcome");
    ok(c.warrant === null && c.falseArrests === 1, "warrant cleared, false arrest counted");
    ok(MA.read().player.trust === 4, "false arrest costs trust");
    return { c, st, ctx };
  }
  if (mode === "wrong-city") {
    ok(WE.printWarrant(st, ctx, c.id, c.suspect.id).ok, "warrant prints");
    const other = Object.values(st.agents).find((a) => a.status === "idle" && a.stationPlaceId !== c.route[c.route.length - 1]);
    if (!other) return { c, st, ctx, skipped: true };
    const r = WE.attemptBust(st, ctx, { caseId: c.id, agentId: other.id });
    ok(r.outcome === "wrong-city" && c.wrongTrips === 1 && c.status !== "solved", "wrong-city bust");
    return { c, st, ctx };
  }
  ok(WE.printWarrant(st, ctx, c.id, c.suspect.id).ok, "right warrant prints");
  const r = WE.attemptBust(st, ctx, { caseId: c.id, agentId: finalAgent.id });
  ok(r.outcome === "clean" && c.status === "solved", "clean bust solves the case");
  const sum = c.summary;
  ok(sum.totalStars >= 1 && sum.totalStars === MA.read().player.stars - starsBefore, "stars match addStars: " + sum.totalStars);
  ok(sum.route.length === c.route.length && sum.newStamps.length >= 1, "summary has route and passport stamps");
  ok(c.crime.status === "resolved", "linked crime resolved");
  ok(st.stats.solved === 1, "solved counter");
  ok(sum.agents.some((a) => a.xp > 0), "agent XP awarded");
  return { c, st, ctx, lucky, sum };
}
{
  let solved = 0, luckyTotal = 0, orders = 0;
  for (let s = 1; s <= 60; s += 1) {
    const r = playFull(s, 1 + (s % 3), "clean");
    solved += 1; luckyTotal += r.lucky;
  }
  console.log(`3a. clean playthroughs OK (${solved} cases, ${luckyTotal} lucky breaks flagged)`);
  for (const mode of ["no-matches", "no-warrant", "false-arrest", "wrong-city"]) {
    let ran = 0;
    for (let s = 100; s < 140 && ran < 8; s += 1) { const r = playFull(s, 1 + (s % 3), mode); if (!r.skipped) ran += 1; }
    ok(ran > 0, "mode ran " + mode);
    console.log(`3b. ${mode} OK (${ran} runs)`);
  }
}

// ---------- 4. lucky break rate stays in 10-20%
{
  const def = AR.byId("mika");
  const low = AR.luckyBreakChance({ level: 1, rapport: 3 }, def, "locals");
  const high = AR.luckyBreakChance({ level: 3, rapport: 5 }, def, "transit");
  ok(low >= 0.10 && high <= 0.20 && high > low, `lucky chance range ${low}..${high}`);
  console.log("4. lucky-break odds OK");
}

// ---------- 5. real-time clocks: hold on scene, soft escalation, never silently killed
{
  const { ctx, st } = setup(5, 1);
  const c = CE.createCase(st, ctx, {});
  const ag = idleNearest(st, c.route[0]);
  const d = fly(st, ctx, c, ag, c.route[0]);
  ok(c.holdSince != null && c.pings.length === 1, "agent check-in holds the case clock");
  const remaining = c.crime.remainingMs;
  ctx.now += 3 * DAY; CE.tick(st, ctx);
  ok(c.crime.remainingMs === remaining && c.status === "active", "clock is held for days while HQ waits on orders");
  ok(c.route.length === 3 || c.route.length >= 3, "route intact");
  CE.giveOrders(st, ctx, { caseId: c.id, agentId: ag.id, focus: "locals" });
  ok(c.holdSince == null, "orders release the hold");
  const routeBefore = c.route.length, progressBefore = c.progress;
  ctx.now += 20 * H; CE.tick(st, ctx);
  ok(c.status === "active" || c.status === "cold", "never silently removed");
  ok(c.status !== "solved", "not solved by waiting");
  ctx.now += 30 * DAY; CE.tick(st, ctx);
  ok(CE.getCase(st, c.id) === c, "case still on the board after a month");
  ok(c.status !== "solved" && st.cases.length === 1, "case survives, still unsolved");
  // persistence round trip
  CE.save(st);
  const re = CE.load(ctx);
  ok(JSON.stringify(re.cases[0].route) === JSON.stringify(c.route) && re.agents[ag.id], "save/load round trip");
  console.log("5. hold + soft escalation + persistence OK  (route len", routeBefore, "->", c.route.length, ")");
}

// ---------- 6. ring leader exposure odds
{
  ok(WE.leaderOdds(1) >= 0.15 && WE.leaderOdds(1) <= 0.20, "1st catch 15-20%");
  ok(WE.leaderOdds(2) >= 0.45 && WE.leaderOdds(2) <= 0.60 && WE.leaderOdds(3) >= 0.45 && WE.leaderOdds(3) <= 0.60, "2nd-3rd 45-60%");
  ok(WE.leaderOdds(4) >= 0.90 && WE.leaderOdds(9) >= 0.90, "4th+ 90-100%");
  let exposures = 0, leaderCases = 0;
  for (let s = 200; s < 230; s += 1) {
    const { ctx, st } = setup(s, 5);
    const ringId = Object.keys(roster.crimeRings)[0];
    let guard = 0;
    while (guard++ < 12) {
      const c = CE.createCase(st, ctx, { ringId });
      for (const pid of c.route) { const ag = idleNearest(st, pid); fly(st, ctx, c, ag, pid); CE.giveOrders(st, ctx, { caseId: c.id, agentId: ag.id, focus: "records" }); }
      const fa = Object.values(st.agents).find((a) => a.stationPlaceId === c.route[c.route.length - 1]);
      WE.printWarrant(st, ctx, c.id, c.suspect.id);
      const r = WE.attemptBust(st, ctx, { caseId: c.id, agentId: fa.id });
      ok(r.outcome === "clean", "bust ok in ring loop");
      if (r.summary.newLeaderCaseId) {
        exposures += 1;
        const lc = CE.getCase(st, r.summary.newLeaderCaseId);
        ok(lc && lc.isLeaderCase && lc.status === "active", "leader case is on the active board");
        ok(st.rings[ringId].leaderExposed === true, "ring marked exposed");
        leaderCases += 1;
        break;
      }
    }
    ok(guard <= 6, "leader exposed within 5 captures (odds reach ~100%): took " + guard);
  }
  console.log(`6. ring leader exposure OK (${exposures}/30 rings exposed a leader within 5 catches)`);
}

// ---------- 7. agent unlocks follow rank
{
  const { ctx, st } = setup(3, 1);
  const before = Object.keys(st.agents).length;
  ctx.rankLevel = 2; CE.syncRoster(st, ctx);
  ok(Object.keys(st.agents).length > before, "rank 2 unlocks agents");
  ctx.rankLevel = 4; CE.syncRoster(st, ctx);
  ok(Object.keys(st.agents).includes("elsa"), "Operative (level 4) unlocks Elsa");
  // stars earned by a win promote the player and unlock the new agents in the same summary
  {
    const { ctx, st } = setup(21, 1);
    MA.write({ player: { stars: 1, trust: 5 } });
    const c = CE.createCase(st, ctx, {});
    for (const pid of c.route) { const ag = idleNearest(st, pid); fly(st, ctx, c, ag, pid); CE.giveOrders(st, ctx, { caseId: c.id, agentId: ag.id, focus: "records" }); }
    const fa = Object.values(st.agents).find((a) => a.stationPlaceId === c.route[c.route.length - 1]);
    WE.printWarrant(st, ctx, c.id, c.suspect.id);
    const r = WE.attemptBust(st, ctx, { caseId: c.id, agentId: fa.id });
    ok(MA.read().player.rank === "Rookie" && MA.read().player.solved === 1 && r.summary.unlockedAgents.includes("priya"), "Rookie promotion unlocks Priya in the same win");
  }
  console.log("7. roster unlocks OK");
}

console.log(`\nALL OK (${checks} assertions)`);
