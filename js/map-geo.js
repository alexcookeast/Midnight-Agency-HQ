/* Map geometry for the Command Desk: equirectangular 720x360 projection + land loader.
   Land comes from data/geo/land.json (scripts/build-map.mjs). No dependencies, works offline. */
(function (global) {
  "use strict";
  var W = 720, H = 360;
  var land = null;

  function project(lon, lat) { return [(lon + 180) * (W / 360), (90 - lat) * (H / 180)]; }
  function unproject(x, y) { return { lon: x * (360 / W) - 180, lat: 90 - y * (180 / H) }; }

  // SVG path for one country's rings; skips rings that jump across the antimeridian.
  function ringPath(flat) {
    var d = "", prevX = null;
    for (var i = 0; i < flat.length; i += 2) {
      var p = project(flat[i], flat[i + 1]);
      d += (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1);
      prevX = p[0];
    }
    return d + "Z";
  }

  function load(url) {
    if (land) return Promise.resolve(land);
    return fetch(url || "data/geo/land.json").then(function (r) {
      if (!r.ok) throw new Error("land.json " + r.status);
      return r.json();
    }).then(function (j) {
      land = (j.countries || []).map(function (c) { return { iso2: c.iso2 || null, name: c.name || null, d: c.rings.map(ringPath).join("") }; });
      return land;
    });
  }

  // Great-circle polyline between two {lat,lon}, split wherever it wraps the antimeridian.
  function arcSegments(a, b, steps) {
    var AR = global.AgentRoster, n = steps || 24, segs = [[]], last = null;
    for (var i = 0; i <= n; i += 1) {
      var q = AR.interpolate(a, b, i / n), p = project(q.lon, q.lat);
      if (last && Math.abs(p[0] - last[0]) > W / 2) segs.push([]);
      segs[segs.length - 1].push(p); last = p;
    }
    return segs;
  }
  function segsToPath(segs) {
    return segs.map(function (s) { return s.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(""); }).join("");
  }

  global.MapGeo = { W: W, H: H, project: project, unproject: unproject, load: load, getLand: function () { return land; }, arcSegments: arcSegments, segsToPath: segsToPath };
})(typeof window !== "undefined" ? window : globalThis);
