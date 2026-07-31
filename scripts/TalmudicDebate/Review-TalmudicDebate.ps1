# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Reviews a Talmudic debate log for activation, diagnostics, follow-through, and integrity issues.
.DESCRIPTION
    Reads a debate JSON artifact and produces a repeatable behavioral review. By default,
    the newest *-debate.json file under ./debates is used. Use -AsJson for automation.
.EXAMPLE
    ./scripts/TalmudicDebate/Review-TalmudicDebate.ps1
.EXAMPLE
    ./scripts/TalmudicDebate/Review-TalmudicDebate.ps1 -Path ./debates/my-debate.json -AsJson
#>

[CmdletBinding()]
param(
    [string]$Path,

    [string]$BaselinePath,

    [switch]$AsJson,

    [switch]$IncludeRawModeratorResponse
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithReviewError {
    param(
        [Parameter(Mandatory)] [string]$Goal,
        [Parameter(Mandatory)] [string]$Problem,
        [Parameter(Mandatory)] [string]$Location,
        [Parameter(Mandatory)] [string[]]$NextSteps
    )

    [Console]::Error.WriteLine('')
    [Console]::Error.WriteLine("  Goal:     $Goal")
    [Console]::Error.WriteLine("  Error:    $Problem")
    [Console]::Error.WriteLine("  Location: $Location")
    [Console]::Error.WriteLine('  Resolve:')
    for ($index = 0; $index -lt $NextSteps.Count; $index++) {
        [Console]::Error.WriteLine("  $($index + 1). $($NextSteps[$index])")
    }
    exit 1
}

function Get-JsonPropertyValue {
    param(
        [AllowNull()] [object]$InputObject,
        [Parameter(Mandatory)] [string]$Name,
        [AllowNull()] [object]$Default = $null
    )

    if ($null -eq $InputObject) {
        return $Default
    }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $Default
    }
    return $property.Value
}

function Get-JsonArray {
    param(
        [AllowNull()] [object]$InputObject,
        [Parameter(Mandatory)] [string]$Name
    )

    $value = Get-JsonPropertyValue -InputObject $InputObject -Name $Name
    if ($null -eq $value) {
        return @()
    }
    return @($value)
}

function ConvertTo-NormalizedDisagreementType {
    param([AllowNull()] [object]$Value)

    $text = [string]$Value
    switch ($text.Trim().ToLowerInvariant()) {
        'values' { return 'normative' }
        'value' { return 'normative' }
        default { return $text.Trim().ToLowerInvariant() }
    }
}

function Get-DiagnosticCompleteness {
    param([Parameter(Mandatory)] [object]$Diagnostic)

    $fieldNames = @(
        'focused_crux',
        'disagreement_type',
        'premise_under_examination',
        'distinction_or_analogy_tested',
        'unresolved_outcome'
    )
    $populated = 0
    foreach ($fieldName in $fieldNames) {
        $value = Get-JsonPropertyValue -InputObject $Diagnostic -Name $fieldName
        if (-not [string]::IsNullOrWhiteSpace([string]$value)) {
            $populated++
        }
    }
    return [math]::Round(($populated / $fieldNames.Count) * 100, 0)
}

function Find-TranscriptIndex {
    param(
        [Parameter(Mandatory)] [object[]]$Transcript,
        [Parameter(Mandatory)] [string]$EntryId
    )

    for ($index = 0; $index -lt $Transcript.Count; $index++) {
        if ((Get-JsonPropertyValue -InputObject $Transcript[$index] -Name 'id') -eq $EntryId) {
            return $index
        }
    }
    return -1
}

function Find-FollowingStatement {
    param(
        [Parameter(Mandatory)] [object[]]$Transcript,
        [Parameter(Mandatory)] [int]$StartIndex
    )

    for ($index = $StartIndex + 1; $index -lt $Transcript.Count; $index++) {
        if ((Get-JsonPropertyValue -InputObject $Transcript[$index] -Name 'type') -eq 'statement') {
            return $Transcript[$index]
        }
    }
    return $null
}

function Get-FactChecksForStatement {
    param(
        [Parameter(Mandatory)] [object[]]$Transcript,
        [Parameter(Mandatory)] [int]$StatementIndex
    )

    $results = [System.Collections.Generic.List[object]]::new()
    for ($index = $StatementIndex + 1; $index -lt $Transcript.Count; $index++) {
        $entryType = Get-JsonPropertyValue -InputObject $Transcript[$index] -Name 'type'
        if ($entryType -eq 'statement') {
            break
        }
        if ($entryType -eq 'fact-check') {
            $results.Add($Transcript[$index])
        }
    }
    return @($results)
}

