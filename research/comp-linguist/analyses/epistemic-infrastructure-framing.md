# The AI Rosetta Stone as Epistemic Infrastructure: Engineering Relevance and Salience to Harvest Wisdom

## The Argument

Epistemic infrastructure is the set of structures, conventions, and tools that shape how communities produce, test, and transmit knowledge. Writing systems, the scientific method, double-entry bookkeeping, common law precedent, peer review: none of these contain knowledge. They create the conditions under which knowledge becomes wisdom.

The AI Rosetta Stone is epistemic infrastructure for multi-perspective policy analysis. Its purpose is not to store information about AI policy (a database could do that) or to generate arguments (a chatbot could do that). Its purpose is to provide the structural conditions, specifically engineered relevance and salience, under which the wisdom embedded in AI policy discourse becomes accessible, testable, and actionable.

---

## The Terms, Declared

This document uses "relevance" and "salience" **non-technically**, and says so up front rather than presenting one unstated sense as the plain meaning. Both words name developed theoretical traditions that this essay does not engage. Relevance has a forty-year apparatus in pragmatics (Sperber and Wilson's relevance theory, which trades cognitive effort against contextual effect); salience has an equally developed literature in discourse processing (Centering Theory, Ariel's accessibility theory, Gundel's givenness hierarchy, and Entman's framing-as-salience). Readers wanting those theories should go to those sources. Here the words are folk glosses: relevance is "what matters," salience is "what stands out."

Even as folk terms they cannot travel bare, because the system computes several distinct things under the name "relevance," and they are different mathematical objects with different units. The document therefore tags each use with its sense, applying to itself the same convention its vocabulary layer enforces on "safety" and "accountability":

- **relevance (dialectical)**: post-propagation argument strength under QBAF semantics. What survived scrutiny.
- **relevance (topical)**: embedding similarity between a text and a query. What is about the same thing.
- **relevance (marginal)**: the utility delta a candidate move would add to the argument network. What is worth saying next.
- **relevance (counterfactual)**: the change in outcome when an argument is removed. What the result depends on.

**Wisdom** also needs scoping. It is not the accumulation of facts (information) or the organization of facts into patterns (knowledge); it is understanding which facts matter, why they matter differently to different people, where the irreducible disagreements lie, and what would have to change for those disagreements to resolve. Used precisely, the wisdom this system can claim is **structural, not veridical**: it concerns the shape of the disagreement, not the truth of the contested claims. The next section draws that boundary before any component is described, so that what follows reads as claims rather than over-claims.

---

## The Boundary: Survival Is Not Truth

Everything below rests on one inference: a claim survived adversarial scrutiny, therefore it deserves elevated standing. That inference has a hard boundary, and it is drawn here, first.

What survives a debate in this system is what survives scrutiny by other LLM outputs, under rules the project wrote, over a corpus the project curated, argued by perspectives the project authored. QBAF propagation computes coherence within that constructed network; nothing in the loop touches the world. A claim can dominate the argument graph and be false. A claim can be annihilated in round two and be true. The scientific method, which appears in the lineage table at the end of this document, derives its authority from precisely what this loop lacks: an exogenous arbiter. Experiments touch reality. The reflect step touches the system's own prior outputs.

Two mitigations are real but must not be oversold. First, the loop's writes are human-gated: harvested proposals do not change the taxonomy until a person reviews, edits, and accepts or rejects them (see Wisdom Harvesting). A human gate filters error; it does not convert survival into evidence of truth, because the gatekeeper is one researcher, not the world. Second, the system's most important product points beyond itself. A crux is by definition a question the loop cannot resolve internally, so identifying one marks exactly where exogenous evidence, real experiments, and real institutional experience must be consulted. The loop's authority ends where the crux begins. That is not a failure of the design; it is its intended interface with reality.

The same discipline applies to the numbers. Eleven graph attributes, five affect dimensions, three utility signals, a five-level values hierarchy: every scalar implies a measurement instrument, and none has yet been validated against human judgment. Borrowing Wachsmuth's dimension names does not validate a lexicon; stipulating that fear distorts reasoning more than hope does not make it so. These numbers are calibration signals, internally consistent and auditable to their inputs, useful for comparing debates run under the same instrument. They are not validated measurements of rhetorical or epistemic reality. Likewise the computed crux is a sensitivity analysis over simulacra; whether it matches what would change a real policy actor's mind is an empirical question about real humans, on which the project currently has no data.

