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
 * Deployments that want operator-only onboarding set SELF_SIGNUP=off.
 */
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { getRepository } from "@/db/createRepository";
import { AccountError, provisionAgency } from "@/services/accountService";
import { defaultDeps } from "@/services/deps";

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
  try {
    const repo = await getRepository();
    const { agency, ingestKey } = await provisionAgency(defaultDeps(repo), {
      name: input.name,
      slug: input.slug,
      stateCode: input.stateCode,
      admin: { name: input.adminName, email: input.adminEmail, password: input.adminPassword },
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
