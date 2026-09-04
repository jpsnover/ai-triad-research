# Tag: waf-fetch-guard (t/3314)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    WAF-fingerprint fetch prevention guard (t/3314) — keeps the WAF-blockable-fetch class CLOSED.
.DESCRIPTION
    The op-ed 403 (t/3306/t/3307) proved that PowerShell's Invoke-WebRequest / Invoke-RestMethod
    client fingerprint is WAF-blocked (Akamai .gov) on hosts Node's undici fetches at 200. The four
    external-content fetchers were migrated to the shared SSRF-guarded Node fetch-CLI
    (Get-UrlViaSharedFetcher — t/3307/t/3310/t/3313/t/3320). This static-analysis gate stops the class
    REOPENING: it scans scripts/**/*.ps1 and FLAGS any Invoke-WebRequest / Invoke-RestMethod call that
    isn't accounted for.

    A fetch is accounted for iff ONE of:
      1. Host-literal AUTO-ALLOW — the -Uri resolves to a known-internal host (AllowedHosts). Resolves
         a literal ("https://host/…", incl. an interpolated port/path "http://localhost:$Port/…") AND
         a local variable assigned a literal URL a few lines above (`$u = "https://host/…"; … -Uri $u`).
      2. A co-located `# fetch-allowlist: <reason>` source marker — the mechanism for a NEW
         genuinely-internal variable-URL fetch (TL Decision 2's letter).
      3. A grandfathered per-{file,function} entry in AllowedSites (with a reason) — per-SITE, never
         whole-file/dir skip (t/3314#6: a dir/file exempt is a reopening hole).
    Anything else → FLAG → migrate to Get-UrlViaSharedFetcher or add a justified entry.

    ATTRIBUTION IS AST-BASED (t/3314#8 Finding 1): the enclosing function of each call is the innermost
    FunctionDefinitionAst whose extent spans the call line — scope-aware (respects braces / nested +
    closed functions), so a call in an outer body after an inner function closed is NOT mis-attributed
    to the inner (which would silently turn a per-site entry into a whole-file hole).

    Pure predicates (t/2971): Get-WafFetchViolations (classify) + Test-FetchSiteAllowlisted (allowlist).
    Both arms are fixture-forced (t/3247), incl. an end-to-end nested-function fixture that exercises
    the scanner's AST attribution. Modeled on tests/DataWriteSinkGuard.Tests.ps1.

    GV NOTE (Decision-2 refinement, RATIFIED t/3314#8): grandfathered exemptions are guard-side
    per-{file,function} entries (≡ the call-site marker, co-located at the guard) — zero source churn;
    NEW sites still require the source marker.
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

    $script:ScanDirs = @('scripts')
    # Test-scope exclusions (dir-level, accepted at GV t/3314#8 with the residual noted): *.Tests.ps1
    # are Pester unit tests; CuiTests/ are browser-CUI e2e harnesses that drive the LOCAL app via
    # $BaseUrl. Test infrastructure, not production fetchers. (A fetch added inside a test file slips —
    # low risk; these drive the local app.)
    $script:SkipDirs = @('archive', '.worktrees', 'dist', 'node_modules', '.git', '.claude',
                         'Project-Template', 'CuiTests', 'en-US')

    # Known-internal hosts: a (literal-or-var-resolved) -Uri to one of these auto-allows. The provider
    # APIs are called directly by key (not user-supplied URLs), same class as anthropic/groq/openai.
    $script:AllowedHosts = @(
        'localhost', '127.0.0.1',
        'api.anthropic.com', 'api.groq.com', 'api.openai.com', 'api.z.ai',
        'generativelanguage.googleapis.com',
        'api.github.com', 'www.githubstatus.com', 'githubstatus.com', 'ghcr.io',
        'api.loganalytics.io', 'management.azure.com'
    )

    $script:MarkerPattern = '#\s*fetch-allowlist:'
    $script:CallToken = '\b(?:Invoke-WebRequest|Invoke-RestMethod)\b'

    # ── Per-call-site allowlist (grandfathered internal fetches), keyed by {file, function} + reason.
    # Per-SITE, auditable, zero source churn (t/3314#6). A NEW fetching function must migrate to the
    # Node fetcher or add a justified entry — the list can't hide a new external fetch (AST attribution
    # guarantees a call is attributed to its real enclosing function, t/3314#8).
    $script:AllowedSites = @(
        # Our own taxonomy-editor app admin/API (not user-supplied external content):
        @{ File = 'scripts/AITriad/Private/New-AnonymousWebSession.ps1'; Function = 'New-AnonymousWebSession'; Reason = 'establishes an anonymous session against our taxonomy-editor app' }
        @{ File = 'scripts/AITriad/Private/Save-BriefArtifact.ps1';       Function = 'Save-BriefArtifact';       Reason = 'downloads a brief artifact (.pptx) from our app via -OutFile' }
        @{ File = 'scripts/AITriad/Public/Get-TriadConfig.ps1';           Function = 'Get-TriadConfig';           Reason = 'reads runtime config from our app admin API' }
        @{ File = 'scripts/AITriad/Public/Set-TriadConfig.ps1';           Function = 'Set-TriadConfig';           Reason = 'reads + uploads runtime config via our app admin API' }
        @{ File = 'scripts/AITriad/Public/Invoke-TriadConfigReload.ps1';  Function = 'Invoke-TriadConfigReload';  Reason = 'triggers a config reload on our app admin API' }
        @{ File = 'scripts/AITriad/Public/Sync-TaxEditorData.ps1';        Function = 'Sync-TaxEditorData';        Reason = 'triggers a data sync on our app admin API' }
        @{ File = 'scripts/AITriad/Public/Sync-FreeTierKeys.ps1';         Function = 'Invoke-GeminiKeyProbe';     Reason = 'Gemini free-tier key probe (provider API, called by key)' }
        @{ File = 'scripts/AITriad/Public/Test-ServiceWorkerHealth.ps1';  Function = 'Test-ServiceWorkerHealth';  Reason = "checks our app's service-worker URL health" }

        # Local infra (localhost/container; host is a variable, not caught by host-literal):
        @{ File = 'scripts/AITriad/Private/Docker-Helpers.ps1';           Function = 'Wait-ForHealthEndpoint';    Reason = 'polls a local Docker container health endpoint (localhost container)' }
        @{ File = 'scripts/AITriad/Public/Get-ViteDevStatus.ps1';         Function = 'Get-ViteHttpStatus';        Reason = 'local Vite dev-server status (localhost)' }
        @{ File = 'scripts/AITriad/Public/Export-TaxonomyToGraph.ps1';    Function = 'Invoke-Cypher';             Reason = 'local graph DB (neo4j) Cypher write' }
        @{ File = 'scripts/AITriad/Public/Invoke-CypherQuery.ps1';        Function = 'Invoke-CypherQuery';        Reason = 'local graph DB (neo4j) Cypher query' }

        # First-party cloud infra (our tenant / registries, AAD/token-authed):
        @{ File = 'scripts/AITriad/Public/Get-AzureFlightRecorder.ps1';   Function = 'Invoke-FRApi';              Reason = 'Azure Log Analytics / management query (our tenant, AAD-authed)' }
        @{ File = 'scripts/AITriad/Public/Get-TaxonomySnapshot.ps1';      Function = 'Get-SnapshotFile';          Reason = 'downloads a taxonomy snapshot from our Azure blob storage' }
        @{ File = 'scripts/AITriad/Private/Invoke-GitHubApi.ps1';         Function = 'Invoke-GitHubApi';          Reason = 'GitHub REST API client (api.github.com via $Params)' }
        @{ File = 'scripts/AITriad/Private/Invoke-RemoteCheck.ps1';       Function = 'Invoke-RemoteCheck';        Reason = 'health-check utility for our own deployment endpoints ($BaseUrl+$Path; GV-confirmed internal, t/3314#8)' }

        # AI-provider APIs (called directly by key, not user-supplied URLs):
        @{ File = 'scripts/AITriad/Public/Get-AICostReport.ps1';          Function = 'Get-AICostReport';          Reason = 'AI-provider models/pricing endpoint (provider APIs, by key)' }
        @{ File = 'scripts/AITriad/Public/Register-AIBackend.ps1';        Function = 'Register-AIBackend';        Reason = 'Ollama model-list probe ($OllamaUrl, localhost by default); other provider probes auto-allow by host' }
        @{ File = 'scripts/AITriad/Public/Test-AIApiKey.ps1';             Function = '_Probe-Backend';            Reason = 'AI-provider key-validation probes (provider APIs, by key)' }

        # Edges (t/3314#6):
        @{ File = 'scripts/AITriad/Public/Test-GitHubHealth.ps1';         Function = 'Test-GitHubHealth';         Reason = 'GitHub Actions runs API ($RunsUri from api.github.com — github health, edge c)' }
        @{ File = 'scripts/AITriad/Private/Submit-ToWaybackMachine.ps1';  Function = 'Submit-ToWaybackMachine';   Reason = 'outbound archival POST to web.archive.org — not external-content ingestion (edge a)' }
        @{ File = 'scripts/TalmudicDebate/Initialize-TalmudicCorpus.ps1'; Function = 'Get-SefariaVersion';        Reason = 'Sefaria API version fetch — allowlisted PENDING REVIEW; likely external-content, migrates under follow-up t/3327 (edge b)' }
        # NOTE: Invoke-DependencyCheck.ps1 L163/180/195 (Gemini/Anthropic/Groq key probes) auto-allow by
        # host-literal (incl. $Uri var-resolution) — no per-site entry (t/3314#8 Finding 2).
    )

    # Host from the first "http(s)://<host>" literal in a text fragment (no interpolation in the host).
    function Get-HostFromUrlLiteral {
        param([string]$Text)
        $m = [regex]::Match($Text, "['`"]https?://([^/:'`"\s\$]+)", 'IgnoreCase')
        if ($m.Success) { return $m.Groups[1].Value.ToLowerInvariant() }
        return $null
    }

    # Resolve the -Uri host of a call: a literal on the statement, or a local `$var = "https://…"`
    # assignment a few lines above when the call is `-Uri $var`. Returns $null if not statically known.
    function Resolve-CallHost {
        param([string[]]$Lines, [int]$Index, [string]$Statement)
        $lit = [regex]::Match($Statement, "-Uri\s+(['`"]https?://[^'`"\s]+)", 'IgnoreCase')
        if ($lit.Success) { return (Get-HostFromUrlLiteral -Text $lit.Groups[1].Value) }
        $var = [regex]::Match($Statement, '-Uri\s+\$([A-Za-z_]\w*)', 'IgnoreCase')
        if (-not $var.Success) { return $null }
        $name = [regex]::Escape($var.Groups[1].Value)
        for ($j = $Index; $j -ge [Math]::Max(0, $Index - 12); $j--) {
            $a = [regex]::Match($Lines[$j], "^\s*\`$$name\s*=\s*(['`"]https?://[^'`"\s]+)", 'IgnoreCase')
            if ($a.Success) { return (Get-HostFromUrlLiteral -Text $a.Groups[1].Value) }
        }
        return $null
    }

    # PURE: given content, return 1-based line numbers FLAGGED by host/marker/comment classification.
    function Get-WafFetchViolations {
        param([string]$Content)
        $lines = $Content -split "`r?`n"
        $flagged = @()
        $inBlock = $false
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]
            if ($inBlock) { if ($line -match '#>') { $inBlock = $false }; continue }
            if ($line -match '<#') { if ($line -notmatch '#>') { $inBlock = $true }; continue }

            $call = [regex]::Match($line, $script:CallToken)
            if (-not $call.Success) { continue }
            $hash = $line.IndexOf('#')
            if ($hash -ge 0 -and $hash -lt $call.Index) { continue }

            $stmt = $line
            $k = $i
            while ($lines[$k].TrimEnd().EndsWith('`') -and ($k + 1) -lt $lines.Count) { $k++; $stmt += "`n" + $lines[$k] }

            $uriHost = Resolve-CallHost -Lines $lines -Index $i -Statement $stmt
            if ($uriHost -and ($script:AllowedHosts -contains $uriHost)) { continue }

            $hasMarker = $false
            for ($j = [Math]::Max(0, $i - 3); $j -le $i; $j++) {
                if ($lines[$j] -match $script:MarkerPattern) { $hasMarker = $true; break }
            }
            if ($hasMarker) { continue }

            $flagged += ($i + 1)
        }
        return $flagged
    }

    # AST-based enclosing-function attribution (scope-aware): innermost FunctionDefinitionAst whose
    # extent spans the 1-based line. '<script>' if the call is at script scope (no enclosing function).
    function Get-EnclosingFunctionName {
        param([string]$Content, [int]$Line)
        $errs = $null; $tokens = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseInput($Content, [ref]$tokens, [ref]$errs)
        $funcs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)
        $best = $null
        foreach ($f in $funcs) {
            if ($Line -ge $f.Extent.StartLineNumber -and $Line -le $f.Extent.EndLineNumber) {
                if ($null -eq $best -or
                    ($f.Extent.EndLineNumber - $f.Extent.StartLineNumber) -lt ($best.Extent.EndLineNumber - $best.Extent.StartLineNumber)) {
                    $best = $f
                }
            }
        }
        if ($best) { return $best.Name }
        return '<script>'
    }

    # PURE: is this {file, function} site covered by a grandfathered allowlist entry?
    function Test-FetchSiteAllowlisted {
        param([string]$RelPath, [string]$Function)
        foreach ($e in $script:AllowedSites) {
            if ($e.File -eq $RelPath -and $e.Function -eq $Function) { return $true }
        }
        return $false
    }

    # Scan ONE file's content → real violations (classify → AST-attribute → allowlist filter). Used by
    # the real-tree walker AND the end-to-end fixture tests, so attribution is exercised, not bypassed.
    function Get-FileFetchViolations {
        param([string]$Content, [string]$RelPath)
        $viol = @()
        $lines = $Content -split "`r?`n"
        foreach ($ln in (Get-WafFetchViolations -Content $Content)) {
            $fn = Get-EnclosingFunctionName -Content $Content -Line $ln
            if (Test-FetchSiteAllowlisted -RelPath $RelPath -Function $fn) { continue }
            $viol += [PSCustomObject]@{ File = $RelPath; Line = $ln; Function = $fn }
        }
        return $viol
    }

    function Get-RealTreeFetchViolations {
        $viol = @()
        foreach ($d in $script:ScanDirs) {
            $root = Join-Path $script:RepoRoot $d
            if (-not (Test-Path $root)) { continue }
            $files = Get-ChildItem -Path $root -Recurse -File -Filter '*.ps1' | Where-Object {
                if ($_.Name -match '\.Tests\.ps1$') { return $false }
                $rel = $_.FullName.Substring($script:RepoRoot.Length + 1) -replace '\\', '/'
                foreach ($sd in $script:SkipDirs) { if ($rel -match "(^|/)$([regex]::Escape($sd))(/|$)") { return $false } }
                return $true
            }
            foreach ($f in $files) {
                $rel = $f.FullName.Substring($script:RepoRoot.Length + 1) -replace '\\', '/'
                $content = Get-Content -Raw -Path $f.FullName
                if (-not $content) { continue }
                $viol += Get-FileFetchViolations -Content $content -RelPath $rel
            }
        }
        return $viol
    }
}

