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

---

## 8. Debate Harvest — Closing the Loop Between Debates and Taxonomy

### The Problem

Debates currently consume taxonomy data but never write back. When a debate produces a well-supported finding — a conflict between positions, a strong counterargument, evidence that one claim is stronger than another — that finding dies in the debate transcript. The taxonomy, edge graph, and conflict database don't learn from debates.

This creates an asymmetry: the more debates you run, the richer the debate transcripts become, but the taxonomy stays static unless you manually update it. The AIF priorities above (incremental argument networks, commitment tracking, preferences) make debates produce increasingly structured output — but without a harvest mechanism, that structure has no downstream impact.

### Design Principles

1. **User-curated, never automatic.** Debates are exploratory — agents can be wrong, arguments can be weak, the AI can hallucinate. Nothing flows from debate to taxonomy without explicit user approval.
2. **Review before apply.** The user sees exactly what will change, can edit it, and can reject individual items.
3. **Audit trail.** Every harvest is recorded with what was applied, what was rejected, and when.
4. **Existing data stores.** No new databases. Conflicts go to `conflicts/`, edges to `edges.json`, steelmans to taxonomy nodes. One new file: `harvest-queue.json` for proposed new concepts.

### What's Promotable

| Finding Type | Source in Debate | Destination | When Available |
|---|---|---|---|
| **Conflicts** | `areas_of_disagreement` with opposing claims | `conflicts/*.json` | Now (synthesis already produces these) |
| **Edge reinforcement** | `argument_map` support/attack between taxonomy-linked claims | `edges.json` confidence adjustment or new edge | After Priority 1 (needs AN claim→taxonomy links) |
| **Steelman refinement** | Strong POV-grounded attack on another POV's node | `steelman_vulnerability` on target node | Now (debate transcripts contain these) |
| **New concepts** | Claims not mapped to any taxonomy node | `harvest-queue.json` for `Invoke-TaxonomyProposal` | After Priority 1 (needs claim extraction) |
| **Debate refs** | Which nodes were contested in this debate | `debate_refs` field on taxonomy nodes | Now (taxonomy_refs on transcript entries) |
| **Preference verdicts** | Which side of a disagreement the evidence favors | `conflicts/*.json` verdict field | After Priority 3 (needs preference resolution) |

### User Experience

After synthesis, a **"Harvest"** button appears in the debate workspace. Clicking it opens a dialog with findings grouped into sections. Each item has a checkbox, editable fields, and a preview of what will change.

**Section 1: Conflicts**
```
☑ "Whether scaling compute alone produces AGI"
    BDI layer: belief | Resolvability: resolvable by evidence
    Prometheus (C1): "Scaling compute is sufficient for AGI"
    Sentinel (C2): "Novel architectures may be needed"
    → Creates: conflicts/conflict-scaling-compute-agi.json
    [Edit label] [Edit description]

☐ "Whether licensing regime helps or hinders innovation"
    BDI layer: value | Resolvability: negotiable via tradeoffs
    → Creates: conflicts/conflict-licensing-regime.json
```

**Section 2: Edge Updates** (available after Priority 1)
```
☑ acc-data-001 ↔ saf-methods-001: strengthen TENSION_WITH
    Current confidence: 0.75 → Proposed: 0.85
    Evidence: 3 direct attacks across 2 debate rounds
    [Adjust confidence slider]

☐ acc-goals-002 → skp-data-005: new SUPPORTS edge
    Proposed confidence: 0.70
    Evidence: Prometheus's argument in round 2 linked these
```

**Section 3: Steelman Refinements**
```
☑ saf-methods-001: Refine from_accelerationist steelman
    Current: "Pausing cedes the field to less safety-conscious actors"
    Proposed: "2024 scaling results show capabilities emerging without
    architectural changes, undermining the pause premise"
    Source: Prometheus cross-respond, round 2
    [Edit proposed text]

☐ acc-data-001: Refine from_skeptic steelman
    [keep current — debate didn't produce a better one]
```

