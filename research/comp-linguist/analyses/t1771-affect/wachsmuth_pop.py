import json
from collections import Counter

path = r"C:/Users/jsnov/repos/ai-triad-data/calibration/core/calibration-log.jsonl"
rows = []
with open(path, encoding="utf-8") as fh:
    for line in fh:
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except Exception:
                pass

key = [r for r in rows if "clarity_mean_sentence_length" in r]
# Split into degenerate (MSL<=2) vs real-prose (MSL>=10)
degen = [r for r in key if (r.get("clarity_mean_sentence_length") or 0) <= 2]
real  = [r for r in key if (r.get("clarity_mean_sentence_length") or 0) >= 10]
mid   = [r for r in key if 2 < (r.get("clarity_mean_sentence_length") or 0) < 10]

def summarize(label, rs):
    print(f"\n--- {label}: n={len(rs)} ---")
    print("  models:", Counter(r.get("model") for r in rs).most_common(8))
    print("  rounds:", Counter(r.get("rounds") for r in rs).most_common(8))
    ts = sorted(r.get("timestamp","") for r in rs if r.get("timestamp"))
    if ts:
        print(f"  ts: {ts[0]} -> {ts[-1]}")
    haz_affect = sum(1 for r in rs if r.get("affect_intensity_mean") is not None)
    haz_jargon = sum(1 for r in rs if r.get("clarity_jargon_density") is not None)
    print(f"  affect non-null: {haz_affect} | jargon non-null: {haz_jargon}")

summarize("DEGENERATE (MSL<=2)", degen)
summarize("MID (2<MSL<10)", mid)
summarize("REAL-PROSE (MSL>=10)", real)

# Among real-prose: affect appropriateness distribution vs the >=0.60 target
import statistics
aa = [r["affect_appropriateness"] for r in real if r.get("affect_appropriateness") is not None]
if aa:
    below = sum(1 for v in aa if v < 0.60)
    print(f"\nREAL-PROSE affect_appropriateness: n={len(aa)} mean={statistics.mean(aa):.3f} "
          f"median={statistics.median(aa):.3f} min={min(aa):.3f} max={max(aa):.3f} | below 0.60 target: {below}/{len(aa)}")
