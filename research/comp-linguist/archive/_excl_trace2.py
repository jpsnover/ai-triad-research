"""Deep trace: where exclusion enforcement results are stored in debate diagnostics."""
import sys, json, glob, os
sys.stdout.reconfigure(encoding='utf-8')

DEBATE_DIR = 'C:/Users/jsnov/repos/ai-triad-data/debates'
files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)
with open(files[0], encoding='utf-8') as f:
    d = json.load(f)

diag = d.get('diagnostics', {})
entries = diag.get('entries', {})
statements = [e for e in d.get('transcript', []) if e.get('type') == 'statement']

# 1. Check extraction_trace structure
print("=" * 80)
print("EXTRACTION TRACE (S1 sample)")
print("=" * 80)
s1_id = statements[0]['id']
et = entries.get(s1_id, {}).get('extraction_trace', {})
if isinstance(et, dict):
    print(f"Keys: {sorted(et.keys())}")
    for k in sorted(et.keys()):
        val = et[k]
        if isinstance(val, (str, int, float, bool)):
            print(f"  {k}: {val}")
        elif isinstance(val, list):
            print(f"  {k}: list[{len(val)}]")
            if val and isinstance(val[0], dict):
                print(f"    [0] keys: {sorted(val[0].keys())}")
                # Look for exclusion-related
                for ik in val[0].keys():
                    if 'excl' in ik.lower() or 'bound' in ik.lower():
                        print(f"    >>> {ik}: {json.dumps(val[0][ik])[:200]}")
        elif isinstance(val, dict):
            print(f"  {k}: dict keys={sorted(val.keys())[:10]}")
            for sk in val.keys():
                if 'excl' in sk.lower() or 'bound' in sk.lower() or 'scope' in sk.lower():
                    print(f"    >>> {sk}: {json.dumps(val[sk])[:200]}")
elif isinstance(et, list):
    print(f"List of {len(et)} items")
    if et:
        print(f"  [0]: {json.dumps(et[0])[:300]}")
else:
    print(f"Type: {type(et)}, value: {str(et)[:200]}")

# 2. Check stage_diagnostics structure
print()
print("=" * 80)
print("STAGE DIAGNOSTICS (S1 sample)")
print("=" * 80)
sd = entries.get(s1_id, {}).get('stage_diagnostics', {})
if isinstance(sd, dict):
    print(f"Keys: {sorted(sd.keys())}")
    for k in sorted(sd.keys()):
        val = sd[k]
        if isinstance(val, dict):
            print(f"  {k}: dict keys={sorted(val.keys())[:15]}")
            for sk in val.keys():
                if any(term in sk.lower() for term in ['excl', 'bound', 'scope', 'drift', 'guard']):
                    print(f"    >>> {sk}: {json.dumps(val[sk])[:300]}")
        elif isinstance(val, list):
            print(f"  {k}: list[{len(val)}]")
        else:
            print(f"  {k}: {str(val)[:100]}")
elif isinstance(sd, list):
    print(f"List of {len(sd)} items")
else:
    print(f"Type: {type(sd)}, value: {str(sd)[:200]}")

# 3. Check the extracted_claims for exclusion fields
print()
print("=" * 80)
print("EXTRACTED CLAIMS (all statements)")
print("=" * 80)
for i, s in enumerate(statements):
    eid = s['id']
    ec = entries.get(eid, {}).get('extracted_claims', [])
    speaker = s.get('speaker', '')
    print(f"\nS{i+1} ({speaker:15s}): {len(ec)} claims")
    if ec and isinstance(ec, list) and isinstance(ec[0], dict):
        print(f"  Claim keys: {sorted(ec[0].keys())}")
        for c in ec:
            # Look for exclusion-related fields
            excl_keys = [k for k in c.keys() if any(t in k.lower() for t in ['excl', 'bound', 'scope'])]
            if excl_keys:
                for ek in excl_keys:
                    print(f"  >>> claim '{c.get('text','')[:50]}' {ek}: {json.dumps(c[ek])[:200]}")

# 4. Check the lookahead for exclusion-related data
print()
print("=" * 80)
print("LOOKAHEAD per_claim_analysis (S1 sample)")
print("=" * 80)
la = entries.get(s1_id, {}).get('lookahead', {})
pca = la.get('per_claim_analysis', [])
if pca:
    print(f"per_claim_analysis[0] keys: {sorted(pca[0].keys())}")
    analysis = pca[0].get('analysis', {})
    print(f"  analysis keys: {sorted(analysis.keys())}")
    avoid = analysis.get('avoidClaims', [])
    strong = analysis.get('strongFoundations', [])
    print(f"  avoidClaims ({len(avoid)}):")
    for a in avoid[:3]:
        if isinstance(a, dict):
            print(f"    keys: {sorted(a.keys())}")
            print(f"    {json.dumps(a)[:300]}")
        else:
            print(f"    {str(a)[:200]}")
    print(f"  strongFoundations ({len(strong)}):")
    for sf in strong[:3]:
        if isinstance(sf, dict):
            print(f"    keys: {sorted(sf.keys())}")
            print(f"    {json.dumps(sf)[:300]}")
        else:
            print(f"    {str(sf)[:200]}")

# 5. Deep recursive search for 'excl' anywhere in the diagnostics entry
print()
print("=" * 80)
print("RECURSIVE SEARCH for 'excl' in full diagnostics")
print("=" * 80)

def find_keys_containing(obj, term, path='', max_depth=6, results=None):
    if results is None:
        results = []
    if max_depth <= 0:
        return results
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else k
            if term in k.lower():
                val_preview = json.dumps(v)[:150] if not isinstance(v, (list, dict)) or len(json.dumps(v)) < 150 else f"({type(v).__name__} len={len(v) if hasattr(v,'__len__') else '?'})"
                results.append((p, val_preview))
            find_keys_containing(v, term, p, max_depth-1, results)
    elif isinstance(obj, list) and len(obj) > 0:
        find_keys_containing(obj[0], term, f"{path}[0]", max_depth-1, results)
    return results

# Search in full debate for 'excl'
results = find_keys_containing(d, 'excl', max_depth=8)
seen_paths = set()
for path, val in results:
    # Deduplicate by path pattern (replace entry IDs)
    generic = path
    for eid_key in list(entries.keys())[:5]:
        generic = generic.replace(eid_key, '<entry_id>')
    if generic not in seen_paths:
        seen_paths.add(generic)
        print(f"  {path[:80]}: {val[:150]}")
