# Computational Dialectics and the AI Triad Debate Engine: A Comparison

**Paper:** Loui, R. P. (1995). "The Workshop on Computational Dialectics." *AI Magazine*, 16(4), 101–104. Report on the 1994 AAAI Workshop on Computational Dialectics organized by Tom Gordon (GMD).

**System:** AI Triad Research debate engine (`lib/debate/`). Three-agent BDI debate system with AIF argument network, QBAF gradual semantics, and taxonomy-driven POV modeling.

---

## 1. What the Paper Says

The 1994 workshop crystallized three claims:

1. **Dialectic has something to do with computation.** Rational inquiry under bounded rationality *requires* adversarial discourse — you can't just unpack entailments because the search space is too large. This is the Simon-Rescher insight: procedural rationality (Simon) and formal disputation (Rescher) are two sides of the same coin.

2. **AI contributes new precision to dialectic.** Brewka's formalization of Rescher's disputation theory within default reasoning was the first formal extension in two decades. The precision of nonmonotonic reasoning made it possible to answer questions Rescher couldn't.

3. **Dialectic approaches unlock progress on standing AI problems.** Bench-Capon's dialogue games for explaining negation-as-failure, Gordon and Brewka's argument-based decision making (using defeat among arguments instead of real-valued utility), and Cavalli-Sforza's BELVEDERE tutoring system all showed dialectic as a *design paradigm*, not just a theory.

### Key Concepts the Paper Foregrounds

| Concept | Description | Relevance to AI Triad |
|---|---|---|
| **Defeasible reasoning** | Arguments that can be defeated by stronger arguments — Hart's term, imported from contract law. Dialectic *presupposes* defeasible reasons. | Core to QBAF: computed_strength changes as attacks/supports accumulate. |
| **Open texture** | Terms whose meaning is inherently contestable and can only be sharpened through adversarial exchange (Hart via Wittgenstein/Waismann). | Directly maps to DEFINITIONAL disagreements and the `disagreement_type` field. |
| **Discourse games** | Structured protocols governing who speaks when, what moves are legal, and when the game terminates. The interaction *is* the reasoning. | The moderator selection + cross-respond protocol is a discourse game, though not formally specified as one. |
| **Argument defeat as qualitative utility** | Gordon and Brewka: instead of mapping attributes to utility functions, let arguments for different decisions *defeat* each other. Preferences among arguments replace preference among outcomes. | QBAF does exactly this — but the paper warns that a single preference ordering may be "representationally impoverished." |
| **Dialectic as explanation** | Bench-Capon: a dialogue game where the system's stubbornness in defending its conclusion *generates* the explanation. More stubborn user → longer game → larger explanation. | The AI Triad synthesis is a post-hoc summary, not a dialectic explanation. The debate *produces* content but doesn't use dialectic structure to *explain* its own conclusions. |
| **Taxonomy of dialectic models** | Zlotkin's challenge: computational dialecticians "give rules for interesting games" but need ways to evaluate the merit of the resulting models. They should "develop the kinds of taxonomy that logicians have for their wares." | The AI Triad has a rich taxonomy of *content* (POV nodes) but no formal taxonomy of *dialectic protocols*. The debate rules are embedded in prompts, not formally specified or evaluable. |

---

## 2. What the AI Triad Debate Engine Already Does Well

The debate engine is significantly more sophisticated than anything discussed at the 1994 workshop. Several of its features directly realize aspirations only sketched in the paper:

