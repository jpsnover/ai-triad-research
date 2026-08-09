# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for the extraction-scope guard (t/2370) — flag-only mode.
.DESCRIPTION
    Covers: three-arm bar logic (A/B/C), flag-only behaviour (no nulling),
    no-op when M5 didn't run, and the two adjudication-case patterns.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    InModuleScope AITriad {
        # Build a key_point item as Invoke-DocumentSummary feeds to M5 / OOS guard
        function script:OOS-KpItem {
            param(
                [string]$NodeId = 'saf-beliefs-001',
                [string]$POV    = 'safetyist',
                [bool]  $M5Flag = $true,
                [double[]]$CandScores = @(0.22, 0.18, 0.11)
            )
            $Candidates = @($CandScores | ForEach-Object {
                [PSCustomObject]@{ id = "saf-beliefs-$([int]($_ * 1000))"; score = $_ }
            })
            $kp = [PSCustomObject]@{
                taxonomy_node_id     = $NodeId
                point                = 'Human deliberation is defeasible and provisional'
                attribution_text     = 'Human deliberation is defeasible and provisional'
                retrieval_confidence = 0.21
            }
            if ($M5Flag) {
                $kp | Add-Member -NotePropertyName 'mechanism5_flag'       -NotePropertyValue $true  -Force
                $kp | Add-Member -NotePropertyName 'mechanism5_candidates' -NotePropertyValue $Candidates -Force
            }
            @{ KeyPoint = $kp; POV = $POV }
        }
    }
}

