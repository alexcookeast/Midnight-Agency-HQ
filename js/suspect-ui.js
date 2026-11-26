(function () {
  var HOUR_MS = 60 * 60 * 1000;

  // Stage table and stage maths live in js/crime-generator.js (CrimeEngine). This is only a
  // fallback so the page never throws if that script failed to load.
  var HEIST_STAGES = (window.CrimeEngine && window.CrimeEngine.HEIST_STAGES) || [
    { id: "planning", label: "Planning", share: 1, clueClarity: "subtle", summaryHint: "Subtle clues, longest window" }
  ];

  var logs = [];
  var rosterData = null;
  var engine = null;
  var activeCrimes = [];
  var revealTruths = false;

  // Real-time clock state (starts frozen for safe testing; toggle LIVE for real-time play)
  var realTimeClockEnabled = false;
  var clockIntervalMs = 1000;
  var clockTimerId = null;
  var lastClockTickAt = null;

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDuration(ms) {
    var wf = window.WorldFactbook;
    if (wf && typeof wf.formatDurationMs === "function") {
      return wf.formatDurationMs(ms);
    }
    var totalMinutes = Math.max(0, Math.round((Number(ms) || 0) / 60000));
    var hours = Math.floor(totalMinutes / 60);
    var mins = totalMinutes % 60;
    if (hours > 0 && mins > 0) return hours + "h " + mins + "m";
    if (hours > 0) return hours + "h";
    return mins + "m";
  }

  function formatDetailedCountdown(ms, opts) {
    var options = opts || {};
    var safeMs = Math.max(0, Number(ms) || 0);
    if (safeMs <= 0) return "0m";

    var totalSeconds = Math.floor(safeMs / 1000);
    var days = Math.floor(totalSeconds / 86400);
    var remAfterDays = totalSeconds % 86400;
    var hours = Math.floor(remAfterDays / 3600);
    var remAfterHours = remAfterDays % 3600;
    var minutes = Math.floor(remAfterHours / 60);
    var seconds = remAfterHours % 60;

    var parts = [];
    if (days > 0) parts.push(days + "d");
    if (hours > 0 || days > 0) parts.push(hours + "h");
    if (minutes > 0 || (days === 0 && hours === 0)) parts.push(minutes + "m");

    // Show seconds when under 1 hour (or when explicitly requested for live testing)
    if ((days === 0 && hours === 0) || options.includeSeconds) {
      parts.push(seconds + "s");
    }

    return parts.join(" ");
  }

  function getHeistStage(crime) {
    if (window.CrimeEngine && typeof window.CrimeEngine.getHeistStage === "function") {
      return window.CrimeEngine.getHeistStage(crime);
    }
    return HEIST_STAGES[0];
  }

  function formatClueForStage(clue, stageObj) {
    if (!clue) return "";
    var isPlanning = stageObj && stageObj.id === "planning";
    var rawText = clue.text || "";

    if (isPlanning && !revealTruths) {
      if (clue.planningText) {
        rawText = clue.planningText;
      } else {
        rawText = "Faint early chatter: " + rawText;
      }
    }

    var tagPill = revealTruths && clue.tag
      ? ' <span class="badge">' + escapeHtml(clue.tag) + "</span>"
      : "";

    return "<li>" + escapeHtml(rawText) + tagPill + "</li>";
  }

  function resolvePlaceLabel(item) {
    if (!item) return "Unknown Place";
    var wf = window.WorldFactbook;
    var place = item.currentPlace || (wf && typeof wf.findPlace === "function"
      ? wf.findPlace(item.placeId || item.currentPlaceId || item.city || item.currentCity)
      : null);

    var city = (place && place.city) || item.city || item.currentCity || "Unknown City";
    var country = (place && place.country) || item.country || item.currentCountry || "";
    var region = (place && place.region) || item.region || item.currentRegion || "";

    return city +
      (country ? ", " + country : "") +
      (region ? " (" + region + ")" : "");
  }

  function logEvent(msg) {
    var stamp = new Date().toLocaleTimeString([], { hour12: false });
    logs.unshift("[" + stamp + "] " + msg);
    if (logs.length > 60) logs.pop();
    var el = document.getElementById("log");
    if (el) {
      el.innerHTML = logs
        .map(function (line) {
          return '<div class="log-entry">' + escapeHtml(line) + "</div>";
        })
        .join("");
    }
  }

  function showError(err) {
    var msg = err && err.message ? err.message : String(err);
    var board = document.getElementById("board");
    if (board) {
      board.innerHTML =
        '<article class="card">' +
        '<div class="name">Couldn\'t Start Test Bench</div>' +
        '<div class="meta">' + escapeHtml(msg) + "</div>" +
        "</article>";
    }
    logEvent("ERROR: " + msg);
  }

  function getTrackedSuspects() {
    if (!engine) return [];
    return [].concat(engine.activeSuspects || [], engine.stagedSuspects || []);
  }

  function findSuspectById(id) {
    if (!id || !engine) return null;
    var all = [].concat(
      engine.activeSuspects || [],
      engine.stagedSuspects || [],
      engine.retiredSuspects || []
    );
    return all.find(function (s) { return s.id === id; }) || null;
  }

  // A suspect who is caught or slips away closes every crime linked to them.
  function closeLinkedCrimes(suspect, outcome) {
    if (!suspect || !window.CrimeEngine) return;
    var closed = window.CrimeEngine.resolveCrimesForSuspect(activeCrimes, suspect.id, outcome);
    closed.forEach(function (c) {
      logEvent(
        (outcome === "caught" ? "Case solved: " : "Case closed, suspect got away: ") +
        c.typeLabel + " at " + c.target.name + "."
      );
    });
  }

  function spawnIncident(customOpts) {
    if (!window.CrimeEngine || !rosterData) return null;
    var snap = engine ? engine.getSnapshot() : { caseNumber: 1 };
    var candidates = getTrackedSuspects();

    var crime = window.CrimeEngine.createCrime(
      Object.assign(
        {
          caseNumber: snap.caseNumber || 1,
          crimeRings: rosterData.crimeRings || {},
          suspects: candidates
        },
        customOpts || {}
      )
    );

    if (!crime.durationMs || crime.durationMs <= 0) {
      var fallbackHours = typeof crime.turnsRemaining === "number" && crime.turnsRemaining > 0
        ? crime.turnsRemaining * 6
        : 24;
      crime.durationMs = fallbackHours * HOUR_MS;
    }
    if (typeof crime.remainingMs !== "number") {
      crime.remainingMs = crime.durationMs;
    }

    var startStage = getHeistStage(crime);
    activeCrimes.unshift(crime);
    logEvent(
      "New clue [" + startStage.label + " · " + crime.mode.toUpperCase() +
      " (" + formatDetailedCountdown(crime.remainingMs) + ")]: " +
      crime.typeLabel + " at " + crime.target.name +
      " (" + crime.target.city + ", " + crime.target.country + ")."
    );
    return crime;
  }

  function seedCaseIncidents() {
    activeCrimes = [];
    spawnIncident();
    spawnIncident();
  }

  function stepClock(reason, elapsedMs) {
    var dt = typeof elapsedMs === "number" ? Math.max(0, elapsedMs) : HOUR_MS;
    if (!dt) return;

    var beforeState = {};
    if (window.CrimeEngine && activeCrimes.length) {
      activeCrimes.forEach(function (c) {
        var st = getHeistStage(c);
        beforeState[c.id] = {
          mode: c.mode,
          status: c.status,
          stageId: st && st.id
        };
      });

      activeCrimes = window.CrimeEngine.advanceAllCrimes(activeCrimes, dt);

      activeCrimes.forEach(function (c) {
        if (!c.durationMs || c.durationMs <= 0) {
          c.durationMs = Math.max(HOUR_MS, c.remainingMs || HOUR_MS);
        }
        var prev = beforeState[c.id];
        var nextStage = getHeistStage(c);

        if (prev && prev.status === "open" && c.status === "escalated") {
          logEvent(
            "TOO LATE! " + c.typeLabel + " at " + c.target.name +
            " (" + c.target.city + ") switched from THWART to RECOVERY!"
          );
        } else if (prev && prev.status !== "cold" && c.status === "cold") {
          logEvent(
            "COLD: the trail on " + c.typeLabel + " at " + c.target.name +
            " (" + c.target.city + ") has gone cold."
          );
        } else if (prev && nextStage && prev.stageId !== nextStage.id && c.status !== "resolved") {
          logEvent(
            "Stage shift: " + c.typeLabel + " at " + c.target.name +
            " entered " + nextStage.label + " (" + nextStage.summaryHint + ")."
          );
        }
      });
    }

    if (engine && typeof engine.advanceTime === "function") {
      var arrivals = engine.advanceTime(dt);
      arrivals.forEach(function (a) {
        logEvent("Arrived: " + a.displayName + " reached " + a.toCity + ".");
      });
    }

    if (reason !== "tick") {
      logEvent("Moved forward " + formatDuration(dt) + " across " + activeCrimes.length + " clue(s).");
    }
    refresh();
  }

  function advanceHour() {
    stepClock("manual", HOUR_MS);
  }

  function stopRealTimeClock() {
    if (clockTimerId !== null) {
      clearInterval(clockTimerId);
      clockTimerId = null;
    }
  }

  function startRealTimeClock() {
    stopRealTimeClock();
    if (!realTimeClockEnabled) return;
    lastClockTickAt = Date.now();
    clockTimerId = setInterval(function () {
      var now = Date.now();
      var elapsed = Math.max(0, now - (lastClockTickAt || now));
      lastClockTickAt = now;

      if (document.hidden) return;
      if (!engine || !activeCrimes.length) return;
      var hasOpen = activeCrimes.some(function (c) { return c.status === "open" || c.status === "escalated"; });
      if (!hasOpen) return;
      stepClock("tick", elapsed);
    }, clockIntervalMs);
  }

  function setRealTimeClock(enabled) {
    realTimeClockEnabled = Boolean(enabled);
    if (realTimeClockEnabled) {
      startRealTimeClock();
      logEvent("Real-time clock ON (" + formatDuration(clockIntervalMs) + " per live tick).");
    } else {
      stopRealTimeClock();
      logEvent("Real-time clock FROZEN for testing. Use +1h to step forward by an hour.");
    }
    refresh();
  }

  function renderStats(snap) {
    var el = document.getElementById("stats");
    if (!el) return;
    var openCount = activeCrimes.filter(function (c) { return c.status !== "resolved"; }).length;
    el.innerHTML =
      '<div class="stat"><div class="stat-label">Case #</div><div class="stat-value">' + snap.caseNumber + "</div></div>" +
      '<div class="stat"><div class="stat-label">Active Board</div><div class="stat-value">' + snap.activeSuspects.length + " / " + engine.rules.maxActiveSuspects + "</div></div>" +
      '<div class="stat"><div class="stat-label">Tier 1 Cap</div><div class="stat-value">' + snap.tier1Count + " / " + engine.rules.maxTier1Operatives + "</div></div>" +
      '<div class="stat"><div class="stat-label">In Wings</div><div class="stat-value">' + snap.stagedCount + "</div></div>" +
      '<div class="stat"><div class="stat-label">Open Clues</div><div class="stat-value">' + openCount + "</div></div>" +
      '<div class="stat"><div class="stat-label">Clock</div><div class="stat-value">' + (realTimeClockEnabled ? "LIVE" : "FROZEN") + "</div></div>";
  }

  function renderIncidentsSection() {
    var itemsHtml = activeCrimes.map(function (c) {
      var stageObj = getHeistStage(c);
      var remainingLabel = formatDetailedCountdown(c.remainingMs, {
        includeSeconds: Boolean(realTimeClockEnabled)
      });

      var etaLabel = "";
      if (realTimeClockEnabled && c.status !== "resolved" && typeof c.remainingMs === "number" && c.remainingMs > 0) {
        var etaDate = new Date(Date.now() + c.remainingMs);
        etaLabel =
          " · until " +
          etaDate.toLocaleDateString([], { month: "short", day: "numeric" }) +
          " " +
          etaDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }

      var stagePrefix = stageObj ? stageObj.label + " · " : "";
      var modeBadge =
        c.status === "resolved"
          ? (c.resolution && c.resolution.outcome === "escaped" ? "got away" : "solved")
          : c.status === "cold"
          ? "cold trail"
          : c.mode === "thwart"
          ? stagePrefix + "stop it · " + remainingLabel + " left" + etaLabel
          : c.status === "escalated"
          ? stagePrefix + "too late -> get it back · " + remainingLabel + " left" + etaLabel
          : stagePrefix + "get it back · " + remainingLabel + " left" + etaLabel;

      var cluesHtml = (c.observableClues || [])
        .map(function (cl) {
          return formatClueForStage(cl, stageObj);
        })
        .join("");

      var truthBlock = "";
      if (revealTruths) {
        var linkedSuspect = findSuspectById(c.suspectId);
        var ringObj = c.ringId && rosterData && rosterData.crimeRings && rosterData.crimeRings[c.ringId];
        var truthKind =
          c.truthCategory === "disgruntled-local"
            ? "Grumpy Local"
            : c.truthCategory === "accident"
            ? "Oops! Accident"
            : "Sneaky Crew (" + ((ringObj && ringObj.name) || c.ringId || "unknown crew") + ")";

        var suspectLine = linkedSuspect
          ? " · Suspect: " + linkedSuspect.displayName + " (Tier " + linkedSuspect.tier + " " + linkedSuspect.rankTitle + ")"
          : "";

        var twistHtml = (c.twistClues || []).length
          ? '<div class="meta" style="margin-top:4px;"><em>What really happened:</em> ' + escapeHtml(c.twistClues.join(" ")) + "</div>"
          : "";

        truthBlock =
          '<div style="margin-top:8px;padding:8px;border-radius:6px;background:rgba(255,255,255,0.04);border:1px dashed var(--border);">' +
          '<div class="meta"><strong>Answer:</strong> ' + escapeHtml(truthKind + suspectLine) + "</div>" +
          twistHtml +
          "</div>";
      }

      return (
        '<div style="padding:10px 0;border-top:1px solid var(--border);">' +
        '<div class="card-header">' +
        '<div class="name" style="font-size:1rem;">' +
        escapeHtml(c.typeLabel) + " — " + escapeHtml(c.target.name) +
        "</div>" +
        '<span class="badge">' + escapeHtml(modeBadge) + "</span>" +
        "</div>" +
        '<div class="meta">' +
        escapeHtml(resolvePlaceLabel(c.target)) +
        " · Stage: " + escapeHtml((stageObj && stageObj.summaryHint) || "Active") +
        " · Scoop: Suspect " + escapeHtml(c.summaryAction) + "." +
        "</div>" +
        '<ul class="detail-list">' + cluesHtml + "</ul>" +
        truthBlock +
        '<div class="card-actions">' +
        (c.status !== "resolved"
          ? '<button data-action="resolve-crime" data-id="' + escapeHtml(c.id) + '">Case Closed</button>'
          : '<span class="meta">Case closed!</span>') +
        "</div>" +
        "</div>"
      );
    }).join("");

    return (
      '<article class="card" style="grid-column: 1 / -1;">' +
      '<div class="card-header" style="align-items:center;gap:8px;flex-wrap:wrap;">' +
      '<div class="name">Mystery Clues &amp; Incidents</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
      '<button data-action="spawn-crime">New Mystery</button>' +
      '<button data-action="spawn-lookalike">Spawn False Alarm</button>' +
      '<button data-action="advance-turn">+1h</button>' +
      '<button data-action="toggle-clock">' + (realTimeClockEnabled ? "Clock: LIVE (Freeze)" : "Clock: FROZEN (Test)") + "</button>" +
      '<button data-action="toggle-truth">' + (revealTruths ? "Hide Answers" : "Show Answers") + "</button>" +
      "</div>" +
      "</div>" +
      '<div class="meta">Heists move through Planning (longest &amp; subtlest), Preparation, Execution, Escape, and Cold—watch out for grumpy locals and silly accidents!</div>' +
      (itemsHtml || '<div class="meta" style="margin-top:8px;">No mysteries right now. Click New Mystery to start one!</div>') +
      "</article>"
    );
  }

  function renderBoard(snap) {
    var el = document.getElementById("board");
    if (!el) return;

    var cardsHtml = snap.activeSuspects.map(function (s) {
      var ringName =
        (rosterData && rosterData.crimeRings && rosterData.crimeRings[s.ringId] && rosterData.crimeRings[s.ringId].name) ||
        s.ringId;
      var app = s.appearance || {};
      var acc =
        ((s.wardrobe && s.wardrobe.accoutrements) || [])
          .map(function (a) { return a.clueText; })
          .join(", ") || "nothing extra";
      var badgeClass = s.nameDisplayMode === "mononym" ? "badge mononym" : "badge";
      var mapCityText = resolvePlaceLabel(s);
      var travelText = s.travel && typeof s.travel.remainingMs === "number"
        ? " · En route to " + s.travel.toCity + " (" + formatDetailedCountdown(s.travel.remainingMs) + ")"
        : "";

      return (
        '<article class="card">' +
        '<div class="card-header">' +
        '<div class="name">' + escapeHtml(s.displayName) + "</div>" +
        '<span class="' + badgeClass + '">' + escapeHtml(s.nameDisplayMode || "standard") + "</span>" +
        "</div>" +
        '<div class="meta">Tier ' + s.tier + " (" + escapeHtml(s.rankTitle) + ") · " + escapeHtml(ringName) + " · " + escapeHtml(s.ethnicity) + (s.isOutlier ? " · Wildcard" : "") + "</div>" +
        '<div class="meta">Map City: ' + escapeHtml(mapCityText + travelText) + "</div>" +
        '<ul class="detail-list">' +
        "<li><strong>Size &amp; Shape:</strong> " + escapeHtml((app.height && app.height.clueText) || "?") + ", " + escapeHtml((app.build && app.build.clueText) || "?") + ", " + escapeHtml((app.weight && app.weight.clueText) || "?") + "</li>" +
        "<li><strong>Look &amp; Eyes:</strong> " + escapeHtml((app.complexion && app.complexion.clueText) || "?") + ", " + escapeHtml((app.eyeColor && app.eyeColor.clueText) || "?") + "</li>" +
        "<li><strong>Hair &amp; Whiskers:</strong> " + escapeHtml((app.hairColor && app.hairColor.clueText) || "?") + ", " + escapeHtml((app.hairStyle && app.hairStyle.clueText) || "?") + ", " + escapeHtml((app.facialHair && app.facialHair.clueText) || "?") + "</li>" +
        "<li><strong>Clothes &amp; Gear:</strong> " + escapeHtml((s.wardrobe && s.wardrobe.outfit && s.wardrobe.outfit.clueText) || "?") + " · " + escapeHtml(acc) + "</li>" +
        "</ul>" +
        '<div class="card-actions">' +
        '<button data-action="pull" data-id="' + escapeHtml(s.id) + '">Follow Crew Clue</button>' +
        '<button data-action="escape" data-id="' + escapeHtml(s.id) + '">Sneak Away</button>' +
        '<button data-action="capture" data-id="' + escapeHtml(s.id) + '">Catch</button>' +
        "</div>" +
        "</article>"
      );
    }).join("");

    var custodyHtml = "";
    if (engine.retiredSuspects && engine.retiredSuspects.length) {
      custodyHtml =
        '<article class="card" style="grid-column: 1 / -1;">' +
        '<div class="name">Caught / Retired (' + engine.retiredSuspects.length + ")</div>" +
        engine.retiredSuspects.slice(-5).map(function (c) {
          return (
            '<div style="padding:6px 0;border-top:1px solid var(--border);">' +
            "<strong>" + escapeHtml(c.displayName) + "</strong> " +
            '<span class="meta">· Tier ' + c.tier + " (" + escapeHtml(c.rankTitle) + ") · " + escapeHtml(c.status) + "</span>" +
            "</div>"
          );
        }).join("") +
        "</article>";
    }

    el.innerHTML =
      (cardsHtml || '<div class="meta">No suspects on the board right now.</div>') +
      renderIncidentsSection() +
      custodyHtml;
  }

  function refresh() {
    if (!engine) return;
    var snap = engine.getSnapshot();
    renderStats(snap);
    renderBoard(snap);
  }

  function bindEvents() {
    var btnNew = document.getElementById("btn-new-case");
    var btnPull = document.getElementById("btn-pull-thread");
    var btnRoll = document.getElementById("btn-roll-100");
    var board = document.getElementById("board");

    if (btnNew) {
      btnNew.addEventListener("click", function () {
        if (!engine) return;
        var snap = engine.startCase();
        seedCaseIncidents();
        logEvent("Started Case #" + snap.caseNumber + " (" + snap.activeRings.join(", ") + ").");
        refresh();
      });
    }

    if (btnPull) {
      btnPull.addEventListener("click", function () {
        if (!engine) return;
        var added = engine.pullThread();
        logEvent(
          added
            ? "Followed clue -> " + added.displayName + " (Tier " + added.tier + " " + added.rankTitle + ")."
            : "Board is full for that tier."
        );
        refresh();
      });
    }

    if (btnRoll) {
      btnRoll.addEventListener("click", function () {
        if (!rosterData || !window.SuspectGeneratorUtils) return;
        var mononyms = 0;
        var nicknames = 0;
        var hyphenated = 0;
        var used = new Set();

        for (var i = 0; i < 100; i++) {
          var s = window.SuspectGeneratorUtils.createFreshSuspect(rosterData, {
            tier: 1,
            usedNicknames: used
          });
          if (s.nickName) {
            nicknames += 1;
            used.add(s.nickName.toLowerCase());
          }
          if (s.nameDisplayMode === "mononym") mononyms += 1;
          if (s.isHyphenated) hyphenated += 1;
        }

        logEvent(
          "100 rolls -> Unique Nicknames:" + nicknames +
          " | One-Name Legends:" + mononyms +
          " | Hyphen Last Names:" + hyphenated
        );
      });
    }

    if (board) {
      board.addEventListener("click", function (e) {
        if (!engine) return;
        var btn = e.target.closest("button[data-action]");
        if (!btn) return;
        var action = btn.getAttribute("data-action");
        var id = btn.getAttribute("data-id");

        if (action === "pull") {
          var added = engine.pullThread(id);
          logEvent(added ? "Followed clue -> " + added.displayName + " (Tier " + added.tier + ")." : "Board is full for that tier.");
        } else if (action === "escape") {
          var res = engine.handleEscape(id);
          if (res) {
            logEvent(res.suspect.displayName + ": " + res.note + " (+" + res.addedUnderlingsCount + " Tier 1 staged)");
            closeLinkedCrimes(res.suspect, "escaped");
          }
        } else if (action === "capture") {
          var cap = engine.captureSuspect(id);
          if (cap) {
            logEvent("Caught " + cap.displayName + " (Tier " + cap.tier + ").");
            closeLinkedCrimes(cap, "caught");
          }
        } else if (action === "spawn-crime") {
          spawnIncident();
        } else if (action === "spawn-lookalike") {
          spawnIncident({ forceNonSyndicate: true });
        } else if (action === "advance-turn") {
          advanceHour();
          return;
        } else if (action === "toggle-clock") {
          setRealTimeClock(!realTimeClockEnabled);
          return;
        } else if (action === "toggle-truth") {
          revealTruths = !revealTruths;
        } else if (action === "resolve-crime") {
          var targetCrime = activeCrimes.find(function (c) { return c.id === id; });
          if (targetCrime) {
            if (window.CrimeEngine) window.CrimeEngine.resolveCrime(targetCrime, "closed");
            else targetCrime.status = "resolved";
            logEvent("Case closed: " + targetCrime.typeLabel + " at " + targetCrime.target.name + ".");
          }
        }

        refresh();
      });
    }
  }

  bindEvents();

  Promise.all([
    fetch("data/suspects.json").then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status + " loading data/suspects.json");
      return res.json();
    }),
    fetch("data/crime-rings.json")
      .then(function (res) {
        return res.ok ? res.json() : { crimeRings: {} };
      })
      .catch(function () {
        return { crimeRings: {} };
      })
  ])
    .then(function (results) {
      var suspectsJson = results[0] || {};
      var ringsJson = results[1] || {};
      rosterData = Object.assign({}, suspectsJson, {
        crimeRings: Object.assign({}, suspectsJson.crimeRings || {}, ringsJson.crimeRings || {})
      });

      if (!window.SuspectEngine) {
        throw new Error("SuspectEngine not found on window. Check js/suspect-generator.js.");
      }

      engine = new window.SuspectEngine(rosterData);
      engine.startCase();
      seedCaseIncidents();
      startRealTimeClock();
      logEvent("Mystery bench ready! Clock is FROZEN for testing—toggle LIVE whenever you want real-time ticks.");
      refresh();
    })
    .catch(function (err) {
      showError(err);
    });
})();