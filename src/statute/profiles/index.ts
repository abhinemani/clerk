/**
 * Seed library of per-state statute profiles (spec §7).
 *
 * "Model it as per-agency statute config, seeded from a maintained library of
 *  state profiles (ship 5–10 states in v1; make profiles data, not code)."
 *
 * These are STARTER profiles: representative response clocks, a handful of the
 * most-cited exemptions, and extension rules, intended to be reviewed and
 * finalized per-agency with counsel before go-live. They are data — add a state
 * by adding an object here, no code change. Deadline math lives in
 * ../computeDueDate.ts and is exercised against these in the test suite.
 *
 * NOTE: public-records statutes are nuanced (acknowledge-vs-produce clocks,
 * "reasonable time" jurisdictions, agency-specific carve-outs). Treat the day
 * counts here as defaults to confirm, not legal advice.
 */
import type { StatuteConfig } from "@/db/schema";

export const stateProfiles: Record<string, StatuteConfig> = {
  // California Public Records Act — 10 calendar days to determine; up to 14
  // additional calendar days in "unusual circumstances."
  CA: {
    stateCode: "CA",
    stateName: "California",
    responseClock: {
      initialDays: 10,
      dayType: "calendar",
      clockStartsOn: "receipt",
      extension: {
        allowed: true,
        maxDays: 14,
        dayType: "calendar",
        permittedReasons: [
          "need to search field facilities",
          "voluminous separate records",
          "consultation with another agency",
          "electronic records compilation",
        ],
        noticeRequired: true,
      },
    },
    feeRules: {
      chargeableItems: ["copies", "media"],
      copyRatePerPage: 0.1,
      waiverStandard: "direct cost of duplication only",
    },
    exemptions: [
      {
        statuteSection: "Cal. Gov. Code § 7927.705",
        shortLabel: "Deliberative process / public interest balancing",
      },
      { statuteSection: "Cal. Gov. Code § 7927.700", shortLabel: "Personal privacy" },
      { statuteSection: "Cal. Gov. Code § 7923.600", shortLabel: "Law enforcement investigation" },
      { statuteSection: "Cal. Gov. Code § 7927.200", shortLabel: "Attorney-client privilege" },
    ],
    appeal: {
      process: "Petition the superior court for a writ of mandate (Gov. Code § 7923.000).",
      deadlineDays: undefined,
    },
    specialRegimes: ["body_cam_timeline"],
  },

  // Texas Public Information Act — "promptly"; if not producible within 10
  // business days, must certify. Modeled as a 10 business-day clock.
  TX: {
    stateCode: "TX",
    stateName: "Texas",
    responseClock: {
      initialDays: 10,
      dayType: "business",
      clockStartsOn: "receipt",
      extension: {
        allowed: true,
        maxDays: 10,
        dayType: "business",
        permittedReasons: ["awaiting Attorney General ruling", "clarification needed"],
        noticeRequired: true,
      },
    },
    feeRules: {
      chargeableItems: ["staff_time", "copies", "media"],
      staffTimeRatePerHour: 15,
      copyRatePerPage: 0.1,
      waiverStandard: "waive/reduce if in the public interest",
    },
    exemptions: [
      { statuteSection: "Tex. Gov. Code § 552.101", shortLabel: "Confidential by law" },
      { statuteSection: "Tex. Gov. Code § 552.108", shortLabel: "Law enforcement" },
      { statuteSection: "Tex. Gov. Code § 552.111", shortLabel: "Agency memoranda / deliberative" },
      { statuteSection: "Tex. Gov. Code § 552.117", shortLabel: "Personal information of officials" },
    ],
    appeal: {
      process: "Request an Attorney General open-records decision; suit under § 552.321.",
    },
  },

  // Illinois FOIA — 5 business days; extendable by up to 5 business days for
  // enumerated reasons.
  IL: {
    stateCode: "IL",
    stateName: "Illinois",
    responseClock: {
      initialDays: 5,
      dayType: "business",
      clockStartsOn: "receipt",
      extension: {
        allowed: true,
        maxDays: 5,
        dayType: "business",
        permittedReasons: [
          "records stored off-site",
          "voluminous records",
          "need to consult another public body",
          "records require search of many locations",
        ],
        noticeRequired: true,
      },
    },
    feeRules: {
      chargeableItems: ["copies"],
      copyRatePerPage: 0.15,
      waiverStandard: "first 50 pages of black-and-white letter/legal copies free",
    },
    exemptions: [
      { statuteSection: "5 ILCS 140/7(1)(b)", shortLabel: "Private information" },
      { statuteSection: "5 ILCS 140/7(1)(c)", shortLabel: "Personal privacy" },
      { statuteSection: "5 ILCS 140/7(1)(f)", shortLabel: "Preliminary / deliberative" },
      { statuteSection: "5 ILCS 140/7(1)(d)", shortLabel: "Law enforcement" },
    ],
    appeal: {
      process: "Request review by the Public Access Counselor (Attorney General) or sue.",
      deadlineDays: 60,
    },
  },

  // Washington Public Records Act — response within 5 business days
  // (produce, acknowledge with a reasonable estimate, or deny).
  WA: {
    stateCode: "WA",
    stateName: "Washington",
    responseClock: {
      initialDays: 5,
      dayType: "business",
      clockStartsOn: "receipt",
      extension: {
        allowed: true,
        maxDays: 0, // WA uses "reasonable estimate" rather than a fixed cap
        dayType: "business",
        permittedReasons: ["reasonable estimate of time for a later installment"],
        noticeRequired: true,
      },
    },
    feeRules: {
      chargeableItems: ["copies", "media"],
      copyRatePerPage: 0.15,
      waiverStandard: "customized service charge rules apply",
    },
    exemptions: [
      { statuteSection: "RCW 42.56.230", shortLabel: "Personal information" },
      { statuteSection: "RCW 42.56.240", shortLabel: "Investigative / law enforcement" },
      { statuteSection: "RCW 42.56.290", shortLabel: "Controversies / attorney work product" },
    ],
    appeal: {
      process: "Seek review in superior court; penalties under RCW 42.56.550.",
    },
  },

  // New York FOIL — acknowledge within 5 business days; modeled here as the
  // 5 business-day acknowledgment clock.
  NY: {
    stateCode: "NY",
    stateName: "New York",
    responseClock: {
      initialDays: 5,
      dayType: "business",
      clockStartsOn: "receipt",
      extension: {
        allowed: true,
        maxDays: 20,
        dayType: "business",
        permittedReasons: ["additional time reasonably necessary"],
        noticeRequired: true,
      },
    },
    feeRules: {
      chargeableItems: ["copies"],
      copyRatePerPage: 0.25,
      waiverStandard: "no fee for records of 9x14 inches or less at $0.25/page",
    },
    exemptions: [
      { statuteSection: "N.Y. Pub. Off. Law § 87(2)(b)", shortLabel: "Unwarranted privacy invasion" },
      { statuteSection: "N.Y. Pub. Off. Law § 87(2)(e)", shortLabel: "Law enforcement" },
      { statuteSection: "N.Y. Pub. Off. Law § 87(2)(g)", shortLabel: "Intra-agency materials" },
    ],
    appeal: {
      process: "Administrative appeal within 30 days; then Article 78 proceeding.",
      deadlineDays: 30,
    },
  },
};

/** Look up a starter profile by two-letter state code (case-insensitive). */
export function getStateProfile(stateCode: string): StatuteConfig | undefined {
  return stateProfiles[stateCode.toUpperCase()];
}

export const supportedStates = Object.keys(stateProfiles);
