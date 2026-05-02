#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""
embed_taxonomy.py — Generate and query semantic embeddings for the AI Triad taxonomy.

Subcommands
-----------
  generate       Rebuild taxonomy/embeddings.json from all POV JSON files.
  query          Find taxonomy nodes most similar to a text query.
  find-overlaps  Find node pairs with high embedding similarity.
  encode         Encode a single text to an embedding vector.
  batch-encode   Encode multiple texts from stdin JSON.
  nli-classify   Classify text pairs as entailment/neutral/contradiction.

Uses the local all-MiniLM-L6-v2 model for embeddings and
cross-encoder/nli-deberta-v3-small for NLI classification (both via
sentence-transformers, no API required).

All informational/warning messages go to stderr; only machine-readable
JSON output goes to stdout.
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Optional

import numpy as np

_SCRIPT_DIR = Path(__file__).resolve().parent
_FALLBACK_TAXONOMY_DIR = _SCRIPT_DIR.parent / "taxonomy" / "Origin"
MODEL_NAME = "all-MiniLM-L6-v2"
NLI_MODEL_NAME = "cross-encoder/nli-deberta-v3-small"
NLI_LABELS = ["entailment", "neutral", "contradiction"]
# Maximum stdin buffer size (50 MB) — prevents resource exhaustion from piped input
_MAX_STDIN_BYTES = 50 * 1024 * 1024
# Minimum logit margin between the winning label and runner-up.
# If the margin is below this, the classification is downgraded to "neutral".
NLI_CONFIDENCE_MARGIN = 1.0

# Resolved at runtime via --taxonomy-dir or .aitriad.json
TAXONOMY_DIR: Path = _FALLBACK_TAXONOMY_DIR
EMBEDDINGS_FILE: Path = _FALLBACK_TAXONOMY_DIR / "embeddings.json"


def _resolve_taxonomy_dir(override=None):
    """Resolve the taxonomy directory from override, .aitriad.json, or default."""
    global TAXONOMY_DIR, EMBEDDINGS_FILE, CONFLICTS_DIR

    data_base = _SCRIPT_DIR.parent  # fallback

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
                conflicts_dir = cfg.get("conflicts_dir", "conflicts")
                base = Path(data_root) if Path(data_root).is_absolute() else (_SCRIPT_DIR.parent / data_root)
                data_base = base.resolve()
                TAXONOMY_DIR = (base / tax_dir).resolve()
                CONFLICTS_DIR = (base / conflicts_dir).resolve()
            except (json.JSONDecodeError, OSError):
                pass  # fall through to default

    EMBEDDINGS_FILE = TAXONOMY_DIR / "embeddings.json"
    if CONFLICTS_DIR is None or not CONFLICTS_DIR.exists():
        CONFLICTS_DIR = data_base / "conflicts"
    return TAXONOMY_DIR


def _load_model():
    """Load the sentence-transformer model (downloads on first run)."""
    from sentence_transformers import SentenceTransformer

    print(f"Loading model '{MODEL_NAME}'...", file=sys.stderr)
    return SentenceTransformer(MODEL_NAME, trust_remote_code=False)


def _load_nli_model():
    """Load the NLI cross-encoder model (downloads on first run)."""
    from sentence_transformers import CrossEncoder

    print(f"Loading NLI model '{NLI_MODEL_NAME}'...", file=sys.stderr)
    return CrossEncoder(NLI_MODEL_NAME, trust_remote_code=False)


