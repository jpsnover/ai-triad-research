# exp t/1565 — runner: measure schema-valid-JSON rate + latency of local Ollama model
# against real debate-pipeline prompts (corpus from exp_1565_build_corpus.mts).
#
# Usage (from anywhere):
#   python research/comp-linguist/analyses/exp_1565_run.py [--only SCHEMA] [--limit N] [--dry]
#
# Sequential calls (CPU-bound; no concurrency). 600s timeout per call.
# Crash-resumable: results appended line-by-line to exp-1565-results.jsonl;
# already-done (schema, index) pairs are skipped on restart.

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
CORPUS = HERE / "exp-1565-corpus.jsonl"
RESULTS = HERE / "exp-1565-results.jsonl"

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL = "gemma4:e4b-it-q4_K_M"
TIMEOUT_S = 600
NUM_CTX = 16384  # largest corpus prompts are ~20K chars (~5-6K tokens); Ollama default ctx would truncate

# ── JSON extraction (mirrors production parseJsonRobust intent) ─────────────

def try_parse(text):
    """Returns (obj, repair_method) or (None, None). repair_method: none|fences|extract."""
    t = text.strip()
    try:
        return json.loads(t), "none"
    except Exception:
        pass
    # strip markdown fences
    t2 = t
    if t2.startswith("```"):
        first_nl = t2.find("\n")
        if first_nl != -1:
            t2 = t2[first_nl + 1:]
        if t2.rstrip().endswith("```"):
            t2 = t2.rstrip()[:-3]
        try:
            return json.loads(t2.strip()), "fences"
        except Exception:
            pass
    # extract outermost {...} or [...]
    for open_c, close_c in (("{", "}"), ("[", "]")):
        i, j = t.find(open_c), t.rfind(close_c)
        if i != -1 and j > i:
            try:
                return json.loads(t[i:j + 1]), "extract"
            except Exception:
                continue
    return None, None

# ── Validators: one per schema, derived from each prompt's "Return ONLY..." contract ──

def _is_str(x):
    return isinstance(x, str) and len(x.strip()) > 0

def _enum(x, vals):
    return isinstance(x, str) and x in vals

STRENGTH = {"decisive", "substantial", "tangential"}
ATTACK_TYPES = {"rebut", "undercut", "undermine"}
BDI = {"belief", "desire", "intention"}
YPN = {"yes", "partial", "no"}

def validate_topic_critique(o, meta):
    errs = []
    if not isinstance(o, dict):
        return ["top-level is not an object"]
    fs = o.get("frame_scores")
    dims = ["conditionality", "mechanism", "stakeholder", "tension", "scope"]
    if meta.get("audience") == "policymakers":
        dims += ["actor_specificity", "decision_proximity", "constituency_impact"]
    if not isinstance(fs, dict):
        errs.append("frame_scores missing/not object")
    else:
        for d in dims:
            v = fs.get(d)
            if not (isinstance(v, (int, float)) and v in (0, 1, 2)):
                errs.append(f"frame_scores.{d} missing or not 0|1|2 (got {v!r})")
    for key, fields in (("issues", ["dimension", "severity", "description", "suggestion"]),
                        ("reframe_suggestions", ["dimension", "original_weakness", "reframed_fragment"]),
                        ("scope_additions", ["dimension", "detail"])):
        arr = o.get(key)
        if not isinstance(arr, list):
            errs.append(f"{key} missing/not array")
            continue
        for k, item in enumerate(arr):
            if not isinstance(item, dict):
                errs.append(f"{key}[{k}] not object")
                continue
            for f in fields:
                if not _is_str(item.get(f)) and not (key == "issues" and f == "severity" and _enum(item.get(f), {"low", "medium", "high"})):
                    errs.append(f"{key}[{k}].{f} missing/empty")
            if key == "issues" and not _enum(item.get("severity"), {"low", "medium", "high"}):
                errs.append(f"issues[{k}].severity not low|medium|high")
    if not _is_str(o.get("rewritten_topic")):
        errs.append("rewritten_topic missing/empty")
    return errs

