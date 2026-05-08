#!/usr/bin/env python3
"""
Cross-validation script for POV taxonomy graph_attributes.
Phase 2 of the quality pass (t/421).

Reads all POV taxonomy files and flags anomalies across 11 attribute fields.
Outputs a per-node anomaly report with severity levels.

Usage:
    python3 validate-graph-attributes.py [--data-root /path/to/ai-triad-data]
"""

import json
import re
import sys
import os
from collections import Counter, defaultdict
from pathlib import Path

# ── Configuration ──

DATA_ROOT = os.environ.get(
    'AI_TRIAD_DATA_ROOT',
    str(Path(__file__).resolve().parents[3] / '..' / 'ai-triad-data')
)

CANONICAL_EPISTEMIC_TYPES = {
    'empirical_claim', 'normative_prescription', 'strategic_recommendation',
    'predictive', 'definitional', 'interpretive_lens',
}

CANONICAL_RHETORICAL_STRATEGIES = {
    'precautionary_framing', 'structural_critique', 'moral_imperative',
    'techno_optimism', 'cost_benefit_analysis', 'appeal_to_evidence',
    'inevitability_framing', 'analogical_reasoning', 'reductio_ad_absurdum',
    'pragmatic_framing',
}

CANONICAL_NODE_SCOPES = {'claim', 'scheme', 'bridging'}

# BDI × epistemic_type expected mapping
BDI_EPISTEMIC_EXPECTED = {
    'Beliefs': {'empirical_claim', 'predictive', 'definitional', 'interpretive_lens'},
    'Desires': {'normative_prescription', 'definitional', 'interpretive_lens'},
    'Intentions': {'strategic_recommendation', 'interpretive_lens', 'empirical_claim'},
}

# BDI × falsifiability expected mapping
BDI_FALSIFIABILITY_EXPECTED = {
    'Beliefs': {'high', 'medium'},      # Beliefs should generally be testable
    'Desires': {'low', 'medium'},        # Normative commitments are less testable
    'Intentions': {'medium', 'high'},    # Strategies have testable implications
}

# Epistemic type × falsifiability cross-check
EPISTEMIC_FALSIFIABILITY_EXPECTED = {
    'empirical_claim': {'high', 'medium'},
    'normative_prescription': {'low', 'medium'},
    'strategic_recommendation': {'medium', 'high'},
    'predictive': {'high', 'medium'},
    'definitional': {'low', 'medium'},
    'interpretive_lens': {'low', 'medium'},
}

# Linguistic markers for epistemic type verification
EPISTEMIC_MARKERS = {
    'normative_prescription': [r'\bshould\b', r'\bought\b', r'\bmust\b', r'\bobligation\b', r'\bduty\b', r'\bimperative\b'],
    'predictive': [r'\bwill\b', r'\bby 20\d\d\b', r'\blikely to\b', r'\btrend\b', r'\bforecast\b', r'\bproject\b'],
    'definitional': [r'\bdefined as\b', r'\brefers to\b', r'\bthe concept of\b', r'\bmeans\b', r'\bclassif'],
    'strategic_recommendation': [r'\bapproach\b', r'\bstrategy\b', r'\bmethod\b', r'\bimplement\b', r'\bframework\b', r'\bpolicy\b'],
    'empirical_claim': [r'\bevidence\b', r'\bstud(?:y|ies)\b', r'\bdata\b', r'\bobserved\b', r'\bdemonstrat'],
    'interpretive_lens': [r'\blens\b', r'\bperspective\b', r'\bway of (?:seeing|understanding)\b', r'\bframing\b'],
}


class Anomaly:
    def __init__(self, field: str, severity: str, category: str, message: str):
        self.field = field
        self.severity = severity  # 'error', 'warning', 'info'
        self.category = category  # 'vocabulary', 'cross-validation', 'format', 'missing', 'marker'
        self.message = message

    def __repr__(self):
        return f"[{self.severity.upper()}] {self.field}: {self.message}"


def load_taxonomy(data_root: str) -> list[dict]:
    """Load all POV taxonomy nodes."""
    nodes = []
    tax_dir = Path(data_root) / 'taxonomy' / 'Origin'
    for pov_file in ['accelerationist.json', 'safetyist.json', 'skeptic.json']:
        fpath = tax_dir / pov_file
        if not fpath.exists():
            print(f"WARNING: {fpath} not found", file=sys.stderr)
            continue
        with open(fpath) as f:
            data = json.load(f)
        for node in data['nodes']:
            node['_pov_file'] = pov_file
            nodes.append(node)
    return nodes


