// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Brief Export dialog (t/2805, T7 — spec §7). Client of the T6 REST API: kicks off an
// async export job, polls phase-level progress, and on completion lists the artifacts
// with download buttons. Web-first v1 (pptx + json); t/2852 adds framingMeta toggle
// (classroom preset) and a post-export "Save as PDF" action (shown whenever the run
// produced an htmlDoc artifact) — the bridge routes it to the browser print dialog on
// web and native printToPDF on Electron; closed-debate only (open shows an explanatory
// notice — TL ruling A, t/2805#5).
//
// Consumes T6's frozen contract verbatim: job-state names, artifact names (BRIEF_ARTIFACTS),
// and the error taxonomy (shown as the verbatim gate message on failure).

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isElectronMode } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { AI_BACKENDS, MODELS_BY_BACKEND } from '../../hooks/useTaxonomyStore';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { BRIEF_ARTIFACTS, type BriefPreset, type BriefArtifactName } from '../../../../../lib/brief/types';
import type { BriefExportJobView, BriefExportRecord, BriefTemplateRecord } from '../../bridge/types';
import './BriefExportDialog.css';

const PRESETS: { value: BriefPreset; label: string; hint: string }[] = [
  { value: 'policymaker', label: 'Policymaker', hint: 'Tight, decision-oriented brief.' },
  { value: 'conference', label: 'Conference', hint: 'Balanced talk-style deck.' },
  { value: 'classroom', label: 'Classroom', hint: 'Teaching deck with framing.' },
];

/** Human labels for the frozen T6 job states (spec §5). */
const PHASE_LABEL: Record<string, string> = {
  queued: 'Queued', extracting: 'Extracting deck spec', narrating: 'Narrating',
  checking: 'Maker-checker review', rendering: 'Rendering slides', verifying: 'Verifying',
  done: 'Done', failed: 'Failed',
};

const ARTIFACT_LABEL: Record<BriefArtifactName, string> = {
  [BRIEF_ARTIFACTS.deckSpec]: 'Deck spec (JSON)',
  [BRIEF_ARTIFACTS.narration]: 'Narration (JSON)',
  [BRIEF_ARTIFACTS.manifest]: 'Audit manifest (JSON)',
  [BRIEF_ARTIFACTS.pptx]: 'Slides (PPTX)',
  // brief.html is the "Save as PDF" source (browser print on web, native printToPDF on
  // Electron); label kept so Record<BriefArtifactName> stays exhaustive after htmlDoc
  // was added to BRIEF_ARTIFACTS.
  [BRIEF_ARTIFACTS.htmlDoc]: 'HTML (PDF source)',
};

const POLL_MS = 1500;
const CURRENT = '__current__';

type Phase = 'form' | 'running' | 'done' | 'failed';

interface Props {
  debateId: string;
  debateTitle: string;
  /** Debate phase; export is closed-only for v1 (TL ruling A). */
  debatePhase: string;
  onClose: () => void;
  /** Fired after a successful export so the parent can refresh its Exports list. */
  onExported?: () => void;
}

