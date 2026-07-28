/**
 * runPipeline() — the shared AI pipeline harness (spec §6).
 *
 * "Build a thin shared runPipeline() harness (retries, JSON validation with Zod,
 *  cost logging) and implement each pipeline against it. Log every run in
 *  RequestEvent with prompt version and token counts."
 *
 * Each §6 capability is: deterministic pre-processing → LLM call(s) with
 * structured output → persisted draft artifact → human review. This harness owns
 * the middle: it calls the model for structured JSON, validates it against the
 * pipeline's Zod schema, retries with a corrective message on failure, and emits
 * a run record (model, prompt version, token counts) for the audit log.
 *
 * Prompts are product surface area (§4) — each pipeline pins a `promptVersion`,
 * logged with every run so a prompt change is traceable and eval-gated (§13).
 */
import type { ZodType } from "zod";
import type { Effort } from "./models";
import { DEFAULT_MAX_TOKENS, MODELS } from "./models";
import type { ModelClient } from "./modelClient";

export interface PipelineDefinition<I, O> {
  /** Stable pipeline name, e.g. "intake_triage" (§6.1). */
  name: string;
  /** Pinned prompt version — logged with every run (§4, §13). */
  promptVersion: string;
  model?: string;
  maxTokens?: number;
  effort?: Effort;
  /** Zod schema validating the model's structured output. */
  schema: ZodType<O>;
  /** JSON Schema handed to the model (derived once from `schema`). */
  jsonSchema: Record<string, unknown>;
  /** Deterministic prompt construction from the typed input. */
  buildPrompt: (input: I) => { system: string; user: string };
}

/** One row of the audit log for a pipeline run (§6, maps to a RequestEvent). */
export interface PipelineRunRecord {
  pipeline: string;
  promptVersion: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
  ok: boolean;
  error?: string;
  /** Optional context so the sink can attach the event to a request. */
  requestId?: string;
  agencyId?: string;
}

export interface RunPipelineOptions {
  modelClient: ModelClient;
  /** Total attempts = 1 + retries. Default 2 retries (3 attempts). */
  retries?: number;
  /** Sink for the run record — a DB layer writes an `ai_action` RequestEvent here. */
  onRun?: (record: PipelineRunRecord) => void | Promise<void>;
  requestId?: string;
  agencyId?: string;
}

export interface PipelineResult<O> {
  output: O;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  attempts: number;
}

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly record: PipelineRunRecord,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

/**
 * Run a single-shot structured pipeline: build prompt → model → validate →
 * (retry with correction on failure) → emit run record.
 */
export async function runPipeline<I, O>(
  def: PipelineDefinition<I, O>,
  input: I,
  opts: RunPipelineOptions,
): Promise<PipelineResult<O>> {
  const retries = opts.retries ?? 2;
  const model = def.model ?? MODELS.pipeline;
  const { system, user } = def.buildPrompt(input);

  let inputTokens = 0;
  let outputTokens = 0;
  let correction: string | undefined;
  let lastError = "";

  const totalAttempts = retries + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      const res = await opts.modelClient.completeStructured({
        system,
        user,
        schemaName: def.name,
        jsonSchema: def.jsonSchema,
        model,
        maxTokens: def.maxTokens ?? DEFAULT_MAX_TOKENS,
        effort: def.effort,
        correction,
      });
      inputTokens += res.usage.inputTokens;
      outputTokens += res.usage.outputTokens;

      const parsed = def.schema.safeParse(res.data);
      if (parsed.success) {
        await emit(opts, {
          pipeline: def.name,
          promptVersion: def.promptVersion,
          model,
          inputTokens,
          outputTokens,
          attempts: attempt,
          ok: true,
          requestId: opts.requestId,
          agencyId: opts.agencyId,
        });
        return { output: parsed.data, usage: { inputTokens, outputTokens }, model, attempts: attempt };
      }

      // Validation failed — build a corrective instruction for the next attempt.
      lastError = summarizeZodError(parsed.error);
      correction = `Your previous response did not match the required schema. Fix these issues and return ONLY the corrected JSON: ${lastError}`;
    } catch (err) {
      // Model/transport error — retry unless exhausted.
      lastError = err instanceof Error ? err.message : String(err);
      correction = undefined; // a call error isn't a schema issue; retry the same prompt
    }
  }

  const record: PipelineRunRecord = {
    pipeline: def.name,
    promptVersion: def.promptVersion,
    model,
    inputTokens,
    outputTokens,
    attempts: totalAttempts,
    ok: false,
    error: lastError,
    requestId: opts.requestId,
    agencyId: opts.agencyId,
  };
  await emit(opts, record);
  throw new PipelineError(
    `Pipeline "${def.name}" failed after ${totalAttempts} attempt(s): ${lastError}`,
    record,
  );
}

async function emit(opts: RunPipelineOptions, record: PipelineRunRecord): Promise<void> {
  if (opts.onRun) await opts.onRun(record);
}

function summarizeZodError(error: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
