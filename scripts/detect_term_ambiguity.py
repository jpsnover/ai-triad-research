#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""
detect_term_ambiguity.py — Detect cross-camp term ambiguity in the taxonomy.

Scans all POV nodes for terms that appear across 2+ camps, computes
cross-camp Shannon entropy and embedding spread, and produces a review
queue for vocabulary standardization.

Usage:
    python scripts/detect_term_ambiguity.py [--data-root PATH] [--min-entropy 0.6] [--min-spread 0.40]
"""

import argparse
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

_SCRIPT_DIR = Path(__file__).resolve().parent

CAMP_MAP = {
    "acc": "accelerationist",
    "saf": "safetyist",
    "skp": "skeptic",
}

CAMP_FILES = {
    "accelerationist": "accelerationist.json",
    "safetyist": "safetyist.json",
    "skeptic": "skeptic.json",
}

STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "shall", "can", "not",
    "no", "nor", "so", "if", "then", "than", "that", "this", "these",
    "those", "it", "its", "their", "they", "them", "we", "our", "us",
    "he", "she", "his", "her", "him", "who", "which", "what", "when",
    "where", "how", "why", "all", "each", "every", "both", "few", "more",
    "most", "other", "some", "such", "only", "own", "same", "very",
    "just", "also", "into", "over", "after", "before", "between",
    "through", "during", "about", "against", "above", "below",
    "up", "down", "out", "off", "any", "new", "must", "need",
}

MIN_TERM_LENGTH = 3


def _resolve_data_root(override=None):
    if override:
        return Path(override).resolve()
    config_path = _SCRIPT_DIR.parent / ".aitriad.json"
    if config_path.exists():
        try:
            cfg = json.loads(config_path.read_text(encoding="utf-8"))
            data_root = cfg.get("data_root", ".")
            base = (
                Path(data_root)
                if Path(data_root).is_absolute()
                else (_SCRIPT_DIR.parent / data_root)
            )
            return base.resolve()
        except (json.JSONDecodeError, OSError):
            pass
    return _SCRIPT_DIR.parent.resolve()


def extract_terms(text: str) -> list[str]:
    """Extract meaningful terms from text, lowercased, stopwords removed."""
    words = re.findall(r"[a-z][a-z'-]*[a-z]|[a-z]+", text.lower())
    return [w for w in words if w not in STOP_WORDS and len(w) >= MIN_TERM_LENGTH]


def load_nodes(data_root: Path) -> dict[str, list[dict]]:
    """Load taxonomy nodes grouped by camp."""
    taxonomy_dir = data_root / "taxonomy" / "Origin"
    camp_nodes = {}
    for camp, filename in CAMP_FILES.items():
        fpath = taxonomy_dir / filename
        if not fpath.exists():
            print(f"WARNING: {fpath} not found, skipping {camp}", file=sys.stderr)
            continue
        data = json.loads(fpath.read_text(encoding="utf-8"))
        nodes = data if isinstance(data, list) else data.get("nodes", [])
        camp_nodes[camp] = nodes
    return camp_nodes


def load_embeddings(data_root: Path) -> dict[str, list[float]]:
    """Load node embeddings."""
    emb_path = data_root / "taxonomy" / "Origin" / "embeddings.json"
    if not emb_path.exists():
        return {}
    data = json.loads(emb_path.read_text(encoding="utf-8"))
    return {nid: entry["vector"] for nid, entry in data.get("nodes", {}).items() if "vector" in entry}


def compute_shannon_entropy(camp_counts: dict[str, int]) -> float:
    """Normalized Shannon entropy across camps. 0=one camp, 1=perfectly even."""
    total = sum(camp_counts.values())
    if total == 0:
        return 0.0
    camps_present = len([c for c in camp_counts.values() if c > 0])
    if camps_present <= 1:
        return 0.0
    entropy = 0.0
    for count in camp_counts.values():
        if count > 0:
            p = count / total
            entropy -= p * math.log2(p)
    max_entropy = math.log2(camps_present)
    return entropy / max_entropy if max_entropy > 0 else 0.0


def compute_embedding_spread(node_ids: list[str], embeddings: dict[str, list[float]]) -> float:
    """Compute std of embedding distances for nodes using a term."""
    vectors = []
    for nid in node_ids:
        if nid in embeddings:
            vectors.append(np.array(embeddings[nid]))
    if len(vectors) < 2:
        return 0.0
    centroid = np.mean(vectors, axis=0)
    distances = [np.linalg.norm(v - centroid) for v in vectors]
    return float(np.std(distances))


def analyze_terms(camp_nodes: dict[str, list[dict]], embeddings: dict[str, list[float]],
                  min_entropy: float, min_spread: float) -> list[dict]:
    """Analyze all terms for cross-camp ambiguity."""
    # Build term → {camp: [node_ids]} index
    term_camp_nodes: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    term_camp_contexts: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))

    for camp, nodes in camp_nodes.items():
        for node in nodes:
            nid = node.get("id", "")
            text_fields = []
            for field in ["label", "name", "description"]:
                if field in node and node[field]:
                    text_fields.append(str(node[field]))
            char_lang = node.get("graph_attributes", {}).get("characteristic_language", [])
            if isinstance(char_lang, list):
                text_fields.extend(str(c) for c in char_lang)
            elif isinstance(char_lang, str):
                text_fields.append(char_lang)

            full_text = " ".join(text_fields)
            terms = set(extract_terms(full_text))

            for term in terms:
                term_camp_nodes[term][camp].append(nid)
                # Capture a context snippet for the term
                for tf in text_fields:
                    if term in tf.lower():
                        snippet = tf[:200] if len(tf) > 200 else tf
                        term_camp_contexts[term][camp].append(snippet)
                        break

    candidates = []
    for term, camp_data in sorted(term_camp_nodes.items()):
        camps_present = [c for c, nids in camp_data.items() if len(nids) > 0]
        if len(camps_present) < 2:
            continue

        camp_counts = {c: len(nids) for c, nids in camp_data.items()}
        total = sum(camp_counts.values())
        if total < 3:
            continue

        entropy = compute_shannon_entropy(camp_counts)

        all_node_ids = []
        for nids in camp_data.values():
            all_node_ids.extend(nids)
        spread = compute_embedding_spread(all_node_ids, embeddings)

        meets_entropy = entropy >= min_entropy
        meets_spread = spread >= min_spread

        candidates.append({
            "term": term,
            "camps_present": len(camps_present),
            "camp_counts": camp_counts,
            "total_nodes": total,
            "entropy": round(entropy, 3),
            "embedding_spread": round(spread, 3),
            "meets_entropy_threshold": meets_entropy,
            "meets_spread_threshold": meets_spread,
            "meets_all_criteria": meets_entropy and meets_spread,
            "suggested_action": "coin_new_terms" if (meets_entropy and meets_spread) else "review",
            "camp_contexts": {c: ctx[:2] for c, ctx in term_camp_contexts[term].items()},
        })

    candidates.sort(key=lambda x: (-x["camps_present"], -x["entropy"], -x["embedding_spread"]))
    return candidates


def main():
    parser = argparse.ArgumentParser(description="Detect cross-camp term ambiguity")
    parser.add_argument("--data-root", help="Override data root directory")
    parser.add_argument("--min-entropy", type=float, default=0.6, help="Minimum Shannon entropy (default: 0.6)")
    parser.add_argument("--min-spread", type=float, default=0.40, help="Minimum embedding spread (default: 0.40)")
    parser.add_argument("--output", help="Output file (default: dictionary/review_queue.json)")
    parser.add_argument("--top", type=int, default=50, help="Show top N candidates")
    args = parser.parse_args()

    data_root = _resolve_data_root(args.data_root)
    output_path = Path(args.output) if args.output else data_root / "dictionary" / "review_queue.json"

    print(f"Data root: {data_root}", file=sys.stderr)
    camp_nodes = load_nodes(data_root)
    total_nodes = sum(len(n) for n in camp_nodes.values())
    print(f"Loaded {total_nodes} nodes across {len(camp_nodes)} camps", file=sys.stderr)

    embeddings = load_embeddings(data_root)
    print(f"Loaded {len(embeddings)} embeddings", file=sys.stderr)

    candidates = analyze_terms(camp_nodes, embeddings, args.min_entropy, args.min_spread)
    qualifying = [c for c in candidates if c["meets_all_criteria"]]

    print(f"\nFound {len(candidates)} cross-camp terms, {len(qualifying)} meet both thresholds", file=sys.stderr)
    print(f"\n{'Term':<25} {'Camps':>5} {'Total':>5} {'Entropy':>8} {'Spread':>8} {'Action'}", file=sys.stderr)
    print("-" * 70, file=sys.stderr)
    for c in candidates[:args.top]:
        marker = "***" if c["meets_all_criteria"] else "   "
        counts = "/".join(f"{c['camp_counts'].get(camp, 0)}" for camp in ["accelerationist", "safetyist", "skeptic"])
        print(f"{marker} {c['term']:<22} {c['camps_present']:>5} {counts:>12} {c['entropy']:>8.3f} {c['embedding_spread']:>8.3f} {c['suggested_action']}",
              file=sys.stderr)

    output = {
        "generated_at": __import__("datetime").datetime.now().isoformat(),
        "thresholds": {
            "min_entropy": args.min_entropy,
            "min_spread": args.min_spread,
        },
        "total_cross_camp_terms": len(candidates),
        "qualifying_terms": len(qualifying),
        "candidates": candidates,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {len(candidates)} candidates to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
