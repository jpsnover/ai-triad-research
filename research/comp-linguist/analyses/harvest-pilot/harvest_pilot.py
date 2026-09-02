"""t/3233 Direction-A harvest pilot: LLM-extract candidate concepts (universals/topics) and
entities (named particulars) from a sample of conflicts + situations, then check novelty vs the
existing taxonomy (approved entity surfaces + dictionary concept phrases). Estimates the
*actionable novel-harvest yield* + lets a human spot-check quality. Read-only; writes a summary JSON.
"""
import json, os, re, random, sys, time, glob
sys.stdout.reconfigure(encoding="utf-8")
D = r"C:\Users\jsnov\repos\ai-triad-data"
SEED = 3233; random.seed(SEED)

ents = [e for e in json.load(open(D+r"\taxonomy\Origin\entities.json", encoding="utf-8"))["entities"] if e.get("status") == "approved"]
esurf = set()
for e in ents:
    for s in [e["name"]] + ((e.get("aliases") or []) if isinstance(e.get("aliases"), list) else []):
        if s: esurf.add(s.lower())
cf_all, phrases = set(), []
for f in glob.glob(D+r"\dictionary\standardized\*.json"):
    d = json.load(open(f, encoding="utf-8")); cf_all.add(d["canonical_form"].lower())
    for p in ((d.get("characteristic_phrases") or []) + (d.get("translates_from_colloquial") or [])):
        phrases.append(p.lower())
def ent_known(name):
    n = name.lower().strip()
    return n in esurf or any(re.search(r"\b"+re.escape(n)+r"\b", s) or re.search(r"\b"+re.escape(s)+r"\b", n) for s in esurf)
def con_known(name):
    n = name.lower().strip()
    return n in cf_all or n.replace(" ", "_") in cf_all or any(n == p or n in p or p in n for p in phrases)

conf = json.load(open(D+r"\conflicts\conflicts.json", encoding="utf-8"))["conflicts"]
sit = json.load(open(D+r"\taxonomy\Origin\situations.json", encoding="utf-8"))["nodes"]
conf_s = random.sample(conf, 14); sit_s = random.sample(sit, 8)

def conf_text(c):
    ins = " | ".join((i.get("assertion") or "") for i in (c.get("instances") or [])[:4])
    return f"{c.get('claim_label','')}. {c.get('description','')}. Positions: {ins}"[:2000]
def sit_text(s):
    parts = [s.get("label",""), s.get("description","")]
    for v in (s.get("interpretations") or {}).values():
        if isinstance(v, dict): parts += [str(v.get(k,"")) for k in ("belief","desire","intention")]
    return " ".join(parts)[:2000]

PROMPT = """Extract two lists from this AI-policy {kind} record.
- entities: NAMED PARTICULARS only — specific people, organizations, laws/regulations, named systems/models, documents, events (proper nouns). NOT generic categories.
- concepts: UNIVERSALS / topical kinds — the abstract ideas, mechanisms, or policy concepts at stake (e.g. "instrumental convergence", "regulatory capture", "algorithmic bias"). NOT named particulars.
Only include items genuinely present in the text. Return ONLY JSON: {{"entities": ["..."], "concepts": ["..."]}}

RECORD:
{text}"""

def main():
    dry = "--dry-run" in sys.argv
    items = [("conflict", conf_text(c)) for c in conf_s] + [("situation", sit_text(s)) for s in sit_s]
    print(f"[sample] {len(conf_s)} conflicts + {len(sit_s)} situations = {len(items)} records")
    if dry:
        print(PROMPT.format(kind=items[0][0], text=items[0][1])[:1200]); return 0
    import google.generativeai as genai
    genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))
    model = genai.GenerativeModel("gemini-3.5-flash-lite", generation_config={"temperature": 0.2, "response_mime_type": "application/json"})
    from concurrent.futures import ThreadPoolExecutor
    def extract(item):
        kind, text = item
        for a in range(3):
            try:
                r = model.generate_content(PROMPT.format(kind=kind, text=text))
                t = (r.text or "").strip(); s, e = t.find("{"), t.rfind("}")
                o = json.loads(t[s:e+1])
                return {"entities": [x for x in o.get("entities", []) if isinstance(x, str)], "concepts": [x for x in o.get("concepts", []) if isinstance(x, str)]}
            except Exception:
                time.sleep(0.8*(a+1))
        return {"entities": [], "concepts": []}
    with ThreadPoolExecutor(max_workers=6) as ex:
        res = list(ex.map(extract, items))
    ent_all = [x for r in res for x in r["entities"]]
    con_all = [x for r in res for x in r["concepts"]]
    ent_novel = sorted({x for x in ent_all if not ent_known(x)}, key=str.lower)
    con_novel = sorted({x for x in con_all if not con_known(x)}, key=str.lower)
    summary = {"ticket": "t/3233", "sample": {"conflicts": len(conf_s), "situations": len(sit_s)},
               "entities_extracted": len(ent_all), "entities_distinct": len(set(e.lower() for e in ent_all)),
               "entities_NOVEL_vs_taxonomy": len(ent_novel),
               "concepts_extracted": len(con_all), "concepts_distinct": len(set(c.lower() for c in con_all)),
               "concepts_NOVEL_vs_taxonomy": len(con_novel),
               "novel_entities_sample": ent_novel[:25], "novel_concepts_sample": con_novel[:30]}
    open(r"C:\Users\jsnov\AppData\Local\Temp\claude\C--Users-jsnov-repos-ai-triad-research-research-comp-linguist\019e49f7-9adc-70ae-929c-8ff098370e0c\scratchpad\harvest_pilot_summary.json", "w", encoding="utf-8").write(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f"\nENTITIES: {len(ent_all)} extracted, {summary['entities_distinct']} distinct, {len(ent_novel)} NOVEL vs taxonomy")
    print(f"CONCEPTS: {len(con_all)} extracted, {summary['concepts_distinct']} distinct, {len(con_novel)} NOVEL vs taxonomy")
    print(f"\nnovel entities (sample): {ent_novel[:20]}")
    print(f"\nnovel concepts (sample): {con_novel[:25]}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
