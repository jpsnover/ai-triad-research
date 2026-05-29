"""Gemma 4 E4B GPU-optimized quality validation."""
import json, time, os, urllib.request

OLLAMA_URL = "http://localhost:11434/v1/chat/completions"
OLLAMA_MODEL = "gemma4:e4b-it-q4_K_M"

def call(prompt, json_mode=False):
    body = {"model": OLLAMA_MODEL, "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2, "stream": False}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(OLLAMA_URL, data=json.dumps(body).encode(),
                                headers={"Content-Type": "application/json"})
    start = time.time()
    try:
        resp = urllib.request.urlopen(req, timeout=180)
        result = json.loads(resp.read())
        return {"text": result["choices"][0]["message"]["content"],
                "ms": int((time.time() - start) * 1000), "ok": True}
    except Exception as e:
        return {"text": "", "ms": int((time.time() - start) * 1000),
                "ok": False, "err": str(e)[:80]}

def try_parse(text):
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return json.loads(text.strip())

def load_nodes(count=10):
    nodes = []
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "ai-triad-data", "taxonomy", "Origin")
    for f in ["accelerationist.json", "safetyist.json", "skeptic.json"]:
        path = os.path.join(base, f)
        if not os.path.exists(path):
            continue
        data = json.load(open(path, encoding="utf-8"))
        for n in data.get("nodes", []):
            if n.get("description") and len(n["description"]) > 80:
                nodes.append(n)
            if len(nodes) >= count:
                break
        if len(nodes) >= count:
            break
    return nodes[:count]

def main():
    print("=== Gemma 4 E4B Quality Validation (GPU-Optimized) ===")
    print("Model:", OLLAMA_MODEL)

    nodes = load_nodes(10)
    print("Loaded", len(nodes), "nodes\n")

    # Test 1: Summarization
    print("=== SUMMARIZATION (5) ===")
    sum_times = []
    sum_ok = 0
    for i, n in enumerate(nodes[:5]):
        r = call("Summarize in 2-3 sentences for a policy audience:\n\n" + n["description"][:500])
        sum_times.append(r["ms"])
        ok = r["ok"] and len(r["text"]) > 20
        if ok:
            sum_ok += 1
        print("  [%d/5] %s: %s (%dms)" % (i+1, n["id"], "OK" if ok else "FAIL", r["ms"]))

    # Test 2: Lineage
    print("\n=== LINEAGE ENRICHMENT (5) ===")
    lin_times = []
    lin_json = 0
    for name in ["Effective Altruism", "Precautionary Principle", "Regulatory Capture Theory",
                  "Social Contract Theory", "Game Theory"]:
        prompt = ("Return a JSON object with name, description (2-5 sentences for policy audience), "
                  "url (Wikipedia), category (philosophical_movement|economic_theory|political_philosophy|"
                  "social_theory|scientific_paradigm|legal_framework|other). Entry: " + name)
        r = call(prompt, json_mode=True)
        lin_times.append(r["ms"])
        jok = False
        if r["ok"]:
            try:
                p = try_parse(r["text"])
                jok = "description" in p
            except:
                pass
        if jok:
            lin_json += 1
        print("  %s: %s json=%s (%dms)" % (name, "OK" if r["ok"] else "FAIL", "Y" if jok else "N", r["ms"]))

    # Test 3: Attribute extraction
    print("\n=== ATTRIBUTE EXTRACTION (5) ===")
    attr_times = []
    attr_json = 0
    attr_type = 0
    valid_et = {"empirical_claim", "normative_prescription", "interpretive_lens",
                "definitional", "strategic_recommendation"}
    for i, n in enumerate(nodes[:5]):
        prompt = ("Return JSON with epistemic_type (empirical_claim|normative_prescription|"
                  "interpretive_lens|definitional|strategic_recommendation), rhetorical_strategy, "
                  "falsifiability (high|medium|low). Node: " + n["label"] +
                  " Category: " + n.get("category", "") +
                  " Description: " + n["description"][:300])
        r = call(prompt, json_mode=True)
        attr_times.append(r["ms"])
        jok = tok = False
        if r["ok"]:
            try:
                p = try_parse(r["text"])
                jok = "epistemic_type" in p and "falsifiability" in p
                tok = p.get("epistemic_type") in valid_et and p.get("falsifiability") in ("high", "medium", "low")
            except:
                pass
        if jok:
            attr_json += 1
        if tok:
            attr_type += 1
        print("  [%d/5] %s: %s json=%s types=%s (%dms)" % (
            i+1, n["id"], "OK" if r["ok"] else "FAIL", "Y" if jok else "N", "Y" if tok else "N", r["ms"]))

    # Test 4: Steelman
    print("\n=== STEELMAN ANALYSIS (5) ===")
    stl_times = []
    stl_json = 0
    for i, n in enumerate(nodes[:5]):
        prompt = ("Return JSON with vulnerability (2-3 sentences), attack_vector, "
                  "confidence (high|medium|low). Node: " + n["label"] +
                  " Description: " + n["description"][:300])
        r = call(prompt, json_mode=True)
        stl_times.append(r["ms"])
        jok = False
        if r["ok"]:
            try:
                p = try_parse(r["text"])
                jok = "vulnerability" in p
            except:
                pass
        if jok:
            stl_json += 1
        print("  [%d/5] %s: %s json=%s (%dms)" % (
            i+1, n["id"], "OK" if r["ok"] else "FAIL", "Y" if jok else "N", r["ms"]))

    # Comparison table
    print("\n" + "=" * 70)
    print("COMPARISON TABLE")
    print("=" * 70)
    print("%-22s %10s %10s %10s %14s" % ("Task", "GPU Ollama", "CPU Ollama", "Cloud API", "GPU vs CPU"))
    print("-" * 68)

    prev_cpu = {"Summarization": 25326, "Lineage": 46658, "Attributes": 48455, "Steelman": 0}
    cloud_est = 2000

    for label, times in [("Summarization", sum_times), ("Lineage", lin_times),
                         ("Attributes", attr_times), ("Steelman", stl_times)]:
        avg = sum(times) / len(times) if times else 0
        cpu = prev_cpu.get(label, 0)
        spd = "%.1fx faster" % (cpu / avg) if avg > 0 and cpu > 0 else "N/A (new)"
        print("%-22s %8.0fms %8.0fms %8.0fms   %s" % (label, avg, cpu, cloud_est, spd))

    print("\nQUALITY SUMMARY:")
    print("  Summarization: %d/5 success" % sum_ok)
    print("  Lineage: %d/5 JSON compliant" % lin_json)
    print("  Attributes: %d/5 JSON, %d/5 correct types" % (attr_json, attr_type))
    print("  Steelman: %d/5 JSON compliant" % stl_json)

if __name__ == "__main__":
    main()
