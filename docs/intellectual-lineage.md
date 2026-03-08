# Intellectual Lineage

The `intellectual_lineage` field in a taxonomy node's `GraphAttributes` identifies
the intellectual traditions, schools of thought, or research programs that inform
the position. Each node may reference multiple lineages, assigned by an LLM during
attribute extraction (`Invoke-AttributeExtraction`).

```powershell
(Get-Tax -Id 'acc-goals-001').GraphAttributes.intellectual_lineage
```

Unlike controlled-vocabulary fields (epistemic type, emotional register), intellectual
lineage uses free-form strings that reference specific thinkers, movements, and
research traditions. The 51 distinct values cluster into several thematic families.

---

## Existential Risk & Longtermism

Traditions focused on humanity's long-term trajectory, catastrophic risks, and the
moral weight of future generations.

| Lineage | Description |
|---------|-------------|
| Bostrom existential risk framework | Nick Bostrom's work on existential threats, especially *Superintelligence* (2014) |
| Existential risk studies | The broader academic field studying civilization-ending risks |
| Longtermism | The moral view that positively influencing the long-term future is a key priority |
| Effective Altruism (long-termism) | The EA community's long-termist wing, focused on x-risk reduction |
| Effective Altruism (AI Safety branch) | EA-funded AI safety research (MIRI, Redwood, ARC) |
| Open Philanthropy (some interpretations of AI safety as a race) | Dustin Moskovitz/Cari Tuna's foundation and its AI safety grantmaking |

**Frequency:** Appears primarily in safetyist and cross-cutting nodes. These lineages
form the intellectual backbone of the AI safety movement.

---

## Accelerationism & Techno-Utopianism

Traditions that celebrate technological progress as inherently beneficial or
historically inevitable.

| Lineage | Description |
|---------|-------------|
| Singularitarianism | The belief that artificial superintelligence will trigger a technological singularity |
| Transhumanism | The movement to enhance human capabilities through technology |
| Effective Accelerationism | The e/acc movement advocating maximal technological acceleration |
| Ray Kurzweil's Law of Accelerating Returns | Kurzweil's thesis that the rate of technological change itself accelerates |
| Techno-optimism | Broad confidence that technology reliably improves human welfare |

**Frequency:** Concentrated in accelerationist nodes. These lineages provide the
philosophical foundations for "build faster" positions.

---

## AI Technical Research

Traditions rooted in specific technical research programs and empirical findings
about AI capabilities.

| Lineage | Description |
|---------|-------------|
| Scaling Hypothesis | The thesis that increasing model size/compute yields emergent capabilities |
| Scaling Hypothesis (Deep Learning) | Specific application of scaling laws to deep neural networks |
| Moore's Law (analogous) | Drawing parallels between semiconductor scaling and AI capability growth |
| OpenAI's compute-centric research agenda | OpenAI's bet that scale is the primary driver of AI progress |
| AI forecasting literature (e.g., from MIRI, FHI, some OpenAI perspectives) | Research on predicting AI capability timelines |
| Forecasting science | The broader discipline of structured prediction and calibration |
| AI alignment research | Technical research on ensuring AI systems pursue intended goals |
| Value alignment problem | The specific challenge of encoding human values into AI systems |
| Specification gaming literature | Research on AI systems exploiting reward function loopholes |

**Frequency:** Distributed across all POVs. Both accelerationists and safetyists
cite technical research, though they draw opposite conclusions.

---

## Control Theory & Safety Engineering

Traditions focused on maintaining human control over complex systems and preventing
catastrophic failures.

| Lineage | Description |
|---------|-------------|
| Cybernetics (control theory) | Norbert Wiener's science of communication and control in systems |
| Control problem in cybernetics | The specific challenge of maintaining control over autonomous agents |
| Human-in-the-loop principles | Design philosophy requiring human oversight of automated decisions |
| Formal verification methods | Mathematical proof techniques for system correctness |
| Software engineering safety standards (e.g., aerospace) | DO-178C and similar standards for safety-critical software |
| Risk assessment methodologies (e.g., nuclear safety) | PRA and other systematic risk quantification methods |
| Risk assessment frameworks | General frameworks for identifying and evaluating risks |
| Risk management theory | Academic discipline of systematic risk identification and mitigation |
| Precautionary Principle | The principle that uncertainty about harm justifies preventive action |
| Asimov's Laws of Robotics (control aspect) | The literary framework for constraining autonomous agent behavior |

