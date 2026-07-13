# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Organization actor-edge integrity validator (t/1526).
# Dot-sourced by AITriad.psm1 — do NOT export (called from Import-OrganizationEdge
# and can be run manually via InModuleScope).

function Test-OrganizationEdgeIntegrity {
    <#
    .SYNOPSIS
        Validates organization_edges.json content against schema rules.
    .DESCRIPTION
        Returns an OrganizationEdgeIntegrityReport. Checks:
          - Required fields (source, target, type)
          - source matches ^org-\d{3,}$
          - type validates via Resolve-OrganizationEdgeType (drop-on-unknown → error)
          - target format matches the type's expected family:
              * ALLIED_WITH / COMPETES_WITH / FUNDS  → org-*
              * SUPPORTS_POLICY / OPPOSES_POLICY     → pol-*
              * ADVOCATES_FOR / OPPOSES              → sit-* or POV BDI node (acc-/saf-/skp-*)
              * ENGAGED_WITH                         → sit-*
              * PUBLISHED                            → src-*
          - status enum (approved | proposed | disputed | rejected) if present
          - discovered_at ISO-8601 YYYY-MM-DD if present
          - Composite dedup on (source, target, type)
          - No self-loops (source == target)
          - With -ResolveRefs, cross-checks org-* / sit-* / pol-* targets against the
            corresponding registries (missing registry → warning, not error)

        Pass = true iff zero Errors (warnings are non-blocking).
    .PARAMETER Path
        Optional explicit path. Defaults to Get-OrganizationEdgesFilePath.
    .PARAMETER ResolveRefs
        Also validate that every org-/sit-/pol- target resolves to an existing record.
    .OUTPUTS
        [OrganizationEdgeIntegrityReport]
    .EXAMPLE
        Test-OrganizationEdgeIntegrity
    .EXAMPLE
        Test-OrganizationEdgeIntegrity -ResolveRefs
    #>
    [CmdletBinding()]
    [OutputType([OrganizationEdgeIntegrityReport])]
    param(
        [string]$Path,
        [switch]$ResolveRefs
    )

    Set-StrictMode -Version Latest

    if (-not $Path) { $Path = Get-OrganizationEdgesFilePath }
    $store = Get-OrganizationEdgesStore -Force -Path $Path

    $validStatuses = @('approved','proposed','disputed','rejected')
    $orgIdRegex    = '^org-\d{3,}$'
    $sitIdRegex    = '^sit-\d+$'
    $polIdRegex    = '^pol-\d+$'
    # Source/publication targets are slug-style doc_ids in this dataset (e.g., 'anthropic-rsp-2023'),
    # not src-* prefixed — see taxonomy/Origin/source_evidence_index.json values. Accept any
    # lowercase slug that is NOT already claimed by another id family (org-/sit-/pol-/BDI shortcut
    # via the family switch below), and forbid the reserved prefixes to prevent misrouting.
    $srcIdRegex    = '^(?!org-|sit-|pol-)[a-z0-9][a-z0-9._-]{2,}$'
    $bdiIdRegex    = '^(acc|saf|skp)-(beliefs|desires|intentions)-\d+$'
    $dateRegex     = '^\d{4}-\d{2}-\d{2}$'

    $orgTypes    = @('ALLIED_WITH','COMPETES_WITH','FUNDS')
    $policyTypes = @('SUPPORTS_POLICY','OPPOSES_POLICY')
    $sitTypes    = @('ENGAGED_WITH')
    $stanceTypes = @('ADVOCATES_FOR','OPPOSES')     # sit-* OR BDI node
    $srcTypes    = @('PUBLISHED')

    $issues = [System.Collections.Generic.List[OrganizationEdgeIntegrityIssue]]::new()
    $seenKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    $edges = @()
    if ($store.PSObject.Properties['edges']) { $edges = @($store.edges) }

    # Reference resolution setup — best-effort; missing registries downgrade to warning.
    $validOrgIds = $null
    $validSitIds = $null
    $validPolIds = $null
    if ($ResolveRefs) {
        try {
            $tax = Get-TaxonomyDir
            $orgPath = Join-Path $tax 'organizations.json'
            $sitPath = Join-Path $tax 'situations.json'
            $polPath = Join-Path $tax 'policy_actions.json'
            if (Test-Path $orgPath) {
                $orgData = Get-Content -Raw -Path $orgPath -Encoding utf8 | ConvertFrom-Json
                $validOrgIds = [System.Collections.Generic.HashSet[string]]::new()
                foreach ($o in @($orgData.organizations)) {
                    if ($o.PSObject.Properties['id']) { [void]$validOrgIds.Add([string]$o.id) }
                }
            }
            if (Test-Path $sitPath) {
                $sitData = Get-Content -Raw -Path $sitPath -Encoding utf8 | ConvertFrom-Json
                $validSitIds = [System.Collections.Generic.HashSet[string]]::new()
                foreach ($n in @($sitData.nodes)) {
                    if ($n.PSObject.Properties['id']) { [void]$validSitIds.Add([string]$n.id) }
                }
            }
            if (Test-Path $polPath) {
                $polData = Get-Content -Raw -Path $polPath -Encoding utf8 | ConvertFrom-Json
                $validPolIds = [System.Collections.Generic.HashSet[string]]::new()
                foreach ($p in @($polData.policies)) {
                    if ($p.PSObject.Properties['id']) { [void]$validPolIds.Add([string]$p.id) }
                }
            }
        } catch {
            $iss = [OrganizationEdgeIntegrityIssue]::new()
            $iss.EdgeIndex = -1; $iss.Severity = 'warning'; $iss.Field = 'ResolveRefs'
            $iss.Message = "Failed to load reference registries: $($_.Exception.Message)"
            $issues.Add($iss)
        }
    }

    for ($idx = 0; $idx -lt @($edges).Count; $idx++) {
        $edge = $edges[$idx]

        $source = if ($edge.PSObject.Properties['source']) { [string]$edge.source } else { '' }
        $target = if ($edge.PSObject.Properties['target']) { [string]$edge.target } else { '' }
        $type   = if ($edge.PSObject.Properties['type'])   { [string]$edge.type }   else { '' }

        # source shape
        if ([string]::IsNullOrWhiteSpace($source)) {
            $iss = [OrganizationEdgeIntegrityIssue]::new()
            $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
            $iss.Severity = 'error'; $iss.Field = 'source'
            $iss.Message = 'Missing required field: source'
            $issues.Add($iss)
        } elseif ($source -notmatch $orgIdRegex) {
            $iss = [OrganizationEdgeIntegrityIssue]::new()
            $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
            $iss.Severity = 'error'; $iss.Field = 'source'
            $iss.Message = "source '$source' does not match $orgIdRegex"
            $issues.Add($iss)
        } elseif ($validOrgIds -and -not $validOrgIds.Contains($source)) {
            $iss = [OrganizationEdgeIntegrityIssue]::new()
            $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
            $iss.Severity = 'error'; $iss.Field = 'source'
            $iss.Message = "source '$source' does not resolve to any record in organizations.json"
            $issues.Add($iss)
        }

        # target shape
        if ([string]::IsNullOrWhiteSpace($target)) {
            $iss = [OrganizationEdgeIntegrityIssue]::new()
            $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
            $iss.Severity = 'error'; $iss.Field = 'target'
            $iss.Message = 'Missing required field: target'
            $issues.Add($iss)
        }

        # type validation via canonical registry
        $typeOk = $false
        if ([string]::IsNullOrWhiteSpace($type)) {
            $iss = [OrganizationEdgeIntegrityIssue]::new()
            $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
            $iss.Severity = 'error'; $iss.Field = 'type'
            $iss.Message = 'Missing required field: type'
            $issues.Add($iss)
        } else {
            $res = Resolve-OrganizationEdgeType -Type $type
            if ($res.Action -ne 'accept') {
                $iss = [OrganizationEdgeIntegrityIssue]::new()
                $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
                $iss.Severity = 'error'; $iss.Field = 'type'
                $iss.Message = "type '$type' rejected by Resolve-OrganizationEdgeType: $($res.Reason)"
                $issues.Add($iss)
            } else {
                $type = $res.Type   # normalize to upper-case for downstream family check
                $typeOk = $true
            }
        }

        # target family check (only if type resolved and target present)
        if ($typeOk -and -not [string]::IsNullOrWhiteSpace($target)) {
            $familyOk = $false; $expectedFamily = ''; $registryToCheck = $null
            if ($orgTypes -contains $type) {
                $expectedFamily = "org-* ($($orgTypes -join '/'))"
                $familyOk = $target -match $orgIdRegex
                $registryToCheck = 'org'
            } elseif ($policyTypes -contains $type) {
                $expectedFamily = "pol-* ($($policyTypes -join '/'))"
                $familyOk = $target -match $polIdRegex
                $registryToCheck = 'pol'
            } elseif ($sitTypes -contains $type) {
                $expectedFamily = "sit-* ($($sitTypes -join '/'))"
                $familyOk = $target -match $sitIdRegex
                $registryToCheck = 'sit'
            } elseif ($stanceTypes -contains $type) {
                $expectedFamily = "sit-* or BDI node ($($stanceTypes -join '/'))"
                $familyOk = ($target -match $sitIdRegex) -or ($target -match $bdiIdRegex)
                $registryToCheck = if ($target -match $sitIdRegex) { 'sit' } else { $null }   # no BDI-node registry check
            } elseif ($srcTypes -contains $type) {
                $expectedFamily = "src-* ($($srcTypes -join '/'))"
                $familyOk = $target -match $srcIdRegex
                $registryToCheck = $null   # source records aren't cheap to preload; skip
            }
            if (-not $familyOk) {
                $iss = [OrganizationEdgeIntegrityIssue]::new()
                $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
                $iss.Severity = 'error'; $iss.Field = 'target'
                $iss.Message = "target '$target' does not match expected family for type $type — expected $expectedFamily"
                $issues.Add($iss)
            } elseif ($registryToCheck) {
                switch ($registryToCheck) {
                    'org' { if ($validOrgIds -and -not $validOrgIds.Contains($target)) {
                            $iss = [OrganizationEdgeIntegrityIssue]::new()
                            $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
                            $iss.Severity = 'error'; $iss.Field = 'target'
                            $iss.Message = "target '$target' does not resolve to any record in organizations.json"
                            $issues.Add($iss)
                        } }
                    'sit' { if ($validSitIds -and -not $validSitIds.Contains($target)) {
                            $iss = [OrganizationEdgeIntegrityIssue]::new()
                            $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
                            $iss.Severity = 'error'; $iss.Field = 'target'
                            $iss.Message = "target '$target' does not resolve to any record in situations.json"
                            $issues.Add($iss)
                        } }
                    'pol' { if ($validPolIds -and -not $validPolIds.Contains($target)) {
                            $iss = [OrganizationEdgeIntegrityIssue]::new()
                            $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
                            $iss.Severity = 'error'; $iss.Field = 'target'
                            $iss.Message = "target '$target' does not resolve to any record in policy_actions.json"
                            $issues.Add($iss)
                        } }
                }
            }
        }

        # No self-loops
        if (-not [string]::IsNullOrWhiteSpace($source) -and $source -eq $target) {
            $iss = [OrganizationEdgeIntegrityIssue]::new()
            $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
            $iss.Severity = 'error'; $iss.Field = 'source/target'
            $iss.Message = "self-loop: source and target are both '$source'"
            $issues.Add($iss)
        }

        # Composite dedup — (source, target, type) must be unique.
        if (-not [string]::IsNullOrWhiteSpace($source) -and -not [string]::IsNullOrWhiteSpace($target) -and -not [string]::IsNullOrWhiteSpace($type)) {
            $key = "$source|$target|$type"
            if (-not $seenKeys.Add($key)) {
                $iss = [OrganizationEdgeIntegrityIssue]::new()
                $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
                $iss.Severity = 'error'; $iss.Field = 'source/target/type'
                $iss.Message = "duplicate edge for key ($key)"
                $issues.Add($iss)
            }
        }

        # Optional-field checks
        if ($edge.PSObject.Properties['status'] -and $validStatuses -notcontains [string]$edge.status) {
            $iss = [OrganizationEdgeIntegrityIssue]::new()
            $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
            $iss.Severity = 'warning'; $iss.Field = 'status'
            $iss.Message = "status '$($edge.status)' not in enum: $($validStatuses -join ', ')"
            $issues.Add($iss)
        }
        if ($edge.PSObject.Properties['discovered_at']) {
            $da = [string]$edge.discovered_at
            if (-not [string]::IsNullOrWhiteSpace($da) -and $da -notmatch $dateRegex) {
                $iss = [OrganizationEdgeIntegrityIssue]::new()
                $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
                $iss.Severity = 'warning'; $iss.Field = 'discovered_at'
                $iss.Message = "discovered_at '$da' does not match YYYY-MM-DD"
                $issues.Add($iss)
            }
        }
        if (-not $edge.PSObject.Properties['rationale'] -or [string]::IsNullOrWhiteSpace([string]$edge.rationale)) {
            $iss = [OrganizationEdgeIntegrityIssue]::new()
            $iss.EdgeIndex = $idx; $iss.Source = $source; $iss.Target = $target; $iss.Type = $type
            $iss.Severity = 'warning'; $iss.Field = 'rationale'
            $iss.Message = 'edge has no rationale — makes the relationship opaque'
            $issues.Add($iss)
        }
    }

    $errCount  = @($issues | Where-Object { $_.Severity -eq 'error' }).Count
    $warnCount = @($issues | Where-Object { $_.Severity -eq 'warning' }).Count

    $report = [OrganizationEdgeIntegrityReport]::new()
    $report.Total    = @($edges).Count
    $report.Errors   = $errCount
    $report.Warnings = $warnCount
    $report.Pass     = ($errCount -eq 0)
    $report.Issues   = @($issues)
    return $report
}
