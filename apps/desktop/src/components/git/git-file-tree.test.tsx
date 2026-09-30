/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GitFile } from '../../stores/git-store';
import { GitFileLayout } from './git-file-tree';

afterEach(() => {
  cleanup();
});

const files: GitFile[] = [
  {
    path: 'src/components/app.tsx',
    absolute_path: 'C:/workspace/src/components/app.tsx',
    status: 'M',
    old_path: null,
  },
  {
    path: 'README.md',
    absolute_path: 'C:/workspace/README.md',
    status: '?',
    old_path: null,
  },
];

describe('GitFileLayout', () => {
  it('renders nested directories expanded by default and keeps root files at the root', () => {
    render(
      <GitFileLayout
        files={files}
        mode="tree"
        renderFile={(file, depth) => (
          <div data-testid={`file-${file.path}`} data-depth={depth}>
            {file.path}
          </div>
        )}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Directory src' }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(
      screen
        .getByRole('button', { name: 'Directory src/components' })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByTestId('file-README.md').getAttribute('data-depth')).toBe('0');
    expect(screen.getByTestId('file-src/components/app.tsx').getAttribute('data-depth')).toBe('2');
  });

  it('collapses and re-expands a directory without hiding root files', () => {
    render(
      <GitFileLayout files={files} mode="tree" renderFile={(file) => <div>{file.path}</div>} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Directory src' }));

    expect(
      screen.getByRole('button', { name: 'Directory src' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.queryByText('src/components/app.tsx')).toBeNull();
    expect(screen.getByText('README.md')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Directory src' }));
    expect(screen.getByText('src/components/app.tsx')).toBeTruthy();
  });

  it('renders a flat list and passes depth zero in list mode', () => {
    const renderFile = vi.fn((file: GitFile, depth: number) => (
      <div data-testid={`file-${file.path}`} data-depth={depth}>
        {file.path}
      </div>
    ));

    render(<GitFileLayout files={files} mode="list" renderFile={renderFile} />);

    expect(screen.queryByRole('button', { name: 'Directory src' })).toBeNull();
    expect(screen.getByTestId('file-src/components/app.tsx').getAttribute('data-depth')).toBe('0');
    expect(renderFile).toHaveBeenCalledTimes(2);
  });
});
