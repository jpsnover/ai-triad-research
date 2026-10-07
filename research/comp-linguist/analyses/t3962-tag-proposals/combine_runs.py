#!/usr/bin/env python3
"""t/4066: combine two independent justify-v3 runs (A, B) into the value_basis that the review queue shows.

PI decision (t/4066#5): cite every Value Hierarchy element that applies, run the full set twice, and show what the
two runs agree on. A single run is not stable enough to present as "the" justification (trial: one-element
citations agreed 7/12 run-to-run, sets 10/12; t/4066#4).

Per proposed tag:
  vh_index            elements cited in BOTH runs (firm), or null
  vh_index_uncertain  elements cited in exactly ONE run
  vh_text             texts of the firm elements
  why                 run A's one-sentence reason
  unsupported         true only when BOTH runs cited no element (a tag unsupported in one run only is not
                      unsupported; its other run's elements are uncertain)
Same for value_basis_shared ("both" items). value_basis_nearest (untagged items) keeps run A's entry plus
`agree` (B named the same tag and element).

Writes a local file only; the data write is append_value_basis.py under /data-mutation (t/4066#1 item 3).
Usage: python combine_runs.py out/value-basis.full-A.json out/value-basis.full-B.json --out out/value-basis.combined.json
"""
import argparse, json, sys

sys.stdout.reconfigure(encoding="utf-8")


def merge_entry(a, b, hier):
    ia, ib = set(a["vh_index"] or []), set(b["vh_index"] or [])
    firm, unc = sorted(ia & ib), sorted(ia ^ ib)
    return {"vh_index": firm or None, "vh_index_uncertain": unc,
            "vh_text": [hier[i - 1] for i in firm] or None, "why": a["why"],
            "unsupported": not ia and not ib}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_a"); ap.add_argument("run_b")
    ap.add_argument("--out", required=True)
    a_doc, b_doc = (json.load(open(p, encoding="utf-8")) for p in (ap.parse_args().run_a, ap.parse_args().run_b))
    args = ap.parse_args()
    ra, rb = a_doc["value_basis_run"], b_doc["value_basis_run"]
    for k in ("model", "prompt_version", "base_commit", "base_side_file_sha256", "soul_doc_sha256"):
        if ra[k] != rb[k]:
            sys.exit(f"ABORT: runs differ on {k}: {ra[k]!r} vs {rb[k]!r}")
    if ra["failures"] or rb["failures"]:
        sys.exit(f"ABORT: a run has failures (A {len(ra['failures'])}, B {len(rb['failures'])}); resume it first")
    A = {r["node_id"]: r for r in a_doc["items"]}
    B = {r["node_id"]: r for r in b_doc["items"]}
    if set(A) != set(B):
        sys.exit(f"ABORT: item sets differ (only A {sorted(set(A)-set(B))[:5]}, only B {sorted(set(B)-set(A))[:5]})")

    # Hierarchies come back from the runs' own vh_text snapshots so the combine never re-reads the soul docs.
    hier = {"critical": {}, "institutional": {}, "shared": {}}
    for doc in (a_doc, b_doc):
        for r in doc["items"]:
            for e in r["value_basis"]:
                for i, t in zip(e["vh_index"] or [], e["vh_text"] or []): hier[e["tag"]][i] = t
            s = r.get("value_basis_shared")
            if s:
                for i, t in zip(s["vh_index"] or [], s["vh_text"] or []): hier["shared"][i] = t
    as_list = lambda h: [h[i] for i in sorted(h)] if h and sorted(h) == list(range(1, len(h) + 1)) else None

    items, stats = [], {"items": 0, "tags": 0, "tags_identical": 0, "tags_unsupported": 0, "tags_with_uncertain": 0,
                        "shared": 0, "shared_identical": 0, "nearest": 0, "nearest_agree": 0}
    for nid in [r["node_id"] for r in a_doc["items"]]:
        a, b = A[nid], B[nid]
        if [e["tag"] for e in a["value_basis"]] != [e["tag"] for e in b["value_basis"]]:
            sys.exit(f"ABORT: {nid}: runs disagree on the proposed tag list")
        rec = {"node_id": nid, "value_basis": []}
        for ea, eb in zip(a["value_basis"], b["value_basis"]):
            h = hier[ea["tag"]]
            m = merge_entry(ea, eb, [h.get(i) for i in range(1, max(h or {0: 0}) + 1)])
            rec["value_basis"].append({"tag": ea["tag"], **m})
            stats["tags"] += 1
            stats["tags_identical"] += (ea["vh_index"] or []) == (eb["vh_index"] or [])
            stats["tags_unsupported"] += m["unsupported"]
            stats["tags_with_uncertain"] += bool(m["vh_index_uncertain"])
        if "value_basis_shared" in a:
            h = hier["shared"]
            rec["value_basis_shared"] = merge_entry(a["value_basis_shared"], b["value_basis_shared"],
                                                    [h.get(i) for i in range(1, max(h or {0: 0}) + 1)])
            stats["shared"] += 1
            stats["shared_identical"] += (a["value_basis_shared"]["vh_index"] or []) == (b["value_basis_shared"]["vh_index"] or [])
        if "value_basis_nearest" in a:
            na, nb = a["value_basis_nearest"], b["value_basis_nearest"]
            rec["value_basis_nearest"] = {**na, "agree": (na["tag"], na["vh_index"]) == (nb["tag"], nb["vh_index"])}
            stats["nearest"] += 1; stats["nearest_agree"] += rec["value_basis_nearest"]["agree"]
        items.append(rec); stats["items"] += 1

    doc = {"value_basis_run": {"ticket": "t/4066", "model": ra["model"], "prompt_version": ra["prompt_version"],
                               "runs": [{"label": "A", "created_at": ra["created_at"]}, {"label": "B", "created_at": rb["created_at"]}],
                               "combine": "vh_index = cited in both runs; vh_index_uncertain = cited in exactly one; unsupported = neither run cited any",
                               "base_commit": ra["base_commit"], "base_side_file_sha256": ra["base_side_file_sha256"],
                               "soul_doc_sha256": ra["soul_doc_sha256"], "stability": stats},
           "items": items}
    open(args.out, "w", encoding="utf-8", newline="").write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    t = stats["tags"] or 1
    print(f"{stats['items']} items, {stats['tags']} tags -> {args.out}")
    print(f"  tag element sets identical across runs: {stats['tags_identical']}/{stats['tags']} ({stats['tags_identical']/t:.0%})")
    print(f"  tags with an uncertain element: {stats['tags_with_uncertain']} | unsupported in both runs: {stats['tags_unsupported']}")
    print(f"  shared identical: {stats['shared_identical']}/{stats['shared']} | nearest agree: {stats['nearest_agree']}/{stats['nearest']}")


if __name__ == "__main__":
    main()
