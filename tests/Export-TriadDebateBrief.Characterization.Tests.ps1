# Tag: debate (t/3910)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

using module ..\scripts\AITriad\AITriad.psm1

<#
.SYNOPSIS
    Characterization (golden transcript) tests for Export-TriadDebateBrief, written BEFORE the t/3910
    complexity refactor so the same tests pass before and after it.
.DESCRIPTION
    Each scenario runs the cmdlet with -Verbose and records, in order, its full observable behaviour:
    verbose lines, warnings, the emitted [TriadDeckExport] (as JSON), every error record (id, category,
    message, target), and every REST call (method, path, body, header names) or the CLI argument list.
    Temp paths are normalized to <ROOT>. The transcript must equal tests/fixtures/debate-brief/<name>.txt
    byte for byte. Regenerate goldens ONLY on unchanged code: $env:UPDATE_BRIEF_GOLDENS = '1'.
    Complements Export-TriadDebateBrief.Tests.ps1 (happy paths + HTTP/error-id mapping): these pin the
    exact messages, fallbacks (sparse manifest, warning dedupe, CLI defaults), request bodies, CLI args,
    the default output directory, and the verbose trace.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
    $script:GoldenDir = Join-Path $PSScriptRoot 'fixtures' 'debate-brief'
    $script:Update = $env:UPDATE_BRIEF_GOLDENS -eq '1'
    $script:PwshExe = (Get-Process -Id $PID).Path

    function Write-Lf([string]$Path, [string]$Text) {
        $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force
        [System.IO.File]::WriteAllText($Path, $Text)   # LF + no BOM, so sizes match on every OS
    }

    # Normalized one-line rendering of anything the cmdlet emits.
    function Format-Line($Item) {
        if ($Item -is [System.Management.Automation.VerboseRecord]) { return "VERBOSE: $($Item.Message)" }
        if ($Item -is [TriadDeckExport]) {
            $o = [ordered]@{}
            foreach ($p in ($Item.PSObject.Properties | Sort-Object Name)) {
                $v = $p.Value
                if ($v -is [hashtable]) { $s = [ordered]@{}; foreach ($k in ($v.Keys | Sort-Object)) { $s[$k] = $v[$k] }; $v = $s }
                $o[$p.Name] = $v
            }
            return 'OUTPUT: ' + ($o | ConvertTo-Json -Compress -Depth 5)
        }
        return "OTHER: $Item"
    }

    # Runs the cmdlet with $Params (+ -Verbose, error/warning capture) and returns the normalized transcript.
    function Invoke-Scenario([hashtable]$Params) {
        $script:Calls = [System.Collections.Generic.List[string]]::new()
        $ev = $null; $wv = $null
        $stream = Export-TriadDebateBrief @Params -Verbose -ErrorVariable ev -WarningVariable wv `
            -ErrorAction SilentlyContinue -WarningAction SilentlyContinue 4>&1
        $lines = [System.Collections.Generic.List[string]]::new()
        foreach ($i in @($stream)) { $lines.Add((Format-Line $i)) }
        foreach ($w in @($wv)) { if ($w) { $lines.Add("WARNING: $w") } }
        foreach ($e in @($ev)) {
            if ($e) { $lines.Add("ERROR: $($e.FullyQualifiedErrorId) | $($e.CategoryInfo.Category) | $($e.Exception.Message) | $($e.TargetObject)") }
        }
        foreach ($c in $script:Calls) { $lines.Add("CALL: $c") }
        $text = ($lines -join "`n") + "`n"
        # JSON-escaped forms first (the OUTPUT line escapes '\' as '\\'), then plain; then any slash to '/'.
        foreach ($pair in @(@($script:Root, '<ROOT>'), @($script:PwshExe, '<PWSH>'))) {
            $text = $text.Replace($pair[0].Replace('\', '\\'), $pair[1]).Replace($pair[0], $pair[1])
        }
        return $text.Replace('\\', '/').Replace('\', '/')
    }

    function Assert-Golden([string]$Name, [string]$Actual) {
        $path = Join-Path $script:GoldenDir "$Name.txt"
        if ($script:Update) { Write-Lf $path $Actual; Set-ItResult -Skipped -Because "golden '$Name' regenerated"; return }
        Test-Path $path | Should -BeTrue -Because "golden $Name.txt must exist (generate on unchanged code)"
        $Actual | Should -BeExactly ([System.IO.File]::ReadAllText($path))
    }

    # ── Server-mode helpers ──
    function New-Poll($Status, $Pct, [string[]]$Warnings = @(), $ErrorCode = $null, $ErrorText = $null, $ExportId = 'exp-1') {
        [pscustomobject]@{ Success = $true; StatusCode = 200; Error = $null; Body = [pscustomobject]@{
                status = $Status; progressPct = $Pct; warnings = $Warnings; errorCode = $ErrorCode; error = $ErrorText; exportId = $ExportId } }
    }
    function Invoke-Server([hashtable]$Extra = @{}) {
        $p = @{ DebateId = 'deb-123'; BaseUrl = 'https://srv.example/'; OutputDirectory = $script:SrvOut; PassThru = $true }
        foreach ($k in $Extra.Keys) { $p[$k] = $Extra[$k] }
        Invoke-Scenario $p
    }

    # ── Local-mode helpers: CLI stubs record their args, then behave per scenario ──
    $script:Root = Join-Path ([System.IO.Path]::GetTempPath()) "brief-char-$(New-Guid)"
    $null = New-Item -ItemType Directory -Path $script:Root -Force
    $script:Root = (Resolve-Path $script:Root).Path
    $record = '$args -join " " | Set-Content -LiteralPath (Join-Path $PSScriptRoot "args.txt") -Encoding UTF8'
    $stubs = @{
        'ok-full'    = @"
$record
[Console]::Error.WriteLine("WARN: first warning")
[Console]::Error.WriteLine("  WARN:   second warning  ")
[Console]::Error.WriteLine("not a warning line")
Write-Output '{"debateId":"deb-L","title":"Local T","preset":"conference","model":"m1","modelSource":"Explicit","checkerModel":"c1","path":"P.pptx","specPath":"S.json","manifestPath":"M.json","traceCoveragePct":97.5,"verdicts":{"Supported":2,"Disputed":1},"warnings":["w1","w2"]}'
exit 0
"@
        'ok-sparse'  = @"
$record
Write-Output '{"debateId":"deb-S","title":"Sparse"}'
exit 0
"@
        'fail-plain' = @"
$record
[Console]::Error.WriteLine("WARN: before failing")
[Console]::Error.WriteLine("something broke without a json line")
exit 5
"@
        'not-json'   = @"
$record
Write-Output 'this is not json'
exit 0
"@
        'null-json'  = @"
$record
Write-Output 'null'
exit 0
"@
    }
    foreach ($k in $stubs.Keys) { Write-Lf (Join-Path $script:Root "stub-$k.ps1") $stubs[$k] }

    function New-DebateFile([string]$Name = 'debate-1') {
        $f = Join-Path $script:Root "$Name.json"
        Write-Lf $f '{"id":"deb-L","phase":"closed"}'
        $f
    }
    function Invoke-Local([string]$Stub, [hashtable]$Extra, [string]$DebateName = 'debate-1') {
        $script:StubPath = Join-Path $script:Root "stub-$Stub.ps1"
        $p = @{ Path = (New-DebateFile $DebateName); PassThru = $true }
        foreach ($k in $Extra.Keys) { $p[$k] = $Extra[$k] }
        $t = Invoke-Scenario $p
        $argsFile = Join-Path $script:Root 'args.txt'
        $argsText = if (Test-Path $argsFile) { (Get-Content -Raw -LiteralPath $argsFile).Trim() } else { '(cli not run)' }
        Remove-Item $argsFile -ErrorAction SilentlyContinue
        return $t + "ARGS: $($argsText.Replace($script:Root, '<ROOT>').Replace('\', '/'))`n"
    }
}

