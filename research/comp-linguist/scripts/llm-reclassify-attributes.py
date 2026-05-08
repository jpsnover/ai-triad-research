#!/usr/bin/env python3
"""
LLM re-verification script for flagged graph_attributes.
Phase 3b of the quality pass (t/421).

Sends flagged nodes to Gemini 2.5 Flash for targeted re-classification of
specific fields (epistemic_type, rhetorical_strategy, node_scope).
Nodes where Flash disagrees with current value get a second opinion from
Gemini 2.5 Pro.

Usage:
    python3 llm-reclassify-attributes.py [--data-root /path] [--dry-run] [--apply]
"""

import json
import os
import sys
import time
import re
from pathlib import Path
from collections import defaultdict

DATA_ROOT = os.environ.get(
    'AI_TRIAD_DATA_ROOT',
    str(Path(__file__).resolve().parents[3] / '..' / 'ai-triad-data')
)

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', os.environ.get('AI_API_KEY', ''))
GEMINI_FLASH_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
GEMINI_PRO_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent'

CANONICAL_EPISTEMIC_TYPES = [
    'empirical_claim', 'normative_prescription', 'strategic_recommendation',
    'predictive', 'definitional', 'interpretive_lens',
]

CANONICAL_RHETORICAL_STRATEGIES = [
    'precautionary_framing', 'structural_critique', 'moral_imperative',
    'techno_optimism', 'cost_benefit_analysis', 'appeal_to_evidence',
    'inevitability_framing', 'analogical_reasoning', 'reductio_ad_absurdum',
    'pragmatic_framing',
]

CANONICAL_NODE_SCOPES = ['claim', 'scheme', 'bridging']


from typing import Optional

def call_gemini(prompt: str, model_url: str) -> Optional[str]:
    """Call Gemini API and return the text response."""
    import urllib.request
    import urllib.error

    url = f"{model_url}?key={GEMINI_API_KEY}"
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 4096,
        },
    }).encode()

    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
        # Handle both standard and thinking-model response formats
        candidate = result['candidates'][0]
        content = candidate.get('content', {})
        parts = content.get('parts', [])
        # Find the first text part (skip thinking parts)
        for part in parts:
            if 'text' in part:
                return part['text']
        # Fallback: try grounding metadata or other formats
        print(f"  No text part found in response", file=sys.stderr)
        return None
    except (urllib.error.URLError, KeyError, IndexError, json.JSONDecodeError) as e:
        print(f"  API error: {e}", file=sys.stderr)
        return None


def build_reclassify_prompt(node: dict, fields_to_check: list[str]) -> str:
    """Build a focused prompt for re-classifying specific fields on a node."""
    nid = node.get('id', '?')
    label = node.get('label', '?')
    desc = node.get('description', '?')
    cat = node.get('category', '?')
    ga = node.get('graph_attributes', {})

    prompt = f"""You are a taxonomy classifier. Given a taxonomy node, assign the correct value for each requested field.

NODE:
  ID: {nid}
  Label: {label}
  Category: {cat}
  Description: {desc}

"""

    response_fields = {}

    if 'epistemic_type' in fields_to_check:
        current = ga.get('epistemic_type', '(empty)')
        prompt += f"""FIELD: epistemic_type
Current value: {current}
Pick exactly ONE from: {', '.join(CANONICAL_EPISTEMIC_TYPES)}

Definitions:
- empirical_claim: a factual assertion about the world, based on observation or data
- normative_prescription: a value judgment or should-statement
- definitional: defines or frames a concept
- strategic_recommendation: proposes a method or course of action
- predictive: forecasts a future state or trend
- interpretive_lens: a framework for understanding other claims

"""
        response_fields['epistemic_type'] = True

    if 'rhetorical_strategy' in fields_to_check:
        current = ga.get('rhetorical_strategy', '(empty)')
        prompt += f"""FIELD: rhetorical_strategy
Current value: {current}
Pick ONE or TWO (comma-separated) from: {', '.join(CANONICAL_RHETORICAL_STRATEGIES)}

"""
        response_fields['rhetorical_strategy'] = True

    if 'node_scope' in fields_to_check:
        current = ga.get('node_scope', '(empty)')
        prompt += f"""FIELD: node_scope
Current value: {current}
Pick exactly ONE from: {', '.join(CANONICAL_NODE_SCOPES)}

Definitions:
- claim: a specific, testable assertion (could be true or false)
- scheme: an argumentative strategy or framework (describes HOW to reason)
- bridging: connects claims to schemes or links disparate positions

"""
        response_fields['node_scope'] = True

    fields_json = ', '.join(f'"{f}": "<your value>"' for f in response_fields)
    prompt += f"""Respond with a JSON object containing ONLY the requested fields and a brief justification:
{{{fields_json}, "justification": "<1 sentence>"}}"""

    return prompt


