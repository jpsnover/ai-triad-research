"""
Quality validation: Gemma 4 E4B (local via Ollama) vs Gemini Flash Lite (cloud)
Tests 4 Tier-1 candidate tasks with 10 samples each.
"""
import json, time, sys, os

# Ollama API (OpenAI-compatible)
OLLAMA_URL = "http://localhost:11434/v1/chat/completions"
OLLAMA_MODEL = "gemma4:e4b-it-q4_K_M"

# Test data
TAXONOMY_DIR = os.path.join(os.path.dirname(__file__), "../../ai-triad-data/taxonomy/Origin")

def load_sample_nodes(count=10):
    """Load sample taxonomy nodes for testing."""
    nodes = []
    for f in ["accelerationist.json", "safetyist.json", "skeptic.json"]:
        path = os.path.join(TAXONOMY_DIR, f)
        if not os.path.exists(path):
            continue
        data = json.load(open(path, encoding="utf-8"))
        for n in data.get("nodes", []):
            if n.get("description") and len(n["description"]) > 50:
                nodes.append(n)
            if len(nodes) >= count:
                break
        if len(nodes) >= count:
            break
    return nodes[:count]

def call_ollama(prompt, json_mode=False):
    """Call Ollama's OpenAI-compatible API."""
    import urllib.request
    body = {
        "model": OLLAMA_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "stream": False,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    start = time.time()
    try:
        resp = urllib.request.urlopen(req, timeout=120)
        result = json.loads(resp.read())
        elapsed = time.time() - start
        text = result["choices"][0]["message"]["content"]
        return {"text": text, "elapsed_ms": int(elapsed * 1000), "ok": True}
    except Exception as e:
        return {"text": "", "elapsed_ms": int((time.time() - start) * 1000), "ok": False, "error": str(e)}

def test_summarization(nodes):
    """Test 1: Entry summarization (brief tier)."""
    print("\n=== TEST 1: Entry Summarization (Brief) ===")
    results = []
    for i, node in enumerate(nodes):
        prompt = f"Summarize the following taxonomy node description in 2-3 sentences for a policy audience:\n\n{node['description']}"
        print(f"  [{i+1}/{len(nodes)}] {node['id']}...", end=" ", flush=True)
        r = call_ollama(prompt)
        print(f"{'OK' if r['ok'] else 'FAIL'} ({r['elapsed_ms']}ms)")
        results.append({
            "node_id": node["id"],
            "ok": r["ok"],
            "elapsed_ms": r["elapsed_ms"],
            "response_length": len(r["text"]),
            "response_preview": r["text"][:200],
        })
    return results

def test_lineage_enrichment(items):
    """Test 2: Lineage enrichment (2-5 sentence description)."""
    print("\n=== TEST 2: Lineage Enrichment ===")
    lineage_names = [
        "Effective Altruism", "Regulatory Capture Theory", "Rawlsian Distributive Justice",
        "Chicago School Economics", "Precautionary Principle", "Techno-Optimism",
        "Critical Race Theory", "Institutional Economics", "Game Theory (Strategic Interaction)",
        "Social Contract Theory"
    ]
    results = []
    for i, name in enumerate(lineage_names):
        prompt = f"""Enrich this intellectual lineage entry with a description, URL, and category.

- name: {name}
- description: 2-5 sentence definition accessible to a policy audience
- url: Wikipedia or authoritative URL (prefer Wikipedia when available)
- category: one of: philosophical_movement, economic_theory, political_philosophy, social_theory, scientific_paradigm, legal_framework, technology_movement, ethical_framework, academic_discipline, cultural_movement, other

Return a JSON object. No markdown fences."""
        print(f"  [{i+1}/{len(lineage_names)}] {name}...", end=" ", flush=True)
        r = call_ollama(prompt, json_mode=True)

        # Check JSON compliance
        json_ok = False
        if r["ok"]:
            try:
                parsed = json.loads(r["text"])
                json_ok = "description" in parsed and "category" in parsed
            except:
                # Try stripping markdown fences
                text = r["text"].strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
                try:
                    parsed = json.loads(text)
                    json_ok = "description" in parsed and "category" in parsed
                except:
                    pass

        print(f"{'OK' if r['ok'] else 'FAIL'} json={'YES' if json_ok else 'NO'} ({r['elapsed_ms']}ms)")
        results.append({
            "name": name,
            "ok": r["ok"],
            "json_compliant": json_ok,
            "elapsed_ms": r["elapsed_ms"],
            "response_preview": r["text"][:200],
        })
    return results

def test_steelman(nodes):
    """Test 3: Steelman vulnerability analysis."""
    print("\n=== TEST 3: Steelman/Vulnerability Analysis ===")
    results = []
    for i, node in enumerate(nodes):
        prompt = f"""Analyze this taxonomy node's steelman vulnerability — identify the strongest possible counter-argument that an intellectually honest opponent would make.

Node: {node['label']}
Description: {node['description'][:500]}

Return a JSON object with:
- vulnerability: string (the steelman counter-argument, 2-3 sentences)
- attack_vector: string (which aspect is most vulnerable)
- confidence: "high" | "medium" | "low"

No markdown fences."""
        print(f"  [{i+1}/{len(nodes)}] {node['id']}...", end=" ", flush=True)
        r = call_ollama(prompt, json_mode=True)

        json_ok = False
        if r["ok"]:
            try:
                text = r["text"].strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
                parsed = json.loads(text)
                json_ok = "vulnerability" in parsed
            except:
                pass

        print(f"{'OK' if r['ok'] else 'FAIL'} json={'YES' if json_ok else 'NO'} ({r['elapsed_ms']}ms)")
        results.append({
            "node_id": node["id"],
            "ok": r["ok"],
            "json_compliant": json_ok,
            "elapsed_ms": r["elapsed_ms"],
            "response_preview": r["text"][:200],
        })
    return results

def test_attribute_extraction(nodes):
    """Test 4: Graph attribute extraction."""
    print("\n=== TEST 4: Graph Attribute Extraction ===")
    results = []
    for i, node in enumerate(nodes):
        prompt = f"""Classify this taxonomy node's graph attributes.

Node: {node['label']}
Category: {node.get('category', 'unknown')}
Description: {node['description'][:500]}

Return a JSON object with:
- epistemic_type: one of "empirical_claim", "normative_prescription", "interpretive_lens", "definitional", "strategic_recommendation"
- rhetorical_strategy: one of "techno_optimism", "precautionary", "evidence_based", "structural_critique", "pragmatic_compromise"
- falsifiability: "high" | "medium" | "low"

No markdown fences."""
        print(f"  [{i+1}/{len(nodes)}] {node['id']}...", end=" ", flush=True)
        r = call_ollama(prompt, json_mode=True)

        json_ok = False
        correct_types = False
        if r["ok"]:
            try:
                text = r["text"].strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
                parsed = json.loads(text)
                json_ok = "epistemic_type" in parsed and "falsifiability" in parsed
                valid_et = {"empirical_claim", "normative_prescription", "interpretive_lens", "definitional", "strategic_recommendation"}
                valid_f = {"high", "medium", "low"}
                correct_types = parsed.get("epistemic_type") in valid_et and parsed.get("falsifiability") in valid_f
            except:
                pass

        print(f"{'OK' if r['ok'] else 'FAIL'} json={'YES' if json_ok else 'NO'} types={'YES' if correct_types else 'NO'} ({r['elapsed_ms']}ms)")
        results.append({
            "node_id": node["id"],
            "ok": r["ok"],
            "json_compliant": json_ok,
            "correct_value_types": correct_types,
            "elapsed_ms": r["elapsed_ms"],
            "response_preview": r["text"][:200],
        })
    return results

def main():
    print("=== Gemma 4 E4B Quality Validation ===")
    print(f"Model: {OLLAMA_MODEL}")
    print(f"Endpoint: {OLLAMA_URL}")

    nodes = load_sample_nodes(10)
    if len(nodes) < 10:
        print(f"WARNING: Only {len(nodes)} sample nodes found")

    all_results = {}

    all_results["summarization"] = test_summarization(nodes)
    all_results["lineage"] = test_lineage_enrichment(None)
    all_results["steelman"] = test_steelman(nodes)
    all_results["attributes"] = test_attribute_extraction(nodes)

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    for task, results in all_results.items():
        ok_count = sum(1 for r in results if r["ok"])
        json_count = sum(1 for r in results if r.get("json_compliant", True))
        avg_ms = sum(r["elapsed_ms"] for r in results) / max(len(results), 1)
        type_count = sum(1 for r in results if r.get("correct_value_types", True))

        print(f"\n{task.upper()}:")
        print(f"  Success rate: {ok_count}/{len(results)} ({ok_count/max(len(results),1)*100:.0f}%)")
        if any("json_compliant" in r for r in results):
            print(f"  JSON compliance: {json_count}/{len(results)} ({json_count/max(len(results),1)*100:.0f}%)")
        if any("correct_value_types" in r for r in results):
            print(f"  Value type accuracy: {type_count}/{len(results)} ({type_count/max(len(results),1)*100:.0f}%)")
        print(f"  Avg latency: {avg_ms:.0f}ms")

    # Write full results
    output_path = os.path.join(os.path.dirname(__file__), "gemma4-validation-results.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2)
    print(f"\nFull results: {output_path}")

if __name__ == "__main__":
    main()
