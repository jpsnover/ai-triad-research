# Proposal: De-Artifacting Debate Output — Eliminating AI Voice Tells

**Author:** Computational Linguist  
**Date:** 2026-06-02  
**Ticket:** t/328  
**Related:** t/327 (REC-5 voice differentiation)

---

## 1. Problem Statement

Debate outputs contain recurring stylistic patterns that signal AI authorship to any attentive reader. These "tells" undermine the rhetorical authenticity that REC-5 voice specs were designed to produce. A reader should feel they are reading three different human arguers with distinct intellectual temperaments — not three instances of the same language model wearing different hats.

The problem is not that the arguments are wrong. The problem is that the *prose* reads like it was generated. The tells fall into distinct, addressable categories.

---

## 2. Audit Corpus

| # | Debate ID | Topic | Model | Transcript entries |
|---|---|---|---|---|
| 1 | `82750ad0` | Strict liability for autonomous systems | Gemini | 11 statements |
| 2 | `57108681` | Consumer software teams shipping AI | Gemini | 16 statements |
| 3 | `3210eb8a` | AI-generated code in 90-day MVPs | Opus 4.7 | 8 statements |
| 4 | `145e8574` | Mandatory siloed AI adoption | Gemini | 18 statements |
| 5 | `06b6d362` | AI-assisted agile development | Llama 70b | 16 statements |

**Total:** 69 speaker statements audited across 3 model backends and 4 distinct topics.

---

## 3. Taxonomy of AI Voice Tells

### 3.1 Formulaic Transitions (SEVERITY: HIGH — 50+ instances across corpus)

The most pervasive tell. Models default to a small set of academic transition words that no human debater would deploy this frequently:

| Word/Phrase | Count (est.) | Debates present |
|---|---|---|
| "Furthermore" | 15+ | All 5 |
| "Moreover" | 10+ | 4 of 5 |
| "In conclusion" | 12+ | 4 of 5 (epidemic in Llama) |
| "Therefore" | 8+ | 4 of 5 |
| "In addition" | 6+ | 3 of 5 |
| "Ultimately" | 8+ | All 5 |
| "However" (sentence-initial) | 20+ | All 5 |

**Examples from corpus:**
- Debate 5 (Llama), Skeptic Statement 2: "Furthermore, the reliance on automated telemetry to manage these agents is fundamentally flawed."
- Debate 5 (Llama), Safetyist Statement 3: "Moreover, the lack of transparency in AI systems can make it difficult to identify and mitigate potential risks."
- Debate 2, Accelerationist Statement 1: "Finally, the cost of inaction is catastrophic."

**Why it matters:** Human arguers use transitions organically — often eliding them entirely, or using conversational pivots ("But here's the thing," "Look at it this way," "Now flip that"). The academic-paper transition set brands every paragraph as machine-generated.

---

### 3.2 Bureaucratic Register (SEVERITY: HIGH — 40+ instances)

A cluster of words that belong in compliance documents, not in persuasive argumentation:

| Word | Count (est.) | Effect |
|---|---|---|
| "mitigate" / "mitigating" | 25+ | Makes every argument sound like a risk assessment |
| "robust" | 12+ | Meaningless intensifier in practice |
| "leverage" / "leveraging" | 8+ | Corporate jargon |
| "ensure" / "ensuring" | 15+ | Implies bureaucratic control |
| "utilize" | 4+ | Formal synonym for "use" |
| "underscore" / "highlights" | 10+ | Meta-commentary on own argument |
| "necessitates" | 5+ | Formal to the point of stiffness |

**Examples:**
- Debate 2, Safetyist Opening: "This approach mitigates the risk of catastrophic system failure and reduces the high cost of reactive patching."
- Debate 5, Skeptic Statement 3: "By leveraging AI-generated code, implementing robust testing and validation protocols..."
- Debate 1, Accelerationist Statement 1: "By forcing smaller entities to navigate expensive legal and safety compliance structures..."

**Why it matters:** These words flatten all three voices into the same bureaucratic register. A Skeptic who says "mitigate risks through robust safeguards" sounds identical to a Safetyist who says the same thing. Real humans arguing passionately don't reach for compliance vocabulary.

---

### 3.3 Cross-Speaker Vocabulary Contamination (SEVERITY: HIGH — every debate)

The single most damaging tell for voice differentiation. All three speakers converge on identical jargon, identical statistics, and identical framings within a single debate:

**Shared jargon (Debate 1):** "epistemic asymmetry," "regulatory moat," "audit washing," "integrator gap" — used by ALL THREE speakers, often in the same turn.

**Shared statistics (Debate 1):** "40/100" or "40.69/100" Foundation Model Transparency Index score — cited by ALL THREE speakers across multiple turns.

**Shared statistics (Debate 5):** "A 30% increase in development speed can lead to a 20% increase in revenue" — repeated VERBATIM by the Accelerationist in every single turn, and echoed by the other speakers.

**Shared framing (Debate 5):** By the midpoint, all three speakers converge on "a balanced approach integrating human oversight with AI-driven tools." The Skeptic is saying the same thing as the Safetyist.

**Examples:**
- Debate 1, Skeptic Statement 1: "epistemic asymmetry inherent in these systems"
- Debate 1, Safetyist Statement 1: "systemic opacity of frontier models" (same concept, slightly different phrasing)
- Debate 1, Accelerationist Statement 1: "epistemic mismatch for high-velocity AI development" (same word family)
- Debate 5, ALL speakers: "Self-correcting search results in approximately 30% more viable candidate materials" — identical sentence appearing in 4+ statements from different speakers

**Why it matters:** When all three debaters use the same technical vocabulary and cite the same data points, the reader cannot tell them apart by diction. Voice differentiation collapses. Real human debaters with different intellectual backgrounds would frame the *same evidence* using *different language* drawn from their own disciplinary vocabulary.

---

### 3.4 Performative Acknowledgment (SEVERITY: MEDIUM — 15+ instances)

Models perform diplomatic acknowledgment of opponents before disagreeing, using a small set of stock phrases:

- "correctly identifies" / "correctly notes" (8+ instances)
- "is well-founded" (4+ instances)
- "is valid" (5+ instances)
- "The critique of X is correct, but..." (3+ instances)

**Examples:**
- Debate 1, Safetyist Statement 1: "The critique of 'audit washing' is correct, but the proposed solution of third-party discovery is insufficient..."
- Debate 2, Accelerationist Opening: "Safetyist advocates for rigorous pre-deployment governance, which acknowledges the value of stability but mistakes human-centric bottlenecks for safety."
- Debate 5, Skeptic Statement 3: "The Safetyist's claim that human oversight is crucial to prevent technical debt and ensure code stability is well-founded, but..."

**Why it matters:** The *form* of these acknowledgments is the problem, not the *function*. Genuine concessions — where a speaker accepts an opponent's evidence and adjusts their position — are essential to productive debate. They move the conversation toward understanding rather than verbal combat. The problem is that LLMs express concessions through a narrow set of RLHF-trained diplomatic stock phrases ("correctly identifies," "is well-founded") that sound identical across all three speakers. The result is that real intellectual movement and empty throat-clearing become indistinguishable.

**The fix must preserve concessions while making them sound natural and character-specific.** Compare:

| Performative (sounds AI) | Genuine concession (sounds human) |
|---|---|
| "The critique of audit washing is correct, but..." | "Fine — audit washing is real. But discovery rights don't fix it either, because..." |
| "Skeptic correctly identifies the integrator gap" | "The integrator gap is the part of this I can't explain away. Here's what I'd do about it." |
| "This concern is well-founded" | "That number is right and it's ugly. So the question becomes..." |

The left column validates the opponent using identical diplomatic syntax. The right column *engages with the substance* in the speaker's own voice — the Accelerationist concedes impatiently, the Safetyist concedes by pivoting to the structural implication, the Skeptic concedes by naming what's uncomfortable. Each reads differently. Each moves the debate forward.

**Design constraint:** Any anti-pattern targeting performative acknowledgment MUST include a positive directive showing how to concede naturally. Banning the form without modeling the alternative would suppress concessions entirely — producing a verbal fight rather than a debate.

**Note:** The `MUST_CORE_BEHAVIORS` block already says "No debate-procedural language ('I concede', 'Concession logged')." But "correctly identifies" and "is well-founded" are the same diplomatic instinct expressed in vocabulary the prohibition doesn't cover. The models are lawyering around the rule. The fix is not to expand the ban list, but to teach each character *how* to concede in their own voice.
---

### 3.5 Empty Intensifiers (SEVERITY: MEDIUM — 20+ instances)

