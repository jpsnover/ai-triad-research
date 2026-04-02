// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect } from 'react';
import { useDebateStore } from '../hooks/useDebateStore';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import {
  extractConflictCandidates,
  extractSteelmanCandidates,
  extractDebateRefCandidates,
  extractVerdictCandidates,
  extractConceptCandidates,
  validateConflictDescription,
  validateCondensedSteelman,
  validateProposedConcept,
  generateConflictSlug,
} from '../utils/harvestUtils';
import type {
  HarvestConflictItem,
  HarvestSteelmanItem,
  HarvestDebateRefItem,
  HarvestVerdictItem,
  HarvestConceptItem,
  HarvestManifestItem,
} from '../utils/harvestUtils';

interface HarvestDialogProps {
  onClose: () => void;
  fileData?: Record<string, unknown>;
}

export function HarvestDialog({ onClose, fileData }: HarvestDialogProps) {
  const { activeDebate } = useDebateStore();
  const taxState = useTaxonomyStore.getState();

  const [conflicts, setConflicts] = useState<HarvestConflictItem[]>([]);
  const [steelmans, setSteelmans] = useState<HarvestSteelmanItem[]>([]);
  const [debateRefs, setDebateRefs] = useState<HarvestDebateRefItem[]>([]);
  const [verdicts, setVerdicts] = useState<HarvestVerdictItem[]>([]);
  const [concepts, setConcepts] = useState<HarvestConceptItem[]>([]);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ applied: number; failed: number } | null>(null);
  const [generatingConflicts, setGeneratingConflicts] = useState(false);
  const [generatingSteelmans, setGeneratingSteelmans] = useState(false);

  const getNodeLabel = (id: string): string | null => {
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const node = taxState[pov]?.nodes?.find(n => n.id === id);
      if (node) return node.label;
    }
    const ccNode = taxState.situations?.nodes?.find(n => n.id === id);
    return ccNode?.label || null;
  };

  const allNodeIds = new Set<string>();
  for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
    for (const n of taxState[pov]?.nodes || []) allNodeIds.add(n.id);
  }
  for (const n of taxState.situations?.nodes || []) allNodeIds.add(n.id);

  console.log('[HarvestDialog] Render — fileData:', !!fileData, 'activeDebate:', !!activeDebate,
    'conflicts:', conflicts.length, 'steelmans:', steelmans.length, 'verdicts:', verdicts.length, 'concepts:', concepts.length);

  useEffect(() => {
    console.log('[HarvestDialog] useEffect — fileData:', !!fileData, 'activeDebate id:', activeDebate?.id);
    if (fileData) {
      // File mode — use pre-computed harvest data directly
      const fc = (fileData.conflicts as HarvestConflictItem[]) || [];
      const fs = (fileData.steelmans as HarvestSteelmanItem[]) || [];
      const fv = (fileData.verdicts as HarvestVerdictItem[]) || [];
      const fn = (fileData.concepts as HarvestConceptItem[]) || [];
      console.log('[HarvestDialog] File mode — setting:', fc.length, 'conflicts,', fs.length, 'steelmans,', fv.length, 'verdicts,', fn.length, 'concepts');
      setConflicts(fc);
      setSteelmans(fs);
      setVerdicts(fv);
      setConcepts(fn);
      return;
    }
    if (!activeDebate) return;
    setConflicts(extractConflictCandidates(activeDebate));
    setSteelmans(extractSteelmanCandidates(activeDebate, getNodeLabel));
    setVerdicts(extractVerdictCandidates(activeDebate));
    setConcepts(extractConceptCandidates(activeDebate, allNodeIds));
  }, [activeDebate?.id, fileData]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const toggleVerdict = (id: string) => setVerdicts(prev =>
    prev.map(v => v.id === id ? { ...v, checked: !v.checked } : v));
  const toggleConcept = (id: string) => setConcepts(prev =>
    prev.map(c => c.id === id ? { ...c, checked: !c.checked } : c));

  const existingLabels = new Set<string>();
  for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
    for (const n of taxState[pov]?.nodes || []) existingLabels.add(n.label.toLowerCase());
  }
  for (const n of taxState.situations?.nodes || []) existingLabels.add(n.label.toLowerCase());

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
        const prompt = `Generate a label and description for this conflict entry.

Disagreement: "${item.point}"
${item.bdiLayer ? `BDI layer: ${item.bdiLayer}` : ''}
Positions:
${positionsText}

Return ONLY JSON (no markdown):
{
  "claim_label": "5-10 word label for this conflict",
  "description": "1-2 sentence description of what is contested"
}

IMPORTANT: Return ONLY claim_label and description. Do NOT include linked_taxonomy_nodes or any node IDs.`;
        const { text } = await window.electronAPI.generateText(prompt, model);
        const cleaned = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
        const fb = cleaned.indexOf('{'), lb = cleaned.lastIndexOf('}');
        const parsed = JSON.parse(fb >= 0 && lb > fb ? cleaned.slice(fb, lb + 1) : cleaned);

        // Use the original linkedNodes from transcript refs — don't let AI override
        const generated = {
          claim_label: parsed.claim_label || item.point.slice(0, 60),
          description: parsed.description || item.point,
          linked_taxonomy_nodes: item.linkedNodes, // Always use real IDs, not AI-generated
        };
        const warnings = validateConflictDescription(generated, allNodeIds);

        setConflicts(prev => prev.map(c => c.id === item.id ? {
          ...c,
          generatedLabel: generated.claim_label,
          generatedDescription: generated.description,
          linkedNodes: generated.linked_taxonomy_nodes,
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

  // AI-generate concept proposals for checked items
  const generateConceptProposals = async () => {
    const checked = concepts.filter(c => c.checked && !c.suggestedLabel);
    if (checked.length === 0) return;

    const model = useDebateStore.getState().debateModel ||
      localStorage.getItem('taxonomy-editor-gemini-model') || 'gemini-3.1-flash-lite-preview';

    for (const item of checked) {
      try {
        const prompt = `Propose a taxonomy node for this concept from an AI policy debate.

Concept: "${item.text}"
Speaker POV: ${item.suggestedPov}

Generate:
1. A 3-8 word plain-language label (newspaper headline style)
2. A genus-differentia description: "${item.suggestedPov === 'situations' ? 'A situation that [differentia]. Encompasses: ... Excludes: ...' : `A Belief | A Desire | An Intention within ${item.suggestedPov} discourse that [differentia]. Encompasses: ... Excludes: ...`}"
3. The best category: Desires, Beliefs, or Intentions

Return ONLY JSON (no markdown):
{"label": "...", "description": "...", "category": "Desires or Beliefs or Intentions"}`;

        const { text } = await window.electronAPI.generateText(prompt, model);
        let cleaned = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
        const fb = cleaned.indexOf('{'), lb = cleaned.lastIndexOf('}');
        if (fb >= 0 && lb > fb) cleaned = cleaned.slice(fb, lb + 1);
        const parsed = JSON.parse(cleaned);

        const warnings = validateProposedConcept(
          { label: parsed.label, description: parsed.description, pov: item.suggestedPov, category: parsed.category || item.suggestedCategory },
          existingLabels,
        );

        setConcepts(prev => prev.map(c => c.id === item.id ? {
          ...c,
          suggestedLabel: parsed.label || item.text.slice(0, 40),
          suggestedDescription: parsed.description || item.text,
          suggestedCategory: parsed.category || item.suggestedCategory,
          warnings,
        } : c));
      } catch {
        setConcepts(prev => prev.map(c => c.id === item.id ? {
          ...c,
          suggestedLabel: item.text.slice(0, 40),
          suggestedDescription: item.text,
          warnings: ['AI generation failed'],
        } : c));
      }
    }
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

    // Apply verdicts — attach to existing conflicts or create with conflict
    for (const item of verdicts) {
      if (!item.checked) {
        manifest.push({ type: 'verdict', action: 'updated', id: item.id, status: 'rejected' });
        continue;
      }
      // If this verdict corresponds to a conflict we just created, attach to it
      const conflictSlug = item.targetConflictId || generateConflictSlug(item.conflict, activeDebate.id);
      try {
        await window.electronAPI.harvestAddVerdict(conflictSlug, {
          prevails: item.prevails,
          criterion: item.criterion,
          rationale: item.rationale,
          what_would_change_this: item.whatWouldChange,
          source_debate_id: activeDebate.id,
          harvested_at: new Date().toISOString(),
        });
        manifest.push({ type: 'verdict', action: 'updated', id: conflictSlug, status: 'applied' });
        applied++;
      } catch {
        manifest.push({ type: 'verdict', action: 'updated', id: conflictSlug, status: 'rejected' });
        failed++;
      }
    }

    // Apply concepts — queue for taxonomy proposal
    for (const item of concepts) {
      if (!item.checked || !item.suggestedLabel) {
        if (item.checked) manifest.push({ type: 'concept', action: 'queued', id: item.id, status: 'rejected' });
        continue;
      }
      try {
        await window.electronAPI.harvestQueueConcept({
          label: item.suggestedLabel,
          description: item.suggestedDescription,
          suggested_pov: item.suggestedPov,
          suggested_category: item.suggestedCategory,
          source_debate_id: activeDebate.id,
          evidence: item.text,
        });
        manifest.push({ type: 'concept', action: 'queued', id: item.suggestedLabel, status: 'applied' });
        applied++;
      } catch {
        manifest.push({ type: 'concept', action: 'queued', id: item.id, status: 'rejected' });
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
    verdicts.filter(v => v.checked).length +
    concepts.filter(c => c.checked).length;

  const needsGeneration = conflicts.some(c => c.checked && !c.generatedLabel) ||
    steelmans.some(s => s.checked && !s.proposedSteelman) ||
    concepts.some(c => c.checked && !c.suggestedLabel);

  if (!activeDebate && !fileData) return null;

  // In file mode, render without the overlay
  const isFileMode = !!fileData;

  return (
    <div className={isFileMode ? '' : 'dialog-overlay'} onClick={isFileMode ? undefined : onClose}>
      <div className={isFileMode ? 'harvest-dialog' : 'dialog harvest-dialog'} onClick={e => e.stopPropagation()}>
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
                      {item.resolvability && <span className="harvest-badge harvest-badge-muted">{item.resolvability.replace(/_/g, ' ')}</span>}
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
                              rows={5}
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

            {/* Section 3: Preference Verdicts */}
            {verdicts.length > 0 && (
              <div className="harvest-section">
                <h3>Preference Verdicts ({verdicts.filter(v => v.checked).length}/{verdicts.length})</h3>
                {verdicts.map(item => (
                  <div key={item.id} className={`harvest-item ${item.checked ? 'harvest-item-checked' : ''}`}>
                    <label className="harvest-item-header">
                      <input type="checkbox" checked={item.checked} onChange={() => toggleVerdict(item.id)} />
                      <span className="harvest-item-title">{item.conflict}</span>
                      <span className="harvest-badge">{item.criterion?.replace(/_/g, ' ')}</span>
                    </label>
                    {item.checked && (
                      <div className="harvest-item-body">
                        <div><strong>Prevails:</strong> {(() => {
                          // Resolve claim ID to text from argument_map
                          if (/^C\d+$/.test(item.prevails)) {
                            const synthEntry = activeDebate?.transcript.find(e => e.type === 'synthesis');
                            const argMap = (synthEntry?.metadata?.synthesis as { argument_map?: { claim_id: string; claim: string; claimant: string }[] })?.argument_map;
                            const claim = argMap?.find(c => c.claim_id === item.prevails);
                            if (claim) return `${claim.claimant}: "${claim.claim}"`;
                          }
                          return item.prevails;
                        })()}</div>
                        <div><strong>Rationale:</strong> {item.rationale}</div>
                        {item.whatWouldChange && (
                          <div><strong>Would change if:</strong> {item.whatWouldChange}</div>
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

            {/* Section 5: New Concepts */}
            {concepts.length > 0 && (
              <div className="harvest-section">
                <h3>New Concepts ({concepts.filter(c => c.checked).length}/{concepts.length})</h3>
                {concepts.map(item => (
                  <div key={item.id} className={`harvest-item ${item.checked ? 'harvest-item-checked' : ''}`}>
                    <label className="harvest-item-header">
                      <input type="checkbox" checked={item.checked} onChange={() => toggleConcept(item.id)} />
                      <span className="harvest-item-title">{item.text.slice(0, 100)}{item.text.length > 100 ? '...' : ''}</span>
                      <span className="harvest-badge">{item.speaker}</span>
                    </label>
                    {item.checked && (
                      <div className="harvest-item-body">
                        {item.suggestedLabel ? (
                          <div className="harvest-generated">
                            <label>Label: <input
                              value={item.suggestedLabel}
                              onChange={e => setConcepts(prev => prev.map(c => c.id === item.id ? { ...c, suggestedLabel: e.target.value } : c))}
                            /></label>
                            <label>POV:
                              <select value={item.suggestedPov} onChange={e => setConcepts(prev => prev.map(c => c.id === item.id ? { ...c, suggestedPov: e.target.value } : c))}>
                                <option value="accelerationist">Accelerationist</option>
                                <option value="safetyist">Safetyist</option>
                                <option value="skeptic">Skeptic</option>
                                <option value="situations">Situations</option>
                              </select>
                            </label>
                            <label>Category:
                              <select value={item.suggestedCategory} onChange={e => setConcepts(prev => prev.map(c => c.id === item.id ? { ...c, suggestedCategory: e.target.value } : c))}>
                                <option value="Desires">Desires</option>
                                <option value="Beliefs">Beliefs</option>
                                <option value="Intentions">Intentions</option>
                              </select>
                            </label>
                            <label>Description: <textarea
                              value={item.suggestedDescription}
                              onChange={e => setConcepts(prev => prev.map(c => c.id === item.id ? { ...c, suggestedDescription: e.target.value } : c))}
                              rows={3}
                            /></label>
                          </div>
                        ) : (
                          <div className="harvest-steelman-source"><strong>Source claim:</strong> {item.text}</div>
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

            {conflicts.length === 0 && steelmans.length === 0 && verdicts.length === 0 && concepts.length === 0 && (
              <div className="harvest-empty">No harvestable findings in this debate. Run a synthesis first.</div>
            )}

            <div className="dialog-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              {needsGeneration && (
                <button
                  className="btn"
                  onClick={() => { generateConflictDescriptions(); generateSteelmanCondensations(); generateConceptProposals(); }}
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
