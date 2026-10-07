#Requires -Version 7.0
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    The PowerShell emitter for lib/ai-config/codeReferencedModels.json (t/3553, SO e/271): every REGISTERED
    model id the PowerShell model-literal lint finds as a code literal.
.DESCRIPTION
    Called by the generator (`npm run gen:code-referenced-models`) through pwsh. It uses the lint's own scan
    (scripts/ModelLiteralScan.ps1) — no third extractor — so the generated list and the lint can never
    disagree. Both lint scopes feed the list by default (SO e/271#6 ruling (a)): tests/ -Model literals and
    production scripts/AITriad/ literals. Membership is registration only, whatever marker the literal
    carries (ruling (c)). Output order is not significant: the generator sorts and de-duplicates once.

    Dev-machine only: CI never runs the generator, it only asserts the committed list is a fresh superset.
.PARAMETER Scope
    All (default), Tests or Production.
.PARAMETER RepoRoot
    The code repository root. Defaults to this script's parent directory.
.PARAMETER Json
    Emit a JSON array on stdout — ALWAYS an array, even for zero or one id. This is how the generator
    calls it (`pwsh -NoProfile -NonInteractive -File scripts/Get-CodeReferencedModels.ps1 -Scope All -Json`),
    and it refuses non-array output. Without -Json the ids are written as strings, for PowerShell callers.
.OUTPUTS
    With -Json: a JSON array of model id strings. Without: [string] ids.
.EXAMPLE
    pwsh -NoProfile -NonInteractive -File scripts/Get-CodeReferencedModels.ps1 -Scope All -Json
#>
[CmdletBinding()]
param(
    [ValidateSet('All', 'Tests', 'Production')][string]$Scope = 'All',
    [string]$RepoRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'ModelLiteralScan.ps1')
$module = Import-Module (Join-Path $RepoRoot 'scripts' 'AITriad' 'AITriad.psm1') -Force -PassThru -WarningAction SilentlyContinue

# Registered set — the same list Test-AIModelId and the lint validate against (models[].id).
$validIds = @(& $module { $script:ValidModelIds })
if ($validIds.Count -eq 0) {
    # Infra failure, never an empty list: an empty pin set would let a refresh curate away code-named models.
    throw (& $module {
        New-ActionableError -PassThru `
            -Goal 'Emit the code-referenced model ids for lib/ai-config/codeReferencedModels.json' `
            -Problem 'ai-models.json unreadable/empty — the registered set is empty, so no literal can resolve' `
            -Location 'scripts/Get-CodeReferencedModels.ps1' `
            -NextSteps @('Confirm ai-models.json loads (Import-Module AITriad; InModuleScope AITriad { $script:ValidModelIds })', 'Re-run the generator once the registry is readable')
    })
}

$scopes = if ($Scope -eq 'All') { @('Tests', 'Production') } else { @($Scope) }
$literals = foreach ($s in $scopes) { script:Get-ModelLiteralScopeScan -RepoRoot $RepoRoot -Scope $s }
$ids = @(script:Get-CodeReferencedModelIds -Literals @($literals) -ValidIds $validIds)
# -InputObject (not the pipeline) keeps a one-element array an array: `@('x') | ConvertTo-Json` unrolls to "x".
if ($Json) { ConvertTo-Json -InputObject ([string[]]$ids) -Compress } else { $ids }
