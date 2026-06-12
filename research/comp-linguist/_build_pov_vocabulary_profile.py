"""Build POV vocabulary profiles from high-confidence debate claims.

Extracts per-POV N-gram frequencies, discourse markers, syntax patterns,
and few-shot exemplar claims for generation prompt anchoring.

Ticket: t/555

Usage:
    python _build_pov_vocabulary_profile.py [--top-percentile N] [--golden-set PATH]

Output:
    _pov_profile_acc.json, _pov_profile_saf.json, _pov_profile_skp.json
"""
import sys
import json
import os
import re
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone

import numpy as np
from sklearn.feature_extraction.text import CountVectorizer

sys.stdout.reconfigure(encoding='utf-8')

RESEARCH_DIR = os.path.dirname(os.path.abspath(__file__))

POV_NAMES = {
    'acc': 'Accelerationist',
    'saf': 'Safetyist',
    'skp': 'Skeptic',
}

DISCOURSE_MARKERS = {
    'hedging': [
        'might', 'perhaps', 'could', 'possibly', 'likely', 'may', 'arguably',
        'potentially', 'tends to', 'it seems', 'it appears', 'to some extent',
        'in principle', 'in theory',
    ],
    'certainty': [
        'clearly', 'obviously', 'certainly', 'undeniably', 'definitely',
        'without question', 'unquestionably', 'indisputably', 'plainly',
        'fundamentally', 'inherently', 'inevitably',
    ],
    'causal': [
        'because', 'therefore', 'thus', 'consequently', 'hence', 'as a result',
        'due to', 'owing to', 'leads to', 'results in', 'causes', 'stems from',
        'given that', 'since',
    ],
    'contrast': [
        'however', 'although', 'despite', 'nevertheless', 'while', 'whereas',
        'on the other hand', 'in contrast', 'yet', 'but', 'nonetheless',
        'conversely', 'rather than',
    ],
    'evidence': [
        'according to', 'research shows', 'studies suggest', 'data indicates',
        'evidence suggests', 'empirically', 'historically', 'in practice',
        'demonstrates', 'has shown', 'findings indicate',
    ],
    'prescriptive': [
        'should', 'must', 'need to', 'ought to', 'require', 'essential',
        'necessary', 'imperative', 'critical', 'vital', 'mandatory',
    ],
    'concession': [
        'admittedly', 'granted', 'of course', 'to be fair', 'it is true that',
        'while it is true', 'even if', 'even though', 'notwithstanding',
    ],
    'intensifier': [
        'extremely', 'significantly', 'dramatically', 'substantially',
        'profoundly', 'vastly', 'radically', 'enormously', 'deeply',
    ],
}


def load_golden_set(path):
    """Load golden test set."""
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def select_top_claims(claims, pov, top_percentile):
    """Select top N% highest-similarity claims for a POV."""
    pov_claims = [c for c in claims if c['pov'] == pov]
    pov_claims.sort(key=lambda c: c['similarity_score'], reverse=True)
    n = max(1, int(len(pov_claims) * top_percentile / 100))
    return pov_claims[:n]


def extract_ngrams(texts, n_range, top_k=30):
    """Extract top-k N-grams by frequency."""
    if not texts:
        return []
    vectorizer = CountVectorizer(
        ngram_range=n_range,
        stop_words='english',
        max_features=500,
        min_df=2 if len(texts) > 5 else 1,
    )
    try:
        matrix = vectorizer.fit_transform(texts)
    except ValueError:
        return []

    freqs = np.asarray(matrix.sum(axis=0)).flatten()
    feature_names = vectorizer.get_feature_names_out()
    sorted_idx = np.argsort(-freqs)

    results = []
    for idx in sorted_idx[:top_k]:
        results.append({
            'term': feature_names[idx],
            'count': int(freqs[idx]),
            'doc_freq': int(np.count_nonzero(matrix[:, idx].toarray())),
        })
    return results


