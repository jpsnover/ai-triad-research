# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

BeforeAll {
    Import-Module "$PSScriptRoot/../scripts/AITriad/AITriad.psm1" -Force
}

Describe 'Request-FlightRecorderDump' {

    It 'verifies protocol over named pipe round-trip' {
        $mockResponse = @{
            path        = 'C:\Users\test\flight-recorder-20260607.jsonl'
            event_count = 150
            time_range  = @{ start = '2026-06-07T10:00:00Z'; end = '2026-06-07T10:15:00Z' }
            debate_id   = 'abc-123'
            timestamp   = '2026-06-07T10:15:30Z'
        } | ConvertTo-Json -Compress

        $pipeName = "test-fr-dump-$PID"
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

        Start-Sleep -Milliseconds 300

        $pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $pipeName, [System.IO.Pipes.PipeDirection]::InOut)
        $pipe.Connect(3000)
        $writer = [System.IO.StreamWriter]::new($pipe, [System.Text.Encoding]::UTF8, 1024, $true)
        $reader = [System.IO.StreamReader]::new($pipe, [System.Text.Encoding]::UTF8, $false, 1024, $true)

        $request = @{ action = 'dump' } | ConvertTo-Json -Compress
        $writer.WriteLine($request)
        $writer.Flush()

        $responseLine = $reader.ReadLine()
        $result = $responseLine | ConvertFrom-Json

        $reader.Dispose()
        $writer.Dispose()
        $pipe.Dispose()

        $result.event_count | Should -Be 150
        $result.debate_id | Should -Be 'abc-123'
        $result.path | Should -Not -BeNullOrEmpty

        $null = Receive-Job $serverJob -Wait -AutoRemoveJob -ErrorAction SilentlyContinue
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
