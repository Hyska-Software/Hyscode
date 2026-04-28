// ─── useInlineCompletion ────────────────────────────────────────────────────
// Registers a Monaco inline-completion provider backed by the AI provider registry.
// Uses a request-id strategy instead of AbortController to avoid cancelling
// in-flight requests when the user types quickly.
// Supports debounce, cancellation, and custom provider/model selection.

import { useEffect, useRef } from 'react';
import type * as monacoEditor from 'monaco-editor';
import { fetchInlineCompletion } from '@/lib/inline-completion-service';

interface UseInlineCompletionProps {
  editorRef: React.MutableRefObject<monacoEditor.editor.IStandaloneCodeEditor | null>;
  monacoRef: React.MutableRefObject<typeof monacoEditor | null>;
  filePath: string | null;
  language: string | null;
  enabled: boolean;
  editorVersion: number;
  maxTokens: number;
  temperature: number;
  providerId: string | null;
  modelId: string | null;
}

export function useInlineCompletion({
  editorRef,
  monacoRef,
  filePath,
  language,
  enabled,
  editorVersion,
  maxTokens,
  temperature,
  providerId,
  modelId,
}: UseInlineCompletionProps) {
  const latestRequestIdRef = useRef(0);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !enabled) {
      console.log('[InlineCompletion] hook skipped — monaco or enabled false', { monaco: !!monaco, enabled });
      return;
    }

    console.log('[InlineCompletion] registering provider for', filePath, 'language:', language, 'config:', { providerId, modelId, maxTokens, temperature, enabled });

    const disposable = monaco.languages.registerInlineCompletionsProvider('*', {
      provideInlineCompletions: async (model, position, context, token) => {
        console.log('[InlineCompletion] provideInlineCompletions called at', position.lineNumber, ':', position.column, 'triggerKind:', context.triggerKind);

        if (!enabled || !filePath) {
          console.log('[InlineCompletion] skipped — enabled=', enabled, 'filePath=', filePath);
          return { items: [] };
        }

        const text = model.getValue();
        const offset = model.getOffsetAt(position);
        const prefix = text.slice(0, offset);
        const suffix = text.slice(offset);

        console.log('[InlineCompletion] prefix length:', prefix.length, 'suffix length:', suffix.length);

        const requestId = ++latestRequestIdRef.current;
        const controller = new AbortController();

        token.onCancellationRequested(() => {
          console.log('[InlineCompletion] Monaco cancellation requested for request', requestId, '— aborting fetch');
          controller.abort();
        });

        try {
          const result = await fetchInlineCompletion(
            {
              prefix,
              suffix,
              language: language ?? 'plaintext',
              filePath,
            },
            {
              providerId,
              modelId,
              maxTokens,
              temperature,
              signal: controller.signal,
            },
          );

          // If this request is not the latest one, ignore its result
          if (requestId !== latestRequestIdRef.current) {
            console.log('[InlineCompletion] request', requestId, 'is stale (latest=', latestRequestIdRef.current, '), ignoring result');
            return { items: [] };
          }

          if (!result.text) {
            console.log('[InlineCompletion] empty result from provider');
            return { items: [] };
          }

          const item: monacoEditor.languages.InlineCompletion = {
            insertText: result.text,
            // No range = insert at current cursor position
            // This avoids Monaco discarding the result when the cursor moved
            // while the request was in-flight.
          };

          console.log('[InlineCompletion] returning item for request', requestId, ':', JSON.stringify(item));
          return { items: [item] };
        } catch (err) {
          console.error('[InlineCompletion] error in provider:', err);
          return { items: [] };
        }
      },
      disposeInlineCompletions: () => {
        // No-op
      },
    });

    console.log('[InlineCompletion] provider registered');

    return () => {
      console.log('[InlineCompletion] disposing provider');
      disposable.dispose();
    };
  }, [monacoRef, enabled, filePath, language, maxTokens, temperature, providerId, modelId, editorVersion]);

  // Enable/disable Monaco's built-in inline suggest UI
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    console.log('[InlineCompletion] updating editor inlineSuggest.enabled to', enabled);
    editor.updateOptions({
      inlineSuggest: {
        enabled: enabled,
        mode: 'subwordSmart',
        showToolbar: 'always',
        suppressSuggestions: false,
      },
    });
  }, [editorRef, enabled]);

  // Monaco only auto-triggers provideInlineCompletions when the user types a word character.
  // Empty lines (navigated to or created via Enter) never get the automatic trigger.
  // This effect bridges the gap: fire an explicit trigger after the cursor settles on an
  // empty or whitespace-only line.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const disposable = editor.onDidChangeCursorPosition(() => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      const model = editor.getModel();
      const position = editor.getPosition();
      if (!model || !position) return;

      // Only schedule when the cursor is on an empty / whitespace-only line.
      if (model.getLineContent(position.lineNumber).trim() !== '') return;

      timer = setTimeout(() => {
        timer = null;
        // Re-verify the cursor is still on an empty line before triggering.
        const pos = editor.getPosition();
        const currentLine = pos ? (editor.getModel()?.getLineContent(pos.lineNumber) ?? '') : '';
        if (currentLine.trim() !== '') return;

        console.log('[InlineCompletion] cursor on empty line — firing explicit trigger');
        editor.trigger('inline-completion', 'editor.action.inlineSuggest.trigger', {});
      }, 500);
    });

    return () => {
      disposable.dispose();
      if (timer) clearTimeout(timer);
    };
  }, [editorRef, enabled, editorVersion]);
}
