// Run from the repo root:  node tests/wave3-step5.test.js   (Flag Unblur lab: logic only)
const fs = require("fs"), vm = require("vm"), assert = require("assert");
global.window = global;
for (const f of ["js/minigame-slots.js", "js/unblur-lab.js"]) vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });
const U = UnblurLab.core; let n = 0; const ok = (c, m) => { assert(c, m); n++; };
function seeded(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const J = JSON.parse(fs.readFileSync("data/factbook-index.json")).countries;
const index = Object.values(J).map(c => ({ iso2: c.iso2, name: c.name, region: c.region, flagPath: c.flagPath }));
const famPlaces = new Set(); for (const m of fs.readFileSync("js/world-factbook.js", "utf8").matchAll(/iso2:\s*"([A-Z]{2})"/g)) famPlaces.add(m[1]);
const fam = [...famPlaces];

ok(index.length === 194 && fam.length >= 15, "data loaded");
ok(MinigameSlots.has("unblur") && MinigameSlots.list().some(s => s.kind === "unblur" && s.ready), "slot registered and ready");
ok(MinigameSlots.SLOTS.unblur.title === "Flag Unblur", "slot title");

// settings scale with rank
let prev = null;
for (let l = 1; l <= 7; l++) {
  const s = U.settings(l);
  ok(s.options >= 3 && s.options <= 6 && s.cols.length >= 5, "settings sane L" + l);
  ok(s.cols.every((c, i) => i === 0 || c > s.cols[i - 1]), "pixel columns strictly sharpen L" + l);
  ok(s.cols[0] <= 4 && s.cols[s.cols.length - 1] >= 48, "starts chunky, ends sharp L" + l);
  if (prev) ok(s.options >= prev.options && s.stepMs <= prev.stepMs, "harder or equal with rank L" + l);
  prev = s;
}
ok(U.settings(0).level === 1 && U.settings(99).level === 7 && U.settings("x").level === 1, "level clamped");

// rounds
for (let l = 1; l <= 7; l++) for (let seed = 1; seed <= 150; seed++) {
  const s = U.settings(l), r = U.makeRound(index, l, seeded(seed * 7 + l), fam);
  const isos = r.options.map(o => o.iso2);
  ok(isos.length === s.options, "option count L" + l);
  ok(new Set(isos).size === isos.length, "no duplicate options");
  ok(isos.includes(r.answer.iso2) && r.options.filter(o => o.iso2 === r.answer.iso2).length === 1, "answer present once");
  ok(r.options.every(o => o.name && o.flagPath && fs.existsSync(o.flagPath)), "every option has a name and a local flag file");
  const tw = U.twinsOf(r.answer.iso2); ok(isos.every(i => !tw[i]), "no lookalike flag of the answer: " + isos);
  for (const a of isos) { const t = U.twinsOf(a); ok(isos.every(b => !t[b]), "no lookalike pair"); }
  if (l <= 2) ok(isos.every(i => famPlaces.has(i)), "low rank uses familiar countries only");
  if (l >= 3) ok(r.options.filter(o => o.region === r.answer.region).length >= Math.min(s.options, 3), "higher rank: same-region distractors");
  ok(r.steps === s.cols.length && r.stepMs === s.stepMs, "round timing from rank");
}
// determinism + variety
const a = U.makeRound(index, 4, seeded(5), fam), b = U.makeRound(index, 4, seeded(5), fam);
ok(JSON.stringify(a) === JSON.stringify(b), "same seed, same round");
const answers = new Set(); for (let s = 1; s <= 200; s++) answers.add(U.makeRound(index, 5, seeded(s), fam).answer.iso2); ok(answers.size > 60, "answers vary a lot at high rank");
// avoid repeats in a game
{ const seen = []; const rng = seeded(11); for (let i = 0; i < U.ROUNDS; i++) { const r = U.makeRound(index, 1, rng, fam, seen); ok(!seen.includes(r.answer.iso2), "no repeated flag in a game"); seen.push(r.answer.iso2); } }
// tiny pool never crashes
{ const tiny = index.slice(0, 2); const r = U.makeRound(tiny, 6, seeded(1), []); ok(r.options.length === 2 && r.options.some(o => o.iso2 === r.answer.iso2), "tiny pool survives"); }

// scoring
ok(U.pointsFor(0, 6) === 6 && U.pointsFor(5, 6) === 1 && U.pointsFor(99, 6) === 1 && U.pointsFor(-3, 6) === 6, "points: sooner is better, never below 1");
ok(U.starsFor(5, 5) === 2 && U.starsFor(4, 5) === 1 && U.starsFor(3, 5) === 0 && U.starsFor(0, 5) === 0, "stars");
const g = U.gridFor(10, 2 / 3); ok(g.w === 10 && g.h === 7 && U.gridFor(0).w === 1 && U.gridFor(3).h >= 1, "grid");
console.log("wave3-step5: " + n + " checks passed");
