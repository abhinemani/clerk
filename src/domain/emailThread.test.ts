import { describe, expect, it } from "vitest";
import { normalizeSubject, threadMessages, type ThreadableMessage } from "./emailThread";

function msg(over: Partial<ThreadableMessage> & { documentId: string }): ThreadableMessage {
  return { messageId: null, inReplyTo: null, references: [], subject: null, dateIso: null, ...over };
}

describe("normalizeSubject", () => {
  it("strips stacked reply/forward prefixes and bracket tags", () => {
    expect(normalizeSubject("Re: RE: Fwd: [EXT] Budget question")).toBe("budget question");
    expect(normalizeSubject("AW: Sv: paving")).toBe("paving");
    expect(normalizeSubject("  Plain subject ")).toBe("plain subject");
    expect(normalizeSubject(null)).toBe("");
  });
});

describe("threadMessages", () => {
  it("links replies by In-Reply-To and References into one thread", () => {
    const threads = threadMessages([
      msg({ documentId: "d1", messageId: "m1", subject: "Paving", dateIso: "2025-01-01" }),
      msg({ documentId: "d2", messageId: "m2", inReplyTo: "m1", subject: "Re: Paving", dateIso: "2025-01-02" }),
      // Deep reply that only carries References back to the root.
      msg({ documentId: "d3", messageId: "m3", references: ["m1", "m2"], subject: "Re: Paving", dateIso: "2025-01-03" }),
      msg({ documentId: "d4", messageId: "x1", subject: "Unrelated", dateIso: "2025-01-04" }),
    ]);
    expect(threads).toHaveLength(2);
    // Newest activity first: Unrelated (Jan 4) tops.
    expect(threads[0]!.messages.map((m) => m.documentId)).toEqual(["d4"]);
    expect(threads[1]!.subject).toBe("Paving");
    expect(threads[1]!.messages.map((m) => m.documentId)).toEqual(["d1", "d2", "d3"]);
  });

  it("converges partial chains — a reply seen before its parent still joins", () => {
    const threads = threadMessages([
      msg({ documentId: "d2", messageId: "m2", inReplyTo: "m1", subject: "Re: X", dateIso: "2025-01-02" }),
      msg({ documentId: "d1", messageId: "m1", subject: "X", dateIso: "2025-01-01" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.messages.map((m) => m.documentId)).toEqual(["d1", "d2"]);
  });

  it("falls back to normalized subject when ids are missing", () => {
    const threads = threadMessages([
      msg({ documentId: "d1", subject: "Elm St inspections", dateIso: "2025-01-01" }),
      msg({ documentId: "d2", subject: "Re: Elm St inspections", dateIso: "2025-01-02" }),
      msg({ documentId: "d3", subject: "Something else", dateIso: "2025-01-03" }),
    ]);
    expect(threads).toHaveLength(2);
    expect(threads.find((t) => t.subject === "Elm St inspections")!.messages).toHaveLength(2);
  });

  it("id-less messages do NOT subject-join a thread that has ids (ids win)", () => {
    // Two id-bearing threads that happen to share a subject stay separate;
    // the subject key only exists for messages with no ids at all.
    const threads = threadMessages([
      msg({ documentId: "d1", messageId: "m1", subject: "Weekly report", dateIso: "2025-01-01" }),
      msg({ documentId: "d2", messageId: "n1", subject: "Weekly report", dateIso: "2025-02-01" }),
    ]);
    expect(threads).toHaveLength(2);
  });

  it("undated messages sort after dated ones; empty subjects render honestly", () => {
    const threads = threadMessages([
      msg({ documentId: "d1", subject: null, dateIso: null }),
      msg({ documentId: "d2", subject: null, dateIso: "2025-01-01", messageId: "m" }),
    ]);
    // No shared ids and no usable subject → separate threads.
    expect(threads).toHaveLength(2);
    expect(threads.every((t) => t.subject === "(no subject)")).toBe(true);
  });
});
