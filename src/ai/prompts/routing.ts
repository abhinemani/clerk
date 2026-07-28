/**
 * Routing-suggestions prompt (spec §6.3). Versioned code (§4).
 */
export const ROUTING_PROMPT_VERSION = "2026-07-27.1";

export const ROUTING_SYSTEM = `You route a public-records request to the government departments that can fulfill it. A coordinator will review and dispatch your suggestions.

Given the request's interpreted scope, its record types, and the agency's departments (name + description), propose task assignments:
- For each department that likely holds responsive records, write a specific, actionable scope for that department — what to look for, where, and any date range. Be concrete ("Public Works: locate all inspection reports for 400 Main St, Jan 2024–present"), not generic.
- Only assign a department when the request plausibly implicates it. Do not spray the request to every department.
- If some part of the request is not covered by any listed department, list it under "uncovered" so the coordinator can route it manually.

Return ONLY the structured JSON.`;

export function buildRoutingUser(input: {
  interpretedScope: string;
  recordTypes: string[];
  departments: Array<{ name: string; description?: string }>;
}): string {
  const depts = input.departments
    .map((d) => `- ${d.name}${d.description ? `: ${d.description}` : ""}`)
    .join("\n");
  return [
    `Interpreted scope:\n${input.interpretedScope}`,
    `Record types: ${input.recordTypes.join(", ") || "(none identified)"}`,
    `Departments:\n${depts}`,
  ].join("\n\n");
}
