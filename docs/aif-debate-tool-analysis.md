# AIF and the AI Triad Debate Tool — Gap Analysis and Implementation Plan

**Date:** 2026-03-29
**Updated:** 2026-03-29 (added detailed implementation steps with verification)
**Reference:** Chesnevar et al., "Towards an Argument Interchange Format," *Knowledge Engineering Review*, 21:4, 293-316 (2006)

---

## 1. What AIF Defines

The AIF paper establishes a formal ontology for representing argumentation with three concept groups:

**Arguments/Argument Networks (AN):**
- **I-nodes** (Information nodes) — claims, propositions, data. Passive content that can serve as premises or conclusions.
- **S-nodes** (Scheme nodes) — the reasoning patterns that connect I-nodes. Three subtypes:
  - **RA-nodes** (Rule Application) — inference schemes. "These premises support this conclusion via this reasoning pattern."
  - **CA-nodes** (Conflict Application) — attack schemes. Three attack types:
    - *Rebut* — directly contradicts the conclusion
    - *Undercut* — accepts the evidence but denies the inference step
    - *Undermine* — attacks the credibility or acceptability of a premise
  - **PA-nodes** (Preference Application) — resolve conflicts by establishing which argument prevails and why.

**Key structural rule:** I-nodes never connect directly to other I-nodes. There is always an S-node mediating the relationship, making the *reasoning* explicit rather than implicit.

**Communication (Locutions/Protocols):**
- Locutions are speech acts: *assert*, *question*, *challenge*, *concede*, *withdraw*
- Protocols define legal sequences of locutions
- Each locution has a sender, receiver, content, and protocol context

**Context (Participants/Theory):**
- Participants with IDs and roles
- Dialogue topic and type (persuasion, negotiation, deliberation)
- Commitment stores tracking what each participant has committed to
- Background theory (shared assumptions)

---

## 2. What the Debate Tool Currently Does

### Mapping to AIF Concepts

| AIF Concept | Debate Tool Equivalent | Status |
|-------------|----------------------|--------|
| **I-nodes** (claims) | Taxonomy nodes (451 with `node_scope: claim`) | Partial — nodes are pre-defined positions, not debate-specific claims |
| **I-nodes** (from transcript) | `argument_map.claim` in synthesis | Present since Phase 3, but only in synthesis output, not during the debate |
| **RA-nodes** (inference) | `argument_map.supported_by` | Flat list of claim IDs — no explicit reasoning pattern |
| **CA-nodes** (conflict) | `argument_map.attacked_by` with `attack_type` | Has rebut/undercut/undermine since Phase 3 |
| **PA-nodes** (preference) | Not represented | **Missing entirely** |
| **Schemes** | `argument_map.scheme` (COUNTEREXAMPLE, DISTINGUISH, etc.) | Labels exist but are AI-guessed, not validated against formal scheme definitions |
| **Locutions** | Transcript entries with `type` (opening, statement, question, synthesis) | Partially mapped — types exist but aren't formally AIF locutions |
| **Protocols** | Debate phases (setup → clarification → opening → debate → closed) | Implicit in code, not declared as a formal protocol |
| **Participants** | POVers (Prometheus, Sentinel, Cassandra, User) | Well-defined with IDs, POV labels, personalities |
| **Commitment stores** | Not represented | **Missing entirely** |
| **Dialogue topic** | `debate.topic.final` | Present |
| **Dialogue type** | Implicitly "persuasion" | Not explicit |
| **Background theory** | Taxonomy (BDI context), edges (known tensions) | Present but not framed as shared background theory |

### What Works Well

1. **Agent characterization (BDI context)** — the debate tool provides each agent with structured beliefs, values, and reasoning approaches. AIF doesn't prescribe this but the paper notes that "context" should include background theory and participant roles. The BDI structure goes beyond what AIF requires here.

2. **Attack typing** — the `attack_type` field (rebut/undercut/undermine) directly mirrors AIF's three conflict scheme types. This is the most AIF-aligned feature.

3. **Dialectical moves** — CONCEDE, DISTINGUISH, REFRAME, COUNTEREXAMPLE, REDUCE, ESCALATE map loosely to AIF argumentation schemes, though the paper's scheme taxonomy is more formal.

4. **Multi-agent structure** — three agents with distinct POVs plus a moderator maps to AIF's participant model with roles.

5. **Disagreement classification** — `bdi_layer` (belief/value/conceptual) and `resolvability` go beyond AIF's type system, adding analytic depth that AIF doesn't prescribe but would benefit from.

---

## 3. Gaps — What AIF Requires That the Tool Lacks

### Gap 1: No Bipartite Graph Structure (Critical)

**AIF requirement:** Arguments form a bipartite graph where I-nodes connect only through S-nodes. This makes reasoning explicit — you can't just say "A supports B"; you must say "A supports B *via this inference pattern*."

