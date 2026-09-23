# B1 gold set: concession + retained_hold study design + codebook (t/3611)

**Author:** Computational Linguist
**Status:** design + sampling frame landed (this milestone). Execution (two-blind annotation, per-class reliability, B1.5 human adjudication) is the next phase and has dependencies noted in section 6.
**Origin:** the surviving deliverable from t/3587, which resolved the construct question (the defeater / latent-CA-condition is non-viable for this genre) but demonstrated **applicability, not reliability** (N=10, ~2 positive instances). This gold set is the metric-provenance anchor the surviving AIF-crux metric (B5, t/3588) is blocked on.

## 1. Scope: two classes only

Annotate exactly two moves:
- **`concession`**: the speaker grants a specific opposing proposition as correct/valid.
- **`retained_hold`**: the speaker reasserts their own claim despite an incoming attack.

Dropped from t/3587's original 4-class AC: `attributed_restatement` and `cross_agent_attack` (near-constant in the pilot; degenerate for reliability), and `defeater`/`condition` (the construct investigation closed it). Do not annotate them.

## 2. Codebook (pinned against the t/3587 failure modes)

Three disciplines carried from t/3587, load-bearing:
- **Annotate the move, not a marker.** In the pilot the explicit "I would change if X" defeater cue never appeared, and marker-absence was misread as construct-absence. Do not key any label off a single lexical cue ("I concede", "fine", "but"). Judge the speech act.
- **Do not smuggle the crux back in.** A concession is granting an *opposing* proposition; it is not "the speaker moved toward the crux resolution." Judge the local move, not its effect on convergence.
- **Applicability is not reliability.** The first pass measures whether the codebook *applies* and at what rate; a reliability claim requires the sized run and survives only with its N attached.

### `concession` (boolean, per turn)
**Positive** iff the speaker, in this turn, grants a **specific opposing proposition** (an opponent's claim, or a specific fact/point an opponent asserted) as correct or valid.
- Partial grant counts: granting one specific opposing point while holding the rest is a concession (it co-occurs with `retained_hold` in the pilot, idx 4/7: *"Fine, executives write memos"* granted + *"category error"* held). A turn may be positive for **both** classes.
- **Excludes:** politeness/acknowledgment with no propositional grant ("that's a fair question"); restating an opponent's view to attack it (that is attributed_restatement, out of scope); granting one's *own* prior overstatement (self-correction, not a cross-agent concession).
- The granted proposition must be **identifiable** (annotator notes which opposing claim was granted); an unlocatable "I agree" is not scorable as a concession.

### `retained_hold` (boolean, per turn)
**Positive** iff the speaker **reasserts a claim they previously held** in **response to an incoming attack** on it.
- Requires (a) a prior hold of the claim by this speaker, and (b) an intervening attack the reassertion answers. A fresh assertion with no prior hold and no attack is **not** retained_hold.
- Reasserting with elaboration/new support counts; verbatim repetition counts; conceding the point does not (that is the opposite move on that proposition, though the turn may retain a *different* claim).
- **Excludes:** first statement of a position (opening); reasserting when unchallenged (no attack to hold against).

Annotators record, per positive: the specific proposition (for concession, the granted opposing claim; for retained_hold, the held claim + the attack it answers). This makes each label auditable and supports B1.5 adjudication.

## 3. Sampling frame (built; provisional size)

`build_b1_sample.py` + `b1-sample-manifest.json` (references only; text re-hydrated from the data repo, which is the text SoT).

- **Stratum:** round>=3 pov statement/opening turns (the scaffold-dense stratum where concession/retained_hold concentrate). Late-round population: **679** turns.
- **Sample:** **150** turns across **75** debates; balanced by speaker (acc 53 / saf 50 / skp 47) and spanning rounds 3 to 15 (dense at 3 to 5). Median turn ~2.5k chars.
- **Deterministic:** stable `sha256(debate_id|turn_id)` sort + even stride, no RNG. Re-runs are byte-identical (same discipline as the t/3302 golden).
- **Backward sizing (AC 1):** 150 is provisional. The pilot's ~20% per-class positive rate was one hand-picked debate's late rounds and almost certainly over-states the corpus rate; the **two-blind applicability pass (AC 2) measures the real rate and drives the final N** to hit >=20 positives/class (30 preferred). If the observed rate is (say) 8%, 150 yields ~12 positives/class and the sample must grow before any reliability claim.

## 4. Protocol

1. **Two blind annotators**, independent, no access to each other's labels or notes, both working only from the codebook + re-hydrated turn text.
2. **Applicability/rate pass first (AC 2):** report per-class positive rate and whether the codebook applies cleanly (ambiguous/uncodeable turns flagged). This drives final sizing; it is **not** a reliability claim.
3. **Reliability per class (AC 3):** once each class clears its positive-instance target N, compute the appropriate measure. Cohen's kappa where the class is roughly balanced; **PABAK or raw agreement + bootstrap CI where skewed** (concession/retained_hold will be skewed-negative). **Every statistic carries its N; any prevalence/base-rate correction carries its basis** (the standing statistic-provenance rule). No reliability claim on a class below its target N.
4. **Non-degenerate check:** the reported agreement must exclude both degenerate modes, annotators diverging *and* annotators constant (the t/3587 v4 stopping-rule trap: 100% agreement at zero prevalence is degenerate, not reliable).
5. **B1.5 human adjudication (AC 4):** a human adjudicates disagreements and confirms the labels before this anchors any AIF-crux threshold. This is the reliability ground; inter-LLM agreement (if LLM annotators are used for the applicability pass) is an **applicability/consistency** measure, never a substitute for it.

## 5. Provenance anchor

The adjudicated gold set + its per-class reliability record is the **metric-provenance anchor** for B5's AIF-crux metric (t/3588), which is **aggregate over the crux set, not single-crux** (the t/3587 over-determination constraint). Register entry in `metric-provenance-register.md` when the reliability lands: the two signals move from **stipulated** to **human-validated**, each with its N. Until then, per t/3588 AC 6, B5 outputs are provisional and anchor no threshold.

## 6. Execution dependencies (why this milestone is design, not done)

- **Second independent blind annotator:** needed for the applicability pass and reliability. Can be a peer CL instance or a blind sub-agent for the *applicability* pass (clearly labeled LLM-applicability), but reliability grounding is B1.5.
- **Human adjudicator (B1.5, AC 4):** a hard human dependency; the study cannot produce a trustworthy reliability claim without it. Surface to the PI when the applicability pass has sized the sample and produced the disagreement set to adjudicate.

This milestone delivers ACs 1 (sampling frame + backward-sizing method) and the codebook; ACs 2 to 5 are the execution phase.
