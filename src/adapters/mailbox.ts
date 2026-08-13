/**
 * Mailbox parsing for email ingestion (the fulfillment reality: most
 * responsive records ARE emails). Handles what IT actually hands a records
 * office — an mbox export or individual .eml files — with the same
 * dependency-free approach as the zip and PDF readers: RFC 5322 headers,
 * MIME multipart, base64 / quoted-printable transfer encodings, RFC 2047
 * encoded-word headers, and a crude-but-honest HTML-to-text fallback.
 *
 * Pure functions over Buffers; no I/O. Anything malformed degrades per
 * message (a bad message is reported, not the whole mailbox).
 */

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export interface ParsedEmailMessage {
  /** 1-based position in the mailbox, for stable naming. */
  index: number;
  from: string | null;
  to: string | null;
  cc: string | null;
  subject: string | null;
  /** Parsed Date header, or null when missing/unparseable. */
  date: Date | null;
  /** Message-ID header, angle brackets stripped — the dedupe/threading key. */
  messageId: string | null;
  /** In-Reply-To header (first id when several), brackets stripped. */
  inReplyTo: string | null;
  /** References header ids, oldest first, brackets stripped. */
  references: string[];
  /** Plain-text body (text/plain part, or tag-stripped text/html). */
  bodyText: string;
  attachments: ParsedAttachment[];
  /** The raw RFC 822 bytes of this one message — the record itself. */
  raw: Buffer;
}

export interface ParsedMailbox {
  messages: ParsedEmailMessage[];
  /** 1-based indexes of messages that could not be parsed. */
  failedIndexes: number[];
  /** True when the input looked like mbox; false for a single .eml. */
  isMbox: boolean;
}

const MAX_MESSAGES = 2000;

/** Does this smell like an mbox / RFC 822 message at all? */
export function looksLikeMailbox(bytes: Buffer, filename: string | null): boolean {
  const name = (filename ?? "").toLowerCase();
  if (name.endsWith(".mbox") || name.endsWith(".eml")) return true;
  const head = bytes.subarray(0, 4096).toString("latin1");
  if (head.startsWith("From ")) return true;
  // A bare .eml: header-shaped lines before the first blank line.
  return /^[A-Za-z-]+:\s/.test(head) && /\r?\n(From|Date|Subject|To|Received):\s/i.test(head.slice(0, 2000));
}

/**
 * Parse an mbox file or a single .eml. mbox framing: messages start at lines
 * beginning "From " (the envelope line); ">From " inside bodies is the
 * classic escaping and is unescaped in text bodies.
 */
export function parseMailbox(bytes: Buffer, opts: { maxMessages?: number } = {}): ParsedMailbox {
  const max = opts.maxMessages ?? MAX_MESSAGES;
  const raw = bytes.toString("latin1");
  const isMbox = raw.startsWith("From ");

  const rawMessages: string[] = [];
  if (isMbox) {
    // Split on envelope lines. The first segment before the first "From " is
    // empty by construction (we checked startsWith).
    const parts = raw.split(/^From [^\n]*\n/m);
    for (const part of parts) {
      if (part.trim().length === 0) continue;
      // The blank line before the next envelope is mbox FRAMING, not message
      // content — strip it so the same message has the same bytes (and the
      // same checksum) wherever it sits in an export.
      rawMessages.push(part.replace(/\n+$/, "\n"));
      if (rawMessages.length >= max) break;
    }
  } else {
    rawMessages.push(raw);
  }

  const messages: ParsedEmailMessage[] = [];
  const failedIndexes: number[] = [];
  rawMessages.forEach((m, i) => {
    try {
      const parsed = parseRfc822(m, i + 1);
      if (parsed) messages.push(parsed);
      else failedIndexes.push(i + 1);
    } catch {
      failedIndexes.push(i + 1);
    }
  });
  return { messages, failedIndexes, isMbox };
}

// --- one RFC 822 message ----------------------------------------------------

function parseRfc822(raw: string, index: number): ParsedEmailMessage | null {
  const { headers, body } = splitHeaders(raw);
  if (headers.size === 0) return null;

  const parts = collectParts(headers, body);
  const textPart = parts.find((p) => p.mimeType === "text/plain" && !p.isAttachment);
  const htmlPart = parts.find((p) => p.mimeType === "text/html" && !p.isAttachment);
  let bodyText = textPart
    ? decodeTextBody(textPart)
    : htmlPart
      ? htmlToText(decodeTextBody(htmlPart))
      : "";
  // Classic mbox body escaping.
  bodyText = bodyText.replace(/^>From /gm, "From ");

  const attachments: ParsedAttachment[] = parts
    .filter((p) => p.isAttachment)
    .map((p, i) => ({
      filename: p.filename ?? `attachment-${i + 1}`,
      mimeType: p.mimeType,
      bytes: decodeBinaryBody(p),
    }));

  const dateRaw = headers.get("date");
  const date = dateRaw ? new Date(dateRaw) : null;
  const references = parseMessageIds(headers.get("references") ?? null);

  return {
    index,
    from: decodeHeaderWords(headers.get("from") ?? null),
    to: decodeHeaderWords(headers.get("to") ?? null),
    cc: decodeHeaderWords(headers.get("cc") ?? null),
    subject: decodeHeaderWords(headers.get("subject") ?? null),
    messageId: parseMessageIds(headers.get("message-id") ?? null)[0] ?? null,
    inReplyTo: parseMessageIds(headers.get("in-reply-to") ?? null)[0] ?? null,
    references,
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    bodyText: bodyText.trim(),
    attachments,
    raw: Buffer.from(raw, "latin1"),
  };
}

