#!/usr/bin/env python3

"""
reprocess_summary_vocabulary.py — Replace bare colloquial terms in existing
summary files with standardized display forms.

Each key_point's text is resolved using the camp it belongs to. Factual claims
and unmapped concepts use context-based resolution with neutral fallbacks.

Usage:
    python scripts/reprocess_summary_vocabulary.py [--data-root PATH] [--dry-run] [--verbose]
"""

import argparse
import json
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent

# Reuse the resolution logic from the taxonomy reprocessor.
# TODO: Eliminate sys.path hack when scripts become a proper package.
sys.path.insert(0, str(_SCRIPT_DIR))
from reprocess_taxonomy_vocabulary import (
    _resolve_data_root,
    load_colloquial_terms,
    load_standardized_terms,
    replace_bare_terms_in_text,
)


def process_summary(
    summary: dict,
    colloquial_terms: dict,
    standardized_terms: dict,
) -> tuple[dict, int]:
    """Process a summary, replacing bare terms in text fields. Returns (modified_summary, replacement_count)."""
    total = 0

    # key_points per camp — use each camp for resolution
    pov_summaries = summary.get("pov_summaries", {})
    for camp in ("accelerationist", "safetyist", "skeptic"):
        camp_data = pov_summaries.get(camp)
        if not camp_data or not camp_data.get("key_points"):
            continue
        for kp in camp_data["key_points"]:
            if kp.get("point") and isinstance(kp["point"], str):
                text, anns = replace_bare_terms_in_text(
                    kp["point"], camp, colloquial_terms, standardized_terms,
                )
                if anns:
                    kp["point"] = text
                    total += len(anns)

    # Factual claims — use "situation" (neutral) for resolution
    for fc in summary.get("factual_claims", []):
        if fc.get("claim") and isinstance(fc["claim"], str):
            text, anns = replace_bare_terms_in_text(
                fc["claim"], "situation", colloquial_terms, standardized_terms,
            )
            if anns:
                fc["claim"] = text
                total += len(anns)

    # Unmapped concepts — use "situation" (neutral)
    for uc in summary.get("unmapped_concepts", []):
        if uc.get("concept") and isinstance(uc["concept"], str):
            text, anns = replace_bare_terms_in_text(
                uc["concept"], "situation", colloquial_terms, standardized_terms,
            )
            if anns:
                uc["concept"] = text
                total += len(anns)
        if uc.get("suggested_description") and isinstance(uc["suggested_description"], str):
            text, anns = replace_bare_terms_in_text(
                uc["suggested_description"], "situation", colloquial_terms, standardized_terms,
            )
            if anns:
                uc["suggested_description"] = text
                total += len(anns)

    return summary, total


def main():
    parser = argparse.ArgumentParser(description="Reprocess summaries with standardized vocabulary")
    parser.add_argument("--data-root", help="Override data root directory")
    parser.add_argument("--dry-run", action="store_true", help="Show changes without writing files")
    parser.add_argument("--verbose", action="store_true", help="Show per-file details")
    parser.add_argument("--limit", type=int, default=0, help="Process only N files (0 = all)")
    args = parser.parse_args()

    data_root = _resolve_data_root(args.data_root)
    dict_dir = data_root / "dictionary"
    summaries_dir = data_root / "summaries"

    colloquial_terms = load_colloquial_terms(dict_dir)
    standardized_terms = load_standardized_terms(dict_dir)
    print(f"Loaded {len(colloquial_terms)} colloquial, {len(standardized_terms)} standardized terms", file=sys.stderr)

    if not summaries_dir.exists():
        print(f"ERROR: summaries directory not found at {summaries_dir}", file=sys.stderr)
        sys.exit(1)

    files = sorted(summaries_dir.glob("*.json"))
    if args.limit > 0:
        files = files[:args.limit]

    print(f"Processing {len(files)} summary files...", file=sys.stderr)

    total_replacements = 0
    files_modified = 0
    files_skipped = 0
    errors = 0

    for i, fpath in enumerate(files, 1):
        try:
            summary = json.loads(fpath.read_text(encoding="utf-8"))
            if not summary.get("pov_summaries"):
                files_skipped += 1
                continue

            modified, count = process_summary(summary, colloquial_terms, standardized_terms)

            if count > 0:
                total_replacements += count
                files_modified += 1
                if args.verbose:
                    print(f"  [{i}/{len(files)}] {fpath.name}: {count} replacements", file=sys.stderr)
                if not args.dry_run:
                    fpath.write_text(json.dumps(modified, indent=2, ensure_ascii=False), encoding="utf-8")
            elif args.verbose:
                print(f"  [{i}/{len(files)}] {fpath.name}: no changes", file=sys.stderr)

        except (json.JSONDecodeError, OSError, ValueError) as e:
            errors += 1
            print(f"  ERROR: {fpath.name}: {e}", file=sys.stderr)

        if i % 50 == 0 and not args.verbose:
            print(f"  ... {i}/{len(files)} files processed", file=sys.stderr)

    print(f"\n{'='*60}", file=sys.stderr)
    print(f"SUMMARY REPROCESSING RESULTS", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)
    print(f"Files processed: {len(files)}", file=sys.stderr)
    print(f"Files modified:  {files_modified}", file=sys.stderr)
    print(f"Files skipped:   {files_skipped}", file=sys.stderr)
    print(f"Errors:          {errors}", file=sys.stderr)
    print(f"Total replacements: {total_replacements}", file=sys.stderr)
    if args.dry_run:
        print(f"\n  DRY RUN — no files were modified", file=sys.stderr)


if __name__ == "__main__":
    main()
