#!/usr/bin/env python3
# t/2963 — build NON-VACUOUS clean diff-mode controls for the rationale-degradation detector.
#
# WHY. The t/2948 both-arms evidence validated `flag_standalone` on 25 real observed rows, but the
# two TRANSITION signals (`length_collapse`, `referent_loss`) were exercised on almost no clean
# data: the only real non-empty->non-empty revisions in git history (3673d3ee->ba3128f5) are
# ENrichments (new ~2x longer), which are structurally incapable of tripping a COLLAPSE rule — a
# near-vacuous control. Yet AC#2 (the t/2946 restore-verifier run) is ENTIRELY diff mode. So the
# mode used in anger had the thinnest FP evidence. This builds the missing controls.
#
# WHAT. A clean control is a GENUINE, FAITHFUL paraphrase of a real edge's rationale that PRESERVES
# the semantic content (key content words + node-id/quoted referents) while shrinking the character
# count. A faithful compression MUST NOT be flagged — that is the false-positive the detector must
# avoid. We author 3 paraphrases per source at three compression targets (mild ~0.85x, moderate
# ~0.70x, aggressive-but-faithful ~0.55x) across 7 diverse real sources = 21 controls, so every
# ratio band carries n>=7 draws (a DISTRIBUTION, not a point estimate — R-1 reasoning, p/250#80).
#
# PROVENANCE (t/2294 + p/250#80). The `old` side is `observed` (byte-exact from ba3128f5). The
# paraphrases are `constructed` — hand-authored by the CL for faithfulness; that judgement is the
# stipulated part. The 0.55x/0.70x/0.85x target band is CHOSEN BY CONSTRUCTION to bracket the
# COLLAPSE_RATIO=0.5 boundary from above — it is **stipulated**, not derived from the distribution.
# (COLLAPSE_RATIO=0.5 itself stays `derived` — enrichment ratio ~2.0 => <0.5 is the collapse floor.)

import json, re, subprocess, os

DATA = os.environ.get("AI_TRIAD_DATA_ROOT", r"C:\Users\jsnov\repos\ai-triad-data")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "diff_controls.json")   # relative to this script — regenerable anywhere


def edges_at(ref):
    out = subprocess.run(["git", "-C", DATA, "show", f"{ref}:taxonomy/Origin/edges.json"],
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"git show {ref} failed: {out.stderr.strip()[:200]}")
    return json.loads(out.stdout)["edges"]


def rat(e):
    r = e.get("rationale")
    return r if isinstance(r, str) and r.strip() else None


def key(e):
    return "|".join(x or "" for x in (e.get("source"), e.get("target"), e.get("type")))


# Faithful paraphrases, authored by the CL. Keyed by source|target|type. Each list is
# [mild ~0.85x, moderate ~0.70x, aggressive-but-faithful ~0.55x]. Every paraphrase keeps the
# source's node-id/quoted referents and its key content nouns — it is a legitimate rewrite, NOT a
# degradation, so the detector MUST stay quiet on all of them.
PARAPHRASES = {
    "saf-beliefs-207|skp-beliefs-035|SUPPORTS": [
        "The belief in AI's evolutionary mismatch (skp-beliefs-035) supports the concern about skill decay by highlighting a scenario where AI systems could fail, making human reliance and subsequent skill loss more critical.",
        "AI's evolutionary mismatch (skp-beliefs-035) supports the skill-decay concern: it describes a failure scenario for AI systems that makes human reliance and skill loss more critical.",
        "AI's evolutionary mismatch (skp-beliefs-035) grounds the skill-decay concern by describing an AI-failure scenario that heightens human reliance and skill loss.",
    ],
    "saf-beliefs-129|saf-beliefs-098|SUPPORTS": [
        "The 'Errant Tool Problem' (saf-intentions-073) describes a mechanism — literal interpretation over intent — that leads to the 'misinterpretation of objectives' and 'unpredictable AI behavior' highlighted in 'Unpredictable AI Behavior & Limitations' (saf-beliefs-098).",
        "The 'Errant Tool Problem' (saf-intentions-073) — literal interpretation over intent — is the mechanism producing the 'misinterpretation of objectives' and 'unpredictable AI behavior' of saf-beliefs-098.",
        "The 'Errant Tool Problem' (saf-intentions-073), literal interpretation over intent, drives the 'unpredictable AI behavior' and misread objectives of saf-beliefs-098.",
    ],
    "saf-beliefs-058|saf-beliefs-028|SUPPORTS": [
        "saf-beliefs-058 describes how AI coding assistants introduce novel vulnerabilities such as hallucinated packages, exemplifying the 'AI-Specific Attack Surface Expansion' detailed in saf-beliefs-028.",
        "saf-beliefs-058 shows AI coding assistants adding novel vulnerabilities like hallucinated packages — the 'AI-Specific Attack Surface Expansion' of saf-beliefs-028.",
        "saf-beliefs-058's hallucinated-package vulnerabilities exemplify the 'AI-Specific Attack Surface Expansion' of saf-beliefs-028.",
    ],
    "acc-intentions-009|acc-intentions-056|SUPPORTS": [
        "The source node's policy action to 'Resist regulatory frameworks justified primarily by catastrophic AI risk scenarios' supports the broader accelerationist critique of restrictive AI regulation.",
        "The policy of resisting 'regulatory frameworks justified primarily by catastrophic AI risk scenarios' supports the accelerationist critique of restrictive AI regulation.",
        "Resisting regulation 'justified primarily by catastrophic AI risk scenarios' supports the accelerationist critique of AI regulation.",
    ],
    "sit-238|skp-beliefs-008|SUPPORTS": [
        "'Swivel Chair Governance' illustrates the current reality of humans manually managing disparate AI tools, providing an empirical basis for the skeptic belief in the 'Emergence of Human AI-Management Roles', albeit in fragmented form.",
        "'Swivel Chair Governance' — humans manually managing disparate AI tools — is an empirical basis for the skeptic 'Emergence of Human AI-Management Roles', in inefficient fragmented form.",
        "'Swivel Chair Governance', humans manually juggling disparate AI tools, empirically grounds the 'Emergence of Human AI-Management Roles'.",
    ],
    "acc-beliefs-039|acc-intentions-036|SUPPORTS": [
        "Recursive automation of scientific discovery provides the technical capability and mechanism to implement continuous, dynamic strategic learning loops.",
        "Recursive automation of scientific discovery supplies the capability and mechanism for continuous, dynamic strategic learning loops.",
        "Recursive automation of scientific discovery enables continuous, dynamic strategic learning loops.",
    ],
    "sit-158|saf-beliefs-100|SUPPORTS": [
        "saf-beliefs-100 describes 'wide-ranging negative impacts of AI on human society, skills, and economic stability,' including deskilling, supporting the 'systemic risks' and 'skill obsolescence' highlighted in sit-158.",
        "saf-beliefs-100's 'wide-ranging negative impacts of AI on human society, skills, and economic stability' — deskilling — support the 'systemic risks' and 'economic shifts' in sit-158.",
        "saf-beliefs-100's deskilling and 'negative impacts on society, skills, and economic stability' support the 'systemic risks' of sit-158.",
    ],
}

