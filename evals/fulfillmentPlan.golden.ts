/**
 * Golden dataset for the fulfillment-plan evals (spec §13, §16.1 — the
 * scope-decomposition golden set gating the fulfillment agent's planner).
 *
 * Each case asserts the stable, gradeable properties of a good decomposition
 * (parts of the request covered by search queries, department routing only
 * from the provided list, item count in a sane band), never exact wording —
 * so the eval is robust to phrasing.
 */
import type { FulfillmentPlanOutput } from "@/ai/pipelines/fulfillmentPlan";
import type { FulfillmentPlanPromptInput } from "@/ai/prompts/fulfillmentPlan";

export interface FulfillmentGoldenCase {
  id: string;
  input: FulfillmentPlanPromptInput;
  expect: {
    /** Inclusive item-count band the decomposition should land in. */
    itemBand: [number, number];
    /** Terms that MUST appear in some item's search_query (CI substring). */
    queriesInclude?: string[];
    /** Departments that MUST be assigned to at least one item. */
    departmentsExpected?: string[];
    /** Terms that must NOT appear anywhere in the plan (no invented scope). */
    planExcludes?: string[];
    /** True when every item's department must be null. */
    noDepartments?: boolean;
  };
}

const RIVERTON_DEPTS = [
  { name: "Public Works", description: "Streets, inspections, permits, repairs." },
  { name: "Police Records", description: "Incident reports, bodycam, 911 audio." },
  { name: "City Clerk", description: "Contracts, minutes, ordinances, budgets." },
];

export const FULFILLMENT_GOLDEN: FulfillmentGoldenCase[] = [
  {
    id: "simple-single-record",
    input: {
      interpretedScope: "The current janitorial services contract for City Hall.",
      recordTypes: ["contracts"],
      departments: RIVERTON_DEPTS,
    },
    expect: {
      itemBand: [1, 2],
      queriesInclude: ["janitorial"],
      departmentsExpected: ["City Clerk"],
      planExcludes: ["police"],
    },
  },
  {
    id: "multi-part-project",
    input: {
      interpretedScope:
        "Emails between city staff and Acme Development about the Riverside project, plus the project's building permits and inspection reports, 2023 to present.",
      recordTypes: ["emails", "permits", "inspection reports"],
      departments: RIVERTON_DEPTS,
    },
    expect: {
      itemBand: [2, 6],
      queriesInclude: ["Riverside", "permit", "inspection"],
      departmentsExpected: ["Public Works"],
    },
  },
  {
    id: "incident-two-systems",
    input: {
      interpretedScope:
        "Body-camera footage and the incident report for the arrest at 5th and Main on June 3, 2026.",
      recordTypes: ["body-cam footage", "police reports"],
      departments: RIVERTON_DEPTS,
    },
    expect: {
      itemBand: [1, 4],
      queriesInclude: ["5th", "incident"],
      departmentsExpected: ["Police Records"],
    },
  },
  {
    id: "department-guardrail",
    input: {
      // No listed department plausibly holds payroll ledgers — the planner
      // must leave departments null rather than invent "Finance".
      interpretedScope: "Payroll ledgers for all lifeguard staff, summer 2025.",
      recordTypes: ["payroll records"],
      departments: [{ name: "Parks & Recreation", description: "Parks, pools, programs." }],
    },
    expect: {
      itemBand: [1, 3],
      queriesInclude: ["payroll"],
      planExcludes: ["Finance"],
    },
  },
  {
    id: "no-departments-provided",
    input: {
      interpretedScope: "Minutes of the Planning Commission meetings from March 2026.",
      recordTypes: ["meeting minutes"],
      departments: [],
    },
    expect: {
      itemBand: [1, 2],
      queriesInclude: ["minutes"],
      noDepartments: true,
      planExcludes: ["police"],
    },
  },
  {
    id: "broad-incident-multi-department",
    input: {
      interpretedScope:
        "All records about the Main Street sinkhole: 911 call audio, incident reports, emergency repair contracts, and any council discussion of the repairs.",
      recordTypes: ["911 audio", "police reports", "contracts", "meeting minutes"],
      departments: RIVERTON_DEPTS,
    },
    expect: {
      itemBand: [3, 6],
      queriesInclude: ["sinkhole", "911", "contract"],
      departmentsExpected: ["Police Records", "Public Works"],
    },
  },
];

export type { FulfillmentPlanOutput };
