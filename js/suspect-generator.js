/**
 * Suspect & Hierarchy Generator Engine
 * Handles ethnicity-based name rolls, hyphenated surnames, nickname/mononym clues,
 * physical traits, facial hair, outfits & gear, lookahead staging, escape promotions,
 * and real-world place/transit state via WorldFactbook.
 */

const GENERATION_RULES = {
  maxActiveSuspects: 4,            // Small, manageable cast visible on the board
  maxTier1Operatives: 5,           // Hard cap on Tier 1 goons (active + staged)
  maxActiveRingsPerCase: 2,        // 1 primary ring + at most 1 cross-thread ring
  ringleaderTier: 4,               // Hard ceiling on promotions (1=Goon, 2=Captain, 3=Boss, 4=Big Boss)
  lookaheadTiers: 2,               // Pre-stage up to 2 tiers above a surfaced suspect (capped at ringleaderTier)
  minGoonsBeforeBossHint: 2,       // Catching/clearing a couple of low-tier leads unlocks boss clues
  recurringChance: 0.45,           // Chance to pull a recurring suspect when adding a lead
  freshSuspectChance: 0.55,        // Chance to generate a fresh suspect from pools
  nicknameChance: 0.40,            // Chance a generated suspect receives a nickname
  suspectCooldownCases: 2,         // Cooldown before the same suspect repeats
  crossRingThreadChance: 0.12,     // Chance of a "wrong boss / impending plot" cross-thread
  maxCrossRingThreadsPerCase: 1,   // Never more than one side-thread per case
  mononymLegendChance: 0.01,       // 1% chance for an absolute mononym legend
  promoteOnEscape: true,           // Escaping promotes tier up to ringleaderTier
  underlingsAddedOnPromotion: 2    // Spawns fresh Tier 1 recruits (respecting maxTier1Operatives)
};

const NAME_RULES = {
  hyphenatedSurnameChance: 0.09,
  partialHyphenClueChance: 0.45
};

const TIER_TITLES = {
  1: "Goon",
  2: "Captain",
  3: "Boss",
  4: "Big Boss"
};

const DEFAULT_STYLE_POOLS = {
  facialHair: [
    { category: "clean-shaven", clueText: "no facial hair" },
    { category: "stubble", clueText: "short chin stubble" },
    { category: "handlebar-mustache", clueText: "curly mustache" },
    { category: "walrus-mustache", clueText: "big bushy mustache" },
    { category: "goatee", clueText: "neat little chin beard" },
    { category: "full-beard", clueText: "full beard" }
  ],
  outfit: [
    { category: "trench-coat", clueText: "belted trench coat" },
    { category: "sailor-sweater", clueText: "cozy knit sweater" },
    { category: "tailored-suit", clueText: "sharp jacket" },
    { category: "winter-parka", clueText: "warm winter parka" },
    { category: "field-vest", clueText: "pockety vest" },
    { category: "rain-mac", clueText: "raincoat" }
  ],
  accoutrements: [
    { category: "brass-compass", clueText: "a shiny brass compass" },
    { category: "tin-of-mints", clueText: "a little tin of mints" },
    { category: "transit-pass-case", clueText: "a worn train pass" },
    { category: "folding-umbrella", clueText: "a small folding umbrella" },
    { category: "field-sketchbook", clueText: "a pocket notebook" },
    { category: "messenger-satchel", clueText: "a shoulder bag" },
    { category: "binoculars", clueText: "small binoculars" },
    { category: "pocket-watch", clueText: "a silver pocket watch" }
  ]
};

function pickRandom(arr, rng = Math.random) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(rng() * arr.length)];
}

function randomInt(min, max, rng = Math.random) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pickDistinct(list, count, rng = Math.random) {
  const copy = [...list];
  const picked = [];
  while (copy.length > 0 && picked.length < count) {
    const idx = Math.floor(rng() * copy.length);
    picked.push(copy.splice(idx, 1)[0]);
  }
  return picked;
}

