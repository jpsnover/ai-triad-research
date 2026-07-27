import json, statistics, sys

LOGS = [
    r"C:/Users/jsnov/repos/ai-triad-data/calibration/core/calibration-log.jsonl",
    r"C:/Users/jsnov/repos/ai-triad-data/calibration/users/local/calibration-log.jsonl",
    r"C:/Users/jsnov/repos/ai-triad-data/debates/calibration/core/calibration-log.jsonl",
    r"C:/Users/jsnov/repos/ai-triad-data/debates/calibration/users/local/calibration-log.jsonl",
]

FIELDS = [
    "clarity_mean_sentence_length", "clarity_lexical_diversity", "clarity_jargon_density",
    "affect_intensity_mean", "affect_intensity_variance", "affect_appropriateness",
    "source_authority_mean", "source_recency_mean", "evidence_breadth_per_claim",
]

def stats(vals):
    vals = [v for v in vals if isinstance(v, (int, float))]
    if not vals:
        return "n=0"
    if len(vals) == 1:
        return f"n=1 val={vals[0]:.3f}"
    return (f"n={len(vals)} min={min(vals):.3f} mean={statistics.mean(vals):.3f} "
            f"median={statistics.median(vals):.3f} max={max(vals):.3f} sd={statistics.pstdev(vals):.3f}")

for path in LOGS:
    rows = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                pass
    # only rows that actually carry the Wachsmuth keys at all
    have_keys = [r for r in rows if any(k in r for k in FIELDS)]
    ts = sorted(r.get("timestamp", "") for r in rows if r.get("timestamp"))
    print("=" * 90)
    print(f"LOG: {path}")
    print(f"total entries: {len(rows)} | entries carrying any Wachsmuth key: {len(have_keys)}")
    if ts:
        print(f"timestamp range: {ts[0]}  ->  {ts[-1]}")
    # of the key-carrying rows, how many are non-null per field
    if have_keys:
        # unique debates among key-carriers
        dbg = set(r.get("debate_id") for r in have_keys)
        print(f"unique debates among key-carriers: {len(dbg)}")
        for f in FIELDS:
            nonnull = [r.get(f) for r in have_keys if r.get(f) is not None]
            null_ct = sum(1 for r in have_keys if f in r and r.get(f) is None)
            print(f"  {f:32s} nonnull={len(nonnull):4d} null={null_ct:4d} | {stats(nonnull)}")
    print()
