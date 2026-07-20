# Tag: enrichment (t/1653)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Regression coverage for t/1653: Update-TaxEmbeddings must surface the real
    Python traceback on a non-zero exit, not mask it with a generic hint.
.DESCRIPTION
    Before the fix, ANY non-zero exit from embed_taxonomy.py was replaced with
    "Is sentence-transformers installed?" — which masked a data-shape
    AttributeError at embed_taxonomy.py:204 and misdirected diagnosis toward a
    missing package. The cmdlet now captures the subprocess stderr and surfaces
    it verbatim FIRST (via New-ActionableError), keeping the install hint as a
    supplementary Next Step.

    This test drives the failure path with a fake embed_taxonomy.py that writes
    a distinctive traceback to stderr and exits 1, then asserts the marker
    reaches the emitted error. Requires python on PATH; a missing interpreter
    triggers a LOUD skip (t/1355 pattern) so a CI regression can't pass-by-skip.
#>

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Update-TaxEmbeddings surfaces Python stderr on failure (t/1653)' -Tag 'enrichment' {

    It 'Surfaces the verbatim Python traceback (and keeps the install hint) when embed_taxonomy.py exits non-zero' {
        $py = if (Get-Command python -ErrorAction SilentlyContinue) { 'python' }
              elseif (Get-Command python3 -ErrorAction SilentlyContinue) { 'python3' }
              else { $null }
        if (-not $py) {
            Set-ItResult -Skipped -Because 'python missing on PATH — Update-TaxEmbeddings stderr-surface guard NOT RUN (CI regression?)'
            return
        }

        $TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("aitriad-t1653-" + [System.Guid]::NewGuid().ToString('N'))
        $ScriptsDir = Join-Path $TempRoot 'scripts'
        New-Item -ItemType Directory -Path $ScriptsDir -Force | Out-Null
        try {
            # Fake embed script: emit a distinctive traceback to stderr, exit 1.
            # (PowerShell here-string keeps \n literal; python turns it into newlines.)
            $Fake = @"
import sys
sys.stderr.write("Traceback (most recent call last):\n")
sys.stderr.write("  File \"embed_taxonomy.py\", line 204, in _load_taxonomy_nodes\n")
sys.stderr.write("AttributeError: SENTINEL_TRACEBACK_t1653 'str' object has no attribute 'get'\n")
sys.exit(1)
"@
            Set-Content -Path (Join-Path $ScriptsDir 'embed_taxonomy.py') -Value $Fake -Encoding utf8

            $captured = InModuleScope AITriad -Parameters @{ Root = $TempRoot } {
                param($Root)
                $orig = $script:RepoRoot
                $script:RepoRoot = $Root
                try {
                    # The failure path emits via New-ActionableError under
                    # $ErrorActionPreference='Stop', so it surfaces as a
                    # terminating error — capture the message.
                    try {
                        Update-TaxEmbeddings *> $null
                        '<<NO-ERROR-THROWN>>'
                    } catch {
                        $_.Exception.Message
                    }
                }
                finally {
                    $script:RepoRoot = $orig
                }
            }

            $captured | Should -Match 'SENTINEL_TRACEBACK_t1653' -Because 'the real Python traceback must be surfaced, not masked by a generic hint'
            $captured | Should -Match 'line 204' -Because 'the failing file:line from the traceback must reach the operator'
            $captured | Should -Match 'sentence-transformers' -Because 'the install hint is retained as supplementary context, not the whole message'
        }
        finally {
            Remove-Item -Path $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
