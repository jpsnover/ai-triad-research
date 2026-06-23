function Test-VersionConsistency {
    <#
    .SYNOPSIS
        Verifies version strings match across all configured files.
    .DESCRIPTION
        Reads version strings from the PowerShell module manifest (.psd1),
        package.json, and CLAUDE.md (if present). Reports mismatches so they
        can be corrected before release.

        The file list and extraction patterns are configurable via -VersionSources.
    .PARAMETER VersionSources
        Array of hashtables defining where to find versions. Each entry needs:
          - Path: relative path from repo root
          - Pattern: regex with a capture group for the version string
          - Label: display name
        If not provided, uses built-in defaults for PS manifest + package.json.
    .EXAMPLE
        Test-VersionConsistency
    .EXAMPLE
        Test-VersionConsistency -VersionSources @(
            @{ Path = 'scripts/MyModule/MyModule.psd1'; Pattern = "ModuleVersion\s*=\s*'([^']+)'"; Label = 'PS Manifest' }
            @{ Path = 'app/package.json'; Pattern = '"version":\s*"([^"]+)"'; Label = 'package.json' }
        )
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [hashtable[]]$VersionSources
    )

    Set-StrictMode -Version Latest

    if (-not $VersionSources) {
        # Auto-discover version sources
        $VersionSources = @()

        # PowerShell manifests
        $psd1Files = Get-ChildItem -Path $script:RepoRoot -Filter '*.psd1' -Recurse -Depth 3 |
            Where-Object { $_.FullName -notmatch '[\\/](build|node_modules|\.git)[\\/]' } |
            Select-Object -First 2
        foreach ($psd1 in $psd1Files) {
            $rel = [System.IO.Path]::GetRelativePath($script:RepoRoot, $psd1.FullName)
            $VersionSources += @{
                Path    = $rel
                Pattern = "ModuleVersion\s*=\s*'([^']+)'"
                Label   = "PS Manifest ($($psd1.Name))"
            }
        }

        # package.json files (root + app dirs)
        $pkgFiles = Get-ChildItem -Path $script:RepoRoot -Filter 'package.json' -Depth 2 |
            Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' }
        foreach ($pkg in $pkgFiles) {
            $rel = [System.IO.Path]::GetRelativePath($script:RepoRoot, $pkg.FullName)
            $VersionSources += @{
                Path    = $rel
                Pattern = '"version":\s*"([^"]+)"'
                Label   = "package.json ($($pkg.Directory.Name))"
            }
        }

        # CLAUDE.md version reference (if present)
        $claudeMd = Join-Path $script:RepoRoot 'CLAUDE.md'
        if (Test-Path $claudeMd) {
            $VersionSources += @{
                Path    = 'CLAUDE.md'
                Pattern = '\(v(\d+\.\d+\.\d+)\)'
                Label   = 'CLAUDE.md'
            }
        }
    }

    $versions = [System.Collections.Generic.List[object]]::new()

    foreach ($source in $VersionSources) {
        $fullPath = Join-Path $script:RepoRoot $source.Path
        if (-not (Test-Path $fullPath)) {
            $versions.Add([PSCustomObject]@{
                Label   = $source.Label
                Path    = $source.Path
                Version = $null
                Status  = 'NOT FOUND'
            })
            continue
        }

        $content = Get-Content $fullPath -Raw
        if ($content -match $source.Pattern) {
            $ver = $Matches[1]
        } else {
            $ver = $null
        }

        $versions.Add([PSCustomObject]@{
            Label   = $source.Label
            Path    = $source.Path
            Version = $ver
            Status  = if ($ver) { 'OK' } else { 'NO MATCH' }
        })
    }

    # Check consistency
    $found = @($versions | Where-Object { $_.Version })
    $unique = @($found | Select-Object -ExpandProperty Version -Unique)
    $consistent = $unique.Count -le 1 -and $found.Count -gt 0

    if ($consistent) {
        Write-Output "PASS: All version sources agree on v$($unique[0])"
    } elseif ($unique.Count -gt 1) {
        Write-Warning "FAIL: Version mismatch detected!"
    } elseif ($found.Count -eq 0) {
        Write-Warning "No version strings found in any source."
    }

    $versions | Format-Table Label, Version, Status, Path -AutoSize

    [PSCustomObject]@{
        Consistent = $consistent
        Versions   = @($versions)
        UniqueVersions = $unique
    }
}
