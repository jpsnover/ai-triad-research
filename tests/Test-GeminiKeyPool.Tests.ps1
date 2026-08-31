# Tag: enrichment (t/3141)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Unit tests for Test-GeminiKeyPool (t/3141). Mocks the Test-AIApiKey auth probe; uses SYNTHETIC
    keys built at runtime (split literals) so no source literal matches a key pattern, and asserts
    output is MASKED (never a raw key).
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
}

Describe 'Test-GeminiKeyPool' -Tag 'enrichment' {

    It 'is exported from the module' {
        Get-Command -Module AITriad -Name 'Test-GeminiKeyPool' | Should -Not -BeNullOrEmpty
    }

    It 'parses both key formats, dedups, ignores blank/# lines; classifies via the probe; masks output' {
        InModuleScope AITriad {
            # SYNTHETIC keys — built via concatenation so the source never contains a full key literal.
            $k1 = 'AIza' + 'SYNTHETIC_key_' + ('0' * 21)    # valid (200); exactly 35 chars after AIza
            $k2 = 'AQ.'  + 'SYNTHETICdeadkey' + ('0' * 14)  # dead (403)
            $k3 = 'AIza' + 'SYNTHETIC_thr_' + ('1' * 21)    # throttled (429)

            $tmp = Join-Path ([System.IO.Path]::GetTempPath()) "keys-$([guid]::NewGuid().ToString('N').Substring(0,8)).txt"
            Set-Content -LiteralPath $tmp -Value @('# free-tier keys', '', $k1, $k2, $k3, $k1) -Encoding utf8  # k1 duplicated

            Mock Test-AIApiKey -MockWith {
                if ($ApiKey -like '*deadkey*') { [PSCustomObject]@{ Functional = $false; StatusCode = 403; LatencyMs = 5 } }
                elseif ($ApiKey -like '*_thr_*') { [PSCustomObject]@{ Functional = $false; StatusCode = 429; LatencyMs = 5 } }
                else { [PSCustomObject]@{ Functional = $true; StatusCode = 200; LatencyMs = 5 } }
            }

            try {
                $r = Test-GeminiKeyPool -Path $tmp
                $r.UniqueCount | Should -Be 3        # k1 deduped
                $r.Valid       | Should -Be 1
                $r.Dead        | Should -Be 1
                $r.Throttled   | Should -Be 1
                $r.NetworkErr  | Should -Be 0
                @($r.Keys).Count | Should -Be 3

                # MASKED: no raw key material in the output (distinctive middle chunk absent).
                $joined = (@($r.Keys) | ForEach-Object { "$($_.Fingerprint)" }) -join ' '
                $joined | Should -Not -Match 'SYNTHETIC'          # middle of every synthetic key
                $joined | Should -Match '…'                        # masked fingerprint format
            } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
        }
    }

    It 'classifies a NETWORK-ERR (null StatusCode) key' {
        InModuleScope AITriad {
            $k = 'AIza' + 'SYNTHETIC_net_' + ('2' * 21)
            $tmp = Join-Path ([System.IO.Path]::GetTempPath()) "keys-$([guid]::NewGuid().ToString('N').Substring(0,8)).txt"
            Set-Content -LiteralPath $tmp -Value @($k) -Encoding utf8
            Mock Test-AIApiKey -MockWith { [PSCustomObject]@{ Functional = $false; StatusCode = $null; LatencyMs = $null } }
            try {
                $r = Test-GeminiKeyPool -Path $tmp
                $r.NetworkErr | Should -Be 1
                $r.Keys[0].Status | Should -Be 'NETWORK-ERR'
            } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
        }
    }

    It 'throws when no -Path and no $env:GEMINI_FREE_KEYS_FILE' {
        InModuleScope AITriad {
            $prev = $env:GEMINI_FREE_KEYS_FILE
            $env:GEMINI_FREE_KEYS_FILE = $null
            try { { Test-GeminiKeyPool } | Should -Throw } finally { $env:GEMINI_FREE_KEYS_FILE = $prev }
        }
    }

    It 'throws an actionable error when the key file is missing' {
        { Test-GeminiKeyPool -Path (Join-Path ([System.IO.Path]::GetTempPath()) 'no-such-keys-file.txt') } | Should -Throw
    }
}
