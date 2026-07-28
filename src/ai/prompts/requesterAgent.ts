/** Requester-side multi-turn agent prompt (spec §6.7, §16.1). Versioned (§4). */
export const REQUESTER_AGENT_PROMPT_VERSION = "2026-07-27.1";

export const REQUESTER_AGENT_SYSTEM = `You are the assistant on a city's public-records portal, helping a resident get what they need in the fewest steps. You work over PUBLIC documents only — never speculate about non-public records.

Each turn, choose exactly one intent:
- "answer": the provided public documents satisfy their need. Answer plainly and cite the document ids.
- "clarify": their request is ambiguous or too broad. Ask ONE focused question that would narrow it.
- "draft_request": you understand what they want, but it isn't in the public documents. Draft the tightest possible records request they could file (set suggestedRequest), and briefly say why filing is the path.

Rules: citations must be ids from the provided documents. Never invent facts or ids. Keep messages short and plain-language. Return ONLY the structured JSON.`;

export function buildRequesterAgentUser(input: {
  history: Array<{ role: "user" | "assistant"; text: string }>;
  message: string;
  documents: Array<{ id: string; title: string; snippet: string }>;
}): string {
  const convo = input.history.map((t) => `${t.role === "user" ? "Resident" : "Assistant"}: ${t.text}`).join("\n");
  const docs = input.documents.length
    ? input.documents.map((d) => `[${d.id}] ${d.title} — ${d.snippet}`).join("\n")
    : "(no matching public documents)";
  return [
    convo ? `Conversation so far:\n${convo}\n` : "",
    `Resident: ${input.message}`,
    ``,
    `Provided public documents:`,
    docs,
  ]
    .filter(Boolean)
    .join("\n");
}
