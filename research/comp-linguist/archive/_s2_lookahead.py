import json

with open('C:/Users/jsnov/repos/ai-triad-data/debates/debate-7362765b-13ac-4b44-9100-dc4467f775d0.json', encoding='utf-8') as f:
    d = json.load(f)

statements = [(i, e) for i, e in enumerate(d.get('transcript', [])) if e.get('type') == 'statement']
idx, s2 = statements[1]
entry_id = s2['id']

diag = d.get('diagnostics', {}).get('entries', {}).get(entry_id, {})
lookahead = diag.get('lookahead')

out = {
    'entry_id': entry_id,
    'speaker': s2.get('speaker'),
    'lookahead': lookahead,
    'metadata_lookahead_regenerated': (s2.get('metadata') or {}).get('lookahead_regenerated'),
    'metadata_lookahead_regen_attempts': (s2.get('metadata') or {}).get('lookahead_regen_attempts'),
}

outpath = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_s2_lookahead.json'
with open(outpath, 'w', encoding='utf-8') as f:
    json.dump(out, f, indent=2, ensure_ascii=False, default=str)

print(f"Written to {outpath}")
print(f"Lookahead present: {lookahead is not None}")
if lookahead:
    print(f"Stage: {lookahead.get('stage')}")
    print(f"Regen triggered: {lookahead.get('regen_triggered')}")
    print(f"Final pass: {lookahead.get('final_pass')}")
    fa = lookahead.get('first_attempt', {})
    print(f"First attempt pass: {fa.get('pass')}")
    print(f"Utility delta: {fa.get('utility_delta')}")
    pca = lookahead.get('per_claim_analysis', [])
    if pca:
        a = pca[0].get('analysis', {})
        strong = a.get('strongFoundations', [])
        avoid = a.get('avoidClaims', [])
        print(f"Strong foundations: {len(strong)}")
        print(f"Avoid claims: {len(avoid)}")
        for c in avoid:
            print(f"  AVOID: {c.get('text', '')[:80]} (delta={c.get('marginal_delta')})")
        for c in strong:
            print(f"  STRONG: {c.get('text', '')[:80]} (delta={c.get('marginal_delta')})")