These obligations are tracked work, not gestures: affect-instrument validation against human raters with pre-registered retirement thresholds (t/1342), and a provenance register classifying every scalar as stipulated, derived, or human-validated (t/1343). So bounded, the system's products are **tested coherence** and **legible disagreement structure**. Everything that follows should be read in that frame.

---

## How the System Engineers Relevance and Salience

### BDI Decomposition: What Kind of Claim Is This?

When a claim enters the system, BDI classification asks what kind of claim it is: an empirical assertion about how the world is (Belief), a normative commitment about what should happen (Desire), or a strategic proposal about how to act (Intention). Different kinds are contestable in different ways: evidence can refute a Belief but not a Desire; feasibility can challenge an Intention but not its values. The decomposition prevents the most common failure of policy discourse, which is arguing about evidence when the disagreement is about values, or about values when it is about strategy. Within BDI, each node carries a finer `epistemic_type` (empirical, normative, strategic, predictive, definitional, interpretive) that tells debate agents how to argue, and its key `assumes`, the unstated premises that give opponents pre-identified attack surfaces for UNDERCUT moves.

### Three Perspectives, One Situation

The three perspectives (accelerationist, safetyist, skeptic) are complete BDI worldviews: structured beliefs about how AI works, desires about what society should prioritize, intentions about how to get there. The same phenomenon is salient to each for different reasons. "AI governance" is an innovation bottleneck to the accelerationist, essential gating to the safetyist, a capture risk to the skeptic. Situation nodes hold all three interpretations simultaneously, each decomposed into its own belief, desire, and intention; the decomposition is corpus-wide (all 411 non-deprecated situations). They do not resolve which interpretation is correct. They make visible what each perspective foregrounds and backgrounds. This is the Rosetta Stone function: translation between salience frames.

### The Vocabulary Problem: When One Word Is Three Words

The deepest form of talking past each other is not disagreeing about answers; it is using the same word for different questions. AI policy discourse runs on a small set of high-stakes terms (alignment, safety, risk, fairness, accountability), and each camp means something different by them. When an accelerationist says "safety," they typically mean empirical output verification; when a safetyist says it, they mean existential risk prevention. Any analysis that uses the bare term silently takes sides: it launders one camp's sense into the shared record as if it were the neutral one.

A **controlled vocabulary** forces the ambiguity into the open. Every ambiguous colloquial term is marked do-not-use-bare and fans out into standardized senses: "accountability" becomes *accountability (market)*, consumer choice and competitive pressure, the accelerationist default; *accountability (institutional)*, legal liability and regulatory mandate, the safetyist default; and *accountability (algorithmic)*, bias testing and impact assessment of specific systems, the skeptic default. Each sense carries its camp of origin, a definition, the characteristic phrases that signal it, and explicit do-not-confuse-with boundaries. Coinage is recorded in an append-only audit log; the disambiguator is calibrated against hand-labeled occurrences.

The translation pipeline applies the dictionary automatically, resolving bare terms where context is clear and *flagging* genuinely ambiguous uses for review rather than guessing. That refusal to guess is the epistemic point: an ambiguity surfaced is information; an ambiguity silently resolved is a bias. Enforcement reaches into the debates: each debater's prompt carries its camp's standardized terms, the cross-camp terms it may engage, and a blocklist of bare terms the system rejects. Readers always see the display form, "accountability (algorithmic)," never bare "accountability." When a disagreement turns out to be definitional rather than empirical or values-based, the system classifies it as such on situation nodes and debate turns alike.

This layer is the heart of the Rosetta Stone positioning: one term exists in three senses, and the infrastructure refuses to let any one sense masquerade as the plain meaning of the word. The sense-tagging of "relevance" earlier in this document is the same convention, applied to the essay itself.

### Register Alignment: The Semantic Gravity Well

