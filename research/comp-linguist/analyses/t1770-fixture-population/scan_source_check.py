import json
from collections import Counter

p = r"C:/Users/jsnov/repos/ai-triad-data/calibration/calibration-log.json"
with open(p, encoding="utf-8") as f:
    data = json.load(f)

if isinstance(data, dict) and "entries" in data:
    entries = data["entries"]
    top = "dict.entries"
elif isinstance(data, list):
    entries = data
    top = "list"
else:
    entries = []
    top = f"other:{type(data)} keys={list(data)[:10] if isinstance(data,dict) else ''}"

print(f"top-level: {top} | entries: {len(entries)}")

# fixture characterization
def msl(e): return e.get("clarity_mean_sentence_length")
have_msl = [e for e in entries if isinstance(msl(e), (int, float))]
degen = [e for e in entries if isinstance(msl(e), (int, float)) and msl(e) <= 2]
real  = [e for e in entries if isinstance(msl(e), (int, float)) and msl(e) >= 10]
print(f"with MSL: {len(have_msl)} | degenerate(MSL<=2): {len(degen)} | real(MSL>=10): {len(real)}")
print("models(all):", Counter(e.get("model") for e in entries).most_common(10))
print("models(real MSL>=10):", Counter(e.get("model") for e in real).most_common(10))

# owned metrics availability overall vs real-only
OWNED = ["crux_addressed_ratio","repetition_rate","claims_forgotten_rate","situation_crux_alignment"]
for m in OWNED:
    allnn = sum(1 for e in entries if isinstance(e.get(m),(int,float)))
    realnn = sum(1 for e in real if isinstance(e.get(m),(int,float)))
    print(f"  {m:28s} nonnull all={allnn:5d}  nonnull real={realnn:4d}")

# timestamp span
ts = sorted(e.get("timestamp","") for e in entries if e.get("timestamp"))
if ts: print("ts:", ts[0], "->", ts[-1])
