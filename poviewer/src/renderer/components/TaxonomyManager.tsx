import { useAppStore } from '../store/useAppStore';
import { POV_COLORS, POV_LABELS, type PovCamp } from '../types/types';

const KNOWN_POVS: PovCamp[] = ['accelerationist', 'safetyist', 'skeptic', 'cross-cutting'];

export default function TaxonomyManager() {
  const notebooks = useAppStore(s => s.notebooks);
  const activeNotebookId = useAppStore(s => s.activeNotebookId);
  const loadedTaxonomies = useAppStore(s => s.loadedTaxonomies);
  const loadTaxonomy = useAppStore(s => s.loadTaxonomy);
  const unloadTaxonomy = useAppStore(s => s.unloadTaxonomy);

  const notebook = notebooks.find(n => n.id === activeNotebookId) ?? notebooks[0];

  const handleBrowse = async () => {
    if (!window.electronAPI?.openTaxonomyDialog) return;
    const result = await window.electronAPI.openTaxonomyDialog();
    if (!result) return;
    // For now, log the result. Future: add custom taxonomy to notebook.
    console.log('[TaxonomyManager] Loaded file:', result.filePath, result.data);
  };

  return (
    <div className="taxonomy-manager">
      <div className="taxonomy-header">
        <h3>Taxonomies</h3>
        <button className="taxonomy-browse-btn" onClick={handleBrowse}>
          Browse...
        </button>
      </div>
      {notebook.taxonomyFiles.map(pov => {
        const camp = pov as PovCamp;
        const meta = loadedTaxonomies[pov];
        const isLoaded = !!meta && !meta.isLoading;
        const isLoading = !!meta?.isLoading;

        return (
          <div key={pov} className="taxonomy-file-item">
            <input
              type="checkbox"
              checked={!!meta}
              onChange={() => {
                if (meta) {
                  unloadTaxonomy(pov);
                } else {
                  loadTaxonomy(pov);
                }
              }}
            />
            <label onClick={() => meta ? unloadTaxonomy(pov) : loadTaxonomy(pov)}>
              <span
                className="taxonomy-color-dot"
                style={{ background: POV_COLORS[camp] }}
              />
              <span>{POV_LABELS[camp]}</span>
            </label>
            {isLoading && <span className="taxonomy-loading">loading...</span>}
            {isLoaded && (
              <span className="taxonomy-node-count">{meta.nodeCount} nodes</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
