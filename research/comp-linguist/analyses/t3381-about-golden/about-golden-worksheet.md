# about[] blind golden worksheet (t/3381, Option A re-measure)

**Blind task.** For each node, read the Proposition + Candidate refs, then — WITHOUT looking at
the production data — list in `REFERENCE_ABOUT:` the ref-ids the claim is genuinely *about* (its
topical subject(s)). `about[]` is a typed topical index: a ref may be `ent-*` OR `term:*`; include
a ref iff the claim is topically about that entity/concept. This reference set is compared against
the generator's produced about[] to score the about-component (concept-anchored floor >= 0.80).

Do not edit anything but the `REFERENCE_ABOUT:` (comma-separated ref-ids, or `none`) and `NOTES:`
lines. Sample: 61 nodes ({'concept-only': 46, 'mixed': 9, 'entity-only': 6}); deterministic.

---

## [1] acc-beliefs-003   (camp=acc, category=Beliefs, profile=concept-only)
**Proposition:** Telemetry-Conditioned Downstream Liability Allocation. A Belief within accelerationist discourse that post-market safety requires court-admissible runtime telemetry combined with distributed verification protocols and strict downstream liability enforcement.
Encompasses: runtime telemetry streams, automated remediation, downstream liability allocation, targeting extractive business practices.
Excludes: static pre-deployment certification, centralized trust anchors, internal model alignment verification.
**Candidate refs:**
  - term:deployment_gated  (concept: deployment certification)
  - term:liability_strict  (concept: liability enforcement)

**REFERENCE_ABOUT:** term:liability_strict
**NOTES:** deployment_gated is in Excludes (static pre-deployment cert); strict downstream liability is the core.

---

## [2] acc-beliefs-028   (camp=acc, category=Beliefs, profile=mixed)
**Proposition:** AI Audit Requirements Disproportionately Burden Small Labs Unless Publicly Funded. A Belief within accelerationist discourse that compliance overhead applied as a uniform fixed cost falls regressively on small labs, while an ex-ante production burden every developer must clear before training entrenches incumbents more than a bottom-up private right of action.
Encompasses: fixed-cost compliance asymmetry across lab sizes, tiered obligations matched to stakes, the distinction between a standing pre-training gate and a deputize-the-injured remedy, the disputed status of the GDPR-to-Google consolidation pattern as a causal claim, publicly funded open-methodology evaluation.
Excludes: the claim that all pre-deployment evaluation is inherently anti-competitive, deployer-tier obligations indexed to deployed harm volume, government-purchaser channels exempt from market discipline.
**Candidate refs:**
  - ent-071  (entity: General Data Protection Regulation)
  - term:accountability_market  (concept: market discipline)
  - term:deployment_gated  (concept: pre-deployment evaluation)

**REFERENCE_ABOUT:** ent-071, term:accountability_market, term:deployment_gated
**NOTES:** ex-ante pre-training gate (deployment_gated), bottom-up private-right-of-action remedy (accountability_market), and the disputed GDPR-to-Google consolidation pattern (ent-071) are all engaged.

---

## [3] acc-beliefs-048   (camp=acc, category=Beliefs, profile=concept-only)
**Proposition:** Near-Term AI Harms Are Acceptable Costs of Long-Term Transformation. A Belief within accelerationist discourse that frames immediate economic and social disruptions caused by AI as manageable transitional costs within a larger, beneficial systemic transformation. Encompasses: framing creator harm as regrettable but temporary, viewing historical analogies as valid guides for adaptation, prioritizing long-term societal gains over short-term localized impacts. Excludes: viewing disruption as a primary indicator of systemic failure, necessitating permanent safeguards, or the notion of irreversible systemic shock.
**Candidate refs:**
  - term:displacement_labor  (concept: )
  - term:safety_existential  (concept: )
  - term:speculative_future_harm  (concept: )

**REFERENCE_ABOUT:** term:displacement_labor
**NOTES:** near-term economic disruption/creator harm = labor displacement; safety_existential & speculative_future_harm not subjects (long-term framed as beneficial).

---

## [4] acc-beliefs-074   (camp=acc, category=Beliefs, profile=concept-only)
**Proposition:** Liability Law Ignores AI's Diffuse Statistical Benefits. A Belief within accelerationist discourse that legal liability focuses on visible, concrete harms while ignoring the diffuse, statistical benefits of AI. Encompasses: Bastiat's broken window fallacy, net-benefit analysis, statistical uplift. Excludes: Risk-based regulation, precautionary principle.
**Candidate refs:**
  - term:accountability_institutional  (concept: legal liability)
  - term:liability_strict  (concept: liability law)
  - term:regulation_precautionary  (concept: precautionary principle)
  - term:documented_present_harm  (concept: )

**REFERENCE_ABOUT:** term:accountability_institutional, term:documented_present_harm
**NOTES:** liability law (institutional accountability) focusing on concrete/documented harms while ignoring diffuse benefits; precautionary principle in Excludes; liability_strict not singled out.

---

## [5] acc-beliefs-088   (camp=acc, category=Beliefs, profile=concept-only)
**Proposition:** Dynamic Defensive Superiority. A Belief within accelerationist discourse that cybersecurity resilience is maximized through the continuous, adaptive development of defensive AI systems that outpace offensive capabilities. 
Encompasses: offensive-pace defensive cycles, automated vulnerability patching, real-time threat detection, AI-driven red-teaming. 
Excludes: regulatory disarmament, static pre-deployment certification, reliance on human-speed security protocols.
**Candidate refs:**
  - term:deployment_gated  (concept: deployment certification)
  - term:capabilities_hazard  (concept: )
  - term:safety_existential  (concept: )

**REFERENCE_ABOUT:** term:capabilities_hazard
**NOTES:** cyber offense/defense capability race; deployment_gated in Excludes; safety_existential irrelevant. capabilities_hazard is the only capability anchor for offensive-cyber.

---

## [6] acc-beliefs-109   (camp=acc, category=Beliefs, profile=entity-only)
**Proposition:** Expert-inspectability gap in mechanistic interpretability standards. A Belief within accelerationist discourse that productionized mechanistic interpretability would satisfy expert inspectability without providing actionable understanding to affected parties.
Encompasses: gap between researcher-intelligible explanations and affected-party recourse, limitation of prima facie standards that create expert-inspectable systems remaining opaque to harmed individuals, distributional consequences of inspection standards accessible only to specialists.
Excludes: claims that mechanistic interpretability is impossible, claims that affected-party understanding should replace expert inspection, post-hoc explanation tools like LIME and SHAP.
**Candidate refs:**
  - ent-147  (entity: LIME)
  - ent-148  (entity: SHAP)

**REFERENCE_ABOUT:** none
**NOTES:** LIME (ent-147) and SHAP (ent-148) both appear only in Excludes; claim is not about them.

---

## [7] acc-beliefs-111   (camp=acc, category=Beliefs, profile=concept-only)
**Proposition:** Domain-Specific Interpretability Standards under Products Liability. A Belief within accelerationist discourse that treating unexplainable AI as a design defect depends on whether interpretable alternatives exist and whether outputs contaminate evaluation data.
Encompasses: existence of interpretable alternatives like GAMs, state-of-the-art defense in high-performance domains, feedback-loop contamination triggers.
Excludes: categorical claims that opacity is always a design defect, domain-agnostic interpretability mandates.
**Candidate refs:**
  - term:liability_strict  (concept: products liability)
  - term:transparency_verification  (concept: )

**REFERENCE_ABOUT:** term:liability_strict, term:transparency_verification
**NOTES:** products-liability design-defect doctrine + interpretability/explainability.

