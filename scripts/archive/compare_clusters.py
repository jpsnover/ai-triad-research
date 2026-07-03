#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""
compare_clusters.py — Compare old vs new embedding clusters for a POV+category bucket.

Produces an HTML report showing side-by-side cluster assignments with
changed items highlighted.

Usage:
  python compare_clusters.py --pov safetyist --category Intentions
  python compare_clusters.py --pov safetyist --category Beliefs --max-clusters 8
  python compare_clusters.py --all   # run all POV+category combos
"""

import argparse
import json
import html
import re
import sys
import webbrowser
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

_SCRIPT_DIR = Path(__file__).resolve().parent
_DEFAULT_DATA = _SCRIPT_DIR.parent.parent / "ai-triad-data" / "taxonomy" / "Origin"

POVS = ["accelerationist", "safetyist", "skeptic"]
CATEGORIES = ["Beliefs", "Desires", "Intentions"]


def load_embeddings(path):
    """Load embeddings.json and return {node_id: np.array}."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    emb = {}
    for nid, entry in data.get("nodes", {}).items():
        emb[nid] = np.array(entry["vector"], dtype=np.float32)
    return emb, data.get("field_weights")


def load_taxonomy(data_dir):
    """Load all POV taxonomy files, return {node_id: node_dict}."""
    nodes = {}
    for pov in POVS:
        path = Path(data_dir) / f"{pov}.json"
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for n in data.get("nodes", []):
            n["_pov"] = pov
            nodes[n["id"]] = n
    return nodes


def get_bucket(nodes, pov, category):
    """Filter nodes to a specific POV + category bucket."""
    return {nid: n for nid, n in nodes.items()
            if n["_pov"] == pov and n.get("category") == category}


def cluster_nodes(node_ids, embeddings, max_clusters=8, min_similarity=0.55):
    """Agglomerative clustering (average linkage) matching the PS implementation."""
    # Filter to nodes that have embeddings
    ids = [nid for nid in node_ids if nid in embeddings]
    if len(ids) < 2:
        return [ids] if ids else []

    vecs = np.array([embeddings[nid] for nid in ids], dtype=np.float32)
    # Cosine similarity matrix (vectors are normalized)
    sim = vecs @ vecs.T

    # Initialize: each node in its own cluster
    clusters = [[i] for i in range(len(ids))]
    cluster_idx = list(range(len(ids)))  # which cluster each node belongs to

    while len(set(cluster_idx)) > max_clusters:
        # Find most similar pair of distinct clusters
        best_sim = -1.0
        best_i, best_j = -1, -1
        active = sorted(set(cluster_idx))

        for ai, ci in enumerate(active):
            for cj in active[ai + 1:]:
                # Average linkage
                members_i = [k for k, c in enumerate(cluster_idx) if c == ci]
                members_j = [k for k, c in enumerate(cluster_idx) if c == cj]
                total = 0.0
                count = 0
                for mi in members_i:
                    for mj in members_j:
                        total += float(sim[mi, mj])
                        count += 1
                avg = total / count if count else 0
                if avg > best_sim:
                    best_sim = avg
                    best_i, best_j = ci, cj

        if best_sim < min_similarity:
            break

        # Merge best_j into best_i
        for k in range(len(cluster_idx)):
            if cluster_idx[k] == best_j:
                cluster_idx[k] = best_i

    # Collect results
    groups = defaultdict(list)
    for k, c in enumerate(cluster_idx):
        groups[c].append(ids[k])

    return list(groups.values())


def build_cluster_map(clusters):
    """Return {node_id: cluster_index}."""
    m = {}
    for i, cluster in enumerate(clusters):
        for nid in cluster:
            m[nid] = i
    return m


# Stop words to exclude from cluster label generation
_STOP_WORDS = frozenset(
    "a an the and or but in on of to for with by from as at is are was were "
    "be been being have has had do does did will would shall should may might "
    "can could that this these those it its they them their he she his her "
    "not no nor so if then than too very also just about more most other "
    "some any all each every both few many much such only own same into "
    "over after before between through during without against within along "
    "across above below up down out off under during upon toward towards "
    "ai artificial intelligence human based driven through via using "
    "approach approaches framework frameworks system systems model models "
    "theory theories argument arguments discourse perspective perspectives "
    "focused addressing regarding concerning related".split()
)


