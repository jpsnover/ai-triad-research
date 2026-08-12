#!/usr/bin/env python3
"""Workflow lint gate — enforces three conventions across all workflow YAML files.

Checks:
  1. All action `uses:` refs must be SHA-pinned (40-hex commit SHA), not tag/branch refs.
     Matches BOTH plain key form ('        uses: a/b@ref') AND compact list-item form
     ('      - uses: a/b@ref').  The original USES_RE missed the compact form (t/2529 GV fail).
  2. `${{ inputs.VARNAME }}` must not appear directly in shell run blocks — use env-var indirection.
     Bare refs only; conditional expressions (${{ inputs.X == 'val' && ... }}) are safe.
  3. Every workflow file must declare a `permissions:` block (workflow-level or job-level).

Run with --self-test to execute the built-in fixture tests (both syntax forms must be caught).
Exit 0 = all checks pass. Exit 1 = violations found or self-test failed.
Mechanically catches the M14/M15/L8 failure classes (t/2529).
"""
import re
import sys
import glob

SHA_RE = re.compile(r'^[0-9a-f]{40}$')

# Matches both forms:
#   plain key:       '        uses: owner/action@REF'
#   compact step:    '      - uses: owner/action@REF'
# Excludes local workflow calls (./path) which don't need SHA pins.
USES_RE = re.compile(r'^\s*(?:-\s+)?uses:\s+([^./]\S+)@(\S+)')

# Only flag bare ${{ inputs.VARNAME }} — raw value reaches the shell (injection risk).
# Safe: ${{ inputs.X == 'val' && '1' || '' }} — expression produces a bounded value;
# GitHub Actions evaluates the expression before the shell runs, never exposing the raw input.
INPUTS_RE = re.compile(r'\$\{\{\s*inputs\.\w+\s*\}\}')

PERMISSIONS_RE = re.compile(r'^\s*permissions:', re.MULTILINE)


def parse_step_key(line):
    """Return (key_name, line_indent) for a YAML key line, handling compact list-item form.

    Examples:
      '        run: |'       → ('run', 8)
      '      - run: cmd'     → ('run', 6)   # indent = position of dash
      '        uses: a/b@c'  → ('uses', 8)
      '      - uses: a/b@c'  → ('uses', 6)
    Returns (None, indent) when the line is not a YAML key line.
    """
    s = line.lstrip()
    indent = len(line) - len(s)
    if s.startswith('- '):
        s = s[2:].lstrip()
    if ':' not in s:
        return None, indent
    key = s.split(':')[0].strip()
    if re.match(r'^\w[\w-]*$', key):
        return key, indent
    return None, indent


def lint_file(path, content):
    """Return list of violation strings for one workflow file."""
    errs = []
    lines = content.splitlines()

    # ── Check 1: unpinned actions ──────────────────────────────────────────────
    for i, line in enumerate(lines, 1):
        m = USES_RE.match(line)
        if m:
            ref = m.group(2).split('#')[0].strip()
            if not SHA_RE.match(ref):
                errs.append(f'{path}:{i}: unpinned action ref @{ref!r} — pin to 40-char hex SHA')

    # ── Check 2: bare ${{ inputs.* }} in shell run blocks ─────────────────────
    # Walk lines tracking whether we're inside a `run:` value context.
    in_run = False
    run_indent = 0
    for i, line in enumerate(lines, 1):
        key, indent = parse_step_key(line)

        if key is not None:
            if key == 'run':
                in_run = True
                run_indent = indent
                # Check inline run: value (same line, not a block scalar marker)
                s = line.lstrip()
                if s.startswith('- '):
                    s = s[2:].lstrip()
                rest = s[len('run:'):].strip()
                if rest and rest not in ('|', '|-', '>'):
                    if INPUTS_RE.search(rest):
                        errs.append(
                            f'{path}:{i}: direct ${{{{ inputs.* }}}} in inline run: — '
                            f'use env: block for shell indirection'
                        )
            elif in_run and indent <= run_indent:
                in_run = False
        elif in_run:
            stripped = line.lstrip()
            if stripped and len(line) - len(stripped) > run_indent:
                if INPUTS_RE.search(line):
                    errs.append(
                        f'{path}:{i}: direct ${{{{ inputs.* }}}} in run block content — '
                        f'use env: block for shell indirection'
                    )
            elif stripped and len(line) - len(stripped) <= run_indent:
                in_run = False

    # ── Check 3: missing permissions block ────────────────────────────────────
    if not PERMISSIONS_RE.search(content):
        errs.append(f'{path}: no permissions: block — add explicit minimal permissions')

    return errs


