# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Export-TriadDebateBrief {
    <#
    .SYNOPSIS
        Export a closed Triad debate to a presentation brief (Brief Export T8, spec §8).
    .DESCRIPTION
        Two modes:
          - LOCAL (-Path): runs the brief pipeline OFFLINE against an exported debate JSON
            via the shared lib/brief full-pipeline CLI (t/2837). No server, no auth, no
            billing — the CI/offline path. -Model is required unless -SkipNarration.
          - SERVER (-DebateId): REST client of the T6 export API (t/2862). Creates an async
            export job, polls it (Write-Progress from the job's progressPct; streams job
            warnings), then downloads the artifacts (deck_spec.json, narration.json,
            audit-manifest.json, brief.pptx) to -OutputDirectory and builds a
            [TriadDeckExport] from the manifest + deck_spec. Billable + sign-in-gated: pass
            an AAD bearer token via -AccessToken (never spoofs identity). Model resolution
            is SERVER-side — the client sends the label, never guesses. PDF is Electron-only,
            so server mode never requests it.

        Emits the artifact path as verbose; -PassThru returns a [TriadDeckExport] (field
        parity with lib/brief/types.ts). Per-item errors are NON-TERMINATING (a pipeline of
        many debates survives one failure); -ErrorAction Stop behaves normally. Error ids
        are the frozen ExportErrorCode taxonomy shared with T6/T7.
    .PARAMETER Path
        (Local) Path to an exported debate JSON. Binds `FullName` from the pipeline.
    .PARAMETER DebateId
        (Server) Debate id. Binds Id/DebateId from `Get-TriadDebate -Phase Closed | ...`.
    .PARAMETER Preset
        policymaker (default) | conference | classroom.
    .PARAMETER Model
        Narrator model. Local mode: required unless -SkipNarration.
    .PARAMETER CheckerModel
        Optional fact-check model.
    .PARAMETER SkipNarration
        Deterministic brief with zero model calls.
    .PARAMETER OutputDirectory
        Output DIRECTORY for the artifacts (brief.pptx, deck_spec.json, narration.json,
        audit-manifest.json). Local default: a "<debate>-brief" folder beside the debate
        JSON. Server default: a "<debateId>-brief" folder in the current directory.
        Alias -OutDir / -OutputPath.
    .PARAMETER AllowOpenDebate
        (Local) Export a not-yet-closed debate as a watermarked snapshot
        (meta.snapshot). Without it, a non-closed debate fails with DebateNotClosed.
    .PARAMETER AccessToken
        (Server) AAD bearer token → `Authorization: Bearer`. The cmdlet never spoofs
        identity or sets principal headers. Alias -Token.
    .PARAMETER BaseUrl
        (Server) deployed base URL. Default: Get-TaxEditorBaseUrl.
    .PARAMETER Force
        Overwrite existing output files. NEVER bypasses the verify/lint gates.
    .PARAMETER PassThru
        Emit the [TriadDeckExport] object.
    .PARAMETER TimeoutSec
        Pipeline timeout. Default 300.
    .OUTPUTS
        [TriadDeckExport] (with -PassThru).
    .EXAMPLE
        Export-TriadDebateBrief -Path .\debate-abc.json -Model gemini-3.5-flash-lite -Preset conference
    .EXAMPLE
        Get-ChildItem *.json | Export-TriadDebateBrief -SkipNarration -PassThru
    .EXAMPLE
        # Server mode: authenticated headless export via the T6 REST API.
        $tok = az account get-access-token --query accessToken -o tsv
        Get-TriadDebate -Phase Closed | Export-TriadDebateBrief -AccessToken $tok -Preset conference -OutputDirectory .\out -PassThru
    .LINK
        Show-AITriadHelp
    .LINK
        Get-AITDebate
    #>
    [CmdletBinding(DefaultParameterSetName = 'Local', SupportsShouldProcess, ConfirmImpact = 'Medium')]
    # String form: module-scope classes aren't resolvable in a per-file-parsed
    # [OutputType([...])] attribute (see Test-TaxEditorHealth). The body still emits
    # a real [TriadDeckExport], resolved at runtime in module scope.
    [OutputType('TriadDeckExport')]
    param(
        [Parameter(Mandatory, ParameterSetName = 'Local', ValueFromPipeline, ValueFromPipelineByPropertyName, Position = 0)]
        [Alias('FullName')]
        [string]$Path,

        [Parameter(Mandatory, ParameterSetName = 'Server', ValueFromPipelineByPropertyName)]
        [Alias('Id')]
        [string]$DebateId,

        [Parameter()]
        [ValidateSet('policymaker', 'conference', 'classroom')]
        [string]$Preset = 'policymaker',

        [Parameter()]
        [string]$Model,

        [Parameter()]
        [string]$CheckerModel,

        [Parameter()]
        [switch]$SkipNarration,

        [Parameter()]
        [Alias('OutDir', 'OutputPath')]
        [string]$OutputDirectory,

        [Parameter(ParameterSetName = 'Local')]
        [switch]$AllowOpenDebate,

        [Parameter(ParameterSetName = 'Server')]
        [Alias('Token')]
        [string]$AccessToken,

        [Parameter(ParameterSetName = 'Server')]
        [string]$BaseUrl,

        [Parameter()]
        [switch]$Force,

        [Parameter()]
        [switch]$PassThru,

        [Parameter()]
        [ValidateRange(1, 3600)]
        [int]$TimeoutSec = 300
    )

    begin {
        Set-StrictMode -Version Latest

        # ExportErrorCode (lib/brief/types.ts) + local DebateFileInvalid → PS category.
        # Server mode adds two HTTP-level ids (429 quota/concurrency) that aren't job
        # errorCodes but need a clean surface.
        $script:ExportErrorCategory = @{
            DebateNotFound    = 'ObjectNotFound';    DebateNotClosed = 'InvalidOperation'
            AuthFailure       = 'PermissionDenied';  ModelUnavailable = 'ResourceUnavailable'
            SpecSchemaFailure = 'InvalidData';       TraceGateFailure = 'InvalidData'
            SymmetryFailure   = 'InvalidData';       PptxLintFailure  = 'InvalidData'
            RenderFailure     = 'InvalidData';       DebateFileInvalid = 'InvalidData'
            ExportQuotaExceeded    = 'QuotaExceeded'; ExportConcurrencyLimit = 'ResourceBusy'
        }
        $WriteExportError = {
            param([string]$Id, [string]$Message, $TargetObject)
            $cat = if ($ExportErrorCategory.ContainsKey($Id)) { $ExportErrorCategory[$Id] } else { 'NotSpecified' }
            $rec = [System.Management.Automation.ErrorRecord]::new(
                [System.Exception]::new($Message), $Id,
                [System.Management.Automation.ErrorCategory]$cat, $TargetObject)
            $PSCmdlet.WriteError($rec)   # non-terminating; honors -ErrorAction Stop
        }

        # Shared end-of-export verbose summary (both modes). Keeps the -Verbose trace's
        # closing report identical for local + server so the two paths read the same.
        $WriteExportSummary = {
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
    }

    process {
        # ── Server mode: T6 REST client (t/2862) ────────────────────────────────────
        if ($PSCmdlet.ParameterSetName -eq 'Server') {
            $resolvedBase = if ($BaseUrl) { $BaseUrl.TrimEnd('/') } else { Get-TaxEditorBaseUrl }
            Write-Verbose "Server mode: exporting debate '$DebateId' via $resolvedBase (auth: $(if ($AccessToken) { 'bearer token' } else { 'none — anonymous' }))."
            # AAD bearer only. NEVER set x-ms-client-principal / spoof identity — Easy Auth
            # strips client-set principal headers in prod, and a bypass defeats the billable gate.
            $headers = @{}
            if ($AccessToken) { $headers['Authorization'] = "Bearer $AccessToken" }

            # Map an Invoke-RemoteCheck failure → { Id; Message } on the export taxonomy.
            $MapHttp = {
                param($Res, [string]$What)
                $status = [int]$Res.StatusCode
                $bodyErr = $null; $bodyMsg = $null
                if ($Res.Body) {
                    if ($Res.Body.PSObject.Properties['error'])   { $bodyErr = [string]$Res.Body.error }
                    if ($Res.Body.PSObject.Properties['message']) { $bodyMsg = [string]$Res.Body.message }
                }
                $msg = if ($bodyMsg) { $bodyMsg } elseif ($Res.Error) { [string]$Res.Error } else { "$What failed (HTTP $status)." }
                $id = switch ($status) {
                    401 { 'AuthFailure' }
                    403 { 'AuthFailure' }
                    404 { 'DebateNotFound' }
                    409 { 'DebateNotClosed' }
                    400 { 'ModelUnavailable' }
                    429 { if ($bodyErr -eq 'concurrency_limit') { 'ExportConcurrencyLimit' } else { 'ExportQuotaExceeded' } }
                    default { 'RenderFailure' }
                }
                @{ Id = $id; Message = $msg }
            }

            $resolvedModel = if ($SkipNarration) { '(none — narration skipped)' }
                             elseif ($Model)     { $Model }
                             else                { '(server-resolved free tier)' }
            if (-not $PSCmdlet.ShouldProcess("debate '$DebateId'", "export brief (preset=$Preset, model=$resolvedModel) via $resolvedBase")) { return }

            # 1. Create the async export job (idempotent server-side).
            $postBody = @{ preset = $Preset }
            if ($SkipNarration) { $postBody['skipNarration'] = $true }
            if ($Model)         { $postBody['model'] = $Model }
            if ($CheckerModel)  { $postBody['checkerModel'] = $CheckerModel }
            $post = Invoke-RemoteCheck -BaseUrl $resolvedBase -Path "/api/debates/$DebateId/exports" `
                -Method POST -Body $postBody -ExtraHeaders $headers -AcceptableStatusCodes @(202) `
                -TimeoutSec $TimeoutSec -ExpectJson
            if (-not $post.Success) { $m = & $MapHttp $post 'Create export job'; & $WriteExportError $m.Id $m.Message $DebateId; return }
            if (-not ($post.Body -and $post.Body.PSObject.Properties['jobId'] -and $post.Body.jobId)) {
                & $WriteExportError 'RenderFailure' 'Export job creation returned no jobId (unexpected 202 body).' $DebateId; return
            }
            $jobId = [string]$post.Body.jobId
            Write-Verbose "Created async export job '$jobId' (preset=$Preset, model=$resolvedModel$(if ($CheckerModel) { ", checker=$CheckerModel" })). Polling every 2s (timeout ${TimeoutSec}s)."

            # 2. Poll the job to completion. Write-Progress from progressPct; stream new warnings.
            $progressId = 2862
            $streamed = [System.Collections.Generic.HashSet[string]]::new()
            $deadline = (Get-Date).AddSeconds($TimeoutSec)
            $exportId = $null
            $lastStatus = $null
            try {
                while ($true) {
                    $poll = Invoke-RemoteCheck -BaseUrl $resolvedBase -Path "/api/export-jobs/$jobId" `
                        -Method GET -ExtraHeaders $headers -AcceptableStatusCodes @(200) -TimeoutSec $TimeoutSec -ExpectJson
                    if (-not $poll.Success) { $m = & $MapHttp $poll 'Poll export job'; & $WriteExportError $m.Id $m.Message $DebateId; return }
                    $job = $poll.Body
                    $jobStatus = [string]$job.status
                    $pct = if ($job.PSObject.Properties['progressPct'] -and $null -ne $job.progressPct) { [int]$job.progressPct } else { 0 }
                    # Log only on status change to keep the -Verbose trace readable across many polls.
                    if ($jobStatus -ne $lastStatus) {
                        Write-Verbose "  job '$jobId': $jobStatus ($pct%)"
                        $lastStatus = $jobStatus
                    }
                    Write-Progress -Id $progressId -Activity "Exporting brief: $DebateId" -Status $jobStatus -PercentComplete ([Math]::Max(0, [Math]::Min(100, $pct)))
                    if ($job.PSObject.Properties['warnings'] -and $job.warnings) {
                        foreach ($w in @($job.warnings)) { if ($streamed.Add([string]$w)) { Write-Warning ([string]$w) } }
                    }
                    if ($jobStatus -eq 'done') { $exportId = [string]$job.exportId; break }
                    if ($jobStatus -eq 'failed') {
                        $eid = if ($job.PSObject.Properties['errorCode'] -and $job.errorCode) { [string]$job.errorCode } else { 'RenderFailure' }
                        $emsg = if ($job.PSObject.Properties['error'] -and $job.error) { [string]$job.error } else { 'Export job failed.' }
                        & $WriteExportError $eid $emsg $DebateId; return
                    }
                    if ((Get-Date) -gt $deadline) {
                        & $WriteExportError 'RenderFailure' "Export job '$jobId' did not finish within $TimeoutSec s (last status: $jobStatus)." $DebateId; return
                    }
                    Start-Sleep -Seconds 2
                }
            }
            finally { Write-Progress -Id $progressId -Activity "Exporting brief: $DebateId" -Completed }

            # 3. Download the artifacts to the output directory (skip brief.html — Electron-only).
            $OutDir = if ($OutputDirectory) { $OutputDirectory } else { Join-Path (Get-Location).Path "$DebateId-brief" }
            if ((Test-Path -LiteralPath $OutDir) -and
                @(Get-ChildItem -LiteralPath $OutDir -Force -ErrorAction SilentlyContinue).Count -gt 0 -and -not $Force) {
                & $WriteExportError 'RenderFailure' "Output directory is not empty: $OutDir — use -Force to overwrite." $OutDir; return
            }
            $null = New-Item -ItemType Directory -Path $OutDir -Force
            Write-Verbose "Job done (exportId '$exportId'). Downloading 4 artifacts → $OutDir"
            $paths = @{}
            foreach ($name in @('deck_spec.json', 'narration.json', 'audit-manifest.json', 'brief.pptx')) {
                $dest = Join-Path $OutDir $name
                try {
                    Save-BriefArtifact -BaseUrl $resolvedBase -ExportId $exportId -Name $name -Destination $dest -Headers $headers -TimeoutSec $TimeoutSec
                    $paths[$name] = $dest
                    $sizeKb = if (Test-Path -LiteralPath $dest) { '{0:N1} KB' -f ((Get-Item -LiteralPath $dest).Length / 1KB) } else { '?' }
                    Write-Verbose "  ↓ $name ($sizeKb)"
                }
                catch { & $WriteExportError 'RenderFailure' "Failed to download artifact '$name': $($_.Exception.Message)" $DebateId; return }
            }

            # 4. Build [TriadDeckExport] from the downloaded manifest + deck_spec.
            $manifest = $null; $spec = $null
            try { $manifest = Get-Content -Raw -LiteralPath $paths['audit-manifest.json'] | ConvertFrom-Json } catch { }
            try { $spec     = Get-Content -Raw -LiteralPath $paths['deck_spec.json']     | ConvertFrom-Json } catch { }
            $mget = { param($o, [string]$n) if ($o -and $o.PSObject.Properties[$n]) { $o.$n } else { $null } }
            $verdicts = @{}
            $vc = & $mget $manifest 'verdict_counts'
            if ($vc) { foreach ($p in $vc.PSObject.Properties) { $verdicts[$p.Name] = [int]$p.Value } }
            $mWarnings = @(& $mget $manifest 'warnings'); if (-not $mWarnings) { $mWarnings = @($streamed) }

            $Export = [TriadDeckExport]@{
                DebateId         = [string](& { $v = & $mget $manifest 'debate_id'; if ($v) { $v } else { $DebateId } })
                Title            = [string](& $mget $spec 'title')
                Preset           = $Preset
                Model            = [string](& $mget $manifest 'narrator_model')
                ModelSource      = [string](& $mget $manifest 'narrator_model_source')
                CheckerModel     = [string](& $mget $manifest 'checker_model')
                Path             = [string]$paths['brief.pptx']
                SpecPath         = [string]$paths['deck_spec.json']
                ManifestPath     = [string]$paths['audit-manifest.json']
                TraceCoveragePct = [double](& { $v = & $mget $manifest 'trace_coverage_pct'; if ($null -ne $v) { $v } else { 0.0 } })
                Verdicts         = $verdicts
                Warnings         = @($mWarnings)
            }
            & $WriteExportSummary 'server' $Export
            if ($PassThru) { $Export }
            return
        }

        # ── Local mode (t/2837 full-pipeline CLI) ───────────────────────────────────
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
            & $WriteExportError 'DebateFileInvalid' "Debate file not found: $Path" $Path; return
        }
        if (-not $SkipNarration -and -not $Model) {
            & $WriteExportError 'ModelUnavailable' 'Local mode requires -Model unless -SkipNarration (no global model to inherit offline).' $Path; return
        }

        # --out is a DIRECTORY: the CLI writes brief.pptx + deck_spec.json +
        # narration.json + audit-manifest.json under it (paths come back in the
        # TriadDeckExport). Default: a "<debate>-brief" dir beside the debate JSON.
        $ResolvedPath = (Resolve-Path -LiteralPath $Path).Path
        $OutDir = if ($OutputDirectory) {
            $OutputDirectory
        }
        else {
            $base = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedPath)
            Join-Path (Split-Path -Parent $ResolvedPath) "$base-brief"
        }
        if ((Test-Path -LiteralPath $OutDir) -and
            @(Get-ChildItem -LiteralPath $OutDir -Force -ErrorAction SilentlyContinue).Count -gt 0 -and
            -not $Force) {
            & $WriteExportError 'RenderFailure' "Output directory is not empty: $OutDir — use -Force to overwrite." $OutDir; return
        }

        $resolvedModel = if ($SkipNarration) { '(none — narration skipped)' } else { $Model }
        Write-Verbose "Local mode: debate '$ResolvedPath'"
        Write-Verbose "  Preset=$Preset, model=$resolvedModel$(if ($CheckerModel) { ", checker=$CheckerModel" })$(if ($AllowOpenDebate) { ', allow-open snapshot' }). Output → $OutDir"
        if (-not $PSCmdlet.ShouldProcess($ResolvedPath, "export brief (preset=$Preset, model=$resolvedModel) → $OutDir")) { return }

        # Resolve the t/2837 CLI invocation. Returns @{ Exe; ArgPrefix } so the
        # tsx-vs-compiled-bin entrypoint decision is abstracted to one place.
        $Inv = Resolve-BriefExportCli
        Write-Verbose "  CLI: $($Inv.Exe) $($Inv.ArgPrefix -join ' ')"

        # Frozen CLI flags (lib/brief/cli.ts): --path/--model/--preset/--out (dir),
        # optional --skip-narration/--checker-model/--allow-open.
        $CliArgs = @('--path', $ResolvedPath, '--preset', $Preset, '--out', $OutDir)
        if ($SkipNarration)   { $CliArgs += '--skip-narration' } else { $CliArgs += @('--model', $Model) }
        if ($CheckerModel)    { $CliArgs += @('--checker-model', $CheckerModel) }
        if ($AllowOpenDebate) { $CliArgs += '--allow-open' }
        $AllArgs = @($Inv.ArgPrefix) + $CliArgs

        $progressId = 2806
        Write-Progress -Id $progressId -Activity "Exporting brief: $([System.IO.Path]::GetFileName($Path))" -Status 'Running pipeline' -PercentComplete 10
        $StderrFile = [System.IO.Path]::GetTempFileName()
        try {
            $Stdout = & $Inv.Exe @AllArgs 2> $StderrFile
            $Exit = $LASTEXITCODE
            $Stderr = if (Test-Path $StderrFile) { Get-Content -Raw -Path $StderrFile } else { '' }
        }
        finally {
            Remove-Item -Path $StderrFile -Force -ErrorAction SilentlyContinue
            Write-Progress -Id $progressId -Activity "Exporting brief: $([System.IO.Path]::GetFileName($Path))" -Completed
        }
        Write-Verbose "  Pipeline finished (exit code $Exit)."

        # Stream WARN: lines (proposed output contract, t/2806#6 — pending Shared Lib confirm).
        foreach ($Line in @(($Stderr -split "`n"))) {
            if ($Line -match '^\s*WARN:\s*(.+)$') { Write-Warning $Matches[1].Trim() }
        }

        if ($Exit -ne 0) {
            $ErrObj = $null
            try {
                $ErrLine = @(($Stderr -split "`n") | Where-Object { $_ -match '"errorCode"' }) | Select-Object -First 1
                if ($ErrLine) { $ErrObj = $ErrLine | ConvertFrom-Json }
            } catch { }
            $Id  = if ($ErrObj -and $ErrObj.PSObject.Properties['errorCode']) { [string]$ErrObj.errorCode } else { 'RenderFailure' }
            $Msg = if ($ErrObj -and $ErrObj.PSObject.Properties['message'])   { [string]$ErrObj.message }   else { "brief CLI exited with code $Exit" }
            & $WriteExportError $Id $Msg $Path; return
        }

        $Deck = $null
        try { $Deck = @($Stdout) -join "`n" | ConvertFrom-Json }
        catch { & $WriteExportError 'SpecSchemaFailure' 'Could not parse the brief CLI output as TriadDeckExport JSON.' $Path; return }

        $get = { param($n) if ($Deck -and $Deck.PSObject.Properties[$n]) { $Deck.$n } else { $null } }
        $verdicts = @{}
        $rawVerdicts = & $get 'verdicts'
        if ($rawVerdicts) { foreach ($p in $rawVerdicts.PSObject.Properties) { $verdicts[$p.Name] = [int]$p.Value } }

        $Export = [TriadDeckExport]@{
            DebateId         = [string](& $get 'debateId')
            Title            = [string](& $get 'title')
            Preset           = [string](& $get 'preset')
            Model            = [string](& $get 'model')
            ModelSource      = [string](& $get 'modelSource')
            CheckerModel     = [string](& $get 'checkerModel')
            Path             = [string](& $get 'path')
            SpecPath         = [string](& $get 'specPath')
            ManifestPath     = [string](& $get 'manifestPath')
            TraceCoveragePct = [double](& { $v = & $get 'traceCoveragePct'; if ($null -ne $v) { $v } else { 0.0 } })
            Verdicts         = $verdicts
            Warnings         = @(& { $w = & $get 'warnings'; if ($w) { $w } else { @() } })
        }

        & $WriteExportSummary 'local' $Export
        if ($PassThru) { $Export }
    }
}
