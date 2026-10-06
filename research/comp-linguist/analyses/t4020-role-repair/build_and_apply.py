#!/usr/bin/env python3
"""t/4020: role-quality repair of 10 accepted logical_form frames. /data-mutation discipline.

  python build_and_apply.py freeze --data <root>    # write frozen-ops.json (pins each frame's before_sha16)
  python build_and_apply.py apply  --data <root>    # dry-run: verify every pin, prove 0 collateral
  python build_and_apply.py apply  --data <root> --apply

The operations below were decided per entry (t/4020#1). Each names the arg it changes by ref, so an arg that
moved or changed makes the run refuse. Frames keep `status: accepted`: every repair was reviewed per frame
(CL) and gets a second-agent recount.
  relabel  : change one arg's role (perdurant agent -> cause or theme)
  set_args : replace args with an exact new list (a recipient added or split out; patient -> theme/recipient)
"""
import argparse, copy, difflib, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FROZEN = os.path.join(HERE, "frozen-ops.json")
FILES = ["accelerationist.json", "safetyist.json", "skeptic.json"]
NAS, AGP, NAFA = "non-agentive-social-object", "agentive-physical-object", "non-agentive-functional-artifact"

# ── the reviewed operations ────────────────────────────────────────────────────────────────────────
RELABEL = [  # (file, id, ref of the agent arg, new role, why)
    ("accelerationist.json", "acc-beliefs-079", 'lit:"safety-induced deployment delays"', "cause", "delays bring about the costs"),
    ("safetyist.json", "saf-beliefs-269", 'lit:"processing system commands and untrusted user inputs in an identical token space"', "theme", "subject of stative 'constitute'"),
    ("safetyist.json", "saf-beliefs-270", 'lit:"selling commercial AI models into safety-critical environments without diagnostic telemetry hooks"', "theme", "subject of stative 'constitute'"),
    ("skeptic.json", "skp-beliefs-230", 'lit:"image-to-image regeneration attacks"', "cause", "attacks bring about the collapse"),
    ("skeptic.json", "skp-beliefs-232", 'lit:"normal web distribution"', "cause", "distribution brings about the destruction"),
    ("skeptic.json", "skp-beliefs-291", 'lit:"the demonstrated inability of Congress to pass even minor, non-controversial AI legislation"', "cause", "the inability renders solutions infeasible"),
]


def A(role, ref, sort):
    return {"role": role, "ref": ref, "sort": sort, "match_level": "exact"}


def set_args_ops(frames):
    """Exact new arg lists for the 4 recipient fixes, built from each frame's CURRENT args (so the freeze records
    precisely what is replaced)."""
    out = []
    lf = frames[("safetyist.json", "saf-intentions-127")]
    out.append(("safetyist.json", "saf-intentions-127",
                [A("theme", 'lit:"Stable Identities"', NAS), A("recipient", 'lit:"AI agents"', NAFA)],
                "the node names the recipient (AI agents); the transferred thing is a theme"))
    out.append(("safetyist.json", "saf-intentions-173",
                [A("recipient", 'lit:"every nation"', AGP), A("theme", 'lit:"a verified way to halt dangerous AI"', NAS)],
                "the recipient was fused into the patient literal; split it out"))
    lf = frames[("safetyist.json", "saf-intentions-043")]
    new = [dict(a) for a in lf["args"]]
    for a in new:
        if a["role"] == "patient" and a["ref"] == 'lit:"AI"':
            a["role"] = "recipient"
    out.append(("safetyist.json", "saf-intentions-043", new, "AI receives the duties: recipient, not patient"))
    lf = frames[("skeptic.json", "skp-beliefs-179")]
    out.append(("skeptic.json", "skp-beliefs-179", [dict(a) for a in lf["args"]] + [A("recipient", 'lit:"users"', AGP)],
                "the node names the recipient (paths for users)"))
    return out


