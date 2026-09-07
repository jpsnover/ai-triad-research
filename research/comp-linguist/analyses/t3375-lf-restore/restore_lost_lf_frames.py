#!/usr/bin/env python3
"""t/3375 remedial restore: re-attach the 133 accelerationist node `logical_form` frames that
harvest-on-save commit 0c1f1a77 silently dropped (641 -> 508). Deterministic, node-id keyed,
reversible, no LLM. TL-authorized (t/3375#2). GO gated on the PI's app being quiesced.

Discipline (t/3375#2, corpus-write class):
  - FROZEN 133-id list committed alongside this script (frozen_lost_ids.json); NOT re-derived at write.
  - 0-collateral: exactly the 133 nodes gain `logical_form`; every other node + file byte-identical.
    Enforced two ways: (a) per-node deep-equality for all non-frozen nodes; (b) the reserialized file
    diff is a PURE INSERTION (0 lines removed) vs the current file.
  - Funnel: refuse --apply if the target file has uncommitted changes (assert_clean_data_tree), unless --force.
  - Post-write self-verify: corpus back to 641 frames, all status 'accepted'.
Python reserialization of the live (JS-saved) accelerationist.json is byte-identical (verified),
so the restore produces a pure-insertion diff.

Modes:
  --freeze   (one-time) derive the 133 lost ids from git (92759cfe minus HEAD) -> frozen_lost_ids.json
  (default)  dry-run: prove 0-collateral, print what WOULD change; no write
  --apply    write the restore (requires clean tree unless --force)
"""
import argparse, json, os, subprocess, sys, difflib
sys.stdout.reconfigure(encoding="utf-8")

D = os.environ.get("AI_TRIAD_DATA_ROOT") or r"C:\Users\jsnov\repos\ai-triad-data"
HERE = os.path.dirname(os.path.abspath(__file__))
FROZEN = os.path.join(HERE, "frozen_lost_ids.json")
SRC_REF = "92759cfe"           # last commit with all 641 frames intact
FILES = ["taxonomy/Origin/accelerationist.json",
         "taxonomy/Origin/safetyist.json",
         "taxonomy/Origin/skeptic.json"]
CANONICAL = {"proposed", "accepted", "rejected"}


def _die(goal, problem, location, next_steps):
    raise SystemExit(f"\nGoal: {goal}\nProblem: {problem}\nLocation: {location}\nNext Steps: {next_steps}\n")


def _git_show(ref, relpath):
    return subprocess.run(["git", "-C", D, "show", f"{ref}:{relpath}"],
                          capture_output=True, check=True).stdout


def _ids_with_lf(load):
    s = set()
    for f in FILES:
        data = json.loads(load(f))
        nodes = data["nodes"] if isinstance(data, dict) and "nodes" in data else data
        for n in nodes:
            if n.get("logical_form"):
                s.add(n["id"])
    return s


