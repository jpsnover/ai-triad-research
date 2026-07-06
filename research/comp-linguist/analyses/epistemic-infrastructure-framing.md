# The AI Rosetta Stone as Epistemic Infrastructure: Engineering Relevance and Salience to Harvest Wisdom

## The Argument

Epistemic infrastructure is the set of structures, conventions, and tools that shape how communities produce, test, and transmit knowledge. Writing systems, the scientific method, double-entry bookkeeping, common law precedent, peer review — these are all epistemic infrastructure. They don't contain knowledge; they create the conditions under which knowledge becomes wisdom.

The AI Rosetta Stone is epistemic infrastructure for multi-perspective policy analysis. Its purpose is not to store information about AI policy (a database could do that) or to generate arguments (a chatbot could do that). Its purpose is to **provide the structural conditions** — specifically, engineered relevance and salience — under which the wisdom embedded in AI policy discourse becomes accessible, testable, and actionable.

---

## What Relevance and Salience Mean Here

**Relevance** is the answer to "what matters?" In a corpus of more than 650 documents spanning three radically different intellectual traditions, everything is potentially relevant to everything else. Without engineering, relevance is flat — every claim has equal weight, every connection is equally plausible, and the human mind drowns in undifferentiated information. Relevance engineering creates hierarchy: *this* argument is stronger than *that* one; *this* claim addresses the actual disagreement while *that* one talks past it; *this* evidence is grounded while *that* one is asserted.

**Salience** is the answer to "what stands out?" Even among relevant information, only a fraction is salient — worthy of attention at this moment, in this context, for this purpose. Salience is perspectival: what stands out to an accelerationist (scaling potential, capability unlock) is invisible to a skeptic (institutional capture, labor displacement), and vice versa. Without salience engineering, each perspective sees only its own figure against its own ground. The Rosetta Stone makes all three salience frames simultaneously visible.

**Wisdom** is what remains after relevance and salience have done their work. It is not the accumulation of facts (that's information) or the organization of facts into patterns (that's knowledge). Wisdom is understanding which facts matter, why they matter differently to different people, where the irreducible disagreements lie, and what would have to change for those disagreements to resolve. Wisdom is the epistemic residue of structured adversarial inquiry.

---

## How Each Component Engineers Relevance and Salience

### BDI Decomposition: Making Kinds of Relevance Explicit

The Belief-Desire-Intention decomposition is the system's first act of relevance engineering. When a claim enters the system, BDI classification asks: *what kind of claim is this?*

- Is it an empirical assertion about how the world is? (Belief)
- Is it a normative commitment about what should happen? (Desire)
- Is it a strategic proposal about how to act? (Intention)

This matters because different kinds of claims are relevant in different ways. You can refute a Belief with evidence but not a Desire. You can challenge an Intention's feasibility but not its values. By decomposing claims into their BDI types, the system prevents the most common failure of policy discourse: arguing about evidence when the disagreement is actually about values, or arguing about values when the disagreement is actually about strategy.

BDI is the coarse decomposition. Within it, each node carries a finer-grained `epistemic_type` — empirical claim, normative prescription, strategic recommendation, predictive, definitional, or interpretive lens — that tells debate agents *how* to argue. An empirical claim demands evidence; a normative prescription demands coherence with stated values; a strategic recommendation demands feasibility analysis; a definitional claim demands terminological precision. Each node also carries its key `assumes` — the unstated premises it depends on — giving opponents pre-identified attack surfaces for UNDERCUT moves. These metadata layers turn each taxonomy node from a static description into an actionable argumentative resource.

This is epistemic infrastructure at its most fundamental: it structures how the reader perceives an argument, making visible the *kind* of disagreement that would otherwise be collapsed into "I disagree."

### Three-POV Structure: Engineering Perspectival Salience

The three perspectives — accelerationist, safetyist, skeptic — are not just labels. Each is a complete BDI worldview: a structured set of beliefs about how AI works, desires about what society should prioritize, and intentions about how to achieve those goals. The same phenomenon (e.g., "AI governance") is salient to each perspective for completely different reasons:

- To the accelerationist: a potential innovation bottleneck
- To the safetyist: essential gating for high-risk systems
- To the skeptic: a capture risk requiring independent oversight

The system's situation nodes — shared concepts carrying three BDI-decomposed interpretations — are the architectural embodiment of salience engineering. They don't resolve which interpretation is "correct." They hold all three simultaneously, making visible what each perspective foregrounds and what it backgrounds. This is the Rosetta Stone function: translation between salience frames.

### QBAF Strength Propagation: Computing What Matters

The Quantitative Bipolar Argumentation Framework is the system's relevance engine. Every claim enters the argument network with a base strength. Attacks reduce it; supports increase it. Strength propagates through the network — a claim attacked by a strong, well-supported counterargument loses more strength than one attacked by a weak assertion.

The result: a computed relevance ranking over all arguments in the debate. Not hand-ranked by a human curator. Not ranked by an LLM's intuition. Ranked by the formal structure of the argumentation itself — which claims survived adversarial scrutiny, which were undermined, which were never engaged.

QBAF also drives a second relevance function: **taxonomy node selection**. Rather than scoring the entire 1,197-node taxonomy against a blended topic query (which produces low-precision scores), the system embeds each argument network claim individually and scores every taxonomy node against every active claim, taking the maximum. A taxonomy node that is highly relevant to *any* argument in the debate gets surfaced — even if it's irrelevant to the original topic string. As the debate evolves and new arguments emerge, the taxonomy nodes that the system presents to each agent shift to match the actual discourse trajectory, not the static topic. This means the relevance engineering is dynamic: the system gets *more precise* about what matters as the debate progresses and the argument network grows.

This is relevance engineering through argumentation: the system computes what matters by testing what survives.

### Adversarial Debate: The Socratic Engine

The debate system implements the oldest epistemic infrastructure for wisdom: structured dialectic. Socrates didn't possess wisdom; he created the *conditions* under which wisdom could emerge — by asking questions, testing assumptions, and forcing interlocutors to make their reasoning explicit.

The AI Rosetta Stone does this computationally. Three agents with genuinely different worldviews — not just different prompts, but different structured taxonomies, different BDI profiles, different salience frames — engage each other under formal rules:

