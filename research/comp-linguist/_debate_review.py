"""CL quality review of the latest substantive debate."""
import json, os, sys, glob
from collections import Counter, defaultdict
sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ai-triad-data'))
DEBATES_DIR = os.path.join(DATA_ROOT, 'debates')

debate_files = sorted(glob.glob(os.path.join(DEBATES_DIR, 'debate-*.json')),
                      key=os.path.getmtime, reverse=True)

# Find the most recent debate with AN nodes
debate = None
debate_path = None
for df in debate_files[:10]:
    with open(df, encoding='utf-8') as f:
        d = json.load(f)
    an = d.get('argument_network', {})
    nodes = an.get('nodes', [])
    if len(nodes) > 0:
        debate = d
        debate_path = df
        break

if not debate:
    print("No recent debate with AN nodes found")
    sys.exit(1)

from datetime import datetime
ts = datetime.fromtimestamp(os.path.getmtime(debate_path)).strftime('%Y-%m-%d %H:%M')
print(f"=== DEBATE QUALITY REVIEW ===")
print(f"File: {os.path.basename(debate_path)}")
print(f"Date: {ts}")

# Topic
topic = debate.get('refined_topic', debate.get('topic', '?'))
if isinstance(topic, dict):
    topic = topic.get('final', topic.get('refined', topic.get('original', '?')))
if isinstance(topic, str):
    topic = topic[:200]
print(f"Topic: {topic}")

# Config
config = debate.get('config', {})
print(f"Model: {config.get('model', '?')}")
print(f"Rounds: {config.get('maxRounds', '?')}")

# Transcript stats
transcript = debate.get('transcript', [])
print(f"\n=== TRANSCRIPT ===")
print(f"Total entries: {len(transcript)}")
speakers = Counter(e.get('speaker', e.get('type', '?')) for e in transcript)
for s, c in speakers.most_common():
    print(f"  {s}: {c} entries")

# Entry lengths
statement_lengths = []
for e in transcript:
    stmt = e.get('statement', e.get('text', ''))
    if stmt and e.get('type') not in ('intervention', 'opening_meta'):
        statement_lengths.append(len(stmt))
if statement_lengths:
    avg_len = sum(statement_lengths) / len(statement_lengths)
    print(f"Statement lengths: avg={avg_len:.0f} chars, min={min(statement_lengths)}, max={max(statement_lengths)}")

# Argument Network
an = debate.get('argument_network', {})
nodes = an.get('nodes', [])
edges = an.get('edges', [])
print(f"\n=== ARGUMENT NETWORK ===")
print(f"Nodes: {len(nodes)}, Edges: {len(edges)}")

# Node types
node_types = Counter(n.get('type', '?') for n in nodes)
for t, c in node_types.most_common():
    print(f"  {t}: {c}")

# Speaker distribution
node_speakers = Counter(n.get('speaker', '?') for n in nodes)
for s, c in node_speakers.most_common():
    print(f"  Speaker {s}: {c} claims")

# BDI distribution of claims
bdi = Counter()
for n in nodes:
    cat = n.get('bdi_category', '?')
    bdi[cat] += 1
if bdi:
    print(f"BDI: {dict(bdi)}")

# Attribution quality
att_nodes = [n for n in nodes if n.get('claim_taxonomy_attribution')]
print(f"\n=== CLAIM ATTRIBUTION ===")
print(f"Attributed: {len(att_nodes)}/{len(nodes)}")

if att_nodes:
    confidences = [n['claim_taxonomy_attribution'].get('attribution_confidence', 0) for n in att_nodes]
    primary_refs = [n['claim_taxonomy_attribution'].get('primary_ref') for n in att_nodes if n['claim_taxonomy_attribution'].get('primary_ref')]
    secondary = [n['claim_taxonomy_attribution'].get('secondary_refs', []) for n in att_nodes]
    sec_counts = [len(s) for s in secondary]

    print(f"  Confidence: avg={sum(confidences)/len(confidences):.3f}, min={min(confidences):.3f}, max={max(confidences):.3f}")
    print(f"  Primary refs: {len(primary_refs)} assigned")
    print(f"  Secondary refs: avg={sum(sec_counts)/len(sec_counts):.1f} per claim")

    # Attribution distribution across POVs
    pov_att = Counter()
    for ref in primary_refs:
        if ref:
            prefix = ref.split('-')[0]
            pov_att[prefix] += 1
    print(f"  Primary ref POV distribution: {dict(pov_att)}")

    # Confidence bands
    high = sum(1 for c in confidences if c >= 0.5)
    mid = sum(1 for c in confidences if 0.35 <= c < 0.5)
    low = sum(1 for c in confidences if c < 0.35)
    print(f"  Confidence bands: high(>=0.5)={high}, mid(0.35-0.5)={mid}, low(<0.35)={low}")

# Genus text presence
genus_nodes = [n for n in nodes if n.get('attribution_text_genus')]
print(f"\n=== GENUS TEXT ===")
print(f"Has attribution_text_genus: {len(genus_nodes)}/{len(nodes)}")
if genus_nodes:
    genus_lengths = [len(n['attribution_text_genus']) for n in genus_nodes]
    print(f"  Length: avg={sum(genus_lengths)/len(genus_lengths):.0f}, min={min(genus_lengths)}, max={max(genus_lengths)}")
    # Sample
    print(f"  Sample: {genus_nodes[0]['attribution_text_genus'][:200]}")

