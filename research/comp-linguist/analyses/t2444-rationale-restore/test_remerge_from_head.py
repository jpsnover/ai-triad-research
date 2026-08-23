#!/usr/bin/env python3
# Two-arm proof for remerge_from_head.py (t/2946).
#
# A gate that only ever passes proves nothing. Both arms are required:
#   ARM 1 (fires)  — reconstruct the OBSERVED 2026-08-20 wipe from the live file, and prove the
#                    tool detects all 6 regressions and repairs them to a byte-exact match of the
#                    known-good live file, with the 2 working-tree-added edges preserved.
#   ARM 2 (clean)  — the live working tree reports zero regressions and exits 0 with no noise.
#   ARM 3 (refuse) — an ambiguous twin is REFUSED and logged, never guessed.
#
# Arm 1 is the load-bearing one: it is anchored on the real captured specimen
# (observed-specimen-2026-08-20.json, provenance class `observed` per t/2294), not a constructed
# case, and its expected end state is the live file itself — so a pass means the tool would have
# produced exactly the state the tree is in now, from the state the specimen recorded.
#
# Usage:  python test_remerge_from_head.py --data-repo <path-to-ai-triad-data>

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "remerge_from_head.py")
SPECIMEN = os.path.join(HERE, "observed-specimen-2026-08-20.json")
REL_PARTS = ("taxonomy", "Origin", "edges.json")

sys.path.insert(0, HERE)
import remerge_from_head as rm  # noqa: E402

failures = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  -- " + detail) if detail and not cond else ""))
    if not cond:
        failures.append(name)