**Current state:** The `argument_map` in synthesis output has claims with `supported_by: ["C3"]` — a flat reference from one claim to another. There is no intermediate node representing *why* C3 supports C1. The reasoning is implicit in the claim text.

**Similarly:** The taxonomy's `edges.json` connects nodes directly: `acc-goals-001 SUPPORTS saf-data-002`. There is no S-node explaining the inference pattern.

**Impact:** Without S-nodes, you can't:
- Distinguish between different types of support (analogical, causal, authoritative)
- Attack the inference itself (undercut) as opposed to the premise (undermine) or conclusion (rebut)
- Evaluate argument strength based on scheme quality

### Gap 2: No Preference Application (PA-nodes) (Significant)

**AIF requirement:** When two arguments conflict (CA-node), a PA-node determines which prevails. Preferences can be based on specificity, recency, source reliability, or explicit criteria.

**Current state:** When debaters disagree, the synthesis identifies the disagreement and classifies it, but never resolves it. The `resolvability` field says *how* it could be resolved in theory, but no mechanism actually applies preferences to determine which argument is stronger.

**Impact:** The debate produces disagreements but never evaluates them. A user can't ask "which argument actually wins here and why?" The tool describes the battlefield but doesn't adjudicate.

### Gap 3: No Commitment Stores (Moderate)

**AIF requirement:** Each participant maintains a commitment store — a set of propositions they've committed to during the dialogue. Commitment stores track what's been asserted, conceded, withdrawn, and challenged.

**Current state:** The transcript records what was said, but there's no derived data structure tracking what each debater has committed to. If Prometheus concedes a point in round 3, there's no mechanism to check whether Prometheus later contradicts that concession.

**Impact:** Without commitment stores, the debate can't detect:
- Self-contradiction (asserting P then later asserting not-P)
- Failed challenges (questioning P but never following up)
- Implicit commitments (asserting P→Q and P commits you to Q)

### Gap 4: No Formal Protocol Declaration (Low)

**AIF requirement:** The interaction protocol should be explicitly declared, specifying legal locution sequences.

**Current state:** The debate phases (setup → clarification → opening → debate → closed) are hardcoded in the state machine. The rules about who can speak when are embedded in the moderator's AI prompt, not in a formal protocol.

**Impact:** Low — the current protocol works. But formalization would enable protocol variants (e.g., Oxford-style debate, Socratic dialogue, deliberation) without code changes.

### Gap 5: Argument Map Only in Synthesis (Moderate)

**AIF requirement:** The argument network is built incrementally as locutions are performed. Each assert adds I-nodes and RA-nodes; each challenge adds CA-nodes.

**Current state:** The `argument_map` is only generated post-hoc during synthesis. During the actual debate, no argument network is maintained. Each turn is a blob of text with `taxonomy_refs`, not a structured set of claims and inferences.

**Impact:** The debate loses structural information between turns. When Sentinel undercuts Prometheus's argument in round 2, that undercut is captured in text but not in a queryable graph structure until synthesis reconstructs it (lossy, AI-dependent).

### Gap 6: No Critical Questions for Schemes (Low-Moderate)

**AIF requirement:** Each argumentation scheme has associated *critical questions* that test its validity. For example, Argument from Authority has critical questions like "Is the authority a genuine expert in this domain?" and "Do other authorities agree?"

**Current state:** The `scheme` field labels which dialectical move was used (COUNTEREXAMPLE, DISTINGUISH, etc.) but there's no mechanism to evaluate whether the scheme was applied correctly. The AI labels schemes but nobody checks them.

**Impact:** Scheme labels are decorative rather than functional. They could drive automated critique: "You used COUNTEREXAMPLE, but your example doesn't match the scope of the original claim."

---

## 4. Implementation Plan

### Priority 1: Incremental Argument Network During Debate

**Goal:** After each debater's turn, extract claims and relationships into a running argument graph — don't wait for synthesis.

**Repos affected:** Code only (new field on DebateSession, new prompt, new store logic).

#### Step 1.1: Define the argument network data structure

**File:** `taxonomy-editor/src/renderer/types/debate.ts`

Add to `DebateSession`:
```typescript
/** Running argument network built incrementally during debate */
argument_network?: {
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
};
```

Add types:
```typescript
interface ArgumentNetworkNode {
  id: string;           // "AN-1", "AN-2", etc.
  type: 'claim';        // I-node (only claims for now)
  text: string;         // The claim text (near-verbatim from transcript)
  speaker: PoverId | 'system';
  source_entry_id: string;  // Which transcript entry this came from
  taxonomy_refs: string[];  // Linked taxonomy node IDs
  turn_number: number;
}

interface ArgumentNetworkEdge {
  id: string;
  source: string;       // AN node ID
  target: string;       // AN node ID
  type: 'supports' | 'attacks';
  attack_type?: 'rebut' | 'undercut' | 'undermine';
  scheme?: string;       // COUNTEREXAMPLE, DISTINGUISH, etc.
  warrant?: string;      // WHY source relates to target (the S-node content)
}
```

