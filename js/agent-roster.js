/*
 * Midnight Agency - Agent roster (Wave 2).
 *
 * Eight handcrafted field agents, two per continent that exists in WorldFactbook.PLACES
 * (Americas, Europe, Africa, Asia). Each new run deals a random 3-agent starter crew on three
 * DIFFERENT continents; the rest unlock with HQ rank or solved cases.
 *
 * Pure data + helpers: no DOM, no storage. State shape (one entry per unlocked agent):
 *   { id, stationPlaceId, level, xp, rapport, status, assignment }
 *   status: "idle" | "traveling" | "onScene"
 *   assignment (while traveling / onScene): { caseId, fromPlaceId, toPlaceId, departureTime, arrivalTime, arrived }
 *
 * Plain <script src>; exposes window.AgentRoster.
 */
(function (global) {
  "use strict";

  var MIN_MS = 60 * 1000;

  // focus ids match the on-scene direction choices in CaseEngine
  var FOCUS = {
    transit: { id: "transit", label: "Transit & Ports", hint: "Tickets, stations, harbours: where did they go next?" },
    locals: { id: "locals", label: "Locals & Shops", hint: "Ask around: what did the suspect look like?" },
    records: { id: "records", label: "Scene & Records", hint: "Check logs and the scene for both kinds of clue." }
  };

  var AGENTS = [
    { id: "mika", name: "Mika Tanaka", badge: "🦊", homeRegion: "Asia", specialty: "transit", unlock: { start: true },
      quirk: "Keeps every train ticket she has ever bought in a tin.", voice: { pitch: 1.25, rate: 1.05 } },
    { id: "priya", name: "Priya Nair", badge: "🦉", homeRegion: "Asia", specialty: "records", unlock: { rank: 2 },
      quirk: "Reads the small print on everything, even cereal boxes.", voice: { pitch: 1.1, rate: 0.95 } },
    { id: "amara", name: "Amara Diallo", badge: "🦁", homeRegion: "Africa", specialty: "locals", unlock: { start: true },
      quirk: "Can make friends with a market stall in under a minute.", voice: { pitch: 1.0, rate: 1.0 } },
    { id: "kofi", name: "Kofi Mensah", badge: "🐢", homeRegion: "Africa", specialty: "transit", unlock: { rank: 3 },
      quirk: "Always knows which bus is running late.", voice: { pitch: 0.85, rate: 0.95 } },
    { id: "luca", name: "Luca Ferrari", badge: "🐺", homeRegion: "Europe", specialty: "records", unlock: { start: true },
      quirk: "Sketches every suspect in the margin of his notebook.", voice: { pitch: 0.9, rate: 1.0 } },
    { id: "elsa", name: "Elsa Lindqvist", badge: "❄️", homeRegion: "Europe", specialty: "locals", unlock: { rank: 4 },
      quirk: "Never takes off her bright red scarf.", voice: { pitch: 1.15, rate: 0.9 } },
    { id: "sofia", name: "Sofia Reyes", badge: "🦋", homeRegion: "Americas", specialty: "locals", unlock: { start: true },
      quirk: "Hums a different song in every city.", voice: { pitch: 1.2, rate: 1.1 } },
    { id: "diego", name: "Diego Castillo", badge: "🦅", homeRegion: "Americas", specialty: "transit", unlock: { solved: 8 },
      quirk: "Packs one tiny umbrella for every kind of weather.", voice: { pitch: 0.8, rate: 1.0 } }
  ];

  var XP_FOR_LEVEL = [0, 0, 6, 15]; // index = level; level 2 at 6 xp, level 3 at 15 xp
  var MAX_LEVEL = 3;
  var RAPPORT_MIN = 1;
  var RAPPORT_MAX = 5;

  function byId(id) {
    for (var i = 0; i < AGENTS.length; i += 1) if (AGENTS[i].id === id) return AGENTS[i];
    return null;
  }

  function shuffle(list, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function newAgentState(def, stationPlaceId) {
    return { id: def.id, stationPlaceId: stationPlaceId, level: 1, xp: 0, rapport: 3, status: "idle", assignment: null };
  }

  // Deal a random starter crew: `count` agents from DIFFERENT continents, each stationed in a
  // random city of their home continent. places = WorldFactbook.PLACES.
  function dealStarterCrew(places, rng, count) {
    var random = typeof rng === "function" ? rng : Math.random;
    var want = count || 3;
    var regionsWithCities = {};
    places.forEach(function (p) { (regionsWithCities[p.region] = regionsWithCities[p.region] || []).push(p); });

    var starters = AGENTS.filter(function (a) { return a.unlock.start && regionsWithCities[a.homeRegion]; });
    var crew = {};
    var usedRegions = {};
    shuffle(starters, random).forEach(function (def) {
      if (Object.keys(crew).length >= want || usedRegions[def.homeRegion]) return;
      var cities = regionsWithCities[def.homeRegion];
      var station = cities[Math.floor(random() * cities.length)];
      crew[def.id] = newAgentState(def, station.id);
      usedRegions[def.homeRegion] = true;
    });
    return crew;
  }

  // Which still-locked agents should unlock now? Returns agent defs (caller stations them).
  function newlyUnlockable(unlockedIds, rankLevel, solvedCount) {
    return AGENTS.filter(function (a) {
      if (unlockedIds.indexOf(a.id) !== -1 || a.unlock.start) return false;
      if (a.unlock.rank && rankLevel >= a.unlock.rank) return true;
      if (a.unlock.solved && solvedCount >= a.unlock.solved) return true;
      return false;
    });
  }

  function unlockAgent(def, places, rng) {
    var random = typeof rng === "function" ? rng : Math.random;
    var local = places.filter(function (p) { return p.region === def.homeRegion; });
    var pool = local.length ? local : places;
    return newAgentState(def, pool[Math.floor(random() * pool.length)].id);
  }

  // How long a trip takes, in real minutes.
  //   same landmass         15-45 min    (quick hop)
  //   same continent        60-120 min   (different landmass, e.g. Toronto -> Santiago)
  //   different continents  120-360 min  (2-6 hours)
  function travelMinutes(fromPlace, toPlace) {
    if (!fromPlace || !toPlace || fromPlace.id === toPlace.id) return 2; // a quick look around
    var dx = toPlace.map.x - fromPlace.map.x;
    var dy = toPlace.map.y - fromPlace.map.y;
    var frac = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 80);
    var lo; var hi;
    if (fromPlace.landmass && fromPlace.landmass === toPlace.landmass) { lo = 15; hi = 45; }
    else if (fromPlace.region === toPlace.region) { lo = 60; hi = 120; }
    else { lo = 120; hi = 360; }
    return Math.round(lo + (hi - lo) * frac);
  }

  function travelMs(fromPlace, toPlace) {
    return travelMinutes(fromPlace, toPlace) * MIN_MS;
  }

  // ---- geography + multi-leg trips (Wave 3) ----
  var D2R = Math.PI / 180;
  function distanceKm(a, b) {
    var dLat = (b.lat - a.lat) * D2R, dLon = (b.lon - a.lon) * D2R;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Great-circle point at fraction t (0..1) between two {lat,lon}.
  function interpolate(a, b, t) {
    var f1 = a.lat * D2R, l1 = a.lon * D2R, f2 = b.lat * D2R, l2 = b.lon * D2R;
    var d = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((f2 - f1) / 2), 2) + Math.cos(f1) * Math.cos(f2) * Math.pow(Math.sin((l2 - l1) / 2), 2)));
    if (d < 1e-6) return { lat: a.lat, lon: a.lon };
    var A = Math.sin((1 - t) * d) / Math.sin(d), B = Math.sin(t * d) / Math.sin(d);
    var x = A * Math.cos(f1) * Math.cos(l1) + B * Math.cos(f2) * Math.cos(l2);
    var y = A * Math.cos(f1) * Math.sin(l1) + B * Math.cos(f2) * Math.sin(l2);
    var z = A * Math.sin(f1) + B * Math.sin(f2);
    return { lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / D2R, lon: Math.atan2(y, x) / D2R };
  }

  // Real-world minutes for one leg. Flights: 800 km/h + 90 min airport/connection; rail 160; road 70; +15 boarding.
  function realLegMinutes(a, b, kind) {
    var km = distanceKm(a, b);
    if (kind === "flight") return Math.round(km / 800 * 60 + 90);
    if (kind === "rail") return Math.round(km * 1.15 / 160 * 60 + 15);
    return Math.round(km * 1.25 / 70 * 60 + 15);
  }

  // A trip is a list of legs [{fromId,toId,kind,minutes}]. Mission time keeps the tuned tier minutes
  // (travelMinutes) and splits them across legs in proportion to the real leg times; real time uses the real numbers.
  function planTrip(fromPlace, toPlace, timeMode) {
    var WF = global.WorldFactbook;
    var legs = [];
    if (!fromPlace || !toPlace || fromPlace.id === toPlace.id) {
      return { legs: [], totalMinutes: travelMinutes(fromPlace, toPlace), mode: timeMode === "real" ? "real" : "mission" };
    }
    var route = WF && WF.planRoute ? WF.planRoute(fromPlace.id, toPlace.id, { rank: 7 }) : null;
    var best = route && route.routes && route.routes.length ? route.routes[0] : null;
    if (best && best.legs.length) {
      legs = best.legs.map(function (l) {
        var kind = l.modeId === "flight" || l.modeId === "charter" ? "flight" : (l.modeId === "rail" ? "rail" : "ground");
        return { fromId: l.fromId, toId: l.toId, kind: kind, modeId: l.modeId };
      });
    } else {
      legs = [{ fromId: fromPlace.id, toId: toPlace.id, kind: fromPlace.landmass === toPlace.landmass ? "ground" : "flight" }];
    }
    var realMin = legs.map(function (l) {
      return realLegMinutes(WF.findPlace(l.fromId), WF.findPlace(l.toId), l.kind);
    });
    var realTotal = realMin.reduce(function (x, y) { return x + y; }, 0) || 1;
    var real = timeMode === "real";
    var total = real ? realTotal : travelMinutes(fromPlace, toPlace);
    legs.forEach(function (l, i) { l.minutes = Math.max(1, Math.round(total * realMin[i] / realTotal)); });
    return { legs: legs, totalMinutes: legs.reduce(function (x, l) { return x + l.minutes; }, 0), mode: real ? "real" : "mission", realMinutes: realTotal };
  }

  // Returns true when the agent leveled up.
  function addXp(agentState, amount) {
    agentState.xp = Math.max(0, (agentState.xp || 0) + (Number(amount) || 0));
    var before = agentState.level || 1;
    var level = 1;
    for (var l = 2; l <= MAX_LEVEL; l += 1) if (agentState.xp >= XP_FOR_LEVEL[l]) level = l;
    agentState.level = Math.max(before, level);
    return agentState.level > before;
  }

  function adjustRapport(agentState, delta) {
    var before = agentState.rapport || 3;
    agentState.rapport = Math.max(RAPPORT_MIN, Math.min(RAPPORT_MAX, before + (Number(delta) || 0)));
    return agentState.rapport - before;
  }

  // 10-20% chance that an agent finds a COMPLETE clue on their own.
  // Nudged by level, a matching specialty and good rapport; never above 20%.
  function luckyBreakChance(agentState, def, focusId) {
    var chance = 0.10;
    chance += 0.025 * ((agentState.level || 1) - 1);
    if (def && def.specialty === focusId) chance += 0.04;
    if ((agentState.rapport || 3) >= 4) chance += 0.02;
    return Math.min(0.20, chance);
  }

  global.AgentRoster = {
    AGENTS: AGENTS,
    FOCUS: FOCUS,
    XP_FOR_LEVEL: XP_FOR_LEVEL,
    byId: byId,
    dealStarterCrew: dealStarterCrew,
    newlyUnlockable: newlyUnlockable,
    unlockAgent: unlockAgent,
    travelMinutes: travelMinutes,
    travelMs: travelMs,
    planTrip: planTrip,
    distanceKm: distanceKm,
    interpolate: interpolate,
    realLegMinutes: realLegMinutes,
    addXp: addXp,
    adjustRapport: adjustRapport,
    luckyBreakChance: luckyBreakChance
  };
})(typeof window !== "undefined" ? window : globalThis);
