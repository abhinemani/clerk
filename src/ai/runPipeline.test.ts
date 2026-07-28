/** Tests for the runPipeline() harness (spec §6). */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeModelClient } from "./modelClient";
import {
  PipelineError,
  runPipeline,
  type PipelineDefinition,
  type PipelineRunRecord,
} from "./runPipeline";

const def: PipelineDefinition<{ q: string }, { answer: string }> = {
  name: "test_pipeline",
  promptVersion: "v1",
  schema: z.object({ answer: z.string() }).strict(),
  jsonSchema: { type: "object" },
  buildPrompt: (input) => ({ system: "sys", user: input.q }),
};

function collector() {
  const records: PipelineRunRecord[] = [];
  return { records, onRun: (r: PipelineRunRecord) => void records.push(r) };
}

describe("happy path", () => {
  it("returns validated output on first attempt and logs a run record", async () => {
    const client = new FakeModelClient([{ answer: "hello" }]);
    const { records, onRun } = collector();
    const res = await runPipeline(def, { q: "hi" }, { modelClient: client, onRun });

    expect(res.output.answer).toBe("hello");
    expect(res.attempts).toBe(1);
    expect(res.model).toBe("claude-sonnet-5"); // spec §4 default
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 50 });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ pipeline: "test_pipeline", promptVersion: "v1", ok: true, attempts: 1 });
  });

  it("passes the built prompt to the model", async () => {
    const client = new FakeModelClient([{ answer: "x" }]);
    await runPipeline(def, { q: "find contracts" }, { modelClient: client });
    expect(client.calls[0]!.system).toBe("sys");
    expect(client.calls[0]!.user).toBe("find contracts");
    expect(client.calls[0]!.correction).toBeUndefined();
  });
});

describe("validation retry", () => {
  it("retries with a corrective message when output fails schema, then succeeds", async () => {
    const client = new FakeModelClient([{ wrong: 1 }, { answer: "fixed" }]);
    const { records, onRun } = collector();
    const res = await runPipeline(def, { q: "hi" }, { modelClient: client, onRun });

    expect(res.output.answer).toBe("fixed");
    expect(res.attempts).toBe(2);
    // Second call carries a correction referencing the failed field.
    expect(client.calls[1]!.correction).toBeDefined();
    expect(client.calls[1]!.correction).toMatch(/schema/i);
    // Tokens accumulate across attempts.
    expect(res.usage).toEqual({ inputTokens: 200, outputTokens: 100 });
    expect(records[0]!.ok).toBe(true);
  });

  it("throws PipelineError after exhausting retries, with a failure record", async () => {
    const client = new FakeModelClient([{ bad: 1 }, { bad: 2 }]);
    const { records, onRun } = collector();

    await expect(
      runPipeline(def, { q: "hi" }, { modelClient: client, retries: 1, onRun }),
    ).rejects.toBeInstanceOf(PipelineError);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ ok: false, attempts: 2 });
    expect(records[0]!.error).toMatch(/answer/); // missing required field
  });
});

describe("model/transport errors", () => {
  it("retries a thrown model error without a schema correction", async () => {
    const client = new FakeModelClient([new Error("overloaded"), { answer: "ok" }]);
    const res = await runPipeline(def, { q: "hi" }, { modelClient: client });
    expect(res.output.answer).toBe("ok");
    expect(res.attempts).toBe(2);
    // A call error is not a schema issue → no correction appended on retry.
    expect(client.calls[1]!.correction).toBeUndefined();
  });

  it("surfaces the model error message when all attempts throw", async () => {
    const client = new FakeModelClient([new Error("overloaded")]);
    await expect(
      runPipeline(def, { q: "hi" }, { modelClient: client, retries: 2 }),
    ).rejects.toThrow(/overloaded/);
  });
});

describe("run record context", () => {
  it("threads requestId/agencyId into the emitted record for audit logging", async () => {
    const client = new FakeModelClient([{ answer: "hi" }]);
    const { records, onRun } = collector();
    await runPipeline(def, { q: "hi" }, {
      modelClient: client,
      onRun,
      requestId: "req-1",
      agencyId: "ag-1",
    });
    expect(records[0]).toMatchObject({ requestId: "req-1", agencyId: "ag-1" });
  });

  it("awaits an async onRun sink", async () => {
    const client = new FakeModelClient([{ answer: "hi" }]);
    const seen: string[] = [];
    await runPipeline(def, { q: "hi" }, {
      modelClient: client,
      onRun: async (r) => {
        await Promise.resolve();
        seen.push(r.pipeline);
      },
    });
    expect(seen).toEqual(["test_pipeline"]);
  });
});
