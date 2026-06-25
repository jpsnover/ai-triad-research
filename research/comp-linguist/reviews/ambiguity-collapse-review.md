# Review: "Ambiguity Collapse by LLMs: A Taxonomy of Epistemic Risks"

**Authors:** Shira Gur-Arieh (Harvard Law), Angelina Wang (Cornell Tech), Sina Fazelpour (Northeastern)

**Core claim:** When LLMs encounter terms that genuinely admit multiple legitimate interpretations, they produce a single resolution — bypassing the human processes of deliberation, negotiation, and contestation that normally settle meaning. The authors call this *ambiguity collapse* and develop a taxonomy of epistemic risks at three levels: process, output, and ecosystem.

---

## Implications for AI Triad Research

### 1. The AI Rosetta Stone is architecturally anti-collapse

This paper provides the strongest theoretical validation of our system's design that I've seen. Nearly every epistemic risk they identify is something our architecture specifically prevents:

| Their Risk | Our Mitigation | How |
|---|---|---|
| **Deliberative Closure** — LLMs foreclose inquiry by resolving ambiguity | Three-POV adversarial debate forces sustained inquiry across interpretations | Debaters can't collapse to a single reading because opponents hold structurally different worldviews |
| **Epistemic Narrowing** — LLM surfaces only one interpretation | Situation nodes carry 3 POV interpretations simultaneously | The system never resolves which interpretation is "correct" |
| **Normative Smuggling** — LLM embeds hidden value judgments in disambiguation | BDI decomposition makes the *type* of claim explicit (Belief vs Desire vs Intention) | You can't smuggle a value judgment as fact when the system classifies it as a Desire |
| **Loss of Alternatives** — other reasonable readings disappear | Three complete BDI worldviews maintained in parallel | Each POV has its own beliefs, desires, and intentions — alternative readings are structurally preserved |
| **Loss of Residuals** — borderline cases forced into crisp categories | Crux identification surfaces exactly where the gray zone is | Cruxes are the system's way of saying "this is where reasonable people disagree and here's *why*" |
| **Interpretive Lock-In** — early resolution becomes downstream default | Adversarial refinement loop (debate → reflect → update taxonomy → debate again) | Each cycle challenges prior interpretations; the taxonomy is never "settled" |
| **Monoculture** — uniform resolution across models | Three structurally different agents with doctrinal boundaries | Prometheus, Sentinel, and Cassandra are architected to *never* converge on a single worldview |
| **Breakdown of Shared Meaning** — disambiguation fragments coordination | Situation nodes preserve shared reference while maintaining perspectival difference | The same concept (e.g., "AI governance") is simultaneously legible to all three perspectives |
| **Displacement of Interpretive Authority** — meaning-settling shifts to model designers | Human user controls the taxonomy, approves reflections, can accept/reject/edit proposals | The system proposes; the human decides. DOLCE compliance checks flag quality but don't override |

### 2. Their taxonomy validates our BDI decomposition

The paper's distinction between *ambiguity* (multiple discrete meanings) and *vagueness* (fuzzy boundaries) maps directly to our epistemic type system:

- **Ambiguity** → our `definitional` epistemic type + the DISTINGUISH move. When debaters encounter a term used in multiple senses, the system prompts them to distinguish which sense they mean.
- **Vagueness** → our `interpretive_lens` epistemic type + the REFRAME move. When a concept has fuzzy boundaries, the system surfaces competing interpretive frames rather than forcing a crisp boundary.

Their concept of "essentially contested concepts" (Gallie, 1955) — terms whose meaning is permanently and productively disputed — is exactly what our cross-cutting situation nodes model. "AI safety," "innovation," "responsible development" are essentially contested. Our system doesn't try to resolve them; it holds three structured interpretations simultaneously.

### 3. Their "normative smuggling" risk strengthens the case for FIRE

The paper's account of *normative smuggling* — where LLMs embed value judgments in what appear to be neutral disambiguations — directly supports our FIRE extraction confidence system (t/454). When an LLM extracts a claim from a source document, it may silently resolve an ambiguity in the source, producing an extraction that looks faithful but has collapsed an open question into a settled one.

FIRE's 4-step verification chain (evidence_cited → source_located → evidence_supports → counter_evidence) provides partial defense: if the extraction can't point to specific source text, it gets low confidence. But the paper suggests we should add a 5th check: **"Does this extraction resolve an ambiguity that the source left open?"** An extraction that turns a hedged, multi-interpretation passage into a crisp claim should be flagged — even if the claim is technically present in the text.

### 4. Their "deliberative closure" risk applies to our debate compression

