"""Archetype prompt templates for synthetic statement generation.

Implements 7 archetype templates + audience-modulated variants.
Each template injects POV few-shot exemplars, vocabulary profiles,
confusable neighbor negatives, and archetype-specific field data.

Ticket: t/556

Usage:
    # Show assembled prompts for a sample node
    python _archetype_templates.py --node-id acc-beliefs-003

    # Show all prompts for a node (all archetypes + audience variants)
    python _archetype_templates.py --node-id acc-beliefs-003 --all

    # Test across POVs (3 sample nodes)
    python _archetype_templates.py --test
"""
import sys
import json
import os
import re
import argparse
from collections import defaultdict
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin'
RESEARCH_DIR = os.path.dirname(os.path.abspath(__file__))

POV_FILES = {
    'acc': 'accelerationist.json',
    'saf': 'safetyist.json',
    'skp': 'skeptic.json',
}
POV_NAMES = {
    'acc': 'Accelerationist',
    'saf': 'Safetyist',
    'skp': 'Skeptic',
}

# ── Archetype Definitions ──

ARCHETYPES = {
    'surface_claim': {
        'name': 'Surface Claim',
        'count': (4, 5),
        'fields': ['label', 'description'],
        'description': 'Direct restatements of the core position as debate claims',
    },
    'assumption_expression': {
        'name': 'Assumption Expression',
        'count': (5, 7),
        'fields': ['assumes'],
        'description': 'Underlying premises expressed as standalone debate claims',
    },
    'policy_implication': {
        'name': 'Policy Implication',
        'count': (4, 5),
        'fields': ['policy_actions'],
        'description': 'Concrete regulatory/governance language from this position',
    },
    'intellectual_lineage': {
        'name': 'Intellectual Lineage Framing',
        'count': (3, 4),
        'fields': ['intellectual_lineage'],
        'description': 'Position framed using tradition-specific vocabulary and concepts',
    },
    'defensive_formulation': {
        'name': 'Defensive Formulation',
        'count': (3, 4),
        'fields': ['steelman_vulnerability'],
        'description': 'Acknowledges the strongest counterargument and rebuts it',
    },
    'real_world_example': {
        'name': 'Real-World Example',
        'count': (3, 4),
        'fields': ['encompasses'],
        'description': 'Position grounded in specific scenarios and concrete instances',
    },
    'counterargument_response': {
        'name': 'Counterargument Response',
        'count': (3, 4),
        'fields': ['possible_fallacies', 'rhetorical_strategy'],
        'description': 'Responds to critics who challenge this position',
    },
}

AUDIENCE_OVERLAYS = {
    'policymaker': {
        'register': 'formal legislative/regulatory',
        'instruction': (
            'Write as if addressing a congressional hearing or regulatory comment period. '
            'Use policy-specific vocabulary: "mandate", "compliance framework", "enforcement mechanism", '
            '"regulatory burden", "stakeholder impact". Reference institutional actors and processes.'
        ),
    },
    'technical_researcher': {
        'register': 'technical/academic',
        'instruction': (
            'Write as if contributing to a technical workshop or peer discussion. '
            'Use precise technical vocabulary, reference specific methods or architectures, '
            'cite measurable quantities. Assume domain expertise in the audience.'
        ),
    },
    'industry_leader': {
        'register': 'business/strategic',
        'instruction': (
            'Write as if presenting at a board meeting or industry conference. '
            'Frame in terms of competitive advantage, market dynamics, operational risk, '
            'and ROI. Use business vocabulary: "scalable", "cost-effective", "liability exposure".'
        ),
    },
}

AUDIENCE_MODULATED_ARCHETYPES = ['policy_implication', 'defensive_formulation',
                                  'surface_claim', 'assumption_expression']
AUDIENCE_STATEMENTS_PER_SLOT = 1

