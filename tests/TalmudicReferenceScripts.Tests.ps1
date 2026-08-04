# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

Describe 'Talmudic reference experiment scripts' {
    BeforeAll {
        $repoRoot = Split-Path -Parent $PSScriptRoot
        $scriptPaths = @(
            'scripts\TalmudicDebate\Initialize-TalmudicCorpus.ps1',
            'scripts\TalmudicDebate\Run-TalmudicDebate.ps1',
            'scripts\TalmudicDebate\Review-TalmudicDebate.ps1',
            'scripts\TalmudicDebate\Invoke-TalmudicReferenceExperiment.ps1'
        ) | ForEach-Object { Join-Path $repoRoot $_ }
    }

    It 'all PowerShell entry points parse without syntax errors' {
        foreach ($scriptPath in $scriptPaths) {
            $tokens = $null
            $errors = $null
            $null = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
            @($errors).Count | Should -Be 0 -Because $scriptPath
        }
    }

    It 'tracks exactly twelve provisional Mishnah or Bavli references' {
        $manifestPath = Join-Path $repoRoot 'lib\debate\talmudic-pilot-manifest.json'
        $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
        $entries = @($manifest.entries)
        $entries.Count | Should -Be 12
        @($entries | Where-Object { $_.review_status -ne 'provisional' }).Count | Should -Be 0
        @($entries | Where-Object { $_.layer -notin @('mishnah', 'bavli') }).Count | Should -Be 0
        @($entries | Where-Object { [string]::IsNullOrWhiteSpace($_.source_version) -or [string]::IsNullOrWhiteSpace($_.translation_version) }).Count | Should -Be 0
        @($entries | Where-Object { $_.source_license -eq 'unknown' -or $_.translation_license -eq 'unknown' }).Count | Should -Be 0
    }

    It 'keeps corpus and experiment outputs beneath the repository local-data directory' {
        $initializer = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'scripts\TalmudicDebate\Initialize-TalmudicCorpus.ps1')
        $experiment = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'scripts\TalmudicDebate\Invoke-TalmudicReferenceExperiment.ps1')
        $initializer | Should -Match '\.local-data\\talmudic-corpus'
        $experiment | Should -Match '\.local-data\\talmudic-experiments'
        $initializer | Should -Match 'StartsWith\(\$allowedOutputPrefix'
    }
}