def validate_clarification(o, meta):
    errs = []
    if not isinstance(o, dict):
        return ["top-level is not an object"]
    qs = o.get("questions")
    if not isinstance(qs, list) or len(qs) == 0:
        return errs + ["questions missing/empty"]
    if not (1 <= len(qs) <= 3):
        errs.append(f"expected 1-3 questions, got {len(qs)}")
    for i, q in enumerate(qs):
        if not isinstance(q, dict):
            errs.append(f"questions[{i}] not object")
            continue
        if not _is_str(q.get("question")):
            errs.append(f"questions[{i}].question missing/empty")
        opts = q.get("options")
        if not isinstance(opts, list) or not all(_is_str(x) for x in opts):
            errs.append(f"questions[{i}].options missing/not array of strings")
        elif not (3 <= len(opts) <= 5):
            errs.append(f"questions[{i}].options expected 3-5, got {len(opts)}")
    return errs

def validate_topic_synthesis(o, meta):
    if not isinstance(o, dict):
        return ["top-level is not an object"]
    if not _is_str(o.get("refined_topic")):
        return ["refined_topic missing/empty"]
    return []

def validate_crux_refresh(o, meta):
    errs = []
    if not isinstance(o, dict):
        return ["top-level is not an object"]
    cv = o.get("crux_verdicts")
    if not isinstance(cv, list):
        errs.append("crux_verdicts missing/not array")
    else:
        for i, v in enumerate(cv):
            if not isinstance(v, dict):
                errs.append(f"crux_verdicts[{i}] not object")
                continue
            if not _is_str(v.get("id")):
                errs.append(f"crux_verdicts[{i}].id missing")
            if not _enum(v.get("verdict"), {"resolved", "superseded", "active"}):
                errs.append(f"crux_verdicts[{i}].verdict not resolved|superseded|active (got {v.get('verdict')!r})")
            if not _is_str(v.get("reason")):
                errs.append(f"crux_verdicts[{i}].reason missing")
    ec = o.get("emerging_cruxes")
    if not isinstance(ec, list):
        errs.append("emerging_cruxes missing/not array")
    else:
        for i, v in enumerate(ec):
            if not isinstance(v, dict):
                errs.append(f"emerging_cruxes[{i}] not object")
                continue
            if not _is_str(v.get("description")):
                errs.append(f"emerging_cruxes[{i}].description missing")
            if not isinstance(v.get("speakers_involved"), list):
                errs.append(f"emerging_cruxes[{i}].speakers_involved missing/not array")
            if not _enum(v.get("disagreement_type"), {"empirical", "values", "definitional"}):
                errs.append(f"emerging_cruxes[{i}].disagreement_type invalid (got {v.get('disagreement_type')!r})")
            if not _is_str(v.get("reason")):
                errs.append(f"emerging_cruxes[{i}].reason missing")
    return errs

def validate_evidence_search(o, meta):
    errs = []
    if not isinstance(o, dict):
        return ["top-level is not an object"]
    if not _enum(o.get("verdict"), {"verified", "disputed", "unverifiable"}):
        errs.append(f"verdict not verified|disputed|unverifiable (got {o.get('verdict')!r})")
    if not _is_str(o.get("evidence")):
        errs.append("evidence missing/empty")
    if not _enum(o.get("confidence"), {"high", "medium", "low"}):
        errs.append(f"confidence not high|medium|low (got {o.get('confidence')!r})")
    return errs

def _validate_responds_to(rt, path, errs):
    if not isinstance(rt, list):
        errs.append(f"{path}.responds_to missing/not array")
        return
    for j, r in enumerate(rt):
        p = f"{path}.responds_to[{j}]"
        if not isinstance(r, dict):
            errs.append(f"{p} not object")
            continue
        if not _is_str(r.get("prior_claim_id")):
            errs.append(f"{p}.prior_claim_id missing")
        rel = r.get("relationship")
        if not _enum(rel, {"supports", "attacks"}):
            errs.append(f"{p}.relationship not supports|attacks (got {rel!r})")
        if rel == "attacks" and not _enum(r.get("attack_type"), ATTACK_TYPES):
            errs.append(f"{p}.attack_type not rebut|undercut|undermine (got {r.get('attack_type')!r})")
        if not _enum(r.get("strength"), STRENGTH):
            errs.append(f"{p}.strength not decisive|substantial|tangential (got {r.get('strength')!r})")