def _classify_pairs_nli(nli_model, pairs):
    """Classify a list of (text_a, text_b) pairs using the NLI cross-encoder.

    Returns a list of dicts with 'label' (entailment|neutral|contradiction)
    and individual scores for each class.  If the winning label's logit does
    not exceed the runner-up by NLI_CONFIDENCE_MARGIN, the label is
    downgraded to 'neutral' to avoid low-confidence misclassifications.
    """
    if not pairs:
        return []

    scores = nli_model.predict(pairs)

    # scores shape: (N, 3) — columns are entailment, neutral, contradiction
    results = []
    for row in scores:
        sorted_idx = np.argsort(row)[::-1]  # descending
        best = float(row[sorted_idx[0]])
        second = float(row[sorted_idx[1]])
        margin = best - second

        if margin >= NLI_CONFIDENCE_MARGIN:
            label = NLI_LABELS[int(sorted_idx[0])]
        else:
            label = "neutral"

        results.append({
            "label": label,
            "entailment": round(float(row[0]), 4),
            "neutral": round(float(row[1]), 4),
            "contradiction": round(float(row[2]), 4),
            "margin": round(margin, 4),
        })
    return results


SKIP_FILES = {"embeddings.json", "edges.json", "policy_actions.json", "lineage_categories.json", "_archived_edges.json"}

# Resolved at runtime from .aitriad.json
CONFLICTS_DIR: Optional[Path] = None  # set in _resolve_taxonomy_dir

# Default weights for multi-field embedding.  Must sum to 1.0.
# Fields: description, assumes, lineage, epistemic_type, rhetorical_strategy
DEFAULT_FIELD_WEIGHTS = (0.55, 0.35, 0.10, 0.0, 0.0)


def _load_lineage_categories():
    """Load the lineage→category mapping from lineage_categories.json.

    Returns a dict mapping lineage value strings to their category labels,
    or an empty dict if the file is missing.
    """
    lc_path = TAXONOMY_DIR / "lineage_categories.json"
    if not lc_path.exists():
        print("Warning: lineage_categories.json not found — lineage field will be empty.", file=sys.stderr)
        return {}

    try:
        data = json.loads(lc_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"Warning: could not load lineage_categories.json: {exc}", file=sys.stderr)
        return {}

    # Build id→label lookup
    cat_labels = {c["id"]: c["label"] for c in data.get("categories", [])}
    # Build value→label mapping
    mapping = {}
    for value, cat_id in data.get("mapping", {}).items():
        mapping[value] = cat_labels.get(cat_id, "Other")
    return mapping


_EXCLUDES_RE = re.compile(r"\s*Excludes:.*", re.DOTALL)


def _strip_excludes(description: str) -> str:
    """Remove the 'Excludes: ...' clause from a node description."""
    return _EXCLUDES_RE.sub("", description).strip()


def _compose_field_texts(node, lineage_map):
    """Extract five embedding-ready text fields from a node.

    Returns (description_text, assumes_text, lineage_text,
             epistemic_text, rhetorical_text).

    description_text: label + description (sans Excludes)
    assumes_text:     concatenated assumes statements
    lineage_text:     deduplicated lineage category labels
    epistemic_text:   epistemic_type (underscores → spaces)
    rhetorical_text:  rhetorical_strategy (underscores → spaces)
    """
    ga = node.get("graph_attributes", {}) or {}

    # ── Field 1: Description ─────────────────────────────────────────
    parts = []
    label = node.get("label", "")
    if label:
        parts.append(label)

    desc = node.get("description", "")
    if desc:
        parts.append(_strip_excludes(desc))

    description_text = ". ".join(parts) if parts else ""

    # ── Field 2: Assumes ─────────────────────────────────────────────
    assumes = ga.get("assumes", []) or []
    assumes_text = ". ".join(assumes) if assumes else ""

    # ── Field 3: Lineage categories ──────────────────────────────────
    lineage_values = ga.get("intellectual_lineage", []) or []
    # Resolve to category labels and deduplicate while preserving order
    seen = set()
    cat_labels = []
    for val in lineage_values:
        cat_label = lineage_map.get(val, "Other")
        if cat_label not in seen:
            seen.add(cat_label)
            cat_labels.append(cat_label)
    lineage_text = ", ".join(cat_labels) if cat_labels else ""

    # ── Field 4: Epistemic type ──────────────────────────────────────
    epistemic = ga.get("epistemic_type", "")
    epistemic_text = epistemic.replace("_", " ") if epistemic else ""

    # ── Field 5: Rhetorical strategy ─────────────────────────────────
    rhetorical = ga.get("rhetorical_strategy", "")
    rhetorical_text = rhetorical.replace("_", " ") if rhetorical else ""

    return description_text, assumes_text, lineage_text, epistemic_text, rhetorical_text


