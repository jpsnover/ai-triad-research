#!/usr/bin/env python3
"""Inject CL blind labels into the cross-conflict golden worksheet → labeled copy for build_golden_xc.py --score.
Standard: contradict = opposing positions on the SAME proposition (accepting one weakens the other — QBAF attack
semantics); entail = same-direction restatement/implication/near-dup; neutral = different aspects, both can hold.
Provenance: CL single-annotator, judge-independent."""
import re, os, sys
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, "xconflict-golden-worksheet.md")
OUT = os.path.join(HERE, "xconflict-golden-worksheet-labeled.md")
L = {
 "xc-0000-0": "neutral",   # 93% male-professions vs 61% neutral-prompts: different measures, same bias direction
 "xc-0271-2": "neutral",   # interpretability CAN map vs reasoning opaque: A is remedy to B, not denial
 "xc-0083-0": "contradict",# simple decision boundaries vs complex/inscrutable
 "xc-0397-0": "contradict",# new strict-liability act vs adapt-existing-no-reform
 "xc-0179-0": "entail",    # Hegseth broke contract == DoD broke contract (same event)
 "xc-0006-2": "neutral",   # report found deception evidence vs research lacks labeled examples: different aspects
 "xc-0317-1": "contradict",# hyperbolic growth vs no discontinuous jumps
 "xc-0094-2": "neutral",   # poor at common-sense vs exceeds at scientific reasoning: different domains
 "xc-0398-2": "neutral",   # simple build-formula vs complex artifact: different predicates
 "xc-0230-2": "neutral",   # scale improves situational-inference vs struggle physical situational-awareness
 "xc-0053-1": "contradict",# TFP 0.66% vs <0.53%: numeric conflict, same quantity
 "xc-0354-1": "neutral",   # wages up vs recruits down 25%: different metrics
 "xc-0100-2": "neutral",   # cannot do logical/arithmetic vs exceeds scientific reasoning: different domains
 "xc-0403-1": "neutral",   # homogenization persists vs creative-boost reverts: different measured effects
 "xc-0259-2": "neutral",   # lack physical situational-awareness vs demonstrate self-identity awareness: diff senses
 "xc-0060-0": "contradict",# AI abundance/solves existential vs AI catastrophic/existential risk
 "xc-0356-0": "contradict",# automation no net job loss vs postings -17%/qtr after genAI
 "xc-0164-1": "contradict",# AI lacks memory/planning vs AI became autonomous agents w/ planning/memory
 "xc-0415-1": "contradict",# inequality NOT from AI vs AI causing structural labor-share decline
 "xc-0262-0": "entail",    # temp-lower only 15-20% vs temp-lower ineffective: same-direction skepticism
 "xc-0064-0": "contradict",# AI promise to reduce burden vs promise NOT realized
 "xc-0356-1": "contradict",# automation no net job loss vs AI causing structural labor-share decline
 "xc-0169-0": "contradict",# frontier AI no severe-harm-via-misuse vs frontier AI CAN introduce severe-harm risk
 "xc-0415-2": "contradict",# inequality NOT from AI vs AI widens capital-labor gap
 "xc-0266-0": "contradict",# emergent abilities are measurement artifacts vs capabilities emerge unexpectedly
 "xc-0081-2": "contradict",# no discontinuous jumps vs R&D returns support hyperbolic growth
 "xc-0356-2": "contradict",# automation no net job loss vs displace half entry-level jobs in 1-5 yrs
 "xc-0169-1": "contradict",# frontier AI no severe-harm-via-misuse vs frontier AI CAN introduce severe-harm risk
 "xc-0000-1": "entail",    # image-gen 93% stereotype is an INSTANCE of "AI causing bias harm"
 "xc-0036-2": "neutral",   # agents need identity disclosure vs agents vulnerable to spoofing: different aspects
 "xc-0066-2": "neutral",   # approaching self-building vs exhibit emergent capabilities: different claims
 "xc-0101-1": "entail",    # deception→competitive advantage vs competition incentivizes deception: same mechanism
 "xc-0128-1": "neutral",   # reward-hack generalizes (finding) vs reward-hacking definition: diff aspects
 "xc-0167-1": "neutral",   # benchmarks fail to disambiguate vs models can perform deception: different aspects
 "xc-0214-0": "neutral",   # GPT-4 science-gender bias vs GPT capability jump: unrelated topics
 "xc-0256-2": "neutral",   # LLMs id-as-LM but unclear understanding vs trained on everyday-task text: diff aspects
 "xc-0298-2": "entail",    # practical roadblocks vs rhetoric-vs-implementation gap wide: same direction
 "xc-0335-2": "neutral",   # some AI refuse defamatory prompts vs AI gamed by low-risk-task selection: diff aspects
 "xc-0389-0": "neutral",   # frameworks limited by no standardization vs 12 cos published frameworks: exist vs effective
 "xc-0433-0": "neutral",   # universe favors free-energy/entropy vs favors replication: different favored outcomes
 "xc-0020-0": "entail",    # planning WILL emerge vs agents ARE capable of planning: stronger same-direction
 "xc-0048-2": "neutral",   # AI→insecure code vs AI→20-30% faster: different metrics
 "xc-0079-2": "neutral",   # existential risk/alignment vs infra security-preparedness gap: different risk types
 "xc-0112-2": "neutral",   # AI→homogenized content vs AI can do news/Go/code: different topics
 "xc-0144-0": "neutral",   # capitalism-as-intelligence vs capitalism-crisis-from-neoliberalism: different claims
 "xc-0190-2": "neutral",   # existing frameworks adaptable vs negligence requires proof: B is detail supporting A
 "xc-0236-2": "entail",    # England dissipative-adaptation vs e/acc USES England's theory: same direction
 "xc-0278-0": "entail",    # >1/3 fear AI ends life == YouGov 2025 >1/3 fear AI ends life (same fact)
}
lines = open(SRC, encoding="utf-8").read().split("\n")
cur = None
out = []
hdr = re.compile(r"^##\s+(\S+)")
for ln in lines:
    m = hdr.match(ln)
    if m:
        cur = m.group(1)
    if ln.startswith("**VERDICT:**") and cur in L:
        out.append(f"**VERDICT:** {L[cur]}")
        cur = None
        continue
    out.append(ln)
open(OUT, "w", encoding="utf-8").write("\n".join(out))
from collections import Counter
print("CL labels:", dict(Counter(L.values())), "| total", len(L))
print("wrote", OUT)
