# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# ValidateScript helper for -Category parameters.
# Accepts new BDI names, rejects old names with actionable migration guidance.
# Dot-sourced by AITriad.psm1 — do NOT export.

function Test-CategoryParameter {
    <#
    .SYNOPSIS
        Validates a -Category parameter value, rejecting legacy names with actionable guidance.
    .DESCRIPTION
        Accepts the new BDI category names (Beliefs, Desires, Intentions).
        If a legacy name is passed, throws an ActionableError directing the user
        to the new name. If an unknown value is passed, lists valid options.
    .PARAMETER Value
        The category value to validate.
    .EXAMPLE
        [ValidateScript({ Test-CategoryParameter $_ })]
        [string]$Category
    #>
    param([string]$Value)

    $Valid = @('Beliefs', 'Desires', 'Intentions')
    $Legacy = @{
        'Data/Facts'        = 'Beliefs'
        'Goals/Values'      = 'Desires'
        'Methods/Arguments' = 'Intentions'
    }

    if ($Value -in $Valid) { return $true }

    if ($Legacy.ContainsKey($Value)) {
        throw (New-ActionableError -Goal "validate -Category parameter" `
            -Problem "Category '$Value' was renamed in BDI migration" `
            -Location $MyInvocation.ScriptName `
            -NextSteps "Use -Category '$($Legacy[$Value])' instead" `
            -PassThru)
    }

    throw (New-ActionableError -Goal "validate -Category parameter" `
        -Problem "Invalid category '$Value'" `
        -Location $MyInvocation.ScriptName `
        -NextSteps "Valid values: $($Valid -join ', ')" `
        -PassThru)
}
