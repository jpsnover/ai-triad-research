# AITriad Cmdlet Reference

Full reference for the `AITriad` PowerShell module (110+ cmdlets). This was extracted from the root `AGENTS.md` to keep per-agent context small — the root now carries only a pointer here.

**Prefer these cmdlets over reading raw JSON files or re-implementing logic in code.** They are faster, cheaper (no LLM call), and tested.

```powershell
Import-Module ./scripts/AITriad/AITriad.psm1   # required first
Show-AITriadHelp                                # browse all cmdlets
Get-Help <CmdletName> -Full                     # full docs for any cmdlet
```

**Canonical parameter names (t/1345):** `-Path` for the input file/directory, `-OutputPath` for the output artifact. Cmdlets whose native param is `ConfigPath`/`DocPath`/`From`/etc. also accept `-Path`; cmdlets whose native param is `OutputFile`/`OutputDirectory`/`OutputDir` also accept `-OutputPath`. Aliases only — the native names still work for backward compatibility.

### Taxonomy Data
| Cmdlet | Use when |
|--------|----------|
| `Get-Tax` | Load full taxonomy (nodes, edges, metadata) |
| `Get-GraphNode` | Look up a specific node by ID |
| `Get-Edge` | Fetch edges (filter by source/target/type) |
| `Get-Policy` | Look up policy actions from the registry |
| `Get-TaxonomyHealth` | Check node/edge counts, orphans, structural issues |
| `Compare-Taxonomy` | Diff two taxonomy states |
| `Test-TaxonomyIntegrity` | Validate referential integrity (see `Test-OrganizationIntegrity` for the Organization slice) |
| `Test-OntologyCompliance` | Check nodes against ontology rules |
| `Get-NodeTestingRecord` | Debate-Tested Phase 2 research surface — filter/sort POV nodes by tier, stale-hash, or importance×deficit (t/1579) |
| `Update-NodeTestingRecord -RecomputeOnly` | Recompute tier + sort_key across all nodes after a constant change; historical record[] never touched; idempotent (t/1579) |

### Organizations (t/1224)
| Cmdlet | Use when |
|--------|----------|
| `Get-Organization` | Look up organization by id or search by name/type |
| `Find-OrganizationByPOV` | Filter organizations by POV alignment score window |
| `Find-OrganizationByTopic` | Find organizations engaged with a specific situation (sit-*) |
| `Get-OrganizationStakeholders` | Get supporters/opposers for a policy action (pol-*) |
| `Import-Organization` | Create or update an organization record (upsert + integrity check) |
| `Compare-OrganizationPositions` | Side-by-side POV alignment table for 2+ organizations |
| `Get-OrganizationEdge` | Look up organization actor-relationship edges (filter by OrgId, Type, Direction; t/1526) |
| `Import-OrganizationEdge` | Upsert an organization actor edge by (source,target,type) composite key with integrity check (t/1526) |

### Entities (t/1804)
| Cmdlet | Use when |
|--------|----------|
| `Get-Entity` | Resolve an entity record (ent-*) from entities.json; follows merge tombstones to the canonical record and stamps `redirected_from` (t/1804) |
| `Import-Entity` | Curation write: upsert 1-20 proposed/approved/deprecated entity records with a never-reused ent-NNN allocator; person records need a human description to approve (t/1804) |
| `Invoke-EntityExtraction` | Phase 1 entity extraction from source_evidence_index.json facts; resolves against existing entities/orgs/taxonomy/dictionary/policy before minting only the unmatched remainder (t/1806) |
| `Get-EntityReport` | Maintenance reports: near-duplicate entities, provenance orphans, dictionary-collision candidates, merge-chain defects (t/1806) |
| `Update-EntityMentionIndex` | Phase 2-B batch re-index: rebuilds the derived `entity_mentions.json` by alias-first, deterministic matching of entities against curated container text (SEI facts + POV nodes). Indexes `-Status` entities only (default `approved`, per §5 / the D1 caller-filters-to-approved contract); widen to `-Status approved,proposed` for an explicit preview before curation. Populated statuses recorded in the envelope's `indexed_status`. Idempotent via per-container `text_sha256`, human mentions win, normalization mirrors the D1 parity contract (t/1894, t/1982) |

### Graph & Conflict Analysis
| Cmdlet | Use when |
|--------|----------|
| `Find-GraphPath` | Find paths between two nodes |
| `Find-Conflict` | Discover conflicts between POV nodes |
| `Invoke-GraphQuery` | Run structured graph queries |
| `Invoke-CypherQuery` | Run raw Cypher against Neo4j |
| `Invoke-QbafConflictAnalysis` | QBAF-based conflict scoring |
| `Show-GraphOverview` | Visualize graph structure |
| `Export-TaxonomyToGraph` | Export to Neo4j |

### Debate Engine
| Cmdlet | Use when |
|--------|----------|
| `Show-TriadDialogue` | Run a three-agent debate (CLI entry point) |
| `Invoke-AITDebate` | Invoke debate programmatically |
| `Resume-AITDebate` | Finish a crashed debate from its -partial.json checkpoint (synthesis + persist tail) |
| `Get-AITDebate` | Load a saved debate by ID |
| `Compare-DebateRuns` | Diff two debate runs |
| `Compare-DebateQuality` | Diff quality scores between two debate runs |
| `Measure-DebateQuality` | Compute quality score for a single debate run |
| `Invoke-DebateBatch` | Run a batch of debates from a config file with live progress |
| `Watch-DebateProgress` | Live-updating table of a running batch's per-debate status (hung detection) |
| `Show-DebateDiagnostics` | Inspect debate internals |
| `Repair-DebateOutput` | Fix malformed debate JSON |

