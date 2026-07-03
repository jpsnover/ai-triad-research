"""Evaluate quality of the most recent debate application."""
import sys, json, glob, os, math
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8')

DEBATE_DIR = 'C:/Users/jsnov/repos/ai-triad-data/debates'
files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)
fp = files[0]

with open(fp, encoding='utf-8') as f:
    d = json.load(f)

print("=" * 80)
print("DEBATE QUALITY EVALUATION")
print("=" * 80)
print(f"ID: {d.get('id', '')[:8]}")
print(f"Title: {d.get('title', '')[:100]}")
print(f"Updated: {d.get('updated_at', '')[:19]}")
print(f"Phase: {d.get('phase')}")
print(f"Version: {d.get('app_version')}")

transcript = d.get('transcript', [])
statements = [e for e in transcript if e.get('type') == 'statement']
diag_entries = d.get('diagnostics', {}).get('entries', {})
turn_validations = d.get('turn_validations', {})
an = d.get('argument_network', {})
cruxes = d.get('crux_tracker', [])
convergence = d.get('convergence_signals', [])
topic = d.get('topic', {})
scope = topic.get('scope', {})

print(f"Statements: {len(statements)}")
print(f"Transcript entries: {len(transcript)}")
print(f"Topic: {topic.get('text', d.get('title', ''))[:120]}")
if scope:
    print(f"Scope domain: {scope.get('domain', 'unspecified')}")
    print(f"Example ceiling: {scope.get('example_ceiling', 'unspecified')[:100]}")

# ── Turn Validation ──
print(f"\n{'─' * 80}")
print("TURN VALIDATION")
print(f"{'─' * 80}")

process_rewards = []
outcomes = defaultdict(int)
stageA_scores = []
qg_pass = 0
qg_fail = 0
qg_repairs = {'fixed': 0, 'unchanged': 0, 'partial': 0, 'none': 0}
topic_aligned_pre_fail = 0
topic_aligned_post_pass = 0

for i, s in enumerate(statements):
    eid = s['id']
    tv = turn_validations.get(eid, {})
    tv_final = tv.get('final', {})
    diag = diag_entries.get(eid, {})

    outcome = tv_final.get('outcome') or tv.get('outcome')
    if outcome:
        outcomes[outcome] += 1

    pr = tv_final.get('process_reward') or tv.get('process_reward')
    if pr is not None:
        process_rewards.append({'idx': i+1, 'speaker': s.get('speaker', ''), 'score': pr})

    sa = tv_final.get('stageA_score') or tv.get('stageA_score')
    if sa is not None:
        stageA_scores.append(sa)

    qg = diag.get('quality_gate')
    if qg:
        final_qg = qg.get('post_repair') or qg.get('pre_repair') or qg
        pre_qg = qg.get('pre_repair', {})
        if final_qg.get('pass'):
            qg_pass += 1
        else:
            qg_fail += 1
        repair = qg.get('repair_outcome', 'none')
        qg_repairs[repair] = qg_repairs.get(repair, 0) + 1
        if pre_qg.get('topic_aligned') is False:
            topic_aligned_pre_fail += 1
            post_qg = qg.get('post_repair', {})
            if post_qg.get('topic_aligned') is True:
                topic_aligned_post_pass += 1

print(f"  Outcomes: {dict(outcomes)}")
if process_rewards:
    avg_pr = sum(p['score'] for p in process_rewards) / len(process_rewards)
    print(f"  Process reward: avg={avg_pr:.3f} n={len(process_rewards)} range=[{min(p['score'] for p in process_rewards):.3f}, {max(p['score'] for p in process_rewards):.3f}]")
    print(f"  Per-statement:")
    for p in process_rewards:
        print(f"    S{p['idx']:2d} ({p['speaker']:15s}): {p['score']:.3f}")
else:
    print(f"  Process rewards: N/A")

if stageA_scores:
    print(f"  StageA: avg={sum(stageA_scores)/len(stageA_scores):.3f} n={len(stageA_scores)}")
else:
    print(f"  StageA: N/A")

print(f"  Quality gate: {qg_pass} pass / {qg_fail} fail")
print(f"  Repair outcomes: {dict(qg_repairs)}")
print(f"  topic_aligned pre-fail: {topic_aligned_pre_fail}/{len(statements)}")
if topic_aligned_pre_fail > 0:
    print(f"  topic_aligned fixed by repair: {topic_aligned_post_pass}/{topic_aligned_pre_fail}")

# ── Lookahead Gate ──
print(f"\n{'─' * 80}")
print("LOOKAHEAD GATE")
print(f"{'─' * 80}")

