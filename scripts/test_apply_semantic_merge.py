#!/usr/bin/env python3
# Tests for apply_semantic_merge.py (t/3339 census-merge). No real corpus / no bridge subprocess:
# the DF-QuAD bridge call is monkeypatched; a tiny in-memory fixture exercises the merge + verifier.
import json, os, sys
import apply_semantic_merge as m


def test_mk_attack_pair_is_symmetric_and_tagged():
    edges = m._mk_attack_pair(0, 1, "llm", 0.93, 0.90)
    assert len(edges) == 2
    assert {(e["source"], e["target"]) for e in edges} == {("inst-0", "inst-1"), ("inst-1", "inst-0")}
    for e in edges:
        assert e["type"] == "attacks" and e["symmetric"] is True
        assert e["claim_origin"] == "observed" and e["edge_origin"] == "semantic"
        assert e["register"] == "t/3342" and e["classifier"] == "enrichment.contradiction-classify"
        assert e["confidence"] == 0.93 and e["tau"] == 0.90


def _write(p, obj):
    json.dump(obj, open(p, "w", encoding="utf-8"), ensure_ascii=False)


def test_merge_applies_only_manifest_and_zero_collateral(tmp_path, monkeypatch, capsys):
    # fixture corpus: c-same (2-instance, same-doc target), c-untouched (must stay byte-identical)
    conflicts = {"conflicts": [
        {"claim_id": "c-same", "claim_label": "s", "instances": [{"a": 1}, {"a": 2}],
         "qbaf": {"graph": {"nodes": [{"id": "inst-0", "base_strength": 0.6, "computed_strength": 0.6},
                                       {"id": "inst-1", "base_strength": 0.6, "computed_strength": 0.6}],
                            "edges": []}, "computed_at": "orig", "algorithm": "DF-QuAD", "iterations": 3}},
        {"claim_id": "c-untouched", "claim_label": "u", "instances": [{"a": 9}],
         "qbaf": {"graph": {"nodes": [{"id": "inst-0", "base_strength": 0.6, "computed_strength": 0.6}],
                            "edges": []}, "computed_at": "orig", "algorithm": "DF-QuAD", "iterations": 1}},
    ]}
    manifest = {"_meta": {"tau": 0.90},
                "same_doc": [{"conflict_id": "c-same", "source": "inst-0", "target": "inst-1",
                              "confidence": 0.95, "detector": "llm"}],
                "cross_conflict": [{"pair_id": "xc-1", "stance_conflict_id": "sc", "stance_text": "A",
                                    "cand_conflict_id": "cc", "cand_inst_idx": 0, "cand_text": "B",
                                    "confidence": 0.92}]}
    cpath = tmp_path / "conflicts.json"; mpath = tmp_path / "manifest.json"; opath = tmp_path / "out.json"
    _write(cpath, conflicts); _write(mpath, manifest)

    # stub the bridge — deterministic strengths, no subprocess
    monkeypatch.setattr(m, "_run_bridge_batch",
                        lambda graphs: [{"strengths": {n["id"]: 0.44 for n in g["nodes"]}, "iterations": 5}
                                        for g in graphs])
    monkeypatch.setattr(sys, "argv", ["apply", "--conflicts", str(cpath), "--manifest", str(mpath),
                                      "--out", str(opath)])
    rc = m.main()
    assert rc == 0
    out = json.load(open(opath, encoding="utf-8"))["conflicts"]
    by = {c["claim_id"]: c for c in out}
    # same-doc: 2 symmetric attack edges added + strengths recomputed
    assert len(by["c-same"]["qbaf"]["graph"]["edges"]) == 2
    assert by["c-same"]["qbaf"]["graph"]["nodes"][0]["computed_strength"] == 0.44
    # cross-conflict: a new 2-node conflict appended, claim_origin observed
    assert "xmerge-xc-1" in by and by["xmerge-xc-1"]["claim_origin"] == "observed"
    assert len(by["xmerge-xc-1"]["qbaf"]["graph"]["edges"]) == 2
    # untouched conflict byte-identical
    assert by["c-untouched"] == conflicts["conflicts"][1]
    captured = capsys.readouterr().out
    assert "VERIFIED-CLEAN: YES" in captured and "ZERO" in captured


def test_write_refused_when_manifest_id_missing(tmp_path, monkeypatch):
    conflicts = {"conflicts": [{"claim_id": "c1", "instances": [], "qbaf": {"graph": {"nodes": [], "edges": []}}}]}
    manifest = {"_meta": {"tau": 0.90},
                "same_doc": [{"conflict_id": "does-not-exist", "source": "inst-0", "target": "inst-1",
                              "confidence": 0.95, "detector": "llm"}],
                "cross_conflict": []}
    cpath = tmp_path / "c.json"; mpath = tmp_path / "m.json"
    _write(cpath, conflicts); _write(mpath, manifest)
    monkeypatch.setattr(m, "_run_bridge_batch", lambda graphs: [])
    monkeypatch.setattr(sys, "argv", ["apply", "--write", "--conflicts", str(cpath), "--manifest", str(mpath)])
    rc = m.main()
    assert rc == 2  # refuses --write when not verified-clean (missing manifest id)


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
