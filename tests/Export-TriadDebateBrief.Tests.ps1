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

    # ok stub: records the exact CLI flags it received (so tests can assert flag
    # pass-through) then emits a TriadDeckExport JSON line + a WARN: line.
    $script:ArgsFile = Join-Path $script:StubDir 'last-args.txt'
    $script:OkStub = Join-Path $script:StubDir 'ok.ps1'
    Set-Content -LiteralPath $script:OkStub -Encoding UTF8 -Value @'
$args -join "`n" | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'last-args.txt') -Encoding UTF8
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

    # False-green (t/2874): a broken entrypoint exits 0 with NO stdout.
    $script:EmptyStub = Join-Path $script:StubDir 'empty.ps1'
    Set-Content -LiteralPath $script:EmptyStub -Encoding UTF8 -Value 'exit 0'

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

    Context 'Server mode (t/2862) — happy path (T6 REST client)' {
        BeforeEach {
            $script:SrvOut = Join-Path ([System.IO.Path]::GetTempPath()) "brief-srv-$(New-Guid)"
            # POST create job → 202 { jobId }.
            Mock -ModuleName AITriad Invoke-RemoteCheck -ParameterFilter { $Method -eq 'POST' } {
                [pscustomobject]@{ Success = $true; StatusCode = 202; Body = [pscustomobject]@{ jobId = 'job-1' }; Error = $null }
            }
            # GET poll → done, with an exportId + a warning to stream.
            Mock -ModuleName AITriad Invoke-RemoteCheck -ParameterFilter { $Method -eq 'GET' } {
                [pscustomobject]@{ Success = $true; StatusCode = 200; Body = [pscustomobject]@{
                        status = 'done'; progressPct = 100; warnings = @('symmetry tolerance 12% (soft)')
                        error = $null; errorCode = $null; exportId = 'exp-1' }; Error = $null }
            }
            # Download → write fake manifest + deck_spec so the build step has fields.
            Mock -ModuleName AITriad Save-BriefArtifact {
                $content = switch ($Name) {
                    'audit-manifest.json' { @{ debate_id = 'deb-123'; narrator_model = 'gemini-3.5-flash-lite'
                            narrator_model_source = 'ServerResolved'; checker_model = $null; trace_coverage_pct = 100
                            verdict_counts = @{ Supported = 3; Disputed = 1 }; warnings = @('symmetry tolerance 12% (soft)') } | ConvertTo-Json -Depth 6 }
                    'deck_spec.json'      { @{ title = 'Should we pause?' } | ConvertTo-Json }
                    default               { 'stub-artifact' }
                }
                $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force
                Set-Content -LiteralPath $Destination -Value $content -Encoding UTF8
            }
        }
        AfterEach { if ($script:SrvOut -and (Test-Path $script:SrvOut)) { Remove-Item -Recurse -Force $script:SrvOut -ErrorAction SilentlyContinue } }

        It 'creates job → polls → downloads → returns a [TriadDeckExport] with manifest+spec fields' {
            $r = Export-TriadDebateBrief -DebateId 'deb-123' -Preset conference -SkipNarration `
                -OutputDirectory $script:SrvOut -PassThru -WarningAction SilentlyContinue
            $r.GetType().Name  | Should -Be 'TriadDeckExport'
            $r.DebateId        | Should -Be 'deb-123'
            $r.Title           | Should -Be 'Should we pause?'
            $r.Preset          | Should -Be 'conference'
            $r.Model           | Should -Be 'gemini-3.5-flash-lite'
            $r.ModelSource     | Should -Be 'ServerResolved'
            $r.TraceCoveragePct| Should -Be 100
            $r.Verdicts['Supported'] | Should -Be 3
            $r.Path            | Should -Match 'brief\.pptx$'
            $r.ManifestPath    | Should -Match 'audit-manifest\.json$'
        }

        It 'downloads exactly the 4 artifacts and NEVER brief.html (PDF/HTML is Electron-only)' {
            $null = Export-TriadDebateBrief -DebateId 'deb-123' -SkipNarration -OutputDirectory $script:SrvOut -WarningAction SilentlyContinue
            Should -Invoke -ModuleName AITriad Save-BriefArtifact -Times 4
            Should -Invoke -ModuleName AITriad Save-BriefArtifact -Times 0 -ParameterFilter { $Name -eq 'brief.html' }
            Should -Invoke -ModuleName AITriad Save-BriefArtifact -Times 1 -ParameterFilter { $Name -eq 'brief.pptx' }
        }

        It '-AccessToken becomes Authorization: Bearer (never spoofs identity)' {
            $null = Export-TriadDebateBrief -DebateId 'deb-123' -SkipNarration -AccessToken 'TESTTOK' -OutputDirectory $script:SrvOut -WarningAction SilentlyContinue
            Should -Invoke -ModuleName AITriad Invoke-RemoteCheck -ParameterFilter { $ExtraHeaders['Authorization'] -eq 'Bearer TESTTOK' }
        }

        It 'streams the job warnings to Write-Warning' {
            $wv = $null
            $null = Export-TriadDebateBrief -DebateId 'deb-123' -SkipNarration -OutputDirectory $script:SrvOut -WarningVariable wv -WarningAction SilentlyContinue
            ($wv -join '|') | Should -Match 'symmetry tolerance'
        }

        It '-WhatIf names the resolved model and makes NO HTTP call' {
            $null = Export-TriadDebateBrief -DebateId 'deb-123' -Model 'gemini-3.5-flash-lite' -OutputDirectory $script:SrvOut -WhatIf
            Should -Invoke -ModuleName AITriad Invoke-RemoteCheck -Times 0
        }

        It 'binds -DebateId from the pipeline by property name' {
            $r = [pscustomobject]@{ DebateId = 'deb-123' } | Export-TriadDebateBrief -SkipNarration -OutputDirectory $script:SrvOut -PassThru -WarningAction SilentlyContinue
            $r.DebateId | Should -Be 'deb-123'
        }
    }

    Context 'Server mode (t/2862) — HTTP + job-failure error taxonomy' {
        It 'maps <Status> → <ErrId>' -ForEach @(
            @{ Status = 403; BodyErr = $null;             ErrId = 'AuthFailure' }
            @{ Status = 404; BodyErr = $null;             ErrId = 'DebateNotFound' }
            @{ Status = 409; BodyErr = $null;             ErrId = 'DebateNotClosed' }
            @{ Status = 429; BodyErr = 'quota_exceeded';  ErrId = 'ExportQuotaExceeded' }
            @{ Status = 429; BodyErr = 'concurrency_limit'; ErrId = 'ExportConcurrencyLimit' }
        ) {
            Mock -ModuleName AITriad Invoke-RemoteCheck -ParameterFilter { $Method -eq 'POST' } `
                -MockWith ({ [pscustomobject]@{ Success = $false; StatusCode = $Status; Body = [pscustomobject]@{ error = $BodyErr; message = 'boom' }; Error = 'boom' } }.GetNewClosure())
            $err = $null
            Export-TriadDebateBrief -DebateId 'deb-x' -SkipNarration -ErrorVariable err -ErrorAction SilentlyContinue
            $err[0].FullyQualifiedErrorId | Should -Match $ErrId
        }

        It 'maps a failed job errorCode (TraceGateFailure) to the non-terminating error id' {
            Mock -ModuleName AITriad Invoke-RemoteCheck -ParameterFilter { $Method -eq 'POST' } {
                [pscustomobject]@{ Success = $true; StatusCode = 202; Body = [pscustomobject]@{ jobId = 'job-1' }; Error = $null } }
            Mock -ModuleName AITriad Invoke-RemoteCheck -ParameterFilter { $Method -eq 'GET' } {
                [pscustomobject]@{ Success = $true; StatusCode = 200; Body = [pscustomobject]@{
                        status = 'failed'; progressPct = 60; warnings = @(); error = 'trace coverage 87% < 100%'; errorCode = 'TraceGateFailure'; exportId = $null }; Error = $null } }
            Mock -ModuleName AITriad Save-BriefArtifact { throw 'must not download on a failed job' }
            $err = $null
            Export-TriadDebateBrief -DebateId 'deb-x' -SkipNarration -ErrorVariable err -ErrorAction SilentlyContinue
            $err[0].FullyQualifiedErrorId | Should -Match 'TraceGateFailure'
            Should -Invoke -ModuleName AITriad Save-BriefArtifact -Times 0
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
        BeforeEach {
            Mock -ModuleName AITriad Resolve-BriefExportCli {
                @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:OkStub) }
            }
        }

        It 'returns a [TriadDeckExport] parsed from CLI stdout, streams WARN:, passes --out as a directory' {
            $f = New-DebateFile
            $out = Join-Path $script:StubDir 'out-happy'
            $warn = $null
            $res = Export-TriadDebateBrief -Path $f -Model gemini-3.5-flash-lite -OutputDirectory $out -PassThru -WarningVariable warn -WarningAction SilentlyContinue
            $res | Should -BeOfType ([TriadDeckExport])
            $res.DebateId | Should -Be 'deb-123'
            $res.TraceCoveragePct | Should -Be 100
            $res.Verdicts['Supported'] | Should -Be 3
            @($warn) -join ';' | Should -Match 'symmetry tolerance'

            $sent = Get-Content -Raw -LiteralPath $script:ArgsFile
            $sent | Should -Match '--out'
            $sent | Should -Match ([regex]::Escape($out))
            $sent | Should -Not -Match '--allow-open'
        }

        It 'passes --allow-open only when -AllowOpenDebate is set' {
            $f = New-DebateFile
            Export-TriadDebateBrief -Path $f -Model m -OutputDirectory (Join-Path $script:StubDir 'out-open') -AllowOpenDebate -WarningAction SilentlyContinue | Out-Null
            (Get-Content -Raw -LiteralPath $script:ArgsFile) | Should -Match '--allow-open'
        }

        It 'passes --skip-narration AND --model (sentinel) under -SkipNarration (t/2874: CLI requires --model always)' {
            $f = New-DebateFile
            Export-TriadDebateBrief -Path $f -SkipNarration -OutputDirectory (Join-Path $script:StubDir 'out-skip') -WarningAction SilentlyContinue | Out-Null
            $sent = Get-Content -Raw -LiteralPath $script:ArgsFile
            $sent | Should -Match '--skip-narration'
            $sent | Should -Match '--model'
            $sent | Should -Match 'deterministic'
        }

        It 'does not invoke the CLI under -WhatIf' {
            Mock -ModuleName AITriad Resolve-BriefExportCli { throw 'must not run under -WhatIf' }
            $f = New-DebateFile
            { Export-TriadDebateBrief -Path $f -Model m -OutputDirectory (Join-Path $script:StubDir 'wi') -WhatIf } | Should -Not -Throw
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
            Export-TriadDebateBrief -Path $f -Model m -OutputDirectory (Join-Path $script:StubDir 'out-fail') -ErrorVariable err -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
            $err[0].FullyQualifiedErrorId | Should -Match 'TraceGateFailure'
        }
    }

    Context 'Local mode — false-green guard: exit 0 with no output (t/2874)' {
        It 'raises an error instead of emitting an empty TriadDeckExport' {
            Mock -ModuleName AITriad Resolve-BriefExportCli {
                @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:EmptyStub) }
            }
            $f = New-DebateFile
            $err = $null
            $out = Export-TriadDebateBrief -Path $f -Model m -OutputDirectory (Join-Path $script:StubDir 'out-empty') -PassThru -ErrorVariable err -ErrorAction SilentlyContinue -WarningAction SilentlyContinue
            $out | Should -BeNullOrEmpty
            $err[0].FullyQualifiedErrorId | Should -Match 'RenderFailure'
            $err[0].Exception.Message | Should -Match 'no output'
        }
    }
}
