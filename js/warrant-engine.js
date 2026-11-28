/*
 * Midnight Agency - Warrants, busts and ring-leader odds (Wave 2, slice 3).
 *
 *   Warrant terminal   filter the lineup by uncovered traits. 0 matches blocks printing;
 *                      1+ lets the player pick one name (gambling is allowed).
 *   Bust               right city + right suspect on the warrant = clean capture.
 *                      Every other combination has a mild, non-punishing consequence.
 *   Rewards            stars via MidnightAgencyConfig.addStars, agency trust dots, agent XP/rapport.
 *   Rings              each ring tracks capturedMemberIds / intelFragments / leaderExposed;
 *                      catching members rolls an escalating chance to expose the Ring Leader as a
 *                      new high-stakes case.
 *
 * Depends on CaseEngine, AgentRoster, CrimeEngine, WorldFactbook. ctx.config may supply a
 * MidnightAgencyConfig-like object ({addStars, addTrust}); defaults to the global one.
 */
(function (global) {
  "use strict";

  var CE = function () { return global.CaseEngine; };

  var STAR_RULES = { base: 1, sharp: 1, leader: 2 };
  // chance of exposing the Ring Leader after the Nth member capture (5th and later = certain)
  var RING_LEADER_ODDS = [0.18, 0.50, 0.55, 0.95, 1.0];

  function config(ctx) { return (ctx && ctx.config) || global.MidnightAgencyConfig || null; }
  function rngOf(ctx) { return ctx && typeof ctx.rng === "function" ? ctx.rng : Math.random; }

  function ringState(state, ringId) {
    if (!state.rings[ringId]) state.rings[ringId] = { capturedMemberIds: [], intelFragments: 0, leaderExposed: false, leadersCaught: 0 };
    return state.rings[ringId];
  }

  function leaderOdds(captureCount) {
    return RING_LEADER_ODDS[Math.min(Math.max(captureCount, 1), RING_LEADER_ODDS.length) - 1];
  }

  // ------------------------------------------------------------------ warrant terminal

  // Lineup members that match EVERY trait uncovered so far.
  function matchingLineup(c) {
    var keys = Object.keys(c.uncovered);
    return c.lineup.filter(function (s) {
      return keys.every(function (k) { return s.traits[k] && s.traits[k].category === c.uncovered[k].category; });
    });
  }

  function printWarrant(state, ctx, caseId, suspectId) {
    var c = CE().getCase(state, caseId);
    if (!c || c.status === "solved") return { ok: false, reason: "no-case" };
    var matches = matchingLineup(c);
    if (!matches.length) return { ok: false, reason: "no-match" };           // printing blocked on 0 matches
    var pick = matches.filter(function (s) { return s.id === suspectId; })[0];
    if (!pick) return { ok: false, reason: "not-a-match" };
    c.warrant = { suspectId: pick.id, name: pick.displayName, issuedAt: ctx.now, gamble: matches.length > 1 };
    if (global.ChiefCalls) global.ChiefCalls.award(state, c, ctx, "warrant");
    return { ok: true, warrant: c.warrant, gamble: c.warrant.gamble, matches: matches.length };
  }

  function clearWarrant(state, caseId) {
    var c = CE().getCase(state, caseId);
    if (c) c.warrant = null;
  }

  // ------------------------------------------------------------------ consequences

  function applyTrust(ctx, delta) {
    var cfg = config(ctx);
    if (cfg && typeof cfg.addTrust === "function" && delta) cfg.addTrust(delta);
  }

  function nudgeAgent(state, agentId, rapportDelta, xp) {
    var a = state.agents[agentId];
    if (!a) return null;
    var change = { id: agentId, rapport: global.AgentRoster.adjustRapport(a, rapportDelta), xp: 0, leveledUp: false };
    if (xp) { change.xp = xp; change.leveledUp = global.AgentRoster.addXp(a, xp); }
    return change;
  }

  // ------------------------------------------------------------------ the bust

  // req: { caseId, agentId }. The agent must be free (not traveling) and stationed in the city
  // they are making the arrest in.
  function attemptBust(state, ctx, req) {
    var c = CE().getCase(state, req.caseId);
    var a = state.agents[req.agentId];
    if (!c || c.status === "solved") return { ok: false, reason: "no-case" };
    if (!a || a.status === "traveling") return { ok: false, reason: "agent-unavailable" };

    var def = global.AgentRoster.byId(a.id);
    var rightCity = a.stationPlaceId === CE().suspectPlaceId(c);
    var place = global.WorldFactbook.findPlace(a.stationPlaceId);

    if (!c.warrant) {
      if (!rightCity) {
        nudgeAgent(state, a.id, -1, 0);
        return { ok: true, outcome: "no-warrant-wrong-city", text: def.name + " has no warrant and nobody to arrest in " + place.city + ". Awkward!" };
      }
      // warrantless bust: the suspect is spooked and moves on
      nudgeAgent(state, a.id, -1, 0);
      applyTrust(ctx, -1);
      var ev = [];
      CE().softEscalate(c, ctx, ev);
      return { ok: true, outcome: "no-warrant", text: def.name + " tried to arrest without a warrant. The suspect slipped away, but HQ got a fresh clue.", events: ev };
    }

    if (!rightCity) {
      c.wrongTrips += 1;
      nudgeAgent(state, a.id, -1, 0);
      applyTrust(ctx, -1);
      return { ok: true, outcome: "wrong-city", text: def.name + " arrested nobody in " + place.city + ". The suspect is somewhere else." };
    }

    if (c.warrant.suspectId !== c.suspect.id) {
      c.falseArrests += 1;
      state.stats.falseArrests += 1;
      nudgeAgent(state, a.id, -1, 0);
      applyTrust(ctx, -1);
      var wrongName = c.warrant.name;
      c.warrant = null;       // file a new one
      var ev2 = [];
      CE().softEscalate(c, ctx, ev2);
      return { ok: true, outcome: "false-arrest", text: def.name + " arrested " + wrongName + ", but that was the wrong person! The real suspect slipped away.", events: ev2 };
    }

    return completeCase(state, ctx, c, a);
  }

  // ------------------------------------------------------------------ win

  function completeCase(state, ctx, c, busterAgent) {
    var cfg = config(ctx);
    var sharp = c.wrongTrips === 0 && c.falseArrests === 0;

    var stars = [{ label: "Case solved", stars: STAR_RULES.base }];
    if (sharp) stars.push({ label: "Sharp detective work: no wrong turns", stars: STAR_RULES.sharp });
    if (c.isLeaderCase) stars.push({ label: "Ring Leader captured", stars: STAR_RULES.leader });
    var totalStars = stars.reduce(function (n, s) { return n + s.stars; }, 0);

    c.status = "solved";
    c.solvedAt = ctx.now;
    global.CrimeEngine.resolveCrime(c.crime, "caught");
    state.stats.solved += 1;

    var rankBefore = cfg && cfg.read ? cfg.read().player.rank : null;
    var trustBefore = cfg && cfg.read ? cfg.read().player.trust : null;
    if (cfg && typeof cfg.addStars === "function") cfg.addStars(totalStars);
    if (cfg && typeof cfg.recordCaseSolved === "function") cfg.recordCaseSolved();
    if (sharp) applyTrust(ctx, 1);
    var after = cfg && cfg.read ? cfg.read().player : null;

    // agents: XP and rapport
    var agentChanges = [];
    var buster = nudgeAgent(state, busterAgent.id, 1, sharp ? 5 : 3);
    agentChanges.push(buster);
    Object.keys(c.contributors || {}).forEach(function (id) {
      if (id === busterAgent.id) return;
      agentChanges.push(nudgeAgent(state, id, 0, 1));
    });

    // passport stamps for every route stop an agent actually reached
    var newStamps = [];
    c.route.forEach(function (pid) {
      if (!c.visited[pid]) return;
      var p = global.WorldFactbook.findPlace(pid);
      if (!state.passport.some(function (s) { return s.iso2 === p.iso2; })) {
        var stamp = { iso2: p.iso2, city: p.city, country: p.country, placeId: p.id, caseId: c.id, at: ctx.now };
        state.passport.push(stamp);
        newStamps.push(stamp);
      }
    });

    // ring progress and the Ring Leader roll
    var ringInfo = null;
    var leaderCase = null;
    if (c.ringId) {
      var ring = ringState(state, c.ringId);
      if (c.isLeaderCase) {
        ring.leadersCaught += 1;
        ring.leaderExposed = false;
        ring.capturedMemberIds = [];
        ring.intelFragments = 0;
        ringInfo = { ringId: c.ringId, leaderCaught: true, leadersCaught: ring.leadersCaught };
      } else {
        if (ring.capturedMemberIds.indexOf(c.suspect.id) === -1) ring.capturedMemberIds.push(c.suspect.id);
        ring.intelFragments += 1;
        var count = ring.capturedMemberIds.length;
        var chance = leaderOdds(count);
        var rolled = false;
        if (!ring.leaderExposed && rngOf(ctx)() < chance) {
          rolled = true;
          ring.leaderExposed = true;
          leaderCase = CE().createCase(state, ctx, { ringId: c.ringId, isLeaderCase: true, intelFragments: ring.intelFragments });
        }
        ringInfo = { ringId: c.ringId, captured: count, intelFragments: ring.intelFragments, chance: chance, leaderExposed: ring.leaderExposed, newLeaderCase: !!rolled };
      }
    }

    // unlock with the rank these stars just earned, not the rank the case started at
    var unlockCtx = ctx;
    if (after && cfg && typeof cfg.rankLevel === "function") {
      unlockCtx = Object.assign({}, ctx, { rankLevel: cfg.rankLevel(after.rank) });
    }
    var unlocked = CE().syncRoster(state, unlockCtx).map(function (d) { return d.id; });

    var stolen = c.crime.target.name + " in " + global.WorldFactbook.findPlace(c.route[0]).city;
    c.summary = {
      headline: c.isLeaderCase ? "Ring Leader behind bars!" : "Case solved!",
      stolenGood: stolen,
      suspect: { name: c.suspect.displayName, rankTitle: c.suspect.rankTitle, ringId: c.ringId },
      route: c.route.map(function (pid) {
        var p = global.WorldFactbook.findPlace(pid);
        return { placeId: pid, city: p.city, country: p.country, iso2: p.iso2, visited: !!c.visited[pid] };
      }),
      stars: stars,
      totalStars: totalStars,
      rankBefore: rankBefore,
      rankAfter: after ? after.rank : null,
      trustBefore: trustBefore,
      trustAfter: after ? after.trust : null,
      agents: agentChanges,
      newStamps: newStamps,
      ring: ringInfo,
      newLeaderCaseId: leaderCase ? leaderCase.id : null,
      unlockedAgents: unlocked,
      wrongTrips: c.wrongTrips,
      falseArrests: c.falseArrests,
      timeTakenMs: ctx.now - c.createdAt
    };

    if (global.ChiefCalls) {
      var solvedNow = cfg && cfg.read ? (cfg.read().player.solved || 0) : (state.stats.solved || 0);
      global.ChiefCalls.wrapUp(state, c, ctx, c.summary, solvedNow);
    }
    return { ok: true, outcome: "clean", text: c.summary.headline, summary: c.summary };
  }

  global.WarrantEngine = {
    STAR_RULES: STAR_RULES,
    RING_LEADER_ODDS: RING_LEADER_ODDS,
    leaderOdds: leaderOdds,
    ringState: ringState,
    matchingLineup: matchingLineup,
    printWarrant: printWarrant,
    clearWarrant: clearWarrant,
    attemptBust: attemptBust
  };
})(typeof window !== "undefined" ? window : globalThis);
