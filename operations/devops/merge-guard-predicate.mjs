// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { execFileSync } from 'node:child_process'; // used only by the --jointgv CLI fetch shim
import { appendGateTelemetry, gateTelemetryDir } from './gate-telemetry.mjs'; // shared durable sink (t/3395)

/**
 * Pure command-string predicate for the pre-self-merge head-guard (t/3270, TL GV t/3270#2).
 *
 * FAILURE CLASS it closes: a manual `gh pr merge` completes against a CACHED/stale head that is
 * BEHIND the latest push, stranding later-pushed commits off main (#701/#830/#1810/#1868 — #1868
 * bypassed a TL-conditioned parity test). The root-AGENTS Pre-Self-Merge head-match check was only
 * ADVISORY (the pre-self-merge-verify hook merely nudged).
 *
 * DESIGN (why a command-string predicate, not an OID compare): requiring `gh pr merge
 * --match-head-commit <SHA>` lets GITHUB enforce head==SHA atomically at merge time — race-free, no
 * check-then-merge window, no fail-open. A hook that shelled out to compare `gh pr view headRefOid`
 * vs the local tip would be racy (head moves between check and merge) and must fail-open on a `gh`
 * error, defeating the gate. So the ONLY thing this predicate decides is a pure string question:
 * does a manual merge carry the flag? GitHub does the rest.
 *
 * `--auto` IS EXEMPT (TL ruling t/3270#2): every recurrence was a self/manual merge; `--auto` is
 * stale-head-safe by construction (GitHub re-targets on a new push and waits for the later commit's
 * required checks), and it CANNOT carry `--match-head-commit` (it queues pre-green). Its only
 * residual risk — auto-merging a *gated* PR — is owned by the SEPARATE draft-discipline (gated PRs
 * stay draft → `--auto` can't complete on a draft), not this gate; a command-string predicate can't
 * see gatedness without PR-state I/O, which would reintroduce the fail-open problem this avoids.
 *
 * Returns { block:boolean, reason:string }. The feedback-rule run-gate inlines the SAME logic (see
 * INLINE_FOR_RULE below) and emits 'fire' to stdout iff block (the worktree-path-guard convention).
 * This module is the source of truth the both-arms test proves; the rule's inline copy must match.
 */
export function mergeGuardVerdict(command) {
  const cmd = command || '';
  // Only manual `gh pr merge` (or gh.exe) is in scope — flag order / PR-number-optional tolerant.
  if (!/\bgh(?:\.exe)?\s+pr\s+merge\b/.test(cmd)) return { block: false, reason: 'not-a-merge' };
  // `--auto` exempt (see header) — matches boolean `--auto` and defensively `--auto=true`.
  if (/(?:^|\s)--auto(?:[=\s]|$)/.test(cmd)) return { block: false, reason: 'auto-exempt' };
  // Guarded iff the head-match flag carries a value — BOTH `--match-head-commit SHA` and
  // `--match-head-commit=SHA` forms (a bare flag with no value would false-pass, so require \S).
  if (/--match-head-commit(?:=|\s+)\S/.test(cmd)) return { block: false, reason: 'guarded' };
  // Manual merge, no head guard → BLOCK (the stranding vector).
  return { block: true, reason: 'missing-match-head-commit' };
}

