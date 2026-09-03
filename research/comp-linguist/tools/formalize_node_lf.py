#!/usr/bin/env python3
"""G6 (t/3162): populate `node.logical_form` on grounded BDI nodes — node-level application of the
t/3215 claim formalization. A BDI node maps 1:1 onto the claim-formalization inputs:
  CLAIM_CATEGORY = node.category (Beliefs|Desires|Intentions)   ATTRIBUTING CAMP = id prefix (acc|saf|skp)
  PROPOSITION    = label + description                          RESOLVED ENTITIES = node entity_refs + concept_refs
entity_refs are particulars (sort = register dolce_category); concept_refs are universals/kinds
(sort = non-agentive-social-object — the DOLCE-lite abstract sort). Grounds args ONLY from the node's
own refs (one-identity §7.4: sort/match_level copied from the register/ref, never the model's guess).
Ports the shipped prompt at runtime so it stays in sync. --apply writes node.logical_form; default dry.
PI-directed populate (t/3162 (B)); gated post-hoc by TL data-model review + a node golden set.
"""
import argparse, json, os, re, sys, time
sys.stdout.reconfigure(encoding="utf-8")
REPO = r"C:\Users\jsnov\repos\ai-triad-research"
D = r"C:\Users\jsnov\repos\ai-triad-data"
O = os.path.join(D, "taxonomy", "Origin")
PROMPT_PATH = os.path.join(REPO, "scripts", "AITriad", "Prompts", "logical-form-formalization.prompt")
POV = {"acc": "acc", "saf": "saf", "skp": "skp"}
CAT_ATT = {"Beliefs": "belief", "Desires": "desire", "Intentions": "intention"}

ents = json.load(open(os.path.join(O, "entities.json"), encoding="utf-8"))["entities"]
reg = {e["id"]: {"sort": e.get("dolce_category", "non-agentive-social-object"), "name": e.get("name", "")} for e in ents}

def load_nodes():
    out = []
    for fn in ("accelerationist.json", "safetyist.json", "skeptic.json"):
        p = os.path.join(O, fn)
        data = json.load(open(p, encoding="utf-8"))
        for n in data["nodes"]:
            if n.get("concept_refs") or n.get("entity_refs"):
                out.append((fn, data, n))
    return out

def refs_block(n):
    lines, allowed = [], {}
    for r in (n.get("entity_refs") or []):
        eid = r["ref"]; sort = reg.get(eid, {}).get("sort", "non-agentive-social-object")
        ml = r.get("match_level", "exact"); nm = reg.get(eid, {}).get("name", r.get("surface", ""))
        lines.append(f"- {eid} ({nm}) sort={sort} match_level={ml}")
        allowed[eid] = (sort, ml)
    for r in (n.get("concept_refs") or []):
        cid = r["ref"]  # term:cf — a concept is a UNIVERSAL (kind), the 6th arg-slot sort (t/3251),
        lines.append(f"- {cid} ({r.get('surface','')}) sort=universal match_level=exact")
        allowed[cid] = ("universal", "exact")  # distinct from the 5 particular DolceCategory sorts
    return ("\n".join(lines) if lines else "(none)"), allowed

def build_prompt(tmpl, n):
    cat = n.get("category", "Beliefs")
    camp = n["id"].split("-")[0]
    prop = (n.get("label", "") + ". " + (n.get("description") or n.get("plain_description") or "")).strip()
    block, allowed = refs_block(n)
    p = (tmpl.replace("{{CLAIM_CATEGORY}}", cat).replace("{{CAMP}}", POV.get(camp, camp))
             .replace("{{PROPOSITION}}", prop[:2400]).replace("{{ENTITY_REFS}}", block))
    return p, allowed, camp, cat

def parse_lf(text):
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1].lstrip("json").strip("` \n") if "```" in t[3:] else t
    s, e = t.find("{"), t.rfind("}")
    try: return json.loads(t[s:e+1])
    except Exception: return None

PARTICULAR_SORTS = frozenset({"agentive-physical-object", "non-agentive-functional-artifact",
                              "perdurant", "normative-description", "non-agentive-social-object"})


def _repair_bare(ref, allowed):
    """A bare cf-name that IS a node concept -> its `term:` id (t/3239: LLM dropped the prefix)."""
    if isinstance(ref, str) and ref and not ref.startswith(("ent-", "term:", "lit:")) \
       and not re.fullmatch(r"e\d+", ref):
        cand = "term:" + ref
        if cand in allowed:
            return cand
    return ref