function Get-TalmudicCardChecksum {
    param([Parameter(Mandatory)] [object]$Card)

    $source = Get-JsonPropertyValue -InputObject $Card -Name 'source'
    $translation = Get-JsonPropertyValue -InputObject $Card -Name 'translation'
    $content = "{0}`n{1}`n{2}`n{3}" -f @(
        [string](Get-JsonPropertyValue -InputObject $Card -Name 'id'),
        [string](Get-JsonPropertyValue -InputObject $Card -Name 'ref'),
        [string](Get-JsonPropertyValue -InputObject $source -Name 'text'),
        [string](Get-JsonPropertyValue -InputObject $translation -Name 'text')
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
    return [System.Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

function Write-SectionHeading {
    param([Parameter(Mandatory)] [string]$Text)

    Write-Host ''
    Write-Host $Text -ForegroundColor Cyan
    Write-Host ('-' * $Text.Length) -ForegroundColor DarkCyan
}

$repoRoot = [System.IO.Path]::GetFullPath((Split-Path (Split-Path $PSScriptRoot -Parent) -Parent))
$debatesRoot = Join-Path $repoRoot 'debates'
if ([string]::IsNullOrWhiteSpace($Path)) {
    $candidateFiles = @(Get-ChildItem -LiteralPath $debatesRoot -Filter '*-debate.json' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending)
    if ($candidateFiles.Count -eq 0) {
        Stop-WithReviewError `
            -Goal 'Review a Talmudic debate' `
            -Problem "No *-debate.json files were found under '$debatesRoot'" `
            -Location 'Review-TalmudicDebate.ps1 input discovery' `
            -NextSteps @('Run ./scripts/TalmudicDebate/Run-TalmudicDebate.ps1 first', 'Pass -Path with an existing debate JSON artifact')
    }
    $resolvedPath = $candidateFiles[0].FullName
}
else {
    $resolvedPath = if ([System.IO.Path]::IsPathRooted($Path)) {
        [System.IO.Path]::GetFullPath($Path)
    }
    else {
        [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
    }
}

if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
    Stop-WithReviewError `
        -Goal 'Load the debate log' `
        -Problem "Debate file '$resolvedPath' does not exist" `
        -Location 'Review-TalmudicDebate.ps1 input validation' `
        -NextSteps @('Pass -Path with an existing *-debate.json file', 'Run ./scripts/TalmudicDebate/Run-TalmudicDebate.ps1 to generate a log')
}

try {
    $debate = Get-Content -Raw -LiteralPath $resolvedPath | ConvertFrom-Json
}
catch {
    Stop-WithReviewError `
        -Goal 'Parse the debate log' `
        -Problem $_.Exception.Message `
        -Location $resolvedPath `
        -NextSteps @('Confirm the file contains valid JSON', 'Regenerate the debate artifact if it is truncated')
}

$transcript = @(Get-JsonArray -InputObject $debate -Name 'transcript')
$diagnostics = @(Get-JsonArray -InputObject $debate -Name 'dialectical_diagnostics')
$mode = [string](Get-JsonPropertyValue -InputObject $debate -Name 'moderator_mode' -Default 'standard')
$argumentNetwork = Get-JsonPropertyValue -InputObject $debate -Name 'argument_network'
$argumentNodes = @(Get-JsonArray -InputObject $argumentNetwork -Name 'nodes')
$diagnosticsRoot = Get-JsonPropertyValue -InputObject $debate -Name 'diagnostics'
$diagnosticEntries = Get-JsonPropertyValue -InputObject $diagnosticsRoot -Name 'entries'
$turnValidations = Get-JsonPropertyValue -InputObject $debate -Name 'turn_validations'

$issues = [System.Collections.Generic.List[object]]::new()
$reviews = [System.Collections.Generic.List[object]]::new()

$duplicateGroups = @($argumentNodes | Group-Object { Get-JsonPropertyValue -InputObject $_ -Name 'id' } |
    Where-Object { $_.Count -gt 1 })
foreach ($group in $duplicateGroups) {
    $claims = @($group.Group | ForEach-Object {
        [pscustomobject]@{
            Speaker = Get-JsonPropertyValue -InputObject $_ -Name 'speaker'
            Text = Get-JsonPropertyValue -InputObject $_ -Name 'text'
        }
    })
    $issues.Add([pscustomobject]@{
        Severity = 'HIGH'
        Code = 'duplicate_claim_id'
        Message = "Claim ID '$($group.Name)' identifies $($group.Count) different argument-network nodes. Moderator references to this ID are ambiguous."
        Evidence = $claims
    })
}

foreach ($diagnostic in $diagnostics) {
    $moderatorEntryId = [string](Get-JsonPropertyValue -InputObject $diagnostic -Name 'moderator_entry_id')
    $moderatorIndex = Find-TranscriptIndex -Transcript $transcript -EntryId $moderatorEntryId
    $moderatorEntry = if ($moderatorIndex -ge 0) { $transcript[$moderatorIndex] } else { $null }
    $followingStatement = if ($moderatorIndex -ge 0) {
        Find-FollowingStatement -Transcript $transcript -StartIndex $moderatorIndex
    }
    else {
        $null
    }

    $moderatorMetadata = Get-JsonPropertyValue -InputObject $moderatorEntry -Name 'metadata'
    $moderatorTrace = Get-JsonPropertyValue -InputObject $moderatorMetadata -Name 'moderator_trace'
    $referenceSelection = Get-JsonPropertyValue -InputObject $diagnostic -Name 'reference_selection'
    $selectedCard = Get-JsonPropertyValue -InputObject $referenceSelection -Name 'selected_card'
    $referenceCandidates = @(Get-JsonArray -InputObject $referenceSelection -Name 'candidates')
    $responseMetadata = Get-JsonPropertyValue -InputObject $followingStatement -Name 'metadata'
    $referenceResponse = Get-JsonPropertyValue -InputObject $responseMetadata -Name 'talmudic_reference_response'
    if ($null -eq $referenceResponse) {
        $referenceResponse = Get-JsonPropertyValue -InputObject $referenceSelection -Name 'response'
    }
    $responseId = [string](Get-JsonPropertyValue -InputObject $followingStatement -Name 'id')
    $responseIndex = if (-not [string]::IsNullOrWhiteSpace($responseId)) {
        Find-TranscriptIndex -Transcript $transcript -EntryId $responseId
    }
    else {
        -1
    }
    $responseValidationProperty = if ($null -ne $turnValidations -and -not [string]::IsNullOrWhiteSpace($responseId)) {
        $turnValidations.PSObject.Properties[$responseId]
    }
    else {
        $null
    }
    $responseValidation = if ($null -ne $responseValidationProperty) { $responseValidationProperty.Value } else { $null }
    $finalValidation = Get-JsonPropertyValue -InputObject $responseValidation -Name 'final'

    $moderatorDiagnosticProperty = if ($null -ne $diagnosticEntries) {
        $diagnosticEntries.PSObject.Properties[$moderatorEntryId]
    }
    else {
        $null
    }
    $moderatorDiagnosticEntry = if ($null -ne $moderatorDiagnosticProperty) {
        $moderatorDiagnosticProperty.Value
    }
    else {
        $null
    }
    $selectionPrompt = [string](Get-JsonPropertyValue -InputObject $moderatorDiagnosticEntry -Name 'prompt')
    $rawModeratorResponse = [string](Get-JsonPropertyValue -InputObject $moderatorDiagnosticEntry -Name 'raw_response')

    $diagnosticType = ConvertTo-NormalizedDisagreementType (Get-JsonPropertyValue -InputObject $diagnostic -Name 'disagreement_type')
    $responseType = ConvertTo-NormalizedDisagreementType (Get-JsonPropertyValue -InputObject $responseMetadata -Name 'disagreement_type')
    $typeMatches = [string]::IsNullOrWhiteSpace($responseType) -or $diagnosticType -eq $responseType
    if (-not $typeMatches) {
        $issues.Add([pscustomobject]@{
            Severity = 'MEDIUM'
            Code = 'disagreement_type_mismatch'
            Message = "Moderator classified the disagreement as '$diagnosticType', but the following response classified it as '$responseType'."
            Evidence = [pscustomobject]@{ ModeratorEntryId = $moderatorEntryId; ResponseEntryId = $responseId }
        })
    }

    $recentScheme = [string](Get-JsonPropertyValue -InputObject $moderatorTrace -Name 'recent_scheme')
    $analogy = [string](Get-JsonPropertyValue -InputObject $diagnostic -Name 'distinction_or_analogy_tested')
    if ($recentScheme -match 'PRECEDENT|ANALOGY' -and [string]::IsNullOrWhiteSpace($analogy)) {
        $issues.Add([pscustomobject]@{
            Severity = 'MEDIUM'
            Code = 'missing_analogy_diagnostic'
            Message = "The moderator identified $recentScheme but did not record the distinction or analogy being tested."
            Evidence = [pscustomobject]@{ ModeratorEntryId = $moderatorEntryId }
        })
    }

    $moveTypes = @(Get-JsonArray -InputObject $responseMetadata -Name 'move_types')
    $factChecks = if ($responseIndex -ge 0) {
        @(Get-FactChecksForStatement -Transcript $transcript -StatementIndex $responseIndex)
    }
    else {
        @()
    }
    $problemFactChecks = @($factChecks | Where-Object {
        $factMetadata = Get-JsonPropertyValue -InputObject $_ -Name 'metadata'
        (Get-JsonPropertyValue -InputObject $factMetadata -Name 'verdict') -in @('disputed', 'unverifiable')
    })
    if ($problemFactChecks.Count -gt 0) {
        $issues.Add([pscustomobject]@{
            Severity = 'MEDIUM'
            Code = 'response_evidence_not_verified'
            Message = "$($problemFactChecks.Count) later fact-check(s) were disputed or unverifiable after the moderator-directed response."
            Evidence = @($problemFactChecks | ForEach-Object {
                $metadata = Get-JsonPropertyValue -InputObject $_ -Name 'metadata'
                [pscustomobject]@{
                    ClaimId = Get-JsonPropertyValue -InputObject $metadata -Name 'claim_id'
                    Verdict = Get-JsonPropertyValue -InputObject $metadata -Name 'verdict'
                    Claim = Get-JsonPropertyValue -InputObject $metadata -Name 'claim_text'
                }
            })
        })
    }

    if ($null -ne $selectedCard) {
        $cardId = [string](Get-JsonPropertyValue -InputObject $selectedCard -Name 'id')
        $cardRef = [string](Get-JsonPropertyValue -InputObject $selectedCard -Name 'ref')
        $cardChecksum = [string](Get-JsonPropertyValue -InputObject $selectedCard -Name 'checksum')
        $cardSefariaRef = [string](Get-JsonPropertyValue -InputObject $selectedCard -Name 'sefaria_ref')
        $cardUrl = [string](Get-JsonPropertyValue -InputObject $selectedCard -Name 'sefaria_url')
        $source = Get-JsonPropertyValue -InputObject $selectedCard -Name 'source'
        $translation = Get-JsonPropertyValue -InputObject $selectedCard -Name 'translation'
        $sourceLicense = [string](Get-JsonPropertyValue -InputObject $source -Name 'license')
        $license = [string](Get-JsonPropertyValue -InputObject $translation -Name 'license')
        $translationText = [string](Get-JsonPropertyValue -InputObject $translation -Name 'text')
        $cardExcerpt = [string](Get-JsonPropertyValue -InputObject $selectedCard -Name 'excerpt')
        $responseCardId = [string](Get-JsonPropertyValue -InputObject $referenceResponse -Name 'card_id')
        $responseValid = [bool](Get-JsonPropertyValue -InputObject $referenceResponse -Name 'valid' -Default $false)
        if ([string]::IsNullOrWhiteSpace($cardChecksum)) {
            $issues.Add([pscustomobject]@{
                Severity = 'HIGH'
                Code = 'reference_checksum_missing'
                Message = "Selected source card '$cardId' has no checksum."
                Evidence = [pscustomobject]@{ ModeratorEntryId = $moderatorEntryId; Reference = $cardRef }
            })
        }
        elseif ((Get-TalmudicCardChecksum -Card $selectedCard) -ne $cardChecksum) {
            $issues.Add([pscustomobject]@{
                Severity = 'HIGH'
                Code = 'reference_checksum_mismatch'
                Message = "Selected source card '$cardId' no longer matches its checksum."
                Evidence = [pscustomobject]@{ ModeratorEntryId = $moderatorEntryId; Reference = $cardRef }
            })
        }
        $allowedLicenses = @('Public Domain', 'PD', 'CC0', 'CC-BY', 'CC-BY-SA', 'CC-BY-NC')
        if ($sourceLicense -notin $allowedLicenses -or $license -notin $allowedLicenses) {
            $issues.Add([pscustomobject]@{
                Severity = 'HIGH'
                Code = 'reference_license_invalid'
                Message = "Selected source card '$cardId' has missing or unacceptable edition licensing."
                Evidence = [pscustomobject]@{ ModeratorEntryId = $moderatorEntryId; Reference = $cardRef; SourceLicense = $sourceLicense; TranslationLicense = $license }
            })
        }
        $expectedCardUrl = "https://www.sefaria.org/$cardSefariaRef"
        if ([string]::IsNullOrWhiteSpace($cardSefariaRef) -or $cardUrl -ne $expectedCardUrl) {
            $issues.Add([pscustomobject]@{
                Severity = 'HIGH'
                Code = 'reference_citation_mismatch'
                Message = "Selected source card '$cardId' has an incorrect canonical Sefaria citation."
                Evidence = [pscustomobject]@{ ModeratorEntryId = $moderatorEntryId; Expected = $expectedCardUrl; Actual = $cardUrl }
            })
        }
        $expectedExcerpt = $translationText.Substring(0, [Math]::Min(700, $translationText.Length)).Trim()
        if ($translationText.Length -gt 700) { $expectedExcerpt += '…' }
        if ($cardExcerpt -ne $expectedExcerpt) {
            $issues.Add([pscustomobject]@{
                Severity = 'HIGH'
                Code = 'reference_excerpt_mismatch'
                Message = "Selected source card '$cardId' excerpt does not match its named translation text."
                Evidence = [pscustomobject]@{ ModeratorEntryId = $moderatorEntryId; Reference = $cardRef }
            })
        }
        if ([string]::IsNullOrWhiteSpace($responseCardId) -or $responseCardId -ne $cardId) {
            $issues.Add([pscustomobject]@{
                Severity = 'HIGH'
                Code = 'reference_response_mismatch'
                Message = "The following debater did not return structured engagement for selected card '$cardId'."
                Evidence = [pscustomobject]@{ ModeratorEntryId = $moderatorEntryId; ResponseEntryId = $responseId; ResponseCardId = $responseCardId }
            })
        }
        elseif (-not $responseValid) {
            $issues.Add([pscustomobject]@{
                Severity = 'MEDIUM'
                Code = 'reference_response_invalid'
                Message = "The response to '$cardId' was recorded but failed one or more engagement checks."
                Evidence = @(Get-JsonArray -InputObject $referenceResponse -Name 'warnings')
            })
        }
        $moderatorContent = [string](Get-JsonPropertyValue -InputObject $moderatorEntry -Name 'content')
        if (-not [string]::IsNullOrWhiteSpace($cardRef) -and $moderatorContent -notmatch [regex]::Escape($cardRef)) {
            $issues.Add([pscustomobject]@{
                Severity = 'HIGH'
                Code = 'reference_not_visible'
                Message = "Selected reference '$cardRef' was not visible in the moderator transcript entry."
                Evidence = [pscustomobject]@{ ModeratorEntryId = $moderatorEntryId }
            })
        }
    }

    $review = [ordered]@{
        Round = Get-JsonPropertyValue -InputObject $diagnostic -Name 'round'
        Phase = Get-JsonPropertyValue -InputObject $diagnostic -Name 'phase'
        ModeratorEntryId = $moderatorEntryId
        PromptContainedTalmudicMode = $selectionPrompt -match 'TALMUDIC MODERATION MODE'
        PromptRequestedStructuredDiagnostic = $selectionPrompt -match 'dialectical_diagnostic'
        FocusedCrux = Get-JsonPropertyValue -InputObject $diagnostic -Name 'focused_crux'
        DisagreementType = $diagnosticType
        PremiseUnderExamination = Get-JsonPropertyValue -InputObject $diagnostic -Name 'premise_under_examination'
        DistinctionOrAnalogyTested = Get-JsonPropertyValue -InputObject $diagnostic -Name 'distinction_or_analogy_tested'
        UnresolvedOutcome = Get-JsonPropertyValue -InputObject $diagnostic -Name 'unresolved_outcome'
        CompletenessPercent = Get-DiagnosticCompleteness -Diagnostic $diagnostic
        ModeratorFocusPoint = Get-JsonPropertyValue -InputObject $moderatorTrace -Name 'focus_point'
        RecentScheme = $recentScheme
        InterventionRecommended = [bool](Get-JsonPropertyValue -InputObject $moderatorTrace -Name 'intervention_recommended' -Default $false)
        InterventionValidated = [bool](Get-JsonPropertyValue -InputObject $moderatorTrace -Name 'intervention_validated' -Default $false)
        FollowingSpeaker = Get-JsonPropertyValue -InputObject $followingStatement -Name 'speaker'
        FollowingAddressing = Get-JsonPropertyValue -InputObject $followingStatement -Name 'addressing'
        ResponseDisagreementType = $responseType
        DisagreementTypeMatches = $typeMatches
        ResponseMoves = @($moveTypes | ForEach-Object { Get-JsonPropertyValue -InputObject $_ -Name 'move' })
        ValidationOutcome = Get-JsonPropertyValue -InputObject $finalValidation -Name 'outcome'
        ProcessReward = Get-JsonPropertyValue -InputObject $finalValidation -Name 'process_reward'
        JudgeQualityScore = Get-JsonPropertyValue -InputObject $finalValidation -Name 'judge_quality_score'
        ResponsePreview = ([string](Get-JsonPropertyValue -InputObject $followingStatement -Name 'content')).Substring(
            0,
            [math]::Min(500, ([string](Get-JsonPropertyValue -InputObject $followingStatement -Name 'content')).Length)
        )
        ReferenceSelected = $null -ne $selectedCard
        ReferenceCardId = Get-JsonPropertyValue -InputObject $selectedCard -Name 'id'
        Reference = Get-JsonPropertyValue -InputObject $selectedCard -Name 'ref'
        ReferenceUrl = Get-JsonPropertyValue -InputObject $selectedCard -Name 'sefaria_url'
        ReferenceUsage = Get-JsonPropertyValue -InputObject $referenceSelection -Name 'usage_type'
        ReferenceScore = if ($referenceCandidates.Count -gt 0) { Get-JsonPropertyValue -InputObject $referenceCandidates[0] -Name 'score' } else { $null }
        ReferenceNoMatchReason = Get-JsonPropertyValue -InputObject $referenceSelection -Name 'no_match_reason'
        ReferenceEdition = Get-JsonPropertyValue -InputObject (Get-JsonPropertyValue -InputObject $selectedCard -Name 'translation') -Name 'version_title'
        ReferenceLicense = Get-JsonPropertyValue -InputObject (Get-JsonPropertyValue -InputObject $selectedCard -Name 'translation') -Name 'license'
        ReferenceStance = Get-JsonPropertyValue -InputObject $referenceResponse -Name 'stance'
        RelevantSimilarity = Get-JsonPropertyValue -InputObject $referenceResponse -Name 'relevant_similarity'
        LimitingDifference = Get-JsonPropertyValue -InputObject $referenceResponse -Name 'limiting_difference'
        ReferenceResponseValid = [bool](Get-JsonPropertyValue -InputObject $referenceResponse -Name 'valid' -Default $false)
    }
    if ($IncludeRawModeratorResponse) {
        $review['RawModeratorResponse'] = $rawModeratorResponse
    }
    $reviews.Add([pscustomobject]$review)
}

$activationVerified = $mode -eq 'talmudic' -and $diagnostics.Count -gt 0
$promptVerifiedCount = @($reviews | Where-Object {
    $_.PromptContainedTalmudicMode -and $_.PromptRequestedStructuredDiagnostic
}).Count
$behavioralFollowThroughCount = @($reviews | Where-Object {
    -not [string]::IsNullOrWhiteSpace([string]$_.FollowingSpeaker) -and @($_.ResponseMoves).Count -gt 0
}).Count
$formalInterventionCount = @($reviews | Where-Object { $_.InterventionValidated }).Count
$referenceSelectionCount = @($reviews | Where-Object { $_.ReferenceSelected }).Count
$validReferenceResponseCount = @($reviews | Where-Object { $_.ReferenceResponseValid }).Count
$noMatchCount = @($reviews | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.ReferenceNoMatchReason) }).Count
$referenceStances = @($reviews | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.ReferenceStance) } |
    Group-Object ReferenceStance | ForEach-Object { [pscustomobject]@{ Stance = $_.Name; Count = $_.Count } })
