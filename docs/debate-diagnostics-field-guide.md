# Debate Diagnostics: Field Guide

**Audience:** Researchers and developers who run debates and want to understand what the engine did and why.  
**Related docs:** `debate-system-overview.md`, `debate-diagnostics-proposal.md`, `aif-debate-tool-analysis.md`, `debate-turn-validation.md`

---

## Two views, one data source

Debate diagnostics appear in two places, both reading from the same live debate state:

**Inline panel** — a resizable strip docked at the bottom of the Debate tab. Shows a quick summary of the active debate: topic scope, argument network size, per-turn utility, coverage, and an entry view when you click a turn. Good for monitoring a running debate or doing a fast post-run check.

**Diagnostics window** — a separate always-on-top popout (open via the popout button in the panel or from the Debate tab toolbar). Shows the full inspection surface: all overview tabs, all per-turn tabs, the chat sidebar, and a persistent search bar. Use this for deep debugging — it stays open while you interact with the main window.

The panel and window are synchronized. Clicking a transcript entry in either one selects it in both. The window also receives live IPC updates as a debate runs, so you can watch claims accumulate in real time.

---

## Overview tabs

The left sidebar of the diagnostics window lists overview tabs — debate-level views that span all turns. The inline panel surfaces a condensed version of the most useful ones under its "Overview" mode.

### Transcript

The canonical record: every turn in order, with speaker, content, and turn metadata. Click any row to jump to its per-entry tabs. The `S1`, `S2`, … statement IDs used elsewhere in the window (AN source headers, moderator focus references) map to positions in this list.

### Argument Network

The QBAF argument graph built up turn by turn. See *Reading the Argument Network* (`docs/reading-the-argument-network.md`) for a full walkthrough. Quick orientation:

- **I-nodes** are claims (what was asserted). Each row is one I-node.
- **CA edges** are attacks (rebut / undercut / undermine). Shown in red.
- **RA edges** are supports (inference scheme + warrant). Shown in green.
- The **minimap** at the top provides a spatial overview — nodes cluster by speaker, edges show the attack/support structure.
- The **filter bar** lets you narrow to unattributed claims (no taxonomy anchor), novel arguments (genuinely new, not in the taxonomy), or anchored claims (grounded in a specific taxonomy node).
- **Moderator banners** appear between groups of claims, showing which speaker the moderator selected next and why.

The "Confidence Impact" section at the bottom of this tab (when present) shows which taxonomy nodes had their `confidence`, `priority`, or `operationality` history updated as a result of this debate — the direct link between a debate's arguments and the living taxonomy.

### Utility

Per-agent utility across all turns, displayed as sparklines with a summary card per speaker. Utility is a composite of three dimensions:

| Dimension | What it measures |
|---|---|
| `position_strength` | Mean computed QBAF strength of this agent's undefeated claims (≥ 0.3 threshold) |
| `attack_effectiveness` | Fraction of opponent claims weakened below 0.3 by this agent's attacks |
| `crux_engagement` | Fraction of identified debate cruxes this agent has addressed |

Each bar in the sparkline represents one turn; darker bars are turns where that agent spoke. Click a bar to jump to that turn's entry detail. Trend arrows (↑ ↓ →) summarize the last three turns.

Utility drives the **lookahead gate** — before each turn is committed, the engine simulates the proposed claims against the live argument network and checks that composite utility increases by at least a threshold. If not, the engine generates a revised draft. The Lookahead per-entry tab shows the full gate trace.

### Adaptive Staging

Shows how the debate moved through phases (confrontation → argumentation → consolidation) and what signals drove each transition. See `docs/adaptive-staging-signals.md` for the signal glossary (Sat, Conv, Conf, TC). Useful diagnostic questions this tab answers:

- Why did the phase change when it did? → Phase Timeline, exit_reason column
- Why didn't the debate advance past confrontation? → signal telemetry, check Sat (saturation) and Conv (convergence) stayed low
- What was the peak argument network size before GC? → Peak network stat card, GC Events section
- Were any phase transitions vetoed or forced? → Vetoes / Forces stat cards

