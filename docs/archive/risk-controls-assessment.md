# AI Triad Research: SRE Risk Controls Assessment

**Date:** 2026-04-02
**Framework:** 152 controls across 5 categories from `risk.json`
**Scope:** ai-triad-research (code repo) + ai-triad-data (data repo)

---

## Executive Summary

The AI Triad is a desktop research platform, not a cloud service, which means many SRE controls designed for multi-region, multi-tenant production services are **not applicable** (NA). Of the 152 controls, approximately 65 are applicable to this project's context. Of those, the project has **strong coverage** in error handling, data validation, documentation, and API abstraction; **moderate coverage** in configuration management, CI/CD, and dependency management; and **significant gaps** in testing, observability, security hardening, and data recovery.

### Risk Heat Map

| Category | Applicable | Covered | Partial | Gap | NA |
|---|---|---|---|---|---|
| **Systems** (29 controls) | 14 | 7 | 4 | 3 | 15 |
| **Data Governance** (31 controls) | 18 | 6 | 6 | 6 | 13 |
| **Dependencies** (17 controls) | 10 | 5 | 3 | 2 | 7 |
| **Service Management** (48 controls) | 15 | 5 | 5 | 5 | 33 |
| **Software** (27 controls) | 21 | 10 | 7 | 4 | 6 |
| **TOTAL** | **78** | **33** | **25** | **20** | **74** |

**Overall posture: 42% covered, 32% partial, 26% gap** (of applicable controls)

---

## Category 1: Systems

### Specifications

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:113** Operational characteristics | PARTIAL | CLAUDE.md and AGENTS.md document architecture and module ownership. No formal operational runbook covering fault modes, support model, or environmental constraints. |
| **SRE:CONTROL:211** System documented | COVERED | README.md documents system purpose, user workflows, and value propositions. CLAUDE.md provides comprehensive architecture map. docs/ contains 30+ design documents. |
| **SRE:CONTROL:215** Client best practices | NA | Desktop application, no external client API. |
| **SRE:CONTROL:194** Risk tolerance | GAP | No documented risk tolerance. No classification of which data loss scenarios are acceptable vs. catastrophic. |
| **SRE:CONTROL:183** Criticality | PARTIAL | Data separation plan (docs/data-separation-plan.md) implicitly identifies critical data (taxonomy, summaries, conflicts). No formal criticality tiers assigned. |
| **SRE:CONTROL:182** Threat models | GAP | No threat model documented. Key risks include: API key exposure, prompt injection via source documents, AI-generated content injection, data corruption in taxonomy files. |
| **SRE:CONTROL:083** Risk Rating Scales | NA | No SLOs defined (desktop app, not a service). |

### Integration

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:202** Full recovery | PARTIAL | Git-based recovery is implicit. No documented procedure for recovering from taxonomy corruption, lost summaries, or broken cross-references. |
| **SRE:CONTROL:201** Realistic validation environments | GAP | No staging environment. Development and production are the same local environment. |
| **SRE:CONTROL:094** Cross-team ownership | COVERED | AGENTS.md defines clear role boundaries for PowerShell module, TypeScript apps, shared debate lib, and SRE concerns. |

### Design

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:034** Graceful degradation | COVERED | Multi-backend AI abstraction (Gemini/Claude/Groq) with fallback. Embedding system falls back from local Python to Gemini API. Rate-limit detection with exponential backoff. Debate continues if individual AI calls fail. |
| **SRE:CONTROL:121** No 100% failures | PARTIAL | AI API failure is a single point of failure for all AI-dependent features. Local-only features (taxonomy browsing, editing) continue to work. No offline mode for debates. |
| **SRE:CONTROL:189** Minimal hard dependencies | PARTIAL | Three hard dependencies: Gemini API (primary), local filesystem (data), Electron runtime. Gemini can be swapped for Claude/Groq. No local-only AI fallback for debates. |
| **SRE:CONTROL:196** System cold restarts | COVERED | All state persisted to JSON files on disk. Debate sessions, taxonomy data, settings all survive cold restart. No in-memory-only state. |

