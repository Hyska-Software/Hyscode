import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CustomModel } from '../stores/settings-store';
import type { GitCommitContextContract } from '../lib/tauri-invoke';
import {
  generateCommitMessage,
  type CommitMessageGenerationProgress,
} from '../lib/commit-message-ai';
import {
  listCommitMessageTargets,
  resolveCommitMessageTarget,
} from '../lib/commit-message-provider';

export type CommitMessageApplicationDecision = 'apply' | 'suggest' | 'stale';

export function decideCommitMessageApplication(options: {
  capturedRepositoryRoot: string;
  currentRepositoryRoot: string | null;
  capturedFingerprint: string;
  currentFingerprint: string;
  capturedMessage: string;
  currentMessage: string;
}): CommitMessageApplicationDecision {
  if (
    options.currentRepositoryRoot !== options.capturedRepositoryRoot ||
    options.currentFingerprint !== options.capturedFingerprint
  ) {
    return 'stale';
  }
  return options.currentMessage === options.capturedMessage ? 'apply' : 'suggest';
}

type GenerationState =
  | { status: 'idle' }
  | {
      status: 'running';
      phase: 'collecting-context' | CommitMessageGenerationProgress['phase'];
      retryAttempt?: number;
    }
  | { status: 'error'; message: string };

type UseCommitMessageGenerationOptions = {
  repositoryRoot: string | null;
  stagedSignature: string;
  hasStagedChanges: boolean;
  commitMessage: string;
  commitProviderId: string | null;
  commitModelId: string | null;
  activeProviderId: string | null;
  activeModelId: string | null;
  enabledModels: Record<string, string[]>;
  customModels: CustomModel[];
  getCommitContext: () => Promise<GitCommitContextContract>;
  getStagedFingerprint: () => Promise<string>;
  setCommitMessage: (message: string) => void;
  openModelSelector: () => void;
};

export function useCommitMessageGeneration(options: UseCommitMessageGenerationOptions) {
  const [state, setState] = useState<GenerationState>({ status: 'idle' });
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const repositoryRootRef = useRef(options.repositoryRoot);
  const commitMessageRef = useRef(options.commitMessage);

  repositoryRootRef.current = options.repositoryRoot;
  commitMessageRef.current = options.commitMessage;

  const cancel = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestIdRef.current += 1;
    setState({ status: 'idle' });
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestIdRef.current += 1;
    setState({ status: 'idle' });
    setSuggestion(null);
  }, [options.repositoryRoot, options.stagedSignature]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const generate = useCallback(async (): Promise<void> => {
    if (abortRef.current) {
      cancel();
      return;
    }
    if (!options.hasStagedChanges || !options.repositoryRoot) {
      setState({ status: 'error', message: 'Stage some files before generating a message.' });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const abort = new AbortController();
    abortRef.current = abort;
    const capturedRoot = options.repositoryRoot;
    const capturedMessage = options.commitMessage;
    setSuggestion(null);
    setState({ status: 'running', phase: 'collecting-context' });

    try {
      const targets = await listCommitMessageTargets(options.enabledModels, options.customModels);
      if (abort.signal.aborted || requestIdRef.current !== requestId) return;
      const resolution = resolveCommitMessageTarget({
        targets,
        commitProviderId: options.commitProviderId,
        commitModelId: options.commitModelId,
        activeProviderId: options.activeProviderId,
        activeModelId: options.activeModelId,
      });
      if (resolution.status === 'error') {
        setState({ status: 'error', message: resolution.message });
        options.openModelSelector();
        return;
      }

      const context = await options.getCommitContext();
      if (abort.signal.aborted || requestIdRef.current !== requestId) return;
      if (context.files.length === 0) {
        setState({ status: 'error', message: 'No staged changes are available.' });
        return;
      }

      const result = await generateCommitMessage({
        providerId: resolution.target.providerId,
        modelId: resolution.target.modelId,
        context,
        signal: abort.signal,
        onProgress: (progress) => {
          if (requestIdRef.current !== requestId) return;
          setState({
            status: 'running',
            phase: progress.phase,
            retryAttempt: progress.phase === 'retrying' ? progress.attempt : undefined,
          });
        },
      });
      if (result.status === 'cancelled' || requestIdRef.current !== requestId) return;
      if (result.status === 'error') {
        setState({ status: 'error', message: result.error.message });
        return;
      }

      const currentFingerprint = await options.getStagedFingerprint();
      if (abort.signal.aborted || requestIdRef.current !== requestId) return;
      const decision = decideCommitMessageApplication({
        capturedRepositoryRoot: capturedRoot,
        currentRepositoryRoot: repositoryRootRef.current,
        capturedFingerprint: context.fingerprint,
        currentFingerprint,
        capturedMessage,
        currentMessage: commitMessageRef.current,
      });
      if (decision === 'stale') {
        setState({
          status: 'error',
          message: 'Staged changes changed during generation. Generate a new message.',
        });
      } else if (decision === 'suggest') {
        setSuggestion(result.message);
        setState({ status: 'idle' });
      } else {
        options.setCommitMessage(result.message);
        setState({ status: 'idle' });
      }
    } catch (error) {
      if (!abort.signal.aborted && requestIdRef.current === requestId) {
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Commit-message generation failed.',
        });
      }
    } finally {
      if (requestIdRef.current === requestId) {
        abortRef.current = null;
      }
    }
  }, [
    cancel,
    options.activeModelId,
    options.activeProviderId,
    options.commitMessage,
    options.commitModelId,
    options.commitProviderId,
    options.customModels,
    options.enabledModels,
    options.getCommitContext,
    options.getStagedFingerprint,
    options.hasStagedChanges,
    options.openModelSelector,
    options.repositoryRoot,
    options.setCommitMessage,
  ]);

  const applySuggestion = useCallback((): void => {
    if (!suggestion) return;
    options.setCommitMessage(suggestion);
    setSuggestion(null);
  }, [options, suggestion]);

  const progressLabel = useMemo((): string | null => {
    if (state.status !== 'running') return null;
    if (state.phase === 'collecting-context') return 'Collecting staged changes…';
    if (state.phase === 'waiting-provider') return 'Waiting for the AI provider…';
    if (state.phase === 'validating') return 'Validating commit message…';
    return `Retrying provider${state.retryAttempt ? ` (${state.retryAttempt})` : ''}…`;
  }, [state]);

  return {
    generateOrCancel: generate,
    cancel,
    isGenerating: state.status === 'running',
    error: state.status === 'error' ? state.message : null,
    progressLabel,
    suggestion,
    applySuggestion,
    dismissSuggestion: () => setSuggestion(null),
  };
}
