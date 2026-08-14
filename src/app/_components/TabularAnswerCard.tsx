import type { TabularAnswer } from "@/domain/tabularAnswer";
import { SparkIcon } from "./ui";

/**
 * The phase-3 tabular answer (docs/connected-sources.md): actual rows from
 * the city's published data, with the provenance and basis stated where the
 * numbers are. Renders ONLY when the service composed an answer — every
 * uncertain case refused upstream, so this component never hedges.
 *
 * Merely displaying the table logs nothing (the deflection rule); the card
 * is informational, and the copy says so like every connected-source answer.
 */
export function TabularAnswerCard({ table }: { table: TabularAnswer }) {
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div style={{ padding: "12px 16px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ai)", fontWeight: 600, fontSize: "0.9rem" }}>
          <SparkIcon />
          {table.totalRows} row{table.totalRows === 1 ? "" : "s"} in {table.title}
          {table.rangeLabel ? ` — ${table.rangeLabel}` : ""}
          {table.filteredBy ? ` — matching “${table.filteredBy}”` : ""}
        </div>
        <div className="muted" style={{ fontSize: "0.8rem", marginTop: 4 }}>
          {table.basis}
        </div>
      </div>
      {/* The table scrolls inside its own box — wide datasets must never
          scroll the page sideways (mobile rule). */}
      <div style={{ overflowX: "auto", padding: "10px 16px 4px" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "0.82rem", minWidth: "100%" }}>
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th
                  key={c}
                  style={{
                    textAlign: "left",
                    padding: "6px 10px",
                    borderBottom: "1px solid var(--border)",
                    whiteSpace: "nowrap",
                    color: "var(--muted)",
                    fontWeight: 600,
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    style={{
                      padding: "5px 10px",
                      borderBottom: "1px solid var(--border)",
                      whiteSpace: "nowrap",
                      maxWidth: 320,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ padding: "0 16px 12px", fontSize: "0.8rem" }}>
        {table.shownRows < table.totalRows
          ? `Showing the first ${table.shownRows} of ${table.totalRows} rows — the full slices are in the results below. `
          : ""}
        Automated answer from the city&apos;s public data — informational, not a records
        determination under the public records law.
      </div>
    </div>
  );
}
