#!/usr/bin/env bash
# The secret scan that CI runs (kept in the repo so it can be reproduced locally:
#   bash scripts/secret_scan.sh
# Exits non-zero if a tracked file looks like it contains a credential.
set -e

echo "1. no tracked .env files (only .env.example):"
if git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.example$' | grep -q .; then
  echo "::error::a real .env file is tracked"
  git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.example$'
  exit 1
fi
echo "   ok"

echo "2. no provider-shaped credentials:"
if git grep -nIE 'sk_(test|live)_[A-Za-z0-9]{8,}|pk_(test|live)_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|mongodb\+srv://[^ ]+@|-----BEGIN [A-Z ]*PRIVATE KEY-----' -- . ':!package-lock.json'; then
  echo "::error::a provider-shaped credential is committed"
  exit 1
fi
echo "   ok"

echo "3. no hardcoded literal values behind secret-ish names:"
if git grep -nIE "(api[_-]?key|secret|password|token)[\"']?[[:space:]]*[:=][[:space:]]*[\"'][A-Za-z0-9+/=_-]{20,}[\"']" -- . ':!package-lock.json' ':!*.example' ':!*.md'; then
  echo "::error::a hardcoded literal secret is committed"
  exit 1
fi
echo "   ok"

echo "secret scan clean"
