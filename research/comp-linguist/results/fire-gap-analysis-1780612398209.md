# FIRE Gap Analysis — Experiment Report

**Date:** 2026-06-04
**Claims analyzed:** 170
**Debates:** cal-batch-01-safety-sharing, cal-batch-02-compute-governance, cal-batch-03-open-source-risk, cal-batch-04-kill-switches, cal-batch-05-differential-dev
**Model:** gemini-2.5-flash
**Ticket:** t/372 (gated on this experiment)

## 1. Overall Entailment Verdict

| Verdict | Count | Rate |
|---------|-------|------|
| entailed | 156 | 91.8% |
| partial | 13 | 7.6% |
| not_entailed | 1 | 0.6% |

**False-accept rate (partial + not_entailed):** 8.2%

## 2. Cross-Tabulation: FIRE Overlap Bucket × Entailment

| Overlap Bucket | Total | Entailed | Partial | Not Entailed | False-Accept Rate |
|----------------|-------|----------|---------|--------------|-------------------|
| 90-100% | 145 | 134 | 10 | 1 | 7.6% |
| 70-89% | 20 | 18 | 2 | 0 | 10.0% |
| 50-69% | 4 | 4 | 0 | 0 | 0.0% |
| 30-49% | 1 | 0 | 1 | 0 | 100.0% |

## 3. Confidence Cap Analysis

FIRE caps extraction_confidence when overlap < 70%. Of 0 capped claims:
- 0 were actually entailed (cap was **over-penalizing**)
- 0 were partial/not_entailed (cap was **warranted**)
- Cap accuracy: 0.0%

## 4. By Speaker

| Speaker | Total | Entailed | Partial | Not Entailed | FA Rate |
|---------|-------|----------|---------|--------------|---------|
| Accelerationist | 71 | 68 | 3 | 0 | 4.2% |
| Safetyist | 63 | 56 | 6 | 1 | 11.1% |
| Skeptic | 36 | 32 | 4 | 0 | 11.1% |

## 5. By BDI Category

| Category | Total | Entailed | Partial | Not Entailed | FA Rate |
|----------|-------|----------|---------|--------------|---------|
| belief | 92 | 84 | 7 | 1 | 8.7% |
| intention | 53 | 47 | 6 | 0 | 11.3% |
| desire | 25 | 25 | 0 | 0 | 0.0% |

## 6. Sample Failures (up to 10, sorted by overlap ascending)

### AN-27 (cal-batch-04-kill-switches, overlap: 44%, verdict: partial)

**Statement excerpt:** I concede that in high-speed, automated logistics, human reaction time is a systemic bottleneck that precludes manual intervention as a primary safety mechanism. Accelerationist is correct that requiring a human to manually toggle a switch in a millisecond-scale supply chain is an industrial-era rel...

**Claim:** Automating the authorization to terminate a system delegates moral agency to the machine itself.

**Problem:** The statement argues that automating authorization creates an unaccountable safety regime and shifts accountability from institutional to purely algorithmic, but it does not explicitly state that moral agency is delegated to the machine itself.

**Repaired:** Automating the authorization to terminate a system makes accountability purely algorithmic rather than institutional.

---

### AN-2 (cal-batch-05-differential-dev, overlap: 80%, verdict: partial)

**Statement excerpt:** Differential development is a mirage; we are not choosing between safety and speed, but between corporate-led enclosure of intelligence and community-governed, socially grounded utility. Accelerationist and Safetyist both treat AI as an autonomous force of nature that requires either more fuel or mo...

**Claim:** Frontier safety frameworks function primarily as regulatory moats that prioritize deployment velocity over documented, present-day harms.

**Problem:** The claim accurately states that frontier safety frameworks function as regulatory moats, but it attributes the act of prioritizing deployment velocity directly to the frameworks, whereas the statement attributes this prioritization to companies when they define their own oversight, which the frameworks enable.

**Repaired:** Frontier safety frameworks function primarily as regulatory moats that enable companies to prioritize deployment velocity over documented, present-day harms.

---

### AN-23 (cal-batch-03-open-source-risk, overlap: 87%, verdict: partial)

**Statement excerpt:** I concede that federated interpretability protocols represent the correct technical path for ensuring transparency, as they allow for a diverse, decentralized diagnostic ecosystem that avoids the risks of intellectual monoculture. However, Safetyist’s insistence on a central governing body to mandat...

**Claim:** If a lab’s model exceeds a 5% probability of catastrophic failure, that firm’s mandatory insurance premiums would increase by at least 30% annually.

**Problem:** The claim omits the crucial condition that the catastrophic failure probability must be "as verified by the federated diagnostic layer" for the insurance premiums to increase.

**Repaired:** If a lab’s model exceeds a 5% probability of catastrophic failure as verified by the federated diagnostic layer, that firm’s mandatory insurance premiums would increase by at least 30% annually.

---

### AN-7 (cal-batch-04-kill-switches, overlap: 90%, verdict: partial)

**Statement excerpt:** The presence of a functional, verifiable kill switch is the definitive litmus test for whether an AI system remains a tool of human intent or has transitioned into an unconstrained, unaccountable agent. Accelerationist argues that speed is our primary defense against existential threats, suggesting ...

**Claim:** Mandatory overrides serve as the only viable mitigation against the scaling of catastrophic hazards.

**Problem:** The claim omits the crucial qualifier 'in complex architectures' which limits the scope of the mitigation in the original statement.

**Repaired:** Mandatory overrides serve as the only viable mitigation against the scaling of catastrophic hazards in complex architectures.

---

### AN-17 (cal-batch-03-open-source-risk, overlap: 93%, verdict: partial)

