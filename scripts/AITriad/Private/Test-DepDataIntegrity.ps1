# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Test-DepDataIntegrity {
    <#
    .SYNOPSIS
        Section 8 of Invoke-DependencyCheck (t/3910): taxonomy file presence/parseability,
        the install+fix data-clone path, edges.json, and the summaries/sources/conflicts
        directory counts. Extracted verbatim.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)][hashtable]$Ctx,
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][bool]$IsInstallMode,
        [Parameter(Mandatory)][bool]$Fix
    )

    Write-DepSection 'DATA INTEGRITY'

    $TaxDir    = Get-TaxonomyDir
    $TaxFiles  = @('accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json')
    $TotalNodes = 0
    $MissingTax = 0
    foreach ($TF in $TaxFiles) {
        $TFPath = Join-Path $TaxDir $TF
        if (Test-Path $TFPath) {
            try { $TData = Get-Content -Raw -Path $TFPath | ConvertFrom-Json; $TotalNodes += @($TData.nodes).Count }
            catch { Write-DepFail -Ctx $Ctx -Message "$TF — failed to parse JSON" }
        }
        else { Write-DepFail -Ctx $Ctx -Message "$TF — not found in taxonomy/Origin/"; $MissingTax++ }
    }
    if ($TotalNodes -gt 0) { Write-DepPass -Ctx $Ctx -Message "Taxonomy valid ($TotalNodes nodes across $($TaxFiles.Count) POVs)" }

    # If taxonomy data is missing and we're in install+fix mode, clone it from GitHub
    if ($MissingTax -gt 0 -and $IsInstallMode -and $Fix) {
        if (Get-Command git -ErrorAction SilentlyContinue) {
            Write-DepFix 'Downloading AI Triad data from GitHub...'
            try {
                Install-AITriadData
                $Ctx.Fixed++
                Write-DepPass -Ctx $Ctx -Message 'AI Triad data installed'
            }
            catch { Write-DepFail -Ctx $Ctx -Message "Data clone failed: $_" }
        }
        else {
            Write-DepFail -Ctx $Ctx -Message 'Cannot clone data — git is not installed'
        }
    }

    $EdgesPath = Join-Path $TaxDir 'edges.json'
    if (Test-Path $EdgesPath) {
        try { $EData = Get-Content -Raw -Path $EdgesPath | ConvertFrom-Json; Write-DepPass -Ctx $Ctx -Message "edges.json valid ($(@($EData.edges).Count) edges)" }
        catch { Write-DepFail -Ctx $Ctx -Message 'edges.json — failed to parse' }
    }
    else { Write-DepSkip -Message 'edges.json not yet generated' }

    foreach ($DirInfo in @(
        @{ Name = 'summaries'; Filter = '*.json'; Type = 'File' }
        @{ Name = 'sources';   Filter = $null;     Type = 'Directory' }
        @{ Name = 'conflicts'; Filter = '*.json'; Type = 'File' }
    )) {
        $DirPath = Join-Path $RepoRoot $DirInfo.Name
        if (Test-Path $DirPath) {
            $Params = @{ Path = $DirPath }
            if ($DirInfo.Filter) { $Params['Filter'] = $DirInfo.Filter; $Params['File'] = $true }
            else { $Params['Directory'] = $true }
            $Count = (Get-ChildItem @Params).Count
            Write-DepPass -Ctx $Ctx -Message "$($DirInfo.Name)/ — $Count items"
        }
        else { Write-DepSkip -Message "$($DirInfo.Name)/ not found" }
    }
}
