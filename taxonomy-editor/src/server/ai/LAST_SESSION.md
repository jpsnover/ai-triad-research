**Date:** 2026-07-11
**Working on:** t/1515 (NLI 500 timeout), t/1516 (embeddings 87s latency), t/1432 (keyRotator removal), t/1262 (UsageID migration)
**Status:** all complete — 31668cf9 (t/1515+t/1516), 87e65207 (t/1432), a2ee118a (t/1262)
**Key context:** classifyNli timeout now 30s (was 120s); computeEmbeddings has 45s request-level withTimeout; keyRotator fully deleted; generateText uses single-key withRetry only
**Next:** no unblocked tickets; check queue on next session start
