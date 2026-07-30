/**
 * Outbound email tests: providers speak their HTTP dialects, the relay records
 * to the outbox before (and regardless of) delivery, and the inbound ingest
 * addresses round-trip.
 */
import { describe, expect, it } from "vitest";
import { PostmarkEmailSender, ResendEmailSender, type EmailMessage } from "@/adapters/email";
import {
  CollectingNotifier,
  RelayNotifier,
  inboundAddress,
  parseInboundAddress,
} from "./notifications";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

const MSG: EmailMessage = {
  to: "lead@dept.gov",
  subject: "Records needed",
  text: "Please attach.",
  replyTo: "task-abc12345@in.example.gov",
};

describe("email senders", () => {
  it("Postmark: token header, ReplyTo, message id back", async () => {
    const { impl, calls } = fakeFetch(200, { MessageID: "pm-1" });
    const out = await new PostmarkEmailSender("tok", "Records <r@r.gov>", impl).send(MSG);
    expect(out.providerId).toBe("pm-1");
    const call = calls[0]!;
    expect(call.url).toContain("postmarkapp.com");
    expect((call.init.headers as Record<string, string>)["x-postmark-server-token"]).toBe("tok");
    const body = JSON.parse(call.init.body as string);
    expect(body.From).toBe("Records <r@r.gov>");
    expect(body.ReplyTo).toBe(MSG.replyTo);
  });

  it("Resend: bearer auth, reply_to, throws on failure", async () => {
    const ok = fakeFetch(200, { id: "re-1" });
    const out = await new ResendEmailSender("key", "r@r.gov", ok.impl).send(MSG);
    expect(out.providerId).toBe("re-1");
    const body = JSON.parse(ok.calls[0]!.init.body as string);
    expect(body.reply_to).toBe(MSG.replyTo);

    const bad = fakeFetch(422, { message: "nope" });
    await expect(new ResendEmailSender("key", "r@r.gov", bad.impl).send(MSG)).rejects.toThrow(/422/);
  });
});

describe("RelayNotifier", () => {
  const OUT = {
    agencyId: "ag-1",
    to: "wei@example.com",
    subject: "s",
    body: "b",
    kind: "requester_update" as const,
  };

  it("records to the outbox and reports the email channel on success", async () => {
    const outbox = new CollectingNotifier();
    const relay = new RelayNotifier(outbox, { send: async () => ({ providerId: "x" }) });
    const receipt = await relay.send(OUT);
    expect(outbox.sent).toHaveLength(1); // the audit row always exists
    expect(receipt.channel).toBe("email");
  });

  it("keeps the outbox record when the provider fails (audit ≠ delivery)", async () => {
    const outbox = new CollectingNotifier();
    const relay = new RelayNotifier(outbox, {
      send: async () => {
        throw new Error("provider down");
      },
    });
    const receipt = await relay.send(OUT);
    expect(outbox.sent).toHaveLength(1);
    expect(receipt.channel).not.toBe("email"); // honest channel on failure
  });
});

describe("inbound ingest addresses", () => {
  it("round-trips request and task addresses", () => {
    const req = inboundAddress("request", "b10103ab-60d0-4272-8be9-4167a47f673e", "in.example.gov");
    expect(req).toBe("req-b10103ab-60d0-4272-8be9-4167a47f673e@in.example.gov");
    expect(parseInboundAddress(req!)).toEqual({
      kind: "request",
      requestId: "b10103ab-60d0-4272-8be9-4167a47f673e",
    });

    const task = inboundAddress("task", "abc12345def", "in.example.gov");
    expect(parseInboundAddress(task!)).toEqual({ kind: "task", token: "abc12345def" });
  });

  it("is null without a configured domain; foreign addresses don't parse", () => {
    expect(inboundAddress("request", "id", undefined)).toBeUndefined();
    expect(parseInboundAddress("records@riverton.gov")).toBeNull();
    expect(parseInboundAddress("req-notauuid@in.example.gov")).toBeNull();
  });
});
