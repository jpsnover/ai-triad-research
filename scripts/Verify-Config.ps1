# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Runs every ai-models.json registry-completeness gate in one command.
.DESCRIPTION
    ai-models.json is a repo-root registry whose completeness is enforced by
    test suites that live in other packages (taxonomy-editor's vitest suite and
    the tests/ Pester suite). An agent editing the root config gets no local
    signal that those suites gate it — which is how a registry edit can go green
    locally and red in CI (t/1933). This script gives that edit a single local
    command that runs all six gates and exits non-zero if any fails.

    Six gates (see t/1950#1 for the corrected inventory):
      Pester (run directly):
        - tests/Test-AIModelsConfig.Tests.ps1   config gate
        - tests/ModelLiteralLint.Tests.ps1      -Model literals name registered models
      vitest (delegated to taxonomy-editor's suite):
        - taxonomy-editor/src/server/__tests__/keysValidation.test.ts   KEY_VALIDATION_PROBES completeness
        - taxonomy-editor/src/main/__tests__/resolveApiModelId.test.ts  id->apiId map
        - lib/debate/__tests__/configInvariant.test.ts                  fallbackChain / default invariants
        - lib/electron-shared/modelDiscovery.test.ts                    model discovery

    The vitest half is the fiddly part. taxonomy-editor's vitest include-globs
    are relative to taxonomy-editor/src/renderer, so passing repo-root-relative
    paths as filters silently matches ZERO tests and exits 0 — a false green that
    looks exactly like success (t/1950#1). This script defends against that by:
      1. filtering with bare basenames (CWD-independent substring match), and
      2. verifying `vitest list` collects EXACTLY the four expected files before
         running — a collected count other than four is a FAILURE, not success.
.EXAMPLE
    npm run verify:config
.EXAMPLE
    pwsh -File scripts/Verify-Config.ps1
.NOTES
    Cross-platform: pwsh + npm exist on both the win32 fleet and Linux CI.
    Run from anywhere — paths resolve relative to this script's location.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# A failing vitest suite exits non-zero — that is expected, not an error to abort on.
# Pin this OFF so a native non-zero exit never throws (some pwsh builds default it $true,
# which would turn `$ErrorActionPreference = 'Stop'` into a throw at the vitest call and
# skip our graceful "FAIL vitest run" reporting). We branch on $LASTEXITCODE ourselves.
$PSNativeCommandUseErrorActionPreference = $false

$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TaxEditor  = Join-Path $RepoRoot 'taxonomy-editor'

# Ordered map: vitest basename filter -> a path fragment that must appear in the
# collected file's path. Fragments are specific enough to detect a basename
# collision (a stray same-named test elsewhere would list under a different path).
$VitestGates = [ordered]@{
    'keysValidation'   = 'server/__tests__/keysValidation.test.ts'
    'resolveApiModelId' = 'main/__tests__/resolveApiModelId.test.ts'
    'configInvariant'  = 'lib/debate/__tests__/configInvariant.test.ts'
    'modelDiscovery'   = 'lib/electron-shared/modelDiscovery.test.ts'
}
$PesterGates = @(
    (Join-Path $RepoRoot 'tests/Test-AIModelsConfig.Tests.ps1')
    (Join-Path $RepoRoot 'tests/ModelLiteralLint.Tests.ps1')
)

# gate name -> $true (pass) / $false (fail); preserves declaration order for the summary
$Results = [ordered]@{}

function Write-Section {
    param([string]$Text)
    Write-Host ''
    Write-Host "== $Text ==" -ForegroundColor Cyan
}

# ── Pester gates ────────────────────────────────────────────────────────────
Write-Section 'Pester registry gates'
$missingPester = @($PesterGates | Where-Object { -not (Test-Path $_) })
foreach ($m in $missingPester) {
    $name = Split-Path $m -Leaf
    Write-Host "  FAIL $name — file not found at $m" -ForegroundColor Red
    $Results[$name] = $false
}
$foundPester = @($PesterGates | Where-Object { Test-Path $_ })
if ($foundPester.Count -gt 0) {
    # Run Pester with strict mode OFF for this call only. Under `Set-StrictMode -Version
    # Latest` (set at the top of this script), Pester's expansion of `<...>` template
    # tokens in a test NAME throws when the token names an unbound variable — e.g. the
    # literal "<family>" in a Test-AIModelsConfig `It` name expands `$family`, which is
    # never set. That would FALSE-RED an otherwise-passing gate. CI runs its Pester step
    # with no ambient strict mode, so it is green; matching that is correct behaviour, not
    # a workaround. The `& { ... }` child scope confines `-Off` to this one invocation —
    # the rest of the script keeps strict mode. Config-object invocation also mirrors ci.yml.
    $run = & {
        Set-StrictMode -Off
        $pconf = New-PesterConfiguration
        $pconf.Run.Path         = $foundPester
        $pconf.Run.PassThru     = $true
        $pconf.Output.Verbosity = 'None'
        Invoke-Pester -Configuration $pconf
    }
    foreach ($ct in $run.Containers) {
        $name = Split-Path $ct.Item -Leaf
        $ok   = ($ct.Result -eq 'Passed')
        if ($ok) {
            Write-Host "  PASS $name ($($ct.PassedCount) tests)" -ForegroundColor Green
        } else {
            Write-Host "  FAIL $name ($($ct.FailedCount) failed / $($ct.PassedCount) passed)" -ForegroundColor Red
        }
        $Results[$name] = $ok
    }
}

# ── vitest gates (delegated to taxonomy-editor) ──────────────────────────────
Write-Section 'vitest registry gates (via taxonomy-editor)'
$Filters = @($VitestGates.Keys)

if (-not (Test-Path (Join-Path $TaxEditor 'node_modules'))) {
    # Standalone tooling script: report as a gate failure and exit non-zero rather
    # than throw (New-ActionableError lives in the AITriad module, and importing it
    # would trigger the module-load taxonomy scan this command has no need for).
    Write-Host '  FAIL vitest — taxonomy-editor/node_modules is missing.' -ForegroundColor Red
    Write-Host '        Goal:  run the vitest registry gates' -ForegroundColor DarkYellow
    Write-Host "        Fix:   run 'pnpm install' in $TaxEditor, then re-run verify:config" -ForegroundColor DarkYellow
    $Results['vitest:collection (4 files)'] = $false
    $Results['vitest:run'] = $false
}
else {
    Push-Location $TaxEditor
    try {
    # Step 1 — COLLECTION GUARD. `vitest list --filesOnly` prints one path per
    # collected file (exit 0 even when it matches nothing — the silent-zero trap),
    # so we count and match rather than trusting the exit code.
    $listed = @(& npm exec --silent -- vitest list --filesOnly @Filters 2>&1 |
        Where-Object { $_ -and ($_ -is [string]) } |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -match '\.test\.tsx?$' })   # only test-file paths — ignore any stderr noise

    $collectionOk = $true
    if ($listed.Count -ne $VitestGates.Count) {
        Write-Host "  FAIL collection — expected $($VitestGates.Count) files, vitest collected $($listed.Count)" -ForegroundColor Red
        if ($listed.Count -gt 0) { $listed | ForEach-Object { Write-Host "        collected: $_" -ForegroundColor DarkYellow } }
        $collectionOk = $false
    }
    foreach ($frag in $VitestGates.Values) {
        $hit = @($listed | Where-Object { $_.Replace('\', '/') -like "*$frag" })
        if ($hit.Count -ne 1) {
            Write-Host "  FAIL collection — expected exactly one match for '$frag', got $($hit.Count)" -ForegroundColor Red
            $collectionOk = $false
        }
    }
    $Results['vitest:collection (4 files)'] = $collectionOk

    if ($collectionOk) {
        Write-Host "  PASS collection — all $($VitestGates.Count) gate files collected" -ForegroundColor Green

        # Step 2 — RUN the four collected files.
        & npm exec --silent -- vitest run @Filters
        $runOk = ($LASTEXITCODE -eq 0)
        if ($runOk) {
            Write-Host "  PASS vitest run — all 4 gate suites green" -ForegroundColor Green
        } else {
            Write-Host "  FAIL vitest run — one or more suites failed (exit $LASTEXITCODE, see output above)" -ForegroundColor Red
        }
        $Results['vitest:run'] = $runOk
    } else {
        # Collection is untrustworthy — do NOT run (a partial/zero run would look green).
        Write-Host "  SKIP vitest run — collection guard failed; not running an unverified set" -ForegroundColor Red
        $Results['vitest:run'] = $false
    }
    } finally {
        Pop-Location
    }
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Section 'Summary'
$failed = @()
foreach ($k in $Results.Keys) {
    if ($Results[$k]) {
        Write-Host "  [PASS] $k" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] $k" -ForegroundColor Red
        $failed += $k
    }
}

if ($failed.Count -gt 0) {
    Write-Host ''
    Write-Host "verify:config FAILED — $($failed.Count) gate(s): $($failed -join ', ')" -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host 'verify:config PASSED — all 6 registry gates green.' -ForegroundColor Green
exit 0
