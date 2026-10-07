# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Steps of Export-TriadDebateBrief (Brief Export T8), split out for t/3910 (complexity 101 → under 20 per
# function). Pure refactor: every message, verbose line, error id/category/target, REST call and CLI flag
# is unchanged; tests/Export-TriadDebateBrief.Characterization.Tests.ps1 pins them byte for byte.
# Errors stay NON-TERMINATING and are written through the calling cmdlet ($Cmdlet.WriteError), so the
# FullyQualifiedErrorId stays "<Id>,Export-TriadDebateBrief" and -ErrorAction Stop still behaves normally.

# ExportErrorCode (lib/brief/types.ts) + local DebateFileInvalid → PS category.
# Server mode adds two HTTP-level ids (429 quota/concurrency) that aren't job
# errorCodes but need a clean surface.
$script:BriefExportErrorCategory = @{
    DebateNotFound    = 'ObjectNotFound';    DebateNotClosed = 'InvalidOperation'
    AuthFailure       = 'PermissionDenied';  ModelUnavailable = 'ResourceUnavailable'
    SpecSchemaFailure = 'InvalidData';       TraceGateFailure = 'InvalidData'
    SymmetryFailure   = 'InvalidData';       PptxLintFailure  = 'InvalidData'
    RenderFailure     = 'InvalidData';       DebateFileInvalid = 'InvalidData'
    ExportQuotaExceeded    = 'QuotaExceeded'; ExportConcurrencyLimit = 'ResourceBusy'
}

# HTTP status → export error id for Invoke-RemoteCheck failures (429 is split on the body's error).
$script:BriefExportHttpErrorId = @{ 401 = 'AuthFailure'; 403 = 'AuthFailure'; 404 = 'DebateNotFound'; 409 = 'DebateNotClosed'; 400 = 'ModelUnavailable' }

$script:BriefServerArtifacts = @('deck_spec.json', 'narration.json', 'audit-manifest.json', 'brief.pptx')

function Write-BriefExportError {
    # Non-terminating error through the cmdlet; honors -ErrorAction Stop.
    param($Cmdlet, [string]$Id, [string]$Message, $TargetObject)
    $cat = if ($script:BriefExportErrorCategory.ContainsKey($Id)) { $script:BriefExportErrorCategory[$Id] } else { 'NotSpecified' }
    $rec = [System.Management.Automation.ErrorRecord]::new(
        [System.Exception]::new($Message), $Id,
        [System.Management.Automation.ErrorCategory]$cat, $TargetObject)
    $Cmdlet.WriteError($rec)
}

