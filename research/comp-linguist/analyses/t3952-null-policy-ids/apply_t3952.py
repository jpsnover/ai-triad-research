#!/usr/bin/env python3
"""t/3952: assign registry ids to the 6 null policy_ids in frozen.json, and (optionally) correct the two stale
member_counts. /data-mutation discipline: the target set comes ONLY from frozen.json; dry-run is the default.

Usage:
  python apply_t3952.py --data <ai-triad-data root>                     # dry-run, ids only
  python apply_t3952.py --data <root> --with-member-counts              # dry-run, ids + member_count fixes
  python apply_t3952.py --data <root> [--with-member-counts] --apply    # write

Why not `Update-PolicyRegistry -Fix`: it also rebuilds every member_count corpus-wide and rewrites whole files
via ConvertTo-Json; this script changes exactly the frozen entries and proves 0 collateral before writing.
"""
import argparse, copy, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FROZEN = json.load(open(os.path.join(HERE, "frozen.json"), encoding="utf-8"))
POV_FILES = ["accelerationist", "safetyist", "skeptic", "situations"]


def dumps(o):
    return json.dumps(o, indent=2, ensure_ascii=False) + "\n"


def load(path):
    raw = open(path, encoding="utf-8", newline="").read()
    data = json.loads(raw)
    if dumps(data) != raw:
        sys.exit(f"ABORT: {path} does not round-trip byte-identically under the house serializer")
    return raw, data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--with-member-counts", action="store_true")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    tax = os.path.join(a.data, "taxonomy", "Origin")

    files = {f: load(os.path.join(tax, f + ".json")) for f in POV_FILES}
    reg_raw, reg = load(os.path.join(tax, "policy_actions.json"))
    before_files = {f: copy.deepcopy(d) for f, (_, d) in files.items()}
    before_reg = copy.deepcopy(reg)

    # Pre-state must match the frozen list exactly; new ids must be unused anywhere.
    used = {p["id"] for p in reg["policies"]}
    for f, (_, d) in files.items():
        for n in d["nodes"]:
            for pa in (n.get("graph_attributes") or {}).get("policy_actions") or []:
                if pa.get("policy_id"): used.add(pa["policy_id"])
    for e in FROZEN["assign"]:
        if e["new_id"] in used: sys.exit(f"ABORT: {e['new_id']} already in use")
        node = next((n for n in files[e["file"]][1]["nodes"] if n["id"] == e["node_id"]), None)
        if node is None: sys.exit(f"ABORT: {e['node_id']} not in {e['file']}.json")
        pa = node["graph_attributes"]["policy_actions"][e["index"]]
        if pa.get("policy_id") is not None or pa["action"] != e["action"]:
            sys.exit(f"ABORT: {e['node_id']}[{e['index']}] does not match frozen pre-state: {pa}")

    # Write the ids onto the nodes (value change only; key order preserved, policy_id stays first).
    for e in FROZEN["assign"]:
        node = next(n for n in files[e["file"]][1]["nodes"] if n["id"] == e["node_id"])
        node["graph_attributes"]["policy_actions"][e["index"]]["policy_id"] = e["new_id"]

    # Register them: the 5-key shape of the newest entries, inserted at the string-sorted position.
    pov_of = {"skeptic": "skeptic", "situations": "situations"}
    for e in FROZEN["assign"]:
        reg["policies"].append({"id": e["new_id"], "action": e["action"], "source_povs": [pov_of[e["file"]]], "member_count": 1, "status": "active"})
    reg["policies"].sort(key=lambda p: p["id"])
    reg["policy_count"] = len(reg["policies"])

    mc = FROZEN["member_count_corrections"] if a.with_member_counts else []
    for c in mc:
        p = next(p for p in reg["policies"] if p["id"] == c["policy_id"])
        if p["member_count"] != c["from"]: sys.exit(f"ABORT: {c['policy_id']} member_count is {p['member_count']}, frozen says {c['from']}")
        p["member_count"] = c["to"]

    # ── 0-collateral proof (structural) ──
    changed_nodes = {(e["file"], e["node_id"]) for e in FROZEN["assign"]}
    for f in POV_FILES:
        b, d = before_files[f], files[f][1]
        if [k for k in b] != [k for k in d] or len(b["nodes"]) != len(d["nodes"]): sys.exit(f"ABORT: {f} structure changed")
        for nb, nd in zip(b["nodes"], d["nodes"]):
            if nb["id"] != nd["id"]: sys.exit(f"ABORT: {f} node order changed")
            if (f, nb["id"]) in changed_nodes:
                pb, pd = nb["graph_attributes"]["policy_actions"], nd["graph_attributes"]["policy_actions"]
                rest_b = {k: v for k, v in nb.items() if k != "graph_attributes"}
                rest_d = {k: v for k, v in nd.items() if k != "graph_attributes"}
                gab = {k: v for k, v in nb["graph_attributes"].items() if k != "policy_actions"}
                gad = {k: v for k, v in nd["graph_attributes"].items() if k != "policy_actions"}
                if rest_b != rest_d or gab != gad: sys.exit(f"ABORT: {nb['id']} changed outside policy_actions")
                for x, y in zip(pb, pd):
                    if {k: v for k, v in x.items() if k != "policy_id"} != {k: v for k, v in y.items() if k != "policy_id"}:
                        sys.exit(f"ABORT: {nb['id']} action/framing changed")
            elif nb != nd:
                sys.exit(f"ABORT: non-target node {nb['id']} changed")
    new_ids = {e["new_id"] for e in FROZEN["assign"]}
    mc_ids = {c["policy_id"] for c in mc}
    old = {p["id"]: p for p in before_reg["policies"]}
    for p in reg["policies"]:
        if p["id"] in new_ids: continue
        if p["id"] in mc_ids:
            if {k: v for k, v in p.items() if k != "member_count"} != {k: v for k, v in old[p["id"]].items() if k != "member_count"}:
                sys.exit(f"ABORT: {p['id']} changed beyond member_count")
        elif p != old[p["id"]]:
            sys.exit(f"ABORT: non-target registry entry {p['id']} changed")
    if {k: v for k, v in reg.items() if k not in ("policies", "policy_count")} != {k: v for k, v in before_reg.items() if k not in ("policies", "policy_count")}:
        sys.exit("ABORT: registry header changed")

    # ── textual check: count changed lines per file ──
    import difflib
    out = {f: dumps(files[f][1]) for f in POV_FILES}
    out["policy_actions"] = dumps(reg)
    src = {f: files[f][0] for f in POV_FILES}
    src["policy_actions"] = reg_raw
    for f in out:
        d = [l for l in difflib.unified_diff(src[f].splitlines(), out[f].splitlines(), lineterm="", n=0) if l[:1] in "+-" and l[:3] not in ("+++", "---")]
        print(f"{f}.json: {sum(l[0] == '-' for l in d)} lines removed, {sum(l[0] == '+' for l in d)} added")
    print(f"0-collateral: PASS | ids assigned: {len(FROZEN['assign'])} | registry {len(before_reg['policies'])} -> {len(reg['policies'])}"
          f" | member_count corrections: {len(mc)}")

    if not a.apply:
        print("dry-run: nothing written (pass --apply to write)")
        return
    for f in ("skeptic", "situations"):
        open(os.path.join(tax, f + ".json"), "w", encoding="utf-8", newline="").write(out[f])
    open(os.path.join(tax, "policy_actions.json"), "w", encoding="utf-8", newline="").write(out["policy_actions"])
    print("APPLIED: skeptic.json, situations.json, policy_actions.json")


if __name__ == "__main__":
    main()
