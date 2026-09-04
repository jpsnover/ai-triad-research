#Requires -Version 7
# Regression test for the FromUrl op-ed shim↔handler transport (t/2928).
#
# The incident: invoke-get-oped-source.ps1 did `$prep | ConvertTo-Json` on real article HTML and
# PowerShell emitted INVALID JSON (a bare unescaped " inside SourceMarkdown), which the Node
# handler could not JSON.parse → opaque "No result received." Fix: base64-encode the arbitrary
# fetched-content fields before ConvertTo-Json so it only ever serializes ASCII for them.
#
# This test replicates the shim's serialization step on the EXACT failing content shape (no
# network, no Get-OpEdSource call) and asserts the output is byte-faithful and, crucially, that
# the raw article text never reaches the JSON (so no quote in it can break Node's parser).
#
# NB: PowerShell ConvertFrom-Json is more lenient than Node JSON.parse, so a PS-side round-trip is
# NOT a full proxy for the Node handler — the byte-faithful + raw-text-absent assertions are what
# make this meaningful; the Node side is covered by opedShimTransport.test.ts + the live-app smoke.

Describe 'invoke-get-oped-source shim — base64 content transport (t/2928)' {
    BeforeAll {
        # The exact shape that broke it: prose with an embedded *"..."* quote + a base64 data-URI.
        $script:Nasty = "# Title`n`n*""Who is talking to your child?""*`n`nBody with a data URI ![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ) and a trailing ""quote""."

        # Mirror of Get-OpEdSource's PSCustomObject output (only the fields the shim touches).
        $prep = [PSCustomObject]@{
            Url            = 'https://example.test/article'
            SourceMarkdown = $script:Nasty
            Excerpt        = 'lead-in with a ""quoted"" phrase'
            ReadableWords  = 640
            SourceBrief    = $null
        }

        # Replicate the shim's encode step verbatim (invoke-get-oped-source.ps1).
        $b64Fields = @()
        foreach ($f in @('SourceMarkdown', 'Excerpt')) {
            $val = $prep.$f
            if ($val -is [string] -and $val.Length -gt 0) {
                $prep.$f = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($val))
                $b64Fields += $f
            }
        }
        $prep | Add-Member -NotePropertyName '_b64Fields' -NotePropertyValue $b64Fields -Force

        $script:Json = [ordered]@{ type = 'result'; data = $prep } | ConvertTo-Json -Depth 10 -Compress
    }

    It 'flags both content fields in _b64Fields' {
        $parsed = $script:Json | ConvertFrom-Json
        $parsed.data._b64Fields | Should -Contain 'SourceMarkdown'
        $parsed.data._b64Fields | Should -Contain 'Excerpt'
    }

    It 'never emits the raw article text into the JSON (so no quote in it can break the parser)' {
        $script:Json | Should -Not -Match 'Who is talking'
        $script:Json | Should -Not -Match 'quoted'
    }

    It 'round-trips SourceMarkdown byte-faithfully through base64 decode (handler-side)' {
        $parsed = $script:Json | ConvertFrom-Json
        $decoded = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parsed.data.SourceMarkdown))
        $decoded | Should -BeExactly $script:Nasty
    }

    It 'leaves non-content numeric fields untouched' {
        $parsed = $script:Json | ConvertFrom-Json
        $parsed.data.ReadableWords | Should -Be 640
    }

    It 'success line carries the locked SourceMarkdown field name under data (contract t/3306#4)' {
        $parsed = $script:Json | ConvertFrom-Json
        $parsed.type | Should -Be 'result'
        $parsed.data.PSObject.Properties.Name | Should -Contain 'SourceMarkdown'
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Convert-only failure-transport round-trip (t/3306/t/3307).
#
# The producer/consumer split (PowerShell authors the shim serialization; ElectronMain owns the
# opedHandlers parse) is only safe if the field names match EXACTLY. The locked failure contract
# (t/3306#4) is: PS emits `{ ErrorType, Goal, Problem, NextSteps }` as the LAST stderr line + exit 1;
# opedHandlers JSON.parses that last line and reads Problem (string) / Goal / NextSteps (array).
# These tests fail if either side renames a field.
# ─────────────────────────────────────────────────────────────────────────────
Describe 'invoke-get-oped-source shim — structured failure transport round-trip (t/3307)' {
    BeforeAll {
        $script:RepoRoot = Split-Path -Parent $PSScriptRoot
        $script:ShimPath = Join-Path $script:RepoRoot 'taxonomy-editor' 'src' 'main' 'ps' 'invoke-get-oped-source.ps1'
    }

    It 'end-to-end: emits the exact failure field names as the last stderr line and exits 1' {
        # ContentPathMissing needs no converter — exercises the real Get-OpEdSource structured throw
        # → real shim serialization → real field names (the definitive rename guard, both sides).
        $missing = Join-Path ([System.IO.Path]::GetTempPath()) ('nope-' + [guid]::NewGuid() + '.pdf')
        $stdin = [ordered]@{ ContentPath = $missing; ContentType = 'application/pdf' } | ConvertTo-Json -Compress
        $errFile = [System.IO.Path]::GetTempFileName()
        try {
            $stdin | pwsh -NoProfile -NonInteractive -File $script:ShimPath 2>$errFile | Out-Null
            $code = $LASTEXITCODE
            $stderr = Get-Content -LiteralPath $errFile -Raw

            $code | Should -Be 1 -Because 'a convert failure must exit non-zero'
            $lines = @($stderr -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
            $lines.Count | Should -BeGreaterThan 0 -Because 'the shim must write a structured failure line to stderr'
            $lastLine = $lines[-1].Trim()

            $parsed = $lastLine | ConvertFrom-Json   # must be valid JSON (opedHandlers JSON.parses it)
            $names = $parsed.PSObject.Properties.Name
            $names | Should -Contain 'ErrorType'
            $names | Should -Contain 'Goal'
            $names | Should -Contain 'Problem'
            $names | Should -Contain 'NextSteps'
            # Exact-set guard (no extra / renamed fields) — folds in #1947's original assertion so a
            # NEW field on either side also fails, not just a rename.
            @($names | Sort-Object) | Should -Be @('ErrorType', 'Goal', 'NextSteps', 'Problem')
            $parsed.ErrorType | Should -Be 'ContentPathMissing'
            $parsed.Problem   | Should -BeOfType [string]
            $parsed.NextSteps -is [array] | Should -BeTrue -Because 'opedHandlers does Array.isArray(parsed.NextSteps)'
        } finally {
            Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue
        }
    }

    It 'serializes NextSteps as a JSON array even with a single element (Array.isArray guard)' {
        # Mirror the shim catch serialization on a single-element NextSteps — the classic PS
        # single-element-array-collapses-to-scalar gotcha would silently break opedHandlers' array read.
        $payload = [PSCustomObject]@{ ErrorType = 'X'; Goal = 'g'; Problem = 'p'; NextSteps = [string[]]@('only one') }
        $out = [ordered]@{
            ErrorType = [string]$payload.ErrorType
            Goal      = [string]$payload.Goal
            Problem   = [string]$payload.Problem
            NextSteps = [string[]]@($payload.NextSteps)
        }
        $json = $out | ConvertTo-Json -Depth 5 -Compress
        $json | Should -Match '"NextSteps":\['
        $reparsed = $json | ConvertFrom-Json
        @($reparsed.NextSteps).Count | Should -Be 1
        $reparsed.NextSteps -is [array] | Should -BeTrue
    }
}
