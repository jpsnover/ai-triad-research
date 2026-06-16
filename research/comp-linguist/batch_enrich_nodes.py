"""
Batch enrichment script for t/600: Generate attribution_text, synthetic_phrases,
and all graph_attributes for debate-modified taxonomy nodes missing enrichment.

Uses Gemini 2.5 Flash (free tier) for LLM calls, sentence-transformers for embeddings.
Writes results directly to POV JSON files and synthetic_embeddings.json.

Usage:
    python batch_enrich_nodes.py [--dry-run] [--limit N] [--resume]
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

from google import genai
from google.genai import types
from sentence_transformers import SentenceTransformer

DATA_ROOT = Path("C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin")
POV_FILES = {
    "accelerationist": DATA_ROOT / "accelerationist.json",
    "safetyist": DATA_ROOT / "safetyist.json",
    "skeptic": DATA_ROOT / "skeptic.json",
}
SYNTHETIC_DIR = DATA_ROOT / "synthetic"
SYNTHETIC_EMBEDDINGS_FILE = SYNTHETIC_DIR / "synthetic_embeddings.json"
CHECKPOINT_FILE = Path(__file__).parent / "_enrich_checkpoint.json"

POV_LABELS = {
    "acc": "accelerationist",
    "saf": "safetyist",
    "skp": "skeptic",
    "cc": "cross-cutting",
}

ENRICHMENT_FIELDS = [
    "epistemic_type", "rhetorical_strategy", "assumes", "falsifiability",
    "audience", "emotional_register", "intellectual_lineage",
    "steelman_vulnerability", "node_scope", "attribution_text", "synthetic_phrases",
]


def build_enrichment_prompt(node: dict) -> str:
    pov_prefix = node["id"].split("-")[0]
    pov_name = POV_LABELS.get(pov_prefix, pov_prefix)
    return f"""You are a research analyst for a multi-perspective AI policy taxonomy.

A taxonomy node needs rich analytical attributes. Generate them.

Node:
  ID: {node["id"]}
  Label: {node["label"]}
  Description: {node["description"]}
  Category: {node["category"]}
  POV: {pov_name}

Generate a JSON object with these fields:

  epistemic_type (string, pick ONE): "normative_prescription", "empirical_claim", "definitional", "strategic_recommendation", "predictive", "interpretive_lens"

  rhetorical_strategy (string, pick ONE): "precautionary_framing", "inevitability_framing", "cost_benefit_analysis", "moral_imperative", "appeal_to_evidence", "appeal_to_authority", "analogical_reasoning", "techno_optimism", "structural_critique"

  assumes (array of 1-3 strings): Key premises that must be true for this node to hold. Be specific and concrete.

  falsifiability (string): "high", "medium", or "low". Beliefs -> more likely high/medium. Desires -> more likely low. Intentions -> usually medium.

  audience (string, pick 1-2 comma-separated): "policymakers", "technical_researchers", "industry_leaders", "general_public", "civil_society", "academic_community"

  emotional_register (string): "urgent", "measured", "optimistic", "cautionary", "defiant", "pragmatic", "alarmed", "dismissive", "aspirational"

  intellectual_lineage (array of 1-3 strings): Major intellectual traditions, thinkers, or frameworks this node draws from. Be specific.

  steelman_vulnerability (string): The strongest counterargument against the STRONGEST version of this claim. 1-2 sentences.

  node_scope (string): "claim" (specific assertion), "scheme" (argumentative strategy), or "bridging" (connects claims to schemes).

  attribution_text (string): Rewrite this node's description in genus-differentia format:
    "A [BDI category] within [POV] discourse that [core proposition]. Encompasses: [key facets]."
    Example: "A Belief within accelerationist discourse that recursive self-improvement in frontier models produces capability overhang exceeding current scalable oversight methods. Encompasses: recursive self-improvement dynamics, capability overhang measurement, oversight scaling limitations."

  synthetic_phrases (array of 6-8 strings): Diverse paraphrases of this node's description, as if stated by different speakers in a policy debate.
    Vary register (academic, policy brief, conversational, rhetorical), sentence structure, and framing while preserving semantic meaning.
    Each phrase should be 1-2 sentences. Include at least one that uses domain-specific jargon and one that is accessible to a general audience.

