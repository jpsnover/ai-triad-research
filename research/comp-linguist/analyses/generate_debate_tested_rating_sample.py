"""
Debate-Tested Phase 4 reliability study — sample generator.

Produces:
  analyses/debate-tested-rating-sheet.csv     (blind, for raters)
  analyses/debate-tested-rating-manifest.json (includes current tier, not for raters)
  analyses/debate-tested-precursor-check.txt  (10-node manual verification report)

Seed: 1586  Strata: 15 per tier (60 total)
"""
import csv
import json
import pathlib
import random
import textwrap

SEED = 1586
STRATA_SIZE = 15
DATA_ROOT = pathlib.Path("C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin")
OUT_DIR = pathlib.Path("C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/analyses")
POV_FILES = ["accelerationist.json", "safetyist.json", "skeptic.json"]
TIERS = ["untested", "cited", "contested", "well_tested"]


def summarise_records(records):
    """Human-readable one-line-per-debate summary using the per-debate verdict.

    Uses `verdict` (the algorithm's per-debate assessment) rather than inferring
    challenge status from `strongest_attack_encountered` — that field records the
    strongest attack in the session regardless of whether it targeted this node directly.
    """
    if not records:
        return "No debate appearances."
    lines = []
    for r in records:
        date = r.get("date", "unknown")
        verdict = r.get("verdict", "unknown")
        attack = r.get("strongest_attack_encountered")
        outcomes = r.get("claim_outcomes") or {}
        thrived = outcomes.get("thrived", 0)
        survived = outcomes.get("survived", 0)
        died = outcomes.get("died", 0)

        if verdict == "cited":
            lines.append(f"  {date}: appeared — not directly challenged")
        elif verdict == "held":
            if attack:
                strength = round(attack.get("strength", 0), 2)
                scheme = attack.get("scheme", "")
                camp = attack.get("challenger_camp", "")
                lines.append(
                    f"  {date}: DIRECTLY CHALLENGED and held — {scheme} by {camp}, "
                    f"attack_strength={strength}, claims: thrived={thrived} survived={survived} died={died}"
                )
            else:
                lines.append(f"  {date}: challenged and held (attack details unavailable)")
        elif verdict == "weakened":
            if attack:
                strength = round(attack.get("strength", 0), 2)
                scheme = attack.get("scheme", "")
                camp = attack.get("challenger_camp", "")
                lines.append(
                    f"  {date}: DIRECTLY CHALLENGED and weakened — {scheme} by {camp}, "
                    f"attack_strength={strength}, claims: thrived={thrived} survived={survived} died={died}"
                )
            else:
                lines.append(f"  {date}: challenged and weakened (attack details unavailable)")
        elif verdict == "open":
            lines.append(
                f"  {date}: appeared — challenge outcome inconclusive "
                f"(claims: thrived={thrived} survived={survived} died={died})"
            )
        else:
            lines.append(f"  {date}: appeared (verdict={verdict})")
    return "\n".join(lines)


def get_tier(node):
    dt = (node.get("graph_attributes") or {}).get("debate_tested")
    if not dt:
        return "untested"
    return dt.get("tier", "untested")


def get_debate_tested(node):
    return (node.get("graph_attributes") or {}).get("debate_tested")


# Load all Belief nodes
by_tier = {t: [] for t in TIERS}
for fname in POV_FILES:
    pov = fname.replace(".json", "")
    data = json.loads((DATA_ROOT / fname).read_text(encoding="utf-8"))
    for node in data["nodes"]:
        if node.get("category") != "Beliefs":
            continue
        tier = get_tier(node)
        by_tier[tier].append((pov, node))

print("Tier population:")
for t in TIERS:
    print(f"  {t}: {len(by_tier[t])}")

# Stratified sample
rng = random.Random(SEED)
sample = []
for tier in TIERS:
    pool = by_tier[tier]
    n = min(STRATA_SIZE, len(pool))
    chosen = rng.sample(pool, n)
    for pov, node in chosen:
        sample.append((tier, pov, node))

print(f"\nSample size: {len(sample)}")
for t in TIERS:
    count = sum(1 for tier, _, _ in sample if tier == t)
    print(f"  {t}: {count}")

# Assign item IDs
rng.shuffle(sample)
items = []
for i, (tier, pov, node) in enumerate(sample):
    dt = get_debate_tested(node)
    records = (dt or {}).get("record", [])
    engagements = (dt or {}).get("engagements", 0)
    challenges = (dt or {}).get("challenges", 0)
    description = node.get("description", "")
    items.append({
        "item_id": f"DT-{i+1:03d}",
        "node_id": node.get("id", ""),
        "pov": pov,
        "label": node.get("label", ""),
        "description": description[:500] + ("..." if len(description) > 500 else ""),
        "debate_appearances": engagements,
        "direct_challenges": challenges,
        "testing_history": summarise_records(records),
        # manifest-only fields
        "_current_tier": tier,
        "_sort_key": (dt or {}).get("sort_key"),
        "_record_count": len(records),
    })

# Write blind rating sheet (no tier column)
rating_cols = [
    "item_id", "node_id", "label", "description",
    "debate_appearances", "direct_challenges", "testing_history",
    "rater_assigned_tier",  # empty, for rater to fill
    "rater_notes",          # empty, optional
]
sheet_path = OUT_DIR / "debate-tested-rating-sheet.csv"
with open(sheet_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=rating_cols)
    writer.writeheader()
    for item in items:
        writer.writerow({k: item.get(k, "") for k in rating_cols})
print(f"\nRating sheet written: {sheet_path}")

# Write manifest (includes current tier, not for raters)
manifest_path = OUT_DIR / "debate-tested-rating-manifest.json"
manifest = {
    "seed": SEED,
    "strata_size": STRATA_SIZE,
    "total_items": len(items),
    "tier_counts": {t: sum(1 for it in items if it["_current_tier"] == t) for t in TIERS},
    "items": [
        {
            "item_id": it["item_id"],
            "node_id": it["node_id"],
            "pov": it["pov"],
            "current_tier": it["_current_tier"],
            "sort_key": it["_sort_key"],
            "record_count": it["_record_count"],
        }
        for it in items
    ],
}
manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(f"Manifest written: {manifest_path}")

# Precursor check: verify algorithm tier matches human reading for first 10 items
print("\n=== PRECURSOR CHECK (first 10 items) ===")
print("Verify: does the record match the expected tier?\n")
for item in items[:10]:
    tier = item["_current_tier"]
    apps = item["debate_appearances"]
    challenges = item["direct_challenges"]
    history_preview = item["testing_history"][:200].replace("\n", " | ")
    expected_reason = {
        "untested": "0 appearances, no record",
        "cited": f"{apps} appearances, 0 direct challenges",
        "contested": f"{apps} appearances, {challenges} challenges, below well_tested threshold",
        "well_tested": f"{apps} appearances, {challenges} challenges, met threshold",
    }[tier]
    print(f"{item['item_id']} | {item['node_id']} | algo_tier={tier}")
    print(f"  Reason: {expected_reason}")
    print(f"  History: {history_preview[:180]}")
    print()