The "Download Signals JSON" button exports the full per-round telemetry for offline analysis.

### Reflections

Agent self-summaries produced at reflection checkpoints during the debate. Each agent describes (in its own words) what arguments it has made, what concessions it has acknowledged, and what it intends to pursue. Reflections feed back into subsequent drafts — an agent whose reflection accurately captures its position will generate more consistent subsequent turns than one whose reflection has drifted.

If you see an agent contradicting itself between turns, compare the reflection to the transcript: the gap usually shows up here first.

### Emotional Register

Tracks rhetorical register shifts per turn (e.g., assertive → conciliatory → dismissive). The register taxonomy is defined in `docs/emotional-registers.md`. Useful for spotting when a debate becomes rhetorically repetitive (register stuck on one value for many turns) or when a speaker is consistently using a register inappropriate to their stance.

### Convergence

Shows convergence score evolution over time — how close the debaters' argument centroids are getting. High convergence (> ~0.7) without a corresponding resolution of cruxes suggests the debaters are restating each other rather than engaging. The moderator uses this signal to select speakers and trigger focus interventions.

### Topic Scope

The debate topic's configured scope: the crux set, out-of-scope exclusions, and which taxonomy nodes are in play. This is the ground truth the exclusion guard and scope drift check use. If claims are being flagged as out-of-scope unexpectedly, check here first to verify the scope is what you intended.

### Commitments

The commitment ledger: every claim each agent has explicitly asserted, conceded, or challenged. Unlike the transcript, the ledger persists — a concession made in round 2 is still visible in round 8 even if the transcript has scrolled past it. The moderator uses the ledger to prevent agents from walking back acknowledged concessions.

### Gaps / Grounding / Lineage

- **Gaps** — taxonomy nodes that are in scope but have not been touched by any claim in this debate. A high gap count means the debate is narrower than the configured scope.
- **Grounding** — how well individual claims are anchored to specific taxonomy nodes and source documents. Low grounding = more speculative, less evidence-based debate.
- **Lineage** — which source documents and taxonomy paths contributed to each turn's taxonomy references.

### POV Progression / Prompt Diff / Flight Recorder Context

Developer/diagnostics tabs:
- **POV Progression** — how each agent's position vector has shifted round by round.
- **Prompt Diff** — diffs between successive prompt versions used in the same debate run, useful for understanding how context accumulates.
- **Flight Recorder Context** — the last N entries from the flight recorder at the time of each turn. Use this to correlate debate-level events with system-level events (errors, slow IPC calls, model fallbacks).

---

## Per-entry tabs

Click any transcript row to open its per-entry tabs. These show the full pipeline trace for a single turn: what the engine was told, what it produced at each stage, and what checks it ran.

### Brief

The "situation brief" injected at the start of this turn — a compressed summary of the debate state as of this round, presented to the drafting agent. Shows what the engine considered most salient: cruxes, recent arguments, commitments, and the moderator's focus point. A brief that's too compressed (or missing key context) often explains why a subsequent draft missed the mark.

### Plan

The structured plan the agent produced before drafting: argument structure (point → evidence → taxonomy anchor), rhetorical strategy, and the planned crux targets. Shows `argumentation_structure` items with their taxonomy anchors — click an anchor to expand the taxonomy reference detail inline.

If the draft diverged significantly from the plan, the discrepancy usually surfaces here: the plan asked for specific evidence, the draft generalized it away.

### Draft

The largest and most information-dense tab. Covers the full draft pipeline:

**Draft stage attempts** — if the engine retried the draft (stage retries), all attempts are shown in order. Each attempt shows the raw response, quality gate results, and what triggered the retry.

**Quality gate** — four binary checks the draft must pass:
- `grounded` — at least one claim is traceable to a taxonomy node or source document
- `falsifiable` — claims contain testable propositions, not purely normative assertions
- `engages` — the draft addresses at least one prior argument or crux rather than being purely expository
- `topic_aligned` — the draft stays within the configured topic scope

