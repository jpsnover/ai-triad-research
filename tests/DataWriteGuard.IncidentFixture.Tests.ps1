# Tag: summary (t/2902)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Canonical dirty-situations incident fixture for the data-write guard (t/2902,
    CL fixture shape t/2902#13) — encodes commit 128ce8f4.
.DESCRIPTION
    The t/2896 sweep (commit 128ce8f4) whole-file round-tripped a summary that the
    working tree had left dirty, carrying TWO sweep signatures into a "stance-only"
    commit:
      (1) a SEMANTIC ride-along — `resolved_node_id` added to an unmapped_concepts
          entry, and
      (2) the WHOLE-FILE ROUND-TRIP TELL — cosmetic float->int churn (`3.0 -> 3`) on
          untargeted graph_attributes.

    Signature (2) is load-bearing: it fires even when NO semantic field rides along,
    so it catches the MECHANISM (ConvertFrom-Json | ConvertTo-Json re-serialize), not
    just the symptom. This guard checks `git status` (not field content), so it fires
    on ANY uncommitted change to the target — proven here for the semantic arm, the
    numeric-churn-ONLY arm, and mirrored on taxonomy/Origin/situations.json.

    Fixture edits are SURGICAL (string splice / value swap) so each signature is
    isolated in the diff — a whole-file reformat would blur them together.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    $script:OrigDataRoot  = [Environment]::GetEnvironmentVariable('AI_TRIAD_DATA_ROOT')
    $script:OrigGuardMode = [Environment]::GetEnvironmentVariable('AI_TRIAD_DATA_WRITE_GUARD')

    # A committed-clean summary carrying float graph_attributes (3.0) + an
    # unmapped_concepts entry WITHOUT resolved_node_id. LF, stable layout so the
    # surgical edits below produce isolated diffs.
    $script:CleanSummary = @'
{
  "pov_summaries": {
    "safetyist": {
      "key_points": [
        { "stance": "aligned", "taxonomy_node_id": "saf-beliefs-017" }
      ]
    }
  },
  "graph_attributes": { "in_count": 3.0, "out_count": 5.0, "ratio": 3.0 },
  "unmapped_concepts": [
    { "concept": "digital sovereignty", "suggested_pov": "situations" }
  ]
}
'@ -replace "`r`n", "`n"

    function New-IncidentRepo {
        param([string]$Root, [string]$RelPath = 'summaries/democracy.json', [string]$Content = $script:CleanSummary)
        New-Item -ItemType Directory -Path $Root -Force | Out-Null
        & git -C $Root init --quiet
        & git -C $Root config user.email 'fixture@example.com'
        & git -C $Root config user.name 'Fixture'
        & git -C $Root config commit.gpgsign false
        $file = Join-Path $Root $RelPath
        New-Item -ItemType Directory -Path (Split-Path $file -Parent) -Force | Out-Null
        [System.IO.File]::WriteAllText($file, $Content, (New-Object System.Text.UTF8Encoding $false))
        & git -C $Root add -A
        & git -C $Root commit --quiet -m 'seed clean summary'
        return $file
    }

    function Get-Diff { param([string]$Root) (& git -C $Root --no-pager diff) -join "`n" }
}

