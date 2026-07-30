/**
 * Outbound notifications (spec §4: "transactional provider behind an interface;
 * console adapter in dev").
 *
 * This is the actual *delivery* that shares a request from the clerk to a
 * department head — the piece that turns a dispatched task into an email the
 * department lead receives with their no-login link. The body can be templated
 * (below) or drafted by the §6.6 correspondence pipeline; sending is a Tier-2
 * agentic action (`dispatch_task` / `staff_reminder_email`, §16.3), so it can be
 * auto-sent per agency policy or held for a human.
 *
 * Every send is recorded as an append-only `delivery` event — the source of
 * truth for who was notified, when, and with what.
 */
export type NotificationKind =
  | "task_dispatch"
  | "task_reminder"
  | "requester_update"
  | "account_verify"
  | "password_reset"
  | "staff_invite";

export interface OutboundMessage {
  agencyId: string;
  to: string;
  subject: string;
  body: string;
  kind: NotificationKind;
  /** Request-scoped messages carry these; account mail doesn't. */
  requestId?: string;
  taskId?: string;
  /** Inbound ingest address replies should land on (§6.5 email-in). */
  replyTo?: string;
}

export interface DeliveryReceipt {
  id: string;
  channel: string;
  to: string;
  deliveredAt: Date;
}

export interface Notifier {
  send(msg: OutboundMessage): Promise<DeliveryReceipt>;
}

/** Dev adapter — logs instead of sending. Swap for Postmark/SES in prod. */
export class ConsoleNotifier implements Notifier {
  constructor(private readonly now: () => Date = () => new Date()) {}
  async send(msg: OutboundMessage): Promise<DeliveryReceipt> {
    // eslint-disable-next-line no-console
    console.log(`[notify:${msg.kind}] → ${msg.to}\n  ${msg.subject}\n  ${msg.body}`);
    return {
      id: `console-${msg.taskId ?? msg.requestId}`,
      channel: "console",
      to: msg.to,
      deliveredAt: this.now(),
    };
  }
}

/**
 * DB-backed outbox adapter: every send is recorded as a `deliveries` row —
 * in dev this IS the mailbox (browsable at /[agency]/app/outbox). Wrap or
 * replace with a real SMTP adapter in production; the recording stays either
 * way, because the outbox is the audit of who was told what.
 */
export class DbNotifier implements Notifier {
  constructor(
    private readonly repo: import("./repository").Repository,
    private readonly genId: () => string = () => crypto.randomUUID(),
    private readonly now: () => Date = () => new Date(),
  ) {}
  async send(msg: OutboundMessage): Promise<DeliveryReceipt> {
    const row = await this.repo.createDelivery({
      id: this.genId(),
      agencyId: msg.agencyId,
      toEmail: msg.to,
      subject: msg.subject,
      body: msg.body,
      kind: msg.kind,
      requestId: msg.requestId ?? null,
      taskId: msg.taskId ?? null,
      createdAt: this.now(),
    });
    return { id: row.id, channel: "outbox", to: msg.to, deliveredAt: row.createdAt };
  }
}

/**
 * Production notifier: record to the outbox FIRST (the audit is never
 * conditional on the provider being up), then deliver through the configured
 * email adapter. A provider failure is logged and swallowed — the outbox row
 * stands, and the message can be re-sent from there.
 */
export class RelayNotifier implements Notifier {
  constructor(
    private readonly outbox: Notifier,
    private readonly email: import("@/adapters/email").EmailSender,
  ) {}
  async send(msg: OutboundMessage): Promise<DeliveryReceipt> {
    const receipt = await this.outbox.send(msg);
    try {
      await this.email.send({
        to: msg.to,
        subject: msg.subject,
        text: msg.body,
        replyTo: msg.replyTo,
      });
      return { ...receipt, channel: "email" };
    } catch (err) {
      console.error(`[email] delivery to ${msg.to} failed (outbox row ${receipt.id} kept)`, err);
      return receipt; // channel stays "outbox" — honest about what happened
    }
  }
}

/**
 * The ingest address for a request or task (§6.5 email-in): unguessable —
 * request ids are random UUIDs and task tokens are credentials, so possession
 * of the address is possession of the right to write to that thread. Null
 * when inbound email isn't configured.
 */
