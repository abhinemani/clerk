/**
 * Unit tests for computeDueDate() and the business-day calendar (spec §7).
 *
 * These are the compliance-critical tests called out in the spec. All fixed
 * dates are in UTC. Reference calendar (Jan 2026): Jan 1 = Thursday, so
 * Jan 3/4 = Sat/Sun, Jan 5 = Monday, Jan 10/11 = Sat/Sun, Jan 17/18 = Sat/Sun.
 */
import { describe, expect, it } from "vitest";
import { computeDueDate, isOverdue } from "./computeDueDate";
import {
  addBusinessDays,
  businessDaysBetween,
  holidaySet,
  isBusinessDay,
  isoDate,
  nextBusinessDay,
  rollForwardToBusinessDay,
} from "./businessDays";
import { getStateProfile, stateProfiles, supportedStates } from "./profiles";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const MON_JAN_5 = utc(2026, 1, 5);

describe("businessDays primitives", () => {
  it("identifies weekends and holidays as non-business days", () => {
    const hs = holidaySet(["2026-01-08"]);
    expect(isBusinessDay(utc(2026, 1, 3), hs)).toBe(false); // Saturday
    expect(isBusinessDay(utc(2026, 1, 4), hs)).toBe(false); // Sunday
    expect(isBusinessDay(utc(2026, 1, 8), hs)).toBe(false); // holiday
    expect(isBusinessDay(utc(2026, 1, 5), hs)).toBe(true); // Monday
  });

  it("addBusinessDays does not count the start day and skips weekends", () => {
    const hs = holidaySet();
    // 5 business days after Monday Jan 5 → Monday Jan 12.
    expect(isoDate(addBusinessDays(MON_JAN_5, 5, hs))).toBe("2026-01-12");
    // 0 business days → the start day itself.
    expect(isoDate(addBusinessDays(MON_JAN_5, 0, hs))).toBe("2026-01-05");
  });

  it("addBusinessDays skips holidays", () => {
    const hs = holidaySet(["2026-01-08"]); // a Thursday holiday
    // Jan 6,7,(8 skip),9,12,13 → 5th business day is Jan 13.
    expect(isoDate(addBusinessDays(MON_JAN_5, 5, hs))).toBe("2026-01-13");
  });

  it("addBusinessDays rejects negative / non-integer counts", () => {
    expect(() => addBusinessDays(MON_JAN_5, -1, holidaySet())).toThrow(RangeError);
    expect(() => addBusinessDays(MON_JAN_5, 1.5, holidaySet())).toThrow(RangeError);
  });

  it("rollForwardToBusinessDay and nextBusinessDay behave at boundaries", () => {
    const hs = holidaySet();
    // Saturday Jan 3 rolls forward to Monday Jan 5 (on-or-after).
    expect(isoDate(rollForwardToBusinessDay(utc(2026, 1, 3), hs))).toBe("2026-01-05");
    // A business day rolls to itself.
    expect(isoDate(rollForwardToBusinessDay(MON_JAN_5, hs))).toBe("2026-01-05");
    // nextBusinessDay is strictly after: Friday Jan 9 → Monday Jan 12.
    expect(isoDate(nextBusinessDay(utc(2026, 1, 9), hs))).toBe("2026-01-12");
  });

  it("businessDaysBetween counts inclusive of both ends", () => {
    const hs = holidaySet();
    // Mon Jan 5 .. Fri Jan 9 inclusive = 5 business days.
    expect(businessDaysBetween(MON_JAN_5, utc(2026, 1, 9), hs)).toBe(5);
    // Reversed range → 0.
    expect(businessDaysBetween(utc(2026, 1, 9), MON_JAN_5, hs)).toBe(0);
  });
});

describe("computeDueDate — calendar-day clocks (California)", () => {
  const clock = stateProfiles.CA!.responseClock;

  it("adds calendar days from receipt", () => {
    const r = computeDueDate({ receivedAt: MON_JAN_5, clock });
    // Jan 5 + 10 calendar = Jan 15 (Thursday), a business day → no roll.
    expect(isoDate(r.statutoryDueAt)).toBe("2026-01-15");
    expect(r.dayType).toBe("calendar");
    expect(r.daysAllowed).toBe(10);
    expect(r.basis).toContain("10 calendar day(s)");
  });

  it("rolls a weekend deadline forward to the next business day", () => {
    // Received Wed Jan 7 → +10 = Jan 17 (Saturday) → rolls to Mon Jan 19.
    const r = computeDueDate({ receivedAt: utc(2026, 1, 7), clock });
    expect(isoDate(r.statutoryDueAt)).toBe("2026-01-19");
  });

  it("does not roll when rollCalendarDeadlineToBusinessDay is false", () => {
    const r = computeDueDate({
      receivedAt: utc(2026, 1, 7),
      clock,
      rollCalendarDeadlineToBusinessDay: false,
    });
    expect(isoDate(r.statutoryDueAt)).toBe("2026-01-17"); // stays on Saturday
  });

  it("rolls a deadline off an observed holiday", () => {
    // +10 = Jan 15 (Thu); mark it a holiday → rolls to Fri Jan 16.
    const r = computeDueDate({ receivedAt: MON_JAN_5, clock, holidays: ["2026-01-15"] });
    expect(isoDate(r.statutoryDueAt)).toBe("2026-01-16");
  });
});

