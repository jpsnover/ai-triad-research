# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

@{
    RootModule        = 'AITriad.psm1'
    ModuleVersion     = '0.1.0'
    GUID              = 'a7c3e1f0-4b2d-4e8a-9f6c-1d3b5e7a9c0f'
    Author            = 'jsnov'
    CompanyName       = 'AI Triad Research'
    Copyright         = '(c) 2026 AI Triad Research. All rights reserved.'
    Description       = 'AI Triad Research — taxonomy queries, document ingestion, POV analysis'
    PowerShellVersion = '7.0'

    # Functions exported from this module
    FunctionsToExport = @(
        'Get-Tax'
        'Update-TaxEmbeddings'
        'Import-AITriadDocument'
        'Invoke-POVSummary'
        'Invoke-BatchSummary'
        'Find-Conflict'
        'Find-Source'
        'Save-WaybackUrl'
        'Save-Source'
        'Invoke-PIIAudit'
        'Update-Snapshot'
        'Show-TaxonomyEditor'
        'Show-POViewer'
        'Show-SummaryViewer'
        'Show-AITriadHelp'
        'Get-TaxonomyHealth'
        'Invoke-TaxonomyProposal'
        'Compare-Taxonomy'
        'Get-Source'
        'Get-Summary'
        'Invoke-AttributeExtraction'
        'Invoke-EdgeDiscovery'
        'Get-GraphNode'
        'Find-GraphPath'
        'Approve-Edge'
        'Approve-TaxonomyProposal'
        'Get-Edge'
        'Set-Edge'
        'Invoke-GraphQuery'
        'Get-ConflictEvolution'
        'Export-TaxonomyToGraph'
        'Install-GraphDatabase'
        'Invoke-CypherQuery'
        'Show-GraphOverview'
        'Get-TopicFrequency'
        'Get-IngestionPriority'
        'Find-CrossCuttingCandidates'
        'Show-TriadDialogue'
        'Register-AIBackend'
        'Install-Dependencies'
        'Test-Dependencies'
        'Find-PossibleFallacy'
        'Find-PolicyAction'
        'Show-FallacyInfo'
    )

    # Aliases exported from this module
    AliasesToExport   = @(
        'Import-Document'
        'TaxonomyEditor'
        'POViewer'
        'SummaryViewer'
        'Redo-Snapshots'
    )

    # Cmdlets exported (none — pure script module)
    CmdletsToExport   = @()

    # Variables exported (none)
    VariablesToExport = @()

    # Format files to load
    FormatsToProcess  = @('Formats/Taxonomy.Format.ps1xml')

    # Private data
    PrivateData = @{
        PSData = @{
            Tags       = @('AI', 'Taxonomy', 'Research', 'POV', 'Gemini')
            ProjectUri = 'https://github.com/jsnov/ai-triad-research'
        }
    }
}
