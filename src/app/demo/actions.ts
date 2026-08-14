"use server";

/**
 * Walkthrough scheduling — the marketing site's second call to action.
 *
 * Thin shell over pure code, same shape as the signup action: validate
 * (src/domain/demoRequest.ts) → persist → best-effort notify. THE ROW IS THE
 * RECORD; the email is the extra step. A default deployment has no email
 * provider (self-contained first), so a lead must never depend on one — every
 * submission lands in `demo_requests` and shows up in the platform console
 * whether or not anything is delivered.
 *
 * Two optional env vars, both absent by default:
 *   DEMO_REQUEST_EMAIL   where to notify when a provider IS configured
 *   DEMO_SCHEDULING_URL  an external booking page, offered alongside the form
 */
import { headers } from "next/headers";
import { getEmailSender } from "@/adapters/email";
import { getRepository } from "@/db/createRepository";
import { SignupRateLimiter } from "@/domain/signupPolicy";
import { demoRequestEmail, parseDemoRequest, type DemoRequestInput } from "@/domain/demoRequest";

// Same fixed-window limiter the signup door uses; a separate instance so a
// burst of demo requests can't consume the signup budget or vice versa.
// Survives module reloads in dev; a process restart resets it (fine here).
const globalForLimiter = globalThis as unknown as { __demoLimiter?: SignupRateLimiter };
const limiter = (globalForLimiter.__demoLimiter ??= new SignupRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxPerKey: 5,
  maxGlobal: 60,
}));

export type DemoRequestResult = { ok: true } | { ok: false; error: string };

export async function requestDemoAction(input: DemoRequestInput): Promise<DemoRequestResult> {
  const parsed = parseDemoRequest(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const hdrs = await headers();
  const clientKey = (hdrs.get("x-forwarded-for") ?? "local").split(",")[0]!.trim();
  if (!limiter.allow(clientKey, Date.now())) {
    return { ok: false, error: "That's a lot of requests from one place — try again in an hour." };
  }

  try {
    const repo = await getRepository();
    await repo.createDemoRequest({
      id: crypto.randomUUID(),
      ...parsed.value,
      status: "new",
      createdAt: new Date(),
    });
  } catch (e) {
    console.error("demo request failed to persist", e);
    return { ok: false, error: "Something went wrong on our side. Please try again." };
  }

  // Notification is best effort by design: the row is already safe, so a
  // provider outage must not tell a visitor their request didn't land.
  const to = process.env.DEMO_REQUEST_EMAIL;
  const sender = getEmailSender();
  if (to && sender) {
    const mail = demoRequestEmail(parsed.value);
    try {
      await sender.send({ to, subject: mail.subject, text: mail.text, replyTo: parsed.value.email });
    } catch (e) {
      console.error("demo request notification failed (row is saved)", e);
    }
  }

  return { ok: true };
}
