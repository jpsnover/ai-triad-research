#!/usr/bin/env python3
"""Edge-rationale quality harness (A' tranche, follows t/2444 remediation plan).

Screens AI-generated edge `rationale` text WITHOUT any hand-grading. Two layers:

  1. MECHANICAL (always run, deterministic, free): flags empty / too-short /
     too-long / label-restatement / low-novelty rationales. Pure heuristics.
  2. LLM-JUDGE (opt-in, costs tokens): this script does NOT call a model. With
     --emit-judge-prompts it renders one scoring prompt per edge to a JSONL that
     any backend can score; --judge-results merges the scored verdicts back so the
     report carries both mechanical flags and judge verdicts.

Provenance: every threshold here is STIPULATED (see the metric-provenance-register).
The judge verdict is a stipulated screen for obvious junk (empty, off-type,
label-restatement) — NOT a proof of rationale quality. Do not read a judge "pass"
as ground truth.

Usage:
  # mechanical-only report (free)
  python check_rationale_quality.py --edges <taxonomy/Origin/edges.json> \
      --taxdir <taxonomy/Origin> --out report.json

  # also render judge prompts for a later scoring run
  python check_rationale_quality.py --edges ... --taxdir ... \
      --emit-judge-prompts judge_prompts.jsonl

  # merge judge verdicts back into a combined report
  python check_rationale_quality.py --edges ... --taxdir ... \
      --judge-results judge_results.jsonl --out report.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

# ── Stipulated thresholds (provisional; see metric-provenance-register) ──────
MIN_CHARS = 40           # below this, a rationale is too thin to justify anything
MAX_CHARS = 400          # prompt asks for ~300; 400 is the hard ceiling
MIN_NOVEL_WORDS = 4      # content words not drawn from the two labels / edge type
RESTATEMENT_OVERLAP = 0.60  # share of rationale content words taken from the labels
RESTATEMENT_NOVEL_MAX = 6   # ...combined with few novel words = restatement

_STOP = {
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "its",
    "have", "has", "not", "but", "which", "their", "them", "they", "into",
    "than", "then", "also", "such", "more", "most", "can", "may", "will",
    "these", "those", "because", "while", "between", "both", "when", "who",
    "whom", "how", "why", "what", "where", "a", "an", "of", "to", "in", "on",
    "as", "is", "by", "or", "it", "be", "at", "so",
}


def content_tokens(text: str) -> list[str]:
    toks = re.findall(r"[a-z0-9]+", (text or "").lower())
    return [t for t in toks if len(t) >= 3 and t not in _STOP]


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def build_node_text(taxdir: Path) -> dict[str, dict[str, str]]:
    """id -> {label, desc}, mirroring Invoke-EdgeRationaleBackfill node resolution."""
    skip = {"edges.json", "embeddings.json", "policy_actions.json"}
    out: dict[str, dict[str, str]] = {}
    for f in sorted(taxdir.glob("*.json")):
        if f.name in skip:
            continue
        try:
            doc = load_json(f)
        except Exception:
            continue
        if not isinstance(doc, dict) or "nodes" not in doc:
            continue
        for n in doc.get("nodes") or []:
            if isinstance(n, dict) and "id" in n:
                out[n["id"]] = {
                    "label": str(n.get("label", "")),
                    "desc": str(n.get("description", "")),
                }
    return out


def edge_list(edges_doc) -> list[dict]:
    if isinstance(edges_doc, list):
        return edges_doc
    if isinstance(edges_doc, dict):
        for k in ("edges", "data"):
            v = edges_doc.get(k)
            if isinstance(v, list):
                return v
            if isinstance(v, dict) and isinstance(v.get("edges"), list):
                return v["edges"]
    return []


def type_defs(edges_doc) -> dict[str, str]:
    out: dict[str, str] = {}
    if isinstance(edges_doc, dict):
        for t in edges_doc.get("edge_types") or []:
            if isinstance(t, dict) and "type" in t:
                out[t["type"]] = str(t.get("definition", ""))
    return out


def mechanical_flags(rationale: str, src_label: str, tgt_label: str,
                     edge_type: str) -> list[str]:
    flags: list[str] = []
    r = (rationale or "").strip()
    if not r:
        return ["empty"]
    if len(r) < MIN_CHARS:
        flags.append("too_short")
    if len(r) > MAX_CHARS:
        flags.append("too_long")

    label_toks = set(content_tokens(src_label)) | set(content_tokens(tgt_label)) \
        | set(content_tokens(edge_type))
    r_toks = content_tokens(r)
    if r_toks:
        overlap = sum(1 for t in r_toks if t in label_toks) / len(r_toks)
        novel = [t for t in set(r_toks) if t not in label_toks]
        if len(novel) < MIN_NOVEL_WORDS:
            flags.append("low_novelty")
        if overlap >= RESTATEMENT_OVERLAP and len(novel) <= RESTATEMENT_NOVEL_MAX:
            flags.append("restatement")

    rl = r.lower()
    if src_label and src_label.lower() in rl and tgt_label and tgt_label.lower() in rl:
        flags.append("both_labels_verbatim")
    return flags


def render_judge_prompt(template: str, edge: dict, nodes: dict, tdefs: dict) -> str | None:
    src = nodes.get(edge.get("source"))
    tgt = nodes.get(edge.get("target"))
    if not src or not tgt:
        return None
    repl = {
        "EDGE_TYPE": str(edge.get("type", "")),
        "EDGE_TYPE_DEF": tdefs.get(edge.get("type", ""), "(see taxonomy edge-type vocabulary)"),
        "SOURCE_ID": str(edge.get("source", "")),
        "SOURCE_LABEL": src["label"],
        "SOURCE_DESC": src["desc"][:400],
        "TARGET_ID": str(edge.get("target", "")),
        "TARGET_LABEL": tgt["label"],
        "TARGET_DESC": tgt["desc"][:400],
        "RATIONALE": str(edge.get("rationale", "")),
    }
    out = template
    for k, v in repl.items():
        out = out.replace("{{" + k + "}}", v)
    return out


def edge_key(edge: dict) -> str:
    return f"{edge.get('source')}->{edge.get('target')} ({edge.get('type')})"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--edges", required=True, type=Path)
    ap.add_argument("--taxdir", required=True, type=Path,
                    help="taxonomy/Origin dir holding node JSON files")
    ap.add_argument("--out", type=Path, help="write JSON report here")
    ap.add_argument("--emit-judge-prompts", type=Path,
                    help="write one rendered judge prompt per rationaled edge (JSONL)")
    ap.add_argument("--judge-template", type=Path,
                    default=Path(__file__).with_name("judge-prompt.txt"))
    ap.add_argument("--judge-results", type=Path,
                    help="JSONL of {key, grounded, specific_to_type, not_restatement, "
                         "verdict} to merge into the report")
    ap.add_argument("--sample", type=int, default=15,
                    help="how many flagged examples to include in the report")
    args = ap.parse_args(argv)

    edges_doc = load_json(args.edges)
    edges = edge_list(edges_doc)
    nodes = build_node_text(args.taxdir)
    tdefs = type_defs(edges_doc)

    rationaled = [e for e in edges if isinstance(e, dict)
                  and str(e.get("rationale", "")).strip()]

    judge_map: dict[str, dict] = {}
    if args.judge_results and args.judge_results.exists():
        for line in args.judge_results.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                if "key" in rec:
                    judge_map[rec["key"]] = rec
            except json.JSONDecodeError:
                continue

    flag_counts: Counter = Counter()
    examples: list[dict] = []
    unresolved = 0
    per_edge: list[dict] = []
    for e in rationaled:
        src = nodes.get(e.get("source"), {})
        tgt = nodes.get(e.get("target"), {})
        if not src or not tgt:
            unresolved += 1
        flags = mechanical_flags(str(e.get("rationale", "")), src.get("label", ""),
                                 tgt.get("label", ""), str(e.get("type", "")))
        for f in flags:
            flag_counts[f] += 1
        rec = {"key": edge_key(e), "flags": flags,
               "rationale": str(e.get("rationale", ""))}
        jv = judge_map.get(edge_key(e))
        if jv:
            rec["judge"] = {k: jv.get(k) for k in
                            ("grounded", "specific_to_type", "not_restatement",
                             "verdict", "note")}
        per_edge.append(rec)
        if flags and len(examples) < args.sample:
            examples.append(rec)

    clean = sum(1 for r in per_edge if not r["flags"])
    judged = [r for r in per_edge if "judge" in r]
    judge_verdicts = Counter(r["judge"].get("verdict") for r in judged)

    report = {
        "edges_total": len(edges),
        "edges_with_rationale": len(rationaled),
        "node_text_unresolved": unresolved,
        "mechanical": {
            "clean": clean,
            "flagged": len(rationaled) - clean,
            "flag_counts": dict(flag_counts.most_common()),
            "thresholds": {
                "MIN_CHARS": MIN_CHARS, "MAX_CHARS": MAX_CHARS,
                "MIN_NOVEL_WORDS": MIN_NOVEL_WORDS,
                "RESTATEMENT_OVERLAP": RESTATEMENT_OVERLAP,
                "RESTATEMENT_NOVEL_MAX": RESTATEMENT_NOVEL_MAX,
            },
        },
        "judge": {
            "scored": len(judged),
            "verdicts": dict(judge_verdicts.most_common()),
        } if judged else None,
        "examples_flagged": examples,
        "provenance_note": "All thresholds STIPULATED (provisional). Judge verdict is "
                           "a junk screen, not a quality proof.",
    }

    if args.emit_judge_prompts:
        template = args.judge_template.read_text(encoding="utf-8")
        n = 0
        with args.emit_judge_prompts.open("w", encoding="utf-8") as fh:
            for e in rationaled:
                prompt = render_judge_prompt(template, e, nodes, tdefs)
                if prompt is None:
                    continue
                fh.write(json.dumps({"key": edge_key(e), "prompt": prompt},
                                    ensure_ascii=False) + "\n")
                n += 1
        report["judge_prompts_emitted"] = n

    text = json.dumps(report, indent=2, ensure_ascii=False)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    # Console summary (report always to stdout tail for quick read)
    m = report["mechanical"]
    print(f"rationaled edges: {report['edges_with_rationale']}/{report['edges_total']}")
    print(f"  mechanical clean: {m['clean']}  flagged: {m['flagged']}")
    print(f"  flag_counts: {m['flag_counts']}")
    if report["judge"]:
        print(f"  judge verdicts: {report['judge']['verdicts']}")
    if args.emit_judge_prompts:
        print(f"  judge prompts emitted: {report['judge_prompts_emitted']}")
    if args.out:
        print(f"report -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
