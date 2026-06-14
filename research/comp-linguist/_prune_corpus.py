"""Prune-and-regenerate pipeline for synthetic corpus quality gating.

Each cycle:
  1. Embed all statements (all-MiniLM-L6-v2)
  2. Per-statement poaching check against neighbor vectors
  3. Redundancy check (intra-node cosine > 0.92)
  4. Rationale filter (discard when rationale reveals neighbor expression)
  5. Flag nodes with prune rate > threshold for contrastive regeneration
  6. Write _regen_manifest.json for New-SyntheticCorpus to consume

After max cycles, remaining high-prune-rate nodes become permanent hard nodes.

Usage:
    python _prune_corpus.py [--corpus-dir PATH] [--target-per-node N]
    python _prune_corpus.py --report-only
    python _prune_corpus.py --node-id acc-beliefs-071
    python _prune_corpus.py --max-cycles 2 --prune-threshold 0.25

Output:
    Updated corpus files (pruned=true on removed entries)
    _prune_report.json (cumulative across cycles)
    _regen_manifest.json (when hard nodes need regeneration)
"""
import sys
import json
import os
import re
import argparse
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

sys.stdout.reconfigure(encoding='utf-8')

RESEARCH_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(RESEARCH_DIR))

REDUNDANCY_THRESHOLD = 0.92
POACHING_MARGIN = 0.02


def resolve_data_root():
    config_path = os.path.join(REPO_ROOT, '.aitriad.json')
    if os.path.exists(config_path):
        try:
            with open(config_path, encoding='utf-8') as fh:
                cfg = json.load(fh)
            data_root = cfg.get('data_root', '.')
            tax_dir = cfg.get('taxonomy_dir', 'taxonomy/Origin')
            base = data_root if os.path.isabs(data_root) else os.path.join(REPO_ROOT, data_root)
            return os.path.normpath(os.path.join(base, tax_dir))
        except (json.JSONDecodeError, OSError):
            pass
    return os.path.normpath(os.path.join(REPO_ROOT, 'taxonomy', 'Origin'))


def load_corpus(corpus_dir):
    corpus_files = {}
    entries_by_node = defaultdict(list)
    for fname in sorted(os.listdir(corpus_dir)):
        if not fname.startswith('corpus_') or not fname.endswith('.json'):
            continue
        path = os.path.join(corpus_dir, fname)
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        pov = data.get('pov', fname.replace('corpus_', '').replace('.json', ''))
        corpus_files[pov] = {'path': path, 'data': data}
        for i, entry in enumerate(data.get('entries', [])):
            entry['_file_pov'] = pov
            entry['_file_idx'] = i
            entries_by_node[entry['node_id']].append(entry)
    return corpus_files, entries_by_node


def load_confusable_neighbors():
    path = os.path.join(RESEARCH_DIR, '_confusable_neighbors.json')
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    neighbor_map = {}
    for nid, info in data.get('nodes', {}).items():
        neighbor_map[nid] = [nb['node_id'] for nb in info.get('neighbors', [])]
    return neighbor_map


def embed_texts(texts):
    try:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer('all-MiniLM-L6-v2')
        vectors = model.encode(texts, show_progress_bar=len(texts) > 100,
                               batch_size=64, normalize_embeddings=True)
        return np.array(vectors)
    except ImportError:
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.preprocessing import normalize
        vectorizer = TfidfVectorizer(max_features=5000, sublinear_tf=True)
        matrix = vectorizer.fit_transform(texts)
        return normalize(matrix.toarray()).astype(np.float32)


def check_poaching(entry_vec, own_node_vecs, neighbor_vecs_map):
    """Check if a statement is closer to any neighbor's centroid than its own."""
    if own_node_vecs.shape[0] == 0:
        return False, None, 0.0

    own_sim = float(cosine_similarity(
        entry_vec.reshape(1, -1), own_node_vecs
    ).max())

    worst_neighbor = None
    worst_sim = 0.0
    for nb_id, nb_vecs in neighbor_vecs_map.items():
        if nb_vecs.shape[0] == 0:
            continue
        nb_sim = float(cosine_similarity(
            entry_vec.reshape(1, -1), nb_vecs
        ).max())
        if nb_sim > worst_sim:
            worst_sim = nb_sim
            worst_neighbor = nb_id

    if worst_neighbor and worst_sim > own_sim - POACHING_MARGIN:
        return True, worst_neighbor, worst_sim - own_sim

    return False, None, 0.0


