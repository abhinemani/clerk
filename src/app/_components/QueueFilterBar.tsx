"use client";

/**
 * Queue filter bar (§6.3 ergonomics at volume): assignee chips + status/
 * risk/department dropdowns, all folded into the URL query string so a
 * filtered view is a link — which is also what makes "saved filters" free:
 * a saved filter is just a named query string, kept in localStorage
 * (browser-local by design; nothing here is legally significant enough to
 * need syncing or a schema change).
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { queueFiltersToQuery, type QueueFilters } from "@/domain/queueFilters";
import { requestStatusLabel } from "@/lib/format";

interface SavedFilter {
  label: string;
  query: string;
}

function storageKey(agencySlug: string, userId: string) {
  return `clerk:savedFilters:${agencySlug}:${userId}`;
}

export function QueueFilterBar({
  agencySlug,
  userId,
  basePath,
  filters,
  availableStatuses,
  departments,
}: {
  agencySlug: string;
  userId: string;
  basePath: string;
  filters: QueueFilters;
  availableStatuses: string[];
  departments: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(agencySlug, userId));
      if (raw) setSaved(JSON.parse(raw));
    } catch {
      // Corrupt or blocked storage — saved filters just don't load; nothing to do.
    }
  }, [agencySlug, userId]);

  function persist(next: SavedFilter[]) {
    setSaved(next);
    try {
      localStorage.setItem(storageKey(agencySlug, userId), JSON.stringify(next));
    } catch {
      // Storage full/blocked — the chip still shows for this session via state.
    }
  }

  function go(next: QueueFilters) {
    router.push(`${basePath}${queueFiltersToQuery(next)}`);
  }

  const currentQuery = queueFiltersToQuery(filters);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginLeft: "auto", alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {([
          { label: "All", value: null },
          { label: "Mine", value: "me" },
          { label: "Unassigned", value: "unassigned" },
        ] as { label: string; value: QueueFilters["assignee"] }[]).map((f) => (
          <button
            key={f.label}
            type="button"
            className={`btn btn-sm${filters.assignee === f.value ? " btn-primary" : ""}`}
            onClick={() => go({ ...filters, assignee: f.value })}
          >
            {f.label}
          </button>
        ))}

        <select
          className="field"
          style={{ fontSize: "0.85rem", padding: "6px 8px", width: "auto" }}
          value={filters.status ?? ""}
          onChange={(e) => go({ ...filters, status: (e.target.value || null) as QueueFilters["status"] })}
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          {availableStatuses.map((s) => (
            <option key={s} value={s}>
              {requestStatusLabel(s)}
            </option>
          ))}
        </select>

        <select
          className="field"
          style={{ fontSize: "0.85rem", padding: "6px 8px", width: "auto" }}
          value={filters.risk ?? ""}
          onChange={(e) => go({ ...filters, risk: (e.target.value || null) as QueueFilters["risk"] })}
          aria-label="Filter by deadline risk"
        >
          <option value="">Any risk</option>
          <option value="overdue">Overdue</option>
          <option value="due_soon">Due soon</option>
          <option value="on_track">On track</option>
        </select>

        {departments.length > 0 && (
          <select
            className="field"
            style={{ fontSize: "0.85rem", padding: "6px 8px", width: "auto" }}
            value={filters.department ?? ""}
            onChange={(e) => go({ ...filters, department: e.target.value || null })}
            aria-label="Filter by department"
          >
            <option value="">Any department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}

        {currentQuery && !naming && (
          <button type="button" className="btn btn-sm" onClick={() => setNaming(true)}>
            Save this filter
          </button>
        )}
      </div>

      {naming && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            className="field"
            style={{ fontSize: "0.85rem", padding: "6px 8px", width: 160 }}
            placeholder="Name this view…"
            value={label}
            autoFocus
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && label.trim()) {
                persist([...saved.filter((s) => s.query !== currentQuery), { label: label.trim(), query: currentQuery }]);
                setLabel("");
                setNaming(false);
              }
              if (e.key === "Escape") setNaming(false);
            }}
          />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!label.trim()}
            onClick={() => {
              persist([...saved.filter((s) => s.query !== currentQuery), { label: label.trim(), query: currentQuery }]);
              setLabel("");
              setNaming(false);
            }}
          >
            Save
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNaming(false)}>
            Cancel
          </button>
        </div>
      )}

      {saved.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {saved.map((s) => (
            <span
              key={s.query}
              className={`pill${s.query === currentQuery ? " band-on_track" : ""}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}
            >
              <a
                onClick={(e) => {
                  e.preventDefault();
                  router.push(`${basePath}${s.query}`);
                }}
                href={`${basePath}${s.query}`}
                style={{ color: "inherit" }}
              >
                {s.label}
              </a>
              <button
                type="button"
                aria-label={`Remove saved filter ${s.label}`}
                onClick={() => persist(saved.filter((x) => x.query !== s.query))}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "inherit", fontSize: "0.9em" }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