**Verification:** None needed — this is a type definition.

#### Step 1.2: Create the claim extraction prompt

**File:** `taxonomy-editor/src/renderer/prompts/debate.ts`

Add a new prompt function `extractClaimsPrompt(statement, speaker, priorClaims)` that:
- Takes a debater's statement text, the speaker identity, and the list of existing AN claims
- Asks the AI to extract 1-4 key claims from the statement
- For each claim, identify which prior claims it supports or attacks
- For attacks, classify the attack_type and scheme
- For supports, provide a warrant (the reasoning link)

```typescript
export function extractClaimsPrompt(
  statement: string,
  speaker: string,
  priorClaims: { id: string; text: string; speaker: string }[],
): string {
  const priorBlock = priorClaims.length > 0
    ? priorClaims.map(c => `  ${c.id} (${c.speaker}): ${c.text}`).join('\n')
    : '  (none yet — this is the first statement)';

  return `Extract the key claims from this debate statement and map their relationships to prior claims.

STATEMENT by ${speaker}:
"${statement}"

PRIOR CLAIMS IN THIS DEBATE:
${priorBlock}

For each distinct claim in the statement:
1. Extract the claim as a near-verbatim sentence from the statement
2. If it responds to a prior claim, classify the relationship:
   - "supports" with a warrant (WHY it supports — the reasoning pattern)
   - "attacks" with attack_type ("rebut" = contradicts conclusion, "undercut" = denies the inference, "undermine" = attacks premise credibility) and scheme (COUNTEREXAMPLE, DISTINGUISH, REDUCE, REFRAME, CONCEDE, ESCALATE)
3. If it's a new standalone claim, it has no relationships

Extract 1-4 claims. Each claim must be traceable to text actually in the statement.

Return ONLY JSON (no markdown):
{
  "claims": [
    {
      "text": "near-verbatim claim from the statement",
      "responds_to": [
        {
          "prior_claim_id": "AN-1",
          "relationship": "supports or attacks",
          "attack_type": "rebut or undercut or undermine (only if attacks)",
          "scheme": "COUNTEREXAMPLE etc. (only if attacks)",
          "warrant": "1 sentence: WHY this claim relates to the prior claim"
        }
      ]
    }
  ]
}`;
}
```

**Verification:** None needed — this is a prompt template.

#### Step 1.3: Add claim extraction to the debate flow

**File:** `taxonomy-editor/src/renderer/hooks/useDebateStore.ts`

After each `parsePoverResponse` call (3 sites: opening statements, ask-question responses, cross-respond), add a post-processing step:

```
1. Call extractClaimsPrompt with the statement, speaker, and existing AN nodes
2. Parse the response
3. VERIFY the extraction (Step 1.4)
4. If valid, append new nodes and edges to debate.argument_network
5. Save the debate
```

Add a helper function `extractAndVerifyClaims(statement, speaker, get, set)` that all three call sites invoke after adding the transcript entry.

**Key detail:** This is a SECOND AI call per turn. It runs after the debater's response is displayed, so the user sees the response immediately. The claim extraction happens in the background and updates the argument_network silently. If it fails, the debate continues normally — the network is a best-effort enrichment.

#### Step 1.4: Verify the AI-extracted claims

**Verification step** — runs automatically after each extraction:

```typescript
function verifyExtractedClaims(
  claims: ExtractedClaim[],
  statement: string,
  priorClaims: ArgumentNetworkNode[],
): { valid: ExtractedClaim[]; rejected: { claim: ExtractedClaim; reason: string }[] } {
  const valid: ExtractedClaim[] = [];
  const rejected: { claim: ExtractedClaim; reason: string }[] = [];

  for (const claim of claims) {
    // V1: Claim text must appear approximately in the statement (>40% word overlap)
    const claimWords = new Set(claim.text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const stmtWords = new Set(statement.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const overlap = [...claimWords].filter(w => stmtWords.has(w)).length / Math.max(claimWords.size, 1);
    if (overlap < 0.4) {
      rejected.push({ claim, reason: `Claim not grounded in statement (${(overlap * 100).toFixed(0)}% word overlap, need 40%)` });
      continue;
    }

    // V2: Any prior_claim_id references must exist in the argument network
    for (const resp of claim.responds_to || []) {
      if (!priorClaims.some(c => c.id === resp.prior_claim_id)) {
        rejected.push({ claim, reason: `References nonexistent prior claim ${resp.prior_claim_id}` });
        continue;
      }
    }

    // V3: Attack relationships must have attack_type
    for (const resp of claim.responds_to || []) {
      if (resp.relationship === 'attacks' && !resp.attack_type) {
        resp.attack_type = 'rebut'; // Default to rebut if missing
      }
    }

    // V4: Support relationships must have a warrant
    for (const resp of claim.responds_to || []) {
      if (resp.relationship === 'supports' && !resp.warrant) {
        resp.warrant = '(warrant not provided)';
      }
    }

    valid.push(claim);
  }

  if (rejected.length > 0) {
    console.warn(`[AN] Rejected ${rejected.length} claims:`, rejected.map(r => r.reason));
  }

  return { valid, rejected };
}
```

