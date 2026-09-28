#!/usr/bin/env python3
"""Debate-turn readability measurement (t/3720), the debate analogue of the op-ed
instrument (t/3696). Confirms whether debate transcript turns carry the same
density problem the op-eds did, and provides the before/after A/B ground truth for
the audience-keyed grade-target fix (policymakers 12 / all others 10).

Reuses the op-ed `measure_body` (FK grade + sentence/paragraph metrics + coherence
proxies) so debate and op-ed numbers are directly comparable, then adds the
audience split (debates carry an `audience` field; op-eds do not).

Run:  python measure_debate_readability.py [N]      # N most recent debates (default 30)
"""
import json, os, glob, sys, statistics
from collections import defaultdict

DATA = os.environ.get("AI_TRIAD_DATA_ROOT", r"C:\Users\jsnov\repos\ai-triad-data")
# Reuse the op-ed readability instrument so the two genres are measured identically.
_OPED_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "t3696-oped-readability")
sys.path.insert(0, os.path.abspath(_OPED_DIR))
from measure_oped_quality import measure_body  # noqa: E402

MIN_WORDS = 40  # skip trivial/degenerate turns (short procedural openings)
# PI-set targets (t/3720): policymakers can carry slightly denser; everyone else = the op-ed target.
AUDIENCE_GRADE_TARGET = defaultdict(lambda: 10, {"policymakers": 12})
SUBSTANTIVE_TYPES = ("statement", "opening")
CAMPS = ("accelerationist", "safetyist", "skeptic")


def _dist(v):
    if not v:
        return {"n": 0}
    s = sorted(v)
    return {"n": len(s), "median": round(statistics.median(s), 1), "mean": round(statistics.mean(s), 1),
            "p25": round(s[len(s) // 4], 1), "p75": round(s[(len(s) * 3) // 4], 1), "max": round(max(s), 1)}


def collect(n_debates):
    debs = sorted(glob.glob(os.path.join(DATA, "debates", "debate-*.json")), key=os.path.getmtime, reverse=True)[:n_debates]
    rows = []
    for p in debs:
        d = json.load(open(p, encoding="utf-8"))
        audience = d.get("audience") or "unknown"
        model = d.get("debate_model", "?")
        for x in (d.get("transcript") or []):
            if not isinstance(x, dict) or x.get("type") not in SUBSTANTIVE_TYPES or x.get("speaker") not in CAMPS:
                continue
            body = (x.get("content") or "").strip()
            if len(body.split()) < MIN_WORDS:
                continue
            m = measure_body(body)
            m.update({"audience": audience, "model": model, "speaker": x["speaker"][:3],
                      "debate": os.path.basename(p)[7:15], "target": AUDIENCE_GRADE_TARGET[audience]})
            rows.append(m)
    return debs, rows


def report(n_debates):
    debs, rows = collect(n_debates)
    n = len(rows)
    fk = [r["fk_grade"] for r in rows]
    over_target = sum(1 for r in rows if r["fk_grade"] > r["target"] + 1)  # +1 tolerance band
    print(f"debates sampled: {len(debs)} (most recent) | substantive turns (>= {MIN_WORDS}w): n={n}")
    print(f"FK grade: {_dist(fk)}")
    print(f"avg sentence len: {_dist([r['avg_sentence_len'] for r in rows])}")
    print(f"max sentence len: {_dist([r['max_sentence_len'] for r in rows])}")
    print(f"max paragraph words: {_dist([r['max_paragraph_words'] for r in rows])}")
    print(f"over audience target (+1 band): {over_target}/{n} ({over_target / max(1, n):.0%})")
    print("\nby audience (FK grade dist | target):")
    byaud = defaultdict(list)
    for r in rows:
        byaud[r["audience"]].append(r["fk_grade"])
    for aud, v in sorted(byaud.items(), key=lambda kv: -len(kv[1])):
        print(f"  {aud:<20} target {AUDIENCE_GRADE_TARGET[aud]}  {_dist(v)}")
    return {"n_debates": len(debs), "n_turns": n, "fk": _dist(fk),
            "by_audience": {a: _dist(v) for a, v in byaud.items()},
            "over_target_rate": round(over_target / max(1, n), 3)}


if __name__ == "__main__":
    report(int(sys.argv[1]) if len(sys.argv) > 1 else 30)
