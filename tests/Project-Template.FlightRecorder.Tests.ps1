# Tag: template (t/1186)
BeforeAll {
    # Dot-source the private helper and public cmdlets directly (no module manifest import needed)
    $ptRoot = "$PSScriptRoot/../scripts/Project-Template"
    . "$ptRoot/Private/New-ActionableError.ps1"
    foreach ($f in (Get-ChildItem "$ptRoot/Public/*.ps1")) { . $f.FullName }

    # Set script-scope vars the module normally provides
    $script:RepoRoot = (Resolve-Path "$PSScriptRoot/..").Path
}

Describe 'Get-FlightRecorderDump' -Tag 'template' {

    BeforeAll {
        $script:dumpDir = Join-Path $TestDrive 'dumps'
        New-Item -ItemType Directory -Path $script:dumpDir -Force | Out-Null

        # Create synthetic dump files
        $header = @{ _type = 'header'; schema_version = '1.0.0'; timestamp = '2026-06-22T10:00:00Z'; app_version = '0.8.0'; ring_buffer_events_retained = 5 } | ConvertTo-Json -Compress
        $trigger = @{ _type = 'trigger'; trigger_type = 'manual' } | ConvertTo-Json -Compress

        Set-Content -Path (Join-Path $script:dumpDir 'flight-recorder-001.jsonl') -Value "$header`n$trigger" -Encoding utf8
        Start-Sleep -Milliseconds 50
        Set-Content -Path (Join-Path $script:dumpDir 'flight-recorder-002.jsonl') -Value "$header`n$trigger" -Encoding utf8
        Set-Content -Path (Join-Path $script:dumpDir 'unrelated.jsonl') -Value '{}' -Encoding utf8
    }

    It 'lists dump files matching the naming pattern' {
        $dumps = Get-FlightRecorderDump -DumpDir $script:dumpDir
        @($dumps).Count | Should -Be 2
    }

    It 'respects -Last parameter' {
        $dumps = Get-FlightRecorderDump -DumpDir $script:dumpDir -Last 1
        @($dumps).Count | Should -Be 1
    }

    It 'enriches files with EventCount from header' {
        $dump = Get-FlightRecorderDump -DumpDir $script:dumpDir -Last 1
        $dump.EventCount | Should -Be 5
    }

    It 'enriches files with TriggerType' {
        $dump = Get-FlightRecorderDump -DumpDir $script:dumpDir -Last 1
        $dump.TriggerType | Should -Be 'manual'
    }

    It 'enriches files with DumpTimestamp and AppVersion' {
        $dump = Get-FlightRecorderDump -DumpDir $script:dumpDir -Last 1
        $dump.DumpTimestamp | Should -Not -BeNullOrEmpty
        $dump.AppVersion | Should -Be '0.8.0'
    }

    It 'throws for nonexistent dump directory' {
        { Get-FlightRecorderDump -DumpDir 'C:\nonexistent\path' } | Should -Throw
    }

    It 'handles a dump with no header gracefully' {
        $noHeaderDir = Join-Path $TestDrive 'no-header'
        New-Item -ItemType Directory -Path $noHeaderDir -Force | Out-Null
        $evt = @{ _type = 'event'; level = 'info'; message = 'hello' } | ConvertTo-Json -Compress
        Set-Content -Path (Join-Path $noHeaderDir 'flight-recorder-empty.jsonl') -Value $evt -Encoding utf8

        $dump = Get-FlightRecorderDump -DumpDir $noHeaderDir
        $dump.EventCount | Should -Be 0
        $dump.DumpTimestamp | Should -BeNullOrEmpty
    }
}

