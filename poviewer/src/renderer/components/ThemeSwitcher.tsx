import { useAppStore } from '../store/useAppStore';
import type { Theme } from '../types/types';

const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'bkc', label: 'BKC' },
  { value: 'system', label: 'Auto' },
];

export default function ThemeSwitcher() {
  const theme = useAppStore(s => s.theme);
  const setTheme = useAppStore(s => s.setTheme);

  return (
    <div className="theme-switcher">
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          className={`theme-btn${theme === opt.value ? ' active' : ''}`}
          onClick={() => setTheme(opt.value)}
          title={`${opt.label} theme`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
