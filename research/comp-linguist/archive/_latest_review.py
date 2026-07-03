"""Quick review of latest debates vs prior calibration baseline."""
import json, glob, os, sys
sys.stdout.reconfigure(encoding='utf-8')
from collections import defaultdict

DEBATE_DIR = 'C:/Users/jsnov/repos/ai-triad-data/debates'
CAL_LOG = 'C:/Users/jsnov/repos/ai-triad-data/calibration/calibration-log.json'

def extract_metrics(fp):
    with open(fp, encoding='utf-8') as f:
        d = json.load(f)

    transcript = d.get('transcript', [])
    statements = [e for e in transcript if e.get('type') == 'statement']
    diag_entries = d.get('diagnostics', {}).get('entries', {})
    an = d.get('argument_network', {})
    cruxes = d.get('crux_tracker', [])
    convergence = d.get('convergence_signals', [])
    turn_validations = d.get('turn_validations', {})

    process_rewards = []
    accept_with_flag = 0
    pass_count = 0
    skip_count = 0
    qg_pass = 0
    qg_fail = 0
    stageA_scores = []
    lookahead_results = []

    for s in statements:
        eid = s['id']
        diag = diag_entries.get(eid, {})
        tv = turn_validations.get(eid, {})

        outcome = tv.get('turn_validation_outcome', tv.get('outcome'))
        if outcome == 'accept_with_flag':
            accept_with_flag += 1
        elif outcome == 'pass':
            pass_count += 1
        elif outcome == 'skipped':
            skip_count += 1

        pr = tv.get('process_reward')
        if pr is not None:
            process_rewards.append(pr)

        sa = tv.get('stageA_score')
        if sa is not None:
            stageA_scores.append(sa)

        qg = diag.get('quality_gate')
        if qg:
            if qg.get('pass'):
                qg_pass += 1
            else:
                qg_fail += 1

        la = diag.get('lookahead')
        if la:
            fa = la.get('first_attempt', {})
            pca = la.get('per_claim_analysis', [])
            weak = 0
            strong = 0
            if pca:
                analysis = pca[0].get('analysis', {})
                weak = len(analysis.get('avoidClaims', []))
                strong = len(analysis.get('strongFoundations', []))
            lookahead_results.append({
                'speaker': s.get('speaker'),
                'final_pass': la.get('final_pass'),
                'regen_triggered': la.get('regen_triggered'),
                'utility_delta': fa.get('utility_delta'),
                'weak': weak,
                'strong': strong,
            })

    # Crux engagement from convergence signals
    crux_engaged_rounds = 0
    total_conv_rounds = len(convergence)
    cumulative_crux_count = 0
    for cs in convergence:
        ce = cs.get('crux_engagement_rate', {})
        if ce.get('used_this_turn'):
            crux_engaged_rounds += 1
        cc = ce.get('cumulative_count', 0)
        if cc > cumulative_crux_count:
            cumulative_crux_count = cc

    nodes = an.get('nodes', [])
    edges = an.get('edges', [])
    speakers = defaultdict(int)
    strengths = []
    for n in nodes:
        speakers[n.get('speaker', 'unknown')] += 1
        cs = n.get('computed_strength')
        if cs is not None:
            strengths.append(cs)

    concessions = sum(1 for s in statements if 'concede' in s.get('content', '').lower() or 'I grant' in s.get('content', '').lower())

    return {
        'id': d.get('id', '')[:8],
        'title': d.get('title', '')[:80],
        'timestamp': d.get('updated_at') or d.get('created_at', ''),
        'phase': d.get('phase'),
        'app_version': d.get('app_version'),
        'statement_count': len(statements),
        'process_rewards': process_rewards,
        'avg_process_reward': sum(process_rewards) / len(process_rewards) if process_rewards else None,
        'accept_with_flag': accept_with_flag,
        'pass_count': pass_count,
        'skip_count': skip_count,
        'qg_pass': qg_pass,
        'qg_fail': qg_fail,
        'stageA_scores': stageA_scores,
        'avg_stageA': sum(stageA_scores) / len(stageA_scores) if stageA_scores else None,
        'lookahead_results': lookahead_results,
        'regen_count': sum(1 for l in lookahead_results if l.get('regen_triggered')),
        'weak_total': sum(l.get('weak', 0) for l in lookahead_results),
        'strong_total': sum(l.get('strong', 0) for l in lookahead_results),
        'an_nodes': len(nodes),
        'an_edges': len(edges),
        'edge_density': len(edges) / len(nodes) if nodes else 0,
        'speakers': dict(speakers),
        'avg_strength': sum(strengths) / len(strengths) if strengths else None,
        'crux_count': len(cruxes),
        'crux_engaged_rounds': crux_engaged_rounds,
        'total_conv_rounds': total_conv_rounds,
        'cumulative_crux_engagement': cumulative_crux_count,
        'concessions': concessions,
    }

