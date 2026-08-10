/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_RIGHT_TAB_ORDER } from '@/stores/layout-store';
import { OpenSurfaceGrid } from './open-surface-grid';

afterEach(() => {
  cleanup();
});

describe('OpenSurfaceGrid', () => {
  it('lists every right-panel surface when no tab is open', () => {
    render(<OpenSurfaceGrid tabs={DEFAULT_RIGHT_TAB_ORDER} onOpen={vi.fn()} />);

    expect(screen.getByText('Open a surface')).toBeTruthy();
    expect(screen.getByText('Choose what to show in the right panel.')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(DEFAULT_RIGHT_TAB_ORDER.length);
    expect(screen.getByRole('button', { name: /Context/ })).toBeTruthy();
  });

  it('opens the selected surface from its card', () => {
    const onOpen = vi.fn();
    render(<OpenSurfaceGrid tabs={DEFAULT_RIGHT_TAB_ORDER} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: /Terminal/ }));

    expect(onOpen).toHaveBeenCalledWith('terminal');
  });
});
