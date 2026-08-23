#!/usr/bin/env python3
# t/2963 + t/2965 — diff-mode false-positive DISTRIBUTION for the rationale-degradation detector.
#
# Reads the clean paraphrase controls (build_diff_controls.py) and reports the false-positive rate
# as a DISTRIBUTION over compression ratio, not a point estimate (R-1 reasoning, p/250#80): every
# control is a faithful same-edge rewrite that MUST NOT be flagged, so any flag is a false positive.
# We bin by actual char-ratio and report per-bin n / FP / rate, plus the content-word RETENTION
# ratio that actually drives the detector's content-collapse gate — the mechanism that makes a
# faithful compression safe across the whole band.
#
# t/2965 additions: (1) a `< 0.50` bin, so the sweep now covers the region COLLAPSE_RATIO actually
# governs (the t/2963 controls all sat at ratio >= 0.53, leaving the length conjunct never exercised);
# it is populated by the faithful sub-boundary controls (ratio 0.40-0.49, retention >= 0.5) that stay
# quiet — the length-conjunct-TRUE / content-conjunct-FALSE demonstration. (2) per-source clustering
# alongside per-bin n, because the controls draw from a small set of source rationales and per-bin n
# overstates independence (R-1) — the effective n is nearer the source-cluster count than the draw count.
# Only the CLEAN controls are the FP population; the lossy sub-boundary TPs (control
# `diff_ratio_subboundary_tp`, label degraded) belong to detect.py --validate, not here.
#
# Exit 0 iff zero false positives across all bins (a faithful paraphrase is never degradation).

import argparse, json, sys, detect

# `< 0.50` bin first (t/2965 — the region COLLAPSE_RATIO governs), then the t/2963 bands.
BINS = [(0.0, 0.50), (0.50, 0.60), (0.60, 0.70), (0.70, 0.80), (0.80, 0.95), (0.95, 10.0)]
CLEAN_CONTROL_TYPES = ("diff_ratio", "diff_ratio_subboundary")


def content_retention(old, new):
    ocw, ncw = detect.content_words(old), detect.content_words(new)
    return len(ncw) / max(1, len(ocw))


def _bin_label(lo, hi):
    if lo == 0.0:
        return f"< {hi:.2f}"
    return f"{lo:.2f}-{hi:.2f}" if hi < 10 else f">= {lo:.2f}"


def run(sample_path):
    sample = json.load(open(sample_path, encoding="utf-8"))
    controls = [r for r in sample
                if r.get("control") in CLEAN_CONTROL_TYPES and r.get("label") == "clean"
                and "old" in r and "new" in r]
    if not controls:
        raise SystemExit(f"no clean diff-ratio controls in {sample_path} (run build_diff_controls.py + merge)")

    for r in controls:
        r["_ratio"] = len(r["new"]) / max(1, len(r["old"]))
        r["_sig"] = detect.flag_transition(r["old"], r["new"])
        r["_ret"] = content_retention(r["old"], r["new"])

    print(f"[diff-mode FP distribution] controls={len(controls)}  (faithful paraphrases; every flag = FP)")
    print(f"  {'char-ratio band':<16}{'n':>4}{'src':>5}{'FP':>5}{'FP-rate':>9}   content-word retention (min/median/max)")
    total_fp = 0
    for lo, hi in BINS:
        b = [r for r in controls if lo <= r["_ratio"] < hi]
        if not b:
            continue
        fp = sum(1 for r in b if r["_sig"])
        total_fp += fp
        rets = sorted(r["_ret"] for r in b)
        med = rets[len(rets) // 2]
        nsrc = len({r["source_key"] for r in b})   # distinct source rationales in this bin (R-1)
        print(f"  {_bin_label(lo, hi):<16}{len(b):>4}{nsrc:>5}{fp:>5}{100*fp/len(b):>8.1f}%"
              f"   {rets[0]:.2f} / {med:.2f} / {rets[-1]:.2f}")

    allret = sorted(r["_ret"] for r in controls)
    print(f"\n  overall: {len(controls)} controls, {total_fp} false positives "
          f"({100*total_fp/len(controls):.1f}%)")
    print(f"  content-word retention across all controls: min={allret[0]:.2f} "
          f"median={allret[len(allret)//2]:.2f}  (gate trips only when retention < 0.50)")

    # Per-source clustering (R-1 independence caveat): the FP floor is anchored by source-clusters,
    # not independent draws. Report the draw->source ratio so per-bin n is not over-read.
    from collections import Counter
    per_src = Counter(r["source_key"] for r in controls)
    nsrc = len(per_src)
    clustering = sorted(per_src.values(), reverse=True)
    print(f"  per-source clustering (R-1): {len(controls)} draws from {nsrc} distinct sources "
          f"({len(controls)/nsrc:.1f} draws/source; per-source draw counts {clustering}) "
          f"— read the floor as ~{nsrc} source-clusters, not {len(controls)} independent draws")

    for r in controls:
        if r["_sig"]:
            print(f"    FP: ratio={r['_ratio']:.2f} ret={r['_ret']:.2f} {r['_sig']}  {r['source_key']}")
            print(f"        old: {r['old'][:90]!r}\n        new: {r['new'][:90]!r}")

    ok = total_fp == 0
    lo_r = min(r["_ratio"] for r in controls)
    hi_r = max(r["_ratio"] for r in controls)
    print(f"\n  DIFF-MODE FP FLOOR: {'PASS' if ok else 'FAIL'} "
          f"({total_fp} FP across {lo_r:.2f}-{hi_r:.2f} char-ratio band, n={len(controls)} from {nsrc} sources)")
    return ok


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="diff-mode FP distribution over compression ratio (t/2963+t/2965)")
    ap.add_argument("sample", help="labelled sample json containing clean diff-ratio control rows")
    args = ap.parse_args()
    sys.exit(0 if run(args.sample) else 1)
