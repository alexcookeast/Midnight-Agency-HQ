/* Command Desk map: land shapes (tap a country -> Factbook), city pins (tap -> inline card),
   live agent markers + multi-leg tracks, pulsing event pings. Pan by drag, zoom with +/- or wheel.
   Pure SVG, no libraries. Needs MapGeo + WorldFactbook. */
(function (global) {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var G = global.MapGeo;
  function s(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  function create(host, opts) {
    opts = opts || {};
    var WF = global.WorldFactbook;
    var home = { x: 0, y: 12, w: 720, h: 290 };          // default crop: skips most of Antarctica
    var view = { x: home.x, y: home.y, w: home.w, h: home.h };
    var minW = 90, state = { selectedIso: null, selectedPlace: null, agents: [], pings: [], caseRoute: [] };
    var markers = {}, card = null;

    host.classList.add("cmap");
    host.innerHTML = "";
    var svg = s("svg", { "class": "cm-far", viewBox: view.x + " " + view.y + " " + view.w + " " + view.h, role: "img", "aria-label": "World map. Tap a country for its Factbook entry, or a city to send an agent.", preserveAspectRatio: "xMidYMid meet" });
    svg.style.touchAction = "none";
    host.appendChild(svg);
    var gLand = s("g", { "class": "cm-land" }, svg), gTracks = s("g", { "class": "cm-tracks" }, svg), gPins = s("g", { "class": "cm-pins" }, svg),
      gPings = s("g", { "class": "cm-pings" }, svg), gAgents = s("g", { "class": "cm-agents" }, svg);
    s("rect", { x: 0, y: 0, width: 720, height: 360, fill: "none" }, gLand);   // keeps viewBox bounds

    var zoomBox = document.createElement("div");
    zoomBox.className = "cm-zoom";
    zoomBox.innerHTML = '<button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">&minus;</button><button type="button" data-z="home" aria-label="Whole world">&#8962;</button>';
    host.appendChild(zoomBox);

    function k() { return view.w / home.w; }          // current zoom factor (1 = whole world)
    function setView(v) {
      var w = Math.max(minW, Math.min(home.w, v.w)), h = w * (home.h / home.w);
      var x = Math.max(0, Math.min(720 - w, v.x)), y = Math.max(0, Math.min(360 - h, v.y));
      view = { x: x, y: y, w: w, h: h };
      svg.setAttribute("viewBox", x + " " + y + " " + w + " " + h);
      svg.setAttribute("class", k() > 0.55 ? "cm-far" : "");
      scalePins(); if (card) placeCard();
    }
    function zoomBy(f, cx, cy) {
      var px = cx == null ? view.x + view.w / 2 : cx, py = cy == null ? view.y + view.h / 2 : cy;
      var w = view.w * f, h = view.h * f;
      setView({ x: px - (px - view.x) * f, y: py - (py - view.y) * f, w: w, h: h });
    }
    zoomBox.addEventListener("click", function (e) {
      var z = e.target && e.target.getAttribute && e.target.getAttribute("data-z");
      if (z === "in") zoomBy(0.6); else if (z === "out") zoomBy(1 / 0.6); else if (z === "home") setView(home);
    });
    svg.addEventListener("wheel", function (e) { e.preventDefault(); var p = toSvg(e); zoomBy(e.deltaY < 0 ? 0.8 : 1.25, p[0], p[1]); }, { passive: false });

    function toSvg(e) {
      var r = svg.getBoundingClientRect(), sc = Math.min(r.width / view.w, r.height / view.h);
      // preserveAspectRatio meet: the view is centred inside the box
      var ox = (r.width - view.w * sc) / 2, oy = (r.height - view.h * sc) / 2;
      return [view.x + (e.clientX - r.left - ox) / sc, view.y + (e.clientY - r.top - oy) / sc];
    }
    function toPx(x, y) {
      var r = svg.getBoundingClientRect(), sc = Math.min(r.width / view.w, r.height / view.h);
      var ox = (r.width - view.w * sc) / 2, oy = (r.height - view.h * sc) / 2;
      return [ox + (x - view.x) * sc, oy + (y - view.y) * sc];
    }

    // drag to pan; a press that barely moves is a tap
    var drag = null, pointers = {}, pinch = null;
    svg.addEventListener("pointerdown", function (e) {
      pointers[e.pointerId] = e;
      try { svg.setPointerCapture(e.pointerId); } catch (x) {}
      if (Object.keys(pointers).length === 2) { var ps = Object.keys(pointers).map(function (i) { return pointers[i]; }); pinch = { d: Math.hypot(ps[0].clientX - ps[1].clientX, ps[0].clientY - ps[1].clientY), w: view.w }; drag = null; }
      else drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, target: e.target };
    });
    svg.addEventListener("pointermove", function (e) {
      if (pointers[e.pointerId]) pointers[e.pointerId] = e;
      if (pinch && Object.keys(pointers).length === 2) {
        var ps = Object.keys(pointers).map(function (i) { return pointers[i]; });
        var d = Math.hypot(ps[0].clientX - ps[1].clientX, ps[0].clientY - ps[1].clientY);
        if (pinch.d > 0) { var f = (pinch.w * (pinch.d / d)) / view.w; zoomBy(f); }
        return;
      }
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 8) return;
      drag.moved = true;
      var r = svg.getBoundingClientRect(), sc = Math.min(r.width / view.w, r.height / view.h);
      setView({ x: drag.vx - dx / sc, y: drag.vy - dy / sc, w: view.w, h: view.h });
    });
    function up(e) {
      delete pointers[e.pointerId];
      if (pinch) { if (Object.keys(pointers).length < 2) pinch = null; drag = null; return; }
      if (drag && !drag.moved) activate(drag.target, e);
      drag = null;
    }
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", function (e) { delete pointers[e.pointerId]; drag = null; pinch = null; });

    function activate(t, e) {
      var n = t;
      while (n && n !== svg) {
        if (n.getAttribute && n.getAttribute("data-place")) { api.selectPlace(n.getAttribute("data-place")); return; }
        if (n.getAttribute && n.getAttribute("data-iso")) { api.selectCountry(n.getAttribute("data-iso")); return; }
        n = n.parentNode;
      }
      closeCard();
    }

    // ---- land
    function drawLand(list) {
      gLand.innerHTML = "";
      list.forEach(function (c) {
        var p = s("path", { d: c.d, "class": "cm-country" + (c.iso2 ? "" : " cm-static"), "data-iso": c.iso2 || "" }, gLand);
        if (!c.iso2) p.removeAttribute("data-iso");
        if (c.iso2) p.setAttribute("aria-label", c.iso2);
      });
      refreshSelection();
    }
    function refreshSelection() {
      var paths = gLand.querySelectorAll(".cm-country");
      for (var i = 0; i < paths.length; i += 1) {
        var on = state.selectedIso && paths[i].getAttribute("data-iso") === state.selectedIso;
        if (on) paths[i].setAttribute("class", "cm-country cm-sel"); else if (paths[i].getAttribute("class") === "cm-country cm-sel") paths[i].setAttribute("class", "cm-country");
      }
    }

    // ---- pins
    var pinNodes = {};
    function drawPins() {
      gPins.innerHTML = ""; pinNodes = {};
      WF.PLACES.forEach(function (p) {
        var xy = G.project(p.lon, p.lat);
        var g = s("g", { "class": "cm-pin", "data-place": p.id, transform: "translate(" + xy[0] + " " + xy[1] + ")" }, gPins);
        var inner = s("g", { "class": "cm-pin-in" }, g);
        s("circle", { r: 22, "class": "cm-hit" }, inner);              // 44px-class tap target at default zoom
        s("circle", { r: 4.2, "class": "cm-dot" }, inner);
        var t = s("text", { y: -8, "text-anchor": "middle", "class": "cm-lbl" }, inner); t.textContent = p.city;
        pinNodes[p.id] = { g: g, inner: inner, xy: xy };
      });
      var hq = opts.hq;
      if (hq) {
        var hxy = G.project(hq.lon, hq.lat);
        var hg = s("g", { "class": "cm-pin cm-hq", transform: "translate(" + hxy[0] + " " + hxy[1] + ")" }, gPins);
        var hin = s("g", { "class": "cm-pin-in" }, hg);
        s("rect", { x: -4, y: -4, width: 8, height: 8, transform: "rotate(45)", "class": "cm-hqdot" }, hin);
        var ht = s("text", { y: 14, "text-anchor": "middle", "class": "cm-lbl cm-hqlbl" }, hin); ht.textContent = "HQ";
        pinNodes.__hq = { g: hg, inner: hin, xy: hxy };
      }
      scalePins();
      markRoute();
    }
    function scalePins() {
      var kk = Math.max(0.3, k());                                    // pins shrink as you zoom in, so they stay tappable and tidy
      Object.keys(pinNodes).forEach(function (id) { pinNodes[id].inner.setAttribute("transform", "scale(" + kk.toFixed(3) + ")"); });
      Object.keys(markers).forEach(function (id) { markers[id].inner.setAttribute("transform", "scale(" + kk.toFixed(3) + ")"); });
      gPings.setAttribute("data-k", kk.toFixed(2));
    }
    function markRoute() {
      Object.keys(pinNodes).forEach(function (id) {
        var on = state.caseRoute.indexOf(id) !== -1;
        var cls = "cm-pin" + (id === "__hq" ? " cm-hq" : "") + (on ? " cm-onroute" : "") + (id === state.selectedPlace ? " cm-chosen" : "");
        pinNodes[id].g.setAttribute("class", cls);
      });
    }

    // ---- agents + tracks + pings (called every second)
    function badgeOf(a) { return a.badge || "●"; }
    function update(data) {
      if (data.agents) state.agents = data.agents;
      if (data.pings) state.pings = data.pings;
      if (data.caseRoute) { state.caseRoute = data.caseRoute; markRoute(); }
      var seen = {}, kk = Math.max(0.3, k());
      gTracks.innerHTML = "";
      state.agents.forEach(function (a) {
        seen[a.id] = true;
        var xy = G.project(a.lon, a.lat);
        var m = markers[a.id];
        if (!m) {
          var g = s("g", { "class": "cm-agent", "data-agent": a.id }, gAgents), inner = s("g", {}, g);
          s("circle", { r: 9, "class": "cm-agent-bg" }, inner);
          var tx = s("text", { y: 4, "text-anchor": "middle", "class": "cm-agent-ico" }, inner);
          var eta = s("text", { y: -12, "text-anchor": "middle", "class": "cm-eta" }, inner);
          m = markers[a.id] = { g: g, inner: inner, ico: tx, eta: eta };
          inner.setAttribute("transform", "scale(" + kk.toFixed(3) + ")");
        }
        m.ico.textContent = badgeOf(a);
        m.g.setAttribute("transform", "translate(" + xy[0].toFixed(2) + " " + xy[1].toFixed(2) + ")");
        m.g.setAttribute("class", "cm-agent cm-" + a.status);
        m.eta.textContent = a.status === "traveling" ? fmtEta(a.etaMs) : "";
        // multi-leg track: full path of the trip, completed legs dim, current leg bright
        if (a.status === "traveling" && a.__legs) {
          a.__legs.forEach(function (l, i) {
            var fp = WF.findPlace(l.fromPlaceId), tp = WF.findPlace(l.toPlaceId);
            if (!fp || !tp) return;
            var d = G.segsToPath(G.arcSegments(fp, tp, 24));
            s("path", { d: d, "class": "cm-track" + (i < a.legIndex ? " done" : i === a.legIndex ? " now" : "") + (l.kind === "flight" ? " fly" : "") }, gTracks);
          });
        }
      });
      Object.keys(markers).forEach(function (id) { if (!seen[id]) { markers[id].g.remove(); delete markers[id]; } });
      drawPings(Date.now());
    }
    function fmtEta(ms) {
      var m = Math.ceil(ms / 60000);
      if (m >= 90) return Math.floor(m / 60) + "h " + ("0" + (m % 60)).slice(-2) + "m";
      return m + "m";
    }
    function drawPings(now) {
      gPings.innerHTML = "";
      state.pings.forEach(function (p) {
        if (now - p.at > 45000 || now < p.at - 5000) return;          // pulse for 45 s after the event
        var pl = WF.findPlace(p.placeId); if (!pl) return;
        var xy = G.project(pl.lon, pl.lat);
        var g = s("g", { "class": "cm-ping cm-ping-" + p.kind, transform: "translate(" + xy[0] + " " + xy[1] + ") scale(" + gPings.getAttribute("data-k") + ")" }, gPings);
        var dl = "-" + ((now - p.at) % 2000) + "ms";
        s("circle", { r: 8, "class": "r1", style: "animation-delay:" + dl }, g); s("circle", { r: 8, "class": "r2", style: "animation-delay:calc(" + dl + " - 1s)" }, g);
      });
    }

    // ---- inline card anchored to a pin
    function placeCard() {
      if (!card || !state.selectedPlace || !pinNodes[state.selectedPlace]) return;
      var xy = pinNodes[state.selectedPlace].xy, px = toPx(xy[0], xy[1]), hw = host.clientWidth, hh = host.clientHeight;
      var cw = card.offsetWidth || 280, ch = card.offsetHeight || 200;
      var left = Math.max(8, Math.min(hw - cw - 8, px[0] - cw / 2));
      var top = px[1] + 20 + ch > hh ? Math.max(8, px[1] - ch - 22) : px[1] + 20;
      card.style.left = left + "px"; card.style.top = top + "px";
    }
    function closeCard() {
      if (card) { card.remove(); card = null; }
      state.selectedPlace = null; markRoute();
    }

    var api = {
      svg: svg, host: host, home: function () { setView(home); },
      setLand: drawLand, drawPins: drawPins, update: update, closeCard: closeCard, zoomBy: zoomBy,
      selectCountry: function (iso2, silent) {
        state.selectedIso = iso2 || null; refreshSelection();
        if (!silent && opts.onCountry) opts.onCountry(iso2);
      },
      selectPlace: function (id) {
        var p = WF.findPlace(id); if (!p) return;
        closeCard(); state.selectedPlace = p.id; markRoute();
        state.selectedIso = p.iso2; refreshSelection();
        var node = opts.cardFor ? opts.cardFor(p) : null;
        if (node) {
          card = document.createElement("div"); card.className = "cm-card"; card.appendChild(node); host.appendChild(card);
          placeCard();
        }
        if (opts.onPlace) opts.onPlace(p);
      },
      refreshCard: function () { if (card && state.selectedPlace && opts.cardFor) { var p = WF.findPlace(state.selectedPlace); card.innerHTML = ""; card.appendChild(opts.cardFor(p)); placeCard(); } },
      focusPlace: function (id) {
        var p = WF.findPlace(id); if (!p) return; var xy = G.project(p.lon, p.lat);
        var w = Math.max(minW, Math.min(view.w, 260)), h = w * (home.h / home.w);
        setView({ x: xy[0] - w / 2, y: xy[1] - h / 2, w: w, h: h });
      },
      view: function () { return Object.assign({}, view); },
      tickPings: function () { drawPings(Date.now()); }
    };
    return api;
  }

  global.CommandMap = { create: create };
})(typeof window !== "undefined" ? window : globalThis);
