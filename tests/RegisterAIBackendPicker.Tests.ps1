# Tag: config (t/3586)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Guard: every model id offered by the Register-AIBackend picker list is registered
    in ai-models.json, and none is duplicated (t/3586). The general model-lint (t/3560)
    can't see this list — picker entries key on `id =`, not `model =` / -Model — so this
    is the dedicated backstop against picker drift (unregistered id -> fails on selection).
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force
    $script:ValidIds = @(InModuleScope AITriad { $script:ValidModelIds })

    # Extract picker ids via AST: hashtable literals carrying id + backend + label keys.
    $regPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Register-AIBackend.ps1'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($regPath, [ref]$null, [ref]$null)
    $hashes = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.HashtableAst] }, $true)
    $ids = [System.Collections.Generic.List[string]]::new()
    foreach ($h in $hashes) {
        $keyNames = @($h.KeyValuePairs | ForEach-Object { $_.Item1.Value })
        if (($keyNames -contains 'id') -and ($keyNames -contains 'backend') -and ($keyNames -contains 'label')) {
            $idKvp = $h.KeyValuePairs | Where-Object { $_.Item1.Value -eq 'id' } | Select-Object -First 1
            $ids.Add($idKvp.Item2.Extent.Text.Trim("`"'"))
        }
    }
    $script:PickerIds = @($ids)
}

Describe 'Register-AIBackend model picker (t/3586)' -Tag 'config' {

    It 'ai-models.json exposes a non-empty registered model set' {
        @($script:ValidIds).Count | Should -BeGreaterThan 0
    }

    It 'the AST scan finds picker entries (guards against a vacuous check)' {
        @($script:PickerIds).Count | Should -BeGreaterThan 0
    }

    It 'every picker model id is registered in ai-models.json' {
        $offenders = @($script:PickerIds | Where-Object { $_ -notin $script:ValidIds })
        $report = ($offenders | ForEach-Object { "  '$_'" }) -join "`n"
        $offenders.Count | Should -Be 0 -Because "the Register-AIBackend picker must only offer registered models (an unregistered id fails when the user selects it). Repoint each to a registered id:`n$report"
    }

    It 'has no duplicate picker ids' {
        $dupes = @($script:PickerIds | Group-Object | Where-Object { $_.Count -gt 1 } | ForEach-Object { $_.Name })
        $report = ($dupes | ForEach-Object { "  '$_'" }) -join "`n"
        $dupes.Count | Should -Be 0 -Because "each model should appear once in the picker:`n$report"
    }
}
