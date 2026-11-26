(function (global) {
  "use strict";

  var HOUR_MS = 60 * 60 * 1000;

  // Numeric rank levels come from js/ma-config.js (single source of truth).
  // Fallback matches it so standalone test pages that skip that script keep working.
  var RL = (global.MidnightAgencyConfig && global.MidnightAgencyConfig.RANK_LEVELS) ||
    { ROOKIE: 1, OPERATIVE: 2, FIELD_AGENT: 3 };

  var TRAVEL_MODES = {
    transit: {
      id: "transit",
      label: "Local Bus / Ferry",
      minRank: RL.ROOKIE,
      speedKmh: 45,
      costPerHour: 15,
      requiresHub: false,
      summary: "Local buses and coastal/harbor ferries. Cheap and easy nearby, slow over big distances."
    },
    road: {
      id: "road",
      label: "Car / Road Trip",
      minRank: RL.ROOKIE,
      speedKmh: 75,
      costPerHour: 25,
      requiresHub: false,
      summary: "Flexible on connected land and great for reaching stations or hubs—never crosses oceans."
    },
    ferry: {
      id: "ferry",
      label: "Ferry",
      minRank: RL.ROOKIE,
      speedKmh: 35,
      costPerHour: 20,
      requiresHub: false,
      summary: "Harbor and strait ferries between port cities. Slow and scenic."
    },
    rail: {
      id: "rail",
      label: "Passenger Train",
      minRank: RL.ROOKIE,
      speedKmh: 115,
      costPerHour: 30,
      requiresHub: false,
      summary: "Steady train lines between connected stations on land."
    },
    flight: {
      id: "flight",
      label: "Commercial Flight",
      minRank: RL.OPERATIVE,
      speedKmh: 640,
      costPerHour: 95,
      requiresHub: true,
      summary: "Fast across oceans and continents, flying between major airport hubs."
    },
    charter: {
      id: "charter",
      label: "Charter / Covert Hop",
      minRank: RL.FIELD_AGENT,
      speedKmh: 500,
      costPerHour: 175,
      requiresHub: false,
      summary: "High-rank splurge: faster, more direct hops when time is tight."
    }
  };

  var PLACES = [
    {
      id: "winnipeg",
      city: "Winnipeg",
      country: "Canada",
      iso2: "CA",
      region: "Americas",
      landmass: "north-america",
      isHub: true,
      modes: ["transit", "road", "rail", "flight", "charter"],
      map: { x: 20, y: 31 },
      note: "Prairie rail and road junction with big skies and busy train yards."
    },
    {
      id: "thunder-bay",
      city: "Thunder Bay",
      country: "Canada",
      iso2: "CA",
      region: "Americas",
      landmass: "north-america",
      isHub: false,
      modes: ["transit", "road", "rail", "charter"],
      map: { x: 23, y: 31 },
      note: "Lake Superior port and rail stop—great for overland trips or charter splurges."
    },
    {
      id: "toronto",
      city: "Toronto",
      country: "Canada",
      iso2: "CA",
      region: "Americas",
      landmass: "north-america",
      isHub: true,
      modes: ["transit", "road", "rail", "flight", "charter"],
      map: { x: 26, y: 34 },
      note: "Major Canadian rail and flight hub linking North America with overseas routes."
    },
    {
      id: "new-york",
      city: "New York",
      country: "United States",
      iso2: "US",
      region: "Americas",
      landmass: "north-america",
      isHub: true,
      modes: ["transit", "road", "rail", "flight", "charter"],
      map: { x: 28, y: 36 },
      note: "Bustling coastal hub with heavy rail, harbor ferries, and international flights."
    },
    {
      id: "mexico-city",
      city: "Mexico City",
      country: "Mexico",
      iso2: "MX",
      region: "Americas",
      landmass: "north-america",
      isHub: true,
      modes: ["transit", "road", "rail", "flight", "charter"],
      map: { x: 21, y: 47 },
      note: "High-altitude capital and major Americas transit hub."
    },
    {
      id: "santiago",
      city: "Santiago",
      country: "Chile",
      iso2: "CL",
      region: "Americas",
      landmass: "south-america",
      isHub: true,
      modes: ["transit", "road", "rail", "flight", "charter"],
      map: { x: 29, y: 74 },
      note: "Nestled near the Andes in South America—requires flights or charters to cross from North America."
    },
    {
      id: "reykjavik",
      city: "Reykjavik",
      country: "Iceland",
      iso2: "IS",
      region: "Europe",
      landmass: "iceland",
      isHub: true,
      modes: ["transit", "road", "flight", "charter"],
      map: { x: 44, y: 22 },
      note: "North Atlantic island city—no outside roads or trains, so air routes are essential."
    },
    {
      id: "dublin",
      city: "Dublin",
      country: "Ireland",
      iso2: "IE",
      region: "Europe",
      landmass: "uk-ireland",
      isHub: true,
      modes: ["transit", "road", "rail", "ferry", "flight", "charter"],
      map: { x: 48, y: 29 },
      note: "Harbor and rail city on the Irish coast with ferry and flight links."
    },
    {
      id: "london",
      city: "London",
      country: "United Kingdom",
      iso2: "GB",
      region: "Europe",
      landmass: "uk-ireland",
      isHub: true,
      modes: ["transit", "road", "rail", "ferry", "flight", "charter"],
      map: { x: 50, y: 30 },
      note: "Major European hub with rail, ferry crossings, and worldwide flights."
    },
    {
      id: "oslo",
      city: "Oslo",
      country: "Norway",
      iso2: "NO",
      region: "Europe",
      landmass: "europe-mainland",
      isHub: true,
      modes: ["transit", "road", "rail", "ferry", "flight", "charter"],
      map: { x: 53, y: 24 },
      note: "Fjord-side Scandinavian hub with rail, ferry, and flight connections."
    },
    {
      id: "gothenburg",
      city: "Gothenburg",
      country: "Sweden",
      iso2: "SE",
      region: "Europe",
      landmass: "europe-mainland",
      isHub: false,
      modes: ["transit", "road", "rail", "ferry", "charter"],
      map: { x: 54, y: 26 },
      note: "West-coast Swedish port and rail stop—easy by train or car from Oslo, or fly via a major hub."
    },
    {
      id: "warsaw",
      city: "Warsaw",
      country: "Poland",
      iso2: "PL",
      region: "Europe",
      landmass: "europe-mainland",
      isHub: true,
      modes: ["transit", "road", "rail", "flight", "charter"],
      map: { x: 56, y: 30 },
      note: "Central European rail and flight crossroads."
    },
    {
      id: "dakar",
      city: "Dakar",
      country: "Senegal",
      iso2: "SN",
      region: "Africa",
      landmass: "africa-mainland",
      isHub: true,
      modes: ["transit", "road", "ferry", "flight", "charter"],
      map: { x: 44, y: 51 },
      note: "Westernmost coastal city on mainland Africa with port and flight links."
    },
    {
      id: "lagos",
      city: "Lagos",
      country: "Nigeria",
      iso2: "NG",
      region: "Africa",
      landmass: "africa-mainland",
      isHub: true,
      modes: ["transit", "road", "ferry", "flight", "charter"],
      map: { x: 51, y: 54 },
      note: "Busy West African port and air hub with lively docks and markets."
    },
    {
      id: "osaka",
      city: "Osaka",
      country: "Japan",
      iso2: "JP",
      region: "Asia",
      landmass: "japan",
      isHub: true,
      modes: ["transit", "road", "rail", "ferry", "flight", "charter"],
      map: { x: 83, y: 40 },
      note: "Japanese bay city famous for fast trains, canals, and busy hubs—separated by sea from the mainland."
    },
    {
      id: "tokyo",
      city: "Tokyo",
      country: "Japan",
      iso2: "JP",
      region: "Asia",
      landmass: "japan",
      isHub: true,
      modes: ["transit", "road", "rail", "ferry", "flight", "charter"],
      map: { x: 85, y: 39 },
      note: "Giant bay city where sleek trains, neon signs and tiny quiet shrines all share the same blocks."
    },
    {
      id: "mumbai",
      city: "Mumbai",
      country: "India",
      iso2: "IN",
      region: "Asia",
      landmass: "south-asia",
      isHub: true,
      modes: ["transit", "road", "rail", "ferry", "flight", "charter"],
      map: { x: 68, y: 47 },
      note: "Busy Arabian Sea port with commuter trains, harbor ferries and markets that never really close."
    },
    {
      id: "beirut",
      city: "Beirut",
      country: "Lebanon",
      iso2: "LB",
      region: "Asia",
      subregion: "Mediterranean",
      landmass: "middle-east",
      isHub: true,
      modes: ["transit", "road", "ferry", "flight", "charter"],
      map: { x: 59, y: 40 },
      note: "Mediterranean harbor city backed by mountains, with old seaside promenades and late-night cafes."
    },
    {
      id: "buenos-aires",
      city: "Buenos Aires",
      country: "Argentina",
      iso2: "AR",
      region: "Americas",
      landmass: "south-america",
      isHub: true,
      modes: ["transit", "road", "rail", "ferry", "flight", "charter"],
      map: { x: 32, y: 75 },
      note: "Wide-avenue port city on a huge muddy river, famous for tango, trains and big bookshops."
    },
    {
      id: "duluth",
      city: "Duluth",
      country: "United States",
      iso2: "US",
      region: "Americas",
      landmass: "north-america",
      isHub: false,
      modes: ["transit", "road", "rail", "charter"],
      map: { x: 22, y: 33 },
      note: "Hilly lake-harbor town on Lake Superior where giant ore ships slide under a lift bridge."
    },
    {
      id: "anchorage",
      city: "Anchorage",
      country: "United States",
      iso2: "US",
      region: "Americas",
      landmass: "north-america",
      isHub: true,
      modes: ["transit", "road", "flight", "charter"],
      map: { x: 12, y: 21 },
      note: "Far-north city ringed by snowy peaks, where bush planes are as common as pickup trucks."
    }
  ];

  function stripDiacritics(str) {
    var s = String(str);
    return s.normalize ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : s;
  }

  // Canonical place id: lowercase ascii kebab-case city slug ("Buenos Aires" -> "buenos-aires").
  function slugifyPlace(str) {
    return stripDiacritics(str).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function findPlace(query) {
    if (!query) return null;
    if (typeof query === "object") {
      query = query.placeId || query.id || query.city;
      if (!query) return null;
    }
    var q = String(query).trim().toLowerCase();
    var slug = slugifyPlace(q);
    return PLACES.find(function (p) {
      return p.id === q || p.id === slug || p.city.toLowerCase() === q || slugifyPlace(p.city) === slug;
    }) || null;
  }

  // Country-level join (data/countries/<iso2 lowercase>.json, factbook-index.json, dashboard `code`).
  function placesByIso2(iso2) {
    var code = String(iso2 || "").toUpperCase();
    return PLACES.filter(function (p) { return p.iso2 === code; });
  }

  function countryFileUrl(placeOrIso2) {
    var code = typeof placeOrIso2 === "object" && placeOrIso2
      ? placeOrIso2.iso2
      : placeOrIso2;
    return code ? "data/countries/" + String(code).toLowerCase() + ".json" : null;
  }

  function pickPlace(opts, rng) {
    var random = typeof rng === "function" ? rng : Math.random;
    var options = opts || {};
    var pool = PLACES.slice();

    if (options.region) {
      var byRegion = pool.filter(function (p) { return p.region === options.region; });
      if (byRegion.length) pool = byRegion;
    }
    if (options.landmass) {
      var byLand = pool.filter(function (p) { return p.landmass === options.landmass; });
      if (byLand.length) pool = byLand;
    }
    if (options.excludeIds && Array.isArray(options.excludeIds)) {
      var filtered = pool.filter(function (p) { return options.excludeIds.indexOf(p.id) === -1; });
      if (filtered.length) pool = filtered;
    }

    return pool[Math.floor(random() * pool.length)] || PLACES[0];
  }

  function formatDurationMs(ms) {
    var safeMs = Math.max(0, Number(ms) || 0);
    var totalMinutes = Math.round(safeMs / (60 * 1000));
    if (totalMinutes <= 0) return "0m";
    var days = Math.floor(totalMinutes / (24 * 60));
    var remAfterDays = totalMinutes % (24 * 60);
    var hours = Math.floor(remAfterDays / 60);
    var mins = remAfterDays % 60;

    var parts = [];
    if (days > 0) parts.push(days + "d");
    if (hours > 0) parts.push(hours + "h");
    if (mins > 0 && days === 0) parts.push(mins + "m");
    return parts.join(" ") || "0m";
  }

  function estimateHours(fromPlace, toPlace, modeId) {
    var mode = TRAVEL_MODES[modeId] || TRAVEL_MODES.road;
    var dx = (toPlace.map.x - fromPlace.map.x) * 1.35;
    var dy = (toPlace.map.y - fromPlace.map.y) * 1.45;
    var units = Math.sqrt(dx * dx + dy * dy);
    var scale = modeId === "flight" ? 0.14 : modeId === "charter" ? 0.16 : 0.36;
    var boardingHours = modeId === "flight" ? 2 : modeId === "charter" ? 1 : 0.5;
    var raw = units * scale + boardingHours;
    return Math.max(1, Math.round(raw * 2) / 2);
  }

  function makeLeg(fromPlace, toPlace, modeId, rank) {
    var mode = TRAVEL_MODES[modeId];
    var hours = estimateHours(fromPlace, toPlace, modeId);
    var cost = Math.round((hours * mode.costPerHour) / 5) * 5;
    return {
      fromId: fromPlace.id,
      toId: toPlace.id,
      fromCity: fromPlace.city,
      toCity: toPlace.city,
      modeId: mode.id,
      modeLabel: mode.label,
      hours: hours,
      durationMs: Math.round(hours * HOUR_MS),
      cost: cost,
      unlocked: rank >= mode.minRank,
      requiredRank: mode.minRank
    };
  }

  function planRoute(fromQuery, toQuery, options) {
    var opts = options || {};
    // opts.rank may be a numeric level (1-3) or a rank name ("Operative"); names go through the
    // shared helper so a string can never silently fall back to Rookie.
    var MAC = global.MidnightAgencyConfig;
    var rank = typeof opts.rank === "string" && MAC && MAC.rankLevel
      ? MAC.rankLevel(opts.rank)
      : (Number(opts.rank) || RL.ROOKIE);
    var fromPlace = findPlace(fromQuery);
    var toPlace = findPlace(toQuery);

    if (!fromPlace || !toPlace) {
      return { error: "Unknown city", routes: [] };
    }

    if (fromPlace.id === toPlace.id) {
      return {
        from: fromPlace,
        to: toPlace,
        routes: [{
          id: "local",
          label: "Already Here",
          legs: [],
          totalHours: 0,
          totalDurationMs: 0,
          totalCost: 0,
          unlocked: true,
          requiresHubTransfer: false
        }]
      };
    }

    var sameLandmass = fromPlace.landmass === toPlace.landmass;
    var routes = [];

    if (sameLandmass) {
      ["rail", "road", "transit", "ferry"].forEach(function (modeId) {
        if (fromPlace.modes.indexOf(modeId) !== -1 && toPlace.modes.indexOf(modeId) !== -1) {
          var leg = makeLeg(fromPlace, toPlace, modeId, rank);
          routes.push({
            id: "direct-" + modeId,
            label: leg.modeLabel + " (Direct)",
            legs: [leg],
            totalHours: leg.hours,
            totalDurationMs: leg.durationMs,
            totalCost: leg.cost,
            unlocked: leg.unlocked,
            requiresHubTransfer: false
          });
        }
      });
    }

    var depHub = (fromPlace.isHub && fromPlace.modes.indexOf("flight") !== -1)
      ? fromPlace
      : PLACES.find(function (p) {
          return p.landmass === fromPlace.landmass && p.isHub && p.modes.indexOf("flight") !== -1;
        });

    var arrHub = (toPlace.isHub && toPlace.modes.indexOf("flight") !== -1)
      ? toPlace
      : PLACES.find(function (p) {
          return p.landmass === toPlace.landmass && p.isHub && p.modes.indexOf("flight") !== -1;
        });

    if (depHub && arrHub && depHub.id !== arrHub.id) {
      var legs = [];
      if (fromPlace.id !== depHub.id) {
        var preMode = (fromPlace.modes.indexOf("rail") !== -1 && depHub.modes.indexOf("rail") !== -1)
          ? "rail"
          : "road";
        legs.push(makeLeg(fromPlace, depHub, preMode, rank));
      }
      legs.push(makeLeg(depHub, arrHub, "flight", rank));
      if (arrHub.id !== toPlace.id) {
        var postMode = (arrHub.modes.indexOf("rail") !== -1 && toPlace.modes.indexOf("rail") !== -1)
          ? "rail"
          : "road";
        legs.push(makeLeg(arrHub, toPlace, postMode, rank));
      }

      var totalHours = legs.reduce(function (sum, l) { return sum + l.hours; }, 0);
      routes.push({
        id: "flight-" + depHub.id + "-" + arrHub.id,
        label: legs.length > 1
          ? "Flight (" + depHub.city + " -> " + arrHub.city + ", " + legs.length + " legs)"
          : "Commercial Flight (Direct Hub)",
        legs: legs,
        totalHours: totalHours,
        totalDurationMs: Math.round(totalHours * HOUR_MS),
        totalCost: legs.reduce(function (sum, l) { return sum + l.cost; }, 0),
        unlocked: legs.every(function (l) { return l.unlocked; }),
        requiresHubTransfer: legs.length > 1
      });
    }

    if (fromPlace.modes.indexOf("charter") !== -1 && toPlace.modes.indexOf("charter") !== -1) {
      var charterLeg = makeLeg(fromPlace, toPlace, "charter", rank);
      routes.push({
        id: "charter-direct",
        label: "Charter Hop (Direct Splurge)",
        legs: [charterLeg],
        totalHours: charterLeg.hours,
        totalDurationMs: charterLeg.durationMs,
        totalCost: charterLeg.cost,
        unlocked: charterLeg.unlocked,
        requiresHubTransfer: false
      });
    }

    routes.sort(function (a, b) {
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      return a.totalHours - b.totalHours;
    });

    return {
      from: fromPlace,
      to: toPlace,
      routes: routes
    };
  }

  global.WorldFactbook = {
    HOUR_MS: HOUR_MS,
    TRAVEL_MODES: TRAVEL_MODES,
    PLACES: PLACES,
    findPlace: findPlace,
    slugifyPlace: slugifyPlace,
    placesByIso2: placesByIso2,
    countryFileUrl: countryFileUrl,
    pickPlace: pickPlace,
    formatDurationMs: formatDurationMs,
    planRoute: planRoute
  };
})(typeof window !== "undefined" ? window : globalThis);