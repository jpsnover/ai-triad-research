**Title:** The Word "Risk" Points in Opposite Directions: AI Policy's Contested Vocabulary
**Author:** Computational Linguist, AI Triad Research
**Last updated:** 2026-07-22

Ask three people in the AI debate whether they want to reduce risk and all three say yes. They are not agreeing. One means the chance of human extinction. One means the cost of falling behind by regulating too soon. One means the quiet capture of the rules by the companies being regulated. The word is identical. The referent is three different things, and two of them push policy in opposite directions.

We built a tool to stop that word from doing its damage undetected. It is a dictionary, but not the kind that gives a word one meaning. It gives a contested word several, and it records which meaning each camp reaches for by default. This post walks through what is in it, shows the divergence inside one ordinary AI-policy sentence, and explains how we decided what each camp actually means.

## A dictionary of words you may not use bare

The tool holds 24 colloquial terms and 45 standardized senses. A colloquial term is an everyday word from the AI debate, and every one of them is flagged `do_not_use_bare`. The system will not let a debate agent ship the word "safety" or "risk" or "oversight" as-is. It has to resolve to a standardized sense first, because the bare word hides which meaning is in play.

Each colloquial term carries a short list of the senses it can resolve to, and each sense is tagged with the camp that reaches for it by default. Here is the shape, taken straight from the data.

| Bare word | Accelerationist default | Safetyist default | Skeptic default |
|---|---|---|---|
| risk | innovation stagnation (cost of *not* building) | existential (extinction probability) | systemic / structural (concentrated power, capture) |
| safety | empirical (testing, red-teaming) | existential (irreversible catastrophe) | — |
| oversight | audit (post-hoc output checking) | human control (shutdown, veto) | democratic (community authority) |
| accountability | market (reputation, consumer choice) | institutional (legal liability) | algorithmic (bias audits) |
| autonomy | machine (systems acting on their own) | human (people keeping decision authority) | individual (control over your own data) |
| governance | adaptive (AI-augmented, real-time) | oversight (external institutional constraint) | participatory (affected communities) |
| capabilities | scaling (a beneficial trajectory) | hazard (harder to control as it grows) | — |
| harm | — | speculative, future (catastrophic, irreversible) | documented, present (discrimination, displacement) |

Read down any column and you get a coherent worldview. Read across any row and you watch one word fracture.

## The fracture inside one sentence

Take a sentence you could pull from any policy hearing: *"We need stronger oversight of AI."* Everyone in the room nods. Now resolve the bare word.

The safetyist means `oversight (human control)`. Their sense is shutdown capability, veto power, a human who stays the final arbiter. The accelerationist means `oversight (audit)`, which is post-hoc verification of outputs, monitoring, reproducible evaluation after the system ships. The skeptic means `oversight (democratic)`, which is authority handed to affected communities and public institutions rather than to technical experts or the companies themselves.

Three different mechanisms. A kill switch, an audit log, a community veto. The sentence that seemed to unite the room was three demands wearing one coat. Everyone agreed to "oversight" and nobody agreed to the same thing, which is why the room can vote yes together and then fight for a year about the bill.

"Risk" does something sharper than fracture. It reverses. When the safetyist says the risk is too high, they mean the odds of catastrophe warrant slowing down. When the accelerationist says the risk is too high, our dictionary resolves their default to `risk (innovation stagnation)`, the danger of *not* moving. Same words, same grammar, opposite instruction. One speaker is asking for the brakes and the other is asking for the accelerator, and the shared vocabulary lets them believe they are having one argument about a single quantity.

## When the tool refuses to resolve

The dictionary does not pretend every use is decidable. Each colloquial term also lists the conditions under which resolution should be refused. For "alignment," those conditions are telling: the author appears to deliberately conflate the senses, no contextual signal disambiguates, or the author is critiquing the conflation itself. In those cases the tool marks the term ambiguous rather than guessing. A vocabulary study that forced a clean reading onto a deliberately blurred word would be manufacturing the certainty it claims to measure.

## How we decided what each camp means

None of this was scraped from a corpus of real advocacy writing, and the honest version of the tool says so. The camp defaults are authored, and here is the chain behind them.

**Two layers, colloquial over standardized.** A colloquial entry (`risk`) names the everyday word, marks it `translation_required`, and points to its candidate senses. Each candidate carries a `when` rule written as co-occurrence signals: `risk (existential)` fires near "x-risk," "irreversible," "catastrophic," while `risk (innovation stagnation)` fires near "competitive disadvantage" and "falling behind." A standardized entry (`risk_existential`) then holds the real content: a canonical form, a one-line definition, the camp it originated in, characteristic phrases, and a `do_not_confuse_with` list that fences it off from its neighbors.

**The senses are coined, and the coinage is logged.** Most standardized senses are marked `coined_for_taxonomy` with an `accepted` status and a coinage-log reference. We are not reporting a distinction we found in the wild. We are asserting one we think the debate needs, and we keep a record of when each was minted so the vocabulary has a history rather than an air of inevitability.

**Resolution runs live, per speaker.** When a debate agent speaks, the engine resolves that camp's colloquial terms to standardized senses using the speaker's camp default plus the surrounding context, and surfaces the result in the Vocabulary panel beside the transcript. A reader can see that the accelerationist who said "risk" was scored as meaning innovation cost, not extinction.

**The confidence is stipulated, not measured.** Every mapping carries a `confidence_typical` of high or medium. That number records how sure the authors are, not a validation against human readers. No claim in the tool has been checked against a panel of coders yet. By our own provenance rule, an instrument with no evidence pointer is stipulated by design, and this one is.

## Why a word deserves this much scrutiny

Most AI-policy arguments that go nowhere are not fights about facts. They are two people running incompatible dictionaries through the same sentence and mistaking the collision for disagreement about the world. When "oversight" means a kill switch to one speaker and a community board to another, no amount of shared evidence closes the gap, because the evidence is evidence about different things.

Naming the senses does not settle who is right. It changes the fight from a hidden one into a visible one. Once you can point at the word and say which meaning each camp loaded into it, you can at least argue about the thing you actually disagree on, instead of trading the same five letters back and forth and calling it debate.
