#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# check-hub-clean — classify dirty state in a git work tree (t/2066).
#
# Distinguishes shell-escaping corruption (zero-byte junk) from real WIP, and
# phantom/stale modifications (already landed or explained by being behind
# origin/main) from genuine uncommitted work.
#
# Discriminator (t/2066#12):
#   ZERO-BYTE — 0-byte untracked file; shell-escaping artifact, safe to delete
#   PHANTOM   — tracked modification where `git diff origin/main -- <file>` is
#               empty; the change already landed upstream, hub just needs a pull
#   STALE     — tracked modification whose divergence from origin/main is fully
#               explained by being behind: most-recent commit touching the file
#               is in origin/main but NOT yet an ancestor of HEAD
#   WIP       — genuine uncommitted work: non-zero untracked, or tracked
#               modification not explained by phantom/stale logic
#
# Usage:
#   check-hub-clean.sh            # exits 1 if real WIP; 0 if only junk/phantom/stale
#   check-hub-clean.sh --advisory # always exits 0 (warn-only; for post-merge hook)
#
# Exit codes:
#   0 — no real WIP (may have ZERO-BYTE/PHANTOM/STALE entries — see stderr)
#   1 — real WIP found (ff-redetach must refuse; manual triage required)
#   2 — git introspection error (caller should fail-open)
# ─────────────────────────────────────────────────────────────────────────────
set -e

ADVISORY=0
[ "${1:-}" = "--advisory" ] && ADVISORY=1

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  printf "check-hub-clean: not inside a git work tree\n" >&2; exit 2
}
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 2

# Quick exit when the tree is already clean
[ -z "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ] && exit 0

# ── Per-file classifier ───────────────────────────────────────────────────────

zero_byte=""
phantom=""
stale=""
wip_list=""

classify_tracked() {
  f="$1"
  # Require origin/main to be resolvable; fall back to WIP (conservative).
  if ! git -C "$REPO_ROOT" rev-parse origin/main >/dev/null 2>&1; then
    wip_list="${wip_list}    WIP     $f (origin/main not reachable — triage manually)\n"
    return
  fi
  # Rule 1: empty diff vs origin/main → phantom (already landed upstream).
  if git -C "$REPO_ROOT" diff --quiet origin/main -- "$f" 2>/dev/null; then
    phantom="${phantom}    PHANTOM $f\n"
    return
  fi
  # Rule 2: non-empty diff — check whether the divergence is staleness or WIP.
  # If the most-recent commit that touches $f on origin/main is NOT yet an
  # ancestor of HEAD, origin/main advanced past HEAD on that file → STALE.
  last=$(git -C "$REPO_ROOT" log -1 --format='%H' origin/main -- "$f" 2>/dev/null)
  if [ -n "$last" ] && ! git -C "$REPO_ROOT" merge-base --is-ancestor "$last" HEAD 2>/dev/null; then
    stale="${stale}    STALE   $f\n"
  else
    wip_list="${wip_list}    WIP     $f\n"
  fi
}

# ── Parse git status --porcelain ─────────────────────────────────────────────
# Write to a temp file inside .git/ so the main loop runs in the parent shell
# (not a subshell), allowing variable assignments to persist.
gitdir=$(git -C "$REPO_ROOT" rev-parse --git-dir 2>/dev/null) || exit 2
# git rev-parse --git-dir is relative to CWD; make it absolute
case "$gitdir" in /*) ;; *) gitdir="$REPO_ROOT/$gitdir" ;; esac
tmpf="$gitdir/check-hub-clean-$$"
git -C "$REPO_ROOT" status --porcelain 2>/dev/null > "$tmpf"

while IFS= read -r line; do
  [ -z "$line" ] && continue
  xy=$(printf '%s' "$line" | cut -c1-2)
  filepath=$(printf '%s' "$line" | cut -c4-)

  # git may quote filenames containing non-ASCII or certain control chars.
  # Strip outer double-quotes if present (simple case; embedded \" not handled).
  case "$filepath" in
    '"'*'"') filepath=$(printf '%s' "$filepath" | sed 's/^"\(.*\)"$/\1/') ;;
  esac
  # Rename notation "old -> new": use the destination path only.
  case "$filepath" in
    *' -> '*) filepath=${filepath##*' -> '} ;;
  esac

  if [ "$xy" = "??" ]; then
    # Untracked: zero-byte = shell-escaping junk; anything else = potential WIP.
    target="$REPO_ROOT/$filepath"
    if [ -e "$target" ] && [ ! -d "$target" ] && [ ! -s "$target" ]; then
      zero_byte="${zero_byte}    ZERO-BYTE $filepath\n"
    else
      wip_list="${wip_list}    WIP     $filepath\n"
    fi
  else
    classify_tracked "$filepath"
  fi
done < "$tmpf"
rm -f "$tmpf"

# ── Report ────────────────────────────────────────────────────────────────────

has_output=0
if [ -n "$wip_list" ]; then
  printf "\n  ✖ check-hub-clean: REAL WIP — land or stash before re-syncing:\n%b" "$wip_list" >&2
  has_output=1
fi
if [ -n "$stale" ]; then
  printf "\n  ⚠ check-hub-clean: STALE — divergence explained by HEAD being behind origin/main:\n%b" "$stale" >&2
  has_output=1
fi
if [ -n "$phantom" ]; then
  printf "\n  ℹ check-hub-clean: PHANTOM — already matches origin/main (safe: git restore --):\n%b" "$phantom" >&2
  has_output=1
fi
if [ -n "$zero_byte" ]; then
  printf "\n  ℹ check-hub-clean: ZERO-BYTE junk — shell-escaping artifacts (delete per owner):\n%b" "$zero_byte" >&2
  has_output=1
fi
[ "$has_output" = "1" ] && printf "\n" >&2

[ "$ADVISORY" = "1" ] && exit 0
[ -n "$wip_list" ] && exit 1
exit 0
