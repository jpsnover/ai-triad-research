"""Generate attribution_text rewrites for annotation template claims.

For each claim in _annotation_template.json, uses the debate context and
taxonomy-informed prompt to produce two rewrite variants:
  - attribution_text_freeform: self-contained declarative statement
  - attribution_text_genus: genus-differentia mirrored ("A [BDI] within [POV] discourse that...")

Uses Google Gemini API (gemini-2.5-flash).

Usage:
    python _generate_attribution_text.py [--resume] [--dry-run] [--limit N]
"""
import json
import os
import sys
import time

from google import genai

RESEARCH_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(RESEARCH_DIR, '_annotation_template.json')
PROGRESS_PATH = os.path.join(RESEARCH_DIR, '_attribution_text_progress.json')

POV_LABELS = {
    'acc': 'accelerationist',
    'saf': 'safetyist',
    'skp': 'skeptic',
}

BDI_MODAL = {
    'belief': 'indicative assertion (state a factual/empirical claim: "X is/causes Y")',
    'desire': 'deontic statement (express a normative value: "X ought to / should / must")',
    'intention': 'instrumental claim (specify a method: "achieve X by means of Y")',
}

DOMAIN_VOCABULARY = """PREFERRED DOMAIN TERMINOLOGY — use these when the claim expresses the same concept:
- "AI alignment" (not "making AI do what we want")
- "alignment tax" (not "safety overhead")
- "instrumental convergence" (not "AI pursuing sub-goals")
- "capability overhang" (not "latent potential")
- "mesa-optimization" (not "inner optimizer")
- "compute governance" (not "chip controls")
- "existential risk" — risk of human extinction or permanent civilizational collapse
- "recursive self-improvement" — AI iteratively improving its own capabilities
- "corrigibility" — AI system that accepts human correction
- "scalable oversight" — maintaining human supervision as AI capability scales
- "differential technology development" — prioritizing safety over dangerous capabilities
- "regulatory capture" — regulated entities controlling their regulatory framework
- "agentic AI" — AI systems autonomously pursuing goals over extended periods
- "algorithmic accountability" — obligation to explain/justify algorithmic decisions
- "dual-use" — technology with both beneficial and harmful applications
- "red-teaming" — adversarial testing for vulnerabilities
- "deployment guardrails" — constraints on AI behavior in production
- "formal verification" — mathematical proof of system specification
- "pre-deployment verification" — testing/validation before release
- "frontier models" — most capable AI models at the boundary of current technology
- "deceptive alignment" — appearing aligned while pursuing different objectives
- "systemic risk" — cascading failures across interconnected systems
- "human-in-the-loop" — requiring human oversight at decision points
- "catastrophic failure" — severe, potentially irreversible failure mode
- "safety-washing" — superficial safety claims to deflect accountability
- "regulatory sandboxes" — controlled environments for testing innovation
- "liability regime" — legal framework assigning responsibility for AI-caused harms
- "strict liability" — liability without requiring proof of fault
- "moat" / "barrier to entry" — competitive advantages preventing market entry
- "race to the bottom" — competitive dynamic where safety standards decrease
- "performative compliance" — appearing to meet requirements without genuine implementation
- "lock-in effects" — mechanisms preventing switching away from a technology/vendor
- "human agency" — capacity for autonomous human decisions in AI-mediated contexts
- "adversarial robustness" — resilience against deliberately crafted malicious inputs
- "capability elicitation" — methods for discovering what an AI system can do"""


def format_debate_context(claim):
    """Format debate_context turns into readable text for the prompt."""
    ctx = claim.get('debate_context', [])
    if not ctx:
        return "(no debate context available)"

    lines = []
    for turn in ctx:
        speaker = turn.get('speaker', 'unknown').upper()
        content = turn.get('content', '')
        marker = " <<<CLAIM TURN>>>" if turn.get('is_claim_turn') else ""
        lines.append(f"[{speaker}]{marker}: {content[:2000]}")
    return "\n\n".join(lines)