function cloneObj(obj) {
  return typeof structuredClone === "function"
    ? structuredClone(obj)
    : JSON.parse(JSON.stringify(obj));
}

function resolveStartingPlace(options = {}, rng = Math.random) {
  const wf = typeof window !== "undefined" ? window.WorldFactbook : null;
  if (wf && typeof wf.findPlace === "function") {
    const explicit = wf.findPlace(
      options.currentPlaceId ||
        options.placeId ||
        options.currentCity ||
        options.city ||
        (options.origin && (options.origin.placeId || options.origin.city))
    );
    if (explicit) return explicit;

    if (typeof wf.pickPlace === "function") {
      const favRegions = Array.isArray(options.favoriteRegions) ? options.favoriteRegions : null;
      const pickedRegion = favRegions && favRegions.length ? pickRandom(favRegions, rng) : null;
      return wf.pickPlace({ region: pickedRegion }, rng);
    }
  }

  return {
    id: "winnipeg",
    city: options.currentCity || options.city || "Winnipeg",
    country: options.currentCountry || options.country || "Canada",
    region: options.currentRegion || options.region || "Americas",
    landmass: "north-america",
    isHub: true,
    modes: ["road", "rail"],
    map: { x: 20, y: 31 }
  };
}

function buildLastName(pool, rng = Math.random) {
  const lastNames = Array.isArray(pool?.lastNames) ? pool.lastNames : [];
  if (lastNames.length === 0) {
    return { lastName: "Unknown", surnameParts: ["Unknown"], isHyphenated: false };
  }

  const wantsHyphen = lastNames.length >= 2 && rng() < NAME_RULES.hyphenatedSurnameChance;
  if (wantsHyphen) {
    const [a, b] = pickDistinct(lastNames, 2, rng);
    const combined = `${a}-${b}`;
    return {
      lastName: combined,
      surnameParts: combined.split("-"),
      isHyphenated: true
    };
  }

  const single = lastNames[Math.floor(rng() * lastNames.length)];
  return {
    lastName: single,
    surnameParts: single.split("-"),
    isHyphenated: single.includes("-")
  };
}

function createSurnameClueFragment(suspect, rng = Math.random) {
  const fullLast = String(suspect?.lastName || "").trim();
  const parts = Array.isArray(suspect?.surnameParts) && suspect.surnameParts.length
    ? suspect.surnameParts
    : fullLast.split("-");
  const initial = fullLast ? fullLast.charAt(0).toUpperCase() : "";

  const templates = [];

  if (parts.length > 1 && rng() < NAME_RULES.partialHyphenClueChance) {
    const half = parts[Math.floor(rng() * parts.length)];
    templates.push(`a witness only caught part of a hyphenated last name—something like "${half}"`);
    templates.push(`a torn ticket only showed the "${half}" half of a hyphenated name`);
  }

  if (initial) {
    templates.push(`a lost luggage tag only had the initial "${initial}" for the last name`);
    templates.push(`a hurried note had the letter "${initial}" scratched next to a train time`);
  }

  if (fullLast) {
    templates.push(`a library slip left behind had the name "${fullLast}" stamped on it`);
    templates.push(`someone overheard a guard say "${fullLast}" right before the door clicked shut`);
  }

  return pickRandom(templates, rng) || "a witness caught a quick name at the scene";
}

function createIdentityClueFragment(suspect, rng = Math.random) {
  const options = [];
  const nick = suspect?.nickName || suspect?.nickname;

  if (nick) {
    options.push(`someone called out "${nick}" while rushing down the hall`);
    options.push(`a secret note was signed with just "${nick}"`);
    options.push(`two helpers whispered the nickname "${nick}" near the exit`);
  }

  if (suspect?.nameDisplayMode === "mononym") {
    options.push(`the boat pass only listed one name: "${suspect.firstName}"`);
    options.push(`nobody knew a last name—everyone just called them "${suspect.firstName}"`);
  } else {
    options.push(createSurnameClueFragment(suspect, rng));
  }

  return pickRandom(options, rng);
}

