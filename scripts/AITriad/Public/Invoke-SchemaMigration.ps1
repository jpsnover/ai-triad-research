# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

function Invoke-SchemaMigration {
    <#
    .SYNOPSIS
        Migrates taxonomy data from one schema version to another.
    .DESCRIPTION
        Detects the current data schema version by inspecting taxonomy nodes
        and the policy registry, then applies the necessary migration steps.

        Schema detection:
        - If nodes have policy_actions with policy_id fields -> 1.1.0+
        - If nodes have policy_actions without policy_id     -> 1.0.0
        - If nodes have no policy_actions at all              -> 0.x (pre-policy)

        Migration steps:
        - 1.0.0 -> 1.1.0: Calls Update-PolicyRegistry -Fix to assign IDs to
          all unregistered policy_actions entries.
        - Any version: Regenerates embeddings via Update-TaxEmbeddings.
        - Bumps TAXONOMY_VERSION file to reflect the migration.
    .PARAMETER TargetVersion
        The schema version to migrate to. Defaults to '1.1.0'.
    .PARAMETER DryRun
        Show what would be done without making changes.
    .PARAMETER PassThru
        Return a migration summary object.
    .EXAMPLE
        Invoke-SchemaMigration
    .EXAMPLE
        Invoke-SchemaMigration -DryRun
    .EXAMPLE
        Invoke-SchemaMigration -PassThru
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [string]$TargetVersion = '1.1.0',

        [switch]$DryRun,

        [switch]$PassThru
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # -- Paths -----------------------------------------------------------------
    $TaxDir      = Get-TaxonomyDir
    $VersionFile = Get-VersionFile

    if (-not (Test-Path $TaxDir)) {
        Write-Fail "Taxonomy directory not found: $TaxDir"
        throw 'Taxonomy directory not found'
    }

    # -- Detect current schema version -----------------------------------------
    Write-Step 'Detecting current data schema'

    $PovFiles = @('accelerationist', 'safetyist', 'skeptic', 'situations')
    $TotalNodes           = 0
    $NodesWithPolicyId    = 0
    $NodesWithActions     = 0
    $NodesWithoutPolicyId = 0

    foreach ($PovKey in $PovFiles) {
        $FilePath = Join-Path $TaxDir "$PovKey.json"
        if (-not (Test-Path $FilePath)) { continue }
        $FileData = Get-Content -Raw -Path $FilePath | ConvertFrom-Json

        foreach ($Node in $FileData.nodes) {
            $TotalNodes++
            if (-not $Node.PSObject.Properties['graph_attributes'] -or $null -eq $Node.graph_attributes) { continue }
            if (-not $Node.graph_attributes.PSObject.Properties['policy_actions']) { continue }

            foreach ($PA in $Node.graph_attributes.policy_actions) {
                $NodesWithActions++
                if ($PA.PSObject.Properties['policy_id'] -and $null -ne $PA.policy_id) {
                    $NodesWithPolicyId++
                }
                else {
                    $NodesWithoutPolicyId++
                }
            }
        }
    }

    # Determine detected version
    if ($NodesWithActions -eq 0) {
        $DetectedVersion = '0.x'
    }
    elseif ($NodesWithoutPolicyId -gt 0) {
        $DetectedVersion = '1.0.0'
    }
    else {
        $DetectedVersion = '1.1.0'
    }

    Write-OK "Total nodes scanned   : $TotalNodes"
    Write-OK "Policy actions found  : $NodesWithActions"
    Write-OK "  With policy_id      : $NodesWithPolicyId"
    Write-OK "  Without policy_id   : $NodesWithoutPolicyId"
    Write-OK "Detected schema       : $DetectedVersion"
    Write-OK "Target schema         : $TargetVersion"

    # -- Read current taxonomy version -----------------------------------------
    if (Test-Path $VersionFile) {
        $CurrentTaxVersion = (Get-Content -Path $VersionFile -Raw).Trim()
    }
    else {
        $CurrentTaxVersion = '0.0.0'
    }
    Write-OK "Current TAXONOMY_VERSION: $CurrentTaxVersion"

    # -- DryRun ----------------------------------------------------------------
    if ($DryRun) {
        Write-Host "`n$('=' * 60)" -ForegroundColor DarkGray
        Write-Host '  DRY RUN -- Migration Plan' -ForegroundColor Yellow
        Write-Host "$('=' * 60)" -ForegroundColor DarkGray

        if ($DetectedVersion -eq '1.0.0') {
            Write-Host '  [1] 1.0.0 -> 1.1.0: Update-PolicyRegistry -Fix' -ForegroundColor Cyan
            Write-Host "      Assigns policy_id to $NodesWithoutPolicyId unregistered action(s)" -ForegroundColor White
        }
        elseif ($DetectedVersion -eq '0.x') {
            Write-Host '  [1] 0.x -> 1.1.0: No policy actions to migrate' -ForegroundColor Gray
        }
        else {
            Write-Host '  [1] Schema already at 1.1.0 -- no ID assignment needed' -ForegroundColor Green
        }

        Write-Host '  [2] Regenerate embeddings via Update-TaxEmbeddings' -ForegroundColor Cyan
        Write-Host "  [3] Bump TAXONOMY_VERSION: $CurrentTaxVersion -> (incremented)" -ForegroundColor Cyan
        Write-Host "$('=' * 60)" -ForegroundColor DarkGray
        Write-Host '  No changes made.' -ForegroundColor Yellow
        Write-Host ''

        if ($PassThru) {
            return [PSCustomObject]@{
                DetectedSchema = $DetectedVersion
                TargetSchema   = $TargetVersion
                DryRun         = $true
                MigratedIds    = 0
                EmbeddingsRegen = $false
                VersionBumped  = $false
            }
        }
        return
    }

    # -- Step 1: Schema-specific migration -------------------------------------
    $MigratedIds = 0

    if ($DetectedVersion -eq '1.0.0') {
        Write-Step '1.0.0 -> 1.1.0: Assigning policy IDs to unregistered actions'

        if ($PSCmdlet.ShouldProcess('policy_actions.json', 'Rebuild registry and assign IDs')) {
            $RegistryResult = Update-PolicyRegistry -Fix -Confirm:$false -PassThru
            $MigratedIds = $RegistryResult.Unregistered
            Write-OK "Registry rebuilt: $($RegistryResult.TotalPolicies) policies, $MigratedIds newly assigned"
        }
    }
    elseif ($DetectedVersion -eq '0.x') {
        Write-Info 'No policy actions found -- skipping ID assignment'
    }
    else {
        Write-Info 'Schema already at 1.1.0 -- running registry rebuild for consistency'
        if ($PSCmdlet.ShouldProcess('policy_actions.json', 'Rebuild registry')) {
            Update-PolicyRegistry -Fix -Confirm:$false | Out-Null
            Write-OK 'Registry consistency check complete'
        }
    }

    # -- Step 2: Regenerate embeddings -----------------------------------------
    Write-Step 'Regenerating taxonomy embeddings'

    $EmbeddingsRegen = $false
    if ($PSCmdlet.ShouldProcess('embeddings.json', 'Regenerate taxonomy embeddings')) {
        try {
            Update-TaxEmbeddings
            $EmbeddingsRegen = $true
            Write-OK 'Embeddings regenerated'
        }
        catch {
            Write-Warn "Embeddings regeneration failed: $_ -- you can re-run Update-TaxEmbeddings manually"
        }
    }

    # -- Step 3: Bump TAXONOMY_VERSION -----------------------------------------
    Write-Step 'Bumping TAXONOMY_VERSION'

    $VersionBumped = $false
    $Parts = $CurrentTaxVersion -split '\.'
    if ($Parts.Count -ge 3) {
        $NewPatch = ([int]$Parts[2]) + 1
        $NewVersion = "$($Parts[0]).$($Parts[1]).$NewPatch"
    }
    else {
        $NewVersion = '1.1.0'
    }

    if ($PSCmdlet.ShouldProcess($VersionFile, "Bump version $CurrentTaxVersion -> $NewVersion")) {
        Write-Utf8NoBom -Path $VersionFile -Value $NewVersion  -NoNewline
        $VersionBumped = $true
        Write-OK "TAXONOMY_VERSION bumped: $CurrentTaxVersion -> $NewVersion"
    }

    # -- Summary ---------------------------------------------------------------
    Write-Host ''
    Write-Host '=== Schema Migration Complete ===' -ForegroundColor Cyan
    Write-Host "  Detected schema : $DetectedVersion" -ForegroundColor White
    Write-Host "  Target schema   : $TargetVersion" -ForegroundColor White
    Write-Host "  Migrated IDs    : $MigratedIds" -ForegroundColor $(if ($MigratedIds -gt 0) { 'Green' } else { 'Gray' })
    Write-Host "  Embeddings      : $(if ($EmbeddingsRegen) { 'regenerated' } else { 'skipped' })" -ForegroundColor White
    Write-Host "  Version         : $(if ($VersionBumped) { "$CurrentTaxVersion -> $NewVersion" } else { 'unchanged' })" -ForegroundColor White
    Write-Host ''

    if ($PassThru) {
        [PSCustomObject]@{
            DetectedSchema  = $DetectedVersion
            TargetSchema    = $TargetVersion
            DryRun          = $false
            MigratedIds     = $MigratedIds
            EmbeddingsRegen = $EmbeddingsRegen
            VersionBumped   = $VersionBumped
            NewVersion      = if ($VersionBumped) { $NewVersion } else { $CurrentTaxVersion }
        }
    }
}
