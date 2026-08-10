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
