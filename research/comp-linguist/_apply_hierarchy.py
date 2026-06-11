"""t/538: Apply parent assignments to 136 standalone situation nodes.

Phases:
  1. Structural changes: split sit-154, split sit-159, merge sit-156/sit-157
  2. Apply 51 high-confidence assignments from clustering
  3. LLM-assisted classification for 85 medium/low-confidence standalones
  4. Validation
"""
import json, sys, os, time, math, copy
from collections import defaultdict, Counter

sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin'
SITUATIONS_PATH = os.path.join(DATA_ROOT, 'situations.json')
EMBEDDINGS_PATH = os.path.join(DATA_ROOT, 'embeddings.json')
PROPOSALS_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_t528_cluster_proposals.json'
OUTPUT_PATH = os.path.join(DATA_ROOT, 'situations.json')
BACKUP_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_situations_backup.json'
REPORT_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_t538_migration_report.json'

NEW_ROOT_IDS = {
    'regulatory': 'sit-170',
    'geopolitical': 'sit-171',
    'deployment_ops': 'sit-172',
}


def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


# ── Load data ──
print("Loading situations...")
with open(SITUATIONS_PATH, encoding='utf-8') as f:
    sit_data = json.load(f)

# Backup
print("Creating backup...")
with open(BACKUP_PATH, 'w', encoding='utf-8') as f:
    json.dump(sit_data, f, indent=2, ensure_ascii=False)

nodes = sit_data['nodes']
node_map = {n['id']: n for n in nodes}
node_index = {n['id']: i for i, n in enumerate(nodes)}

print("Loading embeddings...")
with open(EMBEDDINGS_PATH, encoding='utf-8') as f:
    emb_data = json.load(f)
emb_nodes = emb_data.get('nodes', {})

print("Loading clustering proposals...")
with open(PROPOSALS_PATH, encoding='utf-8') as f:
    proposals_data = json.load(f)
proposals = proposals_data['proposals']
proposal_map = {p['node_id']: p for p in proposals}

changes_log = []


def set_parent(node_id, parent_id, relationship, rationale):
    node = node_map[node_id]
    node['parent_id'] = parent_id
    node['parent_relationship'] = relationship
    node['parent_rationale'] = rationale
    parent = node_map[parent_id]
    if 'children' not in parent:
        parent['children'] = []
    if node_id not in parent['children']:
        parent['children'].append(node_id)
    changes_log.append({
        'action': 'set_parent',
        'node_id': node_id,
        'parent_id': parent_id,
        'relationship': relationship,
    })


def remove_child(node_id, parent_id):
    parent = node_map[parent_id]
    if 'children' in parent and node_id in parent['children']:
        parent['children'].remove(node_id)


def create_root_category(node_id, label, description):
    template = node_map['sit-153']
    new_node = {
        'id': node_id,
        'label': label,
        'description': description,
        'interpretations': {
            'accelerationist': f'From an accelerationist perspective, {label.lower()} represents an opportunity for innovation-driven governance.',
            'safetyist': f'From a safetyist perspective, {label.lower()} requires careful institutional design to prevent harm.',
            'skeptic': f'From a skeptic perspective, {label.lower()} may reflect overconfidence in our ability to manage complex systems.',
        },
        'linked_nodes': [],
        'conflict_ids': [],
        'children': [],
        'graph_attributes': {
            'epistemic_type': 'analytical',
            'rhetorical_strategy': 'Categorization',
            'assumes': [],
            'falsifiability': 'Category node — organizational, not directly falsifiable.',
            'audience': 'All stakeholders',
            'emotional_register': 'neutral',
            'policy_actions': [],
            'intellectual_lineage': [],
            'steelman_vulnerability': '',
            'possible_fallacies': [],
            'node_scope': 'scheme',
        },
        'interpretation_divergence': 'moderate',
    }
    nodes.append(new_node)
    node_map[node_id] = new_node
    node_index[node_id] = len(nodes) - 1
    changes_log.append({'action': 'create_root', 'node_id': node_id, 'label': label})
    print(f"  Created root: {node_id} — {label}")


# ══════════════════════════════════════════════════════════════
# PHASE 1: STRUCTURAL CHANGES
# ══════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("PHASE 1: STRUCTURAL CHANGES")
print("=" * 60)

# ── 1a. Split sit-154 ──
print("\n1a. Splitting sit-154 (39 children)...")

