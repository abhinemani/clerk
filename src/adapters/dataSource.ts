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
import { parseCsvTable } from "@/domain/legacyImport";

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
  /**
   * The slice's column names, in order. Phase 2 uses these for schema-drift
   * detection: a standing attestation covers the data SHAPE a human looked
   * at, so a source that starts sending different columns must fall back to
   * review rather than keep auto-publishing.
   */
  columns: string[];
  /**
   * True when a row cap stopped the pull short. Never silently truncate —
   * the service reports this on the sync event and the admin surface.
   */
  truncated?: boolean;
}

export interface DataSourceConnector {
  listDatasets(): Promise<DatasetDescriptor[]>;
  fetchSlice(dataset: string, period: string): Promise<DatasetSlice | null>;
  probe(): Promise<{ ok: boolean; detail?: string }>;
}

/** Injectable fetch, so connector tests never touch the network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Outbound calls are bounded: a hung portal must not wedge a sync job. */
const HTTP_TIMEOUT_MS = 20_000;
/** Per-slice row ceiling. Hit it and the slice reports truncated:true. */
const MAX_SLICE_ROWS = 100_000;

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

/* ---- rows → period slices (shared by HTTP and Socrata) -------------------- */

export type DataRow = Record<string, string>;

/** Column order: first row's keys, then any key a later row introduces. */
export function columnsOf(rows: DataRow[]): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        cols.push(key);
      }
    }
  }
  return cols;
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize rows to CSV with a stable header — the slice's stored bytes. */
export function rowsToCsv(rows: DataRow[], columns: string[]): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c] ?? "")).join(","));
  }
  return lines.join("\n");
}

/** Parse a CSV document into rows keyed by header name. */
export function csvToRows(text: string): DataRow[] {
  const table = parseCsvTable(text).filter((r) => r.some((c) => c.trim() !== ""));
  const [header, ...body] = table;
  if (!header) return [];
  return body.map((cells) => {
    const row: DataRow = {};
    header.forEach((name, i) => {
      row[name.trim()] = cells[i] ?? "";
    });
    return row;
  });
}

/** JSON array of flat objects (Socrata's shape) → string-valued rows. */
export function jsonToRows(payload: unknown): DataRow[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((item) => {
    const row: DataRow = {};
    if (item && typeof item === "object") {
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        // Nested values (Socrata location columns) flatten to JSON so the
        // text rendition stays searchable rather than "[object Object]".
        row[k] = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      }
    }
    return row;
  });
}

/** The YYYY-MM a row belongs to, from its date field. Null = undated. */
export function periodOfRow(row: DataRow, dateField: string): string | null {
  const raw = (row[dateField] ?? "").trim();
  if (!raw) return null;
  // ISO-ish (2026-07-01T00:00:00.000) and US-ish (07/01/2026) both appear in
  // real portal exports; anything else is left undated rather than guessed.
  const iso = /^(\d{4})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The specific day a row covers (YYYY-MM-DD), for the phase-3 row store.
 * Same tolerant parsing as periodOfRow; anything unparseable takes the
 * fallback (the slice's own recordDate) rather than a guess — a row is never
 * dated more precisely than the evidence supports.
 */
export function rowRecordDate(row: DataRow, dateField: string | undefined, fallback: string): string {
  const raw = dateField ? (row[dateField] ?? "").trim() : "";
  if (!raw) return fallback;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString().slice(0, 10);
}

/** Group rows into monthly slices — the unit a "June 2026" record covers. */
export function rowsToSlices(
  dataset: string,
  rows: DataRow[],
  dateField: string,
): DatasetSlice[] {
  const byPeriod = new Map<string, DataRow[]>();
  for (const row of rows) {
    const period = periodOfRow(row, dateField);
    // Undated rows are DROPPED from period slices rather than dumped into an
    // arbitrary month: a wrong date is worse than an absent row here, since
    // recordDate is what the archive's "last 3 months" filter trusts.
    if (!period) continue;
    byPeriod.set(period, [...(byPeriod.get(period) ?? []), row]);
  }
  const columns = columnsOf(rows);
  return [...byPeriod.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, periodRows]) => ({
      dataset,
      period,
      recordDate: periodEndDate(period)!,
      csv: Buffer.from(rowsToCsv(periodRows, columns), "utf8"),
      filename: `${dataset}.${period}.csv`,
      columns,
    }));
}

