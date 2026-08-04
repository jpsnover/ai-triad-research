function Invoke-LicenseAudit {
    <#
    .SYNOPSIS
        Audits npm dependencies for license compliance.
    .DESCRIPTION
        Runs license generation, then compares each dependency's license against
        configurable allow/deny lists. Reports banned licenses, unknown licenses,
        and packages requiring manual review.
    .PARAMETER AppDir
        App directory containing package.json. Defaults to auto-discovery.
    .PARAMETER AllowedLicenses
        Array of SPDX license identifiers that are always allowed.
        Default: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0, 0BSD, Unlicense.
    .PARAMETER BannedLicenses
        Array of SPDX identifiers that are never allowed.
        Default: GPL-3.0-only, AGPL-3.0-only, SSPL-1.0, BUSL-1.1.
    .EXAMPLE
        Invoke-LicenseAudit
    .EXAMPLE
        Invoke-LicenseAudit -AppDir ./app -BannedLicenses @('GPL-3.0-only', 'AGPL-3.0-only')
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [string]$AppDir,

        [Parameter()]
        [string[]]$AllowedLicenses = @(
            'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC',
            'CC0-1.0', '0BSD', 'Unlicense', 'BlueOak-1.0.0', 'CC-BY-4.0'
        ),

        [Parameter()]
        [string[]]$BannedLicenses = @('GPL-3.0-only', 'AGPL-3.0-only', 'SSPL-1.0', 'BUSL-1.1')
    )

    Set-StrictMode -Version Latest

    if (-not $AppDir) {
        $AppDir = Get-ChildItem -Path $script:RepoRoot -Filter 'package.json' -Depth 2 |
            Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' } |
            ForEach-Object { $_.DirectoryName } |
            Select-Object -First 1
    }

    if (-not $AppDir -or -not (Test-Path (Join-Path $AppDir 'package.json'))) {
        New-ActionableError `
            -Goal 'Run license audit' `
            -Problem 'No package.json found' `
            -Location 'Invoke-LicenseAudit' `
            -NextSteps @('Pass -AppDir pointing to a directory with package.json', 'Run pnpm install first') -Throw
    }

    Write-Output "Auditing licenses in: $AppDir"

    # Use npx license-checker-rsync-3 (fast, JSON output)
    $raw = $null
    if (Get-Command npx -ErrorAction SilentlyContinue) {
        $raw = & npx --yes license-checker-rsync-3 --json --start $AppDir 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $raw) {
            Write-Warning 'license-checker not available, using npm ls --json --all'
            $raw = & npm ls --json --all --prefix $AppDir 2>$null
        }
    } else {
        Write-Warning 'npx not found. Install Node.js to run license audits.'
        return
    }

    $packages = $null
    try { $packages = $raw | ConvertFrom-Json } catch { Write-Warning "Failed to parse license data: $_" }

    if (-not $packages) {
        Write-Warning 'Could not parse license data. Run pnpm install and try again.'
        return
    }

    $allowed = [System.Collections.Generic.List[object]]::new()
    $banned = [System.Collections.Generic.List[object]]::new()
    $review = [System.Collections.Generic.List[object]]::new()

    foreach ($prop in $packages.PSObject.Properties) {
        $name = $prop.Name
        $license = if ($prop.Value.PSObject.Properties['licenses']) { $prop.Value.licenses }
                   elseif ($prop.Value.PSObject.Properties['license']) { $prop.Value.license }
                   else { 'UNKNOWN' }

        $licStr = [string]$license

        $entry = [PSCustomObject]@{
            Package = $name
            License = $licStr
        }

        if ($BannedLicenses -contains $licStr) { $banned.Add($entry) }
        elseif ($AllowedLicenses -contains $licStr) { $allowed.Add($entry) }
        else { $review.Add($entry) }
    }

    Write-Output ""
    Write-Output "=== License Audit Results ==="
    Write-Output "  Allowed: $($allowed.Count)  |  Banned: $($banned.Count)  |  Review: $($review.Count)"

    if ($banned.Count -gt 0) {
        Write-Output ""
        Write-Warning "BANNED licenses found:"
        $banned | Format-Table -AutoSize
    }

    if ($review.Count -gt 0) {
        Write-Output ""
        Write-Output "Requires manual review:"
        $review | Format-Table -AutoSize
    }

    [PSCustomObject]@{
        Pass           = $banned.Count -eq 0
        AllowedCount   = $allowed.Count
        BannedCount    = $banned.Count
        ReviewCount    = $review.Count
        BannedPackages = @($banned)
        ReviewPackages = @($review)
    }
}
