/**
 * Relative-date parsing for the answer-first search box (docs/answer-first.md).
 *
 * "Street cleanings for the last 3 months" is two questions wearing one coat:
 * a SUBJECT ("street cleanings") and a WINDOW ("last 3 months"). Similarity
 * search answers the first and is blind to the second — embeddings encode
 * meaning, not recency, so a vector search will happily rank a 2019 street
 * sweeping log above last month's. The window has to become an actual filter.
 *
 * So this module does two things: lift the window out of the query, and hand
 * back the RESIDUAL subject so the date words ("last", "months") stop
 * polluting the lexical and vector match.
 *
 * Pure by construction, `now` is an argument, no globals and no clock — same
 * rule as computeDueDate(). That is what makes the tests deterministic.
 */

export interface DateRange {
  /** Inclusive ISO date (YYYY-MM-DD). */
  from: string;
  /** Inclusive ISO date (YYYY-MM-DD). */
  to: string;
}

export interface ParsedDateQuery {
  /** The window, or null when the query names no time at all. */
  range: DateRange | null;
  /** The query with the matched time phrase removed. Never empty if the
   *  original had any non-date words; falls back to the original otherwise. */
  residual: string;
  /** The phrase that produced the range, for "showing X from Y" UI copy. */
  matchedPhrase: string | null;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8,
  oct: 9, nov: 10, dec: 11,
};

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, eighteen: 18,
};

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** UTC-normalised midnight, so day arithmetic never trips over a DST edge. */
function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

function startOfDay(now: Date): Date {
  return utc(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Subtract n units from a UTC date without leaving UTC. */
function minus(d: Date, n: number, unit: "day" | "week" | "month" | "year"): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (unit === "day") return utc(y, m, day - n);
  if (unit === "week") return utc(y, m, day - n * 7);
  if (unit === "year") return utc(y - n, m, day);
  // Month arithmetic clamps: "1 month before 31 March" is 28/29 Feb, not 3 March.
  const target = utc(y, m - n + 1, 0); // last day of the target month
  return utc(y, m - n, Math.min(day, target.getUTCDate()));
}

/**
 * Pull a time window out of a natural-language query.
 *
 * Handles the phrasings residents actually type: "last 3 months", "past six
 * weeks", "since January", "in 2024", "last year", "this year", "last 30
 * days", "year to date". Anything it does not recognise leaves `range` null
 * and the query untouched — silence is the correct answer for "the Acme
 * paving contract", which names no window at all.
 */
export function parseDateQuery(query: string, now: Date): ParsedDateQuery {
  const today = startOfDay(now);
  const text = query.toLowerCase();

  const build = (from: Date, to: Date, phrase: string): ParsedDateQuery => ({
    range: { from: iso(from), to: iso(to) },
    residual: stripPhrase(query, phrase),
    matchedPhrase: phrase,
  });

  // "last 3 months" / "past six weeks" / "previous 30 days" / "last 2 years"
  const rel = text.match(
    /\b(?:the\s+)?(?:last|past|previous|recent)\s+(\d{1,3}|[a-z]+)\s*(day|days|week|weeks|month|months|year|years)\b/,
  );
  if (rel) {
    const raw = rel[1]!;
    const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : WORD_NUMBERS[raw];
    if (n && n > 0) {
      const unit = rel[2]!.replace(/s$/, "") as "day" | "week" | "month" | "year";
      return build(minus(today, n, unit), today, rel[0]);
    }
  }

  // bare "last month" / "past week" / "last year"
  const bare = text.match(/\b(?:the\s+)?(?:last|past|previous)\s+(day|week|month|year)\b/);
  if (bare) {
    const unit = bare[1] as "day" | "week" | "month" | "year";
    return build(minus(today, 1, unit), today, bare[0]);
  }

  // "since January" / "since 2023" / "since March 2024"
  const since = text.match(/\bsince\s+([a-z]+)\.?\s*(\d{4})?\b/);
  if (since) {
    const word = since[1]!;
    const year = since[2] ? parseInt(since[2], 10) : null;
    if (word in MONTHS) {
      const m = MONTHS[word]!;
      // No year given: the most recent occurrence of that month, not the future.
      const y =
        year ?? (m <= today.getUTCMonth() ? today.getUTCFullYear() : today.getUTCFullYear() - 1);
      return build(utc(y, m, 1), today, since[0]);
    }
    if (/^\d{4}$/.test(word)) return build(utc(parseInt(word, 10), 0, 1), today, since[0]);
  }

  // "in 2024" / "during 2024" / bare "2024"
  const year = text.match(/\b(?:in|during|from|for)\s+(19|20)(\d{2})\b/) ?? text.match(/\b(19|20)(\d{2})\b/);
  if (year) {
    const y = parseInt(`${year[1]}${year[2]}`, 10);
    return build(utc(y, 0, 1), utc(y, 11, 31), year[0]);
  }

  // "this year" / "year to date" / "ytd"
  if (/\b(this year|year to date|ytd)\b/.test(text)) {
    const phrase = text.match(/\b(this year|year to date|ytd)\b/)![0];
    return build(utc(today.getUTCFullYear(), 0, 1), today, phrase);
  }

  // "this month"
  if (/\bthis month\b/.test(text)) {
    return build(utc(today.getUTCFullYear(), today.getUTCMonth(), 1), today, "this month");
  }

  return { range: null, residual: query, matchedPhrase: null };
}

/** Remove the time phrase and any connective left dangling by its removal. */
function stripPhrase(query: string, phrase: string): string {
  const out = query
    .toLowerCase()
    .replace(phrase, " ")
    .replace(/\b(for|from|in|during|over|of)\s*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
  // "last 3 months" alone is a window with no subject — keep the original so
  // the caller still has something to match on rather than an empty string.
  return out.length >= 3 ? out : query;
}

/**
 * Is an ISO-ish date string inside the window? Undated records are KEPT — a
 * missing recordDate means "we don't know", and silently dropping every
 * undated record would quietly shrink the public's view of the corpus. Better
 * to show it and let the ranking decide.
 */
export function withinRange(recordDate: string | undefined | null, range: DateRange): boolean {
  if (!recordDate) return true;
  const d = recordDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return true;
  return d >= range.from && d <= range.to;
}

/** Human-readable window, for "Showing records from …" copy. */
export function describeRange(range: DateRange): string {
  const fmt = (s: string) =>
    new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(range.from)} – ${fmt(range.to)}`;
}
