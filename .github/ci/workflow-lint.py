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


# ─────────────────────────────────────────────────────────────────────────────
# t/3646: a workflow that PROVIDES a REQUIRED status context must never be able to
# fail-to-report or report a stale verdict. Applied ONLY to the files named in the
# SSOT (.github/ci/required-contexts.json). These are the invariants — a reader can
# DIFF this list against the code below, not just trust a prose claim (TL t/3646#1):
#   R1  no `paths:`/`paths-ignore:` UNDER `pull_request:` — a path filter means the
#       check may not run, which is incompatible with "required".
#   R2  the reporting job (job id == context name) `if:` must be ABSENT or EXACTLY
#       `always()`. NOT "starts with always()": `always() && github.event_name==push`
#       starts with always() yet skips on pull_request → the required context hangs
#       forever (TL t/3646#2). A genuine `always() && X` must carry a co-located
#       `# lint:allow-if: <reason>` exemption.
#   R3  EXACTLY ONE `# lint:gated-events: <csv>` declaration per file, PRESENT and
#       NON-EMPTY, and `on.pull_request.types` must be a SUPERSET of it. Empty/missing
#       => failure ("empty/malformed declaration"), never a vacuous pass on `types ⊇ {}`
#       (TL t/3646#3). >1 declaration => failure — the scan is first-match-wins, so a
#       second would be silently ignored (TL t/3646#1333).
#       LIMIT (SO e/209#2): R3 asserts `types ⊇ declaration` — CONSISTENCY, not
#       COMPLETENESS. A declaration that is itself incomplete (author's blind spot)
#       passes. Catching an incomplete declaration against the code is t/3663.
#   R4  no `concurrency: cancel-in-progress:` set to anything but the literal `false`.
#       The old `: true` literal match missed the expression idiom
#       `${{ github.ref != 'refs/heads/main' }}`, which evaluates true on exactly the PRs
#       a required context protects (SO/TL e/209). Flag any value that is not `false`.
#   R5  a reporting job with `if: always()` runs regardless of whether its `needs:` passed,
#       so it is a false-green unless it (a) asserts over `needs.*.result` AND (b) carries a
#       co-located `# lint:skipped-tolerated: yes|no <why>` declaration that AGREES with the
#       gating `if:` (yes => the `if:` must not reference `skipped`; no => it must). The
#       `skipped`-reference scan is scoped to `^if:` lines ONLY — comments mention `skipped`
#       all over ci.yml and a body-wide search false-REDs the gate (TL e/209#14). Pairing is
#       consistency (inherits R3's limit); the structural legit-vs-Arm-E skip discriminator
#       is t/3663.
RC_SSOT_PATH = '.github/ci/required-contexts.json'
# BLOCKING as of t/3646 flip (warn-cycle green + drift-guard green on main #2418 + live-fire
# RED+GREEN in real CI #2430/#2431 + mandatory Second Opinion e/209 with TL sign-off). A
# required-context violation now reds the workflow-lint job → ci-gate → blocks the PR.
REQUIRED_CONTEXT_BLOCKING = True
GATED_EVENTS_RE = re.compile(r'#\s*lint:gated-events:\s*(.*)$')
ALLOW_IF_RE = re.compile(r'#\s*lint:allow-if:\s*\S')
# R5(b): `# lint:skipped-tolerated: yes|no <why>` — disposition (group 1) + mandatory reason (group 2).
SKIPPED_TOL_RE = re.compile(r'#\s*lint:skipped-tolerated:\s*(yes|no)\b(.*)$')
# Condition 3 (SO/TL e/209) — allow-if ratchet: the committed count of `# lint:allow-if:` exemptions
# across SSOT workflows. `actual != expected` fails. Baseline 0 today; the FIRST legitimate allow-if
# must bump this in the same commit (that is the ratchet working as designed, not a bug).
ALLOW_IF_EXPECTED = 0
# t/3663 Half-B: `# lint:tolerated-skip: <job> <ticket-or-date> <why>` — declares that a needed job
# which can skip WITHOUT gating on `needs.changes.outputs.*` is a deliberately-tolerated skip. The
# ticket ref (t/NNNN) or ISO date is MANDATORY (TL cond 3) — a bare <why> is an unauditable
# suppression list; the ref/date lets a stale exemption be found later.
TOLERATED_SKIP_RE = re.compile(r'#\s*lint:tolerated-skip:\s*(\S+)\s+(t/\d+|\d{4}-\d{2}-\d{2})\b')
# Loose form: detect a present-but-malformed marker (missing the ref/date) so it is FLAGGED, not
# silently ignored — a tolerated-skip with no audit anchor must fail the rule (TL cond 3).
TOLERATED_SKIP_ANY_RE = re.compile(r'#\s*lint:tolerated-skip:\s*(.*)$')


