# The AI Rosetta Stone as Epistemic Infrastructure: Engineering Relevance and Salience to Harvest Wisdom

## The Argument

Epistemic infrastructure is the set of structures, conventions, and tools that shape how communities produce, test, and transmit knowledge. Writing systems, the scientific method, double-entry bookkeeping, common law precedent, and peer review all qualify. None of them contain knowledge. They create the conditions under which knowledge becomes wisdom.

The AI Rosetta Stone is epistemic infrastructure for multi-perspective policy analysis. Its purpose is not to store information about AI policy (a database could do that) or to generate arguments (a chatbot could do that). Its purpose is to provide the structural conditions, specifically engineered relevance and salience, under which the wisdom embedded in AI policy discourse becomes accessible, testable, and actionable.

---

## The Terms, Declared

This document uses "relevance" and "salience" **non-technically**. Both words name developed theoretical traditions that this essay does not engage. Here the words are folk glosses. Relevance means what matters; salience means what stands out.

The system computes several distinct things under the name **relevance**, and they are different mathematical objects with different units:

- **relevance (dialectical)**: post-propagation argument strength under QBAF semantics. What survived scrutiny.
- **relevance (topical)**: embedding similarity between a text and a query. What is about the same thing.
- **relevance (marginal)**: the utility delta a candidate move would add to the argument network. What is worth saying next.
- **relevance (counterfactual)**: the change in outcome when an argument is removed. What the result depends on.

**Wisdom** is digested experience. Information accumulates facts and knowledge organizes them into patterns, but wisdom comes from living through something and metabolizing what it meant. That is the sense in which this system harvests wisdom, and the mechanism is literal. Each debate is an experience. Three perspectives commit to positions, defend them under pressure, concede some and watch others fall. When the debate ends, each POV reflects on what it learned and proposes how that experience should update its beliefs, desires, and intentions. A human reviews every proposed update before it takes hold. Digestion tells you what an experience meant, not whether the surviving claims are true, so the wisdom this system can claim is **structural, not veridical**. The next section draws that boundary before any component is described, so that what follows reads as claims rather than over-claims.

---

## Survival Is Not Truth But It Ain't Nothing

Everything below rests on one inference: a claim survived adversarial scrutiny. What survives a debate in this system is what survives scrutiny by other LLM outputs, under rules the project wrote, over a corpus the project curated, argued by perspectives the project authored. QBAF propagation computes coherence within that constructed network; nothing in the loop touches the world. A claim can dominate the argument graph and be false. A claim can be annihilated in round two and be true. The scientific method, which appears in the lineage table at the end of this document, derives its authority from the one thing this loop lacks, an exogenous arbiter. Experiments touch reality. The reflect step touches the system's own prior outputs.

Two mitigations are real but must not be oversold. First, the loop's writes are human-gated. Harvested proposals do not change the taxonomy until a person reviews, edits, and accepts or rejects them (see Wisdom Harvesting). A human gate filters error; it does not convert survival into evidence of truth, because the gatekeeper is one researcher, not the world. Second, the system's most important product points beyond itself. A crux is by definition a question the loop cannot resolve internally, so identifying one marks where exogenous evidence, real experiments, and real institutional experience must be consulted. The loop's authority ends where the crux begins. That is the design's intended interface with reality, not a failure of it.

The same discipline applies to the numbers. The system carries eleven graph attributes, five affect dimensions, three utility signals, and a five-level values hierarchy. Every one of those scalars implies a measurement instrument, and none has yet been validated against human judgment. Borrowing Wachsmuth's dimension names does not validate a lexicon; stipulating that fear distorts reasoning more than hope does not make it so. These numbers are calibration signals, internally consistent and auditable to their inputs, useful for comparing debates run under the same instrument. They are not validated measurements of rhetorical or epistemic reality. The computed crux, likewise, is a sensitivity analysis over simulacra. Whether it matches what would change a real policy actor's mind is an empirical question about real humans, on which the project currently has no data.

