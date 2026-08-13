/**
 * Connected data sources — the connector adapter (docs/connected-sources.md).
 *
 * A connector answers three questions about an external store of PUBLIC data:
 * what datasets it offers, what one period's slice contains, and whether the
 * source is reachable. Connectors are read-only pulls, no SDKs, and pull
 * SLICES (one period of one dataset) rather than rows — v1 rides the document
 * pipeline, one document per slice.
 *
 * Phase 1 ships the FILE-DROP connector (self-contained first: any IT
 * department can schedule a CSV export into a directory) plus an in-memory
 * connector for tests and seeding. HTTP/Socrata are phase 2 behind this same
 * interface.
 *
 * TENANCY: the file-drop directory is NOT operator input. Every agency's drop
 * lives under a fixed per-agency path ({CONNECTED_DROP_PATH}/{agencyId}) that
 * the UI displays rather than asks for — a free-form path field on a shared
 * deployment would let one tenant's admin point a connector at another
 * tenant's files (or at the host filesystem generally).
 */
import { promises as fs } from "fs";
import path from "path";

export interface DatasetDescriptor {
  /** Machine name from the filename stem, e.g. "street-sweeping". */
  dataset: string;
  /** Periods present at the source, ascending (e.g. ["2026-05", "2026-06"]). */
  periods: string[];
}

export interface DatasetSlice {
  dataset: string;
  period: string;
  /**
   * The record's own date for date-aware search: the LAST day the slice
   * covers, YYYY-MM-DD. "Street cleanings, June 2026" is a June record.
   */
  recordDate: string;
  /** Raw CSV bytes — stored as the document blob, text-extracted for search. */
  csv: Buffer;
  filename: string;
}

export interface DataSourceConnector {
  listDatasets(): Promise<DatasetDescriptor[]>;
  fetchSlice(dataset: string, period: string): Promise<DatasetSlice | null>;
  probe(): Promise<{ ok: boolean; detail?: string }>;
}

/* ---- period handling ----------------------------------------------------- */

/** YYYY, YYYY-MM, or YYYY-MM-DD. Anything else is not a slice file. */
const PERIOD_RE = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/;
/** Dataset stems: word chars and dashes — no dots (dots delimit the period). */
const SLICE_FILE_RE = /^([a-z0-9][a-z0-9_-]*)\.(\d{4}(?:-\d{2}){0,2})\.csv$/i;

/** The last covered day of a period — "2026-06" → "2026-06-30". */
export function periodEndDate(period: string): string | null {
  const m = PERIOD_RE.exec(period);
  if (!m) return null;
  const year = Number(m[1]);
  if (m[3]) {
    // Full date: validate it is a real calendar day.
    const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3])));
    return d.getUTCFullYear() === year &&
      d.getUTCMonth() === Number(m[2]) - 1 &&
      d.getUTCDate() === Number(m[3])
      ? period
      : null;
  }
  if (m[2]) {
    const month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    // Day 0 of the NEXT month = last day of this one (clamping built in).
    const last = new Date(Date.UTC(year, month, 0));
    return `${period}-${String(last.getUTCDate()).padStart(2, "0")}`;
  }
  return `${year}-12-31`;
}

/** Parse "street-sweeping.2026-06.csv" → { dataset, period }, or null. */
export function parseSliceFilename(name: string): { dataset: string; period: string } | null {
  const m = SLICE_FILE_RE.exec(name);
  if (!m) return null;
  return periodEndDate(m[2]!) ? { dataset: m[1]!.toLowerCase(), period: m[2]! } : null;
}

/* ---- file-drop connector -------------------------------------------------- */

/** Fixed per-agency drop directory — displayed by the UI, never typed into it. */
export function connectedDropDir(agencyId: string): string {
  const base = process.env.CONNECTED_DROP_PATH || "./.connected-drop";
  return path.join(base, agencyId);
}

class FileDropConnector implements DataSourceConnector {
  constructor(private dir: string) {}

  private async sliceFiles(): Promise<{ dataset: string; period: string; name: string }[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return []; // No directory yet = no datasets; probe() reports it honestly.
    }
    return names
      .map((name) => {
        const parsed = parseSliceFilename(name);
        return parsed ? { ...parsed, name } : null;
      })
      .filter((x): x is { dataset: string; period: string; name: string } => x != null)
      .sort((a, b) => a.period.localeCompare(b.period));
  }

  async listDatasets(): Promise<DatasetDescriptor[]> {
    const files = await this.sliceFiles();
    const byDataset = new Map<string, string[]>();
    for (const f of files) {
      byDataset.set(f.dataset, [...(byDataset.get(f.dataset) ?? []), f.period]);
    }
    return [...byDataset.entries()]
      .map(([dataset, periods]) => ({ dataset, periods }))
      .sort((a, b) => a.dataset.localeCompare(b.dataset));
  }

  async fetchSlice(dataset: string, period: string): Promise<DatasetSlice | null> {
    const files = await this.sliceFiles();
    const match = files.find((f) => f.dataset === dataset && f.period === period);
    if (!match) return null;
    const recordDate = periodEndDate(period);
    if (!recordDate) return null;
    // Read by the LISTED name only — never a caller-assembled path.
    const csv = await fs.readFile(path.join(this.dir, match.name));
    return { dataset, period, recordDate, csv, filename: match.name };
  }

  async probe(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const stat = await fs.stat(this.dir);
      if (!stat.isDirectory()) return { ok: false, detail: `${this.dir} is not a directory` };
      const files = await this.sliceFiles();
      return { ok: true, detail: `${files.length} slice file(s) present` };
    } catch {
      return { ok: false, detail: `Drop directory not found yet (${this.dir}) — it is created on first sync, or create it and add dataset.period.csv files.` };
    }
  }
}

/* ---- in-memory connector (tests + seeding) -------------------------------- */

export interface MemorySliceInput {
  dataset: string;
  period: string;
  csv: string;
}

class MemoryConnector implements DataSourceConnector {
  constructor(private slices: MemorySliceInput[]) {}
  async listDatasets(): Promise<DatasetDescriptor[]> {
    const byDataset = new Map<string, string[]>();
    for (const s of this.slices) {
      byDataset.set(s.dataset, [...(byDataset.get(s.dataset) ?? []), s.period].sort());
    }
    return [...byDataset.entries()]
      .map(([dataset, periods]) => ({ dataset, periods }))
      .sort((a, b) => a.dataset.localeCompare(b.dataset));
  }
  async fetchSlice(dataset: string, period: string): Promise<DatasetSlice | null> {
    const s = this.slices.find((x) => x.dataset === dataset && x.period === period);
    const recordDate = s ? periodEndDate(period) : null;
    if (!s || !recordDate) return null;
    return {
      dataset,
      period,
      recordDate,
      csv: Buffer.from(s.csv, "utf8"),
      filename: `${dataset}.${period}.csv`,
    };
  }
  async probe(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}

/* ---- factory --------------------------------------------------------------- */

export const CONNECTOR_KIND_FILE_DROP = "dataset_file_drop";

export function createFileDropConnector(agencyId: string): DataSourceConnector {
  return new FileDropConnector(connectedDropDir(agencyId));
}

export function createMemoryConnector(slices: MemorySliceInput[]): DataSourceConnector {
  return new MemoryConnector(slices);
}
