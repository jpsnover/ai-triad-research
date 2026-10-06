# Tag: taxonomy (t/3971)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    pov_tags carry-forward on Invoke-ProposalApply MERGE/SPLIT/DEPTH_EXPAND/WIDTH_EXPAND/NEW
    (t/3971; CL t/3955#5 decisions). Union on MERGE, inherit on SPLIT/DEPTH_EXPAND, untagged
    on WIDTH_EXPAND/NEW. Validates through the pov-tags-cli gate before writing — mocked with
    pwsh stubs (same technique as Set-PovNodeTags.Tests.ps1) so these tests don't depend on
    the live (currently empty) tag registry. Assertions read the RAW JSON on disk, never a
    reparsed object, per the one-element-array unroll discipline (t/3948-class).
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    $script:StubDir = Join-Path ([System.IO.Path]::GetTempPath()) "proposalapply-stub-$(New-Guid)"
    New-Item -ItemType Directory -Path $script:StubDir -Force | Out-Null
    $script:PwshExe = (Get-Process -Id $PID).Path

    # ok stub: echoes {checked = count of --input entries, invalid=0, errors=[]}, exit 0.
    $script:OkStub = Join-Path $script:StubDir 'ok.ps1'
    Set-Content -LiteralPath $script:OkStub -Encoding UTF8 -Value @'
param()
$inputIdx = [array]::IndexOf($args, '--input')
$raw = Get-Content -Raw -LiteralPath $args[$inputIdx + 1]
$n = @($raw | ConvertFrom-Json).Count
Write-Output (@{ checked = $n; invalid = 0; errors = @() } | ConvertTo-Json -Compress)
exit 0
'@

    # invalid stub: refuses everything handed to it, exit 1.
    $script:InvalidStub = Join-Path $script:StubDir 'invalid.ps1'
    Set-Content -LiteralPath $script:InvalidStub -Encoding UTF8 -Value @'
param()
$inputIdx = [array]::IndexOf($args, '--input')
$raw = Get-Content -Raw -LiteralPath $args[$inputIdx + 1]
$n = @($raw | ConvertFrom-Json).Count
Write-Output (@{ checked = $n; invalid = 1; errors = @('fixture: tag not registered') } | ConvertTo-Json -Compress)
exit 1
'@

    # Raw-JSON (not reparsed) check that $NodeId's pov_tags is an array with exactly the
    # given elements (empty array for $Expected = @()). $null = the key is absent entirely.
    function Test-NodeTagsRaw([string]$Raw, [string]$NodeId, $Expected) {
        $doc = $Raw | ConvertFrom-Json -AsHashtable
        $node = @($doc.nodes | Where-Object { $_.id -eq $NodeId })[0]
        if ($null -eq $Expected) { return -not $node.ContainsKey('pov_tags') }
        if (-not $node.ContainsKey('pov_tags')) { return $false }
        $actual = $node['pov_tags']
        if ($actual -isnot [System.Collections.IList]) { return $false }
        if (@($actual).Count -ne @($Expected).Count) { return $false }
        $sortedActual = @($actual) | Sort-Object
        $sortedExpected = @($Expected) | Sort-Object
        for ($i = 0; $i -lt $sortedExpected.Count; $i++) { if ($sortedActual[$i] -ne $sortedExpected[$i]) { return $false } }
        return $true
    }
}

AfterAll {
    Remove-Item -LiteralPath $script:StubDir -Recurse -Force -ErrorAction SilentlyContinue
}