SYSTEM_PROMPT = """\
You generate synthetic debate statements that express a specific taxonomy node's position.

CRITICAL RULES:
- Each statement must sound like something a real debater would say in a policy discussion
- Each statement must be attributable to THIS specific node, not its neighbors
- Maximize lexical and structural diversity across statements
- Match the register and vocabulary patterns of the POV camp shown in the examples

Output a JSON array. Each element:
{{"statement": "...", "archetype": "{archetype}", "rationale": "One sentence: why this expresses node {node_id} specifically, not neighbor X or Y"}}

Statements whose rationale reveals they express a neighbor's position or a generic platitude will be discarded."""


def _extract_excludes(description):
    """Extract Excludes clause from node description."""
    match = re.search(r'Excludes?:\s*(.+?)(?:\n|$)', description, re.IGNORECASE)
    return match.group(1).strip().rstrip('.') if match else ''


def _extract_encompasses(description):
    """Extract Encompasses clause from node description."""
    match = re.search(r'Encompasses?:\s*(.+?)(?:\n|$)', description, re.IGNORECASE)
    return match.group(1).strip().rstrip('.') if match else ''


def _format_assumes(assumes_list):
    """Format individual assumptions for injection."""
    if not assumes_list:
        return 'No explicit assumptions documented.'
    lines = []
    for i, a in enumerate(assumes_list[:7], 1):
        text = a if isinstance(a, str) else str(a)
        lines.append(f"  {i}. {text[:200]}")
    return '\n'.join(lines)


def _format_policy_actions(policy_actions):
    """Format policy actions for injection."""
    if not policy_actions:
        return 'No policy actions documented.'
    lines = []
    for pa in policy_actions[:5]:
        if isinstance(pa, dict):
            action = pa.get('action', '')
            framing = pa.get('framing', '')
            lines.append(f"  - Action: {action[:150]}")
            if framing:
                lines.append(f"    Framing: {framing[:150]}")
        else:
            lines.append(f"  - {str(pa)[:200]}")
    return '\n'.join(lines)


def _format_lineage(lineage):
    """Format intellectual lineage for injection."""
    if not lineage:
        return 'No intellectual lineage documented.'
    lines = []
    for entry in lineage[:4]:
        if isinstance(entry, dict):
            name = entry.get('name', '')
            desc = entry.get('description', '')
            lines.append(f"  - {name}: {desc[:150]}")
        else:
            lines.append(f"  - {str(entry)[:200]}")
    return '\n'.join(lines)


def _format_fallacies(fallacies):
    """Format possible fallacies for injection."""
    if not fallacies:
        return 'No fallacy challenges documented.'
    lines = []
    for f in fallacies[:4]:
        if isinstance(f, dict):
            name = f.get('fallacy', '')
            explanation = f.get('explanation', '')
            lines.append(f"  - {name}: {explanation[:150]}")
        else:
            lines.append(f"  - {str(f)[:200]}")
    return '\n'.join(lines)


def _format_neighbors(neighbors):
    """Format confusable neighbors for negative injection."""
    if not neighbors:
        return 'No close neighbors identified.'
    lines = []
    for nb in neighbors[:4]:
        nid = nb.get('node_id', '')
        label = nb.get('label', '')
        score = nb.get('blended_score', 0)
        lines.append(f"  - {nid} ({score:.2f}): {label[:100]}")
    return '\n'.join(lines)


def _format_exemplars(exemplars):
    """Format POV few-shot exemplar claims."""
    if not exemplars:
        return '(No exemplar claims available for this POV.)'
    lines = []
    for i, ex in enumerate(exemplars[:5], 1):
        text = ex.get('text', str(ex))[:200]
        lines.append(f'  {i}. "{text}"')
    return '\n'.join(lines)


