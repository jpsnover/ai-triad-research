#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""
embed_taxonomy.py — Generate and query semantic embeddings for the AI Triad taxonomy.

Subcommands
-----------
  generate   Rebuild taxonomy/embeddings.json from all POV JSON files.
  query      Find taxonomy nodes most similar to a text query.

Uses the local all-MiniLM-L6-v2 model via sentence-transformers.
All informational/warning messages go to stderr; only machine-readable
JSON output goes to stdout.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

_SCRIPT_DIR = Path(__file__).resolve().parent
_DEFAULT_TAXONOMY_DIR = _SCRIPT_DIR.parent / "taxonomy" / "Origin"
MODEL_NAME = "all-MiniLM-L6-v2"

# Resolved at runtime via --taxonomy-dir or .aitriad.json
TAXONOMY_DIR: Path = _DEFAULT_TAXONOMY_DIR
EMBEDDINGS_FILE: Path = _DEFAULT_TAXONOMY_DIR / "embeddings.json"


def _resolve_taxonomy_dir(override=None):
    """Resolve the taxonomy directory from override, .aitriad.json, or default."""
    global TAXONOMY_DIR, EMBEDDINGS_FILE

    if override:
        TAXONOMY_DIR = Path(override).resolve()
    else:
        # Try .aitriad.json
        config_path = _SCRIPT_DIR.parent / ".aitriad.json"
        if config_path.exists():
            try:
                cfg = json.loads(config_path.read_text(encoding="utf-8"))
                data_root = cfg.get("data_root", ".")
                tax_dir = cfg.get("taxonomy_dir", "taxonomy/Origin")
                base = Path(data_root) if Path(data_root).is_absolute() else (_SCRIPT_DIR.parent / data_root)
                TAXONOMY_DIR = (base / tax_dir).resolve()
            except (json.JSONDecodeError, OSError):
                pass  # fall through to default

    EMBEDDINGS_FILE = TAXONOMY_DIR / "embeddings.json"
    return TAXONOMY_DIR


def _load_model():
    """Load the sentence-transformer model (downloads on first run)."""
    from sentence_transformers import SentenceTransformer

    print(f"Loading model '{MODEL_NAME}'...", file=sys.stderr)
    return SentenceTransformer(MODEL_NAME)


def _load_taxonomy_nodes():
    """Read all POV JSON files and return a flat list of (pov, node) tuples."""
    nodes = []
    for path in sorted(TAXONOMY_DIR.glob("*.json")):
        if path.name == "embeddings.json":
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            print(f"Warning: skipping {path.name}: {exc}", file=sys.stderr)
            continue

        pov = path.stem.lower()
        for node in data.get("nodes", []):
            nodes.append((pov, node))
    return nodes


def cmd_generate(args):
    """Rebuild embeddings.json from all taxonomy JSON files."""
    nodes = _load_taxonomy_nodes()
    if not nodes:
        print("Error: no taxonomy nodes found.", file=sys.stderr)
        sys.exit(1)

    model = _load_model()

    # Build texts: description only per node
    texts = [
        node.get('description', '') for _, node in nodes
    ]

    print(f"Embedding {len(texts)} nodes...", file=sys.stderr)
    vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=True)

    # Build output structure
    nodes_dict = {}
    for (pov, node), vec in zip(nodes, vectors):
        nodes_dict[node["id"]] = {
            "pov": pov,
            "vector": vec.tolist(),
        }

    output = {
        "model": MODEL_NAME,
        "dimension": int(vectors.shape[1]),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "node_count": len(nodes_dict),
        "nodes": nodes_dict,
    }

    EMBEDDINGS_FILE.write_text(
        json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(
        f"Wrote {len(nodes_dict)} embeddings ({vectors.shape[1]}d) "
        f"to {EMBEDDINGS_FILE}",
        file=sys.stderr,
    )


def cmd_query(args):
    """Find the most similar taxonomy nodes to a text query."""
    # Load embeddings
    if not EMBEDDINGS_FILE.exists():
        print(
            "Error: embeddings.json not found. Run 'generate' first.",
            file=sys.stderr,
        )
        sys.exit(1)

    data = json.loads(EMBEDDINGS_FILE.read_text(encoding="utf-8"))

    # Staleness check
    current_nodes = _load_taxonomy_nodes()
    if len(current_nodes) != data.get("node_count", 0):
        print(
            f"Warning: taxonomy has {len(current_nodes)} nodes but "
            f"embeddings.json has {data['node_count']}. "
            f"Consider running 'generate' to update.",
            file=sys.stderr,
        )

    # Filter by POV if specified
    pov_filter = args.pov.lower() if args.pov else None
    node_ids = []
    vectors = []
    for nid, entry in data["nodes"].items():
        if pov_filter and entry["pov"] != pov_filter:
            continue
        node_ids.append(nid)
        vectors.append(entry["vector"])

    if not node_ids:
        json.dump([], sys.stdout)
        return

    vectors = np.array(vectors, dtype=np.float32)

    model = _load_model()
    query_vec = model.encode(
        [args.text], normalize_embeddings=True, show_progress_bar=False
    )

    # Cosine similarity = dot product (vectors are pre-normalized)
    scores = (vectors @ query_vec[0]).tolist()

    # Build results sorted by score descending
    results = []
    for nid, score in zip(node_ids, scores):
        results.append(
            {
                "id": nid,
                "pov": data["nodes"][nid]["pov"],
                "score": round(score, 6),
            }
        )

    results.sort(key=lambda r: r["score"], reverse=True)

    top = args.top
    if top and top > 0:
        results = results[:top]

    json.dump(results, sys.stdout, indent=2)


def cmd_encode(args):
    """Encode a single text and output its embedding vector as JSON."""
    model = _load_model()
    vec = model.encode(
        [args.text], normalize_embeddings=True, show_progress_bar=False
    )
    json.dump(vec[0].tolist(), sys.stdout)


def cmd_batch_encode(args):
    """Encode multiple texts from stdin JSON and output {id: vector} map.

    Expects stdin JSON: [{"id": "acc-goal-001", "text": "description..."}]
    Outputs JSON: {"acc-goal-001": [0.1, 0.2, ...], ...}
    """
    raw = sys.stdin.read()
    items = json.loads(raw)
    if not items:
        json.dump({}, sys.stdout)
        return

    model = _load_model()
    texts = [item["text"] for item in items]
    ids = [item["id"] for item in items]

    print(f"Batch-encoding {len(texts)} texts...", file=sys.stderr)
    vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)

    result = {}
    for nid, vec in zip(ids, vectors):
        result[nid] = vec.tolist()

    json.dump(result, sys.stdout)