Both obligations are tracked work, one to validate the affect instrument against human raters with pre-registered retirement thresholds, the other to build a provenance register classifying every scalar as stipulated, derived, or human-validated. So bounded, the system's products are **tested coherence** and **legible disagreement structure**. Everything that follows should be read in that frame.

---

## How the System Engineers Relevance and Salience

### BDI Decomposition: What Kind of Claim Is This?

When a claim enters the system, BDI classification asks what kind of claim it is. An empirical assertion about how the world is counts as a Belief, a normative commitment about what should happen as a Desire, and a strategic proposal about how to act as an Intention. Different kinds are contestable in different ways. Evidence can refute a Belief but not a Desire; feasibility can challenge an Intention but not its values. The decomposition prevents the most common failure of policy discourse, which is arguing about evidence when the disagreement is about values, or about values when it is about strategy. Within BDI, each node carries a finer `epistemic_type` (empirical, normative, strategic, predictive, definitional, interpretive) that tells debate agents how to argue, and its key `assumes`, the unstated premises that give opponents pre-identified attack surfaces for UNDERCUT moves.

### Three Perspectives, One Situation

Each of the three perspectives (accelerationist, safetyist, skeptic) is a complete BDI worldview, with structured beliefs about how AI works, desires about what society should prioritize, and intentions about how to get there. The same phenomenon is salient to each for different reasons. "AI governance" is an innovation bottleneck to the accelerationist, essential gating to the safetyist, a capture risk to the skeptic. Situation nodes hold all three interpretations simultaneously, each decomposed into its own belief, desire, and intention; the decomposition is corpus-wide (all 411 non-deprecated situations). They do not resolve which interpretation is correct. They make visible what each perspective foregrounds and backgrounds. Translating between salience frames is the Rosetta Stone function.

### The Vocabulary Problem: When One Word Is Three Words

The deepest form of talking past each other is not disagreeing about answers; it is using the same word for different questions. AI policy discourse runs on a small set of high-stakes terms (alignment, safety, risk, fairness, accountability), and each camp means something different by them. When an accelerationist says "safety," they typically mean empirical output verification; when a safetyist says it, they mean existential risk prevention. Any analysis that uses the bare term silently takes sides, laundering one camp's sense into the shared record as if it were the neutral one.

A **controlled vocabulary** forces the ambiguity into the open. Every ambiguous colloquial term is marked do-not-use-bare and fans out into standardized senses. "Accountability" becomes *accountability (market)*, consumer choice and competitive pressure, the accelerationist default; *accountability (institutional)*, legal liability and regulatory mandate, the safetyist default; and *accountability (algorithmic)*, bias testing and impact assessment of specific systems, the skeptic default. Each sense carries its camp of origin, a definition, the characteristic phrases that signal it, and explicit do-not-confuse-with boundaries. Coinage is recorded in an append-only audit log; the disambiguator is calibrated against hand-labeled occurrences.

The translation pipeline applies the dictionary automatically, resolving bare terms where context is clear and *flagging* genuinely ambiguous uses for review rather than guessing. That refusal to guess is the epistemic point. An ambiguity surfaced is information; an ambiguity silently resolved is a bias. Enforcement reaches into the debates. Each debater's prompt carries its camp's standardized terms, the cross-camp terms it may engage, and a blocklist of bare terms the system rejects. Readers always see the display form, "accountability (algorithmic)," never bare "accountability." When a disagreement turns out to be definitional rather than empirical or values-based, the system classifies it as such on situation nodes and debate turns alike.

This layer is the heart of the Rosetta Stone positioning. One term exists in three senses, and the infrastructure refuses to let any one sense masquerade as the plain meaning of the word. The sense-tagging of "relevance" earlier in this document applies the same convention to the essay itself.

### Register Alignment: The Semantic Gravity Well

