# Design Review: Cheap-Model Prep Stages for Debate Pipeline

**Ticket:** t/841  
**Author:** Computational Linguist  
**Date:** 2026-06-22  
**Status:** Draft  
**Related:** t/456 (debate rerun optimization — narrower scope)

## Executive Summary

The debate pipeline currently runs all turn-pipeline stages (Brief → Plan → Draft → Cite) on a single expensive model (e.g., claude-opus-4). Analysis of a representative 10-round opus debate shows **~$7.70 total cost** across ~90 AI calls, with **Brief (31%) and Cite (18%) stages accounting for 49% of cost** while performing analytical/structured tasks that don't require frontier reasoning.

Moving Brief + Cite to a cheap model (claude-haiku or gemini-flash) would save **~$3.05/debate (40%)** with low quality risk. Moving Brief + Plan + Cite would save **~$3.72 (48%)** with moderate risk.

**Recommended first experiment:** Brief + Cite on haiku, Draft + Plan on opus, A/B tested on the "Audit Trails & Discoverability" topic with matched parameters.

---

## 1. Current Cost Structure

### 1.1 Model Pricing (USD per 1M tokens)

| Model | Input | Output | Cached Input | Cost Tier |
|-------|-------|--------|-------------|-----------|
| claude-opus-4 | $5.00 | $25.00 | $0.50 | Premium |
| claude-sonnet-4 | $3.00 | $15.00 | $0.30 | Standard |
| claude-haiku-4.5 | $1.00 | $5.00 | $0.10 | Basic |
| gemini-2.5-flash | $0.30 | $2.50 | $0.075 | Basic |
| gemini-2.5-flash-lite | $0.10 | $0.40 | $0.025 | Ultra-cheap |
| groq-llama-3.3-70b | $0.59 | $0.79 | — | Basic (free tier) |

### 1.2 Per-Stage Token Distribution (measured from opus debate-72a6e0a2)

Data from 13 turn entries across a complete 10-round Audit Trails debate:

| Stage | Calls | Avg Prompt (chars) | Avg Response (chars) | Total Prompt | Total Response | Time (ms) |
|-------|-------|--------------------|---------------------|-------------|---------------|-----------|
| **Brief** | 13 | 82,396 | 13,006 | 1,071,153 | 169,077 | 837,058 |
| **Plan** | 13 | 24,783 | 5,195 | 322,178 | 67,530 | 377,870 |
| **Draft** | 20 | 43,807 | 5,797 | 876,149 | 115,931 | 620,802 |
| **Cite** | 13 | 65,956 | 4,190 | 857,432 | 54,472 | 422,769 |
| Draft quality | 10 | 10,352 | 107 | 103,517 | 1,071 | 9,499 |
| Micro-fix | 7 | 8,581 | 8,361 | 60,069 | 58,529 | 219,692 |
| Evidence | 10 | — | — | — | — | 0 (deterministic) |
| postDraft | 10 | — | — | — | — | 118 (deterministic) |

Draft has 20 calls vs 13 entries because 7 drafts required in-stage retries (repair loop).

### 1.3 Cost Distribution by Stage (opus pricing)

Using 4 chars/token approximation:

| Stage | Input Cost | Output Cost | Total Cost | % of Pipeline |
|-------|-----------|------------|-----------|--------------|
| **Brief** | $1.34 | $1.06 | **$2.40** | **31%** |
| **Draft** | $1.10 | $0.73 | **$1.83** | **24%** |
| **Cite** | $1.07 | $0.34 | **$1.41** | **18%** |
| **Plan** | $0.40 | $0.43 | **$0.83** | **11%** |
| Draft quality | $0.13 | $0.01 | $0.14 | 2% |
| Micro-fix | $0.08 | $0.37 | $0.45 | 6% |
| Engine-level* | ~$0.35 | ~$0.35 | ~$0.70 | 9% |
| **Total** | | | **~$7.76** | |

*Engine-level: topic critique, neutral evaluations (×3), extraction coverage, crux decontextualization, synthesis.

### 1.4 Key Observation

Brief has the **largest prompt** (avg 82K chars) and **largest response** (avg 13K chars) of any stage, yet performs an analytical "read the room" function — assessing the current debate state, identifying key claims to address, and mapping the situation. This is the highest-leverage target for cost reduction.

---

## 2. Per-Stage Analysis

### 2.1 Pre-Debate Stages

