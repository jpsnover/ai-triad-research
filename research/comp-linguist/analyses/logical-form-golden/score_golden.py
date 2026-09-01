#!/usr/bin/env python3
"""t/3126 D3a/D3b — score a candidate logical_form set against the golden references, per component.

  python score_golden.py --self                      # validate the golden refs are schema-valid (runnable now)
  python score_golden.py --candidates cand.json      # D3b: score the real pass output vs the references

cand.json maps golden row id -> a logical_form object (the pass's output for that claim).
Reports per-component accuracy (predicate / args / polarity / modality / temporal / about) and the
overall formalization_accuracy = mean of the component scores. Per-component so a low overall is
diagnosable (predicate vs role vs temporal have different downstream costs)."""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROLES = {"agent","patient","theme","recipient","instrument","location","source","goal","beneficiary","cause","manner"}
ATTITUDES = {"belief","desire","intention"}
MATCH_LEVELS = {"exact","instance_of","subclass","superclass","related"}
TEMPORAL_TYPES = {"at","before","after","during","unspecified"}
STATUSES = {"proposed","accepted","rejected"}


def schema_errors(lf):
    """Return a list of schema violations for one logical_form (empty = valid)."""
    e = []
    if not isinstance(lf, dict): return ["not an object"]
    if not lf.get("predicate"): e.append("missing predicate")
    if not lf.get("event_ref"): e.append("missing event_ref")
    for i, a in enumerate(lf.get("args") or []):
        if a.get("role") not in ROLES: e.append(f"args[{i}].role invalid: {a.get('role')}")
        if not a.get("ref"): e.append(f"args[{i}].ref missing")
        if a.get("match_level") not in MATCH_LEVELS: e.append(f"args[{i}].match_level invalid: {a.get('match_level')}")
    if lf.get("polarity") not in {"positive","negative"}: e.append(f"polarity invalid: {lf.get('polarity')}")
    m = lf.get("modality", "MISSING")
    if m == "MISSING": e.append("modality key absent (use null for factual)")
    elif m is not None:
        if not str(m.get("holder","")).startswith("camp:"): e.append(f"modality.holder invalid: {m.get('holder')}")
        if m.get("attitude") not in ATTITUDES: e.append(f"modality.attitude invalid: {m.get('attitude')}")
    t = lf.get("temporal") or {}
    if t.get("type") not in TEMPORAL_TYPES: e.append(f"temporal.type invalid: {t.get('type')}")
    if lf.get("status") not in STATUSES: e.append(f"status invalid: {lf.get('status')}")
    fc = lf.get("formalization_confidence")
    if not isinstance(fc,(int,float)) or not (0 <= fc <= 1): e.append(f"formalization_confidence invalid: {fc}")
    return e


def _argset(lf):
    # (role, participant) pairs; participant normalized (lit: lowercased text, ent ids as-is)
    out = set()
    for a in lf.get("args") or []:
        ref = str(a.get("ref",""))
        out.add((a.get("role"), ref.lower() if ref.startswith("lit:") else ref))
    return out

def _f1(ref, cand):
    if not ref and not cand: return 1.0
    if not ref or not cand: return 0.0
    tp = len(ref & cand)
    p = tp/len(cand); r = tp/len(ref)
    return 0.0 if (p+r)==0 else 2*p*r/(p+r)


def score(ref, cand):
    """Per-component [0,1] scores of candidate vs reference logical_form."""
    s = {}
    s["predicate"] = 1.0 if (cand.get("predicate","").lower() == ref.get("predicate","").lower()) else 0.0
    s["args"] = _f1(_argset(ref), _argset(cand))
    s["polarity"] = 1.0 if cand.get("polarity") == ref.get("polarity") else 0.0
    rm, cm = ref.get("modality"), cand.get("modality")
    if rm is None or cm is None:
        s["modality"] = 1.0 if (rm is None and cm is None) else 0.0
    else:
        s["modality"] = 1.0 if (rm.get("holder")==cm.get("holder") and rm.get("attitude")==cm.get("attitude")) else 0.0
    rt, ct = ref.get("temporal") or {}, cand.get("temporal") or {}
    s["temporal"] = 1.0 if (rt.get("type")==ct.get("type") and str(rt.get("value"))==str(ct.get("value"))) else 0.0
    rab = {(a.get("ref"), a.get("match_level")) for a in (ref.get("about") or [])}
    cab = {(a.get("ref"), a.get("match_level")) for a in (cand.get("about") or [])}
    s["about"] = _f1(rab, cab)
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--golden", default=os.path.join(HERE, "golden_set.json"))
    ap.add_argument("--candidates", help="id -> logical_form map (the pass output); omit for --self")
    ap.add_argument("--self", action="store_true", help="validate the golden references are schema-valid")
    args = ap.parse_args()
    rows = json.load(open(args.golden, encoding="utf-8"))["rows"]

    if args.self or not args.candidates:
        bad = 0
        for r in rows:
            errs = schema_errors(r["reference"])
            tag = "ok" if not errs else "INVALID"
            if errs: bad += 1
            print(f"  [{r['id']:6}] {r['provenance']:11} ref schema: {tag}" + (f"  {errs}" if errs else ""))
        print(f"\ngolden references: {len(rows)} rows, {bad} schema-invalid")
        sys.exit(1 if bad else 0)

    cand = json.load(open(args.candidates, encoding="utf-8"))
    comps = ["predicate","args","polarity","modality","temporal","about"]
    tot = {c: [] for c in comps}; overall = []
    for r in rows:
        c = cand.get(r["id"])
        if c is None:
            print(f"  [{r['id']}] NO CANDIDATE"); continue
        sc = score(r["reference"], c)
        for k in comps: tot[k].append(sc[k])
        row_acc = sum(sc.values())/len(sc); overall.append(row_acc)
        print(f"  [{r['id']:6}] acc={row_acc:.2f}  " + " ".join(f"{k}={sc[k]:.2f}" for k in comps))
    print("\n=== formalization_accuracy (per component, mean over scored rows) ===")
    for k in comps:
        print(f"  {k:10}: {sum(tot[k])/len(tot[k]):.3f}" if tot[k] else f"  {k}: n/a")
    print(f"  OVERALL   : {sum(overall)/len(overall):.3f}" if overall else "  OVERALL: n/a")


if __name__ == "__main__":
    main()
