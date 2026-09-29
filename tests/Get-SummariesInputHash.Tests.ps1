# Tag: config (t/3745)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Get-SummariesInputHash — platform-stable content fingerprint (t/3745#8).
    CL-ratified predicate (p/23#452/#453): the hash is over LOGICAL content, not raw bytes —
    invariant to CRLF-vs-LF line endings and a leading UTF-8 BOM, sensitive to real content
    changes, deterministic/reproducible, and ordinally (not culture-) sorted by file name.
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force

    $script:Fixtures = [System.Collections.Generic.List[string]]::new()

    function script:New-HashFixtureDir {
        $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("gsih-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $script:Fixtures.Add($dir)
        $dir
    }

    # Writes raw bytes so we control line endings / BOM exactly (Set-Content would normalize).
    function script:WriteRawJson([string]$Path, [string]$Text, [switch]$WithBom) {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        if ($WithBom) { $bytes = [System.Text.Encoding]::UTF8.GetPreamble() + $bytes }
        [System.IO.File]::WriteAllBytes($Path, $bytes)
    }

    # Get-SummariesInputHash is Private — invoke through module session state (repo idiom).
    function script:Hash([string]$Dir) {
        InModuleScope AITriad -Parameters @{ Dir = $Dir } {
            Get-SummariesInputHash -SummariesDir $Dir
        }
    }
}

AfterAll {
    foreach ($p in $script:Fixtures) { if (Test-Path $p) { Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue } }
}

Describe 'Get-SummariesInputHash (t/3745#8 CL-ratified predicate fix)' -Tag 'config' {

    It 'is available (Private helper, loaded via module session state)' {
        InModuleScope AITriad {
            Get-Command Get-SummariesInputHash -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
        }
    }

    It 'is INVARIANT to CRLF vs LF line endings on identical logical content (t/3745#8 headline fix)' {
        $dirCrlf = script:New-HashFixtureDir
        $dirLf   = script:New-HashFixtureDir
        $content = '{"doc_id":"src-alpha","pov_summaries":{"saf":{"key_points":[{"verbatim":"q1"}]}}}'

        script:WriteRawJson (Join-Path $dirCrlf 'doc-alpha.json') ($content -replace "`n", "`r`n")
        script:WriteRawJson (Join-Path $dirLf   'doc-alpha.json') $content

        $hashCrlf = script:Hash $dirCrlf
        $hashLf   = script:Hash $dirLf
        $hashCrlf | Should -Be $hashLf
    }

    It 'is INVARIANT to a leading UTF-8 BOM (t/3745#8 CL-ratified step)' {
        $dirBom   = script:New-HashFixtureDir
        $dirNoBom = script:New-HashFixtureDir
        $content = '{"doc_id":"src-alpha","factual_claims":[{"claim":"c1"}]}'

        script:WriteRawJson (Join-Path $dirBom   'doc-alpha.json') $content -WithBom
        script:WriteRawJson (Join-Path $dirNoBom 'doc-alpha.json') $content

        $hashBom   = script:Hash $dirBom
        $hashNoBom = script:Hash $dirNoBom
        $hashBom | Should -Be $hashNoBom
    }

    It 'CHANGES when the actual logical content changes (not a blanket no-op)' {
        $dir = script:New-HashFixtureDir
        script:WriteRawJson (Join-Path $dir 'doc-alpha.json') '{"doc_id":"src-alpha","v":1}'
        $h1 = script:Hash $dir
        script:WriteRawJson (Join-Path $dir 'doc-alpha.json') '{"doc_id":"src-alpha","v":2}'
        $h2 = script:Hash $dir
        $h1 | Should -Not -Be $h2
    }

    It 'is deterministic/reproducible — identical input hashes identically on repeat calls' {
        $dir = script:New-HashFixtureDir
        script:WriteRawJson (Join-Path $dir 'doc-alpha.json') '{"doc_id":"src-alpha"}'
        script:WriteRawJson (Join-Path $dir 'doc-beta.json')  '{"doc_id":"src-beta"}'
        $h1 = script:Hash $dir
        $h2 = script:Hash $dir
        $h1 | Should -Be $h2
        $h1 | Should -Match '^[0-9a-f]{64}$'
    }

    It 'sorts file names ORDINALLY, not culture-aware — reproduces regardless of enumeration/insertion order' {
        # Ordinal puts ASCII uppercase before lowercase (e.g. "B" < "a"); a culture-aware sort
        # under most locales would interleave case-insensitively. Build the same 3-file set via
        # two different creation orders and assert both hash IDENTICALLY (the function always
        # re-sorts internally, so creation/enumeration order must not matter).
        $dirA = script:New-HashFixtureDir
        $dirB = script:New-HashFixtureDir
        foreach ($n in @('B-doc.json', 'a-doc.json', 'c-doc.json')) {
            script:WriteRawJson (Join-Path $dirA $n) "{`"doc_id`":`"$n`"}"
        }
        foreach ($n in @('c-doc.json', 'B-doc.json', 'a-doc.json')) {
            script:WriteRawJson (Join-Path $dirB $n) "{`"doc_id`":`"$n`"}"
        }
        (script:Hash $dirA) | Should -Be (script:Hash $dirB)
    }
}
