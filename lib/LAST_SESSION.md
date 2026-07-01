**Date:** 2026-07-01
**Working on:** t/1259 (UsageID schema + validation) and t/1260 (callByUsage API + discovery)
**Status:** Both complete — commits 9a06c240 and 6239a1df, verify gate clean
**Key context:** New exports: UsageConfig, UsageRegistry, renderTemplate, loadUsageRegistry, validateUsageConfig, callByUsage, getUsage, listUsages, clearUsageRegistryCache, loadModelRegistry. EventType 'ai.call_by_usage' added to flight-recorder. ai-usages.json seeded at repo root.
**Next:** Check ticket queue for new work — 3 downstream migration tickets (PS enrichment, debate pipeline, server endpoints) are now unblocked
