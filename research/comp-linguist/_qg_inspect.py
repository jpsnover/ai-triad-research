"""Inspect quality gate failures in the latest debate."""
import json, glob, os, sys
sys.stdout.reconfigure(encoding='utf-8')

DEBATE_DIR = 'C:/Users/jsnov/repos/ai-triad-data/debates'
files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)

fp = files[0]
with open(fp, encoding='utf-8') as f:
    d = json.load(f)

print(f"Debate: {d.get('id', '')[:8]}")
print(f"File: {os.path.basename(fp)}")
print(f"Updated: {d.get('updated_at', '')[:19]}")

transcript = d.get('transcript', [])
statements = [e for e in transcript if e.get('type') == 'statement']
diag_entries = d.get('diagnostics', {}).get('entries', {})
turn_validations = d.get('turn_validations', {})

print(f"\nStatements: {len(statements)}")
print(f"Diagnostics entries keys: {len(diag_entries)}")
print(f"Turn validation keys: {len(turn_validations)}")

# Check what's in the diagnostics for each statement
print(f"\n{'='*80}")
print("QUALITY GATE DETAIL PER STATEMENT")
print(f"{'='*80}")

for i, s in enumerate(statements):
    eid = s['id']
    speaker = s.get('speaker', '?')
    diag = diag_entries.get(eid, {})
    tv = turn_validations.get(eid, {})

    qg = diag.get('quality_gate')
    print(f"\n--- S{i+1} ({speaker}) entry_id={eid[:12]}... ---")

    if qg is None:
        print(f"  quality_gate: ABSENT from diagnostics")
    else:
        print(f"  quality_gate.pass: {qg.get('pass')}")
        # Print all keys and values in quality gate
        for k, v in sorted(qg.items()):
            if k == 'pass':
                continue
            if isinstance(v, dict):
                print(f"  qg.{k}:")
                for kk, vv in sorted(v.items()):
                    val_str = str(vv)[:120]
                    print(f"    {kk}: {val_str}")
            elif isinstance(v, list):
                print(f"  qg.{k}: [{len(v)} items]")
                for item in v[:3]:
                    print(f"    {str(item)[:120]}")
            else:
                print(f"  qg.{k}: {str(v)[:120]}")

    # Also check turn validation
    if tv:
        print(f"  turn_validation:")
        for k, v in sorted(tv.items()):
            if k in ('process_reward_details', 'stageA_details'):
                print(f"    {k}: [present, {len(str(v))} chars]")
            else:
                val_str = str(v)[:120]
                print(f"    {k}: {val_str}")
    else:
        print(f"  turn_validation: ABSENT")

# Also dump the top-level diagnostics keys to understand the structure
print(f"\n{'='*80}")
print("TOP-LEVEL DIAGNOSTICS STRUCTURE")
print(f"{'='*80}")
diagnostics = d.get('diagnostics', {})
for k in sorted(diagnostics.keys()):
    v = diagnostics[k]
    if isinstance(v, dict):
        print(f"  diagnostics.{k}: dict with {len(v)} keys")
        if len(v) <= 10:
            for kk in sorted(v.keys()):
                print(f"    {kk[:40]}: {type(v[kk]).__name__}")
    elif isinstance(v, list):
        print(f"  diagnostics.{k}: list with {len(v)} items")
    else:
        print(f"  diagnostics.{k}: {str(v)[:80]}")

# Check if quality_gate data is stored at a different path
print(f"\n{'='*80}")
print("SEARCHING FOR QUALITY GATE DATA AT ALL PATHS")
print(f"{'='*80}")

def find_quality_gate(obj, path="root"):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if 'quality_gate' in k.lower() or 'qualitygate' in k.lower():
                print(f"  Found at {path}.{k}: {type(v).__name__}")
                if isinstance(v, dict):
                    for kk, vv in list(v.items())[:5]:
                        print(f"    {kk}: {str(vv)[:80]}")
                elif isinstance(v, (bool, int, float, str)):
                    print(f"    value: {v}")
            if isinstance(v, (dict, list)):
                find_quality_gate(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for idx, item in enumerate(obj[:3]):
            if isinstance(item, (dict, list)):
                find_quality_gate(item, f"{path}[{idx}]")

find_quality_gate(d)
