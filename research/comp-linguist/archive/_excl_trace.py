"""Trace exclusion enforcement through the latest debate diagnostics."""
import sys, json, glob, os
sys.stdout.reconfigure(encoding='utf-8')

DEBATE_DIR = 'C:/Users/jsnov/repos/ai-triad-data/debates'
files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)
with open(files[0], encoding='utf-8') as f:
    d = json.load(f)

print("Debate:", d.get('id', '')[:8], d.get('title', '')[:80])
print()

# Top-level diagnostics
diag = d.get('diagnostics', {})
print("=== Top-level diagnostics keys ===")
print(list(diag.keys()))
print()

# Scope violations / drift warnings (top-level)
sv = diag.get('scope_violations', [])
sdw = diag.get('scope_drift_warnings', [])
print(f"scope_violations: {len(sv)} entries")
for v in sv[:5]:
    print(f"  {json.dumps(v)[:200]}")
print(f"scope_drift_warnings: {len(sdw)} entries")
for w in sdw[:5]:
    print(f"  {json.dumps(w)[:200]}")
print()

# Per-entry diagnostics
entries = diag.get('entries', {})
statements = [e for e in d.get('transcript', []) if e.get('type') == 'statement']
print(f"=== Per-entry diagnostics ({len(entries)} entries, {len(statements)} statements) ===")
print()

for i, s in enumerate(statements):
    eid = s['id']
    entry = entries.get(eid, {})
    speaker = s.get('speaker', '')
    print(f"S{i+1} ({speaker:15s}) keys: {sorted(entry.keys())}")

    # Show any exclusion/scope/boundary/guard related data
    for k in sorted(entry.keys()):
        val = entry[k]
        if any(term in k.lower() for term in ['excl', 'scope', 'boundary', 'guard', 'drift']):
            print(f"  >>> {k}: {json.dumps(val)[:300]}")

print()
print("=== Argument Network: taxonomy attribution ===")
an_nodes = d.get('argument_network', {}).get('nodes', [])
nodes_with_tax = [n for n in an_nodes if n.get('claim_taxonomy_attribution')]
print(f"AN nodes total: {len(an_nodes)}, with taxonomy attribution: {len(nodes_with_tax)}")
print()

for n in nodes_with_tax[:10]:
    attr = n.get('claim_taxonomy_attribution', {})
    print(f"  {n['id'][:12]:12s} ({n.get('speaker',''):15s}) ref={attr.get('primary_ref','')} sim={attr.get('similarity',0):.3f}")
    print(f"    text: {n.get('text','')[:100]}")

# Check if AN nodes have exclusion-related fields
print()
print("=== AN node fields (sample) ===")
if an_nodes:
    sample = an_nodes[0]
    print(f"  All keys: {sorted(sample.keys())}")
    # Look for exclusion-specific fields on any node
    excl_fields = set()
    for n in an_nodes:
        for k in n.keys():
            if 'excl' in k.lower() or 'boundary' in k.lower():
                excl_fields.add(k)
    if excl_fields:
        print(f"  Exclusion-related fields found: {excl_fields}")
        for n in an_nodes:
            for k in excl_fields:
                if n.get(k):
                    print(f"    {n['id'][:12]} {k}: {json.dumps(n[k])[:200]}")
    else:
        print("  No exclusion-related fields on AN nodes")

# Check turn_validations for exclusion data
print()
print("=== Turn validations: exclusion trace ===")
tv_all = d.get('turn_validations', {})
for i, s in enumerate(statements):
    eid = s['id']
    tv = tv_all.get(eid, {})
    tv_final = tv.get('final', {})
    # Search for exclusion-related keys at any depth
    def find_excl_keys(obj, prefix=''):
        results = []
        if isinstance(obj, dict):
            for k, v in obj.items():
                path = f"{prefix}.{k}" if prefix else k
                if any(term in k.lower() for term in ['excl', 'scope_bound', 'drift', 'guard']):
                    results.append((path, v))
                results.extend(find_excl_keys(v, path))
        elif isinstance(obj, list):
            for idx, item in enumerate(obj[:3]):
                results.extend(find_excl_keys(item, f"{prefix}[{idx}]"))
        return results

    found = find_excl_keys(tv)
    if found:
        print(f"  S{i+1} ({s.get('speaker',''):15s}):")
        for path, val in found:
            print(f"    {path}: {json.dumps(val)[:200]}")
