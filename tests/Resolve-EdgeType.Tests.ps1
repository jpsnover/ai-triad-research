# Tag: taxonomy (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Resolve-EdgeType (private)' -Tag 'taxonomy' {

    It 'Accepts all 8 canonical types' {
        InModuleScope AITriad {
            $canonical = @('SUPPORTS','CONTRADICTS','WEAKENS','TENSION_WITH','RESPONDS_TO','ASSUMES','INTERPRETS','CONVERGES_WITH')
            foreach ($t in $canonical) {
                $r = Resolve-EdgeType -Type $t
                $r.Action | Should -Be 'accept'
                $r.Type   | Should -Be $t
            }
        }
    }

    It 'Accepts canonical types case-insensitively and normalizes to upper' {
        InModuleScope AITriad {
            $r = Resolve-EdgeType -Type 'supports'
            $r.Action | Should -Be 'accept'
            $r.Type   | Should -Be 'SUPPORTS'

            $r2 = Resolve-EdgeType -Type 'TeNsIoN_WiTh'
            $r2.Action | Should -Be 'accept'
            $r2.Type   | Should -Be 'TENSION_WITH'
        }
    }

    It 'Reclassifies MOTIVATES, COMPLEMENTS, ENABLES to SUPPORTS' {
        InModuleScope AITriad {
            foreach ($t in 'MOTIVATES','COMPLEMENTS','ENABLES') {
                $r = Resolve-EdgeType -Type $t
                $r.Action | Should -Be 'reclassify'
                $r.Type   | Should -Be 'SUPPORTS'
                $r.Reason | Should -Match '→ SUPPORTS'
            }
        }
    }

    It 'Reclassifies are case-insensitive' {
        InModuleScope AITriad {
            $r = Resolve-EdgeType -Type 'motivates'
            $r.Action | Should -Be 'reclassify'
            $r.Type   | Should -Be 'SUPPORTS'
        }
    }

    It 'Drops deprecated types (CITES, PROPOSES, SUPPORTED_BY)' {
        InModuleScope AITriad {
            foreach ($t in 'CITES','PROPOSES','SUPPORTED_BY') {
                $r = Resolve-EdgeType -Type $t
                $r.Action | Should -Be 'drop'
                $r.Type   | Should -BeNullOrEmpty
                $r.Reason | Should -Not -BeNullOrEmpty
            }
        }
    }

    It 'Drops arbitrary unknown types with a reason' {
        InModuleScope AITriad {
            $r = Resolve-EdgeType -Type 'COMPLETELY_INVENTED_TYPE'
            $r.Action | Should -Be 'drop'
            $r.Reason | Should -Match 'COMPLETELY_INVENTED_TYPE'
        }
    }

    It 'Drops null/empty/whitespace types' {
        InModuleScope AITriad {
            $r1 = Resolve-EdgeType -Type ''
            $r1.Action | Should -Be 'drop'
            $r1.Reason | Should -Match 'null or empty'

            $r2 = Resolve-EdgeType -Type '   '
            $r2.Action | Should -Be 'drop'
        }
    }

    It 'Returns EdgeTypeResolution objects' {
        InModuleScope AITriad {
            $r = Resolve-EdgeType -Type 'SUPPORTS'
            $r.GetType().Name | Should -Be 'EdgeTypeResolution'
        }
    }
}

Describe 'Get-CanonicalEdgeType (private)' -Tag 'taxonomy' {
    It 'Returns the 8-type canonical vocabulary' {
        InModuleScope AITriad {
            $types = Get-CanonicalEdgeType
            @($types).Count | Should -Be 8
            $types | Should -Contain 'SUPPORTS'
            $types | Should -Contain 'CONVERGES_WITH'
            $types | Should -Not -Contain 'CITES'
            $types | Should -Not -Contain 'SUPPORTED_BY'
            $types | Should -Not -Contain 'PROPOSES'
        }
    }
}

Describe 'Dedup pattern (caller responsibility)' -Tag 'taxonomy' {
    # The helper itself is stateless; this verifies the documented call-site
    # pattern works: caller checks the existing-edge set before adding a
    # reclassified edge.
    It 'Caller can dedup reclassified edges against an existing-keys set' {
        InModuleScope AITriad {
            $existing = [System.Collections.Generic.HashSet[string]]::new()
            [void]$existing.Add('a|SUPPORTS|b')

            $r = Resolve-EdgeType -Type 'MOTIVATES'
            $r.Action | Should -Be 'reclassify'
            $r.Type   | Should -Be 'SUPPORTS'

            $key = "a|$($r.Type)|b"
            $isDup = $existing.Contains($key)
            $isDup | Should -Be $true   # caller should drop this
        }
    }
}

Describe 'Manifest sanity — edge-discovery cmdlets still load' -Tag 'taxonomy' {
    It 'Invoke-EdgeDiscovery is still exported' {
        Get-Command Invoke-EdgeDiscovery -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }
    It 'Set-Edge is still exported' {
        Get-Command Set-Edge -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }
}
