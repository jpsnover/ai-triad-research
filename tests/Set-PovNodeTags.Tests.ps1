# Tag: taxonomy (t/3969)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Set-PovNodeTags (t/3969; TL t/3969#2 conditions B.1-B.6), the validatePovTags-
    enforcing pov_tags batch writer the t/3962 writer is required to use. Mocks
    Resolve-PovTagsCli with pwsh stubs impersonating lib/schema/pov-tags-cli.ts's documented
    stdout/stderr/exit contract (same technique as Export-TriadDebateBrief.Tests.ps1), so these
    tests do not depend on the live (currently empty) tag registry.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue

    $script:StubDir = Join-Path ([System.IO.Path]::GetTempPath()) "povtags-cli-stub-$(New-Guid)"
    New-Item -ItemType Directory -Path $script:StubDir -Force | Out-Null
    $script:PwshExe = (Get-Process -Id $PID).Path
    $script:InvokeCountFile = Join-Path $script:StubDir 'invoke-count.txt'

    # ok stub: echoes {checked = <count of entries in --input>, invalid=0, errors=[]}, exit 0.
    # Also appends to InvokeCountFile, so tests can assert the CLI was called exactly ONCE per
    # batch (TL cond B.2 — one call validates everything, never one call per node).
    $script:OkStub = Join-Path $script:StubDir 'ok.ps1'
    Set-Content -LiteralPath $script:OkStub -Encoding UTF8 -Value @'
param()
Add-Content -LiteralPath (Join-Path $PSScriptRoot 'invoke-count.txt') -Value '1'
$inputIdx = [array]::IndexOf($args, '--input')
$raw = Get-Content -Raw -LiteralPath $args[$inputIdx + 1]
$n = @($raw | ConvertFrom-Json).Count
Write-Output (@{ checked = $n; invalid = 0; errors = @() } | ConvertTo-Json -Compress)
exit 0
'@

    # invalid stub: refuses everything it was handed (exit 1), as if one bad entry failed the batch.
    $script:InvalidStub = Join-Path $script:StubDir 'invalid.ps1'
    Set-Content -LiteralPath $script:InvalidStub -Encoding UTF8 -Value @'
param()
$inputIdx = [array]::IndexOf($args, '--input')
$raw = Get-Content -Raw -LiteralPath $args[$inputIdx + 1]
$n = @($raw | ConvertFrom-Json).Count
Write-Output (@{ checked = $n; invalid = 1; errors = @('skp-999: tag "bogus" is not registered') } | ConvertTo-Json -Compress)
exit 1
'@

    # checked-mismatch stub: exits 0 but reports checking FEWER nodes than were submitted (the
    # empty-result trap TL cond B.3 names explicitly).
    $script:MismatchStub = Join-Path $script:StubDir 'mismatch.ps1'
    Set-Content -LiteralPath $script:MismatchStub -Encoding UTF8 -Value @'
Write-Output (@{ checked = 0; invalid = 0; errors = @() } | ConvertTo-Json -Compress)
exit 0
'@

    # could-not-run stub: a broken entrypoint, exit 2, no parseable result line.
    $script:BrokenStub = Join-Path $script:StubDir 'broken.ps1'
    Set-Content -LiteralPath $script:BrokenStub -Encoding UTF8 -Value @'
[Console]::Error.WriteLine('pov-tags-cli: could not run the check: ENOENT registry file')
exit 2
'@
}

AfterAll {
    Remove-Item -LiteralPath $script:StubDir -Recurse -Force -ErrorAction SilentlyContinue
}

