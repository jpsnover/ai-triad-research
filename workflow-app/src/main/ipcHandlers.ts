import { ipcMain, dialog, BrowserWindow } from 'electron';
import {
  PIPELINE_STEPS,
  runStep,
  cancelStep,
  getGitStatus,
  getGitDiffStat,
  listProposalFiles,
  readProposalFile,
  getDataRoot,
} from './pipeline';

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('get-step-definitions', () => {
    return PIPELINE_STEPS;
  });

  ipcMain.handle('run-step', async (_event, stepId: string, config: Record<string, unknown>) => {
    const win = getWindow();
    const result = await runStep(
      stepId,
      config,
      (text) => { win?.webContents.send('step-output', text); },
      (text) => { win?.webContents.send('step-error', text); },
    );
    return result;
  });

  ipcMain.handle('cancel-step', () => {
    cancelStep();
  });

  ipcMain.handle('get-git-status', () => {
    return getGitStatus();
  });

  ipcMain.handle('get-git-diff-stat', () => {
    return getGitDiffStat();
  });

  ipcMain.handle('list-proposal-files', () => {
    return listProposalFiles();
  });

  ipcMain.handle('read-proposal-file', (_event, filePath: string) => {
    return readProposalFile(filePath);
  });

  ipcMain.handle('get-data-root', () => {
    return getDataRoot();
  });

  ipcMain.handle('select-files', async () => {
    const win = getWindow();
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'html', 'htm', 'md', 'txt', 'pptx', 'xlsx', 'epub', 'csv'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });
}