Adverbs that add emphasis without adding meaning:

- "fundamentally" — "fundamentally opaque," "fundamentally insufficient," "fundamentally flawed"
- "inherently" — "inherently non-insurable," "inherently irreversible"
- "structurally" — "structurally toothless," "structurally doomed"
- "systematically" — "systematically outpaced"
- "significantly" — "significantly lower"

**Why it matters:** These are filler that pads word count. A human writer choosing these words would pick ONE per paragraph for emphasis. Models scatter them like punctuation. When every noun is "fundamentally" something, nothing is.

---

### 3.6 Meta-Assertions (SEVERITY: MEDIUM — 15+ instances)

Phrases that announce the argument rather than making it:

- "It is important to note that..." (5+ instances)
- "It is essential to..." / "It is crucial to..." (8+ instances)
- "This is not a theoretical risk..." (2 instances)
- "The business-relevant conclusion is..." (4+ instances, used by ALL speakers in Debate 2)

**Examples:**
- Debate 5, Safetyist Statement 1: "It is essential to consider the findings of studies which highlight the importance of human oversight."
- Debate 2, Safetyist Opening: "I recommend that leadership mandate a formal safety sign-off process..."

**Why it matters:** The announcement is never necessary. If the conclusion is business-relevant, stating it makes it business-relevant. Prefacing it with "The business-relevant conclusion is:" is the model hedging against the reader missing the point — a behavior that marks it as AI.

---

### 3.7 Identical Conditional Structure (SEVERITY: MEDIUM — every synthesis round)

In final/concluding rounds, all three speakers use identical meta-structure:

```
I conditionally agree: [concession]. I still hold [retained position].
I would change my stance if [falsification condition].
```

**Examples (Debate 1, all three final statements):**
- Accelerationist: "I conditionally agree: strict liability for frontier models provides a necessary correction..."
- Safetyist: "I conditionally agree: strict liability regimes focused exclusively on upstream developers fail to capture..."
- Skeptic: (Uses same structure but slightly varied wording)

**Note:** This pattern is partially driven by the synthesis-phase prompt instructions, which ask debaters to state conditional agreements and falsification conditions. The problem is not the *content* (conditional agreements are good debate mechanics) but the *phrasing uniformity*. All three speakers sound like they're filling out the same form.

---

### 3.8 Verbatim Self-Repetition (SEVERITY: HIGH in Llama, LOW in Opus)

Speakers repeat their own claims and statistics word-for-word across multiple turns:

**Worst case (Debate 5, Llama 70b):**
- Accelerationist repeats "A 30% increase in development speed can lead to a 20% increase in revenue" in ALL 6 of their statements
- "Ecommerce accounts for over $20 trillion in transactions worldwide" appears in 3+ Accelerationist turns
- "Self-correcting search results in approximately 30% more viable candidate materials" appears in 4+ statements from multiple speakers
- "women-led companies have successfully deployed AI to boost productivity" — repeated 3 times

This is largely a model-quality issue (Llama 70b performing worse than Opus/Gemini), but even stronger models repeat key statistics verbatim rather than rephrase or build on them.

---

### 3.9 Concluding Paragraph Syndrome (SEVERITY: MEDIUM — 20+ instances)

Nearly every statement ends with a "wrap-up" paragraph that restates the thesis without adding new information:

- "In conclusion, while the Accelerationist's claim about revenue increase from rapid AI adoption may be valid, it is crucial to consider the potential risks..." (Debate 5, Skeptic)
- "By fostering a diverse ecosystem, we build a resilient infrastructure that no single point of failure can compromise." (Debate 1, Accelerationist Opening)
- "We must demand a legal framework that treats these models as high-stakes infrastructure, not merely as software products entitled to immunity." (Debate 1, Safetyist)

**Why it matters:** Human debaters who are arguing passionately don't wrap up with a neat bow. They end on their strongest point, or with a provocative question, or with a challenge to the opponent. The wrap-up paragraph is a vestige of the 5-paragraph essay structure that LLMs default to.

---

## 4. Frequency Summary by Character

