import { useEffect, useCallback } from 'react';
import { usePipelineStore } from '../store';

let outputCleanup: (() => void) | null = null;
let errorCleanup: (() => void) | null = null;
let cancelRequested = false;

function extractSummary(stepId: string, log: string): string {
  const lines = log.split('\n').filter(l => l.trim());

  switch (stepId) {
    case 'import': {
      const imported = lines.filter(l => /created|ingested|queued/i.test(l));
      const fileCount = imported.length || lines.filter(l => /Import-AITriadDocument/i.test(l)).length;
      if (fileCount > 0) return `${fileCount} doc${fileCount !== 1 ? 's' : ''} imported`;
      return 'Imported';
    }
    case 'summarize': {
      const processed = lines.filter(l => /summary_status.*current|summarised|processed/i.test(l));
      const skipped = lines.filter(l => /skip|already current/i.test(l));
      const parts: string[] = [];
      if (processed.length) parts.push(`${processed.length} summarized`);
      if (skipped.length) parts.push(`${skipped.length} skipped`);
      return parts.join(', ') || 'Summaries updated';
    }
    case 'conflicts': {
      const found = lines.filter(l => /conflict|contradiction|dispute/i.test(l));
      return found.length > 0 ? `${found.length} conflicts` : 'No new conflicts';
    }
    case 'health': {
      const orphans = lines.find(l => /orphan/i.test(l));
      const unmapped = lines.find(l => /unmapped/i.test(l));
      const parts: string[] = [];
      const orphanMatch = orphans?.match(/(\d+)\s*orphan/i);
      if (orphanMatch) parts.push(`${orphanMatch[1]} orphans`);
      const unmappedMatch = unmapped?.match(/(\d+)\s*unmapped/i);
      if (unmappedMatch) parts.push(`${unmappedMatch[1]} unmapped`);
      return parts.join(', ') || 'Health checked';
    }
    case 'proposals': {
      const proposalCount = lines.filter(l => /NEW|SPLIT|MERGE|RELABEL/i.test(l));
      return proposalCount.length > 0 ? `${proposalCount.length} proposals` : 'Proposals generated';
    }
    case 'review': {
      const approved = lines.filter(l => /approved/i.test(l));
      const rejected = lines.filter(l => /rejected/i.test(l));
      const parts: string[] = [];
      if (approved.length) parts.push(`${approved.length} approved`);
      if (rejected.length) parts.push(`${rejected.length} rejected`);
      return parts.join(', ') || 'Review complete';
    }
    case 'integrity': {
      const issues = lines.filter(l => /error|invalid|missing|broken|orphan/i.test(l) && !/VERBOSE/i.test(l));
      return issues.length > 0 ? `${issues.length} issues` : 'All valid';
    }
    case 'embeddings': {
      const embedded = lines.find(l => /(\d+)\s*(node|embedding|vector)/i.test(l));
      const match = embedded?.match(/(\d+)\s*(node|embedding|vector)/i);
      return match ? `${match[1]} embeddings` : 'Embeddings updated';
    }
    case 'edges': {
      const edgeCount = lines.filter(l => /edge|relationship|proposed/i.test(l));
      return edgeCount.length > 0 ? `${edgeCount.length} edges` : 'Edges discovered';
    }
    case 'attributes': {
      const nodeCount = lines.filter(l => /enriched|attribute|batch/i.test(l));
      return nodeCount.length > 0 ? `${nodeCount.length} nodes` : 'Attributes extracted';
    }
    case 'git-commit': {
      const filesMatch = log.match(/(\d+)\s*file/i);
      return filesMatch ? `${filesMatch[1]} files committed` : 'Committed';
    }
    case 'git-push':
      return 'Pushed';
    default:
      return 'Done';
  }
}

