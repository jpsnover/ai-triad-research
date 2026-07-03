import sys, json
sys.stdout.reconfigure(encoding='utf-8')
fp = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin/embeddings.json'
with open(fp, encoding='utf-8') as f:
    emb = json.load(f)
print('Top-level keys:', list(emb.keys())[:10])
if 'data' in emb:
    data = emb['data']
    print('data keys:', list(data.keys())[:10] if isinstance(data, dict) else 'list of ' + str(len(data)))
    nodes = data.get('nodes', {}) if isinstance(data, dict) else {}
else:
    nodes = emb.get('nodes', {})

if isinstance(nodes, dict):
    total = len(nodes)
    with_excl = sum(1 for v in nodes.values() if isinstance(v, dict) and v.get('exclusion_vector'))
    with_vec = sum(1 for v in nodes.values() if isinstance(v, dict) and v.get('vector'))
    sample_keys = list(nodes.keys())[:5]
    for k in sample_keys:
        v = nodes[k]
        if isinstance(v, dict):
            has_v = 'vector' in v
            has_e = 'exclusion_vector' in v
            other_keys = [kk for kk in v.keys() if kk not in ('vector', 'exclusion_vector')]
            ev_len = len(v['exclusion_vector']) if has_e else 0
            print(f'  {k}: vec={has_v} excl={has_e} excl_dim={ev_len} other={other_keys}')
    print(f'Total nodes: {total}, with vector: {with_vec}, with exclusion_vector: {with_excl}')
elif isinstance(nodes, list):
    total = len(nodes)
    with_excl = sum(1 for n in nodes if isinstance(n, dict) and n.get('exclusion_vector'))
    print(f'Total nodes (list): {total}, with exclusion_vector: {with_excl}')

# Also check debate AN nodes for embeddings
import glob, os
DEBATE_DIR = 'C:/Users/jsnov/repos/ai-triad-data/debates'
files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)
print(f'\nChecking latest debate AN nodes for embeddings...')
with open(files[0], encoding='utf-8') as f:
    d = json.load(f)
an_nodes = d.get('argument_network', {}).get('nodes', [])
with_emb = sum(1 for n in an_nodes if n.get('embedding'))
with_tax_ref = sum(1 for n in an_nodes if n.get('claim_taxonomy_attribution', {}).get('primary_ref'))
print(f'AN nodes: {len(an_nodes)}, with embedding: {with_emb}, with taxonomy ref: {with_tax_ref}')
if with_tax_ref > 0:
    refs = [n.get('claim_taxonomy_attribution', {}).get('primary_ref') for n in an_nodes if n.get('claim_taxonomy_attribution', {}).get('primary_ref')]
    print(f'Sample taxonomy refs: {refs[:5]}')
    # Check which of these refs have exclusion_vectors in embeddings
    matched = sum(1 for r in refs if r in nodes and isinstance(nodes.get(r), dict) and nodes[r].get('exclusion_vector'))
    print(f'Refs with exclusion_vector in embeddings: {matched}/{len(refs)}')
