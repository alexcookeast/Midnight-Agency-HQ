/* Location Intel & Forecast: local time (Intl + IANA tz), Open-Meteo current + 3-day forecast,
   cached 3 h in localStorage (midnight_agency_wx_v1), with a clearly labelled offline climate estimate. */
(function (global) {
  "use strict";
  var KEY = "midnight_agency_wx_v1", TTL = 3 * 3600 * 1000;
  var WX = {
    0: ["Clear", "☀️"], 1: ["Mostly clear", "🌤️"], 2: ["Partly cloudy", "⛅"], 3: ["Cloudy", "☁️"], 45: ["Fog", "🌫️"], 48: ["Freezing fog", "🌫️"],
    51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Heavy drizzle", "🌧️"], 61: ["Light rain", "🌦️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
    66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"], 71: ["Light snow", "🌨️"], 73: ["Snow", "❄️"], 75: ["Heavy snow", "❄️"], 77: ["Snow grains", "🌨️"],
    80: ["Showers", "🌦️"], 81: ["Showers", "🌧️"], 82: ["Heavy showers", "⛈️"], 85: ["Snow showers", "🌨️"], 86: ["Snow showers", "🌨️"], 95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm", "⛈️"], 99: ["Thunderstorm", "⛈️"]
  };
  function wx(code) { return WX[code] || ["Weather", "🌡️"]; }

  function localTime(tz, now) {
    try {
      var d = new Date(now || Date.now());
      var t = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
      var day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(d);
      var hour = Number(t.slice(0, 2));
      return { text: t, day: day, isDay: hour >= 7 && hour < 19 };
    } catch (e) { return { text: "--:--", day: "", isDay: true }; }
  }

  // Offline fallback: a rough seasonal average from latitude and the month. Always labelled as an estimate.
  function estimate(lat, now) {
    var d = new Date(now || Date.now()), doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
    var a = Math.abs(lat), base = 27 - 0.37 * a, amp = 0.2 * a;
    var t = base + (lat >= 0 ? 1 : -1) * amp * Math.cos(2 * Math.PI * (doy - 200) / 365);
    return { current: { temp: Math.round(t), code: null, estimate: true }, days: [], estimate: true };
  }

  function readCache() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } }
  function writeCache(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} }

  function fetchWeather(place, opts) {
    var cache = readCache(), hit = cache[place.id], now = Date.now();
    if (hit && now - hit.at < TTL) return Promise.resolve(Object.assign({ cached: true }, hit.data));
    var offline = function () {
      if (hit) return Object.assign({ cached: true, stale: true }, hit.data);   // old real data beats a guess
      return estimate(place.lat, now);
    };
    if (typeof fetch !== "function" || (typeof navigator !== "undefined" && navigator.onLine === false)) return Promise.resolve(offline());
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + place.lat + "&longitude=" + place.lon +
      "&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=4&timezone=" + encodeURIComponent(place.tz || "auto");
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null, timer = ctl ? setTimeout(function () { ctl.abort(); }, 6000) : null;
    return fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (r) { if (!r.ok) throw new Error("wx"); return r.json(); }).then(function (j) {
      clearTimeout(timer);
      var data = {
        current: { temp: Math.round(j.current.temperature_2m), code: j.current.weather_code, isDay: !!j.current.is_day },
        days: j.daily.time.slice(1, 4).map(function (t, i) {
          return { date: t, code: j.daily.weather_code[i + 1], hi: Math.round(j.daily.temperature_2m_max[i + 1]), lo: Math.round(j.daily.temperature_2m_min[i + 1]) };
        })
      };
      cache[place.id] = { at: now, data: data }; writeCache(cache);
      return data;
    }).catch(function () { clearTimeout(timer); return offline(); });
  }

  function h(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  // Builds the whole intel panel into `host`. opts.onFactbook(iso2), opts.countryName(iso2), opts.rows(place) -> [[label,value]]
  function render(host, place, opts) {
    opts = opts || {};
    host.innerHTML = "";
    if (!place) {
      host.appendChild(h("div", "ic-empty", "Tap a city or country on the map to see its local time, weather and Factbook entry."));
      return { stop: function () {} };
    }
    var head = h("div", "ic-head");
    head.appendChild(h("div", "ic-city", place.city));
    head.appendChild(h("div", "ic-country", (opts.countryName ? opts.countryName(place.iso2) : place.country) || place.country));
    var clock = h("div", "ic-clock"), sub = h("div", "ic-sub");
    var wxBox = h("div", "ic-wx", "Checking the sky…"), days = h("div", "ic-days");
    var btn = h("button", "ic-fb", "📖 Open Factbook"); btn.type = "button";
    btn.addEventListener("click", function () { if (opts.onFactbook) opts.onFactbook(place.iso2); });
    host.appendChild(head); host.appendChild(clock); host.appendChild(sub); host.appendChild(wxBox); host.appendChild(days);
    if (opts.rows) {
      var intel = h("div", "ic-intel");
      opts.rows(place).forEach(function (r) { var d = h("div", "ic-row"); d.appendChild(h("b", null, r[0] + ": ")); d.appendChild(document.createTextNode(r[1])); intel.appendChild(d); });
      host.appendChild(intel);
    }
    host.appendChild(btn);

    function tick() {
      var t = localTime(place.tz);
      clock.textContent = t.text; sub.textContent = t.day + " · local time" + (t.isDay ? " · daytime" : " · night");
    }
    tick(); var timer = setInterval(tick, 15000), gone = false;
    fetchWeather(place).then(function (w) {
      if (gone) return;
      var c = w.current, d = wx(c.code);
      wxBox.textContent = "";
      if (w.estimate) {
        wxBox.appendChild(h("span", "ic-temp", "≈ " + c.temp + "°C"));
        wxBox.appendChild(h("span", "ic-desc", "Offline estimate for this time of year"));
      } else {
        wxBox.appendChild(h("span", "ic-ico", d[1])); wxBox.appendChild(h("span", "ic-temp", c.temp + "°C")); wxBox.appendChild(h("span", "ic-desc", d[0] + (w.stale ? " (last saved)" : "")));
      }
      days.innerHTML = "";
      (w.days || []).forEach(function (x) {
        var dd = new Date(x.date + "T12:00:00"), cell = h("div", "ic-day");
        cell.appendChild(h("div", "ic-dn", dd.toLocaleDateString("en-GB", { weekday: "short" })));
        cell.appendChild(h("div", "ic-di", wx(x.code)[1]));
        cell.appendChild(h("div", "ic-dt", x.hi + "° / " + x.lo + "°"));
        days.appendChild(cell);
      });
    });
    return { stop: function () { gone = true; clearInterval(timer); } };
  }

  global.IntelCard = { render: render, localTime: localTime, fetchWeather: fetchWeather, estimate: estimate, wx: wx, CACHE_KEY: KEY, TTL: TTL };
})(typeof window !== "undefined" ? window : globalThis);
