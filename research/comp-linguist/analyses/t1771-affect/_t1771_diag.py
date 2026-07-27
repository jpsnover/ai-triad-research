import json, statistics
from collections import Counter

MAXDEV = 0.35
BASE = {
    "confrontation": {"urgency":0.30,"fear":0.20,"hope":0.17,"outrage":0.17,"empathy":0.14},
    "argumentation": {"urgency":0.20,"fear":0.12,"hope":0.30,"outrage":0.09,"empathy":0.24},
    "concluding":    {"urgency":0.25,"fear":0.08,"hope":0.39,"outrage":0.04,"empathy":0.29},
}

print("=== H1: what does a ZERO-affect text score? (profile all zeros) ===")
for ph, b in BASE.items():
    s = sum(b.values())
    meandev = s / 5.0
    val = max(0.0, 1 - meandev / MAXDEV)
    print(f"  {ph:14s} baseline sum={s:.2f} mean={meandev:.4f} -> appropriateness={val:.4f}")

print("\n=== H2: observed distribution in the real-debate sample ===")
path = r"C:/Users/jsnov/repos/ai-triad-data/calibration/core/calibration-log.jsonl"
rows = []
with open(path, encoding="utf-8") as fh:
    for line in fh:
        line = line.strip()
        if line:
            try: rows.append(json.loads(line))
            except Exception: pass
key = [r for r in rows if "clarity_mean_sentence_length" in r]
real = [r for r in key if (r.get("clarity_mean_sentence_length") or 0) >= 10]
aa = [r["affect_appropriateness"] for r in real if r.get("affect_appropriateness") is not None]
print(f"  n={len(aa)} mean={statistics.mean(aa):.3f} median={statistics.median(aa):.3f} "
      f"min={min(aa):.3f} max={max(aa):.3f} sd={statistics.pstdev(aa):.3f}")
qs = statistics.quantiles(aa, n=20)
print(f"  p5={qs[0]:.3f} p25={statistics.quantiles(aa,n=4)[0]:.3f} p75={statistics.quantiles(aa,n=4)[2]:.3f} p95={qs[18]:.3f}")

print("\n=== H3: is the observed floor == the zero-affect value? ===")
zero_vals = {ph: max(0.0, 1 - sum(b.values())/5.0/MAXDEV) for ph, b in BASE.items()}
print(f"  zero-affect range across phases: {min(zero_vals.values()):.4f} .. {max(zero_vals.values()):.4f}")
print(f"  observed min = {min(aa):.4f}")
print("  -> if observed min sits at/just above the zero-affect value, the metric's")
print("     dynamic range is set by the BASELINE VECTOR, not by debate affect.")

print("\n=== H4: what affect fields are actually logged? (can shares be recomputed?) ===")
affect_fields = Counter()
for r in real:
    for k in r:
        if "affect" in k:
            affect_fields[k] += 1
for k, v in affect_fields.most_common():
    print(f"  {k}: present in {v}/{len(real)}")

print("\n=== H5: intensity vs appropriateness — are they even correlated? ===")
pairs = [(r.get("affect_intensity_mean"), r.get("affect_appropriateness")) for r in real
         if r.get("affect_intensity_mean") is not None and r.get("affect_appropriateness") is not None]
if len(pairs) > 2:
    xs = [p[0] for p in pairs]; ys = [p[1] for p in pairs]
    mx, my = statistics.mean(xs), statistics.mean(ys)
    num = sum((x-mx)*(y-my) for x,y in pairs)
    den = (sum((x-mx)**2 for x in xs) * sum((y-my)**2 for y in ys)) ** 0.5
    print(f"  n={len(pairs)} intensity mean={mx:.4f} (range {min(xs):.4f}..{max(xs):.4f})")
    print(f"  Pearson r(intensity, appropriateness) = {num/den if den else float('nan'):.3f}")
    print("  -> a strong NEGATIVE r means appropriateness is mostly re-reporting low intensity,")
    print("     i.e. it measures 'how little affect' rather than 'how well-balanced'.")
