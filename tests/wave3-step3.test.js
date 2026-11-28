// Run from the repo root:  node tests/wave3-step3.test.js
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const store = {};
global.window = global;
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
global.CustomEvent = class { constructor(n, o) { this.n = n; this.detail = o && o.detail; } }; global.dispatchEvent = () => {};
for (const f of ["js/ma-config.js", "js/world-factbook.js", "js/crime-generator.js", "js/suspect-generator.js", "js/agent-roster.js", "js/reliability.js", "js/crumpled-notes.js", "js/chief-calls.js", "js/case-engine.js", "js/warrant-engine.js", "js/comms-audio.js"])
  vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });
const CE = CaseEngine, AR = AgentRoster, WF = WorldFactbook, CC = ChiefCalls, CN = CrumpledNotes, CA = CommsAudio;
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
function seeded(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const suspects = JSON.parse(fs.readFileSync("data/suspects.json")), rings = JSON.parse(fs.readFileSync("data/crime-rings.json")).crimeRings;
const roster = Object.assign({}, suspects, { crimeRings: Object.assign({}, suspects.crimeRings, rings) });
const cc = {}; const facts = p => { const k = p.iso2.toLowerCase(); if (!(k in cc)) cc[k] = JSON.parse(fs.readFileSync("data/countries/" + k + ".json")); return CE.factsFromCountry(cc[k], p); };
const T0 = 1_800_000_000_000;
const mk = (seed, rankLevel, timeMode) => ({ now: T0, rng: seeded(seed), rankLevel, roster, facts, timeMode, timeScale: 1 });

// ---- every board entry also lands in the inbox, with the right channel
{
  const ctx = mk(11, 1, "mission"), st = CE.newState(ctx), c = CE.createCase(st, ctx, {});
  ok(c.comms.length === c.board.length && c.comms.every((m, i) => m.boardId === c.board[i].id), "one comm per board entry");
  ok(c.comms.some(m => m.channel === "email" && m.subject === "New case file"), "case file arrives as an email");
  ok(c.comms.filter(m => m.channel === "text").length >= 1, "scene reports are texts");
  ok(c.comms.every(m => m.state === "new" && m.lock === null), "new, unlocked (locks only come from registered minigames)");
  ok(c.comms.every(m => m.reliability === null && m.hint === null), "Recruit sees no reliability tags or hints");
  ok(c.comms.filter(m => m.visual).length === 1 && c.comms.find(m => m.visual).visual.kind === "note", "one crumpled note on the scene report");
  const u = CE.unreadCounts(st); ok(u.all === c.comms.length && u.email >= 1 && u.text >= 1 && u.call === 0 && u.voicemail === 0, "unread counts by channel");
  c.comms[0].state = "read"; ok(CE.unreadCounts(st).all === c.comms.length - 1, "reading drops the count");
  ok(JSON.stringify(JSON.parse(JSON.stringify(st))) === JSON.stringify(st), "comms survive a JSON round trip");
  ok(CE.allComms(st).length === c.comms.length, "allComms flattens across cases");
}

// ---- the game's dice are not disturbed by the inbox: same seed, same trail with or without extra modules
{
  const a = mk(5, 3, "mission"), b = mk(5, 3, "mission");
  const ca = CE.createCase(CE.newState(a), a, {}), cb = CE.createCase(CE.newState(b), b, {});
  ok(JSON.stringify(ca.route) === JSON.stringify(cb.route), "deterministic routes");
}

// ---- orders: texts, a voicemail after a long trip, reliability tags from Junior Analyst up
function playOrders(seed, level, mode, speed, focus) {
  const ctx = Object.assign(mk(seed, level, mode), { timeScale: speed || 1, travelScale: speed || 1 });
  const st = CE.newState(ctx), c = CE.createCase(st, ctx, {}), ag = Object.values(st.agents)[0];
  CE.dispatchAgent(st, ctx, { caseId: c.id, agentId: ag.id, toPlaceId: c.route[0] });
  ctx.now = ag.assignment.arrivalTime + 1000; CE.tick(st, ctx);
  const r = CE.giveOrders(st, ctx, { caseId: c.id, agentId: ag.id, focus: focus || "transit" });
  return { ctx, st, c, ag, r };
}
{
  let sawVm = 0, sawTag = 0, sawHint = 0, sawText = 0;
  for (let s = 1; s <= 80; s++) {
    const x = playOrders(s, 4, "mission", 1, ["transit", "locals", "records"][s % 3]);
    for (const m of x.c.comms.filter(m => m.from.kind === "agent")) {
      if (m.channel === "voicemail") { sawVm++; ok(m.transcript && m.transcript.length >= 1, "voicemail has a chunked transcript"); }
      if (m.channel === "text") sawText++;
      if (m.reliability) { sawTag++; ok(["confirmed", "witness", "rumour"].includes(m.reliability), "valid tag"); }
      if (m.hint) sawHint++;
      ok(!("wrong" in m), "no wrong-flag leaks into the item");
    }
  }
  ok(sawVm > 0 && sawText > 0, "long trips become voicemails, short ones texts");
  ok(sawTag > 0 && sawHint > 0, "Junior Analyst+ reports carry reliability tags and some hints");
  let young = 0; for (let s = 1; s <= 30; s++) { const x = playOrders(s, 2, "mission", 1); young += x.c.comms.filter(m => m.reliability || m.hint).length; } ok(young === 0, "Rookie reports never carry tags or hints");
}

// ---- Chief calls: right away in real time, held to wrap-up in mission time
{
  const ctx = mk(21, 3, "real"), st = CE.newState(ctx), c = CE.createCase(st, ctx, {});
  const m = CC.award(st, c, ctx, "lucky");
  ok(m && m.channel === "call" && m.from.id === "chief" && m.voice.pitch === 0.95 && m.voice.rate === 0.97, "real time: lucky-break call from the Chief rings straight away, in the index.html voice");
  ok(CC.award(st, c, ctx, "lucky") === null, "no duplicate call for the same case");
  ok(CC.award(st, c, ctx, "firstTrail") && CC.award(st, c, Object.assign({}, ctx), "firstTrail") === null, "once-only milestones ring once ever");
  const mctx = mk(22, 3, "mission"), mst = CE.newState(mctx), mc = CE.createCase(mst, mctx, {});
  const before = mc.comms.length;
  ok(CC.award(mst, mc, mctx, "lucky") === null && CC.award(mst, mc, mctx, "warrant") === null && mc.comms.length === before, "mission time: no call mid-mission");
  ok(mst.chief.queue.length === 2, "mid-mission milestones are held");
  const wrap = CC.wrapUp(mst, mc, mctx, { rankBefore: "Rookie", rankAfter: "Junior Analyst", unlockedAgents: ["kofi"], agents: [{ id: "mika", leveledUp: true }], falseArrests: 0, wrongTrips: 0 }, 3);
  ok(wrap && wrap.channel === "call" && mc.comms.filter(m => m.from.id === "chief").length === 1, "one combined call at wrap-up");
  ok(/Lucky|luck/i.test(wrap.body) && /Warrant/i.test(wrap.body) && /Junior Analyst/.test(wrap.body) && /Kofi/.test(wrap.body) && /Three cases/.test(wrap.body), "wrap-up call folds in held lines, promotion, new agent and milestone");
  ok(mst.chief.queue.length === 0, "queue is emptied");
  ok(wrap.transcript && wrap.transcript.length >= 3, "Chief call has a chunked transcript");
  ok(!/mustache|pizza/i.test(wrap.body), "Chief stays on mission (no logo gags in call text)");
}
{ // real wiring through the engines: a lucky break or first trail in real mode makes a Chief call without any wrap-up
  let saw = false; for (let s = 1; s <= 60 && !saw; s++) { const x = playOrders(s, 3, "real", 1); saw = x.c.comms.some(m => m.from.id === "chief"); }
  ok(saw, "real time: orders trigger Chief calls mid-mission");
  let held = 0; for (let s = 1; s <= 60; s++) { const x = playOrders(s, 3, "mission", 1); ok(!x.c.comms.some(m => m.from.id === "chief"), "mission time: nothing mid-mission"); held += (x.st.chief ? x.st.chief.queue.length : 0); }
  ok(held > 0, "mission time: milestones queued instead");
}

// ---- crumpled notes
{
  const clue = "paid for a snack with Argentine peso and left a ticket stub behind";
  const a = CN.generate("k1", clue), b = CN.generate("k1", clue), c2 = CN.generate("k2", clue);
  ok(JSON.stringify(a) === JSON.stringify(b), "same key, same note"); ok(JSON.stringify(a) !== JSON.stringify(c2), "different key, different note");
  const words = a.lines.flat(), sm = words.filter(w => w.smudged).length;
  ok(words.map(w => w.t).join(" ") === clue, "words preserved in order"); ok(sm <= Math.floor(words.length * 0.3), "smudges capped at 30%");
  ok(words.some(w => !w.smudged && w.t.length > 3), "a key word always stays readable");
  const places = WF.PLACES.flatMap(p => [p.city, p.country]).map(x => x.toLowerCase());
  for (let s = 0; s < 200; s++) { const nt = CN.plain(CN.generate("s" + s, "A scribbled note with night train times was found near the tracks.")).toLowerCase(); ok(!places.some(p => nt.includes(p)), "no place names in a note"); }
  ok(CN.FLAVOUR.every(f => !places.some(p => f.toLowerCase().includes(p))), "flavour scraps are place-free");
  ok(a.folds.length >= 4 && ["#E9DFC4", "#DCE3E6", "#EFE2A8", "#E4D5D0"].includes(a.tone), "paper has folds and a tone");
}

// ---- call audio: chunking, envelope, voice pick
{
  const t = "Case closed. No wrong turns, that is how it is done! Promotion approved: you are now Junior Analyst and this is a very long clause that keeps going and going without any punctuation at all until it must be cut";
  const ch = CA.chunk(t); ok(ch.length >= 4 && ch.every(x => x.length <= 90), "chunks stay short");
  const e1 = CA.envelope(t, 5, 1), e2 = CA.envelope(t, 5, 1), fast = CA.envelope(t, 5, 1.4);
  ok(JSON.stringify(e1) === JSON.stringify(e2), "envelope is deterministic"); ok(e1.chunks.every(c => c.amps.every(a => a >= 0 && a <= 1) && c.amps.length === Math.ceil(c.durMs / CA.SLOT_MS)), "amplitudes 0..1, one per slot");
  ok(e1.chunks.every((c, i) => i === 0 || c.startMs >= e1.chunks[i - 1].startMs + e1.chunks[i - 1].durMs + CA.PAUSE_MS), "pauses between chunks"); ok(fast.totalMs < e1.totalMs, "faster rate, shorter call");
  const v = [{ name: "Google Deutsch", lang: "de-DE" }, { name: "Microsoft Ryan Online", lang: "en-GB" }, { name: "Samantha", lang: "en-US", default: true }];
  ok(CA.pickVoice(v, ["ryan"]).name === "Microsoft Ryan Online" && CA.pickVoice(v, ["zzz"]).name === "Samantha" && CA.pickVoice([], ["ryan"]) === null, "voice preference with fallbacks");
}
console.log("wave3 step3: " + n + " checks OK");
