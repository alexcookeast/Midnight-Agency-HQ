import {
  factbook,
  getPerformanceMode,
  setPerformanceMode
} from "./factbook-loader.js";

const modeSelectEl = document.getElementById("mode-select");
const searchInputEl = document.getElementById("search-input");
const regionSelectEl = document.getElementById("region-select");
const statusTextEl = document.getElementById("status-text");
const countryListEl = document.getElementById("country-list");
const dossierEl = document.getElementById("dossier");

let allCountries = [];
let selectedIso2 = null;

function populateRegionFilter(list) {
  const regions = Array.from(
    new Set(list.map((c) => c.region).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  regionSelectEl.innerHTML = `<option value="">All Regions</option>`;
  for (const region of regions) {
    const opt = document.createElement("option");
    opt.value = region;
    opt.textContent = region;
    regionSelectEl.appendChild(opt);
  }
}

function getFilteredCountries() {
  const query = searchInputEl.value.trim().toLowerCase();
  const region = regionSelectEl.value;

  return allCountries.filter((c) => {
    if (region && c.region !== region) return false;
    if (!query) return true;

    const nameMatch = c.name.toLowerCase().includes(query);
    const isoMatch = c.iso2.toLowerCase().includes(query);
    const codeMatch = c.callingCode
      ? c.callingCode.toLowerCase().includes(query)
      : false;
    const capMatch = c.capital?.name
      ? c.capital.name.toLowerCase().includes(query)
      : false;

    return nameMatch || isoMatch || codeMatch || capMatch;
  });
}

function renderCountryList() {
  const filtered = getFilteredCountries();
  countryListEl.innerHTML = "";

  statusTextEl.textContent = `Mode: ${getPerformanceMode().toUpperCase()} | Showing ${filtered.length} of ${allCountries.length} countries`;

  if (filtered.length === 0) {
    countryListEl.innerHTML = `<p>No matching countries found.</p>`;
    return;
  }

  for (const c of filtered) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.display = "block";
    btn.style.width = "100%";
    btn.style.textAlign = "left";
    btn.style.padding = "8px 10px";
    btn.style.marginBottom = "4px";
    btn.style.cursor = "pointer";

    if (c.iso2 === selectedIso2) {
      btn.style.fontWeight = "bold";
    }

    const codeLabel = c.callingCode ? ` (${c.callingCode})` : "";
    btn.textContent = `${c.name}${codeLabel} — ${c.region}`;

    btn.addEventListener("click", () => {
      selectCountry(c.iso2);
    });

    countryListEl.appendChild(btn);
  }
}

function renderDossier(country) {
  const cap = country.capital || {};
  const coords =
    typeof cap.lat === "number" && typeof cap.lng === "number"
      ? `${cap.lat.toFixed(2)}, ${cap.lng.toFixed(2)}`
      : "N/A";

  const languages = Array.isArray(country.culture?.languages)
    ? country.culture.languages.join(", ")
    : "N/A";

  const landmarks = Array.isArray(country.exploration?.landmarks)
    ? country.exploration.landmarks.join(", ")
    : "N/A";

  const wildlife = Array.isArray(country.exploration?.wildlife)
    ? country.exploration.wildlife.join(", ")
    : "N/A";

  const exportsList = Array.isArray(country.economy?.exports)
    ? country.economy.exports.join(", ")
    : "N/A";

  const flagSrc = country.culture?.flag?.svgPath || "";
  const fallbackFlag = country.culture?.flag?.remoteFallbackUrl || "";

  dossierEl.innerHTML = `
    <h2>${country.name} (${country.iso2})</h2>
    <p><em>${country.officialName || ""}</em></p>

    ${
      flagSrc
        ? `<img src="${flagSrc}" alt="Flag of ${country.name}" width="120" style="border: 1px solid #999;" onerror="if(this.dataset.fb){this.src=this.dataset.fb;this.dataset.fb='';}" data-fb="${fallbackFlag}" />`
        : ""
    }

    <p><strong>Calling Code:</strong> ${country.callingCode || "N/A"}</p>
    <p><strong>Region / Subregion:</strong> ${country.region} / ${country.subregion || "—"}</p>
    <p><strong>Capital:</strong> ${cap.name || "N/A"} (Coords: ${coords})</p>
    <p><strong>Population:</strong> ${country.population?.display || "N/A"} — ${country.population?.kidComparison || ""}</p>
    <p><strong>Languages:</strong> ${languages}</p>
    <p><strong>Climate:</strong> ${country.geography?.climate || "N/A"}</p>
    <p><strong>Key Exports:</strong> ${exportsList}</p>
    <p><strong>Landmarks:</strong> ${landmarks}</p>
    <p><strong>Wildlife:</strong> ${wildlife}</p>
    <p><strong>Did You Know?:</strong> ${country.exploration?.didYouKnow || "N/A"}</p>
    <p><strong>Regional Suspect Trait Sample:</strong> ${country.gameHooks?.regionalTraits?.[0] || "N/A"}</p>
  `;
}

async function selectCountry(iso2) {
  selectedIso2 = iso2;
  renderCountryList();
  dossierEl.innerHTML = `<p>Loading dossier for <strong>${iso2}</strong>...</p>`;

  try {
    const country = await factbook.getCountry(iso2);
    renderDossier(country);
  } catch (err) {
    dossierEl.innerHTML = `<p style="color: crimson;">Error loading ${iso2}: ${err.message}</p>`;
  }
}

async function boot() {
  const currentMode = getPerformanceMode();
  modeSelectEl.value = currentMode;
  statusTextEl.textContent = `Loading Factbook (${currentMode} mode)...`;

  try {
    await factbook.init(".");
    allCountries = factbook.getCountryList();
    populateRegionFilter(allCountries);
    renderCountryList();

    // Default to Canada ("CA") if present, otherwise the first country
    const defaultCode = allCountries.some((c) => c.iso2 === "CA")
      ? "CA"
      : allCountries[0]?.iso2;

    if (defaultCode) {
      await selectCountry(defaultCode);
    }
  } catch (err) {
    statusTextEl.textContent = "Failed to load Factbook.";
    dossierEl.innerHTML = `
      <p style="color: crimson;"><strong>Error:</strong> ${err.message}</p>
      <p>Make sure you are viewing this page through a local web server (like VS Code's <strong>Live Server</strong> extension or <code>npx serve</code>), not by double-clicking the HTML file directly.</p>
    `;
  }
}

modeSelectEl.addEventListener("change", async () => {
  setPerformanceMode(modeSelectEl.value);
  selectedIso2 = null;
  // Reset factbook instance state cleanly and re-init
  factbook.meta = null;
  factbook.index = null;
  factbook.cache.clear();
  factbook.fullLoaded = false;
  await boot();
});

searchInputEl.addEventListener("input", renderCountryList);
regionSelectEl.addEventListener("change", renderCountryList);

boot();