#### Topic Analysis (topic critique + scope extraction)
- **Current model:** evaluator model (defaults to debate model)
- **Calls:** 2 (critique + scope extraction)
- **Est. cost:** ~$0.10
- **Cheap-model suitability:** HIGH — structural scoring is already deterministic; the LLM phase generates candidate framings that the expensive model could evaluate
- **Quality risk:** LOW — bad topic framing is caught before the debate starts; the user can reject it
- **Calibration impact:** None (pre-debate, no metric impact)
- **Implementation:** Trivial — pass a different model to `generateWithEvaluator()`
- **Verdict:** Good candidate but tiny savings. Bundle with other changes.

#### Taxonomy Pre-Mapping
- **Current implementation:** Embedding similarity (deterministic, no LLM)
- **Cheap-model opportunity:** A cheap model could pre-annotate relevance *with reasoning*, producing better initial node selection than pure cosine similarity
- **Quality risk:** MEDIUM — bad pre-mapping means the expensive model sees wrong taxonomy context
- **Calibration impact:** `taxonomy_mapped_ratio` — directly affected
- **Implementation:** New code path — add an LLM-scored relevance pass before embedding selection
- **Verdict:** Medium priority. Novel capability (not just model substitution). Defer to second experiment.

#### Situation Pre-Selection
- **Current implementation:** Embedding similarity + crux re-scoring (deterministic)
- **Cheap-model opportunity:** Could rank situations by *anticipated crux relevance* using cheap reasoning
- **Quality risk:** MEDIUM — `situation_crux_alignment` directly affected
- **Implementation:** New code — add LLM ranking layer on top of embedding shortlist
- **Verdict:** Defer. Current deterministic approach is fast and free. Adding an LLM call adds cost, not saves it.

#### Opening Scaffolding
- **Current implementation:** Opening uses same 4-stage pipeline (Brief → Plan → Draft → Cite)
- **Cheap-model opportunity:** Generate argument outlines via cheap model, which the expensive model develops
- **Quality risk:** MEDIUM-HIGH — opening quality sets the debate trajectory
- **Verdict:** Covered by the per-stage analysis below (Brief/Plan of openings = same as cross-respond).

### 2.2 Per-Turn Pipeline Stages

#### BRIEF Stage — **PRIMARY CANDIDATE**

**Function:** Situational assessment. Reads recent transcript, identifies key claims to address, assesses the debate state, maps situation to taxonomy nodes.

**Why cheap model works:**
1. Analytical, not creative — the Brief reads and summarizes, it doesn't generate arguments
2. Low temperature (0.15) — already treated as near-deterministic
3. Downstream validation — Brief output feeds into Plan, which feeds into Draft. Bad Briefs produce bad Plans, but the Draft quality pre-check catches cascade failures
4. Structured output — Brief produces JSON with `key_claims_to_address`, `situation_assessment`, `grounding` arrays. Structured extraction is a cheap-model strength
5. Node ID sanitization already exists (turnPipeline.ts:417-450) — catches hallucinated IDs from any model

**What could go wrong:**
- Misidentified cruxes → wrong focus in Plan → weak Draft
- Missed key claims from transcript → incomplete response
- Poor taxonomy grounding → irrelevant node selection

**Mitigation:** Brief errors are soft — the Draft stage sees the full transcript and taxonomy context independently. A mediocre Brief means the Plan is less informed, but the Draft stage's own prompt includes the full context.

**Cost saving:** $2.40 → ~$0.48 (haiku) or ~$0.19 (flash). **Savings: $1.92–$2.21/debate (25–29%)**

