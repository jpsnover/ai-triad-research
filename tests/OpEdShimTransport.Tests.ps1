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
