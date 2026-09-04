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

    HYBRID allowlist (TL Decision 2, t/3314#2, refined per t/3314#6):
      - Known-internal hosts (literal -Uri) → host-literal AUTO-ALLOW (AllowedHosts). Extracts the
        literal host even when the port/path is interpolated ("http://localhost:$Port/…" → localhost).
      - **Per-call-site allowlist keyed by {file, function} + a one-line reason** ($AllowedSites) for
        today's grandfathered internal variable-URL fetches. Per-SITE (never whole-file/dir skip — a
        dir/file exempt is a reopening hole, t/3314#6): a NEW fetching function not in the list FLAGS.
      - The co-located `# fetch-allowlist: <reason>` **source marker** is the mechanism for NEW/future
        genuinely-internal variable fetches (Decision 2's letter).
      - Anything else (a bare unmarked variable-URL fetch, or a literal non-allowlisted external host)
        → FLAG → migrate to the Node fetcher or add a justified entry.

    Pure predicates (t/2971): Get-WafFetchViolations (host/marker/comment classify) and
    Test-FetchSiteAllowlisted ({file,function} → allowed) are both unit-testable; both arms are forced
    with a fixture .ps1 (t/3247). Modeled on tests/DataWriteSinkGuard.Tests.ps1.

    GV NOTE (Decision-2 refinement, t/3314#6): the grandfathered exemptions live as guard-side
    per-{file,function} entries (≡ the call-site marker, co-located at the guard) rather than ~26 source
    markers — zero source churn. New sites still require the source marker. Flagged for Main GV to ratify.
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

    $script:ScanDirs = @('scripts')
    # Test-scope exclusions (NOT production dir-skips): *.Tests.ps1 are Pester unit tests; CuiTests/
    # are browser-CUI end-to-end harnesses that drive the LOCAL app under test via $BaseUrl. Both are
    # test infrastructure, not production fetchers. (GV: flagged as the one dir-level exclusion.)
    $script:SkipDirs = @('archive', '.worktrees', 'dist', 'node_modules', '.git', '.claude',
                         'Project-Template', 'CuiTests', 'en-US')

    # Known-internal hosts: a literal -Uri to one of these auto-allows.
    $script:AllowedHosts = @(
        'localhost', '127.0.0.1',
        'api.anthropic.com', 'api.groq.com', 'api.openai.com', 'api.z.ai',
        'api.github.com', 'www.githubstatus.com', 'githubstatus.com', 'ghcr.io',
        'api.loganalytics.io', 'management.azure.com'
    )

    # Co-located call-site marker for a genuinely-internal (or migrating) NEW variable-URL fetch.
    $script:MarkerPattern = '#\s*fetch-allowlist:'

    $script:CallToken = '\b(?:Invoke-WebRequest|Invoke-RestMethod)\b'

    # ── Per-call-site allowlist (grandfathered internal fetches), keyed by {file, function} + reason.
    # Per-SITE, auditable, zero source churn (t/3314#6). A NEW fetching function must migrate to the
    # Node fetcher or add a justified entry here — the list can't hide a new external fetch.
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

        # Local infra (localhost/container, host is a variable so not caught by host-literal):
        @{ File = 'scripts/AITriad/Private/Docker-Helpers.ps1';           Function = 'Wait-ForHealthEndpoint';    Reason = 'polls a local Docker container health endpoint (localhost container)' }
        @{ File = 'scripts/AITriad/Public/Get-ViteDevStatus.ps1';         Function = 'Get-ViteHttpStatus';        Reason = 'local Vite dev-server status (localhost)' }
        @{ File = 'scripts/AITriad/Public/Export-TaxonomyToGraph.ps1';    Function = 'Invoke-Cypher';             Reason = 'local graph DB (neo4j) Cypher write' }
        @{ File = 'scripts/AITriad/Public/Invoke-CypherQuery.ps1';        Function = 'Invoke-CypherQuery';        Reason = 'local graph DB (neo4j) Cypher query' }

        # First-party cloud infra (our tenant / registries, AAD/token-authed):
        @{ File = 'scripts/AITriad/Public/Get-AzureFlightRecorder.ps1';   Function = 'Invoke-FRApi';              Reason = 'Azure Log Analytics / management query (our tenant, AAD-authed)' }
        @{ File = 'scripts/AITriad/Public/Get-TaxonomySnapshot.ps1';      Function = 'Get-SnapshotFile';          Reason = 'downloads a taxonomy snapshot from our Azure blob storage' }
        @{ File = 'scripts/AITriad/Private/Invoke-GitHubApi.ps1';         Function = 'Invoke-GitHubApi';          Reason = 'GitHub REST API client (api.github.com via $Params)' }
        @{ File = 'scripts/AITriad/Private/Invoke-RemoteCheck.ps1';       Function = 'Invoke-RemoteCheck';        Reason = 'health-check utility for our own deployment endpoints (@WebParams) — GV: confirm not arbitrary-URL' }
        @{ File = 'scripts/AITriad/Private/Invoke-DependencyCheck.ps1';   Function = 'Install-Pkg';               Reason = 'dependency/package availability probe — GV: confirm registry endpoint is fixed/internal' }

        # AI-provider APIs (called directly by key, not user-supplied URLs):
        @{ File = 'scripts/AITriad/Public/Get-AICostReport.ps1';          Function = 'Get-AICostReport';          Reason = 'AI-provider models/pricing endpoint (provider APIs, by key)' }
        @{ File = 'scripts/AITriad/Public/Register-AIBackend.ps1';        Function = 'Send-Forbidden';            Reason = 'AI-provider key-validation probes (Ollama localhost + provider APIs)' }
        @{ File = 'scripts/AITriad/Public/Test-AIApiKey.ps1';             Function = 'Test-AIApiKey';             Reason = 'AI-provider key-validation probes (provider APIs)' }

        # Edges (t/3314#6):
        @{ File = 'scripts/AITriad/Public/Test-GitHubHealth.ps1';         Function = 'Test-GitHubHealth';         Reason = 'GitHub Actions runs API ($RunsUri from api.github.com — github health, edge c)' }
        @{ File = 'scripts/AITriad/Private/Submit-ToWaybackMachine.ps1';  Function = 'Submit-ToWaybackMachine';   Reason = 'outbound archival POST to web.archive.org — not external-content ingestion (edge a)' }
        @{ File = 'scripts/TalmudicDebate/Initialize-TalmudicCorpus.ps1'; Function = 'Get-SefariaVersion';        Reason = 'Sefaria API version fetch — allowlisted PENDING REVIEW; likely external-content, migrates under follow-up t/3327 (edge b)' }
    )

    # Extract the LITERAL host of a -Uri argument, even when the path/port/query is interpolated.
    function Get-UriHostLiteral {
        param([string]$Statement)
        $m = [regex]::Match($Statement, "-Uri\s+['`"]https?://([^/:'`"\s\$]+)", 'IgnoreCase')
        if (-not $m.Success) { return $null }
        return $m.Groups[1].Value.ToLowerInvariant()
    }

    # PURE: given a file's content, return the 1-based line numbers of call-sites FLAGGED by the
    # host-literal / marker / comment classification (before the per-site allowlist is applied).
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
            while ($lines[$k].TrimEnd().EndsWith('`') -and ($k + 1) -lt $lines.Count) {
                $k++; $stmt += "`n" + $lines[$k]
            }

            $uriHost = Get-UriHostLiteral -Statement $stmt
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

    # The function enclosing a given line (nearest preceding `function <Name>`); '<script>' if none.
    function Get-EnclosingFunction {
        param([string[]]$Lines, [int]$Index)
        for ($j = $Index; $j -ge 0; $j--) {
            $m = [regex]::Match($Lines[$j], '^\s*function\s+([A-Za-z][\w-]*)')
            if ($m.Success) { return $m.Groups[1].Value }
        }
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

    # Walk scripts/**/*.ps1 (minus skip dirs / test files) → real violations after the allowlist.
    function Get-RealTreeFetchViolations {
        $viol = @()
        foreach ($d in $script:ScanDirs) {
            $root = Join-Path $script:RepoRoot $d
            if (-not (Test-Path $root)) { continue }
            $files = Get-ChildItem -Path $root -Recurse -File -Filter '*.ps1' | Where-Object {
                if ($_.Name -match '\.Tests\.ps1$') { return $false }
                $rel = $_.FullName.Substring($script:RepoRoot.Length + 1) -replace '\\', '/'
                foreach ($sd in $script:SkipDirs) {
                    if ($rel -match "(^|/)$([regex]::Escape($sd))(/|$)") { return $false }
                }
                return $true
            }
            foreach ($f in $files) {
                $rel = $f.FullName.Substring($script:RepoRoot.Length + 1) -replace '\\', '/'
                $content = Get-Content -Raw -Path $f.FullName
                if (-not $content) { continue }
                $lines = $content -split "`r?`n"
                foreach ($ln in (Get-WafFetchViolations -Content $content)) {
                    $fn = Get-EnclosingFunction -Lines $lines -Index ($ln - 1)
                    if (Test-FetchSiteAllowlisted -RelPath $rel -Function $fn) { continue }
                    $viol += [PSCustomObject]@{ File = $rel; Line = $ln; Function = $fn }
                }
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

    Context 'Fixture files — forces the fire arm on a real .ps1 (t/3247)' {
        BeforeAll { $script:FixtureDir = Join-Path $PSScriptRoot 'fixtures/waf-fetch-guard' }
        It 'flags the NEW-unlisted-external fixture (RED arm)' {
            Get-WafFetchViolations -Content (Get-Content -Raw -Path (Join-Path $script:FixtureDir 'new-unlisted-external.ps1')) | Should -Not -BeNullOrEmpty
        }
        It 'passes the compliant fixture — literal-internal + marked-variable (GREEN arm)' {
            Get-WafFetchViolations -Content (Get-Content -Raw -Path (Join-Path $script:FixtureDir 'compliant.ps1')) | Should -BeNullOrEmpty
        }
    }

    Context 'Per-site allowlist predicate (both arms)' {
        It 'ALLOWS a grandfathered {file, function} site' {
            Test-FetchSiteAllowlisted -RelPath 'scripts/AITriad/Private/Invoke-GitHubApi.ps1' -Function 'Invoke-GitHubApi' | Should -BeTrue
        }
        It 'FLAGS a NEW fetching function in an otherwise-allowlisted file (no whole-file hole)' {
            Test-FetchSiteAllowlisted -RelPath 'scripts/AITriad/Private/Invoke-GitHubApi.ps1' -Function 'Invoke-SomethingNew' | Should -BeFalse
        }
        It 'FLAGS a site in a file with no allowlist entry' {
            Test-FetchSiteAllowlisted -RelPath 'scripts/AITriad/Public/Brand-NewCmdlet.ps1' -Function 'Brand-NewCmdlet' | Should -BeFalse
        }
    }

    Context 'Real tree — the load-bearing gate: NO unaccounted fetch sites' {
        It 'every scripts/ Invoke-* fetch is host-literal-internal, marked, or a grandfathered allowlist entry' {
            $viol = Get-RealTreeFetchViolations
            $report = ($viol | ForEach-Object { "  $($_.File):$($_.Line)  [$($_.Function)]" }) -join "`n"
            $viol | Should -BeNullOrEmpty -Because @"
Unaccounted Invoke-WebRequest / Invoke-RestMethod site(s) in scripts/:
$report

Each fetch must be one of: a literal known-internal host (AllowedHosts); a co-located
`# fetch-allowlist: <reason>` marker (for a genuinely-internal NEW variable-URL fetch); or a
grandfathered per-{file,function} entry in `AllowedSites` (with a reason) in this test. If this is a
NEW external-content fetch, route it through the shared Node fetch-CLI (Get-UrlViaSharedFetcher,
t/3312) instead of Invoke-*. (t/3314; mirrors DataWriteSinkGuard.Tests.ps1.)
"@
        }

        It 'reaches scripts/ (guards against a vacuous pass)' {
            @(Get-ChildItem -Path (Join-Path $script:RepoRoot 'scripts') -Recurse -Filter '*.ps1').Count | Should -BeGreaterThan 0
        }
    }
}
