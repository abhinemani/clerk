import { notFound } from "next/navigation";
import { DEMO_AGENCY, DEMO_NOW, findTaskByToken, getDepartment } from "@/lib/demo";
import { daysLabel } from "@/lib/format";
import { TaskConsole } from "../../_components/TaskConsole";

const MS_DAY = 86_400_000;

/**
 * Responder task page (§3): tokenized, no-login. The department leader who holds
 * the records fulfills a single scoped ask — the other half of the coordinator ↔
 * department workflow.
 */
export default async function TaskPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const hit = findTaskByToken(token);
  if (!hit) notFound();

  const { request, task } = hit;
  const dept = getDepartment(task.departmentId);
  const dueDays = Math.round((task.dueAt.getTime() - DEMO_NOW.getTime()) / MS_DAY);

  return (
    <div className="wrap" style={{ maxWidth: 720, paddingBlock: "40px" }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <span className="eyebrow">{DEMO_AGENCY.name} · Records request task</span>
        <h1 style={{ fontSize: "1.5rem", marginTop: 8 }}>
          Hi {dept?.lead?.split(" ").slice(-1)[0] ?? "there"} — a records request needs {dept?.name}.
        </h1>
        <p className="muted" style={{ marginTop: 8, fontSize: "0.95rem" }}>
          No account needed. This link is unique to this task. Attach what you have and mark it done,
          or push back if you can&apos;t fulfill it.
        </p>
      </div>

      <TaskConsole
        requestPublicId={request.publicId}
        agencyName={DEMO_AGENCY.name}
        deptName={dept?.name ?? "Department"}
        deptLead={dept?.lead ?? "Lead"}
        scope={task.scope}
        dueLabel={`Coordinator needs this — internal ${daysLabel(dueDays)}`}
        initialStatus={task.status}
        initialUploads={task.uploads}
      />

      <p className="muted" style={{ fontSize: "0.8rem", textAlign: "center", marginTop: 18 }}>
        Part of public records request {request.publicId}. Questions? Reply to the email that linked
        you here.
      </p>
    </div>
  );
}
