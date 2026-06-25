"""t/536 Phase 2: BDI reclassification with HOW-dominates precedence.

Applies the HOW-dominates rule to reclassify golden set claims' BDI categories,
then compares the original vs reclassified distributions against the taxonomy
ground truth (370 beliefs, 81 desires, 269 intentions).
"""
import sys, json, os, math, time
sys.stdout.reconfigure(encoding='utf-8')

GOLDEN_SET = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_golden_test_set.json'
CACHE_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_phase2_bdi_cache.json'
OUTPUT_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_phase2_bdi_results.json'
TAXONOMY_DIR = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin'

CLASSIFICATION_PROMPT = """Classify this debate claim into exactly one BDI category using the HOW-dominates precedence rule.

## Precedence rule (apply in this order):
1. **Intention** — if the claim specifies a METHOD, MECHANISM, STRATEGY, or CONCRETE ACTION to achieve a goal. Key signal: "by means of", "through", "implement", "deploy", "build", "create", "establish", "mandate", "regulate", or any description of HOW to do something.
2. **Desire** — if the claim states a desired END-STATE, VALUE, GOAL, or NORMATIVE PREFERENCE without specifying a mechanism to achieve it. Key signal: "should", "ought to", "need to", "must", "it is important that", "we want", or any statement about WHAT should be the case.
3. **Belief** — if the claim makes an EMPIRICAL, DESCRIPTIVE, or TESTABLE assertion about how the world IS (not how it should be). Key signal: factual statements, causal claims, predictions, evidence-based assertions.

## Critical: HOW-dominates means:
- If a claim contains BOTH a desired outcome AND a method to achieve it, classify as **Intention** (not Desire).
- If a claim contains BOTH a factual observation AND a normative recommendation, classify as **Desire** (not Belief).
- When in doubt between Intention and Desire, check: does the claim say HOW? If yes → Intention.

## Claim:
{claim_text}

## Response format:
Return ONLY one word: belief, desire, or intention"""

BDI_FROM_NODE_ID = {
    'beliefs': 'belief',
    'desires': 'desire',
    'intentions': 'intention',
}


def infer_bdi(node_id: str) -> str:
    for key, val in BDI_FROM_NODE_ID.items():
        if key in node_id:
            return val
    return 'belief'


def kl_divergence(p_dist, q_dist):
    """KL(P || Q) where P is the reclassified/original and Q is taxonomy ground truth."""
    kl = 0.0
    for cat in ('belief', 'desire', 'intention'):
        p = p_dist.get(cat, 1e-10)
        q = q_dist.get(cat, 1e-10)
        if p > 0:
            kl += p * math.log(p / q)
    return kl


def distribution(categories):
    total = len(categories)
    counts = {}
    for c in categories:
        counts[c] = counts.get(c, 0) + 1
    return {k: v / total for k, v in counts.items()}, counts, total


# ── Load data ──
print("Loading golden test set...")
with open(GOLDEN_SET, encoding='utf-8') as f:
    golden = json.load(f)
claims = golden['claims']
print(f"  Claims: {len(claims)}")

# ── Compute taxonomy ground truth distribution ──
print("Computing taxonomy BDI ground truth...")
tax_bdi_counts = {'belief': 0, 'desire': 0, 'intention': 0}
for fname in ('accelerationist.json', 'safetyist.json', 'skeptic.json'):
    fpath = os.path.join(TAXONOMY_DIR, fname)
    with open(fpath, encoding='utf-8') as f:
        data = json.load(f)
    for node in data.get('nodes', []):
        cat = node.get('category', '').lower()
        if cat in ('beliefs',):
            tax_bdi_counts['belief'] += 1
        elif cat in ('desires',):
            tax_bdi_counts['desire'] += 1
        elif cat in ('intentions',):
            tax_bdi_counts['intention'] += 1
tax_total = sum(tax_bdi_counts.values())
tax_dist = {k: v / tax_total for k, v in tax_bdi_counts.items()}
print(f"  Taxonomy ground truth: {tax_bdi_counts} (total: {tax_total})")
print(f"  Distribution: belief={tax_dist['belief']:.3f}, desire={tax_dist['desire']:.3f}, intention={tax_dist['intention']:.3f}")

# ── Original BDI distribution (from attributed node IDs) ──
original_bdis = []
for c in claims:
    bdi = c.get('bdi_category', infer_bdi(c['attributed_node']))
    original_bdis.append(bdi)

orig_dist, orig_counts, orig_total = distribution(original_bdis)
print(f"\nOriginal BDI distribution: {orig_counts}")
print(f"  belief={orig_dist.get('belief',0):.3f}, desire={orig_dist.get('desire',0):.3f}, intention={orig_dist.get('intention',0):.3f}")
orig_kl = kl_divergence(orig_dist, tax_dist)
print(f"  KL(original || taxonomy) = {orig_kl:.4f}")

# ── Load or initialize cache ──
if os.path.exists(CACHE_PATH):
    with open(CACHE_PATH, encoding='utf-8') as f:
        cache = json.load(f)
    print(f"\n  Cache: {len(cache)} classifications cached")
else:
    cache = {}

