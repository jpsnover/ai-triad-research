# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-DirectionalAgreement {
    <#
    .SYNOPSIS
        Shared directional-agreement gate (t/2743, t/2744, t/2745). Given
        (claim proposition, other proposition) pairs, decides whether the claim
        ASSERTS the other proposition (agrees), asserts its NEGATION (opposes),
        is unrelated, or the direction is unresolved.
    .DESCRIPTION
        Embedding cosine cannot distinguish "asserts P" from "asserts not-P" —
        cos(P, ¬P) is high because the two share nearly all content words. Every
        similarity-only gate therefore false-greens a polarity inversion
        (stance-polarity-inversion-spec.md §9). This gate supplies the
        entailment/contradiction signal embeddings cannot, by consuming the NLI
        cross-encoder (cross-encoder/nli-deberta-v3-small) already wired into
        `embed_taxonomy.py nli-classify` — the same engine Find-SituationCandidates
        drives from PowerShell. No new engine, no separately-calibrated model.

        FAIL-SAFE CONTRACT (t/2744, load-bearing): absence or low-confidence of a
        directional signal MUST resolve to 'unresolved', NEVER 'agrees'. Callers
        treat 'unresolved'/'unrelated' as flag / neutral / drop and must never
        assert alignment on a non-'agrees' verdict. This is what closes the
        default-to-agreement fallbacks the spec calls out.
    .PARAMETER Pair
        One or more pairs to judge. Each item is a hashtable or PSCustomObject with:
          Id        - opaque caller key, echoed back on the result (optional)
          ClaimProp - the claim's proposition (mapped to NLI text_a / premise)
          NodeProp  - the node/other proposition (mapped to NLI text_b / hypothesis)
        An empty collection returns an empty result (no python invocation).
    .PARAMETER MinMargin
        Additional confidence floor applied to the NLI top-1 vs top-2 logit
        margin (reconstructed from the returned class logits). Default 0.0 —
        defer entirely to the engine's internal NLI_CONFIDENCE_MARGIN=1.0 gate,
        which already downgrades ambiguous pairs to 'neutral'. An agrees/opposes
        verdict whose margin < MinMargin is downgraded to 'unresolved'. Stipulated;
        wired to the τ value registered under t/2744 once TL-approved.
    .OUTPUTS
        One PSCustomObject per input pair (input order preserved):
          Id         - the caller key (or the positional index if none given)
          Direction  - 'agrees' | 'opposes' | 'unrelated' | 'unresolved'
          Confidence - reconstructed NLI margin (0.0 when unresolved-by-failure)
          Method     - 'nli' | 'none'
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
        [double]$MinMargin = 0.0
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    $results = [System.Collections.Generic.List[PSObject]]::new()
    $pairs = @($Pair)
    if ($pairs.Count -eq 0) { return $results }

    # Read a field from either a hashtable or a PSCustomObject, guarded for
    # StrictMode (missing property/key -> $null, never throw).
    $getField = {
        param($obj, [string]$name)
        if ($null -eq $obj) { return $null }
        if ($obj -is [System.Collections.IDictionary]) {
            if ($obj.Contains($name)) { return $obj[$name] } else { return $null }
        }
        $prop = $obj.PSObject.Properties[$name]
        if ($prop) { return $prop.Value } else { return $null }
    }

    # Preserve a positional index so outputs re-align even if the engine reorders
    # or drops rows. Caller Id (if any) rides alongside for the result.
    $ids = [System.Collections.Generic.List[object]]::new()
    $encodeInput = [System.Collections.Generic.List[PSObject]]::new()
    for ($i = 0; $i -lt $pairs.Count; $i++) {
        $p = $pairs[$i]
        $callerId = & $getField $p 'Id'
        if ($null -eq $callerId) { $callerId = $i }
        $ids.Add($callerId)
        $encodeInput.Add([PSCustomObject]@{
            idx    = $i
            text_a = [string](& $getField $p 'ClaimProp')
            text_b = [string](& $getField $p 'NodeProp')
        })
    }

    # A helper to emit an all-unresolved result set (the fail-safe path).
    $emitAllUnresolved = {
        for ($i = 0; $i -lt $ids.Count; $i++) {
            $results.Add([PSCustomObject]@{
                Id         = $ids[$i]
                Direction  = 'unresolved'
                Confidence = 0.0
                Method     = 'none'
            })
        }
        return $results
    }

    $repoRoot  = $script:RepoRoot
    $embScript = Join-Path $repoRoot 'scripts' 'embed_taxonomy.py'
    if (Get-Command python -ErrorAction SilentlyContinue) { $pythonCmd = 'python' } else { $pythonCmd = 'python3' }

    # ConvertTo-Json collapses a single-element collection to a bare object;
    # nli-classify requires a JSON array, so force the array framing.
    $stdin = ConvertTo-Json -InputObject @($encodeInput) -Compress -Depth 5
    if ($stdin -notmatch '^\s*\[') { $stdin = "[$stdin]" }

    $global:LASTEXITCODE = 0
    $raw = $null
    try {
        $raw = $stdin | & $pythonCmd $embScript nli-classify 2>$null
    } catch {
        Write-Verbose "Test-DirectionalAgreement: NLI invocation threw ($($_.Exception.Message)) — all pairs unresolved"
        return (& $emitAllUnresolved)
    }
    $exit = if (Test-Path variable:LASTEXITCODE) { $LASTEXITCODE } else { 0 }
    if ($exit -ne 0 -or -not $raw) {
        Write-Verbose "Test-DirectionalAgreement: NLI exit=$exit / empty output — all pairs unresolved"
        return (& $emitAllUnresolved)
    }

    try {
        $classified = $raw | Out-String | ConvertFrom-Json
    } catch {
        Write-Verbose "Test-DirectionalAgreement: could not parse NLI output — all pairs unresolved"
        return (& $emitAllUnresolved)
    }

    # Map idx -> classified item so we re-align by position, not by array order.
    $byIdx = @{}
    foreach ($item in @($classified)) {
        if ($item.PSObject.Properties['idx']) { $byIdx[[int]$item.idx] = $item }
    }

    for ($i = 0; $i -lt $pairs.Count; $i++) {
        $item = if ($byIdx.ContainsKey($i)) { $byIdx[$i] } else { $null }
        if ($null -eq $item -or -not $item.PSObject.Properties['nli_label']) {
            $results.Add([PSCustomObject]@{
                Id = $ids[$i]; Direction = 'unresolved'; Confidence = 0.0; Method = 'none'
            })
            continue
        }

        $label = [string]$item.nli_label
        # Reconstruct the top-1 vs top-2 margin from the three class logits the
        # engine exposes (it does not surface its own 'margin' field).
        $logits = @()
        foreach ($f in 'nli_entailment', 'nli_neutral', 'nli_contradiction') {
            if ($item.PSObject.Properties[$f]) { $logits += [double]$item.$f }
        }
        $margin = 0.0
        if (@($logits).Count -ge 2) {
            $sorted = @($logits | Sort-Object -Descending)
            $margin = $sorted[0] - $sorted[1]
        }

        $direction = switch ($label) {
            'entailment'    { 'agrees' }
            'contradiction' { 'opposes' }
            'neutral'       { 'unrelated' }
            default         { 'unresolved' }
        }

        # Extra caller-supplied confidence floor on top of the engine's own gate.
        if (($direction -eq 'agrees' -or $direction -eq 'opposes') -and $margin -lt $MinMargin) {
            $direction = 'unresolved'
        }

        $results.Add([PSCustomObject]@{
            Id         = $ids[$i]
            Direction  = $direction
            Confidence = [Math]::Round($margin, 4)
            Method     = 'nli'
        })
    }

    return $results
}