AfterAll { Remove-Item -LiteralPath $script:Root -Recurse -Force -ErrorAction SilentlyContinue }

Describe 'Export-TriadDebateBrief characterization (t/3910)' -Tag 'debate' {

    Context 'Server mode' {
        BeforeEach {
            $script:SrvOut = Join-Path $script:Root 'srv-out'
            Remove-Item -LiteralPath $script:SrvOut -Recurse -Force -ErrorAction SilentlyContinue
            $script:Post = @{ Success = $true; StatusCode = 202; Body = [pscustomobject]@{ jobId = 'job-1' }; Error = $null }
            $script:Polls = [System.Collections.Generic.Queue[object]]::new()
            $script:Manifest = [ordered]@{ debate_id = 'deb-123'; narrator_model = 'gem-1'; narrator_model_source = 'ServerResolved'
                checker_model = 'chk-1'; trace_coverage_pct = 92.5; verdict_counts = [ordered]@{ Supported = 3; Disputed = 1 }; warnings = @('m-warn') }
            $script:FailDownload = $null

            Mock -ModuleName AITriad Invoke-RemoteCheck -ParameterFilter { $Method -eq 'POST' } {
                $b = if ($Body) { $s = [ordered]@{}; foreach ($k in ($Body.Keys | Sort-Object)) { $s[$k] = $Body[$k] }; $s | ConvertTo-Json -Compress } else { '' }
                $script:Calls.Add("POST $BaseUrl$Path body=$b headers=$((@($ExtraHeaders.Keys) | Sort-Object) -join ',') auth=$($ExtraHeaders['Authorization']) ok=$($AcceptableStatusCodes -join ',') timeout=$TimeoutSec json=$ExpectJson")
                [pscustomobject]$script:Post
            }
            Mock -ModuleName AITriad Invoke-RemoteCheck -ParameterFilter { $Method -eq 'GET' } {
                $script:Calls.Add("GET $BaseUrl$Path headers=$((@($ExtraHeaders.Keys) | Sort-Object) -join ',') ok=$($AcceptableStatusCodes -join ',') timeout=$TimeoutSec json=$ExpectJson")
                $script:Polls.Dequeue()
            }
            Mock -ModuleName AITriad Save-BriefArtifact {
                $script:Calls.Add("SAVE $BaseUrl $ExportId $Name -> $Destination headers=$((@($Headers.Keys) | Sort-Object) -join ',') timeout=$TimeoutSec")
                if ($Name -eq $script:FailDownload) { throw "download of $Name broke" }
                $content = switch ($Name) {
                    'audit-manifest.json' { $script:Manifest | ConvertTo-Json -Depth 5 -Compress }
                    'deck_spec.json'      { '{"title":"Server T"}' }
                    default               { "stub-$Name" }
                }
                Write-Lf $Destination $content
            }
            Mock -ModuleName AITriad Start-Sleep { $script:Calls.Add("SLEEP $Seconds") }
        }

        It 'happy path with model, checker and token: body, headers, polls, downloads, verbose, output' {
            $script:Polls.Enqueue((New-Poll 'running' 40 @('warn-A')))
            $script:Polls.Enqueue((New-Poll 'running' 40 @('warn-A')))
            $script:Polls.Enqueue((New-Poll 'done' 100 @('warn-A', 'warn-B')))
            Assert-Golden 'server-happy' (Invoke-Server @{ Model = 'gem-1'; CheckerModel = 'chk-1'; AccessToken = 'TOK'; Preset = 'conference' })
        }

        It 'skip-narration, no token, sparse manifest: DebateId/Warnings/Trace fallbacks' {
            $script:Manifest = [ordered]@{ narrator_model = 'gem-1' }
            $script:Polls.Enqueue((New-Poll 'done' $null @('only-streamed')))
            Assert-Golden 'server-sparse-manifest' (Invoke-Server @{ SkipNarration = $true })
        }

        It 'no model and no skip: server-resolved free tier' {
            $script:Polls.Enqueue((New-Poll 'done' 100))
            Assert-Golden 'server-free-tier' (Invoke-Server)
        }

        It '202 without a jobId' {
            $script:Post = @{ Success = $true; StatusCode = 202; Body = [pscustomobject]@{ other = 1 }; Error = $null }
            Assert-Golden 'server-no-jobid' (Invoke-Server @{ SkipNarration = $true })
        }

        It 'POST failure message precedence: <Case>' -ForEach @(
            @{ Case = 'body-message'; Res = @{ Success = $false; StatusCode = 401; Body = [pscustomobject]@{ message = 'please sign in' }; Error = 'raw' } }
            @{ Case = 'error-only'; Res = @{ Success = $false; StatusCode = 400; Body = $null; Error = 'model gone' } }
            @{ Case = 'status-only'; Res = @{ Success = $false; StatusCode = 500; Body = $null; Error = $null } }
        ) {
            $script:Post = $Res
            Assert-Golden "server-post-$Case" (Invoke-Server @{ SkipNarration = $true })
        }

        It 'poll failure maps through the HTTP taxonomy' {
            $script:Polls.Enqueue([pscustomobject]@{ Success = $false; StatusCode = 404; Body = $null; Error = $null })
            Assert-Golden 'server-poll-404' (Invoke-Server @{ SkipNarration = $true })
        }

        It 'failed job without errorCode or error text' {
            $script:Polls.Enqueue((New-Poll 'failed' 50 @() $null $null $null))
            Assert-Golden 'server-job-failed-bare' (Invoke-Server @{ SkipNarration = $true })
        }

        It 'times out when the job never finishes' {
            $script:Clock = [datetime]'2026-01-01T00:00:00'
            Mock -ModuleName AITriad Get-Date { $script:Clock = $script:Clock.AddSeconds(5); $script:Clock }
            $script:Polls.Enqueue((New-Poll 'running' 10))
            $script:Polls.Enqueue((New-Poll 'running' 20))
            Assert-Golden 'server-timeout' (Invoke-Server @{ SkipNarration = $true; TimeoutSec = 7 })
        }

        It 'refuses a non-empty output directory without -Force, and proceeds with it' {
            Write-Lf (Join-Path $script:SrvOut 'existing.txt') 'x'
            $script:Polls.Enqueue((New-Poll 'done' 100))
            $refused = Invoke-Server @{ SkipNarration = $true }
            $script:Polls.Enqueue((New-Poll 'done' 100))
            $forced = Invoke-Server @{ SkipNarration = $true; Force = $true }
            Assert-Golden 'server-outdir' ("--- refused`n$refused--- forced`n$forced")
        }

        It 'stops at the first failed download' {
            $script:FailDownload = 'narration.json'
            $script:Polls.Enqueue((New-Poll 'done' 100))
            Assert-Golden 'server-download-fail' (Invoke-Server @{ SkipNarration = $true })
        }

        It 'defaults the output directory to <debateId>-brief in the current location' {
            $script:Polls.Enqueue((New-Poll 'done' 100))
            Push-Location $script:Root
            try { $t = Invoke-Scenario @{ DebateId = 'deb-def'; BaseUrl = 'https://srv.example'; SkipNarration = $true; PassThru = $true } }
            finally { Pop-Location }
            Assert-Golden 'server-default-outdir' $t
        }
    }

    Context 'Local mode' {
        BeforeEach {
            Mock -ModuleName AITriad Resolve-BriefExportCli { @{ Exe = $script:PwshExe; ArgPrefix = @('-NoProfile', '-File', $script:StubPath) } }
        }

        It 'happy path with checker and allow-open, default output dir: args, WARN streaming, verbose, output' {
            Assert-Golden 'local-happy' (Invoke-Local 'ok-full' @{ Model = 'm1'; CheckerModel = 'c1'; AllowOpenDebate = $true; Preset = 'conference' } 'debate-happy')
        }

        It 'skip-narration without a model uses the deterministic sentinel; sparse CLI output takes defaults' {
            Assert-Golden 'local-skip-sparse' (Invoke-Local 'ok-sparse' @{ SkipNarration = $true; OutputDirectory = (Join-Path $script:Root 'out-skip') })
        }

        It 'CLI failure without an errorCode line -> RenderFailure with the exit code' {
            Assert-Golden 'local-fail-plain' (Invoke-Local 'fail-plain' @{ Model = 'm1'; OutputDirectory = (Join-Path $script:Root 'out-fail') })
        }

        It 'stdout that is not JSON -> SpecSchemaFailure' {
            Assert-Golden 'local-not-json' (Invoke-Local 'not-json' @{ Model = 'm1'; OutputDirectory = (Join-Path $script:Root 'out-nj') })
        }

        It 'stdout that parses to null -> SpecSchemaFailure' {
            Assert-Golden 'local-null-json' (Invoke-Local 'null-json' @{ Model = 'm1'; OutputDirectory = (Join-Path $script:Root 'out-null') })
        }

        It 'refuses a non-empty output directory without -Force' {
            $out = Join-Path $script:Root 'out-full'
            Write-Lf (Join-Path $out 'existing.txt') 'x'
            Assert-Golden 'local-outdir-not-empty' (Invoke-Local 'ok-full' @{ Model = 'm1'; OutputDirectory = $out })
        }

        It 'missing file and missing model carry their exact messages and categories' {
            $missing = Invoke-Scenario @{ Path = (Join-Path $script:Root 'nope.json'); Model = 'm' }
            $nomodel = Invoke-Scenario @{ Path = (New-DebateFile 'debate-nomodel') }
            Assert-Golden 'local-guards' ("--- missing`n$missing--- nomodel`n$nomodel")
        }
    }
}
