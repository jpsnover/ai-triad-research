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
    }

    process {
        # The two modes live in Private/ExportTriadDebateBriefSteps.ps1 (t/3910). Each writes its own
        # non-terminating errors through this cmdlet and returns the [TriadDeckExport], or $null on failure.
        $Export = if ($PSCmdlet.ParameterSetName -eq 'Server') {
            Invoke-BriefServerExport -Cmdlet $PSCmdlet -DebateId $DebateId -Preset $Preset -Model $Model -CheckerModel $CheckerModel `
                -SkipNarration $SkipNarration.IsPresent -OutputDirectory $OutputDirectory -AccessToken $AccessToken -BaseUrl $BaseUrl `
                -Force $Force.IsPresent -TimeoutSec $TimeoutSec
        }
        else {
            Invoke-BriefLocalExport -Cmdlet $PSCmdlet -Path $Path -Preset $Preset -Model $Model -CheckerModel $CheckerModel `
                -SkipNarration $SkipNarration.IsPresent -OutputDirectory $OutputDirectory -AllowOpenDebate $AllowOpenDebate.IsPresent `
                -Force $Force.IsPresent
        }
        if ($Export -and $PassThru) { $Export }
    }
}
