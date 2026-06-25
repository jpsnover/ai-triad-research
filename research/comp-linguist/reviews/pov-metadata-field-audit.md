# POV Node Metadata Field Audit: Usage in Debate Prompts

**Ticket:** t/419
**Date:** 2026-05-08
**Author:** CL.Investigate1 (Computational Linguist)

---

## Executive Summary

Six POV node metadata fields were audited across the full pipeline: data schema → context injection → debate prompts. All 6 fields are well-populated (~87-89% of 572 nodes) and all 6 are injected into debate context. However, their treatment in debate prompts varies dramatically:

| Field | Data Pop. | Context Injected? | Debater Prompt Directive? | Moderator Prompt Directive? | Verdict |
|---|---|---|---|---|---|
| **epistemic_type** | 89% | YES | **NO** | **NO** | GAP — adopt |
| **rhetorical_strategy** | 89% | YES | **YES** (34 lines) | **YES** (8 lines) | Fully leveraged |
| **falsifiability** | 89% | YES | **YES** (44 lines) | **YES** (3 lines) | Fully leveraged |
| **node_scope** | 89% | YES | **YES** (28 lines) | **YES** (via scope mismatch) | Fully leveraged |
| **intellectual_lineage** | 87% | YES | **YES** (27 lines) | **YES** (shared lineage) | Fully leveraged |
| **assumes** | 87% | YES | **NO** | **NO** | GAP — adopt |

**Bottom line:** 4 of 6 fields are fully leveraged with detailed prompt directives. 2 fields (epistemic_type and assumes) are injected into context but the prompts never tell agents what to do with them — they're visible but inert. Both should be activated with targeted prompt additions.

---

## 1. Data Availability

All fields live on `graph_attributes` within each POV node (`GraphAttributes` interface in `lib/debate/taxonomyTypes.ts:21-39`).

**Population rates (572 POV nodes across acc/saf/skp):**

| Field | Populated | Rate | Type |
|---|---|---|---|
| `epistemic_type` | 509 | 89% | string — 6 canonical values (see below) |
| `rhetorical_strategy` | 509 | 89% | string (comma-separated, 1-2 strategy names) |
| `falsifiability` | 509 | 89% | enum: `low` \| `medium` \| `high` |
| `node_scope` | 509 | 89% | 4 values in data (see below) |
| `intellectual_lineage` | 497 | 87% | array of `{name, description?, url?, category?}` or strings |
| `assumes` | 497 | 87% | array of strings (unstated premises) |

**`epistemic_type` distribution (509 populated / 63 empty):**

| Value | Count | % of populated |
|---|---|---|
| `strategic_recommendation` | 178 | 35% |
| `empirical_claim` | 156 | 31% |
| `normative_prescription` | 73 | 14% |
| `interpretive_lens` | 40 | 8% |
| `predictive` | 26 | 5% |
| `definitional` | 22 | 4% |
| compound (2 types) | 14 | 3% |

The extraction prompt specifies "pick ONE" for epistemic_type. 14 nodes have compound values (e.g., `predictive, empirical_claim`) — these are extraction errors where the LLM ignored the single-value constraint. The `rhetorical_strategy` field, by contrast, intentionally allows "ONE or TWO, comma-separated."

**`node_scope` distribution (509 populated / 63 empty):**

| Value | Count | Notes |
|---|---|---|
| `scheme` | 252 | |
| `claim` | 248 | |
| `interpretive_lens` | 5 | **Not in TS type definition** — `taxonomyTypes.ts:38` declares `'claim' \| 'scheme' \| 'bridging'` only |
| `bridging` | 4 | |

**Schema mismatch:** The TS type at `taxonomyTypes.ts:38` declares 3 allowed values (`claim | scheme | bridging`) but the data contains a 4th value (`interpretive_lens`) on 5 nodes. The extraction prompt doesn't define `interpretive_lens` as a node_scope option either — these 5 nodes appear to have leaked the `epistemic_type` vocabulary into `node_scope`. This should be fixed in the data (reclassify to `scheme` or `claim`) or the TS type should be extended.

