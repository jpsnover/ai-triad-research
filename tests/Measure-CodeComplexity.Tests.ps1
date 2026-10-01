# Tag: config (p/550)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Tests for Measure-CodeComplexity — AST-based McCabe complexity (p/550, Jeffrey's ask).
    Each decision-point type is covered by a hand-countable fixture; expected values were
    verified by manual AST-rule tracing before being written into assertions (not guessed).
#>

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force

    $script:Fx = Join-Path ([System.IO.Path]::GetTempPath()) ("mcc-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $script:Fx | Out-Null
    function script:WriteFixture([string]$Name, [string]$Content) {
        Set-Content -LiteralPath (Join-Path $script:Fx $Name) -Value $Content -Encoding utf8NoBOM
    }

    # 1: trivial (no branches) -> complexity 1
    script:WriteFixture 'trivial.ps1' @'
function Get-Trivial { return 1 }
'@

    # 2: if/elseif/else -> Clauses.Count=2 (if+elseif; else NOT counted) -> 1+2=3
    script:WriteFixture 'ifelse.ps1' @'
function Get-IfElse {
    param($x)
    if ($x -eq 1) { 'a' }
    elseif ($x -eq 2) { 'b' }
    else { 'c' }
}
'@

    # 3: loops -> while, do-while, do-until, for, foreach = 5 decision points -> 1+5=6
    script:WriteFixture 'loops.ps1' @'
function Get-Loops {
    param($x)
    while ($x -lt 1) { $x++ }
    do { $x++ } while ($x -lt 2)
    do { $x++ } until ($x -ge 3)
    for ($i = 0; $i -lt 3; $i++) { $x++ }
    foreach ($i in 1..3) { $x++ }
    return $x
}
'@

    # 4: switch -> 2 non-default clauses count, default does NOT -> 1+2=3
    script:WriteFixture 'switchstmt.ps1' @'
function Get-Switch {
    param($x)
    switch ($x) {
        1 { 'one' }
        2 { 'two' }
        default { 'other' }
    }
}
'@

    # 5: catch + ternary + and/or -> 1(catch)+1(ternary)+1(and)+1(or) = 4 -> 1+4=5
    script:WriteFixture 'misc.ps1' @'
function Get-Misc {
    param($a, $b)
    try { 1/0 } catch { 'caught' }
    $t = $a ? 'yes' : 'no'
    $r = ($a -and $b) -or (-not $a)
    return $t, $r
}
'@

    # 6: nested function — outer's OWN complexity must exclude the nested one's branches.
    # Outer: 1 if (Clauses=1) around the nested call = weight 1 -> 1+1=2 (own, nested excluded)
    # Nested: 1 if (Clauses=1) -> 1+1=2
    script:WriteFixture 'nested.ps1' @'
function Get-Outer {
    param($x)
    function script:Get-Inner {
        param($y)
        if ($y -gt 0) { return 'pos' }
        return 'nonpos'
    }
    if ($x) { return (script:Get-Inner $x) }
    return $null
}
'@

    # A deliberately malformed file — must be skipped (warned), not fatal to the whole run.
    script:WriteFixture 'broken.ps1' @'
function Get-Broken {
    if ($x -eq 1 {
'@

    # A non-matching extension (.txt) — must never be scanned by default Include.
    script:WriteFixture 'notes.txt' 'if this were scanned it would break the count'

    function script:Get([string]$File, [string]$Fn, [switch]$Verbose) {
        $all = Measure-CodeComplexity -Path $script:Fx -Include $File -WarningAction SilentlyContinue
        $all | Where-Object { $_.Function -eq $Fn }
    }
}

AfterAll {
    if ($script:Fx -and (Test-Path $script:Fx)) { Remove-Item -Recurse -Force $script:Fx -ErrorAction SilentlyContinue }
}

Describe 'Measure-CodeComplexity (p/550)' -Tag 'config' {

    It 'is exported and callable' {
        Get-Command Measure-CodeComplexity -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }

    It 'throws an ActionableError when the path is missing' {
        { Measure-CodeComplexity -Path (Join-Path $script:Fx 'nope') } |
            Should -Throw -ExpectedMessage '*Path not found*'
    }

    It 'a function with no branches has complexity exactly 1 (baseline)' {
        (script:Get 'trivial.ps1' 'Get-Trivial').Complexity | Should -Be 1
    }

    It 'if/elseif/else: each clause +1, else does NOT add -> 3' {
        (script:Get 'ifelse.ps1' 'Get-IfElse').Complexity | Should -Be 3
    }

    It 'while/do-while/do-until/for/foreach: +1 each -> 6' {
        (script:Get 'loops.ps1' 'Get-Loops').Complexity | Should -Be 6
    }

    It 'switch: non-default clauses +1 each, default does NOT add -> 3' {
        (script:Get 'switchstmt.ps1' 'Get-Switch').Complexity | Should -Be 3
    }

    It 'catch + ternary + -and + -or: +1 each -> 5' {
        (script:Get 'misc.ps1' 'Get-Misc').Complexity | Should -Be 5
    }

    It 'nested function: outer excludes nested branches, nested reports its own' {
        $outer = script:Get 'nested.ps1' 'Get-Outer'
        $inner = script:Get 'nested.ps1' 'script:Get-Inner'
        $outer.Complexity | Should -Be 2
        $inner.Complexity | Should -Be 2
    }

    It 'skips a malformed file with a warning, continues scanning the rest' {
        $warned = $false
        $r = Measure-CodeComplexity -Path $script:Fx -Include 'broken.ps1', 'trivial.ps1' -WarningVariable w -WarningAction SilentlyContinue
        @($w).Count | Should -BeGreaterThan 0
        ($r | Where-Object { $_.Function -eq 'Get-Trivial' }) | Should -Not -BeNullOrEmpty
    }

    It '-Include respects file-type filtering — a .txt file is never scanned by default' {
        $r = Measure-CodeComplexity -Path $script:Fx -WarningAction SilentlyContinue
        @($r.File) | Should -Not -Contain 'notes.txt'
    }

    It '-MinComplexity filters out functions below the threshold' {
        $r = Measure-CodeComplexity -Path $script:Fx -Include 'loops.ps1', 'trivial.ps1' -MinComplexity 5 -WarningAction SilentlyContinue
        @($r.Function) | Should -Contain 'Get-Loops'     # complexity 6 >= 5
        @($r.Function) | Should -Not -Contain 'Get-Trivial'   # complexity 1 < 5
    }

    It 'returns structured objects by default — File/Function/Complexity/StartLine' {
        $r = Measure-CodeComplexity -Path $script:Fx -Include 'ifelse.ps1' -WarningAction SilentlyContinue
        $r | Should -Not -BeOfType [string]
        $row = $r | Where-Object { $_.Function -eq 'Get-IfElse' }
        $row.File | Should -Be 'ifelse.ps1'
        $row.Complexity | Should -Be 3
        $row.StartLine | Should -BeGreaterThan 0
    }

    It 'defaults -Path to an existing directory and does not throw' {
        { Measure-CodeComplexity -MinComplexity 999999 -WarningAction SilentlyContinue } | Should -Not -Throw
    }
}
