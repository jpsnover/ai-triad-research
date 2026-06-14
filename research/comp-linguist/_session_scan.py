"""Session startup scan — calibration metrics + recent debate inspection."""
import json, os, sys
sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ai-triad-data'))
DEBATES_DIR = os.path.join(DATA_ROOT, 'debates')
CAL_DIR = os.path.join(DATA_ROOT, 'calibration')

print("=== CALIBRATION LOG SCAN ===")
cal_path = os.path.join(CAL_DIR, 'calibration-log.json')
if os.path.exists(cal_path):
    with open(cal_path, encoding='utf-8') as f:
        cal = json.load(f)
    if isinstance(cal, list):
        print(f"  Entries: {len(cal)}")
        for entry in cal[-5:]:
            did = entry.get('debate_id', '?')[:12]
            ts = entry.get('timestamp', '?')
            metrics = {k: v for k, v in entry.items() if k not in ('debate_id', 'timestamp', 'topic', 'config')}
            print(f"  [{ts}] {did}... keys={list(metrics.keys())[:8]}")
    elif isinstance(cal, dict):
        print(f"  Top keys: {list(cal.keys())[:10]}")
        entries = cal.get('entries', cal.get('log', []))
        if isinstance(entries, list):
            print(f"  Log entries: {len(entries)}")
            for entry in entries[-5:]:
                print(f"    {json.dumps(entry, default=str)[:200]}")
        else:
            print(f"  Structure sample: {json.dumps(cal, default=str)[:300]}")
else:
    print("  calibration-log.json NOT FOUND")

print("\n=== RECENT DEBATES ===")
import glob
debate_files = sorted(glob.glob(os.path.join(DEBATES_DIR, 'debate-*.json')),
                      key=os.path.getmtime, reverse=True)[:5]
for df in debate_files:
    with open(df, encoding='utf-8') as f:
        d = json.load(f)
    topic = d.get('refined_topic', d.get('topic', '?'))
    if isinstance(topic, str):
        topic = topic[:80]
    an = d.get('argument_network', {})
    nodes = an.get('nodes', [])
    att = [n for n in nodes if n.get('claim_taxonomy_attribution')]
    genus = [n for n in nodes if n.get('attribution_text_genus')]
    cal_log = d.get('calibration_log', {})
    cal_keys = list(cal_log.keys()) if isinstance(cal_log, dict) else 'list' if isinstance(cal_log, list) else 'none'
    mtime = os.path.getmtime(df)
    from datetime import datetime
    ts = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M')
    print(f"\n  [{ts}] {os.path.basename(df)[:40]}")
    print(f"    Topic: {topic}")
    print(f"    AN nodes: {len(nodes)}, Attributed: {len(att)}, Has genus: {len(genus)}")
    if isinstance(cal_log, dict) and cal_log:
        owned = ['crux_addressed_rate', 'repetition_rate', 'claims_forgotten',
                 'convergence_score', 'situation_crux_alignment']
        for m in owned:
            if m in cal_log:
                print(f"    {m}: {cal_log[m]}")
    print(f"    Cal log keys: {cal_keys}")

print("\n=== EXTRACTION METRICS ===")
ext_path = os.path.join(CAL_DIR, 'extraction-metrics.json')
if os.path.exists(ext_path):
    with open(ext_path, encoding='utf-8') as f:
        ext = json.load(f)
    print(f"  Top keys: {list(ext.keys())[:10]}")
    print(f"  Sample: {json.dumps(ext, default=str)[:400]}")
else:
    print("  extraction-metrics.json NOT FOUND")
