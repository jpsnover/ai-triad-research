# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-BriefNarrationStage {
    <#
    .SYNOPSIS
        Run ONLY the Brief Export narrate stage against a deck_spec, for debugging
        zero-entry / bad-trace model failures without the full pipeline (t/2873).
    .DESCRIPTION
        Wraps the lib/brief narrate-stage CLI (tsx). Loads a deck_spec JSON, runs the
        single narrate() model call, and reports what came back — entry count, audience
        questions, checker pass/fail, and any schema/trace validation errors — WITHOUT
        running extract → render → verify.

        Narration failure is DATA, not an exception: a zero-entry or bad-trace result
        returns normally with Errors populated and EntryCount 0 (that IS the diagnostic).
        Only infrastructure faults (missing spec file, CLI crash) raise a non-terminating
        error, so a pipeline of specs survives one bad input.
    .PARAMETER SpecPath
        Path to a deck_spec JSON. Binds FullName from the pipeline.
    .PARAMETER Model
        Narrator model id. Required unless -SkipNarration.
    .PARAMETER Preset
        policymaker | conference (default) | classroom — drives compression.
    .PARAMETER CheckerModel
        Optional maker-checker model; when set, CheckerPassed reflects its verdict.
    .PARAMETER SkipNarration
        Deterministic (verbatim) narration with zero model calls — the control case.
    .OUTPUTS
        [PSCustomObject] with SpecPath, Model, Preset, EntryCount, AudienceQuestionCount,
        Errors (string[]), CheckerPassed (nullable), Narration (raw parsed object).
    .EXAMPLE
        Test-BriefNarrationStage -SpecPath .\deck_spec.json -Model gemini-3.5-flash-lite
    .EXAMPLE
        Get-ChildItem *deck_spec.json | Test-BriefNarrationStage -SkipNarration
    .LINK
        Export-TriadDebateBrief
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory, ValueFromPipeline, ValueFromPipelineByPropertyName, Position = 0)]
        [Alias('FullName')]
        [string]$SpecPath,

        [Parameter()]
        [string]$Model,

        [Parameter()]
        [ValidateSet('policymaker', 'conference', 'classroom')]
        [string]$Preset = 'conference',

        [Parameter()]
        [string]$CheckerModel,

        [Parameter()]
        [switch]$SkipNarration
    )

    begin {
        Set-StrictMode -Version Latest

        $WriteStageError = {
            param([string]$Id, [string]$Message, $TargetObject)
            $rec = [System.Management.Automation.ErrorRecord]::new(
                [System.Exception]::new($Message), $Id,
                [System.Management.Automation.ErrorCategory]::InvalidOperation, $TargetObject)
            $PSCmdlet.WriteError($rec)   # non-terminating; honors -ErrorAction Stop
        }
    }

    process {
        if (-not (Test-Path -LiteralPath $SpecPath -PathType Leaf)) {
            & $WriteStageError 'SpecFileInvalid' "deck_spec file not found: $SpecPath" $SpecPath; return
        }
        if (-not $SkipNarration -and -not $Model) {
            & $WriteStageError 'ModelUnavailable' 'Narration requires -Model unless -SkipNarration.' $SpecPath; return
        }

        $ResolvedSpec = (Resolve-Path -LiteralPath $SpecPath).Path
        $Inv = Resolve-BriefNarrateCli

        # Frozen flags (t/2873#2): --spec/--model + optional --preset/--checker-model/--skip-narration.
        $CliArgs = @('--spec', $ResolvedSpec, '--preset', $Preset)
        if ($SkipNarration) { $CliArgs += '--skip-narration' } else { $CliArgs += @('--model', $Model) }
        if ($CheckerModel)  { $CliArgs += @('--checker-model', $CheckerModel) }
        $AllArgs = @($Inv.ArgPrefix) + $CliArgs

        $StderrFile = [System.IO.Path]::GetTempFileName()
        try {
            $Stdout = & $Inv.Exe @AllArgs 2> $StderrFile
            $Exit = $LASTEXITCODE
            $Stderr = if (Test-Path $StderrFile) { Get-Content -Raw -Path $StderrFile } else { '' }
        }
        finally {
            Remove-Item -Path $StderrFile -Force -ErrorAction SilentlyContinue
        }

        # exit != 0 = infra/arg fault (spec unreadable, CLI crash), NOT a narration
        # failure. Surface the CLI's {errorCode,message} as a non-terminating error.
        if ($Exit -ne 0) {
            $errObj = $null
            try {
                $errLine = @(($Stderr -split "`n") | Where-Object { $_ -match '"errorCode"' }) | Select-Object -First 1
                if ($errLine) { $errObj = $errLine | ConvertFrom-Json }
            } catch { }
            $id  = if ($errObj -and $errObj.PSObject.Properties['errorCode']) { [string]$errObj.errorCode } else { 'NarrateCliFailure' }
            $msg = if ($errObj -and $errObj.PSObject.Properties['message'])   { [string]$errObj.message }   else { "narrate CLI exited with code $Exit" }
            & $WriteStageError $id $msg $ResolvedSpec; return
        }

        # Assert OUTPUT, not just exit 0 (t/2874): a broken entrypoint can exit 0 with
        # NO stdout — never let that parse into a fake zero-entry result.
        if ([string]::IsNullOrWhiteSpace((@($Stdout) -join ''))) {
            & $WriteStageError 'NarrateCliFailure' 'The narrate CLI exited 0 but produced no output — treat as failure, not an empty result (broken entrypoint / t/2868).' $ResolvedSpec; return
        }

        $result = $null
        try { $result = @($Stdout) -join "`n" | ConvertFrom-Json }
        catch { & $WriteStageError 'NarrateCliFailure' 'Could not parse the narrate CLI output as JSON.' $ResolvedSpec; return }
        if ($null -eq $result) { & $WriteStageError 'NarrateCliFailure' 'The narrate CLI output parsed to null — no result emitted.' $ResolvedSpec; return }

        $get = { param($n) if ($result -and $result.PSObject.Properties[$n]) { $result.$n } else { $null } }

        $checkerPassed = $null
        $checker = & $get 'checkerReport'
        if ($checker -and $checker.PSObject.Properties['passed']) { $checkerPassed = [bool]$checker.passed }

        [PSCustomObject]@{
            SpecPath              = $ResolvedSpec
            Model                 = if ($SkipNarration) { '(none — narration skipped)' } else { $Model }
            Preset                = $Preset
            EntryCount            = [int](& { $v = & $get 'entryCount'; if ($null -ne $v) { $v } else { 0 } })
            AudienceQuestionCount = [int](& { $v = & $get 'audienceQuestionCount'; if ($null -ne $v) { $v } else { 0 } })
            Errors                = @(& { $e = & $get 'errors'; if ($e) { $e } else { @() } })
            CheckerPassed         = $checkerPassed
            Narration             = & $get 'narration'
        }
    }
}
