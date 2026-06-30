# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-AnonymousDebateFlow {
    <#
    .SYNOPSIS
        End-to-end smoke test of the anonymous user journey against a deployed
        Taxonomy Editor.
    .DESCRIPTION
        Exercises the seven API steps an anonymous (free-tier) user touches when
        running a debate end-to-end:

          1. POST /api/auth/anonymous              — create session
          2. POST /api/ai/generate                 — small prompt
          3. POST /api/embeddings/compute          — short text
          4. PUT  /api/debates/{id}                — minimal debate JSON
          5. POST /api/flight-recorder/server-dump — trigger dump
          6. GET  /api/flight-recorder/download-merged/{dumpId} — download
          7. POST /api/embeddings/query            — semantic search (t/1171)

        Steps 2-7 share the session cookie issued by step 1. Step 6 uses the
        dumpId returned from step 5 (falls back to a sentinel if absent so
        the request still exercises the endpoint).

        This is the regression net for the cluster of production bugs from
        2026-06-26 (t/1060 ENOENT on session store, t/1061 budget exhaustion,
        t/1062 anonymous 403 on embeddings, t/1064 admin-only flight recorder
        gate). All five would have been caught by a single run of this cmdlet.
    .PARAMETER BaseUrl
        Target server URL. Defaults to the current production URL.
    .PARAMETER Detailed
        Print per-step timing + response body snippets to host (in addition to
        the structured table result).
    .PARAMETER StopOnFailure
        Halt at the first failing step. Default is to run all six and report.
    .PARAMETER TimeoutSec
        Per-request HTTP timeout (1-120, default 30 — AI generate can be slow).
    .EXAMPLE
        Test-AnonymousDebateFlow
    .EXAMPLE
        Test-AnonymousDebateFlow -BaseUrl https://staging.example.com -Detailed
    .EXAMPLE
        Test-AnonymousDebateFlow -StopOnFailure | Where-Object { -not $_.Pass }
    #>
    [CmdletBinding()]
    [OutputType([AnonymousFlowStepResult[]])]
    param(
        [Parameter(Position = 0)]
        [string]$BaseUrl = 'https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io',

        [switch]$Detailed,

        [switch]$StopOnFailure,

        [ValidateRange(1, 120)]
        [int]$TimeoutSec = 30
    )

    Set-StrictMode -Version Latest

    $BaseUrl = $BaseUrl.TrimEnd('/')
    $Session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $TotalSw = [System.Diagnostics.Stopwatch]::StartNew()

    # Step descriptors (Method, Path, Body, AcceptableStatusCodes, Description, BugTags)
    # Path is built lazily because steps 4 + 6 depend on prior step output.
    $DebateId = [guid]::NewGuid().ToString()
    $StepDefs = @(
        @{ Step = 1; Method = 'POST'; Path = '/api/auth/anonymous';
           Body = @{};
           OkCodes = @(200, 201);
           Desc = 'Create anonymous session';
           BugTags = 't/1060'
           PostHook = $null }
        @{ Step = 2; Method = 'POST'; Path = '/api/ai/generate';
           Body = @{ prompt = 'Reply with the word OK.'; model = 'gemini-3.1-flash-lite'; maxTokens = 8 };
           OkCodes = @(200);
           Desc = 'AI generate (free tier)';
           BugTags = 't/1061 t/1062'
           PostHook = $null }
        @{ Step = 3; Method = 'POST'; Path = '/api/embeddings/compute';
           Body = @{ texts = @('smoke test') };
           OkCodes = @(200);
           Desc = 'Embeddings compute (anon)';
           BugTags = 't/1062'
           PostHook = $null }
        @{ Step = 4; Method = 'PUT'; Path = "/api/debates/$DebateId";
           Body = @{ id = $DebateId; title = 'smoke-anon'; transcript = @() };
           OkCodes = @(200, 201, 204);
           Desc = 'Save debate (session-backed)';
           BugTags = 't/1060'
           PostHook = $null }
        @{ Step = 5; Method = 'POST'; Path = '/api/flight-recorder/server-dump';
           Body = @{ reason = 'Test-AnonymousDebateFlow smoke' };
           OkCodes = @(200, 201, 202);
           Desc = 'Trigger flight-recorder dump';
           BugTags = 't/1064'
           PostHook = {
               param($Body)
               if ($Body -and $Body.PSObject.Properties['dumpId']) { return $Body.dumpId }
               if ($Body -and $Body.PSObject.Properties['id'])     { return $Body.id }
               return $null
           } }
        @{ Step = 6; Method = 'GET'; Path = $null;  # filled in below from step 5's dumpId
           Body = $null;
           OkCodes = @(200);
           Desc = 'Download merged dump';
           BugTags = 't/1064'
           PostHook = $null }
        @{ Step = 7; Method = 'POST'; Path = '/api/embeddings/query';
           Body = @{ text = 'free-tier semantic search smoke' };
           OkCodes = @(200);
           Desc = 'Embeddings query (anon, semantic search)';
           BugTags = 't/1171'
           PostHook = $null }
    )

    $Results = [System.Collections.Generic.List[AnonymousFlowStepResult]]::new()
    $DumpId = $null

    foreach ($Def in $StepDefs) {
        # Late-bind step 6's path from step 5's dumpId
        if ($Def.Step -eq 6) {
            $Def.Path = "/api/flight-recorder/download-merged/$(if ($DumpId) { $DumpId } else { 'unknown' })"
        }

        Write-Verbose "[$($Def.Step)/7] $($Def.Desc) → $($Def.Method) $($Def.Path)"

        $Params = @{
            BaseUrl               = $BaseUrl
            Path                  = $Def.Path
            Method                = $Def.Method
            TimeoutSec            = $TimeoutSec
            AcceptableStatusCodes = $Def.OkCodes
            Session               = $Session
        }
        if ($null -ne $Def.Body) { $Params.Body = $Def.Body }

        $Check = Invoke-RemoteCheck @Params

        # Capture dumpId from step 5 for step 6
        if ($Def.Step -eq 5 -and $Check.Success -and $Def.PostHook) {
            $DumpId = & $Def.PostHook $Check.Body
            if (-not $DumpId) {
                Write-Verbose "  step 5 succeeded but response had no dumpId/id — step 6 will request 'unknown'"
            } else {
                Write-Verbose "  captured dumpId=$DumpId for step 6"
            }
        }

        $R = [AnonymousFlowStepResult]::new()
        $R.Step       = $Def.Step
        $R.Method     = $Def.Method
        $R.Endpoint   = $Def.Path
        $R.Description = $Def.Desc
        $R.BugTags    = $Def.BugTags
        $R.Pass       = $Check.Success
        $R.StatusCode = $Check.StatusCode
        $R.Ms         = $Check.ResponseMs
        $R.Error      = $Check.Error
        $Results.Add($R)

        if ($Detailed) {
            $Status = if ($R.Pass) { 'PASS' } else { 'FAIL' }
            $Color  = if ($R.Pass) { 'Green' } else { 'Red' }
            Write-Host ("  [{0}/7] {1,-4} {2,-44} {3,5} ms  [{4}]" -f $Def.Step, $Status, $Def.Path, $R.Ms, $R.StatusCode) -ForegroundColor $Color
            if (-not $R.Pass -and $R.Error) {
                Write-Host "        $($R.Error)" -ForegroundColor DarkGray
            }
        }

        if ($StopOnFailure -and -not $R.Pass) {
            Write-Verbose "Stopping at step $($Def.Step) due to -StopOnFailure"
            break
        }
    }

    $TotalSw.Stop()
    $Passed = @($Results | Where-Object { $_.Pass }).Count
    $Failed = @($Results | Where-Object { -not $_.Pass }).Count
    $Color = if ($Failed -eq 0) { 'Green' } else { 'Red' }
    Write-Host ("Anonymous flow: {0} passed, {1} failed ({2:n1}s elapsed)" -f $Passed, $Failed, ($TotalSw.ElapsedMilliseconds / 1000.0)) -ForegroundColor $Color

    @($Results)
}