def _validate_claim_common(c, path, errs, require_canonical, meta, require_topic_relevance):
    if not _is_str(c.get("text")):
        errs.append(f"{path}.text missing/empty")
    _validate_responds_to(c.get("responds_to"), path, errs)
    bdi = c.get("bdi_category")
    if not _enum(bdi, BDI):
        errs.append(f"{path}.bdi_category not belief|desire|intention (got {bdi!r})")
    ec = c.get("extraction_confidence")
    if not (isinstance(ec, (int, float)) and 0 <= ec <= 1):
        errs.append(f"{path}.extraction_confidence missing/not 0-1 (got {ec!r})")
    if not _is_str(c.get("attribution_text")):
        errs.append(f"{path}.attribution_text missing/empty")
    if not _enum(c.get("specificity"), {"precise", "general", "abstract"}):
        errs.append(f"{path}.specificity invalid (got {c.get('specificity')!r})")
    if require_canonical and not _is_str(c.get("canonical_proposition")):
        errs.append(f"{path}.canonical_proposition missing/empty")
    if bdi == "belief":
        if not _enum(c.get("base_strength"), {"grounded", "reasoned", "asserted"}):
            errs.append(f"{path}.base_strength (belief) invalid (got {c.get('base_strength')!r})")
        bv = c.get("belief_verification")
        if not isinstance(bv, dict):
            errs.append(f"{path}.belief_verification (belief) missing/not object")
        else:
            if not _is_str(bv.get("evidence_cited")):
                errs.append(f"{path}.belief_verification.evidence_cited missing")
            for f, vals in (("source_located", {"found", "not_found", "no_source"}),
                            ("evidence_supports", {"strongly", "partially", "weakly", "contradicts"}),
                            ("counter_evidence", {"none", "minor", "significant"}),
                            ("ambiguity_resolved", {"none", "acknowledged", "collapsed"})):
                if not _enum(bv.get(f), vals):
                    errs.append(f"{path}.belief_verification.{f} invalid (got {bv.get(f)!r})")
    elif bdi in ("desire", "intention"):
        keys = (["values_grounding", "tradeoff_acknowledgment", "precedent_citation"] if bdi == "desire"
                else ["mechanism_specificity", "scope_bounding", "failure_mode_addressing"])
        ss = c.get("bdi_sub_scores")
        if not isinstance(ss, dict):
            errs.append(f"{path}.bdi_sub_scores ({bdi}) missing/not object")
        else:
            for f in keys:
                if not _enum(ss.get(f), YPN):
                    errs.append(f"{path}.bdi_sub_scores.{f} invalid (got {ss.get(f)!r})")
    if require_topic_relevance and not _enum(c.get("topic_relevance"), {"on_topic", "adjacent", "off_topic"}):
        errs.append(f"{path}.topic_relevance invalid (got {c.get('topic_relevance')!r})")
    if meta.get("audience") == "policymakers" and not _enum(c.get("political_salience"), {"high", "medium", "low"}):
        errs.append(f"{path}.political_salience invalid (got {c.get('political_salience')!r})")

def _validate_claims(o, meta, require_canonical, require_topic_relevance):
    errs = []
    if not isinstance(o, dict):
        return ["top-level is not an object"], False
    claims = o.get("claims")
    if not isinstance(claims, list) or len(claims) == 0:
        return ["claims missing/empty"], False
    core = all(isinstance(c, dict) and _is_str(c.get("text")) and isinstance(c.get("responds_to"), list)
               for c in claims)
    for i, c in enumerate(claims):
        if not isinstance(c, dict):
            errs.append(f"claims[{i}] not object")
            continue
        _validate_claim_common(c, f"claims[{i}]", errs, require_canonical, meta, require_topic_relevance)
    return errs, core