def _format_vocab_summary(profile):
    """Format vocabulary profile summary for prompt injection."""
    if not profile:
        return '(No vocabulary profile available.)'

    parts = []

    ngrams = profile.get('ngrams', {})
    top_bigrams = ngrams.get('bigrams', [])[:8]
    if top_bigrams:
        terms = ', '.join(f'"{b["term"]}"' for b in top_bigrams)
        parts.append(f"Key phrases: {terms}")

    dm = profile.get('discourse_markers', {})
    top_cats = dm.get('counts_per_category', {})
    if top_cats:
        sorted_cats = sorted(top_cats.items(), key=lambda x: x[1], reverse=True)[:3]
        style_desc = []
        for cat, count in sorted_cats:
            if count > 0:
                style_desc.append(cat)
        if style_desc:
            parts.append(f"Discourse style: {', '.join(style_desc)}")

    reg = profile.get('register_signature', {})
    wc = reg.get('mean_word_count', 0)
    q_pct = reg.get('question_pct', 0)
    if wc:
        parts.append(f"Typical length: ~{wc:.0f} words per statement")
    if q_pct > 3:
        parts.append(f"Questions: {q_pct:.0f}% of claims use interrogative framing")

    return '\n  '.join(parts) if parts else '(Minimal vocabulary data.)'


# ── Archetype-Specific Instructions ──

ARCHETYPE_INSTRUCTIONS = {
    'surface_claim': """\
ARCHETYPE: Surface Claim
Generate {count} statements that directly express this node's core position.

Rephrase the node's label and description as claims a debater would make.
Each statement should capture the SAME core proposition but use different:
- Opening structure (declarative, conditional, comparative)
- Vocabulary (synonyms, related domain terms)
- Level of specificity (broad principle vs. concrete assertion)

NODE POSITION:
  Label: {label}
  Description: {description}
  Epistemic type: {epistemic_type}""",

    'assumption_expression': """\
ARCHETYPE: Assumption Expression
Generate {count} statements, each expressing one of this node's underlying assumptions
as a standalone debate claim.

Each assumption below is a premise that a debater holding this position would assert.
Express each as a self-contained claim — not "this assumes X" but the assumption stated
as if the debater believes it directly.

ASSUMPTIONS:
{assumes}

Seed each statement from a DIFFERENT assumption. If there are fewer assumptions than
the requested count, generate multiple phrasings of the most distinctive ones.""",

    'policy_implication': """\
ARCHETYPE: Policy Implication
Generate {count} statements framing this node's position through concrete policy language.

Debate participants discuss regulations, subsidies, liability frameworks, and treaties —
not abstract beliefs. Transform this node's policy implications into claims a debater
would make about what governments, institutions, or industries should do.

POLICY ACTIONS:
{policy_actions}

Frame each as advocacy: "Congress should...", "Regulators must...", "The industry needs..."
or as empirical claims about policy effects: "Mandatory audits would...", "Tax incentives have...".""",

    'intellectual_lineage': """\
ARCHETYPE: Intellectual Lineage Framing
Generate {count} statements that express this node's position using the vocabulary
and conceptual frameworks of its intellectual traditions.

Each tradition provides specific terminology and reasoning patterns that real debaters
use as shorthand. Generate claims that invoke these tradition-specific anchors naturally.

INTELLECTUAL TRADITIONS:
{lineage}

Use tradition-specific terms as a real debater would — as assumed shared vocabulary,
not as definitions. "The defense-in-depth principle demands..." not "Defense in depth,
which is a concept from systems safety engineering, suggests...".""",

    'defensive_formulation': """\
ARCHETYPE: Defensive Formulation
Generate {count} statements that acknowledge the strongest counterargument to this
position and rebut it. Each statement should demonstrate the debater's awareness of
the criticism while maintaining their position.

STEELMAN VULNERABILITY:
  {steelman}

Patterns:
- "Even granting that [vulnerability], [rebuttal]..."
- "Critics point to [vulnerability], but [counterpoint]..."
- "While [concession], this overlooks [key factor]..."

Each statement should address a DIFFERENT aspect of the vulnerability or offer
a distinct rebuttal strategy.""",

    'real_world_example': """\
ARCHETYPE: Real-World Example
Generate {count} statements that ground this node's position in concrete scenarios,
named examples, or specific real-world contexts.

SCOPE:
  Encompasses: {encompasses}

Transform abstract principles into claims anchored in observable reality. Reference
specific technologies, companies, incidents, regulations, or sectors where this
position applies. Each example should illustrate a different facet of the node.""",

    'counterargument_response': """\
ARCHETYPE: Counterargument Response
Generate {count} statements where the debater responds to specific criticisms
of this position. Each statement should name or imply the criticism and counter it.

CRITICISMS THIS POSITION FACES:
{fallacies}

RHETORICAL STRATEGIES available to this position:
  {rhetorical_strategy}

Patterns:
- "The charge of [fallacy] misunderstands [key distinction]..."
- "Accusing this position of [fallacy] ignores [evidence/context]..."
- "What looks like [fallacy] is actually [justified reasoning]..."

Each response should address a DIFFERENT criticism.""",
}