Perspective is not the only thing that fractures meaning; register does too. Taxonomy nodes are written in DOLCE-derived genus-differentia form ("A Belief within safetyist discourse that [differentia]. Encompasses: ... Excludes: ..."), a deliberately precise register in which genus, differentia, and explicit boundaries replace vague labels. Debate claims arrive in colloquial argumentative prose. Embedding models are sensitive to that surface difference. Texts separate in embedding space by register as well as by content, so a claim and the very node it instantiates can sit far apart while saying the same thing. Left uncorrected, this misalignment starves relevance (topical) matching.

The system corrects it with synthetic paraphrasing that acts as a semantic gravity well. Each extracted claim is rewritten into the taxonomy's own register, once as a genus-differentia rendering (`attribution_text_genus`) and once as a canonical proposition capped at thirty words whose modal register matches the claim's BDI type. Matching runs on embeddings of the paraphrase rather than the raw utterance, so content similarity dominates register similarity. The paraphrases pull register-divergent surface forms of the same idea toward a common semantic center, where they can find each other. The complementary direction, generating colloquial per-POV statements around each situation so that taxonomy content also projects into debate register, is planned as t/1299.

### QBAF: Computing Relevance (dialectical)

Every claim enters the argument network with a base strength. Attacks reduce it, supports increase it, and strength propagates, so a claim attacked by a strong, well-supported counterargument loses more than one attacked by a weak assertion. The result is a computed ranking of relevance (dialectical) over all arguments, showing which claims survived scrutiny, which were undermined, and which were never engaged. One qualification belongs here. The propagation is mechanical, but not all of its inputs are innocent. Doctrinal anchoring (under The Three Weights) injects hand-authored confidence floors into base strength, and propagation carries that curated influence into every downstream ranking. The rankings are computed from declared inputs, including declared identity commitments, not conjured free of human hands.

QBAF also drives node selection. Rather than scoring the 1,197-node taxonomy against a blended topic query, the system embeds each argument-network claim individually and scores every node against every active claim, taking the maximum, so relevance (topical) to any live argument surfaces a node even when it is irrelevant to the original topic string. As the debate evolves, the injected taxonomy content tracks the actual discourse trajectory rather than the static topic.

### Adversarial Debate: The Socratic Engine

The debate system implements the oldest epistemic infrastructure there is, structured dialectic. Three agents with genuinely different worldviews engage under formal rules. Commitment tracking prevents silent self-contradiction. Convergence diagnostics detect recycled arguments and force phase transitions. Crux identification surfaces the pivot points. Sycophancy detection guards against false consensus, because wisdom requires genuine disagreement, not accommodation.

These rules have an enforcer. An active moderator presides with a taxonomy of fourteen intervention moves. It detects scope drift, debaters talking past each other, and phases that have stopped producing new material, and it issues directives the next turn must visibly address. Compliance is checked mechanically, not left to good intentions. The moderator holds no position on the substance; like a judge, its authority is entirely procedural, which is what makes it infrastructure rather than a fourth debater.

The debate is not trying to determine who is right. It provides the conditions under which the structure of the disagreement becomes visible. Where do the perspectives genuinely conflict? Where do they agree without realizing it? What would have to be true for one side to update?

### Arguing Like a Lawyer: The Staged Turn Pipeline

A debater's turn is not a single LLM call. It is a pipeline of narrow stages modeled on how a litigator prepares, and its design principle is to give the model the minimum context needed for one specific action, wrapped in its own quality check. Minimizing context per step is relevance and salience engineering applied to the system's own reasoning. A model asked to do one thing, holding only the material that matters for it, cannot lose the instruction in the middle of a crowded prompt.

