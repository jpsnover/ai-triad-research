# Source Extraction Gap Analysis — Experiment Report

**Date:** 2026-06-05
**Key points analyzed:** 145
**Source summaries sampled:** 10
**Model:** gemini-2.5-flash
**Ticket:** t/377

## 1. Overall Entailment Verdict

| Verdict | Count | Rate |
|---------|-------|------|
| entailed | 9 | 6.2% |
| partial | 89 | 61.4% |
| not_entailed | 47 | 32.4% |

**False-accept rate (partial + not_entailed):** 93.8%

## 2. By POV (Lens)

| POV | Total | Entailed | Partial | Not Entailed | FA Rate |
|-----|-------|----------|---------|--------------|---------|
| Accelerationist | 32 | 2 | 18 | 12 | 93.8% |
| Safetyist | 60 | 3 | 40 | 17 | 95.0% |
| Skeptic | 53 | 4 | 31 | 18 | 92.5% |

## 3. By BDI Category

| Category | Total | Entailed | Partial | Not Entailed | FA Rate |
|----------|-------|----------|---------|--------------|---------|
| beliefs | 55 | 3 | 34 | 18 | 94.5% |
| desires | 27 | 1 | 18 | 8 | 96.3% |
| intentions | 63 | 5 | 37 | 21 | 92.1% |

## 4. By extraction_confidence Bucket

| Confidence | Total | Entailed | Partial | Not Entailed | FA Rate |
|------------|-------|----------|---------|--------------|---------|
| 0.95-1.00 | 85 | 6 | 65 | 14 | 92.9% |
| 0.90-0.94 | 36 | 2 | 15 | 19 | 94.4% |
| 0.80-0.89 | 6 | 0 | 0 | 6 | 100.0% |
| missing | 18 | 1 | 9 | 8 | 94.4% |

## 5. extraction_confidence Field Audit

- Populated: 127/145 (87.6%)
- Missing: 18

## 6. By Stance

| Stance | Total | Entailed | Partial | Not Entailed | FA Rate |
|--------|-------|----------|---------|--------------|---------|
| aligned | 113 | 6 | 73 | 34 | 94.7% |
| strongly_aligned | 19 | 2 | 12 | 5 | 89.5% |
| neutral | 9 | 0 | 1 | 8 | 100.0% |
| opposed | 4 | 1 | 3 | 0 | 75.0% |

## 7. Sample Failures (up to 10, sorted by extraction_confidence descending)

### generative-privacy-doctrine-case-new-legal-privacy-2026 (accelerationist, Intentions, conf: 1, verdict: partial)

**Verbatim:** GPD addresses this by advocating “regulatory sandboxes” and tiered compliance: smaller AI ventures face proportionate obligations, whereas large platforms with massive datasets undergo more stringent oversight. Such an approach aims to protect privacy interests while allowing academic and startup-level experimentation.

**Point:** The document advocates for 'regulatory sandboxes' and tiered compliance frameworks to prevent over-regulation from stifling AI research and commercial deployment. By allowing smaller ventures more flexibility while focusing stringent oversight on large platforms, the proposal seeks to balance necessary privacy protections with the need for continued innovation. This approach aligns with the accelerationist goal of maintaining a dynamic environment for technological experimentation.

**Problem:** The first sentence of the paraphrase omits a key aim of the advocated approach mentioned in the quote: 'to protect privacy interests'. While the paraphrase mentions preventing over-regulation from stifling AI research and commercial deployment (which aligns with 'allowing academic and startup-level experimentation'), it does not explicitly state the goal of protecting privacy interests as part of the initial claim.

**Repaired:** The document advocates for 'regulatory sandboxes' and tiered compliance frameworks to protect privacy interests and prevent over-regulation from stifling AI research and commercial deployment. By allowing smaller ventures more flexibility while focusing stringent oversight on large platforms, the proposal seeks to balance necessary privacy protections with the need for continued innovation. This approach aligns with the accelerationist goal of maintaining a dynamic environment for technological experimentation.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (safetyist, Beliefs, conf: 1, verdict: not_entailed)

**Verbatim:** GenAI systems built on large language models (“LLMs”) and massive datasets do more than merely process data: they synthesize new content from user inputs in ways that can catch individuals off-guard.

**Point:** The document asserts that GenAI's ability to synthesize new content from user inputs creates unique privacy risks that existing legal frameworks cannot address. It highlights the danger of 'co-created' data where AI-generated inferences are indistinguishable from user-disclosed information. This aligns with safetyist concerns regarding the opacity of AI systems and the potential for catastrophic loss of individual autonomy.

