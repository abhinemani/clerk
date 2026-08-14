import { notFound } from "next/navigation";
import { DEMO_AGENCY, DEMO_NOW, findTaskByToken, getDepartment } from "@/lib/demo";
import { getRepository } from "@/db/createRepository";
import { daysLabel } from "@/lib/format";
import type { TaskStatus } from "@/domain/taskWorkflow";
import { TaskConsole } from "../../_components/TaskConsole";

export const dynamic = "force-dynamic";

const MS_DAY = 86_400_000;

interface TaskView {
  agencyName: string;
  requestPublicId: string;
  deptName: string;
  deptLead: string;
  scope: string;
  dueLabel: string;
  status: TaskStatus;
  uploads: { name: string; pages: number }[];
  /** Live tasks post through server actions; demo-fixture ones stay local. */
  live: boolean;
}

/** Live DB first; the demo fixture only backs its own hardcoded tokens. */
async function loadTask(token: string): Promise<TaskView | null> {
  const repo = await getRepository();
  const task = await repo.getTaskByToken(token);
  if (task) {
    const [agency, request, departments] = await Promise.all([
      repo.getAgency(task.agencyId),
      repo.getRequest(task.agencyId, task.requestId),
      repo.listDepartments(task.agencyId),
    ]);
    const dept = departments.find((d) => d.id === task.departmentId);
    const dueDays = task.dueAt ? Math.round((task.dueAt.getTime() - Date.now()) / MS_DAY) : null;
    return {
      agencyName: agency?.name ?? "Records office",
      requestPublicId: request?.publicId ?? "",
      deptName: dept?.name ?? "your department",
      // Live tasks address the department, not a named person.
      deptLead: "there",
      scope: task.scopeText,
      dueLabel: dueDays != null ? `Coordinator needs this — internal ${daysLabel(dueDays)}` : "Coordinator needs this",
      status: task.status,
      uploads: task.uploads.map((u) => ({ name: u.name, pages: u.pages ?? 1 })),
      live: true,
    };
  }

  const hit = findTaskByToken(token);
  if (!hit) return null;
  const dept = getDepartment(hit.task.departmentId);
  const dueDays = Math.round((hit.task.dueAt.getTime() - DEMO_NOW.getTime()) / MS_DAY);
  return {
    agencyName: DEMO_AGENCY.name,
    requestPublicId: hit.request.publicId,
    deptName: dept?.name ?? "Department",
    deptLead: dept?.lead ?? "there",
    scope: hit.task.scope,
    dueLabel: `Coordinator needs this — internal ${daysLabel(dueDays)}`,
    status: hit.task.status,
    uploads: hit.task.uploads,
    live: false,
  };
}

/**
 * Responder task page (§3): tokenized, no-login. The department leader who holds
 * the records fulfills a single scoped ask — the other half of the coordinator ↔
 * department workflow.
 */
export default async function TaskPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await loadTask(token);
  if (!view) notFound();

  return (
    <div className="wrap" style={{ maxWidth: 720, paddingBlock: "var(--page-top) var(--page-bottom)" }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <span className="eyebrow">{view.agencyName} · Records request task</span>
        <h1 style={{ fontSize: "1.5rem", marginTop: 8 }}>
          Hi {view.deptLead.split(" ").slice(-1)[0]} — a records request needs {view.deptName}.
        </h1>
        <p className="muted" style={{ marginTop: 8, fontSize: "0.95rem" }}>
          No account needed. This link is unique to this task. Attach what you have and mark it done,
          or push back if you can&apos;t fulfill it.
        </p>
      </div>

      <TaskConsole
        token={token}
        live={view.live}
        requestPublicId={view.requestPublicId}
        agencyName={view.agencyName}
        deptName={view.deptName}
        deptLead={view.deptLead}
        scope={view.scope}
        dueLabel={view.dueLabel}
        initialStatus={view.status}
        initialUploads={view.uploads}
      />

      <p className="muted" style={{ fontSize: "0.8rem", textAlign: "center", marginTop: 18 }}>
        Part of public records request {view.requestPublicId}. Questions? Reply to the email that
        linked you here.
      </p>
    </div>
  );
}