lookahead_results = []
for i, s in enumerate(statements):
    eid = s['id']
    diag = diag_entries.get(eid, {})
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
            'idx': i+1,
            'speaker': s.get('speaker', ''),
            'final_pass': la.get('final_pass'),
            'regen': la.get('regen_triggered'),
            'utility_delta': fa.get('utility_delta'),
            'weak': weak,
            'strong': strong,
        })

if lookahead_results:
    regen_count = sum(1 for l in lookahead_results if l.get('regen'))
    total_weak = sum(l.get('weak', 0) for l in lookahead_results)
    total_strong = sum(l.get('strong', 0) for l in lookahead_results)
    deltas = [l['utility_delta'] for l in lookahead_results if l['utility_delta'] is not None]
    print(f"  Regens: {regen_count}/{len(lookahead_results)}")
    print(f"  Weak claims total: {total_weak}  |  Strong claims total: {total_strong}  |  Ratio: {total_strong/(total_weak+total_strong)*100:.0f}% strong" if (total_weak+total_strong) > 0 else "")
    if deltas:
        print(f"  Utility delta: avg={sum(deltas)/len(deltas):.4f} range=[{min(deltas):.4f}, {max(deltas):.4f}]")
    print(f"  Per-statement:")
    for l in lookahead_results:
        status = "REGEN" if l.get('regen') else ("PASS" if l.get('final_pass') else "FAIL")
        ud = l.get('utility_delta')
        ud_str = f"{ud:.4f}" if ud is not None else "N/A"
        print(f"    S{l['idx']:2d} ({l['speaker']:15s}): {status:5s} delta={ud_str} strong={l.get('strong',0)} weak={l.get('weak',0)}")
else:
    print("  No lookahead data")

# ── Argument Network ──
print(f"\n{'─' * 80}")
print("ARGUMENT NETWORK")
print(f"{'─' * 80}")

nodes = an.get('nodes', [])
edges = an.get('edges', [])
speakers = defaultdict(int)
strengths = []
for n in nodes:
    speakers[n.get('speaker', 'unknown')] += 1
    cs = n.get('computed_strength')
    if cs is not None:
        strengths.append(cs)

edge_types = defaultdict(int)
for e in edges:
    edge_types[e.get('type', 'unknown')] += 1

print(f"  Nodes: {len(nodes)}  |  Edges: {len(edges)}  |  Density: {len(edges)/len(nodes):.2f}" if nodes else "  Empty AN")
if strengths:
    print(f"  Avg node strength: {sum(strengths)/len(strengths):.3f} range=[{min(strengths):.3f}, {max(strengths):.3f}]")
print(f"  Speakers: {dict(speakers)}")
print(f"  Edge types: {dict(edge_types)}")
print(f"  Cruxes: {len(cruxes)}")

concessions = sum(1 for s in statements if 'concede' in s.get('content', '').lower() or 'I grant' in s.get('content', '').lower())
print(f"  Concession mentions: {concessions}")

# ── Convergence Signals ──
print(f"\n{'─' * 80}")
print("CONVERGENCE SIGNALS")
print(f"{'─' * 80}")

if convergence:
    print(f"  Total rounds with signals: {len(convergence)}")
    engagement_ratios = []
    crux_engaged = 0
    max_redundancy = 0
    recycled_count = 0
    for cs in convergence:
        de = cs.get('dialectical_engagement', {})
        ratio = de.get('ratio', 0)
        engagement_ratios.append(ratio)
        ar = cs.get('argument_redundancy', {})
        max_r = ar.get('max_self_overlap', 0)
        if max_r > max_redundancy:
            max_redundancy = max_r
        if ar.get('semantically_recycled'):
            recycled_count += 1
        ce = cs.get('crux_engagement_rate', {})
        if ce.get('used_this_turn'):
            crux_engaged += 1

    avg_engagement = sum(engagement_ratios) / len(engagement_ratios) if engagement_ratios else 0
    print(f"  Avg dialectical engagement ratio: {avg_engagement:.2f}")
    print(f"  Max self-overlap: {max_redundancy:.3f}")
    print(f"  Semantically recycled turns: {recycled_count}")
    print(f"  Crux-engaged rounds: {crux_engaged}/{len(convergence)}")
else:
    print("  No convergence signals")

# ── Exclusion Guard ──
print(f"\n{'─' * 80}")
print("EXCLUSION GUARD")
print(f"{'─' * 80}")

# Aggregate from per-entry storage (fields only present when violations exist)
scope_violations = []
scope_drift_warnings = []
entries_with_extraction = 0
for eid, entry in diag_entries.items():
    et = entry.get('extraction_trace', {})
    if isinstance(et, dict):
        entries_with_extraction += 1
        evs = et.get('exclusion_violations', [])
        scope_violations.extend(evs)
    sdw = entry.get('scope_drift_warnings', [])
    if sdw:
        scope_drift_warnings.extend(sdw)

