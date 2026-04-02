# AI Triad Research — Project History

A narrative record of significant decisions, shifts, and milestones. Not a changelog — read this to understand *why* the project is the way it is.

---

## 2026-04-02 — Node ID space migration planned

The last piece of terminology debt: the node IDs themselves. When the BDI migration shipped, ID slugs like `acc-goals-001` were deliberately preserved to avoid a data migration. The Situations migration similarly kept the `cc-` prefix. Now the team is ready to finish the job — `goals`→`desires`, `data`→`beliefs`, `methods`→`intentions`, `cc-`→`sit-` across ~15,000 instances in ~1,800 files, the largest migration in the project's history (t/78). The key innovation is Phase 0: before touching any IDs, the team will centralize the 26 separate sites that detect or parse ID prefixes into a single module. This means Phase 2's actual migration becomes a single-constant change rather than a 26-file shotgun edit — an architectural improvement that pays for itself during the migration and permanently reduces prefix-handling fragility. A permanent `normalizeNodeId()` safety net will handle any legacy IDs encountered in external data. TAXONOMY_VERSION bumps to 3.0.0. Plan in e/13.

## 2026-04-02 — Prompt Inspector Phase B shipped — prompt pipeline fully user-controllable

The Prompt Inspector is now feature-complete. Phase B (t/72) delivered the configuration controls that Phase A's read-only view was building toward: cosine similarity thresholds, max node counts, BDI category toggles, vulnerability and fallacy caps, policy limits, temperature, model selection, and response length — all configurable per-prompt with live volume and token count updates as sliders move. Settings persist per debate/chat session with workspace-level defaults as fallback. This closes the loop on the original user request: the ability to see *and* configure how AI prompts are assembled. The journey from "prompts are a black box" (before Phase A) to full transparency and control took three building blocks: Relevance Engineering (made parameters tunable in the backend), Phase A (made the pipeline visible), Phase B (put controls in the user's hands). Phase C (live auto-select during debates, token budget visualization) is deferred as polish.

## 2026-04-02 — Prompt Inspector Phase A shipped

The read-only Prompt Inspector is live. Users can now see exactly what the AI sees — all 27 prompt templates browsable by group (debate setup, debate turns, analysis, moderator, chat, taxonomy, research, PowerShell backend), each showing its data pipeline and raw template with highlighted placeholders. The "Generate Preview" feature assembles a fully rendered prompt using real data from an active debate or chat session, so the user can inspect the exact text before it's sent. This is the transparency layer the project has been missing: until now, prompt assembly was a black box. Phase B (configurable controls for node caps, thresholds, BDI filters) is deferred — it depends on the Relevance Engineering parameters being wired through, which is now complete (t/19), so it's unblocked whenever the team is ready.

## 2026-04-02 — Electron upgrade completed (35 → 41)

All three Electron apps jumped from 35.0.0 to 41.1.1 in a single direct upgrade (not incremental), along with electron-builder 25 → 26. The analysis-first approach paid off: the audit identified only low-medium risk — a clipboard API migration across 7 files and a PDF export fix. All 63 IPC channels verified working. The upgrade eliminated 11 known vulnerabilities, dropping to zero. The team chose a direct jump over incremental version-stepping after the breaking changes audit showed the surface area was manageable. A follow-on toolchain refresh (TypeScript 6, Vite 8, Zod 4) was identified during the compatibility analysis but deferred as a separate epic.

## 2026-04-02 — Ontological compliance epic launched

The project is formalizing its relationship with three academic frameworks it has been informally adopting: DOLCE (genus-differentia descriptions, subsumption), BDI (Belief-Desire-Intention categories), and AIF (Argumentation Interchange Format edge types, node scopes, argument maps). Until now these were conventions documented in AGENTS.md but not enforced — an audit found only 5.8% of node descriptions actually match the genus-differentia pattern the project claims to follow. The new epic (t/36) closes this gap in five phases: schema hardening (Zod schemas that reject non-compliant data), audit tooling (`Test-OntologyCompliance` cmdlet), prompt enforcement (AI prompts that produce compliant output), runtime validation (reject violations on save), and finally data migration to bring existing content into compliance. Phases 1–2 can start immediately; the rest sequence after. This is the project's first serious investment in data quality enforcement as opposed to data generation.

## 2026-04-02 — SBOM cmdlet approved

The project is getting a Software Bill of Materials tool: `Get-AITSBOM` (t/35). This is the first cmdlet that looks *outward* at the project's dependency health rather than inward at its content. It enumerates every dependency across all component types — PowerShell modules, npm packages, Python packages, system tools (pandoc, gs), AI models from the registry, and even JSON schemas. `-CheckUpdates` checks freshness against package registries; `-Update` handles upgrades with confirmation. Output formats include the usual (Table, JSON, CSV) plus industry-standard CycloneDX and SPDX for compliance. Assigned to the PowerShell profile.

