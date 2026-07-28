/**
 * Demo: run the intake-triage AI pipeline (spec §6.1) on a request. Needs a key.
 *
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   npm run triage -- "All emails between the mayor and Acme Corp in 2025"
 *
 * Prints the structured triage draft a coordinator would review (AI proposes,
 * staff disposes). The run record (model, prompt version, token counts) is
 * printed to stderr — exactly what gets logged to the RequestEvent audit trail.
 */
import { runPipeline } from "../src/ai/runPipeline";
import { intakeTriagePipeline } from "../src/ai/pipelines/intakeTriage";
import { AnthropicModelClient } from "../src/ai/modelClient";

const rawText = process.argv.slice(2).join(" ").trim();
if (!rawText) {
  console.error('Usage: npm run triage -- "<request text>"');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY is not set. Export it first:\n  export ANTHROPIC_API_KEY=sk-ant-...",
  );
  process.exit(1);
}

const client = new AnthropicModelClient();

const result = await runPipeline(
  intakeTriagePipeline,
  { rawText },
  {
    modelClient: client,
    onRun: (r) =>
      console.error(
        `[${r.pipeline}@${r.promptVersion} ${r.model}] ok=${r.ok} attempts=${r.attempts} tokens=${r.inputTokens}in/${r.outputTokens}out`,
      ),
  },
);

console.log(JSON.stringify(result.output, null, 2));
