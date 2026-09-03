# Tag: unit (t/3291)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    # Build a deterministic fixture dictionary in TestDrive so filter logic is testable without
    # depending on the live data repo.
    function New-ConceptFixture {
        $root = Join-Path $TestDrive "dict-$([guid]::NewGuid())"
        $std  = Join-Path $root 'standardized'
        $col  = Join-Path $root 'colloquial'
        New-Item -ItemType Directory -Path $std -Force | Out-Null
        New-Item -ItemType Directory -Path $col -Force | Out-Null

        $terms = @(
            [ordered]@{ canonical_form = 'risk_existential'; display_form = 'risk (existential)'; definition = 'def-x';
                primary_camp_origin = 'skeptic'; coinage_status = 'accepted'; characteristic_phrases = @('x-risk', 'extinction');
                see_also = @('risk_systemic'); used_by_nodes = @('skp-beliefs-001', 'saf-beliefs-050'); coined_at = '2026-04-28'; coined_by = 'jpsnover' }
            [ordered]@{ canonical_form = 'governance_adaptive'; display_form = 'governance (adaptive)'; definition = 'def-g';
                primary_camp_origin = 'accelerationist'; coinage_status = 'provisional'; characteristic_phrases = @('adaptive rules');
                see_also = @(); used_by_nodes = @('acc-beliefs-010'); coined_at = '2026-05-01'; coined_by = 'jpsnover' }
            [ordered]@{ canonical_form = 'oversight_audit'; display_form = 'oversight (audit)'; definition = 'def-o';
                primary_camp_origin = 'skeptic'; coinage_status = 'contested'; characteristic_phrases = @('audit');
                see_also = @(); used_by_nodes = @('skp-beliefs-001'); coined_at = '2026-05-02'; coined_by = 'jpsnover' }
        )
        foreach ($t in $terms) { $t | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $std "$($t.canonical_form).json") -Encoding utf8 }

        # One colloquial term (different schema).
        [ordered]@{ colloquial_term = 'accountability'; status = 'accepted'; resolves_to = @('accountability_algorithmic'); first_added = '2026-03-01' } |
            ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $col 'accountability.json') -Encoding utf8

        return $root
    }
}

Describe 'Get-Concept (t/3291)' -Tag 'unit' {

    BeforeEach { $script:dict = New-ConceptFixture }

    Context 'read + shape' {
        It 'no-arg returns all standardized concepts as objects (not text)' {
            $r = @(Get-Concept -DictionaryRoot $script:dict)
            $r.Count | Should -Be 3
            $r[0] | Should -BeOfType ([pscustomobject])
        }
        It 'maps every documented output field' {
            $x = @(Get-Concept -DictionaryRoot $script:dict -Slug 'risk_existential')[0]
            $x.CanonicalForm        | Should -Be 'risk_existential'
            $x.DisplayForm          | Should -Be 'risk (existential)'
            $x.Definition           | Should -Be 'def-x'
            $x.Camp                 | Should -Be 'skeptic'
            $x.Status               | Should -Be 'accepted'
            $x.CoinedAt             | Should -Be '2026-04-28'
            $x.CoinedBy             | Should -Be 'jpsnover'
            $x.Kind                 | Should -Be 'standardized'
            @($x.UsedByNodes).Count           | Should -Be 2
            @($x.CharacteristicPhrases).Count | Should -Be 2
            @($x.SeeAlso).Count               | Should -Be 1
        }
        It 'emits concepts sorted deterministically (by file name)' {
            $names = @(Get-Concept -DictionaryRoot $script:dict | Select-Object -ExpandProperty CanonicalForm)
            $names | Should -Be @('governance_adaptive', 'oversight_audit', 'risk_existential')
        }
    }

    Context 'filters' {
        It 'filters by -Slug and tolerates a term: prefix' {
            @(Get-Concept -DictionaryRoot $script:dict -Slug 'risk_existential').Count | Should -Be 1
            @(Get-Concept -DictionaryRoot $script:dict -Slug 'term:risk_existential').Count | Should -Be 1
            (Get-Concept -DictionaryRoot $script:dict -Slug 'term:risk_existential')[0].CanonicalForm | Should -Be 'risk_existential'
        }
        It 'filters by -Camp (short code -> primary_camp_origin)' {
            $r = @(Get-Concept -DictionaryRoot $script:dict -Camp skp)
            $r.Count | Should -Be 2
            ($r.CanonicalForm | Sort-Object) | Should -Be @('oversight_audit', 'risk_existential')
        }
        It 'filters by -Status' {
            $r = @(Get-Concept -DictionaryRoot $script:dict -Status provisional)
            $r.Count | Should -Be 1
            $r[0].CanonicalForm | Should -Be 'governance_adaptive'
        }
        It 'combines filters with AND' {
            @(Get-Concept -DictionaryRoot $script:dict -Camp skp -Status accepted).Count | Should -Be 1
        }
    }

    Context 'reverse concept-to-node map (-UsedByNode)' {
        It 'returns the concepts grounding a given node' {
            $r = @(Get-Concept -DictionaryRoot $script:dict -UsedByNode 'skp-beliefs-001')
            ($r.CanonicalForm | Sort-Object) | Should -Be @('oversight_audit', 'risk_existential')
        }
        It 'returns empty for a node no concept grounds' {
            @(Get-Concept -DictionaryRoot $script:dict -UsedByNode 'zzz-none-999').Count | Should -Be 0
        }
    }

    Context '-IncludeColloquial' {
        It 'adds colloquial terms with Kind=colloquial and ResolvesTo populated' {
            $all = @(Get-Concept -DictionaryRoot $script:dict -IncludeColloquial)
            $all.Count | Should -Be 4
            $col = @($all | Where-Object Kind -eq 'colloquial')
            $col.Count | Should -Be 1
            $col[0].CanonicalForm | Should -Be 'accountability'
            @($col[0].ResolvesTo)  | Should -Be @('accountability_algorithmic')
        }
        It 'excludes colloquial by default' {
            @(Get-Concept -DictionaryRoot $script:dict | Where-Object Kind -eq 'colloquial').Count | Should -Be 0
        }
    }

    Context 'errors' {
        It 'raises an ActionableError when the standardized dir is missing' {
            $missing = Join-Path $TestDrive 'no-such-dict'
            { Get-Concept -DictionaryRoot $missing } | Should -Throw -ExpectedMessage '*not found*'
        }
    }

    Context 'manifest export' {
        It 'exports Get-Concept' {
            Get-Command Get-Concept -Module AITriad | Should -Not -BeNullOrEmpty
        }
        It 'FunctionsToExport includes Get-Concept' {
            $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
            (Test-ModuleManifest -Path $manifestPath).ExportedFunctions.Keys | Should -Contain 'Get-Concept'
        }
    }
}