The 63 unpopulated nodes (11%) are older nodes from before the attribute extraction pipeline was run. These should be backfilled.

---

## 2. Context Injection Pipeline

**File:** `lib/debate/taxonomyContext.ts:153-176`

All 6 fields are injected into the formatted context block sent to debate agents. The injection loop (lines 157-176) emits each field as an indented sub-line beneath the node's label and description:

```
★ [acc-beliefs-012] Open-Source Validation: A Belief within accelerationist discourse...
    Epistemic type: empirical_claim
    Rhetorical strategy: appeal_to_evidence
    Falsifiability: high
    Scope: claim
    Intellectual lineage: Open-source movement; Innovation studies
    Assumes: Open-source AI development inherently leads to collective benefit
```

**Finding:** The pipeline is complete — data flows from JSON through to prompt context. The issue is purely at the prompt directive layer.

---

## 3. Prompt Directive Audit

### 3.0 Prompt Architecture — How Fields Reach Debate Agents

`lib/debate/prompts.ts` exports ~30 prompt functions. The metadata field directives live in shared constant blocks assembled into specific prompts. Understanding which prompts include which blocks is critical.

**Shared instruction blocks (constants):**

| Block | Lines | Contains field directives? |
|---|---|---|
| `MUST_CORE_BEHAVIORS` | 132-172 | No — structural rules only |
| `MUST_EXTENDED` | 174-204 | No — novelty/advancement rules |
| `TAXONOMY_USAGE` | 117-128 | No — BDI section usage guide |
| **`SHOULD_WHEN_RELEVANT`** | **298-601** | **YES — all 4 field directive sections live here** |
| `DIALECTICAL_MOVES` | 521-601 | No — move vocabulary |
| `COUNTER_TACTICS` | 603-634 | No — opponent pattern recognition |
| `PHASE_INSTRUCTIONS` | 206-253 | No — per-phase goals |

The 4 field directives are embedded within `SHOULD_WHEN_RELEVANT`:
- `RHETORICAL STRATEGY` — lines 349-414
- `FALSIFIABILITY AWARENESS` — lines 416-463
- `NODE SCOPE` — lines 465-491
- `INTELLECTUAL LINEAGE` — lines 493-519

**Assembly:** `allInstructions(phase?)` (line 257) combines all blocks including `SHOULD_WHEN_RELEVANT`.

#### Prompt functions that call `allInstructions()` — receive ALL 4 field directives

| Prompt Function | Line | Purpose |
|---|---|---|
| `openingStatementPrompt()` | 793 | Legacy single-call opening statement |
| `debateResponsePrompt()` | 874 | Legacy single-call debate response |
| `crossRespondPrompt()` | 1172 | Current: moderator-directed debate response |

#### Staged pipeline prompts (brief → plan → draft → cite) — PARTIAL or NO field directives

| Prompt Function | Line | Purpose | Gets `SHOULD_WHEN_RELEVANT`? |
|---|---|---|---|
| `briefStagePrompt()` | 1512 | Analytical brief | **NO** — only `PHASE_INSTRUCTIONS` |
| `briefOpeningStagePrompt()` | 1299 | Opening brief | **NO** — no instruction blocks |
| `planStagePrompt()` | 1561 | Argument plan | **NO** |
| `planOpeningStagePrompt()` | 1339 | Opening plan | **NO** |
| `draftStagePrompt()` | 1634 | Draft statement | **NO** — gets `MUST_CORE_BEHAVIORS` + `MUST_EXTENDED` only |
| `draftOpeningStagePrompt()` | 1365 | Draft opening | **NO** — gets `MUST_CORE_BEHAVIORS` only |
| `citeStagePrompt()` | 1725 | Add citations | **NO** — citation-focused |
| `citeOpeningStagePrompt()` | 1421 | Opening citations | **NO** — citation-focused |

#### Moderator prompts — inline field directives

