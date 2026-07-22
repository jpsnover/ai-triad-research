# ADR-007: File-size budget + cohesion-extraction pattern for oversized source files

**Status:** accepted
**Date:** 2026-07-22
**Author:** Technical Lead

## Context

Several first-party source files have grown large enough that an agent cannot safely whole-file `Read` them without overrunning the context window and triggering **autocompact / compaction thrashing** — the session loses working context, re-reads, and thrashes. This hit a TL session on 2026-07-22 and degrades every agent who must work in these files. The largest offenders (scan 2026-07-22, `>1500` LOC): `lib/debate/prompts.ts` (4660), `lib/debate/debateEngine.ts` (4233), `taxonomy-editor/src/server/server.ts` (3315), `lib/debate/turnPipeline.ts` (2863), `lib/debate/types.ts` (2232), `taxonomy-editor/src/server/storage/githubAPIBackend.ts` (2169), `.../storage/fileIO.ts` (2118), `lib/debate/calibrationLogger.ts` (1841), `taxonomy-editor/src/main/ipcHandlers.ts` (1762), `lib/debate/argumentNetwork.ts` (1632), `lib/debate/turnValidator.ts` (1617), `lib/debate/claimExtractionPipeline.ts` (1542), plus several `>1500`-LOC test files.

The root `AGENTS.md` carries a stopgap ("never whole-file Read `debateEngine.ts` or other large `lib/debate` files — Grep + offset/limit ranges only"). That is a workaround, not a fix: the files stay oversized, edits stay risky, and reviewers still pay the whole-file cost. This is a recurring operational failure, so the budget is documented as a one-way-door architectural constraint (an enforced gate, not a guideline).

## Decision

**1. File-size budget (first-party source; excludes `node_modules`, build output, and machine-generated files carrying a generated-header marker).**

| Class | Soft-warn | Hard-fail |
|-------|-----------|-----------|
| Non-test source (`*.ts`/`*.tsx`, not `*.test.*`/`*.spec.*`) | 1000 LOC | **1500 LOC** |
| Test source (`*.test.ts`, `*.spec.ts`, etc.) | 1500 LOC | **2000 LOC** |
| Generated files (explicit `@generated` / auto-gen header) | — | exempt |

LOC = ESLint `max-lines` counting (blank lines and comments **not** skipped, for a stable single number; the gate config is the source of truth). The hard-fail thresholds are the enforced ceiling; soft-warn is advisory to catch files trending toward the ceiling.

**2. Extraction pattern — split by cohesion behind a stable barrel export.**
- Extract cohesive sub-modules (a coherent group of functions/types with a shared concern) into sibling files, then **barrel-re-export from the original path** so importers do not churn. The original module path keeps its public export surface byte-for-byte.
- **No public-API change and no behavior change** — this is mechanical decomposition, not a rewrite or a dependency-graph re-architecture. `prompts.ts` (many independent prompt builders → grouped builder modules) and `debateEngine.ts` (orchestration vs. the pipelines it drives) are the model cases.
- Prefer extraction that also shrinks the *reviewer* cost: a sub-module a reviewer can whole-file Read (<~800 LOC) is the target granularity, not merely "under 1500."

**3. Anti-regression gate.**
- Add an ESLint `max-lines` rule (per package flat config, e.g. `lib/eslint.config.mjs` and the taxonomy-editor config) enforcing the thresholds above.
- Seed it with an **explicit baseline** of the current offenders (per-file overrides) so the gate fails on NEW growth and NEW files over budget, but does not red-wall the existing offenders until each is split. Each baseline entry is removed as its file lands under budget (the baseline shrinks monotonically to zero).
- **Gate metadata is co-located** at point of use (the baseline list + threshold live in the eslint config, not in ticket history) — Gate Co-Location rule.
- **Prove the failure case** before trusting the gate: a deliberately over-budget file must fail the gate, and a clean file must pass — Gate Verification rule.

## Consequences

- New oversized files are blocked at CI; the existing offenders are burned down via per-owner Phase-2 tickets under epic t/1681, each removing its baseline entry as it lands.
- Once the baseline reaches zero, the root-`AGENTS.md` "never whole-file Read `lib/debate`" stopgap can be relaxed to reference the enforced budget instead of naming files.
- Barrel re-exports add one indirection hop per split module — accepted; importers are unaffected and the dependency graph is unchanged.
- The budget is a fleet-wide constraint: any role adding a file over the hard-fail ceiling must either split it or supersede this ADR. Changing the thresholds or the exemption classes requires a new ADR superseding this one.
- Test-file ceiling is deliberately higher (2000) because test files legitimately run long via many independent cases; they still get a ceiling because a `>2000`-LOC test file is itself un-Read-able and usually signals a suite that should be split by concern.
