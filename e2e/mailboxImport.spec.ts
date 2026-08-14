/**
 * Mailbox import in a real browser: staff open a request, upload an mbox
 * export, preview (count + subjects), confirm — every message and attachment
 * lands in the review set, searchable and redactable.
 */
import { expect, test, type Page } from "@playwright/test";

async function waitHydrated(page: Page): Promise<void> {
  await page.waitForSelector('html[data-hydrated="true"]');
}

const CRLF = "\r\n";

function message(subject: string, body: string, attachment?: { name: string; content: string }): string {
  const head = [
    "From: Marcus Bell <mbell@riverton.gov>",
    "To: dana@riverton.gov",
    "Date: Tue, 14 Jan 2025 09:30:00 -0800",
    `Subject: ${subject}`,
  ];
  if (!attachment) return [...head, "Content-Type: text/plain", "", body].join(CRLF);
  return [
    ...head,
    'Content-Type: multipart/mixed; boundary="BB"',
    "",
    "--BB",
    "Content-Type: text/plain",
    "",
    body,
    "--BB",
    `Content-Type: text/plain; name="${attachment.name}"`,
    `Content-Disposition: attachment; filename="${attachment.name}"`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(attachment.content).toString("base64"),
    "--BB--",
  ].join(CRLF);
}

test("mailbox import: upload mbox → preview → messages + attachments in the review set", async ({ page }) => {
  const tag = `E2E-mail-${Date.now()}`;
  const mbox = Buffer.from(
    [
      `From x Tue Jan 14 09:30:00 2025\n${message(`${tag} paving schedule`, "Attached as requested.", { name: `${tag}-schedule.txt`, content: "Elm St paving: March 3-7." })}\n`,
      `From x Tue Jan 14 09:31:00 2025\n${message(`Re: ${tag} paving schedule`, "Thanks, received.")}\n`,
    ].join("\n"),
    "latin1",
  );

  // Staff sign-in → any open request's detail page.
  await page.goto("/riverton/app/login");
  await waitHydrated(page);
  await page.getByLabel("Email").fill("dana@riverton.gov");
  await page.getByLabel("Password").fill("riverton-demo");
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible();
  await page.locator("table.queue tbody tr a").first().click();
  await waitHydrated(page);

  // Upload → preview → confirm. The request detail page is the heaviest
  // first-compile in the suite — give it the same 15s the preview gets
  // (HANDOFF flake watch: this expect timed out at the default 5s twice).
  await expect(page.getByText("Import a mailbox export")).toBeVisible({ timeout: 15_000 });
  await page
    .locator('input[type="file"][accept*=".mbox"]')
    .setInputFiles({ name: "bell-export.mbox", mimeType: "application/mbox", buffer: mbox });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText(/2 messages/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`${tag} paving schedule`).first()).toBeVisible();
  await page.getByRole("button", { name: /Import 2 messages into the review set/ }).click();
  await expect(page.getByText(/2 messages and 1 attachment added to the review set/)).toBeVisible({
    timeout: 20_000,
  });

  // The exploded documents are real review-set rows on the request page.
  await page.reload();
  await waitHydrated(page);
  await expect(page.getByText(new RegExp(`${tag}-paving-schedule`)).first()).toBeVisible();
  await expect(page.getByText(`${tag}-schedule.txt`).first()).toBeVisible();
});