print(f"  Entries checked: {entries_with_extraction} (extraction traces)")
print(f"  Claim exclusion violations: {len(scope_violations)}")
print(f"  Draft scope drift warnings: {len(scope_drift_warnings)}")
if scope_violations:
    for sv in scope_violations[:5]:
        print(f"    - {sv.get('claim_text', '')[:60]} (node={sv.get('node_id')}, sim_excl={sv.get('similarity_exclusion', 0):.3f})")
if scope_drift_warnings:
    for sw in scope_drift_warnings[:5]:
        print(f"    - {sw.get('debater', '')} → {sw.get('node_id', '')} (sim={sw.get('similarity', 0):.3f})")

# ── Overall Assessment ──
print(f"\n{'=' * 80}")
print("OVERALL QUALITY ASSESSMENT")
print(f"{'=' * 80}")

issues = []
positives = []

# Process reward assessment
if process_rewards:
    avg_pr = sum(p['score'] for p in process_rewards) / len(process_rewards)
    if avg_pr >= 0.75:
        positives.append(f"Process reward avg {avg_pr:.3f} (healthy, >=0.75)")
    elif avg_pr >= 0.60:
        issues.append(f"WARNING: Process reward avg {avg_pr:.3f} (moderate, target >=0.75)")
    else:
        issues.append(f"CRITICAL: Process reward avg {avg_pr:.3f} (low, target >=0.75)")

# Quality gate
if qg_pass + qg_fail > 0:
    pass_rate = qg_pass / (qg_pass + qg_fail) * 100
    if pass_rate >= 70:
        positives.append(f"Quality gate pass rate {pass_rate:.0f}% (post-repair)")
    elif pass_rate >= 50:
        issues.append(f"WARNING: Quality gate pass rate {pass_rate:.0f}% (target >=70%)")
    else:
        issues.append(f"MAJOR: Quality gate pass rate {pass_rate:.0f}% (target >=70%)")

# Topic alignment (compare to previous 55% false positive rate)
if topic_aligned_pre_fail > 0:
    pre_fail_rate = topic_aligned_pre_fail / len(statements) * 100
    if pre_fail_rate <= 40:
        positives.append(f"topic_aligned pre-fail rate {pre_fail_rate:.0f}% (improved from 92% in a4821a34)")
    else:
        issues.append(f"WARNING: topic_aligned pre-fail rate {pre_fail_rate:.0f}%")

# Lookahead
if lookahead_results:
    weak_ratio = total_weak / (total_weak + total_strong) * 100 if (total_weak + total_strong) > 0 else 0
    if weak_ratio <= 20:
        positives.append(f"Strong/weak claim ratio healthy ({100-weak_ratio:.0f}% strong)")
    elif weak_ratio <= 40:
        issues.append(f"WARNING: {weak_ratio:.0f}% weak claims in lookahead")
    else:
        issues.append(f"MAJOR: {weak_ratio:.0f}% weak claims in lookahead")

# AN density
if nodes:
    density = len(edges) / len(nodes)
    if density >= 1.5:
        positives.append(f"AN density {density:.2f} (rich argumentation)")
    elif density >= 1.0:
        positives.append(f"AN density {density:.2f} (adequate)")
    else:
        issues.append(f"WARNING: AN density {density:.2f} (sparse, target >=1.0)")

# Convergence
if convergence and engagement_ratios:
    if avg_engagement >= 0.8:
        positives.append(f"Dialectical engagement {avg_engagement:.2f} (strong)")
    elif avg_engagement >= 0.6:
        positives.append(f"Dialectical engagement {avg_engagement:.2f} (moderate)")
    else:
        issues.append(f"WARNING: Dialectical engagement {avg_engagement:.2f} (low, target >=0.6)")
    if recycled_count > 0:
        issues.append(f"WARNING: {recycled_count} semantically recycled turns detected")

# Crux engagement
if convergence:
    if crux_engaged > 0:
        positives.append(f"Crux engagement active: {crux_engaged}/{len(convergence)} rounds")
    else:
        issues.append(f"INFO: Crux engagement still zero in convergence signals (known bug t/465)")

print(f"\n  POSITIVES ({len(positives)}):")
for p in positives:
    print(f"    + {p}")
print(f"\n  ISSUES ({len(issues)}):")
for iss in issues:
    print(f"    - {iss}")

verdict = "GOOD" if len([i for i in issues if 'CRITICAL' in i or 'MAJOR' in i]) == 0 and len(positives) >= 3 else "MIXED" if len([i for i in issues if 'CRITICAL' in i]) == 0 else "POOR"
print(f"\n  VERDICT: {verdict}")
