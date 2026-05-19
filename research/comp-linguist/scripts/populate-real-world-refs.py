#!/usr/bin/env python3
"""
Populate real_world_refs on policy_actions.json entries.
Hybrid approach: LLM batch extraction → spot-check verification.

Phase 1: Send policies in batches to Gemini 2.5 Flash to identify
         matching legislation, regulations, and executive orders.
Phase 2: Spot-check the top N highest-member-count policies by
         verifying instrument names and URLs (optional web search).

Usage:
    # Dry run — show what would be sent, don't call API
    python3 populate-real-world-refs.py --dry-run

    # Phase 1 — LLM extraction (writes results to staging file)
    python3 populate-real-world-refs.py --extract

    # Phase 2 — Review staging file, then apply
    python3 populate-real-world-refs.py --apply

    # Both phases
    python3 populate-real-world-refs.py --extract --apply
"""

import json
import os
import sys
import re
import time
from pathlib import Path
from typing import Optional

DATA_ROOT = os.environ.get(
    'AI_TRIAD_DATA_ROOT',
    str(Path(__file__).resolve().parents[3] / '..' / 'ai-triad-data')
)

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', os.environ.get('AI_API_KEY', ''))
GEMINI_FLASH_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

POLICY_FILE = Path(DATA_ROOT) / 'taxonomy' / 'Origin' / 'policy_actions.json'
STAGING_FILE = Path(DATA_ROOT) / 'taxonomy' / 'Origin' / '_real_world_refs_staging.json'

BATCH_SIZE = 4

# ── Known legislation corpus (for validation) ──────────────

KNOWN_INSTRUMENTS = {
    # EU
    'EU AI Act', 'GDPR', 'Digital Services Act', 'Digital Markets Act',
    'AI Liability Directive', 'Product Liability Directive',
    # US Federal
    'EO-14110', 'EO 14110', 'NIST AI RMF', 'AI Bill of Rights',
    'National AI Initiative Act', 'Algorithmic Accountability Act',
    'AI Training Act', 'AI in Government Act',
    # US State
    'SB-1047', 'SB 1047', 'Colorado AI Act', 'NYC Local Law 144',
    'Illinois AI Video Interview Act', 'Texas Responsible AI Governance Act',
    # International
    'Hiroshima AI Process', 'Bletchley Declaration', 'OECD AI Principles',
    'G7 Code of Conduct', 'UNESCO AI Ethics Recommendation',
    'Council of Europe AI Convention',
    # Sector-specific
    'FDA AI/ML Action Plan', 'SEC AI Risk Guidance',
    'NHTSA AV Guidelines', 'FAA Airworthiness Directives',
}

# ── Gemini API ──────────────────────────────────────────────

def call_gemini(prompt: str) -> Optional[str]:
    """Call Gemini 2.5 Flash and return the text response."""
    import urllib.request
    import urllib.error

    url = f"{GEMINI_FLASH_URL}?key={GEMINI_API_KEY}"
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 8192,
        },
    }).encode()

    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
        candidate = result['candidates'][0]
        parts = candidate.get('content', {}).get('parts', [])
        for part in parts:
            if 'text' in part:
                return part['text']
        return None
    except Exception as e:
        print(f"  API error: {e}", file=sys.stderr)
        return None


# ── Prompt ──────────────────────────────────────────────────

def build_extraction_prompt(policies: list[dict]) -> str:
    policy_block = "\n".join(
        f"  {p['id']}: {p['action']}"
        + (f" [tags: {', '.join(p.get('tags', []))}]" if p.get('tags') else '')
        for p in policies
    )

    return f"""You are a regulatory policy analyst. For each AI policy action below, identify 0-3 real-world legislation, regulations, executive orders, or formal international agreements that implement, approximate, or directly address this policy.

RULES:
- Only include enacted law, formally proposed bills, executive orders, or binding international agreements.
- Do NOT include academic papers, industry guidelines, advocacy position papers, or voluntary commitments.
- Do NOT hallucinate instrument names — if you are not confident a specific law exists, omit it.
- For each reference, provide:
  - "jurisdiction": geographic scope (e.g., "EU", "US-Federal", "California", "UK", "International")
  - "instrument": official name + specific section if applicable (e.g., "EU AI Act Art. 6", "EO-14110 §4.2(a)")
  - "status": one of "enacted", "proposed", "expired", "withdrawn"
  - "url": official source URL if known, otherwise omit
  - "confidence": "high" (you are certain this exists) or "medium" (you believe this exists but are not 100% certain)
- If a policy has no matching real-world legislation, return an empty array for it.
- Be precise about sections — "EU AI Act" is too broad if a specific article applies.

POLICIES:
{policy_block}

Respond with ONLY a JSON object mapping policy IDs to their references (no prose, no code fences):
{{
  "pol-001": [
    {{"jurisdiction": "EU", "instrument": "EU AI Act Art. 57", "status": "enacted", "confidence": "high"}},
    {{"jurisdiction": "US-Federal", "instrument": "AI in Government Act §3", "status": "enacted", "url": "https://...", "confidence": "high"}}
  ],
  "pol-002": [],
  "pol-003": [
    {{"jurisdiction": "California", "instrument": "SB-1047 §2(c)", "status": "proposed", "confidence": "medium"}}
  ]
}}"""