def build_prompt(claim):
    """Build the rewrite prompt for a single claim."""
    claim_text = claim.get('claim_text', '')
    bdi = claim.get('bdi_category', 'belief').lower()
    pov_short = claim.get('pov', '')
    pov_full = POV_LABELS.get(pov_short, pov_short)
    speaker = claim.get('speaker', '')
    debate_title = claim.get('debate_title', '')
    modal_desc = BDI_MODAL.get(bdi, BDI_MODAL['belief'])
    context_text = format_debate_context(claim)
    prompt_ctx = claim.get('prompt_context', {})
    taxonomy_context = prompt_ctx.get('taxonomy_context', '')
    taxonomy_refs = prompt_ctx.get('taxonomy_refs', [])

    # Build taxonomy grounding section from the debate prompt
    taxonomy_section = ''
    if taxonomy_context:
        # Truncate to keep prompt manageable
        tc = taxonomy_context if len(taxonomy_context) <= 4000 else taxonomy_context[:4000] + '...'
        taxonomy_section += f"\nTAXONOMY CONTEXT (from the debate prompt that generated this statement):\n{tc}\n"
    if taxonomy_refs:
        ref_lines = [f"  - {r.get('node_id', '?')} (relevance: {r.get('relevance_score', '?')})"
                     for r in taxonomy_refs[:10]]
        taxonomy_section += f"\nTAXONOMY NODES REFERENCED IN THIS STATEMENT:\n" + '\n'.join(ref_lines) + '\n'

    return f"""You are rewriting a debate claim for taxonomy attribution. The original claim was extracted from a multi-agent AI policy debate and may contain unresolved references, metaphors, or implicit context that makes it impossible to classify without the surrounding debate.

ORIGINAL CLAIM: "{claim_text}"
SPEAKER: {speaker} ({pov_full})
BDI CATEGORY: {bdi}
DEBATE TOPIC: {debate_title}

SURROUNDING DEBATE CONTEXT:
{context_text}
{taxonomy_section}
YOUR TASK: Produce two rewrites of this claim, both optimized for embedding-based matching against taxonomy node descriptions.

STRUCTURAL RULES (apply to both rewrites):
1. BDI MODAL FORM: This is a {bdi}. Write it as an {modal_desc}.
2. DOMAIN VOCABULARY: Replace colloquial phrasing with canonical terms where applicable:
{DOMAIN_VOCABULARY}
3. SPECIFICITY: Name concrete mechanisms, programs, or policy instruments rather than broad categories.
4. RESOLUTION:
   - Replace all pronouns/demonstratives with their referents from the debate context
   - Decode metaphors into literal policy/governance language
   - Name the specific policy domain under discussion
   - Expand debate-internal proposals (named programs, frameworks) into functional descriptions
5. Do NOT add claims not present in the original. Preserve the original meaning.
6. 40-80 words each.

OUTPUT FORMAT — respond with ONLY a JSON object, no markdown fences:
{{
  "freeform": "<self-contained declarative rewrite>",
  "genus": "<rewrite mirroring taxonomy format: 'A [Belief|Desire|Intention] within {pov_full} discourse that [differentia]. Encompasses: [2-3 specific concepts from the claim].'>"
}}"""


def parse_response(text):
    """Extract JSON from model response, handling markdown fences and multiline strings."""
    import re
    text = text.strip()
    if text.startswith('```'):
        lines = text.split('\n')
        lines = lines[1:]
        if lines and lines[-1].strip() == '```':
            lines = lines[:-1]
        text = '\n'.join(lines).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Gemini often puts literal newlines inside JSON string values.
    # Fix by escaping unescaped newlines within quoted strings.
    fixed = re.sub(r'(?<=": ")(.*?)(?="[,\s}])', _escape_newlines, text, flags=re.DOTALL)
    try:
        return json.loads(fixed)
    except json.JSONDecodeError:
        pass
    # Last resort: regex extraction
    freeform = re.search(r'"freeform"\s*:\s*"((?:[^"\\]|\\.)*)"', text, re.DOTALL)
    genus = re.search(r'"genus"\s*:\s*"((?:[^"\\]|\\.)*)"', text, re.DOTALL)
    if freeform and genus:
        return {
            'freeform': freeform.group(1).replace('\n', ' ').strip(),
            'genus': genus.group(1).replace('\n', ' ').strip(),
        }
    raise ValueError(f"Could not parse response: {text[:200]}")


def _escape_newlines(match):
    return match.group(0).replace('\n', ' ').replace('\r', '')


MAX_RETRIES = 3


