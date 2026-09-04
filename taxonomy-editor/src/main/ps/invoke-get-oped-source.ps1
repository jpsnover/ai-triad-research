#Requires -Version 7
# Stage-A shim: CONVERT pre-fetched source content + readability gate (t/3307). The URL FETCH moved to
# the shared SSRF-guarded Node fetcher (t/3306); this shim receives a temp-file PATH + content-type,
# never a URL, and never fetches. The CALLER owns the temp file (creates + deletes it).
#
# Reads JSON stdin:  { "ContentPath": "<path>", "ContentType": "<mime>", "SourceUrl": "<url?>" }
# Writes stdout (success): {"type":"result","data":{...SourcePrep fields; content b64 via _b64Fields}}
# Writes stderr (failure): {"ErrorType","Goal","Problem","NextSteps"}  then exits 1   (locked t/3306#4)
#
# Contract note: the emit field names here are asserted by the shared round-trip test
# tests/OpEdShimTransport.Tests.ps1 against the parse side (opedShimTransport.ts) — keep them in sync.
param()
$ErrorActionPreference = 'Stop'

try {
    $raw = [Console]::In.ReadToEnd()
    $p   = $raw | ConvertFrom-Json

    $repoRoot = $PSScriptRoot
    for ($i = 0; $i -lt 4; $i++) { $repoRoot = Split-Path -Parent $repoRoot }
    $modulePath = Join-Path $repoRoot 'scripts' 'AITriad' 'AITriad.psd1'
    Import-Module $modulePath -Force -ErrorAction Stop

    $sourceUrl = if ($p.PSObject.Properties['SourceUrl']) { [string]$p.SourceUrl } else { '' }
    $prep = Get-OpEdSource -ContentPath ([string]$p.ContentPath) `
        -ContentType ([string]$p.ContentType) -SourceUrl $sourceUrl

    # Base64-encode fetched arbitrary-web-content fields BEFORE ConvertTo-Json (t/2928 — PS emits
    # INVALID JSON for some real content: a bare unescaped `"` inside the value). The handler
    # base64-decodes anything listed in `_b64Fields`. ANY future $prep field carrying fetched /
    # arbitrary content MUST be added to this list. Backstop: parseShimLine surfaces a LOUD
    # ActionableError if a content field is ever missed, never a silent drop.
    $b64Fields = @()
    foreach ($f in @('SourceMarkdown', 'Excerpt')) {
        $val = $prep.$f
        if ($val -is [string] -and $val.Length -gt 0) {
            $prep.$f = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($val))
            $b64Fields += $f
        }
    }
    $prep | Add-Member -NotePropertyName '_b64Fields' -NotePropertyValue $b64Fields -Force

    $resultLine = [ordered]@{ type = 'result'; data = $prep } | ConvertTo-Json -Depth 10 -Compress
    [Console]::Out.WriteLine($resultLine)
    [Console]::Out.Flush()
}
catch {
    # Emit the LOCKED failure contract (t/3306#4): {ErrorType,Goal,Problem,NextSteps} JSON on stderr,
    # exit 1. Prefer the structured TargetObject from Get-OpEdSource's -AsErrorRecord (no message
    # parsing — parsing the rendered string is the silent parse-fail class). Fall back to a generic
    # classification for non-ActionableError failures (module import, malformed stdin).
    $to = $_.TargetObject
    if ($to -is [System.Collections.IDictionary] -and $to.Contains('ErrorType')) {
        $err = [ordered]@{
            ErrorType = [string]$to['ErrorType']
            Goal      = [string]$to['Goal']
            Problem   = [string]$to['Problem']
            # [string[]] forces a JSON array even for a single element (PS collapses 1-element arrays to
            # a scalar) — opedHandlers does Array.isArray(NextSteps).
            NextSteps = [string[]]@($to['NextSteps'])
        }
    } else {
        $err = [ordered]@{
            ErrorType = 'Unknown'
            Goal      = 'Convert pre-fetched source content for op-ed generation'
            Problem   = [string]$_.Exception.Message
            NextSteps = [string[]]@('Verify the stdin payload (ContentPath, ContentType) and that the AITriad module loads')
        }
    }
    [Console]::Error.WriteLine(($err | ConvertTo-Json -Depth 6 -Compress))
    [Console]::Error.Flush()
    exit 1
}
