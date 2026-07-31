# Frame-Survival Metric Specification

**Ticket:** t/2042
**Author:** Computational Linguist (Orca)
**Created:** 2026-07-31
**Status:** Spec approved for implementation (DebateTool implements; CL reviews)
**Provenance:** all instrument fields **stipulated** at introduction; counts are **observation**. Register rows added in the same PR (`metric-provenance-register.md` §8).

## 1. Motivation and construct

Each opening statement's PLAN stage produces `framing_choices`, two `{frame, why}` pairs per POV (`lib/debate/prompts/opening.ts:143-146`). After the opening turn, these frames have **no direct downstream consumer**: their influence survives only through the opening statement text and its claim sketches. The system currently cannot answer:

- Did a debate stay in the opener's frame, or did an opponent displace it?
- Do declared frames *shape* the disagreement (cruxes phrased in frame vocabulary) or just decorate the opening?
- When a debater abandons a frame, was it contested (REFRAME-targeted) or silently dropped?

This family is the frame-level analogue of `situation_crux_alignment` (do injections shape substance?) and `claims_forgotten_rate` (is earlier material dropped?). It is also the designed measurement instrument for the **frame re-injection experiment** (§9): whether opening frames should be re-presented to debaters in later turns cannot be decided without a baseline reading of current frame behavior.

### Construct boundary (load-bearing; the t/1669 standing finding)

The register's t/1669 finding stands: **dialectical relations (rebut, concede, successful reframe) are not separable by topical co-presence instruments** (taxonomy refs, embeddings). This family therefore measures only two things that co-presence instruments *can* measure, plus one structural count:

1. **Topical persistence.** Is a frame's semantic content present in later turns? (embedding co-presence)
2. **Topical spread.** Is it present in *opponents'* turns and in crux statements? (embedding co-presence)
3. **Contest events.** How many validated REFRAME moves targeted argument-network nodes linked to a declared frame? (structural, from recorded moves)

The family makes **no claim to measure reframe *success***. "Persistence dropped after a REFRAME event" is a co-presence trajectory; "the REFRAME worked" is a dialectical judgment that requires human labels. Any review or paper sentence asserting displacement *causation* from these fields alone overclaims. An LLM-judge variant is rejected on evaluator-sensitivity grounds (t/1835 MAD 0.625; per t/1843/t/1846, judge-derived metrics are evaluator-relative by construction).

## 2. Data sources

| Input | Where it lives | Notes |
|---|---|---|
| Declared frames | Opening pipeline PLAN work product, `framing_choices[].frame` (session `stage_diagnostics`) | **`frame` text only — never `why`.** The rationale is a different register (strategy prose vs debate prose); mixing registers is the exact basis mismatch that sank the t/1853 crux-match validation. Depends on t/2043 (field typed `{frame, why}[]`, not `string`). |
| Turn statements | Session transcript, per-speaker post-opening turns, split into paragraphs (`\n\n`) | Same paragraph convention as draft output constraints. |
| Crux statements | Neutral-evaluator crux list (pinned evaluator, t/1846) | `frame_crux_alignment` inherits the crux list's evaluator-relativity caveats. |
| REFRAME moves | Validated `planned_moves` history (turn pipeline) + argument-network edges | Structural — validated moves with targets, not prose inference. |
| Opening claim sketches → AN nodes | Argument network node origin | Used to link a frame to the AN node(s) that carry it. |

**Embeddings:** all-MiniLM-L6-v2 (project standard, 384-dim), computed **at debate time**. Frame embeddings are computed at opening finalization and persisted in the session, following the t/1853 pattern of embedding at evaluation time so extraction stays pure and a later model swap is detectable. Frame-to-paragraph comparisons are cosine over these vectors; the dimension guard from `extract-metrics.ts` applies (never compare cross-space).

## 3. Field definitions

All fields live in `CalibrationDataPoint` (`lib/debate/calibrationLogger/schema.ts`); computation in `lib/debate/calibrationLogger/extract-metrics.ts`. Per-turn similarity **series** are persisted in the session diagnostics only (curve = diagnostics; calibration row = scalars).

