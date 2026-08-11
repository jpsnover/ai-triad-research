# Convergence Signals — the "Conv" Analysis View

**Last updated:** 2026-08-11

Every substantive debate turn carries a per-turn **convergence signal**: a small set of
measurements taken the moment a turn's claims are extracted into the argument network.
The **Conv** view (select **Analysis → Conv** on any statement card) renders that signal
as a seven-field card. This guide explains each field, how it is computed, how to read its
colored badge, and why the set exists.

The signal is computed in `lib/debate/convergenceSignals.ts` (`computeConvergenceSignals`)
and rendered by `ConvergenceInlineCard` in
`taxonomy-editor/src/renderer/components/debate-workspace/StatementCard.tsx`. The same
fields appear, per-round and in aggregate, in the diagnostics
**Convergence Signals** panel.

## Why these fields exist

A three-agent debate can fail in ways that a transcript alone hides. The debaters can circle
the same points, drift onto adjacent topics, agree too early without engaging, or trade
assertions that never connect to each other. The convergence signal is an instrument panel:
each field is a gauge for one specific failure mode, read one turn at a time.

The design goal is **convergence on the real disagreement** — the crux — rather than either
premature consensus or endless talking-past. A healthy debate should show turns that engage
prior arguments (not standalone assertions), advance rather than repeat, concede when the
evidence warrants it, let positions evolve, and keep returning to the cruxes until they
resolve. Each field below maps to one of those expectations.

These per-turn signals are not decorative. They feed two downstream computations in the same
module:

- **Process reward** (`computeProcessReward`) — a continuous `[0,1]` per-turn quality score
  whose components are drawn directly from these fields: engagement, novelty
  (`1 − redundancy`), consistency (concession coherence), grounding, move quality, and crux
  relevance. This is the "process reward" in PRM terms: each turn is scored as an intermediate
  reasoning step, independent of the final debate outcome.
- **Uncertainty / collapse detection** (`computeUncertaintyMetric`) — an anti-sycophancy
  metric that flags premature consensus when agreement looks superficial (high support ratio,
  low engagement, high recycling).

They also underpin the calibration metrics the Computational Linguist tracks across debates:
`crux_addressed_rate`, `repetition_rate`, `convergence_score`, and
`situation_crux_alignment`.

## The seven fields

Each field shows a computed value and a colored status badge. Badges are thresholded bands:
green is the healthy reading, amber is a caution, red is the failure signal. Blue is neutral
information (movement without a value judgment).

### 1. Polarity — is the turn advancing or resolving?

Format: `{N}C / {M}S = {ratio}%` with a **cooperative** / **confrontational** badge.

`C` counts the turn's **confrontational** dialectical moves; `S` counts its **collaborative**
(support) moves. `ratio = collaborative / (confrontational + collaborative)`.

- Confrontational moves: counterexample, undercut, empirical challenge, burden-shift,
  expose-assumption.
- Collaborative moves: concede, concede-and-pivot, conditional-agree, integrate, steel-build,
  identify-crux.

Bands: `ratio ≥ 0.5` → **cooperative** (green); below → **confrontational** (red).

Neither reading is "good" on its own — the right mix is phase-dependent. Confrontation is
expected while positions are being pressure-tested; cooperation is expected as a debate moves
toward synthesis. Polarity tells you which mode a turn is in so you can judge whether it fits
the phase.

### 2. Dialectical Engagement — is the claim wired into the argument, or dropped in?

Format: `{targeted}/{total} targeted = {ratio}%` with a **deep** / **moderate** /
**standalone** badge.

A claim from this turn is **targeted** if it has an edge (supports or attacks) to a node
*outside* this turn; it is **standalone** if it connects to nothing but its own turn. The
ratio is `targeted / (targeted + standalone)`.

Bands: `ratio ≥ 0.7` → **deep** (green); `≥ 0.4` → **moderate** (amber); below → **standalone**
(red).

This is the primary "talking past each other" detector. A turn full of standalone claims adds
text without joining the shared argument. A deep turn attaches its claims to what has already
been said. Engagement is the largest single component of the process reward (weight 0.20).

### 3. Argument Redundancy — is the debater making progress or restating?

Format: `avg {A}%, max {B}%` (and `sem {C}%` when semantic similarity is available) with a
**fresh** / **repeating** / **semantic repeat** badge.

Word overlap between this turn and the same speaker's up-to-10 prior turns, reported as the
average and the maximum. When turn embeddings are present, a **semantic** similarity
(embedding cosine, not just shared words) is also shown; if it crosses the semantic-recycling
threshold the turn is flagged as a paraphrased repeat even when the wording differs.

Bands: semantically recycled → **semantic repeat** (red); else `max ≥ 0.5` → **repeating**
(amber); else → **fresh** (green).

