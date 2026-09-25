# Tag: config (t/3665)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Guards the import-once test-isolation mechanism (t/3665): every mutable module
    $script: var MUST be reset by Enter-AITriadTestModule, or per-file isolation silently
    regresses. Runtime probe (not a hand-maintained list): sentinel every $script: var,
    reset, and assert none survive except an explicit immutable/infra allow-list. Both-armed
    below (an injected uncovered var IS detected), per TL condition 1.
#>

BeforeAll {
    . (Join-Path $PSScriptRoot 'TestModuleBootstrap.ps1')
    Enter-AITriadTestModule

    # PS automatic / preference variables present in a module scope — never probe these.
    $script:AutomaticVarDenyList = @(
        'PSScriptRoot', 'PSCommandPath', 'MyInvocation', 'PSBoundParameters', 'PSDefaultParameterValues',
        'ExecutionContext', 'PSCmdlet', 'PSItem', 'args', 'input', 'this', 'foreach', 'switch',
        'StackTrace', 'PSCulture', 'PSUICulture', 'PSVersionTable', 'PSEdition', 'ErrorActionPreference',
        'ProgressPreference', 'VerbosePreference', 'WarningPreference', 'DebugPreference',
        'InformationPreference', 'ConfirmPreference', 'WhatIfPreference', 'PSModuleAutoLoadingPreference',
        'null', 'true', 'false', 'Error', 'Host', 'HOME', 'PID', 'PWD', 'ShellId', 'MaximumErrorCount'
    )

    # Immutable / reset-infrastructure vars — legitimately NOT reset (TL-audited inventory).
    $script:ResetAllowList = @{
        AITriad  = @('ModuleRoot', 'RepoRoot', 'IsDevInstall',
                     '_PristineTaxonomyData', '_PristineTaxonomyTimestamps', '_PristinePolicyRegistry', '_PristineCorpusHash',
                     'AutomaticVarDenyList', 'ResetAllowList')  # <- this test file's own $script vars, if scoped here
        AIEnrich = @('ContextWindows', '_PristineModelRegistry', '_PristineFallbackChains', '_PristineDebateTiers')
    }

    function script:Get-AITriadFamilyModules {
        $a = Get-Module AITriad
        $out = [System.Collections.Generic.List[object]]::new()
        foreach ($m in (@($a) + @($a.NestedModules))) {
            if ($m -and $m.Name -in @('AITriad', 'AIEnrich') -and -not ($out -contains $m)) { $out.Add($m) }
        }
        $out
    }

    $script:Sentinel = '__T3665_RESET_PROBE__'
}

Describe 'Import-once reset completeness (t/3665)' -Tag 'config' {

    It 'derives at least AITriad + AIEnrich as family modules' {
        @(script:Get-AITriadFamilyModules).Name | Sort-Object | Should -Be @('AIEnrich', 'AITriad')
    }

    It 'every mutable module $script: var is reset by Enter-AITriadTestModule' {
        # 1) sentinel every non-automatic, non-allow-listed $script: var in each family module
        $probed = foreach ($m in (script:Get-AITriadFamilyModules)) {
            $allow = @($script:ResetAllowList[$m.Name]) + $script:AutomaticVarDenyList
            $names = & $m {
                param($deny)
                (Get-Variable -Scope Script -ErrorAction SilentlyContinue |
                    Where-Object { -not $_.Options.HasFlag([System.Management.Automation.ScopedItemOptions]::ReadOnly) -and
                                   -not $_.Options.HasFlag([System.Management.Automation.ScopedItemOptions]::Constant) -and
                                   $_.Name -notin $deny }).Name
            } $allow
            foreach ($n in $names) {
                & $m { param($n, $s) Set-Variable -Scope Script -Name $n -Value $s } $n $script:Sentinel
                [pscustomobject]@{ Module = $m; Name = $n }
            }
        }

        # 2) reset
        Enter-AITriadTestModule

        # 3) any probed var still holding the sentinel was NOT reset -> incomplete coverage
        $stillDirty = foreach ($p in $probed) {
            $v = & $p.Module { param($n) Get-Variable -Scope Script -Name $n -ValueOnly -ErrorAction SilentlyContinue } $p.Name
            if ($v -is [string] -and $v -eq $script:Sentinel) { "$($p.Module.Name).$($p.Name)" }
        }
        @($stillDirty) | Should -BeNullOrEmpty -Because "these module `$script:* vars are NOT reset by Initialize-*RuntimeState — per-file isolation would silently regress. Add them to the reset (or the immutable allow-list if truly constant): $(@($stillDirty) -join ', ')"
    }

    It 'BOTH-ARMS: an uncovered $script: var IS detected by the same probe (guard fires)' {
        # Inject a throwaway var covered by neither Initialize-* nor the allow-list.
        & (Get-Module AITriad) { param($s) Set-Variable -Scope Script -Name '__ProbeUncovered' -Value $s } $script:Sentinel
        Enter-AITriadTestModule   # reset does NOT (and should not) know about it
        $after = & (Get-Module AITriad) { Get-Variable -Scope Script -Name '__ProbeUncovered' -ValueOnly -ErrorAction SilentlyContinue }
        $after | Should -Be $script:Sentinel -Because 'a var reset does not cover survives the reset — which is exactly what the completeness probe above detects and fails on'
        & (Get-Module AITriad) { Remove-Variable -Scope Script -Name '__ProbeUncovered' -ErrorAction SilentlyContinue }
    }

    It 'SUITE INTEGRITY: the taxonomy/policy corpus was not mutated in place (hash guard)' {
        # Reference-restore cannot undo in-place corpus mutation; this catches it (TL condition).
        { & (Get-Module AITriad) { Assert-AITriadCorpusPristine } } | Should -Not -Throw
    }
}
