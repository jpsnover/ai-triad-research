# Adaptive Staging Signal Reference

**Audience:** Researchers and developers diagnosing why a debate changed phase when it did, why it stalled, or why the engine vetoed or forced a transition.  
**Related docs:** `debate-system-overview.md`, `aggregative-semantics-review.md`, `debate-diagnostics-field-guide.md`

---

## What adaptive staging does

The debate engine doesn't run for a fixed number of rounds. Instead, it monitors a set of signals after each turn and decides whether to stay in the current phase, advance to the next, or — if quality degrades — regress to a prior phase. This is **adaptive staging**.

The logic lives in a **predicate**: a function that reads the current signal state and returns an action (`stay`, `advance`, `regress`, `force`, `veto`). The predicate runs once per turn, after the turn is committed. Its decision is recorded in the signal telemetry alongside the signal values that produced it.

---

## Phase model

The debate moves through three phases in order:

| Phase | Purpose | Typical behavior |
|---|---|---|
| **Confrontation** | Establish positions; surface disagreements | Each agent asserts core claims; few attacks; crux set crystallizes |
| **Argumentation** | Direct engagement with opponent claims | High CA-edge rate; crux engagement rises; saturation grows |
| **Consolidation** | Synthesis and resolution | Attack rate drops; agents integrate opponent arguments or reaffirm positions with refinement |

The engine advances from confrontation → argumentation when saturation and convergence signals cross their thresholds. It advances from argumentation → consolidation when saturation is high and convergence has plateaued. Consolidation ends the debate.

Phases do not have a fixed round count. A debate can stay in confrontation for 2 rounds or 12, depending on how quickly the signals move.

---

## Signal glossary

The signal telemetry table uses abbreviated column headers. This section defines each one.

### Sat — Saturation score

**What it measures:** The fraction of the configured crux set that has at least one attributed I-node with `computed_strength ≥ 0.3`. A crux is "saturated" when at least one agent has made a non-trivial claim about it.

**Range:** 0.0 (no cruxes addressed) → 1.0 (all cruxes have at least one strong claim).

**Role in phasing:** Saturation is the primary advance signal out of confrontation. When enough cruxes have claims, the debate has established enough shared ground to move into direct argumentation. A debate stuck at low saturation has agents asserting positions that don't connect to the core contested questions.

