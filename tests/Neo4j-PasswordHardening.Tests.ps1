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

    # ── t/3830: $Password String -> [PSCredential]$Credential (PSAvoidUsingPlainTextForPassword) ──

    It 'Install-GraphDatabase takes a [PSCredential]$Credential, not a plaintext [string] password' {
        $cmd = Get-Command Install-GraphDatabase
        $cmd.Parameters.ContainsKey('Password') | Should -BeFalse
        $cmd.Parameters.ContainsKey('Credential') | Should -BeTrue
        $cmd.Parameters['Credential'].ParameterType | Should -Be ([System.Management.Automation.PSCredential])
    }

    It 'Install-GraphDatabase source has no [string]$Password parameter' {
        $src = Get-Content (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Install-GraphDatabase.ps1') -Raw
        $src | Should -Not -Match '\[string\]\s*\$Password'
    }

    It 'Install-GraphDatabase does not reprint the resolved password in the completion summary (t/3830 cond.1)' {
        # The only sanctioned secret print is the generate branch; the "Password:" summary line must NOT
        # interpolate the resolved secret ($Neo4jPassword) — the assertion that catches the old :175.
        $src = Get-Content (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Install-GraphDatabase.ps1') -Raw
        $src | Should -Not -Match 'Password:\s*\$Neo4jPassword'
    }

    # ── t/3833: secret channel — NEO4J_AUTH_FILE (bind mount), no plaintext in argv / docker inspect ──
    # (Source-grep only; the live `docker inspect` / authenticated-connection proof is the Docker agent's.)

    It 'Install-GraphDatabase passes the credential via NEO4J_AUTH_FILE, not an inline NEO4J_AUTH env' {
        $src = Get-Content (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Install-GraphDatabase.ps1') -Raw
        $src | Should -Match 'NEO4J_AUTH_FILE'
        # The inline plaintext form `NEO4J_AUTH=<user>/<pw>` must be gone (NEO4J_AUTH_FILE= does not match this).
        $src | Should -Not -Match 'NEO4J_AUTH='
    }

    It 'Install-GraphDatabase verifies the credential with an authenticated request before declaring success' {
        $src = Get-Content (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Install-GraphDatabase.ps1') -Raw
        # SO cond.1 — a post-start authenticated probe (reuses the sibling cmdlet) that fails loudly on mismatch.
        $src | Should -Match "Invoke-CypherQuery -Query 'RETURN 1'"
        $src | Should -Match '\$AuthVerified'
    }

    It 'Install-GraphDatabase scrubs the auth secret by TRUNCATING the file, not deleting it (t/3833#4, WSL2 bind-mount)' {
        $src = Get-Content (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Install-GraphDatabase.ps1') -Raw
        # Docker/WSL2: deleting a live bind-mount source makes Docker recreate it as a directory, breaking
        # restart. The verified-path scrub must zero the file in place, keeping the bind source a file.
        $src | Should -Match 'WriteAllBytes\(\$AuthFile, \[byte\[\]\]@\(\)\)'
        # And the gate on the authenticated verify still exists.
        $src | Should -Match '\$AuthVerified'
    }
}
