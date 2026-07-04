#!/usr/bin/env bash
# Doc accuracy claims-lint (t/1324, B-403).
# Called from ci.yml. Reads doc-claims.json for assertions.
# Uses ::warning:: annotations (soft fail) until 2026-07-17, then ::error::.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$REPO_ROOT/doc-claims.json"
EXIT_CODE=0

if [ ! -f "$CONFIG" ]; then
  echo "::error::doc-claims.json not found at $CONFIG"
  exit 1
fi

CLAIM_COUNT=$(jq '.claims | length' "$CONFIG")
echo "=== Doc claims lint ($CLAIM_COUNT claims) ==="

for i in $(seq 0 $((CLAIM_COUNT - 1))); do
  id=$(jq -r ".claims[$i].id" "$CONFIG")
  type=$(jq -r ".claims[$i].type" "$CONFIG")
  description=$(jq -r ".claims[$i].description" "$CONFIG")
  ci_skip=$(jq -r ".claims[$i].ci_skip // false" "$CONFIG")

  if [ "$ci_skip" = "true" ] && [ "${CI:-}" = "true" ]; then
    echo "  [$id] SKIP (ci_skip=true)"
    continue
  fi

  measure_cmd=$(jq -r ".claims[$i].measure" "$CONFIG")

  if [ "$type" = "value_check" ]; then
    measured=$(cd "$REPO_ROOT" && eval "$measure_cmd" 2>/dev/null | tr -d '[:space:]')
    expected=$(jq -r ".claims[$i].expect" "$CONFIG")
    tolerance=$(jq -r ".claims[$i].tolerance // 0" "$CONFIG")

    if [[ "$measured" =~ ^[0-9]+$ ]] && [[ "$expected" =~ ^[0-9]+$ ]] && [ "$tolerance" -gt 0 ]; then
      diff=$((measured - expected))
      abs_diff=${diff#-}
      if [ "$abs_diff" -gt "$tolerance" ]; then
        echo "::warning title=Doc claim drift ($id)::$description — expected $expected (±$tolerance), measured $measured"
        EXIT_CODE=1
      else
        echo "  [$id] OK — expected $expected (±$tolerance), measured $measured"
      fi
    else
      if [ "$measured" != "$expected" ]; then
        echo "::warning title=Doc claim drift ($id)::$description — expected '$expected', measured '$measured'"
        EXIT_CODE=1
      else
        echo "  [$id] OK — '$measured'"
      fi
    fi

  elif [ "$type" = "zero_check" ]; then
    matches=$(cd "$REPO_ROOT" && eval "$measure_cmd" 2>/dev/null || true)
    if [ -n "$matches" ]; then
      echo "::warning title=Doc claim violation ($id)::$description — unexpected output: $matches"
      EXIT_CODE=1
    else
      echo "  [$id] OK — zero matches"
    fi
  fi
done

exit $EXIT_CODE
