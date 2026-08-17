# Tag: summary (t/2739)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Invoke-PolarityGatePass — polarity/contradiction gate (t/2739 P1).
.DESCRIPTION
    Both-arm + fail-safe Gate Verification with count assertions, mirroring the
    V1/V2 test Contexts (INVERSION fires / non-opposes KEEPS / unresolved KEEPS).
    The shared wrapper Test-DirectionalAgreement is MOCKED for determinism in CI;
    the real-deberta arm is recorded on the ticket (same standard as the engine +
    V1/V2). Opposition-only contract (t/2751#2): fire ONLY on 'opposes'; 'agrees' /
    'unrelated' / 'unresolved' all KEEP the mapping.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-PolarityGatePass (t/2739)' -Tag 'summary' {

    BeforeEach {
        InModuleScope AITriad {
            # Minimal taxonomy for node_prop construction (label + Core; Encompasses tail present to prove stripping).
            $script:TaxonomyData = @{
                accelerationist = [PSCustomObject]@{ nodes = @(
                    [PSCustomObject]@{ id = 'acc-intentions-047'; label = 'Argue AI Requires Entirely New Laws'; description = 'An Intention that new legal frameworks are required rather than adapted existing laws. Encompasses: bespoke AI legislation, regulatory sandboxes.' }
                ) }
            }
        }
    }

    # A gated aligned key_point on acc-intentions-047 (high band).
    function script:New-Kp ($stance = 'aligned', $node = 'acc-intentions-047', $low = $false) {
        [PSCustomObject]@{
            canonical_proposition   = 'Existing privacy law already governs AI; no new frameworks are needed.'
            taxonomy_node_id        = $node
            stance                  = $stance
            retrieval_low_confidence = $low
        }
    }

    It 'INVERSION fires: opposes → strongly_opposed + stance_polarity_flag, counts.opposes=1' {
        InModuleScope AITriad {
            Mock Test-DirectionalAgreement -MockWith {
                $r = [System.Collections.Generic.List[PSObject]]::new()
                foreach ($p in @($Pair)) { $r.Add([PSCustomObject]@{ Id = $p.Id; Direction = 'opposes'; Confidence = 1.44; Method = 'nli' }) }
                $r
            }
            $kp = New-Kp
            $counts = Invoke-PolarityGatePass -KeyPoints @(@{ KeyPoint = $kp; POV = 'accelerationist' })

            $kp.stance | Should -Be 'strongly_opposed'
            $kp.stance_polarity_flag | Should -BeTrue
            $counts.opposes | Should -Be 1
            $counts.gated   | Should -Be 1
        }
    }

    It 'node_prop matches V1: label + Core with Encompasses/Excludes stripped' {
        InModuleScope AITriad {
            $script:CapturedPairs = $null
            Mock Test-DirectionalAgreement -MockWith {
                $script:CapturedPairs = @($Pair)
                $r = [System.Collections.Generic.List[PSObject]]::new()
                foreach ($p in @($Pair)) { $r.Add([PSCustomObject]@{ Id = $p.Id; Direction = 'unrelated'; Confidence = 0.0; Method = 'nli' }) }
                $r
            }
            Invoke-PolarityGatePass -KeyPoints @(@{ KeyPoint = (New-Kp); POV = 'accelerationist' }) | Out-Null

            $np = $script:CapturedPairs[0].NodeProp
            $np | Should -BeLike 'Argue AI Requires Entirely New Laws — *'
            $np | Should -Not -Match 'Encompasses' -Because 'Encompasses:/Excludes: tails must be stripped (condition #3)'
            $script:CapturedPairs[0].NodePov | Should -Be 'accelerationist'
        }
    }

    It 'GENUINE AGREEMENT arm: unrelated → KEEP (no flag), counts.unrelated=1' {
        InModuleScope AITriad {
            Mock Test-DirectionalAgreement -MockWith {
                $r = [System.Collections.Generic.List[PSObject]]::new()
                foreach ($p in @($Pair)) { $r.Add([PSCustomObject]@{ Id = $p.Id; Direction = 'unrelated'; Confidence = 0.0; Method = 'nli' }) }
                $r
            }
            $kp = New-Kp 'aligned'
            $counts = Invoke-PolarityGatePass -KeyPoints @(@{ KeyPoint = $kp; POV = 'accelerationist' })

            $kp.stance | Should -Be 'aligned' -Because 'genuine agreement reads unrelated (not entailment) and must KEEP'
            ($kp.PSObject.Properties['stance_polarity_flag']) | Should -BeNullOrEmpty
            $counts.unrelated | Should -Be 1
            $counts.opposes   | Should -Be 0
        }
    }

    It 'FAIL-SAFE: unresolved → KEEP the mapping (never demote), counts.unresolved=1' {
        InModuleScope AITriad {
            Mock Test-DirectionalAgreement -MockWith {
                $r = [System.Collections.Generic.List[PSObject]]::new()
                foreach ($p in @($Pair)) { $r.Add([PSCustomObject]@{ Id = $p.Id; Direction = 'unresolved'; Confidence = 0.0; Method = 'none' }) }
                $r
            }
            $kp = New-Kp 'strongly_aligned'
            $counts = Invoke-PolarityGatePass -KeyPoints @(@{ KeyPoint = $kp; POV = 'accelerationist' })

            $kp.stance | Should -Be 'strongly_aligned' -Because 'a demotion gate fails safe by NOT demoting (t/2751#2)'
            ($kp.PSObject.Properties['stance_polarity_flag']) | Should -BeNullOrEmpty
            $counts.unresolved | Should -Be 1
        }
    }

    It 'SCOPING: opposed-stance, null-node, and low-band key_points are NOT gated' {
        InModuleScope AITriad {
            $script:GatedSeen = 0
            Mock Test-DirectionalAgreement -MockWith {
                $script:GatedSeen = @($Pair).Count
                $r = [System.Collections.Generic.List[PSObject]]::new()
                foreach ($p in @($Pair)) { $r.Add([PSCustomObject]@{ Id = $p.Id; Direction = 'unrelated'; Confidence = 0; Method = 'nli' }) }
                $r
            }
            $items = @(
                @{ KeyPoint = (New-Kp 'opposed');                 POV = 'accelerationist' }  # already opposed → skip
                @{ KeyPoint = (New-Kp 'aligned' $null);           POV = 'accelerationist' }  # null node → skip
                @{ KeyPoint = (New-Kp 'aligned' 'acc-intentions-047' $true); POV = 'accelerationist' }  # low band → skip
                @{ KeyPoint = (New-Kp 'aligned');                 POV = 'accelerationist' }  # gated
            )
            $counts = Invoke-PolarityGatePass -KeyPoints $items
            $counts.gated | Should -Be 1
            $script:GatedSeen | Should -Be 1
        }
    }

    It '-SkipDirectionalGate is a no-op (zeroed counts, no engine call)' {
        InModuleScope AITriad {
            Mock Test-DirectionalAgreement -MockWith { throw 'should not be called' }
            $kp = New-Kp
            $counts = Invoke-PolarityGatePass -KeyPoints @(@{ KeyPoint = $kp; POV = 'accelerationist' }) -SkipDirectionalGate
            $counts.gated   | Should -Be 0
            $counts.opposes | Should -Be 0
            $kp.stance | Should -Be 'aligned'
            Should -Invoke Test-DirectionalAgreement -Times 0
        }
    }
}
