# Analysis — File Inventory

Reference inventory of the analysis/dashboard components in this scope
(`taxonomy-editor/src/renderer/components/analysis/`). Behavioral norms live in
`AGENTS.md`.

| File | Purpose |
|------|---------|
| `AnalyticsDashboard.tsx` | Main analytics overview dashboard |
| `CalibrationDashboard.tsx` | Model calibration metrics and visualization |
| `PolicyDashboard.tsx` | Policy alignment overview |
| `AnalysisPanel.tsx` | General analysis panel container |
| `PolicyAlignmentPanel.tsx` | Policy alignment scoring and comparison |
| `TaxonomyGapPanel.tsx` | Gap detection in taxonomy coverage |
| `NeutralEvaluationPanel.tsx` | Neutral stance evaluation view |
| `ConvergenceSignalsPanel.tsx` | Debate convergence signal display |
| `FallacyPanel.tsx` | Fallacy detection and annotation |
| `FactsPanel.tsx` | Fact extraction and display |
| `LineagePanel.tsx` | Intellectual lineage tracing |
| `GroundingPanel.tsx` | Source grounding verification |
| `SummariesTab.tsx` | Summary browsing tab |
| `ExtractionTimelinePanel.tsx` | Extraction process timeline |
| `ParameterHistoryPanel.tsx` | AI parameter history tracking |
| `AttributeFilterPanel.tsx` | Attribute-based filtering |
| `AttributeInfoPanel.tsx` | Attribute metadata display |
| `CalibrationReviewViewer.tsx` | Calibration domain viewer for the unified admin-review panel |
| `SystemOverviewRow.tsx` | Cross-domain summary strip on the analytics dashboard |
| `DebateHealthCard.tsx` / `AICostCard.tsx` / `DebateFunnelChart.tsx` | Analytics cards: debate health, AI spend, debate funnel |
| `chartTooltip.tsx` | Shared hover-tooltip helper for the hand-coded SVG charts |
| `index.ts` | Barrel re-exports |