function formatSuspectName({
  firstName,
  lastName,
  nickName,
  forceMononym = false,
  mononymChance = GENERATION_RULES.mononymLegendChance,
  rng = Math.random
}) {
  const cleanFirst = String(firstName || "").trim();
  const cleanLast = String(lastName || "").trim();
  const cleanNick = nickName ? String(nickName).trim() : "";

  if (!cleanNick) {
    return {
      displayName: `${cleanFirst} ${cleanLast}`.trim(),
      nameDisplayMode: "standard"
    };
  }

  const hitMononym = forceMononym || rng() < mononymChance;
  if (hitMononym) {
    return {
      displayName: `${cleanNick} ${cleanFirst}`.trim(),
      nameDisplayMode: "mononym"
    };
  }

  return {
    displayName: `${cleanFirst} '${cleanNick}' ${cleanLast}`.trim(),
    nameDisplayMode: "nickname"
  };
}

function buildAccoutrements(pool, count = 2, rng = Math.random) {
  const source = Array.isArray(pool) && pool.length ? pool : DEFAULT_STYLE_POOLS.accoutrements;
  const copy = [...source];
  const picked = [];
  while (picked.length < count && copy.length > 0) {
    const idx = Math.floor(rng() * copy.length);
    picked.push(copy.splice(idx, 1)[0]);
  }
  return picked;
}

function pickUniqueNickname(pool, usedNicknames = new Set(), rng = Math.random) {
  if (!Array.isArray(pool?.nickNames) || pool.nickNames.length === 0) {
    return null;
  }
  const available = pool.nickNames.filter(
    (nick) => nick && !usedNicknames.has(String(nick).toLowerCase())
  );
  if (available.length === 0) return null;
  return pickRandom(available, rng);
}

const DEFAULT_TRAITS = [
  "Carries a folded train map in a coat pocket",
  "Always checks the clock before sneaking off"
];

const DEFAULT_CALL_STYLE = {
  habit: "Makes quick calls from payphones or lobby phones",
  clueTemplates: [
    "A quick phone call came from a {callingCode} line near {capitalName}."
  ]
};

// Pools in suspects.json split first names into female / male / neutral lists.
// Legacy single `firstNames` lists are still honoured if present.
function pickFirstName(pool, rng = Math.random) {
  const lists = [pool?.femaleFirstNames, pool?.maleFirstNames, pool?.neutralFirstNames]
    .filter((l) => Array.isArray(l) && l.length);
  if (!lists.length) {
    return pickRandom(pool?.firstNames, rng) || null;
  }
  // Pick a list first (so a long list doesn't swamp a short one), then a name.
  const list = pickRandom(lists, rng);
  return pickRandom(list, rng) || null;
}

// Prefer ethnicity pools the ring actually recruits from (recruitingRoots).
function pickEthnicityKey(pools, ring, requested, rng = Math.random) {
  if (requested && pools[requested]) return requested;
  const roots = Array.isArray(ring?.recruitingRoots)
    ? ring.recruitingRoots.filter((k) => pools[k])
    : [];
  if (roots.length) return pickRandom(roots, rng);
  return pickRandom(Object.keys(pools), rng);
}

function pickRingHub(ring, rng = Math.random) {
  const hubs = Array.isArray(ring?.homeHubs) ? ring.homeHubs : [];
  return pickRandom(hubs, rng) || null;
}

