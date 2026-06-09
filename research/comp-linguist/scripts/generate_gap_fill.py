#!/usr/bin/env python3
"""
generate_gap_fill.py — Generate synthetic debate claims for gap nodes.

Reads the training corpus to identify gap nodes (no source coverage),
then generates synthetic claims using node attributes as context.

Requires: GEMINI_API_KEY or AI_API_KEY environment variable.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
RESEARCH_DIR = SCRIPT_DIR.parent
REPO_ROOT = RESEARCH_DIR.parent.parent


def log(msg: str):
    print(f"[gap-fill] {msg}", file=sys.stderr)


GENERATION_PROMPT = """You are generating training data for a semantic matching system. Given a taxonomy node description, generate {count} diverse debate claims that a real speaker would make when arguing for or engaging with this concept.

NODE:
ID: {node_id}
Description: {description}
Assumes: {assumes}
Rhetorical strategy: {rhetorical_strategy}
Epistemic type: {epistemic_type}

REQUIREMENTS:
- Use informal, rhetorical debate language — NOT academic or ontological language
- Include hedges ("arguably", "I think"), connectives ("but look", "the thing is"), and concrete examples where appropriate
- Vary specificity: some abstract claims, some with concrete scenarios
- Generate from the perspective of a {speaker_pov} speaker
- Each claim should be 1-3 sentences, as it would appear in a debate transcript

EXAMPLES OF REAL DEBATE CLAIMS (for register calibration):
{few_shot_examples}

Generate exactly {count} claims. Output as a JSON array of strings. No other text."""


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


def get_pov_from_id(node_id: str) -> str:
    prefix = node_id.split("-")[0]
    return {"acc": "accelerationist", "saf": "safetyist", "skp": "skeptic"}.get(prefix, "unknown")


def load_few_shot_examples(golden_path: Path, category: str, pov_prefix: str, n: int = 3) -> list[str]:
    if not golden_path.exists():
        return []
    data = json.loads(golden_path.read_text(encoding="utf-8"))
    claims = data.get("claims", [])
    matching = [c for c in claims
                if c.get("attributed_node", "").startswith(pov_prefix)
                and category in c.get("attributed_node", "")]
    if not matching:
        matching = [c for c in claims if c.get("attributed_node", "").startswith(pov_prefix)]
    if not matching:
        matching = claims[:n]
    import random
    random.shuffle(matching)
    return [c["claim_text"] for c in matching[:n]]


def generate_claims_gemini(prompt: str) -> list[str]:
    """Call Gemini API to generate synthetic claims."""
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
            model="gemini-2.5-flash",
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                temperature=0.9,
                max_output_tokens=2000,
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
    parser = argparse.ArgumentParser(description="Generate synthetic claims for gap nodes")
    parser.add_argument("--corpus", default=str(RESEARCH_DIR / "training_corpus.json"),
                        help="Training corpus JSON (to identify gap nodes)")
    parser.add_argument("--output", "-o", default=str(RESEARCH_DIR / "gap_fill_claims.json"),
                        help="Output path for generated claims")
    parser.add_argument("--count", type=int, default=15,
                        help="Number of claims to generate per node")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show prompts without calling API")
    args = parser.parse_args()

    aitriad_path = REPO_ROOT / ".aitriad.json"
    data_root = REPO_ROOT / ".." / "ai-triad-data"
    taxonomy_dir_rel = "taxonomy/Origin"
    if aitriad_path.exists():
        raw = json.loads(aitriad_path.read_text(encoding="utf-8"))
        if "data_root" in raw:
            data_root = (REPO_ROOT / raw["data_root"]).resolve()
        if "taxonomy_dir" in raw:
            taxonomy_dir_rel = raw["taxonomy_dir"]

    corpus = json.loads(Path(args.corpus).read_text(encoding="utf-8"))
    gap_node_ids = corpus.get("gap_nodes", [])
    log(f"Gap nodes to fill: {len(gap_node_ids)}")

    if not gap_node_ids:
        log("No gap nodes — nothing to generate")
        return

    nodes = load_taxonomy_nodes(data_root, taxonomy_dir_rel)
    golden_path = RESEARCH_DIR / "_golden_test_set.json"

    results = {
        "metadata": {
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "count_per_node": args.count,
            "gap_nodes": len(gap_node_ids),
        },
        "pairs": [],
    }

    for i, node_id in enumerate(gap_node_ids):
        node = nodes.get(node_id, {})
        if not node:
            log(f"  [{i+1}/{len(gap_node_ids)}] {node_id}: NOT FOUND in taxonomy — skipping")
            continue

        ga = node.get("graph_attributes", {})
        desc = node.get("description", "")
        assumes = "; ".join(ga.get("assumes", [])) or "None listed"
        rhetorical = ga.get("rhetorical_strategy", "unknown")
        epistemic = ga.get("epistemic_type", "unknown")
        pov = get_pov_from_id(node_id)
        pov_prefix = node_id.split("-")[0]
        category = node_id.split("-")[1] if "-" in node_id else "beliefs"

        few_shots = load_few_shot_examples(golden_path, category, pov_prefix)
        few_shot_text = "\n".join(f"- \"{c}\"" for c in few_shots) if few_shots else "No examples available."

        prompt = GENERATION_PROMPT.format(
            count=args.count,
            node_id=node_id,
            description=desc[:500],
            assumes=assumes[:300],
            rhetorical_strategy=rhetorical,
            epistemic_type=epistemic,
            speaker_pov=pov,
            few_shot_examples=few_shot_text,
        )

        if args.dry_run:
            log(f"  [{i+1}/{len(gap_node_ids)}] {node_id} ({pov}): DRY RUN")
            log(f"    Prompt length: {len(prompt)} chars")
            continue

        log(f"  [{i+1}/{len(gap_node_ids)}] {node_id} ({pov}): generating {args.count} claims...")
        claims = generate_claims_gemini(prompt)
        log(f"    Generated {len(claims)} claims")

        for claim_text in claims:
            results["pairs"].append({
                "text": claim_text,
                "node_id": node_id,
                "source": "synthetic_gap_fill",
                "weight": 0.7,
                "metadata": {
                    "pov": pov,
                    "category": category,
                }
            })

        time.sleep(0.5)

    output_path = Path(args.output)
    output_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"\nGenerated {len(results['pairs'])} total synthetic claims for {len(gap_node_ids)} gap nodes")
    log(f"Written to {output_path}")


if __name__ == "__main__":
    main()
