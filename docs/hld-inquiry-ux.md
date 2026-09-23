# HLD: "Ask a Question" Inquiry UX

**Ticket:** t/3571 · **Author:** Tech Lead · **Date:** 2026-09-23
**Status:** Draft. The contract section is pending Second Opinion (shared-type-contract trigger).

## Problem

A researcher cannot ask the platform a question. The machinery to answer one exists and
works. The 2026-09-22 pilot proved it by hand-driving the whole pipeline for *"What counts
as an AI harm?"*, producing a genuinely useful answer: three camp-differentiated verdicts,
seven cross-cutting agreements, a four-layer evidence framework, and calibration metrics read
against the censoring gate.

Producing it took a hand-authored 40-field JSON config, a local Python embedding environment
with a 46-second cold start, a 19 MB debate JSON plus 9 MB of diagnostics, and a
Computational Linguist who knew which metrics to distrust. The pilot page says it plainly:
*"We have the machine. We don't have the experience."*

The gap is not capability. It is orchestration, synthesis, and the honest presentation of
uncertainty.

## What Already Exists

This matters because it changes the size of the build. Three of the four pipeline stages have
working server-side implementations:

| Stage | Status | Where |
|---|---|---|
| 01 Ground | **Exists** | `selectRelevantTaxonomy` + `ai.computeQueryEmbedding`, wired at `routes/relevantNodes.ts` |
| 02 Debate | **Exists** | `debateEngine.ts`, driven headlessly by `cli.ts` |
| 03 Judge | **Exists** | `neutralEvaluator.ts`, `qbaf.ts`, `synthesisPipeline.ts` |
| 04 Read | **Partial** | `termination_reason` derived per run in `calibrationLogger/extract.ts`; censoring applied only corpus-wide |

The 46-second embedding cold start was a property of the operator's *local Python* path, not
the server's. The hosted server already computes query embeddings with warm-model tracking and
load shedding (`embeddingsLoad.ts`). "Hosted embeddings" is largely already true on the web
profile.

So the work is four new things, plus the transport and UI to reach them. The four are a
request/result contract, a fidelity-to-config derivation, a per-run trust projection, and a
synthesis pass.

## Constraints That Shape the Design

**An inquiry is minutes long and costs real money.** The pilot ran 54 turns and 16 QBAF
evaluations. This can never be a synchronous request. It must be a job: `POST` returns `202`
with a job id, the client polls. That pattern already exists in this codebase at
`briefExportJobs.ts`, which already carries a per-user concurrency cap, TTL, idempotency key,
progress percentage, and durable persistence. The inquiry runner mirrors it rather than
inventing a second job model.

**The pilot's own run was censored.** It terminated on `api_ceiling`, having run out of budget
mid-argument. Under the t/1671 censoring gate, convergence-family metrics from a truncated run
are a data confound, not a result. A feature that renders `convergence_score: 0.649` without
that qualifier teaches users a false reading of their own data. Trust classification is
therefore not a polish item to add later; it ships with the synthesis or the synthesis is
misleading.

**One run is not a finding.** The replication gate wants n ≥ 10. The pilot footer carries this
caveat by hand. Generated output must carry it too, or the UX systematically overclaims.

## Design

### Pipeline

```
question + fidelity
   → [Ground]     grounding envelope: anchor situation + per-camp node sets
   → [Debate]     DebateConfig derived from fidelity; headless run
   → [Judge]      neutral evaluation + QBAF (existing)
   → [Trust]      per-metric trust projection from termination_reason
   → [Synthesize] InquiryResult
   → [Render]     answer page + raw run one click away
```

### The contract (`lib/debate/inquiryTypes.ts`)

`InquiryRequest` collapses the 40-field `CLIConfig` to what a researcher actually chooses:

```ts
interface InquiryRequest {
  question: string;
  fidelity: 'quick' | 'standard' | 'deep';   // → rounds, models, pacing, budget
  situationId?: string;                       // optional explicit anchor
}
```

`InquiryResult` is the rendered answer's data model: camp verdicts with POV node references,
convergences, evidence layers, unresolved gaps, and calibration entries that each carry their
own trust state. It is a **persisted, shareable artifact**, which makes its shape a one-way door:
once inquiries are saved and linked, changing the schema breaks stored results. It therefore
carries an explicit `schemaVersion` from day one, and the decision is recorded as an ADR
alongside this HLD.

Because `InquiryResult` is a shared type contract spanning five roles, it triggers the
**mandatory Second Opinion** class in the root `AGENTS.md`. The contract ticket does not merge
until that recommendation lands.

### Fidelity derivation (pure function)

`deriveDebateConfig(request): DebateConfig` maps three fidelity levels onto rounds, stage
models, pacing, and an explicit API budget. Keeping it pure and separate from the runner makes
the defaults testable without running a debate. It also turns the budget into an inspectable
number rather than an emergent property.

Model selection reads `ai-models.json` tiers rather than embedding literals. This aligns with
t/3564, which is adding the same tier-resolution discipline on the PowerShell side.

