"""Out-of-band Phase 2b v2 validation harness (no production change) — t/2678.

Runs FOUR arms over the same locked 10-statement sample (frozen copy of the v1 sample):
  variant_hint    = v2 debate instrument (variant_system.txt), user msg WITH `Speaker camp:` line
  control_hint    = shipped fact instrument system, user msg WITH `Speaker camp:` line
  variant_nohint  = v2 debate instrument, user msg WITHOUT camp line   (clean Rule 4b arm)
  control_nohint  = shipped fact instrument, user msg WITHOUT camp line (clean Rule 4b arm)

Single-variable within each hint condition: only the system prompt differs. The no-hint pair
strips the `Speaker camp:` user line so the system-prompt camp exclusion is the ONLY camp signal
— the confound the v1 run flagged (control_hint emitted 0 raw camp labels, making Rule 4b
inconclusive). Precision/coverage are read from variant_hint (production-faithful: the variant's
design keeps the camp line as load-bearing). Rule 4b compares the two no-hint arms.

Model: claude-sonnet-4-6 (production entity-extraction tier), temperature 0.1, max_tokens 2000.
Requires ANTHROPIC_API_KEY in env. Writes run_<arm>.json for each arm.
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


def user_msg(rec, hint):
    head = f"Speaker camp: {rec['speaker']}\n\n" if hint else ""
    return f"{head}Statement to extract entities from:\n{rec['content']}" + JSON_INSTR


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


def run_arm(system, hint, label):
    results = {}
    for key, rec in sample.items():
        r = call(system, user_msg(rec, hint))
        results[key] = r
        n = len(r.get('proposals', []))
        print(f'[{label}] {key} -> {n} proposals', flush=True)
        time.sleep(1)
    return results


ARMS = {
    'variant_hint':   (lambda: VARIANT_SYS, True),
    'control_hint':   (lambda: CONTROL_SYS, True),
    'variant_nohint': (lambda: VARIANT_SYS, False),
    'control_nohint': (lambda: CONTROL_SYS, False),
}

if __name__ == '__main__':
    which = sys.argv[1:] or list(ARMS)
    for label in which:
        sysfn, hint = ARMS[label]
        res = run_arm(sysfn(), hint, label)
        json.dump(res, open(os.path.join(HERE, f'run_{label}.json'), 'w'), indent=2, ensure_ascii=False)
        print(f'wrote run_{label}.json')
