import argparse
import json
import os
import random
import sys
from pathlib import Path

# Path setup
SCRIPT_DIR = Path(__file__).resolve().parent
RESEARCH_DIR = SCRIPT_DIR
REPO_ROOT = SCRIPT_DIR.parent.parent.parent # This needs to go up to ai-triad-research

GENERATION_PROMPT = """You are generating concise, natural-language statements that articulate a specific Point of View's (POV) stance on a situation, grounded in its Beliefs, Desires, or Intentions (BDI).

SITUATION NODE:
ID: {node_id}
Description: {description}

POV: {speaker_pov}
BDI CATEGORY: {bdi_category}
BDI INTERPRETATION: {bdi_interpretation}

REQUIREMENTS:
- Generate exactly ONE short statement (1-3 sentences) that reflects the {speaker_pov}'s {bdi_category} regarding the situation.
- The statement must be grounded in the provided 'BDI INTERPRETATION'. Do NOT invent new information.
- Use informal, debate-like language — NOT academic or ontological.
- Stay strictly in-character for the {speaker_pov}. Do NOT collapse disagreement or introduce neutrality.
- Output as a plain string, representing the single statement. No other text or JSON.

EXAMPLES OF CONCISE POV-BDI STATEMENTS:
{few_shot_examples}
"""

BDI_NATURE = {
    "beliefs": "epistemic (what the speaker believes to be true)",
    "desires": "motivational (what the speaker wants or values)",
    "intentions": "action-oriented (what the speaker plans or commits to doing)",
}

def log(msg: str):
    print(f"[situation-gen] {msg}", file=sys.stderr)

def load_situation_nodes(data_root: Path, taxonomy_dir_rel: str) -> dict:
    taxonomy_dir = data_root / taxonomy_dir_rel
    nodes = {}
    for pov_file in ["safetyist.json", "accelerationist.json", "skeptic.json"]:
        path = taxonomy_dir / pov_file
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            node_list = data.get("nodes", data)
            if isinstance(node_list, dict):
                node_list = list(node_list.values())
            for n in node_list:
                nid = n.get("id", "")
                if nid and (nid.startswith("sit-") or nid.startswith("cc-")) and n.get("interpretations"):
                    nodes[nid] = n
        except json.JSONDecodeError:
            log(f"WARNING: Could not parse JSON from {path}")
            continue
    return nodes

def get_bdi_category(node_id: str) -> str:
    # Situation nodes don't have BDI in their ID, so this is a stub
    return "unknown"

def get_pov_from_id(node_id: str) -> str:
    # Situation nodes are shared, so this is also a stub for them.
    # The POV will be determined by the iteration over interpretations.
    return "unknown"

def load_few_shot_examples(golden_path: Path, speaker_pov: str, bdi_cat: str) -> list[str]:
    if not golden_path.exists():
        return []
    try:
        data = json.loads(golden_path.read_text(encoding="utf-8"))
        # Assuming golden_path contains a list of example statements, possibly with metadata
        # For now, let's assume it's a list of dictionaries, each with 'text', 'pov', 'bdi_category'
        examples = data.get("examples", []) # Adjust key if needed
        matching = [e["text"] for e in examples
                    if e.get("pov") == speaker_pov
                    and e.get("bdi_category") == bdi_cat]
        random.shuffle(matching)
        return matching[:2] # Return up to 2 examples
    except json.JSONDecodeError:
        log(f"WARNING: Could not parse golden examples from {golden_path}")
        return []

def generate_statement_llm(prompt: str, model_name: str = "gemini-2.5-flash") -> str:
    try:
        from google import genai
    except ImportError:
        log("ERROR: google-genai not installed. Run: pip install google-genai")
        return ""

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("AI_API_KEY")
    if not api_key:
        log("ERROR: Set GEMINI_API_KEY or AI_API_KEY environment variable")
        return ""

    client = genai.Client(api_key=api_key)
    try:
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                temperature=0.7, # Lower temperature for more focused statements
                max_output_tokens=200, # Max 3 sentences, so relatively short output
            ),
        )
        text = response.text.strip()
        return text
    except Exception as e:
        log(f"  Generation error: {e}")
    return ""


