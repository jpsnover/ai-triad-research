# Op-ed readability + coherence baseline (t/3696)

**Owner:** Computational Linguist. **Provenance:** readability = `derived`; coherence = `heuristic-proxy`. **Threshold:** none (report distribution first).

Readers complain the op-eds are hard to read AND hard to follow the argument. Those are two different defects. This instrument measures both over the corpus, so the fix (t/3696: measurable prompt constraints + a targeted edit pass) has a baseline and an A/B ground truth.

## Run

```
python measure_oped_quality.py            # writes oped-quality-baseline.json
python measure_oped_quality.py --quiet
```

Reads `<data_root>/oped-sets/*.json`. Data root resolves via `--data-root` > `AI_TRIAD_DATA_ROOT` > `.aitriad.json` > sibling fallback.

## Baseline (2026-09-28, 42 slots across 21 sets)

### Data-quality finding (surfaced first)
**10 of 42 op-ed slots (24%) have empty bodies** (0 words). These are failed/draft generations; each scores a spurious FK grade of about -15, so they are excluded from the stats below and reported as their own signal. **This is worth routing to whoever owns op-ed generation** - a quarter of the slots produced nothing. All figures below are over the **32 substantive op-eds**.

### Axis 1 - Readability (derived, deterministic)

| Measure | median | mean | max | note |
|---|---|---|---|---|
| **FK grade** | **13.4** | 12.2 | 17.9 | target 9-12; **20/32 (62%) over the grade-12 ceiling** |
| avg sentence length | 17.2 | - | 49 | words; long sentences pack multiple claims |
| max paragraph words | **99** | - | **477** | the "3-4 sentence rule gamed by long sentences" case |

By POV (FK median): **saf 15.4** (densest), skp 13.6, acc 12.4. The safetyist camp reads hardest.

The prompt's "3-4 sentences per paragraph" rule is satisfiable by *fewer, longer* sentences - median max-paragraph is 99 words (one op-ed hits 477 in a single paragraph). A word cap is the honest complement to the sentence-count rule.

### Axis 2 - Coherence proxies (HEURISTIC - not validated metrics)

Flow cannot be measured as cleanly as readability (no cheap deterministic ground truth). These are narrow, high-precision / low-recall proxies for specific observed failures, reported as diagnostics that inform the edit pass and spot-checks - they do **not** gate.

- **dangling numeric reference**: a demonstrative + quantity noun ("that number", "this figure") with no numeral anywhere earlier in the body. Caught **1/32** - the grade-17.9 skeptic piece ("That number is right and it's ugly" with zero digits before it). Low recall by design (misses non-numeric dangling refs like "this shift").
- **crammed paragraphs** (>4 sentences OR >90 words): **median 3 per op-ed, max 10**. This is the more useful flow signal - most op-eds carry several over-stuffed paragraphs, the "multiple unconnected claims per paragraph" pattern.
- paragraph-initial demonstratives: reported as a soft back-reference signal.

**Honest limit:** the mechanical coherence proxies are weak (dangling caught only the one clear case). Real flow assessment needs the LLM-judge read (an *unvalidated judge* per the provenance register - informs, does not gate) plus human spot-check. The crammed-paragraph count is the most actionable mechanical signal.

## What this baseline is for (t/3696 remediation)

1. **Calibrates the measurable prompt constraints** - the numbers to put in the system prompt (FK 9-11, sentence < 18 avg / < 30 max, paragraph < 90 words) come from this distribution, not guesses.
2. **A/B ground truth** - re-run this instrument on generate-only vs generate-then-edit output to prove the edit pass buys readability + flow without costing voice, before it ships as default.
3. **The empty-slot finding** is a separate data-quality issue to route to generation ownership.

## Caveats encoded (never suppressed)

- **Empty bodies excluded, counted.** 24% of slots are empty; including them corrupts the mean (each is FK ~ -15). Reported separately.
- **Coherence proxies are heuristic, not validated.** High precision, low recall; they never gate. An LLM-judge coherence score would itself be an unvalidated judge (provenance register); these are weaker still.
- **No pass/fail threshold.** Derived distribution metric; a blocking cut is a separate, deliberate decision validated against a labeled readable/unreadable set.
- **FK is a proxy for reading ease, blind to flow.** A grade-9 text can still be incoherent; this is exactly why axis 2 exists and why the edit pass must do coherence work, not just sentence-shortening.