### AI Practices

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:073** AI model safety | PARTIAL | ai-models.json documents model registry. Prompts are version-tracked (`generated_with_prompt_version`). No model output quality monitoring. No cost tracking. No freshness validation for model availability. Debate quality rubric exists (docs/dolce-aif-bdi-implementation-plan.md) but is not automated. |

---

## Category 2: Data Governance

### Data Quality

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:064** Data invariant detection | COVERED | JSON Schema validation (pov-taxonomy.schema.json, situations-taxonomy.schema.json). Zod runtime validation in taxonomy-editor. Node ID pattern enforcement (`^(acc\|saf\|skp)-(goals\|data\|methods)-\d{3}$`). |
| **SRE:CONTROL:069** Unneeded data sets | GAP | No mechanism to identify or flag stale data. Orphaned summaries, abandoned source documents, and unreferenced nodes are not tracked. `Get-TaxonomyHealth` partially addresses this but isn't run automatically. |
| **SRE:CONTROL:063** Data reconciliation | PARTIAL | Two-repo structure creates referential integrity risk (code repo references data repo IDs). No automated cross-repo consistency check. We found duplicate children arrays in taxonomy data during this session. |
| **SRE:CONTROL:066** Expected data | PARTIAL | `Measure-TaxonomyBaseline` validates taxonomy metrics. No automated expectation tests for data shape or content. |
| **SRE:CONTROL:062** Freshness SLOs | NA | Research data, not operational. No freshness requirement. |
| **SRE:CONTROL:065** Data distribution & mutations | GAP | No anomaly detection on taxonomy mutations. A bad AI response could silently corrupt node descriptions or embeddings without detection. |

### Data Integrity

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:044** Data recovery procedures | GAP | No documented recovery procedure. Recovery is "git revert" but no step-by-step runbook exists. |
| **SRE:CONTROL:050** Data affected by loss/corruption | PARTIAL | `Find-Conflict` traces claim lineage across summaries. No general-purpose impact analysis tool for "if node X is corrupted, what else is affected?" |
| **SRE:CONTROL:046** Data protection mechanisms | PARTIAL | Git provides versioned backup. No additional backup mechanism. Git and data share fate (both on same machine + GitHub). |
| **SRE:CONTROL:043** Data integrity checking & alerting | GAP | No continuous integrity checks. Schema validation runs on-demand, not automatically. |
| **SRE:CONTROL:040** Data loss/corruption detection | GAP | No checksums on taxonomy files. No automated detection of data corruption at rest. |
| **SRE:CONTROL:045** Dataset RPO/RTO/RWOs | GAP | No recovery objectives defined. |

### Data Provenance

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:070** Data lineage | COVERED | Source documents maintain full provenance chain: `sources/<doc-id>/metadata.json` tracks import date, original URL/path, conversion method. Summaries track `generated_with_prompt_version` and AI model used. |
| **SRE:CONTROL:072** Data set risk exposure | GAP | No risk assessment of data sets. Taxonomy data is the highest-value asset but has no documented protection tier. |
| **SRE:CONTROL:071** Exfiltration of bad data | PARTIAL | TAXONOMY_VERSION bump triggers re-summarization (can regenerate from sources). No rollback mechanism for bad AI-generated data that's already been committed. |

### Data Handling

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:060** Data input validation | COVERED | `Import-AITriadDocument` validates input format. Zod schemas validate taxonomy edits. Document ingestion validates file types. |
| **SRE:CONTROL:055** Data types/layout validation | COVERED | JSON Schema enforces field types, patterns, required fields. TypeScript types enforce compile-time correctness. |
| **SRE:CONTROL:056** Data integrity during releases | PARTIAL | CI runs type checks and module tests on PR. No data integrity validation in release pipeline. |
| **SRE:CONTROL:059** Data deletion delay | GAP | No soft-delete mechanism. Taxonomy node deletion is immediate and permanent. |
| **SRE:CONTROL:054** Data set transactional safety | GAP | No transactional writes. A crash during taxonomy save could leave partial JSON files. |
| **SRE:CONTROL:052** User data safety | NA | No customer/user data. Research data only. |

