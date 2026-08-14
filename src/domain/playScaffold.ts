/**
 * Play letter scaffolds (docs/learning-loop.md v2) — a response-letter
 * skeleton composed from the office's own resolved history for this kind of
 * ask. Deterministic and zero-key: this is the learning loop speaking, not a
 * model. It rides the same "AI proposes, staff disposes" surface as every
 * other draft — the coordinator edits and sends; nothing here reaches a
 * requester on its own (invariant 4).
 *
 * Copy rules, enforced by tests:
 * - History is stated AS history ("similar requests have typically…"), never
 *   as a commitment. The only date stated as an obligation is the statutory
 *   due date the law already sets. (Owner rule, on the record: no reply-time
 *   promises on any requester-facing surface the product composes.)
 * - Every stat that is missing simply doesn't appear — no "N/A" filler.
 */
import type { PlayStats } from "@/db/schema";

export interface PlayScaffoldInput {
  play: { topic: string; episodeCount: number; stats: PlayStats };
  publicId: string;
  agencyName: string;
  requesterName?: string | null;
  rawText: string;
  /** Human-readable statutory due date ("Mon Aug 24 2026"), if computed. */
  statutoryDueDate?: string | null;
}

export function composePlayScaffold(input: PlayScaffoldInput): { subject: string; body: string } {
  const { play } = input;
  const { stats } = play;
  const first = (input.requesterName ?? "there").split(" ")[0];

  const paragraphs: string[] = [];
  paragraphs.push(`Hi ${first},`);
  paragraphs.push(
    `Thanks for your request (${input.publicId}): "${input.rawText.trim()}"`,
  );

  // The history paragraph — the play's reason for existing. Route and timing
  // are both optional; the sentence degrades word by word.
  const historyBits: string[] = [];
  historyBits.push(
    `This office has resolved ${play.episodeCount} similar request${play.episodeCount === 1 ? "" : "s"} about ${play.topic}`,
  );
  const topRoute = stats.routes[0];
  if (topRoute) historyBits.push(`most often through our ${topRoute.department} records`);
  let history = `${historyBits.join(", ")}.`;
  if (stats.medianDaysToClose != null) {
    history += ` Requests like this one have typically closed in about ${stats.medianDaysToClose} days — that is our history, not a commitment${
      input.statutoryDueDate ? `; the statutory due date for your request is ${input.statutoryDueDate}` : ""
    }.`;
  } else if (input.statutoryDueDate) {
    history += ` The statutory due date for your request is ${input.statutoryDueDate}.`;
  }
  paragraphs.push(history);

  // Exemption heads-up only when the history actually shows one.
  const exemptions = stats.exemptions.slice(0, 3).map((e) => e.label);
  if (exemptions.length > 0) {
    paragraphs.push(
      `A heads-up from past cases: releases of this kind have sometimes required limited redactions under ${exemptions.join(
        ", ",
      )}. If that applies here, your release letter will say exactly what was withheld and why.`,
    );
  }

  paragraphs.push(
    `To help us find the right records faster, could you confirm the date range you're interested in, or any specific department or document you already know of? A quick reply here speeds things up.`,
  );
  paragraphs.push(input.agencyName);

  return {
    subject: `Your records request ${input.publicId} — status and next step`,
    body: paragraphs.join("\n\n"),
  };
}