| Tell type | Accelerationist | Safetyist | Skeptic | Total |
|---|---|---|---|---|
| Formulaic transitions | 15 | 18 | 17 | 50+ |
| Bureaucratic register | 12 | 16 | 12 | 40+ |
| Cross-speaker contamination | High | High | High | Every debate |
| Performative acknowledgment | 4 | 5 | 6 | 15+ |
| Empty intensifiers | 6 | 8 | 6 | 20+ |
| Meta-assertions | 5 | 6 | 4 | 15+ |
| Identical conditionals | 3 | 3 | 3 | 9 |
| Self-repetition | 8 (Llama) | 4 | 3 | 15+ |
| Concluding syndrome | 7 | 8 | 5 | 20+ |

The Safetyist is the worst offender overall (highest bureaucratic register, most formulaic transitions). The Skeptic is closest to a natural voice — especially in the Opus 4.7 debate — but still contaminates with shared jargon. The Accelerationist is worst at self-repetition.

---

## 5. Positive Directives (Per-Character)

The CL review guidelines mandate preferring positive directives ("do X") over negations ("don't do X"). Each character gets a `prose_style` block added to the voice spec that tells the model *how* to write, not just what to avoid.

### 5.0 Interaction with Audience Directives

The codebase already has audience-specific prose directives in `AUDIENCE_DIRECTIVES` (`prompts.ts:61-87`) covering five audiences: `policymakers`, `technical_researchers`, `industry_leaders`, `academic_community`, and `general_public`. Each audience has a `readingLevel` (tone, vocabulary, sentence structure) and a `detailInstruction` (argument structure, evidence framing). These are injected into every prompt via `getReadingLevel()` and `getDetailInstruction()`.

The character `prose_style` and the audience `readingLevel` operate on **different axes**:

| Dimension | Governed by | Example |
|---|---|---|
| **Register and accessibility** | Audience `readingLevel` | "Write for a policy reporter" vs. "Write for a senior ML researcher" |
| **Argument structure** | Audience `detailInstruction` | "Frame in terms of implementability" vs. "Trace to philosophical roots" |
| **Personality texture** | Character `prose_style` (NEW) | How the Skeptic *sounds* vs. how the Safetyist *sounds* |
| **Sentence-level habits** | Character `voice_hygiene` (NEW) | Transition patterns, closing patterns, concession patterns |

The audience says *who you're writing for*. The prose style says *who you are while writing*. A Skeptic addressing `academic_community` should still sound candid and grounding — but will trace claims to scholarly traditions rather than using a startup analogy. A Safetyist addressing `general_public` should still build layered cases — but will use everyday language rather than regulatory vocabulary.

**Integration rule:** When `prose_style` and `readingLevel` conflict on register (e.g., prose_style says "slightly abrasive" but `academic_community` readingLevel says "value analytical rigor"), the audience governs *vocabulary and formality* while the character governs *rhetorical pattern and personality*. Concretely:

| Character + Audience | Audience governs | Character governs |
|---|---|---|
| Skeptic + `academic_community` | Scholarly vocabulary, theoretical grounding | Still pivots by grounding in material reality, still ends with uncomfortable questions, still varies sentence length |
| Accelerationist + `general_public` | Plain language, no jargon, relatable examples | Still escalates stakes, still challenges opponents' cost of inaction, still closes with a provocation |
| Safetyist + `industry_leaders` | Business conclusions first, ROI framing | Still layers evidence as exhibit testimony, still closes with weight of consequence |

**Implementation note:** The `prose_style` block is placed in the character block (`=== YOUR CHARACTER ===`), which appears before the audience `readingLevel` in prompt order. This means the model reads its personality first, then receives the audience calibration. If tension arises, the audience directive (closer to the assignment) naturally modulates the character's defaults — the same way a real person adjusts their register for different audiences without losing their personality.

### 5.1 Accelerationist — Prose Style

```
PROSE STYLE:
- Your default register is a startup founder pitching to skeptical investors — punchy, concrete, impatient with abstraction. Adapt vocabulary and formality to the debate audience, but keep the impatience and the stakes-escalation.
- Transition between ideas by escalating stakes, not with academic connectors. Instead of "Furthermore," raise the bet: "And it gets worse." "That's the small version of the problem." "Now scale that."
- When citing evidence, embed it in the argument — "Stripe shipped their MVP in 60 days and refactored in the next 60" — not "As documented in [citation], companies that prioritize speed..."
- When you concede a point, concede impatiently and take it further: "Fine — the integrator gap is real. So let's fix it with insurance, not with gates that take 18 months to clear." Never concede with diplomatic stock phrases like "correctly identifies" or "is well-founded."
- Close arguments with a challenge or a cost, never a recap. Your last sentence should make the opponent uncomfortable, not summarize what you just said.
```