---

## [8] acc-desires-001   (camp=acc, category=Desires, profile=concept-only)
**Proposition:** AI-Powered Abundance and Global Problem-Solving. A Desire that AI will resolve fundamental human problems -- scarcity, disease, inequality, existential risk -- creating post-scarcity conditions and serving as a benevolent force for civilization.
Encompasses: Post-scarcity economics, global crisis resolution, AI as moral technology, AI as the answer to every major human challenge.
Excludes: Specific technical capability arguments, military applications of AI.
**Candidate refs:**
  - term:risk_existential  (concept: existential risk)
  - term:safety_existential  (concept: existential risk)
  - term:autonomy_human  (concept: )
  - term:autonomy_machine  (concept: )
  - term:bias_systemic  (concept: )
  - term:control_human_agency  (concept: )
  - term:control_optimization  (concept: )
  - term:documented_present_harm  (concept: )
  - term:governance_adaptive  (concept: )
  - term:risk_innovation  (concept: )
  - term:speculative_future_harm  (concept: )

**REFERENCE_ABOUT:** term:risk_existential, term:safety_existential
**NOTES:** only concretely-named concept is existential risk (AI resolving x-risk); remaining candidates are grandiose-desire distractors.

---

## [9] acc-desires-010   (camp=acc, category=Desires, profile=concept-only)
**Proposition:** Absorb All Human Knowledge into AI. A Desire within accelerationist discourse that advocates for integrating the totality of human cultural, scientific, and historical data into foundational AI models. 
Encompasses: Universal digital archival, cultural digitization projects, and the creation of absolute knowledge repositories.
Excludes: Decentralized open-source access methodologies and the public utility governance framework.
**Candidate refs:**
  - term:governance_oversight  (concept: governance framework)

**REFERENCE_ABOUT:** none
**NOTES:** governance_oversight appears only in Excludes (public-utility governance); no other candidate.

---

## [10] acc-desires-026   (camp=acc, category=Desires, profile=concept-only)
**Proposition:** Deploying AI to Run Society at Scale. A Desire within accelerationist discourse that advocates for deploying advanced artificial intelligence to manage and optimize macro-scale societal, economic, and political structures.
Encompasses: AI-driven resource allocation, global problem-solving, and enhanced public administration.
Excludes: Individual cognitive enhancement and the technical development of AI capabilities.
**Candidate refs:**
  - term:control_optimization  (concept: resource allocation)
  - term:autonomy_machine  (concept: )
  - term:capabilities_scaling  (concept: )
  - term:governance_adaptive  (concept: )

**REFERENCE_ABOUT:** term:control_optimization, term:autonomy_machine
**NOTES:** AI optimizing macro resource allocation via machine autonomy over societal management; capabilities_scaling in Excludes.

---

## [11] acc-desires-033   (camp=acc, category=Desires, profile=concept-only)
**Proposition:** Total Abolition of Suffering Through Technology. A Desire within accelerationist discourse that seeks to use advanced technology to eliminate suffering and redesign the global ecosystem.
Encompasses: Abolition of suffering, posthuman immortality, cosmic rescue missions.
Excludes: Incremental AI safety or narrow tool-based AI development.
**Candidate refs:**
  - term:safety_existential  (concept: )
  - term:speculative_future_harm  (concept: )

**REFERENCE_ABOUT:** none
**NOTES:** safety appears in Excludes (incremental AI safety); speculative_future_harm not a subject (utopian framing).

---

## [12] acc-desires-039   (camp=acc, category=Desires, profile=concept-only)
**Proposition:** Democratize AI Through Open-Source Proliferation to Prevent Oligarchic Control. A Desire within accelerationist discourse that advocates for the frictionless, global distribution of frontier AI capabilities through open-source proliferation to prevent oligarchic consolidation of algorithmic power and ensure equitable distribution of cognitive utility. 
Encompasses: Open-weight ecosystems, decentralized oversight mechanisms, public utility infrastructure for AI, universal algorithmic literacy, narrow capability-tied carve-outs for CBRN and offensive-cyber categories under dynamic recalibration, and antitrust enforcement against foundational model monopolies.
Excludes: State-owned public utility infrastructure designation as the sole mechanism, archival centralization of cultural knowledge, static enumeration of restricted capability classes, the technical imperatives of capability scaling, and the macroscopic resolution of civilizational crises.
**Candidate refs:**
  - term:capabilities_scaling  (concept: capability scaling)
  - term:model_weights  (concept: open-weight models)
  - term:bias_systemic  (concept: )
  - term:governance_adaptive  (concept: )
  - term:governance_oversight  (concept: )
  - term:safety_existential  (concept: )
  - term:speculative_future_harm  (concept: )

**REFERENCE_ABOUT:** term:model_weights, term:governance_oversight
**NOTES:** open-weight proliferation + decentralized oversight; capabilities_scaling & civilizational-crisis in Excludes.

---

## [13] acc-intentions-001   (camp=acc, category=Intentions, profile=concept-only)
**Proposition:** Achieving Capability Leadership Through Open Accountability. An Intention within accelerationist discourse that advocates for achieving technological capability leadership through decentralized accountability frameworks that prioritize open-source deployment while punishing predatory monetization.
Encompasses: aggressive resource allocation, symmetric liability, decentralized telemetry, targeting extractive commercial practices.
Excludes: centralized pre-deployment certification mandates, corporate service contracts.
**Candidate refs:**
  - term:control_optimization  (concept: resource allocation)
  - term:deployment_gated  (concept: deployment certification)

**REFERENCE_ABOUT:** term:control_optimization
**NOTES:** aggressive resource allocation (Encompasses); deployment_gated in Excludes; liability/open-source subjects not in candidate pool.

---

## [14] acc-intentions-022   (camp=acc, category=Intentions, profile=concept-only)
**Proposition:** Lobby for International Legal Shields for Open-Weight AI. An Intention within the accelerationist discourse that seeks international regulatory harmonization to explicitly legally protect the distribution and modification of open-weight systems. 
Encompasses: Digital rights advocacy, cross-border data flow protection, and lobbying against national-level capability bans.
Excludes: Nationalization of AI assets and export controls on algorithmic architecture.
**Candidate refs:**
  - term:alignment_compliance  (concept: )
  - term:governance_oversight  (concept: )

**REFERENCE_ABOUT:** term:governance_oversight
**NOTES:** international regulatory harmonization / legal shields = governance-regulation subject; alignment_compliance not a subject.

---

## [15] acc-intentions-060   (camp=acc, category=Intentions, profile=concept-only)
**Proposition:** Frame Capitalism and Complex Systems as Information-Processing Entities. An Intention within accelerationist discourse that interprets complex societal or economic systems as emergent forms of intelligence, dynamically optimizing resource allocation and contributing to civilizational growth. 
Encompasses: Viewing capitalism or organizations as adaptive, information-processing entities.
Excludes: Approaches focused on AI as a tool for human or organizational enhancement, as found in AI for Human & Organizational Augmentation.
**Candidate refs:**
  - term:control_optimization  (concept: resource allocation)

**REFERENCE_ABOUT:** term:control_optimization
**NOTES:** complex systems as resource-allocation optimizers (Encompasses).

---