$citationIntegrityFailureCount = @($issues | Where-Object {
    $_.Code -in @('reference_checksum_missing', 'reference_checksum_mismatch', 'reference_license_invalid', 'reference_citation_mismatch', 'reference_excerpt_mismatch', 'reference_not_visible')
}).Count
$baselineComparison = $null
if (-not [string]::IsNullOrWhiteSpace($BaselinePath)) {
    $resolvedBaselinePath = if ([System.IO.Path]::IsPathRooted($BaselinePath)) {
        [System.IO.Path]::GetFullPath($BaselinePath)
    }
    else {
        [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $BaselinePath))
    }
    if (-not (Test-Path -LiteralPath $resolvedBaselinePath -PathType Leaf)) {
        Stop-WithReviewError `
            -Goal 'Load the matched baseline debate' `
            -Problem "Baseline file '$resolvedBaselinePath' does not exist" `
            -Location 'Review-TalmudicDebate.ps1 baseline validation' `
            -NextSteps @('Pass -BaselinePath with an existing method-only debate JSON', 'Run ./scripts/TalmudicDebate/Invoke-TalmudicReferenceExperiment.ps1')
    }
    try {
        $baseline = Get-Content -Raw -LiteralPath $resolvedBaselinePath | ConvertFrom-Json
    }
    catch {
        Stop-WithReviewError `
            -Goal 'Parse the matched baseline debate' `
            -Problem $_.Exception.Message `
            -Location $resolvedBaselinePath `
            -NextSteps @('Confirm the baseline contains valid JSON', 'Regenerate the matched experiment pair')
    }
    $baselineDiagnostics = @(Get-JsonArray -InputObject $baseline -Name 'dialectical_diagnostics')
    $baselineSelections = @($baselineDiagnostics | ForEach-Object {
        Get-JsonPropertyValue -InputObject (Get-JsonPropertyValue -InputObject $_ -Name 'reference_selection') -Name 'selected_card'
    } | Where-Object { $null -ne $_ })
    $baselineUnresolved = @($baselineDiagnostics | ForEach-Object { [string](Get-JsonPropertyValue -InputObject $_ -Name 'unresolved_outcome') })
    $sourcedUnresolved = @($reviews | ForEach-Object { [string]$_.UnresolvedOutcome })
    $unresolvedChanges = [System.Collections.Generic.List[object]]::new()
    $comparisonCount = [Math]::Max($baselineUnresolved.Count, $sourcedUnresolved.Count)
    for ($index = 0; $index -lt $comparisonCount; $index++) {
        $baselineCrux = if ($index -lt $baselineUnresolved.Count) { $baselineUnresolved[$index] } else { $null }
        $sourcedCrux = if ($index -lt $sourcedUnresolved.Count) { $sourcedUnresolved[$index] } else { $null }
        if ($baselineCrux -ne $sourcedCrux) {
            $unresolvedChanges.Add([pscustomobject]@{
                DiagnosticIndex = $index
                Baseline = $baselineCrux
                SourceGrounded = $sourcedCrux
            })
        }
    }
    $baselineComparison = [pscustomobject]@{
        BaselinePath = $resolvedBaselinePath
        SameTopic = (Get-JsonPropertyValue -InputObject (Get-JsonPropertyValue -InputObject $baseline -Name 'topic') -Name 'final') -eq
            (Get-JsonPropertyValue -InputObject (Get-JsonPropertyValue -InputObject $debate -Name 'topic') -Name 'final')
        SameModel = (Get-JsonPropertyValue -InputObject $baseline -Name 'debate_model') -eq (Get-JsonPropertyValue -InputObject $debate -Name 'debate_model')
        BaselineModeratorMode = Get-JsonPropertyValue -InputObject $baseline -Name 'moderator_mode'
        BaselineReferenceSelections = $baselineSelections.Count
        SourcedReferenceSelections = $referenceSelectionCount
        SourcedValidEngagements = $validReferenceResponseCount
        SourcedNoMatchRounds = $noMatchCount
        CitationIntegrityFailures = $citationIntegrityFailureCount
        ReferenceStances = $referenceStances
        UnresolvedCruxChanges = @($unresolvedChanges)
        Interpretation = 'A matched pair exposes reference-specific differences but does not eliminate stochastic model variation; repeat pairs before causal claims.'
    }
}
$overallAssessment = if (-not $activationVerified) {
    'Needs revision'
}
elseif (@($issues | Where-Object { $_.Severity -eq 'HIGH' }).Count -gt 0) {
    'Share with caveats'
}
elseif ($behavioralFollowThroughCount -eq 0) {
    'Needs revision'
}
else {
    'Ready for matched comparison'
}

