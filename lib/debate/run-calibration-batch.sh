#!/bin/bash
# Run calibration batch debates sequentially
# Usage: bash lib/debate/run-calibration-batch.sh

set -e
cd "$(dirname "$0")/../.."

DATA_ROOT="$(cd ../ai-triad-data && pwd)"
OUTPUT_DIR="$DATA_ROOT/debates"
BATCH_FILE="lib/debate/calibration-batch.json"
TOTAL=$(python3 -c "import json; print(len(json.load(open('$BATCH_FILE'))))")

echo "[batch] Starting $TOTAL calibration debates"
echo "[batch] Output dir: $OUTPUT_DIR"

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

  echo ""
  echo "[batch] ═══════════════════════════════════════════"
  echo "[batch] Debate $N/$TOTAL: $NAME"
  echo "[batch] ═══════════════════════════════════════════"

  TMPCONF=$(mktemp /tmp/debate-cfg-XXXXXX.json)
  echo "$CONFIG" > "$TMPCONF"

  if npx tsx lib/debate/cli.ts --config "$TMPCONF" 2>&1; then
    echo "[batch] ✓ Debate $N/$TOTAL completed: $NAME"
  else
    echo "[batch] ✗ Debate $N/$TOTAL FAILED: $NAME (exit $?)"
  fi

  rm -f "$TMPCONF"
done

echo ""
echo "[batch] All $TOTAL debates complete"
echo "[batch] Output files in: $OUTPUT_DIR"
ls -lt "$OUTPUT_DIR"/cal-batch-* 2>/dev/null | head -30