/**
 * Auto-merge-on-joint-GV guard (t/3318, TL gate design t/3318#1 — prevention for the t/3307 incident).
 *
 * FAILURE CLASS it closes: `gh pr merge --auto` was enabled on a PR that was part of a JOINT GV
 * (co-merge group — #1947 had to land WITH ElectronMain #1940 per a locked cross-role contract).
 * Auto-merge fired the moment #1947's checks went green and merged it ALONE on its pre-consolidation
 * head — jumping the joint GV (main briefly broken) and stranding the reviewed consolidation. The
 * "gated PRs stay draft / never --auto a gated PR" rule is a convention auto-merge does not honor.
 *
 * DESIGN (t/3247 split, per TL): key on a MARKER, not draft-ness — a *solo* draft legitimately uses
 * --auto (TL recommends it). The hazard is the co-merge grouping. Marker = a `joint-gv` LABEL applied
 * when a PR is in a co-merge group / gated on a joint TL-GV. This decision is a PURE predicate
 * `(isAutoMerge ∧ isJointGvLabeled) → block`; the ONLY impure part is the label lookup, isolated in a
 * fetch shim (kept out of the pure predicate so both arms stay unit-testable, t/2971). Unlike the
 * t/3270 head-guard (which stays pure-string to avoid fail-open), this NEEDS PR-state I/O — so it
 * fails CLOSED on a gh error (blocks --auto with a distinct "couldn't verify" message), because
 * --auto-enable is rare + overridable and letting the t/3307 hazard through on a transient gh blip is
 * the worse failure. `--match-head-commit` manual self-merge is entirely unaffected (no --auto).
 *
 * NOT THE ENFORCER — READ THIS BEFORE FILING AN "ORDERING HOLE" BUG (t/3531). This command-level
 * predicate is POINT-IN-TIME: it only sees the label state at the `gh pr merge --auto` call, so
 * enabling --auto BEFORE the `joint-gv` label is applied does not trip it. That is a cosmetic
 * early-feedback gap, NOT a correctness hole. The ORDER-INDEPENDENT enforcer is the
 * `joint-gv-automerge-guard` CI CHECK (ci.yml, t/3332) — required via ci-gate, re-fired on
 * labeled/unlabeled/auto_merge_enabled events, it fails whenever joint-gv + auto-merge coexist
 * regardless of which came first and so blocks the merge. This predicate is convenience UX layered
 * ON TOP of that check; the check is what actually protects the t/3307 co-merge hazard.
 */
export function jointGvAutoMergeVerdict({ isAutoMerge, isJointGvLabeled } = {}) {
  if (isAutoMerge && isJointGvLabeled) return { block: true, reason: 'auto-merge-on-joint-gv' };
  if (isAutoMerge) return { block: false, reason: 'auto-merge-unlabeled-ok' };
  return { block: false, reason: 'not-auto-merge' };
}

// Is this an auto-merge enable of a `gh pr merge`? (reuses the t/3270 --auto detection verbatim)
export function isAutoMergeCommand(command) {
  const cmd = command || '';
  if (!/\bgh(?:\.exe)?\s+pr\s+merge\b/.test(cmd)) return false;
  return /(?:^|\s)--auto(?:[=\s]|$)/.test(cmd);
}

// Extract the PR ref from a `gh pr merge <ref> …` command: a pull URL, else a numeric id, else null
// (null → the caller lets `gh pr view` default to the current branch's PR). Only the leading ref
// position is read, so a `--match-head-commit <sha>` value can't be mistaken for the ref (and --auto
// commands can't carry that flag anyway — gh rejects the combination).
export function parsePrRef(command) {
  const cmd = command || '';
  const url = cmd.match(/\bpr\s+merge\s+(\S*\/pull\/\d+)/);
  if (url) return url[1];
  const num = cmd.match(/\bpr\s+merge\s+(\d+)(?:\s|$)/);
  if (num) return num[1];
  return null;
}

/**
 * PURE builder for a durable telemetry record (t/3395) — mirrors done-evidence's buildSinkRecord but
 * for the merge guards. The platform telemetry writer is dead (t/3394#2), so the shim appends this to
 * the shared sink after computing its verdict. `mode` is 'head-guard' (t/3270) or 'jointgv' (t/3318);
 * the HIGH-VALUE event is the jointgv fail-CLOSED block (couldn't verify labels → reason
 * 'failclosed-unverifiable', failClosed:true). Command is truncated (it's a `gh pr merge …` line, no
 * secrets, but bounded for log hygiene). Pure + exported so the shape is unit-tested.
 */
export function buildMergeGuardSinkRecord({ nowIso, mode, command, verdict, failClosed } = {}) {
  return {
    ts: nowIso ?? null,
    gate: 'merge-guard',
    mode: mode ?? null,
    decision: verdict && verdict.block ? 'block' : 'allow',
    reason: verdict ? verdict.reason : null,
    failClosed: !!failClosed,
    command: typeof command === 'string' ? command.slice(0, 300) : null,
  };
}

