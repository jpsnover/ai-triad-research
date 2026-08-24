# t/2947 (c) — Block-flip real-data evidence

The (c) half of the edge-rationale Block-flip Gate Verification package: the `ba3128f5`-as-HEAD
positive clean cycle run against the flip head. Kept here so the GV evidence is re-runnable
rather than existing only as numbers quoted in a ticket comment.

## Heads under evidence

| What | Commit |
| --- | --- |
| Guard code (PR #1435, `default → Block`) | `775537b30c1fafe0c58039fb6df5a3df69305825` |
| `ai-triad-data` baseline (HEAD for the run) | `ba3128f51de23cbbed47703ab899c0cef6120bf7` |
| Guard file blob | `40870ae92b8ce3bd70de9c22e3b3e916e6e5f612` |

Head discipline (TL e/120#48): the evidence head **is** the flip head. The guard is dot-sourced
from a worktree pinned at that OID — not from `main`, and not from a predecessor.

## Files

- `run-c-evidence.ps1` — the (c) harness. Four arms: clean (uncached), clean (cache hit),
  deliberate-strip (expects the Block throw), and the emptied-array/missing-key message split.
  18 assertions.
- `probe-delta.ps1` — two delta-re-review probes. **P1** reconciles rationaled *edges* against
  distinct rationaled *keys*. **P2** tests whether a committed-but-empty `edges` array fails open
  silently (it does — filed as t/2953).
- `c-evidence-transcript.txt`, `probe-transcript.txt` — captured output of the runs quoted in
  t/2947.

## Re-running

Both scripts take `-CodeWt` and `-DataWt` (paths to worktrees pinned at the two commits above);
the defaults point at the throwaway worktrees used for the original run, so pass your own:

```powershell
git -C <ai-triad-research> worktree add -b <branch> <code-wt> 775537b3
git -C <ai-triad-data>     worktree add -b <branch> <data-wt> ba3128f5

pwsh -NoProfile -File run-c-evidence.ps1 -CodeWt <code-wt> -DataWt <data-wt>
```

Exit code is the number of failed assertions (0 = PASS). The harness unsets
`AI_TRIAD_EDGE_RATIONALE_GATE` so it exercises the *default* mode, which is the thing under test —
setting the mode explicitly would prove nothing about the flip.

Neither script writes to `ai-triad-data`: the strip arm mutates an in-memory copy of the payload,
and P2 builds its own throwaway git sandbox under `TEMP` and deletes it.

## Results (2026-08-23, three replications, all PASS)

Clean arm: baseline resolved to **33,445** rationaled keys; payload scanned **33,454** checked /
**0** skipped; returns 0, zero warnings, no throw. Strip arm: throws `New-ActionableError` with all
four fields. Split: `payload scanned` and `no edges KEY` are non-overlapping.

Wall clock: ~6–10s uncached (the `git show HEAD:` + parse of an 18.6 MB file), ~2–3s on the cache
hit — the per-run HEAD-baseline cache is doing its job.

**On the 33,448 vs 33,445 gap** (P1, empirical): the baseline carries 33,448 edges with a rationale
but only **33,445 distinct** `source|type|target` keys — 3 keys carry 2 edges each
(`acc-beliefs-051|SUPPORTS|acc-desires-001`, `acc-beliefs-069|SUPPORTS|acc-intentions-054`,
`acc-intentions-100|SUPPORTS|acc-beliefs-039`). The guard counts *keys*, so 33,445 is correct and
the 3-edge difference is the known near-key collision (CL e/120#30) showing up in the count, not a
lookup failure.