**Calibration impact prediction:**
- `crux_addressed_ratio`: -2-5% (less precise crux identification in Brief)
- `taxonomy_mapped_ratio`: -1-3% (Brief grounding less accurate)
- `repetition_rate`: +0-2% (may miss what's already been said)
- `claims_forgotten_rate`: +1-3% (may miss claims from compressed transcript)

#### PLAN Stage — **MODERATE CANDIDATE**

**Function:** Strategic move selection. Reads Brief output, selects dialectical moves (concede, rebut, undercut, etc.), identifies target taxonomy nodes, plans argument structure.

**Why cheap model might work:**
1. Moderate temperature (0.4) — exploratory but not highly creative
2. Move validation exists — `validatePlanStage()` catches structural errors with per-stage retry
3. Move consistency check is warning-only — the Draft can deviate from a bad Plan

**What could go wrong:**
- Poor strategic choices → boring, repetitive arguments
- Wrong move selection → conceding when should rebut, or vice versa
- Missing target nodes → argument doesn't advance taxonomy coverage

**Risk assessment:** MEDIUM-HIGH. Strategic reasoning is a frontier capability. Cheap models tend to select safe, generic moves rather than dialectically sharp ones. This directly affects argument quality.

**Cost saving:** $0.83 → ~$0.16 (haiku). **Savings: $0.67/debate (9%)**

**Calibration impact prediction:**
- `crux_addressed_ratio`: -5-10% (weaker strategic targeting of cruxes)
- `repetition_rate`: +3-8% (generic plans produce repetitive arguments)
- `convergence_score`: -3-5% (less strategic position movement)

**Verdict:** Include in second experiment only. The quality risk is higher and the savings are smaller than Brief or Cite.

#### DRAFT Stage — **KEEP ON EXPENSIVE MODEL**

**Function:** Core argument generation. This IS the debate output.

**Why cheap model fails here:**
1. Highest temperature (0.7) — intentionally creative, needs sampling diversity
2. Core value proposition — argument quality, rhetorical sophistication, crux engagement, nuanced reasoning
3. No recovery mechanism — a bad Draft IS a bad turn. There is no downstream stage that improves a weak argument
4. Quality pre-check exists but is reactive — it catches *structural* failures (ungrounded, unfalsifiable), not *shallow reasoning*

**Cost:** $1.83/debate on opus. This is the cost that buys argument quality.

**Verdict:** Non-negotiable. The Draft stage justifies the expensive model.

#### CITE Stage — **STRONG CANDIDATE**

**Function:** Taxonomy grounding verification. Maps Draft's claims to taxonomy node IDs, validates citations against the loaded taxonomy, produces `taxonomy_refs` array.

**Why cheap model works:**
1. Lowest temperature tied with Brief (0.15) — near-deterministic intent
2. Pattern matching — the task is "which taxonomy node IDs match these claims?" This is structured extraction, not reasoning
3. Downstream validation — `validateCiteStage()` catches errors; retry logic exists
4. Node ID sanitization — `sanitizeNodeIds()` corrects hallucinated IDs regardless of model
5. Citation resolution is partially deterministic — `validateCitationsAgainstBank()` runs post-Cite

**What could go wrong:**
- Wrong node mappings → incorrect `taxonomy_refs` → misleading calibration
- Missed citations → lower `taxonomy_mapped_ratio`
- Hallucinated node IDs → caught by sanitization (existing safety net)

**Cost saving:** $1.41 → ~$0.28 (haiku) or ~$0.11 (flash). **Savings: $1.13–$1.30/debate (15–17%)**

**Calibration impact prediction:**
- `taxonomy_mapped_ratio`: -2-5% (less precise mapping)
- Other metrics: minimal direct impact (Cite doesn't affect argument quality)

### 2.3 Post-Turn Stages

#### Claim Extraction (evaluator model)
- **Current model:** `evaluatorModel` (separate from debate model, cross-vendor recommended)
- **Function:** Extract 3-6 claims per turn, classify relationships, assign categories
- **Cheap-model suitability:** HIGH — structured extraction task
- **Quality risk:** MEDIUM — bad extraction means bad AN, affecting all downstream metrics
- **Already separated:** The evaluator model is already a distinct config field. Changing it to a cheap model is a one-line config change
- **Verdict:** Good candidate. Already architecturally supported. Test after Brief+Cite.

#### Neutral Evaluation (evaluator model)
- **Calls:** 3 (baseline, midpoint, final)
- **Function:** Independent persona-free assessment of debate quality
- **Cheap-model suitability:** MEDIUM — requires nuanced assessment of argument strength
- **Quality risk:** MEDIUM — neutral evaluations are observational, not actionable during the debate. Lower quality reduces diagnostic value but doesn't degrade debate quality
- **Verdict:** Lower priority. The evaluations don't affect debate output.

#### Draft Quality Pre-Check
- **Current:** Uses `preCheckModel` (configurable separately)
- **Function:** 3-question evaluation: grounded? falsifiable? engages?
- **Cheap-model suitability:** HIGH — binary classification tasks
- **Already separated:** `preCheckModel` is already a distinct config field
- **Verdict:** Already suitable for cheap model. Low savings ($0.14/debate).

### 2.4 Post-Debate Stages

#### Synthesis
- **Function:** Generate `clarifies_taxonomy` proposals, convergence summary
- **Cheap-model suitability:** MEDIUM — summarization is a cheap-model strength, but taxonomy proposals need nuance
- **Verdict:** Low priority. Single call, small cost.

#### Extraction Coverage
- **Uses:** evaluator model
- **Function:** Verify claim extraction completeness on sampled turns
- **Cheap-model suitability:** HIGH — verification task
- **Verdict:** Bundle with evaluator model change.

---

## 3. Cost/Quality/Latency Tradeoff Matrix

### 3.1 Cost Savings by Configuration

| Configuration | Opus Cost | Haiku Cost | Saving | % Saved | Quality Risk |
|--------------|----------|-----------|--------|---------|-------------|
| **Baseline (all opus)** | $7.76 | — | — | — | — |
| Brief on haiku | $5.84 | $0.48 | $1.92 | 25% | Low |
| Cite on haiku | $6.63 | $0.28 | $1.13 | 15% | Low |
| **Brief + Cite on haiku** | **$4.63** | **$0.76** | **$3.05** | **40%** | **Low** |
| Brief + Plan + Cite on haiku | $3.96 | $0.92 | $3.72 | 48% | Medium |
| All stages on haiku | $1.56 | $1.56 | $6.20 | 80% | Very High |

### 3.2 Using gemini-2.5-flash Instead of Haiku

| Configuration | Flash Cost | Saving vs Opus | % Saved |
|--------------|-----------|---------------|---------|
| Brief + Cite on flash | $0.30 | $3.51 | 45% |
| Brief + Plan + Cite on flash | $0.37 | $3.67 | 47% |

Flash is ~40% cheaper than haiku with comparable quality for structured tasks.

### 3.3 Latency Impact

| Stage | Opus Avg (ms) | Haiku Est (ms) | Flash Est (ms) | Delta |
|-------|-------------|---------------|---------------|-------|
| Brief | 64,389 | ~8,000 | ~4,000 | **-87% to -94%** |
| Plan | 29,067 | ~5,000 | ~3,000 | -83% to -90% |
| Draft | 31,040 | — (keep opus) | — | no change |
| Cite | 32,521 | ~5,000 | ~3,000 | **-85% to -91%** |

**Net per-turn latency reduction (Brief + Cite on cheap):** ~84s saved per turn. For 13 turns: **~18 minutes faster debate** (from ~35 min to ~17 min wall-clock for pipeline stages).

This is potentially the most impactful benefit — users experience debate latency directly.

---

## 4. Implementation Design

### 4.1 Architecture: Per-Stage Model Override

The turn pipeline already receives `input.model` for all stages. The minimum change is adding per-stage model fields:

```typescript
interface TurnPipelineInput {
  model: string;                    // Draft model (expensive)
  briefModel?: string;              // Override for Brief stage
  planModel?: string;               // Override for Plan stage
  citeModel?: string;               // Override for Cite stage
  preCheckModel?: string;           // Already exists
}
```

In `runTurnPipeline()`, each stage would use `input.briefModel ?? input.model` instead of `input.model`.

**Blast radius:** `turnPipeline.ts` only. The `debateEngine.ts` passes these through from `DebateConfig`. No changes to prompt templates, validators, or downstream processing.

### 4.2 Configuration

Add to `DebateConfig`:

```typescript
interface DebateConfig {
  // ... existing fields ...
  /** Per-stage model overrides for cost optimization. Each defaults to `model`. */
  stageModels?: {
    brief?: string;
    plan?: string;
    cite?: string;
  };
}
```

And to `calibration-config.json` (so experiments are reproducible):

```json
{
  "stage_model_overrides": {
    "enabled": false,
    "brief": null,
    "plan": null,
    "cite": null
  }
}
```

### 4.3 Telemetry

Stage diagnostics already record `model` per stage. No new telemetry needed — the existing stage_diagnostics will automatically show which model was used where.

Add a session-level field for experiment tracking:

```typescript
interface DebateSession {
  stage_models?: Record<string, string>;  // { brief: "claude-haiku-4-5", cite: "claude-haiku-4-5" }
}
```

### 4.4 Code Changes Required

| File | Change | Complexity |
|------|--------|-----------|
| `lib/debate/types.ts` | Add `stageModels` to `DebateConfig`, `stage_models` to `DebateSession` | Trivial |
| `lib/debate/turnPipeline.ts` | Use `input.briefModel ?? input.model` per stage | Low |
| `lib/debate/debateEngine.ts` | Pass `stageModels` from config into pipeline input | Low |
| `taxonomy-editor/src/renderer/hooks/useDebateStore/slices/debateLoopSlice.ts` | Wire `stageModels` from UI config | Low |
| `lib/debate/calibration-config.json` | Add `stage_model_overrides` section | Trivial |

**Total estimated effort:** 2-4 hours for Shared Lib implementation + 1-2 hours for UI wiring.

---

## 5. Recommended First Experiment

### 5.1 Experiment Design

**Name:** `cheap-brief-cite-v1`

**Configuration:**
- Draft model: claude-opus-4 (unchanged)
- Plan model: claude-opus-4 (unchanged — conservative)
- Brief model: claude-haiku-4-5
- Cite model: claude-haiku-4-5
- All other parameters: matched to baseline

**A/B Test:**
- **Control:** All-opus debate on "Audit Trails & Discoverability" topic (baseline exists: debate-72a6e0a2)
- **Treatment:** Same topic, same parameters, Brief+Cite on haiku
- **Sample size:** 3 runs each (to account for stochastic variance; PRM variance was halved in prior comparison, so n=3 should be sufficient)

### 5.2 Primary Metrics to Monitor

| Metric | Baseline (opus) | Predicted Treatment | Acceptable Threshold |
|--------|----------------|--------------------|--------------------|
| `crux_addressed_ratio` | 0.33 | 0.28-0.33 | ≥0.25 |
| `taxonomy_mapped_ratio` | 0.68 | 0.60-0.65 | ≥0.55 |
| `repetition_rate` | 0.12 | 0.12-0.15 | ≤0.20 |
| `claims_forgotten_rate` | 0.05 | 0.05-0.08 | ≤0.10 |
| `situation_crux_alignment` | 0.0 | 0.0 | ≥0.0 (already at floor) |
| PRM mean | 0.72 | 0.68-0.72 | ≥0.65 |
| PRM variance | 0.008 | 0.008-0.012 | ≤0.015 |

### 5.3 Kill Criteria

Abort the experiment if any treatment run shows:
- `crux_addressed_ratio` < 0.20 (crux engagement collapsed)
- `repetition_rate` > 0.25 (debaters circling)
- `claims_forgotten_rate` > 0.15 (context loss from bad Briefs)
- Draft quality pre-check failure rate > 40% (cascading from bad Briefs)

### 5.4 Expected Outcomes

**Optimistic (60% probability):** Brief+Cite quality on haiku is indistinguishable from opus for these structured tasks. Metrics within 5% of baseline. Proceed to add Plan to the cheap-model set.

**Neutral (30% probability):** Brief quality slightly degrades (crux identification 5-10% worse), Cite quality maintained. Net acceptable. Keep Brief+Cite on haiku for cost-sensitive runs, opus for calibration runs.

**Pessimistic (10% probability):** Brief quality degrades substantially — wrong cruxes identified, key claims missed. Plan and Draft can't compensate. Roll back Brief to opus; keep only Cite on haiku (still saves 15%).

---

## 6. Future Experiment Roadmap

After the first experiment validates Brief+Cite on cheap:

| Phase | Change | Expected Savings | Risk |
|-------|--------|-----------------|------|
| **Phase 1** (this ticket) | Brief + Cite on haiku | 40% | Low |
| **Phase 2** | Add Plan to cheap set | +9% (total 48%) | Medium |
| **Phase 3** | Evaluator model → haiku | +5-8% | Medium |
| **Phase 4** | Pre-debate stages on flash-lite | +2-3% | Low |
| **Phase 5** | Dynamic: use cheap for early rounds, opus for crux rounds | Variable | Complex |

Phase 5 is the most interesting — it would use cheap models for the opening exploration rounds when arguments are broad, then switch to opus when cruxes are identified and precision matters. This requires crux-detection-based model switching, which aligns with the existing adaptive staging infrastructure.

---

## 7. Relationship to t/456

t/456 ("debate rerun optimization — use cheap engine exploration to seed expensive engine runs") is a related but distinct concept:
- **t/456:** Run a complete cheap debate first, then use its findings to seed an expensive debate
- **t/841 (this ticket):** Within a single debate run, use cheap models for specific pipeline stages

These are complementary. t/841's per-stage optimization is simpler, lower-risk, and provides immediate savings. t/456's full-rerun seeding could use t/841's infrastructure (per-stage model config) as a building block.

---

## 8. Implementation Tickets

The following implementation work is needed (to be created after design approval):

1. **Types + pipeline wiring** — Add `stageModels` to types, wire per-stage model override in `turnPipeline.ts` and `debateEngine.ts` (Shared Lib scope)
2. **UI wiring** — Add stage model config to debate settings UI (Taxonomy Editor scope)
3. **A/B test run** — Execute the `cheap-brief-cite-v1` experiment with matched parameters (CL scope)
4. **Calibration analysis** — Compare metrics and publish results (CL scope)