# ── Phase 1: Extract ────────────────────────────────────────

def extract_refs(policies: list[dict], dry_run: bool = False) -> dict:
    """Run LLM extraction on all policies in batches."""
    results = {}
    total_batches = (len(policies) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_idx in range(total_batches):
        start = batch_idx * BATCH_SIZE
        batch = policies[start:start + BATCH_SIZE]
        batch_ids = [p['id'] for p in batch]

        print(f"  Batch {batch_idx + 1}/{total_batches}: {', '.join(batch_ids)}", end='', flush=True)

        if dry_run:
            if batch_idx == 0:
                prompt = build_extraction_prompt(batch)
                print(f"\n\n--- Sample prompt ---\n{prompt[:2000]}...")
            else:
                print(" [dry run]")
            continue

        prompt = build_extraction_prompt(batch)
        response = call_gemini(prompt)
        if not response:
            print(" FAILED")
            continue

        # Strip markdown code fences if present
        cleaned = re.sub(r'^```(?:json)?\s*', '', response.strip())
        cleaned = re.sub(r'\s*```\s*$', '', cleaned)

        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            match = re.search(r'\{.*\}', cleaned, re.DOTALL)
            if match:
                try:
                    parsed = json.loads(match.group())
                except json.JSONDecodeError:
                    print(f" PARSE ERROR: {cleaned[:120]}")
                    continue
            else:
                print(f" PARSE ERROR: {cleaned[:120]}")
                continue

        ref_count = 0
        for pid, refs in parsed.items():
            if isinstance(refs, list):
                results[pid] = refs
                ref_count += len(refs)

        print(f" → {ref_count} refs")

        # Rate limit
        if (batch_idx + 1) % 10 == 0:
            time.sleep(2)

    return results


# ── Phase 2: Validate and Apply ─────────────────────────────

def validate_refs(staging: dict) -> dict:
    """Validate extracted refs: check confidence, flag unknown instruments."""
    stats = {
        'total_policies': len(staging),
        'total_refs': 0,
        'high_confidence': 0,
        'medium_confidence': 0,
        'known_instrument_matches': 0,
        'unknown_instruments': [],
    }

    for pid, refs in staging.items():
        for ref in refs:
            if not isinstance(ref, dict):
                continue
            stats['total_refs'] += 1
            conf = ref.get('confidence', 'medium')
            if conf == 'high':
                stats['high_confidence'] += 1
            else:
                stats['medium_confidence'] += 1

            # Check against known instrument list
            instrument = ref.get('instrument', '')
            matched = any(known in instrument for known in KNOWN_INSTRUMENTS)
            if matched:
                stats['known_instrument_matches'] += 1
            else:
                stats['unknown_instruments'].append({
                    'policy': pid,
                    'instrument': instrument,
                    'confidence': conf,
                })

    return stats


def apply_refs(policy_data: dict, staging: dict) -> int:
    """Apply staged refs to policy_actions.json. Returns count of updated policies."""
    policies = policy_data if isinstance(policy_data, list) else policy_data.get('policies', policy_data.get('actions', []))
    policy_map = {p['id']: p for p in policies}

    updated = 0
    for pid, refs in staging.items():
        if pid not in policy_map:
            continue
        if not refs:
            continue

        # Strip confidence field (internal) before writing to data
        clean_refs = []
        for ref in refs:
            if not isinstance(ref, dict):
                continue
            clean = {
                'jurisdiction': ref.get('jurisdiction', ''),
                'instrument': ref.get('instrument', ''),
                'status': ref.get('status', 'proposed'),
            }
            if ref.get('url'):
                clean['url'] = ref['url']
            clean_refs.append(clean)

        policy_map[pid]['real_world_refs'] = clean_refs
        updated += 1

    return updated


# ── Main ────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Populate real_world_refs on policy actions')
    parser.add_argument('--data-root', default=DATA_ROOT)
    parser.add_argument('--extract', action='store_true', help='Run Phase 1: LLM extraction')
    parser.add_argument('--apply', action='store_true', help='Run Phase 2: validate and apply to JSON')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be sent without calling API')
    parser.add_argument('--min-members', type=int, default=1,
                        help='Only process policies with member_count >= N (default: 1)')
    parser.add_argument('--limit', type=int, default=0,
                        help='Limit to first N policies (0 = all)')
    parser.add_argument('--spot-check', type=int, default=50,
                        help='Number of top policies to highlight for manual verification')
    args = parser.parse_args()

    policy_path = Path(args.data_root) / 'taxonomy' / 'Origin' / 'policy_actions.json'
    staging_path = Path(args.data_root) / 'taxonomy' / 'Origin' / '_real_world_refs_staging.json'

    with open(policy_path) as f:
        policy_data = json.load(f)

    policies = policy_data if isinstance(policy_data, list) else policy_data.get('policies', policy_data.get('actions', []))
    print(f"Total policies: {len(policies)}")

    # Filter by member count
    eligible = [p for p in policies if (p.get('member_count', 0) or 0) >= args.min_members]
    # Skip already-populated
    eligible = [p for p in eligible if not p.get('real_world_refs')]
    print(f"Eligible (member_count >= {args.min_members}, no existing refs): {len(eligible)}")

    if args.limit > 0:
        eligible = eligible[:args.limit]
        print(f"Limited to: {len(eligible)}")

    # Sort by member_count descending (highest-impact policies first)
    eligible.sort(key=lambda p: p.get('member_count', 0) or 0, reverse=True)

    if not args.extract and not args.apply and not args.dry_run:
        print("\nNo action specified. Use --extract, --apply, or --dry-run.")
        print(f"  --extract: Send {len(eligible)} policies to Gemini for legislation matching")
        print(f"  --apply: Read staging file and write refs to policy_actions.json")
        print(f"  --dry-run: Show sample prompt without calling API")

        # Show top policies that would be processed
        print(f"\nTop {min(10, len(eligible))} policies by member_count:")
        for p in eligible[:10]:
            tags = ', '.join(p.get('tags', [])[:3]) if p.get('tags') else ''
            print(f"  {p['id']} (members: {p.get('member_count', 0)}) [{tags}]: {p['action'][:80]}")
        return

    # ── Phase 1: Extract ──
    if args.extract or args.dry_run:
        if not GEMINI_API_KEY and not args.dry_run:
            print("ERROR: GEMINI_API_KEY not set", file=sys.stderr)
            sys.exit(1)

        print(f"\n{'='*60}")
        print(f"PHASE 1: LLM Extraction ({len(eligible)} policies)")
        print(f"{'='*60}")

        results = extract_refs(eligible, dry_run=args.dry_run)

        if not args.dry_run:
            # Write staging file
            with open(staging_path, 'w') as f:
                json.dump(results, f, indent=2, ensure_ascii=False)
            print(f"\nStaging file written: {staging_path}")

            # Summary
            total_refs = sum(len(v) for v in results.values())
            has_refs = sum(1 for v in results.values() if v)
            print(f"Policies with refs: {has_refs}/{len(results)}")
            print(f"Total refs found: {total_refs}")

            # Top refs by jurisdiction
            jurisdictions = {}
            for refs in results.values():
                for ref in refs:
                    j = ref.get('jurisdiction', '?')
                    jurisdictions[j] = jurisdictions.get(j, 0) + 1
            if jurisdictions:
                print(f"\nBy jurisdiction:")
                for j, count in sorted(jurisdictions.items(), key=lambda x: -x[1]):
                    print(f"  {j}: {count}")

    # ── Phase 2: Validate and Apply ──
    if args.apply:
        if not staging_path.exists():
            print(f"ERROR: Staging file not found: {staging_path}", file=sys.stderr)
            print("Run --extract first.")
            sys.exit(1)

        with open(staging_path) as f:
            staging = json.load(f)

        print(f"\n{'='*60}")
        print(f"PHASE 2: Validate and Apply")
        print(f"{'='*60}")

        # Validate
        stats = validate_refs(staging)
        print(f"Total refs: {stats['total_refs']}")
        print(f"High confidence: {stats['high_confidence']}")
        print(f"Medium confidence: {stats['medium_confidence']}")
        print(f"Known instrument matches: {stats['known_instrument_matches']}")

        if stats['unknown_instruments']:
            print(f"\nUnknown instruments ({len(stats['unknown_instruments'])}) — verify these:")
            for item in stats['unknown_instruments'][:args.spot_check]:
                print(f"  {item['policy']}: {item['instrument']} ({item['confidence']})")

        # Spot-check: highlight top-member-count policies for manual review
        top_policies = sorted(
            [(pid, refs) for pid, refs in staging.items() if refs],
            key=lambda x: next((p.get('member_count', 0) for p in policies if p['id'] == x[0]), 0),
            reverse=True,
        )[:args.spot_check]

        if top_policies:
            print(f"\nTop {len(top_policies)} policies for manual spot-check:")
            for pid, refs in top_policies[:10]:
                policy = next((p for p in policies if p['id'] == pid), None)
                mc = policy.get('member_count', 0) if policy else 0
                action = policy['action'][:60] if policy else '?'
                ref_summary = '; '.join(f"{r['jurisdiction']}/{r['instrument']}" for r in refs[:2])
                print(f"  {pid} (members: {mc}): {action}...")
                print(f"    → {ref_summary}")

        # Apply
        print(f"\nApplying {stats['total_refs']} refs to {len([v for v in staging.values() if v])} policies...")
        updated = apply_refs(policy_data, staging)

        with open(policy_path, 'w') as f:
            json.dump(policy_data, f, indent=2, ensure_ascii=False)
            f.write('\n')
        print(f"Updated {updated} policies in {policy_path.name}")

        # Summary
        total_with_refs = sum(1 for p in policies if p.get('real_world_refs'))
        print(f"Total policies with real_world_refs: {total_with_refs}/{len(policies)}")


if __name__ == '__main__':
    main()