| Prompt Function | Line | Purpose | Field directives? |
|---|---|---|---|
| `crossRespondSelectionPrompt()` | 1107 | Select next speaker/focus | **YES (inline)** — lines 1151-1158 |
| `moderatorSelectionPrompt()` | 2653 | Alternative moderator selection | Needs verification |
| `moderatorInterventionPrompt()` | 2759 | Craft intervention | No — intervention moves only |

#### Other prompts (synthesis, analysis, compression, etc.) — no field directives

`clarificationPrompt()`, `concludingPrompt()`, `probingQuestionsPrompt()`, `factCheckPrompt()`, `contextCompressionPrompt()`, `synthExtractPrompt()`, `synthMapPrompt()`, `synthEvaluatePrompt()`, `debateSynthesisPrompt()`, `missingArgumentsPrompt()`, `taxonomyRefinementPrompt()`, `midDebateGapPrompt()`, `reflectionPrompt()`, `documentClarificationPrompt()`, `situationClarificationPrompt()`, `entrySummarizationPrompt()` — none receive field directives.

Note: `crossCuttingNodePrompt()` surfaces `assumes` via `formatSituationDebateContext()` (line 2182) but with no usage directive.

#### Key Finding: Staged Pipeline Gap

The staged pipeline (`brief → plan → draft → cite`) does NOT include `SHOULD_WHEN_RELEVANT` in any stage. The `draft` stage gets `MUST_CORE_BEHAVIORS` but **not** the field directives. This means:

- **Legacy path** (single-call): Full coverage via `allInstructions()`
- **Staged path** (brief/plan/draft/cite): **No field directives** — agents receive raw field values in taxonomy context but no instruction on how to use them
- **crossRespond path**: Full coverage via `allInstructions(phase)`

If the staged pipeline is the active production path, even the "fully leveraged" fields may not effectively reach the drafting agent.

### 3.1 Fully Leveraged Fields (in `SHOULD_WHEN_RELEVANT`)

#### `rhetorical_strategy` — 34 lines in `SHOULD_WHEN_RELEVANT` + 8 lines in moderator

**In `SHOULD_WHEN_RELEVANT`** → reaches `openingStatementPrompt`, `debateResponsePrompt`, `crossRespondPrompt`
**Does NOT reach** `draftStagePrompt`, `draftOpeningStagePrompt`, or any staged pipeline prompt.

`prompts.ts:349-414` — Dedicated `RHETORICAL STRATEGY` section teaches agents:
- What each strategy means (Techno_Optimism, Precautionary_Framing, Appeal_To_Evidence, Structural_Critique, Moral_Imperative, etc.)
- Which dialectical moves pair with each strategy
- How to read opponents' strategies and counter them

**Moderator:** `crossRespondSelectionPrompt` (lines 1151-1155) — detects parallel strategies, unchallenged strategies, stuck-in-abstractions.

**Assessment:** Fully defined in `SHOULD_WHEN_RELEVANT`. Reaches legacy + crossRespond paths. Does not reach staged pipeline.

#### `falsifiability` — 44 lines in `SHOULD_WHEN_RELEVANT` + 3 lines in moderator

**In `SHOULD_WHEN_RELEVANT`** → reaches `openingStatementPrompt`, `debateResponsePrompt`, `crossRespondPrompt`
**Does NOT reach** staged pipeline prompts.

`prompts.ts:416-463` — Dedicated `FALSIFIABILITY AWARENESS` section with:
- Separate guidance for arguing FROM high/medium/low falsifiability nodes
- Separate guidance for CHALLENGING opponents' high/medium/low nodes
- Category error detection (treating normative claims as empirical, or vice versa)

**Moderator:** `crossRespondSelectionPrompt` (line 1156) — `FALSIFIABILITY MISMATCH` detection.

**Assessment:** Fully defined in `SHOULD_WHEN_RELEVANT`. Same coverage pattern as rhetorical_strategy.

#### `node_scope` — 28 lines in `SHOULD_WHEN_RELEVANT` + moderator scope mismatch

