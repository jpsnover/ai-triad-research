# Tag: taxonomy-write-scope (t/3943)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    End-to-end regression test for t/3943: Invoke-BatchSummary's post-batch
    step used to call `Update-PolicyRegistry -Fix`, which corpus-wide-
    rewrote taxonomy files for nodes unrelated to the batch just run.
.DESCRIPTION
    Drives the real Invoke-BatchSummary with ZERO source documents (empty
    sources/) so Step 9 (the post-batch registry check) is reached without
    needing any AI mocking -- the doc-collection loop yields nothing, there
    is no -DocId filter so no "no matching documents" throw, and the batch
    completes with 0 processed/0 failed. Asserts: (1) no taxonomy file's
    content changes across the call, and (2) a WARNING fires naming the
    drifted node. Must fail if the old `Update-PolicyRegistry -Fix` line is
    restored (confirmed empirically).
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-BatchSummary -- post-batch policy registry step is read-only' -Tag 'taxonomy-write-scope' {

    BeforeEach {
        $script:root        = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:sourcesDir   = Join-Path $root 'sources'
        $script:summariesDir = Join-Path $root 'summaries'
        $script:conflictsDir = Join-Path $root 'conflicts'
        $script:taxonomyDir  = Join-Path $root 'taxonomy'
        New-Item -ItemType Directory -Path $sourcesDir, $summariesDir, $conflictsDir, $taxonomyDir -Force | Out-Null

        $versionFile = Join-Path $root 'TAXONOMY_VERSION'
        Set-Content -Path $versionFile -Value '1.0.0' -Encoding utf8

        # One source doc whose pov_tags don't intersect any camp -- it is
        # marked "current" without any AI call (Step 4), letting the batch
        # reach Step 9 with zero actual summarization work.
        $docDir = Join-Path $sourcesDir 'doc-1'
        New-Item -ItemType Directory -Path $docDir -Force | Out-Null
        Set-Content -Path (Join-Path $docDir 'snapshot.md') -Value '# Doc' -Encoding utf8
        $meta = [ordered]@{ id = 'doc-1'; title = 'Doc 1'; pov_tags = @('nonexistent-camp'); summary_status = 'pending' }
        Set-Content -Path (Join-Path $docDir 'metadata.json') -Value ($meta | ConvertTo-Json -Depth 10) -Encoding utf8

        # One node with a null-policy_id policy action -- the exact shape
        # t/3943 reported (skp-beliefs-313/314, sit-488). This node must
        # survive the batch run byte-for-byte.
        $skepticContent = ([ordered]@{
            nodes = @(
                [ordered]@{
                    id               = 'skp-beliefs-313'
                    label            = 'Pre-existing node unrelated to this batch'
                    graph_attributes = [ordered]@{
                        policy_actions = @(
                            [ordered]@{ action = 'Some pre-existing action'; framing = 'skeptic'; policy_id = $null }
                        )
                    }
                }
            )
        } | ConvertTo-Json -Depth 10)
        $script:skepticPath = Join-Path $taxonomyDir 'skeptic.json'
        Set-Content -Path $skepticPath -Value $skepticContent -Encoding utf8

        foreach ($f in 'accelerationist', 'safetyist', 'situations') {
            Set-Content -Path (Join-Path $taxonomyDir "$f.json") -Value '{"nodes":[]}' -Encoding utf8
        }
        Set-Content -Path (Join-Path $taxonomyDir 'policy_actions.json') -Value '{"_schema_version":"1.0.0","policy_count":0,"policies":[]}' -Encoding utf8

        Mock Get-SourcesDir    -ModuleName AITriad { $script:sourcesDir }
        Mock Get-SummariesDir  -ModuleName AITriad { $script:summariesDir }
        Mock Get-ConflictsDir  -ModuleName AITriad { $script:conflictsDir }
        Mock Get-TaxonomyDir   -ModuleName AITriad { $script:taxonomyDir }
        Mock Get-VersionFile   -ModuleName AITriad { $versionFile }
        # Invoke-BatchSummary resolves an API key unconditionally in Step 0,
        # before doc collection -- without this mock the test only passed
        # locally because of a real key in the environment; failed in CI
        # with "No API key found" (caught on PR #2828's first CI run).
        Mock Resolve-AIApiKey  -ModuleName AITriad { 'fake-key' }
    }

    It 'does not modify ANY taxonomy file, and WARNs naming the drifted node' {
        $before = @{}
        foreach ($f in 'accelerationist', 'safetyist', 'skeptic', 'situations', 'policy_actions') {
            $before[$f] = Get-Content -Path (Join-Path $taxonomyDir "$f.json") -Raw
        }

        Invoke-BatchSummary -WarningVariable warnings 6>$null 1>$null | Out-Null

        foreach ($f in 'accelerationist', 'safetyist', 'skeptic', 'situations', 'policy_actions') {
            $after = Get-Content -Path (Join-Path $taxonomyDir "$f.json") -Raw
            $after | Should -Be $before[$f] -Because "t/3943: the batch path must never write $f.json as a side effect"
        }

        $driftWarning = @($warnings) | Where-Object { $_ -match 'skp-beliefs-313' }
        @($driftWarning).Count | Should -BeGreaterThan 0 -Because 'the drift WARN must name the actual unregistered node id'
    }
}
