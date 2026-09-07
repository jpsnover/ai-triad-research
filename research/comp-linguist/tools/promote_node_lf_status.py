#!/usr/bin/env python3
"""t/3239 promotion: flip node.logical_form status `proposed` -> `accepted` after the v2 refresh +
gate clearance (formalization_accuracy 0.778, PI-authorized promote-as-is 2026-09-06). Idempotent.
Writes the 3 Origin POV files. Dry by default; --apply commits the status change.

t/3352 prevention: the promotion target is now the in-enum value `accepted` (was the out-of-vocab
`approved`, which failed `logicalFormSchema` on all 641 frames and was stripped at load / fired CI red).
Three guards make an out-of-vocab status *impossible to write* rather than caught downstream:
  1. startup: PROMOTION_TARGET must be in the canonical enum;
  2. write-time: every logical_form.status about to be serialized is re-validated against the enum;
  3. funnel: --apply refuses to write if the target data files carry uncommitted changes (--force overrides),
     so a promotion write can never entangle with unrelated WIP (the incident's failure class).
Canonical enum of record: proposed | accepted | rejected
  (lib/entities/logicalForm.ts:130, scripts/AITriad/Private/LogicalFormPass.ps1, docs/logical-form-schema.md)
"""
import argparse, json, os, subprocess, sys
from collections import Counter
sys.stdout.reconfigure(encoding="utf-8")
D = os.environ.get("AI_TRIAD_DATA_ROOT") or r"C:\Users\jsnov\repos\ai-triad-data"
O = os.path.join(D, "taxonomy", "Origin")
FILES = ("accelerationist.json", "safetyist.json", "skeptic.json")

# Canonical FOL formalization-status vocabulary (schema-of-record). Keep in sync with the TS/PS/doc ports.
CANONICAL_LF_STATUS = frozenset({"proposed", "accepted", "rejected"})
PROMOTION_TARGET = "accepted"


def _die(goal, problem, location, next_steps):
    """Actionable-error convention (Goal / Problem / Location / Next Steps) for a fail-fast abort."""
    raise SystemExit(
        f"\nGoal: {goal}\nProblem: {problem}\nLocation: {location}\nNext Steps: {next_steps}\n"
    )


def _assert_clean(rel_files):
    """Funnel-guard: refuse to write if any target file already carries uncommitted changes in the
    data repo, so a promotion write cannot entangle with unrelated WIP (t/3352 incident class)."""
    try:
        out = subprocess.run(
            ["git", "-C", D, "status", "--porcelain", "--", *rel_files],
            capture_output=True, text=True, check=True, timeout=15,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        _die(
            goal="Guard the promotion write against a dirty data tree",
            problem=f"Could not run `git status` in the data repo: {e}",
            location=f"data repo: {D}",
            next_steps="Verify AI_TRIAD_DATA_ROOT points at a git checkout, or pass --force to skip the clean-tree guard.",
        )
    if out:
        _die(
            goal="Promote logical_form.status to 'accepted' on a clean tree",
            problem=f"Target file(s) already have uncommitted changes:\n{out}",
            location=f"data repo: {D}",
            next_steps="Commit/stash the pending changes first (so the promotion lands as its own reviewable diff), or pass --force to override.",
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the status change (dry-run otherwise)")
    ap.add_argument("--force", action="store_true", help="skip the clean-tree funnel-guard")
    args = ap.parse_args()

    # Guard 1 (startup): the promotion target must itself be in-enum — catches a future edit that
    # reintroduces an out-of-vocab value (the exact t/3352 drift) before any file is touched.
    if PROMOTION_TARGET not in CANONICAL_LF_STATUS:
        _die(
            goal="Promote node logical_form.status to a canonical value",
            problem=f"PROMOTION_TARGET={PROMOTION_TARGET!r} is not in the canonical enum {sorted(CANONICAL_LF_STATUS)}.",
            location="promote_node_lf_status.py (PROMOTION_TARGET)",
            next_steps="Set PROMOTION_TARGET to one of proposed|accepted|rejected, or extend CANONICAL_LF_STATUS across all 4 ports first.",
        )

    if args.apply and not args.force:
        _assert_clean(list(FILES))

    before, after = Counter(), Counter()
    for fn in FILES:
        p = os.path.join(O, fn)
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        changed = 0
        for n in data["nodes"]:
            lf = n.get("logical_form")
            if not lf:
                continue
            before[lf.get("status", "?")] += 1
            if lf.get("status") != PROMOTION_TARGET:
                lf["status"] = PROMOTION_TARGET; changed += 1
            after[lf.get("status", "?")] += 1
            # Guard 2 (write-time): never serialize an out-of-vocab status.
            if lf["status"] not in CANONICAL_LF_STATUS:
                _die(
                    goal="Write only canonical logical_form.status values",
                    problem=f"Node {n.get('id','?')} would be written with out-of-vocab status {lf['status']!r}.",
                    location=f"{fn} -> {n.get('id','?')}.logical_form.status",
                    next_steps="This should be unreachable given PROMOTION_TARGET; investigate before writing.",
                )
        if args.apply:
            with open(p, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False); f.write("\n")
        print(f"{fn}: {changed} flipped -> {PROMOTION_TARGET}")
    print(f"\nbefore: {dict(before)}  ->  after: {dict(after)}")
    print("APPLIED" if args.apply else "DRY (use --apply)")


if __name__ == "__main__":
    raise SystemExit(main())
