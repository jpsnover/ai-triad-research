# Tag: unit (t/1812)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    function New-BatchConfig {
        param([string]$Path, [array]$Debates, [bool]$BatchSynthetic)
        $cfg = [ordered]@{ name = 'testbatch'; debates = $Debates }
        if ($PSBoundParameters.ContainsKey('BatchSynthetic')) { $cfg.synthetic = $BatchSynthetic }
        $cfg | ConvertTo-Json -Depth 6 | Set-Content -Path $Path -Encoding utf8
    }
}

AfterAll {
    Remove-Item Env:AI_TRIAD_SYNTHETIC_CALIBRATION -ErrorAction SilentlyContinue
    Remove-Variable -Name T1812Env -Scope Global -ErrorAction SilentlyContinue
}

Describe 'Invoke-DebateBatch — synthetic calibration tagging (t/1812)' -Tag 'unit' {

    BeforeEach {
        $global:T1812Env = @()
        # Capture the env value each debate's engine child WOULD inherit (set right
        # before the Invoke-AITDebate spawn). Recorded in debate order.
        Mock -CommandName Invoke-AITDebate -ModuleName AITriad -MockWith {
            $global:T1812Env += , ([string]$env:AI_TRIAD_SYNTHETIC_CALIBRATION)
            [PSCustomObject]@{ ok = $true }
        }
        Mock -CommandName Update-DebateProgress -ModuleName AITriad -MockWith { }
        Remove-Item Env:AI_TRIAD_SYNTHETIC_CALIBRATION -ErrorAction SilentlyContinue
    }

    It '-Synthetic sets the signal to 1 for the debate invocation' {
        $cfg = Join-Path $TestDrive 'syn-switch.json'
        New-BatchConfig -Path $cfg -Debates @(@{ name = 'd1'; topic = 't' })
        Invoke-DebateBatch -ConfigPath $cfg -Synthetic -OutputDirectory (Join-Path $TestDrive 'o1') 6>$null | Out-Null
        $global:T1812Env[0] | Should -Be '1'
    }

    It 'a REAL batch (no switch/flag) does NOT set the signal' {
        $cfg = Join-Path $TestDrive 'real.json'
        New-BatchConfig -Path $cfg -Debates @(@{ name = 'd1'; topic = 't' })
        Invoke-DebateBatch -ConfigPath $cfg -OutputDirectory (Join-Path $TestDrive 'o2') 6>$null | Out-Null
        $global:T1812Env[0] | Should -Not -Be '1'
    }

    It 'a top-level "synthetic": true in the config tags the batch' {
        $cfg = Join-Path $TestDrive 'syn-cfg.json'
        New-BatchConfig -Path $cfg -BatchSynthetic $true -Debates @(@{ name = 'd1'; topic = 't' })
        Invoke-DebateBatch -ConfigPath $cfg -OutputDirectory (Join-Path $TestDrive 'o3') 6>$null | Out-Null
        $global:T1812Env[0] | Should -Be '1'
    }

    It 'MIXED batch is classified PER-DEBATE — the real debate is NOT over-tagged (TL p/24#148)' {
        $cfg = Join-Path $TestDrive 'mixed.json'
        New-BatchConfig -Path $cfg -Debates @(
            @{ name = 'syn';  topic = 't'; synthetic = $true },
            @{ name = 'real'; topic = 't'; synthetic = $false }
        )
        Invoke-DebateBatch -ConfigPath $cfg -OutputDirectory (Join-Path $TestDrive 'o4') 6>$null | Out-Null
        $global:T1812Env[0] | Should -Be '1'       # synthetic debate → fixtures/
        $global:T1812Env[1] | Should -Not -Be '1'  # real debate → core/ (not misrouted)
    }

    It 'a per-debate "synthetic": false overrides the batch-wide default' {
        $cfg = Join-Path $TestDrive 'override.json'
        New-BatchConfig -Path $cfg -BatchSynthetic $true -Debates @(
            @{ name = 'a'; topic = 't' },                    # inherits batch default → synthetic
            @{ name = 'b'; topic = 't'; synthetic = $false } # explicit override → real
        )
        Invoke-DebateBatch -ConfigPath $cfg -OutputDirectory (Join-Path $TestDrive 'o5') 6>$null | Out-Null
        $global:T1812Env[0] | Should -Be '1'
        $global:T1812Env[1] | Should -Not -Be '1'
    }

    It 'restores the PRIOR signal value after the run (no leak to a later real debate)' {
        $env:AI_TRIAD_SYNTHETIC_CALIBRATION = 'sentinel'
        $cfg = Join-Path $TestDrive 'restore.json'
        New-BatchConfig -Path $cfg -Debates @(@{ name = 'd1'; topic = 't'; synthetic = $true })
        Invoke-DebateBatch -ConfigPath $cfg -OutputDirectory (Join-Path $TestDrive 'o6') 6>$null | Out-Null
        $env:AI_TRIAD_SYNTHETIC_CALIBRATION | Should -Be 'sentinel'
    }

    It 'leaves the signal UNSET afterward when it was unset before' {
        $cfg = Join-Path $TestDrive 'restore-unset.json'
        New-BatchConfig -Path $cfg -Debates @(@{ name = 'd1'; topic = 't'; synthetic = $true })
        Invoke-DebateBatch -ConfigPath $cfg -OutputDirectory (Join-Path $TestDrive 'o7') 6>$null | Out-Null
        (Test-Path Env:AI_TRIAD_SYNTHETIC_CALIBRATION) | Should -BeFalse
    }
}
