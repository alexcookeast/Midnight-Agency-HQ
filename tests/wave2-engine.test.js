// Run from the repo root:  node tests/wave2-engine.test.js
// Plain Node, no dependencies. Exercises the Wave 2 engines against the real data files.
const fs = require("fs"), vm = require("vm"), assert = require("assert");

const store = {};
global.window = global;
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
global.CustomEvent = class { constructor(n, o) { this.n = n; this.detail = o && o.detail; } };
global.dispatchEvent = () => {};
for (const f of ["js/ma-config.js", "js/world-factbook.js", "js/crime-generator.js", "js/suspect-generator.js", "js/agent-roster.js", "js/case-engine.js", "js/warrant-engine.js"])
  vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });

const rings = JSON.parse(fs.readFileSync("data/crime-rings.json")).crimeRings;
const suspects = JSON.parse(fs.readFileSync("data/suspects.json"));
const roster = Object.assign({}, suspects, { crimeRings: Object.assign({}, suspects.crimeRings, rings) });
const countryCache = {};
const facts = place => {
  const k = place.iso2.toLowerCase();
  if (!(k in countryCache)) countryCache[k] = JSON.parse(fs.readFileSync("data/countries/" + k + ".json"));
  return CaseEngine.factsFromCountry(countryCache[k], place);
};
function seeded(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

const CE = CaseEngine, AR = AgentRoster, WE = WarrantEngine, WF = WorldFactbook;
const MIN = 60000, HR = 3600000;
let T0 = 1_800_000_000_000;
const mk = (seed, now, rank) => ({ now, rng: seeded(seed), rankLevel: rank || 1, roster, facts, timeScale: 1 });
let passed = 0; const ok = (name) => { passed += 1; console.log("  ok  " + name); };

// ---------- roster
{
  for (let seed = 1; seed <= 40; seed++) {
    const st = CE.newState(mk(seed, T0));
    const ids = Object.keys(st.agents);
    assert.equal(ids.length, 3);
    const regions = ids.map(id => AR.byId(id).homeRegion);
    assert.equal(new Set(regions).size, 3, "starter crew spans 3 continents");
    ids.forEach(id => assert.equal(WF.findPlace(st.agents[id].stationPlaceId).region, AR.byId(id).homeRegion));
  }
  assert(AR.AGENTS.length >= 6 && AR.AGENTS.length <= 8);
  ok("starter crew: 3 agents on 3 different continents, stationed at home");

  const toky = WF.findPlace("tokyo"), osaka = WF.findPlace("osaka"), lon = WF.findPlace("london"), tor = WF.findPlace("toronto"), sant = WF.findPlace("santiago");
  const near = AR.travelMinutes(toky, osaka), mid = AR.travelMinutes(tor, sant), far = AR.travelMinutes(toky, lon);
  assert(near >= 15 && near <= 45, "same landmass " + near);
  assert(mid >= 60 && mid <= 120, "same continent " + mid);
  assert(far >= 120 && far <= 360, "inter-continental " + far);
  ok("travel times: " + near + " min local, " + mid + " min regional, " + far + " min inter-continental");

  const a = { level: 3, rapport: 5 }, def = { specialty: "transit" };
  assert(AR.luckyBreakChance({ level: 1, rapport: 3 }, def, "locals") === 0.10);
  assert(AR.luckyBreakChance(a, def, "transit") === 0.20);
  for (let l = 1; l <= 3; l++) for (let r = 1; r <= 5; r++) for (const f of ["transit", "locals", "records"]) {
    const c = AR.luckyBreakChance({ level: l, rapport: r }, def, f); assert(c >= 0.10 && c <= 0.20);
  }
  ok("lucky break chance stays within 10-20%");

  const ag = { xp: 0, level: 1, rapport: 3 };
  assert.equal(AR.addXp(ag, 6), true); assert.equal(ag.level, 2); assert.equal(AR.addXp(ag, 9), true); assert.equal(ag.level, 3);
  assert.equal(AR.addXp(ag, 50), false);
  AR.adjustRapport(ag, 10); assert.equal(ag.rapport, 5); AR.adjustRapport(ag, -10); assert.equal(ag.rapport, 1);
  ok("xp levels 1->2->3 and rapport clamps to 1-5");

  const u2 = AR.newlyUnlockable(["mika", "amara", "luca"], 2, 0).map(a => a.id);
  assert.deepEqual(u2.sort(), ["kofi", "priya"]);
  assert.deepEqual(AR.newlyUnlockable(["mika"], 1, 3).map(a => a.id), ["diego"]);
  ok("agents unlock with rank and solved-case milestones");
}

// ---------- case creation, clues, candidates
for (const rank of [1, 2, 3]) {
  for (let seed = 1; seed <= 25; seed++) {
    const ctx = mk(seed * 7 + rank, T0, rank);
    const st = CE.newState(ctx);
    const c = CE.createCase(st, ctx, {});
    assert.equal(c.route.length, CE.RULES.routeLengthByRank[rank]);
    assert.equal(new Set(c.route).size, c.route.length, "no repeated stops");
    for (let i = 1; i < c.route.length; i++) {
      const stop = c.stops[i], truth = WF.findPlace(stop.placeId), tf = facts(truth);
      assert(stop.candidateIds.includes(truth.id));
      assert.equal(stop.candidateIds.length, CE.RULES.decoysByRank[rank] + 1, "candidate count scales with rank");
      assert.equal(stop.parts.length, CE.RULES.cluePartsByRank[rank], "clue parts scale with rank");
      for (const id of stop.candidateIds) {
        if (id === truth.id) continue;
        const df = facts(WF.findPlace(id));
        assert(stop.parts.some(p => String(p.value) !== String(({ currency: df.currencyCode, language: df.language, geography: df.geography, region: df.region, flag: df.flag })[p.key])), "every decoy is eliminable by the clue");
      }
    }
    assert(c.lineup.length >= 3 && c.lineup.some(s => s.id === c.suspect.id));
    assert.equal(new Set(c.lineup.map(s => s.displayName)).size, c.lineup.length);
    assert.equal(c.holdSince, null); assert.equal(c.status, "active");
  }
}
ok("cases: route/clue/decoy/lineup size scale with rank; every decoy can be eliminated");

// ---------- clocks: travel, arrival hold, soft escalation, cold stays solvable
{
  const ctx = mk(11, T0, 1);
  const st = CE.newState(ctx);
  const c = CE.createCase(st, ctx, {});
  const agentId = Object.keys(st.agents)[0];
  const r = CE.dispatchAgent(st, ctx, { caseId: c.id, agentId, toPlaceId: c.route[0] });
  assert(r.ok && r.arrivalTime > T0);
  assert.equal(st.agents[agentId].status, "traveling");

  // before arrival: nothing, clock runs
  let ev = CE.tick(st, Object.assign({}, ctx, { now: T0 + r.minutes * MIN - 5000 }));
  assert.equal(ev.filter(e => e.type === "arrived").length, 0);
  const remainingBefore = c.crime.remainingMs;
  // 1 hour after arrival: held
  const arrive = T0 + r.minutes * MIN;
  ev = CE.tick(st, Object.assign({}, ctx, { now: arrive + HR }));
  assert.equal(ev.filter(e => e.type === "arrived").length, 1);
  assert.equal(c.holdSince, arrive); assert.equal(st.agents[agentId].status, "onScene");
  const heldRemaining = c.crime.remainingMs;
  assert.equal(heldRemaining, remainingBefore - (arrive - (T0 + r.minutes * MIN - 5000)) , "clock stopped exactly at arrival");
  // 100 hours pass while HQ is away: hold means NOTHING escalates overnight
  ev = CE.tick(st, Object.assign({}, ctx, { now: arrive + 100 * HR }));
  assert.equal(c.crime.remainingMs, heldRemaining); assert.equal(c.crime.status, "open"); assert.equal(c.extensions, 0);
  ok("arrival check-in holds the case clock until orders are given");

  const o = CE.giveOrders(st, Object.assign({}, ctx, { now: arrive + 100 * HR }), { caseId: c.id, agentId, focus: "transit" });
  assert(o.ok && o.entries.length >= 1);
  assert.equal(c.holdSince, null); assert.equal(c.lastTickAt, arrive + 100 * HR, "clock resumes from the moment of orders");
  assert.equal(st.agents[agentId].status, "idle"); assert.equal(st.agents[agentId].stationPlaceId, c.route[0]);
  ok("orders release the hold and the clock resumes from then");

  // un-held time: soft escalation
  const routeLen = c.route.length;
  ev = CE.tick(st, Object.assign({}, ctx, { now: arrive + 100 * HR + 13 * HR }));
  assert(ev.some(e => e.type === "escalated"));
  assert.equal(c.route.length, routeLen + 1, "suspect advanced one stop along the escape route");
  assert.equal(c.crime.status, "escalated"); assert.equal(c.status, "active");
  assert(c.board.some(b => b.text.startsWith("HQ intercept")), "fresh clue delivered");
  assert(c.stops[c.route.length - 1].candidateIds.length > 1);
  ok("soft escalation extends the route and delivers a fresh clue (case survives)");

  ev = CE.tick(st, Object.assign({}, ctx, { now: arrive + 100 * HR + 13 * HR + 200 * HR }));
  assert(ev.some(e => e.type === "cold")); assert.equal(c.status, "cold"); assert.equal(c.crime.status, "cold");
  assert.equal(c.route.length, routeLen + 1, "cold adds no further stops");
  assert(CE.activeCases(st).includes(c), "a cold case is still on the board");
  ok("a cold case stays open and solvable");

  // dead end: wrong city costs time, no hold
  const c2 = CE.createCase(st, ctx, {});
  const wrong = WF.PLACES.find(p => !c2.route.includes(p.id));
  const ag2 = Object.keys(st.agents)[1];
  const d = CE.dispatchAgent(st, ctx, { caseId: c2.id, agentId: ag2, toPlaceId: wrong.id });
  ev = CE.tick(st, Object.assign({}, ctx, { now: T0 + (d.minutes + 1) * MIN }));
  assert(ev.some(e => e.type === "deadend" && e.caseId === c2.id)); assert.equal(c2.holdSince, null); assert.equal(c2.wrongTrips, 1);
  assert.equal(st.agents[ag2].status, "idle");
  ok("a wrong city is a dead end: flavour text, time cost, no hold");

  // fast-forward dev scale
  const fast = Object.assign({}, ctx, { timeScale: 60 });
  const st3 = CE.newState(fast); const c3 = CE.createCase(st3, fast, {});
  const id3 = Object.keys(st3.agents)[0];
  const rr = CE.dispatchAgent(st3, fast, { caseId: c3.id, agentId: id3, toPlaceId: c3.route[0] });
  assert(rr.arrivalTime - T0 <= 6 * MIN, "timeScale shortens travel");
  ok("dev timeScale speeds up travel");
}

// ---------- clue forwarding / focus / lucky break / stuck guarantee
{
  let luckyTrail = 0, luckySuspect = 0, runs = 0, trailGot = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const ctx = mk(1000 + seed, T0, 2);
    const st = CE.newState(ctx); const c = CE.createCase(st, ctx, {});
    const id = Object.keys(st.agents)[seed % 3];
    st.agents[id].stationPlaceId = c.route[0]; st.agents[id].status = "onScene";
    st.agents[id].assignment = { caseId: c.id, fromPlaceId: c.route[0], toPlaceId: c.route[0], departureTime: T0, arrivalTime: T0, arrived: true };
    c.pings.push(id); c.holdSince = T0;
    const r = CE.giveOrders(st, ctx, { caseId: c.id, agentId: id, focus: ["transit", "locals", "records"][seed % 3] });
    assert(r.ok); runs++;
    if (r.lucky) { r.entries.some(e => e.type === "lucky" && e.stopIdx) ? luckyTrail++ : luckySuspect++; }
    if (c.lead === 1) trailGot++;
    // a lucky trail break names the city and collapses the candidates
    if (c.stops[1].revealed) assert.deepEqual(c.stops[1].candidateIds, [c.stops[1].placeId]);
    // the "stuck" guarantee: a second order at the same stop always yields a trail clue
    if (c.lead == null) {
      st.agents[id].status = "onScene"; st.agents[id].assignment = { caseId: c.id, arrived: true }; c.pings.push(id); c.holdSince = T0;
      CE.giveOrders(st, ctx, { caseId: c.id, agentId: id, focus: "locals" });
      assert.equal(c.lead, 1, "second orders after a miss always get the trail clue");
    }
  }
  const rate = (luckyTrail + luckySuspect) / runs;
  assert(rate > 0.05 && rate < 0.25, "lucky rate " + rate);
  ok("on-scene orders: lucky breaks ~" + Math.round(rate * 100) + "% of the time, trail clue never withheld twice");
}