**Off-scope drift classification** — if topic alignment failed, this section classifies *how* the draft drifted: tangential (adjacent but off-topic), generic (no specificity to the debate topic), or contradictory (directly violated scope constraints).

**Orchestration runs** — the outer retry loop. A single orchestration run contains one or more stage retries. Multiple orchestration runs mean the entire turn pipeline was restarted, typically because the quality gate could not be passed after the stage retry budget was exhausted.

**Turn validation trail** — see the Validation section below.

### Claims

Extracted claims from this turn's final draft: each claim with its BDI category (Belief / Desire / Intention), its `base_strength` (computed from BDI sub-scores), and its taxonomy attribution. Claims that end up as I-nodes in the argument network appear here first. Claims that failed the exclusion guard are marked.

### Evidence

Grounding trace: for each claim, what source documents or taxonomy nodes were retrieved, what similarity scores they had, and whether the claim was considered supported.

### Citations

Source citation details: the specific documents cited in this turn, how they were resolved, and any fallbacks that occurred. See `docs/citation-resolution-design.md` for the resolution pipeline.

### Lookahead

The utility gate that runs *before* the draft is committed. Shows:

**Utility delta gauge** — the composite utility change this draft's claims would produce: `Δu = composite_after − composite_before`. The threshold bar shows what the engine required. Green = passed; red = regeneration was triggered.

**Strategic assessment** — the engine's interpretation of *why* the draft scored how it did: position dilution (new claims drag the mean strength down), attack plateau (agent already has good attack coverage and these claims don't extend it), crux avoidance (many cruxes unaddressed and the draft ignores them), etc.

**Utility breakdown** — per-dimension delta table: `position_strength`, `attack_effectiveness`, `crux_engagement`, `composite`.

**Tentative claims** — the claims that were simulated. Each shows its individual QBAF strength and marginal delta (how much it contributed or detracted from the composite).

**Regen attempts** — if regeneration was triggered, each attempt shows the guidance that was injected ("STRONG FOUNDATIONS" = claims that improved utility in the prior attempt, "DO NOT USE" = claims that dragged it down) and the revised claims. A `low_utility_turn` warning at the bottom means all regen attempts also failed threshold — the engine committed the best available draft anyway, flagged for review.

### Cite

The citation-stage diagnostics: what the engine was asked to support with citations, which citation strategies it tried, and what was ultimately attached.

### Moderator

The moderator's deliberation for this turn: the full candidate ranking (all debaters with their computed strength scores), the selection rationale, the focus point it set for the next turn, any convergence intervention it recommended, and whether the intervention was validated and executed or suppressed.

Key fields:
- `health_score` / `health_components` — the moderator's self-assessed debate quality score and its component breakdown
- `intervention_recommended` / `intervention_move` — whether the moderator proposed an intervention and what type
- `intervention_suppressed_reason` — why a recommended intervention was not executed (cooldown, budget, low confidence)
- `burden_per_debater` — how much argumentative "work" each debater has done (used to balance selection)

### Exclusion

The exclusion guard results for this specific turn. Four sections mirror the `ExclusionGuardTab` overview: claim extraction guard, draft scope check, taxonomy context injection demotion, and situation injection filtering. See `docs/scope-enforcement.md` for what each guardrail does and how to interpret similarity scores.

### Tax Refs

The taxonomy nodes referenced in this turn, with their full detail: label, BDI category, confidence, priority, operationality, and their position in the taxonomy graph. Click any node to expand its connections. This is the bridge between what an agent said and what the taxonomy actually contains.

### Affect

Emotional register classification for this specific turn — which register the model assigned, the confidence, and the prior turn's register for comparison.

---

## The chat sidebar

