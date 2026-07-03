import sys, json
sys.stdout.reconfigure(encoding='utf-8')
fp = 'C:/Users/jsnov/repos/ai-triad-data/debates/debate-a4821a34-1efb-4f90-bb88-32e9e57ff060.json'
with open(fp, encoding='utf-8') as f:
    d = json.load(f)
topic = d.get('topic', {})
scope = topic.get('scope', {})
print('Debate:', d.get('title', '')[:100])
print('Topic:', topic.get('text', '')[:300])
print()
print('=== TopicScope ===')
for k, v in scope.items():
    if isinstance(v, list):
        print(f'  {k}:')
        for item in v:
            print(f'    - {str(item)[:150]}')
    else:
        print(f'  {k}: {str(v)[:200]}')

# Also show the quality gate weaknesses for all 12 statements
print()
print('=== QUALITY GATE WEAKNESSES ===')
diag_entries = d.get('diagnostics', {}).get('entries', {})
statements = [e for e in d.get('transcript', []) if e.get('type') == 'statement']
for i, s in enumerate(statements):
    eid = s['id']
    qg = diag_entries.get(eid, {}).get('quality_gate', {})
    pre = qg.get('pre_repair', {})
    post = qg.get('post_repair', {})
    repair = qg.get('repair_outcome', 'none')
    pre_w = pre.get('weaknesses', [])
    post_w = post.get('weaknesses', [])
    print(f'\nS{i+1} ({s.get("speaker")}) pre_pass={pre.get("pass")} topic_aligned={pre.get("topic_aligned")}')
    for w in pre_w:
        if 'REPAIR' not in w:
            print(f'  PRE: {w[:150]}')
    if post:
        print(f'  repair_outcome={repair} post_pass={post.get("pass")} post_topic={post.get("topic_aligned")}')
        for w in post_w:
            if 'REPAIR' not in w:
                print(f'  POST: {w[:150]}')
