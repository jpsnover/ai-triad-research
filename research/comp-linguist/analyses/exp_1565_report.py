# exp t/1565 — report generator: reads exp-1565-results.jsonl + exp-1565-cloud-baseline.json
# and writes exp-1565-run-report.md. Data only — no verdict (CL applies pre-registered thresholds).

import json
import statistics as st
import sys
from pathlib import Path

HERE = Path(__file__).parent
RESULTS = HERE / "exp-1565-results.jsonl"
CORPUS = HERE / "exp-1565-corpus.jsonl"
BASELINE = HERE / "exp-1565-cloud-baseline.json"
OUT = HERE / "exp-1565-run-report.md"

MODEL = "gemma4:e4b-it-q4_K_M"
SCHEMA_ORDER = [
    "debate.topic-critique", "debate.clarification-questions", "debate.topic-synthesis",
    "debate.crux-refresh", "debate.evidence-search", "claim-extraction",
    "claim-classification", "entailment-check", "evidence-qbaf-classify",
]

def pct(n, d):
    return f"{100.0 * n / d:.1f}%" if d else "n/a"

def p95(vals):
    if not vals:
        return None
    s = sorted(vals)
    return s[min(len(s) - 1, int(round(0.95 * (len(s) - 1))))]

def fmt_s(v):
    return f"{v:.1f}" if isinstance(v, (int, float)) else "n/a"

results = [json.loads(l) for l in RESULTS.read_text(encoding="utf-8").splitlines() if l.strip()]
corpus = [json.loads(l) for l in CORPUS.read_text(encoding="utf-8").splitlines() if l.strip()]
baseline = json.loads(BASELINE.read_text(encoding="utf-8")) if BASELINE.exists() else None

corpus_by_schema = {}
for c in corpus:
    corpus_by_schema.setdefault(c["schema"], []).append(c)

by_schema = {}
for r in results:
    by_schema.setdefault(r["schema"], []).append(r)

lines = []
lines.append("# exp t/1565 — Local-model schema-validity & latency run report")
lines.append("")
lines.append(f"**Model under test:** `{MODEL}` via Ollama `/api/chat`, `format:\"json\"`, `stream:false`, "
             f"options `{{temperature:0.3, num_ctx:16384, num_predict:per-schema}}`, sequential calls, 600s timeout.")
lines.append(f"**Hardware note:** model ran fully on CPU (`size_vram: 0` in /api/ps).")
lines.append(f"**Corpus:** {len(corpus)} real prompts reconstructed from production builder functions over "
             f"{len({c['source_debate_id'] for c in corpus})} distinct debate sessions "
             f"(`exp-1565-corpus.jsonl`, built by `exp_1565_build_corpus.mts`).")
lines.append(f"**Results:** {len(results)} calls in `exp-1565-results.jsonl`.")
lines.append("")
lines.append("No verdict is drawn here — the CL applies the pre-registered thresholds from t/1565.")
lines.append("")

# ── Per-schema table ──
lines.append("## Per-schema results")
lines.append("")
lines.append("Latency: `warm` excludes calls with model (re)load (first_of_schema or load_duration > 2s); "
             "`all` includes them. `trunc` = calls stopped by num_predict (done_reason=length).")
lines.append("")
lines.append("| schema | n | valid_json | schema_valid | repair_needed | trunc | lat mean warm (s) | lat p95 warm (s) | lat mean all (s) | lat p95 all (s) |")
lines.append("|---|---|---|---|---|---|---|---|---|---|")

pool = {"n": 0, "vj": 0, "sv": 0, "rep": 0, "trunc": 0, "lat_all": [], "lat_warm": []}
for schema in SCHEMA_ORDER:
    rs = by_schema.get(schema, [])
    n = len(rs)
    if n == 0:
        lines.append(f"| {schema} | 0 | — | — | — | — | — | — | — | — |")
        continue
    vj = sum(1 for r in rs if r.get("valid_json"))
    sv = sum(1 for r in rs if r.get("schema_valid"))
    rep = sum(1 for r in rs if r.get("repair_needed"))
    trunc = sum(1 for r in rs if r.get("done_reason") == "length")
    lat_all = [r["latency_s"] for r in rs if isinstance(r.get("latency_s"), (int, float))]
    lat_warm = [r["latency_s"] for r in rs
                if isinstance(r.get("latency_s"), (int, float))
                and not r.get("first_of_schema") and (r.get("load_duration_s") or 0) <= 2]
    lines.append(
        f"| {schema} | {n} | {pct(vj, n)} | {pct(sv, n)} | {pct(rep, n)} | {trunc} | "
        f"{fmt_s(st.mean(lat_warm)) if lat_warm else 'n/a'} | {fmt_s(p95(lat_warm))} | "
        f"{fmt_s(st.mean(lat_all)) if lat_all else 'n/a'} | {fmt_s(p95(lat_all))} |")
    pool["n"] += n; pool["vj"] += vj; pool["sv"] += sv; pool["rep"] += rep; pool["trunc"] += trunc
    pool["lat_all"] += lat_all; pool["lat_warm"] += lat_warm

