/**
 * Minimal stateless MCP server core (streamable HTTP transport,
 * docs/requester-api.md). Hand-rolled JSON-RPC on purpose — the
 * self-contained-first rule: no SDK dependency for what is ~150 lines of
 * pure, offline-testable protocol handling. Scope is deliberately the
 * tools subset (initialize / ping / tools/list / tools/call); no sessions,
 * no SSE, no resources/prompts — every POST is independent, which is
 * exactly right for a public, unauthenticated surface.
 */

/** What a tool returns: text for the model, isError for tool-level failures. */
export interface McpToolResult {
  text: string;
  isError?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
}

export interface McpServerInfo {
  name: string;
  version: string;
  /** Shown to connecting clients at initialize — say what this server is for. */
  instructions?: string;
}

/** HTTP-shaped result the route turns into a Response. body null ⇒ empty body. */
export interface McpHttpResult {
  status: number;
  body: unknown | null;
}

/** Newest first; initialize echoes a supported requested version, else ours. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;

type JsonRpcId = string | number;

function ok(id: JsonRpcId, result: unknown): McpHttpResult {
  return { status: 200, body: { jsonrpc: "2.0", id, result } };
}

function err(id: JsonRpcId | null, code: number, message: string, status = 200): McpHttpResult {
  return { status, body: { jsonrpc: "2.0", id, error: { code, message } } };
}

/** For raw-body routes: turn unparseable JSON into the spec's parse error. */
export function mcpParseError(): McpHttpResult {
  return err(null, -32700, "Parse error: body is not valid JSON", 400);
}

/**
 * Handle ONE decoded JSON-RPC message. The route owns HTTP concerns (method
 * gating, JSON parsing, agency resolution); this owns the protocol.
 */
export async function handleMcpMessage(
  info: McpServerInfo,
  tools: McpTool[],
  message: unknown,
): Promise<McpHttpResult> {
  // JSON-RPC batching was removed from MCP in 2025-06-18; refuse it plainly
  // rather than half-supporting the older shape.
  if (Array.isArray(message)) {
    return err(null, -32600, "Batch requests are not supported", 400);
  }
  if (typeof message !== "object" || message === null) {
    return err(null, -32600, "Invalid request: expected a JSON-RPC object", 400);
  }

  const msg = message as Record<string, unknown>;
  if (msg.jsonrpc !== "2.0") {
    return err(null, -32600, 'Invalid request: jsonrpc must be "2.0"', 400);
  }

  const method = typeof msg.method === "string" ? msg.method : null;
  const hasId = typeof msg.id === "string" || typeof msg.id === "number";

  // Notifications (no id — e.g. notifications/initialized): accepted, no body.
  if (!hasId) return { status: 202, body: null };
  const id = msg.id as JsonRpcId;

  if (!method) return err(id, -32600, "Invalid request: missing method");

  const params = (typeof msg.params === "object" && msg.params !== null ? msg.params : {}) as Record<
    string,
    unknown
  >;

  switch (method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: info.name, version: info.version },
        ...(info.instructions ? { instructions: info.instructions } : {}),
      });
    }

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = tools.find((t) => t.name === name);
      if (!tool) return err(id, -32602, `Unknown tool: ${name || "(missing name)"}`);

      const rawArgs = params.arguments;
      if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
        return err(id, -32602, "Invalid params: arguments must be an object");
      }

      // Tool EXECUTION failures are results with isError (the model should see
      // them and adapt); only protocol misuse becomes a JSON-RPC error.
      try {
        const result = await tool.handler((rawArgs ?? {}) as Record<string, unknown>);
        return ok(id, {
          content: [{ type: "text", text: result.text }],
          isError: result.isError === true,
        });
      } catch (e) {
        const text = e instanceof Error ? e.message : "Tool execution failed";
        return ok(id, { content: [{ type: "text", text }], isError: true });
      }
    }

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}
