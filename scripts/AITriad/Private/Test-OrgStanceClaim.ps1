# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-OrgStanceClaim {
    <#
    .SYNOPSIS
        Post-parse boundary validator for a single extracted stance claim (t/1553#12).
    .DESCRIPTION
        The Stage 1 UsageID lost its responseSchema after Gemini's structured-output
        validator rejected it live (400 across all fallback backends). CL condition:
        the cmdlet must validate each claim itself since the schema no longer guards
        the boundary. Rules:

          - polarity in { asserts, opposes }
          - extraction_confidence a number in [0.0, 1.0]
          - canonical_proposition non-empty and ≤ 60 words (prompt says ≤30 words,
            60 is a lenient upper bound for the drop threshold — cutoffs below
            leave room for near-miss compressions that CL can still audit)
          - text non-empty

        Returns { Ok, Reason } — caller drops the claim and logs the Reason when
        Ok=$false.
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [object]$Claim
    )

    Set-StrictMode -Version Latest

    if ($null -eq $Claim) {
        return [PSCustomObject]@{ Ok = $false; Reason = 'null claim' }
    }
    if (-not $Claim.PSObject.Properties['polarity']) {
        return [PSCustomObject]@{ Ok = $false; Reason = 'missing polarity' }
    }
    $pol = [string]$Claim.polarity
    if ($pol -notin @('asserts', 'opposes')) {
        return [PSCustomObject]@{ Ok = $false; Reason = "polarity '$pol' not in {asserts, opposes}" }
    }

    if (-not $Claim.PSObject.Properties['extraction_confidence']) {
        return [PSCustomObject]@{ Ok = $false; Reason = 'missing extraction_confidence' }
    }
    $conf = 0.0
    try { $conf = [double]$Claim.extraction_confidence } catch {
        return [PSCustomObject]@{ Ok = $false; Reason = "extraction_confidence not numeric: '$($Claim.extraction_confidence)'" }
    }
    if ($conf -lt 0.0 -or $conf -gt 1.0) {
        return [PSCustomObject]@{ Ok = $false; Reason = "extraction_confidence $conf out of [0,1]" }
    }

    if (-not $Claim.PSObject.Properties['canonical_proposition']) {
        return [PSCustomObject]@{ Ok = $false; Reason = 'missing canonical_proposition' }
    }
    $prop = [string]$Claim.canonical_proposition
    if ([string]::IsNullOrWhiteSpace($prop)) {
        return [PSCustomObject]@{ Ok = $false; Reason = 'canonical_proposition empty' }
    }
    $wordCount = @($prop -split '\s+' | Where-Object { $_ }).Count
    if ($wordCount -gt 60) {
        return [PSCustomObject]@{ Ok = $false; Reason = "canonical_proposition too long: $wordCount words (> 60)" }
    }

    if (-not $Claim.PSObject.Properties['text']) {
        return [PSCustomObject]@{ Ok = $false; Reason = 'missing text' }
    }
    if ([string]::IsNullOrWhiteSpace([string]$Claim.text)) {
        return [PSCustomObject]@{ Ok = $false; Reason = 'text empty' }
    }

    [PSCustomObject]@{ Ok = $true; Reason = $null }
}
