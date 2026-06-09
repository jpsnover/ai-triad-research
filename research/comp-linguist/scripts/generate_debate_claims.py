#!/usr/bin/env python3
"""
generate_debate_claims.py — Generate debate-register synthetic claims for ALL taxonomy nodes.

Creates training data that matches the golden test set's register (informal debate rhetoric)
rather than the LLM-summary register that caused catastrophic forgetting in prior experiments.

Requires: GEMINI_API_KEY or AI_API_KEY environment variable.

Output: debate_claims_corpus.json — a training corpus compatible with train_claim_matcher.py
"""

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
RESEARCH_DIR = SCRIPT_DIR.parent
REPO_ROOT = RESEARCH_DIR.parent.parent

GENERATION_PROMPT = """You are generating training data for a semantic matching system. Given a taxonomy node description, generate {count} diverse debate claims that a real speaker would make when arguing for or engaging with this concept.

NODE:
ID: {node_id}
Description: {description}
Category: {bdi_category}
Assumes: {assumes}
Rhetorical strategy: {rhetorical_strategy}
Epistemic type: {epistemic_type}

REQUIREMENTS:
- Use informal, rhetorical debate language — NOT academic or ontological language
- Include hedges ("arguably", "I think"), connectives ("but look", "the thing is"), and concrete examples where appropriate
- Vary specificity: some abstract claims, some with concrete scenarios
- Generate from the perspective of a {speaker_pov} speaker
- Each claim should be 1-3 sentences, as it would appear in a debate transcript
- For {bdi_category} nodes, make sure claims reflect the {bdi_nature} nature of the concept

EXAMPLES OF REAL DEBATE CLAIMS (for register calibration):
{few_shot_examples}

Generate exactly {count} claims. Output as a JSON array of strings. No other text."""

BDI_NATURE = {
    "beliefs": "epistemic (what the speaker believes to be true)",
    "desires": "motivational (what the speaker wants or values)",
    "intentions": "action-oriented (what the speaker plans or commits to doing)",
}


def log(msg: str):
    print(f"[debate-gen] {msg}", file=sys.stderr)


def load_taxonomy_nodes(data_root: Path, taxonomy_dir_rel: str) -> dict:
    taxonomy_dir = data_root / taxonomy_dir_rel
    nodes = {}
    for pov_file in ["safetyist.json", "accelerationist.json", "skeptic.json"]:
        path = taxonomy_dir / pov_file
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        node_list = data.get("nodes", data)
        if isinstance(node_list, dict):
            node_list = list(node_list.values())
        pov = pov_file.replace(".json", "")
        for n in node_list:
            nid = n.get("id", "")
            if nid:
                n["_pov"] = pov
                nodes[nid] = n
    return nodes


def get_bdi_category(node_id: str) -> str:
    parts = node_id.split("-")
    if len(parts) >= 2:
        cat = parts[1]
        if cat in ("beliefs", "desires", "intentions"):
            return cat
    return "beliefs"


def get_pov_from_id(node_id: str) -> str:
    prefix = node_id.split("-")[0]
    return {"acc": "accelerationist", "saf": "safetyist", "skp": "skeptic"}.get(prefix, "unknown")


def load_few_shot_examples(golden_path: Path, pov_prefix: str, bdi_cat: str, n: int = 3) -> list[str]:
    if not golden_path.exists():
        return []
    data = json.loads(golden_path.read_text(encoding="utf-8"))
    claims = data.get("claims", [])
    matching = [c for c in claims
                if c.get("attributed_node", "").startswith(pov_prefix)
                and bdi_cat in c.get("attributed_node", "")]
    if not matching:
        matching = [c for c in claims if c.get("attributed_node", "").startswith(pov_prefix)]
    if not matching:
        matching = claims[:n]
    random.shuffle(matching)
    return [c["claim_text"] for c in matching[:n]]


def generate_claims_gemini(prompt: str, model_name: str = "gemini-2.5-flash") -> list[str]:
    try:
        from google import genai
    except ImportError:
        log("ERROR: google-genai not installed. Run: pip install google-genai")
        return []

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("AI_API_KEY")
    if not api_key:
        log("ERROR: Set GEMINI_API_KEY or AI_API_KEY environment variable")
        return []

    client = genai.Client(api_key=api_key)
    try:
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                temperature=0.9,
                max_output_tokens=4000,
            ),
        )
        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
        claims = json.loads(text)
        if isinstance(claims, list):
            return [c for c in claims if isinstance(c, str) and len(c) >= 15]
    except Exception as e:
        log(f"  Generation error: {e}")
    return []


