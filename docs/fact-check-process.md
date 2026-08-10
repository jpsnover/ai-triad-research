# Fact-Checking in the Debate Engine

This document explains what the **Fact Check** card in a debate is telling you: when a
fact-check is triggered, the verdict vocabulary, how the verdict is reached, how it feeds
back into the argument network (QBAF) scores, and how it steers the rest of the debate.

If you arrived here from the bookmark on a Fact Check card, start with
[What the card shows you](#what-the-card-shows-you).

## What the Card Shows You

A Fact Check card is a **system** transcript entry that appears between debater turns. It
verifies a *single* empirical claim that a debater just made. Reading it left-to-right,
top-to-bottom:

- **Verdict chip** — one of five values (see [Verdict Vocabulary](#verdict-vocabulary)).
  The card is tinted by verdict (`supported` green, `disputed`/`false` red, etc.).
- **`Sources: [1] [2] …`** — inline links to the external web sources the grounded search
  consulted. Click a number to open that source; the same list is expanded, with grounded
  spans, under **Show Web Evidence**.
- **Show Web Evidence** — toggles the raw web-search evidence and the numbered source list
  with per-source grounded-span counts and max confidence.
- **Discrepancy row** (only on `partially_accurate`) — names the specific detail that is
  off: a *dimension* (Magnitude / Timing / Attribution / Scope / Existence), a severity
  (minor / major), and a `claimed → actual` delta. This row is **evidence-gated** — see
  [The `partially_accurate` gate](#the-partially_accurate-gate).
- **Checked text** — the exact claim text that was verified (the full claim, even when the
  debater's statement embedded a truncated quote).

The verdict is not just a label — it rewrites the claim's strength in the argument network,
which propagates to every claim that supports or attacks it. See
[How Results Update QBAF Scores](#how-results-update-qbaf-scores).

## Verdict Vocabulary

The shared verdict axis (source of truth: `lib/debate/types/factVerdict.ts`, t/1701) measures
the polarity of the **core** claim. Genus–differentia definitions:

| Verdict | Chip label | Meaning |
|---|---|---|
| `supported` | Supported | Core claim + material details corroborated by the weight of evidence. |
| `partially_accurate` | Partially Accurate | A *support* verdict: direction is right, but evidence identifies a specific, material discrepancy in a detail. **Requires** a complete `discrepancy` object. |
| `disputed` | Disputed | A *contested* verdict: authoritative sources conflict on the central assertion; evidence is mixed, not decisive. Does **not** absorb detail errors. |
| `false` | False | The central assertion is directly contradicted by authoritative sources (direction wrong, decisively). |
| `unverifiable` | Unverifiable | Can be neither confirmed nor denied with the available evidence. This is also the conservative fallback on parse failure or a rejected `partially_accurate`. |

> **Legacy note.** Older data stored `verified`; it is aliased to `supported` **on read**
> via `normalizeVerdict` (no data rewrite). The inline auto-check web-search prompt still
> emits the legacy `verified`/`disputed`/`unverifiable` subset, which is normalized before
> display; the full five-value vocabulary is what the card renders.

### The `partially_accurate` gate

`partially_accurate` is the one verdict a classifier could abuse as a no-lose "mostly right"
default, so it is **structurally gated** (`factCheckValidator.ts`). It is only valid when it
carries a `discrepancy` that both **names the error** (`claimed`) and **sources the truth**
(`actual` + `source`) — all three non-empty. A `partially_accurate` verdict missing any of
those is rejected and downgraded to `unverifiable`, and the rejection is recorded on the
flight recorder. This is why every `partially_accurate` card shows a populated discrepancy
row.

## When Fact-Checks Trigger

Inline fact-checking runs **after claim extraction** on each debate turn
(`verifyPreciseClaims`). A claim is checked only when ALL of these hold:

1. **BDI category is Belief** — only empirical claims are fact-checkable. Desires (normative)
   and Intentions (strategic) are not subject to factual verification.
2. **Specificity is `precise`** — the claim contains specific numbers, dates, named entities,
   or directly verifiable facts. `general` and `abstract` claims are skipped.
3. **A search-capable adapter exists** — `generateTextWithSearch` must be present. This is
   available in the Taxonomy Editor, **not** in the CLI adapter — so CLI-batch-generated
   debates (the calibration corpus) carry no inline fact-checks or evidence by design.
4. **Cap of 2 claims per turn** — at most the first two precise beliefs of a turn are checked,
   to bound API cost and latency.

Everything else — Desire/Intention claims, `general`/`abstract` beliefs, and every claim on
the CLI path — is skipped.

## How the Verdict Is Reached

Two verification paths are tried in priority order per claim:

### Path 1 — Evidence QBAF (preferred, when a source corpus is available)

Uses the project's own source documents as the evidence base (`evidenceQbaf.ts`,
`evidenceRetriever.ts`):

1. **Retrieve** — search the source corpus (`ai-triad-data/sources/`) with hybrid keyword +
   embedding similarity; return top evidence passages with similarity scores.
2. **Classify** — an LLM labels each passage `support` / `contradict` / `irrelevant`, and
   assigns `source_reliability` and `relevance`.
3. **Compute** — build a micro-QBAF (claim node + one node per passage, edges weighted by
   relevance), run DF-QuAD gradual semantics, and emit a continuous `computed_strength`
   (0–1). That value is used directly as the claim's `base_strength`.

The full evidence graph is persisted on the node (`node.evidence_graph`) for post-debate
analysis and the Evidence tab.

### Path 2 — Web-search verdict (fallback, when no corpus resolves)

When the source corpus can't be resolved, the system falls back to a single grounded
web-search call: the model searches the web, returns a verdict + a 1–2 sentence evidence
summary + confidence (`high`/`medium`/`low`), and the grounding citations become the card's
`Sources`.

## How Results Update QBAF Scores

The verdict (or the evidence `computed_strength`) sets the claim's `base_strength`, which then
propagates through the whole argument network via QBAF. Mapping
(`factCheckToBaseStrength` in `argumentNetwork/strength.ts`):

| Path / verdict | Confidence | base_strength |
|---|---|---|
| Evidence QBAF | — | `computed_strength` (0–1, used directly) |
| `supported` | high / medium / low | 0.85 / 0.70 / 0.55 |
| `disputed` or `false` | high / medium / low | 0.15 / 0.30 / 0.40 |
| `unverifiable` | any | 0.50 |

The claim's `scoring_method` is set to `fact_check`, which **overwrites** any extraction-time
score (e.g. a claim the ThinkPRM chain scored 0.70 at extraction can be revised to 0.15 if the
inline check finds it `false` with high confidence).

**Propagation is transitive.** A `supported` claim attacking an opponent's claim drives that
opponent's strength down and boosts the supported claim's own supporters; a `false` claim's
supporters lose credibility with it. Verifying one claim can shift many.

## How Fact-Checks Steer the Debate

- **Transcript visibility** — the fact-check entry sits in the shared transcript, so it enters
  every debater's subsequent context window. A debater seeing `AN-12 [disputed]` knows to
  defend, revise, or drop that claim.
- **QBAF strength display** — a `false`/`disputed` claim shows a very low computed strength;
  debaters on the FIELD-AWARE strategy target weak claims with UNDERCUT / EMPIRICAL CHALLENGE
  moves.
- **Moderator steering** — the moderator's QBAF context surfaces high-strength unaddressed
  claims to direct attention toward, and may CHALLENGE a debater who keeps re-asserting a
  disputed claim.
- **Calibration** — verdicts feed `borderline_claim_survival_rate`: a `disputed`/`false` claim
  that survives the debate un-refuted signals the debate failed to engage available
  counter-evidence.

## Where Fact-Check Fits Among Scoring Paths

Fact-checking is one of several ways a Belief claim can be scored. Priority (highest wins):

```
1. Inline fact-check (verifyPreciseClaims)      — post-extraction, overwrites everything
2. ThinkPRM verification (belief_verification)  — extraction time
3. Evidence QBAF at extraction                  — extraction time
4. Specificity proxy (precise/general/abstract) — zero-cost fallback
5. Generic (0.50)                               — no scoring data
```

---

*Owner: Computational Linguist · AI Triad Research · Verdict vocabulary per t/1701 ·
Last updated: 2026-08-10*