Perspective is not the only thing that fractures meaning; register does too. Taxonomy nodes are written in DOLCE-derived genus-differentia form ("A Belief within safetyist discourse that [differentia]. Encompasses: ... Excludes: ..."), a deliberately precise register in which genus, differentia, and explicit boundaries replace vague labels. Debate claims arrive in colloquial argumentative prose. Embedding models are sensitive to that surface difference: texts separate in embedding space by register as well as by content, so a claim and the very node it instantiates can sit far apart while saying the same thing. Left uncorrected, this misalignment starves relevance (topical) matching.

The system corrects it with synthetic paraphrasing that acts as a semantic gravity well. Each extracted claim is rewritten into the taxonomy's own register: a genus-differentia rendering (`attribution_text_genus`) and a register-normalized canonical proposition, capped at thirty words, whose modal register matches the claim's BDI type. Matching runs on embeddings of the paraphrase rather than the raw utterance, so content similarity dominates register similarity: the paraphrases pull register-divergent surface forms of the same idea toward a common semantic center, where they can find each other. The complementary direction is planned (t/1299): generating colloquial per-POV statements around each situation, projecting taxonomy content into debate register from the other side of the gap.

### QBAF: Computing Relevance (dialectical)

Every claim enters the argument network with a base strength; attacks reduce it, supports increase it, and strength propagates, so a claim attacked by a strong, well-supported counterargument loses more than one attacked by a weak assertion. The result is a computed ranking of relevance (dialectical) over all arguments: which claims survived scrutiny, which were undermined, which were never engaged. The honest form of this claim needs one qualification: the propagation is mechanical, but not all of its inputs are innocent. Doctrinal anchoring (under The Three Weights) injects hand-authored confidence floors into base strength, and propagation carries that curated influence into every downstream ranking. The rankings are computed from declared inputs, including declared identity commitments, not conjured free of human hands.

QBAF also drives node selection. Rather than scoring the 1,197-node taxonomy against a blended topic query, the system embeds each argument-network claim individually and scores every node against every active claim, taking the maximum: relevance (topical) to *any* live argument surfaces a node, even one irrelevant to the original topic string. As the debate evolves, the injected taxonomy content tracks the actual discourse trajectory rather than the static topic.

### Adversarial Debate: The Socratic Engine

The debate system implements the oldest epistemic infrastructure for wisdom: structured dialectic. Three agents with genuinely different worldviews engage under formal rules. Commitment tracking prevents silent self-contradiction. Convergence diagnostics detect recycled arguments and force phase transitions. Crux identification surfaces the pivot points. Sycophancy detection guards against false consensus, because wisdom requires genuine disagreement, not accommodation.

These rules have an enforcer. An active moderator presides with a taxonomy of fourteen intervention moves: it detects scope drift, debaters talking past each other, and phases that have stopped producing new material, and it issues directives the next turn must visibly address. Compliance is checked mechanically, not left to good intentions. The moderator holds no position on the substance; like a judge, its authority is entirely procedural, which is what makes it infrastructure rather than a fourth debater.

The debate is not trying to determine who is right. It provides the conditions under which the structure of the disagreement becomes visible: where the perspectives genuinely conflict, where they agree without realizing it, and what would have to be true for one side to update.

### Arguing Like a Lawyer: The Staged Turn Pipeline

A debater's turn is not a single LLM call. It is a pipeline of narrow stages modeled on how a litigator prepares, and its design principle is to give the model the minimum context needed for one specific action, wrapped in its own quality check. Minimizing context per step is relevance and salience engineering applied to the system's own reasoning: a model asked to do one thing, holding only the material that matters for it, cannot lose the instruction in the middle of a crowded prompt.

- **Brief**: the case brief. Claims on the table, standing commitments, tensions worth engaging. No prose yet.
- **Plan**: litigation strategy. Goal, planned moves, target claims, anticipated responses, and how any moderator directive will be addressed. Moves are declared here, not inferred later from prose.
- **Draft**: the statement, plus claim sketches, key assumptions each tagged with what follows if wrong, and the kind of disagreement being pressed (empirical, values, definitional).
- **Quality gates**: the lookahead gate (relevance (marginal): would this move measurably improve the network?), a draft-quality check, and off-scope drift classification. Failing drafts get targeted hints naming the weakest component, not blind retries.
- **Cite**: grounding. Taxonomy references validated against a citation bank of nodes that actually exist (a hallucinated node ID cannot survive this stage), move annotations, a grounding-confidence score.
- **Micro-fix**: surgical repair of bounded defects without regenerating the turn.

