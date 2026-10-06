#!/usr/bin/env python3
"""t/4024 golden regression: base prompt vs candidate (base + the two t/4020 bullets), 3 drafts each on the t/3884
43-node set, same formalizer (origin/main, no t/4020 validator refusal, so only the prompt differs).

Pass (stated on t/4024 before the run): the candidate does not lower gold-match, and does not raise class A
(stance leak) or class B (discourse agent). Target measures: perdurant agents, and recipients on transfer predicates.
"""
import collections, importlib.util, json, os, sys
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
V31 = os.path.join(HERE, "..", "t3884-lf-v31")
IDS = json.load(open(os.path.join(V31, "dryrun-ids.json"), encoding="utf-8"))
GOLD = json.load(open(os.path.join(V31, "gold-predicates.json"), encoding="utf-8"))["nodes"]
spec = importlib.util.spec_from_file_location("scan", os.path.join(HERE, "..", "t3351-lf-v3", "scan_lf_defects.py"))
scan = importlib.util.module_from_spec(spec); spec.loader.exec_module(scan)
TEXT = scan._node_text()
ALL = IDS["in_sample"] + IDS["out_of_sample"]
TRANSFER = {"give", "grant", "assign", "provide", "allocate"}


def load(arm):
    frames = collections.defaultdict(list)
    for d in (1, 2, 3):
        got = json.load(open(os.path.join(HERE, f"{arm}_d{d}.json"), encoding="utf-8")).get("all") or {}
        for nid in ALL:
            frames[nid].append(got.get(nid))
    return frames


def score(frames):
    s = collections.Counter()
    for nid in ALL:
        label, desc = TEXT.get(nid, ("", ""))
        preds = [(lf or {}).get("predicate", "").strip().lower() or None for lf in frames[nid]]
        if nid in GOLD:
            s["gold_match"] += sum(1 for p in preds if p and p in GOLD[nid]["ok"])
            s["gold_known_defect"] += sum(1 for p in preds if p and p in GOLD[nid].get("not", []))
        s["failed"] += sum(1 for lf in frames[nid] if not lf)
        s["stable_nodes"] += int(len({p for p in preds if p}) == 1 and None not in preds)
        for lf in frames[nid]:
            if not lf:
                continue
            raw = lf.get("predicate", "").strip().lower(); p = scan.norm_pred(raw)
            args = lf.get("args") or []
            if (raw in scan.BAN_STANCE or p in scan.BAN_STANCE) and scan.stance_verdict(raw if raw in scan.BAN_STANCE else p, label, desc)[0]:
                s["classA_stance_leak"] += 1
            if any(isinstance(a.get("ref"), str) and scan.DISCOURSE_AGENT_RE.search(a["ref"]) for a in args):
                s["classB_discourse_agent"] += 1
            s["perdurant_agent"] += sum(1 for a in args if a.get("role") == "agent" and a.get("sort") == "perdurant")
            s["cause_args"] += sum(1 for a in args if a.get("role") == "cause")
            if raw in TRANSFER:
                s["transfer_frames"] += 1
                s["transfer_with_recipient"] += int(any(a.get("role") == "recipient" for a in args))
    return s


arms = {a: score(load(a)) for a in ("base", "cand")}
keys = ["gold_match", "gold_known_defect", "failed", "stable_nodes", "classA_stance_leak", "classB_discourse_agent",
        "perdurant_agent", "cause_args", "transfer_frames", "transfer_with_recipient"]
denom = {"gold_match": f"/{len([n for n in ALL if n in GOLD]) * 3}", "stable_nodes": f"/{len(ALL)}", "failed": f"/{len(ALL) * 3}"}
print(f"{'measure':26} {'base':>8} {'cand':>8}")
for k in keys:
    print(f"{k:26} {str(arms['base'][k]) + denom.get(k, ''):>8} {str(arms['cand'][k]) + denom.get(k, ''):>8}")
b, c = arms["base"], arms["cand"]
ok = c["gold_match"] >= b["gold_match"] - 2 and c["classA_stance_leak"] <= b["classA_stance_leak"] and c["classB_discourse_agent"] <= b["classB_discourse_agent"]
print("\nPASS" if ok else "\nFAIL", "(gold-match within draft noise of 2/69, as in t/3884; class A and B not raised)")