def call_with_backoff(client, prompt):
    """Call Gemini with exponential backoff and jitter on transient errors."""
    import random
    for attempt in range(MAX_RETRIES):
        try:
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
                config=genai.types.GenerateContentConfig(
                    temperature=0.1,
                    max_output_tokens=1024,
                    thinking_config=genai.types.ThinkingConfig(thinking_budget=0),
                ),
            )
            return parse_response(response.text)
        except Exception as e:
            err_str = str(e).lower()
            is_transient = any(k in err_str for k in ['429', '503', 'rate', 'quota', 'timeout', 'unavailable'])
            if not is_transient or attempt == MAX_RETRIES - 1:
                raise
            delay = (2 ** attempt) + random.uniform(0, 1)
            print(f"    Transient error (attempt {attempt+1}/{MAX_RETRIES}), retrying in {delay:.1f}s: {e}")
            time.sleep(delay)


def load_progress():
    """Load saved progress if it exists."""
    if os.path.exists(PROGRESS_PATH):
        with open(PROGRESS_PATH, encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_progress(progress):
    """Save progress to disk."""
    with open(PROGRESS_PATH, 'w', encoding='utf-8') as f:
        json.dump(progress, f, indent=2, ensure_ascii=False)


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Generate attribution_text for annotation claims')
    parser.add_argument('--resume', action='store_true', help='Resume from saved progress')
    parser.add_argument('--dry-run', action='store_true', help='Print prompts without calling API')
    parser.add_argument('--limit', type=int, default=0, help='Process only first N claims')
    args = parser.parse_args()

    api_key = os.environ.get('GEMINI_API_KEY', os.environ.get('AI_API_KEY', ''))
    if not api_key and not args.dry_run:
        print("ERROR: Set GEMINI_API_KEY or AI_API_KEY environment variable")
        sys.exit(1)

    if not args.dry_run:
        client = genai.Client(api_key=api_key)

    with open(TEMPLATE_PATH, encoding='utf-8') as f:
        template = json.load(f)

    progress = load_progress() if args.resume else {}
    claims = template['claims']
    if args.limit > 0:
        claims = claims[:args.limit]

    total = len(claims)
    skipped = 0
    processed = 0
    errors = 0

    print(f"Processing {total} claims (resume={'yes' if args.resume else 'no'}, dry_run={args.dry_run})")

    for i, claim in enumerate(claims):
        cid = claim['claim_id']

        if args.resume and cid in progress:
            skipped += 1
            continue

        prompt = build_prompt(claim)

        if args.dry_run:
            if i == 0:
                safe_prompt = prompt.encode('ascii', errors='replace').decode('ascii')
                print(f"\n{'='*80}\nSAMPLE PROMPT (claim {cid}):\n{'='*80}\n{safe_prompt}\n{'='*80}")
            print(f"  [{i+1}/{total}] {cid}: would process ({len(prompt)} chars)")
            continue

        try:
            result = call_with_backoff(client, prompt)

            freeform = result.get('freeform') or result.get('rewrite_1') or result.get('free_form')
            genus = result.get('genus') or result.get('rewrite_2') or result.get('genus_differentia')
            if not freeform or not genus:
                raise ValueError(f"Missing required fields in response: {list(result.keys())}")

            progress[cid] = {
                'freeform': freeform,
                'genus': genus,
            }
            processed += 1

            if processed % 10 == 0:
                save_progress(progress)
                print(f"  [{i+1}/{total}] Checkpoint saved ({processed} processed, {errors} errors)")

        except Exception as e:
            errors += 1
            print(f"  [{i+1}/{total}] ERROR on {cid}: {e}")
            progress[cid] = {'error': str(e)}

        time.sleep(0.3)

    if not args.dry_run:
        save_progress(progress)

        successful = {k: v for k, v in progress.items() if 'error' not in v}
        for claim in template['claims']:
            cid = claim['claim_id']
            if cid in successful:
                claim['attribution_text_freeform'] = successful[cid]['freeform']
                claim['attribution_text_genus'] = successful[cid]['genus']

        template['metadata']['attribution_text_generated'] = True
        template['metadata']['attribution_text_model'] = 'gemini-2.5-flash'
        template['metadata']['attribution_text_count'] = len(successful)

        with open(TEMPLATE_PATH, 'w', encoding='utf-8') as f:
            json.dump(template, f, indent=2, ensure_ascii=False)

    print(f"\nDone: {processed} processed, {skipped} skipped (resumed), {errors} errors")
    if not args.dry_run:
        print(f"Progress saved to {PROGRESS_PATH}")
        print(f"Template updated at {TEMPLATE_PATH}")


if __name__ == '__main__':
    main()
