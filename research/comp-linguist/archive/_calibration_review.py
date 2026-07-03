"""
Calibration review: assess debate quality impact of recent engine changes.
Ticket: t/461
"""
import json, os, glob, sys
from datetime import datetime, timedelta
from collections import defaultdict

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data'
DEBATE_DIR = os.path.join(DATA_ROOT, 'debates')
CAL_LOG = os.path.join(DATA_ROOT, 'calibration', 'calibration-log.json')
OUT_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_calibration_review.json'

now = datetime(2026, 6, 6, 20, 0, 0)
week_ago = now - timedelta(days=7)

# ── 1. Calibration log analysis ──
with open(CAL_LOG, encoding='utf-8') as f:
    cal_entries = json.load(f)

cal_entries.sort(key=lambda e: e.get('timestamp', ''))

recent_entries = [e for e in cal_entries if e.get('timestamp', '') >= week_ago.isoformat()]

owned_metrics = [
    'crux_addressed_ratio', 'repetition_rate', 'claims_forgotten_rate',
    'avg_utilization_rate', 'structural_error_rate', 'qbaf_preference_concordance',
    'taxonomy_mapped_ratio', 'recycling_novelty_agreement'
]

cal_summary = {}
for metric in owned_metrics:
    vals = [(e.get('timestamp'), e.get(metric)) for e in recent_entries if e.get(metric) is not None]
    all_vals = [(e.get('timestamp'), e.get(metric)) for e in cal_entries if e.get(metric) is not None]
    if vals:
        cal_summary[metric] = {
            'recent_count': len(vals),
            'recent_mean': sum(v for _, v in vals) / len(vals),
            'recent_min': min(v for _, v in vals),
            'recent_max': max(v for _, v in vals),
            'recent_latest': vals[-1][1],
        }
        if len(all_vals) > len(vals):
            older = all_vals[:len(all_vals) - len(vals)]
            if older:
                baseline = sum(v for _, v in older) / len(older)
                cal_summary[metric]['baseline'] = baseline
                cal_summary[metric]['delta'] = cal_summary[metric]['recent_mean'] - baseline
                cal_summary[metric]['delta_pct'] = (cal_summary[metric]['delta'] / baseline * 100) if baseline != 0 else None
    else:
        cal_summary[metric] = {'recent_count': 0, 'note': 'No data in last 7 days'}

# ── 2. Find and load recent debates ──
debate_files = glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json'))
debate_meta = []
for fp in debate_files:
    try:
        with open(fp, encoding='utf-8') as f:
            d = json.load(f)
        ts = d.get('updated_at') or d.get('created_at', '')
        statements = [e for e in d.get('transcript', []) if e.get('type') == 'statement']
        if len(statements) >= 3:
            debate_meta.append({
                'id': d.get('id', ''),
                'path': fp,
                'timestamp': ts,
                'statement_count': len(statements),
                'phase': d.get('phase', ''),
                'app_version': d.get('app_version', ''),
            })
    except Exception:
        pass

debate_meta.sort(key=lambda x: x['timestamp'], reverse=True)

