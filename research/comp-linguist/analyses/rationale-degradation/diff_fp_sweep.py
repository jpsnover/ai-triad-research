#!/usr/bin/env python3
# t/2963 — diff-mode false-positive DISTRIBUTION for the rationale-degradation detector.
#
# Reads the clean paraphrase controls (build_diff_controls.py) and reports the false-positive rate
# as a DISTRIBUTION over compression ratio, not a point estimate (R-1 reasoning, p/250#80): every
# control is a faithful same-edge rewrite that MUST NOT be flagged, so any flag is a false positive.
# We bin by actual char-ratio and report per-bin n / FP / rate, plus the content-word RETENTION
# ratio that actually drives the detector's content-collapse gate — the mechanism that makes a
# faithful compression safe across the whole band.
#
# Exit 0 iff zero false positives across all bins (a faithful paraphrase is never degradation).

import argparse, json, sys, detect

BINS = [(0.50, 0.60), (0.60, 0.70), (0.70, 0.80), (0.80, 0.95), (0.95, 10.0)]


def content_retention(old, new):
    ocw, ncw = detect.content_words(old), detect.content_words(new)
    return len(ncw) / max(1, len(ocw))


def run(sample_path):
    sample = json.load(open(sample_path, encoding="utf-8"))
    controls = [r for r in sample if r.get("control") == "diff_ratio" and "old" in r and "new" in r]
    if not controls:
        raise SystemExit(f"no diff_ratio controls in {sample_path} (run build_diff_controls.py + merge)")

    for r in controls:
        r["_ratio"] = len(r["new"]) / max(1, len(r["old"]))
        r["_sig"] = detect.flag_transition(r["old"], r["new"])
        r["_ret"] = content_retention(r["old"], r["new"])

    print(f"[diff-mode FP distribution] controls={len(controls)}  (faithful paraphrases; every flag = FP)")
    print(f"  {'char-ratio band':<18}{'n':>4}{'FP':>5}{'FP-rate':>9}   content-word retention (min/median/max)")
    total_fp = 0
    for lo, hi in BINS:
        b = [r for r in controls if lo <= r["_ratio"] < hi]
        if not b:
            continue
        fp = sum(1 for r in b if r["_sig"])
        total_fp += fp
        rets = sorted(r["_ret"] for r in b)
        med = rets[len(rets) // 2]
        label = f"{lo:.2f}-{hi:.2f}" if hi < 10 else f">= {lo:.2f}"
        print(f"  {label:<18}{len(b):>4}{fp:>5}{100*fp/len(b):>8.1f}%   {rets[0]:.2f} / {med:.2f} / {rets[-1]:.2f}")

    allret = sorted(r["_ret"] for r in controls)
    print(f"\n  overall: {len(controls)} controls, {total_fp} false positives "
          f"({100*total_fp/len(controls):.1f}%)")
    print(f"  content-word retention across all controls: min={allret[0]:.2f} "
          f"median={allret[len(allret)//2]:.2f}  (gate trips only when retention < 0.50)")
    for r in controls:
        if r["_sig"]:
            print(f"    FP: ratio={r['_ratio']:.2f} ret={r['_ret']:.2f} {r['_sig']}  {r['source_key']}")
            print(f"        old: {r['old'][:90]!r}\n        new: {r['new'][:90]!r}")

    ok = total_fp == 0
    lo_r = min(r["_ratio"] for r in controls)
    hi_r = max(r["_ratio"] for r in controls)
    print(f"\n  DIFF-MODE FP FLOOR: {'PASS' if ok else 'FAIL'} "
          f"({total_fp} FP across {lo_r:.2f}-{hi_r:.2f} char-ratio band, n={len(controls)})")
    return ok


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="diff-mode FP distribution over compression ratio (t/2963)")
    ap.add_argument("sample", help="labelled sample json containing control=diff_ratio rows")
    args = ap.parse_args()
    sys.exit(0 if run(args.sample) else 1)
