#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# install-if-stale — session-start node_modules staleness trigger (t/2012).
#
# WHY: under the persistent-worktree model (t/2008), node_modules survives across
# sessions. When a merged dependency bump changes a lockfile, the worktree's
# node_modules goes silently STALE — the failure CI structurally CANNOT catch (CI
# runs a fresh `npm ci`; a persistent local worktree does not). This compares each
# package dir's lockfile hash against the last-installed hash and runs `npm ci` ONLY
# on change. The cheap reinstall is deliberately NOT automatic — detecting the drift
# is the point; a blind reinstall every session wastes minutes.
#
# Per-worktree: the marker lives under THIS worktree's own git dir, so each
# persistent worktree tracks its install state independently.
#
# Usage (session start, from inside your worktree):
#   sh .githooks/install-if-stale.sh                       # defaults: . taxonomy-editor
#   sh .githooks/install-if-stale.sh . lib taxonomy-editor # your verify-relevant dirs
# ─────────────────────────────────────────────────────────────────────────────
set -e

gitdir=$(git rev-parse --git-dir 2>/dev/null) || { echo "install-if-stale: not inside a git worktree" >&2; exit 2; }

dirs="$*"
[ -n "$dirs" ] || dirs=". taxonomy-editor"

for d in $dirs; do
  lock="$d/package-lock.json"
  if [ ! -f "$lock" ]; then
    lock="$d/pnpm-lock.yaml"
    [ -f "$lock" ] || { echo "install-if-stale: $d — no lockfile, skipped"; continue; }
  fi
  # Content hash of the lockfile (git blob hash; sha256 fallback if off-repo).
  h=$(git hash-object "$lock" 2>/dev/null) || h=$(sha256sum "$lock" 2>/dev/null | cut -d' ' -f1)
  key=$(printf '%s' "$d" | tr '/.' '__')
  marker="$gitdir/.last-install-$key"
  prev=$(cat "$marker" 2>/dev/null || printf '')
  if [ -n "$h" ] && [ "$h" = "$prev" ]; then
    echo "install-if-stale: $d up-to-date (lockfile unchanged)"
  else
    echo "install-if-stale: $d lockfile changed -> npm ci"
    ( cd "$d" && npm ci )
    printf '%s\n' "$h" > "$marker"
  fi
done

# ── Native-module build assertion (t/2016) ───────────────────────────────────
# `npm ci` exit 0 does NOT prove native addons built: taxonomy-editor's postinstall
# is `@electron/rebuild || exit 0`, so a failed native build (missing VS Spectre
# libs on the host; or winpty's GetCommitHash.bat returning 1 inside a LINKED
# worktree) still exits 0 — leaving a silently broken integrated terminal. Verify
# the actual node-pty .node binary; if missing, best-effort SEED it from the
# primary checkout (rebuild-in-worktree fails), then WARN loudly if still absent.
# Wrapped in set +e so this diagnostic can NEVER fail session start.
case " $dirs " in
  *" taxonomy-editor "*)
    set +e
    rel="taxonomy-editor/node_modules/node-pty/build/Release"
    if [ -d "taxonomy-editor/node_modules/node-pty" ] && [ ! -f "$rel/pty.node" ]; then
      echo "install-if-stale: taxonomy-editor node-pty native binary MISSING — attempting seed from primary checkout"
      common=$(git rev-parse --git-common-dir 2>/dev/null)
      primary=""
      [ -n "$common" ] && primary=$(cd "$common/.." 2>/dev/null && pwd)
      psrc="$primary/taxonomy-editor/node_modules/node-pty/build/Release"
      here=$(cd "$rel" 2>/dev/null && pwd)
      if [ -n "$primary" ] && [ -f "$psrc/pty.node" ] && [ "$psrc" != "$here" ]; then
        mkdir -p "$rel" && cp "$psrc"/*.node "$rel"/ 2>/dev/null && echo "  seeded node-pty .node from $psrc"
      fi
    fi
    if [ -d "taxonomy-editor/node_modules/node-pty" ] && [ ! -f "$rel/pty.node" ]; then
      echo "  WARN install-if-stale: node-pty native binary still MISSING ($rel/pty.node)." >&2
      echo "    Integrated terminal will fail. Rebuild in a LINKED worktree fails (winpty" >&2
      echo "    GetCommitHash.bat); build node-pty in the PRIMARY checkout then re-run this," >&2
      echo "    or install the VS MSVC Spectre-mitigated libs and rebuild there (t/2016)." >&2
    fi
    set -e
    ;;
esac
