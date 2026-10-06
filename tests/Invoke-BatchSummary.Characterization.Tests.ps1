# Tag: ingestion (t/3910, #2871)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Characterization tests for Invoke-BatchSummary, written against the pre-refactor
    implementation (complexity 146) before decomposing it (t/3910, issue #2871).
.DESCRIPTION
    Pins observable behavior end to end: environment validation, the git-diff camp
    triage, the ImportedToday/ImportedSince/DocId filters, DryRun, the mark-current
    write, all three processing paths (sequential, FIRE via Invoke-POVSummary, and the
    debate-context prompt injection), conflict detection, the final report, the
    extraction-metrics JSONL line, the source-index rebuild, and the read-only registry
    drift check. Every AI-touching and corpus-touching dependency is mocked; all writes
    land under $TestDrive. The parallel path is not driven here (Pester mocks do not
    reach ForEach-Object -Parallel runspaces) -- its mechanism is covered by
    Invoke-BatchSummary.ParallelResilience.Tests.ps1.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force -WarningAction SilentlyContinue

    function script:New-Doc {
        param([string]$Id, [string[]]$PovTags, [string]$Snapshot = '# Doc', [switch]$NoSnapshot, [string]$Ingested, [int]$WordCount, [string]$Parent)
        if (-not $Parent) { $Parent = $script:sourcesDir }
        $dir = Join-Path $Parent $Id
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        if (-not $NoSnapshot) { Set-Content -Path (Join-Path $dir 'snapshot.md') -Value $Snapshot -Encoding utf8 -NoNewline }
        $meta = [ordered]@{ id = $Id; title = "Title $Id"; pov_tags = @($PovTags); summary_status = 'pending' }
        if ($Ingested)  { $meta['date_ingested'] = $Ingested }
        if ($WordCount) { $meta['word_count'] = $WordCount }
        Set-Content -Path (Join-Path $dir 'metadata.json') -Value ($meta | ConvertTo-Json -Depth 10) -Encoding utf8
    }

    function script:Get-Meta([string]$Id) {
        Get-Content -Path (Join-Path $script:sourcesDir "$Id/metadata.json") -Raw | ConvertFrom-Json
    }

    function script:Get-MetricsLines {
        $path = Join-Path $script:root 'calibration/core/extraction-metrics.jsonl'
        if (-not (Test-Path $path)) { return @() }
        @(Get-Content -Path $path | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
    }

    # Runs the cmdlet and returns its host output as one string (Write-Host is stream 6).
    function script:Invoke-Batch {
        param([hashtable]$Splat = @{})
        (Invoke-BatchSummary @Splat 6>&1 3>$null | Out-String)
    }
}

Describe 'Invoke-BatchSummary characterization (t/3910)' -Tag 'ingestion' {

    BeforeEach {
        $script:root         = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:sourcesDir   = Join-Path $root 'sources'
        $script:summariesDir = Join-Path $root 'summaries'
        $script:conflictsDir = Join-Path $root 'conflicts'
        $script:taxonomyDir  = Join-Path $root 'taxonomy'
        New-Item -ItemType Directory -Path $sourcesDir, $taxonomyDir -Force | Out-Null

        $script:versionFile = Join-Path $root 'TAXONOMY_VERSION'
        Set-Content -Path $versionFile -Value "2.0.0`n" -Encoding utf8
        foreach ($f in 'accelerationist', 'safetyist', 'skeptic', 'situations') {
            Set-Content -Path (Join-Path $taxonomyDir "$f.json") -Value '{"nodes":[{"id":"x"}]}' -Encoding utf8
        }

        Mock Get-SourcesDir   -ModuleName AITriad { $script:sourcesDir }
        Mock Get-SummariesDir -ModuleName AITriad { $script:summariesDir }
        Mock Get-ConflictsDir -ModuleName AITriad { $script:conflictsDir }
        Mock Get-TaxonomyDir  -ModuleName AITriad { $script:taxonomyDir }
        Mock Get-VersionFile  -ModuleName AITriad { $script:versionFile }
        Mock Get-DataRoot     -ModuleName AITriad { $script:root }
        Mock Resolve-AIApiKey -ModuleName AITriad { 'fake-key' }
        # The t/2902 dirty-tree guard shells out to git for paths under the (mocked) data
        # root; every write here is in $TestDrive, and the git-diff tests mock `git` itself.
        Mock Assert-DataWriteAllowed -ModuleName AITriad { }
        Mock Get-Prompt      -ModuleName AITriad { "PROMPT:$Name" }
        Mock Update-AITSourceIndex -ModuleName AITriad { }
        Mock Invoke-QbafConflictAnalysis -ModuleName AITriad { }
        Mock Get-UnregisteredPolicyActionNodeIds -ModuleName AITriad { @() }
        Mock Invoke-POVSummary -ModuleName AITriad { }
        Mock Invoke-DocSummaryWithCapture -ModuleName AITriad {
            [PSCustomObject]@{ Success = $true; DocId = $Doc.DocId; TotalPoints = 3; NullNodes = 0; FactualCount = 2; UnmappedCount = 1; ElapsedSecs = 4; ChunkCount = 0 }
        }
    }

    Context 'environment validation' {

        It 'throws when no API key resolves and this is not a dry run' {
            Mock Resolve-AIApiKey -ModuleName AITriad { '' }
            New-Doc -Id 'd1' -PovTags 'safetyist'
            { Invoke-Batch @{ ForceAll = $true } } | Should -Throw 'No API key found for gemini backend.'
        }

        It 'does not require an API key under -DryRun' {
            Mock Resolve-AIApiKey -ModuleName AITriad { '' }
            New-Doc -Id 'd1' -PovTags 'safetyist'
            { Invoke-Batch @{ ForceAll = $true; DryRun = $true } } | Should -Not -Throw
        }

        It 'throws when the version file is missing' {
            Remove-Item $versionFile
            { Invoke-Batch @{ ForceAll = $true } } | Should -Throw "Required path not found: $versionFile"
        }

        It 'throws when a taxonomy file is missing' {
            Remove-Item (Join-Path $taxonomyDir 'skeptic.json')
            { Invoke-Batch @{ ForceAll = $true } } | Should -Throw 'Taxonomy file missing: skeptic.json'
        }

        It 'creates the summaries and conflicts directories when absent' {
            New-Doc -Id 'd1' -PovTags 'safetyist'
            Invoke-Batch @{ ForceAll = $true; DryRun = $true } | Out-Null
            Test-Path $summariesDir | Should -BeTrue
            Test-Path $conflictsDir | Should -BeTrue
        }
    }

    Context 'triage and filters' {

        It 'DryRun lists the plan and makes no calls and no writes' {
            New-Doc -Id 'd1' -PovTags 'safetyist'
            $before = Get-Content (Join-Path $sourcesDir 'd1/metadata.json') -Raw
            $out = Invoke-Batch @{ ForceAll = $true; DryRun = $true }
            $out | Should -Match 'WOULD REPROCESS \(1 docs\)'
            $out | Should -Match 'd1  \[pov: safetyist\]'
            $out | Should -Match 'DRY RUN complete'
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 0 -Exactly
            Get-Content (Join-Path $sourcesDir 'd1/metadata.json') -Raw | Should -Be $before
            @(Get-MetricsLines).Count | Should -Be 0
        }

        It '-WhatIf behaves as -DryRun' {
            New-Doc -Id 'd1' -PovTags 'safetyist'
            $out = Invoke-Batch @{ ForceAll = $true; WhatIf = $true }
            $out | Should -Match 'DRY RUN complete'
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 0 -Exactly
        }

        It 'skips docs whose snapshot is missing or empty, and ignores _inbox' {
            New-Doc -Id 'good' -PovTags 'safetyist'
            New-Doc -Id 'nosnap' -PovTags 'safetyist' -NoSnapshot
            New-Doc -Id 'empty' -PovTags 'safetyist' -Snapshot ''
            New-Doc -Id 'inboxed' -PovTags 'safetyist' -Parent (Join-Path $sourcesDir '_inbox')
            $out = Invoke-Batch @{ ForceAll = $true }
            $out | Should -Match 'SKIP nosnap — snapshot.md missing'
            $out | Should -Match 'SKIP empty — snapshot.md is empty'
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 1 -Exactly
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 1 -Exactly -ParameterFilter { $Doc.DocId -eq 'good' }
            (Get-Meta 'nosnap').summary_status | Should -Be 'pending'
        }

        It 'throws when a -DocId filter matches nothing' {
            New-Doc -Id 'd1' -PovTags 'safetyist'
            { Invoke-Batch @{ DocId = 'nope', 'nada' } } | Should -Throw 'No matching documents found: nope, nada'
        }

        It '-DocId processes only the named docs (pipeline input, de-duplicated), regardless of POV' {
            New-Doc -Id 'd1' -PovTags 'nobody'
            New-Doc -Id 'd2' -PovTags 'safetyist'
            ([PSCustomObject]@{ DocId = 'd1' }), ([PSCustomObject]@{ DocId = 'd1' }) | Invoke-BatchSummary 6>$null 3>$null
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 1 -Exactly -ParameterFilter { $Doc.DocId -eq 'd1' }
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 0 -Exactly -ParameterFilter { $Doc.DocId -eq 'd2' }
            (Get-Meta 'd2').summary_status | Should -Be 'pending' -Because 'non-matching docs are dropped, not marked current'
        }

        It 'git diff of TAXONOMY_VERSION commits picks the affected camps; others are marked current' {
            Mock git -ModuleName AITriad -ParameterFilter { $args[0] -eq 'log' } { 'bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa' }
            Mock git -ModuleName AITriad -ParameterFilter { $args[0] -eq 'diff' } { 'taxonomy/Origin/safetyist.json', 'taxonomy/Origin/README.md' }
            New-Doc -Id 'saf' -PovTags 'safetyist'
            New-Doc -Id 'acc' -PovTags 'accelerationist'
            New-Doc -Id 'none' -PovTags @()
            $out = Invoke-Batch
            $out | Should -Match 'Git diff range: aaaaaaaa...bbbbbbbb'
            $out | Should -Match 'Changed taxonomy files: safetyist.json'
            $out | Should -Match 'Affected POV camps: safetyist'
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 1 -Exactly -ParameterFilter { $Doc.DocId -eq 'saf' }
            foreach ($id in 'acc', 'none') {
                $m = Get-Meta $id
                $m.summary_status  | Should -Be 'current'
                $m.summary_version | Should -Be '2.0.0'
                Get-Content (Join-Path $sourcesDir "$id/metadata.json") -Raw |
                    Should -Match '"summary_updated":\s*"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ"'
            }
            (Get-Meta 'saf').summary_status | Should -Be 'pending' -Because 'the mocked summarizer writes nothing'
        }

        It 'situations.json fans out to every camp' {
            Mock git -ModuleName AITriad -ParameterFilter { $args[0] -eq 'log' } { 'bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa' }
            Mock git -ModuleName AITriad -ParameterFilter { $args[0] -eq 'diff' } { 'taxonomy/Origin/situations.json' }
            New-Doc -Id 'acc' -PovTags 'accelerationist'
            New-Doc -Id 'skp' -PovTags 'skeptic'
            $out = Invoke-Batch
            $out | Should -Match 'Affected POV camps: accelerationist, safetyist, skeptic, situations'
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 2 -Exactly
        }

        It 'treats every taxonomy file as changed when there is only one version commit' {
            Mock git -ModuleName AITriad -ParameterFilter { $args[0] -eq 'log' } { 'bbbbbbbbbbbbbbbb' }
            New-Doc -Id 'acc' -PovTags 'accelerationist'
            $out = Invoke-Batch
            $out | Should -Match 'No previous version commit found'
            $out | Should -Match 'Changed taxonomy files: accelerationist.json, safetyist.json, skeptic.json, situations.json'
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 1 -Exactly
        }

        It 'returns early, touching nothing, when no taxonomy file changed' {
            Mock git -ModuleName AITriad -ParameterFilter { $args[0] -eq 'log' } { 'bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa' }
            Mock git -ModuleName AITriad -ParameterFilter { $args[0] -eq 'diff' } { 'taxonomy/Origin/README.md' }
            New-Doc -Id 'acc' -PovTags 'accelerationist'
            $out = Invoke-Batch
            $out | Should -Match 'No taxonomy files changed. Nothing to reprocess.'
            (Get-Meta 'acc').summary_status | Should -Be 'pending'
            Should -Invoke Update-AITSourceIndex -ModuleName AITriad -Times 0 -Exactly
        }

        It 'returns early with a warning when there are no source documents' {
            $out = Invoke-Batch @{ ForceAll = $true }
            $out | Should -Match 'No source documents found in'
            Should -Invoke Update-AITSourceIndex -ModuleName AITriad -Times 0 -Exactly
        }

        It '-ImportedToday keeps only docs ingested today' {
            New-Doc -Id 'today' -PovTags 'safetyist' -Ingested (Get-Date -Format 'yyyy-MM-dd')
            New-Doc -Id 'old' -PovTags 'safetyist' -Ingested '2020-01-01'
            $out = Invoke-Batch @{ ForceAll = $true; ImportedToday = $true }
            $out | Should -Match 'ImportedToday filter: 1 documents'
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 1 -Exactly -ParameterFilter { $Doc.DocId -eq 'today' }
        }

        It '-ImportedSince keeps docs on or after the date and drops undated or malformed ones' {
            New-Doc -Id 'on'        -PovTags 'safetyist' -Ingested '2026-03-10'
            New-Doc -Id 'after'     -PovTags 'safetyist' -Ingested '2026-04-01'
            New-Doc -Id 'before'    -PovTags 'safetyist' -Ingested '2026-03-09'
            New-Doc -Id 'undated'   -PovTags 'safetyist'
            New-Doc -Id 'malformed' -PovTags 'safetyist' -Ingested 'March 2026'
            $out = Invoke-Batch @{ ForceAll = $true; ImportedSince = [datetime]'2026-03-10T15:00:00' }
            $out | Should -Match 'Filtering to documents imported since 2026-03-10'
            $out | Should -Match 'ImportedSince filter: 2 documents ingested on or after 2026-03-10'
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 2 -Exactly
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 0 -Exactly -ParameterFilter { $Doc.DocId -in 'before', 'undated', 'malformed' }
        }
    }

    Context 'processing paths' {

        It 'sequential path passes the shared params to Invoke-DocSummaryWithCapture' {
            New-Doc -Id 'd1' -PovTags 'safetyist'
            Invoke-Batch @{ ForceAll = $true; Temperature = 0.3 } | Out-Null
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 1 -Exactly -ParameterFilter {
                $Params.ApiKey -eq 'fake-key' -and
                $Params.Model -eq 'gemini-3.5-flash-lite' -and
                $Params.Temperature -eq 0.3 -and
                $Params.TaxonomyVersion -eq '2.0.0' -and
                $Params.SystemPromptTemplate -eq 'PROMPT:pov-summary-system' -and
                $Params.ChunkSystemPromptTemplate -eq 'PROMPT:pov-summary-chunk-system' -and
                $Params.OutputSchema -eq 'PROMPT:pov-summary-schema' -and
                $Params.SummariesDir -eq $script:summariesDir -and
                $Params.TaxonomyJson -match '"skeptic.json"' -and
                $Doc.SnapshotFile -eq (Join-Path $script:sourcesDir 'd1/snapshot.md') -and
                @($Doc.PovTags) -contains 'safetyist'
            }
        }

        It 'injects applied debate_ref harvest items into the sequential system prompt' {
            $hd = Join-Path $root 'harvests'
            New-Item -ItemType Directory -Path $hd -Force | Out-Null
            @{ debate_title = 'Debate A'; items = @(
                @{ type = 'debate_ref'; status = 'applied'; id = 'saf-beliefs-001' }
                @{ type = 'debate_ref'; status = 'pending'; id = 'saf-beliefs-002' }
                @{ type = 'other';      status = 'applied'; id = 'saf-beliefs-003' }
            ) } | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $hd 'a.json')
            @{ debate_title = 'Debate B'; items = @(@{ type = 'debate_ref'; status = 'applied'; id = 'saf-beliefs-001' }) } |
                ConvertTo-Json -Depth 5 | Set-Content (Join-Path $hd 'b.json')
            Set-Content (Join-Path $hd 'broken.json') '{not json'
            New-Doc -Id 'd1' -PovTags 'safetyist'

            $out = Invoke-Batch @{ ForceAll = $true }
            $out | Should -Match 'Loaded debate context for 1 contested nodes'
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 1 -Exactly -ParameterFilter {
                $Params.SystemPromptTemplate.StartsWith("PROMPT:pov-summary-system`n`nDEBATE CONTEXT: ") -and
                $Params.SystemPromptTemplate.EndsWith('Node saf-beliefs-001 has been contested in debates: Debate A, Debate B. Pay close attention to claims about this node.') -and
                $Params.SystemPromptTemplate -notmatch 'saf-beliefs-00[23]'
            }
        }

        It 'a failed doc is reported, excluded from conflict detection, and fails the batch at the end' {
            Mock Invoke-DocSummaryWithCapture -ModuleName AITriad {
                if ($Doc.DocId -eq 'bad') { return [PSCustomObject]@{ Success = $false; DocId = 'bad'; Error = 'boom' } }
                [PSCustomObject]@{ Success = $true; DocId = $Doc.DocId; TotalPoints = 1; NullNodes = 0; FactualCount = 0; UnmappedCount = 0; ElapsedSecs = 2; ChunkCount = 0 }
            }
            New-Doc -Id 'bad' -PovTags 'safetyist'
            New-Doc -Id 'good' -PovTags 'safetyist'
            $script:captured = ''
            { $script:captured = Invoke-Batch @{ ForceAll = $true } } | Should -Throw '1 document(s) failed during batch summarization.'
            Should -Invoke Invoke-QbafConflictAnalysis -ModuleName AITriad -Times 1 -Exactly -ParameterFilter { $DocId -eq 'good' }
            Should -Invoke Update-AITSourceIndex -ModuleName AITriad -Times 1 -Exactly
            Should -Invoke Get-UnregisteredPolicyActionNodeIds -ModuleName AITriad -Times 1 -Exactly
            $m = @(Get-MetricsLines)
            $m.Count | Should -Be 1 -Because 'metrics are logged before the final throw'
            $m[0].documents_failed | Should -Be 1
        }

        It 'a failed doc writes the re-run hint to the report' {
            Mock Invoke-DocSummaryWithCapture -ModuleName AITriad { [PSCustomObject]@{ Success = $false; DocId = $Doc.DocId; Error = 'boom' } }
            New-Doc -Id 'bad' -PovTags 'safetyist'
            $lines = [System.Collections.Generic.List[string]]::new()
            try { Invoke-BatchSummary -ForceAll 6>&1 3>$null | ForEach-Object { $lines.Add("$_") } } catch { }
            $text = $lines -join "`n"
            $text | Should -Match '✗ bad — boom'
            $text | Should -Match 'Reprocessed   : 0 / 1 succeeded'
            $text | Should -Match "Invoke-BatchSummary -DocId 'bad'"
        }

        It '-SkipConflictDetection skips QBAF' {
            New-Doc -Id 'd1' -PovTags 'safetyist'
            Invoke-Batch @{ ForceAll = $true; SkipConflictDetection = $true } | Out-Null
            Should -Invoke Invoke-QbafConflictAnalysis -ModuleName AITriad -Times 0 -Exactly
        }

        It 'a QBAF failure only warns' {
            Mock Invoke-QbafConflictAnalysis -ModuleName AITriad { throw 'qbaf down' }
            New-Doc -Id 'd1' -PovTags 'safetyist'
            $out = Invoke-Batch @{ ForceAll = $true }
            $out | Should -Match 'Invoke-QbafConflictAnalysis failed for d1: qbaf down'
        }

        It '-IterativeExtraction routes through Invoke-POVSummary and reads stats back from the summary file' {
            New-Item -ItemType Directory -Path $summariesDir -Force | Out-Null
            Mock Invoke-POVSummary -ModuleName AITriad {
                @{ pov_summaries = @{
                        accelerationist = @{ key_points = @(@{ label = 'a' }, @{ label = 'b' }) }
                        skeptic         = @{ key_points = @(@{ label = 'c' }) }
                    }
                    factual_claims = @(1, 2, 3)
                    unmapped_concepts = @(1)
                } | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $script:summariesDir "$DocId.json")
            }
            New-Doc -Id 'd1' -PovTags 'safetyist'
            $out = Invoke-Batch @{ ForceAll = $true; IterativeExtraction = $true }
            $out | Should -Match 'Using Invoke-POVSummary path \(-IterativeExtraction\)'
            Should -Invoke Invoke-POVSummary -ModuleName AITriad -Times 1 -Exactly -ParameterFilter {
                $DocId -eq 'd1' -and $IterativeExtraction -and -not $AutoFire -and $Force -and $ApiKey -eq 'fake-key'
            }
            Should -Invoke Invoke-DocSummaryWithCapture -ModuleName AITriad -Times 0 -Exactly
            $m = (Get-MetricsLines)[0]
            $m.total_key_points     | Should -Be 3
            $m.total_factual_claims | Should -Be 3
            $m.total_unmapped       | Should -Be 1
            $m.fire_enabled         | Should -BeTrue
        }

        It '-AutoFire routes through Invoke-POVSummary; a missing summary file counts as zero stats' {
            New-Doc -Id 'd1' -PovTags 'safetyist'
            $out = Invoke-Batch @{ ForceAll = $true; AutoFire = $true }
            $out | Should -Match 'Using Invoke-POVSummary path \(-AutoFire\)'
            Should -Invoke Invoke-POVSummary -ModuleName AITriad -Times 1 -Exactly -ParameterFilter { $AutoFire -and -not $IterativeExtraction }
            $m = (Get-MetricsLines)[0]
            $m.documents_success | Should -Be 1
            $m.total_key_points  | Should -Be 0
        }

        It 'a throwing Invoke-POVSummary is a failed doc, not a crash' {
            Mock Invoke-POVSummary -ModuleName AITriad { throw 'fire failed' }
            New-Doc -Id 'd1' -PovTags 'safetyist'
            { Invoke-Batch @{ ForceAll = $true; AutoFire = $true } } | Should -Throw '1 document(s) failed during batch summarization.'
            Should -Invoke Invoke-QbafConflictAnalysis -ModuleName AITriad -Times 0 -Exactly
        }
    }

    Context 'report, metrics and post-batch steps' {

        It 'logs one extraction-metrics JSONL line with density and near-duplicate stats' {
            Mock Invoke-DocSummaryWithCapture -ModuleName AITriad {
                if ($Doc.DocId -eq 'a') { return [PSCustomObject]@{ Success = $true; DocId = 'a'; TotalPoints = 3; NullNodes = 0; FactualCount = 2; UnmappedCount = 1; ElapsedSecs = 10; ChunkCount = 2 } }
                [PSCustomObject]@{ Success = $true; DocId = 'b'; TotalPoints = 1; NullNodes = 0; FactualCount = 0; UnmappedCount = 0; ElapsedSecs = 6; ChunkCount = 0 }
            }
            New-Doc -Id 'a' -PovTags 'safetyist' -WordCount 1000
            New-Doc -Id 'b' -PovTags 'safetyist' -WordCount 500
            New-Item -ItemType Directory -Path $summariesDir -Force | Out-Null
            @{ pov_summaries = @{
                    safetyist = @{ key_points = @(@{ label = 'AI risk is large' }, @{ label = 'AI risk is very large' }) }
                    skeptic   = @{ key_points = @(@{ label = 'Something else entirely' }) }
            } } | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $summariesDir 'a.json')

            $out = Invoke-Batch @{ ForceAll = $true; Temperature = 0.2 }

            $out | Should -Match 'Reprocessed   : 2 / 2 succeeded'
            $out | Should -Match 'Total points  : 4 \(1 new concepts\)'
            $out | Should -Match 'Factual claims: 2'
            $out | Should -Match 'Chunked docs  : 1 \(2 total chunks\)'
            $out | Should -Match 'Total API time: 16s \(~8s/doc avg\)'
            $out | Should -Match 'density mean: 3.5 claims/1k words, 1 near-dup label pairs'

            $lines = @(Get-MetricsLines)
            $lines.Count | Should -Be 1
            $m = $lines[0]
            $m.model             | Should -Be 'gemini-3.5-flash-lite'
            $m.temperature       | Should -Be 0.2
            $m.taxonomy_version  | Should -Be '2.0.0'
            $m.documents_total   | Should -Be 2
            $m.documents_success | Should -Be 2
            $m.documents_failed  | Should -Be 0
            $m.fire_enabled      | Should -BeFalse
            $m.total_key_points  | Should -Be 4
            $m.total_api_seconds | Should -Be 16
            $m.near_duplicate_labels | Should -Be 1
            $m.density_stats.mean | Should -Be 3.5
            $m.density_stats.p25  | Should -Be 2
            $m.density_stats.p50  | Should -Be 5
            $m.density_stats.p75  | Should -Be 5
            $m.density_stats.min  | Should -Be 2
            $m.density_stats.max  | Should -Be 5
            $a = $m.per_document | Where-Object doc_id -eq 'a'
            $a.claims_per_1k | Should -Be 5
            $a.word_count    | Should -Be 1000
            $a.chunks        | Should -Be 2
            $a.elapsed_secs  | Should -Be 10

            Invoke-Batch @{ ForceAll = $true } | Out-Null
            @(Get-MetricsLines).Count | Should -Be 2 -Because 'each run appends one line'
        }

        It 'near-duplicate count is 0 when key points carry only `point` (pins current behavior)' {
            # Real summaries' key_points have `point`, never `label`. Under StrictMode the
            # `$_.label ?? ...` read throws, the empty catch swallows it, and the summary
            # contributes 0. This pins that behavior through the refactor; it is a known
            # metric bug reported separately, not something a pure refactor should change.
            New-Doc -Id 'a' -PovTags 'safetyist'
            New-Item -ItemType Directory -Path $summariesDir -Force | Out-Null
            @{ pov_summaries = @{
                    safetyist = @{ key_points = @(@{ point = 'AI risk is large' }, @{ point = 'AI risk is very large' }) }
            } } | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $summariesDir 'a.json')
            Invoke-Batch @{ ForceAll = $true } | Out-Null
            (Get-MetricsLines)[0].near_duplicate_labels | Should -Be 0
        }

        It 'metrics density stats are null when no doc has a word count' {
            New-Doc -Id 'd1' -PovTags 'safetyist'
            $out = Invoke-Batch @{ ForceAll = $true }
            $out | Should -Match 'density mean: N/A claims/1k words'
            $m = (Get-MetricsLines)[0]
            $m.density_stats.mean | Should -BeNullOrEmpty
            ($m.per_document | Select-Object -First 1).claims_per_1k | Should -BeNullOrEmpty
        }

        It 'rebuilds the source index quietly and tolerates its failure' {
            Mock Update-AITSourceIndex -ModuleName AITriad { throw 'index down' }
            New-Doc -Id 'd1' -PovTags 'safetyist'
            { Invoke-Batch @{ ForceAll = $true } } | Should -Not -Throw
            Should -Invoke Update-AITSourceIndex -ModuleName AITriad -Times 1 -Exactly -ParameterFilter { $Quiet }
        }

        It 'registry drift only warns, naming the nodes' {
            Mock Get-UnregisteredPolicyActionNodeIds -ModuleName AITriad { 'skp-beliefs-313', 'sit-488' }
            New-Doc -Id 'd1' -PovTags 'safetyist'
            Invoke-BatchSummary -ForceAll -WarningVariable w 6>$null 3>$null | Out-Null
            @($w | Where-Object { "$_" -match '2 taxonomy node\(s\).*skp-beliefs-313, sit-488' }).Count | Should -Be 1
        }

        It 'a consistent registry reports OK' {
            New-Doc -Id 'd1' -PovTags 'safetyist'
            $out = Invoke-Batch @{ ForceAll = $true }
            $out | Should -Match 'Policy registry consistent'
        }
    }
}
