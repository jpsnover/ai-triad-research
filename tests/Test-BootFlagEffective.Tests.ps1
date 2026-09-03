# Both-arms proof for the config-drift in-process-flag-assert predicate (t/3247, prevention for
# t/3165). Dot-sources the SAME predicate file the deploy-azure.yml gate step uses (t/3010
# co-location — gate and proof cannot diverge).
#
# GV cond 3 (couple to #1828 contract): the CLEAN fixture is a REAL boot line captured from Log
# Analytics (revision taxonomy-editor--deploy-b5f65c3-77580, 2026-09-02). The FALSE/drift fixture
# is that same line with the flag flipped — so the test breaks if ServerAPI's #1828 emit shape
# (field name / message) ever changes, forcing a co-update.

BeforeAll {
    . "$PSScriptRoot/../operations/devops/Test-BootFlagEffective.ps1"

    # REAL #1828 boot line (captured from Log Analytics — do not synthesize this one).
    $script:RealTrueLine  = '{"level":30,"time":1788377646519,"pid":7,"hostname":"taxonomy-editor--deploy-b5f65c3-77580-64f77fcbb4-n6hkl","component":"server","embeddingWorkerOffload":true,"msg":"embedding offload flag at boot"}'
    # Same shape, flag evaluated FALSE — the drift regression (present-in-config but ineffective).
    $script:RealFalseLine = $script:RealTrueLine -replace '"embeddingWorkerOffload":true', '"embeddingWorkerOffload":false'
}

Describe 'Test-BootFlagEffective — in-process flag assert (t/3247)' {

    It 'CLEAN: real boot line embeddingWorkerOffload=true -> Effective / Pass' {
        $r = Test-BootFlagEffective -BootLogLines @($script:RealTrueLine)
        $r.Status | Should -Be 'Effective'
        $r.Pass   | Should -BeTrue
        $r.Value  | Should -BeTrue
    }

    It 'FIRE (drift): embeddingWorkerOffload=false -> Drift / Fail — present but NOT effective' {
        $r = Test-BootFlagEffective -BootLogLines @($script:RealFalseLine)
        $r.Status | Should -Be 'Drift'
        $r.Pass   | Should -BeFalse
        $r.Value  | Should -BeFalse
        $r.Detail | Should -Match 'present != effective'
    }

    It 'FIRE (not-found): no boot lines -> NotFound / Fail, DISTINCT diagnostic (not drift)' {
        $r = Test-BootFlagEffective -BootLogLines @()
        $r.Status | Should -Be 'NotFound'
        $r.Pass   | Should -BeFalse
        $r.Detail | Should -Match 'ingestion'
        $r.Detail | Should -Match 'NOT config drift'
    }

    It 'FIRE (not-found): field present but NOT the #1828 boot message -> NotFound (message-coupled)' {
        $r = Test-BootFlagEffective -BootLogLines @('{"msg":"some other log","embeddingWorkerOffload":true}')
        $r.Status | Should -Be 'NotFound'
    }

    It 'latest-wins: multiple boot lines, last is false -> Drift' {
        $r = Test-BootFlagEffective -BootLogLines @($script:RealTrueLine, $script:RealFalseLine)
        $r.Status | Should -Be 'Drift'
    }

    It 'latest-wins: multiple boot lines, last is true -> Effective' {
        $r = Test-BootFlagEffective -BootLogLines @($script:RealFalseLine, $script:RealTrueLine)
        $r.Status | Should -Be 'Effective'
    }

    It 'symmetry: Expected=$false + false line -> Effective (predicate is generic over expected)' {
        $r = Test-BootFlagEffective -BootLogLines @($script:RealFalseLine) -Expected $false
        $r.Status | Should -Be 'Effective'
        $r.Pass   | Should -BeTrue
    }

    It 'tolerates a null/empty entry interleaved with the real line' {
        $r = Test-BootFlagEffective -BootLogLines @($null, '', $script:RealTrueLine)
        $r.Status | Should -Be 'Effective'
    }
}
