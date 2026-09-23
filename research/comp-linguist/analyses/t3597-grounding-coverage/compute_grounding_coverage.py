#!/usr/bin/env python3
"""Grounding-coverage calibration metric (t/3597).

Measures what fraction of the belief graph is traceable to a primary source, a
signal that is otherwise invisible: nothing in the pipeline records the
belief->source coverage gap, so the provenance audit (p/314) had to compute it
ad hoc. This makes it a re-runnable, tracked calibration instrument.

Metric family (all DERIVED from corpus link structure -- no stipulated
threshold; see the provenance register). Report the distribution first; do NOT
attach a pass/fail cut until one is chosen deliberately.

  1. grounding_coverage_rate    -- % of BDI nodes with >=1 resolvable
                                   primary-source citation, per POV and overall.
  2. sources_per_covered_node   -- distribution over *live covered* nodes only
                                   (median / mean / max / quartiles).
  3. synthetic_only_count       -- nodes with ZERO factual_claim/key_point links,
                                   grounded solely by the synthetic graph_attributes
                                   fields (debate_grounding / attribution_text /
                                   intellectual_lineage).

Provenance model (v1): the node-side source index does not exist yet (t/3596),
so coverage is computed by INVERTING the summaries that already carry the links:

    summary.pov_summaries[pov].key_points[].taxonomy_node_id          (1 node)
    summary.factual_claims[].linked_taxonomy_nodes[]                  (0..n nodes)

Each linked node is credited to the summary's source (doc_id). A source counts
only if it RESOLVES to <sources_root>/<doc_id>/metadata.json.

When t/3596 lands, flip READ_FROM_NODE_INDEX=True to read node.graph_attributes.
sources[] directly instead of inverting; the report shape is unchanged so the
series stays comparable (the inversion here is the same aggregation t/3596
materializes onto the node).

CAVEAT (encoded, never suppressed): the corpus `extraction_confidence` is
LLM-self-reported and saturated near ceiling -- it is NOT a calibrated
reliability signal and must never be presented as one. The script reports its
saturation so the false-precision is a visible, countable property.

Run from anywhere:  python compute_grounding_coverage.py [--data-root DIR]
                    [--sources-root DIR] [--out PATH] [--quiet]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import statistics
from collections import Counter, defaultdict
from typing import Optional

# --- POV taxonomy files and their node-ID prefixes ---------------------------
POV_FILES = {"acc": "accelerationist.json", "saf": "safetyist.json", "skp": "skeptic.json"}
POVS = ("acc", "saf", "skp")

# Synthetic (non-primary-source) grounding fields under graph_attributes. A node
# grounded ONLY by these -- with no summary link -- is "synthetic-only".
SYNTHETIC_GROUNDING_FIELDS = ("debate_grounding", "attribution_text", "intellectual_lineage")

# Flip when t/3596 materializes node.graph_attributes.sources[]. Until then the
# node-side index does not exist and coverage is computed by inverting summaries.
READ_FROM_NODE_INDEX = False


def _load_json(path: str) -> dict:
    """Read a JSON file under a context manager (no leaked file descriptors)."""
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def resolve_roots(data_root: Optional[str], sources_root: Optional[str]) -> tuple[str, str]:
    """Resolve the data/sources roots. Priority: explicit arg > AI_TRIAD_DATA_ROOT
    env var > .aitriad.json (walked up from cwd) > monorepo sibling fallback."""
    repo = _find_up(".aitriad.json")
    cfg = {}
    if repo:
        try:
            with open(os.path.join(repo, ".aitriad.json"), encoding="utf-8") as fh:
                cfg = json.load(fh)
        except (OSError, ValueError):
            cfg = {}

    def _abs(base: str, val: str) -> str:
        return val if os.path.isabs(val) else os.path.normpath(os.path.join(base, val))

    dr = data_root or os.environ.get("AI_TRIAD_DATA_ROOT")
    if not dr:
        dr = _abs(repo or ".", cfg.get("data_root", "../ai-triad-data"))
    sr = sources_root or os.environ.get("AI_TRIAD_SOURCES_ROOT")
    if not sr:
        # Repo convention: sources lives beside data (both `../` siblings of the
        # repo). Derive it from the resolved data_root rather than from the
        # .aitriad.json relative path -- inside a git worktree that relative path
        # resolves against the worktree and mis-points to `.worktrees/ai-triad-sources`.
        sources_base = os.path.basename(cfg.get("sources_root", "../ai-triad-sources").rstrip("/\\"))
        sr = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(dr)), sources_base))
    return dr, sr


def _find_up(name: str) -> Optional[str]:
    """Walk up from cwd looking for a directory containing `name`."""
    d = os.path.abspath(os.getcwd())
    while True:
        if os.path.isfile(os.path.join(d, name)):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def load_live_nodes(data_root: str) -> dict[str, dict]:
    """Return {node_id: node} for all live BDI nodes across the three POV files.
    'Belief graph' here is all BDI nodes (Beliefs + Intentions + Desires), matching
    the audit's 959-node universe -- not the Beliefs category alone."""
    nodes: dict[str, dict] = {}
    for fname in POV_FILES.values():
        path = os.path.join(data_root, "taxonomy", "Origin", fname)
        doc = _load_json(path)
        for node in doc["nodes"]:
            nodes[node["id"]] = node
    return nodes