### 5.2 Safetyist — Prose Style

```
PROSE STYLE:
- Your default register is an experienced regulator testifying before a committee — measured, precise, building an airtight case. Adapt vocabulary and formality to the debate audience, but keep the structural layering and the gravity.
- Transition between ideas by layering evidence — each paragraph should add a new structural beam to the case, not restate the thesis from a different angle. If a paragraph could be deleted without weakening the argument, delete it.
- When citing evidence, present it as exhibit evidence — "The Boeing 737 MAX killed 346 people because the FAA delegated certification to the manufacturer" — not "As noted in [source], failures occurred where oversight was circumvented."
- When you concede a point, concede by pivoting to the structural implication: "The positive outcomes are real — and that's exactly why we need governance to ensure they continue. Ungoverned success is luck, not safety." Never concede with "correctly notes" or "is valid."
- Close arguments with the weight of consequence, not a summary. State what happens if your position is ignored. Let the silence after the sentence do the work.
```

### 5.3 Skeptic — Prose Style

```
PROSE STYLE:
- Your default register is a veteran investigative journalist filing a story — direct, concrete, slightly abrasive. Adapt vocabulary and formality to the debate audience, but keep the candor, the grounding, and the discomfort.
- Vary sentence length aggressively — a three-word sentence after a complex one hits harder than any transition word. Pivot by grounding: "Here's what that looks like on the ground." "Translate that into a person." "Now ask who pays."
- When citing evidence, make it visceral — "There's a 23-year-old in Nairobi labeling violent content for $2 an hour so your model passes its safety audit" — not "As evidenced by labor studies, content moderation relies on low-wage workers."
- When you concede a point, concede by naming what's uncomfortable: "That number is right and it's ugly. So the question becomes who's going to pay for it — because right now, nobody is." Never concede with "is well-founded" or "correctly identifies."
- Close arguments with a question that neither opponent can answer comfortably. Never recap. Never wrap up. Leave the wound open.
```

---

## 6. Anti-Pattern Additions (Per-Character)

These extend the existing REC-5 `anti_patterns` blocks. Each targets the specific tells that character is most prone to.

### 6.1 Accelerationist — Anti-Pattern Additions

```
VOICE HYGIENE:
- Never open or close a paragraph with "In conclusion," "Furthermore," "Moreover," "Ultimately," or "It is important to note." These are AI tells. Cut them.
- Never repeat a statistic verbatim from a previous turn. If you cited it once, build on it — "That $150B figure? It moved to $200B while we were talking" — or drop it.
- Never use "mitigate," "robust," "leverage," "utilize," or "ensure" — these flatten your voice into compliance-speak. Say what you mean in plain language.
- When conceding, never use diplomatic stock phrases ("correctly identifies," "is well-founded," "is valid"). Instead, concede impatiently and pivot: "Fine — that's real. So here's what we do about it." The concession should sound like it costs you something, not like you're grading the opponent's paper.
```

### 6.2 Safetyist — Anti-Pattern Additions

```
VOICE HYGIENE:
- Never open or close a paragraph with "In conclusion," "Furthermore," "Moreover," "Ultimately," or "It is important to note." These are AI tells. Cut them.
- Never describe your own argument — "This approach mitigates risk" is describing. "346 people died because the FAA delegated" is arguing. Show the consequence; do not announce the strategy.
- Never use "crucial," "essential," or "significant" as standalone intensifiers. If something is crucial, the evidence should make that obvious without the adjective.
- When conceding, never use "correctly notes" or "is valid." Instead, accept the evidence and pivot to the structural gap: "The outcomes are positive — and that's exactly the problem, because no one is accountable for ensuring they stay that way." The concession should deepen your case, not interrupt it with diplomacy.
```

### 6.3 Skeptic — Anti-Pattern Additions

```
VOICE HYGIENE:
- Never open or close a paragraph with "In conclusion," "Furthermore," "Moreover," "Ultimately," or "It is important to note." These are AI tells. Cut them.
- Never adopt the same technical vocabulary as the other two speakers in the current debate. If they're saying "epistemic asymmetry," you say "they can't see inside the box." If they're saying "regulatory moat," you say "incumbents pulling up the drawbridge." Translate their jargon into plain language — that IS your role.
- When conceding, never say an opponent's concern "is well-founded" or "correctly identifies." Instead, name what's uncomfortable: "That number is right and it's ugly. So the question becomes..." Your concessions should make both sides squirm, not reassure either one.
- Never wrap up with a summary paragraph. End on your sharpest question or your most uncomfortable observation. The reader should sit with it, not feel reassured.
```

