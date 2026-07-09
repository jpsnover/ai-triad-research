#!/usr/bin/env bash
# Renderer tsc ratchet gate (t/1441) — fails if error count exceeds ceiling.
# Ceiling stored in quality-gates.json → tsc_error_ceilings["taxonomy-editor/tsconfig.json"].
# Same pattern as eslint --max-warnings and LOC ceilings: start high, ratchet down.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$REPO_ROOT/quality-gates.json"
CEILING=$(node -e "const p=require('path').resolve(process.argv[1]);console.log(require(p).tsc_error_ceilings['taxonomy-editor/tsconfig.json'])" "$CONFIG")

if [ -z "$CEILING" ] || [ "$CEILING" = "undefined" ]; then
  echo "ERROR: tsc_error_ceilings[taxonomy-editor/tsconfig.json] not found in quality-gates.json"
  exit 1
fi

cd "$REPO_ROOT/taxonomy-editor"
OUTPUT=$(npx tsc -p tsconfig.json --noEmit 2>&1 || true)
COUNT=$(echo "$OUTPUT" | grep -c 'error TS' || true)

if [ "$COUNT" -gt "$CEILING" ]; then
  echo "$OUTPUT"
  echo ""
  echo "FAIL: renderer tsc errors ($COUNT) exceeded ceiling ($CEILING)"
  echo "The ceiling only goes DOWN. Fix the new errors before committing."
  exit 1
fi

echo "renderer tsc: $COUNT / $CEILING errors (OK)"
