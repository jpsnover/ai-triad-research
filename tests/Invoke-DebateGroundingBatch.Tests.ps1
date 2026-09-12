# Tag: taxonomy (t/3438)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

# Unit tests for Invoke-DebateGroundingBatch (t/3438). The generation loop uses ForEach-Object -Parallel,
# whose runspaces can't see Pester mocks and would make live AI calls — so the skip/filter/gate logic is
# exercised through -WhatIf, which returns (AI-free, write-free) BEFORE the parallel loop. The AI→write
# path is covered by the Update-JsonNodePath -Upsert and Save-JsonNodeFieldEdits Path-dispatch suites; the
# real end-to-end run is CL's owner-executed spot-check.

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
}

Describe 'Invoke-DebateGroundingBatch (t/3438)' -Tag 'taxonomy' {

    BeforeEach {
        $script:TaxDir = Join-Path $TestDrive "tax-$(Get-Random)"
        New-Item -ItemType Directory -Path $script:TaxDir -Force | Out-Null
        $acc = @{ nodes = @(
                @{ id = 'acc-beliefs-001'; label = 'Scaling'; description = 'A long enough belief description about scaling and compute that clears the length gate.' }
                @{ id = 'acc-beliefs-002'; label = 'Has'; description = 'Another sufficiently long description used to exercise the skip-if-present path here.'; graph_attributes = @{ debate_grounding = 'We already hold this.' } }
                @{ id = 'acc-desires-003'; label = 'Dep'; description = '[DEPRECATED] an old node description that is itself long enough to pass the length check.' }
                @{ id = 'acc-beliefs-004'; label = 'Short'; description = 'too short' }
            ) }
        $acc | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $script:TaxDir 'accelerationist.json') -Encoding utf8
        @{ nodes = @() } | ConvertTo-Json | Set-Content -Path (Join-Path $script:TaxDir 'safetyist.json') -Encoding utf8
        @{ nodes = @() } | ConvertTo-Json | Set-Content -Path (Join-Path $script:TaxDir 'skeptic.json') -Encoding utf8
    }

    It 'is exported from the module' {
        Get-Command -Module AITriad -Name 'Invoke-DebateGroundingBatch' | Should -Not -BeNullOrEmpty
    }

    It '-WhatIf makes no write and excludes has-grounding / deprecated / short-description nodes' {
        Mock Get-TaxonomyDir { $script:TaxDir } -ModuleName AITriad
        $before = Get-Content -Raw -Path (Join-Path $script:TaxDir 'accelerationist.json')
        $r = Invoke-DebateGroundingBatch -WhatIf
        $r.WhatIf       | Should -BeTrue
        $r.Generated    | Should -Be 0
        $r.WouldProcess | Should -Be 1     # only acc-beliefs-001 (002 has dg, 003 deprecated, 004 short)
        (Get-Content -Raw -Path (Join-Path $script:TaxDir 'accelerationist.json')) | Should -Be $before   # no mutation
    }

    It '-Id restricts the process set; a matched but has-grounding node is still skipped' {
        Mock Get-TaxonomyDir { $script:TaxDir } -ModuleName AITriad
        (Invoke-DebateGroundingBatch -Id 'acc-beliefs-001' -WhatIf).WouldProcess | Should -Be 1
        (Invoke-DebateGroundingBatch -Id 'acc-beliefs-002' -WhatIf).WouldProcess | Should -Be 0   # has dg → skip-if-present
    }

    It '-Force includes a node that already has debate_grounding' {
        Mock Get-TaxonomyDir { $script:TaxDir } -ModuleName AITriad
        (Invoke-DebateGroundingBatch -Id 'acc-beliefs-002' -Force -WhatIf).WouldProcess | Should -Be 1
    }
}
