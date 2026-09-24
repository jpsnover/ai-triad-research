#!/bin/sh
# read-workflow-mode.sh — single source of truth for the workflow-mode switch (t/3638).
# Echoes EXACTLY "direct" or "worktree" to stdout (nothing else, no trailing newline).
#
# ── CANONICAL PARSE RULE (parity contract — t/3638, TL condition p/331#1286) ──────────
# There are THREE consumers of .orca/workflow-mode: this shell helper (used by the two
# githooks) and the two Node feedback-rule `run:` scripts, which read the file directly —
# a `run:` script cannot call this helper. ALL THREE MUST PARSE IDENTICALLY, or the mode
# file means different things at different enforcement points (this ticket's own drift
# class, one layer down). The rule, verbatim, for any reimplementer to match:
#
#   Take LINE 1 of .orca/workflow-mode. Strip leading and trailing whitespace. Compare the
#   WHOLE trimmed line, case-sensitively, to the exact string "direct". IFF it equals
#   "direct" → mode is `direct`. EVERYTHING ELSE → `worktree`:
#     missing file, unreadable, empty, "banana", "Direct"/"DIRECT", "direct foo" (extra
#     tokens — NOT first-token), a leading '#', etc.
#   Comments live on line 2+ ONLY; line 1 is the bare mode word.
#
# ── FAIL-SAFE (load-bearing — t/3638) ─────────────────────────────────────────────────
# Default is `worktree` (strict), relaxed ONLY by an explicit well-formed `direct`. Every
# failure path — missing/unreadable file, git error, odd invocation — resolves to
# `worktree`. A deleted or corrupted file must TIGHTEN, never loosen: inverted, a `cat`
# failure would silently disable fleet-wide protection with no signal.
mode=worktree
f="$(git rev-parse --show-toplevel 2>/dev/null)/.orca/workflow-mode"
if [ -r "$f" ]; then
  line1=$(sed -n '1p' "$f" 2>/dev/null)
  # trim leading + trailing whitespace (POSIX); WHOLE-line exact compare, NOT first-token.
  trimmed=$(printf '%s' "$line1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  [ "$trimmed" = "direct" ] && mode=direct
fi
printf '%s' "$mode"
