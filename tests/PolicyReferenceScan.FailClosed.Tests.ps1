# Tag: taxonomy (t/4065)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    t/4065: the policy reference scan fails closed. It used to skip a missing POV file and treat an
    unreadable one as empty, so the recount wrote member_count 0 for every policy only that file
    referenced. The PS twin of #3048. The refusals match the TS lib's recountPolicyMembers guard
    (#3050, SO e/274#2): missing, null, no nodes array and an empty nodes array, plus read/parse failure.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1') -Force -WarningAction SilentlyContinue
    . (Join-Path $PSScriptRoot 'PolicyPovFixture.ps1')

    # skeptic.json: skp-target dropped pol-001 on re-extraction. safetyist.json: saf-1 still references
    # pol-001, so the true count after the write is 1. If safetyist.json is skipped, the scan sees zero.
    function New-ScanFixture {
        $Dir = Join-Path ([System.IO.Path]::GetTempPath()) "polreg-failclosed-$(Get-Random)"
        New-Item -ItemType Directory -Path $Dir -Force | Out-Null
        [ordered]@{ _schema_version = '1.0.0'; nodes = @(
                [ordered]@{ id = 'skp-target'; graph_attributes = [ordered]@{ policy_actions = @() } }
            ) } | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $Dir 'skeptic.json')
        [ordered]@{ _schema_version = '1.0.0'; nodes = @(
                [ordered]@{ id = 'saf-1'; graph_attributes = [ordered]@{ policy_actions = @(
                            [ordered]@{ action = 'shared'; framing = 'f'; policy_id = 'pol-001' }) } }
            ) } | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $Dir 'safetyist.json')
        [ordered]@{ _schema_version = '1.0.0'; _doc = 'x'; policy_count = 1; policies = @(
                [ordered]@{ id = 'pol-001'; action = 'shared'; source_povs = @('safetyist', 'skeptic'); member_count = 2; status = 'active' }) } |
            ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $Dir 'policy_actions.json')
        Add-PolicyPovFillers -Dir $Dir
        return $Dir
    }

    # Runs the node-scoped recount the way Invoke-AttributeExtraction does after a re-extraction.
    # Returns the error text, or '' when the call succeeded.
    function Invoke-ScopedRecount([string]$Dir) {
        InModuleScope AITriad -Parameters @{ Dir = $Dir } {
            param($Dir)
            Mock Get-TaxonomyDir { $Dir }
            try {
                Update-PolicyRegistry -Fix -NodeId 'skp-target' -PriorPolicyIds 'pol-001' -ErrorAction Stop -WarningVariable w -WarningAction SilentlyContinue 6> $null | Out-Null
                ($w | ForEach-Object { "$_" }) -join "`n"
            } catch { "$_" }
        }
    }
    function Get-Count([string]$Dir) {
        @((Get-Content -Raw (Join-Path $Dir 'policy_actions.json') | ConvertFrom-Json).policies | Where-Object id -eq 'pol-001')[0].member_count
    }
}

Describe 'Policy reference scan fails closed (t/4065)' -Tag 'taxonomy' {

    AfterEach { if ($script:Dir) { Remove-Item $script:Dir -Recurse -Force -ErrorAction SilentlyContinue } }

    It 'control arm: with all four POV files present, the recount keeps the surviving reference (count 1)' {
        $script:Dir = New-ScanFixture
        Invoke-ScopedRecount $script:Dir | Out-Null
        Get-Count $script:Dir | Should -Be 1
    }

    It 'refuses when a POV file is <Case>, and policy_actions.json is byte-unchanged (no member_count 0)' -ForEach @(
        @{ Case = 'missing';            Content = $null }
        @{ Case = 'null';               Content = 'null' }
        @{ Case = 'without nodes';      Content = '{ "_schema_version": "1.0.0" }' }
        @{ Case = 'an empty nodes array'; Content = '{ "_schema_version": "1.0.0", "nodes": [] }' }
        @{ Case = 'unparseable';        Content = '{ "nodes": [ ' }
    ) {
        $script:Dir = New-ScanFixture
        $saf = Join-Path $script:Dir 'safetyist.json'
        if ($null -eq $Content) { Remove-Item -LiteralPath $saf } else { Set-Content -LiteralPath $saf -Value $Content }
        $regPath = Join-Path $script:Dir 'policy_actions.json'
        $before = (Get-FileHash $regPath).Hash

        $msg = Invoke-ScopedRecount $script:Dir

        Get-Count $script:Dir | Should -Be 2   # the old scan wrote 0 here (missing / empty nodes)
        (Get-FileHash $regPath).Hash | Should -Be $before
        $msg | Should -Match 'safetyist\.json'
    }

    It 'refuses when reading a POV file fails (I/O error), and policy_actions.json is byte-unchanged' {
        $script:Dir = New-ScanFixture
        $regPath = Join-Path $script:Dir 'policy_actions.json'
        $before = (Get-FileHash $regPath).Hash
        $msg = InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            Mock Get-TaxonomyDir { $Dir }
            # Pass-through for every other read (Pester intercepts even a module-qualified Get-Content).
            Mock Get-Content { [System.IO.File]::ReadAllText([string]@($LiteralPath + $Path)[0]) }
            Mock Get-Content { throw [System.IO.IOException]::new('The process cannot access the file because it is being used by another process.') } -ParameterFilter { "$LiteralPath$Path" -like '*safetyist.json' }
            try {
                Update-PolicyRegistry -Fix -NodeId 'skp-target' -PriorPolicyIds 'pol-001' -ErrorAction Stop -WarningVariable w -WarningAction SilentlyContinue 6> $null | Out-Null
                ($w | ForEach-Object { "$_" }) -join "`n"
            } catch { "$_" }
        }
        $msg | Should -Match 'safetyist\.json'
        (Get-FileHash $regPath).Hash | Should -Be $before
    }

    It 'Read-PolicyPovFile names the file and says nothing was written' {
        $script:Dir = New-ScanFixture
        Remove-Item -LiteralPath (Join-Path $script:Dir 'situations.json')
        InModuleScope AITriad -Parameters @{ Dir = $script:Dir } {
            param($Dir)
            { Read-PolicyPovFile -TaxDir $Dir -PovKey 'situations' } | Should -Throw -ExpectedMessage '*situations.json does not exist*'
            { Get-PolicyReferenceScan -TaxDir $Dir } | Should -Throw -ExpectedMessage '*Nothing was written*'
        }
    }
}
