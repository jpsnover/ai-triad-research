#!/usr/bin/env python3
"""Reliability metrics.

Mode 1 (default, t/1264) — BDI base-score calibration: ICC(2,1) + Krippendorff's
alpha (interval) on the human-vs-AI paired scores in q0-calibration results.
Ref bar (t/1241, Rathje-style stance study): 0.76 combined (ICC 0.79 / alpha 0.74).

Mode 2 (t/1586) — Debate-Tested tier reliability, per PREREG-t1586-single-rater.md:
two-tier-column quadratic-weighted Cohen's kappa with bootstrap 95% CI (2,000
resamples, seed=1586) and a 4x4 confusion matrix, for
  - criterion validity: pass-1 `rater_assigned_tier` vs manifest `current_tier`
  - test-retest:       pass-1 vs pass-2 `rater_assigned_tier` (joined on item_id)
and applies the pre-registered decision rules (test-retest gates criterion).

    python reliability_metrics.py debate-tested \
        --pass1 debate-tested-rating-sheet.csv \
        [--pass2 debate-tested-rating-sheet-pass2.csv] \
        [--manifest debate-tested-rating-manifest.json]

Pure numpy — no external reliability libs.
"""
import argparse, csv, json, os, sys
import numpy as np
from scipy.stats import pearsonr
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# v3 is the iteration the paper cites (Desires r=0.65, Intentions r=0.71 — §5.2/§5.4)
DATA = r"C:/Users/jsnov/repos/ai-triad-data/q0-calibration-v3-results.json"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reliability_metrics_results.json')


def icc_2_1(ratings: np.ndarray) -> float:
    """ICC(2,1): two-way random effects, absolute agreement, single measurement.
    ratings: (n_subjects, n_raters). Here n_raters = 2 (human, AI)."""
    n, k = ratings.shape
    grand = ratings.mean()
    row_means = ratings.mean(axis=1)
    col_means = ratings.mean(axis=0)
    ss_total = ((ratings - grand) ** 2).sum()
    ss_row = k * ((row_means - grand) ** 2).sum()          # between subjects
    ss_col = n * ((col_means - grand) ** 2).sum()          # between raters
    ss_err = ss_total - ss_row - ss_col                    # residual
    msr = ss_row / (n - 1)
    msc = ss_col / (k - 1)
    mse = ss_err / ((n - 1) * (k - 1))
    denom = msr + (k - 1) * mse + (k * (msc - mse) / n)
    return float((msr - mse) / denom) if denom != 0 else float('nan')


def krippendorff_alpha_interval(pairs: np.ndarray) -> float:
    """Krippendorff's alpha, interval metric, 2 coders, complete data.
    pairs: (n_units, 2). Do = mean squared within-unit diff; De = mean squared diff
    over all value pairs across the dataset."""
    a = pairs[:, 0].astype(float)
    b = pairs[:, 1].astype(float)
    do = np.mean((a - b) ** 2)                              # observed disagreement (interval)
    vals = np.concatenate([a, b])
    n = vals.size
    # De = (1/(n(n-1))) * sum_{i!=j} (v_i - v_j)^2  = 2 * sum_{i<j}(...) / (n(n-1))
    diffs_sq = (vals[:, None] - vals[None, :]) ** 2
    de = diffs_sq.sum() / (n * (n - 1))                    # excludes diagonal (zeros) implicitly
    return float(1 - do / de) if de != 0 else float('nan')


def metrics(pairs):
    if len(pairs) < 3:
        return {'n': len(pairs), 'pearson_r': None, 'icc_2_1': None, 'krippendorff_alpha': None}
    p = np.array(pairs, dtype=float)
    try:
        r = float(pearsonr(p[:, 0], p[:, 1])[0])
    except Exception:
        r = float('nan')
    return {
        'n': len(pairs),
        'pearson_r': round(r, 3),
        'icc_2_1': round(icc_2_1(p), 3),
        'krippendorff_alpha': round(krippendorff_alpha_interval(p), 3),
    }


