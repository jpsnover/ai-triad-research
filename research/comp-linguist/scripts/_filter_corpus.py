#!/usr/bin/env python3
"""Filter training corpus to specific source types."""
import json, sys
from pathlib import Path

corpus_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
allowed_sources = set(sys.argv[3].split(","))

corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
filtered = [p for p in corpus["pairs"] if p["source"] in allowed_sources]
positive = sum(1 for p in filtered if p["weight"] > 0)

result = {
    "metadata": {
        **corpus["metadata"],
        "total_pairs": len(filtered),
        "positive_pairs": positive,
        "filter": list(allowed_sources),
    },
    "pairs": filtered,
    "tension_map": corpus.get("tension_map", {}),
    "gap_nodes": corpus.get("gap_nodes", []),
}
output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Filtered {len(corpus['pairs'])} -> {len(filtered)} pairs ({positive} positive)")
for src in sorted(allowed_sources):
    n = sum(1 for p in filtered if p["source"] == src)
    print(f"  {src}: {n}")
