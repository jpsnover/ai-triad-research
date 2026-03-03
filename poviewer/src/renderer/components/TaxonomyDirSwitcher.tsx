import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';

export default function TaxonomyDirSwitcher() {
  const [dirs, setDirs] = useState<string[]>([]);
  const [activeDir, setActiveDir] = useState('Origin');
  const loadFromPipeline = useAppStore(s => s.loadFromPipeline);

  useEffect(() => {
    if (!window.electronAPI?.getTaxonomyDirs) return;
    window.electronAPI.getTaxonomyDirs().then(setDirs);
    window.electronAPI.getActiveTaxonomyDir().then(setActiveDir);
  }, []);

  const handleChange = useCallback(async (dirName: string) => {
    await window.electronAPI.setTaxonomyDir(dirName);
    setActiveDir(dirName);
    // Force full reload so taxonomy labels update everywhere
    useAppStore.setState({ pipelineLoaded: false });
    await loadFromPipeline();
  }, [loadFromPipeline]);

  if (dirs.length <= 1) return null;

  return (
    <div className="taxonomy-dir-bar">
      <label className="taxonomy-dir-label">Taxonomy:</label>
      <select
        className="taxonomy-dir-select"
        value={activeDir}
        onChange={(e) => handleChange(e.target.value)}
      >
        {dirs.map((dir) => (
          <option key={dir} value={dir}>{dir}</option>
        ))}
      </select>
    </div>
  );
}
