# Tag: cost (t/3951)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Get-AICostPricing's ApiModelIdMap (t/3951): the (backend,
    apiModelId) -> models[].id map backing ConvertTo-AIUsageCostEstimate's
    legacy-record resolution path.
.DESCRIPTION
    Uses the real repo-root ai-models.json (read-only), same convention as
    Get-AICostReport.Tests.ps1.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'Get-AICostPricing ApiModelIdMap' -Tag 'cost' {

    It 'maps (backend, apiModelId) -> models[].id for a known model' {
        $Info = InModuleScope AITriad { Get-AICostPricing }
        $Info.ApiModelIdMap['gemini|gemini-3.5-flash-lite'] | Should -Be 'gemini-3.5-flash-lite'
    }

    It 'the 4 azure/openai shared apiModelIds resolve to DIFFERENT ids per backend (never collide)' {
        $Info = InModuleScope AITriad { Get-AICostPricing }
        foreach ($Api in 'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini') {
            $AzureId  = $Info.ApiModelIdMap["azure|$Api"]
            $OpenaiId = $Info.ApiModelIdMap["openai|$Api"]
            $AzureId  | Should -Not -BeNullOrEmpty -Because "azure|$Api must be in the map"
            $OpenaiId | Should -Not -BeNullOrEmpty -Because "openai|$Api must be in the map"
            $AzureId  | Should -Not -Be $OpenaiId -Because "$Api is shared by azure and openai -- they must resolve to different models[].id"
        }
    }

    It '(backend, apiModelId) is a true function across the whole real ai-models.json (every key maps to exactly one id)' {
        $Info = InModuleScope AITriad { Get-AICostPricing }
        # Rebuild independently from the raw file and compare -- catches a
        # map-building bug that silently overwrote a colliding key instead
        # of this test accidentally validating the same buggy construction.
        $ModelsPath = Join-Path $PSScriptRoot '..' 'ai-models.json'
        $Raw = Get-Content -Raw -Path $ModelsPath | ConvertFrom-Json
        $Seen = @{}
        $Collisions = [System.Collections.Generic.List[string]]::new()
        foreach ($M in $Raw.models) {
            if (-not $M.PSObject.Properties['apiModelId'] -or -not $M.PSObject.Properties['backend']) { continue }
            $Key = "$($M.backend)|$($M.apiModelId)"
            if ($Seen.ContainsKey($Key) -and $Seen[$Key] -ne $M.id) {
                $Collisions.Add($Key)
            }
            $Seen[$Key] = $M.id
        }
        @($Collisions).Count | Should -Be 0 -Because "a (backend, apiModelId) collision means the map can't be a function: $($Collisions -join ', ')"
        $Info.ApiModelIdMap.Count | Should -Be $Seen.Count
    }
}
