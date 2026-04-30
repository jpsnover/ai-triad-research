# Active Moderator: Design Recommendation

## Status: Proposal — April 2026

## Problem Statement

The current moderator is a **turn-routing oracle**: it selects which debater speaks next and
on what topic, but it never speaks substantively into the debate. It is invisible to the
audience. This makes it fundamentally different from real-world moderators, who are
often the most important voice in the room — not because they argue, but because they
shape the conditions under which argumentation happens.

A skilled human moderator operates across a full spectrum — from adversarial pressure
("Senator, yes or no") to supportive facilitation ("That's an important concession;
let me make sure everyone heard it"). The facilitation literature consistently shows
that softer moves (acknowledgment, revoicing, encouragement) often do more for
discussion quality than forceful content injection. A moderator who only challenges
produces defensive debaters; one who also acknowledges and revoices produces debaters
who take risks, concede when warranted, and build on each other's ideas.

Our system needs both registers. The convergence signals infrastructure already detects
most situations that warrant intervention. What's missing is the intervention itself —
and the full range of moderator moves that make a discussion productive rather than
merely adversarial.

---

## Current Architecture (Where the Moderator Fits)

```
Round N:
  ┌─────────────────────────────────────────────────┐
  │  Moderator: crossRespondSelectionPrompt()       │
  │  → selects responder, focus_point, addressing   │
  │  → system entry (invisible to audience)         │
  └──────────────┬──────────────────────────────────┘
                 │
                 ▼
  ┌─────────────────────────────────────────────────┐
  │  Debater: 4-stage pipeline (BRIEF→PLAN→DRAFT→CITE) │
  │  → substantive turn with claims, taxonomy refs  │
  └──────────────┬──────────────────────────────────┘
                 │
                 ▼
  ┌─────────────────────────────────────────────────┐
  │  Judge: validateTurn()                          │
  │  → pass / retry / accept-with-flag              │
  └─────────────────────────────────────────────────┘
```

The moderator operates *before* the debater turn and produces metadata. The debater
never sees a direct moderator question; it sees only instructions injected into its
pipeline's BRIEF stage ("focus on X, address Y"). This is routing, not moderation.

---

## Proposed Architecture: Interventionist Moderator

### Core Change

The moderator gains a new output mode: **interventions**. An intervention is a visible
transcript entry — a question, challenge, acknowledgment, or directive spoken *as the
moderator* that shapes the next debater's response.

The moderator operates in **two stages** (two separate LLM calls), not one.
A moderator trying to do routing, diagnosis, and speech generation in one pass
overloads the prompt — each stage is independently testable and failures in one
don't contaminate the other.

**Authority boundary:** The LLM is advisory; the engine is authoritative.
Stage 1 (LLM) *recommends* whether to intervene and which move to use.
The engine *validates* the recommendation against deterministic constraints
(budget, cooldown, phase, prerequisites, burden cap) before acting. The
engine always has veto power. A broken Stage 1 output — hallucinated move
type, wrong phase, budget-violating recommendation — is caught and
suppressed. The debate continues with no intervention that round, same as
today. Suppression is logged as `suppressed_reason: 'engine_override'`.

```
Round N:
  ┌──────────────────────────────────────────────────────┐
  │  ENGINE: Pre-compute trigger context (deterministic) │
  │  → compute all signal values from convergence data   │
  │  → compute health score + trajectory modifier        │
  │  → compute adaptive persona modifiers                │
  │  → package as TriggerEvaluationContext                │
  └──────────────┬───────────────────────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────────────────────┐
  │  STAGE 1: Selection (LLM call #1) — ADVISORY        │
  │  → receives TriggerEvaluationContext + transcript    │
  │  → selects responder, focus_point, addressing       │
  │  → recommends: intervene? which move? why?          │
  │  → output: SelectionResult (structured JSON)        │
  └──────────────┬───────────────────────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────────────────────┐
  │  ENGINE: Validate recommendation (deterministic)     │
  │  → check budget, cooldown, phase, prerequisites     │
  │  → check burden cap, same-debater consecutive rule  │
  │  → compute near-misses from signal values           │
  │  → record all trigger_evaluations for diagnostics   │
  │  → decision: proceed / suppress (with logged reason)│
  └──────┬───────────────────┬──────────────────────────┘
         │                   │
         │ (suppressed or    │ (validated)
         │  no intervention) │
         │                   ▼
         │            ┌──────────────────────────────────┐
         │            │  STAGE 2: Generation (LLM #2)   │
         │            │  → receives move, family, target │
         │            │  → composes intervention text    │
         │            │  → packages constraints          │
         │            └──────────┬───────────────────────┘
         │                       │
         │                       ▼
         │            ┌──────────────────────────────────┐
         │            │  ENGINE: Post-generation gates   │
         │            │  → REVOICE: propositional gate   │
         │            │  → validate output schema        │
         │            │  → fallback: no intervention if  │
         │            │    Stage 2 fails or gate rejects │
         │            └──────────┬───────────────────────┘
         │                       │
         ▼                       ▼
  ┌──────────────┐   ┌──────────────────────────────────┐
  │  Debater     │   │  Moderator Intervention          │
  │  turn as     │   │  → visible transcript entry      │
  │  today       │   │  → tagged with family, move,     │
  │              │   │     force, and constraint        │
  └──────────────┘   └──────────┬───────────────────────┘
                                │
                                ▼
                     ┌──────────────────────────────────┐
                     │  Debater turn                    │
                     │  → BRIEF stage receives move tag │
                     │    + moderator text + constraint │
                     │    template for required fields  │
                     └──────────────────────────────────┘
```

Stage 1 runs every round (same cost as today's moderator call). Stage 2
runs only when the engine validates the recommendation — roughly once per
2.5 rounds, adding ~3-5 extra API calls per debate. If any stage fails
(parse error, timeout, gate rejection), the round proceeds with no
intervention — the debate is never blocked by moderator failures.

### Operational Constraints

**Latency budget:** A round currently takes 10-30 seconds (moderator call
+ 4-stage debater pipeline + judge). The moderator redesign adds:

| Step | Latency | Frequency |
|---|---|---|
| Engine: `computeTriggerEvaluationContext()` | ~50-200ms (deterministic, includes embedding lookups) | Every round |
| Stage 1: Selection (LLM call) | ~2-5s (replaces existing moderator call — no net cost) | Every round |
| Engine: `validateRecommendation()` | <10ms (deterministic) | Every round |
| Stage 2: Generation (LLM call) | ~2-5s | ~40% of rounds |
| Engine: Propositional gate (REVOICE only) | ~100-300ms (embedding + string matching) | Rare |
| Stage 2 retry (REVOICE → CHECK fallback) | ~2-5s | Very rare |

**Worst case per round:** Stage 1 + Stage 2 + REVOICE gate fail + CHECK
retry = ~9-15s of added LLM latency. This path requires REVOICE to fire
*and* fail the propositional gate — expected <5% of intervention rounds.
**Typical added latency:** 0s (no intervention) or ~2-5s (one Stage 2
call).

**Timeouts:** Each LLM stage has an independent timeout. If exceeded, the
stage fails and the round proceeds without intervention.

| Stage | Timeout | On failure |
|---|---|---|
| Stage 1 | 15s | Use today's selection logic (responder + focus only, no intervention) |
| Stage 2 | 10s | Skip intervention, log `stage2_failure` |
| Stage 2 retry (REVOICE → CHECK) | 10s | Skip intervention entirely |

**Embedding precomputation:** The all-MiniLM-L6-v2 model and taxonomy
embeddings (`embeddings.json`) are already loaded at debate start for
claim extraction and convergence signal computation. The moderator does
not introduce a new cold-start dependency. The REVOICE propositional gate
reuses the same resident model and preloaded taxonomy embeddings — its
~100-300ms cost is embedding inference for the revoiced text + top-3
lookup against the existing taxonomy embedding index.

---

## Intervention Taxonomy

The five original intervention types (PIN, CLARIFY, CONFRONT, ELEPHANT, COMPRESS)
all sit on the adversarial-pressure end of the moderation spectrum. They cover
commitment, meaning, consistency, coverage, and compression — but miss coordination,
repair, acknowledgment, and participation balancing.

The revised taxonomy organizes moderator moves into six families that span the full
facilitation spectrum. Each family serves a distinct function; a well-moderated debate
draws from all five, not just the challenging ones.

### Overview

| Family | Function | Register | Moves (abbrev.) | Burden |
|---|---|---|---|---|
| **Procedural** | Control the process | Neutral | REDIRECT (RDR), BALANCE (BAL), SEQUENCE (SEQ) | 0.5 |
| **Elicitation** | Draw out substance | Adversarial | PIN (PIN), PROBE (PRB), CHALLENGE (CHL) | 1.0 |
| **Repair** | Fix misunderstanding | Neutral-supportive | CLARIFY (CLR), CHECK (CHK), SUMMARIZE (SUM) | 0.75 |
| **Reconciliation** | Reward productive moves | Supportive | ACKNOWLEDGE (ACK), REVOICE (RVC) | 0.25 |
| **Reflection** | Examine the dialogue itself | Reflective | META-REFLECT (MRF) | 0.6 |
| **Synthesis** | Compress and commit | Convergent | COMPRESS (CMP), COMMIT (CMT) | 0.8 |

### Two-Dimensional Classification

The moves within these families are not uniformly typed. Some are speech acts
(PIN, PROBE, CLARIFY), some are interaction-management acts (BALANCE, REDIRECT,
SEQUENCE), some are meta-representational acts (REVOICE, SUMMARIZE, COMPRESS),
and some are normative reinforcement acts (ACKNOWLEDGE, COMMIT). A single
moderator utterance can be multifunctional — simultaneously revoicing,
clarifying, and acknowledging.

The primary function label (the family) drives operational concerns: which
compliance check the judge enforces and which outcome metric tracks
effectiveness. But for diagnostics and academic legibility, each intervention
is also annotated with an **interactional force** dimension:

| Force | Description | Example moves |
|---|---|---|
| **directive** | Commands action or topic shift | REDIRECT, BALANCE, SEQUENCE |
| **interrogative** | Demands an answer | PIN, PROBE, CHALLENGE |
| **declarative** | States a moderator observation | SUMMARIZE, ACKNOWLEDGE |
| **reflective** | Invites self-examination | CHECK, REVOICE, META-REFLECT, COMPRESS, COMMIT |

The force annotation is descriptive, not prescriptive — it appears in
diagnostics and post-hoc analysis but does not affect the judge's compliance
check. This preserves operational simplicity while giving analysts a cleaner
vocabulary for studying intervention patterns.

---

### Family 1: Procedural — "Let Me Steer the Process"

Procedural moves control the shape of the debate without commenting on content.
They ensure all voices are heard, topics get adequate coverage, and the debate
doesn't loop or stall.

#### REDIRECT — "Let's Talk About What You're Avoiding"

**Trigger:** A topic exists in the taxonomy context with high relevance to the
debate topic (embedding similarity ≥ 0.7) but has zero citations across all turns
after round 2. Replaces and generalizes the current midpoint gap injection
mechanism.

**Also triggers on:** The debate has spent ≥3 consecutive rounds on the same
sub-topic (measured by >60% claim-overlap between consecutive turns across all
speakers), indicating tunnel vision.

**Moderator output:**
```
[MODERATOR] We've spent {N} rounds on {current topic}. Let's shift to
{uncovered topic}. {Debater}, how does {uncovered topic} affect your position?
```

**Debater constraint:** No forced format — this is a topic redirect. But the
moderator's `focus_point` locks to this topic for the next round, so the debater
can't ignore it without triggering a PIN on the following round.

**Side effect:** The moderator's AN context for the next round prioritizes
unaddressed nodes related to the redirected topic.

#### BALANCE — "We Haven't Heard From You"

**Trigger:** One debater's turn count is ≥2 behind the most-active debater, OR
one debater hasn't spoken in ≥3 rounds.

**Also triggers on:** Move disposition analysis shows one debater has been
exclusively addressed (attacked or challenged) for 3+ consecutive rounds without
getting to initiate — they've been playing defense.

**Moderator output:**
```
[MODERATOR] {Debater}, you've been responding to challenges for the last
few rounds. Take this turn to advance your strongest remaining argument
on your own terms.
```

**Debater constraint:** None — this is an invitation, not a demand. The
moderator selects this debater as the next responder and sets `addressing` to
`'general'` rather than directing them at a specific opponent.

**Phase affinity:** All phases, but especially thesis-antithesis (ensure all
three positions are equally established) and synthesis (ensure all three voices
contribute to convergence).

#### SEQUENCE — "Let's Take These One at a Time"

**Trigger:** Two or more debaters have raised distinct but entangled sub-topics
in the same round, and subsequent turns conflate them. Detection: the last 2
turns each contain claims that attack/support nodes from ≥2 different
sub-clusters in the AN (clusters defined by connected components in the
attack/support graph).

**Moderator output:**
```
[MODERATOR] There are two distinct questions on the table: {topic A}
and {topic B}. Let's address them in order. {Debater}, take {topic A}
first.
```

**Debater constraint:** The moderator's `focus_point` is locked to topic A.
Topic B is queued for the following round's `focus_point`.

**Phase affinity:** Exploration phase primarily. In thesis-antithesis, broad
staking is appropriate; in synthesis, entanglement is expected.

---

### Family 2: Elicitation — "I Need You to Go Deeper"

Elicitation moves apply pressure to draw out substance the debater is
withholding, evading, or glossing over. These are the adversarial moves that
make debates sharp.

#### PIN — "Yes or No?"

**Trigger:** A debater was asked a direct question (detected by `?` in prior
turn's claims or focus_point) and their response has <20% word overlap with
the question's key terms — i.e., they pivoted away.

**Also triggers on:** Convergence signal `concession_opportunity === 'missed'`
when the unanswered claim has QBAF strength ≥ 0.7.

**Moderator output:**
```
[MODERATOR] {Debater}, your opponent asked whether {specific claim}.
You moved to a different topic. Before continuing: do you agree or
disagree with {specific claim}? If it's conditional, state the condition.
```

**Debater constraint:** Response must begin with a `pin_response` field:
```json
{
  "pin_response": {
    "position": "agree" | "disagree" | "conditional",
    "condition": "only if ...",
    "brief_reason": "..."
  },
  "statement": "... rest of turn ..."
}
```

**Judge enforcement:** If `pin_response` is absent or `position` is missing,
the judge returns `retry` with a repair hint: "You must directly answer the
moderator's question before proceeding."

#### PROBE — "Give Me Your Reasons"

**Trigger:** A debater has made a strong claim (QBAF base_strength ≥ 0.6) with
no supporting evidence — the AN node has zero incoming `supports` edges and no
`taxonomy_refs` pointing to empirical BDI nodes (beliefs with evidence_quality
scores).

**Also triggers on:** A debater invokes an argumentation scheme (e.g.,
ARGUMENT_FROM_AUTHORITY, SLIPPERY_SLOPE) but the critical questions for that
scheme remain unaddressed (tracked via `critical_questions_addressed` on edges).

**Moderator output (evidence):**
```
[MODERATOR] {Debater}, you've claimed that {claim text}. What evidence
supports this? Name a specific study, dataset, or precedent.
```

**Moderator output (critical question):**
```
[MODERATOR] {Debater}, you're arguing from {scheme name}. But {critical
question text}? Address that before moving on.
```

**Debater constraint:** Response must include a `probe_response` field:
```json
{
  "probe_response": {
    "evidence_type": "empirical" | "precedent" | "theoretical" | "conceded_gap",
    "evidence": "specific citation or acknowledgment of gap",
    "critical_question_addressed": "..."
  },
  "statement": "..."
}
```

**Side effect (synchronous, provisional):** If the debater provides
evidence, it becomes a provisional support edge in the AN, available to
the next round's trigger evaluation after the 1-round hardening window
(see "Provisional AN side effects" in Implementation Approach). If they
respond `conceded_gap`, the claim's QBAF base_strength is provisionally
penalized (multiplied by 0.7). The claim extraction pipeline is extended
to process `probe_response`, `pin_response`, `clarification`, and other
structured response fields as additional input alongside `statement` and
`taxonomy_refs`.

#### CHALLENGE — "But You Said..."

**Trigger:** Position drift signal shows overlap between a debater's current
turn and their opening statement dropped below 0.3, AND their current turn
uses a claim that contradicts (attacks) one of their own prior claims in the
Argument Network (self-attack edge detected during claim extraction).

**Also triggers on:** A debater's `recycling_rate.max_self_overlap` exceeds
0.6 AND they have failed to engage with the strongest opposing claim
(`strongest_opposition.addressed === false` for 2+ rounds) — they're
repeating themselves while ignoring challenges. Recycling alone without
contradiction or non-engagement does not trigger CHALLENGE; a debater who
repeats a point but addresses opposing arguments is reinforcing, not
stagnating. Pure recycling without internal contradiction is better
handled by COMPRESS (force distillation) or PROBE (demand new evidence).

**Moderator output (contradiction):**
```
[MODERATOR] {Debater}, in round {N} you argued that "{prior claim text}."
Now you appear to be arguing that "{current claim text}." These seem to
be in tension. Which position do you hold, and what changed your thinking?
```

**Moderator output (stagnation):**
```
[MODERATOR] {Debater}, you've made this point {N} times. Your opponents
have responded with {strongest opposing claim}. What is your answer to
that specific challenge?
```

**Debater constraint:** Must include `challenge_response`:
```json
{
  "challenge_response": {
    "type": "evolved" | "consistent" | "conceded",
    "explanation": "why position changed / why it's actually consistent / what I now concede"
  },
  "statement": "..."
}
```

---

### Family 3: Repair — "Let Me Make Sure We Understand Each Other"

Repair moves fix breakdowns in mutual understanding. They're neutral in tone —
they don't pressure or praise, they clarify. These moves are essential because
LLM debaters frequently use the same words to mean different things, producing
debates that look productive but are actually ships passing in the night.

**CHECK and CLARIFY share an underlying failure mode** (semantic divergence)
but intervene at different levels. CLARIFY targets the *lexical* level
(undefined terms used ≥2 times); CHECK targets the *propositional* level
(attacks that miss their target due to misunderstanding). A debate can need
CLARIFY without CHECK (both debaters use a vague term consistently) or CHECK
without CLARIFY (clear terms, but one debater misreads the other's argument
structure). When both fire in the same round, **CHECK subsumes CLARIFY**: if
CHECK reveals a misunderstanding rooted in undefined terms, the CLARIFY
becomes redundant. The prerequisite graph already handles the reverse case
(CLARIFY-before-PIN).

#### CLARIFY — "What Do You Mean By That?"

**Trigger:** A debater uses a vague or abstract term that has no operational
definition in the taxonomy and has been used ≥2 times across turns without
being defined. Detection: the term appears in claims but not in any taxonomy
node's `description` field, and has been flagged by the judge's
`clarifies_taxonomy` output.

**Also triggers on:** Scope mismatch — when two debaters' claims on the same
topic operate at different levels of abstraction (one cites a specific study,
the other cites "the literature"), detected via BDI category mismatch on
attack edges (belief-attacks-intention or vice versa).

**Moderator output:**
```
[MODERATOR] {Debater}, you've used the phrase "{term}" several times.
What specifically do you mean? Give a concrete example or a measurable
threshold.
```

**Debater constraint:** Response must include a `clarification` field:
```json
{
  "clarification": {
    "term": "the vague term",
    "definition": "operational definition",
    "example": "concrete instance"
  },
  "statement": "..."
}
```

**Side effect:** If the debater provides a valid clarification, it becomes a
candidate taxonomy node (flagged for human review in the post-debate
taxonomy refinement pass).

#### CHECK — "Let Me Make Sure You're Hearing Each Other"

**Trigger:** Two debaters are attacking each other's claims, but their claims
don't actually conflict — they're arguing about different aspects of the same
topic. Detection: two AN nodes connected by an attack edge have embedding
similarity < 0.3 (they're topically distant despite the attack relation),
suggesting a misunderstanding rather than a genuine disagreement.

**Also triggers on:** A debater's rebuttal mischaracterizes the opponent's
position. Detection: the `warrant` field on an attack edge has low embedding
similarity (< 0.4) to the target node's actual text — the attacker is
refuting a strawman.

**Moderator output:**
```
[MODERATOR] {Debater A}, I want to make sure you're hearing {Debater B}'s
actual point. {Debater B} said: "{verbatim quote from B's transcript}."
Is that what you're responding to, or are you addressing something different?
```

**Note:** CHECK uses a **direct quote**, not a paraphrase. The engine
extracts the verbatim claim text from the AN node and injects it into
the Stage 2 prompt as `source_claim`. A paraphrase inside a CHECK would
be a secondary source of misunderstanding — exactly the problem CHECK
is designed to fix.

**Debater constraint:** Response must include a `check_response` field:
```json
{
  "check_response": {
    "understood_correctly": true | false,
    "actual_target": "what I was actually responding to",
    "revised_response": "..."
  },
  "statement": "..."
}
```

**Side effect:** If the debater confirms a misunderstanding (`understood_correctly:
false`), the attack edge is reclassified or removed from the AN, and the
mischaracterized claim is re-queued in the unanswered claims ledger.

#### SUMMARIZE — "Here's Where We Stand"

**Trigger:** Periodic — fires every `ceil(totalRounds / 3)` rounds, aligned
with phase transitions (end of thesis-antithesis, midpoint of exploration,
start of synthesis).

**Also triggers on:** Transcript length exceeds the context compression
threshold (>12 entries) — instead of silent compression, the moderator
produces a visible summary that serves as a shared reference point.

**Moderator output:**
```
[MODERATOR] Let me take stock of where we are.

Points of agreement: {list}
Active disagreements: {list with BDI classification}
Unresolved questions: {list}
Claims awaiting response: {list from unanswered claims ledger}

{Debater}, pick up from the strongest unresolved disagreement.
```

**Content generation:** The engine pre-computes the structured summary data
from existing state, then Stage 2 composes the natural-language version:

```typescript
interface ContentionCluster {
  focus: string;                 // central topic or taxonomy node
  attack_edge_count: number;     // density of unresolved attacks
  involved_debaters: PoverId[];  // who is entangled in this cluster
  unresolved: boolean;           // true if no concession/resolution edges exist
}

interface SummarizeContext {
  agreements: string[];          // from commitment ledger: mutual concessions
  disagreements: string[];       // from AN: active attack edges with no resolution
  unresolved: string[];          // from unanswered claims ledger
  awaiting_response: string[];   // from unanswered claims ledger, filtered by staleness
  contention_clusters: ContentionCluster[];  // AN regions with dense unresolved attacks
}
```

The `contention_clusters` field identifies AN subgraphs where attack edges
are dense but no resolution (concession, CHECK correction, or ACKNOWLEDGE)
exists. This prevents the summary from being a flat list — Stage 2 can
present the debate's hottest cruxes as structured contention points rather
than enumerating individual disagreements.

Stage 2 receives this pre-computed context — it does not extract these lists
from the transcript itself (which would be unreliable and slow). Stage 2's
job is to compose the lists into natural-sounding moderator speech.

**Debater constraint:** None — the summary is informational. But the debater's
BRIEF stage receives the summary as injected context, anchoring subsequent turns
to the moderator's framing of the debate state.

**Side effect:** The summary itself becomes a system node in the AN, providing
a reference point for measuring whether subsequent turns advance beyond the
summarized state.

---

### Family 4: Reconciliation — "That Was Important"

Reconciliation moves reward productive behavior. This is the family most absent
from our current design and potentially the most impactful. The facilitation
literature is clear: participants who feel heard take more intellectual risks.
For LLM debaters specifically, acknowledgment counteracts the sycophancy
pressure — when a debater's concession is publicly validated by the moderator,
the system reinforces that conceding is a valued move, not a failure.

#### ACKNOWLEDGE — "That's a Significant Concession"

**Trigger:** Convergence signal `concession_opportunity.outcome === 'taken'` —
a debater conceded a point in the face of a strong opposing argument (QBAF
strength ≥ 0.6).

**Also triggers on:** A debater uses a CONDITIONAL-AGREE or INTEGRATE move
(from the dialectical move taxonomy) — they're building on an opponent's
argument rather than just attacking it.

**Also triggers on:** A debater's `challenge_response.type === 'evolved'` or
`'conceded'` — they admitted their position changed in response to a
CHALLENGE intervention.

**Moderator output (concession):**
```
[MODERATOR] {Debater}, you've conceded that {conceded claim}. That's a
substantive move. {Other debaters}, does this change the shape of your
disagreement?
```

**Moderator output (integration):**
```
[MODERATOR] {Debater}, you've incorporated {opponent}'s point about
{integrated claim} into your argument. Let's see if the others can
build on that.
```

**Debater constraint:** None — the moderator is not demanding anything. The
acknowledgment enters the transcript as a visible marker that concession and
integration are valued. The next debater's BRIEF stage receives the
acknowledgment as context, encouraging reciprocal productive moves.

**AN side effect:** The conceded/integrated claim gets a `moderator_highlighted`
flag in the AN, increasing its salience in future moderator context windows.
This ensures the concession isn't lost as the transcript grows.

**Why this matters for LLMs:** Without explicit acknowledgment, LLM debaters
treat concession as a local event — they concede once and then revert to their
original position in subsequent turns (measured as position drift bouncing
back). The acknowledgment creates a public record that the concession happened
and signals to all agents that it should be treated as load-bearing.

#### REVOICE — "Let Me Say That Back in a Way Everyone Can Build On"

**Trigger:** A debater makes a claim that is substantively important (high QBAF
base_strength ≥ 0.7, multiple attack edges — i.e., it's contested) but
expressed in persona-specific jargon that other debaters aren't engaging with.
Detection: the claim has ≥2 incoming attack edges, but the attacking claims
have low warrant quality (short warrants, low embedding similarity to the
target — suggesting the attackers aren't really grappling with the content).

**Also triggers on:** A debater produces a distinction or nuance (DISTINGUISH
or NARROW move) that the other debaters appear to have missed — no subsequent
turn references it despite it being directly relevant (embedding similarity
≥ 0.6) to the ongoing exchange.

**Moderator output:**
```
[MODERATOR] {Debater}, let me restate that to make sure it lands.
You're saying that {revoiced version in plain language}. {Other debaters},
does that version capture it? And if so, how does it affect your position?
```

**Architectural safeguards (four layers):**

Revoicing inherently transforms meaning — it is interpretive recoding, not
neutral repetition. Semantic similarity (embedding distance) is not pragmatic
equivalence: two paraphrases can be vector-near yet rhetorically different
("we should consider pausing" vs. "we must halt"). Critically, standard
embedding models penalize register shifts — the exact operation REVOICE is
designed to perform. A raw cosine similarity gate between original and
revoiced text would reject most successful translations (persona-specific
jargon → plain language) while passing only trivial paraphrases that don't
actually bridge anything. The safeguards therefore use **propositional
anchoring** rather than surface similarity, combined with speaker authority:

1. **Pre-insertion propositional gate (taxonomy-anchored):** Rather than
   comparing the revoiced text directly to the original claim, the system
   validates that both texts are *about the same thing* by checking against
   register-neutral reference points:

   a. **Taxonomy anchor check (with dynamic fallback):** Extract the
      original claim's `taxonomy_refs`. Compute embedding similarity between
      the revoiced text and each referenced taxonomy node's `description`
      field. If the revoiced text's top-3 nearest taxonomy nodes match the
      original claim's top-3 (≥2 of 3 overlap), the propositional content
      is preserved regardless of register.

      **Dynamic AN anchor fallback:** If the taxonomy anchor check produces
      *zero* overlapping nodes (not just <2/3 — partial overlap still
      indicates taxonomy coverage), the claim likely uses novel vocabulary
      that hasn't been incorporated into the static taxonomy. In this case,
      the gate falls back to **AN-anchored validation**: use the top-3
      most-cited AN nodes from the last 2 rounds as anchor points instead
      of taxonomy nodes. This ensures REVOICE remains functional for
      emerging conceptual clusters that outpace taxonomy updates. The
      AN-anchored path is weaker (AN nodes are in persona-specific register,
      not register-neutral), so its results are tagged
      `anchor_source: 'dynamic_an'` in diagnostics for separate accuracy
      tracking.

   b. **Entity and relation preservation:** Extract named entities, numeric
      thresholds, and causal relations from the original claim (fast
      string-matching, not LLM-based). The revoiced text must preserve all
      entities and relations. "Deployment above 10^25 FLOPs should require
      safety audits" → "Large AI systems need safety checks before release"
      fails because it drops the FLOP threshold. This catches the worst
      hallucinations without penalizing vocabulary shifts.

   c. **Fallback:** If the propositional gate fails (taxonomy mismatch or
      entity loss), the revoice is rejected and the moderator **automatically
      downgrades to a CHECK** ("I want to make sure I understand your
      point — you're saying...?"). This recovers value from a failed revoice
      by converting it into a productive repair move.

   This design separates "said differently" (valid translation) from "said
   something different" (hallucination). A revoice that shifts from
   accelerationist jargon to plain language but preserves the same taxonomy
   anchors and entities passes the gate; one that drifts to different
   propositional content fails — regardless of surface-level similarity.

2. **Speaker confirmation (mandatory, forced responder):** REVOICE
   **overrides the normal responder selection** — the original speaker is
   forced as the next responder, guaranteeing that confirmation happens
   immediately. This prevents the failure mode where other debaters engage
   with an unconfirmed revoice before the original speaker has validated
   it. The cost is that REVOICE constrains the moderator's routing freedom
   for one round — acceptable, since REVOICE is rare (high trigger
   threshold). If the speaker rejects the revoice (`accurate: false`),
   the engine removes the revoiced text from the transcript (replacing it
   with a "[moderator paraphrase retracted]" marker) and queues a CHECK
   for the next round targeting the same claim — ensuring the original
   meaning is eventually established.

3. **Original wording preservation:** The transcript always displays both
   the original claim text and the revoiced version, with the original
   clearly marked as authoritative. The revoiced version is labeled as a
   moderator paraphrase. This preserves epistemic transparency — readers
   can see exactly what was said and how it was restated.

4. **Conditional AN linkage:** Revoiced claims are **display-only by
   default** — excluded from claim extraction and never become independent
   AN nodes. However, if the debater confirms accuracy (`revoice_response
   .accurate === true`), the revoiced version may be added as a linked AN
   node with a `revoice_of` edge pointing to the original claim. The
   `revoice_of` edge type must be added to the edge ontology alongside
   the existing types (CONTRADICTS, TENSION_WITH, WEAKENS, RESPONDS_TO,
   supports). It is non-dialectical — it expresses identity-across-register,
   not argumentation. It carries no QBAF weight and is excluded from
   attack/support counting. This gives the AN the register-neutral phrasing
   when the speaker validates it, without creating orphaned edges from
   unvalidated paraphrases. The original claim always remains the
   authoritative node; the revoiced node is structurally subordinate.

**Debater constraint:**
```json
{
  "revoice_response": {
    "accurate": true | false,
    "correction": "what I actually meant was..."
  },
  "statement": "..."
}
```

**Why revoicing matters:** In human facilitation, revoicing is one of the
most powerful moves because it does three things simultaneously:
1. It validates the speaker ("your point was worth repeating").
2. It translates into shared vocabulary (removing jargon barriers).
3. It gives other participants a version they can engage with.

For LLM debates, revoicing is especially valuable because each persona
has its own rhetorical register (Prometheus uses progress/innovation
language, Sentinel uses risk/safety language, Cassandra uses structural/
institutional language). A point made in one register may be invisible
to agents operating in another. The moderator's revoicing bridges
registers.

---

### Family 5: Reflection — "Step Outside Your Argument"

Reflection moves ask debaters to examine their own reasoning process rather
than advance or defend positions. They are distinct from Elicitation (which
pressures for substance) and Synthesis (which converges toward closure).
Reflection opens a meta-level: "What would change your mind?" is not asking
for evidence or commitment — it's asking a debater to map the contours of
their own epistemic position.

This family is approximated by the existing IDENTIFY-CRUX dialectical move
and COMMIT's `conditions_for_change` field, but both are end-of-debate
mechanisms. A mid-debate reflective move surfaces cruxes earlier and more
organically, before positions have calcified.

#### META-REFLECT — "What Would Change Your Mind?"

**Trigger:** Exploration phase, after round 3. Fires when crux_rate shows
`cumulative_count === 0` for a debater after 3+ turns — they haven't
identified what would change their mind, suggesting they're arguing from
commitment rather than inquiry.

**Also triggers on:** All three debaters are attacking each other's
conclusions but none have questioned their shared premises. Detection:
among AN nodes that are topically relevant to the current focus area
(embedding similarity ≥ 0.5 to the current `focus_point`), there are no
edges between nodes within the same BDI category across different speakers.
The topical filter is essential — the BDI structure naturally separates
speakers into category-coherent stances, so the *absence* of
same-category cross-speaker edges is structurally normal across the full
AN. The trigger only fires when topically co-located nodes (where shared
premises would be visible) lack cross-speaker examination.

**Also triggers on:** A debater has used the same argumentation scheme
(e.g., ARGUMENT_FROM_AUTHORITY) for 3+ consecutive turns without variation,
suggesting autopilot reasoning.

**Moderator output (crux identification):**
```
[MODERATOR] {Debater}, you've argued several rounds without naming what
would change your position. What specific evidence or argument, if
presented, would cause you to revise your view?
```

**Moderator output (shared assumption):**
```
[MODERATOR] All three of you appear to be assuming that {shared premise}.
Is that assumption warranted? What happens to your positions if it's wrong?
```

**Moderator output (reasoning pattern):**
```
[MODERATOR] {Debater}, you've relied on {scheme name} in each of your
last {N} arguments. Are there other ways to approach this, or is that
the strongest frame available?
```

**Debater constraint:** Must include `reflection`:
```json
{
  "reflection": {
    "type": "crux" | "assumption_check" | "reasoning_audit",
    "crux_condition": "what would change my mind",
    "assumption_examined": "the shared premise, if applicable",
    "conclusion": "whether this changes my current argument"
  },
  "statement": "..."
}
```

**Side effect:** A `crux_condition` response creates a high-value AN node
tagged as a crux — a claim that, if resolved, would shift the debate's
structure. These crux nodes are prioritized in the moderator's subsequent
focus_point selection and in the unanswered claims ledger.

**Phase affinity:** Mid-exploration (rounds 4-N-2). Too early and positions
haven't developed enough to reflect on. Too late and there's no time to
act on what the reflection reveals. Not appropriate in synthesis (COMMIT
handles final-position extraction).

---

### Family 6: Synthesis — "Let's Converge"

Synthesis moves push the debate toward resolution. They compress sprawling
arguments into sharp positions and extract explicit commitments that can be
compared across debaters.

#### COMPRESS — "Give Me Your Strongest Reason"

**Trigger:** A debater's turn exceeds a length threshold (>800 words in DETAIL
tier) AND their `engagement_depth.targeted_ratio` is below 0.3 — they're
writing a lot but not engaging with opponents.

**Also triggers on:** Synthesis phase, unconditionally for each debater's final
turn — forces a sharp closing.

**Moderator output:**
```
[MODERATOR] {Debater}, in one sentence: what is the single most important
reason the audience should find your position more compelling than
{opponent}'s?
```

**Debater constraint:** Must include `compressed_thesis`:
```json
{
  "compressed_thesis": "single sentence, max 40 words",
  "statement": "... full response ..."
}
```

**Display:** The `compressed_thesis` renders prominently in the UI — it
becomes the debater's headline position for that round.

#### COMMIT — "Where Do You Actually Stand?"

**Trigger:** Synthesis phase, fires once per debater, unconditionally. This
is the closing-commitment move — every debater must make an explicit,
structured statement of their final position.

**Synthesis round guarantee:** The engine ensures that synthesis phase
contains exactly 3 rounds (one per debater). The responder selection for
synthesis rounds is deterministic: each debater speaks exactly once, in
the order of their first appearance. The moderator's Stage 1 selection
is overridden for these rounds — COMMIT fires automatically, and the
`responder` is set by the engine. This means `totalRounds` must account
for synthesis: if the user requests 12 rounds, rounds 10-12 are
synthesis, and rounds 1-9 are available for exploration. The engine
computes `explorationRounds = totalRounds - 3` and uses this for budget
calculation: `ceil(explorationRounds / 2.5)` reactive interventions.

**Also triggers on:** A debater has used ≥3 CONDITIONAL-AGREE moves across
the debate without ever stating which conditions they consider met.

**Moderator output:**
```
[MODERATOR] {Debater}, final positions. State clearly:
1. What you conceded during this debate.
2. What conditions would change your remaining position.
3. Your single sharpest remaining disagreement with each opponent.
```

**Debater constraint:** Must include `commitment`:
```json
{
  "commitment": {
    "concessions": ["list of conceded points"],
    "conditions_for_change": ["if X then I would Y"],
    "sharpest_disagreements": {
      "{opponent_1}": "the crux disagreement",
      "{opponent_2}": "the crux disagreement"
    }
  },
  "statement": "..."
}
```

**AN side effect:** Each `concession` creates an explicit support edge from
this debater to the opponent's claim. Each `sharpest_disagreement` creates
a highlighted attack edge. These are the highest-confidence edges in the AN
because they come from explicit self-report rather than extraction inference.

---

## Family Balance and Register Shifting

A key design principle: **the moderator should alternate between registers,
not default to one.** A debate that receives only Elicitation moves feels
like an interrogation. One that receives only Reconciliation moves feels
like a support group. The moderator's prompt must be aware of the recent
intervention history and actively balance pressure with support.

### Recommended Register Pattern

The moderator's intervention selection should follow a soft preference:

1. **After an Elicitation move (PIN, PROBE, CHALLENGE):** the next
   intervention should prefer Reconciliation or Repair. The debater was
   just pressured; if they respond well, acknowledge it.

2. **After a Reconciliation move (ACKNOWLEDGE, REVOICE):** the next
   intervention can be Elicitation or Procedural. The debater was just
   supported; now hold them to a higher standard.

3. **Procedural moves (REDIRECT, BALANCE, SEQUENCE) are register-neutral:**
   they can follow or precede any family without tonal dissonance.

4. **Reflection moves (META-REFLECT) are register-neutral but
   temporally bounded:** they fit between pressure and support, inviting
   introspection without attacking or praising. They can follow any family
   without tonal dissonance, but are restricted to mid-exploration
   (rounds 4 through N-2) where positions are established enough to
   reflect on but not yet calcified.

5. **Synthesis moves (COMPRESS, COMMIT) are phase-terminal:** they
   appear only in the final rounds and override register preferences.

This is implemented as a soft bias in trigger priority, not a hard rule.
If a PIN is urgently warranted (QBAF strength ≥ 0.9 on a missed
concession), it fires regardless of the previous intervention's family.

### Phase Definitions

Phase boundaries are computed from `totalRounds` and are queryable by
the trigger evaluation engine:

```typescript
type DebatePhase = 'thesis-antithesis' | 'exploration' | 'synthesis';

const MIN_TOTAL_ROUNDS = 8;

function getPhase(round: number, totalRounds: number): DebatePhase {
  if (totalRounds < MIN_TOTAL_ROUNDS) {
    throw new ActionableError({
      goal: 'Compute debate phase',
      problem: `totalRounds=${totalRounds} is below minimum ${MIN_TOTAL_ROUNDS}`,
      location: 'getPhase()',
      nextSteps: ['Use at least 8 rounds to guarantee ≥1 thesis-antithesis, ≥2 exploration, and 3 synthesis rounds'],
    });
  }

  const synthesisStart = totalRounds - 2;  // last 3 rounds are synthesis
  const explorationStart = Math.ceil(totalRounds * 0.25);  // first ~25% is thesis-antithesis

  if (round >= synthesisStart) return 'synthesis';
  if (round < explorationStart) return 'thesis-antithesis';
  return 'exploration';
}

// For a 12-round debate: rounds 0-2 = thesis-antithesis, 3-9 = exploration, 10-12 = synthesis
// For an 8-round debate:  rounds 0-1 = thesis-antithesis, 2-5 = exploration, 6-8 = synthesis
// Minimum 8 rounds ensures: ≥2 thesis-antithesis, ≥2 exploration, 3 synthesis
```

Phase transitions are logged in diagnostics. SUMMARIZE's periodic trigger
fires at the boundary between thesis-antithesis and exploration, and at
the midpoint of exploration.

### Phase × Family Matrix

| Phase | Primary families | Secondary | Avoided |
|---|---|---|---|
| Thesis-antithesis | Procedural, Repair | Reconciliation | Elicitation, Reflection (too early) |
| Early exploration | Elicitation, Repair | Procedural | Synthesis, Reflection (too early) |
| Mid exploration | All families balanced (Reflection peaks here) | — | — |
| Late exploration | Elicitation, Reconciliation | Repair, Reflection | Procedural (too late to redirect) |
| Synthesis | Synthesis, Reconciliation | — | Procedural, Reflection (COMMIT handles final positions) |

---

## Trigger Priority and Rate Limiting

### Priority: Prerequisite Graph, Then Default Ordering

A static priority list (PIN always beats CLARIFY) is operationally simple
but dialectically wrong in some cases. You cannot pin down a statement whose
terms are still wobbling. A seemingly evasive answer may actually reflect
unresolved ambiguity — CLARIFY should precede PIN. A CHALLENGE after a
concession is counterproductive — ACKNOWLEDGE should come first.

Priority is therefore resolved in two stages:

**Stage 1 — Prerequisite check.** Before applying the default priority
ranking, evaluate whether any triggered move has an unmet prerequisite.
If so, the prerequisite move takes priority regardless of default rank.

**Prerequisite rules are totally ordered** — when multiple prerequisites
are active simultaneously, the highest-priority prerequisite wins:

| Priority | If this condition holds... | ...then this move takes priority | Rationale |
|---|---|---|---|
| **P1** | Concession just occurred this round (`concession_opportunity.outcome === 'taken'`) | ACKNOWLEDGE before any further pressure | Time-sensitive: concessions expire. If unacknowledged, debater may walk back next round. ACKNOWLEDGE is also exempt from cooldown and gap rules. |
| **P2** | Semantic divergence is high (≥2 debaters using same term with different definitions, detected via scope mismatch on attack edges) | REPAIR (CLARIFY, CHECK) before ELICITATION (PIN, PROBE) | Conditions persist: the undefined term will still be undefined next round. |
| **P3** | Misunderstanding detected (attack edges with low warrant quality, embedding sim < 0.3 between attacking claim and target) | CHECK before CHALLENGE | Conditions persist: the strawman attack will still be in the AN next round. |

The total ordering resolves the deadlock case: if semantic divergence AND
a concession occur in the same round, ACKNOWLEDGE (P1) fires — it's
time-sensitive. The REPAIR condition (P2) persists and will fire next
round when the cooldown allows.

**ACKNOWLEDGE exemption:** ACKNOWLEDGE is exempt from the prerequisite
system entirely. It fires whenever its trigger conditions are met,
regardless of other active prerequisites, because its value decays
fastest. An unacknowledged concession teaches the debater that conceding
gains nothing — the exact failure mode the Reconciliation family was
designed to prevent.

Think of this as an intervention dependency graph: certain moves are
prerequisites for others. A PIN on an undefined term produces a
meaningless commitment. A CHALLENGE after an unacknowledged concession
teaches the debater that conceding gains nothing.

**Stage 2 — Default priority.** After prerequisite moves are resolved,
remaining triggers are ranked by default priority (highest first):

1. **COMMIT** (synthesis phase only, mandatory)
2. **PIN** (evasion of direct question)
3. **CHALLENGE** (contradiction or stagnation)
4. **CHECK** (active misunderstanding)
5. **ACKNOWLEDGE** (concession just taken — time-sensitive)
6. **REVOICE** (important point being missed — time-sensitive)
7. **REDIRECT** (topic coverage gap)
8. **PROBE** (unsupported claim)
9. **META-REFLECT** (no cruxes identified, shared assumptions unexamined)
10. **CLARIFY** (vague term)
11. **BALANCE** (participation imbalance)
12. **COMPRESS** (sprawling turn)
13. **SEQUENCE** (entangled sub-topics)
14. **SUMMARIZE** (periodic checkpoint)

### Rate Limiting Rules

1. **At most one intervention per round.** Interventions are moderator
   turns; more than one per round dominates the debate.

2. **No back-to-back interventions on the same debater** (except
   ACKNOWLEDGE, which is supportive and not burdensome).

3. **Minimum 1 unmoderated round between interventions** (configurable).
   Debaters need room to develop arguments naturally.

4. **Reconciliation moves are exempt from the gap rule.** An ACKNOWLEDGE
   can follow immediately after a Elicitation move because it rewards
   compliance rather than adding pressure.

5. **Intervention budget:** Maximum `ceil(totalRounds / 2.5)` *reactive*
   interventions per debate. **COMMIT is off-budget** — it fires
   unconditionally for each debater in synthesis (up to 3 times) and is
   structural, not diagnostic. Without this exemption, a 12-round debate
   gets a budget of 5, COMMIT consumes 3 of them, and only 2 slots remain
   for reactive moves — too thin to cover the six other families. The
   expanded taxonomy provides *variety*, not *volume*.

6. **Burden-weighted balance:** Balance by count is a crude metric — one
   CHALLENGE exerts more cognitive pressure than three ACKNOWLEDGEs. Each
   family carries a burden weight reflecting actual pressure on debaters:

   | Family | Burden weight | Rationale |
   |---|---|---|
   | Procedural | 0.5 | Redirects attention, minimal response burden |
   | Repair | 0.75 | Requires clarification effort |
   | Reconciliation | 0.25 | Supportive, no forced response |
   | Elicitation | 1.0 | Maximum pressure, forced structured response |
   | Reflection | 0.6 | Moderate effort (introspection without adversarial pressure) |
   | Synthesis | 0.8 | High effort (compression, commitment) |

   **These weights are initial estimates, not empirically derived.** The
   calibration plan: run 10+ debates with uniform weights (all 1.0), then
   measure per-intervention response quality (substantive rate from
   diagnostics) and follow-through persistence. Interventions that produce
   high-quality responses at low debater resistance are low-burden; those
   that produce defensive or shallow responses are high-burden. Derive
   weights from the observed response-quality distribution. Until
   calibration data exists, treat these values as hypotheses subject to
   revision — the diagnostics system captures all the data needed to
   compute empirical weights post-hoc.

   Balance is tracked as **cumulative burden per debater**, not count per
   family. A debater whose cumulative burden exceeds 1.5× the per-debater
   average gets a raised threshold (harder to trigger further interventions
   on them). This is a soft diagnostic flag, not a hard constraint — it
   surfaces in the moderator diagnostics panel (see
   [moderator-diagnostics.md](./moderator-diagnostics.md)).

---

## Implementation Approach

> **Type authority:** This document is the canonical source for all moderator
> type definitions (`ModeratorState`, `SelectionResult`, `EngineValidationResult`,
> `ModeratorIntervention`, `DebateTurnResponse`, `ANMutation`, `DebateHealthScore`,
> `TranscriptEntry` extensions). The companion
> [moderator-diagnostics.md](./moderator-diagnostics.md) defines diagnostics-only
> types (`ModeratorRoundDiagnostics`, `InterventionOutcome`, `NearMiss`,
> `ModeratorSessionDiagnostics`) that reference types defined here. When a field
> appears in both documents, this document's definition is authoritative.

### Moderator state (new per-debate mutable state)

The engine maintains a `ModeratorState` object across rounds, alongside
the existing `argument_network`, `transcript`, and `commitments`. This
is the single source of truth for all moderator-related state.

```typescript
interface ModeratorState {
  // Budget and pacing
  interventions_fired: number;       // reactive only (COMMIT excluded)
  budget_total: number;              // ceil(explorationRounds / 2.5)
  budget_remaining: number;
  rounds_since_last_intervention: number;
  required_gap: number;              // escalating: 1 → 1 → 2 → 2 (cap)
  last_target: PoverId | null;
  last_family: InterventionFamily | null;

  // Burden tracking
  burden_per_debater: Record<PoverId, number>;  // cumulative burden weight
  avg_burden: number;                            // mean across debaters

  // Adaptive persona modifiers
  persona_trigger_counts: Record<PoverId, Partial<Record<InterventionMove, number>>>;
  // Incremented each time a signal crosses 80% of effective threshold
  // (near-miss or fire) for a given debater × move combination.
  // Used by adaptiveModifier() to decay priors toward 1.0.

  // Health score trajectory
  health_history: DebateHealthScore[];  // one per round
  consecutive_decline: number;
  consecutive_rise: number;
  trajectory_freeze_until: number;     // round until which consecutive_decline is frozen

  // SLI floor breach tracking
  sli_consecutive_breaches: Record<string, number>;  // per-component, reset on recovery

  // Phase
  phase: DebatePhase;
  round: number;
  total_rounds: number;
  exploration_rounds: number;         // total_rounds - 3 (synthesis reserved)

  // Intervention history (for diagnostics and register shifting)
  intervention_history: {
    round: number;
    move: InterventionMove;
    family: InterventionFamily;
    target: PoverId;
    burden: number;
  }[];

  // Cooldown conflict tracking
  cooldown_blocked_count: number;
}
```

This state is initialized at debate start (`initModeratorState(totalRounds)`)
and mutated after each round's intervention decision. It is persisted in
`session.moderator_state` alongside the existing session fields.

### Changes to moderator output schema (types.ts)

```typescript
type InterventionFamily =
  | 'procedural'
  | 'elicitation'
  | 'repair'
  | 'reconciliation'
  | 'reflection'
  | 'synthesis';

type InterventionMove =
  // Procedural
  | 'REDIRECT' | 'BALANCE' | 'SEQUENCE'
  // Elicitation
  | 'PIN' | 'PROBE' | 'CHALLENGE'
  // Repair
  | 'CLARIFY' | 'CHECK' | 'SUMMARIZE'
  // Reconciliation
  | 'ACKNOWLEDGE' | 'REVOICE'
  // Reflection
  | 'META-REFLECT'
  // Synthesis
  | 'COMPRESS' | 'COMMIT';

const MOVE_TO_FAMILY: Record<InterventionMove, InterventionFamily> = {
  REDIRECT: 'procedural', BALANCE: 'procedural', SEQUENCE: 'procedural',
  PIN: 'elicitation', PROBE: 'elicitation', CHALLENGE: 'elicitation',
  CLARIFY: 'repair', CHECK: 'repair', SUMMARIZE: 'repair',
  ACKNOWLEDGE: 'reconciliation', REVOICE: 'reconciliation',
  'META-REFLECT': 'reflection',
  COMPRESS: 'synthesis', COMMIT: 'synthesis',
};

type InteractionalForce =
  | 'directive'       // commands action or topic shift
  | 'interrogative'   // demands an answer
  | 'declarative'     // states a moderator observation
  | 'reflective';     // invites self-examination

const FAMILY_BURDEN_WEIGHT: Record<InterventionFamily, number> = {
  procedural: 0.5,
  elicitation: 1.0,
  repair: 0.75,
  reconciliation: 0.25,
  reflection: 0.6,
  synthesis: 0.8,
};

interface ModeratorIntervention {
  family: InterventionFamily;
  move: InterventionMove;
  force: InteractionalForce;       // descriptive annotation
  burden: number;                   // FAMILY_BURDEN_WEIGHT[family]
  target_debater: PoverId;
  text: string;
  original_claim_text?: string;     // for REVOICE: preserved original wording
  trigger_reason: string;
  prerequisite_applied?: string;    // which prerequisite rule overrode default priority
  source_evidence: {
    signal?: string;
    node_id?: string;
    round?: number;
    claim?: string;
  };
}

interface CrossRespondSelection {
  responder: string;
  addressing: string;
  focus_point: string;
  agreement_detected: boolean;
  metaphor_reframe?: string;
  intervention?: ModeratorIntervention;
}
```

### Changes to debater turn schema (types.ts)

```typescript
interface DebateTurnResponse {
  statement: string;
  turn_symbols: { symbol: string; tooltip: string }[];
  taxonomy_refs: { node_id: string; relevance: string }[];

  // Elicitation responses
  pin_response?: {
    position: 'agree' | 'disagree' | 'conditional';
    condition?: string;
    brief_reason: string;
  };
  probe_response?: {
    evidence_type: 'empirical' | 'precedent' | 'theoretical' | 'conceded_gap';
    evidence: string;
    critical_question_addressed?: string;
  };
  challenge_response?: {
    type: 'evolved' | 'consistent' | 'conceded';
    explanation: string;
  };

  // Repair responses
  clarification?: {
    term: string;
    definition: string;
    example: string;
  };
  check_response?: {
    understood_correctly: boolean;
    actual_target?: string;
    revised_response?: string;
  };

  // Reconciliation responses
  revoice_response?: {
    accurate: boolean;
    correction?: string;
  };

  // Reflection responses
  reflection?: {
    type: 'crux' | 'assumption_check' | 'reasoning_audit';
    crux_condition?: string;
    assumption_examined?: string;
    conclusion: string;
  };

  // Synthesis responses
  compressed_thesis?: string;
  commitment?: {
    concessions: string[];
    conditions_for_change: string[];
    sharpest_disagreements: Record<string, string>;
  };
}
```

### Changes to prompts.ts: Two-Stage Moderator Prompts

**Stage 1 output schema (`SelectionResult`):**

```typescript
interface SelectionResult {
  responder: PoverId;
  addressing: PoverId | 'general';
  focus_point: string;
  agreement_detected: boolean;
  metaphor_reframe?: string;

  // Intervention recommendation (advisory — engine validates)
  intervene: boolean;
  suggested_move?: InterventionMove;
  target_debater?: PoverId;
  trigger_reasoning?: string;       // why the LLM thinks intervention is warranted
  trigger_evidence?: {
    signal_name: string;
    observed_behavior: string;       // what the LLM observed in the transcript
    source_claim?: string;           // specific claim text referenced
    source_round?: number;
  };
}
```

**Stage 1 prompt (`moderatorSelectionPrompt`):** Same as today's
`crossRespondSelectionPrompt`, with an added assessment section:

```
INTERVENTION ASSESSMENT:
After selecting the next responder, evaluate whether an intervention is
warranted. The engine has pre-computed the following context for you:

{triggerEvaluationContext}
  // Contains: all signal values, health score, burden per debater,
  // intervention history, phase, prerequisite conditions

Based on this context and your reading of the transcript, recommend
whether to intervene. If so, suggest which move and which debater to
target, and explain why.

Your recommendation is ADVISORY. The engine will validate it against
budget, cooldown, phase rules, and prerequisites before acting. If the
engine overrides you, the debate continues without intervention.

Do NOT compose the intervention text — that is a separate stage.
Do NOT intervene just because you can.

Respond with the SelectionResult schema.
```

**NOTE:** Near-miss detection is NOT part of the LLM prompt. Asking the
LLM to introspect on "what almost fired" invites confabulation.
Near-misses are computed DETERMINISTICALLY by the engine after Stage 1
returns, by comparing each trigger's signal value against its effective
threshold and flagging those at ≥ 80%.

**Engine validation (between Stage 1 and Stage 2):**

```typescript
interface EngineValidationResult {
  proceed: boolean;
  validated_move: InterventionMove;   // may differ from suggested_move
  validated_family: InterventionFamily;
  validated_target: PoverId;
  suppressed_reason?: string;        // 'budget_exhausted' | 'cooldown_active'
                                      // | 'phase_mismatch' | 'same_debater_consecutive'
                                      // | 'prerequisite_override' | 'burden_cap'
                                      // | 'engine_override' (bad Stage 1 output)
  prerequisite_applied?: string;      // if prerequisite graph changed the move
}

function validateRecommendation(
  selection: SelectionResult,
  state: ModeratorState
): EngineValidationResult {
  // 1. Reject if Stage 1 output is malformed
  if (!isValidMove(selection.suggested_move)) return suppress('engine_override');

  // 2. Check budget (COMMIT is off-budget)
  if (selection.suggested_move !== 'COMMIT' && state.budget_remaining <= 0)
    return suppress('budget_exhausted');

  // 3. Check cooldown (Reconciliation exempt)
  const family = MOVE_TO_FAMILY[selection.suggested_move];
  if (family !== 'reconciliation' && state.rounds_since_last < state.required_gap)
    return suppress('cooldown_active');

  // 4. Check phase appropriateness
  if (!isPhaseAppropriate(selection.suggested_move, state.phase))
    return suppress('phase_mismatch');

  // 5. Check same-debater consecutive rule
  if (state.last_target === selection.target_debater
      && family !== 'reconciliation')
    return suppress('same_debater_consecutive');

  // 6. Apply prerequisite graph — may change the move
  const prerequisiteResult = applyPrerequisites(selection.suggested_move, state);
  const finalMove = prerequisiteResult.overridden_move ?? selection.suggested_move;

  // 7. Check burden cap
  if (state.burden[selection.target_debater] > state.avg_burden * 1.5
      && FAMILY_BURDEN_WEIGHT[MOVE_TO_FAMILY[finalMove]] > 0.5)
    return suppress('burden_cap');

  return { proceed: true, validated_move: finalMove, ... };
}
```

**Stage 2 prompt (`moderatorInterventionPrompt`):** Only invoked when
the engine validation returns `proceed: true`. Receives the *engine-
validated* move (which may differ from Stage 1's suggestion if the
prerequisite graph overrode it):

```
You are composing a moderator intervention.

Move: {validated_move} (family: {validated_family})
Target: {validated_target}
Trigger: {trigger_evidence from Stage 1}
Original claim (if applicable): {source_claim}

Compose the intervention text. You are procedurally authoritative.
Describe what happened in the debate in terms of observable state
(who said what, who evaded what, what topics were covered). Do not
evaluate whether an argument is good, strong, correct, or compelling.

For REVOICE: restate the original claim in plain language. The system
will verify propositional preservation (taxonomy anchors + entity
retention) before insertion.

For CHECK: use a DIRECT QUOTE from the target debater's transcript,
not a paraphrase. The moderator's own paraphrase inside a CHECK would
be a secondary source of misunderstanding.

Respond with:
{
  "text": "the intervention text",
  "original_claim_text": "for REVOICE only: the verbatim original claim"
}
```

This separation means Stage 1 can be optimized for structured JSON output
(low temperature, fast model) while Stage 2 can use a higher temperature
for natural-sounding intervention text. If Stage 2 fails (parse error,
timeout), the round proceeds with no intervention.

### Changes to debateEngine.ts (run loop)

```typescript
// Pseudocode for modified round loop:

for each round:
  // 1. Engine pre-computes trigger context (deterministic)
  triggerContext = computeTriggerEvaluationContext(session)

  // 2. Stage 1: LLM recommends (advisory)
  selectionResult = await moderatorSelection(triggerContext, transcript)

  // 3. Engine validates recommendation (deterministic)
  validation = validateRecommendation(selectionResult, moderatorState)

  // 4. Record all trigger evaluations for diagnostics (deterministic)
  diagnostics = computeRoundDiagnostics(triggerContext, selectionResult, validation)

  let intervention: ModeratorIntervention | undefined

  if (validation.proceed):
    // 5. Stage 2: LLM composes intervention text
    try:
      stage2Result = await moderatorGeneration(validation, triggerContext)

      // 6. Post-generation gates (deterministic)
      if (validation.validated_move === 'REVOICE'):
        if (!passesProposionalGate(stage2Result, triggerContext)):
          // Downgrade to CHECK — re-run Stage 2 with CHECK
          validation.validated_move = 'CHECK'
          stage2Result = await moderatorGeneration(validation, triggerContext)

      // 7. Build intervention object
      intervention = buildIntervention(validation, stage2Result)

      // 8. Add moderator intervention as visible transcript entry
      addTranscriptEntry({
        speaker: 'moderator',     // new speaker type, not a PoverId
        type: 'intervention',
        family: intervention.family,
        move: intervention.move,
        content: intervention.text,
        metadata: { trigger_reason, source_evidence, diagnostics }
      })
    catch:
      // Stage 2 failed — debate continues without intervention
      diagnostics.stage2_failure = true

  // 9. Inject constraint into debater's BRIEF stage
  briefContext.moderator_intervention = intervention  // undefined if no intervention

  // 10. Run debater turn pipeline as usual
  debaterTurn = await runTurnPipeline(...)

  // 11. Judge validates — with family-appropriate compliance check
  turnValidation = await validateTurn(debaterTurn, {
    pending_intervention: intervention
  })

  // 12. Compute intervention outcome (backfill, if intervention existed)
  if (intervention):
    outcome = computeInterventionOutcome(intervention, debaterTurn)
    backfillDiagnostics(diagnostics, outcome)

  // 13. Apply AN side effects from intervention response (provisional)
  if (intervention && turnValidation.outcome !== 'retry'):
    applyProvisionalSideEffects(intervention, debaterTurn, session.argument_network)

  // 14. Update moderator state for next round
  updateModeratorState(moderatorState, intervention, validation, round)
```

### Moderator state updates (per round)

After each round, the engine updates `ModeratorState` to reflect the
intervention decision. This is the single place where pacing, cooldown,
burden, and persona tracking advance.

```typescript
function updateModeratorState(
  state: ModeratorState,
  intervention: ModeratorIntervention | undefined,
  validation: EngineValidationResult,
  round: number
): void {
  state.round = round;
  state.phase = getPhase(round, state.total_rounds);

  if (intervention) {
    const family = MOVE_TO_FAMILY[intervention.move];
    const isBudgeted = intervention.move !== 'COMMIT';

    if (isBudgeted) {
      state.interventions_fired++;
      state.budget_remaining = state.budget_total - state.interventions_fired;
    }

    // Escalating cooldown (see Risk 1 table)
    if (family !== 'reconciliation') {
      state.required_gap = state.interventions_fired >= 2 ? 2 : 1;
    }

    state.rounds_since_last_intervention = 0;
    state.last_target = intervention.target_debater;
    state.last_family = family;

    // Burden tracking
    const burden = FAMILY_BURDEN_WEIGHT[family];
    state.burden_per_debater[intervention.target_debater] += burden;
    const burdens = Object.values(state.burden_per_debater);
    state.avg_burden = burdens.reduce((a, b) => a + b, 0) / burdens.length;

    // Post-intervention trajectory freeze (anti-death-spiral)
    state.trajectory_freeze_until = round + 1;

    // Intervention history
    state.intervention_history.push({
      round, move: intervention.move, family, target: intervention.target_debater, burden,
    });
  } else {
    state.rounds_since_last_intervention++;
  }

  // Cooldown conflict tracking
  if (!validation.proceed && validation.suppressed_reason === 'cooldown_active') {
    state.cooldown_blocked_count++;
  }

  // Health trajectory (health_history updated by computeDebateHealthScore)
  if (state.health_history.length >= 2) {
    const curr = state.health_history[state.health_history.length - 1];
    const prev = state.health_history[state.health_history.length - 2];
    if (curr.value < prev.value) {
      // Trajectory freeze: don't increment consecutive_decline if frozen
      if (round <= state.trajectory_freeze_until) {
        // Freeze active — hold consecutive_decline at current value
      } else {
        state.consecutive_decline++;
      }
      state.consecutive_rise = 0;
    } else if (curr.value > prev.value) {
      state.consecutive_rise++;
      state.consecutive_decline = 0;
    } else {
      state.consecutive_decline = 0;
      state.consecutive_rise = 0;
    }
  }

  // Harden provisional AN mutations from round - 2 (survived 1 round without contradiction)
  hardenProvisionalMutations(state.round);
}

function initModeratorState(totalRounds: number): ModeratorState {
  const explorationRounds = totalRounds - 3;
  return {
    interventions_fired: 0,
    budget_total: Math.ceil(explorationRounds / 2.5),
    budget_remaining: Math.ceil(explorationRounds / 2.5),
    rounds_since_last_intervention: 0,
    required_gap: 1,
    last_target: null,
    last_family: null,
    burden_per_debater: { prometheus: 0, sentinel: 0, cassandra: 0 },
    avg_burden: 0,
    persona_trigger_counts: { prometheus: {}, sentinel: {}, cassandra: {} },
    health_history: [],
    consecutive_decline: 0,
    consecutive_rise: 0,
    trajectory_freeze_until: -1,
    sli_consecutive_breaches: {},
    phase: 'thesis-antithesis',
    round: 0,
    total_rounds: totalRounds,
    exploration_rounds: explorationRounds,
    intervention_history: [],
    cooldown_blocked_count: 0,
  };
}
```

### Provisional AN side effects

Seven of the 14 moves produce AN side effects that feed back into
subsequent trigger evaluations. These side effects modify the same
Argument Network that the trigger conditions read from, creating a
feedback loop: a corrupt or misclassified side effect from round N
propagates into round N+1's trigger evaluation.

**The risk:** A debater's `conceded_gap` response may be formally
compliant but substantively wrong (they evaded, not conceded). The 0.7×
QBAF penalty is applied to the node, making it appear weaker, potentially
triggering further PROBE or REDIRECT away from it — all based on a
false concession. There is no rollback mechanism in the current AN.

**Resolution: provisional mutations.** AN mutations sourced from
intervention responses are tagged as provisional and excluded from
trigger evaluation for 1 round. If no contradiction appears in the
next round (no debater challenges the mutation), they harden into
permanent state. If a contradiction appears, the provisional mutation
is discarded.

```typescript
interface ANMutation {
  type: 'add_edge' | 'remove_edge' | 'modify_strength' | 'add_node' | 'add_flag';
  source: 'claim_extraction' | 'intervention_response';
  provisional: boolean;         // true for intervention_response, false for claim_extraction
  provisional_round?: number;   // round when the mutation was created
  hardened: boolean;             // set to true after 1 round without contradiction
}

// During trigger evaluation:
function getEffectiveAN(an: ArgumentNetwork, currentRound: number): ArgumentNetwork {
  // Filter out provisional mutations from the current round
  // (they haven't had a chance to be contradicted yet)
  return an.filter(mutation =>
    !mutation.provisional || mutation.hardened || mutation.provisional_round < currentRound - 1
  );
}
```

**Which moves produce which mutations:**

| Move | Mutation type | Provisional? |
|---|---|---|
| PIN | New support/attack edge from `pin_response` | Yes |
| PROBE | Support edge or QBAF penalty from `probe_response` | Yes |
| CHALLENGE | Concession/clarification edge from `challenge_response` | Yes |
| CLARIFY | New i-node from `clarification` | Yes |
| CHECK | Edge reclassification/removal from `check_response` | Yes |
| ACKNOWLEDGE | `moderator_highlighted` flag | No (flag only, no structural change) |
| META-REFLECT | New crux node from `reflection` | Yes |
| REVOICE | `revoice_of` edge (only if confirmed) | No (confirmation is the validation) |
| COMPRESS/COMMIT | Summary/commitment nodes | No (synthesis is final) |

### Transcript entry type extension

The existing `TranscriptEntry` uses `speaker: PoverId`. Moderator entries
require a type extension:

```typescript
type TranscriptSpeaker = PoverId | 'moderator';

interface TranscriptEntry {
  speaker: TranscriptSpeaker;
  type: 'opening' | 'statement' | 'synthesis' | 'intervention';
  // ... existing fields ...
  intervention_metadata?: {
    family: InterventionFamily;
    move: InterventionMove;
    force: InteractionalForce;
    burden: number;
    target_debater: PoverId;
    trigger_reason: string;
    source_evidence: { signal?: string; node_id?: string; round?: number; claim?: string };
  };
}
```

Convergence signal computation must filter `speaker === 'moderator'`
entries — they are not debater turns and should not be counted in
engagement depth, recycling rate, or position drift calculations.
Context compression should preserve moderator entries (they're short
and structurally important) but may summarize them in the compression
window.

### How the debater sees the intervention (BRIEF injection)

**Decision: debaters see the move type tag.** (Resolves Open Question #2.)

The alternative — hiding the move type and relying on the judge to
infer compliance expectations from natural language — adds substantial
implementation complexity for marginal benefit. The debaters are LLMs
with structured output; they need to know which response field to
include. The "mechanical structure leak" concern is moot because the
debaters are not adversaries trying to game the system — they are
prompted agents whose compliance we want to maximize.

The BRIEF stage receives:

```
MODERATOR INTERVENTION (this round):
The moderator has addressed you with a {move} [{family}] intervention.

Moderator's text:
"{intervention.text}"

You MUST include a `{response_field}` field in your response JSON.
Schema: {response_schema}

After addressing the moderator's intervention, continue with your
substantive argument in the `statement` field.
```

Where `{response_field}` and `{response_schema}` are looked up from
the move type (e.g., PIN → `pin_response` → `{ position, condition?,
brief_reason }`). This is deterministic template expansion, not LLM
generation.

### Changes to turnValidator.ts (judge)

Add a fifth validation dimension: **compliance**. When an intervention
preceded this turn, check based on the move type:

**Hard compliance (retry if missing):**
- PIN → `pin_response` field exists and has a `position` value
- PROBE → `probe_response` field exists with non-empty `evidence`
- CHALLENGE → `challenge_response` field exists
- CLARIFY → `clarification` field exists with non-empty `definition`
- CHECK → `check_response` field exists
- COMPRESS → `compressed_thesis` field exists and is ≤ 50 words
- COMMIT → `commitment` field exists with all sub-fields
- REVOICE → `revoice_response` field exists
- META-REFLECT → `reflection` field exists with non-empty `conclusion`

**No compliance check (supportive/procedural — no forced format):**
- ACKNOWLEDGE, BALANCE, REDIRECT, SEQUENCE, SUMMARIZE

**Formally-compliant evasion detection (Stage B extension):**

Hard compliance enforces *form* — the required field exists with valid
structure. It cannot enforce *substance* without reintroducing LLM
judgment in a load-bearing position. Instead, the existing Stage B
validation heuristics are extended to flag evasion patterns:

- PIN with `position: 'conditional'` where the `condition` has low
  specificity (no proper nouns, numbers, or measurable thresholds) →
  `substantive: false` flag in diagnostics
- PROBE with `evidence_type: 'theoretical'` and `evidence` containing
  no specific citation (no proper nouns or dates) → flag
- CHALLENGE with `type: 'consistent'` and `explanation` that doesn't
  reference the specific prior claim cited by the moderator → flag
- META-REFLECT with `crux_condition` containing only generic hedges
  ("more evidence," "further research") → flag

These flags surface in the diagnostics as `formally_compliant_evasion`
counts, enabling threshold tuning without adding LLM judge calls.

### Changes to DebateWorkspace.tsx (renderer)

Moderator interventions render as a distinct visual element between
debate turns:

- Background color varies by family:
  - Procedural: neutral gray
  - Elicitation: warm amber
  - Repair: cool blue
  - Reconciliation: soft green
  - Reflection: soft purple
  - Synthesis: gold
- Speaker label: "MODERATOR"
- Family badge + move type (e.g., "ELICITATION · PIN")
- The text of the intervention

Debater responses to interventions render their structured fields
(pin_response, clarification, etc.) as a highlighted block above the
main statement.

---

## What This Gives Us

### Debate Quality: Pressure + Support

The original design produced debates under pressure — debaters would be
pinned, confronted, and compressed. This is half the picture. The revised
design adds the other half:

- **ACKNOWLEDGE** counteracts sycophancy by making concession a *visible,
  valued* move. When Sentinel concedes that Prometheus has a point about
  iteration speed, the moderator publicly marks it. This creates social
  pressure (even among LLMs) to treat concessions as commitments rather
  than throwaway gestures that can be walked back.

- **REVOICE** bridges rhetorical registers. When Prometheus makes a subtle
  point about deployment infrastructure in accelerationist jargon, and
  Sentinel and Cassandra talk past it, the moderator restates it in neutral
  language. Now all three agents can engage with the actual substance.

- **CHECK** prevents phantom disagreements. LLM debates frequently produce
  attack edges between claims that don't actually conflict — the debaters
  are arguing about different things. CHECK makes the misunderstanding
  visible and correctable.

- **BALANCE** ensures Cassandra (the skeptic, structurally disadvantaged
  because both other debaters have stronger advocacy positions) gets
  adequate airtime and isn't perpetually on defense.

- **SUMMARIZE** provides periodic anchoring. As the transcript grows and
  context compression kicks in, debaters lose track of what's been
  established. The moderator's summary is a shared reference point.

### Convergence Signal Utilization (Expanded)

| Signal | Current use | With full taxonomy |
|---|---|---|
| Recycling rate | Displayed | Triggers CHALLENGE (stagnation) |
| Position drift | Displayed | Triggers CHALLENGE (contradiction) |
| Concession opportunity (missed) | Displayed | Triggers PIN |
| Concession opportunity (taken) | Displayed | **Triggers ACKNOWLEDGE** |
| Engagement depth | Displayed | Triggers COMPRESS (low), **BALANCE** (asymmetric) |
| Move disposition | Displayed | Triggers REDIRECT, **informs register shifting** |
| Strongest opposition | Displayed | Provides CHALLENGE source evidence |
| Crux rate | Displayed | Informs PIN targeting, **PROBE** for ungrounded cruxes, **META-REFLECT** when cumulative_count === 0 |

The key additions are in bold: concession-taken drives ACKNOWLEDGE,
engagement asymmetry drives BALANCE, and move disposition informs the
register-shifting logic.

### Argument Network Enrichment (Expanded)

| Move | AN contribution |
|---|---|
| PIN | Forced positions → clean support/attack edges |
| PROBE | Evidence citations → support edges or `conceded_gap` penalties |
| CHALLENGE | Position evolution → concession/clarification edges |
| CLARIFY | Operational definitions → new i-nodes |
| CHECK | Misunderstanding correction → reclassified/removed edges |
| ACKNOWLEDGE | Highlighted concessions → `moderator_highlighted` flag |
| REVOICE | Translated claims → register-neutral i-nodes |
| META-REFLECT | Crux conditions → high-value crux nodes prioritized in focus_point selection |
| COMPRESS | Compressed theses → high-salience summary nodes |
| COMMIT | Final positions → highest-confidence support/attack edges |

---

## First-Order Design Risks

Three risks that, if unaddressed, could make the active moderator worse than
the passive one it replaces.

### Risk 1: Over-Intervention — Structure vs. Participant Ownership

The deliberation literature consistently warns that facilitators should intervene
when necessary but not dominate the exchange. A moderator that talks too much
transfers ownership of the discussion from the participants to itself. In our
system, this manifests as debates where the most interesting content comes from
the moderator's framings rather than the debaters' arguments — the moderator
becomes the real author, and the debaters become response generators.

**Mitigations already in the design:**
- Intervention budget: `ceil(totalRounds / 2.5)`, roughly 1 intervention per
  2.5 rounds. A 12-round debate gets at most 5 interventions, leaving 7
  unmoderated rounds.
- Gap rule: minimum 1 unmoderated round between interventions (Reconciliation
  exempt because it adds no burden).
- Reconciliation moves don't demand a response format — they add a sentence
  to the transcript, not a constraint on the next turn.

**Additional safeguard — escalating cooldown:** Instead of asking the moderator
LLM to predict whether the debate would self-correct (an uncomputable
counterfactual — LLMs cannot reliably simulate multi-agent dialogue futures),
we use a deterministic backoff mechanism that increases the gap between
interventions as the moderator becomes more active:

| Interventions fired so far | Minimum gap before next intervention |
|---|---|
| 0 | 1 unmoderated round |
| 1 | 1 unmoderated round |
| 2 | 2 unmoderated rounds |
| 3+ | 2 unmoderated rounds (cap) |

This is computable, testable, and requires no LLM judgment about futures. The
cap at 2 rounds prevents the cooldown from starving the moderator in the back
half of a long debate. Reconciliation moves (ACKNOWLEDGE, REVOICE) remain
exempt from the gap rule because they add no response burden.

The diagnostics system (see [moderator-diagnostics.md](./moderator-diagnostics.md))
captures near-misses and suppression reasons, which lets us audit whether the
cooldown is suppressing too many or too few interventions.

**Metric to watch:** If the ratio of moderator transcript entries to debater
transcript entries exceeds 0.3, the moderator is dominating. The diagnostics
session summary should flag this.

### Risk 2: Attention Bias — Procedural Transparency vs. Substantive Neutrality

In computational dialectics, there is no substantive neutrality when selecting
which claims to acknowledge, revoice, or compress. The act of choosing to
REVOICE one node over another elevates that node's structural importance in
the Argument Network. Choosing to ACKNOWLEDGE one concession and not another
signals which concessions are significant. The moderator's process choices
define the quality of the resulting synthesis — the clean separation between
"process" (moderator) and "quality" (judge) is an abstraction that leaks at
every intervention boundary.

We do not claim neutrality. We claim **procedural transparency**: the
moderator's selection criteria are visible, its decisions are logged with full
provenance, and the diagnostics make the moderator's attention pattern
auditable. The audience can see that REVOICE targeted Prometheus 3 times and
Sentinel once, and judge whether that reflects genuine need or bias.

**The transparency principle:** Moderator interventions must be framed in terms
of *observable debate state* ("you made a concession," "your opponents haven't
addressed this," "you've used this term without defining it"), never
*qualitative judgment* ("this is a strong argument," "this evidence is
compelling"). The distinction:

| Transparent (observable state) | Opaque (qualitative judgment) |
|---|---|
| "You've conceded that X. Does this change the shape of the disagreement?" | "You've rightly conceded that X." |
| "Your claim about X has no supporting evidence cited. Name a source." | "Your claim about X seems unsupported." |
| "Let me restate that: you're saying X." | "That's an important point: X." |
| "You've made this argument three times." | "You're repeating a weak argument." |

**Implementation:** The moderator's system prompt includes an explicit
transparency constraint:

> "You are procedurally authoritative but not substantively neutral — your
> choices about what to highlight, revoice, or challenge are inherently
> selective. You must therefore be transparent: describe what happened in the
> debate (who conceded what, who evaded what, what topics were covered) in
> terms of observable state, not evaluation. You may NOT evaluate whether an
> argument is good, strong, correct, or compelling. The judge handles quality
> assessment. Your job is to make the debate's structure visible and your
> own attention pattern auditable."

**The accountability mechanism:** The diagnostics system (see
[moderator-diagnostics.md](./moderator-diagnostics.md)) serves as the
structural audit for the moderator's attention pattern:
- Per-debater intervention counts and family distributions
- Per-debater cumulative burden
- Which claims were selected for REVOICE/ACKNOWLEDGE vs. which were passed over
- Register alternation patterns (is one debater only receiving pressure?)

This makes the moderator's bias surface *detectable and measurable* rather
than assuming it away with a neutrality claim. A reviewer can see that
Prometheus was challenged 3 times and never acknowledged, and flag this as
an attention imbalance — even if each individual intervention was
trigger-justified.

**The hardest case — REVOICE:** Revoicing inherently involves interpretation,
and LLMs fail at qualitative categorization (the base engine uses a
deterministic `MOVE_EDGE_MAP` for the same reason). REVOICE therefore uses
**architectural controls, not prompt compliance** — see the four-layer
safeguard design in the REVOICE move specification (Family 4). The key
controls are: (1) taxonomy-anchored propositional gate, (2) AN exclusion,
(3) speaker confirmation with forced responder, (4) conditional AN linkage.

**Metrics to watch:** If REVOICE accuracy drops below 80% (more than 1 in 5
are corrected by the debater), the moderator is injecting too much
interpretation. If the propositional gate rejects more than 30% of attempted
revoices, check whether the moderator is failing on entity preservation
(prompt needs tightening) or taxonomy anchor matching (taxonomy coverage
may be insufficient for the debate topic). Both are surfaced in the
diagnostics with per-gate-component breakdowns.

### Risk 3: One-Size-Fits-All — Persona-Aware Intervention

The online moderation literature argues that the same intervention can help one
participant and backfire for another. In our system, the three personas have
fundamentally different rhetorical profiles:

- **Prometheus** (accelerationist): Confident, expansive, prone to hand-waving
  over risks. Benefits most from PIN and PROBE (force specificity). May
  respond poorly to CHECK (perceives it as pedantic).

- **Sentinel** (safetyist): Methodical, evidence-heavy, prone to over-qualifying.
  Benefits most from COMPRESS (force brevity). May respond poorly to CHALLENGE
  (already cautious about position changes; a CHALLENGE may trigger defensive
  over-qualification rather than honest acknowledgment).

- **Cassandra** (skeptic): Structural, contrarian, often the most intellectually
  flexible but also the most likely to be talked over. Benefits most from
  BALANCE and ACKNOWLEDGE (ensure adequate airtime and validate bridge-building).
  May be under-served by PIN (already tends to give nuanced answers rather than
  evasive ones).

**Persona-adapted trigger thresholds (adaptive priors):** Rather than uniform
thresholds, the trigger logic adjusts based on the target persona. But
static modifiers create a structural overfitting problem: if the modifiers
encode what the personas are *supposed* to do, the system is blind to what
they *actually* do. Raising Cassandra's PIN threshold to 1.3 because she
"rarely evades" means that if context forces Cassandra into a corner where
she starts evading, the moderator allows it far longer than it would for
Prometheus — insulating the agent from the dialectical consequences of its
own generated text.

The solution: treat the hardcoded values as **priors** that decay toward
observed behavior over the course of the debate.

```typescript
// Initial priors — informed by persona design, not immutable
const PERSONA_PRIOR_MODIFIERS: Record<PoverId, Partial<Record<InterventionMove, number>>> = {
  prometheus: {
    PIN: 0.85,       // prior: Prometheus evades more
    PROBE: 0.85,     // prior: often under-evidenced
    COMPRESS: 1.15,  // prior: naturally expansive, give more room
  },
  sentinel: {
    COMPRESS: 0.85,  // prior: over-qualifies
    CHALLENGE: 1.2,  // prior: avoid triggering defensive spirals
    ACKNOWLEDGE: 0.85, // prior: concessions are rarer and more meaningful
  },
  cassandra: {
    BALANCE: 0.85,   // prior: structurally disadvantaged
    PIN: 1.3,        // prior: rarely evasive
    ACKNOWLEDGE: 0.85, // prior: bridge-building should be rewarded
  },
};

// Adaptive decay: prior converges toward 1.0 (uniform) based on observed behavior
const DECAY_RATE = 0.15; // per triggering event

function adaptiveModifier(
  prior: number,
  observedTriggerCount: number,  // how many times this move has nearly/actually
                                  // fired for this debater (not just the prior
                                  // expectation — actual signal crossings)
): number {
  // Each observed signal event pulls the modifier toward 1.0
  // After ~5 events, the prior is largely washed out
  const decay = Math.pow(1 - DECAY_RATE, observedTriggerCount);
  return prior * decay + 1.0 * (1 - decay);
}
```

**How it works:** At debate start, Cassandra's PIN modifier is 1.3 (lenient).
If she evades twice (2 near-miss PIN signals), the modifier decays:
`1.3 × 0.85² + 1.0 × (1 - 0.85²) ≈ 1.21` after 2 events,
`≈ 1.13` after 4 events, `≈ 1.05` after 8 events. The system converges
toward uniform treatment when the persona surprises the prior, but starts
informed when the persona behaves as expected.

The prior is never fully washed out (exponential decay approaches but never
reaches 1.0), so the system retains a slight persona-awareness even in long
debates. This is appropriate: the personas *are* prompted differently, and
some behavioral tendencies are structural rather than contextual.

**Why not fully personalized prompts?** The moderator sees all three debaters
and must maintain a consistent persona. Fully different intervention styles per
debater would make the moderator feel inconsistent. The threshold modifiers are
invisible to the debaters — they affect *when* the moderator intervenes, not
*how* it speaks. The moderator's tone and framing remain uniform.

**Metrics to watch:** Per-persona intervention effectiveness rates. If CHALLENGE
on Sentinel consistently produces `challenge_response.type === 'consistent'`
(defensive denial) rather than `'evolved'` or `'conceded'`, the prior needs
further increase. Also track **prior decay velocity** in diagnostics: if a
persona's modifiers converge toward 1.0 rapidly, the priors were wrong for
this debate topic — useful for calibrating priors across debate types.

---

## Trajectory-Aware Triggering

The intervention triggers described above are **point-in-time**: they fire when a
single signal crosses a threshold on a single turn. This is reactive — the moderator
intervenes *after* a failure state is reached. Real-world moderators are proactive:
they sense a debate drifting toward trouble and intervene before it arrives.

The conversational forecasting literature (Cornell's ConvoWizard, the CGA datasets,
hierarchical discourse models) formalizes this as "distance to derailment" — a
continuous metric predicting how many turns remain before a conversation breaks down.
The full implementation (training a separate neural model on human discourse data)
is a poor fit for our system: our debaters are LLMs with fixed personas, our failure
modes are sycophantic drift and recycling rather than hostility, and we lack the
thousands of labeled debates needed to train such a model.

But the *framing* is right. We should adopt trajectory-aware triggering using
lightweight trend detection over our existing convergence signals.

### Debate Health Score

A composite metric computed after each turn from the existing convergence signals:

```typescript
interface DebateHealthScore {
  value: number;           // 0.0 (critical) to 1.0 (healthy)
  trend: number;           // change from previous turn (-1.0 to +1.0)
  consecutive_decline: number;  // how many turns the score has been falling
  components: {
    engagement: number;    // from engagement_depth.ratio
    novelty: number;       // inverse of recycling_rate.avg_self_overlap
    responsiveness: number; // from concession_opportunity outcomes
    coverage: number;      // % of relevant taxonomy nodes cited
    balance: number;       // evenness of turn distribution across debaters
  };
}
```

**Computation (per turn):**

```
engagement     = avg(engagement_depth.ratio) across last 3 turns
novelty        = 1 - avg(recycling_rate.avg_self_overlap) across last 3 turns
responsiveness = (concessions_taken / concession_opportunities) across last 3 turns
                 (1.0 if no opportunities — absence of pressure is not a problem)
coverage       = unique_cited_nodes_in_last_3_turns / relevant_taxonomy_nodes_for_current_focus
                 (per-window, NOT cumulative — cumulative coverage is a monotonic
                  ratchet that always rises with debate length, masking real gaps)
balance        = 1 - (max_turns - min_turns) / total_turns across debaters

health_score   = weighted_mean(
  engagement     × 0.25,
  novelty        × 0.25,
  responsiveness × 0.20,
  coverage       × 0.15,
  balance        × 0.15
)
```

**SLI floor thresholds (targeted alerts, not score overrides):** The composite
is useful for trajectory trending, but averaging can mask individual failure
modes. If a debate has zero responsiveness (agents executing disconnected
monologues) but high novelty, the composite would show "moderate" when the
debate is structurally broken. Each component therefore has an individual
floor threshold that triggers a **targeted alert** when breached:

| Component | Critical floor | Consecutive turns required | Failure mode | Routed to family |
|---|---|---|---|---|
| engagement | < 0.25 | 2 | Debaters not responding to each other | Elicitation (PIN, PROBE) |
| novelty | < 0.25 | 2 | Excessive recycling — debate is stuck | Elicitation (CHALLENGE) |
| responsiveness | < 0.15 | 2 | Concession opportunities systematically ignored | Elicitation (PIN) |
| coverage | < 0.20 | 2 | Debate is ignoring the taxonomy entirely | Procedural (REDIRECT) |
| balance | < 0.30 | 2 | One debater is being silenced | Procedural (BALANCE) |

Critically, an SLI breach does **not** clamp the health score to 0.0.
Clamping on a single-turn breach would strip the 3-turn rolling window of
its smoothing effect, causing the moderator to panic — an isolated drop in
`coverage` would trigger a cascade of aggressive Elicitation moves via the
trajectory modifier, creating a feedback loop where the moderator dominates
the transcript to correct a momentary anomaly.

Instead, SLI breaches operate through **targeted routing**:

```
for each component:
  if component < its critical floor for 2+ consecutive turns:
    sli_breach = name of breached component(s)
    // Lower the threshold for the SPECIFIC move family that addresses
    // this failure mode (see table above), not all move families
    component_specific_modifier = 0.75  // 25% more sensitive
    // The composite health score is NOT overridden
```

This means a coverage breach makes REDIRECT more likely to fire (directly
relevant) without making PIN or CHALLENGE more sensitive (unrelated). The
2-consecutive-turn requirement is consistent with the rolling window
philosophy: a single-turn dip is noise; a 2-turn breach is a pattern.

The `sli_breach` field in diagnostics identifies which component triggered
the alert and which intervention family received the sensitivity boost.
This follows standard observability practice: individual SLIs with targeted
response routing, composite metric for trajectory dashboarding.

### Trajectory-Based Threshold Adjustment

When the health score declines for consecutive turns, intervention thresholds
are lowered — making the moderator more proactive as the debate's trajectory
worsens:

| Consecutive decline | Threshold modifier | Effect |
|---|---|---|
| 0 (stable or rising) | 1.0 (baseline) | Normal trigger sensitivity |
| 1 turn | 0.95 | 5% more sensitive |
| 2 turns | 0.85 | 15% more sensitive — moderator is on alert |
| 3+ turns | 0.75 | 25% more sensitive — strong bias toward intervening |

This means a near-miss (signal at 80% of threshold) becomes a trigger after 2
consecutive turns of declining health (0.80 × 1/0.85 = 0.94 → fires). The
moderator doesn't wait for the full derailment; it senses the trend and
steps in early.

**Conversely**, when the health score is rising (the debate is improving), the
modifier goes the other direction:

| Consecutive rise | Threshold modifier | Effect |
|---|---|---|
| 2+ turns | 1.15 | 15% less sensitive — debate is self-correcting |

**Cooldown vs. trajectory conflict resolution:** The escalating cooldown
(Risk 1) and the trajectory modifier can work at cross purposes: in a
deteriorating debate, the trajectory modifier wants the moderator to
intervene, but the cooldown may forbid it. This is resolved as follows:

**Cooldown always wins.** It is a hard deterministic floor. The trajectory
modifier operates within the cooldown constraint — it can lower thresholds
(making near-misses fire when the cooldown expires) but cannot override
the gap rule. This is a deliberate trade-off: over-intervention is the
bigger risk, and a moderator that breaks its own spacing rules undermines
its procedural authority.

**Post-intervention trajectory freeze:** After any intervention fires,
`consecutive_decline` is frozen at its current value for 1 round — the
engine does not increment it even if the health score continues to drop.
This gives the intervention one round to take effect before the trajectory
modifier can tighten further. Combined with the cooldown (1-2 unmoderated
rounds), this means the trajectory modifier cannot worsen for at least 2
rounds after any intervention, preventing the "death spiral" where
declining health → lower thresholds → more interventions → no recovery
time → still declining → even lower thresholds.

The freeze applies to `consecutive_decline` only, not to the health score
itself — the score still reflects reality. The freeze just prevents the
*trajectory modifier* from using the continued decline as evidence for
further tightening. If health is still declining after the freeze expires,
the trajectory modifier resumes normal operation.

**Metric to watch:** If `near_misses` accumulate during active cooldown
periods while the health score is declining (consecutive_decline ≥ 2),
the cooldown is too aggressive for this debate's dynamics. The diagnostics
surface this as `cooldown_blocked_count` — interventions that would have
fired but for the gap rule. If this exceeds 2 per debate, consider
reducing the cooldown escalation cap.

When the debate is improving on its own, both mechanisms align: the
trajectory modifier raises thresholds (fewer triggers) and the cooldown
provides additional spacing. The moderator backs off naturally.

### Integration with Existing Signals

The health score does not replace convergence signals or individual trigger
conditions. It acts as a **multiplier on trigger thresholds**:

```
combined_modifier = persona_modifier × trajectory_modifier × sli_component_modifier
effective_threshold = base_threshold × clamp(combined_modifier, 0.6, 1.4)
```

Where `persona_modifier` comes from the adaptive persona priors (Risk 3),
`trajectory_modifier` comes from the health score trend, and
`sli_component_modifier` comes from any active SLI floor breach (0.75 for
the relevant family, 1.0 otherwise).

**Global clamp:** The individual modifiers are bounded (persona: ~0.7–1.3,
trajectory: 0.75–1.15, SLI: 0.75 or 1.0), but they multiply. Without a
clamp, the worst case produces `0.85 × 0.75 × 0.75 = 0.478` — a 52%
threshold reduction that makes the moderator hair-trigger on marginal
signals. The best case produces `1.3 × 1.15 × 1.0 = 1.495` — a 50%
increase that makes the moderator nearly blind. The global clamp at
`[0.6, 1.4]` preserves the directional signal from all three modifiers
while preventing the extremes. No combination of modifiers can change a
threshold by more than 40%.

This means all four layers compose:
1. **Base threshold:** the default sensitivity for each move type.
2. **Persona modifier:** adjusts for known per-debater patterns (adaptive).
3. **Trajectory modifier:** adjusts for the debate's current direction.
4. **SLI component modifier:** boosts sensitivity for the specific family
   that addresses a breached floor component.
5. **Global clamp:** prevents pathological extremes from modifier stacking.

### Why Not a Neural Model?

The conversational forecasting literature trains separate neural networks
(hierarchical transformers, HRNNs) on large corpora of human discussions.
We decline this approach for four reasons:

1. **Training data mismatch.** CGA and CMV are human-to-human conversations.
   Our debates are LLM-to-LLM with structured personas, BDI taxonomies, and
   argument networks. A model trained on Reddit would need complete retraining.

2. **Insufficient data.** We'd need thousands of labeled debates to train a
   hierarchical transformer. We have dozens.

3. **Signal richness.** Our convergence signals already extract far more
   structure per turn than a generic discourse model would — move types,
   QBAF strengths, engagement depth, taxonomy citation patterns. A neural
   model would learn cruder features from raw text.

4. **Marginal value.** The difference between "detect evasion when it happens"
   and "predict evasion one turn earlier" is one turn in a 12-round debate.
   The forecasting literature matters most in large-scale moderation (triaging
   thousands of simultaneous conversations); we have one conversation with an
   AI moderator that has unlimited attention.

The health score achieves the trajectory-awareness that makes forecasting
valuable — without the training pipeline, inference overhead, or data
requirements of a separate neural model.

---

## Testing Strategy

The moderator system has a clear testability boundary: the **engine layer**
(trigger evaluation, validation, state updates, phase computation, modifier
math) is fully deterministic and unit-testable. The **LLM layers** (Stage 1
selection, Stage 2 generation) are stochastic and require integration tests
with golden transcripts.

### Unit test boundaries

| Function | Input | Assert |
|---|---|---|
| `getPhase()` | round, totalRounds | Correct phase; throws for totalRounds < 8 |
| `validateRecommendation()` | SelectionResult, ModeratorState | Correct proceed/suppress decision and suppressed_reason |
| `adaptiveModifier()` | prior, observedTriggerCount | Convergence toward 1.0; never reaches 1.0 exactly |
| `updateModeratorState()` | state, intervention, validation, round | Budget decrement, cooldown escalation, burden accumulation |
| `initModeratorState()` | totalRounds | Correct budget = ceil((totalRounds-3) / 2.5) |
| `getEffectiveAN()` | AN, currentRound | Provisional mutations from current round excluded; hardened mutations included |
| `computeDebateHealthScore()` | convergence signals | Score in [0,1]; component floors fire after 2 consecutive breaches |
| Global clamp | persona × trajectory × SLI | Result always in [0.6, 1.4] |
| Prerequisite graph | Multiple active prerequisites | P1 > P2 > P3 ordering; ACKNOWLEDGE exempt |
| REVOICE propositional gate | original claim, revoiced text, taxonomy | Pass on ≥2/3 anchor overlap + entity preservation; fail otherwise |
| REVOICE dynamic AN fallback | original claim, revoiced text, empty taxonomy match | Falls back to AN anchors on 0/3 overlap; does NOT fall back on 1/3 |
| Trajectory freeze | state with freeze active, declining health | consecutive_decline does not increment during freeze |
| MOVE_TO_FAMILY lookup | Every InterventionMove | Maps to correct family |
| COMMIT budget exemption | State with budget_remaining=0, move=COMMIT | proceed: true |
| Cooldown exemption | Reconciliation move during active cooldown | proceed: true |

### Integration tests (golden transcript)

Record a debate transcript with known characteristics (evasion at round 4,
concession at round 6, recycling at rounds 7-8). Feed it through the full
moderator pipeline and assert:

1. Stage 1 recommends PIN at round 4 (evasion detected)
2. Engine validates the recommendation
3. ACKNOWLEDGE fires at round 6 (concession detected)
4. CHALLENGE fires at round 8 (recycling + non-engagement)
5. Near-misses are computed for signals at ≥80% of effective threshold
6. Session diagnostics match expected aggregates

Golden transcripts should be version-controlled alongside tests. When
trigger thresholds change, update expected outcomes — the golden transcript
is the regression safety net for the full pipeline.

### What NOT to unit-test

Stage 1 and Stage 2 LLM outputs are non-deterministic. Test them via
integration tests with `temperature: 0` and loose assertions (e.g.,
"Stage 1 should recommend some elicitation move" rather than "Stage 1
should recommend PIN"). The engine validation layer between them is where
correctness lives — that layer is fully deterministic and should have
exhaustive unit tests.

---

## Open Questions

1. **~~Should the moderator be a separate LLM call?~~** Resolved: the
   two-stage architecture (Stage 1: selection + trigger evaluation,
   Stage 2: intervention generation) is now the decided design. See
   "Proposed Architecture" section above.

2. **~~Should debaters see the move type tag?~~** Resolved: yes. The
   debater's BRIEF stage receives the move type, moderator text, and the
   required response field schema. Hiding the tag and relying on the judge
   to infer compliance from natural language adds implementation complexity
   for marginal benefit. The debaters are prompted agents, not adversaries.
   See "How the debater sees the intervention" in Implementation Approach.

3. **Audience-specific intervention style.** Each family's tone should
   adapt to the audience. Policymaker audiences get crisp procedural moves;
   technical audiences get precise repair moves; general public audiences
   get more reconciliation moves.

4. **Intervention history as debate artifact.** The moderator's intervention
   sequence — what it challenged, what it acknowledged, what it revoiced —
   tells its own story about the debate's dynamics. This could be extracted
   as a "moderator's report" in post-debate synthesis.

5. **Human-in-the-loop moderation.** The expanded taxonomy makes
   human-in-the-loop more natural: a human moderator could select from
   the same 14 moves, with the system providing trigger recommendations
   and draft text.

6. **Reconciliation calibration.** How much acknowledgment is too much?
   If the moderator ACKNOWLEDGEs every concession, it dilutes the signal.
   The threshold for what counts as a "significant" concession (QBAF
   strength ≥ 0.6) needs empirical tuning.

7. **~~REVOICE accuracy.~~** Resolved: REVOICE now uses a taxonomy-anchored
   propositional gate (entity preservation + taxonomy node overlap) rather
   than raw embedding similarity. This separates "said differently" from
   "said something different" without penalizing the register shift that
   REVOICE is designed to perform. AN exclusion prevents orphaned edges.
   See REVOICE spec and Risk 2.

---

## Appendix A: Configuration Reference

All tunable parameters in one place. Each entry names the default value,
valid range, and the section that defines its semantics.

### Debate structure

| Parameter | Default | Range | Defined in |
|---|---|---|---|
| `MIN_TOTAL_ROUNDS` | 8 | ≥8 | Phase Definitions |
| Synthesis rounds (reserved) | 3 | Fixed | COMMIT spec, Phase Definitions |
| `explorationRounds` | `totalRounds - 3` | Derived | COMMIT spec |
| Budget formula | `ceil(explorationRounds / 2.5)` | Derived | Rate Limiting, rule 5 |

### Trigger thresholds (per move)

| Move | Signal | Base threshold | Defined in |
|---|---|---|---|
| PIN | Question evasion (word overlap) | < 20% | PIN spec |
| PIN | Concession opportunity missed + QBAF | ≥ 0.7 strength | PIN spec |
| PROBE | Unsupported claim QBAF | ≥ 0.6 base_strength | PROBE spec |
| CHALLENGE | Position drift overlap drop | < 0.3 | CHALLENGE spec |
| CHALLENGE | Recycling + non-engagement | max_self_overlap > 0.6 AND strongest_opposition unaddressed 2+ rounds | CHALLENGE spec |
| CLARIFY | Undefined term usage count | ≥ 2 uses | CLARIFY spec |
| CHECK | Attack edge embedding similarity | < 0.3 (topically distant) | CHECK spec |
| CHECK | Warrant quality similarity | < 0.4 | CHECK spec |
| REDIRECT | Uncited topic relevance | ≥ 0.7 embedding sim | REDIRECT spec |
| REDIRECT | Tunnel vision (claim overlap) | > 60% for ≥ 3 rounds | REDIRECT spec |
| BALANCE | Turn count gap | ≥ 2 behind, or ≥ 3 rounds absent | BALANCE spec |
| REVOICE | Contested claim QBAF | ≥ 0.7, ≥ 2 attack edges | REVOICE spec |
| META-REFLECT | Crux absence | cumulative_count === 0 after 3+ turns | META-REFLECT spec |
| COMPRESS | Turn length + low engagement | > 800 words AND targeted_ratio < 0.3 | COMPRESS spec |
| ACKNOWLEDGE | Concession taken QBAF | ≥ 0.6 strength | ACKNOWLEDGE spec |

### Modifier system

| Parameter | Default | Range | Defined in |
|---|---|---|---|
| Persona prior: Prometheus PIN | 0.85 | — | Risk 3 |
| Persona prior: Prometheus PROBE | 0.85 | — | Risk 3 |
| Persona prior: Prometheus COMPRESS | 1.15 | — | Risk 3 |
| Persona prior: Sentinel COMPRESS | 0.85 | — | Risk 3 |
| Persona prior: Sentinel CHALLENGE | 1.2 | — | Risk 3 |
| Persona prior: Sentinel ACKNOWLEDGE | 0.85 | — | Risk 3 |
| Persona prior: Cassandra BALANCE | 0.85 | — | Risk 3 |
| Persona prior: Cassandra PIN | 1.3 | — | Risk 3 |
| Persona prior: Cassandra ACKNOWLEDGE | 0.85 | — | Risk 3 |
| Persona decay rate | 0.15 per event | (0, 1) | Risk 3 |
| Global modifier clamp | [0.6, 1.4] | — | Trajectory-Aware Triggering |
| Trajectory modifier (stable) | 1.0 | — | Trajectory-Aware Triggering |
| Trajectory modifier (1 decline) | 0.95 | — | Trajectory-Aware Triggering |
| Trajectory modifier (2 decline) | 0.85 | — | Trajectory-Aware Triggering |
| Trajectory modifier (3+ decline) | 0.75 | — | Trajectory-Aware Triggering |
| Trajectory modifier (2+ rise) | 1.15 | — | Trajectory-Aware Triggering |
| SLI component modifier (breach) | 0.75 | — | Trajectory-Aware Triggering |

### Health score

| Parameter | Default | Range | Defined in |
|---|---|---|---|
| Engagement weight | 0.25 | [0, 1], must sum to 1.0 | Debate Health Score |
| Novelty weight | 0.25 | [0, 1] | Debate Health Score |
| Responsiveness weight | 0.20 | [0, 1] | Debate Health Score |
| Coverage weight | 0.15 | [0, 1] | Debate Health Score |
| Balance weight | 0.15 | [0, 1] | Debate Health Score |
| Rolling window | 3 turns | ≥2 | Debate Health Score |

### SLI floor thresholds

| Component | Floor | Consecutive turns | Routed family | Defined in |
|---|---|---|---|---|
| engagement | 0.25 | 2 | Elicitation | Trajectory-Aware Triggering |
| novelty | 0.25 | 2 | Elicitation | Trajectory-Aware Triggering |
| responsiveness | 0.15 | 2 | Elicitation | Trajectory-Aware Triggering |
| coverage | 0.20 | 2 | Procedural | Trajectory-Aware Triggering |
| balance | 0.30 | 2 | Procedural | Trajectory-Aware Triggering |

### Pacing and burden

| Parameter | Default | Range | Defined in |
|---|---|---|---|
| Burden: Procedural | 0.5 | [0, 1] | Family Balance, Burden table |
| Burden: Elicitation | 1.0 | [0, 1] | Family Balance, Burden table |
| Burden: Repair | 0.75 | [0, 1] | Family Balance, Burden table |
| Burden: Reconciliation | 0.25 | [0, 1] | Family Balance, Burden table |
| Burden: Reflection | 0.6 | [0, 1] | Family Balance, Burden table |
| Burden: Synthesis | 0.8 | [0, 1] | Family Balance, Burden table |
| Burden cap multiplier | 1.5× avg | > 1.0 | Rate Limiting, rule 6 |
| Cooldown (0-1 interventions) | 1 round | ≥1 | Risk 1 |
| Cooldown (2+ interventions) | 2 rounds | ≥1 | Risk 1 |
| Near-miss threshold | 80% of effective | (0%, 100%) | Trigger Priority |
| Moderator dominance ratio | 0.3 | (0, 1) | Risk 1 |

### REVOICE gate

| Parameter | Default | Defined in |
|---|---|---|
| Taxonomy anchor overlap | ≥2 of top-3 | REVOICE spec, Layer 1a |
| Dynamic AN fallback trigger | 0 taxonomy overlap | REVOICE spec, Layer 1a |
| Dynamic AN anchor count | top 3 cited AN nodes, last 2 rounds | REVOICE spec, Layer 1a |
| Entity/relation preservation | All must match | REVOICE spec, Layer 1b |
| Accuracy alert threshold | < 80% | Risk 2 |
| Gate rejection alert threshold | > 30% | Risk 2 |

### Operational

| Parameter | Default | Range | Defined in |
|---|---|---|---|
| Stage 1 timeout | 15s | ≥5s | Operational Constraints |
| Stage 2 timeout | 10s | ≥5s | Operational Constraints |
| Stage 2 retry timeout (REVOICE→CHECK) | 10s | ≥5s | Operational Constraints |
| Trajectory freeze duration | 1 round post-intervention | ≥0 | Trajectory-Based Threshold Adjustment |

### Outcome heuristics

| Parameter | Default | Defined in |
|---|---|---|
| PIN substantive: min words | 15 | Diagnostics doc, §2.3 |
| PIN substantive: max Jaccard sim | 0.5 | Diagnostics doc, §2.3 |
| COMPRESS: max words | 50 | Diagnostics doc, §2.3 |
| COMPRESS: max Jaccard sim | 0.4 | Diagnostics doc, §2.3 |
| Topic persistence: embedding sim | ≥ 0.6 | Diagnostics doc, §2.3 |
| Topic persistence: window | 3 turns | Diagnostics doc, §2.3 |
