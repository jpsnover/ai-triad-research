#!/usr/bin/env python3
"""score_lf_golden (t/3239): score a labeled node.logical_form golden-set worksheet and run the
off-enum-sort hard gate. Two independent checks:

1. formalization_accuracy (needs human labels) — parses the VERDICT lines from a worksheet produced
   by build_lf_golden_worksheet.py and reports strict = correct/labeled and lenient =
   (correct+minor)/labeled, per-stratum + macro (unweighted mean of strata) + overall. PROVENANCE:
   human-validated (the labels are the ground truth); the PASS threshold is stipulated-provisional
   until the first real labeling run sets an empirically defensible bar (see metric-provenance
   register). Report is always printed; the gate verdict only applies the threshold.

2. off-enum-sort gate (needs NO labels) — over EVERY frame in the population, asserts each arg `sort`
   is in the 5-value DOLCE-lite closed set. Deterministic; PASS iff zero violations. Independent of
   the sample, so it catches data errors the golden set never sampled (found the acc-desires-021 /
   saf-desires-004 / saf-intentions-013 'agentive-social-object' args, t/3239#1).

Usage:  python score_lf_golden.py --worksheet C:\\tmp\\lf-golden-worksheet.md
        python score_lf_golden.py --off-enum-only        # gate #2 alone, no worksheet needed
"""
import argparse, json, os, re, sys

sys.stdout.reconfigure(encoding="utf-8")

DATA_ROOT = os.environ.get("AI_TRIAD_DATA_ROOT") or os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "ai-triad-data")
ORIGIN = os.path.join(DATA_ROOT, "taxonomy", "Origin")
ORIGIN_FILES = ("accelerationist.json", "safetyist.json", "skeptic.json")
VALID_SORTS = frozenset({
    "agentive-physical-object", "non-agentive-functional-artifact",
    "perdurant", "normative-description", "non-agentive-social-object",
    "universal",  # t/3251: concept_refs (term:*) are universals — a 6th arg-slot sort, distinct
                  # from the 5 particular DolceCategory values (ratified TL t/3251#5, lib #1856).
})
VERDICTS = ("correct", "minor", "wrong")

NODE_RE = re.compile(r"^##\s*\[\d+\]\s*(\S+)\s*\(camp=(\w+),\s*category=(\w+)\)")
VERDICT_RE = re.compile(r"^\*\*VERDICT:\*\*\s*(.*)$")


def all_frames():
    for fn in ORIGIN_FILES:
        p = os.path.join(ORIGIN, fn)
        if not os.path.exists(p):
            sys.stderr.write(f"WARN fallback: origin file missing, skipped: {p}\n")
            continue
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        for n in data.get("nodes", []):
            lf = n.get("logical_form")
            if isinstance(lf, dict):
                yield n["id"], lf


def off_enum_gate():
    violations = []
    for nid, lf in all_frames():
        for a in (lf.get("args") or []):
            sort = a.get("sort")
            if sort is not None and sort not in VALID_SORTS:
                violations.append((nid, a.get("ref"), sort))
    print(f"\n=== off-enum-sort gate (all frames, no labels) ===")
    if not violations:
        print("PASS — every arg sort is in the DOLCE-lite set (5 particular + universal).")
        return True
    print(f"FAIL — {len(violations)} arg(s) with off-enum sort:")
    for nid, ref, sort in violations:
        print(f"  {nid}: {ref} -> {sort!r}")
    return False


def parse_worksheet(path):
    labels = {}  # id -> (camp, category, verdict|None)
    cur = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = NODE_RE.match(line.strip())
            if m:
                cur = (m.group(1), m.group(2), m.group(3))
                labels[m.group(1)] = [m.group(2), m.group(3), None]
                continue
            mv = VERDICT_RE.match(line.strip())
            if mv and cur:
                v = mv.group(1).strip().lower()
                labels[cur[0]][2] = v if v in VERDICTS else None
    return labels


def score(path):
    if not os.path.exists(path):
        sys.stderr.write(f"worksheet not found: {path} (run build_lf_golden_worksheet.py first)\n")
        return None
    labels = parse_worksheet(path)
    strata = {}  # (camp,cat) -> Counter-ish dict
    n_unlabeled = 0
    for nid, (camp, cat, v) in labels.items():
        if v is None:
            n_unlabeled += 1
            continue
        d = strata.setdefault((camp, cat), {"correct": 0, "minor": 0, "wrong": 0})
        d[v] += 1
    print(f"\n=== formalization_accuracy (labeled worksheet) ===")
    print(f"nodes in worksheet: {len(labels)}  labeled: {len(labels)-n_unlabeled}  unlabeled: {n_unlabeled}")
    if not strata:
        print("No labels yet — fill in VERDICT lines and re-run.")
        return None
    strict_rates, lenient_rates = [], []
    tot = {"correct": 0, "minor": 0, "wrong": 0}
    print("per-stratum (strict / lenient):")
    for key in sorted(strata):
        d = strata[key]
        lab = d["correct"] + d["minor"] + d["wrong"]
        for k in tot:
            tot[k] += d[k]
        s = d["correct"] / lab if lab else 0.0
        le = (d["correct"] + d["minor"]) / lab if lab else 0.0
        strict_rates.append(s)
        lenient_rates.append(le)
        print(f"  {key[0]}-{key[1]:<10} n={lab:>2}  strict={s:.2f}  lenient={le:.2f}")
    labtot = tot["correct"] + tot["minor"] + tot["wrong"]
    overall_strict = tot["correct"] / labtot
    overall_lenient = (tot["correct"] + tot["minor"]) / labtot
    macro_strict = sum(strict_rates) / len(strict_rates)
    macro_lenient = sum(lenient_rates) / len(lenient_rates)
    print(f"macro   strict={macro_strict:.3f}  lenient={macro_lenient:.3f}")
    print(f"overall strict={overall_strict:.3f}  lenient={overall_lenient:.3f}  (correct={tot['correct']} minor={tot['minor']} wrong={tot['wrong']})")
    return {"overall_strict": overall_strict, "overall_lenient": overall_lenient,
            "macro_strict": macro_strict, "macro_lenient": macro_lenient}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worksheet", default=r"C:\tmp\lf-golden-worksheet.md")
    ap.add_argument("--off-enum-only", action="store_true")
    ap.add_argument("--strict-threshold", type=float, default=0.70,
                    help="PROVISIONAL stipulated bar; set empirically after first labeling run")
    ap.add_argument("--lenient-threshold", type=float, default=0.85)
    args = ap.parse_args()

    enum_ok = off_enum_gate()
    if args.off_enum_only:
        return 0 if enum_ok else 1

    res = score(args.worksheet)
    if res is None:
        # No labels yet: report only, do not fail the run (labeling is the human's next step).
        return 0 if enum_ok else 1
    acc_ok = res["overall_strict"] >= args.strict_threshold and res["overall_lenient"] >= args.lenient_threshold
    print(f"\n=== gate verdict ===")
    print(f"off-enum-sort: {'PASS' if enum_ok else 'FAIL'}")
    print(f"formalization_accuracy: {'PASS' if acc_ok else 'FAIL'} "
          f"(strict {res['overall_strict']:.3f}>={args.strict_threshold}, "
          f"lenient {res['overall_lenient']:.3f}>={args.lenient_threshold}; thresholds PROVISIONAL)")
    return 0 if (enum_ok and acc_ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
