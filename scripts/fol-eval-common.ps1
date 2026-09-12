# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    FOL-on-debate eval — shared robust JSON extraction for the {results:[...]} contract (t/3354#29). PURE.
.DESCRIPTION
    The classify (§3) and coref (§6) stages both ask the model for {"results":[...]} JSON. A keyed run
    (CL, t/3354#29) showed gemini-3.5-flash-lite returns VALID JSON that is NOT wrapped in {results:[...]}
    on ~20/21 classify batches — a bare array, a differently-keyed object, or a markdown-fenced body — and
    the original strict parse (`$resp.Text | ConvertFrom-Json` then require `.results`) rejected all of them,
    starving the eval of assertoric clauses (290/305 unclassified).

    ConvertFrom-FolResultsJson is the tolerant extractor both stages now use: strip markdown fences, parse,
    fall back to the first balanced {...}/[...] substring, then accept the results rows whether they arrive
    as {results:[...]}, a bare [...] array, the first array-valued property of an object, or a single row
    object. Returns the rows array, or $null when nothing usable is present (caller logs a raw snippet —
    observability, so the NEXT contract drift is diagnosable, t/2379).

    This is dot-sourced by the runner before the classify/coref libraries; it is PURE (no AI, no I/O) and
    dot-source unit-tested.
.LINK
    fol-eval-classify.ps1
.LINK
    fol-eval-coref.ps1
#>

Set-StrictMode -Version Latest

function ConvertFrom-FolResultsJson {
    <#
    .SYNOPSIS
        Tolerantly extract the results[] rows from a model response for the {results:[...]} contract. Pure.
    .OUTPUTS
        [object[]] the results rows, or $null if none could be extracted.
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param([AllowNull()][AllowEmptyString()][string]$Text)
    Set-StrictMode -Version Latest

    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }

    # 1. Strip markdown code fences (```json … ``` or ``` … ```), then trim.
    $body = [string]$Text
    $body = $body -replace '(?s)^\s*```(?:json)?\s*', ''
    $body = $body -replace '(?s)\s*```\s*$', ''
    $body = $body.Trim()

    # 2. Parse; on failure, fall back to the first balanced-ish {...} or [...] substring.
    $parsed = $null
    try { $parsed = $body | ConvertFrom-Json -ErrorAction Stop } catch { $parsed = $null }
    if ($null -eq $parsed) {
        $match = [regex]::Match($body, '(?s)(\{.*\}|\[.*\])')
        if ($match.Success) {
            try { $parsed = $match.Value | ConvertFrom-Json -ErrorAction Stop } catch { $parsed = $null }
        }
    }
    if ($null -eq $parsed) { return $null }

    # 3. Tolerant results extraction (contract drift observed on gemini-flash-lite, t/3354#29).
    if ($parsed -is [System.Array]) { return @($parsed) }                       # bare [ {...}, ... ]
    if ($parsed.PSObject.Properties['results'] -and $null -ne $parsed.results) {
        return @($parsed.results)                                               # canonical { results: [...] }
    }
    foreach ($p in $parsed.PSObject.Properties) {                              # first array-valued property, e.g. { classifications: [...] }
        if ($p.Value -is [System.Array]) { return @($p.Value) }
    }
    if ($parsed.PSObject.Properties['id']) { return @($parsed) }               # a single result row object
    return $null
}
