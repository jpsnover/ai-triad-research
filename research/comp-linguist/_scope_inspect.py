import sys, json, glob, os
sys.stdout.reconfigure(encoding='utf-8')
DEBATE_DIR = 'C:/Users/jsnov/repos/ai-triad-data/debates'
files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)
with open(files[0], encoding='utf-8') as f:
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
