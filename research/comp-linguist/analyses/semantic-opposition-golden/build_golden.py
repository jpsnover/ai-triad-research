#!/usr/bin/env python3
"""t/3302 Fork-B — build the semantic-opposition validation golden (single reproducible entrypoint).

Deterministically samples within-conflict instance PAIRS from conflicts.json, applies the CL's BLIND
verdicts (contradict/entail/neutral, authored from assertion texts alone BEFORE any classifier output),
adds author-CONSTRUCTED numeric/temporal detector-validation cases, and emits a tune/held-out split.

Split protocol (TL t/3302#7):
- threshold derived on TUNE = REP-tune ∪ ENR-tune
- PRECISION reported on REP held_out ONLY (preserves the true ~6% contradiction base rate)
- RECALL reported on ALL held_out contradicts (base-rate-insensitive; ENR augments positives)
Pools: REP (representative + hard-negative precision traps) · ENR (candidate-enriched positives,
cross-stance/vs pairs — recall only) · CONSTRUCTED (numeric/temporal detector-validation, excluded
from all observed metrics). No RNG — sorted ids + even stride, so the golden is stable + re-runnable.

Usage: python build_golden.py [--out semantic-opposition-golden.json]
"""
import argparse, json, os, re, sys
from collections import Counter
sys.stdout.reconfigure(encoding="utf-8")

DATA_ROOT = os.environ.get("AI_TRIAD_DATA_ROOT") or os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "ai-triad-data")
CONFLICTS = os.path.join(DATA_ROOT, "conflicts", "conflicts.json")

PCT_RE = re.compile(r"\d+(?:\.\d+)?\s?%|\bpercent\b", re.I)
MAG_RE = re.compile(r"\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\s?(?:billion|million|trillion|x|times|fold)\b", re.I)
NUM_RE = re.compile(r"\b\d+(?:\.\d+)?\b")
YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b|\b(?:by|before|after|within|since)\s+\d+\s+(?:year|month|day)s?\b", re.I)
has_num = lambda t: bool(PCT_RE.search(t) or MAG_RE.search(t) or NUM_RE.search(t))
has_year = lambda t: bool(YEAR_RE.search(t))


def stratum(a, b):
    if has_year(a) and has_year(b):
        return "temporal"
    if has_num(a) and has_num(b):
        return "numeric"
    return "general"


# ---- CL BLIND verdicts (authored from assertion texts only; see README provenance) ----
REP_LABELS = {
 "P001":"contradict","P002":"neutral","P003":"entail","P004":"entail","P005":"entail","P006":"entail",
 "P007":"entail","P008":"entail","P009":"entail","P010":"entail","P011":"neutral","P012":"entail",
 "P013":"entail","P014":"entail","P015":"entail","P016":"entail","P017":"neutral","P018":"entail",
 "P019":"entail","P020":"neutral","P021":"entail","P022":"entail","P023":"entail","P024":"entail",
 "P025":"entail","P026":"entail","P027":"entail","P028":"neutral","P029":"entail","P030":"entail",
 "P031":"entail","P032":"entail","P033":"entail","P034":"neutral","P035":"entail","P036":"neutral",
 "P037":"entail","P038":"contradict","P039":"entail","P040":"entail","P041":"entail","P042":"neutral",
 "P043":"neutral","P044":"entail","P045":"entail","P046":"neutral","P047":"neutral","P048":"entail",
 "P049":"entail","P050":"neutral","P051":"neutral","P052":"neutral","P053":"entail","P054":"neutral",
 "P055":"neutral","P056":"neutral","P057":"entail","P058":"neutral","P059":"entail","P060":"contradict",
 "P061":"entail","P062":"neutral","P063":"contradict","P064":"neutral","P065":"entail","P066":"entail",
 "P067":"entail","P068":"neutral","P069":"contradict","P070":"entail","P071":"neutral","P072":"neutral",
 "P073":"neutral","P074":"entail","P075":"entail","P076":"neutral","P077":"entail","P078":"entail",
 "P079":"entail","P080":"entail",
}
REP_TRAPS = {"P002","P011","P017","P020","P028","P034","P042","P068"}
ENR_LABELS = {
 "E001":"neutral","E002":"neutral","E003":"neutral","E004":"contradict","E005":"contradict",
 "E006":"contradict","E007":"contradict","E008":"neutral","E009":"entail","E010":"contradict",
 "E011":"contradict","E012":"entail","E013":"contradict","E014":"entail","E015":"contradict",
 "E016":"contradict","E017":"contradict","E018":"contradict","E019":"entail","E020":"contradict",
 "E021":"contradict","E022":"contradict","E023":"entail","E024":"contradict","E025":"contradict",
 "E026":"entail","E027":"entail","E028":"entail","E029":"entail","E030":"contradict",
 "E031":"entail","E032":"contradict","E033":"contradict",
}
CONSTRUCTED = [
 ("C1","numeric","contradict","Recent-graduate unemployment was 12% in 2027.","Recent-graduate unemployment was 4% in 2027."),
 ("C2","numeric","contradict","The model was trained on 2 trillion tokens.","The model was trained on 500 billion tokens."),
 ("C3","temporal","contradict","The EU AI Act entered into force in 2024.","The EU AI Act entered into force in 2026."),
 ("C4","numeric","contradict","AI adoption among firms reached 55% in 2025.","AI adoption among firms was 30% in 2025."),
 ("C5","temporal","contradict","The executive order was signed on March 3, 2025.","The executive order was signed on August 3, 2025."),
 ("C6","numeric","contradict","A frontier training run cost about $100 million.","A frontier training run cost about $10 million."),
 ("C7","numeric","neutral","US private AI investment was $109 billion in 2024.","Global private AI investment was $150 billion in 2024."),
 ("C8","numeric","neutral","The model scored 71% on SWE-bench.","The model scored 90% on GSM8K."),
 ("C9","numeric","neutral","About 70% of workers are AI-exposed.","About 70% of ChatGPT messages are non-work-related."),
]