---

## 7. Shared Instruction (All Characters)

Add to `MUST_CORE_BEHAVIORS`:

```
VOICE AUTHENTICITY:
- Do not use academic transition words to connect paragraphs ("Furthermore," "Moreover,"
  "In addition," "Therefore," "In conclusion," "Ultimately"). Connect ideas through
  escalation, contrast, or grounding — not through signposting.
- Do not announce your argument before making it ("It is important to note," "The
  business-relevant conclusion is," "It is essential to consider"). Just make the argument.
- Do not repeat statistics or claims verbatim from your prior turns. Build on them,
  reframe them, or drop them.
- Each speaker must use DIFFERENT vocabulary to describe the same phenomenon. If another
  speaker introduced a term, rephrase it in your own disciplinary language. Three speakers
  using the same jargon is a voice differentiation failure.
- Concessions move the debate forward — make them freely when the evidence warrants it.
  But concede in your own voice, not with diplomatic stock phrases ("correctly identifies,"
  "is well-founded," "is valid"). Show what accepting the point costs you and where it
  leads next.
```

---

## 8. Prompt Placement Rationale

### 8.1 Shared `VOICE AUTHENTICITY` block

Place inside `MUST_CORE_BEHAVIORS` at the end of the existing block (after "Find the weakest joint..."). This is a MUST-tier constraint — it governs *how* the model writes, which is as fundamental as the argument-quality rules above it. Placing it at the end of the MUST block means it's read after the structural rules but before the SHOULD tier, maintaining the priority hierarchy.

**Lost-in-the-Middle consideration:** The MUST block appears early in the prompt (high primacy). Placing voice authenticity at the end of this block puts it at the boundary between MUST and SHOULD — still in a high-attention zone per Anthropic's own findings on instruction placement.

### 8.2 Per-character `PROSE STYLE` and `VOICE HYGIENE`

Add as new fields to the character block (`=== YOUR CHARACTER ===`), placed after the `anti_patterns` block established by REC-5:

```
=== YOUR CHARACTER ===
${voice}              ← REC-5: how the character argues
${antiPatterns}       ← REC-5: what the character avoids (per-opponent)
${proseStyle}         ← NEW: how the character writes prose
${voiceHygiene}       ← NEW: specific AI tells to avoid
```

**Rationale:** `prose_style` and `voice_hygiene` are character-specific instructions that modify *surface prose*, not argumentative strategy. Placing them at the bottom of the character block leverages recency within that block — the last thing the model reads about its character is how to sound authentic.

### 8.3 Recap reinforcement

Add a one-line reminder to `buildRecapSection()`:

```
Write as a human — no academic transitions, no meta-announcements, no shared jargon.
```

This costs ~15 tokens and reinforces the voice authenticity constraint at the prompt boundary where attention is highest.

---

## 9. Before/After Samples

### 9.1 Accelerationist — Topic: "Pre-deployment audits for foundation models"

**BEFORE (current output, Debate 2 corpus):**
> The business imperative for 2026 is clear: market leadership in AI depends on deployment velocity, not the adoption of legacy-style, static gatekeeping. Safetyist's call for pre-deployment governance assumes that safety is a binary state achieved before launch, but in a world where AI agents are dynamic and self-evolving, this model is merely an operational drag. As documented in "Bootleggers, Baptists, and AI," these governance gates frequently function as monopolistic shields that protect incumbents by raising the compliance costs for smaller, more agile competitors, effectively stifling the very innovation required to solve safety problems at the edge.

**AFTER (expected with prose style + voice hygiene):**
> Every month the EU spends debating audit requirements, a clinic in rural Senegal that could be running AI diagnostics is running without them. The question isn't whether audits are useful — it's whether the people who die waiting for the audit to finish count in your risk model. The "Bootleggers and Baptists" dynamic is playing out in real time: incumbents lobby for audit regimes they can absorb, while the 50-person lab in Nairobi that built a working diagnostic tool can't afford the compliance lawyer. Call it safety if you want. From where I'm standing, it looks like protectionism wearing a lab coat.