/**
 * ⚠️ INERT — NOT WIRED, GUARDS NOTHING YET (t/3687#8, TL). This predicate currently has NO runtime
 * caller: there is no `--base-ref-stale` shim mode, no feedback-rule wiring, and nothing reads the
 * recorder statuses. It READS like a live guard (green arms, tested) but does not gate any merge until
 * the wiring lands later in t/3687 (behind TL Gate-Verification). Do NOT conclude the retarget
 * stale-green class is covered from this function's presence or its passing tests alone — that is the
 * Class-9 shape (assert-from-artifact, not from behaviour; 74d3b548) one level out. It landed on main
 * early via the premature merge of #2455 (incident t/3687#7); TL ruled leave-not-revert (t/3687#8).
 *
 * Retarget stale-green guard — base-ref-NAME identity (t/3687; supersedes t/3684's rejected timestamp
 * design). Design of record locked via the e/212 Second-Opinion + TL review (t/3687#2).
 *
 * FAILURE CLASS: a PR's base branch is retargeted (GitHub auto-retargets on epic-base deletion; base
 * correction) AFTER the CI that validated it, so the green required checks ran against the OLD base —
 * stale for the new base — and with branch protection strict=false the PR can self-merge. The t/3270
 * head-guard (`--match-head-commit`) misses this: the HEAD is unchanged, the BASE moved.
 *
 * MECHANISM — base-ref NAME identity. Each instrumented required workflow records the base ref NAME it
 * ran against (`github.base_ref`). Block iff the LATEST record from any required recorder names a base
 * ref different from the PR's CURRENT `baseRefName`. Why the name, and not:
 *   - timestamps (t/3684): the created/finished axis produced FOUR wrong boundaries in one review.
 *   - the merge-ref SHA: `potentialMergeCommit = merge(current_main_tip, head)` recomputes whenever main
 *     ADVANCES (verified e/212#13/#14: its first parent IS the live main tip), so comparing it is
 *     `strict=true` by side-effect — t/3686's scope, deliberately separate.
 *   The base ref NAME is invariant under base advancement and changes ONLY on retarget — exactly this
 *   ticket's question and nothing more.
 *
 * SELECTION survives identity (e/212#14/#15 — identity dissolves the COMPARISON boundary, NOT selection):
 *   - WITHIN a recorder: take the LATEST record by `createdAt`. A post-retarget `synchronize` mints a
 *     fresh record naming the NEW base; old records are IMMUTABLE and keep the old name. "ANY record
 *     mismatches" would block a correctly-retargeted PR FOREVER (no operator remedy → override pressure).
 *     Latest-per-recorder is what makes the guard CLEARABLE: push → synchronize → fresh record names the
 *     new base → matches → allow. That re-run IS the remedy, obtained by making staleness unmergeable
 *     rather than by widening triggers (the block-forces-a-push rationale, t/3687).
 *   - ACROSS recorders: ANY latest-record mismatch blocks (all required, one stale suffices).
 * Ordering is by `createdAt` — one instant, no created/finished split. Duplicate records per recorder are
 * UNBOUNDED (t/3646 added `edited`/`auto_merge_disabled` triggers → more runs), so this maxes over a set;
 * ties at the max resolve to the SAFE side (any base ≠ current at the max instant → block).
 *
 * MISSING record → BLOCK, never allow (e/212#5): an expected recorder with no record means the set was
 * only partially evaluated; degrading to allow is the "verdict narrower than it reads" failure. Distinct
 * per-recorder reason so the shim's message can name the remedy.
 *
 * PURE: the impure shim fetches `currentBaseRefName` + `records` (with fail-closed I/O) and calls this.
 *
 * @param currentBaseRefName  the PR's current base ref name (e.g. 'main').
 * @param expectedRecorders   recorder ids that MUST have a record — the enumerated instrumented
 *                            workflows (ci.yml, joint-gv-guard, codeql.yml).
 * @param records             array of { recorder, baseRef, createdAt }; may hold multiple per recorder
 *                            (latest wins). `createdAt` is an ISO-8601 UTC string.
 */