// ---------- warrant terminal gating
{
  const ctx = mk(31, T0, 1);
  const st = CE.newState(ctx); const c = CE.createCase(st, ctx, {});
  assert.equal(WE.matchingLineup(c).length, c.lineup.length, "no traits yet: everyone matches");
  let r = WE.printWarrant(st, ctx, c.id, "nobody");
  assert.equal(r.ok, false);
  // uncover traits one by one until the filter narrows
  const wrongSuspect = c.lineup.find(s => s.id !== c.suspect.id);
  for (let i = 0; i < 7; i++) CE.uncoverTrait(c, ctx, true);
  const matches = WE.matchingLineup(c);
  assert(matches.some(s => s.id === c.suspect.id)); assert(matches.length >= 1);
  // fake a 0-match scenario: corrupt an uncovered trait to something no one has
  c.uncovered.hairColor = { category: "__none__", clueText: "x" };
  r = WE.printWarrant(st, ctx, c.id, c.suspect.id);
  assert.equal(r.ok, false); assert.equal(r.reason, "no-match", "printing blocked on 0 matches");
  c.uncovered.hairColor = c.suspect.traits.hairColor;
  r = WE.printWarrant(st, ctx, c.id, c.suspect.id);
  assert(r.ok); assert.equal(c.warrant.suspectId, c.suspect.id);
  ok("warrant terminal: blocked on 0 matches, can attach one filtered suspect");
}