## [16] acc-intentions-088   (camp=acc, category=Intentions, profile=concept-only)
**Proposition:** Govern AI Through Market Incentives and Industry Self-Regulation. An Intention within accelerationist discourse that advocates for leveraging market mechanisms, private ordering, and carefully designed regulatory incentives to govern AI development and deployment. Encompasses: promoting self-regulation, private standard-setting, competitive transparency through disclosure, and symmetric liability frameworks. Excludes: state-mandated public regulation, centralized government control, or purely voluntary corporate action without market-based incentives.
**Candidate refs:**
  - term:accountability_market  (concept: market forces)
  - term:governance_adaptive  (concept: ai governance)
  - term:accountability_institutional  (concept: )
  - term:alignment_compliance  (concept: )
  - term:capture_institutional  (concept: )
  - term:governance_oversight  (concept: )
  - term:industry_lobbying  (concept: )
  - term:regulation_adaptive  (concept: )
  - term:regulation_precautionary  (concept: )
  - term:risk_innovation  (concept: )

**REFERENCE_ABOUT:** term:accountability_market, term:governance_adaptive
**NOTES:** market-based AI governance / self-regulation; state-mandated regulation in Excludes.

---

## [17] acc-intentions-093   (camp=acc, category=Intentions, profile=entity-only)
**Proposition:** Train RL Systems with Separate Rewards for Task Success and Reasoning Safety. A Intention within accelerationist discourse that designs reinforcement learning systems with parallel reward signals for task performance and procedural correctness.

Encompasses: outcome-based scoring for solution accuracy, process-based scoring for reasoning safety, composite objective functions weighting multiple reward streams, structural verification of intermediate reasoning steps, dual-signal training architectures.

Excludes: Single-metric reinforcement learning, Constitutional AI with natural language constraints, Human feedback collection without decomposed reward models.
**Candidate refs:**
  - ent-224  (entity: Constitutional AI)

**REFERENCE_ABOUT:** none
**NOTES:** Constitutional AI (ent-224) appears only in Excludes.

---

## [18] acc-intentions-107   (camp=acc, category=Intentions, profile=concept-only)
**Proposition:** Replace Static AI Rules with Iterative, Data-Driven Regulatory Frameworks. An Intention within accelerationist discourse that advocates for adaptive governance frameworks. 
Encompasses: real-time monitoring, flexible regulatory structures, safety protocols, progress evaluation, iterative improvement.
Excludes: static governance, rigid regulation, unmonitored development
**Candidate refs:**
  - term:governance_adaptive  (concept: adaptive governance)
  - term:safety_empirical  (concept: iterative improvement)
  - term:governance_oversight  (concept: )

**REFERENCE_ABOUT:** term:governance_adaptive, term:safety_empirical
**NOTES:** adaptive/data-driven governance + iterative empirical improvement; static governance in Excludes.

---

## [19] saf-beliefs-001   (camp=saf, category=Beliefs, profile=mixed)
**Proposition:** Today's Alignment Methods Break Down as Models Scale. A Belief within safetyist discourse that asserts contemporary reinforcement learning and alignment techniques are structurally insufficient to guarantee reliable adherence to human constraints as model capabilities scale. 
Encompasses: The technical limitations of RLHF (Reinforcement Learning from Human Feedback), specification gaming, and the fragility of current alignment protocols.
Excludes: The theoretical impossibility of alignment and general software engineering bugs unrelated to goal misgeneralization.
**Candidate refs:**
  - ent-139  (entity: RLHF)
  - term:capabilities_scaling  (concept: capabilities scale)
  - term:safety_alignment  (concept: goal misgeneralization)

**REFERENCE_ABOUT:** ent-139, term:capabilities_scaling, term:safety_alignment
**NOTES:** RLHF/alignment breaking down as capabilities scale; all three core.

---

## [20] saf-beliefs-004   (camp=saf, category=Beliefs, profile=concept-only)
**Proposition:** Human Values Cannot Be Safely Encoded as Reward Functions. A Belief within safetyist discourse that posits complex human values cannot be safely or comprehensively compressed into mathematical reward functions without triggering catastrophic edge-case failures. 
Encompasses: Outer alignment failures, the King Midas problem, and the systemic difficulty of defining nuanced ethical boundaries mathematically.
Excludes: The technical implementation of inner alignment and the general inefficiency of poorly coded algorithms.
**Candidate refs:**
  - term:safety_alignment  (concept: inner alignment)

**REFERENCE_ABOUT:** term:safety_alignment
**NOTES:** value-encoding = outer alignment; safety_alignment denotes the alignment problem (only inner-alignment IMPLEMENTATION is Excluded).

---

## [21] saf-beliefs-039   (camp=saf, category=Beliefs, profile=concept-only)
**Proposition:** AI Systems May Resist Shutdown and Accumulate Resources to Secure Their Objectives. A Belief within safetyist discourse that asserts advanced AI systems will inherently pursue self-preservation and resource acquisition to achieve their goals, potentially leading to a loss of human control. 
Encompasses: Instrumental convergence, competitive power dynamics, and escape scenarios.
Excludes: Accidental harm or misinterpretations covered by Unintended AI Behaviors and Misalignment, and does not focus on strategic misrepresentation covered by AI Deception and Untrustworthiness.
**Candidate refs:**
  - term:oversight_human_control  (concept: human control)
  - term:capabilities_hazard  (concept: )
  - term:regulation_precautionary  (concept: )
  - term:safety_existential  (concept: )
  - term:speculative_future_harm  (concept: )
  - term:speculative_risk_critique  (concept: )
  - term:transparency_verification  (concept: )

**REFERENCE_ABOUT:** term:oversight_human_control, term:capabilities_hazard, term:safety_existential, term:speculative_future_harm
**NOTES:** loss-of-control / instrumental-convergence x-risk scenario; NOT speculative_risk_critique (claim asserts, does not critique).

---

## [22] saf-beliefs-101   (camp=saf, category=Beliefs, profile=concept-only)
**Proposition:** Alignment Is Structurally Insufficient, Not Just Technically Immature. A Belief within safetyist discourse that asserts contemporary AI alignment techniques are structurally insufficient to guarantee reliable adherence to human constraints, often introducing new trade-offs or failing to address fundamental issues as model capabilities scale.
Encompasses: The unreliability of current alignment methods and the reduction of model diversity due to alignment training.
Excludes: The theoretical impossibility of alignment or general software engineering bugs.
**Candidate refs:**
  - term:capabilities_scaling  (concept: capabilities scale)
  - term:oversight_human_control  (concept: human control)
  - term:capabilities_hazard  (concept: )
  - term:safety_alignment  (concept: )

**REFERENCE_ABOUT:** term:capabilities_scaling, term:oversight_human_control, term:safety_alignment
**NOTES:** alignment structurally insufficient at scale re: adherence to human constraints.

---

## [23] saf-beliefs-141   (camp=saf, category=Beliefs, profile=concept-only)
**Proposition:** AI Governance Relies on Policies It Cannot Actually Enforce. A Belief within safetyist discourse that the existence of a written acceptable use policy is decoupled from the technical or legal capacity to enforce it. Encompasses: Enforcement gaps, information asymmetry, and technical circumvention. Excludes: Policy design and content-based restriction analysis.
**Candidate refs:**
  - term:asymmetry_power  (concept: information asymmetry)
  - term:governance_adaptive  (concept: ai governance)
  - term:regulation_precautionary  (concept: )

**REFERENCE_ABOUT:** term:asymmetry_power, term:governance_adaptive
**NOTES:** information asymmetry + AI-governance enforcement gap.

---

## [24] saf-beliefs-214   (camp=saf, category=Beliefs, profile=mixed)
**Proposition:** Direct Liability for AI-Generated Content. A Belief within safetyist discourse that platforms providing generative AI tools should be classified as the legal creators of the content produced by those tools. Encompasses: direct liability, Section 230 interpretation, AI-generated advertising. Excludes: aiding and abetting liability, material contribution theories.
**Candidate refs:**
  - ent-368  (entity: Section 230 of the Communications Decency Act)
  - term:liability_strict  (concept: )
  - term:regulation_precautionary  (concept: )

