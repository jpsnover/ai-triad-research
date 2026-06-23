function Initialize-ProjectModule {
    <#
    .SYNOPSIS
        Renames the template module to match your project after cloning.
    .DESCRIPTION
        After creating a new repo from the template, run this cmdlet to rename
        the module directory, manifest, and root module from 'Project-Template'
        to your project name. Also updates GUID and author in the manifest.
    .PARAMETER ProjectName
        The name for your project's PowerShell module (e.g., 'MyProject').
        Must be a valid PowerShell module name (alphanumeric + hyphens).
    .PARAMETER Author
        Author name for the module manifest. Defaults to git user.name.
    .EXAMPLE
        Initialize-ProjectModule -ProjectName 'ThreatAnalyzer'
    .EXAMPLE
        Initialize-ProjectModule -ProjectName 'DataPipeline' -Author 'Jane Doe'
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)]
        [ValidatePattern('^[A-Za-z][A-Za-z0-9-]+$')]
        [string]$ProjectName,

        [Parameter()]
        [string]$Author
    )

    Set-StrictMode -Version Latest

    $templateDir = Join-Path $script:RepoRoot 'scripts/Project-Template'
    $targetDir = Join-Path $script:RepoRoot "scripts/$ProjectName"

    if (-not (Test-Path $templateDir)) {
        New-ActionableError `
            -Goal "Initialize project module as '$ProjectName'" `
            -Problem "Template directory not found: $templateDir" `
            -Location 'Initialize-ProjectModule' `
            -NextSteps @(
                'Ensure you are running from a repo cloned from the project template'
                'The scripts/Project-Template/ directory must exist'
            ) -Throw
    }

    if (Test-Path $targetDir) {
        New-ActionableError `
            -Goal "Initialize project module as '$ProjectName'" `
            -Problem "Target directory already exists: $targetDir" `
            -Location 'Initialize-ProjectModule' `
            -NextSteps @(
                'The module has already been initialized, or a conflict exists'
                'Remove the existing directory if you want to re-initialize'
            ) -Throw
    }

    if (-not $Author) {
        try { $Author = (git config user.name 2>$null) } catch { }
        if (-not $Author) { $Author = $env:USERNAME ?? $env:USER ?? 'Unknown' }
    }

    $newGuid = [guid]::NewGuid().ToString()

    if ($PSCmdlet.ShouldProcess($templateDir, "Rename to scripts/$ProjectName and update references")) {
        # Rename directory
        Rename-Item -Path $templateDir -NewName $ProjectName

        # Rename .psd1 and .psm1
        $oldPsd1 = Join-Path $targetDir 'Project-Template.psd1'
        $oldPsm1 = Join-Path $targetDir 'Project-Template.psm1'
        $newPsd1 = Join-Path $targetDir "$ProjectName.psd1"
        $newPsm1 = Join-Path $targetDir "$ProjectName.psm1"

        if (Test-Path $oldPsd1) { Rename-Item $oldPsd1 "$ProjectName.psd1" }
        if (Test-Path $oldPsm1) { Rename-Item $oldPsm1 "$ProjectName.psm1" }

        # Update manifest content
        if (Test-Path $newPsd1) {
            $content = Get-Content $newPsd1 -Raw
            $content = $content -replace "RootModule\s*=\s*'Project-Template\.psm1'", "RootModule = '$ProjectName.psm1'"
            $content = $content -replace "GUID\s*=\s*'[^']+'", "GUID = '$newGuid'"
            $content = $content -replace "Author\s*=\s*'[^']+'", "Author = '$Author'"
            $content = $content -replace 'Rename this module.*after cloning\.', "PowerShell module for $ProjectName."
            Set-Content -Path $newPsd1 -Value $content -Encoding utf8NoBOM
        }

        # Update root module comment
        if (Test-Path $newPsm1) {
            $content = Get-Content $newPsm1 -Raw
            $content = $content -replace 'Project-Template root module', "$ProjectName root module"
            $content = $content -replace 'Rename this file.*template\.', "Root module for $ProjectName."
            Set-Content -Path $newPsm1 -Value $content -Encoding utf8NoBOM
        }

        Write-Output "Module initialized: scripts/$ProjectName/"
        Write-Output "  Manifest: $ProjectName.psd1 (GUID: $newGuid)"
        Write-Output "  Author: $Author"
        Write-Output ""
        Write-Output "Next steps:"
        Write-Output "  1. Import-Module ./scripts/$ProjectName/$ProjectName.psm1"
        Write-Output "  2. Add your project-specific cmdlets to scripts/$ProjectName/Public/"
        Write-Output "  3. Update the Description in $ProjectName.psd1"

        [PSCustomObject]@{
            ProjectName = $ProjectName
            ModuleDir   = $targetDir
            Manifest    = Join-Path $targetDir "$ProjectName.psd1"
            GUID        = $newGuid
            Author      = $Author
        }
    }
}