export function useRunPipeline() {
  useEffect(() => {
    outputCleanup = window.electronAPI.onStepOutput((text) => {
      const activeId = usePipelineStore.getState().activeStepId;
      if (activeId) {
        usePipelineStore.getState().appendLog(activeId, text);
      }
    });
    errorCleanup = window.electronAPI.onStepError((text) => {
      const activeId = usePipelineStore.getState().activeStepId;
      if (activeId) {
        usePipelineStore.getState().appendErrorLog(activeId, text);
      }
    });
    return () => {
      outputCleanup?.();
      errorCleanup?.();
    };
  }, []);

  const runSingle = useCallback(async (stepId: string) => {
    const s = usePipelineStore.getState();
    s.clearLog(stepId);
    s.setStepStatus(stepId, 'running');
    s.setActiveStep(stepId);
    s.setExpandedStep(stepId);
    s.markStepStart(stepId);

    try {
      const config = s.steps[stepId]?.config || {};
      const result = await window.electronAPI.runStep(stepId, config);
      const endState = usePipelineStore.getState();
      endState.markStepEnd(stepId);

      const log = endState.steps[stepId]?.log || '';
      const summary = extractSummary(stepId, log);
      endState.setStepSummary(stepId, summary);

      if (result.exitCode === 0) {
        endState.setStepStatus(stepId, 'success');
      } else {
        endState.setStepStatus(stepId, 'error');
      }
    } catch (err) {
      const endState = usePipelineStore.getState();
      endState.markStepEnd(stepId);
      endState.appendErrorLog(stepId, `\nException: ${err}\n`);
      endState.setStepStatus(stepId, 'error');
      endState.setStepSummary(stepId, 'Failed');
    }

    usePipelineStore.getState().setActiveStep(null);
  }, []);

  const skipStep = useCallback((stepId: string) => {
    const s = usePipelineStore.getState();
    s.setStepStatus(stepId, 'skipped');
    s.setStepSummary(stepId, 'Skipped');
  }, []);

  const runAll = useCallback(async () => {
    cancelRequested = false;
    const s = usePipelineStore.getState();
    s.setPipelineRunning(true);

    for (const def of s.definitions) {
      if (cancelRequested) break;

      const current = usePipelineStore.getState().steps[def.id];
      if (current?.status === 'success' || current?.status === 'skipped') continue;

      // Auto-expand the current step so the user can watch progress
      usePipelineStore.getState().setExpandedStep(def.id);

      if (def.requiresConfig) {
        const config = current?.config || {};
        const hasConfig = def.id === 'import'
          ? (config.importMode === 'inbox' || (config.files as string[])?.length > 0 || (config.url as string)?.length > 0)
          : def.id === 'git-commit'
            ? !!(config.commitMessage as string)
            : def.id === 'review'
              ? !!(config.proposalPath as string)
              : true;

        if (!hasConfig && def.canSkip) {
          usePipelineStore.getState().setStepStatus(def.id, 'skipped');
          usePipelineStore.getState().setStepSummary(def.id, 'Skipped');
          continue;
        }
        if (!hasConfig) {
          usePipelineStore.getState().setStepStatus(def.id, 'pending');
          usePipelineStore.getState().appendLog(def.id, 'Waiting for configuration — fill in the fields above and click Run Step.\n');
          usePipelineStore.getState().setPipelineRunning(false);
          return;
        }
      }

      await runSingle(def.id);

      const result = usePipelineStore.getState().steps[def.id];
      if (result?.status === 'error') {
        usePipelineStore.getState().setPipelineRunning(false);
        return;
      }
    }

    usePipelineStore.getState().setPipelineRunning(false);
  }, [runSingle]);

  const cancel = useCallback(async () => {
    cancelRequested = true;
    await window.electronAPI.cancelStep();
    const activeId = usePipelineStore.getState().activeStepId;
    if (activeId) {
      usePipelineStore.getState().setStepStatus(activeId, 'cancelled');
      usePipelineStore.getState().markStepEnd(activeId);
      usePipelineStore.getState().setStepSummary(activeId, 'Cancelled');
    }
    usePipelineStore.getState().setActiveStep(null);
    usePipelineStore.getState().setPipelineRunning(false);
  }, []);

  return { runSingle, runAll, skipStep, cancel };
}
