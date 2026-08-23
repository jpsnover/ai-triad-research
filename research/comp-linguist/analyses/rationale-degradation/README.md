# Rationale-degradation harness (t/2948)

Flags the sibling class the t/2945 gate map does **not** cover. All three t/2945 arms
(PS Arm 1 @ `Write-EdgesFile`, the TS write-boundary guard, Arm 2 CI diff) test rationale
**presence** (`IsNullOrWhiteSpace`) — they catch a rationale going *absent*. They are silent on a
rationale **replaced** with non-empty lower-quality text (a truncated fragment, a generic shell),
and the restore byte-safety proof passes it too. Detecting that is a text-quality judgement — CL's.

## Signals (advisory FLAG, not a blocking gate)

Corpus-grounded, deliberately conservative (tuned for zero false positives on real substantive
rationales, because a noisy quality flag is discounted).

- **`short_and_shell`** — `len < 60` **and** `< 6` content words. (Standalone or transition.)
- **`length_collapse`** — new `< 0.5×` old length **and** `< 0.5×` old's content-word count.
- **`referent_loss`** — old carried a node-id/quoted referent, new carries none — **only** when
  combined with content collapse or shell (a concise paraphrase legitimately drops an explicit id).

Length loss or referent loss **alone** is not degradation — a legitimate concise paraphrase is
shorter and may drop a node-id while keeping the content. The content-collapse gate is what
separates a paraphrase from a truncation; it was added after a labelled-sample false positive on an
aggressive-compression control (empirical tuning, t/2294).

### Sensitivity edge — what this detector does NOT catch (t/2964)

Measured, not estimated: a uniform truncation of a median-length rationale was run through
`flag_transition` at every retention level from 90% down to 20%. The detection boundary sits
**between 0.50 and 0.45 retention**:

| retention | char ratio | content-word ratio | signals |
|---|---|---|---|
| 90% → 55% | 0.90–0.55 | 0.92–0.54 | *(none)* |
| **50%** | 0.50 | 0.50 | *(none)* — boundary, not detected |
| **45%** | 0.45 | 0.46 | `length_collapse` |
| 30% | 0.30 | 0.29 | `length_collapse` |
| 20% | 0.20 | 0.21 | `length_collapse`, `short_and_shell` |

**A truncation that retains ≥50% of the text with content words intact is NOT detected.** That is
a deliberate consequence of `COLLAPSE_RATIO`=0.5 (a strict `<`), not an oversight: real revisions in
git history are enrichments, and flagging every mild shortening would make the flag noisy enough to
be ignored. But it means a rationale halved to a still-fluent 55% summary passes silently. Anyone
reading a green `--diff` should read it as "no *collapse*", not "no quality loss".

### Boundary false positive — known and bounded (t/2964)

The 60-char floor is a hard cut, so a **substantive** rationale below it flags. Real example:

```
"Compute scaling underwrites transformative abundance."   # 53 chars, 5 content words
  -> ['short_and_shell']    # false positive: this is terse but substantive
```

Corpus exposure is ~p0.03 (9 of 33,448 rationales are ≤60 chars), so this is a claim-precision
issue rather than a correctness one — but the zero-FP result should be read with it in mind. The
clean controls now reach down to **68 chars** (see below), so the claim is "no FP within ~1.13× the
floor", not the old "no FP within 2× the floor". Below the floor, FPs exist by construction.

## Thresholds — provenance `derived` (register: `docs/metric-provenance-register.md`)

Derived from the **33,448 real `ba3128f5` rationales**: char length p5=130 / median=215 / p90=271;
only 9 (~0.03%) are ≤60 chars; 10% carry a node-id referent. So `SHORT_CHARS`=60 is the ~p0.03
floor. `MIN_CONTENT_WORDS`=6 is floored the same way — content-word counts run p1=9 / p5=11 /
median=18; only 17/33,448 (0.051%) fall below 6, and the gate removes exactly one real rationale
(9→8). The `_STOP` lexicon and ≥4-char token rule defining `content_words` are **stipulated**. Real non-empty→non-empty revisions in git history (3673d3ee→ba3128f5) were **enrichments**
(new ~2× longer), so a *collapse* is the anomaly. NOT derived from the ticket's illustrative strings
("Related.", "This edge supports the target.") — those are illustrations, not observed data.

## Evidence

Both-arms + false-positive check against a **78-row CL-labelled sample** (`labelled_sample.json`:
65 clean, 13 constructed-degraded; 28 `observed`, 50 `constructed` per t/2294). The clean rows
include 25 real standalone rationales, the 3 real enrichment revisions, a same-scale paraphrase, a
referent-free-but-substantive control, **26 non-vacuous diff-mode controls** (t/2963, below),
**6 faithful sub-boundary controls** (t/2965, below), and **3 boundary-adjacent controls**
(t/2964, 68–74 chars); the degraded rows include **5 sub-boundary degradations** (t/2965) and the
**2 signal-isolation rows** (t/2964):