def _strip_comment(line):
    """t/3663 (TL cond 1): drop a `#` comment (whole-line or trailing) before scanning a job body,
    so a token mentioned ONLY in a comment does NOT raise the gated-events floor. Errs toward NOT
    matching (a `#` inside a quoted string is rare and a false negative is the safe direction for a
    warn-only heuristic — a false positive is what gets the whole rule muted)."""
    return re.sub(r'(^|\s)#.*$', '', line)


def _block_end(lines, header_idx, header_indent):
    """Index one past the last line of the block whose header is at lines[header_idx]
    (column header_indent). Body = lines after the header until the next non-blank,
    non-comment line whose indent <= header_indent."""
    j = header_idx + 1
    while j < len(lines):
        stripped = lines[j].strip()
        if stripped == '' or stripped.startswith('#'):
            j += 1
            continue
        indent = len(lines[j]) - len(lines[j].lstrip())
        if indent <= header_indent:
            break
        j += 1
    return j


def _find_key(lines, key, indent, start=0, end=None):
    """Return the index of the first `<indent spaces>key:` line in [start, end), else -1."""
    if end is None:
        end = len(lines)
    pat = re.compile(r'^' + (' ' * indent) + re.escape(key) + r'\s*:')
    for i in range(start, end):
        if pat.match(lines[i]):
            return i
    return -1


def _parse_inline_list(value):
    """`[a, b, c]` -> ['a','b','c']; returns None if not an inline [..] list."""
    v = value.strip()
    if not (v.startswith('[') and v.endswith(']')):
        return None
    inner = v[1:-1].strip()
    if inner == '':
        return []
    return [x.strip() for x in inner.split(',') if x.strip()]


