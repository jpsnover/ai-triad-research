import sys, json
sys.stdout.reconfigure(encoding='utf-8')
ROOT = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin'
total = 0
for f in ['accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json']:
    d = json.load(open(f'{ROOT}/{f}', encoding='utf-8'))
    n = len(d.get('nodes', []))
    total += n
    cats = {}
    for node in d.get('nodes', []):
        c = node.get('category', 'uncategorized')
        cats[c] = cats.get(c, 0) + 1
    print(f"{f:25s}: {n:4d} nodes  {dict(cats)}")
print(f"{'TOTAL':25s}: {total:4d} nodes")
