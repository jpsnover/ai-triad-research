# Tag: unit (t/2588)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Regression guard for t/2588: New-OpEd FromPrep parameter set must accept -Topic.
# Root cause: [Parameter(ParameterSetName='FromPrep')] was missing on -Topic, so passing
# both -Topic and -SourcePrep caused "parameter set cannot be resolved" (exit 1 in shim).

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'New-OpEd parameter set: FromPrep' -Tag 'unit' {

    It 'Is exported from the module' {
        Get-Command New-OpEd -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It 'Has a FromPrep parameter set' {
        $cmd = Get-Command New-OpEd -Module AITriad -ErrorAction Stop
        $setNames = $cmd.ParameterSets | Select-Object -ExpandProperty Name
        $setNames | Should -Contain 'FromPrep'
    }

    It 'FromPrep parameter set includes Topic (regression: was missing, caused exit 1 in invoke-oped.ps1 shim)' {
        $cmd = Get-Command New-OpEd -Module AITriad -ErrorAction Stop
        $fromPrep = $cmd.ParameterSets | Where-Object Name -eq 'FromPrep'
        $fromPrep | Should -Not -BeNullOrEmpty
        $topicParam = $fromPrep.Parameters | Where-Object Name -eq 'Topic'
        $topicParam | Should -Not -BeNullOrEmpty -Because 'shim always passes -Topic alongside -SourcePrep; missing attribute causes parameter set resolution failure'
    }

    It 'FromPrep parameter set includes SourcePrep as mandatory' {
        $cmd = Get-Command New-OpEd -Module AITriad -ErrorAction Stop
        $fromPrep = $cmd.ParameterSets | Where-Object Name -eq 'FromPrep'
        $sourcePrepParam = $fromPrep.Parameters | Where-Object Name -eq 'SourcePrep'
        $sourcePrepParam | Should -Not -BeNullOrEmpty
        $sourcePrepParam.IsMandatory | Should -Be $true
    }

    It 'Topic is not mandatory in FromPrep (optional — shim omits it when unset)' {
        $cmd = Get-Command New-OpEd -Module AITriad -ErrorAction Stop
        $fromPrep = $cmd.ParameterSets | Where-Object Name -eq 'FromPrep'
        $topicParam = $fromPrep.Parameters | Where-Object Name -eq 'Topic'
        $topicParam.IsMandatory | Should -Be $false
    }
}