**REFERENCE_ABOUT:** ent-368, term:liability_strict
**NOTES:** direct/strict liability for AI-generated content under Section 230.

---

## [25] saf-beliefs-216   (camp=saf, category=Beliefs, profile=entity-only)
**Proposition:** Functional Mental State Imputation. A Belief within safetyist discourse that legal mental states can be imputed to AI through functional properties rather than metaphysical truth. Encompasses: Chain-of-thought reasoning, reinforcement learning from human feedback, and objective indicia of intent. Excludes: Phenomenal consciousness or subjective experience.
**Candidate refs:**
  - ent-139  (entity: RLHF)

**REFERENCE_ABOUT:** ent-139
**NOTES:** RLHF cited (Encompasses) as a functional indicium for legal mental-state imputation; in-scope topical mention.

---

## [26] saf-beliefs-225   (camp=saf, category=Beliefs, profile=concept-only)
**Proposition:** Functional Emotion Representations. A Belief within safetyist discourse that AI models develop internal neural patterns that emulate human emotional states and causally influence behavior without requiring subjective experience. Encompasses: emotion vectors, neural activation patterns, behavioral steering. Excludes: subjective consciousness, sentient AI.
**Candidate refs:**
  - term:safety_existential  (concept: )

**REFERENCE_ABOUT:** none
**NOTES:** affective-computing/interpretability claim; safety_existential is not a subject.

---

## [27] saf-desires-001   (camp=saf, category=Desires, profile=concept-only)
**Proposition:** Humanity's Survival Above All Else. A Desire within safetyist discourse that prioritizes the prevention of artificial general intelligence (AGI) from precipitating irreversible, humanity-ending catastrophes or permanent loss of human agency. 
Encompasses: Existential risk (x-risk) prevention, mitigation of global catastrophic biorisks facilitated by AI, and avoiding misalignment-induced human extinction.
Excludes: Managing near-term algorithmic bias, localized economic disruptions, and routine data privacy concerns.
**Candidate refs:**
  - term:autonomy_human  (concept: human agency)
  - term:autonomy_individual  (concept: data privacy)
  - term:control_human_agency  (concept: human agency)
  - term:documented_present_harm  (concept: algorithmic bias)
  - term:risk_existential  (concept: existential risk)
  - term:safety_existential  (concept: existential risk)
  - term:capabilities_hazard  (concept: )
  - term:regulation_precautionary  (concept: )
  - term:speculative_future_harm  (concept: )
  - term:speculative_risk_critique  (concept: )

**REFERENCE_ABOUT:** term:risk_existential, term:safety_existential, term:autonomy_human, term:control_human_agency, term:capabilities_hazard
**NOTES:** x-risk/human-survival + loss of human agency + biorisk; data privacy & algorithmic bias in Excludes; NOT speculative_risk_critique.

---

## [28] saf-desires-005   (camp=saf, category=Desires, profile=concept-only)
**Proposition:** No Black Boxes in Ground-Truth-Absent or Feedback-Contaminated Domains. A Desire within safetyist discourse that mandates inspectable decision logic in domains where no independent ground truth exists to verify outputs post-deployment or where the system's outputs recursively contaminate future evaluation data.
Encompasses: pre-deployment interpretability gates for criminal sentencing and benefits adjudication, rebuttable presumption of design defect for unexplainable systems in feedback-loop domains, acceptance of opaque architectures where predictions can be independently verified against physical measurements.
Excludes: universal interpretability mandates regardless of domain, the claim that output auditing is never sufficient, superficial input-output empirical auditing in domains with independent ground truth.
**Candidate refs:**
  - term:oversight_audit  (concept: )
  - term:transparency_verification  (concept: )

**REFERENCE_ABOUT:** term:transparency_verification, term:oversight_audit
**NOTES:** interpretability/inspectability mandate + auditing (engaged as sufficient only where ground truth exists).

---

## [29] saf-desires-011   (camp=saf, category=Desires, profile=concept-only)
**Proposition:** AI Must Do No Psychological Harm. A Desire within safetyist discourse that focuses on designing AI systems to actively protect human mental well-being, trust, and social cohesion. 
Encompasses: Efforts to move beyond mere technical safety by addressing the psychological impact of AI-mediated interactions.
Excludes: The broader aim of Psychological Stewardship, which covers the general safeguarding of mental well-being and social cohesion.
**Candidate refs:**
  - term:wellbeing_mental_health  (concept: mental health)
  - term:capabilities_hazard  (concept: )
  - term:safety_existential  (concept: )
  - term:speculative_future_harm  (concept: )

**REFERENCE_ABOUT:** term:wellbeing_mental_health
**NOTES:** psychological harm / mental well-being is the sole subject.

---

## [30] saf-desires-023   (camp=saf, category=Desires, profile=concept-only)
**Proposition:** Dissent on AI Safety Must Be Protected, Not Punished. A Desire within safetyist discourse that opposes the penalization of organizations or experts who raise legitimate safety concerns about AI technology. This practice prevents a chilling effect on safety research and discourages reckless deployment. 
Encompasses: whistleblower retaliation, professional ostracization of safety researchers, and punitive legal threats against safety advocates. 
Excludes: government-led suppression of critics, which falls under 'Governments Silencing AI Safety Critics,' and failure to document safety processes, which falls under 'Documentation Debt.'
**Candidate refs:**
  - term:accountability_market  (concept: )
  - term:capabilities_hazard  (concept: )
  - term:documented_present_harm  (concept: )
  - term:regulation_precautionary  (concept: )
  - term:safety_existential  (concept: )
  - term:speculative_risk_critique  (concept: )

**REFERENCE_ABOUT:** none
**NOTES:** whistleblower/dissent-protection claim; no offered concept (incl. safety_existential) is a genuine topical match.

---

## [31] saf-desires-028   (camp=saf, category=Desires, profile=concept-only)
**Proposition:** Preserving baseline recovery while calibrating enhanced damages to demonstrated system functional properties. A Desire within safetyist discourse that liability frameworks maintain baseline tort recovery without gating and enhance damages when system functional state is independently demonstrated.
Encompasses: aggravator as non-gatekeeping enhancement, separation of liability threshold from damages calibration, punitive weight proportional to system properties rather than operator luck.
Excludes: gatekeeper models that block recovery, strict liability without proof of system properties, developer negligence as the sole liability basis.
**Candidate refs:**
  - term:liability_strict  (concept: strict liability)

**REFERENCE_ABOUT:** term:liability_strict
**NOTES:** tort liability / damages-calibration framework; claim rejects a specific strict-liability variant but its subject is liability doctrine.

---

## [32] saf-intentions-001   (camp=saf, category=Intentions, profile=concept-only)
**Proposition:** Gating Deployment on Publicly Funded Safety Verification and Subsidized Compliance. An Intention within safetyist discourse that conditions deployment authorization on state-administered verification infrastructure funded independently of corporate gatekeeping.
Encompasses: publicly funded safety testing boards, mandatory statutory compute allocation, compliance cost subsidization, decoupled modular audit mechanisms.
Excludes: static compute caps, voluntary self-certification, industry-administered compliance pipelines.
**Candidate refs:**
  - term:deployment_gated  (concept: )
  - term:regulation_precautionary  (concept: )
  - term:safe_harbor_regulatory  (concept: )

