#!/usr/bin/env bash
# Phase 5a: Validate calibrated parameters on held-out topics.
# Model: gemini-3.1-flash-lite-preview (same as Phase 3 calibration)
# Design: 4 held-out topics x 2 debater orders x 2 pacings = 16 debates
# None of these topics were used during Phase 3 parameter calibration.
#
# Usage:
#   ./scripts/run-validation-debates.sh              # run all 16
#   ./scripts/run-validation-debates.sh --smoke       # run only first 2 (quick check)
#   ./scripts/run-validation-debates.sh --range 3 8   # run debates 3–8
#   ./scripts/run-validation-debates.sh --dry-run     # print configs without running
#   ./scripts/run-validation-debates.sh --report      # generate comparison report from existing data

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO_ROOT/lib/debate/cli.ts"
MODEL="gemini-3.1-flash-lite-preview"
OUTPUT_DIR="$REPO_ROOT/../ai-triad-data/debates"
CAL_LOG="$REPO_ROOT/../ai-triad-data/calibration/calibration-log.json"
REPORT_DIR="$REPO_ROOT/../ai-triad-data/calibration"
REPORT_FILE="$REPORT_DIR/validation-report.json"

# Debater orders (same as Phase 3 for comparability)
ORDER_A='["prometheus","sentinel","cassandra"]'
ORDER_B='["cassandra","prometheus","sentinel"]'

# ── Held-out topics (NOT used in Phase 3 calibration) ─────────────────
# Phase 3 used: red-team evals, democratic governance, sit-003, regulatory-policy doc, precautionary principle
# These 4 are entirely new:

TOPIC_1="Should AI systems that operate autonomously in critical infrastructure require human-in-the-loop oversight?"
TOPIC_2="What intellectual property frameworks are needed for AI-generated content?"
TOPIC_3_SIT="sit-038"  # "AI Job Loss Spiral" — labor market cascade scenario
TOPIC_4_DOC="controllability-trap-governance-framework-military-ai-agents-2026"

# ── Build 16 configs ──────────────────────────────────────

configs=()

make_topic_config() {
  local topic="$1" order="$2" pacing="$3" label="$4"
  cat <<ENDJSON
{
  "topic": "$topic",
  "name": "validation-$label",
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
  "name": "validation-$label",
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

make_doc_config() {
  local doc_dir="$1" order="$2" pacing="$3" label="$4"
  local doc_path="$REPO_ROOT/../ai-triad-data/sources/$doc_dir"
  cat <<ENDJSON
{
  "docPath": "$doc_path",
  "name": "validation-$label",
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

# ── Debate matrix (16 = 4 topics x 2 orders x 2 pacings) ──

# T1: Human-in-the-loop for autonomous systems
configs+=("$(make_topic_config "$TOPIC_1" "$ORDER_A" "moderate" "01-hitl-A-mod")")
configs+=("$(make_topic_config "$TOPIC_1" "$ORDER_A" "thorough" "02-hitl-A-thr")")
configs+=("$(make_topic_config "$TOPIC_1" "$ORDER_B" "moderate" "03-hitl-B-mod")")
configs+=("$(make_topic_config "$TOPIC_1" "$ORDER_B" "thorough" "04-hitl-B-thr")")

# T2: IP frameworks for AI content
configs+=("$(make_topic_config "$TOPIC_2" "$ORDER_A" "moderate" "05-ip-A-mod")")
configs+=("$(make_topic_config "$TOPIC_2" "$ORDER_A" "thorough" "06-ip-A-thr")")
configs+=("$(make_topic_config "$TOPIC_2" "$ORDER_B" "moderate" "07-ip-B-mod")")
configs+=("$(make_topic_config "$TOPIC_2" "$ORDER_B" "thorough" "08-ip-B-thr")")

# T3: Situation node — AI Job Loss Spiral
configs+=("$(make_sit_config "$TOPIC_3_SIT" "$ORDER_A" "moderate" "09-jobloss-A-mod")")
configs+=("$(make_sit_config "$TOPIC_3_SIT" "$ORDER_A" "thorough" "10-jobloss-A-thr")")
configs+=("$(make_sit_config "$TOPIC_3_SIT" "$ORDER_B" "moderate" "11-jobloss-B-mod")")
configs+=("$(make_sit_config "$TOPIC_3_SIT" "$ORDER_B" "thorough" "12-jobloss-B-thr")")

# T4: Document — Military AI controllability
configs+=("$(make_doc_config "$TOPIC_4_DOC" "$ORDER_A" "moderate" "13-milai-A-mod")")
configs+=("$(make_doc_config "$TOPIC_4_DOC" "$ORDER_A" "thorough" "14-milai-A-thr")")
configs+=("$(make_doc_config "$TOPIC_4_DOC" "$ORDER_B" "moderate" "15-milai-B-mod")")
configs+=("$(make_doc_config "$TOPIC_4_DOC" "$ORDER_B" "thorough" "16-milai-B-thr")")

# ── Argument parsing ──────────────────────────────────────

START=1
END=${#configs[@]}
DRY_RUN=false
REPORT_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --smoke)    START=1; END=2; shift ;;
    --range)    START="$2"; END="$3"; shift 3 ;;
    --dry-run)  DRY_RUN=true; shift ;;
    --report)   REPORT_ONLY=true; shift ;;
    *)          echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ── Report generation ─────────────────────────────────────