Describe 'Set-PovNodeTags (t/3969)' -Tag 'taxonomy' {

    BeforeEach {
        if (Test-Path $script:InvokeCountFile) { Remove-Item $script:InvokeCountFile -Force }
        $script:PovDir = Join-Path $script:StubDir "pov-$(New-Guid)"
        New-Item -ItemType Directory -Path $script:PovDir -Force | Out-Null
        @'
{
  "nodes": [
    { "id": "skp-001", "label": "has tags", "pov_tags": ["old-tag"] },
    { "id": "skp-002", "label": "no tags yet" }
  ]
}
'@ | Set-Content -LiteralPath (Join-Path $script:PovDir 'skeptic.json')
        '{ "nodes": [] }' | Set-Content -LiteralPath (Join-Path $script:PovDir 'accelerationist.json')
        '{ "nodes": [] }' | Set-Content -LiteralPath (Join-Path $script:PovDir 'safetyist.json')
    }

    Context 'happy path' {
        BeforeEach {
            Mock -ModuleName AITriad Resolve-PovTagsCli { @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:OkStub) } }
        }

        It 'validates the WHOLE batch in ONE CLI call, then writes (TL cond B.2)' {
            $result = Set-PovNodeTags -Assignment @(
                @{ NodeId = 'skp-001'; Tags = @('a') }, @{ NodeId = 'skp-002'; Tags = @('b', 'c') }
            ) -TargetPath $script:PovDir -Confirm:$false
            $result.Checked | Should -Be 2
            $result.Applied | Should -Be 2
            (Get-Content -Raw $script:InvokeCountFile).Trim().Split("`n").Count | Should -Be 1
        }

        It 'binds a single bare string Tags as a one-element array end to end (TL cond B.1)' {
            $result = Set-PovNodeTags -Assignment @{ NodeId = 'skp-001'; Tags = 'solo-tag' } -TargetPath $script:PovDir -Confirm:$false
            $result.Applied | Should -Be 1
            $doc = Get-Content -Raw (Join-Path $script:PovDir 'skeptic.json') | ConvertFrom-Json -AsHashtable
            $node = @($doc.nodes | Where-Object { $_.id -eq 'skp-001' })[0]
            $node['pov_tags'] -is [System.Collections.IList] | Should -BeTrue
            @($node['pov_tags']) -join ',' | Should -Be 'solo-tag'
        }

        It 'a [PovTagAssignment] class instance binds a bare string Tags as a one-element array' {
            InModuleScope AITriad {
                $a = [PovTagAssignment]@{ NodeId = 'skp-001'; Tags = 'solo-tag' }
                $a.Tags -is [string[]] | Should -BeTrue
                @($a.Tags).Count | Should -Be 1
            }
        }

        It 'an empty Tags list writes pov_tags: [] (TL cond B.6), not field removal' {
            $result = Set-PovNodeTags -Assignment @{ NodeId = 'skp-002'; Tags = @() } -TargetPath $script:PovDir -Confirm:$false
            $result.Applied | Should -Be 1
            $doc = Get-Content -Raw (Join-Path $script:PovDir 'skeptic.json') | ConvertFrom-Json -AsHashtable
            $node = @($doc.nodes | Where-Object { $_.id -eq 'skp-002' })[0]
            $node.ContainsKey('pov_tags') | Should -BeTrue -Because 'written as an explicit empty array, not left absent'
            @($node['pov_tags']).Count | Should -Be 0
        }

        It 'surfaces a not-found node in NotFound without failing the rest of the batch' {
            $result = Set-PovNodeTags -Assignment @(
                @{ NodeId = 'skp-001'; Tags = @('a') }, @{ NodeId = 'skp-404'; Tags = @('a') }
            ) -TargetPath $script:PovDir -Confirm:$false -WarningAction SilentlyContinue
            $result.Applied | Should -Be 1
            $result.NotFound | Should -Contain 'skp-404'
        }

        It 'does not write anything under -WhatIf, but still validates' {
            Set-PovNodeTags -Assignment @{ NodeId = 'skp-001'; Tags = @('a') } -TargetPath $script:PovDir -WhatIf
            (Get-Content -Raw (Join-Path $script:PovDir 'skeptic.json')) | Should -Match 'old-tag' -Because 'the file must be untouched under -WhatIf'
        }

        It 'writes into -TargetPath, never a hardcoded data root' {
            $result = Set-PovNodeTags -Assignment @{ NodeId = 'skp-001'; Tags = @('a') } -TargetPath $script:PovDir -Confirm:$false
            $result.Applied | Should -Be 1
        }
    }

    Context 'refusal paths (TL cond B.2 / B.3 — nothing is written)' {
        It 'REFUSES the whole batch when the CLI reports ANY invalid entry — no partial write' {
            Mock -ModuleName AITriad Resolve-PovTagsCli { @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:InvalidStub) } }
            { Set-PovNodeTags -Assignment @(
                @{ NodeId = 'skp-001'; Tags = @('a') }, @{ NodeId = 'skp-999'; Tags = @('bogus') }
            ) -TargetPath $script:PovDir -Confirm:$false } | Should -Throw
            (Get-Content -Raw (Join-Path $script:PovDir 'skeptic.json')) | Should -Match 'old-tag' -Because 'a refused batch must leave every file untouched'
        }

        It 'REFUSES when checked != submitted, even on exit 0 (the empty-result trap, TL cond B.3)' {
            Mock -ModuleName AITriad Resolve-PovTagsCli { @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:MismatchStub) } }
            { Set-PovNodeTags -Assignment @{ NodeId = 'skp-001'; Tags = @('a') } -TargetPath $script:PovDir -Confirm:$false } | Should -Throw
            (Get-Content -Raw (Join-Path $script:PovDir 'skeptic.json')) | Should -Match 'old-tag'
        }

        It 'REFUSES with "could not run" on a non-0/1 exit' {
            Mock -ModuleName AITriad Resolve-PovTagsCli { @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:BrokenStub) } }
            $err = $null
            try { Set-PovNodeTags -Assignment @{ NodeId = 'skp-001'; Tags = @('a') } -TargetPath $script:PovDir -Confirm:$false }
            catch { $err = $_ }
            $err | Should -Not -BeNullOrEmpty
            $err.Exception.Message | Should -Match 'could not run the check'
        }
    }
}
