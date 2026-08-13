/**
 * Copilot → panel prefill (the last inch of "AI proposes, staff disposes"):
 * a proposal card hands its text to the panel that can ACT on it, so the
 * coordinator reviews a filled form instead of retyping the proposal. Plain
 * window CustomEvents — the panels live on the same page as the copilot, and
 * nothing here changes any server state: the named-human action stays inside
 * the receiving panel, exactly where it was.
 */

export const PREFILL_DISPATCH_EVENT = "brandeis:prefill-dispatch";
export const PREFILL_EXTENSION_EVENT = "brandeis:prefill-extension";

export interface PrefillDispatchDetail {
  /** Proposed task scope, verbatim from the copilot (staff edit in place). */
  scope: string;
}

export interface PrefillExtensionDetail {
  /** Proposed basis/note for taking the statutory extension. */
  note: string;
}

export function firePrefillDispatch(detail: PrefillDispatchDetail): void {
  window.dispatchEvent(new CustomEvent(PREFILL_DISPATCH_EVENT, { detail }));
}

export function firePrefillExtension(detail: PrefillExtensionDetail): void {
  window.dispatchEvent(new CustomEvent(PREFILL_EXTENSION_EVENT, { detail }));
}
