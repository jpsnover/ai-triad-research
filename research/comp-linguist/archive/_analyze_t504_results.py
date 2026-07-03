"""
Analyze t/504 salience beacon A/B experiment results.
Extracts scope_drift_check warnings and topic_aligned pass rates
from control vs treatment debate diagnostics.
"""
import json
import glob
import os
from pathlib import Path

DEBATES_DIR = Path(__file__).resolve().parent.parent.parent / "debates"

TOPICS = [
    "labor-market",
    "naiicp",
    "tiered-liability",
    "siloed-datasets",
    "copyright-law",
]

def load_diagnostics(name: str) -> dict | None:
    pattern = str(DEBATES_DIR / f"{name}-diagnostics.json")
    matches = glob.glob(pattern)
    if not matches:
        return None
    with open(matches[0], "r", encoding="utf-8") as f:
        return json.load(f)

def extract_metrics(diag: dict) -> dict:
    """Extract key metrics from a debate diagnostics file."""
    entries = diag.get("entries", {})

    total_warnings = 0
    total_scope_checks = 0
    topic_aligned_pass = 0
    topic_aligned_total = 0
    refs_checked_total = 0
    total_claims_accepted = 0
    total_claims_rejected = 0
    total_turns = 0

    for key, entry in entries.items():
        if key == "session_init":
            continue

        # Scope drift check
        sdc = entry.get("scope_drift_check", {})
        if sdc.get("checked"):
            total_scope_checks += 1
            warnings = sdc.get("warnings", [])
            total_warnings += len(warnings)
            refs_checked_total += sdc.get("refs_checked", 0)

        # Stage diagnostics — look for topic_aligned in quality checks
        for sd in entry.get("stage_diagnostics", []):
            qa = sd.get("quality_assessment", {})
            if "topic_aligned" in qa:
                topic_aligned_total += 1
                if qa["topic_aligned"]:
                    topic_aligned_pass += 1

        # Extracted claims
        ec = entry.get("extracted_claims", {})
        if ec:
            total_claims_accepted += len(ec.get("accepted", []))
            total_claims_rejected += len(ec.get("rejected", []))

        total_turns += 1

    return {
        "total_turns": total_turns,
        "scope_drift_warnings": total_warnings,
        "scope_checks_performed": total_scope_checks,
        "refs_checked": refs_checked_total,
        "topic_aligned_pass": topic_aligned_pass,
        "topic_aligned_total": topic_aligned_total,
        "topic_aligned_rate": (topic_aligned_pass / topic_aligned_total * 100) if topic_aligned_total > 0 else None,
        "claims_accepted": total_claims_accepted,
        "claims_rejected": total_claims_rejected,
    }

def main():
    print("=" * 70)
    print("t/504 Salience Beacon A/B Experiment Results")
    print("=" * 70)

    results = {"control": {}, "treatment": {}}

    for condition in ["control", "treatment"]:
        print(f"\n--- {condition.upper()} ---")
        for topic in TOPICS:
            name = f"t504-{condition}-{topic}"
            diag = load_diagnostics(name)
            if diag is None:
                print(f"  {topic}: NOT FOUND")
                continue

            metrics = extract_metrics(diag)
            results[condition][topic] = metrics
            print(f"  {topic}:")
            print(f"    turns={metrics['total_turns']}, "
                  f"drift_warnings={metrics['scope_drift_warnings']}, "
                  f"scope_checks={metrics['scope_checks_performed']}, "
                  f"refs_checked={metrics['refs_checked']}")
            if metrics["topic_aligned_total"] > 0:
                print(f"    topic_aligned={metrics['topic_aligned_pass']}/{metrics['topic_aligned_total']} "
                      f"({metrics['topic_aligned_rate']:.1f}%)")
            print(f"    claims: {metrics['claims_accepted']} accepted, "
                  f"{metrics['claims_rejected']} rejected")

    # Summary comparison
    print("\n" + "=" * 70)
    print("SUMMARY COMPARISON")
    print("=" * 70)

    for metric_name in ["scope_drift_warnings", "claims_accepted", "total_turns"]:
        ctrl_vals = [v[metric_name] for v in results["control"].values()]
        treat_vals = [v[metric_name] for v in results["treatment"].values()]

        if ctrl_vals and treat_vals:
            ctrl_avg = sum(ctrl_vals) / len(ctrl_vals)
            treat_avg = sum(treat_vals) / len(treat_vals)
            print(f"\n{metric_name}:")
            print(f"  Control avg:   {ctrl_avg:.2f} (n={len(ctrl_vals)})")
            print(f"  Treatment avg: {treat_avg:.2f} (n={len(treat_vals)})")
            if ctrl_avg > 0:
                delta_pct = (treat_avg - ctrl_avg) / ctrl_avg * 100
                print(f"  Delta: {delta_pct:+.1f}%")

    # Topic-aligned rate comparison
    ctrl_aligned = sum(v.get("topic_aligned_pass", 0) for v in results["control"].values())
    ctrl_aligned_total = sum(v.get("topic_aligned_total", 0) for v in results["control"].values())
    treat_aligned = sum(v.get("topic_aligned_pass", 0) for v in results["treatment"].values())
    treat_aligned_total = sum(v.get("topic_aligned_total", 0) for v in results["treatment"].values())

    if ctrl_aligned_total > 0 and treat_aligned_total > 0:
        print(f"\ntopic_aligned_rate:")
        print(f"  Control:   {ctrl_aligned}/{ctrl_aligned_total} ({ctrl_aligned/ctrl_aligned_total*100:.1f}%)")
        print(f"  Treatment: {treat_aligned}/{treat_aligned_total} ({treat_aligned/treat_aligned_total*100:.1f}%)")

if __name__ == "__main__":
    main()