- **Brief**: the case brief. Claims on the table, standing commitments, tensions worth engaging. No prose yet.
- **Plan**: litigation strategy. Goal, planned moves, target claims, anticipated responses, and how any moderator directive will be addressed. Moves are declared here, not inferred later from prose.
- **Draft**: the statement, plus claim sketches, key assumptions each tagged with what follows if wrong, and the kind of disagreement being pressed (empirical, values, definitional).
- **Quality gates**: the lookahead gate, which tests relevance (marginal) by asking whether committing the move would measurably improve the network; a draft-quality check; and off-scope drift classification. Failing drafts get targeted hints naming the weakest component, not blind retries.
- **Cite**: grounding. Taxonomy references validated against a citation bank of nodes that actually exist (a hallucinated node ID cannot survive this stage), move annotations, and a grounding-confidence score.
- **Micro-fix**: surgical repair of bounded defects without regenerating the turn.

Each stage boundary is a validation boundary, and each stage can run on a different model, so an inexpensive model can brief while a stronger one drafts.

### Cruxes: Relevance (counterfactual)

A crux answers a single question. If you could resolve just one point, which would change the most minds within the system's reconstruction of the discourse? A debate about AI regulation might surface dozens of arguments, but the crux might be "can pre-deployment testing be made fast enough not to delay release cycles?" The system locates it by intervention. Remove each pivotal argument, recompute what survives, and the argument whose removal most changes the outcome is the crux (cf. ARGORA, Jin et al., 2026, which independently arrives at the same remove-and-recompute diagnostic). Across debates, recurring cruxes mark the structural fault lines of the discourse, and per the boundary above they are the system's handoff to reality, the places where the world's own testimony must be brought in.

### Strategic Evaluation: Reading the Players

Structural conditions are necessary but not sufficient; a debate with all the right components can still degenerate into position-recycling, network-flooding, or tactical concession. A game-theoretic layer diagnoses this without turning agents into utility maximizers. Each agent carries a per-turn utility triple: position strength (mean relevance (dialectical) of its surviving nodes), attack effectiveness (opponent nodes weakened below viability), and crux engagement (identified cruxes directly addressed). The ratios reveal posture. High attack effectiveness with low crux engagement is scoring rhetorical points without advancing understanding; rising position strength with falling crux engagement is winning by avoidance, the most corrosive failure mode. Plotted across rounds, the curves expose stagnation, runaway dominance, and disengagement. Three anti-exploit patterns (filibustering, dialectical drift, preference faking) are detected and surfaced as calibration signals rather than hard blocks. The layer exists to hold the debate in the productive zone between too adversarial, which generates heat, and too cooperative, which generates false consensus.

### Affect: Phase-Appropriate Register

Wisdom extraction depends not only on what is argued but on the register in which it is pressed. Each statement is scored on five affect dimensions (urgency, fear, hope, outrage, empathy) from lexical signals, operationalizing the Emotional Appeal dimension of Wachsmuth et al. (2017), the same taxonomy from which the system derives its Clarity metrics (readability, lexical diversity, jargon density) and Credibility metrics (source authority, recency). The taxonomy supplies dimension names and definitions, not validated instruments. Lexicon scoring has known limits on sophisticated rhetoric, and these scorers await human-rater validation (t/1342). Affect intensity weights the dimensions by their presumed capacity to distort reasoning (fear and outrage most, hope and empathy least), a stipulated ordering rather than a derived one. Phase appropriateness compares each turn's profile against phase baselines. Confrontation tolerates more heat; concluding should be warmest and least inflammatory. An out-of-phase register is flagged with the matched terms shown, so the judgment is auditable. Affect is measured only on debater turns; moderator and system prose are excluded.

### The Three Weights: Evidential Authority, Values Architecture, Actionability

BDI says what kind of claim you are looking at. Three scalar weights answer what remains: **confidence** (how well-supported is this Belief?), **priority** (how important is this Desire?), and **operationality** (how actionable is this Intention?). Before the weights, "current AI models require massive compute" entered debates with the same standing as "AI will achieve recursive self-improvement," and "preventing AI-driven extinction" sat on the same tier as "improving AI documentation." Each weight is computed from metadata the system already maintains. Confidence draws on epistemic type, falsifiability, evidence breadth, debate survival record, and graph position, and enters the QBAF as base strength. Priority places each Desire on a five-level scale from identity-constituting commitments down to readily conceded preferences, perspectival by design. Operationality scores each Intention from tree position, falsifiability, and situation grounding, separating testable proposals from umbrella framings. All three evolve conservatively through debate outcomes.