**Problem:** The first sentence of the paraphrase introduces specific claims about 'unique privacy risks' and the inability of 'existing legal frameworks' to address them. The original quote only states that GenAI's synthesis of new content 'can catch individuals off-guard,' which is a more general statement and does not explicitly mention privacy risks or legal frameworks.

**Repaired:** The document asserts that GenAI's ability to synthesize new content from user inputs can catch individuals off-guard. It highlights the danger of 'co-created' data where AI-generated inferences are indistinguishable from user-disclosed information. This aligns with safetyist concerns regarding the opacity of AI systems and the potential for catastrophic loss of individual autonomy.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (safetyist, Intentions, conf: 1, verdict: partial)

**Verbatim:** GPD tackles inferential data creation, mandates iterative user consent, and imposes carefully tailored third-party restrictions that deter exploitative or discriminatory use.

**Point:** The author proposes the 'Generative Privacy Doctrine' (GPD) to mandate iterative user consent and third-party restrictions. This reflects a safetyist intention to impose structural constraints on AI development to prevent exploitative or discriminatory outcomes. The framework aims to bridge the gap between current legal doctrines and the novel risks posed by generative models.

**Problem:** The first sentence of the paraphrase omits a key function of GPD mentioned in the quote: 'tackles inferential data creation'. It also omits the qualifiers for 'third-party restrictions', specifically 'carefully tailored' and 'that deter exploitative or discriminatory use'.

**Repaired:** The author proposes the 'Generative Privacy Doctrine' (GPD) to tackle inferential data creation, mandate iterative user consent, and impose carefully tailored third-party restrictions that deter exploitative or discriminatory use. This reflects a safetyist intention to impose structural constraints on AI development to prevent exploitative or discriminatory outcomes. The framework aims to bridge the gap between current legal doctrines and the novel risks posed by generative models.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (safetyist, Beliefs, conf: 1, verdict: partial)

**Verbatim:** A European user’s request to delete personal anecdotes embedded in a black-box AI model (with opaque internal architecture) exemplifies how verifying actual deletion can be difficult—especially if the system’s training process irreversibly intermingles user data.

**Point:** The document highlights the inherent opacity of black-box AI models, which makes verifying the deletion of personal data nearly impossible. This opacity hinders accountability and necessitates stronger regulatory frameworks. The safetyist perspective emphasizes that without complementary safeguards, such as mechanistic interpretability or rigorous auditing, these systems pose significant risks to privacy and data integrity.

**Problem:** The paraphrase overstates the claim from the quote. The quote states that verifying deletion "can be difficult," especially under certain conditions. The paraphrase claims it is "nearly impossible" and omits the specific condition under which it becomes *especially* difficult. This changes the scope and degree of the claim.

**Repaired:** The document highlights the inherent opacity of black-box AI models, which can make verifying the deletion of personal data difficult, especially if the system's training process irreversibly intermingles user data.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (safetyist, Intentions, conf: 1, verdict: partial)

**Verbatim:** Proposed mitigations, such as “human-in-the-loop” checks, straightforward opt-outs, or mandated second opinions, aim to keep users informed and in control.

**Point:** The document argues for human-in-the-loop checks and mandated second opinions to mitigate the risks of automation bias. This aligns with the safetyist goal of maintaining human control over autonomous systems. By requiring these interventions, the document seeks to prevent the erosion of independent judgment caused by over-reliance on AI suggestions.

**Problem:** The paraphrase omits "straightforward opt-outs" from the list of proposed mitigations mentioned in the quote. Additionally, it changes the stated aim of these mitigations from "keep users informed and in control" to "mitigate the risks of automation bias," which is an interpretation not explicitly present in the exact quote's stated purpose.

**Repaired:** The document argues for proposed mitigations such as human-in-the-loop checks, straightforward opt-outs, or mandated second opinions, which aim to keep users informed and in control.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (safetyist, Desires, conf: 1, verdict: partial)

**Verbatim:** It imposes substantive limits on data acquisition, retention, and dissemination and requires accountability measures—such as disclosures, audits, and user-centric controls—to address the unprecedented digital vulnerabilities GenAI creates.

**Point:** The document proposes the 'Generative Privacy Doctrine' (GPD) to impose substantive limits on AI data acquisition, retention, and dissemination. It argues that because GenAI systems iteratively synthesize and infer sensitive personal information beyond what users consciously disclose, they require proactive, preventative constraints and ongoing oversight to protect fundamental rights.

**Problem:** The paraphrase accurately captures the first part of the quote regarding substantive limits on data acquisition, retention, and dissemination. However, it entirely omits the second crucial part of the quote, which states that 'It' also 'requires accountability measures—such as disclosures, audits, and user-centric controls—to address the unprecedented digital vulnerabilities GenAI creates.' This omission significantly narrows the scope of the original statement.