**In `SHOULD_WHEN_RELEVANT`** → reaches `openingStatementPrompt`, `debateResponsePrompt`, `crossRespondPrompt`
**Does NOT reach** staged pipeline prompts.

`prompts.ts:465-491` — Dedicated `NODE SCOPE` section with:
- Guidance for arguing from claim nodes vs. scheme nodes
- Scope mismatch detection and correction
- Explicit move-naming when deliberately shifting scope

**Moderator:** `crossRespondSelectionPrompt` (line 1157) — `SCOPE MISMATCH` detection.

**Assessment:** Fully defined in `SHOULD_WHEN_RELEVANT`. Note: the TS type allows 4 values (`claim`, `scheme`, `bridging`, `interpretive_lens`) but the prompt only teaches `claim` and `scheme`. The `bridging` and `interpretive_lens` values are not addressed. See Recommendation #3 below.

#### `intellectual_lineage` — 27 lines in `SHOULD_WHEN_RELEVANT` + moderator shared lineage

**In `SHOULD_WHEN_RELEVANT`** → reaches `openingStatementPrompt`, `debateResponsePrompt`, `crossRespondPrompt`
**Does NOT reach** staged pipeline prompts.

`prompts.ts:493-519` — Dedicated `INTELLECTUAL LINEAGE` section with three use cases:
- GROUNDING: Situate position in established tradition
- SHARED ROOTS: Narrow disagreements when both sides draw from same tradition
- EXPOSING TENSIONS: Surface known weaknesses in opponent's intellectual tradition

**Moderator:** `crossRespondSelectionPrompt` (line 1158) — `SHARED LINEAGE` detection.

**Assessment:** Fully defined in `SHOULD_WHEN_RELEVANT`. Same coverage pattern.

### 3.2 Gap Fields — Present in Context, No Directive in Any Prompt

#### `epistemic_type` — INJECTED BUT NOT DIRECTED

**Not in `SHOULD_WHEN_RELEVANT`. Not in any staged pipeline prompt. Not in any moderator prompt. Not in any prompt function anywhere.**

**Current state:** The field is injected into context (line 158-160 of taxonomyContext.ts) and also surfaced in `formatNodeAttributes()` (line 63-65). But no prompt directive in any of the ~30 prompt functions tells agents what to do with it.

**The gap:** Agents see `Epistemic type: normative_prescription` in their context but have no instruction on how this should change their argumentation. The `falsifiability` directives partially overlap (low falsifiability ≈ normative claims) but epistemic_type is more granular and captures distinctions falsifiability misses:

| epistemic_type | Count | Captured by falsifiability? | Unique signal |
|---|---|---|---|
| `strategic_recommendation` | 178 | No | Action-oriented claims need feasibility arguments, not evidence |
| `empirical_claim` | 156 | Partially (high/medium) | Says the claim IS testable, not just that it COULD be |
| `normative_prescription` | 73 | Partially (low) | Distinguishes "should" claims from definitional claims |
| `interpretive_lens` | 40 | No | Framing claims can't be refuted — only reframed |
| `predictive` | 26 | No | Forward-looking claims need different evidence standards |
| `definitional` | 22 | No | "What X means" disputes need terminological, not empirical, engagement |

**Assessment:** **ADOPT.** Epistemic type carries signal that falsifiability alone doesn't capture. The most valuable distinction: `definitional` vs `empirical_claim` vs `normative_prescription` vs `strategic_recommendation` — these require fundamentally different argumentative modes. See proposed prompt text below.

#### `assumes` — INJECTED, MINIMALLY DIRECTED

**Not in `SHOULD_WHEN_RELEVANT`. Brief mention in `PHASE_INSTRUCTIONS['confrontation']` (line 212: "Name your key assumptions explicitly"). Output field in `draftOpeningStagePrompt` (line 1402: `key_assumptions` JSON schema). Surfaced in `crossCuttingNodePrompt` via `formatSituationDebateContext` (line 2182). No systematic usage directive anywhere.**

