"use server";

/**
 * Self-service jurisdiction signup — the multi-tenant front door.
 *
 * Any government can create its own tenant: portal, workspace, statute
 * profile, and data, isolated from every other tenant from the first row
 * (invariant 2 — same tenantWhere scoping as everything else). The heavy
 * lifting lives in provisionAgency, the SAME service the platform console
 * uses, so a self-signed-up tenant is indistinguishable from an
 * operator-provisioned one — and it appears in the operator's console
 * immediately, with the go-live checklist tracking its setup.
 *
 * NO GOVERNMENT EMAIL REQUIRED (2026-08-14) — see src/domain/signupPolicy.ts
 * for why the gate became a label. Deployments that want operator-only
 * onboarding set SELF_SIGNUP=off; the few that want the old .gov-only door
 * set SIGNUP_REQUIRE_GOV_EMAIL=true.
 */
import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { getRepository } from "@/db/createRepository";
import { isGovernmentEmail, SignupRateLimiter } from "@/domain/signupPolicy";
import { AccountError, provisionAgency } from "@/services/accountService";
import { defaultDeps } from "@/services/deps";

// Survives module reloads in dev; a process restart resets it (fine here).
const globalForLimiter = globalThis as unknown as { __signupLimiter?: SignupRateLimiter };
const limiter = (globalForLimiter.__signupLimiter ??= new SignupRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxPerKey: 3, // per client
  maxGlobal: 10, // deployment-wide
}));

export type SignupResult =
  | { ok: true; slug: string; ingestKey: string }
  | { ok: false; error: string };

export async function selfSignupAction(input: {
  name: string;
  slug: string;
  stateCode: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}): Promise<SignupResult> {
  if (process.env.SELF_SIGNUP === "off") {
    return { ok: false, error: "Self-service signup is disabled on this deployment." };
  }

  // A government email is a SIGNAL, not a requirement — real records
  // officers work from .org, district, authority, and personal addresses.
  // It rides the audit trail so the operator console can see who walked in.
  // A deployment that genuinely wants the strict door opts INTO it.
  const govEmail = isGovernmentEmail(input.adminEmail ?? "");
  if (process.env.SIGNUP_REQUIRE_GOV_EMAIL === "true" && !govEmail) {
    return {
      ok: false,
      error:
        "This deployment accepts government email addresses only (.gov, .mil, or your state's .us domain). Contact the deployment operator to be onboarded another way.",
    };
  }

  // Abuse gate: fixed-window limit per client + deployment-wide. With the
  // email door open this is the load-bearing guard against tenant floods.
  const hdrs = await headers();
  const clientKey = (hdrs.get("x-forwarded-for") ?? "local").split(",")[0]!.trim();
  if (!limiter.allow(clientKey, Date.now())) {
    return { ok: false, error: "Too many signups from here right now — try again in an hour." };
  }

  try {
    const repo = await getRepository();
    const { agency, ingestKey } = await provisionAgency(defaultDeps(repo), {
      name: input.name,
      slug: input.slug,
      stateCode: input.stateCode,
      admin: { name: input.adminName, email: input.adminEmail, password: input.adminPassword },
      origin: { kind: "self_signup", govEmail },
    });
    return { ok: true, slug: agency.slug, ingestKey };
  } catch (e) {
    if (e instanceof AccountError) return { ok: false, error: e.message };
    console.error("selfSignup failed", e);
    return { ok: false, error: "Something went wrong creating your workspace. Please try again." };
  }
}

/**
 * After signup: sign the new admin in and land them on their go-live
 * checklist. Redirects on success (NEXT_REDIRECT is expected).
 */
export async function signupSignInAction(input: {
  slug: string;
  email: string;
  password: string;
}): Promise<{ ok: false; error: string }> {
  try {
    await signIn("credentials", {
      kind: "staff",
      agencySlug: input.slug,
      email: input.email,
      password: input.password,
      redirectTo: `/${input.slug}/app/admin`,
    });
    return { ok: false, error: "unreachable" }; // signIn redirects on success
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, error: "Sign-in failed — use your new credentials on the staff login page." };
    }
    throw e; // NEXT_REDIRECT
  }
}
