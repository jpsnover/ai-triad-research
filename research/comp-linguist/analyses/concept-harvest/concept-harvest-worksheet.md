# t/3234 concept-harvest — PI curation worksheet (PROPOSE ONLY, never auto-add)

Mined 1240 conflicts + 443 situations → 8280 raw → freq>=3 reuse-gate + drop-generic + embedding dedup → **166 candidate concepts** for curation.

Reuse gate: a concept must appear in >=3 source records (PI 'structured space, not infinite dictionary').
`NEAR-EXISTING` = MiniLM cosine >= 0.80 vs an existing dictionary concept (likely already covered — merge or reject).
Set VERDICT per row: `accept` (new) | `merge` (into nearest_existing) | `reject` (generic/dup/not-a-concept).

| # | candidate | freq | nearest existing (cosine) | suggested | merged variants | VERDICT |
|---|---|---|---|---|---|---|
| 1 | instrumental convergence | 25 | compliance performative (0.192) | NEW candidate |  | |
| 2 | situational awareness | 17 | safety existential (0.493) | NEW candidate |  | |
| 3 | formal verification | 14 | transparency verification (0.583) | NEW candidate |  | |
| 4 | regulatory frameworks | 14 | regulation precautionary (0.646) | NEW candidate |  | |
| 5 | regulatory friction | 11 | regulation precautionary (0.453) | NEW candidate |  | |
| 6 | legal personhood | 10 | autonomy individual (0.463) | NEW candidate |  | |
| 7 | regulatory fragmentation | 10 | risk systemic structural (0.424) | NEW candidate |  | |
| 8 | workforce automation | 10 | autonomy machine (0.469) | NEW candidate | workplace automation | |
| 9 | workforce displacement | 10 | displacement labor (0.814) | NEAR-EXISTING (merge?) |  | |
| 10 | failure modes | 9 | capabilities hazard (0.402) | NEW candidate |  | |
| 11 | labor market disruption | 9 | displacement labor (0.56) | NEW candidate |  | |
| 12 | power asymmetries | 9 | asymmetry power (0.847) | NEAR-EXISTING (merge?) |  | |
| 13 | prompt injection | 9 | autonomy machine (0.243) | NEW candidate |  | |
| 14 | labor market impact | 8 | displacement labor (0.51) | NEW candidate | labor market impacts | |
| 15 | cascading failures | 7 | risk systemic structural (0.334) | NEW candidate |  | |
| 16 | economic inequality | 7 | collective bargaining (0.324) | NEW candidate |  | |
| 17 | federal preemption | 7 | regulation precautionary (0.526) | NEW candidate |  | |
| 18 | recursive self-improvement | 7 | autonomy machine (0.386) | NEW candidate |  | |
| 19 | strategic deception | 7 | bias systemic (0.402) | NEW candidate |  | |
| 20 | training compute | 7 | model weights (0.4) | NEW candidate |  | |
| 21 | algorithmic efficiency | 6 | accountability algorithmic (0.484) | NEW candidate |  | |
| 22 | content moderation | 6 | compliance performative (0.338) | NEW candidate |  | |
| 23 | copyright infringement | 6 | industry lobbying (0.373) | NEW candidate |  | |
| 24 | dual-use technology | 6 | capability frontier (0.342) | NEW candidate |  | |
| 25 | human-AI collaboration | 6 | autonomy human (0.478) | NEW candidate |  | |
| 26 | job creation | 6 | displacement labor (0.437) | NEW candidate |  | |
| 27 | performance metrics | 6 | capabilities scaling (0.413) | NEW candidate |  | |
| 28 | regulatory lag | 6 | regulation adaptive (0.505) | NEW candidate |  | |
| 29 | security vulnerabilities | 6 | safety empirical (0.409) | NEW candidate |  | |
| 30 | task automation | 6 | autonomy machine (0.556) | NEW candidate |  | |
| 31 | adaptive capacity | 5 | regulation adaptive (0.608) | NEW candidate |  | |
| 32 | adversarial manipulation | 5 | adversarial robustness (0.721) | NEW candidate |  | |
| 33 | algorithmic opacity | 5 | transparency verification (0.478) | NEW candidate |  | |
| 34 | cognitive offloading | 5 | deployment competitive (0.291) | NEW candidate |  | |
| 35 | Constitutional AI | 5 | autonomy machine (0.48) | NEW candidate |  | |
| 36 | delusional spiraling | 5 | bias systemic (0.302) | NEW candidate |  | |
| 37 | economic impact | 5 | industry lobbying (0.364) | NEW candidate |  | |
| 38 | empirical evidence | 5 | safety empirical (0.48) | NEW candidate |  | |
| 39 | energy consumption | 5 | energy infrastructure (0.519) | NEW candidate | electricity consumption | |
| 40 | human-AI interaction | 5 | autonomy machine (0.536) | NEW candidate |  | |
| 41 | institutional capacity | 5 | capture institutional (0.757) | NEW candidate |  | |
| 42 | legislative lag | 5 | governance adaptive (0.297) | NEW candidate |  | |
| 43 | mechanistic interpretability | 5 | bias technical (0.347) | NEW candidate |  | |
| 44 | model finetuning | 5 | model weights (0.555) | NEW candidate |  | |
| 45 | model scaling | 5 | model weights (0.639) | NEW candidate |  | |
| 46 | moral agency | 5 | control human agency (0.685) | NEW candidate |  | |
| 47 | open-source development | 5 | risk innovation (0.296) | NEW candidate |  | |
| 48 | race to the bottom | 5 | fairness procedural (0.319) | NEW candidate |  | |
| 49 | red-teaming protocols | 5 | collective bargaining (0.347) | NEW candidate |  | |
| 50 | regulatory sandbox | 5 | safe harbor regulatory (0.534) | NEW candidate | regulatory sandboxes | |
| 51 | reinforcement learning | 5 | control optimization (0.534) | NEW candidate |  | |
| 52 | societal resilience | 5 | wellbeing mental health (0.408) | NEW candidate |  | |
| 53 | technological progress | 5 | capability frontier (0.418) | NEW candidate |  | |
| 54 | algorithmic management | 4 | accountability algorithmic (0.617) | NEW candidate |  | |
| 55 | automated employment decision tools | 4 | autonomy machine (0.292) | NEW candidate |  | |
| 56 | automation impact | 4 | autonomy machine (0.434) | NEW candidate |  | |
| 57 | concentration of power | 4 | asymmetry power (0.445) | NEW candidate |  | |
| 58 | consumer protection | 4 | regulation precautionary (0.519) | NEW candidate |  | |
| 59 | content filtering | 4 | ambient surveillance (0.238) | NEW candidate |  | |
| 60 | dissipative adaptation | 4 | regulation adaptive (0.466) | NEW candidate |  | |
| 61 | elite capture | 4 | capture institutional (0.317) | NEW candidate |  | |
| 62 | ethical guidelines | 4 | accountability algorithmic (0.392) | NEW candidate |  | |
| 63 | facial recognition | 4 | adversarial robustness (0.248) | NEW candidate |  | |
| 64 | gender disparity | 4 | fairness individual (0.407) | NEW candidate |  | |
| 65 | gender gap | 4 | fairness group (0.304) | NEW candidate |  | |
| 66 | labor market displacement | 4 | displacement labor (0.851) | NEAR-EXISTING (merge?) |  | |
| 67 | mandatory incident reporting | 4 | documented present harm (0.488) | NEW candidate |  | |
| 68 | model generalization | 4 | model weights (0.472) | NEW candidate |  | |
| 69 | occupational displacement | 4 | displacement labor (0.775) | NEW candidate |  | |
| 70 | occupational mix | 4 | collective bargaining (0.345) | NEW candidate |  | |
| 71 | performance degradation | 4 | capabilities scaling (0.349) | NEW candidate |  | |
| 72 | power-seeking behavior | 4 | asymmetry power (0.423) | NEW candidate |  | |
| 73 | productivity growth | 4 | capabilities scaling (0.357) | NEW candidate |  | |
| 74 | public opinion | 4 | bias systemic (0.371) | NEW candidate |  | |
| 75 | sentiment analysis | 4 | bias technical (0.328) | NEW candidate |  | |
| 76 | skill disruption | 4 | oversight human control (0.359) | NEW candidate |  | |
| 77 | synthetic data generation | 4 | data provenance (0.371) | NEW candidate | synthetic data | |
| 78 | Systemic Vulnerabilities | 4 | risk systemic structural (0.607) | NEW candidate |  | |
| 79 | verbatim recall | 4 | documented present harm (0.305) | NEW candidate |  | |
| 80 | adversarial red-teaming | 3 | adversarial robustness (0.62) | NEW candidate |  | |
| 81 | Adversarial Vulnerability | 3 | adversarial robustness (0.802) | NEAR-EXISTING (merge?) |  | |
| 82 | agentic systems | 3 | control human agency (0.435) | NEW candidate |  | |
| 83 | AI interpretability | 3 | accountability algorithmic (0.417) | NEW candidate |  | |
| 84 | AI-driven automation | 3 | autonomy machine (0.604) | NEW candidate |  | |
| 85 | algorithmic dependency | 3 | accountability algorithmic (0.528) | NEW candidate |  | |
| 86 | algorithmic hiring | 3 | accountability algorithmic (0.458) | NEW candidate |  | |
| 87 | antitrust enforcement | 3 | safe harbor regulatory (0.493) | NEW candidate |  | |
| 88 | attention economy | 3 | accountability market (0.416) | NEW candidate |  | |
| 89 | automated recruitment | 3 | deployment competitive (0.417) | NEW candidate |  | |
| 90 | benchmark performance | 3 | capabilities scaling (0.273) | NEW candidate |  | |
| 91 | benchmark saturation | 3 | adversarial robustness (0.294) | NEW candidate |  | |
| 92 | binding multilateral agreements | 3 | collective bargaining (0.431) | NEW candidate |  | |
| 93 | biological threats | 3 | regulation precautionary (0.388) | NEW candidate |  | |
| 94 | black box models | 3 | model weights (0.403) | NEW candidate |  | |
| 95 | bureaucratic overhead | 3 | oversight human control (0.531) | NEW candidate |  | |
| 96 | carbon emissions | 3 | energy infrastructure (0.377) | NEW candidate |  | |
| 97 | clinical decision support | 3 | compliance performative (0.291) | NEW candidate |  | |
| 98 | competitive dynamics | 3 | deployment competitive (0.533) | NEW candidate |  | |
| 99 | computer science education | 3 | bias technical (0.229) | NEW candidate |  | |
| 100 | continuous monitoring | 3 | ambient surveillance (0.475) | NEW candidate |  | |
| 101 | deceptive behavior | 3 | fairness procedural (0.355) | NEW candidate |  | |
| 102 | development velocity | 3 | capabilities hazard (0.295) | NEW candidate |  | |
| 103 | differential fitness | 3 | regulation adaptive (0.457) | NEW candidate |  | |
| 104 | differential privacy | 3 | ambient surveillance (0.361) | NEW candidate |  | |
| 105 | economic concentration | 3 | industry lobbying (0.353) | NEW candidate |  | |
| 106 | effective accelerationism | 3 | compliance performative (0.362) | NEW candidate |  | |
| 107 | emergent property | 3 | risk existential (0.343) | NEW candidate |  | |
| 108 | employment trends | 3 | displacement labor (0.464) | NEW candidate |  | |
| 109 | evaluation awareness | 3 | accountability algorithmic (0.393) | NEW candidate |  | |
| 110 | facial reconstruction | 3 | displacement labor (0.23) | NEW candidate |  | |
| 111 | false sense of security | 3 | safety existential (0.464) | NEW candidate |  | |
| 112 | full automation | 3 | autonomy machine (0.597) | NEW candidate |  | |
| 113 | gender representation | 3 | fairness group (0.35) | NEW candidate |  | |
| 114 | general-purpose AI | 3 | autonomy machine (0.553) | NEW candidate |  | |
| 115 | generative AI assistance | 3 | autonomy machine (0.446) | NEW candidate |  | |
| 116 | human intelligence | 3 | autonomy human (0.568) | NEW candidate |  | |
| 117 | incident reporting | 3 | documented present harm (0.534) | NEW candidate |  | |
| 118 | independent verification | 3 | transparency verification (0.591) | NEW candidate |  | |
| 119 | industry capture | 3 | industry lobbying (0.468) | NEW candidate |  | |
| 120 | innovation velocity | 3 | risk innovation (0.556) | NEW candidate |  | |
| 121 | intellectual property | 3 | risk innovation (0.447) | NEW candidate | intellectual property protection | |
| 122 | International Humanitarian Law | 3 | autonomy human (0.367) | NEW candidate |  | |
| 123 | jurisdictional fragmentation | 3 | governance oversight (0.344) | NEW candidate |  | |
| 124 | labor automation | 3 | displacement labor (0.55) | NEW candidate |  | |
| 125 | labor market shifts | 3 | displacement labor (0.627) | NEW candidate |  | |
| 126 | labor protections | 3 | collective bargaining (0.535) | NEW candidate |  | |
| 127 | legal uncertainty | 3 | liability strict (0.487) | NEW candidate |  | |
| 128 | machine learning models | 3 | model weights (0.443) | NEW candidate |  | |
| 129 | malicious use | 3 | documented present harm (0.373) | NEW candidate |  | |
| 130 | mandatory reporting | 3 | documented present harm (0.443) | NEW candidate |  | |
| 131 | market competition | 3 | industry lobbying (0.528) | NEW candidate |  | |
| 132 | market incentives | 3 | industry lobbying (0.538) | NEW candidate |  | |
| 133 | model behavior | 3 | model weights (0.49) | NEW candidate |  | |
| 134 | model training | 3 | model weights (0.591) | NEW candidate |  | |
| 135 | model vulnerability | 3 | adversarial robustness (0.411) | NEW candidate |  | |
| 136 | moral reasoning | 3 | fairness procedural (0.386) | NEW candidate |  | |
| 137 | political polarization | 3 | bias systemic (0.391) | NEW candidate |  | |
| 138 | power dynamics | 3 | asymmetry power (0.581) | NEW candidate |  | |
| 139 | power structures | 3 | energy infrastructure (0.549) | NEW candidate |  | |
| 140 | predictive policing | 3 | accountability algorithmic (0.376) | NEW candidate |  | |
| 141 | red-teaming requirements | 3 | deployment competitive (0.327) | NEW candidate |  | |
| 142 | regulatory enforcement | 3 | regulation precautionary (0.663) | NEW candidate |  | |
| 143 | regulatory intervention | 3 | regulation precautionary (0.649) | NEW candidate |  | |
| 144 | resource consumption | 3 | capabilities scaling (0.391) | NEW candidate |  | |
| 145 | safe-harbor provisions | 3 | safe harbor regulatory (0.84) | NEAR-EXISTING (merge?) |  | |
| 146 | science communication | 3 | bias technical (0.28) | NEW candidate |  | |
| 147 | skill atrophy | 3 | oversight human control (0.273) | NEW candidate |  | |
| 148 | social isolation | 3 | control human agency (0.33) | NEW candidate |  | |
| 149 | social trust | 3 | accountability market (0.408) | NEW candidate |  | |
| 150 | specification gaming | 3 | fairness procedural (0.374) | NEW candidate |  | |
| 151 | sunset clauses | 3 | fairness procedural (0.22) | NEW candidate |  | |
| 152 | system robustness | 3 | adversarial robustness (0.6) | NEW candidate |  | |
| 153 | systemic failures | 3 | risk systemic structural (0.592) | NEW candidate |  | |
| 154 | systemic fragility | 3 | risk systemic structural (0.559) | NEW candidate |  | |
| 155 | task performance | 3 | capability frontier (0.322) | NEW candidate |  | |
| 156 | technical debt | 3 | risk systemic structural (0.35) | NEW candidate |  | |
| 157 | technological salvation | 3 | capability frontier (0.377) | NEW candidate |  | |
| 158 | technological unemployment | 3 | displacement labor (0.456) | NEW candidate |  | |
| 159 | technology diffusion | 3 | deployment competitive (0.403) | NEW candidate |  | |
| 160 | toxicity detection | 3 | safety empirical (0.399) | NEW candidate |  | |
| 161 | training data diversity | 3 | adversarial robustness (0.345) | NEW candidate |  | |
| 162 | unintended consequences | 3 | documented present harm (0.517) | NEW candidate |  | |
| 163 | White-Collar Displacement | 3 | displacement labor (0.56) | NEW candidate |  | |
| 164 | worker productivity | 3 | displacement labor (0.458) | NEW candidate |  | |
| 165 | workforce reduction | 3 | displacement labor (0.496) | NEW candidate |  | |
| 166 | workforce reskilling | 3 | displacement labor (0.44) | NEW candidate |  | |