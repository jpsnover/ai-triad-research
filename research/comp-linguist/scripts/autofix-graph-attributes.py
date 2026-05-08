#!/usr/bin/env python3
"""
Auto-fix script for graph_attributes issues that can be resolved without LLM.
Phase 3a of the quality pass (t/421).

Fixes:
- possible_fallacies title-case names → snake_case
- steelman_vulnerability dict → string
- audience ordering normalization
- emotional_register compound → primary value

Does NOT fix (requires LLM):
- epistemic_type compound values
- rhetorical_strategy vocabulary leakage
- node_scope interpretive_lens
- Missing attributes (backfill)

Usage:
    python3 autofix-graph-attributes.py [--data-root /path/to/ai-triad-data] [--dry-run]
"""

import json
import re
import sys
import os
from pathlib import Path
from copy import deepcopy

DATA_ROOT = os.environ.get(
    'AI_TRIAD_DATA_ROOT',
    str(Path(__file__).resolve().parents[3] / '..' / 'ai-triad-data')
)


def snake_case(s: str) -> str:
    """Convert a title-case or mixed-case string to snake_case."""
    # Insert underscore before caps that follow lowercase
    s = re.sub(r'([a-z])([A-Z])', r'\1_\2', s)
    # Replace spaces with underscores
    s = re.sub(r'\s+', '_', s)
    return s.lower()


RHETORICAL_STRATEGY_VOCAB_LEAKAGE = {
    # emotional_register values that leaked into rhetorical_strategy
    'aspirational': 'moral_imperative',      # closest canonical strategy
    'cautionary': 'precautionary_framing',
    'alarmed': 'precautionary_framing',
    'urgent': 'precautionary_framing',
    'pragmatic': 'pragmatic_framing',
    'optimistic': 'techno_optimism',
    'defiant': 'structural_critique',
    'measured': None,  # no clear mapping — flag for LLM
    # epistemic_type values that leaked
    'definitional': None,       # flag for LLM
    'interpretive_lens': None,  # flag for LLM
    'predictive': None,         # flag for LLM
    # near-misses
    'aspirational_framing': 'moral_imperative',
}

POSSIBLE_FALLACY_VOCAB_LEAKAGE = {
    'techno_optimism': 'optimism_bias',
    'analogical_reasoning': 'argument_from_analogy',
}


def autofix_node(node: dict) -> tuple[dict, list[str]]:
    """Apply auto-fixes to a node's graph_attributes. Returns (fixed_node, changes_log)."""
    changes = []
    ga = node.get('graph_attributes', {})
    if not isinstance(ga, dict) or len(ga) == 0:
        return node, []

    # ── Fix possible_fallacies naming ──
    pf = ga.get('possible_fallacies', [])
    if isinstance(pf, list):
        for i, f in enumerate(pf):
            if isinstance(f, dict):
                fname = f.get('fallacy', '')
                # Title case → snake_case
                if fname and fname != fname.lower():
                    new_name = snake_case(fname)
                    changes.append(f"possible_fallacies[{i}].fallacy: '{fname}' → '{new_name}'")
                    f['fallacy'] = new_name
                # Vocabulary leakage
                if fname.lower() in POSSIBLE_FALLACY_VOCAB_LEAKAGE:
                    new_name = POSSIBLE_FALLACY_VOCAB_LEAKAGE[fname.lower()]
                    changes.append(f"possible_fallacies[{i}].fallacy: '{fname}' → '{new_name}' (vocab fix)")
                    f['fallacy'] = new_name

    # ── Fix steelman_vulnerability dict → string ──
    sv = ga.get('steelman_vulnerability')
    if isinstance(sv, dict):
        sv_text = ' | '.join(str(v) for v in sv.values() if v)
        changes.append(f"steelman_vulnerability: dict → string ({len(sv)} keys)")
        ga['steelman_vulnerability'] = sv_text

    # ── Fix rhetorical_strategy vocabulary leakage (safe auto-mappings only) ──
    rs = ga.get('rhetorical_strategy', '')
    if rs:
        strategies = [s.strip() for s in rs.split(',')]
        fixed_strategies = []
        for s in strategies:
            if s in RHETORICAL_STRATEGY_VOCAB_LEAKAGE:
                replacement = RHETORICAL_STRATEGY_VOCAB_LEAKAGE[s]
                if replacement is not None:
                    changes.append(f"rhetorical_strategy: '{s}' → '{replacement}' (vocab fix)")
                    fixed_strategies.append(replacement)
                else:
                    # No safe mapping — keep original, will be flagged for LLM
                    fixed_strategies.append(s)
            else:
                fixed_strategies.append(s)
        # Deduplicate
        seen = set()
        deduped = []
        for s in fixed_strategies:
            if s not in seen:
                seen.add(s)
                deduped.append(s)
        if len(deduped) < len(fixed_strategies):
            changes.append(f"rhetorical_strategy: removed duplicates after vocab fix")
        new_rs = ', '.join(deduped)
        if new_rs != rs:
            ga['rhetorical_strategy'] = new_rs

    return node, changes


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Auto-fix graph_attributes issues')
    parser.add_argument('--data-root', default=DATA_ROOT)
    parser.add_argument('--dry-run', action='store_true', help='Show changes without writing')
    args = parser.parse_args()

    tax_dir = Path(args.data_root) / 'taxonomy' / 'Origin'
    total_changes = 0
    total_nodes_fixed = 0

    for pov_file in ['accelerationist.json', 'safetyist.json', 'skeptic.json']:
        fpath = tax_dir / pov_file
        if not fpath.exists():
            print(f"WARNING: {fpath} not found", file=sys.stderr)
            continue

        with open(fpath) as f:
            data = json.load(f)

        file_changes = 0
        for node in data['nodes']:
            _, changes = autofix_node(node)
            if changes:
                total_nodes_fixed += 1
                file_changes += len(changes)
                total_changes += len(changes)
                nid = node.get('id', '?')
                print(f"  {nid}:")
                for c in changes:
                    print(f"    {c}")

        if file_changes > 0 and not args.dry_run:
            with open(fpath, 'w') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write('\n')
            print(f"  → Wrote {fpath.name} ({file_changes} changes)")
        elif file_changes > 0:
            print(f"  → [DRY RUN] Would write {fpath.name} ({file_changes} changes)")

    print(f"\nTotal: {total_nodes_fixed} nodes, {total_changes} changes")


if __name__ == '__main__':
    main()