```
$ python detect.py --validate labelled_sample.json
  degraded flagged (TP): 13   missed (FN): 0
  clean quiet   (TN): 65   false-flagged (FP): 0
  signal isolation (t/2964): 2 ok, 0 broken
  BOTH ARMS: PASS
```

### Signal isolation (t/2964)

In the original t/2948 sample every degraded transition landed *below* the 60-char floor, so
`short_and_shell` co-fired on all four — `length_collapse` and `referent_loss` were never observed
firing alone and were therefore **asserted, not validated**. Two above-floor rows now put each
transition signal on the record in isolation:

| row | old → new | char ratio | content words | fires |
|---|---|---|---|---|
| `isolates: length_collapse` | 369 → 92 ch | 0.25 | 33 → 8 | `length_collapse` only |
| `isolates: referent_loss` | 253 → 159 ch | 0.63 | 22 → 7 | `referent_loss` only |

The first is above the floor with a referent-free source, so neither shell nor referent loss can
co-fire. The second **retains 63% of its length** (so the `length_collapse` conjunct is false) and
stays above the floor, but drops both node-ids and collapses content — the "vague filler of similar
length" shape that only `referent_loss` catches.

A row's `isolates` field is a machine-checked claim, not a comment: `--validate` asserts the signal
list equals exactly `[isolates]` and **fails** otherwise, so a future threshold change that lets a
second signal co-fire breaks the build instead of silently reverting to the un-isolated state.
Both arms of that check are proven — falsifying one row's `isolates` value yields
`ISOLATION BROKEN: expected exactly ['referent_loss'], got ['length_collapse']` and exit 1.

### Diff-mode false-positive floor as a distribution (t/2963)

The transition signals (`length_collapse`, `referent_loss`) are the ones AC#2 (the t/2946
restore-verifier `--diff` run) actually uses, yet the only *real* non-empty→non-empty revisions in
git history are enrichments (new ~2× longer) — structurally incapable of tripping a collapse rule,
so near-vacuous as clean controls. So we built **26 faithful same-edge paraphrases** across the
compression band (7 sources × 3 tiers + 5 near-boundary), every one a legitimate rewrite that
**must not flag**. The FP rate is reported as a *distribution over compression ratio*, not a point
estimate (R-1 reasoning) — `diff_fp_sweep.py`:

```
$ python diff_fp_sweep.py labelled_sample.json
  char-ratio band    n  src   FP  FP-rate   content-word retention (min/median/max)
  < 0.50             6    6    0     0.0%   0.50 / 0.57 / 0.63
  0.50-0.60          5    4    0     0.0%   0.55 / 0.58 / 0.70
  0.60-0.70          6    6    0     0.0%   0.47 / 0.67 / 0.70
  0.70-0.80          7    6    0     0.0%   0.70 / 0.72 / 0.82
  0.80-0.95          6    5    0     0.0%   0.80 / 0.93 / 0.96
  >= 0.95            2    2    0     0.0%   0.88 / 0.95 / 0.95
  overall: 32 controls, 0 false positives (0.0%)
  per-source clustering (R-1): 32 draws from 13 distinct sources (2.5 draws/source; …)
  DIFF-MODE FP FLOOR: PASS (0 FP across 0.44-0.97 char-ratio band, n=32 from 13 sources)
```

**What this establishes.** The t/2963 rows all sat at char-ratio ≥ 0.53, so the `length_collapse`
conjunct (ratio < 0.50) was FALSE for all of them — the length∧content conjunction short-circuited
on the length half and was *never exercised*, so that set established only that faithful paraphrases
in the **0.53–0.97** band do not flag (an FP floor *above* the boundary, not the mechanism below it).
The t/2965 `< 0.50` bin closes that gap: **6 faithful sub-boundary controls at char-ratio 0.44–0.49
(length conjunct TRUE) with content-word retention ≥ 0.50 (content conjunct FALSE) all stay quiet
(0 FP)** — the conjunction is now *exercised* and demonstrated, not asserted. The 0.40–0.49 target
band is **stipulated** (chosen by construction); `COLLAPSE_RATIO`=0.5 stays `derived`.

### Characterising the faithful/lossy boundary below 0.5 from both sides (t/2965)

The load-bearing finding is that **below ~0.5 the discriminator is the faithful/lossy (content)
judgement, not the length ratio** — so it is characterised from both sides at the same length band,
not asserted. `detect.py --validate` scores both:

- **Faithful (clean, must stay quiet):** 6 telegraphic compressions of glue-heavy sources at
  char-ratio 0.44–0.49, each keeping ≥ 50% of the source's content words and its node-id/quoted
  referents. Length conjunct TRUE, content conjunct FALSE ⇒ **0 flags**. Empirically these were the
  *only* way to hold retention ≥ 0.5 while pushing char-ratio below 0.5 — a complete, faithful
  rationale resists sub-boundary compression, which is itself the finding.
