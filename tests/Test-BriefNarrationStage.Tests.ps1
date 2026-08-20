# Tag: debate (t/2873)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Test-BriefNarrationStage (t/2873) — narrate-stage debug wrapper.
.DESCRIPTION
    Covers flag pass-through, the happy path, narration-failure-as-DATA (errors[] +
    EntryCount 0 returned, not thrown), -SkipNarration, checker verdict, and the
    input guards + infra-fault path — all against pwsh stubs for the narrate CLI
    (mocked via Resolve-BriefNarrateCli).
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue

    $script:StubDir = Join-Path ([System.IO.Path]::GetTempPath()) "narr-stub-$(New-Guid)"
    New-Item -ItemType Directory -Path $script:StubDir -Force | Out-Null
    $script:ArgsFile = Join-Path $script:StubDir 'last-args.txt'
    $script:PwshExe = (Get-Process -Id $PID).Path

    # Success: 3 entries, 2 audience questions, checker passed, no errors.
    $script:OkStub = Join-Path $script:StubDir 'ok.ps1'
    Set-Content -LiteralPath $script:OkStub -Encoding UTF8 -Value @'
$args -join "`n" | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'last-args.txt') -Encoding UTF8
$o = @{
    entryCount = 3; audienceQuestionCount = 2
    narration = @{ narration_mode = 'narrated'; entries = @(1, 2, 3) }
    checkerReport = @{ passed = $true }
    errors = @()
}
Write-Output ($o | ConvertTo-Json -Compress -Depth 6)
exit 0
'@

    # Completed run but the model produced a bad result: zero entries + errors[]. This
    # is DATA (exit 0), not an exception — the whole point of the diagnostic.
    $script:DataFailStub = Join-Path $script:StubDir 'datafail.ps1'
    Set-Content -LiteralPath $script:DataFailStub -Encoding UTF8 -Value @'
$o = @{
    entryCount = 0; audienceQuestionCount = 0; narration = $null
    errors = @("narration/entries: must NOT have fewer than 1 items", "trace /cruxes/9 unresolvable")
}
Write-Output ($o | ConvertTo-Json -Compress -Depth 6)
exit 0
'@

    # Infra fault: bad spec file etc. → exit != 0 + {errorCode,message} on stderr.
    $script:InfraFailStub = Join-Path $script:StubDir 'infrafail.ps1'
    Set-Content -LiteralPath $script:InfraFailStub -Encoding UTF8 -Value @'
[Console]::Error.WriteLine((@{ errorCode = "SpecSchemaFailure"; message = "deck_spec did not match schema" } | ConvertTo-Json -Compress))
exit 1
'@

    # False-green (t/2874): a broken entrypoint exits 0 with NO stdout.
    $script:EmptyStub = Join-Path $script:StubDir 'empty.ps1'
    Set-Content -LiteralPath $script:EmptyStub -Encoding UTF8 -Value 'exit 0'

    function New-SpecFile {
        $f = Join-Path $script:StubDir "spec-$(New-Guid).json"
        Set-Content -LiteralPath $f -Value '{"deck_spec_version":"1.0"}' -Encoding UTF8
        $f
    }
}

AfterAll {
    Remove-Item -LiteralPath $script:StubDir -Recurse -Force -ErrorAction SilentlyContinue
}

Describe 'Test-BriefNarrationStage' -Tag 'debate' {

    Context 'Input guards (non-terminating)' {
        It 'emits SpecFileInvalid for a missing -SpecPath' {
            $err = $null
            Test-BriefNarrationStage -SpecPath (Join-Path $script:StubDir 'nope.json') -Model m -ErrorVariable err -ErrorAction SilentlyContinue
            $err[0].FullyQualifiedErrorId | Should -Match 'SpecFileInvalid'
        }

        It 'emits ModelUnavailable when neither -Model nor -SkipNarration is given' {
            $f = New-SpecFile
            $err = $null
            Test-BriefNarrationStage -SpecPath $f -ErrorVariable err -ErrorAction SilentlyContinue
            $err[0].FullyQualifiedErrorId | Should -Match 'ModelUnavailable'
        }
    }

    Context 'Happy path' {
        BeforeEach {
            Mock -ModuleName AITriad Resolve-BriefNarrateCli {
                @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:OkStub) }
            }
        }

        It 'returns entry/audience counts, checker verdict, and raw narration; passes --spec/--model/--preset' {
            $f = New-SpecFile
            $r = Test-BriefNarrationStage -SpecPath $f -Model gemini-3.5-flash-lite -Preset classroom
            $r | Should -BeOfType ([pscustomobject])
            $r.EntryCount | Should -Be 3
            $r.AudienceQuestionCount | Should -Be 2
            $r.CheckerPassed | Should -BeTrue
            $r.Errors.Count | Should -Be 0
            $r.Narration.narration_mode | Should -Be 'narrated'
            $r.Preset | Should -Be 'classroom'

            $sent = Get-Content -Raw -LiteralPath $script:ArgsFile
            $sent | Should -Match '--spec'
            $sent | Should -Match '--model'
            $sent | Should -Match 'classroom'
            $sent | Should -Not -Match '--skip-narration'
        }

        It 'passes --skip-narration and no --model under -SkipNarration' {
            $f = New-SpecFile
            $r = Test-BriefNarrationStage -SpecPath $f -SkipNarration
            $r.Model | Should -Match 'skipped'
            $sent = Get-Content -Raw -LiteralPath $script:ArgsFile
            $sent | Should -Match '--skip-narration'
            $sent | Should -Not -Match '--model'
        }
    }

    Context 'Narration failure is DATA, not an exception' {
        It 'returns EntryCount 0 + populated Errors without throwing or writing an error' {
            Mock -ModuleName AITriad Resolve-BriefNarrateCli {
                @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:DataFailStub) }
            }
            $f = New-SpecFile
            $err = $null
            $r = Test-BriefNarrationStage -SpecPath $f -Model m -ErrorVariable err
            @($err).Count | Should -Be 0
            $r.EntryCount | Should -Be 0
            $r.Errors.Count | Should -Be 2
            ($r.Errors -join ';') | Should -Match 'unresolvable'
            $r.Narration | Should -BeNullOrEmpty
        }
    }

    Context 'False-green guard: exit 0 with no output' {
        It 'raises an error instead of returning an empty zero-entry result' {
            Mock -ModuleName AITriad Resolve-BriefNarrateCli {
                @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:EmptyStub) }
            }
            $f = New-SpecFile
            $err = $null
            $out = Test-BriefNarrationStage -SpecPath $f -Model m -ErrorVariable err -ErrorAction SilentlyContinue
            $out | Should -BeNullOrEmpty
            $err[0].FullyQualifiedErrorId | Should -Match 'NarrateCliFailure'
            $err[0].Exception.Message | Should -Match 'no output'
        }
    }

    Context 'Infra fault (exit != 0) maps the CLI errorCode' {
        It 'surfaces the CLI {errorCode} as a non-terminating error' {
            Mock -ModuleName AITriad Resolve-BriefNarrateCli {
                @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:InfraFailStub) }
            }
            $f = New-SpecFile
            $err = $null
            Test-BriefNarrationStage -SpecPath $f -Model m -ErrorVariable err -ErrorAction SilentlyContinue
            $err[0].FullyQualifiedErrorId | Should -Match 'SpecSchemaFailure'
        }
    }
}
