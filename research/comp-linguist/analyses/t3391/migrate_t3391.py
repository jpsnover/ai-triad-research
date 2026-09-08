#!/usr/bin/env python3
"""t/3391 Option-C phase-2 migration (/data-mutation). Move logical_form.about[] `term:` refs ->
`topical_candidates` (signed-off shape), retain `ent-` in about[]. FROZEN-LIST driven (reads the committed
id list; never re-derives the target SET). Dry-run default; --apply writes. Emits the 0-collateral proof.

Signed-off shape (c-design.md #2): topical_candidates = {validated:false, generator:"formalize_node_lf.py",
golden_ref:"t/3381", blind_golden_precision:0.54, refs:[{ref, match_level}]}. Pure MOVE (match_level preserved,
not re-derived). ent- refs in about[] untouched; non-target nodes byte-untouched."""
import argparse, copy, json, os, sys
sys.stdout.reconfigure(encoding="utf-8")
D = os.environ.get("AI_TRIAD_DATA_ROOT") or r"C:\Users\jsnov\repos\ai-triad-data"
O = os.path.join(D, "taxonomy", "Origin")
FILES = ("accelerationist.json", "safetyist.json", "skeptic.json")
HERE = os.path.dirname(__file__)
TC_PROV = {"validated": False, "generator": "formalize_node_lf.py", "golden_ref": "t/3381", "blind_golden_precision": 0.54}


def _ser(data):
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def _die(msg):
    raise SystemExit(f"\nABORT (0-collateral guard): {msg}\n")


def migrate_node(lf):
    """Pure move on one node's logical_form. Returns (changed, n_moved)."""
    about = lf.get("about") or []
    term = [a for a in about if str(a.get("ref", "")).startswith("term:")]
    if not term:
        return False, 0
    ent = [a for a in about if str(a.get("ref", "")).startswith("ent-")]
    other = [a for a in about if not str(a.get("ref", "")).startswith(("term:", "ent-"))]
    if other:
        _die(f"unexpected non-ent/non-term ref in about[]: {[a.get('ref') for a in other]}")
    lf["about"] = ent  # ent- retained, order preserved
    lf["topical_candidates"] = dict(TC_PROV, refs=[{"ref": a["ref"], "match_level": a.get("match_level", "exact")} for a in term])
    return True, len(term)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frozen", default=os.path.join(HERE, "t3391-frozen.json"))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    frozen_ids = {r["node_id"] for r in json.load(open(args.frozen, encoding="utf-8"))["frozen"]}
    print(f"frozen target nodes: {len(frozen_ids)}")

    total_changed = total_moved = 0
    for fn in FILES:
        p = os.path.join(O, fn)
        raw = open(p, encoding="utf-8").read()
        data = json.loads(raw)
        # Guard A — byte-identical serializer: our writer must round-trip the live file exactly,
        # else --apply would reflow the whole file (massive false diff). Abort if not.
        if _ser(data) != raw:
            _die(f"{fn}: serializer not byte-identical to live file — do NOT write (would reflow).")
        before = copy.deepcopy(data)
        changed = moved = 0
        target_ids_in_file = set()
        for n in data["nodes"]:
            if n.get("id") not in frozen_ids:
                continue
            lf = n.get("logical_form")
            if not lf:
                _die(f"{fn}: frozen node {n.get('id')} has no logical_form")
            c, m = migrate_node(lf)
            if c:
                changed += 1; moved += m; target_ids_in_file.add(n.get("id"))
        # Guard B — structural: node count/order unchanged; every NON-target node deep-equal.
        if [n.get("id") for n in data["nodes"]] != [n.get("id") for n in before["nodes"]]:
            _die(f"{fn}: node id order/count changed")
        for nb, na in zip(before["nodes"], data["nodes"]):
            if na.get("id") in target_ids_in_file:
                continue
            if nb != na:
                _die(f"{fn}: NON-target node {na.get('id')} changed — collateral!")
        # Guard C — per-target: about[] lost exactly its term: refs, gained correct topical_candidates,
        # ent- refs unchanged, everything else in the node deep-equal.
        for nb, na in zip(before["nodes"], data["nodes"]):
            if na.get("id") not in target_ids_in_file:
                continue
            lb, la = nb["logical_form"], na["logical_form"]
            ent_b = [a for a in (lb.get("about") or []) if str(a.get("ref", "")).startswith("ent-")]
            term_b = [a for a in (lb.get("about") or []) if str(a.get("ref", "")).startswith("term:")]
            if la["about"] != ent_b:
                _die(f"{na.get('id')}: about[] != original ent- refs")
            tc = la.get("topical_candidates")
            if not tc or {k: tc.get(k) for k in TC_PROV} != TC_PROV:
                _die(f"{na.get('id')}: topical_candidates provenance block wrong")
            if [r["ref"] for r in tc["refs"]] != [a["ref"] for a in term_b]:
                _die(f"{na.get('id')}: moved refs != original term: refs")
            # everything else in the node identical (compare with about/topical_candidates neutralized)
            lb2, la2 = copy.deepcopy(lb), copy.deepcopy(la)
            lb2["about"] = None; la2["about"] = None
            lb2.pop("topical_candidates", None); la2.pop("topical_candidates", None)
            nb2, na2 = copy.deepcopy(nb), copy.deepcopy(na)
            nb2["logical_form"] = lb2; na2["logical_form"] = la2
            if nb2 != na2:
                _die(f"{na.get('id')}: node changed outside about[]/topical_candidates")
        print(f"  {fn}: {changed} nodes migrated, {moved} term: refs moved (0 collateral asserted)")
        total_changed += changed; total_moved += moved
        if args.apply:
            open(p, "w", encoding="utf-8").write(_ser(data))

    print(f"\nTOTAL: {total_changed} nodes, {total_moved} term: refs moved.")
    print("0-collateral proof: PASS (byte-identical serializer, node order/count intact, all non-targets deep-equal, per-target pure-move verified).")
    print("APPLIED (data written)" if args.apply else "DRY RUN — no data written. --apply to write (after PI authorization + TL second-agent verify).")


if __name__ == "__main__":
    raise SystemExit(main())