**Section 4: New Concepts** (available after Priority 1)
```
☐ "Architectural ceiling hypothesis"
    Suggested POV: cross-cutting
    Suggested category: Data/Facts
    Evidence: Sentinel and Cassandra both referenced this concept
    → Queues for Invoke-TaxonomyProposal
    [Edit label] [Edit description]
```

**Section 5: Debate References**
```
☑ Mark as debated: acc-data-001, saf-methods-001, acc-goals-002
    → Adds debate ID to each node's debate_refs field
```

The user checks what they want, edits where needed, clicks **"Apply N items"**. A summary shows what was created/updated. A harvest manifest is saved.

### Data Storage

All harvested data goes to existing stores:

| Item | File | Format |
|------|------|--------|
| Conflicts | `ai-triad-data/conflicts/{generated-id}.json` | Same schema as `Find-Conflict` output |
| Edge updates | `ai-triad-data/taxonomy/Origin/edges.json` | Confidence adjustment on existing edge, or new edge entry |
| Steelman updates | `ai-triad-data/taxonomy/Origin/{pov}.json` | Updated `graph_attributes.steelman_vulnerability` object |
| New concepts | `ai-triad-data/harvest-queue.json` | Array of `{ label, description, pov, category, source_debate_id, evidence }` |
| Debate refs | `ai-triad-data/taxonomy/Origin/{pov}.json` | New optional `debate_refs: string[]` field on nodes |
| Preference verdicts | `ai-triad-data/conflicts/{id}.json` | New optional `verdict` field on conflict |
| Harvest manifest | `ai-triad-data/harvests/{debate-id}.json` | Record of what was applied/rejected |

---

## 9. Harvest Implementation — Phased Plan

### Phase H1: Conflict Harvesting + Debate Refs

**Goal:** The simplest, highest-value harvest items — conflicts and debate references. No dependency on Priorities 1-4.

**Repos affected:** Code + Data (new fields, new IPC handlers, new UI component).

#### Step H1.1: Add `debate_refs` to taxonomy types

**File:** `taxonomy-editor/src/renderer/types/taxonomy.ts`

Add `debate_refs?: string[]` to `PovNode` and `CrossCuttingNode`. Same pattern as `conflict_ids`.

**File:** `taxonomy/schemas/pov-taxonomy.schema.json`

Add `debate_refs` as optional string array.

**Verification:** None — type definitions.

#### Step H1.2: Add IPC handler for writing conflicts

**File:** `taxonomy-editor/src/main/ipcHandlers.ts`

Add `create-conflict` handler that writes a new conflict JSON file to the conflicts directory. Reuse the same schema as `Find-Conflict.ps1` output:
```json
{
  "claim_id": "conflict-{slug}",
  "claim_label": "...",
  "description": "...",
  "status": "open",
  "linked_taxonomy_nodes": ["acc-data-001", "saf-methods-001"],
  "instances": [
    { "doc_id": "debate:{debate-id}", "stance": "supports", "assertion": "...", "date_flagged": "..." },
    { "doc_id": "debate:{debate-id}", "stance": "disputes", "assertion": "...", "date_flagged": "..." }
  ],
  "source": "debate-harvest",
  "source_debate_id": "debate-id"
}
```

**Verification:** Write a conflict, read it back, verify it matches schema. Verify `Find-Conflict` can read and append to it (backward compat).

#### Step H1.3: Add IPC handler for updating taxonomy nodes (debate_refs)

**File:** `taxonomy-editor/src/main/fileIO.ts`

Add `update-node-field` handler that loads a taxonomy file, finds a node by ID, adds a value to an array field (like `debate_refs`), and saves atomically.

**Verification:** Add a debate_ref to a node, reload the file, verify the ref is present and no other data changed.

#### Step H1.4: Build the HarvestDialog component

**File:** `taxonomy-editor/src/renderer/components/HarvestDialog.tsx` (new)

Takes the active debate's synthesis as input. Renders:
- Section 1: Conflicts (from `areas_of_disagreement`)
- Section 5: Debate refs (from all `taxonomy_refs` across transcript)

Each item has a checkbox (default unchecked), editable fields, and a preview.

"Apply" button calls the IPC handlers from H1.2 and H1.3.

**Verification:** None — UI component, verified by user interaction.

#### Step H1.5: AI-assisted conflict description generation