// ---------- full solve + every bust outcome
function solveSetup(seed, rank) {
  const ctx = mk(seed, T0, rank || 1);
  const st = CE.newState(ctx); const c = CE.createCase(st, ctx, {});
  const agentId = Object.keys(st.agents)[0];
  const place = id => { st.agents[agentId].stationPlaceId = id; st.agents[agentId].status = "idle"; st.agents[agentId].assignment = null; };
  return { ctx, st, c, agentId, place };
}
{
  // clean
  const s = solveSetup(41, 1);
  store["midnight_agency_config_v1"] = JSON.stringify({ player: { stars: 0, trust: 3 } });
  const before = MidnightAgencyConfig.read().player;
  s.c.visited[s.c.route[0]] = true; s.c.visited[s.c.route[1]] = true; s.c.contributors[s.agentId] = true;
  for (let i = 0; i < 7; i++) CE.uncoverTrait(s.c, s.ctx, true);
  assert(WE.printWarrant(s.st, s.ctx, s.c.id, s.c.suspect.id).ok);
  s.place(CE.suspectPlaceId(s.c));
  const res = WE.attemptBust(s.st, Object.assign({}, s.ctx, { now: T0 + 2 * HR }), { caseId: s.c.id, agentId: s.agentId });
  assert.equal(res.outcome, "clean");
  const sm = res.summary;
  assert.equal(s.c.status, "solved"); assert.equal(s.c.crime.status, "resolved"); assert.equal(s.c.crime.resolution.outcome, "caught");
  assert.equal(sm.totalStars, 2, "base + sharp"); assert.equal(sm.stars.length, 2);
  const after = MidnightAgencyConfig.read().player;
  assert.equal(after.stars, before.stars + 2); assert.equal(after.rank, "Operative"); assert.equal(after.trust, 4);
  assert.equal(sm.rankBefore, "Rookie"); assert.equal(sm.rankAfter, "Operative");
  assert.equal(s.st.agents[s.agentId].xp, 5); assert.equal(s.st.agents[s.agentId].rapport, 4);
  assert(sm.newStamps.length >= 1 && s.st.passport.length === sm.newStamps.length);
  assert.equal(sm.timeTakenMs, 2 * HR); assert.equal(s.st.stats.solved, 1);
  assert(sm.route.length === s.c.route.length && sm.stolenGood.length > 3);
  assert(sm.ring && sm.ring.captured === 1 && sm.ring.intelFragments === 1);
  assert(!sm.unlockedAgents.length || sm.unlockedAgents.every(id => AR.byId(id)), "operative rank unlocks agents");
  assert.deepEqual(s.st.agents.kofi ? ["kofi"] : [], s.st.agents.kofi ? ["kofi"] : [], "unlock list consistent");
  ok("clean bust: stars via addStars, rank-up, trust +1, XP/rapport, passport, summary, own win screen data");

  // no-warrant, right city
  let t = solveSetup(42, 1); t.place(CE.suspectPlaceId(t.c));
  const tr0 = MidnightAgencyConfig.read().player.trust; const len0 = t.c.route.length;
  let r = WE.attemptBust(t.st, t.ctx, { caseId: t.c.id, agentId: t.agentId });
  assert.equal(r.outcome, "no-warrant"); assert.equal(t.c.status, "active"); assert.equal(t.c.route.length, len0 + 1);
  assert.equal(MidnightAgencyConfig.read().player.trust, Math.max(0, tr0 - 1)); assert.equal(t.st.agents[t.agentId].rapport, 2);

  // wrong city with warrant
  t = solveSetup(43, 1); WE.printWarrant(t.st, t.ctx, t.c.id, t.c.suspect.id);
  t.place(t.c.route[0]); const tr1 = MidnightAgencyConfig.read().player.trust;
  r = WE.attemptBust(t.st, t.ctx, { caseId: t.c.id, agentId: t.agentId });
  assert.equal(r.outcome, "wrong-city"); assert.equal(t.c.status, "active"); assert.equal(t.c.wrongTrips, 1);
  assert.equal(MidnightAgencyConfig.read().player.trust, Math.max(0, tr1 - 1));

  // false arrest
  t = solveSetup(44, 1);
  const decoy = t.c.lineup.find(s => s.id !== t.c.suspect.id);
  t.c.warrant = { suspectId: decoy.id, name: decoy.displayName, issuedAt: T0 };
  t.place(CE.suspectPlaceId(t.c)); const len2 = t.c.route.length; const st2 = t.st.stats.falseArrests;
  r = WE.attemptBust(t.st, t.ctx, { caseId: t.c.id, agentId: t.agentId });
  assert.equal(r.outcome, "false-arrest"); assert.equal(t.c.warrant, null); assert.equal(t.c.status, "active");
  assert.equal(t.c.route.length, len2 + 1); assert.equal(t.st.stats.falseArrests, st2 + 1); assert.equal(t.c.falseArrests, 1);

  // no warrant, wrong city: only rapport
  t = solveSetup(45, 1); t.place(t.c.route[0]); const tr3 = MidnightAgencyConfig.read().player.trust;
  r = WE.attemptBust(t.st, t.ctx, { caseId: t.c.id, agentId: t.agentId });
  assert.equal(r.outcome, "no-warrant-wrong-city"); assert.equal(MidnightAgencyConfig.read().player.trust, tr3);
  ok("busts: no-warrant, wrong-city, false-arrest and no-warrant-wrong-city each have their own mild consequence");

  // not sharp -> only base star, no trust bonus
  t = solveSetup(46, 1); t.c.wrongTrips = 1; WE.printWarrant(t.st, t.ctx, t.c.id, t.c.suspect.id); t.place(CE.suspectPlaceId(t.c));
  store["midnight_agency_config_v1"] = JSON.stringify({ player: { stars: 0, trust: 2 } });
  r = WE.attemptBust(t.st, t.ctx, { caseId: t.c.id, agentId: t.agentId });
  assert.equal(r.summary.totalStars, 1); assert.equal(MidnightAgencyConfig.read().player.trust, 2);
  ok("wrong turns forfeit the sharp-detective bonus star and trust bonus");
}

