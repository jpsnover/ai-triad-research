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


# _detect_numeric_temporal_conflict — deterministic complement (t/3302 fork-B, TL's mandatory
# high-precision detector). Conservative: subject overlap + same-kind disjoint quantities.

def test_numeric_conflicting_percentages_same_subject():
    assert eq._detect_numeric_temporal_conflict(
        "Compute among safety labs grew 30 percent last year",
        "Compute among safety labs grew 10 percent last year") is True


def test_numeric_same_percentage_no_conflict():
    assert eq._detect_numeric_temporal_conflict(
        "Compute among safety labs grew 30 percent last year",
        "Compute among safety labs grew 30 percent last year") is False


def test_numeric_different_subject_no_conflict():
    # Different percentages but the subjects don't overlap (<3 shared content words) -> no fire.
    assert eq._detect_numeric_temporal_conflict(
        "GDP rose 30 percent", "unemployment fell 10 percent") is False


def test_temporal_conflicting_years_same_subject():
    assert eq._detect_numeric_temporal_conflict(
        "The superintelligence ban takes effect by 2027 under this act",
        "The superintelligence ban takes effect by 2030 under this act") is True


def test_bare_numbers_conflict_requires_strong_overlap():
    # 4+ shared content words + disjoint bare numbers -> conflict.
    assert eq._detect_numeric_temporal_conflict(
        "The frontier training run used 3 data centers in the cluster",
        "The frontier training run used 7 data centers in the cluster") is True


def test_bare_numbers_weak_overlap_no_conflict():
    # Disjoint numbers but too few shared words -> no fire (subject gate not met).
    assert eq._detect_numeric_temporal_conflict(
        "labs used 3 chips", "labs used 7 servers") is False


# detect_semantic_edges + enrich_conflict extra_edges — fork-B wiring (t/3302, AI mocked)

def _si(stance, doc, text):
    return {"stance": stance, "doc_id": doc, "assertion": text}


def test_detect_semantic_edges_numeric_and_llm():
    to_process = [
        (None, {"claim_id": "c0", "instances": [
            _si("neutral", "d1", "compute among safety labs grew 30 percent last year"),
            _si("neutral", "d2", "compute among safety labs grew 10 percent last year")]}),
        (None, {"claim_id": "c1", "instances": [
            _si("neutral", "d1", "cats are calm household pets"),
            _si("neutral", "d2", "dogs are loud household pets")]}),
    ]
    # Only c1's pair (id "1:0:1") reaches the LLM (c0 is caught by the numeric detector first).
    def runner(batch, mode, temp):
        ids = {p["id"] for c in batch for p in c["pairs"]}
        assert ids == {"1:0:1"}, f"numeric pair must not reach the LLM; got {ids}"
        return {"1:0:1": {"label": "contradict", "confidence": 0.9}}
    by_ci = eq.detect_semantic_edges(to_process, min_confidence=0.5, mode="per-conflict", cc_runner=runner)
    assert by_ci[0][0]["detector"] == "numeric" and by_ci[0][0]["type"] == "attacks"
    assert by_ci[1][0]["detector"] == "llm" and by_ci[1][0]["type"] == "attacks"
    assert by_ci[1][0]["confidence"] == 0.9


def test_detect_semantic_edges_entail_is_support():
    to_process = [(None, {"claim_id": "c0", "instances": [
        _si("neutral", "d1", "the model reduces latency"),
        _si("neutral", "d2", "the model cuts latency")]})]
    runner = lambda batch, mode, temp: {"0:0:1": {"label": "entail", "confidence": 0.8}}
    by_ci = eq.detect_semantic_edges(to_process, min_confidence=0.5, cc_runner=runner)
    assert by_ci[0][0]["type"] == "supports"
    assert by_ci[0][0]["detector"] == "llm"


def test_detect_semantic_edges_low_confidence_dropped():
    to_process = [(None, {"claim_id": "c0", "instances": [
        _si("neutral", "d1", "alpha beta gamma"),
        _si("neutral", "d2", "delta epsilon zeta")]})]
    runner = lambda batch, mode, temp: {"0:0:1": {"label": "contradict", "confidence": 0.2}}
    by_ci = eq.detect_semantic_edges(to_process, min_confidence=0.5, cc_runner=runner)
    assert by_ci == {}  # below threshold -> no edge


