"use client";

import { useState, useTransition } from "react";
import { requesterRegister, requesterSignIn, staffSignIn, type AuthResult } from "../[agency]/actions";

type Mode = "requester-signin" | "requester-register" | "staff-signin";

const SUBMIT_LABEL: Record<Mode, string> = {
  "requester-signin": "Sign in",
  "requester-register": "Create account",
  "staff-signin": "Sign in to workspace",
};

/**
 * One credentials form for all three flows. On success the server action
 * redirects; on failure it returns an error we render inline.
 */
export function AuthForm({ agencySlug, mode }: { agencySlug: string; mode: Mode }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    startTransition(async () => {
      let result: AuthResult;
      if (mode === "requester-register") {
        result = await requesterRegister({ agencySlug, email, name, password });
      } else if (mode === "requester-signin") {
        result = await requesterSignIn({ agencySlug, email, password });
      } else {
        result = await staffSignIn({ agencySlug, email, password });
      }
      // On success the action redirects and never resolves here.
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="card card-pad stack" style={{ gap: 16 }}>
      {mode === "requester-register" && (
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="auth-name">
            Your name
          </label>
          <input
            id="auth-name"
            className="field"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </div>
      )}

      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="auth-email">
          Email
        </label>
        <input
          id="auth-email"
          type="email"
          className="field"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="auth-password">
          Password
        </label>
        <input
          id="auth-password"
          type="password"
          className="field"
          required
          minLength={mode === "requester-register" ? 8 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "requester-register" ? "new-password" : "current-password"}
        />
        {mode === "requester-register" && (
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            At least 8 characters.
          </span>
        )}
      </div>

      {error && (
        <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
          {error}
        </p>
      )}

      <div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "One moment…" : SUBMIT_LABEL[mode]}
        </button>
      </div>
    </form>
  );
}