create_root_category(
    'sit-170',
    'Regulatory Process and Mechanisms',
    'A situation that examines the design, implementation, and effectiveness of regulatory mechanisms for artificial intelligence.\nEncompasses: Evidence requirements for regulation, regulatory fragmentation, compliance costs, agency capacity, iterative governance processes, and regulatory timing dilemmas.\nExcludes: International competition and geopolitical strategy (sit-171), and specific policy domains like military use (sit-160) or economic impact (sit-158).',
)
create_root_category(
    'sit-171',
    'Geopolitical AI Strategy and Competition',
    'A situation that examines how nations and blocs compete for advantage in artificial intelligence development and deployment.\nEncompasses: National AI strategies, sovereign AI initiatives, international AI governance, technology transfer, strategic framing of AI assets, and cross-border regulatory coordination.\nExcludes: Domestic regulatory process details (sit-170) and military-specific applications (sit-160).',
)

GEOPOLITICAL_KEYWORDS = [
    'nation', 'national', 'sovereign', 'geopolit', 'international', 'race',
    'manhattan project', 'competition', 'strategic', 'global govern', 'cross-border',
    'eu ', 'european', 'china', 'united states', 'federal',
]
REGULATORY_KEYWORDS = [
    'regulat', 'rule-making', 'compliance', 'enforcement', 'evidence',
    'proof', 'policy instrument', 'governance mechanism', 'oversight',
    'preempt', 'fragmentation', 'license', 'audit', 'standard',
]

sit154_children = list(node_map['sit-154'].get('children', []))
print(f"  sit-154 has {len(sit154_children)} children to reclassify")

geo_nodes = []
reg_nodes = []

for cid in sit154_children:
    child = node_map.get(cid, {})
    text = (child.get('label', '') + ' ' + child.get('description', '')).lower()
    geo_score = sum(1 for kw in GEOPOLITICAL_KEYWORDS if kw in text)
    reg_score = sum(1 for kw in REGULATORY_KEYWORDS if kw in text)

    if geo_score > reg_score:
        geo_nodes.append(cid)
    elif reg_score > geo_score:
        reg_nodes.append(cid)
    else:
        # Use embedding similarity as tiebreaker
        if cid in emb_nodes and 'sit-170' not in emb_nodes:
            reg_nodes.append(cid)
        else:
            reg_nodes.append(cid)

# Move geopolitical nodes to sit-171
for cid in geo_nodes:
    remove_child(cid, 'sit-154')
    old_rel = node_map[cid].get('parent_relationship', 'part_of')
    old_rat = node_map[cid].get('parent_rationale', '')
    set_parent(cid, 'sit-171', old_rel, old_rat)

# Move regulatory nodes to sit-170
for cid in reg_nodes:
    remove_child(cid, 'sit-154')
    old_rel = node_map[cid].get('parent_relationship', 'part_of')
    old_rat = node_map[cid].get('parent_rationale', '')
    set_parent(cid, 'sit-170', old_rel, old_rat)

# sit-154 is now empty — remove children field
node_map['sit-154']['children'] = []
print(f"  → sit-170 (Regulatory): {len(reg_nodes)} nodes")
print(f"  → sit-171 (Geopolitical): {len(geo_nodes)} nodes")

# ── 1b. Merge sit-156 + sit-157 ──
print("\n1b. Merging sit-156 + sit-157...")

node_map['sit-157']['label'] = 'AI Evaluation, Performance, and Real-World Impact'
node_map['sit-157']['description'] = (
    'A situation that examines how AI systems perform in practice, how their impact is measured, '
    'and how evaluation methodologies shape understanding of AI capabilities and limitations.\n'
    'Encompasses: Benchmarking, real-world deployment outcomes, metric optimization tradeoffs, '
    'performance-error analysis, citation-based impact measurement, and AI growth constraints.\n'
    'Excludes: System architecture and design patterns (sit-159), and economic/labor market impact (sit-158).'
)

# Move sit-156 children to sit-157
sit156_children = list(node_map['sit-156'].get('children', []))
for cid in sit156_children:
    remove_child(cid, 'sit-156')
    old_rel = node_map[cid].get('parent_relationship', 'part_of')
    old_rat = node_map[cid].get('parent_rationale', '')
    set_parent(cid, 'sit-157', old_rel, old_rat)