Describe 'WAF-fetch prevention guard (t/3314)' -Tag 'waf-fetch-guard' {

    Context 'Pure predicate — host/marker/comment classification (both arms)' {
        It 'FLAGS a new unlisted external variable-URL Invoke-* (the fire arm)' {
            Get-WafFetchViolations -Content '$Resp = Invoke-WebRequest -Uri $Url -TimeoutSec 60' | Should -Not -BeNullOrEmpty
        }
        It 'FLAGS a literal non-allowlisted external host with no marker' {
            Get-WafFetchViolations -Content "Invoke-RestMethod -Uri 'https://www.sanders.senate.gov/report.pdf'" | Should -Not -BeNullOrEmpty
        }
        It 'ALLOWS a literal internal host (host-literal auto-allow)' {
            Get-WafFetchViolations -Content "Invoke-RestMethod -Uri 'https://api.github.com/rate_limit' -Method Get" | Should -BeNullOrEmpty
        }
        It 'ALLOWS a literal internal host with an interpolated port/path' {
            Get-WafFetchViolations -Content 'Invoke-RestMethod -Uri "http://localhost:$Port/health"' | Should -BeNullOrEmpty
        }
        It 'ALLOWS a -Uri $var resolved from a nearby literal assignment to an internal host' {
            $c = '$Uri = "https://generativelanguage.googleapis.com/v1beta/models?key=$k"' + "`n" +
                 '$R = Invoke-RestMethod -Uri $Uri -Method Get'
            Get-WafFetchViolations -Content $c | Should -BeNullOrEmpty
        }
        It 'still FLAGS a -Uri $var resolved to a NON-allowlisted host' {
            $c = '$Uri = "https://evil.example.com/x"' + "`n" + '$R = Invoke-RestMethod -Uri $Uri'
            Get-WafFetchViolations -Content $c | Should -Not -BeNullOrEmpty
        }
        It 'ALLOWS a variable-URL fetch with a co-located # fetch-allowlist: marker' {
            Get-WafFetchViolations -Content "# fetch-allowlist: internal API base`n`$r = Invoke-WebRequest -Uri `$Uri" | Should -BeNullOrEmpty
        }
        It 'IGNORES commented-out / doc mentions of Invoke-*' {
            Get-WafFetchViolations -Content "# Invoke-WebRequest is WAF-blocked; use the Node fetcher" | Should -BeNullOrEmpty
            Get-WafFetchViolations -Content "<#`n    Passes as -WebSession to subsequent Invoke-WebRequest calls.`n#>" | Should -BeNullOrEmpty
        }
        It 'sees a -Uri literal on a backtick continuation line' {
            Get-WafFetchViolations -Content "Invoke-RestMethod ```n    -Uri 'https://api.groq.com/openai/v1/models' -Method Get" | Should -BeNullOrEmpty
        }
    }

    Context 'AST attribution — scope-aware (t/3314#8 Finding 1)' {
        It 'attributes a call in the OUTER body to the outer function, not a closed inner function' {
            $c = @'
function Get-OuterExternal {
    param([string]$Url)
    function Get-InnerNoop { 'noop' }
    $r = Invoke-WebRequest -Uri $Url -TimeoutSec 30
    return $r
}
'@
            $line = ($c -split "`r?`n" | Select-String 'Invoke-WebRequest').LineNumber
            Get-EnclosingFunctionName -Content $c -Line $line | Should -Be 'Get-OuterExternal'
        }
        It 'end-to-end: the mis-attribution hole is closed — outer-body fetch FLAGS under scanning' {
            $c = @'
function Get-InnerNoop { 'noop' }
function Get-OuterExternal {
    param([string]$Url)
    $r = Invoke-WebRequest -Uri $Url
    return $r
}
'@
            # A file NOT in AllowedSites: the outer fetch must flag, attributed to Get-OuterExternal
            # (a scope-unaware scan would say Get-InnerNoop).
            $viol = Get-FileFetchViolations -Content $c -RelPath 'scripts/AITriad/Public/Some-NewCmdlet.ps1'
            @($viol).Count               | Should -Be 1
            $viol[0].Function            | Should -Be 'Get-OuterExternal'
        }
    }

    Context 'Per-site allowlist predicate (both arms)' {
        It 'ALLOWS a grandfathered {file, function} site' {
            Test-FetchSiteAllowlisted -RelPath 'scripts/AITriad/Private/Invoke-GitHubApi.ps1' -Function 'Invoke-GitHubApi' | Should -BeTrue
        }
        It 'FLAGS a NEW fetching function in an otherwise-allowlisted file (no whole-file hole)' {
            Test-FetchSiteAllowlisted -RelPath 'scripts/AITriad/Private/Invoke-GitHubApi.ps1' -Function 'Invoke-SomethingNew' | Should -BeFalse
        }
    }

    Context 'Fixture files — forces the fire arm on a real .ps1 (t/3247)' {
        BeforeAll { $script:FixtureDir = Join-Path $PSScriptRoot 'fixtures/waf-fetch-guard' }
        It 'flags the NEW-unlisted-external fixture (RED arm)' {
            Get-WafFetchViolations -Content (Get-Content -Raw -Path (Join-Path $script:FixtureDir 'new-unlisted-external.ps1')) | Should -Not -BeNullOrEmpty
        }
        It 'passes the compliant fixture — literal-internal + marked-variable (GREEN arm)' {
            Get-WafFetchViolations -Content (Get-Content -Raw -Path (Join-Path $script:FixtureDir 'compliant.ps1')) | Should -BeNullOrEmpty
        }
    }

    Context 'Real tree — the load-bearing gate: NO unaccounted fetch sites' {
        It 'every scripts/ Invoke-* fetch is host-internal, marked, or a grandfathered allowlist entry' {
            $viol = Get-RealTreeFetchViolations
            $report = ($viol | ForEach-Object { "  $($_.File):$($_.Line)  [$($_.Function)]" }) -join "`n"
            $viol | Should -BeNullOrEmpty -Because @"
Unaccounted Invoke-WebRequest / Invoke-RestMethod site(s) in scripts/:
$report

Each fetch must be a known-internal host (AllowedHosts), a co-located `# fetch-allowlist: <reason>`
marker (NEW internal variable-URL fetch), or a grandfathered per-{file,function} entry in AllowedSites.
If this is a NEW external-content fetch, route it through Get-UrlViaSharedFetcher (t/3312), not Invoke-*.
"@
        }
        It 'reaches scripts/ (guards against a vacuous pass)' {
            @(Get-ChildItem -Path (Join-Path $script:RepoRoot 'scripts') -Recurse -Filter '*.ps1').Count | Should -BeGreaterThan 0
        }
    }
}
