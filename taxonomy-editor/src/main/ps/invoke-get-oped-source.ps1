#Requires -Version 7
# Stage-A shim: fetch + convert + readability gate for one URL.
# Called once per create-oped-set; SourcePrep is threaded into each voice spawn.
# Reads JSON stdin: { "Url": "<url>" }
# Writes JSON lines to stdout:
#   {"type":"result","data":{...SourcePrep fields...}}
# Throws (exit 1) if Get-OpEdSource's readability gate trips or any error occurs.
param()
$ErrorActionPreference = 'Stop'

$raw = [Console]::In.ReadToEnd()
$p   = $raw | ConvertFrom-Json

$repoRoot = $PSScriptRoot
for ($i = 0; $i -lt 4; $i++) { $repoRoot = Split-Path -Parent $repoRoot }
$modulePath = Join-Path $repoRoot 'scripts' 'AITriad' 'AITriad.psd1'
Import-Module $modulePath -Force -ErrorAction Stop

$prep = Get-OpEdSource -Url ([string]$p.Url)

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