def run_tool(*extra):
    return subprocess.run([sys.executable, TOOL] + list(extra), capture_output=True, text=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-repo", required=True)
    ap.add_argument("--specimen", default=SPECIMEN,
                    help="captured specimen path (default: sibling observed-specimen-2026-08-20.json, "
                         "landed by the t/2949 fixture PR)")
    args = ap.parse_args()
    if not os.path.exists(args.specimen):
        sys.exit("MISSING SPECIMEN: %s\nArm 1 is anchored on the real captured specimen and will "
                 "not run without it. Pass --specimen, or land the t/2949 fixture PR first."
                 % args.specimen)
    repo = os.path.abspath(args.data_repo)
    live = os.path.join(repo, *REL_PARTS)

    live_blob = rm.read_text(live)
    live_doc = json.loads(live_blob)

    head_edges = json.loads(subprocess.run(
        ["git", "-C", repo, "show", "HEAD:" + "/".join(REL_PARTS)],
        capture_output=True, check=True).stdout.decode("utf-8"))["edges"]
    head_rat_keys = {rm.ckey(e) for e in head_edges if rm.has_rat(e)}

    specimen = json.loads(rm.read_text(args.specimen))
    spec_regressed = {rm.ckey(r["HEAD_with_rationale"]) for r in specimen["regressed_edges"]}
    spec_appended = {rm.ckey(e) for e in specimen["appended_edges"]}

    tmp = tempfile.mkdtemp(prefix="remerge-test-")
    try:
        # ---- ARM 1: reconstruct the observed wipe, then repair it -------------------------
        print("\nARM 1 (fires) — reconstruct the observed 2026-08-20 wipe and repair it")

        # Subset, not equality: once the repair is committed (ai-triad-data 8853974c) HEAD also
        # carries the 2 appended edges' rationales, so HEAD is a strict superset of the specimen's
        # regressed set. Equality would only hold against the pre-landing HEAD.
        check("specimen's 6 regressed keys all carry a rationale at HEAD",
              spec_regressed <= head_rat_keys,
              "specimen=%d head=%d missing=%r"
              % (len(spec_regressed), len(head_rat_keys), sorted(spec_regressed - head_rat_keys)))

        stripped_doc = json.loads(live_blob)
        n_stripped = 0
        for e in stripped_doc["edges"]:
            if rm.ckey(e) in spec_regressed and rm.has_rat(e):
                del e["rationale"]
                n_stripped += 1
        check("stripped 6 rationales to recreate the wipe state", n_stripped == 6, "got %d" % n_stripped)

        # Cross-check the reconstruction against the specimen's recorded stripped forms.
        by_key = {rm.ckey(e): e for e in stripped_doc["edges"]}
        mismatch = [r["key"] for r in specimen["regressed_edges"]
                    if by_key.get(rm.ckey(r["HEAD_with_rationale"])) != r["working_tree_stripped"]]
        check("reconstructed edges match the specimen's recorded stripped forms exactly",
              not mismatch, "mismatched: %r" % mismatch)

        wiped = os.path.join(tmp, "edges.json")
        with open(wiped, "w", encoding="utf-8", newline="") as f:
            f.write(rm.serialize(stripped_doc))

        r = run_tool("--data-repo", repo, "--target", wiped)
        check("check-mode exits non-zero on the wipe state", r.returncode == 1, "exit=%d" % r.returncode)
        check("check-mode reports exactly 6 regressed",
              "REGRESSED (rationale at HEAD, absent in working tree) : 6" in r.stdout, r.stdout)
        check("check-mode wrote nothing",
              rm.read_text(wiped) == rm.serialize(stripped_doc))

        r = run_tool("--data-repo", repo, "--target", wiped, "--apply", "--write-in-place")
        check("apply-mode exits 0", r.returncode == 0, r.stdout + r.stderr)
        check("apply-mode reports the strip-back proof passing", "strip-back proof: PASS" in r.stdout, r.stdout)

        repaired_blob = rm.read_text(wiped)
        check("REPAIRED FILE IS BYTE-IDENTICAL TO THE KNOWN-GOOD LIVE FILE",
              repaired_blob == live_blob,
              "len repaired=%d live=%d" % (len(repaired_blob), len(live_blob)))

        repaired = json.loads(repaired_blob)
        rep_keys = {rm.ckey(e) for e in repaired["edges"]}
        check("the 2 working-tree-added edges survived the repair (not a `git checkout --`)",
              spec_appended <= rep_keys)
        rep_rat = {rm.ckey(e) for e in repaired["edges"] if rm.has_rat(e)}
        check("appended edges kept their own rationale", spec_appended <= rep_rat)
        check("edge count unchanged by the repair",
              len(repaired["edges"]) == len(live_doc["edges"]))

        # ---- ARM 2: the clean case is silent -------------------------------------------
        print("\nARM 2 (clean) — the live working tree passes with no noise")
        r = run_tool("--data-repo", repo)
        check("live tree exits 0", r.returncode == 0, r.stdout + r.stderr)
        check("live tree reports the invariant holding", "RE-MERGE INVARIANT: HOLDS" in r.stdout, r.stdout)
        check("live tree reports 0 regressed",
              "REGRESSED (rationale at HEAD, absent in working tree) : 0" in r.stdout, r.stdout)
        check("live tree reports 0 twin-ambiguous refusals",
              "twin-ambiguous, REFUSED (left untouched)                   : 0" in r.stdout, r.stdout)

        # ---- ARM 3: ambiguity is refused, never guessed ---------------------------------
        print("\nARM 3 (refuse) — an ambiguous twin is refused and logged")
        key = ("acc-beliefs-051", "SUPPORTS", "acc-desires-001")
        # Two HEAD twins with an IDENTICAL tie-break signature: unresolvable by construction.
        h1 = {"source": key[0], "type": key[1], "target": key[2], "confidence": 0.7,
              "rationale": "twin A rationale", "discovered_at": "2026-04-06", "model": "gemini-2.5-flash"}
        h2 = dict(h1, confidence=0.9, rationale="twin B rationale")
        w1 = {k: v for k, v in h1.items() if k != "rationale"}
        w2 = {k: v for k, v in h2.items() if k != "rationale"}
        ambiguous = []
        pairs = rm.pair_bucket(key, [w1, w2], [h1, h2], ambiguous)
        check("both ambiguous twins logged", len(ambiguous) == 2, "got %d" % len(ambiguous))
        check("no rationale attributed to either ambiguous twin",
              all(h is None for _, h in pairs), "pairs=%r" % [h is not None for _, h in pairs])

        # And the resolvable case still resolves, so Arm 3 is not just "refuse everything".
        h2b = dict(h2, discovered_at="2026-06-11", model=None)
        w2b = {k: v for k, v in h2b.items() if k != "rationale"}
        ambiguous2 = []
        pairs2 = rm.pair_bucket(key, [w1, w2b], [h1, h2b], ambiguous2)
        check("distinguishable twins resolve without refusal", not ambiguous2)
        check("distinguishable twins pair to the CORRECT counterpart",
              [h["rationale"] for _, h in pairs2] == ["twin A rationale", "twin B rationale"],
              "%r" % [h and h.get("rationale") for _, h in pairs2])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n" + ("ALL ARMS PASS" if not failures else "FAILURES: %r" % failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
