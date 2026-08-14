/**
 * Go-live checklist for a freshly provisioned agency (onboarding).
 *
 * Every step is COMPUTED from what actually exists — nothing is manually
 * ticked, so the checklist can't drift from reality. "Required" steps are the
 * ones without which core flows break (dispatch needs a department; deadlines
 * need a statute profile). "Recommended" steps are what separates a portal
 * that merely accepts requests from one that deflects, refers, and notifies.
 *
 * Pure function — the UI renders it, the platform console summarizes it.
 */

export interface SetupSignals {
  staffCount: number;
  departmentCount: number;
  routingRuleCount: number;
  directoryCount: number;
  /** Public records in the archive (powers deflection + answer-by-link). */
  publicRecordCount: number;
  requestCount: number;
  hasStatuteProfile: boolean;
  /** Counsel sign-off recorded on the statute profile (trust surface). */
  statuteReviewed: boolean;
  /** Outbound email provider configured (deployment-wide env). */
  emailConfigured: boolean;
}

export interface SetupStep {
  key: string;
  title: string;
  /** Why this matters, in one sentence a records clerk believes. */
  detail: string;
  done: boolean;
  required: boolean;
  /** Path within the agency workspace that fixes it (null = not fixable in UI). */
  href: string | null;
}

export interface SetupStatus {
  steps: SetupStep[];
  doneCount: number;
  totalCount: number;
  requiredRemaining: number;
  complete: boolean;
}

export function computeSetupStatus(s: SetupSignals): SetupStatus {
  const steps: SetupStep[] = [
    {
      key: "statute",
      title: "Statute profile",
      detail: s.hasStatuteProfile
        ? "Deadlines compute from your state's public-records statute."
        : "No statute profile for your state yet — deadlines can't be computed. Contact your operator.",
      done: s.hasStatuteProfile,
      required: true,
      href: null, // profiles are code+data, reviewed — not a UI toggle
    },
    {
      key: "departments",
      title: "Create your departments",
      detail:
        "Dispatch sends each request to the department that holds the records — without one, nothing can be routed.",
      done: s.departmentCount > 0,
      required: true,
      href: "admin#departments",
    },
    {
      key: "statute-review",
      title: "Counsel sign-off",
      detail: s.statuteReviewed
        ? "Your counsel verified the statute profile against current law."
        : "Have your counsel confirm the deadlines and exemptions match current law, and record it.",
      done: s.statuteReviewed,
      required: false,
      href: "admin#compliance",
    },
    {
      key: "staff",
      title: "Add your team",
      detail: "Coordinators run requests; responders fulfill department tasks with their own logins.",
      done: s.staffCount > 1, // the provisioning admin alone doesn't count
      required: false,
      href: "admin",
    },
    {
      key: "routing",
      title: "Set routing rules",
      detail:
        "Keyword rules route obvious requests to the right department instantly — no AI key needed.",
      done: s.routingRuleCount > 0,
      required: false,
      href: "admin",
    },
    {
      key: "directory",
      title: "Build the referral directory",
      detail:
        "When records belong to another agency, staff refer instead of denying — residents get a real next step.",
      done: s.directoryCount > 0,
      required: false,
      href: "admin/directory",
    },
    {
      key: "archive",
      title: "Publish or import records",
      detail:
        "A stocked public archive deflects requests before they're filed and lets staff answer with a link.",
      done: s.publicRecordCount > 0,
      required: false,
      href: "admin/data",
    },
    {
      key: "email",
      title: "Connect email delivery",
      detail: s.emailConfigured
        ? "Requesters get milestone and outcome emails."
        : "Outbox-only mode: letters are recorded but not delivered. Set EMAIL_FROM and a provider key.",
      done: s.emailConfigured,
      required: false,
      href: null, // env-level, deployment-wide
    },
    {
      key: "first-request",
      title: "File a test request",
      detail: "Walk one request through portal → dispatch → release to see the whole spine work.",
      done: s.requestCount > 0,
      required: false,
      href: null, // it's the portal, not the workspace
    },
  ];

  const doneCount = steps.filter((x) => x.done).length;
  const requiredRemaining = steps.filter((x) => x.required && !x.done).length;
  return {
    steps,
    doneCount,
    totalCount: steps.length,
    requiredRemaining,
    complete: doneCount === steps.length,
  };
}