def validate_claim_extraction(o, meta):
    errs, core = _validate_claims(o, meta, require_canonical=True,
                                  require_topic_relevance=bool(meta.get("topic_passed")))
    validate_claim_extraction.last_core = core
    return errs

def validate_claim_classification(o, meta):
    errs, core = _validate_claims(o, meta, require_canonical=False, require_topic_relevance=False)
    validate_claim_classification.last_core = core
    return errs

def validate_entailment(o, meta):
    errs = []
    if not isinstance(o, dict):
        return ["top-level is not an object"]
    if not _enum(o.get("verdict"), {"entailed", "partial", "not_entailed"}):
        errs.append(f"verdict not entailed|partial|not_entailed (got {o.get('verdict')!r})")
    if not _is_str(o.get("explanation")):
        errs.append("explanation missing/empty")
    if "repaired_claim" not in o:
        errs.append("repaired_claim key missing")
    elif o["repaired_claim"] is not None and not isinstance(o["repaired_claim"], str):
        errs.append("repaired_claim not string|null")
    return errs

def validate_evidence_qbaf(o, meta):
    errs = []
    n = int(meta.get("evidence_count") or 0)
    if not isinstance(o, list):
        return ["top-level is not an array"]
    seen = set()
    for i, e in enumerate(o):
        if not isinstance(e, dict):
            errs.append(f"[{i}] not object")
            continue
        idx = e.get("index")
        if not (isinstance(idx, int) and 1 <= idx <= n):
            errs.append(f"[{i}].index missing/out of range 1..{n} (got {idx!r})")
        else:
            seen.add(idx)
        if not _enum(e.get("relation"), {"support", "contradict", "irrelevant"}):
            errs.append(f"[{i}].relation invalid (got {e.get('relation')!r})")
    if seen != set(range(1, n + 1)):
        errs.append(f"expected one entry per evidence item 1..{n}, got indices {sorted(seen)}")
    return errs

VALIDATORS = {
    "debate.topic-critique": validate_topic_critique,
    "debate.clarification-questions": validate_clarification,
    "debate.topic-synthesis": validate_topic_synthesis,
    "debate.crux-refresh": validate_crux_refresh,
    "debate.evidence-search": validate_evidence_search,
    "claim-extraction": validate_claim_extraction,
    "claim-classification": validate_claim_classification,
    "entailment-check": validate_entailment,
    "evidence-qbaf-classify": validate_evidence_qbaf,
}

# ── Ollama call ──────────────────────────────────────────────────────────────