- **Formalized dialectical moves** (8 canonical moves + 13 Walton argumentation schemes with critical questions) — this exceeds what Rescher or any 1994 workshop participant had
- **BDI-layered disagreement classification** (EMPIRICAL/VALUES/DEFINITIONAL) — this is a direct operational treatment of the open-texture problem Hart raised
- **QBAF gradual semantics** — this is the mature version of Gordon and Brewka's argument-defeat-as-preference idea, with proper propagation
- **Argument network tracking** (AIF-aligned nodes and edges built incrementally during debate) — this is what Vreeswijk was working toward
- **Moderator intelligence** using QBAF unaddressed claims, scheme detection, stall detection, and rhetorical dynamics
- **Falsifiability-aware argumentation** — adjusting evidentiary standards by claim type
- **Taxonomy refinement as debate output** — the `taxonomyRefinementPrompt` already proposes node modifications post-debate

---

## 3. What the Paper Reveals We're Missing

### 3.1 Dialectic as a *Protocol*, Not Just Instructions

**The gap:** The debate engine's rules live in natural-language prompt instructions (the MUST/SHOULD tiers in `prompts.ts`). There is no formal protocol specification — no explicit game rules that define legal moves, turn-taking conditions, termination criteria, or what constitutes "winning" a point.

**Why it matters:** Loui's central argument is that the *protocol* is the theory. When Bench-Capon models explanation as a dialogue game, the game rules *are* the explanation theory. When Brewka formalizes Rescher, the formalization *is* the advance. Our prompts are instructions to an LLM, not a protocol that could be analyzed, compared to alternatives, or proven to have properties (fairness, termination, completeness).

**Specific change:** Formalize the debate protocol as a state machine or dialogue game specification. This doesn't replace the prompts — it sits above them as an auditable contract:

```
States: OPENING → CROSS_RESPOND → SYNTHESIS
CROSS_RESPOND transitions:
  - MODERATOR selects respondent R and focus F
  - R must perform 1-3 moves from {DISTINGUISH, COUNTEREXAMPLE, ...}
  - R must address F or explicitly DECLINE with reason
  - If DECLINE, moderator must select different F next turn
  - If same claim unaddressed for 3 rounds → force SPECIFY
Termination: max_rounds OR convergence_detected OR all cruxes addressed
```

This makes the rules inspectable, testable, and comparable to alternative protocols.

### 3.2 Open Texture as a First-Class Debate Outcome

**The gap:** The debate engine classifies disagreements as DEFINITIONAL but doesn't have a mechanism for *resolving* definitional disputes through the debate itself. The taxonomy has fixed node descriptions. When debaters disagree about what "AI safety" means, the debate records the disagreement but doesn't sharpen the term.

**Why it matters:** St-Vincent and Poulin's paper at the workshop modeled open texture as a dialectic exchange between advocates seeking to *enlarge* vs. *restrict* a concept's scope. This is exactly the kind of work that should feed back into the taxonomy.

**Specific change — DEFINITIONAL disputes should produce taxonomy node splits or refinements:**

When synthesis identifies a DEFINITIONAL disagreement:
1. Extract the contested term and the competing definitions from each POV
2. Determine if the disagreement is about *scope* (one definition is broader) or *kind* (genuinely different concepts sharing a label)
3. For scope disputes: propose a `narrow` or `broaden` modification to the relevant taxonomy node, with the competing scope boundaries recorded
4. For kind disputes: propose a `split` — two new nodes replacing the ambiguous one, each with a precise definition that one POV would endorse

This makes definitional debates *generative* — they don't just flag a problem, they produce the fix.

### 3.3 Defeat Should Drive Taxonomy Confidence, Not Just QBAF Scores

**The gap:** QBAF tracks argument strength within a single debate. But when a taxonomy node's key claim gets defeated across multiple debates, that signal doesn't propagate back to the node itself. The taxonomy is static between manual edits.

**Why it matters:** Gordon and Brewka's insight was that argument defeat *is* the preference ordering. If a node's claim gets consistently defeated, that's evidence the node needs revision — it's not just a debate outcome, it's a taxonomy signal.

**Specific change — Cumulative defeat tracking per node:**

Add a `debate_record` field to taxonomy nodes:

```json
{
  "debate_record": {
    "times_cited": 12,
    "times_defended_successfully": 8,
    "times_defeated": 3,
    "times_conceded_by_advocate": 1,
    "defeat_ratio": 0.25,
    "common_defeat_schemes": ["EMPIRICAL_CHALLENGE", "COUNTEREXAMPLE"],
    "last_debated": "2026-04-10",
    "needs_review": true
  }
}
```

When `defeat_ratio` exceeds a threshold (say 0.4), the node is flagged for review. The `common_defeat_schemes` tell you *how* it's being defeated — if it's always EMPIRICAL_CHALLENGE, the node needs better evidence; if it's always COUNTEREXAMPLE, the node is over-general.

### 3.4 Dialectic as Explanation (Bench-Capon's Insight)

**The gap:** The debate engine produces a synthesis document that *summarizes* the debate. But the dialectic structure itself — the sequence of moves, defeats, and concessions — is not used as an explanatory device. You get a summary of *what* was concluded, not a dialectic trace of *why*.

**Why it matters:** Bench-Capon showed that explanation quality is proportional to dialectic depth — the more you push back, the more structure the system reveals. The AI Triad already has the argument network (AN nodes and edges). But it's only used for QBAF computation, not for generating explanations of *why* a particular position prevailed.

**Specific change — Dialectic explanation traces for conflict resolution:**

When a conflict is resolved (or a QBAF resolution is computed), generate a *dialectic trace* — a minimal argument path from the losing position through the defeating arguments to the prevailing one:

```
TRACE for conflict-agi-timelines-001:
  1. Prometheus asserted: "AGI by 2030 is likely" [AN-7, base_strength=0.6]
  2. Sentinel attacked via EMPIRICAL_CHALLENGE: "No current system demonstrates
     general reasoning" [AN-12, attacks AN-7]
  3. Prometheus attempted DISTINGUISH: "General reasoning not required for
     economic AGI" [AN-15, supports AN-7]
  4. Cassandra attacked via SPECIFY: "Define 'economic AGI' — what specific
     benchmark?" [AN-18, attacks AN-15]
  5. Prometheus could not specify → AN-15 computed_strength dropped to 0.21
  6. Resolution: Sentinel's position prevails (margin: 0.34)
```

This trace is the *dialectic explanation* of the resolution. It can be attached to the conflict's `verdict` field and shown in the GUI.

### 3.5 The Debate Should Produce Taxonomy *Mutations*, Not Just Suggestions

**The gap:** The `taxonomyRefinementPrompt` generates suggestions post-debate, but these are advisory — they sit in the synthesis output and require manual action. The debate doesn't directly change the taxonomy.

**Why it matters:** Loui's paper positions dialectic as a driver of *change*, not just analysis. The Cavalli-Sforza/BELVEDERE system used argumentation to restructure students' understanding of scientific claims. The debate engine should do the same for the taxonomy.

**Specific change — Debate-driven taxonomy mutation proposals with structured diffs:**

The current `taxonomyRefinementPrompt` already produces `new_nodes` and `modifications` (refine/split/broaden/narrow). Extend this to produce machine-applicable diffs:

```json
{
  "taxonomy_mutations": [
    {
      "type": "refine",
      "target_node": "acc-beliefs-019",
      "field": "description",
      "before": "AI adoption is accelerating across all sectors",
      "after": "AI adoption is accelerating in knowledge work sectors; manufacturing and agriculture adoption rates remain below 15%",
      "evidence": ["AN-7", "AN-12", "AN-34"],
      "debate_id": "debate-2026-04-10-001",
      "confidence": 0.8
    },
    {
      "type": "split",
      "target_node": "saf-beliefs-022",
      "into": [
        {
          "id": "saf-beliefs-022a",
          "label": "Near-term AI safety risks",
          "description": "..."
        },
        {
          "id": "saf-beliefs-022b",
          "label": "Existential AI safety risks",
          "description": "..."
        }
      ],
      "reason": "DEFINITIONAL disagreement in debate showed these are distinct claims with different evidence bases",
      "debate_id": "debate-2026-04-10-001"
    }
  ]
}
```

