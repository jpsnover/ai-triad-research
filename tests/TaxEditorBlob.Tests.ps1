# Tag: health (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Get-TaxEditorBlob' -Tag 'health' {

    It 'Throws when az CLI is not found' {
        Mock Get-Command { $null } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        { Get-TaxEditorBlob 2>$null } | Should -Throw
    }

    It 'Throws when az CLI is not logged in' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith { $global:LASTEXITCODE = 1; return $null } -ModuleName AITriad
        { Get-TaxEditorBlob 2>$null } | Should -Throw
    }

    It 'Returns typed BlobInfo objects' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'blob' -and $args -contains 'list') {
                return '[{"name":"debates/abc.json","deleted":false,"properties":{"contentLength":1024,"lastModified":"2026-06-22T10:00:00Z"}}]'
            }
            if ($args -contains 'container' -and $args -contains 'list') {
                return '["user-content"]'
            }
            if ($args -contains 'account' -and $args -contains 'list') {
                return '["staitriadabc123"]'
            }
            return '{"id":"sub-123"}'
        } -ModuleName AITriad

        $results = @(Get-TaxEditorBlob -StorageAccount 'staitriadabc123' -Container 'user-content')
        @($results).Count | Should -Be 1
        $results[0].Name | Should -Be 'debates/abc.json'
        $results[0].Container | Should -Be 'user-content'
        $results[0].Size | Should -Be 1024
        $results[0].Deleted | Should -BeFalse
    }

    It '-Deleted filters to only soft-deleted blobs' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'blob' -and $args -contains 'list') {
                return @'
[
  {"name":"active.json","deleted":false,"properties":{"contentLength":512,"lastModified":"2026-06-22T10:00:00Z"}},
  {"name":"removed.json","deleted":true,"properties":{"contentLength":256,"lastModified":"2026-06-21T08:00:00Z","deletedTime":"2026-06-22T09:00:00Z"}}
]
'@
            }
            return '{"id":"sub-123"}'
        } -ModuleName AITriad

        $results = @(Get-TaxEditorBlob -StorageAccount 'staitriadabc123' -Container 'user-content' -Deleted)
        @($results).Count | Should -Be 1
        $results[0].Name | Should -Be 'removed.json'
        $results[0].Deleted | Should -BeTrue
        $results[0].DeletedAt | Should -BeLike '*2026*'
    }

    It 'Auto-detects storage account from resource group' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'account' -and $args -contains 'list' -and $args -contains '-g') {
                return '["staitriadxyz789"]'
            }
            if ($args -contains 'container' -and $args -contains 'list') {
                return '["user-content"]'
            }
            if ($args -contains 'blob' -and $args -contains 'list') {
                return '[]'
            }
            return '{"id":"sub-123"}'
        } -ModuleName AITriad

        { Get-TaxEditorBlob } | Should -Not -Throw
        Should -Invoke 'az' -ModuleName AITriad -Times 4
    }
}

Describe 'Restore-TaxEditorBlob' -Tag 'health' {

    It 'Throws when az CLI is not found' {
        Mock Get-Command { $null } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        { Restore-TaxEditorBlob -Container 'user-content' -Path 'test.json' -Confirm:$false 2>$null } | Should -Throw
    }

    It 'Throws when soft-delete is not enabled' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'blob-service-properties') {
                return '{"enabled":false,"days":null}'
            }
            return '{"id":"sub-123"}'
        } -ModuleName AITriad

        { Restore-TaxEditorBlob -Container 'user-content' -Path 'test.json' -StorageAccount 'staitriadabc123' -Confirm:$false 2>$null } | Should -Throw
    }

    It 'WhatIf shows action without restoring' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'blob-service-properties') {
                return '{"enabled":true,"days":30}'
            }
            return '{"id":"sub-123"}'
        } -ModuleName AITriad

        $result = Restore-TaxEditorBlob -Container 'user-content' -Path 'test.json' -StorageAccount 'staitriadabc123' -WhatIf
        $result | Should -BeNullOrEmpty
    }

    It 'Happy path: restores a soft-deleted blob' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'blob-service-properties') {
                return '{"enabled":true,"days":30}'
            }
            if ($args -contains 'undelete') {
                return '{}'
            }
            return '{"id":"sub-123"}'
        } -ModuleName AITriad

        $result = Restore-TaxEditorBlob -Container 'user-content' -Path 'debates/abc.json' -StorageAccount 'staitriadabc123' -Confirm:$false
        $result.Action | Should -Be 'BlobRestore'
        $result.Container | Should -Be 'user-content'
        $result.Path | Should -Be 'debates/abc.json'
        $result.StorageAccount | Should -Be 'staitriadabc123'
    }

    It 'Throws when undelete fails' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            if ($args -contains 'undelete') {
                $global:LASTEXITCODE = 1
                return $null
            }
            $global:LASTEXITCODE = 0
            if ($args -contains 'blob-service-properties') {
                return '{"enabled":true,"days":30}'
            }
            return '{"id":"sub-123"}'
        } -ModuleName AITriad

        { Restore-TaxEditorBlob -Container 'user-content' -Path 'missing.json' -StorageAccount 'staitriadabc123' -Confirm:$false 2>$null } | Should -Throw
    }

    It 'Accepts pipeline input from Get-TaxEditorBlob' {
        Mock Get-Command { @{ Name = 'az' } } -ParameterFilter { $Name -eq 'az' } -ModuleName AITriad
        Mock -CommandName 'az' -MockWith {
            param()
            $global:LASTEXITCODE = 0
            if ($args -contains 'blob-service-properties') {
                return '{"enabled":true,"days":30}'
            }
            if ($args -contains 'undelete') {
                return '{}'
            }
            return '{"id":"sub-123"}'
        } -ModuleName AITriad

        $BlobObj = [PSCustomObject]@{
            Name      = 'chats/xyz.json'
            Container = 'community'
            Deleted   = $true
        }

        $result = $BlobObj | Restore-TaxEditorBlob -StorageAccount 'staitriadabc123' -Confirm:$false
        $result.Container | Should -Be 'community'
        $result.Path | Should -Be 'chats/xyz.json'
    }
}