def load_required_contexts(root='.'):
    """Load the SSOT. Returns (entries, error_or_None). Missing/malformed SSOT is a hard
    error (a required-context lint with no list is itself the silent-no-op failure)."""
    import json, os
    p = os.path.join(root, RC_SSOT_PATH)
    if not os.path.exists(p):
        return [], f'{RC_SSOT_PATH}: SSOT missing — cannot lint required-context workflows'
    try:
        with open(p, encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:  # noqa: BLE001
        return [], f'{RC_SSOT_PATH}: malformed JSON ({e})'
    entries = data.get('required_contexts')
    if not isinstance(entries, list) or not entries:
        return [], f'{RC_SSOT_PATH}: required_contexts must be a non-empty array'
    return entries, None


def check_required_context(path, content, context_name):
    """Return violation strings for a required-context workflow file (R1–R4)."""
    errs = []
    lines = content.splitlines()
    gated_decl = None            # t/3663: hoisted so the Half-A completeness floor (in the jobs
    has_branches_filter = False  #   section below) can compare the declaration against the job body

    # Locate on.pull_request block (indent 2 under `on:`).
    pr_idx = _find_key(lines, 'pull_request', 2)
    if pr_idx == -1:
        errs.append(f'{path}: required context "{context_name}" — no `pull_request:` trigger; a required PR check must run on pull_request')
        pr_end = 0
    else:
        pr_end = _block_end(lines, pr_idx, 2)
        # t/3663 Half-A input: a `branches:` filter under pull_request means a base-retarget (which
        # arrives as an `edited` event) can flip whether this required context should run — so the
        # floor will require `edited` in the declaration.
        has_branches_filter = _find_key(lines, 'branches', 4, pr_idx + 1, pr_end) != -1
        # R1: no paths / paths-ignore inside pull_request
        for i in range(pr_idx + 1, pr_end):
            if re.match(r'^\s{4}paths(-ignore)?\s*:', lines[i]):
                errs.append(f'{path}:{i + 1}: R1 required context "{context_name}" — `paths:`/`paths-ignore:` under pull_request can skip the check → a required context that may never report')

        # R3: types superset of a present+non-empty gated-events declaration
        types_idx = _find_key(lines, 'types', 4, pr_idx + 1, pr_end)
        types_list = None
        if types_idx != -1:
            val = lines[types_idx].split(':', 1)[1]
            types_list = _parse_inline_list(val)
        # Exactly ONE declaration per file. The scan is first-match-wins, so a second
        # declaration would be SILENTLY ignored (TL t/3646#1333) — flag >1 explicitly.
        gated_matches = [m for m in (GATED_EVENTS_RE.search(ln) for ln in lines) if m]
        if len(gated_matches) > 1:
            errs.append(f'{path}: R3 required context "{context_name}" — {len(gated_matches)} `# lint:gated-events:` declarations found; exactly ONE per file (a second would be silently ignored)')
        else:
            gated_decl = [x.strip() for x in gated_matches[0].group(1).split(',') if x.strip()] if gated_matches else None
            if gated_decl is None:
                errs.append(f'{path}: R3 required context "{context_name}" — missing `# lint:gated-events:` declaration (name every event that can change the gated condition)')
            elif len(gated_decl) == 0:
                errs.append(f'{path}: R3 required context "{context_name}" — EMPTY `# lint:gated-events:` declaration (asserts nothing; `types ⊇ {{}}` is vacuously true) — list the events explicitly')
            elif types_list is None:
                errs.append(f'{path}: R3 required context "{context_name}" — `on.pull_request.types` missing or not an inline [..] list; cannot verify it covers the declared gated-events {gated_decl}')
            else:
                missing = [e for e in gated_decl if e not in types_list]
                if missing:
                    errs.append(f'{path}: R3 required context "{context_name}" — pull_request.types is missing declared gated-event(s) {missing} (declared: {gated_decl}, types: {types_list})')

    # R4: `cancel-in-progress:` must be the literal `false` (or omitted). The old `: true` match
    # missed `${{ github.ref != 'refs/heads/main' }}` — true on exactly the protected PRs (e/209).
    for i, ln in enumerate(lines):
        m = re.match(r'^\s*cancel-in-progress\s*:\s*(.+?)\s*$', ln)
        if m and m.group(1).strip().strip('\'"') != 'false':
            errs.append(f'{path}:{i + 1}: R4 required context "{context_name}" — `cancel-in-progress: {m.group(1).strip()}` is not the literal `false`; a cancelled run does not satisfy a required check (the expression form evaluates true on exactly the PRs this protects). Use `cancel-in-progress: false` or omit it.')

    # R2 + R5: the reporting job (id == context_name).
    jobs_idx = _find_key(lines, 'jobs', 0)
    if jobs_idx == -1:
        errs.append(f'{path}: required context "{context_name}" — no `jobs:` block')
    else:
        job_idx = _find_key(lines, context_name, 2, jobs_idx + 1)
        if job_idx == -1:
            errs.append(f'{path}: R2 required context "{context_name}" — no job with id "{context_name}" (the check-run name must be a job in this workflow)')
        else:
            job_end = _block_end(lines, job_idx, 2)
            job_body = lines[job_idx + 1:job_end]

            # ── t/3663 Half A: gated-events completeness FLOOR (WARN-ONLY, tagged R3-floor) ──
            # R3 checks types ⊇ declaration (declaration vs itself). This checks the declaration
            # against the CODE: events the reporting job BODY reacts to must appear in
            # `# lint:gated-events:`. Heuristic + deliberately INCOMPLETE — raises a floor, not a
            # completeness proof (t/3646 cond 4). Only when a non-empty declaration exists (R3
            # already flags missing/empty). Comment-stripped scan (cond 1): a token only in a `#`
            # comment must NOT raise the floor.
            if gated_decl:
                body_code = ' '.join(_strip_comment(bl) for bl in job_body)
                floor = set()
                if 'autoMergeRequest' in body_code:
                    floor.update(('auto_merge_enabled', 'auto_merge_disabled'))
                if re.search(r'\.labels\b|\bevent\.label\b', body_code):
                    floor.update(('labeled', 'unlabeled'))
                # `edited`: a `branches:` base filter means a PR base-retarget (an `edited` event)
                # can flip whether this required context runs, so the declaration must include it.
                # CONSEQUENCE (cond 2): `edited` ALSO delivers title/body edits — a job obliged to
                # add it therefore receives those; confirm it tolerates them (the two current
                # required contexts are if:always() gates that already do).
                if has_branches_filter:
                    floor.add('edited')
                floor_missing = sorted(floor - set(gated_decl))
                if floor_missing:
                    errs.append(f'{path}: R3-floor required context "{context_name}" — job body reacts to event(s) missing from `# lint:gated-events:` {floor_missing} (declared: {sorted(gated_decl)}). Add them AND confirm the job tolerates what they deliver (note: `edited` also fires on title/body edits). Heuristic floor — a minimum, not a completeness proof.')

            # ── t/3663 Half B: `skipped` structural discriminator (WARN-ONLY, tagged R5-skip) ──
            # Every job in the reporting job's `needs:` that can skip must either gate on
            # `needs.changes.outputs.*` (legitimate path-filtered skip) OR be declared in a
            # co-located `# lint:tolerated-skip: <job> <ticket-or-date> <why>`. A job that can skip
            # with neither is the Arm-E kind (skips on an unanticipated event → gate green on a red
            # SHA). Structural (checks each needed job's `if:` vs code); heuristic.
            needs_idx = _find_key(lines, 'needs', 4, job_idx + 1, job_end)
            if needs_idx != -1:
                needed = _parse_inline_list(lines[needs_idx].split(':', 1)[1]) or []
                tol_jobs = set()
                for k in range(job_idx + 1, job_end):
                    mt = TOLERATED_SKIP_RE.search(lines[k])
                    if mt:
                        tol_jobs.add(mt.group(1))
                    elif TOLERATED_SKIP_ANY_RE.search(lines[k]):
                        errs.append(f'{path}:{k + 1}: R5-skip required context "{context_name}" — `# lint:tolerated-skip:` is missing its mandatory `<job> <ticket-ref-or-date>` (an unauditable suppression). Use e.g. `# lint:tolerated-skip: my-job t/1234 <why>`.')
                for name in needed:
                    if name == 'changes':
                        continue  # the paths-filter producer itself
                    nj = _find_key(lines, name, 2, jobs_idx + 1)
                    if nj == -1:
                        continue
                    nj_end = _block_end(lines, nj, 2)
                    if _find_key(lines, 'if', 4, nj + 1, nj_end) == -1:
                        continue  # no `if:` → runs unconditionally, cannot skip (not this hazard)
                    nj_body = ' '.join(lines[nj + 1:nj_end])
                    if 'needs.changes.outputs.' in nj_body:
                        continue  # legitimate path-filtered skip
                    if name in tol_jobs:
                        continue  # deliberately tolerated (audited via ticket/date)
                    errs.append(f'{path}: R5-skip required context "{context_name}" — needed job "{name}" has an `if:` that can skip but does NOT gate on `needs.changes.outputs.*` and is not in a `# lint:tolerated-skip:` list. An unanticipated skip passes the gate on a red SHA (Arm-E). Gate it on the paths filter, or add `# lint:tolerated-skip: {name} <ticket-or-date> <why>`.')

            # R2: `if:` must be absent or EXACTLY always().
            job_if_always = False
            if_idx = _find_key(lines, 'if', 4, job_idx + 1, job_end)
            if if_idx != -1:
                if_val = lines[if_idx].split(':', 1)[1].strip()
                normalized = re.sub(r'\s+', ' ', if_val.strip('\'"').replace('${{', '').replace('}}', '')).strip()
                has_exemption = any(ALLOW_IF_RE.search(lines[k]) for k in range(job_idx + 1, job_end))
                if normalized == 'always()':
                    job_if_always = True
                elif not has_exemption:
                    errs.append(f'{path}:{if_idx + 1}: R2 required context "{context_name}" — reporting-job `if:` must be absent or EXACTLY `always()` (got `{if_val}`); `always() && X` still skips on the excluded event → context hangs. Add `# lint:allow-if: <reason>` in the job to exempt a deliberate case.')

            # R5: an `if: always()` reporting job runs regardless of `needs:` — false-green unless
            # (a) it asserts over needs.*.result AND (b) it declares its `skipped` disposition
            # matching the gating `if:`. (A job with no `if:` runs conditionally on its trigger and
            # is not this hazard.)
            if job_if_always:
                if not any(re.search(r'needs\S*\.result', bl) for bl in job_body):
                    errs.append(f'{path}: R5 required context "{context_name}" — reporting job is `if: always()` but has NO `needs.*.result` assertion; it reports success regardless of what failed beneath it (permanent false-green). Add a step that fails on needs.*.result.')
                decl = decl_why = None
                decl_ln = -1
                for k in range(job_idx + 1, job_end):
                    mm = SKIPPED_TOL_RE.search(lines[k])
                    if mm:
                        decl, decl_why, decl_ln = mm.group(1), mm.group(2).strip(), k
                        break
                if decl is None:
                    errs.append(f'{path}: R5 required context "{context_name}" — `if: always()` reporting job must carry a co-located `# lint:skipped-tolerated: yes|no <why>` declaration (records + explains whether a skipped need is tolerated).')
                elif not decl_why:
                    errs.append(f'{path}:{decl_ln + 1}: R5 required context "{context_name}" — `# lint:skipped-tolerated: {decl}` is missing its required <why> (a disposition with no reason is a checkbox, not a decision).')
                else:
                    # Pairing — scope the `skipped` reference to `if:` lines ONLY. Comments mention
                    # `skipped` throughout ci.yml; a body-wide search would false-RED a `yes` gate and
                    # block every PR (TL e/209#14). Consistency check (inherits R3's limit).
                    cond_refs_skipped = any('skipped' in bl for bl in job_body if re.match(r'^\s*if\s*:', bl))
                    if decl == 'yes' and cond_refs_skipped:
                        errs.append(f'{path}: R5 required context "{context_name}" — declares `skipped-tolerated: yes` but a gating `if:` references `skipped` (the condition blocks on skip while the declaration says it is tolerated — they disagree).')
                    elif decl == 'no' and not cond_refs_skipped:
                        errs.append(f'{path}: R5 required context "{context_name}" — declares `skipped-tolerated: no` but no gating `if:` references `skipped` (a skipped need would pass the gate, contradicting the declaration).')

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

    # ── t/3646: required-context rule (R1–R4) — both arms per rule ────────────
    # These prove the DETECTION logic. NOTE (TL t/3646#5): passing here does NOT prove
    # the rule is live in real CI — fixtures exercise layers below platform execution
    # and can be silently dead. A live-fire in a real run is a separate flip-gate.
    rc_ok = (
        "permissions:\n  contents: read\n"
        "on:\n  pull_request:\n"  # t/3663: no branches filter here → Half-A floor requires no `edited` (the branches→edited case is tested by rc_floor_edited)
        "    # lint:gated-events: opened,synchronize,reopened\n"
        "    types: [opened, synchronize, reopened]\n"
        "jobs:\n  ci-gate:\n    if: always()\n"
        "    # lint:skipped-tolerated: yes — fixture: path-filtered skips are fine\n"
        "    runs-on: ubuntu-latest\n    steps:\n"
        "      - name: gate\n        if: contains(needs.*.result, 'failure')\n        run: echo ok\n"
    )
    if check_required_context('rc_ok', rc_ok, 'ci-gate'):
        failures.append(f'RC compliant fixture unexpectedly flagged: {check_required_context("rc_ok", rc_ok, "ci-gate")!r}')
    else:
        print('  PASS: RC compliant required-context workflow → 0 findings')

    # ── t/3663 Half A: gated-events completeness FLOOR (warn-only, tagged R3-floor) ──
    # Must-flag = the joint-gv-guard pre-t/3607 shape: job body reads autoMergeRequest but the
    # declaration omits auto_merge_*. If the floor can't catch this, it isn't worth adding.
    rc_floor_amr = (
        "permissions:\n  contents: read\n"
        "on:\n  pull_request:\n"
        "    # lint:gated-events: opened,synchronize,reopened\n"
        "    types: [opened, synchronize, reopened]\n"
        "jobs:\n  ci-gate:\n    if: always()\n"
        "    # lint:skipped-tolerated: yes — fixture\n"
        "    runs-on: ubuntu-latest\n    steps:\n"
        "      - name: gate\n        if: contains(needs.*.result, 'failure')\n"
        "        run: node -e \"pr.data.autoMergeRequest\"\n"
    )
    _f = check_required_context('rc_floor_amr', rc_floor_amr, 'ci-gate')
    if not any('R3-floor' in e and 'auto_merge_disabled' in e for e in _f):
        failures.append(f'Half-A floor MISSED autoMergeRequest → auto_merge_* (joint-gv-guard pre-t/3607 case): {_f!r}')
    else:
        print('  PASS: Half-A floor flags an autoMergeRequest body whose declaration omits auto_merge_*')

    # Cond 1 negative control: autoMergeRequest ONLY in a comment must NOT raise the floor.
    rc_floor_cmt = rc_floor_amr.replace(
        "        run: node -e \"pr.data.autoMergeRequest\"\n",
        "        # note: autoMergeRequest handling lives elsewhere — comment only\n        run: echo ok\n")
    if any('R3-floor' in e for e in check_required_context('rc_floor_cmt', rc_floor_cmt, 'ci-gate')):
        failures.append('Half-A floor FALSE-POSITIVE on a comment-only autoMergeRequest mention (cond 1)')
    else:
        print('  PASS: Half-A floor ignores a comment-only autoMergeRequest mention (cond 1 negative control)')

    # Complete declaration → floor silent.
    rc_floor_ok = rc_floor_amr.replace(
        "    # lint:gated-events: opened,synchronize,reopened\n",
        "    # lint:gated-events: opened,synchronize,reopened,auto_merge_enabled,auto_merge_disabled\n").replace(
        "    types: [opened, synchronize, reopened]\n",
        "    types: [opened, synchronize, reopened, auto_merge_enabled, auto_merge_disabled]\n")
    if any('R3-floor' in e for e in check_required_context('rc_floor_ok', rc_floor_ok, 'ci-gate')):
        failures.append('Half-A floor FALSE-POSITIVE when the declaration already covers auto_merge_*')
    else:
        print('  PASS: Half-A floor silent when the declaration covers the body events')

    # Cond 2: a branches: filter → floor requires `edited` (base-retarget).
    rc_floor_edited = rc_ok.replace("on:\n  pull_request:\n", "on:\n  pull_request:\n    branches: [main]\n")
    if not any('R3-floor' in e and 'edited' in e for e in check_required_context('rc_floor_edited', rc_floor_edited, 'ci-gate')):
        failures.append('Half-A floor MISSED branches-filter → edited requirement (cond 2)')
    else:
        print('  PASS: Half-A floor requires `edited` when a branches: filter is present (cond 2)')

    # ── t/3663 Half B: `skipped` structural discriminator (warn-only, tagged R5-skip) ──
    rc_skip_flag = (
        "permissions:\n  contents: read\n"
        "on:\n  pull_request:\n"
        "    # lint:gated-events: opened,synchronize,reopened\n"
        "    types: [opened, synchronize, reopened]\n"
        "jobs:\n"
        "  heavy:\n    if: github.event_name == 'push'\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo heavy\n"
        "  ci-gate:\n    needs: [heavy]\n    if: always()\n"
        "    # lint:skipped-tolerated: yes — fixture\n"
        "    runs-on: ubuntu-latest\n    steps:\n"
        "      - name: gate\n        if: contains(needs.*.result, 'failure')\n        run: echo ok\n"
    )
    if not any('R5-skip' in e and 'heavy' in e for e in check_required_context('rc_skip_flag', rc_skip_flag, 'ci-gate')):
        failures.append('Half-B MISSED a needed job that can skip without a needs.changes.outputs gate')
    else:
        print('  PASS: Half-B flags an Arm-E-style skippable need (no paths-filter gate, not tolerated)')

    rc_skip_pf = rc_skip_flag.replace("    if: github.event_name == 'push'\n", "    if: needs.changes.outputs.heavy == 'true'\n")
    if any('R5-skip' in e for e in check_required_context('rc_skip_pf', rc_skip_pf, 'ci-gate')):
        failures.append('Half-B FALSE-POSITIVE on a legit needs.changes.outputs path-filtered skip')
    else:
        print('  PASS: Half-B silent on a path-filtered (needs.changes.outputs.*) skip')

    rc_skip_tol = rc_skip_flag.replace(
        "    # lint:skipped-tolerated: yes — fixture\n",
        "    # lint:skipped-tolerated: yes — fixture\n    # lint:tolerated-skip: heavy t/9999 push-only by design\n")
    if any('R5-skip' in e for e in check_required_context('rc_skip_tol', rc_skip_tol, 'ci-gate')):
        failures.append('Half-B still flagged a need covered by an audited (ticket-anchored) tolerated-skip')
    else:
        print('  PASS: Half-B silent when the skippable need has a ticket-anchored tolerated-skip')

    rc_skip_bad = rc_skip_flag.replace(
        "    # lint:skipped-tolerated: yes — fixture\n",
        "    # lint:skipped-tolerated: yes — fixture\n    # lint:tolerated-skip: heavy just because\n")
    if not any('R5-skip' in e and 'unauditable' in e for e in check_required_context('rc_skip_bad', rc_skip_bad, 'ci-gate')):
        failures.append('Half-B MISSED a tolerated-skip marker lacking a ticket ref or date (cond 3)')
    else:
        print('  PASS: Half-B flags a tolerated-skip marker missing its ticket-ref/date (cond 3)')

    rc_r1 = rc_ok.replace('    types: [opened, synchronize, reopened]\n',
                          "    paths: ['src/**']\n    types: [opened, synchronize, reopened]\n")
    if not any('R1' in e for e in check_required_context('rc_r1', rc_r1, 'ci-gate')):
        failures.append('R1 MISSED `paths:` under pull_request')
    else:
        print('  PASS: R1 flags paths: under pull_request')

    rc_r2 = rc_ok.replace('    if: always()\n', "    if: always() && github.event_name == 'push'\n")
    if not any('R2' in e for e in check_required_context('rc_r2', rc_r2, 'ci-gate')):
        failures.append('R2 MISSED `always() && X` reporting-job if: (the starts-with hole)')
    else:
        print('  PASS: R2 flags `always() && X` reporting-job if:')

    rc_noif = rc_ok.replace('    if: always()\n', '')
    if any('R2' in e for e in check_required_context('rc_noif', rc_noif, 'ci-gate')):
        failures.append('R2 false-flagged an ABSENT reporting-job if:')
    else:
        print('  PASS: R2 allows an absent reporting-job if:')

    rc_r3m = rc_ok.replace('    # lint:gated-events: opened,synchronize,reopened\n', '')
    if not any('R3' in e and 'missing' in e for e in check_required_context('rc_r3m', rc_r3m, 'ci-gate')):
        failures.append('R3 MISSED a missing lint:gated-events declaration')
    else:
        print('  PASS: R3 flags a missing gated-events declaration')

    rc_r3e = rc_ok.replace('    # lint:gated-events: opened,synchronize,reopened\n',
                           '    # lint:gated-events:\n')
    if not any('EMPTY' in e for e in check_required_context('rc_r3e', rc_r3e, 'ci-gate')):
        failures.append('R3 MISSED an EMPTY gated-events declaration (vacuous-pass guard)')
    else:
        print('  PASS: R3 flags an EMPTY gated-events declaration (closes the vacuous arm)')

    rc_r3g = rc_ok.replace('    # lint:gated-events: opened,synchronize,reopened\n',
                           '    # lint:gated-events: opened,synchronize,reopened,labeled\n')
    if not any('R3' in e and 'labeled' in e for e in check_required_context('rc_r3g', rc_r3g, 'ci-gate')):
        failures.append('R3 MISSED a declared gated-event absent from types')
    else:
        print('  PASS: R3 flags a declared event missing from types')

    rc_r3dup = rc_ok.replace('    # lint:gated-events: opened,synchronize,reopened\n',
                             '    # lint:gated-events: opened,synchronize,reopened\n    # lint:gated-events: opened\n')
    if not any('declarations' in e for e in check_required_context('rc_r3dup', rc_r3dup, 'ci-gate')):
        failures.append('R3 MISSED >1 lint:gated-events declarations (silent-second-declaration gap)')
    else:
        print('  PASS: R3 flags >1 gated-events declaration (closes the silent-second-decl gap)')

    rc_r4 = rc_ok.replace('on:\n', 'concurrency:\n  group: g\n  cancel-in-progress: true\non:\n')
    if not any('R4' in e for e in check_required_context('rc_r4', rc_r4, 'ci-gate')):
        failures.append('R4 MISSED cancel-in-progress: true')
    else:
        print('  PASS: R4 flags cancel-in-progress: true')

    rc_r4x = rc_ok.replace('on:\n', "concurrency:\n  group: g\n  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}\non:\n")
    if not any('R4' in e for e in check_required_context('rc_r4x', rc_r4x, 'ci-gate')):
        failures.append('R4 MISSED cancel-in-progress expression form (not literal false)')
    else:
        print('  PASS: R4 flags the cancel-in-progress ${{ }} expression form')

    rc_r5a = rc_ok.replace("        if: contains(needs.*.result, 'failure')\n", '')
    if not any('R5' in e for e in check_required_context('rc_r5a', rc_r5a, 'ci-gate')):
        failures.append('R5 MISSED an if:always() job with no needs.*.result assertion (false-green)')
    else:
        print('  PASS: R5 flags if:always() with no needs.*.result assertion (false-green)')

    rc_r5b = rc_ok.replace('    # lint:skipped-tolerated: yes — fixture: path-filtered skips are fine\n', '')
    if not any('skipped-tolerated' in e for e in check_required_context('rc_r5b', rc_r5b, 'ci-gate')):
        failures.append('R5 MISSED a missing skipped-tolerated declaration')
    else:
        print('  PASS: R5 flags a missing skipped-tolerated declaration')

    rc_r5why = rc_ok.replace('yes — fixture: path-filtered skips are fine', 'yes')
    if not any('R5' in e and 'why' in e for e in check_required_context('rc_r5why', rc_r5why, 'ci-gate')):
        failures.append('R5 MISSED a skipped-tolerated declaration with no <why>')
    else:
        print('  PASS: R5 flags a skipped-tolerated declaration missing <why>')

    rc_r5yp = rc_ok.replace("if: contains(needs.*.result, 'failure')", "if: contains(needs.*.result, 'skipped')")
    if not any('R5' in e and 'disagree' in e for e in check_required_context('rc_r5yp', rc_r5yp, 'ci-gate')):
        failures.append('R5 MISSED yes-declaration whose gating if: references skipped (pairing disagree)')
    else:
        print('  PASS: R5 flags yes-declaration + if:references-skipped (pairing)')

    # TL/SO e/209#14/#1343 — REQUIRED both fixtures. Comments mention `skipped` all over ci.yml;
    # a body-wide search would false-RED a `yes` gate and block every PR. The `if:`-lines-only scope fixes it.
    rc_r5cmt = rc_ok.replace("    steps:\n", "    steps:\n      # note: skipped needs are expected here\n")
    if any('R5' in e for e in check_required_context('rc_r5cmt', rc_r5cmt, 'ci-gate')):
        failures.append('R5 FALSE-RED on a `skipped` comment in the job body (would block every PR)')
    else:
        print('  PASS: R5 ignores a `skipped` comment in the job body (no false-RED)')

    rc_r5no = rc_r5cmt.replace('yes — fixture: path-filtered skips are fine', 'no — fixture: skips NOT tolerated')
    if not any('R5' in e for e in check_required_context('rc_r5no', rc_r5no, 'ci-gate')):
        failures.append('R5 FALSE-PASS: `no` declaration but the condition never checks skipped (comment must not satisfy it)')
    else:
        print('  PASS: R5 flags `no` whose condition never checks skipped (comment does not satisfy it)')

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

# ── t/3646: required-context checks ──────────────────────────────────────────
# Rule findings are WARN-ONLY until REQUIRED_CONTEXT_BLOCKING flips (a deliberate
# promotion PR). But an ABSENT/MALFORMED SSOT, or an SSOT naming a nonexistent
# workflow, is ALWAYS a hard error even in warn-only mode: that means the check is
# silently NOT running — the exact "silently dead" failure this rule exists to
# prevent (it must fail loud, never no-op green).
import os as _os
rc_warnings = []
rc_entries, rc_ssot_err = load_required_contexts()
if rc_ssot_err:
    errors.append(rc_ssot_err)
else:
    for _e in rc_entries:
        _wf = _e.get('workflow')
        _ctx = _e.get('context')
        if not _wf:
            continue  # api-only required context (GitHub-managed, e.g. CodeQL) — no workflow file to lint
        if not _os.path.exists(_wf):
            errors.append(f'{_wf}: required context "{_ctx}" (SSOT {RC_SSOT_PATH}) names a workflow file that does not exist')
            continue
        with open(_wf, encoding='utf-8') as _f:
            _findings = check_required_context(_wf, _f.read(), _ctx)
        # t/3663: the completeness-floor (R3-floor) and skipped-discriminator (R5-skip) arms are
        # WARN-ONLY heuristics — they do NOT inherit R1–R5's blocking status (a later promotion
        # needs its own evidence + its own Second Opinion). Route them to rc_warnings REGARDLESS of
        # REQUIRED_CONTEXT_BLOCKING; the deterministic R1–R5 keep following the flip.
        _t3663 = [f for f in _findings if 'R3-floor' in f or 'R5-skip' in f]
        _core = [f for f in _findings if f not in _t3663]
        rc_warnings.extend(_t3663)
        if REQUIRED_CONTEXT_BLOCKING:
            errors.extend(_core)
        else:
            rc_warnings.extend(_core)

    # Condition 3 (e/209): allow-if ratchet — the committed ALLOW_IF_EXPECTED must equal the actual
    # count of `# lint:allow-if:` exemptions across required-context workflows. Baseline 0 today;
    # the first legitimate exemption bumps the constant in the same commit (the ratchet, not a bug).
    _allow_if_actual = 0
    for _e in rc_entries:
        _wf = _e.get('workflow')
        if not _wf or not _os.path.exists(_wf):
            continue
        with open(_wf, encoding='utf-8') as _f:
            _allow_if_actual += sum(1 for _l in _f if ALLOW_IF_RE.search(_l))
    if _allow_if_actual != ALLOW_IF_EXPECTED:
        _msg = (f'{RC_SSOT_PATH}: allow-if ratchet — {_allow_if_actual} `# lint:allow-if:` exemption(s) '
                f'across required-context workflows but ALLOW_IF_EXPECTED={ALLOW_IF_EXPECTED}. Added a '
                f'legitimate exemption? bump ALLOW_IF_EXPECTED in the same commit (ratchet, not a bug). '
                f'Else remove the stray marker.')
        if REQUIRED_CONTEXT_BLOCKING:
            errors.append(_msg)
        else:
            rc_warnings.append(_msg)

print(f'=== workflow-lint: {len(workflows)} workflows checked ===')
for e in errors:
    print(f'FAIL: {e}')
for w in rc_warnings:
    print(f'::warning::workflow-lint[required-context warn-only, t/3646]: {w}')

if errors:
    print(f'\n::error::workflow-lint: {len(errors)} violation(s) — see output above')
    sys.exit(1)

if rc_warnings:
    print(f'\nworkflow-lint: {len(rc_warnings)} required-context WARNING(s) — warn-only (t/3646), not blocking yet')
print('OK — 0 blocking violations')
