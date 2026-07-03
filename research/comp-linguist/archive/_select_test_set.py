"""
Select 15 stratified test documents for t/534 extraction quality experiment.

Reads all summaries, computes per-document metrics, and selects
a representative test set stratified by document length with
diversity in POV focus and BDI distribution.
"""
import json
import os
from pathlib import Path
from collections import Counter

DATA_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "ai-triad-data"
SUMMARIES_DIR = DATA_ROOT / "summaries"
SOURCES_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "ai-triad-sources"

TARGET_COUNT = 15
STRATA = {
    "short": (0, 3000),
    "medium": (3000, 8000),
    "long": (8000, float("inf")),
}
PER_STRATUM = 5


def estimate_word_count(doc_id: str) -> int | None:
    source_dir = SOURCES_ROOT / doc_id
    snapshot = source_dir / "snapshot.md"
    if snapshot.exists():
        text = snapshot.read_text(encoding="utf-8", errors="replace")
        return len(text.split())
    return None


def extract_summary_metrics(path: Path) -> dict | None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None

    doc_id = data.get("doc_id", path.stem)

    camps = ["accelerationist", "safetyist", "skeptic"]
    pov = data.get("pov_summaries", {})

    kp_counts = {}
    bdi_counts = Counter()
    total_kp = 0
    null_node_count = 0

    for camp in camps:
        camp_data = pov.get(camp, {})
        points = camp_data.get("key_points", [])
        kp_counts[camp] = len(points)
        total_kp += len(points)
        for pt in points:
            cat = pt.get("category", "Unknown")
            bdi_counts[cat] += 1
            if pt.get("taxonomy_node_id") is None:
                null_node_count += 1

    prompt_chars = None
    stages = data.get("context_rot", {}).get("stages", [])
    for stage in stages:
        if stage.get("stage") == "extraction":
            prompt_chars = stage.get("in_count")
            break

    word_count = estimate_word_count(doc_id)
    if word_count is None and prompt_chars:
        word_count = int(prompt_chars / 5.5)

    dominant_camp = max(kp_counts, key=kp_counts.get) if total_kp > 0 else None
    max_camp_kp = max(kp_counts.values()) if total_kp > 0 else 0
    is_balanced = max_camp_kp <= total_kp / 2 if total_kp > 0 else True

    desires_count = bdi_counts.get("Desires", 0)
    intentions_count = bdi_counts.get("Intentions", 0)
    has_bdi_edge_case = (
        desires_count > 0
        and intentions_count > 0
        and abs(desires_count - intentions_count) <= 2
    )

    attribution_rate = (
        (total_kp - null_node_count) / total_kp if total_kp > 0 else 0
    )

    has_source = (SOURCES_ROOT / doc_id / "snapshot.md").exists()

    return {
        "doc_id": doc_id,
        "word_count": word_count,
        "prompt_chars": prompt_chars,
        "total_kp": total_kp,
        "kp_by_camp": kp_counts,
        "bdi_counts": dict(bdi_counts),
        "dominant_camp": dominant_camp,
        "is_balanced": is_balanced,
        "has_bdi_edge_case": has_bdi_edge_case,
        "attribution_rate": attribution_rate,
        "has_source": has_source,
        "model": data.get("model_info", {}).get("model", "unknown"),
    }


def classify_stratum(word_count: int | None) -> str | None:
    if word_count is None:
        return None
    for name, (lo, hi) in STRATA.items():
        if lo <= word_count < hi:
            return name
    return None


