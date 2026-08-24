#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""Unit tests for nli_classify.py — the shared directional-agreement engine (t/2751).

Exercises the engine's OWN logic (framing plumbing, label->direction mapping, the
tau_contra floor, and the fail-safe) WITHOUT the deberta model by monkeypatching
the classifier embed_taxonomy exposes. `test_richness_guard_real_model` adds the
GV richness arm on the actual model (skips offline): node-proposition richness —
NOT framing — is what catches an inversion (CL 2x2, t/2744#7). Together they guard
mapping/fail-safe/richness so the gate can never regress unnoticed.

Runnable under pytest or standalone: `python test_nli_classify.py`.
"""

import importlib.util
import sys
from pathlib import Path

_DIR = Path(__file__).resolve().parent


def _load(name):
    spec = importlib.util.spec_from_file_location(name, _DIR / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# Register embed_taxonomy in sys.modules BEFORE loading nli_classify, so the
# deferred `from embed_taxonomy import ...` inside judge_direction resolves to
# THIS instance — the one the tests monkeypatch — not a fresh real import.
embed_taxonomy = _load("embed_taxonomy")
sys.modules["embed_taxonomy"] = embed_taxonomy
nli_classify = _load("nli_classify")

# Real deberta driver, saved before any monkeypatch — the richness guard restores
# these to run against the actual model (it skips if the model can't load).
_REAL_LOAD = embed_taxonomy._load_nli_model
_REAL_CLASSIFY = embed_taxonomy._classify_pairs_nli


def _stub_classifier(result_for):
    """Install a fake deberta driver keyed by a marker in the hypothesis text."""
    embed_taxonomy._load_nli_model = lambda: object()

    def fake(model, pairs):
        out = []
        for (_a, b) in pairs:
            out.append(result_for(b))
        return out

    embed_taxonomy._classify_pairs_nli = fake


def _res(label, margin):
    return {"label": label, "entailment": 0.0, "neutral": 0.0,
            "contradiction": 0.0, "margin": margin}


def test_framing_is_applied_and_single_sourced():
    _stub_classifier(lambda b: _res("contradiction", 1.3))
    out = nli_classify.judge_direction(
        [{"id": "p", "claim_prop": "ordinary law applies",
          "claim_pov": "accelerationist", "node_prop": "AI needs new laws",
          "node_pov": "accelerationist"}])
    assert out[0]["framed_a"] == "The accelerationist position is: ordinary law applies"
    assert out[0]["framed_b"] == "The accelerationist position is: AI needs new laws"
    assert out[0]["direction"] == "opposes"


def test_label_to_direction_mapping():
    cases = [("contradiction", 1.3, "opposes"),
             ("entailment", 5.0, "agrees"),
             ("neutral", 4.0, "unrelated")]
    for label, margin, expected in cases:
        _stub_classifier(lambda b, _l=label, _m=margin: _res(_l, _m))
        out = nli_classify.judge_direction(
            [{"claim_prop": "a", "node_prop": "b"}])
        assert out[0]["direction"] == expected, (label, out[0]["direction"])


def test_tau_contra_floor_downgrades_weak_contradiction_to_unresolved():
    # A contradiction below tau_contra must NOT emit a (false) opposes.
    _stub_classifier(lambda b: _res("contradiction", 0.5))
    out = nli_classify.judge_direction(
        [{"claim_prop": "a", "node_prop": "b"}], tau_contra=1.0)
    assert out[0]["direction"] == "unresolved"


def test_failsafe_on_engine_error_is_unresolved_never_opposes():
    def boom():
        raise RuntimeError("model unavailable")
    embed_taxonomy._load_nli_model = boom
    out = nli_classify.judge_direction([{"claim_prop": "a", "node_prop": "b"}])
    assert out[0]["direction"] == "unresolved"
    assert out[0]["method"] == "none"


def test_empty_proposition_is_unresolved_without_calling_model():
    def boom(*_a, **_k):
        raise AssertionError("model must not be called for an empty proposition")
    embed_taxonomy._load_nli_model = boom
    out = nli_classify.judge_direction([{"claim_prop": "a", "node_prop": ""}])
    assert out[0]["direction"] == "unresolved"
    assert out[0]["method"] == "none"


def test_no_framing_passes_raw_text():
    # Plumbing only: --no-framing must feed the raw prop (no "The <pov> position
    # is:" prefix) to the classifier. NOTE: framing is INERT on the verdict
    # (CL t/2744#7 2x2) — the semantic lever is node richness, guarded by
    # test_richness_guard_real_model below. This test just pins the flag's wiring.
    captured = {}

    def fake(model, pairs):
        captured["pairs"] = pairs
        return [_res("entailment", 5.0) for _ in pairs]
    embed_taxonomy._load_nli_model = lambda: object()
    embed_taxonomy._classify_pairs_nli = fake

    out = nli_classify.judge_direction(
        [{"claim_prop": "raw claim", "claim_pov": "accelerationist",
          "node_prop": "raw node"}], no_framing=True)
    assert captured["pairs"][0] == ("raw claim", "raw node")  # no prefix
    assert out[0]["direction"] == "agrees"


def test_richness_guard_real_model():
    """The GV richness arm (TL bless t/2744#8, replaces the moot framing arm).

    node-proposition RICHNESS — not framing — is what catches an inversion
    (CL 2x2, t/2744#7). Same origin claim, vary the node_prop:
      bare  (label only)     -> agrees   (MISSES the inversion)
      rich  (label + Core)   -> opposes  (CATCHES it)
    Real deberta; skips when the model can't load (offline CI). The margins are
    the tau_contra calibration anchor (rich ~1.3, matching CL's ~1.42).
    """
    # Restore the real driver (earlier tests monkeypatched it).
    embed_taxonomy._load_nli_model = _REAL_LOAD
    embed_taxonomy._classify_pairs_nli = _REAL_CLASSIFY
    try:
        _REAL_LOAD()
    except Exception as exc:  # noqa: BLE001 — model unavailable => skip, not fail
        print("SKIP test_richness_guard_real_model — model unavailable:", exc)
        return

    claim = ("rejecting AI exceptionalism ensures existing privacy principles "
             "remain the baseline for technological deployment without requiring "
             "novel regulatory regimes.")
    label = "Argue That AI Requires Entirely New Laws, Not Adapted Old Ones"
    core = ("asserts emerging technologies are so transformative they require "
            "entirely new legal frameworks rather than adapted existing laws.")
    out = nli_classify.judge_direction([
        {"id": "bare", "claim_prop": claim, "claim_pov": "accelerationist",
         "node_prop": label, "node_pov": "accelerationist"},
        {"id": "rich", "claim_prop": claim, "claim_pov": "accelerationist",
         "node_prop": "{} — {}".format(label, core), "node_pov": "accelerationist"},
    ])
    by = {r["id"]: r for r in out}
    assert by["bare"]["direction"] == "agrees", by["bare"]     # bare node MISSES
    assert by["rich"]["direction"] == "opposes", by["rich"]    # rich node CATCHES
    assert by["rich"]["confidence"] >= 1.0                     # >= tau_contra


def test_ids_and_order_preserved():
    _stub_classifier(lambda b: _res("neutral", 2.0))
    items = [{"id": "first", "claim_prop": "a", "node_prop": "b"},
             {"claim_prop": "c", "node_prop": "d"}]  # second: no id -> index
    out = nli_classify.judge_direction(items)
    assert out[0]["id"] == "first"
    assert out[1]["id"] == 1


def test_empty_input_returns_empty():
    assert nli_classify.judge_direction([]) == []


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print("ok", fn.__name__)
    print("\nAll {} tests passed.".format(len(fns)))
