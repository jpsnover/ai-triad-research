// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { loadAnalysisResult, loadAnnotations, getSourceDir } from './fileIO';
import type { AnalysisResult, RawMapping } from './analysisTypes';

export async function exportBundle(
  sourceIds: string[],
  outputPath: string,
  format: string,
): Promise<void> {
  if (format === 'markdown') {
    const markdown = await generateMarkdownReport(sourceIds);
    fs.writeFileSync(outputPath, markdown, 'utf-8');
    return;
  }

  // ZIP format: write individual JSON + markdown files
  // For simplicity, create a directory-based export (ZIP requires additional dep)
  const exportDir = outputPath.replace(/\.zip$/i, '');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  for (const sourceId of sourceIds) {
    const analysisResult = loadAnalysisResult(sourceId);
    const annotations = loadAnnotations(sourceId);

    if (analysisResult) {
      fs.writeFileSync(
        path.join(exportDir, `${sourceId}-analysis.json`),
        JSON.stringify(analysisResult, null, 2) + '\n',
        'utf-8',
      );
    }

    if (annotations && Array.isArray(annotations) && annotations.length > 0) {
      fs.writeFileSync(
        path.join(exportDir, `${sourceId}-annotations.json`),
        JSON.stringify(annotations, null, 2) + '\n',
        'utf-8',
      );
    }
  }

  // Write combined markdown report
  const markdown = await generateMarkdownReport(sourceIds);
  fs.writeFileSync(path.join(exportDir, 'report.md'), markdown, 'utf-8');
}

export async function generateMarkdownReport(sourceIds: string[]): Promise<string> {
  const lines: string[] = [
    '# POViewer Analysis Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Sources: ${sourceIds.length}`,
    '',
  ];

  for (const sourceId of sourceIds) {
    const result = loadAnalysisResult(sourceId) as AnalysisResult | null;
    if (!result) {
      lines.push(`## ${sourceId}`, '', 'No analysis data available.', '');
      continue;
    }

    lines.push(`## Source: ${sourceId}`, '');
    lines.push(`- **Model**: ${result.model}`);
    lines.push(`- **Completed**: ${result.completedAt}`);
    lines.push(`- **Points found**: ${result.points.length}`);
    lines.push(`- **Mappings**: ${result.mappings.length}`);
    lines.push('');

    // Group mappings by camp
    const byCamp: Record<string, RawMapping[]> = {};
    for (const m of result.mappings) {
      if (!byCamp[m.camp]) byCamp[m.camp] = [];
      byCamp[m.camp].push(m);
    }

    for (const [camp, mappings] of Object.entries(byCamp)) {
      lines.push(`### ${camp.charAt(0).toUpperCase() + camp.slice(1)}`);
      lines.push('');
      for (const m of mappings) {
        const point = result.points[m.pointIndex];
        const snippet = point?.text?.slice(0, 80) || '(no text)';
        lines.push(`- **${m.nodeLabel}** (${m.alignment}, ${m.strength})`);
        lines.push(`  > ${snippet}...`);
        lines.push(`  ${m.explanation}`);
        lines.push('');
      }
    }

    // Unmapped points
    const mappedIndices = new Set(result.mappings.map(m => m.pointIndex));
    const unmapped = result.points.filter((_, i) => !mappedIndices.has(i));
    if (unmapped.length > 0) {
      lines.push('### Unmapped Points', '');
      for (const p of unmapped) {
        lines.push(`- ${p.text.slice(0, 100)}...`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
