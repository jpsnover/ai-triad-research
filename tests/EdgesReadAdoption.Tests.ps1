# Tag: taxonomy (t/2974)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Adoption guard (t/2974 PR-2, TL ruling t/2974#2): every cmdlet that WRITES edges.json (calls
    Write-EdgesFile) must read it through the coercion-free Read-EdgesFile primitive — never via a
    direct `ConvertFrom-Json`, which coerces discovered_at to [datetime] and truncates trailing-zero
    milliseconds on the whole-file write-back. This stops a future edge writer from silently
    re-introducing the t/2974 round-trip bug.
#>

BeforeAll {
    $script:PublicDir = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public'
}

Describe 'edges.json read adoption — writers use the coercion-free reader (t/2974)' -Tag 'taxonomy' {

    It 'no edges.json WRITER does a direct coercing ConvertFrom-Json read of edges.json' {
        $writers = @(
            Get-ChildItem -Path $script:PublicDir -Filter '*.ps1' -File |
                Where-Object { Select-String -Path $_.FullName -Pattern 'Write-EdgesFile' -Quiet }
        )
        @($writers).Count | Should -BeGreaterThan 0 -Because 'sanity: there must be edge-writing cmdlets to check'

        # A violation = a line that calls ConvertFrom-Json AND references the edges path/file — i.e. a
        # direct coercing read of edges.json instead of Read-EdgesFile.
        $violations = foreach ($f in $writers) {
            Select-String -Path $f.FullName -Pattern 'ConvertFrom-Json' |
                Where-Object { $_.Line -match '\$EdgesPath' -or $_.Line -match 'edges\.json' } |
                ForEach-Object { "$($f.Name):$($_.LineNumber): $($_.Line.Trim())" }
        }
        @($violations) | Should -BeNullOrEmpty -Because 'an edges.json writer must read via Read-EdgesFile (t/2974), not a direct ConvertFrom-Json that coerces discovered_at'
    }

    It 'the routed writers actually reference Read-EdgesFile' {
        foreach ($name in @('Invoke-EdgeRationaleBackfill', 'Invoke-EdgeDiscovery', 'Set-Edge', 'Approve-Edge', 'Invoke-EdgeWeightEvaluation', 'Test-TaxonomyIntegrity', 'Test-EdgeDirection')) {
            $path = Join-Path $script:PublicDir "$name.ps1"
            Select-String -Path $path -Pattern 'Read-EdgesFile' -Quiet |
                Should -BeTrue -Because "$name reads-then-writes edges.json and must use Read-EdgesFile (t/2974)"
        }
    }
}
