#!/usr/bin/env python3
"""Option C PS<->Python parity: assert formalize_node_lf.validate() produces the exact split the
shared cross-port fixture specifies (analyses/t3389-option-c/optionc-parity-fixture.json). This is the
Python arm of the t/3409 item-4 parity contract; PowerShell writes the mirror arm against the SAME
fixture so both ports are proven identical (the `generator` provenance field is per-port and tolerated).
Skips cleanly when the data repo is absent (formalize_node_lf loads entities.json at import)."""
import importlib.util
import json
import os
import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_FIXTURE = os.path.join(_HERE, "..", "analyses", "t3389-option-c", "optionc-parity-fixture.json")


def _load_module():
    spec = importlib.util.spec_from_file_location("flf", os.path.join(_HERE, "formalize_node_lf.py"))
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except (FileNotFoundError, OSError) as e:
        pytest.skip(f"data repo not available for formalize_node_lf import: {e}")
    return mod


flf = _load_module()
_FIX = json.load(open(_FIXTURE, encoding="utf-8"))
_ALLOWED = {ref: (v["sort"], v["match_level"]) for ref, v in _FIX["allowlist"].items()}
_PARITY = _FIX["_meta"]["provenance_parity_fields"]
_PROV = _FIX["_meta"]["provenance_expected"]


def _run(about):
    lf = {"predicate": "x", "args": [], "about": about, "polarity": "positive",
          "temporal": {"type": "unspecified", "value": None}, "formalization_confidence": 0.9}
    return flf.validate(lf, dict(_ALLOWED), _FIX["_meta"]["camp"], _FIX["_meta"]["category"])


@pytest.mark.parametrize("case", _FIX["cases"], ids=[c["name"] for c in _FIX["cases"]])
def test_python_matches_parity_fixture(case):
    lf = _run([dict(a) for a in case["input_about"]])

    # about[] membership: ref + match_level, order-insensitive
    got_about = sorted((a["ref"], a["match_level"]) for a in lf["about"])
    exp_about = sorted((a["ref"], a["match_level"]) for a in case["expected_about"])
    assert got_about == exp_about, f"{case['name']}: about[] mismatch"

    exp_tc = case["expected_topical_candidates_refs"]
    if exp_tc is None:
        assert "topical_candidates" not in lf, f"{case['name']}: topical_candidates must be ABSENT (not null)"
    else:
        tc = lf["topical_candidates"]
        got_refs = sorted((r["ref"], r["match_level"]) for r in tc["refs"])
        assert got_refs == sorted((r["ref"], r["match_level"]) for r in exp_tc), f"{case['name']}: topical_candidates.refs mismatch"
        # provenance parity fields (generator is tolerated/per-port, not asserted here)
        for f in _PARITY:
            assert tc[f] == _PROV[f], f"{case['name']}: provenance.{f} mismatch"


def test_generator_field_is_python_identity():
    """The one tolerated field: Python's generator identity (PS asserts its own)."""
    tc = _run([{"ref": "term:regulation_precautionary", "match_level": "universal"}])["topical_candidates"]
    assert tc["generator"] == "formalize_node_lf.py"