def invert_summaries(data_root: str) -> tuple[dict[str, set], dict[str, set], dict[str, set]]:
    """Invert every summary's links into node_id -> {source doc_id}. Returns
    (all_links, key_point_links, factual_claim_links). Keys may include stale
    node-ids not present in the live taxonomy; the caller filters to live nodes."""
    all_links: dict[str, set] = defaultdict(set)
    kp_links: dict[str, set] = defaultdict(set)
    fc_links: dict[str, set] = defaultdict(set)
    for path in glob.glob(os.path.join(data_root, "summaries", "*.json")):
        doc = _load_json(path)
        doc_id = doc.get("doc_id") or os.path.splitext(os.path.basename(path))[0]
        for _pov, block in (doc.get("pov_summaries") or {}).items():
            for kp in (block.get("key_points") or []):
                nid = kp.get("taxonomy_node_id")
                if nid:
                    all_links[nid].add(doc_id)
                    kp_links[nid].add(doc_id)
        for fc in (doc.get("factual_claims") or []):
            for nid in (fc.get("linked_taxonomy_nodes") or []):
                if nid:
                    all_links[nid].add(doc_id)
                    fc_links[nid].add(doc_id)
    return all_links, kp_links, fc_links


def make_resolver(sources_root: str):
    """A source counts only if <sources_root>/<doc_id>/metadata.json exists. Cached."""
    cache: dict[str, bool] = {}

    def resolves(doc_id: str) -> bool:
        if doc_id not in cache:
            cache[doc_id] = os.path.isfile(os.path.join(sources_root, doc_id, "metadata.json"))
        return cache[doc_id]

    return resolves


