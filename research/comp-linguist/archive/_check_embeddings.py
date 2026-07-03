"""Check embeddings.json structure and POV field values."""
import json, sys
sys.stdout.reconfigure(encoding='utf-8')

path = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin/embeddings.json'
d = json.load(open(path, 'r', encoding='utf-8'))

print('Top-level keys:', list(d.keys())[:10])

# Try different structures
nodes = d.get('data', {}).get('nodes') or d.get('nodes') or d.get('data')
if isinstance(nodes, dict):
    sample_keys = list(nodes.keys())[:5]
    print(f'Found {len(nodes)} node entries')
    print('Sample keys:', sample_keys)

    # Check POV values
    from collections import Counter
    pov_counter = Counter()
    for k, v in nodes.items():
        if isinstance(v, dict):
            pov_counter[v.get('pov', 'MISSING')] += 1
    print(f'\nPOV value distribution: {dict(pov_counter)}')

    # Show sample entries
    for k in sample_keys:
        v = nodes[k]
        if isinstance(v, dict):
            ks = list(v.keys())[:8]
            pov = v.get('pov', 'N/A')
            vec_len = len(v.get('vector', [])) if isinstance(v.get('vector'), list) else 'N/A'
            vecs_len = len(v.get('vectors', [])) if isinstance(v.get('vectors'), list) else 'N/A'
            print(f'  {k}: pov={pov}, vec_len={vec_len}, vecs_len={vecs_len}, keys={ks}')
elif isinstance(nodes, list):
    print(f'Nodes is a list with {len(nodes)} entries')
else:
    print(f'Nodes type: {type(nodes)}')
