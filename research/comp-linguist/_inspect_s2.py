import json, sys, os

with open('C:/Users/jsnov/repos/ai-triad-data/debates/debate-7362765b-13ac-4b44-9100-dc4467f775d0.json', encoding='utf-8') as f:
    d = json.load(f)

# Find S2 — second "statement" type entry
statements = [(i, e) for i, e in enumerate(d.get('transcript', [])) if e.get('type') == 'statement']
if len(statements) < 2:
    print("ERROR: Less than 2 statement entries found")
    sys.exit(1)

idx, s2 = statements[1]
entry_id = s2['id']

out = {
    'transcript_index': idx,
    'entry_id': entry_id,
    'speaker': s2.get('speaker'),
    'type': s2.get('type'),
    'content': s2.get('content'),
    'taxonomy_refs': s2.get('taxonomy_refs', []),
    'metadata': s2.get('metadata', {}),
    'model': s2.get('model'),
    'display_tier': s2.get('display_tier'),
    'caveats': s2.get('caveats'),
}

# Get diagnostics for this entry
diag = d.get('diagnostics', {}).get('entries', {}).get(entry_id, {})
out['diagnostics'] = {
    'quality_gate': diag.get('quality_gate'),
    'stage_diagnostics': diag.get('stage_diagnostics'),
    'convergence_signals': diag.get('convergence_signals'),
    'topic_alignment': diag.get('topic_alignment'),
    'entailment_repairs': diag.get('entailment_repairs'),
    'extracted_claims': diag.get('extracted_claims'),
    'extraction_trace': diag.get('extraction_trace'),
    'response_time_ms': diag.get('response_time_ms'),
    'model': diag.get('model'),
    'input_tokens': diag.get('input_tokens'),
    'output_tokens': diag.get('output_tokens'),
}

# Also get turn validation for this entry
tv = d.get('turn_validations', {}).get(entry_id, {})
out['turn_validation'] = tv

outpath = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_s2_diag.json'
with open(outpath, 'w', encoding='utf-8') as f:
    json.dump(out, f, indent=2, ensure_ascii=False, default=str)

print(f"Written to {outpath}")
print(f"Entry ID: {entry_id}")
print(f"Speaker: {s2.get('speaker')}")
print(f"Stage diagnostics keys: {list(diag.get('stage_diagnostics', {}).keys()) if diag.get('stage_diagnostics') else 'NONE'}")
print(f"Quality gate present: {diag.get('quality_gate') is not None}")
print(f"Turn validation present: {bool(tv)}")