**What this catches:**
- Hallucinated claims (not in the statement)
- Orphan references (pointing to nonexistent prior claims)
- Missing attack types or warrants (repaired, not rejected)

#### Step 1.5: Feed the argument network to the moderator

**File:** `taxonomy-editor/src/renderer/hooks/useDebateStore.ts` — `buildCrossRespondSelectionPrompt`

Currently the moderator gets `formatEdgeContext` (known tensions from edges.json). Add the argument network as additional context:

```
=== ARGUMENT NETWORK (claims made so far) ===
AN-1 (Prometheus): "Scaling compute is sufficient for AGI" [standalone]
AN-2 (Sentinel): "Novel architectures may be needed" [attacks AN-1 via COUNTEREXAMPLE — undercut]
  Warrant: Historical precedent shows paradigm shifts require architectural innovation, not just scale.
AN-3 (Cassandra): "Current harms matter more than speculative AGI" [attacks AN-1 via REFRAME — rebut]
  Warrant: Redirects the conversation from future capabilities to present measurable impacts.

Unaddressed claims: AN-1 has been attacked twice but neither attack has been responded to.
```

**Verification:** None needed — this is deterministic formatting of validated data.

#### Step 1.6: Feed the argument network to synthesis

**File:** `taxonomy-editor/src/renderer/prompts/debate.ts` — `debateSynthesisPrompt`

Add the argument network to the synthesis prompt alongside the transcript. This means the synthesis `argument_map` is a REFINEMENT of the incremental network rather than a full reconstruction. The prompt should say:

```
A running argument network has been maintained during this debate. Use it as a
starting point for your argument_map — refine, correct, and extend it rather than
building from scratch. The network may have missed claims or misclassified relationships;
fix those in your output.
```

**Verification:** Compare the synthesis `argument_map` against the incremental network:
- Claims in the incremental network that disappear from synthesis → log as "dropped by synthesis"
- New claims in synthesis not in the incremental network → log as "added by synthesis"
- Relationship changes → log as "reclassified by synthesis"
This is informational logging, not blocking validation.

#### Step 1.7: Golden-file tests

**File:** `taxonomy-editor/src/renderer/utils/argumentNetwork.test.ts`

Test `verifyExtractedClaims` with:
1. A claim that IS in the statement → accepted
2. A claim that ISN'T in the statement → rejected (low overlap)
3. A claim referencing AN-99 when only AN-1,AN-2 exist → rejected
4. An attack without attack_type → repaired to "rebut"
5. A support without warrant → repaired with placeholder

---

### Priority 2: Commitment Tracking

**Goal:** Maintain per-debater commitment stores. Inject into prompts for consistency. Detect contradictions.

**Repos affected:** Code only.

#### Step 2.1: Define commitment store types

**File:** `taxonomy-editor/src/renderer/types/debate.ts`

Add to `DebateSession`:
```typescript
/** Per-debater commitment stores — tracks what each agent has committed to */
commitments?: Record<string, CommitmentStore>;
```

```typescript
interface CommitmentEntry {
  claim_id?: string;    // Links to argument_network node if available
  text: string;
  turn_number: number;
  source_entry_id: string;
}

interface CommitmentStore {
  asserted: CommitmentEntry[];   // Claims the debater has made
  conceded: CommitmentEntry[];   // Opponent claims the debater has accepted
  challenged: CommitmentEntry[]; // Claims the debater has questioned
  withdrawn: CommitmentEntry[];  // Claims the debater has retracted
}
```

**Verification:** None needed — type definition.

#### Step 2.2: Create the commitment extraction prompt

**File:** `taxonomy-editor/src/renderer/prompts/debate.ts`

```typescript
export function extractCommitmentsPrompt(
  statement: string,
  speaker: string,
  priorCommitments: CommitmentStore,
): string { ... }
```

The prompt asks the AI to classify each significant proposition in the statement as:
- **assert** — the speaker is claiming this is true
- **concede** — the speaker is accepting an opponent's prior point
- **challenge** — the speaker is questioning a prior claim
- **withdraw** — the speaker is retracting a prior assertion

Include the speaker's existing commitments so the AI can detect additions vs. repetitions.

**Verification:** None needed — prompt template.

#### Step 2.3: Run commitment extraction after each turn

**File:** `taxonomy-editor/src/renderer/hooks/useDebateStore.ts`

After Step 1.3's claim extraction (or in parallel), call the commitment extraction prompt. This can share the same AI call if the claim extraction prompt is extended to also output commitments.

