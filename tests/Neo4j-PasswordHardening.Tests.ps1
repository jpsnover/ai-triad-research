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

    It 'Install-GraphDatabase verifies the credential via Test-Neo4jAuthProbe before declaring success (t/3856)' {
        # SO cond.1 — a post-start authenticated probe that fails loudly on mismatch. t/3856: this used to
        # route through Invoke-CypherQuery -Query 'RETURN 1', which swallows its own HTTP/auth exceptions
        # and never rethrows, so -ErrorAction Stop there was a no-op and $AuthVerified became $true
        # regardless of outcome (the "both arms tested" source-grep this ticket replaces could not have
        # caught that — it asserted string presence, never executed anything). The ACTUAL behavior
        # verification — correct credential verifies, wrong credential/unreachable does not, distinguished
        # by reason — lives in tests/Test-Neo4jAuthProbe.Tests.ps1, which mocks Invoke-RestMethod and
        # exercises the real function. This remains a source-grep only for the wiring (the right helper is
        # actually called here), not the behavior.
        # t/3877: the readiness+auth-verify block was extracted to Private/Confirm-Neo4jReadyAndAuth.ps1
        # (complexity-ratchet decomposition, no behavior change) — the wiring this test greps for moved
        # there with it. Install-GraphDatabase itself now just calls the extracted function.
        $src = Get-Content (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Private' 'Confirm-Neo4jReadyAndAuth.ps1') -Raw
        $src | Should -Match 'Test-Neo4jAuthProbe -Credential \$ProbeCred'
        $src | Should -Not -Match "Invoke-CypherQuery -Query 'RETURN 1'" -Because 'the broken probe must not come back'
        $src | Should -Match '\$AuthVerified'

        $callerSrc = Get-Content (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Install-GraphDatabase.ps1') -Raw
        $callerSrc | Should -Match 'Confirm-Neo4jReadyAndAuth' -Because 'Install-GraphDatabase must actually call the extracted verify step'
    }

    It 'Install-GraphDatabase scrubs the auth secret by TRUNCATING the file, not deleting it (t/3833#4, WSL2 bind-mount)' {
        # t/3877: moved to Confirm-Neo4jReadyAndAuth.ps1 along with the rest of the auth-verify block.
        $src = Get-Content (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Private' 'Confirm-Neo4jReadyAndAuth.ps1') -Raw
        # Docker/WSL2: deleting a live bind-mount source makes Docker recreate it as a directory, breaking
        # restart. The verified-path scrub must zero the file in place, keeping the bind source a file.
        $src | Should -Match 'WriteAllBytes\(\$AuthFile, \[byte\[\]\]@\(\)\)'
        # And the gate on the authenticated verify still exists.
        $src | Should -Match '\$AuthVerified'
    }
}
