# Tests for the share-data freshness gate predicate (t/3091).
# Exercises the pure Test-ShareManifestPredicate function — no Azure or GitHub I/O.
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    . (Join-Path $PSScriptRoot '..' 'operations' 'devops' 'ShareFreshnessPredicate.ps1')

    # Helper: build a minimal manifest PSCustomObject
    function New-TestManifest {
        param([hashtable] $Files)
        $filesObj = [pscustomobject]::new()
        foreach ($kv in $Files.GetEnumerator()) {
            $filesObj | Add-Member -MemberType NoteProperty -Name $kv.Key -Value ([pscustomobject]$kv.Value)
        }
        [pscustomobject]@{
            seeded_at        = '2026-08-01T00:00:00Z'
            data_repo_commit = 'abc123'
            files            = $filesObj
        }
    }

    # Helper: build a tree entry
    function New-TreeEntry { param([string]$Path, [string]$Sha) [pscustomobject]@{ path = $Path; sha = $Sha } }

    $EmbPath   = 'taxonomy/Origin/embeddings.json'
    $SeedSha   = 'aaa111bbb222ccc333ddd444eee555fff666777a'
    $NewSha    = 'bbb222ccc333ddd444eee555fff666777aaa888b'
    $SeedSize  = 63 * 1024 * 1024  # 63 MB
}

Describe 'Test-ShareManifestPredicate' -Tag 'unit' {

    Context 'CLEAN arm — all conditions met' {
        It 'Passes when sha matches and share size is at seeded size' {
            $manifest = New-TestManifest @{ $EmbPath = @{ blob_sha = $SeedSha; size_bytes = $SeedSize } }
            $tree     = @(New-TreeEntry $EmbPath $SeedSha)
            $sizes    = @{ $EmbPath = [long]$SeedSize }

            $result = Test-ShareManifestPredicate -Manifest $manifest -CanonicalTree $tree -ShareFileSizes $sizes
            $result.Pass    | Should -BeTrue
            $result.Reasons | Should -BeNullOrEmpty
        }

        It 'Passes when sha matches and share size is within 10% tolerance' {
            $manifest = New-TestManifest @{ $EmbPath = @{ blob_sha = $SeedSha; size_bytes = $SeedSize } }
            $tree     = @(New-TreeEntry $EmbPath $SeedSha)
            $sizes    = @{ $EmbPath = [long]($SeedSize * 0.91) }  # 91% of seeded — just above floor

            $result = Test-ShareManifestPredicate -Manifest $manifest -CanonicalTree $tree -ShareFileSizes $sizes
            $result.Pass | Should -BeTrue
        }
    }

    Context 'FIRE arm — sha mismatch (seed-lag, primary signal)' {
        It 'Fires when canonical sha differs from seeded sha' {
            $manifest = New-TestManifest @{ $EmbPath = @{ blob_sha = $SeedSha; size_bytes = $SeedSize } }
            $tree     = @(New-TreeEntry $EmbPath $NewSha)   # data repo advanced
            $sizes    = @{ $EmbPath = [long]$SeedSize }

            $result = Test-ShareManifestPredicate -Manifest $manifest -CanonicalTree $tree -ShareFileSizes $sizes
            $result.Pass                          | Should -BeFalse
            $result.Reasons.Count                 | Should -BeGreaterOrEqual 1
            $result.Reasons -join ' '             | Should -Match 'advanced since seed'
        }

        It 'Fire message includes both canonical and seeded sha for diagnosis' {
            $manifest = New-TestManifest @{ $EmbPath = @{ blob_sha = $SeedSha; size_bytes = $SeedSize } }
            $tree     = @(New-TreeEntry $EmbPath $NewSha)
            $sizes    = @{ $EmbPath = [long]$SeedSize }

            $result = Test-ShareManifestPredicate -Manifest $manifest -CanonicalTree $tree -ShareFileSizes $sizes
            $result.Reasons -join ' ' | Should -Match $NewSha
            $result.Reasons -join ' ' | Should -Match $SeedSha
        }
    }

    Context 'FIRE arm — file missing from canonical tree' {
        It 'Fires when file not found in canonical tree' {
            $manifest = New-TestManifest @{ $EmbPath = @{ blob_sha = $SeedSha; size_bytes = $SeedSize } }
            $tree     = @()   # empty tree — file removed from data repo
            $sizes    = @{ $EmbPath = [long]$SeedSize }

            $result = Test-ShareManifestPredicate -Manifest $manifest -CanonicalTree $tree -ShareFileSizes $sizes
            $result.Pass          | Should -BeFalse
            $result.Reasons -join ' ' | Should -Match 'not found in data-repo canonical tree'
        }
    }

    Context 'FIRE arm — upload truncation (secondary, independent)' {
        It 'Fires when share file is more than 10% smaller than seeded size' {
            $manifest = New-TestManifest @{ $EmbPath = @{ blob_sha = $SeedSha; size_bytes = $SeedSize } }
            $tree     = @(New-TreeEntry $EmbPath $SeedSha)   # sha still matches
            $sizes    = @{ $EmbPath = [long]($SeedSize * 0.85) }  # 85% — below 90% floor

            $result = Test-ShareManifestPredicate -Manifest $manifest -CanonicalTree $tree -ShareFileSizes $sizes
            $result.Pass          | Should -BeFalse
            $result.Reasons -join ' ' | Should -Match 'UNDERSIZED'
        }

        It 'Fires truncation even when sha matches (independent check)' {
            $manifest = New-TestManifest @{ $EmbPath = @{ blob_sha = $SeedSha; size_bytes = $SeedSize } }
            $tree     = @(New-TreeEntry $EmbPath $SeedSha)
            $sizes    = @{ $EmbPath = [long]1024 }  # 1 KB — clearly truncated

            $result = Test-ShareManifestPredicate -Manifest $manifest -CanonicalTree $tree -ShareFileSizes $sizes
            $result.Pass | Should -BeFalse
        }

        It 'Fires when file missing from share entirely' {
            $manifest = New-TestManifest @{ $EmbPath = @{ blob_sha = $SeedSha; size_bytes = $SeedSize } }
            $tree     = @(New-TreeEntry $EmbPath $SeedSha)
            $sizes    = @{}   # file not on share

            $result = Test-ShareManifestPredicate -Manifest $manifest -CanonicalTree $tree -ShareFileSizes $sizes
            $result.Pass          | Should -BeFalse
            $result.Reasons -join ' ' | Should -Match 'not found on share'
        }
    }

    Context 'Multiple files in manifest' {
        It 'Reports all failing files, not just the first' {
            $path2    = 'taxonomy/Origin/taxonomy.json'
            $sha2     = 'ccc333ddd444eee555fff666777aaa888bbb999c'
            $manifest = New-TestManifest @{
                $EmbPath = @{ blob_sha = $SeedSha; size_bytes = $SeedSize }
                $path2   = @{ blob_sha = $sha2;    size_bytes = 10MB }
            }
            $tree     = @(
                New-TreeEntry $EmbPath $NewSha    # mismatch
                New-TreeEntry $path2   $sha2      # matches
            )
            $sizes    = @{
                $EmbPath = [long]$SeedSize
                $path2   = [long]10MB
            }

            $result = Test-ShareManifestPredicate -Manifest $manifest -CanonicalTree $tree -ShareFileSizes $sizes
            $result.Pass          | Should -BeFalse
            $result.Reasons.Count | Should -Be 1   # only embeddings.json fires
            $result.Reasons[0]    | Should -Match $EmbPath
        }
    }
}
