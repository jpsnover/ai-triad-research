# Tag: debate (t/2806)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

# `using module` makes the module-scope [TriadDeckExport] class visible in this test
# scope (Import-Module alone does not export classes). Must precede other statements.
using module ..\scripts\AITriad\AITriad.psm1

<#
.SYNOPSIS
    Export-TriadDebateBrief (Brief Export T8) — local mode + [TriadDeckExport] parity.
.DESCRIPTION
    Covers the frozen wire contract (field parity with lib/brief/types.ts), server-mode
    deferral (t/2839), the local-mode error taxonomy, and the happy/failure paths against
    a pwsh stub standing in for the t/2837 CLI (mocked via Resolve-BriefExportCli).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    $script:TypesPath = Join-Path $PSScriptRoot '..' 'lib' 'brief' 'types.ts'

    # A pwsh stub that impersonates the t/2837 CLI: emits a TriadDeckExport JSON line on
    # stdout, WARN: lines + (on failure) a {errorCode,message} line on stderr.
    $script:StubDir = Join-Path ([System.IO.Path]::GetTempPath()) "brief-stub-$(New-Guid)"
    New-Item -ItemType Directory -Path $script:StubDir -Force | Out-Null

    $script:OkStub = Join-Path $script:StubDir 'ok.ps1'
    Set-Content -LiteralPath $script:OkStub -Encoding UTF8 -Value @'
[Console]::Error.WriteLine("WARN: symmetry tolerance 12% (soft)")
$deck = @{
    debateId = "deb-123"; title = "Should we pause?"; preset = "policymaker"
    model = "gemini-3.5-flash-lite"; modelSource = "Explicit"; checkerModel = $null
    path = "C:\out\brief.pptx"; specPath = "C:\out\deck_spec.json"
    manifestPath = "C:\out\audit-manifest.json"; traceCoveragePct = 100
    verdicts = @{ Supported = 3; Disputed = 1 }; warnings = @("symmetry tolerance 12% (soft)")
}
Write-Output ($deck | ConvertTo-Json -Compress -Depth 6)
exit 0
'@

    $script:FailStub = Join-Path $script:StubDir 'fail.ps1'
    Set-Content -LiteralPath $script:FailStub -Encoding UTF8 -Value @'
[Console]::Error.WriteLine("WARN: partial extraction")
[Console]::Error.WriteLine((@{ errorCode = "TraceGateFailure"; message = "trace coverage 87% < 100%" } | ConvertTo-Json -Compress))
exit 3
'@

    $script:PwshExe = (Get-Process -Id $PID).Path

    function New-DebateFile {
        $f = Join-Path $script:StubDir "debate-$(New-Guid).json"
        Set-Content -LiteralPath $f -Value '{"id":"deb-123","phase":"closed"}' -Encoding UTF8
        $f
    }
}

AfterAll {
    Remove-Item -LiteralPath $script:StubDir -Recurse -Force -ErrorAction SilentlyContinue
}

Describe 'Export-TriadDebateBrief' -Tag 'debate' {

    Context '[TriadDeckExport] wire-contract parity with lib/brief/types.ts' {
        It 'has exactly the fields of the TS TriadDeckExport interface (case-insensitive)' {
            $ts = Get-Content -Raw -LiteralPath $script:TypesPath
            $m = [regex]::Match($ts, 'export interface TriadDeckExport \{(?<body>[^}]*)\}')
            $m.Success | Should -BeTrue -Because 'the TS interface must exist to compare against'
            $tsFields = [regex]::Matches($m.Groups['body'].Value, '(?m)^\s*(?<name>\w+)\??:') |
                ForEach-Object { $_.Groups['name'].Value.ToLowerInvariant() } | Sort-Object

            $psFields = ([TriadDeckExport].GetProperties() | ForEach-Object { $_.Name.ToLowerInvariant() }) | Sort-Object

            ($psFields -join ',') | Should -Be ($tsFields -join ',') -Because 'PS class and TS interface are one wire contract'
        }
    }

    Context 'Server mode (deferred, t/2839)' {
        It 'throws an actionable error naming the auth gate and NOT touching the CLI' {
            Mock -ModuleName AITriad Resolve-BriefExportCli { throw 'CLI must not be resolved in server mode' }
            { Export-TriadDebateBrief -DebateId 'deb-123' -Preset policymaker -ErrorAction Stop } |
                Should -Throw -ExpectedMessage '*t/2839*'
            Should -Invoke -ModuleName AITriad Resolve-BriefExportCli -Times 0
        }
    }

    Context 'Local mode — input guards (non-terminating error taxonomy)' {
        It 'emits DebateFileInvalid for a missing -Path' {
            $err = $null
            Export-TriadDebateBrief -Path (Join-Path $script:StubDir 'nope.json') -Model m -ErrorVariable err -ErrorAction SilentlyContinue
            @($err).Count | Should -BeGreaterThan 0
            $err[0].FullyQualifiedErrorId | Should -Match 'DebateFileInvalid'
        }

        It 'emits ModelUnavailable when neither -Model nor -SkipNarration is given' {
            $f = New-DebateFile
            $err = $null
            Export-TriadDebateBrief -Path $f -ErrorVariable err -ErrorAction SilentlyContinue
            $err[0].FullyQualifiedErrorId | Should -Match 'ModelUnavailable'
        }
    }

    Context 'Local mode — happy path' {
        It 'returns a [TriadDeckExport] parsed from CLI stdout and streams WARN: lines' {
            Mock -ModuleName AITriad Resolve-BriefExportCli {
                @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:OkStub) }
            }
            $f = New-DebateFile
            $out = Join-Path $script:StubDir 'out.pptx'
            $warn = $null
            $res = Export-TriadDebateBrief -Path $f -Model gemini-3.5-flash-lite -OutputPath $out -PassThru -WarningVariable warn -WarningAction SilentlyContinue
            $res | Should -BeOfType ([TriadDeckExport])
            $res.DebateId | Should -Be 'deb-123'
            $res.TraceCoveragePct | Should -Be 100
            $res.Verdicts['Supported'] | Should -Be 3
            @($warn) -join ';' | Should -Match 'symmetry tolerance'
        }

        It 'does not invoke the CLI under -WhatIf' {
            Mock -ModuleName AITriad Resolve-BriefExportCli { throw 'must not run under -WhatIf' }
            $f = New-DebateFile
            { Export-TriadDebateBrief -Path $f -Model m -OutputPath (Join-Path $script:StubDir 'wi.pptx') -WhatIf } | Should -Not -Throw
            Should -Invoke -ModuleName AITriad Resolve-BriefExportCli -Times 0
        }
    }

    Context 'Local mode — CLI failure maps the wire errorCode' {
        It 'surfaces the CLI {errorCode} as the non-terminating error id' {
            Mock -ModuleName AITriad Resolve-BriefExportCli {
                @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:FailStub) }
            }
            $f = New-DebateFile
            $err = $null
            Export-TriadDebateBrief -Path $f -Model m -OutputPath (Join-Path $script:StubDir 'f.pptx') -ErrorVariable err -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
            $err[0].FullyQualifiedErrorId | Should -Match 'TraceGateFailure'
        }
    }
}