def self_test():
    """Verify that both uses: syntax forms and run: forms are correctly detected."""
    print('=== workflow-lint self-test ===')
    failures = []

    # Fixture 1: compact list-item `- uses:` form must be caught by Check 1
    fixture_compact_uses = """\
permissions:
  contents: read
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
"""
    errs = lint_file('fixture_compact_uses', fixture_compact_uses)
    if not any('unpinned action ref' in e for e in errs):
        failures.append('Check 1 MISSED compact "- uses: action@v4" form')
    else:
        print('  PASS: Check 1 catches compact "- uses: action@v4"')

    # Fixture 2: plain key `uses:` form must also be caught
    fixture_plain_uses = """\
permissions:
  contents: read
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - name: step
        uses: actions/checkout@v4
"""
    errs = lint_file('fixture_plain_uses', fixture_plain_uses)
    if not any('unpinned action ref' in e for e in errs):
        failures.append('Check 1 MISSED plain "  uses: action@v4" form')
    else:
        print('  PASS: Check 1 catches plain "  uses: action@v4"')

    # Fixture 3: SHA-pinned ref must NOT be flagged
    fixture_pinned = """\
permissions:
  contents: read
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7
"""
    errs = lint_file('fixture_pinned', fixture_pinned)
    if any('unpinned' in e for e in errs):
        failures.append('Check 1 incorrectly flagged a properly SHA-pinned action')
    else:
        print('  PASS: Check 1 ignores properly pinned action')

    # Fixture 4: bare ${{ inputs.X }} in run block must be caught
    fixture_inputs_run = """\
permissions:
  contents: read
on:
  workflow_dispatch:
    inputs:
      image:
        type: string
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
      - name: pull
        run: docker pull "${{ inputs.image }}"
"""
    errs = lint_file('fixture_inputs_run', fixture_inputs_run)
    if not any('inputs' in e for e in errs):
        failures.append('Check 2 MISSED bare ${{ inputs.image }} in inline run:')
    else:
        print('  PASS: Check 2 catches bare ${{ inputs.image }} in inline run:')

    # Fixture 5: conditional expression ${{ inputs.X == ... }} must NOT be flagged
    fixture_inputs_expr = """\
permissions:
  contents: read
on:
  workflow_dispatch:
    inputs:
      mode:
        type: choice
        options: [a, b]
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
      - run: echo "mode=${{ inputs.mode == 'a' && '1' || '' }}"
"""
    errs = lint_file('fixture_inputs_expr', fixture_inputs_expr)
    if any('inputs' in e for e in errs):
        failures.append('Check 2 incorrectly flagged a conditional expression')
    else:
        print('  PASS: Check 2 ignores conditional ${{ inputs.X == ... }} expressions')

    if failures:
        for f in failures:
            print(f'  FAIL: {f}')
        print(f'\nSelf-test FAILED: {len(failures)} assertion(s)')
        sys.exit(1)

    print('Self-test PASSED — all assertions OK\n')


# ── Entry point ────────────────────────────────────────────────────────────────
if '--self-test' in sys.argv:
    self_test()

errors = []
workflows = sorted(glob.glob('.github/workflows/*.yml'))
if not workflows:
    print('workflow-lint: no workflows found in .github/workflows/')
    sys.exit(1)

for path in workflows:
    with open(path, encoding='utf-8') as f:
        content = f.read()
    errors.extend(lint_file(path, content))

print(f'=== workflow-lint: {len(workflows)} workflows checked ===')
for e in errors:
    print(f'FAIL: {e}')

if errors:
    print(f'\n::error::workflow-lint: {len(errors)} violation(s) — see output above')
    sys.exit(1)

print('OK — 0 violations')
