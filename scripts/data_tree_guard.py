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


# BLOCK-tier targets by basename (t/2909, TL ruling t/2909#3). Kept in LOCKSTEP with
# the PowerShell guard's $script:BlockTierFiles (Assert-DataWriteAllowed.ps1) — update
# both together. BLOCK = low-traffic / usually-clean / high-sensitivity files; every
# other data file is WARN tier (high-traffic perpetually-dirty; durable fix = field-
# surgical writes, t/2916).
_BLOCK_TIER_FILES = frozenset({
    "situations.json",
    "organization_stance_claims.json",
    "policy_actions.json",
    "organizations.json",
    "organization_edges.json",
    "entities.json",
    "entity_mentions.json",
    # NOTE: .debate-index.json is intentionally WARN, not BLOCK (t/2909#5 GV): the
    # debate flow (lib/debate/debateIndex.ts) rewrites it every run -> perpetually
    # dirty, so Block would false-fire on the occasional PS repair.
})


def _data_write_guard_mode(path=None) -> str:
    """Resolve the guard mode for a TARGET path: ``block`` | ``warn`` | ``off``.
    Priority: ``$AI_TRIAD_DATA_WRITE_GUARD`` (global override) > per-target TIER
    (block for a BLOCK-tier basename, else warn). Mirrors the PowerShell
    ``Get-DataWriteGuardMode`` so both languages stay in lockstep (t/2909#3)."""
    raw = (os.environ.get("AI_TRIAD_DATA_WRITE_GUARD") or "").strip().lower()
    if raw in ("block", "warn", "off"):
        return raw
    if raw:
        print(f"WARNING: AI_TRIAD_DATA_WRITE_GUARD='{raw}' is not block/warn/off "
              f"— falling back to the per-target tier.", file=sys.stderr)
    if path is not None and os.path.basename(os.fspath(path)) in _BLOCK_TIER_FILES:
        return "block"
    return "warn"


def assert_clean_data_tree(
    path, force: bool = False, surgical_write: bool = False
) -> None:
    """Guard a whole-file data-repo rewrite against a dirty-tree sweep (t/2902).

    Warn-first by default; the mode comes from ``$AI_TRIAD_DATA_WRITE_GUARD``
    (mirrors the PowerShell guard so both languages promote in lockstep):
      - ``off``                       -> no-op.
      - clean target (any mode)       -> no-op.
      - dirty + ``warn`` (default)    -> stderr warning, return (does NOT raise).
      - dirty + ``block``             -> raise ``DirtyTreeError``.

    ``force=True`` opts out entirely (mirrors PowerShell ``-AllowDirty``) — for a
    writer that legitimately rewrites a target left dirty by a prior pass.

    ``surgical_write=True`` is a DISTINCT, semantically-honest exemption for a
    field-surgical writer (t/2926, mirrors PowerShell ``-SurgicalWrite``). Its claim
    is NOT "ignore the dirty tree" but "this write is sweep-proof by construction, so
    the dirty-tree check is N/A." Kept separate from ``force`` on purpose: the two
    carry different risk profiles, and a grep for ``surgical_write=True`` must not
    conflate "provably safe surgical" with "blanket override — scrutinise." Reachable
    only via an allowlisted writer (enforced by the detection gate in
    SurgicalWriteExemption.Tests.ps1), so a whole-file writer cannot claim it and
    bypass the BLOCK tier.
    """
    if surgical_write:
        return
    if force:
        return
    mode = _data_write_guard_mode(path)   # per-target tier (t/2909)
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
