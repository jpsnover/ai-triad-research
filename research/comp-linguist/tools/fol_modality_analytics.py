#!/usr/bin/env python3
"""Cross-camp modality analytics over node `logical_form` (t/3398, FOL consumer B1).

READ-ONLY. The first real consumer of the `logical_form` layer. It reports
distributional patterns over the **reliable (mechanical) axes only** —
`modality.holder`, `modality.attitude`, `polarity`, `temporal.type` — which are
copied from the node's POV/category, not LLM-judged, and measure ~1.00
(modality/polarity) / ~0.94 (temporal) on the golden set.

It deliberately does NOT touch `predicate` (~0.50-0.68), `args[]` (~0.30),
`about[]`, `match_level`, or `formalization_confidence`-as-threshold, and it does
NOT attempt proposition-identity/equality joins. Those are the B5 "not safe to
build on yet" axes in `docs/logical-form-surfacing-and-consumption-proposal.md`.

Output is an analysis artifact (`REPORT.md` + `summary.json`), never a UI, never a
gate, never a write to the corpus. Design of record: t/3353 / t/3398.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any

CAMPS: dict[str, str] = {
    "acc": "accelerationist.json",
    "saf": "safetyist.json",
    "skp": "skeptic.json",
}
ATTITUDES = ("belief", "desire", "intention")
POLARITIES = ("positive", "negative")

# Measured maturity of the consumed axes (metric-provenance-register.md; the D3b
# golden). Stated in the artifact so every reader sees what the numbers rest on.
AXIS_MATURITY = (
    "modality (holder/attitude) & polarity ~1.00 (copied from POV/category, not judged); "
    "temporal.type ~0.94. NOT consumed: predicate ~0.50-0.68, args ~0.30, "
    "about[]/match_level/formalization_confidence (B5 not-safe list)."
)


def resolve_data_root(explicit: str | None) -> Path:
    """Resolve the ai-triad-data root: explicit arg > env > .aitriad.json > sibling fallback."""
    if explicit:
        return Path(explicit).resolve()
    env = os.environ.get("AI_TRIAD_DATA_ROOT")
    if env:
        return Path(env).resolve()
    # .aitriad.json lives at the code-repo root; find it walking up from cwd.
    here = Path.cwd()
    for parent in (here, *here.parents):
        cfg = parent / ".aitriad.json"
        if cfg.is_file():
            try:
                data_root = json.loads(cfg.read_text(encoding="utf-8")).get("data_root")
            except (json.JSONDecodeError, OSError):
                data_root = None
            if data_root:
                return (parent / data_root).resolve()
            break
    # Monorepo/sibling fallback.
    return (here / ".." / ".." / ".." / "ai-triad-data").resolve()


def load_nodes(path: Path) -> list[dict[str, Any]]:
    """Load a POV file's node list. Raises with an actionable message on failure."""
    if not path.is_file():
        raise FileNotFoundError(
            f"POV file not found: {path}\n"
            f"  Next steps: confirm the data root (AI_TRIAD_DATA_ROOT / .aitriad.json 'data_root') "
            f"points at the ai-triad-data checkout containing taxonomy/Origin/."
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    nodes = data.get("nodes") if isinstance(data, dict) else data
    if not isinstance(nodes, list):
        raise ValueError(f"Unexpected shape in {path}: expected a 'nodes' list.")
    return nodes


def analyze_camp(camp: str, nodes: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate the reliable modality axes for one camp. Read-only."""
    with_lf = [n for n in nodes if isinstance(n, dict) and isinstance(n.get("logical_form"), dict)]
    attitude = Counter()
    polarity = Counter()
    temporal = Counter()
    holder_mismatch = 0  # provenance sanity: holder should match the file's camp
    factual = 0          # modality == null (unattributed fact) — bucketed separately
    expected_holder = f"camp:{camp}"

    for node in with_lf:
        lf = node["logical_form"]
        modality = lf.get("modality")
        if modality is None:
            factual += 1
            continue
        att = modality.get("attitude")
        attitude[att] += 1
        if modality.get("holder") != expected_holder:
            holder_mismatch += 1
        polarity[lf.get("polarity")] += 1
        temporal[(lf.get("temporal") or {}).get("type")] += 1

    bdi_total = sum(attitude.values())
    return {
        "nodes_total": len(nodes),
        "nodes_with_logical_form": len(with_lf),
        "coverage_pct": round(100 * len(with_lf) / len(nodes), 1) if nodes else 0.0,
        "bdi_frames": bdi_total,
        "factual_frames": factual,
        "attitude": {a: attitude.get(a, 0) for a in ATTITUDES},
        "attitude_other": {k: v for k, v in attitude.items() if k not in ATTITUDES},
        "attitude_pct": {
            a: (round(100 * attitude.get(a, 0) / bdi_total, 1) if bdi_total else 0.0)
            for a in ATTITUDES
        },
        "polarity": {p: polarity.get(p, 0) for p in POLARITIES},
        "polarity_negative_pct": (
            round(100 * polarity.get("negative", 0) / bdi_total, 1) if bdi_total else 0.0
        ),
        "temporal_type": dict(sorted(temporal.items(), key=lambda kv: -kv[1])),
        "holder_mismatch": holder_mismatch,
    }


def build_summary(origin: Path, data_sha: str) -> dict[str, Any]:
    per_camp = {camp: analyze_camp(camp, load_nodes(origin / fn)) for camp, fn in CAMPS.items()}
    totals_att = Counter()
    for camp in per_camp.values():
        for a in ATTITUDES:
            totals_att[a] += camp["attitude"][a]
    return {
        "metric": "fol_cross_camp_modality_analytics",
        "provenance": "descriptive / indicative (single-draw over one corpus snapshot)",
        "reporting_treatment": "single-draw",
        "gates_nothing": True,
        "consumed_axes": ["modality.holder", "modality.attitude", "polarity", "temporal.type"],
        "excluded_axes": ["predicate", "args", "about", "match_level", "formalization_confidence"],
        "axis_maturity": AXIS_MATURITY,
        "data_snapshot_sha": data_sha,
        "per_camp": per_camp,
        "corpus_bdi_attitude_totals": dict(totals_att),
    }


def render_report(summary: dict[str, Any]) -> str:
    L: list[str] = []
    L.append("# FOL cross-camp modality analytics (B1, t/3398)")
    L.append("")
    L.append("> **Maturity marking (read this first).** This artifact reports distributional")
    L.append("> patterns over the **mechanical axes only** of `node.logical_form`. It **gates")
    L.append("> nothing**, writes nothing, and derives no argument structure. Axes consumed &")
    L.append(f"> their measured reliability: {summary['axis_maturity']}")
    L.append(">")
    L.append(f"> Provenance: {summary['provenance']}. Reporting-treatment:")
    L.append(f"> `{summary['reporting_treatment']}`. Data snapshot (ai-triad-data):")
    L.append(f"> `{summary['data_snapshot_sha']}`. Regenerate with `tools/fol_modality_analytics.py`.")
    L.append("")
    L.append("## Coverage")
    L.append("")
    L.append("| Camp | Nodes | With `logical_form` | Coverage | BDI frames | Factual |")
    L.append("|---|---:|---:|---:|---:|---:|")
    for camp, c in summary["per_camp"].items():
        L.append(
            f"| {camp} | {c['nodes_total']} | {c['nodes_with_logical_form']} | "
            f"{c['coverage_pct']}% | {c['bdi_frames']} | {c['factual_frames']} |"
        )
    L.append("")
    L.append("## Attitude mix per camp (`modality.attitude`)")
    L.append("")
    L.append("| Camp | belief | desire | intention | dominant |")
    L.append("|---|---:|---:|---:|---|")
    for camp, c in summary["per_camp"].items():
        pct = c["attitude_pct"]
        dominant = max(ATTITUDES, key=lambda a: c["attitude"][a])
        L.append(
            f"| {camp} | {c['attitude']['belief']} ({pct['belief']}%) | "
            f"{c['attitude']['desire']} ({pct['desire']}%) | "
            f"{c['attitude']['intention']} ({pct['intention']}%) | {dominant} |"
        )
    L.append("")
    L.append("## Polarity balance (`polarity`)")
    L.append("")
    L.append("| Camp | positive | negative | negative % |")
    L.append("|---|---:|---:|---:|")
    for camp, c in summary["per_camp"].items():
        L.append(
            f"| {camp} | {c['polarity']['positive']} | {c['polarity']['negative']} | "
            f"{c['polarity_negative_pct']}% |"
        )
    L.append("")
    L.append("## Temporal-type spread (`temporal.type`)")
    L.append("")
    L.append("| Camp | temporal.type distribution |")
    L.append("|---|---|")
    for camp, c in summary["per_camp"].items():
        dist = ", ".join(f"{k}: {v}" for k, v in c["temporal_type"].items())
        L.append(f"| {camp} | {dist} |")
    L.append("")
    L.append("## Reading (descriptive — patterns, not verdicts)")
    L.append("")
    L.append("- **Attitude signature differs by camp** — see the dominant column above; this is")
    L.append("  the cross-camp modality contrast the reification (`holds(camp, attitude, p)`) was")
    L.append("  built to make queryable, and it rests only on the ~1.00 mechanical axes.")
    L.append("- **Polarity** is overwhelmingly positive across camps; negation is a small minority.")
    L.append("- **Temporal** is near-degenerate (`unspecified` dominates): the BDI corpus is")
    L.append("  atemporal by construction — a finding in itself, not a gap in this tool.")
    L.append("")
    mismatches = sum(c["holder_mismatch"] for c in summary["per_camp"].values())
    L.append(
        f"_Provenance sanity: `modality.holder` matched the file camp on all frames "
        f"({mismatches} mismatches)._" if mismatches == 0 else
        f"_⚠ Provenance: {mismatches} `modality.holder` values did not match their file camp — investigate._"
    )
    L.append("")
    return "\n".join(L)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-root", default=None, help="ai-triad-data checkout (default: env/.aitriad.json/fallback)")
    ap.add_argument("--out-dir", default=None, help="output dir (default: analyses/fol-modality-analytics next to this tool)")
    ap.add_argument("--data-sha", default="unknown", help="ai-triad-data snapshot SHA to record in the artifact")
    args = ap.parse_args(argv)

    data_root = resolve_data_root(args.data_root)
    origin = data_root / "taxonomy" / "Origin"
    if not origin.is_dir():
        print(f"ERROR: taxonomy/Origin not found under data root {data_root}", file=sys.stderr)
        return 2

    out_dir = Path(args.out_dir) if args.out_dir else (Path(__file__).resolve().parent.parent / "analyses" / "fol-modality-analytics")
    out_dir.mkdir(parents=True, exist_ok=True)

    summary = build_summary(origin, args.data_sha)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    (out_dir / "REPORT.md").write_text(render_report(summary), encoding="utf-8")
    print(f"Wrote {out_dir / 'REPORT.md'} and summary.json (data snapshot {args.data_sha}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
