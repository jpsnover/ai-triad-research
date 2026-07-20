**Date:** 2026-07-20
**Working on:** Verified fix for `Update-TaxEmbeddings` crash (t/1652) — PowerShell applied Option B guard (commit 5e52f992); `Update-TaxEmbeddings -Verbose` ran clean: 1226 nodes, 316 batches, 4001 embeddings written.
**Status:** Complete. t/1652 verified and closed (t/1652#2). Post-diag tickets t/1653 and t/1654 filed.
**Key context:** BATCH IS GATED — t/1646 hold still in effect (no Invoke-BatchSummary until PowerShell resolves A/B discriminator on density-floor warning / possible key_points data loss in Merge-ChunkSummaries.ps1).
**Next:** Watch t/1646 for PowerShell A/B result. Root-cause A → batch gate lifts. Root-cause B → escalate scope (which chunked docs affected, re-processing needed).