# ── Reclassify with HOW-dominates ──
claims_needing_class = [c for c in claims if c['claim_text'] not in cache]
if claims_needing_class:
    print(f"\nReclassifying {len(claims_needing_class)} claims with HOW-dominates rule...")
    import google.generativeai as genai
    genai.configure(api_key=os.environ.get('GEMINI_API_KEY', os.environ.get('AI_API_KEY', '')))
    model = genai.GenerativeModel('gemini-2.5-flash-lite')
    gen_config = genai.GenerationConfig(max_output_tokens=10)

    for i, claim in enumerate(claims_needing_class):
        prompt = CLASSIFICATION_PROMPT.format(claim_text=claim['claim_text'])
        retries = 0
        while retries < 3:
            try:
                response = model.generate_content(prompt, generation_config=gen_config,
                                                  request_options={'timeout': 30})
                raw = response.text.strip().lower().strip('.*')
                if raw not in ('belief', 'desire', 'intention'):
                    for valid in ('belief', 'desire', 'intention'):
                        if valid in raw:
                            raw = valid
                            break
                    else:
                        print(f"  WARNING: unparseable response for claim {i}: '{raw}', defaulting to belief")
                        raw = 'belief'
                cache[claim['claim_text']] = raw
                break
            except Exception as e:
                retries += 1
                if retries >= 3:
                    print(f"  ERROR on claim {i} after 3 retries: {e}")
                    cache[claim['claim_text']] = infer_bdi(claim['attributed_node'])
                else:
                    print(f"  Retry {retries}/3 on claim {i}: {e}")
                    time.sleep(2 ** retries)
        if (i + 1) % 50 == 0:
            print(f"  {i+1}/{len(claims_needing_class)} done")
            with open(CACHE_PATH, 'w', encoding='utf-8') as f:
                json.dump(cache, f, indent=2)
        time.sleep(0.15)

    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(cache, f, indent=2)
    print(f"  All claims reclassified.")
else:
    print("\n  All claims already cached.")

# ── Compute reclassified distribution ──
reclass_bdis = []
for c in claims:
    reclass_bdis.append(cache.get(c['claim_text'], infer_bdi(c['attributed_node'])))

reclass_dist, reclass_counts, reclass_total = distribution(reclass_bdis)
print(f"\nReclassified BDI distribution: {reclass_counts}")
print(f"  belief={reclass_dist.get('belief',0):.3f}, desire={reclass_dist.get('desire',0):.3f}, intention={reclass_dist.get('intention',0):.3f}")
reclass_kl = kl_divergence(reclass_dist, tax_dist)
print(f"  KL(reclassified || taxonomy) = {reclass_kl:.4f}")

# ── Transition matrix ──
print("\n── Transition Matrix (original → reclassified) ──")
transitions = {}
for orig, reclass in zip(original_bdis, reclass_bdis):
    key = f"{orig} → {reclass}"
    transitions[key] = transitions.get(key, 0) + 1

for cat_from in ('belief', 'desire', 'intention'):
    for cat_to in ('belief', 'desire', 'intention'):
        key = f"{cat_from} → {cat_to}"
        count = transitions.get(key, 0)
        if count > 0:
            print(f"  {key}: {count}")

# ── Per-POV analysis ──
print("\n── Per-POV Distribution Comparison ──")
for pov in ('acc', 'saf', 'skp'):
    pov_orig = [b for b, c in zip(original_bdis, claims) if c['pov'] == pov]
    pov_reclass = [b for b, c in zip(reclass_bdis, claims) if c['pov'] == pov]
    if not pov_orig:
        continue
    o_dist, o_counts, o_total = distribution(pov_orig)
    r_dist, r_counts, r_total = distribution(pov_reclass)
    print(f"\n  {pov.upper()} (n={o_total}):")
    print(f"    Original:      belief={o_counts.get('belief',0)}, desire={o_counts.get('desire',0)}, intention={o_counts.get('intention',0)}")
    print(f"    Reclassified:  belief={r_counts.get('belief',0)}, desire={r_counts.get('desire',0)}, intention={r_counts.get('intention',0)}")
    o_kl = kl_divergence(o_dist, tax_dist)
    r_kl = kl_divergence(r_dist, tax_dist)
    print(f"    KL(orig||tax)={o_kl:.4f}  KL(reclass||tax)={r_kl:.4f}  delta={r_kl - o_kl:+.4f}")

# ── Summary ──
kl_delta = reclass_kl - orig_kl
improved = kl_delta < 0
print(f"\n══ SUMMARY ══")
print(f"  Taxonomy ground truth: {tax_bdi_counts}")
print(f"  Original distribution: {orig_counts}")
print(f"  Reclassified distribution: {reclass_counts}")
print(f"  KL(original || taxonomy):      {orig_kl:.4f}")
print(f"  KL(reclassified || taxonomy):  {reclass_kl:.4f}")
print(f"  KL delta:                      {kl_delta:+.4f} ({'IMPROVED' if improved else 'WORSE'})")
changed = sum(1 for o, r in zip(original_bdis, reclass_bdis) if o != r)
print(f"  Claims reclassified:           {changed}/{len(claims)} ({100*changed/len(claims):.1f}%)")

# ── Save results ──
results = {
    'metadata': {
        'phase': 2,
        'ticket': 't/536',
        'model': 'gemini-2.5-flash-lite',
        'total_claims': len(claims),
        'run_date': time.strftime('%Y-%m-%dT%H:%M:%S'),
    },
    'taxonomy_ground_truth': {
        'counts': tax_bdi_counts,
        'distribution': tax_dist,
    },
    'original': {
        'counts': orig_counts,
        'distribution': orig_dist,
        'kl_divergence': orig_kl,
    },
    'reclassified': {
        'counts': reclass_counts,
        'distribution': reclass_dist,
        'kl_divergence': reclass_kl,
    },
    'kl_delta': kl_delta,
    'improved': improved,
    'claims_changed': changed,
    'claims_changed_pct': round(100 * changed / len(claims), 1),
    'transitions': transitions,
}
with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2)
print(f"\nResults saved to {OUTPUT_PATH}")
