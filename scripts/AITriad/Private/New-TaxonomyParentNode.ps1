# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function New-TaxonomyParentNode {
    <#
    .SYNOPSIS
        Mint a new hierarchy parent node, either cross-cutting (situation,
        BDI-gated) or a regular POV node (t/3887).
    .DESCRIPTION
        Set-TaxonomyHierarchy's single decision point for "which kind of parent
        am I minting" -- factored out so the BDI gate's try/catch (t/2332, t/3887)
        doesn't add a second decision point to that function's own complexity
        (the complexity-ratchet, t/3829, never allows a baselined file's number
        to rise). FAIL-SOFT at this boundary: unlike New-SituationNode itself
        (which is fail-closed and throws), this helper catches that failure,
        warns, and returns $null so the caller can skip the single parent with a
        plain null-check instead of its own try/catch.
    .PARAMETER IsCrossCutting
        Whether this parent belongs to the situations (cross-cutting) layer.
    .PARAMETER Id
        The parent's final id (collision already resolved by the caller).
    .PARAMETER Label
        The parent's label.
    .PARAMETER Description
        The parent's description.
    .PARAMETER Category
        The parent's category (ignored when IsCrossCutting).
    .OUTPUTS
        [PSCustomObject] the minted node, or $null if the BDI gate rejected it
        (a warning has already been written in that case).
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [bool]$IsCrossCutting,

        [Parameter(Mandatory)]
        [string]$Id,

        [Parameter(Mandatory)]
        [string]$Label,

        [string]$Description = '',

        [string]$Category
    )

    Set-StrictMode -Version Latest

    if ($IsCrossCutting) {
        try {
            return New-SituationNode -Id $Id -Label $Label -Description $Description
        }
        catch {
            Write-Warn "Situation '$Id' BDI decomposition failed: $($_.Exception.Message) — skipping"
            return $null
        }
    }

    return [PSCustomObject][ordered]@{
        id                 = $Id
        category           = $Category
        label              = $Label
        description        = $Description
        parent_id          = $null
        children           = @()
        situation_refs = @()
    }
}
