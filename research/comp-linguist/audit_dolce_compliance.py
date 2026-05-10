#!/usr/bin/env python3
"""
DOLCE Compliance Audit Tool

Scans all POV taxonomy nodes and situation nodes for genus-differentia
format compliance. Reports violations per node with summary statistics.

7 compliance rules:
  1. Genus present: starts with "A [Belief|Desire|Intention] within..."
  2. Encompasses clause present with 2-5 items
  3. Excludes clause present with 1-3 items
  4. No forbidden sections (Qualified by, Note, However)
  5. No causal connectors in differentia (rendering, thereby, thus, therefore)
  6. Differentia is single-concept (no multi-clause chains)
  7. Excludes has no editorial commentary (no "that functions as", "which means")

Usage:
  python3 research/comp-linguist/audit_dolce_compliance.py [--json] [--verbose]
"""

import json
import re
import sys
from pathlib import Path
from collections import defaultdict

# ── Resolve data paths ────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
cfg = json.loads((REPO_ROOT / ".aitriad.json").read_text())
DATA_ROOT = (REPO_ROOT / cfg["data_root"]).resolve()
TAX_DIR = DATA_ROOT / cfg["taxonomy_dir"]

# ── Compliance checks ────────────────────────────────────

GENUS_PATTERN = re.compile(
    r"^An?\s+(Belief|Desire|Intention|situation)\s+within\s+",
    re.IGNORECASE,
)

SITUATION_GENUS_PATTERN = re.compile(
    r"^A\s+situation\s+(within|that|concept|in|where)\s+",
    re.IGNORECASE,
)

CAUSAL_CONNECTORS = re.compile(
    r"\b(rendering|thereby|thus|therefore|which means|contingent on|hence)\b",
    re.IGNORECASE,
)

FORBIDDEN_SECTIONS = re.compile(
    r"^(Qualified by|Note|However|Additionally|Furthermore|Moreover)\s*:",
    re.IGNORECASE | re.MULTILINE,
)

EDITORIAL_IN_EXCLUDES = re.compile(
    r"that\s+(functions? as|serves? as|acts? as|is essentially|amounts? to|which means)",
    re.IGNORECASE,
)


def check_genus(desc: str, node_id: str) -> list[str]:
    """Rule 1: Description starts with proper genus."""
    if not desc:
        return ["MISSING: no description"]
    first_line = desc.split("\n")[0].strip()
    if node_id.startswith("sit-") or node_id.startswith("cc-"):
        if not SITUATION_GENUS_PATTERN.match(first_line) and not GENUS_PATTERN.match(first_line):
            return [f"GENUS: doesn't start with 'A situation...' or 'A(n) [B/D/I] within...' — starts with: \"{first_line[:60]}\""]
    else:
        if not GENUS_PATTERN.match(first_line):
            return [f"GENUS: doesn't start with 'A(n) [Belief|Desire|Intention] within...' — starts with: \"{first_line[:60]}\""]
    return []


def check_encompasses(desc: str) -> list[str]:
    """Rule 2: Encompasses clause present with 2-5 items."""
    if "Encompasses:" not in desc and "encompasses:" not in desc:
        return ["ENCOMPASSES: clause missing"]

    match = re.search(r"Encompasses:\s*(.+?)(?:\n|Excludes:|$)", desc, re.IGNORECASE | re.DOTALL)
    if not match:
        return ["ENCOMPASSES: clause found but couldn't parse content"]

    content = match.group(1).strip().rstrip(".")
    # Count comma-separated items (rough heuristic)
    items = [i.strip() for i in content.split(",") if i.strip()]
    # Items separated by "and" at the end
    if items and " and " in items[-1]:
        last_parts = items[-1].split(" and ")
        items = items[:-1] + [p.strip() for p in last_parts if p.strip()]

    violations = []
    if len(items) < 2:
        violations.append(f"ENCOMPASSES: only {len(items)} item(s) — need 2-5")
    elif len(items) > 6:
        violations.append(f"ENCOMPASSES: {len(items)} items — should be 2-5 (may be too broad)")
    return violations


