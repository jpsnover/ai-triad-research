# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Embeds many texts in ONE embed_taxonomy.py subprocess (model loads once),
# instead of spawning a cold process per text. Returns a hashtable mapping the
# original text -> [double[]] vector. Distinct texts only are sent; blanks are
# skipped. On any failure returns an empty hashtable so callers fall back.
#
# This is the single-process, model-stays-warm path the per-call `encode -`
# spawns lacked: N texts cost one ~6s model load + N×ms, not N×6s.
function Invoke-BatchEmbeddings {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Texts,
        [int]$MaxChars = 1000
    )

    Set-StrictMode -Version Latest
    $Result = @{}

    $Distinct = @($Texts | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    if ($Distinct.Count -eq 0) { return $Result }

    $EmbedScript = Join-Path (Join-Path $script:RepoRoot 'scripts') 'embed_taxonomy.py'
    if (-not (Test-Path $EmbedScript)) { $EmbedScript = Join-Path $script:ModuleRoot 'embed_taxonomy.py' }
    if (-not (Test-Path $EmbedScript)) { return $Result }
    if (Get-Command python -ErrorAction SilentlyContinue) { $PythonCmd = 'python' } else { $PythonCmd = 'python3' }

    # Build [{id, text}] payload; id is the index, mapped back to the full text.
    $Items   = [System.Collections.Generic.List[object]]::new()
    $IdToText = @{}
    for ($i = 0; $i -lt $Distinct.Count; $i++) {
        $Full = $Distinct[$i]
        if ($Full.Length -gt $MaxChars) { $Trunc = $Full.Substring(0, $MaxChars) } else { $Trunc = $Full }
        $Items.Add([ordered]@{ id = "$i"; text = $Trunc })
        $IdToText["$i"] = $Full
    }

    # ConvertTo-Json collapses a single-element array to a bare object; force an
    # array so embed_taxonomy.py batch-encode always receives a JSON list.
    $Payload = $Items | ConvertTo-Json -Depth 3 -Compress
    if ($Items.Count -eq 1) { $Payload = "[$Payload]" }

    $Sw = [System.Diagnostics.Stopwatch]::StartNew()
    $PrevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $Output = $Payload | & $PythonCmd $EmbedScript batch-encode 2>$null
    } finally {
        $ErrorActionPreference = $PrevEAP
    }
    $Sw.Stop()
    Add-StageTiming -Name 'embed.subprocess (batch)' -Milliseconds $Sw.Elapsed.TotalMilliseconds

    if ($LASTEXITCODE -ne 0 -or -not $Output) { return $Result }

    try { $Map = ($Output | ConvertFrom-Json) } catch { return $Result }
    foreach ($Prop in $Map.PSObject.Properties) {
        $OrigText = $IdToText[$Prop.Name]
        if ($OrigText) { $Result[$OrigText] = [double[]]@($Prop.Value) }
    }
    return $Result
}
