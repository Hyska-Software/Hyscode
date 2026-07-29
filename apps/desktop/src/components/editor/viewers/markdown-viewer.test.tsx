// @vitest-environment jsdom

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownViewMode } from '../../../stores/editor-store';
import { MarkdownViewer } from './markdown-viewer';

const monacoHarness = vi.hoisted(() => ({
  onMount: undefined as ((editor: unknown, monaco: unknown) => void) | undefined,
}));

vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange,
    options,
    onMount,
  }: {
    value: string;
    onChange?: (value: string) => void;
    options?: { readOnly?: boolean };
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) => {
    monacoHarness.onMount = onMount;
    return (
      <textarea
        aria-label="Markdown source"
        value={value}
        readOnly={options?.readOnly}
        onChange={(event) => onChange?.(event.currentTarget.value)}
      />
    );
  },
}));

vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({
    children,
    onLayout,
  }: {
    children: React.ReactNode;
    onLayout?: (sizes: number[]) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onLayout?.([65, 35])}>
        Resize split
      </button>
      {children}
    </div>
  ),
  Panel: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  PanelResizeHandle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../lib/monaco-themes', () => ({
  defineAllMonacoThemes: vi.fn(),
  getMonacoThemeName: () => 'vs-dark',
}));

vi.mock('@hyscode/lsp-client', () => ({
  registerAllLanguages: vi.fn(),
  disableNativeTypeScriptValidation: vi.fn(),
}));

vi.mock('../../../lib/lsp-bridge', () => ({
  LspBridge: { setMonaco: vi.fn() },
}));

afterEach(() => {
  cleanup();
  monacoHarness.onMount = undefined;
  vi.unstubAllGlobals();
});

function createFakeEditor() {
  let scrollTop = 0;
  let scrollListener: ((event: { scrollTopChanged: boolean }) => void) | undefined;
  let setScrollTopCalls = 0;
  return {
    emitScroll(): void {
      scrollListener?.({ scrollTopChanged: true });
    },
    getLayoutInfo: () => ({ height: 200 }),
    getScrollHeight: () => 1_000,
    getScrollTop: () => scrollTop,
    getSetScrollTopCalls: () => setScrollTopCalls,
    hasScrollListener: () => scrollListener !== undefined,
    onDidScrollChange(listener: (event: { scrollTopChanged: boolean }) => void) {
      scrollListener = listener;
      return { dispose: () => { scrollListener = undefined; } };
    },
    setScrollTop(value: number): void {
      setScrollTopCalls += 1;
      scrollTop = value;
      scrollListener?.({ scrollTopChanged: true });
    },
    setUserScrollTop(value: number): void {
      scrollTop = value;
    },
  };
}

function setPreviewScrollMetrics(container: HTMLElement): void {
  Object.defineProperties(container, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 1_000 },
  });
}

function installAnimationFrameQueue(): () => void {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextId += 1;
    callbacks.set(nextId, callback);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    callbacks.delete(id);
  });
  return () => {
    while (callbacks.size > 0) {
      const current = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of current) callback(0);
    }
  };
}

function EditableMarkdownHarness({ initialMode }: { initialMode: MarkdownViewMode }) {
  const [content, setContent] = useState('# Initial');
  const [mode, setMode] = useState<MarkdownViewMode>(initialMode);
  const [ratio, setRatio] = useState(50);
  return (
    <>
      <output aria-label="Split ratio">{ratio}</output>
      <MarkdownViewer
        content={content}
        mode={mode}
        onModeChange={setMode}
        onChange={setContent}
        onSplitRatioChange={setRatio}
        filePath="C:\\workspace\\README.md"
        rootPath="C:\\workspace"
        splitRatio={ratio}
      />
    </>
  );
}

