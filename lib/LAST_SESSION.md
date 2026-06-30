**Date:** 2026-06-30
**Working on:** Completed t/1218 (rate-limit header parsing) and t/1219 (per-request cost + budget caps)
**Status:** Complete — both tickets done, verify gate clean (4675 tests), DebateTool notified
**Key context:** New exports: `parseRateLimitHeaders`, `RateLimitHeaders`, `estimateCost`, `ModelPricing`. `ProviderResult.estimatedCostUsd` and `GenerateOptions.maxCostUsd` are additive — no breaking changes
**Next:** Check ticket queue for new work