def _describe_cluster(cluster, nodes):
    """Generate a short descriptive label for a cluster from its node labels.

    Prefers bigrams (2-word phrases) that recur across multiple node labels,
    since single words like "Safety" or "Risk" lose their meaning without
    context.  Falls back to unigrams only when no bigrams repeat.
    """
    if not cluster:
        return "Empty"
    if len(cluster) == 1:
        node = nodes.get(cluster[0], {})
        label = node.get("label", cluster[0])
        return label[:60]

    # Tokenize each label into cleaned word lists
    label_word_lists = []
    for nid in cluster:
        node = nodes.get(nid, {})
        label = node.get("label", "")
        # Split on non-alpha, keep words with 2+ chars
        words = [w for w in re.split(r"[^A-Za-z']+", label) if len(w) >= 2]
        # Normalize: keep original case for display, lowercase for counting
        label_word_lists.append(words)

    # Count bigrams (per-label, so a label only contributes once)
    bigram_freq = Counter()
    for words in label_word_lists:
        seen = set()
        filtered = [w for w in words if w.lower() not in _STOP_WORDS]
        for i in range(len(filtered) - 1):
            bg = f"{filtered[i]} {filtered[i+1]}"
            bg_lower = bg.lower()
            if bg_lower not in seen:
                seen.add(bg_lower)
                bigram_freq[bg_lower] += 1

    # Count unigrams as fallback
    unigram_freq = Counter()
    for words in label_word_lists:
        seen = set()
        for w in words:
            wl = w.lower()
            if wl not in _STOP_WORDS and wl not in seen:
                seen.add(wl)
                unigram_freq[wl] += 1

    threshold = max(2, len(cluster) * 0.25)

    # Try bigrams first
    common_bigrams = [(bg, c) for bg, c in bigram_freq.most_common(15) if c >= threshold]

    selected = []
    used_words = set()

    for bg, c in common_bigrams:
        if len(selected) >= 2:
            break
        bg_words = set(bg.split())
        # Skip if it heavily overlaps with an already-selected phrase
        if bg_words & used_words:
            continue
        selected.append(bg.title())
        used_words |= bg_words

    # Fill remaining slots with unigrams (up to 3 total terms)
    if len(selected) < 3:
        common_unigrams = [(w, c) for w, c in unigram_freq.most_common(15) if c >= threshold]
        for w, c in common_unigrams:
            if len(selected) >= 3:
                break
            if w in used_words:
                continue
            selected.append(w.title())
            used_words.add(w)

    if not selected:
        # Last resort: top 2 unigrams regardless of threshold
        for w, c in unigram_freq.most_common(2):
            selected.append(w.title())

    return " / ".join(selected) if selected else f"{len(cluster)} nodes"


def _format_weights(weights):
    """Format a field_weights dict as a compact string, omitting zero-weight fields."""
    if not weights:
        return "unknown"
    parts = []
    for field, w in weights.items():
        if isinstance(w, (int, float)) and w > 0:
            parts.append(f"{field} {w:.0%}")
    return ", ".join(parts) if parts else "unknown"


