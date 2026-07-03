#!/usr/bin/env bash
# Quality gates: LOC ceilings + large-file guard (t/1292, B-408).
# Called from ci.yml. Reads quality-gates.json for thresholds.
# Uses ::warning:: annotations (soft fail) until 2026-07-17, then ::error::.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$REPO_ROOT/quality-gates.json"
FAIL_MSG="extract, don't extend — see docs/reviews/2026-07-repo-review/BACKLOG.md B-408"
EXIT_CODE=0

if [ ! -f "$CONFIG" ]; then
  echo "::error::quality-gates.json not found at $CONFIG"
  exit 1
fi

# ── LOC ceilings ──────────────────────────────────────────
echo "=== LOC ceiling checks ==="
for file in $(jq -r '.loc_ceilings | keys[]' "$CONFIG"); do
  ceiling=$(jq -r --arg f "$file" '.loc_ceilings[$f]' "$CONFIG")
  filepath="$REPO_ROOT/$file"

  if [ ! -f "$filepath" ]; then
    echo "::warning file=$file::File not found (may have been extracted already)"
    continue
  fi

  loc=$(wc -l < "$filepath")
  if [ "$loc" -gt "$ceiling" ]; then
    echo "::warning file=$file,title=LOC ceiling exceeded::$file is $loc lines (ceiling: $ceiling). $FAIL_MSG"
    EXIT_CODE=1
  else
    echo "  $file: $loc / $ceiling OK"
  fi
done

# ── Large file guard ──────────────────────────────────────
echo ""
echo "=== Large file guard (max $(jq -r '.max_file_bytes' "$CONFIG") bytes) ==="
MAX_BYTES=$(jq -r '.max_file_bytes' "$CONFIG")

MERGE_BASE="${GITHUB_BASE_REF:-}"
if [ -n "$MERGE_BASE" ]; then
  BASE_REF="origin/$MERGE_BASE"
else
  BASE_REF="HEAD~1"
fi

added_files=$(git diff --diff-filter=A --name-only "$BASE_REF" HEAD 2>/dev/null || true)

if [ -z "$added_files" ]; then
  echo "  No new files added."
else
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    filepath="$REPO_ROOT/$file"
    [ ! -f "$filepath" ] && continue

    size=$(wc -c < "$filepath")
    if [ "$size" -gt "$MAX_BYTES" ]; then
      size_mb=$(awk "BEGIN {printf \"%.1f\", $size / 1048576}")
      echo "::warning file=$file,title=Large file added::$file is ${size_mb}MB (limit: 5MB). $FAIL_MSG"
      EXIT_CODE=1
    fi
  done <<< "$added_files"

  if [ "$EXIT_CODE" -eq 0 ]; then
    echo "  All new files under ${MAX_BYTES} bytes."
  fi
fi

exit $EXIT_CODE