The most consequential piece is **doctrinal anchoring**, where values meet evidence. Each debater carries non-negotiable, identity-constituting positions, and a Belief that instantiates one receives a confidence floor. A Belief might carry evidential confidence 0.20 while its effective confidence is held at 0.60, with both numbers displayed. This is a faithful model of how commitments work. Real policy actors hold under-evidenced positions that are load-bearing for their worldview, and the display separates "won't concede because the evidence supports me" from "won't concede because this is constitutive of who I am." Because effective confidence enters the QBAF, the floor propagates. Downstream strengths inherit curated influence, and only the node-level display shows the gap; annotating doctrinal influence at the ranking level is an open item.

The weights compose. A Desire at priority 5 ("preventing AI-driven extinction") served only by Intentions at operationality 2 ("establishing broad safety norms") reveals that a camp's most important value rests on its most abstract strategies, a structural insight visible only when all three weights are present.

### Situations as Topic Generators

A calibrated debate engine running on a poorly chosen topic produces activity, not insight, so the taxonomy generates its own agenda. Every situation carries a `disagreement_type` naming why the perspectives diverge: definitional (different meanings for the same term), interpretive (shared observations, divergent conclusions), or structural (disagreement about institutional design). The type selects the debate strategy. Definitional disagreements suit Socratic definition-forcing; interpretive ones need simultaneous three-way engagement; structural ones yield the richest convergence under deliberation protocols. A divergence score computed from interpretation distance, BDI layer distribution, conflict saturation, and debate coverage ranks every situation by expected productivity, closing the loop into topic selection. Situations point to productive disagreements, debates test them, and the results feed back into the scoring. During setup, dominant intellectual-lineage clusters (11 families, 55 clusters over 1,501 lineage references) act as a tiebreaker that surfaces tradition-relevant nodes without overriding relevance (topical).

### Assuming Fallibility: QA Everywhere

The system's working assumption is that any LLM output may be hallucinated, malformed, or incomplete. An epistemic infrastructure whose components can silently fabricate does not harvest wisdom; it launders noise into authority. Five principles govern:

1. **Constrain before generating**: structured output modes, response schemas, citation banks enumerating what may be cited. The cheapest hallucination is the one made structurally impossible.
2. **Validate at every boundary**: per-stage schema validators, entailment checks that extracted claims are actually supported by source text, citation-bank verification, node-reference sanitization, and confidence-gated per-claim extraction instead of single-shot summarization.
3. **Repair before regenerating**: defensive parsing, micro-fixes for bounded defects, regeneration only as a last resort and always with hints naming what failed.
4. **Stage, then merge**: bulk enrichment writes to staging files that are schema-validated and screened for sycophantic convergence before production data is touched; debates checkpoint continuously and resume across crashes.
5. **Record everything**: every failure path writes to a flight recorder; every pipeline stage carries provenance. A bad output is a diagnosable event, not a mystery.

The same discipline turns inward. Wachsmuth-grounded calibration metrics, sycophancy guards, structural-error and entailment-pass rates, and validation reports on every release candidate subject the system to the scrutiny it applies to its inputs.

### Wisdom Harvesting: The Closed Loop, Human-Gated

The loop is the system's most distinctive feature. Documents are extracted into structured knowledge, debates test that knowledge under adversarial pressure, reflection converts the outcomes into proposals, and the updated taxonomy grounds the next debate. The taxonomy grows by adversarial refinement, not accumulation. Arguments that survive challenge from three structurally different perspectives attain the strongest coherence the corpus can confer, which is the precondition for wisdom on this document's own terms, not yet wisdom itself.