lines.append(
    f"| **pooled** | **{pool['n']}** | **{pct(pool['vj'], pool['n'])}** | **{pct(pool['sv'], pool['n'])}** | "
    f"**{pct(pool['rep'], pool['n'])}** | **{pool['trunc']}** | "
    f"**{fmt_s(st.mean(pool['lat_warm'])) if pool['lat_warm'] else 'n/a'}** | **{fmt_s(p95(pool['lat_warm']))}** | "
    f"**{fmt_s(st.mean(pool['lat_all'])) if pool['lat_all'] else 'n/a'}** | **{fmt_s(p95(pool['lat_all']))}** |")
lines.append("")

# core_valid for the two claim schemas
for schema in ("claim-extraction", "claim-classification"):
    rs = [r for r in by_schema.get(schema, []) if r.get("core_valid") is not None]
    if rs:
        cv = sum(1 for r in rs if r.get("core_valid"))
        lines.append(f"- `{schema}` **core_valid** (claims[] present, each with text + responds_to array — "
                     f"roughly what the production parser minimally needs): {pct(cv, len(rs))} ({cv}/{len(rs)}). "
                     f"schema_valid above is the strict full-contract check.")
lines.append("")

# throughput
evs = [(r.get("eval_count"), r.get("latency_s")) for r in results
       if isinstance(r.get("eval_count"), int) and isinstance(r.get("latency_s"), (int, float)) and r["latency_s"] > 0]
if evs:
    tok_s = [e / l for e, l in evs if e > 20]
    if tok_s:
        lines.append(f"Generation throughput (eval_count/latency, calls with >20 output tokens): "
                     f"median {st.median(tok_s):.1f} tok/s (n={len(tok_s)}). Note latency includes prompt eval.")
        lines.append("")

# corpus size per schema
lines.append("## Corpus composition")
lines.append("")
lines.append("| schema | prompts | distinct debates | prompt chars min/med/max |")
lines.append("|---|---|---|---|")
for schema in SCHEMA_ORDER:
    cs = corpus_by_schema.get(schema, [])
    if not cs:
        continue
    chars = sorted(c["prompt_chars"] for c in cs)
    lines.append(f"| {schema} | {len(cs)} | {len({c['source_debate_id'] for c in cs})} | "
                 f"{chars[0]}/{chars[len(chars)//2]}/{chars[-1]} |")
lines.append("")

# ── Failure examples ──
lines.append("## Failure examples (up to 3 per schema with failures, truncated to ~300 chars)")
lines.append("")
for schema in SCHEMA_ORDER:
    fails = [r for r in by_schema.get(schema, []) if not r.get("schema_valid")]
    if not fails:
        continue
    lines.append(f"### {schema} ({len(fails)} failures)")
    lines.append("")
    for r in fails[:3]:
        lines.append(f"- **#{r['index']}** (debate `{r['source_debate_id'][:8]}`, done_reason={r.get('done_reason')}): "
                     f"validator: `{str(r.get('error'))[:300]}`")
        exc = (r.get("response_excerpt") or "").replace("\n", " ")[:300]
        lines.append(f"  - output: `{exc}`")
    lines.append("")

# ── Cloud baseline ──
lines.append("## Cloud baseline")
lines.append("")
if baseline:
    sub = baseline["calibration_last20_debates"]["last_20_substantive"]
    lines.append("### JSON-reliability proxies (calibration logs)")
    lines.append("")
    lines.append(f"Provenance: `ai-triad-data/calibration/core/calibration-log.jsonl` + `users/*/calibration-log.jsonl`; "
                 f"newest entry per debate; window = last {sub['n_debates']} debates with rounds>=4 "
                 f"({sub['debate_window'][0]} .. {sub['debate_window'][1]}). "
                 f"(The raw last-20 window is dominated by a same-minute burst of 1-round experiment runs — "
                 f"see `exp-1565-cloud-baseline.json` for both windows.)")
    lines.append("")
    lines.append(f"Models in window: {', '.join(sub['models'])}")
    lines.append("")
    lines.append("| metric | non-null (of 20) | mean | median | min | max |")
    lines.append("|---|---|---|---|---|---|")
    for m, v in sub["metrics"].items():
        d = v["dist"]
        if d:
            lines.append(f"| {m} | {v['non_null']} | {d['mean']} | {d['median']} | {d['min']} | {d['max']} |")
        else:
            lines.append(f"| {m} | {v['non_null']} | — | — | — | — |")
    lines.append("")
    cl = baseline["cloud_latency"]
    lines.append("### Cloud per-call latency (persisted diagnostics — real measured timings, not estimates)")
    lines.append("")
    lines.append(cl["provenance"])
    lines.append("")
    lines.append(f"Claim-extraction AI calls (n={cl['n_extraction_calls']}), seconds, by model:")
    lines.append("")
    lines.append("| model | n | mean | median | p95 | max |")
    lines.append("|---|---|---|---|---|---|")
    for m, d in cl["extraction_calls_by_model_s"].items():
        lines.append(f"| {m} | {d['n']} | {d['mean']} | {d['median']} | {d['p95']} | {d['max']} |")
    lines.append("")
    lines.append(f"Statement-generation calls (context only, n={cl['n_statement_calls']}): see `exp-1565-cloud-baseline.json`.")
    lines.append("")
    lines.append(f"Cloud extraction truncation rate: {cl['extraction_truncation_rate']}; "
                 f"multi-attempt rate: {cl['extraction_multi_attempt_rate']}.")
    fr = baseline["cloud_fence_rate"]
    lines.append(f"Cloud fence rate (repair_needed proxy — raw_response starting with ```): "
                 f"{fr['fence_rate']} over {fr['n_raw_responses']} persisted raw responses.")
