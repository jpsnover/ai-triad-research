#!/usr/bin/env python3
"""t/3406 tau calibration from CL single-annotator labels on the 40-pair golden.
MATERIALIZED=1 iff the opponent made substantively the anticipated attack (same target+thrust+valence);
0 if the cosine match is topical/spurious or a different objection. Precision-first (a false match
inflates hit_rate / deflates blindside). Labels are on (cos, index) from tau_worksheet.txt."""
# (cosine, label) — CL judgments, read from the worksheet
G = [
 (0.736,1),(0.720,1),(0.714,1),(0.661,1),(0.652,1),(0.647,1),(0.640,1),(0.633,1),
 (0.614,0),(0.605,0),(0.604,1),(0.564,1),(0.564,1),(0.562,1),(0.554,0),(0.553,0),
 (0.532,1),(0.527,0),(0.514,0),(0.508,0),(0.506,0),(0.504,1),(0.501,0),(0.488,1),
 (0.464,0),(0.464,1),(0.451,0),(0.438,0),(0.432,0),(0.416,0),(0.410,0),(0.408,0),
 (0.396,1),(0.392,0),(0.392,0),(0.392,1),(0.383,0),(0.365,0),(0.360,0),(0.351,0),
]
tot_pos = sum(l for _,l in G)
print(f"golden: {len(G)} pairs, {tot_pos} labeled MATERIALIZED (base rate {tot_pos/len(G):.2f})")
print("tau | precision | recall | n>=tau | (of matches>=tau, frac genuine)")
for tau in [0.65,0.62,0.60,0.575,0.55,0.53,0.50,0.47,0.45]:
    sel=[l for c,l in G if c>=tau]
    tp=sum(sel); n=len(sel)
    prec = tp/n if n else float('nan')
    rec = tp/tot_pos if tot_pos else float('nan')
    print(f"{tau:.3f} |  {prec:.2f}     |  {rec:.2f}  | {n:>2}")
# false negatives below 0.45 (genuine matches cosine misses)
fn_low = [c for c,l in G if l==1 and c<0.45]
print(f"\ngenuine materializations with cosine<0.45 (FALSE NEGATIVES cosine misses): {len(fn_low)} -> {fn_low}")
