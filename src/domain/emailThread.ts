/**
 * Email threading for the review set (pure — the UI exercise the mailbox
 * import entry promised). Imported messages carry Message-ID / In-Reply-To /
 * References metadata; this groups them into conversations the way a mail
 * client would:
 *
 *  1. JWZ-style id linking: a message joins the thread of anything it
 *     references (References chain, or In-Reply-To when References is
 *     absent). Union-find over ids, so partial chains still converge.
 *  2. Subject fallback: messages with no usable ids join a thread whose
 *     normalized subject matches ("Re: Re: Fwd: X" → "x"). Real exports mix
 *     both — old gateways strip headers.
 *
 * Messages sort oldest-first within a thread (undated last, then by mailbox
 * position); threads sort by their newest message so the active conversation
 * tops the list. Attachments are the caller's concern (they hang off their
 * message document, not off the thread).
 */

export interface ThreadableMessage {
  /** The review-set document id — what the caller keys the UI on. */
  documentId: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string | null;
  /** ISO date (or null) — recordDate from the Date header. */
  dateIso: string | null;
}

export interface EmailThread {
  /** Subject of the earliest message, prefixes stripped — the thread title. */
  subject: string;
  /** Oldest first. */
  messages: ThreadableMessage[];
}

/** "Re: RE: Fwd: [ext] Budget" → "budget" — the join key of last resort. */
export function normalizeSubject(subject: string | null): string {
  if (!subject) return "";
  let s = subject.trim();
  // Peel reply/forward prefixes and bracketed tags, repeatedly — clients stack them.
  for (;;) {
    const next = s.replace(/^((re|fwd?|aw|sv)\s*(\[\d+\])?\s*:|\[[^\]]{1,40}\])\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").toLowerCase().trim();
}

/** Group review-set email messages into conversation threads. */
export function threadMessages(input: ThreadableMessage[]): EmailThread[] {
  // Union-find keyed by message-id string; subject keys get their own nodes
  // prefixed to avoid colliding with real ids.
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    // Path compression.
    let cur = k;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    if (!parent.has(root)) parent.set(root, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Every message gets a node of its own (doc: prefix — always unique), then
  // unions into its id and everything it references.
  for (const m of input) {
    const self = `doc:${m.documentId}`;
    find(self);
    const ids = [m.messageId, m.inReplyTo, ...m.references].filter((x): x is string => !!x);
    for (const id of ids) union(self, `id:${id}`);
    if (ids.length === 0) {
      const subj = normalizeSubject(m.subject);
      if (subj) union(self, `subj:${subj}`);
    }
  }

  const byRoot = new Map<string, ThreadableMessage[]>();
  for (const m of input) {
    const root = find(`doc:${m.documentId}`);
    const list = byRoot.get(root) ?? [];
    list.push(m);
    byRoot.set(root, list);
  }

  const threads: EmailThread[] = [];
  for (const messages of byRoot.values()) {
    // Oldest first; undated messages keep their relative (mailbox) order at
    // the end — position is the only signal they have.
    const sorted = [...messages].sort((a, b) => {
      if (a.dateIso && b.dateIso) return a.dateIso.localeCompare(b.dateIso);
      if (a.dateIso) return -1;
      if (b.dateIso) return 1;
      return 0;
    });
    threads.push({
      subject: sorted[0]!.subject?.trim() || "(no subject)",
      messages: sorted,
    });
  }

  // Newest activity first.
  threads.sort((a, b) => {
    const newest = (t: EmailThread) =>
      t.messages.reduce<string>((acc, m) => (m.dateIso && m.dateIso > acc ? m.dateIso : acc), "");
    return newest(b).localeCompare(newest(a));
  });
  return threads;
}
