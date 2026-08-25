#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""WS-B Stage 1 (t/3014): propose situation -> POV-node evidence links via embedding rank.

Pure read. Emits a proposal JSON `[{situation_id, camp, node_id, score, rank}]` and
writes NOTHING to the data repo (Stage 2 / PowerShell, t/3015, does the guarded write).

Builds to the HLD (t/2979#12) and the CL semantics spec (t/2990 D1):
  - per (situation, camp C in {acc,saf,skp}): query text = camp-C interpretation text
    + label + description  (NOT the blended buildSituationText()).
  - candidate pool = same-prefix nodes (acc-/saf-/skp-) from embeddings.json.
  - rank by FULL cosine, top-3, no score threshold (PI Option 3); record cosine + rank.
  - collision: skip any (situation, node) already authored in either direction
    (situation.linked_nodes forward, node.situation_refs reverse) -- authored wins.
  - scope: non-deprecated situations only ([DEPRECATED] description prefix exempt).

Embedder reuse (coordinated with PowerShell, p/23): scripts/embed_taxonomy.py batch-encode
(stdin [{id,text}] -> {id: vector}). PowerShell flagged that batch-encode returns
L2-normalized vectors while embeddings.json node vectors are un-normalized, so we compute
FULL cosine (normalize both sides) rather than a raw dot product.

Deterministic: same inputs -> same proposal (sort by -score, then node_id).

Usage:
    python propose_links.py [--out proposal.json]
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

CAMPS = {"acc": "accelerationist", "saf": "safetyist", "skp": "skeptic"}
TOP_N = 3


def find_repo_root(start: Path) -> Path:
    p = start.resolve()
    while p != p.parent:
        if (p / ".aitriad.json").exists():
            return p
        p = p.parent
    raise SystemExit("repo root (.aitriad.json) not found")


def resolve_taxonomy_dir(repo: Path) -> Path:
    """Resolve taxonomy dir. Priority: AI_TRIAD_DATA_ROOT env > .aitriad.json > fallback.

    The env override matters when running from a linked worktree: .aitriad.json's
    relative data_root ("../ai-triad-data") resolves against the worktree location,
    not the real sibling data repo, so the env var is the robust path here.
    """
    cfg = json.loads((repo / ".aitriad.json").read_text(encoding="utf-8"))
    tax_dir = cfg.get("taxonomy_dir", "taxonomy/Origin")
    env_root = os.environ.get("AI_TRIAD_DATA_ROOT")
    if env_root:
        base = Path(env_root)
    else:
        data_root = cfg.get("data_root", "../ai-triad-data")
        base = Path(data_root) if Path(data_root).is_absolute() else (repo / data_root)
    return (base / tax_dir).resolve()


def camp_query_text(sit: dict, camp_full: str) -> str:
    """Camp-C interpretation text + label + description (t/2990-D1).

    Handles both the decomposed shape ({belief,desire,intention,...}) and the
    legacy flat-string interpretation.
    """
    label = sit.get("label", "") or ""
    desc = sit.get("description", "") or ""
    interp = (sit.get("interpretations") or {}).get(camp_full)
    if isinstance(interp, dict):
        camp_text = " ".join(
            v for v in (interp.get("belief"), interp.get("desire"), interp.get("intention")) if v
        )
    elif isinstance(interp, str):
        camp_text = interp
    else:
        camp_text = ""
    return f"{label}. {desc} {camp_text}".strip()


def is_deprecated(sit: dict) -> bool:
    return (sit.get("description", "") or "").lstrip().startswith("[DEPRECATED]")


def batch_encode(repo: Path, items: list) -> dict:
    """Call scripts/embed_taxonomy.py batch-encode; stdin [{id,text}] -> {id: vector}."""
    script = repo / "scripts" / "embed_taxonomy.py"
    proc = subprocess.run(
        [sys.executable, str(script), "batch-encode"],
        input=json.dumps(items),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        raise SystemExit(f"batch-encode failed (rc={proc.returncode})")
    return json.loads(proc.stdout)


def l2_normalize(mat: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return mat / norms


def main() -> int:
    ap = argparse.ArgumentParser()
    here = Path(__file__).resolve().parent
    ap.add_argument("--out", default=str(here / "proposal.json"))
    args = ap.parse_args()

    repo = find_repo_root(here)
    tax = resolve_taxonomy_dir(repo)

    situations = json.loads((tax / "situations.json").read_text(encoding="utf-8"))["nodes"]
    emb = json.loads((tax / "embeddings.json").read_text(encoding="utf-8"))["nodes"]

    # Candidate node matrices per camp prefix (un-normalized -> we cosine-normalize).
    node_ids = {c: [] for c in CAMPS}
    node_vecs = {c: [] for c in CAMPS}
    for nid, rec in emb.items():
        pref = nid.split("-", 1)[0]
        if pref in CAMPS:
            node_ids[pref].append(nid)
            node_vecs[pref].append(rec["vector"])
    node_mat = {c: l2_normalize(np.asarray(node_vecs[c], dtype=np.float64)) for c in CAMPS}
    node_order = {c: node_ids[c] for c in CAMPS}

    # Authored exclusion set (situation_id, node_id): forward linked_nodes + reverse situation_refs.
    authored = set()
    for s in situations:
        sid = s.get("id")
        for nid in (s.get("linked_nodes") or []):
            authored.add((sid, nid))
    for fname in ("accelerationist.json", "safetyist.json", "skeptic.json"):
        for n in json.loads((tax / fname).read_text(encoding="utf-8"))["nodes"]:
            nid = n.get("id")
            for sref in (n.get("situation_refs") or []):
                authored.add((sref, nid))

    # Build query set (non-deprecated situations x 3 camps).
    active = [s for s in situations if s.get("id") and not is_deprecated(s)]
    query_items = []
    for s in active:
        for camp, camp_full in CAMPS.items():
            query_items.append({"id": f"{s['id']}|{camp}", "text": camp_query_text(s, camp_full)})

    sys.stderr.write(
        f"[stage1] {len(active)} non-deprecated situations x {len(CAMPS)} camps "
        f"= {len(query_items)} queries; {sum(len(node_order[c]) for c in CAMPS)} candidate nodes; "
        f"{len(authored)} authored links excluded.\n"
    )

    qvecs = batch_encode(repo, query_items)  # {id: vector}

    proposal = []
    for s in active:
        sid = s["id"]
        for camp in CAMPS:
            qv = np.asarray(qvecs[f"{sid}|{camp}"], dtype=np.float64)
            n = np.linalg.norm(qv)
            if n == 0:
                continue
            qv = qv / n
            sims = node_mat[camp] @ qv  # full cosine (both sides L2-normalized)
            order = sorted(range(len(sims)), key=lambda i: (-sims[i], node_order[camp][i]))
            picked = 0
            for i in order:
                nid = node_order[camp][i]
                if (sid, nid) in authored:
                    continue
                picked += 1
                proposal.append(
                    {
                        "situation_id": sid,
                        "camp": camp,
                        "node_id": nid,
                        "score": round(float(sims[i]), 6),
                        "rank": picked,
                    }
                )
                if picked >= TOP_N:
                    break

    proposal.sort(key=lambda r: (r["situation_id"], r["camp"], r["rank"]))
    Path(args.out).write_text(json.dumps(proposal, indent=2, ensure_ascii=False), encoding="utf-8")

    scores = [r["score"] for r in proposal]
    sys.stderr.write(
        f"[stage1] wrote {len(proposal)} proposed links to {args.out} "
        f"(score min {min(scores):.3f} / mean {sum(scores)/len(scores):.3f} / max {max(scores):.3f}).\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
