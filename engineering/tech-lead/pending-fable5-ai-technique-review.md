# Pending ticket — Orca disconnected at time of request (2026-07-08)

**Status:** Research pass COMPLETE — full report at `engineering/tech-lead/fable5-ai-technique-review-report.md` (2026-07-08). Orca MCP tools were disconnected when this was requested and are still disconnected — file this as a real ticket (or a batch of follow-up tickets per the report's ranked recommendations) the moment Orca reconnects. Content below is the original scoping request; the report itself supersedes it as the actual findings.

---

**Title:** Research review: audit AI/computational-linguistics technique choices across the project (Fable 5 pass)

**Requested by:** Jeffrey Snover, 2026-07-08

**Description:**
Cross-cutting review of every place the project uses an LLM/AI call or a computational-linguistics technique. Three questions per site:
1. Is an LLM/AI call the appropriate tool for this specific task at all, or would a classical NLP / statistical / rule-based / specialized-model technique be more appropriate (accuracy, determinism, cost, latency)?
2. Where an LLM is the right tool: is the specific technique/algorithm/model/prompting strategy in use the best currently available option? Requires researching prior art — how do established tools/papers solve this same problem.
3. Concretely: are there areas currently using LLMs where the owner could/should switch to an alternative technique?

**Known AI/NLP usage sites to inventory (starting list, not exhaustive — the review should find more):**
- Debate engine (`lib/debate/`) — three-agent BDI debate generation, 65+ prompt builders, quality scoring (`Measure-DebateQuality` / `qualityScore.ts`)
- Document ingestion/summary pipeline — `Invoke-POVSummary`, `Invoke-AttributeExtraction`, chunk merging
- Embeddings — all-MiniLM-L6-v2 384-dim (`embeddings.json`) for semantic search/similarity
- Edge discovery (`Invoke-EdgeDiscovery`) — candidate edge extraction from text
- BDI weight assignment (`Invoke-BDIWeightAssignment`)
- Edge weight evaluation (`Invoke-EdgeWeightEvaluation`)
- Vernacular generation (`Invoke-VernacularBatch`)
- Ingestion priority scoring (`Get-IngestionPriority`)
- QBAF conflict analysis (`Invoke-QbafConflictAnalysis`) — worth confirming this is already rule-based/formal-argumentation and not silently LLM-backed where it shouldn't be
- Organization/POV alignment scoring (`Find-OrganizationByPOV`)
- Synthetic corpus generation (`New-SyntheticCorpus`)
- Metric provenance register (t/1343, Computational Linguist) — cross-reference, related recent work

**Acceptance Criteria:**
1. Full inventory posted: every AI/LLM call site + current technique/model used
2. For each site: LLM-appropriate? Y/N + reasoning
3. Where LLM is appropriate: best-technique assessment with researched prior art / alternatives cited
4. Concrete recommendations per site: keep as-is / switch technique / switch model — with effort-to-change and risk noted
5. Executive summary ranking recommendations by impact/effort

**Suggested owner once filed:** Computational Linguist (natural domain owner) — TL commissioned the first pass directly via Fable 5 per owner's explicit request; ticket should track/host that output once Orca is back.