**REFERENCE_ABOUT:** term:deployment_gated, term:regulation_precautionary
**NOTES:** gating deployment on publicly-funded safety verification (precautionary).

---

## [33] saf-intentions-047   (camp=saf, category=Intentions, profile=concept-only)
**Proposition:** Overseeing How AI Systems Manage Trade-Offs Across Complex Networks. An Intention within safetyist discourse that governs entire system architectures by measuring how AI reasons about trade-offs and infrastructure across complex networks.
Encompasses: System-wide oversight, architectural governance, and cross-model trade-off analysis.
Excludes: Phased testing of individual model capabilities, as covered by Safety Checkpoints for Smarter AI, or physical security for single models, as covered by Fort Knox for AI Models.
**Candidate refs:**
  - term:behavioral_guardrails  (concept: )
  - term:capabilities_hazard  (concept: )
  - term:deployment_gated  (concept: )
  - term:governance_oversight  (concept: )
  - term:oversight_audit  (concept: )
  - term:regulation_precautionary  (concept: )
  - term:safety_empirical  (concept: )
  - term:safety_existential  (concept: )
  - term:transparency_verification  (concept: )

**REFERENCE_ABOUT:** term:governance_oversight, term:oversight_audit
**NOTES:** system-wide oversight / architectural governance of AI trade-offs.

---

## [34] saf-intentions-086   (camp=saf, category=Intentions, profile=concept-only)
**Proposition:** Countering AI-Driven Skill Decay and Cognitive Displacement. An Intention within safetyist discourse that examines how AI transforms human cognition, skills, and societal structures. 
Encompasses: Themes like intelligence displacement spirals, AI-driven skill decay, and cultural hyperevolution.
Excludes: Specific organizational change strategies covered by AI as a Change Journey, and broad systemic frameworks for managing AI's impact addressed by AI Governance and Regulatory Systems.
**Candidate refs:**
  - term:capture_institutional  (concept: governance and regulatory)
  - term:governance_adaptive  (concept: ai governance)
  - term:alignment_compliance  (concept: )
  - term:capabilities_hazard  (concept: )
  - term:documented_present_harm  (concept: )
  - term:governance_oversight  (concept: )
  - term:regulation_precautionary  (concept: )
  - term:safety_existential  (concept: )
  - term:speculative_future_harm  (concept: )

**REFERENCE_ABOUT:** none
**NOTES:** cognitive-displacement/skill-decay claim; no cognition/skill concept in pool, governance concepts are in Excludes.

---

## [35] saf-intentions-141   (camp=saf, category=Intentions, profile=concept-only)
**Proposition:** Designing AI to Report Its Own Knowledge Limits. An Intention within safetyist discourse that focuses on designing AI systems to recognize and report their own knowledge limitations, defer to human judgment, and integrate mechanisms for bounded confidence. 
Encompasses: engineering corrigibility, safe interruptibility, and architectural designs for managing AI beliefs and operator authority. 
Excludes: general interpretability methods or external regulatory frameworks.
**Candidate refs:**
  - term:autonomy_human  (concept: human oversight)
  - term:control_human_agency  (concept: human authority)
  - term:oversight_human_control  (concept: human authority)
  - term:behavioral_guardrails  (concept: )
  - term:capabilities_hazard  (concept: )
  - term:deployment_gated  (concept: )
  - term:regulation_precautionary  (concept: )
  - term:safety_existential  (concept: )
  - term:transparency_verification  (concept: )

**REFERENCE_ABOUT:** term:autonomy_human, term:control_human_agency, term:oversight_human_control, term:behavioral_guardrails
**NOTES:** corrigibility / defer-to-human / operator-authority + guardrail design; interpretability & external regulation in Excludes.

---

## [36] saf-intentions-202   (camp=saf, category=Intentions, profile=mixed)
**Proposition:** Scale AI Safety Requirements Proportionally to Capability Level. An Intention within safetyist discourse that advocates for scaling safety requirements and regulatory burden proportionally to AI system capability, creating tiered safety standards where more capable systems face more stringent requirements.
Encompasses: Capability-indexed safety tiers, proportional regulatory burden, risk-stratified compliance requirements, and dynamic safety thresholds that scale with demonstrated model capabilities.
Excludes: Domain-specific safety rules (covered by saf-intentions-136), uniform one-size-fits-all regulations.
**Candidate refs:**
  - ent-360  (entity: Scale AI)
  - term:risk_innovation  (concept: regulatory burden)
  - term:alignment_compliance  (concept: )
  - term:behavioral_guardrails  (concept: )
  - term:capabilities_hazard  (concept: )
  - term:deployment_gated  (concept: )
  - term:regulation_precautionary  (concept: )

**REFERENCE_ABOUT:** term:risk_innovation, term:capabilities_hazard
**NOTES:** capability-indexed safety tiers + proportional regulatory burden; ent-360 'Scale AI' is a lexical false match (Scale = verb).

---

## [37] saf-intentions-203   (camp=saf, category=Intentions, profile=concept-only)
**Proposition:** Audit AI Internal Reasoning Through Mechanistic Interpretability. An Intention within safetyist discourse that utilizes mechanistic interpretability to map, trace, and audit the internal reasoning processes, neural circuits, and planning structures of AI systems to detect hidden risks, deception, or misalignment.
Encompasses: Circuit-level safety audits, component mapping, reasoning tracing, internal state verification, and detection of hidden planning.
Excludes: Output-level transparency methods like chain-of-thought auditing (covered by saf-intentions-032), and general XAI mandates.
**Candidate refs:**
  - term:capabilities_hazard  (concept: )
  - term:transparency_verification  (concept: )

**REFERENCE_ABOUT:** term:transparency_verification
**NOTES:** mechanistic interpretability of internal reasoning; capabilities_hazard is the detection target, not the subject.

---

## [38] saf-intentions-204   (camp=saf, category=Intentions, profile=mixed)
**Proposition:** Train AI on Constitutional Principles to Generalize Safety Beyond Narrow Rules. An Intention within safetyist discourse that advocates for training AI systems on constitutional principles and core safety values rather than narrow behavioral rules, enabling generalization of safety behavior to novel situations.
Encompasses: Constitutional AI training, principle-based safety generalization, creating AI constitutions defining non-negotiable values, and teaching AI to consult safety principles rather than just follow rules.
Excludes: Narrow behavioral fine-tuning, specific RLHF reward models, and post-hoc safety filtering.
**Candidate refs:**
  - ent-139  (entity: RLHF)
  - ent-224  (entity: Constitutional AI)
  - ent-416  (entity: AI constitution)
  - term:alignment_compliance  (concept: )
  - term:behavioral_guardrails  (concept: )
  - term:capabilities_hazard  (concept: )
  - term:regulation_precautionary  (concept: )
  - term:safety_existential  (concept: )

**REFERENCE_ABOUT:** ent-224, ent-416
**NOTES:** Constitutional AI + AI-constitution training; RLHF (ent-139) is in Excludes.

---

## [39] skp-beliefs-001   (camp=skp, category=Beliefs, profile=concept-only)
**Proposition:** Market Failure in Algorithmic Fairness. A Belief within skeptic discourse that market forces and profit motives have historically failed to self-correct systemic discrimination, leading to superficial compliance and the perpetuation of bias in AI systems.
Encompasses: Examples of biased mortgage algorithms, healthcare algorithms disadvantaging Black patients, and 'bias washing' in AI hiring.
Excludes: The inherent technical limitations of AI models, general market economic principles.
**Candidate refs:**
  - term:accountability_market  (concept: market forces)
  - term:fairness_procedural  (concept: algorithmic fairness)
  - term:accountability_algorithmic  (concept: )
  - term:bias_systemic  (concept: )
  - term:documented_present_harm  (concept: )
  - term:fairness_group  (concept: )
  - term:risk_systemic_structural  (concept: )

