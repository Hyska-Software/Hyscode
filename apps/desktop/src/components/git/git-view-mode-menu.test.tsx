/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GitViewModeMenu } from './git-view-mode-menu';

afterEach(() => {
  cleanup();
});

describe('GitViewModeMenu', () => {
  it('marks the active view and emits the selected mode', () => {
    const onChange = vi.fn();
    render(<GitViewModeMenu value="tree" onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'Tree View' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'List View' }).getAttribute('aria-pressed')).toBe(
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'List View' }));

    expect(onChange).toHaveBeenCalledWith('list');
  });
});
