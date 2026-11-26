# Canonical place schema (proposal, Wave 1)

Status: **proposed, needs owner sign-off.** The only code change made for it is additive
(`findPlace` accepts slugs and `{placeId}`; `WorldFactbook.slugifyPlace/placesByIso2/countryFileUrl`
exist; every ring hub is a real PLACE). Nothing existing was renamed or removed, so the test
pages keep working.

## 1. The datasets today (measured on the repo, 2026-11-26)

| Dataset | What it is | Key | Count |
|---|---|---|---|
| `js/world-factbook.js` `PLACES` | Playable **cities** (travel graph, map position, modes) | `id` = kebab slug (`buenos-aires`) | 21 |
| `data/countries/<iso2>.json` and `data/factbook-index.json` | **Countries** (facts, capital, flag, clue tags) | `iso2` (`JP`; file name lowercase) | 194 |
| `data/crime-rings.json` `homeHubs[]` | Ring home cities | `city` (name string) | 18 |
| `data/suspects.json` / recurring records `origin` | Suspect origin | `{city, country, region}` | n/a |
| `player-dashboard.html` `COUNTRIES` | HQ world clock, phrasebook, news | `code` = iso2 (+ `HQ` pseudo entry) | 16 + HQ |
| `Factbook.json` (Spy App project only, **not in the repo**) | Older OSINT-desk **city** facts | `id` = kebab slug | 12 |

## 2. The rule

Two levels, joined by `iso2`. A **place is a city**; a **country is a country**.

```
place.id        lowercase ASCII kebab slug of the city name   "buenos-aires"   (primary key, never changes)
place.iso2      ISO 3166-1 alpha-2, UPPERCASE                  "AR"             (join to country data)
place.region    one of Europe | Americas | Asia | Africa | Oceania   (matches data/countries region)
place.subregion optional free label, e.g. "Mediterranean"      (never used for matching)
```

- **City to country:** `place.iso2` to `data/countries/<iso2 lowercase>.json`
  (`WorldFactbook.countryFileUrl(place)`), and to `factbook-index.json.countries[iso2]`.
- **Country to cities:** `WorldFactbook.placesByIso2("US")` (Duluth, Anchorage, New York).
- **Slug function:** `WorldFactbook.slugifyPlace(name)` (strips diacritics, lowercases, non-alphanumerics to `-`).
  Same algorithm the Factbook.json ids already follow (`lima`, `oslo`, `tokyo`).
- **Lookups:** `findPlace()` accepts an id, a slug, a city name (any case), or an object with
  `placeId | id | city`. Prefer `placeId` when you have it.
- **Other datasets point at places by `placeId`**, and keep their human-readable `city` as a label only.
  Suspect `origin` now carries `placeId` (set by the generator).

Why the city is the key and not the country: PLACES, ring hubs, crime targets and Factbook.json are
all city-shaped, and two places can share a country (Duluth and Anchorage are both `US`).

## 3. Current coverage and gaps

- PLACES to country files: **21 of 21** resolve.
- Ring hubs to PLACES: **18 of 18** resolve (was 6 failing: Tokyo, Mumbai, Beirut, Buenos Aires, Duluth, Anchorage).
- Crime-type targets to PLACES: all resolve.
- `Factbook.json` (12 cities) to PLACES: only **Oslo, Tokyo, Reykjavik, Santiago** exist as places.
  Lima, Nairobi, Sydney, Montreal, Cairo, Bangkok, Lisbon, Singapore are not playable places yet.
  Their ids are already valid slugs, so adding them to PLACES later needs no re-keying.
- Dashboard 16 countries to PLACES: **6 countries** have a place (JP, IN, CA, MX, NO, GB). Italy, Egypt,
  France, Brazil, Australia, China, Peru, Spain, Greece and Germany have none. `HQ` (Saint John) has no
  country file. It is the player's home base, not a country, and should stay outside the join.
- The dashboard stores a **capital** per country (`cap`), PLACES stores **cities**. Where the two
  coincide (Tokyo, Mexico City, Oslo, London), join by `findPlace(cap)`. Otherwise join by `iso2` only.

## 4. Decisions for the owner (please answer before Wave 2)

1. **Key format.** Keep the kebab slug as `place.id` (recommended, zero migration), or move to `<iso2>-<slug>` (`ar-buenos-aires`)?
2. **Region vocabulary.** `Mediterranean` is not a region in the country data. Wave 1 made it `region: "Asia"` plus
   `subregion: "Mediterranean"` for Beirut. Fine, or should "Mediterranean" become a first-class travel/region tag?
3. **Where should the 8 Factbook.json-only cities live?** Add them to PLACES (needs a map position, modes and
   landmass each), or leave Factbook.json as retired Track B content?
4. **Dashboard to places.** Add the 10 missing dashboard countries as PLACES (capital cities), or keep the dashboard
   country-level only?
