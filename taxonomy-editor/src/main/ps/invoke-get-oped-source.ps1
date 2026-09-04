#Requires -Version 7
# Stage-A shim: CONVERT-ONLY (t/3306/t/3307). The bytes are fetched by Node (fetchUrlForPromptBinary,
# bypassing the PS/WAF fingerprint 403) and written to a temp file; this shim converts + readability-
# gates that pre-fetched file. Called once per create-oped-set; SourcePrep threads into each voice spawn.
#
# Reads JSON stdin: { "ContentPath": "<temp-file>", "ContentType": "<mime>", "SourceUrl": "<url?>" }
#   (ContentType is authoritative for dispatch; the temp-file extension is advisory. SourceUrl optional.)
# stdout success (unchanged transport, t/2928):
#   {"type":"result","data":{...SourcePrep..., SourceMarkdown/Excerpt base64-encoded, "_b64Fields":[...]}}
# stderr failure: a single JSON line { "ErrorType","Goal","Problem","NextSteps" } as the LAST stderr
#   line, then exit 1 — so opedHandlers threads the real cause instead of a generic exit-code-1 (t/3306).
#
# File owned by ElectronMain (taxonomy-editor/src/main/ps); the PS serialization block is authored by
# PowerShell for contract coherence (it serializes a PS ActionableError + the t/2928 base64), and the
# EXACT field names on both sides are guarded by the shared round-trip test OpEdShimTransport.Tests.ps1.
param()
$ErrorActionPreference = 'Stop'

try {
    $raw = [Console]::In.ReadToEnd()
    $p   = $raw | ConvertFrom-Json

    $repoRoot = $PSScriptRoot
    for ($i = 0; $i -lt 4; $i++) { $repoRoot = Split-Path -Parent $repoRoot }
    $modulePath = Join-Path $repoRoot 'scripts' 'AITriad' 'AITriad.psd1'
    Import-Module $modulePath -Force -ErrorAction Stop

    # Contract: { ContentPath, ContentType, SourceUrl? }. SourceUrl is optional/informational —
    # the handler does not send it today, so guard its access under Set-StrictMode.
    $sourceUrl = if ($p.PSObject.Properties['SourceUrl']) { [string]$p.SourceUrl } else { '' }
    $prep = Get-OpEdSource -ContentPath ([string]$p.ContentPath) -ContentType ([string]$p.ContentType) -SourceUrl $sourceUrl

    # Base64-encode the fetched arbitrary-web-content fields BEFORE ConvertTo-Json, so it only ever
    # serializes safe ASCII for them. PS ConvertTo-Json emits INVALID JSON for some real article HTML
    # (a bare unescaped `"` inside the value), which the handler then can't parse (t/2928). The handler
    # base64-decodes anything listed in `_b64Fields`.
    #
    # ANY future $prep field carrying fetched / arbitrary web content MUST be added to this list.
    # (Today only SourceMarkdown + Excerpt are content; SourceBrief is $null here — the New-OpEd
    # comprehension pass fills it downstream, not this shim.) Backstop if one is ever missed:
    # opedHandlers surfaces a LOUD ActionableError (parseShimLine), never a silent drop — so the worst
    # case is a diagnosable failure, not a recurrence of this once-invisible bug.
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
    # Serialize the structured failure as the LAST stderr line, then exit 1. Get-OpEdSource attaches a
    # { ErrorType, Goal, Problem, NextSteps } payload to the ErrorRecord's TargetObject; any other
    # failure (bad stdin, module import) is synthesized so the handler still gets structure, never a
    # bare exit code. Writing our JSON last + exit (not re-throw) keeps PS's own error rendering from
    # trailing after it — the handler reads the final stderr line.
    $err = $_
    $payload = $err.TargetObject
    if ($null -ne $payload -and
        ($payload.PSObject.Properties.Name -contains 'ErrorType') -and
        ($payload.PSObject.Properties.Name -contains 'Problem')) {
        $out = [ordered]@{
            ErrorType = [string]$payload.ErrorType
            Goal      = [string]$payload.Goal
            Problem   = [string]$payload.Problem
            NextSteps = [string[]]@($payload.NextSteps)
        }
    } else {
        $out = [ordered]@{
            ErrorType = 'ConvertShimFailure'
            Goal      = 'Convert op-ed source'
            Problem   = [string]$err.Exception.Message
            NextSteps = [string[]]@(
                'Check the Get-OpEdSource stderr output',
                'Confirm the ContentPath temp file exists and the ContentType is a PDF, DOCX, or HTML/text type'
            )
        }
    }
    [Console]::Error.WriteLine(($out | ConvertTo-Json -Depth 5 -Compress))
    [Console]::Error.Flush()
    exit 1
}
