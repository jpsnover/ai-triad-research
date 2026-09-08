# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Option C PS<->Python parity (t/3389 / t/3409 item 4, SO cond-3). Shared cross-language contract
# (CL #2097): research/comp-linguist/analyses/t3389-option-c/optionc-parity-fixture.json. The PS split
# (ConvertTo-GroundedLogicalForm) MUST match the Python validate() (#2078); `generator` is per-port
# identity and TOLERATED. Python arm: test_optionc_parity.py.
#
# #2669 avoidance (learned empirically co-running with the InModuleScope sibling suite): NO helper
# functions defined in BeforeAll and called from It, NO `foreach` statement, NO `Should` inside a
# helper or a loop, NO -ForEach/BeforeDiscovery. Everything inline per It; InModuleScope returns only
# $lf and all Should run in the It body. Expectations are READ from the fixture (drift-catching); each
# fixture case has <=1 ref in about[]/topical_candidates.refs, so indexed compares suffice (no sort helper).

Describe 'Option C PS-to-Python parity fixture (t/3389/t/3409)' -Tag 'unit', 'fol' {
    BeforeAll {
        Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
        $fixturePath = Join-Path $PSScriptRoot '..' 'research' 'comp-linguist' 'analyses' 't3389-option-c' 'optionc-parity-fixture.json'
        $script:Fx   = Get-Content -Raw -LiteralPath $fixturePath | ConvertFrom-Json
        $script:Prov = $script:Fx._meta.provenance_expected
        # RefTable literal from the fixture's 3-entry allowlist (no loop in BeforeAll — a #2669 risk).
        # Kept in sync with the fixture by the drift-guard It below.
        $script:Allow = @(
            [pscustomobject]@{ ref = 'ent-034'; surface = ''; match_level = 'exact';       sort = 'agentive-physical-object' }
            [pscustomobject]@{ ref = 'term:regulation_precautionary'; surface = ''; match_level = 'exact'; sort = 'universal' }
            [pscustomobject]@{ ref = 'ent-x';   surface = ''; match_level = 'instance_of'; sort = 'perdurant' }
        )
    }

    It 'The parity fixture is present and its allowlist matches the test RefTable (drift guard)' {
        @($script:Fx.cases).Count | Should -Be 5
        $script:Fx._meta.provenance_expected.golden_ref | Should -Be 't/3381'
        # allowlist drift guard — the 3 refs + their register (sort, match_level) must match $script:Allow.
        $al = $script:Fx.allowlist
        @($al.PSObject.Properties).Count | Should -Be 3
        $al.'ent-034'.sort | Should -Be 'agentive-physical-object'
        $al.'term:regulation_precautionary'.sort | Should -Be 'universal'
        $al.'ent-x'.match_level | Should -Be 'instance_of'
    }

    It 'case: concept_ref_routed_to_topical_candidates (term: -> topical_candidates; universal clamped to exact)' {
        $case = $script:Fx.cases | Where-Object { $_.name -eq 'concept_ref_routed_to_topical_candidates' } | Select-Object -First 1
        $lf = InModuleScope AITriad -Parameters @{ InAbout = @($case.input_about); Allow = $script:Allow; Cat = $script:Fx._meta.category; Camp = $script:Fx._meta.camp } {
            param($InAbout, $Allow, $Cat, $Camp)
            $raw = [pscustomobject]@{ predicate = 'hold'; event_ref = 'e1'; args = @(); polarity = 'positive'
                modality = [pscustomobject]@{ holder = 'camp:acc'; attitude = 'belief' }
                temporal = [pscustomobject]@{ type = 'unspecified'; value = $null }
                about = @($InAbout); formalization_confidence = 0.7; status = 'proposed' }
            ConvertTo-GroundedLogicalForm -Raw $raw -RefTable $Allow -Category $Cat -Camp $Camp
        }
        @($lf.about).Count | Should -Be 0
        $lf.topical_candidates | Should -Not -BeNullOrEmpty
        @($lf.topical_candidates.refs).Count | Should -Be 1
        $lf.topical_candidates.refs[0].ref | Should -Be $case.expected_topical_candidates_refs[0].ref
        $lf.topical_candidates.refs[0].match_level | Should -Be $case.expected_topical_candidates_refs[0].match_level
        $lf.topical_candidates.validated | Should -Be $script:Prov.validated
        "$($lf.topical_candidates.golden_ref)" | Should -Be "$($script:Prov.golden_ref)"
        [double]$lf.topical_candidates.blind_golden_precision | Should -Be ([double]$script:Prov.blind_golden_precision)
    }

    It 'case: entity_ref_stays_in_about_ent_only (authoritative register match_level; no topical_candidates)' {
        $case = $script:Fx.cases | Where-Object { $_.name -eq 'entity_ref_stays_in_about_ent_only' } | Select-Object -First 1
        $lf = InModuleScope AITriad -Parameters @{ InAbout = @($case.input_about); Allow = $script:Allow; Cat = $script:Fx._meta.category; Camp = $script:Fx._meta.camp } {
            param($InAbout, $Allow, $Cat, $Camp)
            $raw = [pscustomobject]@{ predicate = 'hold'; event_ref = 'e1'; args = @(); polarity = 'positive'
                modality = [pscustomobject]@{ holder = 'camp:acc'; attitude = 'belief' }
                temporal = [pscustomobject]@{ type = 'unspecified'; value = $null }
                about = @($InAbout); formalization_confidence = 0.7; status = 'proposed' }
            ConvertTo-GroundedLogicalForm -Raw $raw -RefTable $Allow -Category $Cat -Camp $Camp
        }
        @($lf.about).Count | Should -Be 1
        $lf.about[0].ref | Should -Be $case.expected_about[0].ref
        $lf.about[0].match_level | Should -Be $case.expected_about[0].match_level   # register 'instance_of', not model 'exact'
        $lf.PSObject.Properties['topical_candidates'] | Should -BeNullOrEmpty
    }

    It 'case: ungrounded_ref_dropped (R6 no-mint; no topical_candidates)' {
        $case = $script:Fx.cases | Where-Object { $_.name -eq 'ungrounded_ref_dropped' } | Select-Object -First 1
        $lf = InModuleScope AITriad -Parameters @{ InAbout = @($case.input_about); Allow = $script:Allow; Cat = $script:Fx._meta.category; Camp = $script:Fx._meta.camp } {
            param($InAbout, $Allow, $Cat, $Camp)
            $raw = [pscustomobject]@{ predicate = 'hold'; event_ref = 'e1'; args = @(); polarity = 'positive'
                modality = [pscustomobject]@{ holder = 'camp:acc'; attitude = 'belief' }
                temporal = [pscustomobject]@{ type = 'unspecified'; value = $null }
                about = @($InAbout); formalization_confidence = 0.7; status = 'proposed' }
            ConvertTo-GroundedLogicalForm -Raw $raw -RefTable $Allow -Category $Cat -Camp $Camp
        }
        @($lf.about).Count | Should -Be 0
        $lf.PSObject.Properties['topical_candidates'] | Should -BeNullOrEmpty
    }

    It 'case: split_mixed_ent_to_about_term_to_candidates (core split in one frame)' {
        $case = $script:Fx.cases | Where-Object { $_.name -eq 'split_mixed_ent_to_about_term_to_candidates' } | Select-Object -First 1
        $lf = InModuleScope AITriad -Parameters @{ InAbout = @($case.input_about); Allow = $script:Allow; Cat = $script:Fx._meta.category; Camp = $script:Fx._meta.camp } {
            param($InAbout, $Allow, $Cat, $Camp)
            $raw = [pscustomobject]@{ predicate = 'hold'; event_ref = 'e1'; args = @(); polarity = 'positive'
                modality = [pscustomobject]@{ holder = 'camp:acc'; attitude = 'belief' }
                temporal = [pscustomobject]@{ type = 'unspecified'; value = $null }
                about = @($InAbout); formalization_confidence = 0.7; status = 'proposed' }
            ConvertTo-GroundedLogicalForm -Raw $raw -RefTable $Allow -Category $Cat -Camp $Camp
        }
        @($lf.about).Count | Should -Be 1
        $lf.about[0].ref | Should -Be $case.expected_about[0].ref                       # ent-034 stays
        @($lf.topical_candidates.refs).Count | Should -Be 1
        $lf.topical_candidates.refs[0].ref | Should -Be $case.expected_topical_candidates_refs[0].ref   # term: -> candidates
    }

    It 'case: empty_about_no_topical_candidates_key (absent, not null)' {
        $case = $script:Fx.cases | Where-Object { $_.name -eq 'empty_about_no_topical_candidates_key' } | Select-Object -First 1
        $lf = InModuleScope AITriad -Parameters @{ InAbout = @($case.input_about); Allow = $script:Allow; Cat = $script:Fx._meta.category; Camp = $script:Fx._meta.camp } {
            param($InAbout, $Allow, $Cat, $Camp)
            $raw = [pscustomobject]@{ predicate = 'hold'; event_ref = 'e1'; args = @(); polarity = 'positive'
                modality = [pscustomobject]@{ holder = 'camp:acc'; attitude = 'belief' }
                temporal = [pscustomobject]@{ type = 'unspecified'; value = $null }
                about = @($InAbout); formalization_confidence = 0.7; status = 'proposed' }
            ConvertTo-GroundedLogicalForm -Raw $raw -RefTable $Allow -Category $Cat -Camp $Camp
        }
        @($lf.about).Count | Should -Be 0
        $lf.PSObject.Properties['topical_candidates'] | Should -BeNullOrEmpty
    }
}