/**
 * `<id@host>` tokens from a Message-ID / In-Reply-To / References header,
 * brackets stripped. Some clients omit the brackets on Message-ID; a bare
 * non-empty value is accepted as one id in that case.
 */
export function parseMessageIds(value: string | null): string[] {
  if (!value) return [];
  const bracketed = [...value.matchAll(/<([^<>\s]+)>/g)].map((m) => m[1]!);
  if (bracketed.length > 0) return bracketed;
  const bare = value.trim();
  return bare && !/\s/.test(bare) ? [bare] : [];
}

/** Header block → folded-line-aware map (last value wins per name). */
function splitHeaders(raw: string): { headers: Map<string, string>; body: string } {
  const sep = raw.search(/\r?\n\r?\n/);
  const head = sep >= 0 ? raw.slice(0, sep) : raw;
  const body = sep >= 0 ? raw.slice(sep).replace(/^\r?\n\r?\n/, "") : "";
  const headers = new Map<string, string>();
  // Unfold continuation lines (leading whitespace), then split.
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!/^[!-9;-~]+$/.test(name)) continue; // not a header token
    headers.set(name, line.slice(colon + 1).trim());
  }
  return { headers, body };
}

interface MimePart {
  mimeType: string;
  charset: string;
  encoding: string; // base64 | quoted-printable | 7bit | 8bit | binary
  filename: string | null;
  isAttachment: boolean;
  body: string; // latin1-preserved bytes
}

/** Flatten a message (possibly nested multipart) into leaf parts. */
function collectParts(headers: Map<string, string>, body: string, depth = 0): MimePart[] {
  const contentType = headers.get("content-type") ?? "text/plain";
  const mimeType = (contentType.split(";")[0] ?? "text/plain").trim().toLowerCase() || "text/plain";
  const boundary = param(contentType, "boundary");

  if (mimeType.startsWith("multipart/") && boundary && depth < 8) {
    const out: MimePart[] = [];
    for (const sub of splitMultipart(body, boundary)) {
      const { headers: subHeaders, body: subBody } = splitHeaders(sub);
      out.push(...collectParts(subHeaders, subBody, depth + 1));
    }
    return out;
  }

  if (mimeType === "message/rfc822" && depth < 8) {
    // Forwarded message as a part — flatten its parts too.
    const { headers: subHeaders, body: subBody } = splitHeaders(body);
    return collectParts(subHeaders, subBody, depth + 1);
  }

  const disposition = headers.get("content-disposition") ?? "";
  const filename =
    decodeHeaderWords(param(disposition, "filename") ?? param(contentType, "name") ?? null);
  const isAttachment =
    /^\s*attachment/i.test(disposition) || (filename != null && !mimeType.startsWith("text/"));

  return [
    {
      mimeType,
      charset: (param(contentType, "charset") ?? "utf-8").toLowerCase(),
      encoding: (headers.get("content-transfer-encoding") ?? "7bit").trim().toLowerCase(),
      filename,
      isAttachment,
      body,
    },
  ];
}

function splitMultipart(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const chunks = body.split(new RegExp(`^${escapeRe(marker)}(?:--)?[ \\t]*\\r?\\n?`, "m"));
  // First chunk is the preamble; a trailing chunk after the closing marker is
  // the epilogue — both are discarded.
  return chunks.slice(1).filter((c) => c.trim().length > 0);
}

function decodeBinaryBody(part: MimePart): Buffer {
  if (part.encoding === "base64") {
    return Buffer.from(part.body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  }
  if (part.encoding === "quoted-printable") {
    return Buffer.from(decodeQuotedPrintable(part.body), "latin1");
  }
  return Buffer.from(part.body, "latin1");
}

function decodeTextBody(part: MimePart): string {
  const bytes = decodeBinaryBody(part);
  try {
    return bytes.toString(part.charset === "iso-8859-1" || part.charset === "latin1" ? "latin1" : "utf8");
  } catch {
    return bytes.toString("latin1");
  }
}

function decodeQuotedPrintable(s: string): string {
  return s
    .replace(/=\r?\n/g, "") // soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** RFC 2047 encoded words in headers: =?charset?B|Q?data?= */
export function decodeHeaderWords(value: string | null): string | null {
  if (value == null) return null;
  const decoded = value.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_, charset: string, enc: string, data: string) => {
      try {
        const bytes =
          enc.toUpperCase() === "B"
            ? Buffer.from(data, "base64")
            : Buffer.from(decodeQuotedPrintable(data.replace(/_/g, " ")), "latin1");
        const cs = charset.toLowerCase();
        return bytes.toString(cs === "iso-8859-1" || cs === "latin1" ? "latin1" : "utf8");
      } catch {
        return data;
      }
    },
  );
  return decoded.replace(/\s+/g, " ").trim() || null;
}

/** Crude HTML → text: scripts/styles dropped, block tags become newlines. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The searchable text rendition of one message — what redaction operates on. */
export function messageTextRendition(m: ParsedEmailMessage): string {
  return [
    `From: ${m.from ?? "(unknown)"}`,
    `To: ${m.to ?? "(unknown)"}`,
    ...(m.cc ? [`Cc: ${m.cc}`] : []),
    `Date: ${m.date ? m.date.toISOString() : "(unknown)"}`,
    `Subject: ${m.subject ?? "(no subject)"}`,
    ...(m.attachments.length > 0
      ? [`Attachments: ${m.attachments.map((a) => a.filename).join(", ")}`]
      : []),
    "",
    m.bodyText,
  ].join("\n");
}

function param(headerValue: string, name: string): string | null {
  // name=value | name="value" — case-insensitive name.
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i");
  const m = re.exec(headerValue);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