def check_redundancy(entry_vec, other_vecs):
    """Check if a statement is near-duplicate of another in the same node."""
    if other_vecs.shape[0] == 0:
        return False, 0.0
    sims = cosine_similarity(entry_vec.reshape(1, -1), other_vecs).flatten()
    max_sim = float(np.max(sims))
    return max_sim > REDUNDANCY_THRESHOLD, max_sim


CONTRASTIVE_PREFIXES = [
    'rather than', 'unlike', 'distinct from', 'instead of',
    'differentiates from', 'distinguishes from', 'contrasts with',
    'as opposed to', 'not about', 'not captured by', 'not the same as',
    'in contrast to', 'differs from', 'separated from',
]

AFFIRMATIVE_MARKERS = [
    'actually about', 'more appropriate for', 'better suited to',
    'captures the essence of', 'belongs to', 'expression of',
    'really about', 'more accurately describes', 'conflates with',
]


def check_rationale(entry, neighbor_ids):
    """Check if rationale reveals the statement is actually about a neighbor.

    Neighbor IDs in contrastive context ("rather than X", "unlike X") are
    expected — our templates ask models to contrast against confusable
    neighbors. Only flag affirmative associations ("actually about X",
    "more appropriate for X") or generic-marker matches.
    """
    rationale = (entry.get('rationale') or '').lower()
    if not rationale:
        return False, None

    for nb_id in neighbor_ids:
        nb_lower = nb_id.lower()
        if nb_lower not in rationale:
            continue
        idx = rationale.index(nb_lower)
        preceding = rationale[max(0, idx - 60):idx]
        if any(p in preceding for p in CONTRASTIVE_PREFIXES):
            continue
        if any(m in rationale for m in AFFIRMATIVE_MARKERS):
            return True, nb_id

    generic_markers = [
        'generic', 'platitude', 'could apply to any',
        'not specific to', 'broadly applicable',
    ]
    for marker in generic_markers:
        if marker in rationale:
            return True, 'generic'

    return False, None


def prune_node(node_id, entries, all_vectors, all_entries_flat, entry_to_idx,
               neighbor_map, target_per_node):
    """Run pruning pipeline on a single node's entries."""
    own_indices = [entry_to_idx[id(e)] for e in entries if not e.get('pruned')]
    if not own_indices:
        return [], {}

    own_vecs = all_vectors[own_indices]
    idx_to_local = {idx: pos for pos, idx in enumerate(own_indices)}
    neighbor_ids = neighbor_map.get(node_id, [])

    neighbor_vecs_map = {}
    for nb_id in neighbor_ids:
        nb_entries = [e for e in all_entries_flat
                      if e['node_id'] == nb_id and not e.get('pruned')]
        nb_indices = [entry_to_idx[id(e)] for e in nb_entries if id(e) in entry_to_idx]
        if nb_indices:
            neighbor_vecs_map[nb_id] = all_vectors[nb_indices]

    prune_decisions = []
    for i, entry in enumerate(entries):
        if entry.get('pruned'):
            continue

        idx = entry_to_idx[id(entry)]
        vec = all_vectors[idx]
        reasons = []

        others_mask = np.ones(len(own_indices), dtype=bool)
        local_pos = idx_to_local.get(idx, -1)
        if local_pos >= 0:
            others_mask[local_pos] = False
        other_vecs = own_vecs[others_mask] if others_mask.any() else np.array([])

        is_poached, poacher, margin = check_poaching(vec, own_vecs, neighbor_vecs_map)
        if is_poached:
            reasons.append(f'poached_by:{poacher}(margin={margin:.4f})')

        if other_vecs.shape[0] > 0:
            is_redundant, sim = check_redundancy(vec, other_vecs)
            if is_redundant:
                reasons.append(f'redundant(sim={sim:.4f})')

        is_bad_rationale, rationale_issue = check_rationale(entry, neighbor_ids)
        if is_bad_rationale:
            reasons.append(f'rationale:{rationale_issue}')

        prune_decisions.append({
            'entry': entry,
            'prune': len(reasons) > 0,
            'reasons': reasons,
        })

    pruned_count = sum(1 for d in prune_decisions if d['prune'])
    prune_rate = pruned_count / max(len(prune_decisions), 1)

    diagnostics = {
        'node_id': node_id,
        'total_entries': len(entries),
        'evaluated': len(prune_decisions),
        'pruned': pruned_count,
        'prune_rate': round(prune_rate, 3),
        'remaining': len(prune_decisions) - pruned_count,
        'target': target_per_node,
        'meets_target': (len(prune_decisions) - pruned_count) >= target_per_node,
        'reasons': defaultdict(int),
        'neighbor_violations': defaultdict(int),
    }

    for d in prune_decisions:
        for r in d['reasons']:
            if r.startswith('poached_by:'):
                nb = r.split(':')[1].split('(')[0]
                diagnostics['neighbor_violations'][nb] += 1
                diagnostics['reasons']['poaching'] += 1
            elif r.startswith('redundant'):
                diagnostics['reasons']['redundancy'] += 1
            elif r.startswith('rationale'):
                diagnostics['reasons']['rationale'] += 1

    diagnostics['reasons'] = dict(diagnostics['reasons'])
    diagnostics['neighbor_violations'] = dict(diagnostics['neighbor_violations'])
    diagnostics['needs_regeneration'] = prune_rate > 0.25

    return prune_decisions, diagnostics


