#!/usr/bin/env python3
"""build_lf_golden_worksheet (t/3239): emit a human-labeling worksheet for the node.logical_form
golden set. G6 (t/3162) auto-populated 639 `logical_form` frames at status=proposed; NOTHING
downstream may trust a proposed frame until a golden set establishes formalization_accuracy. This
tool samples the population and renders each node's inputs + its auto-frame for a human to mark
correct / minor / wrong. It ASSERTS NO ground truth itself (root AGENTS.md: reproduce/label before
asserting a fixture's correctness) — the VERDICT column is blank for the human labeler.

Sampling is deterministic (sorted ids + even stride per stratum), so the golden set is stable and
re-runnable — no RNG. Strata = camp (acc|saf|skp) × category (Beliefs|Desires|Intentions), 9 cells;
default 5 per cell = 45 nodes. Companion scorer: score_lf_golden.py parses the labeled worksheet.

Usage:  python build_lf_golden_worksheet.py [--per-stratum 5] [--out PATH]
"""
import argparse, json, os, sys

sys.stdout.reconfigure(encoding="utf-8")

DATA_ROOT = os.environ.get("AI_TRIAD_DATA_ROOT") or os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "ai-triad-data")
ORIGIN = os.path.join(DATA_ROOT, "taxonomy", "Origin")
ORIGIN_FILES = ("accelerationist.json", "safetyist.json", "skeptic.json")
CATEGORIES = ("Beliefs", "Desires", "Intentions")
CAMPS = ("acc", "saf", "skp")


def load_entity_names():
    p = os.path.join(ORIGIN, "entities.json")
    if not os.path.exists(p):
        return {}
    with open(p, encoding="utf-8") as f:
        return {e["id"]: e.get("name", "") for e in json.load(f).get("entities", [])}


def load_grounded():
    """Return {(camp,category): [node, ...]} for nodes carrying a logical_form."""
    strata = {}
    for fn in ORIGIN_FILES:
        p = os.path.join(ORIGIN, fn)
        if not os.path.exists(p):
            sys.stderr.write(f"WARN fallback: origin file missing, skipped: {p} "
                             f"(reason: AI_TRIAD_DATA_ROOT unset/wrong)\n")
            continue
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        for n in data.get("nodes", []):
            if isinstance(n.get("logical_form"), dict):
                strata.setdefault((n["id"].split("-")[0], n.get("category", "?")), []).append(n)
    return strata


def sample_stratum(nodes, k):
    """Deterministic even-stride pick of k from nodes, sorted by id. Fewer than k -> all."""
    ordered = sorted(nodes, key=lambda n: n["id"])
    if len(ordered) <= k:
        return ordered
    stride = len(ordered) / k
    return [ordered[int(i * stride)] for i in range(k)]


def refs_line(node, names):
    parts = []
    for r in (node.get("entity_refs") or []):
        eid = r.get("ref", "")
        parts.append(f"{eid} ({names.get(eid, r.get('surface',''))})")
    for r in (node.get("concept_refs") or []):
        parts.append(f"{r.get('ref','')} ({r.get('surface','')})")
    return ", ".join(parts) if parts else "(none)"


def frame_block(lf):
    args = "; ".join(
        f"{a.get('role')} → {a.get('ref')} [{a.get('sort')}]" for a in (lf.get("args") or [])
    ) or "(none)"
    about = ", ".join(f"{a.get('ref')}" for a in (lf.get("about") or [])) or "(none)"
    mod = lf.get("modality") or {}
    return (
        f"- predicate: `{lf.get('predicate')}`  polarity: {lf.get('polarity')}\n"
        f"- args: {args}\n"
        f"- modality: holder={mod.get('holder')} attitude={mod.get('attitude')}\n"
        f"- about: {about}\n"
        f"- confidence: {lf.get('formalization_confidence')}"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-stratum", type=int, default=5)
    ap.add_argument("--out", default=r"C:\tmp\lf-golden-worksheet.md")
    args = ap.parse_args()

    names = load_entity_names()
    strata = load_grounded()
    picked = []
    for camp in CAMPS:
        for cat in CATEGORIES:
            picked.extend(sample_stratum(strata.get((camp, cat), []), args.per_stratum))

    lines = [
        "# logical_form golden-set labeling worksheet (t/3239)",
        "",
        "**How to label.** For each node, read the Proposition + Resolved refs, then judge whether the",
        "**Auto-frame** faithfully renders it. Edit the `VERDICT:` line to one of:",
        "",
        "- `correct` — predicate, args/roles, polarity, and modality all faithful",
        "- `minor` — right predicate + modality, but an arg role/sort/lit is off or one arg is missing",
        "- `wrong` — wrong predicate, inverted polarity, a stance verb left in (support/oppose/aim…), or nonsense",
        "",
        "Leave `VERDICT:` blank to skip a node (it's excluded from the score). Use `NOTES:` for the",
        "correction (e.g. `predicate should be 'lower' not 'support'`). Do not edit anything else —",
        "the scorer parses `## [N] <id>` headers and the `VERDICT:` / `NOTES:` lines only.",
        "",
        f"Sample: {args.per_stratum}/stratum × 9 strata = {len(picked)} nodes (deterministic).",
        "",
        "---",
        "",
    ]
    for i, n in enumerate(picked, 1):
        camp, cat = n["id"].split("-")[0], n.get("category", "?")
        prop = (n.get("label", "") + ". " + (n.get("description") or n.get("plain_description") or "")).strip()
        lines += [
            f"## [{i}] {n['id']}   (camp={camp}, category={cat})",
            f"**Proposition:** {prop}",
            f"**Resolved refs:** {refs_line(n, names)}",
            "**Auto-frame:**",
            frame_block(n["logical_form"]),
            "",
            "**VERDICT:** ",
            "**NOTES:** ",
            "",
            "---",
            "",
        ]

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"wrote {len(picked)} nodes to {args.out}")
    per = {(c, k): len(sample_stratum(strata.get((c, k), []), args.per_stratum))
           for c in CAMPS for k in CATEGORIES}
    print("per-stratum:", {f"{c}-{k}": v for (c, k), v in per.items()})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
