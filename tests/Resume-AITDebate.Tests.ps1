# Tag: debate (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Resume-AITDebate' -Tag 'debate' {

    It 'Is exported from the module' {
        Get-Command Resume-AITDebate -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It 'Has the documented parameters' {
        $cmd = Get-Command Resume-AITDebate -Module AITriad -ErrorAction Stop
        foreach ($p in 'From','OutputDirectory','ProgressFile','ProgressDebateName') {
            ($cmd.Parameters.Keys -contains $p) | Should -Be $true
        }
    }

    It '-From is mandatory' {
        $cmd = Get-Command Resume-AITDebate -Module AITriad -ErrorAction Stop
        $cmd.Parameters['From'].Attributes.Mandatory | Should -Contain $true
    }

    It '-From accepts Path and Checkpoint as aliases' {
        $cmd = Get-Command Resume-AITDebate -Module AITriad -ErrorAction Stop
        $aliases = $cmd.Parameters['From'].Aliases
        $aliases | Should -Contain 'Path'
        $aliases | Should -Contain 'Checkpoint'
    }

    It 'Throws ActionableError when -From file does not exist' {
        $missingPath = Join-Path ([System.IO.Path]::GetTempPath()) "no-such-checkpoint-$(Get-Random).json"
        { Resume-AITDebate -From $missingPath } | Should -Throw
    }

    It 'Throws ActionableError when checkpoint is invalid JSON' {
        $f = Join-Path ([System.IO.Path]::GetTempPath()) "bad-checkpoint-$(Get-Random).json"
        try {
            Set-Content -Path $f -Value '{ not valid json' -Encoding utf8NoBOM
            { Resume-AITDebate -From $f } | Should -Throw
        } finally { if (Test-Path $f) { Remove-Item $f -Force } }
    }

    It 'Throws ActionableError when checkpoint is missing required resume-contract fields' {
        # Valid JSON but missing transcript/argument_network/crux_tracker
        $f = Join-Path ([System.IO.Path]::GetTempPath()) "incomplete-checkpoint-$(Get-Random).json"
        try {
            @{ session_id = 'xyz'; phase = 'argumentation' } | ConvertTo-Json | Set-Content -Path $f -Encoding utf8NoBOM
            $err = $null
            try { Resume-AITDebate -From $f } catch { $err = $_ }
            $err | Should -Not -BeNullOrEmpty
            $err.Exception.Message | Should -Match 'required structured fields'
        } finally { if (Test-Path $f) { Remove-Item $f -Force } }
    }

    It 'Accepts a checkpoint with all three required fields (gets past validation)' {
        # Pre-npx; gates the checkpoint check independent of subprocess outcome.
        $f = Join-Path ([System.IO.Path]::GetTempPath()) "valid-checkpoint-$(Get-Random).json"
        try {
            @{
                session_id       = 'test'
                phase            = 'argumentation'
                transcript       = @()
                argument_network = @{ nodes = @(); edges = @() }
                crux_tracker     = @{ cruxes = @() }
            } | ConvertTo-Json -Depth 5 | Set-Content -Path $f -Encoding utf8NoBOM

            # We can't easily mock the npx subprocess from here without invasive plumbing.
            # The post-validation failure (cli not found / npx fails / etc.) is acceptable
            # for this test — what we're proving is the resume-contract check PASSED.
            $err = $null
            try { Resume-AITDebate -From $f -OutputDirectory $env:TEMP 6>$null 2>$null } catch { $err = $_ }
            # Either succeeds (if npx + CLI happen to be set up) or fails for a downstream reason.
            # If it failed, the error must NOT be about missing resume-contract fields.
            if ($err) {
                $err.Exception.Message | Should -Not -Match 'required structured fields'
            }
        } finally { if (Test-Path $f) { Remove-Item $f -Force } }
    }
}

Describe 'Resume-AITDebate - manifest' -Tag 'debate' {
    It 'FunctionsToExport includes Resume-AITDebate' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        $manifest = Test-ModuleManifest -Path $manifestPath
        $manifest.ExportedFunctions.Keys | Should -Contain 'Resume-AITDebate'
    }
}