describe("computeDueDate — business-day clocks", () => {
  it("Texas: 10 business days from Monday Jan 5 → Monday Jan 19", () => {
    const r = computeDueDate({ receivedAt: MON_JAN_5, clock: stateProfiles.TX!.responseClock });
    expect(isoDate(r.statutoryDueAt)).toBe("2026-01-19");
    expect(r.dayType).toBe("business");
  });

  it("Illinois: 5 business days from Monday Jan 5 → Monday Jan 12", () => {
    const r = computeDueDate({ receivedAt: MON_JAN_5, clock: stateProfiles.IL!.responseClock });
    expect(isoDate(r.statutoryDueAt)).toBe("2026-01-12");
  });

  it("business-day clock skips observed holidays", () => {
    // IL 5 business days, with Jan 8 (Thu) a holiday → Jan 6,7,(8),9,12,13 = Jan 13.
    const r = computeDueDate({
      receivedAt: MON_JAN_5,
      clock: stateProfiles.IL!.responseClock,
      holidays: ["2026-01-08"],
    });
    expect(isoDate(r.statutoryDueAt)).toBe("2026-01-13");
  });
});

describe("computeDueDate — clock start rules", () => {
  it("clockStartsOn next_business_day starts counting after a weekend receipt", () => {
    const clock = {
      initialDays: 5,
      dayType: "business" as const,
      clockStartsOn: "next_business_day" as const,
      extension: {
        allowed: false,
        maxDays: 0,
        dayType: "business" as const,
        permittedReasons: [],
        noticeRequired: false,
      },
    };
    // Received Saturday Jan 3 → clock starts Mon Jan 5 → +5 business = Mon Jan 12.
    const r = computeDueDate({ receivedAt: utc(2026, 1, 3), clock });
    expect(isoDate(r.clockStart)).toBe("2026-01-05");
    expect(isoDate(r.statutoryDueAt)).toBe("2026-01-12");
    expect(r.basis).toContain("next business day");
  });
});

describe("computeDueDate — extensions", () => {
  const clock = stateProfiles.CA!.responseClock;

  it("applies a permitted extension and reports the basis", () => {
    const r = computeDueDate({
      receivedAt: MON_JAN_5,
      clock,
      extension: { days: 14, reason: "voluminous separate records" },
    });
    // Base Jan 15 + 14 calendar = Jan 29 (Thursday).
    expect(isoDate(r.statutoryDueAt)).toBe("2026-01-15");
    expect(isoDate(r.dueAt)).toBe("2026-01-29");
    expect(r.extensionApplied?.days).toBe(14);
    expect(r.basis).toContain("Extended by 14 calendar day(s)");
  });

  it("throws when the extension exceeds the statutory maximum", () => {
    expect(() =>
      computeDueDate({ receivedAt: MON_JAN_5, clock, extension: { days: 20 } }),
    ).toThrow(/exceeds statutory maximum/);
  });

  it("throws when the reason is not permitted", () => {
    expect(() =>
      computeDueDate({
        receivedAt: MON_JAN_5,
        clock,
        extension: { days: 5, reason: "because I said so" },
      }),
    ).toThrow(/not a permitted extension reason/);
  });

  it("throws when the statute forbids extensions", () => {
    const noExt = {
      ...clock,
      extension: { ...clock.extension, allowed: false },
    };
    expect(() =>
      computeDueDate({ receivedAt: MON_JAN_5, clock: noExt, extension: { days: 1 } }),
    ).toThrow(/does not permit an extension/);
  });

  it("dueAt equals statutoryDueAt when no extension is applied", () => {
    const r = computeDueDate({ receivedAt: MON_JAN_5, clock });
    expect(r.dueAt.getTime()).toBe(r.statutoryDueAt.getTime());
    expect(r.extensionApplied).toBeUndefined();
  });
});

describe("computeDueDate — validation & purity", () => {
  const clock = stateProfiles.CA!.responseClock;

  it("throws on an invalid receivedAt", () => {
    expect(() => computeDueDate({ receivedAt: new Date("nope"), clock })).toThrow(RangeError);
  });

  it("is pure — repeated calls yield identical results", () => {
    const a = computeDueDate({ receivedAt: MON_JAN_5, clock });
    const b = computeDueDate({ receivedAt: MON_JAN_5, clock });
    expect(a).toEqual(b);
  });

  it("ignores the time-of-day component of receivedAt", () => {
    const morning = computeDueDate({ receivedAt: new Date("2026-01-05T08:00:00Z"), clock });
    const evening = computeDueDate({ receivedAt: new Date("2026-01-05T23:59:59Z"), clock });
    expect(isoDate(morning.statutoryDueAt)).toBe(isoDate(evening.statutoryDueAt));
  });
});

describe("isOverdue", () => {
  const due = utc(2026, 1, 15);
  it("is not overdue on or before the due calendar day", () => {
    expect(isOverdue(due, utc(2026, 1, 14))).toBe(false);
    expect(isOverdue(due, new Date("2026-01-15T23:59:59Z"))).toBe(false);
  });
  it("is overdue once the due day has passed", () => {
    expect(isOverdue(due, utc(2026, 1, 16))).toBe(true);
  });
});

describe("state profile library (§7)", () => {
  it("ships at least five states as data", () => {
    expect(supportedStates.length).toBeGreaterThanOrEqual(5);
  });

  it("looks up profiles case-insensitively", () => {
    expect(getStateProfile("ca")?.stateCode).toBe("CA");
    expect(getStateProfile("Zz")).toBeUndefined();
  });

  it("every profile is internally consistent", () => {
    for (const [code, p] of Object.entries(stateProfiles)) {
      expect(p.stateCode).toBe(code);
      expect(p.responseClock.initialDays).toBeGreaterThanOrEqual(0);
      expect(["calendar", "business"]).toContain(p.responseClock.dayType);
      expect(p.exemptions.length).toBeGreaterThan(0);
      // Every profile's clock must actually compute a valid future deadline.
      const r = computeDueDate({ receivedAt: MON_JAN_5, clock: p.responseClock });
      expect(r.statutoryDueAt.getTime()).toBeGreaterThanOrEqual(MON_JAN_5.getTime());
    }
  });
});
