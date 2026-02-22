import { useTaxonomyStore } from '../hooks/useTaxonomyStore';

export function SaveBar() {
  const { dirty, save, saveError } = useTaxonomyStore();
  const isDirty = dirty.size > 0;

  return (
    <div className="save-bar">
      <span className={`save-bar-status ${isDirty ? 'dirty' : ''}`}>
        {isDirty
          ? `Unsaved changes (${dirty.size} file${dirty.size > 1 ? 's' : ''})`
          : 'All changes saved'}
      </span>
      {saveError && <span className="save-bar-error">{saveError}</span>}
      <button
        className="btn btn-primary"
        onClick={save}
        disabled={!isDirty}
      >
        Save
      </button>
    </div>
  );
}