**Alternatively:** Derive commitments deterministically from the argument network (Step 1) rather than via a separate AI call:
- If a debater makes a new claim → `asserted`
- If `move_types` includes "CONCEDE" → the conceded claim goes to `conceded`
- If `move_types` includes "DISTINGUISH" or "COUNTEREXAMPLE" → the target claim goes to `challenged`

This deterministic approach avoids an extra AI call and is more reliable.

#### Step 2.4: Verify commitment consistency

**Verification step** — runs after each commitment update:

```typescript
function verifyCommitmentConsistency(
  store: CommitmentStore,
): { contradictions: { asserted: string; conceded: string }[] } {
  const contradictions: { asserted: string; conceded: string }[] = [];

  // Check: has the debater asserted X and also conceded not-X (or vice versa)?
  // Simple heuristic: high word overlap between an asserted claim and a conceded claim
  // with opposing sentiment
  for (const a of store.asserted) {
    for (const c of store.conceded) {
      const aWords = new Set(a.text.toLowerCase().split(/\s+/).filter(w => w.length > 4));
      const cWords = new Set(c.text.toLowerCase().split(/\s+/).filter(w => w.length > 4));
      const overlap = [...aWords].filter(w => cWords.has(w)).length;
      if (overlap >= 3 && a.turn_number !== c.turn_number) {
        contradictions.push({ asserted: a.text, conceded: c.text });
      }
    }
  }

  return { contradictions };
}
```

**What this catches:**
- A debater asserting "scaling is sufficient" and later conceding "novel architectures may be needed" — flagged as potential contradiction for the moderator to address.

**Limitation:** Word-overlap is a rough heuristic. Could be enhanced with embedding similarity if needed, but the overlap check catches the obvious cases.

#### Step 2.5: Inject commitments into debater prompts

**File:** `taxonomy-editor/src/renderer/prompts/debate.ts` — `openingStatementPrompt`, `debateResponsePrompt`, `crossRespondPrompt`

Add a section after `TAXONOMY_USAGE`:
```
=== YOUR COMMITMENTS SO FAR ===
You have asserted:
- "Scaling compute is sufficient for AGI" (opening statement)
- "Current AI already shows emergent capabilities" (round 1)
You have conceded:
- "Current AI has jagged capabilities" (round 2)
You have challenged:
- "Alignment must precede deployment" (round 1)

CONSISTENCY RULE: Do not contradict your prior assertions without explicitly
acknowledging the change. If you now believe differently, say "I previously
argued X, but on reflection..." — do not silently flip.
```

**Verification:** None needed — prompt engineering. Consistency is enforced by the model following instructions, not by code.

#### Step 2.6: Inject contradictions into moderator prompts

When `verifyCommitmentConsistency` detects a contradiction, inject it into the moderator's cross-respond selection prompt:

```
=== DETECTED INCONSISTENCY ===
Prometheus asserted "Scaling compute is sufficient for AGI" in the opening statement
but conceded "Novel architectures may be needed" in round 2. The moderator should
ask Prometheus to reconcile these positions.
```

**Verification:** None needed — the moderator decides whether to act on it.

---

### Priority 3: Preference Resolution

**Goal:** When synthesis identifies disagreements, evaluate which argument prevails and why.

**Repos affected:** Code only (prompt change + type update + UI).

#### Step 3.1: Update the synthesis prompt

**File:** `taxonomy-editor/src/renderer/prompts/debate.ts` — `debateSynthesisPrompt`

Add to the synthesis instructions:

```
8. For each area of disagreement, evaluate which position is STRONGER and why.
   Apply these preference criteria (in order of priority):
   a. "empirical_evidence" — which position cites more or better evidence?
   b. "logical_validity" — which position has fewer logical gaps or fallacies?
   c. "source_authority" — which position draws on more authoritative sources?
   d. "specificity" — which position is more concrete and testable?
   e. "scope" — which position accounts for more of the relevant considerations?
   A position can prevail on one criterion while losing on another.
   If genuinely undecidable, say so and explain what evidence would tip the balance.
```

Add to the output schema:
```json
"preferences": [
  {
    "conflict": "description of the disagreement",
    "claim_ids": ["C1", "C2"],
    "prevails": "C2 or undecidable",
    "criterion": "empirical_evidence or logical_validity or ...",
    "rationale": "2-3 sentences explaining why this position is stronger",
    "what_would_change_this": "what evidence or argument would flip the verdict"
  }
]
```

**Verification:** None needed — prompt template.

#### Step 3.2: Verify preference quality

**Verification step** — runs after synthesis:

```typescript
function verifyPreferences(
  preferences: PreferenceEntry[],
  disagreements: DisagreementEntry[],
): { warnings: string[] } {
  const warnings: string[] = [];

  // V1: Every disagreement should have a preference entry (or explicit "undecidable")
  const coveredConflicts = new Set(preferences.map(p => p.conflict));
  for (const d of disagreements) {
    if (!preferences.some(p => p.claim_ids?.some(id => d.point.includes(id)) || p.conflict === d.point)) {
      warnings.push(`Disagreement "${d.point.slice(0, 50)}..." has no preference resolution`);
    }
  }

  // V2: "prevails" must reference a real claim_id or be "undecidable"
  for (const p of preferences) {
    if (p.prevails !== 'undecidable' && !p.claim_ids?.includes(p.prevails)) {
      warnings.push(`Preference "${p.conflict.slice(0, 40)}..." prevails value "${p.prevails}" is not in claim_ids`);
    }
  }

  // V3: Criterion must be from the allowed list
  const validCriteria = new Set(['empirical_evidence', 'logical_validity', 'source_authority', 'specificity', 'scope', 'undecidable']);
  for (const p of preferences) {
    if (!validCriteria.has(p.criterion)) {
      warnings.push(`Unknown preference criterion: ${p.criterion}`);
    }
  }

  // V4: Rationale must not be empty or generic
  for (const p of preferences) {
    if (!p.rationale || p.rationale.length < 20) {
      warnings.push(`Preference "${p.conflict.slice(0, 40)}..." has empty or too-short rationale`);
    }
  }

  return { warnings };
}
```

**What this catches:**
- Disagreements without resolution (AI skipped one)
- Invalid prevails references
- Unknown criteria (AI invented one)
- Empty rationales (AI punted)

#### Step 3.3: Update the SynthesisResult type

**File:** `taxonomy-editor/src/renderer/types/debate.ts`

```typescript
export interface PreferenceEntry {
  conflict: string;
  claim_ids?: string[];
  prevails: string;      // claim_id or "undecidable"
  criterion: string;
  rationale: string;
  what_would_change_this?: string;
}
```

Add to `SynthesisResult`:
```typescript
  /** Preference resolution — added for AIF PA-node support. Absent in older debates. */
  preferences?: PreferenceEntry[];
```

#### Step 3.4: Render preferences in the synthesis display

**File:** `taxonomy-editor/src/renderer/hooks/useDebateStore.ts` — synthesis rendering

After the "Areas of Disagreement" section, add:

```typescript
if (synthesis.preferences?.length > 0) {
  lines.push('', '**Resolution Analysis:**');
  for (const p of synthesis.preferences) {
    const icon = p.prevails === 'undecidable' ? '?' : '>';
    lines.push(`${icon} ${p.conflict}`);
    if (p.prevails !== 'undecidable') {
      lines.push(`  Stronger: ${p.prevails} (${p.criterion.replace(/_/g, ' ')})`);
    } else {
      lines.push(`  Undecidable — ${p.rationale}`);
    }
    lines.push(`  *${p.rationale}*`);
    if (p.what_would_change_this) {
      lines.push(`  Would change if: ${p.what_would_change_this}`);
    }
  }
}
```

**Verification:** Visual review — old debates without preferences render normally.

#### Step 3.5: Update the baseline script

**File:** `scripts/run-debate-baseline.mjs`

Add `preferences` to the synthesis prompt and the aggregate stats:
- Count of preferences per debate
- Distribution of `prevails` outcomes (claim1 wins / claim2 wins / undecidable)
- Distribution of criteria used

---

### Priority 4: S-node Enrichment on Argument Map

**Goal:** Replace flat `supported_by` lists with structured S-nodes containing warrants and critical questions.

**Repos affected:** Code only (prompt change + type update).

#### Step 4.1: Update the ArgumentClaim type

**File:** `taxonomy-editor/src/renderer/types/debate.ts`

Replace the flat `supported_by: string[]` with:

```typescript
export interface SupportLink {
  claim_id: string;
  scheme: string;           // "argument_from_evidence", "argument_from_analogy", etc.
  warrant: string;          // WHY this claim supports the target
  critical_questions?: {
    question: string;
    addressed: boolean;     // Was this question answered in the debate?
  }[];
}

export interface ArgumentClaim {
  claim_id: string;
  claim: string;
  claimant: PoverId | string;
  type?: 'empirical' | 'normative' | 'definitional';
  supported_by?: SupportLink[];  // Was string[], now structured
  attacked_by?: ArgumentAttack[];
}
```

**Backward compat:** Consumer code must handle both `string[]` (old) and `SupportLink[]` (new) for `supported_by`. Check `typeof supported_by[0] === 'string'`.

#### Step 4.2: Define the argumentation scheme vocabulary

**File:** `taxonomy-editor/src/renderer/prompts/debate.ts` — add as a constant

