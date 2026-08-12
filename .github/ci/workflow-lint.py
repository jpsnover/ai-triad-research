#!/usr/bin/env python3
"""Workflow lint gate — enforces three conventions across all workflow YAML files.

Checks:
  1. All action `uses:` refs must be SHA-pinned (40-hex commit SHA), not tag/branch refs.
  2. `${{ inputs.* }}` must not appear directly in shell run blocks — use env-var indirection.
  3. Every workflow file must declare a `permissions:` block (workflow-level or job-level).

Exit 0 = all checks pass. Exit 1 = violations found (details printed to stdout).
Mechanically catches the M14/M15/L8 failure classes (t/2529).
"""
import re
import sys
import glob

SHA_RE = re.compile(r'^[0-9a-f]{40}$')
# matches: uses: owner/action@REF  (excludes local ./ paths)
USES_RE = re.compile(r'^\s+uses:\s+([^./]\S+)@(\S+)')
# Only flag bare ${{ inputs.VARNAME }} — raw value reaches the shell (injection risk).
# Safe: ${{ inputs.X == 'val' && '1' || '' }} — expression produces a bounded value;
# GitHub Actions evaluates the expression before the shell runs, never exposing the raw input.
INPUTS_RE = re.compile(r'\$\{\{\s*inputs\.\w+\s*\}\}')
YAML_KEY_RE = re.compile(r'^\s+\w[\w-]*:\s')
PERMISSIONS_RE = re.compile(r'^\s*permissions:', re.MULTILINE)

errors = []

workflows = sorted(glob.glob('.github/workflows/*.yml'))
if not workflows:
    print('workflow-lint: no workflows found in .github/workflows/')
    sys.exit(1)

for path in workflows:
    with open(path, encoding='utf-8') as f:
        content = f.read()
    lines = content.splitlines()

    # ── Check 1: unpinned actions ──────────────────────────────────────────────
    for i, line in enumerate(lines, 1):
        m = USES_RE.match(line)
        if m:
            # Strip inline comment (e.g. `abc123  # v4` → `abc123`)
            ref = m.group(2).split('#')[0].strip()
            if not SHA_RE.match(ref):
                errors.append(
                    f'{path}:{i}: unpinned action ref @{ref!r} — pin to 40-char hex SHA'
                )

    # ── Check 2: ${{ inputs.* }} in shell run blocks ───────────────────────────
    # Walk lines tracking whether we are inside a `run:` value context.
    # State: in_run=False until we see a `run:` YAML key; then True until a sibling
    # key at the same or shallower indent ends the block.
    in_run = False
    run_indent = 0
    for i, line in enumerate(lines, 1):
        stripped = line.lstrip()
        indent = len(line) - len(stripped)

        if YAML_KEY_RE.match(line):
            key = stripped.split(':')[0]
            if key == 'run':
                in_run = True
                run_indent = indent
                # Inline run: value on the same line
                rest = stripped[len('run:'):].strip()
                if rest and rest not in ('|', '|-', '>'):
                    if INPUTS_RE.search(rest):
                        errors.append(
                            f'{path}:{i}: direct ${{{{ inputs.* }}}} in inline run: — '
                            f'use env: block for shell indirection'
                        )
                # Block scalar (| or |-): content checked on subsequent lines
            elif in_run and indent <= run_indent:
                # New YAML key at same/shallower indent — run block ended
                in_run = False
        elif in_run:
            if stripped and indent > run_indent:
                # Block scalar content line
                if INPUTS_RE.search(line):
                    errors.append(
                        f'{path}:{i}: direct ${{{{ inputs.* }}}} in run block content — '
                        f'use env: block for shell indirection'
                    )
            elif stripped and indent <= run_indent:
                in_run = False

    # ── Check 3: missing permissions block ────────────────────────────────────
    if not PERMISSIONS_RE.search(content):
        errors.append(f'{path}: no permissions: block — add explicit minimal permissions')

print(f'=== workflow-lint: {len(workflows)} workflows checked ===')
for e in errors:
    print(f'FAIL: {e}')

if errors:
    print(f'\n::error::workflow-lint: {len(errors)} violation(s) — see output above')
    sys.exit(1)

print('OK — 0 violations')