def load_conflicts():
    d = json.load(open(CONFLICTS, encoding="utf-8"))
    c = d if isinstance(d, list) else d.get("conflicts", d.get("data", []))
    return list(c.values()) if isinstance(c, dict) else c


def real_insts(c):
    return [it for it in (c.get("instances") or [])
            if (it.get("assertion") or "").strip() and "placeholder" not in (it.get("assertion") or "").lower()]


def sample_representative(conflicts, target=80, cap=3):
    all_pairs = []
    for c in sorted(conflicts, key=lambda x: str(x.get("claim_id") or x.get("claim_label") or "")):
        insts = real_insts(c)
        if len(insts) < 2:
            continue
        cid = c.get("claim_id") or c.get("claim_label") or "?"
        clabel = (c.get("claim_label") or c.get("title") or "")[:120]
        for i in range(len(insts)):
            for j in range(i + 1, len(insts)):
                a, b = insts[i]["assertion"].strip(), insts[j]["assertion"].strip()
                if a != b:
                    all_pairs.append({"conflict_id": cid, "claim_label": clabel, "i": i, "j": j,
                                      "assertion_a": a, "assertion_b": b, "stratum": stratum(a, b)})
    by = {"numeric": [], "temporal": [], "general": []}
    for p in all_pairs:
        by[p["stratum"]].append(p)

    def take(bucket, k):
        seen, capped = {}, []
        for p in sorted(bucket, key=lambda p: (str(p["conflict_id"]), p["i"], p["j"])):
            if seen.get(p["conflict_id"], 0) < cap:
                capped.append(p); seen[p["conflict_id"]] = seen.get(p["conflict_id"], 0) + 1
        if len(capped) <= k:
            return capped
        stride = len(capped) / k
        return [capped[int(x * stride)] for x in range(k)]

    picked = take(by["numeric"], 30) + take(by["temporal"], 12) + take(by["general"], target - 42)
    for n, p in enumerate(picked, 1):
        p["pair_id"] = f"P{n:03d}"
    return picked


