/*
 * Midnight Agency - Case engine (Wave 2, slice 1).
 *
 * One stolen good / incident = one complete case arc (own win screen, stars, XP, summary).
 * Everything runs on REAL timestamps (ctx.now, in ms) so a case keeps moving while the tablet
 * is off, but never silently kills a case: escalation is soft (the suspect moves one stop
 * further along the escape route and HQ sends a fresh clue), and a case that goes cold stays
 * open and solvable.
 *
 * Depends on (loaded earlier, plain <script src>): WorldFactbook, CrimeEngine,
 * SuspectGeneratorUtils, AgentRoster. Pure data in/out: no DOM. State is plain JSON.
 *
 * ctx = {
 *   now:       ms timestamp
 *   rng:       () => [0,1)
 *   rankLevel: 1..7  (MidnightAgencyConfig.rankLevel; rule tables bucket it to tiers 1..3)
 *   roster:    suspects.json merged with crime-rings.json ({ ...suspects, crimeRings })
 *   facts:     (place) => facts|null   (see factsFromCountry)
 *   timeScale: optional dev speed-up (travel is divided by it, crime clock multiplied by it)
 * }
 *
 * Case lifecycle
 *   status "active" -> "cold" (crime clock ran out; still solvable) -> "solved" (WarrantEngine)
 *   The case clock is HELD while any agent is waiting on scene for orders (case.holdSince).
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "midnight_agency_cases_v1";
  var STATE_VERSION = 1;
  var HOUR_MS = 60 * 60 * 1000;

  var RULES = {
    thwartHours: 12,                     // real-time hours of un-held clock before first escalation
    routeLengthByRank: { 1: 3, 2: 4, 3: 5 },
    cluePartsByRank: { 1: 1, 2: 1, 3: 2 },
    decoysByRank: { 1: 3, 2: 4, 3: 5 },
    lineupByRank: { 1: 5, 2: 6, 3: 8 },
    maxActiveCases: 3,
    // chance of each clue kind per focus (the first trail clue at a stop is never withheld twice)
    focusOdds: {
      transit: { trail: 1.0, suspect: 0.25 },
      locals: { trail: 0.5, suspect: 1.0 },
      records: { trail: 0.75, suspect: 0.75 }
    }
  };

  var TRAIT_KEYS = ["hairColor", "hairStyle", "build", "height", "complexion", "eyeColor", "facialHair"];
  var TRAIT_LABELS = {
    hairColor: "Hair colour", hairStyle: "Hair style", build: "Build", height: "Height",
    complexion: "Complexion", eyeColor: "Eyes", facialHair: "Facial hair"
  };

  var DEAD_END_LINES = [
    "found a very friendly pigeon, but no trail.",
    "asked around, and everyone just shrugged.",
    "checked every corner. Nothing here but a lost mitten.",
    "waited at the station, but the suspect never showed.",
    "followed a false lead that ended at an ice cream cart."
  ];

  // ------------------------------------------------------------------ utilities

  function rngOf(ctx) { return ctx && typeof ctx.rng === "function" ? ctx.rng : Math.random; }
  function pickOne(list, rng) { return list.length ? list[Math.floor(rng() * list.length)] : null; }
  function shuffle(list, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function placeById(id) { return global.WorldFactbook.findPlace(id); }
  // ctx.rankLevel is the full 1..7 ladder (MidnightAgencyConfig.rankLevel). Rule tables use the
  // 1..3 tier bucket (Recruit/Rookie=1, Junior Analyst/Operative=2, Specialist+=3); unlocks use the level.
  function rankLevelOf(ctx) { return Math.min(7, Math.max(1, Math.floor(Number(ctx && ctx.rankLevel) || 1))); }
  function rankKey(ctx) {
    if (ctx && ctx.rankTier) return Math.min(3, Math.max(1, Math.floor(Number(ctx.rankTier))));
    var l = rankLevelOf(ctx);
    return l <= 2 ? 1 : (l <= 4 ? 2 : 3);
  }
  function uid(prefix, rng) { return prefix + "-" + Date.now().toString(36) + "-" + Math.floor(rng() * 100000).toString(36); }

  // ------------------------------------------------------------------ place facts for clues

  // Boil a data/countries/<iso2>.json record down to what clues need.
  function factsFromCountry(c, place) {
    if (!c) return null;
    var geo = c.geography || {};
    var culture = c.culture || {};
    var cur = culture.currency || {};
    return {
      iso2: c.iso2 || (place && place.iso2) || null,
      currency: cur.name || null,
      currencyCode: cur.code || null,
      language: (culture.languages && culture.languages[0]) || null,
      languages: culture.languages || [],
      geography: geo.isIsland ? "island" : (geo.isLandlocked ? "landlocked" : "coastal"),
      region: c.region || (place && place.region) || null,
      flag: (culture.flag && culture.flag.svgPath) || null,   // image path; the description text names the country, so never shown as a clue
      flagSrc: (culture.flag && culture.flag.svgPath) || null,
      capital: (c.capital && c.capital.name) || null,
      climate: geo.climate || null
    };
  }

  function factsOf(ctx, place) {
    var f = ctx && typeof ctx.facts === "function" ? ctx.facts(place) : null;
    return f || { iso2: place.iso2, region: place.region, geography: null, currency: null, currencyCode: null, language: null, languages: [], flag: null, capital: null, climate: null };
  }

  // Readable facts for the "Fact" lookup on a candidate card.
  function factSummary(facts, place) {
    var rows = [];
    if (place) rows.push({ label: "Where", text: place.city + ", " + place.country });
    if (facts) {
      if (facts.currency) rows.push({ label: "Money", text: facts.currency });
      if (facts.languages && facts.languages.length) rows.push({ label: "Languages", text: facts.languages.slice(0, 3).join(", ") });
      if (facts.geography) rows.push({ label: "Coast", text: facts.geography === "island" ? "An island nation" : facts.geography === "landlocked" ? "No ocean coast" : "Has an ocean coast" });
      if (facts.region) rows.push({ label: "Continent", text: facts.region });
      if (facts.flagSrc) rows.push({ label: "Flag", text: "Official flag", flagSrc: facts.flagSrc });
    }
    return rows;
  }

  var CLUE_KINDS = {
    currency: {
      value: function (f) { return f.currencyCode; },
      text: function (f) { return "paid for a snack with " + f.currency; }
    },
    language: {
      value: function (f) { return f.language; },
      text: function (f) { return "chatted with the ticket clerk in " + f.language; }
    },
    geography: {
      value: function (f) { return f.geography; },
      text: function (f) {
        return f.geography === "island" ? "asked which ferry goes to the next island"
          : f.geography === "landlocked" ? "grumbled that the sea is very far away"
          : "asked a sailor about the sea breeze";
      }
    },
    region: {
      value: function (f) { return f.region; },
      text: function (f) { return "was overheard saying the next stop is somewhere in " + f.region; }
    },
    flag: {
      value: function (f) { return f.flag; },
      text: function () { return "dropped a ticket stub showing the flag in the picture"; }
    }
  };

  function clueValue(key, facts) {
    var kind = CLUE_KINDS[key];
    if (!kind || !facts) return null;
    var v = kind.value(facts);
    return v ? String(v) : null;
  }

  // A stop's clue parts must differ from every decoy in at least one part, so the clue can always
  // eliminate each wrong candidate with the Fact lookup.
  function buildStop(c, idx, ctx, extraPartCount) {
    var rng = rngOf(ctx);
    var rank = rankKey(ctx);
    var truth = placeById(c.route[idx]);
    var truthFacts = factsOf(ctx, truth);
    var keys = Object.keys(CLUE_KINDS).filter(function (k) { return clueValue(k, truthFacts); });
    var wantParts = Math.min(keys.length, extraPartCount || RULES.cluePartsByRank[rank]);

    var pool = global.WorldFactbook.PLACES.filter(function (p) {
      return p.iso2 !== truth.iso2 && c.route.indexOf(p.id) === -1;
    });
    if (rank >= 2) {
      var near = pool.filter(function (p) { return p.region === truth.region; });
      if (near.length >= RULES.decoysByRank[rank]) pool = near;
    }

    var best = null;
    for (var attempt = 0; attempt < 14; attempt += 1) {
      var chosen = shuffle(keys, rng).slice(0, wantParts);
      var eligible = pool.filter(function (p) {
        var pf = factsOf(ctx, p);
        return chosen.some(function (k) { return clueValue(k, pf) !== clueValue(k, truthFacts); });
      });
      if (!best || eligible.length > best.eligible.length) best = { chosen: chosen, eligible: eligible };
      if (eligible.length >= RULES.decoysByRank[rank] + 2) break;
    }
    var chosenKeys = best ? best.chosen : [];
    var eligibleDecoys = best ? best.eligible : pool;
    var decoys = shuffle(eligibleDecoys, rng).slice(0, RULES.decoysByRank[rank]);

    var parts = chosenKeys.map(function (k) {
      var part = { key: k, value: clueValue(k, truthFacts), text: CLUE_KINDS[k].text(truthFacts) };
      if (k === "flag") part.flagSrc = truthFacts.flagSrc;
      return part;
    });

    c.stops[idx] = {
      placeId: truth.id,
      parts: parts,
      candidateIds: shuffle([truth.id].concat(decoys.map(function (p) { return p.id; })), rng),
      revealed: false,        // true after a lucky break names the city outright
      delivered: false        // true once a trail clue for this stop has reached HQ
    };
    return c.stops[idx];
  }

  function clueSentence(stop) {
    return "Someone who met the suspect says they " + stop.parts.map(function (p) { return p.text; }).join(" and ") + ".";
  }

  // ------------------------------------------------------------------ suspects and traits

  function traitsOf(suspect) {
    var out = {};
    var a = (suspect && suspect.appearance) || {};
    TRAIT_KEYS.forEach(function (k) {
      var t = a[k];
      if (t && (t.category || t.clueText)) out[k] = { category: t.category || String(t.clueText), clueText: t.clueText || String(t.category) };
    });
    return out;
  }

  function lightSuspect(s) {
    return {
      id: s.id,
      displayName: s.displayName || ((s.firstName || "") + " " + (s.lastName || "")).trim(),
      nickname: s.nickname || s.nickName || null,
      tier: s.tier || 1,
      rankTitle: s.rankTitle || null,
      ringId: s.ringId || null,
      traits: traitsOf(s)
    };
  }

  function traitDiffCount(a, b) {
    return TRAIT_KEYS.filter(function (k) {
      return a.traits[k] && b.traits[k] && a.traits[k].category !== b.traits[k].category;
    }).length;
  }

  function buildLineup(c, truth, ctx) {
    var rng = rngOf(ctx);
    var rank = rankKey(ctx);
    var rings = Object.keys((ctx.roster && ctx.roster.crimeRings) || {});
    var lineup = [truth];
    var tries = 0;
    while (lineup.length < RULES.lineupByRank[rank] && tries < 80) {
      tries += 1;
      var fake = lightSuspect(global.SuspectGeneratorUtils.createFreshSuspect(ctx.roster, {
        rng: rng,
        ringId: pickOne(rings, rng) || undefined,
        tier: truth.tier
      }));
      var unique = lineup.every(function (s) { return s.id !== fake.id && s.displayName !== fake.displayName; });
      if (unique && traitDiffCount(truth, fake) >= 2) lineup.push(fake);
    }
    return shuffle(lineup, rng);
  }

  // Reveal one more trait of the real suspect. When `decisive`, pick the trait that leaves the
  // fewest lineup candidates standing.
  function uncoverTrait(c, ctx, decisive) {
    var rng = rngOf(ctx);
    var open = TRAIT_KEYS.filter(function (k) { return c.suspect.traits[k] && !c.uncovered[k]; });
    if (!open.length) return null;
    var key;
    if (decisive) {
      var scored = open.map(function (k) {
        var cat = c.suspect.traits[k].category;
        var remaining = c.lineup.filter(function (s) { return s.traits[k] && s.traits[k].category === cat; }).length;
        return { k: k, remaining: remaining, jitter: rng() };
      }).sort(function (a, b) { return a.remaining - b.remaining || a.jitter - b.jitter; });
      key = scored[0].k;
    } else {
      key = pickOne(open, rng);
    }
    c.uncovered[key] = c.suspect.traits[key];
    return key;
  }

  // ------------------------------------------------------------------ state

  function newState(ctx) {
    var rng = rngOf(ctx);
    return {
      version: STATE_VERSION,
      caseCounter: 0,
      cases: [],
      agents: global.AgentRoster.dealStarterCrew(global.WorldFactbook.PLACES, rng, 3),
      rings: {},
      stats: { solved: 0, falseArrests: 0 },
      passport: [],
      pings: []
    };
  }

  function load(ctx) {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.version === STATE_VERSION && parsed.agents && Array.isArray(parsed.cases)) return parsed;
      }
    } catch (e) {}
    return newState(ctx);
  }

  function save(state) {
    try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    return state;
  }

  function reset() {
    try { global.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  // Cities the player has reason to care about on the map: the scene plus every stop reached so far.
  function currentRouteIds(c) {
    return c.route.filter(function (id, i) { return i === 0 || i <= c.progress || c.visited[id]; });
  }

  function activeCases(state) {
    return state.cases.filter(function (c) { return c.status !== "solved"; });
  }

  function getCase(state, id) {
    for (var i = 0; i < state.cases.length; i += 1) if (state.cases[i].id === id) return state.cases[i];
    return null;
  }

  // Unlock roster agents that rank / solved count now allow. Returns the defs unlocked.
  function syncRoster(state, ctx) {
    var ids = Object.keys(state.agents);
    var fresh = global.AgentRoster.newlyUnlockable(ids, rankLevelOf(ctx), state.stats.solved);
    fresh.forEach(function (def) {
      state.agents[def.id] = global.AgentRoster.unlockAgent(def, global.WorldFactbook.PLACES, rngOf(ctx));
    });
    return fresh;
  }

  // ------------------------------------------------------------------ case creation

  function buildRoute(first, length, rng) {
    var route = [first.id];
    var prev = first;
    while (route.length < length) {
      var wantNewRegion = rng() < 0.6;
      var next = global.WorldFactbook.pickPlace({ excludeIds: route }, rng);
      var tries = 0;
      while (tries < 20 && (route.indexOf(next.id) !== -1 || (wantNewRegion ? next.region === prev.region : next.region !== prev.region))) {
        next = global.WorldFactbook.pickPlace({ excludeIds: route }, rng);
        tries += 1;
      }
      route.push(next.id);
      prev = next;
    }
    return route;
  }

  function addBoard(c, ctx, entry) {
    var e = Object.assign({ id: uid("b", rngOf(ctx)), at: ctx.now }, entry);
    c.board.push(e);
    return e;
  }

  // opts: { ringId, tier, isLeaderCase, intelFragments, suspect (light), rankLevel override }
  function createCase(state, ctx, opts) {
    var o = opts || {};
    var rng = rngOf(ctx);
    var rings = Object.keys((ctx.roster && ctx.roster.crimeRings) || {});
    var ringId = o.ringId || pickOne(rings, rng);
    var tier = o.isLeaderCase ? 4 : (o.tier || 1);

    var fullSuspect = global.SuspectGeneratorUtils.createFreshSuspect(ctx.roster, { rng: rng, ringId: ringId, tier: tier });
    var crime = global.CrimeEngine.createCrime({
      suspect: fullSuspect,
      crimeRings: ctx.roster.crimeRings,
      rng: rng,
      forceNonSyndicate: false,
      mode: "thwart",
      hours: RULES.thwartHours,
      caseNumber: state.caseCounter + 1
    });

    var scene = placeById(crime.target.placeId || crime.target.city) || global.WorldFactbook.pickPlace({}, rng);
    var rank = rankKey(ctx);
    var route = buildRoute(scene, RULES.routeLengthByRank[rank] + (o.isLeaderCase ? 1 : 0), rng);

    state.caseCounter += 1;
    var suspect = lightSuspect(fullSuspect);
    var c = {
      id: uid("case", rng),
      number: state.caseCounter,
      status: "active",
      createdAt: ctx.now,
      lastTickAt: ctx.now,
      holdSince: null,
      pings: [],
      isLeaderCase: !!o.isLeaderCase,
      ringId: ringId,
      rankAtStart: rank,
      title: crime.typeLabel + " at " + crime.target.name,
      crime: crime,
      suspect: suspect,
      route: route,
      stops: {},
      progress: -1,            // highest route index an agent has checked in at
      lead: null,              // route index of the current trail clue (next destination), or null
      stuck: {},               // stop index -> true when its first orders produced no trail clue
      visited: {},             // placeId -> true for route stops an agent reached
      contributors: {},        // agentId -> true for agents who gave useful on-scene reports
      ruledOut: {},            // placeId -> true (Guess Who? elimination)
      uncovered: {},
      lineup: [],
      board: [],
      wrongTrips: 0,
      falseArrests: 0,
      extensions: 0,
      warrant: null,
      summary: null
    };

    for (var i = 1; i < route.length; i += 1) buildStop(c, i, ctx);
    c.lineup = buildLineup(c, suspect, ctx);

    var intel = Math.min(3, Number(o.intelFragments) || 0);
    for (var n = 0; n < intel; n += 1) uncoverTrait(c, ctx, false);

    addBoard(c, ctx, {
      type: "brief",
      text: (o.isLeaderCase ? "BIG CASE: the ring leader has been exposed! " : "") +
        "A " + crime.typeLabel.toLowerCase() + " at " + crime.target.name + " in " + scene.city + ". The crooks " + crime.summaryAction + "."
    });
    (crime.observableClues || []).forEach(function (cl) {
      if (cl.tag !== "escalated" && cl.tag !== "cold") addBoard(c, ctx, { type: "scene", text: cl.text });
    });
    Object.keys(c.uncovered).forEach(function (k) {
      addBoard(c, ctx, { type: "suspect", text: "Ring intel: the suspect has " + c.uncovered[k].clueText + ".", traitKey: k });
    });

    state.cases.push(c);
    addPing(state, { kind: "case", placeId: c.route[0], caseId: c.id, at: ctx.now });
    return c;
  }

  // ------------------------------------------------------------------ travel and the clock

  function suspectPlaceId(c) { return c.route[c.route.length - 1]; }
  function finalIdx(c) { return c.route.length - 1; }

  function dispatchAgent(state, ctx, req) {
    var c = getCase(state, req.caseId);
    var a = state.agents[req.agentId];
    if (!c || c.status === "solved") return { ok: false, reason: "no-case" };
    if (!a) return { ok: false, reason: "no-agent" };
    if (a.status === "traveling") return { ok: false, reason: "already-traveling" };
    var to = placeById(req.toPlaceId);
    if (!to) return { ok: false, reason: "no-place" };

    // leaving without orders drops this agent's check-in hold
    releasePing(c, a.id, ctx);
    if (a.assignment && a.assignment.caseId) {
      var prevCase = getCase(state, a.assignment.caseId);
      if (prevCase && prevCase.id !== c.id) releasePing(prevCase, a.id, ctx);
    }

    var from = placeById(a.stationPlaceId);
    // multi-leg trip: dev speed (?speed=N) divides travel time; ctx.timeMode 'real' uses true travel times
    var speed = Math.max(1, Number(ctx.travelScale || ctx.timeScale) || 1);
    var trip = global.AgentRoster.planTrip(from, to, ctx.timeMode);
    var t = ctx.now, legs = [];
    trip.legs.forEach(function (l) {
      var dur = Math.max(500, Math.round(l.minutes * 60000 / speed));
      legs.push({ fromPlaceId: l.fromId, toPlaceId: l.toId, kind: l.kind, modeId: l.modeId, departureTime: t, arrivalTime: t + dur });
      t += dur;
    });
    var ms = Math.max(1000, t - ctx.now);
    if (!legs.length) { ms = Math.max(1000, Math.round(global.AgentRoster.travelMs(from, to) / speed)); }
    a.status = "traveling";
    a.assignment = {
      caseId: c.id,
      fromPlaceId: from.id,
      toPlaceId: to.id,
      departureTime: ctx.now,
      arrivalTime: ctx.now + ms,
      arrived: false,
      legs: legs,
      timeMode: trip.mode
    };
    return { ok: true, arrivalTime: a.assignment.arrivalTime, minutes: Math.round(ms / 60000), legs: legs, timeMode: trip.mode };
  }

  function releasePing(c, agentId, ctx) {
    var i = c.pings.indexOf(agentId);
    if (i !== -1) c.pings.splice(i, 1);
    if (!c.pings.length && c.holdSince != null) {
      c.holdSince = null;
      c.lastTickAt = ctx.now;   // the clock resumes from the moment orders were given
    }
  }

  function nextArrival(state, c, now) {
    var best = null;
    Object.keys(state.agents).forEach(function (id) {
      var a = state.agents[id];
      var asg = a.assignment;
      if (a.status === "traveling" && asg && asg.caseId === c.id && !asg.arrived && asg.arrivalTime <= now) {
        if (!best || asg.arrivalTime < best.assignment.arrivalTime) best = a;
      }
    });
    return best;
  }

  // Soft escalation: the suspect slips one stop further along the escape route; HQ gets a fresh,
  // helpful clue instead of the case dying.
  function softEscalate(c, ctx, events) {
    var rng = rngOf(ctx);
    var last = placeById(suspectPlaceId(c));
    var next = global.WorldFactbook.pickPlace({ excludeIds: c.route, region: rng() < 0.5 ? last.region : undefined }, rng);
    c.route.push(next.id);
    c.extensions += 1;
    buildStop(c, c.route.length - 1, ctx);

    var text = "Too late to stop it. The suspect slipped away and the trail now runs one stop further.";
    addBoard(c, ctx, { type: "hq", text: text });

    // fresh clue: more detail on the current lead if there is one, else a suspect detail
    var lead = c.lead != null ? c.stops[c.lead] : null;
    var fresh = null;
    if (lead && !lead.revealed) {
      var truth = placeById(lead.placeId);
      var facts = factsOf(ctx, truth);
      var have = lead.parts.map(function (p) { return p.key; });
      var more = Object.keys(CLUE_KINDS).filter(function (k) { return have.indexOf(k) === -1 && clueValue(k, facts); });
      var k2 = pickOne(more, rng);
      if (k2) {
        var np = { key: k2, value: clueValue(k2, facts), text: CLUE_KINDS[k2].text(facts) };
        if (k2 === "flag") np.flagSrc = facts.flagSrc;
        lead.parts.push(np);
        fresh = addBoard(c, ctx, { type: "trail", stopIdx: c.lead, text: "HQ intercept: someone who met the suspect also " + CLUE_KINDS[k2].text(facts) + "." });
      }
    }
    if (!fresh) {
      var key = uncoverTrait(c, ctx, false);
      if (key) fresh = addBoard(c, ctx, { type: "suspect", traitKey: key, text: "HQ intercept: the suspect has " + c.uncovered[key].clueText + "." });
    }
    events.push({ type: "escalated", caseId: c.id, text: "HQ intercept on \"" + c.title + "\": the suspect moved on, but a fresh clue came in." });
  }

  function advanceClock(c, toTs, ctx, events) {
    var dt = Math.max(0, toTs - c.lastTickAt) * Math.max(1, Number(ctx.timeScale) || 1);
    c.lastTickAt = Math.max(c.lastTickAt, toTs);
    if (dt <= 0 || c.status === "solved") return;
    var crime = c.crime;
    if (crime.status !== "open" && crime.status !== "escalated") return;
    var before = crime.status;
    global.CrimeEngine.advanceCrime(crime, dt, rngOf(ctx));
    if (before === "open" && (crime.status === "escalated" || crime.status === "cold")) softEscalate(c, ctx, events);
    if (crime.status === "cold" && c.status === "active") {
      c.status = "cold";
      addBoard(c, ctx, { type: "hq", text: "The trail has gone quiet, but the suspect is still out there. Keep going, no rush!" });
      events.push({ type: "cold", caseId: c.id, text: "\"" + c.title + "\" has gone quiet, but it is still open." });
    }
  }

  function processArrival(state, c, a, ctx, events) {
    var asg = a.assignment;
    var def = global.AgentRoster.byId(a.id);
    var place = placeById(asg.toPlaceId);
    var idx = c.route.indexOf(place.id);
    asg.arrived = true;
    a.stationPlaceId = place.id;

    if (idx === -1) {
      var rng = rngOf(ctx);
      a.status = "idle";
      a.assignment = null;
      c.wrongTrips += 1;
      addBoard(c, ctx, { type: "deadend", agentId: a.id, text: def.name + " reached " + place.city + " and " + pickOne(DEAD_END_LINES, rng) });
      events.push({ type: "deadend", caseId: c.id, agentId: a.id, text: def.name + " found nothing in " + place.city + "." });
      return;
    }

    a.status = "onScene";
    c.visited[place.id] = true;
    if (c.holdSince == null) c.holdSince = asg.arrivalTime;
    if (c.pings.indexOf(a.id) === -1) c.pings.push(a.id);
    addPing(state, { kind: "arrived", placeId: place.id, caseId: c.id, agentId: a.id, at: asg.arrivalTime });
    events.push({
      type: "arrived", caseId: c.id, agentId: a.id, placeId: place.id,
      text: def.name + " has arrived in " + place.city + " and is waiting for orders. The case clock is on hold."
    });
  }

  // ------------------------------------------------------------------ live map data

  // Where every agent is right now: stationed at a city, or somewhere along the current leg.
  function agentPositions(state, now) {
    var WF = global.WorldFactbook, AR = global.AgentRoster;
    return Object.keys(state.agents).map(function (id) {
      var a = state.agents[id];
      var def = AR.byId(id) || {};
      var base = { id: id, name: def.name || id, badge: def.badge || "", status: a.status };
      var home = WF.findPlace(a.stationPlaceId);
      var asg = a.assignment;
      if (a.status === "traveling" && asg && asg.legs && asg.legs.length) {
        for (var i = 0; i < asg.legs.length; i += 1) {
          var l = asg.legs[i];
          if (now <= l.arrivalTime || i === asg.legs.length - 1) {
            var fp = WF.findPlace(l.fromPlaceId), tp = WF.findPlace(l.toPlaceId);
            var span = Math.max(1, l.arrivalTime - l.departureTime);
            var f = Math.max(0, Math.min(1, (now - l.departureTime) / span));
            var pos = AR.interpolate(fp, tp, f), ahead = AR.interpolate(fp, tp, Math.min(1, f + 0.02));
            base.lat = pos.lat; base.lon = pos.lon; base.fromPlaceId = fp.id; base.toPlaceId = tp.id; base.kind = l.kind;
            base.heading = { lat: ahead.lat, lon: ahead.lon };
            base.legIndex = i; base.legCount = asg.legs.length;
            base.etaAt = asg.arrivalTime; base.etaMs = Math.max(0, asg.arrivalTime - now);
            base.finalPlaceId = asg.toPlaceId; base.caseId = asg.caseId;
            return base;
          }
        }
      }
      base.lat = home ? home.lat : 0; base.lon = home ? home.lon : 0; base.placeId = home && home.id;
      if (asg && asg.caseId) base.caseId = asg.caseId;
      return base;
    });
  }

  // Short-lived events for the map (pulsing pings). Kept in state so a reload still shows recent ones.
  function addPing(state, ping) {
    state.pings = state.pings || [];
    state.pings.push(Object.assign({ id: "p" + Date.now().toString(36) + state.pings.length, at: Date.now() }, ping));
    if (state.pings.length > 30) state.pings.splice(0, state.pings.length - 30);
  }

  // Bring everything up to ctx.now, in time order. Returns events for toasts / HQ voice.
  function tick(state, ctx) {
    var events = [];
    state.cases.forEach(function (c) {
      if (c.status === "solved") return;
      for (var guard = 0; guard < 60; guard += 1) {
        var arriving = nextArrival(state, c, ctx.now);
        if (c.holdSince != null) {
          if (!arriving) break;
          processArrival(state, c, arriving, ctx, events);
          continue;
        }
        advanceClock(c, arriving ? arriving.assignment.arrivalTime : ctx.now, ctx, events);
        if (!arriving) break;
        processArrival(state, c, arriving, ctx, events);
      }
    });

    // agents still heading to a case that has since been solved just finish their trip
    Object.keys(state.agents).forEach(function (id) {
      var a = state.agents[id];
      if (a.status !== "traveling" || !a.assignment) return;
      var c = getCase(state, a.assignment.caseId);
      if ((!c || c.status === "solved") && a.assignment.arrivalTime <= ctx.now) {
        a.stationPlaceId = a.assignment.toPlaceId;
        a.status = "idle";
        a.assignment = null;
      }
    });
    return events;
  }

  // ------------------------------------------------------------------ on-scene orders and clues

  function giveOrders(state, ctx, req) {
    var c = getCase(state, req.caseId);
    var a = state.agents[req.agentId];
    var focus = global.AgentRoster.FOCUS[req.focus];
    if (!c || !a || !focus) return { ok: false, reason: "bad-request" };
    if (a.status !== "onScene" || !a.assignment || a.assignment.caseId !== c.id) return { ok: false, reason: "not-on-scene" };

    var rng = rngOf(ctx);
    var def = global.AgentRoster.byId(a.id);
    var place = placeById(a.stationPlaceId);
    var idx = c.route.indexOf(place.id);
    var isFinal = idx === finalIdx(c);
    var odds = RULES.focusOdds[focus.id];
    var entries = [];
    var lucky = false;

    c.progress = Math.max(c.progress, idx);
    c.contributors[a.id] = true;

    var wantTrail = !isFinal && (rng() < odds.trail || c.stuck[idx]);
    var wantSuspect = rng() < (isFinal ? Math.max(odds.suspect, 0.75) : odds.suspect);
    if (focus.id === "records" && !isFinal && !wantTrail && !wantSuspect) wantTrail = true; // never an empty report

    var luckyChance = global.AgentRoster.luckyBreakChance(a, def, focus.id);
    if (rng() < luckyChance) {
      lucky = true;
      if (!isFinal && rng() < 0.5) {
        var nextStop = c.stops[idx + 1];
        nextStop.revealed = true;
        nextStop.delivered = true;
        nextStop.candidateIds = [nextStop.placeId];
        c.lead = idx + 1;
        wantTrail = false;
        entries.push(addBoard(c, ctx, {
          type: "lucky", special: true, agentId: a.id, stopIdx: idx + 1,
          text: "LUCKY BREAK! " + def.name + " found a ticket stub that says: next stop " + placeById(nextStop.placeId).city + "!"
        }));
      } else {
        var lkey = uncoverTrait(c, ctx, true);
        if (lkey) {
          wantSuspect = false;
          entries.push(addBoard(c, ctx, {
            type: "lucky", special: true, agentId: a.id, traitKey: lkey,
            text: "LUCKY BREAK! " + def.name + " spotted the one detail that matters: the suspect has " + c.uncovered[lkey].clueText + "!"
          }));
        } else {
          lucky = false;
        }
      }
    }

    if (wantTrail) {
      var stop = c.stops[idx + 1];
      stop.delivered = true;
      c.lead = idx + 1;
      c.stuck[idx] = false;
      entries.push(addBoard(c, ctx, { type: "trail", agentId: a.id, stopIdx: idx + 1, text: def.name + " reports from " + place.city + ": " + clueSentence(stop) }));
    } else if (!isFinal && !c.stuck[idx] && !(c.lead != null && c.lead > idx)) {
      c.stuck[idx] = true; // no trail clue yet: the next orders here are guaranteed to get one
    }

    if (wantSuspect) {
      var key = uncoverTrait(c, ctx, false);
      if (key) {
        entries.push(addBoard(c, ctx, { type: "suspect", agentId: a.id, traitKey: key, text: def.name + " asked around in " + place.city + ": the suspect has " + c.uncovered[key].clueText + "." }));
      }
    }

    if (isFinal) {
      c.suspectLocated = true;
      entries.push(addBoard(c, ctx, { type: "located", agentId: a.id, text: def.name + " has a strong feeling the suspect is hiding right here in " + place.city + "!" }));
    } else if (!entries.length) {
      entries.push(addBoard(c, ctx, { type: "hq", agentId: a.id, text: def.name + " looked around " + place.city + " but nothing new yet. Try asking again." }));
    }

    a.assignment.arrived = true;
    a.status = "idle";       // free to move; still stationed at this city
    a.assignment = null;
    releasePing(c, a.id, ctx);

    return { ok: true, entries: entries, lucky: lucky, located: isFinal };
  }

  // Guess Who? elimination, per case.
  function toggleRuledOut(c, placeId) {
    if (c.ruledOut[placeId]) delete c.ruledOut[placeId]; else c.ruledOut[placeId] = true;
    return !!c.ruledOut[placeId];
  }

  // Candidate cities for the case's current lead (or null when the next step is just the scene).
  function currentCandidates(c) {
    if (c.lead == null || c.lead <= c.progress) return null;
    var stop = c.stops[c.lead];
    return stop ? { stopIdx: c.lead, candidateIds: stop.candidateIds, parts: stop.parts, revealed: stop.revealed } : null;
  }

  global.CaseEngine = {
    STORAGE_KEY: STORAGE_KEY,
    RULES: RULES,
    TRAIT_KEYS: TRAIT_KEYS,
    TRAIT_LABELS: TRAIT_LABELS,
    HOUR_MS: HOUR_MS,
    factsFromCountry: factsFromCountry,
    factSummary: factSummary,
    newState: newState,
    load: load,
    save: save,
    reset: reset,
    getCase: getCase,
    activeCases: activeCases,
    currentRouteIds: currentRouteIds,
    syncRoster: syncRoster,
    createCase: createCase,
    dispatchAgent: dispatchAgent,
    giveOrders: giveOrders,
    tick: tick,
    agentPositions: agentPositions,
    addPing: addPing,
    toggleRuledOut: toggleRuledOut,
    currentCandidates: currentCandidates,
    uncoverTrait: uncoverTrait,
    softEscalate: softEscalate,
    addBoard: addBoard,
    releasePing: releasePing,
    suspectPlaceId: suspectPlaceId,
    finalIdx: finalIdx,
    lightSuspect: lightSuspect
  };
})(typeof window !== "undefined" ? window : globalThis);