def generate_html(pov, category, nodes, old_clusters, new_clusters, old_weights, new_weights):
    """Generate an HTML comparison view for one bucket."""
    old_map = build_cluster_map(old_clusters)
    new_map = build_cluster_map(new_clusters)

    all_ids = sorted(set(list(old_map.keys()) + list(new_map.keys())))

    # Find changed nodes: different cluster neighbors
    def get_neighbors(nid, cmap, clusters):
        """Get set of node IDs in the same cluster as nid."""
        if nid not in cmap:
            return set()
        ci = cmap[nid]
        return set(clusters[ci]) - {nid}

    changed_ids = set()
    for nid in all_ids:
        old_n = get_neighbors(nid, old_map, old_clusters)
        new_n = get_neighbors(nid, new_map, new_clusters)
        if old_n != new_n:
            changed_ids.add(nid)

    # Assign colors to clusters
    colors_old = [
        "#2d4a7a", "#5a2d5e", "#2d5a3a", "#6b4a2d", "#2d5a5a",
        "#5a4a2d", "#3a2d6b", "#6b2d4a", "#2d6b5a", "#4a5a2d",
        "#5a2d3a", "#2d3a6b", "#6b5a2d", "#3a6b2d", "#2d6b3a",
    ]
    colors_new = [
        "#1a6b3a", "#6b1a3a", "#1a3a6b", "#6b6b1a", "#3a1a6b",
        "#1a6b6b", "#6b3a1a", "#3a6b1a", "#6b1a6b", "#1a6b1a",
        "#4a1a6b", "#6b4a1a", "#1a4a6b", "#6b1a4a", "#4a6b1a",
    ]

    def cluster_color(ci, palette):
        return palette[ci % len(palette)] if ci is not None else "#444"

    # Build HTML
    lines = []
    lines.append("""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Cluster Comparison: {pov} {cat}</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, 'Segoe UI', sans-serif; background: #1e1e1e; color: #ccc; padding: 20px; }}
  h1 {{ color: #fff; margin-bottom: 4px; font-size: 1.4rem; }}
  .subtitle {{ color: #888; margin-bottom: 20px; font-size: 0.85rem; }}
  .stats {{ display: flex; gap: 24px; margin-bottom: 20px; }}
  .stat {{ background: #252526; padding: 12px 16px; border-radius: 6px; }}
  .stat-label {{ font-size: 0.72rem; color: #888; text-transform: uppercase; }}
  .stat-value {{ font-size: 1.3rem; font-weight: 600; color: #fff; }}
  .columns {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }}
  .column {{ background: #252526; border-radius: 8px; padding: 16px; }}
  .column h2 {{ font-size: 1rem; margin-bottom: 12px; color: #ddd; }}
  .cluster {{ margin-bottom: 16px; }}
  .cluster-header {{ font-size: 0.78rem; font-weight: 600; padding: 6px 10px; border-radius: 4px; margin-bottom: 4px; color: #fff; display: flex; justify-content: space-between; align-items: baseline; }}
  .cluster-header .cluster-theme {{ font-weight: 400; font-size: 0.85rem; }}
  .cluster-header .cluster-meta {{ font-weight: 400; font-size: 0.7rem; opacity: 0.7; white-space: nowrap; margin-left: 12px; }}
  .node {{ padding: 4px 8px 4px 16px; font-size: 0.8rem; border-left: 3px solid transparent; margin-bottom: 2px; border-radius: 2px; cursor: pointer; transition: background 0.15s; }}
  .node:hover {{ background: rgba(255,255,255,0.05); }}
  .node.changed {{ background: rgba(255, 200, 50, 0.15); border-left-color: #ffc832; }}
  .node.changed:hover {{ background: rgba(255, 200, 50, 0.22); }}
  .node.cross-highlight {{ background: rgba(100, 180, 255, 0.25); border-left-color: #64b4ff; }}
  .node.cross-highlight.changed {{ background: rgba(100, 180, 255, 0.25); border-left-color: #64b4ff; }}
  .node .node-row {{ display: flex; align-items: baseline; gap: 6px; }}
  .node .node-id {{ color: #666; font-size: 0.7rem; }}
  .node .node-label {{ color: #ccc; }}
  .node .node-toggle {{ color: #555; font-size: 0.65rem; flex-shrink: 0; transition: transform 0.15s; }}
  .node.expanded .node-toggle {{ transform: rotate(90deg); }}
  .node-desc {{ display: none; margin-top: 4px; padding: 6px 8px; font-size: 0.75rem; line-height: 1.45; color: #999; background: rgba(0,0,0,0.25); border-radius: 3px; }}
  .node.expanded .node-desc {{ display: block; }}
  .legend {{ margin-top: 20px; font-size: 0.78rem; color: #888; }}
  .legend-item {{ display: inline-flex; align-items: center; gap: 6px; margin-right: 16px; }}
  .legend-swatch {{ width: 12px; height: 12px; border-radius: 2px; }}
</style>
<script>
document.addEventListener('click', function(e) {{
  var node = e.target.closest('.node');
  if (!node) return;

  // Toggle expand
  node.classList.toggle('expanded');

  // Cross-column highlight: find same node in the other column
  var nodeId = node.getAttribute('data-node-id');
  if (!nodeId) return;

  // Clear all previous cross-highlights
  document.querySelectorAll('.node.cross-highlight').forEach(function(el) {{
    el.classList.remove('cross-highlight');
  }});

  // Find the matching node in the other column
  var thisColumn = node.closest('.column');
  var allColumns = document.querySelectorAll('.column');
  allColumns.forEach(function(col) {{
    if (col === thisColumn) return;
    var match = col.querySelector('.node[data-node-id="' + nodeId + '"]');
    if (match) {{
      match.classList.add('cross-highlight');
      match.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
    }}
  }});
}});
</script>
</head><body>
<h1>Cluster Comparison: {pov} / {cat}</h1>
<div class="subtitle">Old weights: {old_w} | New weights: {new_w}</div>
<div class="subtitle" style="margin-top:4px;color:#6ba3d6">Click any node to highlight its position in the other column</div>
""".format(
        pov=pov.title(), cat=category,
        old_w=_format_weights(old_weights),
        new_w=_format_weights(new_weights),
    ))

    # Stats
    lines.append('<div class="stats">')
    lines.append(f'<div class="stat"><div class="stat-label">Nodes</div><div class="stat-value">{len(all_ids)}</div></div>')
    lines.append(f'<div class="stat"><div class="stat-label">Old Clusters</div><div class="stat-value">{len(old_clusters)}</div></div>')
    lines.append(f'<div class="stat"><div class="stat-label">New Clusters</div><div class="stat-value">{len(new_clusters)}</div></div>')
    lines.append(f'<div class="stat"><div class="stat-label">Moved Nodes</div><div class="stat-value">{len(changed_ids)}</div></div>')
    pct = (len(changed_ids) / len(all_ids) * 100) if all_ids else 0
    lines.append(f'<div class="stat"><div class="stat-label">Change %</div><div class="stat-value">{pct:.0f}%</div></div>')
    lines.append('</div>')

    # Two columns
    lines.append('<div class="columns">')

    for side, clusters, palette, label in [
        ("old", old_clusters, colors_old, "Old Clusters"),
        ("new", new_clusters, colors_new, "New Clusters"),
    ]:
        lines.append(f'<div class="column"><h2>{label}</h2>')
        for ci, cluster in enumerate(clusters):
            color = cluster_color(ci, palette)
            theme = html.escape(_describe_cluster(cluster, nodes))
            lines.append(f'<div class="cluster">')
            lines.append(f'<div class="cluster-header" style="background:{color}"><span class="cluster-theme">{theme}</span><span class="cluster-meta">{len(cluster)} nodes</span></div>')
            for nid in sorted(cluster):
                node = nodes.get(nid, {})
                node_label = html.escape(node.get("label", nid))
                node_desc = html.escape(node.get("description", "") or "No description available.")
                is_changed = "changed" if nid in changed_ids else ""
                lines.append(
                    f'<div class="node {is_changed}" data-node-id="{html.escape(nid)}">'
                    f'<div class="node-row"><span class="node-toggle">&#9654;</span>'
                    f'<span class="node-id">{html.escape(nid)}</span> '
                    f'<span class="node-label">{node_label}</span></div>'
                    f'<div class="node-desc">{node_desc}</div>'
                    f'</div>'
                )
            lines.append('</div>')
        lines.append('</div>')

    lines.append('</div>')

    # Legend
    lines.append('<div class="legend">')
    lines.append('<div class="legend-item"><div class="legend-swatch" style="background:rgba(255,200,50,0.15);border:1px solid #ffc832"></div> Node moved to different cluster neighbors</div>')
    lines.append('<div class="legend-item"><div class="legend-swatch" style="background:rgba(100,180,255,0.25);border:1px solid #64b4ff"></div> Cross-column highlight (click a node to locate it)</div>')
    lines.append('</div>')
    lines.append('</body></html>')

    return "\n".join(lines)