# Attribution embedding presence
emb_nodes = [n for n in nodes if n.get('attribution_embedding')]
print(f"Has attribution_embedding: {len(emb_nodes)}/{len(nodes)}")

# Edge types
print(f"\n=== EDGES ===")
edge_types = Counter(e.get('type', '?') for e in edges)
for t, c in edge_types.most_common():
    print(f"  {t}: {c}")

# Cross-speaker edges
cross = 0
for e in edges:
    src_node = next((n for n in nodes if n.get('id') == e.get('source')), None)
    tgt_node = next((n for n in nodes if n.get('id') == e.get('target')), None)
    if src_node and tgt_node and src_node.get('speaker') != tgt_node.get('speaker'):
        cross += 1
print(f"  Cross-speaker edges: {cross}/{len(edges)}")

# Calibration log
cal = debate.get('calibration_log', {})
print(f"\n=== CALIBRATION LOG ===")
if isinstance(cal, dict) and cal:
    owned_metrics = ['crux_addressed_ratio', 'crux_addressed_rate', 'repetition_rate',
                     'claims_forgotten', 'convergence_score', 'situation_crux_alignment',
                     'engaging_real_disagreement', 'argumentative_saturation_at_transition',
                     'argumentation_exit_threshold']
    for m in owned_metrics:
        if m in cal:
            print(f"  {m}: {cal[m]}")
    # Other interesting metrics
    for k, v in cal.items():
        if k not in owned_metrics and k not in ('schema_version', 'origin', 'debate_id', 'timestamp') and isinstance(v, (int, float)):
            print(f"  {k}: {v}")
elif isinstance(cal, list):
    print(f"  (list format, {len(cal)} entries)")
else:
    print(f"  No calibration log")

# Convergence signals
signals = debate.get('convergence_signals', [])
print(f"\n=== CONVERGENCE SIGNALS ===")
print(f"Entries: {len(signals)}")
if signals:
    arco_warnings = sum(1 for s in signals if s.get('arco', {}).get('drift_warning'))
    recycled = sum(1 for s in signals if s.get('argument_redundancy', {}).get('semantically_recycled'))
    off_clause = sum(1 for s in signals if s.get('clause_coverage', {}).get('no_clause_engaged'))
    print(f"  ArCo drift warnings: {arco_warnings}")
    print(f"  Argument recycling: {recycled}")
    print(f"  Off-clause turns: {off_clause}")

    # ArCo values
    arco_vals = [s['arco']['turn_similarity'] for s in signals if s.get('arco', {}).get('turn_similarity') is not None]
    if arco_vals:
        print(f"  ArCo similarity: avg={sum(arco_vals)/len(arco_vals):.3f}, min={min(arco_vals):.3f}, max={max(arco_vals):.3f}")

    # Position drift
    pos_drifts = [s['position_drift']['drift'] for s in signals if s.get('position_drift', {}).get('drift') is not None]
    if pos_drifts:
        print(f"  Position drift: avg={sum(pos_drifts)/len(pos_drifts):.3f}, max={max(pos_drifts):.3f}")

# Moderator interventions
interventions = [e for e in transcript if e.get('type') == 'intervention']
print(f"\n=== MODERATOR INTERVENTIONS ===")
print(f"Count: {len(interventions)}")
for ie in interventions:
    meta = ie.get('intervention_metadata', ie.get('metadata', {}))
    move = meta.get('move', meta.get('suggested_move', '?'))
    target = meta.get('target', meta.get('target_debater', '?'))
    reason = meta.get('trigger_reasoning', meta.get('reasoning', ''))
    if isinstance(reason, str):
        reason = reason[:150]
    r = meta.get('round', '?')
    drift = meta.get('drift_detected', False)
    print(f"  R{r}: {move} → {target} {'[DRIFT]' if drift else ''}")
    if reason:
        print(f"    Reason: {reason}")

# Topic scope
scope = debate.get('topic', {}).get('scope') if isinstance(debate.get('topic'), dict) else None
print(f"\n=== TOPIC SCOPE ===")
if scope:
    print(f"  Core proposition: {scope.get('core_proposition', '?')[:150]}")
    print(f"  Disciplines: {scope.get('relevant_disciplines', [])}")
    print(f"  Tensions: {len(scope.get('key_tensions', []))}")
    print(f"  Off-scope: {scope.get('off_scope_topics', [])}")
    print(f"  Drift sigs: {len(scope.get('drift_signatures', []))}")
    print(f"  Confidence: {scope.get('constraint_confidence', '?')}")
else:
    print("  No topic scope extracted")

# Quality summary
print(f"\n=== QUALITY SUMMARY ===")
issues = []
if len(nodes) < 10:
    issues.append(f"Low AN density: {len(nodes)} nodes")
if att_nodes:
    avg_conf = sum(confidences) / len(confidences)
    if avg_conf < 0.35:
        issues.append(f"Low attribution confidence: {avg_conf:.3f}")
if len(edges) < len(nodes) * 0.5:
    issues.append(f"Sparse edges: {len(edges)} edges for {len(nodes)} nodes ({len(edges)/max(len(nodes),1):.1f} per node)")
if arco_warnings > 2:
    issues.append(f"Multiple ArCo drift warnings: {arco_warnings}")
if recycled > 2:
    issues.append(f"Excessive argument recycling: {recycled} turns")

if issues:
    for i in issues:
        print(f"  ⚠ {i}")
else:
    print("  No automated quality flags raised")
