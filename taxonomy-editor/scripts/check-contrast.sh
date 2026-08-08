#!/usr/bin/env bash
# Static token-contrast ratchet gate (t/2264).
# Catches text reversed out over a tokenized fill that is light in some themes —
# the defect class jsdom/vitest is structurally blind to (applies no stylesheet).
#
# Ceiling stored in quality-gates.json → contrast_ceilings["taxonomy-editor/scripts/check-contrast.mjs"].
# Same pattern as check-renderer-tsc.sh: start at the pre-existing baseline,
# ratchet down. Every new violation is a hard failure immediately.
#
# Unlike check-camp-contrast.mjs (which hardcodes a token snapshot and only checks
# the direction that passes), this reads styles.css as the live source of truth.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$REPO_ROOT/quality-gates.json"
CEILING=$(node -e "const p=require('path').resolve(process.argv[1]);console.log(require(p).contrast_ceilings['taxonomy-editor/scripts/check-contrast.mjs'])" "$CONFIG")

if [ -z "$CEILING" ] || [ "$CEILING" = "undefined" ]; then
  echo "ERROR: contrast_ceilings[taxonomy-editor/scripts/check-contrast.mjs] not found in quality-gates.json"
  exit 1
fi

cd "$REPO_ROOT/taxonomy-editor"
JSON=$(node scripts/check-contrast.mjs --json 2>&1 || true)
COUNT=$(echo "$JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).findings.length))")

if [ "$COUNT" -gt "$CEILING" ]; then
  node scripts/check-contrast.mjs 2>&1 || true
  echo ""
  echo "FAIL: contrast findings ($COUNT) exceeded ceiling ($CEILING)"
  echo "The ceiling only goes DOWN. Fix the new violations before merging."
  exit 1
fi

echo "contrast check: $COUNT / $CEILING findings (OK)"
