# Copyright (c) 2026 2026 Snover International Consulting LLC. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

@{
    RootModule        = 'AITriad.psm1'
    ModuleVersion     = '0.7.3'
    GUID              = 'a7c3e1f0-4b2d-4e8a-9f6c-1d3b5e7a9c0f'
    Author            = 'Jeffrey Snover'
    CompanyName       = 'Snover International Consulting LLC'
    Copyright         = '(c) 2026 Snover International Consulting LLC. All rights reserved.'
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
        'Find-AITSource'
        'Save-WaybackUrl'
        'Save-AITSource'
        'Invoke-PIIAudit'
        'Update-Snapshot'
        'Show-TaxonomyEditor'
        'Show-POViewer'
        'Show-SummaryViewer'
        'Show-AITriadHelp'
        'Get-TaxonomyHealth'
        'Measure-TaxonomyBaseline'
        'Invoke-TaxonomyProposal'
        'Compare-Taxonomy'
        'Get-AITSource'
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
        'Find-SituationCandidates'
        'Find-CrossCuttingCandidates'
        'Show-TriadDialogue'
        'Register-AIBackend'
        'Install-AITriadData'
        'Install-AIDependencies'
        'Test-Dependencies'
        'Find-PossibleFallacy'
        'Find-PolicyAction'
        'Get-Policy'
        'Update-PolicyRegistry'
        'Show-FallacyInfo'
        'Test-TaxonomyIntegrity'
        'Invoke-HierarchyProposal'
        'Set-TaxonomyHierarchy'
        'Invoke-SchemaMigration'
        'Invoke-PolicyRefinement'
        'Repair-UnmappedConcepts'
        'Invoke-AITDebate'
        'Convert-DebateToAudio'
        'Convert-MD2PDF'
        'Show-Markdown'
        'Show-DebateDiagnostics'
        'Repair-DebateOutput'
        'Show-DebateHarvest'
        'Get-AITSBOM'
        'Test-OntologyCompliance'
        'Get-RelevantTaxonomyNodes'
        'Invoke-QbafConflictAnalysis'
        'Test-ExtractionQuality'
        'Show-WorkflowRunner'
        'Test-EdgeDirection'
        'Test-AITJudgeModel'
        'Repair-AITSummaryMappings'
    )

    # Aliases exported from this module
    AliasesToExport   = @(
        'Import-Document'
        'Install-AITdependencies'
        'TaxonomyEditor'
        'POViewer'
        'SummaryViewer'
        'Redo-Snapshots'
        'Show-MD'
        'Workflow'
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