export function BriefExportDialog({ debateId, debateTitle, debatePhase, onClose, onExported }: Props) {
  const { geminiModel } = useTaxonomyStore();
  const isClosed = debatePhase === 'closed';

  const [preset, setPreset] = useState<BriefPreset>('conference');
  const [modelChoice, setModelChoice] = useState<string>(CURRENT);
  const [makerChecker, setMakerChecker] = useState(false);
  const [checkerModel, setCheckerModel] = useState<string>(geminiModel || '');
  const [skipNarration, setSkipNarration] = useState(false);
  const [framingMeta, setFramingMeta] = useState(true);
  const [pdfSaving, setPdfSaving] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Template (t/2853): on web, upload → templateId; on desktop, read bytes inline.
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [storedTemplates, setStoredTemplates] = useState<BriefTemplateRecord[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templateUploading, setTemplateUploading] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const isElectron = isElectronMode();

  const [phase, setPhase] = useState<Phase>('form');
  const [job, setJob] = useState<BriefExportJobView | null>(null);
  const [record, setRecord] = useState<BriefExportRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPoll = useCallback(() => { if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; } }, []);
  useEffect(() => stopPoll, [stopPoll]);

  // Load stored templates on web (t/2853).
  useEffect(() => {
    if (isElectron) return;
    api.listBriefTemplates().then(setStoredTemplates).catch(() => { /* telemetry — silent by design */ });
  }, [isElectron]);

  const handleTemplateFileChange = useCallback(async (file: File | null) => {
    setTemplateFile(file);
    setTemplateError(null);
    if (!file || isElectron) return;
    // Web: upload immediately so the user gets feedback before submitting.
    setTemplateUploading(true);
    try {
      const rec = await api.uploadBriefTemplate(file);
      setStoredTemplates(prev => [...prev.filter(t => t.templateId !== rec.templateId), rec]);
      setSelectedTemplateId(rec.templateId);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'brief-export-ui', level: 'error', message: 'Template upload failed', error: { name: (err as Error).name ?? 'Error', message: err instanceof Error ? err.message : String(err) } });
      setTemplateError(err instanceof Error ? err.message : 'Template upload failed');
    } finally {
      setTemplateUploading(false);
    }
  }, [isElectron]);

  const deleteStoredTemplate = useCallback(async (templateId: string) => {
    await api.deleteBriefTemplate(templateId).catch(() => { /* telemetry — silent by design */ });
    setStoredTemplates(prev => prev.filter(t => t.templateId !== templateId));
    if (selectedTemplateId === templateId) setSelectedTemplateId('');
  }, [selectedTemplateId]);

  const finishFromRecord = useCallback(async (exportId: string) => {
    // Terminal: pull the durable record (source of truth once the in-memory job expires).
    try {
      const list = await api.listBriefExports(debateId);
      const rec = list.find(r => r.exportId === exportId) ?? null;
      setRecord(rec);
      if (rec?.status === 'failed') { setError(`Export failed: ${rec.errorCode ?? 'unknown gate'}`); setPhase('failed'); }
      else { setPhase('done'); onExported?.(); }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'brief-export-ui', level: 'error', message: 'Failed to load export record', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
      // Job said done but the list read failed — still show done (artifacts are addressable by id).
      setPhase('done'); onExported?.();
    }
  }, [debateId, onExported]);

  const poll = useCallback(async (jobId: string) => {
    let view: BriefExportJobView;
    try {
      view = await api.getBriefExportJob(jobId);
    } catch {
      /* telemetry — silent by design */
      // 404 (per-replica registry TTL, T6 §5): the job view is gone — fall back to the
      // durable exports list rather than treating expiry as an error.
      try {
        const list = await api.listBriefExports(debateId);
        const rec = list[0];
        if (rec) { setRecord(rec); setPhase(rec.status === 'failed' ? 'failed' : 'done'); if (rec.status !== 'failed') onExported?.(); return; }
      } catch { /* telemetry — silent by design */ }
      setError('Lost track of the export job (it may have expired). Check the Exports list.');
      setPhase('failed');
      return;
    }
    setJob(view);
    if (view.status === 'done' && view.exportId) { await finishFromRecord(view.exportId); return; }
    if (view.status === 'failed') { setError(view.error ?? `Export failed: ${view.errorCode ?? 'unknown gate'}`); setPhase('failed'); return; }
    pollRef.current = setTimeout(() => void poll(jobId), POLL_MS);
  }, [debateId, finishFromRecord, onExported]);

  const submit = useCallback(async () => {
    setError(null); setJob(null); setRecord(null); setPhase('running');
    try {
      // Build template fields: web uses templateId; desktop passes bytes inline via IPC.
      let templateId: string | undefined;
      let templateBytes: Uint8Array | undefined;
      if (templateFile) {
        if (isElectron) {
          templateBytes = new Uint8Array(await templateFile.arrayBuffer());
        } else {
          templateId = selectedTemplateId || undefined;
        }
      } else if (!isElectron && selectedTemplateId) {
        templateId = selectedTemplateId;
      }

      const body = {
        preset,
        model: modelChoice === CURRENT ? (geminiModel || undefined) : modelChoice,
        modelSource: (modelChoice === CURRENT ? 'global' : 'explicit') as 'global' | 'explicit',
        ...(makerChecker && checkerModel ? { checkerModel } : {}),
        ...(preset === 'classroom' && !framingMeta ? { framingMeta: false } : {}),
        options: { skipNarration },
        ...(templateId ? { templateId } : {}),
        // Desktop only: bytes survive IPC structured-clone; never included in web JSON body.
        ...(templateBytes ? { template: templateBytes } : {}),
      };
      const { jobId } = await api.createBriefExport(debateId, body as Parameters<typeof api.createBriefExport>[1]);
      pollRef.current = setTimeout(() => void poll(jobId), POLL_MS);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'brief-export-ui', level: 'error', message: 'Failed to start brief export', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
      setError(err instanceof Error ? err.message : String(err));
      setPhase('failed');
    }
  }, [preset, modelChoice, geminiModel, makerChecker, checkerModel, skipNarration, framingMeta, debateId, poll, templateFile, selectedTemplateId, isElectron]);

  const savePdf = useCallback(async () => {
    if (!record) return;
    setPdfError(null);
    setPdfSaving(true);
    try {
      const blob = await api.downloadBriefArtifact(record.exportId, BRIEF_ARTIFACTS.htmlDoc);
      const html = await blob.text();
      await api.printBriefToPdf(html);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'brief-export-ui', level: 'error', message: 'PDF save failed', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
      setPdfError(err instanceof Error ? err.message : String(err));
    } finally {
      setPdfSaving(false);
    }
  }, [record]);

  const download = useCallback(async (name: BriefArtifactName) => {
    if (!record) return;
    try {
      const blob = await api.downloadBriefArtifact(record.exportId, name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'brief-export-ui', level: 'error', message: 'Artifact download failed', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
      setError(`Could not download ${name}.`);
    }
  }, [record]);

  const modelOptions = (
    <>
      {AI_BACKENDS.map(b => (
        <optgroup key={b.value} label={b.label}>
          {(MODELS_BY_BACKEND[b.value] ?? []).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </optgroup>
      ))}
    </>
  );

  return (
    <div className="bx-overlay" role="dialog" aria-modal="true" aria-label="Export debate brief" onClick={onClose}>
      <div className="bx-dialog" onClick={e => e.stopPropagation()}>
        <div className="bx-header">
          <h2 className="bx-title">Export brief — {debateTitle}</h2>
          <button className="bx-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!isClosed && (
          <div className="bx-notice" role="note">
            Brief export is available for <strong>closed</strong> debates only. Close this debate to export a brief.
            <span className="bx-notice-sub"> (Live-snapshot export is planned — t/2816.)</span>
          </div>
        )}

        {phase === 'form' && (
          <div className="bx-form">
            <fieldset className="bx-fieldset">
              <legend>Preset</legend>
              {PRESETS.map(p => (
                <label key={p.value} className="bx-radio">
                  <input type="radio" name="bx-preset" value={p.value} checked={preset === p.value} onChange={() => setPreset(p.value)} disabled={!isClosed} />
                  <span className="bx-radio-label">{p.label}</span>
                  <span className="bx-hint">{p.hint}</span>
                </label>
              ))}
            </fieldset>

            <div className="bx-field">
              <label htmlFor="bx-model">Model</label>
              <select id="bx-model" value={modelChoice} onChange={e => setModelChoice(e.target.value)} disabled={!isClosed}>
                <option value={CURRENT}>Use current model ({geminiModel || 'default'})</option>
                {modelOptions}
              </select>
            </div>

            <label className="bx-check">
              <input type="checkbox" checked={makerChecker} onChange={e => setMakerChecker(e.target.checked)} disabled={!isClosed || skipNarration} />
              Enable maker-checker review
            </label>
            {makerChecker && !skipNarration && (
              <div className="bx-field bx-indent">
                <label htmlFor="bx-checker">Checker model</label>
                <select id="bx-checker" value={checkerModel} onChange={e => setCheckerModel(e.target.value)} disabled={!isClosed}>
                  {modelOptions}
                </select>
              </div>
            )}

            <label className="bx-check">
              <input type="checkbox" checked={skipNarration} onChange={e => setSkipNarration(e.target.checked)} disabled={!isClosed} />
              Skip narration (deterministic, no model calls)
            </label>

            {preset === 'classroom' && (
              <label className="bx-check">
                <input type="checkbox" checked={framingMeta} onChange={e => setFramingMeta(e.target.checked)} disabled={!isClosed} />
                Include framing &amp; meta slide
              </label>
            )}

            <fieldset className="bx-fieldset">
              <legend>Slide template (.potx)</legend>
              <div className="bx-field">
                <label htmlFor="bx-template-file" className="bx-template-label">
                  {templateFile ? templateFile.name : 'No file chosen'}
                  {templateUploading && <span className="bx-hint"> Uploading…</span>}
                </label>
                <input
                  id="bx-template-file"
                  type="file"
                  accept=".potx"
                  className="bx-file-input"
                  disabled={!isClosed || templateUploading}
                  onChange={e => void handleTemplateFileChange(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  className="bx-btn-ghost bx-btn-sm"
                  disabled={!templateFile || templateUploading}
                  onClick={() => { setTemplateFile(null); setSelectedTemplateId(''); setTemplateError(null); }}
                >
                  Clear
                </button>
              </div>
              {templateError && <div className="bx-error bx-template-error" role="alert">{templateError}</div>}
              {!isElectron && storedTemplates.length > 0 && (
                <div className="bx-field bx-stored-templates">
                  <label htmlFor="bx-template-select">Or select a stored template</label>
                  <select
                    id="bx-template-select"
                    value={selectedTemplateId}
                    onChange={e => { setSelectedTemplateId(e.target.value); setTemplateFile(null); }}
                    disabled={!isClosed}
                  >
                    <option value="">— None —</option>
                    {storedTemplates.map(t => (
                      <option key={t.templateId} value={t.templateId}>{t.name}</option>
                    ))}
                  </select>
                  {selectedTemplateId && (
                    <button type="button" className="bx-btn-ghost bx-btn-sm" onClick={() => void deleteStoredTemplate(selectedTemplateId)}>
                      Delete
                    </button>
                  )}
                </div>
              )}
            </fieldset>

            <p className="bx-formats">Produces: <strong>PPTX</strong> + deck spec, narration &amp; audit manifest (JSON). PDF available after export.</p>

            {error && <div className="bx-error" role="alert">{error}</div>}
            <div className="bx-actions">
              <button className="bx-btn-ghost" onClick={onClose}>Cancel</button>
              <button className="bx-btn-primary" onClick={() => void submit()} disabled={!isClosed}>Export</button>
            </div>
          </div>
        )}

        {phase === 'running' && (
          <div className="bx-progress" aria-live="polite">
            <div className="bx-phase">{PHASE_LABEL[job?.status ?? 'queued'] ?? 'Working…'}</div>
            <div className="bx-bar">
              {/* eslint-disable-next-line local/no-inline-style -- dynamic: progress width % */}
              <div className="bx-bar-fill" style={{ width: `${job?.progressPct ?? 5}%` }} />
            </div>
            {(job?.warnings.length ?? 0) > 0 && (
              <ul className="bx-warnings">{job!.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            )}
          </div>
        )}

        {phase === 'done' && (
          <div className="bx-done">
            <div className="bx-done-head">✓ Export complete</div>
            {record && (
              <>
                {record.warnings.length > 0 && (
                  <ul className="bx-warnings">{record.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                )}
                <ul className="bx-artifacts">
                  {record.artifacts.map(name => (
                    <li key={name}>
                      <span className="bx-artifact-name">{ARTIFACT_LABEL[name] ?? name}</span>
                      <button className="bx-btn-ghost bx-dl" onClick={() => void download(name)}>Download</button>
                    </li>
                  ))}
                </ul>
                <div className="bx-meta">Trace coverage {record.traceCoveragePct}% · model {record.narratorModel}</div>
                {record.artifacts.includes(BRIEF_ARTIFACTS.htmlDoc) && (
                  <div className="bx-pdf-row">
                    <button className="bx-btn-ghost" onClick={() => void savePdf()} disabled={pdfSaving}>
                      {pdfSaving ? 'Saving PDF…' : 'Save as PDF…'}
                    </button>
                    {pdfError && <span className="bx-pdf-error" role="alert">{pdfError}</span>}
                  </div>
                )}
              </>
            )}
            <div className="bx-actions"><button className="bx-btn-primary" onClick={onClose}>Done</button></div>
          </div>
        )}

        {phase === 'failed' && (
          <div className="bx-failed" role="alert">
            <div className="bx-failed-head">Export failed{job?.errorCode ? ` — ${job.errorCode}` : ''}</div>
            <pre className="bx-failed-msg">{error ?? job?.error ?? 'Unknown failure.'}</pre>
            <div className="bx-actions">
              <button className="bx-btn-ghost" onClick={onClose}>Close</button>
              <button className="bx-btn-primary" onClick={() => setPhase('form')}>Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