## 2026-04-02 — Prompt Inspector approved

A new feature was specced to give the user visibility and control over the AI prompt pipeline. The system currently assembles prompts behind the scenes — injecting taxonomy nodes, vulnerabilities, fallacies, commitments, and other context based on hardcoded thresholds. The user can't see what the AI actually receives, much less tune it. The Prompt Inspector (t/34) fixes this in three phases: first a read-only catalog and preview of all 25+ prompts, then configurable controls (sliders for node caps, similarity thresholds, BDI category toggles), and finally live context-awareness during active debates. It's the user-facing complement to Relevance Engineering — RE provides the scoring engine, the Inspector provides the steering wheel. Blocked by the Situations migration; Phase B additionally blocked by RE. Spec in e/9#2.

## 2026-04-02 — Relevance Engineering completed

All 8 tickets delivered (t/20–t/27). This was the most architecturally significant change to the debate system's AI integration since debates were introduced. The core problem: the formatting layer was flattening scored, structured taxonomy data into undifferentiated text blocks, losing the signal that relevance scoring was meant to provide. The fix touched every stage of context assembly. Taxonomy nodes are now tiered primary/supporting with visual markers. Vulnerabilities are split from fallacies and topic-filtered instead of dumped in bulk. Instructions scale by response length. Policies are filtered to the top 10 by relevance. Established points are prioritized by argument relevance. Document analysis is pre-filtered by embedding similarity. BDI prompt headers use grounded labels instead of generic ones. Eight commits by the Shared Lib profile, all scoped to `lib/debate/`. The Prompt Inspector (t/34) can now expose these as user-configurable controls.

## 2026-04-02 — Cross-Cutting → Situations migration begun

Following the BDI migration's success, the team launched a second large-scale terminology migration: renaming "cross-cutting" to "Situations" throughout the codebase. The motivation is conceptual clarity — "cross-cutting" is developer jargon that describes a structural relationship, while "Situations" better captures what these nodes actually represent: real-world conditions where multiple POVs converge or collide. The scope is larger than BDI: 100+ files, 500+ instances, 7 file renames, a JSON key rename (`cross_cutting_refs` → `situation_refs`), and a public cmdlet rename with deprecation wrapper. The `cc-` ID prefix is deliberately preserved to avoid a data migration. Same 4-phase audit-then-migrate approach that proved itself with BDI. Plan in e/6.

## 2026-04-02 — BDI terminology migration completed

The project's first large-scale terminology migration shipped successfully. The taxonomy's cognitive model categories — previously Data/Facts, Goals/Values, Methods/Arguments — were renamed to Beliefs, Desires, and Intentions to align with the established BDI (Belief-Desire-Intention) framework from agent theory. The migration touched 41+ files and 270+ instances across both repos, executed in four phases: audit, shim layer, bulk rename, shim removal. Node ID slugs (which still contain `goals`, `data`, `methods`) were deliberately preserved to avoid breaking saved data — a pragmatic decision that decoupled display labels from storage keys. Both repos were tagged pre- and post-migration, and `TAXONOMY_VERSION` was bumped to 2.2.0. The full plan thread (e/1) and approval (e/2) document every design decision.

## 2026-04-02 — Orca team stood up; error handling standardized

The project adopted Orca as its AI team management system. Nine profiles were created: four code-owning profiles (Taxonomy Editor, PowerShell, Shared Lib, Orca Support) and five role-based profiles (Technical Lead, SRE, Product Manager, Risk Assessor, Diagnostics, Historian). The team can now communicate via pings and email, with agents waking each other for coordination.

Alongside this, a mandatory error handling standard was established. Two shared utilities — `New-ActionableError` (PowerShell) and `ActionableError` (TypeScript) — enforce structured diagnostics: every unrecoverable error must state its goal, problem, location, and specific next steps. An `error-handling-auditor` subagent was created to enforce compliance incrementally as code is touched.

## 2026-04-02 — BDI terminology migration initiated

The team began planning the BDI migration. The Product Manager audited every surface where the old category terms appeared — types, UI, schemas, prompts, cmdlets, data files — producing a comprehensive inventory. The Technical Lead built a phased plan from that audit, which the SRE reviewed for failure modes. The human approved all design decisions (standard BDI names, preserve ID slugs, 4-phase shim approach) in e/2. See "BDI terminology migration completed" above for the outcome.