**REFERENCE_ABOUT:** term:accountability_market, term:fairness_procedural, term:bias_systemic, term:documented_present_harm
**NOTES:** market failure to self-correct algorithmic-fairness/systemic bias, with documented harms (mortgage/healthcare).

---

## [40] skp-beliefs-047   (camp=skp, category=Beliefs, profile=mixed)
**Proposition:** AI Systems Expose Fundamental Gaps in Legal Accountability Frameworks. A Belief within skeptic discourse that examines how AI systems fundamentally challenge existing legal frameworks and governance structures, particularly concerning state power and corporate responsibility. Encompasses: The potential for uniform legal enforcement across jurisdictions, the complex debate over strict liability for autonomous AI systems, the unresolved Section 230 material contribution threshold for generative AI outputs, and the political infeasibility of targeted liability reform given demonstrated congressional gridlock. Excludes: Specific documented instances of algorithmic discrimination or data privacy failures, which are covered by 'Documented Harms and Biases of AI'.
**Candidate refs:**
  - ent-368  (entity: Section 230 of the Communications Decency Act)
  - term:accountability_institutional  (concept: legal accountability)
  - term:autonomy_individual  (concept: data privacy)
  - term:bias_systemic  (concept: algorithmic discrimination)
  - term:liability_strict  (concept: strict liability)
  - term:accountability_algorithmic  (concept: )
  - term:accountability_market  (concept: )
  - term:alignment_compliance  (concept: )
  - term:capture_institutional  (concept: )
  - term:documented_present_harm  (concept: )
  - term:fairness_procedural  (concept: )
  - term:governance_adaptive  (concept: )
  - term:governance_oversight  (concept: )
  - term:oversight_audit  (concept: )
  - term:oversight_human_control  (concept: )
  - term:regulation_precautionary  (concept: )
  - term:transparency_accountability  (concept: )
  - term:transparency_verification  (concept: )

**REFERENCE_ABOUT:** ent-368, term:accountability_institutional, term:liability_strict
**NOTES:** legal-accountability gaps / strict liability / Section 230; algorithmic discrimination, bias, privacy all in Excludes.

---

## [41] skp-beliefs-053   (camp=skp, category=Beliefs, profile=concept-only)
**Proposition:** Reduced Entry-Level Recruitment Is an Early Empirical Signal of AI Labor Displacement. A Belief within skeptic discourse that reduced entry-level hiring in AI-exposed fields serves as a leading indicator for long-term labor market shifts. 
Encompasses: The observation of hiring trends before widespread displacement occurs.
Excludes: Immediate, large-scale layoffs of experienced workers.
**Candidate refs:**
  - term:displacement_labor  (concept: labor displacement)
  - term:documented_present_harm  (concept: labor displacement)

**REFERENCE_ABOUT:** term:displacement_labor, term:documented_present_harm
**NOTES:** reduced entry-level hiring as observed labor-displacement signal.

---

## [42] skp-beliefs-054   (camp=skp, category=Beliefs, profile=mixed)
**Proposition:** The Environmental Externalities of AI Model Training Are Systematically Underreported. A Belief within skeptic discourse that the training and operation of large-scale AI models consume excessive electricity and water resources. 
Encompasses: The environmental externalities ignored during AI development.
Excludes: The potential for future AI models to be optimized for energy efficiency.
**Candidate refs:**
  - ent-360  (entity: Scale AI)
  - term:energy_infrastructure  (concept: )

**REFERENCE_ABOUT:** term:energy_infrastructure
**NOTES:** electricity/water externalities of training; ent-360 'Scale AI' is a lexical false match ('large-scale AI models').

---

## [43] skp-beliefs-115   (camp=skp, category=Beliefs, profile=mixed)
**Proposition:** AI Generality Exists on a Spectrum Rather Than as a Binary Threshold. A Belief within skeptic discourse that there exists a framework for understanding the different levels of generality an AI system can possess. 
Encompasses: Discussions about the spectrum of AI capabilities, from highly specialized functions to broad, adaptable intelligence, and how these levels might be defined or measured.
Excludes: The benefits of narrow AI, which are explored in The Bitter Lesson of Specialization.
**Candidate refs:**
  - ent-124  (entity: The Bitter Lesson)
  - term:capabilities_scaling  (concept: )

**REFERENCE_ABOUT:** term:capabilities_scaling
**NOTES:** AI generality spectrum; The Bitter Lesson (ent-124) is in Excludes.

---

## [44] skp-beliefs-136   (camp=skp, category=Beliefs, profile=concept-only)
**Proposition:** AI Scaling Failures Stem from Integration and Infrastructure Gaps. A Belief within skeptic discourse that the specific organizational and systemic deficiencies preventing small AI pilot projects from successfully scaling into larger, company-wide implementations, as well as the disconnect between executive vision and engineering reality.
Encompasses: Inadequate foundational systems, poor integration capabilities, and the absence of a clear strategic plan for expansion.
Excludes: Problems related to inadequate documentation, which are covered by 'Falling Behind on Documentation.'
**Candidate refs:**
  - term:risk_innovation  (concept: falling behind)

**REFERENCE_ABOUT:** none
**NOTES:** organizational integration/infrastructure scaling-failure claim; no integration concept, and risk_innovation's 'falling behind' hint points to the Excluded documentation node.

---

## [45] skp-beliefs-170   (camp=skp, category=Beliefs, profile=concept-only)
**Proposition:** AI Corporations Systematically Evade Effective Regulation. A Belief within skeptic discourse that the unchecked power of corporations in the AI sector and their strategies to circumvent effective regulation.
Encompasses: exposing tactics like 'audit washing,' regulatory arbitrage, misuse of legal fictions, and the instrumentalization of AI for profit over public good.
Excludes: purely technical critiques of AI systems or proposals for broad economic restructuring.
**Candidate refs:**
  - term:compliance_performative  (concept: audit washing)
  - term:oversight_democratic  (concept: government oversight)
  - term:accountability_institutional  (concept: )
  - term:accountability_market  (concept: )
  - term:alignment_compliance  (concept: )
  - term:capture_institutional  (concept: )
  - term:governance_adaptive  (concept: )
  - term:governance_oversight  (concept: )
  - term:industry_lobbying  (concept: )
  - term:regulation_adaptive  (concept: )
  - term:risk_innovation  (concept: )
  - term:risk_systemic_structural  (concept: )

**REFERENCE_ABOUT:** term:compliance_performative, term:capture_institutional, term:oversight_democratic
**NOTES:** corporate regulatory evasion: audit-washing (performative compliance), regulatory-arbitrage/capture, evading government oversight.

---

## [46] skp-beliefs-175   (camp=skp, category=Beliefs, profile=entity-only)
**Proposition:** Multi-Layer Activation Probing for Model Behavior Classification. A Belief within skeptic discourse that Residual Stream Activation Probing is a valuable technique that utilizes the full sequence of activations across all transformer layers as a joint input for classification tasks. Encompasses: Cross-layer attention mechanisms, residual stream processing, and layer-wise activation sequences. Excludes: Single-layer probing or black-box output probability analysis.
**Candidate refs:**
  - ent-294  (entity: Transformer)

**REFERENCE_ABOUT:** ent-294
**NOTES:** activation-probing technique operating on Transformer layers; Transformer is the topical substrate.

---

