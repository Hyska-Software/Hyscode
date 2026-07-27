// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownViewMode } from '../../../stores/editor-store';
import { MarkdownViewer } from './markdown-viewer';

vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange?: (value: string) => void;
    options?: { readOnly?: boolean };
  }) => (
    <textarea
      aria-label="Markdown source"
      value={value}
      readOnly={options?.readOnly}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  ),
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
});

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
});
