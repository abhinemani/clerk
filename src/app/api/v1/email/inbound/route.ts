/**
 * Inbound email webhook (spec §6.5 email-in): `POST /api/v1/email/inbound`.
 *
 * Point your provider's inbound hook here (Postmark "Inbound", or anything
 * that can POST JSON). Auth is a shared secret: the provider must present
 * `Authorization: Bearer ${INBOUND_EMAIL_TOKEN}`. With no token configured
 * the endpoint plays dead (404) — inbound email is opt-in.
 *
 * Accepts either the normalized shape
 *   { to, from, subject?, text, attachments?: [{ name, content, contentType? }] }
 * or Postmark's inbound payload (ToFull/FromFull/TextBody/Attachments).
 * Routing/authorization decisions live in inboundEmailService.
 */
import { getBlobStore } from "@/adapters/blobStore";
import { getRepository } from "@/db/createRepository";
import { defaultDeps } from "@/services/deps";
import {
  ingestInboundEmail,
  type InboundAttachment,
  type InboundEmailInput,
} from "@/services/inboundEmailService";

export const runtime = "nodejs";

interface PostmarkAttachment {
  Name?: string;
  Content?: string;
  ContentType?: string;
}
interface PostmarkInbound {
  To?: string;
  ToFull?: { Email?: string }[];
  From?: string;
  FromFull?: { Email?: string };
  Subject?: string;
  TextBody?: string;
  Attachments?: PostmarkAttachment[];
}
interface NormalizedInbound {
  to?: string;
  from?: string;
  subject?: string;
  text?: string;
  attachments?: { name?: string; content?: string; contentType?: string }[];
}

function normalize(payload: PostmarkInbound & NormalizedInbound): InboundEmailInput | null {
  const to = payload.to ?? payload.ToFull?.[0]?.Email ?? payload.To;
  const from = payload.from ?? payload.FromFull?.Email ?? payload.From;
  const text = payload.text ?? payload.TextBody ?? "";
  if (!to || !from) return null;

  const rawAttachments = payload.attachments ?? payload.Attachments ?? [];
  const attachments: InboundAttachment[] = [];
  for (const a of rawAttachments) {
    const name = "name" in a ? a.name : (a as PostmarkAttachment).Name;
    const content = "content" in a ? a.content : (a as PostmarkAttachment).Content;
    const contentType =
      "contentType" in a ? a.contentType : (a as PostmarkAttachment).ContentType;
    if (name && content) attachments.push({ name, contentBase64: content, contentType });
  }

  return {
    to,
    from,
    subject: payload.subject ?? payload.Subject,
    textBody: text,
    attachments,
  };
}

export async function POST(req: Request) {
  const token = process.env.INBOUND_EMAIL_TOKEN;
  if (!token) return Response.json({ error: "not_found" }, { status: 404 });
  const presented = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (presented !== token) return Response.json({ error: "unauthorized" }, { status: 401 });

  let payload: PostmarkInbound & NormalizedInbound;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const input = normalize(payload);
  if (!input) return Response.json({ error: "missing_to_or_from" }, { status: 400 });

  try {
    const deps = { ...defaultDeps(await getRepository()), blobStore: getBlobStore() };
    const result = await ingestInboundEmail(deps, input);
    if (result.ok && result.route === "task_submission") {
      // New review-set documents → exemption suggestions for the studio.
      const { getJobQueue } = await import("@/jobs/queue");
      getJobQueue().enqueue("exemption_pass", {
        agencyId: result.agencyId,
        requestId: result.requestId,
      });
    }
    // Always 200 for routed-but-refused mail — providers retry non-2xx, and a
    // refusal (unknown sender, closed task) is final, not transient.
    return Response.json(result);
  } catch (e) {
    console.error("inbound email ingest failed", e);
    return Response.json({ ok: false, reason: "internal_error" }, { status: 500 });
  }
}
