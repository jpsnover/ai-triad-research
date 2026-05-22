#!/usr/bin/env python3
"""Integrate Level 2 lineage clusters into lineage_categories.json.

Reads:
  - ../ai-triad-data/taxonomy/Origin/lineage_categories.json (existing L1)
  - research/comp-linguist/docs/lineage-level2-clusters.json (L2 source)

Writes:
  - ../ai-triad-data/taxonomy/Origin/lineage_categories.json (updated with L2)

One-time migration script for t/60.
"""

import json
import os
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
DATA_ROOT = os.path.join(os.path.dirname(ROOT), "ai-triad-data")

L1_FILE = os.path.join(DATA_ROOT, "taxonomy", "Origin", "lineage_categories.json")
L2_FILE = os.path.join(ROOT, "research", "comp-linguist", "docs", "lineage-level2-clusters.json")

# ── L2 cluster → L1 parent mapping ───────────────────────
# Manual semantic assignment based on curated cluster labels.

L2_TO_L1 = {
    0: "ai-ml",               # AI Safety & Alignment
    1: "sts",                  # Technology & Society
    2: "economics",            # Labor & Political Economy
    3: "political-legal",      # Regulation & Institutional Economics
    4: "ethics-moral",         # Legal Theory & Applied Ethics
    5: "sts",                  # Cybernetics & Systems Theory
    6: "risk-security",        # Security Engineering & Infrastructure
    7: "philosophy-epistemology",  # Cognitive Science & Philosophy of Mind
    8: "risk-security",        # Risk Assessment & Existential Risk
    9: "ethics-moral",         # Transhumanism & Moral Philosophy
    10: "social-behavioral",   # Critical Theory & Social Justice
    11: "ai-ml",               # Software Engineering & Auditing
    12: "social-behavioral",   # Human-Computer Interaction & Design
    13: "ai-ml",               # Algorithmic Fairness & Privacy
    14: "political-legal",     # Environmental & Climate Governance
    15: "techno-movements",    # Open Source & Digital Rights
    16: "formal-math",         # Information Theory & Knowledge
    17: "social-behavioral",   # Media, Disinformation & Surveillance
    18: "sts",                 # Science & Technology Studies
    19: "risk-security",       # Nuclear Nonproliferation Analogies
    20: "philosophy-epistemology",  # Pragmatism & Policy Debate
    21: "techno-movements",    # Accelerationism
    22: "formal-math",         # Complexity & Network Theory
    23: "ai-ml",               # Scaling Laws & Compute
    24: "ai-ml",               # Value Alignment
    25: "techno-movements",    # Digital Commons & Literacy
    26: "formal-math",         # Statistical Fairness & Psychometrics
    27: "ai-ml",               # NLP & Information Retrieval
    28: "political-legal",     # Fiduciary Law & Foucault
    29: "philosophy-epistemology",  # Cosmic Evolution & Naturalism
    30: "sts",                 # Technological Forecasting
    31: "economics",           # Financial Instability & Bubbles
    32: "sts",                 # Agile & Project Management
    33: "ai-ml",               # Instrumental Convergence
    34: "ai-ml",               # Transformer circuits...
    35: "formal-math",         # Dissipative structures theory
    36: "social-behavioral",   # Harm reduction approaches
    37: "techno-movements",    # Teilhard de Chardin (Omega Point)
    38: "sts",                 # Enterprise architecture frameworks
    39: "political-legal",     # Conditional spending doctrine
    40: "philosophy-epistemology",  # Philosophy of mind (Searle)
    41: "economics",           # Bastiat's Broken Window Fallacy
    42: "risk-security",       # ISO standardization principles
    43: "economics",           # Degrowth movement
    44: "political-legal",     # Checks and balances
    45: "risk-security",       # Red teaming
    46: "philosophy-epistemology",  # King Midas problem
    47: "political-legal",     # Realpolitik
    48: "techno-movements",    # Cypherpunk
    49: "economics",           # Hayekian spontaneous order
    50: "ai-ml",               # Post-hoc calibration methods
    51: "risk-security",       # Drug approval processes
    52: "risk-security",       # Pre-mortem technique
    53: "economics",           # Kondratiev waves
    54: "philosophy-epistemology",  # Socratic method
}


def make_l2_id(curated_label: str) -> str:
    """Convert curated label to kebab-case ID."""
    import re
    s = curated_label.lower()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"\s+", "-", s.strip())
    s = re.sub(r"-+", "-", s)
    return s[:50]  # cap length


def main():
    with open(L1_FILE, "r", encoding="utf-8") as f:
        existing = json.load(f)

    with open(L2_FILE, "r", encoding="utf-8") as f:
        l2_data = json.load(f)

    # Preserve existing L1 categories
    categories = existing["categories"]

    # Build L2 categories array
    level2_categories = []
    cluster_id_map = {}  # cluster_id → l2_id
    for cluster in l2_data["clusters"]:
        cid = cluster["cluster_id"]
        l2_id = make_l2_id(cluster["curated_label"])
        l1_parent = L2_TO_L1[cid]
        cluster_id_map[cid] = l2_id
        level2_categories.append({
            "id": l2_id,
            "label": cluster["curated_label"],
            "l1_parent": l1_parent,
            "member_count": cluster["member_count"],
        })

    # Build expanded mapping: all 1,501 names → {l1, l2}
    # Start with existing L1 mappings as base
    old_mapping = existing.get("mapping", {})
    new_mapping = {}

    # First, process all L2 cluster members
    for cluster in l2_data["clusters"]:
        cid = cluster["cluster_id"]
        l2_id = cluster_id_map[cid]
        l1_id = L2_TO_L1[cid]
        for member in cluster["members"]:
            name = member["name"]
            # If existing L1 mapping exists, prefer it over inferred L1
            existing_l1 = old_mapping.get(name)
            if existing_l1 and isinstance(existing_l1, str):
                final_l1 = existing_l1
            else:
                final_l1 = l1_id
            new_mapping[name] = {"l1": final_l1, "l2": l2_id}

    # Add any existing mapping entries not covered by L2 clusters
    for name, l1_val in old_mapping.items():
        if name not in new_mapping:
            l1 = l1_val if isinstance(l1_val, str) else l1_val.get("l1", "uncategorized")
            new_mapping[name] = {"l1": l1, "l2": "uncategorized"}

    # Build output
    output = {
        "description": "Intellectual lineage category taxonomy. Maps lineage values to Level 1 and Level 2 categories.",
        "generated_at": existing["generated_at"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "categories": categories,
        "level2_categories": level2_categories,
        "mapping": dict(sorted(new_mapping.items())),
    }

    with open(L1_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
        f.write("\n")

    # Stats
    total_mapped = len(new_mapping)
    l2_covered = sum(1 for v in new_mapping.values() if v["l2"] != "uncategorized")
    print(f"Total mapped names: {total_mapped}")
    print(f"L2 covered: {l2_covered}")
    print(f"L2 categories: {len(level2_categories)}")
    print(f"L1 categories: {len(categories)}")
    print(f"Wrote: {L1_FILE}")


if __name__ == "__main__":
    main()