- **Lossy (degraded, must flag):** 5 genuine degradations that shed the mechanism clause and the
  referents (content retention < 0.5). Two sit **in-band** (~0.46–0.48) to pin the same-length
  comparison against the faithful set — at an identical length ratio, only the content-collapsed one
  flags; three are lower-ratio (~0.25–0.31) mechanism-drop truncations. All 5 flag via
  `length_collapse` / `referent_loss`.

So a flag below ratio 0.5 is a **true positive when content has collapsed and a (correctly avoided)
false positive when it has not** — the earlier "below ~0.5 a flag is correct" conjecture is now
demonstrated to hold *conditional on content collapse*, exactly the conjunction the detector encodes.
All 6 sub-boundary sources are **disjoint from the t/2963 seven** (enforced in
`build_subboundary_rows`), widening the corpus to 13 distinct sources across four camps and four
edge types.

**Independence caveat (R-1):** the 32 clean controls derive from only **13 distinct source
rationales** (2.5 draws/source), so per-bin `n` overstates statistical independence — read the
distribution as ~13 source-anchored families, not 32 independent draws (the sweep prints the
per-source clustering explicitly). The `< 0.50` bin in particular is 6 draws from 6 distinct
sources (1 each) — no within-source clustering there, but n=6 is small; treat the sub-boundary FP
floor as indicative, not a tight bound.

Real baselines (mechanical-flag rate):

```
$ python detect.py --baseline <ba3128f5 edges.json>   # 33,448 rationales
  mechanical-flag: 8  rate=0.024%   # 8 genuinely-truncated real rationales ("The premise", "The acceleration", …)
$ python detect.py --baseline ../../../../ai-triad-data/taxonomy/Origin/edges.json   # live (n=8 rationale-bearing edges)
  mechanical-flag: 0  rate=0.000%
```

The 0.024% at 33k is a real finding: eight pre-existing truncated rationales in `ba3128f5` — the
detector catches real degradation, at a near-zero base rate (no false-positive storm at scale).

## Usage

```
python detect.py --baseline <edges.json>            # standalone flag rate
python detect.py --diff <old.json> <new.json>       # score rationale changes (restore/save diff)
python detect.py --validate <labelled_sample.json>  # both-arms + FP check (exit 0 iff PASS)
python diff_fp_sweep.py labelled_sample.json        # diff-mode FP rate binned by compression ratio
python build_sample.py                              # regenerate labelled_sample.json
python build_sample.py --data-root ../../ai-triad-data   # explicit data checkout
```

`build_sample.py` resolves the data root as **`--data-root` > `$AI_TRIAD_DATA_ROOT` >
`.aitriad.json` `data_root` (relative to the repo root) > the `../ai-triad-data` sibling** — the
same priority as the rest of the project (root `AGENTS.md`, "Two-Repo Split"). No absolute path is
baked in, so it regenerates from any clean checkout or worktree; it exits with a named path and the
three ways to fix it if the data root is missing.

## Files

- `detect.py` — the detector (signals + baseline/diff/validate modes; `--diff` composite-key
  near-key limitation documented inline).
- `labelled_sample.json` — the CL-labelled validation sample (both arms + FP controls, incl. the 26
  t/2963 diff-mode controls, the 11 t/2965 sub-boundary controls, and the t/2964 isolation +
  boundary-adjacent rows).
- `build_sample.py` — regenerates the full `labelled_sample.json` (paths repo-relative; data root
  via `--data-root` / env / `.aitriad.json`). Imports `build_diff_controls` so one command rebuilds
  the whole sample.
- `build_diff_controls.py` — authors the 26 faithful-paraphrase diff-mode controls (t/2963,
  `build_rows`) and the 11 sub-boundary controls (t/2965, `build_subboundary_rows`).
- `diff_fp_sweep.py` — reports the diff-mode FP rate as a distribution over compression ratio,
  including the `< 0.50` bin and per-source clustering (t/2965).

## Follow-up

- **Diff-mode FP floor (t/2963)** — **done**: 26 non-vacuous clean transition controls, 0 FP across
  the 0.53–0.97 compression band (distribution above). This is the calibration that lets the AC#2
  `--diff` output be read as evidence rather than uncalibrated.
- **Sub-boundary characterisation (t/2965)** — **done**: a `< 0.50` bin (6 faithful controls, 0 FP)
  plus 5 lossy sub-boundary degradations characterise the faithful/lossy boundary below 0.5 from both
  sides. The length∧content conjunction is now *exercised* and demonstrated, not asserted; source
  diversity widened from 7 to 13 sources with per-source clustering reported.
- **Restore-verifier arm (t/2948 AC#2)** — "run against the restore output (t/2946)" is **not
  satisfiable yet**: t/2946 (the 33k restore) is Backlog, blocked by t/2945 + t/2957 + t/2958. This
  harness lands the live-baseline + both-arms now; the restore-verifier run fires as `--diff HEAD
  restored` when t/2946 unblocks. Tracked on t/2948.
- **Provenance upgrade** — the validation labels are CL-expert (agent)-authored. A PI/human relabel
  of the sample upgrades the register class from `derived` to `human-validated`; the threshold
  *values* are corpus-derived either way.
