import { useState } from 'react';
import { usePipelineStore } from '../store';

export function ImportConfig() {
  const { steps, setStepConfig } = usePipelineStore();
  const config = steps['import']?.config || {};

  const [mode, setMode] = useState<string>((config.importMode as string) || 'file');
  const [files, setFiles] = useState<string[]>((config.files as string[]) || []);
  const [url, setUrl] = useState<string>((config.url as string) || '');
  const [pov, setPov] = useState<string>((config.pov as string) || '');

  function update(patch: Record<string, unknown>) {
    const merged = { importMode: mode, files, url, pov, ...patch };
    setStepConfig('import', merged);
  }

  async function selectFiles() {
    const selected = await window.electronAPI.selectFiles();
    if (selected.length > 0) {
      setFiles(selected);
      update({ files: selected });
    }
  }

  return (
    <div className="step-config">
      <div className="config-row">
        <label>Source</label>
        <select
          value={mode}
          onChange={e => {
            setMode(e.target.value);
            update({ importMode: e.target.value });
          }}
        >
          <option value="file">Local File(s)</option>
          <option value="url">Web URL</option>
          <option value="inbox">Inbox Folder</option>
        </select>
      </div>

      {mode === 'file' && (
        <div className="config-row">
          <label>Files</label>
          <div style={{ flex: 1 }}>
            <button className="btn btn-sm" onClick={selectFiles}>Choose Files...</button>
            {files.length > 0 && (
              <div className="file-list">
                {files.map((f, i) => (
                  <div key={i}>{f.split(/[\\/]/).pop()}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'url' && (
        <div className="config-row">
          <label>URL</label>
          <input
            type="text"
            placeholder="https://example.com/article"
            value={url}
            onChange={e => { setUrl(e.target.value); update({ url: e.target.value }); }}
          />
        </div>
      )}

      {mode !== 'inbox' && (
        <div className="config-row">
          <label>POV Tag</label>
          <select
            value={pov}
            onChange={e => { setPov(e.target.value); update({ pov: e.target.value }); }}
          >
            <option value="">Auto-detect</option>
            <option value="accelerationist">Accelerationist</option>
            <option value="safetyist">Safetyist</option>
            <option value="skeptic">Skeptic</option>
          </select>
        </div>
      )}
    </div>
  );
}
