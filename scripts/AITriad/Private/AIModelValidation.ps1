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
    param([string]$ModelId)

    if ($script:ValidModelIds.Count -eq 0) {
        # Config not loaded — accept anything rather than blocking
        return $true
    }
    if ($ModelId -in $script:ValidModelIds) {
        return $true
    }
    throw "Invalid model '$ModelId'. Valid models: $($script:ValidModelIds -join ', ')"
}