---

## Category 3: Dependencies

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:004** Dependency maintenance | PARTIAL | package.json tracks dependencies. No SBOM. No deprecation monitoring. Python sentence-transformers has no version pinning in requirements.txt. |
| **SRE:CONTROL:010** Dependency characteristics | COVERED | AI backend characteristics documented in ai-models.json (model IDs, API endpoints). Rate limit behavior encoded in retry logic. |
| **SRE:CONTROL:005** Dependency failure domains | PARTIAL | AI API failure is understood (fallback between Gemini/Claude/Groq). Local filesystem failure is not addressed. |
| **SRE:CONTROL:007** Open Source standards | PARTIAL | MIT license declared. Dependencies are standard npm packages. No formal open-source review process. |
| **SRE:CONTROL:172** Security posture of dependencies | GAP | No dependency vulnerability scanning. No npm audit in CI. |
| **SRE:CONTROL:011** Dependency compatibility | COVERED | Backward-compatible data handling throughout. Optional fields, `?.` chaining, format detection for old/new data (e.g., steelman_vulnerability string vs. object). |

---

## Category 4: Service Management

### Capacity

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:102** Client handling server overload | COVERED | Exponential backoff on Gemini 429/503. RPM/TPM/RPD detection with differentiated retry strategies. `generateTextWithProgress` emits retry progress to UI. |
| **SRE:CONTROL:105** Request flow control | PARTIAL | Rate limit retry with backoff exists. No proactive admission control (will fire all debate turns without checking quota headroom first). |

Most Service Management controls (SLOs, incident response, capacity forecasting, rollout supervision) are **NA** for a desktop research tool.

### Rollouts

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:074** Production changes | COVERED | Git tracks all changes with full history. CI validates on PR. |
| **SRE:CONTROL:075** Progressive rollouts | PARTIAL | TAXONOMY_VERSION phased migration plan documented (docs/dolce-aif-bdi-implementation-plan.md) with phase gates, rollback tags, and migration manifests. Not automated — relies on manual discipline. |
| **SRE:CONTROL:076** Change supervision | PARTIAL | CI runs type checks and tests. No automated canary or validation beyond type safety. |
| **SRE:CONTROL:030** Release automation | COVERED | GitHub Actions release.yml builds and publishes on tag. Cross-platform (macOS/Windows/Linux). |

### Observability

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:091** Historical information | PARTIAL | Debate diagnostics capture per-entry metrics (response time, model, claims accepted/rejected). No centralized storage — diagnostics live inside debate session JSON files. |
| **SRE:CONTROL:085** SLI/KPI monitors | GAP | No SLIs defined. No dashboards. Debate quality rubric exists but is manual. |
| **SRE:CONTROL:112** Anomaly alerts | GAP | No alerting. Console warnings only. |

---

## Category 5: Software

### Security

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:017** Secure development | PARTIAL | TypeScript strict mode. Electron contextIsolation and preload bridge. API keys encrypted via safeStorage. No input sanitization against XSS/injection. No security linter. |
| **SRE:CONTROL:014** RBAC | NA | Single-user desktop application. |
| **SRE:CONTROL:016** Source provenance | COVERED | All code in git with commit history. `generated_with_prompt_version` tracks which AI prompt version produced data artifacts. |

### Testing

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:115** Unit testing | GAP | PowerShell Pester tests exist (module loading, exports). No TypeScript unit tests despite vitest being configured. |
| **SRE:CONTROL:116** Integration testing | GAP | No integration tests for Electron apps. No end-to-end debate flow tests. |
| **SRE:CONTROL:118** Data regression tests | GAP | No regression tests for data processing (summary generation, conflict detection, taxonomy health). |
| **SRE:CONTROL:029** Data telemetry | PARTIAL | Debate diagnostics capture response times and claim acceptance rates. No test coverage reporting. |

