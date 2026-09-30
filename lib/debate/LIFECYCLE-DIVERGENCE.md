# Debate Lifecycle Divergence Table

**Snapshot date:** 2026-09-30  
**Filed:** t/3771  
**Status:** This is a **dated snapshot**, not a live contract. It becomes stale the moment either construction site changes without updating this file. See [Mechanization](#4-mechanization-question) for what keeps it true.

Two independent implementations of the same debate lifecycle exist:

| Path | Role | Entry point |
|---|---|---|
| **Engine** (CLI) | DebateTool | `lib/debate/debateEngine/phases/opening.ts:91` |
| **Renderer** (Desktop) | Rosetta Stone | `taxonomy-editor/src/renderer/hooks/useDebateStore/slices/clarificationSlice.ts:1014` |

Blanks in the tables below are latent bugs or intended asymmetries. Every blank is dispositioned.

---

## 1. `OpeningPipelineInput` — rows derived from type declaration

Source: `lib/debate/turnPipeline/opening.ts:40-80`

| Field | Engine sets? | Renderer sets? | Notes |
|---|---|---|---|
| `label` | ✅ | ✅ | |
| `pov` | ✅ | ✅ | |
| `personality` | ✅ | ✅ | |
| `topic` | ✅ | ✅ | |
| `background?` | ✅ | ✅ | |
| `taxonomyContext` | ✅ | ✅ | |
| `priorStatements` | ✅ | ✅ | |
| `isFirst` | ✅ | ✅ | |
| `priorSpeakerLabels?` | ✅ | ✅ | Fixed t/3755 — was blank on renderer side; comment in clarificationSlice.ts:1024 records the mirror requirement |
| `sourceContent?` | ✅ | ✅ | |
| `documentAnalysis?` | ✅ | ✅ | |
| `audience?` | ✅ | ✅ | |
| `model` | ✅ | ✅ | |
| `briefModel?` | ✅ | ✅ | |
| `planModel?` | ✅ | ✅ | |
| `draftModel?` | ✅ | **❌ BLANK** | Renderer omits `stage_models?.draft`. Engine sets it from `stageModels.draft`. **→ t/3772 filed.** |
| `citeModel?` | ✅ | ✅ | |
| `stageTemperatures?` | ✅ (conditional) | **❌ asymmetry** | Engine sets a uniform scalar when `config.temperature != null`. Renderer uses per-model registry resolution at a higher level — intentional, desktop has richer per-model config. |
| `userSeedClaims?` | ✅ | ✅ | |
| `repairHints?` | ❌ | ❌ | Symmetric blank — intentional. Set by `runOpeningPipelineWithRepair` internally on retry, not by either caller. |
| `availablePovNodeIds?` | ✅ | ✅ | |
| `briefTimeoutMs?` | ✅ | **❌ asymmetry** | Renderer removed it after t/3521: `runOpeningPipelineWithRepair` applies `Math.max(DEFAULT_BRIEF_TIMEOUT_MS, getMinTimeout(model))` internally, shared floor. Engine still passes it explicitly. Functionally equivalent, intentional. |
| `stageTimeoutMs?` | **❌ asymmetry** | ✅ | Engine uses `getModelMinTimeout` callback passed to `runOpeningPipelineWithRepair`. Renderer sets explicitly (t/3612: desktop's `electronAIAdapter.getModelMinTimeout` returns 0, so renderer must compute and pass). Intentional — each path uses the mechanism its adapter supports. |
| `briefMaxRetries?` | ✅ | **❌ BLANK** | Renderer never sets `briefMaxRetries`. Renderer debates always use the pipeline default (3). Engine respects `config.briefMaxRetries`. **→ t/3773 filed.** |
| `briefMaxTokens?` | ❌ | ❌ | Symmetric blank — intentional. Neither path sets it; pipeline uses provider defaults. Only relevant for specific models that need a token cap. |
| `narrativeVoicing?` | ✅ | ✅ | |

### Blanks dispositioned

| Field | Disposition |
|---|---|
| `draftModel?` (renderer) | **Bug.** Filed t/3772. |
| `briefMaxRetries?` (renderer) | **Bug.** Filed t/3773. |
| `repairHints?` (both) | Intended asymmetry — internal to repair loop. |
| `briefMaxTokens?` (both) | Intended — defaults suffice; only needed for model-specific override. |
| `stageTemperatures?` (renderer) | Intended — renderer controls temperature via per-model registry, not a scalar. |
| `briefTimeoutMs?` (renderer) | Intended — t/3521 moved the floor into the pipeline. |
| `stageTimeoutMs?` (engine) | Intended — engine delegates to adapter callback; renderer must set explicitly. |

---

## 2. `PhaseState` — rows derived from type declaration

Source: `lib/debate/types/phase.ts:77-89`

Both paths produce `PhaseState` by calling the **same** `evaluatePhaseTransition()` from `lib/debate/phaseTransitions.ts`. All 11 fields are always populated by this function; neither path has a blank.

The divergence here was in the **read path, not the write path**: the engine was fresh-initializing `PhaseState` on each run (ignoring `session.adaptive_staging.phase_state`) while the renderer correctly persisted and resumed it. Fixed by t/3761: `hydratePhaseState()` in `lib/debate/debateEngine/hydrateState.ts` now reads from session before falling back to `initPhaseState()`.

| Field | Engine writes? | Engine reads (hydrate)? | Renderer writes? | Renderer reads? |
|---|---|---|---|---|
| `current_phase` | ✅ | ✅ | ✅ | ✅ (loop termination, `clarificationSlice.ts:178`) |
| `rounds_in_phase` | ✅ | ✅ | ✅ | ✅ |
| `total_rounds_elapsed` | ✅ | ✅ | ✅ | ✅ |
| `regression_count` | ✅ | ✅ | ✅ | ✅ |
| `argumentation_exit_threshold` | ✅ | ✅ | ✅ | ✅ |
| `concluding_exit_threshold` | ✅ | ✅ | ✅ | ✅ |
| `prior_crux_clusters` | ✅ | ✅ | ✅ | ✅ |
| `veto_history` | ✅ | ✅ | ✅ | ✅ |
| `gc_ran_this_phase` | ✅ | ✅ | ✅ | ✅ |
| `api_calls_used` | ✅ | ✅ | ✅ | ✅ |
| `confidence_state` | ✅ | ✅ | ✅ | ✅ |

**No blanks.** Post-t/3761, both paths correctly read and write all fields via the shared function.

---

## 3. `ModeratorState` — rows derived from type declaration

Source: `lib/debate/types/moderator.ts:246-297`

Similar to `PhaseState`: the engine runs `updateModeratorState()` and the renderer's cross-respond path (`debatePhaseSlice.ts:184, 212, 1490`) reads the existing state and writes back the updated result. The engine reads it back via `hydrateModeratorState()` (t/3761).

The confirmed gap before t/3761: the engine fresh-initialized on each run. Fixed.

| Field | Engine writes? | Engine reads (hydrate)? | Renderer propagates? | Notes |
|---|---|---|---|---|
| `interventions_fired` | ✅ | ✅ | ✅ | |
| `budget_total` | ✅ | ✅ | ✅ | |
| `budget_remaining` | ✅ | ✅ | ✅ | |
| `rounds_since_last_intervention` | ✅ | ✅ | ✅ | |
| `required_gap` | ✅ | ✅ | ✅ | |
| `last_target` | ✅ | ✅ | ✅ | |
| `last_family` | ✅ | ✅ | ✅ | |
| `burden_per_debater` | ✅ | ✅ | ✅ | |
| `avg_burden` | ✅ | ✅ | ✅ | |
| `persona_trigger_counts` | ✅ | ✅ | ✅ | |
| `health_history` | ✅ | ✅ | ✅ | |
| `consecutive_decline` | ✅ | ✅ | ✅ | |
| `consecutive_rise` | ✅ | ✅ | ✅ | |
| `trajectory_freeze_until` | ✅ | ✅ | ✅ | |
| `sli_consecutive_breaches` | ✅ | ✅ | ✅ | |
| `phase` | ✅ | ✅ | ✅ | |
| `round` | ✅ | ✅ | ✅ | |
| `total_rounds` | ✅ | ✅ | ✅ | |
| `argumentation_rounds` | ✅ | ✅ | ✅ | |
| `intervention_history` | ✅ | ✅ | ✅ | COMMIT entries here gate closure — the t/3761/t/3767 fix |
| `cooldown_blocked_count` | ✅ | ✅ | ✅ | |
| `dormancy_checked?` | ✅ | ✅ | ? | Optional field added t/3513 — renderer propagation unverified |
| `engine_pinned_claims?` | ✅ | ✅ | ? | Optional field added t/3513 — renderer propagation unverified |
| `budget_epoch` | ✅ | ✅ | ✅ | |
| `refill_gap` | ✅ | ✅ | ✅ | |
| `crux_focused_ids?` | ✅ | ✅ | ? | `Set<string>` — JSON serialization loses Set prototype; rendered as object on restore |
| `crux_engagement_per_debater?` | ✅ | ✅ | ? | Optional field, renderer propagation unverified |

**Lower-confidence rows:** `dormancy_checked?`, `engine_pinned_claims?`, `crux_focused_ids?`, `crux_engagement_per_debater?` — these are newer optional fields. They are set by the engine but their persistence through the renderer's session save/load cycle has not been verified in this audit. File t/3774 to verify.

**`crux_focused_ids?` note:** Type is `Set<string>`. JSON serialization round-trips it as a plain object `{}`, not a `Set`. Both paths should `new Set(Object.keys(stored))` on restore, but this is unverified.

---

## 4. Cross-respond round state

**(Lower confidence — no single named type)**

The cross-respond path manages per-round context that spans both implementations:

- `priorStatements` accumulation: renderer appends in `clarificationSlice.ts:917-924, 1163` (correct across resumes); engine path in `phases/opening.ts:34-41` was missing rehydration (t/3770).
- Per-round BDI context, crux focus, and position-drift snapshots are passed as local variables; their session persistence is not uniformly typed.

This section cannot be derived from a single type and is therefore **lower-confidence**. A dedicated audit of the cross-respond pipeline input construction (analogous to this table for `OpeningPipelineInput`) is deferred.

---

## 5. Recommendation: shared builder

**Recommendation:** A **typed builder interface** (`OpeningPipelineInputBuilder`) is worth building — interface-first, so both paths adopt incrementally without a rewrite.

**Why:** Three of four gaps in `OpeningPipelineInput` above were missed because two authors independently constructed the same object. A builder that both paths call (with required fields enforced by TypeScript and optional fields with documented defaults) makes a missing field a compile error, not a runtime blank.

**Cost:** ~2h to define the interface + migrate one path; the other path migrates independently. No shared implementation required — the builder is a typed factory, not a class.

**What keeps the table true:** Nothing automatic. This file is a snapshot. Two mechanisms would actually close the class:
1. **(Weak, cheap)** A test that, for each field in `OpeningPipelineInput`, asserts the field name appears at both construction sites. Grep-shaped, would catch t/3755 on day of landing. Filed t/3775.
2. **(Strong, medium-cost)** The typed builder above — both sites call it; a new field requires a deliberate `undefined` to opt out; the pattern enforces coverage structurally.

Until one of these ships, treat this document as **dated evidence**, not a current guarantee.

---

## Filed tickets from this audit

| Ticket | Type | Description |
|---|---|---|
| t/3774 | Bug | Renderer missing `draftModel?` in `OpeningPipelineInput` |
| t/3775 | Bug | Renderer missing `briefMaxRetries?` in `OpeningPipelineInput` |
| t/3776 | Observability | Verify renderer propagation of 4 newer optional `ModeratorState` fields |
| t/3777 | Prevention | Grep-test: each `OpeningPipelineInput` field must appear at both construction sites |