AUDIENCE_INSTRUCTION_TEMPLATE = """\

AUDIENCE MODULATION: {audience_name}
Register: {register}
{audience_instruction}

Apply this register to the {archetype_name} archetype above. The propositional content
stays the same — adjust vocabulary, formality, and framing for this audience."""


class PromptAssembler:
    """Assembles complete generation prompts from templates + node data."""

    def __init__(self, data_root=DATA_ROOT, research_dir=RESEARCH_DIR):
        self.data_root = data_root
        self.research_dir = research_dir
        self._nodes = {}
        self._neighbors = {}
        self._profiles = {}
        self._loaded = False

    def _load(self):
        if self._loaded:
            return

        for pov, filename in POV_FILES.items():
            path = os.path.join(self.data_root, filename)
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
            for n in data.get('nodes', []):
                self._nodes[n['id']] = n

        nb_path = os.path.join(self.research_dir, '_confusable_neighbors.json')
        if os.path.exists(nb_path):
            with open(nb_path, encoding='utf-8') as f:
                nb_data = json.load(f)
            self._neighbors = nb_data.get('nodes', {})

        for pov in ['acc', 'saf', 'skp']:
            prof_path = os.path.join(self.research_dir, f'_pov_profile_{pov}.json')
            if os.path.exists(prof_path):
                with open(prof_path, encoding='utf-8') as f:
                    self._profiles[pov] = json.load(f).get('profile', {})

        self._loaded = True

    def get_node(self, node_id):
        self._load()
        return self._nodes.get(node_id)

    def get_pov(self, node_id):
        return node_id.split('-')[0]

    def get_ga(self, node, field, default=None):
        """Get field from graph_attributes or root level."""
        ga = node.get('graph_attributes', {})
        val = ga.get(field)
        if val is not None:
            return val
        return node.get(field, default)

    def assemble_prompt(self, node_id, archetype, audience=None, count=None):
        """Build a complete generation prompt for one node × one archetype."""
        self._load()

        node = self._nodes.get(node_id)
        if not node:
            raise ValueError(f"Node {node_id} not found")

        pov = self.get_pov(node_id)
        arch_def = ARCHETYPES[archetype]

        if count is None:
            lo, hi = arch_def['count']
            count = hi

        # ── Core node context ──
        label = node.get('label', '')
        description = node.get('description', '')
        epistemic_type = self.get_ga(node, 'epistemic_type', 'unspecified')
        category = node.get('category', '')
        excludes = _extract_excludes(description)
        encompasses = _extract_encompasses(description)

        # ── POV register anchoring ──
        profile = self._profiles.get(pov, {})
        exemplars = profile.get('exemplar_claims', [])
        vocab_summary = _format_vocab_summary(profile)

        # ── Archetype-specific fields ──
        assumes = self.get_ga(node, 'assumes', [])
        policy_actions = self.get_ga(node, 'policy_actions', [])
        lineage = self.get_ga(node, 'intellectual_lineage', [])
        steelman = self.get_ga(node, 'steelman_vulnerability', '')
        fallacies = self.get_ga(node, 'possible_fallacies', [])
        rhetorical_strategy = self.get_ga(node, 'rhetorical_strategy', '')

        # ── Neighbors ──
        nb_data = self._neighbors.get(node_id, {})
        neighbors = nb_data.get('neighbors', [])

        # ── Assemble system prompt ──
        sys_prompt = SYSTEM_PROMPT.format(
            archetype=archetype,
            node_id=node_id,
        )

        # ── Assemble user prompt ──
        sections = []

        # Section 1: Core node info
        sections.append(f"""\
NODE: {node_id}
Label: {label}
Category: {category}
Epistemic type: {epistemic_type}
POV camp: {POV_NAMES.get(pov, pov)}

Description:
  {description[:500]}""")

        # Section 2: POV exemplars
        sections.append(f"""\
POV REGISTER EXAMPLES — Real {POV_NAMES.get(pov, pov)} debate claims sound like this:
{_format_exemplars(exemplars)}

Match this register and vocabulary naturally. Key patterns for {POV_NAMES.get(pov, pov)} discourse:
  {vocab_summary}""")

        # Section 3: Archetype-specific instructions
        arch_instruction = ARCHETYPE_INSTRUCTIONS[archetype].format(
            count=count,
            label=label,
            description=description[:400],
            epistemic_type=epistemic_type,
            assumes=_format_assumes(assumes),
            policy_actions=_format_policy_actions(policy_actions),
            lineage=_format_lineage(lineage),
            steelman=steelman[:400] if steelman else 'No steelman vulnerability documented.',
            encompasses=encompasses or 'No specific examples listed.',
            fallacies=_format_fallacies(fallacies),
            rhetorical_strategy=rhetorical_strategy or 'No specific strategy documented.',
        )
        sections.append(arch_instruction)

        # Section 3b: Audience modulation (if requested)
        if audience and audience in AUDIENCE_OVERLAYS:
            overlay = AUDIENCE_OVERLAYS[audience]
            sections.append(AUDIENCE_INSTRUCTION_TEMPLATE.format(
                audience_name=audience.replace('_', ' ').title(),
                register=overlay['register'],
                audience_instruction=overlay['instruction'],
                archetype_name=arch_def['name'],
            ))

        # Section 4: Contrastive negatives (critical — placed near end for salience)
        neg_lines = []
        if excludes:
            neg_lines.append(f"EXCLUSION BOUNDARY (hard constraint):\n  This node EXCLUDES: {excludes}")
            neg_lines.append("  Statements that express excluded concepts will be discarded.")
        neg_lines.append(f"\nCONFUSABLE NEIGHBORS — generate statements that express THIS node, NOT these:")
        neg_lines.append(_format_neighbors(neighbors))
        if neighbors:
            top_nb = neighbors[0]
            neg_lines.append(
                f"\n  Your closest neighbor is {top_nb.get('node_id', '?')} "
                f"(\"{top_nb.get('label', '')[:80]}\"). "
                f"Every statement must be clearly distinguishable from this neighbor."
            )
        sections.append('\n'.join(neg_lines))

        # Section 5: Diversity + output format (at the end for salience)
        sections.append(f"""\
DIVERSITY REQUIREMENT:
Generate exactly {count} statements. Each must:
- Express a genuinely different facet, framing, or angle of this node's position
- Use different vocabulary, sentence structure, and opening patterns
- Sound like a real debater's claim, not an academic summary or textbook definition

OUTPUT: Return ONLY a JSON array — no other text:
[
  {{"statement": "...", "archetype": "{archetype}", "rationale": "..."}}
]""")

        user_prompt = '\n\n'.join(sections)
        return {'system': sys_prompt, 'user': user_prompt, 'archetype': archetype,
                'audience': audience, 'node_id': node_id, 'count': count}

    def get_node_allocation(self, node_id):
        """Return the full archetype + audience allocation for a node."""
        self._load()
        node = self._nodes.get(node_id)
        if not node:
            return []

        allocation = []

        for arch_key, arch_def in ARCHETYPES.items():
            lo, hi = arch_def['count']

            has_field = True
            if arch_key == 'policy_implication':
                has_field = bool(self.get_ga(node, 'policy_actions', []))
            elif arch_key == 'intellectual_lineage':
                has_field = bool(self.get_ga(node, 'intellectual_lineage', []))
            elif arch_key == 'defensive_formulation':
                has_field = bool(self.get_ga(node, 'steelman_vulnerability', ''))
            elif arch_key == 'counterargument_response':
                has_field = bool(self.get_ga(node, 'possible_fallacies', []))

            if has_field:
                allocation.append({
                    'archetype': arch_key,
                    'audience': None,
                    'count': hi,
                    'has_field_data': True,
                })
            else:
                allocation.append({
                    'archetype': arch_key,
                    'audience': None,
                    'count': lo,
                    'has_field_data': False,
                })

        for arch_key in AUDIENCE_MODULATED_ARCHETYPES:
            for audience in AUDIENCE_OVERLAYS:
                allocation.append({
                    'archetype': arch_key,
                    'audience': audience,
                    'count': AUDIENCE_STATEMENTS_PER_SLOT,
                    'has_field_data': True,
                })

        primary_count = sum(a['count'] for a in allocation if a['audience'] is None)
        audience_count = sum(a['count'] for a in allocation if a['audience'] is not None)
        total = primary_count + audience_count

        return allocation, primary_count, audience_count, total

    def generate_all_prompts(self, node_id):
        """Generate all prompts for a node's full allocation."""
        allocation, primary, audience, total = self.get_node_allocation(node_id)

        prompts = []
        for slot in allocation:
            prompt = self.assemble_prompt(
                node_id, slot['archetype'],
                audience=slot['audience'],
                count=slot['count'],
            )
            prompt['slot'] = slot
            prompts.append(prompt)

        return prompts, primary, audience, total


