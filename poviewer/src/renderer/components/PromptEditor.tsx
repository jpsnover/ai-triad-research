import { useState, useEffect } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function PromptEditor({ open, onClose }: Props) {
  const [stage1, setStage1] = useState('');
  const [stage2, setStage2] = useState('');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSaved(false);

    if (window.electronAPI?.getPromptOverrides) {
      window.electronAPI.getPromptOverrides().then((overrides: unknown) => {
        const data = overrides as { stage1?: string; stage2?: string } | null;
        setStage1(data?.stage1 || '');
        setStage2(data?.stage2 || '');
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    await window.electronAPI.savePromptOverrides({
      stage1: stage1.trim() || null,
      stage2: stage2.trim() || null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setStage1('');
    setStage2('');
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-panel prompt-editor-panel" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Edit Prompt Templates</h3>
          <button className="dialog-close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="dialog-body">
          {loading ? (
            <div className="apikey-status apikey-validating">Loading prompts...</div>
          ) : (
            <>
              <label className="dialog-label">
                Stage 1: Segmentation Prompt
                <textarea
                  className="dialog-input prompt-textarea"
                  value={stage1}
                  onChange={e => setStage1(e.target.value)}
                  placeholder="Leave empty to use default prompt. Use {{document}} as the document placeholder."
                  rows={8}
                />
              </label>
              <label className="dialog-label">
                Stage 2: Mapping Prompt
                <textarea
                  className="dialog-input prompt-textarea"
                  value={stage2}
                  onChange={e => setStage2(e.target.value)}
                  placeholder="Leave empty to use default prompt. Use {{points}} and {{taxonomy}} as placeholders."
                  rows={8}
                />
              </label>
              {saved && (
                <div className="apikey-status apikey-valid">Prompts saved!</div>
              )}
            </>
          )}
        </div>
        <div className="dialog-footer">
          <button className="dialog-cancel-btn" onClick={handleReset}>Reset to Defaults</button>
          <button className="dialog-cancel-btn" onClick={onClose}>Cancel</button>
          <button className="dialog-add-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
