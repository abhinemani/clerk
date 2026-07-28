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
export type NotificationKind = "task_dispatch" | "task_reminder" | "requester_update";

export interface OutboundMessage {
  to: string;
  subject: string;
  body: string;
  kind: NotificationKind;
  requestId: string;
  taskId?: string;
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