def validate_node(node: dict) -> list[Anomaly]:
    """Validate a single node's graph_attributes. Returns list of anomalies."""
    anomalies = []
    nid = node.get('id', '?')
    cat = node.get('category', '')
    desc = node.get('description', '')
    ga = node.get('graph_attributes', {})

    if not isinstance(ga, dict) or len(ga) == 0:
        anomalies.append(Anomaly('graph_attributes', 'error', 'missing',
                                 'No graph_attributes — needs full extraction'))
        return anomalies

    # ── epistemic_type ──
    et = ga.get('epistemic_type', '')
    if not et:
        anomalies.append(Anomaly('epistemic_type', 'error', 'missing', 'Empty'))
    elif ',' in et:
        anomalies.append(Anomaly('epistemic_type', 'error', 'format',
                                 f'Compound value "{et}" — should be single'))
    elif et not in CANONICAL_EPISTEMIC_TYPES:
        anomalies.append(Anomaly('epistemic_type', 'error', 'vocabulary',
                                 f'Non-canonical value "{et}"'))
    else:
        # Cross-validate against BDI category
        if cat and cat in BDI_EPISTEMIC_EXPECTED:
            if et not in BDI_EPISTEMIC_EXPECTED[cat]:
                anomalies.append(Anomaly('epistemic_type', 'warning', 'cross-validation',
                                         f'"{et}" unusual for {cat} category'))

        # Cross-validate against falsifiability
        fals = ga.get('falsifiability', '')
        if fals and et in EPISTEMIC_FALSIFIABILITY_EXPECTED:
            if fals not in EPISTEMIC_FALSIFIABILITY_EXPECTED[et]:
                anomalies.append(Anomaly('epistemic_type', 'warning', 'cross-validation',
                                         f'"{et}" with falsifiability="{fals}" is unusual'))

        # Linguistic marker check
        marker_scores = {}
        desc_lower = desc.lower()
        for etype, patterns in EPISTEMIC_MARKERS.items():
            score = sum(1 for p in patterns if re.search(p, desc_lower))
            if score > 0:
                marker_scores[etype] = score
        if marker_scores:
            best_marker = max(marker_scores, key=marker_scores.get)
            if best_marker != et and marker_scores[best_marker] >= 2:
                anomalies.append(Anomaly('epistemic_type', 'info', 'marker',
                                         f'Linguistic markers suggest "{best_marker}" '
                                         f'(score {marker_scores[best_marker]}) '
                                         f'but assigned "{et}"'))

    # ── rhetorical_strategy ──
    rs = ga.get('rhetorical_strategy', '')
    if not rs:
        anomalies.append(Anomaly('rhetorical_strategy', 'error', 'missing', 'Empty'))
    else:
        strategies = [s.strip() for s in rs.split(',')]
        for s in strategies:
            if s not in CANONICAL_RHETORICAL_STRATEGIES:
                # Check if it's from another field's vocabulary
                if s in CANONICAL_EPISTEMIC_TYPES:
                    anomalies.append(Anomaly('rhetorical_strategy', 'error', 'vocabulary',
                                             f'"{s}" is an epistemic_type, not a rhetorical strategy'))
                elif s in {'aspirational', 'cautionary', 'measured', 'pragmatic',
                           'alarmed', 'urgent', 'optimistic', 'defiant'}:
                    anomalies.append(Anomaly('rhetorical_strategy', 'error', 'vocabulary',
                                             f'"{s}" is an emotional_register, not a rhetorical strategy'))
                elif s in {'aspirational_framing'}:
                    anomalies.append(Anomaly('rhetorical_strategy', 'warning', 'vocabulary',
                                             f'"{s}" not canonical — did you mean a canonical strategy?'))
                else:
                    anomalies.append(Anomaly('rhetorical_strategy', 'warning', 'vocabulary',
                                             f'"{s}" not in canonical set'))
        if len(strategies) > 2:
            anomalies.append(Anomaly('rhetorical_strategy', 'warning', 'format',
                                     f'{len(strategies)} strategies — prompt allows max 2'))

    # ── falsifiability ──
    fals = ga.get('falsifiability', '')
    if not fals:
        anomalies.append(Anomaly('falsifiability', 'error', 'missing', 'Empty'))
    elif fals not in {'low', 'medium', 'high'}:
        anomalies.append(Anomaly('falsifiability', 'error', 'vocabulary',
                                 f'Non-canonical value "{fals}"'))
    else:
        # Cross-validate against BDI
        if cat and cat in BDI_FALSIFIABILITY_EXPECTED:
            if fals not in BDI_FALSIFIABILITY_EXPECTED[cat]:
                anomalies.append(Anomaly('falsifiability', 'info', 'cross-validation',
                                         f'"{fals}" unusual for {cat} category'))

    # ── node_scope ──
    ns = ga.get('node_scope', '')
    if not ns:
        anomalies.append(Anomaly('node_scope', 'error', 'missing', 'Empty'))
    elif ns not in CANONICAL_NODE_SCOPES:
        if ns == 'interpretive_lens':
            anomalies.append(Anomaly('node_scope', 'error', 'vocabulary',
                                     '"interpretive_lens" is not a valid node_scope '
                                     '(valid: claim, scheme, bridging) — likely leaked from epistemic_type'))
        else:
            anomalies.append(Anomaly('node_scope', 'error', 'vocabulary',
                                     f'Non-canonical value "{ns}"'))

    # ── assumes ──
    assumes = ga.get('assumes', [])
    if not assumes:
        anomalies.append(Anomaly('assumes', 'warning', 'missing', 'Empty'))
    elif isinstance(assumes, list):
        for i, a in enumerate(assumes):
            if not isinstance(a, str):
                anomalies.append(Anomaly('assumes', 'error', 'format',
                                         f'Entry {i} is {type(a).__name__}, not string'))
            elif len(a) < 20:
                anomalies.append(Anomaly('assumes', 'warning', 'format',
                                         f'Entry {i} very short ({len(a)} chars): "{a}"'))

    # ── intellectual_lineage ──
    il = ga.get('intellectual_lineage', [])
    if not il:
        anomalies.append(Anomaly('intellectual_lineage', 'warning', 'missing', 'Empty'))
    elif isinstance(il, list):
        has_strings = any(isinstance(x, str) for x in il)
        has_objects = any(isinstance(x, dict) for x in il)
        if has_strings and has_objects:
            anomalies.append(Anomaly('intellectual_lineage', 'info', 'format',
                                     'Mixed string and object entries'))
        elif has_strings:
            anomalies.append(Anomaly('intellectual_lineage', 'info', 'format',
                                     'All entries are strings (object format preferred)'))

    # ── audience ──
    aud = ga.get('audience', '')
    if not aud:
        anomalies.append(Anomaly('audience', 'warning', 'missing', 'Empty'))

    # ── emotional_register ──
    er = ga.get('emotional_register', '')
    if not er:
        anomalies.append(Anomaly('emotional_register', 'warning', 'missing', 'Empty'))
    elif ',' in er:
        anomalies.append(Anomaly('emotional_register', 'info', 'format',
                                 f'Compound value "{er}"'))

    # ── steelman_vulnerability ──
    sv = ga.get('steelman_vulnerability')
    if sv is None:
        anomalies.append(Anomaly('steelman_vulnerability', 'warning', 'missing', 'Empty'))
    elif isinstance(sv, dict):
        anomalies.append(Anomaly('steelman_vulnerability', 'error', 'format',
                                 f'Dict format (should be string) — keys: {list(sv.keys())}'))

    # ── possible_fallacies ──
    pf = ga.get('possible_fallacies', [])
    if isinstance(pf, list):
        for i, f in enumerate(pf):
            if isinstance(f, dict):
                fname = f.get('fallacy', '')
                # Check naming consistency
                if fname and fname != fname.lower():
                    anomalies.append(Anomaly('possible_fallacies', 'error', 'format',
                                             f'Entry {i} uses title case: "{fname}" — should be snake_case'))
                # Check vocabulary leakage
                if fname in CANONICAL_RHETORICAL_STRATEGIES:
                    anomalies.append(Anomaly('possible_fallacies', 'error', 'vocabulary',
                                             f'Entry {i} "{fname}" is a rhetorical strategy, not a fallacy'))
                conf = f.get('confidence', '')
                if conf not in {'likely', 'possible', 'borderline', ''}:
                    anomalies.append(Anomaly('possible_fallacies', 'warning', 'vocabulary',
                                             f'Entry {i} confidence "{conf}" not in expected set'))

    # ── policy_actions ──
    pa = ga.get('policy_actions', [])
    # Lightweight check — just verify structure
    if isinstance(pa, list):
        for i, p in enumerate(pa):
            if isinstance(p, dict):
                if 'action' not in p:
                    anomalies.append(Anomaly('policy_actions', 'warning', 'format',
                                             f'Entry {i} missing "action" field'))

    return anomalies


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Validate POV taxonomy graph_attributes')
    parser.add_argument('--data-root', default=DATA_ROOT, help='Path to ai-triad-data')
    parser.add_argument('--json', action='store_true', help='Output JSON instead of text')
    parser.add_argument('--summary-only', action='store_true', help='Only print summary stats')
    args = parser.parse_args()

    nodes = load_taxonomy(args.data_root)
    print(f"Loaded {len(nodes)} POV nodes", file=sys.stderr)

    # Run validation
    all_results = {}
    severity_counts = Counter()
    field_counts = defaultdict(Counter)
    category_counts = Counter()

    for node in nodes:
        nid = node.get('id', '?')
        anomalies = validate_node(node)
        if anomalies:
            all_results[nid] = anomalies
            for a in anomalies:
                severity_counts[a.severity] += 1
                field_counts[a.field][a.severity] += 1
                category_counts[a.category] += 1

    # ── Summary ──
    total_anomalies = sum(severity_counts.values())
    nodes_with_issues = len(all_results)
    clean_nodes = len(nodes) - nodes_with_issues

    print(f"\n{'='*70}")
    print(f"GRAPH ATTRIBUTES CROSS-VALIDATION REPORT")
    print(f"{'='*70}")
    print(f"Nodes scanned:     {len(nodes)}")
    print(f"Clean nodes:       {clean_nodes} ({clean_nodes/len(nodes)*100:.0f}%)")
    print(f"Nodes with issues: {nodes_with_issues} ({nodes_with_issues/len(nodes)*100:.0f}%)")
    print(f"Total anomalies:   {total_anomalies}")
    print(f"  Errors:   {severity_counts['error']}")
    print(f"  Warnings: {severity_counts['warning']}")
    print(f"  Info:     {severity_counts['info']}")

    print(f"\n--- By Field ---")
    for field in sorted(field_counts.keys()):
        counts = field_counts[field]
        total = sum(counts.values())
        parts = ', '.join(f"{sev}={cnt}" for sev, cnt in sorted(counts.items()))
        print(f"  {field:30s}: {total:4d} ({parts})")

    print(f"\n--- By Category ---")
    for cat, cnt in category_counts.most_common():
        print(f"  {cat:20s}: {cnt:4d}")

    if not args.summary_only:
        # ── Per-node details (errors and warnings only) ──
        print(f"\n{'='*70}")
        print(f"PER-NODE ANOMALIES (errors and warnings)")
        print(f"{'='*70}")

        # Sort by severity count (most errors first)
        def node_severity_score(nid):
            return sum(3 if a.severity == 'error' else 1 for a in all_results[nid])

        for nid in sorted(all_results.keys(), key=node_severity_score, reverse=True):
            anomalies = all_results[nid]
            errors_warnings = [a for a in anomalies if a.severity in ('error', 'warning')]
            if not errors_warnings:
                continue
            node = next(n for n in nodes if n.get('id') == nid)
            label = node.get('label', '?')
            cat = node.get('category', '?')
            print(f"\n  {nid} ({cat}) — {label}")
            for a in errors_warnings:
                marker = 'E' if a.severity == 'error' else 'W'
                print(f"    [{marker}] {a.field}: {a.message}")

    if args.json:
        # Also write full JSON report
        json_report = {}
        for nid, anomalies in all_results.items():
            json_report[nid] = [
                {'field': a.field, 'severity': a.severity,
                 'category': a.category, 'message': a.message}
                for a in anomalies
            ]
        report_path = Path(args.data_root) / 'taxonomy' / 'Origin' / '_attribute_validation_report.json'
        with open(report_path, 'w') as f:
            json.dump(json_report, f, indent=2)
        print(f"\nJSON report written to: {report_path}", file=sys.stderr)


if __name__ == '__main__':
    main()
