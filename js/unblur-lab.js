/* Flag Unblur Lab: a flag starts as big chunky pixels and sharpens step by step while a timer runs.
   Tap the matching country. Wrong taps just grey that button out (no penalty); sooner = more points.
   Offline: uses only data/factbook-index.json and assets/flags/<iso2>.svg.
   Pure logic lives in UnblurLab.core (testable in Node); the overlay UI only runs in a browser.
   Registers itself into MinigameSlots as "unblur". Stars go through MidnightAgencyConfig.addStars. */
(function (global) {
  "use strict";

  var ROUNDS = 5;
  // Flags that are (nearly) the same picture. They are never offered together as choices.
  var TWINS = [["RO", "TD", "AD", "MD"], ["ID", "MC", "PL"], ["IE", "CI", "IT"], ["NL", "LU"], ["AU", "NZ"], ["SK", "SI", "RU"],
    ["NO", "IS"], ["DK", "NO"], ["SE", "FI"], ["VE", "CO", "EC"], ["GN", "ML", "SN"], ["CZ", "PH"], ["US", "LR", "MY"], ["BD", "JP"], ["AT", "LV"]];

  function twinsOf(iso) {
    var out = {};
    TWINS.forEach(function (g) { if (g.indexOf(iso) >= 0) g.forEach(function (x) { if (x !== iso) out[x] = true; }); });
    return out;
  }

  // Rank level 1..7 (MidnightAgencyConfig.rankLevel). Higher rank = more choices, subtler pixels, less time.
  function settings(level) {
    var l = Math.max(1, Math.min(7, Math.floor(Number(level) || 1)));
    return {
      level: l,
      options: l <= 2 ? 3 : l <= 4 ? 4 : 6,
      sameRegion: l >= 3,                // distractors from the same region
      familiarOnly: l <= 2,              // only countries from the playable places at low rank
      stepMs: l <= 2 ? 2600 : l <= 4 ? 2000 : 1500,
      cols: l <= 2 ? [3, 5, 8, 14, 24, 48] : [4, 6, 10, 16, 28, 56]
    };
  }

  function rngPick(arr, rng) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // index: array of {iso2,name,region,flagPath}. familiar: array/obj of iso2 codes for easy ranks.
  function poolFor(index, level, familiar) {
    var s = settings(level), fam = {};
    (familiar || []).forEach(function (c) { fam[String(c).toUpperCase()] = true; });
    var all = index.filter(function (c) { return c && c.iso2 && c.name && c.flagPath; });
    var easy = all.filter(function (c) { return fam[c.iso2]; });
    return s.familiarOnly && easy.length >= s.options ? easy : all;
  }

  // One round: { answer, options[], steps, stepMs, cols[] }. Options never include twin flags of the answer or each other.
  function makeRound(index, level, rng, familiar, avoidIso) {
    rng = rng || Math.random;
    var s = settings(level), pool = poolFor(index, level, familiar);
    var fresh = pool.filter(function (c) { return !(avoidIso && avoidIso.indexOf(c.iso2) >= 0); });
    var answer = rngPick(fresh.length ? fresh : pool, rng);
    var banned = twinsOf(answer.iso2); banned[answer.iso2] = true;
    var ok = function (c) { return !banned[c.iso2]; };
    var cands = shuffle(pool.filter(ok), rng);
    var same = s.sameRegion ? cands.filter(function (c) { return c.region === answer.region; }) : [];
    var opts = [answer];
    function take(list) {
      for (var i = 0; i < list.length && opts.length < s.options; i++) {
        var c = list[i];
        if (opts.some(function (o) { return o.iso2 === c.iso2; })) continue;
        if (opts.some(function (o) { return twinsOf(o.iso2)[c.iso2]; })) continue;
        opts.push(c);
      }
    }
    take(same); take(cands);
    if (opts.length < 2) take(shuffle(index.filter(function (c) { return c.iso2 !== answer.iso2; }), rng)); // tiny-pool safety
    return { answer: answer, options: shuffle(opts, rng), steps: s.cols.length, stepMs: s.stepMs, cols: s.cols.slice() };
  }

  // Points for answering while step idx (0-based) is showing: sharper later = fewer points, always at least 1.
  function pointsFor(stepIdx, steps) { return Math.max(1, steps - Math.max(0, stepIdx)); }
  // One star for a good game (4+ right of 5), two for a perfect one.
  function starsFor(correct, total) { total = total || ROUNDS; return correct >= total ? 2 : correct >= Math.ceil(total * 0.8) ? 1 : 0; }
  function gridFor(cols, aspect) { return { w: Math.max(1, cols | 0), h: Math.max(1, Math.round(cols * (aspect || 2 / 3))) }; }

  var core = { ROUNDS: ROUNDS, TWINS: TWINS, settings: settings, poolFor: poolFor, makeRound: makeRound, pointsFor: pointsFor, starsFor: starsFor, gridFor: gridFor, twinsOf: twinsOf };
  var api = { core: core, open: null };
  global.UnblurLab = api;
  function openProxy(ctx) { return api.open(ctx); }
  if (global.MinigameSlots) global.MinigameSlots.register("unblur", { title: "Flag Unblur", blurb: "Name the flag before it sharpens.", open: openProxy });
  if (typeof document === "undefined") return;

  // ------------------------------------------------------------------ UI
  var cache = null;
  function loadIndex() {
    if (cache) return Promise.resolve(cache);
    return fetch("data/factbook-index.json").then(function (r) { if (!r.ok) throw new Error("index"); return r.json(); }).then(function (j) {
      cache = Object.keys(j.countries).map(function (k) { var c = j.countries[k]; return { iso2: c.iso2, name: c.name, region: c.region, flagPath: c.flagPath }; });
      return cache;
    });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "on") Object.keys(attrs.on).forEach(function (e) { n.addEventListener(e, attrs.on[e]); });
      else n.setAttribute(k, attrs[k]);
    });
    [].concat(kids == null ? [] : kids).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function addCss() {
    if (document.getElementById("ub-css")) return;
    var s = document.createElement("style"); s.id = "ub-css";
    s.textContent = ".ub-sheet{background:var(--card,#221A45);border:2px solid var(--pink,#FF5FA2);border-radius:22px;padding:16px 18px;width:min(900px,100%);max-height:94vh;overflow:auto;color:var(--ink,#F6F2FF)}" +
      ".ub-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}.ub-top h2{margin:0;font-size:20px}" +
      ".ub-main{display:grid;grid-template-columns:1.2fr 1fr;gap:14px;align-items:center}" +
      ".ub-frame{background:#0b0818;border:2px solid var(--line,#3B2F70);border-radius:14px;padding:8px;display:flex;justify-content:center}" +
      ".ub-canvas{width:100%;max-width:440px;aspect-ratio:3/2;image-rendering:pixelated;border-radius:8px;background:#222}" +
      ".ub-bar{height:12px;border-radius:99px;background:var(--card2,#2D2359);overflow:hidden;margin:8px 0}.ub-bar i{display:block;height:100%;width:100%;background:var(--gold,#FFD76B);transition:width .1s linear}" +
      ".ub-opts{display:grid;gap:8px}.ub-opt{min-height:56px;font-size:18px;font-weight:800;border-radius:14px;border:2px solid var(--line,#3B2F70);background:var(--card2,#2D2359);color:inherit;padding:0 12px}" +
      ".ub-opt.no{opacity:.35;text-decoration:line-through}.ub-opt.yes{background:var(--mint,#6FE3B0);color:#14102B;border-color:var(--mint,#6FE3B0)}" +
      ".ub-msg{min-height:26px;font-weight:800;margin-top:6px}.ub-pips{display:flex;gap:6px}.ub-pips b{width:14px;height:14px;border-radius:50%;background:var(--line,#3B2F70)}.ub-pips b.on{background:var(--mint,#6FE3B0)}.ub-pips b.cur{outline:2px solid var(--gold,#FFD76B)}" +
      "@media (max-width:760px){.ub-main{grid-template-columns:1fr}}";
    document.head.appendChild(s);
  }

  function open(ctx) {
    ctx = ctx || {};
    addCss();
    var MA = global.MidnightAgencyConfig, level = ctx.level;
    if (!level) { try { level = MA && MA.rankLevel(MA.read()); } catch (e) { level = 1; } }
    var rng = ctx.rng || Math.random, familiar = [];
    try { (global.WorldFactbook.PLACES || []).forEach(function (p) { if (familiar.indexOf(p.iso2) < 0) familiar.push(p.iso2); }); } catch (e) {}
    var veil = el("div", { class: "veil", id: "ubVeil", role: "dialog", "aria-label": "Flag Unblur" });
    document.body.appendChild(veil);
    var timer = null, game = null;
    function close() { clearInterval(timer); veil.remove(); }
    function shell(kids) { veil.innerHTML = ""; veil.appendChild(el("div", { class: "ub-sheet" }, kids)); }

    function start(index) {
      game = { index: index, n: 0, correct: 0, points: 0, seen: [], marks: [] };
      next();
    }
    function next() {
      var g = game;
      if (g.n >= ROUNDS) return finish();
      var round = makeRound(g.index, level, rng, familiar, g.seen);
      if (ctx.stepMs) round.stepMs = ctx.stepMs;
      g.seen.push(round.answer.iso2); g.round = round; g.step = 0; g.done = false; g.tick = 0; g.wrong = {};
      draw();
    }
    function draw() {
      var g = game, r = g.round, img = new Image();
      var canvas = el("canvas", { class: "ub-canvas", id: "ubCanvas", width: "240", height: "160" });
      var bar = el("i"), msg = el("div", { class: "ub-msg", id: "ubMsg", "aria-live": "polite" }, "Which flag is hiding?");
      var pips = el("div", { class: "ub-pips" }, g.marks.concat(new Array(ROUNDS - g.marks.length).fill(null)).map(function (m, i) { return el("b", { class: (m ? "on" : "") + (i === g.n ? " cur" : "") }); }));
      var btns = r.options.map(function (o) {
        return el("button", { class: "ub-opt", "data-iso": o.iso2, on: { click: function () { pick(o, this); } } }, o.name);
      });
      shell([
        el("div", { class: "ub-top" }, [el("h2", null, "Flag Unblur · round " + (g.n + 1) + " of " + ROUNDS), pips, el("button", { class: "btn", id: "ubClose", on: { click: close } }, "Close")]),
        el("div", { class: "ub-main" }, [
          el("div", null, [el("div", { class: "ub-frame" }, canvas), el("div", { class: "ub-bar" }, bar), msg]),
          el("div", { class: "ub-opts" }, btns)
        ])
      ]);
      g.canvas = canvas; g.bar = bar; g.msg = msg; g.btns = btns;
      img.onload = function () { g.img = img; paint(); };
      img.onerror = function () { g.img = null; msg.textContent = "Flag picture missing. Skip ahead!"; };
      img.src = r.answer.flagPath;
      clearInterval(timer);
      timer = setInterval(tick, 100);
    }
    function paint() {
      var g = game; if (!g.img || !g.canvas) return;
      var cols = g.round.cols[Math.min(g.step, g.round.cols.length - 1)], grid = gridFor(cols, 2 / 3);
      var c = g.canvas, x = c.getContext("2d"), tiny = document.createElement("canvas");
      tiny.width = grid.w; tiny.height = grid.h;
      var tx = tiny.getContext("2d"); tx.imageSmoothingEnabled = true; tx.clearRect(0, 0, grid.w, grid.h);
      tx.fillStyle = "#fff"; tx.fillRect(0, 0, grid.w, grid.h);
      // fit the flag inside a 3:2 frame without stretching
      var iw = g.img.naturalWidth || 3, ih = g.img.naturalHeight || 2, sc = Math.min(grid.w / iw, grid.h / ih), dw = iw * sc, dh = ih * sc;
      tx.drawImage(g.img, (grid.w - dw) / 2, (grid.h - dh) / 2, dw, dh);
      x.imageSmoothingEnabled = false; x.clearRect(0, 0, c.width, c.height); x.drawImage(tiny, 0, 0, c.width, c.height);
      c.setAttribute("data-step", String(g.step));
    }
    function tick() {
      var g = game; if (!g || g.done) return;
      g.tick += 100;
      var total = g.round.stepMs * g.round.steps;
      if (g.bar) g.bar.style.width = Math.max(0, 100 - (g.tick / total) * 100) + "%";
      var step = Math.min(g.round.steps - 1, Math.floor(g.tick / g.round.stepMs));
      if (step !== g.step) { g.step = step; paint(); }
      if (g.tick >= total) reveal(false, "Time! It was " + g.round.answer.name + ".");
    }
    function pick(o, btn) {
      var g = game; if (g.done || g.wrong[o.iso2]) return;
      if (o.iso2 === g.round.answer.iso2) {
        var pts = pointsFor(g.step, g.round.steps); g.points += pts;
        reveal(true, "Yes! " + o.name + " · +" + pts + " point" + (pts > 1 ? "s" : ""));
      } else {
        g.wrong[o.iso2] = true; btn.classList.add("no"); btn.setAttribute("aria-disabled", "true");
        g.msg.textContent = "Not that one. Keep looking!";
      }
    }
    function reveal(good, text) {
      var g = game; g.done = true; clearInterval(timer);
      g.step = g.round.steps - 1; paint(); if (g.bar) g.bar.style.width = "0%";
      g.msg.textContent = text; if (good) g.correct++;
      g.marks.push(good);
      g.btns.forEach(function (b) { if (b.getAttribute("data-iso") === g.round.answer.iso2) b.classList.add("yes"); });
      var last = g.n + 1 >= ROUNDS;
      g.msg.parentNode.appendChild(el("button", { class: "btn pink", id: "ubNext", on: { click: function () { g.n++; next(); } } }, last ? "See results" : "Next flag"));
    }
    function finish() {
      var g = game, stars = starsFor(g.correct, ROUNDS), granted = 0;
      if (stars && MA && typeof MA.addStars === "function") { try { MA.addStars(stars); granted = stars; } catch (e) {} }
      api.last = { correct: g.correct, total: ROUNDS, points: g.points, stars: granted };
      shell([
        el("div", { class: "ub-top" }, [el("h2", null, "Flag Unblur · report")]),
        el("div", { class: "ub-msg", id: "ubResult" }, g.correct + " of " + ROUNDS + " flags spotted · " + g.points + " points" + (granted ? " · +" + granted + " ⭐" : "")),
        el("div", { class: "mute" }, g.correct >= 4 ? "Sharp eyes, Agent!" : "Good practice. Every flag you learn helps on a real case."),
        el("div", { style: "display:flex;gap:8px;margin-top:12px" }, [
          el("button", { class: "btn pink", id: "ubAgain", on: { click: function () { start(g.index); } } }, "Play again"),
          el("button", { class: "btn", id: "ubDone", on: { click: close } }, "Back to the desk")
        ])
      ]);
    }

    shell([el("div", { class: "ub-msg" }, "Loading flags…")]);
    loadIndex().then(start).catch(function () { shell([el("div", { class: "ub-msg" }, "Flags aren't available right now."), el("button", { class: "btn", id: "ubClose", on: { click: close } }, "Close")]); });
  }

  api.open = open;
})(typeof window !== "undefined" ? window : globalThis);
