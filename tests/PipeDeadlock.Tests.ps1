# Tag: debate (t/1186)
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

#Requires -Module Pester

# Regression test for t/1170: Invoke-AITDebate / Resume-AITDebate stdout/stderr
# pipe deadlock. The CLI emits multi-MB session JSON on stdout; the wrapper used
# to drain stderr to EOF FIRST, then call StandardOutput.ReadToEnd() — which
# deadlocks because the child blocks on stdout (pipe buffer ~64KB on Windows)
# before stderr can ever reach EOF.
#
# Fix: kick off ReadToEndAsync() immediately after Process.Start so stdout is
# drained concurrently while the main thread reads stderr line-by-line.
#
# This test exercises that exact pattern in isolation (no real npx/CLI) by
# spawning a child pwsh that simulates the CLI's I/O shape: lots of stdout +
# some line-by-line stderr.

Describe 'Pipe deadlock regression (t/1170)' -Tag 'debate' {

    It 'Concurrent stdout/stderr drain does not deadlock on >256KB stdout' {
        # Child script writes ~512 KB to stdout AND ~20 lines of progress to
        # stderr, interleaved with deliberate flushes so the OS pipe buffer
        # fills during execution (not all at the end).
        $childScript = @'
$ErrorActionPreference = 'Stop'
$big = 'X' * 4096   # 4KB chunk
for ($i = 0; $i -lt 128; $i++) {
    [Console]::Out.Write($big)
    if ($i % 10 -eq 0) {
        [Console]::Error.WriteLine("[debate-cli] [round_$i] Accelerationist: tick $i")
        [Console]::Error.Flush()
    }
}
[Console]::Out.Flush()
[Console]::Error.WriteLine('[debate-cli] [done] complete')
[Console]::Error.Flush()
exit 0
'@

        $psi = [System.Diagnostics.ProcessStartInfo]::new()
        $psi.FileName = 'pwsh'
        $psi.Arguments = "-NoProfile -NonInteractive -Command `"$($childScript -replace '"', '\"')`""
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true

        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $proc = [System.Diagnostics.Process]::Start($psi)

        # The fix: drain stdout asynchronously BEFORE entering the stderr loop.
        $stdoutTask = $proc.StandardOutput.ReadToEndAsync()

        # Main-thread stderr drain — same pattern as Invoke-AITDebate's loop.
        $stderrLines = [System.Collections.Generic.List[string]]::new()
        while (-not $proc.StandardError.EndOfStream) {
            $line = $proc.StandardError.ReadLine()
            if ($line) { $stderrLines.Add($line) }
        }

        # Join the stdout task.
        $stdout = $stdoutTask.GetAwaiter().GetResult()

        # 30-second budget: would deadlock indefinitely before the fix.
        $exited = $proc.WaitForExit(30000)
        $sw.Stop()

        $exited | Should -Be $true
        $sw.Elapsed.TotalSeconds | Should -BeLessThan 30
        $proc.ExitCode | Should -Be 0

        # Stdout payload arrived intact
        $stdout.Length | Should -BeGreaterThan (256 * 1024)
        @($stdout.ToCharArray() | Where-Object { $_ -ne 'X' }).Count | Should -Be 0

        # Stderr lines were captured for per-turn progress display
        @($stderrLines).Count | Should -BeGreaterThan 5
        ($stderrLines -join "`n") | Should -Match '\[debate-cli\] \[round_\d+\]'
        ($stderrLines -join "`n") | Should -Match '\[debate-cli\] \[done\]'
    }

    It 'Fix is present in Invoke-AITDebate.ps1' {
        # Guard against regressions where someone removes the async drain.
        $path = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Invoke-AITDebate.ps1'
        $content = Get-Content -Raw $path
        $content | Should -Match 'ReadToEndAsync'
        $content | Should -Match 'GetAwaiter\(\)\.GetResult\(\)'
    }

    It 'Fix is present in Resume-AITDebate.ps1' {
        $path = Join-Path $PSScriptRoot '..' 'scripts' 'AITriad' 'Public' 'Resume-AITDebate.ps1'
        $content = Get-Content -Raw $path
        $content | Should -Match 'ReadToEndAsync'
        $content | Should -Match 'GetAwaiter\(\)\.GetResult\(\)'
    }
}
