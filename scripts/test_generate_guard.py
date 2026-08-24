#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""Regression tests for the t/2877 generate corpus-completeness guard.

`_assert_corpus_complete` fails loud when `generate` would ship a corpus missing a
node class the source contains (the silent-degradation class from the t/2875 recovery).
Pure — no model encode — so both arms run fast under pytest or standalone:
  `python test_generate_guard.py`.
"""

import importlib.util
import json
import tempfile
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "embed_taxonomy", Path(__file__).resolve().parent / "embed_taxonomy.py"
)
embed_taxonomy = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(embed_taxonomy)


def _make_conflicts_dir(tmp: Path, n: int) -> Path:
    (tmp / "conflicts.json").write_text(
        json.dumps({"conflicts": [{"claim_id": f"c{i}"} for i in range(n)]}),
        encoding="utf-8",
    )
    return tmp


def test_passes_when_counts_match():
    """PASS arm: conflicts source resolves and corpus count == source entries."""
    with tempfile.TemporaryDirectory() as d:
        cdir = _make_conflicts_dir(Path(d), 5)
        embed_taxonomy._assert_corpus_complete(10, 5, cdir, False)  # must not raise


def test_fires_on_unresolved_conflicts_dir():
    """FIRE arm (the incident): conflicts_dir does not resolve → abort, name the fix."""
    with tempfile.TemporaryDirectory() as d:
        missing = Path(d) / "does-not-exist"
        try:
            embed_taxonomy._assert_corpus_complete(10, 0, missing, False)
        except ValueError as e:
            assert "did not resolve" in str(e)
            assert "--conflicts-dir" in str(e)
        else:
            raise AssertionError("expected ValueError for unresolved conflicts dir")


def test_allow_missing_conflicts_opt_out():
    """A legitimately conflict-free run passes with the explicit opt-out."""
    with tempfile.TemporaryDirectory() as d:
        missing = Path(d) / "does-not-exist"
        embed_taxonomy._assert_corpus_complete(10, 0, missing, True)  # must not raise


def test_fires_on_partial_drop():
    """FIRE arm (TL condition 1): exact-count — a PARTIAL drop must also abort."""
    with tempfile.TemporaryDirectory() as d:
        cdir = _make_conflicts_dir(Path(d), 5)
        try:
            embed_taxonomy._assert_corpus_complete(10, 4, cdir, False)  # 4 != 5
        except ValueError as e:
            assert "count mismatch" in str(e)
            assert "4" in str(e) and "5" in str(e)
        else:
            raise AssertionError("expected ValueError for a partial conflict drop")


def test_fires_on_zero_nodes():
    """FIRE arm: an empty POV node set is always an error."""
    with tempfile.TemporaryDirectory() as d:
        cdir = _make_conflicts_dir(Path(d), 5)
        try:
            embed_taxonomy._assert_corpus_complete(0, 5, cdir, False)
        except ValueError as e:
            assert "0 taxonomy POV nodes" in str(e)
        else:
            raise AssertionError("expected ValueError for 0 nodes")


def test_conflicts_dir_override_resolves():
    """Root-cause fix: --conflicts-dir wins over config/fallback resolution."""
    saved = (embed_taxonomy.TAXONOMY_DIR, embed_taxonomy.EMBEDDINGS_FILE, embed_taxonomy.CONFLICTS_DIR)
    try:
        with tempfile.TemporaryDirectory() as d:
            cdir = Path(d) / "myconflicts"
            cdir.mkdir()
            embed_taxonomy._resolve_taxonomy_dir(
                override=str(Path(d) / "taxonomy"), conflicts_override=str(cdir)
            )
            assert embed_taxonomy.CONFLICTS_DIR == cdir.resolve()
    finally:
        embed_taxonomy.TAXONOMY_DIR, embed_taxonomy.EMBEDDINGS_FILE, embed_taxonomy.CONFLICTS_DIR = saved


if __name__ == "__main__":
    test_passes_when_counts_match()
    test_fires_on_unresolved_conflicts_dir()
    test_allow_missing_conflicts_opt_out()
    test_fires_on_partial_drop()
    test_fires_on_zero_nodes()
    test_conflicts_dir_override_resolves()
    print("OK: all t/2877 generate-guard tests passed")
