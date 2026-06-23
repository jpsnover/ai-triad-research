function Get-ProjectHealth {
    <#
    .SYNOPSIS
        Runs an aggregate health check across all project dimensions.
    .DESCRIPTION
        Orchestrates version consistency, SBOM currency, dependency audit,
        and ADR status into a single health dashboard. Returns structured
        results suitable for automation or display.
    .PARAMETER Quick
        Run only fast checks (version consistency, ADR index). Skip npm audit
        and SBOM regeneration.
    .EXAMPLE
        Get-ProjectHealth
    .EXAMPLE
        Get-ProjectHealth -Quick
    #>
    [CmdletBinding()]
    param(
        [switch]$Quick
    )

    Set-StrictMode -Version Latest

    Write-Output "=== Project Health Check ==="
    Write-Output ""

    $checks = [System.Collections.Generic.List[object]]::new()

    # 1. Version consistency
    Write-Output "--- Version Consistency ---"
    $vc = @(Test-VersionConsistency)[-1]
    $vcDetail = if ($vc.Consistent -and @($vc.UniqueVersions).Count -gt 0) {
        "v$(@($vc.UniqueVersions)[0])"
    } elseif (@($vc.UniqueVersions).Count -gt 1) {
        "Mismatch: $($vc.UniqueVersions -join ', ')"
    } else { 'No versions found' }
    $checks.Add([PSCustomObject]@{
        Check  = 'Version Consistency'
        Pass   = $vc.Consistent
        Detail = $vcDetail
    })

    # 2. ADR status
    Write-Output ""
    Write-Output "--- ADR Status ---"
    $adrs = Get-ADRIndex
    $activeCount = @($adrs | Where-Object Status -eq 'accepted').Count
    $proposedCount = @($adrs | Where-Object Status -eq 'proposed').Count
    $deprecatedCount = @($adrs | Where-Object Status -eq 'deprecated').Count
    Write-Output "  Active: $activeCount  Proposed: $proposedCount  Deprecated: $deprecatedCount"
    $checks.Add([PSCustomObject]@{
        Check  = 'ADR Status'
        Pass   = $true
        Detail = "Active: $activeCount, Proposed: $proposedCount, Deprecated: $deprecatedCount"
    })

    if (-not $Quick) {
        # 3. SBOM currency
        Write-Output ""
        Write-Output "--- SBOM Currency ---"
        $sbom = @(Test-SBOMCurrency)[-1]
        if ($sbom.Checked) {
            $checks.Add([PSCustomObject]@{
                Check  = 'SBOM Currency'
                Pass   = $sbom.Current
                Detail = if ($sbom.Current) { 'Up to date' } else { 'Stale — needs regeneration' }
            })
        }

        # 4. Dependency audit
        Write-Output ""
        Write-Output "--- Dependency Audit ---"
        $deps = @(Invoke-DependencyAudit)[-1]
        $checks.Add([PSCustomObject]@{
            Check  = 'Dependency Audit'
            Pass   = $deps.Critical.Count -eq 0 -and $deps.High.Count -eq 0
            Detail = "Critical: $($deps.Critical.Count), High: $($deps.High.Count), Medium: $($deps.Medium.Count), Low: $($deps.Low.Count)"
        })
    }

    # Summary
    $allPass = @($checks | Where-Object { -not $_.Pass }).Count -eq 0
    Write-Output ""
    Write-Output "=== Summary ==="
    $checks | Format-Table Check, @{N='Status';E={if ($_.Pass) { 'PASS' } else { 'FAIL' }}}, Detail -AutoSize

    if ($allPass) { Write-Output "Overall: HEALTHY" }
    else { Write-Warning "Overall: ISSUES FOUND" }

    [PSCustomObject]@{
        Healthy = $allPass
        Checks  = @($checks)
    }
}
