#!/usr/bin/env python3
"""t/3962 step 2: score the blind validation exactly as pre-registered in t/3962#8.

Each tag is a binary judgment per node (critical present? institutional present?), plus "untagged" ([]).
For each label and each pair of raters (A1 vs A2, A1 vs model, A2 vs model, consensus vs model), report:
  raw agreement with counts, the prevalence of the label for each rater, and Cohen's kappa ONLY when both
  raters have at least 5 positives (t/3587).
Consensus = items where both annotators agree on that label.
PASS (pre-registered): model-vs-consensus agreement >= 0.80 on every label with >= 5 consensus positives, AND neither
annotator constant on any label (excludes both degenerate modes).

  python score_validation.py <annotator sheet 1> <annotator sheet 2> [--key validation/sample-ids.json]
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LABELS = ("critical", "institutional", "untagged")


def label_vec(tags, lab):
    return (not tags) if lab == "untagged" else (lab in tags)


def kappa(a, b):
    n = len(a); po = sum(x == y for x, y in zip(a, b)) / n
    pa, pb = sum(a) / n, sum(b) / n
    pe = pa * pb + (1 - pa) * (1 - pb)
    return None if pe == 1 else (po - pe) / (1 - pe)


def compare(a, b):
    n = len(a); agree = sum(x == y for x, y in zip(a, b))
    k = kappa(a, b) if sum(a) >= 5 and sum(b) >= 5 else None
    return {"agree": agree, "n": n, "raw": round(agree / n, 3), "pos_a": sum(a), "pos_b": sum(b),
            "kappa": None if k is None else round(k, 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet1"); ap.add_argument("sheet2")
    ap.add_argument("--key", default=os.path.join(HERE, "validation", "sample-ids.json"))
    a = ap.parse_args()
    key = {s["node_id"]: s["proposed"] for s in json.load(open(a.key, encoding="utf-8"))["sample"]}
    s1, s2 = (json.load(open(p, encoding="utf-8")) for p in (a.sheet1, a.sheet2))
    t1 = {i["node_id"]: i["tags"] for i in s1["items"]}; t2 = {i["node_id"]: i["tags"] for i in s2["items"]}
    ids = sorted(key)
    missing = [i for i in ids if t1.get(i) is None or t2.get(i) is None]
    if missing or set(t1) != set(ids) or set(t2) != set(ids):
        sys.exit(f"ABORT: sheets incomplete or mismatched with the key: {missing[:5]}")
    n1, n2 = s1.get("annotator", "A1"), s2.get("annotator", "A2")
    report, passed, reasons = {}, True, []
    for lab in LABELS:
        v1 = [label_vec(t1[i], lab) for i in ids]; v2 = [label_vec(t2[i], lab) for i in ids]
        vm = [label_vec(key[i], lab) for i in ids]
        cons = [k for k, (x, y) in enumerate(zip(v1, v2)) if x == y]
        cv = [v1[k] for k in cons]; cm = [vm[k] for k in cons]
        r = {f"{n1} vs {n2}": compare(v1, v2), f"{n1} vs model": compare(v1, vm), f"{n2} vs model": compare(v2, vm),
             "consensus vs model": compare(cv, cm), "consensus_items": len(cons)}
        report[lab] = r
        for name, v in ((n1, v1), (n2, v2)):
            if sum(v) in (0, len(v)):
                passed = False; reasons.append(f"{name} is constant on {lab}")
        if sum(cv) >= 5 and r["consensus vs model"]["raw"] < 0.80:
            passed = False; reasons.append(f"consensus vs model on {lab}: {r['consensus vs model']['raw']} < 0.80")
    exact = {"model vs both annotators (exact tag set)": sum(sorted(key[i]) == sorted(t1[i]) == sorted(t2[i]) for i in ids),
             f"{n1} vs {n2} (exact tag set)": sum(sorted(t1[i]) == sorted(t2[i]) for i in ids), "n": len(ids)}
    out = {"labels": report, "exact_set_agreement": exact, "pass": passed, "fail_reasons": reasons}
    print(json.dumps(out, indent=2))
    return out


if __name__ == "__main__":
    main()
