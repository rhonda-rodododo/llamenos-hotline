#!/usr/bin/env bash
# Pre-commit hook: block commits containing PII (usernames, home paths, emails).
# Patterns are split across variables so this file doesn't trigger itself.
set -euo pipefail

USER="rikk"
USER="${USER}i"
PATTERNS="/home/${USER}|${USER}\\.schulte|${USER}-llamenos"

if git diff --cached | grep -qiE "$PATTERNS"; then
  echo "ERROR: Staged changes contain PII (username/email/path). Remove before committing."
  git diff --cached | grep -niE "$PATTERNS" | head -10
  exit 1
fi
