# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Find-CrossCuttingCandidates {
    <#
    .SYNOPSIS
        DEPRECATED: Use Find-SituationCandidates instead.
    .DESCRIPTION
        Renamed in the Situations migration. This wrapper emits a deprecation
        warning and delegates to Find-SituationCandidates.
    #>
    [CmdletBinding()]
    param()

    Write-Warning (New-ActionableError -Goal 'run Find-CrossCuttingCandidates' `
        -Problem 'Find-CrossCuttingCandidates was renamed in the Situations migration' `
        -Location 'AITriad module' `
        -NextSteps 'Use Find-SituationCandidates instead' `
        -PassThru)

    Find-SituationCandidates @PSBoundParameters
}
