/**
 * Auth.js (next-auth v5) configuration — one credentials provider, two kinds
 * of principal, always agency-scoped:
 *
 *   kind = "requester" → residents signing in to an agency's portal
 *   kind = "staff"     → agency officials signing in to the workspace
 *
 * Sessions are JWTs (no session table); the token carries the principal's
 * kind, agency, and staff role, so every server component can authorize
 * without a DB read. Passwords are verified through the account service over
 * the same Repository port everything else uses.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getRepository } from "@/db/createRepository";
import { defaultDeps } from "@/services/deps";
import { authenticateRequester, authenticateStaff } from "@/services/accountService";
import type { StaffRole } from "@/services/repository";
import { clearFailures, isLockedOut, recordFailure } from "./throttle";

export type PrincipalKind = "staff" | "requester" | "platform";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      kind: PrincipalKind;
      /** Absent for the platform operator (cross-tenant). */
      agencyId?: string;
      agencySlug?: string;
      /** Staff only. */
      role?: StaffRole;
      /** Which database this token was minted against (src/lib/instance.ts). */
      inst?: string;
    } & DefaultSession["user"];
  }
  interface User {
    kind: PrincipalKind;
    agencyId?: string;
    agencySlug?: string;
    role?: StaffRole;
  }
}

/**
 * The platform operator (Holmes's own admin — manages every tenant). A single
 * account from the environment, not a tenant row: set PLATFORM_ADMIN_EMAIL and
 * PLATFORM_ADMIN_PASSWORD in production. Dev falls back to a printed default.
 */
export const PLATFORM_ADMIN = {
  email: process.env.PLATFORM_ADMIN_EMAIL ?? "admin@holmes.example",
  password: process.env.PLATFORM_ADMIN_PASSWORD ?? "holmes-admin-dev",
};

/** Length-independent constant-time string comparison (hash both sides). */
function constantTimeEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Session-signing secret. In production a missing AUTH_SECRET is a hard boot
 * failure — the dev fallback is public knowledge, and shipping it would make
 * every session forgeable.
 */
function resolveAuthSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  // `next build` evaluates this module with NODE_ENV=production but no env —
  // enforce at runtime only, so a server actually SERVING without a secret
  // refuses to come up.
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  if (process.env.NODE_ENV === "production" && !isBuildPhase) {
    throw new Error(
      "AUTH_SECRET is required in production (any long random string). Refusing to start with the known dev secret.",
    );
  }
  return "holmes-dev-secret-set-AUTH_SECRET-in-prod";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: resolveAuthSecret(),
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        agencySlug: {},
        kind: {},
        email: {},
        password: {},
      },
      async authorize(credentials) {
        const agencySlug = String(credentials?.agencySlug ?? "");
        const kind = String(credentials?.kind ?? "") as PrincipalKind;
        const email = String(credentials?.email ?? "");
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        // Sliding-window lockout: 5 failures / 15 min per principal.
        if (isLockedOut(kind, agencySlug, email)) return null;
        const failed = () => {
          recordFailure(kind, agencySlug, email);
          return null;
        };

        // Platform operator — env credentials, cross-tenant, no agency scope.
        if (kind === "platform") {
          const emailOk = email.trim().toLowerCase() === PLATFORM_ADMIN.email.toLowerCase();
          if (!emailOk || !constantTimeEquals(password, PLATFORM_ADMIN.password)) return failed();
          clearFailures(kind, agencySlug, email);
          return { id: "platform-admin", email: PLATFORM_ADMIN.email, name: "Platform admin", kind: "platform" };
        }

        if (!agencySlug || (kind !== "staff" && kind !== "requester")) return null;

        const repo = await getRepository();
        const agency = await repo.getAgencyBySlug(agencySlug);
        if (!agency) return null;
        const deps = defaultDeps(repo);

        if (kind === "staff") {
          const user = await authenticateStaff(deps, { agencyId: agency.id, email, password });
          if (!user) return failed();
          clearFailures(kind, agencySlug, email);
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            kind: "staff",
            agencyId: agency.id,
            agencySlug: agency.slug,
            role: user.role,
          };
        }
        const requester = await authenticateRequester(deps, { agencyId: agency.id, email, password });
        if (!requester) return failed();
        clearFailures(kind, agencySlug, email);
        return {
          id: requester.id,
          email: requester.email,
          name: requester.name,
          kind: "requester",
          agencyId: agency.id,
          agencySlug: agency.slug,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.kind = user.kind;
        token.agencyId = user.agencyId;
        token.agencySlug = user.agencySlug;
        token.role = user.role;
        // Bind the token to THIS database. Guards reject tokens whose claim
        // doesn't match — cookies from other deployments (or recreated dev
        // databases) sharing AUTH_SECRET stop working here.
        const { getInstanceId } = await import("@/lib/instance");
        token.inst = await getInstanceId();
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub as string;
      session.user.kind = token.kind as PrincipalKind;
      session.user.agencyId = token.agencyId as string;
      session.user.agencySlug = token.agencySlug as string;
      session.user.role = token.role as StaffRole | undefined;
      session.user.inst = token.inst as string | undefined;
      return session;
    },
  },
  pages: {
    // There is no global sign-in page — each agency has its own; guards
    // redirect there with the agency slug in hand.
    signIn: "/",
  },
});