def test_enrich_conflict_merges_extra_edges_with_provenance():
    conflict = {"instances": [_si("neutral", "d1", "aaa"), _si("neutral", "d2", "bbb")]}
    extra = [{"source": "inst-0", "target": "inst-1", "type": "attacks", "weight": 0.6,
              "attack_type": "rebut", "detector": "llm", "edge_origin": "semantic", "confidence": 0.77}]
    pre = eq.enrich_conflict(conflict, {}, extra_edges=extra)
    assert pre.get("_needs_bridge") is True   # extra edge -> needs propagation
    eo = pre["edge_output"][0]
    assert eo["detector"] == "llm" and eo["edge_origin"] == "semantic" and eo["confidence"] == 0.77


# Provenance + benefit-arm predictions sink — fork-B corpus-write conditions (t/3302#24, t/3336)

def test_semantic_edge_provenance_classifier_and_tau():
    to_process = [
        (None, {"claim_id": "c0", "instances": [
            _si("neutral", "d1", "compute among safety labs grew 30 percent last year"),
            _si("neutral", "d2", "compute among safety labs grew 10 percent last year")]}),
        (None, {"claim_id": "c1", "instances": [
            _si("neutral", "d1", "cats are calm household pets"),
            _si("neutral", "d2", "dogs are loud household pets")]}),
    ]
    runner = lambda batch, mode, temp: {"1:0:1": {"label": "contradict", "confidence": 0.9}}
    by_ci = eq.detect_semantic_edges(to_process, min_confidence=0.9, mode="per-conflict", cc_runner=runner)
    # LLM edge carries classifier id + τ (TL GV cond 1)
    llm_edge = by_ci[1][0]
    assert llm_edge["classifier"] == eq._CC_USAGE_ID
    assert llm_edge["tau"] == 0.9
    # numeric edge carries τ but NO classifier (deterministic detector)
    num_edge = by_ci[0][0]
    assert num_edge["detector"] == "numeric"
    assert num_edge["tau"] == 0.9
    assert "classifier" not in num_edge


def test_predictions_sink_captures_numeric_and_llm():
    to_process = [
        (None, {"claim_id": "c0", "instances": [
            _si("neutral", "d1", "compute among safety labs grew 30 percent last year"),
            _si("neutral", "d2", "compute among safety labs grew 10 percent last year")]}),
        (None, {"claim_id": "c1", "instances": [
            _si("neutral", "d1", "cats are calm household pets"),
            _si("neutral", "d2", "dogs are loud household pets")]}),
    ]
    runner = lambda batch, mode, temp: {"1:0:1": {"label": "contradict", "confidence": 0.9, "method": "llm-batch"}}
    sink = []
    eq.detect_semantic_edges(to_process, min_confidence=0.9, mode="per-conflict",
                             cc_runner=runner, predictions_sink=sink)
    assert len(sink) == 2  # one numeric candidate + one llm candidate, none dropped
    by_conf = {p["conflict_id"]: p for p in sink}
    num = by_conf["c0"]
    assert num["predicted"] == "contradict" and num["confidence"] == 1.0 and num["method"] == "numeric"
    assert num["source"] == "inst-0" and num["target"] == "inst-1"
    llm = by_conf["c1"]
    assert llm["predicted"] == "contradict" and llm["confidence"] == 0.9 and llm["method"] == "llm-batch"


def test_predictions_sink_records_raw_pre_tau():
    # A below-threshold contradict produces NO edge but is still recorded raw in the sink (CL applies τ).
    to_process = [(None, {"claim_id": "c0", "instances": [
        _si("neutral", "d1", "alpha beta gamma"),
        _si("neutral", "d2", "delta epsilon zeta")]})]
    runner = lambda batch, mode, temp: {"0:0:1": {"label": "contradict", "confidence": 0.2, "method": "llm-batch"}}
    sink = []
    by_ci = eq.detect_semantic_edges(to_process, min_confidence=0.9, cc_runner=runner, predictions_sink=sink)
    assert by_ci == {}  # below τ -> no edge
    assert len(sink) == 1 and sink[0]["predicted"] == "contradict" and sink[0]["confidence"] == 0.2


if __name__ == "__main__":
    import pytest

    sys.exit(pytest.main([__file__, "-v"]))
