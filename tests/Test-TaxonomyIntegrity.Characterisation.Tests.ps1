# Tag: taxonomy (t/3879)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Characterisation suite for Test-TaxonomyIntegrity (t/3879), REQUIRED before any
    decomposition of that 664-line / complexity-170 function (TL ruling, t/3874#2/p/360#496).
.DESCRIPTION
    Existing coverage (Test-TaxonomyIntegrity.Repair/.RepairAudit/.SelfLoop/.StrictModeGuard
    .Tests.ps1) is thorough on edge-repair/Force-threshold/audit-byte-contract and self-loop
    detection, but exercises almost none of the OTHER ~12 check blocks (Checks 1-10 + the BDI
    weight-range validation) in either direction (defect-present / clean). Decomposing each
    check into its own private function is unsafe without a pin on every block's current
    behavior FIRST -- this file is that pin, not a redesign.

    Pattern: one clean, minimal taxonomy fixture (3 POV files + situations + policy_actions +
    edges + embeddings, all internally consistent), then each It mutates exactly ONE aspect to
    introduce exactly one defect and asserts on -PassThru's Details[] (Check/Severity/Count),
    never on Write-Host text.

    Report-only (no -Repair) mode is the default throughout -- confirms issues are detected
    WITHOUT any taxonomy file being modified, which the existing Repair* suites don't pin
    (they all pass -Repair). One dedicated test confirms this explicitly across multiple
    defect types at once.

    OUT OF SCOPE: console (Write-Host) output. Every assertion in this file reads -PassThru's
    Details[] (Check/Severity/Count/Detail); none inspect what the function prints to the
    host. That is deliberate, not an oversight -- Write-Host text is not a stable contract
    (free-form strings, ForegroundColor-only distinctions, no structured shape), and pinning
    it would make this suite brittle against the decomposition's cosmetic refactors rather
    than its behavior. If console output ever needs characterising, that is a separate,
    explicitly-scoped suite, not an extension of this one.

    MUTATION-TESTED (t/3879, TL ruling p/360#503): this suite proves it catches a changed
    FUNCTION, not just defective data. 6 one-at-a-time mutations to Test-TaxonomyIntegrity.ps1
    -- a severity flip, an off-by-one issue count, a disabled check, a swapped reciprocity
    direction, a dropped -Repair guard (report-only mode would then write), and an inverted
    registry-resolution condition -- each independently turned at least one of the 38 tests
    (this file + the four existing Test-TaxonomyIntegrity.*.Tests.ps1 files) red, with zero
    survivors. Full mutation -> failing-test table: t/3879#4.

    GOTCHA (found writing this file, cost a long debugging detour): a Pester v6 block title
    (Describe/Context/It) containing the literal substring "<->" makes the WHOLE block fail
    with "InvalidOperationException: A 'break' or 'continue' statement with a label that does
    not match any enclosing loop escaped from your code" -- a misleading message (it names a
    Pester internal-tooling issue, github.com/pester/Pester/issues/2669) that has nothing to
    do with break/continue in the test body. Confirmed by isolating the identical test content
    under a title without "<->": passes clean. Avoid "<->" (and likely similar operator-lookalike
    glyphs) in any Pester block title; write "and" or "<=>" instead.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    # Builds a clean, internally-consistent taxonomy dir: one node per POV file (each with a
    # resolved policy_action, a resolved situation_ref, and a child relationship within the
    # same POV), one situation linked back reciprocally, one registry entry whose member_count
    # matches, embeddings for every node + policy (+ the situation -- $AllNodeIds, Check 5's
    # basis, includes situations.json nodes too). Every check should PASS against this.
    function script:New-CleanTaxonomyFixture {
        $Dir = Join-Path ([System.IO.Path]::GetTempPath()) "tti-char-$(Get-Random)"
        New-Item -ItemType Directory -Path $Dir -Force | Out-Null

        @{
            nodes = @(
                [ordered]@{
                    id = 'acc-beliefs-001'; pov = 'accelerationist'; label = 'A'; category = 'Beliefs'
                    parent_id = $null; children = @('acc-beliefs-002'); situation_refs = @('sit-001')
                    confidence = 0.5
                    graph_attributes = [ordered]@{ policy_actions = @(@{ policy_id = 'pol-001'; action = 'remove' }) }
                }
                [ordered]@{
                    id = 'acc-beliefs-002'; pov = 'accelerationist'; label = 'A2'; category = 'Beliefs'
                    parent_id = 'acc-beliefs-001'; children = @(); situation_refs = @()
                    confidence = 0.5
                }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $Dir 'accelerationist.json')

        @{
            nodes = @(
                [ordered]@{ id = 'saf-beliefs-001'; pov = 'safetyist'; label = 'S'; category = 'Beliefs'; parent_id = $null; children = @(); situation_refs = @(); confidence = 0.5 }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $Dir 'safetyist.json')

        @{
            nodes = @(
                [ordered]@{ id = 'skp-beliefs-001'; pov = 'skeptic'; label = 'K'; category = 'Beliefs'; parent_id = $null; children = @(); situation_refs = @(); confidence = 0.5 }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $Dir 'skeptic.json')

        @{
            nodes = @(
                [ordered]@{ id = 'sit-001'; label = 'Sit'; linked_nodes = @('acc-beliefs-001') }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $Dir 'situations.json')

        @{
            policies = @(
                [ordered]@{ id = 'pol-001'; member_count = 1; source_povs = @('accelerationist') }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $Dir 'policy_actions.json')

        @{
            _schema_version = '1.0.0'
            last_modified   = '2026-01-01'
            edge_types      = @('SUPPORTS')
            edges = @(
                [ordered]@{ source = 'acc-beliefs-001'; target = 'saf-beliefs-001'; type = 'SUPPORTS'; status = 'approved'; confidence = 0.9 }
            )
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $Dir 'edges.json')

        @{
            nodes = [ordered]@{
                'acc-beliefs-001' = @(0.1, 0.2)
                'acc-beliefs-002' = @(0.1, 0.2)
                'saf-beliefs-001' = @(0.1, 0.2)
                'skp-beliefs-001' = @(0.1, 0.2)
                'pol-001'         = @(0.1, 0.2)
                'sit-001'         = @(0.1, 0.2)
            }
        } | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $Dir 'embeddings.json')

        return $Dir
    }

    # Re-reads a POV file, applies a scriptblock to its parsed .nodes, writes it back. Keeps
    # each It's mutation to one line instead of re-deriving the whole fixture inline.
    function script:Edit-FixtureFile([string]$Dir, [string]$FileName, [scriptblock]$Mutate) {
        $Path = Join-Path $Dir $FileName
        $Doc = Get-Content -Raw -Path $Path | ConvertFrom-Json
        & $Mutate $Doc
        $Doc | ConvertTo-Json -Depth 10 | Set-Content -Path $Path
    }
}

Describe 'Test-TaxonomyIntegrity characterisation (t/3879)' -Tag 'taxonomy' {

    BeforeEach {
        $script:Dir = New-CleanTaxonomyFixture
    }

    AfterEach {
        Remove-Item -Path $script:Dir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Context 'the clean fixture itself (baseline -- every check must pass)' {
        It 'produces zero issues against the unmodified clean fixture' {
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Result.Issues | Should -Be 0 -Because "the fixture is deliberately internally consistent: $($Result.Details | ConvertTo-Json -Depth 5)"
            }
        }

        It '-PassThru returns the documented shape: Nodes/Policies/Checks/Passed/Issues/Details' {
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Result.Nodes    | Should -Be 5 -Because 'the production code counts situations.json nodes toward AllNodeIds too (4 POV nodes + 1 situation)'
                $Result.Policies | Should -Be 1
                $Result.Checks   | Should -BeGreaterThan 0
                $Result.Passed   | Should -Be $Result.Checks
                # Not `$Result.Details | Should -BeOfType [object[]]`: piping an EMPTY array
                # through `|` enumerates zero elements, so Should sees nothing (reads as $null)
                # rather than the empty-array container itself -- a pipe-enumeration gotcha,
                # not a production behavior. The comma operator suppresses that unrolling.
                , $Result.Details | Should -BeOfType [object[]]
            }
        }

        It 'returns nothing (no PassThru object) when -PassThru is not specified' {
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity
                $Result | Should -BeNullOrEmpty
            }
        }

        It '-Detailed does not throw and does not change the PassThru Details content' {
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                { Test-TaxonomyIntegrity -Detailed -PassThru } | Should -Not -Throw
                $WithDetailed = Test-TaxonomyIntegrity -Detailed -PassThru
                $WithoutDetailed = Test-TaxonomyIntegrity -PassThru
                $WithDetailed.Issues | Should -Be $WithoutDetailed.Issues
            }
        }
    }

    Context 'Check 1a: PolicyRef -- a node references a policy_id absent from the registry' {
        It 'flags the unresolved ref as a PolicyRef Error' {
            Edit-FixtureFile $script:Dir 'policy_actions.json' { param($Doc) $Doc.policies = @() }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'PolicyRef')
                $Issue.Count | Should -Be 1
                $Issue[0].Severity | Should -Be 'Error'
                $Issue[0].Detail | Should -Match 'pol-001'
            }
        }
    }

    Context 'Check 1b: Orphaned -- a registry entry with no node referencing it' {
        It 'flags the orphaned registry entry as a Warning' {
            Edit-FixtureFile $script:Dir 'policy_actions.json' {
                param($Doc)
                $Doc.policies = @($Doc.policies[0], [ordered]@{ id = 'pol-999'; member_count = 0; source_povs = @() })
            }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'Orphaned')
                $Issue.Count | Should -Be 1
                $Issue[0].Severity | Should -Be 'Warning'
                $Issue[0].Detail | Should -Match 'pol-999'
            }
        }
    }

    Context 'Check 1c: MemberCount -- registry member_count disagrees with actual references' {
        It 'flags the mismatch as a Warning' {
            Edit-FixtureFile $script:Dir 'policy_actions.json' { param($Doc) $Doc.policies[0].member_count = 5 }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'MemberCount')
                $Issue.Count | Should -Be 1
                $Issue[0].Severity | Should -Be 'Warning'
            }
        }
    }

    Context 'Check 2: MissingPolicyId -- a policy_action with no policy_id' {
        It 'flags it as a Warning' {
            Edit-FixtureFile $script:Dir 'accelerationist.json' {
                param($Doc)
                $Doc.nodes[0].graph_attributes.policy_actions = @(@{ action = 'remove' })
            }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'MissingPolicyId')
                $Issue.Count | Should -Be 1
                $Issue[0].Severity | Should -Be 'Warning'
            }
        }
    }

    Context 'Check 3: DuplicateRef -- the same policy_id appears twice on one node' {
        It 'flags the duplicate as a Warning' {
            Edit-FixtureFile $script:Dir 'accelerationist.json' {
                param($Doc)
                $Doc.nodes[0].graph_attributes.policy_actions = @(
                    @{ policy_id = 'pol-001'; action = 'remove' },
                    @{ policy_id = 'pol-001'; action = 'remove-again' }
                )
            }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'DuplicateRef')
                $Issue.Count | Should -Be 1
                $Issue[0].Severity | Should -Be 'Warning'
            }
        }
    }

    Context 'Check 4: EdgeRef -- an edge references a non-existent node (dangling, not self-loop)' {
        It 'flags the dangling edge as an Error, distinctly from SelfLoopEdge' {
            Edit-FixtureFile $script:Dir 'edges.json' {
                param($Doc)
                $Doc.edges = @([ordered]@{ source = 'acc-beliefs-001'; target = 'nonexistent-node'; type = 'SUPPORTS'; status = 'approved'; confidence = 0.9 })
            }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'EdgeRef')
                $Issue.Count | Should -Be 1
                $Issue[0].Severity | Should -Be 'Error'
                @($Result.Details | Where-Object Check -eq 'SelfLoopEdge').Count | Should -Be 0
            }
        }
    }

    Context 'Check 5: Embeddings -- a node is missing from embeddings.json' {
        It 'flags the missing embedding as a Warning, counting both nodes and policies' {
            Edit-FixtureFile $script:Dir 'embeddings.json' {
                param($Doc)
                $Doc.nodes.PSObject.Properties.Remove('skp-beliefs-001')
            }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'Embeddings')
                $Issue.Count | Should -Be 1
                $Issue[0].Severity | Should -Be 'Warning'
                $Issue[0].Count | Should -Be 1
            }
        }

        It 'treats a totally absent embeddings.json as every node/policy missing' {
            Remove-Item (Join-Path $script:Dir 'embeddings.json')
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'Embeddings')
                $Issue.Count | Should -Be 1
                $Issue[0].Count | Should -Be $Result.Nodes -Because 'no embeddings file at all means every node is missing (policies arent counted toward .Nodes but are included in the issue Count)'
            }
        }
    }

    Context 'Check 6: DanglingChild -- a node lists a nonexistent child' {
        It 'flags it as an Error' {
            Edit-FixtureFile $script:Dir 'accelerationist.json' {
                param($Doc)
                $Doc.nodes[0].children = @('acc-beliefs-002', 'acc-beliefs-nonexistent')
            }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'DanglingChild')
                $Issue.Count | Should -Be 1
                $Issue[0].Severity | Should -Be 'Error'
                $Issue[0].Detail | Should -Match 'acc-beliefs-nonexistent'
            }
        }

        It 'reports no DanglingChild issue when all children resolve' {
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                @($Result.Details | Where-Object Check -eq 'DanglingChild').Count | Should -Be 0
            }
        }
    }

    Context 'Check 7: DanglingParent -- a node''s parent_id resolves to nothing' {
        It 'flags it as an Error' {
            Edit-FixtureFile $script:Dir 'accelerationist.json' {
                param($Doc)
                $Doc.nodes[1].parent_id = 'acc-beliefs-nonexistent'
            }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'DanglingParent')
                $Issue.Count | Should -Be 1
                $Issue[0].Severity | Should -Be 'Error'
            }
        }
    }

    Context 'Check 8: DanglingSitRef -- a node''s situation_refs resolves to nothing' {
        It 'flags it as an Error' {
            Edit-FixtureFile $script:Dir 'accelerationist.json' {
                param($Doc)
                $Doc.nodes[0].situation_refs = @('sit-nonexistent')
            }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'DanglingSitRef')
                $Issue.Count | Should -Be 1
                $Issue[0].Severity | Should -Be 'Error'
            }
        }
    }

    Context 'Check 9: DanglingLinked -- a situation''s linked_nodes resolves to nothing' {
        It 'flags it as a Warning' {
            Edit-FixtureFile $script:Dir 'situations.json' {
                param($Doc)
                $Doc.nodes[0].linked_nodes = @('acc-beliefs-001', 'acc-beliefs-nonexistent')
            }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'DanglingLinked')
                $Issue.Count | Should -Be 1
                $Issue[0].Severity | Should -Be 'Warning'
            }
        }
    }

    # NOTE: this Context's title must NOT contain the literal substring "<->" -- see the
    # file-level .DESCRIPTION gotcha. "and" is used instead.
    Context 'Check 10: SituationReciprocity (t/2979) -- linked_nodes and situation_refs must be mutual' {
        It 'flags a FORWARD-only asymmetry (in linked_nodes, missing the situation_refs back-ref) as an Error' {
            Edit-FixtureFile $script:Dir 'accelerationist.json' { param($Doc) $Doc.nodes[0].situation_refs = @() }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'SituationReciprocity')
                $Issue.Count | Should -Be 1
                $Issue[0].Severity | Should -Be 'Error'
                $Issue[0].Detail | Should -Match 'forward-only'
            }
        }

        It 'flags a REVERSE-only asymmetry (in situation_refs, missing the linked_nodes back-ref) as an Error' {
            Edit-FixtureFile $script:Dir 'situations.json' { param($Doc) $Doc.nodes[0].linked_nodes = @() }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'SituationReciprocity')
                $Issue.Count | Should -Be 1
                $Issue[0].Severity | Should -Be 'Error'
                $Issue[0].Detail | Should -Match 'reverse-only'
            }
        }

        It 'a dangling situation_ref is reported ONLY as DanglingSitRef, never counted as an asymmetry too' {
            # Append the dangling ref alongside the real, reciprocal one -- replacing it outright
            # would ALSO remove the real back-ref and manufacture a forward-only asymmetry too,
            # confounding this test's claim.
            Edit-FixtureFile $script:Dir 'accelerationist.json' { param($Doc) $Doc.nodes[0].situation_refs = @('sit-001', 'sit-nonexistent') }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                @($Result.Details | Where-Object Check -eq 'DanglingSitRef').Count | Should -Be 1
                @($Result.Details | Where-Object Check -eq 'SituationReciprocity').Count | Should -Be 0 -Because 'a ref to a non-existent situation is Check 8''s job, not an asymmetry'
            }
        }
    }

    Context 'BDI weight range validation -- Intentions/Beliefs/Desires carry operationality/confidence/priority' {
        It 'flags an out-of-range operationality (Intentions) as a BDIWeightRange Error' {
            Edit-FixtureFile $script:Dir 'accelerationist.json' {
                param($Doc)
                $Doc.nodes[1].category = 'Intentions'
                $Doc.nodes[1] | Add-Member -NotePropertyName operationality -NotePropertyValue 9 -Force
            }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'BDIWeightRange')
                $Issue.Count | Should -Be 1
                $Issue[0].Severity | Should -Be 'Error'
                $Issue[0].Detail | Should -Match 'operationality=9'
            }
        }

        It 'flags an out-of-range confidence (Beliefs) as a BDIWeightRange Error' {
            Edit-FixtureFile $script:Dir 'accelerationist.json' { param($Doc) $Doc.nodes[0].confidence = 1.5 }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Issue = @($Result.Details | Where-Object Check -eq 'BDIWeightRange')
                $Issue.Count | Should -Be 1
                $Issue[0].Detail | Should -Match 'confidence=1.5'
            }
        }

        It 'treats a NULL confidence as UnscoredBDIWeight (Warning), distinct from out-of-range (Error)' {
            Edit-FixtureFile $script:Dir 'accelerationist.json' { param($Doc) $Doc.nodes[0].confidence = $null }
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                @($Result.Details | Where-Object Check -eq 'BDIWeightRange').Count | Should -Be 0
                $Unscored = @($Result.Details | Where-Object Check -eq 'UnscoredBDIWeight')
                $Unscored.Count | Should -Be 1
                $Unscored[0].Severity | Should -Be 'Warning'
            }
        }

        It 'an in-range confidence/priority/operationality produces no BDI issue' {
            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                @($Result.Details | Where-Object { $_.Check -in @('BDIWeightRange', 'UnscoredBDIWeight') }).Count | Should -Be 0
            }
        }
    }

    Context 'Report-only mode (no -Repair): detection never modifies any taxonomy file' {
        It 'leaves every taxonomy file byte-identical despite multiple detected issues' {
            Edit-FixtureFile $script:Dir 'accelerationist.json' {
                param($Doc)
                $Doc.nodes[0].children = @('acc-beliefs-002', 'acc-beliefs-nonexistent')
                $Doc.nodes[1].parent_id = 'acc-beliefs-nonexistent'
            }
            $Before = @{}
            Get-ChildItem -Path $script:Dir -Filter '*.json' | ForEach-Object {
                $Before[$_.Name] = [System.IO.File]::ReadAllBytes($_.FullName)
            }

            InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
                param($Dir)
                Mock Get-TaxonomyDir { $Dir }
                $Result = Test-TaxonomyIntegrity -PassThru
                $Result.Issues | Should -BeGreaterThan 0 -Because 'this test is only meaningful if issues were actually detected'
            }

            foreach ($Name in $Before.Keys) {
                $After = [System.IO.File]::ReadAllBytes((Join-Path $script:Dir $Name))
                [System.Convert]::ToBase64String($After) | Should -Be ([System.Convert]::ToBase64String($Before[$Name])) -Because "$Name must be untouched without -Repair"
            }
        }
    }
}
