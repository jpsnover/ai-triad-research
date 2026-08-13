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

$resultLine = [ordered]@{ type = 'result'; data = $prep } | ConvertTo-Json -Depth 10 -Compress
[Console]::Out.WriteLine($resultLine)
[Console]::Out.Flush()