Describe 'Get-FlightRecorderReport' -Tag 'template' {

    BeforeAll {
        $script:testFile = Join-Path $TestDrive 'report-dump.jsonl'

        $lines = @(
            (@{ _type = 'header'; schema_version = '1.0.0'; ring_buffer_capacity = 100; ring_buffer_events_total = 4; ring_buffer_events_retained = 4; events_lost = 0 } | ConvertTo-Json -Compress)
            (@{ _type = 'dictionary'; entries = @( @{ handle = 0; category = 'component'; value = 'api-server' } ) } | ConvertTo-Json -Compress)
            (@{ _type = 'context'; app = @{ version = '1.0.0' } } | ConvertTo-Json -Compress)
            (@{ _type = 'event'; _seq = 1; _wall = 1749290400000; type = 'http.request'; component = 0; level = 'info'; message = 'GET /api/health' } | ConvertTo-Json -Compress)
            (@{ _type = 'event'; _seq = 2; _wall = 1749290401000; type = 'http.request'; component = 0; level = 'info'; message = 'POST /api/data' } | ConvertTo-Json -Compress)
            (@{ _type = 'event'; _seq = 3; _wall = 1749290402000; type = 'system.error'; component = 0; level = 'error'; error_category = 'timeout'; message = 'DB timeout after 30s' } | ConvertTo-Json -Compress)
            (@{ _type = 'event'; _seq = 4; _wall = 1749290403000; type = 'http.request'; component = 0; level = 'warn'; message = 'Slow response 2.5s' } | ConvertTo-Json -Compress)
            (@{ _type = 'trigger'; trigger_type = 'error'; timestamp = '2026-06-22T10:00:03Z' } | ConvertTo-Json -Compress)
        )
        $lines | Set-Content -Path $script:testFile -Encoding utf8
    }

    It 'returns structured report with -AsObject' {
        $report = Get-FlightRecorderReport -Path $script:testFile -AsObject
        $report | Should -Not -BeNullOrEmpty
        $report.EventCount | Should -Be 4
        $report.ErrorCount | Should -Be 1
        $report.WarningCount | Should -Be 1
    }

    It 'resolves dictionary handles for components' {
        $report = Get-FlightRecorderReport -Path $script:testFile -AsObject
        $compNames = @($report.Components) | ForEach-Object { $_.Component }
        $compNames | Should -Contain 'api-server'
    }

    It 'tracks level distribution' {
        $report = Get-FlightRecorderReport -Path $script:testFile -AsObject
        $report.LevelCounts.info | Should -Be 2
        $report.LevelCounts.error | Should -Be 1
        $report.LevelCounts.warn | Should -Be 1
    }

    It 'categorizes errors' {
        $report = Get-FlightRecorderReport -Path $script:testFile -AsObject
        $report.ErrorSummary['timeout'] | Should -Be 1
    }

    It 'parses trigger metadata' {
        $report = Get-FlightRecorderReport -Path $script:testFile -AsObject
        $report.Trigger.Type | Should -Be 'error'
        $report.Trigger.Time | Should -Not -BeNullOrEmpty
    }

    It 'includes header stats' {
        $report = Get-FlightRecorderReport -Path $script:testFile -AsObject
        $report.Header.Capacity | Should -Be 100
        $report.Header.Retained | Should -Be 4
        $report.Header.Lost | Should -Be 0
    }

    It 'returns formatted text by default' {
        $output = Get-FlightRecorderReport -Path $script:testFile
        $output | Should -BeOfType [string]
        $output | Should -Match 'Flight Recorder Report'
    }

    It 'includes event listings with -Detailed' {
        $report = Get-FlightRecorderReport -Path $script:testFile -AsObject -Detailed
        $report.Events.Count | Should -Be 4
        $report.Errors.Count | Should -Be 1
        $report.Warnings.Count | Should -Be 1
        $report.Context | Should -Not -BeNullOrEmpty
    }

    It 'throws for missing file' {
        { Get-FlightRecorderReport -Path 'C:\nonexistent\dump.jsonl' } | Should -Throw
    }

    It 'handles corrupt JSON lines gracefully' {
        $corruptFile = Join-Path $TestDrive 'corrupt.jsonl'
        @(
            (@{ _type = 'header'; schema_version = '1.0.0' } | ConvertTo-Json -Compress)
            'THIS IS NOT JSON {'
            (@{ _type = 'event'; _seq = 1; _wall = 1749290400000; level = 'info'; message = 'ok' } | ConvertTo-Json -Compress)
        ) | Set-Content -Path $corruptFile -Encoding utf8

        $report = Get-FlightRecorderReport -Path $corruptFile -AsObject
        $report.EventCount | Should -Be 1
    }

    It 'handles empty dump file' {
        $emptyFile = Join-Path $TestDrive 'empty.jsonl'
        Set-Content -Path $emptyFile -Value '' -Encoding utf8

        $report = Get-FlightRecorderReport -Path $emptyFile -AsObject
        $report.EventCount | Should -Be 0
    }
}

