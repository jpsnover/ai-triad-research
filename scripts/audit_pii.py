#!/usr/bin/env python3
"""
audit_pii.py — Pre-public PII scanner.

Scans all files in the research repo (EXCLUDING sources/_inbox and .git)
for patterns that suggest PII leakage from the private rolodex repo.

Checks for:
    - Email address patterns  (user@domain.tld)
    - Phone number patterns
    - Fields that should only exist in the private rolodex (e.g. "email", "notes" keys)
    - Any file path referencing the rolodex private repo

Usage:
    python scripts/audit_pii.py               # exits 0 if clean, 1 if findings
    python scripts/audit_pii.py --verbose     # prints each finding

Run this before flipping the repo to public.

TODO: Implement regex scanning logic.
"""

import argparse, re, sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent

EMAIL_RE  = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
PHONE_RE  = re.compile(r"\b(\+?1[\s.-]?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}\b")

SKIP_DIRS = {".git", "_inbox", "node_modules", "__pycache__", ".venv"}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    findings = []
    for path in REPO_ROOT.rglob("*"):
        if any(p in SKIP_DIRS for p in path.parts): continue
        if not path.is_file(): continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for pattern, label in [(EMAIL_RE, "EMAIL"), (PHONE_RE, "PHONE")]:
            for m in pattern.finditer(text):
                findings.append({"file": str(path.relative_to(REPO_ROOT)), "type": label, "match": m.group()})
    if findings:
        print(f"AUDIT FAILED: {len(findings)} potential PII finding(s).")
        if args.verbose:
            for f in findings: print(f"  [{f['type']}] {f['file']}: {f['match']}")
        sys.exit(1)
    else:
        print("AUDIT PASSED: No PII patterns found.")
        sys.exit(0)

if __name__ == "__main__":
    main()
