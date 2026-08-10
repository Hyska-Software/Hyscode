import { useEffect, useRef, useState } from 'react';
import type * as monacoEditor from 'monaco-editor';
import { ProviderError } from '@hyscode/ai-providers';
import {
  buildInlineCompletionContext,
  type InlineCompletionContext,
} from '@/lib/inline-completion-context';
import { fetchInlineCompletion } from '@/lib/inline-completion-service';
import {
  isCurrentInlineCompletionSnapshot,
  waitForInlineCompletionDelay,
} from '@/lib/inline-completion-controller';

interface UseInlineCompletionProps {
  editorRef: React.MutableRefObject<monacoEditor.editor.IStandaloneCodeEditor | null>;
  monacoRef: React.MutableRefObject<typeof monacoEditor | null>;
  filePath: string | null;
  language: string | null;
  enabled: boolean;
  editorVersion: number;
  delay: number;
  maxTokens: number;
  temperature: number;
  providerId: string | null;
  modelId: string | null;
  activeProviderId: string | null;
  activeModelId: string | null;
}

export type InlineCompletionStatus =
  | { kind: 'disabled' | 'idle' | 'ready' | 'suppressed' }
  | { kind: 'unavailable' | 'error'; message: string };

type InlineCompletionConfig = {
  filePath: string | null;
  language: string | null;
  enabled: boolean;
  delay: number;
  maxTokens: number;
  temperature: number;
  providerId: string | null;
  modelId: string | null;
  activeProviderId: string | null;
  activeModelId: string | null;
};

export function useInlineCompletion({
  editorRef,
  monacoRef,
  filePath,
  language,
  enabled,
  editorVersion,
  delay,
  maxTokens,
  temperature,
  providerId,
  modelId,
  activeProviderId,
  activeModelId,
}: UseInlineCompletionProps): { status: InlineCompletionStatus } {
  const [status, setStatus] = useState<InlineCompletionStatus>(
    enabled ? { kind: 'idle' } : { kind: 'disabled' },
  );
  const latestRequestIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const configRef = useRef<InlineCompletionConfig>({
    filePath,
    language,
    enabled,
    delay,
    maxTokens,
    temperature,
    providerId,
    modelId,
    activeProviderId,
    activeModelId,
  });

  configRef.current = {
    filePath,
    language,
    enabled,
    delay,
    maxTokens,
    temperature,
    providerId,
    modelId,
    activeProviderId,
    activeModelId,
  };

  useEffect(() => {
    setStatus(enabled ? { kind: 'idle' } : { kind: 'disabled' });
    if (!enabled) {
      latestRequestIdRef.current += 1;
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
    }
  }, [
    enabled,
    filePath,
    language,
    delay,
    maxTokens,
    temperature,
    providerId,
    modelId,
    activeProviderId,
    activeModelId,
  ]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !enabled) return undefined;

    const disposable = monaco.languages.registerInlineCompletionsProvider(language ?? 'plaintext', {
      provideInlineCompletions: async (model, position, _context, token) => {
        const config = configRef.current;
        const editor = editorRef.current;
        if (!config.enabled || !config.filePath || !editor || editor.getModel() !== model) {
          return { items: [] };
        }
        if (token.isCancellationRequested) return { items: [] };

        const versionId = model.getVersionId();
        const text = model.getValue();
        const offset = model.getOffsetAt(position);
        const contextResult = buildInlineCompletionContext({
          text,
          offset,
          language: config.language,
          filePath: config.filePath,
        });

        if (contextResult.status === 'suppressed') {
          setStatus({ kind: 'suppressed' });
          return { items: [] };
        }

        const context: InlineCompletionContext = contextResult.context;
        const requestId = ++latestRequestIdRef.current;
        activeControllerRef.current?.abort();
        const controller = new AbortController();
        activeControllerRef.current = controller;
        const cancellation = token.onCancellationRequested(() => controller.abort());

        try {
          const shouldRequest = await waitForInlineCompletionDelay(config.delay, token, controller.signal);
          if (!shouldRequest || requestId !== latestRequestIdRef.current) return { items: [] };
          if (!isCurrentInlineCompletionSnapshot(editor, model, versionId, position.lineNumber, position.column)) {
            return { items: [] };
          }

          const result = await fetchInlineCompletion(context, {
            providerId: config.providerId,
            modelId: config.modelId,
            activeProviderId: config.activeProviderId,
            activeModelId: config.activeModelId,
            maxTokens: config.maxTokens,
            temperature: config.temperature,
            signal: controller.signal,
          });

          if (result.status === 'cancelled' || controller.signal.aborted) return { items: [] };
          if (requestId !== latestRequestIdRef.current) return { items: [] };
          if (!isCurrentInlineCompletionSnapshot(editor, model, versionId, position.lineNumber, position.column)) {
            return { items: [] };
          }

          if (result.status === 'unavailable') {
            setStatus({ kind: 'unavailable', message: result.message ?? 'AI providers are unavailable.' });
            return { items: [] };
          }
          if (!result.text) return { items: [] };

          setStatus({ kind: 'ready' });
          return {
            items: [
              {
                insertText: result.text,
                range: new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column,
                ),
              },
            ],
          };
        } catch (error) {
          if (controller.signal.aborted || token.isCancellationRequested) return { items: [] };
          const message =
            error instanceof ProviderError
              ? error.userMessage
              : 'AI inline completion failed. Check Settings → AI and try again.';
          setStatus({ kind: 'error', message });
          return { items: [] };
        } finally {
          cancellation.dispose();
          if (activeControllerRef.current === controller) activeControllerRef.current = null;
        }
      },
      disposeInlineCompletions: () => undefined,
    });

    return () => {
      disposable.dispose();
      latestRequestIdRef.current += 1;
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
    };
  }, [editorRef, monacoRef, language, enabled, editorVersion]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.updateOptions({
      inlineSuggest: {
        enabled,
        mode: 'subwordSmart',
        showToolbar: 'onHover',
        suppressSuggestions: false,
      },
    });
  }, [editorRef, enabled, editorVersion]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !enabled) return undefined;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleEmptyLineTrigger = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;

      const model = editor.getModel();
      const position = editor.getPosition();
      if (!model || !position || model.getLineContent(position.lineNumber).trim() !== '') return;

      timer = setTimeout(() => {
        timer = null;
        const currentModel = editor.getModel();
        const currentPosition = editor.getPosition();
        if (
          !currentModel ||
          !currentPosition ||
          currentModel.getLineContent(currentPosition.lineNumber).trim() !== ''
        ) {
          return;
        }
        editor.trigger('inline-completion', 'editor.action.inlineSuggest.trigger', {});
      }, Math.max(0, delay));
    };

    const cursorDisposable = editor.onDidChangeCursorPosition(scheduleEmptyLineTrigger);
    const contentDisposable = editor.onDidChangeModelContent(scheduleEmptyLineTrigger);

    return () => {
      cursorDisposable.dispose();
      contentDisposable.dispose();
      if (timer) clearTimeout(timer);
    };
  }, [editorRef, enabled, delay, editorVersion]);

  return { status };
}
