# FIRE Gap Analysis — Experiment Report

**Date:** 2026-06-04
**Claims analyzed:** 133
**Debates:** validation-01-ai-labeling, validation-03-doc-crisis, validation-09-jobloss-mod, validation-13-milai-mod
**Model:** gemini-2.5-flash
**Ticket:** t/372 (gated on this experiment)

## 1. Overall Entailment Verdict

| Verdict | Count | Rate |
|---------|-------|------|
| entailed | 114 | 85.7% |
| partial | 19 | 14.3% |
| not_entailed | 0 | 0.0% |

**False-accept rate (partial + not_entailed):** 14.3%

## 2. Cross-Tabulation: FIRE Overlap Bucket × Entailment

| Overlap Bucket | Total | Entailed | Partial | Not Entailed | False-Accept Rate |
|----------------|-------|----------|---------|--------------|-------------------|
| 90-100% | 75 | 68 | 7 | 0 | 9.3% |
| 70-89% | 43 | 33 | 10 | 0 | 23.3% |
| 50-69% | 11 | 9 | 2 | 0 | 18.2% |
| 30-49% | 4 | 4 | 0 | 0 | 0.0% |

## 3. Confidence Cap Analysis

FIRE caps extraction_confidence when overlap < 70%. Of 0 capped claims:
- 0 were actually entailed (cap was **over-penalizing**)
- 0 were partial/not_entailed (cap was **warranted**)
- Cap accuracy: 0.0%

## 4. By Speaker

| Speaker | Total | Entailed | Partial | Not Entailed | FA Rate |
|---------|-------|----------|---------|--------------|---------|
| Accelerationist | 56 | 46 | 10 | 0 | 17.9% |
| Safetyist | 41 | 35 | 6 | 0 | 14.6% |
| Skeptic | 36 | 33 | 3 | 0 | 8.3% |

## 5. By BDI Category

| Category | Total | Entailed | Partial | Not Entailed | FA Rate |
|----------|-------|----------|---------|--------------|---------|
| belief | 78 | 69 | 9 | 0 | 11.5% |
| intention | 35 | 28 | 7 | 0 | 20.0% |
| desire | 20 | 17 | 3 | 0 | 15.0% |

## 6. Sample Failures (up to 10, sorted by overlap ascending)

### AN-23 (validation-13-milai-mod, overlap: 55%, verdict: partial)

**Statement excerpt:** My position is consistent: the Control Quality Score and meaningful human oversight are fundamentally incompatible because the distillation process required for the former inherently strips away the qualitative context required for the latter. Safetyist claims that these metrics act as an amplifier ...

**Claim:** Relying on proprietary scoring systems creates an environment where audit washing is the inevitable outcome.

**Problem:** The claim omits the crucial condition that audit washing is an inevitable outcome when reliance on proprietary scoring systems *replaces independent critical inquiry*.

**Repaired:** When we replace independent critical inquiry with reliance on proprietary scoring systems, we create an environment where audit washing is the inevitable outcome.

---

### AN-20 (validation-09-jobloss-mod, overlap: 57%, verdict: partial)

**Statement excerpt:** I concede that the Engels Pause, as noted by Accelerationist, offers a historical precedent for productivity gains, but it serves as a stark warning of human suffering rather than a blueprint for a stable transition. Relying on a 'capital-dividend model' as a post-hoc patch for systemic labor displa...

**Claim:** Mandating compute-threshold reporting for systems scaling beyond 10^26 FLOPS is a necessary prerequisite to any credible distribution of economic yields.

**Problem:** The claim invents a specific numerical threshold (10^26 FLOPS) for compute-threshold reporting that is not mentioned in the statement.

**Repaired:** Mandating compute-threshold reporting is a necessary prerequisite to any credible distribution of economic yields.

---

### AN-27 (validation-13-milai-mod, overlap: 70%, verdict: partial)

**Statement excerpt:** My position is consistent: the Control Quality Score (CQS) and robust architectural engineering are compatible because the score functions as a diagnostic trigger rather than a performance target. By treating the CQS as a mandatory telemetry standard, we force developers to address the underlying te...

**Claim:** The CQS relies on an open-standard telemetry protocol that requires disclosure of internal agent states.

**Problem:** The claim accurately states that the CQS relies on an open-standard telemetry protocol requiring disclosure of internal agent states, but it omits the crucial detail that this disclosure is specifically to independent regulators.

**Repaired:** The CQS relies on an open-standard telemetry protocol that requires disclosure of internal agent states to independent regulators.

---

### AN-18 (validation-13-milai-mod, overlap: 77%, verdict: partial)

**Statement excerpt:** Safetyist’s reliance on the fly-by-wire analogy is a fundamental category error because it conflates the deterministic physics of flight with the high-entropy, non-deterministic environment of autonomous agents. In a fly-by-wire system, engineers define safety envelopes based on immutable laws of ae...

**Claim:** Market-based incentives force developers to prioritize empirical robustness over the fragile bottleneck of human reaction time.

**Problem:** The claim attributes the forcing mechanism solely to "market-based incentives," whereas the statement specifies "liability, when structured through competitive market incentives and transparent empirical verification" as the complete mechanism.

**Repaired:** Liability, when structured through competitive market incentives and transparent empirical verification, forces developers to prioritize empirical robustness over the fragile bottleneck of human reaction time.

---

