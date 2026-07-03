"""Analyze specificity characteristics of claims vs POV nodes.

Checks:
1. Token lengths (does truncation at 128 tokens affect POV descriptions?)
2. Named entity / specific mention density in claims vs POV nodes
3. Numeric reference density
4. Examples of high-specificity claims and their attributed POV nodes
"""
import sys, json, glob, os, re
from collections import Counter
sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data'
TAXONOMY_DIR = os.path.join(DATA_ROOT, 'taxonomy/Origin')
DEBATE_DIR = os.path.join(DATA_ROOT, 'debates')
GOLDEN_SET = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_golden_test_set.json'

POV_FILE = {'accelerationist': 'accelerationist.json', 'safetyist': 'safetyist.json', 'skeptic': 'skeptic.json'}

# ── Rough tokenization (WordPiece-like word count as proxy) ──
def approx_tokens(text):
    """Approximate WordPiece token count. Real count is ~1.3x word count for English."""
    words = text.split()
    return int(len(words) * 1.3)

# ── Specificity indicators ──
NAMED_ENTITY_PATTERN = re.compile(
    r'\b(?:'
    r'(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)'  # Multi-word proper nouns
    r'|(?:GPT-\d|Claude|Gemini|ChatGPT|OpenAI|Google|Microsoft|Meta|DeepMind'
    r'|EU|US|UK|UN|NATO|WHO|FDA|FTC|SEC|GDPR|HIPAA'
    r'|China|India|Russia|Japan|Europe|Africa|America'
    r'|Congress|Senate|Parliament|Supreme Court'
    r'|Stanford|MIT|Harvard|Oxford|Berkeley'
    r'|Tesla|Apple|Amazon|Anthropic|xAI|Nvidia)'
    r')\b'
)

NUMBER_PATTERN = re.compile(
    r'\b(?:'
    r'\d+(?:\.\d+)?%'           # percentages
    r'|\$\d+(?:\.\d+)?[BMK]?'  # dollar amounts
    r'|\d{4}'                    # years
    r'|\d+(?:\.\d+)?(?:\s*(?:billion|million|trillion|thousand))'  # named numbers
    r'|\d+(?:\.\d+)?x'         # multipliers
    r')\b'
)

SPECIFIC_INSTANCE_PATTERN = re.compile(
    r'\b(?:'
    r'(?:the\s+)?(?:20\d{2}|recent|latest|current)\s+\w+'  # temporal specifics
    r'|(?:according to|as (?:reported|shown|demonstrated) by)'  # attribution
    r'|(?:for (?:example|instance)|such as|e\.g\.|specifically)'  # exemplification
    r')\b',
    re.IGNORECASE
)

def count_specifics(text):
    entities = len(NAMED_ENTITY_PATTERN.findall(text))
    numbers = len(NUMBER_PATTERN.findall(text))
    instances = len(SPECIFIC_INSTANCE_PATTERN.findall(text))
    return {'entities': entities, 'numbers': numbers, 'instances': instances, 'total': entities + numbers + instances}

# ── Load POV nodes ──
print("=" * 60)
print("POV NODE ANALYSIS")
print("=" * 60)
pov_nodes = {}
all_pov_texts = []
for pov, fname in POV_FILE.items():
    with open(os.path.join(TAXONOMY_DIR, fname), encoding='utf-8') as f:
        data = json.load(f)
    beliefs = [n for n in data.get('nodes', []) if n.get('category') == 'Beliefs']
    pov_nodes[pov] = beliefs
    for n in beliefs:
        all_pov_texts.append(n.get('description', ''))

pov_tokens = [approx_tokens(t) for t in all_pov_texts]
pov_specifics = [count_specifics(t) for t in all_pov_texts]

print(f"\nToken length distribution ({len(all_pov_texts)} Belief node descriptions):")
print(f"  Min:    {min(pov_tokens)}")
print(f"  Median: {sorted(pov_tokens)[len(pov_tokens)//2]}")
print(f"  Mean:   {sum(pov_tokens)/len(pov_tokens):.1f}")
print(f"  Max:    {max(pov_tokens)}")
print(f"  >128 tokens: {sum(1 for t in pov_tokens if t > 128)} ({sum(1 for t in pov_tokens if t > 128)/len(pov_tokens)*100:.1f}%)")
print(f"  >96 tokens:  {sum(1 for t in pov_tokens if t > 96)} ({sum(1 for t in pov_tokens if t > 96)/len(pov_tokens)*100:.1f}%)")

pov_total_spec = [s['total'] for s in pov_specifics]
print(f"\nSpecificity (named entities + numbers + instances):")
print(f"  Mean specifics per node: {sum(pov_total_spec)/len(pov_total_spec):.2f}")
print(f"  Nodes with 0 specifics: {sum(1 for s in pov_total_spec if s == 0)} ({sum(1 for s in pov_total_spec if s == 0)/len(pov_total_spec)*100:.1f}%)")
print(f"  Mean entities: {sum(s['entities'] for s in pov_specifics)/len(pov_specifics):.2f}")
print(f"  Mean numbers:  {sum(s['numbers'] for s in pov_specifics)/len(pov_specifics):.2f}")

