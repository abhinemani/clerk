/**
 * Milestone notification tests ("no black hole"): template-only requester
 * emails on received / work-started, per-agency opt-out, outbox-first.
 */
import { describe, expect, it } from "vitest";
import type { Notifier, OutboundMessage } from "./notifications";
import { InMemoryRepository, type Agency } from "./repository";
import type { ServiceDeps } from "./deps";
import { submitRequest, transitionRequest } from "./requestService";

const AGENCY: Agency = {
  id: "ag-1",
  slug: "riverton",
  name: "City of Riverton",
  stateCode: "CA",
  observedHolidays: [],
};

class CapturingNotifier implements Notifier {
  sent: OutboundMessage[] = [];
  async send(msg: OutboundMessage) {
    this.sent.push(msg);
    return { id: `n-${this.sent.length}`, channel: "outbox", to: msg.to, deliveredAt: new Date() };
  }
}

function ctx(workflowSettings: Agency["workflowSettings"] = null) {
  const repo = new InMemoryRepository().seedAgency({ ...AGENCY, workflowSettings });
  const notifier = new CapturingNotifier();
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-07-30T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
    notifier,
    baseUrl: "https://records.riverton.gov",
  };
  return { repo, deps, notifier };
}

describe("milestone emails", () => {
  it("confirms receipt with tracking number, deadline, and track link — and logs the delivery", async () => {
    const { repo, deps, notifier } = ctx();
    const r = await submitRequest(deps, {
      agencyId: "ag-1",
      rawText: "Sidewalk records.",
      requester: { email: "alma@example.com", name: "Alma Reyes" },
    });

    expect(notifier.sent).toHaveLength(1);
    const mail = notifier.sent[0]!;
    expect(mail.kind).toBe("requester_update");
    expect(mail.to).toBe("alma@example.com");
    expect(mail.subject).toContain(r.publicId);
    expect(mail.body).toContain(r.publicId);
    expect(mail.body).toContain("respond by 2026-08-10"); // CA 10 calendar days + weekend roll
    expect(mail.body).toContain(`https://records.riverton.gov/riverton/track?id=${r.publicId}`);

    const events = await repo.listEvents("ag-1", r.id);
    const delivery = events.find((e) => e.kind === "delivery");
    expect(delivery?.summary).toContain("request received");
  });

  it("emails when work starts (→ in_progress) and only then", async () => {
    const { deps, notifier } = ctx();
    const r = await submitRequest(deps, {
      agencyId: "ag-1",
      rawText: "Records.",
      requester: { email: "alma@example.com" },
    });
    notifier.sent = [];

    await transitionRequest(deps, { agencyId: "ag-1", requestId: r.id, to: "in_review" });
    expect(notifier.sent).toHaveLength(0); // internal shuffle — not a milestone

    await transitionRequest(deps, { agencyId: "ag-1", requestId: r.id, to: "in_progress" });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]!.subject).toContain("work started");
  });

  it("anonymous filings and opted-out agencies get nothing", async () => {
    const anon = ctx();
    await submitRequest(anon.deps, { agencyId: "ag-1", rawText: "No email given." });
    expect(anon.notifier.sent).toHaveLength(0);

    const optedOut = ctx({ milestoneEmails: false });
    await submitRequest(optedOut.deps, {
      agencyId: "ag-1",
      rawText: "Records.",
      requester: { email: "alma@example.com" },
    });
    expect(optedOut.notifier.sent).toHaveLength(0);
  });
});