# Analyze latest 2 debates
files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)

print("=" * 80)
print("LATEST DEBATE REVIEW — Comparison against Jun 6 baseline")
print("=" * 80)

for fp in files[:2]:
    m = extract_metrics(fp)
    print(f"\n{'─' * 80}")
    print(f"Debate: {m['id']}  |  {m['title']}")
    print(f"Date: {m['timestamp'][:19]}  |  Phase: {m['phase']}  |  Version: {m['app_version']}")
    print(f"Statements: {m['statement_count']}")

    print(f"\n  TURN VALIDATION:")
    pr_str = f"{m['avg_process_reward']:.3f}" if m['avg_process_reward'] else "N/A"
    sa_str = f"{m['avg_stageA']:.3f}" if m['avg_stageA'] else "N/A"
    print(f"    Process reward avg: {pr_str}  (n={len(m['process_rewards'])})")
    print(f"    StageA avg: {sa_str}  (n={len(m['stageA_scores'])})")
    print(f"    Outcomes: pass={m['pass_count']}  accept_with_flag={m['accept_with_flag']}  skip={m['skip_count']}")
    print(f"    Quality gate: pass={m['qg_pass']}  fail={m['qg_fail']}")

    print(f"\n  LOOKAHEAD GATE:")
    print(f"    Regens: {m['regen_count']}/{m['statement_count']}")
    print(f"    Weak claims total: {m['weak_total']}  |  Strong claims total: {m['strong_total']}")
    for i, la in enumerate(m['lookahead_results']):
        status = "REGEN" if la.get('regen_triggered') else ("PASS" if la.get('final_pass') else "FAIL")
        ud = la.get('utility_delta')
        ud_str = f"{ud:.4f}" if ud is not None else "N/A"
        print(f"    S{i+1} ({la['speaker']:15s}): {status:5s} delta={ud_str} strong={la.get('strong',0)} weak={la.get('weak',0)}")

    print(f"\n  ARGUMENT NETWORK:")
    print(f"    Nodes: {m['an_nodes']}  |  Edges: {m['an_edges']}  |  Density: {m['edge_density']:.2f}")
    print(f"    Avg strength: {m['avg_strength']:.3f}" if m['avg_strength'] else "    Avg strength: N/A")
    print(f"    Speakers: {m['speakers']}")
    print(f"    Cruxes: {m['crux_count']}")
    print(f"    Concessions: {m['concessions']}")

    print(f"\n  CRUX ENGAGEMENT:")
    print(f"    Rounds with crux engagement: {m['crux_engaged_rounds']}/{m['total_conv_rounds']}")
    print(f"    Cumulative crux engagement count: {m['cumulative_crux_engagement']}")

# Baseline comparison
print(f"\n{'=' * 80}")
print("BASELINE COMPARISON (Jun 6 review, 5 debates)")
print("=" * 80)
print(f"  {'Metric':35s} {'Baseline (5-debate avg)':>25s} {'Latest':>10s} {'Delta':>10s}")
print(f"  {'─'*35} {'─'*25} {'─'*10} {'─'*10}")

latest = extract_metrics(files[0])

