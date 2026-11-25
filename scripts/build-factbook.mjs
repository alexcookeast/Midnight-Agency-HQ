#!/usr/bin/env node
/**
 * Builds both Standard (single compact JSON) and Lite (tiny index + per-country JSON files)
 * from open global country data + curated kid/game overrides.
 *
 * Usage:
 *   node scripts/build-factbook.mjs
 *   node scripts/build-factbook.mjs --download-flags
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const OVERRIDES_PATH = path.join(__dirname, "factbook-overrides.json");
const DATA_DIR = path.join(ROOT_DIR, "data");
const COUNTRIES_OUT_DIR = path.join(DATA_DIR, "countries");
const STANDARD_OUT_PATH = path.join(DATA_DIR, "world-factbook.min.json");
const INDEX_OUT_PATH = path.join(DATA_DIR, "factbook-index.json");
const FLAGS_DIR = path.join(ROOT_DIR, "assets", "flags");

const DOWNLOAD_FLAGS = process.argv.includes("--download-flags");
const COUNTRIES_SOURCE_URL =
  "https://raw.githubusercontent.com/mledoze/countries/master/countries.json";
const FLAG_CDN_BASE = "https://flagcdn.com";

const REGION_FALLBACKS = {
  Europe: {
    firstNames: ["Alex", "Elena", "Lukas", "Sofia", "Martin", "Clara", "Viktor", "Nina"],
    lastNames: ["Novak", "Kovacs", "Lindqvist", "Rossi", "Moreau", "Keller", "Silva", "Varga"],
    traits: [
      "Carries a well-stamped rail pass in their coat pocket",
      "Always checks the local museum schedule first",
      "Speaks three languages with a slight accent"
    ]
  },
  Americas: {
    firstNames: ["Mateo", "Sofia", "Lucas", "Camila", "Diego", "Elena", "Julian", "Maya"],
    lastNames: ["Morales", "Castro", "Reyes", "Ortiz", "Delgado", "Ramos", "Mendez", "Cruz"],
    traits: [
      "Keeps a worn postcard from every port city visited",
      "Always packs sunglasses and a light rain jacket",
      "Knows the departure times of regional ferries"
    ]
  },
  Asia: {
    firstNames: ["Kenji", "Mei", "Arjun", "Sora", "Tariq", "Lina", "Hana", "Rami"],
    lastNames: ["Chen", "Kim", "Patel", "Tanaka", "Rahman", "Lee", "Park", "Al-Mansoor"],
    traits: [
      "Carries a pocket travel journal filled with sketches",
      "Knows the busiest night markets in every major city",
      "Always travels with a compact folding umbrella"
    ]
  },
  Africa: {
    firstNames: ["Kofi", "Amara", "Zainab", "Tariq", "Jabari", "Nadia", "Malik", "Amina"],
    lastNames: ["Mensah", "Diallo", "Okafor", "Traore", "Hassan", "Ndlovu", "Mbeki", "Banda"],
    traits: [
      "Navigates easily across vast highways and river crossings",
      "Carries a woven leather satchel with hidden pockets",
      "Can identify regional birds by their morning calls"
    ]
  },
  Oceania: {
    firstNames: ["Tane", "Aroha", "Liam", "Isla", "Kai", "Maia", "Noah", "Ruby"],
    lastNames: ["Tapu", "Williams", "Walker", "Reid", "Kingi", "Stewart", "Baker", "Scott"],
    traits: [
      "Reads ocean tides and wind shifts effortlessly",
      "Always wears a sun-faded canvas hat",
      "Carries a waterproof map pouch"
    ]
  }
};

function slugifyTag(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractCallingCode(idd) {
  if (!idd || !idd.root) return null;
  const suffixes = Array.isArray(idd.suffixes) ? idd.suffixes : [];
  if (suffixes.length === 1) {
    return `${idd.root}${suffixes[0]}`;
  }
  return idd.root;
}

async function fetchWorldBankPopulations() {
  const popByIso2 = {};
  const url =
    "https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=300&mrnev=1";
  try {
    const res = await fetch(url);
    if (!res.ok) return popByIso2;
    const json = await res.json();
    const rows = Array.isArray(json?.[1]) ? json[1] : [];
    for (const row of rows) {
      const code = row?.countryiso3code; // WB sometimes omits iso2code; we'll map via cca3 too
      const iso2 = row?.country?.id;
      const val = Number(row?.value);
      if (iso2 && iso2.length === 2 && Number.isFinite(val) && val > 0) {
        popByIso2[iso2.toUpperCase()] = val;
      }
      if (code && code.length === 3 && Number.isFinite(val) && val > 0) {
        popByIso2[`ISO3:${code.toUpperCase()}`] = val;
      }
    }
  } catch {
    // Offline or API issue: return empty map and let overrides/fallbacks handle it
  }
  return popByIso2;
}

function formatPopulationDisplay(pop) {
  if (!pop || pop <= 0) return "Unknown";
  if (pop >= 1_000_000_000) return `${(pop / 1_000_000_000).toFixed(2)} billion`;
  if (pop >= 1_000_000) return `${Math.round(pop / 100_000) / 10} million`;
  if (pop >= 1_000) return `${Math.round(pop / 1_000).toLocaleString()} thousand`;
  return pop.toLocaleString();
}

function buildAutoKidComparison(name, pop, areaSqKm) {
  const popStr = formatPopulationDisplay(pop);
  if (pop >= 100_000_000) {
    return `${name} is one of the world's most populated nations, home to about ${popStr} people.`;
  }
  if (pop >= 20_000_000) {
    return `About ${popStr} people live in ${name}—roughly the population of a major world region.`;
  }
  if (pop >= 1_000_000) {
    return `Home to around ${popStr} people across ${areaSqKm ? areaSqKm.toLocaleString() + " sq km" : "its territory"}.`;
  }
  return `A smaller nation of about ${popStr} people—fewer than live in many single big cities!`;
}

function buildAutoClimate(lat, isIsland) {
  const absLat = Math.abs(lat || 0);
  if (absLat < 15) {
    return isIsland
      ? "Warm, sunny tropical island climate moderated by ocean breezes."
      : "Warm tropical climate year-round with distinct wet and dry seasons.";
  }
  if (absLat < 35) {
    return "Subtropical to warm temperate climate, ranging from sunny coasts to dry inland areas.";
  }
  if (absLat < 55) {
    return "Temperate four-season climate with warm summers and cool to cold winters.";
  }
  return "Cool subarctic to cold northern climate with long winters and short, bright summers.";
}

function deepMerge(target, source) {
  const output = { ...target };
  for (const [key, val] of Object.entries(source || {})) {
    if (val && typeof val === "object" && !Array.isArray(val) && target[key] && typeof target[key] === "object") {
      output[key] = deepMerge(target[key], val);
    } else {
      output[key] = val;
    }
  }
  return output;
}

async function downloadFlagSvg(iso2Lower) {
  const url = `${FLAG_CDN_BASE}/${iso2Lower}.svg`;
  const dest = path.join(FLAGS_DIR, `${iso2Lower}.svg`);
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const svg = await res.text();
    await fs.writeFile(dest, svg, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("Loading curated overrides...");
  const overridesRaw = await fs.readFile(OVERRIDES_PATH, "utf8");
  const overrides = JSON.parse(overridesRaw);

console.log("Fetching global country dataset...");
  const response = await fetch(COUNTRIES_SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch countries source: ${response.status} ${response.statusText}`);
  }
  const rawCountries = await response.json();

  console.log("Fetching latest population figures...");
  const wbPopulations = await fetchWorldBankPopulations();

  const filtered = rawCountries.filter(
    (c) => c.cca2 && c.name?.common && (c.independent === true || overrides[c.cca2])
  );

  if (DOWNLOAD_FLAGS) {
    await fs.mkdir(FLAGS_DIR, { recursive: true });
    console.log(`Downloading ${filtered.length} SVG flags to assets/flags/...`);
  }

  await fs.mkdir(COUNTRIES_OUT_DIR, { recursive: true });

  const countriesMap = {};
  const indexMap = {};

  for (const raw of filtered) {
    const iso2 = raw.cca2.toUpperCase();
    const iso2Lower = iso2.toLowerCase();
    const name = raw.name.common;
    const officialName = raw.name.official || name;
    const region = raw.region || "World";
    const subregion = raw.subregion || region;

    const capName = Array.isArray(raw.capital) && raw.capital.length ? raw.capital[0] : "N/A";
    const capCoords = Array.isArray(raw.capitalInfo?.latlng) && raw.capitalInfo.latlng.length === 2
      ? raw.capitalInfo.latlng
      : Array.isArray(raw.latlng) && raw.latlng.length === 2
        ? raw.latlng
        : [0, 0];

    const languages = raw.languages ? Object.values(raw.languages) : ["Local language"];
    const currencyEntries = raw.currencies ? Object.entries(raw.currencies) : [];
    const currency = currencyEntries.length
      ? {
          code: currencyEntries[0][0],
          name: currencyEntries[0][1].name || currencyEntries[0][0],
          symbol: currencyEntries[0][1].symbol || ""
        }
      : { code: "N/A", name: "Local currency", symbol: "" };

    const borders = Array.isArray(raw.borders) ? raw.borders : [];
    const isLandlocked = Boolean(raw.landlocked);
    const isIsland = !isLandlocked && borders.length === 0;
    const callingCode = extractCallingCode(raw.idd);
   const iso3Key = raw.cca3 ? `ISO3:${raw.cca3.toUpperCase()}` : "";
    const populationExact =
      wbPopulations[iso2] ||
      (iso3Key && wbPopulations[iso3Key]) ||
      Number(raw.population) ||
      0;
    const areaSqKm = Number(raw.area) || 0;

    const autoClueTags = [
      slugifyTag(region),
      slugifyTag(subregion),
      ...languages.slice(0, 2).map((l) => `${slugifyTag(l)}-speaking`),
      isIsland ? "island-nation" : isLandlocked ? "landlocked" : "coastal",
      callingCode ? `dial-${callingCode.replace(/[^0-9]/g, "")}` : null
    ].filter(Boolean);

    const baseEntry = {
      iso2,
      iso3: raw.cca3 || iso2,
      name,
      officialName,
      region,
      subregion,
      callingCode,
      capital: {
        name: capName,
        lat: capCoords[0],
        lng: capCoords[1]
      },
      majorCities: capName !== "N/A" ? [{ name: capName, lat: capCoords[0], lng: capCoords[1] }] : [],
      borders,
      timezones: Array.isArray(raw.timezones) ? raw.timezones : ["UTC"],
      primaryTimezone: "UTC",
      population: {
        exact: populationExact,
        display: formatPopulationDisplay(populationExact),
        kidComparison: buildAutoKidComparison(name, populationExact, areaSqKm)
      },
      geography: {
        areaSqKm,
        climate: buildAutoClimate(capCoords[0], isIsland),
        terrain: isIsland
          ? "Island geography surrounded by ocean waters."
          : isLandlocked
            ? "Inland terrain bordered by neighboring countries."
            : "Mix of coastal plains and inland terrain.",
        isIsland,
        isLandlocked
      },
      culture: {
        languages,
        currency,
        drivingSide: "right",
        flag: {
          svgPath: `assets/flags/${iso2Lower}.svg`,
          remoteFallbackUrl: `${FLAG_CDN_BASE}/${iso2Lower}.svg`,
          description: `Official national flag of ${name}.`
        },
        anthem: {
          title: `National Anthem of ${name}`,
          summary: `The official patriotic anthem played at national ceremonies in ${name}.`,
          audioPath: null
        }
      },
      economy: {
        exports: ["Regional agricultural goods", "Manufactured products", "Natural resources"],
        imports: ["Machinery", "Electronics", "Fuel and vehicles"]
      },
      exploration: {
        landmarks: capName !== "N/A" ? [`Historic center of ${capName}`] : [`${name} National Heritage Sites`],
        wildlife: ["Native regional birds and mammals"],
        didYouKnow: `${name} is located in ${subregion} and its capital city is ${capName}.`
      },
      gameHooks: {
        clueTags: Array.from(new Set(autoClueTags))
      }
    };

    const mergedEntry = overrides[iso2] ? deepMerge(baseEntry, overrides[iso2]) : baseEntry;
    countriesMap[iso2] = mergedEntry;

    indexMap[iso2] = {
      iso2,
      name,
      region,
      subregion,
      callingCode: mergedEntry.callingCode,
      capital: mergedEntry.capital,
      flagPath: mergedEntry.culture.flag.svgPath,
      clueTags: mergedEntry.gameHooks.clueTags
    };

    await fs.writeFile(
      path.join(COUNTRIES_OUT_DIR, `${iso2Lower}.json`),
      JSON.stringify(mergedEntry),
      "utf8"
    );

    if (DOWNLOAD_FLAGS) {
      await downloadFlagSvg(iso2Lower);
    }
  }

  const sortedCodes = Object.keys(countriesMap).sort((a, b) =>
    countriesMap[a].name.localeCompare(countriesMap[b].name)
  );

  const sortedCountries = {};
  const sortedIndex = {};
  for (const code of sortedCodes) {
    sortedCountries[code] = countriesMap[code];
    sortedIndex[code] = indexMap[code];
  }

  const sharedMeta = {
    version: "1.2.0",
    generatedAt: new Date().toISOString().slice(0, 10),
    countryCount: sortedCodes.length,
    regionFallbacks: REGION_FALLBACKS
  };

  const standardJson = JSON.stringify({ meta: sharedMeta, countries: sortedCountries });
  await fs.writeFile(STANDARD_OUT_PATH, standardJson, "utf8");

  const indexJson = JSON.stringify({ meta: sharedMeta, countries: sortedIndex });
  await fs.writeFile(INDEX_OUT_PATH, indexJson, "utf8");

  const oldPrettyPath = path.join(DATA_DIR, "world-factbook.json");
  await fs.rm(oldPrettyPath, { force: true });

  const stdKb = Math.round(Buffer.byteLength(standardJson, "utf8") / 1024);
  const idxKb = Math.round(Buffer.byteLength(indexJson, "utf8") / 1024);

  console.log(`Done! Generated ${sortedCodes.length} countries:`);
  console.log(`  - Standard bundle: data/world-factbook.min.json (${stdKb} KB)`);
  console.log(`  - Lite index:      data/factbook-index.json (${idxKb} KB) + data/countries/*.json`);
}

main().catch((err) => {
  console.error("Factbook build failed:", err);
  process.exit(1);
});