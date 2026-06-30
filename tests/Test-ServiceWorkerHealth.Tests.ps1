# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

BeforeAll {
    $ModulePath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psm1'
    Import-Module $ModulePath -Force -WarningAction SilentlyContinue
}

Describe 'Test-ServiceWorkerHealth' {

    It 'Is exported from the module' {
        Get-Command Test-ServiceWorkerHealth -Module AITriad -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It 'Has BaseUrl, ExpectedDenylist, Detailed, TimeoutSec parameters' {
        $cmd = Get-Command Test-ServiceWorkerHealth -Module AITriad -ErrorAction Stop
        foreach ($p in 'BaseUrl','ExpectedDenylist','Detailed','TimeoutSec') {
            ($cmd.Parameters.Keys -contains $p) | Should -Be $true
        }
    }

    It 'Returns OverallPass=true for a healthy auto-skipWaiting SW with proper denylist' {
        $swAuto = @'
self.skipWaiting();
clientsClaim();
workbox.precaching.precacheAndRoute([{"revision":"abc123","url":"/assets/index.js"},{"revision":"def456","url":"/assets/style.css"}]);
workbox.routing.registerRoute(({request}) => request.mode === 'navigate', new workbox.strategies.NetworkFirst({
  navigateFallback: 'index.html',
  navigateFallbackDenylist: [/\.auth\//, /^\/api\//, /^\/healthz$/]
}));
'@
        InModuleScope AITriad -Parameters @{ Sw = $swAuto } {
            param($Sw)
            Mock Invoke-WebRequest { [PSCustomObject]@{ StatusCode = 200; Content = $Sw } }
            $r = Test-ServiceWorkerHealth -BaseUrl 'https://stub.example.com' 6>$null
            $r.FetchedOk        | Should -Be $true
            $r.SkipWaitingMode  | Should -Be 'auto'
            $r.ClientsClaim     | Should -Be $true
            $r.NavigateFallback | Should -Be 'index.html'
            @($r.MissingDenylist).Count | Should -Be 0
            $r.PrecacheCount    | Should -Be 2
            $r.OverallPass      | Should -Be $true
        }
    }

    It 'Flags message-based skipWaiting as not auto' {
        $swMessage = @'
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
workbox.precaching.precacheAndRoute([{"revision":"x","url":"/assets/a.js"}]);
'@
        InModuleScope AITriad -Parameters @{ Sw = $swMessage } {
            param($Sw)
            Mock Invoke-WebRequest { [PSCustomObject]@{ StatusCode = 200; Content = $Sw } }
            $r = Test-ServiceWorkerHealth -BaseUrl 'https://stub.example.com' 6>$null
            $r.SkipWaitingMode | Should -Be 'message'
            $r.OverallPass     | Should -Be $false
        }
    }

    It 'Flags missing clientsClaim and missing denylist patterns' {
        $swBroken = @'
self.skipWaiting();
workbox.precaching.precacheAndRoute([{"revision":"abc","url":"/assets/index.js"}]);
'@
        InModuleScope AITriad -Parameters @{ Sw = $swBroken } {
            param($Sw)
            Mock Invoke-WebRequest { [PSCustomObject]@{ StatusCode = 200; Content = $Sw } }
            $r = Test-ServiceWorkerHealth -BaseUrl 'https://stub.example.com' 6>$null
            $r.ClientsClaim | Should -Be $false
            @($r.MissingDenylist).Count | Should -BeGreaterThan 0
            $r.OverallPass | Should -Be $false
        }
    }

    It 'Returns a fast-fail result when /sw.js cannot be fetched' {
        InModuleScope AITriad {
            Mock Invoke-WebRequest { throw [System.Net.WebException]::new('404 not found') }
            $r = Test-ServiceWorkerHealth -BaseUrl 'https://stub.example.com' 6>$null
            $r.FetchedOk | Should -Be $false
            $r.OverallPass | Should -Be $false
            @($r.Checks).Count | Should -Be 1
            $r.Checks[0].Name | Should -Be 'fetched'
        }
    }

    It 'Computes a deterministic 8-char hash from the file body' {
        $sw = @'
self.skipWaiting();
clientsClaim();
workbox.precaching.precacheAndRoute([{"revision":"x","url":"/a.js"}]);
'@
        InModuleScope AITriad -Parameters @{ Sw = $sw } {
            param($Sw)
            Mock Invoke-WebRequest { [PSCustomObject]@{ StatusCode = 200; Content = $Sw } }
            $r1 = Test-ServiceWorkerHealth -BaseUrl 'https://stub.example.com' 6>$null
            $r2 = Test-ServiceWorkerHealth -BaseUrl 'https://stub.example.com' 6>$null
            $r1.Hash | Should -Be $r2.Hash
            $r1.Hash.Length | Should -Be 8
        }
    }

    It 'Custom -ExpectedDenylist patterns drive the MissingDenylist computation' {
        $swAuto = @'
self.skipWaiting();
clientsClaim();
workbox.routing.registerRoute(({request}) => request.mode === 'navigate', new workbox.strategies.NetworkFirst({
  navigateFallback: 'index.html',
  navigateFallbackDenylist: [/\.auth\//, /^\/api\//]
}));
'@
        InModuleScope AITriad -Parameters @{ Sw = $swAuto } {
            param($Sw)
            Mock Invoke-WebRequest { [PSCustomObject]@{ StatusCode = 200; Content = $Sw } }
            $r = Test-ServiceWorkerHealth -BaseUrl 'https://stub.example.com' `
                -ExpectedDenylist @('\.auth', 'api', '/metrics') 6>$null
            $r.MissingDenylist | Should -Contain '/metrics'
            $r.MissingDenylist | Should -Not -Contain '\.auth'
        }
    }

    It 'Returns a ServiceWorkerHealth typed object' {
        $sw = "self.skipWaiting(); clientsClaim();"
        InModuleScope AITriad -Parameters @{ Sw = $sw } {
            param($Sw)
            Mock Invoke-WebRequest { [PSCustomObject]@{ StatusCode = 200; Content = $Sw } }
            $r = Test-ServiceWorkerHealth -BaseUrl 'https://stub.example.com' 6>$null
            $r.GetType().Name | Should -Be 'ServiceWorkerHealth'
        }
    }
}

Describe 'Test-ServiceWorkerHealth - manifest' {
    It 'FunctionsToExport includes Test-ServiceWorkerHealth' {
        $manifestPath = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'AITriad.psd1'
        $manifest = Test-ModuleManifest -Path $manifestPath
        $manifest.ExportedFunctions.Keys | Should -Contain 'Test-ServiceWorkerHealth'
    }
}
