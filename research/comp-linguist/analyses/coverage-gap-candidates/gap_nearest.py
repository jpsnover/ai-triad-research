#!/usr/bin/env python
"""t/2371: for each hand-identified coverage-gap theme (t/2341 adjudication),
find the nearest existing safetyist nodes (top-3 base cosine) to confirm 'no
correct home' and capture the nearest-node neighborhood for the candidate feed.
"""
import json, os
import numpy as np
from sentence_transformers import SentenceTransformer

DR = os.environ["AI_TRIAD_DATA_ROOT"]
ORIGIN = os.path.join(DR, "taxonomy", "Origin")

base = json.load(open(os.path.join(ORIGIN, "embeddings.json"), encoding="utf-8"))["nodes"]
saf_ids = [k for k in base if k.startswith("saf-")]
M = np.asarray([base[k]["vector"] for k in saf_ids], dtype=np.float32)
M = M / np.clip(np.linalg.norm(M, axis=1, keepdims=True), 1e-9, None)

# labels for readability
saf = json.load(open(os.path.join(ORIGIN, "safetyist.json"), encoding="utf-8"))
labels = {}
def walk(o):
    if isinstance(o, dict):
        nid = o.get("id") or o.get("node_id")
        if isinstance(nid, str) and nid.startswith("saf-"):
            labels[nid] = o.get("label", "")
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(saf)

GAPS = {
    "worker_led_ai_risk_assessment": "Workers and labor organizations should have the independent authority to assess, monitor, and halt AI systems that threaten worker safety or rights — worker-led independent AI risk assessment and veto power over deployment.",
    "sovereign_state_authority_mission_critical_ai": "The sovereign state must retain ultimate authority and final control over mission-critical AI systems used in national defense, infrastructure, and public administration, above private-firm control.",
    "activation_monitoring_prompt_injection_detection": "Detect prompt-injection and jailbreak attacks by monitoring a model's internal activations at inference time, rather than filtering inputs or outputs at the text level.",
    "informativeness_cap_knowledge_collapse": "Deliberately cap or limit how informative or capable AI outputs are, to prevent human epistemic dependence and large-scale knowledge collapse from over-reliance on AI.",
}

model = SentenceTransformer("all-MiniLM-L6-v2")
out = {}
for key, text in GAPS.items():
    q = model.encode([text], normalize_embeddings=True)[0].astype(np.float32)
    sims = M @ q
    order = np.argsort(-sims)[:3]
    top3 = [{"node": saf_ids[i], "label": labels.get(saf_ids[i], ""), "score": round(float(sims[i]), 3)} for i in order]
    out[key] = top3
    print(f"\n### {key}")
    for t in top3:
        print(f"   {t['score']:.3f}  {t['node']}  {t['label']}")

json.dump(out, open(os.path.join(os.path.dirname(__file__), "gap_nearest.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\nsaved gap_nearest.json")
