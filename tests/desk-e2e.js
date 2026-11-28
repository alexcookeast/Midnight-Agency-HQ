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
  await page.click(".sheet >> text=Close");
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
  // ---- Step 3: comms inbox, incoming Chief call, waveform, note, 44px targets
  await page.goto(U + "player-dashboard.html?dev=1&speed=30"); await page.waitForSelector("#commsBtn");
  ok(/\(\d+\)/.test(await page.locator("#commsBtn").textContent()), "Comms button shows an unread count");
  ok(await page.locator(".seg button:has-text('Comms')").count() === 0, "no scattered Comms tab on the desk strip");
  await page.click("#commsBtn"); await page.waitForSelector(".drawer.open");
  for (const k of ["All", "Calls", "Emails", "Texts", "Voicemails"]) ok(await page.locator(".drawer .chipbtn", { hasText: new RegExp("^" + k) }).count() === 1, "folder " + k);
  for (const sel of [".drawer .chipbtn", ".drawer .mrow", ".drawer-h .btn", "#commsBtn", ".seg button"]) for (const el of await page.locator(sel).all()) { const bx = await el.boundingBox(); if (bx) ok(bx.height >= 44, sel + " tall enough: " + Math.round(bx.height)); }
  await page.click(".drawer .mrow >> nth=-1"); await page.waitForSelector(".drawer-b .mute");
  ok(await page.locator(".drawer-h >> text=Back").count() === 1, "detail view inside the drawer with a back button");
  await page.click(".drawer-h >> text=Back"); ok(await page.locator(".drawer .mrow").count() >= 1, "back to the list");
  await page.click(".drawer-h .btn >> nth=-1"); ok(await page.locator(".drawer.open").count() === 0, "drawer closes");
  // anonymous tip shows an Unknown caller pop-up
  await page.evaluate(() => { const D = window.__desk, st = D.state(), c = st.cases[0]; c.comms = c.comms || []; c.comms.push({ id: "anon-e2e", channel: "call", state: "new", at: Date.now(), from: { id: "informant", name: "Anonymous", kind: "informant" }, subject: "A tip", body: "Psst. Check the harbour.", transcript: ["Psst.", "Check the harbour."], callerId: { label: "Unknown caller", sub: "", anonymous: true }, reliability: "rumour", hint: "Sounds unsure." }); CaseEngine.save(st); });
  await page.waitForSelector(".ring.anon", { timeout: 4000 }); ok(/Unknown caller/.test(await page.locator(".ring").textContent()) && /anonymous tip/i.test(await page.locator(".ring").textContent()), "anonymous caller id pop-up");
  await page.click(".ring >> text=Answer"); await page.waitForSelector(".drawer canvas.wave"); ok(await page.locator(".drawer >> text=Anonymous tip").count() >= 1, "answering opens the tip with an Anonymous tip label");
  await page.evaluate(() => { CommsAudio.stop(); }); await page.click(".drawer-h .btn >> nth=-1");
  // dossier: manual notebook, nothing auto-filled
  await page.click(".seg button:has-text('Dossier')"); await page.waitForSelector("[data-trait]");
  ok(await page.locator(".trait.known").count() === 0, "notebook starts blank");
  await page.click("[data-trait=build]"); await page.click(".picker .pickbtn.alt >> nth=0");
  ok(await page.locator(".trait.known").count() === 1, "manual pin fills one row");
  for (const el of await page.locator(".trow .trait, .sus").all()) { const bx = await el.boundingBox(); if (bx) ok(bx.height >= 44, "dossier target 44px+"); }
  ok(await page.locator(".sus .mug svg").count() >= 1, "suspect mugshots drawn");
  await page.click(".sus >> nth=0"); ok(await page.locator(".dossier").count() === 1, "selected suspect shows a dossier card");
  await page.click(".trow .btn >> nth=0"); ok(await page.locator(".trait.known").count() === 0, "clearing a clue works");
  // a Chief call rings straight away in real time
  await page.evaluate(() => { MidnightAgencyConfig.write({ timeMode: "real" }); });
  await page.reload(); await page.waitForSelector("#commsBtn");
  await page.evaluate(() => { const D = window.__desk, st = D.state(), c = st.cases[0], ctx = D.ctx(); ChiefCalls.award(st, c, ctx, "lucky"); CaseEngine.save(st); });
  await page.waitForSelector(".ring", { timeout: 4000 }); ok(/The Chief/.test(await page.locator(".ring").textContent()), "incoming call banner from the Chief");
  for (const el of await page.locator(".ring .btn").all()) { const bx = await el.boundingBox(); ok(bx.height >= 44 && bx.width >= 44, "ring buttons 44px+"); }
  await page.click(".ring >> text=Answer"); await page.waitForSelector(".drawer canvas.wave");
  await page.waitForTimeout(1200);
  ok(await page.locator(".tchunk.now, .tchunk.said").count() >= 1, "live transcript advances while the call plays");
  const px = await page.evaluate(() => { const c = document.querySelector("canvas.wave"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  ok(px > 200, "waveform is drawn: " + px + " px");
  await page.evaluate(() => { CommsAudio.stop(); });
  await page.evaluate(() => { MidnightAgencyConfig.write({ timeMode: "mission" }); });
  // classic phrasebook page loads and has no free-star taps
  await page.goto(U + "hq-classic.html?dev=1"); await page.waitForTimeout(500); ok(await page.locator("#phraseIn").count() === 1, "phrasebook page still works");
  // GM suite
  await page.goto(U + "gm-suite/midnight-agency-backend.html"); await page.waitForTimeout(500);
  ok(await page.locator("#playerRank option").count() === 7 && await page.locator("#timeMode").count() === 1, "GM Suite lists 7 ranks and the time-mode toggle");
  ok(errs.length === 0, "no page errors: " + errs.join(" | "));
  console.log("desk e2e: " + n + " checks OK"); await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
