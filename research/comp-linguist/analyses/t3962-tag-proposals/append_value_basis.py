#!/usr/bin/env python3
"""t/4066 item 3: add the combined value_basis justifications to taxonomy/Origin/pov-tag-proposals.json. ADDITIVE ONLY.

PI authorization: t/4066#1 item 3. SO: e/278#2 (proceed with conditions). /data-mutation discipline:
  * base pinned: refuses unless the file's sha256 equals the combined run's base_side_file_sha256 (17ffb163);
  * every existing byte of every item and top-level key is preserved; only value_basis*, plus the top-level
    value_basis_run, are added (proved structurally before writing);
  * SO condition 1, enforced here too: every vh_index / vh_index_uncertain is an int within the 1-based bounds
    of the matching value_hierarchies snapshot array (null and [] allowed);
  * item ids must match exactly (no item added or dropped by the combine).
Items carry indices only; each hierarchy's text is stored ONCE in value_basis_run.value_hierarchies (e/278).

Dry run by default.  Usage: python append_value_basis.py <data_root> <combined.json> [--write]
"""
import hashlib, json, os, sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
SOULS = os.path.join(REPO, "lib", "debate", "soul-docs")
SIDE = os.path.join("taxonomy", "Origin", "pov-tag-proposals.json")
SOUL_FILES = {"critical": "skeptic.critical.soul.json", "institutional": "skeptic.institutional.soul.json",
              "shared": "skeptic.soul.json"}


def fail(msg):
    sys.exit(f"ABORT: {msg}")


