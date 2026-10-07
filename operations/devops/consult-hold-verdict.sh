#!/usr/bin/env bash
# consult-hold verdict (t/4062, SO e/276) — run by .github/workflows/consult-hold-guard.yml and by
# operations/devops/consult-hold-verdict.test.sh (same script: tested code == running code).
#
# WHAT IT ENFORCES (exit 0 = merge allowed, exit 1 = blocked, with a legible ::error::):
#   (1) LABEL HOLD (t/3680, unchanged semantics): the `consult-hold` label on the PR -> blocked.
#   (2) COMMIT-TRAILER HOLD (t/4062): every commit in BASE..HEAD is parsed with
#       `git interpret-trailers --parse` (real trailers only, never mentions in a body). Each
#       `Consult-Hold: t/<digits>` trailer (key case-insensitive; several commits/tickets allowed)
#       holds the PR until, for EACH held ticket, the PR has
#         - a comment line  `HOLD CLEARED: t/<N> @<40-hex head sha>`  whose sha == HEAD  (SO cond 1:
#           clearance is bound to the reviewed head; any later push turns the check red again), AND
#         - the label `consult-hold-cleared` (the RE-RUN TRIGGER: issue_comment events cannot re-run a
#           pull_request check on the PR head, labeled/unlabeled can — t/4062#2).
#       A `Consult-Hold:` trailer whose value is not exactly `t/<digits>` -> blocked as MALFORMED
#       (SO cond 3: never silently ignored).
#   Why the trailer: the hold travels WITH THE COMMITS, so any PR carrying them — including one the
#   t/3716 automation opens seconds after a push, or a second PR from the same branch (#3020) — is
#   gated from its first run. Nothing has to win a race.
#
# NO API ON THE UNTRAILERED PATH (SO cond 2): trailers come from git, labels from the event payload
# (LABELS env). The comments API is read ONLY when a trailer exists — so an untrailered PR never
# depends on API availability, and a >250-commit PR (the PR-commits API cap) cannot fail open.
#
# no warn cycle: deterministic, all arms (A–J) proven in CI (t/4062, SO e/276) — extends an
# already-REQUIRED context.
#
# Inputs (env):
#   BASE_SHA, HEAD_SHA   commit range to inspect (BASE exclusive); must both exist locally.
#   LABELS               newline-separated label names on the PR (from the event payload).
#   PR_NUMBER, REPO      for the comments read (only when a trailer is found).
#   COMMENTS_FILE        TEST HOOK: read comment bodies from this file instead of the API.
set -uo pipefail

fail() { echo "::error::consult-hold-guard: $*"; exit 1; }

: "${BASE_SHA:?BASE_SHA required}" "${HEAD_SHA:?HEAD_SHA required}"
LABELS="${LABELS:-}"

has_label() { printf '%s\n' "$LABELS" | grep -qxF "$1"; }

# ── (1) label hold ──────────────────────────────────────────────────────────────────────────
if has_label consult-hold; then
  fail "this PR carries the 'consult-hold' label — a mandatory consult/review hold is OUTSTANDING, so merge is blocked (required gate; blocks human, agent, and server-side auto-merge alike). The conditions and who can clear them are in this PR's HOLD comment. TO CLEAR: resolve them, then REMOVE the 'consult-hold' label; this check re-runs on unlabel and goes green with NO push."
fi

# ── (2) commit-trailer hold ─────────────────────────────────────────────────────────────────
if ! COMMITS=$(git rev-list "${BASE_SHA}..${HEAD_SHA}" 2>&1); then
  fail "could NOT list commits ${BASE_SHA:0:8}..${HEAD_SHA:0:8} (${COMMITS}) — checkout too shallow or SHA missing. NOT a hold; failing closed (required gate)."
fi

held=()        # tickets held by a well-formed trailer
malformed=()   # "sha: raw value"
for c in $COMMITS; do
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    key="${line%%:*}"; val="${line#*:}"; val="$(printf '%s' "$val" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
    if [ "$(printf '%s' "$key" | tr '[:upper:]' '[:lower:]')" = "consult-hold" ]; then
      if printf '%s' "$val" | grep -Eqx 't/[0-9]+'; then
        held+=("$val")
      else
        malformed+=("${c:0:8}: '${val}'")
      fi
    fi
  done < <(git log -1 --format=%B "$c" | git interpret-trailers --parse)
done

if [ "${#malformed[@]}" -gt 0 ]; then
  fail "MALFORMED Consult-Hold trailer(s) — value must be exactly t/<digits>: ${malformed[*]}. Fix the commit message (amend/rebase); a malformed hold is never ignored (SO e/276 cond 3)."
fi

if [ "${#held[@]}" -eq 0 ]; then
  echo "guard OK — no consult-hold label and no Consult-Hold trailers in ${BASE_SHA:0:8}..${HEAD_SHA:0:8}."
  exit 0
fi

mapfile -t tickets < <(printf '%s\n' "${held[@]}" | sort -u)
echo "Consult-Hold trailers found for: ${tickets[*]} (head ${HEAD_SHA})"

# Clearances — only now do we touch the API.
if [ -n "${COMMENTS_FILE:-}" ]; then
  COMMENTS="$(cat "$COMMENTS_FILE")"
else
  : "${PR_NUMBER:?PR_NUMBER required}" "${REPO:?REPO required}"
  COMMENTS=""; ok=""; err=""
  for attempt in 1 2 3; do
    if COMMENTS=$(gh api "repos/${REPO}/issues/${PR_NUMBER}/comments" --paginate --jq '.[].body' 2>&1); then ok=1; break; fi
    err="$(printf '%s' "$COMMENTS" | head -c 300 | tr '\n' ' ')"
    echo "::warning::consult-hold-guard: comments read attempt ${attempt}/3 failed — ${err}"
    sleep $((attempt * 3))
  done
  [ -n "$ok" ] || fail "could NOT read PR comments to check clearance for ${tickets[*]} (last error: ${err}) — API/INFRA failure, NOT proof of a clearance. Re-run if transient. (Failing closed — required gate.)"
fi

missing=()
for t in "${tickets[@]}"; do
  if ! printf '%s\n' "$COMMENTS" | tr -d '\r' | grep -Eq "^[[:space:]]*HOLD CLEARED:[[:space:]]*${t}[[:space:]]*@[[:space:]]*${HEAD_SHA}[[:space:]]*$"; then
    missing+=("$t")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  fail "commit-trailer hold OUTSTANDING for ${missing[*]} — no 'HOLD CLEARED: <ticket> @${HEAD_SHA}' comment for the CURRENT head (a clearance for an older head does not count: a push restarts review). TO CLEAR: when the consult conditions are met, comment 'HOLD CLEARED: <ticket> @${HEAD_SHA}' for each, then add (or remove and re-add) the 'consult-hold-cleared' label to re-run this check."
fi

if ! has_label consult-hold-cleared; then
  fail "clearance comments for ${tickets[*]} match head ${HEAD_SHA:0:8}, but the 'consult-hold-cleared' label is missing. Add it (or remove and re-add it) — the label event is what re-runs this check on the PR head."
fi

echo "guard OK — Consult-Hold trailers ${tickets[*]} all cleared at head ${HEAD_SHA:0:8}, consult-hold-cleared label present."