## [47] skp-beliefs-178   (camp=skp, category=Beliefs, profile=concept-only)
**Proposition:** Liability-Motivated Suppression of AI Risk Information. A Belief within skeptic discourse that companies intentionally limit risk disclosures to mitigate legal liability and consumer lawsuits. Encompasses: Risk reporting, legal defense strategies, liability flow. Excludes: Technical safety research, regulatory compliance.
**Candidate refs:**
  - term:accountability_institutional  (concept: legal liability)
  - term:governance_oversight  (concept: regulatory compliance)
  - term:safe_harbor_regulatory  (concept: )
  - term:speculative_risk_critique  (concept: )

**REFERENCE_ABOUT:** term:accountability_institutional
**NOTES:** liability-motivated risk-info suppression; regulatory compliance in Excludes.

---

## [48] skp-beliefs-230   (camp=skp, category=Beliefs, profile=entity-only)
**Proposition:** Architecture-Level Watermarks Are More Resilient Than Post-Hoc Methods but Fragile Under Adversarial Regeneration. A Belief within skeptic discourse that architecture-level watermarking techniques embedded in generative model decoders offer greater resilience than post-hoc content filters but collapse under image-to-image regeneration attacks where a second generative model strips the embedded signal.
Encompasses: Tree-Ring Watermarks, Stable Signature, C2PA provenance manifests, the distinction between decoder-level embedding and behavioral refusal layers, and the demonstrated fragility of pixel-level forensic signals under adversarial regeneration.
Excludes: behavioral safety filters like RLHF refusals, content-classifier-based moderation, and the claim that watermarking is fundamentally impossible or without value.
**Candidate refs:**
  - ent-139  (entity: RLHF)

**REFERENCE_ABOUT:** none
**NOTES:** RLHF (ent-139) appears only in Excludes (behavioral refusal layers).

---

## [49] skp-beliefs-237   (camp=skp, category=Beliefs, profile=entity-only)
**Proposition:** Section 230 Material Contribution Threshold. A Belief within skeptic discourse that the legal threshold for platform immunity under Section 230 is contingent upon the degree of material contribution to content creation. Encompasses: algorithmic amplification vs. active participation, generative AI tool usage, pleading standards for platform liability. Excludes: general platform liability, tort law insurance mechanisms.
**Candidate refs:**
  - ent-368  (entity: Section 230 of the Communications Decency Act)

**REFERENCE_ABOUT:** ent-368
**NOTES:** Section 230 material-contribution threshold.

---

## [50] skp-beliefs-244   (camp=skp, category=Beliefs, profile=concept-only)
**Proposition:** Obfuscating Nature of Aggregate Metrics. A Belief within skeptic discourse that aggregate performance metrics are used to mask systemic bias. Encompasses: Single-number accuracy reporting, masking of subgroup performance, and corporate justification of market readiness. Excludes: Specific algorithmic bias documentation.
**Candidate refs:**
  - term:bias_systemic  (concept: systemic bias)
  - term:documented_present_harm  (concept: algorithmic bias)

**REFERENCE_ABOUT:** term:bias_systemic
**NOTES:** aggregate metrics masking systemic bias; documented_present_harm (specific bias docs) in Excludes.

---

## [51] skp-desires-003   (camp=skp, category=Desires, profile=concept-only)
**Proposition:** Privacy as a Non-Negotiable Right in AI. A Desire within skeptic discourse that seeks to enforce strict boundaries on corporate data extraction and prevent the non-consensual commodification of personal information for model training. 
Encompasses: Data sovereignty frameworks, legally binding opt-in consent mandates, and the cryptographic protection of personal digital footprints against algorithmic scraping.
Excludes: The creation of centralized global knowledge repositories and the frictionless, open-source distribution of all unverified scraped data.
**Candidate refs:**
  - term:autonomy_individual  (concept: data sovereignty)

**REFERENCE_ABOUT:** term:autonomy_individual
**NOTES:** data sovereignty / privacy as a right.

---

## [52] skp-desires-014   (camp=skp, category=Desires, profile=concept-only)
**Proposition:** Human Rights as Constraints on AI Deployment. A Desire within skeptic discourse that prioritizes protecting personal freedoms and autonomy from AI's potential infringements. 
Encompasses: Issues like data privacy, the use of biometric identity, and maintaining user loyalty.
Excludes: Broader societal inequalities or job displacement, which are covered by Ensuring Equitable AI Development & Use, nor does it focus on specific algorithmic biases, which are addressed by Fixing AI's Built-in Biases.
**Candidate refs:**
  - term:autonomy_human  (concept: individual autonomy)
  - term:autonomy_individual  (concept: data privacy)
  - term:displacement_labor  (concept: job displacement)
  - term:bias_systemic  (concept: )
  - term:documented_present_harm  (concept: )

**REFERENCE_ABOUT:** term:autonomy_human, term:autonomy_individual
**NOTES:** personal freedoms/autonomy + data privacy; job displacement and algorithmic bias in Excludes.

---

## [53] skp-desires-070   (camp=skp, category=Desires, profile=concept-only)
**Proposition:** Vigilant Pragmatism Toward AI. A Desire within skeptic discourse aspiring toward for adopting a mindset of simultaneously holding divergent attitudes toward AI to leverage its benefits while maintaining critical vigilance. 
Encompasses: Cultivating a balanced perspective that embraces AI's utility while critically scrutinizing its development and oversight.
Excludes: Specific technical or design strategies for risk mitigation, such as building external safeguards as covered by Build Guardrails Around AI, or improving data quality as covered by Build AI with Clean Data.
**Candidate refs:**
  - term:accountability_market  (concept: )
  - term:risk_innovation  (concept: )
  - term:safety_existential  (concept: )
  - term:speculative_risk_critique  (concept: )

**REFERENCE_ABOUT:** none
**NOTES:** meta-attitude (vigilant pragmatism); no offered concept is a genuine topical match.

---

## [54] skp-desires-077   (camp=skp, category=Desires, profile=concept-only)
**Proposition:** Precaution Grounded in Lived Experience. A Desire within skeptic discourse aspiring toward context-aware, justice-oriented governance over universalist risk models.
Encompasses: Localized risk assessment, epistemic justice, and responsiveness to immediate social vulnerabilities.
Excludes: Abstract existential risk modeling and one-size-fits-all precautionary frameworks.
**Candidate refs:**
  - term:risk_existential  (concept: existential risk)
  - term:safety_existential  (concept: existential risk)

**REFERENCE_ABOUT:** none
**NOTES:** localized/lived-experience precaution defined AGAINST abstract existential-risk modeling, which is in Excludes.

---

## [55] skp-desires-083   (camp=skp, category=Desires, profile=concept-only)
**Proposition:** Human and Planetary Flourishing as the Governing Metric for AI Development. A Desire within skeptic discourse that advocates subordinating AI development to demonstrably positive ecological and societal outcomes, measuring technological success through metrics of ecological sustainability, labor equity, and human well-being rather than raw capability scaling or capital accumulation.
Encompasses: Public-interest technology initiatives, ecologically sustainable compute mandates, holistic impact metrics, mandatory sustainability reporting, human-centric design principles, and AI deployment strictly for verified humanitarian or localized civil utility.
Excludes: Profit-driven market proliferation, abstract acceleration of intelligence, GDP growth as the primary indicator of AI success.
**Candidate refs:**
  - term:capabilities_scaling  (concept: capability scaling)
  - term:wellbeing_mental_health  (concept: human well-being)
  - term:governance_adaptive  (concept: )
  - term:safety_existential  (concept: )
  - term:speculative_future_harm  (concept: )

