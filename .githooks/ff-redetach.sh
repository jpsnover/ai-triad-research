#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# ff-redetach — safely re-sync a persistent per-role worktree onto origin/main (t/2009 §a).
#
# The retire-shared-checkout model (t/2008): each role works in a PERSISTENT worktree
# sitting at detached origin/main + ephemeral per-task PR branches. Between tasks the
# worktree must be re-synced to the latest origin/main — but NEVER by a hard reset or a
# bare `git checkout --detach` that would silently DISCARD uncommitted or unlanded work
# (the exact wipe-class this migration exists to kill, Sage #93 / t/1926).
#
# This helper is FAIL-SAFE (the opposite of the pre-commit hook's fail-open): on ANY
# doubt it REFUSES and surfaces the refuse-when-dirty playbook, rather than discard.
# It only re-detaches when the worktree is clean AND not ahead of origin/main.
#
# Usage (session start, from inside your worktree):  sh .githooks/ff-redetach.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ff-redetach: not inside a git worktree" >&2; exit 2; }

git fetch origin >&2 || { echo "ff-redetach: fetch failed — resolve network/auth and retry (nothing changed)" >&2; exit 2; }

# Dirty tree (staged, unstaged, or untracked) → refuse; re-detaching would discard it.
if [ -n "$(git status --porcelain)" ]; then
  cat >&2 <<'MSG'

  ✖ ff-redetach REFUSED: the worktree is DIRTY (uncommitted / untracked work).
    Re-detaching would discard it. Land or stash first, then re-run:
      git switch -c <type>/<slug>-t<ticket>   # name the branch → commit → land via PR
      #  or:  git stash push -u -m "wip <ticket>"   (recover later: git stash pop)
    (refuse-when-dirty playbook, ADR §3a — this helper never discards.)
MSG
  exit 1
fi

# Ahead of origin/main (local commits not yet on origin) → refuse; would orphan them.
ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo unknown)
if [ "$ahead" != "0" ]; then
  cat >&2 <<'MSG'

  ✖ ff-redetach REFUSED: HEAD is AHEAD of origin/main (unlanded local commits).
    Re-detaching would orphan them. Land them via a PR branch first:
      git switch -c <type>/<slug>-t<ticket>   # if not already on a named branch
      git push origin <branch>  →  gh pr create  →  self-merge on green
    Then re-run ff-redetach.
MSG
  exit 1
fi

# Clean AND not ahead → safe to re-detach onto the freshly-fetched origin/main.
git checkout --detach origin/main
echo "ff-redetach: re-detached onto origin/main ($(git rev-parse --short HEAD))" >&2
