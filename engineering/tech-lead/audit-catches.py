"""Audit all try/catch blocks in taxonomy-editor renderer for flight recorder logging."""
import re, os, json

renderer_dir = 'taxonomy-editor/src/renderer'
results = []

for root, dirs, files in os.walk(renderer_dir):
    for f in files:
        if not f.endswith(('.ts', '.tsx')):
            continue
        filepath = os.path.join(root, f).replace('\\', '/')
        content = open(filepath, encoding='utf-8').read()
        lines = content.split('\n')

        for i, line in enumerate(lines):
            stripped = line.strip()
            if not re.match(r'}\s*catch', stripped) and not re.match(r'catch\s*[\({]', stripped):
                continue

            # Collect catch body (next 15 lines or until brace closes)
            body_lines = []
            brace_depth = 0
            for j in range(i, min(i + 15, len(lines))):
                body_lines.append(lines[j].strip())
                brace_depth += lines[j].count('{') - lines[j].count('}')
                if brace_depth <= 0 and j > i:
                    break

            body = ' '.join(body_lines)

            has_recorder = 'getGlobalRecorder' in body or ('recorder' in body.lower() and '.record(' in body)
            has_console = 'console.warn' in body or 'console.error' in body
            has_set_state = 'set({' in body or 'set(s' in body or 'setState' in body
            is_empty = bool(re.search(r'catch\s*(\([^)]*\))?\s*\{\s*(//[^\n]*)?\s*\}', body))
            has_comment = '/*' in body or '//' in body

            if has_recorder:
                category = 'has_recorder'
            elif has_set_state and has_console:
                category = 'has_state_and_console'
            elif has_set_state:
                category = 'has_state_update'
            elif has_console:
                category = 'has_console_log'
            elif is_empty and has_comment:
                category = 'silent_with_comment'
            elif is_empty:
                category = 'silent_empty'
            else:
                category = 'other'

            results.append({
                'file': filepath,
                'line': i + 1,
                'category': category,
                'preview': body[:150]
            })

# Summary
cats = {}
for r in results:
    cats[r['category']] = cats.get(r['category'], 0) + 1

print(f'Total catch blocks: {len(results)}')
for c, n in sorted(cats.items(), key=lambda x: -x[1]):
    print(f'  {c}: {n}')

# Files by category
for cat in ['silent_empty', 'silent_with_comment', 'other']:
    items = [r for r in results if r['category'] == cat]
    if not items:
        continue
    print(f'\n--- {cat} ({len(items)}) ---')
    by_file = {}
    for r in items:
        by_file.setdefault(r['file'], []).append(r['line'])
    for f, lines in sorted(by_file.items()):
        print(f'  {f}: lines {", ".join(str(l) for l in lines)}')

# Write full results as JSON for processing
with open('engineering/tech-lead/catch-audit.json', 'w') as out:
    json.dump(results, out, indent=2)
print(f'\nFull results written to engineering/tech-lead/catch-audit.json')
