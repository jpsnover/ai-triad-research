# Source Extraction Gap Analysis — Experiment Report

**Date:** 2026-06-05
**Key points analyzed:** 565
**Source summaries sampled:** 30
**Model:** gemini-2.5-flash
**Ticket:** t/377

## 1. Overall Entailment Verdict

| Verdict | Count | Rate |
|---------|-------|------|
| entailed | 24 | 4.2% |
| partial | 442 | 78.2% |
| not_entailed | 99 | 17.5% |

**False-accept rate (partial + not_entailed):** 95.8%

## 2. By POV (Lens)

| POV | Total | Entailed | Partial | Not Entailed | FA Rate |
|-----|-------|----------|---------|--------------|---------|
| Accelerationist | 149 | 4 | 113 | 32 | 97.3% |
| Safetyist | 199 | 8 | 159 | 32 | 96.0% |
| Skeptic | 217 | 12 | 170 | 35 | 94.5% |

## 3. By BDI Category

| Category | Total | Entailed | Partial | Not Entailed | FA Rate |
|----------|-------|----------|---------|--------------|---------|
| beliefs | 258 | 18 | 202 | 38 | 93.0% |
| desires | 78 | 1 | 60 | 17 | 98.7% |
| intentions | 229 | 5 | 180 | 44 | 97.8% |

## 4. By extraction_confidence Bucket

| Confidence | Total | Entailed | Partial | Not Entailed | FA Rate |
|------------|-------|----------|---------|--------------|---------|
| 0.95-1.00 | 410 | 20 | 341 | 49 | 95.1% |
| 0.90-0.94 | 106 | 3 | 74 | 29 | 97.2% |
| 0.80-0.89 | 29 | 1 | 12 | 16 | 96.6% |
| 0.70-0.79 | 2 | 0 | 1 | 1 | 100.0% |
| missing | 18 | 0 | 14 | 4 | 100.0% |

## 5. extraction_confidence Field Audit

- Populated: 547/565 (96.8%)
- Missing: 18

## 6. By Stance

| Stance | Total | Entailed | Partial | Not Entailed | FA Rate |
|--------|-------|----------|---------|--------------|---------|
| aligned | 470 | 19 | 365 | 86 | 96.0% |
| strongly_aligned | 57 | 2 | 50 | 5 | 96.5% |
| neutral | 27 | 2 | 19 | 6 | 92.6% |
| opposed | 11 | 1 | 8 | 2 | 90.9% |

## 7. Sample Failures (up to 10, sorted by extraction_confidence descending)

### generative-privacy-doctrine-case-new-legal-privacy-2026 (accelerationist, Intentions, conf: 1, verdict: partial)

**Verbatim:** GPD addresses this by advocating “regulatory sandboxes” and tiered compliance: smaller AI ventures face proportionate obligations, whereas large platforms with massive datasets undergo more stringent oversight. Such an approach aims to protect privacy interests while allowing academic and startup-level experimentation.

**Point:** The document advocates for 'regulatory sandboxes' and tiered compliance frameworks to prevent over-regulation from stifling AI research and commercial deployment. By allowing smaller ventures more flexibility while focusing stringent oversight on large platforms, the proposal seeks to balance necessary privacy protections with the need for continued innovation. This approach aligns with the accelerationist goal of maintaining a dynamic environment for technological experimentation.

**Problem:** The paraphrase introduces the concept of an "accelerationist goal," which is not mentioned or implied in the original quote.

**Repaired:** The document advocates for 'regulatory sandboxes' and tiered compliance frameworks to prevent over-regulation from stifling AI research and commercial deployment. By allowing smaller ventures more flexibility while focusing stringent oversight on large platforms, the proposal seeks to balance necessary privacy protections with the need for continued innovation.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (safetyist, Beliefs, conf: 1, verdict: not_entailed)

**Verbatim:** GenAI systems built on large language models (“LLMs”) and massive datasets do more than merely process data: they synthesize new content from user inputs in ways that can catch individuals off-guard.

**Point:** The document asserts that GenAI's ability to synthesize new content from user inputs creates unique privacy risks that existing legal frameworks cannot address. It highlights the danger of 'co-created' data where AI-generated inferences are indistinguishable from user-disclosed information. This aligns with safetyist concerns regarding the opacity of AI systems and the potential for catastrophic loss of individual autonomy.

