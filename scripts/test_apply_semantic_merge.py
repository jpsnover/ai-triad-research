#!/usr/bin/env python3
# Tests for apply_semantic_merge.py (t/3339#25 verified-edge write). No real corpus / no bridge
# subprocess: the DF-QuAD bridge is monkeypatched; a tiny in-memory fixture exercises merge + verifier.
import json, sys
import apply_semantic_merge as m


def test_mk_attack_pair_symmetric_and_tagged_semantic_cluster():
    edges = m._mk_attack_pair(0, 1, 0.95, 0.90)
    assert len(edges) == 2
    assert {(e["source"], e["target"]) for e in edges} == {("inst-0", "inst-1"), ("inst-1", "inst-0")}
    for e in edges:
        assert e["type"] == "attacks" and e["symmetric"] is True
        assert e["claim_origin"] == "observed" and e["edge_origin"] == "semantic-cluster"
        assert e["detector"] == "llm" and e["register"] == "t/3342"
        assert e["classifier"] == "enrichment.contradiction-classify"
        assert e["confidence"] == 0.95 and e["tau"] == 0.90


def _write(p, obj):
    json.dump(obj, open(p, "w", encoding="utf-8"), ensure_ascii=False)


def _fixture(tmp_path):
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
                              "confidence": 0.95, "detector": "llm"},
                             {"conflict_id": "c-same", "source": "inst-0", "target": "inst-1",
                              "confidence": 1.0, "detector": "llm", "trivially_valid": True}],
                "cross_conflict": [{"pair_id": "xc-1", "stance_conflict_id": "sc", "stance_text": "A",
                                    "cand_conflict_id": "cc", "cand_inst_idx": 0, "cand_text": "B",
                                    "confidence": 0.92}]}
    cpath = tmp_path / "conflicts.json"; mpath = tmp_path / "manifest.json"
    _write(cpath, conflicts); _write(mpath, manifest)
    return conflicts, cpath, mpath


def test_merge_applies_only_manifest_and_zero_collateral(tmp_path, monkeypatch, capsys):
    conflicts, cpath, mpath = _fixture(tmp_path)
    opath = tmp_path / "out.json"
    monkeypatch.setattr(m, "_run_bridge_batch",
                        lambda graphs: [{"strengths": {n["id"]: 0.44 for n in g["nodes"]}, "iterations": 5}
                                        for g in graphs])
    monkeypatch.setattr(sys, "argv", ["apply", "--conflicts", str(cpath), "--manifest", str(mpath),
                                      "--out", str(opath)])
    assert m.main() == 0
    out = json.load(open(opath, encoding="utf-8"))["conflicts"]
    by = {c["claim_id"]: c for c in out}
    assert len(by["c-same"]["qbaf"]["graph"]["edges"]) == 2  # symmetric edges (dup manifest row deduped)
    assert by["c-same"]["qbaf"]["graph"]["nodes"][0]["computed_strength"] == 0.44
    assert "xmerge-xc-1" in by and by["xmerge-xc-1"]["claim_origin"] == "observed"
    assert by["c-untouched"] == conflicts["conflicts"][1]  # byte-identical
    assert "VERIFIED-CLEAN: YES" in capsys.readouterr().out


def test_drop_trivial_skips_flagged_edge(tmp_path, monkeypatch, capsys):
    _, cpath, mpath = _fixture(tmp_path)
    opath = tmp_path / "out.json"
    monkeypatch.setattr(m, "_run_bridge_batch",
                        lambda graphs: [{"strengths": {}, "iterations": 1} for g in graphs])
    monkeypatch.setattr(sys, "argv", ["apply", "--drop-trivial", "--conflicts", str(cpath),
                                      "--manifest", str(mpath), "--out", str(opath)])
    assert m.main() == 0
    out = capsys.readouterr().out
    assert "same-doc edges skipped" in out and "c-same" in out.split("skipped")[1][:40]


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
    assert m.main() == 2  # refuses --write when not verified-clean (missing manifest id)


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
