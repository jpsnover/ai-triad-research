import { useTaxonomyStore } from '../hooks/useTaxonomyStore';

export function SaveBar() {
  const { dirty, save, saveError, zoomLevel, zoomIn, zoomOut, zoomReset } = useTaxonomyStore();
  const isDirty = dirty.size > 0;

  return (
    <div className="save-bar">
      <span className={`save-bar-status ${isDirty ? 'dirty' : ''}`}>
        {isDirty
          ? `Unsaved changes (${dirty.size} file${dirty.size > 1 ? 's' : ''})`
          : 'All changes saved'}
      </span>
      {saveError && <span className="save-bar-error">{saveError}</span>}
      <div className="save-bar-right">
        <div className="zoom-controls">
          <button className="btn btn-ghost btn-sm" onClick={zoomOut} title="Zoom out (Ctrl+-)">-</button>
          <button
            className="btn btn-ghost btn-sm zoom-level"
            onClick={zoomReset}
            title="Reset zoom (Ctrl+0)"
          >
            {zoomLevel}%
          </button>
          <button className="btn btn-ghost btn-sm" onClick={zoomIn} title="Zoom in (Ctrl+=)">+</button>
        </div>
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={!isDirty}
        >
          Save
        </button>
      </div>
    </div>
  );
}
