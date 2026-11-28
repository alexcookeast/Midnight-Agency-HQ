/* Crumpled Note generator (Wave 3). Seeded, so the same note always looks the same.
   A note is built from text that is ALREADY a legal clue (a scene detail or a trail clue sentence) plus
   harmless flavour scraps. Smudges hide some words but always leave the key part readable, and nothing
   here can add a place name, so a note can never be a freebie answer. */
(function (global) {
  "use strict";
  function mulberry(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  var TONES = ["#E9DFC4", "#DCE3E6", "#EFE2A8", "#E4D5D0"];
  var FLAVOUR = ["don't forget the milk", "call Mo back", "he owes me lunch", "umbrella?", "cold again tonight", "~ meet at the usual spot ~", "buy stamps", "ask about the cat", "7 o'clock?", "(do NOT tell Pip)"];
  var STOP = { a: 1, an: 1, the: 1, of: 1, and: 1, to: 1, in: 1, on: 1, at: 1, it: 1, is: 1, was: 1, with: 1, for: 1, that: 1, this: 1, they: 1, their: 1 };

  // text: the clue sentence. opts.flavour (default true), opts.maxSmudge (default 0.3 of the words)
  function generate(seedOrKey, text, opts) {
    var o = opts || {}, seed = typeof seedOrKey === "number" ? seedOrKey : hash(String(seedOrKey)), rng = mulberry(seed);
    var words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    var key = [];                                                   // content words worth keeping
    words.forEach(function (w, i) { if (!STOP[w.toLowerCase().replace(/[^a-z]/g, "")] && w.length > 3) key.push(i); });
    var keep = {}, keepN = Math.max(1, Math.ceil(key.length * 0.6));
    key.slice().sort(function () { return rng() - 0.5; }).slice(0, keepN).forEach(function (i) { keep[i] = true; });
    var maxS = Math.floor(words.length * (o.maxSmudge == null ? 0.3 : o.maxSmudge)), smudged = 0;
    var out = words.map(function (w, i) {
      var smudge = !keep[i] && smudged < maxS && w.length > 2 && rng() < 0.5;
      if (smudge) smudged += 1;
      return { t: w, smudged: smudge, dy: Math.round((rng() - 0.5) * 6), rot: Math.round((rng() - 0.5) * 8) };
    });
    var lines = [], line = [];
    out.forEach(function (w) { line.push(w); if (line.length >= 3 + Math.floor(rng() * 2)) { lines.push(line); line = []; } });
    if (line.length) lines.push(line);
    var flavour = (o.flavour === false || rng() < 0.4) ? null : FLAVOUR[Math.floor(rng() * FLAVOUR.length)];
    var folds = [], n = 4 + Math.floor(rng() * 3);
    for (var i = 0; i < n; i += 1) folds.push([Math.round(rng() * 100), Math.round(rng() * 100), Math.round(rng() * 100), Math.round(rng() * 100)]);
    return { seed: seed, tone: TONES[Math.floor(rng() * TONES.length)], tilt: Math.round((rng() - 0.5) * 12), folds: folds, lines: lines, flavour: flavour, ink: rng() < 0.5 ? "#2A2A44" : "#3B2A2A" };
  }
  function plain(note) { return note.lines.map(function (l) { return l.map(function (w) { return w.smudged ? "▒▒▒" : w.t; }).join(" "); }).join(" "); }

  // DOM render: tilted paper with fold lines and scrawled words; smudged words show as ink blots.
  function render(note, doc) {
    var d = doc || document, NS = "http://www.w3.org/2000/svg";
    var box = d.createElement("div"); box.className = "note"; box.style.background = note.tone; box.style.transform = "rotate(" + note.tilt + "deg)";
    box.setAttribute("role", "img"); box.setAttribute("aria-label", "A crumpled note: " + plain(note));
    var svg = d.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("class", "note-folds");
    note.folds.forEach(function (f) { var l = d.createElementNS(NS, "line"); l.setAttribute("x1", f[0]); l.setAttribute("y1", f[1]); l.setAttribute("x2", f[2]); l.setAttribute("y2", f[3]); svg.appendChild(l); });
    box.appendChild(svg);
    var txt = d.createElement("div"); txt.className = "note-text"; txt.style.color = note.ink;
    note.lines.forEach(function (line) {
      var row = d.createElement("div"); row.className = "note-line";
      line.forEach(function (w) { var s = d.createElement("span"); s.className = w.smudged ? "blot" : ""; s.textContent = w.smudged ? "▒▒▒" : w.t; s.style.transform = "translateY(" + w.dy + "px) rotate(" + w.rot + "deg)"; row.appendChild(s); row.appendChild(d.createTextNode(" ")); });
      txt.appendChild(row);
    });
    if (note.flavour) { var f = d.createElement("div"); f.className = "note-flavour"; f.textContent = note.flavour; txt.appendChild(f); }
    box.appendChild(txt);
    return box;
  }
  global.CrumpledNotes = { generate: generate, render: render, plain: plain, FLAVOUR: FLAVOUR, hash: hash };
})(typeof window !== "undefined" ? window : globalThis);
