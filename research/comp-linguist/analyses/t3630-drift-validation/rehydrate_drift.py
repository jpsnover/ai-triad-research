import json, os
DATA = os.environ['AI_TRIAD_DATA_ROOT']
SP = r"C:\Users\jsnov\AppData\Local\Temp\claude\C--Users-jsnov-repos-ai-triad-research-research-comp-linguist\01a0a9ce-3623-70e6-aaa4-77fcf8bac0d4\scratchpad"
man = json.load(open(os.path.join(SP, 'drift-annotation-manifest.json'), encoding='utf-8'))['sample']

cache = {}
def load(did):
    if did not in cache:
        cache[did] = json.load(open(os.path.join(DATA, 'debates', f'debate-{did}.json'), encoding='utf-8'))
    return cache[did]

items = []
missing = 0
for e in man:
    d = load(e['debate_id'])
    tr = d.get('transcript') or []
    idx = next((i for i, x in enumerate(tr) if isinstance(x, dict) and x.get('id') == e['turn_id']), None)
    if idx is None:
        missing += 1; continue
    topic = d.get('topic') or {}
    seed = (topic.get('scope') or {}).get('core_proposition') or topic.get('final') or ''
    cruxes = [c.get('description', '').strip() for c in (d.get('crux_tracker') or []) if (c.get('description') or '').strip()]
    ctx = []
    j = idx - 1
    while j >= 0 and len(ctx) < 2:
        x = tr[j]
        if isinstance(x, dict) and x.get('type') in ('statement', 'opening') and x.get('speaker') in ('accelerationist', 'safetyist', 'skeptic', 'user'):
            ctx.append({'speaker': x.get('speaker'), 'text': (x.get('content') or '').strip()[:700]})
        j -= 1
    ctx.reverse()
    items.append({
        'sample_id': e['sample_id'],
        'seeded_question': seed,
        'active_cruxes': cruxes,
        'target_speaker': e['speaker'],
        'round': e['round'],
        'context_prior_turns': ctx,
        'target_text': (tr[idx].get('content') or '').strip(),
    })

out = os.path.join(SP, 'drift-annotation-items.json')
json.dump({'n': len(items), 'items': items}, open(out, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(f"rehydrated {len(items)} items | missing {missing}")
print(f"median target len: {sorted(len(i['target_text']) for i in items)[len(items)//2]}; median #cruxes: {sorted(len(i['active_cruxes']) for i in items)[len(items)//2]}")
print("wrote", out)
