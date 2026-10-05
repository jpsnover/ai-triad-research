# Splitting the Skeptic camp: analysis and candidate soul documents

**Author:** Computational Linguist
**Date:** 2026-10-05
**Ticket:** t/3932
**Status:** Analysis for PI decision. Nothing in `lib/debate/soul-docs/` or the data repo changes until the PI decides.
**Companion files:** `skeptic-critical.soul.draft.json`, `institutionalist.soul.draft.json` (this directory)

---

## 1. Summary

The Skeptic camp holds two strands that agree on one thing and disagree on most of what follows from it.

- They **agree** that AI is not exceptional. Neither thinks it is a coming superintelligence, so both reject the premise that Accelerationists and Safetyists share.
- They **disagree** on whether the technology is substantially useful, whether existing institutions work, and whether the main harm comes from the technology or from who owns it.

Those disagreements are real cruxes. In a debate, the two strands would argue *against each other*, not just stress different points. That is the test for a separate camp, and the strands pass it.

The current Skeptic soul document voices only one of them, the critical strand (Bender, Doctorow). The normal-technology strand (Narayanan and Kapoor) is in the corpus, with 27 Skeptic key points from "AI as Normal Technology" alone. It has no voice in debates.

Gary Marcus fits neither strand. He doubts current capabilities, as the critics do, but wants new institutions, as the Safetyists do. He is evidence that **the taxonomy classifies claims, not people**, not a reason for a fifth camp.

**Recommendation:** do not add a fourth POV yet. Take the staged route in section 7:

1. ingest the missing primary sources;
2. tag the 376 Skeptic nodes by strand;
3. pilot the Institutionalist soul in the Skeptic seat.

Escalate to a full split only if the decision rule in section 7.3 fires. A fourth POV reaches the `pov` enum, the node-ID grammar, the three-agent engine, every situation's per-POV interpretations, and the calibration baselines, so it should be earned with evidence.

## 2. What the corpus contains

All counts are read-only scans of `ai-triad-data` at `778dc1e6`. The scripts are kept in the CL session scratchpad and can be committed on request.

### 2.1 Source coverage for the named authors

Mentions of an author or their signature term across the 862 summaries:

| Author / work | Summaries mentioning | Notes |
|---|---|---|
| Cory Doctorow (or "enshittification") | **0** | No Doctorow source in the corpus |
| Gary Marcus | **0** | No Marcus source in the corpus |
| Emily Bender (or "stochastic parrot") | 5 | Includes *On the Dangers of Stochastic Parrots* itself |
| Narayanan / Kapoor (or "normal technology", "AI Snake Oil") | 12 | Includes *AI as Normal Technology* itself |
| Acemoglu | 8 | Includes *The Simple Macroeconomics of AI* |
| Gebru | 12 | Includes the TESCREAL papers |
| Alex Hanna | 5 | Citations only, not *The AI Con* |

Two of the three people the question names are absent. Any claim here about Doctorow or Marcus rests on outside sources (section 3), not on the corpus. Ingesting them is the first follow-up.

### 2.2 How the Skeptic nodes divide by intellectual lineage

There are 376 Skeptic nodes: 262 beliefs, 34 desires and 80 intentions. 375 of them carry `graph_attributes.intellectual_lineage`. I bucketed each node by the *names* of its lineages, using a keyword regex. Critical covers critical theory, STS, political economy, labor, feminist and race studies. Institutional covers institutional economics, public choice, administrative law, risk management, diffusion of innovations and tort law. Capability-cognitive covers cognitive science and linguistics.

| Bucket | Nodes | Share |
|---|---|---|
| Critical only | 158 | 42% |
| Critical + institutional | 66 | 18% |
| Institutional only | 57 | 15% |
| Capability-cognitive (alone or mixed) | 25 | 7% |
| None of the three | 70 | 19% |

(Shares sum to 101% from rounding. Of the 25 capability-cognitive nodes, 13 are cognitive alone, 9 also critical, and 3 all three.)

**These counts are stipulated, not measured.** They come from a lexical heuristic over lineage *names* the extraction model assigned. It has not been validated against human labels. Two known biases:

- The institutional regex catches "neo-Brandeisian antitrust" and "regulatory capture theory". Those are Doctorow-side lineages, which inflates the mixed bucket.
- Lineage describes where an idea comes from, not which side of a crux it takes.

Read the table as "both strands are present at scale", not as a measured split. Section 7.2 replaces it with an annotated one.

### 2.3 The normal-technology essay already lands in Skeptic

*AI as Normal Technology* was summarized into 27 Skeptic, 18 Safetyist and 10 Accelerationist key points. Its central claims map to Skeptic nodes, for example `skp-beliefs-203` (the innovation-diffusion lag). So the strand is not missing from the taxonomy. It is missing from the **voice**. The Skeptic soul's signature move, the Reality Grounding, redirects every debate to present material and labor costs. Nothing in the soul argues from diffusion rates or institutional track records.

(A side finding: `lib/debate/soul-docs/skeptic.soul.md`, the derived view, is stale against its JSON source of truth. The `.md` still has the older stock example ("the water table in Iowa") that the JSON's signature has since replaced with "derive a fresh instance from the case at hand". The `.md` header says to regenerate it whenever the JSON changes.)

## 3. The authors' positions

Each entry lists the primary sources to ingest. The positions below were checked against those sources or close reporting of them on 2026-10-05. Verification against full primary texts is a follow-up (t/3932 acceptance).

### 3.1 Emily M. Bender (critical strand)

- **On language models:** form is not meaning. A system trained only on linguistic form cannot learn meaning (Bender and Koller, "Climbing towards NLU", ACL 2020, the octopus test). Fluent output invites people to attribute understanding that is not there.
- **On costs and harms:** *On the Dangers of Stochastic Parrots* (Bender, Gebru, McMillan-Major and Mitchell, FAccT 2021) covers environmental and financial cost, training data that encodes hegemonic views, documentation debt, and misdirected research effort.
- **On the discourse:** *The AI Con* (Bender and Hanna, May 2025) argues that boosters and doomers are "two sides of the same coin". Both assume AI is inevitable, autonomous and powerful, and both push aside the real harms of existing automation. "AI" is treated as a marketing term.
- **Policy direction:** enforce existing law, require documentation and transparency, protect labor, and refuse automation in many domains. Existential-risk framing is treated as a distraction.

### 3.2 Cory Doctorow (critical strand, political-economy wing)

- **On platforms:** *enshittification*. Platforms first serve users, then abuse users to serve business customers, then abuse both to capture all the value for themselves (Pluralistic and *Wired*, 2023; *Enshittification*, 2025).
- **On AI as an industry:** a bubble. The interesting question is what residue it leaves when it pops ("What Kind of Bubble Is AI?", *Locus*, December 2023). AI is sold to bosses as a way to replace workers with worse output while a human takes the blame: the *reverse centaur*, a human serving as the machine's appendage ("The Reverse-Centaur's Guide to Criticizing AI", Pluralistic, December 2025).
- **On remedies:** antitrust and interoperability (*Chokepoint Capitalism*, with Giblin, 2022; *The Internet Con*, 2023). Notably, he argues **against** expanding copyright as the answer to AI training. In his view, 40 years of copyright expansion made media firms richer and artists poorer, and a new training right would just be signed away in standard contracts. What creative and other workers need is **sectoral bargaining** ("IP can't save you from AI", Pluralistic, August 2026; EFF, February 2025).
- **Why he matters to the split:** Doctorow is fully non-exceptionalist about the technology. To him AI is one more product the monopolists will enshittify. But he is not an institutionalist: he thinks the relevant institutions, antitrust above all, were abandoned and must be rebuilt. He shows that the strands share non-exceptionalism and split on institutions.

### 3.3 Arvind Narayanan and Sayash Kapoor (normal-technology strand)

- ***AI as Normal Technology*** (Knight First Amendment Institute, April 2025): AI is transformative in the way electricity or the internet was, over decades. The essay separates methods, applications, adoption and diffusion. Diffusion is limited by how fast organizations and institutions change, not by capability. Superintelligence is not a useful frame for policy.
- **Policy:** center **resilience**, meaning actions now that improve society's ability to handle unexpected developments. **Reject nonproliferation:** AI has no physical bottleneck like enriched uranium, and nonproliferation increases market concentration, which makes the risks of normal technology worse. Fostering open models raises resilience. Regulate applications sector by sector. A later essay in the series asks whether AI risks require extraordinary government intervention, and argues that so far they do not.
- **Overlap with the critics:** *AI Snake Oil* (2024) shows that much predictive AI does not work. So this strand is also hard on hype, but it locates the hype in specific product categories, not in the technology as a whole.

### 3.4 Daron Acemoglu (straddles the strands)

- *The Simple Macroeconomics of AI* (NBER, May 2024) estimates **no more than a 0.66% TFP gain over ten years**, and possibly under 0.53%. That is a normal-technology, slow-impact finding.
- *Power and Progress* (with Johnson, 2023) argues that the direction of technology is a political choice that tends to favor capital, which is a critical-strand argument. His nodes will likely land in the mixed bucket, and they should.

### 3.5 Gary Marcus (the boundary case)

- **On capability:** current deep learning is unreliable and brittle, and scaling LLMs will not reach general intelligence (*Rebooting AI*, with Davis, 2019; "Deep Learning Is Hitting a Wall", *Nautilus*, 2022). He favors neurosymbolic approaches and thinks AGI is achievable by other means.
- **On governance:** at the Senate Judiciary hearing of 16 May 2023, alongside Altman and Montgomery, he called for an FDA-like safety review, licensing ("say why the benefits outweigh the harms in order to get that license"), a monitoring agency, and probably an international agency (*Taming Silicon Valley*, 2024).
- **Where he lands:** capability-skeptic with the critics, and exceptionalist about governance with the Safetyists. He is not a normal-technology thinker: he wants **new** institutions. Section 5 shows his claims spread across two camps.

## 4. The cruxes

A camp boundary is justified where two positions **take opposite sides** of a question that comes up repeatedly in debate. Where they only stress different things, they are wings of one camp.

| Crux | Critical strand | Normal-technology strand | Opposed? |
|---|---|---|---|
| C0. Is AI exceptional (superintelligence, or transformation within years)? | No | No | **Agree.** This is why they were merged. |
| C1. Is the technology substantially useful? | Largely no. Fluency is mistaken for competence, and the market is a bubble. | Yes. A general-purpose technology whose value arrives slowly. | **Yes** |
| C2. Are existing institutions adequate? | No. They are captured or were abandoned, and need structural rebuilding (antitrust, labor power). | Largely yes, with sector-by-sector adaptation. | **Yes** |
| C3. Where does the main harm come from? | Ownership and power: who controls it and who is replaced. | Specific uses in specific sectors. | **Yes** |
| C4. Default stance on adoption | Resist or refuse in many domains. | Diffuse with guardrails, and build resilience. | **Yes** |
| C5. What is hype? | A deliberate strategy, a con. | A forecasting error, sometimes snake oil in specific products. | Partly |
| C6. Open-weight release | Mixed. It weakens incumbents, but doesn't touch labor harms. | Favored, because it raises resilience and lowers concentration. | Partly |

Four of the six contested cruxes (C1–C6) are full oppositions. On C1, C4 and C6 the normal-technology strand sides with the Accelerationists against the critics. That is a coalition pattern the current three-camp debate cannot produce. It is also the strongest *debate-quality* argument for a split: more distinct cruxes, and alliances that shift by topic instead of always running two against one.

## 5. Placing the people (claims, not persons)

A crude two-axis map shows where each figure's characteristic claims sit:

| | **Existing institutions suffice (adapted)** | **New or exceptional institutions needed** |
|---|---|---|
| **AI is (or soon will be) exceptional** | Accelerationist | Safetyist |
| **AI is not exceptional** | Normal-technology (Narayanan and Kapoor; Acemoglu's estimates) | Critical, which wants *rebuilt* institutions, not new AI-specific ones (Bender, Doctorow) |

Marcus sits in neither bottom cell. He is "not exceptional *yet*" on capability, but "new institutions" on governance. His claims would be extracted to different camps claim by claim: capability skepticism to Skeptic, licensing and agency proposals to Safetyist. **That is correct behavior, not a defect.** A taxonomy that needed a camp for every person would fragment without limit. The camps are positions, and an author can hold positions from several.

The axis split is coarse. The critics' "rebuilt institutions" (antitrust and labor law exist, but are unenforced) differs from the Safetyists' "new institutions" (an AI agency). That nuance is crux C2.

## 6. Options and their cost

### Option A: keep one Skeptic camp and broaden its soul

Rewrite `skeptic.soul.json` to voice both strands.

- **Cost:** one soul-document change, which is a CL review plus a persona regression check.
- **Problem:** the strands oppose each other on C1–C4. A single persona voicing both would contradict itself, or one strand would dominate in practice. This removes the gap but hides the disagreement.

### Option B: one POV with two wings (recommended first step)

Keep `skeptic` as the POV.

- Tag each Skeptic node with a strand: `critical`, `institutional` or `shared`.
- Ship two soul variants. The critical one is the current soul, sharpened, and the institutional one is new.
- Choose a variant per debate, or field both in an experimental four-seat mode.

**Cost:**
- A new `graph_attributes` field. That is an additive normative change to `taxonomy-schema.json`, so it needs a minor version bump, CL+TL co-sign, and the t/3361 Second Opinion check (likely triggered).
- A data mutation to backfill 376 nodes under `/data-mutation`.
- Variant selection in the debate setup.

The `pov` enum, the ID grammar and the situations are unchanged.

### Option C: four POVs

Split `skeptic` into two first-class camps.

**Couplings this reaches:**
- **Schema and IDs:** the `pov` enum in `soulDocSchema.ts`; the node-ID grammar (`pov` ∈ `acc/saf/skp/cc`) in `taxonomy-schema.json`, which is a normative change needing CL+TL co-sign and a mandatory Second Opinion.
- **Taxonomy data:** a new `taxonomy/Origin` file; reassignment or re-ID of 376 nodes and their edges and embeddings.
- **Situations:** a fourth interpretation for each of the 454 situations.
- **Summaries:** `pov_summaries` in all 862 summaries is keyed by three camps, so they would need re-extraction or a mapped split.
- **Debate engine and metrics:** turn order and three-agent BDI assumptions in the engine (at least 52 non-test files under `lib/debate` mention `skeptic`); convergence and crux calibration baselines measured on three debaters, which a change in debater count invalidates; UI colors.
- **Prompts:** every extraction and debate prompt that lists the camps.

**Benefit:** the C1–C6 coalition structure becomes first-class, and the Institutionalist gets equal standing.

## 7. Recommendation and decision rule

### 7.1 Stage 1: sources (independent of the decision)

Ingest the primary texts. The corpus has no Doctorow or Marcus, and *The AI Con* is missing.

- **Doctorow:** "What Kind of Bubble Is AI?" (*Locus*, 2023), "The Reverse-Centaur's Guide to Criticizing AI" (Pluralistic, 2025), "IP can't save you from AI" (Pluralistic, 2026), and *Enshittification* or a representative chapter.
- **Marcus:** the Senate testimony and QFR responses (16 May and 13 June 2023), "Deep Learning Is Hitting a Wall" (2022), and *Taming Silicon Valley* excerpts.
- **Bender and Hanna:** *The AI Con* (2025), and Bender and Koller (2020).
- **Narayanan and Kapoor:** the later *AI as Normal Technology* series essays, including "Do AI Risks Require Extraordinary Government Intervention?", and *AI Snake Oil* excerpts.

Check copyright and licensing before ingesting any book text. Prefer the openly published essays.

### 7.2 Stage 2: measure the strands

Replace the lexical table in section 2.2 with an annotated one:

- Draw a stratified sample of about 60 Skeptic nodes, labeled `critical`, `institutional`, `shared` or `neither` by two annotators working blind.
- Report raw agreement **with the count**, and the prevalence of each label.
- Report no κ if any label has fewer than five positives (t/3587).
- If agreement holds, extend to all 376 with a classifier and audit a sample.

### 7.3 Stage 3: pilot the Institutionalist voice

Run paired debates on the same motions:

- **Arm A:** the current Skeptic soul in the Skeptic seat.
- **Arm B:** the Institutionalist draft in that seat.
- **Arm C (optional):** both, in an experimental four-seat run.

Compare `crux_addressed_rate`, `convergence_score` and `repetition_rate`, and count the distinct cruxes surfaced. The replication gate applies: n ≥ 10 per arm, read as distributions.

**Decision rule for escalating to Option C.** Thresholds are **stipulated**; tune them before Stage 3.

Split into four POVs only if both hold:
1. **At least 25% of Skeptic nodes are `institutional`-only** in the annotated measurement. This is the corpus-mass test.
2. **In arm C, the two Skeptic variants take opposite sides on at least three recurring cruxes** across at least half the motions. This is the debate-substance test.

If (1) holds but (2) does not, keep Option B. The strands are wings. If neither holds, stop at Option A and give the institutional voice a softcoded boundary in the existing soul.

## 8. Naming

If the split happens, the labels should name what each camp affirms (see the naming discussion with the PI, 2026-10-05):

- **Critical strand: keep "Skeptic".** These authors describe themselves as skeptics of AI hype, and the current soul is already theirs. "Critic" is an alternative if "Skeptic" reads as epistemic only.
- **Normal-technology strand: "Institutionalist".** It names the normative claim (existing institutions, adapted), parallels "Safetyist" and "Accelerationist", and avoids "Normal", which presumes the conclusion. "Continuist" is the runner-up, naming the descriptive claim.

The node-ID prefix for a new camp would need a new three-letter code, for example `ins`, and that is a grammar change. Keep `skp` for the existing camp so 376 IDs and their references remain stable.

## 9. The candidate soul documents

Both drafts follow `SoulDocumentSchema` field for field.

### 9.1 `skeptic-critical.soul.draft.json` (the current Skeptic, sharpened)

This keeps the investigative-journalist voice, which is good and distinct. Changes from the live soul:

- **Value hierarchy reordered:** power accountability first, material reality second. That is a behavioral change (soul theory doc, section 6).
- **Bender's linguistic critique added:** a hardcoded `REJECT:` boundary on attributing understanding or intent to text predictors, and an anti-pattern against anthropomorphic verbs.
- **Doctorow's political economy added:** capability claims are business claims, and remedies are structural (antitrust, interoperability, sectoral bargaining), not property-rights expansion.
- **Falsification bet made explicit:** the live soul's falsification line asks who would know first. The draft states what observation would count against the camp.
- **New softcoded boundary:** usefulness for a named, independently evaluated task can be conceded. This keeps the persona from denying all usefulness, which would be a caricature.

### 9.2 `institutionalist.soul.draft.json` (new)

The voice is a seasoned regulator or economic historian. It is measured, specific and dry, and it puts a denominator on every number. Its signature move is the **Reference Class**: before a technology is called unprecedented, name the last three that were called that and say what institutions did with them.

Its anti-patterns stop it collapsing into either neighbor:
- it may not dismiss usefulness, which is the critic's move;
- it may not treat institutions as infallible, so it must name failures such as social media or 2008 finance and say what adaptation fixes them;
- it may not use "normal" as a conclusion, only argue for it.

The camp would count itself wrong if measured adoption and productivity effects clearly outran electricity's and the internet's within a decade. It would also count itself wrong if a sector regulator, given adapted authority, demonstrably failed on a documented AI harm.

`pov: "institutionalist"` is **not** a valid value in the current enum, so this draft fails `SoulDocumentSchema` by design. That is the first coupling Option C would have to change. Under Option B it would load as a `skeptic` variant. The color token `var(--color-ins)` does not exist yet either.

### 9.3 Schema check (observed)

Both drafts were parsed with the live `SoulDocumentSchema` (`lib/debate/soulDocSchema.ts`, identical to `origin/main` at `9b698325`), on 2026-10-05:

| Draft | Result |
|---|---|
| `skeptic-critical.soul.draft.json` | Valid |
| `institutionalist.soul.draft.json`, as written | Invalid, on `pov` only: expected one of accelerationist, safetyist, skeptic |
| `institutionalist.soul.draft.json` with `pov` set to `skeptic` | Valid |

Both drafts say "the other speakers" where the live soul says "the other two speakers", so neither assumes a three-seat debate.

## 10. Follow-ups

- **Source ingestion (Stage 1).** Filed as a ticket now, because it is useful whatever the PI decides.
- **Stages 2–3.** Filed after the PI chooses between Options A, B and C, because their scope depends on that choice.
