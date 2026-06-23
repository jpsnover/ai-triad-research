function Test-SBOMCurrency {
    <#
    .SYNOPSIS
        Checks if the SBOM (THIRD-PARTY-NOTICES.txt) is current.
    .DESCRIPTION
        Regenerates the SBOM by running 'npm run licenses', then compares
        the output against the committed version. Reports whether the SBOM
        needs updating.
    .PARAMETER AppDir
        App directory containing the licenses npm script. Auto-discovers if not set.
    .PARAMETER SBOMFile
        Path to the SBOM file to check. Default: THIRD-PARTY-NOTICES.txt in AppDir.
    .PARAMETER AutoCommit
        If the SBOM is stale, regenerate and stage for commit.
    .EXAMPLE
        Test-SBOMCurrency
    .EXAMPLE
        Test-SBOMCurrency -AutoCommit
    #>
    [CmdletBinding()]
    param(
        [Parameter()][string]$AppDir,
        [Parameter()][string]$SBOMFile,
        [switch]$AutoCommit
    )

    Set-StrictMode -Version Latest

    if (-not $AppDir) {
        $AppDir = Get-ChildItem -Path $script:RepoRoot -Filter 'package.json' -Depth 2 |
            Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' } |
            ForEach-Object {
                $pkg = Get-Content $_.FullName -Raw | ConvertFrom-Json
                if ($pkg.scripts -and $pkg.scripts.PSObject.Properties['licenses']) {
                    $_.DirectoryName
                }
            } |
            Where-Object { $_ } |
            Select-Object -First 1
    }

    if (-not $AppDir) {
        Write-Warning 'No app directory with a "licenses" script found.'
        return [PSCustomObject]@{ Current = $null; Checked = $false }
    }

    if (-not $SBOMFile) {
        $SBOMFile = Join-Path $AppDir 'THIRD-PARTY-NOTICES.txt'
    }

    $existed = Test-Path $SBOMFile
    $beforeHash = if ($existed) { (Get-FileHash $SBOMFile).Hash } else { '' }

    Write-Output "Regenerating SBOM in: $AppDir"
    & npm run licenses --prefix $AppDir 2>$null | Out-Null

    $afterHash = if (Test-Path $SBOMFile) { (Get-FileHash $SBOMFile).Hash } else { '' }
    $current = $beforeHash -eq $afterHash

    if ($current) {
        Write-Output "PASS: SBOM is current."
    } else {
        Write-Warning "STALE: SBOM has changed. Review and commit the updated file."
        if ($AutoCommit) {
            & git add $SBOMFile
            Write-Output "Staged $SBOMFile for commit."
        }
    }

    [PSCustomObject]@{
        Current  = $current
        Checked  = $true
        SBOMFile = $SBOMFile
    }
}
