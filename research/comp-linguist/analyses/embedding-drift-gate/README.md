# Embedding composition-drift gate (t/2425)

**Last updated:** 2026-08-10

Prevents the t/2425 incident class — *duplicated-constant drift* between the two
embeddings generators:

- `scripts/embed_taxonomy.py generate` (Python, weighted composition), and
- `taxonomy-editor/src/main/embeddings.ts::updateNodeEmbeddings` (JS, single-field description-only, the de-facto live-corpus maintainer).

They silently diverged once (the Python default was 0.8/0.2 while the live corpus
became description-only), and only a manual splice tripped over it. This gate makes
a future divergence **fail a check** instead.

## What it checks

`check_composition_drift.py` re-encodes N sampled nodes **per the DECLARED
`field_weights` in the embeddings.json envelope** and asserts cosine ≥ 0.9999 vs
the shipped vectors. If declared == actual, the generators cannot have diverged
without failing here.

### Environment-drift vs composition-drift (distinguished — t/2425#4)

A CI runner whose encoder can't reproduce the corpus would false-fail. So a
**CONTROL** runs first — re-encode per the known-canonical composition
(description-only):

| CONTROL (canonical) | TEST (declared weights) | Meaning | Action |
|---|---|---|---|
| fails | — | **environment drift** — runner not reproducible | warn, **exit 0** (never blocks) |
| passes | fails | **composition drift** — envelope ≠ actual vectors | `--mode blocking` → exit 1; `advisory` → warn |
| passes | passes | aligned | exit 0 |

So `--mode blocking` **auto-degrades to advisory on environment drift** — it only
ever blocks on a genuine composition mismatch.

## Usage

```bash
# live drift guard (CI): blocks only on real composition drift
python check_composition_drift.py --taxonomy-dir "$AI_TRIAD_DATA_ROOT/taxonomy/Origin" --mode blocking

# Gate Verification / health check: proves BOTH arms in the current environment
python check_composition_drift.py --taxonomy-dir "$AI_TRIAD_DATA_ROOT/taxonomy/Origin" --selftest
```

`--selftest` runs the clean arm (declared weights reproduce → pass) and a
failure arm (a deliberately-planted 0.8/0.2 composition **must** be detected as
drift). Exit non-zero iff the gate itself is broken (missed the plant or
false-flagged clean). Running it in CI is how we prove both arms *in the CI
environment* before trusting `--mode blocking`.

## Exit codes

`0` pass / advisory / selftest-ok · `1` composition drift (blocking) · `2`
usage/load error (warn) · `3` selftest failure (gate broken).

## Related

- t/2408 byte-stability gate (the splice-time ancestor of this check).
- Metric-provenance register row 59 (canonical composition = description-only).
- The canonical is pinned on the generator side by `scripts/embed_taxonomy.py`
  `DEFAULT_FIELD_WEIGHTS = (1,0,0,0,0)` (t/2425).