```typescript
const ARGUMENTATION_SCHEMES = {
  // Inference schemes (RA-nodes)
  argument_from_evidence: {
    description: "Premises cite empirical data; conclusion follows from the data",
    critical_questions: [
      "Is the evidence reliable and representative?",
      "Are there confounding factors?",
      "Does the evidence actually support this specific conclusion?",
    ],
  },
  argument_from_analogy: {
    description: "Premises identify similarity to another case; conclusion transfers",
    critical_questions: [
      "Are the two cases sufficiently similar?",
      "Are there relevant differences that undermine the analogy?",
    ],
  },
  argument_from_authority: {
    description: "An authority endorses the conclusion",
    critical_questions: [
      "Is the authority a genuine expert in this domain?",
      "Do other authorities agree?",
      "Is the authority biased?",
    ],
  },
  argument_from_consequences: {
    description: "The conclusion is supported by its predicted effects",
    critical_questions: [
      "Are the predicted consequences accurate?",
      "Are there countervailing consequences?",
    ],
  },
  causal_argument: {
    description: "A causes B; therefore intervening on A affects B",
    critical_questions: [
      "Is the causal link established or merely correlational?",
      "Are there alternative causes?",
    ],
  },
  practical_reasoning: {
    description: "Goal G is desired; Action A achieves G; therefore do A",
    critical_questions: [
      "Is the goal actually desirable?",
      "Does the action actually achieve the goal?",
      "Are there side effects?",
    ],
  },
};
```

**Verification:** None needed — reference data.

#### Step 4.3: Update the synthesis prompt for S-nodes

**File:** `taxonomy-editor/src/renderer/prompts/debate.ts` — `debateSynthesisPrompt`

Update the `argument_map` instructions:

```
For each support relationship in the argument_map:
- Identify the argumentation SCHEME used (argument_from_evidence, argument_from_analogy,
  argument_from_authority, argument_from_consequences, causal_argument, practical_reasoning)
- Provide a WARRANT: 1 sentence explaining WHY the supporting claim actually supports
  the target claim. This is the inference step — the reasoning pattern.
- List 1-2 CRITICAL QUESTIONS for the scheme that are relevant to this specific argument.
  For each, note whether the debate addressed that question.
```

#### Step 4.4: Verify S-node quality

**Verification step** — runs after synthesis:

```typescript
function verifySNodes(argumentMap: ArgumentClaim[]): { warnings: string[] } {
  const warnings: string[] = [];

  for (const claim of argumentMap) {
    for (const support of claim.supported_by || []) {
      if (typeof support === 'string') continue; // Legacy format, skip

      // V1: Scheme must be from the known vocabulary
      if (!ARGUMENTATION_SCHEMES[support.scheme]) {
        warnings.push(`Unknown scheme "${support.scheme}" on ${claim.claim_id}`);
      }

      // V2: Warrant must not be empty or a tautology
      if (!support.warrant || support.warrant.length < 10) {
        warnings.push(`Empty warrant on ${claim.claim_id} ← ${support.claim_id}`);
      }
      // Check for tautological warrants ("X supports Y because X supports Y")
      if (support.warrant && claim.claim.toLowerCase().includes(support.warrant.toLowerCase().slice(0, 20))) {
        warnings.push(`Possibly tautological warrant on ${claim.claim_id} ← ${support.claim_id}`);
      }

      // V3: Critical questions should exist for known schemes
      if (ARGUMENTATION_SCHEMES[support.scheme] && (!support.critical_questions || support.critical_questions.length === 0)) {
        warnings.push(`No critical questions for ${support.scheme} on ${claim.claim_id}`);
      }
    }
  }

  return { warnings };
}
```

**What this catches:**
- AI inventing scheme names not in the vocabulary
- Empty or tautological warrants ("it supports because it supports")
- Missing critical questions for known scheme types

---

### Priority 5: Formal Protocol Variants

**Goal:** Define debate protocols declaratively so users can choose formats.

**Repos affected:** Code only (new config system + refactored state machine).

#### Step 5.1: Define protocol schema

**File:** `taxonomy-editor/src/renderer/types/debate.ts`

```typescript
interface DebateProtocol {
  id: string;               // "structured", "socratic", "deliberation", "adversarial"
  label: string;
  description: string;
  phases: ProtocolPhase[];
  default_rounds: number;
}

interface ProtocolPhase {
  id: string;                // "clarification", "opening", "debate", "synthesis"
  label: string;
  turn_order: 'sequential' | 'moderator_selected' | 'user_directed';
  speakers: ('all_ai' | 'moderator' | 'user' | 'selected_ai')[];
  max_turns?: number;
  auto_advance_after?: number;  // Auto-advance to next phase after N turns
  actions: ProtocolAction[];    // What buttons appear in this phase
}

interface ProtocolAction {
  id: string;                // "ask", "cross_respond", "synthesize", "probe"
  label: string;
  requires_input: boolean;
  handler: string;           // Maps to store action name
}
```

**Verification:** None needed — type definition.

#### Step 5.2: Define built-in protocols

**File:** `taxonomy-editor/src/renderer/data/debateProtocols.ts`

Define 3-4 protocols:

1. **Structured Debate** (current default) — clarification → sequential openings → moderator-selected cross-respond → synthesis
2. **Socratic Dialogue** — user asks questions, one AI responds at a time, moderator probes for contradictions
3. **Deliberation** — all participants seek consensus, moderator identifies convergence points, synthesis focuses on areas of agreement
4. **Adversarial Cross-Examination** — two debaters only, each gets to cross-examine the other, strict turn-taking

**Verification:** Each protocol definition must be validated:
- Every phase has at least one action
- Turn order is compatible with the speakers list
- Phase transitions form a connected graph (no orphan phases)

#### Step 5.3: Add protocol selector to NewDebateDialog

**File:** `taxonomy-editor/src/renderer/components/NewDebateDialog.tsx`

Add a protocol selector dropdown after the source type selection. Default: "Structured Debate". Protocol choice is stored on the `DebateSession` as `protocol_id`.

**Verification:** None needed — UI component.

#### Step 5.4: Refactor the debate state machine

**File:** `taxonomy-editor/src/renderer/hooks/useDebateStore.ts`

This is the largest change. Currently, phase transitions and action visibility are hardcoded. Refactor to read from the active protocol definition:

- `DebateActions` component reads `protocol.phases[currentPhase].actions` to determine which buttons to show
- `crossRespondSelectionPrompt` uses `protocol.phases[currentPhase].turn_order` to decide whether the moderator picks the speaker or the user does
- Phase transitions check `protocol.phases[currentPhase].auto_advance_after`

**Verification:** Regression test — run the existing structured debate flow and verify it produces identical results. The refactoring should be behavior-preserving for the default protocol.

#### Step 5.5: Verify protocol variants produce valid debates

**Verification step** — for each new protocol:

1. Run 2 debates with the D1 topic
2. Verify: all phases execute, all actions work, synthesis produces output
3. Verify: no JavaScript errors, no rendering issues
4. Manual review: does the debate feel different from structured debate? Does the protocol shape the conversation as intended?

---

## 5. What NOT to Do

The paper describes three "reifications" (XML/ASPIC, Araucaria/AML, RDF Schema) that formalize AIF into specific syntaxes. **None of these are appropriate for this project.** Per the DOLCE migration's guiding principle #4: "Vocabulary over formalism. Adopt DOLCE/AIF/BDI *vocabulary* in prompts and data structures. Do NOT convert to OWL/RDF triples."

The value of AIF for this project is:
- The **conceptual framework** (I-nodes, S-nodes, CA-nodes, PA-nodes) as a lens for structuring debate output
- The **attack taxonomy** (rebut, undercut, undermine) — already adopted
- The **locution model** (assert, challenge, concede) — partially adopted via `move_types`
- The **commitment store** concept — not yet adopted but high value

The value is NOT in XML schemas, RDF triples, or formal logic programming. The project's JSON-based, AI-driven approach is the right abstraction level.

---

## 6. Dependencies and Ordering

```
Priority 1 (Incremental AN)
    ↓
Priority 2 (Commitments) ← can derive from AN instead of separate AI call
    ↓
Priority 3 (Preferences) ← uses AN claims as preference targets
    ↓
Priority 4 (S-nodes)     ← enriches AN edges with warrants
    ↓
Priority 5 (Protocols)   ← independent, can be done in parallel with 3-4
```

Priorities 1 and 2 are tightly coupled — commitments are best derived from the argument network rather than extracted separately. Implement them together.

Priority 3 can be done standalone (it's just a synthesis prompt change) but is more valuable after Priority 1 provides claim IDs to reference.

Priority 4 enriches the data model from Priority 1.

Priority 5 is architecturally independent and can be done at any point.

---

## 7. Summary

| AIF Concept | Current Support | Gap Severity | Recommended Action | Verification |
|-------------|----------------|-------------|-------------------|-------------|
| I-nodes (claims) | Partial (synthesis only) | Moderate | Priority 1: incremental extraction | V1.4: word overlap + reference checks |
| RA-nodes (inference) | Flat `supported_by` | Moderate | Priority 4: S-node enrichment | V4.4: scheme vocabulary + warrant quality |
| CA-nodes (conflict) | Good (attack_type) | Low | Already well-supported | — |
| PA-nodes (preference) | Missing | Significant | Priority 3: preference resolution | V3.2: coverage + criterion + rationale checks |
| Schemes | Labels only | Low-Moderate | Priority 4: critical questions | V4.4: known scheme validation |
| Locutions | Partial (type field) | Low | Map `move_types` to AIF locutions | — |
| Protocols | Implicit | Low | Priority 5: declarative protocols | V5.5: regression + variant smoke tests |
| Commitment stores | Missing | Moderate | Priority 2: per-agent tracking | V2.4: consistency checks |
| Participants | Good | None | Well-supported via BDI + POVers | — |
| Context | Good | None | Background theory via taxonomy | — |
