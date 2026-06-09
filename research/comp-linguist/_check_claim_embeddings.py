"""Check if claim embeddings are stored in debate AN nodes."""
import sys, json, glob, os
sys.stdout.reconfigure(encoding='utf-8')

DEBATE_DIR = 'C:/Users/jsnov/repos/ai-triad-data/debates'
files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)

with open(files[0], encoding='utf-8') as f:
    d = json.load(f)

an_nodes = d.get('argument_network', {}).get('nodes', [])
print(f"Debate: {d.get('id', '')[:8]}")
print(f"AN nodes: {len(an_nodes)}")

has_emb = sum(1 for n in an_nodes if n.get('embedding'))
no_emb = sum(1 for n in an_nodes if not n.get('embedding'))
print(f"With embedding: {has_emb}")
print(f"Without embedding: {no_emb}")

if has_emb > 0:
    sample = next(n for n in an_nodes if n.get('embedding'))
    print(f"Embedding dimension: {len(sample['embedding'])}")
    print(f"Sample node keys: {sorted(sample.keys())}")
