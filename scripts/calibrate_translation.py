#!/usr/bin/env python3

"""
calibrate_translation.py — Five-dimensional translation pipeline calibration.

Evaluates translation pipeline quality against a hand-labeled validation set
and recommends parameter adjustments.

Five dimensions:
  1. Per-term precision and recall
  2. Per-camp confusion matrix
  3. Ambiguity rate
  4. Fallback accuracy spot-check
  5. Downstream impact comparison (manual, reported here for completeness)

Usage:
    python scripts/calibrate_translation.py [--data-root PATH] [--validation-set PATH] [--output PATH]
"""

import argparse
import json
import math
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent


def _resolve_data_root(override=None):
    if override:
        return Path(override).resolve()
    config_path = _SCRIPT_DIR.parent / ".aitriad.json"
    if config_path.exists():
        try:
            cfg = json.loads(config_path.read_text(encoding="utf-8"))
            data_root = cfg.get("data_root", ".")
            base = Path(data_root) if Path(data_root).is_absolute() else (_SCRIPT_DIR.parent / data_root)
            return base.resolve()
        except (json.JSONDecodeError, OSError):
            pass
    return _SCRIPT_DIR.parent.resolve()


# ── Dimension 1: Per-term precision and recall ──────────────

def compute_per_term_metrics(validation: list[dict]) -> dict:
    """Compute precision and recall for each standardized term."""
    term_tp = defaultdict(int)
    term_fp = defaultdict(int)
    term_fn = defaultdict(int)

    for entry in validation:
        gold = entry["gold_standardized_term"]
        predicted = entry.get("pipeline_resolved_to")

        if predicted == gold:
            term_tp[gold] += 1
        else:
            if predicted:
                term_fp[predicted] += 1
            term_fn[gold] += 1

    all_terms = set(term_tp) | set(term_fp) | set(term_fn)
    results = {}
    flagged = []

    for term in sorted(all_terms):
        tp = term_tp[term]
        fp = term_fp[term]
        fn = term_fn[term]
        total = tp + fn

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

        entry = {
            "term": term,
            "true_positives": tp,
            "false_positives": fp,
            "false_negatives": fn,
            "total_gold": total,
            "precision": round(precision, 3),
            "recall": round(recall, 3),
            "f1": round(f1, 3),
        }

        if total >= 10:
            if precision < 0.85:
                entry["flag"] = "precision_below_0.85"
                flagged.append(entry)
            if recall < 0.70:
                entry["flag"] = entry.get("flag", "") + " recall_below_0.70"
                if entry not in flagged:
                    flagged.append(entry)

        results[term] = entry

    return {"per_term": results, "flagged_terms": flagged}


# ── Dimension 2: Per-camp confusion matrix ──────────────────

def compute_camp_confusion(validation: list[dict], term_to_camp: dict[str, str]) -> dict:
    """Compute 3x3 camp confusion matrix."""
    camps = ["accelerationist", "safetyist", "skeptic"]
    matrix = {r: {c: 0 for c in camps} for r in camps}
    unmapped = 0

    for entry in validation:
        gold_term = entry["gold_standardized_term"]
        predicted_term = entry.get("pipeline_resolved_to")

        gold_camp = term_to_camp.get(gold_term)
        predicted_camp = term_to_camp.get(predicted_term) if predicted_term else None

        if gold_camp and predicted_camp and gold_camp in camps and predicted_camp in camps:
            matrix[gold_camp][predicted_camp] += 1
        else:
            unmapped += 1

    # Compute off-diagonal percentages
    warnings = []
    for row_camp in camps:
        row_total = sum(matrix[row_camp].values())
        if row_total == 0:
            continue
        for col_camp in camps:
            if col_camp == row_camp:
                continue
            pct = matrix[row_camp][col_camp] / row_total
            if pct >= 0.10:
                warnings.append({
                    "gold_camp": row_camp,
                    "predicted_camp": col_camp,
                    "percentage": round(pct * 100, 1),
                    "count": matrix[row_camp][col_camp],
                    "row_total": row_total,
                    "severity": "high" if pct >= 0.20 else "medium",
                })

    return {
        "matrix": matrix,
        "unmapped_count": unmapped,
        "cross_camp_warnings": warnings,
    }


# ── Dimension 3: Ambiguity rate ─────────────────────────────

def compute_ambiguity_rate(validation: list[dict]) -> dict:
    """Compute percentage of occurrences flagged as ambiguous."""
    total = len(validation)
    ambiguous = sum(1 for e in validation if e.get("pipeline_confidence") == "ambiguous")
    rate = ambiguous / total if total > 0 else 0.0

    status = "ok"
    if rate < 0.05:
        status = "too_low_false_confidence"
    elif rate > 0.15:
        status = "too_high_weak_phrases"

    return {
        "total_occurrences": total,
        "ambiguous_count": ambiguous,
        "ambiguity_rate": round(rate, 3),
        "target_band": "0.05-0.15",
        "status": status,
    }


# ── Dimension 4: Fallback accuracy ──────────────────────────

