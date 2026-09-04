#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""Neutrality tests for _finalize_qbaf's resolution margin floor (t/3151).

CL neutrality ruling (t/3151#2): a top-runner-up computed_strength gap below
QBAF_MARGIN_FLOOR (0.05) is not a meaningful separation, so the resolution is an
explicit `undecided` with `prevailing_claim: null` -- never the first-listed
default the stable sort used to crown on a perfect tie. Runs under pytest or
standalone: `python test_enrich_conflicts_qbaf.py`.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import enrich_conflicts_qbaf as eq  # noqa: E402


def _finalize(strengths):
    """Run _finalize_qbaf over two instances with the given computed strengths."""
    pre = {
        "qbaf_nodes_output": [
            {"id": "inst-0", "computed_strength": 0.0},
            {"id": "inst-1", "computed_strength": 0.0},
        ],
        "edge_output": [],
    }
    bridge_result = {"strengths": strengths, "iterations": 1}
    return eq._finalize_qbaf(pre, bridge_result)["resolution"]


def test_margin_at_or_above_floor_is_decided():
    r = _finalize({"inst-0": 0.90, "inst-1": 0.20})
    assert r["verdict"] == "decided"
    assert r["prevailing_claim"] == "inst-0"
    assert r["prevailing_strength"] == 0.90
    assert r["margin"] == 0.70


def test_margin_below_floor_is_undecided_not_first_listed():
    r = _finalize({"inst-0": 0.50, "inst-1": 0.48})  # margin 0.02 < 0.05
    assert r["verdict"] == "undecided"
    assert r["prevailing_claim"] is None
    assert r["prevailing_strength"] is None
    assert r["margin"] == 0.02
    assert "floor" in r["reason"]


def test_perfect_tie_is_undecided_not_inst_0():
    # The original defect: Python's stable sort silently crowned the first-listed
    # instance (inst-0) with margin 0.0. It must now be an explicit undecided.
    r = _finalize({"inst-0": 0.50, "inst-1": 0.50})
    assert r["verdict"] == "undecided"
    assert r["prevailing_claim"] is None
    assert r["margin"] == 0.0


def test_floor_boundary_exactly_005_is_decided():
    # margin == floor is decided (strict `<` gates undecided).
    r = _finalize({"inst-0": 0.55, "inst-1": 0.50})  # margin exactly 0.05
    assert r["margin"] == 0.05
    assert r["verdict"] == "decided"
    assert r["prevailing_claim"] == "inst-0"


# ---------------------------------------------------------------------------
# _detect_edges — same-doc filter behavior (t/3214)
# ---------------------------------------------------------------------------

def _inst(stance, doc_id, attack_type=None):
    i = {"stance": stance, "doc_id": doc_id}
    if attack_type:
        i["attack_type"] = attack_type
    return i


def test_same_non_debate_doc_produces_no_edge():
    # Two instances from the same paper — duplicates, not independent positions.
    instances = [
        _inst("supports", "some-paper-2026"),
        _inst("disputes", "some-paper-2026"),
    ]
    assert eq._detect_edges(instances) == []


def test_same_debate_doc_opposing_stances_produces_edge():
    # Two instances from the same debate session — independent agent positions.
    instances = [
        _inst("supports", "debate:7e272d3b-4ec0-409d-8095-be4b5bf97b9a"),
        _inst("disputes", "debate:7e272d3b-4ec0-409d-8095-be4b5bf97b9a", attack_type="rebut"),
    ]
    edges = eq._detect_edges(instances)
    assert len(edges) == 1
    assert edges[0]["type"] == "attacks"
    assert edges[0]["attack_type"] == "rebut"


def test_different_docs_opposing_stances_produces_edge():
    # Cross-document conflict — always produced edges (existing behavior preserved).
    instances = [
        _inst("supports", "doc-a-2026"),
        _inst("disputes", "doc-b-2026"),
    ]
    edges = eq._detect_edges(instances)
    assert len(edges) == 1
    assert edges[0]["type"] == "attacks"


def test_same_debate_doc_same_stance_produces_support_edge():
    # Two supporters in the same debate — count as corroborating support.
    instances = [
        _inst("supports", "debate:abc-123"),
        _inst("supports", "debate:abc-123"),
    ]
    edges = eq._detect_edges(instances)
    assert len(edges) == 1
    assert edges[0]["type"] == "supports"


# _qbaf_testedness — observability metric (t/3302)

def _qbaf(nodes, edges):
    return {"graph": {"nodes": nodes, "edges": edges}}


def test_testedness_all_prior_when_no_edges():
    q = _qbaf([{"id": "inst-0"}, {"id": "inst-1"}], [])
    tm = eq._qbaf_testedness(q, [_inst("supports", "d1"), _inst("supports", "d2")])
    assert tm["testedness"] == "all_prior"
    assert tm["n_edges"] == 0 and tm["n_attack_edges"] == 0
    assert tm["n_untested_nodes"] == 2          # nothing attacked
    assert tm["has_opposing_stances"] is False
    assert tm["stance_hist"] == {"supports": 2}


def test_testedness_support_only_when_edges_but_no_attacks():
    q = _qbaf([{"id": "inst-0"}, {"id": "inst-1"}],
              [{"source": "inst-0", "target": "inst-1", "type": "supports"}])
    tm = eq._qbaf_testedness(q, [_inst("supports", "d1"), _inst("supports", "d2")])
    assert tm["testedness"] == "support_only"
    assert tm["n_support_edges"] == 1 and tm["n_attack_edges"] == 0
    assert tm["n_untested_nodes"] == 2          # no attacks → all untested


def test_testedness_adversarial_when_attack_present():
    q = _qbaf([{"id": "inst-0"}, {"id": "inst-1"}],
              [{"source": "inst-0", "target": "inst-1", "type": "attacks"}])
    tm = eq._qbaf_testedness(q, [_inst("supports", "d1"), _inst("disputes", "d2")])
    assert tm["testedness"] == "adversarial"
    assert tm["n_attack_edges"] == 1
    assert tm["n_untested_nodes"] == 1          # inst-1 attacked, inst-0 not
    assert tm["has_opposing_stances"] is True
    assert tm["stance_hist"] == {"supports": 1, "disputes": 1}


if __name__ == "__main__":
    import pytest

    sys.exit(pytest.main([__file__, "-v"]))
