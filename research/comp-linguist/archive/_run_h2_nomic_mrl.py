"""H2b: Nomic MRL dimension sweep only.

Tests nomic-embed-text-v1.5 at full dimension and Matryoshka truncations.
"""
import sys, json, glob, os, math, time
import numpy as np
sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data'
TAXONOMY_DIR = os.path.join(DATA_ROOT, 'taxonomy/Origin')
DEBATE_DIR = os.path.join(DATA_ROOT, 'debates')
GOLDEN_SET = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_golden_test_set.json'

SPEAKER_POV = {'accelerationist': 'accelerationist', 'safetyist': 'safetyist', 'skeptic': 'skeptic'}
POV_FILE = {'accelerationist': 'accelerationist.json', 'safetyist': 'safetyist.json', 'skeptic': 'skeptic.json'}
MRL_DIMS = [64, 128, 256, 512]

def cosine_similarity(a, b):
    dot = np.dot(a, b)
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    return float(dot / (na * nb)) if na > 0 and nb > 0 else 0.0

# ── Load data ──
print("Loading data...")
pov_nodes = {}
node_descriptions = {}
for pov, fname in POV_FILE.items():
    with open(os.path.join(TAXONOMY_DIR, fname), encoding='utf-8') as f:
        data = json.load(f)
    beliefs = [n for n in data.get('nodes', []) if n.get('category') == 'Beliefs']
    pov_nodes[pov] = beliefs
    for n in beliefs:
        node_descriptions[n['id']] = n.get('description', '')
    print(f"  {pov}: {len(beliefs)} Belief nodes")

with open(GOLDEN_SET, encoding='utf-8') as f:
    claims = json.load(f)['claims']
print(f"  {len(claims)} claims")

claim_texts = {}
debate_files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)
for fp in debate_files[:20]:
    with open(fp, encoding='utf-8') as f:
        d = json.load(f)
    for n in d.get('argument_network', {}).get('nodes', []):
        if n.get('id'):
            claim_texts[n['id']] = n.get('text', n.get('label', ''))

pov_belief_ids = {pov: [n['id'] for n in nodes] for pov, nodes in pov_nodes.items()}

# ── Evaluate ──
def evaluate(claim_vecs, node_vecs):
    top1 = top3 = 0
    rrs = []
    sims_list = []
    gaps = []
    novel = evaluated = 0

    for claim in claims:
        cid, speaker, expected = claim['claim_id'], claim['speaker'], claim['attributed_node']
        if cid not in claim_vecs:
            continue
        pov = SPEAKER_POV.get(speaker)
        if not pov or pov not in pov_belief_ids:
            continue
        cv = claim_vecs[cid]
        sims = [(nid, cosine_similarity(cv, node_vecs[nid])) for nid in pov_belief_ids[pov] if nid in node_vecs]
        sims.sort(key=lambda x: -x[1])
        if not sims:
            continue
        evaluated += 1
        sims_list.append(sims[0][1])
        if len(sims) > 1:
            gaps.append(sims[0][1] - sims[1][1])
        if sims[0][1] < 0.35:
            novel += 1
            continue
        if sims[0][0] == expected:
            top1 += 1
        if expected in [s[0] for s in sims[:3]]:
            top3 += 1
        rank = next((i+1 for i, (nid, _) in enumerate(sims) if nid == expected), len(sims)+1)
        rrs.append(1.0 / rank)

    n = evaluated
    return {
        'evaluated': n,
        'top1_accuracy': round(top1/n*100, 2) if n else 0,
        'top3_accuracy': round(top3/n*100, 2) if n else 0,
        'mrr': round(sum(rrs)/len(rrs), 4) if rrs else 0,
        'mean_similarity': round(sum(sims_list)/len(sims_list), 4) if sims_list else 0,
        'discriminability_gap': round(sum(gaps)/len(gaps), 4) if gaps else 0,
        'novel_argument_rate': round(novel/n*100, 2) if n else 0,
    }