# ── 3. Extract per-debate quality metrics ──
def extract_debate_metrics(debate_data):
    transcript = debate_data.get('transcript', [])
    statements = [e for e in transcript if e.get('type') == 'statement']
    diag_entries = debate_data.get('diagnostics', {}).get('entries', {})
    an = debate_data.get('argument_network', {})
    cruxes = debate_data.get('crux_tracker', [])
    convergence = debate_data.get('convergence_signals', [])
    turn_validations = debate_data.get('turn_validations', {})

    process_rewards = []
    accept_with_flag_count = 0
    pass_count = 0
    skip_count = 0
    quality_gate_pass = 0
    quality_gate_fail = 0
    lookahead_results = []
    stageA_scores = []

    for s in statements:
        eid = s['id']
        diag = diag_entries.get(eid, {})

        tv = turn_validations.get(eid, {})
        tv_final = tv.get('final', {})
        outcome = tv_final.get('outcome') or tv.get('turn_validation_outcome', tv.get('outcome'))
        if outcome == 'accept_with_flag':
            accept_with_flag_count += 1
        elif outcome == 'pass':
            pass_count += 1
        elif outcome == 'skipped':
            skip_count += 1

        pr = tv_final.get('process_reward') or tv.get('process_reward')
        if pr is not None:
            process_rewards.append({'speaker': s.get('speaker'), 'score': pr, 'outcome': outcome})

        stageA = tv_final.get('stageA_score') or tv.get('stageA_score')
        if stageA is not None:
            stageA_scores.append(stageA)

        qg = diag.get('quality_gate')
        if qg:
            final_qg = qg.get('post_repair') or qg.get('pre_repair') or qg
            if final_qg.get('pass'):
                quality_gate_pass += 1
            else:
                quality_gate_fail += 1

        la = diag.get('lookahead')
        if la:
            fa = la.get('first_attempt', {})
            weak_count = 0
            strong_count = 0
            pca_list = la.get('per_claim_analysis', [])
            if pca_list:
                analysis = pca_list[0].get('analysis', {})
                weak_count = len(analysis.get('avoidClaims', []))
                strong_count = len(analysis.get('strongFoundations', []))
            lookahead_results.append({
                'speaker': s.get('speaker'),
                'final_pass': la.get('final_pass'),
                'regen_triggered': la.get('regen_triggered'),
                'utility_delta': fa.get('utility_delta'),
                'weak_claims': weak_count,
                'strong_claims': strong_count,
            })

    conv_signals = []
    for cs in convergence:
        conv_signals.append({
            'round': cs.get('round'),
            'dialectical_engagement': cs.get('dialectical_engagement'),
            'argument_redundancy': cs.get('argument_redundancy'),
            'crux_engagement_rate': cs.get('crux_engagement_rate'),
        })

    nodes = an.get('nodes', [])
    edges = an.get('edges', [])
    speakers = defaultdict(int)
    strengths = []
    for n in nodes:
        speakers[n.get('speaker', 'unknown')] += 1
        cs = n.get('computed_strength')
        if cs is not None:
            strengths.append(cs)

    avg_pr = sum(p['score'] for p in process_rewards) / len(process_rewards) if process_rewards else None
    avg_strength = sum(strengths) / len(strengths) if strengths else None

    concession_count = sum(1 for s in statements if 'concede' in s.get('content', '').lower() or 'I grant' in s.get('content', '').lower())

    return {
        'id': debate_data.get('id'),
        'title': debate_data.get('title', '')[:120],
        'timestamp': debate_data.get('updated_at') or debate_data.get('created_at', ''),
        'phase': debate_data.get('phase'),
        'app_version': debate_data.get('app_version'),
        'model': debate_data.get('config', {}).get('model'),
        'temperature': debate_data.get('config', {}).get('temperature'),
        'statement_count': len(statements),
        'transcript_length': len(transcript),
        'process_rewards': process_rewards,
        'avg_process_reward': avg_pr,
        'accept_with_flag_count': accept_with_flag_count,
        'pass_count': pass_count,
        'skip_count': skip_count,
        'quality_gate_pass': quality_gate_pass,
        'quality_gate_fail': quality_gate_fail,
        'stageA_scores': stageA_scores,
        'avg_stageA': sum(stageA_scores) / len(stageA_scores) if stageA_scores else None,
        'lookahead_results': lookahead_results,
        'lookahead_regen_count': sum(1 for l in lookahead_results if l.get('regen_triggered')),
        'lookahead_weak_total': sum(l.get('weak_claims', 0) for l in lookahead_results),
        'an_node_count': len(nodes),
        'an_edge_count': len(edges),
        'an_speakers': dict(speakers),
        'avg_node_strength': avg_strength,
        'crux_count': len(cruxes),
        'convergence_signals': conv_signals,
        'concession_mentions': concession_count,
        'edge_density': len(edges) / len(nodes) if nodes else 0,
    }

# Extract metrics for the 5 most recent debates
all_metrics = []
for dm in debate_meta[:5]:
    try:
        with open(dm['path'], encoding='utf-8') as f:
            d = json.load(f)
        all_metrics.append(extract_debate_metrics(d))
    except Exception as ex:
        all_metrics.append({'id': dm['id'], 'error': str(ex)})

# ── 4. Build report ──
report = {
    'generated_at': now.isoformat(),
    'debates_analyzed': all_metrics,
    'calibration_log': {
        'total_entries': len(cal_entries),
        'recent_entries_7d': len(recent_entries),
        'metrics': cal_summary,
    },
}

