# Tag: taxonomy (t/3910)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Characterization tests for Invoke-BDIWeightAssignment (t/3910, plan t/3910#9, TL t/3910#10),
    written BEFORE its complexity refactor so the same tests pass before and after.
.DESCRIPTION
    A data writer, so the main assertion is byte-identical written JSON on a fixture, compared with
    golden files in tests/fixtures/bdi-weight-assignment/ (line endings normalized, since
    ConvertTo-Json/Set-Content use the platform newline). Get-Date is frozen (TL cond 1): the
    function stamps *_history dates and Add-ChangeHistoryEntry stamps change_history timestamps.
    Write count/target and -DryRun are asserted separately (TL cond 2).

    Regenerate the goldens ONLY from pre-refactor code: set $env:BDI_WRITE_GOLDEN=1 and run.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    $script:GoldenDir = Join-Path $PSScriptRoot 'fixtures' 'bdi-weight-assignment'

    function New-BdiFixture {
        param([string]$Dir, [switch]$NoEvidence, [switch]$NoEdges)
        New-Item -ItemType Directory -Path $Dir -Force | Out-Null

        $skeptic = [ordered]@{
            last_modified = '2026-01-01'
            nodes = @(
                # ── Beliefs: every epistemic_type/falsifiability arm + boosts + clamps ──
                [ordered]@{ id = 'skp-beliefs-001'; category = 'Beliefs'; label = 'emp high, all boosts capped'
                            graph_attributes = [ordered]@{ epistemic_type = 'empirical_claim'; falsifiability = 'high' }
                            debate_refs = @('d1', 'd2', 'd3', 'd4', 'd5') }
                [ordered]@{ id = 'skp-beliefs-002'; category = 'Beliefs'; label = 'emp medium'
                            graph_attributes = [ordered]@{ epistemic_type = 'empirical_claim'; falsifiability = 'medium' } }
                [ordered]@{ id = 'skp-beliefs-003'; category = 'Beliefs'; label = 'emp low, attacked'
                            graph_attributes = [ordered]@{ epistemic_type = 'empirical_claim'; falsifiability = 'low' } }
                [ordered]@{ id = 'skp-beliefs-004'; category = 'Beliefs'; label = 'emp no falsifiability'
                            graph_attributes = [ordered]@{ epistemic_type = 'empirical_claim' } }
                [ordered]@{ id = 'skp-beliefs-005'; category = 'Beliefs'; label = 'predictive, bidirectional attack'
                            graph_attributes = [ordered]@{ epistemic_type = 'predictive' }; debate_refs = @('d1') }
                [ordered]@{ id = 'skp-beliefs-006'; category = 'Beliefs'; label = 'interpretive_lens'
                            graph_attributes = [ordered]@{ epistemic_type = 'interpretive_lens' } }
                [ordered]@{ id = 'skp-beliefs-007'; category = 'Beliefs'; label = 'definitional, has history'
                            graph_attributes = [ordered]@{ epistemic_type = 'definitional' }
                            change_history = @([ordered]@{ date = '2025-01-01T00:00:00'; action = 'created'; fields = @('label') }) }
                [ordered]@{ id = 'skp-beliefs-008'; category = 'Beliefs'; label = 'no graph_attributes' }
                [ordered]@{ id = 'skp-beliefs-009'; category = 'Beliefs'; label = 'unknown epistemic type'
                            graph_attributes = [ordered]@{ epistemic_type = 'speculative' } }
                # ── Desires: doctrinal / root / mid-tree / leaf ──
                [ordered]@{ id = 'skp-desires-001'; category = 'Desires'; label = 'doctrinal'; parent_id = 'skp-desires-002'; children = @() }
                [ordered]@{ id = 'skp-desires-002'; category = 'Desires'; label = 'root'; parent_id = $null; children = @('skp-desires-001') }
                [ordered]@{ id = 'skp-desires-003'; category = 'Desires'; label = 'mid'; parent_id = 'skp-desires-002'; children = @('skp-desires-004') }
                [ordered]@{ id = 'skp-desires-004'; category = 'Desires'; label = 'leaf'; parent_id = 'skp-desires-003'; children = @() }
                # ── Intentions: leaf/mid/root x falsifiability x situation bonus ──
                [ordered]@{ id = 'skp-intentions-001'; category = 'Intentions'; label = 'leaf high sit'; parent_id = 'skp-intentions-003'
                            children = @(); situation_refs = @('sit-001'); graph_attributes = [ordered]@{ falsifiability = 'high' } }
                [ordered]@{ id = 'skp-intentions-002'; category = 'Intentions'; label = 'mid low'; parent_id = 'skp-intentions-003'
                            children = @('skp-intentions-004'); graph_attributes = [ordered]@{ falsifiability = 'low' } }
                [ordered]@{ id = 'skp-intentions-003'; category = 'Intentions'; label = 'root'; parent_id = $null
                            children = @('skp-intentions-001', 'skp-intentions-002') }
                [ordered]@{ id = 'skp-intentions-004'; category = 'Intentions'; label = 'leaf plain'; parent_id = 'skp-intentions-002'
                            situation_refs = @() }
                # ── skipped: no category / unknown category ──
                [ordered]@{ id = 'skp-misc-001'; label = 'no category' }
                [ordered]@{ id = 'skp-misc-002'; category = 'Situations'; label = 'other category' }
            )
        }
        $skeptic | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $Dir 'skeptic.json') -Encoding UTF8

        $acc = [ordered]@{
            last_modified = '2026-01-01'
            nodes = @(
                [ordered]@{ id = 'acc-beliefs-001'; category = 'Beliefs'; label = 'acc emp high'
                            graph_attributes = [ordered]@{ epistemic_type = 'empirical_claim'; falsifiability = 'high' } }
                [ordered]@{ id = 'acc-desires-001'; category = 'Desires'; label = 'acc root desire'; children = @() }
                [ordered]@{ id = 'acc-intentions-001'; category = 'Intentions'; label = 'acc leaf intention' }
            )
        }
        $acc | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $Dir 'accelerationist.json') -Encoding UTF8

        if (-not $NoEvidence) {
            $sei = [ordered]@{
                'skp-beliefs-001' = [ordered]@{
                    facts     = @(@{ doc_id = 'doc-a' }, @{ doc_id = 'doc-b' }, @{ doc_id = 'DOC-A' })   # case-insensitive dedupe
                    keyPoints = @(@{ doc_id = 'doc-c' }, @{ doc_id = 'doc-d' }, @{ other = 'x' }) }
                'skp-beliefs-002' = [ordered]@{ facts = @(@{ doc_id = 'doc-a' }) }
                'skp-beliefs-006' = [ordered]@{ keyPoints = @(@{ doc_id = 'doc-a' }, @{ doc_id = 'doc-b' }) }
                'skp-beliefs-009' = [ordered]@{ facts = @() }
            }
            $sei | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $Dir 'source_evidence_index.json') -Encoding UTF8
        }

        if (-not $NoEdges) {
            $edges = [ordered]@{
                edges = @(
                    [ordered]@{ source = 'x1'; target = 'skp-beliefs-001'; type = 'SUPPORTS' }
                    [ordered]@{ source = 'x2'; target = 'skp-beliefs-001'; type = 'SUPPORTS' }
                    [ordered]@{ source = 'x3'; target = 'skp-beliefs-001'; type = 'SUPPORTS' }
                    [ordered]@{ source = 'x1'; target = 'skp-beliefs-003'; type = 'CONTRADICTS' }
                    [ordered]@{ source = 'x2'; target = 'skp-beliefs-003'; type = 'WEAKENS' }
                    [ordered]@{ source = 'x3'; target = 'skp-beliefs-003'; type = 'CONTRADICTS' }
                    [ordered]@{ source = 'skp-beliefs-005'; target = 'x9'; type = 'CONTRADICTS'; bidirectional = $true }
                    [ordered]@{ source = 'skp-beliefs-002'; target = 'skp-beliefs-006'; type = 'SUPPORTS'; bidirectional = $true }
                    [ordered]@{ source = 'x1'; target = 'skp-beliefs-002'; type = 'SUPPORTS'; status = 'rejected' }
                    [ordered]@{ source = 'x1'; target = 'skp-beliefs-002'; type = 'RELATED_TO' }
                    [ordered]@{ source = 'x1'; target = 'skp-beliefs-002' }
                    [ordered]@{ source = 'x1'; type = 'SUPPORTS' }
                )
            }
            $edges | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $Dir 'edges.json') -Encoding UTF8
        }
    }

    function Get-NormalizedText([string]$Path) { (Get-Content -Raw -LiteralPath $Path) -replace "`r`n", "`n" }

    function Get-DirHashes([string]$Dir) {
        $h = [ordered]@{}
        foreach ($f in Get-ChildItem -LiteralPath $Dir -File | Sort-Object Name) {
            $h[$f.Name] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
        }
        $h
    }
}