def main():
    if len(sys.argv) < 3:
        fail(__doc__)
    data, combined_path, write = sys.argv[1], sys.argv[2], "--write" in sys.argv[3:]
    path = os.path.join(data, SIDE)
    raw = open(path, "rb").read()
    comb = json.load(open(combined_path, encoding="utf-8"))
    run = comb["value_basis_run"]
    if hashlib.sha256(raw).hexdigest() != run["base_side_file_sha256"]:
        fail(f"side file sha256 {hashlib.sha256(raw).hexdigest()} != pinned base {run['base_side_file_sha256']}")
    side = json.loads(raw)
    if (json.dumps(side, indent=2, ensure_ascii=False) + "\n").encode("utf-8") != raw:
        fail("side file does not round-trip through the canonical serializer; refusing to rewrite it")
    if "value_basis_run" in side or any(k.startswith("value_basis") for p in side["proposals"] for k in p):
        fail("side file already carries value_basis fields")

    # Snapshot of the Value Hierarchies, checked against the hashes the runs recorded (no drift since the runs).
    hier = {}
    for k, f in SOUL_FILES.items():
        b = open(os.path.join(SOULS, f), "rb").read()
        if hashlib.sha256(b).hexdigest() != run["soul_doc_sha256"][k]:
            fail(f"{f} changed since the justification runs (sha256 mismatch); re-run before writing")
        hier[k] = json.loads(b)["value_hierarchy"]

    def check_idx(v, n, where, single=False):
        vals = [v] if single else v
        if v is None or v == []:
            return
        if not isinstance(vals, list) or any(not isinstance(i, int) or isinstance(i, bool) or not 1 <= i <= n for i in vals):
            fail(f"{where}: index {v!r} outside 1..{n} (SO e/278#2 condition 1)")

    by_id = {r["node_id"]: r for r in comb["items"]}
    side_ids = [p["node_id"] for p in side["proposals"]]
    if set(by_id) != set(side_ids) or len(by_id) != len(side_ids):
        fail(f"combined ids != side-file ids (missing {sorted(set(side_ids) - set(by_id))[:5]}, extra {sorted(set(by_id) - set(side_ids))[:5]})")

    new_props = []
    for p in side["proposals"]:
        r = by_id[p["node_id"]]
        if [e["tag"] for e in r["value_basis"]] != sorted(p["proposed"], key=lambda t: ["critical", "institutional"].index(t)):
            fail(f"{p['node_id']}: value_basis tags {[e['tag'] for e in r['value_basis']]} != proposed {p['proposed']}")
        vb = []
        for e in r["value_basis"]:
            n = len(hier[e["tag"]])
            check_idx(e["vh_index"], n, f"{p['node_id']}.{e['tag']}.vh_index")
            check_idx(e["vh_index_uncertain"], n, f"{p['node_id']}.{e['tag']}.vh_index_uncertain")
            vb.append({"tag": e["tag"], "vh_index": e["vh_index"], "vh_index_uncertain": e["vh_index_uncertain"],
                       "why": e["why"], "unsupported": e["unsupported"]})
        q = dict(p)  # existing keys, existing order, existing values
        q["value_basis"] = vb
        if "value_basis_shared" in r:
            s = r["value_basis_shared"]
            check_idx(s["vh_index"], len(hier["shared"]), f"{p['node_id']}.shared.vh_index")
            check_idx(s["vh_index_uncertain"], len(hier["shared"]), f"{p['node_id']}.shared.vh_index_uncertain")
            q["value_basis_shared"] = {"vh_index": s["vh_index"], "vh_index_uncertain": s["vh_index_uncertain"],
                                       "why": s["why"], "unsupported": s["unsupported"]}
        if "value_basis_nearest" in r:
            nr = r["value_basis_nearest"]
            if nr["tag"] is not None and nr["tag"] not in ("critical", "institutional"):
                fail(f"{p['node_id']}: nearest tag {nr['tag']!r}")
            if nr["vh_index"] is not None:
                check_idx(nr["vh_index"], len(hier[nr["tag"]]) if nr["tag"] else 0, f"{p['node_id']}.nearest", single=True)
            q["value_basis_nearest"] = {"tag": nr["tag"], "vh_index": nr["vh_index"], "why": nr["why"], "agree": nr["agree"]}
        new_props.append(q)

    # soul_provenance (SO e/278#5/#7): the CANONICAL buildSoulProvenance output (fnv1a64, soul-docs-relative file),
    # produced by soul_provenance.mts and recorded verbatim. It is what the queue compares; soul_doc_sha256 stays
    # forensic only (nothing compares against it).
    prov_arg = next((a.split("=", 1)[1] for a in sys.argv[3:] if a.startswith("--provenance=")), None)
    if not prov_arg:
        fail("--provenance=<file> (output of: npx tsx soul_provenance.mts emit) is required")
    prov = json.load(open(prov_arg, encoding="utf-8"))
    if set(prov) != set(SOUL_FILES) or any(prov[k]["file"] != SOUL_FILES[k] or not prov[k]["hash"].startswith("fnv1a64:")
                                           or len(prov[k]["hash"]) != len("fnv1a64:") + 16 for k in SOUL_FILES):
        fail(f"provenance file malformed: {prov}")

    out = dict(side)
    out["proposals"] = new_props
    out["value_basis_run"] = {**{k: v for k, v in run.items() if k != "stability"},
                              "soul_provenance": prov, "index_base": 1, "value_hierarchies": hier,
                              "stability": run["stability"]}

    # 0-collateral, structurally: every original key/value unchanged; only value_basis* keys added.
    if [k for k in out if k != "value_basis_run"] != list(side.keys()):
        fail("top-level key order changed")
    if any(out[k] != side[k] for k in side if k != "proposals"):
        fail("a non-proposal top-level field changed")
    for a, b in zip(side["proposals"], out["proposals"]):
        added = [k for k in b if k not in a]
        if any(b[k] != a[k] for k in a) or list(b.keys())[: len(a)] != list(a.keys()) or any(not k.startswith("value_basis") for k in added):
            fail(f"{a['node_id']}: an existing field changed or a non-value_basis key was added")
    text = (json.dumps(out, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    if json.loads(text) != out:
        fail("re-parse mismatch")

    flags = sum(e["unsupported"] for q in new_props for e in q["value_basis"])
    print(f"{len(new_props)} items | value_basis added to all | unsupported tag slots {flags} | "
          f"bytes {len(raw)} -> {len(text)} | new sha256 {hashlib.sha256(text).hexdigest()}")
    if write:
        open(path, "wb").write(text)
        print(f"WROTE {path}")
    else:
        print("dry run (no --write)")


if __name__ == "__main__":
    main()
