/** Tests for the request lifecycle state machine (spec §5). */
import { describe, expect, it } from "vitest";
import {
  ALL_STATUSES,
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isOpen,
  isTerminal,
  nextStates,
} from "./requestLifecycle";

describe("transitions", () => {
  it("allows legal forward moves", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
    expect(canTransition("in_review", "in_progress")).toBe(true);
    expect(canTransition("records_review", "fulfilled")).toBe(true);
    expect(canTransition("fulfilled", "closed")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(canTransition("draft", "fulfilled")).toBe(false);
    expect(canTransition("closed", "in_progress")).toBe(false);
    expect(canTransition("submitted", "closed")).toBe(false);
  });

  it("assertTransition throws with the allowed set on illegal moves", () => {
    expect(() => assertTransition("draft", "closed")).toThrow(InvalidTransitionError);
    try {
      assertTransition("draft", "closed");
    } catch (e) {
      expect((e as Error).message).toMatch(/submitted/);
    }
    expect(assertTransition("draft", "submitted")).toBe("submitted");
  });
});

describe("terminal & open states", () => {
  it("closed is the only terminal sink", () => {
    expect(isTerminal("closed")).toBe(true);
    expect(nextStates("closed")).toEqual([]);
    for (const s of ALL_STATUSES) {
      if (s !== "closed") expect(isTerminal(s)).toBe(false);
    }
  });

  it("draft and terminal states are not 'open'", () => {
    expect(isOpen("draft")).toBe(false);
    expect(isOpen("closed")).toBe(false);
    expect(isOpen("in_progress")).toBe(true);
    expect(isOpen("records_review")).toBe(true);
  });
});

describe("graph integrity", () => {
  it("every target status is itself a known status (no dangling edges)", () => {
    const known = new Set(ALL_STATUSES);
    for (const s of ALL_STATUSES) {
      for (const t of nextStates(s)) {
        expect(known.has(t)).toBe(true);
        expect(t).not.toBe(s); // no self-loops
      }
    }
  });

  it("every non-terminal, non-draft status can reach closure eventually", () => {
    // BFS from each status must reach "closed".
    for (const start of ALL_STATUSES) {
      const seen = new Set([start]);
      const queue = [start];
      let reachesClosed = start === "closed";
      while (queue.length) {
        const cur = queue.shift()!;
        for (const nxt of nextStates(cur)) {
          if (nxt === "closed") reachesClosed = true;
          if (!seen.has(nxt)) {
            seen.add(nxt);
            queue.push(nxt);
          }
        }
      }
      expect(reachesClosed).toBe(true);
    }
  });
});
