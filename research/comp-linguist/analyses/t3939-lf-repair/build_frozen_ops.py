#!/usr/bin/env python3
"""t/3939: build the frozen op list for the targeted logical_form repair (dry; writes only frozen-ops.json).

Two op kinds, both against node.logical_form in taxonomy/Origin/{accelerationist,safetyist,skeptic}.json:
  drop_discourse_agent - remove ONLY the args[] entry whose role is agent and whose ref names a
                         meta-collective ("<camp> discourse"). Everything else in the frame, status
                         included, is untouched. Deterministic; no model.
  replace_frame        - replace the whole frame with a fresh one (cleaned input + live v3.1b prompt)
                         whose predicate was unanimous across 3 drafts. Status becomes "proposed", so the
                         node needs re-promotion review.

Also proves the serializer round-trips each file byte-identically, the precondition for a 0-collateral
apply. Usage: AI_TRIAD_DATA_ROOT=<data worktree> python build_frozen_ops.py <drafts dir>
"""
import hashlib, json, os, re, sys
sys.stdout.reconfigure(encoding="utf-8")
D = os.environ["AI_TRIAD_DATA_ROOT"]
O = os.path.join(D, "taxonomy", "Origin")
FILES = ("accelerationist.json", "safetyist.json", "skeptic.json")
DISC = re.compile(r"\b(discourse|the document|the view)\b", re.I)
REPLACE = ("saf-intentions-127", "skp-beliefs-232")  # wrong main act (t/3884); fresh predicate 3 of 3
HERE = os.path.dirname(os.path.abspath(__file__))


def dumps(doc):
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


drafts = [json.load(open(os.path.join(sys.argv[1], f"all_d{k}.json"), encoding="utf-8"))["all"] for k in (1, 2, 3)]
ops, roundtrip = [], {}
for fn in FILES:
    raw = open(os.path.join(O, fn), encoding="utf-8", newline="").read()
    doc = json.loads(raw)
    roundtrip[fn] = dumps(doc) == raw
    for n in doc["nodes"]:
        lf = n.get("logical_form")
        if not isinstance(lf, dict):
            continue
        before = hashlib.sha256(json.dumps(lf, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
        if n["id"] in REPLACE:
            preds = {(d.get(n["id"]) or {}).get("predicate") for d in drafts}
            assert len(preds) == 1 and None not in preds, f"{n['id']}: fresh predicate not unanimous {preds}"
            ops.append({"op": "replace_frame", "file": fn, "id": n["id"], "before_sha16": before,
                        "live_predicate": lf.get("predicate"), "new_frame": drafts[0][n["id"]]})
            continue
        bad = [a for a in lf.get("args") or [] if a.get("role") == "agent"
               and isinstance(a.get("ref"), str) and DISC.search(a["ref"])]
        if bad:
            assert len(bad) == 1, f"{n['id']}: more than one discourse agent"
            ops.append({"op": "drop_discourse_agent", "file": fn, "id": n["id"], "before_sha16": before,
                        "predicate": lf.get("predicate"), "drop_arg": bad[0]})
out = {
    "ticket": "t/3939", "supersedes": "t/3351 targeted 10-node class-B apply (pending PI decision, t/3351#4)",
    "data_base": os.popen(f'git -C "{D}" rev-parse --short HEAD').read().strip(),
    "authorization": "PENDING", "expected_ops": len(ops),
    "serializer_roundtrip_byte_identical": roundtrip, "ops": ops,
}
json.dump(out, open(os.path.join(HERE, "frozen-ops.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(f"base {out['data_base']} | ops {len(ops)} | round-trip byte-identical {roundtrip}")
for o in ops:
    print(f"  {o['op']:22} {o['id']:22} " + (f"drop {o['drop_arg']['ref']}" if o["op"] == "drop_discourse_agent"
                                              else f"predicate {o['live_predicate']} to {o['new_frame']['predicate']}"))
