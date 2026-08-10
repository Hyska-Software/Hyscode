/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RightTabStrip } from './right-tab-strip';

afterEach(() => {
  cleanup();
});

function renderStrip() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const onCollapse = vi.fn();
  const onOpenMenu = vi.fn();
  const onContextMenu = vi.fn();
  const onReorder = vi.fn();

  render(
    <RightTabStrip
      visibleTabs={['changes', 'files', 'terminal']}
      activeTab="changes"
      pendingCount={2}
      terminalActive
      menuOpen={false}
      onSelect={onSelect}
      onClose={onClose}
      onCollapse={onCollapse}
      onOpenMenu={onOpenMenu}
      onContextMenu={onContextMenu}
      onReorder={onReorder}
    />,
  );

  return { onSelect, onClose, onOpenMenu };
}

describe('RightTabStrip', () => {
  it('renders semantic tabs with a close action for each visible surface', () => {
    renderStrip();

    const toolbar = screen.getByRole('toolbar', { name: 'Right panel surfaces' });
    expect(toolbar.className).toContain('bg-surface');
    expect(toolbar.className).not.toContain('bg-surface-raised');
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Close Changes tab' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close Files tab' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close Terminal tab' })).toBeTruthy();
    const closeButton = screen.getByRole('button', { name: 'Close Changes tab' });
    expect(closeButton.className).toContain('w-0');
    expect(closeButton.className).toContain('group-hover:w-4');
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('closes a tab without activating it and exposes the surface menu trigger', () => {
    const { onSelect, onClose, onOpenMenu } = renderStrip();

    fireEvent.click(screen.getByRole('button', { name: 'Close Files tab' }));
    expect(onClose).toHaveBeenCalledWith('files');
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open a surface' }));
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });
});
