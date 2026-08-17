# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-DirectionalAgreement {
    <#
    .SYNOPSIS
        Thin PowerShell wrapper over the shared directional-agreement engine
        `scripts/nli_classify.py` (t/2751). Given (claim proposition, node/other
        proposition, pov) pairs, returns whether the claim OPPOSES the other
        proposition — the load-bearing verdict — or not.
    .DESCRIPTION
        Per the TL ruling (t/2744#3) the directional gate is ONE shared Python
        engine; PS and TS are thin subprocess wrappers. This function does NOT
        implement NLI, POV framing, thresholds, or label→direction mapping — all
        of that is single-sourced in the engine so the two runtimes can never
        drift. It only marshals pairs to the engine and returns its verdicts.

        ASYMMETRIC OPPOSITION DETECTOR (CL ruling t/2751#3): the NLI model reliably
        recovers *contradiction* but rates a genuine agreement `neutral`, not
        `entailment`, so `opposes` is the only actionable verdict. Callers
        demote/flip ONLY on `opposes`; `agrees` / `unrelated` / `unresolved` all
        mean "no opposition detected → keep your edge." The gate never confirms
        agreement. Recall depends on rich node text — pass the fullest label+Core
        (t/2744#7); a bare label can miss an inversion (engine RECALL BOUNDARY).

        FAIL-SAFE: any subprocess failure resolves every pair to `unresolved`
        (method `none`) — NEVER `opposes`. A missed inversion beats a false demote.
    .PARAMETER Pair
        One or more pairs. Each is a hashtable/PSCustomObject with:
          Id        - opaque caller key echoed on the result (optional)
          ClaimProp - the claim's proposition (engine text_a, before framing)
          NodeProp  - the node/other proposition (engine text_b, before framing)
          ClaimPov  - optional POV attribution for the claim side
          NodePov   - optional POV attribution for the node side
        An empty collection returns an empty result (no engine invocation).
    .PARAMETER TauContra
        Margin floor forwarded to the engine to emit `opposes`. Default 1.0
        (FINAL, CL t/2751#3; provenance registered in metric-provenance-register).
    .OUTPUTS
        One PSCustomObject per input pair (input order preserved):
          Id, Direction ('agrees'|'opposes'|'unrelated'|'unresolved'),
          Confidence (NLI margin), Method ('nli'|'none')
    .LINK
        Find-SituationCandidates
    #>
    [CmdletBinding()]
    [OutputType([System.Collections.Generic.List[PSObject]])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Pair,

        [Parameter()]
        [ValidateRange(0.0, 1000.0)]
        [double]$TauContra = 1.0
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $results = [System.Collections.Generic.List[PSObject]]::new()
    $pairs = @($Pair)
    if ($pairs.Count -eq 0) { return $results }

    # Read a field from a hashtable or PSCustomObject, StrictMode-safe.
    $getField = {
        param($obj, [string]$name)
        if ($null -eq $obj) { return $null }
        if ($obj -is [System.Collections.IDictionary]) {
            if ($obj.Contains($name)) { return $obj[$name] } else { return $null }
        }
        $prop = $obj.PSObject.Properties[$name]
        if ($prop) { return $prop.Value } else { return $null }
    }

    # Carry a positional index (as the engine 'id') so we re-align by position;
    # the caller's own Id rides alongside for the result.
    $ids = [System.Collections.Generic.List[object]]::new()
    $engineInput = [System.Collections.Generic.List[PSObject]]::new()
    for ($i = 0; $i -lt $pairs.Count; $i++) {
        $p = $pairs[$i]
        $callerId = & $getField $p 'Id'
        if ($null -eq $callerId) { $callerId = $i }
        $ids.Add($callerId)
        $engineInput.Add([PSCustomObject]@{
            id         = $i
            claim_prop = [string](& $getField $p 'ClaimProp')
            node_prop  = [string](& $getField $p 'NodeProp')
            claim_pov  = [string](& $getField $p 'ClaimPov')
            node_pov   = [string](& $getField $p 'NodePov')
        })
    }

    $emitAllUnresolved = {
        for ($i = 0; $i -lt $ids.Count; $i++) {
            $results.Add([PSCustomObject]@{
                Id = $ids[$i]; Direction = 'unresolved'; Confidence = 0.0; Method = 'none'
            })
        }
        return $results
    }

    $repoRoot  = $script:RepoRoot
    $engine    = Join-Path $repoRoot 'scripts' 'nli_classify.py'
    if (Get-Command python -ErrorAction SilentlyContinue) { $pythonCmd = 'python' } else { $pythonCmd = 'python3' }

    $stdin = ConvertTo-Json -InputObject @($engineInput) -Compress -Depth 5
    if ($stdin -notmatch '^\s*\[') { $stdin = "[$stdin]" }

    $global:LASTEXITCODE = 0
    $raw = $null
    try {
        $raw = $stdin | & $pythonCmd $engine --tau-contra $TauContra 2>$null
    } catch {
        Write-Verbose "Test-DirectionalAgreement: engine invocation threw ($($_.Exception.Message)) — all pairs unresolved"
        return (& $emitAllUnresolved)
    }
    $exit = if (Test-Path variable:LASTEXITCODE) { $LASTEXITCODE } else { 0 }
    if ($exit -ne 0 -or -not $raw) {
        Write-Verbose "Test-DirectionalAgreement: engine exit=$exit / empty output — all pairs unresolved"
        return (& $emitAllUnresolved)
    }

    try {
        $verdicts = $raw | Out-String | ConvertFrom-Json
    } catch {
        Write-Verbose "Test-DirectionalAgreement: could not parse engine output — all pairs unresolved"
        return (& $emitAllUnresolved)
    }

    # Re-align by the positional index we sent as 'id'.
    $byIdx = @{}
    foreach ($v in @($verdicts)) {
        if ($v.PSObject.Properties['id']) { $byIdx[[int]$v.id] = $v }
    }

    for ($i = 0; $i -lt $pairs.Count; $i++) {
        $v = if ($byIdx.ContainsKey($i)) { $byIdx[$i] } else { $null }
        if ($null -eq $v -or -not $v.PSObject.Properties['direction']) {
            $results.Add([PSCustomObject]@{
                Id = $ids[$i]; Direction = 'unresolved'; Confidence = 0.0; Method = 'none'
            })
            continue
        }
        $conf = if ($v.PSObject.Properties['confidence']) { [double]$v.confidence } else { 0.0 }
        $method = if ($v.PSObject.Properties['method']) { [string]$v.method } else { 'nli' }
        $results.Add([PSCustomObject]@{
            Id         = $ids[$i]
            Direction  = [string]$v.direction
            Confidence = [Math]::Round($conf, 4)
            Method     = $method
        })
    }

    return $results
}