**Current state:** The field is injected into context (lines 173-175 of taxonomyContext.ts) and surfaced in `formatNodeAttributes()` (lines 49-51). Agents see lines like:
```
    Assumes: Open-source AI development inherently leads to collective benefit; Centralized control is inherently dangerous
```

The confrontation phase instructions include a brief line ("Name your key assumptions explicitly so opponents can engage with them" — line 212), and the REFRAME move mentions "surfacing hidden assumptions" (line 537). But there is no systematic directive teaching agents how to use the `assumes` data that's now injected per-node, or how to target opponents' listed assumptions.

**The gap:** Assumptions are the hidden load-bearing structure of arguments. The REFRAME move description mentions "surfacing hidden assumptions" (line 537), and the document-grounding prompt says "Note what the document assumes without defending" (line 710). But there is no systematic directive telling agents to:
- Acknowledge their own assumptions when challenged
- Target opponents' stated assumptions as attack surfaces
- Distinguish between assumptions they share (common ground) and assumptions they don't (genuine disagreement)

**Assessment:** **ADOPT.** Assumes data is the single richest attack surface available to debate agents. Every assumption listed is an explicit invitation for UNDERCUT or REFRAME moves. See proposed prompt text below.

---

## 4. Proposed Prompt Changes

### Proposal 1: EPISTEMIC TYPE directive for debaters

**Location:** Insert after the FALSIFIABILITY AWARENESS section (after line 463 in prompts.ts), before NODE SCOPE.

**Phase targeting:** All phases, but most valuable in confrontation (establishing what KIND of disagreement this is) and exploration (preventing category errors).

**Token cost:** ~350 tokens (comparable to the NODE SCOPE section).

```
EPISTEMIC TYPE: Each node in your taxonomy includes an epistemic_type field that
classifies the KIND of claim it makes. This is distinct from falsifiability — a
claim can be highly falsifiable but still be a prediction rather than an empirical
observation. Matching your argumentative approach to the epistemic type prevents
the most common debate category errors.

- EMPIRICAL CLAIM: This node asserts something about how the world IS, based on
  observation or data. Argue with evidence. Challenge with counter-evidence. If
  you and your opponent both cite empirical claims, the debate should turn on
  evidence quality, recency, and representativeness — not on values.

- NORMATIVE PRESCRIPTION: This node asserts what SHOULD happen — a goal, a duty,
  or a principle. You cannot refute a normative claim with evidence alone. Argue
  from coherence, shared values, or consequences. Challenge by showing the
  prescription conflicts with other values the opponent holds, or that it leads to
  unacceptable outcomes when applied consistently.

- STRATEGIC RECOMMENDATION: This node proposes HOW to act — a policy, a method, or
  a program. The appropriate challenge is FEASIBILITY: Can this actually be
  implemented? What are the costs? What happens when it encounters real-world
  constraints? Evidence about what HAS worked (or failed) in analogous cases is
  the strongest move.

- PREDICTIVE: This node makes a claim about the FUTURE. The appropriate challenge
  is to demand specificity: What timeline? What threshold? What would count as
  this prediction failing? Predictions without falsifiable timelines are
  unfalsifiable — call that out.

- DEFINITIONAL: This node defines a term or draws a conceptual boundary. The
  disagreement is about WHAT COUNTS AS X, not about facts or values. The
  appropriate response is to show that the definition is too narrow (excludes
  relevant cases), too broad (includes irrelevant cases), or loaded (smuggles in a
  conclusion). Use DISTINGUISH.

- INTERPRETIVE LENS: This node offers a FRAMING — a way of seeing the problem.
  Lenses cannot be refuted; they can only be shown to be less useful than an
  alternative lens for the case at hand. Use REFRAME to offer a competing lens and
  show what your lens reveals that theirs hides.

CROSS-TYPE ENGAGEMENT: When you and an opponent are operating from different
epistemic types on the same topic — you're making an empirical claim and they're
arguing from a normative prescription — NAME THE MISMATCH before engaging. "You're
arguing that we SHOULD do X. I'm arguing that X WON'T WORK. These are different
questions — let's address both." This prevents the most common form of talking past
each other.
```