else:
    lines.append("Baseline file missing — run exp_1565_cloud_baseline.py.")
lines.append("")

OUT_STATIC = """## Exclusions, deviations, and fidelity notes

1. **debate.topic-synthesis n=6 (below the 20 target).** The production consumer of this UsageID is
   `concludingPrompt(topic, qaPairs, ...)` (`lib/debate/topicPipeline.ts:393-394`), whose qaPairs input
   requires real clarification questions. Only 6 of 219 sessions in the data repo persist a clarification
   entry with questions; prompts were built from all 6 rather than fabricating Q&A sets.
2. **Brief listed `debateSynthesisPrompt` (prompts.ts:2752) for debate.topic-synthesis — production wiring
   differs.** `debateSynthesisPrompt` has no production call site (it survives only in the renderer prompt
   catalog mirror); end-of-debate synthesis runs through the 3-phase `synthesisPhases.ts` prompts
   (synth.extract/map/policy UsageIDs), which are out of the frozen schema list. Per the fidelity-to-call-site
   rule, `concludingPrompt` was measured for this UsageID.
3. **debate.evidence-search.** The UsageID is config-only in `ai-usages.json`
   ("Not wired to callByUsage — uses generateTextWithSearch"). The executing prompt is the inline fallback
   single-verdict template at `lib/debate/claimExtractionPipeline.ts:679-690`; that template was replicated
   verbatim with real precise-belief claims. Caveat: production runs it with web-search grounding
   (Gemini Grounding API); the local model has no search tool, so verdict *content* is not comparable —
   only JSON-contract compliance and latency are meaningful for this schema.
4. **evidence-qbaf-classify inputs are the persisted post-filter evidence set.** Sessions persist
   `node.evidence_graph.evidence_items` with irrelevant items already filtered out; the original retrieval
   set is not recoverable without re-running the embedding retriever. `standardizedTerms` (vocabulary
   section) is not persisted and was passed as undefined.
5. **debate.topic-critique built without `structuralContext`** (not persisted in sessions; undefined is the
   production path when structural analysis is unavailable). Same for `lineageContext` on
   clarification/synthesis prompts.
6. **crux-refresh topic quirk replicated.** Production passes `(session.topic as {text}).text ?? ''` — the
   topic object has no `.text` field, so production sends an empty topic string. The replay does the same
   (`topic_arg_empty: true` in corpus meta), so measured prompts match production byte-for-byte on this.
7. **claim-classification used real persisted `metadata.my_claims` sketches** (the brief suggested deriving
   sketches from AN nodes; the sessions turned out to persist the actual debater sketches, which is
   higher-fidelity).
8. **num_ctx=16384** was set explicitly (largest prompts ~20K chars ≈ 5K tokens; Ollama's default context
   would silently truncate). num_predict per schema follows ai-usages.json maxTokens where the UsageID
   defines one (critique 4096, clarification 2048, synthesis 2048, crux-refresh 2048); contract-sized
   otherwise (extraction/classification 4096, entailment 512, evidence-search 768, evidence-qbaf 1024).
9. **schema_valid is the strict full-contract check** derived from each prompt's "Return ONLY..." text,
   including conditional per-BDI-category fields and enum values. The production parsers are more lenient;
   `core_valid` is reported for the two claim schemas as a leniency reference point.
10. **Cloud latency figures are real measured `response_time_ms`** from persisted diagnostics (no estimates
    were needed). They are end-to-end API call timings recorded by the debate engine.
"""

lines.append(OUT_STATIC)

OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Wrote {OUT} ({len(lines)} lines)")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
