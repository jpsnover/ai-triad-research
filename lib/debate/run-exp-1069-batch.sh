#!/bin/bash
# Run t/1069 model substitution experiments sequentially
# 12 debates: 4 conditions × 3 topics
#   Control (all Opus), Summary→flash-lite, Evaluator→flash-lite, Scope→flash-lite
#
# Usage: bash lib/debate/run-exp-1069-batch.sh
# Requires: ANTHROPIC_API_KEY and GEMINI_API_KEY env vars

set -e
cd "$(dirname "$0")/../.."

DATA_ROOT="$(cd ../ai-triad-data && pwd)"
OUTPUT_DIR="$DATA_ROOT/debates"
BATCH_FILE="lib/debate/exp-1069-batch.json"
TOTAL=$(python3 -c "import json; print(len(json.load(open('$BATCH_FILE'))))")

echo "[exp-1069] Starting $TOTAL model substitution experiments"
echo "[exp-1069] Output dir: $OUTPUT_DIR"
echo "[exp-1069] Conditions: control, summary→flash-lite, evaluator→flash-lite, scope→flash-lite"
echo ""

PASSED=0
FAILED=0

for i in $(seq 0 $((TOTAL - 1))); do
  N=$((i + 1))
  CONFIG=$(python3 -c "
import json
batch = json.load(open('$BATCH_FILE'))
cfg = batch[$i]
cfg['outputDir'] = '$OUTPUT_DIR'
print(json.dumps(cfg))
")
  NAME=$(echo "$CONFIG" | python3 -c "import sys,json; print(json.load(sys.stdin)['name'])")

  echo "[exp-1069] ═══════════════════════════════════════════"
  echo "[exp-1069] Debate $N/$TOTAL: $NAME"
  echo "[exp-1069] ═══════════════════════════════════════════"

  TMPCONF=$(mktemp /tmp/debate-cfg-XXXXXX.json)
  echo "$CONFIG" > "$TMPCONF"

  if npx tsx lib/debate/cli.ts --config "$TMPCONF" 2>&1; then
    echo "[exp-1069] ✓ Debate $N/$TOTAL completed: $NAME"
    PASSED=$((PASSED + 1))
  else
    echo "[exp-1069] ✗ Debate $N/$TOTAL FAILED: $NAME (exit $?)"
    FAILED=$((FAILED + 1))
  fi

  rm -f "$TMPCONF"
done

echo ""
echo "[exp-1069] ═══════════════════════════════════════════"
echo "[exp-1069] Batch complete: $PASSED passed, $FAILED failed out of $TOTAL"
echo "[exp-1069] ═══════════════════════════════════════════"
echo "[exp-1069] Output files:"
ls -lt "$OUTPUT_DIR"/exp-1069-* 2>/dev/null | head -30
