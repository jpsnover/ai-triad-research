#!/usr/bin/env python3
"""t/3390 re-measure — does a precision-first about/topical prompt clear the locked 0.80 floor
(which would reopen Option A, per e/145)? Runs the production prompt (v1 control) AND the v2
variant over the SAME 61 frozen t/3381 nodes, scores each generator's topical selection
(about[] ∪ topical_candidates.refs) against the blind REFERENCE_ABOUT with the identical
ref-level per-row F1 over concept-anchored rows. Same-run A/B isolates the prompt effect from
re-run/model variance. Needs GEMINI_API_KEY."""
import json, os, re, sys, importlib.util, statistics
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = r"C:\Users\jsnov\repos\ai-triad-research"
T3381 = os.path.join(REPO, "research", "comp-linguist", "analyses", "t3381-about-golden")
V1_PROMPT = os.path.join(REPO, "scripts", "AITriad", "Prompts", "logical-form-formalization.prompt")
V2_PROMPT = os.path.join(HERE, "logical-form-formalization.v2.prompt")
FLOOR = 0.80

# import the generator to reuse load_nodes/build_prompt/parse_lf/validate (identity-preserving)
spec = importlib.util.spec_from_file_location(
    "flf", os.path.join(REPO, "research", "comp-linguist", "tools", "formalize_node_lf.py"))
flf = importlib.util.module_from_spec(spec); spec.loader.exec_module(flf)

def f1(ref, cand):
    if not ref and not cand: return 1.0
    if not ref or not cand: return 0.0
    tp = len(ref & cand); p = tp/len(cand); r = tp/len(ref)
    return 0.0 if (p+r)==0 else 2*p*r/(p+r)

def parse_reference(path):
    out, cur = {}, None
    hdr = re.compile(r"^##\s+\[\d+\]\s+(\S+)")
    for ln in open(path, encoding="utf-8"):
        m = hdr.match(ln)
        if m: cur = m.group(1); continue
        if cur and ln.startswith("**REFERENCE_ABOUT:**"):
            body = ln.split("**REFERENCE_ABOUT:**", 1)[1].strip()
            out[cur] = set() if body.lower() in ("", "none") else {t.strip() for t in body.split(",") if t.strip()}
            cur = None
    return out

man = json.load(open(os.path.join(T3381, "sample-manifest.json"), encoding="utf-8"))
prof = {e["id"]: e["profile"] for e in man["ids"]}
ids = [e["id"] for e in man["ids"]]
gold = parse_reference(os.path.join(T3381, "about-golden-worksheet.md"))

# node objects for the 61 sample ids
all_nodes = {n["id"]: (fn, data, n) for fn, data, n in flf.load_nodes()}
missing = [i for i in ids if i not in all_nodes]
if missing: print(f"WARN {len(missing)} sample ids not found as grounded nodes: {missing[:5]}...")
sample = [all_nodes[i] for i in ids if i in all_nodes]

import google.generativeai as genai
genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))
model = genai.GenerativeModel("gemini-3.5-flash-lite",
                              generation_config={"temperature": 0.2, "response_mime_type": "application/json"})

def topical_refs(lf):
    """all refs the generator marked topical, version-agnostic (about[] +/or topical_candidates)."""
    out = set()
    for a in (lf.get("about") or []): out.add(a.get("ref"))
    tc = lf.get("topical_candidates")
    if isinstance(tc, dict):
        for a in (tc.get("refs") or []): out.add(a.get("ref"))
    return out - {None}

def run_variant(tmpl):
    def one(item):
        fn, data, n = item
        prompt, allowed, camp, cat = flf.build_prompt(tmpl, n)
        import time
        for a in range(3):
            try:
                r = model.generate_content(prompt)
                lf = flf.validate(flf.parse_lf(r.text or ""), allowed, camp, cat)
                if lf and lf.get("predicate"):
                    return (n["id"], topical_refs(lf))
            except Exception as ex:
                sys.stderr.write(f"  [warn] {n['id']} a{a}: {type(ex).__name__}\n")
            time.sleep(0.8 * (a + 1))
        return (n["id"], set())
    with ThreadPoolExecutor(max_workers=6) as ex:
        return dict(ex.map(one, sample))

def score(pred_by_id, label):
    rows = []
    for nid in ids:
        if nid not in gold: continue
        g = gold[nid]; p = pred_by_id.get(nid, set())
        tp = len(g & p)
        rows.append({"id": nid, "profile": prof[nid], "f1": f1(g, p),
                     "tp": tp, "fp": sorted(p - g), "fn": sorted(g - p),
                     "prec": tp/len(p) if p else (1.0 if not g else 0.0),
                     "rec": tp/len(g) if g else (1.0 if not p else 0.0)})
    ca = [r for r in rows if r["profile"] in ("concept-only", "mixed")]
    floor_val = statistics.mean(r["f1"] for r in ca)
    tp = sum(r["tp"] for r in ca); fp = sum(len(r["fp"]) for r in ca); fn = sum(len(r["fn"]) for r in ca)
    P = tp/(tp+fp) if tp+fp else float("nan"); R = tp/(tp+fn) if tp+fn else float("nan")
    print(f"\n=== {label} — concept-anchored (n={len(ca)}) ===")
    print(f"  mean per-row about-F1 = {floor_val:.4f}   floor {FLOOR} -> {'PASS (reopens A)' if floor_val>=FLOOR else 'FAIL (C stands)'}")
    print(f"  micro P={P:.4f} R={R:.4f}  (TP={tp} FP={fp} FN={fn})")
    return floor_val, rows

if __name__ == "__main__":
    print(f"nodes: {len(sample)}/{len(ids)}")
    v1 = run_variant(open(V1_PROMPT, encoding="utf-8").read())
    v1f, v1rows = score(v1, "v1 (production prompt, control)")
    v2 = run_variant(open(V2_PROMPT, encoding="utf-8").read())
    v2f, v2rows = score(v2, "v2 (precision-first variant)")
    print(f"\nDELTA v2-v1 = {v2f - v1f:+.4f}")
    json.dump({"floor": FLOOR, "v1_concept_anchored_f1": v1f, "v2_concept_anchored_f1": v2f,
               "verdict_v2": "reopens A" if v2f >= FLOOR else "C stands",
               "v1_rows": v1rows, "v2_rows": v2rows},
              open(os.path.join(HERE, "remeasure-results.json"), "w", encoding="utf-8"), indent=1)
    print("\nwrote remeasure-results.json")
