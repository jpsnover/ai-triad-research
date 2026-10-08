#!/usr/bin/env python3
"""t/3962 step 4: freeze the pov_tags assignments from the fully-reviewed side file (PI p/314#192).

/data-mutation element 1: this is the ONLY place the target set is derived. apply_pov_tags.ps1 and
verify_pov_tags.py read frozen_assignments.json and never re-derive it.

Reads taxonomy/Origin/pov-tag-proposals.json and taxonomy/Origin/skeptic.json at <ref> (default origin/main)
from the data repo. Refuses unless every proposal is judged (accepted|modified|rejected), each proposal maps
1:1 to a skeptic.json node, and no node already carries pov_tags. A rejected item or an empty `final` freezes
as tags [] (the writer records "checked, explicitly untagged"; t/3969#2 cond B.6).

Usage: python freeze_assignments.py <data_root> [<ref>]   -> writes frozen_assignments.json next to this file
"""
import hashlib, json, os, subprocess, sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
SIDE = "taxonomy/Origin/pov-tag-proposals.json"
SKP = "taxonomy/Origin/skeptic.json"


def show(data, ref, path):
    r = subprocess.run(["git", "-C", data, "show", f"{ref}:{path}"], capture_output=True)
    if r.returncode:
        sys.exit(f"ABORT: git show {ref}:{path} failed: {r.stderr.decode(errors='replace')}")
    return r.stdout


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    data = sys.argv[1]
    ref = sys.argv[2] if len(sys.argv) > 2 else "origin/main"
    commit = subprocess.run(["git", "-C", data, "rev-parse", ref], capture_output=True, text=True).stdout.strip()
    side_raw, skp_raw = show(data, ref, SIDE), show(data, ref, SKP)
    props = json.loads(side_raw)["proposals"]
    nodes = json.loads(skp_raw)["nodes"]
    node_ids = [n["id"] for n in nodes]

    pending = [p["node_id"] for p in props if p["status"] not in ("accepted", "modified", "rejected")]
    if pending:
        sys.exit(f"ABORT: {len(pending)} proposals not judged: {pending[:5]}")
    pids = [p["node_id"] for p in props]
    if len(set(pids)) != len(pids):
        sys.exit("ABORT: duplicate node_id in proposals")
    if set(pids) != set(node_ids):
        sys.exit(f"ABORT: proposal/node mismatch: only-proposal {sorted(set(pids) - set(node_ids))[:5]}, "
                 f"only-node {sorted(set(node_ids) - set(pids))[:5]}")
    pre_tagged = [n["id"] for n in nodes if "pov_tags" in n]
    if pre_tagged:
        sys.exit(f"ABORT: {len(pre_tagged)} nodes already carry pov_tags: {pre_tagged[:5]}")

    by = {p["node_id"]: p for p in props}
    assignments = []
    for nid in node_ids:  # skeptic.json node order
        p = by[nid]
        tags = [] if p["status"] == "rejected" or p.get("final") is None else list(p["final"])
        assignments.append({"node_id": nid, "tags": tags, "status": p["status"], "reviewed_by": p["reviewed_by"]})

    untagged = [a["node_id"] for a in assignments if not a["tags"]]
    out = {
        "ticket": "t/3962 step 4",
        "authorization": "PI p/314#192 (recorded t/3962#18)",
        "base_data_commit": commit,
        "base_side_file_sha256": hashlib.sha256(side_raw).hexdigest(),
        "base_skeptic_sha256": hashlib.sha256(skp_raw).hexdigest(),
        "count": len(assignments),
        "tagged_count": len(assignments) - len(untagged),
        "untagged_ids": untagged,
        "assignments": assignments,
    }
    with open(os.path.join(HERE, "frozen_assignments.json"), "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"froze {out['count']} ({out['tagged_count']} tagged, {len(untagged)} untagged) at {commit[:8]}")


if __name__ == "__main__":
    main()