**Problem:** The paraphrased point introduces numerous specific claims about privacy risks, legal frameworks, co-created data, AI opacity, and loss of autonomy that are not present or implied in the original quote, which only states that GenAI synthesizes new content in ways that can catch individuals off-guard.

**Repaired:** The document asserts that GenAI's ability to synthesize new content from user inputs can catch individuals off-guard.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (safetyist, Intentions, conf: 1, verdict: partial)

**Verbatim:** GPD tackles inferential data creation, mandates iterative user consent, and imposes carefully tailored third-party restrictions that deter exploitative or discriminatory use.

**Point:** The author proposes the 'Generative Privacy Doctrine' (GPD) to mandate iterative user consent and third-party restrictions. This reflects a safetyist intention to impose structural constraints on AI development to prevent exploitative or discriminatory outcomes. The framework aims to bridge the gap between current legal doctrines and the novel risks posed by generative models.

**Problem:** The paraphrase omits GPD's role in tackling inferential data creation and invents the broader aim of bridging legal gaps between doctrines and generative model risks.

**Repaired:** The author proposes GPD to tackle inferential data creation, mandate iterative user consent, and impose third-party restrictions. This reflects a safetyist intention to impose structural constraints on AI development to prevent exploitative or discriminatory outcomes.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (safetyist, Beliefs, conf: 1, verdict: partial)

**Verbatim:** A European user’s request to delete personal anecdotes embedded in a black-box AI model (with opaque internal architecture) exemplifies how verifying actual deletion can be difficult—especially if the system’s training process irreversibly intermingles user data.

**Point:** The document highlights the inherent opacity of black-box AI models, which makes verifying the deletion of personal data nearly impossible. This opacity hinders accountability and necessitates stronger regulatory frameworks. The safetyist perspective emphasizes that without complementary safeguards, such as mechanistic interpretability or rigorous auditing, these systems pose significant risks to privacy and data integrity.

**Problem:** The paraphrased point introduces concepts like accountability, regulatory frameworks, safetyist perspective, and specific safeguards (mechanistic interpretability, auditing) that are not mentioned or directly implied by the provided quote, which focuses solely on the difficulty of verifying data deletion in black-box AI models.

**Repaired:** The document highlights the inherent opacity of black-box AI models, which makes verifying the deletion of personal data difficult, especially if the system’s training process irreversibly intermingles user data.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (safetyist, Intentions, conf: 1, verdict: partial)

**Verbatim:** Proposed mitigations, such as “human-in-the-loop” checks, straightforward opt-outs, or mandated second opinions, aim to keep users informed and in control.

**Point:** The document argues for human-in-the-loop checks and mandated second opinions to mitigate the risks of automation bias. This aligns with the safetyist goal of maintaining human control over autonomous systems. By requiring these interventions, the document seeks to prevent the erosion of independent judgment caused by over-reliance on AI suggestions.

**Problem:** The paraphrase omits "straightforward opt-outs" from the list of proposed mitigations and presents specific interpretations like "automation bias" and "erosion of independent judgment" as explicitly stated risks/goals, whereas the quote only states a general aim to keep users "informed and in control."

**Repaired:** The document discusses proposed mitigations, such as human-in-the-loop checks, straightforward opt-outs, and mandated second opinions, which aim to keep users informed and in control. This aligns with the safetyist goal of maintaining human control over autonomous systems and can help prevent the erosion of independent judgment caused by over-reliance on AI suggestions.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (safetyist, Desires, conf: 1, verdict: partial)

**Verbatim:** It imposes substantive limits on data acquisition, retention, and dissemination and requires accountability measures—such as disclosures, audits, and user-centric controls—to address the unprecedented digital vulnerabilities GenAI creates.

**Point:** The document proposes the 'Generative Privacy Doctrine' (GPD) to impose substantive limits on AI data acquisition, retention, and dissemination. It argues that because GenAI systems iteratively synthesize and infer sensitive personal information beyond what users consciously disclose, they require proactive, preventative constraints and ongoing oversight to protect fundamental rights.

**Problem:** The paraphrased point introduces the specific name 'Generative Privacy Doctrine' (GPD) and provides a detailed explanation for why GenAI systems require constraints, neither of which is present in the exact quote.