describe('MarkdownViewer live modes', () => {
  it('shows the unsaved editor buffer immediately after switching to Preview', async () => {
    render(<EditableMarkdownHarness initialMode="code" />);
    fireEvent.change(await screen.findByLabelText('Markdown source'), {
      target: { value: '# Unsaved live content' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('heading', { name: 'Unsaved live content' })).toBeTruthy();
  });

  it('updates Preview while typing in Split and reports mouse resize layout', async () => {
    render(<EditableMarkdownHarness initialMode="split" />);
    fireEvent.change(await screen.findByLabelText('Markdown source'), {
      target: { value: '## Split is live' },
    });
    expect(await screen.findByRole('heading', { name: 'Split is live' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Resize split' }));
    expect(screen.getByLabelText('Split ratio').textContent).toBe('65');
  });

  it('preserves single newlines as visible line breaks in Preview', () => {
    const { container } = render(
      <MarkdownViewer
        content={'First line\nSecond line\nThird line'}
        mode="preview"
        onModeChange={vi.fn()}
        filePath="C:\\workspace\\README.md"
        rootPath="C:\\workspace"
      />,
    );

    expect(container.querySelectorAll('.markdown-preview p br')).toHaveLength(2);
  });

  it('preserves the number of empty source lines in Preview', () => {
    const { container } = render(
      <MarkdownViewer
        content={'First paragraph\n\n\n\nSecond paragraph'}
        mode="preview"
        onModeChange={vi.fn()}
        filePath="C:\\workspace\\README.md"
        rootPath="C:\\workspace"
      />,
    );

    expect(
      container.querySelector('[data-markdown-blank-lines="3"]'),
    ).not.toBeNull();
  });

  it('keeps the agent-style viewer source read-only', async () => {
    render(
      <MarkdownViewer
        content="# Read only"
        mode="split"
        onModeChange={vi.fn()}
        filePath="C:\\workspace\\README.md"
        rootPath="C:\\workspace"
        readOnly
      />,
    );
    const source = await screen.findByLabelText('Markdown source');
    expect(source).toHaveProperty('readOnly', true);
    expect(screen.getByText('Read only', { selector: 'span' })).toBeTruthy();
  });

  it('synchronizes Monaco scrolling to Preview without a reciprocal loop', async () => {
    const flushAnimationFrames = installAnimationFrameQueue();
    render(<EditableMarkdownHarness initialMode="split" />);
    const preview = await screen.findByLabelText('Markdown preview');
    setPreviewScrollMetrics(preview);
    const editor = createFakeEditor();

    act(() => {
      monacoHarness.onMount?.(editor, {});
    });
    await waitFor(() => expect(editor.hasScrollListener()).toBe(true));

    act(() => {
      editor.setUserScrollTop(400);
      editor.emitScroll();
      flushAnimationFrames();
    });

    expect(preview.scrollTop).toBe(400);
    expect(editor.getSetScrollTopCalls()).toBe(0);
  });

  it('synchronizes Preview scrolling to Monaco with the latest dimensions', async () => {
    const flushAnimationFrames = installAnimationFrameQueue();
    render(<EditableMarkdownHarness initialMode="split" />);
    const preview = await screen.findByLabelText('Markdown preview');
    setPreviewScrollMetrics(preview);
    const editor = createFakeEditor();

    act(() => {
      monacoHarness.onMount?.(editor, {});
    });
    await waitFor(() => expect(editor.hasScrollListener()).toBe(true));

    act(() => {
      preview.scrollTop = 600;
      fireEvent.scroll(preview);
      flushAnimationFrames();
    });

    expect(editor.getScrollTop()).toBe(600);
    expect(editor.getSetScrollTopCalls()).toBe(1);
  });

  it('resynchronizes the latest progress after a Split resize changes Preview height', async () => {
    const flushAnimationFrames = installAnimationFrameQueue();
    render(<EditableMarkdownHarness initialMode="split" />);
    const preview = await screen.findByLabelText('Markdown preview');
    setPreviewScrollMetrics(preview);
    const editor = createFakeEditor();

    act(() => {
      monacoHarness.onMount?.(editor, {});
    });
    await waitFor(() => expect(editor.hasScrollListener()).toBe(true));

    act(() => {
      editor.setUserScrollTop(400);
      editor.emitScroll();
      flushAnimationFrames();
    });
    expect(preview.scrollTop).toBe(400);

    Object.defineProperty(preview, 'scrollHeight', { configurable: true, value: 1_400 });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Resize split' }));
    });
    await waitFor(() => {
      act(() => {
        flushAnimationFrames();
      });
      expect(preview.scrollTop).toBe(600);
    });
  });

  it('resynchronizes the latest progress after Markdown content rerenders', async () => {
    const flushAnimationFrames = installAnimationFrameQueue();
    render(<EditableMarkdownHarness initialMode="split" />);
    const preview = await screen.findByLabelText('Markdown preview');
    setPreviewScrollMetrics(preview);
    const editor = createFakeEditor();

    act(() => {
      monacoHarness.onMount?.(editor, {});
    });
    await waitFor(() => expect(editor.hasScrollListener()).toBe(true));

    act(() => {
      editor.setUserScrollTop(400);
      editor.emitScroll();
      flushAnimationFrames();
    });
    expect(preview.scrollTop).toBe(400);

    Object.defineProperty(preview, 'scrollHeight', { configurable: true, value: 1_400 });
    fireEvent.change(screen.getByLabelText('Markdown source'), {
      target: { value: '# Rerendered content' },
    });
    await waitFor(() => {
      act(() => {
        flushAnimationFrames();
      });
      expect(preview.scrollTop).toBe(600);
    });
  });

  it('synchronizes the read-only agent-style Split view', async () => {
    const flushAnimationFrames = installAnimationFrameQueue();
    render(
      <MarkdownViewer
        content="# Read only"
        mode="split"
        onModeChange={vi.fn()}
        filePath="C:\\workspace\\README.md"
        rootPath="C:\\workspace"
        readOnly
      />,
    );
    const preview = await screen.findByLabelText('Markdown preview');
    setPreviewScrollMetrics(preview);
    const editor = createFakeEditor();

    act(() => {
      monacoHarness.onMount?.(editor, {});
    });
    await waitFor(() => expect(editor.hasScrollListener()).toBe(true));

    act(() => {
      editor.setUserScrollTop(200);
      editor.emitScroll();
      flushAnimationFrames();
    });

    expect(preview.scrollTop).toBe(200);
  });
});
