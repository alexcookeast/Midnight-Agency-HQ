/**
 * Factbook Loader — supports both Standard (single bundle) and Lite (on-demand per-country) modes.
 * Automatically resolves regional fallback suspect names & traits so every country works seamlessly.
 */

const SETTINGS_KEY = "midnight_agency_settings_v1";

export function getPerformanceMode() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.performanceMode === "lite" || parsed.performanceMode === "standard") {
        return parsed.performanceMode;
      }
    }
  } catch {
    // Ignore storage errors
  }
  // Safe default: "lite" loads in ~45 KB on Fire tablets and still works instantly on desktop
  return "lite";
}

export function setPerformanceMode(mode) {
  const safeMode = mode === "standard" ? "standard" : "lite";
  let current = {};
  try {
    current = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    current = {};
  }
  current.performanceMode = safeMode;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  window.dispatchEvent(new StorageEvent("storage", { key: SETTINGS_KEY }));
  return safeMode;
}

class FactbookService {
  constructor() {
    this.meta = null;
    this.index = null;
    this.cache = new Map();
    this.fullLoaded = false;
  }

  async init(basePath = ".") {
    this.basePath = basePath.replace(/\/$/, "");
    const mode = getPerformanceMode();

    if (mode === "standard") {
      const res = await fetch(`${this.basePath}/data/world-factbook.min.json`);
      const data = await res.json();
      this.meta = data.meta;
      this.index = {};
      for (const [code, country] of Object.entries(data.countries)) {
        const hydrated = this.#attachFallbacks(country);
        this.cache.set(code, hydrated);
        this.index[code] = {
          iso2: hydrated.iso2,
          name: hydrated.name,
          region: hydrated.region,
          subregion: hydrated.subregion,
          callingCode: hydrated.callingCode,
          capital: hydrated.capital,
          flagPath: hydrated.culture.flag.svgPath,
          clueTags: hydrated.gameHooks.clueTags
        };
      }
      this.fullLoaded = true;
    } else {
      const res = await fetch(`${this.basePath}/data/factbook-index.json`);
      const data = await res.json();
      this.meta = data.meta;
      this.index = data.countries;
    }

    return this.index;
  }

  getCountryList() {
    if (!this.index) return [];
    return Object.values(this.index);
  }

  async getCountry(iso2) {
    const code = String(iso2).toUpperCase();
    if (this.cache.has(code)) {
      return this.cache.get(code);
    }

    const res = await fetch(`${this.basePath}/data/countries/${code.toLowerCase()}.json`);
    if (!res.ok) {
      throw new Error(`Country not found: ${code}`);
    }
    const rawCountry = await res.json();
    const hydrated = this.#attachFallbacks(rawCountry);

    // Keep cache bounded on Lite mode so a Fire Tablet never accumulates unbounded RAM
    if (getPerformanceMode() === "lite" && this.cache.size >= 25) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(code, hydrated);
    return hydrated;
  }

  #attachFallbacks(country) {
    const regionPool =
      this.meta?.regionFallbacks?.[country.region] ||
      this.meta?.regionFallbacks?.Europe || {
        firstNames: ["Alex", "Sofia"],
        lastNames: ["Morgan", "Reyes"],
        traits: ["Travels light with a locked briefcase"]
      };

    return {
      ...country,
      gameHooks: {
        ...country.gameHooks,
        suspectNamePool: country.gameHooks?.suspectNamePool || {
          firstNames: regionPool.firstNames,
          lastNames: regionPool.lastNames
        },
        regionalTraits: country.gameHooks?.regionalTraits || regionPool.traits
      }
    };
  }
}

export const factbook = new FactbookService();