### Sources & Ingestion
| Cmdlet | Use when |
|--------|----------|
| `Import-AITriadDocument` | Ingest a PDF/DOCX/HTML source |
| `Save-AITSource` / `Find-AITSource` | Store/retrieve source records |
| `Get-IntellectualLineage` | Trace a node's source lineage |
| `Get-PovLineage` | POV-specific lineage |
| `Get-IngestionPriority` | Score sources by ingestion value |
| `Invoke-AttributeExtraction` | AI-extract attributes from a source |
| `Invoke-EdgeDiscovery` | Discover candidate edges from text |

### AI Enrichment
| Cmdlet | Use when |
|--------|----------|
| `Invoke-AIByUsage` | Config-driven AI dispatch by UsageID (reads `ai-usages.json`, renders templates, delegates to Invoke-AIApi) |
| `Invoke-BatchSummary` | Batch-summarize documents from the queue |
| `Invoke-POVSummary` | Summarize one document across all 3 POVs (writes `summaries/<doc-id>.json`) |
| `Invoke-BDIWeightAssignment` | Assign BDI weights to nodes |
| `Invoke-EdgeWeightEvaluation` | Score edge weights via AI |
| `Invoke-VernacularBatch` | Generate vernacular descriptions |
| `Invoke-AphorismBatch` | Backfill camp-voiced sober aphorisms (~3-8 words) on POV nodes — presentational only, never a scoring input; skips pillars/deprecated (t/1550) |
| `New-SyntheticCorpus` | Generate synthetic training data |

### Health & Diagnostics
| Cmdlet | Use when |
|--------|----------|
| `Test-TaxEditorHealth` | Production liveness/readiness check (supports `-MaxAttempts` polling for post-deploy waits, t/1491) |
| `Test-TaxEditorEndpoints` | Smoke-test 16 endpoints |
| `Test-AnonymousDebateFlow` | End-to-end smoke test of the anonymous/free-tier user journey |
| `Test-PersonaEndpoints` | Auth-gate regression matrix across anonymous/authenticated/admin personas |
| `Test-ServiceWorkerHealth` | Parse deployed /sw.js for skipWaiting mode, denylist coverage, precache stats |
| `Get-FreeTierStatus` | Live free-tier budget/usage report (live config + token consumption) |
| `Test-AzureHealth` | Azure infra status |
| `Test-GitHubHealth` | GitHub platform + CI status |
| `Test-AIApiKey` | Probe AI backend auth endpoints (no tokens consumed) — confirm a key is present and accepted before running jobs |
| `Test-AIBackendHealth` | Full completion round-trip probe per backend — use before a debate run to surface degraded/unreachable models (t/2212) |
| `Get-ContainerAppRevision` | Query ACA revisions by mode (Active/Stale/Fqdn) — replaces raw `az containerapp revision` calls (t/1498) |
| `New-ContainerAppRevision` | Blue-green: deploy a new ACA revision at 0% traffic; returns real `RevisionName` for the promotion chain (t/1500 Phase 3) |
| `Set-ContainerAppTraffic` | Shift traffic to a named revision with retry — call BEFORE `Disable-ContainerAppRevision` in rollback (t/1500 Phase 3) |
| `Disable-ContainerAppRevision` | Deactivate an ACA revision (stale cleanup or rollback tail); non-fatal on failure — matches deploy YAML's `\|\| true` semantics (t/1500 Phase 3) |
| `Get-ContainerAppDiagnostics` | Combined revision-show + console + system logs for failure triage; polls 30s for logs to appear before declaring unavailable (t/1500 Phase 3) |
| `Get-GitHubWorkflowRun` | Fetch a workflow run + per-job conclusions for a commit SHA or run ID (t/1499) |
| `Remove-StaleContainerImages` | GHCR cleanup — paginate → filter → delete untagged image versions with `-WhatIf` (t/1492) |
| `Get-TaxonomySnapshot` | Fetch the 11-file taxonomy + conflict snapshot from ai-triad-data with commit-SHA stamping (t/1493) |
| `Test-TaxonomyDirContents` | Pre-embedding TAXONOMY_DIR validation — flags files whose `nodes` field would crash `Update-TaxEmbeddings` (dict/null instead of a list of objects); mirrors embed_taxonomy.py skip logic (t/1654) |
| `Get-FlightRecorderDump` | Pull flight recorder from server |
| `Get-LatestFlightRecorderDump` | Find the most recent *non-stub* flight recorder dump (>10KB) for triage — skips the tiny startup/shutdown stubs that can be newer than the real dump (t/1712) |
| `Get-AICostReport` | Token/cost usage report |
| `Get-ViteDevStatus` | Vite dev server diagnostic — port owner, working dir, HTTP health, main/worktree/orphan classification (t/2196) |
| `Get-DebateSessionState` | Read phase, transcript length, run_id, and updated_at from a debate JSON on disk — one-liner for interrupted-turn recovery diagnosis (t/2330) |

### Config
| Cmdlet | Use when |
|--------|----------|
| `Get-TriadConfig` / `Set-TriadConfig` | Read/write runtime config |
| `Register-AIBackend` | Configure AI backend credentials |
| `Test-AIApiKey` | Verify an AI provider API key authenticates (auth-only probe of gemini/claude/groq/openai/azure; no token cost). Use `-All` to sweep every backend with a resolvable key. |
| `Test-AIModelsConfig` | Validate `ai-models.json` — BOM, JSON parse, orphaned model refs in defaults/debateTiers/fallbackChains, incomplete `models[]` entries, and friendly-id-in-`apiModelId` (t/1705). Returns `{Pass; Issues}`; run in a Pester test / CI. |
