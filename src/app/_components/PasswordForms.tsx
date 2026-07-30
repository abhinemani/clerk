"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { forgotPasswordAction, resetPasswordAction } from "../[agency]/actions";

/** "Forgot password" — same response whether or not the account exists. */
export function ForgotPasswordForm({
  agencySlug,
  principal,
}: {
  agencySlug: string;
  principal: "requester" | "staff";
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <div className="card card-pad">
        <p style={{ margin: 0, fontWeight: 600 }}>Check your email.</p>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.92rem" }}>
          If an account exists for {email}, a reset link is on its way. It works once and expires in
          2 hours.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          await forgotPasswordAction({ agencySlug, principal, email });
          setSent(true);
        });
      }}
      className="card card-pad stack"
      style={{ gap: 16 }}
    >
      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="fp-email">
          Email
        </label>
        <input
          id="fp-email"
          type="email"
          className="field"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      <div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "One moment…" : "Send reset link"}
        </button>
      </div>
    </form>
  );
}

/** Set a new password from a reset or invite link. */
export function ResetPasswordForm({
  agencySlug,
  token,
  kind,
}: {
  agencySlug: string;
  token: string;
  kind: "reset_requester" | "reset_staff" | "staff_invite";
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const signInHref = kind === "reset_requester" ? `/${agencySlug}/login` : `/${agencySlug}/app/login`;

  if (done) {
    return (
      <div className="card card-pad">
        <p style={{ margin: 0, fontWeight: 600 }}>
          {kind === "staff_invite" ? "Account activated ✓" : "Password updated ✓"}
        </p>
        <Link href={signInHref} className="btn btn-primary" style={{ marginTop: 14 }}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await resetPasswordAction({ agencySlug, token, kind, password });
          if (r.ok) setDone(true);
          else setError(r.error);
        });
      }}
      className="card card-pad stack"
      style={{ gap: 16 }}
    >
      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="rp-pass">
          New password
        </label>
        <input
          id="rp-pass"
          type="password"
          className="field"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <span className="muted" style={{ fontSize: "0.82rem" }}>
          At least 8 characters.
        </span>
      </div>
      {error && (
        <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
          {error}
        </p>
      )}
      <div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "One moment…" : kind === "staff_invite" ? "Activate account" : "Set new password"}
        </button>
      </div>
    </form>
  );
}
