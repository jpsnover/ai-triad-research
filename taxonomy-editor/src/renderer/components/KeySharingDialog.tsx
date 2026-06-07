// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import jsQR from 'jsqr';

type Mode = 'choose' | 'export' | 'import-scan' | 'import-paste';

interface KeySharingDialogProps {
  onClose: () => void;
  onKeysImported: () => void;
}

export function KeySharingDialog({ onClose, onKeysImported }: KeySharingDialogProps) {
  const [mode, setMode] = useState<Mode>('choose');
  const [passphrase, setPassphrase] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [payloadText, setPayloadText] = useState('');
  const [pasteInput, setPasteInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const handleExport = async () => {
    if (!passphrase.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.exportKeysForSharing(passphrase.trim());
      setQrDataUrl(result.dataUrl);
      setPayloadText(result.payloadText);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'key-sharing-dialog',
        level: 'error',
        message: 'Failed to export keys for sharing',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (payloadStr: string) => {
    if (!passphrase.trim() || !payloadStr.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const payload = JSON.parse(payloadStr);
      const imported = await api.importKeysFromSharing(payload, passphrase.trim());
      setSuccess(`Imported keys: ${imported.join(', ')}`);
      onKeysImported();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'key-sharing-dialog',
        level: 'error',
        message: 'Failed to import keys from sharing payload',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('Unsupported state') || msg.includes('unable to authenticate')
        ? 'Wrong passphrase or corrupted payload'
        : msg);
    } finally {
      setLoading(false);
    }
  };

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'key-sharing-dialog',
        level: 'error',
        message: 'Failed to access camera for QR scanning',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      setError('Camera not available. Use "Paste Payload" instead.');
    }
  };

  useEffect(() => {
    if (!scanning || !streamRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = streamRef.current;
    video.play().catch(() => { /* autoplay blocked — user will see frozen frame */ });

    scanIntervalRef.current = window.setInterval(() => {
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code?.data) {
        stopCamera();
        setPasteInput(code.data);
        setMode('import-paste');
      }
    }, 250);

    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    };
  }, [scanning, stopCamera]);

  const handleCopyPayload = async () => {
    try {
      await api.clipboardWriteText(payloadText);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'key-sharing-dialog',
        level: 'error',
        message: 'Failed to copy payload to clipboard',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog settings-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3>Key Sharing</h3>

        {mode === 'choose' && (
          <>
            <p style={{ margin: '8px 0 16px', opacity: 0.8, fontSize: 13 }}>
              Transfer API keys between devices using an encrypted QR code.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setMode('export')}>
                Share Keys (QR)
              </button>
              <button className="btn" style={{ flex: 1 }} onClick={() => { setMode('import-scan'); void startCamera(); }}>
                Scan QR
              </button>
              <button className="btn" style={{ flex: 1 }} onClick={() => setMode('import-paste')}>
                Paste Payload
              </button>
            </div>
          </>
        )}

        {mode === 'export' && !qrDataUrl && (
          <>
            <div className="settings-key-section">
              <label className="settings-label">Encryption Passphrase</label>
              <p style={{ margin: '4px 0 8px', opacity: 0.7, fontSize: 12 }}>
                Choose a passphrase to encrypt your keys. You will need this same passphrase on the target device.
              </p>
              <div className="settings-key-row">
                <input
                  type="password"
                  className="settings-key-input"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter passphrase..."
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleExport(); }}
                />
                <button className="btn btn-primary btn-sm" onClick={handleExport} disabled={!passphrase.trim() || loading}>
                  {loading ? '...' : 'Generate QR'}
                </button>
              </div>
            </div>
          </>
        )}

        {mode === 'export' && qrDataUrl && (
          <>
            <div style={{ background: 'var(--settings-warn-bg, #fef3cd)', padding: '8px 12px', borderRadius: 6, margin: '8px 0', fontSize: 12 }}>
              Anyone who photographs this QR code can extract your API keys (with the passphrase). Do not share it publicly.
            </div>
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <img src={qrDataUrl} alt="API keys QR code" style={{ maxWidth: '100%', imageRendering: 'pixelated' }} />
            </div>
            <button className="btn btn-sm" onClick={handleCopyPayload} style={{ width: '100%' }}>
              Copy Encrypted Payload (for paste import)
            </button>
          </>
        )}

        {mode === 'import-scan' && (
          <>
            <p style={{ margin: '4px 0 8px', opacity: 0.7, fontSize: 12 }}>
              Point your camera at the QR code displayed on the source device.
            </p>
            {scanning && (
              <div style={{ position: 'relative', width: '100%', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                <video ref={videoRef} style={{ width: '100%', display: 'block' }} muted playsInline />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
              </div>
            )}
            <button className="btn btn-sm" onClick={() => { stopCamera(); setMode('import-paste'); }} style={{ width: '100%' }}>
              Switch to Paste Payload
            </button>
          </>
        )}

        {mode === 'import-paste' && !success && (
          <>
            <div className="settings-key-section">
              <label className="settings-label">Encrypted Payload</label>
              <textarea
                className="settings-key-input"
                value={pasteInput}
                onChange={(e) => setPasteInput(e.target.value)}
                placeholder='Paste the encrypted payload JSON here...'
                rows={3}
                style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
              />
            </div>
            <div className="settings-key-section" style={{ marginTop: 8 }}>
              <label className="settings-label">Passphrase</label>
              <div className="settings-key-row">
                <input
                  type="password"
                  className="settings-key-input"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter the passphrase used during export..."
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleImport(pasteInput); }}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleImport(pasteInput)}
                  disabled={!passphrase.trim() || !pasteInput.trim() || loading}
                >
                  {loading ? '...' : 'Import'}
                </button>
              </div>
            </div>
          </>
        )}

        {error && <div className="settings-key-error" style={{ marginTop: 8 }}>{error}</div>}
        {success && <div className="settings-key-success" style={{ marginTop: 8 }}>{success}</div>}

        <div className="dialog-actions" style={{ marginTop: 12 }}>
          {mode !== 'choose' && !success && (
            <button className="btn btn-sm" onClick={() => { stopCamera(); setMode('choose'); setQrDataUrl(null); setError(null); setPassphrase(''); setPasteInput(''); }}>
              Back
            </button>
          )}
          <button className="btn btn-primary" onClick={() => { stopCamera(); onClose(); }}>
            {success ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