def apply_pruning(corpus_files, prune_decisions_all):
    """Mark pruned entries in corpus files and save."""
    for decisions in prune_decisions_all:
        for d in decisions:
            if d['prune']:
                entry = d['entry']
                entry['pruned'] = True
                entry['prune_reason'] = '; '.join(d['reasons'])

    for pov, cfile in corpus_files.items():
        with open(cfile['path'], 'w', encoding='utf-8') as f:
            json.dump(cfile['data'], f, indent=2, ensure_ascii=False)


def run_prune_pass(entries_by_node, neighbor_map, target_per_node):
    """Run a single pruning pass. Returns (decisions_list, diagnostics_list)."""
    all_entries_flat = []
    for nid in sorted(entries_by_node.keys()):
        all_entries_flat.extend(entries_by_node[nid])

    texts = [e['statement'] for e in all_entries_flat]
    if not texts:
        return [], []

    vectors = embed_texts(texts)
    entry_to_idx = {id(e): i for i, e in enumerate(all_entries_flat)}

    all_diagnostics = []
    all_decisions = []

    for nid in sorted(entries_by_node.keys()):
        entries = entries_by_node[nid]
        active = [e for e in entries if not e.get('pruned')]
        if not active:
            continue

        decisions, diag = prune_node(
            nid, active, vectors, all_entries_flat, entry_to_idx,
            neighbor_map, target_per_node
        )
        all_decisions.append(decisions)
        all_diagnostics.append(diag)

        status = 'REGEN' if diag['needs_regeneration'] else 'OK'
        print(f"  {nid}: {diag['pruned']}/{diag['evaluated']} pruned "
              f"({diag['prune_rate']:.0%}) → {diag['remaining']} remaining [{status}]")
        if diag['reasons']:
            parts = [f"{k}={v}" for k, v in diag['reasons'].items()]
            print(f"    reasons: {', '.join(parts)}")
        if diag['neighbor_violations']:
            parts = [f"{k}={v}" for k, v in diag['neighbor_violations'].items()]
            print(f"    violations: {', '.join(parts)}")

    return all_decisions, all_diagnostics


def build_regen_manifest(diagnostics, output_dir):
    """Build regeneration manifest from hard nodes and write to disk.

    Returns dict mapping node_id → {neighbor_violations, prune_rate}.
    """
    hard_nodes = [d for d in diagnostics if d.get('needs_regeneration')]
    if not hard_nodes:
        return {}

    manifest = {}
    for diag in hard_nodes:
        manifest[diag['node_id']] = {
            'neighbor_violations': diag.get('neighbor_violations', {}),
            'prune_rate': diag['prune_rate'],
            'pruned_count': diag['pruned'],
            'remaining': diag['remaining'],
        }

    manifest_path = os.path.join(output_dir, '_regen_manifest.json')
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump({
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'hard_nodes': manifest,
            'node_ids': list(manifest.keys()),
        }, f, indent=2, ensure_ascii=False)
    print(f"  Regeneration manifest: {manifest_path}")
    return manifest


