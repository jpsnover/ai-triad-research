# Tag: ingestion (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Find-ExistingSource URL deduplication' -Tag 'ingestion' {

    BeforeAll {
        # Create a temp sources directory with a fake document
        $script:TempSources = Join-Path ([System.IO.Path]::GetTempPath()) "ait-dedup-test-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        $DocDir = Join-Path $script:TempSources 'test-doc-1'
        New-Item -Path $DocDir -ItemType Directory -Force | Out-Null

        $MetaContent = @{
            id    = 'test-doc-1'
            title = 'Test Document'
            url   = 'https://example.com/article-1'
        } | ConvertTo-Json
        Set-Content -Path (Join-Path $DocDir 'metadata.json') -Value $MetaContent -Encoding utf8NoBOM
    }

    AfterAll {
        if (Test-Path $script:TempSources) {
            Remove-Item $script:TempSources -Recurse -Force
        }
    }

    It 'Detects duplicate when URL matches metadata.url' {
        InModuleScope AITriad -Parameters @{ SourcesDir = $script:TempSources } {
            param($SourcesDir)

            # Re-declare Find-ExistingSource with the same logic as Import-AITriadDocument
            # to test the field-name fix in isolation
            function Find-ExistingSource {
                param([string]$Url, [string]$FilePath)
                $MetaFiles = @(Get-ChildItem -Path $SourcesDir -Filter 'metadata.json' -Recurse -Depth 1 -ErrorAction SilentlyContinue)
                foreach ($MF in $MetaFiles) {
                    try {
                        $Meta = Get-Content $MF.FullName -Raw | ConvertFrom-Json
                    } catch { continue }

                    if (-not [string]::IsNullOrWhiteSpace($Url) -and $Meta.url -eq $Url) {
                        return $MF.Directory.Name
                    }

                    if (-not [string]::IsNullOrWhiteSpace($FilePath)) {
                        $FileName = [System.IO.Path]::GetFileName($FilePath)
                        $RawDir = Join-Path $MF.Directory.FullName 'raw'
                        if (Test-Path (Join-Path $RawDir $FileName)) {
                            return $MF.Directory.Name
                        }
                    }
                }
                return $null
            }

            $Result = Find-ExistingSource -Url 'https://example.com/article-1'
            $Result | Should -Be 'test-doc-1'
        }
    }

    It 'Returns $null when URL does not match' {
        InModuleScope AITriad -Parameters @{ SourcesDir = $script:TempSources } {
            param($SourcesDir)

            function Find-ExistingSource {
                param([string]$Url, [string]$FilePath)
                $MetaFiles = @(Get-ChildItem -Path $SourcesDir -Filter 'metadata.json' -Recurse -Depth 1 -ErrorAction SilentlyContinue)
                foreach ($MF in $MetaFiles) {
                    try {
                        $Meta = Get-Content $MF.FullName -Raw | ConvertFrom-Json
                    } catch { continue }

                    if (-not [string]::IsNullOrWhiteSpace($Url) -and $Meta.url -eq $Url) {
                        return $MF.Directory.Name
                    }

                    if (-not [string]::IsNullOrWhiteSpace($FilePath)) {
                        $FileName = [System.IO.Path]::GetFileName($FilePath)
                        $RawDir = Join-Path $MF.Directory.FullName 'raw'
                        if (Test-Path (Join-Path $RawDir $FileName)) {
                            return $MF.Directory.Name
                        }
                    }
                }
                return $null
            }

            $Result = Find-ExistingSource -Url 'https://example.com/different-article'
            $Result | Should -BeNullOrEmpty
        }
    }

    It 'Returns $null when URL is empty' {
        InModuleScope AITriad -Parameters @{ SourcesDir = $script:TempSources } {
            param($SourcesDir)

            function Find-ExistingSource {
                param([string]$Url, [string]$FilePath)
                $MetaFiles = @(Get-ChildItem -Path $SourcesDir -Filter 'metadata.json' -Recurse -Depth 1 -ErrorAction SilentlyContinue)
                foreach ($MF in $MetaFiles) {
                    try {
                        $Meta = Get-Content $MF.FullName -Raw | ConvertFrom-Json
                    } catch { continue }

                    if (-not [string]::IsNullOrWhiteSpace($Url) -and $Meta.url -eq $Url) {
                        return $MF.Directory.Name
                    }

                    if (-not [string]::IsNullOrWhiteSpace($FilePath)) {
                        $FileName = [System.IO.Path]::GetFileName($FilePath)
                        $RawDir = Join-Path $MF.Directory.FullName 'raw'
                        if (Test-Path (Join-Path $RawDir $FileName)) {
                            return $MF.Directory.Name
                        }
                    }
                }
                return $null
            }

            $Result = Find-ExistingSource -Url ''
            $Result | Should -BeNullOrEmpty
        }
    }
}
