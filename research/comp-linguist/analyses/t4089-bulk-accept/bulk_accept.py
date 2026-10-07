#!/usr/bin/env python3
"""t/4089: bulk-accept the FROZEN list of pov_tag proposals (PI p/314#183, #185). Dry run by default.

/data-mutation: reads ONLY frozen_ids.json (never re-derives the set); refuses unless the side file's sha256
equals the frozen base; refuses if any frozen id is missing or no longer `pending`. For each frozen id it sets
the four review fields only: status=accepted, final=proposed, reviewed_by=<frozen marker>, reviewed_at=<now>.
Everything else is byte-identical (re-serialized canonically, the queue's format). Verify afterwards with
../t3962-tag-proposals/check_review_session.py.

Usage: python bulk_accept.py <data_root> [--write]
"""
import datetime, hashlib, json, os, sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
SIDE = os.path.join("taxonomy", "Origin", "pov-tag-proposals.json")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    data, write = sys.argv[1], "--write" in sys.argv[2:]
    frozen = json.load(open(os.path.join(HERE, "frozen_ids.json"), encoding="utf-8"))
    path = os.path.join(data, SIDE)
    raw = open(path, "rb").read()
    if hashlib.sha256(raw).hexdigest() != frozen["base_side_file_sha256"]:
        sys.exit(f"ABORT: side file sha256 != frozen base {frozen['base_side_file_sha256'][:12]} (file changed since freeze)")
    d = json.loads(raw)
    if (json.dumps(d, indent=2, ensure_ascii=False) + "\n").encode("utf-8") != raw:
        sys.exit("ABORT: side file is not in canonical serialization; refusing to rewrite")
    ids = frozen["node_ids"]
    if len(ids) != frozen["count"] or len(set(ids)) != len(ids):
        sys.exit("ABORT: frozen list count/duplicate mismatch")
    by = {p["node_id"]: p for p in d["proposals"]}
    missing = [i for i in ids if i not in by]
    not_pending = [i for i in ids if i in by and by[i]["status"] != "pending"]
    if missing or not_pending:
        sys.exit(f"ABORT: missing {missing[:5]} / no longer pending {not_pending[:5]}")
    if set(ids) & set(frozen["excluded_by_pi"]):
        sys.exit("ABORT: a PI-excluded id is in the frozen list")
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{datetime.datetime.now(datetime.timezone.utc).microsecond // 1000:03d}Z"
    for i in ids:
        p = by[i]
        p["status"], p["final"], p["reviewed_by"], p["reviewed_at"] = "accepted", list(p["proposed"]), frozen["reviewed_by"], now
    text = (json.dumps(d, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    statuses = {}
    for p in d["proposals"]:
        statuses[p["status"]] = statuses.get(p["status"], 0) + 1
    print(f"accepted {len(ids)} | statuses after: {statuses} | reviewed_at {now} | new sha256 {hashlib.sha256(text).hexdigest()}")
    if write:
        open(path, "wb").write(text)
        print(f"WROTE {path}")
    else:
        print("dry run (no --write)")


if __name__ == "__main__":
    main()
