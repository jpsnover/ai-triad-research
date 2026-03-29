# AIF and the AI Triad Debate Tool — Gap Analysis and Recommendations

**Date:** 2026-03-29
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

## 4. Recommended Changes (Prioritized)

### Priority 1: Incremental Argument Network During Debate

**What:** After each debater's turn, extract I-nodes and S-nodes from their response and add them to a running argument graph. Don't wait for synthesis.

**How:** Add a lightweight post-processing step after each `parsePoverResponse` call that:
1. Extracts 1-3 key claims (I-nodes) from the statement text
2. Links them to taxonomy nodes (existing I-nodes in the knowledge base)
3. For each claim that responds to a prior claim, creates an S-node classifying the relationship (RA if supporting, CA if attacking)
4. Stores the running graph in `debate.argument_network`

**Benefit:** The moderator can use the live argument graph (not just transcript text and edge tensions) to select the most productive next exchange. The synthesis step becomes a refinement of an existing graph rather than a full reconstruction.

**Effort:** Medium — requires a new prompt step after each turn, but the infrastructure (taxonomy_refs, move_types) already provides most of the raw material.

### Priority 2: Commitment Tracking

**What:** Maintain a per-debater commitment store that tracks what each agent has asserted, conceded, and challenged.

**How:** After each turn, update a `commitments` object on the debate session:
```json
{
  "prometheus": {
    "asserted": ["C1: Scaling compute is sufficient for AGI", ...],
    "conceded": ["C5: Current AI has jagged capabilities"],
    "challenged": ["C3: Alignment must precede deployment"]
  }
}
```

When a debater's next turn is generated, inject their commitment store into the prompt: "You have previously asserted X and conceded Y. Be consistent."

**Benefit:** Prevents agents from contradicting themselves. Enables the moderator to identify inconsistencies ("Prometheus, you conceded X but your latest argument assumes not-X"). Makes debates more rigorous.

**Effort:** Low-Medium — mostly prompt engineering plus a simple append-only data structure.

### Priority 3: Preference Resolution

**What:** When the synthesis identifies disagreements, add a resolution step that evaluates which argument is stronger and why.

**How:** Add a `preferences` section to synthesis output:
```json
{
  "preferences": [
    {
      "conflict": "C1 vs C2",
      "prevails": "C2",
      "criterion": "empirical_evidence",
      "rationale": "C2 cites three peer-reviewed studies; C1 relies on extrapolation from scaling laws."
    }
  ]
}
```

This maps directly to AIF's PA-nodes. The criterion could be: empirical evidence strength, logical validity, source authority, specificity, or recency.

**Benefit:** Transforms synthesis from "here are the disagreements" to "here are the disagreements and here's what the evidence actually supports." Much more useful for a research audience.

**Effort:** Low — prompt change to `debateSynthesisPrompt` only.

### Priority 4: S-node Enrichment on Argument Map

**What:** When generating the argument_map (whether incrementally or in synthesis), require explicit reasoning patterns on support and attack links.

**How:** Change `supported_by` from a flat list to:
```json
{
  "supported_by": [
    {
      "claim_id": "C3",
      "scheme": "argument_from_evidence",
      "warrant": "Multiple studies demonstrate scaling improvements",
      "critical_questions": [
        {"question": "Are the cited studies representative?", "addressed": false}
      ]
    }
  ]
}
```

**Benefit:** Makes the reasoning chain inspectable and challengeable. A debater (or the moderator) can target the warrant directly, enabling true undercut attacks.

**Effort:** Medium — requires prompt changes and potentially UI updates to display warrants.

### Priority 5: Formal Protocol Variants

**What:** Define debate protocols as declarative configurations rather than hardcoded state machines.

**How:** Create protocol definition files (JSON or prompt templates) specifying:
- Legal locution sequences
- Turn-taking rules
- Phase transitions
- Win/loss conditions (if applicable)

Protocols could include: structured debate (current), Socratic dialogue, deliberation (seeking consensus), adversarial cross-examination.

**Benefit:** Users could select debate format when creating a new debate. Different research questions suit different protocols.

**Effort:** High — significant refactoring of the debate state machine.

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

## 6. Summary

| AIF Concept | Current Support | Gap Severity | Recommended Action |
|-------------|----------------|-------------|-------------------|
| I-nodes (claims) | Partial (synthesis only) | Moderate | Priority 1: incremental extraction |
| RA-nodes (inference) | Flat `supported_by` | Moderate | Priority 4: S-node enrichment |
| CA-nodes (conflict) | Good (attack_type) | Low | Already well-supported |
| PA-nodes (preference) | Missing | Significant | Priority 3: preference resolution |
| Schemes | Labels only | Low-Moderate | Priority 4: critical questions |
| Locutions | Partial (type field) | Low | Map `move_types` to AIF locutions |
| Protocols | Implicit | Low | Priority 5: declarative protocols |
| Commitment stores | Missing | Moderate | Priority 2: per-agent tracking |
| Participants | Good | None | Well-supported via BDI + POVers |
| Context | Good | None | Background theory via taxonomy |