node_map['sit-156']['children'] = []
node_map['sit-156']['description'] = '[DEPRECATED — merged into sit-157] ' + node_map['sit-156']['description']
print(f"  → Moved {len(sit156_children)} children from sit-156 to sit-157")
print(f"  → sit-157 now has {len(node_map['sit-157'].get('children', []))} children")

# ── 1c. Split sit-159 ──
print("\n1c. Splitting sit-159...")

create_root_category(
    'sit-172',
    'AI Deployment, Monitoring, and Operations',
    'A situation that examines the operational challenges of deploying, monitoring, and maintaining AI systems in production.\n'
    'Encompasses: Alert fatigue, monitoring strategies, maintenance thresholds, deployment evaluation, '
    'operational risk attribution, and production reliability patterns.\n'
    'Excludes: Theoretical system architecture (sit-159) and benchmarking methodology (sit-157).',
)

DEPLOY_OPS_KEYWORDS = [
    'deploy', 'monitor', 'alert', 'operation', 'maintenance', 'production',
    'runtime', 'incident', 'observ', 'reliab', 'failur', 'outage',
    'scaling', 'infra', 'pipeline',
]
ARCHITECTURE_KEYWORDS = [
    'architect', 'design', 'pattern', 'framework', 'system design',
    'component', 'interface', 'abstract', 'model', 'specification',
]

sit159_children = list(node_map['sit-159'].get('children', []))
ops_nodes = []
arch_nodes = []

for cid in sit159_children:
    child = node_map.get(cid, {})
    text = (child.get('label', '') + ' ' + child.get('description', '')).lower()
    ops_score = sum(1 for kw in DEPLOY_OPS_KEYWORDS if kw in text)
    arch_score = sum(1 for kw in ARCHITECTURE_KEYWORDS if kw in text)

    if ops_score > arch_score:
        ops_nodes.append(cid)
    else:
        arch_nodes.append(cid)

for cid in ops_nodes:
    remove_child(cid, 'sit-159')
    old_rel = node_map[cid].get('parent_relationship', 'part_of')
    old_rat = node_map[cid].get('parent_rationale', '')
    set_parent(cid, 'sit-172', old_rel, old_rat)

print(f"  → sit-159 (Architecture): {len(arch_nodes)} nodes")
print(f"  → sit-172 (Operations): {len(ops_nodes)} nodes")

# Update sit-159 description
node_map['sit-159']['label'] = 'AI System Architecture and Design'
node_map['sit-159']['description'] = (
    'A situation that examines the architectural design, structural patterns, and theoretical frameworks '
    'underlying AI system construction.\n'
    'Encompasses: Design patterns, compositional architectures, control-flow integrity, safety-by-design, '
    'specification methods, and system modeling approaches.\n'
    'Excludes: Operational deployment and monitoring (sit-172) and benchmarking (sit-157).'
)

# ══════════════════════════════════════════════════════════════
# PHASE 2: HIGH-CONFIDENCE ASSIGNMENTS
# ══════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("PHASE 2: HIGH-CONFIDENCE ASSIGNMENTS")
print("=" * 60)

# Get current standalones (after structural changes)
all_parent_ids = set()
for n in nodes:
    if n.get('children'):
        all_parent_ids.add(n['id'])
standalones = [n for n in nodes if not n.get('parent_id') and n['id'] not in all_parent_ids]
standalone_ids = set(n['id'] for n in standalones)

# Map old proposed parents to new parents after splits
PARENT_REMAP = {
    'sit-156': 'sit-157',  # merged
}

high_conf_applied = 0
for p in proposals:
    nid = p['node_id']
    if nid not in standalone_ids:
        continue
    if p.get('confidence') != 'high':
        continue
    if p.get('ambiguous', False):
        continue

    parent = p['proposed_parent']
    parent = PARENT_REMAP.get(parent, parent)

    if parent not in node_map:
        continue

    # For sit-154 proposals, reclassify to sit-170 or sit-171
    if parent == 'sit-154':
        child = node_map[nid]
        text = (child.get('label', '') + ' ' + child.get('description', '')).lower()
        geo_score = sum(1 for kw in GEOPOLITICAL_KEYWORDS if kw in text)
        reg_score = sum(1 for kw in REGULATORY_KEYWORDS if kw in text)
        parent = 'sit-171' if geo_score > reg_score else 'sit-170'

    rel = p.get('proposed_relationship', 'part_of')
    set_parent(nid, parent, rel, f'Embedding clustering (similarity={p["similarity"]:.3f})')
    high_conf_applied += 1

