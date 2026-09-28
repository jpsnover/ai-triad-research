#!/usr/bin/env python3
"""Op-ed readability + coherence measurement instrument (t/3696).

Readers complain the op-eds are hard to read AND hard to follow the argument.
Those are two DIFFERENT defects, and this instrument measures both over the
corpus so the fix (t/3696: measurable prompt constraints + a targeted edit pass)
has a baseline and an A/B ground truth.

Two axes, reported separately:

  A. READABILITY (deterministic, reproducible):
     - fk_grade            Flesch-Kincaid grade level (target: op-ed = 9-12).
     - flesch_reading_ease  higher = easier (60-70 = plain English).
     - avg/max sentence length (words); % sentences over 30 words.
     - avg/max paragraph length (words + sentences); % paragraphs over 4
       sentences; % paragraphs over 90 words (the "3-4 sentence rule gamed by
       long sentences" case - the prompt's paragraph rule is satisfiable by
       fewer, longer sentences, so a word cap is the honest complement).

  B. COHERENCE PROXIES (HEURISTIC - clearly labeled; NOT validated metrics):
     Flow can't be measured as cleanly as readability (no cheap deterministic
     ground truth). These are narrow, high-precision PROXIES for specific,
     observed failure modes, reported as diagnostics, never as a validated
     coherence score (per the CL provenance discipline - an LLM-judge coherence
     read would be an *unvalidated judge*; these mechanical proxies are weaker
     still and are labeled as such):
     - dangling_numeric_reference: a demonstrative + quantity noun ("that
       number", "this figure", "these statistics") with NO numeral or
       number-word anywhere earlier in the body. This is the exact failure found
       in the grade-19 skeptic piece ("That number is right and it's ugly" with
       zero digits before it). High precision, low recall (won't catch
       non-numeric dangling refs like "this shift").
     - crammed_paragraph: a paragraph with > 4 sentences OR > 90 words (the
       "multiple unconnected claims per paragraph" signal).
     - paragraph_initial_demonstrative_rate: fraction of paragraphs opening with
       a bare demonstrative ("This ", "That ", "These/Those ", "Such ") - a SOFT
       signal that a paragraph leans on back-reference rather than a topic
       sentence. Reported, not judged.

No pass/fail threshold is attached (per CL provenance discipline: report the
distribution first; a blocking cut is a separate, deliberate decision validated
against a labeled readable/unreadable set). Provenance: derived (readability) /
heuristic-proxy (coherence).

Run:  python measure_oped_quality.py [--data-root DIR] [--out PATH] [--quiet]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import statistics
from collections import Counter, defaultdict
from typing import Optional

# Op-ed reading-level target (guest essays: NYT/WSJ land ~9-12).
FK_TARGET_LOW, FK_TARGET_HIGH = 9.0, 12.0

# Bodies below this word count are empty/degenerate generations (failed or draft
# slots), NOT op-eds. They are excluded from the readability/coherence stats
# (an empty body scores a spurious FK ~ -15 that corrupts the aggregate) and
# reported separately as a data-quality signal. Real op-eds target 400-800 words.
MIN_SUBSTANTIVE_WORDS = 50

# Demonstrative + quantity-noun phrases whose referent should already be on the
# page. Narrow set for high precision.
_QUANTITY_NOUNS = r"(?:number|figure|statistic|statistics|stat|stats|percentage|percentages|share|proportion|count|total|tally|sum|amount|rate)"
_DANGLING_RE = re.compile(r"\b(that|this|these|those)\s+" + _QUANTITY_NOUNS + r"\b", re.IGNORECASE)
# A numeral or number-word that would serve as the antecedent.
_NUMBER_RE = re.compile(
    r"\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    r"dozen|hundred|thousand|million|billion|trillion|percent|half|third|quarter"
    r"|majority|minority)\b",
    re.IGNORECASE,
)
_PARA_DEMONSTRATIVE_RE = re.compile(r"^\s*(this|that|these|those|such)\b", re.IGNORECASE)


def _count_syllables(word: str) -> int:
    """Heuristic syllable count (vowel groups, minus a silent trailing 'e')."""
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return 0
    syl = len(re.findall(r"[aeiouy]+", w))
    if w.endswith("e") and not w.endswith("le") and syl > 1:
        syl -= 1
    return max(1, syl)


def _sentences(text: str) -> list[str]:
    """Split into sentences on ., !, ? runs. A proxy - good enough for prose
    (abbreviation over-splitting is rare in op-ed register and affects all
    pieces equally, so cross-piece comparison stays fair)."""
    return [s.strip() for s in re.split(r"[.!?]+", text) if s.strip()]


def _words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z']+", text)


def _paragraphs(body: str) -> list[str]:
    return [p.strip() for p in body.split("\n") if p.strip()]


def _fk_grade(asl: float, asw: float) -> float:
    return 0.39 * asl + 11.8 * asw - 15.59


def _reading_ease(asl: float, asw: float) -> float:
    return 206.835 - 1.015 * asl - 84.6 * asw


def measure_body(body: str) -> dict:
    """All per-op-ed measures for one body."""
    sents = _sentences(body)
    words = _words(body)
    paras = _paragraphs(body)
    n_sent = max(1, len(sents))
    n_word = max(1, len(words))
    syllables = sum(_count_syllables(w) for w in words)
    asl = n_word / n_sent
    asw = syllables / n_word

    sent_lens = [len(_words(s)) for s in sents]
    para_word_lens = [len(_words(p)) for p in paras]
    para_sent_counts = [len(_sentences(p)) for p in paras]

    # --- coherence proxies ---
    # dangling numeric reference: demonstrative+quantity noun with no number before it.
    dangling = []
    for m in _DANGLING_RE.finditer(body):
        preceding = body[: m.start()]
        if not _NUMBER_RE.search(preceding):
            dangling.append({"phrase": m.group(0), "char_pos": m.start()})
    crammed = sum(1 for p in paras if len(_sentences(p)) > 4 or len(_words(p)) > 90)
    para_demo = sum(1 for p in paras if _PARA_DEMONSTRATIVE_RE.match(p))

    return {
        "fk_grade": round(_fk_grade(asl, asw), 1),
        "reading_ease": round(_reading_ease(asl, asw), 1),
        "avg_sentence_len": round(asl, 1),
        "max_sentence_len": max(sent_lens) if sent_lens else 0,
        "pct_sentences_over_30w": round(sum(1 for x in sent_lens if x > 30) / n_sent, 3),
        "n_sentences": len(sents),
        "n_words": len(words),
        "n_paragraphs": len(paras),
        "avg_paragraph_words": round(statistics.mean(para_word_lens), 1) if para_word_lens else 0,
        "max_paragraph_words": max(para_word_lens) if para_word_lens else 0,
        "max_paragraph_sentences": max(para_sent_counts) if para_sent_counts else 0,
        "pct_paragraphs_over_4sent": round(sum(1 for c in para_sent_counts if c > 4) / max(1, len(paras)), 3),
        "pct_paragraphs_over_90w": round(sum(1 for w in para_word_lens if w > 90) / max(1, len(paras)), 3),
        # coherence proxies (heuristic)
        "dangling_numeric_refs": dangling,
        "dangling_numeric_ref_count": len(dangling),
        "crammed_paragraphs": crammed,
        "paragraph_initial_demonstratives": para_demo,
    }


def _dist(values: list[float]) -> dict:
    if not values:
        return {"n": 0, "median": 0, "mean": 0.0, "p25": 0, "p75": 0, "max": 0, "min": 0}
    s = sorted(values)
    return {
        "n": len(s),
        "median": round(statistics.median(s), 1),
        "mean": round(statistics.mean(s), 1),
        "p25": round(s[len(s) // 4], 1),
        "p75": round(s[(len(s) * 3) // 4], 1),
        "max": round(max(s), 1),
        "min": round(min(s), 1),
    }


def _resolve_data_root(explicit: Optional[str]) -> str:
    dr = explicit or os.environ.get("AI_TRIAD_DATA_ROOT")
    if dr:
        return dr
    here = os.path.abspath(os.getcwd())
    while True:
        cfg = os.path.join(here, ".aitriad.json")
        if os.path.isfile(cfg):
            try:
                with open(cfg, encoding="utf-8") as fh:
                    val = json.load(fh).get("data_root", "../ai-triad-data")
                return val if os.path.isabs(val) else os.path.normpath(os.path.join(here, val))
            except (OSError, ValueError):
                break
        parent = os.path.dirname(here)
        if parent == here:
            break
        here = parent
    return os.path.normpath(os.path.join(os.getcwd(), "..", "ai-triad-data"))


def compute(data_root: str) -> dict:
    files = sorted(glob.glob(os.path.join(data_root, "oped-sets", "*.json")))
    rows = []
    for f in files:
        with open(f, encoding="utf-8") as fh:
            doc = json.load(fh)
        outlet = (doc.get("params") or {}).get("outlet", "?")
        model = (doc.get("params") or {}).get("model", "?")
        for o in doc.get("opeds", []):
            m = measure_body(o.get("body", ""))
            m.update({
                "set_id": doc.get("set_id", ""),
                "pov": (o.get("pov") or "")[:3],
                "outlet": outlet,
                "model": model,
                "headline": o.get("headline", ""),
                "word_count": o.get("wordCount"),
            })
            rows.append(m)

    total = len(rows)
    # Partition: substantive op-eds vs empty/degenerate slots (failed/draft
    # generations). All stats below are over SUBSTANTIVE only; empties are a
    # separate data-quality count (their spurious FK ~ -15 would corrupt the mean).
    substantive = [r for r in rows if r["n_words"] >= MIN_SUBSTANTIVE_WORDS]
    empty = [r for r in rows if r["n_words"] < MIN_SUBSTANTIVE_WORDS]
    n = len(substantive)
    fk = [r["fk_grade"] for r in substantive]
    over_target = sum(1 for g in fk if g > FK_TARGET_HIGH)
    with_dangling = sum(1 for r in substantive if r["dangling_numeric_ref_count"] > 0)

    def by(key_fn):
        g = defaultdict(list)
        for r in substantive:
            g[key_fn(r)].append(r["fk_grade"])
        return {k: _dist(v) for k, v in sorted(g.items())}

    worst = sorted(substantive, key=lambda r: -r["fk_grade"])[:10]

    return {
        "metric": "oped_readability_coherence",
        "provenance": {"readability": "derived", "coherence": "heuristic-proxy"},
        "threshold": None,
        "target_fk_grade": [FK_TARGET_LOW, FK_TARGET_HIGH],
        "n_opeds": n,
        "n_opeds_total_slots": total,
        "empty_or_degenerate_slots": {"count": len(empty),
                                      "rate": round(len(empty) / total, 3) if total else None,
                                      "note": f"op-ed slots with < {MIN_SUBSTANTIVE_WORDS} words (empty/failed "
                                              "generations); excluded from stats, flagged as a data-quality signal"},
        "n_sets": len(files),
        "readability": {
            "fk_grade": _dist(fk),
            "over_target_fk": {"count": over_target, "rate": round(over_target / n, 3) if n else None,
                               "note": f"op-eds above the grade-{FK_TARGET_HIGH:.0f} op-ed ceiling"},
            "avg_sentence_len": _dist([r["avg_sentence_len"] for r in substantive]),
            "max_sentence_len": _dist([r["max_sentence_len"] for r in substantive]),
            "pct_sentences_over_30w": _dist([r["pct_sentences_over_30w"] for r in substantive]),
            "max_paragraph_words": _dist([r["max_paragraph_words"] for r in substantive]),
            "pct_paragraphs_over_90w": _dist([r["pct_paragraphs_over_90w"] for r in substantive]),
        },
        "coherence_proxies": {
            "_caveat": "HEURISTIC proxies, not validated metrics. High precision / low recall; "
                       "informs the edit pass and spot-checks, does NOT gate.",
            "opeds_with_dangling_numeric_ref": {"count": with_dangling,
                                                 "rate": round(with_dangling / n, 3) if n else None},
            "dangling_numeric_ref_count": _dist([r["dangling_numeric_ref_count"] for r in substantive]),
            "crammed_paragraphs_per_oped": _dist([r["crammed_paragraphs"] for r in substantive]),
            "paragraph_initial_demonstratives_per_oped": _dist([r["paragraph_initial_demonstratives"] for r in substantive]),
        },
        "by_pov_fk": by(lambda r: r["pov"]),
        "by_outlet_fk": by(lambda r: r["outlet"]),
        "worst_by_fk": [{"set_id": r["set_id"], "pov": r["pov"], "outlet": r["outlet"],
                         "fk_grade": r["fk_grade"], "avg_sentence_len": r["avg_sentence_len"],
                         "dangling_numeric_ref_count": r["dangling_numeric_ref_count"],
                         "headline": r["headline"]} for r in worst],
        "_rows": substantive,
        "_empty_rows": [{"set_id": r["set_id"], "pov": r["pov"], "outlet": r["outlet"]} for r in empty],
    }


def _print_summary(rep: dict) -> None:
    print(f"=== op-ed readability + coherence (N={rep['n_opeds']} substantive op-eds, "
          f"{rep['n_sets']} sets; {rep['n_opeds_total_slots']} total slots) ===")
    es = rep["empty_or_degenerate_slots"]
    print(f"DATA QUALITY: {es['count']}/{rep['n_opeds_total_slots']} slots empty/degenerate ({es['rate']:.0%}) - excluded")
    rd = rep["readability"]
    fk = rd["fk_grade"]
    print(f"FK grade: median {fk['median']} mean {fk['mean']} max {fk['max']} "
          f"(target {rep['target_fk_grade'][0]:.0f}-{rep['target_fk_grade'][1]:.0f})")
    ot = rd["over_target_fk"]
    print(f"  over target: {ot['count']}/{rep['n_opeds']} ({ot['rate']:.0%})")
    print(f"  avg sentence len: median {rd['avg_sentence_len']['median']} max {rd['max_sentence_len']['max']} words")
    print(f"  max paragraph words: median {rd['max_paragraph_words']['median']} max {rd['max_paragraph_words']['max']}")
    cp = rep["coherence_proxies"]
    print(f"COHERENCE PROXIES (heuristic, not gating):")
    dr = cp["opeds_with_dangling_numeric_ref"]
    print(f"  op-eds with a dangling numeric reference: {dr['count']}/{rep['n_opeds']} ({dr['rate']:.0%})")
    print(f"  crammed paragraphs/op-ed: median {cp['crammed_paragraphs_per_oped']['median']} "
          f"max {cp['crammed_paragraphs_per_oped']['max']}")
    print("by POV (FK median):", {k: v["median"] for k, v in rep["by_pov_fk"].items()})
    print("worst 3 by FK:")
    for r in rep["worst_by_fk"][:3]:
        print(f"  {r['fk_grade']} [{r['pov']}/{r['outlet']}] dangling={r['dangling_numeric_ref_count']}  {r['headline'][:60]}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Measure op-ed readability + coherence (t/3696).")
    ap.add_argument("--data-root", default=None)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "oped-quality-baseline.json"))
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    data_root = _resolve_data_root(args.data_root)
    report = compute(data_root)
    report["_data_root"] = data_root

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
        fh.write("\n")
    if not args.quiet:
        _print_summary(report)
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
