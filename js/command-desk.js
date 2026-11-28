/* Midnight Agency - Command Desk (unified player dashboard + case desk).
   Layout (landscape): top-left live map (~2/3), top-right Location Intel & Forecast (~1/3),
   bottom-left case feed, bottom-right Country board / Agents / Warrant / Labs.
   Needs: ma-config, world-factbook, crime-generator, suspect-generator, agent-roster, case-engine,
   warrant-engine, spycraft-factbook, map-geo, command-map, intel-card, minigame-slots. */
(function () {
  "use strict";
  var MA = window.MidnightAgencyConfig, CE = window.CaseEngine, WE = window.WarrantEngine, AR = window.AgentRoster, WF = window.WorldFactbook;
  var SF = window.SpycraftFactbook, CM = window.CommandMap, IC = window.IntelCard, MG = window.MapGeo, SLOTS = window.MinigameSlots;
  if (!MA.requireGate()) return;

  var query = new URLSearchParams(location.search);
  var SPEED = Math.max(1, Number(query.get("speed")) || 1);   // dev: divides travel time and speeds the case clock
  var HQ = { lat: 45.27, lon: -66.06, city: "Saint John" };    // player's home base, map pin only

  var roster = null, countries = {}, state = null, map = null, intel = null, intelKey = null;
  var view = { caseId: null, tab: "board", selected: null, facts: {}, dismissed: {}, mapPlace: null, chan: "all", ringed: {}, drawer: false, openMsg: null, autoplay: null, pick: null };
  var CA = window.CommsAudio, CN = window.CrumpledNotes;
  var soundOn = readSound();

  // ------------------------------------------------------------------ helpers
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "on") Object.keys(attrs.on).forEach(function (e) { n.addEventListener(e, attrs.on[e]); });
      else if (k === "disabled") { if (attrs[k]) n.setAttribute("disabled", ""); }
      else n.setAttribute(k, attrs[k]);
    });
    (function add(list) {
      [].concat(list == null ? [] : list).forEach(function (c) {
        if (c == null || c === false) return;
        if (Array.isArray(c)) { add(c); return; }
        n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
      });
    })(kids);
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function place(id) { return WF.findPlace(id); }
  function cityName(id) { var p = place(id); return p ? p.city : id; }
  function ctx() {
    return {
      now: Date.now(), rng: Math.random, rankLevel: MA.rankLevel(MA.read()), roster: roster,
      timeScale: SPEED, travelScale: SPEED, timeMode: MA.timeMode(),
      facts: function (p) { return countries[p.iso2] || null; }
    };
  }
  function readSound() { try { return localStorage.getItem("ma_desk_sound") !== "off"; } catch (e) { return true; } }
  function writeSound(v) { try { localStorage.setItem("ma_desk_sound", v ? "on" : "off"); } catch (e) {} }
  function save() { CE.save(state); }
  function curCase() { return state && CE.getCase(state, view.caseId); }
  function mmss(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? h + "h " + m + "m" : m + "m " + ("0" + (s % 60)).slice(-2) + "s";
  }
  function dur(min) { return min >= 90 ? Math.floor(min / 60) + "h " + ("0" + Math.round(min % 60)).slice(-2) + "m" : Math.max(1, Math.round(min)) + " min"; }

  function speak(agentId, text) {
    if (!soundOn || !window.speechSynthesis) return;
    try {
      var def = AR.byId(agentId) || { voice: { pitch: 1, rate: 1 } };
      var u = new SpeechSynthesisUtterance(text);
      u.pitch = def.voice.pitch; u.rate = def.voice.rate; u.lang = "en-US";
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    } catch (e) {}
  }
  var toastTimer = null;
  function toast(text) {
    var old = $("toast"); if (old) old.remove();
    var t = el("div", { class: "toast", id: "toast", role: "status" }, text);
    document.body.appendChild(t);
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.remove(); }, 4200);
  }
  function getJSON(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.json(); }); }

  function load() {
    var isos = {}; WF.PLACES.forEach(function (p) { isos[p.iso2] = true; });
    return Promise.all([
      getJSON("data/suspects.json"), getJSON("data/crime-rings.json"),
      Promise.all(Object.keys(isos).map(function (iso) {
        return getJSON("data/countries/" + iso.toLowerCase() + ".json").then(function (c) { countries[iso] = CE.factsFromCountry(c, { iso2: iso }); }).catch(function () {});
      })),
      getJSON("data/factbook-index.json").then(function (i) { SF.registerCountryIndex(i); }).catch(function () {}),
      MG.load("data/geo/land.json").catch(function () { return null; })
    ]).then(function (r) {
      roster = Object.assign({}, r[0], { crimeRings: Object.assign({}, r[0].crimeRings, r[1].crimeRings) });
    });
  }

  // ------------------------------------------------------------------ actions
  function runTick(quiet) {
    if (!state) return;
    var evs = CE.tick(state, ctx());
    if (evs.length) {
      save();
      evs.forEach(function (e) {
        if (e.type === "arrived") { var a = AR.byId(e.agentId); speak(e.agentId, a.name.split(" ")[0] + " here. I'm in " + cityName(e.placeId) + ". Where should I look?"); }
        if (!quiet) toast(e.text);
      });
      render();
    }
  }
  function newCase() {
    if (CE.activeCases(state).length >= CE.RULES.maxActiveCases) { toast("Three open cases is plenty. Solve one first!"); return; }
    var created = CE.createCase(state, ctx(), {});
    view.caseId = created.id; view.tab = "board"; view.selected = null;
    save(); render();
    if (map) map.focusPlace(created.route[0]);
  }
  function tripFor(agent, target) { return AR.planTrip(place(agent.stationPlaceId), target, MA.timeMode()); }
  function idleAgents() { return Object.keys(state.agents).map(function (k) { return state.agents[k]; }).filter(function (a) { return a.status !== "traveling"; }); }
  function fastest(target) {
    var idle = idleAgents();
    idle.sort(function (a, b) { return tripFor(a, target).totalMinutes - tripFor(b, target).totalMinutes; });
    return idle;
  }
  function legsText(trip) {
    if (!trip.legs.length) return "a quick look around";
    var names = [cityName(trip.legs[0].fromId)].concat(trip.legs.map(function (l) { return cityName(l.toId); }));
    return names.join(" → ");
  }
  function send(caseId, placeId) {
    var c = CE.getCase(state, caseId);
    if (!c) { toast("Take a case first, then send an agent."); return; }
    var target = place(placeId), idle = fastest(target);
    if (!idle.length) { toast("All your agents are busy travelling."); return; }
    chooseAgent(idle, target, function (agent) {
      var r = CE.dispatchAgent(state, ctx(), { caseId: c.id, agentId: agent.id, toPlaceId: placeId });
      if (!r.ok) { toast("Could not send " + AR.byId(agent.id).name + "."); return; }
      save(); closeLayer(); if (map) map.closeCard();
      toast(AR.byId(agent.id).name.split(" ")[0] + " is heading to " + target.city + " (about " + dur(r.minutes) + ").");
      render();
    });
  }
  function orders(caseId, agentId, focus) {
    var r = CE.giveOrders(state, ctx(), { caseId: caseId, agentId: agentId, focus: focus });
    if (!r.ok) { toast("That agent is not waiting for orders."); return; }
    save(); closeLayer();
    var lucky = r.entries.filter(function (e) { return e.type === "lucky"; })[0];
    if (lucky) { speak(agentId, lucky.text.replace("LUCKY BREAK!", "Lucky break!")); toast("LUCKY BREAK from " + AR.byId(agentId).name + "!"); }
    render();
  }
  function arrest(caseId, agentId) {
    var r = WE.attemptBust(state, ctx(), { caseId: caseId, agentId: agentId });
    save();
    if (r.outcome === "clean") showSummary(CE.getCase(state, caseId));
    else toast(r.text || "Nothing happened.");
    render();
  }

  // ------------------------------------------------------------------ sheets
  function closeLayer() { $("layer").innerHTML = ""; }
  function openLayer(sheet, wide) {
    var v = el("div", { class: "veil", on: { click: function (e) { if (e.target === v) closeLayer(); } } }, sheet);
    var l = $("layer"); l.innerHTML = ""; l.appendChild(v);
  }
  function chooseAgent(list, target, done) {
    openLayer(el("div", { class: "sheet" }, [
      el("h1", null, "Who should go to " + target.city + "?"),
      list.map(function (a) {
        var d = AR.byId(a.id), trip = tripFor(a, target), mins = trip.totalMinutes / SPEED;
        return el("button", { class: "focusbtn", on: { click: function () { done(a); } } }, [
          el("b", null, d.badge + " " + d.name),
          el("div", { class: "mute" }, "about " + dur(mins) + (trip.legs.length > 1 ? " · " + trip.legs.length + " legs" : "")),
          el("div", { class: "mute" }, legsText(trip))
        ]);
      }),
      el("button", { class: "btn", style: "margin-top:12px", on: { click: closeLayer } }, "Cancel")
    ]));
  }
  function focusSheet(c, a) {
    var d = AR.byId(a.id);
    openLayer(el("div", { class: "sheet" }, [
      el("h1", null, d.badge + " " + d.name + " is in " + cityName(a.stationPlaceId)),
      el("div", { class: "mute" }, "Waiting for your orders. The case clock is paused. Where should they look?"),
      Object.keys(AR.FOCUS).map(function (k) {
        var f = AR.FOCUS[k];
        return el("button", { class: "focusbtn" + (d.specialty === k ? " fav" : ""), on: { click: function () { orders(c.id, a.id, k); } } }, [
          el("b", null, f.label + (d.specialty === k ? "  ★ her specialty" : "")), el("div", { class: "mute" }, f.hint)
        ]);
      }),
      el("button", { class: "btn", style: "margin-top:12px", on: { click: function () { view.dismissed[a.id] = Date.now(); closeLayer(); } } }, "Not yet")
    ]));
  }
  function showSummary(c) {
    var s = c.summary; if (!s) return;
    openLayer(el("div", { class: "sheet" }, [
      el("div", { class: "big" }, "★ " + s.totalStars),
      el("h1", null, s.headline),
      el("div", { class: "mute" }, s.suspect.name + (s.suspect.rankTitle ? " (" + s.suspect.rankTitle + ")" : "") + " is caught! Stolen: " + s.stolenGood + "."),
      el("h2", { style: "margin-top:14px" }, "Stars"),
      s.stars.map(function (x) { return el("div", null, "★ " + x.stars + "  " + x.label); }),
      s.rankBefore !== s.rankAfter ? el("div", { class: "pill hold", style: "display:inline-block;margin-top:8px" }, "Promoted: " + s.rankBefore + " → " + s.rankAfter + "!") : null,
      el("h2", { style: "margin-top:14px" }, "The trail"),
      el("div", null, s.route.map(function (r) { return r.city + " (" + r.country + ")"; }).join("  →  ")),
      s.newStamps.length ? el("div", { style: "margin-top:8px" }, s.newStamps.map(function (st) { return el("span", { class: "stamp" }, st.city + " " + st.iso2); })) : null,
      el("h2", { style: "margin-top:14px" }, "Your agents"),
      s.agents.filter(Boolean).map(function (a) { var d = AR.byId(a.id); return el("div", null, d.badge + " " + d.name + ": +" + a.xp + " XP" + (a.leveledUp ? "  LEVEL UP!" : "")); }),
      s.unlockedAgents.length ? el("div", { class: "pill hold", style: "display:inline-block;margin-top:8px" }, "New agent joins: " + s.unlockedAgents.map(function (id) { return AR.byId(id).name; }).join(", ")) : null,
      s.ring && s.ring.leaderExposed && s.newLeaderCaseId ? el("div", { class: "pill warn", style: "display:block;margin-top:10px" }, "BIG NEWS: the ring leader has been exposed! A new high-stakes case is open.") : null,
      s.ring && s.ring.leaderCaught ? el("div", { class: "pill hold", style: "display:block;margin-top:10px" }, "The ring leader is behind bars!") : null,
      el("button", { class: "btn pink", style: "margin-top:16px;width:100%", on: { click: function () { closeLayer(); view.caseId = (CE.activeCases(state)[0] || {}).id || null; render(); } } }, "Back to the desk")
    ]));
  }
  function passport() {
    openLayer(el("div", { class: "sheet" }, [
      el("h1", null, "Passport"),
      state.passport.length ? state.passport.map(function (st) { return el("span", { class: "stamp" }, st.city + ", " + st.country); }) : el("div", { class: "mute" }, "No stamps yet. Solve a case to collect your first one."),
      el("button", { class: "btn", style: "margin-top:14px", on: { click: closeLayer } }, "Close")
    ]));
  }

  // ------------------------------------------------------------------ Factbook overlay (countries + field notes)
  var fbState = { tab: "countries", iso2: null, q: "", region: "All", note: null };
  var fbCache = {};
  function openFactbook(iso2) {
    if (iso2) { fbState.tab = "countries"; fbState.iso2 = String(iso2).toUpperCase(); }
    renderFactbook();
  }
  function fbEntries() {
    var q = fbState.q.trim().toLowerCase();
    return SF.getCountries().filter(function (c) {
      return (fbState.region === "All" || c.region === fbState.region) && (!q || c.title.toLowerCase().indexOf(q) !== -1);
    });
  }
  function loadCountry(iso2) {
    if (fbCache[iso2]) return Promise.resolve(fbCache[iso2]);
    return getJSON("data/countries/" + iso2.toLowerCase() + ".json").then(function (c) { fbCache[iso2] = c; return c; });
  }
  function row(label, value) { return value ? el("div", { class: "fb-row" }, [el("b", null, label + ": "), Array.isArray(value) ? value.join(", ") : String(value)]) : null; }
  function countryDetail(box, iso2) {
    var entry = SF.findCountry(iso2);
    box.innerHTML = "";
    if (!entry) { box.appendChild(el("div", { class: "mute" }, "No Factbook entry for that country yet.")); return; }
    box.appendChild(el("div", { class: "mute" }, "Opening " + entry.title + "…"));
    loadCountry(iso2).then(function (c) {
      if (fbState.iso2 !== iso2) return;
      box.innerHTML = "";
      var cult = c.culture || {}, geo = c.geography || {}, ex = c.exploration || {}, eco = c.economy || {};
      box.appendChild(el("div", { class: "fb-head" }, [
        cult.flag && cult.flag.svgPath ? el("img", { class: "fb-flag", src: cult.flag.svgPath, alt: "Flag of " + c.name }) : null,
        el("div", null, [el("h1", { style: "margin:0" }, c.name), el("div", { class: "mute" }, [c.subregion || c.region, c.capital ? " · Capital: " + c.capital.name : ""].join(""))])
      ]));
      var here = WF.placesByIso2 ? WF.placesByIso2(iso2) : [];
      if (here.length) box.appendChild(el("div", { class: "row", style: "margin:8px 0" }, [el("span", { class: "mute" }, "Agency cities:")].concat(here.map(function (p) {
        return el("button", { class: "btn", on: { click: function () { closeLayer(); view.mapPlace = p.id; if (map) { map.focusPlace(p.id); map.selectPlace(p.id); } } } }, "📍 " + p.city);
      }))));
      [row("Population", c.population && c.population.display), row("Languages", cult.languages), row("Money", cult.currency && (cult.currency.name + " (" + cult.currency.symbol + ")")),
        row("Climate", geo.climate), row("Land", geo.terrain), row("Drives on the", cult.drivingSide), row("Landmarks", ex.landmarks), row("Wildlife", ex.wildlife),
        row("Sells abroad", eco.exports), row("Calling code", c.callingCode), row("Anthem", cult.anthem && cult.anthem.title),
        ex.didYouKnow ? el("div", { class: "fb-fun" }, "Did you know? " + ex.didYouKnow) : null].forEach(function (n) { if (n) box.appendChild(n); });
    }).catch(function () { box.innerHTML = ""; box.appendChild(el("div", { class: "mute" }, "Can't load this entry offline yet. Open the game once online and it will be saved.")); });
  }
  function noteDetail(box, id) {
    var n = SF.findEntry(id); box.innerHTML = "";
    if (!n) { box.appendChild(el("div", { class: "mute" }, "Pick a field note.")); return; }
    box.appendChild(el("h1", { style: "margin:0 0 4px" }, n.title));
    box.appendChild(el("div", { class: "mute" }, n.summary));
    if (n.howItWorks) box.appendChild(el("p", null, n.howItWorks));
    if (n.steps) box.appendChild(el("ol", null, n.steps.map(function (s) { return el("li", null, s); })));
    if (n.example) box.appendChild(el("div", { class: "fb-fun" }, "Example: " + n.example.plain + " → " + n.example.cipher + " (" + n.example.key + ")"));
    if (n.tip) box.appendChild(el("p", { class: "mute" }, "Tip: " + n.tip));
    if (n.labHook && SLOTS.has(n.labHook)) box.appendChild(el("button", { class: "btn pink", on: { click: function () { closeLayer(); SLOTS.open(n.labHook, {}); } } }, "Try it in the lab"));
  }
  function renderFactbook() {
    var regions = ["All"]; SF.getCountries().forEach(function (c) { if (c.region && regions.indexOf(c.region) === -1) regions.push(c.region); });
    var detail = el("div", { class: "fb-detail scroll" });
    var list = el("div", { class: "fb-list scroll" });
    function fillList() {
      list.innerHTML = "";
      if (fbState.tab === "countries") {
        fbEntries().forEach(function (c) {
          list.appendChild(el("button", { class: "fb-item" + (fbState.iso2 === c.iso2 ? " on" : ""), on: { click: function () { fbState.iso2 = c.iso2; fillList(); countryDetail(detail, c.iso2); } } }, [
            c.flagPath ? el("img", { src: c.flagPath, alt: "", width: 28 }) : null, el("span", null, c.title)
          ]));
        });
        if (!list.firstChild) list.appendChild(el("div", { class: "mute", style: "padding:10px" }, "Nothing matches. Try another search."));
      } else {
        SF.getEntries("all").forEach(function (n) {
          list.appendChild(el("button", { class: "fb-item" + (fbState.note === n.id ? " on" : ""), on: { click: function () { fbState.note = n.id; fillList(); noteDetail(detail, n.id); } } }, el("span", null, n.title)));
        });
      }
    }
    var search = el("input", { class: "fb-search", type: "search", placeholder: "Search countries", value: fbState.q, "aria-label": "Search countries" });
    search.addEventListener("input", function () { fbState.q = search.value; fillList(); });
    var tabs = el("div", { class: "seg" }, [["countries", "Countries"], ["notes", "Field notes"]].map(function (t) {
      return el("button", { class: fbState.tab === t[0] ? "on" : "", on: { click: function () { fbState.tab = t[0]; renderFactbook(); } } }, t[1]);
    }));
    var regionRow = el("div", { class: "row", style: "margin:6px 0" }, regions.map(function (r) {
      return el("button", { class: "chipbtn" + (fbState.region === r ? " on" : ""), on: { click: function () { fbState.region = r; renderFactbook(); } } }, r);
    }));
    var left = el("div", { class: "fb-left" }, [tabs, fbState.tab === "countries" ? [search, regionRow] : null, list]);
    openLayer(el("div", { class: "sheet fb" }, [
      el("div", { class: "row", style: "justify-content:space-between" }, [el("h1", { style: "margin:0" }, "📖 World Factbook"), el("button", { class: "btn", on: { click: closeLayer } }, "Close")]),
      el("div", { class: "fb-body" }, [left, detail])
    ]));
    fillList();
    if (fbState.tab === "countries") { if (fbState.iso2) countryDetail(detail, fbState.iso2); else detail.appendChild(el("div", { class: "mute" }, "Pick a country, or tap one on the map.")); }
    else noteDetail(detail, fbState.note);
    var sel = list.querySelector(".fb-item.on"); if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "center" });
  }

  // ------------------------------------------------------------------ map + intel
  function setIntel(p) {
    var key = p ? p.id : "none";
    if (key === intelKey) return;
    intelKey = key;
    if (intel) intel.stop();
    intel = IC.render($("intel"), p, {
      onFactbook: function (iso2) { openFactbook(iso2); },
      countryName: function (iso2) { var e = SF.findCountry(iso2); return e ? e.title : null; },
      rows: function (pl) {
        var f = CE.factSummary(countries[pl.iso2] || null, pl) || [];
        return f.filter(function (r) { return !r.flagSrc; }).map(function (r) { return [r.label, r.text]; });
      }
    });
  }
  function pinCard(p) {
    var c = curCase(), idle = fastest(p), best = idle[0];
    var info = [];
    if (best) {
      var trip = tripFor(best, p);
      info.push(el("div", { class: "mute" }, "Fastest: " + AR.byId(best.id).badge + " " + AR.byId(best.id).name + " · about " + dur(trip.totalMinutes / SPEED) + (MA.timeMode() === "real" ? " (real time)" : "")));
      info.push(el("div", { class: "mute" }, "Route: " + legsText(trip)));
    } else info.push(el("div", { class: "mute" }, "All agents are travelling."));
    var t = IC.localTime(p.tz);
    return el("div", null, [
      el("div", { class: "cc-title" }, p.city + ", " + p.country),
      el("div", { class: "mute" }, "Local time " + t.text + (t.isDay ? " ☀️" : " 🌙")),
      info,
      el("div", { class: "row", style: "margin-top:8px" }, [
        el("button", { class: "btn pink", disabled: !best, on: { click: function () { send(c ? c.id : null, p.id); } } }, c ? "Send agent" : "Take a case first"),
        el("button", { class: "btn", on: { click: function () { openFactbook(p.iso2); } } }, "📖 Factbook"),
        el("button", { class: "btn", "aria-label": "Close", on: { click: function () { map.closeCard(); } } }, "✕")
      ])
    ]);
  }
  function initMap() {
    map = CM.create($("map"), {
      hq: HQ,
      cardFor: pinCard,
      onPlace: function (p) { view.mapPlace = p.id; setIntel(p); },
      onCountry: function (iso2) {
        var here = WF.placesByIso2 ? WF.placesByIso2(iso2) : [];
        if (here.length) setIntel(here[0]);
        openFactbook(iso2);
      }
    });
    var land = MG.getLand();
    if (land) map.setLand(land);
    else $("map").appendChild(el("div", { class: "mapnote" }, "Map shapes are missing, but the city pins still work."));
    map.drawPins();
  }
  function pushMap() {
    if (!map || !state) return;
    var now = Date.now();
    var pos = CE.agentPositions(state, now);
    pos.forEach(function (p) { var a = state.agents[p.id]; if (a && a.assignment && a.assignment.legs && p.status === "traveling") p.__legs = a.assignment.legs; });
    var c = curCase();
    map.update({ agents: pos, pings: state.pings || [], caseRoute: c ? CE.currentRouteIds(c) : [] });
  }

  // ------------------------------------------------------------------ render
  function render() {
    renderBar();
    var c = curCase();
    var active = CE.activeCases(state);
    if (!c || c.status === "solved") { view.caseId = active.length ? active[0].id : null; c = curCase(); }
    var feed = $("feed"), side = $("side"); feed.innerHTML = ""; side.innerHTML = "";
    if (!c) {
      feed.appendChild(el("div", { class: "empty" }, [
        el("div", { class: "big" }, "🕵️"), el("h2", { style: "font-size:22px" }, "No open cases"),
        el("div", { class: "mute", style: "margin-bottom:12px" }, "Something sneaky is always going on somewhere. Ready?"),
        el("button", { class: "btn pink", on: { click: newCase } }, "Take a new case")
      ]));
      side.appendChild(renderSide(null));
    } else {
      feed.appendChild(renderLeft(c)); side.appendChild(renderSide(c));
      var waiting = c.pings.map(function (id) { return state.agents[id]; }).filter(function (a) { return a && a.status === "onScene" && !view.dismissed[a.id]; })[0];
      if (waiting && !document.querySelector(".veil")) focusSheet(c, waiting);
    }
    if (!view.mapPlace && c) { var sp = place(c.route[Math.max(0, c.progress)]); if (sp) setIntel(sp); }
    if (!view.mapPlace && !c) setIntel(null);
    pushMap();
    if (state) checkIncoming(false);
    if (view.drawer && !view.openMsg) renderDrawer();
  }
  function renderBar() {
    var p = MA.read().player, trust = Math.max(0, Math.min(5, Number(p.trust)));
    var next = MA.nextRankInfo(p.stars, p.solved);
    var tabs = el("div", { class: "tabs" }, CE.activeCases(state).map(function (c) {
      return el("button", { class: "casetab" + (c.id === view.caseId ? " on" : ""), on: { click: function () { view.caseId = c.id; view.selected = null; render(); if (map) map.focusPlace(c.route[Math.max(0, c.progress)]); } } }, "#" + c.number + " " + c.title);
    }));
    var bar = $("bar"); bar.innerHTML = "";
    [
      el("span", { class: "chip", title: next ? "Next: " + next.name + " (" + (next.starsRemaining ? next.starsRemaining + " more ★" : "") + (next.starsRemaining && next.solvedRemaining ? ", " : "") + (next.solvedRemaining ? next.solvedRemaining + " more solved" : "") + ")" : "Top rank" }, p.rank + " · " + p.stars + " ★"),
      el("span", { class: "chip", title: "Agency trust" }, "trust " + new Array(trust + 1).join("●") + new Array(6 - trust).join("○")),
      tabs,
      MA.timeMode() === "real" ? el("span", { class: "chip", title: "GM Suite: real travel times" }, "⏱ Real time") : null,
      el("button", { class: "btn gold", on: { click: newCase } }, "+ Case"),
      el("button", { class: "btn" + (CE.unreadCounts(state).all ? " gold" : ""), id: "commsBtn", on: { click: function () { view.drawer ? closeDrawer() : openDrawer(); } } }, "📨 Comms" + (CE.unreadCounts(state).all ? " (" + CE.unreadCounts(state).all + ")" : "")),
      el("button", { class: "btn", on: { click: function () { openFactbook(null); } } }, "📖 Factbook"),
      el("button", { class: "btn", on: { click: passport } }, "Passport " + state.passport.length),
      el("button", { class: "btn", "aria-label": "Sound", on: { click: function () { soundOn = !soundOn; writeSound(soundOn); if (!soundOn && window.speechSynthesis) window.speechSynthesis.cancel(); renderBar(); } } }, soundOn ? "🔊" : "🔇")
    ].forEach(function (n) { if (n) bar.appendChild(n); });
  }

  function paceChip(c) {
    if (c.holdSince != null) return el("span", { class: "pill hold", "data-pace": c.id }, "Clock paused · agent waiting for orders");
    var cr = c.crime;
    if (c.status === "cold") return el("span", { class: "pill" }, "Trail quiet · no rush, still solvable");
    var ms = cr.remainingMs - Math.max(0, Date.now() - c.lastTickAt) * SPEED;
    return el("span", { class: "pill" + (ms < 3 * 3600000 ? " warn" : ""), "data-pace": c.id }, "Suspect moves on in " + mmss(ms));
  }
  function renderLeft(c) {
    var feed = el("div", { class: "feedlist" }, c.board.slice().reverse().map(function (b) {
      var a = b.agentId ? AR.byId(b.agentId) : null;
      var label = { brief: "Case file", scene: "Scene report", trail: "Trail clue", suspect: "Suspect clue", hq: "HQ", deadend: "Dead end", located: "Suspect located", lucky: "Lucky break" }[b.type] || "Report";
      var stop = b.type === "trail" && b.stopIdx != null ? c.stops[b.stopIdx] : null;
      var flags = stop ? stop.parts.filter(function (x) { return x.flagSrc; }) : [];
      return el("div", { class: "entry " + b.type }, [el("div", { class: "meta" }, (a ? a.badge + " " + a.name + " · " : "") + label), b.text,
        flags.map(function (x) { return el("img", { class: "flagimg", src: x.flagSrc, alt: "A flag from the clue" }); })]);
    }));
    return el("div", { class: "colfill" }, [
      el("div", { class: "card" }, [
        el("h2", null, (c.isLeaderCase ? "★ BIG CASE · " : "") + c.title),
        el("div", { class: "pace" }, [paceChip(c), c.extensions ? el("span", { class: "pill" }, "Trail extended " + c.extensions + "×") : null])
      ]),
      el("div", { class: "scroll", style: "flex:1" }, feed)
    ]);
  }
  function renderSide(c) {
    var tabs = el("div", { class: "seg" }, [["board", "Board"], ["agents", "Agents"], ["warrant", "Dossier"], ["labs", "Labs"]].map(function (t) {
      return el("button", { class: view.tab === t[0] ? "on" : "", on: { click: function () { view.tab = t[0]; render(); } } }, t[1]);
    }));
    var body = view.tab === "labs" ? renderLabs() : !c ? el("div", { class: "mute", style: "padding:10px" }, "Take a case to use the board, agents and dossier.") :
      view.tab === "agents" ? renderAgents(c) : view.tab === "warrant" ? renderWarrant(c) : renderBoard(c);
    return el("div", { class: "colfill" }, [tabs, el("div", { class: "scroll", style: "flex:1" }, body)]);
  }
  // ------------------------------------------------------------------ comms inbox
  var CH_LABEL = { all: "All", call: "Calls", email: "Emails", text: "Texts", voicemail: "Voicemails" };
  var CH_ICON = { call: "📞", email: "✉️", text: "💬", voicemail: "📼" };
  var REL_LABEL = { confirmed: "Confirmed", witness: "Witness", rumour: "Rumour" };
  function ago(at) { var m = Math.max(0, Math.round((Date.now() - at) / 60000)); return m < 1 ? "now" : m < 60 ? m + " min" : Math.round(m / 60) + " h"; }
  function snippet(t) { t = String(t || ""); return t.length > 70 ? t.slice(0, 67) + "…" : t; }
  function who(m) { return (m.from.id === "chief" ? "🎖️ " : m.from.badge ? m.from.badge + " " : "") + m.from.name; }
  function openDrawer(msgId) { view.drawer = true; view.openMsg = msgId || null; renderDrawer(); renderBar(); }
  function closeDrawer() { CA.stop(); view.drawer = false; view.openMsg = null; view.autoplay = null; renderDrawer(); renderBar(); }
  function renderDrawer() {
    var d = $("drawer"); if (!d) { d = el("aside", { id: "drawer", "aria-label": "Comms" }); document.body.appendChild(d); }
    d.innerHTML = ""; d.className = "drawer" + (view.drawer ? " open" : "");
    if (!view.drawer) return;
    var m = view.openMsg ? CE.allComms(state).filter(function (x) { return x.id === view.openMsg; })[0] : null;
    d.appendChild(el("div", { class: "drawer-h" }, [
      m ? el("button", { class: "btn", on: { click: function () { CA.stop(); view.openMsg = null; renderDrawer(); renderBar(); } } }, "← Back") : el("h2", null, "📨 Comms"),
      el("button", { class: "btn", "aria-label": "Close comms", on: { click: closeDrawer } }, "✕")
    ]));
    d.appendChild(el("div", { class: "drawer-b" }, m ? commDetail(m) : commList()));
  }
  function commList() {
    var counts = CE.unreadCounts(state), all = CE.allComms(state);
    var chips = el("div", { class: "row", style: "margin-bottom:8px" }, Object.keys(CH_LABEL).map(function (k) {
      return el("button", { class: "chipbtn" + (view.chan === k ? " on" : ""), on: { click: function () { view.chan = k; renderDrawer(); } } }, [CH_LABEL[k], counts[k] ? el("span", { class: "badge-n" }, counts[k]) : null]);
    }));
    var list = all.filter(function (m) { return view.chan === "all" || m.channel === view.chan; });
    var rows = list.slice(0, 40).map(function (m) {
      return el("button", { class: "mrow" + (m.state === "new" ? " unread" : ""), on: { click: function () { markRead(m); view.openMsg = m.id; renderDrawer(); renderBar(); } } }, [
        el("span", { class: "mico" }, CH_ICON[m.channel]),
        el("span", { class: "mbody" }, [el("b", null, who(m) + " · " + m.subject), el("span", { class: "mute" }, snippet(m.body))]),
        el("span", { class: "mmeta" }, [ago(m.at), m.reliability && m.reliability !== "confirmed" ? el("span", { class: "rel rel-" + m.reliability }, REL_LABEL[m.reliability]) : null])
      ]);
    });
    return [chips, rows.length ? rows : el("div", { class: "mute", style: "padding:10px" }, all.length ? "Nothing in this folder." : "No messages yet. Reports from your agents and the Chief land here.")];
  }
  function markRead(m) { if (m.state === "new") { m.state = "read"; save(); } }
  function commDetail(m) {
    var voice = m.channel === "call" || m.channel === "voicemail", cid = m.callerId || {};
    var transcript = voice ? el("div", { class: "transcript", "aria-live": "polite" }, (m.transcript || [m.body]).map(function (t, i) { return el("span", { class: "tchunk", "data-i": i }, t + " "); })) : null;
    var canvas = voice ? el("canvas", { class: "wave", "aria-label": "Call waveform" }) : null;
    var playing = false, btn = null;
    function setBtn() { if (btn) btn.textContent = playing ? "■ Stop" : "▶ " + (m.channel === "voicemail" ? "Play voicemail" : "Play call"); }
    function start() {
      playing = true; setBtn();
      var prefer = m.from.id === "chief" ? window.ChiefCalls.CHIEF.prefer : (AR.byId(m.from.id) || {}).prefer;
      CA.play(m, {
        canvas: canvas, prefer: prefer, silent: !soundOn,
        onChunk: function (i) { var all = transcript.querySelectorAll(".tchunk"); for (var k = 0; k < all.length; k += 1) all[k].className = "tchunk" + (k < i ? " said" : k === i ? " now" : ""); },
        onEnd: function () { playing = false; setBtn(); var all = transcript.querySelectorAll(".tchunk"); for (var k = 0; k < all.length; k += 1) all[k].className = "tchunk said"; }
      });
    }
    if (voice) btn = el("button", { class: "btn pink", style: "margin:8px 0;width:100%", on: { click: function () { if (playing) { CA.stop(); playing = false; setBtn(); } else start(); } } });
    setBtn();
    if (voice && view.autoplay === m.id) { view.autoplay = null; setTimeout(start, 30); }
    return [
      el("div", { class: "mute" }, CH_ICON[m.channel] + " " + CH_LABEL[m.channel].replace(/s$/, "") + " · " + ago(m.at) + " ago"),
      el("h1", { style: "margin:2px 0" }, cid.anonymous ? "🕶️ Unknown caller" : who(m)),
      cid.anonymous ? el("div", { class: "pill hold", style: "display:inline-block;margin:4px 0" }, "Anonymous tip") : (cid.number ? el("div", { class: "mute" }, cid.number) : null),
      el("div", { class: "mute" }, m.subject),
      m.reliability && m.reliability !== "confirmed" ? el("div", { class: "row", style: "margin:6px 0" }, [el("span", { class: "rel rel-" + m.reliability }, REL_LABEL[m.reliability] + " source"), m.hint ? el("span", { class: "hintline" }, m.hint) : null]) : null,
      voice ? [btn, canvas, transcript] : el("p", { class: "mbodytxt" + (m.channel === "email" ? " email" : " chat") }, m.body),
      m.visual && m.visual.kind === "note" ? el("div", { class: "notewrap" }, [el("div", { class: "mute" }, "Found with it:"), CN.render(m.visual.note)]) : null
    ];
  }
  var ringEl = null;
  function checkIncoming(first) {
    CE.allComms(state).forEach(function (m) {
      if (m.channel !== "call" || m.state !== "new" || view.ringed[m.id]) return;
      view.ringed[m.id] = true;
      if (first) return;                                  // calls already waiting at start-up just sit in the inbox
      if (soundOn) CA.chime(m.from.id === "chief" ? "chief" : "agent");
      showRing(m);
    });
  }
  function showRing(m) {
    if (ringEl) ringEl.remove();
    var cid = m.callerId || { label: m.from.name }, anon = !!cid.anonymous;
    var node = el("div", { class: "ring" + (anon ? " anon" : ""), role: "alert" }, [
      el("div", { class: "ring-t" }, [anon ? "🕶️ Incoming call · anonymous tip" : "📞 Incoming call", el("b", null, anon ? "Unknown caller" : who(m)), el("span", null, anon ? "Number withheld" : [cid.sub, cid.number].filter(Boolean).join(" · "))]),
      el("button", { class: "btn pink", on: { click: function () { node.remove(); ringEl = null; view.autoplay = m.id; markRead(m); openDrawer(m.id); } } }, "Answer"),
      el("button", { class: "btn", on: { click: function () { node.remove(); ringEl = null; render(); } } }, "Later")
    ]);
    ringEl = node; document.body.appendChild(node);
    setTimeout(function () { if (node.parentNode) { node.remove(); if (ringEl === node) ringEl = null; } }, 20000);
  }

  function renderLabs() {
    var out = SLOTS.list().map(function (s) {
      return el("div", { class: "cand" }, [
        el("div", null, [el("div", { class: "nm" }, s.title), el("div", { class: "mute" }, s.ready ? s.blurb : s.blurb + " Coming soon.")]),
        el("div", { class: "acts" }, [el("button", { class: "btn pink", disabled: !s.ready, on: { click: function () { SLOTS.open(s.kind, { state: state, caseId: view.caseId }); } } }, s.ready ? "Open" : "Soon")])
      ]);
    });
    var qs = query.get("dev") ? "?dev=1" : "";
    out.push(el("div", { class: "cand" }, [el("div", null, [el("div", { class: "nm" }, "Phrasebook & news"), el("div", { class: "mute" }, "Language finder and the world ticker.")]), el("div", { class: "acts" }, [el("a", { class: "btn", href: "./hq-classic.html" + qs }, "Open")])]));
    out.push(el("div", { class: "cand" }, [el("div", null, [el("div", { class: "nm" }, "GM Suite"), el("div", { class: "mute" }, "Grown-ups only.")]), el("div", { class: "acts" }, [el("a", { class: "btn", href: "./gm-suite/midnight-agency-backend.html" }, "Open")])]));
    return out;
  }

  function renderBoard(c) {
    var out = [];
    var cand = CE.currentCandidates(c);
    var atScene = c.progress < 0;
    if (atScene) {
      var sp = place(c.route[0]);
      out.push(el("div", { class: "cand" }, [
        el("div", null, [el("div", { class: "nm" }, "Crime scene: " + sp.city + ", " + sp.country), el("div", { class: "mute" }, "Start here. Send an agent, or tap the pin on the map.")]),
        el("div", { class: "acts" }, [el("button", { class: "btn pink", on: { click: function () { send(c.id, sp.id); } } }, "Send")])
      ]));
    }
    if (cand) {
      out.push(el("div", { class: "card", style: "margin-bottom:8px" }, [
        el("h2", null, cand.revealed ? "Lucky break: the next stop is known!" : "Where did the suspect go next?"),
        cand.parts.map(function (p) { return [el("div", { class: "mute" }, "• Someone says they " + p.text), p.flagSrc ? el("img", { class: "flagimg", src: p.flagSrc, alt: "A flag from the clue" }) : null]; }),
        el("div", { class: "mute", style: "margin-top:6px" }, "Use Fact on each card, Rule Out the ones that don't fit, then Send an agent.")
      ]));
      cand.candidateIds.forEach(function (pid) {
        var p = place(pid), outd = !!c.ruledOut[pid], showFacts = view.facts[c.id + pid];
        out.push(el("div", { class: "cand" + (outd ? " out" : "") }, [
          el("div", { class: "nm", on: { click: function () { if (map) { map.focusPlace(pid); map.selectPlace(pid); } } } }, p.city + ", " + p.country),
          el("div", { class: "acts" }, [
            el("button", { class: "btn", on: { click: function () { view.facts[c.id + pid] = !showFacts; render(); } } }, "Fact"),
            el("button", { class: "btn", on: { click: function () { CE.toggleRuledOut(c, pid); save(); render(); } } }, outd ? "Undo" : "Rule Out"),
            el("button", { class: "btn pink", disabled: outd, on: { click: function () { send(c.id, pid); } } }, "Send")
          ]),
          showFacts ? el("div", { class: "facts" }, CE.factSummary(countries[p.iso2] || null, p).map(function (r) { return el("div", null, [el("b", null, r.label + ": "), r.flagSrc ? el("img", { class: "flagimg", src: r.flagSrc, alt: "Flag of " + p.country }) : r.text]); })) : null
        ]));
      });
    } else if (!atScene) {
      var last = place(c.route[Math.max(0, c.progress)]);
      var final = c.progress === CE.finalIdx(c);
      out.push(el("div", { class: "card" }, [
        el("h2", null, final ? "The suspect is here in " + last.city + "!" : "No new destination yet"),
        el("div", { class: "mute" }, final ? "Open the Dossier tab, then arrest with an agent who is in " + last.city + "." : "Ask the agent in " + last.city + " again. Try a different focus (Transit & Ports finds trails fastest).")
      ]));
    }
    if (!atScene) {
      var again = place(c.route[c.progress]);
      out.push(el("div", { class: "cand" }, [
        el("div", null, [el("div", { class: "nm" }, "Look around " + again.city + " again"), el("div", { class: "mute" }, "A quick second look can turn up more clues.")]),
        el("div", { class: "acts" }, [el("button", { class: "btn", on: { click: function () { send(c.id, again.id); } } }, "Send")])
      ]));
    }
    return out;
  }

  function renderAgents(c) {
    var out = Object.keys(state.agents).map(function (id) {
      var a = state.agents[id], d = AR.byId(id);
      var need = a.level < 3 ? AR.XP_FOR_LEVEL[a.level + 1] : AR.XP_FOR_LEVEL[3], prev = AR.XP_FOR_LEVEL[a.level];
      var pct = a.level >= 3 ? 100 : Math.round(100 * (a.xp - prev) / Math.max(1, need - prev));
      var status = a.status === "traveling" ? el("span", { "data-eta": id }, "On the way to " + cityName(a.assignment.toPlaceId) + " · " + mmss(a.assignment.arrivalTime - Date.now()))
        : a.status === "onScene" ? "Waiting for orders in " + cityName(a.stationPlaceId) : "Ready in " + cityName(a.stationPlaceId);
      return el("div", { class: "agent" }, [
        el("div", { class: "badge" }, d.badge),
        el("div", null, [
          el("div", { style: "font-weight:800" }, d.name + "  · Lv " + a.level),
          el("div", { class: "mute" }, status), el("div", { class: "mute" }, "Best at " + AR.FOCUS[d.specialty].label + " · " + d.quirk),
          el("div", { class: "row" }, [el("span", { class: "hearts" }, new Array(a.rapport + 1).join("♥") + new Array(6 - a.rapport).join("♡")), el("span", { class: "mute" }, "rapport")]),
          el("div", { class: "bar2" }, el("i", { style: "width:" + pct + "%" }))
        ]),
        a.status === "onScene" && a.assignment && a.assignment.caseId === c.id ? el("button", { class: "btn pink", on: { click: function () { delete view.dismissed[id]; focusSheet(c, a); } } }, "Orders") : null
      ]);
    });
    AR.AGENTS.filter(function (d) { return !state.agents[d.id]; }).forEach(function (d) {
      var why = d.unlock.solved ? "Joins after " + d.unlock.solved + " solved cases" : "Joins at " + MA.RANKS[d.unlock.rank - 1].name + " rank";
      out.push(el("div", { class: "agent locked" }, [el("div", { class: "badge" }, "❔"), el("div", null, [el("div", { style: "font-weight:800" }, "Locked agent"), el("div", { class: "mute" }, why)]), null]));
    });
    return out;
  }

  var TRAIT_NAMES = { hairColor: "Hair colour", hairStyle: "Hair style", build: "Build", height: "Height", complexion: "Skin", eyeColor: "Eyes", facialHair: "Facial hair" };
  var SKIN = { fair: "#F3D2B8", olive: "#D9B48C", tan: "#C99366", "deep-brown": "#6B4429", "warm-brown": "#9A6A45" };
  var HAIR = { black: "#1b1b1f", "dark-brown": "#3a2518", "light-brown": "#7a5232", blonde: "#E3C36A", "red-auburn": "#A5461F", "silver-gray": "#BFC3CC" };
  var EYE = { brown: "#4a2a12", hazel: "#8a6a2a", green: "#2f7a4a", blue: "#2f6fb0", gray: "#7b8794" };
  function cat(m, k) { return m && m.traits && m.traits[k] ? m.traits[k].category : ""; }
  function mugshot(m, size) {
    var ns = "http://www.w3.org/2000/svg", h = HAIR[cat(m, "hairColor")] || "#333", sk = SKIN[cat(m, "complexion")] || "#C99366", ey = EYE[cat(m, "eyeColor")] || "#333";
    var style = cat(m, "hairStyle"), build = cat(m, "build"), fh = cat(m, "facialHair"), ht = cat(m, "height");
    var sw = /stocky|athletic/.test(build) ? 46 : /lanky|wiry/.test(build) ? 30 : 38, top = ht === "tall" ? 84 : ht === "short" ? 94 : 89;
    var g = '<rect width="100" height="100" fill="#2a2450"/><rect x="0" y="' + (ht === "tall" ? 12 : 22) + '" width="100" height="2" fill="#6f66b0"/>' +
      '<path d="M' + (50 - sw) + ' 100 Q50 ' + (top - 6) + ' ' + (50 + sw) + ' 100Z" fill="#3b3470"/>';
    var back = /ponytail|braids/.test(style) ? '<circle cx="50" cy="22" r="9" fill="' + h + '"/>' : "";
    var cap = style === "curly" ? '<circle cx="34" cy="38" r="9" fill="' + h + '"/><circle cx="50" cy="32" r="11" fill="' + h + '"/><circle cx="66" cy="38" r="9" fill="' + h + '"/>' : style === "braids" ? '<path d="M32 44Q32 22 50 22Q68 22 68 44L62 40Q50 30 38 40Z" fill="' + h + '"/><rect x="29" y="44" width="5" height="26" rx="2.5" fill="' + h + '"/><rect x="66" y="44" width="5" height="26" rx="2.5" fill="' + h + '"/>' : style === "wavy-swept" ? '<path d="M30 46Q28 20 52 22Q74 22 70 46Q60 32 40 36Q34 38 30 46Z" fill="' + h + '"/>' : style === "tousled" ? '<path d="M30 46L34 26L42 32L48 20L56 31L66 24L70 46Q50 30 30 46Z" fill="' + h + '"/>' : '<path d="M31 46Q30 24 50 24Q70 24 69 46Q50 34 31 46Z" fill="' + h + '"/>';
    var face = '<ellipse cx="50" cy="52" rx="19" ry="23" fill="' + sk + '"/><circle cx="43" cy="50" r="3" fill="' + ey + '"/><circle cx="57" cy="50" r="3" fill="' + ey + '"/><path d="M44 62Q50 66 56 62" stroke="#00000066" stroke-width="2" fill="none"/>';
    var hair = /beard/.test(fh) ? '<path d="M33 56Q50 86 67 56Q60 70 50 70Q40 70 33 56Z" fill="' + h + '"/>' : /mustache|moustache/.test(fh) ? '<path d="M42 59Q50 55 58 59Q50 62 42 59Z" fill="' + h + '"/>' : /stub/.test(fh) ? '<path d="M34 58Q50 80 66 58Q60 72 50 72Q40 72 34 58Z" fill="' + h + '" opacity=".35"/>' : "";
    var d = document.createElement("span"); d.className = "mug"; d.style.width = d.style.height = (size || 64) + "px";
    d.innerHTML = '<svg xmlns="' + ns + '" viewBox="0 0 100 100" role="img" aria-label="Suspect photo">' + g + back + face + cap + hair + "</svg>";
    return d;
  }
  function tagChip(t) { return t && t !== "confirmed" ? el("span", { class: "rel rel-" + t }, REL_LABEL[t]) : null; }
  function traitPicker(c, k) {
    var reps = CE.reportsFor(c, k).filter(function (r) { return true; }), opts = CE.traitOptions(c, k);
    var out = [];
    if (reps.length) out.push(el("div", { class: "mute" }, "From your reports:"));
    reps.forEach(function (r) {
      out.push(el("button", { class: "pickbtn", on: { click: function () { CE.pinReport(c, r.id); view.pick = null; save(); render(); } } }, [el("span", null, r.clueText), r.shown ? tagChip(r.tag) : null, r.shown && r.hint ? el("span", { class: "hintline" }, r.hint) : null]));
    });
    out.push(el("div", { class: "mute", style: "margin-top:6px" }, "Or write down what you think:"));
    opts.forEach(function (o) { out.push(el("button", { class: "pickbtn alt", on: { click: function () { CE.pinManual(c, k, o.category); view.pick = null; save(); render(); } } }, o.clueText)); });
    return el("div", { class: "picker" }, out);
  }
  function suspectCard(c, m) {
    var ring = (roster.crimeRings || {})[m.ringId], haunts = ring && ring.homeHubs ? ring.homeHubs.map(function (h) { return h.city; }) : [];
    var prior = (state.caught || {})[m.id];
    return el("div", { class: "card dossier" }, [
      el("div", { class: "row" }, [mugshot(m, 84), el("div", null, [
        el("h2", { style: "margin:0" }, m.displayName), m.nickname ? el("div", { class: "mute" }, "“" + m.nickname + "”") : null,
        m.rankTitle ? el("div", { class: "tiny" }, m.rankTitle) : null])]),
      ring ? el("div", { class: "fb-row" }, [el("b", null, "Gang: "), ring.name + (ring.motto ? " — " + ring.motto : "")]) : null,
      haunts.length ? el("div", { class: "fb-row" }, [el("b", null, "Known haunts: "), haunts.join(", ")]) : null,
      el("div", { class: "fb-row" }, [el("b", null, "Record: "), prior ? "Caught before ×" + prior + " · fingerprints on file 🖐️" : "No arrests yet · no fingerprints on file"])
    ]);
  }
  function renderWarrant(c) {
    var out = [];
    var nb = (c.notebook && c.notebook.traits) || {};
    out.push(el("div", { class: "mute", style: "margin-bottom:6px" }, "Your notebook. Tap a line to write down a clue. Nothing is filled in for you."));
    CE.TRAIT_KEYS.forEach(function (k) {
      var t = nb[k], open = view.pick === k;
      out.push(el("div", { class: "trow" }, [
        el("button", { class: "trait" + (t ? " known" : ""), "data-trait": k, on: { click: function () { view.pick = open ? null : k; render(); } } }, [el("span", null, TRAIT_NAMES[k] + ": " + (t ? t.clueText : "?")), t ? tagChip(t.tag) : null]),
        t ? el("button", { class: "btn", "aria-label": "Clear " + TRAIT_NAMES[k], on: { click: function () { CE.unpin(c, k); save(); render(); } } }, "✕") : null,
        open ? traitPicker(c, k) : null
      ]));
    });
    var matches = WE.matchingLineup(c);
    var sel = view.selected && matches.some(function (m) { return m.id === view.selected; }) ? view.selected : null;
    if (!matches.length) out.push(el("div", { class: "card mute" }, "Nobody matches your notes. One of your clues may be wrong. Check the shaky sources (Rumour or Witness) and ask again."));
    else out.push(el("div", { class: "mute", style: "margin:8px 0 6px" }, matches.length === 1 ? "One match. Print the warrant!" : matches.length + " people match. Gather more clues, or gamble and pick one!"));
    matches.forEach(function (m) {
      var extra = CE.TRAIT_KEYS.filter(function (k) { return !nb[k] && m.traits[k]; }).map(function (k) { return m.traits[k].clueText; });
      out.push(el("button", { class: "sus" + (sel === m.id ? " sel" : ""), "data-sus": m.id, on: { click: function () { view.selected = m.id; render(); } } }, [
        mugshot(m, 56), el("div", null, [el("div", { style: "font-weight:800" }, m.displayName), el("div", { class: "tiny" }, extra.length ? "Also: " + extra.join(", ") : "")])
      ]));
    });
    var chosen = sel ? matches.filter(function (m) { return m.id === sel; })[0] : null;
    if (chosen) out.push(suspectCard(c, chosen));
    if (matches.length) {
      out.push(el("button", { class: "btn gold", style: "width:100%;margin-bottom:10px", disabled: !sel, on: { click: function () { var r = WE.printWarrant(state, ctx(), c.id, sel); save(); toast(r.ok ? (r.gamble ? "Warrant printed. A gamble!" : "Warrant printed.") : "Pick a suspect first."); render(); } } }, sel ? "Print warrant" : "Pick a suspect"));
    }
    if (c.warrant) {
      out.push(el("div", { class: "card" }, [
        el("h2", null, "Warrant ready: " + c.warrant.name),
        el("div", { class: "mute" }, "Pick an agent. They must be in the right city to make the arrest."),
        Object.keys(state.agents).map(function (id) { return state.agents[id]; }).filter(function (a) { return a.status !== "traveling"; }).map(function (a) {
          var d = AR.byId(a.id);
          return el("button", { class: "focusbtn", on: { click: function () { arrest(c.id, a.id); } } }, [el("b", null, d.badge + " " + d.name + " arrests in " + cityName(a.stationPlaceId)), el("div", { class: "mute" }, "Wrong city or wrong person costs trust.")]);
        })
      ]));
    } else if (matches.length) {
      out.push(el("div", { class: "mute" }, "No warrant yet. An arrest without a warrant spooks the suspect and costs trust."));
    }
    return out;
  }

  // ------------------------------------------------------------------ live loop
  function liveUpdate() {
    runTick(false);
    checkIncoming(false);
    var c = curCase();
    if (c) { var old = document.querySelector("[data-pace]"); if (old) old.replaceWith(paceChip(c)); }
    document.querySelectorAll("[data-eta]").forEach(function (n) {
      var a = state.agents[n.getAttribute("data-eta")];
      if (a && a.assignment) n.textContent = "On the way to " + cityName(a.assignment.toPlaceId) + " · " + mmss(a.assignment.arrivalTime - Date.now());
    });
    pushMap();
  }
  function boot() {
    initMap();
    state = CE.load(ctx());
    CE.syncRoster(state, ctx());
    checkIncoming(true);
    runTick(true); save(); render();
    setInterval(liveUpdate, 1000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) runTick(false); });
    window.addEventListener("storage", function (e) { if (e.key === MA.STORAGE_KEY) renderBar(); });
    window.__desk = { state: function () { return state; }, ctx: ctx, render: render, map: function () { return map; }, openFactbook: openFactbook, openDrawer: openDrawer };
  }
  load().then(boot).catch(function (e) {
    $("feed").innerHTML = "";
    $("feed").appendChild(el("div", { class: "empty" }, [
      el("h2", null, "Can't open the case files"),
      el("div", { class: "mute" }, "Open this page from the game's web link (not straight from a file) so the data can load. " + (e && e.message ? "(" + e.message + ")" : ""))
    ]));
  });
})();
