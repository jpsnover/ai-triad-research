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

## Thresholds — provenance `derived` (register: `docs/metric-provenance-register.md`)

Derived from the **33,448 real `ba3128f5` rationales**: char length p5=130 / median=215 / p90=271;
only 9 (~0.03%) are ≤60 chars; 10% carry a node-id referent. So `SHORT_CHARS`=60 is the ~p0.03
floor. `MIN_CONTENT_WORDS`=6 is floored the same way — content-word counts run p1=9 / p5=11 /
median=18; only 17/33,448 (0.051%) fall below 6, and the gate removes exactly one real rationale
(9→8). The `_STOP` lexicon and ≥4-char token rule defining `content_words` are **stipulated**. Real non-empty→non-empty revisions in git history (3673d3ee→ba3128f5) were **enrichments**
(new ~2× longer), so a *collapse* is the anomaly. NOT derived from the ticket's illustrative strings
("Related.", "This edge supports the target.") — those are illustrations, not observed data.

## Evidence

Both-arms + false-positive check against a **62-row CL-labelled sample** (`labelled_sample.json`:
56 clean, 6 constructed-degraded; 28 `observed`, 34 `constructed` per t/2294). The 56 clean rows
include 25 real standalone rationales, the 3 real enrichment revisions, a same-scale paraphrase, a
referent-free-but-substantive control, and **26 non-vacuous diff-mode controls** (t/2963, below):

```
$ python detect.py --validate labelled_sample.json
  degraded flagged (TP): 6   missed (FN): 0
  clean quiet   (TN): 56   false-flagged (FP): 0
  BOTH ARMS: PASS
```

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
  char-ratio band      n   FP  FP-rate   content-word retention (min/median/max)
  0.50-0.60            5    0     0.0%   0.55 / 0.58 / 0.70
  0.60-0.70            6    0     0.0%   0.47 / 0.67 / 0.70
  0.70-0.80            7    0     0.0%   0.70 / 0.72 / 0.82
  0.80-0.95            6    0     0.0%   0.80 / 0.93 / 0.96
  >= 0.95              2    0     0.0%   0.88 / 0.95 / 0.95
  overall: 26 controls, 0 false positives (0.0%)
  DIFF-MODE FP FLOOR: PASS (0 FP across 0.53-0.97 char-ratio band, n=26)
```

**What this establishes — an FP floor *above* the 0.5 boundary, not a mechanism.** Every control
sits at char-ratio ≥ 0.53, so the `length_collapse` conjunct (ratio < 0.50) is FALSE for **0/26** —
the length∧content conjunction short-circuits on the length half and is *never exercised* by this
set. So these controls do **not** demonstrate the conjunction; they establish only that faithful
paraphrases in the **0.53–0.97** band do not flag. That band is **stipulated** (chosen by
construction to bracket `COLLAPSE_RATIO`=0.5 from above); `COLLAPSE_RATIO`=0.5 itself stays `derived`.

The informative datapoint is the single control at ratio ≈ 0.62 with content retention **0.47**:
content-collapsed, yet quiet only because its length held. That a *faithful* paraphrase can reach
0.47 retention suggests one below ratio 0.5 at similar retention would fire — but whether such a
flag is a true positive (genuine degradation) or a false positive (aggressive-but-faithful rewrite)
is **uncharacterised**: zero controls sit in the < 0.5 region the threshold actually governs. The
claim "below ~0.5 a flag is correct" is therefore **conjecture** (t/2294 — not asserted from run
data), pending the sub-boundary controls tracked in **t/2965**.

**Independence caveat (R-1):** the 26 controls derive from only **7 distinct source rationales**
(3–4 paraphrases each), so per-bin `n` overstates statistical independence — read the distribution
as 7 source-anchored families, not 26 independent draws. Wider source diversity is in t/2965.

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
python build_sample.py                              # regenerate labelled_sample.json (needs AI_TRIAD_DATA_ROOT or default data path)
```

## Files

- `detect.py` — the detector (signals + baseline/diff/validate modes; `--diff` composite-key
  near-key limitation documented inline).
- `labelled_sample.json` — the CL-labelled validation sample (both arms + FP controls, incl. the 26
  diff-mode controls).
- `build_sample.py` — regenerates the full `labelled_sample.json` (paths relative; data root via
  `AI_TRIAD_DATA_ROOT`). Imports `build_diff_controls` so one command rebuilds the whole sample.
- `build_diff_controls.py` — authors the 26 faithful-paraphrase diff-mode controls (t/2963).
- `diff_fp_sweep.py` — reports the diff-mode FP rate as a distribution over compression ratio.

## Follow-up

- **Diff-mode FP floor (t/2963)** — **done**: 26 non-vacuous clean transition controls, 0 FP across
  the 0.53–0.97 compression band (distribution above). This is the calibration that lets the AC#2
  `--diff` output be read as evidence rather than uncalibrated.
- **Restore-verifier arm (t/2948 AC#2)** — "run against the restore output (t/2946)" is **not
  satisfiable yet**: t/2946 (the 33k restore) is Backlog, blocked by t/2945 + t/2957 + t/2958. This
  harness lands the live-baseline + both-arms now; the restore-verifier run fires as `--diff HEAD
  restored` when t/2946 unblocks. Tracked on t/2948.
- **Provenance upgrade** — the validation labels are CL-expert (agent)-authored. A PI/human relabel
  of the sample upgrades the register class from `derived` to `human-validated`; the threshold
  *values* are corpus-derived either way.