When the user checks a conflict item, the tool generates a conflict description from the debate context. This is an AI step.

**Prompt:** Given the disagreement point, the two opposing claims, and the relevant transcript excerpts, generate:
- `claim_label`: 5-10 word label
- `description`: 1-2 sentence description of what's contested
- `linked_taxonomy_nodes`: which taxonomy nodes are involved

**Verification — V-H1.5: Validate AI-generated conflict descriptions**

```typescript
function verifyConflictDescription(
  generated: { claim_label: string; description: string; linked_taxonomy_nodes: string[] },
  disagreement: DisagreementEntry,
  allNodeIds: Set<string>,
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // V1: claim_label must be 3-12 words
  const wordCount = generated.claim_label.split(/\s+/).length;
  if (wordCount < 3 || wordCount > 12) {
    warnings.push(`claim_label has ${wordCount} words (expected 3-12)`);
  }

  // V2: description must be non-empty and not just repeat the label
  if (!generated.description || generated.description.length < 20) {
    warnings.push('description too short');
  }
  if (generated.description === generated.claim_label) {
    warnings.push('description is identical to label');
  }

  // V3: all linked_taxonomy_nodes must exist
  for (const nodeId of generated.linked_taxonomy_nodes) {
    if (!allNodeIds.has(nodeId)) {
      warnings.push(`linked node ${nodeId} does not exist`);
    }
  }

  // V4: at least 2 linked nodes (a conflict needs at least two positions)
  if (generated.linked_taxonomy_nodes.length < 2) {
    warnings.push('conflict should link at least 2 taxonomy nodes');
  }

  return { valid: warnings.length === 0, warnings };
}
```

**What this catches:** Invalid node references, labels that are too short or too long, descriptions that are empty or tautological, conflicts with only one side.

**Remediation:** Warnings are shown to the user in the harvest dialog next to the item. The user can edit the generated text before applying.

#### Step H1.6: Save harvest manifest

After applying, write `ai-triad-data/harvests/{debate-id}.json`:

```json
{
  "debate_id": "...",
  "debate_title": "...",
  "harvested_at": "2026-03-29T...",
  "items": [
    { "type": "conflict", "action": "created", "id": "conflict-scaling-compute-agi", "status": "applied" },
    { "type": "conflict", "action": "created", "id": "conflict-licensing-regime", "status": "rejected" },
    { "type": "debate_ref", "action": "added", "node_id": "acc-data-001", "status": "applied" },
    ...
  ]
}
```

**Verification:** Read the manifest back after saving, verify it matches what was applied.

#### Phase H1 Validation Gate