# ── Load nomic model ──
print("\nLoading nomic-embed-text-v1.5...")
from sentence_transformers import SentenceTransformer
t0 = time.time()
model = SentenceTransformer('nomic-ai/nomic-embed-text-v1.5', trust_remote_code=True)
print(f"  Loaded in {time.time()-t0:.1f}s")

node_ids = list(node_descriptions.keys())
node_input = ['search_document: ' + node_descriptions[nid] for nid in node_ids]

claim_ids = [c['claim_id'] for c in claims if c['claim_id'] in claim_texts]
claim_input = ['search_query: ' + claim_texts[cid] for cid in claim_ids]

print(f"  Encoding {len(node_input)} nodes + {len(claim_input)} claims...")
t0 = time.time()
node_raw = model.encode(node_input, show_progress_bar=False, normalize_embeddings=False)
claim_raw = model.encode(claim_input, show_progress_bar=False, normalize_embeddings=False)
print(f"  Encoded in {time.time()-t0:.1f}s (dim={node_raw.shape[1]})")

def make_dicts(narr, carr):
    nn = np.linalg.norm(narr, axis=1, keepdims=True); nn[nn==0] = 1.0
    cn = np.linalg.norm(carr, axis=1, keepdims=True); cn[cn==0] = 1.0
    return {cid: (carr/cn)[i] for i, cid in enumerate(claim_ids)}, {nid: (narr/nn)[i] for i, nid in enumerate(node_ids)}

# ── Full dimension ──
full_dim = node_raw.shape[1]
dims_to_test = [full_dim] + [d for d in MRL_DIMS if d < full_dim]

print(f"\n{'='*70}")
print("NOMIC MATRYOSHKA DIMENSION SWEEP")
print(f"{'='*70}")
print(f"{'Dim':>6s} {'Top-1':>7s} {'Top-3':>7s} {'MRR':>8s} {'Avg Sim':>8s} {'Gap':>8s} {'Novel%':>7s}")
print(f"{'='*6} {'='*7} {'='*7} {'='*8} {'='*8} {'='*8} {'='*7}")

results = {}
for dim in dims_to_test:
    nt = node_raw[:, :dim]
    ct = claim_raw[:, :dim]
    cv, nv = make_dicts(nt, ct)
    r = evaluate(cv, nv)
    label = f"nomic-v1.5 (dim={dim}{'*' if dim < full_dim else ''})"
    results[label] = {**r, 'dim': dim}
    print(f"{dim:>6d} {r['top1_accuracy']:6.1f}% {r['top3_accuracy']:6.1f}% {r['mrr']:8.4f} {r['mean_similarity']:8.4f} {r['discriminability_gap']:8.4f} {r['novel_argument_rate']:6.1f}%")

# Compare to MiniLM baseline
print(f"\nBaseline comparison (all-MiniLM-L6-v2 desc-only): MRR=0.1640, Top-1=9.3%")
best = max(results.items(), key=lambda x: x[1]['mrr'])
print(f"Best nomic config: {best[0]}, MRR={best[1]['mrr']:.4f}, Top-1={best[1]['top1_accuracy']:.1f}%")
print(f"Delta vs MiniLM: MRR {best[1]['mrr'] - 0.1640:+.4f}, Top-1 {best[1]['top1_accuracy'] - 9.3:+.1f}%")

# ── Key insight: does lower dimension help? ──
print(f"\n{'='*70}")
print("KEY INSIGHT: Does Matryoshka truncation help?")
print(f"{'='*70}")
full_mrr = results[f"nomic-v1.5 (dim={full_dim})"]['mrr']
for dim in MRL_DIMS:
    if dim >= full_dim:
        continue
    trunc_label = f"nomic-v1.5 (dim={dim}*)"
    if trunc_label in results:
        trunc_mrr = results[trunc_label]['mrr']
        delta = trunc_mrr - full_mrr
        direction = "BETTER" if delta > 0.005 else "WORSE" if delta < -0.005 else "SIMILAR"
        print(f"  dim={dim}: MRR {trunc_mrr:.4f} ({delta:+.4f} vs full) — {direction}")
