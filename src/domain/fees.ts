/**
 * Fee-estimate computation (spec §5 FeeEstimate, §6.6 fee estimates, §7 fee rules).
 *
 * Turns billable inputs (staff time, copies, media) into itemized line items and
 * a total, but ONLY for the items the agency's statute config marks chargeable —
 * e.g. California charges duplication cost only, not staff time. Pure and
 * testable; feeds both the FeeEstimate record and the §6.6 fee-estimate letter.
 */
import type { FeeLineItem, StatuteConfig } from "@/db/schema";

export interface FeeInputs {
  /** Billable staff hours (only charged if the statute allows staff time). */
  staffHours?: number;
  /** Pages copied (only charged if the statute allows copies). */
  copies?: number;
  /** Free copy-page allowance before charges apply (e.g. IL's first 50). */
  freeCopyPages?: number;
  /** Pass-through media items (USB drives, DVDs, etc.). */
  media?: Array<{ label: string; amount: number }>;
  /** If set, the estimate is waived to $0 with the reason recorded. */
  waiverReason?: string;
}

export interface FeeEstimate {
  lineItems: FeeLineItem[];
  total: number;
  waived: boolean;
  waiverReason?: string;
  /** Chargeable inputs the statute doesn't allow — surfaced so staff can see why. */
  excluded: string[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeFeeEstimate(
  feeRules: StatuteConfig["feeRules"],
  inputs: FeeInputs,
): FeeEstimate {
  const chargeable = new Set(feeRules.chargeableItems);
  const lineItems: FeeLineItem[] = [];
  const excluded: string[] = [];

  // Staff time.
  if (inputs.staffHours && inputs.staffHours > 0) {
    if (chargeable.has("staff_time") && feeRules.staffTimeRatePerHour) {
      const amount = round2(inputs.staffHours * feeRules.staffTimeRatePerHour);
      lineItems.push({
        label: "Staff time",
        kind: "staff_time",
        qty: inputs.staffHours,
        rate: feeRules.staffTimeRatePerHour,
        amount,
      });
    } else {
      excluded.push("staff_time");
    }
  }

  // Copies (net of any statutory free allowance).
  if (inputs.copies && inputs.copies > 0) {
    if (chargeable.has("copies") && feeRules.copyRatePerPage) {
      const billablePages = Math.max(0, inputs.copies - (inputs.freeCopyPages ?? 0));
      if (billablePages > 0) {
        lineItems.push({
          label: `Copies (${billablePages} of ${inputs.copies} pages billable)`,
          kind: "copies",
          qty: billablePages,
          rate: feeRules.copyRatePerPage,
          amount: round2(billablePages * feeRules.copyRatePerPage),
        });
      }
    } else {
      excluded.push("copies");
    }
  }

  // Media (pass-through, if the statute allows media charges).
  for (const item of inputs.media ?? []) {
    if (chargeable.has("media")) {
      lineItems.push({
        label: item.label,
        kind: "media",
        qty: 1,
        rate: round2(item.amount),
        amount: round2(item.amount),
      });
    } else {
      excluded.push("media");
    }
  }

  const gross = round2(lineItems.reduce((sum, li) => sum + li.amount, 0));
  const waived = Boolean(inputs.waiverReason);

  return {
    lineItems,
    total: waived ? 0 : gross,
    waived,
    waiverReason: inputs.waiverReason,
    excluded: [...new Set(excluded)],
  };
}
