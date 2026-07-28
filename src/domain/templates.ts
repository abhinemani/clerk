/**
 * Merge-field rendering for response-letter templates (spec §5 Template, §6.6).
 *
 * Templates use `{{dotted.path}}` merge fields resolved against a context object.
 * Missing fields render empty and are reported, so a coordinator never sends a
 * letter with an unresolved `{{...}}` in it. Pure and testable.
 */
const FIELD_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export interface RenderResult {
  text: string;
  /** Field paths referenced by the template but absent/empty in the context. */
  missing: string[];
}

function resolvePath(context: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, context);
}

export function renderTemplate(
  body: string,
  context: Record<string, unknown>,
): RenderResult {
  const missing: string[] = [];
  const text = body.replace(FIELD_RE, (_match, path: string) => {
    const value = resolvePath(context, path);
    if (value === undefined || value === null || value === "") {
      if (!missing.includes(path)) missing.push(path);
      return "";
    }
    return String(value);
  });
  return { text, missing };
}

/** List the distinct merge-field paths a template references. */
export function templateFields(body: string): string[] {
  const fields: string[] = [];
  for (const match of body.matchAll(FIELD_RE)) {
    const path = match[1]!;
    if (!fields.includes(path)) fields.push(path);
  }
  return fields;
}