def check_excludes(desc: str) -> list[str]:
    """Rule 3: Excludes clause present with 1-3 items."""
    if "Excludes:" not in desc and "excludes:" not in desc:
        return ["EXCLUDES: clause missing"]

    match = re.search(r"Excludes:\s*(.+?)$", desc, re.IGNORECASE | re.DOTALL)
    if not match:
        return ["EXCLUDES: clause found but couldn't parse content"]

    content = match.group(1).strip().rstrip(".")
    items = [i.strip() for i in content.split(",") if i.strip()]
    if items and " and " in items[-1]:
        last_parts = items[-1].split(" and ")
        items = items[:-1] + [p.strip() for p in last_parts if p.strip()]

    violations = []
    if len(items) < 1:
        violations.append("EXCLUDES: no items found")
    elif len(items) > 4:
        violations.append(f"EXCLUDES: {len(items)} items — should be 1-3")
    return violations


def check_forbidden_sections(desc: str) -> list[str]:
    """Rule 4: No forbidden appended sections."""
    matches = FORBIDDEN_SECTIONS.findall(desc)
    if matches:
        return [f"FORBIDDEN SECTION: '{m}:' found — content belongs in assumes field or separate node" for m in matches]
    return []


def check_causal_connectors(desc: str) -> list[str]:
    """Rule 5: No causal connectors in differentia (first line)."""
    first_line = desc.split("\n")[0] if desc else ""
    # Only check up to Encompasses
    differentia = first_line.split("Encompasses:")[0] if "Encompasses:" in first_line else first_line

    matches = CAUSAL_CONNECTORS.findall(differentia)
    if matches:
        return [f"CAUSAL CONNECTOR: '{m}' in differentia — state what the position IS, not why it's correct" for m in matches]
    return []


def check_single_concept(desc: str) -> list[str]:
    """Rule 6: Differentia is single-concept (heuristic: no semicolons or multiple 'that' clauses)."""
    first_line = desc.split("\n")[0] if desc else ""
    differentia = first_line.split("Encompasses:")[0] if "Encompasses:" in first_line else first_line

    violations = []
    if ";" in differentia:
        violations.append("MULTI-CONCEPT: semicolon in differentia suggests multiple concepts packed together")

    # Count 'that' clauses after the genus
    that_count = differentia.lower().count(" that ")
    if that_count > 2:
        violations.append(f"MULTI-CONCEPT: {that_count} 'that' clauses in differentia — may be overloaded")

    # Check for very long differentia (> 250 chars before Encompasses)
    if len(differentia) > 300:
        violations.append(f"OVERLOADED: differentia is {len(differentia)} chars — consider simplifying")

    return violations


def check_excludes_editorial(desc: str) -> list[str]:
    """Rule 7: Excludes items don't contain editorial commentary."""
    match = re.search(r"Excludes:\s*(.+?)$", desc, re.IGNORECASE | re.DOTALL)
    if not match:
        return []

    excludes_content = match.group(1)
    matches = EDITORIAL_IN_EXCLUDES.findall(excludes_content)
    if matches:
        return [f"EDITORIAL IN EXCLUDES: '{m}' — name the excluded concept neutrally, don't argue why it's excluded" for m in matches]
    return []


def audit_node(node_id: str, description: str) -> list[str]:
    """Run all 7 checks on a single node."""
    if not description:
        return ["MISSING: no description"]

    violations = []
    violations.extend(check_genus(description, node_id))
    violations.extend(check_encompasses(description))
    violations.extend(check_excludes(description))
    violations.extend(check_forbidden_sections(description))
    violations.extend(check_causal_connectors(description))
    violations.extend(check_single_concept(description))
    violations.extend(check_excludes_editorial(description))
    return violations


# ── Main ────────────────────────────────────────────────

