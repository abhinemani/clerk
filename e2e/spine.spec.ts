/**
 * The spine, end to end, in a real browser: staff sign-in → records CSV
 * import → publication queue → named-human publish → the record is live in
 * the PUBLIC archive. If this passes, the demo works; everything here runs
 * against the same seeded PGlite deploy shape as `SEED_DEMO=true` production.
 *
 * One journey on purpose — this is a smoke, not a suite. Deeper behavior
 * lives in the unit/conformance tests.
 */
import { expect, test, type Page } from "@playwright/test";

/**
 * Forms submitted before React hydrates perform a native GET (the repo's
 * oldest automation gotcha) — always wait for the layout's hydration stamp
 * before interacting.
 */
async function waitHydrated(page: Page): Promise<void> {
  await page.waitForSelector('html[data-hydrated="true"]');
}

test("spine: sign in → import a record → publish it → it's in the public archive", async ({ page }) => {
  const runTag = `E2E smoke ${Date.now()}`;

  // --- staff sign-in --------------------------------------------------------
  await page.goto("/riverton/app/login");
  await waitHydrated(page);
  await page.getByLabel("Email").fill("dana@riverton.gov");
  await page.getByLabel("Password").fill("riverton-demo");
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible();

  // --- import one record via CSV -------------------------------------------
  await page.goto("/riverton/app/admin/records-import");
  await waitHydrated(page);
  await page
    .getByPlaceholder(/Paste CSV text here/)
    .fill(["title,summary,record_type", `"${runTag}","Imported by the e2e smoke",report`].join("\n"));
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("1 of 1 rows ready")).toBeVisible();
  await page.getByRole("button", { name: /Import 1 record/ }).click();
  await expect(page.getByText("1 record imported.")).toBeVisible();

  // --- it lands UNDECIDED (never public from a bulk import) ----------------
  await page.goto("/riverton/app/records");
  await waitHydrated(page);
  const row = page.locator("li", { hasText: runTag }).first();
  await expect(row).toBeVisible();

  // --- named-human publish ---------------------------------------------------
  await row.getByRole("button", { name: "Publish…" }).click();
  await row.getByRole("button", { name: "Publish to the public archive" }).click();
  // The queue refreshes (and the panel remounts) after the decision — the row
  // leaving the Undecided tab IS the observable outcome.
  await expect(page.locator("li", { hasText: runTag })).toHaveCount(0, { timeout: 15_000 });

  // --- the public archive (no auth needed) shows it -------------------------
  await page.goto("/riverton/archive");
  await expect(page.getByRole("heading", { name: runTag })).toBeVisible();
});
