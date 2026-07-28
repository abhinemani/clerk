/**
 * ModelClient — the boundary between the pipeline harness and the Anthropic API.
 *
 * The harness (runPipeline) depends only on this interface, so pipelines are
 * fully testable with a fake client and never make a live call in tests. The
 * real implementation uses the official Anthropic SDK with structured outputs
 * (spec §4/§6: "structured outputs via tool-use/JSON").
 *
 * The client returns the model's raw parsed JSON; Zod validation and retries
 * live in the harness (§6), keeping this layer thin.
 */
import type { Effort } from "./models";
import { DEFAULT_MAX_TOKENS } from "./models";

export interface StructuredModelRequest {
  system: string;
  user: string;
  /** Name for the output schema (surfaces in logs/telemetry). */
  schemaName: string;
  /** JSON Schema the model output must conform to (derived from the Zod schema). */
  jsonSchema: Record<string, unknown>;
  model: string;
  maxTokens?: number;
  effort?: Effort;
  /**
   * On a retry, a corrective instruction appended as a second user turn telling
   * the model how its previous output failed validation.
   */
  correction?: string;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredModelResponse {
  /** The model's structured output, parsed from JSON but NOT yet schema-validated. */
  data: unknown;
  usage: ModelUsage;
  model: string;
}

export interface ModelClient {
  completeStructured(req: StructuredModelRequest): Promise<StructuredModelResponse>;
}

/**
 * Real client backed by the Anthropic SDK. Not exercised by the test suite
 * (pipelines are tested with FakeModelClient); wired in at runtime with
 * ANTHROPIC_API_KEY set.
 */
export class AnthropicModelClient implements ModelClient {
  // Lazily import the SDK so environments without it (and tests) don't pay for it.
  private clientPromise: Promise<unknown> | null = null;

  constructor(private readonly apiKey = process.env.ANTHROPIC_API_KEY) {}

  private async client(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = import("@anthropic-ai/sdk").then(
        (m) => new m.default({ apiKey: this.apiKey }),
      );
    }
    return this.clientPromise;
  }

  async completeStructured(req: StructuredModelRequest): Promise<StructuredModelResponse> {
    const client = await this.client();
    const messages: Array<{ role: "user"; content: string }> = [
      { role: "user", content: req.user },
    ];
    if (req.correction) {
      messages.push({ role: "user", content: req.correction });
    }

    const params: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: req.system,
      messages,
      // Structured outputs: constrain the response to the JSON schema. `effort`
      // and `format` both live under output_config.
      output_config: {
        ...(req.effort ? { effort: req.effort } : {}),
        format: { type: "json_schema", schema: req.jsonSchema },
      },
    };

    // SDK typings for output_config.format lag the feature; the call itself is
    // correct. See the claude-api skill note on lagging structured-output types.
    const res = await client.messages.create(params);

    const text: string = (res.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    return {
      data: JSON.parse(text),
      usage: {
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
      },
      model: res.model ?? req.model,
    };
  }
}

/**
 * Deterministic fake for tests. Each scripted entry is either a value to return
 * as the model's structured `data`, or an Error to throw (to exercise retries).
 */
export class FakeModelClient implements ModelClient {
  readonly calls: StructuredModelRequest[] = [];
  private index = 0;

  constructor(
    private readonly script: Array<unknown | Error>,
    private readonly usage: ModelUsage = { inputTokens: 100, outputTokens: 50 },
  ) {}

  async completeStructured(req: StructuredModelRequest): Promise<StructuredModelResponse> {
    this.calls.push(req);
    const entry = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    if (entry instanceof Error) throw entry;
    return { data: entry, usage: this.usage, model: req.model };
  }
}