Each stage boundary is a validation boundary, and each stage can run on a different model, so an inexpensive model can brief while a stronger one drafts.

### Cruxes: Relevance (counterfactual)

A crux answers: if you could resolve exactly one question, which would change the most minds *within the system's reconstruction of the discourse*? A debate about AI regulation might surface dozens of arguments, but the crux might be "can pre-deployment testing be made fast enough not to delay release cycles?" The system locates it by intervention: remove each pivotal argument, recompute what survives, and the argument whose removal most changes the outcome is the crux (cf. ARGORA, Jin et al., 2026, which independently arrives at the same remove-and-recompute diagnostic). Across debates, recurring cruxes mark the structural fault lines of the discourse, and, per the boundary above, they are the system's handoff to reality: the places where the world's own testimony must be brought in.

### Strategic Evaluation: Reading the Players

Structural conditions are necessary but not sufficient; a debate with all the right components can still degenerate into position-recycling, network-flooding, or tactical concession. A game-theoretic layer diagnoses this without turning agents into utility maximizers. Each agent carries a per-turn utility triple: position strength (mean relevance (dialectical) of its surviving nodes), attack effectiveness (opponent nodes weakened below viability), and crux engagement (identified cruxes directly addressed). The ratios reveal posture. High attack effectiveness with low crux engagement is scoring rhetorical points without advancing understanding; rising position strength with falling crux engagement is winning by avoidance, the most corrosive failure mode. Plotted across rounds, the curves expose stagnation, runaway dominance, and disengagement. Three anti-exploit patterns (filibustering, dialectical drift, preference faking) are detected and surfaced as calibration signals rather than hard blocks. The point of the layer is to hold the debate in the productive zone between too adversarial (heat) and too cooperative (false consensus).

### Affect: Phase-Appropriate Register

Wisdom extraction depends not only on what is argued but on the register in which it is pressed. Each statement is scored on five affect dimensions (urgency, fear, hope, outrage, empathy) from lexical signals, operationalizing the Emotional Appeal dimension of Wachsmuth et al. (2017), the same taxonomy from which the system derives its Clarity metrics (readability, lexical diversity, jargon density) and Credibility metrics (source authority, recency). A candor note: the taxonomy supplies dimension names and definitions, not validated instruments; lexicon scoring has known limits on sophisticated rhetoric, and these scorers await human-rater validation (t/1342). Affect intensity weights the dimensions by their presumed capacity to distort reasoning (fear and outrage most, hope and empathy least), a stipulated ordering, not a derived one. Phase appropriateness compares each turn's profile against phase baselines: confrontation tolerates more heat, concluding should be warmest and least inflammatory, and an out-of-phase register is flagged with the matched terms shown, so the judgment is auditable. Affect is measured only on debater turns; moderator and system prose are excluded.

### The Three Weights: Evidential Authority, Values Architecture, Actionability

BDI says what kind of claim you are looking at. Three scalar weights answer what remains: **confidence** (how well-supported is this Belief?), **priority** (how important is this Desire?), **operationality** (how actionable is this Intention?). Before the weights, "current AI models require massive compute" entered debates with the same standing as "AI will achieve recursive self-improvement," and "preventing AI-driven extinction" sat on the same tier as "improving AI documentation." Each weight is computed from metadata the system already maintains: confidence from epistemic type, falsifiability, evidence breadth, debate survival record, and graph position, entering the QBAF as base strength; priority on a five-level scale from identity-constituting commitments to readily conceded preferences, perspectival by design; operationality from tree position, falsifiability, and situation grounding, separating testable proposals from umbrella framings. All three evolve conservatively through debate outcomes.

The most consequential piece is **doctrinal anchoring**, where values meet evidence. Each debater carries non-negotiable, identity-constituting positions, and a Belief that instantiates one receives a confidence floor: evidential confidence 0.20, effective confidence held at 0.60, both numbers displayed. This is a faithful model of how commitments work; real policy actors hold under-evidenced positions that are load-bearing for their worldview, and the display separates "won't concede because the evidence supports me" from "won't concede because this is constitutive of who I am." One consequence stated plainly: because effective confidence enters the QBAF, the floor propagates, downstream strengths inherit curated influence, and only the node-level display shows the gap. Annotating doctrinal influence at the ranking level is an open item.

