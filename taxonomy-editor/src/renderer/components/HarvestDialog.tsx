// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import {
  extractConflictCandidates,
  extractSteelmanCandidates,
  extractDebateRefCandidates,
  validateConflictDescription,
  validateCondensedSteelman,
  generateConflictSlug,
} from '../utils/harvestUtils';
import type {
  HarvestConflictItem,
  HarvestSteelmanItem,
  HarvestDebateRefItem,
  HarvestManifestItem,
} from '../utils/harvestUtils';

interface HarvestDialogProps {
  onClose: () => void;
}

export function HarvestDialog({ onClose }: HarvestDialogProps) {
  const { activeDebate } = useDebateStore();
  const taxState = useTaxonomyStore.getState();

  const [conflicts, setConflicts] = useState<HarvestConflictItem[]>([]);
  const [steelmans, setSteelmans] = useState<HarvestSteelmanItem[]>([]);
  const [debateRefs, setDebateRefs] = useState<HarvestDebateRefItem[]>([]);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ applied: number; failed: number } | null>(null);
  const [generatingConflicts, setGeneratingConflicts] = useState(false);
  const [generatingSteelmans, setGeneratingSteelmans] = useState(false);

  const getNodeLabel = (id: string): string | null => {
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const node = taxState[pov]?.nodes?.find(n => n.id === id);
      if (node) return node.label;
    }
    const ccNode = taxState.crossCutting?.nodes?.find(n => n.id === id);
    return ccNode?.label || null;
  };

  const allNodeIds = new Set<string>();
  for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
    for (const n of taxState[pov]?.nodes || []) allNodeIds.add(n.id);
  }
  for (const n of taxState.crossCutting?.nodes || []) allNodeIds.add(n.id);

  useEffect(() => {
    if (!activeDebate) return;
    setConflicts(extractConflictCandidates(activeDebate));
    setSteelmans(extractSteelmanCandidates(activeDebate, getNodeLabel));
    setDebateRefs(extractDebateRefCandidates(activeDebate, getNodeLabel));
  }, [activeDebate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fill in current steelman text from taxonomy store
  useEffect(() => {
    setSteelmans(prev => prev.map(s => {
      for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
        const node = taxState[pov]?.nodes?.find(n => n.id === s.targetNodeId);
        if (node) {
          const sv = node.graph_attributes?.steelman_vulnerability;
          const current = typeof sv === 'string' ? sv :
            (sv as Record<string, string>)?.[`from_${s.attackerPov}`] || '';
          return { ...s, currentSteelman: current };
        }
      }
      return s;
    }));
  }, [steelmans.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleConflict = (id: string) => setConflicts(prev =>
    prev.map(c => c.id === id ? { ...c, checked: !c.checked } : c));
  const toggleSteelman = (id: string) => setSteelmans(prev =>
    prev.map(s => s.id === id ? { ...s, checked: !s.checked } : s));
  const toggleDebateRef = (nodeId: string) => setDebateRefs(prev =>
    prev.map(r => r.nodeId === nodeId ? { ...r, checked: !r.checked } : r));

  // AI-generate conflict descriptions for checked items
  const generateConflictDescriptions = async () => {
    const checked = conflicts.filter(c => c.checked && !c.generatedLabel);
    if (checked.length === 0) return;
    setGeneratingConflicts(true);

    const model = useDebateStore.getState().debateModel ||
      localStorage.getItem('taxonomy-editor-gemini-model') || 'gemini-3.1-flash-lite-preview';

    for (const item of checked) {
      try {
        const positionsText = item.positions.map(p => `${p.pover}: ${p.stance}`).join('\n');
        const prompt = `Generate a conflict entry for a taxonomy database.

Disagreement: "${item.point}"
${item.bdiLayer ? `BDI layer: ${item.bdiLayer}` : ''}
Positions:
${positionsText}

Return ONLY JSON (no markdown):
{
  "claim_label": "5-10 word label for this conflict",
  "description": "1-2 sentence description of what is contested",
  "linked_taxonomy_nodes": ${JSON.stringify(item.linkedNodes.slice(0, 6))}
}`;
        const { text } = await window.electronAPI.generateText(prompt, model);
        const cleaned = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
        const fb = cleaned.indexOf('{'), lb = cleaned.lastIndexOf('}');
        const parsed = JSON.parse(fb >= 0 && lb > fb ? cleaned.slice(fb, lb + 1) : cleaned);

        const warnings = validateConflictDescription(parsed, allNodeIds);

        setConflicts(prev => prev.map(c => c.id === item.id ? {
          ...c,
          generatedLabel: parsed.claim_label || item.point.slice(0, 60),
          generatedDescription: parsed.description || item.point,
          linkedNodes: parsed.linked_taxonomy_nodes || item.linkedNodes,
          warnings,
        } : c));
      } catch (err) {
        setConflicts(prev => prev.map(c => c.id === item.id ? {
          ...c,
          generatedLabel: item.point.slice(0, 60),
          generatedDescription: item.point,
          warnings: ['AI generation failed — using fallback text'],
        } : c));
      }
    }
    setGeneratingConflicts(false);
  };

  // AI-condense steelman candidates
  const generateSteelmanCondensations = async () => {
    const checked = steelmans.filter(s => s.checked && !s.proposedSteelman);
    if (checked.length === 0) return;
    setGeneratingSteelmans(true);

    const model = useDebateStore.getState().debateModel ||
      localStorage.getItem('taxonomy-editor-gemini-model') || 'gemini-3.1-flash-lite-preview';

    for (const item of checked) {
      try {
        const prompt = `Condense this counterargument into 1-2 sentences (50-200 chars) that capture the strongest version of the attack from the ${item.attackerPov} perspective. Be specific to the target position, not generic.

Target node: "${item.targetNodeLabel}"
Original argument by ${item.attackerPov}:
"${item.sourceExcerpt}"

Return ONLY the condensed steelman text, no JSON, no quotes.`;
        const { text } = await window.electronAPI.generateText(prompt, model);
        const condensed = text.trim().replace(/^["']|["']$/g, '');
        const warnings = validateCondensedSteelman(condensed, item.sourceExcerpt, item.attackerPov);

        setSteelmans(prev => prev.map(s => s.id === item.id ? {
          ...s, proposedSteelman: condensed, warnings,
        } : s));
      } catch {
        setSteelmans(prev => prev.map(s => s.id === item.id ? {
          ...s, proposedSteelman: item.sourceExcerpt.slice(0, 150),
          warnings: ['AI condensation failed — using truncated original'],
        } : s));
      }
    }
    setGeneratingSteelmans(false);
  };

  // Apply all checked items
  const handleApply = async () => {
    if (!activeDebate) return;
    setApplying(true);
    const manifest: HarvestManifestItem[] = [];
    let applied = 0, failed = 0;

    // Apply conflicts
    for (const item of conflicts) {
      if (!item.checked) {
        manifest.push({ type: 'conflict', action: 'created', id: item.id, status: 'rejected' });
        continue;
      }
      const conflictId = generateConflictSlug(item.generatedLabel || item.point, activeDebate.id);
      try {
        await window.electronAPI.harvestCreateConflict({
          claim_id: conflictId,
          claim_label: item.generatedLabel || item.point.slice(0, 60),
          description: item.generatedDescription || item.point,
          status: 'open',
          linked_taxonomy_nodes: item.linkedNodes,
          instances: item.positions.map(p => ({
            doc_id: `debate:${activeDebate.id}`,
            stance: p.pover === item.positions[0]?.pover ? 'supports' : 'disputes',
            assertion: p.stance,
            date_flagged: new Date().toISOString().slice(0, 10),
          })),
          source: 'debate-harvest',
          source_debate_id: activeDebate.id,
        });
        manifest.push({ type: 'conflict', action: 'created', id: conflictId, status: 'applied' });
        applied++;
      } catch {
        manifest.push({ type: 'conflict', action: 'created', id: conflictId, status: 'rejected' });
        failed++;
      }
    }

    // Apply steelmans
    for (const item of steelmans) {
      if (!item.checked || !item.proposedSteelman) {
        manifest.push({ type: 'steelman', action: 'updated', id: item.targetNodeId, status: 'rejected' });
        continue;
      }
      try {
        await window.electronAPI.harvestUpdateSteelman(item.targetNodeId, item.attackerPov, item.proposedSteelman);
        manifest.push({ type: 'steelman', action: 'updated', id: `${item.targetNodeId}:from_${item.attackerPov}`, status: 'applied' });
        applied++;
      } catch {
        manifest.push({ type: 'steelman', action: 'updated', id: item.targetNodeId, status: 'rejected' });
        failed++;
      }
    }

    // Apply debate refs
    for (const item of debateRefs) {
      if (!item.checked) continue;
      try {
        await window.electronAPI.harvestAddDebateRef(item.nodeId, activeDebate.id);
        manifest.push({ type: 'debate_ref', action: 'added', id: item.nodeId, status: 'applied' });
        applied++;
      } catch {
        manifest.push({ type: 'debate_ref', action: 'added', id: item.nodeId, status: 'rejected' });
        failed++;
      }
    }

    // Save manifest
    await window.electronAPI.harvestSaveManifest({
      debate_id: activeDebate.id,
      debate_title: activeDebate.title,
      harvested_at: new Date().toISOString(),
      items: manifest,
    });

    setResult({ applied, failed });
    setApplying(false);
  };

  const checkedCount = conflicts.filter(c => c.checked).length +
    steelmans.filter(s => s.checked).length +
    debateRefs.filter(r => r.checked).length;

  const needsGeneration = conflicts.some(c => c.checked && !c.generatedLabel) ||
    steelmans.some(s => s.checked && !s.proposedSteelman);

  if (!activeDebate) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog harvest-dialog" onClick={e => e.stopPropagation()}>
        <h2>Harvest Debate Findings</h2>
        <p className="harvest-subtitle">Select findings to promote into the taxonomy. Review and edit before applying.</p>

        {result ? (
          <div className="harvest-result">
            <div className="harvest-result-summary">
              Applied {result.applied} items{result.failed > 0 ? `, ${result.failed} failed` : ''}.
            </div>
            <div className="dialog-actions">
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            {/* Section 1: Conflicts */}
            {conflicts.length > 0 && (
              <div className="harvest-section">
                <h3>Conflicts ({conflicts.filter(c => c.checked).length}/{conflicts.length})</h3>
                {conflicts.map(item => (
                  <div key={item.id} className={`harvest-item ${item.checked ? 'harvest-item-checked' : ''}`}>
                    <label className="harvest-item-header">
                      <input type="checkbox" checked={item.checked} onChange={() => toggleConflict(item.id)} />
                      <span className="harvest-item-title">{item.point}</span>
                      {item.bdiLayer && <span className="harvest-badge">{item.bdiLayer}</span>}
                    </label>
                    {item.checked && (
                      <div className="harvest-item-body">
                        {item.positions.map((p, i) => (
                          <div key={i} className="harvest-position">
                            <strong>{p.pover}:</strong> {p.stance}
                          </div>
                        ))}
                        {item.generatedLabel && (
                          <div className="harvest-generated">
                            <label>Label: <input
                              value={item.generatedLabel}
                              onChange={e => setConflicts(prev => prev.map(c => c.id === item.id ? { ...c, generatedLabel: e.target.value } : c))}
                            /></label>
                            <label>Description: <textarea
                              value={item.generatedDescription || ''}
                              onChange={e => setConflicts(prev => prev.map(c => c.id === item.id ? { ...c, generatedDescription: e.target.value } : c))}
                              rows={2}
                            /></label>
                          </div>
                        )}
                        {item.warnings.length > 0 && (
                          <div className="harvest-warnings">
                            {item.warnings.map((w, i) => <div key={i} className="harvest-warning">{w}</div>)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Section 2: Steelman Refinements */}
            {steelmans.length > 0 && (
              <div className="harvest-section">
                <h3>Steelman Refinements ({steelmans.filter(s => s.checked).length}/{steelmans.length})</h3>
                {steelmans.map(item => (
                  <div key={item.id} className={`harvest-item ${item.checked ? 'harvest-item-checked' : ''}`}>
                    <label className="harvest-item-header">
                      <input type="checkbox" checked={item.checked} onChange={() => toggleSteelman(item.id)} />
                      <span className="harvest-item-title">{item.targetNodeLabel}</span>
                      <span className="harvest-badge">from {item.attackerPov}</span>
                    </label>
                    {item.checked && (
                      <div className="harvest-item-body">
                        {item.currentSteelman && (
                          <div className="harvest-steelman-current">
                            <strong>Current:</strong> {item.currentSteelman}
                          </div>
                        )}
                        {item.proposedSteelman ? (
                          <div className="harvest-steelman-proposed">
                            <strong>Proposed:</strong>
                            <textarea
                              value={item.proposedSteelman}
                              onChange={e => setSteelmans(prev => prev.map(s => s.id === item.id ? { ...s, proposedSteelman: e.target.value } : s))}
                              rows={2}
                            />
                          </div>
                        ) : (
                          <div className="harvest-steelman-source">
                            <strong>Source:</strong> {item.sourceExcerpt}
                          </div>
                        )}
                        {item.warnings.length > 0 && (
                          <div className="harvest-warnings">
                            {item.warnings.map((w, i) => <div key={i} className="harvest-warning">{w}</div>)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Section 3: Debate References */}
            {debateRefs.length > 0 && (
              <div className="harvest-section">
                <h3>Debate References ({debateRefs.filter(r => r.checked).length}/{debateRefs.length})</h3>
                <div className="harvest-refs-list">
                  {debateRefs.map(item => (
                    <label key={item.nodeId} className="harvest-ref-item">
                      <input type="checkbox" checked={item.checked} onChange={() => toggleDebateRef(item.nodeId)} />
                      <span className="harvest-ref-label">{item.nodeLabel}</span>
                      <span className="harvest-ref-count">{item.refCount}x</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {conflicts.length === 0 && steelmans.length === 0 && debateRefs.length === 0 && (
              <div className="harvest-empty">No harvestable findings in this debate. Run a synthesis first.</div>
            )}

            <div className="dialog-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              {needsGeneration && (
                <button
                  className="btn"
                  onClick={() => { generateConflictDescriptions(); generateSteelmanCondensations(); }}
                  disabled={generatingConflicts || generatingSteelmans}
                >
                  {generatingConflicts || generatingSteelmans ? 'Generating...' : 'Generate Descriptions'}
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={handleApply}
                disabled={checkedCount === 0 || applying || needsGeneration}
              >
                {applying ? 'Applying...' : `Apply ${checkedCount} items`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
