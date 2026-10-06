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
    Get-AICostReport.Tests.ps1. ApiModelIdMap is a NESTED map,
    $map[backend][apiModelId] -> id, never a joined-string key (TL review
    on #2834: same delimiter-collision class CodeQL flagged in #2826).
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'Get-AICostPricing ApiModelIdMap' -Tag 'cost' {

    It 'maps (backend, apiModelId) -> models[].id for a known model, nested by backend' {
        $Info = InModuleScope AITriad { Get-AICostPricing }
        $Info.ApiModelIdMap['gemini']['gemini-3.5-flash-lite'] | Should -Be 'gemini-3.5-flash-lite'
    }

    It 'the 4 azure/openai shared apiModelIds resolve to DIFFERENT ids per backend (never collide)' {
        $Info = InModuleScope AITriad { Get-AICostPricing }
        foreach ($Api in 'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini') {
            $AzureId  = $Info.ApiModelIdMap['azure'][$Api]
            $OpenaiId = $Info.ApiModelIdMap['openai'][$Api]
            $AzureId  | Should -Not -BeNullOrEmpty -Because "azure/$Api must be in the map"
            $OpenaiId | Should -Not -BeNullOrEmpty -Because "openai/$Api must be in the map"
            $AzureId  | Should -Not -Be $OpenaiId -Because "$Api is shared by azure and openai -- they must resolve to different models[].id"
        }
    }

    It '(backend, apiModelId) is a true function across the whole real ai-models.json (every pair maps to exactly one id)' {
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
            $Key = "$($M.backend)/$($M.apiModelId)"
            if ($Seen.ContainsKey($Key) -and $Seen[$Key] -ne $M.id) {
                $Collisions.Add($Key)
            }
            $Seen[$Key] = $M.id
        }
        @($Collisions).Count | Should -Be 0 -Because "a (backend, apiModelId) collision means the map can't be a function: $($Collisions -join ', ')"

        $TotalPairs = 0
        foreach ($Backend in $Info.ApiModelIdMap.Keys) { $TotalPairs += $Info.ApiModelIdMap[$Backend].Count }
        $TotalPairs | Should -Be $Seen.Count
    }

    Context 'TL review on #2834 -- ambiguous (backend, apiModelId) pairs must never last-write-wins' {

        BeforeEach {
            $script:TempRoot = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
        }

        It 'two DIFFERENT models sharing a (backend, apiModelId) pair resolve to the ambiguous marker, not the last one seen' {
            $Fixture = [ordered]@{
                models = @(
                    [ordered]@{ id = 'model-one'; apiModelId = 'shared-api-id'; backend = 'groq' }
                    [ordered]@{ id = 'model-two'; apiModelId = 'shared-api-id'; backend = 'groq' }
                )
                pricing = [ordered]@{}
            }
            $FixturePath = Join-Path $TempRoot 'ai-models.json'
            Set-Content -Path $FixturePath -Value ($Fixture | ConvertTo-Json -Depth 10) -Encoding utf8

            $Info = InModuleScope AITriad -Parameters @{ root = $TempRoot } {
                $OrigRoot = $script:RepoRoot
                $script:RepoRoot = $root
                try { Get-AICostPricing } finally { $script:RepoRoot = $OrigRoot }
            }

            $Resolved = $Info.ApiModelIdMap['groq']['shared-api-id']
            $Resolved | Should -Not -Be 'model-one' -Because 'must not resolve to either candidate'
            $Resolved | Should -Not -Be 'model-two' -Because 'must not last-write-wins to the second model seen'
            $Resolved.PSTypeNames[0] | Should -Be 'AITriad.AmbiguousPricingKeyMarker'
        }

        It 'a THIRD model sharing the same pair keeps it ambiguous (does not un-ambiguous back to a single id)' {
            $Fixture = [ordered]@{
                models = @(
                    [ordered]@{ id = 'model-one';   apiModelId = 'shared-api-id'; backend = 'groq' }
                    [ordered]@{ id = 'model-two';   apiModelId = 'shared-api-id'; backend = 'groq' }
                    [ordered]@{ id = 'model-three'; apiModelId = 'shared-api-id'; backend = 'groq' }
                )
                pricing = [ordered]@{}
            }
            $FixturePath = Join-Path $TempRoot 'ai-models.json'
            Set-Content -Path $FixturePath -Value ($Fixture | ConvertTo-Json -Depth 10) -Encoding utf8

            $Info = InModuleScope AITriad -Parameters @{ root = $TempRoot } {
                $OrigRoot = $script:RepoRoot
                $script:RepoRoot = $root
                try { Get-AICostPricing } finally { $script:RepoRoot = $OrigRoot }
            }

            $Info.ApiModelIdMap['groq']['shared-api-id'].PSTypeNames[0] | Should -Be 'AITriad.AmbiguousPricingKeyMarker'
        }

        It 'does NOT mark a (backend, apiModelId) pair ambiguous when the same single model appears, or different backends share the apiModelId' {
            $Fixture = [ordered]@{
                models = @(
                    [ordered]@{ id = 'azure-gpt-4o';  apiModelId = 'gpt-4o'; backend = 'azure' }
                    [ordered]@{ id = 'openai-gpt-4o'; apiModelId = 'gpt-4o'; backend = 'openai' }
                )
                pricing = [ordered]@{}
            }
            $FixturePath = Join-Path $TempRoot 'ai-models.json'
            Set-Content -Path $FixturePath -Value ($Fixture | ConvertTo-Json -Depth 10) -Encoding utf8

            $Info = InModuleScope AITriad -Parameters @{ root = $TempRoot } {
                $OrigRoot = $script:RepoRoot
                $script:RepoRoot = $root
                try { Get-AICostPricing } finally { $script:RepoRoot = $OrigRoot }
            }

            $Info.ApiModelIdMap['azure']['gpt-4o']  | Should -Be 'azure-gpt-4o'
            $Info.ApiModelIdMap['openai']['gpt-4o'] | Should -Be 'openai-gpt-4o'
        }
    }
}
