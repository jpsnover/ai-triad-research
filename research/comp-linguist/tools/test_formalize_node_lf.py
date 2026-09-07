#!/usr/bin/env python3
"""Regression tests for formalize_node_lf.validate() about[] handling (t/3379).

Option A (SO-ratified, e/145): about[] is a mixed topical index that keeps BOTH ent-* and term:
refs; its match_level is enum-clamped to EntityMatchLevel so a concept's sort=`universal` can
never leak into about[].match_level (the t/3379 recurrence). The module loads entities.json at
import, so we skip cleanly when the data repo is absent (mirrors validation.data.test.ts)."""
import importlib.util
import os
import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))


def _load_module():
    spec = importlib.util.spec_from_file_location("flf", os.path.join(_HERE, "formalize_node_lf.py"))
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)  # import-time load of entities.json
    except (FileNotFoundError, OSError) as e:
        pytest.skip(f"data repo not available for formalize_node_lf import: {e}")
    return mod


flf = _load_module()

# term:* concept ref -> ("universal", "exact"); ent-* -> (dolce_sort, entity_match_level)
ALLOWED = {
    "ent-034": ("agentive-physical-object", "exact"),
    "term:regulation_precautionary": ("universal", "exact"),
    "ent-x": ("perdurant", "instance_of"),
}


def _run(about):
    lf = {"predicate": "x", "args": [], "about": about, "polarity": "positive",
          "temporal": {"type": "unspecified", "value": None}, "formalization_confidence": 0.9}
    return flf.validate(lf, ALLOWED, "acc", "Beliefs")["about"]


def test_concept_ref_kept_and_universal_clamped():
    """t/3379: a term: concept about-ref survives (Option A), and match_level='universal'
    (the concept's sort leaking in) is clamped to the authoritative 'exact'."""
    out = _run([{"ref": "term:regulation_precautionary", "match_level": "universal"}])
    assert out == [{"ref": "term:regulation_precautionary", "match_level": "exact"}]


def test_entity_ref_kept_with_authoritative_match_level():
    out = _run([{"ref": "ent-x", "match_level": "exact"}])  # model says exact; register says instance_of
    assert out == [{"ref": "ent-x", "match_level": "instance_of"}]  # authoritative wins


def test_ungrounded_ref_dropped():
    out = _run([{"ref": "ent-hallucinated", "match_level": "exact"}])
    assert out == []  # R6 / t/2294 — never mint a ref not in the node's own refs


def test_mixed_index_preserved():
    out = _run([{"ref": "ent-034", "match_level": "exact"},
                {"ref": "term:regulation_precautionary", "match_level": "universal"}])
    refs = [a["ref"] for a in out]
    assert refs == ["ent-034", "term:regulation_precautionary"]
    assert all(a["match_level"] in flf.VALID_MATCH_LEVELS for a in out)