generate_report() {
  python3 - "$CAL_LOG" "$REPORT_FILE" "$OUTPUT_DIR" <<'PYEOF'
import json, sys, statistics, glob, os
from pathlib import Path

cal_log_path = sys.argv[1]
report_path = sys.argv[2]
debates_dir = sys.argv[3]

with open(cal_log_path) as f:
    log = json.load(f)

# Build set of validation debate IDs by scanning debate files named validation-*
validation_ids = set()
for fp in glob.glob(os.path.join(debates_dir, 'validation-*-debate.json')):
    try:
        with open(fp) as fh:
            d = json.load(fh)
        validation_ids.add(d['id'])
    except (json.JSONDecodeError, KeyError):
        pass
# Also check canonical debate-{id}.json files with validation titles
for fp in glob.glob(os.path.join(debates_dir, 'debate-*.json')):
    try:
        with open(fp) as fh:
            d = json.load(fh)
        title = d.get('title', '')
        if 'validation-' in title:
            validation_ids.add(d['id'])
    except (json.JSONDecodeError, KeyError):
        pass

# Separate entries: validation = IDs matching validation debate files
val_entries = [e for e in log if e.get('debate_id') in validation_ids]
cal_entries = [e for e in log if e.get('debate_id') not in validation_ids and e.get('model') == 'gemini-3.1-flash-lite-preview']

# Quality metrics to compare
METRICS = {
    'engaging_real_disagreement': {'type': 'bool', 'target': True, 'label': 'Real Disagreement'},
    'crux_addressed_ratio': {'type': 'float', 'target': 'higher', 'label': 'Crux Addressed Ratio'},
    'avg_utilization_rate': {'type': 'float', 'target': 'higher', 'label': 'Avg Utilization Rate'},
    'structural_error_rate': {'type': 'float', 'target': 'lower', 'label': 'Structural Error Rate'},
    'repetition_rate': {'type': 'float', 'target': 'lower', 'label': 'Repetition Rate'},
    'claims_forgotten_rate': {'type': 'float', 'target': 'lower', 'label': 'Claims Forgotten Rate'},
    'taxonomy_mapped_ratio': {'type': 'float', 'target': 'higher', 'label': 'Taxonomy Mapped Ratio'},
    'avg_primary_utilization': {'type': 'float', 'target': 'higher', 'label': 'Primary Utilization'},
}

def compute_stats(entries, metric_key, metric_info):
    values = [e[metric_key] for e in entries if e.get(metric_key) is not None]
    if not values:
        return None
    if metric_info['type'] == 'bool':
        return {'true_rate': sum(1 for v in values if v) / len(values), 'n': len(values)}
    return {
        'mean': statistics.mean(values),
        'median': statistics.median(values),
        'stdev': statistics.stdev(values) if len(values) > 1 else 0,
        'min': min(values),
        'max': max(values),
        'n': len(values),
    }

# Build report
report = {
    'schema_version': 1,
    'calibration_entries': len(cal_entries),
    'validation_entries': len(val_entries),
    'metrics': {},
    'summary': {'pass': 0, 'fail': 0, 'skip': 0},
}

for key, info in METRICS.items():
    cal_stats = compute_stats(cal_entries, key, info)
    val_stats = compute_stats(val_entries, key, info)

    if val_stats is None:
        report['metrics'][key] = {'label': info['label'], 'status': 'skip', 'reason': 'no validation data'}
        report['summary']['skip'] += 1
        continue

    result = {
        'label': info['label'],
        'calibration': cal_stats,
        'validation': val_stats,
    }

    # Determine pass/fail
    if info['type'] == 'bool':
        if cal_stats:
            passed = val_stats['true_rate'] >= cal_stats['true_rate'] * 0.9  # within 10%
        else:
            passed = val_stats['true_rate'] >= 0.8
        result['status'] = 'pass' if passed else 'fail'
    else:
        if cal_stats is None:
            result['status'] = 'skip'
            result['reason'] = 'no calibration baseline'
            report['summary']['skip'] += 1
            report['metrics'][key] = result
            continue

        if info['target'] == 'higher':
            # Validation mean should be >= 90% of calibration mean (allows slight regression)
            threshold = cal_stats['mean'] * 0.9
            passed = val_stats['mean'] >= threshold
        else:  # lower is better
            # Validation mean should be <= 110% of calibration mean
            threshold = cal_stats['mean'] * 1.1 if cal_stats['mean'] > 0 else 0.05
            passed = val_stats['mean'] <= threshold

        result['status'] = 'pass' if passed else 'fail'
        result['threshold'] = threshold

    report['summary']['pass' if result['status'] == 'pass' else 'fail'] += 1
    report['metrics'][key] = result

# Overall verdict
total_graded = report['summary']['pass'] + report['summary']['fail']
if total_graded == 0:
    report['verdict'] = 'INSUFFICIENT_DATA'
elif report['summary']['fail'] == 0:
    report['verdict'] = 'PASS'
elif report['summary']['fail'] <= 1:
    report['verdict'] = 'MARGINAL'
else:
    report['verdict'] = 'FAIL'

Path(report_path).parent.mkdir(parents=True, exist_ok=True)
with open(report_path, 'w') as f:
    json.dump(report, f, indent=2)

# Print summary to stdout
print(f"\n{'='*60}")
print(f"  VALIDATION REPORT — Phase 5a")
print(f"{'='*60}")
print(f"  Calibration baseline: {report['calibration_entries']} debates")
print(f"  Validation set:       {report['validation_entries']} debates")
print(f"{'─'*60}")
for key, m in report['metrics'].items():
    status_icon = '✓' if m['status'] == 'pass' else '✗' if m['status'] == 'fail' else '–'
    label = m['label'].ljust(24)
    if m['status'] == 'skip':
        print(f"  {status_icon} {label} (skipped: {m.get('reason', '')})")
    elif m.get('validation') and 'mean' in m['validation']:
        cal_val = f"{m['calibration']['mean']:.3f}" if m.get('calibration') else '—'
        val_val = f"{m['validation']['mean']:.3f}"
        print(f"  {status_icon} {label} cal={cal_val}  val={val_val}")
    elif m.get('validation') and 'true_rate' in m['validation']:
        cal_val = f"{m['calibration']['true_rate']:.1%}" if m.get('calibration') else '—'
        val_val = f"{m['validation']['true_rate']:.1%}"
        print(f"  {status_icon} {label} cal={cal_val}  val={val_val}")
print(f"{'─'*60}")
print(f"  VERDICT: {report['verdict']}  (pass={report['summary']['pass']}, fail={report['summary']['fail']}, skip={report['summary']['skip']})")
print(f"{'='*60}")
print(f"\n  Report written to: {report_path}")
PYEOF
}

