**Date:** 2026-07-15
**Working on:** t/1500 Phase 3 — blue-green deploy production go-live
**Status:** Complete — production deploy successful. `taxonomy-editor--deploy-2efaf30-46882` at 100% traffic. All 22/22 acceptance tests passed. Throwaway branch deleted.

**Key fixes shipped (in deploy order):**
- `a6e30724` — blue-green pipeline fixes (Import-Module placement, continue-on-error diagnostics, always() on rollback steps, belt-and-suspenders empty-revision guard)
- `71112cf8` — preflight accepts `test-container: skipped` as valid (no container-relevant files changed)
- `c0d010ef` — Invoke-Az stderr filter (PowerShell; prevents [ErrorRecord] objects corrupting JSON stdout)
- `b3d16f93` — fix Format-Table column names in acceptance/smoke steps (Status/Error, not StatusCode/Detail — all diagnostic columns were blank in every prior run)
- `2efaf304` — RawBody cap 400→4096 in Invoke-RemoteCheck.ps1 (SPA shell check always failed: app head is 464+ chars before Vite's script injection; 4096 gives 10× headroom)

**Root cause of production attempt 3 failure:** RawBody 400-char truncation in Invoke-RemoteCheck.ps1. The `<div id="root">` and `src="...js"` patterns both fall past 400 chars in this app's built index.html. Was a guaranteed false positive.

**Known open items:**
- `test-powershell` still fails on Group C (Test-OntologyCompliance, 411/411, pre-existing) and the new RawBody regression test has a Pester ParseException due to `id="root"` in the test name — pinged PowerShell at p/169#23
- Smoke test without -AnonymousSession shows 6/22 — expected behavior (Easy Auth requires /.auth/anonymous session establishment before serving the SPA)
- Dependabot: 60 moderate + 6 low vulnerabilities flagged on default branch (pre-existing)