### Coding Practices

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:022** Second person review | COVERED | PR-based workflow implied by CI on pull_request trigger. |
| **SRE:CONTROL:025** Obsolete code | PARTIAL | Edge Viewer retired and merged. Some dead code remains (unused imports, stale configurations). |
| **SRE:CONTROL:018** Code analysis tools | PARTIAL | TypeScript strict mode catches type errors. No ESLint enforcement in CI. No security-focused static analysis. |
| **SRE:CONTROL:208** Plausible values | COVERED | Argument network validates claim grounding (>30% word overlap required). Embedding similarity thresholds filter implausible matches. |
| **SRE:CONTROL:120** Information presence | COVERED | Debate engine acts on presence of data: optional fields handled via `?.` chaining throughout. Missing fields produce graceful degradation, not crashes. |

### Compatibility

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:011** Dependency compatibility | COVERED | Extensive backward compatibility handling. steelman_vulnerability accepts string or object. argument_map optional for pre-Phase-3 debates. All new fields optional. |
| **SRE:CONTROL:191** Software ecosystem | COVERED | Standard stack: TypeScript, React, Electron, Vite, PowerShell 7. All widely supported with active tooling ecosystems. |

### Configuration Management

| Control | Status | Finding |
|---|---|---|
| **SRE:CONTROL:012** *-as-code | COVERED | All configuration in version-controlled files: .aitriad.json, ai-models.json, package.json, TAXONOMY_VERSION. No manual server configuration. |
| **SRE:CONTROL:173** Component inventory | PARTIAL | package.json and package-lock.json serve as partial SBOM. No formal SBOM generation. No Python dependency inventory beyond requirements.txt. |

---

## Top 10 Risks (Prioritized)

| # | Risk | Controls | Severity | Effort to Fix |
|---|---|---|---|---|
| 1 | **No threat model** — prompt injection via source documents, API key exposure paths, AI hallucination propagation into taxonomy are unanalyzed | SRE:CONTROL:182 | HIGH | Medium |
| 2 | **No data integrity checking** — taxonomy corruption (e.g., duplicate children we found this session) goes undetected until symptoms appear | SRE:CONTROL:043, 040 | HIGH | Low |
| 3 | **No TypeScript tests** — vitest configured but zero test files. Entire Electron app logic is untested. | SRE:CONTROL:115, 116 | HIGH | High |
| 4 | **No transactional writes** — crash during taxonomy save = partial JSON = data loss | SRE:CONTROL:054 | MEDIUM | Low |
| 5 | **No dependency vulnerability scanning** — npm packages not audited in CI | SRE:CONTROL:172 | MEDIUM | Low |
| 6 | **No input sanitization** — source documents rendered in Electron without XSS protection | SRE:CONTROL:017 | MEDIUM | Low |
| 7 | **No recovery procedure documented** — git is the implicit backup but no step-by-step restore guide | SRE:CONTROL:044 | MEDIUM | Low |
| 8 | **No anomaly detection on AI output** — bad model responses can silently corrupt taxonomy data | SRE:CONTROL:065 | MEDIUM | Medium |
| 9 | **No soft-delete** — taxonomy node deletion is immediate and permanent | SRE:CONTROL:059 | LOW | Low |
| 10 | **No risk tolerance documented** — no classification of which data loss scenarios are acceptable | SRE:CONTROL:194 | LOW | Low |

---

## Recommended Actions (Quick Wins)

1. **Add `npm audit` to CI** (fixes #5, 30 minutes)
2. **Add write-then-rename for JSON saves** (fixes #4, 2 hours) — write to `.tmp`, then `fs.renameSync` to final path
3. **Add `Get-TaxonomyIntegrity` cmdlet** (fixes #2, 4 hours) — validate no duplicate children, no orphan references, no broken cross-cutting links. Run in CI.
4. **Add DOMPurify to Electron renderers** (fixes #6, 2 hours)
5. **Document a 1-page threat model** (fixes #1, 4 hours) — focus on prompt injection, API key exposure, AI hallucination propagation
6. **Document recovery procedure** (fixes #7, 1 hour) — "How to restore taxonomy from git after corruption"
