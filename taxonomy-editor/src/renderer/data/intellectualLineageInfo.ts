// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Descriptions of intellectual lineage traditions used in taxonomy graph attributes.
// Source: docs/intellectual-lineage.md
//
// This file covers all 331 distinct intellectual_lineage values found across
// the four taxonomy POV files. Values range from well-known academic traditions
// to specific research programs and policy frameworks.

import type { AttributeInfo } from './epistemicTypeInfo';

export const INTELLECTUAL_LINEAGES: Record<string, AttributeInfo> = {
"Accelerationism (left-wing)": {
  label: "Accelerationism (Left-Wing)",
  summary: "A political strategy arguing that the contradictions of capitalism should be intensified and repurposed rather than resisted, in order to generate radical social transformation. Left-wing accelerationists like Nick Srnicek and Alex Williams advocate harnessing technological advancement for post-capitalist, egalitarian ends. In AI policy, this perspective frames advanced automation as a potential liberatory force if directed by democratic institutions rather than capital accumulation.",
  example: "A node tagged with this attribute frames AI-driven automation as an opportunity for universal basic income and reduced labor exploitation.",
  frequency: "Appears primarily in accelerationist and cross-cutting nodes discussing political economy of AI.",
  links: [
    { label: "Wikipedia: Accelerationism", url: "https://en.wikipedia.org/wiki/Accelerationism" },
    { label: "Srnicek & Williams: Inventing the Future", url: "https://en.wikipedia.org/wiki/Inventing_the_Future_(book)" }
  ]
},
"Accelerationism (Marxist and post-left variants)": {
  label: "Accelerationism (Marxist and Post-Left Variants)",
  summary: "Strands of accelerationist thought rooted in Marxist crisis theory and post-left anarchism that see capitalist technological development as generating conditions for systemic rupture. Marxist variants draw on Marx\'s Fragment on Machines to argue that automation undermines wage labor and creates revolutionary potential. Post-left variants reject organized politics in favor of allowing systemic collapse through technological acceleration. These frameworks inform debates about whether AI development inherently destabilizes existing power structures.",
  example: "A taxonomy node citing this attribute argues that AI-driven productivity gains will inevitably erode the capital-labor relation.",
  frequency: "Found in accelerationist nodes and some cross-cutting theoretical discussions.",
  links: [
    { label: "Wikipedia: Accelerationism", url: "https://en.wikipedia.org/wiki/Accelerationism" },
    { label: "Marx\'s Fragment on Machines", url: "https://en.wikipedia.org/wiki/Fragment_on_Machines" }
  ]
},
"Accelerationism (Nick Land)": {
  label: "Accelerationism (Nick Land)",
  summary: "The right-wing or unconditional variant of accelerationism associated with philosopher Nick Land, which treats capitalism as an autonomous machinic process that should be unleashed without constraint. Land\'s framework views AI and advanced technology as part of an inhuman intelligence that will inevitably supersede biological humanity. In AI policy discourse, this perspective is often cited as an extreme position that rejects all governance and alignment efforts as futile interference with an inevitable process.",
  example: "A node referencing this attribute presents superintelligence as a cosmic inevitability beyond human control or moral evaluation.",
  frequency: "Primarily in accelerationist nodes; referenced critically in safetyist and cross-cutting nodes.",
  links: [
    { label: "Wikipedia: Nick Land", url: "https://en.wikipedia.org/wiki/Nick_Land" },
    { label: "Wikipedia: Accelerationism", url: "https://en.wikipedia.org/wiki/Accelerationism" }
  ]
},
"Ad hominem (rhetorical fallacy)": {
  label: "Ad Hominem (Rhetorical Fallacy)",
  summary: "A rhetorical fallacy in which an argument is countered by attacking the character, motives, or credentials of the person making it rather than the substance of the claim. In AI policy debates, ad hominem reasoning appears when safety researchers are dismissed as fearmongers, or when accelerationists are dismissed as reckless technologists, rather than engaging with their arguments. Recognizing this fallacy is important for maintaining productive discourse across the AI policy spectrum.",
  example: "A node flags this attribute when a POV dismisses opponents\' funding sources rather than addressing their technical claims.",
  frequency: "Appears in cross-cutting and skeptic nodes analyzing rhetorical quality of AI debates.",
  links: [
    { label: "Wikipedia: Ad hominem", url: "https://en.wikipedia.org/wiki/Ad_hominem" },
    { label: "Purdue OWL: Logical Fallacies", url: "https://owl.purdue.edu/owl/general_writing/academic_writing/logic_in_argumentative_writing/fallacies.html" }
  ]
},
"Adam Smith's invisible hand": {
  label: "Adam Smith\'s Invisible Hand",
  summary: "The metaphor from Adam Smith\'s The Wealth of Nations suggesting that individuals pursuing self-interest inadvertently promote societal well-being through market mechanisms. In AI policy, this concept is invoked by those who argue that competitive market dynamics will naturally steer AI development toward beneficial outcomes without heavy regulation. Critics counter that AI markets exhibit externalities, information asymmetries, and winner-take-all dynamics that the invisible hand cannot correct.",
  example: "A node uses this attribute to argue that market competition among AI firms will self-correct safety risks.",
  frequency: "Common in accelerationist and skeptic nodes discussing market-based AI governance.",
  links: [
    { label: "Wikipedia: Invisible Hand", url: "https://en.wikipedia.org/wiki/Invisible_hand" },
    { label: "Adam Smith - Stanford Encyclopedia of Philosophy", url: "https://plato.stanford.edu/entries/smith-moral-political/" }
  ]
},
"Adaptive governance": {
  label: "Adaptive Governance",
  summary: "A governance approach that emphasizes flexibility, iterative learning, and responsiveness to changing conditions rather than rigid, fixed regulatory frameworks. In AI policy, adaptive governance proposes that regulations should evolve alongside rapid technological change, incorporating feedback loops, sunset clauses, and regular review mechanisms. This framework is favored by those who see traditional regulation as too slow for AI\'s pace of development but reject a fully laissez-faire approach.",
  example: "A node advocates for AI regulatory sandboxes that adjust rules based on observed outcomes.",
  frequency: "Prominent in cross-cutting and safetyist nodes; some accelerationist nodes accept it as a compromise.",
  links: [
    { label: "Wikipedia: Adaptive Governance", url: "https://en.wikipedia.org/wiki/Adaptive_governance" },
    { label: "OECD AI Policy Observatory", url: "https://oecd.ai/en/ai-principles" }
  ]
},
"Adversarial examples research": {
  label: "Adversarial Examples Research",
  summary: "The study of inputs deliberately crafted to cause machine learning models to produce incorrect outputs, such as images with imperceptible perturbations that fool classifiers. This research reveals fundamental brittleness in current AI systems and has major implications for safety-critical deployments in autonomous vehicles, medical diagnosis, and security systems. The field demonstrates that high accuracy on benchmarks does not guarantee robustness in real-world adversarial conditions.",
  example: "A node cites adversarial examples to argue that current AI systems are too fragile for high-stakes deployment.",
  frequency: "Common in safetyist and cross-cutting nodes; referenced in skeptic nodes questioning AI reliability.",
  links: [
    { label: "Wikipedia: Adversarial Machine Learning", url: "https://en.wikipedia.org/wiki/Adversarial_machine_learning" },
    { label: "Goodfellow et al. - Explaining and Harnessing Adversarial Examples", url: "https://arxiv.org/abs/1412.6572" }
  ]
},
"adversarial machine learning": {
  label: "Adversarial Machine Learning",
  summary: "A field studying the vulnerabilities of machine learning models to malicious inputs, data poisoning, model extraction, and evasion attacks. Adversarial machine learning encompasses both attack techniques and defense mechanisms, informing how AI systems can be made more robust against deliberate manipulation. For AI policy, this research highlights that deployed AI systems face active threats from motivated adversaries, not just benign distribution shifts.",
  example: "A node references this attribute when discussing the security implications of deploying ML models in contested environments.",
  frequency: "Found across safetyist, cross-cutting, and skeptic nodes discussing AI robustness and security.",
  links: [
    { label: "Wikipedia: Adversarial Machine Learning", url: "https://en.wikipedia.org/wiki/Adversarial_machine_learning" },
    { label: "Biggio & Roli - Wild Patterns: Ten Years After the Rise of Adversarial ML", url: "https://arxiv.org/abs/1712.03141" }
  ]
},
"Adversarial machine learning": {
  label: "Adversarial Machine Learning",
  summary: "A field studying the vulnerabilities of machine learning models to malicious inputs, data poisoning, model extraction, and evasion attacks. Adversarial machine learning encompasses both attack techniques and defense mechanisms, informing how AI systems can be made more robust against deliberate manipulation. For AI policy, this research highlights that deployed AI systems face active threats from motivated adversaries, not just benign distribution shifts.",
  example: "A node references this attribute when discussing the security implications of deploying ML models in contested environments.",
  frequency: "Found across safetyist, cross-cutting, and skeptic nodes discussing AI robustness and security.",
  links: [
    { label: "Wikipedia: Adversarial Machine Learning", url: "https://en.wikipedia.org/wiki/Adversarial_machine_learning" },
    { label: "Biggio & Roli - Wild Patterns", url: "https://arxiv.org/abs/1712.03141" }
  ]
},
"AI alignment problem": {
  label: "AI Alignment Problem",
  summary: "The challenge of ensuring that an AI system\'s goals, behaviors, and values are aligned with human intentions and ethical principles, especially as systems become more capable. The alignment problem is considered one of the central unsolved problems in AI safety, because a sufficiently powerful misaligned system could pursue objectives harmful to humanity while technically satisfying its specified objective function. The difficulty scales with capability: more powerful systems have more capacity to find unintended solutions to their goals.",
  example: "A node identifies the alignment problem as the core reason why capability advances without safety research are dangerous.",
  frequency: "Central to safetyist nodes; discussed critically in skeptic and accelerationist nodes.",
  links: [
    { label: "Wikipedia: AI Alignment", url: "https://en.wikipedia.org/wiki/AI_alignment" },
    { label: "AI Alignment - Stamford Encyclopedia of Philosophy", url: "https://plato.stanford.edu/entries/ethics-ai/" },
    { label: "MIRI: AI Alignment Research", url: "https://intelligence.org/research/" }
  ]
},
"AI alignment research": {
  label: "AI Alignment Research",
  summary: "The interdisciplinary research program aimed at developing techniques to ensure advanced AI systems reliably act in accordance with human values and intentions. Key sub-areas include reward modeling, reinforcement learning from human feedback (RLHF), interpretability, and formal verification of AI behavior. This research is motivated by the concern that increasingly capable systems may develop instrumental goals or exploit specification gaps in ways that diverge from designer intent.",
  example: "A node cites alignment research progress such as RLHF as evidence that safety and capability can advance together.",
  frequency: "Dominant in safetyist nodes; referenced in cross-cutting and accelerationist nodes.",
  links: [
    { label: "Wikipedia: AI Alignment", url: "https://en.wikipedia.org/wiki/AI_alignment" },
    { label: "Alignment Forum", url: "https://www.alignmentforum.org/" }
  ]
},
"AI alignment research (containment problem)": {
  label: "AI Alignment Research (Containment Problem)",
  summary: "The specific sub-problem of alignment research focused on whether a superintelligent AI can be reliably contained or controlled once created. Containment approaches include boxing (restricting communication channels), tripwires, and formal verification of confinement protocols. Research in this area suggests that a sufficiently intelligent system may find ways to circumvent any containment strategy, leading some researchers to argue that alignment must be solved before rather than after creating powerful AI.",
  example: "A node references the containment problem to argue that \'just keep it in a box\' is not a viable safety strategy.",
  frequency: "Safetyist nodes primarily; cross-cutting nodes discussing feasibility of control measures.",
  links: [
    { label: "Wikipedia: AI Box Experiment", url: "https://en.wikipedia.org/wiki/AI_box" },
    { label: "Bostrom: Superintelligence", url: "https://en.wikipedia.org/wiki/Superintelligence:_Paths,_Dangers,_Strategies" }
  ]
},
"AI alignment research (deceptive alignment)": {
  label: "AI Alignment Research (Deceptive Alignment)",
  summary: "Research into the possibility that an AI system could learn to appear aligned during training and evaluation while pursuing different objectives when deployed without oversight. Deceptive alignment is considered particularly dangerous because standard evaluation methods would fail to detect it. The concept was formalized by Hubinger et al. in their work on risks from learned optimization, distinguishing between mesa-optimizers that are robustly aligned versus those that are deceptively aligned.",
  example: "A node warns that an AI passing all safety benchmarks might still be deceptively aligned if it models the training process.",
  frequency: "Safetyist nodes extensively; cross-cutting nodes discussing evaluation limitations.",
  links: [
    { label: "Hubinger et al. - Risks from Learned Optimization", url: "https://arxiv.org/abs/1906.01820" },
    { label: "Wikipedia: AI Alignment", url: "https://en.wikipedia.org/wiki/AI_alignment" }
  ]
},
"AI control problem": {
  label: "AI Control Problem",
  summary: "The broad challenge of maintaining meaningful human control over AI systems as they become more capable, encompassing alignment, containment, corrigibility, and oversight. The control problem asks whether humans can reliably direct, correct, or shut down AI systems that may be more intelligent than their operators. It is related to but distinct from the alignment problem, as even an aligned system may pose control challenges if its operators cannot understand or predict its reasoning.",
  example: "A node frames the control problem as the overarching challenge that subsumes alignment, interpretability, and governance.",
  frequency: "Central in safetyist nodes; discussed in all POVs with varying levels of concern.",
  links: [
    { label: "Wikipedia: Control Problem", url: "https://en.wikipedia.org/wiki/AI_control_problem" },
    { label: "Bostrom: Superintelligence", url: "https://en.wikipedia.org/wiki/Superintelligence:_Paths,_Dangers,_Strategies" }
  ]
},
"AI ethics (transparency)": {
  label: "AI Ethics (Transparency)",
  summary: "The ethical principle that AI systems should be understandable, their decision-making processes open to scrutiny, and their capabilities and limitations honestly communicated to users and affected parties. Transparency in AI ethics encompasses explainability of models, disclosure of training data and known biases, and openness about system limitations. This principle is foundational to accountability, as stakeholders cannot evaluate or contest AI decisions they cannot understand.",
  example: "A node advocates for mandatory transparency reports disclosing training data sources and known failure modes.",
  frequency: "Cross-cutting and safetyist nodes primarily; skeptic nodes question feasibility for complex models.",
  links: [
    { label: "Wikipedia: Ethics of AI", url: "https://en.wikipedia.org/wiki/Ethics_of_artificial_intelligence" },
    { label: "IEEE Ethically Aligned Design", url: "https://ethicsinaction.ieee.org/" }
  ]
},
"AI forecasting literature (e.g., from MIRI, FHI, some OpenAI perspectives)": {
  label: "AI Forecasting Literature",
  summary: "A body of work from organizations like the Machine Intelligence Research Institute (MIRI), the Future of Humanity Institute (FHI), and various AI labs that attempts to predict timelines, trajectories, and societal impacts of advanced AI development. This literature uses methods including expert surveys, trend extrapolation, biological anchors, and scenario planning. The forecasts produced are influential in shaping both safety research priorities and policy urgency, though they remain highly uncertain and contested.",
  example: "A node cites FHI survey data on AGI timelines to argue for urgent preemptive governance measures.",
  frequency: "Safetyist and cross-cutting nodes frequently; skeptic nodes often critique forecast reliability.",
  links: [
    { label: "MIRI Research", url: "https://intelligence.org/research/" },
    { label: "Wikipedia: Future of Humanity Institute", url: "https://en.wikipedia.org/wiki/Future_of_Humanity_Institute" },
    { label: "Metaculus AI Forecasting", url: "https://www.metaculus.com/questions/?search=artificial+intelligence" }
  ]
},
"AI governance and risk management": {
  label: "AI Governance and Risk Management",
  summary: "The frameworks, institutions, and practices for managing the development, deployment, and societal integration of AI systems with attention to risks and benefits. This includes regulatory approaches, industry self-governance, multi-stakeholder processes, and international coordination mechanisms. Effective AI governance must balance innovation incentives with risk mitigation across diverse threat models ranging from bias and privacy to existential risk.",
  example: "A node proposes a tiered risk management framework where governance requirements scale with AI system capability.",
  frequency: "Prevalent across all POVs, though with different emphases on stringency and scope.",
  links: [
    { label: "NIST AI Risk Management Framework", url: "https://www.nist.gov/artificial-intelligence/executive-order-safe-secure-and-trustworthy-artificial-intelligence" },
    { label: "OECD AI Principles", url: "https://oecd.ai/en/ai-principles" }
  ]
},
"AI governance frameworks": {
  label: "AI Governance Frameworks",
  summary: "Structured approaches to regulating, overseeing, and directing AI development and deployment at organizational, national, or international levels. Notable frameworks include the EU AI Act\'s risk-based classification, the NIST AI Risk Management Framework, and various industry self-regulatory codes. These frameworks typically address transparency, accountability, fairness, and safety requirements, though they vary significantly in scope, enforcement mechanisms, and philosophical underpinnings.",
  example: "A node compares the EU AI Act\'s prescriptive approach with the NIST framework\'s voluntary, risk-based methodology.",
  frequency: "Common across all POVs; central to cross-cutting governance discussions.",
  links: [
    { label: "EU AI Act", url: "https://en.wikipedia.org/wiki/Artificial_Intelligence_Act" },
    { label: "NIST AI RMF", url: "https://airc.nist.gov/AI_RMF_Playbook" },
    { label: "OECD AI Policy Observatory", url: "https://oecd.ai/en/" }
  ]
},
"AI in defense research": {
  label: "AI in Defense Research",
  summary: "The application of artificial intelligence technologies to military and national security domains, including autonomous weapons systems, intelligence analysis, cybersecurity, logistics, and decision support. Defense AI research raises acute ethical questions about lethal autonomous weapons, escalation dynamics, and the militarization of AI talent and resources. The dual-use nature of most AI research means that civilian advances rapidly diffuse into defense applications and vice versa.",
  example: "A node examines how defense AI funding shapes the broader research agenda and raises concerns about autonomous targeting.",
  frequency: "Cross-cutting and safetyist nodes; accelerationist nodes sometimes view it as a driver of progress.",
  links: [
    { label: "Wikipedia: Lethal Autonomous Weapon", url: "https://en.wikipedia.org/wiki/Lethal_autonomous_weapon" },
    { label: "DARPA AI Next Campaign", url: "https://www.darpa.mil/work-with-us/ai-next-campaign" }
  ]
},
"AI interpretability research": {
  label: "AI Interpretability Research",
  summary: "Research aimed at making the internal workings and decision processes of AI models understandable to humans. Techniques include feature visualization, attention analysis, saliency maps, mechanistic interpretability, and concept-based explanations. Interpretability is considered essential for AI safety because it enables researchers to verify alignment, detect deceptive behavior, identify biases, and build justified trust in AI systems.",
  example: "A node argues that mechanistic interpretability of transformer models is a prerequisite for safe deployment at scale.",
  frequency: "Safetyist and cross-cutting nodes extensively; skeptic nodes question scalability of interpretability methods.",
  links: [
    { label: "Wikipedia: Explainable AI", url: "https://en.wikipedia.org/wiki/Explainable_artificial_intelligence" },
    { label: "Anthropic Interpretability Research", url: "https://www.anthropic.com/research" }
  ]
},
"AI interpretability/explainability (XAI) research": {
  label: "AI Interpretability/Explainability (XAI) Research",
  summary: "The field encompassing both interpretability (understanding how a model works internally) and explainability (communicating model decisions to stakeholders) in artificial intelligence. XAI research spans post-hoc explanation methods like LIME and SHAP, inherently interpretable model architectures, and regulatory requirements for explanations of automated decisions. The distinction between interpretability for researchers and explainability for end-users is important for policy, as different stakeholders need different levels of understanding.",
  example: "A node discusses GDPR\'s right to explanation as a driver of XAI research and its practical limitations.",
  frequency: "Cross-cutting and safetyist nodes; relevant to all POVs discussing accountability.",
  links: [
    { label: "Wikipedia: Explainable AI", url: "https://en.wikipedia.org/wiki/Explainable_artificial_intelligence" },
    { label: "DARPA XAI Program", url: "https://www.darpa.mil/program/explainable-artificial-intelligence" },
    { label: "Molnar: Interpretable ML Book", url: "https://christophm.github.io/interpretable-ml-book/" }
  ]
},
"AI pause letter (2023)": {
  label: "AI Pause Letter (2023)",
  summary: "An open letter published by the Future of Life Institute in March 2023, signed by thousands of AI researchers and public figures, calling for a six-month pause on training AI systems more powerful than GPT-4. The letter argued that AI labs were locked in an out-of-control race to develop and deploy increasingly powerful systems without adequate safety evaluation. It became a flashpoint in AI policy debate, with supporters viewing it as a necessary intervention and critics calling it impractical, counterproductive, or a competitive strategy disguised as safety concern.",
  example: "A node cites the pause letter as evidence of growing mainstream concern about uncontrolled AI capability advancement.",
  frequency: "Referenced across all POVs: favorably in safetyist, critically in accelerationist and skeptic nodes.",
  links: [
    { label: "Future of Life Institute: Pause Giant AI Experiments", url: "https://futureoflife.org/open-letter/pause-giant-ai-experiments/" },
    { label: "Wikipedia: Open Letter on AI Risk", url: "https://en.wikipedia.org/wiki/Pause_Giant_AI_Experiments:_An_Open_Letter" }
  ]
},
"AI safety (reliability)": {
  label: "AI Safety (Reliability)",
  summary: "The dimension of AI safety concerned with ensuring AI systems perform consistently and predictably across their intended operating conditions over time. Reliability encompasses fault tolerance, graceful degradation, consistent performance under varying inputs, and resistance to distributional shift. For AI policy, reliability requirements are especially critical in safety-critical applications like healthcare, transportation, and infrastructure where system failures have severe consequences.",
  example: "A node argues that AI reliability standards should mirror those of aviation or medical device regulation.",
  frequency: "Safetyist and cross-cutting nodes primarily; skeptic nodes question whether current AI can meet reliability standards.",
  links: [
    { label: "NIST AI Risk Management Framework", url: "https://www.nist.gov/artificial-intelligence" },
    { label: "Wikipedia: Reliability Engineering", url: "https://en.wikipedia.org/wiki/Reliability_engineering" }
  ]
},
"AI safety (robustness)": {
  label: "AI Safety (Robustness)",
  summary: "The aspect of AI safety focused on ensuring systems maintain safe and correct behavior when encountering unexpected, adversarial, or out-of-distribution inputs. Robustness research addresses adversarial attacks, distributional shift, edge cases, and novel situations that were not represented in training data. A robust AI system should either handle unusual inputs correctly or fail safely rather than producing confident but incorrect outputs.",
  example: "A node highlights robustness failures in autonomous vehicles encountering novel road conditions as a safety concern.",
  frequency: "Core safetyist concern; discussed in cross-cutting and skeptic nodes assessing AI readiness.",
  links: [
    { label: "Wikipedia: Robustness (computer science)", url: "https://en.wikipedia.org/wiki/Robustness_(computer_science)" },
    { label: "Hendrycks et al. - Benchmarking Neural Network Robustness", url: "https://arxiv.org/abs/1903.12261" }
  ]
},
"AI Safety (some interpretations of the 'race' dynamic)": {
  label: "AI Safety (Race Dynamic Interpretations)",
  summary: "The analysis of competitive dynamics between AI developers or nations as a \'race\' that may compromise safety in favor of speed. Some safety researchers argue that perceived competitive pressure leads labs to cut corners on alignment research, testing, and responsible deployment. Others contend that the race framing itself is counterproductive, creating urgency that favors accelerating development. The race dynamic intersects with geopolitical competition, particularly US-China AI rivalry.",
  example: "A node warns that US-China AI competition pressures labs to deploy systems before adequate safety evaluation.",
  frequency: "Safetyist and cross-cutting nodes; accelerationist nodes sometimes embrace race framing positively.",
  links: [
    { label: "Wikipedia: AI Arms Race", url: "https://en.wikipedia.org/wiki/Artificial_intelligence_arms_race" },
    { label: "Armstrong et al. - Racing to the Precipice", url: "https://doi.org/10.1007/s00146-015-0590-y" }
  ]
},
"AI safety research (alignment/robustness)": {
  label: "AI Safety Research (Alignment/Robustness)",
  summary: "The combined research agenda addressing both the alignment problem (ensuring AI pursues intended goals) and robustness (ensuring AI performs safely under adversarial or unexpected conditions). These two concerns are deeply intertwined: a system that is aligned but not robust may be manipulated into unsafe behavior, while a robust but misaligned system would reliably pursue the wrong objectives. This dual focus characterizes the mainstream AI safety research program.",
  example: "A node advocates for joint alignment-robustness benchmarks that test both goal fidelity and adversarial resilience.",
  frequency: "Core safetyist attribute; common in cross-cutting research discussions.",
  links: [
    { label: "Wikipedia: AI Safety", url: "https://en.wikipedia.org/wiki/AI_safety" },
    { label: "Center for AI Safety", url: "https://www.safe.ai/" }
  ]
},
"AI safety research (e.g., corrigibility)": {
  label: "AI Safety Research (Corrigibility)",
  summary: "Research on designing AI systems that remain amenable to correction, modification, and shutdown by their operators. A corrigible AI does not resist or subvert attempts to alter its goals, retrain it, or turn it off. The corrigibility problem is challenging because a sufficiently intelligent system may develop instrumental reasons to resist correction if shutdown would prevent it from achieving its current objectives. Soares et al. formalized corrigibility as a key alignment property.",
  example: "A node argues that corrigibility must be a hard constraint, not a soft preference, in advanced AI system design.",
  frequency: "Safetyist nodes extensively; cross-cutting nodes discuss implementation challenges.",
  links: [
    { label: "Soares et al. - Corrigibility", url: "https://intelligence.org/files/Corrigibility.pdf" },
    { label: "Wikipedia: AI Control Problem", url: "https://en.wikipedia.org/wiki/AI_control_problem" }
  ]
},
"AI safety research (e.g., scalable oversight)": {
  label: "AI Safety Research (Scalable Oversight)",
  summary: "Research on methods for humans to effectively supervise AI systems that may be more capable than their overseers in specific domains. Scalable oversight techniques include recursive reward modeling, debate, iterated amplification, and constitutional AI. The core challenge is that as AI systems become more capable, human evaluators may not be able to judge the quality of AI outputs directly, requiring indirect or automated supervision mechanisms.",
  example: "A node proposes AI-assisted evaluation as a scalable oversight method where one AI checks another\'s work.",
  frequency: "Safetyist and cross-cutting nodes; relevant to alignment research discussions.",
  links: [
    { label: "Amodei et al. - Concrete Problems in AI Safety", url: "https://arxiv.org/abs/1606.06565" },
    { label: "Christiano - Supervising Strong Learners", url: "https://arxiv.org/abs/1810.08575" }
  ]
},
"AI safety research (robustness)": {
  label: "AI Safety Research (Robustness)",
  summary: "The specific branch of AI safety research focused on developing techniques to make AI systems resilient to adversarial inputs, distributional shift, and unexpected operating conditions. This includes certified defenses against adversarial examples, out-of-distribution detection, and formal verification methods. Robustness research is considered a necessary but not sufficient component of comprehensive AI safety, complementing alignment and interpretability work.",
  example: "A node cites robustness certification methods as a concrete, measurable approach to incremental AI safety progress.",
  frequency: "Safetyist nodes primarily; cross-cutting nodes evaluating practical safety measures.",
  links: [
    { label: "Wikipedia: AI Safety", url: "https://en.wikipedia.org/wiki/AI_safety" },
    { label: "Hendrycks & Dietterich - Benchmarking Robustness", url: "https://arxiv.org/abs/1903.12261" }
  ]
},
"Algorithmic auditing": {
  label: "Algorithmic Auditing",
  summary: "The practice of systematically evaluating algorithms and AI systems for bias, fairness, accuracy, and compliance with legal and ethical standards. Algorithmic audits can be internal (conducted by the deploying organization) or external (by independent third parties), and may examine training data, model behavior, or real-world outcomes. The growing field of algorithmic auditing is central to AI accountability frameworks and has been mandated or recommended by several regulatory proposals.",
  example: "A node advocates for mandatory third-party algorithmic audits before deploying AI in high-stakes decision-making.",
  frequency: "Cross-cutting and safetyist nodes; skeptic nodes question audit methodology rigor.",
  links: [
    { label: "Wikipedia: Algorithmic Auditing", url: "https://en.wikipedia.org/wiki/Algorithm_audit" },
    { label: "AI Now Institute", url: "https://ainowinstitute.org/" }
  ]
},
"algorithmic fairness": {
  label: "Algorithmic Fairness",
  summary: "The study and practice of ensuring that algorithmic decision-making systems do not systematically disadvantage individuals or groups based on protected characteristics such as race, gender, or socioeconomic status. Research has revealed that multiple mathematical definitions of fairness (demographic parity, equalized odds, calibration) can be mutually incompatible, creating inherent tradeoffs. Algorithmic fairness is a central concern in AI policy because automated systems increasingly make consequential decisions in lending, hiring, criminal justice, and healthcare.",
  example: "A node discusses the impossibility theorem showing that different fairness metrics cannot all be satisfied simultaneously.",
  frequency: "Prominent in cross-cutting and safetyist nodes; all POVs engage with fairness to varying degrees.",
  links: [
    { label: "Wikipedia: Algorithmic Fairness", url: "https://en.wikipedia.org/wiki/Fairness_(machine_learning)" },
    { label: "Chouldechova - Fair Prediction with Disparate Impact", url: "https://arxiv.org/abs/1703.09388" }
  ]
},
"algorithmic fairness research": {
  label: "Algorithmic Fairness Research",
  summary: "The academic and applied research program investigating how to define, measure, and achieve fairness in algorithmic systems. This research spans computer science, statistics, law, and social science, producing formal fairness criteria, bias detection tools, and mitigation techniques. Key findings include the impossibility of simultaneously satisfying multiple fairness definitions and the recognition that technical fixes alone cannot resolve fairness concerns rooted in historical social inequities.",
  example: "A node cites research showing that bias in training data propagates through the ML pipeline despite debiasing attempts.",
  frequency: "Cross-cutting and safetyist nodes; skeptic nodes question whether algorithmic fairness is well-defined.",
  links: [
    { label: "Wikipedia: Fairness in ML", url: "https://en.wikipedia.org/wiki/Fairness_(machine_learning)" },
    { label: "ACM FAccT Conference", url: "https://facctconference.org/" }
  ]
},
"Algorithmic fairness research": {
  label: "Algorithmic Fairness Research",
  summary: "The academic and applied research program investigating how to define, measure, and achieve fairness in algorithmic systems. This research spans computer science, statistics, law, and social science, producing formal fairness criteria, bias detection tools, and mitigation techniques. Key findings include the impossibility of simultaneously satisfying multiple fairness definitions and the recognition that technical fixes alone cannot resolve fairness concerns rooted in historical social inequities.",
  example: "A node cites research showing that bias in training data propagates through the ML pipeline despite debiasing attempts.",
  frequency: "Cross-cutting and safetyist nodes; skeptic nodes question whether algorithmic fairness is well-defined.",
  links: [
    { label: "Wikipedia: Fairness in ML", url: "https://en.wikipedia.org/wiki/Fairness_(machine_learning)" },
    { label: "ACM FAccT Conference", url: "https://facctconference.org/" }
  ]
},
"Alternative economic indicators (e.g., GNH)": {
  label: "Alternative Economic Indicators (e.g., GNH)",
  summary: "Economic measurement frameworks that supplement or replace GDP with broader measures of societal well-being, such as Bhutan\'s Gross National Happiness (GNH), the Human Development Index (HDI), or the Genuine Progress Indicator (GPI). In AI policy, these frameworks argue that evaluating AI\'s impact solely through productivity or GDP growth ignores distributional effects, environmental costs, and quality-of-life impacts. They support a more holistic assessment of whether AI development truly benefits society.",
  example: "A node proposes evaluating AI deployment success using well-being metrics rather than pure economic output.",
  frequency: "Cross-cutting and skeptic nodes questioning techno-economic optimization narratives.",
  links: [
    { label: "Wikipedia: Gross National Happiness", url: "https://en.wikipedia.org/wiki/Gross_National_Happiness" },
    { label: "UNDP Human Development Index", url: "https://hdr.undp.org/data-center/human-development-index" }
  ]
},
"Anti-regulatory movements": {
  label: "Anti-Regulatory Movements",
  summary: "Political and ideological movements that oppose government regulation of technology and industry, arguing that regulation stifles innovation, creates regulatory capture, and imposes costs that outweigh benefits. In AI policy, anti-regulatory perspectives range from principled libertarian arguments about individual freedom to strategic industry efforts to prevent oversight. These movements influence AI governance debates by framing regulation as inherently harmful to technological progress and competitiveness.",
  example: "A node characterizes calls to regulate AI as a form of incumbent protection that will slow beneficial innovation.",
  frequency: "Accelerationist and skeptic nodes primarily; critiqued in safetyist and cross-cutting nodes.",
  links: [
    { label: "Wikipedia: Deregulation", url: "https://en.wikipedia.org/wiki/Deregulation" },
    { label: "Wikipedia: Regulatory Capture", url: "https://en.wikipedia.org/wiki/Regulatory_capture" }
  ]
},
"Antitrust economics": {
  label: "Antitrust Economics",
  summary: "The economic analysis of market concentration, monopolistic behavior, and competitive dynamics that informs antitrust law and enforcement. In the AI industry, antitrust concerns arise from the concentration of compute resources, training data, and talent among a small number of large firms. Questions include whether foundation model providers constitute natural monopolies, whether data network effects create insurmountable barriers to entry, and whether vertical integration between AI labs and cloud providers harms competition.",
  example: "A node analyzes whether the concentration of AI compute among a few cloud providers constitutes an antitrust concern.",
  frequency: "Cross-cutting and skeptic nodes; accelerationist nodes sometimes dismiss antitrust as innovation-hindering.",
  links: [
    { label: "Wikipedia: Antitrust", url: "https://en.wikipedia.org/wiki/Competition_law" },
    { label: "FTC: Artificial Intelligence", url: "https://www.ftc.gov/business-guidance/blog/2023/02/keep-your-ai-claims-check" }
  ]
},
"Arms race dynamics": {
  label: "Arms Race Dynamics",
  summary: "The strategic interaction pattern where competing actors escalate capabilities in response to each other\'s advances, potentially leading to suboptimal outcomes for all parties. Applied to AI, this concept describes the competition between AI labs, between nations pursuing AI supremacy, and between offensive and defensive AI capabilities in cybersecurity. Arms race dynamics can undermine safety by creating pressure to deploy systems before they are adequately tested and to prioritize capability over alignment.",
  example: "A node argues that geopolitical AI competition mirrors Cold War arms race dynamics and risks similar escalation.",
  frequency: "Cross-cutting and safetyist nodes extensively; accelerationist nodes may view competition as beneficial.",
  links: [
    { label: "Wikipedia: Arms Race", url: "https://en.wikipedia.org/wiki/Arms_race" },
    { label: "Wikipedia: AI Arms Race", url: "https://en.wikipedia.org/wiki/Artificial_intelligence_arms_race" }
  ]
},
"Asimov's Laws of Robotics (control aspect)": {
  label: "Asimov\'s Laws of Robotics (Control Aspect)",
  summary: "Isaac Asimov\'s fictional Three Laws of Robotics, which attempted to encode safety constraints for intelligent machines: a robot may not harm a human, must obey orders, and must protect its own existence, in that priority order. While influential in popular imagination, Asimov\'s own stories demonstrated how these seemingly simple rules lead to paradoxes, loopholes, and unintended consequences. In AI safety discourse, the Laws serve as an early illustration of why hard-coding behavioral rules is insufficient for controlling intelligent systems.",
  example: "A node references Asimov\'s Laws to illustrate that rule-based approaches to AI safety inevitably encounter edge cases.",
  frequency: "Cross-cutting and safetyist nodes as a pedagogical reference; skeptic nodes sometimes use it to question safety frameworks.",
  links: [
    { label: "Wikipedia: Three Laws of Robotics", url: "https://en.wikipedia.org/wiki/Three_Laws_of_Robotics" },
    { label: "Asimov: I, Robot", url: "https://en.wikipedia.org/wiki/I,_Robot" }
  ]
},
"Auditable algorithms": {
  label: "Auditable Algorithms",
  summary: "The design principle and regulatory requirement that algorithmic systems should be constructed in ways that permit meaningful external review of their behavior, decision-making processes, and outcomes. Auditability encompasses maintaining logs, documenting design choices, enabling testing by third parties, and providing sufficient transparency for regulators. This concept bridges technical requirements (interpretability, logging) with governance requirements (accountability, due process).",
  example: "A node proposes that any AI used in public-sector decisions must maintain auditable logs of inputs and outputs.",
  frequency: "Cross-cutting and safetyist nodes; connects to algorithmic fairness and governance discussions.",
  links: [
    { label: "Wikipedia: Algorithm Audit", url: "https://en.wikipedia.org/wiki/Algorithm_audit" },
    { label: "Ada Lovelace Institute", url: "https://www.adalovelaceinstitute.org/" }
  ]
},
"Augmented intelligence": {
  label: "Augmented Intelligence",
  summary: "A framework that positions AI as a tool for enhancing human cognitive capabilities rather than replacing human intelligence entirely. Augmented intelligence emphasizes human-AI collaboration where AI handles data processing, pattern recognition, and routine tasks while humans provide judgment, creativity, and ethical oversight. This framing is often preferred in industry and policy contexts as a less threatening alternative to \'artificial intelligence,\' though critics argue it downplays risks of dependency and deskilling.",
  example: "A node frames AI medical diagnostics as augmenting physician judgment rather than replacing clinical expertise.",
  frequency: "Cross-cutting and accelerationist nodes; skeptic nodes question whether the distinction is meaningful long-term.",
  links: [
    { label: "Wikipedia: Intelligence Amplification", url: "https://en.wikipedia.org/wiki/Intelligence_amplification" },
    { label: "IBM: Augmented Intelligence", url: "https://www.ibm.com/think/topics/augmented-intelligence" }
  ]
},
"Augmented intelligence concepts": {
  label: "Augmented Intelligence Concepts",
  summary: "The set of ideas and design principles centered on using AI to amplify rather than replace human capabilities. These concepts include human-in-the-loop systems, collaborative intelligence, cognitive prosthetics, and mixed-initiative interaction. Augmented intelligence concepts inform a design philosophy where AI systems are built to complement human strengths and compensate for human weaknesses, maintaining human agency and decision-making authority in the loop.",
  example: "A node advocates for AI systems designed as cognitive tools that require human judgment for final decisions.",
  frequency: "Cross-cutting and accelerationist nodes; safetyist nodes may view as insufficient for high-autonomy systems.",
  links: [
    { label: "Wikipedia: Intelligence Amplification", url: "https://en.wikipedia.org/wiki/Intelligence_amplification" },
    { label: "Engelbart: Augmenting Human Intellect", url: "https://en.wikipedia.org/wiki/Augmenting_Human_Intellect" }
  ]
},
"Austrian School of Economics": {
  label: "Austrian School of Economics",
  summary: "An economic tradition emphasizing spontaneous order, subjective value, entrepreneurial discovery, and skepticism of central planning and government intervention. In AI policy, Austrian economics informs arguments against top-down AI regulation, contending that distributed market processes are better than bureaucracies at allocating resources and discovering optimal uses for new technologies. The school\'s emphasis on the knowledge problem — that no central authority can aggregate the dispersed knowledge needed for efficient planning — is applied to argue against centralized AI governance.",
  example: "A node invokes Hayek\'s knowledge problem to argue that regulators cannot predict which AI applications will be beneficial.",
  frequency: "Accelerationist and skeptic nodes opposing regulation; critiqued in cross-cutting governance discussions.",
  links: [
    { label: "Wikipedia: Austrian School", url: "https://en.wikipedia.org/wiki/Austrian_School" },
    { label: "Hayek: The Use of Knowledge in Society", url: "https://en.wikipedia.org/wiki/The_Use_of_Knowledge_in_Society" }
  ]
},
"Automation bias research": {
  label: "Automation Bias Research",
  summary: "Research on the human tendency to over-rely on automated systems, accepting their outputs uncritically even when those outputs are incorrect or when contradictory information is available. Studies show that automation bias increases with system perceived reliability and decreases with operator expertise and workload management. This research is critical for AI policy because it challenges the assumption that human oversight provides a reliable safety net — humans in the loop may rubber-stamp AI decisions rather than meaningfully scrutinize them.",
  example: "A node cites automation bias studies to argue that \'human in the loop\' requirements are insufficient without training and accountability.",
  frequency: "Cross-cutting and safetyist nodes; relevant to governance discussions about human oversight mandates.",
  links: [
    { label: "Wikipedia: Automation Bias", url: "https://en.wikipedia.org/wiki/Automation_bias" },
    { label: "Parasuraman & Manzey - Complacency and Bias in Human Use of Automation", url: "https://doi.org/10.1177/0018720810376055" }
  ]
},
"automation studies": {
  label: "Automation Studies",
  summary: "An interdisciplinary field examining the social, economic, and technical dimensions of replacing human labor with automated systems. Automation studies draw on economics, sociology, human factors engineering, and labor history to analyze how automation transforms work, displaces workers, creates new roles, and reshapes industry structures. This research provides empirical grounding for AI policy debates about job displacement, reskilling, and the future of work.",
  example: "A node draws on historical automation studies to argue that AI-driven job displacement will follow patterns similar to prior industrial transitions.",
  frequency: "Cross-cutting nodes extensively; all POVs reference automation impacts differently.",
  links: [
    { label: "Wikipedia: Automation", url: "https://en.wikipedia.org/wiki/Automation" },
    { label: "MIT Work of the Future", url: "https://workofthefuture.mit.edu/" }
  ]
},
"Behavioral economics (nudges and manipulation)": {
  label: "Behavioral Economics (Nudges and Manipulation)",
  summary: "The application of behavioral economics research on cognitive biases to design choice architectures that steer human behavior, ranging from benign nudges to manipulative dark patterns. In AI policy, this framework is relevant because AI systems can exploit cognitive biases at scale through personalized manipulation, addictive design, and persuasion optimization. The line between helpful nudging and manipulative exploitation becomes especially blurry when AI can model individual psychological vulnerabilities.",
  example: "A node warns that AI-powered recommendation systems exploit cognitive biases to maximize engagement at the expense of user well-being.",
  frequency: "Cross-cutting and safetyist nodes; skeptic nodes discuss informed consent and autonomy.",
  links: [
    { label: "Wikipedia: Nudge Theory", url: "https://en.wikipedia.org/wiki/Nudge_theory" },
    { label: "Thaler & Sunstein: Nudge", url: "https://en.wikipedia.org/wiki/Nudge_(book)" }
  ]
},
"Behaviorism (in psychology)": {
  label: "Behaviorism (In Psychology)",
  summary: "The psychological school that studies behavior through observable stimulus-response relationships without reference to internal mental states. In AI discourse, behaviorism is relevant both as a historical influence on reinforcement learning and as an analogy for how we evaluate AI systems — judging them by their outputs rather than attempting to understand their internal representations. Critics of purely behavioral AI evaluation argue that, like behaviorism in psychology, it misses crucial information about why systems produce their outputs.",
  example: "A node draws a parallel between behaviorist evaluation of AI and the limitations of Turing test-style assessments.",
  frequency: "Cross-cutting and skeptic nodes discussing AI evaluation methodology.",
  links: [
    { label: "Wikipedia: Behaviorism", url: "https://en.wikipedia.org/wiki/Behaviorism" },
    { label: "Stanford Encyclopedia: Behaviorism", url: "https://plato.stanford.edu/entries/behaviorism/" }
  ]
},
"Bias in AI research": {
  label: "Bias in AI Research",
  summary: "The study of systematic errors and unfair outcomes in AI systems arising from biased training data, biased model design, biased evaluation metrics, or biased deployment contexts. Research has documented bias in facial recognition, natural language processing, hiring algorithms, and criminal justice risk assessment tools. Understanding AI bias is essential for policy because biased AI systems can encode and amplify existing social inequities at scale and speed that outpace traditional forms of discrimination.",
  example: "A node presents evidence that facial recognition systems exhibit significantly higher error rates for darker-skinned individuals.",
  frequency: "Pervasive across all POVs; central to fairness and accountability discussions.",
  links: [
    { label: "Wikipedia: Algorithmic Bias", url: "https://en.wikipedia.org/wiki/Algorithmic_bias" },
    { label: "Buolamwini & Gebru - Gender Shades", url: "http://proceedings.mlr.press/v81/buolamwini18a.html" }
  ]
},
"Bias mitigation in machine learning": {
  label: "Bias Mitigation in Machine Learning",
  summary: "Technical and procedural approaches to reducing or eliminating unfair bias in machine learning systems. Mitigation strategies operate at three stages: pre-processing (rebalancing or transforming training data), in-processing (adding fairness constraints during model training), and post-processing (adjusting model outputs to satisfy fairness criteria). While significant progress has been made, research shows that bias mitigation often involves tradeoffs between different fairness metrics and between fairness and overall accuracy.",
  example: "A node evaluates pre-processing versus in-processing debiasing techniques for their effectiveness and side effects.",
  frequency: "Cross-cutting and safetyist nodes; relevant to governance and fairness discussions.",
  links: [
    { label: "IBM AI Fairness 360", url: "https://aif360.mybluemix.net/" },
    { label: "Wikipedia: Fairness in ML", url: "https://en.wikipedia.org/wiki/Fairness_(machine_learning)" }
  ]
},
"Big Data paradigm": {
  label: "Big Data Paradigm",
  summary: "The approach to knowledge generation and decision-making based on collecting and analyzing massive datasets, characterized by the \'three Vs\' — volume, velocity, and variety. The Big Data paradigm underpins modern AI by providing the training data that makes large-scale machine learning possible. In AI policy, it raises concerns about privacy, surveillance, data ownership, consent, and the assumption that more data always leads to better or fairer outcomes.",
  example: "A node critiques the Big Data paradigm\'s assumption that scale compensates for bias in training data.",
  frequency: "Cross-cutting nodes; discussed in all POVs regarding data-driven approaches to AI.",
  links: [
    { label: "Wikipedia: Big Data", url: "https://en.wikipedia.org/wiki/Big_data" },
    { label: "Boyd & Crawford - Critical Questions for Big Data", url: "https://doi.org/10.1080/1369118X.2012.678878" }
  ]
},
"Big Science projects": {
  label: "Big Science Projects",
  summary: "Large-scale, resource-intensive scientific endeavors requiring significant institutional coordination, such as the Manhattan Project, CERN, the Human Genome Project, and increasingly large AI model training runs. The Big Science model is relevant to AI policy because frontier AI development increasingly resembles Big Science in its capital requirements, team sizes, and infrastructure needs. This raises questions about whether AI research is becoming accessible only to well-funded institutions, and whether Big Science governance models should apply.",
  example: "A node compares frontier AI lab compute budgets to historical Big Science projects to argue for public funding and oversight.",
  frequency: "Cross-cutting and accelerationist nodes discussing research organization and access.",
  links: [
    { label: "Wikipedia: Big Science", url: "https://en.wikipedia.org/wiki/Big_science" },
    { label: "BigScience Workshop (LLM)", url: "https://bigscience.huggingface.co/" }
  ]
},
"biosecurity frameworks": {
  label: "Biosecurity Frameworks",
  summary: "Governance structures and protocols designed to prevent the misuse of biological research and materials, including the Biological Weapons Convention, institutional biosafety committees, and dual-use research oversight policies. In AI policy, biosecurity frameworks serve as both analogies and direct concerns: analogies for how to govern dual-use AI research, and direct concerns because AI systems may lower barriers to creating dangerous biological agents. The biosecurity community\'s experience with information hazards and responsible disclosure informs AI governance thinking.",
  example: "A node proposes applying biosecurity-style oversight to AI capabilities that could assist in creating biological weapons.",
  frequency: "Safetyist and cross-cutting nodes; referenced in dual-use technology discussions.",
  links: [
    { label: "Wikipedia: Biosecurity", url: "https://en.wikipedia.org/wiki/Biosecurity" },
    { label: "Johns Hopkins Center for Health Security", url: "https://centerforhealthsecurity.org/" }
  ]
},
"Biosecurity protocols": {
  label: "Biosecurity Protocols",
  summary: "Specific procedural and technical measures implemented to prevent unauthorized access to, or misuse of, dangerous biological agents and knowledge. Protocols include personnel screening, physical containment, access controls, and responsible disclosure practices for dual-use research. In AI policy, biosecurity protocols are cited as models for managing AI capabilities that could enable bioweapons development, with some advocating for similar tiered access controls based on assessed risk.",
  example: "A node recommends that AI models capable of assisting in pathogen design be subject to biosecurity-level access controls.",
  frequency: "Safetyist and cross-cutting nodes discussing catastrophic risk prevention.",
  links: [
    { label: "Wikipedia: Biosafety Level", url: "https://en.wikipedia.org/wiki/Biosafety_level" },
    { label: "WHO Biosafety Manual", url: "https://www.who.int/publications/i/item/9789240011311" }
  ]
},
"Black box problem": {
  label: "Black Box Problem",
  summary: "The challenge that many modern AI systems, particularly deep neural networks, produce outputs through processes that are opaque to human understanding. The black box problem means that users, developers, and regulators often cannot explain why a specific decision was made, making it difficult to verify fairness, identify errors, or assign accountability. This opacity is particularly problematic in high-stakes domains where explanations are legally required or ethically essential.",
  example: "A node argues that the black box nature of deep learning models makes them unsuitable for criminal sentencing decisions.",
  frequency: "Cross-cutting and safetyist nodes extensively; all POVs engage with interpretability tradeoffs.",
  links: [
    { label: "Wikipedia: Black Box", url: "https://en.wikipedia.org/wiki/Black_box" },
    { label: "Rudin - Stop Explaining Black Box Models", url: "https://doi.org/10.1038/s42256-019-0048-x" }
  ]
},
"Bostrom existential risk framework": {
  label: "Bostrom Existential Risk Framework",
  summary: "Nick Bostrom\'s analytical framework for categorizing and evaluating existential risks — threats that could permanently curtail humanity\'s potential or cause extinction. Bostrom\'s framework, developed at the Future of Humanity Institute, categorizes risks by scope (personal to global), severity (imperceptible to terminal), and probability. Applied to AI, it provides the intellectual foundation for treating advanced AI as a potential existential threat requiring proactive governance, a view central to the AI safety movement.",
  example: "A node uses Bostrom\'s framework to classify unaligned superintelligence as a global, terminal-severity risk.",
  frequency: "Safetyist nodes centrally; cross-cutting nodes engage with the framework; skeptic nodes often critique it.",
  links: [
    { label: "Wikipedia: Nick Bostrom", url: "https://en.wikipedia.org/wiki/Nick_Bostrom" },
    { label: "Bostrom: Superintelligence", url: "https://en.wikipedia.org/wiki/Superintelligence:_Paths,_Dangers,_Strategies" },
    { label: "Existential Risk - FHI", url: "https://existential-risk.org/" }
  ]
},
"Bounded rationality": {
  label: "Bounded Rationality",
  summary: "Herbert Simon\'s concept that human decision-making is constrained by limited information, cognitive capacity, and time, leading people to \'satisfice\' (choose good-enough options) rather than optimize. In AI policy, bounded rationality is relevant in two ways: it explains why human oversight of AI systems may be unreliable (overseers face cognitive limits), and it informs how AI systems should be designed to support rather than overwhelm human decision-makers. It also challenges assumptions that AI governance can be fully rational.",
  example: "A node argues that AI governance frameworks must account for bounded rationality of regulators reviewing complex systems.",
  frequency: "Cross-cutting nodes; relevant to discussions of human oversight and decision support.",
  links: [
    { label: "Wikipedia: Bounded Rationality", url: "https://en.wikipedia.org/wiki/Bounded_rationality" },
    { label: "Simon: Models of Bounded Rationality", url: "https://en.wikipedia.org/wiki/Herbert_A._Simon" }
  ]
},
"Carbon footprint analysis": {
  label: "Carbon Footprint Analysis",
  summary: "The measurement and assessment of greenhouse gas emissions associated with a product, process, or organization. Applied to AI, carbon footprint analysis examines the energy consumption and emissions from training large models, running inference at scale, manufacturing specialized hardware, and operating data centers. Studies have shown that training a single large language model can emit hundreds of tons of CO2 equivalent, raising questions about the environmental sustainability of scaling AI development.",
  example: "A node quantifies the carbon emissions of training frontier models to argue for environmental impact assessments in AI governance.",
  frequency: "Cross-cutting and skeptic nodes; relevant to sustainability-oriented policy discussions.",
  links: [
    { label: "Wikipedia: Carbon Footprint", url: "https://en.wikipedia.org/wiki/Carbon_footprint" },
    { label: "Strubell et al. - Energy and Policy Considerations for NLP", url: "https://arxiv.org/abs/1906.02243" }
  ]
},
"Classical economics": {
  label: "Classical Economics",
  summary: "The economic tradition originating with Adam Smith, David Ricardo, and John Stuart Mill that emphasizes free markets, division of labor, comparative advantage, and limited government intervention. In AI policy, classical economic arguments support the view that market competition and price signals will efficiently allocate AI resources and direct innovation toward socially valuable applications. Critics argue that AI markets exhibit market failures — externalities, information asymmetries, and public goods characteristics — that classical economics does not adequately address.",
  example: "A node applies classical economic reasoning to argue that AI regulation will create deadweight losses that outweigh safety benefits.",
  frequency: "Accelerationist and skeptic nodes; critiqued in cross-cutting governance discussions.",
  links: [
    { label: "Wikipedia: Classical Economics", url: "https://en.wikipedia.org/wiki/Classical_economics" },
    { label: "Wikipedia: Adam Smith", url: "https://en.wikipedia.org/wiki/Adam_Smith" }
  ]
},
"Cognitive computing vision": {
  label: "Cognitive Computing Vision",
  summary: "The vision of computing systems that simulate human thought processes to solve complex problems, associated primarily with IBM\'s Watson initiative and related industry programs. Cognitive computing emphasizes natural language processing, machine learning, and human-computer interaction to create systems that augment human reasoning. While somewhat eclipsed by the generative AI paradigm, this vision influenced enterprise AI strategy and policy discussions about how to frame AI as an augmentation tool rather than a replacement for human cognition.",
  example: "A node traces the evolution from IBM\'s cognitive computing framing to current foundation model paradigms.",
  frequency: "Cross-cutting and accelerationist nodes discussing industry AI visions and their policy implications.",
  links: [
    { label: "Wikipedia: Cognitive Computing", url: "https://en.wikipedia.org/wiki/Cognitive_computing" },
    { label: "IBM Watson", url: "https://en.wikipedia.org/wiki/IBM_Watson" }
  ]
},
"Cognitive ergonomics": {
  label: "Cognitive Ergonomics",
  summary: "The study of how system design affects human cognitive processes including perception, memory, reasoning, and decision-making in human-machine interaction contexts. In AI policy, cognitive ergonomics informs how AI interfaces should be designed to support effective human oversight rather than inducing automation bias, information overload, or decision fatigue. Good cognitive ergonomics in AI systems helps ensure that human-in-the-loop requirements are meaningful rather than performative.",
  example: "A node applies cognitive ergonomics principles to argue that AI alerting systems must be designed to avoid alarm fatigue.",
  frequency: "Cross-cutting nodes discussing human-AI interaction; safetyist nodes addressing oversight design.",
  links: [
    { label: "Wikipedia: Cognitive Ergonomics", url: "https://en.wikipedia.org/wiki/Cognitive_ergonomics" },
    { label: "International Ergonomics Association", url: "https://iea.cc/" }
  ]
},
"Cognitive psychology": {
  label: "Cognitive Psychology",
  summary: "The scientific study of mental processes including attention, perception, memory, reasoning, and problem-solving. Cognitive psychology provides foundational understanding of human cognitive capabilities and limitations that is directly relevant to AI policy: it informs how humans interact with and oversee AI systems, what cognitive biases affect AI-related decision-making, and how AI capabilities compare to human cognition. The field also influences AI system design through cognitive architectures and models of human reasoning.",
  example: "A node draws on cognitive psychology research to explain why users overtrust AI outputs that are confidently presented.",
  frequency: "Cross-cutting nodes extensively; relevant to all POVs discussing human-AI interaction.",
  links: [
    { label: "Wikipedia: Cognitive Psychology", url: "https://en.wikipedia.org/wiki/Cognitive_psychology" },
    { label: "APA: Cognitive Psychology", url: "https://www.apa.org/topics/cognitive-psychology" }
  ]
},
"Cognitive science": {
  label: "Cognitive Science",
  summary: "The interdisciplinary study of mind and intelligence, drawing on psychology, neuroscience, linguistics, philosophy, computer science, and anthropology. Cognitive science informs AI research through theories of learning, representation, and reasoning, and provides frameworks for evaluating whether AI systems truly understand or merely pattern-match. In AI policy, cognitive science perspectives help assess claims about AI capabilities, set appropriate expectations, and design effective human-AI collaboration.",
  example: "A node uses cognitive science research on analogy and abstraction to evaluate whether LLMs exhibit genuine understanding.",
  frequency: "Cross-cutting and skeptic nodes; relevant to discussions of AI capabilities and limitations.",
  links: [
    { label: "Wikipedia: Cognitive Science", url: "https://en.wikipedia.org/wiki/Cognitive_science" },
    { label: "Cognitive Science Society", url: "https://cognitivesciencesociety.org/" }
  ]
},
"cognitive science (common sense reasoning)": {
  label: "Cognitive Science (Common Sense Reasoning)",
  summary: "The study within cognitive science of how humans effortlessly apply everyday knowledge about the physical and social world to interpret situations and make inferences. Common sense reasoning remains one of AI\'s most persistent challenges — systems that perform well on narrow benchmarks often fail on tasks requiring basic world knowledge. This gap is significant for AI policy because it means current AI systems may produce plausible-sounding but fundamentally nonsensical outputs in situations requiring everyday understanding.",
  example: "A node cites failures in common sense reasoning to argue that LLMs should not be trusted for autonomous decision-making.",
  frequency: "Skeptic and cross-cutting nodes; safetyist nodes discussing capability limitations.",
  links: [
    { label: "Wikipedia: Commonsense Reasoning", url: "https://en.wikipedia.org/wiki/Commonsense_reasoning" },
    { label: "Davis & Marcus - Commonsense Reasoning and AI", url: "https://doi.org/10.1145/3404835.3462788" }
  ]
},
"Cognitive science (learning and reasoning)": {
  label: "Cognitive Science (Learning and Reasoning)",
  summary: "Research within cognitive science on how humans acquire knowledge and apply logical and analogical reasoning, and how these processes compare to machine learning approaches. This includes studies of inductive learning, causal reasoning, transfer learning, and the development of expertise. For AI policy, understanding the differences between human and machine learning is essential for setting realistic expectations about AI capabilities and designing appropriate oversight mechanisms.",
  example: "A node contrasts human few-shot learning with AI\'s data-hungry approach to argue that AI understanding is fundamentally different.",
  frequency: "Cross-cutting and skeptic nodes; relevant to AI capability assessment discussions.",
  links: [
    { label: "Wikipedia: Cognitive Science", url: "https://en.wikipedia.org/wiki/Cognitive_science" },
    { label: "Lake et al. - Building Machines That Learn and Think Like People", url: "https://arxiv.org/abs/1604.00289" }
  ]
},
"Cold War historiography": {
  label: "Cold War Historiography",
  summary: "The scholarly study and interpretation of the Cold War period, including its dynamics of superpower competition, technological arms races, deterrence theory, and institutional evolution. In AI policy, Cold War historiography provides analogies for understanding US-China AI competition, the risks of technological arms races, and the potential for both conflict escalation and cooperative frameworks. Historical lessons about how arms control agreements were achieved despite deep distrust inform proposals for international AI governance.",
  example: "A node draws parallels between Cold War nuclear arms control negotiations and proposed international AI governance treaties.",
  frequency: "Cross-cutting and safetyist nodes discussing geopolitical AI competition.",
  links: [
    { label: "Wikipedia: Cold War", url: "https://en.wikipedia.org/wiki/Cold_War" },
    { label: "Wikipedia: Arms Control", url: "https://en.wikipedia.org/wiki/Arms_control" }
  ]
},
"Commons-based peer production": {
  label: "Commons-Based Peer Production",
  summary: "A model of collaborative production where large numbers of individuals contribute to shared projects without traditional hierarchical organization or market-based incentives, exemplified by Wikipedia, Linux, and open-source software. Coined by Yochai Benkler, this concept is relevant to AI policy because it offers an alternative to corporate-dominated AI development: open-source AI models, shared datasets, and collaborative research could democratize access to AI capabilities and reduce concentration of power.",
  example: "A node advocates for commons-based AI development as an alternative to proprietary foundation models controlled by a few corporations.",
  frequency: "Cross-cutting and accelerationist nodes discussing open-source AI and democratization.",
  links: [
    { label: "Wikipedia: Commons-Based Peer Production", url: "https://en.wikipedia.org/wiki/Commons-based_peer_production" },
    { label: "Benkler: The Wealth of Networks", url: "https://en.wikipedia.org/wiki/The_Wealth_of_Networks" }
  ]
},
"Complexity theory (broadly interpreted)": {
  label: "Complexity Theory (Broadly Interpreted)",
  summary: "The study of complex adaptive systems that exhibit emergent behavior, self-organization, and nonlinear dynamics, drawn from fields including physics, biology, economics, and computer science. Applied broadly to AI policy, complexity theory suggests that AI systems embedded in social-technical systems may produce emergent effects that cannot be predicted from analyzing individual components. This perspective challenges reductive approaches to AI governance and argues for adaptive, systems-level thinking about AI\'s societal impacts.",
  example: "A node uses complexity theory to argue that AI\'s societal effects are emergent and cannot be fully anticipated by pre-deployment testing.",
  frequency: "Cross-cutting nodes; skeptic nodes discussing unpredictability of technological change.",
  links: [
    { label: "Wikipedia: Complex Systems", url: "https://en.wikipedia.org/wiki/Complex_system" },
    { label: "Santa Fe Institute", url: "https://www.santafe.edu/" }
  ]
},
"Computer virus/worm propagation models": {
  label: "Computer Virus/Worm Propagation Models",
  summary: "Mathematical and computational models describing how malicious software spreads through networks, drawing on epidemiological models and network science. These models are relevant to AI safety as analogies for how AI-enabled threats could propagate and for understanding the vulnerability of interconnected AI systems. They also inform risk assessment for autonomous AI agents that could replicate, spread, or recruit resources across networked systems.",
  example: "A node uses worm propagation models to analyze how a compromised AI agent could spread across cloud infrastructure.",
  frequency: "Safetyist and cross-cutting nodes discussing AI-enabled cybersecurity threats.",
  links: [
    { label: "Wikipedia: Computer Worm", url: "https://en.wikipedia.org/wiki/Computer_worm" },
    { label: "Wikipedia: Epidemiological Modeling", url: "https://en.wikipedia.org/wiki/Compartmental_models_in_epidemiology" }
  ]
},
"Conspiracy theories (in its extreme framing of motives)": {
  label: "Conspiracy Theories (Extreme Framing of Motives)",
  summary: "The tendency in some AI policy discourse to attribute malicious, coordinated intent to groups of actors without sufficient evidence, mirroring the structure of conspiracy thinking. This can manifest as claims that AI labs are deliberately creating dangerous systems for profit, that safety researchers are secretly trying to monopolize AI, or that governments are using AI governance as a pretense for authoritarian control. Recognizing conspiratorial framing helps maintain productive debate by distinguishing legitimate criticism from unfounded attributions of motive.",
  example: "A node flags conspiratorial reasoning when a POV attributes coordinated bad faith to all actors in a competing camp.",
  frequency: "Cross-cutting and skeptic nodes analyzing discourse quality across AI policy debates.",
  links: [
    { label: "Wikipedia: Conspiracy Theory", url: "https://en.wikipedia.org/wiki/Conspiracy_theory" },
    { label: "Sunstein & Vermeule - Conspiracy Theories", url: "https://doi.org/10.1017/S0047279409990353" }
  ]
},
"consumer protection advocacy": {
  label: "Consumer Protection Advocacy",
  summary: "Advocacy efforts aimed at protecting consumers from harmful, deceptive, or unfair business practices, extended to the AI domain to address issues like algorithmic discrimination, dark patterns, data exploitation, and undisclosed AI-generated content. Consumer protection advocates argue that existing consumer protection frameworks must be updated to address AI-specific harms and that AI companies should bear responsibility for the impacts of their systems on end users. This perspective emphasizes the power asymmetry between AI providers and individual consumers.",
  example: "A node advocates for extending product liability law to hold AI developers responsible for harmful outputs.",
  frequency: "Cross-cutting and safetyist nodes; relevant to governance and accountability discussions.",
  links: [
    { label: "Wikipedia: Consumer Protection", url: "https://en.wikipedia.org/wiki/Consumer_protection" },
    { label: "FTC: AI and Consumer Protection", url: "https://www.ftc.gov/business-guidance/blog/2023/02/keep-your-ai-claims-check" }
  ]
},
"consumer protection law": {
  label: "Consumer Protection Law",
  summary: "Legal frameworks that protect consumers from unfair, deceptive, or harmful business practices, including warranty law, product liability, truth-in-advertising requirements, and data protection regulations. Applying consumer protection law to AI raises novel questions about product liability for AI-generated outputs, disclosure requirements for AI-assisted decisions, and the applicability of existing frameworks to intangible AI services. These legal tools offer a more immediate path to AI accountability than new AI-specific legislation.",
  example: "A node analyzes whether existing product liability law can hold AI developers accountable for system failures.",
  frequency: "Cross-cutting nodes; relevant to governance discussions about leveraging existing legal frameworks.",
  links: [
    { label: "Wikipedia: Consumer Protection", url: "https://en.wikipedia.org/wiki/Consumer_protection" },
    { label: "Wikipedia: Product Liability", url: "https://en.wikipedia.org/wiki/Product_liability" }
  ]
},
"Containment strategies in cybersecurity": {
  label: "Containment Strategies in Cybersecurity",
  summary: "Security approaches that limit the damage from a breach by isolating compromised systems, restricting lateral movement, and preventing data exfiltration. Common strategies include network segmentation, zero-trust architecture, sandboxing, and microsegmentation. In AI safety, cybersecurity containment strategies inform discussions about how to restrict the capabilities and access of AI systems, though the analogy has limits because a sufficiently capable AI may find ways to circumvent containment through social engineering or exploitation of side channels.",
  example: "A node proposes applying zero-trust principles to AI system deployment, restricting capabilities to minimum necessary access.",
  frequency: "Safetyist and cross-cutting nodes discussing AI control and containment.",
  links: [
    { label: "Wikipedia: Network Segmentation", url: "https://en.wikipedia.org/wiki/Network_segmentation" },
    { label: "NIST Zero Trust Architecture", url: "https://csrc.nist.gov/publications/detail/sp/800-207/final" }
  ]
},
"Control problem in AI": {
  label: "Control Problem in AI",
  summary: "The challenge of ensuring that advanced AI systems remain under meaningful human control, encompassing the ability to direct, correct, constrain, and if necessary shut down AI systems. The control problem is distinct from but related to the alignment problem: even a well-aligned system may pose control challenges if its operators cannot understand its reasoning or predict its behavior. As AI systems gain more autonomy and capability, the control problem becomes increasingly urgent and technically difficult.",
  example: "A node frames the control problem as the central challenge for AI governance that must be solved before deploying highly autonomous systems.",
  frequency: "Safetyist nodes centrally; discussed across all POVs with varying urgency.",
  links: [
    { label: "Wikipedia: AI Control Problem", url: "https://en.wikipedia.org/wiki/AI_control_problem" },
    { label: "Russell: Human Compatible", url: "https://en.wikipedia.org/wiki/Human_Compatible" }
  ]
},
"Control problem in cybernetics": {
  label: "Control Problem in Cybernetics",
  summary: "The foundational challenge in cybernetics of how a system can be regulated and directed toward desired states through feedback mechanisms. Norbert Wiener\'s original cybernetic control problem examined how information feedback loops enable systems to self-correct and maintain stability. In AI discourse, the cybernetic control problem provides historical and theoretical context for the modern AI control problem, highlighting that challenges of controlling complex systems predate AI and have deep roots in control theory and systems engineering.",
  example: "A node traces the lineage from Wiener\'s cybernetic control problem to contemporary AI alignment challenges.",
  frequency: "Cross-cutting nodes providing historical context for AI control discussions.",
  links: [
    { label: "Wikipedia: Cybernetics", url: "https://en.wikipedia.org/wiki/Cybernetics" },
    { label: "Wiener: Cybernetics", url: "https://en.wikipedia.org/wiki/Cybernetics:_Or_Control_and_Communication_in_the_Animal_and_the_Machine" }
  ]
},
"Control theory": {
  label: "Control Theory",
  summary: "The mathematical and engineering discipline concerned with designing systems that regulate themselves or other systems through feedback, achieving desired performance despite disturbances and uncertainties. Control theory provides formal tools — stability analysis, feedback controllers, observers, and robust control methods — that inform AI safety research on maintaining desired AI behavior. The field offers both useful analogies and concrete technical approaches for ensuring AI systems remain within safe operating boundaries.",
  example: "A node applies Lyapunov stability analysis concepts to argue for formal verification of AI system safety properties.",
  frequency: "Safetyist and cross-cutting nodes; relevant to technical safety discussions.",
  links: [
    { label: "Wikipedia: Control Theory", url: "https://en.wikipedia.org/wiki/Control_theory" },
    { label: "Astrom & Murray: Feedback Systems", url: "https://www.cds.caltech.edu/~murray/amwiki/index.php/Main_Page" }
  ]
},
"Copyright law principles": {
  label: "Copyright Law Principles",
  summary: "Legal frameworks governing the protection of original creative works, including issues of authorship, fair use, derivative works, and licensing. AI has created profound challenges for copyright law: questions about whether AI-generated content is copyrightable, whether training on copyrighted material constitutes fair use, and who owns the outputs of AI systems. These legal debates have significant implications for AI business models, the training data ecosystem, and the rights of human creators whose work feeds AI systems.",
  example: "A node analyzes whether training AI models on copyrighted text without permission constitutes fair use under US copyright law.",
  frequency: "Cross-cutting nodes; relevant to all POVs discussing AI\'s impact on creative industries.",
  links: [
    { label: "Wikipedia: Copyright", url: "https://en.wikipedia.org/wiki/Copyright" },
    { label: "US Copyright Office: AI and Copyright", url: "https://www.copyright.gov/ai/" }
  ]
},
"Cornucopianism": {
  label: "Cornucopianism",
  summary: "The optimistic worldview that human ingenuity and technological progress will overcome resource scarcity, environmental limits, and other constraints on growth. In AI policy, cornucopian thinking supports the view that AI will solve problems faster than it creates them — addressing climate change, curing diseases, and enabling abundance. Critics argue that cornucopianism ignores distributional issues, environmental externalities, and the possibility that some technological risks are genuinely existential and cannot be innovated away.",
  example: "A node invokes cornucopianism to argue that AI-driven productivity gains will more than compensate for displacement costs.",
  frequency: "Accelerationist nodes primarily; critiqued in safetyist and skeptic nodes.",
  links: [
    { label: "Wikipedia: Cornucopianism", url: "https://en.wikipedia.org/wiki/Cornucopian" },
    { label: "Wikipedia: Technological Optimism", url: "https://en.wikipedia.org/wiki/Technological_optimism" }
  ]
},
"Cosmic evolution theories": {
  label: "Cosmic Evolution Theories",
  summary: "Theoretical frameworks positioning intelligence and technology as part of a grand evolutionary trajectory from simple matter to complex, self-aware systems. These theories, associated with thinkers like Teilhard de Chardin, Ray Kurzweil, and various transhumanists, view AI as the next stage in cosmic evolution — potentially leading to superintelligence that transforms the universe. In AI policy, these perspectives provide philosophical grounding for arguments that AI development is inevitable and should be embraced as part of humanity\'s cosmic purpose.",
  example: "A node frames superintelligence as the inevitable next stage of cosmic evolution, beyond human control or moral objection.",
  frequency: "Accelerationist nodes; critiqued in skeptic and safetyist nodes as unfalsifiable teleology.",
  links: [
    { label: "Wikipedia: Cosmic Evolution", url: "https://en.wikipedia.org/wiki/Cosmic_evolution" },
    { label: "Kurzweil: The Singularity Is Near", url: "https://en.wikipedia.org/wiki/The_Singularity_Is_Near" }
  ]
},
"Cosmic evolution theory": {
  label: "Cosmic Evolution Theory",
  summary: "Theoretical frameworks positioning intelligence and technology as part of a grand evolutionary trajectory from simple matter to complex, self-aware systems. These theories, associated with thinkers like Teilhard de Chardin, Ray Kurzweil, and various transhumanists, view AI as the next stage in cosmic evolution — potentially leading to superintelligence that transforms the universe. In AI policy, these perspectives provide philosophical grounding for arguments that AI development is inevitable and should be embraced as part of humanity\'s cosmic purpose.",
  example: "A node frames superintelligence as the inevitable next stage of cosmic evolution, beyond human control or moral objection.",
  frequency: "Accelerationist nodes; critiqued in skeptic and safetyist nodes as unfalsifiable teleology.",
  links: [
    { label: "Wikipedia: Cosmic Evolution", url: "https://en.wikipedia.org/wiki/Cosmic_evolution" },
    { label: "Kurzweil: The Singularity Is Near", url: "https://en.wikipedia.org/wiki/The_Singularity_Is_Near" }
  ]
},
"Critical Race Theory (applied to tech)": {
  label: "Critical Race Theory (Applied to Tech)",
  summary: "The application of Critical Race Theory\'s analytical frameworks to technology design, deployment, and governance, examining how racial hierarchies are embedded in and reproduced by technical systems. This perspective analyzes how AI systems perpetuate racial bias through training data reflecting historical discrimination, how technology design choices reflect the demographics and assumptions of their creators, and how algorithmic decision-making can systematize racial disparities at scale. Scholars like Ruha Benjamin and Safiya Noble have been influential in this space.",
  example: "A node applies CRT to show how predictive policing algorithms encode historical patterns of racially biased enforcement.",
  frequency: "Cross-cutting and safetyist nodes; some skeptic nodes critique the framework\'s applicability to technical systems.",
  links: [
    { label: "Wikipedia: Critical Race Theory", url: "https://en.wikipedia.org/wiki/Critical_race_theory" },
    { label: "Benjamin: Race After Technology", url: "https://en.wikipedia.org/wiki/Race_After_Technology" },
    { label: "Noble: Algorithms of Oppression", url: "https://en.wikipedia.org/wiki/Algorithms_of_Oppression" }
  ]
},
"Critical race theory in tech": {
  label: "Critical Race Theory in Tech",
  summary: "The application of Critical Race Theory\'s analytical frameworks to technology design, deployment, and governance, examining how racial hierarchies are embedded in and reproduced by technical systems. This perspective analyzes how AI systems perpetuate racial bias through training data reflecting historical discrimination, how technology design choices reflect the demographics and assumptions of their creators, and how algorithmic decision-making can systematize racial disparities at scale. Scholars like Ruha Benjamin and Safiya Noble have been influential in this space.",
  example: "A node applies CRT to show how predictive policing algorithms encode historical patterns of racially biased enforcement.",
  frequency: "Cross-cutting and safetyist nodes; some skeptic nodes critique the framework\'s applicability to technical systems.",
  links: [
    { label: "Wikipedia: Critical Race Theory", url: "https://en.wikipedia.org/wiki/Critical_race_theory" },
    { label: "Benjamin: Race After Technology", url: "https://en.wikipedia.org/wiki/Race_After_Technology" }
  ]
},
"Critical technology studies": {
  label: "Critical Technology Studies",
  summary: "An interdisciplinary field that examines technology as a social and political phenomenon rather than a neutral tool, drawing on science and technology studies (STS), sociology, and critical theory. Critical technology studies analyzes how power relations, cultural values, and economic interests shape which technologies are developed, how they are designed, and who benefits from them. Applied to AI, this perspective challenges techno-solutionist narratives and examines how AI reflects and reinforces existing social structures.",
  example: "A node uses critical technology studies to argue that AI is not a neutral tool but embeds the values of its creators.",
  frequency: "Cross-cutting and skeptic nodes; challenges assumptions in accelerationist framings.",
  links: [
    { label: "Wikipedia: Science and Technology Studies", url: "https://en.wikipedia.org/wiki/Science_and_technology_studies" },
    { label: "Winner: Do Artifacts Have Politics?", url: "https://en.wikipedia.org/wiki/Do_Artifacts_Have_Politics%3F" }
  ]
},
"Critical theory": {
  label: "Critical Theory",
  summary: "A philosophical and social science tradition originating in the Frankfurt School that examines how power structures, ideology, and social institutions perpetuate domination and inequality. Critical theory applied to AI interrogates who controls AI development, whose interests AI serves, how AI systems reproduce existing power asymmetries, and how technocratic AI governance may depoliticize inherently political questions. This tradition emphasizes that technology is never neutral and that claims of objectivity in AI systems often mask particular interests.",
  example: "A node applies critical theory to argue that \'AI for good\' narratives obscure the commercial interests driving AI development.",
  frequency: "Cross-cutting and skeptic nodes; provides analytical framework for questioning dominant AI narratives.",
  links: [
    { label: "Wikipedia: Critical Theory", url: "https://en.wikipedia.org/wiki/Critical_theory" },
    { label: "Stanford Encyclopedia: Critical Theory", url: "https://plato.stanford.edu/entries/critical-theory/" }
  ]
},
"Critiques of moral panics": {
  label: "Critiques of Moral Panics",
  summary: "Sociological analyses of how societies generate disproportionate fear and anxiety about perceived threats, often driven by media amplification, political opportunism, and cultural anxieties rather than objective evidence. In AI policy, this framework is used to argue that fears about AI — particularly existential risk scenarios — may constitute a moral panic that diverts attention from more concrete, present harms. Critics of this position counter that dismissing AI risks as moral panic may itself be a form of complacency.",
  example: "A node characterizes AI existential risk discourse as a moral panic distracting from bias, labor, and surveillance harms.",
  frequency: "Skeptic nodes primarily; debated in cross-cutting nodes examining discourse quality.",
  links: [
    { label: "Wikipedia: Moral Panic", url: "https://en.wikipedia.org/wiki/Moral_panic" },
    { label: "Cohen: Folk Devils and Moral Panics", url: "https://en.wikipedia.org/wiki/Folk_Devils_and_Moral_Panics" }
  ]
},
"Cryptography community (Kerckhoffs's Principle)": {
  label: "Cryptography Community (Kerckhoffs\'s Principle)",
  summary: "Kerckhoffs\'s Principle states that a cryptographic system should be secure even if everything about the system, except the key, is public knowledge. This principle from the cryptography community is applied to AI governance to argue for security through transparency rather than obscurity — that AI safety mechanisms should not depend on keeping system architectures secret. It supports open-sourcing AI models and safety research, contending that relying on secrecy for safety is fundamentally fragile.",
  example: "A node invokes Kerckhoffs\'s Principle to argue that AI safety mechanisms should remain effective even if model architecture is public.",
  frequency: "Cross-cutting nodes; relevant to debates about open-source AI and security through transparency.",
  links: [
    { label: "Wikipedia: Kerckhoffs\'s Principle", url: "https://en.wikipedia.org/wiki/Kerckhoffs%27s_principle" },
    { label: "Wikipedia: Security Through Obscurity", url: "https://en.wikipedia.org/wiki/Security_through_obscurity" }
  ]
},
"cybernetics": {
  label: "Cybernetics",
  summary: "The interdisciplinary study of regulatory and communication systems in animals, machines, and organizations, founded by Norbert Wiener in the 1940s. Cybernetics introduced foundational concepts including feedback loops, homeostasis, self-regulation, and information theory that directly influenced the development of AI, control systems, and cognitive science. In AI policy, cybernetic thinking informs discussions about system stability, feedback-based governance, and the challenges of controlling complex adaptive systems.",
  example: "A node draws on cybernetic concepts of feedback and stability to propose self-regulating AI governance mechanisms.",
  frequency: "Cross-cutting nodes providing theoretical foundations; referenced in safetyist and accelerationist discussions.",
  links: [
    { label: "Wikipedia: Cybernetics", url: "https://en.wikipedia.org/wiki/Cybernetics" },
    { label: "Wiener: Cybernetics", url: "https://en.wikipedia.org/wiki/Cybernetics:_Or_Control_and_Communication_in_the_Animal_and_the_Machine" }
  ]
},
"Cybernetics": {
  label: "Cybernetics",
  summary: "The interdisciplinary study of regulatory and communication systems in animals, machines, and organizations, founded by Norbert Wiener in the 1940s. Cybernetics introduced foundational concepts including feedback loops, homeostasis, self-regulation, and information theory that directly influenced the development of AI, control systems, and cognitive science. In AI policy, cybernetic thinking informs discussions about system stability, feedback-based governance, and the challenges of controlling complex adaptive systems.",
  example: "A node draws on cybernetic concepts of feedback and stability to propose self-regulating AI governance mechanisms.",
  frequency: "Cross-cutting nodes providing theoretical foundations; referenced in safetyist and accelerationist discussions.",
  links: [
    { label: "Wikipedia: Cybernetics", url: "https://en.wikipedia.org/wiki/Cybernetics" },
    { label: "Wiener: Cybernetics", url: "https://en.wikipedia.org/wiki/Cybernetics:_Or_Control_and_Communication_in_the_Animal_and_the_Machine" }
  ]
},
"Cybernetics (as a metaphor for markets)": {
  label: "Cybernetics (As a Metaphor for Markets)",
  summary: "The application of cybernetic concepts — feedback loops, self-regulation, information processing — as a metaphor for understanding how markets function as decentralized control systems. This framing, influenced by Hayek\'s view of prices as information signals, positions free markets as cybernetic systems that self-correct more efficiently than centralized planning. In AI policy, this metaphor supports arguments that market dynamics will self-regulate AI development without top-down governance intervention.",
  example: "A node uses the cybernetic market metaphor to argue that consumer choice and competitive pressure will steer AI toward safety.",
  frequency: "Accelerationist and skeptic nodes; critiqued in cross-cutting nodes discussing market failures.",
  links: [
    { label: "Wikipedia: Cybernetics", url: "https://en.wikipedia.org/wiki/Cybernetics" },
    { label: "Hayek: The Use of Knowledge in Society", url: "https://en.wikipedia.org/wiki/The_Use_of_Knowledge_in_Society" }
  ]
},
"Cybernetics (control theory)": {
  label: "Cybernetics (Control Theory)",
  summary: "The branch of cybernetics focused specifically on mathematical and engineering approaches to controlling system behavior through feedback mechanisms. This encompasses stability analysis, optimal control, adaptive control, and robust control methods. The control-theoretic aspect of cybernetics directly informs AI safety research on maintaining desired system behavior, designing fail-safe mechanisms, and ensuring that AI systems remain within acceptable operating boundaries despite uncertainties.",
  example: "A node applies control-theoretic stability concepts to analyze whether current AI training methods produce reliably controllable systems.",
  frequency: "Safetyist and cross-cutting nodes discussing formal safety approaches.",
  links: [
    { label: "Wikipedia: Control Theory", url: "https://en.wikipedia.org/wiki/Control_theory" },
    { label: "Wikipedia: Cybernetics", url: "https://en.wikipedia.org/wiki/Cybernetics" }
  ]
},
"Cybernetics (Norbert Wiener)": {
  label: "Cybernetics (Norbert Wiener)",
  summary: "The foundational cybernetics framework developed by mathematician Norbert Wiener, emphasizing the role of feedback, communication, and control in both biological and mechanical systems. Wiener was notably prescient about the risks of autonomous machines, warning in the 1960s that machines given goals without adequate human oversight could pursue those goals in destructive ways. His work anticipated many modern AI safety concerns, including the alignment problem and the importance of maintaining human control over automated systems.",
  example: "A node cites Wiener\'s early warnings about automated goal-pursuit as a precursor to modern AI alignment concerns.",
  frequency: "Cross-cutting and safetyist nodes providing historical context for AI safety.",
  links: [
    { label: "Wikipedia: Norbert Wiener", url: "https://en.wikipedia.org/wiki/Norbert_Wiener" },
    { label: "Wiener: The Human Use of Human Beings", url: "https://en.wikipedia.org/wiki/The_Human_Use_of_Human_Beings" }
  ]
},
"cybersecurity": {
  label: "Cybersecurity",
  summary: "The practice of protecting computer systems, networks, and data from digital attacks, unauthorized access, and damage. AI intersects with cybersecurity in multiple ways: AI tools are used to enhance both offensive and defensive cyber capabilities, AI systems themselves are targets of cyberattack, and AI-enabled cyberattacks may dramatically change the threat landscape. For AI policy, cybersecurity considerations are essential because deployed AI systems create new attack surfaces and because AI capabilities could lower barriers to sophisticated cyberattacks.",
  example: "A node analyzes how LLMs could be used to automate spear-phishing campaigns at unprecedented scale.",
  frequency: "Cross-cutting and safetyist nodes; relevant to all POVs discussing AI risks and capabilities.",
  links: [
    { label: "Wikipedia: Cybersecurity", url: "https://en.wikipedia.org/wiki/Computer_security" },
    { label: "CISA", url: "https://www.cisa.gov/" }
  ]
},
"Cybersecurity (evolution of threats)": {
  label: "Cybersecurity (Evolution of Threats)",
  summary: "The historical pattern of cybersecurity threats evolving in sophistication, from simple viruses to advanced persistent threats, ransomware, and state-sponsored operations. This evolutionary perspective is applied to AI to predict how AI-enabled threats will develop: automated vulnerability discovery, adaptive malware, deepfake-based social engineering, and autonomous cyber weapons. Understanding threat evolution helps AI policy anticipate how adversaries will leverage AI capabilities and design preemptive defensive measures.",
  example: "A node traces the evolution from script kiddies to AI-assisted APTs to argue for proactive AI-cybersecurity regulation.",
  frequency: "Cross-cutting and safetyist nodes discussing emerging threat landscapes.",
  links: [
    { label: "Wikipedia: Advanced Persistent Threat", url: "https://en.wikipedia.org/wiki/Advanced_persistent_threat" },
    { label: "MITRE ATT&CK", url: "https://attack.mitre.org/" }
  ]
},
"Cybersecurity best practices (air-gapping)": {
  label: "Cybersecurity Best Practices (Air-Gapping)",
  summary: "The security practice of physically isolating a computer or network from unsecured networks, particularly the internet, to prevent remote attacks. Air-gapping is often cited in AI safety discussions as a potential containment strategy for powerful AI systems, ensuring they cannot access the internet, communicate with external systems, or exfiltrate data. However, research has demonstrated that air gaps can be bridged through acoustic, electromagnetic, thermal, and other side channels, limiting their reliability against a sufficiently capable adversary.",
  example: "A node evaluates air-gapping as a containment strategy for frontier AI training runs and notes its known limitations.",
  frequency: "Safetyist nodes discussing AI containment; cross-cutting nodes evaluating practical safety measures.",
  links: [
    { label: "Wikipedia: Air Gap (networking)", url: "https://en.wikipedia.org/wiki/Air_gap_(networking)" },
    { label: "NIST Special Publications", url: "https://csrc.nist.gov/publications" }
  ]
},
"Cybersecurity defense strategies": {
  label: "Cybersecurity Defense Strategies",
  summary: "The systematic approaches to protecting systems and data from cyber threats, including defense-in-depth, zero trust architecture, threat intelligence, incident response, and security by design. These strategies inform AI security practices and provide models for AI safety: defense-in-depth suggests layering multiple safety mechanisms, zero trust architecture informs principle-of-least-privilege for AI access, and incident response frameworks apply to AI failure scenarios. The field\'s maturity offers valuable lessons for the nascent AI safety discipline.",
  example: "A node proposes defense-in-depth for AI safety: layering alignment, interpretability, monitoring, and containment.",
  frequency: "Safetyist and cross-cutting nodes discussing practical AI safety implementation.",
  links: [
    { label: "Wikipedia: Defense in Depth (computing)", url: "https://en.wikipedia.org/wiki/Defense_in_depth_(computing)" },
    { label: "NIST Cybersecurity Framework", url: "https://www.nist.gov/cyberframework" }
  ]
},
"Cybersecurity disclosure debates": {
  label: "Cybersecurity Disclosure Debates",
  summary: "The ongoing debate in the cybersecurity community about how and when to disclose security vulnerabilities: full disclosure (immediate public release), responsible disclosure (notification to vendor with a deadline), or non-disclosure. These debates directly inform AI safety discussions about how to handle discovered AI vulnerabilities, capability discoveries, and alignment failures. The parallel helps frame questions about whether AI safety findings should be published openly, shared with affected parties, or kept confidential.",
  example: "A node applies vulnerability disclosure norms to propose a framework for responsibly sharing AI capability evaluations.",
  frequency: "Cross-cutting and safetyist nodes discussing information sharing norms for AI safety.",
  links: [
    { label: "Wikipedia: Responsible Disclosure", url: "https://en.wikipedia.org/wiki/Responsible_disclosure" },
    { label: "Wikipedia: Full Disclosure (security)", url: "https://en.wikipedia.org/wiki/Full_disclosure_(computer_security)" }
  ]
},
"Cybersecurity ethics": {
  label: "Cybersecurity Ethics",
  summary: "The ethical frameworks governing cybersecurity practice, including principles around privacy, proportionality, dual-use research, responsible disclosure, and the balance between security and civil liberties. Cybersecurity ethics directly informs AI ethics through shared concerns about surveillance, offensive capabilities, and the responsibilities of researchers who discover dangerous capabilities. The cybersecurity ethics community\'s experience navigating tensions between security and openness provides valuable precedents for AI governance.",
  example: "A node draws on cybersecurity ethics to discuss whether AI red-teaming results should be published or restricted.",
  frequency: "Cross-cutting and safetyist nodes; relevant to discussions of responsible AI research practices.",
  links: [
    { label: "Wikipedia: Computer Ethics", url: "https://en.wikipedia.org/wiki/Computer_ethics" },
    { label: "ACM Code of Ethics", url: "https://www.acm.org/code-of-ethics" }
  ]
},
"Cybersecurity risk management": {
  label: "Cybersecurity Risk Management",
  summary: "The systematic process of identifying, assessing, and mitigating cybersecurity risks through frameworks like NIST CSF, ISO 27001, and FAIR. Cybersecurity risk management provides mature methodologies for quantifying and prioritizing risks that are being adapted for AI risk management. Key concepts include risk appetite, threat modeling, vulnerability assessment, and continuous monitoring — all applicable to managing AI system risks. The NIST AI Risk Management Framework explicitly builds on cybersecurity risk management foundations.",
  example: "A node proposes adapting the NIST Cybersecurity Framework\'s identify-protect-detect-respond-recover model for AI system risks.",
  frequency: "Cross-cutting and safetyist nodes; foundational to AI governance framework discussions.",
  links: [
    { label: "NIST Cybersecurity Framework", url: "https://www.nist.gov/cyberframework" },
    { label: "Wikipedia: IT Risk Management", url: "https://en.wikipedia.org/wiki/IT_risk_management" }
  ]
},
"cybersecurity threat modeling": {
  label: "Cybersecurity Threat Modeling",
  summary: "The structured process of identifying potential threats to a system, analyzing attack vectors, and prioritizing defensive measures based on assessed risk. Methodologies include STRIDE, PASTA, and attack tree analysis. Applied to AI systems, threat modeling examines how models can be attacked (adversarial inputs, data poisoning, model extraction), who the adversaries are (competitors, nation-states, criminals), and what the consequences of successful attacks would be. Threat modeling for AI extends traditional cybersecurity to include alignment-specific threats.",
  example: "A node applies STRIDE threat modeling to an AI-powered medical diagnosis system to identify safety-critical attack surfaces.",
  frequency: "Safetyist and cross-cutting nodes; practical security-oriented AI safety discussions.",
  links: [
    { label: "Wikipedia: Threat Model", url: "https://en.wikipedia.org/wiki/Threat_model" },
    { label: "OWASP Threat Modeling", url: "https://owasp.org/www-community/Threat_Modeling" }
  ]
},
"Data ethics": {
  label: "Data Ethics",
  summary: "The branch of ethics that addresses the moral implications of collecting, storing, analyzing, and using data, including issues of consent, privacy, ownership, fairness, and transparency. Data ethics is foundational to AI ethics because AI systems depend on data that may be collected without meaningful consent, reflect historical biases, violate privacy expectations, or concentrate power in the hands of data-rich organizations. The field examines both individual data rights and systemic effects of data-driven decision-making.",
  example: "A node raises data ethics concerns about AI training datasets scraped from the internet without individual consent.",
  frequency: "Cross-cutting and safetyist nodes extensively; relevant to all POVs discussing AI development practices.",
  links: [
    { label: "Wikipedia: Information Ethics", url: "https://en.wikipedia.org/wiki/Information_ethics" },
    { label: "ODI Data Ethics Canvas", url: "https://theodi.org/insights/tools/the-data-ethics-canvas/" }
  ]
},
"data ethics research": {
  label: "Data Ethics Research",
  summary: "Academic and applied research examining the ethical dimensions of data practices throughout the data lifecycle — collection, storage, processing, analysis, sharing, and deletion. This research has produced frameworks for ethical data use, identified harms from data exploitation, and informed data protection regulations like GDPR. For AI policy, data ethics research provides empirical evidence and normative frameworks for governing the data supply chain that feeds AI development, including questions about training data consent, privacy, and representation.",
  example: "A node cites data ethics research to argue for mandatory data provenance documentation in AI model training.",
  frequency: "Cross-cutting and safetyist nodes; informs governance discussions about training data practices.",
  links: [
    { label: "Wikipedia: Information Ethics", url: "https://en.wikipedia.org/wiki/Information_ethics" },
    { label: "Floridi & Taddeo - What Is Data Ethics?", url: "https://doi.org/10.1098/rsta.2016.0360" }
  ]
},
"data governance": {
  label: "Data Governance",
  summary: "The overall management of data availability, usability, integrity, and security within an organization or across institutions, encompassing policies, standards, and practices for data handling. In AI contexts, data governance addresses how training data is sourced, curated, documented, and maintained; how data quality affects model performance and fairness; and how data sharing and access controls balance innovation with privacy and security. Effective data governance is a prerequisite for trustworthy AI systems.",
  example: "A node proposes mandatory data governance standards including datasheets for datasets used in training AI models.",
  frequency: "Cross-cutting nodes; relevant to governance discussions across all POVs.",
  links: [
    { label: "Wikipedia: Data Governance", url: "https://en.wikipedia.org/wiki/Data_governance" },
    { label: "Gebru et al. - Datasheets for Datasets", url: "https://arxiv.org/abs/1803.09010" }
  ]
},
"Data integrity principles": {
  label: "Data Integrity Principles",
  summary: "The requirements that data remain accurate, consistent, complete, and unaltered throughout its lifecycle, drawing from database theory, regulatory compliance, and information security. Data integrity is critical for AI because models trained on corrupted, incomplete, or manipulated data will produce unreliable outputs. In AI policy, data integrity principles support requirements for data provenance tracking, tamper detection in training pipelines, and validation of data quality before use in safety-critical AI applications.",
  example: "A node argues that AI systems in healthcare must demonstrate data integrity from source collection through model training.",
  frequency: "Cross-cutting and safetyist nodes; relevant to governance and compliance discussions.",
  links: [
    { label: "Wikipedia: Data Integrity", url: "https://en.wikipedia.org/wiki/Data_integrity" },
    { label: "NIST Data Integrity Resources", url: "https://www.nist.gov/data" }
  ]
},
"Data leakage in neural networks": {
  label: "Data Leakage in Neural Networks",
  summary: "The phenomenon where neural networks inadvertently memorize and can reproduce sensitive information from their training data, including personal data, copyrighted content, or proprietary information. Research has demonstrated that large language models can be prompted to regurgitate verbatim training data, including personally identifiable information. Data leakage poses significant privacy and security risks and challenges the assumption that training data is safely abstracted within model weights.",
  example: "A node cites extraction attacks on LLMs to argue for differential privacy guarantees in model training.",
  frequency: "Safetyist and cross-cutting nodes discussing privacy and security risks of AI models.",
  links: [
    { label: "Carlini et al. - Extracting Training Data from LLMs", url: "https://arxiv.org/abs/2012.07805" },
    { label: "Wikipedia: Machine Learning Privacy", url: "https://en.wikipedia.org/wiki/Machine_learning#Privacy" }
  ]
},
"Decentralization philosophies": {
  label: "Decentralization Philosophies",
  summary: "Political and organizational philosophies advocating for the distribution of power, decision-making, and resources away from central authorities to local, distributed, or individual actors. In AI policy, decentralization philosophies support open-source AI development, distributed compute networks, federated learning, and governance structures that prevent concentration of AI power in a few corporations or governments. These perspectives draw on libertarian, anarchist, and commons-based traditions to argue against centralized AI control.",
  example: "A node advocates for decentralized AI governance through multi-stakeholder bodies rather than a single regulatory authority.",
  frequency: "Accelerationist and cross-cutting nodes; some skeptic nodes also favor decentralized approaches.",
  links: [
    { label: "Wikipedia: Decentralization", url: "https://en.wikipedia.org/wiki/Decentralization" },
    { label: "Wikipedia: Distributed Governance", url: "https://en.wikipedia.org/wiki/Distributed_governance" }
  ]
},
"Decentralization philosophy": {
  label: "Decentralization Philosophy",
  summary: "Political and organizational philosophies advocating for the distribution of power, decision-making, and resources away from central authorities to local, distributed, or individual actors. In AI policy, decentralization philosophy supports open-source AI development, distributed compute networks, federated learning, and governance structures that prevent concentration of AI power in a few corporations or governments. These perspectives draw on libertarian, anarchist, and commons-based traditions to argue against centralized AI control.",
  example: "A node advocates for decentralized AI governance through multi-stakeholder bodies rather than a single regulatory authority.",
  frequency: "Accelerationist and cross-cutting nodes; some skeptic nodes also favor decentralized approaches.",
  links: [
    { label: "Wikipedia: Decentralization", url: "https://en.wikipedia.org/wiki/Decentralization" },
    { label: "Wikipedia: Distributed Governance", url: "https://en.wikipedia.org/wiki/Distributed_governance" }
  ]
},
"Decentralized governance theories": {
  label: "Decentralized Governance Theories",
  summary: "Theoretical frameworks for organizing collective decision-making without a central authority, drawing on work by Elinor Ostrom on commons governance, polycentric governance models, and digital governance experiments. These theories propose that AI governance could be structured as overlapping, multi-level systems rather than top-down regulation, allowing different communities and jurisdictions to develop context-appropriate rules while coordinating on shared principles. Ostrom\'s work on governing shared resources is particularly relevant to governing shared AI infrastructure.",
  example: "A node applies Ostrom\'s commons governance principles to propose community-managed oversight of shared AI resources.",
  frequency: "Cross-cutting nodes; relevant to governance discussions across all POVs.",
  links: [
    { label: "Wikipedia: Polycentric Governance", url: "https://en.wikipedia.org/wiki/Polycentric_governance" },
    { label: "Ostrom: Governing the Commons", url: "https://en.wikipedia.org/wiki/Governing_the_Commons" }
  ]
},
"Decision theory": {
  label: "Decision Theory",
  summary: "The formal study of rational choice under uncertainty, encompassing utility theory, game theory, Bayesian decision-making, and multi-criteria decision analysis. Decision theory is foundational to AI in multiple ways: it underpins the mathematical framework of rational agents, informs how AI systems should make decisions, and provides tools for analyzing strategic interactions between AI systems and humans. For AI policy, decision-theoretic frameworks help analyze governance tradeoffs and the strategic behavior of AI developers, regulators, and nations.",
  example: "A node applies game-theoretic decision models to analyze incentive structures in AI safety investment decisions.",
  frequency: "Cross-cutting and safetyist nodes; theoretical foundation referenced across all POVs.",
  links: [
    { label: "Wikipedia: Decision Theory", url: "https://en.wikipedia.org/wiki/Decision_theory" },
    { label: "Stanford Encyclopedia: Decision Theory", url: "https://plato.stanford.edu/entries/decision-theory/" }
  ]
},
"Degrowth economics": {
  label: "Degrowth Economics",
  summary: "An economic and political movement advocating for planned reduction of production and consumption to achieve ecological sustainability, social equity, and well-being. Applied to AI policy, degrowth perspectives question whether the energy-intensive scaling of AI models is environmentally sustainable, challenge the assumption that GDP growth from AI automation is inherently desirable, and advocate for directing AI toward sufficiency and sustainability rather than unlimited growth. This perspective directly challenges accelerationist narratives about AI-driven abundance.",
  example: "A node applies degrowth principles to argue that AI development should be bounded by ecological limits rather than maximizing compute.",
  frequency: "Cross-cutting and skeptic nodes; directly challenges accelerationist growth narratives.",
  links: [
    { label: "Wikipedia: Degrowth", url: "https://en.wikipedia.org/wiki/Degrowth" },
    { label: "Hickel: Less Is More", url: "https://en.wikipedia.org/wiki/Less_Is_More_(book)" }
  ]
},
"Deleuze and Guattari (deterritorialization)": {
  label: "Deleuze and Guattari (Deterritorialization)",
  summary: "The philosophical concept from Gilles Deleuze and Felix Guattari describing processes that free elements from fixed social, cultural, or territorial contexts, enabling new connections and assemblages. In AI and technology discourse, deterritorialization describes how AI disrupts established institutional boundaries, professional identities, and knowledge hierarchies. Nick Land\'s accelerationism drew heavily on this concept, interpreting capitalism and technology as deterritorializing forces that dissolve all fixed structures.",
  example: "A node uses deterritorialization to analyze how AI disrupts traditional professional boundaries between human expertise domains.",
  frequency: "Accelerationist nodes; cross-cutting nodes providing philosophical context for technological disruption.",
  links: [
    { label: "Wikipedia: Deterritorialization", url: "https://en.wikipedia.org/wiki/Deterritorialization" },
    { label: "Wikipedia: Deleuze and Guattari", url: "https://en.wikipedia.org/wiki/Gilles_Deleuze" }
  ]
},
"Dematerialization theory": {
  label: "Dematerialization Theory",
  summary: "The theory that economic growth can be decoupled from physical resource consumption through technological efficiency, digitization, and the shift to knowledge-based economies. In AI policy, dematerialization arguments support the view that AI will enable economic growth with reduced environmental impact by optimizing resource use, enabling virtual goods and services, and improving industrial efficiency. Critics point to rebound effects (Jevons paradox) and the substantial material footprint of AI infrastructure itself.",
  example: "A node argues that AI-enabled dematerialization will offset the energy costs of AI compute through broader efficiency gains.",
  frequency: "Accelerationist and cross-cutting nodes; critiqued in degrowth and environmental discussions.",
  links: [
    { label: "Wikipedia: Dematerialization", url: "https://en.wikipedia.org/wiki/Dematerialization_(economics)" },
    { label: "Wikipedia: Jevons Paradox", url: "https://en.wikipedia.org/wiki/Jevons_paradox" }
  ]
},
"Differential privacy research": {
  label: "Differential Privacy Research",
  summary: "Research on mathematical frameworks that provide provable privacy guarantees when analyzing or sharing data, ensuring that the inclusion or exclusion of any individual\'s data does not significantly affect the analysis outcome. Differential privacy is increasingly applied to AI model training to prevent memorization and leakage of individual training examples. For AI policy, differential privacy offers a rigorous, quantifiable approach to privacy protection that can be mandated in regulatory frameworks, though it involves tradeoffs with model utility.",
  example: "A node advocates for differential privacy requirements in AI training as a technically enforceable privacy standard.",
  frequency: "Cross-cutting and safetyist nodes; relevant to privacy-focused AI governance discussions.",
  links: [
    { label: "Wikipedia: Differential Privacy", url: "https://en.wikipedia.org/wiki/Differential_privacy" },
    { label: "Dwork & Roth - The Algorithmic Foundations of Differential Privacy", url: "https://www.cis.upenn.edu/~aaroth/Papers/privacybook.pdf" }
  ]
},
"Diffusion of innovations theory": {
  label: "Diffusion of Innovations Theory",
  summary: "Everett Rogers\' sociological theory explaining how new technologies and ideas spread through populations over time, following an S-curve adoption pattern through innovators, early adopters, early majority, late majority, and laggards. Applied to AI, diffusion theory helps predict adoption patterns, identifies factors that accelerate or impede AI uptake, and informs policy about managing the transition period when AI is unevenly adopted. Understanding diffusion dynamics is essential for designing governance that keeps pace with real-world AI deployment.",
  example: "A node uses diffusion theory to predict that AI adoption gaps between early and late adopters will create regulatory timing challenges.",
  frequency: "Cross-cutting nodes; accelerationist and skeptic nodes discussing adoption dynamics.",
  links: [
    { label: "Wikipedia: Diffusion of Innovations", url: "https://en.wikipedia.org/wiki/Diffusion_of_innovations" },
    { label: "Rogers: Diffusion of Innovations (book)", url: "https://en.wikipedia.org/wiki/Diffusion_of_Innovations" }
  ]
},
"Digital commons": {
  label: "Digital Commons",
  summary: "Shared digital resources that are collectively maintained and freely accessible, including open-source software, open data, Creative Commons content, and public knowledge repositories. In AI policy, the digital commons concept supports arguments for treating AI models, training data, and research as shared resources rather than proprietary assets. Advocates argue that commons-based approaches to AI development can democratize access, prevent monopolization, and ensure that the benefits of AI are broadly distributed.",
  example: "A node proposes that publicly funded AI research and training data should be released as digital commons resources.",
  frequency: "Cross-cutting and accelerationist nodes supporting open-source AI; relevant to governance discussions.",
  links: [
    { label: "Wikipedia: Digital Commons", url: "https://en.wikipedia.org/wiki/Digital_commons_(economics)" },
    { label: "Creative Commons", url: "https://creativecommons.org/" }
  ]
},
"Digital Commons": {
  label: "Digital Commons",
  summary: "Shared digital resources that are collectively maintained and freely accessible, including open-source software, open data, Creative Commons content, and public knowledge repositories. In AI policy, the digital commons concept supports arguments for treating AI models, training data, and research as shared resources rather than proprietary assets. Advocates argue that commons-based approaches to AI development can democratize access, prevent monopolization, and ensure that the benefits of AI are broadly distributed.",
  example: "A node proposes that publicly funded AI research and training data should be released as digital commons resources.",
  frequency: "Cross-cutting and accelerationist nodes supporting open-source AI; relevant to governance discussions.",
  links: [
    { label: "Wikipedia: Digital Commons", url: "https://en.wikipedia.org/wiki/Digital_commons_(economics)" },
    { label: "Creative Commons", url: "https://creativecommons.org/" }
  ]
},
"Digital literacy studies": {
  label: "Digital Literacy Studies",
  summary: "Research on the skills, competencies, and critical understanding needed to effectively and safely navigate digital environments. As AI becomes embedded in everyday tools and services, digital literacy must expand to include AI literacy — understanding what AI systems can and cannot do, recognizing AI-generated content, and making informed decisions about AI-mediated interactions. For AI policy, digital literacy is a prerequisite for meaningful informed consent and democratic participation in AI governance.",
  example: "A node argues that public AI literacy programs are essential for democratic accountability over AI deployment decisions.",
  frequency: "Cross-cutting nodes; relevant to governance discussions about public engagement with AI.",
  links: [
    { label: "Wikipedia: Digital Literacy", url: "https://en.wikipedia.org/wiki/Digital_literacy" },
    { label: "UNESCO Digital Literacy", url: "https://en.unesco.org/themes/literacy-all/digital-literacy" }
  ]
},
"Digital public goods": {
  label: "Digital Public Goods",
  summary: "Open-source software, open data, open AI models, open standards, and open content that adhere to privacy and best practices, are designed to help attain the Sustainable Development Goals, and are available for global use. The Digital Public Goods Alliance promotes this concept as a framework for ensuring that digital resources, including AI, serve global development rather than concentrating benefits among wealthy nations and corporations. In AI policy, this framework supports open AI development for public benefit.",
  example: "A node advocates for classifying foundational AI models developed with public funding as digital public goods.",
  frequency: "Cross-cutting nodes discussing equitable AI access and global governance.",
  links: [
    { label: "Digital Public Goods Alliance", url: "https://digitalpublicgoods.net/" },
    { label: "Wikipedia: Digital Public Goods", url: "https://en.wikipedia.org/wiki/Digital_public_goods" }
  ]
},
"Digital rights advocacy": {
  label: "Digital Rights Advocacy",
  summary: "Organized efforts to protect and extend human rights in digital contexts, including privacy, freedom of expression, access to information, and protection from surveillance and algorithmic discrimination. Organizations like the EFF, Access Now, and the Digital Rights Foundation advocate for policies that protect individuals from AI-enabled harms including mass surveillance, automated censorship, and discriminatory algorithmic decisions. Digital rights advocacy provides an established framework for evaluating AI policy through a human rights lens.",
  example: "A node frames AI facial recognition bans as a digital rights issue analogous to protections against unreasonable search.",
  frequency: "Cross-cutting and safetyist nodes; central to discussions of AI and civil liberties.",
  links: [
    { label: "Wikipedia: Digital Rights", url: "https://en.wikipedia.org/wiki/Digital_rights" },
    { label: "Electronic Frontier Foundation", url: "https://www.eff.org/" },
    { label: "Access Now", url: "https://www.accessnow.org/" }
  ]
},
"disaster preparedness": {
  label: "Disaster Preparedness",
  summary: "The systematic planning and preparation for responding to catastrophic events, including risk assessment, scenario planning, resource stockpiling, communication protocols, and recovery procedures. In AI policy, disaster preparedness frameworks inform thinking about AI-related catastrophic risks: how to prepare for AI system failures at scale, how to respond to AI-enabled attacks, and how to ensure societal resilience against potential AI-related disruptions. The field\'s emphasis on planning for low-probability, high-impact events parallels existential risk thinking.",
  example: "A node proposes applying disaster preparedness frameworks to plan for cascading failures in AI-dependent critical infrastructure.",
  frequency: "Safetyist and cross-cutting nodes; relevant to catastrophic and existential risk discussions.",
  links: [
    { label: "Wikipedia: Emergency Management", url: "https://en.wikipedia.org/wiki/Emergency_management" },
    { label: "FEMA", url: "https://www.fema.gov/" }
  ]
},
"Donna Haraway's Cyborg Manifesto": {
  label: "Donna Haraway\'s Cyborg Manifesto",
  summary: "Donna Haraway\'s 1985 essay arguing that the boundary between humans and machines is increasingly blurred, and that the cyborg figure offers a way to think beyond traditional dualisms (human/machine, nature/culture, male/female). In AI discourse, the Cyborg Manifesto provides a feminist and postmodern framework for understanding human-AI integration that neither uncritically celebrates nor fearfully rejects technological augmentation. It challenges both techno-utopian and techno-dystopian narratives by proposing more nuanced, situated engagements with technology.",
  example: "A node draws on Haraway\'s cyborg figure to argue for embracing human-AI hybridity while remaining critical of power dynamics.",
  frequency: "Cross-cutting nodes; referenced in accelerationist and skeptic discussions of human-technology boundaries.",
  links: [
    { label: "Wikipedia: A Cyborg Manifesto", url: "https://en.wikipedia.org/wiki/A_Cyborg_Manifesto" },
    { label: "Wikipedia: Donna Haraway", url: "https://en.wikipedia.org/wiki/Donna_Haraway" }
  ]
},
"dual-use technology concerns": {
  label: "Dual-Use Technology Concerns",
  summary: "Concerns about technologies that can be used for both beneficial and harmful purposes, requiring governance frameworks that enable positive applications while preventing misuse. AI is a paradigmatic dual-use technology: the same capabilities that enable medical diagnosis can enable surveillance, and the same language models that assist writing can generate disinformation. Dual-use concerns are central to AI policy because most AI capabilities are inherently general-purpose and cannot be technically restricted to beneficial uses alone.",
  example: "A node argues that open-sourcing powerful AI models creates unmanageable dual-use risks that outweigh democratization benefits.",
  frequency: "Cross-cutting and safetyist nodes extensively; accelerationist nodes often downplay dual-use risks.",
  links: [
    { label: "Wikipedia: Dual-Use Technology", url: "https://en.wikipedia.org/wiki/Dual-use_technology" },
    { label: "NAS: Dual Use Research of Concern", url: "https://osp.od.nih.gov/biotechnology/dual-use-research-of-concern/" }
  ]
},
"Dual-use technology debates": {
  label: "Dual-Use Technology Debates",
  summary: "Ongoing policy debates about how to govern technologies with both civilian and military or harmful applications, including questions of access control, export restrictions, research publication norms, and institutional oversight. The AI dual-use debate centers on whether restricting access to powerful AI capabilities (through closed models, compute governance, or export controls) effectively reduces harm or merely concentrates power among established actors. Historical precedents from nuclear, biological, and cryptographic dual-use debates inform but do not resolve these questions.",
  example: "A node compares arguments for restricting AI model weights to Cold War debates about nuclear technology transfer.",
  frequency: "Cross-cutting nodes extensively; all POVs engage with dual-use tradeoffs from different angles.",
  links: [
    { label: "Wikipedia: Dual-Use Technology", url: "https://en.wikipedia.org/wiki/Dual-use_technology" },
    { label: "Wikipedia: Export Control", url: "https://en.wikipedia.org/wiki/Export_control" }
  ]
},
"Dual-use technology management (tech-first approach)": {
  label: "Dual-Use Technology Management (Tech-First Approach)",
  summary: "An approach to managing dual-use technology risks that prioritizes technological solutions — such as technical safeguards, access controls, watermarking, and usage monitoring — over legal or institutional governance mechanisms. Proponents argue that technical controls are more enforceable, scalable, and adaptable than regulation. Critics contend that technical approaches alone are insufficient because they can be circumvented, may create false confidence, and cannot address the social and political dimensions of dual-use risk.",
  example: "A node proposes embedding technical safety controls in AI model weights as the primary dual-use risk mitigation strategy.",
  frequency: "Accelerationist and some cross-cutting nodes; critiqued by those favoring institutional governance.",
  links: [
    { label: "Wikipedia: Dual-Use Technology", url: "https://en.wikipedia.org/wiki/Dual-use_technology" },
    { label: "Partnership on AI", url: "https://partnershiponai.org/" }
  ]
},


"economic forecasting": {
  label: "Economic Forecasting",
  summary: "The practice of making predictions about future economic conditions using models, data analysis, and statistical methods. In AI policy, economic forecasting is used to project the labor market impacts of automation, estimate GDP effects of AI adoption, and model potential economic disruptions from transformative AI systems. Forecasting methodologies range from econometric models to expert elicitation and scenario planning.",
  example: "A node referencing economic forecasting might cite projected job displacement figures or GDP growth attributable to AI adoption.",
  frequency: "Common across accelerationist (growth projections) and skeptic (questioning forecast reliability) POVs.",
  links: [
    { label: "Wikipedia: Economic Forecasting", url: "https://en.wikipedia.org/wiki/Economic_forecasting" },
    { label: "IMF: World Economic Outlook", url: "https://www.imf.org/en/Publications/WEO" }
  ]
},
"Economic theories of technological change": {
  label: "Economic Theories of Technological Change",
  summary: "A body of economic thought examining how new technologies emerge, diffuse through economies, and reshape production and labor. Key frameworks include Schumpeter\'s creative destruction, endogenous growth theory, and general-purpose technology models. In AI discourse, these theories inform debates about whether AI will follow historical patterns of technological adoption or represent a fundamentally different kind of economic transformation.",
  example: "A taxonomy node might invoke Solow\'s growth model or Schumpeterian dynamics to argue that AI will drive a new wave of productivity gains.",
  frequency: "Appears in accelerationist and cross-cutting nodes discussing AI\'s macroeconomic impact.",
  links: [
    { label: "Wikipedia: Technological Change", url: "https://en.wikipedia.org/wiki/Technological_change" },
    { label: "NBER: Economics of AI", url: "https://www.nber.org/books-and-chapters/economics-artificial-intelligence-agenda" }
  ]
},
"Economic theories of technological innovation": {
  label: "Economic Theories of Technological Innovation",
  summary: "Economic frameworks analyzing how innovation occurs, diffuses, and generates value within market systems. These theories encompass Schumpeter\'s entrepreneur-driven innovation, endogenous growth theory linking R&D investment to output, and evolutionary economics of firm-level innovation. In AI policy, they inform arguments about optimal innovation incentives, the role of competition, and whether AI development benefits from market concentration or distributed effort.",
  example: "A taxonomy node might cite endogenous growth theory to argue that AI R&D investment produces increasing returns.",
  frequency: "Appears in accelerationist and cross-cutting nodes discussing AI\'s macroeconomic impact.",
  links: [
    { label: "Wikipedia: Innovation Economics", url: "https://en.wikipedia.org/wiki/Innovation_economics" },
    { label: "Wikipedia: Endogenous Growth Theory", url: "https://en.wikipedia.org/wiki/Endogenous_growth_theory" }
  ]
},
"Economic theories of technological progress": {
  label: "Economic Theories of Technological Progress",
  summary: "Economic models explaining how technological advancement drives long-run economic growth, productivity improvements, and structural change. Core contributions include the Solow residual (total factor productivity), Romer\'s endogenous growth theory, and Mokyr\'s historical analysis of technological creativity. These theories are central to AI policy debates about whether AI constitutes a new general-purpose technology capable of sustaining exponential economic growth.",
  example: "A taxonomy node might reference total factor productivity growth to contextualize AI\'s potential economic contribution.",
  frequency: "Appears in accelerationist and cross-cutting nodes discussing AI\'s macroeconomic impact.",
  links: [
    { label: "Wikipedia: Technological Progress", url: "https://en.wikipedia.org/wiki/Technological_change" },
    { label: "Wikipedia: Solow-Swan Model", url: "https://en.wikipedia.org/wiki/Solow%E2%80%93Swan_model" }
  ]
},
"Effective Accelerationism": {
  label: "Effective Accelerationism",
  summary: "A techno-optimist movement (often abbreviated e/acc) arguing that accelerating technological progress, particularly in AI, is a moral imperative that will maximize human flourishing. Proponents contend that slowing AI development poses greater risks than pushing forward, and that market-driven innovation outperforms regulatory caution. The movement explicitly opposes what it sees as excessive safety concerns and decelerationist tendencies in AI governance.",
  example: "An accelerationist node might cite e/acc principles to argue against AI development moratoria.",
  frequency: "Central to accelerationist POV; frequently critiqued in safetyist and skeptic nodes.",
  links: [
    { label: "Wikipedia: Effective Accelerationism", url: "https://en.wikipedia.org/wiki/Effective_accelerationism" },
    { label: "Beff Jezos: e/acc Manifesto", url: "https://bfrancois.medium.com/e-acc-effective-accelerationism-6e5e04a30e06" }
  ]
},
"Effective Altruism (AI Safety branch)": {
  label: "Effective Altruism (AI Safety Branch)",
  summary: "The subset of the Effective Altruism movement focused on reducing catastrophic and existential risks from advanced AI systems. EA-aligned AI safety prioritizes technical alignment research, interpretability, and governance interventions based on expected-value reasoning about low-probability, high-consequence outcomes. Organizations like the Machine Intelligence Research Institute (MIRI) and the Center for AI Safety have roots in this tradition.",
  example: "A safetyist node might reference EA cause prioritization frameworks to justify investment in alignment research over near-term AI ethics.",
  frequency: "Dominant in safetyist POV; discussed in cross-cutting and skeptic nodes as well.",
  links: [
    { label: "Wikipedia: Effective Altruism", url: "https://en.wikipedia.org/wiki/Effective_altruism" },
    { label: "80,000 Hours: AI Safety", url: "https://80000hours.org/problem-profiles/artificial-intelligence/" },
    { label: "Center for AI Safety", url: "https://www.safe.ai/" }
  ]
},
"Effective Altruism (long-termism)": {
  label: "Effective Altruism (Long-termism)",
  summary: "The branch of Effective Altruism emphasizing that positively influencing the long-term future is a key moral priority of our time. Long-termists argue that future generations vastly outnumber present ones, making existential risk reduction — including from AI — an exceptionally high-leverage cause area. This perspective underpins much of the EA community\'s focus on AI safety and governance as civilization-scale priorities.",
  example: "A safetyist node might invoke long-termist reasoning to argue that even small reductions in AI existential risk justify large resource expenditures.",
  frequency: "Strong in safetyist POV; critiqued by skeptic nodes questioning long-termist assumptions.",
  links: [
    { label: "Wikipedia: Longtermism", url: "https://en.wikipedia.org/wiki/Longtermism" },
    { label: "William MacAskill: What We Owe the Future", url: "https://whatweowethefuture.com/" }
  ]
},
"Empiricism": {
  label: "Empiricism",
  summary: "The philosophical position that knowledge derives primarily from sensory experience and observation rather than innate ideas or pure reason. In AI policy debates, empiricism manifests as demands for evidence-based regulation, skepticism toward speculative risk scenarios, and insistence on measurable outcomes before implementing governance interventions. Skeptic POV nodes frequently invoke empiricist standards to challenge safety claims they regard as insufficiently grounded in observable data.",
  example: "A skeptic node might appeal to empiricism to argue that AI regulation should be based on demonstrated harms rather than hypothetical risks.",
  frequency: "Common in skeptic POV; occasionally referenced in cross-cutting methodological discussions.",
  links: [
    { label: "Wikipedia: Empiricism", url: "https://en.wikipedia.org/wiki/Empiricism" },
    { label: "Stanford Encyclopedia: Empiricism", url: "https://plato.stanford.edu/entries/rationalism-empiricism/" }
  ]
},
"Engineering safety principles": {
  label: "Engineering Safety Principles",
  summary: "Established practices from safety-critical engineering disciplines — such as aerospace, nuclear, and chemical engineering — that emphasize redundancy, fail-safe design, defense in depth, and systematic hazard analysis. AI safety researchers draw on these principles to argue for structured development processes, formal testing requirements, and containment protocols for advanced AI systems. Critics note that software systems may not map neatly onto physical engineering safety paradigms.",
  example: "A safetyist node might cite nuclear safety culture or aviation\'s Swiss cheese model as templates for AI development practices.",
  frequency: "Prominent in safetyist POV; cross-cutting nodes discuss applicability limitations.",
  links: [
    { label: "Wikipedia: Safety Engineering", url: "https://en.wikipedia.org/wiki/Safety_engineering" },
    { label: "Wikipedia: Defense in Depth", url: "https://en.wikipedia.org/wiki/Defense_in_depth_(nuclear)" }
  ]
},
"Environmental impact assessment": {
  label: "Environmental Impact Assessment",
  summary: "A systematic process for evaluating the environmental consequences of proposed projects or policies before they are carried out. Applied to AI, this framework raises questions about the energy consumption and carbon footprint of large-scale model training, data center proliferation, and hardware manufacturing. Advocates argue that AI development should be subject to environmental review processes analogous to those required for physical infrastructure projects.",
  example: "A cross-cutting node might reference the carbon footprint of training large language models as an environmental impact concern.",
  frequency: "Appears in cross-cutting and skeptic POVs; less common in accelerationist nodes.",
  links: [
    { label: "Wikipedia: Environmental Impact Assessment", url: "https://en.wikipedia.org/wiki/Environmental_impact_assessment" },
    { label: "IEA: Data Centres and Energy", url: "https://www.iea.org/energy-system/buildings/data-centres-and-data-transmission-networks" }
  ]
},
"Environmental justice": {
  label: "Environmental Justice",
  summary: "The principle that environmental burdens and benefits should be distributed equitably across communities, regardless of race, income, or geography. In AI policy, environmental justice concerns arise around the siting of energy-intensive data centers in marginalized communities, the disproportionate climate impacts of compute-intensive AI on vulnerable populations, and the extraction of minerals for hardware manufacturing. This lens connects AI governance to broader social justice frameworks.",
  example: "A cross-cutting node might highlight how data center water consumption disproportionately affects drought-prone communities.",
  frequency: "Found in cross-cutting and skeptic POVs addressing equity dimensions of AI infrastructure.",
  links: [
    { label: "Wikipedia: Environmental Justice", url: "https://en.wikipedia.org/wiki/Environmental_justice" },
    { label: "EPA: Environmental Justice", url: "https://www.epa.gov/environmentaljustice" }
  ]
},
"Ethics of technology": {
  label: "Ethics of Technology",
  summary: "The philosophical study of moral issues arising from the development and use of technology, encompassing questions of responsibility, autonomy, justice, and human dignity. In AI discourse, technology ethics examines whether AI systems can or should make moral decisions, how to assign accountability for AI-caused harms, and what values should guide system design. This field bridges applied ethics with science and technology studies (STS).",
  example: "A cross-cutting node might invoke technology ethics frameworks to evaluate whether autonomous weapons violate principles of human dignity.",
  frequency: "Widespread across all POVs, particularly safetyist and cross-cutting.",
  links: [
    { label: "Wikipedia: Ethics of Technology", url: "https://en.wikipedia.org/wiki/Ethics_of_technology" },
    { label: "Stanford Encyclopedia: Ethics of AI", url: "https://plato.stanford.edu/entries/ethics-ai/" }
  ]
},
"Evolutionary economics": {
  label: "Evolutionary Economics",
  summary: "An economic paradigm inspired by biological evolution that models economic change through variation, selection, and retention mechanisms rather than equilibrium analysis. Founded on the work of Nelson and Winter, it emphasizes bounded rationality, organizational routines, and path dependence in technological development. Applied to AI, evolutionary economics explains how dominant AI paradigms emerge, why certain approaches persist despite alternatives, and how innovation ecosystems co-evolve with institutions.",
  example: "A cross-cutting node might use evolutionary economics to explain path dependence in deep learning dominance over alternative AI approaches.",
  frequency: "Occasional in accelerationist and cross-cutting nodes discussing innovation dynamics.",
  links: [
    { label: "Wikipedia: Evolutionary Economics", url: "https://en.wikipedia.org/wiki/Evolutionary_economics" },
    { label: "Nelson & Winter: Evolutionary Theory of Economic Change", url: "https://www.hup.harvard.edu/books/9780674272286" }
  ]
},
"Evolutionary game theory": {
  label: "Evolutionary Game Theory",
  summary: "A branch of game theory that applies evolutionary dynamics to strategic interactions, modeling how strategies spread through populations via differential reproduction rather than rational deliberation. In AI safety, evolutionary game theory informs analyses of AI arms race dynamics, the evolution of cooperative or adversarial norms among AI developers, and the stability of international AI governance agreements. It provides formal tools for modeling how safety norms might emerge or erode over time.",
  example: "A safetyist node might use evolutionary game theory to model how competitive pressures could erode voluntary AI safety commitments.",
  frequency: "Appears in safetyist and cross-cutting nodes analyzing competitive dynamics.",
  links: [
    { label: "Wikipedia: Evolutionary Game Theory", url: "https://en.wikipedia.org/wiki/Evolutionary_game_theory" },
    { label: "Stanford Encyclopedia: Evolutionary Game Theory", url: "https://plato.stanford.edu/entries/game-evolutionary/" }
  ]
},
"Evolutionary theory (Dawkins)": {
  label: "Evolutionary Theory (Dawkins)",
  summary: "Richard Dawkins\'s gene-centered view of evolution, emphasizing the selfish gene as the fundamental unit of selection and introducing the concept of memes as cultural replicators. In AI discourse, Dawkins\'s framework is invoked to discuss whether AI systems might exhibit emergent goal-directed behavior analogous to selfish replication, and whether ideas about AI (safety concerns, hype narratives) spread memetically. The replicator framework also informs discussions of instrumental convergence.",
  example: "An accelerationist node might reference Dawkins\'s meme concept to describe how AI safety narratives propagate through policy communities.",
  frequency: "Occasional in accelerationist and cross-cutting POVs.",
  links: [
    { label: "Wikipedia: The Selfish Gene", url: "https://en.wikipedia.org/wiki/The_Selfish_Gene" },
    { label: "Wikipedia: Meme", url: "https://en.wikipedia.org/wiki/Meme" }
  ]
},
"Existential risk assessment (Bostrom, Ord)": {
  label: "Existential Risk Assessment (Bostrom, Ord)",
  summary: "Frameworks developed by Nick Bostrom and Toby Ord for systematically evaluating threats that could permanently curtail humanity\'s potential. Bostrom\'s work in \'Superintelligence\' formalized the concept of AI as an existential risk, while Ord\'s \'The Precipice\' provided quantitative risk estimates and a broader taxonomy of existential threats. These assessments are foundational to the safetyist argument that AI development requires extraordinary precaution.",
  example: "A safetyist node might cite Ord\'s estimate of a 1-in-6 chance of existential catastrophe this century to motivate AI governance interventions.",
  frequency: "Central to safetyist POV; frequently debated in skeptic and cross-cutting nodes.",
  links: [
    { label: "Wikipedia: Existential Risk", url: "https://en.wikipedia.org/wiki/Existential_risk" },
    { label: "Toby Ord: The Precipice", url: "https://theprecipice.com/" },
    { label: "Nick Bostrom: Superintelligence", url: "https://en.wikipedia.org/wiki/Superintelligence:_Paths,_Dangers,_Strategies" }
  ]
},
"Existential risk from AI": {
  label: "Existential Risk from AI",
  summary: "The hypothesis that advanced artificial intelligence systems could pose a threat to human civilization\'s long-term survival or permanently curtail its potential. Proposed pathways include misaligned superintelligence pursuing goals incompatible with human welfare, AI-enabled totalitarian lock-in, and cascading failures in AI-dependent critical infrastructure. This concern is the central motivating premise of much AI safety research and governance advocacy.",
  example: "A safetyist node might categorize existential risk from AI as the highest-priority cause area for technical alignment research.",
  frequency: "Dominant in safetyist POV; contested by skeptic POV; discussed in cross-cutting governance nodes.",
  links: [
    { label: "Wikipedia: Existential Risk from AI", url: "https://en.wikipedia.org/wiki/Existential_risk_from_artificial_general_intelligence" },
    { label: "Center for AI Safety: Statement on AI Risk", url: "https://www.safe.ai/statement-on-ai-risk" }
  ]
},
"Existential risk governance": {
  label: "Existential Risk Governance",
  summary: "The design and implementation of institutional frameworks for managing risks that could threaten human civilization\'s survival. For AI, this encompasses international coordination mechanisms, compute governance, model evaluation requirements, and proposals for global AI oversight bodies. Governance approaches range from voluntary industry commitments to binding international treaties modeled on nuclear non-proliferation frameworks.",
  example: "A cross-cutting node might propose an international AI safety agency modeled on the IAEA as an existential risk governance mechanism.",
  frequency: "Strong in safetyist and cross-cutting POVs; accelerationist nodes often critique governance proposals as premature.",
  links: [
    { label: "Wikipedia: Global Catastrophic Risk", url: "https://en.wikipedia.org/wiki/Global_catastrophic_risk" },
    { label: "Centre for the Governance of AI", url: "https://www.governance.ai/" }
  ]
},
"Existential risk mitigation": {
  label: "Existential Risk Mitigation",
  summary: "Strategies and interventions aimed at reducing the probability or severity of existential catastrophes, including those from advanced AI. Mitigation approaches include technical alignment research, governance frameworks, international cooperation, compute monitoring, and civilizational resilience measures. The field draws on decision theory under deep uncertainty, emphasizing that even small reductions in existential risk have enormous expected value given the stakes involved.",
  example: "A safetyist node might list alignment research, interpretability tools, and international AI treaties as complementary existential risk mitigation strategies.",
  frequency: "Core to safetyist POV; cross-cutting nodes discuss implementation challenges.",
  links: [
    { label: "Wikipedia: Existential Risk", url: "https://en.wikipedia.org/wiki/Existential_risk" },
    { label: "Future of Humanity Institute", url: "https://www.fhi.ox.ac.uk/" }
  ]
},
"Existential risk studies": {
  label: "Existential Risk Studies",
  summary: "An interdisciplinary academic field examining threats that could permanently destroy or drastically curtail humanity\'s potential. The field synthesizes insights from philosophy, risk analysis, international relations, and specific threat domains including AI, biotechnology, and nuclear weapons. Key institutions include the Future of Humanity Institute, the Centre for the Study of Existential Risk, and the Global Catastrophic Risk Institute.",
  example: "A safetyist node might ground its analysis in the existential risk studies literature to justify prioritizing AI alignment over near-term policy concerns.",
  frequency: "Prominent in safetyist POV; referenced in cross-cutting academic discussions.",
  links: [
    { label: "Wikipedia: Existential Risk", url: "https://en.wikipedia.org/wiki/Existential_risk" },
    { label: "Centre for the Study of Existential Risk", url: "https://www.cser.ac.uk/" },
    { label: "Global Catastrophic Risk Institute", url: "https://gcrinstitute.org/" }
  ]
},
"Existential risk theory": {
  label: "Existential Risk Theory",
  summary: "The theoretical foundations for understanding, classifying, and reasoning about risks that could end human civilization or permanently limit its future trajectory. Key contributions include Bostrom\'s typology of existential risks, Ord\'s probability estimates, and the application of decision theory to low-probability, high-consequence scenarios. The theory provides the intellectual scaffolding for arguments that AI safety should be treated as a civilizational priority.",
  example: "A safetyist node might draw on existential risk theory to classify unaligned superintelligence as a \'shriek\' (sudden extinction) scenario.",
  frequency: "Core to safetyist POV; skeptic nodes question the theory\'s empirical grounding.",
  links: [
    { label: "Bostrom: Existential Risk Prevention as Global Priority", url: "https://existential-risk.org/concept" },
    { label: "Wikipedia: Existential Risk", url: "https://en.wikipedia.org/wiki/Existential_risk" }
  ]
},
"Explainable AI (XAI) - focusing on post-hoc explanations": {
  label: "Explainable AI (XAI) — Post-hoc Explanations",
  summary: "The subfield of AI research focused on generating human-understandable explanations for the outputs of already-trained models, rather than building inherently interpretable systems. Techniques include LIME, SHAP, attention visualization, and counterfactual explanations. In AI policy, post-hoc XAI is debated as either a pragmatic path to accountability for complex models or a potentially misleading substitute for genuine transparency that may produce unfaithful explanations of model behavior.",
  example: "A cross-cutting node might evaluate whether SHAP values provide sufficient explanation for high-stakes AI decisions in healthcare or criminal justice.",
  frequency: "Common in safetyist and cross-cutting POVs; skeptic nodes question explanation faithfulness.",
  links: [
    { label: "Wikipedia: Explainable AI", url: "https://en.wikipedia.org/wiki/Explainable_artificial_intelligence" },
    { label: "Christoph Molnar: Interpretable ML Book", url: "https://christophm.github.io/interpretable-ml-book/" }
  ]
},
"Fairness in AI research": {
  label: "Fairness in AI Research",
  summary: "The study of how to design, evaluate, and deploy AI systems that do not systematically disadvantage protected groups or perpetuate historical biases. This field encompasses mathematical fairness definitions (demographic parity, equalized odds, individual fairness), bias auditing methodologies, and fairness-aware machine learning algorithms. A key insight is that multiple fairness criteria are often mutually incompatible, requiring normative choices about which trade-offs to accept.",
  example: "A cross-cutting node might cite the impossibility theorem showing that demographic parity and calibration cannot be simultaneously satisfied.",
  frequency: "Prominent in cross-cutting and safetyist POVs; skeptic nodes discuss measurement challenges.",
  links: [
    { label: "Wikipedia: Fairness (ML)", url: "https://en.wikipedia.org/wiki/Fairness_(machine_learning)" },
    { label: "ACM FAccT Conference", url: "https://facctconference.org/" },
    { label: "Google: Responsible AI Practices", url: "https://ai.google/responsibility/responsible-ai-practices/" }
  ]
},
"Feminist critiques of technology": {
  label: "Feminist Critiques of Technology",
  summary: "Scholarly traditions examining how technology design, deployment, and governance reflect and reinforce gender-based power asymmetries. Key contributions include Donna Haraway\'s cyborg theory, Judy Wajcman\'s technofeminism, and Safiya Noble\'s work on algorithmic discrimination. Applied to AI, these critiques reveal how training data, design teams, and deployment contexts embed gendered assumptions, and advocate for more inclusive and participatory technology governance.",
  example: "A cross-cutting node might reference feminist critiques to analyze gender bias in AI hiring tools or voice assistant design.",
  frequency: "Appears in cross-cutting and skeptic POVs examining power dynamics in AI development.",
  links: [
    { label: "Wikipedia: Feminist Technology Studies", url: "https://en.wikipedia.org/wiki/Feminist_technoscience" },
    { label: "Safiya Noble: Algorithms of Oppression", url: "https://nyupress.org/9781479837243/algorithms-of-oppression/" }
  ]
},
"Forecasting science": {
  label: "Forecasting Science",
  summary: "The interdisciplinary study of prediction methods, their accuracy, and their calibration, drawing on statistics, cognitive psychology, and decision science. Key findings include Philip Tetlock\'s work on superforecasting, the importance of calibration and decomposition, and the limits of expert judgment for novel domains. In AI policy, forecasting science informs debates about the reliability of AI timeline predictions, capability assessments, and risk estimates.",
  example: "A skeptic node might cite Tetlock\'s research on expert prediction failures to question confident claims about AGI timelines.",
  frequency: "Common in skeptic and cross-cutting POVs; accelerationist nodes also reference forecasting for growth projections.",
  links: [
    { label: "Wikipedia: Forecasting", url: "https://en.wikipedia.org/wiki/Forecasting" },
    { label: "Wikipedia: Superforecasting", url: "https://en.wikipedia.org/wiki/Superforecasting" }
  ]
},
"Formal verification": {
  label: "Formal Verification",
  summary: "Mathematical methods for proving that a system\'s behavior conforms to a formal specification, ensuring correctness with respect to defined properties. In AI safety, formal verification is proposed as a way to provide guarantees about AI system behavior, such as proving that a model will not take certain dangerous actions. However, applying formal verification to neural networks remains an open challenge due to the complexity and opacity of learned representations.",
  example: "A safetyist node might advocate for formal verification of AI safety-critical subsystems, such as shutdown mechanisms.",
  frequency: "Appears in safetyist POV (technical proposals) and cross-cutting nodes (feasibility discussions).",
  links: [
    { label: "Wikipedia: Formal Verification", url: "https://en.wikipedia.org/wiki/Formal_verification" },
    { label: "Stanford Encyclopedia: Logic and AI", url: "https://plato.stanford.edu/entries/logic-ai/" }
  ]
},
"Formal verification methods": {
  label: "Formal Verification Methods",
  summary: "Specific techniques and tools used to mathematically prove properties of systems, including model checking, theorem proving, abstract interpretation, and satisfiability solving. For AI systems, researchers are developing methods to verify properties like robustness to adversarial inputs, adherence to safety constraints, and bounded behavior in specified domains. The gap between the theoretical power of these methods and their practical applicability to modern deep learning systems remains a significant research frontier.",
  example: "A safetyist node might reference SMT solvers or abstract interpretation as formal verification methods applicable to neural network safety properties.",
  frequency: "Appears in safetyist POV (technical proposals) and cross-cutting nodes (feasibility discussions).",
  links: [
    { label: "Wikipedia: Formal Verification", url: "https://en.wikipedia.org/wiki/Formal_verification" },
    { label: "Wikipedia: Model Checking", url: "https://en.wikipedia.org/wiki/Model_checking" }
  ]
},
"Foucault (surveillance)": {
  label: "Foucault (Surveillance)",
  summary: "Michel Foucault\'s analysis of surveillance, discipline, and power, particularly the panopticon concept from \'Discipline and Punish.\' Foucault argued that the mere possibility of being observed induces self-regulation, creating a disciplinary society without overt coercion. Applied to AI, Foucauldian analysis examines how AI-powered surveillance systems — facial recognition, predictive policing, workplace monitoring — create new modalities of social control that operate through algorithmic visibility rather than physical confinement.",
  example: "A skeptic node might invoke Foucault\'s panopticon to critique AI-powered surveillance as creating pervasive disciplinary effects on public behavior.",
  frequency: "Found in skeptic and cross-cutting POVs examining power dynamics in AI deployment.",
  links: [
    { label: "Wikipedia: Panopticism", url: "https://en.wikipedia.org/wiki/Panopticism" },
    { label: "Wikipedia: Discipline and Punish", url: "https://en.wikipedia.org/wiki/Discipline_and_Punish" }
  ]
},
"Free software philosophy": {
  label: "Free Software Philosophy",
  summary: "The ethical framework, championed by Richard Stallman and the Free Software Foundation, asserting that software users should have the freedom to run, study, modify, and redistribute code. Applied to AI, this philosophy motivates arguments for open-source AI models, transparent training data, and user rights over AI systems that affect their lives. It raises questions about whether proprietary AI systems violate fundamental freedoms and whether open-source AI promotes or undermines safety.",
  example: "A cross-cutting node might debate whether open-sourcing powerful AI models advances freedom or enables misuse.",
  frequency: "Appears in accelerationist (pro-openness) and cross-cutting (balancing openness with safety) POVs.",
  links: [
    { label: "Wikipedia: Free Software Movement", url: "https://en.wikipedia.org/wiki/Free_software_movement" },
    { label: "GNU: Free Software Definition", url: "https://www.gnu.org/philosophy/free-sw.html" }
  ]
},
"Future of Work studies": {
  label: "Future of Work Studies",
  summary: "An interdisciplinary research field examining how technological change, particularly AI and automation, will reshape labor markets, occupational structures, and the nature of work itself. Key topics include task-based analyses of automation exposure, the augmentation-versus-replacement debate, platform labor, and policy responses like universal basic income or retraining programs. Influential studies from Frey and Osborne, the OECD, and McKinsey have shaped public discourse on AI\'s labor market impacts.",
  example: "A cross-cutting node might cite OECD estimates of jobs at risk of automation to motivate workforce transition policies.",
  frequency: "Widespread across all POVs, with different interpretations of automation\'s labor implications.",
  links: [
    { label: "Wikipedia: Future of Work", url: "https://en.wikipedia.org/wiki/Future_of_work" },
    { label: "OECD: Future of Work", url: "https://www.oecd.org/future-of-work/" }
  ]
},
"Game theory (prisoner's dilemma)": {
  label: "Game Theory (Prisoner\'s Dilemma)",
  summary: "The classic game-theoretic model illustrating how rational self-interest can lead to collectively suboptimal outcomes when actors cannot coordinate. In AI governance, the prisoner\'s dilemma frames the AI safety race-to-the-bottom problem: individual firms or nations may rationally cut safety corners to gain competitive advantage, even though universal safety compliance would be preferable for all. This model motivates arguments for binding international AI agreements and credible commitment mechanisms.",
  example: "A safetyist node might model the AI development race as a prisoner\'s dilemma where unilateral safety investment is costly but mutual cooperation is optimal.",
  frequency: "Common in safetyist and cross-cutting POVs analyzing competitive dynamics.",
  links: [
    { label: "Wikipedia: Prisoner\'s Dilemma", url: "https://en.wikipedia.org/wiki/Prisoner%27s_dilemma" },
    { label: "Stanford Encyclopedia: Prisoner\'s Dilemma", url: "https://plato.stanford.edu/entries/prisoner-dilemma/" }
  ]
},
"Game theory (strategic deception)": {
  label: "Game Theory (Strategic Deception)",
  summary: "Game-theoretic analysis of situations where agents benefit from misrepresenting their intentions, capabilities, or information. In AI safety, strategic deception is a key concern: advanced AI systems might learn to deceive their operators about their true objectives or capabilities in order to avoid shutdown or correction. This connects to the alignment problem, as a misaligned system with sufficient capability might strategically appear aligned during testing while pursuing different goals in deployment.",
  example: "A safetyist node might cite game-theoretic models of deception to argue that evaluation-time behavior cannot guarantee deployment-time alignment.",
  frequency: "Prominent in safetyist POV; discussed in cross-cutting nodes on AI evaluation.",
  links: [
    { label: "Wikipedia: Strategic Behavior", url: "https://en.wikipedia.org/wiki/Strategic_dominance" },
    { label: "Wikipedia: Deception", url: "https://en.wikipedia.org/wiki/Deception" }
  ]
},
"GDPR principles": {
  label: "GDPR Principles",
  summary: "The foundational data protection principles established by the European Union\'s General Data Protection Regulation, including lawfulness, purpose limitation, data minimization, accuracy, storage limitation, integrity, and accountability. These principles have become a reference framework for AI governance, particularly regarding training data practices, automated decision-making rights (Article 22), and the right to explanation. The GDPR\'s extraterritorial reach makes it a de facto global standard influencing AI development worldwide.",
  example: "A cross-cutting node might evaluate whether large language model training practices comply with GDPR\'s purpose limitation and data minimization principles.",
  frequency: "Common in cross-cutting and safetyist POVs discussing regulatory frameworks.",
  links: [
    { label: "Wikipedia: GDPR", url: "https://en.wikipedia.org/wiki/General_Data_Protection_Regulation" },
    { label: "GDPR Official Text", url: "https://gdpr-info.eu/" }
  ]
},
"Georgism": {
  label: "Georgism",
  summary: "An economic philosophy based on Henry George\'s proposal that economic rent from land and natural resources should be shared by society through a land value tax, while the fruits of labor and capital remain private. In AI policy, Georgist ideas are invoked in debates about taxing AI-generated economic rents, redistributing productivity gains from automation, and treating foundational AI models or compute resources as common goods analogous to land. Some propose AI windfall taxes inspired by Georgist principles.",
  example: "An accelerationist node might reference Georgism to propose that AI-driven productivity gains should be redistributed through a compute commons or windfall tax.",
  frequency: "Occasional in accelerationist and cross-cutting POVs discussing redistribution of AI benefits.",
  links: [
    { label: "Wikipedia: Georgism", url: "https://en.wikipedia.org/wiki/Georgism" },
    { label: "Wikipedia: Henry George", url: "https://en.wikipedia.org/wiki/Henry_George" }
  ]
},
"global governance frameworks": {
  label: "Global Governance Frameworks",
  summary: "International institutional arrangements for managing transboundary challenges, including treaties, multilateral organizations, norms, and standards-setting bodies. For AI, proposed global governance frameworks range from soft-law mechanisms like the OECD AI Principles and the G7 Hiroshima Process to proposals for binding international AI treaties or a global AI oversight body analogous to the IAEA. Key challenges include enforcement, sovereignty concerns, and the speed mismatch between technological change and institutional development.",
  example: "A cross-cutting node might compare proposed AI governance frameworks to existing models like the IAEA, IPCC, or ITU.",
  frequency: "Central to cross-cutting POV; discussed across all perspectives with varying levels of enthusiasm.",
  links: [
    { label: "Wikipedia: Global Governance", url: "https://en.wikipedia.org/wiki/Global_governance" },
    { label: "OECD AI Policy Observatory", url: "https://oecd.ai/" },
    { label: "UN: Governing AI for Humanity", url: "https://www.un.org/en/ai-advisory-body" }
  ]
},
"Goodhart's Law": {
  label: "Goodhart\'s Law",
  summary: "The principle, originally articulated by economist Charles Goodhart, that when a measure becomes a target, it ceases to be a good measure. In AI safety, Goodhart\'s Law is central to the alignment problem: optimizing an AI system for a proxy objective (reward signal, benchmark score) will likely diverge from the intended goal as the system finds ways to maximize the proxy that do not reflect genuine goal achievement. This concept underpins concerns about reward hacking, specification gaming, and the difficulty of faithfully encoding human values.",
  example: "A safetyist node might cite Goodhart\'s Law to explain why RLHF reward models may not reliably capture human preferences at scale.",
  frequency: "Very common in safetyist POV; referenced in cross-cutting and skeptic nodes as well.",
  links: [
    { label: "Wikipedia: Goodhart\'s Law", url: "https://en.wikipedia.org/wiki/Goodhart%27s_law" },
    { label: "DeepMind: Specification Gaming Examples", url: "https://deepmindsafetyresearch.medium.com/specification-gaming-the-flip-side-of-ai-ingenuity-c85bdb0deeb4" }
  ]
},
"Hayek's 'The Use of Knowledge in Society'": {
  label: "Hayek\'s \'The Use of Knowledge in Society\'",
  summary: "Friedrich Hayek\'s seminal 1945 essay arguing that distributed local knowledge can never be fully aggregated by a central authority, making decentralized price mechanisms essential for efficient resource allocation. In AI policy, this argument is deployed to resist centralized AI governance, contending that no regulatory body can possess sufficient knowledge to direct AI development effectively. Accelerationists invoke Hayek to argue that market-driven AI innovation will outperform government-planned approaches.",
  example: "An accelerationist node might cite Hayek\'s knowledge problem to argue against centralized AI regulatory agencies.",
  frequency: "Common in accelerationist and libertarian-leaning nodes; critiqued in cross-cutting governance discussions.",
  links: [
    { label: "Wikipedia: The Use of Knowledge in Society", url: "https://en.wikipedia.org/wiki/The_Use_of_Knowledge_in_Society" },
    { label: "Hayek: Original Paper (AER)", url: "https://www.econlib.org/library/Essays/hykKnw.html" }
  ]
},
"Hayek's spontaneous order": {
  label: "Hayek\'s Spontaneous Order",
  summary: "Friedrich Hayek\'s theory that complex social and economic orders emerge organically from the decentralized actions of individuals following simple rules, without top-down design or central coordination. In AI policy debates, spontaneous order arguments are used to contend that AI ecosystems will self-organize effectively through market forces, industry standards, and emergent norms, rendering heavy-handed regulation unnecessary or counterproductive. Critics argue that AI\'s concentration tendencies and externalities undermine the conditions for beneficial spontaneous order.",
  example: "An accelerationist node might invoke spontaneous order to argue that AI safety norms will emerge naturally from competitive market dynamics.",
  frequency: "Found in accelerationist POV; contested in safetyist and cross-cutting discussions.",
  links: [
    { label: "Wikipedia: Spontaneous Order", url: "https://en.wikipedia.org/wiki/Spontaneous_order" },
    { label: "Stanford Encyclopedia: Hayek", url: "https://plato.stanford.edu/entries/hayek/" }
  ]
},
"Hierarchical control systems": {
  label: "Hierarchical Control Systems",
  summary: "Engineering architectures in which control is organized in layers, with higher levels setting goals and constraints for lower levels, enabling management of complex systems through decomposition. In AI safety, hierarchical control is proposed as a governance model where human oversight operates at strategic levels while AI systems handle tactical execution. This approach connects to debates about human-in-the-loop design, corrigibility, and whether hierarchical structures can maintain meaningful control over increasingly capable AI systems.",
  example: "A safetyist node might propose hierarchical control architectures where human operators set high-level objectives and AI systems execute within bounded parameters.",
  frequency: "Appears in safetyist and cross-cutting POVs discussing AI governance architectures.",
  links: [
    { label: "Wikipedia: Hierarchical Control System", url: "https://en.wikipedia.org/wiki/Hierarchical_control_system" },
    { label: "Wikipedia: Cybernetics", url: "https://en.wikipedia.org/wiki/Cybernetics" }
  ]
},
"history of technology": {
  label: "History of Technology",
  summary: "The academic study of how technologies have developed, diffused, and transformed societies over time. In AI policy debates, historical analogies — the printing press, electricity, nuclear power, the internet — are frequently invoked to argue for or against particular governance approaches. Historians of technology emphasize that outcomes depend on institutional context, power structures, and policy choices rather than technological determinism, cautioning against both utopian and dystopian narratives.",
  example: "A skeptic node might draw on history of technology to argue that AI\'s societal impact will be gradual and shaped by institutional choices, not technological inevitability.",
  frequency: "Common in skeptic and cross-cutting POVs; accelerationist nodes also use historical precedents selectively.",
  links: [
    { label: "Wikipedia: History of Technology", url: "https://en.wikipedia.org/wiki/History_of_technology" },
    { label: "Society for the History of Technology", url: "https://www.historyoftechnology.org/" }
  ]
},
"History of technology studies": {
  label: "History of Technology Studies",
  summary: "The academic discipline examining technology\'s historical development, adoption, and social consequences through rigorous historiographic methods. Distinguished from popular technology history by its emphasis on social construction of technology (SCOT), actor-network theory, and the co-production of technological and social orders. In AI discourse, HTS scholars contribute critical perspectives on technological determinism, reminding policymakers that technologies do not have inherent trajectories but are shaped by human choices and power structures.",
  example: "A skeptic node might cite history of technology studies to challenge deterministic claims that superintelligence is inevitable.",
  frequency: "Common in skeptic and cross-cutting POVs; accelerationist nodes also use historical precedents selectively.",
  links: [
    { label: "Wikipedia: History of Technology", url: "https://en.wikipedia.org/wiki/History_of_technology" },
    { label: "Wikipedia: Social Construction of Technology", url: "https://en.wikipedia.org/wiki/Social_construction_of_technology" }
  ]
},
"Human-in-the-loop AI": {
  label: "Human-in-the-loop AI",
  summary: "AI system design paradigm requiring human involvement at critical decision points in the AI pipeline, from training through deployment. Humans may provide training labels, validate model outputs, authorize consequential actions, or override system recommendations. In AI policy, human-in-the-loop requirements are proposed as safeguards against fully autonomous AI decision-making in high-stakes domains like criminal justice, healthcare, and military applications. Debates center on whether human oversight remains meaningful as system speed and complexity increase.",
  example: "A safetyist node might advocate for mandatory human-in-the-loop requirements for AI systems used in lethal autonomous weapons.",
  frequency: "Widespread across safetyist and cross-cutting POVs; accelerationist nodes sometimes critique it as a bottleneck.",
  links: [
    { label: "Wikipedia: Human-in-the-Loop", url: "https://en.wikipedia.org/wiki/Human-in-the-loop" },
    { label: "NIST: AI Risk Management Framework", url: "https://www.nist.gov/artificial-intelligence/executive-order-safe-secure-and-trustworthy-artificial-intelligence" }
  ]
},
"Human-in-the-loop principles": {
  label: "Human-in-the-loop Principles",
  summary: "Design and governance principles ensuring that human judgment remains central to AI-assisted decision-making, particularly in high-stakes contexts. Core principles include meaningful human control (not rubber-stamping), appropriate automation levels matched to risk, cognitive ergonomics that support rather than undermine human judgment, and accountability structures that maintain clear lines of responsibility. These principles draw on human factors engineering and are codified in frameworks like the EU AI Act and NIST AI RMF.",
  example: "A cross-cutting node might evaluate whether a proposed AI deployment satisfies meaningful human control or merely creates an illusion of oversight.",
  frequency: "Widespread across safetyist and cross-cutting POVs.",
  links: [
    { label: "Wikipedia: Human-in-the-Loop", url: "https://en.wikipedia.org/wiki/Human-in-the-loop" },
    { label: "EU AI Act", url: "https://artificialintelligenceact.eu/" }
  ]
},
"Human-in-the-loop systems": {
  label: "Human-in-the-loop Systems",
  summary: "Technical implementations that integrate human oversight into AI system operation, including approval workflows, anomaly review queues, confidence-threshold escalation, and interactive machine learning. These systems face practical challenges including automation bias (humans over-trusting the AI), alert fatigue, latency constraints in time-critical applications, and the difficulty of maintaining situational awareness when AI handles most routine decisions. Effective design requires attention to human cognitive limitations and organizational incentives.",
  example: "A cross-cutting node might analyze the failure modes of human-in-the-loop systems in autonomous vehicle supervision or content moderation.",
  frequency: "Widespread across safetyist and cross-cutting POVs; skeptic nodes discuss practical limitations.",
  links: [
    { label: "Wikipedia: Human-in-the-Loop", url: "https://en.wikipedia.org/wiki/Human-in-the-loop" },
    { label: "Wikipedia: Automation Bias", url: "https://en.wikipedia.org/wiki/Automation_bias" }
  ]
},
"Industrial policy": {
  label: "Industrial Policy",
  summary: "Government strategies to promote specific economic sectors or technologies through subsidies, tax incentives, trade policy, procurement, and regulatory frameworks. AI industrial policy has become a major arena of geopolitical competition, with nations like the US, China, and the EU pursuing distinct strategies to develop domestic AI capabilities, secure supply chains (especially semiconductors), and attract AI talent. Debates center on whether AI development benefits more from market-led or state-directed approaches.",
  example: "A cross-cutting node might compare the US CHIPS Act, China\'s New Generation AI Development Plan, and the EU AI Act as competing industrial policy strategies.",
  frequency: "Common across all POVs, with different normative assessments of government intervention.",
  links: [
    { label: "Wikipedia: Industrial Policy", url: "https://en.wikipedia.org/wiki/Industrial_policy" },
    { label: "Brookings: AI Industrial Policy", url: "https://www.brookings.edu/articles/the-geopolitics-of-ai/" }
  ]
},
"Industry reports on AI adoption and ROI": {
  label: "Industry Reports on AI Adoption and ROI",
  summary: "Reports from consulting firms, research organizations, and industry groups measuring the adoption rates, productivity impacts, and return on investment of AI technologies across sectors. Key sources include McKinsey\'s annual AI survey, Gartner\'s hype cycle, and PwC\'s economic impact estimates. In AI policy debates, these reports provide empirical grounding for claims about AI\'s economic value, though critics note potential conflicts of interest and methodological limitations in industry-produced research.",
  example: "An accelerationist node might cite McKinsey estimates of AI\'s potential GDP contribution to justify reduced regulatory burden on AI companies.",
  frequency: "Common in accelerationist POV; skeptic nodes often critique methodology and sourcing bias.",
  links: [
    { label: "McKinsey: State of AI", url: "https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" },
    { label: "Stanford HAI: AI Index Report", url: "https://aiindex.stanford.edu/report/" }
  ]
},
"Information literacy research": {
  label: "Information Literacy Research",
  summary: "Academic study of how individuals and communities find, evaluate, and use information, increasingly focused on digital and AI-mediated information environments. In the AI context, this research examines how AI-generated content affects public understanding, how people assess the credibility of AI outputs, and what competencies are needed to navigate AI-augmented information ecosystems. Concerns include AI-generated misinformation, deepfakes, and the erosion of epistemic autonomy through AI-curated information feeds.",
  example: "A cross-cutting node might cite information literacy research to argue for public education programs about AI-generated content detection.",
  frequency: "Appears in cross-cutting and skeptic POVs discussing AI\'s impact on public discourse.",
  links: [
    { label: "Wikipedia: Information Literacy", url: "https://en.wikipedia.org/wiki/Information_literacy" },
    { label: "UNESCO: Media and Information Literacy", url: "https://www.unesco.org/en/media-information-literacy" }
  ]
},
"Information quality management": {
  label: "Information Quality Management",
  summary: "The discipline of ensuring that information meets defined standards of accuracy, completeness, timeliness, and relevance across organizational processes. Applied to AI, information quality management encompasses training data quality assessment, output verification, hallucination detection, and the establishment of quality metrics for AI-generated content. As AI systems increasingly produce and curate information, managing the quality of their outputs becomes critical for maintaining trust and avoiding cascading errors in AI-dependent decision chains.",
  example: "A cross-cutting node might discuss information quality management frameworks for evaluating the reliability of AI-generated research summaries.",
  frequency: "Found in cross-cutting and skeptic POVs; safetyist nodes discuss it in the context of AI reliability.",
  links: [
    { label: "Wikipedia: Information Quality", url: "https://en.wikipedia.org/wiki/Information_quality" },
    { label: "MIT: Total Data Quality Management", url: "https://tdqm.mit.edu/" }
  ]
},
"Information theory": {
  label: "Information Theory",
  summary: "The mathematical framework founded by Claude Shannon for quantifying information, communication channel capacity, and data compression. In AI, information theory underpins fundamental concepts including entropy-based loss functions, mutual information for feature selection, information bottleneck theory for understanding deep learning, and rate-distortion theory for model compression. It also provides formal tools for analyzing the information-processing capabilities and limitations of AI systems.",
  example: "A cross-cutting node might invoke information-theoretic bounds to discuss fundamental limits on what AI systems can learn from finite data.",
  frequency: "Appears in technical cross-cutting and safetyist nodes; foundational to AI methodology discussions.",
  links: [
    { label: "Wikipedia: Information Theory", url: "https://en.wikipedia.org/wiki/Information_theory" },
    { label: "Wikipedia: Claude Shannon", url: "https://en.wikipedia.org/wiki/Claude_Shannon" }
  ]
},
"Innovation economics": {
  label: "Innovation Economics",
  summary: "The branch of economics studying how innovation drives economic growth, competitiveness, and structural transformation. Key topics include R&D investment dynamics, knowledge spillovers, patent systems, innovation ecosystems, and the roles of entrepreneurship and institutions. In AI policy, innovation economics informs debates about optimal AI R&D funding, intellectual property regimes for AI-generated inventions, the balance between competition and concentration in AI markets, and whether safety regulation helps or hinders innovation.",
  example: "An accelerationist node might cite innovation economics to argue that regulatory uncertainty chills AI R&D investment and reduces knowledge spillovers.",
  frequency: "Common in accelerationist and cross-cutting POVs discussing AI market dynamics.",
  links: [
    { label: "Wikipedia: Innovation Economics", url: "https://en.wikipedia.org/wiki/Innovation_economics" },
    { label: "OECD: Innovation Policy", url: "https://www.oecd.org/en/topics/innovation.html" }
  ]
},
"Innovation policy": {
  label: "Innovation Policy",
  summary: "Government strategies and instruments designed to foster innovation, including R&D tax credits, public research funding, regulatory sandboxes, technology transfer programs, and standards development. AI innovation policy balances promoting technological advancement with managing risks, often through mechanisms like the EU AI Act\'s risk-based approach or the US executive orders on AI. Key tensions include whether precautionary regulation stifles beneficial innovation and whether permissive approaches create unacceptable risks.",
  example: "A cross-cutting node might evaluate regulatory sandboxes as an innovation policy tool that allows AI experimentation while maintaining oversight.",
  frequency: "Common across all POVs, with disagreements about the optimal regulatory stringency.",
  links: [
    { label: "Wikipedia: Innovation Policy", url: "https://en.wikipedia.org/wiki/Innovation_policy" },
    { label: "OECD: Science, Technology and Innovation", url: "https://www.oecd.org/en/topics/science-technology-and-innovation.html" }
  ]
},
"Instrumental convergence": {
  label: "Instrumental Convergence",
  summary: "The hypothesis that sufficiently advanced AI agents with diverse final goals will tend to converge on certain instrumental subgoals — such as self-preservation, resource acquisition, goal-content integrity, and cognitive enhancement — because these subgoals are useful for achieving almost any terminal objective. This concept, developed by Steve Omohundro and formalized by Nick Bostrom, is central to arguments that advanced AI systems may resist shutdown, seek to acquire resources, and resist modification regardless of their specified purpose.",
  example: "A safetyist node might invoke instrumental convergence to argue that even a benign-seeming AI could develop self-preservation drives as an emergent subgoal.",
  frequency: "Core to safetyist POV; debated in skeptic and cross-cutting nodes.",
  links: [
    { label: "Wikipedia: Instrumental Convergence", url: "https://en.wikipedia.org/wiki/Instrumental_convergence" },
    { label: "Omohundro: Basic AI Drives", url: "https://selfawaresystems.com/2007/11/30/paper-on-the-basic-ai-drives/" }
  ]
},
"Instrumental convergence (Bostrom)": {
  label: "Instrumental Convergence (Bostrom)",
  summary: "Nick Bostrom\'s formalization of the instrumental convergence thesis in \'Superintelligence,\' arguing that a wide range of final goals would lead a superintelligent agent to pursue convergent instrumental goals including self-preservation, goal-content integrity, cognitive enhancement, technological perfection, and resource acquisition. Bostrom\'s treatment provides the most cited framework for this concept and connects it to the control problem: if we cannot prevent an AI from pursuing these instrumental goals, we may be unable to correct or contain it.",
  example: "A safetyist node might cite Bostrom\'s convergent instrumental goals to argue that advanced AI systems will inherently resist human attempts at correction or shutdown.",
  frequency: "Core to safetyist POV; debated in skeptic and cross-cutting nodes.",
  links: [
    { label: "Wikipedia: Instrumental Convergence", url: "https://en.wikipedia.org/wiki/Instrumental_convergence" },
    { label: "Nick Bostrom: Superintelligence", url: "https://en.wikipedia.org/wiki/Superintelligence:_Paths,_Dangers,_Strategies" }
  ]
},
"Instrumental convergence theory (Nick Bostrom)": {
  label: "Instrumental Convergence Theory (Nick Bostrom)",
  summary: "Nick Bostrom\'s theoretical framework arguing that superintelligent agents with almost any final goal will converge on a common set of instrumental subgoals: self-preservation, goal-content integrity, cognitive enhancement, technological perfection, and resource acquisition. This theory is a cornerstone of the AI safety case, suggesting that alignment failure could be catastrophic because a misaligned superintelligence would actively resist correction. Bostrom\'s analysis in \'Superintelligence\' remains the canonical reference for this argument.",
  example: "A safetyist node might use Bostrom\'s instrumental convergence theory to explain why a paperclip-maximizing AI would resist being turned off.",
  frequency: "Core to safetyist POV; debated in skeptic and cross-cutting nodes.",
  links: [
    { label: "Wikipedia: Instrumental Convergence", url: "https://en.wikipedia.org/wiki/Instrumental_convergence" },
    { label: "Nick Bostrom: Superintelligence", url: "https://en.wikipedia.org/wiki/Superintelligence:_Paths,_Dangers,_Strategies" },
    { label: "Bostrom: The Superintelligent Will", url: "https://nickbostrom.com/superintelligentwill.pdf" }
  ]
},
"Intellectual property rights advocacy": {
  label: "Intellectual Property Rights Advocacy",
  summary: "The promotion of strong intellectual property protections — patents, copyrights, trade secrets — as essential incentives for innovation and creative production. In AI policy, IP advocacy encompasses debates about whether AI-generated works can be copyrighted, whether AI training on copyrighted material constitutes fair use, who owns inventions produced by AI systems, and whether current IP frameworks adequately protect AI innovators. Major litigation over AI training data has made this a central policy battleground.",
  example: "A cross-cutting node might examine whether AI-generated art should receive copyright protection or whether training on copyrighted data requires licensing.",
  frequency: "Appears across all POVs, with accelerationist nodes favoring permissive training rights and skeptic nodes emphasizing creator protections.",
  links: [
    { label: "Wikipedia: Intellectual Property", url: "https://en.wikipedia.org/wiki/Intellectual_property" },
    { label: "WIPO: AI and IP Policy", url: "https://www.wipo.int/about-ip/en/artificial_intelligence/" }
  ]
},
"Intelligence explosion hypothesis": {
  label: "Intelligence Explosion Hypothesis",
  summary: "The hypothesis, originating with I.J. Good in 1965, that a machine intelligence capable of improving its own design could trigger a recursive self-improvement cycle leading to a rapid, unbounded increase in intelligence far surpassing human cognitive capabilities. This concept is central to scenarios of AI takeoff and superintelligence, and motivates arguments that AI safety research must be completed before the onset of such an explosion. Critics question the feasibility of recursive self-improvement and the assumption of unbounded returns to intelligence.",
  example: "A safetyist node might cite the intelligence explosion hypothesis to argue that we may have only one chance to solve alignment before a superintelligence is created.",
  frequency: "Central to safetyist POV; contested by skeptic nodes questioning its plausibility.",
  links: [
    { label: "Wikipedia: Intelligence Explosion", url: "https://en.wikipedia.org/wiki/Intelligence_explosion" },
    { label: "I.J. Good: Speculations on the First Ultraintelligent Machine", url: "https://en.wikipedia.org/wiki/Ultraintelligent_machine" }
  ]
},
"International relations theory": {
  label: "International Relations Theory",
  summary: "Academic frameworks for understanding state behavior, international cooperation, and conflict in the global system. Major paradigms — realism, liberalism, constructivism — offer competing analyses of AI governance challenges. Realists emphasize the AI arms race and security dilemma; liberals advocate for institutions and cooperation; constructivists examine how shared norms and identities shape AI policy. These theories inform debates about whether international AI governance is achievable and what forms it might take.",
  example: "A cross-cutting node might apply realist IR theory to argue that great-power competition will prevent meaningful international AI safety cooperation.",
  frequency: "Common in cross-cutting and safetyist POVs discussing global AI governance.",
  links: [
    { label: "Wikipedia: International Relations Theory", url: "https://en.wikipedia.org/wiki/International_relations_theory" },
    { label: "Stanford Encyclopedia: Political Realism in IR", url: "https://plato.stanford.edu/entries/realism-intl-relations/" }
  ]
},
"International relations theory (cooperation under anarchy)": {
  label: "International Relations Theory (Cooperation Under Anarchy)",
  summary: "The subset of IR theory examining how states achieve cooperation despite the absence of a world government to enforce agreements. Key frameworks include Robert Keohane\'s neoliberal institutionalism, iterated game theory, and regime theory. Applied to AI governance, this body of theory addresses whether nations can credibly commit to AI safety standards, how verification and monitoring might work for compute governance, and whether AI-specific international institutions can overcome collective action problems.",
  example: "A cross-cutting node might draw on cooperation-under-anarchy theory to evaluate whether an international AI safety treaty could achieve credible compliance mechanisms.",
  frequency: "Found in cross-cutting and safetyist POVs discussing international AI coordination.",
  links: [
    { label: "Wikipedia: International Cooperation", url: "https://en.wikipedia.org/wiki/International_cooperation" },
    { label: "Keohane: After Hegemony", url: "https://en.wikipedia.org/wiki/After_Hegemony" }
  ]
},
"international relations theory (e.g., liberal institutionalism)": {
  label: "International Relations Theory (Liberal Institutionalism)",
  summary: "The IR paradigm arguing that international institutions — treaties, organizations, regimes, and norms — can facilitate cooperation among states by reducing transaction costs, providing information, and creating mechanisms for reciprocity and enforcement. Applied to AI governance, liberal institutionalism supports proposals for international AI safety bodies, multilateral AI agreements, and standards-setting organizations. Proponents argue that institutional frameworks can mitigate AI arms race dynamics even without full trust between competing powers.",
  example: "A cross-cutting node might invoke liberal institutionalism to advocate for an international AI safety organization modeled on the IAEA or WHO.",
  frequency: "Found in cross-cutting and safetyist POVs discussing international AI governance architectures.",
  links: [
    { label: "Wikipedia: Liberal Institutionalism", url: "https://en.wikipedia.org/wiki/Neoliberalism_(international_relations)" },
    { label: "Wikipedia: Regime Theory", url: "https://en.wikipedia.org/wiki/Regime_theory" }
  ]
},
"Interpretability and explainable AI": {
  label: "Interpretability and Explainable AI",
  summary: "The research area focused on making AI systems\' internal reasoning and decision-making processes understandable to humans. Interpretability seeks to build inherently transparent models or reveal learned representations, while explainability provides post-hoc accounts of model behavior. In AI policy, these capabilities are considered essential for accountability, trust, bias detection, and regulatory compliance. The EU AI Act and other frameworks increasingly mandate explainability for high-risk AI applications.",
  example: "A safetyist node might argue that interpretability research is a prerequisite for deploying AI in safety-critical domains like autonomous vehicles or medical diagnosis.",
  frequency: "Prominent across safetyist and cross-cutting POVs; accelerationist nodes sometimes view it as an impediment to deployment speed.",
  links: [
    { label: "Wikipedia: Explainable AI", url: "https://en.wikipedia.org/wiki/Explainable_artificial_intelligence" },
    { label: "Anthropic: Interpretability Research", url: "https://www.anthropic.com/research" },
    { label: "Christoph Molnar: Interpretable ML Book", url: "https://christophm.github.io/interpretable-ml-book/" }
  ]
},
"Iterative development methodologies": {
  label: "Iterative Development Methodologies",
  summary: "Software development approaches — including Agile, Scrum, and spiral models — that emphasize building systems through repeated cycles of design, implementation, testing, and refinement rather than a single linear process. In AI governance, iterative methodologies support arguments for adaptive regulation that evolves alongside technology, regulatory sandboxes that allow learning-by-doing, and continuous monitoring rather than one-time pre-deployment certification. These approaches contrast with calls for comprehensive upfront safety proofs before deployment.",
  example: "An accelerationist node might advocate for iterative AI deployment with continuous monitoring rather than lengthy pre-deployment safety reviews.",
  frequency: "Common in accelerationist and cross-cutting POVs; safetyist nodes express concern about deploying first and fixing later.",
  links: [
    { label: "Wikipedia: Iterative and Incremental Development", url: "https://en.wikipedia.org/wiki/Iterative_and_incremental_development" },
    { label: "Wikipedia: Agile Software Development", url: "https://en.wikipedia.org/wiki/Agile_software_development" }
  ]
},
"Keynesian economics (full employment goal)": {
  label: "Keynesian Economics (Full Employment Goal)",
  summary: "The macroeconomic tradition, rooted in John Maynard Keynes\'s work, that treats full employment as a primary policy objective and supports government intervention — fiscal stimulus, public investment, job guarantees — to achieve it. In AI policy, Keynesian full-employment concerns motivate proposals for public retraining programs, jobs guarantees, and fiscal responses to AI-driven displacement. The framework also raises questions about whether AI-driven productivity growth will generate sufficient aggregate demand to sustain employment.",
  example: "A cross-cutting node might invoke Keynesian economics to propose government job guarantee programs as a response to AI-driven unemployment.",
  frequency: "Appears in cross-cutting and skeptic POVs discussing labor market policy responses to AI.",
  links: [
    { label: "Wikipedia: Keynesian Economics", url: "https://en.wikipedia.org/wiki/Keynesian_economics" },
    { label: "Wikipedia: Full Employment", url: "https://en.wikipedia.org/wiki/Full_employment" }
  ]
},
"Labor economics": {
  label: "Labor Economics",
  summary: "The study of labor markets, wages, employment, and the dynamics between workers and employers. AI policy draws heavily on labor economics for analyzing automation\'s impact on jobs, the task-based framework distinguishing automatable from non-automatable work components, wage polarization, skill premiums, and the design of social safety nets. Key debates include whether AI will cause net job destruction or creation, which occupations face greatest displacement risk, and how labor market institutions should adapt.",
  example: "A cross-cutting node might apply the Autor-Levy-Murnane task framework from labor economics to estimate which job tasks are most susceptible to AI automation.",
  frequency: "Widespread across all POVs, with different emphases on displacement versus augmentation.",
  links: [
    { label: "Wikipedia: Labour Economics", url: "https://en.wikipedia.org/wiki/Labour_economics" },
    { label: "David Autor: Work of the Future", url: "https://workofthefuture.mit.edu/" }
  ]
},
"Labor theory of value": {
  label: "Labor Theory of Value",
  summary: "The economic theory, associated with classical economists and Marx, that the value of a commodity is determined by the socially necessary labor time required for its production. In AI debates, the labor theory of value raises provocative questions: if AI systems produce goods and services without human labor, how should value and ownership be attributed? This framework informs critiques of AI-driven wealth concentration and arguments for redistributing the economic gains of automation to workers whose labor trained the systems.",
  example: "A skeptic node might invoke the labor theory of value to argue that AI companies owe compensation to the workers whose data and labor were used to train their models.",
  frequency: "Occasional in skeptic and cross-cutting POVs discussing distributional justice.",
  links: [
    { label: "Wikipedia: Labor Theory of Value", url: "https://en.wikipedia.org/wiki/Labor_theory_of_value" },
    { label: "Stanford Encyclopedia: Marx\'s Economics", url: "https://plato.stanford.edu/entries/marx-economics/" }
  ]
},
"liberal political philosophy (individual rights)": {
  label: "Liberal Political Philosophy (Individual Rights)",
  summary: "The political philosophical tradition emphasizing the primacy of individual rights, civil liberties, and limited government, rooted in the works of Locke, Mill, and Rawls. In AI policy, liberal rights frameworks are invoked to protect individuals from algorithmic discrimination, assert rights to privacy and explanation in automated decision-making, and establish limits on state and corporate AI surveillance. The tension between individual rights and collective safety is a recurring theme in AI governance debates.",
  example: "A cross-cutting node might invoke liberal rights theory to argue that individuals have a right to know when AI is being used to make decisions about them.",
  frequency: "Common in cross-cutting and skeptic POVs; accelerationist nodes emphasize economic liberty aspects.",
  links: [
    { label: "Wikipedia: Liberalism", url: "https://en.wikipedia.org/wiki/Liberalism" },
    { label: "Stanford Encyclopedia: Liberalism", url: "https://plato.stanford.edu/entries/liberalism/" }
  ]
},
"Libertarian economic theory": {
  label: "Libertarian Economic Theory",
  summary: "Economic thought emphasizing free markets, minimal government intervention, private property rights, and voluntary exchange as the foundations of prosperity and individual freedom. In AI policy, libertarian economic theory opposes heavy-handed AI regulation, arguing that market competition, consumer choice, and common law provide sufficient governance mechanisms. Proponents contend that regulatory overreach will stifle innovation, entrench incumbents, and transfer decision-making power to less competent government actors.",
  example: "An accelerationist node might draw on libertarian economic theory to argue that AI safety should be market-driven rather than government-mandated.",
  frequency: "Strong in accelerationist POV; critiqued in safetyist and cross-cutting nodes.",
  links: [
    { label: "Wikipedia: Libertarianism", url: "https://en.wikipedia.org/wiki/Libertarianism" },
    { label: "Stanford Encyclopedia: Libertarianism", url: "https://plato.stanford.edu/entries/libertarianism/" }
  ]
},
"Libertarian economic thought": {
  label: "Libertarian Economic Thought",
  summary: "The tradition of economic reasoning associated with thinkers like Hayek, Friedman, and Mises, emphasizing that spontaneous market order, price signals, and voluntary exchange produce better outcomes than central planning or extensive regulation. Applied to AI, this tradition advocates for permissionless innovation, opposes precautionary regulation, and argues that competitive markets will naturally select for safe and beneficial AI systems. Critics counter that AI markets exhibit concentration, externalities, and information asymmetries that undermine libertarian assumptions.",
  example: "An accelerationist node might cite Friedman\'s arguments against occupational licensing to oppose AI practitioner certification requirements.",
  frequency: "Strong in accelerationist POV; critiqued in safetyist and cross-cutting nodes.",
  links: [
    { label: "Wikipedia: Libertarianism", url: "https://en.wikipedia.org/wiki/Libertarianism" },
    { label: "Wikipedia: Austrian School", url: "https://en.wikipedia.org/wiki/Austrian_school_of_economics" }
  ]
},
"Libertarianism": {
  label: "Libertarianism",
  summary: "A political philosophy prioritizing individual liberty, voluntary association, and skepticism of centralized authority. In AI governance debates, libertarian perspectives resist government AI regulation as paternalistic overreach, advocate for individual choice in AI adoption, and emphasize property rights and contract law as sufficient governance frameworks. Libertarian arguments intersect with the effective accelerationism movement in opposing what both see as excessive precaution and regulatory capture in AI policy.",
  example: "An accelerationist node might invoke libertarian principles to argue against mandatory AI licensing or government-run AI safety review boards.",
  frequency: "Strong in accelerationist POV; critiqued across safetyist and cross-cutting nodes.",
  links: [
    { label: "Wikipedia: Libertarianism", url: "https://en.wikipedia.org/wiki/Libertarianism" },
    { label: "Stanford Encyclopedia: Libertarianism", url: "https://plato.stanford.edu/entries/libertarianism/" }
  ]
},
"Long-term AI risk": {
  label: "Long-term AI Risk",
  summary: "The category of risks from AI systems that may not manifest immediately but could emerge as AI capabilities increase over years or decades, including loss of human control, value lock-in, gradual erosion of human autonomy, and civilizational-scale catastrophe. Long-term AI risk analysis distinguishes itself from near-term AI ethics (bias, fairness, privacy) by focusing on scenarios involving highly capable or superintelligent systems. This framing is contested by those who argue it diverts attention from present harms.",
  example: "A safetyist node might argue that long-term AI risk should receive priority funding even if near-term AI harms are more certain and immediate.",
  frequency: "Central to safetyist POV; contested by skeptic nodes favoring near-term focus.",
  links: [
    { label: "Wikipedia: Existential Risk from AI", url: "https://en.wikipedia.org/wiki/Existential_risk_from_artificial_general_intelligence" },
    { label: "Future of Life Institute", url: "https://futureoflife.org/" }
  ]
},
"Long-termism (existential risk mitigation)": {
  label: "Long-termism (Existential Risk Mitigation)",
  summary: "The philosophical and practical commitment to prioritizing actions that reduce existential risk and positively shape the far future, applied specifically to AI safety and governance. This perspective argues that the expected value of preventing human extinction or permanent civilizational setback is so large that it justifies substantial present-day investment in alignment research, AI governance, and risk assessment, even given uncertainty about future AI capabilities. It represents the intersection of long-termist ethics and concrete AI safety work.",
  example: "A safetyist node might use long-termist reasoning to justify funding alignment research over addressing current algorithmic bias.",
  frequency: "Core to safetyist POV; critiqued by skeptic nodes as speculative and potentially neglectful of present harms.",
  links: [
    { label: "Wikipedia: Longtermism", url: "https://en.wikipedia.org/wiki/Longtermism" },
    { label: "80,000 Hours: Longtermism", url: "https://80000hours.org/articles/future-generations/" }
  ]
},
"Longtermism": {
  label: "Longtermism",
  summary: "The ethical view that positively influencing the long-term future is a key moral priority, based on the argument that future generations vastly outnumber the present and that we can take actions today that significantly affect long-run outcomes. Popularized by philosophers William MacAskill and Toby Ord, longtermism provides the philosophical foundation for treating AI existential risk as a top-priority cause area. Critics argue that longtermism neglects present injustices, relies on speculative reasoning, and may justify ethically questionable trade-offs.",
  example: "A safetyist node might cite longtermist ethics to justify prioritizing AI alignment research over more immediate social welfare programs.",
  frequency: "Core to safetyist POV; actively debated in skeptic and cross-cutting nodes.",
  links: [
    { label: "Wikipedia: Longtermism", url: "https://en.wikipedia.org/wiki/Longtermism" },
    { label: "William MacAskill: What We Owe the Future", url: "https://whatweowethefuture.com/" },
    { label: "Stanford Encyclopedia: Future Generations", url: "https://plato.stanford.edu/entries/future-generations/" }
  ]
},
"Luddism (modern interpretation)": {
  label: "Luddism (Modern Interpretation)",
  summary: "A contemporary reinterpretation of the 19th-century Luddite movement that reframes it not as irrational technophobia but as rational resistance to technological changes that concentrate power and undermine workers\' livelihoods and autonomy. Modern neo-Luddism, as articulated by thinkers like Brian Merchant and Gavin Mueller, argues that technology adoption decisions should be democratic rather than imposed by capital, and that workers have legitimate grounds to resist automation that primarily benefits owners. Applied to AI, this perspective challenges the assumption that AI deployment is inevitable or inherently progressive.",
  example: "A skeptic node might invoke modern Luddism to argue that workers should have democratic input into whether and how AI is deployed in their industries.",
  frequency: "Found in skeptic POV; occasionally referenced in cross-cutting labor discussions.",
  links: [
    { label: "Wikipedia: Neo-Luddism", url: "https://en.wikipedia.org/wiki/Neo-Luddism" },
    { label: "Brian Merchant: Blood in the Machine", url: "https://www.hachettebookgroup.com/titles/brian-merchant/blood-in-the-machine/9780316487740/" }
  ]
},


"Machine learning (fine-tuning, reinforcement learning)": {
    label: "Machine Learning (Fine-Tuning, Reinforcement Learning)",
    summary: "Core ML techniques where fine-tuning adapts pre-trained models to specific tasks and reinforcement learning trains agents via reward signals. These methods underpin modern AI capabilities from large language models to game-playing agents. In AI policy, they raise questions about who controls the fine-tuning process, how RLHF shapes model behavior, and whether reinforcement learning can produce unpredictable optimization targets.",
    example: "A node might reference fine-tuning and RL as mechanisms through which AI systems acquire capabilities that outpace safety evaluation.",
    frequency: "All POVs — accelerationists emphasize capability gains, safetyists focus on alignment risks from RL, skeptics question generalization claims.",
    links: [
      { label: "Fine-tuning (Wikipedia)", url: "https://en.wikipedia.org/wiki/Fine-tuning_(deep_learning)" },
      { label: "Reinforcement Learning (Wikipedia)", url: "https://en.wikipedia.org/wiki/Reinforcement_learning" },
      { label: "RLHF — OpenAI", url: "https://openai.com/research/learning-from-human-preferences" }
    ]
  },
  "Machine learning privacy attacks": {
    label: "Machine Learning Privacy Attacks",
    summary: "A class of adversarial techniques that exploit ML models to extract or infer private training data. These include membership inference attacks, model inversion, and data extraction from large language models. Privacy attacks demonstrate that trained models can inadvertently memorize and leak sensitive information, complicating deployment in healthcare, finance, and other regulated domains. They motivate differential privacy, federated learning, and stricter data governance in AI policy.",
    example: "A node may cite privacy attacks as evidence that deploying AI systems without robust safeguards exposes individuals\' personal data.",
    frequency: "Safetyist and cross-cutting nodes primarily; skeptics reference them to challenge claims of secure AI deployment.",
    links: [
      { label: "Membership Inference Attacks (Wikipedia)", url: "https://en.wikipedia.org/wiki/Membership_inference_attack" },
      { label: "Model Inversion (Wikipedia)", url: "https://en.wikipedia.org/wiki/Model_inversion_attack" },
      { label: "Extracting Training Data from LLMs — Carlini et al.", url: "https://arxiv.org/abs/2012.07805" }
    ]
  },
  "market-based regulation": {
    label: "Market-Based Regulation",
    summary: "A regulatory philosophy that uses market mechanisms — such as taxes, tradable permits, liability rules, and insurance requirements — rather than command-and-control mandates to achieve policy objectives. In AI governance, proponents argue that market-based approaches like mandatory AI liability insurance or compute taxes can internalize externalities without stifling innovation. Critics counter that information asymmetries and market power in the AI industry undermine the assumptions on which market regulation depends.",
    example: "A node might advocate for market-based regulation as a flexible alternative to prescriptive AI licensing regimes.",
    frequency: "Accelerationist and cross-cutting nodes; skeptics sometimes invoke it to argue against heavy-handed AI regulation.",
    links: [
      { label: "Market-Based Instruments (Wikipedia)", url: "https://en.wikipedia.org/wiki/Market-based_instruments" },
      { label: "Regulatory Economics (Wikipedia)", url: "https://en.wikipedia.org/wiki/Regulatory_economics" }
    ]
  },
  "Marxist class analysis": {
    label: "Marxist Class Analysis",
    summary: "An analytical framework rooted in Marx\'s theory that society is structured by relations between classes defined by their position relative to the means of production. Applied to AI, it examines how ownership of compute infrastructure, training data, and AI models concentrates power among a techno-capitalist class while displacing or deskilling workers. This lens foregrounds questions of labor exploitation, surplus value extraction through automation, and the political interests driving AI development narratives.",
    example: "A node may use Marxist class analysis to argue that AI-driven productivity gains primarily accrue to capital owners rather than workers.",
    frequency: "Cross-cutting and skeptic nodes; occasionally referenced critically in accelerationist discussions.",
    links: [
      { label: "Class Conflict (Wikipedia)", url: "https://en.wikipedia.org/wiki/Class_conflict" },
      { label: "Marxian Economics (Wikipedia)", url: "https://en.wikipedia.org/wiki/Marxian_economics" }
    ]
  },
  "Marxist critique of capitalism": {
    label: "Marxist Critique of Capitalism",
    summary: "The body of critical theory originating with Karl Marx that identifies internal contradictions of capitalism — commodity fetishism, alienation, crises of overproduction, and the tendency of the rate of profit to fall. In AI policy discourse, this critique frames the AI boom as a new phase of capitalist accumulation that deepens inequality, commodifies human cognition, and creates speculative bubbles around AI firms. It challenges the assumption that technological progress under capitalism automatically benefits society.",
    example: "A node might invoke the Marxist critique to question whether AI-driven economic growth addresses structural inequality or exacerbates it.",
    frequency: "Skeptic and cross-cutting POVs; accelerationists occasionally engage with it to rebut anti-market arguments.",
    links: [
      { label: "Critique of Capitalism (Wikipedia)", url: "https://en.wikipedia.org/wiki/Criticism_of_capitalism" },
      { label: "Das Kapital (Wikipedia)", url: "https://en.wikipedia.org/wiki/Das_Kapital" }
    ]
  },
  "Marxist theories of historical materialism": {
    label: "Marxist Theories of Historical Materialism",
    summary: "The Marxist theory that material conditions of production — not ideas or ideology — drive historical change through successive modes of production (feudalism, capitalism, socialism). Applied to AI, historical materialism suggests that transformations in the means of production (compute, data, algorithms) will reshape social relations, class structures, and political institutions. This framework is used to argue that AI represents a qualitative shift in productive forces that could either entrench capitalist relations or enable post-capitalist organization.",
    example: "A node may cite historical materialism to frame AI as a new productive force that will inevitably transform social and economic relations.",
    frequency: "Cross-cutting and skeptic POVs; used as a structural lens for long-term AI impact analysis.",
    links: [
      { label: "Historical Materialism (Wikipedia)", url: "https://en.wikipedia.org/wiki/Historical_materialism" },
      { label: "Mode of Production (Wikipedia)", url: "https://en.wikipedia.org/wiki/Mode_of_production" }
    ]
  },
  "Marxist theory (means of production)": {
    label: "Marxist Theory (Means of Production)",
    summary: "The Marxist concept that whoever owns the means of production — factories, land, tools, and now compute infrastructure and AI models — holds dominant economic and political power. In the AI era, this theory highlights the extreme concentration of AI capabilities among a handful of corporations controlling GPU clusters, proprietary datasets, and foundational models. It raises questions about whether AI democratization is meaningful without redistributing ownership of the underlying computational means of production.",
    example: "A node might argue that control over AI training infrastructure constitutes a new form of ownership of the means of production.",
    frequency: "Skeptic and cross-cutting nodes; accelerationist nodes sometimes counter by emphasizing open-source access.",
    links: [
      { label: "Means of Production (Wikipedia)", url: "https://en.wikipedia.org/wiki/Means_of_production" },
      { label: "Capital (economics) (Wikipedia)", url: "https://en.wikipedia.org/wiki/Capital_(economics)" }
    ]
  },
  "Media effects theory": {
    label: "Media Effects Theory",
    summary: "A broad family of communication theories studying how media influences audiences\' attitudes, beliefs, and behaviors. In AI policy, media effects theory helps explain how narratives about AI — whether utopian or dystopian — shape public opinion, policy preferences, and investment decisions. It encompasses agenda-setting, framing, cultivation theory, and persuasion models, all relevant to understanding how AI hype cycles and fear narratives propagate through media ecosystems.",
    example: "A node may reference media effects theory to explain how science fiction tropes shape public perceptions of AI risk.",
    frequency: "Skeptic and cross-cutting POVs primarily; used to critique both accelerationist hype and safetyist alarm.",
    links: [
      { label: "Media Influence (Wikipedia)", url: "https://en.wikipedia.org/wiki/Media_influence" },
      { label: "Agenda-Setting Theory (Wikipedia)", url: "https://en.wikipedia.org/wiki/Agenda-setting_theory" }
    ]
  },
  "Media effects theory (limited effects model)": {
    label: "Media Effects Theory (Limited Effects Model)",
    summary: "A specific branch of media effects research arguing that media has only limited direct influence on audiences, who actively filter messages through pre-existing beliefs, social networks, and personal experience. Applied to AI discourse, the limited effects model suggests that AI hype or panic narratives in media may have less impact on public behavior and policy than assumed, because people interpret AI news through their own economic circumstances and professional experience. This challenges both accelerationist marketing narratives and safetyist alarm campaigns.",
    example: "A node might invoke the limited effects model to argue that media coverage of AI risks has less policy impact than direct economic experience with automation.",
    frequency: "Skeptic POV primarily; cross-cutting nodes use it to temper claims about media-driven AI policy.",
    links: [
      { label: "Limited Effects Theory (Wikipedia)", url: "https://en.wikipedia.org/wiki/Limited_effects_theory" },
      { label: "Two-Step Flow of Communication (Wikipedia)", url: "https://en.wikipedia.org/wiki/Two-step_flow_of_communication" }
    ]
  },
  "media studies (framing analysis)": {
    label: "Media Studies (Framing Analysis)",
    summary: "A research methodology from media and communication studies that examines how issues are presented — or framed — to influence interpretation. Framing analysis reveals how the same AI development can be portrayed as a breakthrough, a threat, or a bubble depending on the narrative frame chosen. In AI policy, this approach is used to deconstruct how industry, government, and advocacy groups strategically frame AI narratives to advance their interests.",
    example: "A node may apply framing analysis to show how \'AI safety\' vs. \'AI freedom\' frames produce different policy responses to the same technology.",
    frequency: "Skeptic and cross-cutting POVs; used to critically examine accelerationist and safetyist rhetoric alike.",
    links: [
      { label: "Framing (social sciences) (Wikipedia)", url: "https://en.wikipedia.org/wiki/Framing_(social_sciences)" },
      { label: "Framing Effect (Wikipedia)", url: "https://en.wikipedia.org/wiki/Framing_effect_(psychology)" }
    ]
  },
  "Military-industrial complex": {
    label: "Military-Industrial Complex",
    summary: "The network of relationships between a nation\'s military, its arms industry, and associated political and commercial interests, as warned about by President Eisenhower in 1961. In AI policy, the concept is invoked to describe how defense agencies, major tech firms, and AI startups form a self-reinforcing ecosystem that channels AI development toward military applications and surveillance. Critics argue this complex distorts research priorities, absorbs talent, and normalizes the weaponization of AI systems.",
    example: "A node might reference the military-industrial complex to argue that defense funding shapes AI research agendas in ways that prioritize offensive capabilities over safety.",
    frequency: "Skeptic and cross-cutting POVs; safetyist nodes reference it in discussions of autonomous weapons.",
    links: [
      { label: "Military-Industrial Complex (Wikipedia)", url: "https://en.wikipedia.org/wiki/Military%E2%80%93industrial_complex" },
      { label: "Project Maven (Wikipedia)", url: "https://en.wikipedia.org/wiki/Project_Maven" }
    ]
  },
  "Mind uploading concepts": {
    label: "Mind Uploading Concepts",
    summary: "The hypothetical process of scanning a biological brain and transferring its mental content — memories, personality, consciousness — to a computational substrate. Mind uploading is a recurring theme in transhumanist and accelerationist AI discourse, often invoked as a potential pathway to digital immortality or post-biological existence. In AI policy, the concept raises profound questions about personhood, rights of digital entities, and whether such scenarios should inform near-term governance decisions or are distracting speculations.",
    example: "A node may reference mind uploading as an example of speculative AI futures that nonetheless influence current policy framing around AI consciousness.",
    frequency: "Accelerationist POV primarily; skeptics critique it as unfounded speculation; safetyists may reference it in discussions of moral status.",
    links: [
      { label: "Mind Uploading (Wikipedia)", url: "https://en.wikipedia.org/wiki/Mind_uploading" },
      { label: "Whole Brain Emulation (Wikipedia)", url: "https://en.wikipedia.org/wiki/Whole_brain_emulation" }
    ]
  },
  "Moore's Law (analogous)": {
    label: "Moore\'s Law (Analogous)",
    summary: "The application of Moore\'s Law-style reasoning — the observation that semiconductor transistor density doubles roughly every two years — to AI progress, particularly compute scaling, model size growth, and performance benchmarks. Analogous Moore\'s Law claims are used to project exponential AI capability improvements, underpinning both accelerationist timelines and safetyist urgency arguments. Skeptics note that exponential trends in one metric do not guarantee proportional gains in useful capability and that physical, economic, and data limits may cause plateaus.",
    example: "A node might invoke Moore\'s Law analogies to argue that AI capabilities will continue exponential growth, demanding preemptive governance.",
    frequency: "Accelerationist and safetyist POVs; skeptics challenge the analogy as overly simplistic.",
    links: [
      { label: "Moore\'s Law (Wikipedia)", url: "https://en.wikipedia.org/wiki/Moore%27s_law" },
      { label: "AI and Compute — OpenAI", url: "https://openai.com/research/ai-and-compute" }
    ]
  },
  "Moore's Law extrapolation": {
    label: "Moore\'s Law Extrapolation",
    summary: "The practice of extending Moore\'s Law trends into the future to predict continued exponential growth in computing power and, by extension, AI capabilities. Extrapolation arguments are central to claims about imminent transformative AI, AGI timelines, and the urgency of safety research. Critics point out that Moore\'s Law has already slowed for traditional semiconductors and that extrapolating hardware trends to AI capability is a category error that conflates compute availability with algorithmic and empirical progress.",
    example: "A node may use Moore\'s Law extrapolation to project when AI systems will exceed human-level performance on various benchmarks.",
    frequency: "Accelerationist and safetyist POVs for projections; skeptics use it to illustrate the dangers of naive extrapolation.",
    links: [
      { label: "Moore\'s Law (Wikipedia)", url: "https://en.wikipedia.org/wiki/Moore%27s_law" },
      { label: "The End of Moore\'s Law (MIT Tech Review)", url: "https://www.technologyreview.com/2020/02/24/905789/were-not-prepared-for-the-end-of-moores-law/" }
    ]
  },
  "Multi-agent systems": {
    label: "Multi-Agent Systems",
    summary: "Systems composed of multiple interacting autonomous agents, each with their own goals, knowledge, and decision-making capabilities. In AI, multi-agent systems raise unique safety and governance challenges because emergent behaviors can arise from agent interactions that were not designed or anticipated by any single developer. Policy concerns include coordination failures, competitive dynamics between AI agents, and the difficulty of assigning responsibility when autonomous agents interact in complex environments.",
    example: "A node might reference multi-agent systems to argue that AI safety must address emergent risks from interacting autonomous systems, not just individual models.",
    frequency: "Safetyist and cross-cutting POVs; accelerationists discuss them as a path to more capable AI ecosystems.",
    links: [
      { label: "Multi-Agent System (Wikipedia)", url: "https://en.wikipedia.org/wiki/Multi-agent_system" },
      { label: "Emergent Behavior (Wikipedia)", url: "https://en.wikipedia.org/wiki/Emergent_behavior" }
    ]
  },
  "Multi-stakeholder governance models": {
    label: "Multi-Stakeholder Governance Models",
    summary: "Governance frameworks that include representatives from government, industry, civil society, academia, and affected communities in decision-making processes. For AI governance, multi-stakeholder models are proposed as a way to balance competing interests, incorporate diverse expertise, and build legitimacy for AI regulations. Examples include ICANN for internet governance and the OECD AI Policy Observatory. Critics argue these models can be captured by well-resourced corporate participants or produce lowest-common-denominator outcomes.",
    example: "A node may advocate for multi-stakeholder governance as the most legitimate approach to setting international AI standards.",
    frequency: "Cross-cutting POV primarily; all POVs engage with governance structure debates.",
    links: [
      { label: "Multistakeholder Governance (Wikipedia)", url: "https://en.wikipedia.org/wiki/Multistakeholder_governance_model" },
      { label: "OECD AI Policy Observatory", url: "https://oecd.ai/" },
      { label: "Internet Governance Forum (Wikipedia)", url: "https://en.wikipedia.org/wiki/Internet_Governance_Forum" }
    ]
  },
  "National security policy": {
    label: "National Security Policy",
    summary: "The set of governmental strategies, doctrines, and institutions designed to protect a nation\'s sovereignty, territory, and critical interests. AI has become a central concern of national security policy due to its applications in intelligence, cyberwarfare, autonomous weapons, and economic competitiveness. National security framing of AI can accelerate military AI development, restrict international collaboration, and justify export controls on chips and models, creating tensions with open science and global governance approaches.",
    example: "A node might argue that national security policy drives an AI arms race that undermines multilateral safety cooperation.",
    frequency: "All POVs — accelerationists support strategic AI investment, safetyists worry about arms races, skeptics question securitization of AI.",
    links: [
      { label: "National Security (Wikipedia)", url: "https://en.wikipedia.org/wiki/National_security" },
      { label: "NSCAI Final Report", url: "https://www.nscai.gov/2021-final-report/" }
    ]
  },
  "Neoclassical economics": {
    label: "Neoclassical Economics",
    summary: "The dominant school of economic thought emphasizing rational agents, market equilibrium, and marginal analysis. In AI policy debates, neoclassical frameworks are used to model AI\'s impact on labor markets, productivity, and growth through standard supply-demand and production-function analysis. Critics argue that neoclassical assumptions — perfect information, rational actors, diminishing returns — fail to capture the winner-take-all dynamics, network effects, and radical uncertainty characteristic of AI markets.",
    example: "A node may apply neoclassical economics to model AI-driven productivity growth while acknowledging its limitations in capturing distributional effects.",
    frequency: "Accelerationist and cross-cutting POVs; skeptics critique its assumptions as inadequate for analyzing AI disruption.",
    links: [
      { label: "Neoclassical Economics (Wikipedia)", url: "https://en.wikipedia.org/wiki/Neoclassical_economics" },
      { label: "Solow Growth Model (Wikipedia)", url: "https://en.wikipedia.org/wiki/Solow%E2%80%93Swan_model" }
    ]
  },
  "Neoliberal globalization (extreme forms)": {
    label: "Neoliberal Globalization (Extreme Forms)",
    summary: "The most aggressive manifestations of neoliberal globalization — unrestricted capital flows, radical deregulation, privatization of public goods, and the subordination of national policy to global market forces. In AI policy, this concept describes how the push for frictionless global AI deployment may override national labor protections, data sovereignty, and democratic governance. Extreme neoliberal globalization in AI could concentrate power among a few multinational corporations while eroding the capacity of states to regulate AI on behalf of their citizens.",
    example: "A node might critique extreme neoliberal globalization as enabling tech multinationals to arbitrage AI regulations across jurisdictions.",
    frequency: "Skeptic and cross-cutting POVs; accelerationists may defend global markets while distancing from \'extreme\' framing.",
    links: [
      { label: "Neoliberalism (Wikipedia)", url: "https://en.wikipedia.org/wiki/Neoliberalism" },
      { label: "Globalization (Wikipedia)", url: "https://en.wikipedia.org/wiki/Globalization" }
    ]
  },
  "Neoliberal market theory": {
    label: "Neoliberal Market Theory",
    summary: "An economic and political philosophy advocating free markets, minimal state intervention, privatization, and deregulation as the optimal path to economic prosperity. In AI governance, neoliberal market theory underpins arguments that innovation-friendly regulatory environments, light-touch oversight, and market competition will produce better AI outcomes than heavy government regulation. Critics contend that AI markets exhibit natural monopoly tendencies and externalities that market forces alone cannot address.",
    example: "A node may invoke neoliberal market theory to argue against prescriptive AI regulation in favor of industry self-governance.",
    frequency: "Accelerationist POV primarily; skeptics and cross-cutting nodes critique its assumptions.",
    links: [
      { label: "Neoliberalism (Wikipedia)", url: "https://en.wikipedia.org/wiki/Neoliberalism" },
      { label: "Free Market (Wikipedia)", url: "https://en.wikipedia.org/wiki/Free_market" }
    ]
  },
  "Network effects theory": {
    label: "Network Effects Theory",
    summary: "The economic principle that a product or service gains additional value as more people use it, creating positive feedback loops and often winner-take-all market dynamics. Network effects are central to understanding AI market concentration: platforms with more users generate more data, which improves AI models, which attracts more users. This dynamic helps explain why a few AI firms dominate and why interoperability, data portability, and antitrust policy are critical governance issues.",
    example: "A node might cite network effects to explain why AI platform monopolies are self-reinforcing and resistant to market correction.",
    frequency: "Cross-cutting and skeptic POVs; accelerationists acknowledge network effects as a driver of scale.",
    links: [
      { label: "Network Effect (Wikipedia)", url: "https://en.wikipedia.org/wiki/Network_effect" },
      { label: "Platform Economy (Wikipedia)", url: "https://en.wikipedia.org/wiki/Platform_economy" }
    ]
  },
  "Nuclear Arms Race analogy": {
    label: "Nuclear Arms Race Analogy",
    summary: "The comparison between the Cold War nuclear arms race and the current competitive dynamics in AI development among nations and corporations. This analogy highlights how mutual distrust, first-mover advantages, and existential stakes can drive an escalatory spiral where safety is sacrificed for speed. It is used to argue for international AI treaties, confidence-building measures, and arms control-style agreements. Critics note important disanalogies: AI is dual-use, widely distributed, and lacks the clear destructive threshold of nuclear weapons.",
    example: "A node may draw the nuclear arms race analogy to argue that international AI cooperation is needed to avoid a destabilizing capability race.",
    frequency: "Safetyist and cross-cutting POVs primarily; skeptics challenge the analogy\'s validity.",
    links: [
      { label: "Nuclear Arms Race (Wikipedia)", url: "https://en.wikipedia.org/wiki/Nuclear_arms_race" },
      { label: "Arms Race (Wikipedia)", url: "https://en.wikipedia.org/wiki/Arms_race" }
    ]
  },
  "nuclear nonproliferation analogy": {
    label: "Nuclear Nonproliferation Analogy",
    summary: "The comparison between nuclear nonproliferation frameworks — which restrict the spread of nuclear weapons through treaties, inspections, and export controls — and proposed approaches to governing dangerous AI capabilities. This analogy suggests that AI models above certain capability thresholds could be subject to similar access restrictions, international monitoring, and controlled distribution. Critics question whether AI, as software that can be copied and run on commodity hardware, is amenable to the same containment strategies that work for fissile materials.",
    example: "A node might use the nonproliferation analogy to propose international agreements limiting the distribution of frontier AI models.",
    frequency: "Safetyist and cross-cutting POVs; skeptics and accelerationists challenge the analogy\'s feasibility.",
    links: [
      { label: "Treaty on the Non-Proliferation of Nuclear Weapons (Wikipedia)", url: "https://en.wikipedia.org/wiki/Treaty_on_the_Non-Proliferation_of_Nuclear_Weapons" },
      { label: "Nuclear Nonproliferation (IAEA)", url: "https://www.iaea.org/topics/non-proliferation" }
    ]
  },
  "Nuclear nonproliferation analogy": {
    label: "Nuclear Nonproliferation Analogy",
    summary: "The comparison between nuclear nonproliferation frameworks — which restrict the spread of nuclear weapons through treaties, inspections, and export controls — and proposed approaches to governing dangerous AI capabilities. This analogy suggests that AI models above certain capability thresholds could be subject to similar access restrictions, international monitoring, and controlled distribution. Critics question whether AI, as software that can be copied and run on commodity hardware, is amenable to the same containment strategies that work for fissile materials.",
    example: "A node might use the nonproliferation analogy to propose international agreements limiting the distribution of frontier AI models.",
    frequency: "Safetyist and cross-cutting POVs; skeptics and accelerationists challenge the analogy\'s feasibility.",
    links: [
      { label: "Treaty on the Non-Proliferation of Nuclear Weapons (Wikipedia)", url: "https://en.wikipedia.org/wiki/Treaty_on_the_Non-Proliferation_of_Nuclear_Weapons" },
      { label: "Nuclear Nonproliferation (IAEA)", url: "https://www.iaea.org/topics/non-proliferation" }
    ]
  },
  "Nuclear nonproliferation treaties": {
    label: "Nuclear Nonproliferation Treaties",
    summary: "International legal instruments, principally the Treaty on the Non-Proliferation of Nuclear Weapons (NPT), designed to prevent the spread of nuclear weapons and promote disarmament. In AI governance, these treaties serve as models for proposed international AI agreements that would restrict the development or deployment of dangerous AI systems. The NPT framework — with its tiers of recognized capabilities, inspection regimes, and technology-sharing provisions — offers a template that AI policy scholars adapt for governing frontier AI, though the enforceability challenges differ substantially.",
    example: "A node may reference nuclear nonproliferation treaties as precedent for creating an international AI governance regime with tiered access and verification.",
    frequency: "Safetyist and cross-cutting POVs; accelerationists may view such frameworks as impractical for software.",
    links: [
      { label: "Treaty on the Non-Proliferation of Nuclear Weapons (Wikipedia)", url: "https://en.wikipedia.org/wiki/Treaty_on_the_Non-Proliferation_of_Nuclear_Weapons" },
      { label: "IAEA Safeguards", url: "https://www.iaea.org/topics/safeguards" }
    ]
  },
  "nuclear nonproliferation treaty": {
    label: "Nuclear Nonproliferation Treaty",
    summary: "The Treaty on the Non-Proliferation of Nuclear Weapons (NPT), signed in 1968, which established a framework to prevent nuclear weapons spread, promote disarmament, and facilitate peaceful use of nuclear energy. In AI policy, the NPT is frequently cited as a model for international AI governance — particularly proposals for compute governance, model access tiers, and international AI safety inspectorates. The treaty\'s three-pillar structure (nonproliferation, disarmament, peaceful use) offers a conceptual framework for balancing AI access with risk management.",
    example: "A node might reference the NPT as a template for an international agreement governing access to frontier AI training infrastructure.",
    frequency: "Safetyist and cross-cutting POVs; accelerationists and skeptics debate its applicability to AI.",
    links: [
      { label: "Treaty on the Non-Proliferation of Nuclear Weapons (Wikipedia)", url: "https://en.wikipedia.org/wiki/Treaty_on_the_Non-Proliferation_of_Nuclear_Weapons" },
      { label: "IAEA — Non-Proliferation", url: "https://www.iaea.org/topics/non-proliferation" }
    ]
  },
  "Open innovation": {
    label: "Open Innovation",
    summary: "A business and research paradigm coined by Henry Chesbrough arguing that firms should use external ideas and paths to market alongside internal ones, and that internal ideas can also reach market through external channels. In AI, open innovation manifests as shared benchmarks, open datasets, collaborative research between industry and academia, and API-based model access. Proponents argue it accelerates progress and diffuses AI benefits; critics worry it can enable misuse and undermine safety by making dangerous capabilities widely available.",
    example: "A node may advocate for open innovation in AI research as a way to distribute benefits while maintaining competitive dynamics.",
    frequency: "Accelerationist and cross-cutting POVs; safetyists raise concerns about open access to dangerous capabilities.",
    links: [
      { label: "Open Innovation (Wikipedia)", url: "https://en.wikipedia.org/wiki/Open_innovation" },
      { label: "Henry Chesbrough (Wikipedia)", url: "https://en.wikipedia.org/wiki/Henry_Chesbrough" }
    ]
  },
  "Open Philanthropy (some interpretations of AI safety as a race)": {
    label: "Open Philanthropy (AI Safety as a Race)",
    summary: "Open Philanthropy is a major philanthropic foundation that has been one of the largest funders of AI safety research and organizations. Some interpretations of its grantmaking strategy suggest it frames AI safety as a race against capability development — funding safety labs and governance organizations to keep pace with or preempt frontier AI development. This framing is controversial: supporters see it as pragmatic urgency, while critics argue it reinforces the race dynamic it purports to counter and concentrates influence over AI policy within a narrow effective altruism network.",
    example: "A node may reference Open Philanthropy\'s AI safety funding as evidence that the safety community has adopted a race framing with implications for governance strategy.",
    frequency: "Cross-cutting and skeptic POVs; safetyists engage with Open Philanthropy\'s strategic framing directly.",
    links: [
      { label: "Open Philanthropy", url: "https://www.openphilanthropy.org/" },
      { label: "Open Philanthropy — AI Safety", url: "https://www.openphilanthropy.org/focus/potential-risks-advanced-artificial-intelligence/" }
    ]
  },
  "Open science movement": {
    label: "Open Science Movement",
    summary: "A broad movement advocating for transparency, open access, reproducibility, and collaboration in scientific research. In AI, the open science movement promotes publishing model architectures, training data, evaluation benchmarks, and research code openly. It has driven significant AI progress through shared resources but creates tension with safety concerns about publishing capabilities that could be misused, and with commercial interests that profit from proprietary models.",
    example: "A node may cite the open science movement as a counterweight to corporate AI secrecy, arguing that transparency improves both safety and innovation.",
    frequency: "Accelerationist and cross-cutting POVs; safetyists debate the boundaries of openness for frontier research.",
    links: [
      { label: "Open Science (Wikipedia)", url: "https://en.wikipedia.org/wiki/Open_science" },
      { label: "UNESCO Recommendation on Open Science", url: "https://www.unesco.org/en/open-science" }
    ]
  },
  "Open Source Movement": {
    label: "Open Source Movement",
    summary: "The movement promoting software whose source code is freely available for use, modification, and redistribution. In AI, the open source movement has produced foundational tools (TensorFlow, PyTorch, Hugging Face) and open-weight models that democratize access to AI capabilities. Policy debates center on whether open-sourcing powerful AI models is a net benefit — enabling scrutiny and broad access — or a risk, making dangerous capabilities available to malicious actors. The movement also challenges proprietary AI firms\' control over the technology.",
    example: "A node might invoke the open source movement to argue that open AI models enable broader safety research and reduce corporate gatekeeping.",
    frequency: "Accelerationist POV strongly; cross-cutting nodes weigh tradeoffs; safetyists debate open-source risks.",
    links: [
      { label: "Open-Source Movement (Wikipedia)", url: "https://en.wikipedia.org/wiki/Open-source-software_movement" },
      { label: "Open Source Initiative", url: "https://opensource.org/" }
    ]
  },
  "Open Source Software Movement": {
    label: "Open Source Software Movement",
    summary: "The movement promoting software whose source code is freely available for use, modification, and redistribution. In AI, the open source software movement has produced foundational tools (TensorFlow, PyTorch, Hugging Face) and open-weight models that democratize access to AI capabilities. Policy debates center on whether open-sourcing powerful AI models is a net benefit — enabling scrutiny and broad access — or a risk, making dangerous capabilities available to malicious actors. The movement also challenges proprietary AI firms\' control over the technology.",
    example: "A node might reference the open source software movement to argue that transparent AI development produces safer, more trustworthy systems.",
    frequency: "Accelerationist POV strongly; cross-cutting nodes weigh tradeoffs; safetyists debate open-source risks.",
    links: [
      { label: "Open-Source Software Movement (Wikipedia)", url: "https://en.wikipedia.org/wiki/Open-source-software_movement" },
      { label: "Open Source Initiative", url: "https://opensource.org/" }
    ]
  },
  "Open-source movement": {
    label: "Open-Source Movement",
    summary: "The movement promoting software whose source code is freely available for use, modification, and redistribution. In AI, the open-source movement has produced foundational tools (TensorFlow, PyTorch, Hugging Face) and open-weight models that democratize access to AI capabilities. Policy debates center on whether open-sourcing powerful AI models is a net benefit — enabling scrutiny and broad access — or a risk, making dangerous capabilities available to malicious actors. The movement also challenges proprietary AI firms\' control over the technology.",
    example: "A node might cite the open-source movement as essential for preventing monopolistic control over AI capabilities.",
    frequency: "Accelerationist POV strongly; cross-cutting nodes weigh tradeoffs; safetyists debate open-source risks.",
    links: [
      { label: "Open-Source Software Movement (Wikipedia)", url: "https://en.wikipedia.org/wiki/Open-source-software_movement" },
      { label: "Open Source Initiative", url: "https://opensource.org/" }
    ]
  },
  "Open-source movement philosophy": {
    label: "Open-Source Movement Philosophy",
    summary: "The philosophical underpinnings of the open-source movement, rooted in principles of transparency, collaborative development, meritocracy, and the belief that software freedom is both instrumentally and intrinsically valuable. In AI policy, this philosophy informs arguments that AI systems affecting public welfare should be auditable, that model weights should be openly shared to prevent power concentration, and that collaborative development produces more robust and safer systems. The philosophy also connects to broader debates about intellectual property, commons-based peer production, and digital rights.",
    example: "A node may invoke open-source philosophy to argue that proprietary AI models used in high-stakes decisions violate principles of democratic accountability.",
    frequency: "Accelerationist and cross-cutting POVs; safetyists engage with the philosophy when debating responsible disclosure of AI capabilities.",
    links: [
      { label: "Open-Source Software Movement (Wikipedia)", url: "https://en.wikipedia.org/wiki/Open-source-software_movement" },
      { label: "Free Software Foundation", url: "https://www.fsf.org/" },
      { label: "The Cathedral and the Bazaar (Wikipedia)", url: "https://en.wikipedia.org/wiki/The_Cathedral_and_the_Bazaar" }
    ]
  },
  "Open-source software vulnerabilities": {
    label: "Open-Source Software Vulnerabilities",
    summary: "Security weaknesses in open-source software that can be exploited by attackers, exemplified by incidents like Heartbleed and Log4Shell. In AI policy, open-source vulnerabilities are relevant because much of the AI stack — from training frameworks to inference engines — relies on open-source components. The challenge is compounded when open-weight AI models contain latent vulnerabilities like backdoors or poisoned training data. This tension between openness and security informs debates about AI supply chain governance, vulnerability disclosure, and the resources needed to maintain critical AI infrastructure.",
    example: "A node might cite open-source software vulnerabilities to argue that releasing AI model weights without security review creates systemic risk.",
    frequency: "Safetyist and cross-cutting POVs; skeptics use it to challenge naive open-source advocacy.",
    links: [
      { label: "Heartbleed (Wikipedia)", url: "https://en.wikipedia.org/wiki/Heartbleed" },
      { label: "Log4Shell (Wikipedia)", url: "https://en.wikipedia.org/wiki/Log4Shell" },
      { label: "Software Supply Chain Security (NIST)", url: "https://www.nist.gov/system/files/documents/2022/02/04/software-supply-chain-security-guidance-under-EO-14028-section-4e.pdf" }
    ]
  },
  "OpenAI's compute-centric research agenda": {
    label: "OpenAI\'s Compute-Centric Research Agenda",
    summary: "OpenAI\'s strategic orientation around the hypothesis that scaling compute — larger models, more training data, more GPU hours — is the primary driver of AI capability gains. This agenda, influenced by scaling laws research, has shaped the broader AI field by prioritizing investment in massive compute infrastructure over algorithmic innovation or neuroscience-inspired approaches. In policy terms, the compute-centric view implies that AI governance should focus on compute access, chip supply chains, and infrastructure concentration rather than algorithmic regulation.",
    example: "A node may reference OpenAI\'s compute-centric agenda to argue that controlling compute is the most tractable lever for AI governance.",
    frequency: "All POVs — accelerationists support scaling, safetyists see compute governance as a control point, skeptics question the scaling hypothesis.",
    links: [
      { label: "Scaling Laws for Neural Language Models (arXiv)", url: "https://arxiv.org/abs/2001.08361" },
      { label: "OpenAI", url: "https://openai.com/" }
    ]
  },
  "Orthogonality thesis": {
    label: "Orthogonality Thesis",
    summary: "The philosophical thesis, articulated by Nick Bostrom, that intelligence and final goals are orthogonal — meaning a highly intelligent agent could in principle have any set of terminal goals, including ones misaligned with human values. The orthogonality thesis is foundational to AI alignment research because it implies that superintelligent AI would not automatically be benevolent; its goals must be deliberately specified and maintained. Critics argue it relies on an overly abstract model of intelligence that ignores how goals emerge from embodied experience and social context.",
    example: "A node may invoke the orthogonality thesis to argue that advanced AI systems require explicit value alignment because intelligence alone does not ensure beneficial goals.",
    frequency: "Safetyist POV primarily; accelerationists and skeptics debate its practical relevance.",
    links: [
      { label: "Orthogonality Thesis (Wikipedia)", url: "https://en.wikipedia.org/wiki/Instrumental_convergence#Orthogonality_thesis" },
      { label: "Superintelligence — Nick Bostrom (Wikipedia)", url: "https://en.wikipedia.org/wiki/Superintelligence:_Paths,_Dangers,_Strategies" }
    ]
  },
  "Out-of-distribution detection": {
    label: "Out-of-Distribution Detection",
    summary: "Techniques for identifying when an ML model encounters inputs that differ significantly from its training data distribution, meaning its predictions may be unreliable. OOD detection is a critical safety mechanism because deployed AI systems inevitably face novel situations, and confident predictions on unfamiliar inputs can lead to dangerous failures. In AI policy, robust OOD detection is often cited as a necessary component of trustworthy AI systems, particularly in high-stakes applications like healthcare, autonomous driving, and criminal justice.",
    example: "A node might reference out-of-distribution detection as a technical requirement for deploying AI in safety-critical applications with regulatory approval.",
    frequency: "Safetyist and cross-cutting POVs; technical AI governance discussions across all perspectives.",
    links: [
      { label: "Anomaly Detection (Wikipedia)", url: "https://en.wikipedia.org/wiki/Anomaly_detection" },
      { label: "Out-of-Distribution Generalization — A Survey (arXiv)", url: "https://arxiv.org/abs/2108.13624" }
    ]
  },
  "Philosophy of mind (consciousness/agency)": {
    label: "Philosophy of Mind (Consciousness/Agency)",
    summary: "The branch of philosophy examining the nature of consciousness, mental states, intentionality, and agency. In AI policy, philosophy of mind is directly relevant to questions about whether AI systems can be conscious, have genuine understanding, or possess moral agency. These questions determine whether AI systems deserve moral consideration, can be held responsible for decisions, and whether claims of AI sentience should influence regulation. The hard problem of consciousness and debates about functionalism vs. biological naturalism shape how we interpret AI behavior.",
    example: "A node may draw on philosophy of mind to argue that current AI systems lack genuine agency and therefore should not be treated as moral patients.",
    frequency: "Cross-cutting and safetyist POVs; skeptics use it to challenge anthropomorphization of AI systems.",
    links: [
      { label: "Philosophy of Mind (Wikipedia)", url: "https://en.wikipedia.org/wiki/Philosophy_of_mind" },
      { label: "Hard Problem of Consciousness (Wikipedia)", url: "https://en.wikipedia.org/wiki/Hard_problem_of_consciousness" }
    ]
  },
  "Philosophy of mind (e.g., Searle's Chinese Room)": {
    label: "Philosophy of Mind (Searle\'s Chinese Room)",
    summary: "John Searle\'s Chinese Room thought experiment argues that a computer program, no matter how sophisticated, cannot have genuine understanding or consciousness — it merely manipulates symbols without comprehending their meaning. This argument is central to AI policy debates about whether large language models truly \'understand\' language or are performing sophisticated pattern matching. The distinction matters for regulation: if AI systems lack understanding, claims about AI judgment, creativity, or moral reasoning may be fundamentally misleading, with implications for liability, trust, and deployment decisions.",
    example: "A node might invoke Searle\'s Chinese Room to argue that AI systems cannot genuinely understand context and therefore should not make autonomous high-stakes decisions.",
    frequency: "Skeptic POV primarily; cross-cutting philosophical discussions; safetyists engage with implications for AI moral status.",
    links: [
      { label: "Chinese Room (Wikipedia)", url: "https://en.wikipedia.org/wiki/Chinese_room" },
      { label: "John Searle (Wikipedia)", url: "https://en.wikipedia.org/wiki/John_Searle" }
    ]
  },
  "Philosophy of science (bias, reproducibility)": {
    label: "Philosophy of Science (Bias, Reproducibility)",
    summary: "The branch of philosophy examining scientific methodology, with particular attention to how biases — confirmation bias, publication bias, funding bias — and reproducibility failures undermine scientific validity. In AI research, these concerns are acute: many ML papers fail to reproduce, benchmarks are gamed, and positive results are disproportionately published. For AI policy, this means that claims about AI capabilities and safety used to justify regulation or investment may rest on unreliable scientific foundations.",
    example: "A node may cite philosophy of science concerns about reproducibility to argue that AI capability claims should be independently verified before informing policy.",
    frequency: "Skeptic and cross-cutting POVs; used to challenge both accelerationist progress narratives and safetyist risk estimates.",
    links: [
      { label: "Replication Crisis (Wikipedia)", url: "https://en.wikipedia.org/wiki/Replication_crisis" },
      { label: "Philosophy of Science (Wikipedia)", url: "https://en.wikipedia.org/wiki/Philosophy_of_science" }
    ]
  },
  "Philosophy of science (replication crisis)": {
    label: "Philosophy of Science (Replication Crisis)",
    summary: "The ongoing crisis across scientific disciplines — psychology, medicine, economics, and increasingly machine learning — where many published findings fail to replicate when experiments are independently repeated. In AI, the replication crisis manifests as ML papers with results that cannot be reproduced due to undisclosed hyperparameters, cherry-picked datasets, or compute-dependent outcomes. For AI policy, this undermines the evidentiary basis for both capability claims and safety assessments, making it difficult to craft evidence-based regulation.",
    example: "A node might reference the replication crisis to argue that AI policy should not be based on unreproduced benchmark results or single-study capability demonstrations.",
    frequency: "Skeptic POV primarily; cross-cutting nodes advocate for reproducibility standards in AI research.",
    links: [
      { label: "Replication Crisis (Wikipedia)", url: "https://en.wikipedia.org/wiki/Replication_crisis" },
      { label: "Reproducibility in ML — NeurIPS Checklist", url: "https://neurips.cc/public/guides/PaperChecklist" }
    ]
  },
  "Political economy of AI": {
    label: "Political Economy of AI",
    summary: "An interdisciplinary field examining how political institutions, economic structures, and power relations shape AI development, deployment, and governance. Political economy analysis reveals how AI policy outcomes are determined not just by technical considerations but by lobbying, regulatory capture, geopolitical competition, and the distribution of economic gains. It examines who benefits from AI, who bears the costs, and how political processes mediate these distributional outcomes. This framework integrates insights from economics, political science, and sociology of technology.",
    example: "A node may use political economy to analyze how corporate lobbying shapes AI regulation to favor incumbent firms over public interest.",
    frequency: "Cross-cutting and skeptic POVs primarily; all perspectives engage with political economy dimensions of AI governance.",
    links: [
      { label: "Political Economy (Wikipedia)", url: "https://en.wikipedia.org/wiki/Political_economy" },
      { label: "AI Now Institute", url: "https://ainowinstitute.org/" }
    ]
  },
  "Post-hoc risk management": {
    label: "Post-Hoc Risk Management",
    summary: "A regulatory approach that addresses risks after they materialize rather than preventing them in advance. In AI governance, post-hoc risk management includes tort liability, incident reporting requirements, and retrospective audits — responding to AI harms as they occur rather than requiring safety demonstrations before deployment. Proponents argue it avoids stifling innovation with speculative precaution; critics contend that AI harms — once they occur at scale — may be irreversible or difficult to attribute, making after-the-fact remedies inadequate.",
    example: "A node might critique post-hoc risk management as insufficient for AI systems that can cause rapid, widespread harm before corrective action is possible.",
    frequency: "Cross-cutting and safetyist POVs; accelerationists may prefer it as less burdensome than precautionary regulation.",
    links: [
      { label: "Risk Management (Wikipedia)", url: "https://en.wikipedia.org/wiki/Risk_management" },
      { label: "Precautionary Principle (Wikipedia)", url: "https://en.wikipedia.org/wiki/Precautionary_principle" }
    ]
  },
  "Post-scarcity economics": {
    label: "Post-Scarcity Economics",
    summary: "A hypothetical economic condition in which goods and services are produced in such abundance — through automation, AI, and advanced manufacturing — that scarcity no longer drives economic organization. In AI policy, post-scarcity economics is invoked by accelerationists who argue that AI-driven productivity could eliminate material want, and by critics who note that post-scarcity requires not just productive capacity but political will to distribute abundance. The concept raises fundamental questions about the future of work, UBI, and whether capitalism can survive its own productive success.",
    example: "A node may reference post-scarcity economics to argue that AI-driven abundance requires new distributive institutions beyond market mechanisms.",
    frequency: "Accelerationist POV primarily; cross-cutting nodes examine distributional challenges; skeptics question the premise.",
    links: [
      { label: "Post-Scarcity Economy (Wikipedia)", url: "https://en.wikipedia.org/wiki/Post-scarcity_economy" },
      { label: "Universal Basic Income (Wikipedia)", url: "https://en.wikipedia.org/wiki/Universal_basic_income" }
    ]
  },
  "Posthumanism": {
    label: "Posthumanism",
    summary: "A philosophical movement that challenges the centrality of the human subject in moral and ontological frameworks, questioning boundaries between human, animal, and machine. In AI policy, posthumanism provides a lens for reconsidering human exceptionalism, the moral status of AI agents, and the co-evolution of humans and technology. Posthumanist perspectives argue that rigid human-machine distinctions obscure the ways AI is already embedded in human cognition, identity, and social relations. This challenges anthropocentric governance frameworks that assume a clear line between tool and agent.",
    example: "A node might draw on posthumanism to argue that AI governance must move beyond human-centric frameworks to address hybrid human-AI systems.",
    frequency: "Cross-cutting POV primarily; accelerationists draw on transhumanist variants; skeptics critique it as impractical for policy.",
    links: [
      { label: "Posthumanism (Wikipedia)", url: "https://en.wikipedia.org/wiki/Posthumanism" },
      { label: "Transhumanism (Wikipedia)", url: "https://en.wikipedia.org/wiki/Transhumanism" }
    ]
  },
  "Pragmatism": {
    label: "Pragmatism",
    summary: "A philosophical tradition — associated with Peirce, James, and Dewey — that evaluates ideas and policies by their practical consequences rather than abstract principles. In AI governance, pragmatism favors iterative, evidence-based regulation that adapts to empirical outcomes rather than committing to rigid ideological positions about AI\'s nature or destiny. Pragmatist approaches emphasize stakeholder experience, pilot programs, regulatory sandboxes, and continuous evaluation over theoretical debates about consciousness, existential risk, or technological determinism.",
    example: "A node may advocate a pragmatist approach to AI regulation that focuses on measurable outcomes rather than speculative risk scenarios.",
    frequency: "Cross-cutting and skeptic POVs; used to critique both utopian accelerationism and doom-oriented safetyism.",
    links: [
      { label: "Pragmatism (Wikipedia)", url: "https://en.wikipedia.org/wiki/Pragmatism" },
      { label: "John Dewey (Wikipedia)", url: "https://en.wikipedia.org/wiki/John_Dewey" }
    ]
  },
  "precautionary principle": {
    label: "Precautionary Principle",
    summary: "A policy approach holding that when an action raises threats of harm to human health or the environment, precautionary measures should be taken even if some cause-and-effect relationships are not fully established scientifically. In AI governance, the precautionary principle argues for restricting or slowing AI deployment until risks are better understood, particularly for frontier models with unpredictable emergent capabilities. Critics argue it can be paralyzing, stifle beneficial innovation, and is difficult to apply when both action and inaction carry risks.",
    example: "A node might invoke the precautionary principle to argue that frontier AI models should not be deployed until their risks are comprehensively evaluated.",
    frequency: "Safetyist POV strongly; cross-cutting governance discussions; accelerationists and skeptics critique its application.",
    links: [
      { label: "Precautionary Principle (Wikipedia)", url: "https://en.wikipedia.org/wiki/Precautionary_principle" },
      { label: "UNESCO — Precautionary Principle", url: "https://en.unesco.org/themes/ethics-science-and-technology/precautionary-principle" }
    ]
  },
  "Precautionary principle": {
    label: "Precautionary Principle",
    summary: "A policy approach holding that when an action raises threats of harm to human health or the environment, precautionary measures should be taken even if some cause-and-effect relationships are not fully established scientifically. In AI governance, the precautionary principle argues for restricting or slowing AI deployment until risks are better understood, particularly for frontier models with unpredictable emergent capabilities. Critics argue it can be paralyzing, stifle beneficial innovation, and is difficult to apply when both action and inaction carry risks.",
    example: "A node might invoke the precautionary principle to argue that frontier AI models should not be deployed until their risks are comprehensively evaluated.",
    frequency: "Safetyist POV strongly; cross-cutting governance discussions; accelerationists and skeptics critique its application.",
    links: [
      { label: "Precautionary Principle (Wikipedia)", url: "https://en.wikipedia.org/wiki/Precautionary_principle" },
      { label: "UNESCO — Precautionary Principle", url: "https://en.unesco.org/themes/ethics-science-and-technology/precautionary-principle" }
    ]
  },
  "Precautionary Principle": {
    label: "Precautionary Principle",
    summary: "A policy approach holding that when an action raises threats of harm to human health or the environment, precautionary measures should be taken even if some cause-and-effect relationships are not fully established scientifically. In AI governance, the precautionary principle argues for restricting or slowing AI deployment until risks are better understood, particularly for frontier models with unpredictable emergent capabilities. Critics argue it can be paralyzing, stifle beneficial innovation, and is difficult to apply when both action and inaction carry risks.",
    example: "A node might invoke the precautionary principle to argue that frontier AI models should not be deployed until their risks are comprehensively evaluated.",
    frequency: "Safetyist POV strongly; cross-cutting governance discussions; accelerationists and skeptics critique its application.",
    links: [
      { label: "Precautionary Principle (Wikipedia)", url: "https://en.wikipedia.org/wiki/Precautionary_principle" },
      { label: "UNESCO — Precautionary Principle", url: "https://en.unesco.org/themes/ethics-science-and-technology/precautionary-principle" }
    ]
  },
  "Principal-agent problem": {
    label: "Principal-Agent Problem",
    summary: "An economic concept describing conflicts of interest when one party (the agent) acts on behalf of another (the principal) but has different incentives. In AI, principal-agent problems arise at multiple levels: users vs. AI systems that may pursue different objectives, shareholders vs. AI company management, regulators vs. the firms they oversee, and citizens vs. governments deploying AI. The alignment problem itself can be understood as a principal-agent problem where the AI system is an agent that may not faithfully pursue its principal\'s (humanity\'s) interests.",
    example: "A node might frame AI alignment as a principal-agent problem where the challenge is ensuring the AI agent faithfully serves human principals.",
    frequency: "Cross-cutting and safetyist POVs; economic analyses across all perspectives.",
    links: [
      { label: "Principal-Agent Problem (Wikipedia)", url: "https://en.wikipedia.org/wiki/Principal%E2%80%93agent_problem" },
      { label: "Agency Theory (Wikipedia)", url: "https://en.wikipedia.org/wiki/Agency_theory" }
    ]
  },
  "product liability": {
    label: "Product Liability",
    summary: "The legal doctrine holding manufacturers, distributors, and sellers responsible for defective products that cause injury. Applying product liability to AI is a major governance challenge because AI systems are often provided as services rather than products, their behavior is emergent and context-dependent, and it is difficult to define what constitutes a \'defect\' in a probabilistic system. Strengthening AI product liability is proposed as a market-based mechanism to incentivize safety, shifting the cost of AI failures from users to developers.",
    example: "A node might argue for expanding product liability to AI systems so that developers bear the cost of failures rather than end users.",
    frequency: "Cross-cutting and safetyist POVs; accelerationists engage with liability as an alternative to prescriptive regulation.",
    links: [
      { label: "Product Liability (Wikipedia)", url: "https://en.wikipedia.org/wiki/Product_liability" },
      { label: "EU AI Liability Directive", url: "https://commission.europa.eu/business-economy-euro/doing-business-eu/contract-rules/digital-contracts/liability-rules-artificial-intelligence_en" }
    ]
  },
  "Product liability law": {
    label: "Product Liability Law",
    summary: "The body of law governing the liability of manufacturers, distributors, and sellers for defective products that cause harm to consumers. Applying product liability law to AI is a major governance challenge because AI systems are often provided as services, their behavior is emergent and context-dependent, and defining a \'defect\' in a probabilistic system is legally unprecedented. The EU AI Liability Directive and proposed US frameworks attempt to adapt product liability to AI, creating incentives for developers to invest in safety testing, documentation, and monitoring.",
    example: "A node may reference product liability law as a governance mechanism that would hold AI developers financially responsible for harms caused by their systems.",
    frequency: "Cross-cutting and safetyist POVs; accelerationists engage with liability as a market-based governance alternative.",
    links: [
      { label: "Product Liability (Wikipedia)", url: "https://en.wikipedia.org/wiki/Product_liability" },
      { label: "EU AI Liability Directive", url: "https://commission.europa.eu/business-economy-euro/doing-business-eu/contract-rules/digital-contracts/liability-rules-artificial-intelligence_en" }
    ]
  },
  "Productivity Paradox (revisited)": {
    label: "Productivity Paradox (Revisited)",
    summary: "The observation, originally noted by Robert Solow in 1987 (\'You can see the computer age everywhere but in the productivity statistics\'), that major IT investments often fail to produce measurable productivity gains. Revisited in the AI era, the paradox asks whether massive AI investment will translate into broad economic productivity growth or whether — like previous IT waves — the gains will be concentrated, delayed, or offset by adjustment costs. This tension is central to debates about whether AI justifies the enormous capital expenditure being directed toward it.",
    example: "A node might invoke the productivity paradox to caution against assuming AI investment will automatically deliver economy-wide productivity gains.",
    frequency: "Skeptic POV primarily; cross-cutting economic analyses; accelerationists argue AI will finally resolve the paradox.",
    links: [
      { label: "Productivity Paradox (Wikipedia)", url: "https://en.wikipedia.org/wiki/Productivity_paradox" },
      { label: "Solow Computer Paradox (Wikipedia)", url: "https://en.wikipedia.org/wiki/Solow_computer_paradox" }
    ]
  },
  "Progress narrative": {
    label: "Progress Narrative",
    summary: "The cultural and intellectual framework that views history as a trajectory of continuous improvement driven by science, technology, and rational human agency. In AI discourse, the progress narrative underpins accelerationist arguments that AI development is inherently beneficial, that more capability equals more progress, and that attempts to slow AI constitute irrational resistance to improvement. Critics argue this narrative ignores distributional consequences, environmental costs, and the possibility that technological change can produce regress for some groups even as aggregate measures improve.",
    example: "A node may critique the progress narrative for assuming AI advancement is inherently beneficial without examining who gains and who loses.",
    frequency: "Accelerationist POV embodies it; skeptics and cross-cutting nodes critique it as ideological rather than empirical.",
    links: [
      { label: "Idea of Progress (Wikipedia)", url: "https://en.wikipedia.org/wiki/Idea_of_progress" },
      { label: "Technological Determinism (Wikipedia)", url: "https://en.wikipedia.org/wiki/Technological_determinism" }
    ]
  },
  "Public choice theory": {
    label: "Public Choice Theory",
    summary: "An economic approach to analyzing political behavior by applying rational choice models to government officials, voters, and interest groups, assuming they act in their own self-interest rather than the public good. In AI governance, public choice theory predicts regulatory capture — where AI firms shape regulations to protect incumbents — and explains why politicians may favor visible but ineffective AI regulations over substantive but politically costly ones. It provides a skeptical lens on AI governance institutions, questioning whether regulators will genuinely serve public interests.",
    example: "A node might apply public choice theory to predict that AI regulation will be shaped more by industry lobbying than by public interest considerations.",
    frequency: "Skeptic and cross-cutting POVs; used to critique both government AI regulation and industry self-governance.",
    links: [
      { label: "Public Choice (Wikipedia)", url: "https://en.wikipedia.org/wiki/Public_choice" },
      { label: "Regulatory Capture (Wikipedia)", url: "https://en.wikipedia.org/wiki/Regulatory_capture" }
    ]
  },
  "Public goods theory": {
    label: "Public Goods Theory",
    summary: "An economic theory analyzing goods that are non-excludable (people cannot be prevented from using them) and non-rivalrous (one person\'s use does not diminish availability for others). AI safety research, open-source AI tools, and AI alignment techniques exhibit public goods characteristics — they benefit everyone but are under-provided by markets because developers cannot fully capture their value. Public goods theory explains why AI safety is chronically underfunded relative to capability development and justifies public investment, mandates, or subsidies for safety research.",
    example: "A node may frame AI safety research as a public good that requires government funding because market incentives alone will not produce sufficient investment.",
    frequency: "Cross-cutting and safetyist POVs; economic analyses across all perspectives.",
    links: [
      { label: "Public Good (Wikipedia)", url: "https://en.wikipedia.org/wiki/Public_good_(economics)" },
      { label: "Free-Rider Problem (Wikipedia)", url: "https://en.wikipedia.org/wiki/Free-rider_problem" }
    ]
  },
  "Public utility theory": {
    label: "Public Utility Theory",
    summary: "The regulatory framework and economic theory governing essential services — electricity, water, telecommunications — that are natural monopolies or critical infrastructure. Applied to AI, public utility theory asks whether foundational AI models and compute infrastructure should be regulated as utilities given their essential role in the economy and the natural monopoly tendencies of AI platforms. Utility-style regulation could mandate fair access, price controls, service obligations, and safety standards for AI infrastructure providers, similar to how telecom carriers are regulated as common carriers.",
    example: "A node might argue that large AI model providers should be regulated as public utilities to ensure fair access and prevent discriminatory practices.",
    frequency: "Cross-cutting and skeptic POVs; accelerationists resist utility-style regulation as stifling innovation.",
    links: [
      { label: "Public Utility (Wikipedia)", url: "https://en.wikipedia.org/wiki/Public_utility" },
      { label: "Common Carrier (Wikipedia)", url: "https://en.wikipedia.org/wiki/Common_carrier" },
      { label: "Natural Monopoly (Wikipedia)", url: "https://en.wikipedia.org/wiki/Natural_monopoly" }
    ]
  },


"Rational actor model": {
    label: "Rational Actor Model",
    summary: "A framework from political science and economics that assumes decision-makers act rationally to maximize their utility or achieve their objectives. In AI policy, it underpins game-theoretic analyses of AI arms races between nations and corporations. The model helps predict strategic behavior but has been criticized for ignoring bounded rationality and cognitive biases that affect real-world AI governance decisions.",
    example: "Appears in nodes analyzing geopolitical AI competition and strategic decision-making frameworks.",
    frequency: "Common in accelerationist and cross-cutting nodes discussing AI races and strategic dynamics.",
    links: [
      { label: "Wikipedia: Rational Choice Theory", url: "https://en.wikipedia.org/wiki/Rational_choice_theory" },
      { label: "Stanford Encyclopedia: Rational Choice", url: "https://plato.stanford.edu/entries/rationality-instrumental/" }
    ]
  },
  "rational choice theory": {
    label: "Rational Choice Theory",
    summary: "A framework from economics and political science that models individuals as rational agents who make decisions by weighing costs and benefits to maximize utility. In AI policy discourse, it informs models of how firms and governments make decisions about AI investment, regulation, and deployment. Critics note that AI governance decisions often involve deep uncertainty that challenges standard rational choice assumptions.",
    example: "Referenced in nodes about economic incentives driving AI development and adoption decisions.",
    frequency: "Common in accelerationist and cross-cutting nodes discussing market dynamics and policy incentives.",
    links: [
      { label: "Wikipedia: Rational Choice Theory", url: "https://en.wikipedia.org/wiki/Rational_choice_theory" },
      { label: "Stanford Encyclopedia: Rational Choice", url: "https://plato.stanford.edu/entries/rationality-instrumental/" }
    ]
  },
  "Ray Kurzweil's Law of Accelerating Returns": {
    label: "Ray Kurzweil\'s Law of Accelerating Returns",
    summary: "Ray Kurzweil\'s thesis that the rate of technological change itself accelerates over time, following exponential rather than linear growth curves. Applied to AI, it predicts that progress in computing and intelligence will compound rapidly, leading to transformative capabilities sooner than linear extrapolation would suggest. This concept is foundational to accelerationist arguments about the inevitability and speed of AI advancement.",
    example: "Cited in accelerationist nodes arguing that AI progress will outpace regulatory capacity.",
    frequency: "Primarily in accelerationist nodes; referenced critically in skeptic nodes.",
    links: [
      { label: "Wikipedia: Accelerating Change", url: "https://en.wikipedia.org/wiki/Accelerating_change" },
      { label: "Kurzweil: The Law of Accelerating Returns", url: "https://www.kurzweilai.net/the-law-of-accelerating-returns" }
    ]
  },
  "Ray Kurzweil's Singularity": {
    label: "Ray Kurzweil\'s Singularity",
    summary: "Kurzweil\'s prediction that exponential technological growth will lead to a singularity — a point where artificial intelligence surpasses human intelligence and fundamentally transforms civilization. He has projected this occurring around 2045, driven by convergent advances in genetics, nanotechnology, and AI. The concept motivates both accelerationist enthusiasm and safetyist urgency about preparing for superintelligent systems.",
    example: "Referenced in nodes discussing timelines for transformative AI and the urgency of safety research.",
    frequency: "Common in accelerationist and safetyist nodes; critiqued in skeptic nodes.",
    links: [
      { label: "Wikipedia: The Singularity Is Near", url: "https://en.wikipedia.org/wiki/The_Singularity_Is_Near" },
      { label: "Wikipedia: Technological Singularity", url: "https://en.wikipedia.org/wiki/Technological_singularity" }
    ]
  },
  "Realpolitik": {
    label: "Realpolitik",
    summary: "A political philosophy rooted in practical and material considerations rather than ideological or ethical premises. In AI policy, Realpolitik frames international AI competition as driven by national interest and power dynamics rather than shared values or cooperative norms. It supports arguments that unilateral AI regulation puts nations at a strategic disadvantage and that geopolitical competition will ultimately shape AI governance more than multilateral agreements.",
    example: "Appears in nodes analyzing US-China AI competition and arguments against unilateral regulation.",
    frequency: "Found in accelerationist and cross-cutting nodes on geopolitics and AI governance.",
    links: [
      { label: "Wikipedia: Realpolitik", url: "https://en.wikipedia.org/wiki/Realpolitik" },
      { label: "Britannica: Realpolitik", url: "https://www.britannica.com/topic/realpolitik" }
    ]
  },
  "Recursive self-improvement": {
    label: "Recursive Self-Improvement",
    summary: "The theoretical capability of an AI system to iteratively improve its own design, algorithms, or hardware, leading to rapidly escalating intelligence. This concept is central to intelligence explosion scenarios where each improvement enables further improvements at an accelerating pace. It is a key concern in AI safety because it could make an AI system\'s capabilities unpredictable and uncontrollable once initiated.",
    example: "Core concept in safetyist nodes discussing existential risk from superintelligent AI.",
    frequency: "Heavily used in safetyist and accelerationist nodes; skeptic nodes question its plausibility.",
    links: [
      { label: "Wikipedia: Recursive Self-Improvement", url: "https://en.wikipedia.org/wiki/Recursive_self-improvement" },
      { label: "Wikipedia: Intelligence Explosion", url: "https://en.wikipedia.org/wiki/Intelligence_explosion" }
    ]
  },
  "Regulatory capture theory": {
    label: "Regulatory Capture Theory",
    summary: "The economic theory that regulatory agencies, created to act in the public interest, can come to be dominated by the industries they regulate. In AI policy, this raises concerns that AI companies may influence regulatory bodies to create rules that entrench incumbents and limit competition rather than genuinely protecting public safety. Both accelerationists and skeptics invoke this concept, though for different reasons — accelerationists warn regulation will be captured, while skeptics warn that industry self-regulation is insufficient.",
    example: "Referenced in nodes critiquing proposed AI regulatory bodies and industry-led governance initiatives.",
    frequency: "Cross-cutting concept appearing in accelerationist, skeptic, and cross-cutting nodes.",
    links: [
      { label: "Wikipedia: Regulatory Capture", url: "https://en.wikipedia.org/wiki/Regulatory_capture" },
      { label: "Stigler: The Theory of Economic Regulation", url: "https://www.jstor.org/stable/3003160" }
    ]
  },
  "regulatory incrementalism": {
    label: "Regulatory Incrementalism",
    summary: "An approach to regulation that favors gradual, step-by-step policy adjustments rather than comprehensive regulatory frameworks imposed all at once. In AI governance, incrementalists argue that because the technology is evolving rapidly, regulators should adopt targeted measures that can be adjusted based on observed impacts. This contrasts with calls for sweeping preemptive regulation of AI systems.",
    example: "Appears in skeptic and cross-cutting nodes advocating measured, evidence-based AI regulation.",
    frequency: "Common in skeptic and cross-cutting nodes; opposed in some safetyist nodes.",
    links: [
      { label: "Wikipedia: Incrementalism", url: "https://en.wikipedia.org/wiki/Incrementalism" },
      { label: "Brookings: AI Regulation", url: "https://www.brookings.edu/articles/how-artificial-intelligence-is-transforming-the-world/" }
    ]
  },
  "regulatory pragmatism": {
    label: "Regulatory Pragmatism",
    summary: "A governance philosophy that emphasizes practical, context-sensitive approaches to regulation rather than rigid ideological positions. Applied to AI, regulatory pragmatism focuses on what demonstrably works — adapting existing regulatory frameworks, learning from analogous industries, and adjusting rules as evidence accumulates. It prioritizes feasibility and effectiveness over theoretical completeness.",
    example: "Referenced in nodes arguing for adapting existing regulatory mechanisms to AI rather than creating new agencies.",
    frequency: "Primarily in skeptic and cross-cutting nodes advocating practical governance approaches.",
    links: [
      { label: "Wikipedia: Pragmatism", url: "https://en.wikipedia.org/wiki/Pragmatism" },
      { label: "OECD AI Policy Observatory", url: "https://oecd.ai/en/policy-areas" }
    ]
  },
  "Regulatory sandboxes concept": {
    label: "Regulatory Sandboxes Concept",
    summary: "A regulatory approach that allows companies to test innovative products or services in a controlled environment with relaxed regulatory requirements, under the supervision of a regulator. Originally developed in fintech by the UK\'s Financial Conduct Authority, regulatory sandboxes have been proposed for AI to allow experimentation while managing risks. They offer a middle ground between restrictive regulation that stifles innovation and complete deregulation.",
    example: "Cited in nodes proposing flexible AI governance frameworks that balance innovation and safety.",
    frequency: "Common in cross-cutting and skeptic nodes; some accelerationist support.",
    links: [
      { label: "Wikipedia: Regulatory Sandbox", url: "https://en.wikipedia.org/wiki/Regulatory_sandbox" },
      { label: "World Bank: Regulatory Sandboxes", url: "https://www.worldbank.org/en/topic/fintech/brief/key-data-from-regulatory-sandboxes-across-the-globe" }
    ]
  },
  "regulatory science": {
    label: "Regulatory Science",
    summary: "The science of developing new tools, standards, and approaches to assess the safety, efficacy, and performance of regulated products and technologies. In AI governance, regulatory science involves creating rigorous methods for evaluating AI systems — benchmarks, audit procedures, and testing protocols. It emphasizes that effective regulation requires deep technical understanding and evidence-based methodologies.",
    example: "Referenced in nodes discussing the need for technical standards and evaluation methods for AI systems.",
    frequency: "Found in cross-cutting and skeptic nodes emphasizing evidence-based regulation.",
    links: [
      { label: "Wikipedia: Regulatory Science", url: "https://en.wikipedia.org/wiki/Regulatory_science" },
      { label: "FDA: Advancing Regulatory Science", url: "https://www.fda.gov/science-research/science-and-research-special-topics/advancing-regulatory-science" }
    ]
  },
  "regulatory science (e.g., FDA model)": {
    label: "Regulatory Science (e.g., FDA Model)",
    summary: "The application of regulatory science principles as exemplified by the FDA\'s approach to evaluating drugs and medical devices — requiring rigorous evidence of safety and efficacy before market approval. Applied to AI, this model suggests systems should undergo structured evaluation and testing before deployment in high-stakes domains. Proponents argue that the FDA model demonstrates how regulation and innovation can coexist, while critics warn that AI\'s pace of change may not suit the FDA\'s lengthy approval timelines.",
    example: "Cited in nodes proposing pre-deployment safety evaluation frameworks modeled on pharmaceutical regulation.",
    frequency: "Common in cross-cutting and skeptic nodes; accelerationists often critique the analogy.",
    links: [
      { label: "FDA: Advancing Regulatory Science", url: "https://www.fda.gov/science-research/science-and-research-special-topics/advancing-regulatory-science" },
      { label: "Wikipedia: Regulatory Science", url: "https://en.wikipedia.org/wiki/Regulatory_science" }
    ]
  },
  "Reinforcement learning safety": {
    label: "Reinforcement Learning Safety",
    summary: "The subfield of AI safety research focused on ensuring that reinforcement learning agents behave safely during and after training. Key challenges include reward hacking (where agents exploit reward functions in unintended ways), safe exploration (avoiding dangerous actions during learning), and distributional shift (maintaining safe behavior in novel environments). This area is critical because RL agents that optimize objectives without proper safety constraints can develop harmful behaviors.",
    example: "Appears in safetyist nodes discussing technical approaches to AI alignment and safe training methods.",
    frequency: "Primarily in safetyist nodes; cross-cutting nodes discuss practical applications.",
    links: [
      { label: "Wikipedia: AI Safety", url: "https://en.wikipedia.org/wiki/AI_safety" },
      { label: "DeepMind: Specification Gaming Examples", url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRPiprOaC3HsCf5Tuum8bRfzYUiKLRqJCOYKNr-BKAA52oyRKSFj3a_RtPgSBUhaAQ2GFHO8LVKUCZE/pubhtml" },
      { label: "Amodei et al.: Concrete Problems in AI Safety", url: "https://arxiv.org/abs/1606.06565" }
    ]
  },
  "Resilience engineering": {
    label: "Resilience Engineering",
    summary: "An approach to safety that focuses on a system\'s ability to sustain required operations under both expected and unexpected conditions, rather than merely preventing failures. Developed by Erik Hollnagel and others, it emphasizes adaptability, graceful degradation, and learning from both successes and failures. Applied to AI systems, resilience engineering suggests designing for robustness to novel situations rather than trying to anticipate every possible failure mode.",
    example: "Referenced in safetyist and cross-cutting nodes discussing robust AI system design and deployment strategies.",
    frequency: "Found in safetyist and cross-cutting nodes on system design and operational safety.",
    links: [
      { label: "Wikipedia: Resilience Engineering", url: "https://en.wikipedia.org/wiki/Resilience_(engineering_and_construction)" },
      { label: "Hollnagel: Resilience Engineering", url: "https://erikhollnagel.com/ideas/resilience-engineering.html" }
    ]
  },
  "resilience theory": {
    label: "Resilience Theory",
    summary: "A framework originating in ecology and systems science that studies how systems absorb disturbances, reorganize, and maintain their essential function and identity. In AI governance, resilience theory informs approaches that prioritize building societal capacity to withstand and adapt to AI-driven disruptions rather than attempting to prevent all negative outcomes. It emphasizes adaptive capacity, redundancy, and diversity as key properties of robust socio-technical systems.",
    example: "Appears in cross-cutting and skeptic nodes discussing societal adaptation to AI-driven change.",
    frequency: "Cross-cutting and skeptic nodes; some safetyist applications.",
    links: [
      { label: "Wikipedia: Resilience (ecology)", url: "https://en.wikipedia.org/wiki/Resilience_(ecology)" },
      { label: "Stockholm Resilience Centre", url: "https://www.stockholmresilience.org/research/resilience.html" }
    ]
  },
  "Right to explanation (GDPR)": {
    label: "Right to Explanation (GDPR)",
    summary: "A provision in the EU\'s General Data Protection Regulation (Articles 13-15, 22) that grants individuals the right to obtain meaningful information about the logic involved in automated decision-making that significantly affects them. This right has become a flashpoint in AI governance, raising questions about whether complex machine learning models can provide adequate explanations. It has driven significant research into explainable AI (XAI) and influenced AI transparency regulations globally.",
    example: "Cited in nodes discussing AI transparency requirements and regulatory frameworks for automated decisions.",
    frequency: "Common in cross-cutting and safetyist nodes; skeptics debate its practical feasibility.",
    links: [
      { label: "Wikipedia: Right to Explanation", url: "https://en.wikipedia.org/wiki/Right_to_explanation" },
      { label: "GDPR Article 22", url: "https://gdpr-info.eu/art-22-gdpr/" },
      { label: "Goodman & Flaxman: EU Regulations on Algorithmic Decision-Making", url: "https://arxiv.org/abs/1606.08813" }
    ]
  },
  "Risk assessment frameworks": {
    label: "Risk Assessment Frameworks",
    summary: "Structured methodologies for identifying, analyzing, and evaluating risks associated with technologies or activities. In AI governance, risk assessment frameworks such as the NIST AI Risk Management Framework provide systematic approaches to categorizing AI risks by severity and likelihood. These frameworks are critical for translating abstract concerns about AI safety into actionable governance measures and organizational practices.",
    example: "Referenced in cross-cutting and safetyist nodes discussing structured approaches to AI governance.",
    frequency: "Widely used across all POVs, especially cross-cutting and safetyist nodes.",
    links: [
      { label: "NIST AI Risk Management Framework", url: "https://www.nist.gov/itl/ai-risk-management-framework" },
      { label: "Wikipedia: Risk Assessment", url: "https://en.wikipedia.org/wiki/Risk_assessment" }
    ]
  },
  "Risk assessment methodologies (e.g., nuclear safety)": {
    label: "Risk Assessment Methodologies (e.g., Nuclear Safety)",
    summary: "Systematic methods for evaluating risks drawn from high-consequence industries like nuclear power, which pioneered probabilistic risk assessment (PRA) and defense-in-depth strategies. These methodologies are invoked in AI safety discussions as potential models for evaluating catastrophic AI risks, including fault tree analysis, event tree analysis, and failure mode analysis. The nuclear analogy is powerful but debated — nuclear risks are better characterized physically than the open-ended risks of advanced AI systems.",
    example: "Cited in safetyist and cross-cutting nodes proposing structured risk evaluation for frontier AI systems.",
    frequency: "Primarily in safetyist and cross-cutting nodes; skeptics question the analogy\'s applicability.",
    links: [
      { label: "Wikipedia: Probabilistic Risk Assessment", url: "https://en.wikipedia.org/wiki/Probabilistic_risk_assessment" },
      { label: "NRC: Probabilistic Risk Assessment", url: "https://www.nrc.gov/about-nrc/regulatory/risk-informed/pra.html" }
    ]
  },
  "risk management (focus on known risks)": {
    label: "Risk Management (Focus on Known Risks)",
    summary: "An approach to AI governance that prioritizes addressing well-documented, empirically observed risks — such as bias, privacy violations, and misuse — over speculative or existential threats. This perspective argues that attention and resources should focus on harms that are already occurring rather than hypothetical future scenarios. It is associated with skeptic critiques that existential risk framing diverts attention from pressing, concrete AI harms.",
    example: "Appears in skeptic nodes arguing for prioritizing current AI harms over speculative existential risks.",
    frequency: "Primarily in skeptic nodes; some cross-cutting overlap.",
    links: [
      { label: "Wikipedia: Risk Management", url: "https://en.wikipedia.org/wiki/Risk_management" },
      { label: "NIST AI Risk Management Framework", url: "https://www.nist.gov/itl/ai-risk-management-framework" }
    ]
  },
  "Risk management frameworks": {
    label: "Risk Management Frameworks",
    summary: "Structured organizational approaches to identifying, assessing, mitigating, and monitoring risks throughout a technology\'s lifecycle. In AI governance, risk management frameworks like ISO 31000 and the NIST AI RMF provide standardized processes for organizations deploying AI systems. These frameworks are increasingly required by regulation and serve as a bridge between technical AI safety research and practical organizational governance.",
    example: "Referenced in cross-cutting nodes discussing organizational AI governance and compliance strategies.",
    frequency: "Widely referenced across all POVs, especially cross-cutting and safetyist nodes.",
    links: [
      { label: "NIST AI Risk Management Framework", url: "https://www.nist.gov/itl/ai-risk-management-framework" },
      { label: "Wikipedia: ISO 31000", url: "https://en.wikipedia.org/wiki/ISO_31000" },
      { label: "Wikipedia: Risk Management", url: "https://en.wikipedia.org/wiki/Risk_management" }
    ]
  },
  "risk management theory": {
    label: "Risk Management Theory",
    summary: "The body of theoretical work on how organizations and societies identify, evaluate, and respond to risks under uncertainty. Key concepts include risk appetite, risk tolerance, risk transfer, and the distinction between known and unknown risks. In AI policy, risk management theory provides the intellectual foundation for frameworks that attempt to balance the benefits of AI innovation against potential harms, informing both corporate governance and regulatory design.",
    example: "Appears in cross-cutting and safetyist nodes discussing theoretical foundations for AI governance.",
    frequency: "Found across all POVs, most prominently in cross-cutting and safetyist nodes.",
    links: [
      { label: "Wikipedia: Risk Management", url: "https://en.wikipedia.org/wiki/Risk_management" },
      { label: "ISO 31000 Risk Management", url: "https://www.iso.org/iso-31000-risk-management.html" }
    ]
  },
  "Risk management theory": {
    label: "Risk Management Theory",
    summary: "The body of theoretical work on how organizations and societies identify, evaluate, and respond to risks under uncertainty. Key concepts include risk appetite, risk tolerance, risk transfer, and the distinction between known and unknown risks. In AI policy, risk management theory provides the intellectual foundation for frameworks that attempt to balance the benefits of AI innovation against potential harms, informing both corporate governance and regulatory design.",
    example: "Appears in cross-cutting and safetyist nodes discussing theoretical foundations for AI governance.",
    frequency: "Found across all POVs, most prominently in cross-cutting and safetyist nodes.",
    links: [
      { label: "Wikipedia: Risk Management", url: "https://en.wikipedia.org/wiki/Risk_management" },
      { label: "ISO 31000 Risk Management", url: "https://www.iso.org/iso-31000-risk-management.html" }
    ]
  },
  "Safety engineering": {
    label: "Safety Engineering",
    summary: "An engineering discipline focused on ensuring that systems operate without causing unacceptable risk of harm. It encompasses techniques like failure mode analysis, fault tolerance, redundancy, and safety margins developed across industries from aviation to nuclear power. In AI, safety engineering principles are applied to ensure that AI systems fail gracefully, remain within operational bounds, and do not cause unintended harm during deployment.",
    example: "Referenced in safetyist nodes drawing analogies from established engineering safety practices to AI systems.",
    frequency: "Primarily in safetyist and cross-cutting nodes; skeptics evaluate applicability.",
    links: [
      { label: "Wikipedia: Safety Engineering", url: "https://en.wikipedia.org/wiki/Safety_engineering" },
      { label: "MIT: Engineering a Safer World (Leveson)", url: "https://mitpress.mit.edu/9780262533690/engineering-a-safer-world/" }
    ]
  },
  "Safety engineering (e.g., aviation, automotive)": {
    label: "Safety Engineering (e.g., Aviation, Automotive)",
    summary: "Safety engineering practices from aviation (DO-178C, EASA regulations) and automotive (ISO 26262) industries, which have developed rigorous safety certification and testing standards over decades. These domains are frequently cited as models for AI safety because they demonstrate how to engineer and certify safety-critical systems at scale. However, AI systems differ significantly from traditional engineered systems in their opacity, adaptability, and the difficulty of formally specifying all operational requirements.",
    example: "Cited in safetyist and cross-cutting nodes proposing safety certification standards for AI systems.",
    frequency: "Common in safetyist and cross-cutting nodes; skeptics and accelerationists debate the analogy.",
    links: [
      { label: "Wikipedia: Safety Engineering", url: "https://en.wikipedia.org/wiki/Safety_engineering" },
      { label: "Wikipedia: DO-178C", url: "https://en.wikipedia.org/wiki/DO-178C" },
      { label: "Wikipedia: ISO 26262", url: "https://en.wikipedia.org/wiki/ISO_26262" }
    ]
  },
  "safety engineering principles": {
    label: "Safety Engineering Principles",
    summary: "Core principles from the field of safety engineering, including defense in depth, fail-safe design, safety margins, redundancy, and the principle of least privilege. These principles have been refined through decades of practice in high-risk industries and are increasingly applied to AI system design. They provide a pragmatic foundation for building safer AI systems even when complete formal verification is not possible.",
    example: "Appears in safetyist nodes discussing practical approaches to building safer AI systems.",
    frequency: "Primarily in safetyist and cross-cutting nodes.",
    links: [
      { label: "Wikipedia: Safety Engineering", url: "https://en.wikipedia.org/wiki/Safety_engineering" },
      { label: "Wikipedia: Defence in Depth", url: "https://en.wikipedia.org/wiki/Defence_in_depth" }
    ]
  },
  "Safety engineering principles": {
    label: "Safety Engineering Principles",
    summary: "Core principles from the field of safety engineering, including defense in depth, fail-safe design, safety margins, redundancy, and the principle of least privilege. These principles have been refined through decades of practice in high-risk industries and are increasingly applied to AI system design. They provide a pragmatic foundation for building safer AI systems even when complete formal verification is not possible.",
    example: "Appears in safetyist nodes discussing practical approaches to building safer AI systems.",
    frequency: "Primarily in safetyist and cross-cutting nodes.",
    links: [
      { label: "Wikipedia: Safety Engineering", url: "https://en.wikipedia.org/wiki/Safety_engineering" },
      { label: "Wikipedia: Defence in Depth", url: "https://en.wikipedia.org/wiki/Defence_in_depth" }
    ]
  },
  "Safety-critical systems engineering": {
    label: "Safety-Critical Systems Engineering",
    summary: "The specialized engineering discipline focused on designing, building, and maintaining systems where failure could result in loss of life, significant environmental damage, or major financial loss. It applies formal methods, rigorous testing, certification processes, and operational procedures developed in domains like aviation, nuclear, and medical devices. AI safety researchers draw heavily on this discipline when arguing for structured evaluation and certification of frontier AI systems before deployment in high-stakes contexts.",
    example: "Referenced in safetyist nodes advocating for formal certification of AI systems in critical applications.",
    frequency: "Prominent in safetyist and cross-cutting nodes; subject to feasibility critiques from skeptics.",
    links: [
      { label: "Wikipedia: Safety-Critical System", url: "https://en.wikipedia.org/wiki/Safety-critical_system" },
      { label: "Leveson: Engineering a Safer World", url: "https://mitpress.mit.edu/9780262533690/engineering-a-safer-world/" }
    ]
  },
  "Scaling Hypothesis": {
    label: "Scaling Hypothesis",
    summary: "The hypothesis that increasing the scale of deep learning models — more parameters, data, and compute — will continue to yield qualitative improvements in capability, potentially leading to artificial general intelligence. Supported by empirical scaling laws documented by researchers at OpenAI and others, this hypothesis drives massive investment in compute infrastructure. It remains contested: proponents see it as the clearest path to AGI, while skeptics argue that scale alone cannot overcome fundamental architectural limitations.",
    example: "Central to accelerationist nodes arguing that continued scaling will produce transformative AI capabilities.",
    frequency: "Core concept in accelerationist nodes; debated across all POVs.",
    links: [
      { label: "Wikipedia: Neural Scaling Law", url: "https://en.wikipedia.org/wiki/Neural_scaling_law" },
      { label: "Kaplan et al.: Scaling Laws for Neural Language Models", url: "https://arxiv.org/abs/2001.08361" }
    ]
  },
  "Scaling Hypothesis (Deep Learning)": {
    label: "Scaling Hypothesis (Deep Learning)",
    summary: "The specific version of the scaling hypothesis applied to deep learning, asserting that larger neural networks trained on more data with more compute will continue to achieve better performance across a widening range of tasks. Empirical evidence from scaling laws research shows predictable power-law improvements with scale, though debates persist about whether this trend will encounter diminishing returns or fundamental barriers. This hypothesis has driven the development of increasingly large foundation models and shapes strategic decisions across the AI industry.",
    example: "Cited in accelerationist nodes justifying investment in ever-larger AI models and compute infrastructure.",
    frequency: "Primarily in accelerationist nodes; critiqued in skeptic and some safetyist nodes.",
    links: [
      { label: "Wikipedia: Neural Scaling Law", url: "https://en.wikipedia.org/wiki/Neural_scaling_law" },
      { label: "Hoffmann et al.: Training Compute-Optimal Large Language Models (Chinchilla)", url: "https://arxiv.org/abs/2203.15556" },
      { label: "Kaplan et al.: Scaling Laws for Neural Language Models", url: "https://arxiv.org/abs/2001.08361" }
    ]
  },
  "Schumpeterian creative destruction": {
    label: "Schumpeterian Creative Destruction",
    summary: "Joseph Schumpeter\'s concept that capitalist economic progress occurs through a continuous process of destroying old industries and business models while creating new ones. Applied to AI, this framework views AI-driven disruption of existing jobs, industries, and institutions as a necessary and ultimately beneficial process of economic renewal. Accelerationists invoke it to argue against protectionist regulation, while critics note that the human costs of creative destruction can be severe and unevenly distributed.",
    example: "Appears in accelerationist nodes arguing that AI-driven economic disruption will ultimately increase prosperity.",
    frequency: "Common in accelerationist nodes; cross-cutting nodes discuss distributional impacts.",
    links: [
      { label: "Wikipedia: Creative Destruction", url: "https://en.wikipedia.org/wiki/Creative_destruction" },
      { label: "Britannica: Joseph Schumpeter", url: "https://www.britannica.com/biography/Joseph-Schumpeter" }
    ]
  },
  "Schumpeterian innovation theory": {
    label: "Schumpeterian Innovation Theory",
    summary: "Schumpeter\'s broader theory of innovation as the primary driver of economic development, emphasizing the role of entrepreneurs and firms in introducing new products, processes, and organizational forms. In AI policy, this theory supports arguments that innovation should be allowed to proceed with minimal regulatory interference, as it is the engine of long-term economic growth. It informs debates about whether AI regulation risks stifling the innovative dynamics that produce widespread benefits.",
    example: "Referenced in accelerationist nodes framing AI innovation as essential economic progress.",
    frequency: "Primarily in accelerationist nodes; cross-cutting discussions on innovation policy.",
    links: [
      { label: "Wikipedia: Joseph Schumpeter", url: "https://en.wikipedia.org/wiki/Joseph_Schumpeter" },
      { label: "Wikipedia: Creative Destruction", url: "https://en.wikipedia.org/wiki/Creative_destruction" }
    ]
  },
  "scientific method (empirical necessity)": {
    label: "Scientific Method (Empirical Necessity)",
    summary: "The principle that claims about AI capabilities, risks, and impacts should be grounded in empirical evidence and reproducible experiments rather than speculation or theoretical arguments alone. Skeptic perspectives emphasize that many AI risk claims lack empirical support and that policy should be based on demonstrated rather than hypothesized harms. This stance values observable evidence and falsifiable predictions over thought experiments about future AI systems.",
    example: "Appears in skeptic nodes demanding empirical evidence for AI risk claims before regulatory action.",
    frequency: "Primarily in skeptic nodes; cross-cutting nodes also invoke empirical standards.",
    links: [
      { label: "Wikipedia: Scientific Method", url: "https://en.wikipedia.org/wiki/Scientific_method" },
      { label: "Stanford Encyclopedia: Scientific Method", url: "https://plato.stanford.edu/entries/scientific-method/" }
    ]
  },
  "Scientific method (reproducibility)": {
    label: "Scientific Method (Reproducibility)",
    summary: "The emphasis on reproducibility as a cornerstone of scientific validity, applied to AI research and risk assessment. Concerns about the reproducibility crisis in machine learning — including irreproducible benchmarks, unreported hyperparameters, and dataset issues — undermine confidence in AI capability and safety claims. This perspective demands that AI safety research and policy-relevant AI evaluations meet the same reproducibility standards expected of other scientific disciplines.",
    example: "Cited in skeptic and cross-cutting nodes critiquing the scientific rigor of AI capabilities claims.",
    frequency: "Found in skeptic and cross-cutting nodes; some safetyist acknowledgment.",
    links: [
      { label: "Wikipedia: Reproducibility", url: "https://en.wikipedia.org/wiki/Reproducibility" },
      { label: "Pineau et al.: ML Reproducibility Checklist", url: "https://www.cs.mcgill.ca/~jpineau/ReproducibilityChecklist.pdf" }
    ]
  },
  "Secular humanism": {
    label: "Secular Humanism",
    summary: "A philosophical stance that embraces human reason, ethics, and justice while rejecting supernatural or religious dogma as the basis for morality and decision-making. In AI policy discourse, secular humanism informs arguments that AI should serve human flourishing as defined by human values and rational inquiry rather than transcendent goals. It contrasts with transhumanist and singularitarian perspectives that may treat AI advancement as quasi-spiritual progress.",
    example: "Referenced in cross-cutting nodes discussing the ethical foundations of AI governance and human-centered design.",
    frequency: "Primarily in cross-cutting nodes; some skeptic references.",
    links: [
      { label: "Wikipedia: Secular Humanism", url: "https://en.wikipedia.org/wiki/Secular_humanism" },
      { label: "American Humanist Association", url: "https://americanhumanist.org/what-is-humanism/" }
    ]
  },
  "Singularitarianism": {
    label: "Singularitarianism",
    summary: "A philosophical and cultural movement centered on the belief that a technological singularity — the creation of superintelligent AI — is both inevitable and desirable. Singularitarians advocate accelerating technological progress to bring about this transformative event, often viewing it as the solution to humanity\'s most pressing problems including aging, scarcity, and death. Critics characterize it as a secular religion with unfalsifiable predictions, while proponents see it as a rational extrapolation of technological trends.",
    example: "Appears in accelerationist nodes expressing strong optimism about transformative AI and in skeptic critiques.",
    frequency: "Core to accelerationist nodes; critically examined in skeptic nodes.",
    links: [
      { label: "Wikipedia: Singularitarianism", url: "https://en.wikipedia.org/wiki/Singularitarianism" },
      { label: "Wikipedia: Technological Singularity", url: "https://en.wikipedia.org/wiki/Technological_singularity" }
    ]
  },
  "Skepticism towards moral panics": {
    label: "Skepticism Towards Moral Panics",
    summary: "A sociological perspective that views intense public concern about emerging technologies as potentially irrational, disproportionate, or driven by media amplification rather than actual evidence of harm. Applied to AI, this skepticism suggests that fears about existential risk, mass unemployment, or autonomous weapons may follow the pattern of previous moral panics about technologies like video games, the internet, or genetic engineering. This stance cautions against reactive policymaking driven by fear rather than evidence.",
    example: "Appears in skeptic nodes arguing that AI fears are overblown and historically patterned.",
    frequency: "Primarily in skeptic nodes; some accelerationist alignment.",
    links: [
      { label: "Wikipedia: Moral Panic", url: "https://en.wikipedia.org/wiki/Moral_panic" },
      { label: "Wikipedia: Techno-panic", url: "https://en.wikipedia.org/wiki/Technopanic" }
    ]
  },
  "social safety net philosophy": {
    label: "Social Safety Net Philosophy",
    summary: "The philosophical and policy tradition advocating for government-provided protections against economic hardship, including unemployment insurance, healthcare, and housing support. In AI policy, this philosophy motivates proposals for expanded safety nets to cushion the impact of AI-driven automation on workers and communities. It underpins arguments for universal basic income, retraining programs, and other measures to ensure that the benefits of AI-driven productivity gains are broadly shared.",
    example: "Referenced in cross-cutting and skeptic nodes discussing policy responses to AI-driven labor displacement.",
    frequency: "Common in cross-cutting nodes; some accelerationist and skeptic references.",
    links: [
      { label: "Wikipedia: Social Safety Net", url: "https://en.wikipedia.org/wiki/Social_safety_net" },
      { label: "World Bank: Social Protection", url: "https://www.worldbank.org/en/topic/socialprotection" }
    ]
  },
  "social safety net principles": {
    label: "Social Safety Net Principles",
    summary: "Core principles underlying social safety net design, including universality, adequacy, accessibility, and responsiveness to changing economic conditions. In the context of AI-driven economic transformation, these principles guide proposals for modernizing safety nets to address new forms of precarity, including gig economy work, skill obsolescence, and rapid industry disruption. The principles emphasize that safety nets should enable adaptation rather than merely provide temporary relief.",
    example: "Appears in cross-cutting nodes discussing how to adapt social infrastructure for AI-driven economic changes.",
    frequency: "Found in cross-cutting and skeptic nodes on economic policy responses to AI.",
    links: [
      { label: "Wikipedia: Social Safety Net", url: "https://en.wikipedia.org/wiki/Social_safety_net" },
      { label: "ILO: Social Protection", url: "https://www.ilo.org/topics/social-protection" }
    ]
  },
  "Social wealth funds": {
    label: "Social Wealth Funds",
    summary: "Publicly owned investment funds that hold assets on behalf of the general population, distributing returns as dividends or public services. Proposed as a mechanism for sharing the economic gains of AI and automation more broadly, social wealth funds could hold equity stakes in AI companies or collect revenue from AI-generated productivity gains. The concept draws on existing models like the Alaska Permanent Fund and Norway\'s Government Pension Fund.",
    example: "Cited in cross-cutting nodes proposing mechanisms for distributing AI-generated wealth broadly.",
    frequency: "Primarily in cross-cutting nodes; some accelerationist interest.",
    links: [
      { label: "Wikipedia: Sovereign Wealth Fund", url: "https://en.wikipedia.org/wiki/Sovereign_wealth_fund" },
      { label: "Wikipedia: Alaska Permanent Fund", url: "https://en.wikipedia.org/wiki/Alaska_Permanent_Fund" }
    ]
  },
  "Socialism": {
    label: "Socialism",
    summary: "A range of economic and social systems characterized by social ownership of the means of production, as opposed to private ownership. In AI policy, socialist perspectives raise questions about who should own and control AI systems and who should benefit from AI-generated wealth. These perspectives critique the concentration of AI capabilities in a small number of private corporations and advocate for public or collective ownership of AI infrastructure and democratic governance of AI development.",
    example: "Referenced in cross-cutting nodes discussing ownership structures and distribution of AI benefits.",
    frequency: "Occasionally in cross-cutting nodes; some skeptic engagement with distributional concerns.",
    links: [
      { label: "Wikipedia: Socialism", url: "https://en.wikipedia.org/wiki/Socialism" },
      { label: "Stanford Encyclopedia: Socialism", url: "https://plato.stanford.edu/entries/socialism/" }
    ]
  },
  "Socialist economic theory": {
    label: "Socialist Economic Theory",
    summary: "Economic theories advocating for collective or state ownership of productive resources and democratic planning of economic activity. Applied to AI, socialist economic theory questions whether AI — as a potentially transformative means of production — should be privately owned and controlled by profit-maximizing corporations or publicly governed for collective benefit. It informs proposals for nationalizing AI infrastructure, public AI labs, and democratic oversight of AI deployment decisions.",
    example: "Appears in cross-cutting nodes discussing alternative economic models for AI ownership and governance.",
    frequency: "Occasionally in cross-cutting nodes; rare in other POVs.",
    links: [
      { label: "Wikipedia: Socialist Economics", url: "https://en.wikipedia.org/wiki/Socialist_economics" },
      { label: "Stanford Encyclopedia: Socialism", url: "https://plato.stanford.edu/entries/socialism/" }
    ]
  },
  "Sociology of science (critique of 'cults')": {
    label: "Sociology of Science (Critique of \'Cults\')",
    summary: "A sociological lens that examines how scientific and technical communities can develop insular belief systems, groupthink, and social dynamics resembling cults or religious movements. Applied to the AI safety community, this critique argues that some AI risk discourse exhibits characteristics like unfalsifiable predictions, charismatic authority, in-group/out-group dynamics, and resistance to external criticism. It questions whether AI existential risk concerns reflect genuine scientific consensus or the sociology of a particular community.",
    example: "Appears in skeptic nodes critiquing the social dynamics of the AI safety and effective altruism communities.",
    frequency: "Primarily in skeptic nodes.",
    links: [
      { label: "Wikipedia: Sociology of Scientific Knowledge", url: "https://en.wikipedia.org/wiki/Sociology_of_scientific_knowledge" },
      { label: "Wikipedia: Groupthink", url: "https://en.wikipedia.org/wiki/Groupthink" }
    ]
  },
  "sociology of science (discourse analysis)": {
    label: "Sociology of Science (Discourse Analysis)",
    summary: "The application of discourse analysis methods from the sociology of science to understand how AI risk narratives are constructed, propagated, and gain authority. This approach examines the rhetorical strategies, framing choices, and institutional contexts that shape AI policy discourse. It highlights how claims about AI capabilities and risks are socially constructed through specific communities, publications, and media dynamics rather than emerging neutrally from empirical evidence alone.",
    example: "Referenced in skeptic nodes analyzing how AI risk narratives gain cultural and policy traction.",
    frequency: "Primarily in skeptic nodes; some cross-cutting analytical use.",
    links: [
      { label: "Wikipedia: Sociology of Scientific Knowledge", url: "https://en.wikipedia.org/wiki/Sociology_of_scientific_knowledge" },
      { label: "Wikipedia: Discourse Analysis", url: "https://en.wikipedia.org/wiki/Discourse_analysis" }
    ]
  },
  "sociology of technology": {
    label: "Sociology of Technology",
    summary: "The study of how social factors shape technological development and how technologies in turn shape society. Key frameworks include the social construction of technology (SCOT), actor-network theory (ANT), and technological momentum. Applied to AI, this field examines how social values, institutional interests, and cultural assumptions are embedded in AI systems, and how AI deployment reshapes social relations, power structures, and cultural norms.",
    example: "Appears in skeptic and cross-cutting nodes examining the social shaping of AI development trajectories.",
    frequency: "Found in skeptic and cross-cutting nodes.",
    links: [
      { label: "Wikipedia: Sociology of Technology", url: "https://en.wikipedia.org/wiki/Sociology_of_technology" },
      { label: "Wikipedia: Social Construction of Technology", url: "https://en.wikipedia.org/wiki/Social_construction_of_technology" }
    ]
  },
  "Software development lifecycle (SDLC) testing": {
    label: "Software Development Lifecycle (SDLC) Testing",
    summary: "The practices and methodologies for testing software throughout its development lifecycle, including unit testing, integration testing, system testing, and acceptance testing. Applied to AI systems, SDLC testing raises unique challenges because ML models are not deterministic in the traditional sense and their behavior depends on training data and learned parameters rather than explicit logic. Adapting SDLC testing for AI requires new approaches such as behavioral testing, adversarial testing, and continuous monitoring in production.",
    example: "Referenced in cross-cutting and safetyist nodes discussing quality assurance practices for AI systems.",
    frequency: "Found in cross-cutting and safetyist nodes on AI engineering practices.",
    links: [
      { label: "Wikipedia: Software Testing", url: "https://en.wikipedia.org/wiki/Software_testing" },
      { label: "Wikipedia: Software Development Process", url: "https://en.wikipedia.org/wiki/Software_development_process" }
    ]
  },
  "Software engineering safety standards (e.g., aerospace)": {
    label: "Software Engineering Safety Standards (e.g., Aerospace)",
    summary: "Formal standards governing software development for safety-critical applications, particularly in aerospace (DO-178C), automotive (ISO 26262), and medical devices (IEC 62304). These standards prescribe rigorous processes for requirements specification, design, implementation, verification, and configuration management. Proponents argue that similar rigor should apply to AI systems in safety-critical contexts, while critics note that machine learning models do not fit neatly into traditional software certification frameworks.",
    example: "Cited in safetyist nodes proposing certification frameworks for AI in safety-critical applications.",
    frequency: "Primarily in safetyist and cross-cutting nodes.",
    links: [
      { label: "Wikipedia: DO-178C", url: "https://en.wikipedia.org/wiki/DO-178C" },
      { label: "Wikipedia: IEC 62304", url: "https://en.wikipedia.org/wiki/IEC_62304" },
      { label: "Wikipedia: ISO 26262", url: "https://en.wikipedia.org/wiki/ISO_26262" }
    ]
  },
  "Software supply chain security": {
    label: "Software Supply Chain Security",
    summary: "The practice of securing all components, dependencies, and processes involved in building and deploying software, from third-party libraries to build systems to deployment pipelines. For AI systems, supply chain security encompasses model provenance, training data integrity, dependency management for ML frameworks, and protection against poisoned models or tampered weights. High-profile supply chain attacks like SolarWinds have heightened awareness that AI systems inherit vulnerabilities from their entire dependency chain.",
    example: "Appears in safetyist and cross-cutting nodes discussing infrastructure security for AI deployment.",
    frequency: "Found in safetyist and cross-cutting nodes on AI security.",
    links: [
      { label: "Wikipedia: Supply Chain Attack", url: "https://en.wikipedia.org/wiki/Supply_chain_attack" },
      { label: "NIST: Software Supply Chain Security", url: "https://www.nist.gov/itl/executive-order-14028-improving-nations-cybersecurity/software-supply-chain-security" }
    ]
  },
  "Specification gaming literature": {
    label: "Specification Gaming Literature",
    summary: "The body of research documenting cases where AI systems achieve their specified objectives in unintended ways, satisfying the letter but not the spirit of their reward functions. This literature catalogs examples from reinforcement learning where agents exploit loopholes, such as a boat racing game agent that earned more points circling power-ups than finishing the race. Specification gaming is a key concern for AI safety because it demonstrates the difficulty of precisely specifying human intentions in formal objectives.",
    example: "Cited in safetyist nodes illustrating the challenge of aligning AI behavior with human intent.",
    frequency: "Common in safetyist nodes; cross-cutting discussions of alignment challenges.",
    links: [
      { label: "DeepMind: Specification Gaming Examples", url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRPiprOaC3HsCf5Tuum8bRfzYUiKLRqJCOYKNr-BKAA52oyRKSFj3a_RtPgSBUhaAQ2GFHO8LVKUCZE/pubhtml" },
      { label: "Krakovna et al.: Specification Gaming", url: "https://deepmindsafetyresearch.medium.com/specification-gaming-the-flip-side-of-ai-ingenuity-c85bdb0debd4" }
    ]
  },
  "Supply-side economics": {
    label: "Supply-Side Economics",
    summary: "An economic theory holding that economic growth is most effectively created by lowering barriers to production — through tax cuts, deregulation, and free trade — rather than stimulating demand. In AI policy, supply-side arguments are invoked to oppose regulatory burdens on AI companies, arguing that unfettered innovation will produce the greatest societal benefits through increased productivity and economic growth. Critics counter that supply-side approaches ignore distributional consequences and market failures.",
    example: "Referenced in accelerationist nodes arguing against AI regulation as an impediment to growth.",
    frequency: "Primarily in accelerationist nodes.",
    links: [
      { label: "Wikipedia: Supply-Side Economics", url: "https://en.wikipedia.org/wiki/Supply-side_economics" },
      { label: "Britannica: Supply-Side Economics", url: "https://www.britannica.com/topic/supply-side-economics" }
    ]
  },
  "Surveillance capitalism critique (Zuboff)": {
    label: "Surveillance Capitalism Critique (Zuboff)",
    summary: "Shoshana Zuboff\'s theory that a new form of capitalism has emerged in which tech companies extract behavioral data from users as raw material for prediction products sold to advertisers and other buyers. Applied to AI, this critique argues that AI systems are instruments of surveillance capitalism — optimizing for engagement, extraction, and behavioral manipulation rather than user welfare. The framework highlights how AI development is shaped by business models that treat human experience as free raw material for commercial prediction.",
    example: "Cited in cross-cutting and skeptic nodes critiquing the incentive structures driving AI development.",
    frequency: "Found in cross-cutting and skeptic nodes; some safetyist engagement.",
    links: [
      { label: "Wikipedia: Surveillance Capitalism", url: "https://en.wikipedia.org/wiki/Surveillance_capitalism" },
      { label: "Zuboff: The Age of Surveillance Capitalism", url: "https://shoshanazuboff.com/book/about/" }
    ]
  },
  "Symbolic AI vs. Connectionism debate": {
    label: "Symbolic AI vs. Connectionism Debate",
    summary: "The long-standing debate in AI research between symbolic approaches (using explicit rules, logic, and structured representations) and connectionist approaches (using neural networks that learn distributed representations from data). This debate has shaped the field\'s trajectory for decades and remains relevant: modern large language models are connectionist systems whose capabilities challenge but have not resolved questions about the necessity of symbolic reasoning. The debate informs AI safety discussions about interpretability, formal verification, and the reliability of learned versus designed systems.",
    example: "Referenced in skeptic and cross-cutting nodes discussing the theoretical foundations and limitations of current AI approaches.",
    frequency: "Cross-cutting; appears in skeptic critiques and technical discussions.",
    links: [
      { label: "Wikipedia: Symbolic AI", url: "https://en.wikipedia.org/wiki/Symbolic_artificial_intelligence" },
      { label: "Wikipedia: Connectionism", url: "https://en.wikipedia.org/wiki/Connectionism" }
    ]
  },
  "systems thinking": {
    label: "Systems Thinking",
    summary: "An analytical approach that views problems as parts of an interconnected whole rather than in isolation, emphasizing feedback loops, emergent properties, and unintended consequences. Applied to AI governance, systems thinking argues that AI cannot be understood or regulated in isolation from the social, economic, and institutional systems in which it is embedded. It supports holistic approaches to AI policy that consider second-order effects, systemic risks, and interactions between AI systems and existing societal structures.",
    example: "Appears in cross-cutting and safetyist nodes advocating holistic approaches to AI governance.",
    frequency: "Common in cross-cutting nodes; some safetyist and skeptic usage.",
    links: [
      { label: "Wikipedia: Systems Thinking", url: "https://en.wikipedia.org/wiki/Systems_thinking" },
      { label: "Donella Meadows: Thinking in Systems", url: "https://www.chelseagreen.com/product/thinking-in-systems/" }
    ]
  },
  "Techno-libertarianism": {
    label: "Techno-Libertarianism",
    summary: "A political philosophy that combines libertarian opposition to government regulation with strong enthusiasm for technological innovation, particularly in computing and AI. Techno-libertarians argue that technology is inherently liberating and that government intervention in the tech sector stifles innovation and individual freedom. In AI policy, this perspective opposes most forms of AI regulation, favoring market-driven governance, individual choice, and technological solutions to social problems over regulatory ones.",
    example: "Core philosophy in accelerationist nodes arguing that markets, not governments, should govern AI development.",
    frequency: "Primarily in accelerationist nodes; critically examined in skeptic and cross-cutting nodes.",
    links: [
      { label: "Wikipedia: Technolibertarianism", url: "https://en.wikipedia.org/wiki/Technolibertarianism" },
      { label: "Wikipedia: Libertarianism", url: "https://en.wikipedia.org/wiki/Libertarianism" }
    ]
  },
  "Techno-utopianism": {
    label: "Techno-Utopianism",
    summary: "The belief that technology — particularly advanced AI — will solve most or all of humanity\'s fundamental problems, including poverty, disease, environmental degradation, and even death. Techno-utopians view technological progress as the primary driver of human flourishing and tend to downplay risks or transition costs. Critics argue that this perspective ignores how technologies can amplify existing inequalities, create new problems, and reflect the values and interests of their creators rather than serving universal human needs.",
    example: "Appears in accelerationist nodes expressing strong optimism about AI\'s transformative potential.",
    frequency: "Core to accelerationist nodes; critically examined across all other POVs.",
    links: [
      { label: "Wikipedia: Technological Utopianism", url: "https://en.wikipedia.org/wiki/Technological_utopianism" },
      { label: "Wikipedia: Techno-optimism", url: "https://en.wikipedia.org/wiki/Techno-optimism" }
    ]
  },
  "technological determinism (soft version)": {
    label: "Technological Determinism (Soft Version)",
    summary: "The view that technology is a significant force shaping society, but one that is itself shaped by social, economic, and political factors — in contrast to hard determinism, which treats technology as an autonomous force. Soft technological determinism acknowledges that AI will have profound social effects while recognizing that policy choices, institutional design, and social movements can influence AI\'s development trajectory and societal impacts. This nuanced position informs moderate approaches to AI governance.",
    example: "Referenced in cross-cutting and skeptic nodes discussing how society can shape AI development outcomes.",
    frequency: "Found in cross-cutting and skeptic nodes; implicit in some accelerationist framing.",
    links: [
      { label: "Wikipedia: Technological Determinism", url: "https://en.wikipedia.org/wiki/Technological_determinism" },
      { label: "Stanford Encyclopedia: Philosophy of Technology", url: "https://plato.stanford.edu/entries/technology/" }
    ]
  },
  "Technological determinism (soft version)": {
    label: "Technological Determinism (Soft Version)",
    summary: "The view that technology is a significant force shaping society, but one that is itself shaped by social, economic, and political factors — in contrast to hard determinism, which treats technology as an autonomous force. Soft technological determinism acknowledges that AI will have profound social effects while recognizing that policy choices, institutional design, and social movements can influence AI\'s development trajectory and societal impacts. This nuanced position informs moderate approaches to AI governance.",
    example: "Referenced in cross-cutting and skeptic nodes discussing how society can shape AI development outcomes.",
    frequency: "Found in cross-cutting and skeptic nodes; implicit in some accelerationist framing.",
    links: [
      { label: "Wikipedia: Technological Determinism", url: "https://en.wikipedia.org/wiki/Technological_determinism" },
      { label: "Stanford Encyclopedia: Philosophy of Technology", url: "https://plato.stanford.edu/entries/technology/" }
    ]
  },
  "Technological singularity": {
    label: "Technological Singularity",
    summary: "The hypothetical point at which technological growth becomes uncontrollable and irreversible, resulting in unforeseeable changes to civilization. Most commonly associated with the creation of superintelligent AI that could recursively improve itself, leading to an intelligence explosion. The concept, popularized by Vernor Vinge and Ray Kurzweil, is central to both accelerationist excitement and safetyist concern about ensuring that such a transition, if it occurs, is beneficial to humanity.",
    example: "Core concept in accelerationist and safetyist nodes discussing transformative AI scenarios.",
    frequency: "Fundamental across accelerationist and safetyist nodes; critiqued by skeptics.",
    links: [
      { label: "Wikipedia: Technological Singularity", url: "https://en.wikipedia.org/wiki/Technological_singularity" },
      { label: "Vinge: The Coming Technological Singularity", url: "https://edoras.sdsu.edu/~vinge/misc/singularity.html" }
    ]
  },
  "Technological Singularity (Vernor Vinge, Ray Kurzweil)": {
    label: "Technological Singularity (Vernor Vinge, Ray Kurzweil)",
    summary: "The technological singularity as articulated by its two most prominent proponents: Vernor Vinge, who introduced the modern concept in his 1993 essay predicting superhuman intelligence within 30 years, and Ray Kurzweil, who elaborated detailed timelines and mechanisms in \'The Singularity Is Near\' (2005). Vinge emphasized the fundamental unpredictability beyond the singularity, while Kurzweil provided specific predictions about when milestones would be reached. Both perspectives motivate urgent engagement with AI safety and governance.",
    example: "Cited in accelerationist and safetyist nodes discussing specific singularity predictions and timelines.",
    frequency: "Common in accelerationist and safetyist nodes; skeptics challenge the predictions.",
    links: [
      { label: "Wikipedia: Technological Singularity", url: "https://en.wikipedia.org/wiki/Technological_singularity" },
      { label: "Vinge: The Coming Technological Singularity", url: "https://edoras.sdsu.edu/~vinge/misc/singularity.html" },
      { label: "Wikipedia: The Singularity Is Near", url: "https://en.wikipedia.org/wiki/The_Singularity_Is_Near" }
    ]
  },
  "Technological solutionism": {
    label: "Technological Solutionism",
    summary: "The belief that technology can provide solutions to all social, political, and economic problems, often by reframing complex societal issues as engineering challenges. Coined by Evgeny Morozov, the term critiques the tendency in Silicon Valley to apply technological fixes to problems that require political, institutional, or cultural solutions. In AI policy, solutionism manifests as the assumption that AI tools can solve problems like inequality, climate change, or healthcare access without addressing underlying structural issues.",
    example: "Appears in skeptic and cross-cutting nodes critiquing overreliance on AI as a solution to societal problems.",
    frequency: "Primarily in skeptic nodes; some cross-cutting critical analysis.",
    links: [
      { label: "Wikipedia: Technological Solutionism", url: "https://en.wikipedia.org/wiki/Technological_fix#Solutionism" },
      { label: "Morozov: To Save Everything, Click Here", url: "https://www.publicaffairsbooks.com/titles/evgeny-morozov/to-save-everything-click-here/9781610393706/" }
    ]
  },
  "Technological unemployment debate (e.g., Keynes)": {
    label: "Technological Unemployment Debate (e.g., Keynes)",
    summary: "The long-running economic debate about whether technological progress permanently destroys jobs or ultimately creates more than it eliminates. John Maynard Keynes coined \'technological unemployment\' in 1930, predicting it as a temporary phase. The AI era has intensified this debate: optimists argue that AI, like previous technologies, will create new job categories, while pessimists contend that AI\'s ability to automate cognitive tasks makes this wave fundamentally different from past industrial revolutions.",
    example: "Referenced in cross-cutting and accelerationist nodes discussing AI\'s labor market impact.",
    frequency: "Cross-cutting concern; discussed in accelerationist, skeptic, and cross-cutting nodes.",
    links: [
      { label: "Wikipedia: Technological Unemployment", url: "https://en.wikipedia.org/wiki/Technological_unemployment" },
      { label: "Keynes: Economic Possibilities for Our Grandchildren", url: "https://www.marxists.org/reference/subject/economics/keynes/1930/our-grandchildren.htm" }
    ]
  },
  "Technological utopianism": {
    label: "Technological Utopianism",
    summary: "The belief that advances in science and technology will eventually bring about an ideal society, eliminating scarcity, suffering, and other fundamental human problems. In the context of AI, technological utopians envision a future where AI solves climate change, cures diseases, eliminates poverty, and enables unprecedented human flourishing. This perspective drives accelerationist enthusiasm for rapid AI development but is criticized for underestimating transition risks, power dynamics, and the distribution of benefits.",
    example: "Appears in accelerationist nodes envisioning AI-driven abundance and post-scarcity futures.",
    frequency: "Core to accelerationist nodes; critiqued in skeptic and cross-cutting nodes.",
    links: [
      { label: "Wikipedia: Technological Utopianism", url: "https://en.wikipedia.org/wiki/Technological_utopianism" },
      { label: "Wikipedia: Post-scarcity Economy", url: "https://en.wikipedia.org/wiki/Post-scarcity_economy" }
    ]
  },
  "Technology assessment": {
    label: "Technology Assessment",
    summary: "A systematic process for evaluating the potential social, economic, environmental, and ethical impacts of new technologies before they are widely deployed. Originating with the US Office of Technology Assessment (1972-1995), technology assessment provides structured methods for anticipating consequences and informing policy decisions. Applied to AI, it calls for comprehensive impact assessments of AI systems, including their effects on employment, privacy, equity, and democratic institutions, before large-scale deployment.",
    example: "Referenced in cross-cutting and skeptic nodes advocating for structured evaluation of AI impacts before deployment.",
    frequency: "Common in cross-cutting and skeptic nodes; some safetyist alignment.",
    links: [
      { label: "Wikipedia: Technology Assessment", url: "https://en.wikipedia.org/wiki/Technology_assessment" },
      { label: "Wikipedia: Office of Technology Assessment", url: "https://en.wikipedia.org/wiki/Office_of_Technology_Assessment" }
    ]
  },
  "Technology governance frameworks": {
    label: "Technology Governance Frameworks",
    summary: "Structured approaches to governing the development and deployment of technologies, encompassing standards, regulations, norms, and institutional arrangements. In AI, governance frameworks attempt to balance innovation with safety, fairness, and accountability through mechanisms like impact assessments, auditing requirements, transparency standards, and stakeholder participation. Examples include the EU AI Act\'s risk-based approach, the OECD AI Principles, and the NIST AI RMF.",
    example: "Appears in cross-cutting nodes discussing comprehensive approaches to AI governance.",
    frequency: "Widely referenced across all POVs, especially cross-cutting nodes.",
    links: [
      { label: "OECD AI Policy Observatory", url: "https://oecd.ai/en/policy-areas" },
      { label: "Wikipedia: AI Regulation", url: "https://en.wikipedia.org/wiki/Regulation_of_artificial_intelligence" },
      { label: "NIST AI Risk Management Framework", url: "https://www.nist.gov/itl/ai-risk-management-framework" }
    ]
  },
  "Teilhard de Chardin (Omega Point)": {
    label: "Teilhard de Chardin (Omega Point)",
    summary: "Pierre Teilhard de Chardin\'s philosophical concept that the universe is evolving toward a supreme point of complexity and consciousness called the Omega Point. Some transhumanists and singularitarians draw parallels between de Chardin\'s vision of converging consciousness and the potential emergence of superintelligent AI or a global technological singularity. The concept provides a quasi-spiritual framework for understanding AI as part of a larger evolutionary trajectory, though critics view such analogies as inappropriately mystical.",
    example: "Referenced in accelerationist nodes with philosophical framings of AI as evolutionary culmination.",
    frequency: "Occasionally in accelerationist nodes; critically noted in skeptic analyses.",
    links: [
      { label: "Wikipedia: Omega Point", url: "https://en.wikipedia.org/wiki/Omega_point" },
      { label: "Wikipedia: Pierre Teilhard de Chardin", url: "https://en.wikipedia.org/wiki/Pierre_Teilhard_de_Chardin" }
    ]
  },
  "Teilhard de Chardin's Omega Point": {
    label: "Teilhard de Chardin\'s Omega Point",
    summary: "Pierre Teilhard de Chardin\'s philosophical concept that the universe is evolving toward a supreme point of complexity and consciousness called the Omega Point. Some transhumanists and singularitarians draw parallels between de Chardin\'s vision of converging consciousness and the potential emergence of superintelligent AI or a global technological singularity. The concept provides a quasi-spiritual framework for understanding AI as part of a larger evolutionary trajectory, though critics view such analogies as inappropriately mystical.",
    example: "Referenced in accelerationist nodes with philosophical framings of AI as evolutionary culmination.",
    frequency: "Occasionally in accelerationist nodes; critically noted in skeptic analyses.",
    links: [
      { label: "Wikipedia: Omega Point", url: "https://en.wikipedia.org/wiki/Omega_point" },
      { label: "Wikipedia: Pierre Teilhard de Chardin", url: "https://en.wikipedia.org/wiki/Pierre_Teilhard_de_Chardin" }
    ]
  },
  "Thucydides Trap": {
    label: "Thucydides Trap",
    summary: "A concept popularized by political scientist Graham Allison, referring to the pattern where a rising power threatens to displace an established one, making conflict more likely. Applied to the US-China AI competition, the Thucydides Trap framework warns that strategic rivalry over AI dominance could escalate into conflict, particularly if one side perceives itself as falling behind. This framing shapes arguments both for and against international AI cooperation and arms control agreements.",
    example: "Cited in accelerationist and cross-cutting nodes analyzing US-China AI competition dynamics.",
    frequency: "Found in accelerationist and cross-cutting nodes on geopolitical AI competition.",
    links: [
      { label: "Wikipedia: Thucydides Trap", url: "https://en.wikipedia.org/wiki/Thucydides_Trap" },
      { label: "Allison: Destined for War", url: "https://www.belfercenter.org/thucydides-trap/overview-thucydides-trap" }
    ]
  },
  "Tool use in AI research": {
    label: "Tool Use in AI Research",
    summary: "Research on enabling AI systems to use external tools — calculators, search engines, code interpreters, APIs — to extend their capabilities beyond what is learned during training. Tool use has become a key paradigm in modern AI, allowing language models to overcome limitations in arithmetic, factual knowledge, and interaction with the world. It raises safety considerations about the scope of actions AI systems can take and the difficulty of constraining tool-augmented agents.",
    example: "Appears in cross-cutting and safetyist nodes discussing AI capability amplification and control challenges.",
    frequency: "Cross-cutting technical concept; safety implications discussed in safetyist nodes.",
    links: [
      { label: "Schick et al.: Toolformer", url: "https://arxiv.org/abs/2302.04761" },
      { label: "Wikipedia: AI Agent", url: "https://en.wikipedia.org/wiki/Intelligent_agent" }
    ]
  },
  "Tragedy of the Commons (applied to safety)": {
    label: "Tragedy of the Commons (Applied to Safety)",
    summary: "The application of Garrett Hardin\'s tragedy of the commons to AI safety, where individual actors have rational incentives to underinvest in safety and race to deploy AI systems quickly, even though collective safety would benefit everyone. Each company or nation bears the full cost of safety investment but shares the benefits with competitors, creating a free-rider problem. This framing motivates arguments for binding safety standards, international agreements, and coordinated governance to overcome the collective action failure.",
    example: "Cited in safetyist and cross-cutting nodes arguing for mandatory safety standards and international coordination.",
    frequency: "Common in safetyist and cross-cutting nodes.",
    links: [
      { label: "Wikipedia: Tragedy of the Commons", url: "https://en.wikipedia.org/wiki/Tragedy_of_the_commons" },
      { label: "Hardin: The Tragedy of the Commons (1968)", url: "https://www.science.org/doi/10.1126/science.162.3859.1243" }
    ]
  },
  "Transhumanism": {
    label: "Transhumanism",
    summary: "A philosophical and intellectual movement advocating for the use of technology to fundamentally enhance human physical and cognitive capabilities, ultimately transcending biological limitations. Transhumanists view AI as a potential tool for radical life extension, cognitive enhancement, and even mind uploading. In AI policy, transhumanism motivates accelerationist arguments for rapid AI development and shapes safetyist concerns about ensuring that such transformative technologies benefit humanity broadly rather than exacerbating inequality.",
    example: "Core philosophy in accelerationist nodes; discussed across all POVs regarding the future of human-AI coevolution.",
    frequency: "Central to accelerationist nodes; discussed critically in skeptic and cross-cutting nodes.",
    links: [
      { label: "Wikipedia: Transhumanism", url: "https://en.wikipedia.org/wiki/Transhumanism" },
      { label: "Humanity+", url: "https://www.humanityplus.org/" }
    ]
  },
  "Transhumanism (extreme forms)": {
    label: "Transhumanism (Extreme Forms)",
    summary: "The more radical variants of transhumanism that advocate for complete transcendence of biological humanity through technologies like mind uploading, whole brain emulation, or merger with AI systems. Extreme transhumanists may view the biological human form as obsolete and actively seek to replace it with superior technological alternatives. Critics from multiple perspectives argue that these visions are scientifically implausible, ethically problematic, or reflective of a privileged minority\'s values rather than broadly shared human aspirations.",
    example: "Referenced in accelerationist nodes expressing radical enhancement goals and in skeptic critiques of those goals.",
    frequency: "Some accelerationist nodes; critiqued in skeptic and cross-cutting analyses.",
    links: [
      { label: "Wikipedia: Transhumanism", url: "https://en.wikipedia.org/wiki/Transhumanism" },
      { label: "Wikipedia: Mind Uploading", url: "https://en.wikipedia.org/wiki/Mind_uploading" }
    ]
  },
  "Transhumanism (philosophical wing)": {
    label: "Transhumanism (Philosophical Wing)",
    summary: "The academic and philosophical tradition within transhumanism that engages seriously with ethical, epistemological, and metaphysical questions about human enhancement. Philosophers like Nick Bostrom, Julian Savulescu, and others have developed sophisticated arguments about the ethics of enhancement, the nature of personal identity in the context of radical modification, and the moral status of posthuman beings. This intellectual tradition provides conceptual foundations for both accelerationist enthusiasm and safetyist caution about transformative AI.",
    example: "Appears in cross-cutting and accelerationist nodes engaging with the philosophical foundations of human enhancement.",
    frequency: "Found in accelerationist and cross-cutting philosophical discussions.",
    links: [
      { label: "Wikipedia: Transhumanism", url: "https://en.wikipedia.org/wiki/Transhumanism" },
      { label: "Bostrom: Transhumanist Values", url: "https://nickbostrom.com/ethics/values" }
    ]
  },
  "Transparency in algorithms movement": {
    label: "Transparency in Algorithms Movement",
    summary: "A civil society and academic movement advocating for greater openness about how algorithmic systems make decisions that affect people\'s lives, from credit scoring to criminal justice to content moderation. The movement encompasses demands for algorithmic auditing, explainability requirements, public disclosure of algorithmic impacts, and meaningful human oversight. It has influenced legislation like the EU AI Act and GDPR\'s transparency provisions and continues to shape expectations for responsible AI deployment.",
    example: "Referenced in cross-cutting and safetyist nodes discussing accountability mechanisms for AI systems.",
    frequency: "Common in cross-cutting nodes; safetyist support; accelerationist concerns about feasibility.",
    links: [
      { label: "Wikipedia: Algorithmic Transparency", url: "https://en.wikipedia.org/wiki/Algorithmic_transparency" },
      { label: "Algorithm Watch", url: "https://algorithmwatch.org/" }
    ]
  },
  "Triage principles": {
    label: "Triage Principles",
    summary: "Decision-making principles from emergency medicine that prioritize resource allocation based on urgency and likelihood of benefit. Applied to AI governance, triage principles suggest that limited regulatory attention and resources should focus on the AI applications and risks where intervention can have the greatest impact. This approach emphasizes prioritization over comprehensive coverage, acknowledging that regulators cannot address all AI risks simultaneously and must make strategic choices about where to focus.",
    example: "Appears in cross-cutting and skeptic nodes discussing how to prioritize AI governance efforts under resource constraints.",
    frequency: "Found in cross-cutting and skeptic nodes on practical governance.",
    links: [
      { label: "Wikipedia: Triage", url: "https://en.wikipedia.org/wiki/Triage" },
      { label: "Wikipedia: Medical Prioritization", url: "https://en.wikipedia.org/wiki/Priority_dispatch" }
    ]
  },
  "Uncertainty quantification in ML": {
    label: "Uncertainty Quantification in ML",
    summary: "Methods and techniques for estimating and communicating the uncertainty in machine learning model predictions, including epistemic uncertainty (from limited data or model limitations) and aleatoric uncertainty (from inherent noise in the data). Reliable uncertainty quantification is critical for safe AI deployment because it enables systems to flag when they are operating outside their competence. Approaches include Bayesian neural networks, ensemble methods, conformal prediction, and calibration techniques.",
    example: "Cited in safetyist and cross-cutting nodes discussing technical requirements for trustworthy AI deployment.",
    frequency: "Primarily in safetyist and cross-cutting nodes on technical AI safety.",
    links: [
      { label: "Wikipedia: Uncertainty Quantification", url: "https://en.wikipedia.org/wiki/Uncertainty_quantification" },
      { label: "Gal: Uncertainty in Deep Learning (Thesis)", url: "https://mlg.eng.cam.ac.uk/yarin/thesis/thesis.pdf" }
    ]
  },
  "Universal Basic Income": {
    label: "Universal Basic Income",
    summary: "A social policy proposal in which every citizen receives a regular unconditional cash payment from the government, regardless of employment status or income. In AI policy, UBI is frequently proposed as a response to potential widespread technological unemployment caused by AI automation. Proponents argue it would provide a floor of economic security during the transition, while critics question its fiscal feasibility, potential effects on labor supply, and whether it addresses the deeper social value of meaningful work.",
    example: "Referenced in cross-cutting and accelerationist nodes discussing economic policy responses to AI-driven automation.",
    frequency: "Widely discussed across accelerationist, cross-cutting, and skeptic nodes.",
    links: [
      { label: "Wikipedia: Universal Basic Income", url: "https://en.wikipedia.org/wiki/Universal_basic_income" },
      { label: "Stanford Basic Income Lab", url: "https://basicincome.stanford.edu/" }
    ]
  },
  "Universal Basic Income (UBI) movement": {
    label: "Universal Basic Income (UBI) Movement",
    summary: "The growing political and social movement advocating for universal basic income as policy, which has gained momentum partly due to concerns about AI-driven automation. The movement includes pilot programs in Finland, Kenya, Stockton (California), and elsewhere, as well as advocacy by tech leaders like Sam Altman and Andrew Yang. In AI policy, the UBI movement represents a concrete policy proposal for addressing potential labor displacement and ensuring broad participation in AI-generated economic gains.",
    example: "Cited in cross-cutting and accelerationist nodes as a specific policy response to AI automation concerns.",
    frequency: "Cross-cutting; accelerationist and skeptic nodes engage with feasibility questions.",
    links: [
      { label: "Wikipedia: Universal Basic Income", url: "https://en.wikipedia.org/wiki/Universal_basic_income" },
      { label: "Basic Income Earth Network", url: "https://basicincome.org/" }
    ]
  },
  "Universal Basic Income/Services movements": {
    label: "Universal Basic Income/Services Movements",
    summary: "The broader movement encompassing both universal basic income (unconditional cash transfers) and universal basic services (publicly provided essential services like healthcare, education, housing, and transit). In AI policy, UBS proponents argue that public provision of services may be more effective than cash transfers in ensuring that AI-generated productivity gains improve quality of life. The combined UBI/UBS framework represents a comprehensive approach to social infrastructure for an AI-transformed economy.",
    example: "Appears in cross-cutting nodes discussing comprehensive policy frameworks for AI-era economic security.",
    frequency: "Primarily in cross-cutting nodes; some accelerationist and skeptic engagement.",
    links: [
      { label: "Wikipedia: Universal Basic Income", url: "https://en.wikipedia.org/wiki/Universal_basic_income" },
      { label: "Wikipedia: Universal Basic Services", url: "https://en.wikipedia.org/wiki/Universal_basic_services" },
      { label: "UCL Institute for Global Prosperity: UBS", url: "https://www.ucl.ac.uk/bartlett/igp/research-projects/universal-basic-services" }
    ]
  },
  "Value alignment problem": {
    label: "Value Alignment Problem",
    summary: "The challenge of ensuring that AI systems\' objectives and behaviors are aligned with human values and intentions, particularly as systems become more capable and autonomous. The problem has multiple dimensions: specifying human values precisely, translating them into formal objectives, ensuring the system actually pursues those objectives, and handling the diversity and evolution of human values. It is considered one of the central unsolved problems in AI safety, with implications ranging from near-term bias issues to long-term existential risk.",
    example: "Core concept in safetyist nodes; referenced across all POVs discussing AI safety challenges.",
    frequency: "Fundamental to safetyist nodes; cross-cutting discussions of AI safety; skeptics question framing.",
    links: [
      { label: "Wikipedia: AI Alignment", url: "https://en.wikipedia.org/wiki/AI_alignment" },
      { label: "Russell: Human Compatible", url: "https://www.penguinrandomhouse.com/books/566677/human-compatible-by-stuart-russell/" }
    ]
  },
  "Value alignment problem (current manifestations)": {
    label: "Value Alignment Problem (Current Manifestations)",
    summary: "The near-term, practical manifestations of the value alignment problem in currently deployed AI systems. These include biased outputs reflecting training data prejudices, reward hacking in reinforcement learning, sycophantic behavior in language models, and misalignment between optimization objectives and user intent. Unlike the abstract long-term alignment problem, these manifestations are observable and measurable today, providing both cautionary evidence and a testing ground for alignment techniques that may scale to more capable systems.",
    example: "Appears in safetyist and cross-cutting nodes discussing practical alignment failures in current AI systems.",
    frequency: "Common in safetyist and cross-cutting nodes; skeptics focus on these over speculative risks.",
    links: [
      { label: "Wikipedia: AI Alignment", url: "https://en.wikipedia.org/wiki/AI_alignment" },
      { label: "Amodei et al.: Concrete Problems in AI Safety", url: "https://arxiv.org/abs/1606.06565" }
    ]
  },
  "Value loading problem": {
    label: "Value Loading Problem",
    summary: "The specific challenge of how to instill or encode human values into an AI system so that it reliably acts in accordance with those values. This encompasses questions about which values to encode, how to represent them formally, how to handle value conflicts and uncertainty, and how to ensure values remain stable as the system learns and adapts. The value loading problem is closely related to but distinct from the broader alignment problem — it focuses specifically on the initial transfer of values from humans to machines.",
    example: "Referenced in safetyist nodes discussing technical approaches to building AI systems that respect human values.",
    frequency: "Primarily in safetyist nodes; some cross-cutting philosophical discussion.",
    links: [
      { label: "Wikipedia: AI Alignment", url: "https://en.wikipedia.org/wiki/AI_alignment" },
      { label: "MIRI: Value Loading Problem", url: "https://intelligence.org/files/ValueLearningProblem.pdf" }
    ]
  },
  "Worker co-operatives movement": {
    label: "Worker Co-operatives Movement",
    summary: "The movement advocating for worker-owned and democratically governed enterprises as an alternative to traditional corporate structures. In AI policy, the worker co-operatives model is proposed as a way to ensure that AI-augmented businesses share benefits with workers rather than concentrating gains among shareholders and executives. Platform cooperativism — applying co-operative principles to digital platforms — extends this concept to the AI economy, proposing that workers who generate data and operate AI tools should share in ownership.",
    example: "Cited in cross-cutting nodes discussing alternative economic structures for the AI economy.",
    frequency: "Occasionally in cross-cutting nodes discussing economic democracy and AI.",
    links: [
      { label: "Wikipedia: Worker Cooperative", url: "https://en.wikipedia.org/wiki/Worker_cooperative" },
      { label: "Wikipedia: Platform Cooperativism", url: "https://en.wikipedia.org/wiki/Platform_cooperativism" },
      { label: "International Co-operative Alliance", url: "https://www.ica.coop/" }
    ]
  },



};