### AN-24 (validation-13-milai-mod, overlap: 83%, verdict: partial)

**Statement excerpt:** My position is consistent: decentralized strict liability and the mitigation of agentic failure modes are compatible because financial exposure forces developers to internalize the technical costs of belief resistance and interpretive divergence that centralized, compliance-based frameworks like AMA...

**Claim:** If a developer faces a mandatory $500 million liability reserve, they must implement robust internal verification mechanisms to ensure the agent maintains alignment.

**Problem:** The claim accurately states that developers must implement robust internal verification mechanisms given the liability, but it omits the specific type and scope of alignment mentioned in the statement ('functional alignment across complex, multi-step planning cycles').

**Repaired:** If a developer faces a mandatory $500 million liability reserve, they must implement robust internal verification mechanisms to ensure the agent maintains functional alignment across complex, multi-step planning cycles.

---

### AN-12 (validation-01-ai-labeling, overlap: 85%, verdict: partial)

**Statement excerpt:** My position is consistent: provenance-aware architectures and state mandates are compatible because a decentralized market lacks the coordination mechanism to enforce uniform veracity standards against the short-term incentive to use cheaper, synthetic data. Accelerationist correctly identifies that...

**Claim:** Model collapse is a tragedy of the commons where individual firms prioritize competitive throughput over epistemic integrity.

**Problem:** The claim accurately identifies model collapse as a tragedy of the commons and the prioritization of throughput, but it presents the latter as part of the definition of the tragedy of the commons rather than a consequence of it.

**Repaired:** Model collapse is a tragedy of the commons, leading to individual firms prioritizing competitive throughput over epistemic integrity.

---

### AN-19 (validation-03-doc-crisis, overlap: 86%, verdict: partial)

**Statement excerpt:** I conditionally agree: the current absence of national productivity gains is a measurable reality, but it does not refute the potential for an AI-driven productivity shock. Historical precedents for transformative technologies, such as the electrification of industry, consistently reveal a significa...

**Claim:** Historical precedents for transformative technologies consistently reveal a significant lag between the initial infrastructure build-out and the realization of output growth.

**Problem:** The claim omits specific qualifiers like "capital-intensive," "eventual," and "macro-scale" from the original statement.

**Repaired:** Historical precedents for transformative technologies consistently reveal a significant lag between the initial, capital-intensive infrastructure build-out and the eventual realization of macro-scale output growth.

---

### AN-28 (validation-13-milai-mod, overlap: 86%, verdict: partial)

**Statement excerpt:** My position is consistent: strict liability and real-time verification are compatible because the former mandates the latter as a necessary risk-mitigation strategy. The AMAGF’s performative 'soft' metrics fail because they invite gaming, whereas a $500 million liability reserve forces developers to...

**Claim:** A $500 million liability reserve forces developers to treat safety as a capital-intensive engineering problem requiring formal verification.

**Problem:** The claim accurately states that a $500 million liability reserve forces developers to treat safety as a capital-intensive engineering problem requiring formal verification, but it omits the additional requirement of 'interpretability tools' mentioned in the statement.

**Repaired:** A $500 million liability reserve forces developers to treat safety as a capital-intensive engineering problem requiring formal verification and interpretability tools.

---

### AN-16 (validation-01-ai-labeling, overlap: 88%, verdict: partial)

**Statement excerpt:** I conditionally agree: passive, uncritical ingestion of synthetic content can lead to reduced engagement with complex tasks, but I reject the claim that this is an inherent property of the technology rather than a failure of current educational and interface design. History shows that every major co...

**Claim:** Mandatory labeling is a governance mirage that ignores the reality that human agency is strengthened by tools that enable us to verify and build upon machine-generated insights.

**Problem:** The claim accurately states that mandatory labeling is a governance mirage and that human agency is strengthened by tools for verification and building upon machine-generated insights, but it omits 'iterate' from the list of actions these tools enable.

**Repaired:** Mandatory labeling is a governance mirage that ignores the reality that human agency is strengthened by tools that enable us to verify, iterate, and build upon machine-generated insights.

---

### AN-33 (validation-03-doc-crisis, overlap: 88%, verdict: partial)

**Statement excerpt:** Accelerationist suggests that AI-driven grid optimization will yield a 20% efficiency gain by 2028, but this claim treats a safety-critical utility as a static optimization problem rather than a complex, dynamic environment prone to catastrophic failure. Achieving such gains requires the deployment ...

**Claim:** If these systems cannot demonstrate robust uncertainty quantification and provide verifiable safety guarantees, then the proposed 20% gain is not an innovation—it is a reckless gamble.

**Problem:** The claim accurately reflects the conditional statement but omits two important qualifying phrases from the original text regarding accountability standards and the stability of civilizational foundations.

**Repaired:** If these systems cannot demonstrate robust uncertainty quantification and provide verifiable safety guarantees that satisfy institutional accountability standards, then the proposed 20% gain is not an innovation—it is a reckless gamble with the stability of our civilizational foundations.

---

## 7. Recommendation

**False-accept rate 14.3%. Add entailment-and-repair as a sampled post-pass (30% of turns).**

### Decision criteria applied:
- False-accept rate <5% → FIRE sufficient, shelve t/372
- False-accept rate 5-15% → sampled entailment post-pass (30% of turns)
- False-accept rate >15% → entailment check on every turn
- Per TL guidance: weight by downstream impact, not just rate