def run_comparison(pov, category, data_dir, old_emb_path, new_emb_path, max_clusters, min_similarity, output_dir):
    """Run one bucket comparison and write HTML."""
    nodes = load_taxonomy(data_dir)
    bucket = get_bucket(nodes, pov, category)

    if not bucket:
        print(f"  Skipping {pov}/{category}: no nodes", file=sys.stderr)
        return None

    old_emb, old_weights = load_embeddings(old_emb_path)
    new_emb, new_weights = load_embeddings(new_emb_path)

    node_ids = sorted(bucket.keys())
    print(f"  {pov}/{category}: {len(node_ids)} nodes", file=sys.stderr)

    old_clusters = cluster_nodes(node_ids, old_emb, max_clusters, min_similarity)
    new_clusters = cluster_nodes(node_ids, new_emb, max_clusters, min_similarity)

    html_content = generate_html(pov, category, nodes, old_clusters, new_clusters, old_weights, new_weights)

    out_path = Path(output_dir) / f"compare_{pov}_{category.lower()}.html"
    out_path.write_text(html_content, encoding="utf-8")
    print(f"  Wrote {out_path}", file=sys.stderr)
    return out_path


def generate_index(output_dir, files):
    """Generate an index.html linking to all comparison pages."""
    lines = ["""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Embedding Cluster Comparison</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', sans-serif; background: #1e1e1e; color: #ccc; padding: 40px; }
  h1 { color: #fff; margin-bottom: 20px; }
  a { color: #4fc3f7; text-decoration: none; font-size: 1.1rem; }
  a:hover { text-decoration: underline; }
  .link { padding: 8px 0; }
</style>
</head><body>
<h1>Embedding Cluster Comparison</h1>
<p style="color:#888;margin-bottom:24px">Old vs New embedding weights — click any node to find it in the other column</p>
"""]
    for f in sorted(files):
        name = f.stem.replace("compare_", "").replace("_", " / ").title()
        lines.append(f'<div class="link"><a href="{f.name}">{name}</a></div>')
    lines.append("</body></html>")

    idx = Path(output_dir) / "index.html"
    idx.write_text("\n".join(lines), encoding="utf-8")
    return idx


