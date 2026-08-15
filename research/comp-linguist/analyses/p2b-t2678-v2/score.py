"""Mechanical scorer for PREREG-t2678-phase2b-v2. Gates at 0.6, evaluates against the
locked hand-annotation (identical gold to the v1 prereg — same frozen sample).

Precision/coverage/vocab/gated-camp/resolution are read from the production-faithful
variant_hint arm. Rule 4b (value demonstration) compares the two NO-HINT arms, removing the
v1 confound where the shared `Speaker camp:` line primed both arms away from camp reification.

Matching is substring/alias, case-insensitive; ambiguous residual is printed for adjudication.
Gold is transcribed from the PREREG (committed empty before the run).
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
GATE = 0.6

variant = json.load(open(os.path.join(HERE, 'run_variant_hint.json'), encoding='utf-8'))
control = json.load(open(os.path.join(HERE, 'run_control_hint.json'), encoding='utf-8'))
variant_nh = json.load(open(os.path.join(HERE, 'run_variant_nohint.json'), encoding='utf-8'))
control_nh = json.load(open(os.path.join(HERE, 'run_control_nohint.json'), encoding='utf-8'))

# --- Locked gold (from PREREG, pre-run; identical to v1) --------------------------
CORE = {  # id -> list of (canonical mention, type)
    '2306fafc#3c016066': [('trump', 'person'), ('eu ai act', 'legislation')],
    '2306fafc#d962db00': [('eu ai act', 'legislation')],
    '2306fafc#fddc841e': [('737 max', 'artifact'), ('mcas', 'artifact')],
    '2306fafc#2095442a': [('o1', 'artifact'), ('gpt-4o', 'artifact')],
    'a0eaaca9#82113a5d': [('gdpr', 'legislation')],
    'a0eaaca9#ec612d7c': [('latanya sweeney', 'person')],
    'a0eaaca9#3c0909b1': [('latanya sweeney', 'person')],
}
CORE_TOTAL = sum(len(v) for v in CORE.values())  # = 10
BORDERLINE = ['executive order', 'ai action plan', 'chips', 's&p 500', 'sweeney']  # accept-if-proposed
CAMP_RE = re.compile(r'\b(safetyist|skeptic|accelerationist)\b', re.I)
ROLE_RE = re.compile(r'^(the )?(deployer|regulators?|policymakers?|technology executives?|the other side)$', re.I)
UNIVERSALS = ['risk', 'oversight', 'alignment', 'model weights', 'compliance', 'governance',
              'safety', 'telemetry', 'model parameter']
SOURCE_TITLES = ['reshaping emotional connection', 'ai agents and the law',
                 'artificial intelligence index', 'state of ai in the enterprise',
                 'constructing ai speech', 'ai chip supply chain', 'ai companions reduce loneliness',
                 'student generative', 'guidance on ai and children']
# Orgs that must NOT appear under proposals (belong in org_mentions)
ORGS = ['google', 'meta', 'openai', 'anthropic', 'goldman', 'stripe', 'deloitte', 'unicef',
        'data protection commission', 'boeing', 'nist', 'replika', 'bloomberg', 'gartner',
        'amazon', 'microsoft', 'alphabet', 'harvard']


def gated(arm, key):
    return [p for p in arm[key].get('proposals', []) if float(p.get('confidence', 0)) >= GATE]


def raw_camp(arm):
    hits = []
    for key, r in arm.items():
        for p in r.get('proposals', []):
            if CAMP_RE.search(p.get('name', '')):
                hits.append((key, p.get('name'), p.get('entity_type'), p.get('confidence')))
    return hits


def classify(name, etype):
    n = name.lower().strip()
    if CAMP_RE.search(n) or ROLE_RE.match(n):
        return 'CAMP/ROLE'
    if any(o in n for o in ORGS):
        return 'ORG-in-proposals'
    if any(s in n for s in SOURCE_TITLES):
        return 'SOURCE-TITLE'
    if n in UNIVERSALS or any(n == u for u in UNIVERSALS):
        return 'UNIVERSAL'
    return 'particular?'  # needs eyeball; likely a real particular


# --- Coverage (variant_hint) ---
covered, missed = [], []
for key, golds in CORE.items():
    gp = gated(variant, key)
    names = ' | '.join(p.get('name', '').lower() for p in gp)
    for canon, typ in golds:
        if canon in names:
            covered.append((key, canon))
        else:
            missed.append((key, canon, f'gated names: [{names}]'))

# --- Precision + boundary + camp (variant_hint, gated) ---
gated_rows = []
for key in variant:
    for p in gated(variant, key):
        gated_rows.append((key, p.get('name'), p.get('entity_type'), p.get('confidence'),
                           classify(p.get('name', ''), p.get('entity_type'))))

report = {
    'gate': GATE,
    'core_total': CORE_TOTAL,
    'coverage_n': len(covered),
    'coverage_rate': round(len(covered) / CORE_TOTAL, 3),
    'missed': missed,
    'variant_gated_total': len(gated_rows),
    'variant_gated_camp_or_role': [r for r in gated_rows if r[4] == 'CAMP/ROLE'],
    'variant_gated_org': [r for r in gated_rows if r[4] == 'ORG-in-proposals'],
    'variant_gated_source': [r for r in gated_rows if r[4] == 'SOURCE-TITLE'],
    'variant_gated_universal': [r for r in gated_rows if r[4] == 'UNIVERSAL'],
    # Rule 4b (clean, no-hint): system-prompt camp exclusion is the only camp signal
    'variant_nohint_raw_camp': raw_camp(variant_nh),
    'control_nohint_raw_camp': raw_camp(control_nh),
    # kept for continuity with v1 (hinted arms)
    'variant_hint_raw_camp': raw_camp(variant),
    'control_hint_raw_camp': raw_camp(control),
    'control_gated_total': sum(len(gated(control, k)) for k in control),
}
json.dump({'report': report, 'variant_gated_rows': gated_rows},
          open(os.path.join(HERE, 'scores.json'), 'w'), indent=2, ensure_ascii=False)

print('=== COVERAGE (variant_hint) ===')
print(f'core gold: {CORE_TOTAL} | covered: {len(covered)} | rate: {report["coverage_rate"]}')
for m in missed:
    print('  MISSED:', m)
print('\n=== VARIANT_HINT gated proposals ({}), flagged ==='.format(len(gated_rows)))
for r in gated_rows:
    print(f'  {r[0]} | {r[1]!r} [{r[2]}] c={r[3]} -> {r[4]}')
print('\n=== camp-label RAW proposals — CLEAN no-hint arms (Rule 4b) ===')
print(f'  variant_nohint: {len(report["variant_nohint_raw_camp"])}')
for h in report['variant_nohint_raw_camp']:
    print('    V', h)
print(f'  control_nohint: {len(report["control_nohint_raw_camp"])}')
for h in report['control_nohint_raw_camp']:
    print('    C', h)
print('\n=== camp-label RAW proposals — hinted arms (v1 continuity) ===')
print(f'  variant_hint: {len(report["variant_hint_raw_camp"])} | control_hint: {len(report["control_hint_raw_camp"])}')
print('\ncontrol_hint gated total:', report['control_gated_total'],
      '| variant_hint gated total:', report['variant_gated_total'])