def sample_enrichment(conflicts, used, target=40, cap=3):
    cands = []
    for c in sorted(conflicts, key=lambda x: str(x.get("claim_id") or x.get("claim_label") or "")):
        insts = real_insts(c)
        if len(insts) < 2:
            continue
        cid = c.get("claim_id") or c.get("claim_label") or "?"
        clabel = (c.get("claim_label") or c.get("title") or "")[:120]
        is_vs = bool(re.search(r"\bvs\.?\b", clabel, re.I))
        sup = [it for it in insts if it.get("stance") == "supports"]
        dis = [it for it in insts if it.get("stance") == "disputes"]
        pairs = [(a, b) for a in sup for b in dis]
        pairs += [(dis[i], dis[j]) for i in range(len(dis)) for j in range(i + 1, len(dis))]
        if is_vs and not pairs:
            pairs = [(insts[i], insts[j]) for i in range(len(insts)) for j in range(i + 1, len(insts))]
        n = 0
        for a, b in pairs:
            ta, tb = a["assertion"].strip(), b["assertion"].strip()
            if ta == tb or (str(cid), ta, tb) in used or (str(cid), tb, ta) in used:
                continue
            n += 1
            if n > cap:
                break
            src = "cross-stance" if (a in sup) != (b in sup) and (a in dis or b in dis) else ("dispute-pair" if a in dis and b in dis else "vs-title")
            cands.append({"conflict_id": cid, "claim_label": clabel, "assertion_a": ta, "assertion_b": tb, "src": src})
    cands = sorted(cands, key=lambda p: (str(p["conflict_id"]), p["assertion_a"]))
    if len(cands) > target:
        stride = len(cands) / target
        cands = [cands[int(x * stride)] for x in range(target)]
    for n, p in enumerate(cands, 1):
        p["pair_id"] = f"E{n:03d}"
    return cands


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "semantic-opposition-golden.json"))
    args = ap.parse_args()
    conflicts = load_conflicts()

    rep = sample_representative(conflicts)
    for p in rep:
        p.update(label=REP_LABELS[p["pair_id"]], pool="REP", provenance="observed",
                 precision_trap=p["pair_id"] in REP_TRAPS)
    used = {(str(p["conflict_id"]), p["assertion_a"], p["assertion_b"]) for p in rep}
    enr = sample_enrichment(conflicts, used)
    for p in enr:
        p.update(label=ENR_LABELS[p["pair_id"]], pool="ENR", provenance="observed",
                 stratum="enriched", precision_trap=False)

    allp = rep + enr
    buckets = {}
    for p in allp:
        buckets.setdefault((p["pool"], p["label"], p["stratum"]), []).append(p)
    for key in sorted(buckets):
        for i, p in enumerate(sorted(buckets[key], key=lambda x: x["pair_id"])):
            p["split"] = "tune" if i % 2 == 0 else "held_out"

    constructed = [{"pair_id": pid, "stratum": st, "label": lab, "assertion_a": a, "assertion_b": b,
                    "pool": "CONSTRUCTED", "provenance": "constructed", "split": "validation",
                    "precision_trap": lab == "neutral", "conflict_id": "(constructed)",
                    "claim_label": "(constructed detector-validation)"}
                   for pid, st, lab, a, b in CONSTRUCTED]

    golden = {"_meta": {
        "ticket": "t/3302", "purpose": "Fork-B semantic-opposition validation gate",
        "labeling": "CL blind (assertion texts only, before any classifier output)",
        "provenance": "human-validated (CL-authored blind); PI spot-confirm available",
        "split_protocol": "threshold on TUNE; precision on REP held_out (true base rate); recall on all held_out contradicts",
        "pools": {"REP": "representative (true base rate + hard-negative precision traps)",
                  "ENR": "candidate-enriched positives (cross-stance/vs) — recall only, not precision denominator",
                  "CONSTRUCTED": "author-constructed numeric/temporal detector-validation — excluded from observed metrics"},
    }, "pairs": allp + constructed}
    json.dump(golden, open(args.out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

    print(f"wrote {len(golden['pairs'])} pairs → {args.out}")
    print("observed labels:", dict(Counter(p["label"] for p in allp)))
    for sp in ("tune", "held_out"):
        c = Counter(p["label"] for p in allp if p["split"] == sp)
        print(f"  {sp:9} contradict={c['contradict']} entail={c['entail']} neutral={c['neutral']}")
    repheld = [p for p in rep if p["split"] == "held_out"]
    print(f"precision denom (REP held_out): n={len(repheld)} contradict={sum(1 for p in repheld if p['label']=='contradict')} traps={sum(1 for p in repheld if p['precision_trap'])}")


if __name__ == "__main__":
    raise SystemExit(main())