Describe 'Invoke-BDIWeightAssignment (t/3910 characterization)' -Tag 'taxonomy' {

    BeforeEach {
        $script:TaxDir = Join-Path $TestDrive "bdi-$(New-Guid)"
        $script:FrozenNow = [datetime]::new(2026, 3, 4, 5, 6, 7, [System.DateTimeKind]::Utc)
        Mock -ModuleName AITriad Get-TaxonomyDir { $script:TaxDir }
        # TL cond 1: freeze the clock for both the *_history date (-Format) and change_history (.ToString('o')).
        Mock -ModuleName AITriad Get-Date {
            $d = [datetime]::new(2026, 3, 4, 5, 6, 7, [System.DateTimeKind]::Utc)
            if ($Format) { $d.ToString($Format) } else { $d }
        }
        $script:BoundaryMap = @{ skeptic = @('skp-desires-001') }
    }

    Context 'byte-identical written JSON on the fixture' {

        It 'writes skeptic.json exactly as the golden file' {
            New-BdiFixture -Dir $script:TaxDir
            Invoke-BDIWeightAssignment -POV skeptic -DoctrinalBoundaryMap $script:BoundaryMap -Confirm:$false 6>$null
            $actual = Get-NormalizedText (Join-Path $script:TaxDir 'skeptic.json')
            $golden = Join-Path $script:GoldenDir 'expected-skeptic.json'
            if ($env:BDI_WRITE_GOLDEN -eq '1') { [System.IO.File]::WriteAllText($golden, $actual) }
            $actual | Should -BeExactly (Get-NormalizedText $golden)
        }

        It 'writes accelerationist.json exactly as the golden file (no boundary map, POV absent from it)' {
            New-BdiFixture -Dir $script:TaxDir
            Invoke-BDIWeightAssignment -POV accelerationist -DoctrinalBoundaryMap $script:BoundaryMap -Confirm:$false 6>$null
            $actual = Get-NormalizedText (Join-Path $script:TaxDir 'accelerationist.json')
            $golden = Join-Path $script:GoldenDir 'expected-accelerationist.json'
            if ($env:BDI_WRITE_GOLDEN -eq '1') { [System.IO.File]::WriteAllText($golden, $actual) }
            $actual | Should -BeExactly (Get-NormalizedText $golden)
        }

        It 'writes skeptic.json exactly as the no-evidence/no-edges golden file when both inputs are missing' {
            New-BdiFixture -Dir $script:TaxDir -NoEvidence -NoEdges
            Invoke-BDIWeightAssignment -POV skeptic -Confirm:$false -WarningAction SilentlyContinue 6>$null
            $actual = Get-NormalizedText (Join-Path $script:TaxDir 'skeptic.json')
            $golden = Join-Path $script:GoldenDir 'expected-skeptic-noinputs.json'
            if ($env:BDI_WRITE_GOLDEN -eq '1') { [System.IO.File]::WriteAllText($golden, $actual) }
            $actual | Should -BeExactly (Get-NormalizedText $golden)
        }
    }

    Context 'computed values (readable pins on the golden behavior)' {

        BeforeEach {
            New-BdiFixture -Dir $script:TaxDir
            Invoke-BDIWeightAssignment -POV skeptic -DoctrinalBoundaryMap $script:BoundaryMap -Confirm:$false 6>$null
            $doc = Get-Content -Raw (Join-Path $script:TaxDir 'skeptic.json') | ConvertFrom-Json
            $script:ById = @{}
            foreach ($n in $doc.nodes) { $script:ById[$n.id] = $n }
        }

        It 'Belief confidence: <Id> = <Expected>' -ForEach @(
            @{ Id = 'skp-beliefs-001'; Expected = 0.95 }   # 0.80 + 0.15 + 0.10 + 0.05 = 1.10 -> clamped
            @{ Id = 'skp-beliefs-002'; Expected = 0.77 }   # 0.70 + 0.05 evidence + 0.02 (source of a bidirectional SUPPORTS; rejected + untyped edges ignored)
            @{ Id = 'skp-beliefs-003'; Expected = 0.55 }   # 0.60 - 0.05 (3 attacks, capped)
            @{ Id = 'skp-beliefs-004'; Expected = 0.70 }
            @{ Id = 'skp-beliefs-005'; Expected = 0.41 }   # 0.40 + 0.03 debate - 0.02 bidirectional attack
            @{ Id = 'skp-beliefs-006'; Expected = 0.62 }   # 0.50 + 0.10 evidence + 0.02 support
            @{ Id = 'skp-beliefs-007'; Expected = 0.50 }
            @{ Id = 'skp-beliefs-008'; Expected = 0.50 }
            @{ Id = 'skp-beliefs-009'; Expected = 0.50 }
        ) {
            $script:ById[$Id].confidence | Should -Be $Expected
        }

        It 'Desire priority: <Id> = <Expected>' -ForEach @(
            @{ Id = 'skp-desires-001'; Expected = 5 }
            @{ Id = 'skp-desires-002'; Expected = 4 }
            @{ Id = 'skp-desires-003'; Expected = 3 }
            @{ Id = 'skp-desires-004'; Expected = 2 }
        ) {
            $script:ById[$Id].priority | Should -Be $Expected
        }

        It 'Intention operationality: <Id> = <Expected>' -ForEach @(
            @{ Id = 'skp-intentions-001'; Expected = 5 }   # leaf 4 + high 1 + sit 1 = 6 -> clamped
            @{ Id = 'skp-intentions-002'; Expected = 2 }   # mid 3 - low 1
            @{ Id = 'skp-intentions-003'; Expected = 2 }   # root
            @{ Id = 'skp-intentions-004'; Expected = 4 }   # leaf
        ) {
            $script:ById[$Id].operationality | Should -Be $Expected
        }

        It 'stamps history with the frozen date and prepends change_history' {
            $b7 = $script:ById['skp-beliefs-007']
            $b7.confidence_history[0].date | Should -Be '2026-03-04'
            @($b7.change_history).Count | Should -Be 2
            @($b7.change_history)[0].fields | Should -Be @('confidence', 'confidence_history')
        }

        It 'skips nodes with no category or an unknown category' {
            $script:ById['skp-misc-001'].PSObject.Properties['confidence'] | Should -BeNullOrEmpty
            $script:ById['skp-misc-002'].PSObject.Properties['priority'] | Should -BeNullOrEmpty
        }
    }

    Context 'writes and -DryRun (TL cond 2)' {

        It 'writes exactly once per processed POV file, to that file' {
            New-BdiFixture -Dir $script:TaxDir
            Mock -ModuleName AITriad Assert-DataWriteAllowed { }
            Invoke-BDIWeightAssignment -POV skeptic, accelerationist -Confirm:$false 6>$null
            Should -Invoke -ModuleName AITriad Assert-DataWriteAllowed -Times 2 -Exactly
            Should -Invoke -ModuleName AITriad Assert-DataWriteAllowed -Times 1 -Exactly -ParameterFilter { $Path -eq (Join-Path $script:TaxDir 'skeptic.json') }
            Should -Invoke -ModuleName AITriad Assert-DataWriteAllowed -Times 1 -Exactly -ParameterFilter { $Path -eq (Join-Path $script:TaxDir 'accelerationist.json') }
        }

        It 'skips a missing POV file with a warning and writes nothing for it' {
            New-BdiFixture -Dir $script:TaxDir
            Mock -ModuleName AITriad Assert-DataWriteAllowed { }
            $warn = $null
            Invoke-BDIWeightAssignment -POV safetyist -Confirm:$false -WarningVariable warn -WarningAction SilentlyContinue 6>$null
            @($warn) -join ';' | Should -Match 'Taxonomy file not found'
            Should -Invoke -ModuleName AITriad Assert-DataWriteAllowed -Times 0 -Exactly
        }

        It '-DryRun leaves every file untouched (POV files, source_evidence_index.json, edges.json)' {
            New-BdiFixture -Dir $script:TaxDir
            $before = Get-DirHashes $script:TaxDir
            Invoke-BDIWeightAssignment -POV skeptic, accelerationist -DryRun 6>$null
            $after = Get-DirHashes $script:TaxDir
            ($after | ConvertTo-Json) | Should -Be ($before | ConvertTo-Json)
            @($before.Keys) | Should -Contain 'source_evidence_index.json'
            @($before.Keys) | Should -Contain 'edges.json'
        }

        It '-WhatIf writes nothing either' {
            New-BdiFixture -Dir $script:TaxDir
            $before = Get-DirHashes $script:TaxDir
            Invoke-BDIWeightAssignment -POV skeptic -WhatIf 6>$null
            (Get-DirHashes $script:TaxDir | ConvertTo-Json) | Should -Be ($before | ConvertTo-Json)
        }

        It 'warns (Fallback-Path Logging) when source_evidence_index.json and edges.json are missing' {
            New-BdiFixture -Dir $script:TaxDir -NoEvidence -NoEdges
            $warn = $null
            Invoke-BDIWeightAssignment -POV skeptic -DryRun -WarningVariable warn -WarningAction SilentlyContinue 6>$null
            $all = @($warn) -join ';'
            $all | Should -Match 'source_evidence_index\.json not found'
            $all | Should -Match 'edges\.json not found'
        }

        It 'each fallback WARN names the file path and the condition (missing) (t/3910#42)' {
            New-BdiFixture -Dir $script:TaxDir -NoEvidence -NoEdges
            $warn = $null
            Invoke-BDIWeightAssignment -POV skeptic -DryRun -WarningVariable warn -WarningAction SilentlyContinue 6>$null
            $SeiWarn  = @($warn | ForEach-Object { "$_" } | Where-Object { $_ -match 'source_evidence_index\.json' })
            $EdgeWarn = @($warn | ForEach-Object { "$_" } | Where-Object { $_ -match 'edges\.json' })
            $SeiWarn.Count | Should -Be 1
            $EdgeWarn.Count | Should -Be 1
            $SeiWarn[0] | Should -Match ([regex]::Escape((Join-Path $script:TaxDir 'source_evidence_index.json')))
            $SeiWarn[0] | Should -Match 'missing: the file does not exist'
            $EdgeWarn[0] | Should -Match ([regex]::Escape((Join-Path $script:TaxDir 'edges.json')))
            $EdgeWarn[0] | Should -Match 'missing: the file does not exist'
        }

        It 'an UNREADABLE <File> is not a fallback: it throws and writes nothing (t/3910#42)' -ForEach @(
            @{ File = 'edges.json' }
            @{ File = 'source_evidence_index.json' }
        ) {
            New-BdiFixture -Dir $script:TaxDir -BoundaryMap $script:BoundaryMap
            Set-Content -LiteralPath (Join-Path $script:TaxDir $File) -Value '{ this is not json' -Encoding UTF8
            $before = Get-DirHashes $script:TaxDir
            { Invoke-BDIWeightAssignment -POV skeptic -Confirm:$false -WarningAction SilentlyContinue 6>$null } | Should -Throw
            (Get-DirHashes $script:TaxDir | ConvertTo-Json) | Should -Be ($before | ConvertTo-Json)
        }
    }
}

