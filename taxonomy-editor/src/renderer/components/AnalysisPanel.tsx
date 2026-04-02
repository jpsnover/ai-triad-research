// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { ApiKeyErrorMessage } from './ApiKeyErrorMessage';
import type { PovNode } from '../types/taxonomy';

interface AnalysisPanelProps {
  width?: number;
}

const STEPS = [
  { step: 1, label: 'Preparing elements' },
  { step: 2, label: 'Building audit prompt' },
  { step: 3, label: 'Sending to AI' },
  { step: 4, label: 'Processing response' },
];

/** Extract the first JSON code block from markdown text */
function extractRefinedJson(markdown: string): Record<string, unknown> | null {
  const match = markdown.match(/```json\s*\n([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extract the critique summary — everything between "Critique Summary" heading
 * and the next heading (#### or ###).
 */
function extractCritiqueSummary(markdown: string): string | null {
  const match = markdown.match(/#{3,5}\s*Critique Summary\s*\n([\s\S]*?)(?=\n#{3,5}\s|\n```json|$)/i);
  return match ? match[1].trim() : null;
}

/**
 * Extract all rationalization sections from the markdown.
 * Looks for subsections under "Structural Rationalization" (##### headings)
 * and also collects any top-level rationalization paragraphs.
 */
function extractRationalizationSections(markdown: string): { heading: string; body: string }[] {
  const result: { heading: string; body: string }[] = [];

  // Find the Structural Rationalization block
  const ratMatch = markdown.match(/#{3,5}\s*Structural Rationalization\s*\n([\s\S]*?)(?=\n#{3,4}\s*Refined Node|$)/i);
  if (!ratMatch) return result;
  const ratBlock = ratMatch[1];

  // Split into subsections by ##### headings
  const sections = ratBlock.split(/(?=\n#{4,5}\s)/);
  for (const section of sections) {
    const headingMatch = section.match(/#{4,5}\s+(.+?)(?:\s+Change)?\s*\n([\s\S]*)/i);
    if (headingMatch) {
      result.push({ heading: headingMatch[1].trim().toLowerCase(), body: headingMatch[2].trim() });
    } else {
      // Non-headed text at the beginning of the rationalization block
      const trimmed = section.trim();
      if (trimmed) {
        result.push({ heading: '', body: trimmed });
      }
    }
  }
  return result;
}

interface FieldDiff {
  key: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
  rationale: string | null;
}

/** Keywords for matching AI subsection headings to diff field keys */
const FIELD_MATCH_KEYWORDS: Record<string, string[]> = {
  label: ['label', 'node label', 'node name'],
  description: ['description', 'epistemic drift', 'epistemic', 'drift', 'rhetoric', 'node description'],
  category: ['category', 'categorization'],
  parent_id: ['parent', 'parent_id', 'parent id', 'taxonomic placement', 'placement', 'hierarchy'],
  children: ['children', 'child'],
  situation_refs: ['situation', 'situations', 'cross-cutting', 'redundancy', 'redundancy check', 'merge', 'interprets', 'universal concept'],
  graph_attributes: ['graph attribute', 'graph_attribute', 'attributes', 'assumes', 'relational integrity', 'falsifiability', 'rhetorical', 'policy'],
};

function matchRationale(
  fieldKey: string,
  sections: { heading: string; body: string }[],
  usedIndices: Set<number>,
): string | null {
  const keywords = FIELD_MATCH_KEYWORDS[fieldKey] || [fieldKey];
  for (let i = 0; i < sections.length; i++) {
    if (usedIndices.has(i)) continue;
    const heading = sections[i].heading;
    if (!heading) continue;
    for (const kw of keywords) {
      if (heading.includes(kw)) {
        usedIndices.add(i);
        return sections[i].body;
      }
    }
  }
  return null;
}

/** Compare original node against refined JSON, returning changed fields with rationale */
function computeDiffs(
  original: PovNode,
  refined: Record<string, unknown>,
  rationalizationSections: { heading: string; body: string }[],
): { diffs: FieldDiff[]; unmatchedRationale: string | null } {
  const diffs: FieldDiff[] = [];
  const FIELD_LABELS: Record<string, string> = {
    label: 'Label',
    description: 'Description',
    category: 'Category',
    parent_id: 'Parent ID',
    children: 'Children',
    situation_refs: 'Situation Refs',
    graph_attributes: 'Graph Attributes',
  };

  const usedIndices = new Set<number>();

  for (const key of Object.keys(FIELD_LABELS)) {
    if (!(key in refined)) continue;
    const oldVal = (original as unknown as Record<string, unknown>)[key];
    const newVal = refined[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diffs.push({
        key,
        label: FIELD_LABELS[key] || key,
        oldValue: oldVal,
        newValue: newVal,
        rationale: matchRationale(key, rationalizationSections, usedIndices),
      });
    }
  }

  // Assign unmatched sections to diffs that have no rationale yet
  const unmatchedSections: { heading: string; body: string }[] = [];
  for (let i = 0; i < rationalizationSections.length; i++) {
    if (!usedIndices.has(i) && rationalizationSections[i].body) {
      unmatchedSections.push(rationalizationSections[i]);
    }
  }

  // Try to assign remaining sections to diffs missing rationale
  for (const diff of diffs) {
    if (diff.rationale) continue;
    if (unmatchedSections.length === 0) break;
    // Take the first unmatched section
    const section = unmatchedSections.shift()!;
    diff.rationale = section.heading
      ? `**${section.heading}**\n\n${section.body}`
      : section.body;
  }

  // Remaining unmatched
  const leftover = unmatchedSections
    .map(s => s.heading ? `**${s.heading}**\n\n${s.body}` : s.body)
    .join('\n\n');

  return { diffs, unmatchedRationale: leftover || null };
}

// ─── Graph Attributes sub-field diff ────────────────────

interface AttrSubDiff {
  key: string;
  changed: boolean;
  oldValue: unknown;
  newValue: unknown;
}

function computeAttrSubDiffs(
  oldAttrs: Record<string, unknown> | undefined,
  newAttrs: Record<string, unknown> | undefined,
): AttrSubDiff[] {
  const allKeys = new Set([
    ...Object.keys(oldAttrs || {}),
    ...Object.keys(newAttrs || {}),
  ]);
  const result: AttrSubDiff[] = [];
  for (const key of allKeys) {
    const oldVal = oldAttrs?.[key];
    const newVal = newAttrs?.[key];
    result.push({
      key,
      changed: JSON.stringify(oldVal) !== JSON.stringify(newVal),
      oldValue: oldVal,
      newValue: newVal,
    });
  }
  return result;
}

function formatSimpleValue(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'string') return val;
  return JSON.stringify(val, null, 2);
}

// ─── Component ──────────────────────────────────────────

export function AnalysisPanel({ width }: AnalysisPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [acceptedFields, setAcceptedFields] = useState<Set<string>>(new Set());
  const {
    analysisResult,
    analysisLoading,
    analysisError,
    analysisStep,
    analysisRetry,
    analysisCached,
    analysisElementA,
    analysisElementB,
    analysisTitle,
    analysisCritiquePov,
    analysisCritiqueNodeId,
    analysisCritiqueOriginalNode,
    clearAnalysis,
    runAnalyzeDistinction,
    runNodeCritique,
    updatePovNode,
    save,
    policyRegistry,
    geminiModel,
  } = useTaxonomyStore();

  const isCritique = analysisCritiqueOriginalNode !== null;

  // Parse critique results
  const critiqueSummary = useMemo(() => {
    if (!analysisResult || !isCritique) return null;
    return extractCritiqueSummary(analysisResult);
  }, [analysisResult, isCritique]);

  const { diffs, unmatchedRationale } = useMemo(() => {
    if (!analysisResult || !analysisCritiqueOriginalNode) return { diffs: [], unmatchedRationale: null };
    const refined = extractRefinedJson(analysisResult);
    if (!refined) return { diffs: [], unmatchedRationale: null };
    const sections = extractRationalizationSections(analysisResult);
    return computeDiffs(analysisCritiqueOriginalNode, refined, sections);
  }, [analysisResult, analysisCritiqueOriginalNode]);

  // Reset accepted fields when results change
  const [prevResult, setPrevResult] = useState<string | null>(null);
  if (analysisResult !== prevResult) {
    setPrevResult(analysisResult);
    if (acceptedFields.size > 0) setAcceptedFields(new Set());
  }

  if (!analysisResult && !analysisLoading && !analysisError) return null;

  if (collapsed) {
    return (
      <div className="pane-collapsed" onClick={() => setCollapsed(false)} title="Expand Analysis">
        <span className="pane-collapsed-label">Analysis</span>
      </div>
    );
  }

  const handleRefresh = () => {
    if (analysisElementA && analysisElementB) {
      runAnalyzeDistinction(analysisElementA, analysisElementB, true);
    }
  };

  const handleRetry = () => {
    if (isCritique && analysisCritiquePov && analysisCritiqueOriginalNode) {
      runNodeCritique(analysisCritiquePov, analysisCritiqueOriginalNode);
    } else if (analysisElementA && analysisElementB) {
      runAnalyzeDistinction(analysisElementA, analysisElementB, true);
    }
  };

  const handleAccept = async (diff: FieldDiff) => {
    if (!analysisCritiquePov || !analysisCritiqueNodeId) return;

    let value = diff.newValue;

    // For graph_attributes changes containing policy_actions, validate policy_ids
    if (diff.key === 'graph_attributes' && value && typeof value === 'object') {
      const ga = value as Record<string, unknown>;
      const pas = ga.policy_actions as Array<{ policy_id?: string; action: string; framing: string }> | undefined;
      if (pas && policyRegistry) {
        const registryIds = new Set(policyRegistry.map(p => p.id));
        for (const pa of pas) {
          if (pa.policy_id && !registryIds.has(pa.policy_id)) {
            // AI proposed a non-existent policy_id — try to find a match by action text
            const match = policyRegistry.find(p => p.action.toLowerCase() === pa.action.toLowerCase());
            if (match) {
              pa.policy_id = match.id;
            } else {
              // Clear invalid ID — will need manual assignment via Update-PolicyRegistry
              pa.policy_id = undefined;
            }
          }
        }
        ga.policy_actions = pas;
        value = ga;
      }
    }

    updatePovNode(analysisCritiquePov, analysisCritiqueNodeId, { [diff.key]: value } as Partial<PovNode>);
    await save();
    setAcceptedFields(prev => new Set(prev).add(diff.key));
  };

  /** Render the value display for a diff, with sub-field highlighting for graph_attributes */
  const renderDiffValues = (diff: FieldDiff) => {
    if (diff.key === 'graph_attributes') {
      const oldAttrs = (diff.oldValue || {}) as Record<string, unknown>;
      const newAttrs = (diff.newValue || {}) as Record<string, unknown>;
      const subDiffs = computeAttrSubDiffs(oldAttrs, newAttrs);
      const changedCount = subDiffs.filter(s => s.changed).length;

      return (
        <div className="analysis-diff-attrs">
          <div className="analysis-diff-attrs-summary">
            {changedCount} field{changedCount !== 1 ? 's' : ''} changed
          </div>
          {subDiffs.map(sub => (
            <div
              key={sub.key}
              className={`analysis-diff-attr-row ${sub.changed ? 'analysis-diff-attr-changed' : ''}`}
            >
              <div className="analysis-diff-attr-key">{sub.key}</div>
              {sub.changed ? (
                <div className="analysis-diff-attr-values">
                  <div className="analysis-diff-old">
                    <span className="analysis-diff-tag">Current</span>
                    <pre>{formatSimpleValue(sub.oldValue)}</pre>
                  </div>
                  <div className="analysis-diff-new">
                    <span className="analysis-diff-tag">Proposed</span>
                    <pre>{formatSimpleValue(sub.newValue)}</pre>
                  </div>
                </div>
              ) : (
                <div className="analysis-diff-attr-unchanged">unchanged</div>
              )}
            </div>
          ))}
        </div>
      );
    }

    // Default: simple current/proposed
    return (
      <div className="analysis-diff-values">
        <div className="analysis-diff-old">
          <span className="analysis-diff-tag">Current</span>
          <pre>{formatSimpleValue(diff.oldValue)}</pre>
        </div>
        <div className="analysis-diff-new">
          <span className="analysis-diff-tag">Proposed</span>
          <pre>{formatSimpleValue(diff.newValue)}</pre>
        </div>
      </div>
    );
  };

  return (
    <div className="analysis-panel" style={width ? { width, minWidth: 320 } : undefined}>
      <div className="analysis-panel-header">
        <div className="analysis-panel-title">
          {analysisTitle || 'Analysis'}
          {analysisCached && <span className="analysis-cached-badge">cached</span>}
        </div>
        <div className="analysis-panel-actions">
          {analysisResult && !isCritique && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleRefresh}
              title={`Re-run with ${geminiModel}`}
            >
              Refresh
            </button>
          )}
          <button className="pane-collapse-btn" onClick={() => setCollapsed(true)} title="Collapse">&lsaquo;</button>
          <button className="btn btn-ghost btn-sm" onClick={clearAnalysis}>
            Close
          </button>
        </div>
      </div>

      {analysisElementA && analysisElementB && (
        <div className="analysis-elements">
          <div className="analysis-element">
            <div className="analysis-element-tag">Element A <span className="analysis-element-category">{analysisElementA.category}</span></div>
            <div className="analysis-element-label">{analysisElementA.label}</div>
          </div>
          <div className="analysis-vs">vs</div>
          <div className="analysis-element">
            <div className="analysis-element-tag">Element B <span className="analysis-element-category">{analysisElementB.category}</span></div>
            <div className="analysis-element-label">{analysisElementB.label}</div>
          </div>
        </div>
      )}
      {analysisElementA && !analysisElementB && (
        <div className="analysis-elements">
          <div className="analysis-element">
            <div className="analysis-element-tag">{analysisElementA.category}</div>
            <div className="analysis-element-label">{analysisElementA.label}</div>
          </div>
        </div>
      )}

      {analysisLoading && analysisStep > 0 && (
        <div className="analysis-steps">
          {STEPS.map(({ step, label }) => {
            const displayLabel = step === 3 ? `Sending to ${geminiModel}` : label;
            let status: 'pending' | 'active' | 'done' = 'pending';
            if (analysisStep > step) status = 'done';
            else if (analysisStep === step) status = 'active';

            return (
              <div key={step}>
                <div className={`analysis-step analysis-step-${status}`}>
                  <span className="analysis-step-indicator">
                    {status === 'done' && '\u2713'}
                    {status === 'active' && <span className="search-spinner" />}
                    {status === 'pending' && <span className="analysis-step-dot" />}
                  </span>
                  <span className="analysis-step-label">{displayLabel}</span>
                </div>
                {step === 3 && status === 'active' && analysisRetry && (
                  <div className="analysis-retry-info">
                    <div className="analysis-retry-headline">
                      {analysisRetry.limitType !== 'unknown'
                        ? `${analysisRetry.limitType} limit hit`
                        : 'Rate limited'} — retry {analysisRetry.attempt}/{analysisRetry.maxRetries}, waiting {analysisRetry.backoffSeconds}s
                    </div>
                    <div className="analysis-retry-detail">
                      {analysisRetry.limitMessage}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {analysisError && (
        <>
          <ApiKeyErrorMessage error={analysisError} />
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={handleRetry}>
            Retry
          </button>
        </>
      )}

      {/* Non-critique: render full markdown as before */}
      {analysisResult && !isCritique && (
        <div className="analysis-result markdown-body">
          <Markdown remarkPlugins={[remarkGfm]}>{analysisResult}</Markdown>
        </div>
      )}

      {/* Critique mode: structured view with rationale per change */}
      {analysisResult && isCritique && (
        <>
          {critiqueSummary && (
            <div className="analysis-critique-summary markdown-body">
              <Markdown remarkPlugins={[remarkGfm]}>{critiqueSummary}</Markdown>
            </div>
          )}

          {diffs.length > 0 && (
            <div className="analysis-diffs">
              <div className="analysis-diffs-header">Suggested Changes</div>
              {diffs.map(diff => {
                const isAccepted = acceptedFields.has(diff.key);
                return (
                  <div key={diff.key} className="analysis-diff-item">
                    <div className="analysis-diff-field">{diff.label}</div>
                    {diff.rationale && (
                      <div className="analysis-diff-rationale markdown-body">
                        <Markdown remarkPlugins={[remarkGfm]}>{diff.rationale}</Markdown>
                      </div>
                    )}
                    {renderDiffValues(diff)}
                    {isAccepted ? (
                      <span className="analysis-diff-accepted">Accepted</span>
                    ) : (
                      <button
                        className="btn btn-sm analysis-diff-accept-btn"
                        onClick={() => handleAccept(diff)}
                      >
                        Accept
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {diffs.length === 0 && (
            <div className="analysis-diffs">
              <div className="analysis-diffs-header" style={{ marginBottom: 0 }}>No changes proposed</div>
            </div>
          )}

          {unmatchedRationale && (
            <div className="analysis-critique-additional markdown-body">
              <div className="analysis-diffs-header">Additional Notes</div>
              <Markdown remarkPlugins={[remarkGfm]}>{unmatchedRationale}</Markdown>
            </div>
          )}
        </>
      )}
    </div>
  );
}
