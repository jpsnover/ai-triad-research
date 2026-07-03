# HLD: Electron App Consolidation Decision (repo-review B-206)

**Date:** 2026-07-03 · **Author:** Technical Lead · **Status:** **DECIDED — Option B** (owner sign-off 2026-07-03: keep 3 apps, aggressive shared-lib extraction; re-evaluate consolidation at the Phase 4 checkpoint per the trigger below)
**Inputs:** duplication scan in `docs/reviews/2026-07-repo-review/FINDINGS.md` (F-012, F-013, F-015)

## Question

Should poviewer and summary-viewer become views inside the taxonomy-editor shell, or remain separate Electron apps with aggressive shared-library extraction?

## Measured facts (2026-07-02 scan)

- Production LOC: taxonomy-editor 113,661 · poviewer 7,491 · summary-viewer 6,913.
- Each app carries a full private Electron shell (main/preload/ipcHandlers/apiKeyStore). Pairwise similarity of the parallel files: `diagnosePython.ts` 94%, `utils/similarity.ts` 100% byte-identical, `modelDiscovery.ts` 56% (567/344-LOC forks), `ApiKeyDialog.tsx` 81%, `errorMessages.ts` 78%.
- **Three independent AI-client implementations** (TE server+main, PO `aiEngine.ts` 373 LOC, SV `generateContent.ts` 491 LOC) — none uses `lib/ai-client`.
- Consolidation eliminates an estimated **4,500–5,500 LOC (~35% of PO+SV)**; ~9k LOC of genuinely distinct view logic remains either way.
- The mitigation pattern already works: `lib/electron-shared/` has 5 modules consumed by PO/SV via re-export shims — it just covers ~5 of ~15 parallel files.
- ADR-001/003 compliance in PO/SV is 0–partial (F-019): consolidation would inherit TE's flight-recorder/lint infrastructure for free; separate apps need it wired twice (B-402).

## Option A — Consolidate: PO + SV become windows/routes in the TE shell

**Wins:** −4,500–5,500 LOC; one shell, one bridge, one apiKeyStore, one modelDiscovery; PO/SV get TE's resilience, flight recorder, ESLint rules, test harness, and dual-build (web) capability for free; 2 fewer `npm ci`/CI matrices; B-402 becomes moot.

**Costs / risks:**
1. **Contention concentration — the serious one.** The review's #1 velocity finding is that taxonomy-editor's monoliths are the merge-contention point (F-017). Consolidation lands two more apps' growth *into the contended repo area* exactly while B-209/B-210/B-211 surgery is in flight.
2. Migration effort: multi-session (L). PdfViewer/annotation and KeyPointsPane stacks port as feature folders; pdfjs-dist + GenAI SDK deps join TE's dependency tree (startup/bundle cost to manage via lazy routes).
3. Release coupling: a PO regression now ships/blocks TE releases (mitigable with per-window smoke gates).
4. Loss of the small-app property: PO/SV currently boot in a trivially auditable 126/207-line main.

## Option B — Keep 3 apps; finish the shared-library extraction (B-201/202/204/205)

**Wins:** −2,500–3,000 LOC of the worst duplication (shells stay, but modelDiscovery/embeddings/diagnosePython/similarity/errorMessages/dialog forks collapse into `lib/electron-shared/`; PO/SV AI clients replaced by `lib/ai-client`); zero migration risk; apps keep independent release cadence; work parallelizes across owners without touching TE's hot files.

**Costs:** ~2,000–2,500 LOC of residual duplication remains (per-app main/preload/ipc scaffolding); B-402 (ADR compliance wiring ×2) still needed; 3 CI matrices remain.

## Recommendation: **B now, re-decide A at Phase 4 — with the AI-client unification made mandatory either way**

The decisive factor is sequencing, not end-state: Option A's end-state is plausibly right, but executing it **concurrently with the monolith decomposition would aim two multi-session change streams at the same contended files** — recreating the top velocity problem the review diagnosed. Option B captures ~55–65% of the LOC win at ~20% of the risk, entirely in `lib/` (the healthiest, least-contended area), and none of it is thrown away if A is adopted later (a consolidated shell would consume the same shared modules).

Non-negotiable regardless of option: **PO's `aiEngine.ts` and SV's `generateContent.ts` are replaced by `lib/ai-client` with UsageIDs** (ADR-006) — three hand-rolled AI clients is the single worst duplication in the codebase.

Re-evaluation trigger: after B-209/B-210 land and the Phase 2 checkpoint, revisit A with fresh contention data. If PO/SV have needed ≥2 cross-app duplicated changes in the interim, that's the signal to consolidate.

## Decision requested from owner

- [ ] Option A (consolidate now) — B-204/B-205/B-402 cancelled, migration HLD v2 follows
- [ ] **Option B (recommended)** — B-201/202/204/205 proceed as ticketed; A re-evaluated at Phase 4 checkpoint
- [ ] Other / discuss
