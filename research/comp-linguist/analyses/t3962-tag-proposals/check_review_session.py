#!/usr/bin/env python3
"""t/4056: field-only check for a pov-tag review session, run BEFORE CL commits the reviewed side file.

Compares the WORKING-TREE taxonomy/Origin/pov-tag-proposals.json in a data checkout against its origin/main blob.
PASS (exit 0) only when the PI's standing authorization (t/4056#2) is satisfied:
  * only the queue-owned review fields changed: status, final, reviewed_by, reviewed_at;
  * only on items whose new status is not `pending`;
  * no item added, removed or reordered; no top-level field changed (value_basis_run, run, ... untouched);
  * every other field byte-for-byte equal (value_basis*, proposed, rationale, ...);
  * the file is in canonical serialization (JSON.stringify(p, null, 2) + "\n", LF), as the queue writes it.
Any failure means STOP and go back to the PI; never commit a file that fails this.

Usage: python check_review_session.py <data_root>     (read-only; prints the session's reviewed ids)
"""
import collections, json, os, subprocess, sys

sys.stdout.reconfigure(encoding="utf-8")
SIDE = "taxonomy/Origin/pov-tag-proposals.json"
OWNED = {"status", "final", "reviewed_by", "reviewed_at"}


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    data = sys.argv[1]
    # Stale checkout first: if the checkout is behind origin/main, the queue has been reading and saving an old
    # file (e.g. one without value_basis), and committing it would revert later writes. Name that, don't diff it.
    # (Fetch first; this script is read-only and never fetches or syncs.)
    head = subprocess.run(["git", "-C", data, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    main_ = subprocess.run(["git", "-C", data, "rev-parse", "origin/main"], capture_output=True, text=True).stdout.strip()
    if not head or head != main_:
        print(f"FIELD-ONLY CHECK: FAIL\n  - checkout HEAD {head[:8]} != origin/main {main_[:8]}: the checkout is stale. "
              "Do NOT commit; get the shared data checkout synced (DevOps, docs/shared-tree-divergence.md) and re-review.")
        sys.exit(1)
    r = subprocess.run(["git", "-C", data, "show", f"origin/main:{SIDE}"], capture_output=True)
    if r.returncode != 0:
        sys.exit(f"ABORT: cannot read origin/main:{SIDE} in {data}: {r.stderr.decode('utf-8', 'replace')[:200]}")
    base = json.loads(r.stdout)
    wt_raw = open(os.path.join(data, *SIDE.split("/")), encoding="utf-8", newline="").read()
    wt = json.loads(wt_raw)
    problems = []
    if [k for k in wt if k != "proposals"] != [k for k in base if k != "proposals"] or \
       any(wt[k] != base[k] for k in base if k != "proposals"):
        problems.append("a top-level field other than proposals changed")
    bi, wi = base["proposals"], wt["proposals"]
    if [p["node_id"] for p in bi] != [p["node_id"] for p in wi]:
        problems.append("items added, removed or reordered")
    changed, statuses, reviewers = [], collections.Counter(), collections.Counter()
    for b, w in zip(bi, wi):
        if b == w:
            continue
        if list(b.keys()) != list(w.keys()):
            problems.append(f"{b['node_id']}: key set or order changed")
        diff = {k for k in b if b.get(k) != w.get(k)}
        if diff - OWNED:
            problems.append(f"{b['node_id']}: non-review fields changed {sorted(diff - OWNED)}")
        if w["status"] == "pending":
            problems.append(f"{b['node_id']}: changed but still pending")
        expected_final = {"accepted": w["proposed"], "rejected": []}.get(w["status"])
        if w["status"] == "modified" and sorted(w["final"] or []) == sorted(w["proposed"]):
            problems.append(f"{b['node_id']}: modified with final == proposed")
        if expected_final is not None and w["final"] != expected_final:
            problems.append(f"{b['node_id']}: final inconsistent with status {w['status']}")
        changed.append(w["node_id"]); statuses[w["status"]] += 1; reviewers[w["reviewed_by"]] += 1
    if (json.dumps(wt, indent=2, ensure_ascii=False) + "\n") != wt_raw:
        problems.append("working file is not in canonical serialization (or has CRLF)")
    print(f"reviewed this session: {len(changed)} {dict(statuses)} by {dict(reviewers)}")
    print("  ids:", changed)
    print("FIELD-ONLY CHECK:", "PASS" if not problems else "FAIL")
    for p in problems:
        print("  -", p)
    sys.exit(0 if not problems else 1)


if __name__ == "__main__":
    main()