function Write-BriefExportSummary {
    # Shared end-of-export verbose summary (both modes), so the two paths' -Verbose traces read the same.
    param([string]$Mode, $Export)
    Write-Verbose "──────── Brief export complete ($Mode) ────────"
    Write-Verbose "  Debate:         $($Export.DebateId)"
    Write-Verbose "  Title:          $($Export.Title)"
    Write-Verbose "  Preset:         $($Export.Preset)"
    Write-Verbose "  Model:          $($Export.Model)$(if ($Export.ModelSource) { " (source: $($Export.ModelSource))" })"
    if ($Export.CheckerModel) { Write-Verbose "  Checker model:  $($Export.CheckerModel)" }
    Write-Verbose ("  Trace coverage: {0:N1}%" -f $Export.TraceCoveragePct)
    if ($Export.Verdicts -and $Export.Verdicts.Count -gt 0) {
        $vs = ($Export.Verdicts.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ', '
        Write-Verbose "  Verdicts:       $vs"
    }
    $wc = @($Export.Warnings).Count
    Write-Verbose "  Warnings:       $wc"
    Write-Verbose "  Deck (.pptx):   $($Export.Path)"
    Write-Verbose "  Deck spec:      $($Export.SpecPath)"
    Write-Verbose "  Audit manifest: $($Export.ManifestPath)"
}

function Test-BriefOutputDirectoryBusy {
    # True when $OutDir exists, has entries, and -Force wasn't given (both modes refuse to overwrite).
    param([string]$OutDir, [bool]$Force)
    return ((Test-Path -LiteralPath $OutDir) -and
        @(Get-ChildItem -LiteralPath $OutDir -Force -ErrorAction SilentlyContinue).Count -gt 0 -and
        -not $Force)
}

function Get-BriefPropertyValue {
    # $Object.$Name when the property exists, else $null (the original's $mget / $get).
    param($Object, [string]$Name)
    if ($Object -and $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $null
}

function ConvertTo-BriefVerdictTable {
    # A verdict-count object → @{ name = [int]count }; @{} when absent.
    param($Source)
    $verdicts = @{}
    if ($Source) { foreach ($p in $Source.PSObject.Properties) { $verdicts[$p.Name] = [int]$p.Value } }
    return $verdicts
}

# ── Server mode: T6 REST client (t/2862) ────────────────────────────────────────

function ConvertTo-BriefHttpError {
    # Map an Invoke-RemoteCheck failure → { Id; Message } on the export taxonomy.
    param($Res, [string]$What)
    $status = [int]$Res.StatusCode
    $bodyErr = $null; $bodyMsg = $null
    if ($Res.Body) {
        if ($Res.Body.PSObject.Properties['error'])   { $bodyErr = [string]$Res.Body.error }
        if ($Res.Body.PSObject.Properties['message']) { $bodyMsg = [string]$Res.Body.message }
    }
    $msg = if ($bodyMsg) { $bodyMsg } elseif ($Res.Error) { [string]$Res.Error } else { "$What failed (HTTP $status)." }
    $id = if ($status -eq 429) {
        if ($bodyErr -eq 'concurrency_limit') { 'ExportConcurrencyLimit' } else { 'ExportQuotaExceeded' }
    }
    elseif ($script:BriefExportHttpErrorId.ContainsKey($status)) { $script:BriefExportHttpErrorId[$status] }
    else { 'RenderFailure' }
    @{ Id = $id; Message = $msg }
}

function Get-BriefServerModelLabel {
    param([bool]$SkipNarration, [string]$Model)
    if ($SkipNarration) { return '(none — narration skipped)' }
    if ($Model) { return $Model }
    return '(server-resolved free tier)'
}

function Submit-BriefServerExportJob {
    # POST the async export job (idempotent server-side). Returns the jobId, or $null after writing the error.
    param($Cmdlet, [string]$BaseUrl, [string]$DebateId, [string]$Preset, [bool]$SkipNarration,
        [string]$Model, [string]$CheckerModel, [hashtable]$Headers, [int]$TimeoutSec)
    $postBody = @{ preset = $Preset }
    if ($SkipNarration) { $postBody['skipNarration'] = $true }
    if ($Model)         { $postBody['model'] = $Model }
    if ($CheckerModel)  { $postBody['checkerModel'] = $CheckerModel }
    $post = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path "/api/debates/$DebateId/exports" `
        -Method POST -Body $postBody -ExtraHeaders $Headers -AcceptableStatusCodes @(202) `
        -TimeoutSec $TimeoutSec -ExpectJson
    if (-not $post.Success) { $m = ConvertTo-BriefHttpError $post 'Create export job'; Write-BriefExportError $Cmdlet $m.Id $m.Message $DebateId; return $null }
    if (-not ($post.Body -and $post.Body.PSObject.Properties['jobId'] -and $post.Body.jobId)) {
        Write-BriefExportError $Cmdlet 'RenderFailure' 'Export job creation returned no jobId (unexpected 202 body).' $DebateId; return $null
    }
    return [string]$post.Body.jobId
}

function Write-BriefJobPollStatus {
    # Verbose on status change only, Write-Progress always, and each new job warning once.
    param($Job, [string]$JobId, [string]$DebateId, [string]$LastStatus, [int]$ProgressId,
        [System.Collections.Generic.HashSet[string]]$Streamed)
    $jobStatus = [string]$Job.status
    $pct = if ($Job.PSObject.Properties['progressPct'] -and $null -ne $Job.progressPct) { [int]$Job.progressPct } else { 0 }
    if ($jobStatus -ne $LastStatus) { Write-Verbose "  job '$JobId': $jobStatus ($pct%)" }
    Write-Progress -Id $ProgressId -Activity "Exporting brief: $DebateId" -Status $jobStatus -PercentComplete ([Math]::Max(0, [Math]::Min(100, $pct)))
    if ($Job.PSObject.Properties['warnings'] -and $Job.warnings) {
        foreach ($w in @($Job.warnings)) { if ($Streamed.Add([string]$w)) { Write-Warning ([string]$w) } }
    }
}

function Write-BriefFailedJobError {
    param($Cmdlet, $Job, [string]$DebateId)
    $eid = if ($Job.PSObject.Properties['errorCode'] -and $Job.errorCode) { [string]$Job.errorCode } else { 'RenderFailure' }
    $emsg = if ($Job.PSObject.Properties['error'] -and $Job.error) { [string]$Job.error } else { 'Export job failed.' }
    Write-BriefExportError $Cmdlet $eid $emsg $DebateId
}

function Wait-BriefServerExportJob {
    # Poll the job to completion. Returns the exportId, or $null after writing the error.
    param($Cmdlet, [string]$BaseUrl, [string]$JobId, [string]$DebateId, [hashtable]$Headers, [int]$TimeoutSec,
        [System.Collections.Generic.HashSet[string]]$Streamed)
    $progressId = 2862
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $lastStatus = $null
    try {
        while ($true) {
            $poll = Invoke-RemoteCheck -BaseUrl $BaseUrl -Path "/api/export-jobs/$JobId" `
                -Method GET -ExtraHeaders $Headers -AcceptableStatusCodes @(200) -TimeoutSec $TimeoutSec -ExpectJson
            if (-not $poll.Success) { $m = ConvertTo-BriefHttpError $poll 'Poll export job'; Write-BriefExportError $Cmdlet $m.Id $m.Message $DebateId; return $null }
            $job = $poll.Body
            $jobStatus = [string]$job.status
            Write-BriefJobPollStatus -Job $job -JobId $JobId -DebateId $DebateId -LastStatus $lastStatus -ProgressId $progressId -Streamed $Streamed
            $lastStatus = $jobStatus
            if ($jobStatus -eq 'done') { return [string]$job.exportId }
            if ($jobStatus -eq 'failed') { Write-BriefFailedJobError $Cmdlet $job $DebateId; return $null }
            if ((Get-Date) -gt $deadline) {
                Write-BriefExportError $Cmdlet 'RenderFailure' "Export job '$JobId' did not finish within $TimeoutSec s (last status: $jobStatus)." $DebateId; return $null
            }
            Start-Sleep -Seconds 2
        }
    }
    finally { Write-Progress -Id $progressId -Activity "Exporting brief: $DebateId" -Completed }
}

function Save-BriefServerArtifactSet {
    # Download the 4 artifacts (never brief.html — Electron-only). Returns name → path, or $null after writing the error.
    param($Cmdlet, [string]$BaseUrl, [string]$ExportId, [string]$OutDir, [string]$DebateId, [hashtable]$Headers, [int]$TimeoutSec)
    $null = New-Item -ItemType Directory -Path $OutDir -Force
    Write-Verbose "Job done (exportId '$ExportId'). Downloading 4 artifacts → $OutDir"
    $paths = @{}
    foreach ($name in $script:BriefServerArtifacts) {
        $dest = Join-Path $OutDir $name
        try {
            Save-BriefArtifact -BaseUrl $BaseUrl -ExportId $ExportId -Name $name -Destination $dest -Headers $Headers -TimeoutSec $TimeoutSec
            $paths[$name] = $dest
            $sizeKb = if (Test-Path -LiteralPath $dest) { '{0:N1} KB' -f ((Get-Item -LiteralPath $dest).Length / 1KB) } else { '?' }
            Write-Verbose "  ↓ $name ($sizeKb)"
        }
        catch { Write-BriefExportError $Cmdlet 'RenderFailure' "Failed to download artifact '$name': $($_.Exception.Message)" $DebateId; return $null }
    }
    return $paths
}

function Read-BriefJsonFile {
    # Parsed JSON, or $null when the file is missing or unparseable (the build step tolerates either).
    param([string]$Path)
    try { return (Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json) } catch { return $null }
}

function ConvertTo-BriefServerDeckExport {
    # Build [TriadDeckExport] from the downloaded manifest + deck_spec.
    param([hashtable]$Paths, [string]$DebateId, [string]$Preset, [System.Collections.Generic.HashSet[string]]$Streamed)
    $manifest = Read-BriefJsonFile $Paths['audit-manifest.json']
    $spec     = Read-BriefJsonFile $Paths['deck_spec.json']
    $mWarnings = @(Get-BriefPropertyValue $manifest 'warnings'); if (-not $mWarnings) { $mWarnings = @($Streamed) }
    $debate = Get-BriefPropertyValue $manifest 'debate_id'
    $trace = Get-BriefPropertyValue $manifest 'trace_coverage_pct'
    [TriadDeckExport]@{
        DebateId         = [string]$(if ($debate) { $debate } else { $DebateId })
        Title            = [string](Get-BriefPropertyValue $spec 'title')
        Preset           = $Preset
        Model            = [string](Get-BriefPropertyValue $manifest 'narrator_model')
        ModelSource      = [string](Get-BriefPropertyValue $manifest 'narrator_model_source')
        CheckerModel     = [string](Get-BriefPropertyValue $manifest 'checker_model')
        Path             = [string]$Paths['brief.pptx']
        SpecPath         = [string]$Paths['deck_spec.json']
        ManifestPath     = [string]$Paths['audit-manifest.json']
        TraceCoveragePct = [double]$(if ($null -ne $trace) { $trace } else { 0.0 })
        Verdicts         = (ConvertTo-BriefVerdictTable (Get-BriefPropertyValue $manifest 'verdict_counts'))
        Warnings         = @($mWarnings)
    }
}

function Invoke-BriefServerExport {
    # Server mode end to end: job → poll → download → [TriadDeckExport]. Returns the export, or $null.
    param($Cmdlet, [string]$DebateId, [string]$Preset, [string]$Model, [string]$CheckerModel, [bool]$SkipNarration,
        [string]$OutputDirectory, [string]$AccessToken, [string]$BaseUrl, [bool]$Force, [int]$TimeoutSec)
    $resolvedBase = if ($BaseUrl) { $BaseUrl.TrimEnd('/') } else { Get-TaxEditorBaseUrl }
    Write-Verbose "Server mode: exporting debate '$DebateId' via $resolvedBase (auth: $(if ($AccessToken) { 'bearer token' } else { 'none — anonymous' }))."
    # AAD bearer only. NEVER set x-ms-client-principal / spoof identity — Easy Auth
    # strips client-set principal headers in prod, and a bypass defeats the billable gate.
    $headers = @{}
    if ($AccessToken) { $headers['Authorization'] = "Bearer $AccessToken" }

    $resolvedModel = Get-BriefServerModelLabel -SkipNarration $SkipNarration -Model $Model
    if (-not $Cmdlet.ShouldProcess("debate '$DebateId'", "export brief (preset=$Preset, model=$resolvedModel) via $resolvedBase")) { return $null }

    $jobId = Submit-BriefServerExportJob -Cmdlet $Cmdlet -BaseUrl $resolvedBase -DebateId $DebateId -Preset $Preset -SkipNarration $SkipNarration `
        -Model $Model -CheckerModel $CheckerModel -Headers $headers -TimeoutSec $TimeoutSec
    if (-not $jobId) { return $null }
    Write-Verbose "Created async export job '$jobId' (preset=$Preset, model=$resolvedModel$(if ($CheckerModel) { ", checker=$CheckerModel" })). Polling every 2s (timeout ${TimeoutSec}s)."

    $streamed = [System.Collections.Generic.HashSet[string]]::new()
    $exportId = Wait-BriefServerExportJob -Cmdlet $Cmdlet -BaseUrl $resolvedBase -JobId $jobId -DebateId $DebateId -Headers $headers -TimeoutSec $TimeoutSec -Streamed $streamed
    if ($null -eq $exportId) { return $null }

    $OutDir = if ($OutputDirectory) { $OutputDirectory } else { Join-Path (Get-Location).Path "$DebateId-brief" }
    if (Test-BriefOutputDirectoryBusy -OutDir $OutDir -Force $Force) {
        Write-BriefExportError $Cmdlet 'RenderFailure' "Output directory is not empty: $OutDir — use -Force to overwrite." $OutDir; return $null
    }
    $paths = Save-BriefServerArtifactSet -Cmdlet $Cmdlet -BaseUrl $resolvedBase -ExportId $exportId -OutDir $OutDir -DebateId $DebateId -Headers $headers -TimeoutSec $TimeoutSec
    if ($null -eq $paths) { return $null }

    $Export = ConvertTo-BriefServerDeckExport -Paths $paths -DebateId $DebateId -Preset $Preset -Streamed $streamed
    Write-BriefExportSummary 'server' $Export
    return $Export
}

# ── Local mode (t/2837 full-pipeline CLI) ───────────────────────────────────────

function Resolve-BriefLocalOutputDirectory {
    # --out is a DIRECTORY: the CLI writes brief.pptx + deck_spec.json + narration.json + audit-manifest.json
    # under it. Default: a "<debate>-brief" dir beside the debate JSON.
    param([string]$ResolvedPath, [string]$OutputDirectory)
    if ($OutputDirectory) { return $OutputDirectory }
    $base = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedPath)
    return (Join-Path (Split-Path -Parent $ResolvedPath) "$base-brief")
}

function Get-BriefCliArgumentList {
    # Frozen CLI flags (lib/brief/cli.ts): --path/--model/--preset/--out (dir),
    # optional --skip-narration/--checker-model/--allow-open.
    param([string]$ResolvedPath, [string]$Preset, [string]$OutDir, [string]$Model,
        [bool]$SkipNarration, [string]$CheckerModel, [bool]$AllowOpenDebate)
    $CliArgs = @('--path', $ResolvedPath, '--preset', $Preset, '--out', $OutDir, '--model', $Model)
    if ($SkipNarration)   { $CliArgs += '--skip-narration' }
    if ($CheckerModel)    { $CliArgs += @('--checker-model', $CheckerModel) }
    if ($AllowOpenDebate) { $CliArgs += '--allow-open' }
    return $CliArgs
}

function Invoke-BriefCli {
    # Runs the CLI, capturing stdout, exit code and stderr. Returns @{ Stdout; Exit; Stderr }.
    param([string]$Exe, [object[]]$AllArgs, [string]$Path)
    $progressId = 2806
    Write-Progress -Id $progressId -Activity "Exporting brief: $([System.IO.Path]::GetFileName($Path))" -Status 'Running pipeline' -PercentComplete 10
    $StderrFile = [System.IO.Path]::GetTempFileName()
    try {
        $Stdout = & $Exe @AllArgs 2> $StderrFile
        $Exit = $LASTEXITCODE
        $Stderr = if (Test-Path $StderrFile) { Get-Content -Raw -Path $StderrFile } else { '' }
    }
    finally {
        Remove-Item -Path $StderrFile -Force -ErrorAction SilentlyContinue
        Write-Progress -Id $progressId -Activity "Exporting brief: $([System.IO.Path]::GetFileName($Path))" -Completed
    }
    return @{ Stdout = $Stdout; Exit = $Exit; Stderr = $Stderr }
}

function Get-BriefCliError {
    # A failed run's { Id; Message }: the stderr {errorCode,message} line when present, else RenderFailure.
    param([string]$Stderr, [int]$Exit)
    $ErrObj = $null
    try {
        $ErrLine = @(($Stderr -split "`n") | Where-Object { $_ -match '"errorCode"' }) | Select-Object -First 1
        if ($ErrLine) { $ErrObj = $ErrLine | ConvertFrom-Json }
    } catch { }
    $Id  = if ($ErrObj -and $ErrObj.PSObject.Properties['errorCode']) { [string]$ErrObj.errorCode } else { 'RenderFailure' }
    $Msg = if ($ErrObj -and $ErrObj.PSObject.Properties['message'])   { [string]$ErrObj.message }   else { "brief CLI exited with code $Exit" }
    return @{ Id = $Id; Message = $Msg }
}

function Read-BriefCliDeck {
    # Parses CLI stdout into the deck object. Returns it, or $null after writing the error. Asserts OUTPUT,
    # not just exit 0 (t/2874): a broken entrypoint can exit 0 with NO stdout (t/2868 Windows
    # invokedDirectly misfire). Never let that parse into an all-null TriadDeckExport reported as success.
    param($Cmdlet, $Stdout, [string]$Path)
    if ([string]::IsNullOrWhiteSpace((@($Stdout) -join ''))) {
        Write-BriefExportError $Cmdlet 'RenderFailure' 'The brief CLI exited 0 but produced no output — treat as failure, not an empty export (broken entrypoint / t/2868).' $Path; return $null
    }
    $Deck = $null
    try { $Deck = @($Stdout) -join "`n" | ConvertFrom-Json }
    catch { Write-BriefExportError $Cmdlet 'SpecSchemaFailure' 'Could not parse the brief CLI output as TriadDeckExport JSON.' $Path; return $null }
    if ($null -eq $Deck) { Write-BriefExportError $Cmdlet 'SpecSchemaFailure' 'The brief CLI output parsed to null — no TriadDeckExport emitted.' $Path; return $null }
    return $Deck
}

function ConvertTo-BriefLocalDeckExport {
    param($Deck)
    $trace = Get-BriefPropertyValue $Deck 'traceCoveragePct'
    $warnings = Get-BriefPropertyValue $Deck 'warnings'
    [TriadDeckExport]@{
        DebateId         = [string](Get-BriefPropertyValue $Deck 'debateId')
        Title            = [string](Get-BriefPropertyValue $Deck 'title')
        Preset           = [string](Get-BriefPropertyValue $Deck 'preset')
        Model            = [string](Get-BriefPropertyValue $Deck 'model')
        ModelSource      = [string](Get-BriefPropertyValue $Deck 'modelSource')
        CheckerModel     = [string](Get-BriefPropertyValue $Deck 'checkerModel')
        Path             = [string](Get-BriefPropertyValue $Deck 'path')
        SpecPath         = [string](Get-BriefPropertyValue $Deck 'specPath')
        ManifestPath     = [string](Get-BriefPropertyValue $Deck 'manifestPath')
        TraceCoveragePct = [double]$(if ($null -ne $trace) { $trace } else { 0.0 })
        Verdicts         = (ConvertTo-BriefVerdictTable (Get-BriefPropertyValue $Deck 'verdicts'))
        Warnings         = @($(if ($warnings) { $warnings } else { @() }))
    }
}

function Invoke-BriefLocalExport {
    # Local mode end to end: guards → CLI → parse → [TriadDeckExport]. Returns the export, or $null.
    param($Cmdlet, [string]$Path, [string]$Preset, [string]$Model, [string]$CheckerModel, [bool]$SkipNarration,
        [string]$OutputDirectory, [bool]$AllowOpenDebate, [bool]$Force)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Write-BriefExportError $Cmdlet 'DebateFileInvalid' "Debate file not found: $Path" $Path; return $null
    }
    if (-not $SkipNarration -and -not $Model) {
        Write-BriefExportError $Cmdlet 'ModelUnavailable' 'Local mode requires -Model unless -SkipNarration (no global model to inherit offline).' $Path; return $null
    }
    $ResolvedPath = (Resolve-Path -LiteralPath $Path).Path
    $OutDir = Resolve-BriefLocalOutputDirectory -ResolvedPath $ResolvedPath -OutputDirectory $OutputDirectory
    if (Test-BriefOutputDirectoryBusy -OutDir $OutDir -Force $Force) {
        Write-BriefExportError $Cmdlet 'RenderFailure' "Output directory is not empty: $OutDir — use -Force to overwrite." $OutDir; return $null
    }

    # The CLI REQUIRES --model on every run (it records the model field even in deterministic mode);
    # -SkipNarration is additive, NOT a replacement for it. Under skip without a model, record the sentinel
    # 'deterministic' — the CLI accepts it and never calls a model (t/2874).
    $resolvedModel = if ($Model) { $Model } elseif ($SkipNarration) { 'deterministic' } else { $Model }
    Write-Verbose "Local mode: debate '$ResolvedPath'"
    Write-Verbose "  Preset=$Preset, model=$resolvedModel$(if ($CheckerModel) { ", checker=$CheckerModel" })$(if ($AllowOpenDebate) { ', allow-open snapshot' }). Output → $OutDir"
    if (-not $Cmdlet.ShouldProcess($ResolvedPath, "export brief (preset=$Preset, model=$resolvedModel) → $OutDir")) { return $null }

    # Resolve the t/2837 CLI invocation. Returns @{ Exe; ArgPrefix } so the
    # tsx-vs-compiled-bin entrypoint decision is abstracted to one place.
    $Inv = Resolve-BriefExportCli
    Write-Verbose "  CLI: $($Inv.Exe) $($Inv.ArgPrefix -join ' ')"
    $CliArgs = Get-BriefCliArgumentList -ResolvedPath $ResolvedPath -Preset $Preset -OutDir $OutDir -Model $resolvedModel `
        -SkipNarration $SkipNarration -CheckerModel $CheckerModel -AllowOpenDebate $AllowOpenDebate
    $Run = Invoke-BriefCli -Exe $Inv.Exe -AllArgs (@($Inv.ArgPrefix) + $CliArgs) -Path $Path
    Write-Verbose "  Pipeline finished (exit code $($Run.Exit))."

    # Stream WARN: lines (proposed output contract, t/2806#6 — pending Shared Lib confirm).
    foreach ($Line in @(($Run.Stderr -split "`n"))) {
        if ($Line -match '^\s*WARN:\s*(.+)$') { Write-Warning $Matches[1].Trim() }
    }
    if ($Run.Exit -ne 0) {
        $e = Get-BriefCliError -Stderr $Run.Stderr -Exit $Run.Exit
        Write-BriefExportError $Cmdlet $e.Id $e.Message $Path; return $null
    }
    $Deck = Read-BriefCliDeck -Cmdlet $Cmdlet -Stdout $Run.Stdout -Path $Path
    if ($null -eq $Deck) { return $null }
    $Export = ConvertTo-BriefLocalDeckExport -Deck $Deck
    Write-BriefExportSummary 'local' $Export
    return $Export
}
