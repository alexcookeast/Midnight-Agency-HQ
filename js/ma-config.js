/*
 * Midnight Agency shared config + rank contract (single source of truth).
 *
 * Loaded with a plain <script src> on: index.html, midnight-agency-passcode.html,
 * player-dashboard.html, gm-suite/midnight-agency-backend.html (and any test page).
 * No build step, no ES modules, works offline from file:// or a local server.
 *
 * Storage keys
 *   midnight_agency_config_v1    -> game/GM config (this module owns read/write)
 *   midnight_agency_settings_v1  -> device settings (performanceMode), owned by factbook-loader.js
 *   midnight_agency_gate_v1      -> sessionStorage only: "passcode gate passed" marker
 *
 * Rank contract (7-tier progression paced across multi-case syndicate arcs)
 *   stars >= 27 -> Spymaster       (level 7, legacyTier 3)
 *   stars >= 20 -> Agent           (level 6, legacyTier 3)
 *   stars >= 14 -> Specialist      (level 5, legacyTier 3)
 *   stars >= 9  -> Operative       (level 4, legacyTier 2)
 *   stars >= 5  -> Junior Analyst  (level 3, legacyTier 2)
 *   stars >= 2  -> Rookie          (level 2, legacyTier 1)
 *   else        -> Recruit         (level 1, legacyTier 1)
 *   A rank also needs a floor of solved cases (minSolved 0/1/3/5/8/12/16) so stars alone cannot
 *   skip the ladder. rank = highest tier where stars >= minStars AND solved >= minSolved.
 *   player.rank in storage is only a cached copy of the derived rank; stars always win.
 *   The numeric level (1..7) tracks full rank progression; legacyRankTier (1..3) maps onto
 *   3-tier rule buckets where needed.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'midnight_agency_config_v1';
  var SETTINGS_KEY = 'midnight_agency_settings_v1';
  var GATE_KEY = 'midnight_agency_gate_v1';
  var EVENT_NAME = 'ma:config-updated';

  var GATE_URL = './midnight-agency-passcode.html';
  var DASHBOARD_URL = './player-dashboard.html';

  // Ordered low -> high. minStars is the promotion threshold.
  var RANKS = [
    { name: 'Recruit',        level: 1, legacyTier: 1, minStars: 0, minSolved: 0,  codenameUnlocked: false },
    { name: 'Rookie',         level: 2, legacyTier: 1, minStars: 2, minSolved: 1,  codenameUnlocked: false },
    { name: 'Junior Analyst', level: 3, legacyTier: 2, minStars: 5, minSolved: 3,  codenameUnlocked: true  },
    { name: 'Operative',      level: 4, legacyTier: 2, minStars: 9, minSolved: 5,  codenameUnlocked: true  },
    { name: 'Specialist',     level: 5, legacyTier: 3, minStars: 14, minSolved: 8, codenameUnlocked: true  },
    { name: 'Agent',          level: 6, legacyTier: 3, minStars: 20, minSolved: 12, codenameUnlocked: true  },
    { name: 'Spymaster',      level: 7, legacyTier: 3, minStars: 27, minSolved: 16, codenameUnlocked: true  }
  ];

  var RANK_LEVELS = {
    RECRUIT: 1,
    ROOKIE: 2,
    JUNIOR_ANALYST: 3,
    OPERATIVE: 4,
    SPECIALIST: 5,
    AGENT: 6,
    SPYMASTER: 7
  };

  function rankByName(name) {
    for (var i = 0; i < RANKS.length; i++) {
      if (RANKS[i].name === name) return RANKS[i];
    }
    return RANKS[0];
  }

  function rankFromStars(stars) {
    var n = Number(stars);
    if (!isFinite(n) || n < 0) n = 0;
    var found = RANKS[0];
    for (var i = 0; i < RANKS.length; i++) {
      if (n >= RANKS[i].minStars) found = RANKS[i];
    }
    return found.name;
  }

  // Stars AND solved cases must both clear a tier's floor.
  function rankFromProgress(stars, solved) {
    var n = Number(stars); if (!isFinite(n) || n < 0) n = 0;
    var m = Number(solved); if (!isFinite(m) || m < 0) m = 0;
    var found = RANKS[0];
    for (var i = 0; i < RANKS.length; i++) {
      if (n >= RANKS[i].minStars && m >= RANKS[i].minSolved) found = RANKS[i];
    }
    return found.name;
  }

  // Accepts a config object, a rank name, or a star count.
  function rankMeta(input) {
    if (typeof input === 'number') return rankByName(rankFromStars(input));
    if (typeof input === 'string') return rankByName(input);
    if (input && input.player) return rankByName(effectiveRank(input));
    return RANKS[0];
  }

  // Returns 1..7 for the full 7-tier progression ladder.
  function rankLevel(input) {
    return rankMeta(input).level;
  }

  // Returns 1..3 for engines/tables keyed to legacy 3-tier buckets.
  function legacyRankTier(input) {
    return rankMeta(input).legacyTier;
  }

  function starsForRank(name) {
    return rankByName(name).minStars;
  }

  function effectiveRank(cfg) {
    var pl = cfg && cfg.player;
    return rankFromProgress(pl && pl.stars, pl && pl.solved);
  }

  function isPromoted(cfg) {
    return rankLevel(cfg) > 1;
  }

  function canClaimCodename(cfgOrRank) {
    return !!rankMeta(cfgOrRank).codenameUnlocked;
  }

  // nextRankInfo(stars[, solved]) -> the next tier not yet earned, with what is still missing.
  function nextRankInfo(stars, solved) {
    var n = Math.max(0, Math.floor(Number(stars) || 0));
    var m = solved === undefined ? Infinity : Math.max(0, Math.floor(Number(solved) || 0));
    for (var i = 0; i < RANKS.length; i++) {
      if (n < RANKS[i].minStars || m < RANKS[i].minSolved) {
        return {
          name: RANKS[i].name,
          level: RANKS[i].level,
          minStars: RANKS[i].minStars,
          minSolved: RANKS[i].minSolved,
          starsRemaining: Math.max(0, RANKS[i].minStars - n),
          solvedRemaining: m === Infinity ? 0 : Math.max(0, RANKS[i].minSolved - m)
        };
      }
    }
    return null;
  }

  function defaultConfig() {
    return {
      gm: { userName: 'GM', passCode: 'MIDNIGHT-GM', clearanceKey: 'MIDNIGHT-GM' },
      player: { rank: 'Recruit', userName: '', passCode: '', stars: 0, solved: 0, trust: 5 },
      passcodeToppings: ['pickles', 'olives', 'mushrooms'],
      secretPhrase: 'pickles, olives, and mushrooms',
      gateUrl: GATE_URL,
      npcs: {},
      christmasEnabled: true,
      snowDensity: 45,
      snowSpeed: 1.0,
      // 'mission' = scaled clock (kid friendly), 'real' = true travel times. GM Suite toggles it.
      timeMode: 'mission',
      missionScale: 0.35
    };
  }

  function clampNumber(v, lo, hi, fallback) {
    var n = Number(v);
    if (typeof v === 'undefined' || v === null || !isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }

  // Merge stored JSON over defaults, migrate legacy keys, normalise derived fields.
  function normalize(parsed) {
    var base = defaultConfig();
    var p = parsed && typeof parsed === 'object' ? parsed : {};
    var cfg = Object.assign({}, base, p, {
      gm: Object.assign({}, base.gm, p.gm),
      player: Object.assign({}, base.player, p.player),
      npcs: Object.assign({}, base.npcs, p.npcs)
    });

    // Legacy: "dashboardUrl" was really the passcode gate URL (and sometimes pointed at the
    // dashboard itself, which would skip the gate). Read it once, then drop it.
    if (!p.gateUrl && p.dashboardUrl && p.dashboardUrl !== DASHBOARD_URL) {
      cfg.gateUrl = p.dashboardUrl;
    }
    if (!cfg.gateUrl || cfg.gateUrl === DASHBOARD_URL) cfg.gateUrl = GATE_URL;
    delete cfg.dashboardUrl;

    // Legacy snowLevel string -> numeric density.
    if (typeof p.snowDensity !== 'number' || isNaN(p.snowDensity)) {
      var map = { off: 0, light: 20, medium: 45, heavy: 85 };
      cfg.snowDensity = map.hasOwnProperty(p.snowLevel) ? map[p.snowLevel] : base.snowDensity;
    }
    cfg.snowDensity = clampNumber(cfg.snowDensity, 0, 100, base.snowDensity);
    cfg.snowSpeed = clampNumber(cfg.snowSpeed, 0.2, 4.0, base.snowSpeed);

    cfg.player.stars = Math.max(0, Math.floor(Number(cfg.player.stars) || 0));
    if (typeof (p.player && p.player.solved) === 'undefined') {
      // Grandfather existing saves: assume they solved what their stars imply.
      cfg.player.solved = rankByName(rankFromStars(cfg.player.stars)).minSolved;
    }
    cfg.player.solved = Math.max(0, Math.floor(Number(cfg.player.solved) || 0));
    cfg.timeMode = cfg.timeMode === 'real' ? 'real' : 'mission';
    cfg.missionScale = clampNumber(cfg.missionScale, 0.05, 1, 0.35);
    cfg.player.trust = Math.round(clampNumber(cfg.player.trust, 0, 5, 5)); // agency trust, 0-5 dots
    cfg.player.rank = rankFromProgress(cfg.player.stars, cfg.player.solved); // cache always matches stars
    return cfg;
  }

  function read() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      return normalize(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return normalize(null);
    }
  }

  // Shallow merge of a patch into the *freshly re-read* stored config.
  // gm / player / npcs are merged one level deep. Always re-reads storage first, so a stale
  // tab can never overwrite fields it did not touch.
  function write(patch) {
    var cur = read();
    var p = patch || {};
    var next = Object.assign({}, cur, p, {
      gm: Object.assign({}, cur.gm, p.gm),
      player: Object.assign({}, cur.player, p.player),
      npcs: Object.assign({}, cur.npcs, p.npcs)
    });
    next = normalize(next);
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {}
    try {
      global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
    } catch (e) {}
    var ov = global.MidnightAgencyOverlay;
    if (ov && typeof ov.apply === 'function') {
      try { ov.apply(next); } catch (e) {}
    }
    return next;
  }

  // Player-only convenience. Stars are always re-read from storage inside write().
  function writePlayer(patch) {
    return write({ player: patch || {} });
  }

  // Atomic increment against the stored value (never a stale in-memory counter).
  function addStars(n) {
    var cur = read();
    var next = Math.max(0, (Number(cur.player.stars) || 0) + (Number(n) || 0));
    return write({ player: { stars: next } });
  }

  // Called once per solved case (WarrantEngine.completeCase).
  function recordCaseSolved() {
    var cur = read();
    return write({ player: { solved: (Number(cur.player.solved) || 0) + 1 } });
  }

  // Effective travel-time multiplier: 1 in real mode, else the mission scale. ?speed=N still stacks (engines).
  function timeScale(cfg) {
    var c = cfg || read();
    return c.timeMode === 'real' ? 1 : c.missionScale;
  }

  // Agency trust (0-5 dots), same read-then-write rule as stars.
  function addTrust(n) {
    var cur = read();
    return write({ player: { trust: (Number(cur.player.trust) || 0) + (Number(n) || 0) } });
  }

  // GM helper: write stars AND the solved floor so the derived rank equals the requested one.
  function gmSetRank(rankName) {
    var r = rankByName(rankName);
    var cur = read();
    var solved = Math.max(Number(cur.player.solved) || 0, r.minSolved);
    if (rankFromProgress(r.minStars, solved) !== r.name) solved = r.minSolved;
    var stars = rankFromProgress(cur.player.stars, solved) === r.name ? cur.player.stars : r.minStars;
    // Demotion: clamp solved down to the tier floor so the target rank is exactly what shows.
    if (rankLevel(rankFromProgress(stars, solved)) > r.level) solved = r.minSolved;
    return write({ player: { stars: stars, solved: solved } });
  }

  // GM helper: set stars so the derived rank equals the requested one.
  // Keeps existing stars if they already map to that rank; otherwise snaps to the rank's floor
  // (so the GM can demote as well as promote).
  function starsForGmRank(rankName, currentStars) {
    var want = rankByName(rankName).name;
    if (rankFromStars(currentStars) === want) return Math.max(0, Math.floor(Number(currentStars) || 0));
    return starsForRank(want);
  }

  // ---- Gate session marker ----
  function markGatePassed() {
    try { global.sessionStorage.setItem(GATE_KEY, '1'); } catch (e) {}
  }

  function clearGate() {
    try { global.sessionStorage.removeItem(GATE_KEY); } catch (e) {}
  }

  function devBypassRequested() {
    try {
      var q = new URLSearchParams(global.location.search);
      var v = q.get('dev') || q.get('bypass');
      return v === '1' || v === 'true';
    } catch (e) {
      return false;
    }
  }

  function isGatePassed() {
    if (devBypassRequested()) {
      try { global.sessionStorage.setItem(GATE_KEY, 'dev'); } catch (e) {}
      return true;
    }
    try { return !!global.sessionStorage.getItem(GATE_KEY); } catch (e) { return false; }
  }

  // Call at the top of a protected page. Redirects to the gate when not passed.
  // Returns true if the page may continue.
  function requireGate(gateUrl) {
    if (isGatePassed()) return true;
    var target = gateUrl || read().gateUrl || GATE_URL;
    try { global.location.replace(target); } catch (e) { global.location.href = target; }
    return false;
  }

  global.MidnightAgencyConfig = {
    STORAGE_KEY: STORAGE_KEY,
    SETTINGS_KEY: SETTINGS_KEY,
    GATE_KEY: GATE_KEY,
    EVENT_NAME: EVENT_NAME,
    GATE_URL: GATE_URL,
    DASHBOARD_URL: DASHBOARD_URL,
    RANKS: RANKS,
    RANK_LEVELS: RANK_LEVELS,
    rankFromStars: rankFromStars,
    rankFromProgress: rankFromProgress,
    recordCaseSolved: recordCaseSolved,
    gmSetRank: gmSetRank,
    timeScale: timeScale,
    rankMeta: rankMeta,
    rankLevel: rankLevel,
    legacyRankTier: legacyRankTier,
    starsForRank: starsForRank,
    starsForGmRank: starsForGmRank,
    effectiveRank: effectiveRank,
    isPromoted: isPromoted,
    canClaimCodename: canClaimCodename,
    nextRankInfo: nextRankInfo,
    defaultConfig: defaultConfig,
    normalize: normalize,
    read: read,
    write: write,
    writePlayer: writePlayer,
    addStars: addStars,
    addTrust: addTrust,
    markGatePassed: markGatePassed,
    clearGate: clearGate,
    isGatePassed: isGatePassed,
    requireGate: requireGate
  };
})(typeof window !== 'undefined' ? window : globalThis);