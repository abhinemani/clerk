"use client";

/**
 * Recovery for the anonymous requester who lost their tracking number.
 * Always acknowledges the same way — the numbers go to the filing email
 * only, so knowing an address never reveals whether requests exist.
 */
import { useState, useTransition } from "react";
import { trackingReminderAction } from "../[agency]/actions";

export function TrackingReminderForm({ agencySlug }: { agencySlug: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <p role="status" className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
        If requests were filed with that address, an email with their tracking numbers is on its
        way. Check your inbox (and spam folder) in a minute or two.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!email.includes("@")) return;
        startTransition(async () => {
          await trackingReminderAction({ agencySlug, email });
          setSent(true);
        });
      }}
      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
    >
      <input
        className="field"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email you filed with"
        aria-label="Email you filed with"
        style={{ flex: 1, minWidth: 220 }}
      />
      <button className="btn btn-sm" type="submit" disabled={pending}>
        {pending ? "Sending…" : "Email me my tracking numbers"}
      </button>
    </form>
  );
}