print(f"  Applied {high_conf_applied} high-confidence assignments")

# ══════════════════════════════════════════════════════════════
# PHASE 3: LLM-ASSISTED CLASSIFICATION
# ══════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("PHASE 3: LLM-ASSISTED CLASSIFICATION")
print("=" * 60)

# Refresh standalone list
all_parent_ids_2 = set()
for n in nodes:
    if n.get('children'):
        all_parent_ids_2.add(n['id'])
remaining = [n for n in nodes if not n.get('parent_id') and n['id'] not in all_parent_ids_2]
print(f"  {len(remaining)} nodes still need parents")

# Build root category descriptions for LLM prompt
active_roots = [n for n in nodes if n['id'] in all_parent_ids_2 and not n.get('parent_id')]
# Also include new roots
for rid in ['sit-170', 'sit-171', 'sit-172']:
    if node_map.get(rid) and node_map[rid] not in active_roots:
        active_roots.append(node_map[rid])
# Exclude deprecated sit-156 and empty sit-154
active_roots = [r for r in active_roots if r['id'] not in ('sit-156', 'sit-154')]

root_descriptions = ""
for r in sorted(active_roots, key=lambda x: x['id']):
    root_descriptions += f"- {r['id']}: {r['label']}\n  {r['description'][:200]}\n\n"

CLASSIFY_PROMPT = """Classify this situation node into the most appropriate parent category.

Available categories:
{categories}

Node to classify:
ID: {node_id}
Label: {label}
Description: {description}

Respond with EXACTLY this format (nothing else):
PARENT: <category_id>
RELATIONSHIP: <part_of|is_a|specializes>
RATIONALE: <one sentence explaining the classification>

Relationship type guide:
- part_of: node is a component/aspect of the parent topic
- is_a: node is a specific instance/case of the parent category
- specializes: node narrows the parent's scope to a specific domain"""

if remaining:
    import google.generativeai as genai
    genai.configure(api_key=os.environ.get('GEMINI_API_KEY', os.environ.get('AI_API_KEY', '')))
    model = genai.GenerativeModel('gemini-2.5-flash')

    llm_applied = 0
    llm_errors = 0

    for i, node in enumerate(remaining):
        prompt = CLASSIFY_PROMPT.format(
            categories=root_descriptions,
            node_id=node['id'],
            label=node.get('label', ''),
            description=node.get('description', '')[:300],
        )
        try:
            response = model.generate_content(prompt)
            text = response.text.strip()

            parent_match = None
            rel_match = 'part_of'
            rat_match = ''

            for line in text.split('\n'):
                line = line.strip()
                if line.startswith('PARENT:'):
                    parent_match = line.split(':', 1)[1].strip()
                elif line.startswith('RELATIONSHIP:'):
                    rel_match = line.split(':', 1)[1].strip()
                elif line.startswith('RATIONALE:'):
                    rat_match = line.split(':', 1)[1].strip()

            if parent_match and parent_match in node_map:
                set_parent(node['id'], parent_match, rel_match, rat_match)
                llm_applied += 1
            else:
                # Fallback to clustering proposal
                p = proposal_map.get(node['id'])
                if p and p.get('proposed_parent'):
                    parent = PARENT_REMAP.get(p['proposed_parent'], p['proposed_parent'])
                    if parent == 'sit-154':
                        child_text = (node.get('label', '') + ' ' + node.get('description', '')).lower()
                        geo_s = sum(1 for kw in GEOPOLITICAL_KEYWORDS if kw in child_text)
                        reg_s = sum(1 for kw in REGULATORY_KEYWORDS if kw in child_text)
                        parent = 'sit-171' if geo_s > reg_s else 'sit-170'
                    set_parent(node['id'], parent, 'part_of',
                               f'LLM returned invalid parent ({parent_match}), fell back to clustering')
                    llm_applied += 1
                else:
                    llm_errors += 1
                    print(f"  ERROR: {node['id']} — no valid parent from LLM or clustering")

            if (i + 1) % 25 == 0:
                print(f"  {i+1}/{len(remaining)} classified")

        except Exception as e:
            llm_errors += 1
            print(f"  ERROR on {node['id']}: {e}")
            p = proposal_map.get(node['id'])
            if p and p.get('proposed_parent'):
                parent = PARENT_REMAP.get(p['proposed_parent'], p['proposed_parent'])
                if parent == 'sit-154':
                    parent = 'sit-170'
                set_parent(node['id'], parent, 'part_of', f'LLM error, fell back to clustering')
                llm_applied += 1

        time.sleep(0.15)

    print(f"\n  LLM classified: {llm_applied}")
    print(f"  LLM errors (no fallback): {llm_errors}")

