"""Check if embeddings.json has exclusion_vectors for the refs used in this debate."""
import sys, json, glob, os
sys.stdout.reconfigure(encoding='utf-8')

DEBATE_DIR = 'C:/Users/jsnov/repos/ai-triad-data/debates'
EMB_PATH = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin/embeddings.json'

files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)
with open(files[0], encoding='utf-8') as f:
    d = json.load(f)

with open(EMB_PATH, encoding='utf-8') as f:
    emb = json.load(f)
nodes_emb = emb.get('nodes', {})

# Get all taxonomy refs from this debate's AN
an_nodes = d.get('argument_network', {}).get('nodes', [])
refs_used = set()
for n in an_nodes:
    attr = n.get('claim_taxonomy_attribution', {})
    if attr and attr.get('primary_ref'):
        refs_used.add(attr['primary_ref'])

print(f"Debate refs used: {len(refs_used)}")
print()

# Check each ref in embeddings
print(f"{'Ref':25s} {'In emb?':8s} {'Has vector':11s} {'Has excl_vec':13s} {'Excl dim':9s}")
print(f"{'='*25} {'='*8} {'='*11} {'='*13} {'='*9}")

has_excl = 0
missing_excl = 0
missing_entirely = 0

for ref in sorted(refs_used):
    entry = nodes_emb.get(ref)
    if entry is None:
        print(f"{ref:25s} {'NO':8s} {'-':11s} {'-':13s} {'-':9s}")
        missing_entirely += 1
    elif isinstance(entry, dict):
        has_v = 'vector' in entry
        has_e = 'exclusion_vector' in entry
        e_dim = len(entry['exclusion_vector']) if has_e else 0
        print(f"{ref:25s} {'YES':8s} {str(has_v):11s} {str(has_e):13s} {e_dim:9d}")
        if has_e:
            has_excl += 1
        else:
            missing_excl += 1
    else:
        print(f"{ref:25s} {'YES':8s} {'(not dict)':11s}")

print()
print(f"Summary: {has_excl} with exclusion_vector, {missing_excl} missing exclusion_vector, {missing_entirely} not in embeddings at all")
print()

# Also check: do the AN nodes themselves have embeddings?
nodes_with_emb = sum(1 for n in an_nodes if n.get('embedding'))
print(f"AN nodes with embedding: {nodes_with_emb}/{len(an_nodes)}")

# Check if the exclusionGuard module is even imported/used in the turn pipeline
# by looking for its output fields in the stage_diagnostics
print()
print("=== stage_diagnostics structure (S1) ===")
s1_id = [e for e in d.get('transcript', []) if e.get('type') == 'statement'][0]['id']
sd = d.get('diagnostics', {}).get('entries', {}).get(s1_id, {}).get('stage_diagnostics', [])
if isinstance(sd, list):
    for idx, stage in enumerate(sd):
        if isinstance(stage, dict):
            name = stage.get('stage') or stage.get('name') or stage.get('type') or f"stage_{idx}"
            keys = sorted(stage.keys())
            print(f"  [{idx}] {name}: {keys}")
            # Show any that mention exclusion/scope/guard
            for k in keys:
                if any(t in k.lower() for t in ['excl', 'scope', 'bound', 'guard', 'drift']):
                    print(f"       >>> {k}: {json.dumps(stage[k])[:200]}")
        else:
            print(f"  [{idx}] {type(stage).__name__}: {str(stage)[:100]}")
