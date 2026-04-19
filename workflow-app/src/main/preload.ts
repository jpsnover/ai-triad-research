import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getStepDefinitions: (): Promise<unknown[]> =>
    ipcRenderer.invoke('get-step-definitions'),

  runStep: (stepId: string, config: Record<string, unknown>): Promise<{ exitCode: number }> =>
    ipcRenderer.invoke('run-step', stepId, config),

  cancelStep: (): Promise<void> =>
    ipcRenderer.invoke('cancel-step'),

  getGitStatus: (): Promise<{ summary: string; hasChanges: boolean }> =>
    ipcRenderer.invoke('get-git-status'),

  getGitDiffStat: (): Promise<string> =>
    ipcRenderer.invoke('get-git-diff-stat'),

  listProposalFiles: (): Promise<string[]> =>
    ipcRenderer.invoke('list-proposal-files'),

  readProposalFile: (filePath: string): Promise<unknown> =>
    ipcRenderer.invoke('read-proposal-file', filePath),

  selectFiles: (): Promise<string[]> =>
    ipcRenderer.invoke('select-files'),

  getDataRoot: (): Promise<string> =>
    ipcRenderer.invoke('get-data-root'),

  onStepOutput: (callback: (text: string) => void) => {
    const handler = (_event: unknown, text: string) => callback(text);
    ipcRenderer.on('step-output', handler);
    return () => ipcRenderer.removeListener('step-output', handler);
  },

  onStepError: (callback: (text: string) => void) => {
    const handler = (_event: unknown, text: string) => callback(text);
    ipcRenderer.on('step-error', handler);
    return () => ipcRenderer.removeListener('step-error', handler);
  },
});