def identify_flagged_nodes(nodes: list[dict]) -> dict[str, list[str]]:
    """Identify nodes that need LLM re-review and which fields to check."""
    flagged = {}  # node_id → list of fields to re-check

    for node in nodes:
        nid = node.get('id', '?')
        ga = node.get('graph_attributes', {})
        if not isinstance(ga, dict) or len(ga) == 0:
            continue  # These need backfill, not re-review

        fields_to_check = []

        # Compound epistemic_type
        et = ga.get('epistemic_type', '')
        if et and ',' in et:
            fields_to_check.append('epistemic_type')

        # Non-canonical rhetorical_strategy (after auto-fix)
        rs = ga.get('rhetorical_strategy', '')
        if rs:
            canonical = {
                'precautionary_framing', 'structural_critique', 'moral_imperative',
                'techno_optimism', 'cost_benefit_analysis', 'appeal_to_evidence',
                'inevitability_framing', 'analogical_reasoning', 'reductio_ad_absurdum',
                'pragmatic_framing',
            }
            strategies = [s.strip() for s in rs.split(',')]
            if any(s not in canonical for s in strategies):
                fields_to_check.append('rhetorical_strategy')

        # Non-canonical node_scope
        ns = ga.get('node_scope', '')
        if ns and ns not in {'claim', 'scheme', 'bridging'}:
            fields_to_check.append('node_scope')

        if fields_to_check:
            flagged[nid] = fields_to_check

    return flagged


