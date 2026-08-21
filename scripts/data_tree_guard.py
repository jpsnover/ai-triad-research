# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.
"""Dirty-tree-sweep guard for Python data-repo writers (t/2902).

A whole-file rewrite (``json.load`` -> mutate -> ``json.dump``/``write_text``)
re-reads a file's CURRENT on-disk content -- including any concurrent
uncommitted edits -- and a later ``git add`` commits that state under a
misleading message (t/2896: commit 128ce8f4 swept an unrelated
``resolved_node_id: sit-477`` into a "stance-only" commit).

The collision is INTRA-FILE, so a path-level ``git add <file>`` gate cannot
catch it -- staging the file still captures the pre-existing WIP. The durable
guard is to assert the target file is clean vs HEAD *before* the rewrite. This
is the Python mirror of the PowerShell ``Assert-CleanDataTree`` cmdlet; keep the
two in sync.
"""
from __future__ import annotations

import os
import subprocess
import sys


class DirtyTreeError(RuntimeError):
    """Raised when a whole-file write target already carries uncommitted changes."""


def is_data_tree_clean(path) -> bool:
    """Return True when ``path`` is safe to whole-file rewrite.

    Clean (True) means: no tracked-modified changes, OR the file does not exist
    yet (a brand-new file carries nothing to sweep), OR it is not under a git
    work tree / git is unavailable (the guard defends tracked state only).
    Untracked files are ignored (``--untracked-files=no``).
    """
    path = os.fspath(path)
    if not os.path.exists(path):
        return True
    directory = os.path.dirname(os.path.abspath(path)) or "."
    leaf = os.path.basename(path)
    # Run with cwd = the file's directory and a bare-leaf pathspec so no absolute
    # path reaches git's pathspec parser (avoids MSYS path-conversion quirks --
    # see "Git Forensics" in root AGENTS.md).
    try:
        proc = subprocess.run(
            ["git", "-C", directory, "status", "--porcelain",
             "--untracked-files=no", "--", leaf],
            capture_output=True, text=True,
        )
    except (FileNotFoundError, OSError):
        return True  # git unavailable -> nothing to assert against
    if proc.returncode != 0:
        return True  # not a git work tree
    return proc.stdout.strip() == ""


def _data_write_guard_mode() -> str:
    """Resolve the guard mode from ``$AI_TRIAD_DATA_WRITE_GUARD``: ``block`` |
    ``warn`` | ``off`` (default ``warn``). Mirrors the PowerShell
    ``Get-DataWriteGuardMode`` so both languages promote together (t/2902 cond. 4:
    warn-first, then Block after a clean cycle)."""
    raw = (os.environ.get("AI_TRIAD_DATA_WRITE_GUARD") or "").strip().lower()
    if raw in ("block", "warn", "off"):
        return raw
    if raw:
        print(f"WARNING: AI_TRIAD_DATA_WRITE_GUARD='{raw}' is not block/warn/off "
              f"— defaulting to warn.", file=sys.stderr)
    return "warn"


def assert_clean_data_tree(path, force: bool = False) -> None:
    """Guard a whole-file data-repo rewrite against a dirty-tree sweep (t/2902).

    Warn-first by default; the mode comes from ``$AI_TRIAD_DATA_WRITE_GUARD``
    (mirrors the PowerShell guard so both languages promote in lockstep):
      - ``off``                       -> no-op.
      - clean target (any mode)       -> no-op.
      - dirty + ``warn`` (default)    -> stderr warning, return (does NOT raise).
      - dirty + ``block``             -> raise ``DirtyTreeError``.

    ``force=True`` opts out entirely (mirrors PowerShell ``-AllowDirty``) — for a
    writer that legitimately rewrites a target left dirty by a prior pass.
    """
    if force:
        return
    mode = _data_write_guard_mode()
    if mode == "off":
        return
    if is_data_tree_clean(path):
        return
    msg = (
        f"{path} already has uncommitted changes; a whole-file rewrite would sweep "
        f"that concurrent state into your commit (t/2902). Commit/stash it first, or "
        f"write only the fields you mean to change."
    )
    if mode == "block":
        raise DirtyTreeError(msg)
    print(f"WARNING: {msg}", file=sys.stderr)  # warn-first: surface, don't block
