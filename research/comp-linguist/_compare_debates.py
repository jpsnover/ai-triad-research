"""Compare pre-fix vs post-fix debate quality metrics."""
import json, os, sys, glob
from collections import Counter
sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ai-triad-data'))
DEBATES_DIR = os.path.join(DATA_ROOT, 'debates')

# Load the pre-fix debate (GUI, no genus embedding)
pre_path = os.path.join(DEBATES_DIR, 'debate-0d6fc77f-894f-476c-ae85-c3d8b78d0dd7.json')
with open(pre_path, encoding='utf-8') as f:
    pre = json.load(f)

# Find the most recent CLI debate (post-fix)
REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
cli_dir = os.path.join(DEBATES_DIR, 'cli-runs')
repo_debates = os.path.join(REPO_ROOT, 'debates')
post = None
post_path = None
for d in [repo_debates, DEBATES_DIR, cli_dir]:
    if not os.path.isdir(d):
        continue
    patterns = [os.path.join(d, 'debate-*.json'), os.path.join(d, '*-debate.json')]
    files = []
    for pat in patterns:
        files.extend(glob.glob(pat))
    for f in sorted(files, key=os.path.getmtime, reverse=True):
        if os.path.normpath(f) == os.path.normpath(pre_path):
            continue
        with open(f, encoding='utf-8') as fh:
            candidate = json.load(fh)
        an = candidate.get('argument_network', {})
        nodes = an.get('nodes', [])
        if len(nodes) > 0 and candidate.get('id') != pre.get('id'):
            post = candidate
            post_path = f
            break
    if post:
        break

if not post:
    print("ERROR: No post-fix debate with AN nodes found yet.")
    sys.exit(1)

def analyze(debate, label):
    an = debate.get('argument_network', {})
    nodes = an.get('nodes', [])
    edges = an.get('edges', [])
    transcript = debate.get('transcript', [])

    # Attribution stats
    att_nodes = [n for n in nodes if n.get('claim_taxonomy_attribution')]
    confidences = [n['claim_taxonomy_attribution'].get('attribution_confidence', 0) for n in att_nodes]
    genus_nodes = [n for n in nodes if n.get('attribution_text_genus')]
    emb_nodes = [n for n in nodes if n.get('attribution_embedding')]
    # Check embedding dimensions for model mismatch detection
    emb_dims = set()
    attr_emb_dims = set()
    for n in nodes:
        if n.get('embedding'):
            emb_dims.add(len(n['embedding']))
        if n.get('attribution_embedding'):
            attr_emb_dims.add(len(n['attribution_embedding']))

    # Primary ref POV distribution
    pov_dist = Counter()
    for n in att_nodes:
        ref = n['claim_taxonomy_attribution'].get('primary_ref', '')
        if ref:
            pov_dist[ref.split('-')[0]] += 1

    # BDI category distribution of primary refs
    bdi_dist = Counter()
    for n in att_nodes:
        ref = n['claim_taxonomy_attribution'].get('primary_ref', '')
        if ref:
            parts = ref.split('-')
            if len(parts) >= 2:
                bdi_dist[parts[1]] += 1

    # Calibration
    cal = debate.get('calibration_log')

    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")
    print(f"  ID: {debate.get('id', '?')}")
    print(f"  Model: {debate.get('debate_model', debate.get('config', {}).get('model', '?'))}")
    print(f"  AN Nodes: {len(nodes)}, Edges: {len(edges)}")
    print(f"  Transcript entries: {len(transcript)}")
    print()

    # Key metrics
    print(f"  --- GENUS TEXT ---")
    print(f"  Has attribution_text_genus: {len(genus_nodes)}/{len(nodes)}")
    print()

    print(f"  --- GENUS EMBEDDING (KEY FIX) ---")
    print(f"  Has attribution_embedding: {len(emb_nodes)}/{len(nodes)}")
    if emb_dims:
        print(f"  Node embedding dims: {emb_dims}")
    if attr_emb_dims:
        print(f"  Attribution embedding dims: {attr_emb_dims}")
    else:
        print(f"  Attribution embedding dims: (none)")
    print()

    print(f"  --- ATTRIBUTION QUALITY ---")
    print(f"  Attributed: {len(att_nodes)}/{len(nodes)}")
    if confidences:
        avg_conf = sum(confidences) / len(confidences)
        high = sum(1 for c in confidences if c >= 0.5)
        mid = sum(1 for c in confidences if 0.35 <= c < 0.5)
        low = sum(1 for c in confidences if c < 0.35)
        print(f"  Avg confidence: {avg_conf:.4f}")
        print(f"  Min/Max: {min(confidences):.4f} / {max(confidences):.4f}")
        print(f"  Bands: high(>=0.5)={high}  mid(0.35-0.5)={mid}  low(<0.35)={low}")
    print()

    print(f"  --- CANDIDATE BREADTH (ALL-BDI FIX) ---")
    print(f"  Primary ref POV distribution: {dict(pov_dist)}")
    print(f"  Primary ref BDI distribution: {dict(bdi_dist)}")
    print()

    print(f"  --- CALIBRATION LOG (EMBEDDING FIX) ---")
    if cal:
        print(f"  Present: YES")
        if isinstance(cal, dict):
            for k in ['crux_addressed_ratio', 'repetition_rate', 'convergence_score',
                       'situation_crux_alignment', 'topic_health_score']:
                if k in cal:
                    print(f"    {k}: {cal[k]}")
    else:
        print(f"  Present: NO")

    return {
        'nodes': len(nodes),
        'genus_text': len(genus_nodes),
        'genus_embedding': len(emb_nodes),
        'attributed': len(att_nodes),
        'avg_confidence': sum(confidences) / len(confidences) if confidences else 0,
        'pov_dist': dict(pov_dist),
        'bdi_dist': dict(bdi_dist),
        'has_calibration': cal is not None,
        'emb_dims': emb_dims,
        'attr_emb_dims': attr_emb_dims,
    }

