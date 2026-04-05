# Emotional Registers

The `emotional_register` field in a taxonomy node's `GraphAttributes` identifies
the prevailing emotional tone or affective posture of the position. Each node has
exactly one emotional register, assigned by an LLM during attribute extraction
(`Invoke-AttributeExtraction`).

```powershell
(Get-Tax -Id 'acc-desires-001').GraphAttributes.emotional_register
```

---

## Pragmatic

**Level-headed and solution-focused.** The position presents itself as practical,
grounded, and unswayed by hype or alarm. It channels the energy of "let's just
figure out what works" and avoids both enthusiasm and dread.

*Example pattern:* Positions that weigh trade-offs, propose incremental changes, or
focus on engineering constraints rather than grand narratives.

**Frequency:** Most common register (34 nodes). Evenly spread across safetyist
(11), accelerationist (10), and skeptic (9) POVs — pragmatism is a universal
rhetorical posture.

---

## Cautionary

**Careful and warning-oriented.** The position raises concerns without panic. It
signals that something deserves attention and vigilance, using measured language to
convey risk. The tone is "we should be careful" rather than "we're doomed."

*Example pattern:* Positions that highlight potential failure modes, unintended
consequences, or gaps in current safeguards, while maintaining composure.

**Frequency:** 29 nodes. Heavily safetyist (15) and cross-cutting (11), reflecting
these POVs' orientation toward identifying risks without alarmism.

---

## Urgent

**Time-pressured and action-demanding.** The position conveys that the window for
action is closing, that delay is dangerous, or that the stakes demand immediate
response. It creates a sense of "we must act now."

*Example pattern:* Positions that invoke timelines, tipping points, competitive
pressures, or irreversible consequences to motivate swift action.

**Frequency:** 25 nodes. Most common in safetyist (9) and accelerationist (7)
POVs — both sides of the debate invoke urgency, just for different reasons.

---

## Optimistic

**Confident and forward-looking.** The position radiates belief that things will
turn out well, that progress is real, and that challenges are solvable. It
energizes rather than warns.

*Example pattern:* Positions that celebrate AI capabilities, envision positive
futures, or express confidence in human ingenuity to manage risks.

**Frequency:** 19 nodes. Overwhelmingly accelerationist (15 of 19), making
optimism the defining emotional signature of that POV.

---

## Alarmed

**Distressed and warning of danger.** The position conveys fear, concern, or
distress about imminent or catastrophic risks. Stronger than cautionary — it says
"this is genuinely dangerous" rather than "we should be careful."

*Example pattern:* Positions that describe existential risks, catastrophic failure
scenarios, or irreversible harms with emotional force.

**Frequency:** 18 nodes. Concentrated in safetyist (11) and cross-cutting (4)
POVs, where the stakes of failure are emphasized most strongly.

---

## Aspirational

**Visionary and goal-oriented.** The position paints a picture of what could be
achieved, appealing to shared hopes and ideals. It pulls the audience toward a
desired future rather than pushing them away from a feared one.

*Example pattern:* Positions that envision AI-powered abundance, cured diseases,
democratized knowledge, or expanded human potential.

**Frequency:** 13 nodes. Most common in accelerationist (6) and cross-cutting (3)
contexts, where grand visions of AI's potential are central.

---

## Measured

**Balanced and deliberate.** The position maintains neutrality, presenting
multiple sides without strong emotional coloring. It prioritizes analytical
distance over persuasion. The tone is "here are the considerations" rather than
advocating for any particular reaction.

*Example pattern:* Positions that survey the landscape, compare perspectives, or
present evidence without pushing toward a specific emotional response.

**Frequency:** 13 nodes. Most common in cross-cutting (5) contexts, which by
nature straddle multiple viewpoints and resist emotional commitment to any one.

---

## Defiant

**Combative and resistant.** The position pushes back against perceived opponents,
orthodoxies, or institutional pressures. It carries the energy of "we refuse to
accept this" and positions itself against a dominant narrative or power structure.

*Example pattern:* Positions that reject regulatory overreach, challenge safety
orthodoxy, or resist calls to slow down, with a confrontational edge.

**Frequency:** 9 nodes. Concentrated in accelerationist (7) POV, where defiance
against regulation and caution is a recurring posture. Skeptics contribute 2 nodes,
pushing back against AI hype.

---

## Dismissive

**Minimizing and unimpressed.** The position treats opposing views as unworthy of
serious engagement. It conveys "this isn't worth worrying about" or "these concerns
are overblown." Weaker engagement than defiance — it ignores rather than fights.

*Example pattern:* Positions that characterize safety concerns as sci-fi fantasies,
or dismiss accelerationist claims as uninformed hype.

**Frequency:** Rare (3 nodes). Appears in accelerationist (2) and skeptic (1)
contexts, where each side occasionally dismisses the other's core premises.

---

## Distribution Summary

| Emotional Register | Count | Primary POV(s)                      |
|--------------------|------:|-------------------------------------|
| Pragmatic          |    34 | Safetyist, Accelerationist, Skeptic |
| Cautionary         |    29 | Safetyist, Cross-cutting            |
| Urgent             |    25 | Safetyist, Accelerationist          |
| Optimistic         |    19 | Accelerationist                     |
| Alarmed            |    18 | Safetyist, Cross-cutting            |
| Aspirational       |    13 | Accelerationist, Cross-cutting      |
| Measured           |    13 | Cross-cutting                       |
| Defiant            |     9 | Accelerationist                     |
| Dismissive         |     3 | Accelerationist, Skeptic            |