def main():
    doc = json.load(open(DATA, encoding='utf-8'))
    rows = doc if isinstance(doc, list) else (doc.get('claims') or doc.get('results') or [])
    by_bdi = {}
    allpairs = []
    for r in rows:
        h = r.get('human'); a = r.get('rubric_score')
        if not isinstance(h, (int, float)) or not isinstance(a, (int, float)):
            continue
        bdi = (r.get('bdi') or 'Unknown')
        by_bdi.setdefault(bdi, []).append((h, a))
        allpairs.append((h, a))

    result = {'source': os.path.basename(DATA), 'overall': metrics(allpairs), 'by_bdi': {}}
    for bdi, pairs in by_bdi.items():
        result['by_bdi'][bdi] = metrics(pairs)

    # report
    print(f"Q-0 base-score calibration reliability (human vs AI rubric), n={result['overall']['n']}\n")
    hdr = f"{'group':12} {'n':>3} {'Pearson r':>10} {'ICC(2,1)':>9} {'Kripp. α':>9}"
    print(hdr); print('-' * len(hdr))
    def line(name, m):
        f = lambda x: f"{x:>9.3f}" if isinstance(x, (int, float)) else f"{'n/a':>9}"
        print(f"{name:12} {m['n']:>3} {f(m['pearson_r']):>10} {f(m['icc_2_1'])} {f(m['krippendorff_alpha'])}")
    line('OVERALL', result['overall'])
    for bdi in ('Beliefs', 'Desires', 'Intentions'):
        if bdi in result['by_bdi']:
            line(bdi, result['by_bdi'][bdi])
    print("\nInterpretation: Pearson r = rank correlation (bias-blind); ICC(2,1) & Krippendorff α")
    print("= chance-corrected absolute agreement. Reference bar (t/1241): ~0.74-0.79.")
    json.dump(result, open(OUT, 'w', encoding='utf-8'), indent=2)
    print(f"\nwrote {OUT}")


# ── Mode 2: Debate-Tested tier reliability (t/1586) ─────────────────────────

TIERS = ['untested', 'cited', 'contested', 'well_tested']   # ordinal, low → high
TIER_IDX = {t: i for i, t in enumerate(TIERS)}
BOOT_N = 2000
BOOT_SEED = 1586   # per PREREG-t1586-single-rater.md §1


def quadratic_weighted_kappa(a, b, k=len(TIERS)) -> float:
    """Quadratic-weighted Cohen's kappa on two equal-length int label arrays (0..k-1)."""
    a = np.asarray(a, dtype=int)
    b = np.asarray(b, dtype=int)
    obs = np.zeros((k, k))
    for i, j in zip(a, b):
        obs[i, j] += 1
    obs /= obs.sum()
    pa = obs.sum(axis=1)
    pb = obs.sum(axis=0)
    exp = np.outer(pa, pb)
    idx = np.arange(k)
    w = ((idx[:, None] - idx[None, :]) ** 2) / ((k - 1) ** 2)
    denom = (w * exp).sum()
    return float(1 - (w * obs).sum() / denom) if denom != 0 else float('nan')


def bootstrap_kappa_ci(a, b, n_boot=BOOT_N, seed=BOOT_SEED):
    """Percentile 95% CI on QWK by resampling items with replacement."""
    rng = np.random.default_rng(seed)
    a = np.asarray(a, dtype=int)
    b = np.asarray(b, dtype=int)
    n = a.size
    stats = []
    for _ in range(n_boot):
        idx = rng.integers(0, n, n)
        stats.append(quadratic_weighted_kappa(a[idx], b[idx]))
    lo, hi = np.nanpercentile(stats, [2.5, 97.5])
    return float(lo), float(hi)


def confusion(a, b, k=len(TIERS)) -> np.ndarray:
    m = np.zeros((k, k), dtype=int)
    for i, j in zip(a, b):
        m[i, j] += 1
    return m