def _load_taxonomy_nodes():
    """Read all POV JSON files and return a flat list of (pov, node) tuples."""
    nodes = []
    for path in sorted(TAXONOMY_DIR.glob("*.json")):
        if path.name in SKIP_FILES:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8-sig"))
        except (json.JSONDecodeError, OSError) as exc:
            print(f"Warning: skipping {path.name}: {exc}", file=sys.stderr)
            continue

        pov = path.stem.lower()
        for node in data.get("nodes", []):
            nodes.append((pov, node))
    return nodes


def _load_policy_registry():
    """Read policy_actions.json and return list of policy dicts, or empty list."""
    registry_path = TAXONOMY_DIR / "policy_actions.json"
    if not registry_path.exists():
        return []
    try:
        data = json.loads(registry_path.read_text(encoding="utf-8-sig"))
        return data.get("policies", [])
    except (json.JSONDecodeError, OSError) as exc:
        print(f"Warning: could not load policy registry: {exc}", file=sys.stderr)
        return []


def _load_conflict_nodes():
    """Read all conflict JSON files and return a list of conflict dicts.

    Each dict has at minimum: claim_id, claim_label, description.
    Files starting with '_' (e.g. _conflict-clusters.json) are skipped.
    """
    if not CONFLICTS_DIR.exists():
        print(f"Warning: conflicts directory not found at {CONFLICTS_DIR}", file=sys.stderr)
        return []

    conflicts = []
    for path in sorted(CONFLICTS_DIR.glob("*.json")):
        if path.name.startswith("_"):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8-sig"))
            conflicts.append({
                "claim_id": data.get("claim_id", path.stem),
                "claim_label": data.get("claim_label", ""),
                "description": data.get("description", ""),
            })
        except (json.JSONDecodeError, OSError) as exc:
            print(f"Warning: skipping conflict {path.name}: {exc}", file=sys.stderr)
    return conflicts