Describe 'Get-EdgeBalanceCounts contract: non-rejected edges only (t/3910#42)' -Tag 'taxonomy' {

    BeforeEach {
        $script:EdgeFile = Join-Path $TestDrive "edges-$(New-Guid).json"
        function Write-Edges([object[]]$Edges) {
            [ordered]@{ edges = $Edges } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $script:EdgeFile -Encoding UTF8
        }
    }

    It 'a rejected <Type> edge contributes 0 even though it is in edges.json' -ForEach @(
        @{ Type = 'SUPPORTS';    Bucket = 'Supports' }
        @{ Type = 'CONTRADICTS'; Bucket = 'Attacks' }
        @{ Type = 'WEAKENS';     Bucket = 'Attacks' }
    ) {
        Write-Edges @([ordered]@{ source = 's'; target = 'n1'; type = $Type; status = 'rejected'; bidirectional = $true })
        $c = InModuleScope AITriad -Parameters @{ P = $script:EdgeFile } { param($P) Get-EdgeBalanceCounts -Path $P 6>$null }
        $c[$Bucket].ContainsKey('n1') | Should -BeFalse
        $c[$Bucket].ContainsKey('s') | Should -BeFalse -Because 'a rejected bidirectional edge counts for neither end'
    }

    It 'control: the same <Type> edge without the rejected status counts 1 (the exclusion is narrow)' -ForEach @(
        @{ Type = 'SUPPORTS';    Bucket = 'Supports' }
        @{ Type = 'CONTRADICTS'; Bucket = 'Attacks' }
        @{ Type = 'WEAKENS';     Bucket = 'Attacks' }
    ) {
        Write-Edges @([ordered]@{ source = 's'; target = 'n1'; type = $Type; status = 'approved' })
        $c = InModuleScope AITriad -Parameters @{ P = $script:EdgeFile } { param($P) Get-EdgeBalanceCounts -Path $P 6>$null }
        $c[$Bucket]['n1'] | Should -Be 1
    }

    It 'a rejected edge does not change a node''s count from its accepted edges' {
        Write-Edges @(
            [ordered]@{ source = 'a'; target = 'n1'; type = 'SUPPORTS' }
            [ordered]@{ source = 'b'; target = 'n1'; type = 'SUPPORTS'; status = 'rejected' }
            [ordered]@{ source = 'c'; target = 'n1'; type = 'SUPPORTS' }
        )
        $c = InModuleScope AITriad -Parameters @{ P = $script:EdgeFile } { param($P) Get-EdgeBalanceCounts -Path $P 6>$null }
        $c.Supports['n1'] | Should -Be 2
    }
}
