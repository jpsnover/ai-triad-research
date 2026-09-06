#!/usr/bin/env python3
"""t/3239 promotion: set node.logical_form status to the canonical terminal `accepted` after the v2
refresh + gate clearance (formalization_accuracy 0.778, PI-authorized promote-as-is 2026-09-06).

Promotes `proposed` -> `accepted` and migrates the out-of-vocab `approved` -> `accepted`. `approved`
is NOT in the canonical formalization-status enum (proposed|accepted|rejected) and fails
`logicalFormSchema.safeParse`, so every such frame is stripped at load and validation.data.test.ts
goes red in CI (t/3352). Leaves `rejected` and already-`accepted` frames untouched. Idempotent.

Writes the 3 Origin POV files through the data-write funnel (assert_clean_data_tree, t/2902) so a
concurrent uncommitted edit to a target file cannot be swept into the write. Dry by default; --apply
commits the status change."""
import argparse, json, os, sys
from collections import Counter
sys.stdout.reconfigure(encoding="utf-8")

# Import the shared data-write guard (code-repo scripts/). tools/ -> repo root is three levels up.
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(_REPO_ROOT, "scripts"))
from data_tree_guard import assert_clean_data_tree  # noqa: E402

D = os.environ.get("AI_TRIAD_DATA_ROOT") or r"C:\Users\jsnov\repos\ai-triad-data"
O = os.path.join(D, "taxonomy", "Origin")

# In-vocab canonical terminal; sources we promote/migrate FROM.
_TARGET = "accepted"
_MIGRATE_FROM = ("proposed", "approved")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    before, after = Counter(), Counter()
    for fn in ("accelerationist.json", "safetyist.json", "skeptic.json"):
        p = os.path.join(O, fn)
        data = json.load(open(p, encoding="utf-8"))
        changed = 0
        for n in data["nodes"]:
            lf = n.get("logical_form")
            if not lf:
                continue
            before[lf.get("status", "?")] += 1
            if lf.get("status") in _MIGRATE_FROM:
                lf["status"] = _TARGET; changed += 1
            after[lf.get("status", "?")] += 1
        if args.apply:
            assert_clean_data_tree(p)  # funnel: refuse to sweep a concurrently-dirty target
            with open(p, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False); f.write("\n")
        print(f"{fn}: {changed} flipped -> {_TARGET}")
    print(f"\nbefore: {dict(before)}  ->  after: {dict(after)}")
    print("APPLIED" if args.apply else "DRY (use --apply)")


if __name__ == "__main__":
    raise SystemExit(main())
