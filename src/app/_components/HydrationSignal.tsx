"use client";

/**
 * Stamps `data-hydrated` on <html> once React is interactive. Exists for
 * browser automation (Playwright, the e2e smoke): a form submitted before
 * hydration performs a native GET instead of the client handler — the
 * repo's oldest automation gotcha. Waiting on this attribute replaces
 * arbitrary sleeps everywhere a script drives the UI.
 */
import { useEffect } from "react";

export function HydrationSignal() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);
  return null;
}
