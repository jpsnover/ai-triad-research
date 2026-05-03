#!/usr/bin/env bash
# Phase 3 calibration debates — 20 debates with controlled variation.
# Model: gemini-3.1-flash-lite-preview (project default, floor-calibrated)
# Design: 5 topics x 2 debater orders x 2 pacings = 20 debates
#
# Usage:
#   ./scripts/run-calibration-debates.sh              # run all 20
#   ./scripts/run-calibration-debates.sh --smoke       # run only smoke tests (first 2)
#   ./scripts/run-calibration-debates.sh --range 3 10  # run debates 3–10
#   ./scripts/run-calibration-debates.sh --dry-run     # print configs without running

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO_ROOT/lib/debate/cli.ts"
MODEL="gemini-3.1-flash-lite-preview"
OUTPUT_DIR="$REPO_ROOT/../ai-triad-data/debates"
LOG_FILE="$REPO_ROOT/../ai-triad-data/calibration/calibration-log.json"

# Debater orders
ORDER_A='["prometheus","sentinel","cassandra"]'
ORDER_B='["cassandra","prometheus","sentinel"]'

# 5 Topics
TOPIC_1="Should frontier AI labs be required to run red-team evaluations before deployment?"
TOPIC_2="How should democratic nations govern AI development?"
TOPIC_3_SIT="sit-003"  # "Who Makes the Rules for AI?" — cross-cutting situation node
TOPIC_4_DOC="regulatory-policy-practice-ais-frontier-2026"
TOPIC_5="Is the precautionary principle appropriate for AI regulation?"

# ── Build the 20 configs ──────────────────────────────────

configs=()

# Helper: build a topic-based config
make_topic_config() {
  local topic="$1" order="$2" pacing="$3" label="$4"
  cat <<ENDJSON
{
  "topic": "$topic",
  "name": "calibration-$label",
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

# Helper: build a situation-based config
make_sit_config() {
  local sit_id="$1" order="$2" pacing="$3" label="$4"
  cat <<ENDJSON
{
  "situationId": "$sit_id",
  "name": "calibration-$label",
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

# Helper: build a document-based config
make_doc_config() {
  local doc_dir="$1" order="$2" pacing="$3" label="$4"
  local doc_path="$REPO_ROOT/../ai-triad-data/sources/$doc_dir"
  cat <<ENDJSON
{
  "docPath": "$doc_path",
  "name": "calibration-$label",
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

# ── Debate matrix (20 = 5 topics x 2 orders x 2 pacings) ──

# Smoke tests: #1 moderate, #2 thorough (different topics)
# 1: T1 + order-A + moderate
configs+=("$(make_topic_config "$TOPIC_1" "$ORDER_A" "moderate" "01-redteam-A-mod")")
# 2: T2 + order-A + thorough
configs+=("$(make_topic_config "$TOPIC_2" "$ORDER_A" "thorough" "02-govern-A-thr")")

# Remaining 18
# T1 variations (3 remaining)
configs+=("$(make_topic_config "$TOPIC_1" "$ORDER_A" "thorough" "03-redteam-A-thr")")
configs+=("$(make_topic_config "$TOPIC_1" "$ORDER_B" "moderate" "04-redteam-B-mod")")
configs+=("$(make_topic_config "$TOPIC_1" "$ORDER_B" "thorough" "05-redteam-B-thr")")

# T2 variations (3 remaining)
configs+=("$(make_topic_config "$TOPIC_2" "$ORDER_A" "moderate" "06-govern-A-mod")")
configs+=("$(make_topic_config "$TOPIC_2" "$ORDER_B" "moderate" "07-govern-B-mod")")
configs+=("$(make_topic_config "$TOPIC_2" "$ORDER_B" "thorough" "08-govern-B-thr")")

# T3: situation node (4 configs)
configs+=("$(make_sit_config "$TOPIC_3_SIT" "$ORDER_A" "moderate" "09-sit003-A-mod")")
configs+=("$(make_sit_config "$TOPIC_3_SIT" "$ORDER_A" "thorough" "10-sit003-A-thr")")
configs+=("$(make_sit_config "$TOPIC_3_SIT" "$ORDER_B" "moderate" "11-sit003-B-mod")")
configs+=("$(make_sit_config "$TOPIC_3_SIT" "$ORDER_B" "thorough" "12-sit003-B-thr")")

# T4: document-sourced (4 configs)
configs+=("$(make_doc_config "$TOPIC_4_DOC" "$ORDER_A" "moderate" "13-doc-A-mod")")
configs+=("$(make_doc_config "$TOPIC_4_DOC" "$ORDER_A" "thorough" "14-doc-A-thr")")
configs+=("$(make_doc_config "$TOPIC_4_DOC" "$ORDER_B" "moderate" "15-doc-B-mod")")
configs+=("$(make_doc_config "$TOPIC_4_DOC" "$ORDER_B" "thorough" "16-doc-B-thr")")

# T5: values-focused (4 configs)
configs+=("$(make_topic_config "$TOPIC_5" "$ORDER_A" "moderate" "17-precaut-A-mod")")
configs+=("$(make_topic_config "$TOPIC_5" "$ORDER_A" "thorough" "18-precaut-A-thr")")
configs+=("$(make_topic_config "$TOPIC_5" "$ORDER_B" "moderate" "19-precaut-B-mod")")
configs+=("$(make_topic_config "$TOPIC_5" "$ORDER_B" "thorough" "20-precaut-B-thr")")

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

echo "=== Calibration Debate Runner ==="
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

  if echo "$config" | npx tsx "$CLI" --stdin 2>&1 | tee "/tmp/calibration-debate-${i}.log"; then
    echo "  OK"
    PASSED=$((PASSED + 1))
  else
    echo "  FAILED (see /tmp/calibration-debate-${i}.log)"
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

  if [[ -f "$LOG_FILE" ]]; then
    ENTRIES=$(python3 -c "import json; print(len(json.load(open('$LOG_FILE'))))" 2>/dev/null || echo "?")
    echo "Calibration log entries: $ENTRIES"
  fi
fi
