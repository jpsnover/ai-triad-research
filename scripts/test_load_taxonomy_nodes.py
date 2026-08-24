#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""Regression tests for embed_taxonomy._load_taxonomy_nodes (t/2875).

A stray `nodes`-bearing file whose entries are not POV nodes (e.g.
entity_extraction_log.json — log entries keyed `node_id`, not `id`) must NOT
take the embeddings pipeline down with a KeyError. Two arms:

  1. entity_extraction_log.json is name-skipped via SKIP_FILES (this incident).
  2. any OTHER stray nodes-file whose entries lack `id` is shape-skipped with a
     stderr warning (the durable, t/1652-class fix).

Both cases fail on the pre-fix loader (the bogus nodes are ingested → the test's
`id` read raises / count mismatch) and pass after the fix.

Runnable under pytest or standalone: `python test_load_taxonomy_nodes.py`.
"""

import contextlib
import importlib.util
import io
import json
import tempfile
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "embed_taxonomy", Path(__file__).resolve().parent / "embed_taxonomy.py"
)
embed_taxonomy = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(embed_taxonomy)


def _write(dir_path: Path, name: str, obj) -> None:
    (dir_path / name).write_text(json.dumps(obj), encoding="utf-8")


def _valid_pov_file(dir_path: Path) -> None:
    _write(dir_path, "accelerationist.json", {
        "nodes": [
            {"id": "acc-beliefs-001", "label": "A", "description": "Desc A"},
            {"id": "acc-beliefs-002", "label": "B", "description": "Desc B"},
        ]
    })


def _run_loader(dir_path: Path):
    """Point the module at dir_path, capture stderr, return (nodes, stderr)."""
    saved = embed_taxonomy.TAXONOMY_DIR
    embed_taxonomy.TAXONOMY_DIR = Path(dir_path)
    try:
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            nodes = embed_taxonomy._load_taxonomy_nodes()
        return nodes, buf.getvalue()
    finally:
        embed_taxonomy.TAXONOMY_DIR = saved


def test_entity_extraction_log_is_name_skipped():
    """Arm 1: entity_extraction_log.json is skipped by name — no crash, no bogus nodes."""
    with tempfile.TemporaryDirectory() as d:
        dp = Path(d)
        _valid_pov_file(dp)
        # The t/2875 shape: log entries keyed node_id, not id.
        _write(dp, "entity_extraction_log.json", {
            "nodes": [
                {"node_id": "acc-beliefs-001", "ts": "2026-07-28T00:00:00Z"},
                {"node_id": "acc-beliefs-002", "ts": "2026-07-28T00:00:01Z"},
            ]
        })
        nodes, _ = _run_loader(dp)

    assert len(nodes) == 2, f"expected only the 2 POV nodes, got {len(nodes)}"
    assert sorted(n["id"] for _, n in nodes) == ["acc-beliefs-001", "acc-beliefs-002"]
    assert all(pov == "accelerationist" for pov, _ in nodes)


def test_stray_nodes_file_is_shape_skipped_with_warning():
    """Arm 2: a differently-named stray nodes-file (entries lack id) is skipped with a warning."""
    with tempfile.TemporaryDirectory() as d:
        dp = Path(d)
        _valid_pov_file(dp)
        _write(dp, "stray_nodes.json", {
            "nodes": [{"node_id": "x-1"}, {"node_id": "x-2"}]
        })
        nodes, stderr = _run_loader(dp)

    assert len(nodes) == 2, f"expected only the 2 POV nodes, got {len(nodes)}"
    assert sorted(n["id"] for _, n in nodes) == ["acc-beliefs-001", "acc-beliefs-002"]
    # The skip must be observable (ADR-001 silent-degradation rule).
    assert "stray_nodes.json" in stderr
    assert "lack 'id'" in stderr


def test_empty_nodes_file_does_not_warn():
    """A file with an empty `nodes` list is legal — no false shape-guard warning."""
    with tempfile.TemporaryDirectory() as d:
        dp = Path(d)
        _valid_pov_file(dp)
        _write(dp, "safetyist.json", {"nodes": []})
        nodes, stderr = _run_loader(dp)

    assert len(nodes) == 2
    assert "lack 'id'" not in stderr


if __name__ == "__main__":
    test_entity_extraction_log_is_name_skipped()
    test_stray_nodes_file_is_shape_skipped_with_warning()
    test_empty_nodes_file_does_not_warn()
    print("OK: all _load_taxonomy_nodes regression tests passed")