### Trust projection (pure function)

`projectTrust(metrics, terminationReason): TrustedMetric[]` classifies each metric as `trust`
or `censored`. The rule already exists in prose in `extract-metrics.ts`: censored when
`termination_reason ∈ {max_iterations, situation_cap, api_ceiling}`, and it binds only to the
convergence family. Metrics immune to where the cutoff fell stay trustworthy even in a
truncated run: `situation_crux_alignment`, `repetition_rate`, and claim acceptance.

This is the piece that turns the pilot's hand-applied badges into generated ones. It is a pure
function over data already captured, so both arms are directly unit-testable: a censored run
must produce `censored` on the convergence family and `trust` elsewhere; a natural conclusion
must produce `trust` throughout.

### Synthesis

`synthesizeInquiry(debate, grounding, trust): InquiryResult` runs the LLM pass that turns a
completed debate into the camp-differentiated answer. `newsReport.ts` is the nearest precedent:
extract structured inputs, feed a named prompt template, parse the result back into types. The
prompt lives in `prompts.ts`, per the DebateTool convention that prompts never inline into
engine logic.

Grounding failures must not degrade silently. ADR-001 graceful-empty means an empty corpus read
returns a valid-looking empty result; per the root `AGENTS.md` fallback-logging rule, every such
path emits a `WARN` naming the triggering condition.

### Transport

The full trio, per the transport-with-storage rule, since a renderer cannot reach storage
directly:

- `POST /api/inquiry` → `202 { jobId }`; `GET /api/inquiry/:jobId` → job state or result
- `BridgeAPI.startInquiry` / `getInquiry`, implemented in both `web-bridge.ts` and `electron-bridge.ts`
- Electron IPC channel + preload exposure

## Component Impact & Ownership

| Area | Files | Owner |
|---|---|---|
| Contract, fidelity, trust, synthesis | `lib/debate/inquiry*.ts`, `calibrationLogger/` | DebateTool |
| Job runner, REST routes | `server/inquiryJobs.ts`, `server/routes/inquiry.ts` | ServerAPI |
| IPC + preload | `main/ipc/`, `main/preload.ts` | ElectronMain |
| Bridge + UI | `renderer/bridge/*`, `renderer/components/inquiry/` | Rosetta Stone |
| Hosted verification | deploy smoke | DevOps Lead |

Shared Lib is **not** on the critical path: the embedding primitives the pipeline needs already
exist server-side. The `lib/ai-client/defaults.ts` model-literal cleanup is a separate t/3564
follow-up, not part of this feature.

## Ticket DAG

```
T0 contract + ADR (TL) ──┬─→ T1 fidelity derivation (DebateTool)
                         ├─→ T2 trust projection (DebateTool)
                         ├─→ T3 grounding envelope (DebateTool)
                         ├─→ T5 job runner (ServerAPI) ─→ T6 REST routes (ServerAPI) ─┐
                         └─→ T7 IPC + preload (ElectronMain) ───────────────────────┐ │
                                                                                    ▼ ▼
              T2, T3 ─→ T4 synthesis (DebateTool) ─────────────→ T8 bridge (Rosetta Stone)
                                                                          │
                                       T4, T8 ─→ T9 Ask UI + result page (Rosetta Stone)
                                                                          │
                                              T9 ─→ T10 hosted smoke (DevOps Lead)
```

T0 ships types only, not implementations, so T1/T2/T3/T5/T7 all start in parallel behind it.

## Non-Goals

- Streaming a debate live into the UI. The job model returns a finished artifact; live
  spectating is a separate feature.
- Replacing `cli.ts`. The operator path stays for research and batch runs.
- Multi-run replication (n ≥ 10). Out of scope here; the UX must *state* the single-run caveat,
  not resolve it.
- Public sharing of inquiry results. Persistence is designed for it; the share surface is not
  in this feature.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Budget exhaustion mid-run** — the pilot itself hit `api_ceiling` | Explicit budget per fidelity; truncation surfaced as a banner, not silently folded into the metrics |
| **Dual-build divergence** — Electron reads filesystem, web reads github-api; ADR-001 makes an empty read silent | T10 verifies on the hosted web profile against real deployed data and asserts data presence (count > 0), not "renders without error" |
| **Overclaiming from one run** | Single-run caveat generated into every result, not hand-written |
| **Cost per inquiry at scale** | Per-user concurrency cap inherited from the `briefExportJobs` pattern; `deep` fidelity gated |
| **Contract churn after persistence** | `schemaVersion` from day one; ADR records the decision |

## Open Questions

1. **Persistence location.** Do inquiry results live alongside debates in user storage, or in
   their own collection? Affects Server Storage and the eventual share surface.
2. **Anonymous access.** Can an unauthenticated visitor run an inquiry? The cost profile argues
   no, but the `anonAiRoutes.ts` precedent suggests the question is live. Routes to Server Auth.
3. **`deep` fidelity ceiling.** What upper bound on turns and spend is acceptable before the
   run is refused rather than truncated?
