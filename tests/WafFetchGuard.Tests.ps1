# Tag: waf-fetch-guard (t/3314)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    WAF-fingerprint fetch prevention guard (t/3314) — keeps the WAF-blockable-fetch class CLOSED.
.DESCRIPTION
    The op-ed 403 (t/3306/t/3307) proved that PowerShell's Invoke-WebRequest / Invoke-RestMethod
    client fingerprint is WAF-blocked (Akamai .gov) on hosts Node's undici fetches at 200. The fix
    for each site is to route external URL fetches through the shared SSRF-guarded Node fetcher
    (t/3312). This static-analysis gate stops the class REOPENING: it scans scripts/**/*.ps1 and
    FLAGS any Invoke-WebRequest / Invoke-RestMethod call that fetches a NON-allowlisted external URL.

    HYBRID allowlist (TL ruling t/3314#2):
      - Known-internal hosts (literal -Uri) → host-literal AUTO-ALLOW (AllowedHosts).
      - Variable-URL Invoke-* (host not statically resolvable: $Url / "$Base/..." / @splat) →
        REQUIRE a co-located call-site marker `# fetch-allowlist: <reason>` declaring it internal
        (or migrating). A bare, unmarked variable-URL Invoke-* → FLAG.
      - A literal -Uri with a NON-allowlisted external host and no marker → FLAG.

    Pure predicate (t/2971): Get-WafFetchViolations classifies content → flagged line numbers, so
    both arms are fixture/unit-testable without the real tree. Zero-noise: today's legit internal
    sites are covered by AllowedHosts + CuiTests skip + the co-located exemptions below.

    Modeled on tests/DataWriteSinkGuard.Tests.ps1 (co-located allowlist + pure predicate + both-arms).
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

    $script:ScanDirs = @('scripts')
    # CuiTests: browser-CUI harnesses that hit the LOCAL app ($BaseUrl) — not production fetchers.
    $script:SkipDirs = @('archive', '.worktrees', 'dist', 'node_modules', '.git', '.claude',
                         'Project-Template', 'CuiTests', 'en-US')

    # Known-internal hosts: a literal -Uri to one of these auto-allows (our own APIs / infra / the
    # AI provider endpoints we call directly by key, not user-supplied URLs).
    $script:AllowedHosts = @(
        'localhost', '127.0.0.1',
        'api.anthropic.com', 'api.groq.com', 'api.openai.com', 'api.z.ai',
        'api.github.com', 'www.githubstatus.com', 'githubstatus.com', 'ghcr.io',
        'api.loganalytics.io', 'management.azure.com'
    )

    # Co-located call-site marker for a genuinely-internal (or migrating) variable-URL fetch.
    $script:MarkerPattern = '#\s*fetch-allowlist:'

    $script:CallToken = '\b(?:Invoke-WebRequest|Invoke-RestMethod)\b'

    # Whole-file exemptions (co-located, each with a reason) for TODAY's internal variable-URL sites.
    # NOTE: seeding mechanism (this list vs. per-call-site markers) is under confirmation with the
    # owner (t/3314#4); this list is the DataWriteSinkGuard-precedent seed and may convert to markers.
    $script:ExemptFiles = @{
        # placeholder — populated after the seeding-mechanism ruling (t/3314#4).
    }

    # Extract the host of a STATIC literal -Uri (no interpolation). Returns $null for variable /
    # interpolated / splat URIs (host not statically resolvable → must be marked).
    function Get-UriHostLiteral {
        param([string]$Statement)
        $m = [regex]::Match($Statement, "-Uri\s+(['`"])(https?://[^'`"]+)\1", 'IgnoreCase')
        if (-not $m.Success) { return $null }
        $url = $m.Groups[2].Value
        if ($url -match '\$') { return $null }   # interpolated "$Base/..." → not a static host
        try { return ([uri]$url).Host.ToLowerInvariant() } catch { return $null }
    }

    # PURE predicate: given a file's content, return the 1-based line numbers of FLAGGED call-sites.
    # Skips block comments (<# #>), line comments, and doc mentions; honors AllowedHosts + markers.
    function Get-WafFetchViolations {
        param([string]$Content)
        $lines = $Content -split "`r?`n"
        $violations = @()
        $inBlock = $false
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]

            # Track <# ... #> block comments (cmdlet help / doc mentions of Invoke-*).
            if ($inBlock) { if ($line -match '#>') { $inBlock = $false }; continue }
            if ($line -match '<#') { if ($line -notmatch '#>') { $inBlock = $true }; continue }

            $call = [regex]::Match($line, $script:CallToken)
            if (-not $call.Success) { continue }

            # Line comment / commented-out call / doc mention: a '#' before the token on this line.
            $hash = $line.IndexOf('#')
            if ($hash -ge 0 -and $hash -lt $call.Index) { continue }

            # Assemble the full call statement across backtick line-continuations, so a -Uri on a
            # continuation line is seen (e.g. `Invoke-RestMethod ` \n `  -Uri 'https://...'`).
            $stmt = $line
            $k = $i
            while ($lines[$k].TrimEnd().EndsWith('`') -and ($k + 1) -lt $lines.Count) {
                $k++; $stmt += "`n" + $lines[$k]
            }

            # Host-literal auto-allow.
            $uriHost = Get-UriHostLiteral -Statement $stmt
            if ($uriHost -and ($script:AllowedHosts -contains $uriHost)) { continue }

            # Otherwise (variable URL, or non-allowlisted literal host) require a co-located marker
            # within the 3 lines preceding the call or on the call line itself.
            $hasMarker = $false
            for ($j = [Math]::Max(0, $i - 3); $j -le $i; $j++) {
                if ($lines[$j] -match $script:MarkerPattern) { $hasMarker = $true; break }
            }
            if ($hasMarker) { continue }

            $violations += ($i + 1)
        }
        return $violations
    }

    # Walk scripts/**/*.ps1 (minus skip dirs / test files / exempt files) and collect real violations.
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
                if ($script:ExemptFiles.ContainsKey($rel)) { continue }
                $content = Get-Content -Raw -Path $f.FullName
                if (-not $content) { continue }
                foreach ($ln in (Get-WafFetchViolations -Content $content)) {
                    $viol += [PSCustomObject]@{ File = $rel; Line = $ln }
                }
            }
        }
        return $viol
    }
}

