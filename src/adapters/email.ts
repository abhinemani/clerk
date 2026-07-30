/**
 * Outbound email (spec §4: "transactional provider behind an interface").
 *
 * Two HTTP providers, no SDKs (fetch only, per the adapter rule): Postmark and
 * Resend. `getEmailSender()` picks from env; when neither is configured the
 * app keeps its outbox-only behavior — every environment works, production
 * just also delivers.
 *
 *   POSTMARK_SERVER_TOKEN=... EMAIL_FROM="Riverton Records <records@r.gov>"
 *   RESEND_API_KEY=...        EMAIL_FROM=...
 *
 * The outbox row is always written first (the audit of who was told what);
 * delivery is the extra step, never the record.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Where replies should land — the inbound ingest address (§6.5 email-in). */
  replyTo?: string;
}

export interface EmailSender {
  /** Returns the provider's message id. Throws on non-2xx. */
  send(msg: EmailMessage): Promise<{ providerId: string }>;
}

type FetchLike = typeof fetch;

export class PostmarkEmailSender implements EmailSender {
  constructor(
    private readonly serverToken: string,
    private readonly from: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(msg: EmailMessage): Promise<{ providerId: string }> {
    const res = await this.fetchImpl("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-postmark-server-token": this.serverToken,
      },
      body: JSON.stringify({
        From: this.from,
        To: msg.to,
        Subject: msg.subject,
        TextBody: msg.text,
        ...(msg.replyTo ? { ReplyTo: msg.replyTo } : {}),
        MessageStream: "outbound",
      }),
    });
    if (!res.ok) throw new Error(`Postmark send failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { MessageID?: string };
    return { providerId: json.MessageID ?? "postmark" };
  }
}

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(msg: EmailMessage): Promise<{ providerId: string }> {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        from: this.from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { id?: string };
    return { providerId: json.id ?? "resend" };
  }
}

/**
 * The configured sender, or null when email delivery is off (outbox-only dev
 * mode). EMAIL_FROM is required either way — refusing to guess a From line.
 */
export function getEmailSender(env: NodeJS.ProcessEnv = process.env): EmailSender | null {
  const from = env.EMAIL_FROM;
  if (!from) return null;
  if (env.POSTMARK_SERVER_TOKEN) return new PostmarkEmailSender(env.POSTMARK_SERVER_TOKEN, from);
  if (env.RESEND_API_KEY) return new ResendEmailSender(env.RESEND_API_KEY, from);
  return null;
}
