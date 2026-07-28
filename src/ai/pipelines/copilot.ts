/**
 * Coordinator copilot (spec §6.8) — a chat scoped to a request. It reads the
 * request context and answers, and it may PROPOSE actions (draft a message,
 * propose a task or an extension) — always as drafts. Nothing is executed here;
 * the coordinator accepts/edits/dismisses, same grammar as every AI surface (§8).
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PipelineDefinition } from "../runPipeline";

export const copilotSchema = z
  .object({
    reply: z.string(),
    proposedActions: z.array(
      z
        .object({
          type: z.enum(["draft_message", "propose_task", "propose_extension", "none"]),
          detail: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type CopilotOutput = z.infer<typeof copilotSchema>;

export interface CopilotInput {
  request: {
    publicId: string;
    interpretedScope: string;
    status: string;
    dueDate?: string;
    recentEvents: string[];
  };
  message: string;
}

const SYSTEM = `You are a records coordinator's copilot, scoped to a single public-records request. Help the coordinator move it forward.

You may answer questions about the request, and you may PROPOSE actions — but everything is a draft for the coordinator to accept, edit, or dismiss. You never send, release, or change anything yourself.

For each proposed action, give a type (draft_message, propose_task, propose_extension, or none) and a concrete detail (the drafted message, the task scope + department, or the extension basis). Use "none" when no action is warranted. Ground everything in the provided request context; don't invent facts. Return ONLY the structured JSON.`;

export const copilotPipeline: PipelineDefinition<CopilotInput, CopilotOutput> = {
  name: "coordinator_copilot",
  promptVersion: "2026-07-27.1",
  maxTokens: 1024,
  schema: copilotSchema,
  jsonSchema: zodToJsonSchema(copilotSchema, { name: "coordinator_copilot", target: "openApi3" }) as Record<
    string,
    unknown
  >,
  buildPrompt: (input) => ({
    system: SYSTEM,
    user: [
      `Request ${input.request.publicId} — status ${input.request.status}${input.request.dueDate ? `, due ${input.request.dueDate}` : ""}`,
      `Scope: ${input.request.interpretedScope}`,
      `Recent activity:\n${input.request.recentEvents.map((e) => `  - ${e}`).join("\n")}`,
      ``,
      `Coordinator: ${input.message}`,
    ].join("\n"),
  }),
};
