import json, os

synth = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin/synthetic'
print('Files:', os.listdir(synth))

for f in ['corpus_acc.json', 'corpus_saf.json', 'corpus_skp.json']:
    path = os.path.join(synth, f)
    d = json.load(open(path, 'r', encoding='utf-8'))
    print(f'{f}: {d["entry_count"]} entries, {d["node_count"]} nodes, '
          f'models={d.get("models","?")}, generated={d.get("generated_at","?")}')

# Check if synthetic_embeddings.json exists
emb_path = os.path.join(synth, 'synthetic_embeddings.json')
if os.path.exists(emb_path):
    size_mb = os.path.getsize(emb_path) / 1024 / 1024
    print(f'\nsynthetic_embeddings.json: {size_mb:.1f} MB')
else:
    print('\nsynthetic_embeddings.json: NOT FOUND')

meta_path = os.path.join(synth, 'metadata.json')
if os.path.exists(meta_path):
    m = json.load(open(meta_path, 'r', encoding='utf-8'))
    print(f'metadata.json: {json.dumps(m, indent=2)[:500]}')