/** Every month from `from` to `to` inclusive, as YYYY-MM. */
export function monthsBetween(from: string, to: string): string[] {
  const start = /^(\d{4})-(\d{2})/.exec(from);
  const end = /^(\d{4})-(\d{2})/.exec(to);
  if (!start || !end) return [];
  const out: string[] = [];
  let y = Number(start[1]);
  let m = Number(start[2]);
  const endY = Number(end[1]);
  const endM = Number(end[2]);
  // Guard against a portal reporting a nonsense range (or a clock skew):
  // 600 months is 50 years of monthly slices, far past any real dataset.
  for (let guard = 0; guard < 600 && (y < endY || (y === endY && m <= endM)); guard++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Bearer token for an outbound connector, read from the ENVIRONMENT.
 *
 * The DB stores only the variable NAME (mappingConfig.tokenEnv), never the
 * secret — the same rule `sources.credentials_ref` states in the schema.
 * A deployment that needs an authenticated feed sets the variable; nothing
 * a tenant admin types is ever used as a credential. */
export function bearerFromEnv(tokenEnv: string | undefined): string | null {
  if (!tokenEnv || !/^[A-Z][A-Z0-9_]*$/.test(tokenEnv)) return null;
  return process.env[tokenEnv]?.trim() || null;
}

async function fetchText(
  doFetch: FetchLike,
  url: string,
  tokenEnv?: string,
): Promise<{ ok: true; body: string; contentType: string } | { ok: false; detail: string }> {
  try {
    const token = bearerFromEnv(tokenEnv);
    const res = await doFetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} from the source` };
    return {
      ok: true,
      body: await res.text(),
      contentType: res.headers.get("content-type") ?? "",
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "request failed" };
  }
}

/** CSV or JSON, decided by content type with a body sniff as backup. */
function bodyToRows(body: string, contentType: string): DataRow[] {
  const looksJson = contentType.includes("json") || /^\s*[[{]/.test(body);
  if (looksJson) {
    try {
      return jsonToRows(JSON.parse(body));
    } catch {
      return [];
    }
  }
  return csvToRows(body);
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
    return {
      dataset,
      period,
      recordDate,
      csv,
      filename: match.name,
      columns: columnsOf(csvToRows(csv.toString("utf8"))),
    };
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
      columns: columnsOf(csvToRows(s.csv)),
    };
  }
  async probe(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}

/* ---- HTTP connector (phase 2) ---------------------------------------------- */

/**
 * One URL holding the whole dataset (CSV or JSON), sliced client-side by a
 * date column. This is the shape small offices actually publish: a nightly
 * export at a stable URL. Re-fetches the file per sync — fine at the scale
 * of a city's sweeping log, and the checksum diff means an unchanged file
 * costs one download and zero writes.
 */
class HttpConnector implements DataSourceConnector {
  constructor(
    private cfg: { url: string; dataset: string; dateField: string; tokenEnv?: string },
    private doFetch: FetchLike,
  ) {}

  private async rows(): Promise<{ rows: DataRow[]; error?: string }> {
    const res = await fetchText(this.doFetch, this.cfg.url, this.cfg.tokenEnv);
    if (!res.ok) return { rows: [], error: res.detail };
    return { rows: bodyToRows(res.body, res.contentType) };
  }

  async listDatasets(): Promise<DatasetDescriptor[]> {
    const { rows } = await this.rows();
    const periods = rowsToSlices(this.cfg.dataset, rows, this.cfg.dateField).map((s) => s.period);
    return periods.length > 0 ? [{ dataset: this.cfg.dataset, periods }] : [];
  }

  async fetchSlice(dataset: string, period: string): Promise<DatasetSlice | null> {
    if (dataset !== this.cfg.dataset) return null;
    const { rows } = await this.rows();
    return (
      rowsToSlices(this.cfg.dataset, rows, this.cfg.dateField).find((s) => s.period === period) ??
      null
    );
  }

  async probe(): Promise<{ ok: boolean; detail?: string }> {
    const { rows, error } = await this.rows();
    if (error) return { ok: false, detail: error };
    if (rows.length === 0) return { ok: false, detail: "Fetched, but no rows parsed (CSV or JSON array expected)." };
    const dated = rows.filter((r) => periodOfRow(r, this.cfg.dateField) != null).length;
    if (dated === 0) {
      return {
        ok: false,
        detail: `No row carries a readable date in "${this.cfg.dateField}" — check the column name.`,
      };
    }
    return { ok: true, detail: `${rows.length} row(s), ${dated} dated on "${this.cfg.dateField}"` };
  }
}

/* ---- Socrata connector (phase 2) ------------------------------------------- */

/**
 * Socrata open-data portals (data.cityofchicago.org, data.seattle.gov, …).
 * Unlike the HTTP connector this slices SERVER-side with SoQL, so a portal
 * with millions of rows still costs one month per request — the reason the
 * protocol earns its own connector rather than a URL template.
 *
 * Fetch-only, no SDK (the same rule the email providers follow).
 */
class SocrataConnector implements DataSourceConnector {
  constructor(
    private cfg: { domain: string; datasetId: string; dataset: string; dateField: string; tokenEnv?: string },
    private doFetch: FetchLike,
  ) {}

  private url(ext: "csv" | "json", query: string): string {
    return `https://${this.cfg.domain}/resource/${this.cfg.datasetId}.${ext}?${query}`;
  }

  async listDatasets(): Promise<DatasetDescriptor[]> {
    // One aggregate call tells us the whole span; months in between become
    // the sliceable periods. Cheaper and more honest than guessing a range.
    const q = `$select=min(${this.cfg.dateField})%20as%20lo,max(${this.cfg.dateField})%20as%20hi`;
    const res = await fetchText(this.doFetch, this.url("json", q), this.cfg.tokenEnv);
    if (!res.ok) return [];
    let lo: string | undefined;
    let hi: string | undefined;
    try {
      const parsed = JSON.parse(res.body) as { lo?: string; hi?: string }[];
      lo = parsed[0]?.lo;
      hi = parsed[0]?.hi;
    } catch {
      return [];
    }
    if (!lo || !hi) return [];
    const periods = monthsBetween(lo, hi);
    return periods.length > 0 ? [{ dataset: this.cfg.dataset, periods }] : [];
  }

  async fetchSlice(dataset: string, period: string): Promise<DatasetSlice | null> {
    if (dataset !== this.cfg.dataset) return null;
    const recordDate = periodEndDate(period);
    if (!recordDate) return null;
    const [y, m] = period.split("-").map(Number) as [number, number];
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const where = encodeURIComponent(
      `${this.cfg.dateField} >= '${period}-01T00:00:00' AND ${this.cfg.dateField} < '${nextMonth}T00:00:00'`,
    );

    const PAGE = 20_000;
    const rows: DataRow[] = [];
    let truncated = false;
    for (let offset = 0; ; offset += PAGE) {
      const q = `$where=${where}&$order=${this.cfg.dateField}&$limit=${PAGE}&$offset=${offset}`;
      const res = await fetchText(this.doFetch, this.url("json", q), this.cfg.tokenEnv);
      if (!res.ok) return null; // a failed page is a failed slice, not a partial one
      let page: DataRow[];
      try {
        page = jsonToRows(JSON.parse(res.body));
      } catch {
        return null;
      }
      rows.push(...page);
      if (page.length < PAGE) break;
      if (rows.length >= MAX_SLICE_ROWS) {
        truncated = true;
        break;
      }
    }
    if (rows.length === 0) return null;

    const columns = columnsOf(rows);
    return {
      dataset,
      period,
      recordDate,
      csv: Buffer.from(rowsToCsv(rows, columns), "utf8"),
      filename: `${dataset}.${period}.csv`,
      columns,
      ...(truncated ? { truncated: true } : {}),
    };
  }

  async probe(): Promise<{ ok: boolean; detail?: string }> {
    const res = await fetchText(this.doFetch, this.url("json", "$limit=1"), this.cfg.tokenEnv);
    if (!res.ok) return { ok: false, detail: res.detail };
    let rows: DataRow[] = [];
    try {
      rows = jsonToRows(JSON.parse(res.body));
    } catch {
      return { ok: false, detail: "Portal did not return JSON — check the dataset id." };
    }
    if (rows.length === 0) return { ok: false, detail: "Dataset is reachable but empty." };
    if (!(this.cfg.dateField in rows[0]!)) {
      return {
        ok: false,
        detail: `Column "${this.cfg.dateField}" is not in this dataset. Available: ${Object.keys(rows[0]!).slice(0, 8).join(", ")}`,
      };
    }
    return { ok: true, detail: `Reachable; slicing on "${this.cfg.dateField}"` };
  }
}

/* ---- config + factory ------------------------------------------------------- */

export const CONNECTOR_KIND_FILE_DROP = "dataset_file_drop";
export const CONNECTOR_KIND_HTTP = "dataset_http";
export const CONNECTOR_KIND_SOCRATA = "dataset_socrata";

export type ConnectorKind =
  | typeof CONNECTOR_KIND_FILE_DROP
  | typeof CONNECTOR_KIND_HTTP
  | typeof CONNECTOR_KIND_SOCRATA;

export const CONNECTOR_KINDS: ConnectorKind[] = [
  CONNECTOR_KIND_FILE_DROP,
  CONNECTOR_KIND_HTTP,
  CONNECTOR_KIND_SOCRATA,
];

export interface ConnectorConfig {
  /** HTTP: the full URL of the export. */
  url?: string;
  /** Socrata: portal host, e.g. "data.cityofchicago.org". */
  domain?: string;
  /** Socrata: the 4x4 resource id, e.g. "ygr5-vcbg". */
  datasetId?: string;
  /** Dataset name used in slice filenames and titles. */
  dataset?: string;
  /** Column the slicing date comes from. */
  dateField?: string;
  /** NAME of the env var holding a bearer token — never the token itself. */
  tokenEnv?: string;
}

/** Slug rules shared by dataset names (they become filenames + titles). */
const DATASET_RE = /^[a-z0-9][a-z0-9_-]*$/;
const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
const SOCRATA_ID_RE = /^[a-z0-9]{4}-[a-z0-9]{4}$/i;

/**
 * Validate operator-entered connector config. Returns a normalized config or
 * a human-readable reason. Tenant admins type these values, so nothing here
 * is trusted: URLs must be https (no file://, no plaintext http exfil), the
 * Socrata domain must look like a host, and the token field takes an env var
 * NAME only — the one place a credential could otherwise reach the database.
 */
export function validateConnectorConfig(
  kind: string,
  raw: ConnectorConfig,
): { ok: true; kind: ConnectorKind; config: ConnectorConfig } | { ok: false; reason: string } {
  const dataset = (raw.dataset ?? "").trim().toLowerCase();
  const dateField = (raw.dateField ?? "").trim();
  const tokenEnv = (raw.tokenEnv ?? "").trim() || undefined;
  if (tokenEnv && !/^[A-Z][A-Z0-9_]*$/.test(tokenEnv)) {
    return { ok: false, reason: "Token env var must be an UPPER_SNAKE_CASE variable name — never paste the secret itself." };
  }

  if (kind === CONNECTOR_KIND_FILE_DROP) {
    return { ok: true, kind: CONNECTOR_KIND_FILE_DROP, config: {} };
  }

  if (!DATASET_RE.test(dataset)) {
    return { ok: false, reason: "Dataset name: lowercase letters, numbers, dashes (e.g. street-sweeping)." };
  }
  if (!dateField) return { ok: false, reason: "Name the date column the records are sliced by." };

  if (kind === CONNECTOR_KIND_HTTP) {
    const url = (raw.url ?? "").trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: "Enter a full URL, e.g. https://data.yourcity.gov/exports/sweeping.csv" };
    }
    if (parsed.protocol !== "https:") {
      return { ok: false, reason: "Only https URLs are supported." };
    }
    return { ok: true, kind: CONNECTOR_KIND_HTTP, config: { url: parsed.toString(), dataset, dateField, tokenEnv } };
  }

  if (kind === CONNECTOR_KIND_SOCRATA) {
    const domain = (raw.domain ?? "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const datasetId = (raw.datasetId ?? "").trim().toLowerCase();
    if (!DOMAIN_RE.test(domain)) {
      return { ok: false, reason: "Portal domain looks wrong — e.g. data.cityofchicago.org" };
    }
    if (!SOCRATA_ID_RE.test(datasetId)) {
      return { ok: false, reason: "Socrata dataset id is a 4x4 code, e.g. ygr5-vcbg (find it in the dataset's API docs)." };
    }
    return { ok: true, kind: CONNECTOR_KIND_SOCRATA, config: { domain, datasetId, dataset, dateField, tokenEnv } };
  }

  return { ok: false, reason: `Unknown connector kind "${kind}".` };
}