**Repaired:** The document proposes the 'Generative Privacy Doctrine' (GPD) to impose substantive limits on AI data acquisition, retention, and dissemination and requires accountability measures—such as disclosures, audits, and user-centric controls—to address the unprecedented digital vulnerabilities GenAI creates.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (safetyist, Intentions, conf: 1, verdict: partial)

**Verbatim:** Courts or agencies may require the removal or “unlearning” of data improperly integrated into an AI’s training. Individuals whose data is misused (e.g., through unauthorized repurposing) should have a private right of action to seek injunctive relief and damages.

**Point:** The document calls for 'model unlearning' mandates, where AI systems must be retrained or modified to remove data that was improperly integrated or misused. This reflects a safetyist concern that current post-deployment patching is insufficient for the complex, adaptive nature of generative models.

**Problem:** The paraphrase accurately captures the call for 'model unlearning' for improperly integrated data but broadens the scope of these mandates to explicitly include 'misused' data. The quote, however, links 'misused' data to a separate mechanism: a private right of action for individuals, rather than directly to 'model unlearning' mandates from courts or agencies.

**Repaired:** The document calls for 'model unlearning' mandates, where AI systems must be retrained or modified to remove data that was improperly integrated, and also advocates for a private right of action for individuals whose data is misused.

---

### generative-privacy-doctrine-case-new-legal-privacy-2026 (skeptic, Beliefs, conf: 1, verdict: partial)

**Verbatim:** Large-scale AI intensively consumes electricity and water, enlarging carbon footprints and straining resources. These ecological costs may be overlooked as AI labs race to improve performance, yet growing awareness has yielded “green AI” pledges and energy-use guidelines.

**Point:** The document highlights the significant environmental costs of AI, noting that intensive consumption of electricity and water for training models strains resources. It argues that these ecological costs are often overlooked in the race for performance, necessitating an environmental dimension in ethical AI deployment.

**Problem:** The first sentence of the paraphrase narrows the scope of AI's consumption to 'training models' when the quote refers more broadly to 'Large-scale AI'. It also omits 'enlarging carbon footprints' as a specific environmental cost, mentioning only 'strains resources' in its detailed explanation of costs.

**Repaired:** The document highlights the significant environmental costs of large-scale AI, noting that its intensive consumption of electricity and water enlarges carbon footprints and strains resources.

---

### sr25629232330-2026 (safetyist, Beliefs, conf: 1, verdict: partial)

**Verbatim:** This recursive learning loop, commonly known as "Model Collapse" or "Data Feedback Poisoning," could result in irreversible degradation in model quality, creativity, and factual correctness.

**Point:** The document identifies 'model collapse' as a systemic risk where recursive training on AI-generated data leads to irreversible degradation in model quality and factual correctness. This process involves the compounding of small errors and stylistic biases, which eventually causes models to lose touch with authentic human knowledge. From a safetyist perspective, this is a critical failure mode that threatens the reliability of AI systems in high-stakes domains like healthcare and law.

**Problem:** The paraphrase changes the certainty from 'could result in' to 'leads to', omits 'creativity' from the list of degraded aspects, and adds 'systemic risk' and 'on AI-generated data' which are not explicitly present in the original quote.

**Repaired:** The document identifies 'model collapse' as a recursive learning loop that could result in irreversible degradation in model quality, creativity, and factual correctness.

---

### incident-reporting-investigation-under-ai-act-some-insights-2026 (accelerationist, Desires, conf: 1, verdict: partial)

**Verbatim:** The purpose of post-marketing obligations, including reporting of serious incidents, is to ensure that providers of high-risk AI systems can take into account real-world use experience to improve system performance, improve design and development processes, and proceed to timely corrective action where necessary.

**Point:** The document supports the use of post-marketing obligations to facilitate continuous improvement of AI systems. By leveraging real-world use data, providers can refine system performance and design processes. This aligns with accelerationist goals of rapid iteration and the deployment of increasingly capable, trustworthy AI systems.

**Problem:** The paraphrase omits the crucial qualifier that post-marketing obligations are specifically for "high-risk AI systems," broadening the scope to all AI systems.

**Repaired:** The document supports the use of post-marketing obligations to facilitate continuous improvement of high-risk AI systems.

---

## 8. Recommendation

**False-accept rate 93.8%. Source extraction has a significant faithfulness problem. Entailment verification should be added to the summarization pipeline.**

### Decision criteria applied:
- False-accept rate <5% → source extraction is faithful, no action needed
- False-accept rate 5-15% → consider sampled entailment verification
- False-accept rate >15% → entailment verification needed for summarization pipeline