def main():
    json_output = "--json" in sys.argv
    verbose = "--verbose" in sys.argv

    # Load all nodes
    all_nodes = []
    for f in sorted(TAX_DIR.glob("*.json")):
        if f.name.startswith("_") or f.name in (
            "embeddings.json", "edges.json", "lineage_categories.json",
            "policy_actions.json",
        ):
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8-sig"))
        except (json.JSONDecodeError, OSError):
            continue

        nodes = []
        if isinstance(data, dict):
            for cat in ("beliefs", "desires", "intentions", "nodes"):
                nodes.extend(data.get(cat, []))
        elif isinstance(data, list):
            nodes = data

        pov = f.stem.replace("_", "")
        for node in nodes:
            node_id = node.get("id", "unknown")
            description = node.get("description", "")
            label = node.get("label", "")
            category = node.get("category", "")
            all_nodes.append({
                "id": node_id,
                "label": label,
                "category": category,
                "pov": pov,
                "description": description,
            })

    # Audit each node
    results = []
    for node in all_nodes:
        violations = audit_node(node["id"], node["description"])
        results.append({
            "id": node["id"],
            "label": node["label"],
            "pov": node["pov"],
            "category": node["category"],
            "violations": violations,
            "compliant": len(violations) == 0,
        })

    # Summary statistics
    total = len(results)
    compliant = sum(1 for r in results if r["compliant"])
    non_compliant = total - compliant

    by_pov = defaultdict(lambda: {"total": 0, "compliant": 0, "violations": defaultdict(int)})
    by_category = defaultdict(lambda: {"total": 0, "compliant": 0})
    violation_counts = defaultdict(int)

    for r in results:
        pov = r["pov"]
        cat = r["category"] or "situations"
        by_pov[pov]["total"] += 1
        by_category[cat]["total"] += 1
        if r["compliant"]:
            by_pov[pov]["compliant"] += 1
            by_category[cat]["compliant"] += 1
        for v in r["violations"]:
            rule = v.split(":")[0]
            violation_counts[rule] += 1
            by_pov[pov]["violations"][rule] += 1

    if json_output:
        output = {
            "total_nodes": total,
            "compliant": compliant,
            "non_compliant": non_compliant,
            "compliance_rate": round(compliant / total * 100, 1) if total else 0,
            "by_pov": {k: {"total": v["total"], "compliant": v["compliant"], "rate": round(v["compliant"]/v["total"]*100, 1) if v["total"] else 0} for k, v in by_pov.items()},
            "by_category": {k: {"total": v["total"], "compliant": v["compliant"], "rate": round(v["compliant"]/v["total"]*100, 1) if v["total"] else 0} for k, v in by_category.items()},
            "violation_counts": dict(violation_counts),
            "non_compliant_nodes": [r for r in results if not r["compliant"]],
        }
        print(json.dumps(output, indent=2))
    else:
        print(f"\n=== DOLCE Compliance Audit ===")
        print(f"Total nodes: {total}")
        rate = compliant / total * 100 if total else 0
        print(f"Compliant: {compliant} ({rate:.1f}%)")
        print(f"Non-compliant: {non_compliant} ({100 - rate:.1f}%)")

        print(f"\n--- By POV ---")
        for pov, stats in sorted(by_pov.items()):
            rate = stats["compliant"] / stats["total"] * 100 if stats["total"] else 0
            print(f"  {pov:20s} {stats['compliant']:3d}/{stats['total']:3d} ({rate:.0f}%)")

        print(f"\n--- By Category ---")
        for cat, stats in sorted(by_category.items()):
            rate = stats["compliant"] / stats["total"] * 100 if stats["total"] else 0
            print(f"  {cat:20s} {stats['compliant']:3d}/{stats['total']:3d} ({rate:.0f}%)")

        print(f"\n--- Violation Types ---")
        for rule, count in sorted(violation_counts.items(), key=lambda x: -x[1]):
            print(f"  {count:4d}x  {rule}")

        if verbose:
            print(f"\n--- Non-Compliant Nodes (worst first) ---")
            worst = sorted([r for r in results if not r["compliant"]], key=lambda r: -len(r["violations"]))
            for r in worst[:30]:
                print(f"\n  [{r['id']}] {r['label']}")
                for v in r["violations"]:
                    print(f"    ✗ {v}")


if __name__ == "__main__":
    main()
