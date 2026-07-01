#!/usr/bin/env python3
"""t/1264 — reliability metrics for BDI base-score calibration.

Upgrades the Q-0 calibration reporting from Pearson r (rank correlation only) to the
agreement statistics appropriate for rater reliability: ICC(2,1) (two-way random,
absolute agreement, single rater) and Krippendorff's alpha (interval). Computed from
the human-vs-AI paired scores in q0-calibration-bdi-aware-results.json, overall and
per BDI layer. Pure numpy — no external reliability libs.

Ref bar (t/1241, Rathje-style stance study): 0.76 combined (ICC 0.79 / alpha 0.74).
"""
import json, os, sys
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


if __name__ == '__main__':
    main()