$report = [pscustomobject]@{
    OverallAssessment = $overallAssessment
    SourcePath = $resolvedPath
    ReviewedAt = (Get-Date).ToString('o')
    Session = [pscustomobject]@{
        DebateId = Get-JsonPropertyValue -InputObject $debate -Name 'id'
        Title = Get-JsonPropertyValue -InputObject $debate -Name 'title'
        ModeratorMode = $mode
        Model = Get-JsonPropertyValue -InputObject $debate -Name 'debate_model'
        UpdatedAt = Get-JsonPropertyValue -InputObject $debate -Name 'updated_at'
        TranscriptEntries = $transcript.Count
        ArgumentNetworkNodes = $argumentNodes.Count
    }
    Evidence = [pscustomobject]@{
        ActivationVerified = $activationVerified
        DialecticalDiagnostics = $diagnostics.Count
        PromptsVerified = $promptVerifiedCount
        BehavioralFollowThrough = $behavioralFollowThroughCount
        FormalInterventions = $formalInterventionCount
        ReferenceSelections = $referenceSelectionCount
        ExplicitReferenceEngagements = $validReferenceResponseCount
        ValidReferenceResponses = $validReferenceResponseCount
        ReferenceNoMatches = $noMatchCount
        ReferenceStances = $referenceStances
        CitationIntegrityFailures = $citationIntegrityFailureCount
        MatchedBaselineProvided = $null -ne $baselineComparison
        CausalAttributionVerified = $false
        CausalAttributionNote = 'Repeated matched Talmudic method-only/source-grounded pairs are required before attributing differences to the references.'
    }
    BaselineComparison = $baselineComparison
    DialecticalReviews = @($reviews)
    Issues = @($issues)
}