def dumps(doc):
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def sha16(lf):
    return hashlib.sha256(json.dumps(lf, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def load(tax):
    raw, docs = {}, {}
    for fn in FILES:
        raw[fn] = open(os.path.join(tax, fn), encoding="utf-8", newline="").read()
        docs[fn] = json.loads(raw[fn])
        if dumps(docs[fn]) != raw[fn]:
            sys.exit(f"ABORT: {fn} does not round-trip byte-identically")
    return raw, docs


def freeze(tax):
    _, docs = load(tax)
    frames = {(fn, n["id"]): n["logical_form"] for fn in FILES for n in docs[fn]["nodes"] if n.get("logical_form")}
    ops = []
    for fn, nid, ref, role, why in RELABEL:
        lf = frames[(fn, nid)]
        hits = [a for a in lf["args"] if a["ref"] == ref and a["role"] == "agent" and a["sort"] == "perdurant"]
        if len(hits) != 1:
            sys.exit(f"ABORT freeze: {nid}: expected 1 perdurant agent with ref {ref}, found {len(hits)}")
        ops.append({"op": "relabel", "file": fn, "id": nid, "before_sha16": sha16(lf), "ref": ref, "from": "agent", "to": role, "why": why})
    for fn, nid, new_args, why in set_args_ops(frames):
        lf = frames[(fn, nid)]
        ops.append({"op": "set_args", "file": fn, "id": nid, "before_sha16": sha16(lf), "before_args": lf["args"], "new_args": new_args, "why": why})
    json.dump({"ticket": "t/4020", "authorization": "PENDING", "expected_ops": len(ops), "ops": ops},
              open(FROZEN, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"frozen {len(ops)} ops -> {FROZEN}")


def apply(tax, write):
    frozen = json.load(open(FROZEN, encoding="utf-8"))
    ops = frozen["ops"]
    if len(ops) != frozen["expected_ops"]:
        sys.exit("ABORT: op count mismatch")
    raw, docs = load(tax)
    before = copy.deepcopy(docs)
    idx = {(fn, n["id"]): n for fn in FILES for n in docs[fn]["nodes"]}
    for o in ops:
        lf = idx[(o["file"], o["id"])]["logical_form"]
        if sha16(lf) != o["before_sha16"]:
            sys.exit(f"ABORT: {o['id']} frame changed since freeze")
        if o["op"] == "relabel":
            hits = [a for a in lf["args"] if a["ref"] == o["ref"] and a["role"] == o["from"]]
            if len(hits) != 1:
                sys.exit(f"ABORT: {o['id']}: arg to relabel not found exactly once")
            hits[0]["role"] = o["to"]
        else:
            if lf["args"] != o["before_args"]:
                sys.exit(f"ABORT: {o['id']}: args differ from frozen before_args")
            lf["args"] = copy.deepcopy(o["new_args"])
    targets = {(o["file"], o["id"]): o for o in ops}
    for fn in FILES:  # 0-collateral: only the args of the targets change
        b, d = before[fn], docs[fn]
        if [n["id"] for n in b["nodes"]] != [n["id"] for n in d["nodes"]] or \
                {k: v for k, v in b.items() if k != "nodes"} != {k: v for k, v in d.items() if k != "nodes"}:
            sys.exit(f"ABORT: {fn} structure changed")
        for nb, nd in zip(b["nodes"], d["nodes"]):
            if (fn, nb["id"]) not in targets:
                if nb != nd: sys.exit(f"ABORT: non-target {nb['id']} changed")
                continue
            if {k: v for k, v in nb.items() if k != "logical_form"} != {k: v for k, v in nd.items() if k != "logical_form"} or \
               {k: v for k, v in nb["logical_form"].items() if k != "args"} != {k: v for k, v in nd["logical_form"].items() if k != "args"}:
                sys.exit(f"ABORT: {nb['id']} changed outside logical_form.args")
    perd = sum(1 for fn in FILES for n in docs[fn]["nodes"] for a in (n.get("logical_form") or {}).get("args", [])
               if a.get("role") == "agent" and a.get("sort") == "perdurant")
    for fn in FILES:
        diff = [l for l in difflib.unified_diff(raw[fn].splitlines(), dumps(docs[fn]).splitlines(), lineterm="", n=0)
                if l[:1] in "+-" and l[:3] not in ("+++", "---")]
        print(f"{fn}: {sum(l[0] == '-' for l in diff)} removed, {sum(l[0] == '+' for l in diff)} added")
    print(f"0-collateral: PASS | {len(ops)} ops | perdurant agents remaining: {perd}")
    if not write:
        print("dry-run: nothing written"); return
    for fn in FILES:
        if dumps(docs[fn]) != raw[fn]:
            open(os.path.join(tax, fn), "w", encoding="utf-8", newline="").write(dumps(docs[fn])); print("APPLIED:", fn)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("cmd", choices=["freeze", "apply"])
    ap.add_argument("--data", required=True); ap.add_argument("--apply", action="store_true")
    a = ap.parse_args(); tax = os.path.join(a.data, "taxonomy", "Origin")
    freeze(tax) if a.cmd == "freeze" else apply(tax, a.apply)