def compute_fallback_accuracy(validation: list[dict]) -> dict:
    """Spot-check LLM-assisted translations."""
    fallback_entries = [e for e in validation if e.get("pipeline_method") == "llm_assisted"]
    total = len(fallback_entries)

    if total == 0:
        return {
            "total_fallback": 0,
            "note": "No LLM-assisted translations in validation set",
        }

    correct = sum(1 for e in fallback_entries if e.get("pipeline_resolved_to") == e["gold_standardized_term"])
    incorrect = total - correct

    # Categorize errors
    sense_preference = defaultdict(int)
    local_disagreements = {"llm_wrong": 0, "llm_right": 0}

    for e in fallback_entries:
        if e.get("pipeline_resolved_to") != e["gold_standardized_term"]:
            if e.get("pipeline_resolved_to"):
                sense_preference[e["pipeline_resolved_to"]] += 1
            if e.get("local_runner_up") == e["gold_standardized_term"]:
                local_disagreements["llm_wrong"] += 1
        else:
            if e.get("local_winner") and e["local_winner"] != e["gold_standardized_term"]:
                local_disagreements["llm_right"] += 1

    return {
        "total_fallback": total,
        "correct": correct,
        "incorrect": incorrect,
        "accuracy": round(correct / total, 3) if total > 0 else 0.0,
        "sense_preference_bias": dict(sense_preference) if sense_preference else None,
        "local_disagreements": local_disagreements,
        "note": f"Reviewed {total} fallback translations" + (
            f"; {local_disagreements['llm_right']} cases where LLM corrected local pass (informative for threshold tuning)"
            if local_disagreements["llm_right"] > 0 else ""
        ),
    }


# ── Dimension 5: Downstream impact (manual) ─────────────────

def downstream_impact_placeholder() -> dict:
    """Placeholder for manual downstream impact comparison."""
    return {
        "status": "requires_manual_review",
        "instructions": (
            "Compare 5 pre-vocabulary and 5 post-vocabulary document analyses side-by-side. "
            "Rate which mapping is more accurate for each document. "
            "Record results in dictionary/downstream_comparison.json."
        ),
        "pre_vocabulary_documents": [],
        "post_vocabulary_documents": [],
    }


# ── Parameter recommendations ────────────────────────────────

def recommend_adjustments(dim1: dict, dim2: dict, dim3: dict, dim4: dict) -> list[dict]:
    """Generate advisory parameter adjustment recommendations."""
    recommendations = []

    # Based on ambiguity rate
    amb = dim3["ambiguity_rate"]
    if amb < 0.05:
        recommendations.append({
            "parameter": "routing.top_score_threshold",
            "current": 0.55,
            "suggested": 0.60,
            "reason": f"Ambiguity rate {amb:.1%} is below 5% — system may be over-committing. Raising threshold increases ambiguity flagging.",
            "confidence": "medium",
        })
        recommendations.append({
            "parameter": "routing.margin_threshold",
            "current": 0.10,
            "suggested": 0.15,
            "reason": "Wider margin requirement makes the system more cautious on close calls.",
            "confidence": "medium",
        })
    elif amb > 0.15:
        recommendations.append({
            "parameter": "ensemble.w_p",
            "current": 0.15,
            "suggested": 0.20,
            "reason": f"Ambiguity rate {amb:.1%} exceeds 15% — characteristic phrases may be too weak. Increasing phrase weight may help disambiguation.",
            "confidence": "low",
        })
        recommendations.append({
            "parameter": "ensemble.phrase_noise_floor",
            "current": 0.50,
            "suggested": 0.40,
            "reason": "Lowering noise floor admits weaker phrase matches, which may help resolve borderline cases.",
            "confidence": "low",
        })

    # Based on camp confusion
    for warning in dim2.get("cross_camp_warnings", []):
        if warning["severity"] == "high":
            recommendations.append({
                "parameter": "dictionary_review",
                "affected_camps": f"{warning['gold_camp']} → {warning['predicted_camp']}",
                "reason": f"{warning['percentage']}% cross-camp confusion ({warning['gold_camp']} → {warning['predicted_camp']}). Review characteristic phrases for these camps' terms.",
                "confidence": "high",
            })

    # Based on fallback accuracy
    if dim4.get("total_fallback", 0) > 0:
        llm_corrections = dim4.get("local_disagreements", {}).get("llm_right", 0)
        if llm_corrections > 5:
            recommendations.append({
                "parameter": "routing.top_score_threshold",
                "current": 0.55,
                "suggested": 0.50,
                "reason": f"LLM corrected local pass {llm_corrections} times — consider lowering threshold to route more borderline cases to LLM.",
                "confidence": "medium",
            })

    # Based on flagged terms
    for flagged in dim1.get("flagged_terms", []):
        recommendations.append({
            "parameter": "dictionary_review",
            "affected_term": flagged["term"],
            "reason": f"Term '{flagged['term']}' flagged: {flagged.get('flag', 'low metrics')} (P={flagged['precision']}, R={flagged['recall']}). Review characteristic phrases and definition.",
            "confidence": "high",
        })

    return recommendations


