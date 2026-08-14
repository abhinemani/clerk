"use server";

/**
 * Walkthrough requests — the marketing site's primary CTA ("Book a
 * walkthrough").
 *
 * SELF-CONTAINED FIRST: the DB row is the record and it is written on every
 * deployment, with zero services configured. Email notification is a
 * best-effort extra layered on top (same principle as deliveries: the row is
 * the audit, delivery is the bonus) — if no provider is configured, or the
 * provider is down, the submission still succeeds and the operator console
 * still shows it. A deployment that has pointed DEMO_SCHEDULING_URL at a real
 * scheduler never reaches this action at all; the CTA links straight out.
 *
 * This is the ONE write path a logged-out stranger can reach, so: pure
 * validation up front (domain/demoRequest.ts), the same fixed-window rate
 * limiter /signup uses, and a honeypot that reports success without storing.
 */
import { headers } from "next/headers";
import { getEmailSender } from "@/adapters/email";
import { branding } from "@/config/branding";
import { getRepository } from "@/db/createRepository";
import {
  isHoneypotRejection,
  validateDemoRequest,
  type DemoRequestInput,
} from "@/domain/demoRequest";
import { SignupRateLimiter } from "@/domain/signupPolicy";

// Survives module reloads in dev; a process restart resets it (fine here).
const globalForLimiter = globalThis as unknown as { __demoLimiter?: SignupRateLimiter };
const limiter = (globalForLimiter.__demoLimiter ??= new SignupRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxPerKey: 5, // per client — a person correcting a typo shouldn't be locked out
  maxGlobal: 60, // deployment-wide
}));

export type DemoRequestResult = { ok: true } | { ok: false; error: string };

export async function requestWalkthroughAction(
  input: DemoRequestInput,
): Promise<DemoRequestResult> {
  const validated = validateDemoRequest(input);
  if (!validated.ok) {
    // A bot learns nothing: the honeypot path looks exactly like success.
    if (isHoneypotRejection(validated)) return { ok: true };
    return { ok: false, error: validated.error };
  }

  const hdrs = await headers();
  const clientKey = (hdrs.get("x-forwarded-for") ?? "local").split(",")[0]!.trim();
  if (!limiter.allow(clientKey, Date.now())) {
    return {
      ok: false,
      error: `Too many requests from here right now. Email ${branding.supportEmail} and we'll set something up.`,
    };
  }

  const row = { id: crypto.randomUUID(), ...validated.value, createdAt: new Date() };

  try {
    const repo = await getRepository();
    await repo.createDemoRequest(row);
  } catch (e) {
    console.error("demo request save failed", e);
    return {
      ok: false,
      error: `Something went wrong on our end. Email ${branding.supportEmail} and we'll pick it up from there.`,
    };
  }

  // Best effort from here down — never fail a submission we've already stored.
  const notify = (process.env.DEMO_NOTIFY_EMAIL ?? "").trim();
  const sender = getEmailSender();
  if (notify && sender) {
    try {
      await sender.send({
        to: notify,
        replyTo: row.email,
        subject: `Walkthrough request — ${row.organization}`,
        text: [
          `${row.name} <${row.email}>`,
          `${row.organization}${row.stateCode ? ` (${row.stateCode})` : ""}`,
          row.role ? `Role: ${row.role}` : null,
          row.source ? `From: ${row.source}` : null,
          "",
          row.notes ?? "(no notes)",
        ]
          .filter((l) => l !== null)
          .join("\n"),
      });
    } catch (e) {
      console.error("demo request notification failed (row is saved)", e);
    }
  }

  return { ok: true };
}