export function inboundAddress(
  kind: "request" | "task",
  idOrToken: string,
  domain: string | undefined = process.env.INBOUND_EMAIL_DOMAIN,
): string | undefined {
  if (!domain) return undefined;
  return `${kind === "request" ? "req" : "task"}-${idOrToken}@${domain}`;
}

/** Parse an inbound recipient back into its route. Null for foreign addresses. */
export function parseInboundAddress(
  to: string,
): { kind: "request"; requestId: string } | { kind: "task"; token: string } | null {
  const local = to.trim().toLowerCase().split("@")[0] ?? "";
  const req = local.match(/^req-([0-9a-f-]{36})$/);
  if (req) return { kind: "request", requestId: req[1]! };
  const task = local.match(/^task-([a-z0-9]{8,64})$/);
  if (task) return { kind: "task", token: task[1]! };
  return null;
}

/** Test adapter — captures sent messages for assertions. */
export class CollectingNotifier implements Notifier {
  readonly sent: OutboundMessage[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}
  async send(msg: OutboundMessage): Promise<DeliveryReceipt> {
    this.sent.push(msg);
    return { id: `test-${this.sent.length}`, channel: "test", to: msg.to, deliveredAt: this.now() };
  }
}

/** The base URL used to build no-login responder links (env-overridable). */
export function taskUrl(token: string, baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000") {
  return `${baseUrl}/task/${token}`;
}

/**
 * Milestone emails (spec §12-adjacent "no black hole"): template-only,
 * requester-facing, per-agency toggle (workflowSettings.milestoneEmails,
 * default on). Deliberately NOT AI-drafted — a status ping should be
 * boring, identical for everyone, and safe to send unattended.
 */
export function trackUrl(
  agencySlug: string,
  publicId: string,
  baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000",
) {
  return `${baseUrl}/${agencySlug}/track?id=${encodeURIComponent(publicId)}`;
}

export function milestoneReceivedBody(input: {
  agencyName: string;
  requesterName?: string | null;
  publicId: string;
  dueLabel: string | null;
  link: string;
}): { subject: string; body: string } {
  return {
    subject: `${input.agencyName}: request received — ${input.publicId}`,
    body: [
      `Hi ${input.requesterName ?? "there"},`,
      ``,
      `We received your public records request. Your tracking number is ${input.publicId}.`,
      input.dueLabel ? `Under our state's public records law, we expect to respond by ${input.dueLabel}.` : ``,
      ``,
      `Check status any time: ${input.link}`,
      ``,
      `You'll hear from us at each milestone — no need to write in for updates.`,
      `— ${input.agencyName} records office`,
    ]
      .filter((l) => l !== undefined)
      .join("\n"),
  };
}

export function milestoneInProgressBody(input: {
  agencyName: string;
  requesterName?: string | null;
  publicId: string;
  dueLabel: string | null;
  link: string;
}): { subject: string; body: string } {
  return {
    subject: `${input.agencyName}: work started on ${input.publicId}`,
    body: [
      `Hi ${input.requesterName ?? "there"},`,
      ``,
      `Update on ${input.publicId}: the departments that hold your records are now locating them.`,
      input.dueLabel ? `We still expect to respond by ${input.dueLabel}.` : ``,
      ``,
      `Check status any time: ${input.link}`,
      `— ${input.agencyName} records office`,
    ]
      .filter((l) => l !== undefined)
      .join("\n"),
  };
}

/** Default templated body for a task dispatch, if no AI-drafted body is supplied. */
export function defaultDispatchBody(input: {
  departmentLead?: string;
  agencyName: string;
  publicId: string;
  scope: string;
  link: string;
  dueLabel?: string;
}): { subject: string; body: string } {
  return {
    subject: `${input.agencyName}: records needed for ${input.publicId}`,
    body: [
      `Hi ${input.departmentLead ?? "there"},`,
      ``,
      `A public records request needs your department. No account needed —`,
      `open your task here: ${input.link}`,
      ``,
      `What we need: ${input.scope}`,
      input.dueLabel ? `Internal due: ${input.dueLabel}` : ``,
      ``,
      `Attach what you have and mark it done, or push back if you can't fulfill it.`,
    ]
      .filter((l) => l !== undefined)
      .join("\n"),
  };
}