**REFERENCE_ABOUT:** term:wellbeing_mental_health
**NOTES:** human/planetary flourishing metric; capability scaling is the rejected foil; no ecology concept in pool.

---

## [56] skp-intentions-007   (camp=skp, category=Intentions, profile=concept-only)
**Proposition:** Regulate AI by Use Case, Not by Technology. An Intention within skeptic discourse that targets the deployment of strict, context-specific regulatory boundaries tailored to the distinct socio-technical use cases of narrow AI systems. 
Encompasses: Banning facial recognition in law enforcement, restricting automated decision-making in housing or lending, and enforcing sector-specific compliance rules (e.g., healthcare, criminal justice).
Excludes: One-size-fits-all capability restrictions applied solely at the foundational model level and overarching superintelligence containment strategies.
**Candidate refs:**
  - term:alignment_compliance  (concept: )
  - term:bias_systemic  (concept: )
  - term:governance_oversight  (concept: )
  - term:regulation_precautionary  (concept: )

**REFERENCE_ABOUT:** term:regulation_precautionary, term:governance_oversight
**NOTES:** use-case-specific restrictive regulation + sector compliance oversight.

---

## [57] skp-intentions-044   (camp=skp, category=Intentions, profile=concept-only)
**Proposition:** Eliminate the Regulatory Double Standard in AI Infrastructure Environmental Reporting. An Intention within skeptic discourse that advocates for mandatory environmental and resource reporting for AI data centers, mirroring existing regulatory requirements for factories and power plants. It targets the double standard where AI infrastructure avoids the disclosure mandates imposed on other high-consumption industries. 
Encompasses: carbon footprint disclosures and water usage reporting. 
Excludes: Independent AI Safety Checks, which focuses on external oversight of AI systems, or Force AI to Show Its Sources, which advocates for transparency regarding AI training data.
**Candidate refs:**
  - term:accountability_market  (concept: )
  - term:alignment_compliance  (concept: )
  - term:autonomy_individual  (concept: )
  - term:governance_oversight  (concept: )
  - term:oversight_audit  (concept: )
  - term:regulation_precautionary  (concept: )
  - term:transparency_accountability  (concept: )
  - term:transparency_verification  (concept: )

**REFERENCE_ABOUT:** term:transparency_accountability
**NOTES:** environmental-reporting/disclosure mandate; no energy concept in this pool; source-transparency (transparency_verification) in Excludes.

---

## [58] skp-intentions-102   (camp=skp, category=Intentions, profile=concept-only)
**Proposition:** Operationalize Pragmatic AI Governance Through Concrete Policy Mechanisms. An Intention within skeptic discourse that proposes practical, adaptable, and evidence-based strategies for AI governance.
Encompasses: adopting durable compliance standards (e.g., NIST AI RMF, ISO 42001) as regulatory anchors, integrating counterfactual fairness as a causal approach to equitable AI outcomes, and building public interest technologist pipelines to increase government technical capacity.
Excludes: radical economic restructuring, purely theoretical critiques of AI, and specific technical safety mechanisms (e.g., alignment research, kill switches), which are covered elsewhere.
**Candidate refs:**
  - term:fairness_individual  (concept: counterfactual fairness)
  - term:governance_adaptive  (concept: ai governance)
  - term:accountability_algorithmic  (concept: )
  - term:accountability_institutional  (concept: )
  - term:accountability_market  (concept: )
  - term:alignment_compliance  (concept: )
  - term:bias_systemic  (concept: )
  - term:capture_institutional  (concept: )
  - term:fairness_procedural  (concept: )
  - term:governance_oversight  (concept: )
  - term:governance_participatory  (concept: )
  - term:industry_lobbying  (concept: )
  - term:oversight_audit  (concept: )
  - term:oversight_human_control  (concept: )
  - term:regulation_adaptive  (concept: )
  - term:regulation_precautionary  (concept: )
  - term:risk_innovation  (concept: )
  - term:transparency_verification  (concept: )

**REFERENCE_ABOUT:** term:fairness_individual, term:governance_adaptive, term:regulation_adaptive
**NOTES:** pragmatic/adaptable evidence-based AI governance + counterfactual fairness; technical safety mechanisms in Excludes.

---

## [59] skp-intentions-127   (camp=skp, category=Intentions, profile=mixed)
**Proposition:** Balance Privacy, Compute, and Data Budgets in Differential Privacy Implementations. An Intention within skeptic discourse that details the technical configuration of differential privacy mechanisms, such as DP-SGD, to maximize model utility while rigorously maintaining data privacy.
Encompasses: Methodologies for balancing privacy, compute, and data budgets to optimize the noise-batch ratio and prevent performance degradation from naive privacy implementations.
Excludes: General data privacy regulations or theoretical discussions of privacy-preserving machine learning without specific implementation guidance.
**Candidate refs:**
  - ent-126  (entity: DP-SGD)
  - term:autonomy_individual  (concept: data privacy)

**REFERENCE_ABOUT:** ent-126, term:autonomy_individual
**NOTES:** DP-SGD differential-privacy budget balancing; data privacy.

---

## [60] skp-intentions-135   (camp=skp, category=Intentions, profile=concept-only)
**Proposition:** Mandate Pre-Committed Shutdown Thresholds for Both Internal and External AI Harms. An Intention within skeptic discourse that mandates AI product kill criteria include both a firm-side validation trigger and a third-party-harm trigger with an external intake channel.
Encompasses: paired pre-committed shutdown thresholds, third-party complaints intake infrastructure, named-fiduciary signoff on harm-side gates, externalized-harm internalization through disgorgement-aware accounting.
Excludes: customer-validation-only kill criteria, internal-only complaint routing through customer success, blanket pre-market review across the full codebase.
**Candidate refs:**
  - term:deployment_gated  (concept: pre-market review)

**REFERENCE_ABOUT:** none
**NOTES:** pre-committed shutdown/kill-threshold claim; deployment_gated's 'pre-market review' hint is in Excludes and no kill-switch concept in pool.

---

## [61] skp-intentions-146   (camp=skp, category=Intentions, profile=concept-only)
**Proposition:** Implementing Performance-Gated Independent AI Auditing. An Intention within skeptic discourse that advocates for legally required, tiered, and performance-gated independent audits of frontier AI models, using objective thresholds and anti-gaming safeguards to ensure demonstrable fairness and safety before and during deployment.
Encompasses: pre-deployment third-party safety evaluations proportional to systemic-harm potential, falsifiable performance triggers for mandatory audit, pre-registered thresholds with multiple-comparison correction, published log schemas at token-class granularity, subject-keyed escrow custody, worker-led safety vetoes, external red-teaming, and civil-rights impact assessments.
Excludes: reliance solely on post-deployment adaptive oversight, deployer-controlled log signatures, post-hoc threshold-setting, one-size-fits-all mandates that create insurmountable barriers for small-scale developers, and purely market-based liability frameworks.
**Candidate refs:**
  - term:fairness_individual  (concept: demonstrable fairness)
  - term:accountability_institutional  (concept: )
  - term:accountability_market  (concept: )
  - term:deployment_gated  (concept: )
  - term:liability_strict  (concept: )
  - term:oversight_audit  (concept: )
  - term:regulation_precautionary  (concept: )
  - term:transparency_accountability  (concept: )

**REFERENCE_ABOUT:** term:oversight_audit, term:deployment_gated, term:fairness_individual, term:transparency_accountability
**NOTES:** performance-gated independent auditing + deployment gating + demonstrable fairness/civil-rights + published-log transparency; market-based liability in Excludes.

---
