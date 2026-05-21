# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Find-AITSource POV coverage' {

    BeforeAll {
        $script:TempSummaries = Join-Path ([System.IO.Path]::GetTempPath()) "ait-find-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        $script:TempSources   = Join-Path ([System.IO.Path]::GetTempPath()) "ait-find-src-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        New-Item -Path $script:TempSummaries -ItemType Directory -Force | Out-Null
        New-Item -Path $script:TempSources   -ItemType Directory -Force | Out-Null

        # Create a summary with all 5 POV categories
        $Summary = @{
            doc_id        = 'test-doc-all-povs'
            pov_summaries = @{
                accelerationist  = @{ key_points = @(@{ taxonomy_node_id = 'acc-beliefs-001'; category = 'beliefs'; point = 'AI will be transformative' }) }
                safetyist        = @{ key_points = @(@{ taxonomy_node_id = 'saf-desires-001'; category = 'desires'; point = 'We need alignment' }) }
                skeptic          = @{ key_points = @(@{ taxonomy_node_id = 'skp-intentions-001'; category = 'intentions'; point = 'Question the hype' }) }
                cross_cutting    = @{ key_points = @(@{ taxonomy_node_id = 'cc-beliefs-001'; category = 'beliefs'; point = 'Governance matters' }) }
                situations       = @{ key_points = @(@{ taxonomy_node_id = 'sit-beliefs-001'; category = 'beliefs'; point = 'Context is key' }) }
            }
        }
        $Summary | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:TempSummaries 'test-doc-all-povs.json') -Encoding utf8NoBOM
    }

    AfterAll {
        if (Test-Path $script:TempSummaries) { Remove-Item $script:TempSummaries -Recurse -Force }
        if (Test-Path $script:TempSources)   { Remove-Item $script:TempSources   -Recurse -Force }
    }

    It 'Finds cross-cutting key_points' {
        InModuleScope AITriad -Parameters @{ SummariesDir = $script:TempSummaries; SourcesDir = $script:TempSources } {
            param($SummariesDir, $SourcesDir)
            Mock Get-SummariesDir { return $SummariesDir }
            Mock Get-SourcesDir   { return $SourcesDir }

            $Results = @(Find-AITSource -Id 'cc-*')
            $Results.Count | Should -Be 1
            $Results[0].Hits[0].NodeId | Should -Be 'cc-beliefs-001'
        }
    }

    It 'Finds situations key_points' {
        InModuleScope AITriad -Parameters @{ SummariesDir = $script:TempSummaries; SourcesDir = $script:TempSources } {
            param($SummariesDir, $SourcesDir)
            Mock Get-SummariesDir { return $SummariesDir }
            Mock Get-SourcesDir   { return $SourcesDir }

            $Results = @(Find-AITSource -Id 'sit-*')
            $Results.Count | Should -Be 1
            $Results[0].Hits[0].NodeId | Should -Be 'sit-beliefs-001'
        }
    }

    It 'Finds all 5 POVs with wildcard' {
        InModuleScope AITriad -Parameters @{ SummariesDir = $script:TempSummaries; SourcesDir = $script:TempSources } {
            param($SummariesDir, $SourcesDir)
            Mock Get-SummariesDir { return $SummariesDir }
            Mock Get-SourcesDir   { return $SourcesDir }

            $Results = @(Find-AITSource -Id '*')
            $Results.Count | Should -Be 1
            $Results[0].HitCount | Should -Be 5
        }
    }
}
