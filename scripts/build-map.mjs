// Build data/geo/land.json: compact, country-tagged coastlines for the Command Desk map.
// Usage: node scripts/build-map.mjs path/to/countries.geo.json   (public-domain johan/world.geo.json)
// Output: { v:1, countries:[ { iso2, rings:[ [lon,lat,lon,lat,...] ] } ] }  (1-decimal degrees)
import fs from "node:fs";
const src = process.argv[2];
if (!src) { console.error("usage: node scripts/build-map.mjs countries.geo.json"); process.exit(1); }
const TOL = Number(process.argv[3] || 0.35);   // degrees, Douglas-Peucker tolerance
const geo = JSON.parse(fs.readFileSync(src, "utf8"));
const iso3to2 = {};
for (const f of fs.readdirSync("data/countries")) {
  const c = JSON.parse(fs.readFileSync("data/countries/" + f, "utf8"));
  if (c.iso3 && c.iso2) iso3to2[c.iso3] = c.iso2;
}
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let m = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b]; const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]; let d;
      if (!l2) d = Math.hypot(px - ax, py - ay);
      else { const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)); d = Math.hypot(px - ax - t * dx, py - ay - t * dy); }
      if (d > m) { m = d; mi = i; }
    }
    if (m > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplifyRing(r) {            // closed rings collapse in DP, so split at the midpoint
  const body = r.slice(0, -1), h = body.length >> 1;
  const a = dp(body.slice(0, h + 1), TOL), b = dp(body.slice(h).concat([body[0]]), TOL);
  return a.concat(b.slice(1, -1));
}
const out = [], missing = [];
for (const f of geo.features) {
  const iso2 = iso3to2[f.id] || null;
  if (!iso2) missing.push(f.id + " " + (f.properties && f.properties.name));
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = [];
  for (const poly of polys) {
    const r = poly[0];                // outer ring only
    if (r.length < 4) continue;
    const s = simplifyRing(r);
    if (s.length < 3) continue;
    rings.push(s.flatMap(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]));
  }
  if (rings.length) out.push({ iso2: iso2, name: iso2 ? undefined : (f.properties && f.properties.name), rings });
}
fs.mkdirSync("data/geo", { recursive: true });
fs.writeFileSync("data/geo/land.json", JSON.stringify({ v: 1, countries: out }));
console.log("countries", out.length, "bytes", fs.statSync("data/geo/land.json").size, "unmapped", missing.join("; "));
