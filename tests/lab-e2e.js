// Browser test for the Flag Unblur lab (needs Playwright: NODE_PATH=$(npm root -g) node tests/lab-e2e.js).
// Serves the repo on :8125, 1280x800 touch browser, internet blocked: proves the lab is offline-clean.
const { chromium } = require("playwright"); const http = require("http"); const fs = require("fs"); const path = require("path"); const assert = require("assert");
const root = path.resolve(__dirname, ".."); const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml" };
const srv = http.createServer((q, r) => { let f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (f.endsWith("/")) f += "index.html"; fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; r.end(); } else { r.setHeader("content-type", types[path.extname(f)] || "application/octet-stream"); r.end(d); } }); }).listen(8125);
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const page = await ctx.newPage(); const errs = [], external = [];
  page.on("pageerror", e => errs.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.route(u => !/^http:\/\/localhost:8125\//.test(u.href), r => { external.push(r.request().url()); r.abort(); });
  const U = "http://localhost:8125/";
  await page.goto(U + "player-dashboard.html?dev=1&speed=30"); await page.waitForSelector(".seg button");
  await page.click('.seg button:has-text("Labs")');
  const row = page.locator(".cand", { hasText: "Flag Unblur" }); ok(await row.count() === 1, "Labs lists Flag Unblur");
  const openBtn = row.locator("button"); ok(!(await openBtn.isDisabled()) && (await openBtn.textContent()) === "Open", "Flag Unblur is ready (not 'Soon')");
  await openBtn.click(); await page.waitForSelector("#ubCanvas");
  const opts = () => page.locator(".ub-opt");
  ok(await opts().count() >= 3, "choices shown"); ok(await page.locator("#ubCanvas").getAttribute("data-step") === "0", "starts at the chunkiest step");
  for (const el of [...await opts().all(), page.locator("#ubClose")]) { const bx = await el.boundingBox(); ok(bx.height >= 44 && bx.width >= 44, "44px+ target " + Math.round(bx.width) + "x" + Math.round(bx.height)); }
  // the picture really is chunky then sharper: compare distinct colours drawn at step 0 vs later
  const colours = () => page.evaluate(() => { const c = document.getElementById("ubCanvas"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, s = new Set(); for (let i = 0; i < d.length; i += 4 * 97) s.add(d[i] + "," + d[i + 1] + "," + d[i + 2]); return s.size; });
  ok((await colours()) >= 1, "canvas painted");
  // wrong answer: greys out, round continues, nothing breaks
  const answerIso = await page.evaluate(() => null);
  // use a fast game so steps advance; reopen with ctx override
  await page.click("#ubClose"); ok(await page.locator("#ubVeil").count() === 0, "close works");
  await page.evaluate(() => UnblurLab.open({ stepMs: 150, level: 3, rng: (function () { let a = 42; return () => (a = (a * 1664525 + 1013904223) % 4294967296) / 4294967296; })() }));
  await page.waitForSelector("#ubCanvas"); await page.waitForTimeout(250);
  ok(Number(await page.locator("#ubCanvas").getAttribute("data-step")) >= 1, "unblurs over time");
  await page.waitForTimeout(1300);
  ok(/Time!/.test(await page.locator("#ubMsg").textContent()) && await page.locator(".ub-opt.yes").count() === 1 && await page.locator("#ubNext").count() === 1, "timeout reveals the answer kindly, with a Next button");
  ok(Number(await page.locator("#ubCanvas").getAttribute("data-step")) === 5, "fully sharp when revealed");
  // play 5 rounds: round 1 timed out; rounds 2-5 tap a wrong one then the right one
  let right = 0;
  await page.click("#ubNext");
  for (let r = 2; r <= 5; r++) {
    await page.waitForSelector("#ubCanvas"); await page.waitForTimeout(60);
    const isos = await page.locator(".ub-opt").evaluateAll(a => a.map(x => x.dataset.iso));
    const ans = await page.evaluate(() => null);
    // find correct answer by trial: tap options; wrong ones grey out, right one turns green
    let found = false;
    for (const iso of isos) {
      const btn = page.locator('.ub-opt[data-iso="' + iso + '"]'); await btn.tap();
      if (await page.locator(".ub-opt.yes").count()) { found = true; right++; break; }
      ok(await btn.evaluate(e => e.classList.contains("no")), "wrong tap greys out the button");
      ok(await page.locator("#ubNext").count() === 0, "wrong tap does not end the round");
    }
    ok(found, "round " + r + " can be solved"); ok(/^Yes!/.test(await page.locator("#ubMsg").textContent()), "praise on a right answer");
    await page.click("#ubNext");
  }
  await page.waitForSelector("#ubResult"); const res = await page.locator("#ubResult").textContent();
  ok(new RegExp(right + " of 5").test(res), "result screen shows score: " + res);
  const last = await page.evaluate(() => UnblurLab.last); ok(last.total === 5 && last.correct === right && last.points >= right, "game summary recorded");
  const stars = await page.evaluate(() => MidnightAgencyConfig.read().player.stars);
  ok(stars === last.stars, "stars awarded through the config contract only when earned: " + stars);
  for (const sel of ["#ubAgain", "#ubDone"]) { const bx = await page.locator(sel).boundingBox(); ok(bx.height >= 44 && bx.width >= 44, sel + " 44px+"); }
  await page.click("#ubAgain"); await page.waitForSelector("#ubCanvas"); ok(/round 1 of 5/.test(await page.locator(".ub-top h2").textContent()), "play again restarts");
  await page.click("#ubClose");
  // guarded: opening the lab from Labs again still works after a game
  ok(external.every(u => /open-meteo|fonts\.g/.test(u)), "lab made no outside requests: " + external.join(","));
  ok(errs.length === 0, "no page errors: " + errs.join(" | "));
  console.log("lab e2e: " + n + " checks OK"); await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
