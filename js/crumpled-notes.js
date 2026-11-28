/* Crumpled Note generator (Wave 3). Seeded, so the same note always looks the same.
   A note is built from text that is ALREADY a legal clue (a scene detail or a trail clue sentence) plus
   harmless flavour scraps. Smudges hide some words but always leave the key part readable, and nothing
   here can add a place name, so a note can never be a freebie answer. */
(function (global) {
  "use strict";
  function mulberry(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  var TONES = ["#E9DFC4", "#DCE3E6", "#EFE2A8", "#E4D5D0"];
  var KINDS = ["ticket", "schedule", "jotting", "reminder", "receipt"];
  var FLAVOUR = ["don't forget the milk", "call Mo back", "he owes me lunch", "umbrella?", "cold again tonight", "buy stamps", "ask about the cat", "(do NOT tell Pip)", "lunch at one?", "need spare keys"];
  var FILLER = ["wake up", "breakfast", "call Mo", "pick up parcel", "walk the dog", "meeting", "lunch", "nap", "post office", "back by dark"];
  // Words that never carry the clue, so a scrap does not just repeat the message.
  var SKIP = ("someone who met the suspect says they and with for that this was were had has have from near left behind into onto over under about their them then than " +
    "a an of to in on at it is as by or be do did not but").split(" ").reduce(function (o, w) { o[w] = 1; return o; }, {});

  // The one or two content words that carry the clue (original order kept).
  function keywords(text) {
    var words = String(text || "").replace(/[^A-Za-z' -]/g, " ").split(/\s+/).filter(Boolean), seen = {}, cands = [];
    words.forEach(function (w, i) { var lw = w.toLowerCase(); if (w.length > 3 && !SKIP[lw] && !seen[lw]) { seen[lw] = 1; cands.push({ w: w, i: i }); } });
    return cands.sort(function (a, b) { return b.w.length - a.w.length || a.i - b.i; }).slice(0, 2).sort(function (a, b) { return a.i - b.i; }).map(function (x) { return x.w; });
  }
  function pad(n) { return ("0" + n).slice(-2); }

  // Found physical scraps, not a copy of the message: a stub, a schedule, a jotting, a reminder or a receipt that
  // happens to mention the clue word(s). Smudges only hit filler, never the key words.
  function generate(seedOrKey, text, opts) {
    var o = opts || {}, seed = typeof seedOrKey === "number" ? seedOrKey : hash(String(seedOrKey)), rng = mulberry(seed);
    var keys = keywords(text), K1 = keys[0] || "something", K2 = keys[1] || "";
    var kind = o.kind || KINDS[Math.floor(rng() * KINDS.length)];
    var t1 = pad(5 + Math.floor(rng() * 18)) + ":" + pad(Math.floor(rng() * 12) * 5), t2 = pad(5 + Math.floor(rng() * 18)) + ":" + pad(Math.floor(rng() * 12) * 5);
    var n = 1 + Math.floor(rng() * 14), L = "ABCDEF".charAt(Math.floor(rng() * 6)), filler = function () { return FILLER[Math.floor(rng() * FILLER.length)]; };
    var rows;                                   // each row: array of [text, isKey]
    if (kind === "ticket") rows = [[["ADMIT ONE", 0]], [[K1.toUpperCase(), 1]].concat(K2 ? [[K2.toUpperCase(), 1]] : []), [[t1, 0], ["GATE", 0], [String(n), 0]], [["SEAT", 0], [n + L, 0]]];
    else if (kind === "schedule") rows = [[[t1, 0]].concat(filler().split(" ").map(function (w) { return [w, 0]; })), [[t2, 0], [K1, 1]].concat(K2 ? [[K2, 1]] : []), [[pad(Math.min(23, 5 + Math.floor(rng() * 18))) + ":30", 0]].concat(filler().split(" ").map(function (w) { return [w, 0]; }))];
    else if (kind === "reminder") rows = [[["remember:", 0]], [[K1, 1]].concat(K2 ? [[K2, 1]] : []).concat([["!!", 0]]), [["before", 0], [t1, 0]]];
    else if (kind === "receipt") rows = [[["QTY", 0], ["2", 0], [K1, 1]], K2 ? [["QTY", 0], ["1", 0], [K2, 1]] : [["thank", 0], ["you", 0]], [["TOTAL", 0], [(2 + Math.floor(rng() * 18)) + "." + pad(Math.floor(rng() * 100)), 0]], [["paid", 0], ["cash", 0]]];
    else rows = [[[K1 + "!!", 1]].concat(K2 ? [[K2, 1]] : []), [["ask", 0], ["about", 0], ["it", 0]]];
    var total = rows.reduce(function (a, r) { return a + r.length; }, 0), maxS = Math.floor(total * (o.maxSmudge == null ? 0.3 : o.maxSmudge)), smudged = 0;
    var lines = rows.map(function (r) {
      return r.map(function (w) {
        var sm = !w[1] && smudged < maxS && w[0].length > 2 && rng() < 0.4;
        if (sm) smudged += 1;
        return { t: w[0], key: !!w[1], smudged: sm, dy: Math.round((rng() - 0.5) * 6), rot: Math.round((rng() - 0.5) * 8) };
      });
    });
    var flavour = (o.flavour === false || rng() < 0.45) ? null : FLAVOUR[Math.floor(rng() * FLAVOUR.length)];
    var folds = [], nf = 4 + Math.floor(rng() * 3);
    for (var i = 0; i < nf; i += 1) folds.push([Math.round(rng() * 100), Math.round(rng() * 100), Math.round(rng() * 100), Math.round(rng() * 100)]);
    return { seed: seed, kind: kind, keys: keys, tone: TONES[Math.floor(rng() * TONES.length)], tilt: Math.round((rng() - 0.5) * 12), folds: folds, lines: lines, flavour: flavour, ink: rng() < 0.5 ? "#2A2A44" : "#3B2A2A" };
  }
  function plain(note) { return note.lines.map(function (l) { return l.map(function (w) { return w.smudged ? "▒▒▒" : w.t; }).join(" "); }).join(" "); }

  // DOM render: tilted paper with fold lines and scrawled words; smudged words show as ink blots.
  function render(note, doc) {
    var d = doc || document, NS = "http://www.w3.org/2000/svg";
    var box = d.createElement("div"); box.className = "note note-" + (note.kind || "jotting"); box.style.background = note.tone; box.style.transform = "rotate(" + note.tilt + "deg)";
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
  global.CrumpledNotes = { generate: generate, keywords: keywords, KINDS: KINDS, render: render, plain: plain, FLAVOUR: FLAVOUR, hash: hash };
})(typeof window !== "undefined" ? window : globalThis);