**What to look for:** Saturation that rises quickly in confrontation and then plateaus in argumentation is normal — the cruxes were addressed early and subsequent rounds are deepening the engagement. Saturation that never rises above ~0.3 suggests the debate scope is misconfigured (agents are arguing about adjacent topics that don't touch the cruxes) or the crux set is too narrow.

---

### Conv — Convergence score

**What it measures:** The cosine similarity between the centroid of all claims from each pair of agents. High convergence means agents are making semantically similar claims; low convergence means they are far apart in argument space.

**Range:** 0.0 (debaters arguing about completely different things) → 1.0 (debaters making essentially the same claims).

**Role in phasing:** Convergence is a *two-directional* signal. Early in a debate, low convergence is healthy — agents are staking out distinct positions. Moderate convergence in argumentation (0.4–0.6) means agents are engaging with each other's claim space. High convergence (> 0.7) in argumentation is a warning sign: debaters are restating each other rather than resolving disagreements, and the moderator will likely intervene. Very high convergence in consolidation may legitimately signal resolution.

**What to look for:** Convergence that jumps from low to high without a corresponding rise in crux_engagement means the agents are *saying similar things* but haven't engaged the actual contested points — false consensus. The moderator's intervention system watches for this pattern and responds with reframing moves.

---

### Conf — Confidence (global)

**What it measures:** A composite of three internal confidence estimates:
- **Extraction confidence** — how consistently the engine extracted well-formed claims from turns (high variance = low confidence)
- **Stability confidence** — how stable the argument network structure is round-to-round (frequent large restructurings = low stability)
- **Global confidence** — the weighted composite displayed in the telemetry table

**Range:** 0.0 → 1.0. Values below 0.4 are highlighted in red in the diagnostics table.

**Role in phasing:** Low confidence can **defer** a phase transition even when other signals say advance. A confidence deferral means "the signals say we should move, but the signal data itself is unreliable enough that we should wait." The `confidence_deferrals` stat card counts how many times this happened in a debate.

**What to look for:** Persistent low confidence (Conf < 0.4 for many rounds) suggests extraction quality problems — the model is producing malformed claims or the debate topic is producing ambiguous output. Check the Draft tab quality gate for repeated parse failures.

---

### TC — Topic Coherence

**What it measures:** How semantically close new claims are to the crux centroid (the center of mass of the configured crux embeddings). High topic coherence means the debate is staying on topic; low coherence means claims are drifting away from the core questions.

**Displayed as:** `1 − raw_signal`. The raw signal is a drift distance (high = far from centroid = bad); the displayed value inverts it so that high TC = high coherence = good.

**Color coding in the telemetry table:**
- TC > 0.7 → green (on-topic)
- TC 0.4–0.7 → amber (moderate drift)
- TC < 0.4 → red (significant drift)

**Role in phasing:** TC is primarily an early-warning signal for scope drift. The exclusion guard acts on individual claims; TC acts on the debate as a whole. Sustained low TC across many rounds often precedes a batch of exclusion guard violations.

**What to look for:** TC that drops suddenly after a specific turn — find that turn in the transcript and check its Exclusion tab. The claim that caused the drift is usually visible as a scope drift warning.

---

### Net — Network size

**What it measures:** The number of I-nodes currently in the argument network at the end of this round.

**Role in phasing:** Network size is a scaling input to several other signals and informs GC (garbage collection) decisions. A network that grows very large (> 80 nodes) can degrade extraction quality — the context window fills with claim-tracking data — and may trigger a GC event.

**What to look for:** Network size that grows steadily every round without any GC events in a long debate may indicate the GC threshold is set too high for the debate's configured scope.

---

## Predicate actions

After reading all signals, the predicate returns one of five actions:

### `stay`

No transition. Signals are within normal range for the current phase; continue accumulating turns. The most common action in any given round.

### `advance`

Move to the next phase. Triggered when the current phase's exit conditions are met — typically saturation and convergence crossing thresholds specific to that phase transition. A highlighted row (amber background) in the telemetry table marks when `advance` fired.

### `regress`

Return to a prior phase. Triggered when quality signals indicate the debate has backslid — typically when convergence drops sharply (agents have diverged after a period of engagement) combined with saturation falling (previously addressed cruxes are now contested again). After a regression, the exit threshold for the affected transition is **ratcheted up** — the bar is higher to advance through the same transition again. The `regressions` section of the Adaptive Staging tab shows which cruxes triggered each regression and the new threshold.

### `force`

Override normal flow and advance regardless of signal state. Used when the engine determines the current phase is unproductive — for example, confrontation has run for many rounds without saturation rising, suggesting agents are stuck. The `forces_fired` stat card counts forced transitions. A high force count relative to total phases means the engine is working around stalled signals rather than flowing through them naturally.

### `veto`

Block an advance that the signals would otherwise trigger. Used when the engine determines conditions aren't safe to advance despite signals crossing threshold — typically when `Conf` (confidence) is too low to trust the signal readings, or when a cooldown period has not elapsed since the last transition. The `vetoes_fired` stat card counts vetoed transitions.

---

## Confidence deferrals

A **confidence deferral** occurs when the predicate would have returned `advance` based on saturation and convergence, but global confidence is below the deferral threshold. Instead of advancing, the predicate returns `stay` and increments the deferral counter.

Deferrals are healthy in small numbers — they mean the engine is being appropriately cautious when signal data is noisy. A high deferral count (relative to total rounds) suggests the extraction pipeline is struggling: check the Draft tab for repeated quality gate failures, or check model availability logs if a backend was degraded during the debate run.

---

## GC events — Argument network garbage collection

When the argument network grows large, the engine prunes low-value nodes to keep extraction context manageable. A **GC event** removes I-nodes that meet pruning criteria:

- Computed QBAF strength below a floor threshold (effectively defeated and no longer influencing the graph)
- No outgoing or incoming edges (isolated nodes that no other claim references)
- Age above a recency threshold (very old nodes from early rounds that have not been re-engaged)

The GC Events section shows:
- **Round** — when the GC ran
- **Before / After** — node count before and after pruning
- **Pruned** — how many nodes were removed

GC does not affect claims that have been committed to the commitment ledger — only their AN representation is removed. The claim still exists in the transcript and the commitment record.

**What to look for:** GC that runs frequently and removes many nodes each time may indicate the network is growing faster than the debate is resolving — agents are adding claims without attacking enough to reduce the effective network size. Check the CA-edge-to-I-node ratio in the Argument Network tab.

---

## Regressions

A regression entry records:
- **Round** — when the regression was detected
- **Crux** — which crux triggered it (the crux whose saturation status reversed)
- **Threshold after** — the new, higher saturation threshold required to advance through this transition again

Regressions are rare in well-configured debates. A debate with multiple regressions on the same crux suggests agents are repeatedly engaging and then abandoning that crux — a sign the crux may be underspecified or that the agents lack adequate taxonomy grounding for it.

---

## Downloading signals JSON

The "Download Signals JSON" button in the Adaptive Staging tab exports the full `adaptive_staging_diagnostics` object as a JSON file. This contains:

- `phases` — the complete phase timeline with round ranges and exit reasons
- `signal_telemetry` — every per-round signal reading including the full `signals` object (not just the columns shown in the table), the raw confidence components, and the full predicate result
- `gc_events`, `regressions`, and summary stats

For debates longer than ~20 rounds, the JSON is more practical than the in-app table for finding patterns — it can be loaded into a notebook or queried with `jq`.

---

## Common diagnostic questions

**Why did the debate stay in confrontation so long?**  
Check Sat column in telemetry. If saturation was low for many rounds, agents weren't attributing claims to cruxes. Filter the Argument Network to "Attributed only" and check whether the attributed nodes are actually on crux topics. If few are, the crux set and the debate topic may be misaligned.

**Why did the debate advance without fully resolving cruxes?**  
Check whether a `force` action fired. If so, the engine overrode the normal advance conditions. Also check the Gaps overview tab — unaddressed cruxes at end-of-debate are visible there.

**Why was a transition vetoed?**  
Find the veto row in telemetry (it will show `action: veto`). Check the `Conf` value in that row — confidence below threshold is the most common veto cause. Also check `veto_active` in the predicate result (included in the JSON export).

**Why did the debate regress?**  
Find the regression entry in the Regressions section. Note the crux ID, then filter the Argument Network to that crux's taxonomy node ID to see what happened to the claims referencing it in the rounds around the regression.