def select_test_set(all_docs: list[dict]) -> list[dict]:
    eligible = [d for d in all_docs if d["has_source"] and d["word_count"] is not None]
    print(f"Eligible documents (have source + word count): {len(eligible)}")

    for d in eligible:
        d["stratum"] = classify_stratum(d["word_count"])

    by_stratum: dict[str, list[dict]] = {s: [] for s in STRATA}
    for d in eligible:
        if d["stratum"] in by_stratum:
            by_stratum[d["stratum"]].append(d)

    for s, docs in by_stratum.items():
        lo, hi = STRATA[s]
        hi_str = f"{hi}" if hi != float("inf") else "inf"
        print(f"  {s} ({lo}-{hi_str} words): {len(docs)} eligible")

    selected = []

    for stratum_name, candidates in by_stratum.items():
        candidates.sort(key=lambda d: d["total_kp"])

        sparse = [d for d in candidates if d["total_kp"] <= 4 * 3]
        bdi_edge = [d for d in candidates if d["has_bdi_edge_case"]]
        balanced = [d for d in candidates if d["is_balanced"]]

        stratum_picks = []

        if sparse:
            stratum_picks.append(sparse[0])

        for d in bdi_edge:
            if d not in stratum_picks and len(stratum_picks) < PER_STRATUM:
                stratum_picks.append(d)
                break

        for d in balanced:
            if d not in stratum_picks and len(stratum_picks) < PER_STRATUM:
                stratum_picks.append(d)
                break

        remaining = [d for d in candidates if d not in stratum_picks]
        remaining.sort(key=lambda d: d["total_kp"], reverse=True)
        for d in remaining:
            if len(stratum_picks) >= PER_STRATUM:
                break
            stratum_picks.append(d)

        selected.extend(stratum_picks)

    return selected


def main():
    if not SUMMARIES_DIR.exists():
        print(f"Summaries directory not found: {SUMMARIES_DIR}")
        return

    summary_files = sorted(SUMMARIES_DIR.glob("*.json"))
    print(f"Total summary files: {len(summary_files)}")

    all_docs = []
    for sf in summary_files:
        metrics = extract_summary_metrics(sf)
        if metrics:
            all_docs.append(metrics)

    print(f"Successfully parsed: {len(all_docs)}")

    wc_available = [d for d in all_docs if d["word_count"] is not None]
    if wc_available:
        wcs = [d["word_count"] for d in wc_available]
        print(f"\nWord count distribution (n={len(wcs)}):")
        print(f"  min={min(wcs):,}  median={sorted(wcs)[len(wcs)//2]:,}  max={max(wcs):,}")

    kps = [d["total_kp"] for d in all_docs]
    print(f"\nKey points distribution (n={len(kps)}):")
    print(f"  min={min(kps)}  median={sorted(kps)[len(kps)//2]}  max={max(kps)}")

    test_set = select_test_set(all_docs)

    print(f"\n{'='*70}")
    print(f"SELECTED TEST SET ({len(test_set)} documents)")
    print(f"{'='*70}")

    for i, d in enumerate(test_set, 1):
        print(f"\n{i:2d}. {d['doc_id']}")
        print(f"    stratum={d['stratum']}, words={d['word_count']:,}, "
              f"kp={d['total_kp']}, attr_rate={d['attribution_rate']:.0%}")
        print(f"    camps: acc={d['kp_by_camp']['accelerationist']}, "
              f"saf={d['kp_by_camp']['safetyist']}, "
              f"skp={d['kp_by_camp']['skeptic']}")
        print(f"    BDI: {d['bdi_counts']}")
        print(f"    balanced={d['is_balanced']}, bdi_edge={d['has_bdi_edge_case']}")

    output_path = Path(__file__).parent / "_t534_test_set.json"
    output = {
        "experiment": "t/534",
        "selection_date": "2026-06-09",
        "total_summaries": len(all_docs),
        "eligible_count": len([d for d in all_docs if d["has_source"] and d["word_count"]]),
        "selected_count": len(test_set),
        "documents": [
            {
                "doc_id": d["doc_id"],
                "stratum": d["stratum"],
                "word_count": d["word_count"],
                "total_kp": d["total_kp"],
                "kp_by_camp": d["kp_by_camp"],
                "bdi_counts": d["bdi_counts"],
                "attribution_rate": round(d["attribution_rate"], 3),
                "is_balanced": d["is_balanced"],
                "has_bdi_edge_case": d["has_bdi_edge_case"],
            }
            for d in test_set
        ],
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)
    print(f"\nTest set written to: {output_path}")


if __name__ == "__main__":
    main()