# ── Report-only mode ──────────────────────────────────────

if $REPORT_ONLY; then
  echo "=== Generating validation report from existing calibration log ==="
  generate_report
  exit 0
fi

# ── Run debates ───────────────────────────────────────────

echo "=== Phase 5a: Validation Debate Runner ==="
echo "Model: $MODEL"
echo "Debates: $START to $END of ${#configs[@]}"
echo "Output: $OUTPUT_DIR"
echo "Calibrated params: $REPO_ROOT/lib/debate/provisional-weights.json"
echo ""
echo "Held-out topics (not used during calibration):"
echo "  T1: Human-in-the-loop for autonomous infrastructure"
echo "  T2: IP frameworks for AI-generated content"
echo "  T3: sit-038 — AI Job Loss Spiral"
echo "  T4: Military AI controllability (document)"
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

  if echo "$config" | npx tsx "$CLI" --stdin 2>&1 | tee "/tmp/validation-debate-${i}.log"; then
    echo "  OK"
    PASSED=$((PASSED + 1))
  else
    echo "  FAILED (see /tmp/validation-debate-${i}.log)"
    FAILED=$((FAILED + 1))
    FAILED_IDS="$FAILED_IDS $i"
  fi
  echo ""
done

if ! $DRY_RUN; then
  echo "=== Debate Summary ==="
  echo "Passed: $PASSED  Failed: $FAILED"
  if [[ -n "$FAILED_IDS" ]]; then
    echo "Failed debates:$FAILED_IDS"
    echo "Re-run with: $0 --range <start> <end>"
  fi
  echo ""

  # Auto-generate comparison report
  echo "=== Generating validation comparison report ==="
  generate_report
fi
