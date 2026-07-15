# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

# Organization integrity validator (t/1224).
# Dot-sourced by AITriad.psm1 — do NOT export (called from Import-Organization
# and can be run manually via InModuleScope).

function Test-OrganizationIntegrity {
    <#
    .SYNOPSIS
        Validates organizations.json content against schema rules.
    .DESCRIPTION
        Returns an OrganizationIntegrityReport with per-issue detail. Checks:
          - Required fields (id, name, type)
          - Id format: matches ^org-\d{3}$
          - Id uniqueness across records
          - POV alignment score range: [-1.0, 1.0]
          - Type enum membership
          - Stance enum membership (topic_engagement + policy_engagement)
          - Ref format for topic_ref (sit-*), policy_ref (pol-*)
          - With -ResolveRefs, cross-checks refs against situations.json and
            policy_actions.json (falls back to warning if those files aren't loaded)

        Pass = true iff there are zero Errors (warnings are non-blocking).
    .PARAMETER Path
        Optional explicit path to organizations.json. Defaults to Get-OrganizationsFilePath.
    .PARAMETER ResolveRefs
        Also validate that every topic_ref/policy_ref resolves to an existing
        sit-*/pol-* record in the taxonomy data.
    .OUTPUTS
        [OrganizationIntegrityReport]
    .EXAMPLE
        Test-OrganizationIntegrity
    .EXAMPLE
        Test-OrganizationIntegrity -ResolveRefs
    #>
    [CmdletBinding()]
    [OutputType([OrganizationIntegrityReport])]
    param(
        [string]$Path,
        [switch]$ResolveRefs
    )

    Set-StrictMode -Version Latest

    if (-not $Path) { $Path = Get-OrganizationsFilePath }
    $store = Get-OrganizationsStore -Force -Path $Path

    $validTypes    = @('think_tank','advocacy','regulatory','academic','corporate','intergovernmental','civil_society','standards_body','research_lab')
    $validPovs     = @('accelerationist','safetyist','skeptic')
    $validTopicStances  = @('advocate','opponent','researcher','neutral')
    $validPolicyStances = @('supports','opposes')
    $validStatuses = @('active','dissolved','merged')
    $idRegex = '^org-\d{3,}$'

    $issues = [System.Collections.Generic.List[OrganizationIntegrityIssue]]::new()
    $seenIds = [System.Collections.Generic.HashSet[string]]::new()

    $orgs = @()
    if ($store.PSObject.Properties['organizations']) { $orgs = @($store.organizations) }

    # Reference resolution setup
    $validSitIds = $null
    $validPolIds = $null
    if ($ResolveRefs) {
        try {
            $tax = Get-TaxonomyDir
            $sitPath = Join-Path $tax 'situations.json'
            $polPath = Join-Path $tax 'policy_actions.json'
            if (Test-Path $sitPath) {
                $sitData = Get-Content -Raw -Path $sitPath -Encoding utf8 | ConvertFrom-Json
                $validSitIds = [System.Collections.Generic.HashSet[string]]::new()
                foreach ($n in @($sitData.nodes)) {
                    if ($n.PSObject.Properties['id']) { $validSitIds.Add([string]$n.id) | Out-Null }
                }
            }
            if (Test-Path $polPath) {
                $polData = Get-Content -Raw -Path $polPath -Encoding utf8 | ConvertFrom-Json
                $validPolIds = [System.Collections.Generic.HashSet[string]]::new()
                foreach ($p in @($polData.policies)) {
                    if ($p.PSObject.Properties['id']) { $validPolIds.Add([string]$p.id) | Out-Null }
                }
            }
        } catch {
            $iss = [OrganizationIntegrityIssue]::new()
            $iss.OrgId = ''
            $iss.Severity = 'warning'
            $iss.Field = 'ResolveRefs'
            $iss.Message = "Failed to load reference registries: $($_.Exception.Message)"
            $issues.Add($iss)
        }
    }

    foreach ($rawOrg in $orgs) {
        $id = if ($rawOrg.PSObject.Properties['id']) { [string]$rawOrg.id } else { '' }

        # Required: id
        if ([string]::IsNullOrWhiteSpace($id)) {
            $iss = [OrganizationIntegrityIssue]::new()
            $iss.OrgId = '<missing>'
            $iss.Severity = 'error'
            $iss.Field = 'id'
            $iss.Message = 'Organization record is missing required field: id'
            $issues.Add($iss)
            continue
        }

        if ($id -notmatch $idRegex) {
            $iss = [OrganizationIntegrityIssue]::new()
            $iss.OrgId = $id; $iss.Severity = 'error'; $iss.Field = 'id'
            $iss.Message = "Id '$id' does not match format org-NNN (regex: $idRegex)"
            $issues.Add($iss)
        }

        if (-not $seenIds.Add($id)) {
            $iss = [OrganizationIntegrityIssue]::new()
            $iss.OrgId = $id; $iss.Severity = 'error'; $iss.Field = 'id'
            $iss.Message = "Duplicate organization id: '$id'"
            $issues.Add($iss)
        }

        # Required: name, type
        if (-not $rawOrg.PSObject.Properties['name'] -or [string]::IsNullOrWhiteSpace([string]$rawOrg.name)) {
            $iss = [OrganizationIntegrityIssue]::new()
            $iss.OrgId = $id; $iss.Severity = 'error'; $iss.Field = 'name'
            $iss.Message = 'Missing required field: name'
            $issues.Add($iss)
        }
        if (-not $rawOrg.PSObject.Properties['type']) {
            $iss = [OrganizationIntegrityIssue]::new()
            $iss.OrgId = $id; $iss.Severity = 'error'; $iss.Field = 'type'
            $iss.Message = 'Missing required field: type'
            $issues.Add($iss)
        } elseif ($validTypes -notcontains [string]$rawOrg.type) {
            $iss = [OrganizationIntegrityIssue]::new()
            $iss.OrgId = $id; $iss.Severity = 'error'; $iss.Field = 'type'
            $iss.Message = "Type '$($rawOrg.type)' is not in enum: $($validTypes -join ', ')"
            $issues.Add($iss)
        }

        # Status enum (optional field)
        if ($rawOrg.PSObject.Properties['status'] -and $validStatuses -notcontains [string]$rawOrg.status) {
            $iss = [OrganizationIntegrityIssue]::new()
            $iss.OrgId = $id; $iss.Severity = 'warning'; $iss.Field = 'status'
            $iss.Message = "Status '$($rawOrg.status)' is not in enum: $($validStatuses -join ', ')"
            $issues.Add($iss)
        }

        # POV alignment: score range + rationale presence
        if ($rawOrg.PSObject.Properties['pov_alignment']) {
            foreach ($povProp in $rawOrg.pov_alignment.PSObject.Properties) {
                if ($validPovs -notcontains $povProp.Name) {
                    $iss = [OrganizationIntegrityIssue]::new()
                    $iss.OrgId = $id; $iss.Severity = 'warning'; $iss.Field = "pov_alignment.$($povProp.Name)"
                    $iss.Message = "Unknown POV '$($povProp.Name)' (expected: $($validPovs -join ', '))"
                    $issues.Add($iss)
                }
                $val = $povProp.Value
                # Skip non-camp keys (e.g. legacy pov_alignment-root assessed_at).
                # The unknown-POV warning above already flags them; don't cascade
                # a bogus "no score / no rationale" complaint on top.
                if ($validPovs -notcontains $povProp.Name) { continue }

                # t/1583: legacy .score numeric bounds check retained for any
                # pre-migration records; post-migration entries carry .tier
                # (enum) — validate against the tier vocabulary instead.
                if ($val.PSObject.Properties['score']) {
                    $s = [double]$val.score
                    if ($s -lt -1.0 -or $s -gt 1.0) {
                        $iss = [OrganizationIntegrityIssue]::new()
                        $iss.OrgId = $id; $iss.Severity = 'error'; $iss.Field = "pov_alignment.$($povProp.Name).score"
                        $iss.Message = "Score $s is outside allowed range [-1.0, 1.0]"
                        $issues.Add($iss)
                    }
                }
                if ($val.PSObject.Properties['tier']) {
                    $t = [string]$val.tier
                    $validTiers = @('opposes','leans_against','mixed_or_silent','leans_toward','champions')
                    if ($validTiers -notcontains $t) {
                        $iss = [OrganizationIntegrityIssue]::new()
                        $iss.OrgId = $id; $iss.Severity = 'error'; $iss.Field = "pov_alignment.$($povProp.Name).tier"
                        $iss.Message = "Tier '$t' is not in enum: $($validTiers -join ', ')"
                        $issues.Add($iss)
                    }
                }
                if (-not $val.PSObject.Properties['rationale'] -or [string]::IsNullOrWhiteSpace([string]$val.rationale)) {
                    $iss = [OrganizationIntegrityIssue]::new()
                    $iss.OrgId = $id; $iss.Severity = 'warning'; $iss.Field = "pov_alignment.$($povProp.Name).rationale"
                    $iss.Message = "Tier/score present without rationale — makes the assignment opaque"
                    $issues.Add($iss)
                }
            }
        }

        # Topic engagement
        if ($rawOrg.PSObject.Properties['topic_engagement']) {
            foreach ($t in @($rawOrg.topic_engagement)) {
                $tref = if ($t.PSObject.Properties['topic_ref']) { [string]$t.topic_ref } else { '' }
                if ($tref -notmatch '^sit-\d+$') {
                    $iss = [OrganizationIntegrityIssue]::new()
                    $iss.OrgId = $id; $iss.Severity = 'error'; $iss.Field = 'topic_engagement.topic_ref'
                    $iss.Message = "topic_ref '$tref' does not match sit-NNN"
                    $issues.Add($iss)
                } elseif ($validSitIds -and -not $validSitIds.Contains($tref)) {
                    $iss = [OrganizationIntegrityIssue]::new()
                    $iss.OrgId = $id; $iss.Severity = 'error'; $iss.Field = 'topic_engagement.topic_ref'
                    $iss.Message = "topic_ref '$tref' does not resolve to any record in situations.json"
                    $issues.Add($iss)
                }
                if ($t.PSObject.Properties['stance'] -and $validTopicStances -notcontains [string]$t.stance) {
                    $iss = [OrganizationIntegrityIssue]::new()
                    $iss.OrgId = $id; $iss.Severity = 'warning'; $iss.Field = 'topic_engagement.stance'
                    $iss.Message = "Stance '$($t.stance)' not in enum: $($validTopicStances -join ', ')"
                    $issues.Add($iss)
                }
            }
        }

        # Policy engagement (t/1224 addition)
        if ($rawOrg.PSObject.Properties['policy_engagement']) {
            foreach ($p in @($rawOrg.policy_engagement)) {
                $pref = if ($p.PSObject.Properties['policy_ref']) { [string]$p.policy_ref } else { '' }
                if ($pref -notmatch '^pol-\d+$') {
                    $iss = [OrganizationIntegrityIssue]::new()
                    $iss.OrgId = $id; $iss.Severity = 'error'; $iss.Field = 'policy_engagement.policy_ref'
                    $iss.Message = "policy_ref '$pref' does not match pol-NNN"
                    $issues.Add($iss)
                } elseif ($validPolIds -and -not $validPolIds.Contains($pref)) {
                    $iss = [OrganizationIntegrityIssue]::new()
                    $iss.OrgId = $id; $iss.Severity = 'error'; $iss.Field = 'policy_engagement.policy_ref'
                    $iss.Message = "policy_ref '$pref' does not resolve to any record in policy_actions.json"
                    $issues.Add($iss)
                }
                if ($p.PSObject.Properties['stance'] -and $validPolicyStances -notcontains [string]$p.stance) {
                    $iss = [OrganizationIntegrityIssue]::new()
                    $iss.OrgId = $id; $iss.Severity = 'error'; $iss.Field = 'policy_engagement.stance'
                    $iss.Message = "Policy stance '$($p.stance)' not in enum: $($validPolicyStances -join ', ')"
                    $issues.Add($iss)
                }
            }
        }
    }

    $errCount = @($issues | Where-Object { $_.Severity -eq 'error' }).Count
    $warnCount = @($issues | Where-Object { $_.Severity -eq 'warning' }).Count

    $report = [OrganizationIntegrityReport]::new()
    $report.Total    = $orgs.Count
    $report.Errors   = $errCount
    $report.Warnings = $warnCount
    $report.Pass     = ($errCount -eq 0)
    $report.Issues   = @($issues)
    return $report
}
