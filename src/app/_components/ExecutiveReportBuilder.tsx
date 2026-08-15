"use client";

/**
 * Executive report builder (docs/executive-reporting.md) — the clerk picks a
 * window (day / week / month + a date inside it), toggles sections, adds an
 * optional framing note, and generates the typeset PDF on demand. No
 * schedule, no stored artifact: the report is deterministic from the request
 * log, so any period can be regenerated identically later.
 *
 * Preferences persist in localStorage (browser-local by design — the same
 * posture as the queue's saved filters).
 */
import { useEffect, useMemo, useState } from "react";
import {
  ALL_SECTION_IDS,
  EXECUTIVE_SECTIONS,
  reportPeriod,
  type ExecutiveSectionId,
  type ReportPeriodKind,
} from "@/reporting/executiveSummary";

const STORAGE_KEY = "brandeis:executive-report";

interface StoredPrefs {
  period?: ReportPeriodKind;
  sections?: string[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ExecutiveReportBuilder({ slug }: { slug: string }) {
  const [period, setPeriod] = useState<ReportPeriodKind>("week");
  const [date, setDate] = useState<string>(todayIso());
  const [sections, setSections] = useState<ReadonlySet<string>>(new Set(ALL_SECTION_IDS));
  const [note, setNote] = useState("");

  // Restore prefs after mount (not in the initial render — hydration must
  // match the server, which can't see localStorage).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw) as StoredPrefs;
      if (prefs.period === "day" || prefs.period === "week" || prefs.period === "month") setPeriod(prefs.period);
      if (Array.isArray(prefs.sections)) {
        const known = prefs.sections.filter((s) => (ALL_SECTION_IDS as readonly string[]).includes(s));
        if (known.length > 0) setSections(new Set(known));
      }
    } catch {
      // Unreadable prefs are just defaults.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ period, sections: [...sections] } satisfies StoredPrefs));
    } catch {
      // Storage full/blocked — generating still works, prefs just don't stick.
    }
  }, [period, sections]);

  const periodLabel = useMemo(() => {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : new Date();
    return reportPeriod(period, Number.isNaN(parsed.getTime()) ? new Date() : parsed).label;
  }, [period, date]);

  const href = useMemo(() => {
    const params = new URLSearchParams({ period, date, sections: [...sections].join(",") });
    const trimmed = note.trim();
    if (trimmed) params.set("note", trimmed.slice(0, 600));
    return `/${slug}/app/reports/executive-report.pdf?${params.toString()}`;
  }, [slug, period, date, sections, note]);

  const toggle = (id: ExecutiveSectionId) => {
    setSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="card card-pad">
      <div className="panel-title">Executive report</div>
      <p className="muted" style={{ margin: "10px 0 0", fontSize: "0.88rem", maxWidth: 620 }}>
        A typeset PDF for a city manager, council, or department head: what came in, what
        went out, and how the office performed — for the day, week, or month you pick.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14 }}>
        <label style={{ display: "grid", gap: 4, fontSize: "0.8rem" }} className="muted">
          Report window
          <select value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriodKind)}>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: "0.8rem" }} className="muted">
          Any date inside it
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <span className="pill">{periodLabel}</span>
      </div>

      <div style={{ display: "flex", gap: "6px 16px", flexWrap: "wrap", marginTop: 14 }}>
        {EXECUTIVE_SECTIONS.map((s) => (
          <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
            <input type="checkbox" checked={sections.has(s.id)} onChange={() => toggle(s.id)} />
            {s.label}
          </label>
        ))}
      </div>

      <label className="muted" style={{ display: "grid", gap: 4, fontSize: "0.8rem", marginTop: 14 }}>
        Framing note (optional — printed under the header)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={600}
          rows={2}
          placeholder="e.g. Prepared for the March 3 council meeting."
          style={{ resize: "vertical" }}
        />
      </label>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
        <a
          className="btn btn-sm"
          href={sections.size > 0 ? href : undefined}
          target="_blank"
          rel="noopener"
          aria-disabled={sections.size === 0}
          style={sections.size === 0 ? { pointerEvents: "none", opacity: 0.5 } : undefined}
        >
          Generate PDF
        </a>
        {sections.size === 0 && (
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            Pick at least one section.
          </span>
        )}
      </div>
    </div>
  );
}