def validate(lf, allowed, camp, cat):
    """One-identity §7.4: grounded refs (ent-/term:) copy sort/match_level authoritatively from
    `allowed`; a bare cf-name matching a node concept is repaired to its term: id (t/3239); lit:/event
    args keep a VALID particular sort + non-empty match_level (t/3239#6 hardening); hallucinated
    grounded ids are dropped. Concept sorts are `universal` (via `allowed`, t/3251). Mechanical modality."""
    if not isinstance(lf, dict): return None

    def fix(a):
        ref = _repair_bare(a.get("ref", ""), allowed)
        a["ref"] = ref
        if isinstance(ref, str) and (ref.startswith("ent-") or ref.startswith("term:")):
            if ref not in allowed:
                return None  # hallucinated grounded id -> drop (never mint)
            a["sort"], a["match_level"] = allowed[ref]
            return a
        # lit: / event / unresolved: a particular; force a valid sort + non-empty match_level
        if a.get("sort") not in PARTICULAR_SORTS:
            a["sort"] = "non-agentive-social-object"  # clamp off-enum to the abstract-particular default
        if not a.get("match_level"):
            a["match_level"] = "exact"
        return a

    lf["args"] = [x for x in (fix(a) for a in (lf.get("args") or [])) if x]
    kept_about = []
    for ab in (lf.get("about") or []):
        if not isinstance(ab, dict):
            continue
        ab["ref"] = _repair_bare(ab.get("ref", ""), allowed)
        if ab.get("ref") in allowed:
            if not ab.get("match_level"):
                ab["match_level"] = "exact"
            kept_about.append(ab)
    lf["about"] = kept_about
    lf["modality"] = {"holder": f"camp:{POV.get(camp, camp)}", "attitude": CAT_ATT.get(cat, "belief")}
    lf.setdefault("status", "proposed")
    return lf

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap", type=int, default=0, help="max nodes (0=all grounded)")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "node_lf_sample.json"))
    args = ap.parse_args()
    tmpl = open(PROMPT_PATH, encoding="utf-8").read()
    nodes = load_nodes()
    if args.cap: nodes = nodes[:args.cap]
    print(f"grounded nodes to formalize: {len(nodes)}")

    import google.generativeai as genai
    genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))
    model = genai.GenerativeModel("gemini-3.5-flash-lite", generation_config={"temperature": 0.2, "response_mime_type": "application/json"})
    from concurrent.futures import ThreadPoolExecutor

    def formalize(item):
        fn, data, n = item
        prompt, allowed, camp, cat = build_prompt(tmpl, n)
        for a in range(3):
            try:
                r = model.generate_content(prompt)
                lf = validate(parse_lf(r.text or ""), allowed, camp, cat)
                if lf and lf.get("predicate"):
                    return (n["id"], lf)
            except Exception as ex:
                sys.stderr.write(f"  [warn] {n['id']} a{a}: {type(ex).__name__}\n")
            time.sleep(0.8 * (a + 1))
        return (n["id"], None)

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        results = dict(ex.map(formalize, nodes))
    ok = {k: v for k, v in results.items() if v}
    print(f"formalized: {len(ok)}/{len(nodes)}  (failed: {len(nodes)-len(ok)})")
    # sample for eyeball
    sample = {k: results[k] for k in list(ok)[:6]}
    json.dump({"count": len(ok), "sample": sample}, open(args.out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    for k in list(ok)[:4]:
        print(f"\n{k}: pred={ok[k].get('predicate')!r} args={[(a.get('role'),a.get('ref'),a.get('sort')) for a in ok[k].get('args',[])]} conf={ok[k].get('formalization_confidence')} status={ok[k].get('status')}")

    if args.apply:
        byfile = {}
        for fn, data, n in nodes:
            byfile.setdefault(fn, data)
        # attach to node objects (data is shared per file object)
        idmap = {n["id"]: n for _, _, n in nodes}
        applied = 0
        for nid, lf in ok.items():
            idmap[nid]["logical_form"] = lf; applied += 1
        for fn, data in byfile.items():
            with open(os.path.join(O, fn), "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False); f.write("\n")
        print(f"\nAPPLIED node.logical_form to {applied} nodes across {len(byfile)} files")
    else:
        print("\nDRY RUN (use --apply to write node.logical_form)")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
