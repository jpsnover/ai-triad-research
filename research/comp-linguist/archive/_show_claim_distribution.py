"""Claim distribution analysis: embed real agent claims, visualize register space.

Projects claim embeddings and taxonomy node embeddings to 2D using t-SNE,
generates interactive HTML visualization, and reports register density analysis.

Ticket: t/554

Usage:
    python _show_claim_distribution.py [--golden-set PATH] [--perplexity N]

Requires: _golden_test_set.json and _golden_claim_vectors.npy from t/553.

Outputs:
    _claim_distribution.html          - Interactive 2D scatter (plotly.js)
    _claim_distribution_report.json   - Register density analysis + recommendations
"""
import sys
import json
import os
import argparse
from datetime import datetime, timezone
from collections import defaultdict

import numpy as np
from sklearn.manifold import TSNE
from sklearn.neighbors import NearestNeighbors

sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin'
RESEARCH_DIR = os.path.dirname(os.path.abspath(__file__))

POV_COLORS = {
    'acc': '#e74c3c',
    'saf': '#2ecc71',
    'skp': '#3498db',
}
POV_NAMES = {
    'acc': 'Accelerationist',
    'saf': 'Safetyist',
    'skp': 'Skeptic',
}


def load_golden_set(path):
    """Load golden test set JSON."""
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def load_claim_vectors(vectors_path):
    """Load claim embedding vectors."""
    return np.load(vectors_path)


def load_node_embeddings():
    """Load taxonomy node embeddings."""
    emb_path = os.path.join(DATA_ROOT, 'embeddings.json')
    with open(emb_path, encoding='utf-8') as f:
        emb_data = json.load(f)

    node_ids = []
    node_vecs = []
    for nid, entry in emb_data.get('nodes', {}).items():
        vec = entry.get('vector', [])
        if vec:
            node_ids.append(nid)
            node_vecs.append(vec)

    return node_ids, np.array(node_vecs, dtype=np.float32)


def load_taxonomy_labels():
    """Load node labels for hover text."""
    labels = {}
    for pov_file in ['accelerationist.json', 'safetyist.json', 'skeptic.json']:
        path = os.path.join(DATA_ROOT, pov_file)
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        for n in data.get('nodes', []):
            labels[n['id']] = n.get('label', n['id'])
    return labels


def get_pov_from_id(node_id):
    """Extract POV prefix from node ID."""
    prefix = node_id.split('-')[0]
    if prefix in POV_COLORS:
        return prefix
    return 'other'


def compute_density_analysis(claim_vecs, claim_povs, node_ids, node_vecs):
    """Compute register density: which regions have many/few claims."""
    results = {}

    for pov in ['acc', 'saf', 'skp']:
        pov_claim_mask = np.array([p == pov for p in claim_povs])
        pov_node_mask = np.array([get_pov_from_id(nid) == pov for nid in node_ids])

        pov_claims = claim_vecs[pov_claim_mask]
        pov_node_ids = [nid for nid, m in zip(node_ids, pov_node_mask) if m]
        pov_nodes = node_vecs[pov_node_mask]

        if len(pov_claims) == 0 or len(pov_nodes) == 0:
            continue

        norms_c = np.linalg.norm(pov_claims, axis=1, keepdims=True)
        norms_c[norms_c == 0] = 1.0
        norms_n = np.linalg.norm(pov_nodes, axis=1, keepdims=True)
        norms_n[norms_n == 0] = 1.0
        sim_matrix = (pov_claims / norms_c) @ (pov_nodes / norms_n).T

        claims_per_node = np.argmax(sim_matrix, axis=1)
        node_claim_counts = defaultdict(int)
        node_max_sims = defaultdict(float)
        for idx, node_idx in enumerate(claims_per_node):
            nid = pov_node_ids[node_idx]
            node_claim_counts[nid] += 1
            node_max_sims[nid] = max(node_max_sims[nid], float(sim_matrix[idx, node_idx]))

        island_nodes = [nid for nid in pov_node_ids if node_claim_counts.get(nid, 0) == 0]

        counts = list(node_claim_counts.values())
        count_arr = np.array(counts) if counts else np.array([0])

        hot_spots = sorted(node_claim_counts.items(), key=lambda x: x[1], reverse=True)[:10]

        mean_sim_per_claim = float(np.mean(np.max(sim_matrix, axis=1)))

        results[pov] = {
            'total_claims': int(pov_claim_mask.sum()),
            'total_nodes': len(pov_node_ids),
            'nodes_with_claims': len(node_claim_counts),
            'island_nodes_count': len(island_nodes),
            'island_nodes': island_nodes[:20],
            'mean_claims_per_node': round(float(count_arr.mean()), 2) if len(counts) > 0 else 0,
            'max_claims_per_node': int(count_arr.max()) if len(counts) > 0 else 0,
            'std_claims_per_node': round(float(count_arr.std()), 2) if len(counts) > 0 else 0,
            'gini_coefficient': round(float(gini(count_arr)), 4) if len(counts) > 1 else 0,
            'hot_spots': [{'node_id': nid, 'claim_count': c} for nid, c in hot_spots],
            'mean_top1_similarity': round(mean_sim_per_claim, 4),
            'coverage_pct': round(len(node_claim_counts) / len(pov_node_ids) * 100, 1),
        }

    return results