def main():
    parser = argparse.ArgumentParser(description="Generate debate-register claims for all taxonomy nodes")
    parser.add_argument("--output", "-o", default=str(RESEARCH_DIR / "debate_claims_corpus.json"))
    parser.add_argument("--count", type=int, default=5,
                        help="Claims per node (default 5 — 720 nodes × 5 = 3,600 claims)")
    parser.add_argument("--batch-size", type=int, default=10,
                        help="Nodes per API call batch (for rate limiting)")
    parser.add_argument("--skip-existing", action="store_true",
                        help="Skip nodes already in output file")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0,
                        help="Process only first N nodes (0 = all)")
    parser.add_argument("--model", default="gemini-2.5-flash")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed)

    aitriad_path = REPO_ROOT / ".aitriad.json"
    data_root = REPO_ROOT / ".." / "ai-triad-data"
    taxonomy_dir_rel = "taxonomy/Origin"
    if aitriad_path.exists():
        raw = json.loads(aitriad_path.read_text(encoding="utf-8"))
        if "data_root" in raw:
            data_root = (REPO_ROOT / raw["data_root"]).resolve()
        if "taxonomy_dir" in raw:
            taxonomy_dir_rel = raw["taxonomy_dir"]

    nodes = load_taxonomy_nodes(data_root, taxonomy_dir_rel)
    log(f"Loaded {len(nodes)} taxonomy nodes")

    bdi_counts = {}
    for nid in nodes:
        cat = get_bdi_category(nid)
        bdi_counts[cat] = bdi_counts.get(cat, 0) + 1
    for cat, count in sorted(bdi_counts.items()):
        log(f"  {cat}: {count}")

    golden_path = RESEARCH_DIR / "_golden_test_set.json"

    existing_node_ids = set()
    output_path = Path(args.output)
    if args.skip_existing and output_path.exists():
        existing = json.loads(output_path.read_text(encoding="utf-8"))
        existing_node_ids = {p["node_id"] for p in existing.get("pairs", [])}
        log(f"Skipping {len(existing_node_ids)} nodes already in output")

    node_ids = sorted(nodes.keys())
    if existing_node_ids:
        node_ids = [nid for nid in node_ids if nid not in existing_node_ids]
    if args.limit > 0:
        node_ids = node_ids[:args.limit]

    log(f"Generating {args.count} claims each for {len(node_ids)} nodes")
    log(f"  Expected output: ~{len(node_ids) * args.count} debate claims")
    log(f"  Estimated API calls: {len(node_ids)}")

    results = {
        "metadata": {
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "count_per_node": args.count,
            "total_nodes": len(node_ids),
            "model": args.model,
            "source": "debate_register_augmentation",
        },
        "pairs": [],
    }

    if args.skip_existing and output_path.exists():
        existing = json.loads(output_path.read_text(encoding="utf-8"))
        results["pairs"] = existing.get("pairs", [])

    success = 0
    failed = 0

    for i, node_id in enumerate(node_ids):
        node = nodes[node_id]
        ga = node.get("graph_attributes", {})
        desc = node.get("description", "")
        assumes = "; ".join(ga.get("assumes", [])) or "None listed"
        rhetorical = ga.get("rhetorical_strategy", "unknown")
        epistemic = ga.get("epistemic_type", "unknown")
        pov = get_pov_from_id(node_id)
        pov_prefix = node_id.split("-")[0]
        bdi_cat = get_bdi_category(node_id)

        few_shots = load_few_shot_examples(golden_path, pov_prefix, bdi_cat)
        few_shot_text = "\n".join(f'- "{c}"' for c in few_shots) if few_shots else "No examples available."

        prompt = GENERATION_PROMPT.format(
            count=args.count,
            node_id=node_id,
            description=desc[:500],
            assumes=assumes[:300],
            rhetorical_strategy=rhetorical,
            epistemic_type=epistemic,
            speaker_pov=pov,
            bdi_category=bdi_cat,
            bdi_nature=BDI_NATURE.get(bdi_cat, "epistemic"),
            few_shot_examples=few_shot_text,
        )

        if args.dry_run:
            log(f"  [{i+1}/{len(node_ids)}] {node_id} ({pov}/{bdi_cat}): DRY RUN — {len(prompt)} chars")
            continue

        log(f"  [{i+1}/{len(node_ids)}] {node_id} ({pov}/{bdi_cat}): generating...")
        claims = generate_claims_gemini(prompt, args.model)

        if claims:
            success += 1
            for claim_text in claims:
                results["pairs"].append({
                    "text": claim_text,
                    "node_id": node_id,
                    "source": "debate_register_synthetic",
                    "weight": 0.9,
                    "metadata": {"pov": pov, "bdi_category": bdi_cat},
                })
            log(f"    {len(claims)} claims generated")
        else:
            failed += 1
            log(f"    FAILED")

        if (i + 1) % args.batch_size == 0:
            output_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
            log(f"    Checkpoint saved ({len(results['pairs'])} pairs)")

        time.sleep(0.3)

    results["metadata"]["successful_nodes"] = success
    results["metadata"]["failed_nodes"] = failed
    results["metadata"]["total_pairs"] = len(results["pairs"])
    results["metadata"]["positive_pairs"] = sum(1 for p in results["pairs"] if p["weight"] > 0)

    output_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"\nDone: {len(results['pairs'])} debate claims for {success}/{len(node_ids)} nodes")
    log(f"Written to {output_path}")


if __name__ == "__main__":
    main()