def main():
    import argparse
    parser = argparse.ArgumentParser(description='LLM re-verify flagged graph_attributes')
    parser.add_argument('--data-root', default=DATA_ROOT)
    parser.add_argument('--dry-run', action='store_true', help='Show what would be sent without calling API')
    parser.add_argument('--apply', action='store_true', help='Apply fixes to taxonomy JSON files')
    parser.add_argument('--pro-threshold', type=int, default=0,
                        help='Send ALL disagreements to Pro (default: all)')
    args = parser.parse_args()

    if not GEMINI_API_KEY and not args.dry_run:
        print("ERROR: GEMINI_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    # Load nodes
    tax_dir = Path(args.data_root) / 'taxonomy' / 'Origin'
    all_nodes = {}
    pov_data = {}

    for pov_file in ['accelerationist.json', 'safetyist.json', 'skeptic.json']:
        fpath = tax_dir / pov_file
        with open(fpath) as f:
            data = json.load(f)
        pov_data[pov_file] = data
        for node in data['nodes']:
            all_nodes[node['id']] = node

    # Identify flagged nodes
    flagged = identify_flagged_nodes(list(all_nodes.values()))
    print(f"Flagged nodes: {len(flagged)}")
    for nid, fields in sorted(flagged.items()):
        ga = all_nodes[nid].get('graph_attributes', {})
        current_values = {f: ga.get(f, '?') for f in fields}
        print(f"  {nid}: {', '.join(fields)} — current: {current_values}")

    if args.dry_run:
        # Show sample prompt
        if flagged:
            sample_nid = next(iter(flagged))
            prompt = build_reclassify_prompt(all_nodes[sample_nid], flagged[sample_nid])
            print(f"\n--- Sample prompt for {sample_nid} ---")
            print(prompt)
        return

    # Phase 1: Gemini Flash pass
    print(f"\n{'='*60}")
    print("PHASE 1: Gemini 2.5 Flash")
    print(f"{'='*60}")

    flash_results = {}
    disagreements = {}

    for i, (nid, fields) in enumerate(sorted(flagged.items())):
        node = all_nodes[nid]
        ga = node.get('graph_attributes', {})
        prompt = build_reclassify_prompt(node, fields)

        print(f"  [{i+1}/{len(flagged)}] {nid} ({', '.join(fields)})...", end=' ', flush=True)

        response_text = call_gemini(prompt, GEMINI_FLASH_URL)
        if not response_text:
            print("FAILED")
            continue

        try:
            result = json.loads(response_text)
        except json.JSONDecodeError:
            # Try to extract JSON from response (multi-line)
            match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if match:
                try:
                    result = json.loads(match.group())
                except json.JSONDecodeError:
                    print(f"PARSE ERROR: {response_text[:120]}")
                    continue
            else:
                print(f"PARSE ERROR: {response_text[:120]}")
                continue

        flash_results[nid] = result
        justification = result.get('justification', '')

        # Check for disagreements
        node_disagreements = {}
        for field in fields:
            current = ga.get(field, '')
            proposed = result.get(field, '')
            if proposed and proposed != current:
                node_disagreements[field] = {'current': current, 'proposed': proposed}

        if node_disagreements:
            disagreements[nid] = node_disagreements
            print(f"CHANGED: {node_disagreements} — {justification}")
        else:
            print(f"CONFIRMED — {justification}")

        # Rate limit: ~10 requests per minute for free tier
        if (i + 1) % 10 == 0:
            time.sleep(2)

    print(f"\nFlash results: {len(flash_results)} responses, {len(disagreements)} disagreements")

    # Phase 2: Gemini Pro second opinion on disagreements
    if disagreements:
        print(f"\n{'='*60}")
        print(f"PHASE 2: Gemini 2.5 Pro (second opinion on {len(disagreements)} disagreements)")
        print(f"{'='*60}")

        pro_results = {}

        for i, (nid, diffs) in enumerate(sorted(disagreements.items())):
            node = all_nodes[nid]
            fields = list(diffs.keys())
            prompt = build_reclassify_prompt(node, fields)

            print(f"  [{i+1}/{len(disagreements)}] {nid} ({', '.join(fields)})...", end=' ', flush=True)

            response_text = call_gemini(prompt, GEMINI_PRO_URL)
            if not response_text:
                print("FAILED — keeping Flash result")
                pro_results[nid] = flash_results.get(nid, {})
                continue

            try:
                result = json.loads(response_text)
            except json.JSONDecodeError:
                match = re.search(r'\{.*\}', response_text, re.DOTALL)
                if match:
                    try:
                        result = json.loads(match.group())
                    except json.JSONDecodeError:
                        print(f"PARSE ERROR — keeping Flash result")
                        pro_results[nid] = flash_results.get(nid, {})
                        continue
                else:
                    print(f"PARSE ERROR — keeping Flash result")
                    pro_results[nid] = flash_results.get(nid, {})
                    continue

            pro_results[nid] = result
            justification = result.get('justification', '')

            # Compare Flash vs Pro
            flash_r = flash_results.get(nid, {})
            for field in fields:
                flash_val = flash_r.get(field, '?')
                pro_val = result.get(field, '?')
                current = diffs[field]['current']
                if flash_val == pro_val:
                    print(f"AGREE ({flash_val})", end=' ')
                else:
                    print(f"DISAGREE (Flash={flash_val}, Pro={pro_val}, current={current})", end=' ')
            print(f"— {justification}")

            if (i + 1) % 5 == 0:
                time.sleep(3)

    # Build final decisions
    print(f"\n{'='*60}")
    print("FINAL DECISIONS")
    print(f"{'='*60}")

    changes = {}  # nid → {field: new_value}

    for nid, diffs in disagreements.items():
        flash_r = flash_results.get(nid, {})
        pro_r = pro_results.get(nid, {}) if nid in (pro_results if 'pro_results' in dir() else {}) else {}

        for field, diff in diffs.items():
            flash_val = flash_r.get(field, '')
            pro_val = pro_r.get(field, '') if pro_r else ''

            if flash_val and pro_val and flash_val == pro_val:
                # Both models agree on the change
                if nid not in changes:
                    changes[nid] = {}
                changes[nid][field] = flash_val
                print(f"  {nid}.{field}: '{diff['current']}' → '{flash_val}' (Flash+Pro agree)")
            elif flash_val and not pro_val:
                # Only Flash available
                if nid not in changes:
                    changes[nid] = {}
                changes[nid][field] = flash_val
                print(f"  {nid}.{field}: '{diff['current']}' → '{flash_val}' (Flash only)")
            elif flash_val != pro_val:
                # Models disagree — prefer Pro
                chosen = pro_val or flash_val
                if nid not in changes:
                    changes[nid] = {}
                changes[nid][field] = chosen
                print(f"  {nid}.{field}: '{diff['current']}' → '{chosen}' (Pro preferred; Flash said '{flash_val}')")

    # For nodes where Flash confirmed current value, no change needed
    for nid in flash_results:
        if nid not in disagreements:
            ga = all_nodes[nid].get('graph_attributes', {})
            fields = flagged[nid]
            for field in fields:
                print(f"  {nid}.{field}: '{ga.get(field, '')}' — CONFIRMED by Flash")

    print(f"\nTotal changes: {sum(len(v) for v in changes.values())} across {len(changes)} nodes")

    # Apply changes
    if args.apply and changes:
        for pov_file, data in pov_data.items():
            file_changed = False
            for node in data['nodes']:
                nid = node['id']
                if nid in changes:
                    for field, new_val in changes[nid].items():
                        old_val = node.get('graph_attributes', {}).get(field, '')
                        node['graph_attributes'][field] = new_val
                        file_changed = True

            if file_changed:
                fpath = tax_dir / pov_file
                with open(fpath, 'w') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                    f.write('\n')
                print(f"  → Wrote {pov_file}")

    # Write change log
    log_path = tax_dir / '_llm_reclassify_log.json'
    log_data = {
        'flagged_count': len(flagged),
        'flash_responses': len(flash_results),
        'disagreements': len(disagreements),
        'changes_applied': args.apply,
        'changes': {nid: {f: {'old': all_nodes[nid].get('graph_attributes', {}).get(f, ''),
                               'new': v}
                          for f, v in fields_dict.items()}
                    for nid, fields_dict in changes.items()},
        'confirmed': [nid for nid in flash_results if nid not in disagreements],
    }
    with open(log_path, 'w') as f:
        json.dump(log_data, f, indent=2)
    print(f"\nChange log written to: {log_path}")


if __name__ == '__main__':
    main()
