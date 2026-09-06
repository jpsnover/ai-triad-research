#!/usr/bin/env python3
# Tests for demote_nonconflicts.py (t/3350). In-memory fixtures; no real corpus / no data write.
import json, sys
import demote_nonconflicts as dm


def test_load_ids_parses_cl_shape(tmp_path):
    # CL's committed shape (p/23#342): {_meta, standalone_facts:[{conflict_id, reason, provenance}]}
    p = tmp_path / "list.json"
    json.dump({"_meta": {"ticket": "t/3339", "n": 2},
               "standalone_facts": [{"conflict_id": "c-a", "reason": "standalone_fact"},
                                    {"conflict_id": "c-b", "reason": "standalone_fact"}]},
              open(p, "w", encoding="utf-8"))
    assert dm.load_ids(str(p)) == ["c-a", "c-b"]
    # also tolerant of a bare array
    p2 = tmp_path / "arr.json"; json.dump(["c-a", "c-b"], open(p2, "w", encoding="utf-8"))
    assert dm.load_ids(str(p2)) == ["c-a", "c-b"]


def _write(p, obj):
    json.dump(obj, open(p, "w", encoding="utf-8"), ensure_ascii=False)


def _corpus():
    return {"conflicts": [
        {"claim_id": "c-fact", "status": "open", "instances": [{"assertion": "39% use AI"}],
         "qbaf": {"graph": {"nodes": [{"id": "inst-0"}], "edges": []}}},               # standalone -> demote
        {"claim_id": "c-real", "status": "open", "instances": [{"a": 1}, {"a": 2}],
         "qbaf": {"graph": {"nodes": [{"id": "inst-0"}, {"id": "inst-1"}],
                            "edges": [{"source": "inst-0", "target": "inst-1", "type": "attacks"}]}}},  # real -> refuse
        {"claim_id": "c-keep", "status": "open", "instances": [{"a": 9}],
         "qbaf": {"graph": {"nodes": [{"id": "inst-0"}], "edges": []}}},               # not in list -> untouched
    ]}


def test_demote_reclassifies_and_zero_collateral(tmp_path, monkeypatch, capsys):
    corpus = _corpus()
    cpath = tmp_path / "conflicts.json"; lpath = tmp_path / "list.json"; opath = tmp_path / "out.json"
    _write(cpath, corpus)
    _write(lpath, {"standalone_facts": [{"conflict_id": "c-fact"}]})
    monkeypatch.setattr(sys, "argv", ["dm", "--list", str(lpath), "--conflicts", str(cpath), "--out", str(opath)])
    assert dm.main() == 0
    out = {c["claim_id"]: c for c in json.load(open(opath, encoding="utf-8"))["conflicts"]}
    assert out["c-fact"]["status"] == "demoted" and out["c-fact"]["claim_type"] == "non_conflict"
    assert out["c-fact"]["demotion"]["reason"] == "standalone_fact" and out["c-fact"]["demotion"]["reversible"] is True
    assert out["c-fact"]["instances"] == corpus["conflicts"][0]["instances"]  # instance KEPT (reversible)
    assert out["c-keep"] == corpus["conflicts"][2]  # untouched byte-identical
    assert "VERIFIED-CLEAN: YES" in capsys.readouterr().out


def test_safety_gate_refuses_real_conflict(tmp_path, monkeypatch, capsys):
    # A conflict WITH edges/>=2 instances in the list is NOT a standalone fact -> REFUSED, not verified-clean.
    corpus = _corpus()
    cpath = tmp_path / "c.json"; lpath = tmp_path / "l.json"; opath = tmp_path / "o.json"
    _write(cpath, corpus)
    _write(lpath, {"standalone_facts": [{"conflict_id": "c-real"}]})
    monkeypatch.setattr(sys, "argv", ["dm", "--list", str(lpath), "--conflicts", str(cpath), "--out", str(opath)])
    rc = dm.main()
    out = capsys.readouterr().out
    assert "REFUSED" in out and "c-real" in out
    assert "VERIFIED-CLEAN: NO" in out and rc == 1
    # c-real left unchanged in the sidecar (refused, not demoted)
    got = {c["claim_id"]: c for c in json.load(open(opath, encoding="utf-8"))["conflicts"]}
    assert "demotion" not in got["c-real"] and got["c-real"]["status"] == "open"


def test_write_refused_when_not_clean(tmp_path, monkeypatch):
    corpus = _corpus()
    cpath = tmp_path / "c.json"; lpath = tmp_path / "l.json"
    _write(cpath, corpus)
    _write(lpath, {"standalone_facts": [{"conflict_id": "does-not-exist"}]})  # missing -> not clean
    monkeypatch.setattr(sys, "argv", ["dm", "--write", "--list", str(lpath), "--conflicts", str(cpath)])
    assert dm.main() == 2  # refuses --write when not verified-clean


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