# Extra near-boundary controls (~0.52-0.58x) from the longest sources — densify the 0.50-0.60 bin
# (closest to COLLAPSE_RATIO=0.5, the decision-relevant edge) so its FP rate is a distribution
# (n>=several), not a 2-draw point estimate. Still faithful: referents + core nouns preserved.
NEAR_BOUNDARY = {
    "saf-beliefs-129|saf-beliefs-098|SUPPORTS":
        "The 'Errant Tool Problem' (saf-intentions-073) — literal interpretation over intent — produces saf-beliefs-098's 'unpredictable AI behavior' and misread objectives.",
    "sit-238|skp-beliefs-008|SUPPORTS":
        "'Swivel Chair Governance' — humans manually managing disparate AI tools — grounds the skeptic 'Emergence of Human AI-Management Roles'.",
    "sit-158|saf-beliefs-100|SUPPORTS":
        "saf-beliefs-100's deskilling and 'negative impacts on society, skills, economic stability' underpin sit-158's 'systemic risks' and 'skill obsolescence'.",
    "saf-beliefs-207|skp-beliefs-035|SUPPORTS":
        "AI's evolutionary mismatch (skp-beliefs-035) grounds the skill-decay concern via an AI-failure scenario raising human reliance and skill loss.",
    "acc-intentions-009|acc-intentions-056|SUPPORTS":
        "The policy of resisting 'regulatory frameworks justified primarily by catastrophic AI risk scenarios' backs the accelerationist critique of AI regulation.",
}

TARGETS = ["~0.85x", "~0.70x", "~0.55x"]
TIER = ["mild", "moderate", "aggressive-but-faithful"]


def build_rows():
    """Return the diff-mode control rows (importable by build_sample.py — one regenerable pipeline)."""
    src_by = {key(e): rat(e) for e in edges_at("ba3128f5") if rat(e)}
    missing = [k for k in list(PARAPHRASES) + list(NEAR_BOUNDARY) if k not in src_by]
    if missing:
        raise SystemExit(f"source keys not found in ba3128f5 (edges may have moved): {missing}")
    rows = []
    for k, paras in PARAPHRASES.items():
        old = src_by[k]
        for i, new in enumerate(paras):
            rows.append({
                "label": "clean",
                "provenance": "constructed",     # paraphrase authored; old side observed
                "control": "diff_ratio",
                "source_key": k, "old": old, "new": new,
                "target_ratio": TARGETS[i],
                "actual_ratio": round(len(new) / max(1, len(old)), 3),
                "note": f"faithful {TIER[i]} paraphrase (target {TARGETS[i]}) — content + referents preserved, MUST NOT flag",
            })
    for k, new in NEAR_BOUNDARY.items():
        old = src_by[k]
        rows.append({
            "label": "clean", "provenance": "constructed", "control": "diff_ratio",
            "source_key": k, "old": old, "new": new,
            "target_ratio": "~0.55x",
            "actual_ratio": round(len(new) / max(1, len(old)), 3),
            "note": "faithful near-boundary paraphrase (target ~0.55x) — densifies the 0.50-0.60 bin, MUST NOT flag",
        })
    return rows


if __name__ == "__main__":
    rows = build_rows()
    json.dump(rows, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"wrote {len(rows)} diff-mode controls -> {OUT}")
    ratios = sorted(r["actual_ratio"] for r in rows)
    print(f"actual char-ratio span: min={ratios[0]} median={ratios[len(ratios)//2]} max={ratios[-1]}")