def read_sheet_tiers(path):
    """item_id → rater_assigned_tier from a rating sheet CSV. Errors on blank/unknown tiers."""
    out, bad = {}, []
    with open(path, encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            item = (row.get('item_id') or '').strip()
            tier = (row.get('rater_assigned_tier') or '').strip().lower()
            if not item:
                continue
            if tier not in TIER_IDX:
                bad.append(f"{item}: {tier!r}")
            else:
                out[item] = tier
    if bad:
        sys.exit(f"ERROR: {len(bad)} row(s) in {os.path.basename(path)} have blank/unknown "
                 f"rater_assigned_tier (expected one of {TIERS}):\n  " + "\n  ".join(bad[:10]))
    return out


def paired(map_a, map_b, label_a, label_b):
    """Join two item_id→tier maps; error if the item sets differ (frozen 60-item sample)."""
    only_a = sorted(set(map_a) - set(map_b))
    only_b = sorted(set(map_b) - set(map_a))
    if only_a or only_b:
        sys.exit(f"ERROR: item sets differ — {len(only_a)} only in {label_a} "
                 f"(e.g. {only_a[:3]}), {len(only_b)} only in {label_b} (e.g. {only_b[:3]}). "
                 "Both inputs must cover the same frozen sample.")
    items = sorted(map_a)
    a = [TIER_IDX[map_a[i]] for i in items]
    b = [TIER_IDX[map_b[i]] for i in items]
    return items, a, b


def report_pair(name, a, b, label_a, label_b):
    kappa = quadratic_weighted_kappa(a, b)
    lo, hi = bootstrap_kappa_ci(a, b)
    m = confusion(a, b)
    exact = int(np.trace(m))
    print(f"\n{name}: quadratic-weighted κ = {kappa:.3f}  "
          f"[95% CI {lo:.3f}, {hi:.3f}]  (n={len(a)}, exact agreement {exact}/{len(a)})")
    colw = max(len(t) for t in TIERS)
    print(f"  confusion (rows = {label_a}, cols = {label_b}):")
    print("  " + " " * (colw + 2) + "  ".join(f"{t:>{colw}}" for t in TIERS))
    for i, t in enumerate(TIERS):
        print(f"  {t:>{colw}}: " + "  ".join(f"{m[i, j]:>{colw}}" for j in range(len(TIERS))))
    return {'kappa': round(kappa, 3), 'ci95': [round(lo, 3), round(hi, 3)],
            'n': len(a), 'exact_agreement': exact,
            'confusion_rows_' + label_a.replace('-', '_'): m.tolist()}


def debate_tested_main(argv):
    ap = argparse.ArgumentParser(prog='reliability_metrics.py debate-tested',
                                 description='t/1586 single-rater reliability (PREREG-t1586-single-rater.md)')
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument('--pass1', default=os.path.join(here, 'debate-tested-rating-sheet.csv'))
    ap.add_argument('--pass2', default=None, help='reshuffled pass-2 sheet; enables the test-retest leg')
    ap.add_argument('--manifest', default=os.path.join(here, 'debate-tested-rating-manifest.json'))
    ap.add_argument('--out', default=os.path.join(here, 'debate-tested-reliability-results.json'))
    args = ap.parse_args(argv)

    pass1 = read_sheet_tiers(args.pass1)
    manifest = json.load(open(args.manifest, encoding='utf-8'))
    instrument = {it['item_id']: it['current_tier'] for it in manifest['items']}
    unknown = sorted(set(instrument.values()) - set(TIERS))
    if unknown:
        sys.exit(f"ERROR: manifest contains unknown tiers {unknown}")

    print("Debate-Tested single-rater reliability (t/1586, prereg'd; seed "
          f"{BOOT_SEED}, {BOOT_N} bootstrap resamples)")
    result = {'preregistration': 'PREREG-t1586-single-rater.md', 'bootstrap': {'n': BOOT_N, 'seed': BOOT_SEED}}

    # Order of computation per prereg: test-retest FIRST — it gates the criterion reading.
    kappa_rt = None
    if args.pass2:
        pass2 = read_sheet_tiers(args.pass2)
        _, a, b = paired(pass1, pass2, 'pass1', 'pass2')
        result['test_retest'] = report_pair('TEST-RETEST (pass-1 vs pass-2)', a, b, 'pass1', 'pass2')
        kappa_rt = result['test_retest']['kappa']
    else:
        print("\nTEST-RETEST: skipped (no --pass2 sheet). The criterion result below is "
              "provisional — per prereg it may not be interpreted until κ_rt exists.")

    _, h, i = paired(pass1, instrument, 'pass1', 'manifest')
    result['criterion_validity'] = report_pair('CRITERION VALIDITY (human vs instrument)', h, i, 'human', 'instrument')
    kappa_cv = result['criterion_validity']['kappa']

    # Pre-registered decision rules (verbatim thresholds from the prereg).
    print("\nPRE-REGISTERED DECISION (PREREG-t1586-single-rater.md):")
    if kappa_rt is None:
        verdict = 'INCOMPLETE: run pass 2 (>=48h washout, reshuffled seed=15862) before any decision.'
    elif kappa_rt < 0.50:
        verdict = ('κ_rt < 0.50 — rater not stable on this rubric. Do NOT interpret the criterion κ. '
                   'Revise rubric/training and re-run.')
    else:
        gate_note = '' if kappa_rt >= 0.70 else ' (stability caveat: 0.50 ≤ κ_rt < 0.70)'
        if kappa_cv >= 0.70 and kappa_rt >= 0.70:
            verdict = 'Instrument ACCEPTED — Phase 1 UI ships without caveat.'
        elif kappa_cv >= 0.50:
            verdict = f'Instrument accepted WITH "experimental" label on the tier chip{gate_note}.'
        elif kappa_rt >= 0.70:
            verdict = ('κ_cv < 0.50 with a stable rater — divergence attributable to the instrument. '
                       'Investigation required before Phase 3 (scheduler) is authorized.')
        else:
            # 0.50 <= κ_rt < 0.70 with κ_cv < 0.50 — cell registered in the prereg's
            # 2026-07-29 pre-data clarification: investigation, with stability caveat.
            verdict = ('κ_cv < 0.50 with marginal rater stability (0.50 ≤ κ_rt < 0.70) — investigation '
                       'required before Phase 3, findings carry a stability caveat.')
    print('  ' + verdict)
    result['decision'] = verdict
    result['limitation'] = ('Single-rater result: shows this rater tracks (or not) the instrument; '
                            'an inter-subjective claim needs >=2 humans (future work).')

    json.dump(result, open(args.out, 'w', encoding='utf-8'), indent=2)
    print(f"\nwrote {args.out}")


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'debate-tested':
        debate_tested_main(sys.argv[2:])
    else:
        main()
