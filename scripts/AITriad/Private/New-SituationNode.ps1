# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function New-SituationNode {
    <#
    .SYNOPSIS
        Mint a cross-cutting (sit-*) node and run the write-time BDI gate (t/2332),
        in one place, for every PowerShell situation creator (t/3887).
    .DESCRIPTION
        Builds the standard situation node skeleton (empty interpretations,
        linked_nodes, conflict_ids) and immediately calls
        Set-SituationBdiInterpretation to decompose it into per-POV BDI. t/3887:
        two creators (Invoke-ProposalApply, Set-TaxonomyHierarchy) each minted this
        skeleton independently, and one of them never called the gate -- a second
        creation site is how a gate call gets forgotten. There is now exactly one
        creation path; both creators call this helper.

        FAIL-CLOSED: does not catch the gate's failure. It propagates to the
        caller, which decides what "skip this one node" means in its own context
        (e.g. Invoke-ProposalApply returns Success=$false for the single proposal;
        Set-TaxonomyHierarchy warns and skips the single parent). Nothing is added
        to the taxonomy's in-memory node list on failure -- the caller must not
        catch and continue past this call without discarding the attempt.

        t/3887 (TL review condition 3): after the gate succeeds, the built node is
        re-validated against Test-SituationBdiDecomposition -- the compliance
        classifier (t/3018) that rejects non-empty-but-meaningless sentinel values
        ("N/A", "none", "tbd", "-"), which Set-SituationBdiInterpretation's own
        gate does not check (it only validates each POV block is present). A gate
        "success" that actually produced sentinel-filled interpretations still
        fails closed here.
    .PARAMETER Id
        The situation node's id (e.g. 'sit-025'). Caller resolves any ID collision
        BEFORE calling this helper -- the BDI gate call uses this id as context, so
        it must already be final.
    .PARAMETER Label
        The situation's label.
    .PARAMETER Description
        The situation's description. Optional; defaults to empty string.
    .OUTPUTS
        [PSCustomObject] the compliant situation node, BDI-decomposed. Throws (does
        not return) if the gate fails.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [string]$Id,

        [Parameter(Mandatory)]
        [string]$Label,

        [string]$Description = ''
    )

    Set-StrictMode -Version Latest

    $NewNode = [ordered]@{
        id              = $Id
        label           = $Label
        description     = $Description
        interpretations = [ordered]@{
            accelerationist = ''
            safetyist       = ''
            skeptic         = ''
        }
        linked_nodes    = @()
        conflict_ids    = @()
    }
    $NodeObj = [PSCustomObject]$NewNode

    # t/2332 gate, fail-closed -- throws on failure; propagates to the caller.
    Set-SituationBdiInterpretation -Node $NodeObj

    # t/3887 (TL review condition 3): the gate validates POV-block presence only.
    # Re-check the result with the compliance classifier itself, which also
    # rejects whole-value sentinels ("N/A", "none", "tbd", "-") -- a gate
    # "success" containing those is not actually decomposed.
    $Verdict = Test-SituationBdiDecomposition -Node $NodeObj
    if ($Verdict.Fail -gt 0) {
        New-ActionableError `
            -Goal "Decompose situation '$Id' into per-POV BDI interpretations at creation" `
            -Problem "The gate returned a result that fails the compliance classifier (sentinel or empty value in belief/desire/intention)." `
            -Location 'New-SituationNode' `
            -NextSteps @(
                'The situation proposal was skipped fail-closed so a non-compliant node is not committed (t/2332, t/3887).',
                "Re-run the proposal apply once the AI backend recovers, or run enrichment.situation-bdi-decomposition on '$Id' manually via Invoke-AIByUsage."
            ) `
            -Throw
    }

    return $NodeObj
}
