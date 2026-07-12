"""t/1534: crux-discovery-density vs existing scheduler-importance proxies.

Reuses the t/1275 method: crux-linkage counts from aggregated-cruxes.json,
cross-referenced against candidate scheduler-importance terms. Answers whether
crux-density is COMPLEMENTARY (adds information) or REDUNDANT (tracks an existing
proxy, chiefly degree_centrality) to the corroboration-design.md importance formula:

    importance = 0.35*degree_centrality + 0.25*policy_linkage
               + 0.20*doctrinal_anchor + 0.20*usage_frequency
"""
import json
from collections import Counter
from pathlib import Path
import statistics

DATA = Path(r"C:\Users\jsnov\repos\ai-triad-data")


def load_nodes():
    nodes = {}
    for f in ["accelerationist.json", "safetyist.json", "skeptic.json", "situations.json"]:
        d = json.loads((DATA / "taxonomy" / "Origin" / f).read_text(encoding="utf-8"))
        ns = d.get("nodes", d if isinstance(d, list) else [])
        if isinstance(ns, dict):
            ns = list(ns.values())
        for n in ns:
            if isinstance(n, dict) and n.get("id"):
                nodes[n["id"]] = n
    return nodes


def spearman(x, y):
    """Spearman rho via rank-Pearson, no scipy."""
    def rank(vals):
        order = sorted(range(len(vals)), key=lambda i: vals[i])
        r = [0.0] * len(vals)
        i = 0
        while i < len(vals):
            j = i
            while j + 1 < len(vals) and vals[order[j + 1]] == vals[order[i]]:
                j += 1
            avg = (i + j) / 2.0 + 1
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r
    rx, ry = rank(x), rank(y)
    n = len(x)
    mx, my = sum(rx) / n, sum(ry) / n
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    sx = (sum((a - mx) ** 2 for a in rx)) ** 0.5
    sy = (sum((b - my) ** 2 for b in ry)) ** 0.5
    return cov / (sx * sy) if sx and sy else 0.0


def main():
    nodes = load_nodes()
    print(f"loaded {len(nodes)} taxonomy nodes")

    # crux density
    cruxes = json.loads((DATA / "taxonomy" / "Origin" / "aggregated-cruxes.json").read_text(encoding="utf-8"))["cruxes"]
    crux_density = Counter()
    for c in cruxes:
        for nid in c.get("linked_node_ids", []):
            crux_density[nid] += 1

    # degree centrality from edges.json
    edges = json.loads((DATA / "taxonomy" / "Origin" / "edges.json").read_text(encoding="utf-8"))
    edge_list = edges.get("edges", edges if isinstance(edges, list) else [])
    degree = Counter()
    for e in edge_list:
        if not isinstance(e, dict):
            continue
        s, t = e.get("source"), e.get("target")
        if s:
            degree[s] += 1
        if t:
            degree[t] += 1

    # proxies per node
    def policy_linkage(n):
        ga = n.get("graph_attributes", {}) or {}
        pa = ga.get("policy_actions") or n.get("policy_actions") or []
        return len(pa) if isinstance(pa, list) else 0

    def usage_frequency(n):
        dr = n.get("debate_refs") or []
        return len(dr) if isinstance(dr, list) else 0

    ids = list(nodes.keys())
    cd = [crux_density.get(i, 0) for i in ids]
    dg = [degree.get(i, 0) for i in ids]
    pl = [policy_linkage(nodes[i]) for i in ids]
    uf = [usage_frequency(nodes[i]) for i in ids]

    print("\n=== coverage ===")
    print(f"nodes with >=1 crux link: {sum(1 for v in cd if v>0)} / {len(ids)} ({100*sum(1 for v in cd if v>0)/len(ids):.1f}%)")
    print(f"nodes with >=1 edge:      {sum(1 for v in dg if v>0)} / {len(ids)}")
    print(f"nodes with policy_actions:{sum(1 for v in pl if v>0)} / {len(ids)}")
    print(f"nodes with debate_refs:   {sum(1 for v in uf if v>0)} / {len(ids)}")

    print("\n=== Spearman rho of crux-density vs existing importance proxies ===")
    print(f"crux_density ~ degree_centrality : {spearman(cd, dg):+.3f}")
    print(f"crux_density ~ policy_linkage    : {spearman(cd, pl):+.3f}")
    print(f"crux_density ~ usage_frequency   : {spearman(cd, uf):+.3f}")
    print(f"(reference) degree ~ usage_freq  : {spearman(dg, uf):+.3f}")

    # among crux-linked nodes only, how many are LOW degree (would be missed by degree term)?
    linked = [(i, crux_density[i], degree.get(i, 0)) for i in ids if crux_density.get(i, 0) > 0]
    linked.sort(key=lambda t: -t[1])
    deg_vals = sorted([degree.get(i, 0) for i in ids])
    med_deg = statistics.median(deg_vals)
    hi_crux_lo_deg = [t for t in linked if t[1] >= 5 and t[2] <= med_deg]
    print(f"\nmedian node degree = {med_deg}")
    print(f"nodes with HIGH crux-density (>=5) but <=median degree "
          f"(disagreement hubs the degree term would under-rank): {len(hi_crux_lo_deg)}")
    for i, c, dgv in hi_crux_lo_deg[:12]:
        print(f"  {i}: crux={c} degree={dgv}")


if __name__ == "__main__":
    main()
