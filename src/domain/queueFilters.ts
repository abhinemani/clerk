/**
 * Queue filtering (§6.3 queue ergonomics at volume) — pure so the combining
 * logic (assignee AND status AND risk AND department) is unit-testable
 * without a database or a browser.
 */
import type { RiskBand } from "./deadlineRisk";
import type { RequestStatus } from "./requestLifecycle";

export type AssigneeFilter = "me" | "unassigned" | null;

export interface QueueFilters {
  assignee: AssigneeFilter;
  status: RequestStatus | null;
  risk: RiskBand | null;
  /** Department id — matches a request with ANY task in that department. */
  department: string | null;
}

export interface FilterableRow {
  assignedCoordinatorId: string | null;
  status: RequestStatus;
  riskBand: RiskBand;
  departmentIds: string[];
}

export const NO_FILTERS: QueueFilters = { assignee: null, status: null, risk: null, department: null };

export function parseQueueFilters(sp: {
  assignee?: string;
  status?: string;
  risk?: string;
  dept?: string;
}): QueueFilters {
  return {
    assignee: sp.assignee === "me" || sp.assignee === "unassigned" ? sp.assignee : null,
    status: (sp.status as RequestStatus) || null,
    risk: sp.risk === "overdue" || sp.risk === "due_soon" || sp.risk === "on_track" ? sp.risk : null,
    department: sp.dept || null,
  };
}

/** Build the query string a filter set resolves to (for links and saved filters). */
export function queueFiltersToQuery(f: QueueFilters): string {
  const params = new URLSearchParams();
  if (f.assignee) params.set("assignee", f.assignee);
  if (f.status) params.set("status", f.status);
  if (f.risk) params.set("risk", f.risk);
  if (f.department) params.set("dept", f.department);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function matchesQueueFilters(
  row: FilterableRow,
  filters: QueueFilters,
  currentUserId: string,
): boolean {
  if (filters.assignee === "me" && row.assignedCoordinatorId !== currentUserId) return false;
  if (filters.assignee === "unassigned" && row.assignedCoordinatorId != null) return false;
  if (filters.status && row.status !== filters.status) return false;
  if (filters.risk && row.riskBand !== filters.risk) return false;
  if (filters.department && !row.departmentIds.includes(filters.department)) return false;
  return true;
}

export function hasActiveFilters(f: QueueFilters): boolean {
  return f.assignee != null || f.status != null || f.risk != null || f.department != null;
}