Return ONLY valid JSON. No markdown fencing, no preamble."""


def find_gap_nodes() -> list[dict]:
    """Find all nodes that need enrichment: debate-modified nodes missing attribution_text
    or synthetic_phrases."""
    gaps = []
    for pov_name, pov_path in POV_FILES.items():
        data = json.loads(pov_path.read_text(encoding="utf-8"))
        for node in data.get("nodes", []):
            ga = node.get("graph_attributes") or {}
            debate_refs = node.get("debate_refs") or []
            has_attr_text = bool(ga.get("attribution_text"))
            has_synth = bool(ga.get("synthetic_phrases"))

            needs_enrichment = False
            if debate_refs and not has_attr_text:
                needs_enrichment = True
            elif has_attr_text and not has_synth:
                needs_enrichment = True

            if needs_enrichment:
                gaps.append({
                    "id": node["id"],
                    "label": node["label"],
                    "description": node["description"],
                    "category": node["category"],
                    "pov_file": pov_name,
                    "has_attribution_text": has_attr_text,
                    "has_synthetic_phrases": has_synth,
                })
    return gaps


def parse_llm_json(text: str) -> dict | None:
    """Extract JSON from LLM response, handling markdown fencing."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        json_match = re.search(r"\{[\s\S]*\}", text)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                return None
    return None


def validate_enrichment(result: dict) -> dict | None:
    """Validate and normalize enrichment result."""
    if not isinstance(result, dict):
        return None
    if not result.get("attribution_text") or not result.get("synthetic_phrases"):
        return None
    if not isinstance(result["synthetic_phrases"], list) or len(result["synthetic_phrases"]) < 3:
        return None
    validated = {}
    for field in ENRICHMENT_FIELDS:
        if field in result and result[field]:
            validated[field] = result[field]
    return validated if "attribution_text" in validated and "synthetic_phrases" in validated else None


def load_checkpoint() -> set[str]:
    if CHECKPOINT_FILE.exists():
        return set(json.loads(CHECKPOINT_FILE.read_text(encoding="utf-8")))
    return set()


