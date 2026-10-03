# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Pure classifier for t/3865 (t/3819 child E) — outlet key-set parity.
.DESCRIPTION
    Given the SSOT's outlet key set + default, and each consumer's REALIZED key
    set + (optionally) default, asserts:
      - every consumer's key set equals the SSOT's key set (order-independent)
      - every consumer's reported default (if supplied) equals the SSOT's default

    Zero-population is ALWAYS a failure, never a pass (t/3819 Finding 2 / t/3865's
    explicit requirement). Two silent-zero precedents motivate this: t/3821's
    parity check reported 694 confident files while silently skipping every
    .tsx, and the model-literal lint went blocking with zero offenders while
    never scanning .json. A key-set gate that read zero outlets from any
    consumer must be loud, not green.

    Split into its own dot-sourceable file (mirrors BranchStrandVerdict.ps1,
    FlakeVerdict.ps1) so both GV arms are unit-testable on synthetic fixtures,
    without mutating any real consumer file to manufacture a red.

    Does NOT cover (by design, stated here so a reader doesn't have to infer it
    from absence): styleDefaults prose (single-sourced after t/3819 B/C/D, so
    there is nothing left to compare), behavior for an unknown outlet (lives in
    the validation layer — resolveOutletBand / t/3854's tests, not this data
    gate), or docs/ux/oped-studio.md prose (permanently uncoverable by any
    key-set gate).
#>

function Get-OutletKeySetVerdict {
    [CmdletBinding()]
    param(
        # AllowEmptyCollection: an empty SSOT is a real (if degenerate) caller
        # state this function must classify itself — see the empty-SSOT branch
        # below — rather than have PowerShell's binder reject it BEFORE this
        # function runs, which would surface as an opaque
        # ParameterBindingValidationException instead of the function's own
        # clear verdict object.
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$SsotKeys,
        [Parameter(Mandatory)][AllowEmptyString()][string]$SsotDefault,
        # name -> string[] of that consumer's REALIZED outlet keys
        [Parameter(Mandatory)][hashtable]$ConsumerKeySets,
        # name -> that consumer's REALIZED default outlet. Optional per-consumer:
        # omit a name here if that consumer doesn't materialize a default (e.g.
        # a consumer that only exposes a key set, no default-selection concept).
        [hashtable]$ConsumerDefaults = @{}
    )

    $ssotSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$SsotKeys)

    # The SSOT itself reading zero keys is a caller bug (malformed/empty JSON
    # reached here), not a consumer-parity question — fail loudly and distinctly.
    if ($ssotSet.Count -eq 0) {
        return [PSCustomObject]@{
            Passed      = $false
            Reason      = 'SSOT key set is empty — cannot assert parity against nothing.'
            SsotCount   = 0
            Consumers   = [ordered]@{}
            DefaultMismatches = @()
        }
    }

    $consumerResults = [ordered]@{}
    $allOk = $true

    foreach ($name in $ConsumerKeySets.Keys) {
        $consumerKeys = @($ConsumerKeySets[$name])
        $consumerSet  = [System.Collections.Generic.HashSet[string]]::new([string[]]$consumerKeys)

        # Zero-population from a consumer while the SSOT is non-empty is ALWAYS
        # a failure — this is the gate's own output-shape assertion (t/3865).
        $zeroRead = ($consumerSet.Count -eq 0)

        $missing = [System.Collections.Generic.List[string]]::new()
        foreach ($k in $ssotSet) { if (-not $consumerSet.Contains($k)) { $missing.Add($k) } }
        $extra = [System.Collections.Generic.List[string]]::new()
        foreach ($k in $consumerSet) { if (-not $ssotSet.Contains($k)) { $extra.Add($k) } }

        $ok = (-not $zeroRead) -and ($missing.Count -eq 0) -and ($extra.Count -eq 0)
        if (-not $ok) { $allOk = $false }

        $consumerResults[$name] = [PSCustomObject]@{
            Passed    = $ok
            ZeroRead  = $zeroRead
            Count     = $consumerSet.Count
            Missing   = @($missing)
            Extra     = @($extra)
        }
    }

    $defaultMismatches = [System.Collections.Generic.List[string]]::new()
    foreach ($name in $ConsumerDefaults.Keys) {
        $consumerDefault = [string]$ConsumerDefaults[$name]
        if ($consumerDefault -ne $SsotDefault) {
            $defaultMismatches.Add("$name reports default '$consumerDefault', SSOT default is '$SsotDefault'")
            $allOk = $false
        }
    }

    return [PSCustomObject]@{
        Passed            = $allOk
        Reason            = if ($allOk) { 'All consumer key sets match the SSOT; all reported defaults match.' } else { 'See Consumers / DefaultMismatches for detail.' }
        SsotCount         = $ssotSet.Count
        Consumers         = $consumerResults
        DefaultMismatches = @($defaultMismatches)
    }
}
