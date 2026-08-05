"use client";

/**
 * Portal branding editor. The accent-color guard is server-side (contrast vs
 * white ink); this panel just surfaces the result honestly.
 */
import { useRef, useState, useTransition } from "react";
import { saveBrandingAction, uploadSealAction } from "../[agency]/app/(secure)/admin/actions";

export interface BrandingVM {
  officeName: string;
  contactEmail: string;
  addressLines: string;
  hours: string;
  accentColor: string;
  hasCustomSeal: boolean;
}

export function BrandingPanel({ agencySlug, initial }: { agencySlug: string; initial: BrandingVM }) {
  const [officeName, setOfficeName] = useState(initial.officeName);
  const [contactEmail, setContactEmail] = useState(initial.contactEmail);
  const [addressLines, setAddressLines] = useState(initial.addressLines);
  const [hours, setHours] = useState(initial.hours);
  const [accentColor, setAccentColor] = useState(initial.accentColor);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function save() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await saveBrandingAction({
        agencySlug,
        officeName,
        contactEmail,
        addressLines,
        hours,
        accentColor,
      });
      if (!r.ok) setError(r.error);
      else setNotice("Branding saved — the portal updates immediately.");
    });
  }

  function uploadSeal() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    setNotice(null);
    const fd = new FormData();
    fd.set("agencySlug", agencySlug);
    fd.set("seal", file);
    startTransition(async () => {
      const r = await uploadSealAction(fd);
      if (!r.ok) setError(r.error);
      else setNotice("Seal uploaded — refresh to see it in the header.");
    });
  }

  return (
    <div className="card card-pad stack" style={{ gap: 14 }}>
      <div className="roster-grid">
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="br-office">
            Office name
          </label>
          <input
            id="br-office"
            className="field"
            placeholder="Office of the City Clerk"
            value={officeName}
            onChange={(e) => setOfficeName(e.target.value)}
          />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="br-email">
            Public records email
          </label>
          <input
            id="br-email"
            type="email"
            className="field"
            placeholder="records@yourcity.gov"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </div>
      </div>

      <div className="roster-grid">
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="br-address">
            Office address{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              (one line per row)
            </span>
          </label>
          <textarea
            id="br-address"
            className="field"
            rows={3}
            placeholder={"City Hall, 100 Civic Center Plaza\nYour City, ST 00000"}
            value={addressLines}
            onChange={(e) => setAddressLines(e.target.value)}
          />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="br-hours">
            Office hours
          </label>
          <input
            id="br-hours"
            className="field"
            placeholder="Mon–Fri, 8:00 a.m.–5:00 p.m."
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          <label className="lbl" htmlFor="br-accent" style={{ marginTop: 8 }}>
            Accent color{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              (empty = civic navy)
            </span>
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="color"
              aria-label="Pick accent color"
              value={/^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : "#1e3a5f"}
              onChange={(e) => setAccentColor(e.target.value)}
              style={{ width: 42, height: 34, padding: 2, border: "1px solid var(--border)", borderRadius: 6, background: "none", cursor: "pointer" }}
            />
            <input
              id="br-accent"
              className="field mono"
              style={{ maxWidth: 130 }}
              placeholder="#1e3a5f"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
            />
          </div>
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            Must be dark enough for white text (WCAG AA) — the save will tell you if not.
          </span>
        </div>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="br-seal">
          Agency seal{" "}
          <span className="muted" style={{ fontWeight: 400 }}>
            (PNG or JPEG, under 1 MB{initial.hasCustomSeal ? " — replaces the current one" : ""})
          </span>
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input id="br-seal" ref={fileRef} type="file" accept="image/png,image/jpeg" className="field" style={{ maxWidth: 320 }} />
          <button className="btn btn-sm" disabled={pending} onClick={uploadSeal}>
            {pending ? "Uploading…" : "Upload seal"}
          </button>
        </div>
      </div>

      {error && (
        <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="pill band-on_track" style={{ justifySelf: "start" }}>
          {notice}
        </p>
      )}

      <div>
        <button className="btn btn-primary" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save branding"}
        </button>
      </div>
    </div>
  );
}