def filter_by_rationale(statements, node_id, neighbor_ids):
    """Filter out statements whose rationale reveals neighbor expression or platitude.

    Returns (kept, filtered) tuple.
    """
    kept = []
    filtered = []
    neighbor_set = set(neighbor_ids)

    for s in statements:
        rationale = s.get('rationale', '').lower()
        statement = s.get('statement', '')

        reject = False
        reject_reason = None

        for nid in neighbor_set:
            if nid.lower() in rationale and ('express' in rationale or 'closer to' in rationale
                                              or 'actually about' in rationale):
                reject = True
                reject_reason = f'rationale references neighbor {nid}'
                break

        if not reject:
            generic_markers = ['any node', 'generic', 'platitude', 'general statement',
                               'could apply to', 'not specific']
            for marker in generic_markers:
                if marker in rationale:
                    reject = True
                    reject_reason = f'rationale contains generic marker: "{marker}"'
                    break

        if not reject and len(statement.split()) < 8:
            reject = True
            reject_reason = 'statement too short (<8 words)'

        if reject:
            s['filter_reason'] = reject_reason
            filtered.append(s)
        else:
            kept.append(s)

    return kept, filtered


def main():
    parser = argparse.ArgumentParser(description='Archetype prompt template test harness')
    parser.add_argument('--node-id', type=str, help='Generate prompts for this node')
    parser.add_argument('--archetype', type=str, choices=list(ARCHETYPES.keys()),
                        help='Specific archetype (default: all)')
    parser.add_argument('--audience', type=str, choices=list(AUDIENCE_OVERLAYS.keys()),
                        help='Audience overlay')
    parser.add_argument('--all', action='store_true', help='Show full allocation')
    parser.add_argument('--test', action='store_true', help='Test across 3 POV sample nodes')
    parser.add_argument('--stats', action='store_true', help='Show allocation stats for all nodes')
    args = parser.parse_args()

    assembler = PromptAssembler()

    if args.stats:
        print("Computing allocation stats across all nodes...\n")
        assembler._load()
        totals = []
        missing_fields = defaultdict(int)
        for nid in sorted(assembler._nodes.keys()):
            alloc, primary, audience, total = assembler.get_node_allocation(nid)
            totals.append(total)
            for slot in alloc:
                if not slot['has_field_data'] and slot['audience'] is None:
                    missing_fields[slot['archetype']] += 1

        arr = sorted(totals)
        print(f"Nodes: {len(arr)}")
        print(f"Allocation per node: min={min(arr)}, max={max(arr)}, "
              f"median={arr[len(arr)//2]}, mean={sum(arr)/len(arr):.1f}")
        print(f"Total statements to generate: {sum(arr)}")
        print(f"\nNodes missing field data per archetype:")
        for arch, count in sorted(missing_fields.items(), key=lambda x: x[1], reverse=True):
            print(f"  {arch}: {count} nodes use minimum count")
        return

    if args.test:
        test_nodes = ['acc-beliefs-003', 'saf-beliefs-023', 'skp-beliefs-036']
        for nid in test_nodes:
            print(f"\n{'=' * 70}")
            print(f"  TEST NODE: {nid}")
            print(f"{'=' * 70}")

            node = assembler.get_node(nid)
            if not node:
                print(f"  Node not found!")
                continue

            alloc, primary, audience, total = assembler.get_node_allocation(nid)
            print(f"  Label: {node.get('label', '')[:60]}")
            print(f"  Allocation: {primary} primary + {audience} audience = {total} total")

            prompt = assembler.assemble_prompt(nid, 'surface_claim')
            print(f"\n  ── Surface Claim prompt ({len(prompt['user'])} chars) ──")
            print(f"  System: {prompt['system'][:200]}...")
            print(f"  User (first 500 chars):")
            for line in prompt['user'][:500].split('\n'):
                print(f"    {line}")
            print(f"  ... ({len(prompt['user'])} total chars)")

            prompt2 = assembler.assemble_prompt(nid, 'assumption_expression')
            print(f"\n  ── Assumption Expression prompt ({len(prompt2['user'])} chars) ──")
            print(f"  User (first 500 chars):")
            for line in prompt2['user'][:500].split('\n'):
                print(f"    {line}")

            prompt3 = assembler.assemble_prompt(nid, 'defensive_formulation')
            print(f"\n  ── Defensive Formulation prompt ({len(prompt3['user'])} chars) ──")
            print(f"  User (first 300 chars):")
            for line in prompt3['user'][:300].split('\n'):
                print(f"    {line}")

        return

    if args.node_id:
        node = assembler.get_node(args.node_id)
        if not node:
            print(f"Node {args.node_id} not found")
            sys.exit(1)

        print(f"Node: {args.node_id}")
        print(f"Label: {node.get('label', '')}")
        print(f"Category: {node.get('category', '')}")

        if args.all:
            prompts, primary, audience, total = assembler.generate_all_prompts(args.node_id)
            print(f"\nFull allocation: {primary} primary + {audience} audience = {total} total")
            print(f"Prompt count: {len(prompts)}")
            for i, p in enumerate(prompts):
                slot = p['slot']
                aud = f" [{slot['audience']}]" if slot['audience'] else ""
                print(f"\n  [{i+1}] {slot['archetype']}{aud} "
                      f"(count={slot['count']}, chars={len(p['user'])})")
            return

        archetype = args.archetype or 'surface_claim'
        prompt = assembler.assemble_prompt(args.node_id, archetype,
                                           audience=args.audience)

        print(f"\nArchetype: {archetype}")
        if args.audience:
            print(f"Audience: {args.audience}")
        print(f"\n{'─' * 60}")
        print("SYSTEM PROMPT:")
        print(prompt['system'])
        print(f"\n{'─' * 60}")
        print("USER PROMPT:")
        print(prompt['user'])
        print(f"\n{'─' * 60}")
        print(f"Total user prompt length: {len(prompt['user'])} chars")
        return

    parser.print_help()


if __name__ == '__main__':
    main()