export function createFileDropConnector(agencyId: string): DataSourceConnector {
  return new FileDropConnector(connectedDropDir(agencyId));
}

export function createMemoryConnector(slices: MemorySliceInput[]): DataSourceConnector {
  return new MemoryConnector(slices);
}

/** Build the connector a registered source describes. */
export function createConnector(
  kind: string,
  agencyId: string,
  config: ConnectorConfig,
  doFetch: FetchLike = fetch,
): DataSourceConnector {
  switch (kind) {
    case CONNECTOR_KIND_FILE_DROP:
      return createFileDropConnector(agencyId);
    case CONNECTOR_KIND_HTTP:
      return new HttpConnector(
        {
          url: config.url ?? "",
          dataset: config.dataset ?? "dataset",
          dateField: config.dateField ?? "date",
          tokenEnv: config.tokenEnv,
        },
        doFetch,
      );
    case CONNECTOR_KIND_SOCRATA:
      return new SocrataConnector(
        {
          domain: config.domain ?? "",
          datasetId: config.datasetId ?? "",
          dataset: config.dataset ?? "dataset",
          dateField: config.dateField ?? "date",
          tokenEnv: config.tokenEnv,
        },
        doFetch,
      );
    default:
      throw new Error(`Unknown connector kind "${kind}"`);
  }
}