def save_checkpoint(completed: set[str]):
    CHECKPOINT_FILE.write_text(json.dumps(sorted(completed)), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Batch enrich taxonomy nodes")
    parser.add_argument("--dry-run", action="store_true", help="List nodes without enriching")
    parser.add_argument("--limit", type=int, default=0, help="Max nodes to process (0=all)")
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoint")
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key and not args.dry_run:
        print("ERROR: GEMINI_API_KEY not set")
        sys.exit(1)

    gaps = find_gap_nodes()
    print(f"Found {len(gaps)} nodes needing enrichment")
    print(f"  - Missing attribution_text: {sum(1 for g in gaps if not g['has_attribution_text'])}")
    print(f"  - Has attribution_text, missing synthetic_phrases: {sum(1 for g in gaps if g['has_attribution_text'])}")

    if args.dry_run:
        for g in gaps:
            status = "FULL" if not g["has_attribution_text"] else "SYNTH_ONLY"
            print(f"  [{status}] {g['id']}: {g['label']}")
        return

    completed = load_checkpoint() if args.resume else set()
    if completed:
        print(f"Resuming: {len(completed)} nodes already completed")
    remaining = [g for g in gaps if g["id"] not in completed]
    if args.limit:
        remaining = remaining[:args.limit]
    print(f"Will process {len(remaining)} nodes")

    client = genai.Client(api_key=api_key)

    print("Loading embedding model...")
    embed_model = SentenceTransformer("all-MiniLM-L6-v2")
    print("Embedding model ready")

    pov_data = {}
    for pov_name, pov_path in POV_FILES.items():
        pov_data[pov_name] = json.loads(pov_path.read_text(encoding="utf-8"))

    SYNTHETIC_DIR.mkdir(parents=True, exist_ok=True)
    if SYNTHETIC_EMBEDDINGS_FILE.exists():
        synth_emb = json.loads(SYNTHETIC_EMBEDDINGS_FILE.read_text(encoding="utf-8"))
    else:
        synth_emb = {"model": "all-MiniLM-L6-v2", "dimension": 384, "node_count": 0, "nodes": {}}

    success = 0
    failures = []
    save_interval = 5

    for i, gap in enumerate(remaining):
        node_id = gap["id"]
        print(f"\n[{i+1}/{len(remaining)}] {node_id}: {gap['label'][:60]}")

        node_in_pov = None
        for node in pov_data[gap["pov_file"]].get("nodes", []):
            if node["id"] == node_id:
                node_in_pov = node
                break

        if not node_in_pov:
            print(f"  ERROR: Node {node_id} not found in {gap['pov_file']}.json")
            failures.append({"id": node_id, "error": "not found in POV file"})
            continue

        prompt = build_enrichment_prompt(gap)

        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.3,
                        max_output_tokens=4096,
                    ),
                )
                result = parse_llm_json(response.text)
                if result:
                    validated = validate_enrichment(result)
                    if validated:
                        break
                    else:
                        has_at = bool(result.get("attribution_text"))
                        has_sp = result.get("synthetic_phrases")
                        sp_len = len(has_sp) if isinstance(has_sp, list) else 0
                        print(f"  Attempt {attempt+1}: validation failed (attr={has_at}, phrases={sp_len}), retrying...")
                else:
                    print(f"  Attempt {attempt+1}: JSON parse failed, first 200 chars: {response.text[:200]}")
                time.sleep(2)
            except Exception as e:
                print(f"  Attempt {attempt+1} error: {e}")
                if "429" in str(e) or "quota" in str(e).lower():
                    wait = 30 * (attempt + 1)
                    print(f"  Rate limited, waiting {wait}s...")
                    time.sleep(wait)
                else:
                    time.sleep(5)
                validated = None
        else:
            validated = None

        if not validated:
            print(f"  FAILED after 3 attempts")
            failures.append({"id": node_id, "error": "enrichment failed after retries"})
            continue

        ga = node_in_pov.get("graph_attributes") or {}
        for field in ENRICHMENT_FIELDS:
            if field in validated:
                ga[field] = validated[field]
        node_in_pov["graph_attributes"] = ga

        phrases = validated["synthetic_phrases"]
        attr_text = validated["attribution_text"]
        all_texts = [attr_text] + phrases
        vectors = embed_model.encode(all_texts).tolist()

        pov_prefix = node_id.split("-")[0]
        pov_label = POV_LABELS.get(pov_prefix, pov_prefix)
        synth_emb["nodes"][node_id] = {"pov": pov_label, "vectors": vectors}
        synth_emb["node_count"] = len(synth_emb["nodes"])

        completed.add(node_id)
        success += 1
        print(f"  OK: {len(phrases)} phrases, {len(vectors)} vectors")

        if success % save_interval == 0:
            print(f"  Saving checkpoint ({success} completed)...")
            for pov_name, pov_path in POV_FILES.items():
                pov_path.write_text(
                    json.dumps(pov_data[pov_name], indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
            SYNTHETIC_EMBEDDINGS_FILE.write_text(
                json.dumps(synth_emb, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            save_checkpoint(completed)

        time.sleep(1)

    print(f"\nSaving final results...")
    for pov_name, pov_path in POV_FILES.items():
        pov_path.write_text(
            json.dumps(pov_data[pov_name], indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    SYNTHETIC_EMBEDDINGS_FILE.write_text(
        json.dumps(synth_emb, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    save_checkpoint(completed)

    print(f"\n{'='*60}")
    print(f"RESULTS: {success} enriched, {len(failures)} failed")
    if failures:
        print(f"\nFailed nodes:")
        for f in failures:
            print(f"  {f['id']}: {f['error']}")
    print(f"\nFiles updated:")
    for pov_name, pov_path in POV_FILES.items():
        print(f"  {pov_path}")
    print(f"  {SYNTHETIC_EMBEDDINGS_FILE}")

    if CHECKPOINT_FILE.exists() and not failures:
        CHECKPOINT_FILE.unlink()
        print("Checkpoint cleared (all complete)")


if __name__ == "__main__":
    main()
