import { useState, useEffect } from 'react';
import { useAnalysisStore } from '../store/useAnalysisStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ApiKeyDialog({ open, onClose }: Props) {
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const setHasApiKey = useAnalysisStore(s => s.setHasApiKey);

  useEffect(() => {
    if (open) {
      setKey('');
      setStatus('idle');
      setErrorMsg('');
    }
  }, [open]);

  if (!open) return null;

  const handleValidate = async () => {
    if (!key.trim()) return;
    setStatus('validating');
    setErrorMsg('');

    try {
      const result = await window.electronAPI.validateApiKey(key.trim());
      if (result.valid) {
        setStatus('valid');
      } else {
        setStatus('invalid');
        setErrorMsg(result.error || 'Invalid API key');
      }
    } catch (err) {
      setStatus('invalid');
      setErrorMsg(err instanceof Error ? err.message : 'Validation failed');
    }
  };

  const handleSave = async () => {
    try {
      await window.electronAPI.storeApiKey(key.trim());
      setHasApiKey(true);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save key');
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-panel" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Gemini API Key</h3>
          <button className="dialog-close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="dialog-body">
          <label className="dialog-label">
            API Key
            <input
              type="password"
              className="dialog-input"
              placeholder="Enter your Google Gemini API key"
              value={key}
              onChange={e => { setKey(e.target.value); setStatus('idle'); }}
              onKeyDown={e => { if (e.key === 'Enter') handleValidate(); }}
              autoFocus
            />
          </label>

          {status === 'valid' && (
            <div className="apikey-status apikey-valid">Key is valid</div>
          )}
          {status === 'invalid' && (
            <div className="apikey-status apikey-invalid">{errorMsg}</div>
          )}
          {status === 'validating' && (
            <div className="apikey-status apikey-validating">Validating...</div>
          )}

          <div className="apikey-hint">
            Get your API key from{' '}
            <span className="apikey-link">aistudio.google.com</span>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="dialog-cancel-btn" onClick={onClose}>Cancel</button>
          {status === 'valid' ? (
            <button className="dialog-add-btn" onClick={handleSave}>Save Key</button>
          ) : (
            <button
              className="dialog-add-btn"
              onClick={handleValidate}
              disabled={!key.trim() || status === 'validating'}
            >
              {status === 'validating' ? 'Validating...' : 'Validate'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
