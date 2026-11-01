import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { qrSvg } from "../src/lib/qr.ts";
const base = process.env.TEST_APP_URL ?? "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw Error("Browser suite requires a local app");
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const id = "00000000-0000-4000-8000-000000000010";
const t = {
  id,
  name: "Riverside Community Cup",
  venue: "Community Ground",
  status: "setup",
  min_squad: 2,
  max_squad: 11,
  base_price: 500,
  team_budget: 10000,
  fixture_settings: null,
};
let passed = 0;
try {
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1440, 1000],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const writes = [];
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin === base || url.protocol === "data:") return route.continue();
      if (request.method() !== "GET" && request.method() !== "OPTIONS") writes.push(url.pathname);
      if (url.pathname.includes("/rest/v1/")) {
        const table = url.pathname.split("/").at(-1);
        const data = table === "tournament_display" ? t : table === "auction_state" ? null : [];
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(data),
          headers: { "access-control-allow-origin": "*" },
        });
      }
      return route.abort(); // No test traffic reaches production or any external service.
    });
    await context.routeWebSocket(
      (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
      (ws) => ws.close(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const path of ["/", "/login", "/forgot-password", "/reset-password", "/auth/callback?next=https%3A%2F%2Fexample.invalid#error=access_denied", "/privacy", "/demo"]) {
      await page.goto(base + path);
      await page.waitForLoadState("networkidle");
      await page.locator("h1").first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Overflow at ${path} ${width}`);
      passed++;
    }
    const trigger = page.getByRole("button", { name: "About this demo" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "A safe place to explore" });
    await dialog.waitFor();
    for (let n = 0; n < 8; n++) {
      await page.keyboard.press("Tab");
      assert.ok(await dialog.evaluate((d) => d.contains(document.activeElement)), "Modal focus escaped");
    }
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await trigger.evaluate((el) => document.activeElement === el), true, "Focus not restored");
    passed++;
    await page.screenshot({ path: `artifacts/demo-${width}.png`, fullPage: true });
    await page.goto(`${base}/fixtures/${id}`);
    await page.getByRole("heading", { name: /Riverside Community Cup/ }).waitFor();
    // A dead websocket must not prevent the first HTTP load.
    await page.getByRole("button", { name: "Share QR" }).click();
    await page.getByRole("dialog", { name: "Share public link" }).waitFor();
    assert.equal(
      await page.getByRole("link", { name: `${base}/fixtures/${id}`, exact: true }).getAttribute("href"),
      `${base}/fixtures/${id}`,
    );
    passed++;
    await page.screenshot({ path: `artifacts/qr-${width}.png`, fullPage: true });
    assert.deepEqual(writes, [], "Demo/public navigation attempted an external write");
    assert.deepEqual(errors, [], `Browser errors at ${width}`);
    await context.close();
  }
  // Save a QR artifact for independent decoder verification.
  await writeFile("artifacts/qr.svg", qrSvg(`${base}/fixtures/${id}`));
  console.log(`${passed} browser checks passed at phone, tablet and desktop widths; all external traffic intercepted`);
} finally {
  await browser.close();
}