The weights compose: a Desire at priority 5 ("preventing AI-driven extinction") served only by Intentions at operationality 2 ("establishing broad safety norms") reveals that a camp's most important value rests on its most abstract strategies, a structural insight visible only when all three weights are present.

### Situations as Topic Generators

A calibrated debate engine running on a poorly chosen topic produces activity, not insight, so the taxonomy generates its own agenda. Every situation carries a `disagreement_type` naming why the perspectives diverge: definitional (different meanings for the same term), interpretive (shared observations, divergent conclusions), or structural (disagreement about institutional design). The type selects the debate strategy: definitional disagreements suit Socratic definition-forcing, interpretive ones need simultaneous three-way engagement, structural ones yield the richest convergence under deliberation protocols. A divergence score computed from interpretation distance, BDI layer distribution, conflict saturation, and debate coverage ranks every situation by expected productivity, closing the loop into topic selection: situations point to productive disagreements, debates test them, results feed back into the scoring. During setup, dominant intellectual-lineage clusters (11 families, 55 clusters over 1,501 lineage references) act as a tiebreaker that surfaces tradition-relevant nodes without overriding relevance (topical).

### Assuming Fallibility: QA Everywhere

The system's working assumption is that any LLM output may be hallucinated, malformed, or incomplete. An epistemic infrastructure whose components can silently fabricate does not harvest wisdom; it launders noise into authority. Five principles govern:

1. **Constrain before generating**: structured output modes, response schemas, citation banks enumerating what may be cited. The cheapest hallucination is the one made structurally impossible.
2. **Validate at every boundary**: per-stage schema validators, entailment checks that extracted claims are actually supported by source text, citation-bank verification, node-reference sanitization, confidence-gated per-claim extraction instead of single-shot summarization.
3. **Repair before regenerating**: defensive parsing, micro-fixes for bounded defects, regeneration only as last resort and always with hints naming what failed.
4. **Stage, then merge**: bulk enrichment writes to staging files that are schema-validated and screened for sycophantic convergence before production data is touched; debates checkpoint continuously and resume across crashes.
5. **Record everything**: every failure path writes to a flight recorder; every pipeline stage carries provenance. A bad output is a diagnosable event, not a mystery.

The same discipline turns inward: Wachsmuth-grounded calibration metrics, sycophancy guards, structural-error and entailment-pass rates, and validation reports on every release candidate subject the system to the scrutiny it applies to its inputs.

### Wisdom Harvesting: The Closed Loop, Human-Gated

The loop is the system's most distinctive feature: documents are extracted into structured knowledge; debates test that knowledge under adversarial pressure; reflection converts the outcomes into taxonomy updates; the updated taxonomy grounds the next debate. The taxonomy grows by adversarial refinement, not accumulation. Arguments that survive challenge from three structurally different perspectives attain the strongest coherence the corpus can confer, which is the precondition for wisdom on this document's own terms, not yet wisdom itself (see The Boundary).

The crucial word in "reflection converts outcomes into updates" is missing on purpose, because the reflect step does not write to the taxonomy. It writes **proposals**. Concession harvests, crux-to-situation promotions, revised descriptions, and new edges all land in a review queue, where a human reviews each proposal, edits it where needed, and accepts or rejects it before anything changes. The machine proposes; the human disposes. The gate serves two functions: quality control on inputs the loop will compound (a bad node poisons every future debate that injects it), and honest placement of authority, since the system's judgments are calibration signals, not verdicts. Node metadata is further validated by automated cross-checks and dual-model verification passes across the 785 POV nodes' eleven graph attributes.

The harvest has a consumer as well as a gatekeeper: the loop ends at a human researcher reading crux aggregations, doctrinal-versus-evidential gaps, and recurring fault lines. Every prior epistemic infrastructure serves a human community of practice. This one, today, serves a community of one; the lineage section below treats that as the central unmet condition, not a footnote.

---

## Why "Rosetta Stone"