export function baseRefStaleVerdict({ currentBaseRefName, expectedRecorders, records } = {}) {
  if (!currentBaseRefName) return { block: true, reason: 'no-current-base-ref' };
  const recs = Array.isArray(records) ? records : [];
  const expected = Array.isArray(expectedRecorders) ? expectedRecorders : [];
  if (expected.length === 0) return { block: true, reason: 'no-expected-recorders' };
  for (const recorder of expected) {
    const mine = recs.filter((r) => r && r.recorder === recorder && r.baseRef && r.createdAt);
    if (mine.length === 0) return { block: true, reason: `missing-record:${recorder}` };
    const times = mine.map((r) => new Date(r.createdAt).getTime());
    const maxT = Math.max(...times);
    if (!Number.isFinite(maxT)) return { block: true, reason: `unorderable-records:${recorder}` };
    // Latest record(s) for this recorder; a tie at second-granularity resolves to the SAFE side —
    // if ANY record at the max createdAt names a base other than current, the ordering is unknown → block.
    const latestMismatch = mine.some(
      (r) => new Date(r.createdAt).getTime() === maxT && r.baseRef !== currentBaseRefName,
    );
    if (latestMismatch) return { block: true, reason: `base-ref-mismatch:${recorder}` };
  }
  return { block: false, reason: 'all-recorders-match-current-base' };
}

// CLI shim (t/3270#4 / t/3318, TL GV): the feedback rules invoke THIS module directly so the rule
// runs the exact logic the both-arms test proves — test == runtime. (A hand-copied inline node -e
// would let a typo in the un-tested copy brick every merge or silently negate the gate; TL's
// load-bearing fix.) Convention: BLOCK == write 'fire' to stdout; ALLOW == exit 0, no stdout — the
// worktree-path-guard blocking contract. The endsWith guard makes this fire only on direct
// invocation (any path form), never when imported by the test.
//
// Two modes, both feed the same 'fire' contract but from DIFFERENT rules (distinct remediation text):
//   node <path>/merge-guard-predicate.mjs "<command>"              → t/3270 head-guard (pre-self-merge-verify)
//   node <path>/merge-guard-predicate.mjs --jointgv "<command>"    → t/3318 auto-merge joint-GV guard
// The head-guard path is byte-identical to before (its 13/13 test stays green); --auto is
// 'auto-exempt' there, so the two guards never double-fire on one command.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('merge-guard-predicate.mjs')) {
  // Durable telemetry (t/3395): append AFTER the verdict + any 'fire' write — writes to a file, never
  // stdout, and is best-effort inside appendGateTelemetry, so it cannot affect the 'fire' contract.
  const sink = (mode, command, verdict, failClosed) =>
    appendGateTelemetry({
      dir: gateTelemetryDir(import.meta.url),
      fileName: 'merge-guard.jsonl',
      record: buildMergeGuardSinkRecord({ nowIso: new Date().toISOString(), mode, command, verdict, failClosed }),
    });
  if (process.argv[2] === '--jointgv') {
    const cmd = process.argv[3] || '';
    if (isAutoMergeCommand(cmd)) {
      // Fetch shim (the only impure part): look up the PR's labels. Fail CLOSED on a gh error (after
      // one retry) — a joint-GV PR must not auto-merge, and an unverifiable label is treated as unsafe.
      let labeled;
      try {
        const ref = parsePrRef(cmd);
        const args = ['pr', 'view', ...(ref ? [ref] : []), '--json', 'labels', '-q', '.labels[].name'];
        let out = '';
        for (let attempt = 1; attempt <= 2; attempt++) {
          try { out = execFileSync('gh', args, { encoding: 'utf8', timeout: 8000 }); break; }
          catch (e) { if (attempt === 2) throw e; }
        }
        labeled = out.split(/\r?\n/).some((l) => l.trim() === 'joint-gv');
      } catch {
        process.stdout.write('fire'); // fail-closed: couldn't verify → block --auto
        labeled = null;
      }
      if (labeled === null) {
        // fail-closed block (the 'fire' above) — record the high-value unverifiable event
        sink('jointgv', cmd, { block: true, reason: 'failclosed-unverifiable' }, true);
      } else {
        const verdict = jointGvAutoMergeVerdict({ isAutoMerge: true, isJointGvLabeled: labeled });
        if (verdict.block) process.stdout.write('fire');
        sink('jointgv', cmd, verdict, false);
      }
    }
  } else {
    const command = process.argv[2] || '';
    const verdict = mergeGuardVerdict(command);
    if (verdict.block) process.stdout.write('fire');
    sink('head-guard', command, verdict, false);
  }
}
