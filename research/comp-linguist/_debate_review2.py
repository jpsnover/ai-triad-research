"""Deep dive: genus text quality, transcript samples, attribution analysis."""
import json, os, sys, glob
sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ai-triad-data'))
DEBATES_DIR = os.path.join(DATA_ROOT, 'debates')

debate_files = sorted(glob.glob(os.path.join(DEBATES_DIR, 'debate-*.json')),
                      key=os.path.getmtime, reverse=True)
debate = None
for df in debate_files[:10]:
    with open(df, encoding='utf-8') as f:
        d = json.load(f)
    if len(d.get('argument_network', {}).get('nodes', [])) > 0:
        debate = d
        break

an = debate['argument_network']
nodes = an['nodes']
transcript = debate.get('transcript', [])

# === GENUS TEXT QUALITY ===
print("=== GENUS TEXT QUALITY AUDIT ===\n")
genus_nodes = [n for n in nodes if n.get('attribution_text_genus')]

# Check word counts
word_counts = []
format_issues = []
for n in genus_nodes:
    g = n['attribution_text_genus']
    wc = len(g.split())
    word_counts.append(wc)

    # Check format: should start with "A [Belief|Desire|Intention]"
    starts_ok = any(g.startswith(f"A {cat}") for cat in ['Belief', 'Desire', 'Intention'])
    has_encompasses = 'Encompasses:' in g or 'encompasses:' in g
    has_within = 'within' in g.lower() and 'discourse' in g.lower()
    has_that = ' that ' in g

    if not starts_ok:
        format_issues.append(f"  {n.get('id','?')}: Missing 'A [BDI]' start — begins with: '{g[:60]}...'")
    if not has_encompasses:
        format_issues.append(f"  {n.get('id','?')}: Missing 'Encompasses:' clause")

if word_counts:
    avg_wc = sum(word_counts) / len(word_counts)
    over_80 = sum(1 for w in word_counts if w > 80)
    under_40 = sum(1 for w in word_counts if w < 40)
    in_range = sum(1 for w in word_counts if 40 <= w <= 80)
    print(f"Word counts: avg={avg_wc:.0f}, min={min(word_counts)}, max={max(word_counts)}")
    print(f"  In spec range (40-80): {in_range}/{len(word_counts)}")
    print(f"  Over 80 words: {over_80}/{len(word_counts)}")
    print(f"  Under 40 words: {under_40}/{len(word_counts)}")

if format_issues:
    print(f"\nFormat issues ({len(format_issues)}):")
    for fi in format_issues[:10]:
        print(fi)
else:
    print("\nNo format issues detected")

# Show 5 sample genus texts with their original claims
print(f"\n=== SAMPLE GENUS TEXTS (5 of {len(genus_nodes)}) ===\n")
for n in genus_nodes[:5]:
    cid = n.get('id', '?')
    speaker = n.get('speaker', '?')
    text = n.get('text', n.get('claim_text', ''))
    genus = n.get('attribution_text_genus', '')
    att = n.get('claim_taxonomy_attribution', {})
    primary = att.get('primary_ref', 'none')
    conf = att.get('attribution_confidence', 0)

    print(f"[{cid}] Speaker: {speaker}")
    print(f"  CLAIM: {text[:200]}")
    print(f"  GENUS: {genus[:250]}")
    print(f"  → Primary: {primary} (conf={conf:.3f})")
    print()

# === UNATTRIBUTED NODES ===
unatt = [n for n in nodes if not n.get('claim_taxonomy_attribution')]
print(f"=== UNATTRIBUTED NODES ({len(unatt)}) ===")
for n in unatt:
    print(f"  {n.get('id','?')} [{n.get('speaker','?')}]: {n.get('text', '')[:100]}")

# === SECONDARY REF ANALYSIS ===
print(f"\n=== SECONDARY REFS ANALYSIS ===")
att_nodes = [n for n in nodes if n.get('claim_taxonomy_attribution')]
sec_counts = []
for n in att_nodes:
    att = n['claim_taxonomy_attribution']
    sec = att.get('secondary_refs', [])
    sec_counts.append(len(sec))
    if len(sec) > 50:
        print(f"  {n.get('id','?')}: {len(sec)} secondary refs (excessive)")

if sec_counts:
    print(f"  Total: avg={sum(sec_counts)/len(sec_counts):.1f}, min={min(sec_counts)}, max={max(sec_counts)}")

# === TRANSCRIPT QUALITY SAMPLES ===
print(f"\n=== TRANSCRIPT QUALITY (debater entries) ===\n")
debater_entries = [e for e in transcript if e.get('speaker') in ('accelerationist', 'safetyist', 'skeptic')]
for e in debater_entries[:4]:
    speaker = e.get('speaker', '?')
    stmt = e.get('statement', e.get('text', ''))
    rnd = e.get('round', e.get('metadata', {}).get('round', '?'))
    phase = e.get('phase', e.get('metadata', {}).get('phase', '?'))

    # Check for claim_sketches
    diag = e.get('diagnostics', {})
    claims = diag.get('claims_extracted', diag.get('claim_sketches', []))

    print(f"[R{rnd} {phase}] {speaker}")
    print(f"  Length: {len(stmt)} chars, {len(stmt.split())} words")
    print(f"  First 300: {stmt[:300]}...")

    # Check taxonomy refs
    tax_refs = e.get('taxonomy_refs', [])
    print(f"  Taxonomy refs: {len(tax_refs)}")
    print()

# === EDGE QUALITY ===
print(f"=== EDGE TYPE DISTRIBUTION BY SPEAKER PAIR ===")
speaker_pairs = {}
for e in an.get('edges', []):
    src = next((n for n in nodes if n.get('id') == e.get('source')), None)
    tgt = next((n for n in nodes if n.get('id') == e.get('target')), None)
    if src and tgt:
        pair = f"{src.get('speaker','?')} → {tgt.get('speaker','?')}"
        if pair not in speaker_pairs:
            speaker_pairs[pair] = Counter()
        speaker_pairs[pair][e.get('type', '?')] += 1

for pair, counts in sorted(speaker_pairs.items()):
    print(f"  {pair}: {dict(counts)}")

# === POSITION DRIFT DETAIL ===
print(f"\n=== POSITION DRIFT DETAIL ===")
signals = debate.get('convergence_signals', [])
for s in signals:
    pd = s.get('position_drift', {})
    if pd.get('drift', 0) > 0.3:
        print(f"  R{s.get('round','?')} {s.get('speaker','?')}: drift={pd['drift']:.3f}, overlap_with_opening={pd.get('overlap_with_opening', '?')}")
