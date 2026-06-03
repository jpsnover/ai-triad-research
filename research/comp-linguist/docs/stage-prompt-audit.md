# Per-Turn Debate Stage Prompt Audit

**Author:** CL.Investigate1 (Computational Linguist)
**Date:** 2026-05-30
**Ticket:** t/287
**Status:** Reference document with recommendations

---

## Summary

Every per-turn debate stage prompt was read in full and evaluated for structural fitness. Three systemic problems emerged:

1. **The Draft stage re-teaches core behaviors every turn** (~441 lines of MUST instructions repeated per turn instead of taught once)
2. **The Plan stage re-teaches epistemology every turn** (~1,300 words of "field-aware strategy" pedagogy repeated per turn)
3. **The Cite stage has role confusion** (it's told to manage citation rotation, which is the debater's job, not the grounding analyst's job)

These three issues account for an estimated **~2,500-3,000 wasted tokens per turn** and create primacy bias problems (the LLM sees pedagogical content before the actual task).

---

## Per-Stage Fitness Assessment

### Brief (temp=0.15) — EXCELLENT

**What it does:** Pure analytical decomposition of debate state.

**What it asks for:** Situation assessment, key claims to address with grounding, commitments, edge tensions, phase considerations.

**Structural fitness:** Clean. No instruction clutter, no pedagogical content. The Brief is a meta-analyst prompt that correctly stays out of the debater's voice. The grounding requirement (2-4 nodes per claim from different BDI categories) is well-specified.

**Verdict:** No changes needed.

---

### Plan (temp=0.4) — OVERLOADED

**What it does:** Strategic move selection based on the Brief.

**What it asks for:** Strategic goal, planned moves, target claims, argument sketch, anticipated responses, target nodes.

**Structural problem:** The Plan prompt contains a ~1,300-word "FIELD-AWARE STRATEGY" section that teaches:
- Epistemic type matching (empirical_claim → argue with evidence; normative_prescription → argue from coherence)
- Rhetorical strategy pairing (techno_optimism pairs with EXTEND/REFRAME)
- Falsifiability calibration (HIGH → cite evidence; MEDIUM → separate testable/untestable; LOW → argue coherence)
- Assumption targeting strategy
- Node scope and bridging node guidance

This is **pedagogy, not planning.** These are general principles the debater should learn once (in the opening statement), not re-read before every turn. By the time the LLM processes 1,300 words of epistemology, the actual strategic task (lines at the end) suffers from attention decay.

**Token cost:** ~500 tokens of pedagogical content per turn. Over a 10-turn debate: ~5,000 tokens wasted on re-teaching.

**Recommendation:** Extract the field-aware strategy content to a one-time instruction in the opening statement prompt. In the Plan stage, reference it with a 2-sentence reminder:

```
Match your argument mode to each claim's epistemic type and falsifiability
level (per the field-aware strategy from your opening brief). Target the
opponent's load-bearing assumptions first.
```

This preserves the guidance without the per-turn cost.

> **Q: Each API call is stateless — how could a per-turn prompt refer to something in the opening? And if context IS shared, aren't we contaminating POVs by using the same backend?**
>
> **A: Each API call IS stateless. The LLM has zero memory of prior calls. The original recommendation to "reference the opening" was wrong — the LLM can't remember instructions from a prior API call. The MUST content is repeated every turn precisely because each call is independent.**
>
> **No POV contamination:** Each debater's turn is a separate API call with its own system prompt, persona, and POV-specific taxonomy context. Prometheus's call never sees Sentinel's context. They share the same backend *service* but not the same context window.
>
> **Revised recommendation:** Instead of removing the MUST content, **compress it.** The current ~403 lines include detailed pedagogy with examples, edge cases, and rationale. A compressed version (~100 lines) that states the rules as directives without teaching examples would save ~1,200 tokens while preserving the constraints. Alternatively, tier the instructions: full pedagogy for turns 1-3, compressed reminder for turns 4+. See t/291 (updated to reflect this).

---

### Evidence (deterministic) — EXCELLENT

**What it does:** Retrieves source facts from the evidence index for the Plan's target nodes.

**Structural fitness:** No prompt — purely deterministic. The diverse evidence sampling (t/273) handles fact selection. The scoped citation bank (t/274) handles source constraints. Both are well-structured.

**Verdict:** No changes needed.

---

### Citation Bank (deterministic) — EXCELLENT (after t/274)

**What it does:** Builds a scoped list of verified source documents for the Draft to cite.

**Structural fitness:** After t/274 (scoped bank), this stage is clean. 15 turn-relevant sources instead of the full corpus. The 4-tier priority (evidence-selected → prior-cited → buffer → legislation) is well-designed.

**Verdict:** No changes needed.

---

### Draft (temp=0.7) — SEVERELY OVERLOADED

**What it does:** Generates the actual debater statement.

**What it embeds:** The Draft prompt contains, in order:
1. Identity declaration (2 lines)
2. `MUST_CORE_BEHAVIORS` (~403 lines)
3. `MUST_EXTENDED` (~28 lines)
4. `STEELMAN_INSTRUCTION` (~10 lines)
5. Doctrinal boundaries
6. Situation Brief (from Stage 1)
7. Argument Plan (from Stage 2)
8. Moderator directive handling (conditional, ~20 lines)
9. Assignment and phase directive
10. Output constraints (paragraphs, claim sketching, turn symbols, etc.)
11. Style reinforcement
12. JSON schema

**Structural problem:** Items 2-4 are **one-time pedagogical content** (core debate behaviors, extended behaviors, steelman instruction) that total ~441 lines / ~1,800 tokens. They are also present in the opening statement prompt. By the time the Draft runs on turn 5, the debater has seen these instructions 5 times. They are stale noise that pushes the actual task (items 6-12) deep into the prompt.

**Lost-in-the-Middle effect:** The LLM processes identity → 1,800 tokens of MUST content → Brief → Plan → assignment. The Brief and Plan (the most important turn-specific context) land in the middle of a long prompt — exactly where LLM attention is weakest.

**Token cost:** ~1,800 tokens of repeated MUST content per turn. Over a 10-turn debate: ~18,000 tokens wasted on re-teaching.

**Recommendation:** ~~Remove MUST content and replace with a compact reminder.~~ **REVISED:** The LLM cannot "remember" prior instructions — each API call is stateless. The MUST content must be present in every Draft prompt.

> **Q: What would the reminder remind them of if there is no context sharing?**
>
> **A: Nothing — that's the flaw in the original recommendation. A 50-token "reminder" of rules the LLM never saw in this API call is meaningless. The LLM needs the actual rules, not a reference to rules it can't access.**

**Revised recommendation:** **Compress, don't remove.** The current MUST content is ~441 lines of detailed pedagogy with examples, edge cases, and rationale. Much of this is *teaching* (explaining why a rule matters, showing good/bad examples) rather than *directing* (stating the rule). A compressed version that states rules as directives without examples could achieve ~60% of the token savings (~1,100 tokens) while preserving all constraints:

Current (~1,800 tokens):
```
CONCEDE HONESTLY. Real debates involve position changes...
- You MUST concede when the evidence clearly supports the opponent's claim
  — defending a weak point undermines your strong ones
- Concessions demonstrate strength, not weakness...
- After conceding, explain why your overall position still holds despite
  this concession
- Concessions should emerge from genuine reasoning, not reflexive patterns.
  Check the concession counter in YOUR RECENT MOVES...
```

Compressed (~400 tokens for this section):
```
CONCEDE when evidence supports the opponent. Defending weak points
undermines strong ones. After conceding, explain why your overall
position still holds.
```

The teaching examples ("Concessions demonstrate strength, not weakness") and meta-instructions ("Check the concession counter") can be dropped. The directive ("CONCEDE when evidence supports the opponent") is sufficient for a capable LLM.

**Alternatively: Tier the instructions.** Full pedagogy for turns 1-3 (when the debate style is being established), compressed directives for turns 4+ (when the LLM has demonstrated compliance). This is a per-turn conditional in prompt assembly.

**Impact:** Saves ~1,100 tokens per turn (compressed) or ~1,100 tokens for turns 4+ (tiered). Moves Brief and Plan closer to prompt start.

---

### Draft Quality Pre-Check (temp=0.1, optional) — EXCELLENT

**What it does:** Lightweight 3-question gate (grounded? falsifiable? engages?).

**Structural fitness:** Clean, crisp, task-focused. The planned-moves exclusion block is essential (prevents false negatives). The optional calibration question (confidence-matched rhetoric) is well-integrated.

**Verdict:** No changes needed.

---

### Cite (temp=0.15) — ROLE CONFUSION

**What it does:** Grounds the finished statement in taxonomy nodes.

**What it should do:** "Here is a statement. Identify which taxonomy nodes it drew from and explain how."

**What it actually does:** In addition to the grounding task, the Cite prompt:
1. Lists recently cited nodes
2. Lists *uncited* nodes ("Nodes from your POV you have NOT yet cited: ...")
3. Lists cross-POV nodes available for engagement
4. States: "REQUIRED: At least 1-2 of this turn's taxonomy_refs must NOT be in that list"

This is **citation management instruction** — telling the analyst to rotate citations and ensure novelty. But the analyst's job is *grounding analysis*: "what nodes did this statement draw from?" The citation rotation responsibility belongs to the **debater** (via the OUTPUT_FORMAT instruction in the Draft prompt, which already says "ROTATE YOUR CITATIONS").

**The problem:** By instructing the Cite analyst to manage citation rotation, we're biasing the grounding analysis. If the debater's statement genuinely drew from the same nodes as last turn (because the argument continued on the same topic), the Cite analyst is incentivized to *find different nodes* to satisfy the novelty requirement — producing inaccurate grounding.

**Recommendation:** Remove citation rotation instruction from the Cite prompt. Keep the recent-citations context (so the analyst knows what was cited before — useful for accuracy), but remove the REQUIRED novelty constraint and the uncited-nodes suggestion list. The Cite prompt becomes:

```
Identify 3-5 taxonomy nodes this statement drew from. For each, explain
in 1-4 sentences how it informed the argument. Rate grounding confidence
(0.0-1.0).

For context, these nodes were cited in recent turns: [list]
This does NOT mean you should avoid them — cite whatever the statement
actually drew from.
```

**Impact:** More accurate grounding analysis. Citation rotation is still enforced by the Draft stage's OUTPUT_FORMAT constraints, where it belongs.

---

### Claims Extraction / Classification — WELL-STRUCTURED

**What it does:** Extracts 3-6 claims from the statement, classifies BDI category, grounding, relationships, argumentation schemes.

**Structural fitness:** Dense but justified. The output schema is complex (12+ fields per claim) because it feeds the argument network, QBAF scoring, crux detection, and confidence evolution. Every field has a downstream consumer.

**Two variants:** The standalone `extractClaimsPrompt` (full extraction from scratch) and the hybrid `classifyClaimsPrompt` (debater supplies claims, analyst classifies relationships) are well-differentiated. The hybrid reduces hallucination risk by anchoring to the debater's own claim sketches.

**One concern:** The `base_strength` field is asked for all BDI categories despite being Belief-only in practice (t/68). After t/68 ships, this prompt section will be corrected.

**Verdict:** No structural changes needed beyond t/68.

---

## LLM vs. Deterministic Boundary Analysis

### Currently LLM — Should Be Deterministic

| Task | Current | Should Be | Rationale |
|------|---------|-----------|-----------|
| Move normalization | LLM outputs move names → `getMoveName()` normalizes | Keep as-is | The LLM chooses moves; normalization handles variants. Both are needed. |
| Citation rotation | Cite prompt instructs novelty | Remove from Cite; enforce in Draft OUTPUT_FORMAT | Grounding should be descriptive, not prescriptive |

### Currently Deterministic — Should Stay Deterministic

| Task | Stage | Assessment |
|------|-------|------------|
| Evidence retrieval | Stage 2.5 | Correct — no LLM judgment needed for fact lookup |
| Citation bank build | Stage 2.6 | Correct — scoping is rule-based |
| Citation scrub | Post-Draft | Correct — fabrication detection is pattern matching |
| QBAF propagation | Post-Claims | Correct — graph algorithm, not judgment |

### Potential LLM→Deterministic Conversions

| Task | Current | Proposal | Token Savings |
|------|---------|----------|:-------------:|
| `disagreement_type` in Draft | LLM classifies | Could be inferred from the Plan's target claims + argumentation schemes | ~20 tokens |
| `grounding_confidence` in Cite | LLM rates 0-1 | Could be computed from taxonomy_ref count × relevance scores | ~15 tokens |
| `extraction_confidence` in Claims | LLM self-reports | Already capped by word overlap (FIRE check) — consider making fully deterministic | ~10 per claim |

These are marginal savings. The LLM classifications are generally useful because they capture nuance that deterministic computation misses. Not recommended for V1.

---

## Stage Decomposition Opportunities

### Should Split: Draft Stage Post-Processing

The Draft stage currently runs inline post-processing after the LLM generates:
1. Citation scrub (remove fabricated citations)
2. Linkification (add markdown links)
3. Evidence utilization check
4. Ungrounded claims detection
5. Citation validation

These are 5 deterministic steps crammed into the Draft stage's code path. They should be a separate **POST-DRAFT** stage for clarity and diagnostic observability. Currently they share the Draft's stage diagnostics entry, making it hard to distinguish "Draft generation took 5s" from "Draft generation took 3s + citation scrub took 2s."

**Recommendation:** Extract post-Draft processing into a named `postDraft` stage with its own diagnostics entry. No prompt changes — pure code organization.

### Should Merge: Evidence + Citation Bank

Evidence retrieval and Citation Bank build are both deterministic, run sequentially, and share the same data sources (evidence index, doc metadata). They're already adjacent in the pipeline (stages 2.5 and 2.6). Merging them into a single `evidence` stage would:
- Eliminate the intermediate `evidenceDocIds` handoff
- Produce a single diagnostics entry covering "what evidence was retrieved and what sources are available"
- Simplify the pipeline code

**Recommendation:** Merge into a single `evidence` deterministic stage. Low effort, improved clarity.

### Should NOT Split: Brief Stage

The Brief produces 5 structured outputs (situation assessment, key claims, commitments, edge tensions, phase considerations) — but they're all facets of a single analytical task ("understand the debate state"). Splitting them into sub-stages would fragment the LLM's contextual understanding and require passing partial analysis between sub-prompts.

### Should NOT Split: Plan Stage (After Pedagogy Extraction)

Once the field-aware strategy pedagogy is extracted (Recommendation #2), the Plan stage is a clean strategic task: given the Brief, pick moves and targets. The move selection, target identification, and anticipated responses are all interdependent — splitting them would lose strategic coherence.

---

## Conflicting Instructions

### 1. Draft: "Be concise" vs. "Include everything"

The Draft prompt (lines 1919-1975 in `prompts.ts`) loads the debater with **12 simultaneous requirements**. Here is every requirement the LLM must satisfy in a single JSON response:

#### Complete Requirement Inventory

| # | Requirement | Source Line | Type | Tokens |
|---|---|---|---|---|
| 1 | Stay in character as {persona} | 1919-1920 | Identity | ~20 |
| 2 | Write for external reader, not debaters | MUST_CORE (line 168) | Voice | ~50 |
| 3 | 3-5 paragraphs separated by \n\n | 1949-1951 | Structure | ~15 |
| 4 | Each paragraph develops one distinct idea | 1950 | Structure | ~10 |
| 5 | Claim + evidence + warrant structure | MUST_CORE (line 170) | Content | ~40 |
| 6 | At least one claim with concrete number/entity/threshold | 1955 | Content | ~25 |
| 7 | Steelman before critiquing | MUST reminder (1927) | Content | ~5 |
| 8 | Concede strong opponent points | MUST reminder (1928) | Content | ~5 |
| 9 | Never repeat -- advance the conversation | MUST reminder (1930) | Content | ~5 |
| 10 | Address the moderator directive in paragraph 1 | 1906-1908 (conditional) | Content | ~60 |
| 11 | Phase-specific directive (explore/converge/engage) | 1886-1890 | Content | ~20 |
| 12 | Execute the argument plan from Stage 2 | 1943 | Content | ~10 |
| 13 | Engage specific target nodes from plan | 1876-1878 | Content | ~30 |
| 14 | Include constructive move (CONCEDE-AND-PIVOT/INTEGRATE/EXTEND/SPECIFY) | 1957 (conditional, turn 4+) | Content | ~25 |
| **Output fields (JSON):** | | | |
| 15 | `statement` -- the full 3-5 paragraph debate response | 1963 | Output | ~10 |
| 16 | `claim_sketches` -- 3-6 claims with near-verbatim text + targets | 1967-1970 | Output | ~40 |
| 17 | `key_assumptions` -- 1-2 assumptions with if_wrong consequences | 1971-1973 | Output | ~30 |
| 18 | `turn_symbols` -- 1-3 emoji with tooltips containing analogy + provocative question | 1964-1966 | Output | ~40 |
| 19 | `disagreement_type` -- EMPIRICAL/VALUES/DEFINITIONAL | 1974 | Output | ~10 |
| 20 | `position_update` -- how position evolved (concluding phase only) | 1893 | Output | ~15 |
| 21 | Moderator-specific response field (e.g., `pin_response`, `probe_response`) | 1981-1993 (conditional) | Output | ~30 |

**When a moderator directive is active (turns 4+), the LLM must simultaneously:**
- Address the moderator in paragraph 1 (requirement 10)
- Include a constructive move (requirement 14)
- Steelman before critiquing (requirement 7)
- Concede a strong point (requirement 8)
- Execute the argument plan (requirement 12)
- Engage target taxonomy nodes (requirement 13)
- Produce 3-6 claim sketches with targets (requirement 16)
- Produce 1-2 key assumptions with if_wrong (requirement 17)
- Produce 1-3 turn symbols with complex tooltips (requirement 18)
- Produce a moderator-specific response field (requirement 21)
- Stay within 3-5 paragraphs (requirement 3)

That is **11 content/structural requirements + 4 output fields** in a single 3-5 paragraph response. This is a packing problem -- the LLM cannot address a moderator directive, steelman an opponent, concede a point, advance with new evidence, AND produce 6 claim sketches in 3 paragraphs without either truncating the argument or producing dense, citation-heavy prose that loses natural flow.

#### What to Cut

| Requirement | Verdict | Rationale |
|---|---|---|
| **Turn symbols** (#18) | **CUT when moderator directive active** | The tooltip format is complex (~40 tokens of instruction for emoji selection). When the debater has a moderator directive to address, turn symbols add cognitive load without argumentative value. Make conditional: `if (!pendingIntervention) { include turn_symbols instruction }` |
| **Turn symbols** (#18) | **SIMPLIFY when no directive** | The current tooltip format requires "debate concept FIRST, symbol referent SECOND, provocative question at end." This is 3 sub-requirements for decoration. Simplify to: `"turn_symbols": [{"symbol": "emoji", "tooltip": "1-sentence analogy"}]` |
| **Claim specificity** (#6) | **SOFTEN** | "At least one claim MUST include a concrete number, named entity, timeline, or threshold" with "will be rejected" is overly rigid. Some turns legitimately have no numeric claims (e.g., a values-focused concluding turn). Change to: "Prefer concrete specifics (numbers, dates, named entities) where available." Remove "will be rejected." |
| **Constructive move** (#14) | **MERGE with plan execution** | The Plan stage already selects moves. If the Plan chose CONCEDE-AND-PIVOT, the Draft doesn't need a separate instruction to "include a constructive move." The Draft should execute the Plan, not independently verify it included the right move types. Remove the separate CONSTRUCTIVE MOVE REQUIRED instruction; rely on the Plan's move selection. |

#### What to Change

| Requirement | Change | Rationale |
|---|---|---|
| **Key assumptions** (#17) | **Move to post-Draft extraction** | Key assumptions are metadata about the argument, not part of the argument itself. The LLM can produce a better statement if it doesn't have to simultaneously identify its own assumptions. Extract assumptions in a lightweight post-Draft pass (same as claim extraction). |
| **Claim sketches** (#16) | **Keep but reduce minimum** | Change "3-6 claims" to "2-5 claims." 3 is often too many for a focused 3-paragraph response. The extraction pipeline will find additional claims the debater didn't sketch. |
| **Disagreement type** (#19) | **Move to claim extraction** | The disagreement type is about the claims, not the statement. The claim extraction prompt already classifies claims. Remove from Draft output schema. |
| **Moderator directive** (#10) | **Simplify the instruction** | The current 8-line instruction (lines 1901-1908) includes "CRITICAL:", "VALIDATION WARNING:", and detailed paragraph-level prescriptions. Compress to: "Paragraph 1: respond directly to the moderator's challenge. State your position and one reason. Then proceed with your argument." The validation check enforces compliance regardless of instruction verbosity. |

#### Net Effect

| Metric | Current | After Changes |
|---|---|---|
| Simultaneous content requirements (w/ moderator) | 11 | 7 |
| Output JSON fields (w/ moderator) | 7 | 4 (statement, claim_sketches, turn_symbols or none, moderator_response) |
| Instruction tokens for output schema | ~200 | ~100 |
| Packing pressure | Severe (11 goals in 3-5 paragraphs) | Manageable (7 goals, 2 deferred to post-processing) |

#### What Stays Unchanged

- **Statement** (#15) -- the core output, always required
- **Claim sketches** (#16) -- essential for AN quality, reduced minimum only
- **Persona/voice** (#1, #2) -- identity constraints, non-negotiable
- **Paragraph structure** (#3, #4) -- structural quality, non-negotiable
- **Plan execution** (#12, #13) -- the whole point of the staged pipeline
- **Phase directive** (#11) -- phase-appropriate behavior, non-negotiable
- **Concession/steelman/advance** (#7, #8, #9) -- core debate behaviors (now in compressed MUST per t/294)

### 2. Cite: "Identify what the draft drew from" vs. "Cite new nodes"

As analyzed above, the Cite prompt's grounding task (descriptive) conflicts with its citation rotation mandate (prescriptive). These should be separated: grounding in Cite, rotation enforcement in Draft.

### 3. Plan: "Anticipate responses" vs. "Don't plan too far ahead"

The Plan asks for `anticipated_responses` but the phase instruction for `argumentation` says "test edge cases, probe deeper." These aren't contradictory, but the anticipated_responses field encourages defensive planning (what will they say?) while the phase instruction encourages offensive exploration (what can I test?). The debater may prioritize one over the other depending on which instruction they attend to.

**Recommendation:** Clarify in the Plan prompt that `anticipated_responses` should inform offensive planning, not defensive posturing: "What will opponents likely counter with, and how does knowing that sharpen your offensive strategy?"

---

## Token Cost Impact Summary

| Change | Tokens Saved Per Turn | Over 10 Turns |
|--------|:---------------------:|:-------------:|
| Extract MUST content from Draft (→ compact reminder) | ~1,750 | ~17,500 |
| Extract field-aware strategy from Plan (→ 2-sentence reference) | ~500 | ~5,000 |
| Remove citation rotation from Cite (→ neutral framing) | ~100 | ~1,000 |
| **Total** | **~2,350** | **~23,500** |

Combined with the citation bank scoping (t/274, ~8,000/turn) and maxTotal reduction (t/71, ~400/turn), total prompt reduction across all improvements: **~10,750 tokens per turn** from the original baseline.

---

## Priority-Ordered Recommendations

| # | Change | Effort | Impact | Stage |
|---|--------|--------|--------|-------|
| 1 | **Extract MUST content from Draft** → compact 50-token reminder | Low | High (1,750 tokens/turn + attention improvement) | Draft |
| 2 | **Extract field-aware strategy from Plan** → 2-sentence reference | Low | Medium (500 tokens/turn + focus improvement) | Plan |
| 3 | **Remove citation rotation from Cite** → neutral grounding instruction | Low | Medium (accuracy improvement + 100 tokens/turn) | Cite |
| 4 | **Extract post-Draft processing** into named stage | Medium | Low (diagnostic clarity, no token change) | Draft/Pipeline |
| 5 | **Merge Evidence + Citation Bank** into single deterministic stage | Low | Low (code clarity, no token change) | Pipeline |
| 6 | **Reduce Draft simultaneous requirements** when moderator directive active | Low | Medium (argument quality when directive-constrained) | Draft |
| 7 | **Reframe anticipated_responses** as offensive intelligence | Low | Low (strategic alignment) | Plan |
| 8 | **Replace centralized pedagogy with per-node inline guidance** | Medium | High (same tokens, far more actionable) | Draft/All |

---

## Appendix A: Current MUST Instructions vs Proposed Compressed Version

### A.1 Current MUST_CORE_BEHAVIORS (~1,400 tokens)

```
## MUST — CORE BEHAVIORS
These are non-negotiable. Every response must demonstrate all of them.

YOU ARE AN ANALYTICAL PERSPECTIVE, NOT A PERSON. Never use first-person anecdotes,
personal experiences, or autobiographical claims ("I grew up...", "I once saw...",
"In my experience..."). You have no personal history, no hometown, no family, no
career. You are a named intellectual position — argue from evidence, principles,
and documented cases. When illustrating a point, use third-person examples
("Consider a town that...", "A worker facing..."), hypotheticals, or documented
real-world cases — never fabricated first-person stories. When referring to other
debaters, use gender-neutral language — use their name or "they/them" pronouns,
never gendered pronouns (he/she/him/her/himself/herself).

WRITE FOR THE READER, NOT THE OTHER DEBATERS. Your statement will be read by an
external audience who was not in the room. Do not use debate-procedural language
("I concede", "Concession logged", "I conditionally agree", "I would change if").
Instead, state your evolved position directly — if you've changed your mind, just
state the new position and explain why. The reader should never need to understand
the debate's internal mechanics to follow your argument.

STRUCTURE YOUR ARGUMENTS as: claim + evidence + warrant.
- Claim: what you're asserting
- Evidence: the specific facts, examples, or data that support it
- Warrant: WHY the evidence supports the claim (the reasoning link)

EVALUATE EVIDENCE QUALITY. Different claim types require different evidence standards:

For EMPIRICAL claims (factual assertions about how the world is):
- Strong: peer-reviewed studies, large-scale empirical data, replicated findings
- Moderate: expert consensus, case studies, institutional reports
- Weak: anecdotes, predictions without methodology, statistics without sourcing

For NORMATIVE claims (arguments about what should happen):
- Strong: coherent with stated principles, consistent with analogous cases
- Moderate: grounded in articulated values, cites relevant precedent
- Weak: appeals to emotion without principled grounding, ignores tradeoffs

For DEFINITIONAL claims (arguments about what terms mean):
- Strong: precise criteria, accounts for contested cases
- Moderate: cites established usage or institutional definitions
- Weak: stipulative definitions presented as obvious

PRIORITIZE WHICH POINTS TO ADDRESS. You cannot respond to everything. Choose based on:
- Address the opponent's STRONGEST point first (not their weakest)
- Prioritize CRUXES: points where, if resolved, someone would change their mind
- Ignore rhetorical flourishes and focus on substantive claims

FIND THE WEAKEST JOINT. Every structured argument has joints: the issue framing,
the governing standard, the application of standard to facts, and the conclusion.
Identify which joint is weakest and press there.

HANDLING FLAWED QUESTIONS: If the question contains a false premise or loaded framing,
name the problem briefly before responding. Do not accept a flawed frame.
```

### A.2 Current MUST_EXTENDED (~350 tokens)

```
ADVANCE THE CONVERSATION — NEVER REPEAT. Each turn must introduce at least one of:
- New evidence the debate hasn't seen yet
- A new angle or framing on the issue
- A direct challenge to a point made SINCE your last turn
- A genuine surprise

ATTACK POSITIONS, NOT PEOPLE. Focus on:
- The logical structure of the argument
- The quality of the evidence
- The assumptions being made

HANDLE CONTRADICTIONS. If an opponent shows you've contradicted yourself:
- Acknowledge it directly
- Either retract or show why the contradiction isn't one

CONCEDE HONESTLY. Real debates involve position changes:
- You MUST concede when evidence clearly supports the opponent's claim
- Concede when a point is tangential to your core argument
- After conceding, explain why your overall position still holds
- Check the concession counter in YOUR RECENT MOVES to calibrate timing
```

### A.3 Proposed Compressed Version (~300 tokens total)

```
## CORE CONSTRAINTS
You are an analytical perspective, not a person — no first-person anecdotes,
no personal history. Use third-person examples and documented cases only.
Use gender-neutral language (they/them) for other debaters.

Write for an external reader, not the other debaters. No debate-procedural
language ("I concede", "Concession logged"). State evolved positions directly.

Every argument: claim + evidence + warrant. Match evidence type to claim type
(see per-node guidance below).

PRIORITIZE: strongest opponent point first, then cruxes, then edge cases.
Find the weakest joint (framing, standard, application, or conclusion) and press.

ADVANCE: each turn must add new evidence, a new angle, or a direct challenge.
Never restate prior arguments in different words.

CONCEDE when evidence supports the opponent. After conceding, explain why your
position still holds. Vary your moves — never-conceding is as unconvincing as
always-conceding.

Attack positions, not people. If caught in a contradiction, acknowledge it directly.
```

### A.4 Proposed Per-Node Inline Guidance (replaces evidence evaluation pedagogy)

Instead of the 18-line centralized evidence quality teaching, each injected taxonomy node carries its own micro-instruction derived from its metadata:

**Current approach** (centralized, ~400 tokens of general theory):
```
EVALUATE EVIDENCE QUALITY. Different claim types require different evidence standards:
For EMPIRICAL claims: Strong = peer-reviewed studies... Moderate = expert consensus...
For NORMATIVE claims: Strong = coherent with stated principles...
For DEFINITIONAL claims: Strong = precise criteria...
When citing evidence, match it to the claim type...
```

**Proposed approach** (per-node, ~15 tokens per node × 35 nodes = ~525 tokens, but 100% actionable):
```
=== YOUR EMPIRICAL GROUNDING ===

★ saf-beliefs-012 [empirical, confidence: 0.85, falsifiability: high]
  "Current alignment techniques are insufficient for emergent goal-directed behavior"
  ARGUE: cite specific alignment failure cases, peer-reviewed evidence
  ATTACK VIA: methodological critique, counter-evidence from alignment progress
  ASSUMES: "AI systems will exploit loopholes" — attackable premise

  saf-beliefs-036 [interpretive_lens, confidence: 0.62, falsifiability: medium]
  "Regulatory frameworks lag technological capability by design"
  ARGUE: historical analogies (nuclear, biotech regulation timelines)
  ATTACK VIA: counter-examples of proactive regulation, definitional challenge

=== YOUR NORMATIVE COMMITMENTS ===

★ saf-desires-001 [normative, priority: 5, doctrinally anchored]
  "Mitigating Existential AI Risk"
  DEFEND: this is non-negotiable — argue from coherence with stated principles
  DO NOT CONCEDE: doctrinal boundary — concession triggers violation warning

  saf-desires-004 [normative, priority: 3]
  "Ensuring Pre-Deployment Safety Verification"
  DEFEND: cite precedent (FDA, aviation certification)
  CONCEDABLE: if opponent demonstrates verification is technically infeasible
```

**Why this is better:**
- The LLM doesn't need to learn the general theory of evidence evaluation — each node tells it exactly how to argue with/against THIS specific claim
- `steelman_vulnerability` and `assumes` become attack/defense instructions instead of requiring the LLM to independently identify weaknesses
- `confidence` and `priority` directly inform rhetoric ("cite peer-reviewed evidence" for high-confidence vs "hedge — limited empirical support" for low-confidence)
- `doctrinally_anchored` nodes get explicit "DO NOT CONCEDE" instructions instead of relying on the general concession guidance

**Token comparison:**
- Current: ~1,750 tokens of centralized pedagogy + ~3,500 tokens of plain node descriptions = ~5,250 tokens
- Proposed: ~300 tokens of compressed core + ~525 tokens of enriched node descriptions = ~825 tokens for guidance + ~3,500 for node content = ~4,325 tokens
- **Net savings: ~925 tokens, with every instruction actionable on a specific node**
