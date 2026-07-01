# Tag: taxonomy (t/1186, t/1224)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

# ─────────────────────────────────────────────────────────────────────────────
# Registry + Resolve-OrganizationEdgeType
# ─────────────────────────────────────────────────────────────────────────────
Describe 'Organization edge-type registry (t/1224)' -Tag 'taxonomy' {

    It 'Contains exactly 9 canonical actor edges' {
        InModuleScope AITriad {
            @(Get-OrganizationEdgeType).Count | Should -Be 9
        }
    }

    It 'Includes ADVOCATES_FOR, OPPOSES, SUPPORTS_POLICY, PUBLISHED, ALLIED_WITH' {
        InModuleScope AITriad {
            $t = @(Get-OrganizationEdgeType)
            foreach ($e in 'ADVOCATES_FOR','OPPOSES','SUPPORTS_POLICY','PUBLISHED','ALLIED_WITH') {
                $t | Should -Contain $e
            }
        }
    }

    It 'Get-AllEdgeType returns 17 (8 argumentation + 9 organization)' {
        InModuleScope AITriad {
            @(Get-AllEdgeType).Count | Should -Be 17
        }
    }

    It 'Argumentation and organization vocabularies are disjoint' {
        InModuleScope AITriad {
            $arg = @(Get-CanonicalEdgeType)
            $org = @(Get-OrganizationEdgeType)
            $overlap = @($arg | Where-Object { $org -contains $_ })
            $overlap.Count | Should -Be 0
        }
    }

    It 'Resolve-OrganizationEdgeType accepts a canonical type (any case) and normalizes to upper' {
        InModuleScope AITriad {
            $r = Resolve-OrganizationEdgeType -Type 'advocates_for'
            $r.Action | Should -Be 'accept'
            $r.Type   | Should -Be 'ADVOCATES_FOR'
        }
    }

    It 'Resolve-OrganizationEdgeType drops an unknown type' {
        InModuleScope AITriad {
            $r = Resolve-OrganizationEdgeType -Type 'COLLABORATES_WITH'
            $r.Action | Should -Be 'drop'
            $r.Reason | Should -Match 'not in organization edge registry'
        }
    }

    It 'Resolve-OrganizationEdgeType drops empty input safely' {
        InModuleScope AITriad {
            $r = Resolve-OrganizationEdgeType -Type ''
            $r.Action | Should -Be 'drop'
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# organizations.json integrity
# ─────────────────────────────────────────────────────────────────────────────
Describe 'organizations.json integrity (t/1224 AC#4)' -Tag 'taxonomy' {

    It 'Loads via Get-OrganizationsStore' {
        InModuleScope AITriad {
            $s = Get-OrganizationsStore
            $s              | Should -Not -BeNullOrEmpty
            $s._schema_version | Should -Be '1.0.0'
            @($s.organizations).Count | Should -BeGreaterOrEqual 25
        }
    }

    It 'Passes Test-OrganizationIntegrity with zero errors' {
        InModuleScope AITriad {
            $r = Test-OrganizationIntegrity
            $r.Pass   | Should -Be $true
            $r.Errors | Should -Be 0
        }
    }

    It 'Every org has an id matching ^org-\d{3}$' {
        InModuleScope AITriad {
            $s = Get-OrganizationsStore
            foreach ($o in @($s.organizations)) {
                $o.id | Should -Match '^org-\d{3}$'
            }
        }
    }

    It 'All pov_alignment scores are in [-1.0, 1.0]' {
        InModuleScope AITriad {
            $s = Get-OrganizationsStore
            foreach ($o in @($s.organizations)) {
                foreach ($povProp in $o.pov_alignment.PSObject.Properties) {
                    $povProp.Value.score | Should -BeGreaterOrEqual -1.0
                    $povProp.Value.score | Should -BeLessOrEqual 1.0
                }
            }
        }
    }

    It 'Every type enum value has at least one seed org (TL coverage guidance)' {
        InModuleScope AITriad {
            $s = Get-OrganizationsStore
            $seenTypes = @($s.organizations | ForEach-Object { $_.type } | Sort-Object -Unique)
            foreach ($t in 'advocacy','regulatory','corporate','intergovernmental','civil_society','standards_body','academic','research_lab','think_tank') {
                $seenTypes | Should -Contain $t
            }
        }
    }

    It 'At least 2 orgs are camp-spanning (positive score on ≥2 POVs)' {
        InModuleScope AITriad {
            $s = Get-OrganizationsStore
            $spanners = @(
                foreach ($o in @($s.organizations)) {
                    $positives = 0
                    foreach ($povProp in $o.pov_alignment.PSObject.Properties) {
                        if ([double]$povProp.Value.score -gt 0.3) { $positives++ }
                    }
                    if ($positives -ge 2) { $o.id }
                }
            )
            $spanners.Count | Should -BeGreaterOrEqual 2
        }
    }

    It 'Integrity validator flags a POV score outside [-1, 1]' {
        InModuleScope AITriad {
            Mock Get-OrganizationsStore {
                [PSCustomObject]@{
                    _schema_version = '1.0.0'
                    organizations   = @(
                        [PSCustomObject]@{
                            id   = 'org-999'
                            name = 'Bad'
                            type = 'advocacy'
                            pov_alignment = [PSCustomObject]@{
                                safetyist = [PSCustomObject]@{ score = 1.5; rationale = 'out of range' }
                            }
                        }
                    )
                }
            }
            $r = Test-OrganizationIntegrity
            $r.Pass   | Should -Be $false
            $r.Errors | Should -BeGreaterOrEqual 1
            @($r.Issues | Where-Object { $_.Field -like 'pov_alignment.*.score' }).Count | Should -BeGreaterOrEqual 1
        }
    }

    It 'Integrity validator flags duplicate ids' {
        InModuleScope AITriad {
            Mock Get-OrganizationsStore {
                [PSCustomObject]@{
                    _schema_version = '1.0.0'
                    organizations   = @(
                        [PSCustomObject]@{ id = 'org-100'; name = 'A'; type = 'advocacy'; pov_alignment = [PSCustomObject]@{} },
                        [PSCustomObject]@{ id = 'org-100'; name = 'B'; type = 'advocacy'; pov_alignment = [PSCustomObject]@{} }
                    )
                }
            }
            $r = Test-OrganizationIntegrity
            @($r.Issues | Where-Object { $_.Message -match 'Duplicate' }).Count | Should -BeGreaterOrEqual 1
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Get-Organization
# ─────────────────────────────────────────────────────────────────────────────
Describe 'Get-Organization' -Tag 'taxonomy' {

    It 'Is exported' {
        Get-Command Get-Organization -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It 'Returns all orgs with no filters' {
        @(Get-Organization).Count | Should -BeGreaterOrEqual 25
    }

    It 'Returns exactly one match for a valid -Id' {
        $r = Get-Organization -Id org-001
        @($r).Count | Should -Be 1
        @($r)[0].Name | Should -Be 'Anthropic'
    }

    It 'Returns empty for a non-existent -Id' {
        @(Get-Organization -Id org-999).Count | Should -Be 0
    }

    It '-Type filter returns only orgs of that type' {
        $advocacy = Get-Organization -Type advocacy
        @($advocacy).Count | Should -BeGreaterOrEqual 1
        foreach ($o in $advocacy) { $o.Type | Should -Be 'advocacy' }
    }

    It '-Name filter matches substring case-insensitively' {
        $r = Get-Organization -Name 'anthropic'
        @($r).Count | Should -BeGreaterOrEqual 1
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Find-OrganizationByPOV
# ─────────────────────────────────────────────────────────────────────────────
Describe 'Find-OrganizationByPOV' -Tag 'taxonomy' {

    It 'Is exported' {
        Get-Command Find-OrganizationByPOV -Module AITriad | Should -Not -BeNullOrEmpty
    }

    It 'Strong safetyist backers (MinScore=0.7) includes CAIS and FLI' {
        $r = Find-OrganizationByPOV -Pov safetyist -MinScore 0.7
        $shortNames = @($r | ForEach-Object { $_.ShortName })
        $shortNames | Should -Contain 'CAIS'
        $shortNames | Should -Contain 'FLI'
    }

    It 'Strong accelerationist opponents (MaxScore=-0.5) exists (a16z etc)' {
        $r = Find-OrganizationByPOV -Pov accelerationist -MaxScore -0.5
        @($r).Count | Should -BeGreaterOrEqual 1
    }

    It 'Score results are sorted descending' {
        $r = Find-OrganizationByPOV -Pov safetyist -MinScore -1.0
        $scores = @($r | ForEach-Object { [double]$_.PovAlignment['safetyist'].Score })
        for ($i = 1; $i -lt $scores.Count; $i++) {
            $scores[$i] | Should -BeLessOrEqual $scores[$i - 1]
        }
    }

    It 'Rejects -MinScore > -MaxScore with ActionableError' {
        { Find-OrganizationByPOV -Pov safetyist -MinScore 0.5 -MaxScore 0.1 } | Should -Throw
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Find-OrganizationByTopic
# ─────────────────────────────────────────────────────────────────────────────
Describe 'Find-OrganizationByTopic' -Tag 'taxonomy' {

    It 'Is exported' {
        Get-Command Find-OrganizationByTopic -Module AITriad | Should -Not -BeNullOrEmpty
    }

    It 'Returns orgs engaged with sit-003' {
        $r = Find-OrganizationByTopic -TopicRef sit-003
        @($r).Count | Should -BeGreaterOrEqual 1
    }

    It '-Stance advocate narrows results' {
        $advocates = Find-OrganizationByTopic -TopicRef sit-003 -Stance advocate
        $all       = Find-OrganizationByTopic -TopicRef sit-003
        @($advocates).Count | Should -BeLessOrEqual @($all).Count
    }

    It 'Rejects malformed topic ref via ValidatePattern' {
        { Find-OrganizationByTopic -TopicRef 'not-a-topic' } | Should -Throw
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Get-OrganizationStakeholders
# ─────────────────────────────────────────────────────────────────────────────
Describe 'Get-OrganizationStakeholders' -Tag 'taxonomy' {

    It 'Is exported' {
        Get-Command Get-OrganizationStakeholders -Module AITriad | Should -Not -BeNullOrEmpty
    }

    It 'Returns Supporters and Opposers for pol-028' {
        $r = Get-OrganizationStakeholders -PolicyId pol-028
        $r.PolicyId | Should -Be 'pol-028'
        @($r.Supporters).Count | Should -BeGreaterOrEqual 1
        @($r.Opposers).Count   | Should -BeGreaterOrEqual 1
    }

    It 'Returns empty arrays for a policy with no engagement' {
        $r = Get-OrganizationStakeholders -PolicyId pol-999
        @($r.Supporters).Count | Should -Be 0
        @($r.Opposers).Count   | Should -Be 0
    }

    It 'Rejects malformed policy ref via ValidatePattern' {
        { Get-OrganizationStakeholders -PolicyId 'not-a-policy' } | Should -Throw
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Compare-OrganizationPositions
# ─────────────────────────────────────────────────────────────────────────────
Describe 'Compare-OrganizationPositions' -Tag 'taxonomy' {

    It 'Is exported' {
        Get-Command Compare-OrganizationPositions -Module AITriad | Should -Not -BeNullOrEmpty
    }

    It 'Returns 3 rows (one per POV) with correct scores for Anthropic vs a16z' {
        $r = Compare-OrganizationPositions -Id org-001, org-005
        @($r).Count | Should -Be 3
        $accRow = $r | Where-Object { $_.POV -eq 'accelerationist' }
        $accRow.Anthropic | Should -Be 0.4
        $accRow.a16z      | Should -Be 0.9
    }

    It 'Throws on unknown org id' {
        { Compare-OrganizationPositions -Id org-999, org-001 } | Should -Throw
    }

    It 'Requires at least 2 ids' {
        { Compare-OrganizationPositions -Id org-001 } | Should -Throw
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Import-Organization (WhatIf only to avoid file writes)
# ─────────────────────────────────────────────────────────────────────────────
Describe 'Import-Organization' -Tag 'taxonomy' {

    It 'Is exported' {
        Get-Command Import-Organization -Module AITriad | Should -Not -BeNullOrEmpty
    }

    It '-WhatIf returns the record without modifying the file' {
        $before = (Get-Item (InModuleScope AITriad { Get-OrganizationsFilePath })).LastWriteTimeUtc
        $r = Import-Organization -Id org-901 -Name 'Test Org' -Type advocacy -WhatIf
        $r.Id   | Should -Be 'org-901'
        $r.Name | Should -Be 'Test Org'
        $after  = (Get-Item (InModuleScope AITriad { Get-OrganizationsFilePath })).LastWriteTimeUtc
        $after  | Should -Be $before
    }

    It 'Rejects malformed -Id via ValidatePattern' {
        { Import-Organization -Id 'bad-id' -Name 'X' -Type advocacy -WhatIf } | Should -Throw
    }

    It 'Rejects unknown -Type via ValidateSet' {
        { Import-Organization -Id org-902 -Name 'X' -Type 'not-a-type' -WhatIf } | Should -Throw
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Manifest exports
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# Review-fixes regression (t/1224#4)
# ─────────────────────────────────────────────────────────────────────────────
Describe 'Test-OrganizationIntegrity -Path (t/1224#4 fix 1)' -Tag 'taxonomy' {
    It 'Validates a fixture file supplied via -Path, not the live registry' {
        InModuleScope AITriad {
            $fixture = Join-Path ([System.IO.Path]::GetTempPath()) "orgs-fixture-$(Get-Random).json"
            try {
                $badPayload = @{
                    _schema_version = '1.0.0'
                    organizations   = @(
                        @{
                            id   = 'org-100'
                            name = 'Bad'
                            type = 'advocacy'
                            pov_alignment = @{
                                safetyist = @{ score = 2.5; rationale = 'out of range on purpose' }
                            }
                        }
                    )
                } | ConvertTo-Json -Depth 8
                Set-Content -Path $fixture -Value $badPayload -Encoding utf8NoBOM
                $r = Test-OrganizationIntegrity -Path $fixture
                $r.Pass   | Should -Be $false
                $r.Errors | Should -BeGreaterOrEqual 1
                @($r.Issues | Where-Object { $_.OrgId -eq 'org-100' }).Count | Should -BeGreaterOrEqual 1
                # Cache must not be polluted by the fixture — live registry re-validates clean
                $live = Test-OrganizationIntegrity
                $live.Pass | Should -Be $true
            } finally {
                if (Test-Path $fixture) { Remove-Item $fixture -Force -ErrorAction SilentlyContinue }
            }
        }
    }
}

Describe 'Import-Organization strict-mode guard (t/1224#4 fix 2)' -Tag 'taxonomy' {
    It 'Handles a store missing the organizations key without throwing PropertyNotFoundException' {
        InModuleScope AITriad {
            Mock Get-OrganizationsStore { [PSCustomObject]@{ _schema_version = '1.0.0' } }
            { Import-Organization -Id org-991 -Name 'guard test' -Type advocacy -WhatIf } | Should -Not -Throw
        }
    }
}

Describe 'Organization cmdlets - manifest export (t/1224)' -Tag 'taxonomy' {
    It 'AITriad.psd1 FunctionsToExport lists all 6 organization cmdlets' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        $manifest = Test-ModuleManifest -Path $manifestPath
        foreach ($c in 'Get-Organization','Find-OrganizationByPOV','Find-OrganizationByTopic','Get-OrganizationStakeholders','Import-Organization','Compare-OrganizationPositions') {
            $manifest.ExportedFunctions.Keys | Should -Contain $c
        }
    }
}
