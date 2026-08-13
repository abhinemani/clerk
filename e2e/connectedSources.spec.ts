/**
 * Connected data sources, end to end (docs/connected-sources.md phases 1–2):
 * a dataset syncs in → waits for review → an admin puts it on standing
 * publication → the NEXT period publishes itself and reaches residents →
 * a column change quarantines the slice and revokes the attestation.
 *
 * This is the loop that was verified by hand twice before being automated.
 * It runs entirely on the file-drop connector: the HTTP and Socrata
 * connectors are covered by the adapter conformance suite (with a stubbed
 * fetch), and a smoke test must not depend on a third-party portal being up.
 *
 * The drop directory is read from the admin page rather than computed, so
 * the test exercises the same path a clerk would hand their IT department.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

async function waitHydrated(page: Page): Promise<void> {
  await page.waitForSelector('html[data-hydrated="true"]');
}

/** Distinct from the seeded street-sweeping data, so assertions are exact. */
const DATASET = "e2e-parking";
const COLUMNS = "date,zone,tickets";
const TITLE = (period: string) => `E2e Parking — ${period}`;

test("connected sources: sync → review → attest → auto-publish → drift quarantines", async ({
  page,
}) => {
  // --- admin sign-in --------------------------------------------------------
  await page.goto("/riverton/app/login");
  await waitHydrated(page);
  await page.getByLabel("Email").fill("dana@riverton.gov");
  await page.getByLabel("Password").fill("riverton-demo");
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  // Generous: this spec can be the first to touch the workspace routes, and
  // a cold dev-server compile easily outruns the 5s default.
  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible({
    timeout: 60_000,
  });

  await page.goto("/riverton/app/admin/sources");
  await waitHydrated(page);

  // The page tells the office where to drop files; the test uses exactly
  // that path (per-agency, displayed — never typed by a tenant admin).
  await page.getByRole("button", { name: "file drop" }).click();
  const dropLine = page.getByText(/connected-drop/).first();
  await expect(dropLine).toBeVisible({ timeout: 30_000 });
  const dropDir = (await dropLine.textContent())?.trim();
  expect(dropDir, "the admin page must show a drop directory").toBeTruthy();
  mkdirSync(dropDir!, { recursive: true });

  const source = () =>
    page.locator(".card").filter({ hasText: "Riverton open data portal" }).first();
  const syncNow = async () => {
    await source().getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByRole("status")).toContainText(/Synced "Riverton open data portal"/, {
      timeout: 30_000,
    });
    return (await page.getByRole("status").first().textContent()) ?? "";
  };

  // --- 1. a new dataset arrives; reviewed mode holds it ---------------------
  writeFileSync(`${dropDir}/${DATASET}.2026-01.csv`, `${COLUMNS}\n2026-01-06,Downtown,12`);
  const firstSync = await syncNow();
  expect(firstSync).toContain("1 new (0 auto-published)");

  // It is NOT public: reviewed mode means a named human decides.
  await page.goto("/riverton/archive");
  await expect(page.getByText(TITLE("2026-01"))).toHaveCount(0);

  // --- 2. the admin puts the dataset on standing publication ----------------
  await page.goto("/riverton/app/admin/sources");
  await waitHydrated(page);
  const datasetRow = page.locator("div").filter({ hasText: new RegExp(`^${DATASET}`) }).last();
  await datasetRow.getByRole("button", { name: "Publish automatically…" }).click();
  // The consequences are spelled out where the click happens.
  await expect(page.getByText(/new periods of it are published to residents/)).toBeVisible();
  await page.getByRole("button", { name: "Yes, publish future slices" }).click();
  await expect(page.getByRole("status")).toContainText(/Standing publication ON/);

  // --- 3. the NEXT period publishes itself ---------------------------------
  writeFileSync(`${dropDir}/${DATASET}.2026-02.csv`, `${COLUMNS}\n2026-02-03,Downtown,9`);
  await page.reload();
  await waitHydrated(page);
  const autoSync = await syncNow();
  expect(autoSync).toContain("1 new (1 auto-published)");

  // --- 4. a resident sees it, flagged as automated city data ---------------
  const anon = await page.context().browser()!.newContext();
  const resident = await anon.newPage();
  await resident.goto("/riverton/archive");
  await expect(resident.getByText(TITLE("2026-02"))).toBeVisible();
  await expect(resident.getByText(/City data · 2026-02/)).toBeVisible();
  // INVARIANT: attesting published FUTURE slices only — January, which
  // landed before the attestation, is still waiting for its human.
  await expect(resident.getByText(TITLE("2026-01"))).toHaveCount(0);

  // --- 5. schema drift quarantines the slice AND revokes the attestation ---
  writeFileSync(
    `${dropDir}/${DATASET}.2026-03.csv`,
    `${COLUMNS},officer\n2026-03-04,Downtown,7,Kim`,
  );
  await page.reload();
  await waitHydrated(page);
  const driftSync = await syncNow();
  expect(driftSync).toContain("held for review");
  expect(driftSync).toContain("standing publication revoked");

  await resident.goto("/riverton/archive");
  await expect(resident.getByText(TITLE("2026-03"))).toHaveCount(0);
  await anon.close();
});
