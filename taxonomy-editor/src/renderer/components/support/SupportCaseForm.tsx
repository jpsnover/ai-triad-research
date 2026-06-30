// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@bridge';
import type { SupportCaseCreatePayload } from '@bridge/types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

declare const __APP_VERSION__: string;

const isWeb = import.meta.env.VITE_TARGET === 'web';

const MAX_SUBJECT = 200;
const MAX_DESCRIPTION = 5000;
const MIN_DESCRIPTION = 20;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_MIME_RE = /^(image\/|video\/webm|application\/json|text\/plain)/;

type FormState = 'idle' | 'submitting' | 'uploading' | 'success' | 'error';
type Priority = 'low' | 'medium' | 'high';

interface AttachmentEntry {
  file: File;
  id: string; // local tracking ID
}

interface SupportCaseFormProps {
  onClose: () => void;
  onSubmitted?: (caseId: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getSystemInfo(): SupportCaseCreatePayload['systemInfo'] {
  return {
    appVersion: __APP_VERSION__,
    browser: navigator.userAgent,
    os: navigator.platform,
    deploymentMode: isWeb ? 'web' : 'electron',
  };
}

export function SupportCaseForm({ onClose, onSubmitted }: SupportCaseFormProps) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('low');
  const [attachments, setAttachments] = useState<AttachmentEntry[]>([]);
  const [formState, setFormState] = useState<FormState>('idle');
  const [uploadProgress, setUploadProgress] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [attachError, setAttachError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const totalBytes = attachments.reduce((sum, a) => sum + a.file.size, 0);
  const subjectTrimmed = subject.trim();
  const descTrimmed = description.trim();
  const canSubmit = formState === 'idle'
    && subjectTrimmed.length > 0
    && subjectTrimmed.length <= MAX_SUBJECT
    && descTrimmed.length >= MIN_DESCRIPTION
    && descTrimmed.length <= MAX_DESCRIPTION;

  // Escape key closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && formState !== 'submitting' && formState !== 'uploading') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, formState]);

  const addAttachmentError = useCallback((msg: string) => {
    setAttachError(msg);
    setTimeout(() => setAttachError(''), 4000);
  }, []);

  const validateAndAddFiles = useCallback((files: File[]) => {
    setAttachError('');
    const current = [...attachments];
    let currentTotal = totalBytes;

    for (const file of files) {
      if (current.length >= MAX_ATTACHMENTS) {
        addAttachmentError(`Maximum ${MAX_ATTACHMENTS} attachments allowed`);
        break;
      }
      if (!ALLOWED_MIME_RE.test(file.type)) {
        addAttachmentError(`File type not allowed: ${file.type || 'unknown'}. Allowed: images, video/webm, JSON, text.`);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        addAttachmentError(`${file.name} exceeds 10 MB limit (${formatBytes(file.size)})`);
        continue;
      }
      if (currentTotal + file.size > MAX_TOTAL_BYTES) {
        addAttachmentError(`Adding ${file.name} would exceed 50 MB total limit`);
        continue;
      }
      current.push({ file, id: crypto.randomUUID() });
      currentTotal += file.size;
    }

    setAttachments(current);
  }, [attachments, totalBytes, addAttachmentError]);

  // Clipboard paste for screenshots
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (!formRef.current?.contains(document.activeElement) && document.activeElement !== formRef.current) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            const ext = item.type.split('/')[1] || 'png';
            const named = new File([file], `screenshot-${Date.now()}.${ext}`, { type: file.type });
            imageFiles.push(named);
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        validateAndAddFiles(imageFiles);
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [validateAndAddFiles]);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      validateAndAddFiles(Array.from(files));
    }
    // Reset so the same file can be selected again
    e.target.value = '';
  }, [validateAndAddFiles]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleIncludeDiagnostics = useCallback(() => {
    const recorder = getGlobalRecorder();
    if (!recorder) {
      addAttachmentError('Flight recorder not available');
      return;
    }
    try {
      const { ndjson } = recorder.buildDump('manual');
      const file = new File([ndjson], 'flight-recorder-dump.jsonl', { type: 'application/json' });
      validateAndAddFiles([file]);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'support-case-form',
        level: 'error',
        message: 'Failed to build flight recorder dump for attachment',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      addAttachmentError('Failed to capture diagnostics');
    }
  }, [validateAndAddFiles, addAttachmentError]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    setFormState('submitting');
    setErrorMsg('');

    let caseId: string;
    try {
      const result = await api.createSupportCase({
        subject: subjectTrimmed,
        description: descTrimmed,
        priority,
        systemInfo: getSystemInfo(),
      });
      caseId = result.id;
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'support-case-form',
        level: 'error',
        message: 'Failed to create support case',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setFormState('error');
      setErrorMsg(`Failed to create case: ${(err as Error).message || String(err)}`);
      return;
    }

    if (attachments.length > 0) {
      setFormState('uploading');
      for (let i = 0; i < attachments.length; i++) {
        setUploadProgress(`Uploading ${i + 1}/${attachments.length}...`);
        try {
          await api.uploadCaseAttachment(caseId, attachments[i].file);
        } catch (err) {
          getGlobalRecorder()?.record({
            type: 'system.error',
            component: 'support-case-form',
            level: 'error',
            message: `Failed to upload attachment ${attachments[i].file.name}`,
            error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
          });
          setFormState('error');
          setErrorMsg(`Case created (${caseId}) but attachment upload failed: ${attachments[i].file.name}. You can retry from My Cases.`);
          return;
        }
      }
    }

    setFormState('success');
    onSubmitted?.(caseId);
    setTimeout(() => onClose(), 2000);
  }, [canSubmit, subjectTrimmed, descTrimmed, priority, attachments, onSubmitted, onClose]);

  const systemInfo = getSystemInfo();
  const hasDiagnosticsAttached = attachments.some(a => a.file.name === 'flight-recorder-dump.jsonl');

  return (
    <div className="dialog-overlay" onMouseDown={formState === 'submitting' || formState === 'uploading' ? undefined : onClose}>
      <div
        ref={formRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-form-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <h3 id="support-form-title" style={{ margin: '0 0 12px' }}>Report a Problem</h3>

        {formState === 'success' ? (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <p style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--success, #22c55e)' }}>Case submitted successfully</p>
            <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>You can track your case from the Help menu.</p>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Subject */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
                Subject <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({subjectTrimmed.length}/{MAX_SUBJECT})</span>
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief summary of the issue"
                maxLength={MAX_SUBJECT}
                disabled={formState !== 'idle'}
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Description */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
                Description <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  ({descTrimmed.length}/{MAX_DESCRIPTION}{descTrimmed.length > 0 && descTrimmed.length < MIN_DESCRIPTION ? `, min ${MIN_DESCRIPTION}` : ''})
                </span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what happened, what you expected, and steps to reproduce"
                maxLength={MAX_DESCRIPTION}
                disabled={formState !== 'idle'}
                rows={5}
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: 6, resize: 'vertical',
                  border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {/* Priority */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>Priority</label>
              <div style={{ display: 'flex', gap: 16 }}>
                {(['low', 'medium', 'high'] as const).map((p) => (
                  <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="priority"
                      value={p}
                      checked={priority === p}
                      onChange={() => setPriority(p)}
                      disabled={formState !== 'idle'}
                    />
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </label>
                ))}
              </div>
            </div>

            {/* Attachments */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
                Attachments <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  ({attachments.length}/{MAX_ATTACHMENTS}, {formatBytes(totalBytes)})
                </span>
              </label>

              {attachments.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                  {attachments.map((a) => (
                    <div key={a.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
                      borderRadius: 4, background: 'var(--bg-secondary)', fontSize: '0.8rem',
                    }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.file.name}
                      </span>
                      <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatBytes(a.file.size)}</span>
                      <button
                        onClick={() => handleRemoveAttachment(a.id)}
                        disabled={formState !== 'idle'}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                          color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1,
                        }}
                        aria-label={`Remove ${a.file.name}`}
                        title="Remove"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={handleFileSelect}
                  disabled={formState !== 'idle' || attachments.length >= MAX_ATTACHMENTS}
                >
                  Add File
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={handleIncludeDiagnostics}
                  disabled={formState !== 'idle' || hasDiagnosticsAttached || attachments.length >= MAX_ATTACHMENTS}
                  title={hasDiagnosticsAttached ? 'Diagnostics already attached' : 'Attach flight recorder dump'}
                >
                  {hasDiagnosticsAttached ? 'Diagnostics Attached' : 'Include Diagnostics'}
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/webm,application/json,text/plain"
                multiple
                onChange={handleFileInputChange}
                style={{ display: 'none' }}
              />

              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
                Paste screenshots with Ctrl+V. Max 10 MB per file, 50 MB total.
              </p>

              {attachError && (
                <p style={{ fontSize: '0.8rem', color: 'var(--error, #ef4444)', marginTop: 4 }}>{attachError}</p>
              )}
            </div>

            {/* System Info */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
                System Info <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(auto-captured)</span>
              </label>
              <div style={{
                padding: '6px 10px', borderRadius: 6, background: 'var(--bg-secondary)',
                border: '1px solid var(--border)', fontSize: '0.78rem', color: 'var(--text-secondary)',
                fontFamily: 'monospace',
              }}>
                <div>Version: {systemInfo.appVersion}</div>
                <div>Mode: {systemInfo.deploymentMode}</div>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={systemInfo.browser}>
                  Browser: {systemInfo.browser}
                </div>
                <div>OS: {systemInfo.os}</div>
              </div>
            </div>

            {/* Error message */}
            {formState === 'error' && errorMsg && (
              <p style={{ fontSize: '0.85rem', color: 'var(--error, #ef4444)', margin: 0 }}>{errorMsg}</p>
            )}
          </div>
        )}

        <div className="dialog-actions" style={{ marginTop: 12 }}>
          {formState === 'success' ? (
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          ) : (
            <>
              <button
                className="btn btn-ghost"
                onClick={onClose}
                disabled={formState === 'submitting' || formState === 'uploading'}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {formState === 'submitting' ? 'Submitting...'
                  : formState === 'uploading' ? uploadProgress
                  : formState === 'error' ? 'Retry'
                  : 'Submit Case'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
