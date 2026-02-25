import { useStore } from '../store/useStore';
import type { Theme } from '../types/types';

const POV_COLORS: Record<string, string> = {
  accelerationist: 'var(--color-acc)',
  safetyist: 'var(--color-saf)',
  skeptic: 'var(--color-skp)',
};

function ThemeSwitcher() {
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);

  const options: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'Auto' },
  ];

  return (
    <div className="theme-switcher">
      {options.map(o => (
        <button
          key={o.value}
          className={`theme-btn${theme === o.value ? ' active' : ''}`}
          onClick={() => setTheme(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SourcesPane() {
  const sources = useStore(s => s.sources);
  const selectedSourceIds = useStore(s => s.selectedSourceIds);
  const toggleSource = useStore(s => s.toggleSource);
  const toggleAll = useStore(s => s.toggleAll);

  const allSelected = sources.length > 0 && sources.every(s => selectedSourceIds.has(s.id));
  const someSelected = sources.some(s => selectedSourceIds.has(s.id));

  return (
    <>
      <div className="pane-header">
        <h2>Sources</h2>
        <ThemeSwitcher />
      </div>
      <div className="pane-body">
        <label className="select-all-row">
          <input
            type="checkbox"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={toggleAll}
          />
          <span className="select-all-label">
            Select All ({sources.length})
          </span>
        </label>

        <ul className="source-list">
          {sources.map(source => (
            <li
              key={source.id}
              className={`source-item${selectedSourceIds.has(source.id) ? ' selected' : ''}`}
            >
              <label className="source-row">
                <input
                  type="checkbox"
                  checked={selectedSourceIds.has(source.id)}
                  onChange={() => toggleSource(source.id)}
                />
                <div className="source-info">
                  <div className="source-title">{source.title}</div>
                  {source.povTags.length > 0 && (
                    <div className="source-tags">
                      {source.povTags.map(tag => (
                        <span
                          key={tag}
                          className="pov-chip"
                          style={{ borderColor: POV_COLORS[tag] || 'var(--text-muted)', color: POV_COLORS[tag] || 'var(--text-muted)' }}
                        >
                          {tag.slice(0, 3).toUpperCase()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
