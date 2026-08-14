/**
 * MCP protocol core: stateless streamable-HTTP JSON-RPC. The contract worth
 * pinning — notifications are 202/no-body, batches are refused (2025-06-18
 * dropped them), tool EXECUTION failures are isError results the model can
 * read while protocol misuse is a JSON-RPC error, and version negotiation
 * echoes a supported request.
 */
import { describe, expect, it } from "vitest";
import {
  handleMcpMessage,
  mcpParseError,
  SUPPORTED_PROTOCOL_VERSIONS,
  type McpTool,
} from "./server";

const INFO = { name: "test-server", version: "1.0.0", instructions: "Test." };

const echoTool: McpTool = {
  name: "echo",
  description: "Echo the input back.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  handler: async (args) => ({ text: `echo:${args.text}` }),
};

const failingTool: McpTool = {
  name: "boom",
  description: "Always throws.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  handler: async () => {
    throw new Error("kaput");
  },
};

const rpc = (method: string, params?: unknown, id: string | number = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params !== undefined ? { params } : {}),
});

type Body = { jsonrpc: string; id: unknown; result?: any; error?: { code: number; message: string } };

describe("handleMcpMessage", () => {
  it("initialize echoes a supported protocol version and advertises tools", async () => {
    const r = await handleMcpMessage(INFO, [echoTool], rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "c", version: "0" },
    }));
    expect(r.status).toBe(200);
    const body = r.body as Body;
    expect(body.result.protocolVersion).toBe("2025-03-26");
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.serverInfo.name).toBe("test-server");
    expect(body.result.instructions).toBe("Test.");
  });

  it("initialize falls back to our latest version for an unknown request", async () => {
    const r = await handleMcpMessage(INFO, [], rpc("initialize", { protocolVersion: "1999-01-01" }));
    expect((r.body as Body).result.protocolVersion).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
  });

  it("notifications get 202 with no body", async () => {
    const r = await handleMcpMessage(INFO, [], {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(r.status).toBe(202);
    expect(r.body).toBeNull();
  });

  it("ping answers an empty result", async () => {
    const r = await handleMcpMessage(INFO, [], rpc("ping"));
    expect((r.body as Body).result).toEqual({});
  });

  it("tools/list serves name + description + inputSchema", async () => {
    const r = await handleMcpMessage(INFO, [echoTool, failingTool], rpc("tools/list"));
    const tools = (r.body as Body).result.tools;
    expect(tools).toHaveLength(2);
    expect(tools[0]).toEqual({
      name: "echo",
      description: "Echo the input back.",
      inputSchema: echoTool.inputSchema,
    });
  });

  it("tools/call runs the handler and wraps text content", async () => {
    const r = await handleMcpMessage(
      INFO,
      [echoTool],
      rpc("tools/call", { name: "echo", arguments: { text: "hi" } }),
    );
    const body = r.body as Body;
    expect(body.result.isError).toBe(false);
    expect(body.result.content).toEqual([{ type: "text", text: "echo:hi" }]);
  });

  it("a throwing tool becomes an isError RESULT, not a protocol error", async () => {
    const r = await handleMcpMessage(INFO, [failingTool], rpc("tools/call", { name: "boom" }));
    const body = r.body as Body;
    expect(body.error).toBeUndefined();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("kaput");
  });

  it("unknown tool is -32602", async () => {
    const r = await handleMcpMessage(INFO, [echoTool], rpc("tools/call", { name: "nope" }));
    expect((r.body as Body).error?.code).toBe(-32602);
  });

  it("non-object arguments are -32602", async () => {
    const r = await handleMcpMessage(
      INFO,
      [echoTool],
      rpc("tools/call", { name: "echo", arguments: ["hi"] }),
    );
    expect((r.body as Body).error?.code).toBe(-32602);
  });

  it("unknown method is -32601", async () => {
    const r = await handleMcpMessage(INFO, [], rpc("resources/list"));
    expect((r.body as Body).error?.code).toBe(-32601);
  });

  it("batches are refused with -32600", async () => {
    const r = await handleMcpMessage(INFO, [], [rpc("ping", undefined, 1), rpc("ping", undefined, 2)]);
    expect(r.status).toBe(400);
    expect((r.body as Body).error?.code).toBe(-32600);
  });

  it("wrong jsonrpc version is -32600, and parse error carries -32700", async () => {
    const r = await handleMcpMessage(INFO, [], { jsonrpc: "1.0", id: 1, method: "ping" });
    expect((r.body as Body).error?.code).toBe(-32600);
    expect((mcpParseError().body as Body).error?.code).toBe(-32700);
  });
});