High redundancy means the debater is circling — restating an earlier argument rather than
evolving the position. Novelty (`1 − redundancy`) is a process-reward component (weight 0.20),
so a repeating turn is scored down.

### 4. Dominant Counterargument — what is the strongest live objection?

Format: `{node_id} str={strength}` with a **strong** / **moderate** / **weak** badge, or
`none`.

The single strongest attack currently aimed at this speaker's claims, identified by **QBAF**
strength (the quantitative bipolar argumentation framework score, which propagates support and
attack weights through the network). Shows the attacking node's id and its strength.

Bands: `strength ≥ 0.7` → **strong** (red); `≥ 0.5` → **moderate** (amber); below → **weak**
(green). `none` means no attack is currently landing on this speaker.

This field names the objection the speaker most needs to answer. A persistent strong
counterargument that the speaker never addresses is a sign the debate is not converging on it.

### 5. Concession — intellectual honesty under pressure

Format: `{K} attacks, used: Y/N — [Taken | Missed | N/A]`.

`K` is the number of **strong** attacks (QBAF strength ≥ 0.6) the speaker faced this turn.
`used: Y/N` reports whether the turn actually used a concession move. The outcome badge
combines the two:

- **N/A** — no strong attack faced (nothing to concede to).
- **Taken** (green) — faced a strong attack and conceded.
- **Missed** (red) — faced a strong attack and did *not* concede.

Concession is the strongest convergence signal available: a debater explicitly acknowledging
an opponent's point. A **Missed** outcome is stubbornness under evidence — the enemy of
convergence. Concession coherence is the process-reward "consistency" component: taken scores
1.0, missed scores 0.3, N/A scores a neutral 0.7. A taken concession also boosts the
convergence tracker directly (`boostConvergenceOnConcession`).

### 6. Position Drift — is the position evolving or frozen?

Format: `opening: {overlap}%, drift: {delta}%` with an **anchored** / **evolved** / **shifted**
badge.

`overlap` is the word overlap between this turn and the speaker's own opening statement — how
close the speaker still is to where they started. `drift` is the turn-over-turn change in that
overlap (the absolute delta from the speaker's previous turn), i.e. how much the position moved
*this* turn.

Bands on `overlap`: `≥ 0.6` → **anchored** (amber); `≥ 0.3` → **evolved** (green); below →
**shifted** (blue).

A permanently anchored speaker is not learning from the exchange; a healthy debate shows
positions that evolve. A large shift is neither good nor bad on its own (blue is neutral) — it
is movement worth noticing, which may be genuine updating or may be drift off the topic.

### 7. Crux Engagement — are they engaging the actual disagreement?

Format: `this turn: Yes/No | cumulative: {N} | follow-through: {F}` with a **resolving** /
**no follow-through** badge. This field spans the full width of the card.

- **this turn** — did this turn's claims engage a tracked crux? A crux is engaged if the turn
  produced one of its attacking claims, if a crux changed state on this turn, or if any edge
  connects a turn claim to a crux node.
- **cumulative** — running count of this speaker's crux-engaging turns.
- **follow-through** — cumulative count of crux-engaging turns that *also* carried a
  collaborative move. Engaging a crux and then working toward resolving it, not just naming it.

Badges: `cumulative > 0` and `follow-through = 0` → **no follow-through** (amber); `cumulative >
0` and `follow-through > 0` → **resolving** (green).

Cruxes are the disagreement points that, if resolved, would change a debater's position.
Engaging them is the whole point of the debate; following through is how they get resolved. A
high cumulative count with zero follow-through means the debaters keep circling the crux without
moving it — the amber warning exists precisely to surface that pattern. Crux relevance is a
process-reward component (weight 0.15).

## Reading the card in practice

Read the seven fields as one gauge cluster, not seven independent numbers:

- **Healthy, converging turn:** deep engagement, fresh (low redundancy), a taken or N/A
  concession, an evolving position, and crux follow-through. The debater is joining the
  argument and moving it.
- **Circling:** repeating or semantic-repeat redundancy, standalone engagement, and crux
  engagement with no follow-through. Text is being produced but the disagreement is not moving.
- **Premature agreement / collapse:** cooperative polarity plus standalone engagement plus high
  redundancy is the exact combination `computeUncertaintyMetric` flags — agreement that looks
  superficial rather than earned. Cross-check with the diagnostics uncertainty panel.
- **Stubbornness:** a persistent strong Dominant Counterargument alongside repeated **Missed**
  concessions and an anchored position.

An empty card ("No convergence data for this turn") means the signal has not been computed yet;
signals are produced after each turn's claims are extracted, so the current in-flight turn will
not have one until it completes.
