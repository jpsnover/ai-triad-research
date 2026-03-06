import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import type { ColorScheme, GeminiModel } from '../hooks/useTaxonomyStore';
import { GEMINI_MODELS } from '../hooks/useTaxonomyStore';

interface SettingsDialogProps {
  onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { colorScheme, setColorScheme, geminiModel, setGeminiModel } = useTaxonomyStore();

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog settings-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>

        <div className="settings-row">
          <label className="settings-label">AI Model</label>
          <select
            className="settings-select"
            value={geminiModel}
            onChange={(e) => setGeminiModel(e.target.value as GeminiModel)}
          >
            {GEMINI_MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        <div className="settings-row">
          <label className="settings-label">Theme</label>
          <select
            className="settings-select"
            value={colorScheme}
            onChange={(e) => setColorScheme(e.target.value as ColorScheme)}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="bkc">BKC</option>
            <option value="system">System</option>
          </select>
        </div>

        <div className="dialog-actions">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
