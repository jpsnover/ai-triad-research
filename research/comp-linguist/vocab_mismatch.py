#!/usr/bin/env python3
"""
Vocabulary mismatch analysis: find cases where debate claims express
taxonomy concepts using different vocabulary.

Approach:
1. Load all taxonomy node labels + descriptions as canonical terms
2. Load all debate AN claim texts
3. For each canonical concept, find claims that are semantically similar
   (embedding cosine > 0.6) but have low word overlap (Jaccard < 0.3)
4. These are vocabulary mismatches — the claim means the same thing but
   uses different words

Output: ranked list of colloquial expressions that should be added to
the domain vocabulary.
"""

import json
import sys
import time
from pathlib import Path
from collections import defaultdict

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from embed_taxonomy import _resolve_taxonomy_dir, _load_model

TAXONOMY_DIR = _resolve_taxonomy_dir()
from embed_taxonomy import TAXONOMY_DIR


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def tokenize(text: str) -> set:
    stopwords = {'the', 'a', 'an', 'of', 'in', 'and', 'for', 'to', 'on', 'with',
                 'as', 'by', 'is', 'are', 'from', 'that', 'this', 'or', 'be', 'at',
                 'not', 'but', 'its', 'it', 'has', 'have', 'can', 'will', 'all',
                 'more', 'into', 'also', 'than', 'their', 'they', 'been', 'was',
                 'were', 'which', 'about', 'would', 'should', 'could', 'may', 'must'}
    return {w for w in text.lower().split() if len(w) > 2 and w not in stopwords}


def main():
    cfg = json.loads((REPO_ROOT / ".aitriad.json").read_text())
    data_root = (REPO_ROOT / cfg["data_root"]).resolve()
    tax_dir = data_root / cfg["taxonomy_dir"]
    debates_dir = data_root / cfg.get("debates_dir", "debates")

    # 1. Load taxonomy node labels
    print("Loading taxonomy nodes...", file=sys.stderr)
    tax_concepts = []  # (id, label, description_first_line)
    for f in sorted(tax_dir.glob("*.json")):
        if f.name.startswith("_") or f.name in ("embeddings.json", "edges.json",
                                                  "lineage_categories.json", "policy_actions.json"):
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8-sig"))
        except:
            continue
        nodes = []
        if isinstance(data, dict):
            for cat in ("beliefs", "desires", "intentions", "nodes"):
                nodes.extend(data.get(cat, []))
        for node in nodes:
            label = node.get("label", "")
            desc = node.get("description", "")
            # Take first line of description (genus-differentia line)
            first_line = desc.split("\n")[0] if desc else ""
            if label:
                tax_concepts.append({"id": node.get("id", ""), "label": label, "desc_line": first_line})

    print(f"  {len(tax_concepts)} taxonomy concepts", file=sys.stderr)

    # 2. Load debate claims
    print("Loading debate claims...", file=sys.stderr)
    claims = []
    for f in sorted(debates_dir.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            an = data.get("argument_network", {})
            for node in an.get("nodes", []):
                text = node.get("text", "")
                if text and len(text) > 20:
                    claims.append({"text": text, "debate": f.stem, "speaker": node.get("speaker", "")})
        except:
            pass

    print(f"  {len(claims)} debate claims", file=sys.stderr)

    if not claims or not tax_concepts:
        print("Insufficient data", file=sys.stderr)
        return

    # 3. Embed everything
    print("Loading model...", file=sys.stderr)
    model = _load_model()

    # Embed taxonomy labels (short text, good for comparison)
    tax_texts = [c["label"] for c in tax_concepts]
    claim_texts = [c["text"][:200] for c in claims]  # cap length

    print(f"Encoding {len(tax_texts)} taxonomy labels + {len(claim_texts)} claims...", file=sys.stderr)
    all_texts = tax_texts + claim_texts
    all_vecs = model.encode(all_texts, normalize_embeddings=True, show_progress_bar=True)

    tax_vecs = all_vecs[:len(tax_texts)]
    claim_vecs = all_vecs[len(tax_texts):]

    # 4. Find mismatches: high cosine similarity but low word overlap
    print("Finding vocabulary mismatches...", file=sys.stderr)
    sim_matrix = claim_vecs @ tax_vecs.T  # (claims × tax)

    mismatches = []
    for ci in range(len(claims)):
        top_tax_idx = np.argsort(-sim_matrix[ci])[:5]  # top 5 taxonomy matches

        for ti in top_tax_idx:
            cosine = float(sim_matrix[ci, ti])
            if cosine < 0.55:
                break  # sorted, so remaining are lower

            claim_tokens = tokenize(claims[ci]["text"])
            tax_tokens = tokenize(tax_concepts[ti]["label"])
            word_overlap = jaccard(claim_tokens, tax_tokens)

            # Mismatch = high semantic similarity but low word overlap
            if cosine >= 0.55 and word_overlap < 0.25:
                mismatches.append({
                    "cosine": cosine,
                    "jaccard": word_overlap,
                    "gap": cosine - word_overlap,  # larger gap = bigger vocabulary mismatch
                    "tax_label": tax_concepts[ti]["label"],
                    "tax_id": tax_concepts[ti]["id"],
                    "claim_text": claims[ci]["text"][:150],
                    "speaker": claims[ci]["speaker"],
                })

    # Deduplicate by (tax_label, claim_text_prefix)
    seen = set()
    unique_mismatches = []
    for m in mismatches:
        key = (m["tax_label"], m["claim_text"][:60])
        if key not in seen:
            seen.add(key)
            unique_mismatches.append(m)

    unique_mismatches.sort(key=lambda x: -x["gap"])

    # 5. Group by taxonomy concept to find systematic mismatches
    by_concept = defaultdict(list)
    for m in unique_mismatches:
        by_concept[m["tax_label"]].append(m)

    # Sort concepts by number of mismatches (most systematic first)
    concept_ranking = sorted(by_concept.items(), key=lambda x: -len(x[1]))

    print(f"\n=== VOCABULARY MISMATCHES ===", file=sys.stderr)
    print(f"Total unique mismatches: {len(unique_mismatches)}", file=sys.stderr)
    print(f"Taxonomy concepts with mismatches: {len(concept_ranking)}", file=sys.stderr)

    print(f"\nTop 30 concepts with most vocabulary mismatches:", file=sys.stderr)
    for concept, matches in concept_ranking[:30]:
        avg_gap = sum(m["gap"] for m in matches) / len(matches)
        print(f"\n  [{len(matches)} mismatches, avg gap={avg_gap:.2f}] {concept}", file=sys.stderr)
        # Show top 3 example claim paraphrases
        for m in sorted(matches, key=lambda x: -x["gap"])[:3]:
            print(f"    cos={m['cosine']:.2f} jac={m['jaccard']:.2f} | \"{m['claim_text'][:100]}\"", file=sys.stderr)

    # Output JSON for further processing
    output = {
        "total_mismatches": len(unique_mismatches),
        "concepts_with_mismatches": len(concept_ranking),
        "top_concepts": [
            {
                "taxonomy_label": concept,
                "mismatch_count": len(matches),
                "avg_gap": round(sum(m["gap"] for m in matches) / len(matches), 3),
                "examples": [
                    {"claim": m["claim_text"][:150], "cosine": round(m["cosine"], 3), "jaccard": round(m["jaccard"], 3)}
                    for m in sorted(matches, key=lambda x: -x["gap"])[:5]
                ]
            }
            for concept, matches in concept_ranking[:40]
        ]
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
