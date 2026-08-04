function Invoke-DependencyAudit {
    <#
    .SYNOPSIS
        Runs npm audit and pip-audit, categorizes vulnerabilities by severity.
    .DESCRIPTION
        Wraps npm audit and pip-audit, parses JSON output, and categorizes
        findings by CVSS severity with SLA deadlines per the project's
        dependency policy (Critical: 48h, High: 7d, Medium: 30d, Low: next cycle).
    .PARAMETER AppDir
        App directory for npm audit. Auto-discovers if not specified.
    .PARAMETER RequirementsFile
        Path to requirements.txt for pip-audit. Default: scripts/requirements.txt.
    .PARAMETER SkipNpm
        Skip npm audit.
    .PARAMETER SkipPip
        Skip pip-audit.
    .EXAMPLE
        Invoke-DependencyAudit
    .EXAMPLE
        Invoke-DependencyAudit -SkipPip
    #>
    [CmdletBinding()]
    param(
        [Parameter()][string]$AppDir,
        [Parameter()][string]$RequirementsFile,
        [switch]$SkipNpm,
        [switch]$SkipPip
    )

    Set-StrictMode -Version Latest

    $findings = [System.Collections.Generic.List[object]]::new()

    # npm audit
    if (-not $SkipNpm) {
        if (-not $AppDir) {
            $AppDir = Get-ChildItem -Path $script:RepoRoot -Filter 'package.json' -Depth 2 |
                Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' } |
                ForEach-Object { $_.DirectoryName } |
                Select-Object -First 1
        }

        if ($AppDir -and (Test-Path (Join-Path $AppDir 'node_modules'))) {
            Write-Output "Running npm audit in: $AppDir"
            $raw = & npm audit --json --omit=dev --prefix $AppDir 2>$null
            try {
                $audit = $raw | ConvertFrom-Json
                if ($audit.PSObject.Properties['vulnerabilities']) {
                    foreach ($prop in $audit.vulnerabilities.PSObject.Properties) {
                        $vuln = $prop.Value
                        $findings.Add([PSCustomObject]@{
                            Source   = 'npm'
                            Package  = $prop.Name
                            Severity = $vuln.severity
                            Via      = ($vuln.via | ForEach-Object { if ($_ -is [string]) { $_ } else { $_.title } }) -join '; '
                            Fix      = $vuln.fixAvailable
                        })
                    }
                }
            } catch {
                Write-Warning "Failed to parse npm audit output: $_"
            }
        } else {
            Write-Warning 'npm: node_modules not found. Run pnpm install first.'
        }
    }

    # pip-audit
    if (-not $SkipPip) {
        if (-not $RequirementsFile) {
            $RequirementsFile = Join-Path $script:RepoRoot 'scripts/requirements.txt'
        }

        if (Test-Path $RequirementsFile) {
            if (Get-Command pip-audit -ErrorAction SilentlyContinue) {
                Write-Output "Running pip-audit on: $RequirementsFile"
                $raw = & pip-audit -r $RequirementsFile --format json 2>$null
                try {
                    $pipResult = $raw | ConvertFrom-Json
                    $pipVulns = if ($pipResult.PSObject.Properties['dependencies']) { $pipResult.dependencies } else { @($pipResult) }
                    foreach ($v in $pipVulns) {
                        $hasFix = $v.PSObject.Properties['fix_versions'] -and $v.fix_versions
                        $findings.Add([PSCustomObject]@{
                            Source   = 'pip'
                            Package  = "$($v.name)==$($v.version)"
                            Severity = if ($hasFix) { 'high' } else { 'medium' }
                            Via      = if ($v.PSObject.Properties['id']) { $v.id } else { 'unknown' }
                            Fix      = if ($hasFix) { "Upgrade to $(@($v.fix_versions) -join ' or ')" } else { 'No fix available' }
                        })
                    }
                } catch {
                    Write-Warning "Failed to parse pip-audit output: $_"
                }
            } else {
                Write-Warning 'pip-audit not installed. Run: pip install pip-audit'
            }
        }
    }

    # SLA deadlines
    $slaMap = @{ critical = '48 hours'; high = '7 days'; moderate = '30 days'; medium = '30 days'; low = 'Next cycle' }

    Write-Output ""
    Write-Output "=== Dependency Audit ==="
    Write-Output "  Total findings: $($findings.Count)"

    if ($findings.Count -gt 0) {
        foreach ($sev in @('critical', 'high', 'moderate', 'medium', 'low')) {
            $group = $findings | Where-Object { $_.Severity -eq $sev }
            if ($group) {
                $sla = $slaMap[$sev]
                Write-Output ""
                Write-Output "  [$($sev.ToUpper())] ($($group.Count)) — SLA: $sla"
                foreach ($f in $group) {
                    Write-Output "    $($f.Source): $($f.Package) — $($f.Via)"
                }
            }
        }
    }

    [PSCustomObject]@{
        TotalFindings = $findings.Count
        Critical      = @($findings | Where-Object Severity -eq 'critical')
        High          = @($findings | Where-Object Severity -eq 'high')
        Medium        = @($findings | Where-Object { $_.Severity -in @('moderate', 'medium') })
        Low           = @($findings | Where-Object Severity -eq 'low')
        AllFindings   = @($findings)
    }
}
