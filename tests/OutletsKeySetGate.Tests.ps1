# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
t/3865 (t/3819 child E) — live extraction + parity check for the PowerShell
outlet consumer, run against the actual repo files (not mocks). Companion to
tests/OutletKeySetVerdict.Tests.ps1, which proves the comparator's own both
GV arms on synthetic fixtures; THIS file proves arm 1 (complete set passes)
against production for the PS side specifically.

Split by language rather than shelling cross-language from inside this
process (measured directly: invoking `tsx <file>` — any real .ts file, not
just `tsx --version` — from inside a Pester BeforeAll on this Windows agent
triggers a spurious Pester InvalidOperationException, pester/Pester#2669,
that silently aborts the run; `Start-Process -WindowStyle Hidden` as a
workaround then hung indefinitely on the npx .cmd wrapper). This matches the
codebase's own established pattern for the other six verify:config gates:
Pester tests PowerShell, vitest tests TypeScript, each natively — the TS-side
check lives in lib/oped/__tests__/outletsKeySetGate.test.ts instead.

Consumers checked here:
  - PS       : Get-OpEdOutletKeys via InModuleScope — the SAME live generator
               t/3863's dynamic [ValidateSet] binds to, not a separate
               re-implementation of the read.
  - TS       : NOT this file — see lib/oped/__tests__/outletsKeySetGate.test.ts.
  - Renderer : NOT this file — NewOpEdDialog.test.tsx:90-98 (t/3864, Rosetta
               Stone) already renders the real dialog and asserts its
               <select> options + default against outlets.json directly.

What this gate does NOT cover (t/3819 route enumeration, stated not implied):
  - styleDefaults prose: single-sourced after B/C/D landed, nothing to compare.
  - behavior for an unknown outlet: validation layer (resolveOutletBand /
    t/3854's tests), not this data gate.
  - docs/ux/oped-studio.md prose: permanently uncoverable by any key-set gate.
#>

BeforeAll {
    . (Join-Path $PSScriptRoot '..' 'operations' 'devops' 'OutletKeySetVerdict.ps1')
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    $script:OutletsJsonPath = Join-Path $script:RepoRoot 'lib/oped/outlets.json'

    # Ground truth: read the SSOT directly, bypassing even PS's own loader, so
    # a loader bug can't also corrupt the measurement of truth.
    $script:SsotRaw = Get-Content -Raw -Path $script:OutletsJsonPath -Encoding UTF8 | ConvertFrom-Json
    $script:SsotKeys = @($script:SsotRaw.outlets.PSObject.Properties.Name)
    $script:SsotDefault = [string]$script:SsotRaw.defaultOutlet

    # PS realized keys: the SAME generator New-OpEd's dynamic ValidateSet binds
    # to (t/3863), not a separate re-implementation of the read.
    Import-Module (Join-Path $script:RepoRoot 'scripts/AITriad/AITriad.psd1') -Force
    $script:PsKeys = @(InModuleScope AITriad { Get-OpEdOutletKeys })
}

Describe 'Outlet key-set parity — PowerShell consumer (live, against real repo files)' {

    Context 'extraction sanity — before trusting any comparison' {
        It 'reads a non-empty SSOT key set' {
            $script:SsotKeys.Count | Should -BeGreaterThan 0
        }
        It 'reads a non-empty PS realized key set' {
            $script:PsKeys.Count | Should -BeGreaterThan 0
        }
        It 'SSOT __meta__.outlets_count matches the actual key count (consistency the SSOT itself asserts)' {
            $script:SsotRaw.__meta__.outlets_count | Should -Be $script:SsotKeys.Count
        }
    }

    Context 'parity — arm 1: the complete consumer set passes clean' {
        It 'the PS realized key set equals the SSOT key set' {
            $v = Get-OutletKeySetVerdict -SsotKeys $script:SsotKeys -SsotDefault $script:SsotDefault `
                -ConsumerKeySets @{ ps = $script:PsKeys }
            $v.Passed | Should -BeTrue -Because ($v | ConvertTo-Json -Depth 6)
            $v.SsotCount | Should -Be $script:SsotKeys.Count
        }
    }
}
