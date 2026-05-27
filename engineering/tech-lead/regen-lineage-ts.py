"""Regenerate intellectualLineageInfo.ts from lineage-enrichments.json cache."""
import json

cache_path = '../ai-triad-data/calibration/lineage-enrichments.json'
output_path = 'taxonomy-editor/src/renderer/data/intellectualLineageInfo.ts'

cache = json.load(open(cache_path, encoding='utf-8'))

# Build TypeScript file
lines = [
    '// Copyright (c) 2026 Jeffrey Snover. All rights reserved.',
    '// Licensed under the MIT License. See LICENSE file in the project root.',
    '',
    '// Auto-generated from calibration/lineage-enrichments.json',
    '// Do not edit manually — regenerate with engineering/tech-lead/regen-lineage-ts.py',
    '',
    "import type { AttributeInfo } from './epistemicTypeInfo';",
    '',
    'export const INTELLECTUAL_LINEAGES: Record<string, AttributeInfo> = {',
]

for name in sorted(cache.keys()):
    entry = cache[name]
    desc = entry.get('description', '') or ''
    url = entry.get('url', '') or ''
    category = entry.get('category', '') or ''

    # Build AttributeInfo shape
    summary = desc.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')
    label = name.replace('\\', '\\\\').replace('"', '\\"')

    # Build links array
    links = []
    if url:
        safe_url = url.replace('\\', '\\\\').replace('"', '\\"')
        links.append(f'{{ label: "Reference", url: "{safe_url}" }}')

    links_str = ', '.join(links)
    freq = f'Category: {category}' if category else ''

    lines.append(f'"{label}": {{')
    lines.append(f'  label: "{label}",')
    lines.append(f'  summary: "{summary}",')
    lines.append(f'  example: "",')
    lines.append(f'  frequency: "{freq}",')
    lines.append(f'  links: [{links_str}]')
    lines.append('},')

lines.append('};')
lines.append('')

content = '\n'.join(lines)
with open(output_path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f'Generated {output_path}: {len(cache)} entries, {len(content)} bytes')