def main():
    parser = argparse.ArgumentParser(description="Generate per-POV BDI statements for situation nodes")
    parser.add_argument("--output", "-o", default=str(RESEARCH_DIR / "situation_statements_corpus.json"))
    parser.add_argument("--limit", type=int, default=0,
                        help="Process only first N nodes (0 = all)")
    parser.add_argument("--model", default="gemini-2.5-flash")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--skip-existing", action="store_true",
                        help="Skip nodes already in output file")
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

    nodes = load_situation_nodes(data_root, taxonomy_dir_rel)
    log(f"Loaded {len(nodes)} situation nodes with interpretations")

    output_path = Path(args.output)
    existing_statements = {} # Store in memory for easy lookup
    if args.skip_existing and output_path.exists():
        try:
            existing_data = json.loads(output_path.read_text(encoding="utf-8"))
            for item in existing_data:
                existing_statements[item["node_id"]] = item # Assuming output is list of dicts with node_id
            log(f"Skipping {len(existing_statements)} nodes already in output")
        except json.JSONDecodeError:
            log(f"WARNING: Could not parse existing output file {output_path}. Starting fresh.")

    processed_statements = []
    if existing_statements: # If we loaded existing, start with them
        for nid, item in existing_statements.items():
            processed_statements.append(item)

    node_ids_to_process = sorted(nodes.keys())
    if args.skip_existing:
        node_ids_to_process = [nid for nid in node_ids_to_process if nid not in existing_statements]
    if args.limit > 0:
        node_ids_to_process = node_ids_to_process[:args.limit]

    golden_path = RESEARCH_DIR / "_golden_test_set.json"

    log(f"Starting generation for {len(node_ids_to_process)} situation nodes...")

    for i, node_id in enumerate(node_ids_to_process):
        node = nodes[node_id]
        log(f"Processing node {i+1}/{len(node_ids_to_process)}: {node_id}")

        if not node.get("interpretations"): # Double check filtering
            log(f"  Skipping {node_id}: no interpretations found.")
            continue

        node_statements = {"node_id": node_id, "statements": []}
        povs = ["accelerationist", "safetyist", "skeptic"]
        bdi_categories = ["beliefs", "desires", "intentions"]

        for speaker_pov in povs:
            for bdi_category in bdi_categories:
                interpretation = node["interpretations"].get(speaker_pov, {}).get(bdi_category)
                if interpretation: # Only generate if interpretation exists
                    log(f"    Generating for POV: {speaker_pov}, BDI: {bdi_category}")
                    few_shot_texts = load_few_shot_examples(golden_path, speaker_pov, bdi_category)
                    few_shot_formatted = "\n".join([f"- {t}" for t in few_shot_texts]) if few_shot_texts else "No examples provided."

                    formatted_prompt = GENERATION_PROMPT.format(
                        node_id=node["id"],
                        description=node["description"],
                        speaker_pov=speaker_pov,
                        bdi_category=bdi_category,
                        bdi_interpretation=interpretation,
                        few_shot_examples=few_shot_formatted
                    )
                    statement = generate_statement_llm(formatted_prompt, args.model)
                    if statement:
                        log(f"      Generated: {statement[:50]}...")
                        node_statements["statements"].append({
                            "pov": speaker_pov,
                            "bdi_category": bdi_category,
                            "statement": statement
                        })
                    else:
                        log(f"      Failed to generate statement for {speaker_pov} {bdi_category}.")
                else:
                    log(f"    Skipping {speaker_pov} {bdi_category}: no interpretation.")

        if node_statements["statements"]:
            processed_statements.append(node_statements)
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(processed_statements, f, indent=2, ensure_ascii=False)
            log(f"  Saved statements for {node_id}. Total processed: {len(processed_statements)}")

    log("Generation complete.")

if __name__ == "__main__":
    main()