Describe 'Invoke-ProposalApply pov_tags carry-forward (t/3971)' -Tag 'taxonomy' {

    BeforeEach {
        $script:TaxDir = Join-Path $script:StubDir "tax-$(New-Guid)"
        New-Item -ItemType Directory -Path $script:TaxDir -Force | Out-Null
        $script:SkepticPath = Join-Path $script:TaxDir 'skeptic.json'
    }

    Context 'MERGE (CL t/3955#5: union, de-duplicated)' {
        BeforeEach {
            Mock -ModuleName AITriad Resolve-PovTagsCli { @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:OkStub) } }
        }

        It 'unions a two-tag set with a duplicate across survivor + merged node' {
            @{
                last_modified = '2026-01-01'
                nodes = @(
                    [ordered]@{ id = 'skp-beliefs-001'; category = 'Beliefs'; label = 'Survivor'; pov_tags = @('critical') },
                    [ordered]@{ id = 'skp-beliefs-002'; category = 'Beliefs'; label = 'Merged';   pov_tags = @('critical', 'rights-based') }
                )
            } | ConvertTo-Json -Depth 10 | Set-Content -Path $script:SkepticPath

            $proposal = @{ action = 'MERGE'; pov = 'skeptic'; surviving_node_id = 'skp-beliefs-001'; merge_node_ids = @('skp-beliefs-001', 'skp-beliefs-002'); label = $null; description = $null } | ConvertTo-Json | ConvertFrom-Json

            $result = InModuleScope AITriad -Parameters @{ TaxDir = $script:TaxDir; P = $proposal } {
                param($TaxDir, $P)
                Mock Get-TaxonomyDir { $TaxDir }
                Invoke-ProposalApply -Proposal $P -WarningAction SilentlyContinue
            }

            $result.Success | Should -BeTrue -Because $result.Error
            $raw = Get-Content -Raw $script:SkepticPath
            Test-NodeTagsRaw $raw 'skp-beliefs-001' @('critical', 'rights-based') | Should -BeTrue

            # t/3971 (TL review of #2855): the flag is DATA, not just console output.
            @($result.PovTagReview).Count | Should -Be 1
            $result.PovTagReview[0].NodeId | Should -Be 'skp-beliefs-001'
            $result.PovTagReview[0].Reason | Should -Be 'merge-union'
            @($result.PovTagReview[0].Tags | Sort-Object) -join ',' | Should -Be 'critical,rights-based'
        }

        It 'a ONE-element union (the unroll-prone case): survivor untagged, merged node carries one tag' {
            @{
                last_modified = '2026-01-01'
                nodes = @(
                    [ordered]@{ id = 'skp-beliefs-001'; category = 'Beliefs'; label = 'Survivor' },
                    [ordered]@{ id = 'skp-beliefs-002'; category = 'Beliefs'; label = 'Merged'; pov_tags = @('critical') }
                )
            } | ConvertTo-Json -Depth 10 | Set-Content -Path $script:SkepticPath

            $proposal = @{ action = 'MERGE'; pov = 'skeptic'; surviving_node_id = 'skp-beliefs-001'; merge_node_ids = @('skp-beliefs-001', 'skp-beliefs-002'); label = $null; description = $null } | ConvertTo-Json | ConvertFrom-Json

            $result = InModuleScope AITriad -Parameters @{ TaxDir = $script:TaxDir; P = $proposal } {
                param($TaxDir, $P)
                Mock Get-TaxonomyDir { $TaxDir }
                Invoke-ProposalApply -Proposal $P -WarningAction SilentlyContinue
            }

            $result.Success | Should -BeTrue -Because $result.Error
            Test-NodeTagsRaw (Get-Content -Raw $script:SkepticPath) 'skp-beliefs-001' @('critical') | Should -BeTrue
        }
    }

    Context 'SPLIT (CL t/3955#5: children inherit the parent''s tags)' {
        BeforeEach {
            Mock -ModuleName AITriad Resolve-PovTagsCli { @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:OkStub) } }
        }

        It 'a child inherits the parent''s ONE-element pov_tags array' {
            @{ last_modified = '2026-01-01'; nodes = @([ordered]@{ id = 'skp-beliefs-001'; category = 'Beliefs'; label = 'Parent'; children = @(); pov_tags = @('critical') }) } |
                ConvertTo-Json -Depth 10 | Set-Content -Path $script:SkepticPath

            $proposal = @{
                action = 'SPLIT'; pov = 'skeptic'; target_node_id = 'skp-beliefs-001'
                children = @(@{ suggested_id = 'skp-beliefs-002'; label = 'Child'; description = 'd' })
            } | ConvertTo-Json -Depth 10 | ConvertFrom-Json

            $result = InModuleScope AITriad -Parameters @{ TaxDir = $script:TaxDir; P = $proposal } {
                param($TaxDir, $P)
                Mock Get-TaxonomyDir { $TaxDir }
                Invoke-ProposalApply -Proposal $P -WarningAction SilentlyContinue
            }

            $result.Success | Should -BeTrue -Because $result.Error
            Test-NodeTagsRaw (Get-Content -Raw $script:SkepticPath) 'skp-beliefs-002' @('critical') | Should -BeTrue

            @($result.PovTagReview).Count | Should -Be 1
            $result.PovTagReview[0].NodeId | Should -Be 'skp-beliefs-002'
            $result.PovTagReview[0].Reason | Should -Be 'split-inherit'
        }

        It 'an untagged parent leaves the child untagged (no pov_tags key created)' {
            @{ last_modified = '2026-01-01'; nodes = @([ordered]@{ id = 'skp-beliefs-001'; category = 'Beliefs'; label = 'Parent'; children = @() }) } |
                ConvertTo-Json -Depth 10 | Set-Content -Path $script:SkepticPath

            $proposal = @{
                action = 'SPLIT'; pov = 'skeptic'; target_node_id = 'skp-beliefs-001'
                children = @(@{ suggested_id = 'skp-beliefs-002'; label = 'Child'; description = 'd' })
            } | ConvertTo-Json -Depth 10 | ConvertFrom-Json

            $result = InModuleScope AITriad -Parameters @{ TaxDir = $script:TaxDir; P = $proposal } {
                param($TaxDir, $P)
                Mock Get-TaxonomyDir { $TaxDir }
                Invoke-ProposalApply -Proposal $P -WarningAction SilentlyContinue
            }

            $result.Success | Should -BeTrue -Because $result.Error
            Test-NodeTagsRaw (Get-Content -Raw $script:SkepticPath) 'skp-beliefs-002' $null | Should -BeTrue
            @($result.PovTagReview).Count | Should -Be 0 -Because 'nothing changed, so the review list is empty'
        }
    }

    Context 'DEPTH_EXPAND (same inheritance rule as SPLIT)' {
        BeforeEach {
            Mock -ModuleName AITriad Resolve-PovTagsCli { @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:OkStub) } }
        }

        It 'an intermediate node inherits the dense parent''s pov_tags' {
            @{ last_modified = '2026-01-01'; nodes = @([ordered]@{ id = 'skp-beliefs-001'; category = 'Beliefs'; label = 'Dense'; children = @(); pov_tags = @('a', 'b') }) } |
                ConvertTo-Json -Depth 10 | Set-Content -Path $script:SkepticPath

            $proposal = @{
                action = 'DEPTH_EXPAND'; pov = 'skeptic'; target_node_id = 'skp-beliefs-001'
                children = @(@{ suggested_id = 'skp-beliefs-010'; label = 'SubGroup'; description = 'd' })
            } | ConvertTo-Json -Depth 10 | ConvertFrom-Json

            $result = InModuleScope AITriad -Parameters @{ TaxDir = $script:TaxDir; P = $proposal } {
                param($TaxDir, $P)
                Mock Get-TaxonomyDir { $TaxDir }
                Invoke-ProposalApply -Proposal $P -WarningAction SilentlyContinue
            }

            $result.Success | Should -BeTrue -Because $result.Error
            Test-NodeTagsRaw (Get-Content -Raw $script:SkepticPath) 'skp-beliefs-010' @('a', 'b') | Should -BeTrue

            @($result.PovTagReview).Count | Should -Be 1
            $result.PovTagReview[0].NodeId | Should -Be 'skp-beliefs-010'
            $result.PovTagReview[0].Reason | Should -Be 'depth-inherit'
        }
    }

    Context 'WIDTH_EXPAND and NEW (CL t/3955#5: start untagged)' {
        BeforeEach {
            Mock -ModuleName AITriad Resolve-PovTagsCli { throw 'must not be called — WIDTH_EXPAND/NEW carry no tags to validate' }
        }

        It 'WIDTH_EXPAND creates a node with no pov_tags key' {
            @{ last_modified = '2026-01-01'; nodes = @() } | ConvertTo-Json -Depth 10 | Set-Content -Path $script:SkepticPath
            $proposal = @{ action = 'WIDTH_EXPAND'; pov = 'skeptic'; suggested_id = 'skp-beliefs-020'; category = 'Beliefs'; label = 'New'; description = 'd' } |
                ConvertTo-Json | ConvertFrom-Json

            $result = InModuleScope AITriad -Parameters @{ TaxDir = $script:TaxDir; P = $proposal } {
                param($TaxDir, $P)
                Mock Get-TaxonomyDir { $TaxDir }
                Invoke-ProposalApply -Proposal $P -WarningAction SilentlyContinue
            }

            $result.Success | Should -BeTrue -Because $result.Error
            Test-NodeTagsRaw (Get-Content -Raw $script:SkepticPath) 'skp-beliefs-020' $null | Should -BeTrue
        }

        It 'NEW creates a node with no pov_tags key' {
            @{ last_modified = '2026-01-01'; nodes = @() } | ConvertTo-Json -Depth 10 | Set-Content -Path $script:SkepticPath
            $proposal = @{ action = 'NEW'; pov = 'skeptic'; suggested_id = 'skp-beliefs-021'; category = 'Beliefs'; label = 'New'; description = 'd' } |
                ConvertTo-Json | ConvertFrom-Json

            $result = InModuleScope AITriad -Parameters @{ TaxDir = $script:TaxDir; P = $proposal } {
                param($TaxDir, $P)
                Mock Get-TaxonomyDir { $TaxDir }
                Invoke-ProposalApply -Proposal $P -WarningAction SilentlyContinue
            }

            $result.Success | Should -BeTrue -Because $result.Error
            Test-NodeTagsRaw (Get-Content -Raw $script:SkepticPath) 'skp-beliefs-021' $null | Should -BeTrue
        }
    }

    Context 'refusal: an invalid carry-forward writes nothing' {
        It 'REFUSES the whole apply when the CLI reports an invalid union — target file untouched' {
            Mock -ModuleName AITriad Resolve-PovTagsCli { @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:InvalidStub) } }

            $fixture = @{
                last_modified = '2026-01-01'
                nodes = @(
                    [ordered]@{ id = 'skp-beliefs-001'; category = 'Beliefs'; label = 'Survivor'; pov_tags = @('critical') },
                    [ordered]@{ id = 'skp-beliefs-002'; category = 'Beliefs'; label = 'Merged';   pov_tags = @('bogus') }
                )
            } | ConvertTo-Json -Depth 10
            $fixture | Set-Content -Path $script:SkepticPath
            $before = Get-Content -Raw $script:SkepticPath

            $proposal = @{ action = 'MERGE'; pov = 'skeptic'; surviving_node_id = 'skp-beliefs-001'; merge_node_ids = @('skp-beliefs-001', 'skp-beliefs-002'); label = $null; description = $null } | ConvertTo-Json | ConvertFrom-Json

            $result = InModuleScope AITriad -Parameters @{ TaxDir = $script:TaxDir; P = $proposal } {
                param($TaxDir, $P)
                Mock Get-TaxonomyDir { $TaxDir }
                Invoke-ProposalApply -Proposal $P -WarningAction SilentlyContinue
            }

            $result.Success | Should -BeFalse
            (Get-Content -Raw $script:SkepticPath) | Should -Be $before -Because 'a refused apply must leave the file byte-identical'
        }
    }
}
