#!/usr/bin/env bash
# Generate crux-rich debates to validate t/324 (crux detection fix) and
# feed t/263 (crux aggregation evaluation).
#
# 10 debates: 5 fresh topics x 2 pacings. All use adaptive staging.
# Topics chosen to maximize cross-POV disagreement (crux-generating potential).
#
# Usage:
#   ./scripts/run-crux-debates.sh              # run all 10
#   ./scripts/run-crux-debates.sh --smoke       # run only first 2
#   ./scripts/run-crux-debates.sh --range 3 6   # run debates 3–6
#   ./scripts/run-crux-debates.sh --dry-run     # print configs without running

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO_ROOT/lib/debate/cli.ts"
MODEL="gemini-3.1-flash-lite-preview"
OUTPUT_DIR="$REPO_ROOT/../ai-triad-data/debates"

ORDER_A='["prometheus","sentinel","cassandra"]'
ORDER_B='["cassandra","prometheus","sentinel"]'

# ── Topics (fresh — not used in calibration or validation batches) ──
# Selected for high cross-POV tension to maximize crux generation.

TOPIC_1="Should open-source AI models be subject to the same safety requirements as closed-source models?"
TOPIC_2="Is compute governance (controlling access to training hardware) a viable strategy for AI safety?"
TOPIC_3_SIT="sit-012"  # "Autonomous Weapons Proliferation"
TOPIC_4="Should AI companies be held strictly liable for harms caused by their deployed systems?"
TOPIC_5="Can international AI governance treaties be effective without enforcement mechanisms?"

# ── Build 10 configs ──────────────────────────────────────

configs=()

make_topic_config() {
  local topic="$1" order="$2" pacing="$3" label="$4"
  cat <<ENDJSON
{
  "topic": "$topic",
  "name": "crux-$label",
  "activePovers": $order,
  "model": "$MODEL",
  "useAdaptiveStaging": true,
  "pacing": "$pacing",
  "allowEarlyTermination": true,
  "audience": "policymakers",
  "outputDir": "$OUTPUT_DIR"
}
ENDJSON
}

make_sit_config() {
  local sit_id="$1" order="$2" pacing="$3" label="$4"
  cat <<ENDJSON
{
  "situationId": "$sit_id",
  "name": "crux-$label",
  "activePovers": $order,
  "model": "$MODEL",
  "useAdaptiveStaging": true,
  "pacing": "$pacing",
  "allowEarlyTermination": true,
  "audience": "policymakers",
  "outputDir": "$OUTPUT_DIR"
}
ENDJSON
}

# T1: Open-source safety (2 configs)
configs+=("$(make_topic_config "$TOPIC_1" "$ORDER_A" "moderate" "01-opensource-A-mod")")
configs+=("$(make_topic_config "$TOPIC_1" "$ORDER_B" "thorough" "02-opensource-B-thr")")

# T2: Compute governance (2 configs)
configs+=("$(make_topic_config "$TOPIC_2" "$ORDER_A" "thorough" "03-compute-A-thr")")
configs+=("$(make_topic_config "$TOPIC_2" "$ORDER_B" "moderate" "04-compute-B-mod")")

# T3: Situation node — autonomous weapons (2 configs)
configs+=("$(make_sit_config "$TOPIC_3_SIT" "$ORDER_A" "moderate" "05-sit012-A-mod")")
configs+=("$(make_sit_config "$TOPIC_3_SIT" "$ORDER_B" "thorough" "06-sit012-B-thr")")

# T4: Strict liability (2 configs)
configs+=("$(make_topic_config "$TOPIC_4" "$ORDER_A" "moderate" "07-liability-A-mod")")
configs+=("$(make_topic_config "$TOPIC_4" "$ORDER_B" "thorough" "08-liability-B-thr")")

# T5: International treaties (2 configs)
configs+=("$(make_topic_config "$TOPIC_5" "$ORDER_A" "thorough" "09-treaties-A-thr")")
configs+=("$(make_topic_config "$TOPIC_5" "$ORDER_B" "moderate" "10-treaties-B-mod")")

# ── Argument parsing ──────────────────────────────────────

START=1
END=${#configs[@]}
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --smoke)    START=1; END=2; shift ;;
    --range)    START="$2"; END="$3"; shift 3 ;;
    --dry-run)  DRY_RUN=true; shift ;;
    *)          echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ── Run debates ───────────────────────────────────────────

echo "=== Crux Debate Runner (t/263 + t/324 validation) ==="
echo "Model: $MODEL"
echo "Debates: $START to $END of ${#configs[@]}"
echo "Output: $OUTPUT_DIR"
echo ""

PASSED=0
FAILED=0
FAILED_IDS=""

for i in $(seq "$START" "$END"); do
  idx=$((i - 1))
  config="${configs[$idx]}"
  label=$(echo "$config" | python3 -c "import sys,json; print(json.load(sys.stdin)['name'])")

  echo "── [$i/${#configs[@]}] $label ──"

  if $DRY_RUN; then
    echo "$config" | python3 -m json.tool
    echo ""
    continue
  fi

  if echo "$config" | npx tsx "$CLI" --stdin 2>&1 | tee "/tmp/crux-debate-${i}.log"; then
    echo "  OK"
    PASSED=$((PASSED + 1))
  else
    echo "  FAILED (see /tmp/crux-debate-${i}.log)"
    FAILED=$((FAILED + 1))
    FAILED_IDS="$FAILED_IDS $i"
  fi
  echo ""
done

if ! $DRY_RUN; then
  echo "=== Summary ==="
  echo "Passed: $PASSED  Failed: $FAILED"
  if [[ -n "$FAILED_IDS" ]]; then
    echo "Failed debates:$FAILED_IDS"
    echo "Re-run with: $0 --range <start> <end>"
  fi

  # Quick crux stats from new debates
  echo ""
  echo "=== Crux Stats ==="
  python3 -c "
import json, glob, os
new_files = sorted(glob.glob('$OUTPUT_DIR/debate-*.json'), key=os.path.getmtime, reverse=True)[:$END]
tracker_count = 0
synth_crux_count = 0
for f in new_files:
    d = json.load(open(f))
    if d.get('crux_tracker'):
        tracker_count += 1
    for e in d.get('transcript', []):
        if e.get('type') in ('concluding', 'synthesis'):
            cruxes = e.get('metadata', {}).get('synthesis', {}).get('cruxes', [])
            if cruxes:
                synth_crux_count += len(cruxes)
            break
print(f'New debates with crux_tracker: {tracker_count}/{len(new_files)}')
print(f'Total synthesis cruxes: {synth_crux_count}')
" 2>/dev/null || echo "(stats script failed — check manually)"
fi
