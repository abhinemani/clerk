/**
 * Inbound email ingest tests — the credential-address trust model: task tokens
 * submit records, request addresses only accept the requester's own voice,
 * everything else is refused and (when routable) logged.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { BlobStore, StoredBlob } from "@/adapters/blobStore";
import { InMemoryRepository, type Agency } from "./repository";
import type { ServiceDeps } from "./deps";
import { CollectingNotifier } from "./notifications";
import { ingestInboundEmail, stripQuotedReply } from "./inboundEmailService";
import { sendStaffMessage } from "./messageService";
import { submitRequest, transitionRequest } from "./requestService";
import { dispatchTask } from "./taskService";

const AGENCY: Agency = {
  id: "ag-1",
  slug: "riverton",
  name: "City of Riverton",
  stateCode: "CA",
  observedHolidays: [],
};

class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, StoredBlob>();
  async put(key: string, bytes: Buffer, contentType: string) {
    this.blobs.set(key, { bytes, contentType });
    return key;
  }
  async get(key: string) {
    return this.blobs.get(key) ?? null;
  }
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

async function setup() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-07-29T12:00:00Z"),
    // UUID-shaped ids — the req-{uuid}@ address parser requires the real shape.
    genId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    genToken: () => `tok${n}abcdef`,
    notifier: new CollectingNotifier(),
    blobStore: new MemoryBlobStore(),
  };
  const request = await submitRequest(deps, {
    agencyId: "ag-1",
    rawText: "Inspection reports.",
    requester: { email: "jordan@example.com", name: "Jordan" },
  });
  await transitionRequest(deps, { agencyId: "ag-1", requestId: request.id, to: "in_review" });
  await transitionRequest(deps, { agencyId: "ag-1", requestId: request.id, to: "in_progress" });
  const task = await dispatchTask(deps, {
    agencyId: "ag-1",
    requestId: request.id,
    scopeText: "pull reports",
  });
  return { repo, deps, request, task };
}

describe("task email-in", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });

  it("attachments on a task address become review-set documents and submit the task", async () => {
    const result = await ingestInboundEmail(s.deps, {
      to: `task-${s.task.token}@in.riverton.gov`,
      from: "lead@dept.gov",
      subject: "Re: records needed",
      textBody: "Attached.",
      attachments: [
        { name: "report.txt", contentBase64: b64("REPORT\nSSN: 123-45-6789"), contentType: "text/plain" },
      ],
    });
    expect(result).toMatchObject({ ok: true, route: "task_submission", documents: 1 });

    const task = await s.repo.getTask("ag-1", s.task.id);
    expect(task?.status).toBe("submitted");
    const docs = await s.repo.listRequestDocuments("ag-1", s.request.id);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.extractedText).toContain("SSN"); // extraction ran at ingest
    expect(docs[0]!.classification).toBe("internal");
    const events = await s.repo.listEvents("ag-1", s.request.id);
    expect(events.some((e) => e.summary.includes("Records received by email"))).toBe(true);
  });

  it("refuses mail for a task that already left the responder, leaving a trace", async () => {
    await ingestInboundEmail(s.deps, {
      to: `task-${s.task.token}@in.riverton.gov`,
      from: "lead@dept.gov",
      textBody: "first",
      attachments: [{ name: "a.txt", contentBase64: b64("x") }],
    });
    // Task is now `submitted`; a second email must not mutate it.
    const again = await ingestInboundEmail(s.deps, {
      to: `task-${s.task.token}@in.riverton.gov`,
      from: "lead@dept.gov",
      textBody: "more",
      attachments: [{ name: "b.txt", contentBase64: b64("y") }],
    });
    expect(again.ok).toBe(false);
    expect((await s.repo.listRequestDocuments("ag-1", s.request.id)).length).toBe(1);
    const events = await s.repo.listEvents("ag-1", s.request.id);
    expect(events.some((e) => e.summary.includes("was not ingested"))).toBe(true);
  });

  it("refuses an unknown task token", async () => {
    const result = await ingestInboundEmail(s.deps, {
      to: "task-nosuchtoken1@in.riverton.gov",
      from: "x@y.z",
      textBody: "hi",
      attachments: [{ name: "a.txt", contentBase64: b64("x") }],
    });
    expect(result).toEqual({ ok: false, reason: "Unknown task address." });
  });
});

describe("requester reply email-in", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });

  it("the requester's reply lands on the thread; a stranger's is refused and logged", async () => {
    const ok = await ingestInboundEmail(s.deps, {
      to: `req-${s.request.id}@in.riverton.gov`,
      from: "Jordan Alvarez <JORDAN@example.com>", // display name + case noise
      textBody: "Building inspections only, please.\n\nOn Jul 29, Dana wrote:\n> Which kind?",
    });
    expect(ok).toMatchObject({ ok: true, route: "requester_reply" });
    const thread = await s.repo.listMessages("ag-1", s.request.id);
    expect(thread).toHaveLength(1);
    expect(thread[0]!.direction).toBe("inbound");
    expect(thread[0]!.body).toBe("Building inspections only, please."); // quoted tail stripped

    const stranger = await ingestInboundEmail(s.deps, {
      to: `req-${s.request.id}@in.riverton.gov`,
      from: "attacker@evil.example",
      textBody: "I am totally Jordan.",
    });
    expect(stranger.ok).toBe(false);
    expect(await s.repo.listMessages("ag-1", s.request.id)).toHaveLength(1); // unchanged
    const events = await s.repo.listEvents("ag-1", s.request.id);
    expect(events.some((e) => e.summary.includes("unrecognized sender"))).toBe(true);
  });

  it("requester attachments attach to the request as email_ingest documents", async () => {
    const result = await ingestInboundEmail(s.deps, {
      to: `req-${s.request.id}@in.riverton.gov`,
      from: "jordan@example.com",
      textBody: "Here's the notice I mentioned.",
      attachments: [{ name: "notice.txt", contentBase64: b64("NOTICE"), contentType: "text/plain" }],
    });
    expect(result).toMatchObject({ ok: true, attachments: 1 });
    const docs = await s.repo.listRequestDocuments("ag-1", s.request.id);
    expect(docs.some((d) => d.provenance === "email_ingest")).toBe(true);
  });

  it("a reply while clarification_needed resumes the request", async () => {
    const admin = "staff-1";
    await s.deps.repo.updateRequest("ag-1", s.request.id, { status: "in_review" });
    await sendStaffMessage(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      actorUserId: admin,
      body: "Which inspections?",
      requestClarification: true,
    });
    await ingestInboundEmail(s.deps, {
      to: `req-${s.request.id}@in.riverton.gov`,
      from: "jordan@example.com",
      textBody: "Building only.",
    });
    expect((await s.repo.getRequest("ag-1", s.request.id))?.status).toBe("in_review");
  });
});

describe("stripQuotedReply", () => {
  it("keeps the fresh text, drops quotes and the attribution line", () => {
    expect(
      stripQuotedReply("Yes, all three.\r\n\r\nOn Jul 29, 2026, Records Office wrote:\n> Which?\n> Thanks"),
    ).toBe("Yes, all three.");
  });
});

