#!/usr/bin/env python3
"""t/3468 situations-canonicalization — FROZEN map generator + 0-collateral dry-run.
Per TL rulings t/3468#10. Deterministic layer + content-grounded per-node re-derivations
(labelled constructed; TL second-agent verifies). Emits frozen_edits.json. NO corpus write.

Edit modes (match apply_batch_edits.ps1): replace | reinsert(object->scalar) | remove | upsert.
Here all targets are scalar strings, so 'replace' (value-set) or 'remove' (blank).
"""
import json, os
DR = "C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin"
OUT = "C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/analyses/t3468-situations-canon"
SIT = f"{DR}/situations.json"

CANON = {
 "epistemic_type": {'empirical_claim','strategic_recommendation','normative_prescription','interpretive_lens','predictive','definitional','causal_mechanism'},
 "node_scope": {'claim','scheme','bridging','narrow_technical','domain_specific','cross_domain','systemic'},
 "falsifiability": {'high','medium','low'},
 "rhetorical_strategy": {'structural_critique','appeal_to_evidence','precautionary_framing','moral_imperative','cost_benefit_analysis','techno_optimism','credibility_framing','analogical_reasoning','appeal_to_fear','inevitability_framing','appeal_to_authority','appeal_to_justice','appeal_to_sovereignty','rights_based','pragmatic_framing','systemic_critique','reductio_ad_absurdum'},  # +reductio (canonical-add t/3468#10)
 "audience": {'policymakers','technical_researchers','industry_leaders','academic_community','civil_society','general_public','labor_organizations','military_leaders','legal_professionals'},  # +military/legal (canonical-add)
 "emotional_register": {'cautionary','pragmatic','measured','urgent','alarmed','aspirational','optimistic','defiant','dismissive','assertive','resolute','analytical'},
}
CSV = {"rhetorical_strategy","audience","emotional_register"}

# Fixed token maps (deterministic, TL-ruled)
TOKEN_MAP = {
 "rhetorical_strategy": {"pragmatic":"pragmatic_framing"},  # case-folds handled generically; contaminants dropped
 "audience": {"academic":"academic_community"},
 "emotional_register": {"neutral":"measured","critical":"analytical"},
}
# Cross-field contaminant tokens to DROP from multi-value rhetorical_strategy (belong to other fields)
RHET_DROP = {"interpretive_lens","strategic_recommendation","predictive","definitional","aspirational","dismissive","categorization"}
# conceptual_reframing -> content-mapped
RHET_CONTENT = {"conceptual_reframing":"analogical_reasoning"}  # sit-447: AI-as-autopoietic-system analogy

# Class 5 — category nodes: blank (remove) inapplicable enums; keep node_scope (scheme is canonical/meaningful)
CATEGORY_NODES = {"sit-170","sit-171","sit-172","sit-173","sit-174"}
CATEGORY_BLANK = ["falsifiability","rhetorical_strategy","epistemic_type","audience","emotional_register"]

# Class 3 — single-value re-derive of MULTI-value epistemic_type (content-grounded; constructed)
EPI_REDERIVE = {
 "sit-002":"interpretive_lens","sit-003":"normative_prescription","sit-004":"interpretive_lens",
 "sit-005":"normative_prescription","sit-006":"normative_prescription","sit-008":"predictive",
 "sit-029":"normative_prescription","sit-032":"interpretive_lens","sit-061":"definitional",
 "sit-064":"normative_prescription",
}
# Class 2/3 — node_scope contaminant single re-derive. AMENDED per TL flag (p/349#313) + corpus
# convention: situations use only the ARGUMENTATION-role node_scopes {claim,scheme,bridging}
# (claim 180 / scheme 143 / bridging 5), NEVER the breadth scopes. All 6 were tagged
# interpretive_lens/definitional (framing/lens/concept roles) -> canonical role = scheme.
NS_REDERIVE = {
 "sit-117":"scheme","sit-118":"scheme","sit-201":"scheme",
 "sit-235":"scheme","sit-236":"scheme","sit-237":"scheme",
}

def casefold_tok(field, t):
    return t.lower() if t.lower() in CANON[field] else t