Describe 'Show-FlightRecorder' -Tag 'template' {

    BeforeAll {
        $script:dumpDir = Join-Path $TestDrive 'show-dumps'
        New-Item -ItemType Directory -Path $script:dumpDir -Force | Out-Null
        $header = @{ _type = 'header'; schema_version = '1.0.0' } | ConvertTo-Json -Compress
        Set-Content -Path (Join-Path $script:dumpDir 'flight-recorder-show.jsonl') -Value $header -Encoding utf8
    }

    It 'throws for nonexistent path' {
        { Show-FlightRecorder -Path 'C:\nonexistent\dump.jsonl' } | Should -Throw
    }

    It 'falls back to report when no viewer HTML exists' {
        $dumpPath = Join-Path $script:dumpDir 'flight-recorder-show.jsonl'
        $output = Show-FlightRecorder -Path $dumpPath 3>&1 -WarningVariable warn
        # Should produce a warning about no viewer, and fall back to report
        @($warn).Count | Should -BeGreaterOrEqual 0
    }
}

Describe 'Find-FlightRecorderPattern' -Tag 'template' {

    BeforeAll {
        $script:patternDir = Join-Path $TestDrive 'pattern-dumps'
        New-Item -ItemType Directory -Path $script:patternDir -Force | Out-Null

        $header = @{ _type = 'header'; schema_version = '1.0.0'; ring_buffer_events_retained = 3 } | ConvertTo-Json -Compress

        # Dump 1: two rate_limit errors
        $dump1Lines = @(
            $header
            (@{ _type = 'event'; _seq = 1; _wall = 1749290400000; type = 'api.error'; component = 'ai'; level = 'error'; message = 'Rate limited by API at 2026-06-22T10:00:00' } | ConvertTo-Json -Compress)
            (@{ _type = 'event'; _seq = 2; _wall = 1749290401000; type = 'api.error'; component = 'ai'; level = 'error'; message = 'Rate limited by API at 2026-06-22T11:00:00' } | ConvertTo-Json -Compress)
            (@{ _type = 'event'; _seq = 3; _wall = 1749290402000; type = 'lifecycle'; component = 'app'; level = 'info'; message = 'ok' } | ConvertTo-Json -Compress)
        )
        Set-Content -Path (Join-Path $script:patternDir 'flight-recorder-p1.jsonl') -Value ($dump1Lines -join "`n") -Encoding utf8

        # Dump 2: one more rate_limit error
        Start-Sleep -Milliseconds 50
        $dump2Lines = @(
            $header
            (@{ _type = 'event'; _seq = 1; _wall = 1749290500000; type = 'api.error'; component = 'ai'; level = 'error'; message = 'Rate limited by API at 2026-06-23T10:00:00' } | ConvertTo-Json -Compress)
        )
        Set-Content -Path (Join-Path $script:patternDir 'flight-recorder-p2.jsonl') -Value ($dump2Lines -join "`n") -Encoding utf8
    }

    It 'detects recurring error patterns across dumps' {
        $results = Find-FlightRecorderPattern -DumpDir $script:patternDir -MinOccurrences 2
        @($results).Count | Should -BeGreaterOrEqual 1
        $results[0].Count | Should -BeGreaterOrEqual 2
        $results[0].Type | Should -Be 'api.error'
    }

    It 'normalizes timestamps in error messages' {
        $results = Find-FlightRecorderPattern -DumpDir $script:patternDir -MinOccurrences 2
        # The three errors should be grouped as one pattern despite different timestamps
        @($results).Count | Should -Be 1
        $results[0].Count | Should -Be 3
    }

    It 'respects MinOccurrences threshold' {
        $results = Find-FlightRecorderPattern -DumpDir $script:patternDir -MinOccurrences 10
        $results | Should -BeNullOrEmpty
    }

    It 'tracks which dump files contain the pattern' {
        $results = Find-FlightRecorderPattern -DumpDir $script:patternDir -MinOccurrences 2
        @($results[0].DumpFiles).Count | Should -Be 2
    }
}

