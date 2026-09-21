#!/usr/bin/env bash
# The secret scan that CI runs (kept in the repo so it can be reproduced locally):
#   bash scripts/secret_scan.sh
#
# Every check runs even when an earlier one fails, and the exit status is the
# aggregate of all three — one run reports every problem instead of stopping at
# the first. `.github/workflows/ci.yml` executes *this file*, so the local and CI
# gates cannot drift apart.
#
# Exit codes: 0 clean · 1 a credential-shaped string is tracked · 2 the scan
# itself could not run (no git, not a repository).
set -uo pipefail

STATUS=0

# Provider-shaped credentials: these are credentials no matter where they live.
PROVIDER_PATTERN='sk_(test|live)_[A-Za-z0-9]{8,}|pk_(test|live)_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|mongodb\+srv://[^ ]+@|-----BEGIN [A-Z ]*PRIVATE KEY-----'
# A 20+ character string literal assigned to a secret-ish name. Case-insensitive
# (API_KEY, SIGNING_SECRET and signingSecret all count) and applied to every
# tracked file — source, config, tests, docs and .example files alike.
LITERAL_PATTERN="(api[_-]?key|secret|password|passwd|token)[\"']?[[:space:]]*[:=][[:space:]]*[\"'][A-Za-z0-9+/=_-]{20,}[\"']"

if ! TRACKED=$(git ls-files); then
  echo "::error::git ls-files failed — the secret scan cannot run here"
  exit 2
fi

echo "1. no tracked .env files (only .env.example):"
if ENV_FILES=$(printf '%s\n' "$TRACKED" | grep -E '(^|/)\.env($|\.)' | grep -v '\.example$'); then
  echo "::error::a real .env file is tracked"
  printf '%s\n' "$ENV_FILES"
  STATUS=1
else
  echo "   ok"
fi

echo "2. no provider-shaped credentials:"
if MATCHES=$(git grep -nIE "$PROVIDER_PATTERN" -- . ':!package-lock.json'); then
  echo "::error::a provider-shaped credential is committed"
  printf '%s\n' "$MATCHES"
  STATUS=1
else
  GREP_STATUS=$?
  if [ "$GREP_STATUS" -gt 1 ]; then
    echo "::error::git grep failed with status $GREP_STATUS — the secret scan cannot run here"
    exit 2
  fi
  echo "   ok"
fi

echo "3. no hardcoded literal values behind secret-ish names (case-insensitive, every tracked file):"
if MATCHES=$(git grep -nIiE "$LITERAL_PATTERN" -- . ':!package-lock.json'); then
  echo "::error::a hardcoded literal secret is committed"
  printf '%s\n' "$MATCHES"
  STATUS=1
else
  GREP_STATUS=$?
  if [ "$GREP_STATUS" -gt 1 ]; then
    echo "::error::git grep failed with status $GREP_STATUS — the secret scan cannot run here"
    exit 2
  fi
  echo "   ok"
fi

if [ "$STATUS" -ne 0 ]; then
  echo "secret scan FAILED"
  exit 1
fi
echo "secret scan clean"
exit 0
