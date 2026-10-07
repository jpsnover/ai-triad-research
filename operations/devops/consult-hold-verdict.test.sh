#!/usr/bin/env bash
# t/4062 — local arms for consult-hold-verdict.sh (the SAME script the workflow runs). Builds a
# throwaway git repo per arm; comments come from COMMENTS_FILE (the script's test hook), labels from
# LABELS. CI arms (real PRs, real API) are proven separately on probe PRs; these pin the logic.
# Exit 0 only if every arm matches AND the population floor is met.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
SUT="$here/consult-hold-verdict.sh"
pass=0; failn=0; ran=0

mkrepo() {  # $1 = dir; creates base commit, prints its sha
  rm -rf "$1"; mkdir -p "$1"; git -C "$1" init -q
  git -C "$1" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
  git -C "$1" rev-parse HEAD
}
commit() {  # $1 = dir, $2 = full message; prints new sha
  git -C "$1" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "$2"
  git -C "$1" rev-parse HEAD
}
arm() {  # $1 name, $2 expected exit (0|1), $3 expected message regex; env set by caller
  local out rc; ran=$((ran + 1))
  out="$(cd "$REPO_DIR" && bash "$SUT" 2>&1)"; rc=$?
  if [ "$rc" = "$2" ] && printf '%s' "$out" | grep -Eq "$3"; then
    pass=$((pass + 1)); echo "PASS  $1 (exit $rc)"
  else
    failn=$((failn + 1)); echo "FAIL  $1 — expected exit $2 + /$3/, got exit $rc:"; printf '%s\n' "$out" | sed 's/^/      /'
  fi
}

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
REPO_DIR="$T/r"; CF="$T/comments"; : > "$CF"
export COMMENTS_FILE="$CF"

# E: no trailer, no label -> green (and no comments needed)
BASE=$(mkrepo "$REPO_DIR"); HEAD=$(commit "$REPO_DIR" $'feat: plain change\n\nmentions Consult-Hold: t/1 in prose only')
export BASE_SHA=$BASE HEAD_SHA=$HEAD LABELS=""
arm "E untrailered (prose mention ignored)" 0 "no Consult-Hold trailers"

# label hold still enforced
export LABELS="consult-hold"
arm "LABEL consult-hold -> red" 1 "carries the 'consult-hold' label"

# A: trailer, no clearance -> red
BASE=$(mkrepo "$REPO_DIR"); HEAD=$(commit "$REPO_DIR" $'feat: gated\n\nConsult-Hold: t/4062')
export BASE_SHA=$BASE HEAD_SHA=$HEAD LABELS=""; : > "$CF"
arm "A trailer, no clearance" 1 "OUTSTANDING for t/4062"

# B: clearance comment, no label -> red
echo "HOLD CLEARED: t/4062 @$HEAD" > "$CF"
arm "B comment only, no label" 1 "label is missing"

# C: comment + label -> green
export LABELS=$'consult-hold-cleared'
arm "C comment + label" 0 "all cleared at head"

# D: clearance for the wrong ticket -> red
echo "HOLD CLEARED: t/9999 @$HEAD" > "$CF"
arm "D wrong ticket cleared" 1 "OUTSTANDING for t/4062"

# H: cleared on an OLD head, then a push -> red
echo "HOLD CLEARED: t/4062 @$HEAD" > "$CF"
NEWHEAD=$(commit "$REPO_DIR" "fix: follow-up push after clearance")
export HEAD_SHA=$NEWHEAD
arm "H cleared old head, new push" 1 "CURRENT head"

# J: two tickets, one cleared -> red (and key is case-insensitive)
BASE=$(mkrepo "$REPO_DIR")
commit "$REPO_DIR" $'a\n\nConsult-Hold: t/100' >/dev/null
HEAD=$(commit "$REPO_DIR" $'b\n\nconsult-hold: t/200')
export BASE_SHA=$BASE HEAD_SHA=$HEAD LABELS="consult-hold-cleared"
echo "HOLD CLEARED: t/100 @$HEAD" > "$CF"
arm "J two tickets, one cleared" 1 "OUTSTANDING for t/200"
printf 'HOLD CLEARED: t/100 @%s\nHOLD CLEARED: t/200 @%s\n' "$HEAD" "$HEAD" > "$CF"
arm "J' both cleared" 0 "all cleared"

# malformed trailer -> red
BASE=$(mkrepo "$REPO_DIR"); HEAD=$(commit "$REPO_DIR" $'x\n\nConsult-Hold: 4062')
export BASE_SHA=$BASE HEAD_SHA=$HEAD LABELS=""
arm "MALFORMED value" 1 "MALFORMED Consult-Hold"

# missing SHA (shallow checkout) -> red, infra wording
export BASE_SHA=0000000000000000000000000000000000000001
arm "unreachable base -> fail closed" 1 "could NOT list commits"

# G/I (API path) are CI arms; here: I = untrailered never needs comments at all
BASE=$(mkrepo "$REPO_DIR"); HEAD=$(commit "$REPO_DIR" "plain")
export BASE_SHA=$BASE HEAD_SHA=$HEAD LABELS=""; unset COMMENTS_FILE
PR_NUMBER="" REPO="" arm "I untrailered, no API inputs at all -> green" 0 "no Consult-Hold trailers"

echo "---- $pass passed, $failn failed, $ran ran"
FLOOR=12
[ "$ran" -ge "$FLOOR" ] || { echo "::error::population floor: $ran arms ran, expected >= $FLOOR"; exit 1; }
[ "$failn" -eq 0 ]