def gini(values):
    """Compute Gini coefficient for distribution inequality."""
    values = np.sort(values).astype(float)
    n = len(values)
    if n == 0 or values.sum() == 0:
        return 0.0
    index = np.arange(1, n + 1)
    return float((2 * np.sum(index * values) - (n + 1) * np.sum(values)) / (n * np.sum(values)))


def build_recommendations(density):
    """Generate audience-axis budget recommendations from density analysis."""
    recs = []

    for pov, stats in density.items():
        name = POV_NAMES[pov]
        coverage = stats['coverage_pct']
        gini_val = stats['gini_coefficient']
        islands = stats['island_nodes_count']
        total = stats['total_nodes']

        if coverage < 50:
            recs.append({
                'pov': pov,
                'priority': 'HIGH',
                'finding': f'{name}: only {coverage:.0f}% node coverage — {islands} island nodes',
                'recommendation': (
                    f'Allocate extra audience-axis budget to {name} corpus. '
                    f'{islands}/{total} nodes have zero matching claims, '
                    f'indicating vocabulary gaps the synthetic corpus must fill.'
                ),
            })
        elif coverage < 75:
            recs.append({
                'pov': pov,
                'priority': 'MEDIUM',
                'finding': f'{name}: {coverage:.0f}% coverage, {islands} island nodes',
                'recommendation': (
                    f'{name} has moderate coverage. Target island nodes '
                    f'with additional audience-register variants.'
                ),
            })

        if gini_val > 0.6:
            recs.append({
                'pov': pov,
                'priority': 'HIGH',
                'finding': f'{name}: Gini={gini_val:.3f} — highly unequal claim distribution',
                'recommendation': (
                    f'Claims cluster around a few hot-spot nodes while most nodes are underserved. '
                    f'Synthetic corpus should prioritize diversity across cold nodes.'
                ),
            })

    return recs


