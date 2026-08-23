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

Both-arms + false-positive check against a **35-row CL-labelled sample** (`labelled_sample.json`:
30 clean incl. a same-scale paraphrase and referent-free-but-substantive controls; 6 constructed
degraded; observed cases labelled `observed`, constructed `constructed` per t/2294):

```
$ python detect.py --validate labelled_sample.json
  degraded flagged (TP): 6   missed (FN): 0
  clean quiet   (TN): 30   false-flagged (FP): 0
  BOTH ARMS: PASS
```

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
```

## Files

- `detect.py` — the detector (signals + baseline/diff/validate modes).
- `labelled_sample.json` — the CL-labelled validation sample (both arms + FP controls).
- `build_sample.py` — regenerates `labelled_sample.json` from real `ba3128f5` data + constructed cases.

## Follow-up

- **Restore-verifier arm (t/2948 AC#2)** — "run against the restore output (t/2946)" is **not
  satisfiable yet**: t/2946 (the 33k restore) is Backlog, blocked by t/2945 + t/2957 + t/2958. This
  harness lands the live-baseline + both-arms now; the restore-verifier run fires as `--diff HEAD
  restored` when t/2946 unblocks. Tracked on t/2948.
- **Provenance upgrade** — the validation labels are CL-expert (agent)-authored. A PI/human relabel
  of the sample upgrades the register class from `derived` to `human-validated`; the threshold
  *values* are corpus-derived either way.
