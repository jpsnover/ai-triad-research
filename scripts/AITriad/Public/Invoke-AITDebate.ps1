# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

<#
.SYNOPSIS
    Runs a structured multi-perspective AI debate using the shared debate library.
.DESCRIPTION
    Orchestrates a full debate with Prometheus (accelerationist), Sentinel (safetyist),
    and Cassandra (skeptic) POVers. Produces debate transcript, diagnostics, and harvest
    output files. Uses the same prompts, logic, and argumentation framework as the
    Taxonomy Editor's debate tool.
.EXAMPLE
    Invoke-AITDebate -Topic "Should the US impose AI licensing?" -Turns 3
.EXAMPLE
    Invoke-AITDebate -Topic "Scaling limits" -Name "Scaling Debate" -Rounds 4 -Model gemini-2.5-flash
.EXAMPLE
    Invoke-AITDebate -DocPath ../ai-triad-data/sources/my-doc/snapshot.md -Name "My Doc Debate"
.EXAMPLE
    Invoke-AITDebate -CrossCuttingNodeId sit-005 -Clarify -Probe
#>
function Invoke-AITDebate {
    [CmdletBinding(DefaultParameterSetName = 'Topic')]
    param(
        [Parameter(Mandatory, ParameterSetName = 'Topic', Position = 0)]
        [string]$Topic,

        [Parameter(Mandatory, ParameterSetName = 'Document')]
        [ValidateScript({ Test-Path $_ })]
        [Alias('DocumentPath')]
        [string]$DocPath,

        [Parameter(Mandatory, ParameterSetName = 'Url')]
        [string]$Url,

        [Parameter(Mandatory, ParameterSetName = 'CrossCutting')]
        [string]$CrossCuttingNodeId,

        [Parameter()]
        [string]$Name,

        [Parameter()]
        [ValidateSet('prometheus', 'sentinel', 'cassandra')]
        [string[]]$Debaters = @('prometheus', 'sentinel', 'cassandra'),

        [Parameter()]
        [ValidateScript({ Test-AIModelId $_ })]
        [ArgumentCompleter({ param($cmd, $param, $word) $script:ValidModelIds | Where-Object { $_ -like "$word*" } })]
        [string]$Model,

        [Parameter()]
        [ValidateRange(1, 20)]
        [int]$Rounds = 3,

        [Parameter()]
        [ValidateSet('brief', 'medium', 'detailed')]
        [string]$ResponseLength = 'medium',

        [Parameter()]
        [ValidateSet('structured', 'socratic', 'deliberation')]
        [string]$Protocol = 'structured',

        [Parameter()]
        [switch]$Clarify,

        [Parameter()]
        [switch]$Probe,

        [Parameter()]
        [int]$ProbeEvery = 2,

        [Parameter()]
        [string]$OutputDirectory,

        [Parameter()]
        [ValidateSet('json', 'markdown')]
        [string]$OutputFormat = 'json',

        [Parameter()]
        [string]$ApiKey,

        [Parameter()]
        [double]$Temperature = 0.3
    )

    Set-StrictMode -Version Latest

    # ── Validate prerequisites ────────────────────────────
    if ($Debaters.Count -lt 2) {
        throw "At least 2 debaters are required. Got: $($Debaters -join ', ')"
    }

    # Verify npx is available (prefer .cmd on Windows — .ps1 can't be launched via Process.Start)
    $NpxCmd = Get-Command npx.cmd -ErrorAction SilentlyContinue
    if (-not $NpxCmd) { $NpxCmd = Get-Command npx -ErrorAction SilentlyContinue }
    if (-not $NpxCmd) {
        throw @"
npx (Node.js package runner) is not installed.
Required to run the debate CLI engine.
Install Node.js from https://nodejs.org (v18+), then verify: npx --version
"@
    }

    # Resolve model
    if ($Model) { $ResolvedModel = $Model }
    elseif ($env:AI_MODEL) { $ResolvedModel = $env:AI_MODEL }
    else { $ResolvedModel = 'gemini-2.5-flash' }

    # ── Resolve output directory ──────────────────────────
    if (-not $OutputDirectory) {
        try {
            $DebatesDir = Get-DebatesDir
            $OutputDirectory = Join-Path $DebatesDir 'cli-runs'
        } catch {
            $OutputDirectory = Join-Path $PWD 'debates'
        }
    }
    if (-not (Test-Path $OutputDirectory)) {
        try {
            $null = New-Item -Path $OutputDirectory -ItemType Directory -Force -ErrorAction Stop
        } catch {
            throw "Failed to create output directory '$OutputDirectory': $_`nCheck that the parent directory exists and you have write permissions."
        }
    }

    # ── Generate slug ─────────────────────────────────────
    $DebateTopic = switch ($PSCmdlet.ParameterSetName) {
        'Topic'        { $Topic }
        'Document'     { "Document debate: $(Split-Path $DocPath -Leaf)" }
        'Url'          { "URL debate: $Url" }
        'CrossCutting' { "Cross-cutting: $CrossCuttingNodeId" }
    }

    if ($Name) { $SlugSource = $Name } else { $SlugSource = $DebateTopic }
    $Slug = New-Slug -Text $SlugSource

    # ── Build config JSON ─────────────────────────────────
    $Config = @{
        activePovers       = $Debaters
        model              = $ResolvedModel
        rounds             = $Rounds
        responseLength     = $ResponseLength
        protocolId         = $Protocol
        enableClarification = [bool]$Clarify
        enableProbing      = [bool]$Probe
        probingInterval    = $ProbeEvery
        outputDir          = (Resolve-Path $OutputDirectory).Path
        outputFormat       = $OutputFormat
        slug               = $Slug
        temperature        = $Temperature
    }

    if ($Name) { $Config.name = $Name }

    switch ($PSCmdlet.ParameterSetName) {
        'Topic'        { $Config.topic = $Topic }
        'Document'     { $Config.docPath = (Resolve-Path $DocPath).Path }
        'Url'          { $Config.url = $Url }
        'CrossCutting' { $Config.crossCuttingId = $CrossCuttingNodeId }
    }

    if ($ApiKey) { $Config.apiKey = $ApiKey }

    # ── Write config temp file ────────────────────────────
    try {
        $ConfigPath = [System.IO.Path]::GetTempFileName()
        $Config | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigPath -Encoding UTF8 -ErrorAction Stop
    } catch {
        throw "Failed to write debate config to temp file: $_`nCheck that $([System.IO.Path]::GetTempPath()) is writable and has free space."
    }

    try {
        # ── Locate CLI ────────────────────────────────────
        $RepoRoot = Get-CodeRoot
        $CliPath  = Join-Path (Join-Path (Join-Path $RepoRoot 'lib') 'debate') 'cli.ts'

        if (-not (Test-Path $CliPath)) {
            throw @"
Debate CLI not found at: $CliPath

Expected repo structure: lib/debate/cli.ts
Computed repo root: $RepoRoot

This usually means: (1) repo not checked out correctly, (2) lib/debate was not built, or (3) running from a non-standard location.
Verify the file exists: Get-Item '$CliPath'
"@
        }

        Write-Verbose "Running debate CLI: npx tsx $CliPath --config $ConfigPath"
        Write-Verbose "Model: $ResolvedModel | Rounds: $Rounds | Debaters: $($Debaters -join ', ')"

        # ── Run the Node.js CLI ───────────────────────────
        $StdOut  = [System.Collections.Generic.List[string]]::new()
        $StdErr  = [System.Collections.Generic.List[string]]::new()

        $Psi = [System.Diagnostics.ProcessStartInfo]::new()
        $Psi.FileName = $NpxCmd.Source
        $Psi.Arguments = "tsx `"$CliPath`" --config `"$ConfigPath`""
        $Psi.WorkingDirectory = $RepoRoot
        $Psi.RedirectStandardOutput = $true
        $Psi.RedirectStandardError  = $true
        $Psi.UseShellExecute = $false
        $Psi.CreateNoWindow = $true

        try {
            $Proc = [System.Diagnostics.Process]::Start($Psi)
        } catch {
            throw "Failed to start debate CLI process (npx tsx): $_`nVerify Node.js is installed and npx is in your PATH: npx --version"
        }

        # Stream stderr for progress
        while (-not $Proc.StandardError.EndOfStream) {
            $Line = $Proc.StandardError.ReadLine()
            if ($Line) {
                $StdErr.Add($Line)
                Write-Host $Line -ForegroundColor DarkGray
            }
        }

        $StdOutText = $Proc.StandardOutput.ReadToEnd()

        # Wait with timeout (10 minutes max for a full debate)
        if (-not $Proc.WaitForExit(600000)) {
            try { $Proc.Kill() } catch { }
            throw @"
Debate CLI process timed out after 10 minutes.
This may indicate: the AI API is unresponsive, the model is overloaded, or the debate has too many rounds.
Try: reduce -Rounds, use a faster -Model, or check your API key and network connectivity.
Stderr output:
$($StdErr -join "`n" | Select-Object -Last 20)
"@
        }

        if ($StdOutText) { $StdOut.Add($StdOutText) }

        # ── Parse result ──────────────────────────────────
        $ResultJson = $StdOut -join "`n"

        if ($Proc.ExitCode -ne 0 -and -not $ResultJson) {
            throw @"
Debate CLI failed with exit code $($Proc.ExitCode).
Stderr:
$($StdErr -join "`n" | Select-Object -Last 20)

Troubleshooting:
  1. Check API key: ensure GEMINI_API_KEY (or ANTHROPIC_API_KEY/GROQ_API_KEY) is set
  2. Check model: verify '$ResolvedModel' is a valid model in ai-models.json
  3. Run with -Verbose for more detail
"@
        }

        if (-not $ResultJson) {
            throw @"
Debate CLI produced no output (exit code: $($Proc.ExitCode)).
Stderr:
$($StdErr -join "`n" | Select-Object -Last 20)

This usually means the CLI crashed before producing results. Run with -Verbose for debugging.
"@
        }

        try {
            $Result = $ResultJson | ConvertFrom-Json -ErrorAction Stop
        } catch {
            throw @"
Failed to parse debate CLI response as JSON: $_
First 300 chars of output: $($ResultJson.Substring(0, [Math]::Min(300, $ResultJson.Length)))

This usually means the CLI produced non-JSON output. Check stderr above for errors.
"@
        }

        if (-not $Result.success) {
            throw "Debate failed: $($Result.error)"
        }

        # ── Return structured result ──────────────────────
        [PSCustomObject]@{
            DebateId        = $Result.debateId
            Name            = $Result.name
            Slug            = $Result.slug
            Topic           = $Result.topic
            DebateFile      = $Result.files.debate
            TranscriptFile  = $Result.files.transcript
            DiagnosticsFile = $Result.files.diagnostics
            HarvestFile     = $Result.files.harvest
            MarkdownFile    = $Result.files.markdown
            Rounds          = $Result.stats.rounds
            Entries         = $Result.stats.entries
            ApiCalls        = $Result.stats.apiCalls
            TotalTimeMs     = $Result.stats.totalTimeMs
            ClaimsAccepted  = $Result.stats.claimsAccepted
            ClaimsRejected  = $Result.stats.claimsRejected
            Success         = $true
        }
    }
    finally {
        Remove-Item -Path $ConfigPath -ErrorAction SilentlyContinue
    }
}
