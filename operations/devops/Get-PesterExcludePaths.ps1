function Get-PesterExcludePaths {
    # Single source of truth for the ExcludePath glob used by ci.yml test-powershell
    # and the guard test (Test-PesterExcludeConfig.Tests.ps1). Both consumers dot-source
    # this file. Change here propagates to both without drift. (t/3010)
    @('*/data-compliance/*')
}