with open(OUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(report, f, indent=2, ensure_ascii=False, default=str)

print(f"Report written to {OUT_PATH}")

print(f"\n{'='*70}")
print(f"CALIBRATION REVIEW — {now.strftime('%Y-%m-%d')}")
print(f"{'='*70}")

print(f"\n--- CALIBRATION LOG (7-day window, {len(recent_entries)} entries) ---")
for metric, data in cal_summary.items():
    if data.get('recent_count', 0) > 0:
        delta_str = ""
        if 'delta_pct' in data and data['delta_pct'] is not None:
            arrow = '+' if data['delta_pct'] > 0 else ''
            delta_str = f" | vs baseline: {arrow}{data['delta_pct']:.1f}%"
        print(f"  {metric:35s} mean={data['recent_mean']:.3f}  range=[{data['recent_min']:.3f}, {data['recent_max']:.3f}]  n={data['recent_count']}{delta_str}")
    else:
        print(f"  {metric:35s} {data.get('note', 'no data')}")

print(f"\n--- DEBATE COMPARISON (most recent {len(all_metrics)}) ---")
print(f"  {'ID':10s} {'Date':12s} {'Stmts':>5s} {'AvgPR':>6s} {'Flags':>5s} {'Pass':>4s} {'AN':>4s} {'Crux':>4s} {'Dens':>5s} {'Regens':>6s} {'Weak':>4s} {'Conc':>4s} {'AvgSA':>6s}")
print(f"  {'-'*10} {'-'*12} {'-'*5} {'-'*6} {'-'*5} {'-'*4} {'-'*4} {'-'*4} {'-'*5} {'-'*6} {'-'*4} {'-'*4} {'-'*6}")
for m in all_metrics:
    if 'error' in m:
        print(f"  {m.get('id','?')[:10]:10s} ERROR: {m['error'][:50]}")
        continue
    pr_str = f"{m['avg_process_reward']:.3f}" if m['avg_process_reward'] else "  N/A"
    sa_str = f"{m['avg_stageA']:.2f}" if m.get('avg_stageA') else "  N/A"
    ts = m.get('timestamp', '')[:10]
    print(f"  {m['id'][:10]:10s} {ts:12s} {m['statement_count']:5d} {pr_str:>6s} {m['accept_with_flag_count']:5d} {m['pass_count']:4d} {m['an_node_count']:4d} {m['crux_count']:4d} {m['edge_density']:5.2f} {m['lookahead_regen_count']:6d} {m['lookahead_weak_total']:4d} {m['concession_mentions']:4d} {sa_str:>6s}")

# Per-debate detail for top debate
if all_metrics and 'error' not in all_metrics[0]:
    top = all_metrics[0]
    print(f"\n--- LATEST DEBATE DETAIL: {top['id'][:10]} ---")
    print(f"  Title: {top['title']}")
    print(f"  Phase: {top['phase']} | Model: {top['model']} | Temp: {top['temperature']}")
    print(f"  Version: {top['app_version']}")

    print(f"\n  Process Rewards:")
    for i, pr in enumerate(top['process_rewards']):
        print(f"    S{i+1} ({pr['speaker']:15s}): {pr['score']:.3f} [{pr['outcome']}]")

    print(f"\n  Convergence Signals:")
    for cs in top['convergence_signals']:
        r = cs.get('round', '?')
        de = cs.get('dialectical_engagement', '?')
        ar = cs.get('argument_redundancy')
        ce = cs.get('crux_engagement_rate')
        ar_str = f"{ar:.3f}" if isinstance(ar, (int, float)) else str(ar)
        ce_str = f"{ce:.3f}" if isinstance(ce, (int, float)) else str(ce)
        print(f"    Round {r}: engagement={de}, redundancy={ar_str}, crux_engage={ce_str}")

    print(f"\n  Lookahead Gate:")
    for i, la in enumerate(top['lookahead_results']):
        status = "REGEN" if la.get('regen_triggered') else ("PASS" if la.get('final_pass') else "FAIL")
        ud = la.get('utility_delta')
        ud_str = f"{ud:.4f}" if ud is not None else "N/A"
        print(f"    S{i+1} ({la['speaker']:15s}): {status:5s} delta={ud_str} strong={la.get('strong_claims',0)} weak={la.get('weak_claims',0)}")

    print(f"\n  AN Speakers: {top['an_speakers']}")
