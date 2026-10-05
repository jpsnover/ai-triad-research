#!/usr/bin/env python3
"""Regression tests for formalize_node_lf.validate() about[] / topical_candidates handling.

Option C (t/3389, SO+TL signed off e/145#13-#16): the mixed-convention about[] MISSED the
pre-committed concept-anchored floor (0.636 < 0.80, t/3381), so about[] reverts to **ent-* only**
and term: concept refs move to `topical_candidates` — a quality-marked layer (provenance block
carries validated:false + the 0.54 blind-golden precision so the unvalidated status is legible
from the data alone). match_level is enum-clamped on both so a concept's sort=`universal` can never
leak in (the t/3379 leak). The module loads entities.json at import, so we skip cleanly when the
data repo is absent (mirrors validation.data.test.ts)."""
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
    return flf.validate(lf, ALLOWED, "acc", "Beliefs")


def test_concept_ref_routed_to_topical_candidates():
    """Option C: a term: concept ref leaves about[] and lands in topical_candidates.refs, with
    match_level='universal' (the concept's sort leaking in) clamped to the authoritative 'exact'."""
    lf = _run([{"ref": "term:regulation_precautionary", "match_level": "universal"}])
    assert lf["about"] == []  # ent-only
    assert lf["topical_candidates"]["refs"] == [{"ref": "term:regulation_precautionary", "match_level": "exact"}]


def test_topical_candidates_carries_the_quality_provenance():
    """The marking gate (e/145#13-#16): the layer's unvalidated status is legible FROM THE DATA."""
    tc = _run([{"ref": "term:regulation_precautionary", "match_level": "exact"}])["topical_candidates"]
    assert tc["validated"] is False
    assert tc["generator"] == "formalize_node_lf.py"
    assert tc["golden_ref"] == "t/3381"
    assert tc["blind_golden_precision"] == 0.54


def test_entity_ref_stays_in_about_ent_only():
    """ent-* refs stay in about[] with the authoritative register match_level; no topical_candidates."""
    lf = _run([{"ref": "ent-x", "match_level": "exact"}])  # model says exact; register says instance_of
    assert lf["about"] == [{"ref": "ent-x", "match_level": "instance_of"}]  # authoritative wins
    assert "topical_candidates" not in lf  # absent, not null (t/2943), when no concept refs


def test_ungrounded_ref_dropped():
    lf = _run([{"ref": "ent-hallucinated", "match_level": "exact"}])
    assert lf["about"] == []  # R6 / t/2294 — never mint a ref not in the node's own refs
    assert "topical_candidates" not in lf


def test_split_mixed_ent_to_about_term_to_candidates():
    lf = _run([{"ref": "ent-034", "match_level": "exact"},
               {"ref": "term:regulation_precautionary", "match_level": "universal"}])
    assert [a["ref"] for a in lf["about"]] == ["ent-034"]
    assert [a["ref"] for a in lf["topical_candidates"]["refs"]] == ["term:regulation_precautionary"]
    assert all(a["match_level"] in flf.VALID_MATCH_LEVELS for a in lf["about"] + lf["topical_candidates"]["refs"])


def test_empty_about_no_topical_candidates_key():
    lf = _run([])
    assert lf["about"] == []
    assert "topical_candidates" not in lf


# t/3884 source cleaning: the PROPOSITION is label + main clause, never the scope notes or the wrapper.
_SCOPED = ("A Belief within skeptic discourse that provenance metadata is destroyed in distribution.\n"
           "Encompasses: the cost of maintaining systems that fail together.\n"
           "Excludes: the claim that provenance is impossible.")


def test_scope_notes_stripped():
    flf.LEGACY_SOURCE = False
    out = flf.strip_scope_notes(flf.strip_discourse_wrapper(_SCOPED))
    assert out == "Provenance metadata is destroyed in distribution."


def test_scope_notes_absent_is_noop():
    flf.LEGACY_SOURCE = False
    assert flf.strip_scope_notes("Mandates favor incumbents.") == "Mandates favor incumbents."


def test_multiword_camp_wrapper_stripped():
    """skp-desires-075: 'within skeptic and safetyist discourse that' (the v3 \\w+ pattern missed it)."""
    flf.LEGACY_SOURCE = False
    desc = "A Desire within skeptic and safetyist discourse that prioritizes aligning AI with public values."
    assert flf.strip_discourse_wrapper(desc) == "Prioritizes aligning AI with public values."


def test_legacy_source_reproduces_v3_input():
    """--legacy-source keeps the scope notes and the single-word wrapper rule, for A/B dry-run arms."""
    flf.LEGACY_SOURCE = True
    try:
        assert "Encompasses:" in flf.strip_scope_notes(_SCOPED)
        multi = "A Desire within skeptic and safetyist discourse that prioritizes X."
        assert flf.strip_discourse_wrapper(multi) == multi
    finally:
        flf.LEGACY_SOURCE = False
