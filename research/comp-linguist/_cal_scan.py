"""Focused calibration metric scan for CL session startup."""
import json, os, sys
from datetime import datetime, timedelta
sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ai-triad-data'))
CAL_LOG = os.path.join(DATA_ROOT, 'calibration', 'calibration-log.json')

OWNED_METRICS = [
    'crux_addressed_ratio', 'crux_addressed_rate',
    'repetition_rate', 'claims_forgotten',
    'convergence_score', 'situation_crux_alignment',
    'engaging_real_disagreement',
]

with open(CAL_LOG, encoding='utf-8') as f:
    entries = json.load(f)

print(f"Total calibration entries: {len(entries)}")

cutoff = datetime.utcnow() - timedelta(days=7)
recent = []
for e in entries:
    ts_str = e.get('timestamp', '')
    try:
        ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00').replace('+00:00', ''))
        if ts >= cutoff:
            recent.append(e)
    except:
        pass

print(f"Entries in last 7 days: {len(recent)}")

if not recent:
    prior = entries[-20:]
    print(f"\nNo entries in 7-day window. Showing last {len(prior)} entries:")
    for e in prior[-5:]:
        print(f"  [{e.get('timestamp','')}] {e.get('debate_id','?')[:12]}...")
        for m in OWNED_METRICS:
            if m in e:
                print(f"    {m}: {e[m]}")

else:
    first_half = recent[:len(recent)//2] if len(recent) > 1 else recent
    second_half = recent[len(recent)//2:] if len(recent) > 1 else recent

    print(f"\n=== 7-DAY ROLLING METRIC SUMMARY ===")
    print(f"First half: {len(first_half)} entries, Second half: {len(second_half)} entries")

    for m in OWNED_METRICS:
        vals_first = [e[m] for e in first_half if m in e and isinstance(e[m], (int, float))]
        vals_second = [e[m] for e in second_half if m in e and isinstance(e[m], (int, float))]
        if vals_first and vals_second:
            avg_first = sum(vals_first) / len(vals_first)
            avg_second = sum(vals_second) / len(vals_second)
            delta = avg_second - avg_first
            pct = (delta / avg_first * 100) if avg_first != 0 else 0
            flag = " *** REGRESSION >5%" if abs(pct) > 5 and ((m in ('repetition_rate', 'claims_forgotten') and delta > 0) or (m not in ('repetition_rate', 'claims_forgotten') and delta < 0)) else ""
            print(f"  {m}: {avg_first:.4f} -> {avg_second:.4f} (delta {delta:+.4f}, {pct:+.1f}%){flag}")
        elif vals_first or vals_second:
            vals = vals_first or vals_second
            print(f"  {m}: {sum(vals)/len(vals):.4f} (only in {'first' if vals_first else 'second'} half, n={len(vals)})")
        # else: metric not present

# Check recent debates for genus adoption
import glob
DEBATES_DIR = os.path.join(DATA_ROOT, 'debates')
debate_files = sorted(glob.glob(os.path.join(DEBATES_DIR, 'debate-*.json')),
                      key=os.path.getmtime, reverse=True)[:5]
print(f"\n=== RECENT DEBATES (genus adoption check) ===")
for df in debate_files:
    with open(df, encoding='utf-8') as f:
        d = json.load(f)
    topic = d.get('refined_topic', d.get('topic', '?'))
    if isinstance(topic, dict):
        topic = topic.get('final', topic.get('refined', topic.get('original', '?')))
    if isinstance(topic, str):
        topic = topic[:100]
    an = d.get('argument_network', {})
    nodes = an.get('nodes', [])
    att = [n for n in nodes if n.get('claim_taxonomy_attribution')]
    genus = [n for n in nodes if n.get('attribution_text_genus')]
    att_emb = [n for n in nodes if n.get('attribution_embedding')]
    ts = datetime.fromtimestamp(os.path.getmtime(df)).strftime('%m/%d %H:%M')
    print(f"\n  [{ts}] AN:{len(nodes)} Attr:{len(att)} Genus:{len(genus)} AttrEmb:{len(att_emb)}")
    print(f"    {topic}")