def cmd_generate(args):
    """Rebuild embeddings.json from all taxonomy JSON files and policy registry.

    For taxonomy nodes, produces a weighted combination of five field embeddings:
      - description (label + description sans Excludes)
      - assumes (concatenated assumption statements)
      - lineage (deduplicated lineage category labels)
      - epistemic_type (e.g. "normative prescription")
      - rhetorical_strategy (e.g. "precautionary framing, moral imperative")

    Weights are configurable via --field-weights (default 0.35/0.35/0.20/0.05/0.05).
    Policies continue to use a single embedding of their action text.
    """
    nodes = _load_taxonomy_nodes()
    policies = _load_policy_registry()
    conflicts = _load_conflict_nodes()

    if not nodes and not policies and not conflicts:
        print("Error: no taxonomy nodes, policies, or conflicts found.", file=sys.stderr)
        sys.exit(1)

    # Parse weights
    weights = (
        tuple(float(x) for x in args.field_weights.split(","))
        if hasattr(args, "field_weights") and args.field_weights
        else DEFAULT_FIELD_WEIGHTS
    )
    if len(weights) == 3:
        # Backward-compatible: old 3-field format → spread into 5 fields
        weights = (weights[0], weights[1], weights[2], 0.0, 0.0)
    if len(weights) != 5:
        print(f"Error: --field-weights requires 5 values (description,assumes,lineage,epistemic,rhetorical), got {len(weights)}", file=sys.stderr)
        sys.exit(1)
    w_desc, w_assumes, w_lineage, w_epistemic, w_rhetorical = weights
    weight_sum = sum(weights)
    if abs(weight_sum - 1.0) > 0.01:
        print(f"Warning: field weights sum to {weight_sum}, not 1.0. Normalizing.", file=sys.stderr)
        w_desc, w_assumes, w_lineage, w_epistemic, w_rhetorical = (w / weight_sum for w in weights)

    print(
        f"Field weights: description={w_desc:.2f}, assumes={w_assumes:.2f}, "
        f"lineage={w_lineage:.2f}, epistemic={w_epistemic:.2f}, rhetorical={w_rhetorical:.2f}",
        file=sys.stderr,
    )

    lineage_map = _load_lineage_categories()
    model = _load_model()

    # ── Compose field texts for taxonomy nodes ───────────────────────
    desc_texts = []
    assumes_texts = []
    lineage_texts = []
    epistemic_texts = []
    rhetorical_texts = []
    for _, node in nodes:
        d, a, l, e, r = _compose_field_texts(node, lineage_map)
        desc_texts.append(d)
        assumes_texts.append(a)
        lineage_texts.append(l)
        epistemic_texts.append(e)
        rhetorical_texts.append(r)

    # ── Collect all texts to encode in one batch ─────────────────────
    policy_texts = [p.get("action", "") for p in policies]
    conflict_texts = [
        f"{c['claim_label']}. {c['description']}".strip(". ") for c in conflicts
    ]
    n = len(nodes)

    all_texts = desc_texts + assumes_texts + lineage_texts + epistemic_texts + rhetorical_texts + policy_texts + conflict_texts
    print(
        f"Encoding {n} nodes x 5 fields + {len(policy_texts)} policies + "
        f"{len(conflict_texts)} conflicts ({len(all_texts)} total texts)...",
        file=sys.stderr,
    )
    all_vecs = model.encode(all_texts, normalize_embeddings=True, show_progress_bar=True)

    # Slice into per-field arrays
    desc_vecs = all_vecs[0:n]
    assumes_vecs = all_vecs[n : 2 * n]
    lineage_vecs = all_vecs[2 * n : 3 * n]
    epistemic_vecs = all_vecs[3 * n : 4 * n]
    rhetorical_vecs = all_vecs[4 * n : 5 * n]
    policy_vecs = all_vecs[5 * n : 5 * n + len(policy_texts)]
    conflict_vecs = all_vecs[5 * n + len(policy_texts) :]

    # ── Weighted combination for taxonomy nodes ──────────────────────
    node_vectors = (
        w_desc * desc_vecs
        + w_assumes * assumes_vecs
        + w_lineage * lineage_vecs
        + w_epistemic * epistemic_vecs
        + w_rhetorical * rhetorical_vecs
    )

    # Detect degenerate embeddings (near-zero vectors from empty/stop-word-only text)
    raw_norms = np.linalg.norm(node_vectors, axis=1)
    degenerate_mask = raw_norms < 0.01
    degenerate_count = int(np.sum(degenerate_mask))
    if degenerate_count > 0:
        degenerate_ids = [nodes[i][1]["id"] for i in range(n) if degenerate_mask[i]]
        print(
            f"Warning: {degenerate_count} degenerate embedding(s) (‖v‖ < 0.01), "
            f"excluded from similarity: {', '.join(degenerate_ids[:10])}"
            + (f" ... and {degenerate_count - 10} more" if degenerate_count > 10 else ""),
            file=sys.stderr,
        )

    # Re-normalize so downstream cosine similarity works correctly
    norms = np.linalg.norm(node_vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0  # avoid division by zero for empty nodes
    node_vectors = node_vectors / norms

    # ── Build output structure ───────────────────────────────────────
    nodes_dict = {}
    for i, (pov, node) in enumerate(nodes):
        entry = {
            "pov": pov,
            "vector": node_vectors[i].tolist(),
        }
        if degenerate_mask[i]:
            entry["degenerate"] = True
        nodes_dict[node["id"]] = entry

    for i, pol in enumerate(policies):
        nodes_dict[pol["id"]] = {
            "pov": "policy",
            "vector": policy_vecs[i].tolist(),
        }

    for i, conflict in enumerate(conflicts):
        nodes_dict[conflict["claim_id"]] = {
            "pov": "conflict",
            "vector": conflict_vecs[i].tolist(),
        }

    output = {
        "model": MODEL_NAME,
        "dimension": int(all_vecs.shape[1]),
        "field_weights": {
            "description": w_desc,
            "assumes": w_assumes,
            "lineage": w_lineage,
            "epistemic": w_epistemic,
            "rhetorical": w_rhetorical,
        },
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "node_count": len(nodes_dict),
        "nodes": nodes_dict,
    }

    EMBEDDINGS_FILE.write_text(
        json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
    )
    print(
        f"Wrote {len(nodes_dict)} embeddings ({n} nodes + "
        f"{len(policy_texts)} policies + {len(conflict_texts)} conflicts, "
        f"{all_vecs.shape[1]}d) to {EMBEDDINGS_FILE}",
        file=sys.stderr,
    )


def cmd_query(args):
    """Find the most similar taxonomy nodes/policies to a text query."""
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
    current_policies = _load_policy_registry()
    current_conflicts = _load_conflict_nodes()
    expected = len(current_nodes) + len(current_policies) + len(current_conflicts)
    if expected != data.get("node_count", 0):
        print(
            f"Warning: taxonomy has {len(current_nodes)} nodes + {len(current_policies)} policies + "
            f"{len(current_conflicts)} conflicts ({expected} total) but embeddings.json has "
            f"{data['node_count']}. Consider running 'generate' to update.",
            file=sys.stderr,
        )

    # Filter by POV and/or type
    pov_filter = args.pov.lower() if args.pov else None
    type_filter = getattr(args, 'type', None)
    node_ids = []
    vectors = []
    for nid, entry in data["nodes"].items():
        if pov_filter and entry["pov"] != pov_filter:
            continue
        if type_filter == "node" and entry["pov"] == "policy":
            continue
        if type_filter == "policy" and entry["pov"] != "policy":
            continue
        if entry.get("degenerate"):
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
    raw = sys.stdin.read(_MAX_STDIN_BYTES)
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
    """Find node pairs with high embedding similarity (potential merge candidates).

    Unless --no-nli is set, each pair is verified with an NLI cross-encoder to
    classify the relationship as entailment (genuine overlap), neutral, or
    contradiction (opposite statements on the same topic).
    """
    if not EMBEDDINGS_FILE.exists():
        print(
            "Error: embeddings.json not found. Run 'generate' first.",
            file=sys.stderr,
        )
        sys.exit(1)

    data = json.loads(EMBEDDINGS_FILE.read_text(encoding="utf-8"))

    # Load taxonomy node info for NLI (label, description, pov)
    node_info = {}
    for pov, node in _load_taxonomy_nodes():
        label = node.get("label", "")
        desc = node.get("description", "") or label
        node_info[node["id"]] = {"label": label, "description": desc, "pov": pov}
    for pol in _load_policy_registry():
        node_info[pol["id"]] = {
            "label": pol.get("action", ""),
            "description": pol.get("action", ""),
            "pov": pol.get("pov", ""),
        }

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

    # NLI verification
    if not args.no_nli and pairs:
        nli_model = _load_nli_model()
        nli_pairs = []
        for p in pairs:
            info_a = node_info.get(p["node_a"])
            info_b = node_info.get(p["node_b"])
            text_a = (
                f"The {info_a['pov']} position is: {info_a['label']} — {info_a['description']}"
                if info_a
                else p["node_a"]
            )
            text_b = (
                f"The {info_b['pov']} position is: {info_b['label']} — {info_b['description']}"
                if info_b
                else p["node_b"]
            )
            nli_pairs.append((text_a, text_b))

        print(f"Running NLI classification on {len(nli_pairs)} pairs...", file=sys.stderr)
        nli_results = _classify_pairs_nli(nli_model, nli_pairs)

        for pair, nli in zip(pairs, nli_results):
            pair["nli_label"] = nli["label"]
            pair["nli_entailment"] = nli["entailment"]
            pair["nli_neutral"] = nli["neutral"]
            pair["nli_contradiction"] = nli["contradiction"]

        contradictions = sum(1 for p in pairs if p["nli_label"] == "contradiction")
        entailments = sum(1 for p in pairs if p["nli_label"] == "entailment")
        neutrals = sum(1 for p in pairs if p["nli_label"] == "neutral")
        print(
            f"NLI results: {entailments} entailment, {neutrals} neutral, "
            f"{contradictions} contradiction",
            file=sys.stderr,
        )

    # Auto-label same-POV near-identical pairs as duplicates regardless of NLI
    DUPLICATE_SIM_THRESHOLD = 0.99
    duplicates = 0
    for p in pairs:
        if p["pov_a"] == p["pov_b"] and p["similarity"] >= DUPLICATE_SIM_THRESHOLD:
            p["nli_label"] = "duplicate"
            duplicates += 1
    if duplicates:
        print(f"Auto-labeled {duplicates} same-POV near-identical pairs as duplicate", file=sys.stderr)

    print(f"Found {len(pairs)} pairs above threshold {args.threshold}", file=sys.stderr)
    json.dump(pairs, sys.stdout, indent=2)


def cmd_nli_classify(args):
    """Classify text pairs as entailment, neutral, or contradiction.

    Reads JSON from stdin: [{"text_a": "...", "text_b": "...", ...}]
    Extra fields are preserved and passed through to the output.
    Outputs JSON: [{"text_a": "...", "text_b": "...", "nli_label": "...", ...}]
    """
    raw = sys.stdin.read(_MAX_STDIN_BYTES)
    items = json.loads(raw)
    if not items:
        json.dump([], sys.stdout)
        return

    nli_model = _load_nli_model()
    nli_pairs = [(item["text_a"], item["text_b"]) for item in items]

    print(f"Classifying {len(nli_pairs)} pairs...", file=sys.stderr)
    results = _classify_pairs_nli(nli_model, nli_pairs)

    # Merge NLI results back into input items (preserving extra fields)
    for item, nli in zip(items, results):
        item["nli_label"] = nli["label"]
        item["nli_entailment"] = nli["entailment"]
        item["nli_neutral"] = nli["neutral"]
        item["nli_contradiction"] = nli["contradiction"]

    json.dump(items, sys.stdout, indent=2)


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
    gen = sub.add_parser("generate", help="Rebuild taxonomy/embeddings.json")
    gen.add_argument(
        "--field-weights",
        default=None,
        help=(
            "Comma-separated weights for description,assumes,lineage,epistemic,rhetorical fields "
            "(3-value format also accepted for backward compat) "
            f"(default: {','.join(str(w) for w in DEFAULT_FIELD_WEIGHTS)}). Must sum to ~1.0."
        ),
    )

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
    q.add_argument(
        "--type",
        choices=["node", "policy"],
        default=None,
        help="Filter to nodes only or policies only",
    )

    # find-overlaps
    o = sub.add_parser(
        "find-overlaps",
        help="Find node pairs with high embedding similarity (with NLI verification)",
    )
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
    o.add_argument(
        "--no-nli",
        action="store_true",
        help="Skip NLI cross-encoder verification (faster, but no contradiction detection)",
    )

    # encode — output raw vector for a single text
    e = sub.add_parser("encode", help="Encode a single text to an embedding vector (JSON)")
    e.add_argument("text", help="The text to encode")

    # batch-encode — encode multiple texts from stdin
    sub.add_parser("batch-encode", help="Encode multiple texts from stdin JSON [{id, text}] -> {id: vector}")

    # nli-classify — classify text pairs via NLI cross-encoder
    sub.add_parser(
        "nli-classify",
        help="Classify text pairs from stdin JSON [{text_a, text_b}] as entailment/neutral/contradiction",
    )

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
    elif args.command == "nli-classify":
        cmd_nli_classify(args)


if __name__ == "__main__":
    main()
