# HLD: "Ask a Question" Inquiry UX

**Ticket:** t/3571 · **Author:** Tech Lead · **Date:** 2026-09-23
**Status:** Accepted. Second Opinion consult complete (e/186, *proceed with conditions*); all
four conditions folded in. Decisions recorded in `docs/adr/ADR-0002-inquiry-result-contract.md`.

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

### The contract (`lib/inquiry/`)

Owned by Shared Lib, not DebateTool. `lib/userPreferencesSchema.ts` settled this shape already:
it went to flat `lib/` because ServerAPI, a non-Electron consumer, needed it. The same holds
here. An inquiry is also a product artifact that *wraps* a debate, so homing its contract inside
`lib/debate/` would couple the artifact's identity to one pipeline stage it deliberately
abstracts over. DebateTool's synthesis produces the type, so the dependency points from
`lib/debate` into `lib/inquiry`.

**Zod-first.** The schema is the source of truth and types are inferred from it, per the t/3535
convention. This artifact crosses five consumers and at least two serialization boundaries (job
store, REST, IPC); bare interfaces would mean five hand-rolled validations or five
`as InquiryResult` casts. Retrofitting the validator after downstream tickets have imported the
types is the expensive order.

`InquiryRequest` collapses the 40-field `CLIConfig` to what a researcher actually chooses:

```ts
export const InquiryRequestSchema = z.object({
  question: z.string(),
  fidelity: z.enum(['quick', 'standard', 'deep']),   // → rounds, models, pacing, budget
  situationId: z.string().optional(),                 // optional explicit anchor
});
export type InquiryRequest = z.infer<typeof InquiryRequestSchema>;
```

The enum stays closed. A parameterized version re-grows the 40-field config one option at a time.

`InquiryResult` is the rendered answer's data model: camp verdicts with POV node references,
convergences, evidence layers, unresolved gaps, and calibration entries that each carry their
own trust state. It is a **persisted, shareable artifact**, which makes its shape a one-way door.
Three properties follow from that, all decided now rather than retrofitted.

**1. `schemaVersion` plus one shared parser.** A version integer only helps if every reader
interprets it identically, and there are five readers. `parseInquiryResult(raw)` lives in the
contract module and owns the whole policy: a newer major refuses loudly with an `ActionableError`
rather than best-effort rendering a shape it does not understand; the same major reads tolerantly
with unknown-field passthrough, because this artifact will grow fields; an older version migrates
at read time inside the parser, so migration logic exists in one place instead of five. No
envelope/payload split. That is machinery for multi-payload formats, and a plain
`schemaVersion: 1` with the shared parser gives the same protection here.

**2. The result stamps its resolved derivation.** `deriveDebateConfig` will change as models
retire and budgets are tuned, so `'standard'` in June will not mean what it meant in March. A
result that records only the fidelity label has unrecoverable provenance. Every `InquiryResult`
therefore carries the models actually used, rounds, and budget. This is also what frees the enum
to evolve. Once results carry resolved facts, adding a fourth level or re-tuning `standard`
touches nothing already persisted. The request stays lean; the result carries the receipt.

**3. Node references carry a display snapshot.** The taxonomy is mutable, and nodes get retired
and renamed routinely. A result opened a year later must either resolve references against a corpus
that has moved or render from its own data. It carries both: the POV node IDs for live
navigation, plus a minimal inline snapshot (label, camp) so an old result degrades to stale
labels rather than broken references.

Because `InquiryResult` is a shared type contract spanning five roles, it triggered the
**mandatory Second Opinion** class in the root `AGENTS.md`. That consult is complete (e/186):
*proceed with conditions*, all four accepted and folded into this design. Decisions are recorded
in `docs/adr/ADR-0002-inquiry-result-contract.md`.

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
| **Contract + parser** | `lib/inquiry/` | **Shared Lib** |
| Fidelity, trust, grounding, synthesis | `lib/debate/inquiry*.ts`, `calibrationLogger/` | DebateTool |
| Job runner, REST routes | `server/inquiryJobs.ts`, `server/routes/inquiry.ts` | ServerAPI |
| IPC + preload | `main/ipc/`, `main/preload.ts` | ElectronMain |
| Bridge + UI | `renderer/bridge/*`, `renderer/components/inquiry/` | Rosetta Stone |
| Hosted verification | deploy smoke | DevOps Lead |

Shared Lib owns the contract, which puts it **at the head of the critical path**. Every other
ticket blocks on `lib/inquiry/`. (An earlier draft of this HLD placed the contract in
`lib/debate/` and said Shared Lib was uninvolved; the Second Opinion consult moved it, and this
is the correction.) Shared Lib is not otherwise on the path. The embedding primitives the
pipeline needs already exist server-side, and the `lib/ai-client/defaults.ts` model-literal
cleanup is a separate t/3564 follow-up.

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

Resolved by the Second Opinion consult (e/186), recorded in ADR-0002: contract location,
versioning posture, derivation stamping, and node-reference durability.
