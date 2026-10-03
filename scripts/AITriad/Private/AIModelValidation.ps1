# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# ── Dynamic model validation and tab completion ──
# Reads from $script:ValidModelIds (loaded from ai-models.json in AITriad.psm1)

$script:AIModelCompleter = {
    param($commandName, $parameterName, $wordToComplete, $commandAst, $fakeBoundParameters)
    $script:ValidModelIds | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}

function Test-AIModelId {
    <#
    .SYNOPSIS
        Validates a model ID against ai-models.json. Used in [ValidateScript()] attributes.
    #>
    # t/3867: [CmdletBinding()] is required for -WarningVariable/-WarningAction to actually
    # bind to the Write-Warning below -- without it, a caller passing -WarningVariable gets
    # no error (looks like it worked) but silently captures nothing, since common parameters
    # are an advanced-function feature. Confirmed empirically: the warning printed to the
    # console but a test's -WarningVariable came back $null until this was added.
    [CmdletBinding()]
    param([string]$ModelId)

    if ($script:ValidModelIds.Count -eq 0) {
        # t/3867: fail OPEN (availability over correctness) is a deliberate trade --
        # a transient ai-models.json read failure shouldn't brick every model-taking
        # cmdlet. The bug was the SILENCE: Write-Warning (a real, capturable stream),
        # NOT Write-Warn (the Write-Host wrapper established non-capturable on
        # t/3853) -- using Write-Warn here would reproduce this ticket's own defect
        # while looking like the fix.
        Write-Warning "Test-AIModelId: ai-models.json did not load (0 models registered) at $AIModelsPath -- model ID validation is DISABLED; '$ModelId' and any other value will be accepted."
        return $true
    }
    if ($ModelId -in $script:ValidModelIds) {
        return $true
    }
    throw "Invalid model '$ModelId'. Valid models: $($script:ValidModelIds -join ', ')"
}