Describe 'WAF-fetch prevention guard (t/3314)' -Tag 'waf-fetch-guard' {

    Context 'Pure predicate — both arms' {
        It 'FLAGS a new unlisted external variable-URL Invoke-* (the fire arm)' {
            $bad = '$Resp = Invoke-WebRequest -Uri $Url -TimeoutSec 60'
            Get-WafFetchViolations -Content $bad | Should -Not -BeNullOrEmpty
        }

        It 'FLAGS a literal non-allowlisted external host with no marker' {
            $bad = "Invoke-RestMethod -Uri 'https://www.sanders.senate.gov/report.pdf'"
            Get-WafFetchViolations -Content $bad | Should -Not -BeNullOrEmpty
        }

        It 'ALLOWS a literal internal host (host-literal auto-allow)' {
            $ok = "Invoke-RestMethod -Uri 'https://api.github.com/rate_limit' -Method Get"
            Get-WafFetchViolations -Content $ok | Should -BeNullOrEmpty
        }

        It 'ALLOWS a variable-URL fetch with a co-located # fetch-allowlist: marker' {
            $ok = "# fetch-allowlist: internal taxonomy-editor API base`n`$r = Invoke-WebRequest -Uri `$Uri"
            Get-WafFetchViolations -Content $ok | Should -BeNullOrEmpty
        }

        It 'IGNORES commented-out / doc mentions of Invoke-*' {
            $doc = "# Invoke-WebRequest is WAF-blocked on some hosts; use the Node fetcher instead"
            Get-WafFetchViolations -Content $doc | Should -BeNullOrEmpty
            $block = "<#`n    Passes as -WebSession to subsequent Invoke-WebRequest calls.`n#>"
            Get-WafFetchViolations -Content $block | Should -BeNullOrEmpty
        }

        It 'sees a -Uri literal on a backtick continuation line' {
            $ok = "Invoke-RestMethod ```n    -Uri 'https://api.groq.com/openai/v1/models' -Method Get"
            Get-WafFetchViolations -Content $ok | Should -BeNullOrEmpty
        }
    }

    Context 'Fixture files — forces the fire arm on a real .ps1 (t/3247)' {
        BeforeAll {
            $script:FixtureDir = Join-Path $PSScriptRoot 'fixtures/waf-fetch-guard'
        }

        It 'flags the NEW-unlisted-external fixture (RED arm)' {
            $content = Get-Content -Raw -Path (Join-Path $script:FixtureDir 'new-unlisted-external.ps1')
            Get-WafFetchViolations -Content $content | Should -Not -BeNullOrEmpty
        }

        It 'passes the compliant fixture — literal-internal + marked-variable (GREEN arm)' {
            $content = Get-Content -Raw -Path (Join-Path $script:FixtureDir 'compliant.ps1')
            Get-WafFetchViolations -Content $content | Should -BeNullOrEmpty
        }
    }

    # NOTE: the real-tree "no violations" assertion is the load-bearing gate; it flips ON when the
    # seeding is finalized (t/3314#4) and the t/3312 migrations land (guard-last, blocks-on
    # t/3310/t/3313/t/3320). Until then it is reported, not asserted, so this build does not block CI.
    Context 'Real tree (reported until seeding + migrations land — t/3314 guard-last)' {
        It 'reports current scripts/ fetch violations for seeding review' {
            $viol = Get-RealTreeFetchViolations
            $report = ($viol | ForEach-Object { "  $($_.File):$($_.Line)" }) -join "`n"
            Write-Host "WAF-fetch guard — current flagged sites ($(@($viol).Count)):`n$report"
            # Positive control: the walker actually reached scripts/ files (guards a vacuous pass).
            @(Get-ChildItem -Path (Join-Path $script:RepoRoot 'scripts') -Recurse -Filter '*.ps1').Count |
                Should -BeGreaterThan 0
        }
    }
}
