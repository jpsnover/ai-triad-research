#!/usr/bin/env python3
"""t/3234 concept-harvest — STAGE 1: LLM-extract candidate CONCEPTS (universals/topics only — no entity
harvest, per t/3233) from ALL conflicts + situations, then apply the mandatory curation gate's cheap
layers: lexical novelty vs the dictionary, drop-generic, and frequency aggregation. Emits candidates.json
(ranked). Stage 2 does embedding near-variant dedup + the PI worksheet. PROPOSE ONLY — no data writes.
"""
import json, os, re, sys, time, glob
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
sys.stdout.reconfigure(encoding="utf-8")
D = r"C:\Users\jsnov\repos\ai-triad-data"
OUT = os.path.join(os.path.dirname(__file__), "harvest_candidates.json")

# ---- existing taxonomy (for novelty) ----
cf_all, phrases = set(), []
for f in glob.glob(D + r"\dictionary\standardized\*.json"):
    d = json.load(open(f, encoding="utf-8"))
    cf_all.add(d["canonical_form"].lower())
    for p in ((d.get("characteristic_phrases") or []) + (d.get("translates_from_colloquial") or [])):
        phrases.append(p.lower())


def con_known(name):
    n = name.lower().strip()
    return n in cf_all or n.replace(" ", "_") in cf_all or any(n == p or n in p or p in n for p in phrases)


# ---- drop-generic gate (t/3234: 'AI systems', 'AI models', 'AI impact' noise) ----
GENERIC = {"ai", "ai systems", "ai models", "ai model", "ai system", "ai impact", "ai technology",
           "artificial intelligence", "technology", "systems", "models", "policy", "regulation",
           "governance", "risk", "risks", "safety", "ethics", "society", "innovation", "data",
           "algorithms", "machine learning", "automation", "development", "deployment", "impact"}


def is_generic(name):
    n = name.lower().strip()
    if len(n) < 4 or n in GENERIC:
        return True
    words = n.split()
    if len(words) == 1 and n in GENERIC:
        return True
    # single bare head noun like "bias"/"harm" with no qualifier is usually too broad
    if len(words) == 1 and len(n) < 7:
        return True
    return False


# ---- records ----
conf = json.load(open(D + r"\conflicts\conflicts.json", encoding="utf-8"))["conflicts"]
sit = json.load(open(D + r"\taxonomy\Origin\situations.json", encoding="utf-8"))["nodes"]


def conf_text(c):
    ins = " | ".join((i.get("assertion") or "") for i in (c.get("instances") or [])[:4])
    return f"{c.get('claim_label','')}. {c.get('description','')}. Positions: {ins}"[:2000]


def sit_text(s):
    parts = [s.get("label", ""), s.get("description", "")]
    for v in (s.get("interpretations") or {}).values():
        if isinstance(v, dict):
            parts += [str(v.get(k, "")) for k in ("belief", "desire", "intention")]
    return " ".join(parts)[:2000]


def rec_id(kind, r):
    return (r.get("claim_id") or r.get("id") or r.get("claim_label") or "?") if kind == "conflict" else (r.get("id") or r.get("label") or "?")


records = [("conflict", rec_id("conflict", c), conf_text(c)) for c in conf] \
        + [("situation", rec_id("situation", s), sit_text(s)) for s in sit]

PROMPT = """Extract the CONCEPTS at stake in this AI-policy {kind} record.
Concepts = UNIVERSALS / topical kinds — abstract ideas, mechanisms, or policy concepts (e.g.
"instrumental convergence", "regulatory capture", "algorithmic bias", "compute governance").
NOT named particulars (people, orgs, laws, named systems). NOT generic umbrella words ("AI", "technology",
"risk", "policy"). Prefer specific multi-word concepts. Only concepts genuinely present in the text.
Return ONLY JSON: {{"concepts": ["..."]}}

RECORD:
{text}"""


def main():
    dry = "--dry-run" in sys.argv
    cap = 0
    for a in sys.argv:
        if a.startswith("--cap="):
            cap = int(a.split("=")[1])
    recs = records[:cap] if cap else records
    print(f"[corpus] {len(conf)} conflicts + {len(sit)} situations = {len(records)} records; running {len(recs)}")
    if dry:
        print(PROMPT.format(kind=recs[0][0], text=recs[0][2])[:1000]); return 0

    import google.generativeai as genai
    genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))
    model = genai.GenerativeModel("gemini-3.5-flash-lite",
                                  generation_config={"temperature": 0.2, "response_mime_type": "application/json"})

    def extract(rec):
        kind, rid, text = rec
        if not text.strip():
            return (rid, [])
        for a in range(3):
            try:
                r = model.generate_content(PROMPT.format(kind=kind, text=text))
                t = (r.text or "").strip(); s, e = t.find("{"), t.rfind("}")
                o = json.loads(t[s:e + 1])
                return (rid, [x.strip() for x in o.get("concepts", []) if isinstance(x, str) and x.strip()])
            except Exception:
                time.sleep(0.8 * (a + 1))
        return (rid, [])

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(extract, recs))

    # aggregate distinct concept (lowercased) -> freq + source rec ids + a display surface
    freq = Counter()
    sources = defaultdict(list)
    surface = {}
    raw_total = 0
    for rid, concepts in results:
        for c in concepts:
            raw_total += 1
            key = c.lower().strip()
            freq[key] += 1
            if len(sources[key]) < 6:
                sources[key].append(rid)
            surface.setdefault(key, c)

    distinct = len(freq)
    # gate: novelty + drop-generic
    novel_generic_dropped = [k for k in freq if not con_known(k) and is_generic(k)]
    known_dropped = [k for k in freq if con_known(k)]
    candidates = [k for k in freq if not con_known(k) and not is_generic(k)]
    candidates.sort(key=lambda k: (-freq[k], k))

    out = {"ticket": "t/3234", "stage": 1,
           "corpus": {"conflicts": len(conf), "situations": len(sit), "records_run": len(recs)},
           "raw_extracted": raw_total, "distinct": distinct,
           "dropped_known_vs_dictionary": len(known_dropped),
           "dropped_generic": len(novel_generic_dropped),
           "candidates_count": len(candidates),
           "candidates": [{"surface": surface[k], "key": k, "freq": freq[k], "sources": sources[k]} for k in candidates]}
    json.dump(out, open(OUT, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"raw={raw_total} distinct={distinct} | dropped known={len(known_dropped)} generic={len(novel_generic_dropped)} "
          f"| CANDIDATES={len(candidates)} -> {OUT}")
    print("top 30 candidates (surface x freq):")
    for k in candidates[:30]:
        print(f"  {freq[k]:>3}  {surface[k]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
