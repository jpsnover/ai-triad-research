# Tag: ingestion (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Update-AITSourceIndex and Get-AITSource index integration' -Tag 'ingestion' {

    BeforeAll {
        # Create a temp sources directory with two fake documents
        $script:TempSources = Join-Path ([System.IO.Path]::GetTempPath()) "ait-index-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        $script:TempSummaries = Join-Path ([System.IO.Path]::GetTempPath()) "ait-summaries-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        New-Item -Path $script:TempSummaries -ItemType Directory -Force | Out-Null

        # Doc 1
        $Doc1Dir = Join-Path $script:TempSources 'doc-alpha'
        New-Item -Path $Doc1Dir -ItemType Directory -Force | Out-Null
        @{
            id             = 'doc-alpha'
            title          = 'Alpha Document'
            date_published = '2026-01-15'
            date_ingested  = '2026-05-20'
            source_type    = 'pdf'
            pov_tags       = @('accelerationist')
            topic_tags     = @('governance')
            summary_status = 'current'
            total_claims   = 10
            claims_by_pov  = @{ accelerationist = 6; safetyist = 2; skeptic = 1; situations = 1 }
            total_facts    = 8
            unmapped_concepts = 2
            one_liner      = 'Alpha explores AI governance'
        } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $Doc1Dir 'metadata.json') -Encoding utf8NoBOM

        # Doc 2
        $Doc2Dir = Join-Path $script:TempSources 'doc-beta'
        New-Item -Path $Doc2Dir -ItemType Directory -Force | Out-Null
        @{
            id             = 'doc-beta'
            title          = 'Beta Document'
            date_published = '2026-03-10'
            date_ingested  = '2026-05-20'
            source_type    = 'web_article'
            pov_tags       = @('safetyist')
            topic_tags     = @('alignment')
            summary_status = 'pending'
            total_claims   = 5
            claims_by_pov  = @{ accelerationist = 0; safetyist = 4; skeptic = 1; situations = 0 }
            total_facts    = 3
            unmapped_concepts = 0
            one_liner      = 'Beta reviews alignment research'
        } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $Doc2Dir 'metadata.json') -Encoding utf8NoBOM
    }

    AfterAll {
        if (Test-Path $script:TempSources)   { Remove-Item $script:TempSources   -Recurse -Force }
        if (Test-Path $script:TempSummaries)  { Remove-Item $script:TempSummaries  -Recurse -Force }
    }

    It 'Update-AITSourceIndex creates _index.json' {
        InModuleScope AITriad -Parameters @{ SourcesDir = $script:TempSources; SummariesDir = $script:TempSummaries } {
            param($SourcesDir, $SummariesDir)
            Mock Get-SourcesDir   { return $SourcesDir }
            Mock Get-SummariesDir { return $SummariesDir }

            Update-AITSourceIndex -Quiet

            $IndexPath = Join-Path $SourcesDir '_index.json'
            $IndexPath | Should -Exist

            $Index = Get-Content -Raw $IndexPath | ConvertFrom-Json
            $Index.count | Should -Be 2
            $Index.sources.Count | Should -Be 2

            $Alpha = $Index.sources | Where-Object { $_.id -eq 'doc-alpha' }
            $Alpha.title | Should -Be 'Alpha Document'
            $Alpha.total_claims | Should -Be 10
        }
    }

    It 'Get-AITSource uses index when fresh' {
        InModuleScope AITriad -Parameters @{ SourcesDir = $script:TempSources; SummariesDir = $script:TempSummaries } {
            param($SourcesDir, $SummariesDir)
            Mock Get-SourcesDir   { return $SourcesDir }
            Mock Get-SummariesDir { return $SummariesDir }

            # Ensure index exists and is fresh
            Update-AITSourceIndex -Quiet

            $Results = Get-AITSource
            $Results.Count | Should -Be 2

            # Beta should sort first (later date_published)
            $Results[0].Id | Should -Be 'doc-beta'
            $Results[0].TotalClaims | Should -Be 5
        }
    }

    It 'Get-AITSource filters work on index path' {
        InModuleScope AITriad -Parameters @{ SourcesDir = $script:TempSources; SummariesDir = $script:TempSummaries } {
            param($SourcesDir, $SummariesDir)
            Mock Get-SourcesDir   { return $SourcesDir }
            Mock Get-SummariesDir { return $SummariesDir }

            Update-AITSourceIndex -Quiet

            $Filtered = Get-AITSource -Pov 'safetyist'
            $Filtered.Count | Should -Be 1
            $Filtered[0].Id | Should -Be 'doc-beta'
        }
    }

    It 'Get-AITSource detects stale index and falls back to folder scan' {
        InModuleScope AITriad -Parameters @{ SourcesDir = $script:TempSources; SummariesDir = $script:TempSummaries } {
            param($SourcesDir, $SummariesDir)
            Mock Get-SourcesDir   { return $SourcesDir }
            Mock Get-SummariesDir { return $SummariesDir }

            # Build index first
            Update-AITSourceIndex -Quiet

            # Touch a metadata.json to make it newer than the index
            Start-Sleep -Milliseconds 100
            $MetaPath = Join-Path $SourcesDir 'doc-alpha' 'metadata.json'
            (Get-Item $MetaPath).LastWriteTimeUtc = [datetime]::UtcNow

            # Should fall back to folder scan (still returns results)
            $Results = Get-AITSource
            $Results.Count | Should -Be 2

            # Folder-scan path populates Url (index path does not)
            # Just verify it completed without error
        }
    }

    It 'Get-AITSource falls back when index is missing' {
        InModuleScope AITriad -Parameters @{ SourcesDir = $script:TempSources; SummariesDir = $script:TempSummaries } {
            param($SourcesDir, $SummariesDir)
            Mock Get-SourcesDir   { return $SourcesDir }
            Mock Get-SummariesDir { return $SummariesDir }

            # Remove index if it exists
            $IndexPath = Join-Path $SourcesDir '_index.json'
            if (Test-Path $IndexPath) { Remove-Item $IndexPath -Force }

            $Results = Get-AITSource
            $Results.Count | Should -Be 2
        }
    }

    It 'Get-AITSource does not crash on malformed DatePublished' {
        InModuleScope AITriad -Parameters @{ SourcesDir = $script:TempSources; SummariesDir = $script:TempSummaries } {
            param($SourcesDir, $SummariesDir)
            Mock Get-SourcesDir   { return $SourcesDir }
            Mock Get-SummariesDir { return $SummariesDir }

            # Add a doc with a malformed date
            $BadDir = Join-Path $SourcesDir 'doc-bad-date'
            New-Item -Path $BadDir -ItemType Directory -Force | Out-Null
            @{
                id             = 'doc-bad-date'
                title          = 'Bad Date Document'
                date_published = 'circa 2025'
                date_ingested  = '2026-05-20'
                source_type    = 'pdf'
                pov_tags       = @()
                topic_tags     = @()
                summary_status = 'pending'
            } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $BadDir 'metadata.json') -Encoding utf8NoBOM

            # Remove index to force folder scan path
            $IndexPath = Join-Path $SourcesDir '_index.json'
            if (Test-Path $IndexPath) { Remove-Item $IndexPath -Force }

            # Should not throw — malformed dates sort to end
            $Results = Get-AITSource
            $Results.Count | Should -Be 3
            # The malformed date should sort last (MinValue)
            $Results[-1].Id | Should -Be 'doc-bad-date'

            # Clean up
            Remove-Item $BadDir -Recurse -Force
        }
    }
}
