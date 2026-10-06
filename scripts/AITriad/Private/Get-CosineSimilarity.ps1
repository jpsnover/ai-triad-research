# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Get-CosineSimilarity {
    <#
    .SYNOPSIS
        Cosine similarity of two equal-length double vectors (t/3910 extraction of the
        nested Get-CosineSim from Get-TaxonomyHealthData -- same name collision risk means
        this promotion makes it a real, independently testable function). Returns 0 when
        either norm is 0.
    .OUTPUTS
        [double]
    #>
    [CmdletBinding()]
    [OutputType([double])]
    param(
        [Parameter(Mandatory)][double[]]$A,
        [Parameter(Mandatory)][double[]]$B
    )

    Set-StrictMode -Version Latest

    $dot = 0.0; $na = 0.0; $nb = 0.0
    for ($k = 0; $k -lt $A.Length; $k++) {
        $dot += $A[$k] * $B[$k]
        $na  += $A[$k] * $A[$k]
        $nb  += $B[$k] * $B[$k]
    }
    $denom = [Math]::Sqrt($na) * [Math]::Sqrt($nb)
    if ($denom -eq 0) { return 0 }
    return $dot / $denom
}
