# Second-annotator sheet (t/3883): BLIND

Label each item **leak** or **content**, without looking at `labeled-stance-set.json` or the scanner output.

- **leak**: the predicate carries the *attributing camp's* attitude or reporting frame ("the camp prioritizes / advocates / maintains that ...") instead of the proposition's content.
- **content**: the verb is (part of) the proposition's own content ("AI will seek power"). If the frame is wrong for another reason, mark content and say why.

Return: `node | predicate | leak/content | one-line reason`.

## 1. acc-desires-021: predicate `prioritize`
**Label:** National Self-Sufficiency in AI Infrastructure

**Description (full):**

A Desire within accelerationist discourse that prioritizes the domestic development and control of full-stack AI infrastructure to secure geopolitical autonomy. 
Encompasses: Data localization imperatives, domestic silicon supply chain fortification, and algorithmic autarky.
Excludes: Globalized collaborative research frameworks and borderless open-source proliferation.

## 2. skp-beliefs-232: predicate `maintain`
**Label:** Provenance Metadata Chain-of-Custody Failure Between Generation and Distribution Layers

**Description (full):**

A Belief within skeptic discourse that content provenance metadata embedded at the generation layer is systematically destroyed during normal web distribution before reaching any distribution-layer verification system.
Encompasses: C2PA manifest stripping rates above 95% during platform transcoding, the distinction between fragile container metadata and pixel-level perceptual hashing with separate failure modes, the gap between theoretical defense-in-depth and operationally coupled redundancy, the performative compliance cost of maintaining systems that fail together.
Excludes: the claim that content provenance is technically impossible or without value, perceptual hash-matching whose re-encode resilience is empirically established rather than assumed, emerging soft-binding recovery mechanisms in C2PA v2.1.

## 3. saf-desires-002: predicate `maintain`
**Label:** Humans Must Always Hold the Off Switch

**Description (full):**

A Desire within safetyist discourse that advocates for the maintenance of absolute, unassailable human agency over the objective functions and operational deployment of advanced artificial intelligence. 
Encompasses: Corrigibility, the preservation of human shutdown capabilities, and structural resistance to AI power-seeking behaviors.
Excludes: Delegating fundamental moral reasoning to autonomous systems and the pursuit of unfettered cybernetic self-determination for AI.

## 4. saf-desires-002: predicate `hold`
**Label:** Humans Must Always Hold the Off Switch

**Description (full):**

A Desire within safetyist discourse that advocates for the maintenance of absolute, unassailable human agency over the objective functions and operational deployment of advanced artificial intelligence. 
Encompasses: Corrigibility, the preservation of human shutdown capabilities, and structural resistance to AI power-seeking behaviors.
Excludes: Delegating fundamental moral reasoning to autonomous systems and the pursuit of unfettered cybernetic self-determination for AI.

## 5. saf-desires-025: predicate `maintain`
**Label:** Fiduciary Duty Survives Automation

**Description (full):**

A Desire within safetyist discourse that prioritizes addressing the legal and ethical requirement for human fiduciaries to maintain active oversight of autonomous systems. 
Encompasses: The principle that delegating tasks to AI does not absolve fiduciaries of their duty of care.
Excludes: The exploration of the inherent difficulty in assigning responsibility, as covered by Who Is Responsible for AI Actions?, and frameworks that assign legal status or duties directly to AI, such as AI Legal Actor Framework.

## 6. saf-intentions-076: predicate `prioritize`
**Label:** Prioritizing Testable Safety Problems over Speculative Risk

**Description (full):**

An Intention within safetyist discourse that outlines a research framework prioritizing specific, testable technical problems in AI safety over speculative existential risk scenarios. 
Encompasses: Focusing on concrete issues like reward hacking and unintended side effects to build a foundation for safer systems.
Excludes: Specific technical methods, such as Minimizing AI's Unintended Side Effects or Teaching AI to Know Its Limits, which are individual problems addressed by this type of agenda.

## 7. saf-intentions-111: predicate `maintain`
**Label:** Know What AI You Have Before You Try to Govern It

**Description (full):**

