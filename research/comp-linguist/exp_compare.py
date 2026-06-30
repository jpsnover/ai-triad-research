#!/usr/bin/env python3
"""Reusable expensive-vs-cheap comparison for the flash-lite cost experiment.
Joins each debate's session (for id) with its calibration-log.jsonl entry (full metric set),
plus diagnostics (speed/tokens). Run after each phase; reads Phase 2 manifest when present."""
import json, glob, os, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
DATA = r"C:/Users/jsnov/repos/ai-triad-data"
HERE = os.path.dirname(os.path.abspath(__file__))

# Build calibration index by debate_id (latest entry wins)
idx = {}
for jf in glob.glob(os.path.join(DATA, 'calibration/**/calibration-log.jsonl'), recursive=True) + \
          glob.glob(os.path.join(DATA, 'debates/calibration/**/calibration-log.jsonl'), recursive=True):
    for line in open(jf, encoding='utf-8'):
        line = line.strip()
        if not line: continue
        try:
            e = json.loads(line); d = e.get('debate_id')
            if d: idx[d] = e
        except Exception: pass

def sid(path):
    try: return json.load(open(path, encoding='utf-8')).get('id')
    except Exception: return None

def resolve(path):
    """Return an existing session path; if missing, try debates/debate-<id>.json by reading any sibling."""
    if path and os.path.exists(path): return path
    return path

def diag_for(session_path):
    """Find the matching -diagnostics.json next to a cli-runs session, for timing/tokens."""
    base = session_path.replace('-debate.json', '')
    p = base + '-diagnostics.json'
    if os.path.exists(p):
        o = json.load(open(p, encoding='utf-8')).get('overview', {})
        return o
    return {}

# Metrics: (key, label, higher_is_better)
METRICS = [
    ('crux_addressed_ratio', 'crux_addressed', True),
    ('repetition_rate', 'repetition', False),
    ('claims_forgotten_rate', 'claims_forgotten', False),
    ('taxonomy_mapped_ratio', 'taxonomy_mapped', True),
    ('topic_alignment_rate', 'topic_alignment', True),
    ('situation_crux_alignment', 'situation_crux_align', True),
    ('avg_utilization_rate', 'utilization', True),
    ('draft_repair_rate', 'draft_repair', False),
    ('avg_grounding_confidence', 'grounding', True),
    ('avg_branch_cohesion', 'branch_cohesion', True),
    ('process_reward_mean', 'PRM_mean', True),
    ('extraction_coverage_rate', 'extraction_cov', True),
    ('affect_appropriateness', 'affect_approp', True),
    ('source_authority_mean', 'source_authority', True),
    ('camp_insularity_rate', 'camp_insularity', False),
]

def num(x):
    return x if isinstance(x, (int, float)) else None

def compare(topic, exp_path, cheap_path):
    ex_id, ch_id = sid(exp_path), sid(cheap_path)
    ex, ch = idx.get(ex_id), idx.get(ch_id)
    print(f"\n{'='*70}\nTOPIC: {topic}\n  expensive id={ex_id}  (calib: {'yes' if ex else 'MISSING'})")
    print(f"  cheap     id={ch_id}  (calib: {'yes' if ch else 'MISSING'})")
    if not ex or not ch:
        print("  -- cannot compare (missing calibration entry) --"); return None
    # speed/cost
    de, dc = diag_for(exp_path), diag_for(cheap_path)
    em, cm = de.get('total_response_time_ms'), dc.get('total_response_time_ms')
    if em and cm:
        print(f"  SPEED: expensive {em/1000:.0f}s vs cheap {cm/1000:.0f}s  -> cheap {(1-cm/em)*100:.1f}% faster")
    eo, co = (de.get('total_output_tokens'), dc.get('total_output_tokens'))
    if eo and co:
        print(f"  OUTPUT TOKENS: expensive {eo} vs cheap {co}")
    print(f"  {'metric':22} {'expensive':>10} {'cheap':>10} {'delta':>9}  flag")
    worse = []
    for key, label, hib in METRICS:
        e, c = num(ex.get(key)), num(ch.get(key))
        if e is None or c is None:
            print(f"  {label:22} {str(ex.get(key)):>10} {str(ch.get(key)):>10} {'--':>9}"); continue
        delta = c - e
        # 'worse' if cheap moved meaningfully in the bad direction (>0.05 abs)
        bad = (delta < -0.05) if hib else (delta > 0.05)
        flag = 'WORSE' if bad else ('better' if ((delta > 0.05) if hib else (delta < -0.05)) else '~')
        if bad: worse.append(label)
        print(f"  {label:22} {e:>10.3f} {c:>10.3f} {delta:>+9.3f}  {flag}")
    print(f"  >> cheap meaningfully worse on: {worse if worse else 'NONE'}")
    return worse

# Topic set: Phase 1 known + Phase 2 from manifest (when present)
topics = [
    ('liability (Phase 1)',
     os.path.join(DATA, 'debates/debate-0826455a-7a71-4d2d-90b2-b4ca597f1c3b.json'),
     os.path.join(DATA, 'debates/cli-runs/exp-brief-cite-flash-cheap-phase1-debate.json')),
]
man = os.path.join(HERE, 'exp-phase2-manifest.json')
if os.path.exists(man):
    rows = json.load(open(man, encoding='utf-8'))
    if isinstance(rows, dict): rows = [rows]
    by = {}
    for r in rows:
        by.setdefault(r['topic'], {})[r['arm']] = r.get('sessionPath')
    for t, arms in by.items():
        if arms.get('expensive') and arms.get('cheap'):
            topics.append((f'{t} (Phase 2)', arms['expensive'], arms['cheap']))

all_worse = {}
for topic, ep, cp in topics:
    w = compare(topic, ep, cp)
    if w is not None: all_worse[topic] = w

print(f"\n{'='*70}\nVERDICT across {len(all_worse)} topic(s):")
any_worse = any(all_worse.values())
for t, w in all_worse.items():
    print(f"  {t}: {'cheap worse on '+str(w) if w else 'quality-neutral'}")
print(f"\n  => cheap config is {'NOT uniformly neutral (see flags)' if any_worse else 'QUALITY-NEUTRAL across all topics'}")