**Repaired:** The document proposes to impose substantive limits on AI data acquisition, retention, and dissemination and requires accountability measures—such as disclosures, audits, and user-centric controls—to address the unprecedented digital vulnerabilities GenAI creates.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (safetyist, Intentions, conf: 1, verdict: partial)

**Verbatim:** Courts or agencies may require the removal or “unlearning” of data improperly integrated into an AI’s training. Individuals whose data is misused (e.g., through unauthorized repurposing) should have a private right of action to seek injunctive relief and damages.

**Point:** The document calls for 'model unlearning' mandates, where AI systems must be retrained or modified to remove data that was improperly integrated or misused. This reflects a safetyist concern that current post-deployment patching is insufficient for the complex, adaptive nature of generative models.

**Problem:** The paraphrased point accurately captures the call for 'model unlearning' but omits the quote's statement about individuals having a private right of action for misused data and introduces unentailed interpretive context about 'safetyist concerns' and 'post-deployment patching'.

**Repaired:** The document calls for 'model unlearning' mandates, where AI systems must be retrained or modified to remove data that was improperly integrated or misused, and states that individuals whose data is misused should have a private right of action to seek injunctive relief and damages.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (skeptic, Beliefs, conf: 1, verdict: partial)

**Verbatim:** Individuals who uncritically accept AI suggestions risk losing independent judgment, a phenomenon dubbed “automation bias.”

**Point:** The document identifies 'automation bias' as a significant risk where individuals uncritically accept AI suggestions, leading to the loss of independent judgment. This reflects the skeptic's concern regarding the negative cognitive impacts of AI reliance. The document suggests that this phenomenon is a measurable harm that requires proactive mitigation strategies.

**Problem:** The paraphrased point adds interpretive context about "the skeptic's concern" and claims about "measurable harm" and "mitigation strategies" that are not present in the original quote, which only defines "automation bias."

**Repaired:** The document identifies 'automation bias' as a significant risk where individuals uncritically accept AI suggestions, leading to the loss of independent judgment.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (skeptic, Beliefs, conf: 1, verdict: partial)

**Verbatim:** GenAI often inherits biases from skewed training data, reinforcing or amplifying systemic inequities along racial, gender, or socioeconomic lines. Researchers have documented discriminatory outcomes in contexts like criminal justice, credit, and hiring.

**Point:** The document asserts that GenAI models often inherit and amplify systemic biases from skewed training data, leading to discriminatory outcomes in high-stakes areas like criminal justice, credit, and hiring. This aligns with the skeptic's focus on the measurable, real-world harms caused by algorithmic bias. The document calls for transparent model-building and formal accountability structures to address these inequities.

**Problem:** The paraphrased point introduces a call for transparent model-building and accountability structures, which is not present in the original quote.

**Repaired:** The document asserts that GenAI models often inherit and amplify systemic biases from skewed training data, leading to discriminatory outcomes in high-stakes areas like criminal justice, credit, and hiring. This aligns with the skeptic's focus on the measurable, real-world harms caused by algorithmic bias.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (skeptic, Beliefs, conf: 1, verdict: partial)

**Verbatim:** Large-scale AI intensively consumes electricity and water, enlarging carbon footprints and straining resources. These ecological costs may be overlooked as AI labs race to improve performance, yet growing awareness has yielded “green AI” pledges and energy-use guidelines.

**Point:** The document highlights the significant environmental costs of AI, noting that intensive consumption of electricity and water for training models strains resources. It argues that these ecological costs are often overlooked in the race for performance, necessitating an environmental dimension in ethical AI deployment.

**Problem:** The paraphrase changes "may be overlooked" to "often overlooked" and interprets the outcome of growing awareness as "necessitating an environmental dimension in ethical AI deployment" rather than stating that it has "yielded 'green AI' pledges and energy-use guidelines."

**Repaired:** The document highlights the significant environmental costs of AI, noting that intensive consumption of electricity and water for training models strains resources. It argues that these ecological costs may be overlooked in the race for performance, yet growing awareness has yielded "green AI" pledges and energy-use guidelines.

---

## 8. Recommendation

**False-accept rate 95.8%. Source extraction has a significant faithfulness problem. Entailment verification should be added to the summarization pipeline.**

### Decision criteria applied:
- False-accept rate <5% → source extraction is faithful, no action needed
- False-accept rate 5-15% → consider sampled entailment verification
- False-accept rate >15% → entailment verification needed for summarization pipeline
