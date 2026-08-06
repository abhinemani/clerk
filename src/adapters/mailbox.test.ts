import { describe, expect, it } from "vitest";
import {
  decodeHeaderWords,
  htmlToText,
  looksLikeMailbox,
  messageTextRendition,
  parseMailbox,
} from "./mailbox";

const CRLF = "\r\n";

/** A multipart message with a text body and a base64 "PDF" attachment. */
function multipartMessage(): string {
  const pdfBytes = Buffer.from("%PDF-1.4 fake inspection report bytes");
  return [
    "From: Marcus Bell <mbell@riverton.gov>",
    "To: dana@riverton.gov",
    "Cc: casey@riverton.gov",
    "Date: Tue, 14 Jan 2025 09:30:00 -0800",
    "Subject: =?utf-8?B?UmU6IEVsbSBTdCBpbnNwZWN0aW9ucyDinIU=?=",
    'Content-Type: multipart/mixed; boundary="XYZ123"',
    "",
    "preamble to ignore",
    "--XYZ123",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "The report is attached. Caf=C3=A9 meeting at 3pm.",
    ">From the field: all clear.",
    "--XYZ123",
    "Content-Type: application/pdf; name=\"report.pdf\"",
    "Content-Disposition: attachment; filename=\"report.pdf\"",
    "Content-Transfer-Encoding: base64",
    "",
    pdfBytes.toString("base64"),
    "--XYZ123--",
    "epilogue to ignore",
  ].join(CRLF);
}

function simpleMessage(subject: string, body: string): string {
  return [
    "From: pshah@riverton.gov",
    "To: dana@riverton.gov",
    "Date: Wed, 15 Jan 2025 10:00:00 -0800",
    `Subject: ${subject}`,
    "Content-Type: text/plain",
    "",
    body,
  ].join(CRLF);
}

function mboxOf(...messages: string[]): Buffer {
  return Buffer.from(
    messages.map((m) => `From mbell@riverton.gov Tue Jan 14 09:30:00 2025\n${m}\n`).join("\n"),
    "latin1",
  );
}

describe("looksLikeMailbox", () => {
  it("detects by extension, mbox envelope, and header shape", () => {
    expect(looksLikeMailbox(Buffer.from("anything"), "export.mbox")).toBe(true);
    expect(looksLikeMailbox(Buffer.from("anything"), "message.eml")).toBe(true);
    expect(looksLikeMailbox(mboxOf(simpleMessage("hi", "body")), "export.bin")).toBe(true);
    expect(looksLikeMailbox(Buffer.from(simpleMessage("hi", "body")), null)).toBe(true);
    expect(looksLikeMailbox(Buffer.from("just some prose, nothing mail-like"), "notes.txt")).toBe(false);
    expect(looksLikeMailbox(Buffer.from("%PDF-1.4"), "doc.pdf")).toBe(false);
  });
});

describe("parseMailbox", () => {
  it("splits an mbox into messages and parses headers", () => {
    const { messages, isMbox, failedIndexes } = parseMailbox(
      mboxOf(simpleMessage("First", "one"), simpleMessage("Second", "two")),
    );
    expect(isMbox).toBe(true);
    expect(failedIndexes).toEqual([]);
    expect(messages.map((m) => m.subject)).toEqual(["First", "Second"]);
    expect(messages[0]!.date?.toISOString()).toBe("2025-01-15T18:00:00.000Z");
    expect(messages[0]!.bodyText).toBe("one");
  });

  it("parses a single .eml (not mbox-framed)", () => {
    const { messages, isMbox } = parseMailbox(Buffer.from(simpleMessage("Solo", "body text")));
    expect(isMbox).toBe(false);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.subject).toBe("Solo");
  });

  it("decodes multipart: QP text, RFC 2047 subject, base64 attachment, >From unescaping", () => {
    const { messages } = parseMailbox(mboxOf(multipartMessage()));
    const m = messages[0]!;
    expect(m.subject).toBe("Re: Elm St inspections ✅");
    expect(m.from).toBe("Marcus Bell <mbell@riverton.gov>");
    expect(m.cc).toBe("casey@riverton.gov");
    expect(m.bodyText).toContain("Café meeting at 3pm.");
    expect(m.bodyText).toContain("From the field: all clear."); // >From unescaped
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]!.filename).toBe("report.pdf");
    expect(m.attachments[0]!.mimeType).toBe("application/pdf");
    expect(m.attachments[0]!.bytes.toString("latin1")).toBe("%PDF-1.4 fake inspection report bytes");
  });

  it("falls back to tag-stripped HTML when there is no text/plain part", () => {
    const html = [
      "From: a@b.gov",
      "Subject: html only",
      "Content-Type: text/html",
      "",
      "<html><style>p{color:red}</style><body><p>Hello&nbsp;there</p><p>Second &amp; last</p></body></html>",
    ].join(CRLF);
    const { messages } = parseMailbox(Buffer.from(html));
    expect(messages[0]!.bodyText).toBe("Hello there\nSecond & last");
  });

  it("reports unparseable messages by index without failing the mailbox", () => {
    const { messages, failedIndexes } = parseMailbox(
      mboxOf(simpleMessage("Good", "ok"), "no headers here at all just prose\n"),
    );
    expect(messages.map((m) => m.subject)).toEqual(["Good"]);
    expect(failedIndexes).toEqual([2]);
  });

  it("caps the number of messages parsed", () => {
    const many = mboxOf(...Array.from({ length: 10 }, (_, i) => simpleMessage(`m${i}`, "x")));
    expect(parseMailbox(many, { maxMessages: 3 }).messages).toHaveLength(3);
  });
});

describe("helpers", () => {
  it("decodeHeaderWords handles B and Q encodings", () => {
    expect(decodeHeaderWords("=?utf-8?Q?Caf=C3=A9_notes?=")).toBe("Café notes");
    expect(decodeHeaderWords("=?UTF-8?B?Q2Fmw6k=?= plain tail")).toBe("Café plain tail");
    expect(decodeHeaderWords("plain")).toBe("plain");
    expect(decodeHeaderWords(null)).toBeNull();
  });

  it("messageTextRendition includes headers, attachments line, and body", () => {
    const { messages } = parseMailbox(mboxOf(multipartMessage()));
    const text = messageTextRendition(messages[0]!);
    expect(text).toContain("From: Marcus Bell <mbell@riverton.gov>");
    expect(text).toContain("Subject: Re: Elm St inspections ✅");
    expect(text).toContain("Attachments: report.pdf");
    expect(text).toContain("Café meeting at 3pm.");
  });

  it("htmlToText drops scripts and preserves block breaks", () => {
    expect(htmlToText("<script>evil()</script><div>a</div><div>b</div>")).toBe("a\nb");
  });
});
