**Date:** 2026-07-06
**Working on:** t/1298 (ADR-001/003 compliance for PO/SV), t/1331 (embedding resolver extraction)
**Status:** Both done. t/1298 committed as 369a8e6b, t/1331 committed as f1c9a1da. No unblocked tickets remaining.
**Key context:** lib/embeddings/embeddingResolver.ts provides resolveEmbeddings() — cache lookup + fallback chain. All three embedding call sites (TE main, TE server, SV main) rewired. TE server's local EmbeddingsFile type removed in favor of shared import.
**Next:** Check ticket queue for new assignments.