- [ ] Create a debate, run synthesis, click Harvest
- [ ] Check 2 conflicts and 3 debate refs, click Apply
- [ ] Verify conflict files exist in `conflicts/` with correct schema
- [ ] Verify `Find-Conflict` in PowerShell can read the new files and append to them
- [ ] Verify debate_refs appear on the taxonomy nodes
- [ ] Verify NodeDetail and CrossCuttingDetail display debate_refs (or at least don't crash)
- [ ] Verify harvest manifest was saved
- [ ] Open the Harvest dialog again — previously applied items show as "already harvested"

---

### Phase H2: Steelman Refinement Harvesting

**Goal:** Allow users to promote strong counterarguments from debates into node steelman_vulnerability fields.

**Depends on:** Phase H1 (harvest dialog infrastructure).

#### Step H2.1: Extract steelman candidates from debate transcript

After synthesis, scan the transcript for statements where one debater attacks another POV's taxonomy node with a strong, specific argument. Candidates are identified by:
- `move_types` includes COUNTEREXAMPLE, REDUCE, or DISTINGUISH
- `taxonomy_refs` references a node from a DIFFERENT POV than the speaker
- The statement is substantive (>50 chars)

This extraction is deterministic — no AI needed.

**Verification:** None — deterministic filtering.

#### Step H2.2: AI-assisted steelman condensation

The raw debate statement is too long for a steelman field (target: 1-3 sentences). The AI condenses it.

**Prompt:** "Condense this counterargument into 1-2 sentences that capture the strongest version of the attack from the [POV] perspective. The steelman should be specific enough that an advocate of the target position would recognize it as a fair challenge."

**Verification — V-H2.2: Validate condensed steelman quality**

```typescript
function verifyCondensedSteelman(
  condensed: string,
  originalStatement: string,
  attackerPov: string,
  targetNodeId: string,
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // V1: Length check (50-200 chars)
  if (condensed.length < 50) warnings.push(`Too short: ${condensed.length} chars (min 50)`);
  if (condensed.length > 200) warnings.push(`Too long: ${condensed.length} chars (max 200)`);

  // V2: Must contain POV-characteristic vocabulary
  const povVocab: Record<string, string[]> = {
    accelerationist: ['progress', 'innovation', 'speed', 'scaling', 'open-source', 'abundance', 'growth'],
    safetyist: ['risk', 'alignment', 'control', 'oversight', 'catastroph', 'irreversibl', 'caution'],
    skeptic: ['bias', 'displac', 'accountab', 'harm', 'evidence', 'power', 'concentrat'],
  };
  const vocab = povVocab[attackerPov] || [];
  const matches = vocab.filter(v => condensed.toLowerCase().includes(v));
  if (matches.length === 0) {
    warnings.push(`No ${attackerPov} vocabulary found — may be too generic`);
  }

  // V3: Must not be a near-copy of the existing steelman
  // (Checked at the UI level by comparing against current value)

  // V4: Word overlap with original statement (should share key terms)
  const origWords = new Set(originalStatement.toLowerCase().split(/\s+/).filter(w => w.length > 4));
  const condWords = condensed.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const overlap = condWords.filter(w => origWords.has(w)).length / Math.max(condWords.length, 1);
  if (overlap < 0.2) {
    warnings.push(`Low overlap with original argument (${(overlap * 100).toFixed(0)}%) — may have drifted`);
  }

  return { valid: warnings.length === 0, warnings };
}
```

**What this catches:** Steelmans that are too generic (no POV vocabulary), too short/long, or that have drifted from the original argument.

**Remediation:** Warnings shown in the harvest dialog. User can edit the condensed text.

#### Step H2.3: Add steelman section to HarvestDialog

Show each candidate with:
- The target node label and current steelman
- The proposed replacement (editable)
- Which debate turn it came from (clickable link to scroll transcript)
- Any validation warnings

#### Step H2.4: Write steelman updates via IPC

Reuse the `update-node-field` handler from H1.3, but for `graph_attributes.steelman_vulnerability`. Since this is a per-POV object, the handler updates the specific `from_{pov}` key.

**Verification:** Update a steelman, reload the taxonomy file, verify only the target key changed and no other data was modified.

#### Phase H2 Validation Gate

- [ ] Run a debate where Sentinel strongly attacks an accelerationist node
- [ ] Harvest dialog shows the steelman candidate with the current and proposed text
- [ ] Validation warnings display correctly (too generic, too long, etc.)
- [ ] User edits the text and applies
- [ ] Verify the node's steelman_vulnerability was updated in the taxonomy file
- [ ] Verify the NodeDetail Attributes tab shows the updated steelman
- [ ] Verify the BDI context in the NEXT debate uses the updated steelman

---

### Phase H3: Edge Reinforcement Harvesting

**Goal:** Allow users to strengthen/weaken edges or create new edges based on debate evidence.

**Depends on:** Phase H1 + Priority 1 (needs argument network with taxonomy-linked claims).

#### Step H3.1: Identify edge-relevant debate evidence

After synthesis, cross-reference the argument_map claims against their `taxonomy_refs`. When two claims from different POVs reference taxonomy nodes that are connected by an edge, the debate provides evidence about that edge's strength.

- If claim A (referencing node X) attacks claim B (referencing node Y), and X-Y has a TENSION_WITH edge, the edge is reinforced.
- If claim A supports claim B across POVs, and no edge exists between X-Y, propose a new SUPPORTS edge.
- If a debater concedes that a node's position is weak, that weakens outgoing SUPPORTS edges from that node.

This analysis can be deterministic (matching taxonomy_refs to edges) or AI-assisted for ambiguous cases.

**Verification:** None for deterministic matching.

#### Step H3.2: AI-assisted edge proposal for new connections

When the debate reveals a relationship not captured in `edges.json`, the AI proposes a new edge.

**Prompt:** "Based on this debate exchange, propose an edge between [node X] and [node Y]. Classify the type (SUPPORTS, TENSION_WITH, WEAKENS, etc.), assess confidence (0-1), and provide a rationale."

**Verification — V-H3.2: Validate proposed edges**

```typescript
function verifyProposedEdge(
  edge: { source: string; target: string; type: string; confidence: number; rationale: string },
  allNodeIds: Set<string>,
  existingEdges: Edge[],
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // V1: Source and target must exist
  if (!allNodeIds.has(edge.source)) warnings.push(`Source ${edge.source} not found`);
  if (!allNodeIds.has(edge.target)) warnings.push(`Target ${edge.target} not found`);

  // V2: Type must be canonical
  const canonical = new Set(['SUPPORTS', 'CONTRADICTS', 'ASSUMES', 'WEAKENS', 'RESPONDS_TO', 'TENSION_WITH', 'INTERPRETS']);
  if (!canonical.has(edge.type)) warnings.push(`Non-canonical type: ${edge.type}`);

  // V3: No self-edges
  if (edge.source === edge.target) warnings.push('Self-edge');

  // V4: No duplicate edges
  const exists = existingEdges.some(e => e.source === edge.source && e.target === edge.target && e.type === edge.type);
  if (exists) warnings.push('Edge already exists');

  // V5: Confidence must be 0-1
  if (edge.confidence < 0 || edge.confidence > 1) warnings.push(`Invalid confidence: ${edge.confidence}`);

  // V6: Rationale must be substantive
  if (!edge.rationale || edge.rationale.length < 20) warnings.push('Rationale too short');

  // V7: INTERPRETS edges must target cc- nodes
  if (edge.type === 'INTERPRETS' && !edge.target.startsWith('cc-')) {
    warnings.push('INTERPRETS target must be cross-cutting');
  }

  return { valid: warnings.length === 0, warnings };
}
```

**What this catches:** Orphan node references, non-canonical types, duplicates, self-edges, missing rationale, domain/range violations.

#### Step H3.3: Add edge section to HarvestDialog

Show proposed edge updates with:
- Current vs. proposed confidence (slider for adjustment)
- The debate evidence (which turns, which claims)
- New edge proposals with type selector and confidence slider
- Validation warnings

#### Step H3.4: Write edge updates via IPC

Add `update-edge` and `create-edge` IPC handlers that modify `edges.json` atomically.

For confidence updates: find the existing edge, update its confidence, add a `last_modified` and `modified_by: "debate-harvest"` field.

For new edges: append to the edges array with `status: "proposed"`, `discovered_at` set to today, and `model: "debate-harvest"`.

**Verification:** Modify an edge, reload the file, verify only the target edge changed. Create a new edge, verify the Edge Browser displays it.

#### Phase H3 Validation Gate

- [ ] Run a debate that references nodes connected by edges
- [ ] Harvest dialog shows edge reinforcement candidates with confidence sliders
- [ ] Apply a confidence increase — verify `edges.json` was updated
- [ ] Create a new edge — verify it appears in the Edge Browser with status "proposed"
- [ ] Run `Measure-TaxonomyBaseline` — edge count increased by the number of new edges
- [ ] Verify the moderator's `formatEdgeContext` picks up the updated confidence in the NEXT debate

---

### Phase H4: New Concept Harvesting + Ingestion Pipeline Integration

**Goal:** Queue new concepts for taxonomy proposal. Connect the ingestion pipeline to debate knowledge.

**Depends on:** Phase H1 + Priority 1 (needs claim extraction to identify unmapped concepts).

#### Step H4.1: Build the harvest queue

**File:** `ai-triad-data/harvest-queue.json` (new)

```json
{
  "queued_at": "2026-03-29T...",
  "items": [
    {
      "label": "Architectural Ceiling Hypothesis",
      "description": "A cross-cutting concept that...",
      "suggested_pov": "cross-cutting",
      "suggested_category": "Data/Facts",
      "source_debate_id": "debate-uuid",
      "evidence": "Sentinel and Cassandra both referenced this concept across rounds 1-3",
      "status": "queued"
    }
  ]
}
```

#### Step H4.2: AI-assisted concept proposal

When the user checks a new concept item, the AI generates a genus-differentia description following the project's conventions.

**Prompt:** "Propose a taxonomy node for this concept observed in a debate. Follow genus-differentia format: 'A [Category] within [POV] discourse that [differentia]. Encompasses: ... Excludes: ...' Use plain language, grade-10 reading level."

**Verification — V-H4.2: Validate proposed concept**

```typescript
function verifyProposedConcept(
  concept: { label: string; description: string; suggested_pov: string; suggested_category: string },
  existingLabels: Set<string>,
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // V1: Label uniqueness — must not duplicate an existing node label
  if (existingLabels.has(concept.label.toLowerCase())) {
    warnings.push(`Label "${concept.label}" already exists in taxonomy`);
  }

  // V2: Label length (3-8 words)
  const words = concept.label.split(/\s+/).length;
  if (words < 3 || words > 8) warnings.push(`Label has ${words} words (expected 3-8)`);

  // V3: Description follows genus-differentia pattern
  const gdPov = /^A\s+(Goals\/Values|Data\/Facts|Methods\/Arguments)\s+within\s+(accelerationist|safetyist|skeptic)\s+discourse\s+that\s+/i;
  const gdCC = /^A\s+cross-cutting\s+concept\s+that\s+/i;
  const isCC = concept.suggested_pov === 'cross-cutting';
  if (isCC ? !gdCC.test(concept.description) : !gdPov.test(concept.description)) {
    warnings.push('Description does not follow genus-differentia pattern');
  }

  // V4: Valid POV
  if (!['accelerationist', 'safetyist', 'skeptic', 'cross-cutting'].includes(concept.suggested_pov)) {
    warnings.push(`Invalid POV: ${concept.suggested_pov}`);
  }

  // V5: Valid category (unless cross-cutting)
  if (!isCC && !['Goals/Values', 'Data/Facts', 'Methods/Arguments'].includes(concept.suggested_category)) {
    warnings.push(`Invalid category: ${concept.suggested_category}`);
  }

  return { valid: warnings.length === 0, warnings };
}
```

**What this catches:** Duplicate labels, wrong format, invalid POV/category.

#### Step H4.3: Connect harvest queue to `Invoke-TaxonomyProposal`

**File:** `scripts/AITriad/Public/Invoke-TaxonomyProposal.ps1`

Add a `-IncludeHarvestQueue` switch. When set, the cmdlet reads `harvest-queue.json` and includes queued items as additional context for the AI, alongside the normal health data. The prompt says: "The following concepts were observed in debates and are candidates for new nodes. Consider them alongside the health data."

After the proposal is generated, mark harvested items as `"status": "proposed"` in the queue.

**Verification:** Run `Invoke-TaxonomyProposal -IncludeHarvestQueue`. Verify that debate-sourced concepts appear in the proposal output. Verify the queue status was updated.

#### Step H4.4: Add debate context to document ingestion

**File:** `scripts/AITriad/Prompts/pov-summary-system.prompt`

Add to the RULES section:

```
DEBATE CONTEXT (if provided below):
  Some taxonomy nodes have been the subject of structured debates. When mapping
  this document's claims to those nodes, note whether the document provides new
  evidence that could resolve an identified disagreement. Flag these in the
  key_point's "point" field: "NOTE: This evidence is relevant to an unresolved
  debate about [topic] — it [supports/challenges] the [POV] position."
```

The debate context is injected by `Invoke-BatchSummary` when it detects that the document's `pov_tags` overlap with debated nodes.

**File:** `scripts/AITriad/Public/Invoke-BatchSummary.ps1`

Before calling `Invoke-DocumentSummary`, check if any taxonomy nodes in the document's POV have `debate_refs`. If so, load the relevant harvest manifests and inject a brief context block into the system prompt.

**Verification:** Ingest a document that touches a debated topic. Verify the summary flags the relevant claim with the debate context note. Verify the summary is otherwise unchanged for non-debated topics.

#### Phase H4 Validation Gate

- [ ] Harvest a new concept from a debate → appears in `harvest-queue.json`
- [ ] Run `Invoke-TaxonomyProposal -IncludeHarvestQueue` → queued concepts appear in proposal
- [ ] Ingest a document touching a debated node → summary mentions the debate context
- [ ] Ingest a document NOT touching debated nodes → summary is unchanged
- [ ] Verify `harvest-queue.json` items are marked "proposed" after taxonomy proposal runs

---

### Phase H5: Preference Verdict Harvesting

**Goal:** When Priority 3 (preference resolution) is implemented, allow users to record which side of a conflict the evidence favors.

**Depends on:** Phase H1 + Priority 3.

#### Step H5.1: Add verdict to conflict schema

Extend conflict JSON files with optional fields:

```json
{
  "verdict": {
    "prevails": "position described here",
    "criterion": "empirical_evidence",
    "rationale": "The evidence from 3 studies cited in the debate...",
    "source_debate_id": "debate-uuid",
    "harvested_at": "2026-03-29T..."
  }
}
```

**Verification:** `Find-Conflict` must still read and write conflicts with or without the verdict field (backward compat).

#### Step H5.2: AI-assisted verdict summarization

When the synthesis includes a preference, the AI condenses it into a verdict statement suitable for the conflict file.

**Verification — V-H5.2: Validate verdict quality**

```typescript
function verifyVerdict(
  verdict: { prevails: string; criterion: string; rationale: string },
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  const validCriteria = new Set(['empirical_evidence', 'logical_validity', 'source_authority',
    'specificity', 'scope', 'undecidable']);
  if (!validCriteria.has(verdict.criterion)) {
    warnings.push(`Unknown criterion: ${verdict.criterion}`);
  }

  if (!verdict.rationale || verdict.rationale.length < 30) {
    warnings.push('Rationale too short — should explain why this position prevails');
  }

  if (!verdict.prevails || verdict.prevails.length < 10) {
    warnings.push('Prevails field too vague — should describe the winning position');
  }

  return { valid: warnings.length === 0, warnings };
}
```

#### Step H5.3: Add verdict section to HarvestDialog

Show each preference with the conflict it resolves, the winning position, the criterion, and the rationale. User can edit before applying.

#### Phase H5 Validation Gate

- [ ] Run a debate with Priority 3 preferences enabled
- [ ] Harvest dialog shows verdict candidates
- [ ] Apply a verdict → conflict file updated with verdict field
- [ ] Verify `Find-Conflict` still works with verdict-bearing conflict files
- [ ] Verify conflict viewer (if one exists) displays the verdict

---

## 10. Full Dependency Graph

```
  AIF Priorities                    Harvest Phases
  ──────────────                    ──────────────

  Priority 1 ──────────────┐
  (Incremental AN)         │
       │                   ├──→ Phase H1 (Conflicts + Debate Refs) ← can start NOW
       │                   │         │
  Priority 2               │    Phase H2 (Steelman Refinement) ← can start NOW
  (Commitments)            │         │
       │                   │    Phase H3 (Edge Reinforcement) ← needs Priority 1
       │                   │         │
  Priority 3 ─────────────┼──→ Phase H4 (New Concepts + Ingestion) ← needs Priority 1
  (Preferences)            │         │
       │                   └──→ Phase H5 (Preference Verdicts) ← needs Priority 3
  Priority 4
  (S-nodes)

  Priority 5
  (Protocols) ← independent
```

**What can start immediately (no AIF Priority dependencies):**
- Phase H1: Conflict harvesting + debate refs
- Phase H2: Steelman refinement harvesting

**What needs Priority 1 first:**
- Phase H3: Edge reinforcement (needs taxonomy-linked claims from AN)
- Phase H4: New concepts (needs claim extraction to identify unmapped ideas)

**What needs Priority 3 first:**
- Phase H5: Preference verdicts (needs preference resolution in synthesis)

---

## 11. Summary

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
| **Debate → Taxonomy** | **Missing** | **Significant** | **Harvest H1-H5** | **Per-phase validation gates** |
