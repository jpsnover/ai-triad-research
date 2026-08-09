# Utility Function and the Lookahead Gate

**Audience:** Researchers and developers who want to understand how the engine evaluates whether a debater's turn contributes meaningfully, and why turns are sometimes regenerated.  
**Related docs:** `debate-system-overview.md`, `debate-diagnostics-field-guide.md`, `reading-the-argument-network.md`

---

## The core idea

Before committing any debater turn, the engine runs a **lookahead gate**: it simulates what the proposed draft's claims would do to the live argument network and checks whether the result represents a meaningful contribution. If the simulated contribution falls below a threshold, the engine discards the draft, injects targeted guidance, and asks the model to try again.

This prevents a class of failure the engine calls "padding" — turns that add word count without advancing the debate. A debater that keeps asserting "AI governance is important" without attacking specific opponent claims or engaging cruxes will consistently fail the lookahead gate, triggering regeneration.

---

## The three utility dimensions

Composite utility is a weighted sum of three dimensions, computed for each agent independently at each turn.

### `position_strength`

The mean computed QBAF strength of this agent's **undefeated** I-nodes — claims with `computed_strength ≥ 0.3`. Claims that have fallen below 0.3 are excluded from the mean (they are effectively defeated and no longer contribute to the agent's position).

High position strength means the agent's core claims are holding up under attack. Low position strength means most of the agent's claims have been successfully undermined.

**What moves it:** Adding new claims with high `base_strength` and low attack surface raises it. Being successfully attacked across existing claims lowers it. Importantly, adding *weak* new claims (low `base_strength`) *lowers* position strength even without attacks — they pull the mean down. This is what produces "position dilution" in the strategic assessment.

### `attack_effectiveness`

The fraction of *opponent* I-nodes that this agent's attacks have weakened below 0.3.

High attack effectiveness means the agent has successfully undermined its opponents' positions. Zero attack effectiveness means all of the agent's claims are defensive — they reinforce the agent's own position but land no blows on opponents.

**What moves it:** Extracting claims that become CA-edges (attacks) against opponent nodes with high computed strength. An attack on an already-defeated node (computed_strength already < 0.3) does not improve attack_effectiveness — there is no credit for kicking a node that's already down.

### `crux_engagement`

The fraction of identified debate cruxes this agent has addressed. Cruxes are the specific contested questions the moderator has identified as the core of the disagreement — the points that, if resolved, would actually move the debate forward.

High crux engagement means the agent is doing the argumentative work the debate requires. Zero crux engagement means the agent is making claims that are adjacent to the debate topic but not addressing its actual contested points.

**What moves it:** Extracting claims that are semantically similar to (or directly reference) the identified crux nodes. The engine checks crux attribution during extraction, so a claim must be close to a crux in embedding space, not just in surface language.

---

## Weights and composite

All three agents currently use equal weights:

| Agent | `position` | `attack` | `crux` |
|---|---|---|---|
| Accelerationist | 0.33 | 0.34 | 0.33 |
| Safetyist | 0.33 | 0.34 | 0.33 |
| Skeptic | 0.33 | 0.34 | 0.33 |

`composite = 0.33 × position_strength + 0.34 × attack_effectiveness + 0.33 × crux_engagement`

The slight upweighting of `attack_effectiveness` reflects that productive debate requires engagement with opponent claims, not just the accumulation of one's own positions.

These weights are defined in `taxonomy-editor/src/renderer/components/debate-diagnostics/window/types.ts` as `UTILITY_WEIGHTS` and can be tuned per-agent if future calibration warrants different values.

---

## How the lookahead gate works

The lookahead gate runs at the end of each draft stage, before the turn is committed.

**Step 1 — Simulate.** The engine takes the proposed draft's extracted claims (the "tentative claims") and simulates inserting them into a copy of the live argument network. It runs QBAF strength propagation on the resulting graph.

**Step 2 — Measure delta.** It computes `utility_after` for the speaking agent on the simulated graph and compares it to `utility_before` (the current state). `Δu = utility_after.composite − utility_before.composite`.

**Step 3 — Check threshold.** If `Δu ≥ threshold`, the draft passes and is committed. The default threshold is a small positive value — the draft must improve the agent's position, not just maintain it. If `Δu < threshold`, the draft fails.

**Step 4 — Regenerate with guidance.** On failure, the engine runs per-claim marginal analysis to identify which individual claims contributed positively and which dragged utility down. It injects two lists into the next draft prompt:
- **STRONG FOUNDATIONS** — claims from the failed attempt with positive marginal delta; the model is told to build on these
- **DO NOT USE** — claims with negative marginal delta; the model is told to avoid repeating them

**Step 5 — Retry or accept.** The model produces a revised draft. The gate runs again. If the revised draft passes, it is committed. The engine allows multiple regen attempts. If all attempts fail, the best available draft (highest `Δu` across all attempts) is committed anyway and flagged with `low_utility_turn`.

---

## Per-claim marginal delta

Within a single lookahead attempt, the engine can run **per-claim marginal analysis**: it evaluates each tentative claim independently — simulating the network with *just that one claim* added — to measure its isolated contribution.