def call_ollama(prompt, num_predict):
    body = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "format": "json",
        "stream": False,
        "keep_alive": "15m",
        "options": {"temperature": 0.3, "num_predict": num_predict, "num_ctx": NUM_CTX},
    }
    req = urllib.request.Request(
        OLLAMA_URL, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    latency = time.monotonic() - t0
    return data, latency

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="run only this schema")
    ap.add_argument("--limit", type=int, help="max calls this invocation")
    ap.add_argument("--dry", action="store_true", help="list what would run")
    args = ap.parse_args()

    items = [json.loads(line) for line in CORPUS.read_text(encoding="utf-8").splitlines() if line.strip()]
    done = set()
    schemas_started = set()
    if RESULTS.exists():
        for line in RESULTS.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                r = json.loads(line)
                done.add((r["schema"], r["index"]))
                schemas_started.add(r["schema"])
            except Exception:
                pass

    todo = [it for it in items if (it["schema"], it["index"]) not in done]
    if args.only:
        todo = [it for it in todo if it["schema"] == args.only]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(items)} corpus items; {len(done)} already done; {len(todo)} to run", flush=True)
    if args.dry:
        for it in todo:
            print(f"  {it['schema']}#{it['index']} ({it['prompt_chars']} chars, np={it['num_predict']})")
        return

    ran = 0
    for it in todo:
        schema, index = it["schema"], it["index"]
        first_of_schema = schema not in schemas_started
        schemas_started.add(schema)
        rec = {
            "schema": schema, "index": index,
            "source_debate_id": it["source_debate_id"],
            "prompt_chars": it["prompt_chars"],
            "num_predict": it["num_predict"],
            "first_of_schema": first_of_schema,
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        try:
            data, latency = call_ollama(it["prompt"], it["num_predict"])
            text = (data.get("message") or {}).get("content", "") or ""
            rec.update({
                "latency_s": round(latency, 2),
                "load_duration_s": round(data.get("load_duration", 0) / 1e9, 2),
                "prompt_eval_count": data.get("prompt_eval_count"),
                "eval_count": data.get("eval_count"),
                "total_duration_s": round(data.get("total_duration", 0) / 1e9, 2),
                "done_reason": data.get("done_reason"),
                "response_chars": len(text),
            })
            obj, method = try_parse(text)
            rec["valid_json"] = obj is not None
            rec["repair_needed"] = method not in (None, "none") if obj is not None else False
            rec["repair_method"] = method or "unparseable"
            if obj is not None:
                errs = VALIDATORS[schema](obj, it.get("meta") or {})
                rec["schema_valid"] = len(errs) == 0
                rec["error"] = "; ".join(errs[:12]) if errs else None
                rec["n_schema_errors"] = len(errs)
                if schema in ("claim-extraction", "claim-classification"):
                    rec["core_valid"] = getattr(VALIDATORS[schema], "last_core", None)
            else:
                rec["schema_valid"] = False
                rec["error"] = "response is not parseable JSON"
                rec["n_schema_errors"] = -1
            # keep a failure excerpt for the report; short excerpt otherwise
            rec["response_excerpt"] = text[:2500] if not rec["schema_valid"] else text[:300]
        except urllib.error.URLError as e:
            if "timed out" in str(e).lower():
                rec.update({"valid_json": False, "schema_valid": False, "repair_needed": False,
                            "error": "timeout (600s)", "latency_s": TIMEOUT_S})
                with RESULTS.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                ran += 1
                print(f"[{ran}/{len(todo)}] {schema}#{index} TIMEOUT", flush=True)
                continue
            # one retry after a pause for transient connection issues
            time.sleep(15)
            try:
                data, latency = call_ollama(it["prompt"], it["num_predict"])
                text = (data.get("message") or {}).get("content", "") or ""
                obj, method = try_parse(text)
                errs = VALIDATORS[schema](obj, it.get("meta") or {}) if obj is not None else ["unparseable"]
                rec.update({
                    "latency_s": round(latency, 2), "retried": True,
                    "load_duration_s": round(data.get("load_duration", 0) / 1e9, 2),
                    "prompt_eval_count": data.get("prompt_eval_count"),
                    "eval_count": data.get("eval_count"),
                    "done_reason": data.get("done_reason"),
                    "response_chars": len(text),
                    "valid_json": obj is not None,
                    "repair_needed": (method not in (None, "none")) if obj is not None else False,
                    "repair_method": method or "unparseable",
                    "schema_valid": obj is not None and len(errs) == 0,
                    "error": None if (obj is not None and not errs) else "; ".join(str(x) for x in errs[:12]),
                    "response_excerpt": text[:2500],
                })
            except Exception as e2:
                rec.update({"valid_json": False, "schema_valid": False, "repair_needed": False,
                            "error": f"call failed after retry: {type(e2).__name__}: {e2}", "latency_s": None})
        except Exception as e:
            rec.update({"valid_json": False, "schema_valid": False, "repair_needed": False,
                        "error": f"call failed: {type(e).__name__}: {e}", "latency_s": None})

        with RESULTS.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        ran += 1
        print(f"[{ran}/{len(todo)}] {schema}#{index} "
              f"json={rec.get('valid_json')} schema={rec.get('schema_valid')} "
              f"lat={rec.get('latency_s')}s ev={rec.get('eval_count')} "
              f"{('ERR: ' + str(rec.get('error'))[:110]) if rec.get('error') else ''}", flush=True)

    print("Run complete.", flush=True)

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