Describe 'Invoke-OutOfScopeGuardPass (t/2370)' -Tag 'oos','retrieval' {

    # ── Arm B: no-op when M5 did not flag ────────────────────────────────────

    Context 'Arm B — no-op when mechanism5_flag is absent or false' {

        It 'Does NOT flag a kp that has no mechanism5_flag property' {
            InModuleScope AITriad {
                $Item = OOS-KpItem -M5Flag $false
                $Item.KeyPoint.PSObject.Properties.Remove('mechanism5_flag')
                $Item.KeyPoint.PSObject.Properties.Remove('mechanism5_candidates')
                Invoke-OutOfScopeGuardPass -KeyPointItems @($Item)
                $Item.KeyPoint.PSObject.Properties['out_of_scope_flag'] | Should -BeNullOrEmpty `
                    -Because 'guard must be a no-op when M5 never ran'
            }
        }

        It 'Does NOT flag a kp where mechanism5_flag = $false' {
            InModuleScope AITriad {
                $Item = OOS-KpItem -M5Flag $false
                $Item.KeyPoint | Add-Member -NotePropertyName 'mechanism5_flag' -NotePropertyValue $false -Force
                Invoke-OutOfScopeGuardPass -KeyPointItems @($Item)
                $Item.KeyPoint.PSObject.Properties['out_of_scope_flag'] | Should -BeNullOrEmpty `
                    -Because 'Arm B requires mechanism5_flag = $true'
            }
        }
    }

    # ── Arm A: top-1 score must be below the ceiling ─────────────────────────

    Context 'Arm A — top-1 score ceiling (0.30)' {

        It 'Does NOT flag when top-1 score = 0.30 (at the ceiling, not below)' {
            InModuleScope AITriad {
                $Item = OOS-KpItem -CandScores @(0.30, 0.18, 0.11)
                Invoke-OutOfScopeGuardPass -KeyPointItems @($Item)
                $Item.KeyPoint.PSObject.Properties['out_of_scope_flag'] | Should -BeNullOrEmpty `
                    -Because 'top-1 at exactly ceiling is not below it — Arm A does not pass'
            }
        }

        It 'Does NOT flag when top-1 score = 0.45 (strong candidate)' {
            InModuleScope AITriad {
                $Item = OOS-KpItem -CandScores @(0.45, 0.30, 0.20)
                Invoke-OutOfScopeGuardPass -KeyPointItems @($Item)
                $Item.KeyPoint.PSObject.Properties['out_of_scope_flag'] | Should -BeNullOrEmpty `
                    -Because 'strong top-1 means not out-of-scope'
            }
        }

        It 'Skips gracefully when mechanism5_candidates is absent (M5 flagged but no candidates)' {
            InModuleScope AITriad {
                $kp = [PSCustomObject]@{
                    taxonomy_node_id = 'saf-beliefs-001'
                    point            = 'some claim'
                    mechanism5_flag  = $true
                }
                Invoke-OutOfScopeGuardPass -KeyPointItems @(@{ KeyPoint = $kp; POV = 'safetyist' })
                $kp.PSObject.Properties['out_of_scope_flag'] | Should -BeNullOrEmpty `
                    -Because 'cannot evaluate Arm A without candidates — must skip'
            }
        }
    }

    # ── Arm C: false-positive guard ───────────────────────────────────────────

    Context 'Arm C — false-positive guard (good_alternative_floor = 0.45)' {

        It 'Does NOT flag when a rescue candidate at 0.45 exists (retrieval-fixable)' {
            InModuleScope AITriad {
                # top-1 is 0.22 (below ceiling), BUT candidate #2 is 0.45 → retrieval-fixable
                $Item = OOS-KpItem -CandScores @(0.22, 0.45, 0.10)
                Invoke-OutOfScopeGuardPass -KeyPointItems @($Item)
                $Item.KeyPoint.PSObject.Properties['out_of_scope_flag'] | Should -BeNullOrEmpty `
                    -Because 'Arm C: a rescue candidate >= 0.45 means the misfire is retrieval-fixable'
            }
        }

        It 'DOES flag when top-1 < 0.30 AND no candidate reaches 0.45' {
            InModuleScope AITriad {
                $Item = OOS-KpItem -CandScores @(0.22, 0.18, 0.11)
                Invoke-OutOfScopeGuardPass -KeyPointItems @($Item)
                $Item.KeyPoint.out_of_scope_flag | Should -BeTrue `
                    -Because 'all three arms pass: M5 flagged, top-1 < 0.30, no rescue candidate'
            }
        }
    }

    # ── Flag-only: taxonomy_node_id must NOT be nulled ────────────────────────

    Context 'Flag-only — taxonomy_node_id is never nulled' {

        It 'Leaves taxonomy_node_id intact even when flagged out-of-scope' {
            InModuleScope AITriad {
                $Item = OOS-KpItem -NodeId 'saf-beliefs-129' -CandScores @(0.22, 0.18, 0.11)
                Invoke-OutOfScopeGuardPass -KeyPointItems @($Item)
                $Item.KeyPoint.out_of_scope_flag | Should -BeTrue
                $Item.KeyPoint.taxonomy_node_id | Should -Be 'saf-beliefs-129' `
                    -Because 'flag-only mode must not null taxonomy_node_id (calibration gate not met)'
            }
        }

        It 'Sets out_of_scope_top1_score to the top-1 candidate score when flagged' {
            InModuleScope AITriad {
                $Item = OOS-KpItem -CandScores @(0.22, 0.18, 0.11)
                Invoke-OutOfScopeGuardPass -KeyPointItems @($Item)
                $Item.KeyPoint.out_of_scope_top1_score | Should -Be 0.22 `
                    -Because 'diagnostic score must be recorded for calibration analysis'
            }
        }
    }

    # ── Adjudication case patterns ────────────────────────────────────────────

    Context 'Adjudication case patterns — t/2341 misfires (t/2370#1)' {

        It 'Pattern: defeasible-deliberation case (top-1 ~ 0.22, no rescue) flags as OOS' {
            InModuleScope AITriad {
                # saf-beliefs-129 assigned; best cosine ~ 0.22 (flat distribution)
                $Item = OOS-KpItem -NodeId 'saf-beliefs-129' -CandScores @(0.22, 0.20, 0.19)
                Invoke-OutOfScopeGuardPass -KeyPointItems @($Item)
                $Item.KeyPoint.out_of_scope_flag | Should -BeTrue `
                    -Because 'defeasible-deliberation misfire has top-1 < 0.30 and no rescue >= 0.45'
            }
        }

        It 'Pattern: grid-reliability case (top-1 ~ 0.24, literal-power collision, no rescue) flags as OOS' {
            InModuleScope AITriad {
                # saf-intentions-008 assigned; vocab collision; best cosine ~ 0.24
                $Item = OOS-KpItem -NodeId 'saf-intentions-008' -POV 'safetyist' -CandScores @(0.24, 0.21, 0.17)
                Invoke-OutOfScopeGuardPass -KeyPointItems @($Item)
                $Item.KeyPoint.out_of_scope_flag | Should -BeTrue `
                    -Because 'grid-reliability misfire has top-1 < 0.30 and no rescue >= 0.45'
            }
        }

        It 'Control: in-scope kp with strong candidate (top-1 >= 0.45) is never flagged' {
            InModuleScope AITriad {
                # A genuine safetyist claim about AI capability — has a real home
                $Item = OOS-KpItem -NodeId 'saf-beliefs-001' -CandScores @(0.72, 0.60, 0.41)
                Invoke-OutOfScopeGuardPass -KeyPointItems @($Item)
                $Item.KeyPoint.PSObject.Properties['out_of_scope_flag'] | Should -BeNullOrEmpty `
                    -Because 'a strongly-matched in-scope kp must never be flagged (over-exclusion guard)'
            }
        }
    }
}
