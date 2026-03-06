#!/usr/bin/env python3
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

TAXONOMY_DIR = Path(__file__).resolve().parent.parent / "taxonomy" / "Origin"
EMBEDDINGS_FILE = TAXONOMY_DIR / "embeddings.json"
MODEL_NAME = "all-MiniLM-L6-v2"


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


def main():
    parser = argparse.ArgumentParser(
        description="Semantic embedding tools for the AI Triad taxonomy."
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

    args = parser.parse_args()

    if args.command == "generate":
        cmd_generate(args)
    elif args.command == "query":
        cmd_query(args)


if __name__ == "__main__":
    main()