This produces a `marginal_delta` for each claim: how much composite utility that single claim adds or subtracts, independent of the others. Negative marginal delta on a claim means it is actively hurting the agent's position when added (typically because it introduces a weak node that pulls down `position_strength`, or because it doesn't land any attacks).

Per-claim analysis is what makes the STRONG FOUNDATIONS / DO NOT USE guidance meaningful. Rather than telling the model "your draft was bad, try again," the engine tells it exactly which claims were working and which weren't.

---

## Strategic assessment labels

The Lookahead diagnostics tab produces a plain-language **strategic assessment** from the utility delta breakdown. The labels map to specific patterns:

| Label | Pattern | How to read it |
|---|---|---|
| **Position dilution** | `Δposition < -0.03` and speaker had strong position | New claims are weaker than existing ones — they pull the mean down even without attacks |
| **Position weakened** | `Δposition < -0.03` generically | New claims are undermining existing arguments |
| **Position strengthened** | `Δposition > +0.03` | New claims reinforce the speaker's stance |
| **No offensive impact** | `Δattack ≈ 0` and `attack_before < 0.3` | Claims are purely defensive — no blows landed |
| **Attack plateau** | `Δattack ≈ 0` and `attack_before ≥ 0.3` | Agent already has good coverage; these claims extend nothing |
| **Strong offensive move** | `Δattack > +0.05` | Attacks landed on opponent nodes |
| **Crux avoidance** | `Δcrux ≈ 0` and `crux_before < 0.5` | Many cruxes unaddressed; draft ignores them |
| **Cruxes fully addressed** | `Δcrux ≈ 0` and `crux_before ≥ 0.9` | No new crux territory available — agent is done with cruxes |
| **Crux engagement improved** | `Δcrux > +0.05` | Speaker addressed previously unengaged disagreement points |
| **Pattern: padding** | Failed + `Δposition < 0` + no attacks | Volume without advancement — the canonical regen case |
| **Pattern: marginal** | Failed + `Δu ≥ 0` but below threshold | Slight improvement but not enough — claims need more specificity |
| **Pattern: strong move** | Passed + `Δu > +0.05` | Turn meaningfully advances the speaker's position |

---

## Reading the Utility tab sparklines

The Utility overview tab shows a sparkline per agent across all turns. Each bar is one turn:

- **Darker bars** are turns where that agent spoke. Lighter bars are turns where another agent spoke — utility can still change between a speaker's turns because opponents are attacking their claims.
- **Bar height** is normalized to the maximum composite utility seen across all agents and turns in this debate, so bars are comparable.
- **Clicking a bar** jumps to that turn's per-entry tabs.
- **Trend arrows** (↑ ↓ →) summarize the last three turns: +0.03 or more = rising, −0.03 or less = falling, within ±0.03 = flat.

**Common patterns to look for:**

- An agent whose composite *falls between its own turns* (during turns it didn't speak) is being successfully attacked. Check the Argument Network for CA-edges targeting that agent's claims.
- An agent with consistently rising `crux_engagement` but falling `attack_effectiveness` is engaging the debate's core questions but failing to land offensive arguments — a defensively coherent but strategically weak position.
- An agent with rising `attack_effectiveness` but falling `position_strength` is landing attacks but in the process introducing weak new claims that undermine its own position (position dilution).

---

## `low_utility_turn` — when to be concerned

Every `low_utility_turn` flag means all lookahead attempts failed. Isolated occurrences are expected — a speaker sometimes runs out of productive moves before the moderator rotates. A cluster of `low_utility_turn` flags from the same agent across consecutive turns is a signal worth investigating:

1. **Crux exhaustion** — the agent has addressed all accessible cruxes and has nothing new to bring. Check crux_engagement: if it's near 1.0, this is expected.
2. **Position collapse** — the agent's nodes have been attacked into low computed_strength territory, and new claims on the same topics just continue to dilute. Check position_strength trend.
3. **Topic narrowness** — the debate scope is too narrow for the agent to find productive attack surface. Check the Argument Network for the ratio of CA-edges to I-nodes; a high ratio means most claims are contested, leaving little new territory.
4. **Model drift** — the model is producing claims that are semantically valid but structurally unhelpful (generic, non-falsifiable, unanchored). Check the DraftTab quality gate for repeated `falsifiable=false` or `engages=false` failures.

---

## Relationship to other diagnostic data

**Argument Network** — the computed strength values in the AN are the direct inputs to utility. If you want to understand *why* utility is what it is, the AN is where to look: `position_strength` is computed from the mean of the agent's undefeated nodes; `attack_effectiveness` from how many opponent nodes have been pushed below 0.3.

**Adaptive Staging** — the engine's phase transitions factor in convergence and saturation signals, not utility directly. But persistently low utility across all three agents often correlates with stagnation signals (low saturation, low convergence change) that trigger a phase transition or moderator intervention.

**Moderator** — `lowest_strength` selection by the moderator is a utility-adjacent signal: the moderator reads `computed_strength` on individual nodes to identify which agent's position has been most weakened, then gives that agent the floor to recover.

**Reflections** — agents produce reflection summaries that feed into subsequent turns. An agent with low utility that produces an inaccurate reflection (misidentifying its strongest claims) will continue to generate low-utility turns because the reflection shapes the brief it receives.
