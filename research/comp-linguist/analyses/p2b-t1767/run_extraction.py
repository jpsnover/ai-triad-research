"""Out-of-band Phase 2b validation harness (no production change).

Runs the debate entity-extraction VARIANT and the fact-instrument CONTROL over the
same locked 10-statement sample. Single-variable: only the system prompt differs; the
user message (incl. the same JSON-format instruction) is identical across arms.

Model: claude-sonnet-4-6 (production entity-extraction tier), temperature 0.1, max_tokens 2000.
Requires ANTHROPIC_API_KEY in env. Writes run_variant.json and run_control.json.
"""
import json, os, sys, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))  # worktree root
MODEL = 'claude-sonnet-4-6'
API_KEY = os.environ['ANTHROPIC_API_KEY']

JSON_INSTR = (
    '\n\nRespond with ONLY a JSON object, no prose, of exactly this shape:\n'
    '{"proposals":[{"name":str,"entity_type":"person|artifact|event|legislation|institution",'
    '"aliases":[str],"quote":str,"confidence":number}],"org_mentions":[{"name":str}]}'
)

# Control system = shipped fact instrument, read verbatim from ai-usages.json
usages = json.load(open(os.path.join(REPO, 'ai-usages.json'), encoding='utf-8'))
U = usages.get('usages', usages)['enrichment.entity-extraction']
CONTROL_SYS = U['systemMessage']
VARIANT_SYS = open(os.path.join(HERE, 'variant_system.txt'), encoding='utf-8').read().strip()

sample = json.load(open(os.path.join(HERE, 'sample_statements.json'), encoding='utf-8'))


def user_msg(rec):
    return f"Speaker camp: {rec['speaker']}\n\nStatement to extract entities from:\n{rec['content']}" + JSON_INSTR


def call(system, user):
    body = json.dumps({
        'model': MODEL,
        'max_tokens': 2000,
        'temperature': 0.1,
        'system': system,
        'messages': [
            {'role': 'user', 'content': user},
        ],
    }).encode('utf-8')
    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages', data=body,
        headers={'x-api-key': API_KEY, 'anthropic-version': '2023-06-01',
                 'content-type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                out = json.load(r)
            raw = out['content'][0]['text']
            txt = raw[raw.index('{'):raw.rindex('}') + 1]  # strip any prose around the JSON
            return json.loads(txt)
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:200]
            if e.code in (429, 500, 503, 529) and attempt < 3:
                time.sleep(2 ** attempt * 3)
                continue
            raise RuntimeError(f'HTTP {e.code}: {msg}')
        except (json.JSONDecodeError, KeyError) as e:
            if attempt < 3:
                time.sleep(3)
                continue
            raise RuntimeError(f'parse error: {e}; raw={raw[:300]!r}')


def run_arm(system, label):
    results = {}
    for key, rec in sample.items():
        r = call(system, user_msg(rec))
        results[key] = r
        n = len(r.get('proposals', []))
        print(f'[{label}] {key} -> {n} proposals', flush=True)
        time.sleep(1)
    return results


if __name__ == '__main__':
    arm = sys.argv[1] if len(sys.argv) > 1 else 'both'
    if arm in ('variant', 'both'):
        v = run_arm(VARIANT_SYS, 'variant')
        json.dump(v, open(os.path.join(HERE, 'run_variant.json'), 'w'), indent=2, ensure_ascii=False)
        print('wrote run_variant.json')
    if arm in ('control', 'both'):
        c = run_arm(CONTROL_SYS, 'control')
        json.dump(c, open(os.path.join(HERE, 'run_control.json'), 'w'), indent=2, ensure_ascii=False)
        print('wrote run_control.json')
