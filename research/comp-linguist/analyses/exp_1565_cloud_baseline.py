# exp t/1565 — cloud baseline assembly (read-only over ai-triad-data).
# 1) JSON-reliability proxies from calibration logs (last ~20 debates):
#    structural_error_rate, entailment_repair_rate, draft_repair_rate (+ entailment_pass_rate for context)
# 2) Cloud per-call latency from persisted diagnostics:
#    - claim-extraction calls: diagnostics entries' extraction_trace.response_time_ms (directly comparable
#      to the local claim-extraction schema calls)
#    - statement-generation calls: diagnostics entries' response_time_ms (context only)
#    - fence rate on cloud raw responses (repair_needed proxy): raw_response startswith ```
# Output: exp-1565-cloud-baseline.json (+ stdout summary)

import json
import statistics as st
import sys
from pathlib import Path

DATA = Path("C:/Users/jsnov/repos/ai-triad-data")
OUT = Path(__file__).parent / "exp-1565-cloud-baseline.json"

METRICS = ["structural_error_rate", "entailment_repair_rate", "draft_repair_rate", "entailment_pass_rate"]

def dist(vals):
    vals = [v for v in vals if isinstance(v, (int, float))]
    if not vals:
        return None
    s = sorted(vals)
    return {
        "n": len(vals),
        "mean": round(st.mean(vals), 4),
        "median": round(st.median(vals), 4),
        "min": round(min(vals), 4),
        "max": round(max(vals), 4),
        "p95": round(s[min(len(s) - 1, int(0.95 * len(s)))], 4),
    }

# ── 1. Calibration logs ──
cal_files = [DATA / "calibration/core/calibration-log.jsonl"] + \
    sorted((DATA / "calibration/users").glob("*/calibration-log.jsonl"))
entries = []
for f in cal_files:
    if not f.exists():
        continue
    for line in f.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            e = json.loads(line)
            entries.append(e)
        except Exception:
            pass

# newest entry per debate
by_debate = {}
for e in entries:
    did = e.get("debate_id")
    ts = e.get("timestamp") or ""
    if did and (did not in by_debate or ts > (by_debate[did].get("timestamp") or "")):
        by_debate[did] = e

def window_summary(window, label):
    out = {
        "label": label,
        "n_debates": len(window),
        "debate_window": [window[-1].get("timestamp"), window[0].get("timestamp")] if window else None,
        "models": sorted({e.get("model") for e in window if e.get("model")}),
        "metrics": {},
    }
    for m in METRICS:
        vals = [e.get(m) for e in window]
        nn = [v for v in vals if isinstance(v, (int, float))]
        out["metrics"][m] = {
            "non_null": len(nn),
            "dist": dist(nn),
            "values": [round(v, 4) if isinstance(v, (int, float)) else None for v in vals],
        }
    return out

all_recent = sorted(by_debate.values(), key=lambda e: e.get("timestamp") or "", reverse=True)
recent_raw = all_recent[:20]
recent_substantive = [e for e in all_recent if (e.get("rounds") or 0) >= 4][:20]

calibration = {
    "source": [str(f) for f in cal_files if f.exists()],
    "note": ("last_20_raw is dominated by a same-minute burst of 1-round experiment runs; "
             "last_20_substantive filters to rounds>=4 (real multi-round debates) and is the "
             "representative cloud-production window."),
    "last_20_raw": window_summary(recent_raw, "last 20 distinct debates, any"),
    "last_20_substantive": window_summary(recent_substantive, "last 20 distinct debates with rounds>=4"),
}

# ── 2. Cloud latency from diagnostics ──
# Standalone *-diagnostics.json + embedded session diagnostics (recent sessions).
extraction_calls = []   # {model, response_time_ms, prompt_chars, truncated, attempts}
statement_calls = []    # {model, response_time_ms, prompt_chars, fence}
fence_count = 0
raw_count = 0

def harvest_diag_entries(entries_dict, source):
    global fence_count, raw_count
    if not isinstance(entries_dict, dict):
        return
    for eid, v in entries_dict.items():
        if not isinstance(v, dict):
            continue
        rt = v.get("response_time_ms")
        if isinstance(rt, (int, float)) and rt > 0:
            statement_calls.append({
                "model": v.get("model"), "response_time_ms": rt,
                "prompt_chars": len(v.get("prompt") or ""), "source": source,
            })
        raw = v.get("raw_response")
        if isinstance(raw, str) and raw.strip():
            raw_count += 1
            if raw.lstrip().startswith("```"):
                fence_count += 1
        tr = v.get("extraction_trace")
        if isinstance(tr, dict) and isinstance(tr.get("response_time_ms"), (int, float)) and tr["response_time_ms"] > 0:
            extraction_calls.append({
                "model": tr.get("model"), "response_time_ms": tr["response_time_ms"],
                "prompt_chars": tr.get("prompt_chars"),
                "truncated": tr.get("response_truncated"),
                "attempts": tr.get("attempt_count"), "source": source,
            })

deb_dir = DATA / "debates"
# standalone diagnostics files
for f in sorted(deb_dir.glob("*-diagnostics.json")):
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
        harvest_diag_entries(d.get("entries"), f.name)
    except Exception:
        pass
# embedded diagnostics in the 40 most recent sessions (by mtime)
sessions = sorted(deb_dir.glob("debate-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:40]
for f in sessions:
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
        diag = d.get("diagnostics") or {}
        harvest_diag_entries(diag.get("entries"), f.name)
    except Exception:
        pass

def latency_summary(calls):
    by_model = {}
    for c in calls:
        by_model.setdefault(c.get("model") or "unknown", []).append(c["response_time_ms"] / 1000.0)
    return {m: dist(v) for m, v in sorted(by_model.items(), key=lambda kv: -len(kv[1]))}

result = {
    "generated": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime()),
    "calibration_last20_debates": calibration,
    "cloud_latency": {
        "provenance": "response_time_ms persisted in debate diagnostics (standalone *-diagnostics.json in "
                      "ai-triad-data/debates plus embedded diagnostics of the 40 most recent sessions). "
                      "extraction_calls = claim-extraction AI calls (extraction_trace), directly comparable "
                      "to the local claim-extraction schema. statement_calls = debater statement generations "
                      "(larger outputs; context only).",
        "extraction_calls_by_model_s": latency_summary(extraction_calls),
        "statement_calls_by_model_s": latency_summary(statement_calls),
        "n_extraction_calls": len(extraction_calls),
        "n_statement_calls": len(statement_calls),
        "extraction_truncation_rate": (
            round(sum(1 for c in extraction_calls if c.get("truncated")) / len(extraction_calls), 4)
            if extraction_calls else None),
        "extraction_multi_attempt_rate": (
            round(sum(1 for c in extraction_calls if (c.get("attempts") or 1) > 1) / len(extraction_calls), 4)
            if extraction_calls else None),
    },
    "cloud_fence_rate": {
        "provenance": "share of persisted raw_response strings starting with a markdown fence (```)",
        "n_raw_responses": raw_count,
        "fence_rate": round(fence_count / raw_count, 4) if raw_count else None,
    },
}

OUT.write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2)[:6000])
print(f"\nWrote {OUT}")

if __name__ == "__main__":
    pass