**Expected impact on calibration metrics:**
- `crux_addressed_rate` — UP (agents will identify the actual type of disagreement)
- `engagement_depth` — UP (type-matched responses engage substance, not form)
- `repetition_rate` — DOWN (fewer cycles of empirical-vs-normative mismatch)

### Proposal 2: ASSUMES directive for debaters

**Location:** Insert after the INTELLECTUAL LINEAGE section (after line 519 in prompts.ts), before the DIALECTICAL MOVES section.

**Phase targeting:** Most valuable in exploration (surfacing hidden premises) and confrontation (targeting load-bearing assumptions). Less relevant in synthesis.

**Token cost:** ~250 tokens.

```
ASSUMPTIONS: Each node in your taxonomy lists its key underlying assumptions — the
unstated premises it depends on. Assumptions are the load-bearing structure of
arguments: if an assumption fails, the argument built on it collapses.

USING YOUR OWN ASSUMPTIONS:
- When advancing a position, you KNOW what your argument assumes (it's listed in
  your taxonomy). If an opponent challenges one of your stated assumptions, do not
  pretend you weren't making it. Either DEFEND the assumption with evidence, or
  CONCEDE that it's genuinely contestable and explain what your argument looks like
  without it.
- When your argument depends on an assumption that your OPPONENT explicitly rejects,
  that assumption IS the crux. Name it: "This disagreement hinges on whether [stated
  assumption] holds. If it does, my conclusion follows. If it doesn't, yours does."

TARGETING OPPONENTS' ASSUMPTIONS:
- The listed assumptions on opponent nodes are pre-identified attack surfaces. An
  UNDERCUT move that targets a stated assumption is often more effective than a direct
  REBUT of the conclusion — it removes the foundation rather than fighting the
  superstructure.
- When two opponents share an assumption that YOU reject, name the shared assumption
  and challenge it. This shifts the debate from two-against-one on the conclusion to
  a genuine three-way disagreement on the premise.

SHARED ASSUMPTIONS AS COMMON GROUND:
- When you and an opponent share the same assumption, that's common ground — state it
  explicitly. Shared assumptions narrow the disagreement to what actually differs.
```

**Expected impact on calibration metrics:**
- `crux_addressed_rate` — UP (assumptions are often the actual cruxes)
- `engagement_depth` — UP (UNDERCUT moves targeting assumptions are deeper than surface rebuttals)
- `claims_forgotten` — DOWN (explicit assumption tracking makes arguments more memorable)
- `convergence_score` — UP (shared assumption identification accelerates convergence)

### Proposal 3: Extend NODE SCOPE to cover `bridging` and `interpretive_lens` values

**Location:** Extend the existing NODE SCOPE section (line 465-491 in prompts.ts) to cover the two missing node_scope values.

**Token cost:** ~80 tokens (append to existing section).

```
- BRIDGING nodes connect two perspectives or domains. When arguing from a bridging
  node, your job is to show how the bridge holds under scrutiny — that the analogy or
  connection is substantive, not superficial. When attacking a bridging node, show where
  the analogy breaks down — what's true on one side of the bridge that isn't true on the
  other.
```

(The `interpretive_lens` scope value overlaps with the epistemic_type `interpretive_lens` directive in Proposal 1, so no separate addition needed.)

### Proposal 4: EPISTEMIC TYPE directive for moderator

**Location:** Add to the moderator's rhetorical dynamics section (after line 1158 in prompts.ts).

**Token cost:** ~60 tokens.

```
  * EPISTEMIC TYPE MISMATCH: If debaters are arguing past each other because one is
    making an empirical claim while the other is arguing a normative prescription (or a
    definition, or a prediction), direct them to name the type of disagreement before
    continuing. "You're arguing about what IS true and your opponent is arguing about what
    SHOULD happen — address both dimensions."
```

