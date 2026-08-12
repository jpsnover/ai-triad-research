# Tag: security (t/2530 M2)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression tests for t/2530 M2 — removal of hardcoded Neo4j 'aitriad2026' password fallback.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Neo4j password hardening (t/2530 M2)' -Tag 'security' {

    It 'Invoke-CypherQuery throws when NEO4J_PASSWORD is unset and no -Credential provided' {
        $prev = $env:NEO4J_PASSWORD
        $env:NEO4J_PASSWORD = $null
        try {
            { Invoke-CypherQuery -Query 'MATCH (n) RETURN n LIMIT 1' } | Should -Throw
        } finally {
            $env:NEO4J_PASSWORD = $prev
        }
    }

    It 'Invoke-CypherQuery error message is actionable (Goal/Problem/Location)' {
        $prev = $env:NEO4J_PASSWORD
        $env:NEO4J_PASSWORD = $null
        try {
            $err = $null
            try { Invoke-CypherQuery -Query 'MATCH (n) RETURN n LIMIT 1' } catch { $err = $_ }
            $err | Should -Not -BeNullOrEmpty
            "$err" | Should -Match 'NEO4J_PASSWORD'
        } finally {
            $env:NEO4J_PASSWORD = $prev
        }
    }

    It 'Export-TaxonomyToGraph throws when NEO4J_PASSWORD is unset and no -Credential provided' {
        $prev = $env:NEO4J_PASSWORD
        $env:NEO4J_PASSWORD = $null
        try {
            { Export-TaxonomyToGraph } | Should -Throw
        } finally {
            $env:NEO4J_PASSWORD = $prev
        }
    }

    It 'Export-TaxonomyToGraph error message is actionable (Goal/Problem/Location)' {
        $prev = $env:NEO4J_PASSWORD
        $env:NEO4J_PASSWORD = $null
        try {
            $err = $null
            try { Export-TaxonomyToGraph } catch { $err = $_ }
            $err | Should -Not -BeNullOrEmpty
            "$err" | Should -Match 'NEO4J_PASSWORD'
        } finally {
            $env:NEO4J_PASSWORD = $prev
        }
    }

    It 'Install-GraphDatabase source contains no hardcoded aitriad2026 password' {
        $src = Get-Content (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Install-GraphDatabase.ps1') -Raw
        $src | Should -Not -Match 'aitriad2026'
    }

    It 'Export-TaxonomyToGraph source contains no hardcoded aitriad2026 password' {
        $src = Get-Content (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Export-TaxonomyToGraph.ps1') -Raw
        $src | Should -Not -Match 'aitriad2026'
    }

    It 'Invoke-CypherQuery source contains no hardcoded aitriad2026 password' {
        $src = Get-Content (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Invoke-CypherQuery.ps1') -Raw
        $src | Should -Not -Match 'aitriad2026'
    }
}