def count_discourse_markers(texts):
    """Count discourse marker occurrences by category."""
    combined = ' '.join(texts).lower()
    results = {}
    marker_details = {}

    for category, markers in DISCOURSE_MARKERS.items():
        category_count = 0
        found_markers = {}
        for marker in markers:
            pattern = r'\b' + re.escape(marker) + r'\b'
            count = len(re.findall(pattern, combined))
            if count > 0:
                found_markers[marker] = count
                category_count += count
        results[category] = category_count
        if found_markers:
            marker_details[category] = dict(
                sorted(found_markers.items(), key=lambda x: x[1], reverse=True)
            )

    return results, marker_details


def select_exemplars(claims, n=5):
    """Select diverse exemplar claims: spread across similarity range and debates."""
    if len(claims) <= n:
        return [format_exemplar(c) for c in claims]

    sorted_claims = sorted(claims, key=lambda c: c['similarity_score'], reverse=True)

    exemplars = [sorted_claims[0]]

    debate_ids = set(c['debate_id'] for c in claims)
    debates_covered = {sorted_claims[0]['debate_id']}

    while len(exemplars) < n and len(exemplars) < len(sorted_claims):
        best_candidate = None
        best_diversity = -1

        for c in sorted_claims:
            if c in exemplars:
                continue

            debate_bonus = 1.0 if c['debate_id'] not in debates_covered else 0.0
            sim_distances = [abs(c['similarity_score'] - e['similarity_score'])
                             for e in exemplars]
            sim_diversity = min(sim_distances)
            diversity = sim_diversity + debate_bonus * 0.3

            if diversity > best_diversity:
                best_diversity = diversity
                best_candidate = c

        if best_candidate:
            exemplars.append(best_candidate)
            debates_covered.add(best_candidate['debate_id'])
        else:
            break

    return [format_exemplar(c) for c in exemplars]


def format_exemplar(claim):
    """Format a claim as a few-shot exemplar."""
    return {
        'text': claim['claim_text'],
        'attributed_node': claim['attributed_node'],
        'attributed_label': claim.get('attributed_label', ''),
        'similarity': claim['similarity_score'],
        'bdi_category': claim.get('bdi_category', ''),
        'debate_id': claim['debate_id'],
    }


def compute_register_signature(texts):
    """Compute register-level statistics."""
    if not texts:
        return {}

    lengths = [len(t.split()) for t in texts]
    sentence_counts = [len(re.split(r'[.!?]+', t)) for t in texts]
    comma_density = [t.count(',') / max(len(t.split()), 1) for t in texts]

    question_count = sum(1 for t in texts if '?' in t)
    passive_markers = sum(1 for t in texts
                         for word in ['is ', 'are ', 'was ', 'were ', 'been ', 'being ']
                         if word in t.lower())

    return {
        'mean_word_count': round(float(np.mean(lengths)), 1),
        'median_word_count': round(float(np.median(lengths)), 1),
        'mean_sentences': round(float(np.mean(sentence_counts)), 1),
        'mean_comma_density': round(float(np.mean(comma_density)), 4),
        'question_pct': round(question_count / len(texts) * 100, 1),
        'passive_marker_density': round(passive_markers / len(texts), 2),
    }


def build_profile(claims, pov, top_percentile):
    """Build complete vocabulary profile for one POV."""
    top_claims = select_top_claims(claims, pov, top_percentile)
    all_pov_claims = [c for c in claims if c['pov'] == pov]

    if not top_claims:
        return None

    texts = [c['claim_text'] for c in top_claims]
    all_texts = [c['claim_text'] for c in all_pov_claims]

    unigrams = extract_ngrams(texts, (1, 1), top_k=30)
    bigrams = extract_ngrams(texts, (2, 2), top_k=25)
    trigrams = extract_ngrams(texts, (3, 3), top_k=15)

    marker_counts, marker_details = count_discourse_markers(texts)
    all_marker_counts, _ = count_discourse_markers(all_texts)

    marker_enrichment = {}
    for cat in marker_counts:
        top_rate = marker_counts[cat] / max(len(texts), 1)
        all_rate = all_marker_counts.get(cat, 0) / max(len(all_texts), 1)
        if all_rate > 0:
            marker_enrichment[cat] = round(top_rate / all_rate, 2)

    exemplars = select_exemplars(top_claims, n=5)
    register = compute_register_signature(texts)

    sim_scores = [c['similarity_score'] for c in top_claims]

    return {
        'pov': pov,
        'pov_name': POV_NAMES[pov],
        'total_claims_in_pov': len(all_pov_claims),
        'top_percentile': top_percentile,
        'top_claim_count': len(top_claims),
        'similarity_range': {
            'min': round(min(sim_scores), 4),
            'max': round(max(sim_scores), 4),
            'mean': round(float(np.mean(sim_scores)), 4),
        },
        'ngrams': {
            'unigrams': unigrams,
            'bigrams': bigrams,
            'trigrams': trigrams,
        },
        'discourse_markers': {
            'counts_per_category': marker_counts,
            'top_markers_by_category': marker_details,
            'enrichment_vs_all_claims': marker_enrichment,
        },
        'register_signature': register,
        'exemplar_claims': exemplars,
    }


