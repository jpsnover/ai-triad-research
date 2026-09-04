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
}

# ── Locked cross-role wire contract (t/3306#4, t/3307) ────────────────────────────────────────────
# The shim (invoke-get-oped-source.ps1) EMIT side must use the exact field names the TS parse side
# (opedShimTransport.ts) reads. TL's non-negotiable guard: assert the exact field names on emit here;
# the TS test (opedShimTransport.test.ts) asserts the same names on parse. Success carries
# SourceMarkdown; failure carries EXACTLY {ErrorType, Goal, Problem, NextSteps} on stderr.
Describe 'op-ed shim ↔ handler LOCKED wire contract (t/3307)' {
    BeforeAll {
        $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
        Import-Module $ModulePath -Force -WarningAction SilentlyContinue
    }

    It 'success result carries the SourceMarkdown field name' {
        $prep = [PSCustomObject]@{ SourceMarkdown = 'body'; Excerpt = 'lead'; SourceFormat = 'html' }
        $line = [ordered]@{ type = 'result'; data = $prep } | ConvertTo-Json -Depth 10 -Compress
        $parsed = $line | ConvertFrom-Json
        $parsed.type                                    | Should -Be 'result'
        $parsed.data.PSObject.Properties.Name           | Should -Contain 'SourceMarkdown'
    }

    It 'failure serialization emits EXACTLY {ErrorType,Goal,Problem,NextSteps} from the structured TargetObject' {
        # Build the real structured error Get-OpEdSource throws, then replicate the shim catch verbatim.
        $rec = InModuleScope AITriad {
            New-ActionableError -AsErrorRecord -ErrorType 'ContentPathMissing' `
                -Goal 'Convert pre-fetched source content for op-ed generation' `
                -Problem "Content file not found: 'x'" `
                -Location 'Get-OpEdSource' `
                -NextSteps @('Confirm the fetcher wrote the temp file', 'Supply -Topic text instead')
        }
        $to = $rec.TargetObject
        $to | Should -BeOfType [System.Collections.IDictionary]

        # Verbatim mirror of the shim's catch-block serialization.
        $err = [ordered]@{
            ErrorType = [string]$to['ErrorType']
            Goal      = [string]$to['Goal']
            Problem   = [string]$to['Problem']
            NextSteps = @($to['NextSteps'])
        }
        $json   = $err | ConvertTo-Json -Depth 6 -Compress
        $parsed = $json | ConvertFrom-Json

        # EXACT field-name set — no more, no less (a drift here = the silent parse-fail class).
        $names = @($parsed.PSObject.Properties.Name | Sort-Object)
        $names | Should -Be @('ErrorType', 'Goal', 'NextSteps', 'Problem')

        $parsed.ErrorType | Should -Be 'ContentPathMissing'
        $parsed.Goal      | Should -Be 'Convert pre-fetched source content for op-ed generation'
        $parsed.Problem   | Should -Match 'Content file not found'
        @($parsed.NextSteps).Count | Should -Be 2
    }
}
