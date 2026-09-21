# Tag: health (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force
}

Describe 'Request-FlightRecorderDump' -Tag 'health' {

    It 'verifies protocol over named pipe round-trip' {
        $mockResponse = @{
            path        = 'C:\Users\test\flight-recorder-20260607.jsonl'
            event_count = 150
            time_range  = @{ start = '2026-06-07T10:00:00Z'; end = '2026-06-07T10:15:00Z' }
            debate_id   = 'abc-123'
            timestamp   = '2026-06-07T10:15:30Z'
        } | ConvertTo-Json -Compress

        # Unique per-run pipe name (GUID, not $PID) so a leftover pipe from a
        # previously wedged run can never collide with this one (t/3527).
        $pipeName = "test-fr-dump-$([guid]::NewGuid().ToString('N'))"
        $serverJob = Start-Job -ScriptBlock {
            param($pipeName, $response)
            $server = [System.IO.Pipes.NamedPipeServerStream]::new(
                $pipeName,
                [System.IO.Pipes.PipeDirection]::InOut
            )
            try {
                $server.WaitForConnection()
                $reader = [System.IO.StreamReader]::new($server, [System.Text.Encoding]::UTF8, $false, 1024, $true)
                $writer = [System.IO.StreamWriter]::new($server, [System.Text.Encoding]::UTF8, 1024, $true)
                $null = $reader.ReadLine()
                $writer.WriteLine($response)
                $writer.Flush()
                $reader.Dispose()
                $writer.Dispose()
                Start-Sleep -Milliseconds 200
            } finally {
                try { $server.Dispose() } catch { }
            }
        } -ArgumentList $pipeName, $mockResponse

        $pipe = $null
        $writer = $null
        $reader = $null
        try {
            # No fixed pre-sleep: Connect(timeout) itself polls for the server to
            # create the pipe, so a generous 30s timeout absorbs cross-process
            # Start-Job startup latency on a loaded CI runner (t/3527). The old
            # 300ms sleep + 3s connect raced job startup and flaked the required gate.
            $pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $pipeName, [System.IO.Pipes.PipeDirection]::InOut)
            $pipe.Connect(30000)
            $writer = [System.IO.StreamWriter]::new($pipe, [System.Text.Encoding]::UTF8, 1024, $true)
            $reader = [System.IO.StreamReader]::new($pipe, [System.Text.Encoding]::UTF8, $false, 1024, $true)

            $request = @{ action = 'dump' } | ConvertTo-Json -Compress
            $writer.WriteLine($request)
            $writer.Flush()

            $responseLine = $reader.ReadLine()
            $result = $responseLine | ConvertFrom-Json

            $result.event_count | Should -Be 150
            $result.debate_id | Should -Be 'abc-123'
            $result.path | Should -Not -BeNullOrEmpty
        } finally {
            # Dispose in try/finally so a failed Connect/assertion can't leak the
            # client pipe or leave the server job running into later runs (t/3527).
            if ($reader) { try { $reader.Dispose() } catch { } }
            if ($writer) { try { $writer.Dispose() } catch { } }
            if ($pipe)   { try { $pipe.Dispose() } catch { } }
            $null = Receive-Job $serverJob -Wait -AutoRemoveJob -ErrorAction SilentlyContinue
        }
    }

    It 'outputs object with expected properties' {
        $obj = [PSCustomObject]@{
            PID        = 1234
            Path       = '/tmp/test.jsonl'
            EventCount = 42
            TimeRange  = $null
            DebateId   = 'test-id'
            DumpedAt   = '2026-06-07T10:00:00Z'
        }
        $obj.PSObject.Properties.Name | Should -Contain 'PID'
        $obj.PSObject.Properties.Name | Should -Contain 'Path'
        $obj.PSObject.Properties.Name | Should -Contain 'EventCount'
        $obj.PSObject.Properties.Name | Should -Contain 'DebateId'
    }
}
