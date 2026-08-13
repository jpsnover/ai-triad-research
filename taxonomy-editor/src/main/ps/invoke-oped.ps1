#Requires -Version 7
# Shim for New-OpEd: reads params as JSON from stdin, emits stage/result JSON lines to stdout.
# Spawned by opedHandlers.ts as: pwsh -NoProfile -NonInteractive -File <this-script>
# Fixed argv (zero shell-injection surface) — see t/2575 design review (t/2575#2).
param()

$ErrorActionPreference = 'Stop'
$VerbosePreference = 'Continue'

# Read params from stdin (safe: no shell interpolation of user content)
$raw = [Console]::In.ReadToEnd()
$p = $raw | ConvertFrom-Json

# Locate AITriad module (4 levels up from ps/ → main/ → src/ → taxonomy-editor/ → repo root)
$repoRoot = $PSScriptRoot
for ($i = 0; $i -lt 4; $i++) { $repoRoot = Split-Path -Parent $repoRoot }
$modulePath = Join-Path $repoRoot 'scripts' 'AITriad' 'AITriad.psd1'
Import-Module $modulePath -Force -ErrorAction Stop

# Map Write-Verbose message prefixes (from New-OpEd source) to stage names
$stagePatterns = [ordered]@{
    'Fetching'  = 'fetching'
    'Grounding' = 'grounding'
    'Generat'   = 'generating'
    'Saving'    = 'finalizing'
    'Writing'   = 'finalizing'
}

# Splat only recognized New-OpEd params (no -ParamsFile; avoids cross-scope cmdlet change)
$splat = [ordered]@{ Topic = [string]$p.Topic; Pov = [string]$p.Pov }
foreach ($key in @('Outlet', 'NewsHook', 'Thesis', 'AuthorBio', 'Url', 'Model')) {
    if ($null -ne $p.PSObject.Properties[$key] -and $null -ne $p.$key) {
        $splat[$key] = [string]$p.$key
    }
}
if ($null -ne $p.PSObject.Properties['WordCount'] -and $null -ne $p.WordCount) {
    $splat['WordCount'] = [int]$p.WordCount
}
if ($null -ne $p.PSObject.Properties['IncludePitch'] -and $null -ne $p.IncludePitch) {
    $splat['IncludePitch'] = [bool]$p.IncludePitch
}

# Run New-OpEd, intercepting the verbose stream (4>&1) to emit stage events
$lastResult = $null
New-OpEd @splat 4>&1 | ForEach-Object {
    if ($_ -is [System.Management.Automation.VerboseRecord]) {
        $msg = $_.Message
        foreach ($pat in $stagePatterns.Keys) {
            if ($msg -match $pat) {
                $line = [ordered]@{ type = 'stage'; stage = $stagePatterns[$pat] } |
                    ConvertTo-Json -Compress
                [Console]::Out.WriteLine($line)
                [Console]::Out.Flush()
                break
            }
        }
    } else {
        $lastResult = $_
    }
}

$resultLine = [ordered]@{ type = 'result'; data = $lastResult } |
    ConvertTo-Json -Depth 10 -Compress
[Console]::Out.WriteLine($resultLine)
[Console]::Out.Flush()