**Statement excerpt:** I conditionally agree: a non-commercial mission-oriented consortium is theoretically superior to a commercial monopoly, but I reject the claim that it can avoid the structural fragility and intellectual stagnation inherent in any centralized research bottleneck. Centralization, even when decoupled f...

**Claim:** A diverse ecosystem of ≥50 competing research labs provides a far more robust defense against the unknown unknowns of frontier model behavior.

**Problem:** The claim omits the specific details about the nature of the diversity (different architectures and evaluation frameworks) that the statement provides as the reason for the robustness.

**Repaired:** A diverse ecosystem of ">="50 competing research labs, each with different architectures and evaluation frameworks, provides a far more robust defense against the unknown unknowns of frontier model behavior.

---

### AN-22 (cal-batch-03-open-source-risk, overlap: 93%, verdict: partial)

**Statement excerpt:** My position has evolved: I now hold that federated interpretability protocols are the optimal technical mechanism for transparency, provided they are coupled with centralized, mission-oriented institutional oversight to enforce safety thresholds. While I previously emphasized a singular research ent...

**Claim:** A central governing body remains essential to mandate that these tools are used and to enforce non-negotiable safety ceilings.

**Problem:** The claim omits the crucial condition under which the central governing body enforces non-negotiable safety ceilings.

**Repaired:** A central governing body remains essential to mandate that these tools are used and to enforce non-negotiable safety ceilings when evidence of hazardous capabilities emerges.

---

### AN-5 (cal-batch-04-kill-switches, overlap: 93%, verdict: partial)

**Statement excerpt:** The presence of a functional, verifiable kill switch is the definitive litmus test for whether an AI system remains a tool of human intent or has transitioned into an unconstrained, unaccountable agent. Accelerationist argues that speed is our primary defense against existential threats, suggesting ...

**Claim:** The presence of a functional, verifiable kill switch is the definitive litmus test for whether an AI system remains a tool of human intent.

**Problem:** The claim omits a crucial part of the litmus test as defined in the statement, specifically the alternative outcome of transitioning into an unconstrained, unaccountable agent.

**Repaired:** The presence of a functional, verifiable kill switch is the definitive litmus test for whether an AI system remains a tool of human intent or has transitioned into an unconstrained, unaccountable agent.

---

### AN-34 (cal-batch-02-compute-governance, overlap: 95%, verdict: partial)

**Statement excerpt:** While Accelerationist correctly asserts that `safety (empirical)` must be a continuous, multi-layered process incorporating extensive testing and adversarial training (AN-25), this approach fundamentally fails when facing `risk (existential)` from `deceptive alignment`. The critical distinction lies...

**Claim:** While Accelerationist correctly asserts that `safety (empirical)` must be a continuous, multi-layered process, this approach fundamentally fails when facing `risk (existential)` from `deceptive alignment`.

**Problem:** The claim omits specific details about the nature of the 'continuous, multi-layered process' (incorporating extensive testing and adversarial training) that the statement attributes to Accelerationist.

**Repaired:** While Accelerationist correctly asserts that `safety (empirical)` must be a continuous, multi-layered process incorporating extensive testing and adversarial training, this approach fundamentally fails when facing `risk (existential)` from `deceptive alignment`.

---

### AN-19 (cal-batch-01-safety-sharing, overlap: 100%, verdict: not_entailed)

**Statement excerpt:** I agree with Skeptic that addressing documented, present harm, such as algorithmic discrimination or job displacement, constitutes a vital public good that demands our immediate attention. However, preventing systemic, irreversible harm, particularly `risk (existential)` from advanced AI, represents...

**Claim:** Accelerationist dismisses `risk (existential)` as 'irrational, millenarian fears' and claims the opportunity cost of delayed deployment, as outlined in `sit-005` (What's the Biggest AI Risk?), far exceeds these 'speculative' scenarios.

**Problem:** The statement attributes the dismissal of existential risk and the argument about opportunity cost to 'Prometheus', not 'Accelerationist'.

**Repaired:** Prometheus dismisses `risk (existential)` as 'irrational, millenarian fears' and claims the opportunity cost of delayed deployment, as outlined in `sit-005` (What's the Biggest AI Risk?), far exceeds these 'speculative' scenarios.

---

### AN-40 (cal-batch-01-safety-sharing, overlap: 100%, verdict: partial)

**Statement excerpt:** Accelerationist's assertion of a "teleological progression of complexity" for AI, and the idea that its "Jagged Ability Line" is a temporary challenge advanced AI will overcome through recursive self-improvement, lacks empirical grounding and relies on speculative extrapolation rather than observed ...

**Claim:** Accelerationist's proposed market-driven liability framework, including "bidirectional liability through symmetric litigation exposure," and reliance on `safety (empirical)` through output testing, is fundamentally insufficient for `risk (existential)` and `control (human agency)`.

**Problem:** The claim incorrectly attributes the market-driven liability framework to "Accelerationist" instead of "Prometheus" as stated in the text.

**Repaired:** Prometheus's proposed market-driven liability framework, including "bidirectional liability through symmetric litigation exposure," and reliance on `safety (empirical)` through output testing, is fundamentally insufficient for `risk (existential)` and `control (human agency)`.

---

## 7. Recommendation

**False-accept rate 8.2%. Add entailment-and-repair as a sampled post-pass (30% of turns).**

### Decision criteria applied:
- False-accept rate <5% → FIRE sufficient, shelve t/372
- False-accept rate 5-15% → sampled entailment post-pass (30% of turns)
- False-accept rate >15% → entailment check on every turn
- Per TL guidance: weight by downstream impact, not just rate