def main():
    parser = argparse.ArgumentParser(description="Compare old vs new embedding clusters")
    parser.add_argument("--pov", choices=POVS, help="POV to compare")
    parser.add_argument("--category", choices=CATEGORIES, help="BDI category")
    parser.add_argument("--all", action="store_true", help="Compare all POV+category combos")
    parser.add_argument("--data-dir", default=str(_DEFAULT_DATA), help="Taxonomy data directory")
    parser.add_argument("--old-embeddings", default="/tmp/old_embeddings.json", help="Path to old embeddings.json")
    parser.add_argument("--new-embeddings", default=str(_DEFAULT_DATA / "embeddings.json"), help="Path to new embeddings.json")
    parser.add_argument("--max-clusters", type=int, default=8, help="Max clusters per bucket")
    parser.add_argument("--min-similarity", type=float, default=0.55, help="Min similarity for merging")
    parser.add_argument("--output-dir", default=str(_SCRIPT_DIR.parent / "tmp" / "cluster-compare"), help="Output directory for HTML")
    parser.add_argument("--open", action="store_true", help="Open result in browser")
    args = parser.parse_args()

    if not args.all and not (args.pov and args.category):
        parser.error("Specify --pov and --category, or use --all")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.all:
        files = []
        for pov in POVS:
            for cat in CATEGORIES:
                result = run_comparison(pov, cat, args.data_dir, args.old_embeddings, args.new_embeddings,
                                        args.max_clusters, args.min_similarity, output_dir)
                if result:
                    files.append(result)
        idx = generate_index(output_dir, files)
        print(f"\nIndex: {idx}", file=sys.stderr)
        if args.open:
            webbrowser.open(str(idx))
    else:
        result = run_comparison(args.pov, args.category, args.data_dir, args.old_embeddings, args.new_embeddings,
                                args.max_clusters, args.min_similarity, output_dir)
        if result and args.open:
            webbrowser.open(str(result))


if __name__ == "__main__":
    main()
