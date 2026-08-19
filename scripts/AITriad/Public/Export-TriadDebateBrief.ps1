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
          - SERVER (-DebateId): REST client of the T6 export API. DEFERRED — the billable
            export endpoint 403s anonymous and needs an AAD bearer token, gated on DevOps
            enabling AAD Easy Auth (t/2839) + an entitlement policy (t/2814/t/2831). The
            flow is designed (t/2806#3) and lands when those clear; today it errors with
            that guidance.

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
        (Local) Output DIRECTORY for the artifacts (brief.pptx, deck_spec.json,
        narration.json, audit-manifest.json). Default: a "<debate>-brief" folder
        beside the debate JSON. Alias -OutDir / -OutputPath.
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

        [Parameter(ParameterSetName = 'Local')]
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
        $script:ExportErrorCategory = @{
            DebateNotFound    = 'ObjectNotFound';    DebateNotClosed = 'InvalidOperation'
            AuthFailure       = 'PermissionDenied';  ModelUnavailable = 'ResourceUnavailable'
            SpecSchemaFailure = 'InvalidData';       TraceGateFailure = 'InvalidData'
            SymmetryFailure   = 'InvalidData';       PptxLintFailure  = 'InvalidData'
            RenderFailure     = 'InvalidData';       DebateFileInvalid = 'InvalidData'
        }
        $WriteExportError = {
            param([string]$Id, [string]$Message, $TargetObject)
            $cat = if ($ExportErrorCategory.ContainsKey($Id)) { $ExportErrorCategory[$Id] } else { 'NotSpecified' }
            $rec = [System.Management.Automation.ErrorRecord]::new(
                [System.Exception]::new($Message), $Id,
                [System.Management.Automation.ErrorCategory]$cat, $TargetObject)
            $PSCmdlet.WriteError($rec)   # non-terminating; honors -ErrorAction Stop
        }
    }

    process {
        # ── Server mode: deferred pending AAD auth infra (t/2839) + policy ──────────
        if ($PSCmdlet.ParameterSetName -eq 'Server') {
            throw (New-ActionableError `
                    -Goal     "Export debate '$DebateId' via the server" `
                    -Problem  'Server-mode export is not yet available: the billable endpoint 403s anonymous and requires an AAD bearer token, gated on DevOps enabling AAD Easy Auth (t/2839) and an entitlement policy (t/2814/t/2831).' `
                    -Location 'Export-TriadDebateBrief' `
                    -NextSteps @(
                        'Use local mode: Export-TriadDebateBrief -Path <exported debate JSON> ...',
                        'Track t/2839 (AAD Easy Auth) for server-mode auth'
                    ))
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
        if (-not $PSCmdlet.ShouldProcess($ResolvedPath, "export brief (preset=$Preset, model=$resolvedModel) → $OutDir")) { return }

        # Resolve the t/2837 CLI invocation. Returns @{ Exe; ArgPrefix } so the
        # tsx-vs-compiled-bin entrypoint decision is abstracted to one place.
        $Inv = Resolve-BriefExportCli

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

        Write-Verbose "Exported brief: $($Export.Path)"
        if ($PassThru) { $Export }
    }
}
