"""t/3939 targeted set: live frame has a DETECTABLE defect, fresh frame is unanimous (3 of 3) and defect-free.

Detectable defects: class A stance leak, class B discourse-as-agent (scan_lf_defects), and the two
known wrong-main-act nodes from t/3884. Also lists every fresh frame that would INTRODUCE a defect.
"""
import importlib.util, json, os, sys
sys.stdout.reconfigure(encoding="utf-8")
SP = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0]]
spec = importlib.util.spec_from_file_location("scope", os.path.join(SP, "scope.py"))
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)  # re-prints the scope summary; harmless
print("=" * 60)
KNOWN = {"saf-intentions-127", "skp-beliefs-232"}
targets, introduced = [], []
for nid, lf in S.live.items():
    ps = [S.pred(d.get(nid)) for d in S.drafts]
    if not all(ps) or len(set(ps)) != 1:
        fresh = None
    else:
        fresh = next(d[nid] for d in S.drafts)
    live_def = [k for k, f in (("leak", S.is_leak(lf, nid)), ("disc", S.is_disc_agent(lf))) if f]
    if nid in KNOWN:
        live_def.append("wrong-main-act")
    if fresh is not None:
        fresh_def = [k for k, f in (("leak", S.is_leak(fresh, nid)), ("disc", S.is_disc_agent(fresh))) if f]
        if fresh_def and not live_def:
            introduced.append((nid, S.pred(lf), S.pred(fresh), fresh_def))
    if live_def:
        ok = fresh is not None and not (S.is_leak(fresh, nid) or S.is_disc_agent(fresh))
        targets.append({"id": nid, "live_pred": S.pred(lf), "live_defects": live_def,
                        "fresh_pred": S.pred(fresh) if fresh else None, "eligible": ok,
                        "reason": "" if ok else ("fresh not unanimous" if fresh is None else "fresh frame also defective")})
print("nodes whose LIVE frame has a detectable defect:", len(targets))
for t in targets:
    flag = "ELIGIBLE" if t["eligible"] else "excluded (" + t["reason"] + ")"
    print(f"  {t['id']:22} live {t['live_pred']:12} {','.join(t['live_defects']):18} fresh {str(t['fresh_pred']):12} {flag}")
print("eligible:", sum(t["eligible"] for t in targets))
print("\nfresh frames that would INTRODUCE a defect where live had none:", len(introduced))
for i in introduced:
    print(f"  {i[0]:22} live {i[1]:12} fresh {i[2]:12} {','.join(i[3])}")
json.dump({"targets": targets, "introduced": [list(i) for i in introduced]},
          open(os.path.join(SP, "targeted.json"), "w", encoding="utf-8"), indent=1)