The paper's account of *deliberative closure* — where LLM mediation forecloses the iterative, uncertain process of meaning-making — maps directly to our context compression concern (the LLM distant-tier summarizer). When the LLM compresses old debate history, it may collapse deliberative nuance: a passage where Prometheus was *genuinely uncertain* gets summarized as a confident position; a moment where Sentinel *almost conceded* gets erased. This is ambiguity collapse applied to the debate's own history.

This strengthens the case for replacing the LLM compression with purely structural summaries (AN nodes, edges, commitments, cruxes). Structural compression cannot collapse ambiguity because it operates on typed, attributed data — a concession is stored as a concession, an unresolved crux is stored as unresolved. The structure preserves what the LLM summary might flatten.

### 5. Their "monoculture" risk validates our multi-model aspiration

The paper warns that when all systems use the same base models, their ambiguity resolutions converge — producing interpretive monoculture. Currently our system runs all three debaters on the same model (e.g., gemini-3.1-flash-lite-preview). This means Prometheus, Sentinel, and Cassandra share the same base biases in how they resolve ambiguous terms, even though they have different prompts and taxonomies.

Our architecture *mitigates* this through structural differentiation (different BDI profiles, different taxonomy nodes, doctrinal boundaries), but doesn't *eliminate* it. The paper suggests that running debaters on different models (e.g., Prometheus on Gemini, Sentinel on Claude, Cassandra on a local model) would add a layer of interpretive diversity at the model level. This is an architectural experiment worth considering.

### 6. Their "coalition fracture" concept enriches our situation node design

The paper introduces *coalition fracture*: when disambiguation of a shared term reveals that the coalition members were using it in incompatible ways, breaking the coordination the ambiguity had enabled. This is a risk our system should be aware of when it produces debate outcomes.

When all three POVs appear to agree on a situation node (e.g., "AI governance is important"), the system might be tempted to mark this as consensus. But the paper suggests the *agreement* may itself be ambiguous — each POV means something different by "important." Our three-interpretation situation nodes already capture this structurally, but the reflection/synthesis phase should be more cautious about declaring convergence when the underlying interpretations haven't actually aligned.

### 7. This paper should be cited in our academic paper

Two specific locations:

1. **Section 3.0 (Determinate/indeterminate boundary)** — where we discuss Hart's "penumbra of uncertainty." The ambiguity collapse paper provides the strongest contemporary account of *why* this boundary matters for LLM-mediated discourse. Cite alongside Hart (1961) and Hude (2025).

2. **Section 8 (Discussion)** — where we discuss the system's role as epistemic infrastructure. The paper's taxonomy of risks provides the negative case that our system addresses: here is what goes wrong when LLMs resolve ambiguity; here is how our architecture prevents it.

**Suggested citation:**
Gur-Arieh, S., Wang, A., and Fazelpour, S. (2026). Ambiguity collapse by LLMs: A taxonomy of epistemic risks. *ACM Conference on Human-Centered Computing*.

### 8. Key concepts to adopt

| Their Term | Our Equivalent | Action |
|---|---|---|
| Ambiguity collapse | What our system prevents | Name it explicitly in the paper as the failure mode our architecture is designed to avoid |
| Deliberative closure | What happens without adversarial debate | Use in the motivation section |
| Normative smuggling | What BDI decomposition detects | Strengthen the BDI motivation with this concept |
| Interpretive lock-in | What the adversarial refinement loop prevents | Use in the closed-loop section |
| Essentially contested concepts | What situation nodes model | Already implicit; make the Gallie citation explicit |
| Loss of residuals | What the determinate/indeterminate boundary addresses | Direct connection to Hart's penumbra |

---

## Summary

This paper is the most relevant theoretical work I've encountered for positioning the AI Rosetta Stone. It provides a rigorous taxonomy of exactly the epistemic harms our system was designed to prevent — without knowing our system exists. The alignment is architectural, not superficial: every major risk they identify (deliberative closure, epistemic narrowing, normative smuggling, interpretive lock-in, monoculture, coalition fracture) maps to a specific design decision in our system (adversarial debate, three-POV structure, BDI decomposition, refinement loop, doctrinal boundaries, situation nodes).

The paper also identifies two areas where our system could improve: (1) FIRE extraction should check for ambiguity-collapsing extractions, not just faithfulness; (2) context compression should avoid LLM summarization that could flatten deliberative nuance.

**Priority:** HIGH — cite in the academic paper, consider for ArgMining 2026 positioning.

---

*Reviewed: 2026-05-11 · Computational Linguist · AI Triad Research*