def main():
    parser = argparse.ArgumentParser(description='Build POV vocabulary profiles')
    parser.add_argument('--top-percentile', type=int, default=10,
                        help='Top N%% highest-similarity claims (default: 10)')
    parser.add_argument('--golden-set',
                        default=os.path.join(RESEARCH_DIR, '_golden_test_set.json'),
                        help='Path to golden test set')
    parser.add_argument('--output-dir', default=RESEARCH_DIR)
    args = parser.parse_args()

    print("=" * 60)
    print("  POV Vocabulary Profile Builder (t/555)")
    print("=" * 60)

    print("\n[1/3] Loading golden test set...")
    golden = load_golden_set(args.golden_set)
    claims = golden['claims']
    print(f"  {len(claims)} claims loaded")

    print(f"\n[2/3] Building profiles (top {args.top_percentile}%)...")
    profiles = {}
    for pov in ['acc', 'saf', 'skp']:
        print(f"\n  ── {POV_NAMES[pov]} ──")
        profile = build_profile(claims, pov, args.top_percentile)
        if not profile:
            print(f"    No claims found for {pov}")
            continue

        profiles[pov] = profile
        print(f"    Claims: {profile['top_claim_count']} (of {profile['total_claims_in_pov']})")
        print(f"    Similarity: {profile['similarity_range']['min']:.3f}–{profile['similarity_range']['max']:.3f}")

        dm = profile['discourse_markers']['counts_per_category']
        top_cats = sorted(dm.items(), key=lambda x: x[1], reverse=True)[:4]
        print(f"    Top discourse markers: {', '.join(f'{c}={n}' for c, n in top_cats)}")

        reg = profile['register_signature']
        print(f"    Register: {reg['mean_word_count']:.0f} words/claim, "
              f"{reg['mean_sentences']:.1f} sentences, "
              f"{reg['question_pct']:.0f}% questions")

        print(f"    Exemplars: {len(profile['exemplar_claims'])}")
        for i, ex in enumerate(profile['exemplar_claims'][:3]):
            print(f"      {i+1}. [{ex['similarity']:.3f}] {ex['text'][:90]}...")

    print(f"\n[3/3] Saving profiles...")
    for pov, profile in profiles.items():
        path = os.path.join(args.output_dir, f'_pov_profile_{pov}.json')
        output = {
            'metadata': {
                'generated_at': datetime.now(timezone.utc).isoformat(),
                'golden_set_source': args.golden_set,
                'top_percentile': args.top_percentile,
            },
            'profile': profile,
        }
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        print(f"  {path}")

    print(f"\n  ── Cross-POV Comparison ──")
    for cat in ['hedging', 'certainty', 'causal', 'prescriptive', 'contrast']:
        row = []
        for pov in ['acc', 'saf', 'skp']:
            if pov in profiles:
                count = profiles[pov]['discourse_markers']['counts_per_category'].get(cat, 0)
                n = profiles[pov]['top_claim_count']
                rate = count / max(n, 1)
                row.append(f"{pov}={rate:.2f}")
        print(f"    {cat:14s}: {', '.join(row)}")

    print(f"\n{'=' * 60}")
    print(f"  Done. Profiles saved for {len(profiles)} POVs.")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
