(function (global) {
  "use strict";

  var HOUR_MS = 60 * 60 * 1000;
  var DEFAULT_THWART_HOURS = 36;
  var DEFAULT_RECOVERY_HOURS = 48;

  /*
   * Crime lifecycle
   *   status: open       -> clock running (thwart: stop it / recovery: get it back)
   *           escalated  -> a thwart window ran out; now a recovery window, clock still running
   *           cold       -> a window ran out with nobody solving it; clock stopped, trail fading
   *           resolved   -> closed by the player; crime.resolution.outcome says how
   *   stageFloor: first heist stage this crime's current window can show. Escalation moves it to
   *   "escape" (the heist already happened) so a late crime never rewinds to "Planning".
   */
  var HEIST_STAGES = [
    { id: "planning", label: "Planning", share: 0.40, clueClarity: "subtle", summaryHint: "Subtle clues, longest window" },
    { id: "preparation", label: "Preparation", share: 0.22, clueClarity: "practical", summaryHint: "Gear & local hints forming" },
    { id: "execution", label: "Execution", share: 0.18, clueClarity: "loud", summaryHint: "Action happening now" },
    { id: "escape", label: "Escape", share: 0.14, clueClarity: "mobile", summaryHint: "On the move across routes" },
    { id: "cold", label: "Cold", share: 0.06, clueClarity: "fading", summaryHint: "Trail fading / cooling down" }
  ];

  var DEFAULT_CRIME_TYPES = [
    {
      id: "heist",
      label: "Sneaky Heist",
      mode: "recovery",
      hours: 48,
      tacticTags: ["decoy-swap", "late-night-window"],
      targets: [
        { name: "Harbor Record Book Room", category: "archive", city: "Dublin", country: "Ireland", region: "Europe" },
        { name: "Old Coin Vault", category: "vault", city: "Oslo", country: "Norway", region: "Europe" },
        { name: "Hilltop Brass Museum", category: "archive", city: "Santiago", country: "Chile", region: "Americas" }
      ],
      lootOrPlan: {
        recovery: "swiped a real record book and left a fake copy behind",
        thwart: "is about to swap a real record book before sunrise"
      }
    },
    {
      id: "sabotage",
      label: "Power Trouble",
      mode: "thwart",
      hours: 24,
      tacticTags: ["quiet-handling", "overnight-rail"],
      targets: [
        { name: "North Train Signal Box", category: "transit", city: "Winnipeg", country: "Canada", region: "Americas" },
        { name: "Harbor Gate Control", category: "port", city: "Gothenburg", country: "Sweden", region: "Europe" },
        { name: "Neighborhood Power Station", category: "utility", city: "Osaka", country: "Japan", region: "Asia" }
      ],
      lootOrPlan: {
        recovery: "pulled a key switch out of the control box",
        thwart: "set a timer to trip the night train tracks"
      }
    },
    {
      id: "smuggling",
      label: "Sneaky Delivery",
      mode: "thwart",
      hours: 36,
      tacticTags: ["quiet-handling", "cold-weather-gear"],
      targets: [
        { name: "Dock 9 Cargo Shed", category: "port", city: "Lagos", country: "Nigeria", region: "Africa" },
        { name: "Border Train Yard", category: "rail", city: "Warsaw", country: "Poland", region: "Europe" },
        { name: "Airport Mail Room", category: "transit", city: "Reykjavik", country: "Iceland", region: "Europe" }
      ],
      lootOrPlan: {
        recovery: "slipped secret boxes past the gate before morning",
        thwart: "is hiding cold-weather boxes for a secret handoff"
      }
    },
    {
      id: "spectacle",
      label: "Big Show Caper",
      mode: "recovery",
      hours: 48,
      tacticTags: ["bold-landmark", "late-night-window"],
      targets: [
        { name: "Clocktower Bell", category: "landmark", city: "Mexico City", country: "Mexico", region: "Americas" },
        { name: "Winter Park Pavilion", category: "landmark", city: "Thunder Bay", country: "Canada", region: "Americas" },
        { name: "Lighthouse Tower", category: "landmark", city: "Dakar", country: "Senegal", region: "Africa" }
      ],
      lootOrPlan: {
        recovery: "took a shiny brass bell during a big commotion",
        thwart: "is planning a flashy trick to sneak away with something"
      }
    }
  ];

  var TACTIC_CLUES = {
    "cold-weather-gear": [
      "Someone left heavy winter boots and warm gear near the back door.",
      "Big cold-weather packages were moved without normal shipping tags."
    ],
    "bold-landmark": [
      "It looked like a big showy stunt at first—until people noticed something was gone!",
      "Everyone was looking at the main spot while a sneaky move happened."
    ],
    "overnight-rail": [
      "A scribbled note with night train times was found near the tracks.",
      "The trouble happened right around the late freight train."
    ],
    "late-night-window": [
      "It was quiet until way past bedtime when only a few helpers were around.",
      "The clock showed the sneaky stuff happened late at night."
    ],
    "quiet-handling": [
      "Nothing was smashed or broken—whoever opened it knew a gentle trick.",
      "Soft footsteps and no clatter meant someone was super careful not to make noise."
    ],
    "decoy-swap": [
      "At first glance everything looked normal, but the weight felt a little off.",
      "A closer look showed the real item was swapped for a lookalike."
    ]
  };

  var CONFLICTING_TAGS = {
    "bold-landmark": ["late-night-window", "quiet-handling"],
    "late-night-window": ["bold-landmark"],
    "quiet-handling": ["bold-landmark"]
  };

  var NON_SYNDICATE_PROFILES = {
    "disgruntled-local": {
      label: "Grumpy Local",
      summary: "Just a grumpy local or worker in a bad mood—not part of a spy crew.",
      twistClues: [
        "Workers said it was just a grumpy local with an old badge or a sore spot.",
        "No secret travel clues or spy tricks turned up at all."
      ]
    },
    "accident": {
      label: "Oops! Accident",
      summary: "A plain old mix-up or silly mistake—not a sneaky plot.",
      twistClues: [
        "Turns out it was just a mix-up and bad timing, not a secret plan.",
        "No getaway—just a messy oops moment."
      ]
    }
  };

  function pick(list, rng) {
    var random = typeof rng === "function" ? rng : Math.random;
    if (!Array.isArray(list) || list.length === 0) return null;
    return list[Math.floor(random() * list.length)];
  }

  function shuffleArray(list, rng) {
    var random = typeof rng === "function" ? rng : Math.random;
    var copy = Array.isArray(list) ? list.slice() : [];
    for (var i = copy.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function selectCompatibleTags(tags, rng, maxClues) {
    var limit = typeof maxClues === "number" ? maxClues : 2;
    var chosen = [];
    var blocked = new Set();
    var candidates = shuffleArray(tags, rng);

    for (var i = 0; i < candidates.length; i += 1) {
      if (chosen.length >= limit) break;
      var tag = candidates[i];
      if (!tag || blocked.has(tag)) continue;
      chosen.push(tag);
      var conflicts = CONFLICTING_TAGS[tag] || [];
      for (var c = 0; c < conflicts.length; c += 1) {
        blocked.add(conflicts[c]);
      }
    }

    return chosen;
  }

  function hydrateTargetWithPlace(rawTarget, rng) {
    var wf = global.WorldFactbook;
    var base = Object.assign(
      {
        name: "City Depot",
        category: "depot",
        city: "Winnipeg",
        country: "Canada",
        region: "Americas"
      },
      rawTarget || {}
    );

    var place = wf && typeof wf.findPlace === "function"
      ? wf.findPlace(base.placeId || base.city)
      : null;

    if (!place && wf && typeof wf.pickPlace === "function") {
      place = wf.pickPlace({ region: base.region }, rng);
    }

    if (place) {
      return Object.assign({}, base, {
        placeId: place.id,
        city: place.city,
        country: place.country,
        region: place.region,
        landmass: place.landmass,
        isHub: Boolean(place.isHub),
        modes: Array.isArray(place.modes) ? place.modes.slice() : ["road", "rail"],
        map: place.map ? { x: place.map.x, y: place.map.y } : { x: 50, y: 50 },
        placeNote: place.note || ""
      });
    }

    return Object.assign({
      placeId: String(base.city || "winnipeg").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      landmass: "north-america",
      isHub: false,
      modes: ["road", "rail"],
      map: { x: 50, y: 50 },
      placeNote: ""
    }, base);
  }

  function createCrime(options) {
    var opts = options || {};
    var rng = typeof opts.rng === "function" ? opts.rng : Math.random;
    var rings = opts.crimeRings ? Object.values(opts.crimeRings) : [];
    var suspects = Array.isArray(opts.suspects) ? opts.suspects : [];
    var crimeType = opts.crimeType || pick(DEFAULT_CRIME_TYPES, rng);
    var mode = opts.mode || crimeType.mode || (rng() < 0.5 ? "recovery" : "thwart");

    var isNonSyndicate = typeof opts.forceNonSyndicate === "boolean"
      ? opts.forceNonSyndicate
      : rng() < 0.22;

    var nonSyndicateKind = isNonSyndicate
      ? (opts.nonSyndicateKind || (rng() < 0.55 ? "disgruntled-local" : "accident"))
      : null;

    var suspect = null;
    var ring = null;

    if (!isNonSyndicate) {
      suspect = opts.suspect || pick(suspects, rng);
      if (suspect && suspect.ringId && opts.crimeRings && opts.crimeRings[suspect.ringId]) {
        ring = opts.crimeRings[suspect.ringId];
      } else if (opts.ringId && opts.crimeRings && opts.crimeRings[opts.ringId]) {
        ring = opts.crimeRings[opts.ringId];
      } else if (rings.length) {
        ring = pick(rings, rng);
      }

      if (!suspect && ring && suspects.length) {
        var ringSuspects = suspects.filter(function (s) { return s.ringId === ring.id; });
        suspect = pick(ringSuspects.length ? ringSuspects : suspects, rng);
      }
    }

    var chosenTarget = opts.target || (suspect && suspect.currentPlace
      ? {
          name: (pick(crimeType.targets, rng) || {}).name || "Local Landmark",
          category: (pick(crimeType.targets, rng) || {}).category || "landmark",
          city: suspect.currentCity,
          country: suspect.currentCountry,
          region: suspect.currentRegion
        }
      : pick(crimeType.targets, rng));

    var target = hydrateTargetWithPlace(chosenTarget, rng);

    var combinedTags = Array.from(new Set([
      ...(crimeType.tacticTags || []),
      ...(!isNonSyndicate && ring && Array.isArray(ring.tacticTags) ? ring.tacticTags : [])
    ]));

    var selectedTags = selectCompatibleTags(combinedTags, rng, 2);

    var observableClues = selectedTags.map(function (tag) {
      return {
        tag: tag,
        text: pick(TACTIC_CLUES[tag], rng) || "Someone spotted something fishy at the scene."
      };
    });

    if (
      !isNonSyndicate &&
      suspect &&
      global.SuspectGeneratorUtils &&
      typeof global.SuspectGeneratorUtils.createIdentityClueFragment === "function" &&
      rng() < 0.65
    ) {
      var fragment = global.SuspectGeneratorUtils.createIdentityClueFragment(suspect, rng);
      if (fragment) {
        observableClues.push({
          tag: "identity-lead",
          text: "A clue says " + fragment + "."
        });
      }
    }

    var defaultHours = mode === "thwart"
      ? (opts.hours || crimeType.hours || DEFAULT_THWART_HOURS)
      : (opts.hours || crimeType.hours || DEFAULT_RECOVERY_HOURS);

    var totalDurationMs = typeof opts.durationMs === "number"
      ? Math.max(0, opts.durationMs)
      : Math.round(defaultHours * HOUR_MS);

    return {
      id: "inc-" + Date.now().toString(36) + "-" + Math.floor(rng() * 1000),
      caseNumber: opts.caseNumber || 1,
      typeId: crimeType.id,
      typeLabel: crimeType.label,
      mode: mode,
      target: target,
      summaryAction: (crimeType.lootOrPlan && crimeType.lootOrPlan[mode]) || "caused a stir nearby",
      isSyndicate: !isNonSyndicate,
      truthCategory: isNonSyndicate ? nonSyndicateKind : "syndicate",
      ringId: isNonSyndicate ? null : (ring ? ring.id : null),
      suspectId: isNonSyndicate ? null : (suspect ? suspect.id : null),
      tacticTags: selectedTags,
      observableClues: observableClues,
      twistClues: isNonSyndicate
        ? [...NON_SYNDICATE_PROFILES[nonSyndicateKind].twistClues]
        : [],
      status: "open",
      stageFloor: "planning",
      resolution: null,
      durationMs: totalDurationMs,
      remainingMs: totalDurationMs
    };
  }

  function stageIndex(id) {
    for (var i = 0; i < HEIST_STAGES.length; i += 1) {
      if (HEIST_STAGES[i].id === id) return i;
    }
    return 0;
  }

  // Stage for a crime's current window. Only stages from crime.stageFloor onward are used, with
  // their shares renormalised, so an escalated crime runs Escape -> Cold instead of restarting.
  function getHeistStage(crime) {
    if (!crime) return HEIST_STAGES[0];
    var cold = HEIST_STAGES[HEIST_STAGES.length - 1];

    if (crime.status === "resolved") {
      var outcome = crime.resolution && crime.resolution.outcome;
      return {
        id: "cold",
        label: outcome === "escaped" ? "Cold (Got Away)" : "Cold (Case Closed)",
        clueClarity: "fading",
        summaryHint: outcome === "escaped" ? "Suspect slipped away" : "Mystery wrapped up"
      };
    }
    if (crime.status === "cold") return cold;

    var total = Number(crime.durationMs) || 0;
    var rem = Number(crime.remainingMs);
    var range = HEIST_STAGES.slice(stageIndex(crime.stageFloor));
    if (total <= 0 || !isFinite(rem)) return range[0];
    if (rem <= 0) return cold;

    var shareSum = range.reduce(function (sum, s) { return sum + (s.share || 0); }, 0) || 1;
    var elapsedRatio = Math.min(1, Math.max(0, (total - rem) / total));
    var cursor = 0;
    for (var i = 0; i < range.length; i += 1) {
      cursor += (range[i].share || 0) / shareSum;
      if (elapsedRatio < cursor || i === range.length - 1) return range[i];
    }
    return cold;
  }

  function escalateCrime(crime, random) {
    crime.thwartDurationMs = crime.durationMs;
    crime.status = "escalated";
    crime.mode = "recovery";
    crime.stageFloor = "escape";
    crime.durationMs = DEFAULT_RECOVERY_HOURS * HOUR_MS;
    crime.remainingMs = DEFAULT_RECOVERY_HOURS * HOUR_MS;
    crime.summaryAction = "finished the sneaky move before we could stop it";
    crime.observableClues.push({
      tag: "escalated",
      text: pick([
        "Too late! Whatever was planned already happened.",
        "Time ran out and they slipped away with the goods."
      ], random)
    });
  }

  function coolCrime(crime, random) {
    crime.status = "cold";
    crime.remainingMs = 0;
    crime.observableClues.push({
      tag: "cold",
      text: pick([
        "The trail has gone cold. Nobody has seen anything new in a long while.",
        "Footprints faded and the lights went out. The trail is quiet now."
      ], random)
    });
  }

  function advanceCrime(crime, elapsedMs, rng) {
    var random = typeof rng === "function" ? rng : Math.random;
    var dt = typeof elapsedMs === "number" ? Math.max(0, elapsedMs) : HOUR_MS;
    if (!crime || !dt) return crime;
    // Only open and escalated crimes tick. Cold and resolved ones are finished.
    if (crime.status !== "open" && crime.status !== "escalated") return crime;
    if (!isFinite(Number(crime.remainingMs))) return crime;
    if (!Array.isArray(crime.observableClues)) crime.observableClues = [];

    // Spend the elapsed time window by window, so a big step carries its leftover time through
    // thwart -> escalated -> cold instead of losing it at the boundary.
    var budget = dt;
    for (var guard = 0; guard < 4 && budget >= 0; guard += 1) {
      var rem = Number(crime.remainingMs);
      if (budget < rem) {
        crime.remainingMs = rem - budget;
        break;
      }
      budget -= rem;
      crime.remainingMs = 0;
      if (crime.status === "open" && crime.mode === "thwart") {
        escalateCrime(crime, random);
      } else {
        coolCrime(crime, random);
        break;
      }
    }

    return crime;
  }

  // Close a crime. outcome: "caught" | "escaped" | "closed". Safe to call twice.
  function resolveCrime(crime, outcome) {
    if (!crime || crime.status === "resolved") return crime;
    crime.resolution = { outcome: outcome || "closed", fromStatus: crime.status };
    crime.status = "resolved";
    return crime;
  }

  // Resolve every unresolved crime linked to a suspect. Returns the crimes that were closed.
  function resolveCrimesForSuspect(crimes, suspectId, outcome) {
    if (!Array.isArray(crimes) || !suspectId) return [];
    var closed = [];
    crimes.forEach(function (c) {
      if (c && c.suspectId === suspectId && c.status !== "resolved") {
        resolveCrime(c, outcome);
        closed.push(c);
      }
    });
    return closed;
  }

  function advanceAllCrimes(crimes, elapsedMs, rng) {
    if (!Array.isArray(crimes)) return [];
    return crimes.map(function (c) {
      return advanceCrime(c, elapsedMs, rng);
    });
  }

  global.CrimeEngine = {
    HOUR_MS: HOUR_MS,
    HEIST_STAGES: HEIST_STAGES,
    getHeistStage: getHeistStage,
    resolveCrime: resolveCrime,
    resolveCrimesForSuspect: resolveCrimesForSuspect,
    DEFAULT_CRIME_TYPES: DEFAULT_CRIME_TYPES,
    TACTIC_CLUES: TACTIC_CLUES,
    CONFLICTING_TAGS: CONFLICTING_TAGS,
    NON_SYNDICATE_PROFILES: NON_SYNDICATE_PROFILES,
    createCrime: createCrime,
    advanceCrime: advanceCrime,
    advanceAllCrimes: advanceAllCrimes
  };
})(typeof window !== "undefined" ? window : globalThis);