Let `F_s` = speaker *s*'s declared frames; `T_s` = *s*'s post-opening turns; `T_¬s` = all other speakers' post-opening turns. For frame *f* and turn *t*: `sim(f, t) = max over paragraphs p∈t of cosine(embed(f), embed(p))`. A frame is **present** in a turn iff `sim(f, t) ≥ FRAME_PRESENCE_THRESHOLD`.

| Field | Type | Definition | Class |
|---|---|---|---|
| `frames_declared_per_speaker` | `Record<speaker, number>` | Count of parseable declared frames per speaker. | observation |
| `frame_persistence_per_speaker` | `Record<speaker, number \| null>` | Mean over `f ∈ F_s` of (fraction of `T_s` where *f* is present). "Do I keep operating in my own frames?" | stipulated |
| `frame_engagement_per_speaker` | `Record<speaker, number \| null>` | Mean over `f ∈ F_s` of (fraction of `T_¬s` where *f* is present). "Do *others* operate in (or against) my frames?" — shaping vs decorating. | stipulated |
| `frame_crux_alignment` | `number \| null` | Fraction of neutral-evaluator cruxes whose max similarity to **any** declared frame ≥ `FRAME_PRESENCE_THRESHOLD`. Parallel to `situation_crux_alignment`. | stipulated |
| `frame_reframe_targeted_count` | `number` | Count of validated REFRAME moves whose target AN node is **frame-linked**: the node originates from an opening claim sketch with `cosine(frame, sketch) ≥ FRAME_LINK_THRESHOLD` for some declared frame of the node's author. | stipulated (threshold-conditional count, same classification logic as `crux_match_stats`) |
| `frame_survival` | `number \| null` | **Headline.** Unweighted mean of non-null `frame_persistence_per_speaker` values. | stipulated |

## 4. Parameters

| Parameter | Value | Rationale |
|---|---|---|
| `FRAME_PRESENCE_THRESHOLD` | **0.50** | Stipulated, precision-favoring (t/1853 lesson: on a slope with class overlap, prefer precision and treat recall-sensitive readings as directional). Same-author frame-vs-own-prose pairs should cluster higher than the t/1853 cross-register crux case (gold mean 0.463); this expectation is itself unvalidated — see §8. |
| `FRAME_LINK_THRESHOLD` | **0.60** | Stipulated. Frame ↔ same speaker's opening claim sketch — same author, same debate, same register; mirrors the org-stance/entity-linking 0.60 convention rather than resting on frame-specific evidence. |

Both parameters are calibration knobs, not truths. Neither may move except via the §8 validation path or a register-recorded owner/CL decision.

## 5. Null and cutover policy

- **Null** (never 0) when: `framing_choices` is absent or unparseable for the speaker (all pre-t/2043-fix sessions with shape drift; legacy sessions without persisted frame embeddings), the speaker has < 2 post-opening turns, or embeddings are unavailable/dimension-mismatched.
- **No backfill in v1.** Legacy rows stay null. (Backfill is technically sound, since MiniLM is local and deterministic, but a backfilled row would mix embed-at-debate-time and embed-at-backfill-time provenance; if ever done, it ships as a flagged batch with its own register note.)
- **Cutover:** fields exist only for sessions at/after the implementing commit. First calibration run at that commit is the cutover; no trend may span it (vacuously true, since prior rows are null).

## 6. Length and censoring interaction

Persistence and engagement are **per-turn fractions**, so they are length-normalized by construction. But short debates have coarse denominators (2 turns → values ∈ {0, 0.5, 1}), and frame drift plausibly accumulates with rounds. Rules:

- Always read alongside `rounds` and `termination_reason`.
- These fields are **not** added to the t/1671 un-pooled headline set (they are not convergence metrics), but any *comparison across windows* used to support a convergence claim must satisfy R-4 (censoring-rate stability) like any other paired reading.
- First-analysis obligation (implementation AC): report the correlation of `frame_survival` with `rounds` on the first ≥30 real-debate window. If |r| is material (≥0.4), a round-count stratification note gets added here before the metric is cited anywhere.

## 7. Interpretation guidance (directional only until validated)