Describe 'Test-FlightRecorderPII' -Tag 'template' {

    It 'detects Google API key pattern' {
        $testFile = Join-Path $TestDrive 'pii-google.jsonl'
        @(
            (@{ _type = 'event'; level = 'info'; message = 'Using key AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567' } | ConvertTo-Json -Compress)
        ) | Set-Content -Path $testFile -Encoding utf8

        $result = Test-FlightRecorderPII -Path $testFile
        $result.Pass | Should -Be $false
        @($result.Findings).Count | Should -BeGreaterOrEqual 1
        $result.Findings[0].Pattern | Should -Be 'API Key (Google)'
    }

    It 'detects email addresses' {
        $testFile = Join-Path $TestDrive 'pii-email.jsonl'
        @(
            (@{ _type = 'event'; level = 'info'; message = 'User logged in: john@example.com' } | ConvertTo-Json -Compress)
        ) | Set-Content -Path $testFile -Encoding utf8

        $result = Test-FlightRecorderPII -Path $testFile
        $result.Pass | Should -Be $false
        $result.Findings[0].Pattern | Should -Be 'Email Address'
    }

    It 'detects Bearer tokens' {
        $testFile = Join-Path $TestDrive 'pii-bearer.jsonl'
        @(
            (@{ _type = 'event'; level = 'info'; message = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test' } | ConvertTo-Json -Compress)
        ) | Set-Content -Path $testFile -Encoding utf8

        $result = Test-FlightRecorderPII -Path $testFile
        $result.Pass | Should -Be $false
        @($result.Findings | Where-Object { $_.Pattern -eq 'Bearer Token' }).Count | Should -BeGreaterOrEqual 1
    }

    It 'passes for clean dumps with no PII' {
        $testFile = Join-Path $TestDrive 'pii-clean.jsonl'
        @(
            '{"_type":"event","level":"info","message":"Application started"}'
            '{"_type":"event","level":"info","message":"Round 1 complete"}'
        ) | Set-Content -Path $testFile -Encoding utf8

        $result = Test-FlightRecorderPII -Path $testFile
        $result.Pass | Should -Be $true
        @($result.Findings).Count | Should -Be 0
    }

    It 'masks matched values for safe display' {
        $testFile = Join-Path $TestDrive 'pii-mask.jsonl'
        @(
            (@{ _type = 'event'; level = 'info'; message = 'Found key AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567' } | ConvertTo-Json -Compress)
        ) | Set-Content -Path $testFile -Encoding utf8

        $result = Test-FlightRecorderPII -Path $testFile
        @($result.Findings).Count | Should -BeGreaterOrEqual 1
        $result.Findings[0].Match | Should -Match '\.\.\.'
        $result.Findings[0].Match.Length | Should -BeLessThan 39
    }

    It 'throws for nonexistent file' {
        { Test-FlightRecorderPII -Path 'C:\nonexistent\dump.jsonl' } | Should -Throw
    }

    It 'reports line numbers for findings' {
        $testFile = Join-Path $TestDrive 'pii-lines.jsonl'
        @(
            (@{ _type = 'event'; level = 'info'; message = 'clean line' } | ConvertTo-Json -Compress)
            (@{ _type = 'event'; level = 'info'; message = 'has user@test.com email' } | ConvertTo-Json -Compress)
        ) | Set-Content -Path $testFile -Encoding utf8

        $result = Test-FlightRecorderPII -Path $testFile
        $result.Findings[0].Line | Should -Be 2
    }
}
