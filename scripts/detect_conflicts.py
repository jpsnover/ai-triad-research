#!/usr/bin/env python3
"""
detect_conflicts.py — Factual conflict detection and deduplication.

Called by batch_summarize.py after each summary is generated.
Groups conflicts by Claim ID to prevent duplicate entries.

Logic:
    1. Read the newly generated summary JSON.
    2. For each factual_claim in the summary:
       a. Check if a conflict file with that claim_id already exists in conflicts/.
       b. If YES: append a new instance entry to the existing file.
       c. If NO:  create a new conflict file with a generated claim_id.
    3. Never delete or overwrite conflict files — append only.

Usage:
    python scripts/detect_conflicts.py --doc-id <id>

TODO: Implement conflict detection logic.
"""

import argparse, json, sys
from pathlib import Path

REPO_ROOT  = Path(__file__).parent.parent
CONFLICTS  = REPO_ROOT / "conflicts"
SUMMARIES  = REPO_ROOT / "summaries"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--doc-id", required=True)
    args = parser.parse_args()
    print(f"TODO: detect_conflicts.py not yet implemented for doc {args.doc_id}")
    sys.exit(0)

if __name__ == "__main__":
    main()