# ── Load claims ──
print(f"\n{'=' * 60}")
print("CLAIM ANALYSIS")
print("=" * 60)
with open(GOLDEN_SET, encoding='utf-8') as f:
    golden = json.load(f)
claims = golden['claims']

claim_data = {}
debate_files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)
for fp in debate_files[:20]:
    with open(fp, encoding='utf-8') as f:
        d = json.load(f)
    for n in d.get('argument_network', {}).get('nodes', []):
        if n.get('id'):
            claim_data[n['id']] = n.get('text', n.get('label', ''))

claim_texts = [claim_data.get(c['claim_id'], '') for c in claims if c['claim_id'] in claim_data]
claim_tokens = [approx_tokens(t) for t in claim_texts]
claim_specifics = [count_specifics(t) for t in claim_texts]

print(f"\nToken length distribution ({len(claim_texts)} claims):")
print(f"  Min:    {min(claim_tokens)}")
print(f"  Median: {sorted(claim_tokens)[len(claim_tokens)//2]}")
print(f"  Mean:   {sum(claim_tokens)/len(claim_tokens):.1f}")
print(f"  Max:    {max(claim_tokens)}")
print(f"  >128 tokens: {sum(1 for t in claim_tokens if t > 128)} ({sum(1 for t in claim_tokens if t > 128)/len(claim_tokens)*100:.1f}%)")

claim_total_spec = [s['total'] for s in claim_specifics]
print(f"\nSpecificity (named entities + numbers + instances):")
print(f"  Mean specifics per claim: {sum(claim_total_spec)/len(claim_total_spec):.2f}")
print(f"  Claims with 0 specifics: {sum(1 for s in claim_total_spec if s == 0)} ({sum(1 for s in claim_total_spec if s == 0)/len(claim_total_spec)*100:.1f}%)")
print(f"  Mean entities: {sum(s['entities'] for s in claim_specifics)/len(claim_specifics):.2f}")
print(f"  Mean numbers:  {sum(s['numbers'] for s in claim_specifics)/len(claim_specifics):.2f}")

# ── Specificity gap ──
print(f"\n{'=' * 60}")
print("SPECIFICITY GAP")
print("=" * 60)
pov_avg_spec = sum(pov_total_spec) / len(pov_total_spec)
claim_avg_spec = sum(claim_total_spec) / len(claim_total_spec)
print(f"  POV nodes avg specifics:  {pov_avg_spec:.2f}")
print(f"  Claims avg specifics:     {claim_avg_spec:.2f}")
print(f"  Gap (claim - POV):        {claim_avg_spec - pov_avg_spec:+.2f}")

# ── High-specificity claims with their attributed nodes ──
print(f"\n{'=' * 60}")
print("HIGH-SPECIFICITY CLAIM EXAMPLES")
print("=" * 60)

# Build node lookup
node_lookup = {}
for pov, nodes in pov_nodes.items():
    for n in nodes:
        node_lookup[n['id']] = n

# Sort claims by specificity
indexed_claims = []
for i, c in enumerate(claims):
    cid = c['claim_id']
    if cid in claim_data:
        spec = claim_specifics[i] if i < len(claim_specifics) else count_specifics(claim_data[cid])
        indexed_claims.append((c, claim_data[cid], spec))

indexed_claims.sort(key=lambda x: -x[2]['total'])

for c, text, spec in indexed_claims[:8]:
    node = node_lookup.get(c['attributed_node'], {})
    node_desc = node.get('description', 'N/A')[:100]
    print(f"\n  Claim ({spec['total']} specifics: {spec['entities']}E/{spec['numbers']}N/{spec['instances']}I):")
    print(f"    {text[:120]}...")
    print(f"  -> Node: {c['attributed_node']}")
    print(f"    {node_desc}...")
    print(f"  Confidence: {c.get('attribution_confidence', 'N/A')}")

# ── Low-specificity claims (for comparison) ──
print(f"\n{'=' * 60}")
print("LOW-SPECIFICITY CLAIM EXAMPLES (0 specifics)")
print("=" * 60)
low_spec = [x for x in indexed_claims if x[2]['total'] == 0]
for c, text, spec in low_spec[:5]:
    node = node_lookup.get(c['attributed_node'], {})
    print(f"\n  Claim: {text[:120]}...")
    print(f"  -> Node: {c['attributed_node']}")
    print(f"  Confidence: {c.get('attribution_confidence', 'N/A')}")

# ── Correlation: specificity vs attribution confidence ──
print(f"\n{'=' * 60}")
print("SPECIFICITY vs ATTRIBUTION CONFIDENCE")
print("=" * 60)

# Bin by specificity
bins = {'0': [], '1-2': [], '3+': []}
for c, text, spec in indexed_claims:
    conf = c.get('attribution_confidence', 0)
    if spec['total'] == 0:
        bins['0'].append(conf)
    elif spec['total'] <= 2:
        bins['1-2'].append(conf)
    else:
        bins['3+'].append(conf)

for label, confs in bins.items():
    if confs:
        avg = sum(confs) / len(confs)
        print(f"  Specifics={label:4s}: n={len(confs):3d}  avg_confidence={avg:.4f}")
