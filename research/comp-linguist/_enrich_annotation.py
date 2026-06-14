"""Enrich annotation template with debate context and taxonomy index.

For each claim, embeds the surrounding debate turns so the annotation tool
can show the utterance in context without filesystem access. Also embeds
a lightweight taxonomy index for node search.
"""
import json
import os
import glob

RESEARCH_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(RESEARCH_DIR))

def resolve_data_root():
    cfg_path = os.path.join(REPO_ROOT, '.aitriad.json')
    with open(cfg_path, encoding='utf-8') as f:
        cfg = json.load(f)
    data_root = cfg.get('data_root', '.')
    if not os.path.isabs(data_root):
        data_root = os.path.join(REPO_ROOT, data_root)
    return os.path.normpath(data_root)

def find_debate_file(debates_dir, short_id):
    pattern = os.path.join(debates_dir, f'debate-{short_id}*.json')
    matches = glob.glob(pattern)
    return matches[0] if matches else None

def load_debate_data(path):
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    return data

def find_claim_in_transcript(transcript, claim_id, debate_data):
    """Find which transcript turn contains the claim, using source_entry_id."""
    an_nodes = debate_data.get('argument_network', {}).get('nodes', [])
    for node in an_nodes:
        if node.get('id') == claim_id:
            entry_id = node.get('source_entry_id')
            if entry_id:
                for i, t in enumerate(transcript):
                    if t.get('id') == entry_id:
                        return i
            break
    return None


def extract_context(transcript, turn_idx, window=2):
    """Extract turns around the target turn, marking the claim turn."""
    start = max(0, turn_idx - window)
    end = min(len(transcript), turn_idx + window + 1)

    context_turns = []
    for i in range(start, end):
        t = transcript[i]
        content = t.get('content', '')
        is_claim = i == turn_idx
        if not is_claim and len(content) > 1200:
            content = content[:1200] + '...'
        context_turns.append({
            'turn_index': i,
            'speaker': t.get('speaker', 'unknown'),
            'type': t.get('type', 'unknown'),
            'content': content,
            'is_claim_turn': is_claim
        })
    return context_turns


def extract_prompt_context(debate_data, entry_id):
    """Extract taxonomy_context and taxonomy_refs from debate diagnostics."""
    result = {}

    # taxonomy_refs from transcript entry
    for t in debate_data.get('transcript', []):
        if t.get('id') == entry_id:
            refs = t.get('taxonomy_refs', [])
            if refs:
                result['taxonomy_refs'] = refs
            break

    # taxonomy_context and prompt from diagnostics
    diag_entries = debate_data.get('diagnostics', {}).get('entries', {})
    diag = diag_entries.get(entry_id, {})
    if diag:
        tax_ctx = diag.get('taxonomy_context', '')
        if tax_ctx and len(tax_ctx) > 8000:
            tax_ctx = tax_ctx[:8000] + '...'
        if tax_ctx:
            result['taxonomy_context'] = tax_ctx
        prompt = diag.get('prompt', '')
        if prompt and len(prompt) > 4000:
            prompt = prompt[:4000] + '...'
        if prompt:
            result['prompt_excerpt'] = prompt

    return result if result else None

POV_MAP = {
    'accelerationist': 'acc',
    'safetyist': 'saf',
    'skeptic': 'skp',
}

def load_taxonomy_index(tax_dir):
    """Load lightweight node index from taxonomy JSONs."""
    nodes = []
    for fname in ['accelerationist.json', 'safetyist.json', 'skeptic.json']:
        path = os.path.join(tax_dir, fname)
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        pov_long = data.get('pov', '')
        pov = POV_MAP.get(pov_long, pov_long)
        for node in data.get('nodes', []):
            desc = node.get('description', '')
            if len(desc) > 200:
                desc = desc[:200] + '...'
            nodes.append({
                'id': node['id'],
                'label': node.get('label', ''),
                'pov': pov,
                'bdi': node.get('category', '').lower(),
                'desc': desc,
            })
    return nodes

def main():
    data_root = resolve_data_root()
    tax_dir = os.path.join(data_root, 'taxonomy', 'Origin')
    debates_dir = os.path.join(data_root, 'debates')

    template_path = os.path.join(RESEARCH_DIR, '_annotation_template.json')
    golden_path = os.path.join(RESEARCH_DIR, '_golden_test_set.json')

    with open(template_path, encoding='utf-8') as f:
        template = json.load(f)

    with open(golden_path, encoding='utf-8') as f:
        golden = json.load(f)

    golden_lookup = {c['claim_id']: c for c in golden['claims']}

    debate_cache = {}
    enriched = 0
    missing_debate = 0
    missing_golden = 0

    for claim in template['claims']:
        cid = claim['claim_id']
        golden_claim = golden_lookup.get(cid)
        if not golden_claim:
            missing_golden += 1
            continue

        debate_id = golden_claim.get('debate_id', '')
        turn_number = golden_claim.get('turn_number')
        debate_title = golden_claim.get('debate_title', '')

        claim['turn_number'] = turn_number
        claim['debate_title'] = debate_title

        if not debate_id:
            continue

        if debate_id not in debate_cache:
            path = find_debate_file(debates_dir, debate_id)
            if path:
                debate_cache[debate_id] = load_debate_data(path)
            else:
                debate_cache[debate_id] = None
                missing_debate += 1

        debate_data = debate_cache[debate_id]
        if debate_data is None:
            continue

        transcript = debate_data.get('transcript', [])
        an_claim_id = golden_claim.get('claim_id', cid)
        found_idx = find_claim_in_transcript(transcript, an_claim_id, debate_data)
        if found_idx is None:
            print(f"  WARNING: Could not find claim {cid} (AN={an_claim_id}) in debate {debate_id}")
            continue

        context = extract_context(transcript, found_idx, window=2)
        claim['debate_context'] = context
        claim['transcript_index'] = found_idx

        entry_id = transcript[found_idx].get('id')
        if entry_id:
            prompt_ctx = extract_prompt_context(debate_data, entry_id)
            if prompt_ctx:
                claim['prompt_context'] = prompt_ctx

        enriched += 1

    template['metadata']['debate_context_added'] = True
    template['metadata']['context_window'] = 2

    tax_nodes = load_taxonomy_index(tax_dir)
    template['taxonomy_index'] = tax_nodes
    template['metadata']['taxonomy_nodes_count'] = len(tax_nodes)

    output_path = os.path.join(RESEARCH_DIR, '_annotation_template.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(template, f, indent=2, ensure_ascii=False)

    print(f"Enriched {enriched}/{len(template['claims'])} claims with debate context")
    print(f"Missing from golden set: {missing_golden}")
    print(f"Missing debate files: {missing_debate}")
    print(f"Unique debates loaded: {len([v for v in debate_cache.values() if v is not None])}")
    print(f"Taxonomy index: {len(tax_nodes)} nodes embedded")

if __name__ == '__main__':
    main()
