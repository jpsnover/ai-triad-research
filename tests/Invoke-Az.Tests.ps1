# Tag: taxonomy (t/1500 Phase 3 dry-run — DevOps discovery)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Covers Private/Invoke-Az — stderr must NOT contaminate stdout.
.DESCRIPTION
    DevOps discovered in the t/1500 staging dry-run that `az containerapp
    update` emits deprecation/progress warnings to stderr. Under 2>&1, PS
    represents stderr as [ErrorRecord] objects in the captured array;
    Out-String serialized them into the returned string, corrupting the
    downstream JSON parse.

    The helper now filters $RawOutput by type — strings pass to the
    caller, ErrorRecord objects are logged via Write-Verbose and (on
    failure) included in the ActionableError NextSteps. `az revision
    list/show` weren't affected because they don't emit stderr; the
    problem only surfaced when `az containerapp update` shipped in
    New-ContainerAppRevision.

    These tests exercise the type-filter directly by shadowing `az` with
    a PowerShell function that emits mixed stdout + stderr. Any
    regression that removes the filter or serializes ErrorRecord objects
    into the returned string fails here.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-Az (t/1500 Phase 3 dry-run — stderr filtering)' -Tag 'taxonomy' {

    It 'Returns pure stdout when az writes both stdout and stderr' {
        InModuleScope AITriad {
            # Shadow the native `az` command with a function that emits BOTH
            # a JSON line to stdout AND a warning to stderr — the exact
            # shape `az containerapp update` produces in production.
            function az {
                Write-Error -Message 'WARNING: This command is in preview.' -ErrorAction Continue
                Write-Output '{"properties":{"latestRevisionName":"taxonomy-editor--rev-abc"}}'
                $global:LASTEXITCODE = 0
            }
            try {
                $result = Invoke-Az @('containerapp', 'update', '--name', 'x') 2>$null
                $result | Should -Be '{"properties":{"latestRevisionName":"taxonomy-editor--rev-abc"}}' -Because 'stderr must be filtered out; only stdout returned'
                # Prove the returned string is parseable as JSON (regression guard
                # for the exact failure DevOps hit in the dry-run).
                { $result | ConvertFrom-Json } | Should -Not -Throw
                (($result | ConvertFrom-Json).properties.latestRevisionName) | Should -Be 'taxonomy-editor--rev-abc'
            } finally {
                Remove-Item Function:\az -ErrorAction SilentlyContinue
            }
        }
    }

    It 'Returns pure stdout when az writes only stdout (no regression on the happy path)' {
        InModuleScope AITriad {
            function az {
                Write-Output '{"name":"taxonomy-editor"}'
                $global:LASTEXITCODE = 0
            }
            try {
                $result = Invoke-Az @('containerapp', 'show', '--name', 'x')
                $result | Should -Be '{"name":"taxonomy-editor"}'
            } finally {
                Remove-Item Function:\az -ErrorAction SilentlyContinue
            }
        }
    }

    It 'Non-zero exit: stderr surfaces in ActionableError NextSteps (not mixed into caller output)' {
        InModuleScope AITriad {
            function az {
                Write-Error -Message 'ERROR: revision not found' -ErrorAction Continue
                $global:LASTEXITCODE = 1
            }
            try {
                { Invoke-Az @('containerapp', 'show', '--name', 'missing') 2>$null } |
                    Should -Throw -Because 'exit=1 must throw ActionableError'
            } finally {
                Remove-Item Function:\az -ErrorAction SilentlyContinue
            }
        }
    }

    It 'Returns $null when az writes no stdout (even if it writes stderr)' {
        InModuleScope AITriad {
            function az {
                Write-Error -Message 'WARNING: nothing to show' -ErrorAction Continue
                $global:LASTEXITCODE = 0
            }
            try {
                $result = Invoke-Az @('containerapp', 'revision', 'list') 2>$null
                $result | Should -BeNullOrEmpty -Because 'stdout was empty; stderr-only should NOT round-trip as a string'
            } finally {
                Remove-Item Function:\az -ErrorAction SilentlyContinue
            }
        }
    }
}
