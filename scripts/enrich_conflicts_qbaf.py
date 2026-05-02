#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""
enrich_conflicts_qbaf.py — Compute QBAF argumentation strength for conflict files.

For each conflict with 2+ instances, builds a QBAF argument graph from the
competing claims, runs DF-QuAD propagation via qbaf-bridge.mjs, and writes
the QBAF analysis back into the conflict JSON file.

Conflicts with only 1 instance are skipped (no argument graph to compute).

Usage:
  python scripts/enrich_conflicts_qbaf.py                  # dry-run
  python scripts/enrich_conflicts_qbaf.py --write           # enrich in-place
  python scripts/enrich_conflicts_qbaf.py --write --id conflict-some-id  # single conflict
"""

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np

_SCRIPT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parent
_QBAF_BRIDGE = _SCRIPT_DIR / "qbaf-bridge.mjs"


def _resolve_data_root():
    config_path = _PROJECT_ROOT / ".aitriad.json"
    if config_path.exists():
        try:
            cfg = json.loads(config_path.read_text(encoding="utf-8"))
            data_root = cfg.get("data_root", ".")
            base = Path(data_root) if Path(data_root).is_absolute() else (_PROJECT_ROOT / data_root)
            return base.resolve()
        except (json.JSONDecodeError, OSError):
            pass
    return (_PROJECT_ROOT.parent / "ai-triad-data").resolve()


DATA_ROOT: Optional[Path] = None
CONFLICTS_DIR: Optional[Path] = None
TAXONOMY_DIR: Optional[Path] = None


def _log(msg):
    print(msg, file=sys.stderr)


def _load_taxonomy_nodes():
    """Load taxonomy node metadata for POV classification."""
    meta = {}
    for pov_name in ("accelerationist", "safetyist", "skeptic", "situations"):
        pov_path = TAXONOMY_DIR / f"{pov_name}.json"
        if not pov_path.exists():
            continue
        pov_data = json.loads(pov_path.read_text(encoding="utf-8"))
        for node in pov_data.get("nodes", []):
            meta[node["id"]] = {
                "pov": pov_name,
                "label": node.get("label", ""),
                "category": node.get("category", ""),
            }
    return meta


def _infer_pov(instance, linked_nodes, node_meta):
    """Infer which POV a claim instance belongs to based on linked taxonomy nodes."""
    doc_id = instance.get("doc_id", "")

    # Check linked nodes for POV hints
    pov_votes = {}
    for nid in linked_nodes:
        if nid in node_meta:
            pov = node_meta[nid]["pov"]
            pov_votes[pov] = pov_votes.get(pov, 0) + 1

    if pov_votes:
        # Return the most-linked POV
        return max(pov_votes, key=pov_votes.get)

    # Fallback: infer from node ID prefix in linked nodes
    for nid in linked_nodes:
        if nid.startswith("acc-"):
            return "accelerationist"
        elif nid.startswith("saf-"):
            return "safetyist"
        elif nid.startswith("skp-"):
            return "skeptic"
        elif nid.startswith("sit-"):
            return "situations"

    return "situations"  # default


def _determine_base_strength(instance):
    """Determine base strength for a claim instance.

    If the instance has pre-computed bdi_sub_scores, uses their average.
    Otherwise falls back to stance as a proxy:
    - supports/disputes: 0.6 (active position, moderate confidence)
    - qualifies: 0.4 (hedged position)
    - neutral: 0.3 (weak position)
    """
    bdi = instance.get("bdi_sub_scores")
    if bdi and isinstance(bdi, dict):
        values = [v for v in bdi.values() if isinstance(v, (int, float))]
        if values:
            return sum(values) / len(values)

    stance = instance.get("stance", "neutral")
    if stance in ("supports", "disputes"):
        return 0.6
    elif stance == "qualifies":
        return 0.4
    else:
        return 0.3


def _detect_edges(instances):
    """Detect attack/support edges between instances.

    Rules:
    - supports vs disputes on the same claim = attack (rebut)
    - same stance from different docs = support
    - qualifies vs supports/disputes = weak attack (undercut)
    """
    edges = []
    for i in range(len(instances)):
        for j in range(i + 1, len(instances)):
            a, b = instances[i], instances[j]
            # Skip same-document instances
            if a.get("doc_id") == b.get("doc_id"):
                continue

            a_stance = a.get("stance", "neutral")
            b_stance = b.get("stance", "neutral")

            # Opposing stances = attack
            is_conflict = (
                (a_stance == "supports" and b_stance == "disputes") or
                (a_stance == "disputes" and b_stance == "supports")
            )
            # Same active stance = support
            is_support = (
                a_stance == b_stance and
                a_stance in ("supports", "disputes")
            )
            # Qualifies vs active = weak attack (undercut)
            is_undercut = (
                (a_stance == "qualifies" and b_stance in ("supports", "disputes")) or
                (b_stance == "qualifies" and a_stance in ("supports", "disputes"))
            )

            if is_conflict:
                # Use existing attack_type if classified, otherwise default to rebut
                attack_type = a.get("attack_type") or b.get("attack_type") or "rebut"
                edges.append({
                    "source": f"inst-{i}",
                    "target": f"inst-{j}",
                    "type": "attacks",
                    "weight": 0.7,
                    "attack_type": attack_type,
                })
            elif is_support:
                edges.append({
                    "source": f"inst-{i}",
                    "target": f"inst-{j}",
                    "type": "supports",
                    "weight": 0.5,
                })
            elif is_undercut:
                edges.append({
                    "source": f"inst-{i}" if a_stance == "qualifies" else f"inst-{j}",
                    "target": f"inst-{j}" if a_stance == "qualifies" else f"inst-{i}",
                    "type": "attacks",
                    "weight": 0.4,
                    "attack_type": "undercut",
                })

    return edges


def _safe_env():
    """Build a minimal environment for subprocess calls — no API keys leaked."""
    import os
    allowed = {"PATH", "NODE_PATH", "HOME", "USER", "LANG", "TERM", "SHELL",
               "TMPDIR", "XDG_RUNTIME_DIR", "SYSTEMROOT", "COMSPEC"}
    return {k: v for k, v in os.environ.items() if k in allowed}


def _run_qbaf_bridge(nodes, edges):
    """Call qbaf-bridge.mjs via subprocess and return the result."""
    qbaf_input = {
        "nodes": nodes,
        "edges": [
            {k: v for k, v in e.items() if k != "attack_type"}
            for e in edges
        ],
    }

    # On Windows, use npx.cmd; on Unix, use npx
    npx_cmd = "npx.cmd" if sys.platform == "win32" else "npx"

    result = subprocess.run(
        [npx_cmd, "tsx", str(_QBAF_BRIDGE)],
        input=json.dumps(qbaf_input),
        capture_output=True,
        text=True,
        timeout=30,
        cwd=str(_PROJECT_ROOT),
        env=_safe_env(),
    )

    if result.returncode != 0:
        raise RuntimeError(f"qbaf-bridge error: {result.stderr.strip()}")

    return json.loads(result.stdout)


def _run_qbaf_bridge_batch(batch):
    """Call qbaf-bridge.mjs once for a batch of QBAF graphs.

    Input:  list of {"nodes": [...], "edges": [...]} dicts
    Output: list of result dicts (same order), or raises on failure
    """
    batch_input = {"batch": batch}

    npx_cmd = "npx.cmd" if sys.platform == "win32" else "npx"

    result = subprocess.run(
        [npx_cmd, "tsx", str(_QBAF_BRIDGE)],
        input=json.dumps(batch_input),
        capture_output=True,
        text=True,
        timeout=120,
        cwd=str(_PROJECT_ROOT),
        env=_safe_env(),
    )

    if result.returncode != 0:
        raise RuntimeError(f"qbaf-bridge batch error: {result.stderr.strip()}")

    parsed = json.loads(result.stdout)
    if isinstance(parsed, list):
        return parsed
    # Fallback: single-item bridge returns a single object
    return [parsed]


def enrich_conflict(conflict, node_meta):
    """Compute QBAF analysis for a single conflict and return the qbaf object.

    Returns None if the conflict doesn't have enough instances for analysis.
    """
    instances = conflict.get("instances") or []
    if len(instances) < 2:
        return None

    linked_nodes = conflict.get("linked_taxonomy_nodes") or []

    # Build QBAF nodes from instances
    qbaf_nodes_input = []
    qbaf_nodes_output = []

    for i, inst in enumerate(instances):
        node_id = f"inst-{i}"
        base_strength = _determine_base_strength(inst)
        pov = _infer_pov(inst, linked_nodes, node_meta)

        qbaf_nodes_input.append({
            "id": node_id,
            "base_strength": base_strength,
        })

        # Map POV names to schema enum
        pov_map = {
            "accelerationist": "accelerationist",
            "safetyist": "safetyist",
            "skeptic": "skeptic",
            "situations": "situations",
        }

        node_out: dict = {
            "id": node_id,
            "text": inst.get("assertion", "")[:200],
            "source_pov": pov_map.get(pov, "situations"),
            "base_strength": base_strength,
            "computed_strength": base_strength,  # placeholder, updated below
        }
        if inst.get("bdi_category"):
            node_out["bdi_category"] = inst["bdi_category"]
        if inst.get("bdi_sub_scores"):
            node_out["bdi_sub_scores"] = inst["bdi_sub_scores"]
        qbaf_nodes_output.append(node_out)

    # Detect edges
    edges = _detect_edges(instances)

    if not edges:
        # No relationships detected — still useful to record base strengths
        # but no propagation needed
        return {
            "graph": {
                "nodes": qbaf_nodes_output,
                "edges": [],
            },
            "computed_at": datetime.now().isoformat(),
            "algorithm": "df-quad",
            "iterations": 0,
        }

    # Return pre-bridge data for batch processing
    edge_output = []
    for e in edges:
        out = {
            "source": e["source"],
            "target": e["target"],
            "type": e["type"],
            "weight": e["weight"],
        }
        if e.get("attack_type"):
            out["attack_type"] = e["attack_type"]
        edge_output.append(out)

    return {
        "_needs_bridge": True,
        "qbaf_nodes_input": qbaf_nodes_input,
        "qbaf_nodes_output": qbaf_nodes_output,
        "edges": edges,
        "edge_output": edge_output,
    }


def _finalize_qbaf(pre, bridge_result):
    """Finalize a QBAF object after bridge results are available."""
    qbaf_nodes_output = pre["qbaf_nodes_output"]
    edge_output = pre["edge_output"]

    strengths = bridge_result.get("strengths", {})
    for node in qbaf_nodes_output:
        if node["id"] in strengths:
            node["computed_strength"] = round(strengths[node["id"]], 4)

    resolution = None
    if len(qbaf_nodes_output) >= 2:
        sorted_nodes = sorted(qbaf_nodes_output, key=lambda n: n["computed_strength"], reverse=True)
        top = sorted_nodes[0]
        runner_up = sorted_nodes[1]
        margin = round(top["computed_strength"] - runner_up["computed_strength"], 4)
        resolution = {
            "prevailing_claim": top["id"],
            "prevailing_strength": top["computed_strength"],
            "margin": margin,
            "criterion": "qbaf_computed_strength",
        }

    qbaf = {
        "graph": {
            "nodes": qbaf_nodes_output,
            "edges": edge_output,
        },
        "computed_at": datetime.now().isoformat(),
        "algorithm": "df-quad",
        "iterations": bridge_result.get("iterations", 0),
    }

    if resolution:
        qbaf["resolution"] = resolution

    return qbaf


def main():
    global DATA_ROOT, CONFLICTS_DIR, TAXONOMY_DIR
    DATA_ROOT = _resolve_data_root()
    CONFLICTS_DIR = DATA_ROOT / "conflicts"
    TAXONOMY_DIR = DATA_ROOT / "taxonomy" / "Origin"

    parser = argparse.ArgumentParser(description="Enrich conflict files with QBAF analysis")
    parser.add_argument("--write", action="store_true",
                        help="Write QBAF results back into conflict files")
    parser.add_argument("--id", type=str, default="",
                        help="Process a single conflict by claim_id")
    parser.add_argument("--force", action="store_true",
                        help="Recompute QBAF even if already present")
    args = parser.parse_args()

    _log("=" * 60)
    _log("QBAF Enrichment Pipeline")
    _log("=" * 60)

    # Load taxonomy metadata
    _log("\n[1/3] Loading taxonomy metadata...")
    node_meta = _load_taxonomy_nodes()
    _log(f"  Loaded {len(node_meta)} taxonomy nodes")

    # Load conflict files
    _log("\n[2/3] Loading conflicts...")
    conflict_files = sorted(CONFLICTS_DIR.glob("*.json"))
    conflict_files = [f for f in conflict_files if not f.name.startswith("_")]

    conflicts = []
    for p in conflict_files:
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if args.id and data.get("claim_id") != args.id:
                continue
            conflicts.append((p, data))
        except (json.JSONDecodeError, OSError) as exc:
            _log(f"  SKIP: {p.name} — {exc}")

    _log(f"  Loaded {len(conflicts)} conflicts")

    # Filter to eligible (2+ instances)
    eligible = [(p, d) for p, d in conflicts if len(d.get("instances") or []) >= 2]
    already_has_qbaf = sum(1 for _, d in eligible if d.get("qbaf"))

    if not args.force:
        to_process = [(p, d) for p, d in eligible if not d.get("qbaf")]
    else:
        to_process = eligible

    _log(f"  Eligible (2+ instances): {len(eligible)}")
    _log(f"  Already have QBAF: {already_has_qbaf}")
    _log(f"  To process: {len(to_process)}")

    if not to_process:
        _log("\n  Nothing to process.")
        return

    # Process: build all graphs locally, then batch the bridge call
    _log(f"\n[3/3] Computing QBAF for {len(to_process)} conflicts...")
    t0 = time.time()
    enriched = 0
    failed = 0
    no_edges = 0

    # Phase 1: build local graphs (no subprocess)
    pre_results = []  # (index, path, conflict, pre_data_or_qbaf)
    bridge_batch = []  # items needing bridge computation
    bridge_indices = []  # indices into pre_results for bridge items

    for i, (path, conflict) in enumerate(to_process):
        pre = enrich_conflict(conflict, node_meta)

        if pre is None:
            pre_results.append((i, path, conflict, None))
            continue

        if isinstance(pre, dict) and pre.get("_needs_bridge"):
            pre_results.append((i, path, conflict, pre))
            bridge_batch.append({
                "nodes": pre["qbaf_nodes_input"],
                "edges": [
                    {k: v for k, v in e.items() if k != "attack_type"}
                    for e in pre["edges"]
                ],
            })
            bridge_indices.append(len(pre_results) - 1)
        else:
            # No edges — already a complete qbaf dict
            pre_results.append((i, path, conflict, pre))

    # Phase 2: single batch bridge call for all graphs that need propagation
    bridge_results = []
    if bridge_batch:
        _log(f"  Sending {len(bridge_batch)} graphs to QBAF bridge (single process)...")
        try:
            bridge_results = _run_qbaf_bridge_batch(bridge_batch)
        except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
            _log(f"  Batch bridge failed: {exc} — falling back to per-conflict")
            # Fallback: run individually
            bridge_results = []
            for item in bridge_batch:
                try:
                    r = _run_qbaf_bridge(item["nodes"], [{"source": e["source"], "target": e["target"], "type": e["type"], "weight": e["weight"]} for e in item.get("edges", [])])
                    bridge_results.append(r)
                except Exception:
                    bridge_results.append(None)

    # Phase 3: finalize and write
    bridge_idx = 0
    for idx, path, conflict, pre in pre_results:
        if pre is None:
            failed += 1
            continue

        if isinstance(pre, dict) and pre.get("_needs_bridge"):
            br = bridge_results[bridge_idx] if bridge_idx < len(bridge_results) else None
            bridge_idx += 1
            if br is None:
                failed += 1
                continue
            qbaf = _finalize_qbaf(pre, br)
        else:
            qbaf = pre
            no_edges += 1

        conflict["qbaf"] = qbaf
        enriched += 1

        if args.write:
            path.write_text(
                json.dumps(conflict, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8", newline="\n",
            )

    _log(f"  enriched={enriched} no_edges={no_edges} failed={failed}")

    elapsed = time.time() - t0

    _log(f"\n{'=' * 60}")
    _log(f"Results ({elapsed:.1f}s):")
    _log(f"  Enriched with QBAF: {enriched}")
    _log(f"  No edges (base strength only): {no_edges}")
    _log(f"  Failed: {failed}")
    if not args.write:
        _log(f"  DRY RUN — use --write to persist")
    _log(f"{'=' * 60}")

    json.dump({
        "status": "complete" if args.write else "dry_run",
        "total_conflicts": len(conflicts),
        "eligible": len(eligible),
        "enriched": enriched,
        "no_edges": no_edges,
        "failed": failed,
    }, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