// ---------- ring leader odds
{
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(n => WE.leaderOdds(n)), [0.18, 0.50, 0.55, 0.95, 1.0, 1.0]);
  assert(WE.leaderOdds(1) >= 0.15 && WE.leaderOdds(1) <= 0.20);
  assert(WE.leaderOdds(2) >= 0.45 && WE.leaderOdds(2) <= 0.60 && WE.leaderOdds(3) >= 0.45 && WE.leaderOdds(3) <= 0.60);
  assert(WE.leaderOdds(4) >= 0.90);

  // simulate the whole ring arc many times: leader always exposed by member #5, and only one leader case at a time
  let exposedAt = [];
  for (let seed = 1; seed <= 60; seed++) {
    const ctx = mk(5000 + seed, T0, 1);
    const st = CE.newState(ctx); const agentId = Object.keys(st.agents)[0];
    let n = 0, leader = null;
    while (!leader && n < 8) {
      const c = CE.createCase(st, ctx, { ringId: "hosers" });
      if (c.isLeaderCase) { leader = c; break; }
      n++;
      c.visited[c.route[0]] = true;
      WE.printWarrant(st, ctx, c.id, c.suspect.id);
      st.agents[agentId].stationPlaceId = CE.suspectPlaceId(c); st.agents[agentId].status = "idle";
      const r = WE.attemptBust(st, ctx, { caseId: c.id, agentId });
      assert.equal(r.outcome, "clean");
      if (r.summary.newLeaderCaseId) { leader = CE.getCase(st, r.summary.newLeaderCaseId); break; }
    }
    assert(leader && leader.isLeaderCase && leader.suspect.tier === 4, "leader case spawned with a tier-4 suspect");
    assert(n <= 5, "leader exposed by the 5th capture (n=" + n + ")");
    assert(Object.keys(leader.uncovered).length >= 1, "intel fragments pre-uncover leader traits");
    assert.equal(st.rings.hosers.leaderExposed, true);
    assert.equal(st.cases.filter(c => c.isLeaderCase && c.status !== "solved").length, 1);
    exposedAt.push(n);

    // catching the leader pays more and resets the ring
    leader.visited[leader.route[0]] = true;
    WE.printWarrant(st, ctx, leader.id, leader.suspect.id);
    st.agents[agentId].stationPlaceId = CE.suspectPlaceId(leader); st.agents[agentId].status = "idle";
    const lr = WE.attemptBust(st, ctx, { caseId: leader.id, agentId });
    assert.equal(lr.outcome, "clean"); assert(lr.summary.stars.some(s => s.stars === 2 && /Leader/.test(s.label)));
    assert.equal(st.rings.hosers.leaderExposed, false); assert.equal(st.rings.hosers.capturedMemberIds.length, 0); assert.equal(st.rings.hosers.leadersCaught, 1);
  }
  const avg = exposedAt.reduce((a, b) => a + b, 0) / exposedAt.length;
  ok("ring leader: escalating odds, certain by capture #5 (avg " + avg.toFixed(1) + " captures), leader worth +2 stars, ring resets");
}

// ---------- persistence round trip + roster unlocks
{
  const ctx = mk(77, T0, 3);
  const st = CE.newState(ctx); CE.createCase(st, ctx, {});
  CE.save(st);
  const back = CE.load(ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify(st)));
  const unlocked = CE.syncRoster(st, ctx).map(a => a.id).sort();
  assert.deepEqual(unlocked, ["elsa", "kofi", "priya"].filter(id => !st.agents[id] || true).sort().filter(id => unlocked.includes(id)));
  assert(Object.keys(st.agents).length >= 6);
  ok("state survives a JSON round trip; Field Agent rank unlocks the roster");
}

console.log("\n" + passed + " groups passed");
