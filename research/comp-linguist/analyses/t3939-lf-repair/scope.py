"""t/3939 scope: which live node.logical_form predicates would a fresh, cleaned-input run change?

Candidate = 2 or more of the 3 fresh drafts agree on a predicate, and that majority predicate differs
from the live one. Also reports the noise floor (nodes whose own 3 drafts disagree), and the class A
and class B defect counts in live vs majority frames, via scan_lf_defects.
"""
import collections, importlib.util, json, os, sys
sys.stdout.reconfigure(encoding="utf-8")
SP = os.path.dirname(os.path.abspath(__file__))
os.environ["AI_TRIAD_DATA_ROOT"] = r"C:\Users\jsnov\repos\ai-triad-data\.worktrees\t3939"
W = r"C:\Users\jsnov\repos\ai-triad-research\.worktrees\t3939\research\comp-linguist"


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m); return m


flf = load(os.path.join(W, "tools", "formalize_node_lf.py"), "flf")
scan = load(os.path.join(W, "analyses", "t3351-lf-v3", "scan_lf_defects.py"), "scan")
TEXT = scan._node_text()
live = {n["id"]: n["logical_form"] for _, _, n in flf.load_nodes()}
drafts = [json.load(open(os.path.join(SP, f"all_d{d}.json"), encoding="utf-8"))["all"] for d in (1, 2, 3)]


def pred(lf):
    return (lf or {}).get("predicate", "").strip().lower() or None


def is_leak(lf, nid):
    p = pred(lf)
    if not p:
        return False
    base = p if p in scan.BAN_STANCE else scan.norm_pred(p)
    return base in scan.BAN_STANCE and scan.stance_verdict(base, *TEXT.get(nid, ("", "")))[0]


def is_disc_agent(lf):
    return any(a.get("role") == "agent" and isinstance(a.get("ref"), str) and scan.DISCOURSE_AGENT_RE.search(a["ref"])
               for a in (lf or {}).get("args") or [])


cands, unstable, same, failed = [], 0, 0, 0
lv = {"leak": 0, "disc": 0}; mj = {"leak": 0, "disc": 0}
for nid, lf in live.items():
    ps = [pred(d.get(nid)) for d in drafts]
    if not any(ps):
        failed += 1; continue
    top, n = collections.Counter(p for p in ps if p).most_common(1)[0]
    if n < 2:
        unstable += 1; continue
    frame = next(d[nid] for d in drafts if pred(d.get(nid)) == top)
    lv["leak"] += is_leak(lf, nid); lv["disc"] += is_disc_agent(lf)
    mj["leak"] += is_leak(frame, nid); mj["disc"] += is_disc_agent(frame)
    if top == pred(lf):
        same += 1
    else:
        cands.append({"id": nid, "live": pred(lf), "fresh": top, "votes": n, "drafts": ps})
total = len(live)
print(f"grounded nodes {total} | fresh majority == live {same} | candidates (majority differs) {len(cands)} | "
      f"no 2-of-3 majority {unstable} | all drafts failed {failed}")
print(f"defects among nodes with a majority: live leak {lv['leak']} disc {lv['disc']}  vs  fresh leak {mj['leak']} disc {mj['disc']}")
print(f"unanimous (3 of 3) candidates: {sum(1 for c in cands if c['votes'] == 3)}")
for i in ("saf-intentions-127", "skp-beliefs-232"):
    c = next((c for c in cands if c["id"] == i), None)
    print(f"  {i}: " + (f"live {c['live']} -> fresh {c['fresh']} ({c['votes']}/3)" if c else "not a candidate"))
json.dump({"same": same, "unstable": unstable, "failed": failed, "candidates": cands},
          open(os.path.join(SP, "scope.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("first 25 candidates:")
for c in cands[:25]:
    print(f"  {c['id']:22} {c['live']} -> {c['fresh']} ({c['votes']}/3)")