This is where digestion happens. A debate is an experience, and when it ends each POV reflects on what it lived through and proposes how the experience should update its beliefs, desires, and intentions. The reflect step never writes to the taxonomy directly. Concession harvests, crux-to-situation promotions, revised descriptions, and new edges all land in a review queue, where a human reviews each proposal, edits it where needed, and accepts or rejects it before anything changes. The machine proposes; the human disposes. In the terms declared at the outset, the debate is the experience, the reflection is the digestion, and the human gate decides what the system actually absorbs.

The gate serves two functions. It is quality control on inputs the loop will compound, since a bad node poisons every future debate that injects it. And it places authority honestly, since the system's judgments are calibration signals, not verdicts. Node metadata is further validated by automated cross-checks and dual-model verification passes across the 785 POV nodes' eleven graph attributes.

The harvest has a consumer as well as a gatekeeper. The loop ends at a human researcher reading crux aggregations, doctrinal-versus-evidential gaps, and recurring fault lines. Every prior epistemic infrastructure serves a human community of practice. This one, today, serves a community of one; the lineage section below treats that as the central unmet condition, not a footnote.

---

## Why "Rosetta Stone"

The original Rosetta Stone enabled translation between three scripts encoding the same decree. This system enables translation between three intellectual traditions engaging the same phenomena. Each tradition speaks a different language of salience, and, as the vocabulary layer makes literal, often a different language outright: the same words carrying different senses, with the controlled vocabulary as the translation table. The system does not resolve which language is correct. It makes all three legible simultaneously, showing where they converge, where they genuinely diverge, and what would resolve the divergence.

---

## The Lineage, as Aspiration

The AI Rosetta Stone aspires to a lineage of epistemic infrastructure:

| Infrastructure | What It Engineers | What It Harvests |
|---|---|---|
| **Socratic dialectic** | Assumption visibility | Examined beliefs |
| **Scientific method** | Falsifiability | Reliable empirical knowledge |
| **Double-entry bookkeeping** | Financial transparency | Accurate accounts |
| **Formal logic** | Inference validity | Sound conclusions |
| **Common law** | Precedent-tested interpretation | Legal wisdom |
| **Peer review** | Adversarial scrutiny | Validated findings |
| **AI Rosetta Stone** *(aspirant)* | Multi-perspectival relevance and salience | Structured, tested disagreement |

Each entry shares a property. None contains wisdom; each creates the conditions under which wisdom can emerge. The table must be read honestly, though, because membership is not conferred by structural resemblance. Every prior entry became infrastructure through adoption by a community of practice over generations; adoption is constitutive, not incidental. By that standard the AI Rosetta Stone is not yet a member. It is a research prototype serving a single researcher, and its row is an aspiration whose entry fee, itemized in the boundary section, is validated instruments, crux correspondence with real discourse, and a community that finds its structures worth adopting. What the table legitimately claims is narrower and still worth claiming. The kind of thing this system is trying to become has precedent, and the precedents specify what earning membership requires.

---

## The Claim, Precisely

The AI Rosetta Stone is epistemic infrastructure that:

1. **Engineers relevance** by decomposing claims into epistemic kinds (BDI), computing relevance (dialectical) through formal argumentation, and distilling discourse into relevance (counterfactual) at the cruxes.

2. **Engineers salience** by maintaining three structurally different worldviews simultaneously, translating between them through shared situation nodes and a controlled vocabulary, and aligning registers so that content, not surface form, determines what is matched.

3. **Harvests candidate wisdom** by subjecting its own knowledge to adversarial scrutiny, routing what survives through a human gate, and iterating, with the cruxes marking where the loop must hand its questions to the world.

The result is not a database of positions (information) or a map of who believes what (knowledge). It is a living, adversarially refined account of where AI policy discourse, as reconstructed and stress-tested inside the system, agrees, disagrees, and pivots, together with the specific questions whose answers would move it. That account is experience digested under supervision. Within the boundary drawn at the start, the wisdom on offer is structural rather than veridical, corpus-bound rather than world-anchored, and valuable because it identifies where the world's own testimony must be brought in.