def main():
    parser = argparse.ArgumentParser(description='Prune synthetic corpus')
    parser.add_argument('--corpus-dir', default=None)
    parser.add_argument('--target-per-node', type=int, default=40)
    parser.add_argument('--report-only', action='store_true')
    parser.add_argument('--node-id', type=str, default=None)
    parser.add_argument('--output-dir', default=RESEARCH_DIR)
    parser.add_argument('--max-cycles', type=int, default=2,
                        help='Max prune-regenerate cycles before flagging permanent hard nodes')
    parser.add_argument('--prune-threshold', type=float, default=0.25,
                        help='Prune rate above which a node is flagged for regeneration')
    args = parser.parse_args()

    if args.corpus_dir is None:
        args.corpus_dir = os.path.join(resolve_data_root(), 'synthetic')

    print("=" * 60)
    print("  Synthetic Corpus Pruning")
    print("=" * 60)

    neighbor_map = load_confusable_neighbors()
    print(f"  {len(neighbor_map)} nodes with neighbor data")

    cumulative_diagnostics = []
    permanent_hard_nodes = []

    for cycle in range(1, args.max_cycles + 1):
        print(f"\n{'─' * 50}")
        print(f"  CYCLE {cycle}/{args.max_cycles}")
        print(f"{'─' * 50}")

        print(f"\n  Loading corpus...")
        corpus_files, entries_by_node = load_corpus(args.corpus_dir)
        total = sum(len(v) for v in entries_by_node.values())
        print(f"  {total} entries across {len(entries_by_node)} nodes")

        if args.node_id:
            if args.node_id not in entries_by_node:
                print(f"  Node {args.node_id} not found in corpus")
                return
            entries_by_node = {args.node_id: entries_by_node[args.node_id]}

        print(f"\n  Embedding + pruning...")
        all_decisions, all_diagnostics = run_prune_pass(
            entries_by_node, neighbor_map, args.target_per_node
        )

        if not all_diagnostics:
            print("  No entries to analyze")
            break

        total_pruned = sum(d['pruned'] for d in all_diagnostics)
        total_eval = sum(d['evaluated'] for d in all_diagnostics)
        hard_nodes = [d for d in all_diagnostics
                      if d['prune_rate'] > args.prune_threshold]

        print(f"\n  Cycle {cycle} results: {total_pruned}/{total_eval} pruned "
              f"({total_pruned/max(total_eval,1):.0%}), "
              f"{len(hard_nodes)} hard nodes")

        if not args.report_only:
            apply_pruning(corpus_files, all_decisions)
            print(f"  Applied pruning marks to corpus files")

        cumulative_diagnostics.append({
            'cycle': cycle,
            'total_evaluated': total_eval,
            'total_pruned': total_pruned,
            'hard_nodes': [d['node_id'] for d in hard_nodes],
            'per_node': {d['node_id']: d for d in all_diagnostics},
        })

        if not hard_nodes:
            print(f"\n  No hard nodes — pruning converged at cycle {cycle}")
            break

        if cycle < args.max_cycles:
            regen_manifest = build_regen_manifest(all_diagnostics, args.output_dir)
            node_list = ', '.join(regen_manifest.keys())
            print(f"\n  {len(regen_manifest)} nodes need regeneration: {node_list}")
            print(f"  Run: New-SyntheticCorpus -PilotNodes {node_list}")
            print(f"  The manifest at _regen_manifest.json contains contrastive_emphasis "
                  f"data for PromptAssembler.")
            print(f"\n  ⏸ Waiting for regeneration before cycle {cycle + 1}...")
            print(f"  Re-run this script after regeneration completes.")
            break
        else:
            permanent_hard_nodes = [d['node_id'] for d in hard_nodes]
            print(f"\n  Max cycles reached. {len(permanent_hard_nodes)} permanent "
                  f"hard nodes: {', '.join(permanent_hard_nodes)}")

    report = {
        'metadata': {
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'corpus_dir': args.corpus_dir,
            'target_per_node': args.target_per_node,
            'redundancy_threshold': REDUNDANCY_THRESHOLD,
            'poaching_margin': POACHING_MARGIN,
            'prune_threshold': args.prune_threshold,
            'max_cycles': args.max_cycles,
            'report_only': args.report_only,
        },
        'cycles': cumulative_diagnostics,
        'summary': {
            'cycles_completed': len(cumulative_diagnostics),
            'converged': len(permanent_hard_nodes) == 0 and len(cumulative_diagnostics) > 0,
            'permanent_hard_nodes': permanent_hard_nodes,
        },
    }

    report_path = os.path.join(args.output_dir, '_prune_report.json')
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"\n  Report: {report_path}")

    total_all = sum(c['total_pruned'] for c in cumulative_diagnostics)
    print(f"\n{'=' * 60}")
    print(f"  Done. {total_all} total pruned across {len(cumulative_diagnostics)} cycle(s).")
    if permanent_hard_nodes:
        print(f"  Permanent hard nodes: {', '.join(permanent_hard_nodes)}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
