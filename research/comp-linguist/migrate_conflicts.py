"""
Migration script for t/688: Consolidate individual conflict-*.json files
into a single conflicts.json with wrapper schema.

Usage:
    python migrate_conflicts.py [--dry-run] [--validate-only]

Reads all conflict-*.json files (skips _ prefixed), validates, sorts by
claim_id, and writes a single conflicts.json alongside existing files.
Idempotent — safe to re-run.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

DATA_ROOT = Path("C:/Users/jsnov/repos/ai-triad-data/conflicts")

REQUIRED_FIELDS = ["claim_id", "claim_label", "description", "status", "linked_taxonomy_nodes", "instances", "human_notes"]
VALID_STATUSES = {"open", "resolved", "wont-fix"}


def load_individual_conflicts(conflicts_dir: Path) -> tuple[list[dict], list[str]]:
    """Load all conflict-*.json files, skipping _ prefixed files.
    Returns (conflicts, errors)."""
    conflicts = []
    errors = []

    files = sorted(conflicts_dir.glob("conflict-*.json"))
    for f in files:
        if f.name.startswith("_"):
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            conflicts.append(data)
        except json.JSONDecodeError as e:
            errors.append(f"JSON parse error in {f.name}: {e}")
        except Exception as e:
            errors.append(f"Read error for {f.name}: {e}")

    return conflicts, errors


def validate_conflict(conflict: dict, index: int) -> list[str]:
    """Validate a single conflict entry. Returns list of issues."""
    issues = []
    cid = conflict.get("claim_id", f"<entry {index}>")

    for field in REQUIRED_FIELDS:
        if field not in conflict:
            issues.append(f"{cid}: missing required field '{field}'")

    if "claim_id" in conflict:
        if not isinstance(conflict["claim_id"], str) or not conflict["claim_id"].startswith("conflict-"):
            issues.append(f"{cid}: claim_id must start with 'conflict-'")

    if "status" in conflict:
        if conflict["status"] not in VALID_STATUSES:
            issues.append(f"{cid}: invalid status '{conflict['status']}' (expected: {VALID_STATUSES})")

    if "instances" in conflict:
        if not isinstance(conflict["instances"], list):
            issues.append(f"{cid}: instances must be an array")

    return issues


def check_duplicates(conflicts: list[dict]) -> list[str]:
    """Check for duplicate claim_ids."""
    seen = {}
    dupes = []
    for c in conflicts:
        cid = c.get("claim_id", "")
        if cid in seen:
            dupes.append(f"Duplicate claim_id: {cid} (entries {seen[cid]} and {conflicts.index(c)})")
        else:
            seen[cid] = conflicts.index(c)
    return dupes


def main():
    parser = argparse.ArgumentParser(description="Migrate conflict files to single conflicts.json")
    parser.add_argument("--dry-run", action="store_true", help="Report what would happen without writing")
    parser.add_argument("--validate-only", action="store_true", help="Validate existing files without migrating")
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")

    if not DATA_ROOT.exists():
        print(f"ERROR: Conflicts directory not found: {DATA_ROOT}")
        sys.exit(1)

    print(f"Loading individual conflict files from {DATA_ROOT}...")
    conflicts, load_errors = load_individual_conflicts(DATA_ROOT)
    print(f"Loaded {len(conflicts)} conflict entries")

    if load_errors:
        print(f"\nLoad errors ({len(load_errors)}):")
        for e in load_errors:
            print(f"  - {e}")

    print("\nValidating entries...")
    all_issues = []
    for i, c in enumerate(conflicts):
        issues = validate_conflict(c, i)
        all_issues.extend(issues)

    dupe_issues = check_duplicates(conflicts)
    all_issues.extend(dupe_issues)

    if all_issues:
        print(f"\nValidation issues ({len(all_issues)}):")
        for issue in all_issues[:50]:
            print(f"  - {issue}")
        if len(all_issues) > 50:
            print(f"  ... and {len(all_issues) - 50} more")
    else:
        print("  All entries valid")

    if args.validate_only:
        print(f"\nValidation complete. {len(conflicts)} entries, {len(all_issues)} issues.")
        return

    patched = 0
    for c in conflicts:
        if "human_notes" not in c:
            c["human_notes"] = []
            patched += 1
    if patched:
        print(f"  Patched {patched} entries with missing human_notes field")

    conflicts.sort(key=lambda c: c.get("claim_id", ""))

    status_counts = {}
    for c in conflicts:
        s = c.get("status", "unknown")
        status_counts[s] = status_counts.get(s, 0) + 1

    output = {
        "_schema_version": "2.0",
        "_doc": "All conflict entries. Per-entry schema unchanged from conflict.schema.json.",
        "last_modified": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "conflict_count": len(conflicts),
        "conflicts": conflicts,
    }

    output_path = DATA_ROOT / "conflicts.json"
    output_json = json.dumps(output, indent=2, ensure_ascii=False)
    size_mb = len(output_json.encode("utf-8")) / (1024 * 1024)

    print(f"\n{'=' * 60}")
    print(f"Migration summary:")
    print(f"  Entries:     {len(conflicts)}")
    print(f"  Duplicates:  {len(dupe_issues)}")
    print(f"  Load errors: {len(load_errors)}")
    print(f"  Validation:  {len(all_issues)} issues")
    print(f"  File size:   {size_mb:.2f} MB")
    print(f"  Status breakdown: {status_counts}")
    print(f"  Output:      {output_path}")

    if args.dry_run:
        print("\n[DRY RUN] No files written.")
        return

    if load_errors or dupe_issues:
        print("\nERROR: Cannot migrate with load errors or duplicates. Fix these first.")
        sys.exit(1)

    print(f"\nWriting {output_path}...")
    output_path.write_text(output_json, encoding="utf-8")
    print("Done.")

    print("\nVerifying written file...")
    verify = json.loads(output_path.read_text(encoding="utf-8"))
    assert verify["conflict_count"] == len(conflicts), "Count mismatch!"
    assert len(verify["conflicts"]) == len(conflicts), "Array length mismatch!"
    assert verify["_schema_version"] == "2.0", "Schema version mismatch!"
    written_ids = {c["claim_id"] for c in verify["conflicts"]}
    source_ids = {c["claim_id"] for c in conflicts}
    assert written_ids == source_ids, f"ID mismatch! Missing: {source_ids - written_ids}, Extra: {written_ids - source_ids}"
    print(f"Verified: {len(verify['conflicts'])} entries, {size_mb:.2f} MB, schema v2.0")


if __name__ == "__main__":
    main()
