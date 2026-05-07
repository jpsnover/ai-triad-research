#!/bin/bash
# Run calibration batch debates in parallel (2-3 concurrent)
# Usage: bash lib/debate/run-calibration-parallel.sh [START_INDEX] [MAX_PARALLEL]
# START_INDEX: 0-based index to start from (default: 2, skips debates 1-2 already done)
# MAX_PARALLEL: max concurrent debates (default: 3)

cd "$(dirname "$0")/../.."

DATA_ROOT="$(cd ../ai-triad-data && pwd)"
OUTPUT_DIR="$DATA_ROOT/debates"
BATCH_FILE="lib/debate/calibration-batch.json"
TOTAL=$(python3 -c "import json; print(len(json.load(open('$BATCH_FILE'))))")
START=${1:-2}
MAX_PARALLEL=${2:-3}

echo "[parallel] Starting debates $((START+1))-$TOTAL ($(( TOTAL - START )) debates, $MAX_PARALLEL concurrent)"
echo "[parallel] Output dir: $OUTPUT_DIR"
echo "[parallel] Model: $(python3 -c "import json; print(json.load(open('$BATCH_FILE'))[$START]['model'])")"
echo "[parallel] Pacing: $(python3 -c "import json; print(json.load(open('$BATCH_FILE'))[$START]['pacing'])")"

# Pre-generate config files deterministically (avoid mktemp race in subshells)
for i in $(seq $START $((TOTAL - 1))); do
  CONFIG=$(python3 -c "
import json
batch = json.load(open('$BATCH_FILE'))
cfg = batch[$i]
cfg['outputDir'] = '$OUTPUT_DIR'
print(json.dumps(cfg))
")
  echo "$CONFIG" > "/tmp/debate-cfg-${i}.json"
done

run_debate() {
  local idx=$1
  local n=$((idx + 1))
  local tmpconf="/tmp/debate-cfg-${idx}.json"
  local name
  name=$(python3 -c "import json; print(json.load(open('$tmpconf'))['name'])")
  local logfile="/tmp/debate-log-${name}.log"

  echo "[parallel] Starting debate $n/$TOTAL: $name (log: $logfile)"
  if npx tsx lib/debate/cli.ts --config "$tmpconf" > "$logfile" 2>&1; then
    echo "[parallel] DONE debate $n/$TOTAL: $name"
    rm -f "$tmpconf"
    return 0
  else
    local rc=$?
    echo "[parallel] FAILED debate $n/$TOTAL: $name (exit $rc, see $logfile)"
    rm -f "$tmpconf"
    return $rc
  fi
}

# Launch debates in waves of MAX_PARALLEL
PIDS=()
INDICES=()
succeeded=0
failed=0

for i in $(seq $START $((TOTAL - 1))); do
  run_debate $i &
  PIDS+=($!)
  INDICES+=($i)

  # When we hit max parallel, wait for any to finish before launching more
  if [ ${#PIDS[@]} -ge $MAX_PARALLEL ]; then
    # Wait for all current PIDs (bash < 4.3 doesn't support wait -n reliably)
    for pid in "${PIDS[@]}"; do
      if wait "$pid" 2>/dev/null; then
        succeeded=$((succeeded + 1))
      else
        failed=$((failed + 1))
      fi
    done
    PIDS=()
    INDICES=()
  fi
done

# Wait for remaining
for pid in "${PIDS[@]}"; do
  if wait "$pid" 2>/dev/null; then
    succeeded=$((succeeded + 1))
  else
    failed=$((failed + 1))
  fi
done

echo ""
echo "[parallel] All done: $succeeded succeeded, $failed failed out of $((TOTAL - START)) debates"
echo "[parallel] Output files:"
ls -lt "$OUTPUT_DIR"/cal-batch-* 2>/dev/null | head -40