if ($AsJson) {
    $report | ConvertTo-Json -Depth 12
    exit 0
}

Write-Host "Talmudic Debate Behavioral Review" -ForegroundColor Green
Write-Host "Assessment: $overallAssessment"
Write-Host "Source:     $resolvedPath"

Write-SectionHeading 'Activation and evidence chain'
Write-Host "Moderator mode persisted:       $($mode -eq 'talmudic')"
Write-Host "Structured diagnostics present: $($diagnostics.Count)"
Write-Host "Talmudic prompts verified:       $promptVerifiedCount"
Write-Host "Responses with follow-through:   $behavioralFollowThroughCount"
Write-Host "Formal interventions validated:  $formalInterventionCount"
Write-Host "Source cards selected:            $referenceSelectionCount"
Write-Host "Valid source engagements:         $validReferenceResponseCount"
Write-Host "Reference no-match rounds:        $noMatchCount"
Write-Host "Citation integrity failures:      $citationIntegrityFailureCount"
Write-Host 'Causal attribution verified:     False (repeat matched method-only/source-grounded pairs)'

foreach ($review in $reviews) {
    Write-SectionHeading "Round $($review.Round): $($review.FocusedCrux)"
    Write-Host "Type:             $($review.DisagreementType)"
    Write-Host "Premise:          $($review.PremiseUnderExamination)"
    Write-Host "Distinction:      $($review.DistinctionOrAnalogyTested)"
    Write-Host "Unresolved:       $($review.UnresolvedOutcome)"
    Write-Host "Completeness:     $($review.CompletenessPercent)%"
    Write-Host "Recent scheme:    $($review.RecentScheme)"
    Write-Host "Response:         $($review.FollowingSpeaker) -> $($review.FollowingAddressing)"
    Write-Host "Response moves:   $(@($review.ResponseMoves) -join ', ')"
    Write-Host "Type agreement:   $($review.DisagreementTypeMatches)"
    Write-Host "Validation:       $($review.ValidationOutcome), reward=$($review.ProcessReward), judge=$($review.JudgeQualityScore)"
    if ($review.ReferenceSelected) {
        Write-Host "Source card:      $($review.ReferenceCardId) — $($review.Reference) [$($review.ReferenceUsage), score=$($review.ReferenceScore)]" -ForegroundColor Magenta
        Write-Host "Edition/license:  $($review.ReferenceEdition) / $($review.ReferenceLicense)"
        Write-Host "Response stance:  $($review.ReferenceStance)"
        Write-Host "Similarity:       $($review.RelevantSimilarity)"
        Write-Host "Limiting diff.:   $($review.LimitingDifference)"
        Write-Host "Engagement valid: $($review.ReferenceResponseValid)"
    }
    elseif (-not [string]::IsNullOrWhiteSpace([string]$review.ReferenceNoMatchReason)) {
        Write-Host "Source no-match:  $($review.ReferenceNoMatchReason)" -ForegroundColor Yellow
    }
    Write-Host "Preview:          $($review.ResponsePreview)"
}