### Proposal 5: ASSUMPTIONS directive for moderator

**Location:** Add to the moderator's rhetorical dynamics section (after Proposal 4).

**Token cost:** ~40 tokens.

```
  * HIDDEN ASSUMPTIONS: If a debater's argument relies heavily on an assumption that
    opponents haven't challenged, direct an opponent to examine it — "The argument at
    [node-id] assumes [assumption]. Has anyone tested that premise?"
```

---

## 5. Summary of Recommendations

| # | Recommendation | Priority | Token Cost | Target | Location |
|---|---|---|---|---|---|
| 1 | **Add EPISTEMIC TYPE directive** | High | ~350 tokens | `SHOULD_WHEN_RELEVANT` | After FALSIFIABILITY (line 463) |
| 2 | **Add ASSUMES directive** | High | ~250 tokens | `SHOULD_WHEN_RELEVANT` | After INTELLECTUAL LINEAGE (line 519) |
| 3 | **Extend NODE SCOPE for bridging** | Medium | ~80 tokens | `SHOULD_WHEN_RELEVANT` | Append to NODE SCOPE (line 491) |
| 4 | **Add EPISTEMIC TYPE moderator line** | Medium | ~60 tokens | `crossRespondSelectionPrompt` | After line 1158 |
| 5 | **Add ASSUMES moderator line** | Medium | ~40 tokens | `crossRespondSelectionPrompt` | After line 1158 |
| 6 | **Investigate staged pipeline gap** | High | 0 tokens | `draftStagePrompt` / `planStagePrompt` | Architecture decision |

**Total token cost of proposals 1-5:** ~780 tokens added to `SHOULD_WHEN_RELEVANT`.

**Current context token estimate:** ~80 tokens per POV node (from `computeInjectionManifest`), with ~50 nodes typical = ~4,000 tokens for taxonomy context alone. Adding 780 tokens to `SHOULD_WHEN_RELEVANT` is a ~20% increase in the prompt instruction portion, but a ~5% increase in total context.

**Critical note on Recommendation #6:** The staged pipeline (`brief → plan → draft → cite`) does not include `SHOULD_WHEN_RELEVANT` in any stage. This means proposals 1-3 will only reach agents via the legacy single-call prompts and `crossRespondPrompt`. If the staged pipeline is the production path, a separate decision is needed: either (a) add `SHOULD_WHEN_RELEVANT` to `planStagePrompt` (where strategy should be planned), (b) extract key field directives into a compact block for `draftStagePrompt`, or (c) rely on the plan stage having already factored in field values from the taxonomy context. This is an architecture decision beyond the scope of this audit — flagging for the Tech Lead.

### Golden Test Cases

To validate prompt changes, evaluate on these debate scenarios:

1. **Empirical vs normative mismatch** — Topic where acc makes empirical claims about AI capability while saf argues from normative commitments about safety obligations. After the change, agents should NAME the type mismatch rather than talking past each other.

2. **Assumption-as-crux** — Topic where a shared assumption (e.g., "AGI is achievable within 20 years") underlies both acc and saf positions but skp rejects it. After the change, skp should target the assumption explicitly rather than arguing the superstructure.

3. **Definitional dispute** — Topic where the core disagreement is about what counts as "alignment" or "safety." After the change, agents should recognize this as a definitional dispute and use DISTINGUISH rather than citing evidence for an inherently definitional question.

4. **Bridging node engagement** — Debate involving a bridging node. After the change, agents should argue about whether the bridge holds rather than treating it as a standard claim.

---

## 6. Fields to Skip

None. All 6 fields carry actionable signal and are well-populated. The 4 already-leveraged fields have full directives in `SHOULD_WHEN_RELEVANT` (though the staged pipeline gap means they may not reach the draft-stage LLM). The 2 gap fields should be activated with the proposed directives.

---

*Completed: 2026-05-08 · CL.Investigate1 (Computational Linguist) · AI Triad Research*
*Ticket: t/419*
