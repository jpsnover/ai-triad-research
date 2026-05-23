import { usePipelineStore } from '../store';

export function SummarizeConfig() {
  const { steps, setStepConfig } = usePipelineStore();
  const config = steps['summarize']?.config || {};
  const importedToday = (config.importedToday as boolean) || false;

  return (
    <div className="step-config">
      <div className="config-row">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={importedToday}
            onChange={e => setStepConfig('summarize', { ...config, importedToday: e.target.checked })}
          />
          Today's imports only
        </label>
      </div>
    </div>
  );
}