def cmd_find_overlaps(args):
    """Find node pairs with high embedding similarity (potential merge candidates)."""
    if not EMBEDDINGS_FILE.exists():
        print(
            "Error: embeddings.json not found. Run 'generate' first.",
            file=sys.stderr,
        )
        sys.exit(1)

    data = json.loads(EMBEDDINGS_FILE.read_text(encoding="utf-8"))

    # Build arrays
    node_ids = []
    povs = []
    vecs = []
    pov_filter = args.pov.lower() if args.pov else None

    for nid, entry in data["nodes"].items():
        node_ids.append(nid)
        povs.append(entry["pov"])
        vecs.append(entry["vector"])

    if len(node_ids) < 2:
        json.dump([], sys.stdout)
        return

    vectors = np.array(vecs, dtype=np.float32)

    # Pairwise cosine similarity (vectors are pre-normalized)
    sim_matrix = vectors @ vectors.T

    # Extract upper triangle (no self-pairs, no duplicates)
    n = len(node_ids)
    pairs = []
    for i in range(n):
        for j in range(i + 1, n):
            score = float(sim_matrix[i, j])
            if score < args.threshold:
                continue
            if pov_filter and povs[i] != pov_filter and povs[j] != pov_filter:
                continue
            if args.cross_pov and povs[i] == povs[j]:
                continue
            pairs.append({
                "node_a": node_ids[i],
                "node_b": node_ids[j],
                "pov_a": povs[i],
                "pov_b": povs[j],
                "similarity": round(score, 6),
            })

    pairs.sort(key=lambda p: p["similarity"], reverse=True)

    if args.top and args.top > 0:
        pairs = pairs[:args.top]

    print(f"Found {len(pairs)} pairs above threshold {args.threshold}", file=sys.stderr)
    json.dump(pairs, sys.stdout, indent=2)


def main():
    parser = argparse.ArgumentParser(
        description="Semantic embedding tools for the AI Triad taxonomy."
    )
    parser.add_argument(
        "--taxonomy-dir",
        default=None,
        help="Override taxonomy directory (default: resolved from .aitriad.json)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # generate
    sub.add_parser("generate", help="Rebuild taxonomy/embeddings.json")

    # query
    q = sub.add_parser("query", help="Semantic search over taxonomy nodes")
    q.add_argument("text", help="The search text to find similar nodes for")
    q.add_argument(
        "--top",
        type=int,
        default=0,
        help="Return only the top N results (0 = all)",
    )
    q.add_argument(
        "--pov",
        default=None,
        help="Filter to a specific POV (e.g. safetyist)",
    )

    # find-overlaps
    o = sub.add_parser("find-overlaps", help="Find node pairs with high embedding similarity")
    o.add_argument(
        "--threshold",
        type=float,
        default=0.80,
        help="Minimum cosine similarity to report (default 0.80)",
    )
    o.add_argument(
        "--pov",
        default=None,
        help="Filter to pairs where at least one node is from this POV",
    )
    o.add_argument(
        "--cross-pov",
        action="store_true",
        help="Only report pairs where nodes are from different POVs",
    )
    o.add_argument(
        "--top",
        type=int,
        default=0,
        help="Limit output to top N pairs (0 = all)",
    )

    # encode — output raw vector for a single text
    e = sub.add_parser("encode", help="Encode a single text to an embedding vector (JSON)")
    e.add_argument("text", help="The text to encode")

    # batch-encode — encode multiple texts from stdin
    sub.add_parser("batch-encode", help="Encode multiple texts from stdin JSON [{id, text}] -> {id: vector}")

    args = parser.parse_args()
    _resolve_taxonomy_dir(args.taxonomy_dir)

    if args.command == "generate":
        cmd_generate(args)
    elif args.command == "query":
        cmd_query(args)
    elif args.command == "find-overlaps":
        cmd_find_overlaps(args)
    elif args.command == "encode":
        cmd_encode(args)
    elif args.command == "batch-encode":
        cmd_batch_encode(args)


if __name__ == "__main__":
    main()