Describe 'Dirty-situations sweep guard — incident 128ce8f4 fixture (t/2902 / CL)' -Tag 'summary' {

    AfterEach {
        if ($null -eq $script:OrigDataRoot) { Remove-Item Env:\AI_TRIAD_DATA_ROOT -ErrorAction SilentlyContinue }
        else { $env:AI_TRIAD_DATA_ROOT = $script:OrigDataRoot }
        if ($null -eq $script:OrigGuardMode) { Remove-Item Env:\AI_TRIAD_DATA_WRITE_GUARD -ErrorAction SilentlyContinue }
        else { $env:AI_TRIAD_DATA_WRITE_GUARD = $script:OrigGuardMode }
    }

    Context 'DIRTY arm — both sweep signatures present (the actual incident)' {
        It 'guard FIRES on a tree carrying a semantic ride-along AND numeric round-trip churn' {
            $repo = Join-Path $TestDrive 'both'
            $file = New-IncidentRepo -Root $repo
            $env:AI_TRIAD_DATA_ROOT = $repo
            $env:AI_TRIAD_DATA_WRITE_GUARD = 'Block'

            # Concurrent uncommitted state, spliced surgically:
            $raw = [System.IO.File]::ReadAllText($file)
            $raw = $raw -replace '"concept": "digital sovereignty"', '"resolved_node_id": "sit-477", "concept": "digital sovereignty"'  # signature 1
            $raw = $raw -replace '3\.0', '3'                                                                                            # signature 2
            [System.IO.File]::WriteAllText($file, $raw, (New-Object System.Text.UTF8Encoding $false))

            InModuleScope AITriad -Parameters @{ F = $file } {
                param($F)
                { Assert-DataWriteAllowed -Path $F } | Should -Throw -ExpectedMessage '*uncommitted changes*'
            }

            $diff = Get-Diff -Root $repo
            $diff | Should -Match 'resolved_node_id'        # signature 1 is in the swept-away dirtiness
            $diff | Should -Match '3\.0'                    # signature 2 (a 3.0 churned away)
        }
    }

    Context 'DIRTY arm — numeric round-trip tell ALONE (load-bearing)' {
        It 'guard FIRES on cosmetic 3.0->3 churn with NO semantic field added' {
            $repo = Join-Path $TestDrive 'numeric-only'
            $file = New-IncidentRepo -Root $repo
            $env:AI_TRIAD_DATA_ROOT = $repo
            $env:AI_TRIAD_DATA_WRITE_GUARD = 'Block'

            # ONLY the whole-file round-trip tell — untargeted graph_attributes churn.
            $raw = [System.IO.File]::ReadAllText($file) -replace '3\.0', '3'
            [System.IO.File]::WriteAllText($file, $raw, (New-Object System.Text.UTF8Encoding $false))

            InModuleScope AITriad -Parameters @{ F = $file } {
                param($F)
                { Assert-DataWriteAllowed -Path $F } | Should -Throw -ExpectedMessage '*uncommitted changes*'
            }

            $diff = Get-Diff -Root $repo
            $diff | Should -Not -Match 'resolved_node_id'   # no semantic ride-along this time
            $diff | Should -Match '3\.0'                    # the mechanism-tell is the only change — still caught
        }
    }

    Context 'CLEAN arm — no concurrent state (no false block)' {
        It 'committed-clean target is a silent no-op' {
            $repo = Join-Path $TestDrive 'clean'
            $file = New-IncidentRepo -Root $repo
            $env:AI_TRIAD_DATA_ROOT = $repo
            $env:AI_TRIAD_DATA_WRITE_GUARD = 'Block'

            InModuleScope AITriad -Parameters @{ F = $file } {
                param($F)
                $emitted = Assert-DataWriteAllowed -Path $F 3>&1
                @($emitted).Count | Should -Be 0
            }
        }
    }

    Context 'mirror — taxonomy/Origin/situations.json writer' {
        It 'guard FIRES when a concurrent situation-node add is left uncommitted' {
            $sit = @'
{
  "nodes": [
    { "id": "sit-001", "label": "Seed", "graph_attributes": { "ratio": 3.0 } }
  ]
}
'@ -replace "`r`n", "`n"
            $repo = Join-Path $TestDrive 'situations'
            $file = New-IncidentRepo -Root $repo -RelPath 'taxonomy/Origin/situations.json' -Content $sit
            $env:AI_TRIAD_DATA_ROOT = $repo
            $env:AI_TRIAD_DATA_WRITE_GUARD = 'Block'

            # Concurrent uncommitted node add (grouped replacement — build it first).
            $insert = '"nodes": [' + "`n    { `"id`": `"sit-477`", `"label`": `"Concurrent`" },"
            $raw = [System.IO.File]::ReadAllText($file).Replace('"nodes": [', $insert)
            [System.IO.File]::WriteAllText($file, $raw, (New-Object System.Text.UTF8Encoding $false))

            InModuleScope AITriad -Parameters @{ F = $file } {
                param($F)
                { Assert-DataWriteAllowed -Path $F } | Should -Throw -ExpectedMessage '*uncommitted changes*'
            }
            (Get-Diff -Root $repo) | Should -Match 'sit-477'
        }
    }
}