The original Rosetta Stone enabled translation between three scripts encoding the same decree. This system enables translation between three intellectual traditions engaging the same phenomena. Each tradition speaks a different language of salience, and, as the vocabulary layer makes literal, often a different language outright: the same words carrying different senses, with the controlled vocabulary as the translation table. The system does not resolve which language is correct. It makes all three legible simultaneously: where they converge, where they genuinely diverge, and what would resolve the divergence.

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

Each entry shares a property: it does not contain wisdom but creates the conditions under which wisdom can emerge. But the table must be read honestly, because membership is not conferred by structural resemblance. Every prior entry became infrastructure through adoption by a community of practice over generations; adoption is constitutive, not incidental. By that standard the AI Rosetta Stone is not yet a member: it is a research prototype serving a single researcher. Its row is an aspiration, and the entry fee is itemized in The Boundary: validated instruments, crux correspondence with real discourse, and a community that finds its structures worth adopting. What the table legitimately claims is narrower and still worth claiming: the kind of thing this system is trying to become has precedent, and the precedents specify what earning membership requires.

---

## The Claim, Precisely

The AI Rosetta Stone is epistemic infrastructure that:

1. **Engineers relevance** by decomposing claims into epistemic kinds (BDI), computing relevance (dialectical) through formal argumentation, and distilling discourse into relevance (counterfactual) at the cruxes.

2. **Engineers salience** by maintaining three structurally different worldviews simultaneously, translating between them through shared situation nodes and a controlled vocabulary, and aligning registers so that content, not surface form, determines what is matched.

3. **Harvests candidate wisdom** by subjecting its own knowledge to adversarial scrutiny, routing what survives through a human gate, and iterating, with the cruxes marking exactly where the loop must hand its questions to the world.

The result is not a database of positions (information) or a map of who believes what (knowledge). It is a living, adversarially refined account of where AI policy discourse, as reconstructed and stress-tested inside the system, agrees, disagrees, and pivots, together with the specific questions whose answers would move it. Within the boundary drawn at the start, that is the wisdom on offer: structural rather than veridical, corpus-bound rather than world-anchored, and valuable precisely because it identifies where the world's own testimony must be brought in.

---

## Sources

- **Wachsmuth, H., Naderi, N., Hou, Y., Bilu, Y., Prabhakaran, V., Thijm, T. A., Hirst, G., & Stein, B. (2017).** Computational Argumentation Quality Assessment in Natural Language. *EACL 2017*, 176-187. The system's rhetorical-quality calibration metrics operationalize dimensions of this taxonomy: Emotional Appeal (affect), Clarity (readability, lexical diversity, jargon density), Credibility (source authority, recency), and Local Sufficiency (premise support, Tier-1). The taxonomy supplies dimension definitions; instrument validation is tracked separately (t/1342). Full coverage audit: `docs/wachsmuth-calibration-mapping.md`.
- **Jin, Z., et al. (2026).** ARGORA. Causal/interventional treatment of argument networks; independently arrives at the remove-and-recompute crux diagnostic used here.
- **Sperber, D., & Wilson, D. (1986/1995).** *Relevance: Communication and Cognition.* Named as the technical theory of relevance this document deliberately does not engage; usage here is declared non-technical.
- **Salience literatures** (not engaged, named for the same reason): Grosz, Joshi & Weinstein's Centering Theory; Ariel's accessibility theory; Gundel's givenness hierarchy; Entman's framing-as-salience.

---

*Drafted 2026-05-06 · major revisions 2026-05-11, 2026-05-22, 2026-05-25, 2026-07-01 · 2026-07-06: Wachsmuth attribution formalized; counts refreshed (>650 documents, 785 POV / 1,197 nodes, 411 situations BDI-decomposed); editorial restructure (weights merged, turn pipeline, QA philosophy, moderator, vocabulary sections); epistemic-honesty pass (Survival Is Not Truth, lineage as aspiration, doctrinal-floor disclosure, validation program t/1342 t/1343) · 2026-07-06 v2: terms declared non-technical with sense-tagged relevance (per Sperber & Wilson gap critique); boundary front-loaded; register-alignment (semantic gravity well) and human-gated harvesting added; condensed ~25% (6,100 to 4,500 words); em-dashes removed · Computational Linguist · AI Triad Research*