**Frequency:** Heavily safetyist. These lineages provide the engineering and
philosophical tools for the "proceed with caution" stance.

---

## Political Philosophy & Governance

Traditions from political science, international relations, and governance theory
applied to AI policy.

| Lineage | Description |
|---------|-------------|
| International relations theory | Frameworks for understanding state competition and cooperation |
| Technology governance frameworks | Regulatory and institutional approaches to managing technology |
| Multi-stakeholder governance models | Governance involving government, industry, civil society, and academia |
| liberal political philosophy (individual rights) | Rights-based frameworks applied to AI's impact on autonomy and privacy |
| GDPR principles | The EU's data protection framework as a model for AI regulation |
| consumer protection law | Legal traditions protecting individuals from corporate harm |

**Frequency:** Concentrated in cross-cutting and skeptic nodes, where governance
and institutional design are central concerns.

---

## Critical Theory & Social Analysis

Traditions that critique power structures, inequality, and the social impacts
of technology.

| Lineage | Description |
|---------|-------------|
| Critical Race Theory (applied to tech) | Analysis of how AI systems can perpetuate racial bias and inequality |
| Critical race theory in tech | Variant label for the same tradition |
| Foucault (surveillance) | Michel Foucault's analysis of surveillance, power, and discipline |
| sociology of technology | The academic study of technology's relationship to social structures |
| structural critique | Analytical approaches that examine systemic rather than individual causes |
| algorithmic fairness research | Technical and social research on bias in algorithmic decision-making |
| data ethics research | The emerging field studying ethical issues in data collection and use |
| Ethics of technology | Broad philosophical inquiry into technology's moral implications |

**Frequency:** Concentrated in skeptic nodes, where questioning power structures
and social impacts is the primary analytical mode.

---

## Economics & Labor

Traditions analyzing AI's economic impacts, particularly on employment and
market structures.

| Lineage | Description |
|---------|-------------|
| Labor economics | The study of labor markets, wages, and employment dynamics |
| automation studies | Research on the history and impact of automation on work |
| economic forecasting | Methods for predicting economic impacts of technological change |
| Keynesian economics (full employment goal) | Economic frameworks prioritizing full employment as a policy goal |
| social safety net principles | Traditions supporting government programs that protect against economic disruption |
| Luddism (modern interpretation) | Contemporary analysis of worker resistance to automation, beyond the caricature |

**Frequency:** Primarily skeptic nodes, reflecting concern about AI's distributional
effects on workers and economic inequality.

---

## Open Technology & Decentralization

Traditions advocating for distributed, accessible, and community-controlled
technology development.

| Lineage | Description |
|---------|-------------|
| Open Source Movement | The philosophy and practice of publicly accessible source code |
| Digital Commons | The concept of shared digital resources managed as a commons |
| Decentralization philosophies | Intellectual traditions opposing concentration of technological power |

**Frequency:** Primarily accelerationist nodes, where open access to AI is seen
as both a moral imperative and a competitive strategy.

---

## Distribution Summary

| Thematic Family | Count | Primary POV(s) |
|----------------|------:|----------------|
| Existential Risk & Longtermism | 6 | Safetyist, Cross-cutting |
| Accelerationism & Techno-Utopianism | 5 | Accelerationist |
| AI Technical Research | 9 | All POVs |
| Control Theory & Safety Engineering | 10 | Safetyist |
| Political Philosophy & Governance | 6 | Cross-cutting, Skeptic |
| Critical Theory & Social Analysis | 8 | Skeptic |
| Economics & Labor | 6 | Skeptic |
| Open Technology & Decentralization | 3 | Accelerationist |
| **Total distinct values** | **51** | |
