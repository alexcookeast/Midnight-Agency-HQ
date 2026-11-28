// Run from the repo root:  node tests/wave3-step4.test.js
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const store = {};
global.window = global;
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
global.CustomEvent = class { constructor(n, o) { this.n = n; this.detail = o && o.detail; } }; global.dispatchEvent = () => {};
for (const f of ["js/ma-config.js", "js/world-factbook.js", "js/crime-generator.js", "js/suspect-generator.js", "js/agent-roster.js", "js/reliability.js", "js/crumpled-notes.js", "js/chief-calls.js", "js/case-engine.js", "js/warrant-engine.js"])
  vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });
const CE = CaseEngine, WE = WarrantEngine, RL = Reliability;
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
function seeded(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const S = JSON.parse(fs.readFileSync("data/suspects.json")), R = JSON.parse(fs.readFileSync("data/crime-rings.json")).crimeRings;
const roster = Object.assign({}, S, { crimeRings: Object.assign({}, S.crimeRings, R) });
const cc = {}; const facts = p => { const k = p.iso2.toLowerCase(); if (!(k in cc)) cc[k] = JSON.parse(fs.readFileSync("data/countries/" + k + ".json")); return CE.factsFromCountry(cc[k], p); };
const T0 = 1_800_000_000_000;
const mk = (seed, level) => ({ now: T0, rng: seeded(seed), rankLevel: level, roster, facts, timeMode: "mission", timeScale: 1 });
const fresh = (seed, level) => { const ctx = mk(seed, level), st = CE.newState(ctx), c = CE.createCase(st, ctx, {}); return { ctx, st, c }; };

// ---- notebook: manual, never auto-filled
{
  const { ctx, st, c } = fresh(3, 4);
  ok(Object.keys(c.notebook.traits).length === 0, "notebook starts empty");
  for (let i = 0; i < 4; i++) CE.makeReport(c, ctx, CE.TRAIT_KEYS[i], { confirmed: true });
  ok(Object.keys(c.notebook.traits).length === 0, "reports never fill the notebook by themselves");
  ok(WE.matchingLineup(c).length === c.lineup.length, "no pins: everyone matches");
  const key = c.reports[0].traitKey; ok(CE.pinReport(c, c.reports[0].id) && c.notebook.traits[key].reportId === c.reports[0].id, "pin a report");
  const opts = CE.traitOptions(c, "build"); ok(opts.length >= 2 && CE.pinManual(c, "build", opts[0].category) && c.notebook.traits.build.manual === true, "pin a value by hand");
  ok(!CE.pinManual(c, "build", "__nope__"), "cannot pin a value nobody in the lineup has");
  CE.unpin(c, "build"); ok(!c.notebook.traits.build, "unpin");
  ok(JSON.stringify(JSON.parse(JSON.stringify(st))) === JSON.stringify(st), "notebook + reports survive JSON");
  CE.pinTruth(c); const m = WE.matchingLineup(c); ok(m.some(x => x.id === c.suspect.id) && m.length < c.lineup.length, "pinning the truth narrows to the suspect");
  CE.pinManual(c, "hairColor", CE.traitOptions(c, "hairColor").find(o => o.category !== c.suspect.traits.hairColor.category).category);
  ok(!WE.matchingLineup(c).some(x => x.id === c.suspect.id), "a wrong pin drops the true suspect from the lineup");
}

// ---- wrong reports: rates, gating, real wrong claims, confirmed always right
function rate(level, tag, trials) {
  let wrong = 0, tot = 0;
  for (let s = 1; s <= trials; s++) { const { ctx, c } = fresh(1000 + s, level); const key = CE.TRAIT_KEYS[s % 7]; const r = CE.makeReport(c, ctx, key, { tag }); tot++; if (!r.truth) { wrong++; ok(r.category !== c.suspect.traits[key].category && c.lineup.some(l => l.traits[key].category === r.category), "wrong claim is a value a lineup member really has"); } }
  return wrong / tot;
}
ok(rate(7, "confirmed", 300) === 0, "confirmed never wrong"); ok(rate(1, "rumour", 300) === 0 && rate(2, "rumour", 300) === 0, "Recruit and Rookie never get wrong reports");
const w = rate(3, "witness", 1500), r = rate(5, "rumour", 1500);
ok(w > 0.05 && w < 0.15, "witness ~10% wrong: " + w); ok(r > 0.23 && r < 0.37, "rumour ~30% wrong: " + r);
{ const { ctx, c } = fresh(9, 2); const rp = CE.makeReport(c, ctx, "build", { tag: "rumour" }); ok(rp.shown === false && rp.hint === null, "young ranks see no tag or hint"); }

// ---- through the real orders flow: hints ride along, wrong claims reach the feed, a second opinion can fix it
function orders(seed, level, focus) {
  const ctx = Object.assign(mk(seed, level), { timeScale: 1 }), st = CE.newState(ctx), c = CE.createCase(st, ctx, {}), ag = Object.values(st.agents)[0];
  CE.dispatchAgent(st, ctx, { caseId: c.id, agentId: ag.id, toPlaceId: c.route[0] }); ctx.now = ag.assignment.arrivalTime + 1000; CE.tick(st, ctx);
  CE.giveOrders(st, ctx, { caseId: c.id, agentId: ag.id, focus }); return { ctx, st, c, ag };
}
{
  let wrongSeen = 0, hintOnWrong = 0, tags = 0, anon = 0, anonOk = 0;
  for (let s = 1; s <= 400; s++) {
    const x = orders(s, 5, ["locals", "transit", "records"][s % 3]);
    for (const rep of x.c.reports) { if (x.c.board.some(b => b.reportId === rep.id && !b.agentId && !b.anonymous)) continue; if (!rep.truth) { wrongSeen++; ok(rep.tag !== "confirmed", "confirmed is never the wrong one"); if (rep.hint) hintOnWrong++; } }
    for (const m of x.c.comms) { if (m.reliability) tags++; if (m.from.kind === "informant") { anon++; if (m.channel === "call" && m.callerId.anonymous && m.callerId.label === "Unknown caller" && m.reliability === "rumour") anonOk++; } }
  }
  ok(wrongSeen > 5, "wrong reports occur in real play (" + wrongSeen + ")"); ok(hintOnWrong / wrongSeen > 0.5, "most wrong reports carry a subtle hint"); ok(tags > 50, "reliability tags reach the inbox");
  ok(anon > 3 && anon === anonOk, "anonymous tips are calls from an Unknown caller, tagged Rumour (" + anon + ")");
  let young = 0; for (let s = 1; s <= 100; s++) { const x = orders(s, 2, "locals"); young += x.c.reports.filter(r => !r.truth).length + x.c.comms.filter(m => m.reliability).length; } ok(young === 0, "Rookie never sees wrong reports or tags");
}
{ // a trait whose only reports were wrong gets a second opinion; the dice stay deterministic
  const { ctx, c } = fresh(14, 5); CE.TRAIT_KEYS.forEach(k => { c.uncovered[k] = c.suspect.traits[k]; }); const key = "hairStyle";
  const bad = { id: "rX", traitKey: key, category: "__x__", clueText: "x", tag: "rumour", hint: null, shown: true, truth: false }; c.reports = [bad];
  const picked = []; for (let i = 0; i < 40; i++) { const k = CE.uncoverTrait(c, ctx, false); if (k) picked.push(k); }
  ok(picked.length > 0 && picked.every(k => k === key), "after all traits are known, only wrong-reported ones are re-opened");
  c.reports.push({ id: "rY", traitKey: key, category: c.suspect.traits[key].category, truth: true }); ok(CE.uncoverTrait(c, ctx, false) === null, "once a true report exists nothing is re-opened");
  const a = fresh(77, 5), b = fresh(77, 5); ok(JSON.stringify(a.c.reports) === JSON.stringify(b.c.reports), "reports are deterministic per seed");
}

// ---- channel voice: texts chat from agents, emails are structured, calls are spoken
{
  const x = orders(31, 4, "locals"), texts = [], emails = [], vms = [];
  for (let s = 1; s <= 400; s++) { const y = orders(s, 4, ["transit", "locals", "records"][s % 3]); y.c.comms.forEach(m => { (m.channel === "text" ? texts : m.channel === "email" ? emails : m.channel === "voicemail" ? vms : []).push(m); }); }
  ok(texts.length > 20 && texts.every(m => m.from.kind === "agent" && m.callerId.number), "every text is from a roster agent");
  ok(texts.some(m => /!|🦊|🦉|🦁|🐢|🐺|❄️|🦋|🦅/.test(m.body)) && texts.every(m => !/^[A-Z ]+\n/.test(m.body)), "texts read like quick chat, not dispatches");
  ok(emails.length > 20 && emails.every(m => /^[A-Z ()]+\n/.test(m.body) && /Next step:|Details:/.test(m.body) && m.from.kind === "hq"), "emails are structured dispatches from HQ");
  ok(emails.every(m => m.subject && m.from.name === "HQ"), "emails carry a subject and an HQ sender");
  ok(vms.length === 0 || vms.every(m => /^Hi boss, it's/.test(m.body)), "voicemails are spoken in first person");
  ok(x.c.comms.every(m => m.callerId && m.callerId.label), "everything has a caller id");
}
console.log("wave3 step4: " + n + " checks OK");