baseline_an = [30, 55, 79, 60, 36]
baseline_density = [0.97, 1.18, 2.11, 1.78, 0.92]
baseline_crux = [10, 19, 29, 25, 8]
baseline_weak = [10, 7, 4, 12, 7]
baseline_regen = [1, 0, 1, 1, 4]
baseline_strength = [0.503, 0.533, 0.428, 0.427, 0.630]

import statistics
avg_an = statistics.mean(baseline_an)
avg_dens = statistics.mean(baseline_density)
avg_crux = statistics.mean(baseline_crux)
avg_weak = statistics.mean(baseline_weak)
avg_regen = statistics.mean(baseline_regen)
avg_str = statistics.mean(baseline_strength)

def delta_str(new, old):
    d = new - old
    pct = (d / old * 100) if old != 0 else 0
    arrow = '+' if d > 0 else ''
    return f"{arrow}{d:.1f} ({arrow}{pct:.0f}%)"

print(f"  {'AN nodes':35s} {avg_an:>25.1f} {latest['an_nodes']:>10d} {delta_str(latest['an_nodes'], avg_an):>10s}")
print(f"  {'Edge density':35s} {avg_dens:>25.2f} {latest['edge_density']:>10.2f} {delta_str(latest['edge_density'], avg_dens):>10s}")
print(f"  {'Crux count':35s} {avg_crux:>25.1f} {latest['crux_count']:>10d} {delta_str(latest['crux_count'], avg_crux):>10s}")
print(f"  {'Weak claims (total)':35s} {avg_weak:>25.1f} {latest['weak_total']:>10d} {delta_str(latest['weak_total'], avg_weak):>10s}")
print(f"  {'Regens':35s} {avg_regen:>25.1f} {latest['regen_count']:>10d} {delta_str(latest['regen_count'], avg_regen):>10s}")
if latest['avg_strength']:
    print(f"  {'Avg node strength':35s} {avg_str:>25.3f} {latest['avg_strength']:>10.3f} {delta_str(latest['avg_strength'], avg_str):>10s}")
print(f"  {'Crux engaged rounds':35s} {'0 (all debates)':>25s} {latest['crux_engaged_rounds']:>10d}")
print(f"  {'Process reward data':35s} {'N/A (all debates)':>25s} {'Yes' if latest['process_rewards'] else 'No':>10s}")
print(f"  {'Quality gate data':35s} {'0 (all debates)':>25s} {latest['qg_pass'] + latest['qg_fail']:>10d}")
print(f"  {'StageA data':35s} {'N/A (all debates)':>25s} {'Yes' if latest['stageA_scores'] else 'No':>10s}")

# Also check latest calibration log entries
with open(CAL_LOG, encoding='utf-8') as f:
    cal = json.load(f)
cal.sort(key=lambda e: e.get('timestamp', ''))
last_5 = cal[-5:]
print(f"\n{'=' * 80}")
print("LATEST CALIBRATION LOG ENTRIES (last 5)")
print("=" * 80)
for e in last_5:
    ts = e.get('timestamp', '')[:19]
    cr = e.get('crux_addressed_ratio')
    cf = e.get('claims_forgotten_rate')
    util = e.get('avg_utilization_rate')
    tm = e.get('taxonomy_mapped_ratio')
    qpc = e.get('qbaf_preference_concordance')
    rna = e.get('recycling_novelty_agreement')
    cr_str = f"{cr:.3f}" if cr is not None else "  —  "
    cf_str = f"{cf:.3f}" if cf is not None else "  —  "
    util_str = f"{util:.4f}" if util is not None else "  —  "
    tm_str = f"{tm:.3f}" if tm is not None else "  —  "
    qpc_str = f"{qpc:.3f}" if qpc is not None else "  —  "
    rna_str = f"{rna:.3f}" if rna is not None else "  —  "
    print(f"  {ts}  crux={cr_str}  forgot={cf_str}  util={util_str}  taxmap={tm_str}  qbaf_conc={qpc_str}  recycle={rna_str}")