- **Commitment tracking** prevents silent self-contradiction (you can't quietly abandon what you asserted)
- **Convergence diagnostics** detect when arguments are recycling (no new wisdom being generated) and force phase transitions
- **Crux identification** surfaces the pivot points — the specific factual or conceptual claims that, if resolved, would change both sides' positions
- **Sycophancy detection** guards against false consensus — wisdom requires genuine disagreement, not accommodation

These rules have an enforcer. An active moderator presides over the exchange with a taxonomy of fourteen intervention moves: it detects when the debate drifts off the topic's scope, when debaters talk past each other rather than engaging, and when a phase has stopped producing new material — and it issues directives that the next turn must visibly address. Compliance is not left to good intentions: each debater's plan must state how it will answer an outstanding directive, and the response is checked mechanically before the turn is accepted. The moderator holds no position on the debate's substance; like a judge, its authority is entirely procedural — which is exactly what makes it epistemic infrastructure rather than a fourth debater.

The debate is not trying to determine who is "right." It is providing the epistemic conditions under which the *structure* of the disagreement becomes visible. Where do these perspectives genuinely conflict? Where do they agree without realizing it? What would have to be true for one side to update?

### Arguing Like a Lawyer: The Staged Turn Pipeline

A debater's turn is not a single LLM call. It is a pipeline of narrow stages modeled on how a litigator prepares: **brief → plan → draft → quality gates → cite**, with a surgical **micro-fix** stage for repairs. The design principle: give the model the minimum context needed for one specific action, and wrap each action in its own quality check. Minimizing context per step is relevance and salience engineering applied to the system's own reasoning — a model asked to do one thing, holding only the material that matters for that thing, cannot lose the instruction in the middle of a crowded prompt.

- **Brief.** The debater's case brief: a situation assessment naming the claims on the table, the standing commitments of each speaker, and the argumentative tensions worth engaging. No prose is written yet.
- **Plan.** Litigation strategy: a strategic goal, the specific argumentative moves to make, target claims, anticipated responses — and, when the moderator has issued a directive, how this turn will address it. The plan is the source of truth for the turn's moves; they are declared here, not inferred afterward from the prose.
- **Draft.** Only now is the statement written — along with claim sketches, key assumptions each tagged with what follows if they are wrong, and the kind of disagreement being pressed (empirical, values, definitional).
- **Quality gates.** The draft faces the lookahead gate (would committing this move measurably improve the argument network?), a draft-quality check, and off-scope drift classification. A failing draft is not blindly retried: the gate produces targeted hints naming the weakest component, and regeneration is steered by them.
- **Cite.** The statement is grounded: taxonomy references are validated against a citation bank of nodes that actually exist — a hallucinated node ID cannot survive this stage — moves are annotated, and a grounding-confidence score is attached to the turn.
- **Micro-fix.** Specific, bounded defects (a claim left abstract, a directive left unaddressed) are repaired surgically rather than by regenerating the whole turn, preserving everything that was already good.

Each stage boundary is also a validation boundary — schemas checked, outputs parsed defensively, failures retried with stage-specific repair prompts — and each stage can run on a different model, so an inexpensive model can assemble the brief while a stronger one writes the draft. The pipeline is where this essay's two themes meet at the finest grain: relevance and salience engineered per call, and quality assured per step.

### Cruxes: Distilled Relevance

A crux is the system's most concentrated unit of relevance engineering. It answers: "If you could resolve exactly one question, which question would change the most minds?"

A debate about AI regulation might surface dozens of arguments. But the crux might be: *"Can pre-deployment testing be made fast enough to not significantly delay release cycles?"* If that factual question were answered, accelerationists and safetyists would both update their positions. The crux distills an ocean of argumentation into the single most relevant question.

The system locates that crux by *intervention*: it removes each pivotal argument from the network and recomputes what survives, and the argument whose removal most changes the outcome is the crux — the claim with the largest causal contribution to the debate's resolution. Treating the argument network as a causal model this way (cf. ARGORA, Jin et al., 2026, which independently arrives at the same remove-and-recompute diagnostic) turns crux-finding from an intuition into a computation.

Across debates, cruxes aggregate. The system tracks which cruxes recur — these are the structural fault lines of AI policy discourse, the deep disagreements that no single debate resolves. These recurring cruxes are where wisdom lives: not in any one answer, but in the precise articulation of what remains contested and why.

### Strategic Evaluation: Game-Theoretic Wisdom Extraction

The components described above -- BDI decomposition, QBAF propagation, adversarial debate, crux identification -- create the structural conditions for wisdom. But structural conditions are necessary, not sufficient. A debate can have all the right components and still degenerate: agents recycle their strongest-sounding positions, flood the argument network with low-value claims, or concede tactically without genuinely updating. The system needs a mechanism that evaluates not just the *structure* of the discourse but the *strategic quality* of each move within it.

This is where game-theoretic evaluation enters -- not as an optimization framework that turns agents into utility maximizers, but as a **quantitative diagnostic lens** for distinguishing genuine epistemic progress from its mimicry.

Each agent carries a per-turn utility function composed of three signals: **position strength** (the mean computed strength of that agent's surviving argument nodes), **attack effectiveness** (the fraction of opponent nodes weakened below viability), and **crux engagement** (the fraction of identified cruxes the agent has directly addressed). These are not rewards the agent optimizes against; they are measurements the system takes of the argument network's state from each agent's perspective. The crucial insight is that the *ratio* between these components reveals strategic posture. An agent with high attack effectiveness but low crux engagement is scoring rhetorical points without advancing understanding. An agent with high crux engagement but stagnant position strength is engaging the right questions but failing to move the discourse. An agent whose position strength rises while crux engagement falls is winning by avoidance -- the most corrosive failure mode for wisdom extraction.

The utility function's deepest contribution is temporal. Plotted across rounds, utility curves expose what no single-turn metric can: **stagnation** (flat curves despite available cruxes), **runaway dominance** (one agent's utility monotonically rising while others decline, suggesting the debate has become a monologue with spectators), and **disengagement** (declining utility without corresponding opponent pressure, indicating the agent has retreated from the contested ground).

Critically, the system applies a **lookahead gate** that rejects low-value moves before they enter the argument network. After an agent generates a draft response, the system tentatively computes the utility delta -- would committing this move measurably improve the argument network's state? If the delta falls below a minimum threshold, the move is rejected and regenerated with targeted hints identifying the weakest component. This is relevance engineering at the most granular level: not just filtering which taxonomy nodes enter the debate (salience), not just computing which arguments survive scrutiny (relevance), but gatekeeping which *individual moves* merit inclusion in the epistemic record.

The game-theoretic layer also introduces **anti-exploit defenses** that protect calibration integrity. Three failure patterns receive dedicated detection: *filibustering* (flooding the network with low-strength claims), *dialectical drift* (steering toward terrain where one agent has rhetorical advantage), and *preference faking* (conceding cheap nodes to extract valuable counter-concessions). Each defense operates as a calibration signal rather than a hard block: the pattern is surfaced, quantified, and made visible for interpretation.

This reflects a deliberate architectural choice. The debate system is **structured cooperation with adversarial stress-testing** -- agents pursue genuinely different positions under formal rules that prevent adversarial dynamics from collapsing into either domination or accommodation. The game-theoretic layer provides the metrics to diagnose *where on the cooperative-adversarial spectrum* each agent is operating, and to intervene when the balance tips too far in either direction. Too adversarial, and agents optimize for attack effectiveness over crux engagement -- the debate generates heat. Too cooperative, and agents accommodate rather than challenge -- the debate generates false consensus. The utility function, the lookahead gate, and the anti-exploit defenses collectively maintain the productive tension between these poles, which is the zone where wisdom emerges.

### Affect and Emotional Register: Engineering Phase-Appropriate Rhetoric

Wisdom extraction is not only a matter of *what* is argued but *how* — the emotional register in which a claim is pressed. A confrontation that opens in measured tones and a concluding synthesis that erupts in outrage are both malfunctions of the discourse, independent of the propositional content. The system makes emotional register a **measurable, phase-relative property** of each speaker turn rather than an impression left on the reader.

Each statement is scored across five affect dimensions — urgency, fear, hope, outrage, and empathy — from lexical signals. This operationalizes the *Emotional Appeal* dimension of Wachsmuth et al.'s (2017) computational argument-quality taxonomy — the same framework from which the system derives its *Clarity* calibration metrics (readability, lexical diversity, jargon density) and its *Credibility* metrics (source-authority and recency scoring). Grounding these measures in an established argumentation-quality standard, rather than ad hoc heuristics, is what lets the system claim its rhetorical-register judgments are principled rather than improvised. Two derived measures give the register meaning. **Affect intensity** weights the dimensions by their capacity to distort reasoning (fear and outrage count most, hope and empathy least), yielding a single "temperature" for the turn. **Phase appropriateness** compares the turn's affect profile against a baseline for the debate's current phase: confrontation tolerates more urgency and outrage; argumentation expects a shift toward hope and empathy as positions are built; concluding should be warmest and least inflammatory. A concluding turn heavy with outrage is flagged not because outrage is forbidden but because it is *out of phase* — a signal that the debate is generating heat where it should be consolidating light.

This is register engineering in service of the same goal as the rest of the system: separating productive disagreement from its degenerate forms. Because every affect score is computed from the specific terms it matched, the register judgment is auditable — a reviewer can see exactly which words drove a "high outrage" reading and decide whether the alarm is warranted. Affect is measured only on the debaters' own turns; the moderator's and system's procedural prose carry no emotional register of their own and are excluded from the metric.

### The Three Weights: Evidential Authority, Values Architecture, Actionability

BDI decomposition tells you what *kind* of claim you are looking at. Three scalar weights answer the questions that remain. **Confidence** asks: how well-supported is this Belief? **Priority** asks: how important is this Desire? **Operationality** asks: how actionable is this Intention?

Before the weights existed, the taxonomy treated all claims within a category as epistemically equal. "Current AI models require massive compute" — an empirical finding replicated across every major lab — entered the debate engine with the same standing as "AI will achieve recursive self-improvement," a speculative extrapolation. "Preventing AI-driven extinction" occupied the same structural tier as "Improving AI documentation." Each weight makes the missing distinction a *computable property* of the node, derived from metadata the system already maintains rather than from anyone's opinion. Confidence draws on a Belief's epistemic type and falsifiability, the breadth of its evidence base, its survival record in prior debates, and its structural position in the graph; entering the QBAF as base strength, it makes established findings hard to dismiss and makes a position built on a single speculative premise a visible structural weakness. Priority places each Desire on a five-level scale from identity-constituting commitments down to readily conceded preferences — perspectival by design ("maximizing innovation speed" is mid-tier for accelerationists, low-tier for safetyists, and that asymmetry is itself informative) — so the system can tell a genuine values dilemma from a tension that dissolves once the hierarchy is explicit, and can flag the concession of a core commitment as the major event it is. Operationality scores each Intention from tree position, falsifiability, and situation grounding, separating concrete testable proposals from the abstract umbrella framings that organize them. All three weights evolve conservatively through debate outcomes: claims that survive adversarial scrutiny rise; those that are undermined, or that cannot be made concrete under pressure, fall.

The most consequential piece is **doctrinal anchoring**, where the values architecture meets the evidence. Each debater carries doctrinal boundaries — non-negotiable, identity-constituting positions — and a Belief that instantiates one receives a confidence floor. A doctrinally anchored Belief might carry an evidential confidence of 0.20 while its effective confidence is held at 0.60; the system displays both numbers rather than hiding the gap. This is a faithful model of how intellectual commitments actually work — real policy actors hold under-evidenced positions that are load-bearing for their worldview — and it lets the system distinguish "won't concede because the evidence supports me" from "won't concede because this is constitutive of who I am." Collapsing that distinction is one of the most common failures in policy analysis.

Together the weights complete what BDI begins. BDI tells you what kind of claim; confidence, how well-supported; priority, how important; operationality, how actionable; doctrinal anchoring, where evidential authority and values commitment diverge. And they compose: a Desire rated priority 5 ("Preventing AI-driven extinction") served only by Intentions rated operationality 2 ("Establishing broad safety norms") reveals that a camp's most important value rests on its most abstract strategies — a structural insight visible only when all three weights are present, and precisely the kind the epistemic infrastructure exists to surface.

### Situation-Driven Topic Discovery: The Taxonomy as Wisdom Generator

The preceding components describe how the system engineers relevance and salience *within* a debate. But there is a prior question: **what should the system debate?** A perfectly calibrated debate engine running on a poorly chosen topic produces activity, not wisdom.

The answer is to treat the taxonomy itself as a source of debate topics -- not a passive knowledge store that waits for external queries, but an active generator of its own most productive lines of inquiry.

Every situation node in the taxonomy carries three POV-specific interpretations along with a `disagreement_type` classification that names *why* the perspectives diverge: definitionally (they mean different things by the same term), interpretively (they agree on what something is but disagree on what it means), or structurally (they disagree about institutional arrangements and governance design). Each interpretation is itself BDI-decomposed — the accelerationist, safetyist, and skeptic readings of a situation each break out into their own belief, desire, and intention, so the disagreement is legible at the level of *what kind* of claim diverges, not just *that* the readings differ. This decomposition is now corpus-wide: all 411 non-deprecated situation nodes carry BDI-structured per-POV interpretations, so situation-driven topic discovery draws on a fully decomposed corpus rather than the partial coverage it began with. A situation node with divergent interpretations is, structurally, a pre-scored debate topic with built-in multi-perspective grounding.

The `disagreement_type` functions as a **debate strategy selector**. Definitional disagreements are best served by Socratic dialogue that forces each perspective to articulate its definition before cross-examination -- the wisdom output is sharper genus-differentia descriptions. Interpretive disagreements require simultaneous three-way engagement, because the disagreement lives in the inferential bridge between shared observations and divergent conclusions -- the wisdom output is surfaced assumptions. Structural disagreements produce the richest convergence signals under deliberation protocols, because they force agents to propose specific mechanisms, creating surface area for partial agreement.

A situation divergence score -- computed from interpretation distance, BDI layer distribution, conflict saturation, and debate coverage -- ranks every situation by **wisdom potential**. The result is a closed loop that extends the wisdom-harvesting cycle into topic selection itself: situations identify where the most productive disagreements lie, linked conflicts identify what claims are in tension, debates test those claims, and the results feed back into situation scoring for the next cycle. The taxonomy does not merely store what has been learned; it identifies what should be investigated next -- generating the agenda for its own inquiry.

The lineage pipeline that feeds this process is now fully operational. Intellectual lineage items -- 1,501 references to research traditions and schools of thought -- are organized into a three-tier hierarchy (11 families, 55 embedding-based clusters, 1,501 items). During debate setup, the dominant Level 2 clusters for a given topic shape relevance scoring: nodes whose lineage aligns with the debate's intellectual context receive a near-miss relevance boost, functioning as a tiebreaker that surfaces tradition-relevant content without overriding semantic relevance. Flight recorder observability captures the full pipeline -- from cluster distribution through relevance adjustments to context admission decisions -- making the lineage signal auditable at every stage.

### Genus-Differentia Descriptions: Salience at the Linguistic Level

Every taxonomy node follows a structured format:

> "A [Belief|Desire|Intention] within [POV] discourse that [differentia]. Encompasses: [scope]. Excludes: [boundaries]."

This is salience engineering at the sentence level. The genus (BDI category + POV) tells you *what kind of thing this is* and *whose perspective it represents*. The differentia tells you *what makes it distinct from its neighbors*. The Encompasses/Excludes clauses draw explicit boundaries — *this concept covers X but not Y*.

Vagueness is the enemy of wisdom. A claim like "AI has risks" has zero salience — it means everything and nothing. "A Belief within safetyist discourse that current alignment techniques are insufficient for systems displaying emergent goal-directed behavior. Encompasses: mesa-optimization, reward hacking, deceptive alignment. Excludes: near-term bias and fairness concerns" — this has maximum salience. You know exactly what it means, what it covers, what it doesn't, and whose perspective it represents.

### Assuming Fallibility: Quality Assurance as Epistemic Infrastructure

Everything above depends on LLM outputs, and the system's working assumption is that any LLM output may be hallucinated, malformed, or incomplete. This is not pessimism; it is the same posture peer review takes toward manuscripts and auditing takes toward books. An epistemic infrastructure whose components can silently fabricate does not harvest wisdom — it launders noise into authority. The QA discipline runs on five principles:

1. **Constrain before generating.** Structured output modes, response schemas, and citation banks that enumerate what may be cited. The cheapest hallucination to catch is the one made structurally impossible.
2. **Validate at every boundary.** No LLM output enters the epistemic record unchecked: per-stage schema validators in the turn pipeline, entailment checks verifying that extracted claims are actually supported by the source text, citation-bank verification, sanitization of taxonomy node references, and confidence-gated per-claim extraction in place of single-shot summarization.
3. **Repair before regenerating.** Malformed output is parsed defensively and recovered where possible; bounded defects get micro-fixes; when regeneration is unavoidable, it ships with hints naming exactly what failed. Wholesale regeneration discards good material along with bad, so it is the last resort, not the reflex.
4. **Stage, then merge.** Bulk AI enrichment writes to staging files that are schema-validated — and screened for sycophantic convergence — before any production data is touched. Debates checkpoint continuously and can be resumed after a crash without losing the record.
5. **Record everything.** Every failure path writes to a flight recorder, and every pipeline stage carries provenance, so a bad output is a diagnosable event rather than a mystery.

The same discipline turns inward: the system measures its own epistemic health. Calibration metrics grounded in Wachsmuth et al.'s argument-quality taxonomy, sycophancy guards, structural-error and entailment-pass rates, and validation reports on every release candidate subject the system itself to the skeptical scrutiny it applies to its inputs. This is what earns the word *infrastructure*: the wisdom the system harvests is trustworthy because every step that produced it was checked — and the checking is itself checked.

### The Closed Loop: Wisdom Harvesting

The system's most distinctive feature is the closed loop: **seed → grow → debate → reflect → grow → debate → reflect...**

This is the wisdom harvesting mechanism:

1. **Documents** provide raw information
2. **Extraction** converts information into structured knowledge (taxonomy nodes with BDI types, genus-differentia descriptions, typed edges)
3. **Debate** tests that knowledge under adversarial pressure — which claims survive? which crumble? what's missing?
4. **Reflection** converts the debate's insights into taxonomy updates — nodes revised, added, qualified, or deprecated based on what survived
5. **The updated taxonomy** becomes the ground for the next debate, which tests it again

Each cycle harvests wisdom by subjecting the system's current understanding to adversarial scrutiny and incorporating what survives. The taxonomy doesn't grow by accumulation (that would produce information); it grows by adversarial refinement (that produces wisdom). Arguments that are never challenged are untested knowledge. Arguments that survive challenge from three structurally different perspectives approach wisdom.

The quality of this loop depends on the quality of the taxonomy's metadata. Each of the 785 POV nodes carries 11 graph attributes — epistemic type, rhetorical strategy, falsifiability, scope, intellectual lineage, assumptions, audience, emotional register, steelman vulnerability, possible fallacies, and policy actions. These attributes are themselves subject to quality assurance: automated cross-validation flags anomalies (BDI×epistemic type mismatches, vocabulary leakage between fields, format inconsistencies), and dual-model LLM verification corrects misclassifications. The taxonomy is not just adversarially refined through debate — its internal metadata is validated through systematic quality passes that ensure the wisdom-harvesting machinery operates on clean inputs.

The harvest has a consumer. The loop does not end at an updated taxonomy; it ends at a human researcher reading crux aggregations, doctrinal-versus-evidential gaps, and the recurring fault lines of the discourse. Every prior epistemic infrastructure in the lineage below serves a human community of practice — scientists, accountants, judges — and this one is no different. The system's job is to make the structure of AI policy disagreement legible; deciding what to do about it remains, by design, a human act.

---

## Why "Rosetta Stone"

The original Rosetta Stone enabled translation between three writing systems — hieroglyphic, demotic, and Greek — that encoded the same decree. The AI Rosetta Stone enables translation between three intellectual traditions — accelerationist, safetyist, and skeptic — that engage the same phenomena.

Without the Rosetta Stone, each tradition is opaque to the others. Accelerationists see capability scaling as obvious progress; safetyists see it as obvious risk; skeptics see both framings as missing the institutional reality. Each speaks a different language of salience.

The system doesn't resolve which language is "correct." It makes all three legible simultaneously — through structured BDI worldviews, typed argumentation, QBAF strength propagation, and situation nodes with three interpretations. The wisdom is not in any single perspective but in the structured relationship between them: where they converge (shared ground), where they diverge (genuine disagreement), and what would resolve the divergence (cruxes).

---

## The Epistemic Infrastructure Lineage

The AI Rosetta Stone inherits from a lineage of epistemic infrastructure:

| Infrastructure | What It Engineers | What It Harvests |
|---|---|---|
| **Socratic dialectic** | Assumption visibility | Examined beliefs |
| **Scientific method** | Falsifiability | Reliable empirical knowledge |
| **Double-entry bookkeeping** | Financial transparency | Accurate accounts |
| **Formal logic** | Inference validity | Sound conclusions |
| **Common law** | Precedent-tested interpretation | Legal wisdom |
| **Peer review** | Adversarial scrutiny | Validated findings |
| **AI Rosetta Stone** | Multi-perspectival relevance and salience | Policy wisdom through structured adversarial inquiry |

Each entry in this lineage shares a property: it doesn't contain wisdom but creates the **conditions** under which wisdom can emerge. The scientific method doesn't know any facts — it structures how facts are tested. The Socratic method doesn't hold any truths — it structures how assumptions are examined. The AI Rosetta Stone doesn't hold any policy positions — it structures how competing perspectives are made legible, tested against each other, and refined through adversarial engagement.

---

## The Claim, Precisely

The AI Rosetta Stone is epistemic infrastructure that:

1. **Engineers relevance** by decomposing claims into their epistemic types (BDI), computing argument strength through formal argumentation (QBAF), and distilling discourse into its most consequential points (cruxes)

2. **Engineers salience** by maintaining three structurally different worldviews simultaneously, making visible what each perspective foregrounds and backgrounds, and translating between perspectives through shared situation nodes with multi-POV interpretations

3. **Harvests wisdom** by subjecting its own knowledge to adversarial scrutiny (debate), incorporating what survives (reflections), and iterating (the closed loop) — producing not just information or knowledge but understanding that has been tested under the strongest available opposition from each relevant perspective

The result is not a database of AI policy positions (that's information). It's not a map of who believes what (that's knowledge). It's a living, adversarially-refined understanding of where AI policy discourse genuinely agrees, where it genuinely disagrees, and what specific questions would need to be answered to resolve those disagreements. That is wisdom.

---

## Sources

- **Wachsmuth, H., Naderi, N., Hou, Y., Bilu, Y., Prabhakaran, V., Thijm, T. A., Hirst, G., & Stein, B. (2017).** Computational Argumentation Quality Assessment in Natural Language. *Proceedings of the 15th Conference of the European Chapter of the Association for Computational Linguistics (EACL 2017)*, 176–187. — The system's rhetorical-quality calibration metrics are direct operationalizations of dimensions in this three-family (Logical / Dialectical / Rhetorical) argument-quality taxonomy: *Emotional Appeal* → the affect / emotional-register metric (§ Affect and Emotional Register); *Clarity* → readability, lexical-diversity, and jargon-density scoring; *Credibility* → source-authority and recency scoring. A *Local Sufficiency* measure (Logical family) is in progress. The full metric-by-metric coverage audit against this framework lives in `docs/wachsmuth-calibration-mapping.md`.
- **Jin, Z., et al. — ARGORA (2026).** Causal/interventional treatment of argument networks; independently arrives at the remove-and-recompute crux diagnostic the system uses for crux identification (§ Cruxes).

---

*Drafted: 2026-05-06 · Reframed: 2026-05-11 · Updated: 2026-05-22 (game-theoretic strategy, situation-driven topic discovery) · Updated: 2026-05-25 (Belief confidence, Desire priority, doctrinal anchoring, Intention operationality, lineage pipeline) · Updated: 2026-07-01 (affect/emotional register metric; node counts refreshed to 770 POV / 1,182 total) · Updated: 2026-07-01 (causal/interventional framing of crux identification, cf. ARGORA) · Updated: 2026-07-06 (formalized Wachsmuth (2017) attribution across the rhetorical-quality metric family + added Sources section; situation BDI decomposition now corpus-wide, 411 non-deprecated nodes; counts refreshed to >650 documents / 785 POV / 1,197 total nodes) · Updated: 2026-07-06 (editorial restructure: merged the three weight sections into "The Three Weights"; added "Arguing Like a Lawyer" staged-turn-pipeline and "Assuming Fallibility" QA-philosophy sections; moderator coverage in Adversarial Debate; human-consumer note in Closed Loop) · Computational Linguist · AI Triad Research*