The diagnostics window includes an AI chat sidebar (right panel, togglable). You can ask natural-language questions about the active debate: "Which agent made the most attacks?", "What cruxes have not been addressed?", "Why did the Safetyist's utility drop in round 4?" The chat has full access to the debate session data and can synthesize across turns in ways that manual tab inspection cannot.

The chat is most useful for:
- Summarizing patterns across many turns ("how did the argument network evolve?")
- Explaining specific diagnostic values ("what does this low convergence score mean for this debate?")
- Identifying what to look at next when you see an anomaly

---

## Common diagnostic workflows

### "Why did the agent repeat itself?"

1. Open **Lookahead** for the repeated turn. Check `strategic_assessment` — "crux avoidance" means the agent's draft missed the cruxes the moderator had flagged, so subsequent turns were also aimed at the same cruxes.
2. Check **Utility** sparkline — repeated turns often show a flat or falling `attack_effectiveness` (agent is reinforcing its own position without landing on opponents).
3. Check **Moderator** for that turn — if `selection_reason` was `lowest_strength`, the moderator was trying to give a trailing agent a chance to recover, which may have broken argumentative flow.

### "Why was a claim flagged out of scope?"

1. Open **Exclusion** for that entry. Find the violation in "Claim Extraction Guard."
2. The violation row shows `similarity_main` (how close the claim is to the intended taxonomy target) and `similarity_exclusion` (how close it is to an exclusion vector). High exclusion similarity = the claim is semantically similar to something explicitly out of scope.
3. Check **Topic Scope** overview tab to verify the exclusion vectors for this debate are what you intended. If the scope is too narrow, widen it in debate configuration.

### "Why did the debate phase change early?"

1. Open **Adaptive Staging** overview tab.
2. Find the transition row in the Phase Timeline and read `exit_reason`.
3. Scroll to that round in Signal Telemetry. Check which signal crossed its threshold: usually `Sat` (saturation — enough cruxes have claims) or `Conv` (convergence — debaters are too close together).
4. If the transition was a `force`, it means the predicate overrode normal flow — check the Forces stat card and find the relevant telemetry row.

### "Why did the moderator pick that speaker?"

1. Open **Moderator** for the turn *before* the one you're questioning (the moderator decision is made at the end of each turn to set up the next one).
2. Read `candidates` — the ranking shows all debaters with their `computed_strength` at that moment.
3. `selection_reason` codes: `lowest_strength` (moderator chose the weakest agent to help them recover), `highest_crux_burden` (agent with most unaddressed cruxes), `round_robin` (default rotation), `intervention` (moderator triggered a specific move).

### "Why does a speaker have a low position score?"

1. Open **Utility** overview tab. Click a low bar in that speaker's sparkline to jump to the turn.
2. In **Argument Network**, filter by that speaker. Check computed strength (QBAF value after edge propagation) vs. base strength (pre-edge value). A big gap means many of their claims are being successfully attacked.
3. In the INodeRow expanded view, look at which attacks are landing (CA edges with high weight targeting this speaker's nodes). The attackers' claims have high computed strength if uncontested.

### "A turn committed with `low_utility_turn` — should I be concerned?"

Not necessarily. `low_utility_turn` means the lookahead gate failed on all regen attempts and the engine committed the best available draft anyway. It's most concerning when it appears multiple turns in a row for the same speaker — that usually means the speaker has exhausted its productive attack surface and the debate needs a moderator intervention or a topic extension. Check **Adaptive Staging** for whether the phase is near its exit threshold; the engine may be about to move on regardless.

---

## Performance notes

The diagnostics window receives state via IPC from the main window. On very long debates (50+ turns), the argument network tab may be slow to render — use the "Expand All" / "Collapse All" toggle to manage rendering load. The minimap degrades gracefully: it switches to a text fallback above 80 nodes to avoid SVG performance issues.

Downloading the adaptive staging signals JSON (button in the Adaptive Staging tab) is the recommended path for offline analysis of long-running debates — the raw JSON contains the full per-round signal history and is easier to analyze in a notebook than the in-app table.
