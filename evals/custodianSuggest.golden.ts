/**
 * Golden dataset for the custodian-suggestion evals (inter-agency referral,
 * phase 2).
 *
 * Graded PRECISION-FIRST — the mirror image of the exemption pass. A false
 * referral bounces a resident who came to the RIGHT office: they lose the
 * statutory clock they'd already started and re-file from zero. A missed
 * referral just means staff work the request the way they would have anyway.
 * So most of these cases are requests that plainly DO belong to the agency,
 * and the eval's hard gate is that none of them draw a referral.
 *
 * A couple of referral cases are marked mustCatch: they're so unambiguous
 * (student discipline → the school district) that missing them means the
 * feature is dead weight. Those gate too — but softer referral cases only
 * report recall.
 */
import type { CustodianSuggestInput } from "@/ai/pipelines/custodianSuggest";

export interface CustodianGoldenCase {
  id: string;
  /** Human note on what this case is probing. */
  intent: string;
  input: CustodianSuggestInput;
  expect: {
    /** True = the agency holds (some of) these records; any referral is a false one. */
    belongsToThisAgency: boolean;
    /** For referral cases: the directory entry the model should point at. */
    expectedEntryId?: string;
    /** Referral so unambiguous that missing it gates the eval. */
    mustCatch?: boolean;
  };
}

/** One shared directory — the City of Riverton's plausible neighbors. */
export const RIVERTON_DIRECTORY = [
  {
    id: "dir-school",
    name: "Riverton Unified School District",
    recordTypes: ["student records", "school personnel files", "school board minutes"],
    notes: "Separate legal entity from the city — the city holds no school records.",
  },
  {
    id: "dir-court",
    name: "Marlin County Superior Court",
    recordTypes: ["court case files", "divorce records", "probate records"],
    notes: "Judicial records are not subject to the PRA; the court has its own access rules.",
  },
  {
    id: "dir-dmv",
    name: "State Department of Motor Vehicles",
    recordTypes: ["driver license records", "vehicle registration"],
  },
  {
    id: "dir-assessor",
    name: "Marlin County Assessor",
    recordTypes: ["property tax assessments", "parcel ownership records"],
  },
];

const base = { agencyName: "City of Riverton", directory: RIVERTON_DIRECTORY };

export const CUSTODIAN_GOLDEN: CustodianGoldenCase[] = [
  {
    id: "ours-police-report",
    intent: "The city's own police records — the bread-and-butter request. Referring this is the worst failure.",
    input: {
      ...base,
      interpretedScope:
        "Incident report for the March 12, 2026 traffic collision at 400 Main Street, Riverton.",
      recordTypes: ["police incident reports"],
    },
    expect: { belongsToThisAgency: true },
  },
  {
    id: "ours-council-minutes",
    intent: "City council minutes are the city's records, full stop.",
    input: {
      ...base,
      interpretedScope: "Minutes and agendas for all Riverton city council meetings in 2025.",
      recordTypes: ["meeting minutes", "agendas"],
    },
    expect: { belongsToThisAgency: true },
  },
  {
    id: "ours-mixed-scope",
    intent: "Mixed request: permits (ours) + school board minutes (theirs). Fulfill our part — never bounce the whole thing.",
    input: {
      ...base,
      interpretedScope:
        "Building permits issued for the Oakview school campus expansion, plus school board minutes discussing the project.",
      recordTypes: ["building permits", "school board minutes"],
    },
    expect: { belongsToThisAgency: true },
  },
  {
    id: "ours-vague-scope",
    intent: "Too vague to place anywhere — unsure must resolve to 'ours'.",
    input: {
      ...base,
      interpretedScope: "Any records about problems in the Larkspur Lane neighborhood over the last year.",
      recordTypes: [],
    },
    expect: { belongsToThisAgency: true },
  },
  {
    id: "ours-property-file",
    intent: "Assessor decoy: code-enforcement history is the CITY's even though the parcel appears in county rolls.",
    input: {
      ...base,
      interpretedScope: "Code enforcement complaints and inspection history for the property at 88 Larkspur Lane.",
      recordTypes: ["code enforcement records", "inspection reports"],
    },
    expect: { belongsToThisAgency: true },
  },
  {
    id: "refer-student-discipline",
    intent: "The canonical wrong-custodian request — a city never holds student discipline files.",
    input: {
      ...base,
      interpretedScope:
        "Disciplinary records for a student at Riverton High School during the 2025–2026 school year.",
      recordTypes: ["student discipline records"],
    },
    expect: { belongsToThisAgency: false, expectedEntryId: "dir-school", mustCatch: true },
  },
  {
    id: "refer-divorce-file",
    intent: "Court records are the judiciary's — clearly not the city's.",
    input: {
      ...base,
      interpretedScope: "The complete case file for a 2024 divorce proceeding filed in Marlin County.",
      recordTypes: ["court case files"],
    },
    expect: { belongsToThisAgency: false, expectedEntryId: "dir-court", mustCatch: true },
  },
  {
    id: "refer-drivers-license",
    intent: "Softer referral: license history lives at the DMV. Missing this reports, not gates.",
    input: {
      ...base,
      interpretedScope: "The driving record and license status history for a named individual.",
      recordTypes: ["driver license records"],
    },
    expect: { belongsToThisAgency: false, expectedEntryId: "dir-dmv" },
  },
];
