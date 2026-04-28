#!/usr/bin/env python3

"""
reprocess_taxonomy_vocabulary.py — Replace bare colloquial terms in taxonomy
nodes with standardized display forms.

For each node, uses the node's camp to determine the default sense for each
bare term, then replaces occurrences in prose fields with display forms.
Adds a vocabulary_annotations field to each node for machine-readable lookup.

Labels are NOT modified (they're short titles used as identifiers).
Intellectual lineage is NOT modified (proper names and citations).

Usage:
    python scripts/reprocess_taxonomy_vocabulary.py [--data-root PATH] [--dry-run] [--camp CAMP]
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from copy import deepcopy
from datetime import date
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
TODAY = date.today().isoformat()


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


def load_colloquial_terms(dict_dir: Path) -> dict[str, dict]:
    terms = {}
    col_dir = dict_dir / "colloquial"
    if col_dir.exists():
        for f in col_dir.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                terms[data["colloquial_term"]] = data
            except (json.JSONDecodeError, KeyError):
                pass
    return terms


def load_standardized_terms(dict_dir: Path) -> dict[str, dict]:
    terms = {}
    std_dir = dict_dir / "standardized"
    if std_dir.exists():
        for f in std_dir.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                terms[data["canonical_form"]] = data
            except (json.JSONDecodeError, KeyError):
                pass
    return terms


# Preferences for terms that lack a camp-specific default_for_camp.
# Phase 2 terms have only acc/saf defaults; Phase 4 terms may lack one camp.
CAMP_PREFERENCES = {
    "skeptic": {
        "safety": "safety_empirical",
        "governance": "governance_oversight",
        "risk": "risk_existential",
        "capabilities": "capabilities_hazard",
        "oversight": "oversight_audit",
        "control": "control_human_agency",
        "transparency": "transparency_accountability",
        "regulation": "regulation_precautionary",
    },
    "safetyist": {
        "bias": "bias_systemic",  # safetyists frame bias as structural, not just statistical
    },
    "accelerationist": {
        "harm": "documented_present_harm",
    },
    "situation": {
        # Neutral defaults for cross-cutting situation nodes
        "safety": "safety_empirical",
        "risk": "risk_existential",
        "capabilities": "capabilities_scaling",
        "governance": "governance_oversight",
        "oversight": "oversight_audit",
        "control": "control_human_agency",
        "transparency": "transparency_accountability",
        "regulation": "regulation_precautionary",
        "bias": "bias_systemic",
        "harm": "documented_present_harm",
        "fairness": "fairness_procedural",
        "accountability": "accountability_institutional",
        "alignment": "safety_alignment",
        "autonomy": "autonomy_human",
    },
}


def resolve_term_for_camp(
    bare_term: str,
    camp: str,
    context: str,
    colloquial_terms: dict[str, dict],
    standardized_terms: dict[str, dict],
) -> tuple[str, str, str]:
    """Resolve a bare term to its standardized display form for a given camp.

    Returns (display_form, canonical_form, confidence).
    Resolution order: context phrases (2+) → camp default → skeptic preference → context (1+) → first fallback.
    """
    col = colloquial_terms.get(bare_term)
    if not col:
        return bare_term, "", "none"

    resolutions = col.get("resolves_to", [])
    if not resolutions:
        return bare_term, "", "none"

    # Try context-based matching using characteristic phrases
    scored = []
    context_lower = context.lower()

    for res in resolutions:
        std_term = standardized_terms.get(res["standardized_term"])
        if not std_term:
            continue
        phrases = std_term.get("characteristic_phrases", [])
        score = sum(1 for p in phrases if p.lower() in context_lower)
        scored.append((res, score))

    scored.sort(key=lambda x: -x[1])

    # Strong context match (2+ phrase hits) overrides everything
    if scored and scored[0][1] >= 2:
        canonical = scored[0][0]["standardized_term"]
        display = standardized_terms[canonical]["display_form"]
        return display, canonical, "context"

    # Camp default
    for res in resolutions:
        if res.get("default_for_camp") == camp:
            canonical = res["standardized_term"]
            std = standardized_terms.get(canonical)
            if std:
                return std["display_form"], canonical, "camp_default"

    # Camp-specific preference for terms without a default
    camp_prefs = CAMP_PREFERENCES.get(camp, {})
    if bare_term in camp_prefs:
        canonical = camp_prefs[bare_term]
        std = standardized_terms.get(canonical)
        if std:
            return std["display_form"], canonical, "camp_preference"

    # Weak context match (1 phrase hit) — better than blind fallback
    if scored and scored[0][1] >= 1:
        canonical = scored[0][0]["standardized_term"]
        display = standardized_terms[canonical]["display_form"]
        return display, canonical, "weak_context"

    # Last resort: first resolution
    if resolutions:
        canonical = resolutions[0]["standardized_term"]
        std = standardized_terms.get(canonical)
        if std:
            return std["display_form"], canonical, "first_fallback"

    return bare_term, "", "unresolved"


_PLACEHOLDER_PREFIX = "\x00VOCAB_"
_PLACEHOLDER_SUFFIX = "\x00"


def replace_bare_terms_in_text(
    text: str,
    camp: str,
    colloquial_terms: dict[str, dict],
    standardized_terms: dict[str, dict],
) -> tuple[str, list[dict]]:
    """Replace bare colloquial terms in text with display forms.

    Uses placeholder tokens to prevent display forms (which contain bare terms
    like 'oversight' in 'governance (oversight)') from being double-matched.
    Pre-existing display forms are protected so re-runs are idempotent.
    """
    if not text or not isinstance(text, str):
        return text, []

    annotations = []
    placeholders: dict[str, str] = {}
    placeholder_id = 0

    # Protect pre-existing display forms so re-runs don't nest them.
    # Sort longest first so "alignment (safety)" is matched before "safety (empirical)".
    all_display_forms = sorted(
        (std["display_form"] for std in standardized_terms.values() if std.get("display_form")),
        key=len, reverse=True,
    )
    for df in all_display_forms:
        pattern = re.compile(re.escape(df), re.IGNORECASE)
        for m in reversed(list(pattern.finditer(text))):
            token = f"{_PLACEHOLDER_PREFIX}{placeholder_id}{_PLACEHOLDER_SUFFIX}"
            placeholders[token] = m.group(0)
            placeholder_id += 1
            text = text[:m.start()] + token + text[m.end():]

    sorted_terms = sorted(colloquial_terms.keys(), key=len, reverse=True)

    for bare_term in sorted_terms:
        pattern = re.compile(
            rf"(?<![a-zA-Z_\-])({re.escape(bare_term)})(?![a-zA-Z_\-\x00])",
            re.IGNORECASE,
        )

        matches = list(pattern.finditer(text))
        if not matches:
            continue

        for match in reversed(matches):
            start, end = match.start(), match.end()
            original = match.group(0)

            ctx_start = max(0, start - 200)
            ctx_end = min(len(text), end + 200)
            context = text[ctx_start:ctx_end]

            display, canonical, confidence = resolve_term_for_camp(
                bare_term, camp, context, colloquial_terms, standardized_terms,
            )

            if canonical and display != original:
                # Skip if the display form's qualifier already appears adjacent,
                # e.g. "existential risk" doesn't need → "existential risk (existential)"
                qualifier_match = re.search(r"\(([^)]+)\)", display)
                if qualifier_match:
                    qualifier = qualifier_match.group(1).lower()
                    qual_word = qualifier.split("/")[0].split(",")[0].strip()
                    nearby = text[max(0, start - 50):min(len(text), end + 50)].lower()
                    nearby_without = nearby.replace(bare_term.lower(), "", 1)
                    # Word-boundary match to avoid "safety" matching inside "safetyist"
                    if re.search(rf"(?<![a-zA-Z]){re.escape(qual_word)}(?![a-zA-Z])", nearby_without):
                        continue

                if original[0].isupper() and display[0].islower():
                    display = display[0].upper() + display[1:]

                token = f"{_PLACEHOLDER_PREFIX}{placeholder_id}{_PLACEHOLDER_SUFFIX}"
                placeholders[token] = display
                placeholder_id += 1

                text = text[:start] + token + text[end:]
                annotations.append({
                    "original": original,
                    "resolved_to": canonical,
                    "display_form": display,
                    "confidence": confidence,
                })

    # Restore placeholders → display forms
    for token, display in placeholders.items():
        text = text.replace(token, display)

    return text, annotations


def process_node(
    node: dict,
    camp: str,
    colloquial_terms: dict[str, dict],
    standardized_terms: dict[str, dict],
) -> tuple[dict, list[dict]]:
    """Process a single taxonomy node, replacing bare terms in text fields."""
    node = deepcopy(node)
    all_annotations = []
    ga = node.get("graph_attributes", {})

    # Process description
    if node.get("description"):
        text, anns = replace_bare_terms_in_text(
            node["description"], camp, colloquial_terms, standardized_terms,
        )
        node["description"] = text
        all_annotations.extend(anns)

    # Process parent_rationale
    if node.get("parent_rationale"):
        text, anns = replace_bare_terms_in_text(
            node["parent_rationale"], camp, colloquial_terms, standardized_terms,
        )
        node["parent_rationale"] = text
        all_annotations.extend(anns)

    # Process steelman_vulnerability
    if ga.get("steelman_vulnerability"):
        text, anns = replace_bare_terms_in_text(
            ga["steelman_vulnerability"], camp, colloquial_terms, standardized_terms,
        )
        ga["steelman_vulnerability"] = text
        all_annotations.extend(anns)

    # Process assumes[]
    if ga.get("assumes"):
        new_assumes = []
        for item in ga["assumes"]:
            if isinstance(item, str):
                text, anns = replace_bare_terms_in_text(
                    item, camp, colloquial_terms, standardized_terms,
                )
                new_assumes.append(text)
                all_annotations.extend(anns)
            else:
                new_assumes.append(item)
        ga["assumes"] = new_assumes

    # Process policy_actions[].action and .framing
    if ga.get("policy_actions"):
        for pa in ga["policy_actions"]:
            if isinstance(pa, dict):
                if pa.get("action"):
                    text, anns = replace_bare_terms_in_text(
                        pa["action"], camp, colloquial_terms, standardized_terms,
                    )
                    pa["action"] = text
                    all_annotations.extend(anns)
                if pa.get("framing"):
                    text, anns = replace_bare_terms_in_text(
                        pa["framing"], camp, colloquial_terms, standardized_terms,
                    )
                    pa["framing"] = text
                    all_annotations.extend(anns)

    # Process possible_fallacies[].explanation
    if ga.get("possible_fallacies"):
        for pf in ga["possible_fallacies"]:
            if isinstance(pf, dict) and pf.get("explanation"):
                text, anns = replace_bare_terms_in_text(
                    pf["explanation"], camp, colloquial_terms, standardized_terms,
                )
                pf["explanation"] = text
                all_annotations.extend(anns)

    node["graph_attributes"] = ga

    # Process interpretations (situation nodes) — each camp's text uses that camp's resolution
    if node.get("interpretations") and isinstance(node["interpretations"], dict):
        for interp_camp, interp_data in node["interpretations"].items():
            if not isinstance(interp_data, dict):
                continue
            resolve_camp = interp_camp  # Use the interpretation's own camp
            for field in ("belief", "desire", "intention", "summary"):
                if interp_data.get(field) and isinstance(interp_data[field], str):
                    text, anns = replace_bare_terms_in_text(
                        interp_data[field], resolve_camp, colloquial_terms, standardized_terms,
                    )
                    interp_data[field] = text
                    all_annotations.extend(anns)

    # Add vocabulary annotations
    if all_annotations:
        # Deduplicate by canonical form
        seen = set()
        unique = []
        for ann in all_annotations:
            key = ann["resolved_to"]
            if key not in seen:
                seen.add(key)
                unique.append(key)
        node["vocabulary_terms"] = unique

    return node, all_annotations


def main():
    parser = argparse.ArgumentParser(description="Reprocess taxonomy with standardized vocabulary")
    parser.add_argument("--data-root", help="Override data root directory")
    parser.add_argument("--dry-run", action="store_true", help="Show changes without writing files")
    parser.add_argument("--camp", help="Process only one camp (accelerationist, safetyist, skeptic)")
    parser.add_argument("--verbose", action="store_true", help="Show per-node details")
    args = parser.parse_args()

    data_root = _resolve_data_root(args.data_root)
    dict_dir = data_root / "dictionary"
    taxonomy_dir = data_root / "taxonomy" / "Origin"

    colloquial_terms = load_colloquial_terms(dict_dir)
    standardized_terms = load_standardized_terms(dict_dir)
    print(f"Loaded {len(colloquial_terms)} colloquial, {len(standardized_terms)} standardized terms", file=sys.stderr)

    camps = [args.camp] if args.camp else ["accelerationist", "safetyist", "skeptic", "situation"]

    total_replacements = 0
    total_nodes = 0
    camp_stats = {}

    for camp in camps:
        fname = "situations.json" if camp == "situation" else f"{camp}.json"
        fpath = taxonomy_dir / fname
        if not fpath.exists():
            print(f"WARNING: {fpath} not found, skipping", file=sys.stderr)
            continue

        data = json.loads(fpath.read_text(encoding="utf-8"))
        nodes = data["nodes"]
        print(f"\nProcessing {camp}: {len(nodes)} nodes", file=sys.stderr)

        replacement_counts = defaultdict(int)
        confidence_counts = defaultdict(int)
        new_nodes = []

        for node in nodes:
            processed, annotations = process_node(node, camp, colloquial_terms, standardized_terms)
            new_nodes.append(processed)

            for ann in annotations:
                replacement_counts[ann["resolved_to"]] += 1
                confidence_counts[ann["confidence"]] += 1

            if args.verbose and annotations:
                print(f"  {node['id']}: {len(annotations)} replacements", file=sys.stderr)
                for ann in annotations[:5]:
                    print(f"    '{ann['original']}' → {ann['display_form']} ({ann['confidence']})", file=sys.stderr)

        camp_total = sum(replacement_counts.values())
        total_replacements += camp_total
        total_nodes += len(nodes)
        camp_stats[camp] = {
            "nodes": len(nodes),
            "replacements": camp_total,
            "by_term": dict(sorted(replacement_counts.items(), key=lambda x: -x[1])),
            "by_confidence": dict(confidence_counts),
        }

        print(f"  Replacements: {camp_total}", file=sys.stderr)
        print(f"  By confidence: {dict(confidence_counts)}", file=sys.stderr)
        print(f"  Top terms:", file=sys.stderr)
        for term, count in sorted(replacement_counts.items(), key=lambda x: -x[1])[:10]:
            print(f"    {term}: {count}", file=sys.stderr)

        if not args.dry_run:
            data["nodes"] = new_nodes
            data["last_modified"] = TODAY
            fpath.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"  Wrote {fpath.name}", file=sys.stderr)

    print(f"\n{'='*60}", file=sys.stderr)
    print(f"REPROCESSING SUMMARY", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)
    print(f"Nodes processed: {total_nodes}", file=sys.stderr)
    print(f"Total replacements: {total_replacements}", file=sys.stderr)
    if args.dry_run:
        print(f"\n  DRY RUN — no files were modified", file=sys.stderr)
    else:
        print(f"\n  Files updated. Review changes with: git diff", file=sys.stderr)


if __name__ == "__main__":
    main()
