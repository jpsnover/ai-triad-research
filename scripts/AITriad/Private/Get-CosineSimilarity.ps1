# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Shared cosine-similarity helper (t/1806). Extracted so Invoke-EntityExtraction
# and Get-EntityReport share ONE implementation instead of forking the inline
# copy in Get-FilteredCandidates.ps1 (that pre-existing copy is a separate
# migration chore, not touched here — see t/1806 brief).
# Dot-sourced by AITriad.psm1 — do NOT export.

function Get-CosineSimilarity {
    <#
    .SYNOPSIS
        Cosine similarity between two equal-length numeric vectors.
    .DESCRIPTION
        Mirrors the inline cosine in Get-FilteredCandidates.ps1 exactly (same
        math, same zero-norm guard) so callers get identical results regardless
        of which caller path they took.
    .PARAMETER A
        First vector.
    .PARAMETER B
        Second vector. Must be the same length as -A.
    .OUTPUTS
        [double] — cosine similarity in [-1, 1]. Returns 0.0 if either vector
        has zero magnitude (undefined cosine, not an error).
    .EXAMPLE
        Get-CosineSimilarity -A @(1.0, 0.0) -B @(0.0, 1.0)
        # 0.0 — orthogonal vectors
    #>
    [CmdletBinding()]
    [OutputType([double])]
    param(
        [Parameter(Mandatory)]
        [double[]]$A,

        [Parameter(Mandatory)]
        [double[]]$B
    )

    $Dot = 0.0; $NormA = 0.0; $NormB = 0.0
    for ($i = 0; $i -lt $A.Length; $i++) {
        $Dot   += $A[$i] * $B[$i]
        $NormA += $A[$i] * $A[$i]
        $NormB += $B[$i] * $B[$i]
    }
    $Denom = [Math]::Sqrt($NormA) * [Math]::Sqrt($NormB)
    if ($Denom -eq 0) { return 0.0 }
    return $Dot / $Denom
}
