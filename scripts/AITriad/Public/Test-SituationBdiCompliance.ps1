# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-SituationBdiCompliance {
    <#
    .SYNOPSIS
        Gate validator: assert situation nodes carry full per-POV BDI decomposition (t/3011).
    .DESCRIPTION
        Layer A of the INCIDENT-B prevention (t/3007 / t/3011). Situations can enter
        `ai-triad-data` through paths that never call a PowerShell cmdlet — a bulk raw
        `git commit` of "sync pipeline outputs" (78c943cf), the taxonomy-editor
        workflow-app, or ad-hoc session generation — so the cmdlet-side write guard
        (Set-SituationBdiInterpretation, t/2332) cannot catch them. The only choke
        point every path crosses is the commit into the data repo; this cmdlet is the
        validation core a data-boundary gate (Layer B, DevOps) invokes there.

        Reuses the pure classifier `Test-SituationBdiDecomposition` (t/2332): every
        non-deprecated situation must carry an interpretations block where
        {accelerationist, safetyist, skeptic} each hold a nested object with a
        non-empty belief + desire + intention. A situation whose description begins
        '[DEPRECATED]' is exempt (CL, t/1312#2).

        With -ChangedOnly the cmdlet validates only situation nodes that are new or
        modified relative to -BaseRef (default HEAD), computed by diffing the parsed
        situations.json at that ref against the on-disk file. This keeps the gate fast
        and scoped to new regressions rather than pre-existing corpus state (TL
        condition t/3011#2). If the baseline ref cannot be resolved (shallow checkout,
        all-zero first-push SHA, not a git tree) the cmdlet FAILS SAFE and validates
        the full corpus, emitting a warning.

        Exit-code semantics: the cmdlet always returns a result object. With
        -FailOnViolation it additionally throws a New-ActionableError on any violation
        so a `pwsh -Command '... -FailOnViolation'` gate step exits non-zero. Omit the
        switch for the warn-first (non-blocking) promotion phase.
    .PARAMETER SituationsPath
        Path to situations.json. Defaults to `<Get-TaxonomyDir>/situations.json`
        (honors $env:AI_TRIAD_DATA_ROOT).
    .PARAMETER ChangedOnly
        Validate only situation nodes new-or-modified vs -BaseRef, instead of the
        whole corpus.
    .PARAMETER BaseRef
        Baseline git ref for -ChangedOnly (default 'HEAD'). In push CI, pass the
        previous tip (e.g. the push event's before-SHA, or HEAD~1).
    .PARAMETER FailOnViolation
        Throw a New-ActionableError (non-zero exit) if any validated situation fails.
    .OUTPUTS
        [pscustomobject] with Pass, Scope ('Changed'|'Full'), Checked, NonDeprecated,
        Fail, NonDecomposedIds, EmptyIds, ViolationIds, Detail.
    .EXAMPLE
        Test-SituationBdiCompliance
        # Full-corpus check against the resolved data root; returns a result object.
    .EXAMPLE
        Test-SituationBdiCompliance -ChangedOnly -BaseRef HEAD~1 -FailOnViolation
        # Blocking data-boundary gate: throws if a newly-added situation is not decomposed.
    .LINK
        Show-AITriadHelp
    .LINK
        Test-OntologyCompliance
    .LINK
        Set-SituationBdiInterpretation
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter()]
        [string]$SituationsPath,

        [switch]$ChangedOnly,

        [Parameter()]
        [string]$BaseRef = 'HEAD',

        [switch]$FailOnViolation
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    if (-not $SituationsPath) {
        $SituationsPath = Join-Path (Get-TaxonomyDir) 'situations.json'
    }
    if (-not (Test-Path -LiteralPath $SituationsPath)) {
        New-ActionableError `
            -Goal 'Validate situation per-POV BDI decomposition' `
            -Problem "situations.json not found: $SituationsPath" `
            -Location 'Test-SituationBdiCompliance' `
            -NextSteps @(
                'Pass -SituationsPath explicitly, or set $env:AI_TRIAD_DATA_ROOT to the ai-triad-data checkout.',
                'Confirm the data repo is checked out at the expected path.'
            ) `
            -Throw
    }

    $TaxData = Get-Content -Raw -LiteralPath $SituationsPath | ConvertFrom-Json
    if (-not $TaxData.PSObject.Properties['nodes']) {
        New-ActionableError `
            -Goal 'Validate situation per-POV BDI decomposition' `
            -Problem "situations.json has no 'nodes' array: $SituationsPath" `
            -Location 'Test-SituationBdiCompliance' `
            -NextSteps @('Confirm the file is a taxonomy situations file (expects a top-level `nodes` array).') `
            -Throw
    }
    $AllNodes = @($TaxData.nodes)

    $Scope        = 'Full'
    $NodesToCheck = $AllNodes

    if ($ChangedOnly) {
        $ChangedIds = Get-ChangedSituationId -SituationsPath $SituationsPath -BaseRef $BaseRef -CurrentNodes $AllNodes
        if ($null -eq $ChangedIds) {
            Write-Warning "Test-SituationBdiCompliance: could not resolve baseline '$BaseRef' for $SituationsPath — validating the full corpus (fail-safe). Ensure the git history has depth >= 2 (e.g. actions/checkout fetch-depth: 2)."
        }
        else {
            $Scope   = 'Changed'
            $IdSet   = [System.Collections.Generic.HashSet[string]]::new([string[]]@($ChangedIds))
            $NodesToCheck = @($AllNodes | Where-Object {
                $_.PSObject.Properties['id'] -and $IdSet.Contains([string]$_.id)
            })
        }
    }

    $R = Test-SituationBdiDecomposition -Node $NodesToCheck

    $ViolationIds = @(@($R.NonDecomposedIds) + @($R.EmptyIds))
    $Pass = ($R.Fail -eq 0)

    if ($Pass) {
        $Detail = "$($R.Pass) / $($R.NonDeprecated) $Scope-scope non-deprecated situation(s) carry full per-POV BDI decomposition ($($R.Deprecated) exempt via [DEPRECATED] prefix)."
    }
    else {
        $Detail = "$($R.Fail) $Scope-scope situation(s) fail per-POV BDI decomposition — $($R.NonDecomposed) non-decomposed, $($R.Empty) missing the interpretations block: $($ViolationIds -join ', '). Each of accelerationist/safetyist/skeptic must carry a non-empty belief + desire + intention."
    }

    $Result = [pscustomobject][ordered]@{
        Pass             = $Pass
        Scope            = $Scope
        Checked          = @($NodesToCheck).Count
        NonDeprecated    = $R.NonDeprecated
        Fail             = $R.Fail
        NonDecomposedIds = @($R.NonDecomposedIds)
        EmptyIds         = @($R.EmptyIds)
        ViolationIds     = $ViolationIds
        Detail           = $Detail
    }

    if ($FailOnViolation -and -not $Pass) {
        New-ActionableError `
            -Goal 'Block a data-repo change that introduces a non-decomposed situation' `
            -Problem $Detail `
            -Location 'Test-SituationBdiCompliance' `
            -NextSteps @(
                "Decompose the flagged situation(s) into per-POV BDI before pushing: run enrichment.situation-bdi-decomposition via Invoke-AIByUsage, or Set-SituationBdiInterpretation, for each id.",
                "Flagged ids: $($ViolationIds -join ', ')",
                'Re-run Test-SituationBdiCompliance -ChangedOnly to confirm clean before committing.'
            ) `
            -Throw
    }

    return $Result
}
