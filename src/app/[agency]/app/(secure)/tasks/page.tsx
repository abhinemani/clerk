import Link from "next/link";
import { notFound } from "next/navigation";
import { ALL_STAFF_ROLES, requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { dateShort } from "@/lib/format";
import { StatusPill } from "../../../../_components/ui";

export const dynamic = "force-dynamic";

const TASK_LABEL: Record<string, string> = {
  assigned: "Assigned",
  in_progress: "In progress",
  submitted: "Submitted",
  pushed_back: "Pushed back",
  done: "Done",
  cancelled: "Cancelled",
};

/** Open = the responder still owes something (or is waiting on review). */
const OPEN_TASK_STATUSES = new Set(["assigned", "in_progress", "submitted", "pushed_back"]);

/**
 * Department task list — the responder's home (department-scoped accounts).
 * A responder signs in and sees exactly the tasks routed to THEIR departments;
 * fulfilling still happens on the same /task/[token] surface the no-login
 * email link uses, so there is one upload flow to maintain. Coordinators and
 * admins see every department (useful as a workload view).
 */
export default async function DepartmentTasksPage({
  params,
}: {
  params: Promise<{ agency: string }>;
}) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency) notFound();
  const staff = await requireStaff(slug, ALL_STAFF_ROLES);

  const repo = await getRepository();
  const [allTasks, departments, requests] = await Promise.all([
    repo.listAgencyTasks(staff.agencyId),
    repo.listDepartments(staff.agencyId),
    repo.listRequests(staff.agencyId),
  ]);

  // Responders see only their departments' tasks; coordinator-and-up see all.
  const isResponder = staff.role === "responder";
  const myDeptIds = isResponder
    ? new Set(await repo.listUserDepartmentIds(staff.agencyId, staff.userId))
    : null;

  const deptById = new Map(departments.map((d) => [d.id, d.name]));
  const requestById = new Map(requests.map((r) => [r.id, r]));

  const visible = allTasks
    .filter((t) => (myDeptIds ? t.departmentId != null && myDeptIds.has(t.departmentId) : true))
    .map((t) => ({
      task: t,
      deptName: t.departmentId ? (deptById.get(t.departmentId) ?? "Department") : "Unassigned",
      request: requestById.get(t.requestId) ?? null,
    }));
  const open = visible.filter(({ task }) => OPEN_TASK_STATUSES.has(task.status));
  const closed = visible.filter(({ task }) => !OPEN_TASK_STATUSES.has(task.status));

  return (
    <div className="wrap" style={{ maxWidth: 860, paddingBlock: "28px 48px" }}>
      {!isResponder && (
        <Link href={`/${slug}/app`} className="muted" style={{ fontSize: "0.9rem" }}>
          ← Queue
        </Link>
      )}
      <span className="eyebrow" style={{ display: "block", marginTop: 12 }}>
        {agency.name} · Records tasks
      </span>
      <h1 className="serif" style={{ fontSize: "1.7rem", marginTop: 6, fontWeight: 600 }}>
        {isResponder ? "Your department tasks" : "Department tasks"}
      </h1>
      <p className="muted" style={{ marginTop: 6, maxWidth: 560 }}>
        {isResponder
          ? "Requests routed to your department. Open a task to upload the responsive records — the records office takes it from there."
          : "Every open ask across departments, and who still owes what."}
      </p>

      {isResponder && myDeptIds && myDeptIds.size === 0 && (
        <div className="card card-pad" style={{ marginTop: 18 }}>
          <p style={{ fontSize: "0.95rem" }}>
            Your account isn&apos;t assigned to a department yet — ask your records administrator to
            add you to one under Manage staff.
          </p>
        </div>
      )}

      <h2 style={{ fontSize: "1.02rem", marginTop: 24, marginBottom: 10 }}>
        Open · {open.length}
      </h2>
      <div className="stack" style={{ gap: 10 }}>
        {open.map(({ task, deptName, request }) => (
          <div key={task.id} className="card card-pad" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="tag">{deptName}</span>
                {request && <span className="mono muted" style={{ fontSize: "0.78rem" }}>{request.publicId}</span>}
                {task.dueAt && (
                  <span className="muted" style={{ fontSize: "0.8rem" }}>
                    internal due {dateShort(task.dueAt)}
                  </span>
                )}
              </div>
              <div style={{ fontWeight: 600, marginTop: 6, fontSize: "0.95rem" }}>{task.scopeText}</div>
              {task.pushbackNotes && (
                <div className="muted" style={{ fontSize: "0.82rem", marginTop: 4 }}>
                  Pushback: {task.pushbackNotes}
                </div>
              )}
            </div>
            <StatusPill label={TASK_LABEL[task.status] ?? task.status} />
            <Link href={`/task/${task.token}`} className="btn btn-sm btn-primary">
              {task.status === "submitted" ? "View submission" : "Open & fulfill"}
            </Link>
          </div>
        ))}
        {open.length === 0 && (
          <p className="muted" style={{ fontSize: "0.92rem" }}>
            Nothing outstanding. New tasks appear here the moment a coordinator dispatches them.
          </p>
        )}
      </div>

      {closed.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.02rem", marginTop: 28, marginBottom: 10 }}>
            Completed · {closed.length}
          </h2>
          <div className="stack" style={{ gap: 8 }}>
            {closed.map(({ task, deptName, request }) => (
              <div key={task.id} className="card" style={{ padding: "10px 14px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span className="tag">{deptName}</span>
                {request && <span className="mono muted" style={{ fontSize: "0.78rem" }}>{request.publicId}</span>}
                <span className="muted" style={{ flex: 1, minWidth: 200, fontSize: "0.88rem" }}>{task.scopeText}</span>
                <StatusPill label={TASK_LABEL[task.status] ?? task.status} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