def do_freeze():
    before = _ids_with_lf(lambda f: _git_show(SRC_REF, f))
    after = _ids_with_lf(lambda f: open(os.path.join(D, f), encoding="utf-8").read())
    lost = sorted(before - after)
    payload = {"ticket": "t/3375", "source_ref": SRC_REF, "count": len(lost),
               "note": "node ids whose logical_form was present at 92759cfe and dropped by 0c1f1a77; restore target",
               "ids": lost}
    with open(FROZEN, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
        fh.write("\n")
    print(f"froze {len(lost)} ids -> {FROZEN}")


def do_restore(apply, force):
    if not os.path.exists(FROZEN):
        _die("Restore the 133 lost logical_form frames",
             f"Frozen id list not found: {FROZEN}",
             FROZEN, "Run --freeze first to generate the frozen list, then re-run.")
    frozen = json.load(open(FROZEN, encoding="utf-8"))
    ids = set(frozen["ids"])
    if len(ids) != 133:
        _die("Restore exactly the 133 lost frames",
             f"Frozen list has {len(ids)} ids, expected 133.",
             FROZEN, "Regenerate with --freeze and re-verify against t/3375#1.")

    # All 133 are accelerationist (verified); restore only touches that file.
    rel = "taxonomy/Origin/accelerationist.json"
    p = os.path.join(D, rel)
    if apply and not force:
        out = subprocess.run(["git", "-C", D, "status", "--porcelain", "--", rel],
                             capture_output=True, text=True, check=True, timeout=15).stdout.strip()
        if out:
            _die("Restore on a clean tree", f"{rel} has uncommitted changes:\n{out}",
                 f"data repo: {D}", "Commit/stash first, or pass --force.")

    orig_text = open(p, encoding="utf-8").read()
    cur = json.loads(orig_text)
    before_by_id = {n["id"]: json.loads(json.dumps(n)) for n in cur["nodes"]}  # pristine pre-mutation snapshot
    before_order = [n["id"] for n in cur["nodes"]]
    before_top = {k: v for k, v in cur.items() if k != "nodes"}
    src = json.loads(_git_show(SRC_REF, rel))
    src_lf = {n["id"]: n.get("logical_form") for n in src["nodes"]}

    added, changed_ids = 0, []
    for n in cur["nodes"]:
        if n["id"] in ids:
            if n.get("logical_form"):
                _die("Only ADD frames to nodes missing them (0-collateral)",
                     f"Node {n['id']} already has a logical_form; restore would overwrite.",
                     f"{rel} -> {n['id']}", "Investigate: the frozen list must contain only frame-less nodes.")
            lf = src_lf.get(n["id"])
            if not lf or lf.get("status") not in CANONICAL:
                _die("Restore only canonical frames",
                     f"Source {SRC_REF} frame for {n['id']} missing or out-of-vocab: {lf.get('status') if lf else None}",
                     f"{SRC_REF}:{rel} -> {n['id']}", "Verify the source ref; abort.")
            n["logical_form"] = lf
            added += 1
            changed_ids.append(n["id"])

    # 0-collateral guard A (authoritative, STRUCTURAL): exactly the 133 frozen nodes change, and each
    # changes ONLY by gaining logical_form; every other node + the file's non-node structure is deep-equal.
    if added != 133 or set(changed_ids) != ids:
        _die("Change exactly the 133 frozen nodes",
             f"added={added}, changed set == frozen set: {set(changed_ids)==ids}",
             rel, "Abort — collateral or under-application detected.")
    if [n["id"] for n in cur["nodes"]] != before_order:
        _die("Preserve node order/count", "node id order or count changed", rel, "Abort.")
    if {k: v for k, v in cur.items() if k != "nodes"} != before_top:
        _die("Preserve file-level (non-node) structure", "a top-level key besides nodes changed", rel, "Abort.")
    for n in cur["nodes"]:
        b = before_by_id[n["id"]]
        if n["id"] in ids:
            expected = dict(b); expected["logical_form"] = src_lf[n["id"]]
            if n != expected:
                _die("Frozen node changes ONLY by gaining logical_form",
                     f"{n['id']} differs from (before + logical_form)", f"{rel} -> {n['id']}", "Abort — collateral field change.")
        elif n != b:
            _die("Non-frozen nodes are byte-identical", f"{n['id']} changed but is not in the frozen list",
                 f"{rel} -> {n['id']}", "Abort — collateral on a non-target node.")

    new_text = json.dumps(cur, indent=2, ensure_ascii=False) + "\n"

    # 0-collateral guard B (textual, comma-aware): the ONLY allowed modifications are the JSON trailing
    # comma each target node's prior-last line gains when logical_form is appended. Every removed line
    # must reappear verbatim with a trailing comma; anything else is real collateral.
    rem = [l[1:] for l in difflib.unified_diff(orig_text.splitlines(), new_text.splitlines(), lineterm="")
           if l.startswith("-") and not l.startswith("---")]
    add_bodies = [l[1:] for l in difflib.unified_diff(orig_text.splitlines(), new_text.splitlines(), lineterm="")
                  if l.startswith("+") and not l.startswith("+++")]
    from collections import Counter
    add_ct = Counter(add_bodies)
    bad = [r for r in rem if add_ct[r + ","] < 1]
    if bad or len(rem) > 133:
        _die("Only trailing-comma modifications allowed (0-collateral)",
             f"{len(bad)} removed line(s) are not comma-twins; total removed={len(rem)} (>133 = collateral).",
             rel, "Abort — a non-comma content change was detected.")
    inserted = len(add_bodies)

    print(f"nodes gaining logical_form: {added} (all accelerationist)")
    print(f"diff: +{inserted} inserted; {len(rem)} modified (JSON trailing-comma on each target node's "
          f"prior line only) => 0-collateral: no non-target node or field changes")
    print(f"sample ids: {changed_ids[:6]} ... {changed_ids[-3:]}")

    if apply:
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(new_text)
        # Post-write verify: corpus back to 641, all accepted.
        total = _ids_with_lf(lambda f: open(os.path.join(D, f), encoding="utf-8").read())
        statuses = {}
        for f in FILES:
            for n in json.load(open(os.path.join(D, f), encoding="utf-8"))["nodes"]:
                lf = n.get("logical_form")
                if lf:
                    statuses[lf.get("status", "?")] = statuses.get(lf.get("status", "?"), 0) + 1
        print(f"APPLIED. corpus frames now: {len(total)} (expect 641), statuses={statuses}")
        if len(total) != 641 or set(statuses) != {"accepted"}:
            _die("Post-write corpus must be 641 all-accepted",
                 f"got {len(total)} frames, statuses={statuses}", "Origin/*.json",
                 "Investigate immediately — restore did not reach the expected end state.")
    else:
        print("DRY (use --apply to write). Restore is HELD until PI app-quiesce is confirmed (t/3375#2 cond 1).")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--freeze", action="store_true", help="derive + write the frozen 133-id list, then exit")
    ap.add_argument("--apply", action="store_true", help="write the restore (else dry-run)")
    ap.add_argument("--force", action="store_true", help="skip the clean-tree funnel guard")
    args = ap.parse_args()
    if args.freeze:
        do_freeze(); return
    do_restore(args.apply, args.force)


if __name__ == "__main__":
    raise SystemExit(main())
