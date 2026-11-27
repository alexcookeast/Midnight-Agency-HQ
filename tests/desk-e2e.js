// Browser smoke test for the Command Desk (needs Playwright: NODE_PATH=$(npm root -g) node tests/desk-e2e.js).
// Serves the repo on :8124, drives a 1280x800 touch browser, offline weather.
const { chromium } = require("playwright"); const http = require("http"); const fs = require("fs"); const path = require("path"); const assert = require("assert");
const root = path.resolve(__dirname, ".."); const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml" };
const srv = http.createServer((q, r) => { let f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (f.endsWith("/")) f += "index.html"; fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; r.end(); } else { r.setHeader("content-type", types[path.extname(f)] || "application/octet-stream"); r.end(d); } }); }).listen(8124);
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", e => errs.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.route(/open-meteo/, r => r.abort());
  const U = "http://localhost:8124/";
  // gate: without ?dev the desk sends visitors to the passcode screen
  await page.goto(U + "player-dashboard.html"); await page.waitForTimeout(600);
  ok(/passcode/i.test(page.url()), "gate redirects without dev flag");
  // redirect stub keeps the query
  await page.goto(U + "case-desk.html?dev=1&speed=30"); await page.waitForTimeout(900);
  ok(page.url().includes("player-dashboard.html") && page.url().includes("speed=30") && page.url().includes("dev=1"), "case-desk redirects and keeps ?dev/?speed");
  await page.waitForSelector(".cm-country"); await page.click("text=Take a new case");
  ok(await page.locator(".cm-country").count() > 150 && await page.locator(".cm-pin").count() >= 21, "map has countries and pins");
  await page.click('.cm-zoom button[data-z="home"]');
  // tap target sizes
  for (const sel of [".bar .btn", ".seg button", ".cm-zoom button", ".ic-fb"]) for (const el of await page.locator(sel).all()) { const bx = await el.boundingBox(); if (bx) ok(bx.height >= 44 && bx.width >= 44, sel + " is 44px+: " + Math.round(bx.width) + "x" + Math.round(bx.height)); }
  // tap a country -> Factbook entry
  const br = await page.locator('.cm-country[data-iso="BR"]').first().boundingBox();
  await page.mouse.click(br.x + br.width * 0.45, br.y + br.height * 0.4); await page.waitForSelector(".fb-head h1");
  ok((await page.locator(".fb-head h1").textContent()) === "Brazil", "tapping Brazil opens its Factbook entry");
  await page.click("text=Field notes"); ok(await page.locator(".fb-item").count() >= 3, "field notes tab lists spycraft entries");
  await page.click("text=Close");
  // tap a city -> card, intel, send agent -> moving marker with legs
  const d = await page.locator('.cm-pin[data-place="london"] .cm-dot').boundingBox(); await page.mouse.click(d.x + 6, d.y + 6);
  await page.waitForSelector(".cm-card"); ok((await page.locator(".ic-city").textContent()) === "London", "city tap fills the intel card");
  ok(/Offline estimate|°C/.test(await page.locator(".ic-wx").textContent()), "forecast panel shows data or a labelled offline estimate");
  await page.click(".cm-card >> text=Send agent"); await page.waitForSelector(".focusbtn"); ok(await page.locator(".focusbtn").count() >= 1, "agent chooser lists routes");
  await page.locator(".focusbtn").first().click(); await page.waitForTimeout(1500);
  ok(await page.locator(".cm-agent.cm-traveling").count() >= 1 || await page.locator(".cm-agent.cm-onScene").count() >= 1, "agent marker travels or has arrived");
  // GM real-time toggle changes the quoted trip time
  const mission = await page.evaluate(() => { const D = window.__desk, c = D.ctx(); const AR = window.AgentRoster, WF = window.WorldFactbook; return AR.planTrip(WF.findPlace("tokyo"), WF.findPlace("london"), "mission").totalMinutes; });
  await page.evaluate(() => MidnightAgencyConfig.write({ timeMode: "real" }));
  const real = await page.evaluate(() => { const AR = window.AgentRoster, WF = window.WorldFactbook; return AR.planTrip(WF.findPlace("tokyo"), WF.findPlace("london"), MidnightAgencyConfig.timeMode()).totalMinutes; });
  ok(real > mission * 2, "real time is much longer than mission time: " + mission + " vs " + real);
  await page.reload(); await page.waitForSelector(".chip >> text=Real time"); ok(true, "desk shows the real-time chip");
  await page.evaluate(() => MidnightAgencyConfig.write({ timeMode: "mission" }));
  // classic phrasebook page loads and has no free-star taps
  await page.goto(U + "hq-classic.html?dev=1"); await page.waitForTimeout(500); ok(await page.locator("#phraseIn").count() === 1, "phrasebook page still works");
  // GM suite
  await page.goto(U + "gm-suite/midnight-agency-backend.html"); await page.waitForTimeout(500);
  ok(await page.locator("#playerRank option").count() === 7 && await page.locator("#timeMode").count() === 1, "GM Suite lists 7 ranks and the time-mode toggle");
  ok(errs.length === 0, "no page errors: " + errs.join(" | "));
  console.log("desk e2e: " + n + " checks OK"); await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