if ($null -ne $baselineComparison) {
    Write-SectionHeading 'Matched baseline comparison'
    Write-Host "Baseline:             $($baselineComparison.BaselinePath)"
    Write-Host "Same topic/model:     $($baselineComparison.SameTopic) / $($baselineComparison.SameModel)"
    Write-Host "Baseline source cards:$($baselineComparison.BaselineReferenceSelections)"
    Write-Host "Sourced source cards: $($baselineComparison.SourcedReferenceSelections)"
    Write-Host "Valid engagements:    $($baselineComparison.SourcedValidEngagements)"
    Write-Host "No-match rounds:      $($baselineComparison.SourcedNoMatchRounds)"
    Write-Host "Citation failures:    $($baselineComparison.CitationIntegrityFailures)"
    Write-Host "Engagement stances:   $(@($baselineComparison.ReferenceStances | ForEach-Object { "$($_.Stance)=$($_.Count)" }) -join ', ')"
    Write-Host "Unresolved changes:   $(@($baselineComparison.UnresolvedCruxChanges).Count)"
    Write-Host $baselineComparison.Interpretation -ForegroundColor DarkGray
}

Write-SectionHeading "Issues ($($issues.Count))"
if ($issues.Count -eq 0) {
    Write-Host 'No automated integrity or follow-through issues found.' -ForegroundColor Green
}
else {
    foreach ($issue in $issues) {
        $color = if ($issue.Severity -eq 'HIGH') { 'Red' } elseif ($issue.Severity -eq 'MEDIUM') { 'Yellow' } else { 'Gray' }
        Write-Host "[$($issue.Severity)] $($issue.Code): $($issue.Message)" -ForegroundColor $color
    }
}

Write-Host ''
Write-Host 'Tip: use -AsJson for machine-readable output or -IncludeRawModeratorResponse to include the moderator JSON.' -ForegroundColor DarkGray