# ── Main ─────────────────────────────────────────────────────

def load_validation_set(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("occurrences", data) if isinstance(data, dict) else data


def load_term_to_camp(dict_dir: Path) -> dict[str, str]:
    mapping = {}
    std_dir = dict_dir / "standardized"
    if std_dir.exists():
        for f in std_dir.glob("*.json"):
            try:
                term = json.loads(f.read_text(encoding="utf-8"))
                mapping[term["canonical_form"]] = term["primary_camp_origin"]
            except (json.JSONDecodeError, KeyError):
                pass
    return mapping


def main():
    parser = argparse.ArgumentParser(description="Calibrate translation pipeline")
    parser.add_argument("--data-root", help="Override data root directory")
    parser.add_argument("--validation-set", help="Path to validation set JSON")
    parser.add_argument("--output", help="Output path for calibration results")
    args = parser.parse_args()

    data_root = _resolve_data_root(args.data_root)
    dict_dir = data_root / "dictionary"

    vs_path = Path(args.validation_set) if args.validation_set else dict_dir / "validation_set.json"
    output_path = Path(args.output) if args.output else dict_dir / "calibration_results.json"

    if not vs_path.exists():
        print(f"ERROR: Validation set not found at {vs_path}", file=sys.stderr)
        print("Create the validation set first: dictionary/validation_set.json", file=sys.stderr)
        sys.exit(1)

    print(f"Data root: {data_root}", file=sys.stderr)
    print(f"Validation set: {vs_path}", file=sys.stderr)

    validation = load_validation_set(vs_path)
    term_to_camp = load_term_to_camp(dict_dir)

    print(f"Loaded {len(validation)} validation entries", file=sys.stderr)
    print(f"Loaded {len(term_to_camp)} term-to-camp mappings", file=sys.stderr)

    # Compute all five dimensions
    print("\nDimension 1: Per-term precision and recall...", file=sys.stderr)
    dim1 = compute_per_term_metrics(validation)

    print("Dimension 2: Per-camp confusion matrix...", file=sys.stderr)
    dim2 = compute_camp_confusion(validation, term_to_camp)

    print("Dimension 3: Ambiguity rate...", file=sys.stderr)
    dim3 = compute_ambiguity_rate(validation)

    print("Dimension 4: Fallback accuracy...", file=sys.stderr)
    dim4 = compute_fallback_accuracy(validation)

    print("Dimension 5: Downstream impact (manual)...", file=sys.stderr)
    dim5 = downstream_impact_placeholder()

    # Generate recommendations
    print("\nGenerating parameter recommendations...", file=sys.stderr)
    recommendations = recommend_adjustments(dim1, dim2, dim3, dim4)

    # Aggregate precision on high-confidence translations
    high_conf = [e for e in validation if e.get("pipeline_confidence") == "high"]
    high_correct = sum(1 for e in high_conf if e.get("pipeline_resolved_to") == e["gold_standardized_term"])
    high_precision = high_correct / len(high_conf) if high_conf else 0.0
    meets_target = high_precision >= 0.90

    results = {
        "generated_at": datetime.now().isoformat(),
        "validation_set": str(vs_path),
        "validation_count": len(validation),
        "aggregate": {
            "high_confidence_precision": round(high_precision, 3),
            "target": 0.90,
            "meets_target": meets_target,
            "high_confidence_count": len(high_conf),
        },
        "dimension_1_per_term": dim1,
        "dimension_2_camp_confusion": dim2,
        "dimension_3_ambiguity_rate": dim3,
        "dimension_4_fallback_accuracy": dim4,
        "dimension_5_downstream_impact": dim5,
        "recommendations": recommendations,
    }

    # Print summary
    print(f"\n{'='*60}", file=sys.stderr)
    print("CALIBRATION RESULTS", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)
    print(f"High-confidence precision: {high_precision:.1%} (target: >= 90%) {'PASS' if meets_target else 'FAIL'}", file=sys.stderr)
    print(f"Ambiguity rate: {dim3['ambiguity_rate']:.1%} (target: 5-15%) {dim3['status']}", file=sys.stderr)
    print(f"Flagged terms: {len(dim1['flagged_terms'])}", file=sys.stderr)
    print(f"Cross-camp warnings: {len(dim2['cross_camp_warnings'])}", file=sys.stderr)
    print(f"Recommendations: {len(recommendations)}", file=sys.stderr)

    if dim2["cross_camp_warnings"]:
        print(f"\nCamp confusion warnings:", file=sys.stderr)
        for w in dim2["cross_camp_warnings"]:
            print(f"  {w['gold_camp']} -> {w['predicted_camp']}: {w['percentage']}% ({w['severity']})", file=sys.stderr)

    if recommendations:
        print(f"\nTop recommendations:", file=sys.stderr)
        for r in recommendations[:5]:
            print(f"  - {r['reason']}", file=sys.stderr)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote results to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