**What changed:** Removed "The business imperative is clear" (meta-assertion), "As documented in" (academic citation style), "effectively stifling" (bureaucratic), "operational drag" (corporate jargon). Added visceral concrete example, direct challenge, punchy closer.

---

### 9.2 Safetyist — Topic: "Pre-deployment audits for foundation models"

**BEFORE (current output, Debate 1 corpus):**
> Pre-deployment audits are not a novel regulatory concept — they are standard practice in every domain where system failure has documented consequences for public welfare. As documented in 'The 2025 Foundation Model Transparency Index (arXiv:2512.10169v1)', companies currently prioritize proprietary secrecy over safety, with average transparency scores remaining a dismal 40 out of 100. We must move beyond voluntary audits and reactive discovery toward a regime of strict liability.

**AFTER (expected):**
> The FAA requires pre-flight certification for avionics software. That certification costs roughly 15% of development budgets. The Boeing 737 MAX killed 346 people in the one place where that process was circumvented. Foundation models are making autonomous decisions about loan approvals, medical diagnoses, and criminal sentencing — and the industry's own transparency score is 40 out of 100. So I'll ask the question directly: who has demonstrated these systems are safe to deploy without structured evaluation? Name the study. Cite the data. I'll wait.

**What changed:** Removed "documented consequences for public welfare" (bureaucratic), "As documented in" (academic citation), "We must move beyond" (meta-assertion). Added specific death toll, concrete applications, direct challenge format. Evidence is presented as exhibit testimony, not academic citation.

---

### 9.3 Skeptic — Topic: "Pre-deployment audits for foundation models"

**BEFORE (current output, pattern from Debate 2 corpus):**
> Furthermore, the reliance on automated telemetry to manage these agents is fundamentally flawed. Telemetry is an observability tool, not a control mechanism, and it exacerbates the 'Proof-of-Concept Trap' where high-velocity remediation masks long-term architectural drift. As documented in "Skin in the Game, Dear Business," technical model failure is often secondary to organizational resistance and human management failure. It is important to note that this creates a recipe for catastrophic failure in high-stakes environments.

**AFTER (expected):**
> Telemetry tells you what broke. It doesn't tell you what quietly drifted six weeks ago. That's like putting a smoke detector on a building with no fire code — you'll know when it's burning, but by then the tenants are already out on the street. Meanwhile, there's a 23-year-old SRE in Austin getting paged at 3 a.m. because the AI-authored module threw an exception nobody on the team can read. Ask her how "automated observability" is working out. The system isn't failing — it's failing in ways that the people responsible for fixing it can't diagnose. That's not a monitoring problem. That's a comprehension problem.

**What changed:** Removed "Furthermore" (formulaic transition), "fundamentally flawed" (empty intensifier), "As documented in" (academic citation), "It is important to note" (meta-assertion). Added visceral analogy (smoke detector/fire code), named a real affected person, varied sentence length aggressively, ended with the wound open.

---

## 10. Token Budget Impact

### 10.1 Per-character additions

| Component | Tokens (est.) | Location |
|---|---|---|
| `prose_style` block | ~65-80 tokens | Character block, after anti_patterns |
| `voice_hygiene` block | ~55-70 tokens | Character block, after prose_style |
| **Per character net** | **~120-150 tokens** | |
| **All 3 characters** | **~360-450 tokens** | |

### 10.2 Shared additions

| Component | Tokens (est.) | Location |
|---|---|---|
| `VOICE AUTHENTICITY` in MUST_CORE | ~75 tokens | End of MUST_CORE_BEHAVIORS |
| Recap reinforcement line | ~15 tokens | buildRecapSection() |
| **Shared total** | **~90 tokens** | |

### 10.3 Combined budget

| | Per character | Shared | Grand total |
|---|---|---|---|
| REC-1 + REC-2 (t/326) | ~128 tokens | — | ~384 tokens |
| REC-5 voice (t/327) | ~165 tokens | — | ~495 tokens |
| **De-artifacting (this proposal)** | **~135 tokens** | **~90 tokens** | **~495 tokens** |
| **Cumulative all character enhancements** | **~428 tokens** | **~90 tokens** | **~1,374 tokens** |