| Signature | Reading |
|---|---|
| High own-persistence + low `crux_addressed_ratio` | **Frame-lock**: debaters retreating into frames instead of engaging cruxes. The failure mode the re-injection experiment's guardrails exist to catch. |
| High own-persistence + high opponent `frame_engagement` | **Frame dominance**: the debate is being conducted in this speaker's frame. |
| High own-persistence + high `repetition_rate` | Frame *restating*, not frame consistency — check repetition before crediting coherence. |
| Low persistence everywhere + healthy crux engagement + `frame_reframe_targeted_count` > 0 | Contested displacement story (directional — see construct boundary). |
| Low persistence everywhere + `frame_reframe_targeted_count` = 0 | Silent drift: frames abandoned without contest. The `claims_forgotten_rate` analogue at frame level. |
| High `frame_crux_alignment` | Opening frames defined the disagreement space (the frame-level reading of `situation_crux_alignment`). |

**Hard rule (optimizer):** every field in this family carries **zero weight in any auto-tune objective** until human-validated (the `CRUX_AXIS_PARAMS` treatment). An unvalidated co-presence instrument must not move calibration config.

## 8. Validation path (off stipulated)

Golden-set study, prereg'd before any directional use in reviews or papers (t/1853 protocol as template):

1. Freeze ~30 (frame, paragraph) pairs sampled across similarity bands from real debates (MSL ≥ 10 population only, per `REAL_PROSE_MIN_MSL`).
2. Hand-label "operating in this frame / not," blind to similarity scores.
3. Bars: precision ≥ 0.80 at `FRAME_PRESENCE_THRESHOLD`; recall reported but not gating (precision-favoring stance).
4. Outcomes: pass → rows promote toward derived with the study pointer; fail → threshold stays, readings stay directional-only, and the register row records the failure (the t/1853 precedent; a failed validation is register-visible, not silently retried).

## 9. Consumer: frame re-injection A/B (design outline; full prereg at experiment time)

The experiment this metric exists to evaluate (t/2042#1 design position):

- **Arms:** control (current prompts) vs PLAN-stage injection of the speaker's own declared frames, phrased as a decision ("reaffirm, adapt, or deliberately abandon, and state which"), phase-gated to `confrontation` + `argumentation` (`types/phase.ts:32`), dropped in `concluding`.
- **Sequencing:** baseline first. ≥ `REPLICATION_GATE_MIN_N` (10) clean-tree replications per arm on a fixed provenance triple (`config_revision|prompt_version|model`); topics paired across arms; distributions (median + IQR + MAD), never single draws.
- **Primary outcome:** `frame_survival` (expected ↑ under injection).
- **Guardrails (no-regression gates):** `crux_addressed_ratio` (un-pooled, R-4 censoring-stable comparison), `repetition_rate`, `convergence_score_at_termination`. Adopt injection only if no guardrail's median shifts adversely beyond the control arm's MAD.
- **Cutover note:** the injection changes *debater* prompts, so `prompt_version` splits the arms; the evaluator prompt is untouched (no t/1670-class evaluator cutover), but debater-prompt-sensitive fields are still arm-relative by design.

## 10. Implementation notes (DebateTool)

- **Depends on t/2043** (typed `framing_choices`) for the field-wise read; do not parse the string shape.
- Frame embeddings computed at opening finalization, persisted in the session next to the frame texts (model + dim recorded, per the entity-embeddings convention).
- Per-frame per-turn similarity series → session diagnostics; scalar fields → `CalibrationDataPoint`.
- Schema doc comments must state the threshold-conditionality (`crux_match_stats` precedent) and the null policy.
- Tests: fixture session with known frames/turns (deterministic vectors), null paths (missing frames, 1-turn speaker, dimension mismatch), and the REFRAME link classification.
- `npm run verify` green; CL review is mandatory (metric-bearing files).

## 11. Register and ownership bookkeeping

- Rows added to `metric-provenance-register.md` §8 (design-stage) in this PR; they move to §1/§5 when the implementation lands.
- This spec is added to `docs/owned-files.md` (defines metrics and thresholds → mandatory CL review).
- The implementation ticket must reference this spec and t/2042.
