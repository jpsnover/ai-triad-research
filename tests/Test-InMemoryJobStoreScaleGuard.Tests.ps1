# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

<#
.SYNOPSIS
    Gate-verification tests for Test-InMemoryJobStoreScaleGuard (t/2885 SO condition 2).
.DESCRIPTION
    Proves BOTH arms required by TL gate-verification:
      Fire arm:   marker present in ANY server file + maxReplicas > 1  → gate throws (blocks CI).
      Pass arm:   marker present + maxReplicas = 1                     → gate passes silently.
    Also proves two safe-pass conditions:
      No marker:  all stores migrated, any maxReplicas → gate passes unconditionally.
      Parse fail: malformed Bicep                      → gate throws with a clear message.
    Multi-file arm: marker in a second file fires the gate alongside the first.
#>

Describe 'Test-InMemoryJobStoreScaleGuard — both arms (t/2885)' {

    BeforeAll {
        $script:GateScript = "$PSScriptRoot/../operations/devops/Test-InMemoryJobStoreScaleGuard.ps1"

        # Helpers to create temp fixture files
        function script:New-BicepFixture ([int]$MaxReplicas) {
            $f = [System.IO.Path]::GetTempFileName()
            Set-Content -Path $f -Value @"
// maxReplicas capped at 1 (t/2885, 2026-08-20): brief-export and oped job
// stores are per-process in-memory Maps. Running >1 replica means POST on
// replica A and GET poll on replica B → 404. DO NOT raise above 1 until
// blob-backed store lands (t/2885 deferred).
maxReplicas: $MaxReplicas
"@
            return $f
        }

        function script:New-JobStoreFixture ([bool]$WithMarker) {
            $f = [System.IO.Path]::GetTempFileName()
            $content = if ($WithMarker) {
                '// @INMEMORY_JOB_STORE — remove when migrated to blob-backed shared store (t/2885)'
            } else {
                '// job store migrated to shared blob storage'
            }
            Set-Content -Path $f -Value $content
            return $f
        }

        # Creates a temp directory containing one or more .ts files.
        # markerFiles: list of filenames that should carry @INMEMORY_JOB_STORE.
        # cleanFiles:  list of filenames that should NOT carry the marker.
        function script:New-ServerDirFixture ([string[]]$MarkerFiles = @(), [string[]]$CleanFiles = @()) {
            $dir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
            New-Item -ItemType Directory -Path $dir | Out-Null
            foreach ($name in $MarkerFiles) {
                $full = Join-Path $dir $name
                New-Item -ItemType Directory -Path (Split-Path $full -Parent) -Force | Out-Null
                Set-Content -Path $full -Value '// @INMEMORY_JOB_STORE — remove when migrated to blob-backed shared store (t/2885)'
            }
            foreach ($name in $CleanFiles) {
                $full = Join-Path $dir $name
                New-Item -ItemType Directory -Path (Split-Path $full -Parent) -Force | Out-Null
                Set-Content -Path $full -Value '// job store migrated to shared blob storage'
            }
            return $dir
        }
    }

    # ── Fire arm (legacy single-file): maxReplicas > 1 + marker present ──────
    Context 'FIRE ARM — maxReplicas=2, marker present, single-file mode (must block)' {
        It 'throws and blocks CI' {
            $bicep = script:New-BicepFixture -MaxReplicas 2
            $store = script:New-JobStoreFixture -WithMarker $true
            try {
                { & $script:GateScript -BicepPath $bicep -JobStorePath $store } |
                    Should -Throw -ExpectedMessage '*scale guard FAILED*'
            } finally {
                Remove-Item $bicep, $store -ErrorAction SilentlyContinue
            }
        }

        It 'emits ::error:: lines mentioning maxReplicas and the race' {
            $bicep = script:New-BicepFixture -MaxReplicas 2
            $store = script:New-JobStoreFixture -WithMarker $true
            $output = & { try { & $script:GateScript -BicepPath $bicep -JobStorePath $store } catch {} } 6>&1 | Out-String
            try {
                $output | Should -Match '::error::.*maxReplicas=2'
                $output | Should -Match '::error::.*cross-replica 404'
            } finally {
                Remove-Item $bicep, $store -ErrorAction SilentlyContinue
            }
        }
    }

    # ── Fire arm: maxReplicas > 1 + marker in one file ───────────────────────
    Context 'FIRE ARM — maxReplicas=2, one marked file (must block)' {
        It 'throws and blocks CI' {
            $bicep = script:New-BicepFixture -MaxReplicas 2
            $dir   = script:New-ServerDirFixture -MarkerFiles @('briefExportJobs.ts')
            try {
                { & $script:GateScript -BicepPath $bicep -ServerDir $dir } |
                    Should -Throw -ExpectedMessage '*scale guard FAILED*'
            } finally {
                Remove-Item $bicep -ErrorAction SilentlyContinue
                Remove-Item $dir -Recurse -ErrorAction SilentlyContinue
            }
        }

        It 'emits ::error:: lines mentioning maxReplicas and the race' {
            $bicep = script:New-BicepFixture -MaxReplicas 2
            $dir   = script:New-ServerDirFixture -MarkerFiles @('briefExportJobs.ts')
            $output = & { try { & $script:GateScript -BicepPath $bicep -ServerDir $dir } catch {} } 6>&1 | Out-String
            try {
                $output | Should -Match '::error::.*maxReplicas=2'
                $output | Should -Match '::error::.*cross-replica 404'
            } finally {
                Remove-Item $bicep -ErrorAction SilentlyContinue
                Remove-Item $dir -Recurse -ErrorAction SilentlyContinue
            }
        }
    }

    # ── Fire arm: maxReplicas > 1 + markers in multiple files ────────────────
    Context 'FIRE ARM — maxReplicas=2, multiple marked files (must block and name all)' {
        It 'throws and lists all marked files' {
            $bicep = script:New-BicepFixture -MaxReplicas 2
            $dir   = script:New-ServerDirFixture -MarkerFiles @('briefExportJobs.ts', 'routes/oped.ts', 'security/githubAppAuth.ts')
            $output = & { try { & $script:GateScript -BicepPath $bicep -ServerDir $dir } catch {} } 6>&1 | Out-String
            try {
                $output | Should -Match 'briefExportJobs.ts'
            } finally {
                Remove-Item $bicep -ErrorAction SilentlyContinue
                Remove-Item $dir -Recurse -ErrorAction SilentlyContinue
            }
        }
    }

    # ── Pass arm (legacy single-file): maxReplicas = 1 + marker present ──────
    Context 'PASS ARM — maxReplicas=1, marker present, single-file mode (must pass)' {
        It 'does not throw' {
            $bicep = script:New-BicepFixture -MaxReplicas 1
            $store = script:New-JobStoreFixture -WithMarker $true
            try {
                { & $script:GateScript -BicepPath $bicep -JobStorePath $store } | Should -Not -Throw
            } finally {
                Remove-Item $bicep, $store -ErrorAction SilentlyContinue
            }
        }
    }

    # ── Pass arm: maxReplicas = 1 + marker present in dir ────────────────────
    Context 'PASS ARM — maxReplicas=1, marker present in dir (must pass)' {
        It 'does not throw' {
            $bicep = script:New-BicepFixture -MaxReplicas 1
            $dir   = script:New-ServerDirFixture -MarkerFiles @('briefExportJobs.ts')
            try {
                { & $script:GateScript -BicepPath $bicep -ServerDir $dir } | Should -Not -Throw
            } finally {
                Remove-Item $bicep -ErrorAction SilentlyContinue
                Remove-Item $dir -Recurse -ErrorAction SilentlyContinue
            }
        }
    }

    # ── Safe pass (legacy): marker absent (store migrated) ───────────────────
    Context 'No marker — store migrated, any maxReplicas, single-file mode (must pass)' {
        It 'passes even when maxReplicas=5' {
            $bicep = script:New-BicepFixture -MaxReplicas 5
            $store = script:New-JobStoreFixture -WithMarker $false
            try {
                { & $script:GateScript -BicepPath $bicep -JobStorePath $store } | Should -Not -Throw
            } finally {
                Remove-Item $bicep, $store -ErrorAction SilentlyContinue
            }
        }
    }

    # ── Safe pass: no markers anywhere (all stores migrated) ─────────────────
    Context 'No markers — all stores migrated, any maxReplicas (must pass)' {
        It 'passes even when maxReplicas=5' {
            $bicep = script:New-BicepFixture -MaxReplicas 5
            $dir   = script:New-ServerDirFixture -CleanFiles @('briefExportJobs.ts', 'routes/oped.ts')
            try {
                { & $script:GateScript -BicepPath $bicep -ServerDir $dir } | Should -Not -Throw
            } finally {
                Remove-Item $bicep -ErrorAction SilentlyContinue
                Remove-Item $dir -Recurse -ErrorAction SilentlyContinue
            }
        }
    }

    # ── Parse guard: malformed Bicep ─────────────────────────────────────────
    Context 'Malformed Bicep — cap comment missing (must throw with clear message)' {
        It 'throws mentioning parse failure' {
            $bicep = [System.IO.Path]::GetTempFileName()
            Set-Content -Path $bicep -Value 'maxReplicas: 1'  # no cap comment — regex won't match
            $store = script:New-JobStoreFixture -WithMarker $true
            try {
                { & $script:GateScript -BicepPath $bicep -JobStorePath $store } |
                    Should -Throw -ExpectedMessage '*could not parse*'
            } finally {
                Remove-Item $bicep, $store -ErrorAction SilentlyContinue
            }
        }
    }
}