def transform_field(field, raw, nid):
    """Return (new_value_or_None_to_remove, note)."""
    if field in CSV:
        toks=[t.strip() for t in raw.split(",") if t.strip()]
        out=[]
        for t in toks:
            tl=t.lower()
            # fixed content map
            if field in RHET_CONTENT and False: pass
            if field=="rhetorical_strategy":
                if tl in RHET_DROP: continue
                if t in RHET_CONTENT: t=RHET_CONTENT[t]; tl=t.lower()
            m=TOKEN_MAP.get(field,{})
            if tl in m: t=m[tl]; tl=t.lower()
            elif tl in CANON[field]: t=tl
            elif t in m: t=m[t]; tl=t.lower()
            c=casefold_tok(field,t)
            if c not in out: out.append(c)
        return (", ".join(out) if out else None), "csv"
    else:
        # single-value enum
        if nid in EPI_REDERIVE and field=="epistemic_type": return EPI_REDERIVE[nid],"epi-rederive"
        if nid in NS_REDERIVE and field=="node_scope": return NS_REDERIVE[nid],"ns-rederive"
        tl=raw.lower()
        if tl in CANON[field]: return tl,"casefold"
        return raw,"unchanged?"  # shouldn't hit for known set

edits=[]
sits=json.load(open(SIT,encoding="utf-8"))["nodes"]
for n in sits:
    nid=n["id"]; ga=n.get("graph_attributes") or {}
    if nid in CATEGORY_NODES:
        for f in CATEGORY_BLANK:
            if f in ga:
                edits.append({"node_id":nid,"file":"situations.json","field":f,"mode":"remove",
                              "path":["graph_attributes",f],"before":ga[f],"class":"5-category-blank"})
        continue
    for f in ["epistemic_type","rhetorical_strategy","node_scope","falsifiability","audience","emotional_register"]:
        raw=ga.get(f)
        if not isinstance(raw,str) or not raw.strip(): continue
        newv,note=transform_field(f,raw,nid)
        if newv is None:
            edits.append({"node_id":nid,"file":"situations.json","field":f,"mode":"remove",
                          "path":["graph_attributes",f],"before":raw,"class":note}); continue
        if newv!=raw:
            edits.append({"node_id":nid,"file":"situations.json","field":f,"mode":"replace",
                          "path":["graph_attributes",f],"value":newv,"before":raw,"class":note})

os.makedirs(OUT,exist_ok=True)
frozen={"ticket":"t/3468","op":"canonicalize-situations-graph_attributes","count":len(edits),
        "rulings_ref":"t/3468#10","edits":sorted(edits,key=lambda e:(e["node_id"],e["field"]))}
json.dump(frozen,open(f"{OUT}/frozen_edits.json","w",encoding="utf-8"),indent=2)

# ---- 0-COLLATERAL DRY-RUN: apply in-memory, assert only target fields change ----
import copy
byid={n["id"]:n for n in sits}
after=copy.deepcopy(byid)
for e in edits:
    ga=after[e["node_id"]]["graph_attributes"]
    if e["mode"]=="remove": ga.pop(e["field"],None)
    else: ga[e["field"]]=e["value"]
# verify: every changed node differs ONLY in its edited fields; all else deep-equal
touched={}
for e in edits: touched.setdefault(e["node_id"],set()).add(e["field"])
bad=[]
for nid,bn in byid.items():
    an=after[nid]
    b2=json.loads(json.dumps(bn)); a2=json.loads(json.dumps(an))
    bga=b2.get("graph_attributes",{}); aga=a2.get("graph_attributes",{})
    for f in touched.get(nid,set()):
        bga.pop(f,None); aga.pop(f,None)
    if b2!=a2:
        diffs=[k for k in set(list(b2)+list(a2)) if b2.get(k)!=a2.get(k)]
        gd=[k for k in set(list(bga)+list(aga)) if bga.get(k)!=aga.get(k)]
        bad.append(f"{nid}: collateral top:{diffs} ga:{gd}")
# post-state canonical check
resid=[]
for nid,an in after.items():
    ga=an.get("graph_attributes") or {}
    for f,cset in CANON.items():
        v=ga.get(f)
        if not isinstance(v,str) or not v.strip(): continue
        toks=[t.strip() for t in v.split(",")] if f in CSV else [v.strip()]
        for t in toks:
            if t not in cset: resid.append(f"{nid}.{f}={t!r}")

nrep=sum(1 for e in edits if e["mode"]=="replace"); nrem=sum(1 for e in edits if e["mode"]=="remove")
nodes=len(touched)
byclass={}
for e in edits: byclass[e["class"]]=byclass.get(e["class"],0)+1
print(f"frozen {len(edits)} edits across {nodes} nodes: {nrep} replace, {nrem} remove")
print("by class:",byclass)
print("COLLATERAL:", "NONE ✓" if not bad else "ISSUE:\n  "+"\n  ".join(bad[:20]))
print("RESIDUAL non-canonical after map:", "NONE ✓ (fully conformed)" if not resid else f"{len(resid)}:\n  "+"\n  ".join(resid[:30]))