These mutations can be reviewed in the harvest tool (which already supports this flow) but now carry the full dialectic provenance — which debate, which arguments, which moves drove the change.

---

## 4. Summary of Recommended Changes

Listed in priority order, with the user's stated goal of making debates a *driver of clarity and change for the POV taxonomy*:

### Priority 1: Debate → Taxonomy Feedback Loop

| Change | What | Where | Impact |
|---|---|---|---|
| **Cumulative defeat tracking** | Add `debate_record` to taxonomy nodes; update after each debate | `debateEngine.ts` (post-synthesis), taxonomy node schema | Nodes that can't survive debate get flagged for review automatically |
| **DEFINITIONAL → split/narrow/broaden** | When synthesis finds DEFINITIONAL disagreement, produce structured taxonomy mutations | `prompts.ts` (synthMapPrompt), `harvestUtils.ts` | Debates about meaning directly sharpen the taxonomy |
| **Structured mutation diffs** | Extend `taxonomyRefinementPrompt` output to produce machine-applicable before/after diffs with argument provenance | `prompts.ts`, new `applyMutations` utility | Harvest tool can show and apply changes with one click |

### Priority 2: Dialectic Structure as Explanation

| Change | What | Where | Impact |
|---|---|---|---|
| **Dialectic traces** | Generate minimal argument paths for conflict resolutions from the AN graph | New function in `debateEngine.ts` or `qbaf.ts` | Conflicts show *why* a position prevailed, not just *that* it did |
| **Attach traces to conflict verdicts** | Store dialectic trace in conflict file's `verdict` field | Conflict schema, `ConflictDetail.tsx` | GUI shows the reasoning chain |

### Priority 3: Protocol Formalization

| Change | What | Where | Impact |
|---|---|---|---|
| **Formal dialogue game spec** | Define debate protocol as a state machine with explicit legal moves, turn conditions, and termination criteria | New `protocol.ts` or doc; `debateEngine.ts` refactored to follow it | Rules become inspectable, testable, and comparable to alternatives |
| **Move legality enforcement** | Validate that each response's `move_types` are legal given current game state (e.g., can't EXTEND own point twice consecutively) | `debateEngine.ts` post-extraction | Prevents degenerate debate patterns |

### Priority 4: Zlotkin's Challenge — Evaluate the Protocol

| Change | What | Where | Impact |
|---|---|---|---|
| **Debate quality metrics** | Track per-debate: move diversity, crux resolution rate, taxonomy mutation yield, convergence speed | `debateEngine.ts` diagnostics | Enables comparing protocol variants |
| **Protocol variants** | Test alternative turn-taking and termination rules against the same topics | `run-debate-baseline.mjs` extended | Empirical answer to "are our rules good?" |

---

## 5. The Core Insight

Loui's paper makes one point that cuts through everything else:

> *Dialectic is an old idea that simply will not disappear. It is the idea of structured linguistic interactions proceeding according to a protocol.*

The AI Triad debate engine has sophisticated *content* modeling (BDI, taxonomy, QBAF, AIF) but its *protocol* is implicit — embedded in prompt instructions and engine control flow rather than formally specified. The paper's deepest lesson is that the protocol *is* the theory. Formalizing it would make the system's dialectic assumptions explicit, testable, and — most importantly for the stated goal — would create clear trigger points where debate outcomes *must* flow back into the taxonomy.

The taxonomy should not be a static reference that debates consult. It should be a living structure that debates *test and revise*. Every debate is a stress test of the nodes it touches. The system already tracks which nodes are cited, which claims are defeated, and which definitions are contested. Closing the loop — making those signals automatically produce taxonomy review flags, split proposals, and confidence adjustments — turns the debate engine from an analysis tool into a *taxonomy evolution engine*.