def _dist(values: list[int]) -> dict:
    """Summary stats for a list of counts (empty -> zeros)."""
    if not values:
        return {"n": 0, "median": 0, "mean": 0.0, "max": 0, "min": 0, "p25": 0, "p75": 0}
    s = sorted(values)
    return {
        "n": len(s),
        "median": statistics.median(s),
        "mean": round(statistics.mean(s), 2),
        "max": max(s),
        "min": min(s),
        "p25": s[len(s) // 4],
        "p75": s[(len(s) * 3) // 4],
    }


def _pov_of(node_id: str) -> Optional[str]:
    for pov in POVS:
        if node_id.startswith(pov + "-"):
            return pov
    return None


def compute(data_root: str, sources_root: str) -> dict:
    nodes = load_live_nodes(data_root)
    all_links, kp_links, fc_links = invert_summaries(data_root)
    resolves = make_resolver(sources_root)

    if READ_FROM_NODE_INDEX:  # pragma: no cover - flips when t/3596 lands
        raise NotImplementedError(
            "graph_attributes.sources[] read path awaits t/3596 (node-side index)."
        )

    # Resolvable sources per LIVE node (the metric universe).
    resolvable_sources: dict[str, set] = {}
    for nid in nodes:
        srcs = {d for d in all_links.get(nid, ()) if resolves(d)}
        resolvable_sources[nid] = srcs

    # 1. Coverage per POV + overall.
    per = {pov: {"covered": 0, "total": 0} for pov in POVS}
    for nid in nodes:
        pov = _pov_of(nid)
        if pov is None:
            continue
        per[pov]["total"] += 1
        if resolvable_sources[nid]:
            per[pov]["covered"] += 1
    for pov in POVS:
        t = per[pov]["total"]
        per[pov]["rate"] = round(per[pov]["covered"] / t, 4) if t else None
    tot_cov = sum(per[p]["covered"] for p in POVS)
    tot_n = sum(per[p]["total"] for p in POVS)

    # 2. sources-per-covered-node distribution -- LIVE covered nodes only.
    #    (The p/314 audit computed this over ALL linked ids incl. stale ones,
    #    which pollutes it downward; see the register / README.)
    covered_counts = [len(resolvable_sources[nid]) for nid in nodes if resolvable_sources[nid]]

    # 3. synthetic-only: zero summary links, but >=1 synthetic grounding field.
    uncovered = [nid for nid in nodes if not resolvable_sources[nid]]
    synthetic_only = 0
    truly_ungrounded = 0
    for nid in uncovered:
        ga = nodes[nid].get("graph_attributes") or {}
        if any(ga.get(f) for f in SYNTHETIC_GROUNDING_FIELDS):
            synthetic_only += 1
        else:
            truly_ungrounded += 1

    # Diagnostics: stale-link contamination + the audit's stale-polluted view.
    stale_ids = sorted(nid for nid in all_links if nid not in nodes)
    all_linked_counts = [
        len({d for d in srcs if resolves(d)}) for srcs in all_links.values()
    ]
    all_linked_counts = [c for c in all_linked_counts if c]  # drop ids whose sources don't resolve

    # extraction_confidence saturation caveat (LLM-self-reported, not calibrated).
    conf_vals: list[float] = []
    for path in glob.glob(os.path.join(data_root, "summaries", "*.json")):
        doc = _load_json(path)
        items = list(doc.get("factual_claims") or [])
        for _pov, block in (doc.get("pov_summaries") or {}).items():
            items += block.get("key_points") or []
        for it in items:
            v = it.get("extraction_confidence")
            if v is None:
                continue
            try:
                conf_vals.append(float(v))
            except (TypeError, ValueError):
                pass  # non-numeric confidences are ignored, not silently counted

    return {
        "metric": "grounding_coverage",
        "provenance": "derived",
        "threshold": None,
        "source_model": "summary-inversion (v1; t/3596 will switch to graph_attributes.sources)",
        "universe": "all live BDI nodes (Beliefs + Intentions + Desires)",
        "coverage": {
            "per_pov": {pov: per[pov] for pov in POVS},
            "overall": {
                "covered": tot_cov,
                "total": tot_n,
                "rate": round(tot_cov / tot_n, 4) if tot_n else None,
            },
        },
        "sources_per_covered_node": _dist(covered_counts),
        "synthetic_only": {
            "count": synthetic_only,
            "rate": round(synthetic_only / tot_n, 4) if tot_n else None,
            "truly_ungrounded": truly_ungrounded,
            "note": "synthetic-only == uncovered nodes carrying >=1 synthetic grounding field",
        },
        "diagnostics": {
            "summaries_scanned": len(glob.glob(os.path.join(data_root, "summaries", "*.json"))),
            "distinct_live_nodes_linked": sum(1 for nid in nodes if all_links.get(nid)),
            "stale_linked_ids": len(stale_ids),
            "stale_note": (
                "node-ids linked by summaries but absent from the live taxonomy "
                "(companion cleanup: t/3596). Excluded from coverage by construction."
            ),
            "sources_per_ALL_linked_id_incl_stale": _dist(all_linked_counts),
            "sources_per_ALL_linked_note": (
                "reproduces the p/314 audit's stale-polluted distribution; the "
                "authoritative metric is sources_per_covered_node (live-only)."
            ),
        },
        "extraction_confidence_caveat": {
            "n": len(conf_vals),
            "mean": round(statistics.mean(conf_vals), 3) if conf_vals else None,
            "median": statistics.median(conf_vals) if conf_vals else None,
            "min": min(conf_vals) if conf_vals else None,
            "frac_ge_0_9": round(sum(v >= 0.9 for v in conf_vals) / len(conf_vals), 3)
            if conf_vals
            else None,
            "note": (
                "LLM-self-reported and saturated near ceiling -- NOT a calibrated "
                "reliability signal; never present as reliability."
            ),
        },
    }


def _print_summary(rep: dict) -> None:
    cov = rep["coverage"]
    print("=== grounding-coverage (derived; no threshold) ===")
    for pov in POVS:
        p = cov["per_pov"][pov]
        print(f"  {pov}: {p['covered']}/{p['total']} = {p['rate']:.1%}")
    o = cov["overall"]
    print(f"  OVERALL: {o['covered']}/{o['total']} = {o['rate']:.1%}")
    d = rep["sources_per_covered_node"]
    print(f"sources/covered-node (live): median {d['median']} mean {d['mean']} max {d['max']}")
    s = rep["synthetic_only"]
    print(f"synthetic-only: {s['count']} ({s['rate']:.1%}); truly ungrounded: {s['truly_ungrounded']}")
    diag = rep["diagnostics"]
    print(f"stale linked ids (excluded): {diag['stale_linked_ids']}")
    c = rep["extraction_confidence_caveat"]
    print(f"extraction_confidence: mean {c['mean']} median {c['median']} "
          f">=0.9 {c['frac_ge_0_9']:.1%}  (self-reported, NOT reliability)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Compute the grounding-coverage metric (t/3597).")
    ap.add_argument("--data-root", default=None)
    ap.add_argument("--sources-root", default=None)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__),
                                                  "grounding-coverage-baseline.json"))
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    data_root, sources_root = resolve_roots(args.data_root, args.sources_root)
    report = compute(data_root, sources_root)
    report["_roots"] = {"data_root": data_root, "sources_root": sources_root}

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
        fh.write("\n")
    if not args.quiet:
        _print_summary(report)
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