pre_stats = analyze(pre, "PRE-FIX (GUI debate, no genus embedding)")
post_stats = analyze(post, "POST-FIX (CLI debate, with genus embedding)")

# Delta summary
print(f"\n{'='*60}")
print(f"  IMPROVEMENT SUMMARY")
print(f"{'='*60}")

def delta(metric, pre_val, post_val, higher_better=True):
    if isinstance(pre_val, (int, float)) and isinstance(post_val, (int, float)):
        diff = post_val - pre_val
        pct = (diff / pre_val * 100) if pre_val != 0 else float('inf')
        direction = "+" if diff > 0 else ""
        quality = "BETTER" if (diff > 0) == higher_better else ("WORSE" if diff != 0 else "SAME")
        print(f"  {metric}: {pre_val} -> {post_val} ({direction}{diff}, {direction}{pct:.1f}%) [{quality}]")
    else:
        print(f"  {metric}: {pre_val} -> {post_val}")

delta("Genus embedding count", pre_stats['genus_embedding'], post_stats['genus_embedding'])
delta("Avg attribution confidence", round(pre_stats['avg_confidence'], 4), round(post_stats['avg_confidence'], 4))
delta("Attributed nodes", pre_stats['attributed'], post_stats['attributed'])
delta("Calibration log present", pre_stats['has_calibration'], post_stats['has_calibration'])

print(f"\n  BDI breadth (pre):  {pre_stats['bdi_dist']}")
print(f"  BDI breadth (post): {post_stats['bdi_dist']}")
has_non_belief = any(k not in ('Beliefs', 'beliefs') for k in post_stats['bdi_dist'])
print(f"  All-BDI working: {'YES - refs to D/I categories' if has_non_belief else 'NO - still beliefs-only'}")

print(f"\n  Embedding dims (pre):  node={pre_stats['emb_dims']}, attr={pre_stats['attr_emb_dims']}")
print(f"  Embedding dims (post): node={post_stats['emb_dims']}, attr={post_stats['attr_emb_dims']}")
pre_dim_match = pre_stats['attr_emb_dims'] <= {384} or not pre_stats['attr_emb_dims']
post_dim_match = post_stats['attr_emb_dims'] <= {384} or not post_stats['attr_emb_dims']
print(f"  Taxonomy-compatible embeddings (384-dim): pre={'YES' if pre_dim_match else 'NO (MISMATCH)'}, post={'YES' if post_dim_match else 'NO (MISMATCH)'}")