function createFreshSuspect(rosterData, options = {}) {
  const rng = options.rng || Math.random;
  const rules = { ...GENERATION_RULES, ...(options.rules || {}) };
  const usedNicknames = options.usedNicknames || new Set();
  const tier = Math.min(Math.max(Number(options.tier) || 1, 1), rules.ringleaderTier);

  const pools = rosterData.namePoolsByEthnicity || {};

  // Ring first, so its recruitingRoots can steer the ethnicity pool.
  const rings = Object.keys(rosterData.crimeRings || {});
  const ringId =
    options.ringId && rosterData.crimeRings?.[options.ringId]
      ? options.ringId
      : pickRandom(rings.length ? rings : ["night-shift"], rng);
  const ring = rosterData.crimeRings?.[ringId] || null;

  const ethnicityKey = pickEthnicityKey(pools, ring, options.ethnicity, rng);

  const namePool = pools[ethnicityKey] || {
    firstNames: ["Alex", "Sam", "Jordan", "Morgan"],
    lastNames: ["Vance", "Mercer", "Sterling", "Kerr"],
    nickNames: ["Shadow", "Cipher", "Fox"]
  };

  const firstName = pickFirstName(namePool, rng) || "Alex";
  const lastNameCandidates = (namePool.lastNames || []).filter((n) => n !== firstName);
  const { lastName, surnameParts, isHyphenated } = buildLastName(
    { ...namePool, lastNames: lastNameCandidates.length ? lastNameCandidates : namePool.lastNames },
    rng
  );

  const wantsNick =
    options.forceMononym || rng() < (options.nicknameChance ?? rules.nicknameChance);
  const nickName = wantsNick ? pickUniqueNickname(namePool, usedNicknames, rng) : null;

  const { displayName, nameDisplayMode } = formatSuspectName({
    firstName,
    lastName,
    nickName,
    forceMononym: Boolean(options.forceMononym),
    mononymChance: rules.mononymLegendChance,
    rng
  });

  const appPools = rosterData.appearancePools || {};
  const heightSpec = pickRandom(appPools.height, rng) || {
    category: "average",
    cmRange: [165, 178],
    clueText: "medium height"
  };
  const cm = Array.isArray(heightSpec.cmRange)
    ? randomInt(heightSpec.cmRange[0], heightSpec.cmRange[1], rng)
    : 172;

  const stylePools = rosterData.stylePools || DEFAULT_STYLE_POOLS;
  const facialHair = pickRandom(stylePools.facialHair || DEFAULT_STYLE_POOLS.facialHair, rng);
  const outfit = pickRandom(stylePools.outfit || DEFAULT_STYLE_POOLS.outfit, rng);
  const accoutrements = buildAccoutrements(
    stylePools.accoutrements || DEFAULT_STYLE_POOLS.accoutrements,
    tier >= 3 ? 2 : 1,
    rng
  );

  const isOutlier = options.isOutlier ?? (rng() < 0.08);
  const favoriteRegions = options.favoriteRegions || ["Europe", "Americas", "Asia", "Africa", "Oceania"];
  const originHub = options.origin || pickRingHub(ring, rng);
  const startPlace = resolveStartingPlace(
    { ...options, origin: originHub, favoriteRegions },
    rng
  );
  const origin = originHub
    ? { ...originHub, placeId: startPlace.id }
    : { city: startPlace.city, country: startPlace.country, region: startPlace.region, placeId: startPlace.id };

  const id = `${firstName}-${lastName}-${Date.now().toString(36)}-${randomInt(10, 99, rng)}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");

  return {
    id,
    ethnicity: ethnicityKey,
    firstName,
    lastName,
    surnameParts,
    isHyphenated,
    nickName,
    nickname: nickName,
    nameDisplayMode,
    displayName,
    ringId,
    origin,
    tier,
    rankTitle: TIER_TITLES[tier] || "Operative",
    superiorId: options.superiorId || null,
    recurring: false,
    isOutlier,
    status: "active",
    escapesCount: 0,
    currentPlaceId: startPlace.id,
    currentCity: startPlace.city,
    currentCountry: startPlace.country,
    currentRegion: startPlace.region,
    currentPlace: startPlace,
    travel: null,
    appearance: {
      height: { category: heightSpec.category, cm, clueText: heightSpec.clueText },
      weight: pickRandom(appPools.weight, rng) || { category: "medium", clueText: "average weight" },
      build: pickRandom(appPools.build, rng) || { category: "athletic", clueText: "athletic build" },
      complexion: pickRandom(appPools.complexion, rng) || { category: "olive", clueText: "olive complexion" },
      hairColor: pickRandom(appPools.hairColor, rng) || { category: "dark-brown", clueText: "dark brown hair" },
      hairStyle: pickRandom(appPools.hairStyle, rng) || { category: "short-cropped", clueText: "short-cropped hair" },
      eyeColor: pickRandom(appPools.eyeColor, rng) || { category: "brown", clueText: "dark brown eyes" },
      facialHair
    },
    wardrobe: {
      outfit,
      accoutrements
    },
    traits: DEFAULT_TRAITS.slice(),
    callStyle: cloneObj(DEFAULT_CALL_STYLE),
    favoriteRegions,
    history: {
      casesAppeared: 0,
      lastSeenIso2: null,
      notes: []
    }
  };
}

class SuspectEngine {
  constructor(rosterData, customRules = {}) {
    this.roster = rosterData;
    this.rules = { ...GENERATION_RULES, ...customRules };
    this.activeSuspects = [];
    this.stagedSuspects = [];
    this.retiredSuspects = [];
    this.cooldowns = new Map();
    this.caseCounter = 0;
    this.activeRings = [];
    this.crossRingBreadcrumbs = [];
  }

  getUsedNicknames() {
    const used = new Set();
    const all = [...this.activeSuspects, ...this.stagedSuspects, ...this.retiredSuspects];
    for (const s of all) {
      const nick = s?.nickName || s?.nickname;
      if (nick) used.add(String(nick).toLowerCase());
    }
    return used;
  }

  countTier1Total() {
    const activeT1 = this.activeSuspects.filter((s) => s.tier === 1).length;
    const stagedT1 = this.stagedSuspects.filter((s) => s.tier === 1).length;
    return activeT1 + stagedT1;
  }

  canAddTier1() {
    return this.countTier1Total() < this.rules.maxTier1Operatives;
  }

  normalizeSuspect(raw, tierOverride = null) {
    const s = cloneObj(raw);
    const tier = Math.min(
      Math.max(Number(tierOverride ?? s.tier ?? 1), 1),
      this.rules.ringleaderTier
    );
    const stylePools = this.roster.stylePools || DEFAULT_STYLE_POOLS;
    const place = resolveStartingPlace(s);

    s.tier = tier;
    s.rankTitle = TIER_TITLES[tier] || "Operative";
    s.superiorId = s.superiorId || null;
    s.status = s.status || "active";
    s.escapesCount = Number(s.escapesCount) || 0;
    s.nickname = s.nickName || s.nickname || null;
    s.nickName = s.nickname;
    s.surnameParts = Array.isArray(s.surnameParts) && s.surnameParts.length
      ? s.surnameParts
      : String(s.lastName || "").split("-");
    s.currentPlaceId = s.currentPlaceId || place.id;
    s.currentCity = s.currentCity || place.city;
    s.currentCountry = s.currentCountry || place.country;
    s.currentRegion = s.currentRegion || place.region;
    s.currentPlace = s.currentPlace || place;
    s.travel = s.travel || null;
    s.appearance = s.appearance || {};
    s.appearance.facialHair =
      s.appearance.facialHair || pickRandom(stylePools.facialHair || DEFAULT_STYLE_POOLS.facialHair);
    s.wardrobe = s.wardrobe || {
      outfit: pickRandom(stylePools.outfit || DEFAULT_STYLE_POOLS.outfit),
      accoutrements: buildAccoutrements(stylePools.accoutrements || DEFAULT_STYLE_POOLS.accoutrements, 1)
    };
    s.history = s.history || { casesAppeared: 0, lastSeenIso2: null, notes: [] };
    // Recurring records carry origin / traits / callStyle; keep them, and fill gaps for anyone else.
    s.origin = s.origin || {
      city: place.city,
      country: place.country,
      region: place.region,
      placeId: place.id
    };
    if (s.origin && !s.origin.placeId) s.origin.placeId = place.id;
    s.traits = Array.isArray(s.traits) && s.traits.length ? s.traits : DEFAULT_TRAITS.slice();
    s.callStyle = s.callStyle || cloneObj(DEFAULT_CALL_STYLE);
    return s;
  }

  advanceTime(elapsedMs) {
    const dt = Math.max(0, Number(elapsedMs) || 0);
    if (!dt) return [];

    const arrivals = [];
    const tracked = [...this.activeSuspects, ...this.stagedSuspects];

    for (const s of tracked) {
      if (!s.travel || typeof s.travel.remainingMs !== "number") continue;
      s.travel.remainingMs = Math.max(0, s.travel.remainingMs - dt);
      if (s.travel.remainingMs <= 0) {
        const destPlace = resolveStartingPlace({
          placeId: s.travel.toId,
          city: s.travel.toCity
        });
        s.currentPlaceId = destPlace.id;
        s.currentCity = destPlace.city;
        s.currentCountry = destPlace.country;
        s.currentRegion = destPlace.region;
        s.currentPlace = destPlace;
        arrivals.push({
          suspectId: s.id,
          displayName: s.displayName,
          toCity: destPlace.city,
          modeLabel: s.travel.modeLabel || "Transit"
        });
        s.travel = null;
      }
    }

    return arrivals;
  }

  pickRecurringCandidate(ringId, desiredTier) {
    const usedNicks = this.getUsedNicknames();
    const pool = (this.roster.recurringSuspects || []).filter((cand) => {
      if (this.cooldowns.has(cand.id)) return false;
      if (this.activeSuspects.some((a) => a.id === cand.id)) return false;
      if (this.stagedSuspects.some((st) => st.id === cand.id)) return false;
      if (ringId && cand.ringId && cand.ringId !== ringId && !cand.isOutlier) return false;
      const candNick = (cand.nickName || cand.nickname || "").toLowerCase();
      if (candNick && usedNicks.has(candNick)) return false;
      return true;
    });

    if (!pool.length) return null;

    const exactTier = pool.filter((c) => (c.tier || 2) === desiredTier);
    const chosen = pickRandom(exactTier.length ? exactTier : pool);
    const suspect = this.normalizeSuspect(chosen, desiredTier);

    if (suspect.nickName && suspect.nameDisplayMode !== "mononym" && Math.random() < this.rules.mononymLegendChance) {
      const rolled = formatSuspectName({
        firstName: suspect.firstName,
        lastName: suspect.lastName,
        nickName: suspect.nickName,
        forceMononym: true,
        mononymChance: this.rules.mononymLegendChance
      });
      suspect.displayName = rolled.displayName;
      suspect.nameDisplayMode = rolled.nameDisplayMode;
    }

    return suspect;
  }

  stageHierarchyAhead(subordinate, steps = this.rules.lookaheadTiers) {
    let currentSub = subordinate;
    const maxSteps = Math.max(1, Math.min(steps, this.rules.ringleaderTier - subordinate.tier));

    for (let step = 1; step <= maxSteps; step++) {
      const nextTier = Math.min(subordinate.tier + step, this.rules.ringleaderTier);
      if (nextTier <= currentSub.tier) break;

      const existingSuperior = this.stagedSuspects.find(
        (s) => s.id === currentSub.superiorId
      ) || this.activeSuspects.find(
        (s) => s.id === currentSub.superiorId
      );

      if (existingSuperior) {
        currentSub = existingSuperior;
        continue;
      }

      let superior = null;
      if (Math.random() < this.rules.recurringChance) {
        superior = this.pickRecurringCandidate(currentSub.ringId, nextTier);
      }

      if (!superior) {
        superior = createFreshSuspect(this.roster, {
          ringId: currentSub.ringId,
          tier: nextTier,
          rules: this.rules,
          usedNicknames: this.getUsedNicknames()
        });
      }

      currentSub.superiorId = superior.id;
      this.stagedSuspects.push(superior);
      currentSub = superior;
    }
  }

  addToActiveBoard(suspect) {
    if (suspect.tier === 1 && !this.canAddTier1()) {
      return null;
    }

    while (this.activeSuspects.length >= this.rules.maxActiveSuspects) {
      const removableIdx = this.activeSuspects.findIndex((s) => !s.isPrimaryTarget);
      if (removableIdx === -1) break;
      const [shelved] = this.activeSuspects.splice(removableIdx, 1);
      shelved.status = "shelved";
      this.stagedSuspects.push(shelved);
    }

    if (this.activeSuspects.length >= this.rules.maxActiveSuspects) {
      return null;
    }

    suspect.status = "active";
    suspect.history.casesAppeared += 1;
    this.activeSuspects.push(suspect);
    this.stageHierarchyAhead(suspect);
    return suspect;
  }

  startCase(primaryRingId) {
    this.caseCounter += 1;
    this.activeSuspects = [];
    this.crossRingBreadcrumbs = [];

    for (const [id, rem] of this.cooldowns.entries()) {
      if (rem <= 1) this.cooldowns.delete(id);
      else this.cooldowns.set(id, rem - 1);
    }

    const ringKeys = Object.keys(this.roster.crimeRings || {});
    const primaryRing =
      primaryRingId && this.roster.crimeRings?.[primaryRingId]
        ? primaryRingId
        : pickRandom(ringKeys) || "night-shift";

    this.activeRings = [primaryRing];

    const starterCount = Math.min(2, this.rules.maxActiveSuspects);
    for (let i = 0; i < starterCount; i++) {
      const desiredTier = i === 0 ? 1 : 2;
      if (desiredTier === 1 && !this.canAddTier1()) continue;

      let lead =
        Math.random() < this.rules.recurringChance
          ? this.pickRecurringCandidate(primaryRing, desiredTier)
          : null;

      if (!lead) {
        lead = createFreshSuspect(this.roster, {
          ringId: primaryRing,
          tier: desiredTier,
          rules: this.rules,
          usedNicknames: this.getUsedNicknames()
        });
      }

      if (i === 0) lead.isPrimaryTarget = true;
      this.addToActiveBoard(lead);
    }

    const otherRings = ringKeys.filter((r) => r !== primaryRing);
    if (
      otherRings.length > 0 &&
      this.activeRings.length < this.rules.maxActiveRingsPerCase &&
      this.crossRingBreadcrumbs.length < this.rules.maxCrossRingThreadsPerCase &&
      Math.random() < this.rules.crossRingThreadChance
    ) {
      const rivalRingId = pickRandom(otherRings);
      this.activeRings.push(rivalRingId);
      const rivalBoss = createFreshSuspect(this.roster, {
        ringId: rivalRingId,
        tier: 3,
        rules: this.rules,
        usedNicknames: this.getUsedNicknames()
      });
      this.stagedSuspects.push(rivalBoss);
      this.crossRingBreadcrumbs.push({
        ringId: rivalRingId,
        bossName: rivalBoss.displayName,
        note: `Surprise sighting of ${rivalBoss.displayName} (${this.roster.crimeRings[rivalRingId]?.name || rivalRingId})—looks like another plot is brewing.`
      });
    }

    return this.getSnapshot();
  }

  pullThread(fromSuspectId = null) {
    const source = this.activeSuspects.find((s) => s.id === fromSuspectId) || this.activeSuspects[0];
    if (source?.superiorId) {
      const stagedIdx = this.stagedSuspects.findIndex((s) => s.id === source.superiorId);
      if (stagedIdx !== -1) {
        const [promotedToBoard] = this.stagedSuspects.splice(stagedIdx, 1);
        return this.addToActiveBoard(promotedToBoard);
      }
    }

    const primaryRing = this.activeRings[0];
    const anyStagedIdx = this.stagedSuspects.findIndex((s) => s.ringId === primaryRing);
    if (anyStagedIdx !== -1) {
      const [candidate] = this.stagedSuspects.splice(anyStagedIdx, 1);
      if (candidate.tier !== 1 || this.canAddTier1()) {
        return this.addToActiveBoard(candidate);
      }
    }

    const tier = this.canAddTier1() ? 1 : 2;
    const fresh = createFreshSuspect(this.roster, {
      ringId: primaryRing,
      tier,
      rules: this.rules,
      usedNicknames: this.getUsedNicknames()
    });
    return this.addToActiveBoard(fresh);
  }

  handleEscape(suspectId) {
    const idx = this.activeSuspects.findIndex((s) => s.id === suspectId);
    if (idx === -1) return null;

    const suspect = this.activeSuspects[idx];
    suspect.escapesCount += 1;

    const oldTier = suspect.tier;
    let promoted = false;

    if (this.rules.promoteOnEscape && suspect.tier < this.rules.ringleaderTier) {
      suspect.tier = Math.min(suspect.tier + 1, this.rules.ringleaderTier);
      suspect.rankTitle = TIER_TITLES[suspect.tier] || "Operative";
      promoted = true;
    }

    const note = promoted
      ? `Slipped away and moved up from ${TIER_TITLES[oldTier]} to ${suspect.rankTitle}.`
      : `Slipped away, holding steady at ${suspect.rankTitle}.`;

    suspect.history.notes.push(note);
    this.stageHierarchyAhead(suspect);

    const addedUnderlings = [];
    for (let i = 0; i < this.rules.underlingsAddedOnPromotion; i++) {
      if (!this.canAddTier1()) break;
      const underling = createFreshSuspect(this.roster, {
        ringId: suspect.ringId,
        tier: 1,
        superiorId: suspect.id,
        rules: this.rules,
        usedNicknames: this.getUsedNicknames()
      });
      this.stagedSuspects.push(underling);
      addedUnderlings.push(underling);
    }

    this.activeSuspects.splice(idx, 1);
    suspect.status = "at-large";
    this.stagedSuspects.push(suspect);
    this.cooldowns.set(suspect.id, this.rules.suspectCooldownCases);

    return {
      suspect,
      promoted,
      note,
      addedUnderlingsCount: addedUnderlings.length
    };
  }

  captureSuspect(suspectId) {
    const idx = this.activeSuspects.findIndex((s) => s.id === suspectId);
    if (idx === -1) return null;
    const [captured] = this.activeSuspects.splice(idx, 1);
    captured.status = "captured";
    this.retiredSuspects.push(captured);
    this.cooldowns.set(captured.id, this.rules.suspectCooldownCases);
    return captured;
  }

  getSnapshot() {
    return {
      caseNumber: this.caseCounter,
      activeRings: [...this.activeRings],
      tier1Count: this.countTier1Total(),
      maxTier1Operatives: this.rules.maxTier1Operatives,
      activeSuspects: this.activeSuspects,
      stagedCount: this.stagedSuspects.length,
      crossRingBreadcrumbs: this.crossRingBreadcrumbs,
      capturedCount: this.retiredSuspects.length
    };
  }
}

window.SuspectEngine = SuspectEngine;
window.SuspectGeneratorUtils = {
  GENERATION_RULES,
  NAME_RULES,
  TIER_TITLES,
  formatSuspectName,
  createFreshSuspect,
  createSurnameClueFragment,
  createIdentityClueFragment,
  pickUniqueNickname
};