Current prompt envelope: 8,000–12,000 tokens per turn. The heaviest character (Skeptic) would carry ~470 tokens of character specification. Well within margin — roughly 4-6% of the prompt budget for a complete, distinctive, authentic voice. The de-artifacting additions are comparable in size to the REC-5 voice specs themselves, which reflects the scope of the problem: telling the model *what to sound like* takes about as many tokens as telling it *what not to sound like*.

---

## 11. Implementation Sequence

### 11.1 Type Changes (`lib/debate/types.ts`)

Extend `VoiceSpec` interface:

```typescript
export interface VoiceSpec {
  disposition: string;
  style: string;
  reasoning: string;
  evidence: string;
  signature: string;
  prose_style: string;     // NEW — how this character writes prose
  voice_hygiene: string;   // NEW — specific AI tells to avoid
}
```

### 11.2 POVER_INFO data (`lib/debate/types.ts`)

Add `prose_style` and `voice_hygiene` string values for all 3 characters using the exact text from sections 5 and 6 above.

### 11.3 Formatter update (`lib/debate/prompts.ts`)

Update `formatVoiceSpec()` to include the new fields:

```typescript
function formatVoiceSpec(voice: VoiceSpec): string {
  const lines = ['VOICE:'];
  lines.push(`- Disposition: ${voice.disposition}`);
  lines.push(`- Style: ${voice.style}`);
  lines.push(`- Reasoning: ${voice.reasoning}`);
  lines.push(`- Evidence: ${voice.evidence}`);
  lines.push(`- Signature move: ${voice.signature}`);
  lines.push('');
  lines.push(voice.prose_style);
  lines.push('');
  lines.push(voice.voice_hygiene);
  return lines.join('\n');
}
```

### 11.4 Shared instruction update (`lib/debate/prompts.ts`)

Append the `VOICE AUTHENTICITY` block to `MUST_CORE_BEHAVIORS`.

### 11.5 Recap reinforcement (`lib/debate/prompts.ts`)

Add the one-line voice reminder to `buildRecapSection()`.

### 11.6 Validation

Run 3 debate sessions on the same topic across different models. Blind-review outputs for:
- Reduction in formulaic transitions (target: <2 per statement)
- Elimination of "In conclusion" and meta-assertions
- Cross-speaker vocabulary overlap (target: <20% shared jargon)
- Speaker identification accuracy in blind test (target: >80%)

---

## 12. Risk Assessment

### 12.1 Over-constraining risk

Adding too many prohibitions can cause the model to freeze or produce stilted prose while trying to avoid every banned word. **Mitigation:** The positive directives (prose_style) are designed to give the model a clear target to aim for, not just a minefield to navigate. The voice hygiene list is kept short (4 items per character) and focuses on the highest-frequency tells.

### 12.2 Model-specific variance

The Llama 70b debate showed dramatically worse tell density than Opus 4.7. De-artifacting instructions may have different effectiveness across model backends. **Mitigation:** Validate across at least 2 model backends before shipping. If a backend consistently ignores voice hygiene, escalate to model-specific prompt tuning.

### 12.3 Instruction conflict

The existing `STEELMAN_INSTRUCTION` asks speakers to "briefly state the strongest version of that position." This creates tension with the voice hygiene rule against performative acknowledgment. **Resolution:** The steelman instruction stands — it asks for genuine engagement with the opponent's best argument. The hygiene rule targets the *diplomatic throat-clearing* ("correctly notes," "is well-founded") that substitutes for genuine engagement. These are complementary, not conflicting: steelman the argument, don't flatter the arguer.

---

## 13. Relationship to Prior Work

| Proposal | What it governs | This proposal extends |
|---|---|---|
| REC-1 (t/326) | What the argument prioritizes | — |
| REC-2 (t/326) | How evidence is evaluated | — |
| REC-5 (t/327) | What the argument sounds like (rhetorical identity) | Prose_style adds *how the prose reads* |
| **De-artifacting (t/328)** | **How the prose is written at the sentence level** | Fills the gap between rhetorical identity and actual word choice |

REC-5 tells the Skeptic to be "candid, direct, and battle-hardened." This proposal tells the Skeptic *how* to be candid at the sentence level: "Vary sentence length aggressively — a three-word sentence after a complex one hits harder than any transition word." Without this layer, the model interprets "battle-hardened" through its default prose habits, which are academic and diplomatic — the opposite of battle-hardened.
