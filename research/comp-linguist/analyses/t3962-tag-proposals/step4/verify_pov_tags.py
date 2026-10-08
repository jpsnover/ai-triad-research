#!/usr/bin/env python3
"""t/3962 step 4: 0-collateral + end-state verify of the pov_tags write (/data-mutation elements 6 and 8).

Compares skeptic.json in <data_root> (working tree, or <ref> if given, e.g. HEAD / origin/main) against the
frozen base blob (by sha256, read from git at base_data_commit). Asserts, structurally:
  - file-level keys, node count and node order unchanged;
  - every node is deep-equal to its base apart from one ADDED key, pov_tags;
  - pov_tags equals the frozen tags exactly (an array, order preserved; [] for the untagged).
And textually: every removed line is identical to an added line apart from a trailing comma (the comma a key
append forces), so the diff is pure insertion.

Usage: python verify_pov_tags.py <data_root> [<ref>]
"""
import collections, hashlib, json, os, subprocess, sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
SKP = "taxonomy/Origin/skeptic.json"


def show(data, ref, path):
    r = subprocess.run(["git", "-C", data, "show", f"{ref}:{path}"], capture_output=True)
    if r.returncode:
        sys.exit(f"FAIL: git show {ref}:{path}: {r.stderr.decode(errors='replace')}")
    return r.stdout


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    data, ref = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else None)
    fz = json.load(open(os.path.join(HERE, "frozen_assignments.json"), encoding="utf-8"))
    base_raw = show(data, fz["base_data_commit"], SKP)
    if hashlib.sha256(base_raw).hexdigest() != fz["base_skeptic_sha256"]:
        sys.exit("FAIL: base blob sha256 != frozen base")
    new_raw = show(data, ref, SKP) if ref else open(os.path.join(data, SKP), "rb").read()
    base, new = json.loads(base_raw), json.loads(new_raw)
    errs = []

    if list(base.keys()) != list(new.keys()):
        errs.append("file-level keys changed")
    for k in base:
        if k != "nodes" and base[k] != new.get(k):
            errs.append(f"file-level field changed: {k}")
    bn, nn = base["nodes"], new["nodes"]
    if [n["id"] for n in bn] != [n["id"] for n in nn]:
        errs.append("node count/order changed")
    want = {a["node_id"]: a["tags"] for a in fz["assignments"]}
    tally = collections.Counter()
    for b, n in zip(bn, nn):
        nid = b["id"]
        extra = set(n) - set(b)
        if set(b) - set(n) or extra != {"pov_tags"}:
            errs.append(f"{nid}: key set changed beyond +pov_tags ({sorted(set(b) ^ set(n))})")
            continue
        if any(b[k] != n[k] for k in b):
            errs.append(f"{nid}: a pre-existing field changed")
        t = n["pov_tags"]
        if not isinstance(t, list) or t != want[nid]:
            errs.append(f"{nid}: pov_tags {t!r} != frozen {want[nid]!r}")
        tally["+".join(sorted(t)) or "untagged"] += 1

    # textual: Set-PovNodeTags (Update-JsonNodePath -ArrayValue -Upsert) splices the new key onto each node's
    # opening-brace line, compact: `    {` -> `    {"pov_tags":[...],`. So the file must have the SAME line count,
    # and the ONLY changed lines are exactly those, in node order, carrying exactly the frozen tags.
    bl, nl = base_raw.decode("utf-8").split("\n"), new_raw.decode("utf-8").split("\n")
    changed = [(i, b, n) for i, (b, n) in enumerate(zip(bl, nl)) if b != n]
    if len(bl) != len(nl):
        errs.append(f"textual: line count changed {len(bl)} -> {len(nl)}")
    order = [a["node_id"] for a in fz["assignments"]]
    if len(changed) != len(order):
        errs.append(f"textual: {len(changed)} changed lines != {len(order)} nodes")
    for (i, b, n), nid in zip(changed, order):
        expect = b + '"pov_tags":' + json.dumps(want[nid], ensure_ascii=False, separators=(",", ":")) + ","
        if b.strip() != "{" or n != expect:
            errs.append(f"textual: line {i + 1} ({nid}): {b!r} -> {n[:120]!r}, expected {expect!r}")

    crlf = b"\r\n" in new_raw
    print(f"target: {ref or 'working tree'} | nodes {len(nn)} | split {dict(tally)} | changed-lines {len(changed)} "
          f"| crlf {crlf}")
    if crlf:
        errs.append("CRLF line endings in result")
    if errs:
        print(f"FAIL ({len(errs)}):")
        for e in errs[:20]:
            print("  " + e)
        sys.exit(1)
    if tally.get("untagged", 0) != len(fz["untagged_ids"]) or len(nn) - tally.get("untagged", 0) != fz["tagged_count"]:
        sys.exit("FAIL: end-state counts != frozen counts")
    print("0-COLLATERAL + END-STATE: PASS")


if __name__ == "__main__":
    main()
