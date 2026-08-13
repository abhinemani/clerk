/**
 * Appeal-defense packet as a PDF (agentic-horizon B3) — the counsel dossier,
 * assembled by the appeal-packet agent through the run harness on each
 * download. The run itself is auditable: one `agent_action` request event
 * records the assembly and the packet's checksum, so a packet handed to
 * counsel can later be proven to match what the system produced.
 */
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { renderTextPdf } from "@/domain/textPdf";
import { runAppealPacketAssembly } from "@/agents/appealPacketAgent";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ agency: string; id: string }> },
) {
  const { agency: slug, id } = await params;
  const staff = await requireStaff(slug);

  const repo = await getRepository();
  const [agency, request] = await Promise.all([
    repo.getAgency(staff.agencyId),
    repo.getRequest(staff.agencyId, id),
  ]);
  if (!agency || !request) return new Response("Not found", { status: 404 });

  const [events, reviews, messages, releases, users, documents] = await Promise.all([
    repo.listEvents(staff.agencyId, id),
    repo.listReviews(staff.agencyId, id),
    repo.listMessages(staff.agencyId, id),
    repo.listReleases(staff.agencyId, id),
    repo.listUsers(staff.agencyId),
    repo.listRequestDocuments(staff.agencyId, id),
  ]);

  const result = await runAppealPacketAssembly({
    agencyId: staff.agencyId,
    agencyName: agency.name,
    request,
    events,
    reviews,
    messages,
    releases,
    actorNameById: new Map(users.map((u) => [u.id, u.name ?? u.email])),
    documentNameById: new Map(documents.map((d) => [d.id, d.filename ?? d.id])),
    now: new Date(),
  });

  // The assembly is an agent run on the record (§16.2) — log it, with the
  // requesting staff member as the named actor who pulled the packet.
  await repo.appendEvent({
    id: crypto.randomUUID(),
    agencyId: staff.agencyId,
    requestId: id,
    kind: "agent_action",
    actorUserId: staff.userId,
    summary: `Appeal-defense packet assembled (agent: appeal_packet, ${result.outcome})`,
    payload: {
      agent: "appeal_packet",
      outcome: result.outcome,
      checksum: result.checksum,
      steps: result.events.length,
    },
    createdAt: new Date(),
  });

  const lines = [
    ...result.text.split("\n"),
    "",
    `Packet integrity: sha256:${result.checksum} (of this packet's text content)`,
  ];
  const pdf = renderTextPdf(lines, "Appeal-defense packet");

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${request.publicId}-appeal-packet.pdf"`,
      "content-length": String(pdf.length),
    },
  });
}
