/**
 * The visual redaction spine, in a real browser: a resident files a request
 * whose keywords auto-dispatch to Public Works (deterministic routing, no AI
 * key) → the department uploads a SCAN (image, no text layer) → staff open
 * the visual studio, draw a box, and burn → the minted artifact is an
 * image-only PDF. Exercises portal filing, the durable job queue, the
 * no-login task page, and both redaction entry points along the way.
 */
import { expect, test, type Page } from "@playwright/test";
import { encodeJpeg, type RasterImage } from "../src/adapters/imageCodec";

async function waitHydrated(page: Page): Promise<void> {
  await page.waitForSelector('html[data-hydrated="true"]');
}

/** A fake scanned page: white, with dark "text line" bars to redact over. */
function scanFixture(): Buffer {
  const width = 800;
  const height = 1035;
  const data = new Uint8Array(width * height * 4).fill(255);
  for (let line = 0; line < 20; line++) {
    const y0 = 60 + line * 45;
    for (let y = y0; y < y0 + 16; y++) {
      for (let x = 60; x < width - 60; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 40;
      }
    }
  }
  const image: RasterImage = { width, height, data };
  return encodeJpeg(image);
}

test("visual spine: file → auto-dispatch → scan upload → draw box → burn → image-only artifact", async ({
  page,
}) => {
  const scopeTag = `pothole records E2E ${Date.now()}`;

  // --- resident files a request; "pothole" routes to Public Works ----------
  await page.goto("/riverton/request");
  await waitHydrated(page);
  await page.getByLabel(/What records/i).fill(`All ${scopeTag} inspection photos for Elm St.`);
  await page.getByRole("button", { name: "File request" }).click();
  // The pre-filing deflection interstitial offers already-public records
  // first (working as designed) — wait for whichever comes back (the archive
  // check is a server round-trip, slow on dev cold-compile), then decline.
  const anyway = page.getByRole("button", { name: "File my request anyway" });
  const success = page.getByText(/PR-\d{4}-\d{5}/);
  await expect(anyway.or(success).first()).toBeVisible({ timeout: 30_000 });
  if (await anyway.isVisible().catch(() => false)) await anyway.click();
  await expect(success).toBeVisible({ timeout: 30_000 });

  // --- staff sign-in --------------------------------------------------------
  await page.goto("/riverton/app/login");
  await waitHydrated(page);
  await page.getByLabel("Email").fill("dana@riverton.gov");
  await page.getByLabel("Password").fill("riverton-demo");
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible();

  // --- auto-dispatch fired at filing → the task link lands in the outbox ---
  // (page.content(), not innerText: delivery bodies render collapsed.)
  let taskUrl: string | null = null;
  await expect
    .poll(
      async () => {
        await page.goto("/riverton/app/outbox");
        const html = await page.content();
        taskUrl = html.match(/http:\/\/[^\s"<)]+\/task\/[A-Za-z0-9-]+/)?.[0] ?? null;
        return taskUrl;
      },
      { timeout: 30_000, message: "auto-dispatch task email in the outbox" },
    )
    .not.toBeNull();

  // --- the department uploads the scan from the no-login task page ----------
  await page.goto(taskUrl!);
  await waitHydrated(page);
  await page.getByRole("button", { name: /Start working on this/ }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "incident-scan.jpg", mimeType: "image/jpeg", buffer: scanFixture() });
  await page.getByRole("button", { name: /Submit 1 record/ }).click();
  await expect(page.getByText(/Submitted to .* records office/)).toBeVisible();

  // --- staff: request → text studio hands off to the visual studio ---------
  await page.goto("/riverton/app");
  await page.getByRole("link", { name: new RegExp(scopeTag.slice(0, 30)) }).first().click();
  await page.getByRole("link", { name: "Redact" }).click();
  await waitHydrated(page);
  // Entry differs by review-set shape: the empty-state button when nothing
  // has text, the per-doc chip when other text docs exist. Accept either.
  await page
    .getByRole("link", { name: /visual redaction studio|visual studio/i })
    .first()
    .click();
  await waitHydrated(page);

  // --- draw a box over the top of the page and burn -------------------------
  const surface = page.locator('img[alt*="page 1"]');
  // Generous: this is the only spec that touches the page-image route, so
  // its first hit pays the dev-server compile before any bytes arrive —
  // a broken image has zero size, which Playwright reads as "hidden".
  await expect(surface).toBeVisible({ timeout: 30_000 });
  const bb = (await surface.boundingBox())!;
  await page.mouse.move(bb.x + bb.width * 0.1, bb.y + bb.height * 0.05);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width * 0.9, bb.y + bb.height * 0.2, { steps: 5 });
  await page.mouse.up();
  if (process.env.E2E_CAPTURE_DIR) {
    await page.screenshot({ path: `${process.env.E2E_CAPTURE_DIR}/visual-studio-box-drawn.png` });
  }
  await page.getByRole("button", { name: /Finalize 1 redaction/ }).click();
  await page.getByRole("button", { name: "Burn & mint release copy" }).click();
  await expect(page.getByText(/Burned release copy minted/)).toBeVisible({ timeout: 15_000 });
  if (process.env.E2E_CAPTURE_DIR) {
    await page.screenshot({ path: `${process.env.E2E_CAPTURE_DIR}/visual-studio-burned.png` });
  }

  // --- the artifact is a real, image-only PDF -------------------------------
  const artifactHref = await page.getByRole("link", { name: "View burned PDF" }).getAttribute("href");
  // page.request shares the staff session cookie (the artifact is internal —
  // the files gate rightly 403s anonymous fetches).
  const res = await page.request.get(artifactHref!);
  expect(res.status()).toBe(200);
  const body = await res.body();
  expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(body.toString("latin1")).toContain("/DCTDecode"); // image page, not text
});
