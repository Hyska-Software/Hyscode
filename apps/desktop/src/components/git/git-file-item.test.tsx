/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GitFileItem } from './git-file-item';
import type { GitFile } from '../../stores/git-store';

afterEach(() => {
  cleanup();
});

const file: GitFile = {
  path: 'src/components/app.tsx',
  absolute_path: 'C:/workspace/src/components/app.tsx',
  status: 'M',
  old_path: null,
};

describe('GitFileItem preview action', () => {
  it('opens the provided Preview action from the hover toolbar', () => {
    const onOpenPreview = vi.fn();

    render(<GitFileItem file={file} mode="unstaged" onOpenPreview={onOpenPreview} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open in Preview' }));

    expect(onOpenPreview).toHaveBeenCalledTimes(1);
  });

  it('does not render the Preview action when it is not provided', () => {
    render(<GitFileItem file={file} mode="unstaged" />);

    expect(screen.queryByRole('button', { name: 'Open in Preview' })).toBeNull();
  });
});

describe('GitFileItem tree presentation', () => {
  it('supports indentation and hides the directory suffix when rendered in a tree', () => {
    render(<GitFileItem file={file} mode="unstaged" depth={2} showDirectoryPath={false} />);

    const row = screen.getByTitle('Modified: src/components/app.tsx');
    expect(row.getAttribute('style')).toContain('padding-left: 32px');
    expect(screen.queryByText('src/components')).toBeNull();
    expect(screen.getByText('app.tsx')).toBeTruthy();
  });
});