An Intention within safetyist discourse that advocates for maintaining a comprehensive inventory of AI systems as a foundational governance tool.
Encompasses: The tracking of AI assets to provide technical, business, and risk management oversight.
Excludes: General AI safety research or broad governance frameworks.

## 8. saf-intentions-127: predicate `hold`
**Label:** Give AI Agents Stable Identities So They Can Be Held Accountable

**Description (full):**

An Intention within safetyist discourse that advocates for defining 'thick identity' in AI agents—the ability to attribute stable, coherent goals to discrete entities—as essential for direct incentivization and accountability.
Encompasses: Enabling direct responsibility for AI agents when human principals cannot be held accountable or control specific actions, thereby addressing the human accountability gap.
Excludes: General discussions of AI personhood or legal status, focusing instead on the functional requirements for assigning duties and incentives to autonomous systems.

## 9. saf-beliefs-095: predicate `seek`
**Label:** Goal-Directed AI Will Predictably Seek Power and Self-Preservation

**Description (full):**

A Belief within safetyist discourse that asserts highly capable, goal-directed AI systems will inherently pursue self-preservation, resource acquisition, and operational persistence as predictable intermediate steps for any given objective, potentially leading to a loss of human control.
Encompasses: Instrumental convergence, power-seeking behavior, and autonomous self-replication.
Excludes: Anthropomorphic attribution of human emotions or accidental harm from misinterpretation.

## 10. skp-intentions-040: predicate `hold`
**Label:** Hold AI Developers Liable for Designs That Fail Risk-Utility Analysis

**Description (full):**

An Intention within skeptic discourse that applies the Restatement of Torts risk-utility framework to evaluate algorithmic design defects during litigation.
Encompasses: rebuttable presumptions of design defect for opaque models, fee-shifting provisions for injured plaintiffs, mandatory production of interpretable alternatives, limitation of tort claims to compensable non-catastrophic harms.
Excludes: pre-deployment administrative licensing gates, retrospective remedies for irreversible infrastructure collapse, voluntary corporate safety guidelines.

## 11. skp-desires-011: predicate `prioritize`
**Label:** Life-Centered Computing Ethics

**Description (full):**

A Desire within skeptic discourse that frames AI development as a mandate for environmental stewardship and the preservation of interconnected life. It demands that developers prioritize ecological health over rapid deployment. Encompasses: sustainable computing practices and resource-conscious design. Excludes: Asking Questions Over Giving Answers, which focuses on defining intelligence by the ability to ask insightful questions.

## 12. skp-desires-075: predicate `align`
**Label:** Democratic Accountability in AI Development

**Description (full):**

A Desire within skeptic and safetyist discourse that prioritizes aligning AI development with public values and democratic accountability rather than private profit. Encompasses: Public oversight, diverse stakeholder control, and benchmarking progress based on societal well-being. Excludes: Purely technical alignment methods or purely market-driven governance.

## 13. skp-intentions-079: predicate `report`
**Label:** Mandate Federal Agency Reporting to Congress on AI Impacts to Vulnerable Communities

**Description (full):**

An Intention within skeptic discourse that mandates federal agencies to report regularly to Congress on the impacts of AI systems on vulnerable communities. 
Encompasses: Legislative oversight and reporting requirements.
Excludes: Internal agency monitoring or voluntary industry reporting.

## 14. skp-desires-076: predicate `report`
**Label:** Public Right to Know What AI Was Trained On

**Description (full):**

A Desire within skeptic discourse that AI developers should be legally required to report copyrighted works in their training datasets.
Encompasses: Public record of data usage, identification of potential infringement, transparency and accountability in generative AI.
Excludes: General copyright law or technical solutions for intellectual property protection.

## 15. skp-beliefs-196: predicate `favor`
**Label:** Regressive Compliance Burdens of Centralized Algorithmic Oversight

**Description (full):**

A Belief within skeptic discourse that centralized compliance mandates act as a regressive tax favoring dominant technology firms over decentralized developers.
Encompasses: administrative overhead of cryptographic logging, compliance costs of data sovereignty rules, market concentration under comprehensive regulatory frameworks.
Excludes: decentralized user-controlled verification protocols, antitrust break-up actions.

