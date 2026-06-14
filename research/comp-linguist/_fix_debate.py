"""Fix the stuck debate by setting model and advancing phase."""
import json, os

DATA_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ai-triad-data'))
debate_path = os.path.join(DATA_ROOT, 'debates', 'debate-09166434-9189-406b-a2bb-4bd61381e1b6.json')

with open(debate_path, encoding='utf-8') as f:
    d = json.load(f)

d['debate_model'] = 'claude-sonnet-4-6'
d['phase'] = 'opening'
print(f"Set debate_model={d['debate_model']}, phase={d['phase']}")

with open(debate_path, 'w', encoding='utf-8') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write('\n')

print("Debate file updated")