# ══════════════════════════════════════════════════════════════
# PHASE 4: VALIDATION
# ══════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("PHASE 4: VALIDATION")
print("=" * 60)

# Refresh
all_parent_ids_3 = set()
children_of_3 = defaultdict(list)
for n in nodes:
    if n.get('children'):
        all_parent_ids_3.add(n['id'])
    pid = n.get('parent_id')
    if pid:
        children_of_3[pid].append(n['id'])

still_orphaned = [n for n in nodes if not n.get('parent_id') and n['id'] not in all_parent_ids_3]
print(f"  Orphaned nodes: {len(still_orphaned)}")
if still_orphaned:
    for n in still_orphaned[:10]:
        print(f"    {n['id']}: {n.get('label', '')[:60]}")

# Category sizes
print("\n  Category sizes:")
oversized = 0
roots_final = [n for n in nodes if n['id'] in all_parent_ids_3 and not n.get('parent_id')]
for r in sorted(roots_final, key=lambda x: x['id']):
    size = len(r.get('children', []))
    flag = ' *** OVERSIZED' if size > 30 else ''
    if size > 30:
        oversized += 1
    print(f"    {r['id']} ({r['label'][:40]}): {size}{flag}")

# Cycle detection
print("\n  Cycle detection...")
cycle_found = False
for n in nodes:
    visited = set()
    current = n['id']
    while current:
        if current in visited:
            print(f"    CYCLE: {n['id']} → ... → {current}")
            cycle_found = True
            break
        visited.add(current)
        current = node_map.get(current, {}).get('parent_id')
if not cycle_found:
    print("    No cycles found.")

# Max depth
max_depth = 0
for n in nodes:
    depth = 0
    current = n.get('parent_id')
    while current:
        depth += 1
        current = node_map.get(current, {}).get('parent_id')
    max_depth = max(max_depth, depth)
print(f"  Max depth: {max_depth}")

# Relationship type distribution
rel_counts = Counter(n.get('parent_relationship', '') for n in nodes if n.get('parent_id'))
print(f"  Relationship types: {dict(rel_counts)}")

# Children array consistency
inconsistent = 0
for n in nodes:
    if n.get('children'):
        for cid in n['children']:
            child = node_map.get(cid)
            if child and child.get('parent_id') != n['id']:
                inconsistent += 1
print(f"  Children-parent inconsistencies: {inconsistent}")

# ── Save ──
print("\n" + "=" * 60)
print("SAVING")
print("=" * 60)

# Remove deprecated sit-154 if empty and sit-156 if empty
for deprecated_id in ['sit-154', 'sit-156']:
    dep_node = node_map.get(deprecated_id)
    if dep_node and not dep_node.get('children', []):
        # Mark as deprecated but keep in file for reference stability
        if 'DEPRECATED' not in dep_node.get('description', ''):
            dep_node['description'] = f'[DEPRECATED] {dep_node.get("description", "")}'

with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(sit_data, f, indent=2, ensure_ascii=False)
print(f"  Written to: {OUTPUT_PATH}")

# Save report
report = {
    'experiment': 't/538 hierarchy migration',
    'changes': len(changes_log),
    'phases': {
        'structural': {
            'sit154_split': {'regulatory': len(reg_nodes), 'geopolitical': len(geo_nodes)},
            'sit156_157_merge': len(sit156_children),
            'sit159_split': {'architecture': len(arch_nodes), 'operations': len(ops_nodes)},
        },
        'high_confidence': high_conf_applied,
        'llm_assisted': llm_applied if remaining else 0,
    },
    'validation': {
        'orphaned': len(still_orphaned),
        'oversized_categories': oversized,
        'max_depth': max_depth,
        'cycles': cycle_found,
        'inconsistencies': inconsistent,
        'relationship_types': dict(rel_counts),
    },
    'changes_log': changes_log,
}
with open(REPORT_PATH, 'w', encoding='utf-8') as f:
    json.dump(report, f, indent=2, ensure_ascii=False)
print(f"  Report: {REPORT_PATH}")
print(f"\n  Total changes: {len(changes_log)}")
print("  DONE.")
