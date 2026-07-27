# DebateTool — File Inventory

Reference index of the key modules in `lib/debate/` (the debate engine core). **Reference only** — behavioral norms, conventions, and testing/parent-role guidance live in [AGENTS.md](./AGENTS.md). This index drifts as the tree evolves; it is also discoverable via directory listing, `resolve_owner`, and `REPO_MAP.md`.

## Key Modules

| File | Purpose |
|------|---------|
| `debateEngine.ts` | Core debate orchestration (turns, rounds, synthesis) |
| `orchestration.ts` | Moderator selection, turn retry logic (shared by engine + renderer) |
| `turnPipeline.ts` | Per-turn 4-stage pipeline (Brief → Plan → Draft → Cite) |
| `argumentNetwork.ts` | Incremental argument graph extraction and mapping |
| `qbaf.ts` | QBAF strength computation, Shapley attribution |
| `counterfactualCrux.ts` | CE-QArg counterfactual argument removal analysis |
| `convergenceSignals.ts` | Anti-sycophancy and convergence detection |
| `phaseTransitions.ts` | Adaptive phase transition logic and signal evaluation |
| `strategicHints.ts` | Opponent-aware strategic hints from AN + commitments |
| `doctrinalAnchoring.ts` | Doctrinal boundary embedding and confidence flooring |
| `cruxRegistry.ts` | Cross-debate crux persistence and retrieval |
| `documentAnalysis.ts` | Document pre-analysis (i-nodes, taxonomy mapping, tension points) |
| `aiAdapter.ts` | AI backend abstraction for debate/chat calls |
| `prompts.ts` | 27+ prompt templates for debate AI calls |
| `types.ts` | Core type definitions (DebateSession, claims, synthesis) |
| `taxonomyTypes.ts` | PovNode, SituationNode, edge types (canonical for all apps) |
| `taxonomyContext.ts` | BDI-structured taxonomy context formatting |
| `taxonomyLoader.ts` | Load taxonomy data from disk |
| `harvestUtils.ts` | Promote debate findings into taxonomy |
| `debateTested.ts` | Debate-tested harvest writer + tier/sort-key computation (t/1523) |
| `calibrationLogger.ts` | Calibration data collection |
| `calibrationOptimizer.ts` | Calibration parameter optimization |
| `cli.ts` | CLI runner for debates |