def generate_html(claim_2d, claim_data, node_2d, node_ids, node_labels,
                  density, recommendations, output_path):
    """Generate self-contained interactive HTML visualization."""

    traces_js = []

    for pov in ['acc', 'saf', 'skp']:
        color = POV_COLORS[pov]
        name = POV_NAMES[pov]

        c_indices = [i for i, d in enumerate(claim_data) if d['pov'] == pov]
        if c_indices:
            xs = [float(claim_2d[i, 0]) for i in c_indices]
            ys = [float(claim_2d[i, 1]) for i in c_indices]
            texts = [claim_data[i]['claim_text'][:80] + '...' for i in c_indices]
            hover = [
                f"<b>{claim_data[i]['claim_id']}</b><br>"
                f"{claim_data[i]['claim_text'][:120]}<br>"
                f"→ {claim_data[i].get('attributed_node', '?')} "
                f"(sim={claim_data[i].get('similarity_score', 0):.3f})"
                for i in c_indices
            ]
            traces_js.append(json.dumps({
                'x': xs, 'y': ys, 'text': hover, 'name': f'{name} claims',
                'mode': 'markers',
                'marker': {'color': color, 'size': 5, 'opacity': 0.6},
                'type': 'scatter', 'hoverinfo': 'text',
            }))

        n_indices = [i for i, nid in enumerate(node_ids) if get_pov_from_id(nid) == pov]
        if n_indices:
            xs = [float(node_2d[i, 0]) for i in n_indices]
            ys = [float(node_2d[i, 1]) for i in n_indices]
            hover = [
                f"<b>{node_ids[i]}</b><br>{node_labels.get(node_ids[i], '')[:100]}"
                for i in n_indices
            ]
            traces_js.append(json.dumps({
                'x': xs, 'y': ys, 'text': hover, 'name': f'{name} nodes',
                'mode': 'markers',
                'marker': {'color': color, 'size': 10, 'opacity': 0.9,
                           'symbol': 'diamond', 'line': {'width': 1, 'color': '#333'}},
                'type': 'scatter', 'hoverinfo': 'text',
            }))

    density_table_rows = []
    for pov in ['acc', 'saf', 'skp']:
        if pov in density:
            d = density[pov]
            density_table_rows.append(
                f"<tr><td style='color:{POV_COLORS[pov]};font-weight:bold'>{POV_NAMES[pov]}</td>"
                f"<td>{d['total_claims']}</td><td>{d['total_nodes']}</td>"
                f"<td>{d['coverage_pct']:.0f}%</td><td>{d['island_nodes_count']}</td>"
                f"<td>{d['gini_coefficient']:.3f}</td>"
                f"<td>{d['mean_top1_similarity']:.3f}</td></tr>"
            )

    rec_html = ""
    for r in recommendations:
        badge = "🔴" if r['priority'] == 'HIGH' else "🟡"
        rec_html += (
            f"<div style='margin:8px 0;padding:8px;border-left:3px solid "
            f"{'#e74c3c' if r['priority']=='HIGH' else '#f39c12'};background:#f8f8f8'>"
            f"{badge} <b>[{r['priority']}] {POV_NAMES[r['pov']]}</b>: {r['finding']}<br>"
            f"<i>{r['recommendation']}</i></div>"
        )
    if not rec_html:
        rec_html = "<p style='color:green'>No high-priority coverage gaps detected.</p>"

    all_traces = ",\n      ".join(traces_js)

    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Claim Distribution Analysis (t/554)</title>
  <script src="https://cdn.plot.ly/plotly-2.35.0.min.js"></script>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           margin: 20px; background: #fff; }}
    h1 {{ border-bottom: 2px solid #333; padding-bottom: 8px; }}
    h2 {{ color: #555; margin-top: 24px; }}
    table {{ border-collapse: collapse; margin: 12px 0; }}
    th, td {{ border: 1px solid #ddd; padding: 6px 12px; text-align: left; }}
    th {{ background: #f5f5f5; }}
    #plot {{ width: 100%; height: 700px; }}
    .legend {{ font-size: 13px; color: #666; margin: 4px 0; }}
  </style>
</head>
<body>
  <h1>Claim Distribution Analysis</h1>
  <p class="legend">
    <b>Small circles</b> = debate claims (colored by POV) &nbsp;|&nbsp;
    <b>Diamonds</b> = taxonomy nodes &nbsp;|&nbsp;
    t-SNE 2D projection of 384-dim embeddings
  </p>

  <div id="plot"></div>

  <h2>Register Density</h2>
  <table>
    <tr><th>POV</th><th>Claims</th><th>Nodes</th><th>Coverage</th>
        <th>Island Nodes</th><th>Gini</th><th>Mean Top-1 Sim</th></tr>
    {"".join(density_table_rows)}
  </table>

  <h2>Recommendations</h2>
  {rec_html}

  <p style="color:#999;font-size:12px;margin-top:24px">
    Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}
    by _show_claim_distribution.py (t/554)
  </p>

  <script>
    var data = [
      {all_traces}
    ];
    var layout = {{
      title: 'Claim vs. Node Embedding Space (t-SNE)',
      hovermode: 'closest',
      xaxis: {{ title: 't-SNE 1', zeroline: false }},
      yaxis: {{ title: 't-SNE 2', zeroline: false }},
      legend: {{ x: 1, y: 1 }},
      margin: {{ l: 60, r: 20, t: 50, b: 50 }},
    }};
    Plotly.newPlot('plot', data, layout, {{responsive: true}});
  </script>
</body>
</html>"""

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)


def main():
    parser = argparse.ArgumentParser(description='Claim distribution analysis')
    parser.add_argument('--golden-set', default=os.path.join(RESEARCH_DIR, '_golden_test_set.json'),
                        help='Path to golden test set JSON')
    parser.add_argument('--vectors', default=os.path.join(RESEARCH_DIR, '_golden_claim_vectors.npy'),
                        help='Path to claim vectors .npy')
    parser.add_argument('--perplexity', type=int, default=30,
                        help='t-SNE perplexity (default: 30)')
    parser.add_argument('--output-dir', default=RESEARCH_DIR)
    args = parser.parse_args()

    print("=" * 60)
    print("  Claim Distribution Analysis (t/554)")
    print("=" * 60)

    # ── Load data ──
    print("\n[1/5] Loading golden test set...")
    golden = load_golden_set(args.golden_set)
    claims = golden['claims']
    print(f"  {len(claims)} claims loaded")

    print("  Loading claim vectors...")
    claim_vecs = load_claim_vectors(args.vectors)
    print(f"  Vectors shape: {claim_vecs.shape}")

    used_indices = [c['claim_vector_idx'] for c in claims]
    claim_vecs_used = claim_vecs[used_indices]
    print(f"  Using {len(used_indices)} claim vectors (matched to golden set entries)")

    print("\n[2/5] Loading taxonomy node embeddings...")
    node_ids, node_vecs = load_node_embeddings()
    print(f"  {len(node_ids)} node embeddings loaded")

    node_labels = load_taxonomy_labels()

    # ── t-SNE projection ──
    print(f"\n[3/5] Running t-SNE (perplexity={args.perplexity})...")
    combined = np.vstack([claim_vecs_used, node_vecs])
    n_claims = len(claim_vecs_used)
    n_total = len(combined)
    print(f"  Projecting {n_total} vectors ({n_claims} claims + {len(node_vecs)} nodes)...")

    effective_perplexity = min(args.perplexity, n_total // 4)
    tsne = TSNE(n_components=2, perplexity=effective_perplexity,
                random_state=42, max_iter=1000, learning_rate='auto', init='pca')
    projected = tsne.fit_transform(combined)
    claim_2d = projected[:n_claims]
    node_2d = projected[n_claims:]
    print(f"  Projection complete. KL divergence: {tsne.kl_divergence_:.4f}")

    # ── Density analysis ──
    print("\n[4/5] Computing register density analysis...")
    claim_povs = [c['pov'] for c in claims]
    density = compute_density_analysis(claim_vecs_used, claim_povs, node_ids, node_vecs)

    for pov in ['acc', 'saf', 'skp']:
        if pov in density:
            d = density[pov]
            print(f"  {POV_NAMES[pov]}: {d['total_claims']} claims, "
                  f"{d['coverage_pct']:.0f}% node coverage, "
                  f"{d['island_nodes_count']} island nodes, "
                  f"Gini={d['gini_coefficient']:.3f}")

    recommendations = build_recommendations(density)
    for r in recommendations:
        print(f"  [{r['priority']}] {r['finding']}")

    # ── Generate outputs ──
    print("\n[5/5] Generating visualization...")
    html_path = os.path.join(args.output_dir, '_claim_distribution.html')
    report_path = os.path.join(args.output_dir, '_claim_distribution_report.json')

    generate_html(claim_2d, claims, node_2d, node_ids, node_labels,
                  density, recommendations, html_path)
    print(f"  HTML visualization: {html_path}")

    report = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'golden_set': args.golden_set,
        'tsne_perplexity': effective_perplexity,
        'tsne_kl_divergence': round(float(tsne.kl_divergence_), 4),
        'total_claims': n_claims,
        'total_nodes': len(node_ids),
        'density_by_pov': density,
        'recommendations': recommendations,
    }
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"  Report JSON: {report_path}")

    print(f"\n{'=' * 60}")
    print(f"  Done. Open {html_path} in a browser to explore.")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
