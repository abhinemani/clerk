import { branding } from "@/config/branding";
import { supportedStates } from "@/statute/profiles";

/**
 * Placeholder root. Phase 1 (§12) wires the three surfaces:
 *   /portal/[agency-slug]  — public portal
 *   /app                   — staff workspace
 *   /task/[token]          — responder task pages
 * This landing page just confirms the foundation boots.
 */
export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <h1>{branding.productName}</h1>
      <p>{branding.tagline}</p>
      <p style={{ color: "#555" }}>
        Phase 1 foundation. Statute profiles loaded for: {supportedStates.join(", ")}.
      </p>
    </main>
  );
}
