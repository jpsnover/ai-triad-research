# Tag: taxonomy (t/3955)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    POV-tag round-trips through the PowerShell write paths (t/3955, TL t/3955#4 condition 2).
.DESCRIPTION
    `pov_tags` is a top-level array on POV nodes. One tag is the common case, and it is exactly where
    PowerShell can unroll ["critical"] into the scalar "critical" (the t/3948 class). Each test writes a
    node carrying a ONE-element array through a real write path and asserts on the RAW JSON on disk that
    the field is still an array; reparsing with ConvertFrom-Json would hide the difference.
    A negative control proves the assertion actually detects an unroll.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # True iff the raw JSON writes pov_tags for $NodeId as an array containing exactly $Tag.
    function Test-TagsWrittenAsArray([string]$Raw, [string]$NodeId, [string]$Tag) {
        $doc = $Raw | ConvertFrom-Json -AsHashtable
        $node = $doc.nodes | Where-Object { $_.id -eq $NodeId } | Select-Object -First 1
        $isArray = $node.pov_tags -is [System.Collections.IList]
        $isArray -and ($node.pov_tags.Count -eq 1) -and ($node.pov_tags[0] -eq $Tag)
    }

    function New-TaggedTaxonomy([string]$Dir) {
        $skeptic = [ordered]@{
            nodes = @(
                [ordered]@{ id = 'skp-beliefs-001'; category = 'Beliefs'; label = 'Parent'; parent_id = $null; children = @(); situation_refs = @(); pov_tags = @('critical') }
                [ordered]@{ id = 'skp-beliefs-002'; category = 'Beliefs'; label = 'Child';  parent_id = $null; children = @(); situation_refs = @(); pov_tags = @('institutional') }
            )
            last_modified = '2026-01-01'
        }
        $skeptic | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $Dir 'skeptic.json')
        foreach ($f in 'accelerationist.json', 'safetyist.json', 'situations.json') {
            @{ nodes = @(); last_modified = '2026-01-01' } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $Dir $f)
        }
    }
}

Describe 'pov_tags round-trip through PowerShell writers (t/3955)' -Tag 'taxonomy' {

    BeforeEach {
        $script:TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "povtags-rt-$(Get-Random)"
        New-Item -ItemType Directory -Path $script:TempDir -Force | Out-Null
        New-TaggedTaxonomy -Dir $script:TempDir
        $script:SkepticPath = Join-Path $script:TempDir 'skeptic.json'
    }

    AfterEach {
        Remove-Item -Path $script:TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'ConvertFrom-Json then ConvertTo-Json -Depth 20 keeps a one-element array (the pattern every whole-file writer uses)' {
        $data = Get-Content -Raw $script:SkepticPath | ConvertFrom-Json
        ($data | ConvertTo-Json -Depth 20) | Set-Content -Path $script:SkepticPath
        $raw = Get-Content -Raw $script:SkepticPath
        Test-TagsWrittenAsArray $raw 'skp-beliefs-001' 'critical' | Should -BeTrue
        Test-TagsWrittenAsArray $raw 'skp-beliefs-002' 'institutional' | Should -BeTrue
    }

    It 'a pipeline-built node list keeps the tags (the Invoke-ProposalApply MERGE pattern: @($nodes | Where-Object))' {
        $data = Get-Content -Raw $script:SkepticPath | ConvertFrom-Json
        $data.nodes = @($data.nodes | Where-Object { $_.id -ne 'skp-beliefs-999' } | ForEach-Object { $_ })
        ($data | ConvertTo-Json -Depth 20) | Set-Content -Path $script:SkepticPath
        $raw = Get-Content -Raw $script:SkepticPath
        Test-TagsWrittenAsArray $raw 'skp-beliefs-001' 'critical' | Should -BeTrue
    }

    It 'Set-TaxonomyHierarchy (promote a parent, assign a child) keeps both nodes'' tags as arrays' {
        $ProposalPath = Join-Path $script:TempDir 'proposal.json'
        @{
            buckets = @(@{
                pov      = 'skeptic'
                category = 'Beliefs'
                parents  = @(@{
                    promoted_from = 'skp-beliefs-001'
                    children      = @(@{ node_id = 'skp-beliefs-002'; relationship = 'is_a'; rationale = 'fixture' })
                })
            })
        } | ConvertTo-Json -Depth 10 | Set-Content -Path $ProposalPath

        InModuleScope AITriad -Parameters @{ TempDir = $script:TempDir; ProposalPath = $ProposalPath } {
            param($TempDir, $ProposalPath)
            Mock Get-TaxonomyDir { $TempDir }
            Set-TaxonomyHierarchy -ProposalFile $ProposalPath -Confirm:$false -WarningAction SilentlyContinue | Out-Null
        }

        $raw = Get-Content -Raw $script:SkepticPath
        $doc = $raw | ConvertFrom-Json
        ($doc.nodes | Where-Object id -eq 'skp-beliefs-002').parent_id | Should -Be 'skp-beliefs-001' # the write really happened
        Test-TagsWrittenAsArray $raw 'skp-beliefs-001' 'critical' | Should -BeTrue
        Test-TagsWrittenAsArray $raw 'skp-beliefs-002' 'institutional' | Should -BeTrue
    }

    It 'NEGATIVE CONTROL: the assertion catches an unroll (pov_tags = $tags | ForEach-Object { $_ })' {
        $data = Get-Content -Raw $script:SkepticPath | ConvertFrom-Json
        $node = $data.nodes | Where-Object id -eq 'skp-beliefs-001'
        $node.pov_tags = $node.pov_tags | ForEach-Object { $_ }   # the hazard: a one-element pipeline unrolls to a scalar
        ($data | ConvertTo-Json -Depth 20) | Set-Content -Path $script:SkepticPath
        Test-TagsWrittenAsArray (Get-Content -Raw $script:SkepticPath) 'skp-beliefs-001' 'critical' | Should -BeFalse
    }
}
