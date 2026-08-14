#!/bin/bash
# SessionStart hook — make fresh Claude Code cloud containers test-ready.
#
# Why: a fresh container clones the repo without node_modules, so the first
# `npm test` / `npm run typecheck` fails ("vitest: not found") until someone
# installs dependencies. Owner works from the mobile app, where sessions
# should be able to run the suite immediately (CLAUDE.md: suite green before
# every commit).
#
# Web-only: local checkouts manage their own node_modules. Synchronous on
# purpose — the session must not start until the suite can actually run.
# Idempotent: npm install is a fast no-op when node_modules is current, and
# the container cache keeps it warm across resumed sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
npm install --no-audit --no-fund
