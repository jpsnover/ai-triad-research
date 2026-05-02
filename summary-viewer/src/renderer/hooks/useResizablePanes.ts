// Re-export from shared library with app-specific storage key
import { useResizablePanes as _useResizablePanes } from '../../../../lib/electron-shared/hooks/useResizablePanes';

export function useResizablePanes() {
  return _useResizablePanes('summaryviewer-pane-widths');
}
